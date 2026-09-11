// The setters run their update through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake transaction
// handle so the test can capture the write without a native database. Unlike the
// single-row `settings` repo, `sync_state` holds one row PER account id, so the
// fake handle interprets the `where(eq(syncState.accountId, id))` clause: a
// setter must touch only the row for the given account id.
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { database } from '../db/client';
import type { syncState } from '../db/schema';

import { syncStateRepo } from './sync-state.repo';

/**
 * Extract the account id a `where(eq(syncState.accountId, id))` clause binds.
 * A drizzle `eq` condition is an `SQL` whose `queryChunks` interleave string
 * fragments (whose `value` is a string ARRAY) with the bound `Param` (whose
 * `value` is the plain string). The Param is the only chunk whose `value` is a
 * bare string, so that is how the fake handle resolves which row to touch.
 */
const accountIdFromCondition = (condition: unknown): string => {
  const chunks = (condition as { queryChunks: { value?: unknown }[] }).queryChunks;
  const param = chunks.find((chunk) => typeof chunk.value === 'string');

  return (param as { value: string }).value;
};

/**
 * A fake `write`-transaction handle backed by a plain array, one entry per
 * `sync_state` row. `ensure`'s `insert(...).values(...).onConflictDoNothing()`
 * only appends when no row for that account id exists yet (proving idempotency);
 * a setter's `update(...).set(...).where(...)` mutates in place ONLY the row
 * whose account id matches the clause, proving cross-account isolation.
 */
const makeSyncStateTx = (store: Record<string, unknown>[]): unknown => ({
  insert: () => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoNothing: async () => {
        if (!store.some((row) => row.accountId === values.accountId)) {
          store.push({ accountId: values.accountId });
        }
      },
    }),
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: async (condition: unknown) => {
        const accountId = accountIdFromCondition(condition);

        for (const row of store) {
          if (row.accountId === accountId) {
            Object.assign(row, values);
          }
        }
      },
    }),
  }),
});

const spyOnSyncStateSelect = (store: Record<string, unknown>[]): void => {
  // The double implements only the `.from().where()` path this repo calls, not
  // drizzle's full builder, so it filters the store by the clause's account id.
  jest.spyOn(database, 'select').mockReturnValue({
    from: () => ({
      where: async (condition: unknown) =>
        store.filter((row) => row.accountId === accountIdFromCondition(condition)),
    }),
  } as unknown as ReturnType<typeof database.select>);
};

describe('syncStateRepo', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a per-account sync_state query filtered by the account id', () => {
    const { sql } = syncStateRepo.getQuery('acct-A').toSQL();

    expect(sql).toContain('sync_state');
    expect(sql).toContain('"account_id" = ?');
  });

  it('ensure inserts exactly one row for an account id and is idempotent', async () => {
    const store: Record<string, unknown>[] = [];
    mockTx = makeSyncStateTx(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.ensure('acct-A');
    await syncStateRepo.ensure('acct-A');

    const rows = await syncStateRepo.getQuery('acct-A');

    expect(rows).toHaveLength(1);
    expect(rows[0].accountId).toBe('acct-A');
  });

  it('ensure keeps a distinct row per account id', async () => {
    const store: Record<string, unknown>[] = [];
    mockTx = makeSyncStateTx(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.ensure('acct-A');
    await syncStateRepo.ensure('acct-B');

    expect(store).toHaveLength(2);
    expect((await syncStateRepo.getQuery('acct-B'))[0].accountId).toBe('acct-B');
  });

  it('setLastSyncAt writes only the target account row, never another account', async () => {
    const store: Record<string, unknown>[] = [{ accountId: 'acct-A' }, { accountId: 'acct-B' }];
    mockTx = makeSyncStateTx(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.setLastSyncAt('acct-A', 1_700_000_000_000);

    expect((await syncStateRepo.getQuery('acct-A'))[0].lastSyncAt).toBe(1_700_000_000_000);
    expect((await syncStateRepo.getQuery('acct-B'))[0].lastSyncAt).toBeUndefined();
  });

  it('setLastFullSyncAt writes only the target account row', async () => {
    const store: Record<string, unknown>[] = [{ accountId: 'acct-A' }, { accountId: 'acct-B' }];
    mockTx = makeSyncStateTx(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.setLastFullSyncAt('acct-B', 1_700_000_000_001);

    expect((await syncStateRepo.getQuery('acct-B'))[0].lastFullSyncAt).toBe(1_700_000_000_001);
    expect((await syncStateRepo.getQuery('acct-A'))[0].lastFullSyncAt).toBeUndefined();
  });

  it('setLastSyncDisplayAt writes only the target account row', async () => {
    const store: Record<string, unknown>[] = [{ accountId: 'acct-A' }, { accountId: 'acct-B' }];
    mockTx = makeSyncStateTx(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.setLastSyncDisplayAt('acct-A', 1_700_000_000_002);

    expect((await syncStateRepo.getQuery('acct-A'))[0].lastSyncDisplayAt).toBe(1_700_000_000_002);
    expect((await syncStateRepo.getQuery('acct-B'))[0].lastSyncDisplayAt).toBeUndefined();
  });

  it('setFailedSyncMonobankIds round-trips an array and a null for the target account', async () => {
    const store: Record<string, unknown>[] = [{ accountId: 'acct-A' }, { accountId: 'acct-B' }];
    mockTx = makeSyncStateTx(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.setFailedSyncMonobankIds('acct-A', ['card-1', 'card-2']);
    expect((await syncStateRepo.getQuery('acct-A'))[0].failedSyncMonobankIds).toEqual([
      'card-1',
      'card-2',
    ]);
    expect((await syncStateRepo.getQuery('acct-B'))[0].failedSyncMonobankIds).toBeUndefined();

    await syncStateRepo.setFailedSyncMonobankIds('acct-A', null);
    expect((await syncStateRepo.getQuery('acct-A'))[0].failedSyncMonobankIds).toBeNull();
  });

  it('exposes the inferred row type via the schema table', () => {
    // A compile-time anchor: the row type is `typeof syncState.$inferSelect`.
    const row: typeof syncState.$inferSelect = {
      accountId: 'acct-A',
      lastSyncAt: null,
      lastFullSyncAt: null,
      lastSyncDisplayAt: null,
      failedSyncMonobankIds: null,
    };

    expect(row.accountId).toBe('acct-A');
  });
});
