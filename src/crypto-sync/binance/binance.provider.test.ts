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
const target: SyncTarget = { accountId: 'acc-1', holdings: [] };
const credentials = { apiKey: 'api-key-fixture', secret: 'secret-fixture' };

type ProviderMocks = BinanceDeps & {
  fetchAccount: jest.Mock;
  fetchFundingAsset: jest.Mock;
  fetchFlexiblePosition: jest.Mock;
  fetchLockedPosition: jest.Mock;
  readCredentials: jest.Mock;
};

// The three non-Spot wallets default to EMPTY so an existing Spot-only assertion
// (75_000_000 for 0.5 + 0.25 BTC) is unchanged; a test that exercises a wallet
// overrides just that mock.
const makeDeps = (balances: { asset: string; free: string; locked: string }[]): ProviderMocks => ({
  fetchImpl: (async () => ({ ok: true })) as unknown as typeof fetch,
  now: () => NOW,
  readCredentials: jest.fn(async () => credentials),
  fetchAccount: jest.fn(async () => ({ balances })),
  fetchFundingAsset: jest.fn(async () => []),
  fetchFlexiblePosition: jest.fn(async () => ({ rows: [], total: 0 })),
  fetchLockedPosition: jest.fn(async () => ({ rows: [], total: 0 })),
});

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

  it('reads the stored credentials and calls fetchAccount with the injected fetch and clock', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1.00000000', locked: '0.00000000' }]);

    await binanceProvider.fetchBalances(deps, target);

    expect(deps.readCredentials).toHaveBeenCalledTimes(1);
    expect(deps.fetchAccount).toHaveBeenCalledWith('api-key-fixture', 'secret-fixture', {
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
  });

  it('sums free + locked for the BTC asset into satoshis and ignores every other asset', async () => {
    const deps = makeDeps([
      { asset: 'ETH', free: '2.00000000', locked: '0.00000000' },
      { asset: 'BTC', free: '0.50000000', locked: '0.25000000' },
      { asset: 'USDT', free: '100.00000000', locked: '0.00000000' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(balances).toEqual([
      { currency: 'BTC', balanceMinorUnits: 75_000_000, metadataKey: 'BTC', name: 'Binance BTC' },
    ]);
  });

  it('converts each decimal string separately so float addition never drifts', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.1', locked: '0.2' }]);

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance.balanceMinorUnits).toBe(30_000_000);
  });

  it('reports a zero BTC balance when the payload carries no BTC entry', async () => {
    const deps = makeDeps([{ asset: 'ETH', free: '2.00000000', locked: '0.00000000' }]);

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance).toMatchObject({ currency: 'BTC', balanceMinorUnits: 0, metadataKey: 'BTC' });
  });

  it('throws before any network call when no credentials are stored', async () => {
    const deps = makeDeps([]);
    deps.readCredentials.mockResolvedValue(undefined);

    await expect(binanceProvider.fetchBalances(deps, target)).rejects.toThrow(/connect Binance/i);
    expect(deps.fetchAccount).not.toHaveBeenCalled();
  });

  it('rejects a body with no balances array', async () => {
    const deps = makeDeps([]);
    deps.fetchAccount.mockResolvedValue({} as BinanceAccount);

    await expect(binanceProvider.fetchBalances(deps, target)).rejects.toThrow(/Binance/);
  });

  it('rejects a body whose balances is not an array', async () => {
    const deps = makeDeps([]);
    deps.fetchAccount.mockResolvedValue({ balances: 'nope' } as unknown as BinanceAccount);

    await expect(binanceProvider.fetchBalances(deps, target)).rejects.toThrow(/Binance/);
  });

  it('rejects a non-finite free/locked amount rather than writing NaN', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: 'x', locked: '0' }]);

    await expect(binanceProvider.fetchBalances(deps, target)).rejects.toThrow(/Binance/);
  });

  it('reports a genuine zero balance as zero', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0', locked: '0' }]);

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance.balanceMinorUnits).toBe(0);
  });
});

