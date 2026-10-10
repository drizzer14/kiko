// src/data-transfer/snapshot/restore-exchange-pair.two-path.test.ts
//
// A `.kiko` file exported before the exchange pair id existed must restore
// with the same pairs as a live device's own migration 0052 upgrade. Path 1
// runs the real migration SQL on a real engine; path 2 reads an identically
// seeded pre-0052 database the way that older build's export did, then
// restores it through `restoreDataSnapshot`.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

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
import { type database, accounts, holdings, type TransactionRow, transactions } from '@kiko/db';

import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const MIGRATION_0052_SQL = readFileSync(
  join(__dirname, '..', '..', '..', 'drizzle', 'migrations', '0052_add_exchange_pair_id.sql'),
  'utf8',
);

const EXCHANGED = Date.UTC(2026, 8, 12, 10);
const LATER = Date.UTC(2026, 8, 13, 10);

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

const insertHolding = (target: DatabaseSync, id: string, type = 'card'): void => {
  run(
    target,
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
     VALUES (?, 'account', ?, ?, 'UAH', 0)`,
    id,
    id,
    type,
  );
};

const insertTransaction = (
  target: DatabaseSync,
  row: {
    id: string;
    holdingId: string;
    amountMinorUnits: number;
    time?: number;
    source?: string;
    exchangeCounterpartHoldingId?: string;
    changeGroupId?: string;
  },
): void => {
  run(
    target,
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id, exchange_counterpart_holding_id, change_group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.holdingId,
    row.amountMinorUnits,
    row.time ?? EXCHANGED,
    row.source ?? 'manual',
    row.source === undefined || row.source === 'manual' ? null : row.id,
    row.exchangeCounterpartHoldingId ?? null,
    row.changeGroupId ?? null,
  );
};

// Every case the migration test pins: a manual pair, a Convert of a bank row
// and of an imported row, two exchanges in one millisecond, a re-dated leg, an
// orphan, a deposit source leg, a split group, and two legs naming one bank row.
const seedPreFeatureLedger = (target: DatabaseSync): void => {
  run(target, "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");

  for (const holdingId of ['uah', 'usd', 'bank', 'statement']) {
    insertHolding(target, holdingId);
  }

  insertHolding(target, 'deposit', 'term_deposit');
  insertTransaction(target, {
    id: 'z-pair-out',
    holdingId: 'uah',
    amountMinorUnits: -40_000,
    exchangeCounterpartHoldingId: 'usd',
  });
  insertTransaction(target, {
    id: 'a-pair-in',
    holdingId: 'usd',
    amountMinorUnits: 1_000,
    exchangeCounterpartHoldingId: 'uah',
  });
  insertTransaction(target, {
    id: 'convert-leg',
    holdingId: 'usd',
    amountMinorUnits: 1_000,
    time: LATER,
    exchangeCounterpartHoldingId: 'bank',
  });
  insertTransaction(target, {
    id: 'bank-row',
    holdingId: 'bank',
    amountMinorUnits: -40_000,
    time: LATER,
    source: 'monobank',
  });
  insertTransaction(target, {
    id: 'import-convert-leg',
    holdingId: 'usd',
    amountMinorUnits: 2_000,
    time: LATER + 1,
    exchangeCounterpartHoldingId: 'statement',
  });
  insertTransaction(target, {
    id: 'import-row',
    holdingId: 'statement',
    amountMinorUnits: -80_000,
    time: LATER + 1,
    source: 'import',
  });

  for (const suffix of ['one', 'two']) {
    insertTransaction(target, {
      id: `twin-out-${suffix}`,
      holdingId: 'uah',
      amountMinorUnits: -5_000,
      time: LATER + 2,
      exchangeCounterpartHoldingId: 'usd',
    });
    insertTransaction(target, {
      id: `twin-in-${suffix}`,
      holdingId: 'usd',
      amountMinorUnits: 100,
      time: LATER + 2,
      exchangeCounterpartHoldingId: 'uah',
    });
  }

  insertTransaction(target, {
    id: 'redated-out',
    holdingId: 'uah',
    amountMinorUnits: -6_000,
    time: LATER + 3,
    exchangeCounterpartHoldingId: 'usd',
  });
  insertTransaction(target, {
    id: 'redated-in',
    holdingId: 'usd',
    amountMinorUnits: 150,
    time: LATER + 4,
    exchangeCounterpartHoldingId: 'uah',
  });
  insertTransaction(target, {
    id: 'deposit-source',
    holdingId: 'uah',
    amountMinorUnits: -50_000,
    time: LATER + 5,
    exchangeCounterpartHoldingId: 'deposit',
  });
  insertTransaction(target, {
    id: 'split-payment',
    holdingId: 'uah',
    amountMinorUnits: -7_000,
    time: LATER + 6,
    exchangeCounterpartHoldingId: 'usd',
    changeGroupId: 'group',
  });
  insertTransaction(target, {
    id: 'split-return',
    holdingId: 'usd',
    amountMinorUnits: 100,
    time: LATER + 6,
    exchangeCounterpartHoldingId: 'uah',
    changeGroupId: 'group',
  });
  insertTransaction(target, {
    id: 'shared-leg-one',
    holdingId: 'usd',
    amountMinorUnits: 300,
    time: LATER + 7,
    exchangeCounterpartHoldingId: 'bank',
  });
  insertTransaction(target, {
    id: 'shared-leg-two',
    holdingId: 'usd',
    amountMinorUnits: 300,
    time: LATER + 7,
    exchangeCounterpartHoldingId: 'bank',
  });
  insertTransaction(target, {
    id: 'shared-bank-row',
    holdingId: 'bank',
    amountMinorUnits: -12_000,
    time: LATER + 7,
    source: 'monobank',
  });
};

const pairIds = (target: DatabaseSync): Record<string, string | null> =>
  Object.fromEntries(
    (
      target.prepare('SELECT id, exchange_pair_id AS pairId FROM transactions').all() as {
        id: string;
        pairId: string | null;
      }[]
    ).map((row) => [row.id, row.pairId]),
  );

const readPreFeatureSnapshot = async (source: DatabaseSync): Promise<DataSnapshot> => {
  const sourceDrizzle = executingDrizzle<typeof database>(source);
  const preFeatureTransactions = await sourceDrizzle
    .select(columnsWithout(getTableColumns(transactions), 'exchangePairId', 'untrackedCounterpart'))
    .from(transactions)
    .orderBy(asc(transactions.id));

  return {
    ...emptySnapshot,
    accounts: await sourceDrizzle.select().from(accounts).orderBy(asc(accounts.id)),
    holdings: await sourceDrizzle.select().from(holdings).orderBy(asc(holdings.id)),
    transactions: preFeatureTransactions as TransactionRow[],
  };
};

const freshDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);

  return target;
};

describe('restoring a .kiko file exported before the exchange pair id', () => {
  it('derives the same pairs as the live migration 0052 upgrade', async () => {
    const live = new DatabaseSync(':memory:');

    applyMigrationsThrough(live, '0051_monobank_accounts_bank_id');
    seedPreFeatureLedger(live);

    for (const statement of MIGRATION_0052_SQL.split('--> statement-breakpoint')) {
      live.exec(statement);
    }

    const exported = new DatabaseSync(':memory:');

    applyMigrationsThrough(exported, '0051_monobank_accounts_bank_id');
    seedPreFeatureLedger(exported);
    const snapshot = await readPreFeatureSnapshot(exported);

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot);

    expect(pairIds(live)).toMatchObject({
      'z-pair-out': 'a-pair-in',
      'a-pair-in': 'a-pair-in',
      'convert-leg': 'bank-row',
      'bank-row': 'bank-row',
      'import-convert-leg': 'import-convert-leg',
      'import-row': 'import-convert-leg',
      'twin-out-one': null,
      'redated-out': null,
      'deposit-source': null,
      'split-payment': null,
      'shared-leg-one': null,
      'shared-bank-row': null,
    });
    expect(pairIds(mockDatabase)).toEqual(pairIds(live));
  });
});

describe('restoring a .kiko file that carries the exchange pair id', () => {
  it('keeps every stored id as exported, a null on a provable pair included', async () => {
    const exported = freshDatabase();

    seedPreFeatureLedger(exported);
    run(exported, "UPDATE transactions SET exchange_pair_id = 'chosen' WHERE id = 'a-pair-in'");
    const exportedDrizzle = executingDrizzle<typeof database>(exported);
    const snapshot: DataSnapshot = {
      ...emptySnapshot,
      accounts: await exportedDrizzle.select().from(accounts),
      holdings: await exportedDrizzle.select().from(holdings),
      transactions: await exportedDrizzle.select().from(transactions),
    };

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot);

    expect(pairIds(mockDatabase)).toEqual(pairIds(exported));
    expect(pairIds(mockDatabase)['a-pair-in']).toBe('chosen');
    expect(pairIds(mockDatabase)['z-pair-out']).toBeNull();
  });
});
