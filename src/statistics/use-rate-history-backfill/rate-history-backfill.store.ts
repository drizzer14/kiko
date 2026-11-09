import {
  type BackfillDeps,
  type BackfillStatus,
  planBackfillRun,
  runBackfill,
} from '@kiko/rates/history-backfill';
import either, { bifold, isLeft } from 'fnts/either';

type BackfillRequest = {
  spanStart: number;
  currencyKey: string;
  now: number;
  lastBackfilledDay: number | null;
} & Required<
  Pick<
    BackfillDeps,
    'lastBackfilledDayByCurrency' | 'firstBackfilledDayByCurrency' | 'binanceOnlyCurrencies'
  >
>;

type Listener = () => void;

const IDLE: BackfillStatus = { state: 'idle', lastDay: null };

// One backfill for the whole app: Statistics and Tables read the same history, so one run covers
// both and a screen pushed after a settled run starts none. The covered span and currency key say
// what the last run is responsible for; the token tells a settle whether its run is still current.
let coveredSpan: number | null = null;
let coveredCurrencyKey: string | null = null;
let runToken = 0;
let status: BackfillStatus = IDLE;
const listeners = new Set<Listener>();

const publish = (next: BackfillStatus): void => {
  status = next;

  for (const listener of listeners) {
    listener();
  }
};

/**
 * Starts a backfill run for the request, or joins the one that already covers it. `planBackfillRun`
 * decides against the store's own covered span and currency key, so a second reader of the same
 * span and currencies starts nothing, a wider span or another currency set starts a new run and
 * drops the older run's settle, and a narrower span keeps the run and the status as they are.
 */
export const requestBackfill = (request: BackfillRequest): void => {
  const currenciesChanged =
    coveredCurrencyKey !== null && coveredCurrencyKey !== request.currencyKey;
  const { run, resumeFrom } = planBackfillRun(
    request.spanStart,
    coveredSpan,
    request.lastBackfilledDay,
    currenciesChanged,
  );

  if (!run) {
    return;
  }

  // Captured so a failed settle below can RESTORE both, not just clear them to null — see that
  // restore's own comment for why the distinction matters.
  const spanCoveredBeforeThisRun = coveredSpan;
  const currencyKeyCoveredBeforeThisRun = coveredCurrencyKey;
  // Mark this span AND currency set covered BEFORE the async run so the write's own re-render
  // (which advances lastBackfilledDay) does not re-enter for the same span/currency set.
  coveredSpan = request.spanStart;
  coveredCurrencyKey = request.currencyKey;
  runToken += 1;
  const token = runToken;

  // No local "nothing missing" shortcut here: `runBackfill` itself owns that decision, since it
  // also has to check a newly-held or lagging currency against `lastBackfilledDayByCurrency`, a
  // check this caller cannot replicate without `openCurrencies`'s own async read.
  publish({ state: 'loading', lastDay: request.lastBackfilledDay });
  // either() captures every rejection as a Left, and the .then handler only sets state.
  // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
  either<unknown, BackfillStatus>(() =>
    runBackfill({
      earliestDay: request.spanStart,
      lastBackfilledDay: resumeFrom,
      today: request.now,
      lastBackfilledDayByCurrency: request.lastBackfilledDayByCurrency,
      firstBackfilledDayByCurrency: request.firstBackfilledDayByCurrency,
      binanceOnlyCurrencies: request.binanceOnlyCurrencies,
    }),
  ).then((result) => {
    // A settle needs no mounted starter: it reaches whoever reads the store. It is dropped only
    // when a newer run, or the reset of an empty store, made this run's token stale.
    if (token !== runToken) {
      return;
    }

    if (isLeft(result)) {
      // A rejected run must retry on the next focus refresh instead of being reported as done:
      // RESTORE both to what they covered BEFORE this run, not null — see the restore below for
      // why.
      coveredSpan = spanCoveredBeforeThisRun;
      coveredCurrencyKey = currencyKeyCoveredBeforeThisRun;
      publish({ state: 'failed', lastDay: request.lastBackfilledDay });

      return;
    }

    // `runBackfill` itself resolves a Right `'failed'` status (rather than rejecting) when every
    // provider failed for the span — treated identically to the `isLeft` arm above: retry on the
    // next focus.
    const settled: BackfillStatus = bifold(result);

    if (settled.state === 'failed') {
      // Restore, don't clear to null: a FIRST-ever run's pre-run value was already null, so this
      // still reads as never-run next time. But an EARLIER-EXTENSION run's pre-run value was the
      // OLD (later) spanStart — clearing to null instead would make the next planBackfillRun call
      // take its "never run" branch, which resumes from the CURRENT lastBackfilledDay (already
      // advanced by an earlier successful run) rather than recomputing the whole span — silently
      // losing the newly-opened earlier gap forever. Restoring the old spanStart keeps
      // `spanStart < ranForSpanStart` true, so the SAME earlier-extension branch (resumeFrom:
      // null) fires again on the next retry. The currency key must restore the same way, or a
      // currency-set change that failed reads as already covered and never retries.
      coveredSpan = spanCoveredBeforeThisRun;
      coveredCurrencyKey = currencyKeyCoveredBeforeThisRun;
    }

    publish(settled);
  });
};

/** Registers a status listener; the last one to leave schedules the reset of an empty store. */
export const subscribeBackfillStatus = (listener: Listener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);

    // With no reader mounted nothing needs the covered span or the status, so the next mount
    // plans a run again. The reset waits one microtask: React runs a commit's passive cleanups
    // and the new tree's passive mounts in one synchronous flush, so a same-commit swap of every
    // reader (a fold or unfold) has subscribers again by then and keeps the covered span and the
    // status. A plain `Promise` and never `queueMicrotask`, which jest's fake timers replace.
    if (listeners.size === 0) {
      // The callback only reads and writes module state, so it never rejects.
      // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
      Promise.resolve().then(() => {
        if (listeners.size === 0) {
          coveredSpan = null;
          coveredCurrencyKey = null;
          status = IDLE;
          // A run still pending is dead with its readers: its settle must not land in the next
          // mount's status.
          runToken += 1;
        }
      });
    }
  };
};

/** The shared status of the last run, the `useSyncExternalStore` snapshot. */
export const getBackfillStatus = (): BackfillStatus => status;
