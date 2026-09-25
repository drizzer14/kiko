import { rateHistoryRepo } from '@kiko/rates/rate-history-repo';

import { fetchNbuHistory } from '../nbu-history';
import { fetchCryptoHistory } from '../coingecko-history';
import type { CurrencyRateHistoryRow } from '../../db/schema';
import { type HistoryRateEntry, toUtcMidnight } from '../history-entry';
import { type Currency, currencyOptions, isCrypto } from '../../currency/currency';

const DAY_MS = 24 * 60 * 60 * 1000;

// The fiat anchors NBU quotes (USD/EUR against UAH) plus every crypto, derived
// from currency.ts so a newly added crypto composes chart history automatically.
const allCurrencies: Currency[] = ['USD', 'EUR', 'UAH', ...currencyOptions.filter(isCrypto)];

/** A row ready for `rateHistoryRepo.upsertMany` (rate stored as text). */
type NewHistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate' | 'source'>;

/**
 * Progress the Statistics screen can surface for the historical line chart.
 * `runBackfill` itself only ever resolves to `idle`/`loading`/`complete` — a
 * rejected run stays a rejected promise. `'failed'` is set by the screen's own
 * catch arm, so a network failure is never mistaken for a finished backfill.
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
  fetchCryptoHistory?: (days: number) => Promise<HistoryRateEntry[]>;
  upsertMany?: (rows: NewHistoryRow[]) => Promise<void>;
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

/** Choose the stored source for a composed pair — crypto legs come from CoinGecko. */
const pairSource = (base: Currency, quote: Currency): NewHistoryRow['source'] =>
  isCrypto(base) || isCrypto(quote) ? 'coingecko' : 'nbu';

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
 * Compose every ordered cross pair among the priced currencies (USD/EUR/UAH plus
 * every crypto) for each target day from the day's UAH-anchored prices (mirrors
 * the per-current-day pivot in
 * `rates-refresh.ts`, per historical day). A pair is emitted only when both
 * currencies are priced for that day. Rates are stored as strings, never floats.
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
      for (const quote of allCurrencies) {
        const from = price[base];
        const to = price[quote];
        if (base === quote || from === undefined || to === undefined) {
          continue;
        }
        rows.push({ base, quote, day, rate: String(from / to), source: pairSource(base, quote) });
      }
    }
  }
  return rows;
};

/**
 * Run one incremental pass: compute the still-missing days, fetch the fiat range
 * from NBU and every crypto's series from CoinGecko for that span, compose every
 * cross pair per day, and upsert them. Idempotent (upsert on the pair-day index) and
 * resumable — a fresh call picks up wherever `lastBackfilledDay` leaves off.
 * Returns a terminal `complete` status the screen can render.
 */
export const runBackfill = async (deps: BackfillDeps): Promise<BackfillStatus> => {
  const today = toUtcMidnight(deps.today ?? Date.now());
  const lastBackfilledDay = deps.lastBackfilledDay ?? null;
  const days = missingDays(deps.earliestDay, lastBackfilledDay, today);
  if (days.length === 0) {
    return { state: 'complete', lastDay: lastBackfilledDay };
  }

  const loadNbu = deps.fetchNbuHistory ?? ((start, end) => fetchNbuHistory(start, end));
  const loadCrypto = deps.fetchCryptoHistory ?? ((count) => fetchCryptoHistory(count));
  const upsertMany = deps.upsertMany ?? rateHistoryRepo.upsertMany;

  const spanStart = days[0];
  const cryptoDays = Math.ceil((today - spanStart) / DAY_MS) + 1;
  // Settle the two providers independently: CoinGecko's free tier can 401 a
  // long crypto span, and an all-or-nothing `Promise.all` would then discard the
  // NBU fiat rates too. Whichever source succeeds still contributes its anchors.
  const [nbuResult, cryptoResult] = await Promise.allSettled([
    loadNbu(spanStart, today),
    loadCrypto(cryptoDays),
  ]);
  const nbu = nbuResult.status === 'fulfilled' ? nbuResult.value : [];
  const crypto = cryptoResult.status === 'fulfilled' ? cryptoResult.value : [];

  const rows = composeHistoryRows([...nbu, ...crypto], days);
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
