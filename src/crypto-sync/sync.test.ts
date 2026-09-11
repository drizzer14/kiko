// op-sqlite's open() calls a native module unavailable under Jest, and sync.ts
// imports the repos which open the connection at load. The global stub in
// `jest/setup.js` lets the module graph load; runBalanceSync's data access is
// fully injected through BalanceSyncDeps, so the real repos are never exercised
// here.
import type { AccountRow, HoldingRow } from '../db/schema';
import { i18n } from '../i18n';
import {
  getProgressSnapshot,
  getSnapshot as isSyncingSnapshot,
  setSyncing,
  setSyncProgress,
  subscribeProgress,
} from '../monobank/sync-status';

import type { BalanceProvider, ProviderBalance, SyncTarget } from './provider';
import { type BalanceSyncDeps, runBalanceSync } from './sync';

const NOW = 1_704_326_400_000;
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const cryptoAccount = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'acc-1',
  name: 'Cold storage',
  kind: 'crypto',
  institution: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  ...overrides,
});

const walletBalance = (balanceMinorUnits: number): ProviderBalance => ({
  currency: 'BTC',
  balanceMinorUnits,
  metadataKey: ADDRESS,
  name: 'BTC Wallet',
});

type FakeDeps = { balances: ProviderBalance[] | Error };

/**
 * A wallet-shaped provider whose result is injected through its deps; records
 * every `fetchBalances` call so a test can assert how often and with which
 * target it ran. Throws when `balances` is an Error, to model a failed fetch.
 */
const makeProvider = (id: BalanceProvider<FakeDeps>['id'] = 'btc_wallet') => {
  const calls: SyncTarget[] = [];
  const provider: BalanceProvider<FakeDeps> = {
    id,
    kind: 'wallet',
    metadataField: 'walletAddress',
    fetchBalances: async (deps, target) => {
      calls.push(target);

      if (deps.balances instanceof Error) {
        throw deps.balances;
      }

      return deps.balances;
    },
  };

  return { provider, calls };
};

/**
 * A faithful in-memory double of the injected seams: holdings upsert on
 * (accountId, metadata[metadataField] === metadataKey) — the same key the real
 * `upsertExchange` matches on.
 */
const makeInMemoryDeps = (initialAccounts: AccountRow[]) => {
  const accountsStore: AccountRow[] = initialAccounts.map((account) => ({ ...account }));
  const holdingsStore: HoldingRow[] = [];
  let sequence = 0;

  const upsertHolding: BalanceSyncDeps['upsertHolding'] = async ({
    metadataField,
    metadataKey,
    metadata,
    ...rest
  }) => {
    const merged = {
      ...(metadata as Record<string, unknown> | null),
      [metadataField]: metadataKey,
    };
    const existing = holdingsStore.find(
      (holding) =>
        holding.accountId === rest.accountId &&
        (holding.metadata as Record<string, unknown>)[metadataField] === metadataKey,
    );

    if (existing) {
      existing.balanceMinorUnits = rest.balanceMinorUnits ?? 0;
      existing.metadata = merged;

      return;
    }

    sequence += 1;
    holdingsStore.push({
      id: `h-${sequence}`,
      icon: null,
      color: null,
      sortOrder: 0,
      closedAt: null,
      createdAt: 0,
      balanceMinorUnits: rest.balanceMinorUnits ?? 0,
      // The Monobank-only crash-safe statement-import marker; a crypto holding
      // never carries one (it imports no statements).
      syncedBalanceMinorUnits: null,
      ...rest,
      metadata: merged,
    });
  };

  const deps: Partial<BalanceSyncDeps> = {
    now: () => NOW,
    listAccounts: async () => accountsStore.map((account) => ({ ...account })),
    updateAccount: async (accountId, patch) => {
      const target = accountsStore.find((account) => account.id === accountId);

      if (target) {
        Object.assign(target, patch);
      }
    },
    listHoldingsByAccount: async (accountId) =>
      holdingsStore
        .filter((holding) => holding.accountId === accountId)
        .map((holding) => ({ ...holding })),
    upsertHolding,
  };

  return { deps, accountsStore, holdingsStore };
};

