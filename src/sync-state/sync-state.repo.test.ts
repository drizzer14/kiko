// The setters run their update through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake transaction
// handle so the test can capture the write without a native database. Unlike the
// single-row `settings` repo, `sync_state` holds one row PER account id, so the
// fake handle interprets the `where(eq(syncState.accountId, id))` clause: a
// setter must touch only the row for the given account id.
let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

import { DatabaseSync } from 'node:sqlite';
import { database, type syncState, write } from '@kiko/db';
import type { ExchangeStatePatch } from '@kiko/crypto-sync/exchange/walk-state';
import { applyAllMigrations, executingDrizzle } from '@kiko/test-support/real-sqlite';

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
const makeSyncStateDatabaseTransaction = (store: Record<string, unknown>[]): unknown => ({
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
    mockDatabaseTransaction = makeSyncStateDatabaseTransaction(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.ensure('acct-A');
    await syncStateRepo.ensure('acct-A');

    const rows = await syncStateRepo.getQuery('acct-A');

    expect(rows).toHaveLength(1);
    expect(rows[0].accountId).toBe('acct-A');
  });

  it('ensure keeps a distinct row per account id', async () => {
    const store: Record<string, unknown>[] = [];
    mockDatabaseTransaction = makeSyncStateDatabaseTransaction(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.ensure('acct-A');
    await syncStateRepo.ensure('acct-B');

    expect(store).toHaveLength(2);
    expect((await syncStateRepo.getQuery('acct-B'))[0].accountId).toBe('acct-B');
  });

  it('setLastSyncAt writes only the target account row, never another account', async () => {
    const store: Record<string, unknown>[] = [{ accountId: 'acct-A' }, { accountId: 'acct-B' }];
    mockDatabaseTransaction = makeSyncStateDatabaseTransaction(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.setLastSyncAt('acct-A', 1_700_000_000_000);

    expect((await syncStateRepo.getQuery('acct-A'))[0].lastSyncAt).toBe(1_700_000_000_000);
    expect((await syncStateRepo.getQuery('acct-B'))[0].lastSyncAt).toBeUndefined();
  });

  it('setLastFullSyncAt writes only the target account row', async () => {
    const store: Record<string, unknown>[] = [{ accountId: 'acct-A' }, { accountId: 'acct-B' }];
    mockDatabaseTransaction = makeSyncStateDatabaseTransaction(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.setLastFullSyncAt('acct-B', 1_700_000_000_001);

    expect((await syncStateRepo.getQuery('acct-B'))[0].lastFullSyncAt).toBe(1_700_000_000_001);
    expect((await syncStateRepo.getQuery('acct-A'))[0].lastFullSyncAt).toBeUndefined();
  });

  it('setLastSyncDisplayAt writes only the target account row', async () => {
    const store: Record<string, unknown>[] = [{ accountId: 'acct-A' }, { accountId: 'acct-B' }];
    mockDatabaseTransaction = makeSyncStateDatabaseTransaction(store);
    spyOnSyncStateSelect(store);

    await syncStateRepo.setLastSyncDisplayAt('acct-A', 1_700_000_000_002);

    expect((await syncStateRepo.getQuery('acct-A'))[0].lastSyncDisplayAt).toBe(1_700_000_000_002);
    expect((await syncStateRepo.getQuery('acct-B'))[0].lastSyncDisplayAt).toBeUndefined();
  });

  it('setFailedSyncMonobankIds round-trips an array and a null for the target account', async () => {
    const store: Record<string, unknown>[] = [{ accountId: 'acct-A' }, { accountId: 'acct-B' }];
    mockDatabaseTransaction = makeSyncStateDatabaseTransaction(store);
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
      exchangeState: null,
    };

    expect(row.accountId).toBe('acct-A');
  });
});

// The exchange state writers run their re-read, institution gate and write inside one `write(...)`.
// The fake handle above would never enforce the join or the upsert, so these cases point the same
// mocked `write` at the shipped schema on a real in-process engine.
const FLOOR_MS = 1;

const openExchangeDatabase = (
  institution: string | null,
  exchangeState?: string | null,
): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Binance', 'crypto', ?)",
    )
    .run(institution);

  if (exchangeState !== undefined) {
    rawDatabase
      .prepare("INSERT INTO sync_state (account_id, exchange_state) VALUES ('acc-1', ?)")
      .run(exchangeState);
  }

  mockDatabaseTransaction = executingDrizzle<typeof database>(rawDatabase);

  return rawDatabase;
};

