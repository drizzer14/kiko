import {
  isCrypto,
  currencyOptions,
  type Currency,
  type CryptoCurrency,
} from '@kiko/currency/currency';
import type { CurrencyRateHistoryRow } from '@kiko/db';
import { rateHistoryRepo } from '@kiko/rates/rate-history-repo';

import {
  openCurrencies as defaultOpenCurrencies,
  type OpenCurrencies,
} from '../open-currencies-gate';
import { fetchNbuHistory } from '../nbu-history';
import { type HistoryRateEntry, toUtcMidnight } from '../history-entry';
import { type CryptoHistory, fetchCryptoHistory } from '../coingecko-history';

const DAY_MS = 24 * 60 * 60 * 1000;

// The fiat anchors NBU quotes (USD/EUR against UAH) plus every crypto, derived
// from currency.ts so a newly added crypto composes chart history automatically.
// UAH itself is never listed: it is the implicit pivot, never a stored `X:UAH`
// row's own `base`.
const allCurrencies: Currency[] = ['USD', 'EUR', ...currencyOptions.filter(isCrypto)];

/** A row ready for `rateHistoryRepo.upsertMany` (rate stored as text). */
type NewHistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate' | 'source'>;

/**
 * Progress the Statistics screen can surface for the historical line chart.
 * `runBackfill` resolves `'failed'` itself when EVERY provider rejected for
 * the span (see its own doc below); a rejected PROMISE instead stays a
 * rejected promise, caught into the same `'failed'` state by the screen's own
 * catch arm. Either path, a network failure is never mistaken for a finished
 * backfill.
 */
export type BackfillStatus = {
  state: 'idle' | 'loading' | 'complete' | 'failed';
  lastDay: number | null;
};

/**
 * The backfill is resumable WITHOUT any new persistence: the last-backfilled day
 * is derived from the history table itself (the maximum stored `day`), so the
 * caller reads `rateHistoryRepo.historyRowsQuery()` and passes it here. Fetch
 * modules and the repo write are injectable for tests.
 */
export type BackfillDeps = {
  /** Earliest day the app has data for (holding/transaction), any instant on it. */
  earliestDay: number;
  /**
   * The max day already stored, or an EXPLICIT null — two distinct things a
   * `null` can mean here: history is genuinely empty, OR the caller
   * (`planBackfillRun`'s earlier-extension branch) deliberately wants this
   * run to recompute the WHOLE span from `earliestDay`, overriding the
   * per-currency minimum in `lastBackfilledDayByCurrency` below (which would
   * otherwise see every held currency already at today and report nothing
   * missing). Only affects the resume WINDOW; `state: 'complete'`'s returned
   * `lastDay` still falls back to this value when nothing new persists.
   */
  lastBackfilledDay?: number | null;
  /** Today, defaulting to the current UTC day. */
  today?: number;
  fetchNbuHistory?: (start: number, end: number) => Promise<HistoryRateEntry[]>;
  fetchCryptoHistory?: (days: number, currencies: CryptoCurrency[]) => Promise<CryptoHistory>;
  upsertMany?: (rows: NewHistoryRow[]) => Promise<void>;
  /**
   * The data-presence gate (kiko-architecture: app-open/refresh work is
   * gated on data presence — no request or query for data the user does not
   * have), shared with `refreshRates` (`rates-refresh.ts`) — see
   * `open-currencies-gate.ts`. Defaults to a real read of `settingsRepo` +
   * `holdingsRepo`'s one cheap `openCurrenciesQuery`.
   */
  openCurrencies?: () => Promise<OpenCurrencies>;
  /**
   * Every currency's OWN last-backfilled day —
   * `deriveLastBackfilledDayByCurrency(historyRows)`, the SAME `historyRows`
   * the caller already reads for `lastBackfilledDay`, so this needs no new
   * query. The global `lastBackfilledDay` is one max(day) across ALL
   * stored pairs, so once it reaches `today` (from whatever currency drove it
   * there), a DIFFERENT currency whose own leg kept failing — or one held for
   * the first time, with no row at all — hides behind that shared cursor and
   * never re-fetches its own gap. The resume cursor below is instead the
   * MINIMUM across every currently-held currency's own day here (missing
   * entirely counts as maximally behind), so the most-lagging one always
   * drives the window. Defaults to `{}` (nothing known backfilled).
   */
  lastBackfilledDayByCurrency?: Partial<Record<Currency, number>>;
  /**
   * Injectable override for `knownEmptyCurrenciesThisRun` below, so a test
   * can isolate its own set instead of sharing this module's per-app-run
   * singleton across unrelated cases. Production never passes this.
   */
  knownEmptyCurrencies?: Set<Currency>;
};

