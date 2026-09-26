// See `nbu-metals.test.ts`'s header live-probe result — the RANGE
// path applies, so `refreshMetalPrices`'s backfill branch calls
// `fetchNbuMetalHistory` (one range call per metal), and its already-priced
// branch calls `fetchNbuMetalsCurrent` (the shared current-exchange payload).
import type { Metal } from '../../holdings/holding-metadata';
import type { HoldingRow, PricePointRow } from '../../db/schema';
import type { NbuMetalHistoryPoint, NbuMetalRate } from '../nbu-metals';

import { type MetalRefreshDeps, refreshMetalPrices } from './metal-refresh';

const DAY = 24 * 60 * 60 * 1000;

type Row = Pick<PricePointRow, 'instrument' | 'day' | 'price' | 'currency' | 'source'>;
type Holding = Pick<HoldingRow, 'type' | 'metadata'>;
type PointRow = Pick<PricePointRow, 'instrument' | 'day'>;

const metalHolding = (metal: string, lotDays: number[]): Holding => ({
  type: 'metal',
  metadata: {
    metal,
    form: 'bar',
    unit: 'oz',
    purity: '0.999',
    lots: lotDays.map((day) => ({ day, quantityDelta: '1', costMinorUnits: 100 })),
  },
});

// A base set of defaults mirroring `rates-refresh.test.ts`'s `makeDeps`: every
// test overrides only the fields its own scenario cares about, and the
// upserted rows are always captured for assertion.
const makeDeps = (overrides: Partial<MetalRefreshDeps> = {}) => {
  const upserted: Row[] = [];
  const deps: MetalRefreshDeps = {
    now: () => Date.UTC(2026, 8, 24),
    listHoldings: async () => [],
    loadPoints: async () => [],
    fetchCurrent: async (): Promise<NbuMetalRate[]> => [],
    fetchHistory: async (): Promise<NbuMetalHistoryPoint[]> => [],
    upsertMany: async (rows: Row[]) => {
      upserted.push(...rows);
    },
    ...overrides,
  };

  return { deps, upserted };
};