/** `undefined` when the account has no `sync_state` row at all. */
const storedExchangeState = (rawDatabase: DatabaseSync): string | null | undefined =>
  (
    rawDatabase.prepare("SELECT exchange_state FROM sync_state WHERE account_id = 'acc-1'").get() as
      | { exchange_state: string | null }
      | undefined
  )?.exchange_state;

const storedExchangeStateJson = (rawDatabase: DatabaseSync): unknown =>
  JSON.parse(storedExchangeState(rawDatabase) as string);

const totalChanges = (rawDatabase: DatabaseSync): number =>
  Number(
    (rawDatabase.prepare('SELECT total_changes() AS changes').get() as { changes: number }).changes,
  );

const walkStateText = (walks: Record<string, unknown>): string =>
  JSON.stringify({ version: 1, walks });

const patchWalk = (
  walkId: 'capital' | 'pay' | 'earn',
  field: 'cursor',
  value: number,
): ExchangeStatePatch => ({ kind: 'walk', walkId, field, value });

const patchPending = (walkId: 'pay'): ExchangeStatePatch => ({
  kind: 'walk',
  walkId,
  field: 'pending',
  value: [{ start: 100, end: 200 }],
});

// The oversized balance list has no plain `coinList` patch: a balance write there is a complete
// read in which only Spot refused `tickers`.
const patchCoinList = (
  coins: 'untrackedCoins' | 'oversizedCoins',
  list: 'balance' | 'history',
  tickers: string[],
): ExchangeStatePatch => {
  if (coins === 'untrackedCoins') {
    return { kind: 'coinList', coins, list, tickers };
  }

  return list === 'history'
    ? { kind: 'coinList', coins, list, tickers }
    : { kind: 'oversizedBalance', wallets: { spot: tickers }, complete: true };
};

const patchInOrder = async (...patches: ExchangeStatePatch[]): Promise<void> => {
  for (const patch of patches) {
    await syncStateRepo.patchExchangeState('acc-1', 'binance', [patch]);
  }
};

const resetExchangeState = (): Promise<void> =>
  write((databaseTransaction) =>
    syncStateRepo.resetExchangeStateDatabaseTransaction(
      databaseTransaction,
      'acc-1',
      'binance',
      FLOOR_MS,
    ),
  );

const MALFORMED_TOP_LEVELS = [
  'not json',
  'null',
  '[]',
  '{"version":2,"walks":{}}',
  '{"version":1}',
  '{"version":1,"walks":[]}',
];

