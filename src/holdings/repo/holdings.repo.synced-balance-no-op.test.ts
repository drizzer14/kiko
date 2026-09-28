// Runs the ACTUAL update statement shape `setSyncedBalance` builds (a WHERE
// clause narrowed by an `IS NOT` balance comparison), by hand against a real,
// in-process SQLite engine (`node:sqlite`) — op-sqlite itself is a native
// module unavailable under Jest, and the fake `databaseTransaction` double
// `holdings.repo.test.ts` uses elsewhere never enforces real SQLite WHERE
// semantics, so only a real engine can prove the write is skipped when the
// synced balance already matches (and still applies when it does not).
// Mirrors `accounts.repo.foreign-keys.test.ts`'s "real engine, not a
// hand-traced predicate" precedent.
import { DatabaseSync } from 'node:sqlite';

const openTestDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  database.exec(`
    CREATE TABLE holdings (
      id TEXT PRIMARY KEY,
      synced_balance_minor_units INTEGER
    );
  `);
  database
    .prepare('INSERT INTO holdings (id, synced_balance_minor_units) VALUES (?, ?)')
    .run('h-1', 5_000);

  return database;
};

const storedBalance = (database: DatabaseSync): number | null => {
  const row = database
    .prepare('SELECT synced_balance_minor_units AS value FROM holdings WHERE id = ?')
    .get('h-1') as { value: number | null };

  return row.value;
};

const clearStoredBalance = (database: DatabaseSync): void => {
  database.prepare('UPDATE holdings SET synced_balance_minor_units = NULL WHERE id = ?').run('h-1');
};

// Same WHERE shape `holdingsRepo.setSyncedBalance` builds — `IS NOT`, not
// `!=`, so a never-synced-through holding's NULL marker still updates on its
// first real balance.
const UPDATE_SQL = `
  UPDATE holdings
  SET synced_balance_minor_units = ?
  WHERE id = ? AND synced_balance_minor_units IS NOT ?
`;

describe('setSyncedBalance update — skips a no-op write', () => {
  it('reports 0 changes when the synced balance already matches', () => {
    const database = openTestDatabase();

    const result = database.prepare(UPDATE_SQL).run(5_000, 'h-1', 5_000);

    expect(result.changes).toBe(0);
  });

  it('still updates when the synced balance genuinely changed', () => {
    const database = openTestDatabase();

    const result = database.prepare(UPDATE_SQL).run(6_000, 'h-1', 6_000);
    const stored = storedBalance(database);

    expect(result.changes).toBe(1);
    expect(stored).toBe(6_000);
  });

  it('still updates a never-synced-through holding (NULL marker) on its first real balance', () => {
    const database = openTestDatabase();

    clearStoredBalance(database);

    const result = database.prepare(UPDATE_SQL).run(5_000, 'h-1', 5_000);

    expect(result.changes).toBe(1);
  });
});
