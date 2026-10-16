// drizzle/migrations/0053-add-loan-holding-id-index.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the index is proven against the real planner.
// The repo's query builders only compile here (`.toSQL()`); the plan runs on the
// real engine below, so the client needs no live connection.
jest.mock('@kiko/db/client', () => {
  const { toSqlOnlyDrizzle } = require('@kiko/test-support/real-sqlite');

  return { database: toSqlOnlyDrizzle(), write: jest.fn() };
});

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  applyAllMigrations,
  applyMigrationsThrough,
  toSqlOnlyDrizzle,
} from '@kiko/test-support/real-sqlite';
import { transactions } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { eq, isNotNull } from 'drizzle-orm';
import { transactionsRepo } from '@kiko/transactions/repo';

const MIGRATION_SQL = readFileSync(join(__dirname, '0053_add_loan_holding_id_index.sql'), 'utf8');

const PAID = Date.UTC(2026, 8, 12, 10);

type Row = { id: string; holdingId: string; loanHoldingId: string | null };

const run = (
  database: DatabaseSync,
  statement: string,
  ...parameters: (string | number | null)[]
) => {
  database.prepare(statement).run(...parameters);
};

const insertHolding = (database: DatabaseSync, id: string, type: string): void => {
  run(
    database,
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
     VALUES (?, 'account', ?, ?, 'UAH', 0)`,
    id,
    id,
    type,
  );
};

const insertTransaction = (database: DatabaseSync, row: Row): void => {
  run(
    database,
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, loan_holding_id)
     VALUES (?, ?, -100, ?, 'manual', ?)`,
    row.id,
    row.holdingId,
    PAID,
    row.loanHoldingId,
  );
};

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')) {
    database.exec(statement);
  }
};

const databaseThrough0052 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0052_add_exchange_pair_id');
  run(database, "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  insertHolding(database, 'card', 'card');
  insertHolding(database, 'loan', 'loan');

  return database;
};

const indexNames = (database: DatabaseSync): string[] =>
  (
    database.prepare("SELECT name FROM pragma_index_list('transactions')").all() as {
      name: string;
    }[]
  ).map((index) => index.name);

const allRows = (database: DatabaseSync): unknown[] =>
  database
    .prepare('SELECT * FROM transactions ORDER BY id')
    .all()
    .map((row) => ({ ...row }));

describe('migration 0053: the index on the loan holding id', () => {
  it('adds an index on exactly the loan_holding_id column', () => {
    const database = databaseThrough0052();

    expect(indexNames(database)).not.toContain('transactions_loan_holding_id');

    applyMigration(database);

    const columns = (
      database
        .prepare("SELECT name FROM pragma_index_info('transactions_loan_holding_id')")
        .all() as {
        name: string;
      }[]
    ).map((column) => column.name);

    expect(indexNames(database)).toContain('transactions_loan_holding_id');
    expect(columns).toEqual(['loan_holding_id']);
  });

  it('is partial: only rows that name a loan holding are indexed', () => {
    const database = databaseThrough0052();

    applyMigration(database);

    const { sql } = database
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'transactions_loan_holding_id'")
      .get() as { sql: string };

    expect(sql).toContain('WHERE');
    expect(sql).toContain('IS NOT NULL');
  });

  describe('the query plans', () => {
    const planOf = (
      database: DatabaseSync,
      query: { toSQL: () => { sql: string; params: unknown[] } },
    ): string => {
      const { sql, params } = query.toSQL();

      return (
        database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as (string | number)[])) as {
          detail: string;
        }[]
      )
        .map((step) => step.detail)
        .join(' ');
    };

    const migratedDatabase = (): DatabaseSync => {
      const database = databaseThrough0052();

      applyMigration(database);

      return database;
    };

    const lookup = toSqlOnlyDrizzle().select({ id: transactions.id }).from(transactions);

    // The matcher's query names columns that later migrations added, so it runs against the
    // schema as shipped now, which holds this index too.
    const currentDatabase = (): DatabaseSync => {
      const database = new DatabaseSync(':memory:');

      applyAllMigrations(database);

      return database;
    };

    it('keeps the loan matcher on its time window, not the partial index', () => {
      const plan = planOf(
        currentDatabase(),
        transactionsRepo.loanMatchCandidatesQuery({ minTime: PAID, currencies: ['UAH'] }),
      );

      expect(plan).toContain('USING INDEX transactions_time');
      expect(plan).not.toContain('transactions_loan_holding_id');
    });

    it('serves the loan-linked payments lookup (IN) from the index', () => {
      const plan = planOf(migratedDatabase(), transactionsRepo.loanLinkedPaymentsQuery(['loan']));

      expect(plan).toContain('USING INDEX transactions_loan_holding_id');
    });

    it('serves an IS NOT NULL lookup from the index', () => {
      const plan = planOf(migratedDatabase(), lookup.where(isNotNull(transactions.loanHoldingId)));

      expect(plan).toContain('USING INDEX transactions_loan_holding_id');
    });

    it('serves an equality lookup from the index', () => {
      const plan = planOf(migratedDatabase(), lookup.where(eq(transactions.loanHoldingId, 'loan')));

      expect(plan).toContain('USING INDEX transactions_loan_holding_id');
    });
  });

  it('changes no row: a linked and an unlinked payment read back as they were', () => {
    const database = databaseThrough0052();

    insertTransaction(database, { id: 'linked', holdingId: 'card', loanHoldingId: 'loan' });
    insertTransaction(database, { id: 'unlinked', holdingId: 'card', loanHoldingId: null });
    const before = allRows(database);

    applyMigration(database);

    expect(allRows(database)).toEqual(before);
    expect(before).toHaveLength(2);
  });
});
