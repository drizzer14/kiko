// Money-path guard (build-6 regression class): a split-change transaction must
// not distort net worth or the spending pie, and Feature 1's convert prefill
// must seed the right counterpart amount without ever mutating the bank row.
// Modeled on rates-refresh/crypto-coverage.test.ts: drive the real logic
// through fast seams, no simulator.
let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

import { startOfLocalDay } from '@kiko/dates';
import { holdings, transactions } from '@kiko/db';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import { buildCategoryTrend } from '@kiko/statistics/category-trend';
import { seedCounterpartMinorUnits } from '@kiko/holdings/exchange-prefill';
import { buildRateTable, guardedNetWorth } from '@kiko/rates/net-worth-view';
import { buildCategoryBreakdown } from '@kiko/statistics/category-breakdown';

import { transactionsRepo } from './transactions.repo';

// A fake database-transaction handle capturing inserts + balance updates in call order, answering
// both the chained `.where(...).limit(1)` and the bare `await where(...)`
// conventions — same shape as transactions.repo.test.ts's makeExchangeDatabaseTransaction.
const makeDatabaseTransaction = (
  selectQueue: unknown[][],
): {
  databaseTransaction: unknown;
  inserts: Record<string, unknown>[];
  updates: { table: unknown; values: Record<string, unknown> }[];
} => {
  const inserts: Record<string, unknown>[] = [];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const queue = [...selectQueue];
  const databaseTransaction = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = queue.shift() ?? [];

          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);

        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });

        return { where: () => Promise.resolve() };
      },
    }),
  };

  return { databaseTransaction, inserts, updates };
};

describe('Money-path guard: split-change + convert prefill', () => {
  it('keeps net worth correct after a split-change (payment + N linked returns)', async () => {
    // Opening balances: payer 500_00, holding B 10_00, holding C 20_00 UAH.
    const opening = { 'payer-1': 500_00, 'hold-b': 10_00, 'hold-c': 20_00 };
    const { databaseTransaction, updates } = makeDatabaseTransaction([
      [{ balanceMinorUnits: opening['payer-1'] }],
      [{ balanceMinorUnits: opening['hold-b'] }],
      [{ balanceMinorUnits: opening['hold-c'] }],
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'payer-1', amountMinorUnits: -212_00, time: 1, category: 'groceries' },
      returns: [
        { holdingId: 'hold-b', amountMinorUnits: 20 },
        { holdingId: 'hold-c', amountMinorUnits: 8 },
      ],
    });

    // Apply the captured balance writes back onto the holdings and sum net worth
    // in UAH (base == each holding's currency, so no rate needed).
    const finalBalances = updates.map((update, index) => ({
      id: `holding-${index}`,
      currency: 'UAH' as const,
      balanceMinorUnits: update.values.balanceMinorUnits as number,
      type: 'cash' as const,
      metadata: null,
    }));
    const openingNet = 500_00 + 10_00 + 20_00;
    const net = guardedNetWorth(finalBalances, 'UAH', {}, 1);

    // Net worth moved by exactly the NET change: −(212_00 − 20 − 8) = −211_72.
    expect(net.minorUnits).toBe(openingNet - 211_72);
  });

  it('nets the linked returns in the spending pie (category not overstated by the change)', () => {
    const base = {
      mcc: null,
      counterIban: null,
      description: '',
      exchangeCounterpartHoldingId: null,
      currency: 'UAH' as const,
    };
    const slices = buildCategoryBreakdown({
      transactions: [
        {
          ...base,
          id: 'pay',
          category: 'groceries',
          amountMinorUnits: -212_00,
          changeGroupId: 'grp-1',
        },
        { ...base, id: 'r1', category: null, amountMinorUnits: 20, changeGroupId: 'grp-1' },
        { ...base, id: 'r2', category: null, amountMinorUnits: 8, changeGroupId: 'grp-1' },
      ],
      categoryDisplay: new Map(),
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'groceries',
    });

    expect(slices).toHaveLength(1);
    expect(slices[0].amount).toBe(211_72);
  });

  it('seeds the convert counterpart from a cached rate and leaves the bank row unmutated', async () => {
    // Prefill: a 20.00 USD synced card withdrawal → UAH cash at USD:UAH 41.5.
    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -20_00,
      sourceCurrency: 'USD',
      counterpartCurrency: 'UAH',
      rateTable: buildRateTable([{ base: 'USD', quote: 'UAH', rate: '41.5' }]),
    });

    expect(seeded).toBe(830_00);

    // Convert of a SYNCED (bank-owned) withdrawal: only the new cash leg is
    // written; the existing monobank row is never updated.
    const { databaseTransaction, inserts, updates } = makeDatabaseTransaction([
      [{ balanceMinorUnits: 0 }], // the new cash leg's balance read
      [{ source: 'monobank' }], // the existing bank row, read inside the tx
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'cash-1',
      counterpartType: 'cash',
      amountMinorUnits: seeded as number,
      existingTransactionId: 'bank-withdrawal-1',
      existingHoldingId: 'card-1',
      time: 1,
    });

    // One new leg inserted on the cash holding; the transactions table was never
    // written (the bank row stays untouched).
    expect(inserts).toEqual([
      expect.objectContaining({
        holdingId: 'cash-1',
        amountMinorUnits: 830_00,
        exchangeCounterpartHoldingId: 'card-1',
        source: 'manual',
      }),
    ]);
    expect(updates.every((update) => update.table !== transactions)).toBe(true);
    expect(updates.some((update) => update.table === holdings)).toBe(true);
  });

  it('nets the linked returns in the category trend line (period not overstated by the change)', () => {
    // A fixed "today" so the range is deterministic; the split payment and its
    // two returns all fall on this same day bucket.
    const now = Date.UTC(2025, 2, 31, 12, 0, 0);
    const base = {
      mcc: null,
      counterIban: null,
      description: '',
      exchangeCounterpartHoldingId: null,
      currency: 'UAH' as const,
    };
    const series = buildCategoryTrend({
      transactions: [
        {
          ...base,
          id: 'pay',
          category: 'groceries',
          amountMinorUnits: -212_00,
          changeGroupId: 'grp-1',
          time: now,
        },
        {
          ...base,
          id: 'r1',
          category: null,
          amountMinorUnits: 20,
          changeGroupId: 'grp-1',
          time: now,
        },
        {
          ...base,
          id: 'r2',
          category: null,
          amountMinorUnits: 8,
          changeGroupId: 'grp-1',
          time: now,
        },
      ],
      categoryDisplay: new Map(),
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'groceries',
      range: { from: startOfLocalDay(localDaysFrom(now, -3)), to: now },
      bucketDays: 1,
    });

    // The affected day's trend value is the NET |payment| − Σreturns = 211_72
    // (211.72 in base MAJOR units), not the bare 212_00 — the trend nets exactly
    // like the pie (same shared accumulateSpend). The transaction lands in
    // its own LOCAL-DAY bucket, not at the exact `now` instant.
    expect(series).toHaveLength(1);
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    expect(nonZero).toEqual([{ t: startOfLocalDay(now), amount: 211.72 }]);
  });
});
