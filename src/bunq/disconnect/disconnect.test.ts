const mockDisconnect = jest.fn();
const mockClearCredentials = jest.fn();

jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { disconnect: (...args: unknown[]) => mockDisconnect(...args) },
}));
jest.mock('../credentials', () => ({
  clearCredentials: (...args: unknown[]) => mockClearCredentials(...args),
}));

import { disconnectBunq } from './disconnect';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('disconnectBunq', () => {
  it('disconnects the account, then clears its bunq credentials', async () => {
    const calls: string[] = [];
    mockDisconnect.mockImplementation(async () => {
      calls.push('disconnect');
    });
    mockClearCredentials.mockImplementation(async () => {
      calls.push('clearCredentials');
    });

    await disconnectBunq('acc-1');

    expect(mockDisconnect).toHaveBeenCalledWith('acc-1');
    expect(mockClearCredentials).toHaveBeenCalledWith('acc-1');
    // The DB write commits BEFORE the Keychain items are cleared, mirroring
    // `disconnectPrivatbank` — a failed DB write must leave credentials intact.
    expect(calls).toEqual(['disconnect', 'clearCredentials']);
  });
});
