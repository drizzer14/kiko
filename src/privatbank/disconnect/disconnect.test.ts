const mockDisconnect = jest.fn();
const mockClearCredentials = jest.fn();

jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { disconnect: (...args: unknown[]) => mockDisconnect(...args) },
}));
jest.mock('../credentials', () => ({
  clearCredentials: (...args: unknown[]) => mockClearCredentials(...args),
}));

import { disconnectPrivatbank } from './disconnect';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('disconnectPrivatbank', () => {
  it('disconnects the account, then clears its PrivatBank credentials', async () => {
    const calls: string[] = [];
    mockDisconnect.mockImplementation(async () => {
      calls.push('disconnect');
    });
    mockClearCredentials.mockImplementation(async () => {
      calls.push('clearCredentials');
    });

    await disconnectPrivatbank('acc-1');

    expect(mockDisconnect).toHaveBeenCalledWith('acc-1');
    expect(mockClearCredentials).toHaveBeenCalledWith('acc-1');
    // The DB write commits BEFORE the Keychain item is cleared, mirroring
    // `disconnectMonobank` — a failed DB write must leave credentials intact.
    expect(calls).toEqual(['disconnect', 'clearCredentials']);
  });
});
