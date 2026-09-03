import type { Currency } from '../currency/currency';
import type { CurrencyRateHistoryRow } from '../db/schema';
import { rateHistoryRepo } from '../repositories/rate-history.repo';
import { fetchBTCHistory } from './coingecko-history';
import { type HistoryRateEntry, toUtcMidnight } from './history-entry';
import { fetchNbuHistory } from './nbu-history';

const DAY_MS = 24 * 60 * 60 * 1000;

const allCurrencies: Currency[] = ['BTC', 'USD', 'EUR', 'UAH'];

/** A row ready for `rateHistoryRepo.upsertMany` (rate stored as text). */
type NewHistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate' | 'source'>;

/** Progress the Statistics screen can surface for the historical line chart. */
export type BackfillStatus = {
  state: 'idle' | 'loading' | 'complete';
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
  fetchBTCHistory?: (days: number) => Promise<HistoryRateEntry[]>;
  upsertMany?: (rows: NewHistoryRow[]) => Promise<void>;
};

/** The maximum stored `day`, i.e. the resume point — null when there is none. */
export const deriveLastBackfilledDay = (
  rows: Pick<CurrencyRateHistoryRow, 'day'>[],
): number | null =>
  rows.reduce<number | null>((max, row) => (max === null || row.day > max ? row.day : max), null);

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

/** Choose the stored source for a composed pair — BTC legs come from CoinGecko. */
const pairSource = (base: Currency, quote: Currency): NewHistoryRow['source'] =>
  base === 'BTC' || quote === 'BTC' ? 'coingecko' : 'nbu';

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
 * directly, BTC through its USD price so BTC pairs stay consistent with fiat.
 */
const uahPriceAt = (timelines: Map<string, HistoryRateEntry[]>, day: number): UahPrice => {
  const price: UahPrice = { UAH: 1 };
  const usd = nearestAtOrBefore(timelines.get('USD:UAH') ?? [], day);
  const eur = nearestAtOrBefore(timelines.get('EUR:UAH') ?? [], day);
  const btcUsd = nearestAtOrBefore(timelines.get('BTC:USD') ?? [], day);
  if (usd !== undefined) {
    price.USD = usd;
  }
  if (eur !== undefined) {
    price.EUR = eur;
  }
  if (btcUsd !== undefined && usd !== undefined) {
    price.BTC = btcUsd * usd;
  }
  return price;
};

/**
 * Compose every ordered cross pair among {BTC,USD,EUR,UAH} for each target day
 * from the day's UAH-anchored prices (mirrors the per-current-day pivot in
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
 * from NBU and the BTC series from CoinGecko for that span, compose every cross
 * pair per day, and upsert them. Idempotent (upsert on the pair-day index) and
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
  const loadBTC = deps.fetchBTCHistory ?? ((count) => fetchBTCHistory(count));
  const upsertMany = deps.upsertMany ?? rateHistoryRepo.upsertMany;

  const spanStart = days[0];
  const btcDays = Math.ceil((today - spanStart) / DAY_MS) + 1;
  const [nbu, btc] = await Promise.all([loadNbu(spanStart, today), loadBTC(btcDays)]);

  const rows = composeHistoryRows([...nbu, ...btc], days);
  if (rows.length > 0) {
    await upsertMany(rows);
  }
  return { state: 'complete', lastDay: today };
};
