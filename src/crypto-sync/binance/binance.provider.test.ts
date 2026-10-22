import { i18n } from '@kiko/i18n/init';
import type { HoldingRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';

import type { SyncTarget } from '../provider';

import {
  type BinanceAccount,
  BinanceRateLimitError,
  fetchAccount,
  fetchFlexiblePosition,
  fetchFundingAsset,
  fetchLockedPosition,
} from './binance.client';
import {
  type BinanceDeps,
  binanceProvider as binanceRead,
  defaultBinanceDeps,
} from './binance.provider';
import { readCredentials } from './binance.credentials';
import { setBinanceCooldownUntil } from './binance.cooldown';
import { type BinanceWallet, holdingKeyOf } from './binance.holding-keys';

// The credentials module imports react-native-keychain, whose native binding is
// absent under Jest; `readCredentials` is injected, so the stub only needs the
// ACCESSIBLE enum its module-scope hardened-options constant reads at load.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

// This file pins the holdings a read writes; the balance lists the same read returns are pinned
// in `binance.provider.coin-lists.test.ts`.
const binanceProvider = {
  ...binanceRead,
  fetchBalances: async (...args: Parameters<typeof binanceRead.fetchBalances>) =>
    (await binanceRead.fetchBalances(...args)).balances,
};

const NOW = 1_704_326_400_000;
const emptyTarget: SyncTarget = { accountId: 'acc-1', holdings: [] };
const credentials = { apiKey: 'api-key-fixture', secret: 'secret-fixture' };

type ProviderMocks = BinanceDeps & {
  fetchAccount: jest.Mock;
  fetchFundingAsset: jest.Mock;
  fetchFlexiblePosition: jest.Mock;
  fetchLockedPosition: jest.Mock;
  readCredentials: jest.Mock;
};

// The three non-Spot wallets default to EMPTY, so a test that exercises one
// overrides just that mock. A funding/earn wallet that reads empty produces no
// holding unless it already exists on the target (see the zero-balance tests).
const makeDeps = (balances: { asset: string; free: string; locked: string }[]): ProviderMocks => ({
  fetchImpl: (async () => ({ ok: true })) as unknown as typeof fetch,
  now: () => NOW,
  readCredentials: jest.fn(async () => credentials),
  fetchAccount: jest.fn(async () => ({ balances, uid: null })),
  fetchFundingAsset: jest.fn(async () => []),
  fetchFlexiblePosition: jest.fn(async () => ({ rows: [], total: 0 })),
  fetchLockedPosition: jest.fn(async () => ({ rows: [], total: 0 })),
});

// A minimal synced Binance holding for a given match key, to model a target that
// already carries one of the split holdings (the transition and zero-balance
// paths). Only the fields the provider reads (`metadata.binanceAsset`) matter.
const binanceHolding = (
  binanceAsset: string,
  balanceMinorUnits = 1,
  currency: Currency = 'BTC',
): HoldingRow => ({
  id: `h-${binanceAsset}`,
  accountId: 'acc-1',
  name: binanceAsset,
  type: 'crypto_asset',
  currency,
  icon: null,
  color: null,
  balanceMinorUnits,
  syncedBalanceMinorUnits: null,
  balanceSetAt: null,
  balanceSetRowId: null,
  metadata: { binanceAsset, syncedAt: 0 },
  sortOrder: 0,
  closedAt: null,
  createdAt: 0,
});

const byKey = (balances: Awaited<ReturnType<typeof binanceProvider.fetchBalances>>, key: string) =>
  balances.find((balance) => balance.metadataKey === key);

describe('binanceProvider', () => {
  it('is the binance exchange provider keyed on binanceAsset', () => {
    expect(binanceProvider.id).toBe('binance');
    expect(binanceProvider.metadataField).toBe('binanceAsset');
  });

  it('wires the real client, credentials reader, clock and fetch as its default deps', () => {
    expect(defaultBinanceDeps.fetchAccount).toBe(fetchAccount);
    expect(defaultBinanceDeps.fetchFundingAsset).toBe(fetchFundingAsset);
    expect(defaultBinanceDeps.fetchFlexiblePosition).toBe(fetchFlexiblePosition);
    expect(defaultBinanceDeps.fetchLockedPosition).toBe(fetchLockedPosition);
    expect(defaultBinanceDeps.readCredentials).toBe(readCredentials);
    expect(defaultBinanceDeps.fetchImpl).toBe(fetch);
    expect(typeof defaultBinanceDeps.now()).toBe('number');
  });

  it('throws before any network call when no credentials are stored', async () => {
    const deps = makeDeps([]);
    deps.readCredentials.mockResolvedValue(undefined);

    await expect(binanceProvider.fetchBalances(deps, emptyTarget)).rejects.toThrow(
      /connect Binance/i,
    );
    expect(deps.fetchAccount).not.toHaveBeenCalled();
  });

  it('reads the stored credentials and calls fetchAccount with the injected fetch and clock', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1.00000000', locked: '0.00000000' }]);

    await binanceProvider.fetchBalances(deps, emptyTarget);

    // The credentials are read PER ACCOUNT — the target's account id is threaded
    // in, so a read for one Binance connection can never return another's pair.
    expect(deps.readCredentials).toHaveBeenCalledTimes(1);
    expect(deps.readCredentials).toHaveBeenCalledWith(emptyTarget.accountId);
    expect(deps.fetchAccount).toHaveBeenCalledWith('api-key-fixture', 'secret-fixture', {
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
  });

  it('signs every wallet call with the stored credentials, injected fetch and clock', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);

    await binanceProvider.fetchBalances(deps, emptyTarget);

    const expected = [
      'api-key-fixture',
      'secret-fixture',
      { fetchImpl: deps.fetchImpl, now: deps.now },
    ];
    expect(deps.fetchAccount).toHaveBeenCalledWith(...expected);
    expect(deps.fetchFundingAsset).toHaveBeenCalledWith(...expected);
    expect(deps.fetchFlexiblePosition).toHaveBeenCalledWith(...expected);
    expect(deps.fetchLockedPosition).toHaveBeenCalledWith(...expected);
  });
});

