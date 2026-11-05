// The recurring read takes the whole ledger in narrow columns and no order: the matchers need both
// signs and blank rows, so no predicate narrows it, and the detection sorts by itself, so an order
// would only cost. Only a real engine shows the plan the statement gets.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const FIRST_TIME = Date.UTC(2026, 8, 20, 10);

const seedLedger = (): void => {
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES ('account', 'Monobank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency) VALUES
      ('card', 'account', 'Card', 'card', 'UAH'),
      ('other', 'account', 'Other', 'card', 'UAH');
    INSERT INTO transactions
      (id, holding_id, amount_minor_units, time, description, category, category_set_by_hand,
       mcc, hold, counter_iban, sets_balance, change_group_id, exchange_pair_id,
       exchange_counterpart_holding_id, untracked_counterpart, loan_holding_id, source, external_id)
    VALUES
      ('full', 'card', -4500, ${FIRST_TIME}, 'Netflix', 'Subscriptions', 1,
       4899, 0, 'UA213223130000026007233566001', 1, 'group-1', 'pair-1',
       'other', 'wallet:FUTURES', 'card', 'monobank', 'ext-1'),
      ('blank', 'other', 1200, ${FIRST_TIME - 1_000}, '', NULL, 0,
       NULL, NULL, NULL, 0, NULL, NULL,
       NULL, NULL, NULL, 'manual', NULL);
  `);
};

const planOf = (sql: string): string[] =>
  (mockDatabase.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map(
    (step) => step.detail,
  );

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
});

describe('transactionsRepo.recurringLedgerQuery', () => {
  it('reads every row of the ledger in exactly the columns the detection takes, of both signs', async () => {
    seedLedger();

    const rows = await transactionsRepo.recurringLedgerQuery();

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === 'full')).toEqual({
      id: 'full',
      holdingId: 'card',
      amountMinorUnits: -4500,
      time: FIRST_TIME,
      description: 'Netflix',
      mcc: 4899,
      counterIban: 'UA213223130000026007233566001',
      categorySetByHand: true,
      setsBalance: true,
      changeGroupId: 'group-1',
      exchangePairId: 'pair-1',
      exchangeCounterpartHoldingId: 'other',
      untrackedCounterpart: 'wallet:FUTURES',
      loanHoldingId: 'card',
      source: 'monobank',
    });
    expect(rows.find((row) => row.id === 'blank')).toEqual({
      id: 'blank',
      holdingId: 'other',
      amountMinorUnits: 1200,
      time: FIRST_TIME - 1_000,
      description: '',
      mcc: null,
      counterIban: null,
      categorySetByHand: false,
      setsBalance: false,
      changeGroupId: null,
      exchangePairId: null,
      exchangeCounterpartHoldingId: null,
      untrackedCounterpart: null,
      loanHoldingId: null,
      source: 'manual',
    });
  });

  it('scans the table with no temporary b-tree, so the read neither filters nor orders', () => {
    const plan = planOf(transactionsRepo.recurringLedgerQuery().toSQL().sql);

    expect(plan).toEqual(['SCAN transactions']);
    expect(plan.some((detail) => detail.includes('TEMP B-TREE'))).toBe(false);
  });

  it('would show a temporary b-tree for an ordered read of the same columns, so the plan check can fail', () => {
    const plan = planOf(
      `${transactionsRepo.recurringLedgerQuery().toSQL().sql} ORDER BY "description"`,
    );

    expect(plan.some((detail) => detail.includes('TEMP B-TREE'))).toBe(true);
  });
});
