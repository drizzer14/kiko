import { holdingsRepo } from '@kiko/holdings/repo';

import type { HoldingRow, PricePointRow } from '../../db/schema';
import { asMetalMeta, type Metal } from '../../holdings/holding-metadata';
import { fetchNbuMetalHistory, fetchNbuMetalsCurrent, type NbuMetalRate } from '../nbu-metals';
import { dayKeyOf } from '../price-book';
import { metalInstrument } from '../instrument';
import { pricePointsRepo } from '../price-points-repo';

type HeldHolding = Pick<HoldingRow, 'type' | 'metadata'>;
type StoredPoint = Pick<PricePointRow, 'instrument' | 'day'>;
type NewPricePointRow = Pick<PricePointRow, 'instrument' | 'day' | 'price' | 'currency' | 'source'>;
type FetchCurrent = (fetchImpl: typeof fetch) => Promise<NbuMetalRate[]>;
type FetchHistory = (
  metal: Metal,
  start: number,
  end: number,
  fetchImpl: typeof fetch,
) => Promise<{ metal: Metal; day: number; price: string }[]>;

export type MetalRefreshDeps = {
  now?: () => number;
  fetchImpl?: typeof fetch;
  listHoldings?: () => Promise<HeldHolding[]>;
  loadPoints?: () => Promise<StoredPoint[]>;
  fetchCurrent?: FetchCurrent;
  fetchHistory?: FetchHistory;
  upsertMany?: (rows: NewPricePointRow[]) => Promise<void>;
};

/**
 * The earliest lot day per held metal, across every `metal` holding —
 * `Math.min` over each holding's own `metadata.lots` days, folded across
 * every holding of the same metal so two separate metal holdings of the
 * same metal still resolve to the single earliest day between them. A
 * `metal` holding with invalid metadata or no lots contributes nothing (it
 * has no day to backfill from).
 */
const earliestLotDayByMetal = (holdings: readonly HeldHolding[]): Map<Metal, number> => {
  const days = new Map<Metal, number>();

  for (const holding of holdings) {
    if (holding.type !== 'metal') {
      continue;
    }

    const meta = asMetalMeta(holding.metadata);

    if (meta === null || meta.lots.length === 0) {
      continue;
    }

    const earliestDay = Math.min(...meta.lots.map((lot) => lot.day));
    const existing = days.get(meta.metal);

    if (existing === undefined || earliestDay < existing) {
      days.set(meta.metal, earliestDay);
    }
  }

  return days;
};

/** The most recent stored `price_points.day` per `metal:<X>` instrument. */
const lastStoredDayByMetal = (points: readonly StoredPoint[]): Map<Metal, number> => {
  const days = new Map<Metal, number>();

  for (const point of points) {
    if (!point.instrument.startsWith('metal:')) {
      continue;
    }

    const metal = point.instrument.slice('metal:'.length) as Metal;
    const existing = days.get(metal);

    if (existing === undefined || point.day > existing) {
      days.set(metal, point.day);
    }
  }

  return days;
};

const toRow = (metal: Metal, day: number, price: string): NewPricePointRow => ({
  instrument: metalInstrument(metal),
  day,
  price,
  currency: 'UAH',
  source: 'nbu',
});

/**
 * Splits today's held metals into two disjoint work lists: `backfill` (never
 * priced yet — needs the full range fetch from its earliest lot day) and
 * `current` (already has an earlier point — needs only today's single row).
 * A metal already refreshed today (`lastStoredDay >= today`) is dropped
 * entirely — no fetch for it this run.
 */
const planRefresh = (
  earliestDays: ReadonlyMap<Metal, number>,
  lastStoredDays: ReadonlyMap<Metal, number>,
  today: number,
): { backfill: { metal: Metal; earliestLotDay: number }[]; current: Metal[] } => {
  const backfill: { metal: Metal; earliestLotDay: number }[] = [];
  const current: Metal[] = [];

  for (const [metal, earliestLotDay] of earliestDays) {
    const lastStoredDay = lastStoredDays.get(metal);

    if (lastStoredDay !== undefined && lastStoredDay >= today) {
      continue;
    }

    if (lastStoredDay === undefined) {
      backfill.push({ metal, earliestLotDay });
    } else {
      current.push(metal);
    }
  }

  return { backfill, current };
};

/** One `fetchHistory` range call per metal needing a backfill, flattened to rows. */
const backfillRows = async (
  backfill: { metal: Metal; earliestLotDay: number }[],
  today: number,
  fetchHistory: FetchHistory,
  fetchImpl: typeof fetch,
): Promise<NewPricePointRow[]> => {
  const rows: NewPricePointRow[] = [];

  for (const { metal, earliestLotDay } of backfill) {
    const history = await fetchHistory(metal, earliestLotDay, today, fetchImpl);

    for (const point of history) {
      rows.push(toRow(point.metal, point.day, point.price));
    }
  }

  return rows;
};

/** ONE shared `fetchCurrent` call for every metal needing today's point, matched by metal. */
const currentRows = async (
  metals: Metal[],
  fetchCurrent: FetchCurrent,
  fetchImpl: typeof fetch,
  today: number,
): Promise<NewPricePointRow[]> => {
  if (metals.length === 0) {
    return [];
  }

  const current = await fetchCurrent(fetchImpl);

  return metals.flatMap((metal) => {
    const rate = current.find((entry) => entry.metal === metal);

    return rate === undefined ? [] : [toRow(metal, today, rate.price)];
  });
};

/**
 * Refreshes `price_points` for every currently HELD precious metal
 * (`metal` holdings only — never a metal nobody owns), at most once per
 * LOCAL day per metal. A metal with no stored price point yet is
 * backfilled from its earliest lot day to today via `fetchNbuMetalHistory`
 * (one range call); an already-priced metal instead takes one shared
 * `fetchNbuMetalsCurrent` call for today's point. Every row is accumulated
 * in memory and written through ONE final `upsertMany` call — a fetch
 * failure for any held metal rejects before that call is reached, so this
 * never partially writes; the callers wrap this the same way they already
 * wrap `refreshRates`, so the failure is swallowed there, not here.
 */
export const refreshMetalPrices = async (deps: MetalRefreshDeps = {}): Promise<void> => {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const listHoldings = deps.listHoldings ?? (() => holdingsRepo.allQuery());
  const loadPoints = deps.loadPoints ?? (() => pricePointsRepo.allQuery());
  const fetchCurrent = deps.fetchCurrent ?? fetchNbuMetalsCurrent;
  const fetchHistory = deps.fetchHistory ?? fetchNbuMetalHistory;
  const upsertMany = deps.upsertMany ?? pricePointsRepo.upsertMany;

  const [holdings, points] = await Promise.all([listHoldings(), loadPoints()]);
  const earliestDays = earliestLotDayByMetal(holdings);

  if (earliestDays.size === 0) {
    return;
  }

  const today = dayKeyOf(now());
  const plan = planRefresh(earliestDays, lastStoredDayByMetal(points), today);
  const rows = [
    ...(await backfillRows(plan.backfill, today, fetchHistory, fetchImpl)),
    ...(await currentRows(plan.current, fetchCurrent, fetchImpl, today)),
  ];

  if (rows.length > 0) {
    await upsertMany(rows);
  }
};
