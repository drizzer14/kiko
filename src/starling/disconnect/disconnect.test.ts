const mockDisconnect = jest.fn();
const mockClearToken = jest.fn();

jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { disconnect: (...args: unknown[]) => mockDisconnect(...args) },
}));
jest.mock('../token', () => ({
  clearToken: (...args: unknown[]) => mockClearToken(...args),
}));

import { disconnectStarling } from './disconnect';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('disconnectStarling', () => {
  it('disconnects the account, then clears its Starling token', async () => {
    const calls: string[] = [];
    mockDisconnect.mockImplementation(async () => {
      calls.push('disconnect');
    });
    mockClearToken.mockImplementation(async () => {
      calls.push('clearToken');
    });

    await disconnectStarling('acc-1');

    expect(mockDisconnect).toHaveBeenCalledWith('acc-1');
    expect(mockClearToken).toHaveBeenCalledWith('acc-1');
    // The DB write commits BEFORE the Keychain item is cleared, mirroring
    // `disconnectPrivatbank`/`disconnectMonobank` — a failed DB write must
    // leave the token intact.
    expect(calls).toEqual(['disconnect', 'clearToken']);
  });
});
