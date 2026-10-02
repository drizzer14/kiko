// Builds the ACTUAL SQL/params Drizzle generates for `importRows`'s
// existing-rows-after-asOf read — never a hand-transcribed copy of it — via
// a `drizzle-orm/sqlite-proxy` instance whose remote callback is never
// invoked (`.toSQL()` only compiles the query, it never executes it),
// reusing that read's own exported `postClosingRowsWhere`. That exact SQL is
// then run against a real, in-process `node:sqlite` engine — op-sqlite
// itself is a native module unavailable under Jest, and the fake
// `databaseTransaction` double `transactions.repo.test.ts` uses elsewhere
// never enforces real SQLite WHERE semantics, so only a real engine can
// prove the STRICT `gt` boundary (a row exactly AT asOf is not counted) and
// the `holdingId` scope (another holding's rows are not counted).
import { sql } from 'drizzle-orm';
import { transactions } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations, toSqlOnlyDrizzle } from '@kiko/test-support/real-sqlite';

import { postClosingRowsWhere } from './transactions.repo';

const proxyDb = toSqlOnlyDrizzle();

// The exact statement the existing-rows-after-asOf read builds — mirrors it
// precisely, since it reuses that read's own exported `postClosingRowsWhere`
// rather than restating the WHERE clause.
// A raw `node:sqlite` `.get()` reads a result by its own SQL column name
// (Drizzle's real execution path maps a computed column back to `net` by
// SELECTION POSITION instead, which this bypass doesn't have), so the
// aggregate column is aliased explicitly here — the WHERE clause under test
// is still the exact one `postClosingRowsWhere` builds.
const netSql = (holdingId: string, asOfMillis: number): { sql: string; params: unknown[] } =>
  proxyDb
    .select({ net: sql<number | null>`sum(${transactions.amountMinorUnits}) as net` })
    .from(transactions)
    .where(postClosingRowsWhere(holdingId, asOfMillis))
    .toSQL();

// `client.ts` enables `PRAGMA foreign_keys` in production, so `holding_id`
// needs a real target row — two holdings, to prove the read is scoped to
// only one of them.
const openTestDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON;');
  database
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('a-1', 'Monobank', 'bank')")
    .run();
  database
    .prepare(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('h-1', 'a-1', 'Card', 'card', 'UAH')",
    )
    .run();
  database
    .prepare(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('h-2', 'a-1', 'Other Card', 'card', 'UAH')",
    )
    .run();

  return database;
};

type TransactionRow = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  setsBalance?: boolean;
};

const insertTransaction = (database: DatabaseSync, row: TransactionRow): void => {
  database
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, sets_balance)
       VALUES (?, ?, ?, ?, 'manual', ?)`,
    )
    .run(row.id, row.holdingId, row.amountMinorUnits, row.time, row.setsBalance ? 1 : 0);
};

const netAfterAsOf = (
  database: DatabaseSync,
  holdingId: string,
  asOfMillis: number,
): number | null => {
  const { sql: statement, params } = netSql(holdingId, asOfMillis);
  const result = database.prepare(statement).get(...(params as (string | number | null)[])) as {
    net: number | null;
  };

  return result.net;
};

describe('postClosingRowsWhere — existing-rows-after-asOf read, against a real SQLite engine', () => {
  const AS_OF_MILLISECONDS = 1_700_000_000_000;

  it('excludes a row exactly AT asOf (the boundary belongs to the closing balance itself)', () => {
    const database = openTestDatabase();

    insertTransaction(database, {
      id: 'tx-1',
      holdingId: 'h-1',
      amountMinorUnits: -500,
      time: AS_OF_MILLISECONDS,
    });

    expect(netAfterAsOf(database, 'h-1', AS_OF_MILLISECONDS)).toBeNull();
  });

  it('counts a row strictly after asOf', () => {
    const database = openTestDatabase();

    insertTransaction(database, {
      id: 'tx-1',
      holdingId: 'h-1',
      amountMinorUnits: -500,
      time: AS_OF_MILLISECONDS + 1_000,
    });

    expect(netAfterAsOf(database, 'h-1', AS_OF_MILLISECONDS)).toBe(-500);
  });

  it("excludes another holding's row, even one strictly after asOf", () => {
    const database = openTestDatabase();

    insertTransaction(database, {
      id: 'tx-1',
      holdingId: 'h-2',
      amountMinorUnits: -700,
      time: AS_OF_MILLISECONDS + 1_000,
    });

    expect(netAfterAsOf(database, 'h-1', AS_OF_MILLISECONDS)).toBeNull();
  });

  // Its amount is part of a balance that was set, so a re-date past the
  // as-of must not add it to the closing figure.
  it('excludes a row that set a balance, even one strictly after asOf', () => {
    const database = openTestDatabase();

    insertTransaction(database, {
      id: 'tx-opening',
      holdingId: 'h-1',
      amountMinorUnits: 2_000,
      time: AS_OF_MILLISECONDS + 1_000,
      setsBalance: true,
    });

    expect(netAfterAsOf(database, 'h-1', AS_OF_MILLISECONDS)).toBeNull();
  });

  it('sums every after-asOf row for the correct holding, ignoring the at-boundary row and the other holding', () => {
    const database = openTestDatabase();

    insertTransaction(database, {
      id: 'tx-at-boundary',
      holdingId: 'h-1',
      amountMinorUnits: -100,
      time: AS_OF_MILLISECONDS,
    });
    insertTransaction(database, {
      id: 'tx-other-holding',
      holdingId: 'h-2',
      amountMinorUnits: -900,
      time: AS_OF_MILLISECONDS + 1_000,
    });
    insertTransaction(database, {
      id: 'tx-after-1',
      holdingId: 'h-1',
      amountMinorUnits: -500,
      time: AS_OF_MILLISECONDS + 1_000,
    });
    insertTransaction(database, {
      id: 'tx-after-2',
      holdingId: 'h-1',
      amountMinorUnits: 200,
      time: AS_OF_MILLISECONDS + 2_000,
    });

    expect(netAfterAsOf(database, 'h-1', AS_OF_MILLISECONDS)).toBe(-300);
  });
});
