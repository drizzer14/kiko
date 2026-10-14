const mockRunBalanceSync = jest.fn();
const mockSyncBinanceTransactions = jest.fn();
const mockSyncBinancePayHistory = jest.fn();
const mockSyncBinanceTransferHistory = jest.fn();
const mockSyncBinanceEarnHistory = jest.fn();

// `./sync` pulls the repos (and so op-sqlite) into the graph; replacing the
// whole module keeps this a pure dispatch test. `./binance/binance.transactions`,
// `./binance/binance.pay-history`, `./binance/binance.transfer-history` and
// `./binance/binance.earn-history` are replaced for the same reason. The Binance
// credentials module imports react-native-keychain, whose native binding is absent
// under Jest.
jest.mock('@kiko/crypto-sync/sync', () => ({
  runBalanceSync: (...args: unknown[]) => mockRunBalanceSync(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.transactions', () => ({
  syncBinanceTransactions: (...args: unknown[]) => mockSyncBinanceTransactions(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.pay-history', () => ({
  syncBinancePayHistory: (...args: unknown[]) => mockSyncBinancePayHistory(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.transfer-history', () => ({
  syncBinanceTransferHistory: (...args: unknown[]) => mockSyncBinanceTransferHistory(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.earn-history', () => ({
  syncBinanceEarnHistory: (...args: unknown[]) => mockSyncBinanceEarnHistory(...args),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

import { bitcoinWalletProvider, defaultBitcoinWalletDeps } from '../btc-wallet';
import { BINANCE_REQUEST_INTERVAL_MS, binanceProvider, defaultBinanceDeps } from '../binance';

import { type CryptoSyncRequest, runCryptoSync } from './run-crypto-sync';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('runCryptoSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunBalanceSync.mockResolvedValue({ syncedHoldings: 1 });
    mockSyncBinanceTransactions.mockResolvedValue({ imported: 0, complete: true });
    mockSyncBinancePayHistory.mockResolvedValue({ imported: 0, complete: true });
    mockSyncBinanceTransferHistory.mockResolvedValue({ imported: 0, complete: true });
    mockSyncBinanceEarnHistory.mockResolvedValue({ imported: 0, complete: true });
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

  it('runs the Binance balance sync then the capital history walk on the arm run', async () => {
    const result = await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(mockRunBalanceSync).toHaveBeenCalledWith(binanceProvider, defaultBinanceDeps, {
      targetAccountId: 'acc-2',
    });
    expect(mockSyncBinanceTransactions).toHaveBeenCalledWith({
      targetAccountId: 'acc-2',
      run: { gate: expect.any(Object), budget: expect.any(Object) },
    });
  });

  it('runs the Pay walk after the capital walk, on the same run object', async () => {
    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    const [capitalCall] = mockSyncBinanceTransactions.mock.calls;
    const [payCall] = mockSyncBinancePayHistory.mock.calls;
    expect(payCall[0]).toEqual({ targetAccountId: 'acc-2', run: capitalCall[0].run });
    expect(payCall[0].run).toBe(capitalCall[0].run);
    expect(mockSyncBinanceTransactions.mock.invocationCallOrder[0]).toBeLessThan(
      mockSyncBinancePayHistory.mock.invocationCallOrder[0],
    );
  });

  it('runs the Transfer walk after the Pay walk, on the same run object', async () => {
    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    const [capitalCall] = mockSyncBinanceTransactions.mock.calls;
    const [transferCall] = mockSyncBinanceTransferHistory.mock.calls;
    expect(transferCall[0]).toEqual({ targetAccountId: 'acc-2', run: capitalCall[0].run });
    expect(transferCall[0].run).toBe(capitalCall[0].run);
    expect(mockSyncBinancePayHistory.mock.invocationCallOrder[0]).toBeLessThan(
      mockSyncBinanceTransferHistory.mock.invocationCallOrder[0],
    );
  });

  it('runs the walks in order, capital, Pay, Transfer, Earn, all on one run object', async () => {
    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    const [capitalCall] = mockSyncBinanceTransactions.mock.calls;
    const [earnCall] = mockSyncBinanceEarnHistory.mock.calls;
    expect(earnCall[0]).toEqual({ targetAccountId: 'acc-2', run: capitalCall[0].run });
    expect(earnCall[0].run).toBe(capitalCall[0].run);
    expect(
      [
        mockSyncBinanceTransactions,
        mockSyncBinancePayHistory,
        mockSyncBinanceTransferHistory,
        mockSyncBinanceEarnHistory,
      ].map((mock) => mock.mock.invocationCallOrder[0]),
    ).toEqual(
      [
        mockSyncBinanceTransactions,
        mockSyncBinancePayHistory,
        mockSyncBinanceTransferHistory,
        mockSyncBinanceEarnHistory,
      ]
        .map((mock) => mock.mock.invocationCallOrder[0])
        .sort((left, right) => left - right),
    );
  });

  it('builds one history run per arm run, never sharing a budget across runs', async () => {
    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });
    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    const [firstRun, secondRun] = mockSyncBinanceTransactions.mock.calls.map(
      ([request]) => request.run,
    );
    expect(firstRun).not.toBe(secondRun);
    expect(firstRun.budget).not.toBe(secondRun.budget);
  });

  it('paces the history run on the real clock and real timers: the second request waits out the interval', async () => {
    jest.useFakeTimers();

    try {
      const settledAfter: Record<string, boolean> = {};
      mockSyncBinanceTransactions.mockImplementation(async ({ run }) => {
        const elapsedMs = 200;

        await run.gate.wait();
        await jest.advanceTimersByTimeAsync(elapsedMs);
        let settled = false;
        const second = run.gate.wait().then(() => {
          settled = true;
        });

        await jest.advanceTimersByTimeAsync(BINANCE_REQUEST_INTERVAL_MS - elapsedMs - 1);
        settledAfter.beforeInterval = settled;
        await jest.advanceTimersByTimeAsync(1);
        await second;
        settledAfter.atInterval = settled;

        return { imported: 0, complete: true };
      });

      await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

      expect(settledAfter).toEqual({ beforeInterval: false, atInterval: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('still resolves with the balance result when the capital history walk fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSyncBinanceTransactions.mockRejectedValue(new Error('Too much request weight used SECRET'));

    const result = await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(warn).toHaveBeenCalledWith('[binance sync] capital history failed', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    warn.mockRestore();
  });

  it('still resolves with the balance result when the Pay walk fails, logging only its name', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSyncBinancePayHistory.mockRejectedValue(new Error('Order 123 for Ann SECRET'));

    const result = await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(warn).toHaveBeenCalledWith('[binance sync] pay history failed', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    warn.mockRestore();
  });

  it('still resolves with the balance result when the Transfer walk fails, logging only its name', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSyncBinanceTransferHistory.mockRejectedValue(new Error('Transfer t-123 SECRET'));

    const result = await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(warn).toHaveBeenCalledWith('[binance sync] transfer history failed', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    warn.mockRestore();
  });

  it('still resolves with the balance result when the Earn walk fails, logging only its name', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSyncBinanceEarnHistory.mockRejectedValue(new Error('Reward r-123 SECRET'));

    const result = await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(warn).toHaveBeenCalledWith('[binance sync] earn history failed', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    warn.mockRestore();
  });

  it('runs the Earn walk even when the Transfer walk failed: each walk logs its own failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSyncBinanceTransferHistory.mockRejectedValue(new Error('transfer boom'));

    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(mockSyncBinanceEarnHistory).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[binance sync] transfer history failed');
    warn.mockRestore();
  });

  it('runs the Transfer walk even when the Pay walk failed: each walk logs its own failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSyncBinancePayHistory.mockRejectedValue(new Error('pay boom'));

    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(mockSyncBinanceTransferHistory).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[binance sync] pay history failed');
    warn.mockRestore();
  });

  it('runs the Pay walk even when the capital walk failed: each walk logs its own failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSyncBinanceTransactions.mockRejectedValue(new Error('capital boom'));

    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(mockSyncBinancePayHistory).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[binance sync] capital history failed');
    warn.mockRestore();
  });

  it('does not run the Pay, the Transfer or the Earn walk for a wallet request', async () => {
    await runCryptoSync({ providerId: 'btc_wallet', targetAccountId: 'acc-1' });

    expect(mockSyncBinancePayHistory).not.toHaveBeenCalled();
    expect(mockSyncBinanceTransferHistory).not.toHaveBeenCalled();
    expect(mockSyncBinanceEarnHistory).not.toHaveBeenCalled();
  });

  // An account-detail Connect overlapping a pull-to-refresh fan-out can
  // both trigger a Binance sync for the SAME account while the first is still
  // in flight. `runBalanceSync` is already per-account single-flight-locked
  // (`src/crypto-sync/sync/sync.ts`), but the transaction import that runs
  // AFTER it was not, so a second overlapping trigger re-ran
  // `syncBinanceTransactions` — wasted requests and a possible swallowed 429.
  // The whole binance arm (balance + transaction import) must join one
  // in-flight run per account.
  describe('single-flight join over the whole Binance arm', () => {
    it('runs syncBinanceTransactions once when two overlapping triggers target the SAME Binance account', async () => {
      const [a, b] = await Promise.all([
        runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' }),
        runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' }),
      ]);

      expect(a).toEqual(b);
      expect(mockRunBalanceSync).toHaveBeenCalledTimes(1);
      expect(mockSyncBinanceTransactions).toHaveBeenCalledTimes(1);
      expect(mockSyncBinancePayHistory).toHaveBeenCalledTimes(1);
      expect(mockSyncBinanceTransferHistory).toHaveBeenCalledTimes(1);
      expect(mockSyncBinanceEarnHistory).toHaveBeenCalledTimes(1);
    });

    it('runs independently for two DIFFERENT Binance accounts', async () => {
      await Promise.all([
        runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' }),
        runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-3' }),
      ]);

      expect(mockRunBalanceSync).toHaveBeenCalledTimes(2);
      expect(mockSyncBinanceTransactions).toHaveBeenCalledTimes(2);
      expect(mockSyncBinanceTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ targetAccountId: 'acc-2' }),
      );
      expect(mockSyncBinanceTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ targetAccountId: 'acc-3' }),
      );
    });

    it('releases the lock after settling so a later, non-overlapping sync runs fresh', async () => {
      await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });
      await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

      expect(mockRunBalanceSync).toHaveBeenCalledTimes(2);
      expect(mockSyncBinanceTransactions).toHaveBeenCalledTimes(2);
    });
  });
});
