// drizzle/migrations/0040-cleanup-stray-deposit-bond-balance.test.ts
//
// Runs the ACTUAL shipped SQL (not a restated predicate) against a real,
// in-process SQLite engine (`node:sqlite`, built into the Node 22 runtime
// this project already requires — see `package.json`'s `engines`), split on
// the same `--> statement-breakpoint` token `run-migrations.ts` uses. This is
// the strongest available evidence that the migration's WHERE clause can
// only ever match the pre-fix create-time artifact (`0040_cleanup_stray_
// deposit_bond_balance.sql`'s own doc comment states the full WHY) — a real
// SQLite engine, not a hand-traced predicate — since op-sqlite itself is a
// native module unavailable under Jest.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

const migrationStatements = readFileSync(
  join(__dirname, '0040_cleanup_stray_deposit_bond_balance.sql'),
  'utf8',
)
  .split(STATEMENT_BREAKPOINT)
  .map((statement) => statement.trim())
  .filter((statement) => statement !== '');

type HoldingRow = {
  id: string;
  type: string;
  balance_minor_units: number;
  balance_set_at: number | null;
};

type TransactionRow = {
  id: string;
  holding_id: string;
  source: string;
  description: string;
  category: string | null;
  exchange_counterpart_holding_id: string | null;
  change_group_id: string | null;
  amount_minor_units: number;
  time: number;
};

const openTestDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  database.exec(`
    CREATE TABLE holdings (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      balance_minor_units INTEGER NOT NULL DEFAULT 0,
      balance_set_at INTEGER
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      holding_id TEXT NOT NULL,
      source TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT,
      exchange_counterpart_holding_id TEXT,
      change_group_id TEXT,
      amount_minor_units INTEGER NOT NULL,
      time INTEGER NOT NULL
    );
  `);

  return database;
};

const insertHolding = (database: DatabaseSync, holding: HoldingRow): void => {
  database
    .prepare(
      'INSERT INTO holdings (id, type, balance_minor_units, balance_set_at) VALUES (?, ?, ?, ?)',
    )
    .run(holding.id, holding.type, holding.balance_minor_units, holding.balance_set_at);
};