describe('syncStateRepo.patchExchangeState', () => {
  // The plan pins this title. A sibling keeps its value; as every writer stores canonical JSON,
  // which round-trips byte-identically, it keeps its bytes too, which `toBe` on the text proves.
  it('replaces only the named field and keeps a malformed sibling byte-identical', async () => {
    // The parse drops `notImported`, `multiCoinSince` and an unknown walk id and repairs a
    // malformed field, so none of it may travel through the parse on its way back to the column.
    const stored = JSON.stringify({
      version: 1,
      futureKey: { keep: [1, 2] },
      notImported: ['p2p-sale:1:2'],
      walks: {
        pay: {
          cursor: 123_456,
          pointCursor: 'junk',
          multiCoinSince: 'later',
          spanHints: { forward: 'x' },
        },
        earn: 'not-an-object',
        mystery: { cursor: 9 },
      },
    });
    const rawDatabase = openExchangeDatabase('binance', stored);

    await patchInOrder(patchWalk('pay', 'cursor', 777));

    expect(storedExchangeState(rawDatabase)).toBe(
      stored.replace('"cursor":123456', '"cursor":777'),
    );
  });

  it.each<[string, ExchangeStatePatch, unknown]>([
    ['cursor', { kind: 'walk', walkId: 'pay', field: 'cursor', value: null }, { cursor: null }],
    ['rescan', { kind: 'walk', walkId: 'pay', field: 'rescan', value: 40 }, { rescan: 40 }],
    [
      'pending',
      { kind: 'walk', walkId: 'pay', field: 'pending', value: [{ start: 1, end: 2 }] },
      { pending: [{ start: 1, end: 2 }] },
    ],
    [
      'pointCursor',
      { kind: 'walk', walkId: 'pay', field: 'pointCursor', value: 5 },
      { pointCursor: 5 },
    ],
    [
      'rangeCursor',
      { kind: 'walk', walkId: 'pay', field: 'rangeCursor', value: 6 },
      { rangeCursor: 6 },
    ],
    [
      'spanHints',
      {
        kind: 'walk',
        walkId: 'pay',
        field: 'spanHints',
        value: { forward: [{ start: 1, end: 2 }], pending: [], rescan: [], point: [] },
      },
      { spanHints: { forward: [{ start: 1, end: 2 }], pending: [], rescan: [], point: [] } },
    ],
  ])('writes the %s of a walk and nothing else of that walk', async (_field, patch, written) => {
    const rawDatabase = openExchangeDatabase('binance', walkStateText({ pay: { cursor: 10 } }));

    await patchInOrder(patch);

    expect(storedExchangeStateJson(rawDatabase)).toEqual({
      version: 1,
      walks: { pay: { cursor: 10, ...(written as object) } },
    });
  });

  it('replaces a walk entry that is not an object with the one field', async () => {
    const rawDatabase = openExchangeDatabase('binance', walkStateText({ pay: 'oops' }));

    await patchInOrder(patchWalk('pay', 'cursor', 5));

    expect(storedExchangeStateJson(rawDatabase)).toEqual({
      version: 1,
      walks: { pay: { cursor: 5 } },
    });
  });

  it('lands two patches of one call together, over one write', async () => {
    const rawDatabase = openExchangeDatabase('binance', walkStateText({ pay: { cursor: 10 } }));
    const changesBefore = totalChanges(rawDatabase);

    await syncStateRepo.patchExchangeState('acc-1', 'binance', [
      patchWalk('pay', 'cursor', 20),
      patchPending('pay'),
      patchCoinList('untrackedCoins', 'history', ['AAA']),
    ]);

    expect(storedExchangeStateJson(rawDatabase)).toEqual({
      version: 1,
      walks: { pay: { cursor: 20, pending: [{ start: 100, end: 200 }] } },
      untrackedCoins: { history: ['AAA'] },
    });
    expect(totalChanges(rawDatabase) - changesBefore).toBe(1);
  });

  it('applies the patches of one call in order, so the last of one field wins', async () => {
    const rawDatabase = openExchangeDatabase('binance', walkStateText({}));

    await syncStateRepo.patchExchangeState('acc-1', 'binance', [
      patchWalk('pay', 'cursor', 20),
      patchWalk('pay', 'cursor', 30),
    ]);

    expect(storedExchangeStateJson(rawDatabase)).toEqual({
      version: 1,
      walks: { pay: { cursor: 30 } },
    });
  });

  it('writes nothing for a call whose account left the exchange, whatever its patches', async () => {
    const stored = walkStateText({ pay: { cursor: 10 } });
    const rawDatabase = openExchangeDatabase(null, stored);

    await syncStateRepo.patchExchangeState('acc-1', 'binance', [
      patchWalk('pay', 'cursor', 20),
      patchPending('pay'),
    ]);

    expect(storedExchangeState(rawDatabase)).toBe(stored);
  });

  it('writes a trade symbol, the rotation and the balance snapshot each alone', async () => {
    const rawDatabase = openExchangeDatabase(
      'binance',
      JSON.stringify({ version: 1, walks: {}, trades: { symbols: 'junk', rotation: 2 } }),
    );

    await patchInOrder(
      { kind: 'tradeSymbol', symbol: 'BTCUSDT', entry: { fromId: 5, heldOrderId: 7 } },
      { kind: 'tradeSymbol', symbol: 'ETHUSDT', entry: { fromId: null } },
      { kind: 'tradesRotation', value: 3 },
      { kind: 'tradesBalanceSnapshot', value: { BTC: '1.5' } },
    );

    expect(storedExchangeStateJson(rawDatabase)).toEqual({
      version: 1,
      walks: {},
      trades: {
        symbols: { BTCUSDT: { fromId: 5, heldOrderId: 7 }, ETHUSDT: { fromId: null } },
        rotation: 3,
        balanceSnapshot: { BTC: '1.5' },
      },
    });
  });

  it('starts the trades entry with an empty rotation and snapshot when none is stored', async () => {
    const rawDatabase = openExchangeDatabase('binance', walkStateText({}));

    await patchInOrder({ kind: 'tradeSymbol', symbol: 'BTCUSDT', entry: { fromId: 5 } });

    expect(storedExchangeStateJson(rawDatabase)).toEqual({
      version: 1,
      walks: {},
      trades: { symbols: { BTCUSDT: { fromId: 5 } }, rotation: 0, balanceSnapshot: {} },
    });
  });

  it.each([
    ['inserts the row when none exists', undefined],
    ['fills a column no walk has written yet', null],
  ])('%s', async (_title, seed) => {
    const rawDatabase = openExchangeDatabase('binance', seed);

    await patchInOrder(patchWalk('pay', 'cursor', 5));

    expect(storedExchangeStateJson(rawDatabase)).toEqual({
      version: 1,
      walks: { pay: { cursor: 5 } },
    });
  });

  it.each(MALFORMED_TOP_LEVELS)('never overwrites a malformed top level: %s', async (stored) => {
    const rawDatabase = openExchangeDatabase('binance', stored);

    await patchInOrder(patchWalk('pay', 'cursor', 5));

    expect(storedExchangeState(rawDatabase)).toBe(stored);
  });

  describe.each(['untrackedCoins', 'oversizedCoins'] as const)('the %s lists', (coins) => {
    const stored = (lists: unknown): string =>
      JSON.stringify({ version: 1, walks: {}, [coins]: lists });

    it('replaces a balance list and adds to a history list without duplicates', async () => {
      const rawDatabase = openExchangeDatabase(
        'binance',
        stored({ balance: ['AAA', 'BBB'], history: ['XXX'] }),
      );

      await patchInOrder(
        patchCoinList(coins, 'balance', ['CCC']),
        patchCoinList(coins, 'history', ['YYY', 'XXX', 'YYY']),
      );

      expect(storedExchangeStateJson(rawDatabase)).toEqual({
        version: 1,
        walks: {},
        [coins]: {
          balance: ['CCC'],
          history: ['XXX', 'YYY'],
          ...(coins === 'oversizedCoins' ? { balanceByWallet: { spot: ['CCC'] } } : {}),
        },
      });
    });

    it.each([
      ['starts a list no read has written yet', undefined, { history: ['YYY'] }],
      [
        'reads a malformed stored history as empty and keeps the balance list as stored',
        { balance: 'junk', history: ['XXX', 7] },
        { balance: 'junk', history: ['YYY'] },
      ],
    ])('%s', async (_title, seed, written) => {
      const rawDatabase = openExchangeDatabase('binance', stored(seed));

      await patchInOrder(patchCoinList(coins, 'history', ['YYY']));

      expect(storedExchangeStateJson(rawDatabase)).toEqual({
        version: 1,
        walks: {},
        [coins]: written,
      });
    });
  });

  describe('the account gate', () => {
    const CONNECTED = walkStateText({ capital: { cursor: 500 } });

    it.each([
      ['has left the exchange', null],
      ['belongs to another exchange', 'bybit'],
    ])('writes nothing once the account %s', async (_case, institution) => {
      const rawDatabase = openExchangeDatabase(institution, CONNECTED);

      await patchInOrder(patchWalk('capital', 'cursor', 999_999));

      expect(storedExchangeState(rawDatabase)).toBe(CONNECTED);
    });

    it.each([
      ['left the exchange', 'acc-1', null],
      ['does not exist', 'ghost', 'binance'],
    ])('inserts no row for an account that %s', async (_case, accountId, institution) => {
      const rawDatabase = openExchangeDatabase(institution);

      await syncStateRepo.patchExchangeState(accountId, 'binance', [
        patchWalk('capital', 'cursor', 999_999),
      ]);

      expect(storedExchangeState(rawDatabase)).toBeUndefined();
    });

    it('is a no-op on a disconnected account', async () => {
      const rawDatabase = openExchangeDatabase(null, CONNECTED);

      await patchInOrder(patchWalk('capital', 'cursor', 999_999));

      expect(storedExchangeStateJson(rawDatabase)).toEqual({
        version: 1,
        walks: { capital: { cursor: 500 } },
      });
    });

    it('keeps the other walks cursors when one walk advances its own', async () => {
      const rawDatabase = openExchangeDatabase('binance', CONNECTED);

      await patchInOrder(patchWalk('pay', 'cursor', 700), patchWalk('earn', 'cursor', 800));

      expect(storedExchangeStateJson(rawDatabase)).toEqual({
        version: 1,
        walks: { capital: { cursor: 500 }, pay: { cursor: 700 }, earn: { cursor: 800 } },
      });
    });

    it.each<[string, ExchangeStatePatch]>([
      [
        "a disconnect's floor write is not undone by a walk's late-arriving window commit",
        patchWalk('capital', 'cursor', 999_999),
      ],
      ["a disconnect's reset is not undone by a walk's late-arriving write", patchPending('pay')],
    ])('%s', async (_title, latePatch) => {
      const rawDatabase = openExchangeDatabase('binance', CONNECTED);
      await patchInOrder(patchPending('pay'));

      // The disconnect's two steps in order: reset FIRST, then clear the institution.
      // `accountsRepo.disconnectExchange` runs both in one write (its own suite).
      await resetExchangeState();
      rawDatabase.prepare("UPDATE accounts SET institution = NULL WHERE id = 'acc-1'").run();

      // A write from a walk that started BEFORE the disconnect, arriving after it: it must not
      // resurrect a forward watermark or a pending list over the reset.
      await patchInOrder(latePatch);

      expect(storedExchangeStateJson(rawDatabase)).toEqual({
        version: 1,
        walks: { capital: { cursor: FLOOR_MS }, pay: { pending: [] } },
      });
    });
  });
});

