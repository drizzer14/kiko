import type { SyncTarget } from '../provider';

import { type BinanceAccount, fetchAccount } from './binance.client';
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

const makeDeps = (
  balances: { asset: string; free: string; locked: string }[],
): BinanceDeps & { fetchAccount: jest.Mock; readCredentials: jest.Mock } => ({
  fetchImpl: (async () => ({ ok: true })) as unknown as typeof fetch,
  now: () => NOW,
  readCredentials: jest.fn(async () => credentials),
  fetchAccount: jest.fn(async () => ({ balances })),
});

describe('binanceProvider', () => {
  it('is the binance exchange provider keyed on binanceAsset', () => {
    expect(binanceProvider.id).toBe('binance');
    expect(binanceProvider.kind).toBe('exchange');
    expect(binanceProvider.metadataField).toBe('binanceAsset');
  });

  it('wires the real client, credentials reader, clock and fetch as its default deps', () => {
    expect(defaultBinanceDeps.fetchAccount).toBe(fetchAccount);
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

  it('reports a zero BTC balance when the payload carries no balances array at all', async () => {
    const deps = makeDeps([]);
    deps.fetchAccount.mockResolvedValue({} as BinanceAccount);

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance).toMatchObject({ currency: 'BTC', balanceMinorUnits: 0, metadataKey: 'BTC' });
  });

  it('throws before any network call when no credentials are stored', async () => {
    const deps = makeDeps([]);
    deps.readCredentials.mockResolvedValue(undefined);

    await expect(binanceProvider.fetchBalances(deps, target)).rejects.toThrow(/connect Binance/i);
    expect(deps.fetchAccount).not.toHaveBeenCalled();
  });
});
