const mockDisconnectAccount = jest.fn(async (_id: string) => {});
const mockClearCredentials = jest.fn(async (_id: string) => {});
const mockResetBinanceWalkCursors = jest.fn(async (_id: string, _floorMs: number) => {});

jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { disconnect: (id: string) => mockDisconnectAccount(id) },
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  clearCredentials: (id: string) => mockClearCredentials(id),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    resetBinanceWalkCursors: (id: string, floorMs: number) =>
      mockResetBinanceWalkCursors(id, floorMs),
  },
}));

import { HISTORY_FLOOR_MS } from '@kiko/crypto-sync/binance';
import { withWalkOwnedMetadataResetToFloor } from '@kiko/holdings/holding-metadata';

import { disconnectCryptoAccount } from './disconnect';

describe('disconnectCryptoAccount', () => {
  beforeEach(() => {
    mockDisconnectAccount.mockClear();
    mockClearCredentials.mockClear();
    mockResetBinanceWalkCursors.mockClear();
  });

  it('for Binance, resets the history cursor to the floor, then the DB disconnect, then the Keychain credentials', async () => {
    const order: string[] = [];
    mockResetBinanceWalkCursors.mockImplementation(async () => {
      order.push('cursor');
    });
    mockDisconnectAccount.mockImplementation(async () => {
      order.push('db');
    });
    mockClearCredentials.mockImplementation(async () => {
      order.push('keychain');
    });

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(mockResetBinanceWalkCursors).toHaveBeenCalledWith('acc-1', HISTORY_FLOOR_MS);
    expect(mockDisconnectAccount).toHaveBeenCalledWith('acc-1');
    // The per-account Keychain item is cleared by the account id, so one Binance
    // connection's disconnect never touches another's credentials.
    expect(mockClearCredentials).toHaveBeenCalledWith('acc-1');
    expect(order).toEqual(['cursor', 'db', 'keychain']);
  });

  it('for Binance, resets the four Transfer walk keys of a Spot holding: cursors to the floor, the list to empty, no point cursor', async () => {
    let reset: Record<string, unknown> | undefined;
    mockResetBinanceWalkCursors.mockImplementation(async (_id, floorMs) => {
      reset = withWalkOwnedMetadataResetToFloor(
        {
          binanceAsset: 'BTC',
          binanceTransferHistoryCursor: 9_000,
          binanceTransferRescanCursor: 8_000,
          binanceTransferPendingOverlap: [
            { start: 5, end: 7, kind: 'point', series: 'MAIN_FUNDING' },
          ],
          binanceTransferPointCursor: 6,
        },
        floorMs,
      );
    });

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(reset).toEqual({
      binanceAsset: 'BTC',
      binanceTransferHistoryCursor: HISTORY_FLOOR_MS,
      binanceTransferRescanCursor: HISTORY_FLOOR_MS,
      binanceTransferPendingOverlap: [],
    });
  });

  it('for a wallet, runs only the DB disconnect — no cursor to reset, no secret to clear', async () => {
    await disconnectCryptoAccount('acc-1', 'btc_wallet');

    expect(mockResetBinanceWalkCursors).not.toHaveBeenCalled();
    expect(mockDisconnectAccount).toHaveBeenCalledWith('acc-1');
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });

  it('does not disconnect or clear the credentials if resetting the history cursor fails', async () => {
    mockResetBinanceWalkCursors.mockRejectedValueOnce(new Error('cursor boom'));

    await expect(disconnectCryptoAccount('acc-1', 'binance')).rejects.toThrow('cursor boom');
    expect(mockDisconnectAccount).not.toHaveBeenCalled();
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });

  it('does not clear the credentials if the DB disconnect fails', async () => {
    mockDisconnectAccount.mockRejectedValueOnce(new Error('db boom'));

    await expect(disconnectCryptoAccount('acc-1', 'binance')).rejects.toThrow('db boom');
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });
});
