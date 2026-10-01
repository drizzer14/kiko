// drizzle/migrations/0047-add-sets-balance.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the backfill is proven against real rows, not
// a restated predicate.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsBetween, applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0047_add_sets_balance.sql'), 'utf8');

const OPENED = Date.UTC(2026, 8, 1, 9);
const EDITED = Date.UTC(2026, 8, 10, 9);
const CLOSED = Date.UTC(2026, 8, 30, 21);

type TransactionSeed = {
  id: string;
  holdingId: string;
  time: number;
  description?: string;
  category?: string | null;
  source?: string;
  externalId?: string | null;
};

const run = (
  database: DatabaseSync,
  statement: string,
  ...parameters: (string | number | null)[]
) => {
  database.prepare(statement).run(...parameters);
};

const insertHolding = (database: DatabaseSync, id: string, type = 'card'): void => {
  run(
    database,
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
     VALUES (?, 'account', ?, ?, 'UAH', 100)`,
    id,
    id,
    type,
  );
};

const setBalanceSetAt = (database: DatabaseSync, holdingId: string, time: number): void => {
  run(database, 'UPDATE holdings SET balance_set_at = ? WHERE id = ?', time, holdingId);
};

const insertTransaction = (database: DatabaseSync, row: TransactionSeed): void => {
  run(
    database,
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category, source, external_id)
     VALUES (?, ?, 100, ?, ?, ?, ?, ?)`,
    row.id,
    row.holdingId,
    row.time,
    row.description ?? '',
    row.category ?? null,
    row.source ?? 'manual',
    row.externalId ?? null,
  );
};

const applyMigration = (database: DatabaseSync): void => {
  database.exec(MIGRATION_SQL.split('--> statement-breakpoint').join('\n'));
};

const markedIds = (database: DatabaseSync): string[] =>
  (
    database.prepare('SELECT id FROM transactions WHERE sets_balance = 1 ORDER BY id').all() as {
      id: string;
    }[]
  ).map((row) => row.id);

const databaseThrough = (tag: string): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, tag);
  run(database, "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");

  return database;
};

describe('migration 0047: the stored balance-set marker', () => {
  it('marks the one balance-set row of each holding, at its balance_set_at', () => {
    const database = databaseThrough('0046_add_quote_quota');

    insertHolding(database, 'opened');
    setBalanceSetAt(database, 'opened', OPENED);
    insertTransaction(database, { id: 'opening', holdingId: 'opened', time: OPENED });

    insertHolding(database, 'edited');
    setBalanceSetAt(database, 'edited', EDITED);
    insertTransaction(database, { id: 'edited-opening', holdingId: 'edited', time: OPENED });
    insertTransaction(database, { id: 'edited-adjustment', holdingId: 'edited', time: EDITED });

    insertHolding(database, 'wallet', 'cash');
    setBalanceSetAt(database, 'wallet', OPENED);
    insertTransaction(database, { id: 'cash-opening', holdingId: 'wallet', time: OPENED });

    applyMigration(database);

    expect(markedIds(database)).toEqual(['cash-opening', 'edited-adjustment', 'opening']);
  });

  it('marks no lookalike row: one not at balance_set_at, one with a category, one with a description, one with no anchor', () => {
    const database = databaseThrough('0046_add_quote_quota');

    insertHolding(database, 'imported');
    setBalanceSetAt(database, 'imported', CLOSED);
    insertTransaction(database, { id: 'lookalike', holdingId: 'imported', time: OPENED });
    insertTransaction(database, {
      id: 'statement-row',
      holdingId: 'imported',
      time: CLOSED,
      source: 'import',
      externalId: 'statement-row',
    });

    insertHolding(database, 'categorised');
    setBalanceSetAt(database, 'categorised', OPENED);
    insertTransaction(database, {
      id: 'categorised-row',
      holdingId: 'categorised',
      time: OPENED,
      category: 'groceries',
    });

    insertHolding(database, 'described');
    setBalanceSetAt(database, 'described', OPENED);
    insertTransaction(database, {
      id: 'described-row',
      holdingId: 'described',
      time: OPENED,
      description: 'Coffee',
    });

    insertHolding(database, 'unanchored');
    insertTransaction(database, { id: 'unanchored-row', holdingId: 'unanchored', time: OPENED });

    applyMigration(database);

    expect(markedIds(database)).toEqual([]);
  });

  // Two rows of one holding qualify only when they share the same
  // millisecond, and then nothing stored tells them apart but the id. The
  // smallest id is the one rule a `.kiko` restore can repeat exactly: it
  // carries ids verbatim but not the insertion order.
  it('marks only the smallest id when two rows of one holding qualify', () => {
    const database = databaseThrough('0046_add_quote_quota');

    insertHolding(database, 'opened');
    setBalanceSetAt(database, 'opened', OPENED);
    insertTransaction(database, { id: 'b-opening', holdingId: 'opened', time: OPENED });
    insertTransaction(database, { id: 'a-opening', holdingId: 'opened', time: OPENED });

    applyMigration(database);

    expect(markedIds(database)).toEqual(['a-opening']);
  });

  it('marks the row migration 0036 backfilled the anchor from', () => {
    const database = databaseThrough('0035_add_price_points');

    insertHolding(database, 'legacy');
    insertTransaction(database, { id: 'legacy-opening', holdingId: 'legacy', time: OPENED });
    insertTransaction(database, { id: 'legacy-adjustment', holdingId: 'legacy', time: EDITED });
    insertTransaction(database, {
      id: 'legacy-purchase',
      holdingId: 'legacy',
      time: CLOSED,
      category: 'groceries',
    });

    applyMigrationsBetween(database, '0035_add_price_points', '0046_add_quote_quota');
    applyMigration(database);

    expect(markedIds(database)).toEqual(['legacy-adjustment']);
  });

  it('leaves a new row unmarked by default', () => {
    const database = databaseThrough('0046_add_quote_quota');

    applyMigration(database);
    insertHolding(database, 'opened');
    insertTransaction(database, { id: 'later', holdingId: 'opened', time: OPENED });

    expect(markedIds(database)).toEqual([]);
  });
});
