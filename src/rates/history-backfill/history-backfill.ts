import type { CurrencyRateHistoryRow } from '@kiko/db';
import { rateHistoryRepo } from '@kiko/rates/rate-history-repo';

import {
  openCurrencies as defaultOpenCurrencies,
  type OpenCurrencies,
} from '../open-currencies-gate';
import {
  isCrypto,
  currencyOptions,
  type Currency,
  type CryptoCurrency,
} from '../../currency/currency';
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
  /** The max day already stored, or null when history is empty. */
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
   * Every currency that already has at least one stored history row —
   * `derivePresentCurrencies(historyRows)`, the SAME `historyRows` the caller
   * already reads for `lastBackfilledDay`, so this needs no new query. The
   * global `lastBackfilledDay` is one max(day) across ALL stored pairs; once
   * it reaches `today`, a currency newly held afterward (a coin nobody held
   * during that earlier run, or a base-currency-only user's first foreign
   * holding) has NO row of its own at all, and the day-based gate alone would
   * skip it forever. Defaults to `[]` (nothing known present).
   */
  presentCurrencies?: Currency[];
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
 * currency stays absent from `presentCurrencies` forever, so
 * `resolveResumeCursor` resets to the whole span and re-fetches it on every
 * Statistics focus. Same trade-off as `metal-refresh.ts`'s
 * `emptyBackwardFloorByMetal`: forgotten on app restart, so at most one
 * wasted full-span fetch per currency per app session, never persisted
 * state for a rare case. A currency whose leg REJECTED, or a coin whose OWN
 * CoinGecko request failed inside a fulfilled leg, is never recorded — a
 * network failure is retried, not remembered as empty.
 */
const knownEmptyCurrenciesThisRun = new Set<Currency>();

/** Every currency that appears as either `base` or `quote` in at least one stored row. */
export const derivePresentCurrencies = (
  rows: Pick<CurrencyRateHistoryRow, 'base' | 'quote'>[],
): Currency[] => {
  const present = new Set<Currency>();

  for (const row of rows) {
    present.add(row.base);
    present.add(row.quote);
  }

  return [...present];
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

/**
 * The global `lastBackfilledDay` cursor can already sit at `today` from a
 * PRIOR run's currently-held set, while a currency held NOW has never itself
 * been backfilled — a coin first added after that run, or fiat conversion
 * needed for the first time. This lists those currencies (fiat as its `USD`
 * anchor), minus any this app run already fetched the whole span for and got
 * nothing back (`knownEmpty`) — re-asking would only repeat the same empty
 * answer.
 */
const unbackfilledCurrencies = (
  needsFiat: boolean,
  cryptoCurrencies: CryptoCurrency[],
  presentCurrencies: Currency[] | undefined,
  knownEmpty: ReadonlySet<Currency>,
): Currency[] => {
  const present = new Set(presentCurrencies ?? []);
  const held: Currency[] = needsFiat ? ['USD', ...cryptoCurrencies] : cryptoCurrencies;

  return held.filter((currency) => !present.has(currency) && !knownEmpty.has(currency));
};

/**
 * The cursor to use for THIS run: `null` (recompute the whole span) whenever
 * a held currency has never been backfilled, so `missingDays` never silently
 * skips it forever; unchanged otherwise.
 */
const resolveResumeCursor = (
  lastBackfilledDay: number | null,
  unbackfilled: Currency[],
): number | null => (unbackfilled.length > 0 ? null : lastBackfilledDay);

/**
 * Adds to `knownEmpty` every `unbackfilled` currency this whole-span run
 * composed no row for — only when EVERY provider leg answered, and never a
 * coin in `failedCurrencies`: CoinGecko settles per coin, so one coin's 200
 * fulfils the leg while another coin's own request failed. A failed request is
 * a network failure to retry, not an empty answer.
 */
const recordKnownEmpty = (
  legs: PromiseSettledResult<unknown>[],
  unbackfilled: Currency[],
  rows: NewHistoryRow[],
  failedCurrencies: readonly Currency[],
  knownEmpty: Set<Currency>,
): void => {
  if (legs.some((leg) => leg.status === 'rejected')) {
    return;
  }

  const composedOrFailed = new Set<Currency>([...rows.map((row) => row.base), ...failedCurrencies]);

  for (const currency of unbackfilled.filter((candidate) => !composedOrFailed.has(candidate))) {
    knownEmpty.add(currency);
  }
};

/**
 * Run one incremental pass: compute the still-missing days, fetch the fiat range
 * from NBU and every crypto's series from CoinGecko for that span, compose every
 * cross pair per day, and upsert them. Idempotent (upsert on the pair-day index) and
 * resumable — a fresh call picks up wherever `lastBackfilledDay` leaves off.
 * Returns a terminal `BackfillStatus`: `complete` once the pass has upserted
 * (or had nothing new to upsert for) the missing span, or `failed` when every
 * provider rejected for it (see the guard just below) — never `complete` on
 * a network failure.
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
  const unbackfilled = unbackfilledCurrencies(
    needsFiat,
    cryptoCurrencies,
    deps.presentCurrencies,
    knownEmpty,
  );
  const effectiveLastBackfilledDay = resolveResumeCursor(lastBackfilledDay, unbackfilled);

  const days = missingDays(deps.earliestDay, effectiveLastBackfilledDay, today);

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

  if (nbuResult.status === 'rejected' && cryptoResult.status === 'rejected') {
    // Every provider failed for this span (e.g. fully offline): report
    // `'failed'`, never `'complete'` — the caller's `lastBackfilledDay`
    // resume point is left exactly where it was, so a later pass re-fetches
    // this same span rather than skipping it as already done. Only ONE
    // provider rejecting instead keeps composing from whichever succeeded,
    // the existing partial-history behavior below.
    return { state: 'failed', lastDay: lastBackfilledDay };
  }

  const nbu = nbuResult.status === 'fulfilled' ? nbuResult.value : [];
  const crypto = cryptoResult.status === 'fulfilled' ? cryptoResult.value : NO_CRYPTO_HISTORY;

  const rows = composeHistoryRows([...nbu, ...crypto.entries], days);

  recordKnownEmpty(
    [nbuResult, cryptoResult],
    unbackfilled,
    rows,
    crypto.failedCurrencies,
    knownEmpty,
  );

  if (rows.length === 0) {
    // Nothing composed (both providers empty for the span), so nothing is
    // persisted. Leave the resume cursor where it was rather than claiming the
    // span is filled up to today — otherwise the next pass would skip these
    // still-missing days and the line would never fill.
    return { state: 'complete', lastDay: lastBackfilledDay };
  }
  await upsertMany(rows);
  // Advance the cursor only to the newest day actually stored (usually today,
  // but earlier if the latest days had no anchor yet), so a later pass resumes
  // and fills the remaining gap instead of assuming today is done.
  const lastPersisted = rows.reduce((max, row) => {
    return row.day > max ? row.day : max;
  }, rows[0].day);

  return { state: 'complete', lastDay: lastPersisted };
};