describe('runBalanceSync', () => {
  // runBalanceSync now drives the shared progress session (module-level singleton
  // state); reset it after each test so one test's progress never leaks.
  afterEach(() => {
    setSyncProgress({ completed: 0, total: 0, workCompleted: 0, workTotal: 0 });
    setSyncing(false);
  });

  it('marks the target account with the provider id and upserts one BTC crypto_asset holding stamped syncedAt', async () => {
    const { provider, calls } = makeProvider();
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps([cryptoAccount()]);
    deps.targetAccountId = 'acc-1';

    const result = await runBalanceSync(provider, { balances: [walletBalance(12_345_678)] }, deps);

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(accountsStore).toHaveLength(1);
    expect(accountsStore[0].institution).toBe('btc_wallet');
    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0]).toMatchObject({
      accountId: 'acc-1',
      name: 'BTC Wallet',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 12_345_678,
      metadata: { walletAddress: ADDRESS, syncedAt: NOW },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ accountId: 'acc-1', holdings: [] });
  });

  it('with no target id, syncs into the account already connected under the provider institution and hands it its holdings', async () => {
    const { provider, calls } = makeProvider();
    const { deps, holdingsStore } = makeInMemoryDeps([
      cryptoAccount({ id: 'acc-wallet', institution: 'btc_wallet' }),
      cryptoAccount({ id: 'acc-other', institution: null }),
    ]);

    await runBalanceSync(provider, { balances: [walletBalance(1)] }, deps);
    await runBalanceSync(provider, { balances: [walletBalance(2)] }, deps);

    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0].accountId).toBe('acc-wallet');
    expect(holdingsStore[0].balanceMinorUnits).toBe(2);
    // the second run saw the holding the first one created
    expect(calls[1].holdings.map((holding) => holding.id)).toEqual(['h-1']);
  });

  it('throws when neither a target id nor a connected account exists, calling the provider never', async () => {
    const { provider, calls } = makeProvider();
    const { deps, holdingsStore } = makeInMemoryDeps([cryptoAccount({ institution: null })]);

    await expect(runBalanceSync(provider, { balances: [walletBalance(1)] }, deps)).rejects.toThrow(
      'No Wallet connection found',
    );
    expect(calls).toHaveLength(0);
    expect(holdingsStore).toHaveLength(0);
  });

  // This error is surfaced verbatim to the user (`useSyncAction` renders
  // `error.message` directly), so — unlike the swallowed Monobank/disconnect
  // failures elsewhere — it genuinely needs to resolve in the active language.
  it('throws the connection-not-found message in Ukrainian once the active language switches', async () => {
    const { provider } = makeProvider();
    const { deps } = makeInMemoryDeps([cryptoAccount({ institution: null })]);

    await i18n.changeLanguage('uk');
    try {
      await expect(
        runBalanceSync(provider, { balances: [walletBalance(1)] }, deps),
      ).rejects.toThrow('Немає підключення Гаманець');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('throws when the target id matches no account', async () => {
    const { provider } = makeProvider();
    const { deps } = makeInMemoryDeps([cryptoAccount()]);
    deps.targetAccountId = 'acc-missing';

    await expect(runBalanceSync(provider, { balances: [walletBalance(1)] }, deps)).rejects.toThrow(
      'No Wallet connection found',
    );
  });

  it('connects a SECOND wallet account while another already holds a wallet (multi-connection)', async () => {
    const { provider, calls } = makeProvider();
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps([
      cryptoAccount({ id: 'acc-a', institution: 'btc_wallet' }),
      cryptoAccount({ id: 'acc-b', institution: null }),
    ]);
    deps.targetAccountId = 'acc-b';

    await runBalanceSync(provider, { balances: [walletBalance(7)] }, deps);

    // The second wallet resolves to its OWN account and writes its own holding —
    // the one-connection-per-institution gate is gone (Task 5.2).
    expect(accountsStore.find((account) => account.id === 'acc-b')?.institution).toBe('btc_wallet');
    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0].accountId).toBe('acc-b');
    expect(calls).toHaveLength(1);
    expect(calls[0].accountId).toBe('acc-b');
  });

  it('connects a SECOND Binance account while another already holds Binance (multi-connection)', async () => {
    const { provider, calls } = makeProvider('binance');
    const { deps, accountsStore } = makeInMemoryDeps([
      cryptoAccount({ id: 'acc-a', institution: 'binance' }),
      cryptoAccount({ id: 'acc-b', institution: null }),
    ]);
    deps.targetAccountId = 'acc-b';

    await runBalanceSync(provider, { balances: [walletBalance(1)] }, deps);

    expect(accountsStore.map((account) => account.institution)).toEqual(['binance', 'binance']);
    expect(calls[0].accountId).toBe('acc-b');
  });

  it('lets a wallet connection coexist with a Binance connection on another account', async () => {
    const { provider } = makeProvider();
    const { deps, accountsStore } = makeInMemoryDeps([
      cryptoAccount({ id: 'acc-binance', institution: 'binance' }),
      cryptoAccount({ id: 'acc-wallet', institution: null }),
    ]);
    deps.targetAccountId = 'acc-wallet';

    await runBalanceSync(provider, { balances: [walletBalance(1)] }, deps);

    expect(accountsStore.map((account) => account.institution)).toEqual(['binance', 'btc_wallet']);
  });

  it('allows re-connecting the SAME connected account (idempotent re-sync) and updates the holding in place', async () => {
    const { provider } = makeProvider();
    const { deps, holdingsStore } = makeInMemoryDeps([
      cryptoAccount({ id: 'acc-1', institution: 'btc_wallet' }),
    ]);
    deps.targetAccountId = 'acc-1';

    await runBalanceSync(provider, { balances: [walletBalance(10)] }, deps);
    await runBalanceSync(provider, { balances: [walletBalance(20)] }, deps);

    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0].balanceMinorUnits).toBe(20);
  });

  it('leaves the target account unmarked and writes nothing when the provider fetch fails', async () => {
    const { provider } = makeProvider();
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps([cryptoAccount()]);
    deps.targetAccountId = 'acc-1';

    await expect(
      runBalanceSync(provider, { balances: new Error('Block explorer request failed: 400') }, deps),
    ).rejects.toThrow('Block explorer request failed: 400');
    expect(accountsStore[0].institution).toBeNull();
    expect(holdingsStore).toHaveLength(0);
  });

  // The crypto sync feeds the same determinate progress bar as the Monobank run
  // (the shared session in `sync-status.ts`). Every returned holding does real
  // work — a crypto sync has no balance-diff skip, it always reads live balances —
  // so each holding is ONE work unit and completes as its upsert commits.
  describe('progress session', () => {
    // Distinct match keys so three Spot/Funding/Earn balances upsert as three
    // holdings, not one (the in-memory double keys on metadataKey).
    const btcBalance = (metadataKey: string, balanceMinorUnits: number): ProviderBalance => ({
      currency: 'BTC',
      balanceMinorUnits,
      metadataKey,
      name: metadataKey,
    });

    const zero = { completed: 0, total: 0, workCompleted: 0, workTotal: 0 };

    it('starts its one holding at zero work and rises to full as the balance commits', async () => {
      const { provider } = makeProvider();
      const { deps } = makeInMemoryDeps([
        cryptoAccount({ id: 'acc-1', institution: 'btc_wallet' }),
      ]);
      deps.targetAccountId = 'acc-1';

      const emissions: Array<{
        completed: number;
        total: number;
        workCompleted: number;
        workTotal: number;
      }> = [];
      const unsubscribe = subscribeProgress(() => emissions.push({ ...getProgressSnapshot() }));

      await runBalanceSync(provider, { balances: [walletBalance(1)] }, deps);
      unsubscribe();

      // One holding, one work unit, no pre-filled baseline: the fill starts at 0
      // and reaches full only as the balance commits.
      const nonZero = emissions.filter((sample) => sample.workTotal > 0);
      expect(nonZero[0]).toEqual({ completed: 0, total: 1, workCompleted: 0, workTotal: 1 });
      expect(nonZero.at(-1)).toEqual({ completed: 1, total: 1, workCompleted: 1, workTotal: 1 });
      expect(emissions.at(-1)).toEqual(zero);
    });

    it('weights three wallet holdings (Spot / Funding / Earn) as three equal work units', async () => {
      const { provider } = makeProvider();
      const { deps } = makeInMemoryDeps([cryptoAccount({ id: 'acc-1', institution: 'binance' })]);
      deps.targetAccountId = 'acc-1';

      const emissions: Array<{
        completed: number;
        total: number;
        workCompleted: number;
        workTotal: number;
      }> = [];
      const unsubscribe = subscribeProgress(() => emissions.push({ ...getProgressSnapshot() }));

      await runBalanceSync(
        provider,
        {
          balances: [btcBalance('BTC', 1), btcBalance('BTC:funding', 2), btcBalance('BTC:earn', 3)],
        },
        deps,
      );
      unsubscribe();

      const nonZero = emissions.filter((sample) => sample.workTotal > 0);
      // 3 holdings, 3 work units, no baseline.
      expect(nonZero.every((sample) => sample.workTotal === 3 && sample.total === 3)).toBe(true);
      expect(nonZero[0].workCompleted).toBe(0);
      expect(nonZero.at(-1)).toEqual({ completed: 3, total: 3, workCompleted: 3, workTotal: 3 });
      expect(emissions.at(-1)).toEqual(zero);
    });

    it('registers no work — so the bar never appears — when the provider returns no balance', async () => {
      const { provider } = makeProvider();
      const { deps } = makeInMemoryDeps([
        cryptoAccount({ id: 'acc-1', institution: 'btc_wallet' }),
      ]);
      deps.targetAccountId = 'acc-1';

      const emissions: Array<{ workTotal: number }> = [];
      const unsubscribe = subscribeProgress(() =>
        emissions.push({ workTotal: getProgressSnapshot().workTotal }),
      );

      await runBalanceSync(provider, { balances: [] }, deps);
      unsubscribe();

      // No balance means no work: the bar's total stays zero throughout (no-op guard).
      expect(emissions.every((sample) => sample.workTotal === 0)).toBe(true);
    });

    it('leaves the session clean (isSyncing off, progress cleared) when the provider fetch fails', async () => {
      const { provider } = makeProvider();
      const { deps } = makeInMemoryDeps([
        cryptoAccount({ id: 'acc-1', institution: 'btc_wallet' }),
      ]);
      deps.targetAccountId = 'acc-1';

      await expect(
        runBalanceSync(
          provider,
          { balances: new Error('Block explorer request failed: 400') },
          deps,
        ),
      ).rejects.toThrow('Block explorer request failed: 400');

      expect(isSyncingSnapshot()).toBe(false);
      expect(getProgressSnapshot()).toEqual(zero);
    });
  });

  // BUG1: auto-sync (`useAutoSync`) and pull-to-refresh (`useSyncAll`) can each
  // fan out over the SAME connected crypto account. Without a single-flight
  // join, each starts its own `runBalanceSync` — doubling the provider (Binance)
  // request weight and double-registering the account's holdings into the
  // shared, reference-counted progress session. Mirrors `inFlightSync` in
  // `src/monobank/sync.ts`, keyed per account.
  describe('single-flight join (BUG1)', () => {
    it('shares one balance sync across overlapping triggers for the same account (provider fetched once)', async () => {
      const { provider, calls } = makeProvider();
      const { deps, holdingsStore } = makeInMemoryDeps([
        cryptoAccount({ id: 'acc-1', institution: 'btc_wallet' }),
      ]);
      deps.targetAccountId = 'acc-1';

      // Fire two overlapping runs BEFORE the first settles: they must JOIN one
      // in-flight run, not each start their own.
      const [a, b] = await Promise.all([
        runBalanceSync(provider, { balances: [walletBalance(1)] }, deps),
        runBalanceSync(provider, { balances: [walletBalance(1)] }, deps),
      ]);

      expect(a).toEqual(b);
      // The provider fetched ONCE and the holding registered ONCE.
      expect(calls).toHaveLength(1);
      expect(holdingsStore).toHaveLength(1);
    });

    it('releases the lock after a successful run so a later, non-overlapping sync runs fresh', async () => {
      const { provider, calls } = makeProvider();
      const { deps } = makeInMemoryDeps([
        cryptoAccount({ id: 'acc-1', institution: 'btc_wallet' }),
      ]);
      deps.targetAccountId = 'acc-1';

      await runBalanceSync(provider, { balances: [walletBalance(1)] }, deps);
      await runBalanceSync(provider, { balances: [walletBalance(2)] }, deps);

      expect(calls).toHaveLength(2);
    });

    it('releases the lock after a FAILED run so a later sync still runs', async () => {
      const { provider, calls } = makeProvider();
      const { deps } = makeInMemoryDeps([
        cryptoAccount({ id: 'acc-1', institution: 'btc_wallet' }),
      ]);
      deps.targetAccountId = 'acc-1';

      await expect(
        runBalanceSync(
          provider,
          { balances: new Error('Block explorer request failed: 400') },
          deps,
        ),
      ).rejects.toThrow('Block explorer request failed: 400');
      await runBalanceSync(provider, { balances: [walletBalance(1)] }, deps);

      expect(calls).toHaveLength(2);
    });

    it('keys per account: a wallet and a Binance sync for different accounts run concurrently', async () => {
      const { provider: wallet, calls: walletCalls } = makeProvider('btc_wallet');
      const { provider: binance, calls: binanceCalls } = makeProvider('binance');
      const { deps } = makeInMemoryDeps([
        cryptoAccount({ id: 'acc-wallet', institution: 'btc_wallet' }),
        cryptoAccount({ id: 'acc-binance', institution: 'binance' }),
      ]);

      await Promise.all([
        runBalanceSync(
          wallet,
          { balances: [walletBalance(1)] },
          { ...deps, targetAccountId: 'acc-wallet' },
        ),
        runBalanceSync(
          binance,
          { balances: [walletBalance(2)] },
          { ...deps, targetAccountId: 'acc-binance' },
        ),
      ]);

      // Distinct keys → neither joined the other; both ran.
      expect(walletCalls).toHaveLength(1);
      expect(binanceCalls).toHaveLength(1);
    });
  });
});
