let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return { ...actual, write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction) };
});

import { EXPORT_VERSION } from '../crypto/envelope';

import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const emptySnapshot: DataSnapshot = {
  accounts: [],
  holdings: [],
  transactions: [],
  currencyRates: [],
  currencyRateHistory: [],
  settings: [],
  syncState: [],
  categories: [],
  categoryRules: [],
  pricePoints: [],
  bondRegister: [],
  reminders: [],
};

const deleteTable = jest.fn(() => Promise.resolve());
const selectRows = jest.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) }));
const insertValues = jest.fn(() => Promise.resolve());
const insertInto = jest.fn(() => ({ values: insertValues }));

beforeEach(() => {
  jest.clearAllMocks();
  mockDatabaseTransaction = { delete: deleteTable, select: selectRows, insert: insertInto };
});

const expectNothingWritten = (): void => {
  expect(deleteTable).not.toHaveBeenCalled();
  expect(insertInto).not.toHaveBeenCalled();
  expect(selectRows).not.toHaveBeenCalled();
};

const snapshotWithHolding = (currency: string): DataSnapshot => ({
  ...emptySnapshot,
  holdings: [{ id: 'h1', currency }] as never,
});

const categoryRuleSnapshot = (matchers: unknown): DataSnapshot => ({
  ...emptySnapshot,
  categoryRules: [{ id: 'r1', matchers: JSON.stringify(matchers) }] as never,
});

const UNKNOWN_CURRENCY_CASES: [string, DataSnapshot][] = [
  ['a holding', snapshotWithHolding('XYZ')],
  ['an account', { ...emptySnapshot, accounts: [{ id: 'a1', currency: 'XYZ' }] as never }],
  ['a price point', { ...emptySnapshot, pricePoints: [{ id: 'p1', currency: 'XYZ' }] as never }],
  ['a rate base', { ...emptySnapshot, currencyRates: [{ base: 'XYZ', quote: 'USD' }] as never }],
  ['a rate quote', { ...emptySnapshot, currencyRates: [{ base: 'USD', quote: 'XYZ' }] as never }],
  [
    'a rate history base',
    { ...emptySnapshot, currencyRateHistory: [{ base: 'XYZ', quote: 'USD' }] as never },
  ],
  [
    'a rate history quote',
    { ...emptySnapshot, currencyRateHistory: [{ base: 'USD', quote: 'XYZ' }] as never },
  ],
  [
    'an array in place of a holding currency',
    { ...emptySnapshot, holdings: [{ id: 'h1', currency: ['USD'] }] as never },
  ],
  [
    'an unknown amount matcher after a known one',
    categoryRuleSnapshot([
      { type: 'amount', operator: 'gte', minorUnits: 100, currency: 'USD' },
      { type: 'amount', operator: 'gte', minorUnits: 100, currency: 'XYZ' },
    ]),
  ],
  [
    'a bond register term',
    {
      ...emptySnapshot,
      bondRegister: [{ isin: 'UA4000000001', terms: { currency: 'XYZ' } }] as never,
    },
  ],
  ['the base currency setting', { ...emptySnapshot, settings: [{ baseCurrency: 'XYZ' }] as never }],
  [
    'an amount matcher',
    {
      ...emptySnapshot,
      categoryRules: [
        {
          id: 'r1',
          matchers: JSON.stringify([
            { type: 'amount', operator: 'gte', minorUnits: 100, currency: 'XYZ' },
          ]),
        },
      ] as never,
    },
  ],
  [
    'a template draft currency',
    {
      ...emptySnapshot,
      transactionTemplates: [{ id: 't1', draft: { currency: 'XYZ' } }] as never,
    },
  ],
  [
    'a template exchange destination currency',
    {
      ...emptySnapshot,
      transactionTemplates: [
        { id: 't1', draft: { currency: 'USD', exchange: { destinationCurrency: 'XYZ' } } },
      ] as never,
    },
  ],
];

describe('restoreDataSnapshot with a currency code this build does not know', () => {
  it.each(UNKNOWN_CURRENCY_CASES)(
    'refuses a backup with an unknown currency on %s and writes nothing',
    async (_where, snapshot) => {
      await expect(restoreDataSnapshot(snapshot, EXPORT_VERSION)).rejects.toThrow(
        /^data-transfer\/unknown-currency: /,
      );

      expectNothingWritten();
    },
  );

  it('refuses a code that is an inherited object name', async () => {
    await expect(
      restoreDataSnapshot(snapshotWithHolding('constructor'), EXPORT_VERSION),
    ).rejects.toThrow(/^data-transfer\/unknown-currency: /);

    expectNothingWritten();
  });

  it('restores a backup whose currencies are all known', async () => {
    await expect(restoreDataSnapshot(snapshotWithHolding('USDC'), EXPORT_VERSION)).resolves.toEqual(
      { accountsRestored: 0 },
    );
    expect(insertInto).toHaveBeenCalled();
  });

  it('leaves a missing currency to the insert instead of refusing the backup', async () => {
    await expect(
      restoreDataSnapshot(
        { ...emptySnapshot, currencyRates: [{ base: null, quote: 'USD' }] as never },
        EXPORT_VERSION,
      ),
    ).resolves.toEqual({ accountsRestored: 0 });
  });

  it.each([
    ['a matcher that is not an amount', [{ type: 'nameIs', text: 'x', currency: 'XYZ' }]],
    ['matchers that are not records', [null, 'x', 5]],
  ])('restores a backup with %s', async (_where, matchers) => {
    await expect(
      restoreDataSnapshot(categoryRuleSnapshot(matchers), EXPORT_VERSION),
    ).resolves.toEqual({ accountsRestored: 0 });
  });

  it('restores a matchers text that is not JSON as it was stored', async () => {
    await expect(
      restoreDataSnapshot(
        {
          ...emptySnapshot,
          categoryRules: [{ id: 'r1', matchers: 'not json' }] as never,
        },
        EXPORT_VERSION,
      ),
    ).resolves.toEqual({ accountsRestored: 0 });
  });
});
