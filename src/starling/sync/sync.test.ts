// op-sqlite's open() calls a native module unavailable under Jest, and
// sync.ts imports the repos which open the connection at load. The real
// repos are globally mocked in jest/setup.js; runSync's data access is fully
// injected through SyncDeps regardless, so the real repos are never
// exercised by these tests.
import {
  getSnapshot as isSyncingSnapshot,
  getProgressSnapshot,
  isFastPhaseDone,
} from '../../monobank/sync-status';
import { i18n } from '../../i18n';
import type { AccountRow, HoldingRow, TransactionRow } from '../../db/schema';
import type { StarlingAccount, StarlingBalance, StarlingFeedItem } from '../starling.types';

import { mapAccountToHolding, mapFeedItem, runSync, type SyncDeps } from './sync';

const account = (overrides: Partial<StarlingAccount> = {}): StarlingAccount => ({
  accountUid: 'acc-uid-1',
  defaultCategory: 'category-uid-1',
  currency: 'GBP',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const balance = (overrides: Partial<StarlingBalance> = {}): StarlingBalance => ({
  clearedBalance: { currency: 'GBP', minorUnits: 123_456 },
  effectiveBalance: { currency: 'GBP', minorUnits: 123_456 },
  ...overrides,
});

const feedItem = (overrides: Partial<StarlingFeedItem> = {}): StarlingFeedItem => ({
  feedItemUid: 'feed-1',
  categoryUid: 'category-uid-1',
  amount: { currency: 'GBP', minorUnits: 500 },
  direction: 'OUT',
  transactionTime: '2026-01-01T10:00:00.000Z',
  status: 'SETTLED',
  reference: 'Coffee',
  ...overrides,
});

describe('mapAccountToHolding', () => {
  it('maps a Starling account onto a card holding, using the cleared (settled) balance', () => {
    const holding = mapAccountToHolding(account(), 'account-1', balance());

    expect(holding.accountId).toBe('account-1');
    expect(holding.type).toBe('card');
    expect(holding.currency).toBe('GBP');
    expect(holding.name).toBe('Starling account');
    expect(holding.balanceMinorUnits).toBe(123_456);
    expect(holding.metadata).toEqual({ starlingCategory: 'category-uid-1' });
  });

  it('uses clearedBalance, not effectiveBalance (which may include pending)', () => {
    const holding = mapAccountToHolding(
      account(),
      'account-1',
      balance({
        clearedBalance: { currency: 'GBP', minorUnits: 1_000 },
        effectiveBalance: { currency: 'GBP', minorUnits: 2_000 },
      }),
    );

    expect(holding.balanceMinorUnits).toBe(1_000);
  });

  it('throws on an unrepresentable currency code', () => {
    expect(() => mapAccountToHolding(account({ currency: 'ZZZ' }), 'account-1', balance())).toThrow(
      /currency/i,
    );
  });
});

describe('mapFeedItem', () => {
  it('namespaces the external id by account id, maps minorUnits straight through with no decimal parsing', () => {
    const transaction = mapFeedItem(feedItem({ direction: 'IN' }), 'holding-1', 'acc-1');

    expect(transaction.source).toBe('starling');
    expect(transaction.externalId).toBe('acc-1:feed-1');
    expect(transaction.amountMinorUnits).toBe(500);
    expect(transaction.holdingId).toBe('holding-1');
    expect(transaction.description).toBe('Coffee');
  });

  it('negates the amount for an OUT direction', () => {
    const transaction = mapFeedItem(feedItem({ direction: 'OUT' }), 'holding-1', 'acc-1');

    expect(transaction.amountMinorUnits).toBe(-500);
  });

  it('produces a distinct external id per account for the SAME raw feed item id', () => {
    const item = feedItem();
    const a = mapFeedItem(item, 'holding-a', 'acc-a');
    const b = mapFeedItem(item, 'holding-b', 'acc-b');

    expect(a.externalId).toBe('acc-a:feed-1');
    expect(b.externalId).toBe('acc-b:feed-1');
    expect(a.externalId).not.toBe(b.externalId);
  });

  it('falls back from reference to counterPartyName when reference is absent', () => {
    const { reference, ...withoutReference } = feedItem();
    const transaction = mapFeedItem(
      { ...withoutReference, counterPartyName: 'Coffee shop' } as StarlingFeedItem,
      'holding-1',
      'acc-1',
    );

    expect(transaction.description).toBe('Coffee shop');
  });

  it('defaults to an empty string when neither reference nor counterPartyName is present', () => {
    const { reference, ...withoutReference } = feedItem();
    const transaction = mapFeedItem(withoutReference as StarlingFeedItem, 'holding-1', 'acc-1');

    expect(transaction.description).toBe('');
  });

  // FAIL CLOSED: an unparseable transactionTime must THROW, never silently
  // persist a NaN time — a NaN time corrupts `ORDER BY time DESC`. The flat
  // pipeline in `runSyncInner` lets this propagate straight out of the run.
  it('throws, naming the account and the raw value, on an unparseable transactionTime rather than persisting NaN', () => {
    const item = feedItem({ transactionTime: 'not-a-date' });

    expect(() => mapFeedItem(item, 'holding-1', 'acc-1')).toThrow(/date/i);
    expect(() => mapFeedItem(item, 'holding-1', 'acc-1')).toThrow(/acc-1/);
    expect(() => mapFeedItem(item, 'holding-1', 'acc-1')).toThrow(/not-a-date/);
  });

  it('throws on a non-finite feed amount rather than persisting NaN', () => {
    const item = feedItem({ amount: { currency: 'GBP', minorUnits: Number.NaN } });

    expect(() => mapFeedItem(item, 'holding-1', 'acc-1')).toThrow(/amount/i);
  });
});

const starlingIdOf = (metadata: unknown): string | undefined =>
  (metadata as { starlingId?: string } | null)?.starlingId;

/**
 * A faithful in-memory double of the injected data-access seams: holdings
 * upsert on (accountId, starlingId), transactions dedup on (source,
 * externalId) — the same keys the real repos enforce. Mirrors
 * `src/privatbank/sync/sync.test.ts`'s deps-injection style.
 */
const bankAccount = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'acc-1',
  name: 'My Bank',
  kind: 'bank',
  institution: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  icon: null,
  color: null,
  ...overrides,
});