describe('refreshMetalPrices', () => {
  const today = Date.UTC(2026, 8, 24);
  const earliestLotDay = Date.UTC(2026, 8, 1);

  it('backfills a newly held metal from its earliest lot day, writing one point per history row', async () => {
    let historyArgs: [string, number, number] | undefined;
    const history: NbuMetalHistoryPoint[] = [
      { metal: 'XAU', day: earliestLotDay, price: '100000' },
      { metal: 'XAU', day: today, price: '101000' },
    ];
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [metalHolding('XAU', [earliestLotDay])],
      fetchCurrent: async (): Promise<NbuMetalRate[]> => {
        throw new Error('fetchCurrent should not be called for a never-priced metal');
      },
      fetchHistory: async (metal, start, end) => {
        historyArgs = [metal, start, end];

        return history;
      },
    });

    await refreshMetalPrices(deps);

    expect(historyArgs).toEqual(['XAU', earliestLotDay, today]);
    expect(upserted).toEqual([
      {
        instrument: 'metal:XAU',
        day: earliestLotDay,
        price: '100000',
        currency: 'UAH',
        source: 'nbu',
      },
      { instrument: 'metal:XAU', day: today, price: '101000', currency: 'UAH', source: 'nbu' },
    ]);
  });

  it('refreshes an already-priced metal from the current feed, at today’s day key', async () => {
    // The earliest lot day is ALSO the first stored day (no earlier-lot gap):
    // isolates this scenario to the ordinary one-day-forward-gap path.
    const existingPoints: PointRow[] = [
      { instrument: 'metal:XAU', day: earliestLotDay },
      { instrument: 'metal:XAU', day: today - DAY },
    ];
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [metalHolding('XAU', [earliestLotDay])],
      loadPoints: async () => existingPoints,
      fetchCurrent: async (): Promise<NbuMetalRate[]> => [{ metal: 'XAU', price: '101000' }],
      fetchHistory: async (): Promise<NbuMetalHistoryPoint[]> => {
        throw new Error('fetchHistory should not be called for a one-day forward gap');
      },
    });

    await refreshMetalPrices(deps);

    expect(upserted).toEqual([
      { instrument: 'metal:XAU', day: today, price: '101000', currency: 'UAH', source: 'nbu' },
    ]);
  });

  it('skips a metal already refreshed today — no fetch call at all', async () => {
    let fetchCalled = false;
    // A point on the earliest lot day too, so there is no earlier-lot gap left
    // to backfill once today's point is also already stored.
    const existingPoints: PointRow[] = [
      { instrument: 'metal:XAU', day: earliestLotDay },
      { instrument: 'metal:XAU', day: today },
    ];
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [metalHolding('XAU', [earliestLotDay])],
      loadPoints: async () => existingPoints,
      fetchCurrent: async (): Promise<NbuMetalRate[]> => {
        fetchCalled = true;

        return [{ metal: 'XAU', price: '101000' }];
      },
      fetchHistory: async (): Promise<NbuMetalHistoryPoint[]> => {
        fetchCalled = true;

        return [];
      },
    });

    await refreshMetalPrices(deps);

    expect(fetchCalled).toBe(false);
    expect(upserted).toEqual([]);
  });

  it('writes nothing when a held metal has no lots at all (no earliest day to backfill from)', async () => {
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [metalHolding('XAU', [])],
    });

    await refreshMetalPrices(deps);

    expect(upserted).toEqual([]);
  });

  it('writes nothing and makes NO network call when there are no held metal holdings at all', async () => {
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [{ type: 'property_item', metadata: null }],
      fetchCurrent: async (): Promise<NbuMetalRate[]> => {
        throw new Error('fetchCurrent should not be called with no metal holdings');
      },
      fetchHistory: async (): Promise<NbuMetalHistoryPoint[]> => {
        throw new Error('fetchHistory should not be called with no metal holdings');
      },
    });

    await refreshMetalPrices(deps);

    expect(upserted).toEqual([]);
  });

  // Zero-read, not just zero-network: with no metal held at all, the
  // `price_points` read has nothing to gate against either — `listHoldings`
  // must resolve and the `earliestDays.size === 0` gate must fire BEFORE
  // `loadPoints` is ever called, not in parallel with it.
  it('never reads price_points at all when there are no held metal holdings', async () => {
    let pointsRead = false;
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [{ type: 'property_item', metadata: null }],
      loadPoints: async () => {
        pointsRead = true;

        return [];
      },
    });

    await refreshMetalPrices(deps);

    expect(pointsRead).toBe(false);
    expect(upserted).toEqual([]);
  });

  it('writes nothing and makes NO network call when every held metal already has today’s price point', async () => {
    // Measures the app-open write volume for the common steady-state case: a
    // metal refreshed earlier the same local day makes NEITHER a `listHoldings`-
    // driven backfill NOR a `fetchCurrent` call, and the final `upsertMany`
    // never runs at all — the two unconditional reads (`listHoldings`,
    // `loadPoints`) are the only per-app-open cost this run pays.
    // Each metal ALSO has a point on its own earliest lot day (no earlier-lot
    // gap left), so today's stored point is the whole steady-state story.
    const existingPoints: PointRow[] = [
      { instrument: 'metal:XAU', day: earliestLotDay },
      { instrument: 'metal:XAU', day: today },
      { instrument: 'metal:XAG', day: earliestLotDay },
      { instrument: 'metal:XAG', day: today },
    ];
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [
        metalHolding('XAU', [earliestLotDay]),
        metalHolding('XAG', [earliestLotDay]),
      ],
      loadPoints: async () => existingPoints,
      fetchCurrent: async (): Promise<NbuMetalRate[]> => {
        throw new Error('fetchCurrent should not be called — every metal already priced today');
      },
      fetchHistory: async (): Promise<NbuMetalHistoryPoint[]> => {
        throw new Error('fetchHistory should not be called — every metal already priced today');
      },
    });

    await refreshMetalPrices(deps);

    expect(upserted).toEqual([]);
  });

  it('backfills the missing earlier range when a lot predates the stored series', async () => {
    // XAU is stored from 2025-01-01 (and already refreshed today), but a lot
    // dated 2020-06-01 is added — earlier than anything ever stored. The
    // missing earlier range (the new lot day through the day BEFORE the
    // first stored day) must be fetched, even though the metal is otherwise
    // fully up to date.
    const firstStoredDay = Date.UTC(2025, 0, 1);
    const earlierLotDay = Date.UTC(2020, 5, 1);
    let historyArgs: [string, number, number] | undefined;
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [metalHolding('XAU', [earlierLotDay])],
      loadPoints: async () => [
        { instrument: 'metal:XAU', day: firstStoredDay },
        { instrument: 'metal:XAU', day: today },
      ],
      fetchHistory: async (metal, start, end) => {
        historyArgs = [metal, start, end];

        return [{ metal: 'XAU', day: start, price: '50000' }];
      },
      fetchCurrent: async (): Promise<NbuMetalRate[]> => {
        throw new Error('fetchCurrent should not be called — today is already stored');
      },
    });

    await refreshMetalPrices(deps);

    expect(historyArgs).toEqual(['XAU', earlierLotDay, firstStoredDay - DAY]);
    expect(upserted).toEqual([
      {
        instrument: 'metal:XAU',
        day: earlierLotDay,
        price: '50000',
        currency: 'UAH',
        source: 'nbu',
      },
    ]);
  });

  it('fills a multi-day forward gap as ONE range call, not just today', async () => {
    // The last stored day is day 1 and today is day 11: the whole gap
    // (days 2..11) is missing history, not just today's point — a single
    // shared `fetchCurrent` call for "today" alone would silently skip
    // days 2..10 forever.
    const day1 = Date.UTC(2026, 0, 1);
    const day11 = Date.UTC(2026, 0, 11);
    let historyArgs: [string, number, number] | undefined;
    const { deps, upserted } = makeDeps({
      now: () => day11,
      listHoldings: async () => [metalHolding('XAU', [day1])],
      loadPoints: async () => [{ instrument: 'metal:XAU', day: day1 }],
      fetchHistory: async (metal, start, end) => {
        historyArgs = [metal, start, end];

        return [{ metal: 'XAU', day: end, price: '105000' }];
      },
      fetchCurrent: async (): Promise<NbuMetalRate[]> => {
        throw new Error('fetchCurrent should not be called for a multi-day gap');
      },
    });

    await refreshMetalPrices(deps);

    expect(historyArgs).toEqual(['XAU', day1 + DAY, day11]);
    expect(upserted).toEqual([
      { instrument: 'metal:XAU', day: day11, price: '105000', currency: 'UAH', source: 'nbu' },
    ]);
  });

  // A lot dated before NBU's own metal data starts: the backward range
  // [earlierLotDay, firstStoredDay - DAY] will NEVER have any rows. Today is
  // already stored, so only that backward range is ever requested.
  const backwardGapDeps = (
    fetchHistory: MetalRefreshDeps['fetchHistory'],
    knownEmptyBackwardFloors: Map<Metal, number>,
  ) =>
    makeDeps({
      listHoldings: async () => [metalHolding('XAU', [Date.UTC(1990, 0, 1)])],
      loadPoints: async () => [
        { instrument: 'metal:XAU', day: Date.UTC(2025, 0, 1) },
        { instrument: 'metal:XAU', day: today },
      ],
      fetchHistory,
      fetchCurrent: async (): Promise<NbuMetalRate[]> => {
        throw new Error('fetchCurrent should not be called — today is already stored');
      },
      knownEmptyBackwardFloors,
    }).deps;

  it('does not refetch a backward range a previous run already asked for and got empty', async () => {
    // A naive re-plan-every-run would refetch the never-filled range forever.
    let historyCallCount = 0;
    const knownEmptyBackwardFloors = new Map<Metal, number>();
    const deps = backwardGapDeps(async () => {
      historyCallCount += 1;
      return [];
    }, knownEmptyBackwardFloors);

    await refreshMetalPrices(deps);
    expect(historyCallCount).toBe(1);

    // A second, later refresh run reuses the same per-app-run memory and
    // must not ask NBU for the same known-empty range again.
    await refreshMetalPrices(deps);
    expect(historyCallCount).toBe(1);
  });

  // The twin of the rate-history backfill's known-empty set: only an ANSWERED
  // empty backward range is remembered. A failed request is a network failure
  // to retry on the next run, never "NBU has no data before this day".
  it('never records a backward range whose request failed as known-empty, so the next run asks again', async () => {
    let historyCallCount = 0;
    const knownEmptyBackwardFloors = new Map<Metal, number>();
    const deps = backwardGapDeps(async (): Promise<NbuMetalHistoryPoint[]> => {
      historyCallCount += 1;
      throw new Error('NBU request failed: 429');
    }, knownEmptyBackwardFloors);

    await expect(refreshMetalPrices(deps)).rejects.toThrow('429');
    await expect(refreshMetalPrices(deps)).rejects.toThrow('429');

    expect(knownEmptyBackwardFloors.size).toBe(0);
    expect(historyCallCount).toBe(2);
  });

  it('rejects and writes nothing when the underlying fetch fails', async () => {
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [metalHolding('XAU', [earliestLotDay])],
      fetchHistory: async (): Promise<NbuMetalHistoryPoint[]> => {
        throw new Error('NBU request failed: 500');
      },
    });

    await expect(refreshMetalPrices(deps)).rejects.toThrow('500');

    expect(upserted).toEqual([]);
  });
});