describe('binanceProvider — Spot holding', () => {
  it('writes a Spot holding of free + locked BTC, keyed on the legacy "BTC" key', async () => {
    const deps = makeDeps([
      { asset: 'ETH', free: '2.00000000', locked: '0.00000000' },
      { asset: 'BTC', free: '0.50000000', locked: '0.25000000' },
      { asset: 'USDT', free: '100.00000000', locked: '0.00000000' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    // Spot reuses the legacy 'BTC' key so the pre-split aggregated holding is
    // updated IN PLACE into the Spot holding (see the transition test).
    expect(byKey(balances, 'BTC')).toEqual({
      currency: 'BTC',
      balanceMinorUnits: 75_000_000, // 0.5 + 0.25 BTC
      metadataKey: 'BTC',
      name: 'Binance Spot · BTC',
      // The transition marker: relabel a still-default legacy holding to Spot.
      renameFromDefaults: ['Binance BTC', 'Binance Spot'],
    });
  });

  it('converts each Spot decimal string separately so float addition never drifts', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.1', locked: '0.2' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(30_000_000);
  });

  it.each([
    ['carries no BTC entry', [{ asset: 'ETH', free: '2', locked: '0' }]],
    ['carries no asset at all', []],
    ['carries a zero BTC entry', [{ asset: 'BTC', free: '0', locked: '0' }]],
    ['carries BTC below its dust threshold', [{ asset: 'BTC', free: '0.00000999', locked: '0' }]],
  ])('a new connection gets no Spot BTC holding when the payload %s', async (_, balances) => {
    const written = await binanceProvider.fetchBalances(makeDeps(balances), emptyTarget);

    expect(written.filter(({ metadataKey }) => metadataKey === 'BTC')).toEqual([]);
  });

  const storedSpotBtc: SyncTarget = { accountId: 'acc-1', holdings: [binanceHolding('BTC', 700)] };
  const readSpotBtc = [{ asset: 'BTC', free: '0.5', locked: '0' }];

  it.each([
    ['one stored and no BTC entry read', storedSpotBtc, [], 1],
    ['one stored and a BTC entry read', storedSpotBtc, readSpotBtc, 1],
    ['none stored and a BTC entry read', emptyTarget, readSpotBtc, 1],
    ['none stored and no BTC entry read', emptyTarget, [], 0],
  ])(
    'writes the Spot BTC holding once on every good sync that reads or holds it: %s',
    async (_, target, read, count) => {
      const written = await binanceProvider.fetchBalances(makeDeps(read), target);

      expect(written.filter(({ metadataKey }) => metadataKey === 'BTC')).toHaveLength(count);
    },
  );

  it('keeps the other Spot coins to the dust and absent rules', async () => {
    const deps = makeDeps([
      { asset: 'DOGE', free: '11.9999', locked: '0' },
      { asset: 'ETH', free: '1', locked: '0' },
    ]);

    const written = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(keysOf(written)).toEqual(['ETH']);
  });

  it('writes a zero Spot holding when the payload carries no BTC entry and the holding exists', async () => {
    const deps = makeDeps([{ asset: 'ETH', free: '2.00000000', locked: '0.00000000' }]);
    const target: SyncTarget = { accountId: 'acc-1', holdings: [binanceHolding('BTC', 500)] };

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(byKey(balances, 'BTC')).toMatchObject({ balanceMinorUnits: 0, metadataKey: 'BTC' });
  });

  it('fails the whole sync when the Spot wallet call fails', async () => {
    const deps = makeDeps([]);
    deps.fetchAccount.mockRejectedValue(new Error('Binance request failed: 401'));

    await expect(binanceProvider.fetchBalances(deps, emptyTarget)).rejects.toThrow(
      /Binance request failed/,
    );
  });

  it('fails the whole sync on a malformed Spot body rather than fabricating a zero', async () => {
    const deps = makeDeps([]);
    deps.fetchAccount.mockResolvedValue({} as BinanceAccount);

    await expect(binanceProvider.fetchBalances(deps, emptyTarget)).rejects.toThrow(/Binance/);
  });

  it('writes no Spot BTC balance, never NaN, for an amount that is no number', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = makeDeps([{ asset: 'BTC', free: 'x', locked: '0' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')).toBeUndefined();
    warn.mockRestore();
  });

  it('keeps an existing Spot BTC holding at its last balance when its amount is refused', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = makeDeps([{ asset: 'BTC', free: 'x', locked: '0' }]);
    const target: SyncTarget = { accountId: 'acc-1', holdings: [binanceHolding('BTC', 500)] };

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(byKey(balances, 'BTC')).toBeUndefined();
    warn.mockRestore();
  });

  it('surfaces a Spot 429/418 as the localized binanceRequestFailed message, not the raw rate-limit text', async () => {
    // A distinct account id: this 429 sets the SHARED cooldown, which
    // must not leak into a later test that reuses `emptyTarget`'s account id.
    const target: SyncTarget = { accountId: 'acc-spot-429', holdings: [] };
    const deps = makeDeps([]);
    deps.fetchAccount.mockRejectedValue(new BinanceRateLimitError(429, 5_000));

    await expect(binanceProvider.fetchBalances(deps, target)).rejects.toThrow(
      i18n.t('accountDetail.binanceRequestFailed', { status: 429, detail: '' }),
    );
  });
});

describe('binanceProvider — shared 429/418 cooldown', () => {
  it('makes ZERO Binance requests while the account is still cooling down from an earlier 429/418', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.5', locked: '0' }]);
    const target: SyncTarget = { accountId: 'acc-cooldown-provider', holdings: [] };
    setBinanceCooldownUntil(target.accountId, NOW + 60_000);

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(balances).toEqual([]);
    expect(deps.readCredentials).not.toHaveBeenCalled();
    expect(deps.fetchAccount).not.toHaveBeenCalled();
    expect(deps.fetchFundingAsset).not.toHaveBeenCalled();
    expect(deps.fetchFlexiblePosition).not.toHaveBeenCalled();
    expect(deps.fetchLockedPosition).not.toHaveBeenCalled();
  });

  it('returns no texts when the account is cooling down', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.5', locked: '0' }]);
    const target: SyncTarget = { accountId: 'acc-cooldown-provider-texts', holdings: [] };
    setBinanceCooldownUntil(target.accountId, NOW + 60_000);

    const read = await binanceRead.fetchBalances(deps, target);

    expect(read.spotBalanceTexts).toBeUndefined();
  });

  it('makes requests again once the cooldown instant has passed', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.5', locked: '0' }]);
    const target: SyncTarget = { accountId: 'acc-cooldown-provider-2', holdings: [] };
    setBinanceCooldownUntil(target.accountId, NOW);

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(byKey(balances, 'BTC')).toMatchObject({ balanceMinorUnits: 50_000_000 });
    expect(deps.fetchAccount).toHaveBeenCalledTimes(1);
  });
});

