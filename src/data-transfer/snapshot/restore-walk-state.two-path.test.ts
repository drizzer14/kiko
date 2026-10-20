// src/data-transfer/snapshot/restore-walk-state.two-path.test.ts
//
// A `.kiko` file written before the walk state column carries the Binance walk keys on the Spot
// BTC holding's metadata and no `exchangeState` on its sync state rows. It must restore to the
// same database as a live device that ran migration 0061 on the same data. Path 1 runs the copy
// statement of the shipped 0061 SQL on the seeded database; path 2 exports the same seed, drops
// the key an older file never had, and restores it on a fresh database.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  addAccountCurrencyColumn,
  addTransactionOperationColumn,
  applyAllMigrations,
  applyMigrationsThrough,
} from '@kiko/test-support/real-sqlite';
import { DatabaseSync } from 'node:sqlite';
import maybe, { foldMap } from 'fnts/maybe';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';

import { EXPORT_VERSION } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { LEGACY_WALK_KEYS } from './legacy-walk-keys';
import { restoreDataSnapshot } from './restore-snapshot';

const EXCHANGE_STATE_STATEMENTS = readFileSync(
  join(__dirname, '..', '..', '..', 'drizzle', 'migrations', '0061_exchange_state.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim());

const ADD_COLUMN_STATEMENT = EXCHANGE_STATE_STATEMENTS[0] ?? '';
const COPY_STATEMENT = EXCHANGE_STATE_STATEMENTS[1] ?? '';

const JSON_COLUMNS = ['metadata', 'exchange_state'];

const parsedOrText = (value: unknown): unknown => {
  try {
    return JSON.parse(value as string);
  } catch {
    return value;
  }
};

// The database a build before the column left behind, plus the column: the snapshot reader
// selects it, and the copy statement fills it.
const databaseBeforeCopy = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyMigrationsThrough(target, '0060_add_history_backfill_state');
  target.exec(ADD_COLUMN_STATEMENT);
  addAccountCurrencyColumn(target);
  addTransactionOperationColumn(target);
  // A restore inserts the settings row when a file has none, and marks the import times as
  // rezoned, so the database has it the same.
  target.exec('INSERT INTO settings (id, import_times_rezoned) VALUES (1, 1);');
  target.exec('PRAGMA foreign_keys = ON;');

  return target;
};

const freshDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);
  target.exec('PRAGMA foreign_keys = ON;');

  return target;
};

const insertAccount = (
  target: DatabaseSync,
  id: string,
  institution: string | null = 'binance',
) => {
  target
    .prepare("INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, 'crypto', ?)")
    .run(id, id, institution);
};