/**
 * Per-app-run, IN-MEMORY set of newly-held currencies (no stored history
 * row) whose providers all answered for the whole span yet returned no row
 * for them — e.g. a held coin CoinGecko never returns. Without it, such a
 * currency stays absent from `lastBackfilledDayByCurrency` forever, so
 * `resolveResumeCursor` resets to the whole span and re-fetches it on every
 * Statistics focus. Same trade-off as `metal-refresh.ts`'s
 * `emptyBackwardFloorByMetal`: forgotten on app restart, so at most one
 * wasted full-span fetch per currency per app session, never persisted
 * state for a rare case. A currency whose leg REJECTED, or a coin whose OWN
 * CoinGecko request failed inside a fulfilled leg, is never recorded — a
 * network failure is retried, not remembered as empty.
 */
const knownEmptyCurrenciesThisRun = new Set<Currency>();

/**
 * Every currency's own last-backfilled day, keyed by the `X:UAH` row's own
 * `base` — the same key `composeHistoryRows` writes one row per currency
 * under. A currency absent from the map has never been backfilled at all.
 */
export const deriveLastBackfilledDayByCurrency = (
  rows: Pick<CurrencyRateHistoryRow, 'base' | 'day'>[],
): Partial<Record<Currency, number>> => {
  const days: Partial<Record<Currency, number>> = {};

  for (const row of rows) {
    const current = days[row.base];

    if (current === undefined || row.day > current) {
      days[row.base] = row.day;
    }
  }

  return days;
};

/** The maximum stored `day`, i.e. the resume point — null when there is none. */
export const deriveLastBackfilledDay = (
  rows: Pick<CurrencyRateHistoryRow, 'day'>[],
): number | null =>
  rows.reduce<number | null>((max, row) => {
    return max === null || row.day > max ? row.day : max;
  }, null);

/**
 * The ascending list of UTC-midnight days still to fill: from `earliestDay`
 * (inclusive) when nothing was backfilled, else the day after `lastBackfilledDay`,
 * up to and including `today`. Empty once history has reached today.
 */
export const missingDays = (
  earliestDay: number,
  lastBackfilledDay: number | null,
  today: number,
): number[] => {
  const end = toUtcMidnight(today);
  const start =
    lastBackfilledDay === null
      ? toUtcMidnight(earliestDay)
      : toUtcMidnight(lastBackfilledDay) + DAY_MS;
  const days: number[] = [];

  for (let d = start; d <= end; d += DAY_MS) {
    days.push(d);
  }

  return days;
};

/**
 * Decide whether the incremental backfill must (re)run for `spanStart`, and from
 * where. It runs when it has never run (`ranForSpanStart === null`) or when
 * `spanStart` has moved strictly EARLIER than a prior run covered — an older
 * transaction appeared mid-session, opening a gap BELOW the newest stored day.
 * On that earlier-extension case it resumes from `null` so `missingDays`
 * recomputes the WHOLE span from `spanStart` (the idempotent upsert skips the
 * already-stored newer days); `missingDays`' forward cursor resumes ABOVE the
 * newest stored day and structurally cannot see the freshly-opened earlier gap
 * otherwise. A first, forward run keeps the incremental `lastBackfilledDay`
 * resume so it fetches only the new days.
 */
export const planBackfillRun = (
  spanStart: number,
  ranForSpanStart: number | null,
  lastBackfilledDay: number | null,
): { run: boolean; resumeFrom: number | null } => {
  if (ranForSpanStart === null) {
    return { run: true, resumeFrom: lastBackfilledDay };
  }

  if (spanStart < ranForSpanStart) {
    return { run: true, resumeFrom: null };
  }

  return { run: false, resumeFrom: null };
};