describe('syncStateRepo.resetExchangeStateDatabaseTransaction', () => {
  const SPAN_HINTS = {
    forward: [{ start: 100, end: 150 }],
    pending: [],
    rescan: [{ start: 200, end: 210 }],
    point: [],
  };
  const RANGES = [{ start: 100, end: 200 }];

  it('resets every walk to the floor, empties pending lists and removes the coin lists', async () => {
    const rawDatabase = openExchangeDatabase(
      'binance',
      JSON.stringify({
        version: 1,
        futureKey: true,
        notImported: ['p2p-sale:1:2'],
        trades: { symbols: { BTCUSDT: { fromId: 5 } }, rotation: 2, balanceSnapshot: {} },
        untrackedCoins: { balance: ['AAA'], history: ['BBB'] },
        oversizedCoins: { balance: ['CCC'], history: ['DDD'] },
        walks: {
          capital: {
            cursor: 500,
            rescan: 400,
            pending: RANGES,
            pointCursor: 3,
            rangeCursor: 4,
            spanHints: SPAN_HINTS,
          },
          pay: { cursor: 700, pending: RANGES },
          transfer: { pointCursor: 5, multiCoinSince: 8 },
          convert: { cursor: null, rescan: 'junk' },
          earn: 'not-an-object',
          mystery: { cursor: 9 },
        },
      }),
    );

    await resetExchangeState();

    expect(storedExchangeStateJson(rawDatabase)).toEqual({
      version: 1,
      walks: {
        capital: { cursor: FLOOR_MS, rescan: FLOOR_MS, pending: [] },
        pay: { cursor: FLOOR_MS, pending: [] },
        transfer: {},
        convert: { cursor: FLOOR_MS, rescan: FLOOR_MS },
      },
    });
  });

  // Without a capital cursor the capital walk starts at the newest capital row it imported, which
  // a reconnected different account would take as its own history. No other walk reads a row time.
  it.each(['oops', null, 7, ['a']])(
    'resets a capital entry that is stored as %j to a floor cursor',
    async (capital) => {
      const rawDatabase = openExchangeDatabase(
        'binance',
        walkStateText({ capital, pay: { cursor: 700 } }),
      );

      await resetExchangeState();

      expect(storedExchangeStateJson(rawDatabase)).toEqual({
        version: 1,
        walks: { capital: { cursor: FLOOR_MS }, pay: { cursor: FLOOR_MS } },
      });
    },
  );

  it.each(['oops', null, 7, ['a']])(
    'drops another walk entry that is stored as %j',
    async (entry) => {
      const rawDatabase = openExchangeDatabase('binance', walkStateText({ pay: entry }));

      await resetExchangeState();

      expect(storedExchangeStateJson(rawDatabase)).toEqual({ version: 1, walks: {} });
    },
  );

  it.each(MALFORMED_TOP_LEVELS)(
    'replaces the malformed top level %s with a floor cursor of the capital walk',
    async (malformed) => {
      const rawDatabase = openExchangeDatabase('binance', malformed);

      await resetExchangeState();

      expect(storedExchangeState(rawDatabase)).toBe(
        `{"version":1,"walks":{"capital":{"cursor":${FLOOR_MS}}}}`,
      );
    },
  );

  it('writes nothing once the account left the exchange', async () => {
    const stored = walkStateText({ capital: { cursor: 500 } });
    const rawDatabase = openExchangeDatabase(null, stored);

    await resetExchangeState();

    expect(storedExchangeState(rawDatabase)).toBe(stored);
  });

  it.each([
    ['no row', undefined],
    ['a null column', null],
  ])('leaves %s as it is when no walk ever wrote state', async (_case, seed) => {
    const rawDatabase = openExchangeDatabase('binance', seed);

    await resetExchangeState();

    expect(storedExchangeState(rawDatabase)).toBe(seed);
  });
});
