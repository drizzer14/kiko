import {
  type BackfillStatus,
  deriveBinanceOnlyCurrencies,
  deriveLastBackfilledDay,
  deriveFirstBackfilledDayByCurrency,
  deriveLastBackfilledDayByCurrency,
  planBackfillRun,
  runBackfill,
} from '@kiko/rates/history-backfill';
import either, { bifold, isLeft } from 'fnts/either';
import type { Currency } from '@kiko/currency/currency';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CurrencyRateHistoryRow, HoldingRow, TransactionRow } from '@kiko/db';

/**
 * Drives the incremental, non-blocking rate-history backfill and surfaces its status. It runs
 * when there is a bounded span (transactions or holdings exist) with days still to fill, when an
 * older-dated transaction extends the span EARLIER mid-session, OR when the held currency set
 * changes mid-session (a new holding's currency the last run never covered) — `planBackfillRun`
 * decides all three, resuming from null only on an earlier extension so `missingDays` recomputes
 * the whole span — the forward resume cursor cannot see a gap that opens below the newest stored
 * day; a currency-set change instead resumes from the ordinary incremental cursor, since
 * `runBackfill`'s own per-currency window already widens for the new currency on its own. See
 * `resolveBackfillWindow` (`history-backfill.ts`) for why `runBackfill` must honor an explicit
 * null as an override of its own per-currency minimum.
 */