const insertHolding = (
  target: DatabaseSync,
  accountId: string,
  id: string,
  metadata: unknown,
  sortOrder = 0,
  createdAt = 1,
): void => {
  target
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, metadata, sort_order, created_at)
       VALUES (?, ?, ?, 'crypto_asset', 'BTC', ?, ?, ?)`,
    )
    .run(id, accountId, id, JSON.stringify(metadata), sortOrder, createdAt);
};

const metadataOf = (fields: Record<string, unknown>, binanceAsset = 'BTC') => ({
  binanceAsset,
  syncedAt: 1_700_000_000_000,
  ...fields,
});

const seedSpot = (
  target: DatabaseSync,
  accountId: string,
  fields: Record<string, unknown>,
  institution: string | null = 'binance',
): void => {
  insertAccount(target, accountId, institution);
  insertHolding(target, accountId, `${accountId}-spot`, metadataOf(fields));
};

// The map the shipped SQL carries, read from the file: a key the code forgets or sends to
// another entry fails against the real statement, not against a copy of the code's own table.
const SQL_KEY_MAP = [...COPY_STATEMENT.matchAll(/\('(\w+)', '(\w+)', '\$\.(\w+)'\)/g)].map(
  ([, walk, field, key]) => [walk, field, key],
);

type Seed = { name: string; rows: number; seed: (target: DatabaseSync) => void };

// Every class the copy statement tells apart: each key, a floor value, a malformed value of each
// type, a present null, a list kept a list, the first holding by `(sort_order, created_at)`,
// the first holding without a key, a Funding or non-BTC holding, and metadata that is no record.
const SEEDS: Seed[] = [
  {
    name: 'an account with a walk key, no state row yet',
    rows: 1,
    seed: (target) => seedSpot(target, 'account', { binanceHistoryCursor: 1000 }),
  },
  {
    name: 'an account with a walk key and a state row that has stamps',
    rows: 1,
    seed: (target) => {
      seedSpot(target, 'account', { binanceHistoryCursor: 1000 });
      target
        .prepare(
          `INSERT INTO sync_state (account_id, last_sync_at, last_full_sync_at, last_sync_display_at)
           VALUES ('account', 11, 22, 33)`,
        )
        .run();
    },
  },
  {
    name: 'a disconnected account keeps its floor values',
    rows: 1,
    seed: (target) =>
      seedSpot(
        target,
        'account',
        {
          binanceHistoryCursor: Date.UTC(2017, 6, 14),
          binanceHistoryRescanCursor: Date.UTC(2017, 6, 14),
          binanceHistoryPendingOverlap: [],
          binanceEarnHistoryCursor: Date.UTC(2017, 6, 14),
        },
        null,
      ),
  },
  {
    name: 'every one of the 24 walk keys',
    rows: 1,
    seed: (target) =>
      seedSpot(
        target,
        'account',
        Object.fromEntries(SQL_KEY_MAP.map(([, , key], index) => [key, 1_700_000_000_000 + index])),
      ),
  },
  {
    name: 'a walk with only a cursor',
    rows: 1,
    seed: (target) => seedSpot(target, 'account', { binancePayHistoryCursor: 5 }),
  },
  {
    name: 'a malformed pending value of each type',
    rows: 3,
    seed: (target) => {
      seedSpot(target, 'string-pending', { binancePayPendingOverlap: 'oops' });
      seedSpot(target, 'boolean-pending', { binancePayPendingOverlap: true });
      seedSpot(target, 'object-pending', { binancePayPendingOverlap: { start: 1 } });
    },
  },
  {
    name: 'a list that stays a list and a text that stays text',
    rows: 2,
    seed: (target) => {
      seedSpot(target, 'text-list', { binancePayPendingOverlap: '[1]' });
      seedSpot(target, 'array-list', { binancePayPendingOverlap: [1] });
    },
  },
  {
    name: 'a present JSON null beside a cursor',
    rows: 1,
    seed: (target) =>
      seedSpot(target, 'account', {
        binancePayHistoryCursor: 5,
        binancePayPendingOverlap: null,
        binancePayPointCursor: null,
      }),
  },
  {
    name: 'two Spot BTC holdings, the first by sort order and then by creation time',
    rows: 2,
    seed: (target) => {
      insertAccount(target, 'by-sort-order');
      insertHolding(
        target,
        'by-sort-order',
        'later',
        metadataOf({ binanceHistoryCursor: 111 }),
        1,
        1,
      );
      insertHolding(
        target,
        'by-sort-order',
        'first',
        metadataOf({ binanceHistoryCursor: 222 }),
        0,
        9,
      );
      insertAccount(target, 'by-created-at');
      insertHolding(
        target,
        'by-created-at',
        'newer',
        metadataOf({ binanceHistoryCursor: 333 }),
        2,
        10,
      );
      insertHolding(
        target,
        'by-created-at',
        'older',
        metadataOf({ binanceHistoryCursor: 444 }),
        2,
        5,
      );
    },
  },
  {
    name: 'a first Spot BTC holding without a key, a second one with a cursor',
    rows: 0,
    seed: (target) => {
      insertAccount(target, 'account');
      insertHolding(target, 'account', 'first', metadataOf({}), 0, 1);
      insertHolding(target, 'account', 'second', metadataOf({ binanceHistoryCursor: 5 }), 1, 2);
    },
  },
  {
    name: 'a Spot BTC holding without a walk key',
    rows: 0,
    seed: (target) => seedSpot(target, 'account', {}),
  },
  {
    name: 'a Funding holding and a holding of another coin',
    rows: 0,
    seed: (target) => {
      insertAccount(target, 'account');
      insertHolding(
        target,
        'account',
        'funding',
        metadataOf({ binanceHistoryCursor: 5 }, 'BTC:funding'),
      );
      insertHolding(target, 'account', 'ether', metadataOf({ binanceHistoryCursor: 6 }, 'ETH'));
    },
  },
  {
    name: 'holdings whose metadata is JSON but no record',
    rows: 1,
    seed: (target) => {
      insertAccount(target, 'account');
      insertHolding(target, 'account', 'list', [1, 2], 0, 1);
      insertHolding(target, 'account', 'text', 'text', 1, 1);
      insertHolding(target, 'account', 'number', 7, 2, 1);
      insertHolding(target, 'account', 'spot', metadataOf({ binanceHistoryCursor: 9 }), 3, 1);
    },
  },
];

const tablesOf = (target: DatabaseSync): Record<string, unknown[]> => {
  const names = (
    target
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%drizzle%'`,
      )
      .all() as { name: string }[]
  ).map((table) => table.name);

  return Object.fromEntries(
    names.map((name) => [
      name,
      (target.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[])
        .map((tableRow) =>
          Object.fromEntries(
            Object.entries(tableRow).map(([column, value]) => [
              column,
              JSON_COLUMNS.includes(column) ? parsedOrText(value) : value,
            ]),
          ),
        )
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    ]),
  );
};

