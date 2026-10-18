import {
  type SettledMark,
  type SettledHistory,
  type HistoryBackfillState,
  parseHistoryBackfillState,
  settingsRepo,
} from '@kiko/settings';
import {
  isCrypto,
  currencyOptions,
  type Currency,
  type CryptoCurrency,
} from '@kiko/currency/currency';
import { DAY_MS } from '@kiko/dates';
import { minOf } from '@kiko/numbers';
import either, { bifoldr } from 'fnts/either';
import { logOnFailure } from '@kiko/diagnostics';
import type { CurrencyRateHistoryRow } from '@kiko/db';
import { rateHistoryRepo } from '@kiko/rates/rate-history-repo';

import {
  type HistoryRateEntry,
  groupTimelines,
  nearestAtOrBefore,
  toUtcMidnight,
} from '../history-entry';
import {
  historyCurrencies as defaultHistoryCurrencies,
  type HistoryCurrencies,
} from '../open-currencies-gate';
import type { BinanceMarketClient } from '../binance-market';
import { type NbuHistory, fetchNbuHistory } from '../nbu-history';
import { type CryptoHistory, CryptoHistoryFailure, fetchCryptoHistory } from '../coingecko-history';

import { withBinanceFallback } from './history-backfill.binance-fallback';

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
 * caller reads `rateHistoryRepo.historyRowsQuery()` and passes it here. The one thing it does
 * persist is where the crypto requests start (`historyBackfillState`), so a provider that cuts
 * every run short cannot keep the same coins waiting. Fetch modules and the repo write are
 * injectable for tests.
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
  fetchNbuHistory?: (currencies: Currency[], start: number, end: number) => Promise<NbuHistory>;
  fetchCryptoHistory?: (days: number, currencies: CryptoCurrency[]) => Promise<CryptoHistory>;
  /**
   * Binance's public market data, asked only for a requested coin CoinGecko gave no history for.
   * Defaults to a client of this run, so its pacing, budget and refusals belong to this run alone.
   */
  binanceMarket?: BinanceMarketClient;
  upsertMany?: (rows: NewHistoryRow[]) => Promise<void>;
  /**
   * The data-presence gate (kiko-architecture: app-open/refresh work is
   * gated on data presence — no request or query for data the user does not
   * have), shared with the screen's own read of it — see
   * `open-currencies-gate.ts`'s `historyCurrencies`. Defaults to a real read
   * of `settingsRepo` + `holdingsRepo`'s `historyCurrenciesQuery` (every
   * holding, open and closed).
   */
  historyCurrencies?: () => Promise<HistoryCurrencies>;
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
  /**
   * Where this device's crypto history requests start (`settings.historyBackfillState`), and the
   * writer for the next run's start. Defaults to the settings row; a test passes its own store.
   */
  readHistoryBackfillCursor?: () => Promise<string | null>;
  writeHistoryBackfillCursor?: (cursor: string | null) => Promise<void>;
  /**
   * The settled marks (`settings.historyBackfillState` holds them beside the coin cursor): the
   * currencies, fiat and coin, already fetched from a span start without finding an earlier day,
   * with the first day the provider answered from. The writer adds marks and keeps the others.
   * Defaults to the settings row; a test passes its own store.
   */
  readSettledHistory?: () => Promise<SettledHistory>;
  writeSettledHistory?: (additions: SettledHistory) => Promise<void>;
  /**
   * Every currency's OWN first stored day (`deriveFirstBackfilledDayByCurrency(historyRows)`):
   * with the last day it tells a held coin that lacks the days at the start of a span that moved
   * earlier. Defaults to `{}`, where no coin is known to lack them.
   */
  firstBackfilledDayByCurrency?: Partial<Record<Currency, number>>;
};

// The coin cursor and the settled marks share one settings column; each writer changes its own
// part and keeps the other.
const readStoredState = async (): Promise<HistoryBackfillState> =>
  parseHistoryBackfillState(
    (await settingsRepo.historyBackfillStateQuery()).at(0)?.historyBackfillState ?? null,
  );

