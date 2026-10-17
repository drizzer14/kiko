const mockDisconnectAccount = jest.fn(async (_id: string) => {});
const mockDisconnectExchange = jest.fn(
  async (_id: string, _exchangeId: string, _floorMs: number) => {},
);
const mockClearCredentials = jest.fn(async (_id: string) => {});

jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    disconnect: (id: string) => mockDisconnectAccount(id),
    disconnectExchange: (id: string, exchangeId: string, floorMs: number) =>
      mockDisconnectExchange(id, exchangeId, floorMs),
  },
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  clearCredentials: (id: string) => mockClearCredentials(id),
}));

import { HISTORY_FLOOR_MS } from '@kiko/crypto-sync/binance';

import { disconnectCryptoAccount } from './disconnect';

describe('disconnectCryptoAccount', () => {
  beforeEach(() => {
    mockDisconnectAccount.mockReset();
    mockDisconnectExchange.mockReset();
    mockClearCredentials.mockReset();
  });

  it('for Binance, resets the walk state and disconnects in one write, then clears the key', async () => {
    const order: string[] = [];
    mockDisconnectExchange.mockImplementation(async () => {
      order.push('db');
    });
    mockClearCredentials.mockImplementation(async () => {
      order.push('keychain');
    });

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(mockDisconnectExchange).toHaveBeenCalledWith('acc-1', 'binance', HISTORY_FLOOR_MS);
    // The per-account Keychain item is cleared by the account id, so one Binance
    // connection's disconnect never touches another's credentials.
    expect(mockClearCredentials).toHaveBeenCalledWith('acc-1');
    expect(order).toEqual(['db', 'keychain']);
    expect(mockDisconnectAccount).not.toHaveBeenCalled();
  });

  it('for a wallet, runs only the DB disconnect: no walk state to reset, no secret to clear', async () => {
    await disconnectCryptoAccount('acc-1', 'btc_wallet');

    expect(mockDisconnectAccount).toHaveBeenCalledWith('acc-1');
    expect(mockDisconnectExchange).not.toHaveBeenCalled();
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });

  it('does not clear the credentials if resetting the walk state and disconnecting fails', async () => {
    mockDisconnectExchange.mockRejectedValueOnce(new Error('db boom'));

    await expect(disconnectCryptoAccount('acc-1', 'binance')).rejects.toThrow('db boom');
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });
});
