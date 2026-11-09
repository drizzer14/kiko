const mockReadToken = jest.fn();
jest.mock('@kiko/monobank/token', () => ({ readToken: (id: string) => mockReadToken(id) }));

const mockReadCredentials = jest.fn();
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  readCredentials: (id: string) => mockReadCredentials(id),
}));

const mockReadBybitCredentials = jest.fn();
jest.mock('@kiko/crypto-sync/bybit/bybit.credentials', () => ({
  readBybitCredentials: (id: string) => mockReadBybitCredentials(id),
}));

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

  it('never reads a token/credential for a non-monobank/non-binance account', async () => {
    await readExportSecrets([account('privat1', 'privatbank')]);

    expect(mockReadToken).not.toHaveBeenCalled();
    expect(mockReadCredentials).not.toHaveBeenCalled();
    expect(mockReadBybitCredentials).not.toHaveBeenCalled();
  });

  describe('a Bybit account', () => {
    beforeEach(() => {
      mockReadToken.mockReset();
      mockReadCredentials.mockReset();
      mockReadBybitCredentials.mockReset();
    });

    it('reads its pair from the Bybit service only, and lists it by its own account', async () => {
      mockReadBybitCredentials.mockImplementation((id: string) =>
        Promise.resolve(id === 'byb1' ? { apiKey: 'bybit-k', secret: 'bybit-s' } : undefined),
      );

      const secrets = await readExportSecrets([
        account('byb1', 'bybit'),
        account('byb2', 'bybit'),
        account('bin1', 'binance'),
      ]);

      expect(secrets.bybitCredentials).toEqual([
        { accountId: 'byb1', apiKey: 'bybit-k', secret: 'bybit-s' },
      ]);
      expect(mockReadBybitCredentials.mock.calls).toEqual([['byb1'], ['byb2']]);
      expect(mockReadCredentials.mock.calls).toEqual([['bin1']]);
      expect(mockReadToken).not.toHaveBeenCalled();
    });

    it('keeps a Binance user export identical, with an empty Bybit list and no Bybit read', async () => {
      mockReadCredentials.mockResolvedValue({ apiKey: 'k', secret: 's' });

      const secrets = await readExportSecrets([account('bin1', 'binance')]);

      expect(secrets).toEqual({
        monobankTokens: [],
        binanceCredentials: [{ accountId: 'bin1', apiKey: 'k', secret: 's' }],
        bybitCredentials: [],
      });
      expect(mockReadBybitCredentials).not.toHaveBeenCalled();
    });

    it('skips a Bybit account that is disconnected', async () => {
      mockReadBybitCredentials.mockResolvedValue(undefined);

      const secrets = await readExportSecrets([account('byb1', 'bybit')]);

      expect(secrets.bybitCredentials).toEqual([]);
    });
  });
});
