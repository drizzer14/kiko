const mockSaveToken = jest.fn();
jest.mock('@kiko/monobank/token', () => ({
  saveToken: (id: string, token: string) => mockSaveToken(id, token),
}));

const mockSaveCredentials = jest.fn();
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (id: string, creds: unknown) => mockSaveCredentials(id, creds),
}));

// Mocked defensively even though `restore-secrets.ts` must never import this
// module at all — if a future edit adds a `storeDbKey(...)` call, THIS mock
// is what makes the "never restores the DB key" test below able to fail.
const mockStoreDbKey = jest.fn();
jest.mock('@kiko/db/keys/db-key', () => ({ storeDbKey: (key: string) => mockStoreDbKey(key) }));

import type { ExportSecrets } from '../payload';

import { restoreExportSecrets } from './restore-secrets';

const ACCOUNT_IDS: ReadonlySet<string> = new Set(['a1', 'a2']);

describe('restoreExportSecrets', () => {
  beforeEach(() => {
    mockSaveToken.mockReset().mockResolvedValue(undefined);
    mockSaveCredentials.mockReset().mockResolvedValue(undefined);
    mockStoreDbKey.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('restores every Monobank token and Binance credential to its ORIGINAL account id', async () => {
    const unrestored = await restoreExportSecrets(
      {
        monobankTokens: [{ accountId: 'a1', token: 'mono-token' }],
        binanceCredentials: [{ accountId: 'a2', apiKey: 'k', secret: 's' }],
      },
      ACCOUNT_IDS,
    );

    expect(mockSaveToken).toHaveBeenCalledWith('a1', 'mono-token');
    expect(mockSaveCredentials).toHaveBeenCalledWith('a2', { apiKey: 'k', secret: 's' });
    expect(unrestored).toEqual([]);
  });

  it('NEVER writes the exported DB key to the Keychain, even for an old export that still carries one', async () => {
    // A file exported before `ExportSecrets` dropped its `dbKeyHex` field
    // still has it on disk; the cast models that legacy JSON shape arriving
    // at a current build's restore path.
    const legacySecrets = {
      dbKeyHex: 'deadbeef'.repeat(8),
      monobankTokens: [],
      binanceCredentials: [],
    } as unknown as ExportSecrets;

    await restoreExportSecrets(legacySecrets, ACCOUNT_IDS);

    expect(mockStoreDbKey).not.toHaveBeenCalled();
  });

  it('is a no-op for an undefined secrets block (the export was made with the toggle off)', async () => {
    await expect(restoreExportSecrets(undefined, ACCOUNT_IDS)).resolves.toEqual([]);

    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  it('ignores the removed share prices key an older export still carries, restoring the rest', async () => {
    // The cast models the legacy JSON shape: `ExportSecrets` no longer has the field.
    const olderSecrets = {
      monobankTokens: [{ accountId: 'a1', token: 'mono-token' }],
      binanceCredentials: [],
      eodhdKey: 'fake-eodhd-key-0000',
    } as unknown as ExportSecrets;

    await expect(restoreExportSecrets(olderSecrets, ACCOUNT_IDS)).resolves.toEqual([]);

    expect(mockSaveToken).toHaveBeenCalledWith('a1', 'mono-token');
    expect(mockSaveToken).toHaveBeenCalledTimes(1);
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  it.each([
    ['both arrays missing', {}],
    ['both arrays empty', { monobankTokens: [], binanceCredentials: [] }],
    ['a missing Binance array', { monobankTokens: [] }],
  ])('writes nothing for %s', async (_name, secrets) => {
    await expect(restoreExportSecrets(secrets, ACCOUNT_IDS)).resolves.toEqual([]);

    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  it('drops a secret whose account the file does not carry, and restores the rest', async () => {
    const unrestored = await restoreExportSecrets(
      {
        monobankTokens: [
          { accountId: 'ghost', token: 'ghost-token' },
          { accountId: 'a1', token: 'mono-token' },
        ],
        binanceCredentials: [{ accountId: 'ghost', apiKey: 'k', secret: 's' }],
      },
      ACCOUNT_IDS,
    );

    expect(mockSaveToken).toHaveBeenCalledTimes(1);
    expect(mockSaveToken).toHaveBeenCalledWith('a1', 'mono-token');
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(unrestored).toEqual([]);
  });

  describe('when a Keychain write fails', () => {
    it('names the connection and still writes every other secret', async () => {
      mockSaveToken.mockRejectedValueOnce(new Error('keychain write failed'));

      const unrestored = await restoreExportSecrets(
        {
          monobankTokens: [
            { accountId: 'a1', token: 'first' },
            { accountId: 'a2', token: 'second' },
          ],
          binanceCredentials: [{ accountId: 'a1', apiKey: 'k', secret: 's' }],
        },
        ACCOUNT_IDS,
      );

      expect(unrestored).toEqual(['monobank']);
      expect(mockSaveToken).toHaveBeenCalledTimes(2);
      expect(mockSaveCredentials).toHaveBeenCalledTimes(1);
    });

    it('names every failed connection once, in the order Monobank, Binance', async () => {
      mockSaveToken.mockRejectedValue(new Error('keychain write failed'));
      mockSaveCredentials.mockRejectedValue(new Error('keychain write failed'));

      const unrestored = await restoreExportSecrets(
        {
          monobankTokens: [
            { accountId: 'a1', token: 'first' },
            { accountId: 'a2', token: 'second' },
          ],
          binanceCredentials: [{ accountId: 'a1', apiKey: 'k', secret: 's' }],
        },
        ACCOUNT_IDS,
      );

      expect(unrestored).toEqual(['monobank', 'binance']);
    });

    it('treats a write that throws before it returns a promise the same way', async () => {
      mockSaveCredentials.mockImplementation(() => {
        throw new Error('keychain write failed');
      });

      await expect(
        restoreExportSecrets(
          { binanceCredentials: [{ accountId: 'a1', apiKey: 'k', secret: 's' }] },
          ACCOUNT_IDS,
        ),
      ).resolves.toEqual(['binance']);
    });

    it('never logs a secret', async () => {
      mockSaveToken.mockRejectedValue(new Error('secret mono-token leaked'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await restoreExportSecrets(
        { monobankTokens: [{ accountId: 'a1', token: 'mono-token' }] },
        ACCOUNT_IDS,
      );

      expect(JSON.stringify(warn.mock.calls)).not.toContain('mono-token');
    });
  });
});
