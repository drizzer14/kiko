// op-sqlite's open() calls a native module unavailable under Jest, and
// sync.ts imports the repos which open the connection at load. The real
// repos are globally mocked in jest/setup.js; runSync's data access is fully
// injected through SyncDeps regardless, so the real repos are never
// exercised by these tests.
import {
  getProgressSnapshot,
  getSnapshot as isSyncingSnapshot,
  isFastPhaseDone,
} from '../../monobank/sync-status';
import type { AccountRow, HoldingRow, TransactionRow } from '../../db/schema';
import { i18n } from '../../i18n';
import type { BunqCrypto, BunqMonetaryAccount, BunqPayment } from '../bunq.types';
import {
  fetchMonetaryAccounts as bunqFetchMonetaryAccounts,
  fetchPayments as bunqFetchPayments,
  installClient as bunqInstallClient,
  openSession as bunqOpenSession,
  registerDevice as bunqRegisterDevice,
} from '../client';
import type { BunqContext } from '../credentials';

import { mapAccountToHolding, mapPaymentItem, runSync, type SyncDeps } from './sync';

const account = (overrides: Partial<BunqMonetaryAccount> = {}): BunqMonetaryAccount => ({
  id: 5,
  currency: 'EUR',
  balance: { currency: 'EUR', value: '1234.56' },
  description: 'Personal',
  alias: [{ type: 'IBAN', value: 'NL00BUNQ0000000000' }],
  ...overrides,
});

const paymentItem = (overrides: Partial<BunqPayment> = {}): BunqPayment => ({
  id: 1,
  created: '2026-01-01 10:00:00.000000',
  amount: { currency: 'EUR', value: '-1.50' },
  description: 'Coffee',
  ...overrides,
});

describe('mapAccountToHolding', () => {
  it('maps a bunq monetary account onto a card holding, in minor units', () => {
    const holding = mapAccountToHolding(account(), 'account-1');

    expect(holding.accountId).toBe('account-1');
    expect(holding.type).toBe('card');
    expect(holding.currency).toBe('EUR');
    expect(holding.name).toBe('Personal');
    expect(holding.balanceMinorUnits).toBe(123_456);
    expect(holding.metadata).toEqual({ bunqId: '5', iban: 'NL00BUNQ0000000000' });
  });

  it('falls back to the IBAN, then the raw id, when no description is given', () => {
    const { description: _description, ...withoutName } = account();
    const holding = mapAccountToHolding(withoutName as BunqMonetaryAccount, 'account-1');

    expect(holding.name).toBe('NL00BUNQ0000000000');

    const { description: _d2, alias: _alias, ...withoutNameOrAlias } = account();
    const barest = mapAccountToHolding(withoutNameOrAlias as BunqMonetaryAccount, 'account-1');

    expect(barest.name).toBe('5');
  });

  it('throws on an unrepresentable currency code', () => {
    expect(() =>
      mapAccountToHolding(
        account({ currency: 'ZZZ', balance: { currency: 'ZZZ', value: '1' } }),
        'account-1',
      ),
    ).toThrow(/currency/i);
  });
});

