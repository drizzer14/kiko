// src/data-transfer/snapshot/read-snapshot.test.ts
let mockResultQueue: unknown[][] = [];

jest.mock('../../db/client', () => ({
  database: {
    select: () => ({
      from: () => ({
        orderBy: () => Promise.resolve(mockResultQueue.shift() ?? []),
      }),
    }),
  },
}));

import { readDataSnapshot } from './read-snapshot';

describe('readDataSnapshot', () => {
  it('reads all ten tables, in order, into the matching snapshot fields', async () => {
    mockResultQueue = [
      [{ id: 'a1' }], // accounts
      [{ id: 'h1' }], // holdings
      [{ id: 't1' }], // transactions
      [{ base: 'UAH', quote: 'USD' }], // currencyRates
      [{ base: 'UAH', quote: 'USD', day: 1 }], // currencyRateHistory
      [{ id: 1 }], // settings
      [{ accountId: 'a1' }], // syncState
      [{ key: 'food' }], // categories
      [{ normalizedName: 'x' }], // categoryOverrides
      [{ instrument: 'share:AAPL', day: 1 }], // pricePoints
    ];

    const snapshot = await readDataSnapshot();

    expect(snapshot.accounts).toEqual([{ id: 'a1' }]);
    expect(snapshot.holdings).toEqual([{ id: 'h1' }]);
    expect(snapshot.transactions).toEqual([{ id: 't1' }]);
    expect(snapshot.currencyRates).toEqual([{ base: 'UAH', quote: 'USD' }]);
    expect(snapshot.currencyRateHistory).toEqual([{ base: 'UAH', quote: 'USD', day: 1 }]);
    expect(snapshot.settings).toEqual([{ id: 1 }]);
    expect(snapshot.syncState).toEqual([{ accountId: 'a1' }]);
    expect(snapshot.categories).toEqual([{ key: 'food' }]);
    expect(snapshot.categoryOverrides).toEqual([{ normalizedName: 'x' }]);
    expect(snapshot.pricePoints).toEqual([{ instrument: 'share:AAPL', day: 1 }]);
  });

  it('returns empty arrays for tables with no rows', async () => {
    mockResultQueue = [[], [], [], [], [], [], [], [], [], []];

    const snapshot = await readDataSnapshot();

    expect(Object.values(snapshot).every((rows) => Array.isArray(rows) && rows.length === 0)).toBe(
      true,
    );
  });
});
