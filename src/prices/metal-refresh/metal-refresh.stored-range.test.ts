let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import type { HoldingRow, PricePointRow } from '@kiko/db';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { pricePointsRepo } from '../price-points-repo';

import { type MetalRefreshDeps, refreshMetalPrices } from './metal-refresh';

type Holding = Pick<HoldingRow, 'type' | 'metadata'>;
type Row = Pick<PricePointRow, 'instrument' | 'day' | 'price' | 'currency' | 'source'>;

const TODAY = Date.UTC(2026, 8, 24);

const metalHolding = (metal: string, lotDay: number): Holding => ({
  type: 'metal',
  metadata: {
    metal,
    form: 'bar',
    unit: 'oz',
    purity: '0.999',
    lots: [{ day: lotDay, quantityDelta: '1', costMinorUnits: 100 }],
  },
});

const insertDays = (instrument: string, firstDay: number, lastDay: number): void => {
  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    mockDatabase
      .prepare(
        `INSERT INTO price_points (instrument, day, price, currency, source)
         VALUES (?, ?, '1', 'UAH', 'nbu')`,
      )
      .run(instrument, day);
  }
};

// What a run asks NBU for and writes, so two runs can be compared by outcome.
const run = async (overrides: Partial<MetalRefreshDeps>, holdings: Holding[]) => {
  const calls: string[] = [];
  const upserted: Row[] = [];

  await refreshMetalPrices({
    now: () => TODAY,
    listHoldings: async () => holdings,
    fetchCurrent: async () => {
      calls.push('current');

      return [
        { metal: 'XAU', price: '101000' },
        { metal: 'XAG', price: '900' },
      ];
    },
    fetchHistory: async (metal, start, end) => {
      calls.push(`history ${metal} ${start} ${end}`);

      return [{ metal, day: end, price: '5' }];
    },
    upsertMany: async (rows: Row[]) => {
      upserted.push(...rows);
    },
    knownEmptyBackwardFloors: new Map(),
    ...overrides,
  });

  return { calls, upserted };
};

const SCENARIOS: [string, () => void, Holding[]][] = [
  ['a metal never priced', () => {}, [metalHolding('XAU', TODAY - 30 * DAY_MS)]],
  [
    'a metal priced up to yesterday',
    () => insertDays('metal:XAU', TODAY - 400 * DAY_MS, TODAY - DAY_MS),
    [metalHolding('XAU', TODAY - 30 * DAY_MS)],
  ],
  [
    'a metal priced up to today',
    () => insertDays('metal:XAU', TODAY - 30 * DAY_MS, TODAY),
    [metalHolding('XAU', TODAY - 30 * DAY_MS)],
  ],
  [
    'a metal with a gap of several days',
    () => insertDays('metal:XAU', TODAY - 100 * DAY_MS, TODAY - 5 * DAY_MS),
    [metalHolding('XAU', TODAY - 60 * DAY_MS)],
  ],
  [
    'a lot older than the first stored day',
    () => insertDays('metal:XAU', TODAY - 40 * DAY_MS, TODAY - DAY_MS),
    [metalHolding('XAU', TODAY - 90 * DAY_MS)],
  ],
  [
    'two metals with different ranges, beside a manual series',
    () => {
      insertDays('metal:XAU', TODAY - 200 * DAY_MS, TODAY - DAY_MS);
      insertDays('metal:XAG', TODAY - 50 * DAY_MS, TODAY - 9 * DAY_MS);
      insertDays('holding:house', TODAY - 3 * DAY_MS, TODAY);
    },
    [metalHolding('XAU', TODAY - 100 * DAY_MS), metalHolding('XAG', TODAY - 80 * DAY_MS)],
  ],
];

describe('refreshMetalPrices reading only each metal’s stored day range', () => {
  beforeEach(() => {
    mockDatabase = new DatabaseSync(':memory:');
    applyAllMigrations(mockDatabase);
  });

  it.each(SCENARIOS)(
    'asks for and writes the same as with the whole table: %s',
    async (_label, seed, holdings) => {
      seed();

      const withWholeTable = await run({ loadPoints: () => pricePointsRepo.allQuery() }, holdings);
      const withRanges = await run({}, holdings);

      expect(withRanges).toEqual(withWholeTable);
    },
  );

  it('never reads the whole table on its own', async () => {
    insertDays('metal:XAU', TODAY - 200 * DAY_MS, TODAY - DAY_MS);
    const wholeTable = jest.spyOn(pricePointsRepo, 'allQuery');

    await run({}, [metalHolding('XAU', TODAY - 100 * DAY_MS)]);

    expect(wholeTable).not.toHaveBeenCalled();
    wholeTable.mockRestore();
  });

  it('reads one row per stored metal series, never the daily closes', async () => {
    insertDays('metal:XAU', TODAY - 200 * DAY_MS, TODAY - DAY_MS);
    insertDays('metal:XAG', TODAY - 50 * DAY_MS, TODAY - 9 * DAY_MS);
    insertDays('holding:house', TODAY - 400 * DAY_MS, TODAY);

    await expect(pricePointsRepo.metalDayRangesQuery()).resolves.toHaveLength(2);
  });
});
