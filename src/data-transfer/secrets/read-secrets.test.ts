const mockReadDbKey = jest.fn();
jest.mock('../../db/keys/db-key', () => ({ readDbKey: () => mockReadDbKey() }));

const mockReadToken = jest.fn();
jest.mock('../../monobank/token', () => ({ readToken: (id: string) => mockReadToken(id) }));

const mockReadCredentials = jest.fn();
jest.mock('../../crypto-sync/binance/binance.credentials', () => ({
  readCredentials: (id: string) => mockReadCredentials(id),
}));

import type { AccountRow } from '../../db/schema';

import { readExportSecrets } from './read-secrets';

const account = (id: string, institution: AccountRow['institution']): AccountRow =>
  ({ id, institution }) as AccountRow;

describe('readExportSecrets', () => {
  it('reads the DB key and every connected Monobank token / Binance credential, skipping accounts with none stored', async () => {
    mockReadDbKey.mockResolvedValue('deadbeef'.repeat(8));
    mockReadToken.mockImplementation((id: string) =>
      Promise.resolve(id === 'mono1' ? 'mono-token' : undefined),
    );
    mockReadCredentials.mockImplementation((id: string) =>
      Promise.resolve(id === 'bin1' ? { apiKey: 'k', secret: 's' } : undefined),
    );

    const secrets = await readExportSecrets([
      account('mono1', 'monobank'),
      account('mono2', 'monobank'),
      account('bin1', 'binance'),
      account('cash1', null),
    ]);

    expect(secrets.dbKeyHex).toBe('deadbeef'.repeat(8));
    expect(secrets.monobankTokens).toEqual([{ accountId: 'mono1', token: 'mono-token' }]);
    expect(secrets.binanceCredentials).toEqual([{ accountId: 'bin1', apiKey: 'k', secret: 's' }]);
  });

  it('never reads a token/credential for a non-monobank/non-binance account', async () => {
    mockReadDbKey.mockResolvedValue(undefined);

    await readExportSecrets([account('privat1', 'privatbank')]);

    expect(mockReadToken).not.toHaveBeenCalled();
    expect(mockReadCredentials).not.toHaveBeenCalled();
  });
});