describe('binanceProvider — Funding holding', () => {
  it('writes a Funding holding of free + locked + freeze + withdrawing BTC under its own key', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.5', locked: '0.25' }]); // Spot 0.75
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'BTC', free: '0.1', locked: '0.2', freeze: '0.05', withdrawing: '0.05' }, // 0.4
      { asset: 'ETH', free: '9', locked: '9', freeze: '9', withdrawing: '9' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    // Spot and Funding are DISTINCT holdings — not summed together.
    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(75_000_000);
    expect(byKey(balances, 'BTC:funding')).toEqual({
      currency: 'BTC',
      balanceMinorUnits: 40_000_000, // 0.4 BTC
      metadataKey: 'BTC:funding',
      name: 'Binance Funding · BTC',
      renameFromDefaults: ['Binance Funding'],
    });
  });

  it('skips ONLY the Funding holding on error; Spot and Earn still write', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]); // Spot 1
    deps.fetchFundingAsset.mockRejectedValue(new Error('Binance request failed: 401 SECRET'));
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset: 'BTC', totalAmount: '0.1' }],
      total: 1,
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    let balances: Awaited<ReturnType<typeof binanceProvider.fetchBalances>>;
    let loggedCalls: string;
    try {
      balances = await binanceProvider.fetchBalances(deps, emptyTarget);
      expect(warn).toHaveBeenCalledWith('[binance sync] skipped the funding wallet', {
        name: 'Error',
        code: undefined,
      });
      loggedCalls = JSON.stringify(warn.mock.calls);
    } finally {
      warn.mockRestore();
    }

    expect(loggedCalls).not.toContain('SECRET');
    // No Funding holding is written — its existing balance (if any) is left
    // untouched rather than clobbered with a fabricated zero.
    expect(byKey(balances, 'BTC:funding')).toBeUndefined();
    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(100_000_000);
    expect(byKey(balances, 'BTC:earn')?.balanceMinorUnits).toBe(10_000_000);
  });

  it('skips a Funding coin whose BTC amount is non-numeric rather than writing NaN', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'BTC', free: 'x', locked: '0', freeze: '0', withdrawing: '0' },
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    let balances: Awaited<ReturnType<typeof binanceProvider.fetchBalances>>;
    try {
      balances = await binanceProvider.fetchBalances(deps, emptyTarget);
    } finally {
      warn.mockRestore();
    }

    expect(byKey(balances, 'BTC:funding')).toBeUndefined();
    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(100_000_000);
  });

  it('does NOT create an empty Funding holding for a never-used funding wallet', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
    // fetchFundingAsset defaults to [] → zero BTC, and the target has no funding
    // holding yet, so no empty holding should be created.
    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC:funding')).toBeUndefined();
  });

  it('writes a zero Funding holding when funding empties but a funding holding already exists', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
    // Funding reads empty (default []), but a funding holding already exists —
    // it must be zeroed, not left stale at its previous balance.
    const target: SyncTarget = {
      accountId: 'acc-1',
      holdings: [binanceHolding('BTC:funding', 500)],
    };

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(byKey(balances, 'BTC:funding')).toEqual({
      currency: 'BTC',
      balanceMinorUnits: 0,
      metadataKey: 'BTC:funding',
      name: 'Binance Funding · BTC',
      renameFromDefaults: ['Binance Funding'],
    });
  });
});

