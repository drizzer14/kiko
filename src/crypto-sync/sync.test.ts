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
import { activeHoldings } from '../rates/active-holdings';

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
const makeProvider = () => {
  const calls: SyncTarget[] = [];
  const provider: BalanceProvider<FakeDeps> = {
    id: 'btc_wallet',
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
    // The count of holdings the user sees — the determinate progress bar's
    // denominator. A progress test overrides it to model manual holdings the
    // crypto sync itself never touches.
    countActiveHoldings: async () => activeHoldings(holdingsStore, accountsStore).length,
  };

  return { deps, accountsStore, holdingsStore };
};

describe('runBalanceSync', () => {
  // runBalanceSync now drives the shared progress session (module-level singleton
  // state); reset it after each test so one test's progress never leaks.
  afterEach(() => {
    setSyncProgress({ completed: 0, total: 0 });
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

  it('rejects connecting a second account while another holds the same institution, writing nothing', async () => {
    const { provider, calls } = makeProvider();
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps([
      cryptoAccount({ id: 'acc-a', institution: 'btc_wallet' }),
      cryptoAccount({ id: 'acc-b', institution: null }),
    ]);
    deps.targetAccountId = 'acc-b';

    await expect(runBalanceSync(provider, { balances: [walletBalance(1)] }, deps)).rejects.toThrow(
      'Wallet is already connected to another account',
    );
    expect(accountsStore.find((account) => account.id === 'acc-b')?.institution).toBeNull();
    expect(holdingsStore).toHaveLength(0);
    expect(calls).toHaveLength(0);
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
  // (the shared session in `sync-status.ts`). Every returned holding is syncable:
  // a crypto sync has no balance-diff skip — it always reads live balances — so
  // each holding counts and completes as its upsert commits.
  describe('progress session', () => {
    // Distinct match keys so three Spot/Funding/Earn balances upsert as three
    // holdings, not one (the in-memory double keys on metadataKey).
    const btcBalance = (metadataKey: string, balanceMinorUnits: number): ProviderBalance => ({
      currency: 'BTC',
      balanceMinorUnits,
      metadataKey,
      name: metadataKey,
    });

    it('publishes the non-syncing baseline then rises to full as its one holding commits', async () => {
      const { provider } = makeProvider();
      const { deps } = makeInMemoryDeps([
        cryptoAccount({ id: 'acc-1', institution: 'btc_wallet' }),
      ]);
      deps.targetAccountId = 'acc-1';
      // The user sees 3 holdings; this crypto holding is the only syncable one.
      deps.countActiveHoldings = async () => 3;

      const emissions: Array<{ completed: number; total: number }> = [];
      const unsubscribe = subscribeProgress(() => emissions.push({ ...getProgressSnapshot() }));

      await runBalanceSync(provider, { balances: [walletBalance(1)] }, deps);
      unsubscribe();

      expect(emissions).toEqual([
        { completed: 2, total: 3 }, // baseline 3 - 1 syncable
        { completed: 3, total: 3 }, // the crypto holding commits
        { completed: 0, total: 0 }, // session cleared on end
      ]);
    });

    it('counts every returned wallet holding as syncable (Spot / Funding / Earn)', async () => {
      const { provider } = makeProvider();
      const { deps } = makeInMemoryDeps([cryptoAccount({ id: 'acc-1', institution: 'binance' })]);
      deps.targetAccountId = 'acc-1';
      // 5 holdings the user sees; 3 of them are this connection's syncable set.
      deps.countActiveHoldings = async () => 5;

      const emissions: Array<{ completed: number; total: number }> = [];
      const unsubscribe = subscribeProgress(() => emissions.push({ ...getProgressSnapshot() }));

      await runBalanceSync(
        provider,
        {
          balances: [btcBalance('BTC', 1), btcBalance('BTC:funding', 2), btcBalance('BTC:earn', 3)],
        },
        deps,
      );
      unsubscribe();

      expect(emissions).toEqual([
        { completed: 2, total: 5 }, // baseline 5 - 3 syncable
        { completed: 3, total: 5 },
        { completed: 4, total: 5 },
        { completed: 5, total: 5 },
        { completed: 0, total: 0 },
      ]);
    });

    it('never renders a negative label on a first connect (whole-app count read before the new holdings exist)', async () => {
      const { provider } = makeProvider();
      const { deps } = makeInMemoryDeps([cryptoAccount({ id: 'acc-1', institution: 'binance' })]);
      deps.targetAccountId = 'acc-1';
      // A first connect: countActiveHoldings is read BEFORE the 3 new holdings
      // are upserted, so it under-counts — here it returns 0 while the sync
      // creates 3 syncable holdings.
      deps.countActiveHoldings = async () => 0;

      const emissions: Array<{ completed: number; total: number }> = [];
      const unsubscribe = subscribeProgress(() => emissions.push({ ...getProgressSnapshot() }));

      await runBalanceSync(
        provider,
        {
          balances: [btcBalance('BTC', 1), btcBalance('BTC:funding', 2), btcBalance('BTC:earn', 3)],
        },
        deps,
      );
      unsubscribe();

      // Every emission stays in [0, total]: the denominator floors at the 3
      // syncable holdings and completed never goes negative.
      expect(emissions.every((e) => e.completed >= 0 && e.completed <= e.total)).toBe(true);
      expect(emissions).toEqual([
        { completed: 0, total: 3 },
        { completed: 1, total: 3 },
        { completed: 2, total: 3 },
        { completed: 3, total: 3 },
        { completed: 0, total: 0 },
      ]);
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
      expect(getProgressSnapshot()).toEqual({ completed: 0, total: 0 });
    });
  });
});
