// A rule reaches a row at insert: a synced row, a statement-import row and a sync row that adopts
// its import twin. What the rule replaces, what it never touches (an adopted twin's own pick, a
// refreshed row), the currency it reads from the holding and how many statements it costs are SQL
// over the stored ledger, so only a real engine shows them.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';
import { isMccExcludedTransfer } from '@kiko/statistics/transfer-exclusion';

import { transactionsRepo } from './transactions.repo';

const T = Date.UTC(2026, 8, 20, 10);
const SECOND = 1_000;
const OWN_IBAN = 'UA213223130000026007233566001';

type SqlParameter = string | number | null;
type SyncItem = Parameters<typeof transactionsRepo.addManyDedup>[0][number];

type StoredRow = {
  externalId: string | null;
  category: string | null;
  flag: number;
  mcc: number | null;
  counterIban: string | null;
};

const run = (statement: string, ...parameters: SqlParameter[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const insertRule = (id: string, category: string, matchers: CategoryRuleMatcher[]): void => {
  run(
    'INSERT INTO category_rules (id, category, matchers) VALUES (?, ?, ?)',
    id,
    category,
    JSON.stringify(matchers),
  );
};

const nameIs = (text: string): CategoryRuleMatcher => ({ type: 'nameIs', text });

const storedRows = (): StoredRow[] =>
  mockDatabase
    .prepare(
      `SELECT external_id AS externalId, category, category_set_by_hand AS flag, mcc,
        counter_iban AS counterIban
       FROM transactions ORDER BY external_id`,
    )
    .all() as StoredRow[];

const categoryOf = (externalId: string): string | null | undefined =>
  storedRows().find((row) => row.externalId === externalId)?.category;

const syncItem = (externalId: string, overrides: Partial<SyncItem> = {}): SyncItem => ({
  holdingId: 'card',
  amountMinorUnits: -5_000,
  time: T,
  source: 'monobank',
  description: 'Silpo',
  category: 'groceries',
  mcc: 5411,
  hold: false,
  externalId,
  ...overrides,
});

// Records every statement the engine prepares from here on.
const spyOnStatements = (): string[] => {
  const statements: string[] = [];
  const prepare = mockDatabase.prepare.bind(mockDatabase);

  jest.spyOn(mockDatabase, 'prepare').mockImplementation((sql: string) => {
    statements.push(sql);

    return prepare(sql);
  });

  return statements;
};

const rulesReadsOf = (statements: string[]): number =>
  statements.filter((sql) => /^select .* from "category_rules"/i.test(sql)).length;

const currencyReadsOf = (statements: string[]): number =>
  statements.filter((sql) => /^select "id", "currency" from "holdings"/i.test(sql)).length;

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  run(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES
      ('card', 'account', 'Card', 'card', 'UAH', 0),
      ('usd', 'account', 'Dollar card', 'card', 'USD', 0)`,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a rule at insert', () => {
  it('replaces the bank category of a synced row', async () => {
    insertRule('silpo', 'food', [nameIs('silpo')]);

    await transactionsRepo.addManyDedup([syncItem('k1')]);

    expect(categoryOf('k1')).toBe('food');
  });

  it('keeps the bank category when no rule matches', async () => {
    insertRule('silpo', 'food', [nameIs('silpo')]);

    await transactionsRepo.addManyDedup([syncItem('k1', { description: 'Atb' })]);

    expect(categoryOf('k1')).toBe('groceries');
  });

  it('gives a row the bank left uncategorised the rule category', async () => {
    insertRule('deposit', 'crypto', [nameIs('btc deposit')]);

    await transactionsRepo.addManyDedup([
      syncItem('b1', {
        source: 'binance',
        description: 'BTC deposit',
        category: undefined,
        mcc: undefined,
      }),
    ]);

    expect(categoryOf('b1')).toBe('crypto');
  });

  it('replaces the category of a statement-import row', async () => {
    insertRule('silpo', 'food', [nameIs('silpo')]);

    await transactionsRepo.importRows({
      holdingId: 'card',
      closingBalance: undefined,
      rows: [{ ...syncItem('i1'), source: 'import' }],
    });

    expect(categoryOf('i1')).toBe('food');
  });

  it('matches an amount rule on the holding currency only', async () => {
    insertRule('big-uah', 'rent', [
      { type: 'amount', operator: 'eq', minorUnits: 50_000, currency: 'UAH' },
    ]);

    await transactionsRepo.addManyDedup([
      syncItem('uah', { amountMinorUnits: -50_000, description: 'Pay' }),
      syncItem('usd', { amountMinorUnits: -50_000, description: 'Pay', holdingId: 'usd' }),
    ]);

    expect(categoryOf('uah')).toBe('rent');
    expect(categoryOf('usd')).toBe('groceries');
  });

  it('re-categorises an own-account transfer without making it spending', async () => {
    insertRule('fifty', 'bills', [
      { type: 'amount', operator: 'eq', minorUnits: 50_000, currency: 'UAH' },
    ]);

    await transactionsRepo.addManyDedup([
      syncItem('t1', {
        amountMinorUnits: -50_000,
        description: 'Transfer',
        mcc: 4829,
        counterIban: OWN_IBAN,
      }),
    ]);

    const [row] = storedRows();

    expect(row.category).toBe('bills');
    expect(isMccExcludedTransfer(row, new Set([OWN_IBAN]))).toBe(true);
  });

  it('applies a name rule, and not an amount rule, to a row whose holding is missing', async () => {
    mockDatabase.exec('PRAGMA foreign_keys = OFF');
    insertRule('silpo', 'food', [nameIs('silpo')]);
    insertRule('big', 'rent', [
      { type: 'amount', operator: 'eq', minorUnits: 50_000, currency: 'UAH' },
    ]);

    await transactionsRepo.addManyDedup([
      syncItem('named', { holdingId: 'ghost' }),
      syncItem('amount', { holdingId: 'ghost', amountMinorUnits: -50_000, description: 'Pay' }),
    ]);

    expect(categoryOf('named')).toBe('food');
    expect(categoryOf('amount')).toBe('groceries');
  });

  it('never writes the category of a row it already stored', async () => {
    await transactionsRepo.addManyDedup([syncItem('k1')]);
    insertRule('silpo', 'food', [nameIs('silpo')]);

    await transactionsRepo.addManyDedup([syncItem('k1', { amountMinorUnits: -6_000 })]);

    expect(categoryOf('k1')).toBe('groceries');
  });

  it('never sets the by-hand mark', async () => {
    insertRule('silpo', 'food', [nameIs('silpo')]);

    await transactionsRepo.addManyDedup([syncItem('k1')]);
    await transactionsRepo.importRows({
      holdingId: 'card',
      closingBalance: undefined,
      // A day apart and another amount, so the sync row does not count as its twin.
      rows: [{ ...syncItem('i1'), amountMinorUnits: -700, time: T + DAY_MS, source: 'import' }],
    });

    expect(storedRows().map((row) => row.flag)).toEqual([0, 0]);
  });
});

describe('a sync row that adopts its import twin', () => {
  it('keeps the twin category and by-hand mark whatever rule matches', async () => {
    insertRule('silpo', 'food', [nameIs('silpo')]);
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id,
         description, category, category_set_by_hand)
       VALUES ('twin', 'card', -5000, ?, 'import', 'twin', 'Silpo', 'shops', 1)`,
      T,
    );

    await transactionsRepo.addManyDedup([syncItem('k1', { time: T + SECOND })]);

    expect(storedRows()).toMatchObject([{ externalId: 'k1', category: 'shops', flag: 1 }]);
  });

  it('gives a twin with no category the rule category', async () => {
    insertRule('silpo', 'food', [nameIs('silpo')]);
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id,
         description, category)
       VALUES ('twin', 'card', -5000, ?, 'import', 'twin', 'Silpo', NULL)`,
      T,
    );

    await transactionsRepo.addManyDedup([syncItem('k1', { time: T + SECOND })]);

    expect(storedRows()).toMatchObject([{ externalId: 'k1', category: 'food', flag: 0 }]);
  });
});

describe('reading the rules at insert', () => {
  it('reads the rules and the holding currencies once for a batch of new rows', async () => {
    insertRule('silpo', 'food', [nameIs('silpo')]);

    const statements = spyOnStatements();

    await transactionsRepo.addManyDedup([syncItem('k1'), syncItem('k2'), syncItem('k3')]);

    expect(rulesReadsOf(statements)).toBe(1);
    expect(currencyReadsOf(statements)).toBe(1);
  });

  it('reads once more for the adoption of an import twin', async () => {
    insertRule('silpo', 'food', [nameIs('silpo')]);
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id,
         description)
       VALUES ('twin', 'card', -5000, ?, 'import', 'twin', 'Silpo')`,
      T,
    );

    const statements = spyOnStatements();

    await transactionsRepo.addManyDedup([
      syncItem('k1', { time: T + SECOND }),
      syncItem('k2', { time: T + 10 * 60 * SECOND }),
    ]);

    expect(rulesReadsOf(statements)).toBe(2);
    expect(currencyReadsOf(statements)).toBe(2);
  });

  it('reads no holding currency when there is no rule to read it for', async () => {
    const statements = spyOnStatements();

    await transactionsRepo.addManyDedup([syncItem('k1')]);

    expect(rulesReadsOf(statements)).toBe(1);
    expect(currencyReadsOf(statements)).toBe(0);
  });
});

describe('setCategory', () => {
  it('sets the category and marks it as picked by hand', async () => {
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source)
       VALUES ('manual', 'card', -100, ?, 'manual')`,
      T,
    );

    await transactionsRepo.setCategory({ transactionId: 'manual', category: 'food' });

    expect(
      mockDatabase
        .prepare('SELECT category, category_set_by_hand AS flag FROM transactions WHERE id = ?')
        .get('manual'),
    ).toEqual({ category: 'food', flag: 1 });
  });
});