describe('binanceProvider — all Binance wallets', () => {
  // Keep the per-wallet skip logs out of the test output, and let a skip test
  // assert one was written.
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('sums BTC across Spot, Funding, Flexible and Locked into the single holding', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.5', locked: '0.25' }]); // 0.75 BTC
    deps.fetchFundingAsset.mockResolvedValue([
      // 0.1 + 0.2 + 0.05 + 0.05 = 0.4 BTC
      { asset: 'BTC', free: '0.1', locked: '0.2', freeze: '0.05', withdrawing: '0.05' },
    ]);
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset: 'BTC', totalAmount: '0.3' }],
      total: 1,
    }); // 0.3 BTC
    deps.fetchLockedPosition.mockResolvedValue({
      rows: [{ asset: 'BTC', amount: '0.05' }],
      total: 1,
    }); // 0.05 BTC

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    // 0.75 + 0.4 + 0.3 + 0.05 = 1.5 BTC = 150_000_000 satoshis, in one holding.
    expect(balance).toEqual({
      currency: 'BTC',
      balanceMinorUnits: 150_000_000,
      metadataKey: 'BTC',
      name: 'Binance BTC',
    });
  });

  it('signs every wallet call with the stored credentials, injected fetch and clock', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);

    await binanceProvider.fetchBalances(deps, target);

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

  it('sums the funding wallet free + locked + freeze + withdrawing and ignores other assets', async () => {
    const deps = makeDeps([]); // no Spot BTC
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'BTC', free: '0.1', locked: '0.2', freeze: '0.05', withdrawing: '0.05' },
      { asset: 'ETH', free: '9', locked: '9', freeze: '9', withdrawing: '9' },
    ]);

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance.balanceMinorUnits).toBe(40_000_000); // 0.4 BTC
  });

  it('sums flexible totalAmount and locked amount, ignoring other assets', async () => {
    const deps = makeDeps([]);
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

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance.balanceMinorUnits).toBe(50_000_000); // 0.3 + 0.2 = 0.5 BTC
  });

  it('skips ONLY the funding wallet on error; Spot still imports', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.5', locked: '0.25' }]); // 0.75 BTC
    deps.fetchFundingAsset.mockRejectedValue(
      new Error('Binance request failed: 401: Invalid API-key, IP, or permissions for action.'),
    );
    deps.fetchFlexiblePosition.mockResolvedValue({
      rows: [{ asset: 'BTC', totalAmount: '0.1' }],
      total: 1,
    });

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    // Funding contributes 0; Spot (0.75) + Flexible (0.1) still land.
    expect(balance.balanceMinorUnits).toBe(85_000_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('funding'), expect.any(Error));
  });

  it('skips a failing flexible-earn wallet without touching the rest', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]); // 1 BTC
    deps.fetchFlexiblePosition.mockRejectedValue(new Error('boom'));
    deps.fetchLockedPosition.mockResolvedValue({
      rows: [{ asset: 'BTC', amount: '0.5' }],
      total: 1,
    });

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance.balanceMinorUnits).toBe(150_000_000); // 1 + 0.5 BTC
  });

  it('skips a failing locked-earn wallet without touching the rest', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
    deps.fetchLockedPosition.mockRejectedValue(new Error('boom'));

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance.balanceMinorUnits).toBe(100_000_000); // 1 BTC from Spot only
  });

  it('fails the whole sync when the Spot wallet call fails', async () => {
    const deps = makeDeps([]);
    deps.fetchAccount.mockRejectedValue(new Error('Binance request failed: 401'));

    await expect(binanceProvider.fetchBalances(deps, target)).rejects.toThrow(
      /Binance request failed/,
    );
  });

  it('skips a funding wallet whose BTC amount is non-numeric rather than writing NaN', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1', locked: '0' }]);
    deps.fetchFundingAsset.mockResolvedValue([
      { asset: 'BTC', free: 'x', locked: '0', freeze: '0', withdrawing: '0' },
    ]);

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance.balanceMinorUnits).toBe(100_000_000); // funding skipped, Spot kept
    expect(Number.isNaN(balance.balanceMinorUnits)).toBe(false);
  });
});
