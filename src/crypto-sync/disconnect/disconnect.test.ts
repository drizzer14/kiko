const mockDisconnectAccount = jest.fn(async (_id: string) => {});
const mockClearCredentials = jest.fn(async (_id: string) => {});

jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { disconnect: (id: string) => mockDisconnectAccount(id) },
}));
jest.mock('../binance/binance.credentials', () => ({
  clearCredentials: (id: string) => mockClearCredentials(id),
}));

import { disconnectCryptoAccount } from './disconnect';

describe('disconnectCryptoAccount', () => {
  beforeEach(() => {
    mockDisconnectAccount.mockClear();
    mockClearCredentials.mockClear();
  });

  it('for Binance, runs the DB disconnect first and then clears the Keychain credentials', async () => {
    const order: string[] = [];
    mockDisconnectAccount.mockImplementation(async () => {
      order.push('db');
    });
    mockClearCredentials.mockImplementation(async () => {
      order.push('keychain');
    });

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(mockDisconnectAccount).toHaveBeenCalledWith('acc-1');
    // The per-account Keychain item is cleared by the account id, so one Binance
    // connection's disconnect never touches another's credentials.
    expect(mockClearCredentials).toHaveBeenCalledWith('acc-1');
    expect(order).toEqual(['db', 'keychain']);
  });

  it('for a wallet, runs only the DB disconnect — there is no secret to clear', async () => {
    await disconnectCryptoAccount('acc-1', 'btc_wallet');

    expect(mockDisconnectAccount).toHaveBeenCalledWith('acc-1');
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });

  it('does not clear the credentials if the DB disconnect fails', async () => {
    mockDisconnectAccount.mockRejectedValueOnce(new Error('db boom'));

    await expect(disconnectCryptoAccount('acc-1', 'binance')).rejects.toThrow('db boom');
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });
});