/** Choose the stored source for a currency's own `X:UAH` row — crypto comes from CoinGecko. */
const pairSource = (base: Currency): NewHistoryRow['source'] =>
  isCrypto(base) ? 'coingecko' : 'nbu';

/** Each currency's value expressed in UAH — the pivot for composing pairs. */
type UahPrice = Partial<Record<Currency, number>>;

/**
 * Resolve one anchor's rate for `day` from its ascending timeline, using the
 * nearest point AT OR BEFORE `day` (carry-forward across weekend/holiday gaps).
 */
const nearestAtOrBefore = (timeline: HistoryRateEntry[], day: number): number | undefined => {
  let rate: number | undefined;

  for (const entry of timeline) {
    if (entry.day <= day) {
      rate = entry.rate;
    } else {
      break;
    }
  }

  return rate;
};

const anchorKey = (base: Currency, quote: Currency) => `${base}:${quote}`;

/**
 * Group anchor entries into ascending per-pair timelines so each target day can
 * carry the nearest prior rate forward.
 */
const groupTimelines = (entries: HistoryRateEntry[]): Map<string, HistoryRateEntry[]> => {
  const timelines = new Map<string, HistoryRateEntry[]>();

  for (const entry of entries) {
    const key = anchorKey(entry.base, entry.quote);
    const list = timelines.get(key) ?? [];
    list.push(entry);
    timelines.set(key, list);
  }

  for (const list of timelines.values()) {
    list.sort((a, b) => a.day - b.day);
  }

  return timelines;
};

/**
 * Build the UAH pivot for `day` from the anchor timelines: USD/EUR anchor to UAH
 * directly, every crypto through its USD price so crypto pairs stay consistent
 * with fiat.
 */
const uahPriceAt = (timelines: Map<string, HistoryRateEntry[]>, day: number): UahPrice => {
  const price: UahPrice = { UAH: 1 };
  const usd = nearestAtOrBefore(timelines.get('USD:UAH') ?? [], day);
  const eur = nearestAtOrBefore(timelines.get('EUR:UAH') ?? [], day);

  if (usd !== undefined) {
    price.USD = usd;
  }

  if (eur !== undefined) {
    price.EUR = eur;
  }

  if (usd !== undefined) {
    for (const crypto of currencyOptions.filter(isCrypto)) {
      const cryptoUsd = nearestAtOrBefore(timelines.get(`${crypto}:USD`) ?? [], day);

      if (cryptoUsd !== undefined) {
        price[crypto] = cryptoUsd * usd;
      }
    }
  }

  return price;
};

/**
 * Compose one `X:UAH` row per priced currency (USD/EUR plus every crypto) for
 * each target day from the day's UAH-anchored prices (mirrors the per-run
 * pivot in `rates-refresh.ts`, per historical day instead) — never a cross
 * row between two non-UAH currencies; a cross rate resolves at READ TIME
 * through the UAH pivot (`rateBetween`/`rateTableAt`). A row is emitted only
 * when that day's own price resolves. Rates are stored as strings, never floats.
 */
export const composeHistoryRows = (
  entries: HistoryRateEntry[],
  days: number[],
): NewHistoryRow[] => {
  const timelines = groupTimelines(entries);
  const rows: NewHistoryRow[] = [];

  for (const day of days) {
    const price = uahPriceAt(timelines, day);

    for (const base of allCurrencies) {
      const rate = price[base];

      if (rate === undefined) {
        continue;
      }
      rows.push({ base, quote: 'UAH', day, rate: String(rate), source: pairSource(base) });
    }
  }

  return rows;
};

/** The NBU leg, gated on `needsFiat` — `[]` without ever calling `loadNbu`. */
const runNbuLeg = (
  needsFiat: boolean,
  loadNbu: (start: number, end: number) => Promise<HistoryRateEntry[]>,
  spanStart: number,
  today: number,
): Promise<HistoryRateEntry[]> => (needsFiat ? loadNbu(spanStart, today) : Promise.resolve([]));

