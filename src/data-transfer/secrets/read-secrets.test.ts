const mockReadToken = jest.fn();
jest.mock('@kiko/monobank/token', () => ({ readToken: (id: string) => mockReadToken(id) }));

const mockReadCredentials = jest.fn();
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  readCredentials: (id: string) => mockReadCredentials(id),
}));

const mockReadEodhdKey = jest.fn();
jest.mock('@kiko/prices/eodhd-key/eodhd-key', () => ({ readEodhdKey: () => mockReadEodhdKey() }));

import type { AccountRow } from '@kiko/db';

import { readExportSecrets } from './read-secrets';

const account = (id: string, institution: AccountRow['institution']): AccountRow =>
  ({ id, institution }) as AccountRow;

describe('readExportSecrets', () => {
  it('reads every connected Monobank token / Binance credential, skipping accounts with none stored, and carries no DB key', async () => {
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

    expect(secrets).not.toHaveProperty('dbKeyHex');
    expect(secrets.monobankTokens).toEqual([{ accountId: 'mono1', token: 'mono-token' }]);
    expect(secrets.binanceCredentials).toEqual([{ accountId: 'bin1', apiKey: 'k', secret: 's' }]);
  });

  it('adds the saved EODHD key, which belongs to no account', async () => {
    mockReadEodhdKey.mockResolvedValue('fake-eodhd-key-0000');

    const secrets = await readExportSecrets([]);

    expect(secrets.eodhdKey).toBe('fake-eodhd-key-0000');
  });

  it('leaves the EODHD key out when none is saved', async () => {
    mockReadEodhdKey.mockResolvedValue(undefined);

    const secrets = await readExportSecrets([account('cash1', null)]);

    expect(secrets).not.toHaveProperty('eodhdKey');
  });

  it('never reads a token/credential for a non-monobank/non-binance account', async () => {
    await readExportSecrets([account('privat1', 'privatbank')]);

    expect(mockReadToken).not.toHaveBeenCalled();
    expect(mockReadCredentials).not.toHaveBeenCalled();
  });
});