describe('binanceProvider — Earn holding (Flexible + Locked combined)', () => {
  it('combines Flexible totalAmount and Locked amount into ONE Earn holding', async () => {
    const deps = makeDeps([]); // no Spot BTC
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [
        { asset: 'BTC', totalAmount: '0.3' },
        { asset: 'ETH', totalAmount: '5' },
      ],
      total: 2,
    });
    deps.fetchLockedPosition.mockResolvedValue({
      rows: [
        { asset: 'BTC', amount: '0.2' },
        { asset: 'USDT', amount: '100' },
      ],
      total: 2,
    });

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC:earn')).toEqual({
      currency: 'BTC',
      balanceMinorUnits: 50_000_000, // 0.3 + 0.2 BTC, one holding
      metadataKey: 'BTC:earn',
      name: 'Binance Earn · BTC',
      renameFromDefaults: ['Binance Earn'],
    });
    // No separate flexible/locked holdings exist.
    expect(byKey(balances, 'BTC:flexible')).toBeUndefined();
    expect(byKey(balances, 'BTC:locked')).toBeUndefined();
  });

  it('sums MULTIPLE BTC position rows across Flexible and Locked into the Earn holding', async () => {
    const deps = makeDeps([]);
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [
        { asset: 'BTC', totalAmount: '0.3' },
        { asset: 'BTC', totalAmount: '0.2' },
      ],
      total: 2,
    });
    deps.fetchLockedPosition.mockResolvedValue({
      rows: [
        { asset: 'BTC', amount: '0.1' },
        { asset: 'BTC', amount: '0.05' },
      ],
      total: 2,
    });

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC:earn')?.balanceMinorUnits).toBe(65_000_000); // 0.65 BTC
  });

  // Combining two reads into one holding means a failure in EITHER read must
  // drop the WHOLE Earn holding — importing locked-only (or flexible-only) would
  // silently UNDER-COUNT the user's Earn balance.
  it('skips the WHOLE Earn holding when the Flexible read fails', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
    deps.fetchFlexiblePosition.mockRejectedValue(new Error('boom'));
    deps.fetchLockedPosition.mockResolvedValue({
      rows: [{ asset: 'BTC', amount: '0.5' }],
      total: 1,
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    let balances: Awaited<ReturnType<typeof binanceProvider.fetchBalances>>;
    try {
      balances = await binanceProvider.fetchBalances(deps, emptyTarget);
      expect(warn).toHaveBeenCalledWith('[binance sync] skipped the earn wallet', {
        name: 'Error',
        code: undefined,
      });
    } finally {
      warn.mockRestore();
    }

    expect(byKey(balances, 'BTC:earn')).toBeUndefined();
    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(100_000_000); // Spot still writes
  });

  it('skips the WHOLE Earn holding when the Locked read fails', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset: 'BTC', totalAmount: '0.5' }],
      total: 1,
    });
    deps.fetchLockedPosition.mockRejectedValue(new Error('boom'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    let balances: Awaited<ReturnType<typeof binanceProvider.fetchBalances>>;
    try {
      balances = await binanceProvider.fetchBalances(deps, emptyTarget);
      expect(warn).toHaveBeenCalledWith('[binance sync] skipped the earn wallet', {
        name: 'Error',
        code: undefined,
      });
    } finally {
      warn.mockRestore();
    }

    expect(byKey(balances, 'BTC:earn')).toBeUndefined();
    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(100_000_000);
  });

  it('writes a zero Earn holding when Earn empties but an Earn holding already exists', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
    const target: SyncTarget = { accountId: 'acc-1', holdings: [binanceHolding('BTC:earn', 900)] };

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(byKey(balances, 'BTC:earn')).toMatchObject({
      balanceMinorUnits: 0,
      metadataKey: 'BTC:earn',
    });
  });
});

describe('binanceProvider — data transition from the single aggregated holding', () => {
  // Before the split there was ONE holding keyed on the legacy 'BTC' key holding
  // the summed Spot+Funding+Earn balance. On the first post-split sync the Spot
  // holding reuses that same 'BTC' key, so the upsert (matched on
  // metadata.binanceAsset) UPDATES the existing row IN PLACE — no orphan, no
  // duplicate — while Funding and Earn are created under their own new keys.
  it('re-keys the old aggregated holding as Spot (by its legacy key) and adds Funding and Earn', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.5', locked: '0.25' }]); // Spot 0.75
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'BTC', free: '0.4', locked: '0', freeze: '0', withdrawing: '0' },
    ]);
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset: 'BTC', totalAmount: '0.3' }],
      total: 1,
    });
    // The pre-split aggregated holding (Spot+Funding+Earn summed) under 'BTC'.
    const target: SyncTarget = {
      accountId: 'acc-1',
      holdings: [binanceHolding('BTC', 145_000_000)],
    };

    const balances = await binanceProvider.fetchBalances(deps, target);

    // Spot keeps the legacy 'BTC' key → updates the existing holding in place.
    expect(byKey(balances, 'BTC')?.metadataKey).toBe('BTC');
    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(75_000_000);
    // Funding and Earn land under new keys → created new, no duplicate 'BTC' row.
    expect(byKey(balances, 'BTC:funding')?.balanceMinorUnits).toBe(40_000_000);
    expect(byKey(balances, 'BTC:earn')?.balanceMinorUnits).toBe(30_000_000);
    expect(balances.filter((balance) => balance.metadataKey === 'BTC')).toHaveLength(1);
  });

  // The BTC holdings of the earlier releases kept their old default names; each balance
  // carries them as `renameFromDefaults`, so the upsert renames a still-default holding to
  // "Binance <Wallet> · BTC" while leaving a user-edited name untouched.
  it.each<[BinanceWallet, string, string[]]>([
    ['spot', 'Binance Spot · BTC', ['Binance BTC', 'Binance Spot']],
    ['funding', 'Binance Funding · BTC', ['Binance Funding']],
    ['earn', 'Binance Earn · BTC', ['Binance Earn']],
  ])('names the %s BTC balance "%s" and renames it from %j', async (wallet, name, defaults) => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'BTC', free: '1', locked: '0', freeze: '0', withdrawing: '0' },
    ]);
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset: 'BTC', totalAmount: '1' }],
      total: 1,
    });

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, holdingKeyOf('BTC', wallet))).toMatchObject({
      name,
      renameFromDefaults: defaults,
    });
  });

  it('never marks a coin other than BTC for a rename', async () => {
    const deps = makeDeps([{ asset: 'USDT', free: '5', locked: '0' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'USDT')?.renameFromDefaults).toBeUndefined();
  });
});

// Binance's own JSON can carry a number where its docs say a string; the cast is the off-contract
// payload, not a type the client declares.
const jsonNumber = (value: number): string => value as unknown as string;

