// A synced bank debit the user turns into a move to an own manual holding through the transaction
// form's Exchange: `recordExchangeCounterpart` writes the credit with the marker and the pair id,
// and marks the bank-owned debit with the pair id ONLY. These pins run the real repository on a
// real database and feed the written rows to the same exclusion rules the Statistics screen
// unions, so they prove which of those rows still count as spending.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import {
  internalTransferTransactionIds,
  rowsForTransferMatch,
} from '@kiko/statistics/internal-transfers';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { buildCategoryTrend } from '@kiko/statistics/category-trend';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import { buildCategoryBreakdown } from '@kiko/statistics/category-breakdown';

import {
  exchangeExcludedTransactionIds,
  sameCurrencyMoveTransactionIds,
} from './exchange-exclusion';

const TIME = Date.UTC(2026, 9, 20, 9, 0, 0);
const CATEGORY_DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);

type StoredRow = {
  id: string;
  holding_id: string;
  amount_minor_units: number;
  time: number;
  category: string | null;
  mcc: number | null;
  exchange_pair_id: string | null;
  exchange_counterpart_holding_id: string | null;
  untracked_counterpart: string | null;
  change_group_id: string | null;
  description: string;
  counter_iban: string | null;
  currency: 'UAH' | 'USD';
};

const readLedger = () =>
  (
    mockDatabase
      .prepare(
        `SELECT t.*, h.currency AS currency FROM transactions t
         JOIN holdings h ON h.id = t.holding_id ORDER BY t.amount_minor_units`,
      )
      .all() as StoredRow[]
  ).map((row) => ({
    id: row.id,
    holdingId: row.holding_id,
    time: row.time,
    category: row.category,
    amountMinorUnits: row.amount_minor_units,
    mcc: row.mcc,
    counterIban: row.counter_iban,
    description: row.description,
    exchangePairId: row.exchange_pair_id,
    exchangeCounterpartHoldingId: row.exchange_counterpart_holding_id,
    untrackedCounterpart: row.untracked_counterpart,
    changeGroupId: row.change_group_id,
    currency: row.currency,
  }));

type Ledger = ReturnType<typeof readLedger>;

const excludedIdsOf = (ledger: Ledger): Set<string> =>
  new Set([
    ...internalTransferTransactionIds(rowsForTransferMatch(ledger)),
    ...exchangeExcludedTransactionIds(ledger),
    ...sameCurrencyMoveTransactionIds(ledger),
  ]);

const spendingOf = (ledger: Ledger) => {
  const excludedTransactionIds = excludedIdsOf(ledger);
  const common = {
    transactions: ledger,
    categoryDisplay: CATEGORY_DISPLAY,
    rateTable: {},
    baseCurrency: 'UAH' as const,
    defaultCategoryKey: 'other',
    excludedTransactionIds,
    scheme: 'dark' as const,
  };
  const pie = buildCategoryBreakdown(common);
  const trend = buildCategoryTrend({
    ...common,
    range: { from: TIME - DAY_MS, to: TIME + DAY_MS },
    bucketDays: 1,
  });

  return {
    pie: pie.map((slice) => `${slice.key}=${slice.amount}`),
    trend: trend.map(
      (series) => `${series.key}=${series.points.reduce((sum, point) => sum + point.amount, 0)}`,
    ),
  };
};

const seedWorld = (): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind, institution) VALUES ('mono', 'Monobank', 'bank', 'monobank');
    INSERT INTO accounts (id, name, kind) VALUES ('own', 'Manual', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
      VALUES ('card', 'mono', 'Mono card', 'card', 'UAH', 0, '{"monobankId":"c1"}');
    INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
      VALUES ('cash', 'own', 'Wallet', 'cash', 'UAH', 0);
    INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
      VALUES ('dollars', 'own', 'Dollars', 'cash', 'USD', 0);
    INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
      VALUES ('second', 'own', 'Second card', 'card', 'UAH', 0);
    INSERT INTO transactions (id, holding_id, amount_minor_units, time, category, mcc, source, external_id)
      VALUES ('debit', 'card', -50000, ${TIME}, 'groceries', 5411, 'monobank', 'external-1');
  `);
};

const convertDebit = (input: { toHoldingId: string; amountMinorUnits: number }) =>
  transactionsRepo.recordExchangeCounterpart({
    direction: 'record-destination',
    counterpartHoldingId: input.toHoldingId,
    counterpartType: 'cash',
    amountMinorUnits: input.amountMinorUnits,
    existingTransactionId: 'debit',
    existingHoldingId: 'card',
    time: TIME,
  });

describe('a synced bank debit turned into a move by the form Exchange', () => {
  beforeEach(seedWorld);

  it('writes only the pair id on the bank-owned debit, and the pair id plus marker on the credit', async () => {
    await convertDebit({ toHoldingId: 'cash', amountMinorUnits: 50000 });

    const ledger = readLedger();
    const debit = ledger.find((row) => row.id === 'debit');
    const credit = ledger.find((row) => row.id !== 'debit');

    expect(debit?.exchangePairId).not.toBeNull();
    expect(debit?.exchangeCounterpartHoldingId).toBeNull();
    expect(credit?.exchangePairId).toBe(debit?.exchangePairId);
    expect(credit?.exchangeCounterpartHoldingId).toBe('card');
  });

  it('leaves a same-currency equal-amount move out of the pie and the trend', async () => {
    await convertDebit({ toHoldingId: 'cash', amountMinorUnits: 50000 });

    expect(spendingOf(readLedger())).toEqual({ pie: [], trend: [] });
  });

  it('counts a same-currency move whose amount was edited to differ', async () => {
    await convertDebit({ toHoldingId: 'cash', amountMinorUnits: 49000 });

    expect(spendingOf(readLedger())).toEqual({
      pie: ['groceries=50000'],
      trend: ['groceries=500'],
    });
  });

  it('still counts a debit converted into another currency', async () => {
    await convertDebit({ toHoldingId: 'dollars', amountMinorUnits: 1250 });

    expect(spendingOf(readLedger())).toEqual({
      pie: ['groceries=50000'],
      trend: ['groceries=500'],
    });
  });

  it('keeps an unmarked same-amount debit on another own holding counted beside the move', async () => {
    mockDatabase.exec(`
      INSERT INTO transactions (id, holding_id, amount_minor_units, time, category, source)
        VALUES ('pay-send', 'second', -50000, ${TIME}, 'other', 'manual');
    `);
    await convertDebit({ toHoldingId: 'cash', amountMinorUnits: 50000 });

    expect(spendingOf(readLedger())).toEqual({ pie: ['other=50000'], trend: ['other=500'] });
  });
});
