import maybe, { foldMap } from 'fnts/maybe';
import { holdingsRepo } from '@kiko/holdings/repo';

import { dayKeyOf } from '../price-book';
import { metalInstrument } from '../instrument';
import { pricePointsRepo } from '../price-points-repo';
import type { HoldingRow, PricePointRow } from '../../db/schema';
import { asMetalMeta, type Metal } from '../../holdings/holding-metadata';
import { fetchNbuMetalHistory, fetchNbuMetalsCurrent, type NbuMetalRate } from '../nbu-metals';

const DAY_MS = 24 * 60 * 60 * 1000;

type HeldHolding = Pick<HoldingRow, 'type' | 'metadata'>;
type StoredPoint = Pick<PricePointRow, 'instrument' | 'day'>;
/** One metal's stored `price_points` span: its earliest and latest stored day. */
type MetalStoredRange = { firstStoredDay: number; lastStoredDay: number };
/** One `fetchHistory` call to make: a metal's own missing `[start, end]` span. */
type MetalRange = { metal: Metal; start: number; end: number };
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

/** The earliest AND most recent stored `price_points.day` per `metal:<X>` instrument. */
const storedRangeByMetal = (points: readonly StoredPoint[]): Map<Metal, MetalStoredRange> => {
  const ranges = new Map<Metal, MetalStoredRange>();

  for (const point of points) {
    if (!point.instrument.startsWith('metal:')) {
      continue;
    }

    const metal = point.instrument.slice('metal:'.length) as Metal;
    const existing = ranges.get(metal);

    ranges.set(metal, {
      firstStoredDay:
        existing === undefined ? point.day : Math.min(existing.firstStoredDay, point.day),
      lastStoredDay:
        existing === undefined ? point.day : Math.max(existing.lastStoredDay, point.day),
    });
  }

  return ranges;
};

const toRow = (metal: Metal, day: number, price: string): NewPricePointRow => ({
  instrument: metalInstrument(metal),
  day,
  price,
  currency: 'UAH',
  source: 'nbu',
});

/**
 * Splits today's held metals into two disjoint work lists: `backfill` (one
 * `[start, end]` range per missing span — either never priced at all, an
 * earlier lot than anything ever stored, or a multi-day gap since the last
 * stored day) and `current` (already covers back to its earliest lot AND is
 * exactly one day short of today — the cheap single-day case). A metal fully
 * up to date (`lastStoredDay >= today` and no earlier-lot gap) contributes
 * nothing — no fetch for it this run.
 *
 * Mirrors `missingDays`'s forward-cursor idea (`history-backfill.ts`), plus a
 * BACKWARD span: a metal's earliest lot can move earlier than its stored
 * series after the fact (a lot dated before any point ever fetched), and
 * that missing range must still be filled even once "today" is stored — so
 * the earlier-lot check runs unconditionally, never short-circuited by the
 * "already refreshed today" guard (which applies only to the FORWARD gap).
 */
const planRefresh = (
  earliestDays: ReadonlyMap<Metal, number>,
  storedRanges: ReadonlyMap<Metal, MetalStoredRange>,
  today: number,
): { backfill: MetalRange[]; current: Metal[] } => {
  const backfill: MetalRange[] = [];
  const current: Metal[] = [];

  for (const [metal, earliestLotDay] of earliestDays) {
    const stored = storedRanges.get(metal);

    if (stored === undefined) {
      backfill.push({ metal, start: earliestLotDay, end: today });
      continue;
    }

    if (earliestLotDay < stored.firstStoredDay) {
      backfill.push({ metal, start: earliestLotDay, end: stored.firstStoredDay - DAY_MS });
    }

    if (stored.lastStoredDay >= today) {
      continue;
    }

    if (stored.lastStoredDay === today - DAY_MS) {
      current.push(metal);
    } else {
      backfill.push({ metal, start: stored.lastStoredDay + DAY_MS, end: today });
    }
  }

  return { backfill, current };
};

/** One `fetchHistory` range call per missing span, flattened to rows. */
const backfillRows = async (
  ranges: MetalRange[],
  fetchHistory: FetchHistory,
  fetchImpl: typeof fetch,
): Promise<NewPricePointRow[]> => {
  const rows: NewPricePointRow[] = [];

  for (const { metal, start, end } of ranges) {
    const history = await fetchHistory(metal, start, end, fetchImpl);

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

    return foldMap(maybe(rate), (found) => [toRow(metal, today, found.price)]) ?? [];
  });
};

/**
 * Refreshes `price_points` for every currently HELD precious metal
 * (`metal` holdings only — never a metal nobody owns, and INCLUDING a
 * closed holding's own lots: the history chart still needs its pre-close
 * prices), at most once per LOCAL day per metal for the ordinary
 * one-day-forward case. A metal is backfilled via `fetchNbuMetalHistory`
 * (one range call per missing span) whenever it has never been priced, a
 * lot predates its earliest stored point, or more than one day is missing
 * since its last stored point (`planRefresh`, mirroring
 * `history-backfill.ts`'s `missingDays`); an already-fully-covered metal
 * that is short only today's point instead takes one shared
 * `fetchNbuMetalsCurrent` call for that single day. Every row is
 * accumulated in memory and written through ONE final `upsertMany` call —
 * a fetch failure for any held metal rejects before that call is reached,
 * so this never partially writes; the callers wrap this the same way they
 * already wrap `refreshRates`, so the failure is swallowed there, not here.
 */
export const refreshMetalPrices = async (deps: MetalRefreshDeps = {}): Promise<void> => {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const listHoldings = deps.listHoldings ?? (() => holdingsRepo.allQuery());
  const loadPoints = deps.loadPoints ?? (() => pricePointsRepo.allQuery());
  const fetchCurrent = deps.fetchCurrent ?? fetchNbuMetalsCurrent;
  const fetchHistory = deps.fetchHistory ?? fetchNbuMetalHistory;
  const upsertMany = deps.upsertMany ?? pricePointsRepo.upsertMany;

  const holdings = await listHoldings();
  const earliestDays = earliestLotDayByMetal(holdings);

  if (earliestDays.size === 0) {
    return;
  }

  const points = await loadPoints();
  const today = dayKeyOf(now());
  const plan = planRefresh(earliestDays, storedRangeByMetal(points), today);
  const rows = [
    ...(await backfillRows(plan.backfill, fetchHistory, fetchImpl)),
    ...(await currentRows(plan.current, fetchCurrent, fetchImpl, today)),
  ];

  if (rows.length > 0) {
    await upsertMany(rows);
  }
};