const readStoredCursor = async (): Promise<string | null> => (await readStoredState()).cursor;

const writeStoredCursor = async (cursor: string | null): Promise<void> => {
  await settingsRepo.changeHistoryBackfillState((state) => ({ ...state, cursor }));
};

const readStoredSettled = async (): Promise<SettledHistory> => (await readStoredState()).settled;

const writeStoredSettled = (additions: SettledHistory): Promise<void> =>
  settingsRepo.recordSettledHistory(additions);

/**
 * Whether a series lacks days at the start of the span it is asked for. Without a mark, its
 * first stored day is later than the start. With one (a fetch already began from `mark.start`
 * and the provider answered from `mark.firstDay` on, or with nothing), the days before
 * `firstDay` do not exist; the series lacks days only for a start before the one it settled for,
 * or when its stored rows start after `firstDay` (a restore brings rows that may).
 *
 * NBU quotes every calendar day, weekends and holidays included (checked for nine currencies
 * over 2019 to 2025: no day without a quote), so for fiat a first day later than the start means
 * NBU had no quote before it, and no tolerance is needed.
 */
const seriesMissesEarlierDays = (
  mark: SettledMark | undefined,
  firstDay: number | undefined,
  requestedStart: number,
): boolean => {
  // An empty mark says nothing once rows exist: they came from a later answer.
  if (mark === undefined || (mark.firstDay === null && firstDay !== undefined)) {
    return firstDay !== undefined && firstDay > requestedStart;
  }

  return (
    requestedStart < mark.start ||
    (mark.firstDay !== null && firstDay !== undefined && firstDay > mark.firstDay)
  );
};

type CoinNeedInput = {
  cryptoCurrencies: CryptoCurrency[];
  lastBackfilledDayByCurrency: Partial<Record<Currency, number>>;
  firstBackfilledDayByCurrency: Partial<Record<Currency, number>>;
  knownEmpty: ReadonlySet<Currency>;
  settled: SettledHistory;
  today: number;
  requestedStart: number;
};

/**
 * The held coins this run asks CoinGecko about, in code order. A coin is asked about when its own
 * last stored day is before the day the run fills (never stored counts as behind), or when it
 * lacks days at the start of the span (`seriesMissesEarlierDays`: the span moved earlier, or a
 * restore brought rows that start late), unless the coin is already known to have no data. Each
 * coin is decided from its own stored rows and its own mark, so a span that moves earlier asks
 * only the coins that miss days. A coin with no known first day counts as complete there.
 */
const coinsNeedingHistory = (input: CoinNeedInput): CryptoCurrency[] =>
  input.cryptoCurrencies
    .filter((coin) => {
      const lastDay = input.lastBackfilledDayByCurrency[coin];
      const missesTop = lastDay === undefined || lastDay < input.today;

      return (
        !input.knownEmpty.has(coin) &&
        (missesTop ||
          seriesMissesEarlierDays(
            input.settled[coin],
            input.firstBackfilledDayByCurrency[coin],
            input.requestedStart,
          ))
      );
    })
    .sort();

/** CoinGecko's free tier serves 365 days: today and the 364 before it. */
const WINDOW_DAYS_BEFORE_TODAY = 364;

/** The first day a run asks a coin for: the span's start, but never before the window. */
const requestedStartOf = (spanStart: number, today: number): number =>
  Math.max(spanStart, today - WINDOW_DAYS_BEFORE_TODAY * DAY_MS);

/** The first day the span asks a currency for: coins stop at the free tier's window. */
const requestStartOf = (currency: Currency, spanStart: number, today: number): number =>
  isCrypto(currency) ? requestedStartOf(spanStart, today) : spanStart;

/**
 * How long an empty answer holds. A provider that has nothing for a currency today may start
 * quoting it later (NBU adds currencies, CoinGecko lists coins), so the answer is read again
 * after this many days, once, and stamped again: at most one request per currency per period.
 */