const makeInMemoryDeps = (
  feedFor: (accountUid: string) => StarlingFeedItem[],
  initialAccounts: AccountRow[] = [],
  fetchedAccounts: StarlingAccount[] = [account()],
  balanceFor: (accountUid: string) => StarlingBalance = () => balance(),
) => {
  const accountsStore: AccountRow[] = initialAccounts.map((row) => ({ ...row }));
  const holdingsStore: HoldingRow[] = [];
  const transactionsStore: TransactionRow[] = [];
  const syncStateRow: { lastSyncAt: number | null } = { lastSyncAt: null };
  let sequence = 0;
  const nextId = (): string => `id-${++sequence}`;
  const sleep = jest.fn(async (_milliseconds: number): Promise<void> => undefined);

  const upsertStarlingMany: SyncDeps['holdingsRepo']['upsertStarlingMany'] = async (holdings) => {
    for (const { starlingId, metadata, ...rest } of holdings) {
      const merged = { ...(metadata as Record<string, unknown> | null), starlingId };
      const existing = holdingsStore.find(
        (holding) =>
          holding.accountId === rest.accountId && starlingIdOf(holding.metadata) === starlingId,
      );

      if (existing) {
        existing.balanceMinorUnits = rest.balanceMinorUnits ?? 0;
        existing.metadata = merged;
        continue;
      }

      holdingsStore.push({
        id: nextId(),
        sortOrder: 0,
        closedAt: null,
        createdAt: 0,
        balanceMinorUnits: rest.balanceMinorUnits ?? 0,
        syncedBalanceMinorUnits: null,
        ...rest,
        icon: null,
        color: null,
        metadata: merged,
      });
    }
  };

  const addManyDedup: SyncDeps['transactionsRepo']['addManyDedup'] = async (inputs) => {
    let inserted = 0;

    for (const input of inputs) {
      const existing = input.externalId
        ? transactionsStore.find(
            (row) => row.source === input.source && row.externalId === input.externalId,
          )
        : undefined;

      if (existing) {
        Object.assign(existing, {
          amountMinorUnits: input.amountMinorUnits,
          time: input.time,
          description: input.description ?? '',
        });
        continue;
      }

      transactionsStore.push({
        id: nextId(),
        createdAt: 0,
        ...input,
        description: input.description ?? '',
        counterIban: null,
        category: null,
        mcc: null,
        hold: null,
        exchangeCounterpartHoldingId: null,
        changeGroupId: null,
        comment: null,
        externalId: input.externalId ?? null,
      });
      inserted += 1;
    }

    return inserted;
  };

  const accountsRepo: SyncDeps['accountsRepo'] = {
    listQuery: async () => accountsStore.map((row) => ({ ...row })),
    update: async (accountId, patch) => {
      const target = accountsStore.find((row) => row.id === accountId);

      if (target) {
        Object.assign(target, patch);
      }
    },
  };

  const holdingsRepo: SyncDeps['holdingsRepo'] = {
    listByAccountQuery: async (accountId) =>
      holdingsStore.filter((holding) => holding.accountId === accountId).map((h) => ({ ...h })),
    upsertStarlingMany,
  };

  const transactionsRepo: SyncDeps['transactionsRepo'] = { addManyDedup };

  const syncStateRepo: SyncDeps['syncStateRepo'] = {
    getQuery: async () => [syncStateRow],
    ensure: async () => undefined,
    setLastSyncAt: async (_accountId, timestamp) => {
      syncStateRow.lastSyncAt = timestamp;
    },
  };

  const deps: SyncDeps = {
    fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
    now: () => 1_704_326_400_000,
    sleep,
    readToken: async () => 'tok',
    fetchAccounts: async () => fetchedAccounts,
    fetchBalance: async (_token, accountUid) => balanceFor(accountUid),
    fetchFeedChangedSince: async (_token, accountUid) => feedFor(accountUid),
    accountsRepo,
    holdingsRepo,
    transactionsRepo,
    syncStateRepo,
  };

  return { deps, accountsStore, holdingsStore, transactionsStore, syncStateRow, sleep };
};

