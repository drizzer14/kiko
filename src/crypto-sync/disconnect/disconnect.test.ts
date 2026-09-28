const mockDisconnectAccount = jest.fn(async (_id: string) => {});
const mockClearCredentials = jest.fn(async (_id: string) => {});
const mockClearBinanceHistoryCursor = jest.fn(async (_id: string) => {});

jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { disconnect: (id: string) => mockDisconnectAccount(id) },
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  clearCredentials: (id: string) => mockClearCredentials(id),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { clearBinanceHistoryCursor: (id: string) => mockClearBinanceHistoryCursor(id) },
}));

import { disconnectCryptoAccount } from './disconnect';

describe('disconnectCryptoAccount', () => {
  beforeEach(() => {
    mockDisconnectAccount.mockClear();
    mockClearCredentials.mockClear();
    mockClearBinanceHistoryCursor.mockClear();
  });

  it('for Binance, clears the history cursor, then the DB disconnect, then the Keychain credentials', async () => {
    const order: string[] = [];
    mockClearBinanceHistoryCursor.mockImplementation(async () => {
      order.push('cursor');
    });
    mockDisconnectAccount.mockImplementation(async () => {
      order.push('db');
    });
    mockClearCredentials.mockImplementation(async () => {
      order.push('keychain');
    });

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(mockClearBinanceHistoryCursor).toHaveBeenCalledWith('acc-1');
    expect(mockDisconnectAccount).toHaveBeenCalledWith('acc-1');
    // The per-account Keychain item is cleared by the account id, so one Binance
    // connection's disconnect never touches another's credentials.
    expect(mockClearCredentials).toHaveBeenCalledWith('acc-1');
    expect(order).toEqual(['cursor', 'db', 'keychain']);
  });

  it('for a wallet, runs only the DB disconnect — no cursor to clear, no secret to clear', async () => {
    await disconnectCryptoAccount('acc-1', 'btc_wallet');

    expect(mockClearBinanceHistoryCursor).not.toHaveBeenCalled();
    expect(mockDisconnectAccount).toHaveBeenCalledWith('acc-1');
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });

  it('does not disconnect or clear the credentials if clearing the history cursor fails', async () => {
    mockClearBinanceHistoryCursor.mockRejectedValueOnce(new Error('cursor boom'));

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