const EMPTY_MARK_HOLDS_DAYS = 7;

/**
 * The currencies a mark says have nothing to fetch for this span: a currency with no stored rows
 * the provider answered with nothing, from a start at or before this one, within the last
 * `EMPTY_MARK_HOLDS_DAYS` days. A currency with rows is never empty (a later answer gave them),
 * and an empty mark with no check day has expired.
 */
const markedEmptyCurrencies = (
  settled: SettledHistory,
  deps: Pick<BackfillDeps, 'earliestDay' | 'firstBackfilledDayByCurrency'>,
  today: number,
): Currency[] =>
  (Object.keys(settled) as Currency[]).filter((currency) => {
    const mark = settled[currency];

    return (
      mark !== undefined &&
      mark.firstDay === null &&
      mark.checkedOn !== undefined &&
      // A check day after today (the clock moved back) is expired, not held for weeks.
      today >= mark.checkedOn &&
      today - mark.checkedOn < EMPTY_MARK_HOLDS_DAYS * DAY_MS &&
      deps.firstBackfilledDayByCurrency?.[currency] === undefined &&
      requestStartOf(currency, toUtcMidnight(deps.earliestDay), today) >= mark.start
    );
  });

/**
 * Whether a held coin or fiat currency lacks days at the start of the span, judged from the whole
 * span and not from the resume day: a run cut short by a provider failure or the rate limit
 * leaves the last stored day at today, so after a restart the resume day alone would call the
 * window empty and never fill those days.
 */
const anySeriesMissesEarlierDays = (
  deps: BackfillDeps,
  input: {
    held: Currency[];
    knownEmpty: ReadonlySet<Currency>;
    settled: SettledHistory;
    today: number;
  },
): boolean =>
  input.held.some(
    (currency) =>
      !input.knownEmpty.has(currency) &&
      seriesMissesEarlierDays(
        input.settled[currency],
        deps.firstBackfilledDayByCurrency?.[currency],
        requestStartOf(currency, toUtcMidnight(deps.earliestDay), input.today),
      ),
  );

const readSettledOrEmpty = async (deps: BackfillDeps): Promise<SettledHistory> =>
  bifoldr(await either<unknown, SettledHistory>(deps.readSettledHistory ?? readStoredSettled)) ??
  {};

/** The mark a currency's answer earns, or undefined when it earns none. */
const markOf = (
  answerDays: number[],
  requestedStart: number,
  existing: SettledMark | undefined,
  context: { storedFirstDay: number | undefined; today: number },
): SettledMark | undefined => {
  const firstDay = answerDays.length === 0 ? null : minOf(answerDays);

  // An empty answer is a mark only for a currency with no rows, stamped with the day it was read.
  if (firstDay === null) {
    return context.storedFirstDay !== undefined ||
      (existing?.checkedOn === context.today && existing.start <= requestedStart)
      ? undefined
      : { start: requestedStart, firstDay: null, checkedOn: context.today };
  }

  // An answer that reaches the start settles nothing. It still overwrites a stored mark, which
  // would otherwise keep calling the start earlier than the one it settled for.
  if (firstDay !== null && firstDay <= requestedStart && existing === undefined) {
    return undefined;
  }

  return existing !== undefined &&
    existing.firstDay === firstDay &&
    existing.start <= requestedStart
    ? undefined
    : { start: requestedStart, firstDay };
};

const answerDaysOf = (entries: HistoryRateEntry[], currency: Currency): number[] =>
  entries.filter((entry) => entry.base === currency).map((entry) => entry.day);

/**
 * The marks a run earns: a currency whose provider answered, from the very start of the span,
 * with a first day after that start (a currency or coin listed late, or a long gap), or with
 * nothing at all, has no earlier day to give. Only a run whose request began at the span start
 * can say so, and only for a currency whose own request did not fail.
 */