describe('binanceProvider — balance amounts through exchangeMinorUnits', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('reads an eight-decimal balance exactly', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.00012345', locked: '0' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(12_345);
  });

  it('keeps the Funding holding at its last good balance on an exponent-form amount', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'BTC', free: '1e-8', locked: '0', freeze: '0', withdrawing: '0' },
    ]);
    const target: SyncTarget = { accountId: 'acc-1', holdings: [binanceHolding('BTC:funding')] };

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(byKey(balances, 'BTC:funding')).toBeUndefined();
    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(100_000_000);
  });

  it.each([
    [
      'Flexible',
      { rows: [{ asset: 'BTC', totalAmount: '1e-8' }], total: 1 },
      { rows: [], total: 0 },
    ],
    ['Locked', { rows: [], total: 0 }, { rows: [{ asset: 'BTC', amount: '1e-8' }], total: 1 }],
  ])(
    'keeps the Earn holding at its last good balance on an exponent-form %s amount',
    async (_, flexible, locked) => {
      const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
      deps.fetchFlexiblePosition.mockResolvedValue(flexible);
      deps.fetchLockedPosition.mockResolvedValue(locked);
      const target: SyncTarget = { accountId: 'acc-1', holdings: [binanceHolding('BTC:earn')] };

      const balances = await binanceProvider.fetchBalances(deps, target);

      expect(byKey(balances, 'BTC:earn')).toBeUndefined();
      expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(100_000_000);
    },
  );

  it('writes the other coins only when a Spot amount is in exponent form', async () => {
    const deps = makeDeps([
      { asset: 'BTC', free: '1e-8', locked: '0' },
      { asset: 'ETH', free: '1', locked: '0' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(keysOf(balances)).toEqual(['ETH']);
  });

  it('reads a JSON number through its exact decimal text in every wallet', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: jsonNumber(0.5), locked: '0' }]);
    deps.fetchFundingAsset.mockResolvedValue([
      {
        asset: 'BTC',
        free: jsonNumber(0.25),
        locked: '0',
        freeze: jsonNumber(1e-7),
        withdrawing: '0',
      },
    ]);
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset: 'BTC', totalAmount: jsonNumber(0.125) }],
      total: 1,
    });

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(50_000_000);
    expect(byKey(balances, 'BTC:funding')?.balanceMinorUnits).toBe(25_000_010);
    expect(byKey(balances, 'BTC:earn')?.balanceMinorUnits).toBe(12_500_000);
  });

  it('rounds a balance with more decimals than the scale half away from zero', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.000000015', locked: '0' }]);
    const target: SyncTarget = { accountId: 'acc-1', holdings: [binanceHolding('BTC')] };

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(2);
    expect(warn).toHaveBeenCalledWith('balance-precision-rounded', {
      name: 'Error',
      code: undefined,
    });
  });

  it('skips a Spot balance beyond the safe integer rather than truncating it', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '90071992.54740992', locked: '0' }]);

    const { balances, exchangeState } = await binanceRead.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')).toBeUndefined();
    expect(exchangeState).toEqual(
      expect.arrayContaining([
        {
          kind: 'oversizedBalance',
          wallets: { spot: ['BTC'], funding: [], earn: [] },
          complete: true,
        },
      ]),
    );
  });

  it('skips a Spot coin when two safe amounts add beyond the safe integer', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '90071992.54740991', locked: '0.00000001' }]);

    const { balances, exchangeState } = await binanceRead.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')).toBeUndefined();
    expect(exchangeState).toEqual(
      expect.arrayContaining([
        {
          kind: 'oversizedBalance',
          wallets: { spot: ['BTC'], funding: [], earn: [] },
          complete: true,
        },
      ]),
    );
  });

  it('keeps an existing Spot BTC holding when its amount is beyond the safe integer', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '90071992.54740992', locked: '0' }]);
    const target: SyncTarget = { accountId: 'acc-1', holdings: [binanceHolding('BTC', 500)] };

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(byKey(balances, 'BTC')).toBeUndefined();
  });

  it('never fails on a malformed balance of a coin it does not track', async () => {
    const deps = makeDeps([
      { asset: 'PEPE', free: 'x', locked: '1e-8' },
      { asset: 'LDBTC', free: 'x', locked: '0' },
      { asset: 'BTC', free: '1', locked: '0' },
    ]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'PEPE', free: 'x', locked: '0', freeze: '0', withdrawing: '0' },
    ]);
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset: 'PEPE', totalAmount: '1e-8' }],
      total: 1,
    });
    deps.fetchLockedPosition.mockResolvedValue({
      rows: [{ asset: 'LDBTC', amount: 'x' }],
      total: 1,
    });

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(100_000_000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads past a row that is no object in every wallet body', async () => {
    const deps = makeDeps([]);
    deps.fetchAccount.mockResolvedValue({
      balances: [null, { asset: 'BTC', free: '1', locked: '0' }],
      uid: null,
    });
    deps.fetchFundingAsset.mockResolvedValue([
      null,
      { asset: 'BTC', free: '1', locked: '0', freeze: '0', withdrawing: '0' },
    ]);
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [null, { asset: 'BTC', totalAmount: '1' }],
      total: 2,
    });

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(100_000_000);
    expect(byKey(balances, 'BTC:funding')?.balanceMinorUnits).toBe(100_000_000);
    expect(byKey(balances, 'BTC:earn')?.balanceMinorUnits).toBe(100_000_000);
    expect(warn).not.toHaveBeenCalledWith(
      '[binance sync] skipped the funding wallet',
      expect.anything(),
    );
    expect(warn).not.toHaveBeenCalledWith(
      '[binance sync] skipped the earn wallet',
      expect.anything(),
    );
  });

  it('lists no coin for a Spot row whose asset is no text', async () => {
    const deps = makeDeps([]);
    deps.fetchAccount.mockResolvedValue({
      balances: [
        { free: '1', locked: '0' },
        { asset: 5, free: '1', locked: '0' },
        { asset: 'BTC', free: '1', locked: '0' },
      ],
      uid: null,
    });

    const { balances, exchangeState } = await binanceRead.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(100_000_000);
    expect(exchangeState).toContainEqual({
      kind: 'coinList',
      coins: 'untrackedCoins',
      list: 'balance',
      tickers: [],
    });
  });
});