describe('mapPaymentItem', () => {
  it('namespaces the external id by account id and converts to minor units', () => {
    const transaction = mapPaymentItem(paymentItem(), 'holding-1', 'acc-1', 'EUR');

    expect(transaction.source).toBe('bunq');
    expect(transaction.externalId).toBe('acc-1:1');
    expect(transaction.amountMinorUnits).toBe(-150);
    expect(transaction.holdingId).toBe('holding-1');
    expect(transaction.description).toBe('Coffee');
  });

  it('produces a distinct external id per account for the SAME raw payment id', () => {
    const item = paymentItem();
    const a = mapPaymentItem(item, 'holding-a', 'acc-a', 'EUR');
    const b = mapPaymentItem(item, 'holding-b', 'acc-b', 'EUR');

    expect(a.externalId).toBe('acc-a:1');
    expect(b.externalId).toBe('acc-b:1');
    expect(a.externalId).not.toBe(b.externalId);
  });

  it('defaults a missing description to an empty string and no counterparty IBAN to null', () => {
    const { description: _description, ...withoutDescription } = paymentItem();
    const transaction = mapPaymentItem(
      withoutDescription as BunqPayment,
      'holding-1',
      'acc-1',
      'EUR',
    );

    expect(transaction.description).toBe('');
    expect(transaction.counterIban).toBeNull();
  });

  it('persists the counterparty IBAN when the payment carries one', () => {
    const item = paymentItem({ counterparty_alias: { iban: 'NL00BUNQ0000000001' } });
    const transaction = mapPaymentItem(item, 'holding-1', 'acc-1', 'EUR');

    expect(transaction.counterIban).toBe('NL00BUNQ0000000001');
  });

  it('throws, naming the account and the raw value, on an unparseable payment date rather than persisting NaN', () => {
    const item = paymentItem({ created: 'not-a-date' });

    expect(() => mapPaymentItem(item, 'holding-1', 'acc-1', 'EUR')).toThrow(/date/i);
    expect(() => mapPaymentItem(item, 'holding-1', 'acc-1', 'EUR')).toThrow(/acc-1/);
    expect(() => mapPaymentItem(item, 'holding-1', 'acc-1', 'EUR')).toThrow(/not-a-date/);
  });

  it('throws, naming the account and the raw value, on an unparseable payment amount rather than persisting NaN', () => {
    const item = paymentItem({ amount: { currency: 'EUR', value: 'not-a-number' } });

    expect(() => mapPaymentItem(item, 'holding-1', 'acc-1', 'EUR')).toThrow(/amount/i);
    expect(() => mapPaymentItem(item, 'holding-1', 'acc-1', 'EUR')).toThrow(/acc-1/);
    expect(() => mapPaymentItem(item, 'holding-1', 'acc-1', 'EUR')).toThrow(/not-a-number/);
  });
});

const bunqIdOf = (metadata: unknown): string | undefined =>
  (metadata as { bunqId?: string } | null)?.bunqId;

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

/**
 * A faithful in-memory double of every injected seam: holdings upsert on
 * (accountId, bunqId), transactions dedup on (source, externalId) — the
 * same keys the real repos enforce. Mirrors
 * `src/privatbank/sync/sync.test.ts`'s deps-injection style, extended with
 * the handshake/context seams `BunqCrypto` design needs.
 */
