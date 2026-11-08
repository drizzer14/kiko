const mockRunBalanceSync = jest.fn();
const mockCreateBinanceHistoryRun = jest.fn();
const mockSyncBinanceTransactions = jest.fn();
const mockPatchExchangeState = jest.fn();
const mockSyncBybitCapitalHistory = jest.fn();
const mockSyncBybitTransferHistory = jest.fn();
const mockSyncBybitLogHistory = jest.fn();
const mockSyncBybitConvertHistory = jest.fn();
const mockSyncBybitFundingLedger = jest.fn();

// `./sync` pulls the repos into the graph, and the Binance barrel loads every walk; replacing both
// keeps this a pure dispatch test, and a walk that ran for a Bybit request would show here. The
// Bybit capital, transfer, log and convert walks are replaced the same way, so what they are given
// is all this suite looks at.
jest.mock('@kiko/crypto-sync/bybit/bybit.capital-history', () => ({
  syncBybitCapitalHistory: (...args: unknown[]) => mockSyncBybitCapitalHistory(...args),
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.transfer-history', () => ({
  syncBybitTransferHistory: (...args: unknown[]) => mockSyncBybitTransferHistory(...args),
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.log-history', () => ({
  syncBybitLogHistory: (...args: unknown[]) => mockSyncBybitLogHistory(...args),
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.convert-history', () => ({
  syncBybitConvertHistory: (...args: unknown[]) => mockSyncBybitConvertHistory(...args),
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.funding-ledger', () => ({
  syncBybitFundingLedger: (...args: unknown[]) => mockSyncBybitFundingLedger(...args),
}));
jest.mock('@kiko/crypto-sync/sync', () => ({
  runBalanceSync: (...args: unknown[]) => mockRunBalanceSync(...args),
}));
jest.mock('@kiko/crypto-sync/binance', () => ({
  binanceProvider: {},
  defaultBinanceDeps: {},
  createBinanceHistoryRun: (...args: unknown[]) => mockCreateBinanceHistoryRun(...args),
  syncBinanceTransactions: (...args: unknown[]) => mockSyncBinanceTransactions(...args),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: {
    getQuery: async () => [],
    patchExchangeState: (...args: unknown[]) => mockPatchExchangeState(...args),
  },
}));

import { bybitProvider, defaultBybitDeps } from '../bybit';

import { runCryptoSync } from './run-crypto-sync';

const lists = [
  { kind: 'coinList', coins: 'untrackedCoins', list: 'balance', tickers: ['PEPE'] },
  { kind: 'balanceSyncedAt', value: 1_700_000_000_000 },
];

