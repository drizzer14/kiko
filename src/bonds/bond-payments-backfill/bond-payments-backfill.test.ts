let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

import { holdings, bondRegister } from '@kiko/db';
import { renderCondition } from '@kiko/db/render-condition-test-helper';

import type { BondTerms } from '../nbu-register';

import { backfillBondPayments, bondPaymentBackfills } from './bond-payments-backfill';

const local = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getTime();

const stepUpTerms: BondTerms = {
  isin: 'XS2895055981',
  currency: 'USD',
  faceValueMinorUnits: 100,
  couponPct: 4.5,
  maturityDate: local(2029, 2, 1),
  couponFrequency: 'semiannually',
  name: 'OЗДП-середньострокова XS2895055981',
  payments: [
    { date: local(2027, 2, 1), kind: 'coupon', amount: '0.0225' },
    { date: local(2027, 8, 1), kind: 'coupon', amount: '0.03' },
    { date: local(2029, 2, 1), kind: 'redemption', amount: '1' },
  ],
};

// Saved without a price: the backfill must not invent the nominal default.
const stepUpMetadata = {
  quantity: 1000,
  faceValueMinorUnits: 100,
  couponPct: 4.5,
  purchaseDate: local(2026, 9, 26),
  maturityDate: local(2029, 2, 1),
  bondKind: 'government',
  couponFrequency: 'semiannually',
  isin: 'XS2895055981',
};

type Row = { id: string; currency: 'USD' | 'UAH'; metadata: unknown };

const stepUpRow: Row = { id: 'h1', currency: 'USD', metadata: stepUpMetadata };

describe('bondPaymentBackfills', () => {
  it('writes the matching cached schedule into a bond saved without one, keeping every other key', () => {
    expect(bondPaymentBackfills([stepUpRow], [stepUpTerms])).toEqual([
      { id: 'h1', metadata: { ...stepUpMetadata, payments: stepUpTerms.payments } },
    ]);
  });

  it.each([
    ['another currency', { ...stepUpRow, currency: 'UAH' }],
    [
      'another face value',
      { ...stepUpRow, metadata: { ...stepUpMetadata, faceValueMinorUnits: 1 } },
    ],
    ['a Manual bond', { ...stepUpRow, metadata: { ...stepUpMetadata, isin: undefined } }],
    ['a kept schedule', { ...stepUpRow, metadata: { ...stepUpMetadata, payments: [] } }],
    ['unparsable metadata', { ...stepUpRow, metadata: { quantity: 'many' } }],
  ] as [string, Row][])('writes nothing for %s', (_label, row) => {
    expect(bondPaymentBackfills([row], [stepUpTerms])).toEqual([]);
  });

  it('prefers the first matching terms, and reads a later one when the first has no payments', () => {
    const fresh = { ...stepUpTerms, payments: undefined };

    expect(bondPaymentBackfills([stepUpRow], [fresh, stepUpTerms])).toEqual([
      { id: 'h1', metadata: { ...stepUpMetadata, payments: stepUpTerms.payments } },
    ]);
  });
});

describe('backfillBondPayments', () => {
  const makeStore = (rows: Row[], cached: BondTerms[]) => {
    const store = { holdings: rows, reads: [] as string[] };
    mockDatabaseTransaction = {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => {
            store.reads.push(table === holdings ? 'holdings' : 'bond_register');

            return table === bondRegister ? cached.map((terms) => ({ terms })) : store.holdings;
          },
        }),
      }),
      update: () => ({
        set: (values: { metadata: unknown }) => ({
          where: async (condition: unknown) => {
            const [id] = renderCondition(condition).params;
            store.holdings = store.holdings.map((row) =>
              row.id === id ? { ...row, metadata: values.metadata } : row,
            );
          },
        }),
      }),
    };

    return store;
  };

  it('keeps the schedule once, from a register row the fresh fetch dropped', async () => {
    const store = makeStore([stepUpRow], [stepUpTerms]);

    await backfillBondPayments([]);

    expect(store.holdings[0].metadata).toEqual({
      ...stepUpMetadata,
      payments: stepUpTerms.payments,
    });

    const written = store.holdings[0].metadata;
    await backfillBondPayments([]);

    expect(store.holdings[0].metadata).toBe(written);
  });

  it('reads no cache when no bond is missing a schedule', async () => {
    const store = makeStore(
      [{ ...stepUpRow, metadata: { ...stepUpMetadata, payments: [] } }],
      [stepUpTerms],
    );

    await backfillBondPayments([stepUpTerms]);

    expect(store.reads).toEqual(['holdings']);
  });
});