const stateRowsOf = (target: DatabaseSync): Record<string, unknown>[] =>
  target.prepare('SELECT * FROM sync_state ORDER BY account_id').all() as Record<string, unknown>[];

const exported = async (source: DatabaseSync): Promise<DataSnapshot> => {
  mockDatabase = source;

  return JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;
};

// A file written before the column has no `exchangeState` key on its rows at all.
const withoutExchangeState = (snapshot: DataSnapshot): DataSnapshot => ({
  ...snapshot,
  syncState: snapshot.syncState.map(({ exchangeState: _dropped, ...row }) => row as never),
});

const restored = async (snapshot: DataSnapshot): Promise<DatabaseSync> => {
  const target = freshDatabase();

  mockDatabase = target;
  await restoreDataSnapshot(snapshot, EXPORT_VERSION);

  return target;
};

describe('restoring a .kiko file written before the walk state column', () => {
  it('keeps the key map equal to the one in the shipped 0061 SQL', () => {
    expect(SQL_KEY_MAP).toHaveLength(24);
    expect(LEGACY_WALK_KEYS).toEqual(SQL_KEY_MAP);
  });

  it.each(SEEDS)(
    'a backup without walk state restores equal to the migrated database: $name',
    async ({ rows, seed }) => {
      const source = databaseBeforeCopy();

      seed(source);

      const snapshot = withoutExchangeState(await exported(source));

      source.exec(COPY_STATEMENT);

      const result = await restored(snapshot);

      expect(stateRowsOf(source)).toHaveLength(rows);
      expect(tablesOf(result)).toEqual(tablesOf(source));
    },
  );

  it('adds a state row when the backup has none', async () => {
    const source = databaseBeforeCopy();

    seedSpot(source, 'account', { binanceHistoryCursor: 1000, binanceEarnHistoryCursor: 2000 });

    const result = await restored(withoutExchangeState(await exported(source)));

    expect(stateRowsOf(result)).toEqual([
      {
        account_id: 'account',
        last_sync_at: null,
        last_full_sync_at: null,
        last_sync_display_at: null,
        failed_sync_monobank_ids: null,
        exchange_state: JSON.stringify({
          version: 1,
          walks: { capital: { cursor: 1000 }, earn: { cursor: 2000 } },
        }),
      },
    ]);
  });

  it('keeps the stamps of the backup row it fills', async () => {
    const source = databaseBeforeCopy();

    seedSpot(source, 'account', { binanceHistoryCursor: 1000 });
    source
      .prepare(
        `INSERT INTO sync_state (account_id, last_sync_at, last_full_sync_at, last_sync_display_at)
         VALUES ('account', 11, 22, 33)`,
      )
      .run();

    const [row] = stateRowsOf(await restored(withoutExchangeState(await exported(source))));

    expect(row).toMatchObject({
      last_sync_at: 11,
      last_full_sync_at: 22,
      last_sync_display_at: 33,
    });
    expect(parsedOrText(row?.exchange_state)).toEqual({
      version: 1,
      walks: { capital: { cursor: 1000 } },
    });
  });

  it("derives the walk state when the backup's row carries a null walk state", async () => {
    const source = freshDatabase();

    seedSpot(source, 'account', { binanceHistoryCursor: 1000 });
    source
      .prepare("INSERT INTO sync_state (account_id, last_sync_at) VALUES ('account', 11)")
      .run();

    const snapshot = await exported(source);

    expect(snapshot.syncState[0]?.exchangeState).toBeNull();

    const [row] = stateRowsOf(await restored(snapshot));

    expect(row).toMatchObject({ last_sync_at: 11 });
    expect(parsedOrText(row?.exchange_state)).toEqual({
      version: 1,
      walks: { capital: { cursor: 1000 } },
    });
  });

  it.each([
    [
      'a backup with walk state restores it unchanged',
      '{"version":1,"walks":{"pay":{"cursor":7}}}',
    ],
    ['keeps a malformed stored walk state unchanged', 'not json at all'],
    ['keeps an empty stored walk state unchanged', ''],
  ])('%s', async (_title, stored) => {
    const source = freshDatabase();

    seedSpot(source, 'account', { binanceHistoryCursor: 1000 });
    source
      .prepare("INSERT INTO sync_state (account_id, exchange_state) VALUES ('account', ?)")
      .run(stored);

    const result = await restored(await exported(source));

    expect(stateRowsOf(result)).toEqual(stateRowsOf(source));
    expect(stateRowsOf(result)[0]?.exchange_state).toBe(stored);
  });

  // The oversized list names wallets from this build on; a backup of either shape restores byte
  // for byte and reads: `balance` is what the account detail lists, and nothing is unreadable.
  it.each([
    ['an old-shape oversized list', { balance: ['ETH'], history: ['BTC'] }],
    [
      'an oversized list that names its wallets',
      { balance: ['ETH', 'SOL'], history: ['BTC'], balanceByWallet: { spot: ['ETH'], earn: [] } },
    ],
  ])('restores %s unchanged, and it reads', async (_title, oversizedCoins) => {
    const stored = JSON.stringify({ version: 1, walks: {}, oversizedCoins });
    const source = freshDatabase();

    seedSpot(source, 'account', { binanceHistoryCursor: 1000 });
    source
      .prepare("INSERT INTO sync_state (account_id, exchange_state) VALUES ('account', ?)")
      .run(stored);

    const restoredText = stateRowsOf(await restored(await exported(source)))[0]?.exchange_state;
    const parsed = parseExchangeState(restoredText as string);

    expect(restoredText).toBe(stored);
    expect(parsed).toMatchObject({
      kind: 'parsed',
      oversizedCoins: { balance: oversizedCoins.balance, history: ['BTC'] },
      unreadable: [],
    });
  });

  // The "Last sync" line of an account with no holding reads this stamp, so a restore that lost it
  // would show "Never" until the next sync.
  it('restores the balance sync stamp unchanged, and it reads', async () => {
    const stored = JSON.stringify({ version: 1, walks: {}, balanceSyncedAt: 1_700_000_000_000 });
    const source = freshDatabase();

    seedSpot(source, 'account', { binanceHistoryCursor: 1000 });
    source
      .prepare("INSERT INTO sync_state (account_id, exchange_state) VALUES ('account', ?)")
      .run(stored);

    const restoredText = stateRowsOf(await restored(await exported(source)))[0]?.exchange_state;

    expect(restoredText).toBe(stored);
    expect(parseExchangeState(restoredText as string)).toMatchObject({
      kind: 'parsed',
      balanceSyncedAt: 1_700_000_000_000,
      unreadable: [],
    });
  });
});