const earnedMarks = (
  deps: BackfillDeps,
  input: {
    nbuResult: PromiseSettledResult<NbuHistory>;
    fiatRequested: Currency[];
    cryptoResult: PromiseSettledResult<CryptoHistory>;
    cryptoRequested: CryptoCurrency[];
    settled: SettledHistory;
    spanStart: number;
    today: number;
  },
): SettledHistory => {
  const earnings: SettledHistory = {};
  const spanStart = toUtcMidnight(deps.earliestDay);

  if (input.nbuResult.status === 'fulfilled' && input.spanStart <= spanStart) {
    const { entries, failedCurrencies } = input.nbuResult.value;

    for (const currency of input.fiatRequested.filter((code) => !failedCurrencies.includes(code))) {
      earnings[currency] = markOf(
        answerDaysOf(entries, currency),
        spanStart,
        input.settled[currency],
        { storedFirstDay: deps.firstBackfilledDayByCurrency?.[currency], today: input.today },
      );
    }
  }

  const coinStart = requestedStartOf(spanStart, input.today);

  if (input.cryptoResult.status === 'fulfilled' && input.spanStart <= coinStart) {
    const { entries, failedCurrencies } = input.cryptoResult.value;

    for (const coin of input.cryptoRequested.filter((code) => !failedCurrencies.includes(code))) {
      earnings[coin] = markOf(answerDaysOf(entries, coin), coinStart, input.settled[coin], {
        storedFirstDay: deps.firstBackfilledDayByCurrency?.[coin],
        today: input.today,
      });
    }
  }

  return Object.fromEntries(
    Object.entries(earnings).filter(([, mark]) => mark !== undefined),
  ) as SettledHistory;
};

// Saved AFTER the rows are stored: a mark that outlived a failed write would call a currency
// settled while its rows are missing. A mark that cannot be saved costs only one more request.
const saveEarnedMarks = async (deps: BackfillDeps, earned: SettledHistory): Promise<void> => {
  if (Object.keys(earned).length > 0) {
    const write = deps.writeSettledHistory ?? writeStoredSettled;

    await logOnFailure('[history backfill] settled marks not saved', () => write(earned));
  }
};

const readCursorOrNull = async (readCursor: () => Promise<string | null>): Promise<string | null> =>
  bifoldr(await either<unknown, string | null>(readCursor)) ?? null;

type CryptoPlan = {
  requested: CryptoCurrency[];
  storedCursor: string | null;
};

/** Which coins this run requests, in request order, and the cursor that order started from. */
const planCryptoRequests = async (
  deps: BackfillDeps,
  input: {
    cryptoCurrencies: CryptoCurrency[];
    lastBackfilledDayByCurrency: Partial<Record<Currency, number>>;
    knownEmpty: ReadonlySet<Currency>;
    settled: SettledHistory;
    today: number;
    spanStart: number;
  },
): Promise<CryptoPlan> => {
  const needing = coinsNeedingHistory({
    ...input,
    firstBackfilledDayByCurrency: deps.firstBackfilledDayByCurrency ?? {},
    requestedStart: requestedStartOf(input.spanStart, input.today),
  });
  const storedCursor =
    needing.length > 0
      ? await readCursorOrNull(deps.readHistoryBackfillCursor ?? readStoredCursor)
      : null;

  return { requested: rotatedFrom(needing, storedCursor), storedCursor };
};

// A cursor that cannot be saved costs only the rotation (the next run starts where this one
// did), never the rows this run composed.
const saveNextCursor = async (
  deps: BackfillDeps,
  plan: CryptoPlan,
  cryptoResult: PromiseSettledResult<CryptoHistory>,
): Promise<void> => {
  const cursor = nextCursor(plan.requested, cryptoResult);

  if (plan.requested.length > 0 && cursor !== plan.storedCursor) {
    const writeCursor = deps.writeHistoryBackfillCursor ?? writeStoredCursor;

    await logOnFailure('[history backfill] cursor not saved', () => writeCursor(cursor));
  }
};

