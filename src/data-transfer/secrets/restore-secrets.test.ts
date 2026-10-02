const mockSaveToken = jest.fn();
jest.mock('@kiko/monobank/token', () => ({
  saveToken: (id: string, token: string) => mockSaveToken(id, token),
}));

const mockSaveCredentials = jest.fn();
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (id: string, creds: unknown) => mockSaveCredentials(id, creds),
}));

const mockSaveEodhdKey = jest.fn();
jest.mock('@kiko/prices/eodhd-key/eodhd-key', () => ({
  saveEodhdKey: (key: string) => mockSaveEodhdKey(key),
}));

// The quota a restored key starts with is pinned against real SQLite in
// `restore-secrets.quote-quota.test.ts`.
const mockUpdateQuoteQuota = jest.fn();
jest.mock('@kiko/settings', () => ({
  settingsRepo: { updateQuoteQuota: (build: unknown) => mockUpdateQuoteQuota(build) },
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
    mockSaveEodhdKey.mockReset().mockResolvedValue(undefined);
    mockUpdateQuoteQuota.mockReset().mockResolvedValue(undefined);
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
    expect(mockSaveEodhdKey).not.toHaveBeenCalled();
  });

  it('restores the EODHD key to the Keychain', async () => {
    await restoreExportSecrets(
      { monobankTokens: [], binanceCredentials: [], eodhdKey: 'fake-eodhd-key-0000' },
      ACCOUNT_IDS,
    );

    expect(mockSaveEodhdKey).toHaveBeenCalledWith('fake-eodhd-key-0000');
  });

  it('restores an export made before the EODHD key existed without writing one', async () => {
    await expect(
      restoreExportSecrets(
        {
          monobankTokens: [{ accountId: 'a1', token: 'mono-token' }],
          binanceCredentials: [],
        },
        ACCOUNT_IDS,
      ),
    ).resolves.toEqual([]);

    expect(mockSaveToken).toHaveBeenCalledWith('a1', 'mono-token');
    expect(mockSaveEodhdKey).not.toHaveBeenCalled();
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
          eodhdKey: 'fake-eodhd-key-0000',
        },
        ACCOUNT_IDS,
      );

      expect(unrestored).toEqual(['monobank']);
      expect(mockSaveToken).toHaveBeenCalledTimes(2);
      expect(mockSaveCredentials).toHaveBeenCalledTimes(1);
      expect(mockSaveEodhdKey).toHaveBeenCalledTimes(1);
    });

    it('names every failed connection once, in the order Monobank, Binance, EODHD', async () => {
      mockSaveToken.mockRejectedValue(new Error('keychain write failed'));
      mockSaveCredentials.mockRejectedValue(new Error('keychain write failed'));
      mockSaveEodhdKey.mockRejectedValue(new Error('keychain write failed'));

      const unrestored = await restoreExportSecrets(
        {
          monobankTokens: [
            { accountId: 'a1', token: 'first' },
            { accountId: 'a2', token: 'second' },
          ],
          binanceCredentials: [{ accountId: 'a1', apiKey: 'k', secret: 's' }],
          eodhdKey: 'fake-eodhd-key-0000',
        },
        ACCOUNT_IDS,
      );

      expect(unrestored).toEqual(['monobank', 'binance', 'eodhd']);
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

    it('does not mark the EODHD key as new when it was never stored', async () => {
      mockSaveEodhdKey.mockRejectedValue(new Error('keychain write failed'));

      const unrestored = await restoreExportSecrets(
        { eodhdKey: 'fake-eodhd-key-0000' },
        ACCOUNT_IDS,
      );

      expect(unrestored).toEqual(['eodhd']);
      expect(mockUpdateQuoteQuota).not.toHaveBeenCalled();
    });

    it('names the EODHD key when its quota write fails after the key was stored', async () => {
      mockUpdateQuoteQuota.mockRejectedValue(new Error('database is locked'));

      const unrestored = await restoreExportSecrets(
        { eodhdKey: 'fake-eodhd-key-0000' },
        ACCOUNT_IDS,
      );

      expect(unrestored).toEqual(['eodhd']);
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