// Two live property accounts cannot coexist in a current database (a partial unique index), so
// the second one is added to the exported file, as an older build's export carried it.
describe('an implicit-account merge', () => {
  const mergedFile = async (stateRows: DataSnapshot['syncState']): Promise<DataSnapshot> => {
    const source = freshDatabase();

    source.exec(
      "INSERT INTO accounts (id, name, kind, created_at) VALUES ('kept', 'Property', 'property', 1)",
    );
    insertHolding(source, 'kept', 'kept-item', { note: 'kept' });

    const snapshot = await exported(source);
    const [keptAccount] = snapshot.accounts;
    const [keptHolding] = snapshot.holdings;

    return {
      ...snapshot,
      accounts: [...snapshot.accounts, { ...keptAccount, id: 'merged', createdAt: 2 }] as never,
      holdings: [
        ...snapshot.holdings,
        {
          ...keptHolding,
          id: 'merged-spot',
          accountId: 'merged',
          metadata: metadataOf({ binanceHistoryCursor: 9 }),
        },
      ] as never,
      syncState: stateRows,
    };
  };

  const stateRow = (accountId: string, exchangeState?: string) =>
    ({
      accountId,
      lastSyncAt: 5,
      lastFullSyncAt: null,
      lastSyncDisplayAt: null,
      failedSyncMonobankIds: null,
      ...foldMap(maybe(exchangeState), (value) => ({ exchangeState: value })),
    }) as DataSnapshot['syncState'][number];

  it("an implicit-account merge keeps the merged account's walk state", async () => {
    const result = await restored(await mergedFile([]));

    expect(stateRowsOf(result)).toHaveLength(1);
    expect(stateRowsOf(result)[0]).toMatchObject({ account_id: 'kept' });
    expect(parsedOrText(stateRowsOf(result)[0]?.exchange_state)).toEqual({
      version: 1,
      walks: { capital: { cursor: 9 } },
    });
  });

  it('keeps the walk state the kept account stored and drops the merged-away row', async () => {
    const stored = '{"version":1,"walks":{"pay":{"cursor":7}}}';
    const result = await restored(
      await mergedFile([stateRow('kept', stored), stateRow('merged', stored)]),
    );

    expect(stateRowsOf(result)).toHaveLength(1);
    expect(stateRowsOf(result)[0]).toMatchObject({ account_id: 'kept', exchange_state: stored });
  });
});