/** A crypto leg that requested nothing: no entries, no failed coin. */
const NO_CRYPTO_HISTORY: CryptoHistory = { entries: [], failedCurrencies: [] };

/** The CoinGecko leg, gated on a non-empty held set — no entries without ever calling `loadCrypto`. */
const runCryptoLeg = (
  cryptoCurrencies: CryptoCurrency[],
  loadCrypto: (days: number, currencies: CryptoCurrency[]) => Promise<CryptoHistory>,
  cryptoDays: number,
): Promise<CryptoHistory> =>
  cryptoCurrencies.length > 0
    ? loadCrypto(cryptoDays, cryptoCurrencies)
    : Promise.resolve(NO_CRYPTO_HISTORY);

/** Every currently-held currency, fiat represented by its `USD` anchor (EUR always composes alongside it, same NBU leg). */
const heldCurrencies = (needsFiat: boolean, cryptoCurrencies: CryptoCurrency[]): Currency[] =>
  needsFiat ? ['USD', ...cryptoCurrencies] : cryptoCurrencies;

/**
 * The resume cursor for THIS run: the OLDEST last-backfilled day
 * among every currently-held currency, not one shared max across everything.
 * A single global cursor let one currency whose own leg kept failing hide
 * behind another currency's success (it never re-derives a gap once the
 * SHARED cursor reaches `today`, even though ITS OWN rows stop earlier) —
 * resuming from the minimum means the most-lagging held currency always
 * drives the window, and the idempotent day-pair upsert makes re-covering an
 * already-current currency in that same wider window free. `null` (recompute
 * the whole span) whenever a held currency has never been backfilled at all.
 * A currency this app run already confirmed has no data (`knownEmpty`) is
 * excluded — it would otherwise pin the cursor to `null` forever.
 */
const resolveResumeCursor = (
  held: Currency[],
  lastBackfilledDayByCurrency: Partial<Record<Currency, number>>,
  knownEmpty: ReadonlySet<Currency>,
): number | null => {
  let minimum: number | null = null;

  for (const currency of held) {
    if (knownEmpty.has(currency)) {
      continue;
    }

    const lastDay = lastBackfilledDayByCurrency[currency];

    if (lastDay === undefined) {
      return null;
    }

    if (minimum === null || lastDay < minimum) {
      minimum = lastDay;
    }
  }

  return minimum;
};

/**
 * `resolveResumeCursor` plus the never-backfilled candidate list
 * `recordKnownEmpty` needs, computed together so `runBackfill` itself stays a
 * flat sequence. `callerLastBackfilledDay` — the caller's OWN
 * `deps.lastBackfilledDay` — overrides the per-currency minimum with an
 * explicit `null` (recompute the whole span from `earliestDay`): the caller
 * (`planBackfillRun`) passes exactly that when an older transaction extends
 * the span EARLIER than any prior run covered, and the forward per-currency
 * minimum cannot see a gap that opens BELOW the newest day every held
 * currency already reached — it would otherwise report nothing missing and
 * skip that earlier gap forever. A non-null caller value means no such
 * earlier extension happened, so the per-currency minimum decides normally.
 */
const resolveBackfillWindow = (
  needsFiat: boolean,
  cryptoCurrencies: CryptoCurrency[],
  lastBackfilledDayByCurrency: Partial<Record<Currency, number>>,
  knownEmpty: ReadonlySet<Currency>,
  callerLastBackfilledDay: number | null,
): { neverBackfilled: Currency[]; resumeFrom: number | null } => {
  const held = heldCurrencies(needsFiat, cryptoCurrencies);
  const neverBackfilled = held.filter(
    (currency) => lastBackfilledDayByCurrency[currency] === undefined && !knownEmpty.has(currency),
  );

  return {
    neverBackfilled,
    resumeFrom:
      callerLastBackfilledDay === null
        ? null
        : resolveResumeCursor(held, lastBackfilledDayByCurrency, knownEmpty),
  };
};