describe('runCryptoSync for Bybit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunBalanceSync.mockResolvedValue({ syncedHoldings: 2 });
    mockSyncBybitCapitalHistory.mockResolvedValue({ imported: 0, complete: true });
    mockSyncBybitTransferHistory.mockResolvedValue({ imported: 0, complete: true });
    mockSyncBybitLogHistory.mockResolvedValue({ imported: 0, complete: true });
    mockSyncBybitConvertHistory.mockResolvedValue({ imported: 0, complete: true });
    mockSyncBybitFundingLedger.mockResolvedValue({ imported: 0, complete: true });
  });

  describe.each([
    ['capital', mockSyncBybitCapitalHistory],
    ['transfer', mockSyncBybitTransferHistory],
    ['log', mockSyncBybitLogHistory],
    ['convert', mockSyncBybitConvertHistory],
    ['Funding ledger', mockSyncBybitFundingLedger],
  ])('the %s history walk, as each of them', (name, mockWalk) => {
    it('still resolves with the balance result when the walk fails, logging only its name', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockWalk.mockRejectedValueOnce(new Error('Failed query: params SECRET'));

      const result = await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(result).toEqual({ syncedHoldings: 2 });
      expect(warn).toHaveBeenCalledWith(`[bybit sync] ${name} history failed`, {
        name: 'Error',
        code: undefined,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
      warn.mockRestore();
    });

    it('does not run when the balance sync fails', async () => {
      mockRunBalanceSync.mockRejectedValueOnce(new Error('read boom'));

      await expect(
        runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' }),
      ).rejects.toThrow('read boom');

      expect(mockWalk).not.toHaveBeenCalled();
    });
  });

  describe('the transfer history walk', () => {
    it('runs once after the capital walk, on the run the capital walk was given', async () => {
      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockSyncBybitTransferHistory).toHaveBeenCalledTimes(1);
      expect(mockSyncBybitTransferHistory).toHaveBeenCalledWith({
        targetAccountId: 'acc-1',
        run: { gate: expect.any(Object), budget: expect.any(Object) },
      });
      expect(mockSyncBybitTransferHistory.mock.calls[0][0].run).toBe(
        mockSyncBybitCapitalHistory.mock.calls[0][0].run,
      );
      expect(mockSyncBybitCapitalHistory.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncBybitTransferHistory.mock.invocationCallOrder[0],
      );
    });

    it('still runs when the capital walk fails, and logs only the name of the failure', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockSyncBybitCapitalHistory.mockRejectedValueOnce(new Error('Failed query: params SECRET'));

      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockSyncBybitTransferHistory).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[bybit sync] capital history failed', {
        name: 'Error',
        code: undefined,
      });
      warn.mockRestore();
    });
  });

  describe('the log history walk', () => {
    it('runs once after the transfer walk, on the run the other walks were given', async () => {
      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockSyncBybitLogHistory).toHaveBeenCalledTimes(1);
      expect(mockSyncBybitLogHistory).toHaveBeenCalledWith({
        targetAccountId: 'acc-1',
        run: { gate: expect.any(Object), budget: expect.any(Object) },
      });
      expect(mockSyncBybitLogHistory.mock.calls[0][0].run).toBe(
        mockSyncBybitTransferHistory.mock.calls[0][0].run,
      );
      expect(mockSyncBybitTransferHistory.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncBybitLogHistory.mock.invocationCallOrder[0],
      );
    });

    it('still runs when the transfer walk fails', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockSyncBybitTransferHistory.mockRejectedValueOnce(new Error('Failed query: params SECRET'));

      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockSyncBybitLogHistory).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('the convert history walk', () => {
    it('runs once after the log walk, on the run the other walks were given', async () => {
      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockSyncBybitConvertHistory).toHaveBeenCalledTimes(1);
      expect(mockSyncBybitConvertHistory).toHaveBeenCalledWith({
        targetAccountId: 'acc-1',
        run: { gate: expect.any(Object), budget: expect.any(Object) },
      });
      expect(mockSyncBybitConvertHistory.mock.calls[0][0].run).toBe(
        mockSyncBybitLogHistory.mock.calls[0][0].run,
      );
      expect(mockSyncBybitLogHistory.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncBybitConvertHistory.mock.invocationCallOrder[0],
      );
    });

    it('still runs when the log walk fails', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockSyncBybitLogHistory.mockRejectedValueOnce(new Error('Failed query: params SECRET'));

      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockSyncBybitConvertHistory).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('the Funding ledger walk', () => {
    it('runs once after the convert walk, on the run the other walks were given', async () => {
      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockSyncBybitFundingLedger).toHaveBeenCalledTimes(1);
      expect(mockSyncBybitFundingLedger).toHaveBeenCalledWith({
        targetAccountId: 'acc-1',
        run: { gate: expect.any(Object), budget: expect.any(Object) },
      });
      expect(mockSyncBybitFundingLedger.mock.calls[0][0].run).toBe(
        mockSyncBybitConvertHistory.mock.calls[0][0].run,
      );
      expect(mockSyncBybitConvertHistory.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncBybitFundingLedger.mock.invocationCallOrder[0],
      );
    });

    it('still runs when the convert walk fails', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockSyncBybitConvertHistory.mockRejectedValueOnce(new Error('Failed query: params SECRET'));

      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockSyncBybitFundingLedger).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('the capital history walk', () => {
    it('runs after the balance sync and the write of its lists, on a run of its own for the account', async () => {
      mockRunBalanceSync.mockResolvedValue({ syncedHoldings: 2, exchangeState: lists });

      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockSyncBybitCapitalHistory).toHaveBeenCalledTimes(1);
      expect(mockSyncBybitCapitalHistory).toHaveBeenCalledWith({
        targetAccountId: 'acc-1',
        run: { gate: expect.any(Object), budget: expect.any(Object) },
      });
      expect(mockPatchExchangeState.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncBybitCapitalHistory.mock.invocationCallOrder[0],
      );
    });

    it('runs once for two overlapping triggers of one account', async () => {
      await Promise.all([
        runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' }),
        runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' }),
      ]);

      expect(mockSyncBybitCapitalHistory).toHaveBeenCalledTimes(1);
    });
  });

  it('runs the Bybit provider with its own deps on the account, and no Binance walk', async () => {
    const result = await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

    expect(result).toEqual({ syncedHoldings: 2 });
    expect(mockRunBalanceSync).toHaveBeenCalledWith(bybitProvider, defaultBybitDeps, {
      targetAccountId: 'acc-1',
    });
    expect(mockCreateBinanceHistoryRun).not.toHaveBeenCalled();
    expect(mockSyncBinanceTransactions).not.toHaveBeenCalled();
  });

  describe('the lists the read returned', () => {
    it('writes them to the account as a Bybit account once the balance sync has marked it', async () => {
      mockRunBalanceSync.mockResolvedValue({ syncedHoldings: 2, exchangeState: lists });

      const result = await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(result).toEqual({ syncedHoldings: 2 });
      expect(mockPatchExchangeState).toHaveBeenCalledTimes(1);
      expect(mockPatchExchangeState).toHaveBeenCalledWith('acc-1', 'bybit', lists);
      expect(mockRunBalanceSync.mock.invocationCallOrder[0]).toBeLessThan(
        mockPatchExchangeState.mock.invocationCallOrder[0],
      );
    });

    it('writes nothing when the read returned no lists', async () => {
      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockPatchExchangeState).not.toHaveBeenCalled();
    });

    it('still resolves with the balance result when the write fails, logging only its name', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockRunBalanceSync.mockResolvedValue({ syncedHoldings: 2, exchangeState: lists });
      mockPatchExchangeState.mockRejectedValueOnce(new Error('Failed query: params SECRET'));

      const result = await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(result).toEqual({ syncedHoldings: 2 });
      expect(warn).toHaveBeenCalledWith('[bybit sync] balance lists failed', {
        name: 'Error',
        code: undefined,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
      warn.mockRestore();
    });
  });

  describe('single-flight join over the whole Bybit arm', () => {
    it('runs the sync once when two overlapping triggers target the SAME account', async () => {
      const [first, second] = await Promise.all([
        runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' }),
        runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' }),
      ]);

      expect(first).toEqual(second);
      expect(mockRunBalanceSync).toHaveBeenCalledTimes(1);
    });

    it('runs independently for two DIFFERENT accounts', async () => {
      await Promise.all([
        runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' }),
        runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-2' }),
      ]);

      expect(mockRunBalanceSync).toHaveBeenCalledTimes(2);
    });

    it('releases the join after settling, so a later sync runs fresh', async () => {
      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });
      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockRunBalanceSync).toHaveBeenCalledTimes(2);
    });

    it('releases the join after a failure, so a later sync runs fresh', async () => {
      mockRunBalanceSync.mockRejectedValueOnce(new Error('read boom'));

      await expect(
        runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' }),
      ).rejects.toThrow('read boom');
      await runCryptoSync({ providerId: 'bybit', targetAccountId: 'acc-1' });

      expect(mockRunBalanceSync).toHaveBeenCalledTimes(2);
    });
  });
});
