// The own MCC counts read at the size the picker budgets for (50 000 transactions), on a real
// engine: how many statements it costs, which tables its plan touches and how many rows it hands
// back. Only results and counted work are asserted: a wall-clock bound fails under a loaded
// machine or a mutation run, so the timing is measured by hand.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const ROW_COUNT = 50_000;
const DISTINCT_CODES = 300;
const FIRST_CODE = 1_000;
const MAX_CODE = 9_999;
const TEST_TIMEOUT = 120_000;

// One row in five holds no code, the rest hold one of 300 codes in blocks of five rows (so the
// null rows never hide a code), and a few rows hold a code outside the range a rule can store.
const mccOfRow = (index: number): number | null => {
  if (index % 5 === 0) {
    return null;
  }

  if (index % 997 === 1) {
    return MAX_CODE + 1;
  }

  if (index % 991 === 3) {
    return -1;
  }

  return FIRST_CODE + ((Math.floor(index / 5) * 7) % DISTINCT_CODES);
};

const isInRange = (mcc: number | null): mcc is number =>
  mcc !== null && mcc >= 0 && mcc <= MAX_CODE;

const seededCodes = Array.from({ length: ROW_COUNT }, (_unused, index) => mccOfRow(index));

const seedLedger = (): void => {
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
    VALUES ('card', 'account', 'Card', 'card', 'UAH', 0);
  `);

  const insertRow = mockDatabase.prepare(
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, source, mcc)
     VALUES (?, 'card', -4500, ?, ?, 'manual', ?)`,
  );

  mockDatabase.exec('BEGIN');
  seededCodes.forEach((mcc, index) => {
    insertRow.run(`row-${index}`, index, `Row ${index}`, mcc);
  });
  mockDatabase.exec('COMMIT');
};

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

const queryPlanOf = (statement: string, params: unknown[]): string[] =>
  (
    mockDatabase
      .prepare(`EXPLAIN QUERY PLAN ${statement}`)
      .all(...(params as (string | number)[])) as { detail: string }[]
  ).map((step) => step.detail);

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  seedLedger();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('transactionsRepo.mccCountsQuery at 50 000 rows', () => {
  it(
    'reads 50,000 rows in one statement and returns one row per distinct code',
    async () => {
      const inRangeCount = seededCodes.filter(isInRange).length;
      const statements = spyOnStatements();
      const query = transactionsRepo.mccCountsQuery();

      const rows = await query;

      expect(seededCodes.filter((mcc) => mcc !== null && !isInRange(mcc))).not.toHaveLength(0);
      expect(statements).toEqual([query.toSQL().sql]);
      expect(rows).toHaveLength(DISTINCT_CODES);
      expect(rows.reduce((total, row) => total + row.rowCount, 0)).toBe(inRangeCount);
    },
    TEST_TIMEOUT,
  );

  it('plans one scan of transactions and no other table', () => {
    const { sql, params } = transactionsRepo.mccCountsQuery().toSQL();
    const plan = queryPlanOf(sql, params);
    const rest = plan.filter((detail) => detail !== 'SCAN transactions');

    expect(plan.filter((detail) => detail === 'SCAN transactions')).toHaveLength(1);
    expect(
      rest.filter((detail) => !/^USE TEMP B-TREE FOR (GROUP BY|ORDER BY)$/.test(detail)),
    ).toEqual([]);
    expect(plan.filter((detail) => detail.startsWith('SEARCH'))).toEqual([]);
  });
});
