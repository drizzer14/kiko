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

import {
  type database,
  accounts,
  type HoldingRow,
  holdings,
  type TransactionRow,
  transactions,
} from '@kiko/db';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  columnsWithout,
  applyAllMigrations,
  applyMigrationsThrough,
  executingDrizzle,
} from '@kiko/test-support/real-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { asc, getTableColumns } from 'drizzle-orm';
import { transactionsRepo } from '@kiko/transactions/repo';

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
  row: {
    id: string;
    holdingId: string;
    time: number;
    category?: string;
    exchangeCounterpartHoldingId?: string;
    changeGroupId?: string;
  },
): void => {
  run(
    target,
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, category, source, exchange_counterpart_holding_id, change_group_id)
     VALUES (?, ?, 100, ?, ?, 'manual', ?, ?)`,
    row.id,
    row.holdingId,
    row.time,
    row.category ?? null,
    row.exchangeCounterpartHoldingId ?? null,
    row.changeGroupId ?? null,
  );
};

// Every case the migration test pins: an opening, a hand edit over an older
// opening, a same-instant tie, a lookalike under a closing-balance anchor,
// and a categorised row, an exchange leg, and a change return at the anchor.
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
  insertHolding(target, 'exchanged', OPENED);
  insertTransaction(target, {
    id: 'exchange-leg',
    holdingId: 'exchanged',
    time: OPENED,
    exchangeCounterpartHoldingId: 'opened',
  });
  insertHolding(target, 'changed', OPENED);
  insertTransaction(target, {
    id: 'change-return',
    holdingId: 'changed',
    time: OPENED,
    changeGroupId: 'change-group',
  });
};

const markedIds = (target: DatabaseSync): string[] =>
  (
    target.prepare('SELECT id FROM transactions WHERE sets_balance = 1 ORDER BY id').all() as {
      id: string;
    }[]
  ).map((row) => row.id);

const currentRowIds = (target: DatabaseSync): { id: string; balanceSetRowId: string | null }[] =>
  target
    .prepare('SELECT id, balance_set_row_id AS balanceSetRowId FROM holdings ORDER BY id')
    .all() as { id: string; balanceSetRowId: string | null }[];

const readPreMarkerSnapshot = async (source: DatabaseSync): Promise<DataSnapshot> => {
  const sourceDrizzle = executingDrizzle<typeof database>(source);
  const preMarkerHoldings = await sourceDrizzle
    .select(columnsWithout(getTableColumns(holdings), 'balanceSetRowId'))
    .from(holdings)
    .orderBy(asc(holdings.id));
  const preMarkerTransactions = await sourceDrizzle
    .select(columnsWithout(getTableColumns(transactions), 'setsBalance'))
    .from(transactions)
    .orderBy(asc(transactions.id));

  return {
    ...emptySnapshot,
    accounts: await sourceDrizzle.select().from(accounts).orderBy(asc(accounts.id)),
    holdings: preMarkerHoldings as HoldingRow[],
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
    expect(currentRowIds(mockDatabase)).toEqual(currentRowIds(live));
  });
});

describe('restoring a .kiko file that carries the balance-set marker', () => {
  it('keeps every stored marker and current row as exported, even on a re-dated row', async () => {
    const exported = freshDatabase();

    seedPreMarkerLedger(exported);
    run(
      exported,
      "UPDATE transactions SET sets_balance = 1, time = ? WHERE id = 'lookalike'",
      EDITED,
    );
    run(exported, "UPDATE holdings SET balance_set_row_id = 'lookalike' WHERE id = 'imported'");
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
    expect(currentRowIds(mockDatabase)).toEqual(currentRowIds(exported));
  });

  it("moves the balance by the difference when the restored current set's row amount is edited", async () => {
    const exported = freshDatabase();

    run(exported, "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
    insertHolding(exported, 'opened', OPENED);
    insertTransaction(exported, { id: 'opening', holdingId: 'opened', time: EDITED });
    run(exported, "UPDATE transactions SET sets_balance = 1 WHERE id = 'opening'");
    run(exported, "UPDATE holdings SET balance_set_row_id = 'opening' WHERE id = 'opened'");
    const exportedDrizzle = executingDrizzle<typeof database>(exported);
    const snapshot: DataSnapshot = {
      ...emptySnapshot,
      accounts: await exportedDrizzle.select().from(accounts),
      holdings: await exportedDrizzle.select().from(holdings),
      transactions: await exportedDrizzle.select().from(transactions),
    };

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot);
    await transactionsRepo.update({
      transactionId: 'opening',
      amountMinorUnits: 150,
      time: EDITED,
    });

    expect(
      mockDatabase
        .prepare("SELECT balance_minor_units AS value FROM holdings WHERE id = 'opened'")
        .get(),
    ).toEqual({ value: 150 });
  });
});
