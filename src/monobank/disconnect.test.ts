const mockDisconnectAccount = jest.fn(async (_id: string) => {});
const mockClearToken = jest.fn(async () => {});

jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { disconnect: (id: string) => mockDisconnectAccount(id) },
}));
jest.mock('./token', () => ({ clearToken: () => mockClearToken() }));

import { disconnectMonobank } from './disconnect';

describe('disconnectMonobank', () => {
  beforeEach(() => {
    mockDisconnectAccount.mockClear();
    mockClearToken.mockClear();
  });

  it('runs the DB disconnect for the account, then clears the Keychain token', async () => {
    const order: string[] = [];
    mockDisconnectAccount.mockImplementation(async () => {
      order.push('db');
    });
    mockClearToken.mockImplementation(async () => {
      order.push('keychain');
    });

    await disconnectMonobank('acc-1');

    expect(mockDisconnectAccount).toHaveBeenCalledWith('acc-1');
    expect(mockClearToken).toHaveBeenCalledTimes(1);
    // The DB transaction must commit before the (non-transactional) Keychain clear.
    expect(order).toEqual(['db', 'keychain']);
  });

  it('does not clear the token if the DB disconnect fails', async () => {
    mockDisconnectAccount.mockRejectedValueOnce(new Error('db boom'));

    await expect(disconnectMonobank('acc-1')).rejects.toThrow('db boom');
    expect(mockClearToken).not.toHaveBeenCalled();
  });
});