/**
 * Adds to `knownEmpty` every NEVER-backfilled held currency (no stored day at
 * all) this whole-span run composed no row for — only when EVERY provider leg
 * answered, and never a coin in `failedCurrencies`: CoinGecko settles per
 * coin, so one coin's 200 fulfils the leg while another coin's own request
 * failed. A failed request is a network failure to retry, not an empty
 * answer. A currency that already HAD some rows (merely lagging) is never a
 * candidate here — it keeps retrying every run through
 * `resolveResumeCursor` instead of being permanently blacklisted.
 */
const recordKnownEmpty = (
  legs: PromiseSettledResult<unknown>[],
  neverBackfilled: Currency[],
  rows: NewHistoryRow[],
  failedCurrencies: readonly Currency[],
  knownEmpty: Set<Currency>,
): void => {
  if (legs.some((leg) => leg.status === 'rejected')) {
    return;
  }

  const composedOrFailed = new Set<Currency>([...rows.map((row) => row.base), ...failedCurrencies]);

  for (const currency of neverBackfilled.filter((candidate) => !composedOrFailed.has(candidate))) {
    knownEmpty.add(currency);
  }
};

/**
 * One outcome rule: every currency this run attempted to
 * resolve but did not, because its OWN provider leg rejected outright, or
 * (crypto only) its own per-coin request failed inside an otherwise-fulfilled
 * leg. A rejected NBU leg fails BOTH `USD` and `EUR` (composed from the same
 * fetch); it also transitively blocks every crypto row (`composeHistoryRows`
 * needs the SAME-run `USD` anchor to price a crypto pair), so nothing further
 * needs to special-case that dependency here — a failed NBU leg alone already
 * leaves every crypto currency out of `composed` too.
 */
const unresolvedFailures = (
  needsFiat: boolean,
  cryptoCurrencies: CryptoCurrency[],
  nbuResult: PromiseSettledResult<HistoryRateEntry[]>,
  cryptoResult: PromiseSettledResult<CryptoHistory>,
  crypto: CryptoHistory,
  composed: ReadonlySet<Currency>,
): Currency[] => {
  const failed: Currency[] = [
    ...(needsFiat && nbuResult.status === 'rejected' ? (['USD', 'EUR'] as Currency[]) : []),
    ...(cryptoResult.status === 'rejected' ? cryptoCurrencies : crypto.failedCurrencies),
  ];

  return failed.filter((currency) => !composed.has(currency));
};

/**
 * Compose this run's rows from both settled legs, record any newly-confirmed
 * `knownEmpty` currency, and classify the result — the whole middle of
 * `runBackfill` extracted so that function itself stays a flat sequence of
 * early returns.
 */
const composeAndClassify = (
  needsFiat: boolean,
  cryptoCurrencies: CryptoCurrency[],
  neverBackfilled: Currency[],
  days: number[],
  nbuResult: PromiseSettledResult<HistoryRateEntry[]>,
  cryptoResult: PromiseSettledResult<CryptoHistory>,
  knownEmpty: Set<Currency>,
): { rows: NewHistoryRow[]; failures: Currency[] } => {
  const nbu = nbuResult.status === 'fulfilled' ? nbuResult.value : [];
  const crypto = cryptoResult.status === 'fulfilled' ? cryptoResult.value : NO_CRYPTO_HISTORY;
  const rows = composeHistoryRows([...nbu, ...crypto.entries], days);

  recordKnownEmpty(
    [nbuResult, cryptoResult],
    neverBackfilled,
    rows,
    crypto.failedCurrencies,
    knownEmpty,
  );

  const composed = new Set(rows.map((row) => row.base));
  const failures = unresolvedFailures(
    needsFiat,
    cryptoCurrencies,
    nbuResult,
    cryptoResult,
    crypto,
    composed,
  );

  return { rows, failures };
};

/**
 * Run one incremental pass: compute the still-missing days, fetch the fiat range
 * from NBU and every crypto's series from CoinGecko for that span, compose every
 * cross pair per day, and upsert them. Idempotent (upsert on the pair-day index) and
 * resumable — a fresh call picks up wherever each held currency's own day leaves
 * off (`resolveResumeCursor`). Returns a terminal `BackfillStatus`: `complete`
 * once every attempted currency resolved (or the span genuinely had nothing new
 * to upsert), or `failed` when an attempted currency's fetch failed and nothing
 * composed for it this run (`unresolvedFailures`) — never `complete` while a
 * currency this run was supposed to resolve stays silently unresolved. Any rows
 * that DID compose this run are still persisted before a `failed` return, so a
 * partial success (e.g. fiat succeeded while crypto failed) is never re-fetched
 * on retry.
 */
