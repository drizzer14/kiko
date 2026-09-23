// T19 Step 1 live-probe result: see `nbu-metals.test.ts`'s header — the RANGE
// path applies, so `refreshMetalPrices`'s backfill branch calls
// `fetchNbuMetalHistory` (one range call per metal), and its already-priced
// branch calls `fetchNbuMetalsCurrent` (the shared current-exchange payload).
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
    const existingPoints: PointRow[] = [{ instrument: 'metal:XAU', day: today - DAY }];
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [metalHolding('XAU', [earliestLotDay])],
      loadPoints: async () => existingPoints,
      fetchCurrent: async (): Promise<NbuMetalRate[]> => [{ metal: 'XAU', price: '101000' }],
      fetchHistory: async (): Promise<NbuMetalHistoryPoint[]> => {
        throw new Error('fetchHistory should not be called for an already-priced metal');
      },
    });

    await refreshMetalPrices(deps);

    expect(upserted).toEqual([
      { instrument: 'metal:XAU', day: today, price: '101000', currency: 'UAH', source: 'nbu' },
    ]);
  });

  it('skips a metal already refreshed today — no fetch call at all', async () => {
    let fetchCalled = false;
    const existingPoints: PointRow[] = [{ instrument: 'metal:XAU', day: today }];
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

  it('writes nothing when there are no held metal holdings at all', async () => {
    const { deps, upserted } = makeDeps({
      listHoldings: async () => [{ type: 'property_item', metadata: null }],
    });

    await refreshMetalPrices(deps);

    expect(upserted).toEqual([]);
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
