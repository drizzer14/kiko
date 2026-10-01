// src/data-transfer/snapshot/restore-sets-balance.two-path.test.ts
//
// A `.kiko` file exported before the balance-set marker existed must restore
// with the same rows marked as a live device's own migration 0047 upgrade.
// Path 1 runs the real migration SQL on a real engine; path 2 reads an
// identically seeded pre-0047 database the way that older build's export
// did, then restores it through `restoreDataSnapshot`.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  applyAllMigrations,
  applyMigrationsThrough,
  executingDrizzle,
} from '@kiko/test-support/real-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { asc, getTableColumns } from 'drizzle-orm';
import { type database, accounts, holdings, type TransactionRow, transactions } from '@kiko/db';

import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const MIGRATION_0047_SQL = readFileSync(
  join(__dirname, '..', '..', '..', 'drizzle', 'migrations', '0047_add_sets_balance.sql'),
  'utf8',
);

const OPENED = Date.UTC(2026, 8, 1, 9);
const EDITED = Date.UTC(2026, 8, 10, 9);
const CLOSED = Date.UTC(2026, 8, 30, 21);

const emptySnapshot: DataSnapshot = {
  accounts: [],
  holdings: [],
  transactions: [],
  currencyRates: [],
  currencyRateHistory: [],
  settings: [],
  syncState: [],
  categories: [],
  categoryOverrides: [],
  pricePoints: [],
  bondRegister: [],
  reminders: [],
};

const run = (
  target: DatabaseSync,
  statement: string,
  ...parameters: (string | number | null)[]
): void => {
  target.prepare(statement).run(...parameters);
};

const insertHolding = (target: DatabaseSync, id: string, balanceSetAt: number | null): void => {
  run(
    target,
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, balance_set_at)
     VALUES (?, 'account', ?, 'card', 'UAH', 100, ?)`,
    id,
    id,
    balanceSetAt,
  );
};

const insertTransaction = (
  target: DatabaseSync,
  row: { id: string; holdingId: string; time: number; category?: string },
): void => {
  run(
    target,
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, category, source)
     VALUES (?, ?, 100, ?, ?, 'manual')`,
    row.id,
    row.holdingId,
    row.time,
    row.category ?? null,
  );
};

// Every case the migration test pins: an opening, a hand edit over an older
// opening, a same-instant tie, a lookalike under a closing-balance anchor,
// and a categorised row at the anchor.
const seedPreMarkerLedger = (target: DatabaseSync): void => {
  run(target, "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  insertHolding(target, 'opened', OPENED);
  insertTransaction(target, { id: 'opening', holdingId: 'opened', time: OPENED });
  insertHolding(target, 'edited', EDITED);
  insertTransaction(target, { id: 'edited-opening', holdingId: 'edited', time: OPENED });
  insertTransaction(target, { id: 'edited-adjustment', holdingId: 'edited', time: EDITED });
  insertHolding(target, 'tied', OPENED);
  insertTransaction(target, { id: 'tie-b', holdingId: 'tied', time: OPENED });
  insertTransaction(target, { id: 'tie-a', holdingId: 'tied', time: OPENED });
  insertHolding(target, 'imported', CLOSED);
  insertTransaction(target, { id: 'lookalike', holdingId: 'imported', time: OPENED });
  insertHolding(target, 'categorised', OPENED);
  insertTransaction(target, {
    id: 'categorised-row',
    holdingId: 'categorised',
    time: OPENED,
    category: 'groceries',
  });
};

const markedIds = (target: DatabaseSync): string[] =>
  (
    target.prepare('SELECT id FROM transactions WHERE sets_balance = 1 ORDER BY id').all() as {
      id: string;
    }[]
  ).map((row) => row.id);

const preMarkerTransactionColumns = Object.fromEntries(
  Object.entries(getTableColumns(transactions)).filter(([name]) => name !== 'setsBalance'),
);

const readPreMarkerSnapshot = async (source: DatabaseSync): Promise<DataSnapshot> => {
  const sourceDrizzle = executingDrizzle<typeof database>(source);
  const preMarkerTransactions = await sourceDrizzle
    .select(preMarkerTransactionColumns)
    .from(transactions)
    .orderBy(asc(transactions.id));

  return {
    ...emptySnapshot,
    accounts: await sourceDrizzle.select().from(accounts).orderBy(asc(accounts.id)),
    holdings: await sourceDrizzle.select().from(holdings).orderBy(asc(holdings.id)),
    transactions: preMarkerTransactions as TransactionRow[],
  };
};

const freshDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);

  return target;
};

describe('restoring a .kiko file exported before the balance-set marker', () => {
  it('marks the same rows as the live migration 0047 upgrade', async () => {
    const live = new DatabaseSync(':memory:');

    applyMigrationsThrough(live, '0046_add_quote_quota');
    seedPreMarkerLedger(live);
    live.exec(MIGRATION_0047_SQL.split('--> statement-breakpoint').join('\n'));

    const exported = new DatabaseSync(':memory:');

    applyMigrationsThrough(exported, '0046_add_quote_quota');
    seedPreMarkerLedger(exported);
    const snapshot = await readPreMarkerSnapshot(exported);

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot);

    expect(markedIds(live)).toEqual(['edited-adjustment', 'opening', 'tie-a']);
    expect(markedIds(mockDatabase)).toEqual(markedIds(live));
  });
});

describe('restoring a .kiko file that carries the balance-set marker', () => {
  it('keeps every stored marker as exported, even on a re-dated row', async () => {
    const exported = freshDatabase();

    seedPreMarkerLedger(exported);
    run(
      exported,
      "UPDATE transactions SET sets_balance = 1, time = ? WHERE id = 'lookalike'",
      EDITED,
    );
    const exportedDrizzle = executingDrizzle<typeof database>(exported);
    const snapshot: DataSnapshot = {
      ...emptySnapshot,
      accounts: await exportedDrizzle.select().from(accounts),
      holdings: await exportedDrizzle.select().from(holdings),
      transactions: await exportedDrizzle.select().from(transactions),
    };

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot);

    expect(markedIds(mockDatabase)).toEqual(['lookalike']);
  });
});
