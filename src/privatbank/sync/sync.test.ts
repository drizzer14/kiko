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
import type { PrivatbankAccount, PrivatbankStatementItem } from '../privatbank.types';

import { mapAccountToHolding, mapStatementItem, runSync, type SyncDeps } from './sync';

const account = (overrides: Partial<PrivatbankAccount> = {}): PrivatbankAccount => ({
  acc: 'UA000000000000000000000000000',
  currency: 'UAH',
  balance: '1234.56',
  name: 'Картка',
  ...overrides,
});

const statementItem = (
  overrides: Partial<PrivatbankStatementItem> = {},
): PrivatbankStatementItem => ({
  id: 'stmt-1',
  date: '01.01.2026 10:00:00',
  amount: '-100.00',
  currency: 'UAH',
  description: 'Coffee',
  ...overrides,
});

describe('mapAccountToHolding', () => {
  it('maps a PrivatBank account onto a card holding, in minor units', () => {
    const holding = mapAccountToHolding(account(), 'account-1');

    expect(holding.accountId).toBe('account-1');
    expect(holding.type).toBe('card');
    expect(holding.currency).toBe('UAH');
    expect(holding.name).toBe('Картка');
    expect(holding.balanceMinorUnits).toBe(123_456);
    expect(holding.metadata).toEqual({
      privatbankId: 'UA000000000000000000000000000',
      iban: 'UA000000000000000000000000000',
    });
  });

  it('falls back to the account number when no name is given', () => {
    const { name, ...withoutName } = account();
    const holding = mapAccountToHolding(withoutName as PrivatbankAccount, 'account-1');

    expect(holding.name).toBe('UA000000000000000000000000000');
  });

  it('throws on an unrepresentable currency code', () => {
    expect(() => mapAccountToHolding(account({ currency: 'ZZZ' }), 'account-1')).toThrow(
      /currency/i,
    );
  });
});

describe('mapStatementItem', () => {
  it('namespaces the external id by account id and converts to minor units', () => {
    const transaction = mapStatementItem(statementItem(), 'holding-1', 'acc-1', 'UAH');

    expect(transaction.source).toBe('privatbank');
    expect(transaction.externalId).toBe('acc-1:stmt-1');
    expect(transaction.amountMinorUnits).toBe(-10_000);
    expect(transaction.holdingId).toBe('holding-1');
    expect(transaction.description).toBe('Coffee');
  });

  it('produces a distinct external id per account for the SAME raw statement id', () => {
    const item = statementItem();
    const a = mapStatementItem(item, 'holding-a', 'acc-a', 'UAH');
    const b = mapStatementItem(item, 'holding-b', 'acc-b', 'UAH');

    expect(a.externalId).toBe('acc-a:stmt-1');
    expect(b.externalId).toBe('acc-b:stmt-1');
    expect(a.externalId).not.toBe(b.externalId);
  });

  it('defaults a missing description to an empty string and no counterIban to null', () => {
    const { description, ...withoutDescription } = statementItem();
    const transaction = mapStatementItem(
      withoutDescription as PrivatbankStatementItem,
      'holding-1',
      'acc-1',
      'UAH',
    );

    expect(transaction.description).toBe('');
    expect(transaction.counterIban).toBeNull();
  });

  it('persists the counterparty IBAN when the statement item carries one', () => {
    const item = statementItem({ counterIban: 'UA733220010000026201112223334' });
    const transaction = mapStatementItem(item, 'holding-1', 'acc-1', 'UAH');

    expect(transaction.counterIban).toBe('UA733220010000026201112223334');
  });
});

const privatbankIdOf = (metadata: unknown): string | undefined =>
  (metadata as { privatbankId?: string } | null)?.privatbankId;