export const runBackfill = async (deps: BackfillDeps): Promise<BackfillStatus> => {
  const today = toUtcMidnight(deps.today ?? Date.now());
  const lastBackfilledDay = deps.lastBackfilledDay ?? null;

  const openCurrencies = deps.openCurrencies ?? defaultOpenCurrencies;
  const { needsFiat, cryptoCurrencies } = await openCurrencies();

  // kiko-architecture: no request or query for data the user does not have —
  // nothing active that differs from the base currency, and no crypto held,
  // means neither leg has anything to fetch this run.
  if (!needsFiat && cryptoCurrencies.length === 0) {
    return { state: 'complete', lastDay: lastBackfilledDay };
  }

  const knownEmpty = deps.knownEmptyCurrencies ?? knownEmptyCurrenciesThisRun;
  const lastBackfilledDayByCurrency = deps.lastBackfilledDayByCurrency ?? {};
  const { neverBackfilled, resumeFrom } = resolveBackfillWindow(
    needsFiat,
    cryptoCurrencies,
    lastBackfilledDayByCurrency,
    knownEmpty,
    lastBackfilledDay,
  );

  const days = missingDays(deps.earliestDay, resumeFrom, today);

  if (days.length === 0) {
    return { state: 'complete', lastDay: lastBackfilledDay };
  }

  const loadNbu = deps.fetchNbuHistory ?? ((start, end) => fetchNbuHistory(start, end));
  const loadCrypto =
    deps.fetchCryptoHistory ??
    ((count, currencies) => fetchCryptoHistory(count, fetch, currencies));
  const upsertMany = deps.upsertMany ?? rateHistoryRepo.upsertMany;

  const spanStart = days[0];
  const cryptoDays = Math.ceil((today - spanStart) / DAY_MS) + 1;
  // Settle the two providers independently: CoinGecko's free tier can 401 a
  // long crypto span, and an all-or-nothing `Promise.all` would then discard the
  // NBU fiat rates too. Whichever source succeeds still contributes its anchors.
  // Each leg is ALSO gated individually on `openCurrencies`'s own verdict: a
  // leg with nothing to convert/hold resolves to `[]` without ever calling
  // its fetch function.
  const [nbuResult, cryptoResult] = await Promise.allSettled([
    runNbuLeg(needsFiat, loadNbu, spanStart, today),
    runCryptoLeg(cryptoCurrencies, loadCrypto, cryptoDays),
  ]);

  const { rows, failures } = composeAndClassify(
    needsFiat,
    cryptoCurrencies,
    neverBackfilled,
    days,
    nbuResult,
    cryptoResult,
    knownEmpty,
  );

  if (rows.length > 0) {
    await upsertMany(rows);
  }

  if (failures.length > 0) {
    // An attempted currency's fetch failed for this span and nothing composed
    // for it: report `'failed'`, never `'complete'` — the caller's
    // `lastBackfilledDay` resume point is left exactly where it was, so a
    // later pass re-fetches this same span rather than skipping it as already
    // done. Whatever DID compose from the other currencies above is already
    // persisted, so a partial success is never redone.
    return { state: 'failed', lastDay: lastBackfilledDay };
  }

  if (rows.length === 0) {
    // Nothing composed (both providers empty for the span), so nothing is
    // persisted. Leave the resume cursor where it was rather than claiming the
    // span is filled up to today — otherwise the next pass would skip these
    // still-missing days and the line would never fill.
    return { state: 'complete', lastDay: lastBackfilledDay };
  }

  // Advance the cursor only to the newest day actually stored (usually today,
  // but earlier if the latest days had no anchor yet), so a later pass resumes
  // and fills the remaining gap instead of assuming today is done.
  const lastPersisted = rows.reduce((max, row) => {
    return row.day > max ? row.day : max;
  }, rows[0].day);

  return { state: 'complete', lastDay: lastPersisted };
};