describe('runSync', () => {
  const onlyPrimaryAccount = (accountUid: string): StarlingFeedItem[] =>
    accountUid === account().accountUid ? [feedItem()] : [];

  it('marks the target account starling, upserts holdings, and imports feed items', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore, holdingsStore, transactionsStore } = makeInMemoryDeps(
      onlyPrimaryAccount,
      [target],
    );
    deps.targetAccountId = 'acc-1';

    const result = await runSync(deps);

    expect(accountsStore).toHaveLength(1);
    expect(accountsStore[0].institution).toBe('starling');
    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0].accountId).toBe('acc-1');
    expect(result.importedTransactions).toBe(1);
    expect(transactionsStore).toHaveLength(1);
    expect(transactionsStore[0].externalId).toBe('acc-1:feed-1');
  });

  it('with no target id, syncs into the existing institution=starling account', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps(onlyPrimaryAccount, [
      connected,
    ]);

    await runSync(deps);

    expect(accountsStore).toHaveLength(1);
    expect(holdingsStore.every((holding) => holding.accountId === 'acc-starling')).toBe(true);
  });

  it('throws when neither a target id nor an existing starling account exists', async () => {
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [
      bankAccount({ id: 'acc-cash', institution: null }),
    ]);

    await expect(runSync(deps)).rejects.toThrow('No Starling account connected');
    expect(holdingsStore).toHaveLength(0);
    expect(transactionsStore).toHaveLength(0);
  });

  it('filters out non-SETTLED feed items (PENDING/DECLINED)', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps, transactionsStore } = makeInMemoryDeps(
      () => [feedItem({ status: 'PENDING' }), feedItem({ feedItemUid: 'feed-2' })],
      [connected],
    );

    const result = await runSync(deps);

    expect(result.importedTransactions).toBe(1);
    expect(transactionsStore).toHaveLength(1);
    expect(transactionsStore[0].externalId).toBe('acc-starling:feed-2');
  });

  it('uses a later stored changesSince cursor on a second run, deduping the same feed item', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);

    const first = await runSync(deps);
    const second = await runSync(deps);

    expect(first.importedTransactions).toBe(1);
    expect(second.importedTransactions).toBe(0);
    expect(transactionsStore).toHaveLength(1);
  });

  it('passes the stored lastSyncAt as changesSince on a later run', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps, syncStateRow } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    syncStateRow.lastSyncAt = 1_700_000_000_000;
    const changesSinceCalls: string[] = [];
    deps.fetchFeedChangedSince = async (_token, _accountUid, _categoryUid, changesSinceIso) => {
      changesSinceCalls.push(changesSinceIso);
      return [];
    };

    await runSync(deps);

    expect(changesSinceCalls).toEqual([new Date(1_700_000_000_000).toISOString()]);
  });

  it('leaves the target account unmarked when fetchAccounts fails', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore } = makeInMemoryDeps(onlyPrimaryAccount, [target]);
    deps.targetAccountId = 'acc-1';
    deps.fetchAccounts = jest.fn(() => Promise.reject(new Error('401')));

    await expect(runSync(deps)).rejects.toThrow('401');

    expect(accountsStore[0].institution).toBeNull();
  });

  it('marks the target account only once fetchAccounts resolves, not before', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore } = makeInMemoryDeps(onlyPrimaryAccount, [target]);
    deps.targetAccountId = 'acc-1';
    const calls: string[] = [];
    const originalFetchAccounts = deps.fetchAccounts;
    deps.fetchAccounts = async (token, fetchImpl) => {
      calls.push('fetchAccounts');
      expect(accountsStore[0].institution).toBeNull();
      return originalFetchAccounts(token, fetchImpl);
    };
    deps.accountsRepo.update = async (accountId, patch) => {
      calls.push('updateAccount');
      const row = accountsStore.find((account_) => account_.id === accountId);

      if (row) {
        Object.assign(row, patch);
      }
    };

    await runSync(deps);

    expect(calls).toEqual(['fetchAccounts', 'updateAccount']);
    expect(accountsStore[0].institution).toBe('starling');
  });

  it('throws when no token is stored, without importing anything, and never advances the cursor', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    deps.readToken = async () => undefined;
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;

    await expect(runSync(deps)).rejects.toThrow(/token/i);

    expect(transactionsStore).toHaveLength(0);
    expect(setLastSyncAt).not.toHaveBeenCalled();
  });

  // Fail-closed: a balance-fetch failure for even one account must not
  // advance the cursor, so the SAME window is re-covered idempotently on
  // the next run. The engine is deliberately FLAT (no per-account
  // isolation, the "simplest of the four" per the task brief) — the whole
  // run aborts rather than upserting a partial snapshot.
  it('leaves sync_state.lastSyncAt unchanged when a balance fetch fails (fail-closed)', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;
    deps.fetchBalance = jest.fn(() => Promise.reject(new Error('timeout')));

    await expect(runSync(deps)).rejects.toThrow('timeout');

    expect(setLastSyncAt).not.toHaveBeenCalled();
  });

  it('leaves sync_state.lastSyncAt unchanged when a feed fetch fails (fail-closed)', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;
    deps.fetchFeedChangedSince = jest.fn(() => Promise.reject(new Error('timeout')));

    await expect(runSync(deps)).rejects.toThrow('timeout');

    expect(setLastSyncAt).not.toHaveBeenCalled();
  });

  // Fail-closed (mirrors the fetch-failure case above): a malformed record
  // must freeze the cursor exactly the same way a transport failure does —
  // the row is never silently dropped, and a retry re-covers the window
  // once the malformed data (or the parser) is fixed.
  it('leaves sync_state.lastSyncAt unchanged and imports nothing when a feed item has an unparseable transactionTime (fail-closed)', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps, transactionsStore } = makeInMemoryDeps(
      () => [feedItem({ transactionTime: 'not-a-date' })],
      [connected],
    );
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;

    await expect(runSync(deps)).rejects.toThrow(/date/i);

    expect(setLastSyncAt).not.toHaveBeenCalled();
    expect(transactionsStore).toHaveLength(0);
  });

  it('reads the token keyed by the resolved connected account id', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    deps.readToken = jest.fn(async () => 'tok');

    await runSync(deps);

    expect(deps.readToken).toHaveBeenCalledWith('acc-starling');
  });

  it('reads the token keyed by the targetAccountId on a first-time connect', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [target]);
    deps.targetAccountId = 'acc-1';
    deps.readToken = jest.fn(async () => 'tok');

    await runSync(deps);

    expect(deps.readToken).toHaveBeenCalledWith('acc-1');
  });

  it('skips an unrepresentable-currency account, completing the sync for the supported one', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const supported = account({ accountUid: 'acc-gbp', currency: 'GBP' });
    const unsupported = account({ accountUid: 'acc-zzz', currency: 'ZZZ' });
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(
      (accountUid) => (accountUid === supported.accountUid ? [feedItem()] : []),
      [connected],
      [supported, unsupported],
    );

    const result = await runSync(deps);

    expect(holdingsStore).toHaveLength(1);
    expect(starlingIdOf(holdingsStore[0].metadata)).toBe(supported.accountUid);
    expect(result.importedTransactions).toBe(1);
    expect(transactionsStore).toHaveLength(1);
  });

  it('throttles across accounts with the injected sleep, sharing one gate', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const accountA = account({ accountUid: 'acc-a' });
    const accountB = account({ accountUid: 'acc-b' });
    const { deps, sleep } = makeInMemoryDeps(() => [], [connected], [accountA, accountB]);

    await runSync(deps);

    // 5 requests total: fetchAccounts, 2x fetchBalance, 2x
    // fetchFeedChangedSince — four gaps, all throttled by the one shared
    // per-run gate.
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 250, 250, 250]);
  });

  it('throws the no-account-connected message in Ukrainian once the active language switches', async () => {
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [
      bankAccount({ id: 'acc-cash', institution: null }),
    ]);

    await i18n.changeLanguage('uk');
    try {
      await expect(runSync(deps)).rejects.toThrow('Рахунок Starling не підключено');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  // The single-flight lock: while one `runSync` is in flight, a second
  // trigger for the SAME account must JOIN the running promise.
  it('coalesces two concurrent triggers into one sync (single-flight lock)', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);

    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchAccountsSpy = jest.fn(async () => {
      await opened;
      return [account()];
    });
    deps.fetchAccounts = fetchAccountsSpy;

    const first = runSync(deps);
    const second = runSync(deps);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(fetchAccountsSpy).toHaveBeenCalledTimes(1);
    expect(firstResult).toBe(secondResult);
    expect(transactionsStore).toHaveLength(1);
  });

  it('runs two different target accounts concurrently without joining', async () => {
    const accountA = bankAccount({ id: 'acc-a', institution: 'starling' });
    const accountB = bankAccount({ id: 'acc-b', institution: 'starling' });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [accountA, accountB]);

    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchAccountsSpy = jest.fn(async () => {
      await opened;
      return [account()];
    });
    deps.fetchAccounts = fetchAccountsSpy;

    const first = runSync({ ...deps, targetAccountId: 'acc-a' });
    const second = runSync({ ...deps, targetAccountId: 'acc-b' });
    release();
    await Promise.all([first, second]);

    expect(fetchAccountsSpy).toHaveBeenCalledTimes(2);
  });

  it('participates in the shared progress session and clears it once settled', async () => {
    const connected = bankAccount({ id: 'acc-starling', institution: 'starling' });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);

    await runSync(deps);

    expect(isSyncingSnapshot()).toBe(false);
    expect(isFastPhaseDone()).toBe(false);
    expect(getProgressSnapshot()).toEqual({
      completed: 0,
      total: 0,
      workCompleted: 0,
      workTotal: 0,
    });
  });
});