const makeInMemoryDeps = (
  paymentsFor: (accountId: string) => BunqPayment[],
  initialAccounts: AccountRow[] = [],
  fetchedAccounts: BunqMonetaryAccount[] = [account()],
) => {
  const accountsStore: AccountRow[] = initialAccounts.map((row) => ({ ...row }));
  const holdingsStore: HoldingRow[] = [];
  const transactionsStore: TransactionRow[] = [];
  const syncStateRow: { lastSyncAt: number | null } = { lastSyncAt: null };
  const contextStore = new Map<string, BunqContext>();
  let sequence = 0;
  const nextId = (): string => `id-${++sequence}`;
  const sleep = jest.fn(async (_milliseconds: number): Promise<void> => undefined);

  const upsertBunqMany: SyncDeps['holdingsRepo']['upsertBunqMany'] = async (holdings) => {
    for (const { bunqId, metadata, ...rest } of holdings) {
      const merged = { ...(metadata as Record<string, unknown> | null), bunqId };
      const existing = holdingsStore.find(
        (holding) => holding.accountId === rest.accountId && bunqIdOf(holding.metadata) === bunqId,
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
    upsertBunqMany,
  };

  const transactionsRepo: SyncDeps['transactionsRepo'] = { addManyDedup };

  const syncStateRepo: SyncDeps['syncStateRepo'] = {
    getQuery: async () => [syncStateRow],
    ensure: async () => undefined,
    setLastSyncAt: async () => undefined,
  };

  const crypto: BunqCrypto = {
    generateKeyPair: jest.fn(async () => ({
      privateKeyPem: 'private-key-fixture',
      publicKeyPem: 'public-key-fixture',
    })),
    sign: jest.fn(async () => 'signature-fixture'),
  };

  const handshakeCalls: string[] = [];

  const installClient = jest.fn(async () => {
    handshakeCalls.push('installClient');
    return {
      installationToken: 'install-token-fixture',
      privateKeyPem: 'private-key-fixture',
      publicKeyPem: 'public-key-fixture',
    };
  });
  const registerDevice = jest.fn(async () => {
    handshakeCalls.push('registerDevice');
    return 'device-1';
  });
  const openSession = jest.fn(async () => {
    handshakeCalls.push('openSession');
    return { sessionToken: 'session-token-fixture', userId: 'user-1', sessionTtlSeconds: 900 };
  });

  const deps: SyncDeps = {
    fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
    now: () => 1_704_326_400_000,
    sleep,
    crypto,
    readApiKey: async () => ({ apiKey: 'bunq-key-fixture' }),
    readContext: async (accountId: string) => contextStore.get(accountId),
    saveContext: async (accountId: string, context: BunqContext) => {
      contextStore.set(accountId, context);
    },
    installClient,
    registerDevice,
    openSession,
    fetchMonetaryAccounts: async () => fetchedAccounts,
    fetchPayments: async (_session, accountId) => ({
      payments: paymentsFor(accountId),
      nextOlderId: undefined,
    }),
    accountsRepo,
    holdingsRepo,
    transactionsRepo,
    syncStateRepo,
  };

  return {
    deps,
    accountsStore,
    holdingsStore,
    transactionsStore,
    syncStateRow,
    sleep,
    contextStore,
    handshakeCalls,
  };
};

describe('runSync', () => {
  const onlyPrimaryAccount = (accountId: string): BunqPayment[] =>
    accountId === String(account().id) ? [paymentItem()] : [];

  it('marks the target account bunq, upserts holdings, and imports payments', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore, holdingsStore, transactionsStore } = makeInMemoryDeps(
      onlyPrimaryAccount,
      [target],
    );
    deps.targetAccountId = 'acc-1';

    const result = await runSync(deps);

    expect(accountsStore).toHaveLength(1);
    expect(accountsStore[0].institution).toBe('bunq');
    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0].accountId).toBe('acc-1');
    expect(result.importedTransactions).toBe(1);
    expect(transactionsStore).toHaveLength(1);
    expect(transactionsStore[0].externalId).toBe('acc-1:1');
  });

  it('with no target id, syncs into the existing institution=bunq account', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps(onlyPrimaryAccount, [
      connected,
    ]);

    await runSync(deps);

    expect(accountsStore).toHaveLength(1);
    expect(holdingsStore.every((holding) => holding.accountId === 'acc-bunq')).toBe(true);
  });

  it('throws when neither a target id nor an existing bunq account exists', async () => {
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [
      bankAccount({ id: 'acc-cash', institution: null }),
    ]);

    await expect(runSync(deps)).rejects.toThrow('No bunq account connected');
    expect(holdingsStore).toHaveLength(0);
    expect(transactionsStore).toHaveLength(0);
  });

  it('imports zero new transactions on a second run (dedup on source + externalId)', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);

    const first = await runSync(deps);
    const second = await runSync(deps);

    expect(first.importedTransactions).toBe(1);
    expect(second.importedTransactions).toBe(0);
    expect(transactionsStore).toHaveLength(1);
  });

  it('leaves the target account unmarked when fetchMonetaryAccounts fails', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore } = makeInMemoryDeps(onlyPrimaryAccount, [target]);
    deps.targetAccountId = 'acc-1';
    deps.fetchMonetaryAccounts = jest.fn(() => Promise.reject(new Error('401')));

    await expect(runSync(deps)).rejects.toThrow('401');

    expect(accountsStore[0].institution).toBeNull();
  });

  it('marks the target account only once fetchMonetaryAccounts resolves, not before', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore } = makeInMemoryDeps(onlyPrimaryAccount, [target]);
    deps.targetAccountId = 'acc-1';
    const calls: string[] = [];
    const originalFetch = deps.fetchMonetaryAccounts;
    deps.fetchMonetaryAccounts = async (session, fetchImpl) => {
      calls.push('fetchMonetaryAccounts');
      expect(accountsStore[0].institution).toBeNull();
      return originalFetch(session, fetchImpl);
    };
    deps.accountsRepo.update = async (accountId, patch) => {
      calls.push('updateAccount');
      const row = accountsStore.find((account_) => account_.id === accountId);

      if (row) {
        Object.assign(row, patch);
      }
    };

    await runSync(deps);

    expect(calls).toEqual(['fetchMonetaryAccounts', 'updateAccount']);
    expect(accountsStore[0].institution).toBe('bunq');
  });

  it('throws when no API key is stored, without importing anything, and never advances the cursor', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    deps.readApiKey = async () => undefined;
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;

    await expect(runSync(deps)).rejects.toThrow(/credentials/i);

    expect(transactionsStore).toHaveLength(0);
    expect(setLastSyncAt).not.toHaveBeenCalled();
  });

  // Fail-closed: a payment fetch failure on one account must not advance the
  // cursor, so the SAME window is re-covered idempotently on the next run.
  it('leaves sync_state.lastSyncAt unchanged when a payment fetch fails (fail-closed)', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;
    deps.fetchPayments = jest.fn(() => Promise.reject(new Error('timeout')));

    await expect(runSync(deps)).rejects.toThrow('timeout');

    expect(setLastSyncAt).not.toHaveBeenCalled();
  });

  it('leaves sync_state.lastSyncAt unchanged and imports nothing when a payment has an unparseable date (fail-closed)', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const { deps, transactionsStore } = makeInMemoryDeps(
      () => [paymentItem({ created: 'not-a-date' })],
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

  it('leaves sync_state.lastSyncAt unchanged and imports nothing when a payment has an unparseable amount (fail-closed)', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const { deps, transactionsStore } = makeInMemoryDeps(
      () => [paymentItem({ amount: { currency: 'EUR', value: 'not-a-number' } })],
      [connected],
    );
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;

    await expect(runSync(deps)).rejects.toThrow(/amount/i);

    expect(setLastSyncAt).not.toHaveBeenCalled();
    expect(transactionsStore).toHaveLength(0);
  });

  // Fail-closed: the page-walk cap must never be treated as a silent
  // success. An account whose payment feed still reports in-window items
  // (and another page) at every one of the MAX_PAYMENT_PAGES iterations
  // never reaches the incremental floor — returning the partial set here
  // would let the cursor advance past unfetched, still-in-window payments
  // that would then never be retried.
  it('leaves sync_state.lastSyncAt unchanged and imports nothing when a payment feed exceeds the page cap before reaching the sync window floor (fail-closed)', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;
    let call = 0;
    deps.fetchPayments = jest.fn(async () => {
      call += 1;
      // Every page returns one payment still WITHIN the sync window (never
      // older than `sinceMs`, so the floor is never reached) and always
      // offers another `nextOlderId` — an unbounded feed relative to the cap.
      return {
        payments: [paymentItem({ id: call, created: '2026-01-01 10:00:00.000000' })],
        nextOlderId: String(call),
      };
    });

    let thrown: unknown;
    try {
      await runSync(deps);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    // Names the (bunq) account id and the cap in the fail-closed message.
    expect((thrown as Error).message).toMatch(/exceeds/i);
    expect((thrown as Error).message).toContain(String(account().id));
    expect((thrown as Error).message).toContain('50');
    expect(setLastSyncAt).not.toHaveBeenCalled();
    expect(transactionsStore).toHaveLength(0);
  });

  it('reads the API key keyed by the resolved connected account id', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
    deps.readApiKey = jest.fn(async () => ({ apiKey: 'bunq-key-fixture' }));

    await runSync(deps);

    expect(deps.readApiKey).toHaveBeenCalledWith('acc-bunq');
  });

  it('reads the API key keyed by the targetAccountId on a first-time connect', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [target]);
    deps.targetAccountId = 'acc-1';
    deps.readApiKey = jest.fn(async () => ({ apiKey: 'bunq-key-fixture' }));

    await runSync(deps);

    expect(deps.readApiKey).toHaveBeenCalledWith('acc-1');
  });

  it('skips an unrepresentable-currency account, completing the sync for the supported one', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const supported = account({ id: 1, balance: { currency: 'EUR', value: '10.00' } });
    const unsupported = account({
      id: 2,
      currency: 'ZZZ',
      balance: { currency: 'ZZZ', value: '10.00' },
    });
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(
      (accountId) => (accountId === '1' ? [paymentItem()] : []),
      [connected],
      [supported, unsupported],
    );

    const result = await runSync(deps);

    expect(holdingsStore).toHaveLength(1);
    expect(bunqIdOf(holdingsStore[0].metadata)).toBe('1');
    expect(result.importedTransactions).toBe(1);
    expect(transactionsStore).toHaveLength(1);
  });

  it('throttles across accounts with the injected sleep, sharing one gate', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const accountA = account({ id: 1 });
    const accountB = account({ id: 2 });
    const { deps, sleep } = makeInMemoryDeps(() => [], [connected], [accountA, accountB]);

    await runSync(deps);

    // 3 read requests total: fetchMonetaryAccounts, account 1's payments,
    // account 2's payments — two gaps, both throttled by the one shared
    // per-run READ gate (the handshake's own session-server call is not
    // paced by this gate — see `ensureBunqContext`).
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([500, 500]);
  });

  it('isolates a per-account failure: one account failing does not stop another from importing', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const accountA = account({ id: 1 });
    const accountB = account({ id: 2 });
    const { deps, transactionsStore } = makeInMemoryDeps(
      () => [],
      [connected],
      [accountA, accountB],
    );
    deps.fetchPayments = jest.fn(async (_session, accountId) => {
      if (accountId === '1') {
        throw new Error('boom');
      }

      return { payments: [paymentItem()], nextOlderId: undefined };
    });

    await expect(runSync(deps)).rejects.toThrow('boom');

    // Account 2's payment still imported despite account 1's failure.
    expect(transactionsStore).toHaveLength(1);
  });

  it('throws the no-account-connected message in Ukrainian once the active language switches', async () => {
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [
      bankAccount({ id: 'acc-cash', institution: null }),
    ]);

    await i18n.changeLanguage('uk');
    try {
      await expect(runSync(deps)).rejects.toThrow('Рахунок bunq не підключено');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  // The single-flight lock: while one `runSync` is in flight, a second
  // trigger for the SAME account must JOIN the running promise.
  it('coalesces two concurrent triggers into one sync (single-flight lock)', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);

    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMonetaryAccountsSpy = jest.fn(async () => {
      await opened;
      return [account()];
    });
    deps.fetchMonetaryAccounts = fetchMonetaryAccountsSpy;

    const first = runSync(deps);
    const second = runSync(deps);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(fetchMonetaryAccountsSpy).toHaveBeenCalledTimes(1);
    expect(firstResult).toBe(secondResult);
    expect(transactionsStore).toHaveLength(1);
  });

  it('runs two different target accounts concurrently without joining', async () => {
    const accountA = bankAccount({ id: 'acc-a', institution: 'bunq' });
    const accountB = bankAccount({ id: 'acc-b', institution: 'bunq' });
    const { deps } = makeInMemoryDeps(onlyPrimaryAccount, [accountA, accountB]);

    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMonetaryAccountsSpy = jest.fn(async () => {
      await opened;
      return [account()];
    });
    deps.fetchMonetaryAccounts = fetchMonetaryAccountsSpy;

    const first = runSync({ ...deps, targetAccountId: 'acc-a' });
    const second = runSync({ ...deps, targetAccountId: 'acc-b' });
    release();
    await Promise.all([first, second]);

    expect(fetchMonetaryAccountsSpy).toHaveBeenCalledTimes(2);
  });

  it('participates in the shared progress session and clears it once settled', async () => {
    const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
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

  describe('the handshake / session cache (ensureBunqContext)', () => {
    it('on a first-ever connect, runs installClient -> registerDevice -> openSession in order, threading each token', async () => {
      const target = bankAccount({ id: 'acc-1', institution: null });
      const { deps, handshakeCalls } = makeInMemoryDeps(onlyPrimaryAccount, [target]);
      const { installClient, registerDevice, openSession } = deps;
      deps.targetAccountId = 'acc-1';

      await runSync(deps);

      expect(handshakeCalls).toEqual(['installClient', 'registerDevice', 'openSession']);
      expect(registerDevice).toHaveBeenCalledWith(
        'install-token-fixture',
        'bunq-key-fixture',
        deps.fetchImpl,
      );
      expect(openSession).toHaveBeenCalledWith(
        expect.objectContaining({
          installationToken: 'install-token-fixture',
          apiKey: 'bunq-key-fixture',
          privateKeyPem: 'private-key-fixture',
        }),
        deps.fetchImpl,
      );
      expect(installClient).toHaveBeenCalledTimes(1);
    });

    it('persists the derived context so a later sync can read it back', async () => {
      const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
      const { deps, contextStore } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);

      await runSync(deps);

      const stored = contextStore.get('acc-bunq');
      expect(stored?.sessionToken).toBe('session-token-fixture');
      expect(stored?.userId).toBe('user-1');
      expect(stored?.installationToken).toBe('install-token-fixture');
      expect(stored?.deviceId).toBe('device-1');
    });

    it('reuses a cached, still-valid session on a re-run WITHOUT re-running any part of the handshake', async () => {
      const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
      const { deps, handshakeCalls } = makeInMemoryDeps(onlyPrimaryAccount, [connected]);

      await runSync(deps);
      handshakeCalls.length = 0;
      await runSync(deps);

      expect(handshakeCalls).toEqual([]);
    });

    it('re-opens ONLY the session (not the full handshake) when the cached session has expired', async () => {
      const connected = bankAccount({ id: 'acc-bunq', institution: 'bunq' });
      const built = makeInMemoryDeps(onlyPrimaryAccount, [connected]);
      const { deps, handshakeCalls, contextStore } = built;

      await runSync(deps);
      // Expire the cached session by rewinding its stored expiry.
      const stored = contextStore.get('acc-bunq');
      if (stored) {
        contextStore.set('acc-bunq', { ...stored, sessionExpiresAt: deps.now() - 1 });
      }
      handshakeCalls.length = 0;

      await runSync(deps);

      expect(handshakeCalls).toEqual(['openSession']);
      // The keypair + installation token + device id are REUSED, not regenerated.
      expect(contextStore.get('acc-bunq')?.installationToken).toBe('install-token-fixture');
      expect(contextStore.get('acc-bunq')?.deviceId).toBe('device-1');
    });
  });
});

