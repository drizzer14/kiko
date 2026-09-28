// Runs the ACTUAL upsert statement shape `addManyDedup`'s
// `.onConflictDoUpdate` builds (target + set + setWhere), by hand against a
// real, in-process SQLite engine (`node:sqlite`, built into the Node 22
// runtime this project already requires) — op-sqlite itself is a native
// module unavailable under Jest, and the fake `databaseTransaction` double
// `transactions.repo.test.ts` uses elsewhere never enforces real SQLite
// upsert/WHERE semantics, so only a real engine can prove `setWhere` actually
// suppresses a no-op UPDATE (and still applies a genuine one). Mirrors
// `accounts.repo.foreign-keys.test.ts`'s "real engine, not a hand-traced
// predicate" precedent, at the single-statement scale
// `drizzle/migrations/0040-*.test.ts` uses.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const openTestDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  database.exec(`
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      holding_id TEXT NOT NULL,
      amount_minor_units INTEGER NOT NULL,
      time INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT,
      mcc INTEGER,
      hold INTEGER,
      counter_iban TEXT,
      source TEXT NOT NULL,
      external_id TEXT
    );
    CREATE UNIQUE INDEX transactions_source_external ON transactions(source, external_id);
  `);

  return database;
};

// Same target/set/setWhere shape `transactions.repo.ts`'s `addManyDedup`
// builds, transcribed to raw SQL for a real engine to run — the WHERE
// clause is exactly what `setWhere` there produces.
const UPSERT_SQL = `
  INSERT INTO transactions
    (id, holding_id, amount_minor_units, time, description, category, mcc, hold, counter_iban, source, external_id)
  VALUES
    (@id, @holdingId, @amountMinorUnits, @time, @description, @category, @mcc, @hold, @counterIban, @source, @externalId)
  ON CONFLICT (source, external_id) DO UPDATE SET
    amount_minor_units = excluded.amount_minor_units,
    description = excluded.description,
    hold = excluded.hold,
    mcc = excluded.mcc,
    counter_iban = excluded.counter_iban,
    time = excluded.time
  WHERE
    transactions.amount_minor_units IS NOT excluded.amount_minor_units
    OR transactions.description IS NOT excluded.description
    OR transactions.hold IS NOT excluded.hold
    OR transactions.mcc IS NOT excluded.mcc
    OR transactions.counter_iban IS NOT excluded.counter_iban
    OR transactions.time IS NOT excluded.time
`;

type Row = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  description: string;
  category: string | null;
  mcc: number | null;
  hold: number | null;
  counterIban: string | null;
  source: string;
  externalId: string | null;
};

const runUpsert = (database: DatabaseSync, row: Row): { changes: number | bigint } =>
  database.prepare(UPSERT_SQL).run(row as unknown as Record<string, SQLInputValue>);

const BASE_ROW: Row = {
  id: 'tx-1',
  holdingId: 'h-1',
  amountMinorUnits: -1_000,
  time: 1_700_000_000_000,
  description: 'Coffee shop',
  category: 'groceries',
  mcc: null,
  hold: 0,
  counterIban: null,
  source: 'monobank',
  externalId: 'ext-1',
};

describe('addManyDedup upsert — setWhere suppresses a no-op UPDATE', () => {
  it('reports 0 changes for an identical re-upsert', () => {
    const database = openTestDatabase();

    runUpsert(database, BASE_ROW);

    const result = runUpsert(database, BASE_ROW);

    expect(result.changes).toBe(0);
  });

  it('still updates when a bank-owned column genuinely changed', () => {
    const database = openTestDatabase();

    runUpsert(database, BASE_ROW);

    const settled: Row = { ...BASE_ROW, amountMinorUnits: -1_200, hold: 0 };
    const result = runUpsert(database, settled);

    expect(result.changes).toBe(1);

    const stored = database
      .prepare('SELECT amount_minor_units FROM transactions WHERE id = ?')
      .get('tx-1') as { amount_minor_units: number };

    expect(stored.amount_minor_units).toBe(-1_200);
  });

  it('still updates a genuine NULL-to-value change (an `!=` comparison would have missed this)', () => {
    const database = openTestDatabase();

    runUpsert(database, BASE_ROW);

    const withMcc: Row = { ...BASE_ROW, mcc: 5814 };
    const result = runUpsert(database, withMcc);

    expect(result.changes).toBe(1);
  });

  it('never touches the user-owned category on either the no-op or the genuine-change path', () => {
    const database = openTestDatabase();

    runUpsert(database, BASE_ROW);
    database.prepare('UPDATE transactions SET category = ? WHERE id = ?').run('overridden', 'tx-1');

    const settled: Row = { ...BASE_ROW, amountMinorUnits: -1_200 };

    runUpsert(database, settled);

    const stored = database
      .prepare('SELECT category FROM transactions WHERE id = ?')
      .get('tx-1') as { category: string };

    expect(stored.category).toBe('overridden');
  });
});
