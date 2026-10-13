const mockRunBalanceSync = jest.fn();
const mockSyncBinanceTransactions = jest.fn();

// `./sync` pulls the repos (and so op-sqlite) into the graph; replacing the
// whole module keeps this a pure dispatch test. `./binance/binance.transactions`
// is replaced for the same reason. The Binance credentials module imports
// react-native-keychain, whose native binding is absent under Jest.
jest.mock('@kiko/crypto-sync/sync', () => ({
  runBalanceSync: (...args: unknown[]) => mockRunBalanceSync(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.transactions', () => ({
  syncBinanceTransactions: (...args: unknown[]) => mockSyncBinanceTransactions(...args),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

import { binanceProvider, defaultBinanceDeps } from '../binance';
import { bitcoinWalletProvider, defaultBitcoinWalletDeps } from '../btc-wallet';

import { type CryptoSyncRequest, runCryptoSync } from './run-crypto-sync';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('runCryptoSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunBalanceSync.mockResolvedValue({ syncedHoldings: 1 });
    mockSyncBinanceTransactions.mockResolvedValue({ imported: 0 });
  });

  it('runs the wallet provider with the connect-time address on a wallet request', async () => {
    const request: CryptoSyncRequest = {
      providerId: 'btc_wallet',
      targetAccountId: 'acc-1',
      address: ADDRESS,
    };

    const result = await runCryptoSync(request);

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(mockRunBalanceSync).toHaveBeenCalledWith(
      bitcoinWalletProvider,
      { ...defaultBitcoinWalletDeps, address: ADDRESS },
      { targetAccountId: 'acc-1' },
    );
    expect(mockSyncBinanceTransactions).not.toHaveBeenCalled();
  });

  it('runs the wallet provider without an address on a wallet re-sync', async () => {
    await runCryptoSync({ providerId: 'btc_wallet', targetAccountId: 'acc-1' });

    expect(mockRunBalanceSync).toHaveBeenCalledWith(
      bitcoinWalletProvider,
      { ...defaultBitcoinWalletDeps, address: undefined },
      { targetAccountId: 'acc-1' },
    );
  });

  it('runs the Binance balance sync then imports its transaction history', async () => {
    const result = await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(mockRunBalanceSync).toHaveBeenCalledWith(binanceProvider, defaultBinanceDeps, {
      targetAccountId: 'acc-2',
    });
    expect(mockSyncBinanceTransactions).toHaveBeenCalledWith({ targetAccountId: 'acc-2' });
  });

  it('still resolves with the balance result when the transaction import fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSyncBinanceTransactions.mockRejectedValue(new Error('Too much request weight used SECRET'));

    const result = await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(warn).toHaveBeenCalledWith('[binance sync] transaction history import failed', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    warn.mockRestore();
  });

  // An account-detail Connect overlapping a pull-to-refresh fan-out can
  // both trigger a Binance sync for the SAME account while the first is still
  // in flight. `runBalanceSync` is already per-account single-flight-locked
  // (`src/crypto-sync/sync/sync.ts`), but the transaction import that runs
  // AFTER it was not, so a second overlapping trigger re-ran
  // `syncBinanceTransactions` — wasted requests and a possible swallowed 429.
  // The whole binance arm (balance + transaction import) must join one
  // in-flight run per account.
  describe('single-flight join over the whole Binance arm (P2)', () => {
    it('runs syncBinanceTransactions once when two overlapping triggers target the SAME Binance account', async () => {
      const [a, b] = await Promise.all([
        runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' }),
        runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' }),
      ]);

      expect(a).toEqual(b);
      expect(mockRunBalanceSync).toHaveBeenCalledTimes(1);
      expect(mockSyncBinanceTransactions).toHaveBeenCalledTimes(1);
    });

    it('runs independently for two DIFFERENT Binance accounts', async () => {
      await Promise.all([
        runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' }),
        runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-3' }),
      ]);

      expect(mockRunBalanceSync).toHaveBeenCalledTimes(2);
      expect(mockSyncBinanceTransactions).toHaveBeenCalledTimes(2);
      expect(mockSyncBinanceTransactions).toHaveBeenCalledWith({ targetAccountId: 'acc-2' });
      expect(mockSyncBinanceTransactions).toHaveBeenCalledWith({ targetAccountId: 'acc-3' });
    });

    it('releases the lock after settling so a later, non-overlapping sync runs fresh', async () => {
      await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });
      await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

      expect(mockRunBalanceSync).toHaveBeenCalledTimes(2);
      expect(mockSyncBinanceTransactions).toHaveBeenCalledTimes(2);
    });
  });
});