export const useRateHistoryBackfill = (input: {
  transactions: readonly Pick<TransactionRow, 'id'>[];
  holdings: readonly Pick<HoldingRow, 'currency'>[];
  historyRows: Pick<CurrencyRateHistoryRow, 'base' | 'day' | 'source'>[];
  transactionsFresh: boolean;
  historyFresh: boolean;
  baseCurrency: Currency;
  spanStart: number;
  now: number;
}): BackfillStatus => {
  const {
    transactions,
    holdings,
    historyRows,
    transactionsFresh,
    historyFresh,
    baseCurrency,
    spanStart,
    now,
  } = input;

  // The resume point for the backfill: the newest day already stored, derived
  // from the history table itself (no extra persistence). Null when empty.
  const lastBackfilledDay = useMemo(() => deriveLastBackfilledDay(historyRows), [historyRows]);
  // Every currency's OWN last-backfilled day — `runBackfill`'s per-currency
  // resume cursor (a single global max(day) let one currency whose own leg
  // kept failing, or one held for the first time, hide behind another
  // currency's success and never re-fetch its own gap), derived from this
  // SAME already-loaded `historyRows` read, no new query.
  const lastBackfilledDayByCurrency = useMemo(
    () => deriveLastBackfilledDayByCurrency(historyRows),
    [historyRows],
  );
  // A run's own upsert — including a run that resolves 'failed' overall but
  // still persisted the currencies that DID compose — changes `historyRows`,
  // and with it these two values on the VERY NEXT render. Neither is an
  // effect dependency below: the backfill effect reads them through these
  // "latest" refs instead, so that self-triggered re-render cannot re-enter the effect on its own
  // — only a dependency that genuinely changed for an unrelated reason (`now` advancing on a real
  // focus, `spanStart` moving) does. Without this, a
  // failed run whose span ref was just cleared (below, to allow a LATER
  // retry) would see its own write's echo immediately, at the SAME instant,
  // and restart — a permanent request loop for a currency whose provider
  // never answers, for as long as Statistics stays mounted.
  const lastBackfilledDayRef = useRef(lastBackfilledDay);
  lastBackfilledDayRef.current = lastBackfilledDay;
  const lastBackfilledDayByCurrencyRef = useRef(lastBackfilledDayByCurrency);
  lastBackfilledDayByCurrencyRef.current = lastBackfilledDayByCurrency;
  // The first stored day of each currency: with the last, it tells the backfill which coin lacks
  // the days at the start of a span that moved earlier.
  const firstBackfilledDayByCurrency = useMemo(
    () => deriveFirstBackfilledDayByCurrency(historyRows),
    [historyRows],
  );
  const firstBackfilledDayByCurrencyRef = useRef(firstBackfilledDayByCurrency);
  firstBackfilledDayByCurrencyRef.current = firstBackfilledDayByCurrency;
  // The coins whose rows are all Binance's: an unexpired empty CoinGecko mark still holds for
  // them, so the backfill does not repeat the whole span on every run.
  const binanceOnlyCurrencies = useMemo(
    () => deriveBinanceOnlyCurrencies(historyRows),
    [historyRows],
  );
  const binanceOnlyCurrenciesRef = useRef(binanceOnlyCurrencies);
  binanceOnlyCurrenciesRef.current = binanceOnlyCurrencies;

  // The distinct set of currencies the backfill's own history must now cover:
  // every held holding's currency plus the base, sorted so the key stays
  // stable regardless of holdings-array order (a drag reorder must never look
  // like a currency change). Recomputed on every holdings/base change, so a
  // holding added or removed mid-session (a new GBP holding, say) changes this
  // key even though `spanStart` itself did not move.
  const historyCurrencyKey = useMemo(
    () =>
      [...new Set([...holdings.map((holding) => holding.currency), baseCurrency])].sort().join(','),
    [holdings, baseCurrency],
  );

  // Both refs hold what the last run covered, so the re-render the backfill's own writes trigger
  // (which advance `lastBackfilledDay`) does not re-enter for the same span/currency set.
  const backfillRanForSpanRef = useRef<number | null>(null);
  const backfillRanForCurrencyKeyRef = useRef<string | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus>({
    state: 'idle',
    lastDay: null,
  });

  // Guards the backfill effect's own async settle against a REAL unmount
  // only. A re-render whose deps changed (a refocus advancing `now`, for
  // example) fires the SAME cleanup lifecycle event as an unmount, so a
  // per-effect `cancelled` flag set in that effect's own returned cleanup
  // cannot tell the two apart — it would drop a still-pending run's eventual
  // settle on every refocus, leaving the line stuck on "loading" forever.
  // This ref only ever flips inside its own unmount-only effect (`[]` deps).
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Guards a settle against a SUPERSEDED run, not just a real unmount: a span
  // extension while still mounted (an older transaction arriving mid-session)
  // can start run B before run A's own settle arrives. Bumped only when this
  // effect actually starts a run (never on a plain refocus, which the
  // `backfillRanForSpanRef` check below already turns into a no-op), so a
  // stale run's `.then` can compare its captured token against the current
  // one and drop its settle instead of overwriting run B's state or ref.
  const runTokenRef = useRef(0);

  useEffect(() => {
    // `historyFresh` guards against the exact same "empty reads as no data
    // yet" trap kiko-architecture's useLiveQuery consumer rule covers for a
    // rendered empty state: `historyRows` is `[]` — indistinguishable from
    // "genuinely nothing backfilled yet" — for as long as its OWN query is
    // still on its first load, even after `transactions` has already
    // settled. Without this guard the effect re-fetches and re-writes the
    // whole span on first open, adding to the app-open DB-read burst, then
    // runs a SECOND time once history's real (possibly non-empty) rows land.
    // Both guards also wait out the cached rows of a cached mount: a run
    // marks its span covered for the rest of the mount, so a run planned from
    // a cached, one-read-old resume point would stop the fresh read's own run
    // from ever starting (kiko-architecture).
    if (
      (transactions.length === 0 && holdings.length === 0) ||
      !transactionsFresh ||
      !historyFresh
    ) {
      return;
    }

    const currenciesChanged =
      backfillRanForCurrencyKeyRef.current !== null &&
      backfillRanForCurrencyKeyRef.current !== historyCurrencyKey;
    const { run, resumeFrom } = planBackfillRun(
      spanStart,
      backfillRanForSpanRef.current,
      lastBackfilledDayRef.current,
      currenciesChanged,
    );

    if (!run) {
      return;
    }

    // Captured so a failed settle below can RESTORE both, not just clear them
    // to null — see that restore's own comment for why the distinction
    // matters.
    const spanCoveredBeforeThisRun = backfillRanForSpanRef.current;
    const currencyKeyCoveredBeforeThisRun = backfillRanForCurrencyKeyRef.current;
    // Mark this span AND currency set covered BEFORE the async run so the
    // write's own re-render (which advances lastBackfilledDay) does not
    // re-enter for the same span/currency set.
    backfillRanForSpanRef.current = spanStart;
    backfillRanForCurrencyKeyRef.current = historyCurrencyKey;
    runTokenRef.current += 1;
    const token = runTokenRef.current;

    // No local "nothing missing" shortcut here any more: `runBackfill` itself
    // owns that decision now, since it also has to check a newly-held or
    // lagging currency against `lastBackfilledDayByCurrency` — a check this
    // screen cannot replicate without `openCurrencies`'s own async read.
    setBackfillStatus({ state: 'loading', lastDay: lastBackfilledDayRef.current });
    // either() captures every rejection as a Left, and the .then handler only sets state.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    either<unknown, BackfillStatus>(() =>
      runBackfill({
        earliestDay: spanStart,
        lastBackfilledDay: resumeFrom,
        today: now,
        lastBackfilledDayByCurrency: lastBackfilledDayByCurrencyRef.current,
        firstBackfilledDayByCurrency: firstBackfilledDayByCurrencyRef.current,
        binanceOnlyCurrencies: binanceOnlyCurrenciesRef.current,
      }),
    ).then((result) => {
      if (!isMountedRef.current || token !== runTokenRef.current) {
        return;
      }

      if (isLeft(result)) {
        // A rejected run must retry on the next focus refresh instead of
        // being reported as done: RESTORE both refs to what they covered
        // BEFORE this run, not null — see the restore below for why.
        backfillRanForSpanRef.current = spanCoveredBeforeThisRun;
        backfillRanForCurrencyKeyRef.current = currencyKeyCoveredBeforeThisRun;
        setBackfillStatus({ state: 'failed', lastDay: lastBackfilledDayRef.current });

        return;
      }

      // `runBackfill` itself resolves a Right `'failed'` status (rather than
      // rejecting) when every provider failed for the span — treated
      // identically to the `isLeft` arm above: retry on the next focus.
      const settled: BackfillStatus = bifold(result);

      if (settled.state === 'failed') {
        // Restore, don't clear to null: a FIRST-ever run's pre-run value was
        // already null, so this still reads as never-run next time. But an
        // EARLIER-EXTENSION run's pre-run value was the OLD (later) spanStart
        // — clearing to null instead would make the next planBackfillRun call
        // take its "never run" branch, which resumes from the CURRENT
        // lastBackfilledDay (already advanced by an earlier successful run)
        // rather than recomputing the whole span — silently losing the
        // newly-opened earlier gap forever. Restoring the old spanStart keeps
        // `spanStart < ranForSpanStart` true, so the SAME earlier-extension
        // branch (resumeFrom: null) fires again on the next retry. The
        // currency key must restore the same way, or a currency-set change
        // that failed reads as already covered and never retries.
        backfillRanForSpanRef.current = spanCoveredBeforeThisRun;
        backfillRanForCurrencyKeyRef.current = currencyKeyCoveredBeforeThisRun;
      }
      setBackfillStatus(settled);
    });
  }, [
    transactions.length,
    holdings.length,
    transactionsFresh,
    historyFresh,
    spanStart,
    now,
    historyCurrencyKey,
  ]);

  return backfillStatus;
};
