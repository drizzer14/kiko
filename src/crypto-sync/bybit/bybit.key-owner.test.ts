import { signQuery } from '@kiko/crypto-sync/exchange/signing';

import { keyOwnerValueOf, readStoredKeyOwner } from './bybit.key-owner';

const mockGetQuery = jest.fn();

jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: { getQuery: (...args: unknown[]) => mockGetQuery(...args) },
}));

const USER_ID = '987654321';

describe('keyOwnerValueOf, O93', () => {
  it('is the HMAC of the user id under the account id, as the sync writes it', () => {
    expect(keyOwnerValueOf('account-1', USER_ID)).toBe(signQuery('account-1', USER_ID));
    expect(keyOwnerValueOf('account-1', USER_ID)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('holds no part of the user id', () => {
    expect(keyOwnerValueOf('account-1', USER_ID)).not.toContain(USER_ID);
  });

  it('differs for another user id, and for another account of the same user id', () => {
    const value = keyOwnerValueOf('account-1', USER_ID);

    expect(keyOwnerValueOf('account-1', '987654322')).not.toBe(value);
    expect(keyOwnerValueOf('account-2', USER_ID)).not.toBe(value);
  });
});

describe('readStoredKeyOwner, O93', () => {
  beforeEach(() => {
    mockGetQuery.mockReset();
  });

  it('reads the value the account stores, from its own row', async () => {
    mockGetQuery.mockResolvedValue([
      { exchangeState: JSON.stringify({ version: 1, walks: {}, keyOwner: 'stored-value' }) },
    ]);

    await expect(readStoredKeyOwner('account-1')).resolves.toBe('stored-value');
    expect(mockGetQuery).toHaveBeenCalledWith('account-1');
  });

  it.each([
    ['no state row', []],
    ['a column nothing wrote', [{ exchangeState: null }]],
    ['a state with no value', [{ exchangeState: JSON.stringify({ version: 1, walks: {} }) }]],
    [
      'a value that is no text',
      [{ exchangeState: JSON.stringify({ version: 1, walks: {}, keyOwner: 7 }) }],
    ],
    [
      'a state whose top level is malformed',
      [{ exchangeState: '{"version":2,"walks":{},"keyOwner":"stored-value"}' }],
    ],
    ['a text that is no JSON', [{ exchangeState: 'not json' }]],
  ])('reads none for %s, so the next connect passes', async (_title, rows) => {
    mockGetQuery.mockResolvedValue(rows);

    await expect(readStoredKeyOwner('account-1')).resolves.toBeUndefined();
  });

  it('lets a failed read of the state reject, for the caller to refuse on', async () => {
    mockGetQuery.mockRejectedValue(new Error('database is locked'));

    await expect(readStoredKeyOwner('account-1')).rejects.toThrow('database is locked');
  });
});
