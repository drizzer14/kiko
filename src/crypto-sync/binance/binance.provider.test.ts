import type { HoldingRow } from '../../db/schema';
import type { SyncTarget } from '../provider';

import {
  type BinanceAccount,
  fetchAccount,
  fetchFlexiblePosition,
  fetchFundingAsset,
  fetchLockedPosition,
} from './binance.client';
import { readCredentials } from './binance.credentials';
import { type BinanceDeps, binanceProvider, defaultBinanceDeps } from './binance.provider';

// The credentials module imports react-native-keychain, whose native binding is
// absent under Jest; `readCredentials` is injected, so the stub only needs the
// ACCESSIBLE enum its module-scope hardened-options constant reads at load.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

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
  fetchAccount: jest.fn(async () => ({ balances })),
  fetchFundingAsset: jest.fn(async () => []),
  fetchFlexiblePosition: jest.fn(async () => ({ rows: [], total: 0 })),
  fetchLockedPosition: jest.fn(async () => ({ rows: [], total: 0 })),
});

// A minimal synced Binance holding for a given match key, to model a target that
// already carries one of the split holdings (the transition and zero-balance
// paths). Only the fields the provider reads (`metadata.binanceAsset`) matter.
const binanceHolding = (binanceAsset: string, balanceMinorUnits = 1): HoldingRow => ({
  id: `h-${binanceAsset}`,
  accountId: 'acc-1',
  name: binanceAsset,
  type: 'crypto_asset',
  currency: 'BTC',
  icon: null,
  color: null,
  balanceMinorUnits,
  syncedBalanceMinorUnits: null,
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
    expect(binanceProvider.kind).toBe('exchange');
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

    expect(deps.readCredentials).toHaveBeenCalledTimes(1);
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
      name: 'Binance Spot',
      // The transition marker: relabel a still-default legacy holding to Spot.
      renameFromDefault: 'Binance BTC',
    });
  });

  it('converts each Spot decimal string separately so float addition never drifts', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.1', locked: '0.2' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(30_000_000);
  });

  // Spot is the connection's proof of life and the split's anchor, so it is
  // always written — a genuine zero included.
  it('writes a zero Spot holding when the payload carries no BTC entry', async () => {
    const deps = makeDeps([{ asset: 'ETH', free: '2.00000000', locked: '0.00000000' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

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

  it('fails the whole sync on a non-finite Spot amount rather than writing NaN', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: 'x', locked: '0' }]);

    await expect(binanceProvider.fetchBalances(deps, emptyTarget)).rejects.toThrow(/Binance/);
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
      name: 'Binance Funding',
    });
  });

  it('skips ONLY the Funding holding on error; Spot and Earn still write', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]); // Spot 1
    deps.fetchFundingAsset.mockRejectedValue(new Error('Binance request failed: 401'));
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset: 'BTC', totalAmount: '0.1' }],
      total: 1,
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    let balances: Awaited<ReturnType<typeof binanceProvider.fetchBalances>>;
    try {
      balances = await binanceProvider.fetchBalances(deps, emptyTarget);
    } finally {
      warn.mockRestore();
    }

    // No Funding holding is written — its existing balance (if any) is left
    // untouched rather than clobbered with a fabricated zero.
    expect(byKey(balances, 'BTC:funding')).toBeUndefined();
    expect(byKey(balances, 'BTC')?.balanceMinorUnits).toBe(100_000_000);
    expect(byKey(balances, 'BTC:earn')?.balanceMinorUnits).toBe(10_000_000);
  });

  it('skips a Funding wallet whose BTC amount is non-numeric rather than writing NaN', async () => {
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
      name: 'Binance Funding',
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
      name: 'Binance Earn',
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

  // The legacy aggregated holding kept the old default name "Binance BTC"; once
  // it becomes Spot-only it must relabel to "Binance Spot" so the grid does not
  // mix "Binance BTC" with "Binance Funding"/"Binance Earn". The Spot balance
  // carries the old default as `renameFromDefault`, so the upsert renames a
  // still-default holding while leaving a user-edited name untouched.
  it('marks the Spot balance to relabel a legacy default-named holding to "Binance Spot"', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);

    const balances = await binanceProvider.fetchBalances(deps, emptyTarget);

    expect(byKey(balances, 'BTC')?.name).toBe('Binance Spot');
    expect(byKey(balances, 'BTC')?.renameFromDefault).toBe('Binance BTC');
  });
});