/** The coins from the first one at or after `cursor`, wrapping to the ones before it. */
const rotatedFrom = (coins: CryptoCurrency[], cursor: string | null): CryptoCurrency[] => {
  const start = cursor === null ? -1 : coins.findIndex((coin) => coin >= cursor);

  return start <= 0 ? coins : [...coins.slice(start), ...coins.slice(0, start)];
};

/**
 * The coin the next run starts with: the first of `requested`, in request order, that CoinGecko
 * rate-limited (HTTP 429). With none rate-limited, null. When the whole leg failed it is the first
 * rate-limited coin the failure names, or the unchanged start when none was.
 *
 * This is what bounds the wait. CoinGecko's free tier answers 429 after a short burst, so a run
 * gets through only the first L coins of its order, and every coin after them is rate-limited.
 * Starting the next run at the first rate-limited coin makes every run answer the next L coins of
 * one fixed cyclic order (a coin that fails by itself, a 404 for instance, takes a request but
 * never the cursor). Take the coins that have not yet been answered: they are a block that starts
 * at the cursor, and each run answers at least L of them, so every held coin is answered within
 * ceil(n / L) runs, even when the coins before it never gain a row and stay behind forever.
 */
const nextCursor = (
  requested: CryptoCurrency[],
  cryptoResult: PromiseSettledResult<CryptoHistory>,
): string | null => {
  if (cryptoResult.status === 'rejected') {
    const { reason } = cryptoResult;
    const rateLimited = reason instanceof CryptoHistoryFailure ? reason.rateLimitedCurrencies : [];

    return requested.find((coin) => rateLimited.includes(coin)) ?? requested[0] ?? null;
  }

  const { rateLimitedCurrencies } = cryptoResult.value;

  return requested.find((coin) => rateLimitedCurrencies.includes(coin)) ?? null;
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

/** Every currency's own first stored day, keyed like `deriveLastBackfilledDayByCurrency`. */
export const deriveFirstBackfilledDayByCurrency = (
  rows: Pick<CurrencyRateHistoryRow, 'base' | 'day'>[],
): Partial<Record<Currency, number>> => {
  const days: Partial<Record<Currency, number>> = {};

  for (const row of rows) {
    const current = days[row.base];

    if (current === undefined || row.day < current) {
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
 * where. It runs when it has never run (`ranForSpanStart === null`), when
 * `spanStart` has moved strictly EARLIER than a prior run covered — an older
 * transaction appeared mid-session, opening a gap BELOW the newest stored day
 * — or when `currenciesChanged` (a new currency is held now that was not
 * covered by the run this span already ran for — the caller derives this from
 * its own held-currency key, e.g. a GBP holding added while Statistics stays
 * mounted). On the earlier-extension case it resumes from `null` so
 * `missingDays` recomputes the WHOLE span from `spanStart` (the idempotent
 * upsert skips the already-stored newer days); `missingDays`' forward cursor
 * resumes ABOVE the newest stored day and structurally cannot see the
 * freshly-opened earlier gap otherwise. A first, forward run — including one
 * triggered only by `currenciesChanged` — keeps the incremental
 * `lastBackfilledDay` resume, so `runBackfill`'s own per-currency cursor
 * widens the window for the new currency without redoing an already-current
 * one.
 */
export const planBackfillRun = (
  spanStart: number,
  ranForSpanStart: number | null,
  lastBackfilledDay: number | null,
  currenciesChanged: boolean,
): { run: boolean; resumeFrom: number | null } => {
  if (ranForSpanStart === null) {
    return { run: true, resumeFrom: lastBackfilledDay };
  }

  if (spanStart < ranForSpanStart) {
    return { run: true, resumeFrom: null };
  }

  if (currenciesChanged) {
    return { run: true, resumeFrom: lastBackfilledDay };
  }

  return { run: false, resumeFrom: null };
};

/**
 * Choose the stored source for a currency's own `X:UAH` row — crypto comes from CoinGecko, except
 * a coin whose own `X:UAH` series came from Binance's public market data.
 */
const pairSource = (
  base: Currency,
  timelines: Map<string, HistoryRateEntry[]>,
): NewHistoryRow['source'] => {
  if (!isCrypto(base)) {
    return 'nbu';
  }

  return timelines.get(`${base}:UAH`)?.at(0)?.source === 'binance' ? 'binance' : 'coingecko';
};

/** Each currency's value expressed in UAH — the pivot for composing pairs. */
type UahPrice = Partial<Record<Currency, number>>;

/**
 * Build the UAH pivot for `day` from the anchor timelines: every fiat currency
 * with its OWN `X:UAH` anchor prices directly — the compose list is
 * data-driven, read straight off whichever `X:UAH` timelines are present —
 * and every crypto through its own `X:USD` timeline times the resolved `USD`
 * price, so a crypto pair stays consistent with fiat even when USD itself is
 * not held.
 */
const uahPriceAt = (timelines: Map<string, HistoryRateEntry[]>, day: number): UahPrice => {
  const price: UahPrice = { UAH: 1 };

  for (const timeline of timelines.values()) {
    const anchor = timeline[0];

    if (anchor === undefined || anchor.quote !== 'UAH') {
      continue;
    }

    const rate = nearestAtOrBefore(timeline, day);

    if (rate !== undefined) {
      price[anchor.base] = rate;
    }
  }

  const usd = price.USD;

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
 * Compose one `X:UAH` row per priced currency (every fiat NBU answered for,
 * plus every crypto) for each target day from the day's UAH-anchored prices
 * (mirrors the per-run pivot in `rates-refresh.ts`, per historical day instead)
 * — never a cross row between two non-UAH currencies; a cross rate resolves at
 * READ TIME through the UAH pivot (`rateBetween`/`rateTableAt`). A row is
 * emitted only when that day's own price resolves. Rates are stored as
 * strings, never floats.
 */
export const composeHistoryRows = (
  entries: HistoryRateEntry[],
  days: number[],
): NewHistoryRow[] => {
  const timelines = groupTimelines(entries);
  const rows: NewHistoryRow[] = [];

  for (const day of days) {
    const price = uahPriceAt(timelines, day);

    for (const base of Object.keys(price) as Currency[]) {
      if (base === 'UAH') {
        continue;
      }

      const rate = price[base];

      if (rate === undefined) {
        continue;
      }
      rows.push({
        base,
        quote: 'UAH',
        day,
        rate: String(rate),
        source: pairSource(base, timelines),
      });
    }
  }

  return rows;
};

/** The NBU leg, gated on a non-empty fiat set — `NO_NBU_HISTORY` without ever calling `loadNbu`. */
const NO_NBU_HISTORY: NbuHistory = { entries: [], failedCurrencies: [] };

const runNbuLeg = (
  fiatCurrencies: Currency[],
  loadNbu: (currencies: Currency[], start: number, end: number) => Promise<NbuHistory>,
  spanStart: number,
  today: number,
): Promise<NbuHistory> =>
  fiatCurrencies.length > 0
    ? loadNbu(fiatCurrencies, spanStart, today)
    : Promise.resolve(NO_NBU_HISTORY);

/** A crypto leg that requested nothing: no entries, no failed coin. */
const NO_CRYPTO_HISTORY: CryptoHistory = {
  entries: [],
  failedCurrencies: [],
  rateLimitedCurrencies: [],
};

/**
 * The CoinGecko leg, gated on a non-empty held set — no entries without ever calling
 * `loadCrypto`.
 */
const runCryptoLeg = (
  cryptoCurrencies: CryptoCurrency[],
  loadCrypto: (days: number, currencies: CryptoCurrency[]) => Promise<CryptoHistory>,
  cryptoDays: number,
): Promise<CryptoHistory> =>
  cryptoCurrencies.length > 0
    ? loadCrypto(cryptoDays, cryptoCurrencies)
    : Promise.resolve(NO_CRYPTO_HISTORY);

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
  fiatCurrencies: Currency[],
  cryptoCurrencies: CryptoCurrency[],
  lastBackfilledDayByCurrency: Partial<Record<Currency, number>>,
  knownEmpty: ReadonlySet<Currency>,
  callerLastBackfilledDay: number | null,
): { neverBackfilled: Currency[]; resumeFrom: number | null } => {
  // Every currently-held currency this run cares about: every fetched fiat
  // currency plus every held crypto.
  const held: Currency[] = [...fiatCurrencies, ...cryptoCurrencies];
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
 * answered, and never a currency in `failedCurrencies`: NBU and CoinGecko both
 * settle per currency, so one currency's 200 fulfils the leg while another's
 * own request failed. A failed request is a network failure to retry, not an
 * empty answer. A currency that already HAD some rows (merely lagging) is
 * never a candidate here — it keeps retrying every run through
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
 * One outcome rule: every currency this run attempted to resolve but did not,
 * because its OWN provider leg rejected outright, or its own per-currency
 * request failed inside an otherwise-fulfilled leg. A rejected NBU leg
 * (defensive only — the real `fetchNbuHistory` settles per currency and never
 * rejects) fails EVERY fiat currency this run attempted; it also
 * transitively blocks every crypto row (`composeHistoryRows` needs the
 * SAME-run `USD` anchor to price a crypto pair), so nothing further needs to
 * special-case that dependency here — a failed NBU leg alone already leaves
 * every crypto currency out of `composed` too.
 */
const unresolvedFailures = (
  fiatCurrencies: Currency[],
  nbuResult: PromiseSettledResult<NbuHistory>,
  nbu: NbuHistory,
  cryptoCurrencies: CryptoCurrency[],
  cryptoResult: PromiseSettledResult<CryptoHistory>,
  crypto: CryptoHistory,
  composed: ReadonlySet<Currency>,
): Currency[] => {
  const failed: Currency[] = [
    ...(nbuResult.status === 'rejected' ? fiatCurrencies : nbu.failedCurrencies),
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
  fiatCurrencies: Currency[],
  cryptoCurrencies: CryptoCurrency[],
  neverBackfilled: Currency[],
  days: number[],
  nbuResult: PromiseSettledResult<NbuHistory>,
  cryptoResult: PromiseSettledResult<CryptoHistory>,
  knownEmpty: Set<Currency>,
): { rows: NewHistoryRow[]; failures: Currency[] } => {
  const nbu = nbuResult.status === 'fulfilled' ? nbuResult.value : NO_NBU_HISTORY;
  const crypto = cryptoResult.status === 'fulfilled' ? cryptoResult.value : NO_CRYPTO_HISTORY;
  const rows = composeHistoryRows([...nbu.entries, ...crypto.entries], days);

  recordKnownEmpty(
    [nbuResult, cryptoResult],
    neverBackfilled,
    rows,
    [...nbu.failedCurrencies, ...crypto.failedCurrencies],
    knownEmpty,
  );

  const composed = new Set(rows.map((row) => row.base));
  const failures = unresolvedFailures(
    fiatCurrencies,
    nbuResult,
    nbu,
    cryptoCurrencies,
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
 * partial success (e.g. one fiat currency succeeded while another failed) is
 * never re-fetched on retry.
 */
export const runBackfill = async (deps: BackfillDeps): Promise<BackfillStatus> => {
  const today = toUtcMidnight(deps.today ?? Date.now());
  const lastBackfilledDay = deps.lastBackfilledDay ?? null;

  const historyCurrencies = deps.historyCurrencies ?? defaultHistoryCurrencies;
  const { fiatCurrencies, cryptoCurrencies } = await historyCurrencies();

  // kiko-architecture: no request or query for data the user does not have —
  // no fiat currency needs converting and no crypto held, means neither leg
  // has anything to fetch this run.
  if (fiatCurrencies.length === 0 && cryptoCurrencies.length === 0) {
    return { state: 'complete', lastDay: lastBackfilledDay };
  }

  const sessionKnownEmpty = deps.knownEmptyCurrencies ?? knownEmptyCurrenciesThisRun;
  const settled = await readSettledOrEmpty(deps);
  // A currency a stored mark says the provider has nothing for is as empty as one found empty
  // this session, and it survives a restart.
  const knownEmpty = new Set<Currency>([
    ...sessionKnownEmpty,
    ...markedEmptyCurrencies(settled, deps, today),
  ]);
  const lastBackfilledDayByCurrency = deps.lastBackfilledDayByCurrency ?? {};
  const { neverBackfilled, resumeFrom } = resolveBackfillWindow(
    fiatCurrencies,
    cryptoCurrencies,
    lastBackfilledDayByCurrency,
    knownEmpty,
    lastBackfilledDay,
  );

  const wholeSpan = anySeriesMissesEarlierDays(deps, {
    held: [...fiatCurrencies, ...cryptoCurrencies],
    knownEmpty,
    settled,
    today,
  });
  const days = missingDays(deps.earliestDay, wholeSpan ? null : resumeFrom, today);

  if (days.length === 0) {
    return { state: 'complete', lastDay: lastBackfilledDay };
  }

  const loadNbu =
    deps.fetchNbuHistory ?? ((currencies, start, end) => fetchNbuHistory(currencies, start, end));
  const loadCrypto =
    deps.fetchCryptoHistory ??
    ((count, currencies) => fetchCryptoHistory(count, fetch, currencies));
  const upsertMany = deps.upsertMany ?? rateHistoryRepo.upsertMany;

  const spanStart = days[0];
  const cryptoDays = Math.ceil((today - spanStart) / DAY_MS) + 1;
  // A currency already known-empty this run has nothing left for NBU to
  // answer differently — sending it again would re-request the same empty
  // range on every single run for as long as Statistics stays mounted.
  const fiatCurrenciesToFetch = fiatCurrencies.filter((currency) => !knownEmpty.has(currency));
  const cryptoPlan = await planCryptoRequests(deps, {
    cryptoCurrencies,
    lastBackfilledDayByCurrency,
    knownEmpty,
    settled,
    today,
    spanStart,
  });
  const cryptoRequested = cryptoPlan.requested;
  // Settle the two providers independently: CoinGecko's free tier can 401 a
  // long crypto span, and an all-or-nothing `Promise.all` would then discard the
  // NBU fiat rates too. Whichever source succeeds still contributes its anchors.
  // Each leg is ALSO gated individually on `historyCurrencies`'s own verdict: a
  // leg with nothing to convert/hold resolves to its own empty shape without
  // ever calling its fetch function.
  const [nbuResult, coinGeckoResult] = await Promise.allSettled([
    runNbuLeg(fiatCurrenciesToFetch, loadNbu, spanStart, today),
    runCryptoLeg(cryptoRequested, loadCrypto, cryptoDays),
  ]);
  const cryptoResult = await withBinanceFallback({
    requested: cryptoRequested,
    nbuResult,
    cryptoResult: coinGeckoResult,
    range: { start: requestedStartOf(spanStart, today), end: today },
    loadNbu,
    client: deps.binanceMarket,
  });

  const { rows, failures } = composeAndClassify(
    fiatCurrencies,
    cryptoRequested,
    neverBackfilled,
    days,
    nbuResult,
    cryptoResult,
    sessionKnownEmpty,
  );

  if (rows.length > 0) {
    await upsertMany(rows);
  }

  // After the rows are stored: neither the cursor nor a mark then runs ahead of rows that were
  // lost with a failed write.
  await saveNextCursor(deps, cryptoPlan, cryptoResult);
  await saveEarnedMarks(
    deps,
    earnedMarks(deps, {
      nbuResult,
      fiatRequested: fiatCurrenciesToFetch,
      // A mark says what the provider has no earlier day for. Binance's first candle says nothing
      // of CoinGecko's days, so a coin CoinGecko failed earns none, however Binance priced it.
      cryptoResult: coinGeckoResult,
      cryptoRequested,
      settled,
      spanStart,
      today,
    }),
  );

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
