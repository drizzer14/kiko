// drizzle/migrations/0061-exchange-state.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's database stood before
// it, so every copied walk field, every skipped holding and every stored-as-is value is proven on
// real rows, JSON functions included.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import maybe, { foldMap } from 'fnts/maybe';
import { syncStateRepo } from '@kiko/sync-state';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_FILE = join(__dirname, '0061_exchange_state.sql');

// The walk keys on a Spot holding's metadata, one row per key: the walk it belongs to, the field
// of that walk's entry it becomes, and the old key. Written out in full, so a key the migration
// forgets, or sends to the wrong walk, fails here.
const WALK_KEY_MAP = [
  ['capital', 'cursor', 'binanceHistoryCursor'],
  ['capital', 'rescan', 'binanceHistoryRescanCursor'],
  ['capital', 'pending', 'binanceHistoryPendingOverlap'],
  ['capital', 'pointCursor', 'binanceHistoryPointCursor'],
  ['capital', 'rangeCursor', 'binanceHistoryRangeCursor'],
  ['capital', 'spanHints', 'binanceHistorySpanHints'],
  ['pay', 'cursor', 'binancePayHistoryCursor'],
  ['pay', 'rescan', 'binancePayRescanCursor'],
  ['pay', 'pending', 'binancePayPendingOverlap'],
  ['pay', 'pointCursor', 'binancePayPointCursor'],
  ['pay', 'rangeCursor', 'binancePayRangeCursor'],
  ['pay', 'spanHints', 'binancePaySpanHints'],
  ['transfer', 'cursor', 'binanceTransferHistoryCursor'],
  ['transfer', 'rescan', 'binanceTransferRescanCursor'],
  ['transfer', 'pending', 'binanceTransferPendingOverlap'],
  ['transfer', 'pointCursor', 'binanceTransferPointCursor'],
  ['transfer', 'rangeCursor', 'binanceTransferRangeCursor'],
  ['transfer', 'spanHints', 'binanceTransferSpanHints'],
  ['earn', 'cursor', 'binanceEarnHistoryCursor'],
  ['earn', 'rescan', 'binanceEarnRescanCursor'],
  ['earn', 'pending', 'binanceEarnPendingOverlap'],
  ['earn', 'pointCursor', 'binanceEarnPointCursor'],
  ['earn', 'rangeCursor', 'binanceEarnRangeCursor'],
  ['earn', 'spanHints', 'binanceEarnSpanHints'],
] as const;

const WALKS = ['capital', 'pay', 'transfer', 'earn'] as const;
const FIELDS = ['cursor', 'rescan', 'pending', 'pointCursor', 'rangeCursor', 'spanHints'] as const;

type Walk = (typeof WALKS)[number];
type Field = (typeof FIELDS)[number];
type WalkEntries = Record<string, Record<string, unknown>>;
type ExchangeState = { version: number; walks: WalkEntries };

// A value distinct per (walk, field), so a key sent to another walk's entry or another field
// cannot pass by holding the same value.
const storedValueOf = (walk: Walk, field: Field): unknown => {
  const walkIndex = WALKS.indexOf(walk);
  const base = 1_700_000_000_000 + walkIndex * 100 + FIELDS.indexOf(field);

  if (field === 'pending') {
    return [{ start: base, end: base + 1, kind: 'point', series: `series-${walkIndex}` }];
  }

  if (field === 'spanHints') {
    return {
      forward: [{ start: base, end: base + 1 }],
      pending: [],
      rescan: [{ start: base + 2, end: base + 3 }],
      point: [],
    };
  }

  return base;
};

const FLOOR_MS = Date.UTC(2017, 6, 14);

const migrationStatements = (): string[] =>
  readFileSync(MIGRATION_FILE, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of migrationStatements()) {
    database.exec(statement);
  }
};

const databaseThrough0060 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0060_add_history_backfill_state');
  database.exec('PRAGMA foreign_keys = ON;');

  return database;
};

const insertAccount = (
  database: DatabaseSync,
  id: string,
  institution: string | null = 'binance',
): void => {
  database
    .prepare("INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, 'crypto', ?)")
    .run(id, id, institution);
};

