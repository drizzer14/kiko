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
/**
 * One `fetchHistory` call to make: a metal's own missing `[start, end]` span.
 * `isEarlierLotGap` marks the BACKWARD span (a lot dated before the metal's
 * first stored day) — the only span whose `[start, end]` bounds stay fixed
 * across runs while `earliestLotDay` and `firstStoredDay` don't change, so an
 * empty NBU answer for it would otherwise repeat forever (see
 * `emptyBackwardFloorByMetal` below). The ordinary forward gap always ends at
 * "today", which moves every day, so it never needs the same guard.
 */
type MetalRange = { metal: Metal; start: number; end: number; isEarlierLotGap: boolean };
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
  /**
   * Injectable override for `emptyBackwardFloorByMetal` below, so a test can
   * isolate its own map instead of sharing this module's own per-app-run
   * singleton across unrelated test cases. Production never passes this.
   */
  knownEmptyBackwardFloors?: Map<Metal, number>;
};

/**
 * DESIGN CHOICE (deferred item 5): per-app-run, IN-MEMORY floor of the
 * earliest-lot backward range NBU already answered empty, per metal — not a
 * new table/migration. A lot dated before NBU's own metal data starts makes
 * `[earliestLotDay, firstStoredDay - DAY_MS)` a fixed span that can never
 * gain rows, so without this, every refresh re-asks NBU for the exact same
 * empty range forever. This map is forgotten on app restart (a fresh module
 * instance), which is an accepted, bounded cost — at most one wasted call per
 * metal per app session, never more — rather than adding persisted state for
 * a rare, cheap-to-repeat case.
 */
const emptyBackwardFloorByMetal = new Map<Metal, number>();

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
 *
 * `knownEmptyBackwardFloors` skips re-planning a backward span whose start
 * already sits at or past a floor a previous run confirmed empty for that
 * metal (`emptyBackwardFloorByMetal`'s doc comment above) — an EARLIER lot
 * added later (a smaller `earliestLotDay`) still gets planned, since that is
 * a genuinely new, not-yet-attempted span.
 */
const planRefresh = (
  earliestDays: ReadonlyMap<Metal, number>,
  storedRanges: ReadonlyMap<Metal, MetalStoredRange>,
  today: number,
  knownEmptyBackwardFloors: ReadonlyMap<Metal, number>,
): { backfill: MetalRange[]; current: Metal[] } => {
  const backfill: MetalRange[] = [];
  const current: Metal[] = [];

  for (const [metal, earliestLotDay] of earliestDays) {
    const stored = storedRanges.get(metal);

    if (stored === undefined) {
      backfill.push({ metal, start: earliestLotDay, end: today, isEarlierLotGap: false });
      continue;
    }

    const knownEmptyFloor = knownEmptyBackwardFloors.get(metal);

    if (
      earliestLotDay < stored.firstStoredDay &&
      (knownEmptyFloor === undefined || earliestLotDay < knownEmptyFloor)
    ) {
      backfill.push({
        metal,
        start: earliestLotDay,
        end: stored.firstStoredDay - DAY_MS,
        isEarlierLotGap: true,
      });
    }

    if (stored.lastStoredDay >= today) {
      continue;
    }

    if (stored.lastStoredDay === today - DAY_MS) {
      current.push(metal);
    } else {
      backfill.push({
        metal,
        start: stored.lastStoredDay + DAY_MS,
        end: today,
        isEarlierLotGap: false,
      });
    }
  }

  return { backfill, current };
};

/**
 * One `fetchHistory` range call per missing span, flattened to rows. An
 * `isEarlierLotGap` span that comes back with zero rows records its `start`
 * into `knownEmptyBackwardFloors` (widening the floor to the smallest empty
 * `start` seen so far) instead of contributing any rows, so `planRefresh`
 * skips the identical span on the next run.
 */
const backfillRows = async (
  ranges: MetalRange[],
  fetchHistory: FetchHistory,
  fetchImpl: typeof fetch,
  knownEmptyBackwardFloors: Map<Metal, number>,
): Promise<NewPricePointRow[]> => {
  const rows: NewPricePointRow[] = [];

  for (const { metal, start, end, isEarlierLotGap } of ranges) {
    const history = await fetchHistory(metal, start, end, fetchImpl);

    if (isEarlierLotGap && history.length === 0) {
      const existingFloor = knownEmptyBackwardFloors.get(metal);
      knownEmptyBackwardFloors.set(
        metal,
        existingFloor === undefined ? start : Math.min(existingFloor, start),
      );
      continue;
    }

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
  const knownEmptyBackwardFloors = deps.knownEmptyBackwardFloors ?? emptyBackwardFloorByMetal;

  const holdings = await listHoldings();
  const earliestDays = earliestLotDayByMetal(holdings);

  if (earliestDays.size === 0) {
    return;
  }

  const points = await loadPoints();
  const today = dayKeyOf(now());
  const plan = planRefresh(
    earliestDays,
    storedRangeByMetal(points),
    today,
    knownEmptyBackwardFloors,
  );
  const rows = [
    ...(await backfillRows(plan.backfill, fetchHistory, fetchImpl, knownEmptyBackwardFloors)),
    ...(await currentRows(plan.current, fetchCurrent, fetchImpl, today)),
  ];

  if (rows.length > 0) {
    await upsertMany(rows);
  }
};