const insertTransaction = (database: DatabaseSync, transaction: TransactionRow): void => {
  database
    .prepare(
      `INSERT INTO transactions
        (id, holding_id, source, description, category, exchange_counterpart_holding_id,
         change_group_id, amount_minor_units, time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      transaction.id,
      transaction.holding_id,
      transaction.source,
      transaction.description,
      transaction.category,
      transaction.exchange_counterpart_holding_id,
      transaction.change_group_id,
      transaction.amount_minor_units,
      transaction.time,
    );
};

const runMigration = (database: DatabaseSync): void => {
  for (const statement of migrationStatements) {
    database.exec(statement);
  }
};

const holdingById = (database: DatabaseSync, id: string): HoldingRow =>
  database.prepare('SELECT * FROM holdings WHERE id = ?').get(id) as unknown as HoldingRow;

const transactionCountFor = (database: DatabaseSync, holdingId: string): number => {
  const row = database
    .prepare('SELECT COUNT(*) AS count FROM transactions WHERE holding_id = ?')
    .get(holdingId) as unknown as { count: number };

  return row.count;
};

// The exact shape `holdingsRepo.create` wrote pre-fix (b062d52): a 'manual'
// row with no description/category/structural marker, its amount and time
// matching the holding's own `balance_minor_units`/`balance_set_at`.
const strayOpeningTransaction = (
  holdingId: string,
  overrides: Partial<TransactionRow> = {},
): TransactionRow => ({
  id: `t-${holdingId}`,
  holding_id: holdingId,
  source: 'manual',
  description: '',
  category: null,
  exchange_counterpart_holding_id: null,
  change_group_id: null,
  amount_minor_units: 50_000,
  time: 1_000,
  ...overrides,
});

// The shared setup both the base "removes a stray artifact" test and the
// "idempotent second run" test start from — one stray term_deposit holding
// with its one matching transaction.
const openWithStrayTermDeposit = (): DatabaseSync => {
  const database = openTestDatabase();
  insertHolding(database, {
    id: 'h1',
    type: 'term_deposit',
    balance_minor_units: 50_000,
    balance_set_at: 1_000,
  });
  insertTransaction(database, strayOpeningTransaction('h1'));

  return database;
};

describe('0040_cleanup_stray_deposit_bond_balance.sql', () => {
  it('removes a stray create-time artifact and zeroes the holding', () => {
    const database = openWithStrayTermDeposit();

    runMigration(database);

    expect(holdingById(database, 'h1')).toEqual({
      id: 'h1',
      type: 'term_deposit',
      balance_minor_units: 0,
      balance_set_at: null,
    });
    expect(transactionCountFor(database, 'h1')).toBe(0);
  });

  it('applies the identical cleanup to the bond twin', () => {
    const database = openTestDatabase();
    insertHolding(database, {
      id: 'h1',
      type: 'bond',
      balance_minor_units: 12_345,
      balance_set_at: 2_000,
    });
    insertTransaction(
      database,
      strayOpeningTransaction('h1', { amount_minor_units: 12_345, time: 2_000 }),
    );

    runMigration(database);

    const holding = holdingById(database, 'h1');
    expect(holding.balance_minor_units).toBe(0);
    expect(holding.balance_set_at).toBeNull();
    expect(transactionCountFor(database, 'h1')).toBe(0);
  });

  it('never touches a non-ledgerless holding with the identical numeric shape', () => {
    const database = openTestDatabase();
    insertHolding(database, {
      id: 'h1',
      type: 'card',
      balance_minor_units: 50_000,
      balance_set_at: 1_000,
    });
    insertTransaction(database, strayOpeningTransaction('h1'));

    runMigration(database);

    expect(holdingById(database, 'h1')).toEqual({
      id: 'h1',
      type: 'card',
      balance_minor_units: 50_000,
      balance_set_at: 1_000,
    });
    expect(transactionCountFor(database, 'h1')).toBe(1);
  });

  it('leaves a deposit/bond holding whose opening row was edited (a real, differently-shaped row)', () => {
    const database = openTestDatabase();
    insertHolding(database, {
      id: 'h1',
      type: 'term_deposit',
      balance_minor_units: 50_000,
      balance_set_at: 1_000,
    });
    insertTransaction(database, strayOpeningTransaction('h1', { description: 'Edited note' }));

    runMigration(database);

    expect(holdingById(database, 'h1')).toEqual({
      id: 'h1',
      type: 'term_deposit',
      balance_minor_units: 50_000,
      balance_set_at: 1_000,
    });
    expect(transactionCountFor(database, 'h1')).toBe(1);
  });

  it('leaves a deposit/bond holding untouched when more than one transaction row exists', () => {
    const database = openTestDatabase();
    insertHolding(database, {
      id: 'h1',
      type: 'term_deposit',
      balance_minor_units: 50_000,
      balance_set_at: 1_000,
    });
    insertTransaction(database, strayOpeningTransaction('h1'));
    insertTransaction(
      database,
      strayOpeningTransaction('h1', { id: 't2', amount_minor_units: 1, time: 5_000 }),
    );

    runMigration(database);

    expect(holdingById(database, 'h1').balance_minor_units).toBe(50_000);
    expect(holdingById(database, 'h1').balance_set_at).toBe(1_000);
    expect(transactionCountFor(database, 'h1')).toBe(2);
  });

  it('leaves an already-clean (post-fix) deposit/bond holding untouched (no-op)', () => {
    const database = openTestDatabase();
    insertHolding(database, {
      id: 'h1',
      type: 'term_deposit',
      balance_minor_units: 0,
      balance_set_at: null,
    });

    runMigration(database);

    expect(holdingById(database, 'h1')).toEqual({
      id: 'h1',
      type: 'term_deposit',
      balance_minor_units: 0,
      balance_set_at: null,
    });
  });

  it('is idempotent: running it a second time changes nothing further', () => {
    const database = openWithStrayTermDeposit();

    runMigration(database);
    const afterFirstRun = holdingById(database, 'h1');

    runMigration(database);

    expect(holdingById(database, 'h1')).toEqual(afterFirstRun);
    expect(transactionCountFor(database, 'h1')).toBe(0);
  });
});