const insertHolding = (
  database: DatabaseSync,
  accountId: string,
  id: string,
  metadata: string | null,
  sortOrder = 0,
  createdAt = 1,
): void => {
  database
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, metadata, sort_order, created_at)
       VALUES (?, ?, ?, 'crypto_asset', 'BTC', ?, ?, ?)`,
    )
    .run(id, accountId, id, metadata, sortOrder, createdAt);
};

const metadataOf = (fields: Record<string, unknown>, binanceAsset = 'BTC'): string =>
  JSON.stringify({ binanceAsset, syncedAt: 1_700_000_000_000, ...fields });

// An account with one Spot BTC holding that carries the given walk keys.
const seedSpot = (
  database: DatabaseSync,
  accountId: string,
  fields: Record<string, unknown>,
): void => {
  insertAccount(database, accountId);
  insertHolding(database, accountId, `${accountId}-spot`, metadataOf(fields));
};

const rawStateOf = (database: DatabaseSync, accountId: string): string | undefined =>
  (
    database
      .prepare('SELECT exchange_state AS value FROM sync_state WHERE account_id = ?')
      .get(accountId) as { value: string | null } | undefined
  )?.value ?? undefined;

const stateOf = (database: DatabaseSync, accountId: string): ExchangeState | undefined =>
  foldMap(maybe(rawStateOf(database, accountId)), (text) => JSON.parse(text) as ExchangeState);

const stateRowCount = (database: DatabaseSync): number =>
  (database.prepare('SELECT COUNT(*) AS value FROM sync_state').get() as { value: number }).value;

const jsonTypeOf = (database: DatabaseSync, accountId: string, path: string): unknown =>
  (
    database
      .prepare('SELECT json_type(exchange_state, ?) AS value FROM sync_state WHERE account_id = ?')
      .get(path, accountId) as { value: unknown }
  ).value;

const scalarOf = (database: DatabaseSync, sql: string, ...parameters: SQLInputValue[]): unknown =>
  (database.prepare(sql).get(...parameters) as { value: unknown }).value;

describe('migration 0061: the walk state column on sync_state', () => {
  it('adds a nullable text column with no default', () => {
    const database = databaseThrough0060();

    applyMigration(database);

    expect(database.prepare("SELECT * FROM pragma_table_info('sync_state')").all()).toContainEqual(
      expect.objectContaining({
        name: 'exchange_state',
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
      }),
    );
  });

  it('creates the state row for an account with walk keys and leaves its stamps null', () => {
    const database = databaseThrough0060();

    seedSpot(database, 'account', { binanceHistoryCursor: 1000 });
    applyMigration(database);

    expect(stateOf(database, 'account')).toEqual({
      version: 1,
      walks: { capital: { cursor: 1000 } },
    });
    expect(
      database
        .prepare(
          `SELECT last_sync_at, last_full_sync_at, last_sync_display_at, failed_sync_monobank_ids
           FROM sync_state WHERE account_id = 'account'`,
        )
        .get(),
    ).toEqual({
      last_sync_at: null,
      last_full_sync_at: null,
      last_sync_display_at: null,
      failed_sync_monobank_ids: null,
    });
  });

  it('keeps the stamps of a state row that already exists and fills only its walk state', () => {
    const database = databaseThrough0060();

    seedSpot(database, 'account', { binanceHistoryCursor: 1000 });
    database
      .prepare(
        `INSERT INTO sync_state (account_id, last_sync_at, last_full_sync_at, last_sync_display_at)
         VALUES ('account', 11, 22, 33)`,
      )
      .run();
    applyMigration(database);

    expect(stateOf(database, 'account')).toEqual({
      version: 1,
      walks: { capital: { cursor: 1000 } },
    });
    expect(
      database
        .prepare(
          `SELECT last_sync_at, last_full_sync_at, last_sync_display_at
           FROM sync_state WHERE account_id = 'account'`,
        )
        .get(),
    ).toEqual({ last_sync_at: 11, last_full_sync_at: 22, last_sync_display_at: 33 });
    expect(stateRowCount(database)).toBe(1);
  });

  it("copies a disconnected account's floor values as stored", () => {
    const database = databaseThrough0060();
    const floorKeys = Object.fromEntries(
      WALK_KEY_MAP.filter(([, field]) => ['cursor', 'rescan', 'pending'].includes(field)).map(
        ([, field, key]) => [key, field === 'pending' ? [] : FLOOR_MS],
      ),
    );

    insertAccount(database, 'account', null);
    insertHolding(database, 'account', 'spot', metadataOf(floorKeys));
    applyMigration(database);

    expect(stateOf(database, 'account')).toEqual({
      version: 1,
      walks: Object.fromEntries(
        WALKS.map((walk) => [walk, { cursor: FLOOR_MS, rescan: FLOOR_MS, pending: [] }]),
      ),
    });
  });

  it('copies every walk field into its walk entry', () => {
    const database = databaseThrough0060();

    expect(WALK_KEY_MAP).toHaveLength(24);
    expect(new Set(WALK_KEY_MAP.map(([, , key]) => key)).size).toBe(24);

    seedSpot(
      database,
      'account',
      Object.fromEntries(
        WALK_KEY_MAP.map(([walk, field, key]) => [key, storedValueOf(walk, field)]),
      ),
    );
    applyMigration(database);

    expect(stateOf(database, 'account')).toEqual({
      version: 1,
      walks: Object.fromEntries(
        WALKS.map((walk) => [
          walk,
          Object.fromEntries(FIELDS.map((field) => [field, storedValueOf(walk, field)])),
        ]),
      ),
    });
  });

  it('copies each key into the entry the table names, one key at a time', () => {
    const database = databaseThrough0060();

    for (const [walk, field, key] of WALK_KEY_MAP) {
      seedSpot(database, `${walk}-${field}`, { [key]: storedValueOf(walk, field) });
    }

    applyMigration(database);

    for (const [walk, field] of WALK_KEY_MAP) {
      expect(stateOf(database, `${walk}-${field}`)).toEqual({
        version: 1,
        walks: { [walk]: { [field]: storedValueOf(walk, field) } },
      });
    }
  });

  it('a walk with only a cursor copies no other field', () => {
    const database = databaseThrough0060();

    seedSpot(database, 'account', { binancePayHistoryCursor: 5 });
    applyMigration(database);

    const state = stateOf(database, 'account');

    expect(Object.keys(state?.walks ?? {})).toEqual(['pay']);
    expect(Object.keys(state?.walks.pay ?? {})).toEqual(['cursor']);
    expect(rawStateOf(database, 'account')).not.toContain('null');
  });

  it('skips an account whose metadata is not JSON and still succeeds', () => {
    const database = databaseThrough0060();

    insertAccount(database, 'plain-text');
    insertHolding(database, 'plain-text', 'plain-text-spot', 'not json at all');
    insertAccount(database, 'truncated');
    insertHolding(database, 'truncated', 'truncated-spot', '{"binanceAsset":"BTC","binancePay');
    seedSpot(database, 'readable', { binanceHistoryCursor: 7 });

    expect(() => applyMigration(database)).not.toThrow();

    expect(rawStateOf(database, 'plain-text')).toBeUndefined();
    expect(rawStateOf(database, 'truncated')).toBeUndefined();
    expect(stateOf(database, 'readable')).toEqual({
      version: 1,
      walks: { capital: { cursor: 7 } },
    });
    expect(stateRowCount(database)).toBe(1);
  });

  it('reads past a holding whose metadata is not JSON beside a Spot BTC holding', () => {
    const database = databaseThrough0060();

    seedSpot(database, 'account', { binanceHistoryCursor: 7 });
    insertHolding(database, 'account', 'other-holding', 'not json at all', 5, 1);

    expect(() => applyMigration(database)).not.toThrow();
    expect(stateOf(database, 'account')).toEqual({
      version: 1,
      walks: { capital: { cursor: 7 } },
    });
  });

  it('copies a malformed pending value as stored', () => {
    const database = databaseThrough0060();

    seedSpot(database, 'string-pending', { binancePayPendingOverlap: 'oops' });
    seedSpot(database, 'boolean-pending', { binancePayPendingOverlap: true });
    seedSpot(database, 'object-pending', { binancePayPendingOverlap: { start: 1 } });
    applyMigration(database);

    expect(jsonTypeOf(database, 'string-pending', '$.walks.pay.pending')).toBe('text');
    expect(jsonTypeOf(database, 'boolean-pending', '$.walks.pay.pending')).toBe('true');
    expect(jsonTypeOf(database, 'object-pending', '$.walks.pay.pending')).toBe('object');
    expect(stateOf(database, 'string-pending')?.walks.pay.pending).toBe('oops');
    expect(stateOf(database, 'boolean-pending')?.walks.pay.pending).toBe(true);
    expect(stateOf(database, 'object-pending')?.walks.pay.pending).toEqual({ start: 1 });
  });

  it('keeps a list a list', () => {
    const database = databaseThrough0060();

    seedSpot(database, 'text-list', { binancePayPendingOverlap: '[1]' });
    seedSpot(database, 'array-list', { binancePayPendingOverlap: [1] });
    applyMigration(database);

    expect(jsonTypeOf(database, 'text-list', '$.walks.pay.pending')).toBe('text');
    expect(stateOf(database, 'text-list')?.walks.pay.pending).toBe('[1]');
    expect(jsonTypeOf(database, 'array-list', '$.walks.pay.pending')).toBe('array');
    expect(stateOf(database, 'array-list')?.walks.pay.pending).toEqual([1]);
  });

  it('keeps a walk entry an object, not quoted text', () => {
    const database = databaseThrough0060();

    seedSpot(database, 'account', { binanceHistoryCursor: 1, binanceEarnHistoryCursor: 2 });
    applyMigration(database);

    expect(jsonTypeOf(database, 'account', '$.walks')).toBe('object');
    expect(jsonTypeOf(database, 'account', '$.walks.capital')).toBe('object');
    expect(jsonTypeOf(database, 'account', '$.walks.earn')).toBe('object');
  });

  it('takes the walk state from the first Spot BTC holding', () => {
    const database = databaseThrough0060();

    insertAccount(database, 'by-sort-order');
    insertHolding(database, 'by-sort-order', 'later', metadataOf({ binanceHistoryCursor: 111 }), 1);
    insertHolding(
      database,
      'by-sort-order',
      'first',
      metadataOf({ binanceHistoryCursor: 222 }),
      0,
      9,
    );
    insertAccount(database, 'by-created-at');
    insertHolding(
      database,
      'by-created-at',
      'newer',
      metadataOf({ binanceHistoryCursor: 333 }),
      2,
      10,
    );
    insertHolding(
      database,
      'by-created-at',
      'older',
      metadataOf({ binanceHistoryCursor: 444 }),
      2,
      5,
    );
    applyMigration(database);

    expect(stateOf(database, 'by-sort-order')?.walks.capital.cursor).toBe(222);
    expect(stateOf(database, 'by-created-at')?.walks.capital.cursor).toBe(444);
  });

  it('reads only the first Spot BTC holding, even when it has no walk key', () => {
    const database = databaseThrough0060();

    insertAccount(database, 'account');
    insertHolding(database, 'account', 'first', metadataOf({}), 0, 1);
    insertHolding(database, 'account', 'second', metadataOf({ binanceHistoryCursor: 5 }), 1, 2);
    applyMigration(database);

    expect(rawStateOf(database, 'account')).toBeUndefined();
    expect(stateRowCount(database)).toBe(0);
  });

  it('a Spot BTC holding with no walk key adds no row', () => {
    const database = databaseThrough0060();

    seedSpot(database, 'account', {});
    applyMigration(database);

    expect(stateRowCount(database)).toBe(0);
  });

  it('copies no walk key from a Funding holding', () => {
    const database = databaseThrough0060();

    insertAccount(database, 'account');
    insertHolding(
      database,
      'account',
      'funding',
      metadataOf({ binanceHistoryCursor: 5 }, 'BTC:funding'),
    );
    insertHolding(database, 'account', 'ether', metadataOf({ binanceHistoryCursor: 6 }, 'ETH'));
    applyMigration(database);

    expect(stateRowCount(database)).toBe(0);
  });

  it('an account whose state row only carries walk state reads as never synced', async () => {
    mockDatabase = databaseThrough0060();
    seedSpot(mockDatabase, 'account', { binanceHistoryCursor: 1000 });
    applyMigration(mockDatabase);

    const [row] = await syncStateRepo.getQuery('account');

    expect(row?.lastSyncAt ?? null).toBeNull();
    expect(row?.lastFullSyncAt ?? null).toBeNull();
    expect(row?.lastSyncDisplayAt ?? null).toBeNull();
    expect(row?.failedSyncMonobankIds ?? []).toEqual([]);

    await syncStateRepo.ensure('account');

    expect(scalarOf(mockDatabase, 'SELECT COUNT(*) AS value FROM sync_state')).toBe(1);
    expect(stateOf(mockDatabase, 'account')?.walks.capital.cursor).toBe(1000);
  });
});