/**
 * A faithful in-memory double of the injected data-access seams: holdings
 * upsert on (accountId, privatbankId), transactions dedup on (source,
 * externalId) — the same keys the real repos enforce. Mirrors
 * `src/monobank/sync/sync.test.ts`'s deps-injection style.
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
  statementFor: (accountId: string) => PrivatbankStatementItem[],
  initialAccounts: AccountRow[] = [],
  fetchedAccounts: PrivatbankAccount[] = [account()],
) => {
  const accountsStore: AccountRow[] = initialAccounts.map((row) => ({ ...row }));
  const holdingsStore: HoldingRow[] = [];
  const transactionsStore: TransactionRow[] = [];
  const syncStateRow: { lastSyncAt: number | null } = { lastSyncAt: null };
  let sequence = 0;
  const nextId = (): string => `id-${++sequence}`;
  const sleep = jest.fn(async (_milliseconds: number): Promise<void> => undefined);

  const upsertPrivatbankMany: SyncDeps['holdingsRepo']['upsertPrivatbankMany'] = async (
    holdings,
  ) => {
    for (const { privatbankId, metadata, ...rest } of holdings) {
      const merged = { ...(metadata as Record<string, unknown> | null), privatbankId };
      const existing = holdingsStore.find(
        (holding) =>
          holding.accountId === rest.accountId && privatbankIdOf(holding.metadata) === privatbankId,
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
          counterIban: input.counterIban ?? null,
        });
        continue;
      }

      transactionsStore.push({
        id: nextId(),
        createdAt: 0,
        ...input,
        description: input.description ?? '',
        counterIban: input.counterIban ?? null,
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
    upsertPrivatbankMany,
  };

  const transactionsRepo: SyncDeps['transactionsRepo'] = { addManyDedup };

  const syncStateRepo: SyncDeps['syncStateRepo'] = {
    getQuery: async () => [syncStateRow],
    ensure: async () => undefined,
    setLastSyncAt: async () => undefined,
  };

  const deps: SyncDeps = {
    fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
    now: () => 1_704_326_400_000,
    sleep,
    readCredentials: async () => ({ token: 'tok', clientId: 'client-1' }),
    fetchAccounts: async () => fetchedAccounts,
    fetchStatement: async (_credentials, accountId) => statementFor(accountId),
    accountsRepo,
    holdingsRepo,
    transactionsRepo,
    syncStateRepo,
  };

  return { deps, accountsStore, holdingsStore, transactionsStore, syncStateRow, sleep };
};

describe('runSync', () => {
  const onlyPrimaryAccount = (accountId: string): PrivatbankStatementItem[] =>
    accountId === account().acc ? [statementItem()] : [];

  it('marks the target account privatbank, upserts holdings, and imports statement items', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore, holdingsStore, transactionsStore } = makeInMemoryDeps(
      onlyPrimaryAccount,
      [target],
    );
    deps.targetAccountId = 'acc-1';

    const result = await runSync(deps);

    expect(accountsStore).toHaveLength(1);
    expect(accountsStore[0].institution).toBe('privatbank');
    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0].accountId).toBe('acc-1');
    expect(result.importedTransactions).toBe(1);
    expect(transactionsStore).toHaveLength(1);
    expect(transactionsStore[0].externalId).toBe('acc-1:stmt-1');
  });

  it('with no target id, syncs into the existing institution=privatbank account', async () => {
    const connected = bankAccount({ id: 'acc-privat', institution: 'privatbank' });
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps(onlyPrimaryAccount, [
      connected,
    ]);

    await runSync(deps);

    expect(accountsStore).toHaveLength(1);
    expect(holdingsStore.every((holding) => holding.accountId === 'acc-privat')).toBe(true);
  });

  it('throws when neither a target id nor an existing privatbank account exists', async () => {
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [
      bankAccount({ id: 'acc-cash', institution: null }),
    ]);

    await expect(runSync(deps)).rejects.toThrow('No PrivatBank account connected');
    expect(holdingsStore).toHaveLength(0);
    expect(transactionsStore).toHaveLength(0);
  });

  it('imports zero new transactions on a second run (dedup on source + externalId)', async () => {
    const connected = bankAccount({ id: 'acc-privat', institution: 'privatbank' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);

    const first = await runSync(deps);
    const second = await runSync(deps);

    expect(first.importedTransactions).toBe(1);
    expect(second.importedTransactions).toBe(0);
    expect(transactionsStore).toHaveLength(1);
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
    deps.fetchAccounts = async (credentials, fetchImpl) => {
      calls.push('fetchAccounts');
      expect(accountsStore[0].institution).toBeNull();
      return originalFetchAccounts(credentials, fetchImpl);
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
    expect(accountsStore[0].institution).toBe('privatbank');
  });

  it('throws when no credentials are stored, without importing anything, and never advances the cursor', async () => {
    const connected = bankAccount({ id: 'acc-privat', institution: 'privatbank' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    deps.readCredentials = async () => undefined;
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;

    await expect(runSync(deps)).rejects.toThrow(/credentials/i);

    expect(transactionsStore).toHaveLength(0);
    expect(setLastSyncAt).not.toHaveBeenCalled();
  });

  // Fail-closed: a fetchStatement failure on one account must not advance the
  // cursor, so the SAME window is re-covered idempotently on the next run.
  it('leaves sync_state.lastSyncAt unchanged when a statement fetch fails (fail-closed)', async () => {
    const connected = bankAccount({ id: 'acc-privat', institution: 'privatbank' });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;
    deps.fetchStatement = jest.fn(() => Promise.reject(new Error('timeout')));

    await expect(runSync(deps)).rejects.toThrow('timeout');

    expect(setLastSyncAt).not.toHaveBeenCalled();
  });

  it('reads credentials keyed by the resolved connected account id', async () => {
    const connected = bankAccount({ id: 'acc-privat', institution: 'privatbank' });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    deps.readCredentials = jest.fn(async () => ({ token: 'tok', clientId: 'client-1' }));

    await runSync(deps);

    expect(deps.readCredentials).toHaveBeenCalledWith('acc-privat');
  });

  it('reads credentials keyed by the targetAccountId on a first-time connect', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [target]);
    deps.targetAccountId = 'acc-1';
    deps.readCredentials = jest.fn(async () => ({ token: 'tok', clientId: 'client-1' }));

    await runSync(deps);

    expect(deps.readCredentials).toHaveBeenCalledWith('acc-1');
  });

  it('skips an unrepresentable-currency account, completing the sync for the supported one', async () => {
    const connected = bankAccount({ id: 'acc-privat', institution: 'privatbank' });
    const supported = account({ acc: 'acc-uah', currency: 'UAH' });
    const unsupported = account({ acc: 'acc-zzz', currency: 'ZZZ' });
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(
      (accountId) => (accountId === supported.acc ? [statementItem()] : []),
      [connected],
      [supported, unsupported],
    );

    const result = await runSync(deps);

    expect(holdingsStore).toHaveLength(1);
    expect(privatbankIdOf(holdingsStore[0].metadata)).toBe(supported.acc);
    expect(result.importedTransactions).toBe(1);
    expect(transactionsStore).toHaveLength(1);
  });

  it('throttles across accounts with the injected sleep, sharing one gate', async () => {
    const connected = bankAccount({ id: 'acc-privat', institution: 'privatbank' });
    const accountA = account({ acc: 'acc-a' });
    const accountB = account({ acc: 'acc-b' });
    const { deps, sleep } = makeInMemoryDeps(() => [], [connected], [accountA, accountB]);

    await runSync(deps);

    // 3 requests total: fetchAccounts, account A's statement, account B's
    // statement — two gaps, both throttled by the one shared per-run gate.
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([60_000, 60_000]);
  });

  it('isolates a per-account failure: one account failing does not stop another from importing', async () => {
    const connected = bankAccount({ id: 'acc-privat', institution: 'privatbank' });
    const accountA = account({ acc: 'acc-a' });
    const accountB = account({ acc: 'acc-b' });
    const { deps, transactionsStore } = makeInMemoryDeps(
      () => [],
      [connected],
      [accountA, accountB],
    );
    deps.fetchStatement = jest.fn(async (_credentials, accountId) => {
      if (accountId === 'acc-a') {
        throw new Error('boom');
      }

      return [statementItem()];
    });

    await expect(runSync(deps)).rejects.toThrow('boom');

    // Account B's statement still imported despite account A's failure.
    expect(transactionsStore).toHaveLength(1);
  });

  it('throws the no-account-connected message in Ukrainian once the active language switches', async () => {
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [
      bankAccount({ id: 'acc-cash', institution: null }),
    ]);

    await i18n.changeLanguage('uk');
    try {
      await expect(runSync(deps)).rejects.toThrow('Рахунок ПриватБанк не підключено');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  // The single-flight lock: while one `runSync` is in flight, a second
  // trigger for the SAME account must JOIN the running promise.
  it('coalesces two concurrent triggers into one sync (single-flight lock)', async () => {
    const connected = bankAccount({ id: 'acc-privat', institution: 'privatbank' });
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
    const accountA = bankAccount({ id: 'acc-a', institution: 'privatbank' });
    const accountB = bankAccount({ id: 'acc-b', institution: 'privatbank' });
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
    const connected = bankAccount({ id: 'acc-privat', institution: 'privatbank' });
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