describe('binanceProvider — every asset, keyed per coin', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('writes a Spot USDT holding in USDT under its own key', async () => {
    const deps = makeDeps([{ asset: 'USDT', free: '10', locked: '0' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'USDT')).toEqual({
      currency: 'USDT',
      balanceMinorUnits: 1_000_000_000,
      metadataKey: 'USDT',
      name: 'Binance Spot · USDT',
    });
  });

  it('writes a Funding EUR holding at the fiat scale', async () => {
    const deps = makeDeps([]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'EUR', free: '5.00', locked: '0', freeze: '0', withdrawing: '0' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'EUR:funding')).toEqual({
      currency: 'EUR',
      balanceMinorUnits: 500,
      metadataKey: 'EUR:funding',
      name: 'Binance Funding · EUR',
    });
  });

  it('writes an Earn holding per coin, Flexible and Locked summed within each coin', async () => {
    const deps = makeDeps([]);
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [
        { asset: 'USDT', totalAmount: '3' },
        { asset: 'ETH', totalAmount: '0.5' },
        { asset: 'USDT', totalAmount: '1' },
      ],
      total: 3,
    });
    deps.fetchLockedPosition.mockResolvedValue({
      rows: [{ asset: 'USDT', amount: '2' }],
      total: 1,
    });

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'USDT:earn')).toEqual({
      currency: 'USDT',
      balanceMinorUnits: 600_000_000,
      metadataKey: 'USDT:earn',
      name: 'Binance Earn · USDT',
    });
    expect(byKey(balances, 'ETH:earn')).toMatchObject({
      currency: 'ETH',
      balanceMinorUnits: 50_000_000,
    });
  });

  it('sums each coin on its own, never one coin into another', async () => {
    const deps = makeDeps([
      { asset: 'ETH', free: '0.1', locked: '0.2' },
      { asset: 'BTC', free: '1', locked: '0.5' },
    ]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'USDT', free: '1', locked: '2', freeze: '3', withdrawing: '4' },
      { asset: 'BTC', free: '0.1', locked: '0', freeze: '0', withdrawing: '0' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(150_000_000);
    expect(byKey(balances, 'ETH')?.balanceMinorUnits).toBe(30_000_000);
    expect(byKey(balances, 'USDT:funding')?.balanceMinorUnits).toBe(1_000_000_000);
    expect(byKey(balances, 'BTC:funding')?.balanceMinorUnits).toBe(10_000_000);
  });

  it('reads an Earn BTC position and no Spot holding for the LDBTC receipt token', async () => {
    const deps = makeDeps([{ asset: 'LDBTC', free: '0.1', locked: '0' }]);
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset: 'BTC', totalAmount: '0.1' }],
      total: 1,
    });

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'LDBTC')).toBeUndefined();
    expect(byKey(balances, 'BTC')).toBeUndefined();
    expect(byKey(balances, 'BTC:earn')?.balanceMinorUnits).toBe(10_000_000);
  });

  it('reads LDO as LDO, a code that is no tracked coin, so it writes no holding', async () => {
    const deps = makeDeps([{ asset: 'LDO', free: '3', locked: '0' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(keysOf(balances)).toEqual([]);
  });

  it('skips a malformed balance of a tracked coin other than BTC and fails nothing', async () => {
    const deps = makeDeps([{ asset: 'USDT', free: 'x', locked: '0' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(keysOf(balances)).toEqual([]);
  });

  it('writes the other Funding coins when one tracked coin has a malformed amount', async () => {
    const deps = makeDeps([]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'BTC', free: '1', locked: '0', freeze: '0', withdrawing: '0' },
      { asset: 'USDT', free: '1e-8', locked: '0', freeze: '0', withdrawing: '0' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(keysOf(balances)).toEqual(['BTC:funding']);
  });
});

type BalanceList = Awaited<ReturnType<typeof binanceProvider.fetchBalances>>;

const keysOf = (balances: BalanceList): string[] =>
  balances.map(({ metadataKey }) => metadataKey).sort();

// One coin read at `amount` in exactly one wallet, every other wallet empty.
const depsHolding = (wallet: BinanceWallet, asset: string, amount: string): ProviderMocks => {
  const deps = makeDeps(wallet === 'spot' ? [{ asset, free: amount, locked: '0' }] : []);

  if (wallet === 'funding') {
    deps.fetchFundingAsset.mockResolvedValue([
      { asset, free: amount, locked: '0', freeze: '0', withdrawing: '0' },
    ]);
  }

  if (wallet === 'earn') {
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset, totalAmount: amount }],
      total: 1,
    });
  }

  return deps;
};

const WALLETS: BinanceWallet[] = ['spot', 'funding', 'earn'];

const heldIn = (
  wallet: BinanceWallet,
  currency: Currency,
  balanceMinorUnits: number,
): SyncTarget => ({
  accountId: 'acc-1',
  holdings: [binanceHolding(holdingKeyOf(currency, wallet), balanceMinorUnits, currency)],
});

describe('binanceProvider — appear, stay and dust', () => {
  it.each(WALLETS)('creates no %s holding for a coin read at zero', async (wallet) => {
    const balances = await binanceProvider.fetchBalances(
      depsHolding(wallet, 'USDT', '0'),
      emptyTarget,
    );

    expect(balances).toEqual([]);
  });

  it.each(WALLETS)('writes an existing %s holding at zero and keeps it', async (wallet) => {
    const balances = await binanceProvider.fetchBalances(
      depsHolding(wallet, 'USDT', '0'),
      heldIn(wallet, 'USDT', 1_000_000_000),
    );

    expect(balances).toEqual([
      expect.objectContaining({
        currency: 'USDT',
        balanceMinorUnits: 0,
        metadataKey: holdingKeyOf('USDT', wallet),
      }),
    ]);
  });

  it.each(WALLETS)('creates no %s holding for a coin below its dust threshold', async (wallet) => {
    const balances = await binanceProvider.fetchBalances(
      depsHolding(wallet, 'DOGE', '11.9999'),
      emptyTarget,
    );

    expect(balances).toEqual([]);
  });

  it.each(WALLETS)(
    'creates a holding in the %s wallet for a coin exactly at its dust threshold',
    async (wallet) => {
      const balances = await binanceProvider.fetchBalances(
        depsHolding(wallet, 'DOGE', '12'),
        emptyTarget,
      );

      expect(balances).toEqual([
        expect.objectContaining({
          currency: 'DOGE',
          balanceMinorUnits: 120_000,
          metadataKey: holdingKeyOf('DOGE', wallet),
        }),
      ]);
    },
  );

  it.each(WALLETS)(
    'writes an existing %s holding for a coin below its dust threshold',
    async (wallet) => {
      const balances = await binanceProvider.fetchBalances(
        depsHolding(wallet, 'DOGE', '11.9999'),
        heldIn(wallet, 'DOGE', 5),
      );

      expect(balances).toEqual([
        expect.objectContaining({
          currency: 'DOGE',
          balanceMinorUnits: 119_999,
          metadataKey: holdingKeyOf('DOGE', wallet),
        }),
      ]);
    },
  );

  it('judges the dust threshold on the coin total, not on one amount', async () => {
    const deps = makeDeps([{ asset: 'DOGE', free: '6', locked: '6' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(keysOf(balances)).toEqual(['DOGE']);
  });

  it('judges the dust threshold of each coin by its own entry', async () => {
    const deps = makeDeps([
      { asset: 'BTC', free: '0.00000999', locked: '0' },
      { asset: 'ETH', free: '0.0004', locked: '0' },
      { asset: 'USDT', free: '0.99999999', locked: '0' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(keysOf(balances)).toEqual(['ETH']);
  });

  it('creates a Funding BTC holding at its dust threshold and none below it', async () => {
    const below = await binanceProvider.fetchBalances(
      depsHolding('funding', 'BTC', '0.00000999'),
      emptyTarget,
    );
    const at = await binanceProvider.fetchBalances(
      depsHolding('funding', 'BTC', '0.00001'),
      emptyTarget,
    );

    expect(below).toEqual([]);
    expect(at).toEqual([
      expect.objectContaining({
        currency: 'BTC',
        balanceMinorUnits: 1_000,
        metadataKey: 'BTC:funding',
      }),
    ]);
  });

  it('writes an existing Spot BTC holding below its dust threshold', async () => {
    const balances = await binanceProvider.fetchBalances(
      makeDeps([{ asset: 'BTC', free: '0.00000999', locked: '0' }]),
      heldIn('spot', 'BTC', 5_000),
    );

    expect(byKey(balances, 'BTC')).toMatchObject({ balanceMinorUnits: 999 });
  });

  it('creates a fiat holding for any non-zero balance, a cent included', async () => {
    const balances = await binanceProvider.fetchBalances(
      depsHolding('funding', 'EUR', '0.01'),
      emptyTarget,
    );

    expect(balances).toEqual([
      expect.objectContaining({
        currency: 'EUR',
        balanceMinorUnits: 1,
        metadataKey: 'EUR:funding',
      }),
    ]);
  });

  it('creates no fiat holding for a zero balance and zeroes an existing one', async () => {
    const none = await binanceProvider.fetchBalances(
      depsHolding('funding', 'EUR', '0'),
      emptyTarget,
    );
    const zeroed = await binanceProvider.fetchBalances(
      depsHolding('funding', 'EUR', '0'),
      heldIn('funding', 'EUR', 500),
    );

    expect(none).toEqual([]);
    expect(zeroed).toEqual([
      expect.objectContaining({
        currency: 'EUR',
        balanceMinorUnits: 0,
        metadataKey: 'EUR:funding',
      }),
    ]);
  });
});

describe('binanceProvider — coins a good read does not list', () => {
  it.each([
    ['spot', 'Binance Spot · USDT'],
    ['funding', 'Binance Funding · USDT'],
    ['earn', 'Binance Earn · USDT'],
  ] as const)(
    'zeroes an existing %s holding whose coin is absent from the read',
    async (wallet, name) => {
      const balances = await binanceProvider.fetchBalances(
        makeDeps([{ asset: 'ETH', free: '1', locked: '0' }]),
        heldIn(wallet, 'USDT', 1_000_000_000),
      );

      expect(byKey(balances, holdingKeyOf('USDT', wallet))).toEqual({
        currency: 'USDT',
        balanceMinorUnits: 0,
        metadataKey: holdingKeyOf('USDT', wallet),
        name,
      });
    },
  );

  it('zeroes an existing Funding and Earn holding whose coin is absent from a good read', async () => {
    const deps = makeDeps([]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'BTC', free: '1', locked: '0', freeze: '0', withdrawing: '0' },
    ]);
    const target: SyncTarget = {
      accountId: 'acc-1',
      holdings: [
        binanceHolding('USDT:funding', 1_000_000_000, 'USDT'),
        binanceHolding('USDT:earn', 1_000_000_000, 'USDT'),
      ],
    };

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(byKey(balances, 'USDT:funding')).toMatchObject({
      currency: 'USDT',
      balanceMinorUnits: 0,
    });
    expect(byKey(balances, 'USDT:earn')).toMatchObject({ currency: 'USDT', balanceMinorUnits: 0 });
    expect(byKey(balances, 'BTC:funding')).toMatchObject({ balanceMinorUnits: 100_000_000 });
  });

  it('judges a coin of one wallet by the read of that wallet only', async () => {
    const deps = makeDeps([]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'USDT', free: '5', locked: '0', freeze: '0', withdrawing: '0' },
    ]);
    const target: SyncTarget = {
      accountId: 'acc-1',
      holdings: [binanceHolding('USDT:funding', 1, 'USDT'), binanceHolding('USDT:earn', 1, 'USDT')],
    };

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(byKey(balances, 'USDT:funding')).toMatchObject({ balanceMinorUnits: 500_000_000 });
    expect(byKey(balances, 'USDT:earn')).toMatchObject({ balanceMinorUnits: 0 });
  });

  it('writes nothing for a stored key that names no coin of the app', async () => {
    const target: SyncTarget = {
      accountId: 'acc-1',
      holdings: [binanceHolding('PEPE:funding'), binanceHolding('BTC:flexible')],
    };

    const balances = await binanceProvider.fetchBalances(makeDeps([]), target);

    expect(balances).toEqual([]);
  });

  it('never zeroes a held key of a fiat code that Binance does not quote', async () => {
    const target: SyncTarget = {
      accountId: 'acc-1',
      holdings: [
        binanceHolding('SCR', 500, 'SCR'),
        binanceHolding('SCR:funding', 500, 'SCR'),
        binanceHolding('SCR:earn', 500, 'SCR'),
      ],
    };

    const balances = await binanceProvider.fetchBalances(makeDeps([]), target);

    expect(balances).toEqual([]);
  });

  it('leaves every holding of a wallet whose read failed untouched', async () => {
    const deps = makeDeps([]);
    deps.fetchFundingAsset.mockRejectedValue(new Error('Binance request failed: 401'));
    const target: SyncTarget = {
      accountId: 'acc-1',
      holdings: [
        binanceHolding('USDT:funding', 1_000_000_000, 'USDT'),
        binanceHolding('BTC:funding', 100),
        binanceHolding('USDT:earn', 1_000_000_000, 'USDT'),
      ],
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    let balances: BalanceList;
    try {
      balances = await binanceProvider.fetchBalances(deps, target);
    } finally {
      warn.mockRestore();
    }

    expect(keysOf(balances)).toEqual(['USDT:earn']);
  });

  it('leaves every Earn holding untouched when either position read failed', async () => {
    const deps = makeDeps([]);
    deps.fetchLockedPosition.mockRejectedValue(new Error('boom'));
    const target: SyncTarget = {
      accountId: 'acc-1',
      holdings: [
        binanceHolding('USDT:earn', 1_000_000_000, 'USDT'),
        binanceHolding('BTC:earn', 100),
      ],
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    let balances: BalanceList;
    try {
      balances = await binanceProvider.fetchBalances(deps, target);
    } finally {
      warn.mockRestore();
    }

    expect(balances).toEqual([]);
  });

  it('fails the whole sync on a Spot failure, writing no zero for any held coin', async () => {
    const deps = makeDeps([]);
    deps.fetchAccount.mockRejectedValue(new Error('Binance request failed: 401'));

    await expect(
      binanceProvider.fetchBalances(deps, heldIn('spot', 'USDT', 1_000_000_000)),
    ).rejects.toThrow(/Binance request failed/);
  });
});

describe('binanceProvider — a ticker that equals a fiat code', () => {
  it('writes no holding for SCR on Spot and fails nothing, though SCR is a fiat code of the app', async () => {
    const deps = makeDeps([
      { asset: 'SCR', free: '5', locked: '0' },
      { asset: 'BTC', free: '1', locked: '0' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(keysOf(balances)).toEqual(['BTC']);
  });

  it('writes no holding for MNT on Funding', async () => {
    const balances = await binanceProvider.fetchBalances(
      depsHolding('funding', 'MNT', '5'),
      emptyTarget,
    );

    expect(byKey(balances, 'MNT:funding')).toBeUndefined();
  });

  it('never reads the amount of such a ticker', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const balances = await binanceProvider.fetchBalances(
        makeDeps([{ asset: 'SCR', free: 'x', locked: '1e-8' }]),
        emptyTarget,
      );

      expect(byKey(balances, 'SCR')).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('still writes a Funding holding for EUR, a Binance fiat code', async () => {
    const balances = await binanceProvider.fetchBalances(
      depsHolding('funding', 'EUR', '5.00'),
      emptyTarget,
    );

    expect(byKey(balances, 'EUR:funding')).toMatchObject({
      currency: 'EUR',
      balanceMinorUnits: 500,
    });
  });
});

describe('binanceProvider — the Spot balance texts', () => {
  it('keeps free and locked as Binance sent them, under the trimmed upper-case ticker', async () => {
    const deps = makeDeps([{ asset: ' usdt ', free: '1.0', locked: '0' }]);

    const read = await binanceRead.fetchBalances(deps, emptyTarget);

    expect(read.spotBalanceTexts?.USDT).toBe('1.0/0');
  });

  it('holds one text per asset of the Spot body, tracked or not, and nothing from another wallet', async () => {
    const deps = makeDeps([
      { asset: 'BTC', free: '0.50000000', locked: '0.25000000' },
      { asset: 'PEPE', free: '12.5', locked: '0.0' },
      { asset: 'ETH', free: '0.00000000', locked: '0.00000000' },
    ]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'CGPT', free: '3', locked: '0', freeze: '0', withdrawing: '0' },
    ]);

    const read = await binanceRead.fetchBalances(deps, emptyTarget);

    expect(read.spotBalanceTexts).toEqual({
      BTC: '0.50000000/0.25000000',
      PEPE: '12.5/0.0',
      ETH: '0.00000000/0.00000000',
    });
  });

  it('leaves out an entry with a field that is no text, so its coin has no text', async () => {
    const deps = makeDeps([]);
    deps.fetchAccount.mockResolvedValue({
      balances: [
        { asset: 'BTC', free: 0.5, locked: '0' },
        { asset: 'ETH', free: '1', locked: null },
        { asset: 'SOL', free: '2', locked: '0' },
        { asset: 7, free: '1', locked: '0' },
        'junk',
      ],
      uid: null,
    });

    const read = await binanceRead.fetchBalances(deps, emptyTarget);

    expect(read.spotBalanceTexts).toEqual({ SOL: '2/0' });
  });

  it('returns an empty record for a Spot body with no balance', async () => {
    const read = await binanceRead.fetchBalances(makeDeps([]), emptyTarget);

    expect(read.spotBalanceTexts).toEqual({});
  });
});

describe('binanceProvider — the account of the user (UA-1)', () => {
  it('writes Spot BTC and the Funding holdings, and no USDT or UAH holding', async () => {
    const deps = makeDeps([
      { asset: 'BTC', free: '0.5', locked: '0' },
      { asset: 'ETH', free: '0', locked: '0' },
      { asset: 'USDT', free: '0', locked: '0' },
      { asset: 'UAH', free: '0', locked: '0' },
    ]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'BTC', free: '0.1', locked: '0', freeze: '0', withdrawing: '0' },
      { asset: 'CGPT', free: '120.5', locked: '0', freeze: '0', withdrawing: '0' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, heldIn('spot', 'BTC', 1));

    expect(keysOf(balances)).toEqual(['BTC', 'BTC:funding', 'CGPT:funding']);
    expect(byKey(balances, 'BTC')).toMatchObject({
      currency: 'BTC',
      balanceMinorUnits: 50_000_000,
    });
    expect(byKey(balances, 'CGPT:funding')).toMatchObject({
      currency: 'CGPT',
      balanceMinorUnits: 120_500_000,
    });
  });
});