// Every test above drives `runSync` through DEPS-LEVEL stubs for
// `fetchMonetaryAccounts`/`fetchPayments`/`installClient`/`registerDevice`/
// `openSession`, bypassing `../client`'s actual HTTP-request/tagged-envelope
// parsing entirely (that layer is unit-tested on its own terms in
// `../client/bunq.client.test.ts`, never through `runSync`). This closes that
// seam: the REAL client functions run against ONE mocked `fetchImpl`
// dispatched by URL, returning a realistic bunq sandbox-shaped tagged
// Response-array envelope end to end (installation -> device -> session ->
// monetary-account -> payment), so the full wire-to-mapping path is proven at
// least once, not just its two halves independently.
describe('runSync end-to-end against a realistic bunq sandbox-shaped response (real client.ts, real mapping)', () => {
  const jsonResponse = (body: unknown): Response =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  const installationEnvelope = {
    Response: [
      { Id: { id: 1 } },
      { Token: { id: 2, token: 'installation-token-fixture' } },
      { ServerPublicKey: { server_public_key: 'server-public-key-fixture' } },
    ],
  };
  const deviceEnvelope = { Response: [{ Id: { id: 42 } }] };
  const sessionEnvelope = {
    Response: [
      { Id: { id: 3 } },
      { Token: { id: 4, token: 'session-token-fixture' } },
      { UserPerson: { id: 99, session_timeout: 900 } },
    ],
  };
  // A MonetaryAccountSavings entry alongside the Bank one — CONFIRMED
  // (`fetchMonetaryAccounts`'s own doc comment) that only the `Bank` tag is
  // mapped; this proves the unmapped tag is actually excluded end-to-end, not
  // just by the client unit test's own narrower fixture.
  const monetaryAccountEnvelope = {
    Response: [
      {
        MonetaryAccountBank: {
          id: 15_467,
          currency: 'EUR',
          balance: { currency: 'EUR', value: '1234.56' },
          description: 'Personal account',
          alias: [{ type: 'IBAN', value: 'NL43BUNQ2291234567', name: 'J. Doe' }],
        },
      },
      {
        MonetaryAccountSavings: {
          id: 15_468,
          currency: 'EUR',
          balance: { currency: 'EUR', value: '500.00' },
        },
      },
    ],
  };
  const paymentsEnvelope = {
    Response: [
      {
        Payment: {
          id: 2321,
          created: '2026-01-05 14:23:01.123456',
          amount: { currency: 'EUR', value: '-42.10' },
          description: 'Albert Heijn',
          counterparty_alias: { iban: 'NL69ABNA0433787980', display_name: 'Albert Heijn' },
        },
      },
      {
        Payment: {
          id: 2322,
          created: '2026-01-06 09:00:00.000000',
          amount: { currency: 'EUR', value: '250.00' },
          description: 'Salary',
        },
      },
    ],
  };

  it('drives the real handshake + client fetch + mapping into holdings and namespaced transactions', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore, holdingsStore, transactionsStore } = makeInMemoryDeps(
      () => [],
      [target],
    );
    deps.targetAccountId = 'acc-1';
    deps.now = () => Date.parse('2026-01-10T00:00:00.000Z');

    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('/installation')) {
        return jsonResponse(installationEnvelope);
      }
      if (url.includes('/device-server')) {
        return jsonResponse(deviceEnvelope);
      }
      if (url.includes('/session-server')) {
        return jsonResponse(sessionEnvelope);
      }
      // A payment URL also contains "/monetary-account", so this check must
      // run before the monetary-account one below.
      if (url.includes('/payment')) {
        return jsonResponse(paymentsEnvelope);
      }
      if (url.includes('/monetary-account')) {
        return jsonResponse(monetaryAccountEnvelope);
      }
      throw new Error(`unexpected bunq url in integration test: ${url}`);
    }) as unknown as typeof fetch;

    deps.fetchImpl = fetchImpl;
    deps.installClient = bunqInstallClient;
    deps.registerDevice = bunqRegisterDevice;
    deps.openSession = bunqOpenSession;
    deps.fetchMonetaryAccounts = bunqFetchMonetaryAccounts;
    deps.fetchPayments = bunqFetchPayments;

    const result = await runSync(deps);

    expect(accountsStore[0].institution).toBe('bunq');
    // Only the MonetaryAccountBank entry maps to a holding — the Savings one
    // is silently excluded (unmapped tag).
    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0].balanceMinorUnits).toBe(123_456);
    expect(bunqIdOf(holdingsStore[0].metadata)).toBe('15467');

    expect(result.importedTransactions).toBe(2);
    expect(transactionsStore).toHaveLength(2);
    const outgoing = transactionsStore.find((row) => row.externalId === 'acc-1:2321');
    const incoming = transactionsStore.find((row) => row.externalId === 'acc-1:2322');
    // The negative decimal-string Amount value converts to a negative minor-unit
    // integer; the counterparty IBAN rides along.
    expect(outgoing?.amountMinorUnits).toBe(-4210);
    expect(outgoing?.counterIban).toBe('NL69ABNA0433787980');
    expect(incoming?.amountMinorUnits).toBe(25_000);
    expect(transactionsStore.every((row) => row.source === 'bunq')).toBe(true);
  });
});
