const mockSaveToken = jest.fn();
jest.mock('../../monobank/token', () => ({
  saveToken: (id: string, token: string) => mockSaveToken(id, token),
}));

const mockSaveCredentials = jest.fn();
jest.mock('../../crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (id: string, creds: unknown) => mockSaveCredentials(id, creds),
}));

// Mocked defensively even though `restore-secrets.ts` must never import this
// module at all — if a future edit adds a `storeDbKey(...)` call, THIS mock
// is what makes the "never restores the DB key" test below able to fail.
const mockStoreDbKey = jest.fn();
jest.mock('../../db/keys/db-key', () => ({ storeDbKey: (key: string) => mockStoreDbKey(key) }));

import type { ExportSecrets } from '../payload';

import { restoreExportSecrets } from './restore-secrets';

describe('restoreExportSecrets', () => {
  it('restores every Monobank token and Binance credential to its ORIGINAL account id', async () => {
    await restoreExportSecrets({
      monobankTokens: [{ accountId: 'a1', token: 'mono-token' }],
      binanceCredentials: [{ accountId: 'a2', apiKey: 'k', secret: 's' }],
    });

    expect(mockSaveToken).toHaveBeenCalledWith('a1', 'mono-token');
    expect(mockSaveCredentials).toHaveBeenCalledWith('a2', { apiKey: 'k', secret: 's' });
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

    await restoreExportSecrets(legacySecrets);

    expect(mockStoreDbKey).not.toHaveBeenCalled();
  });

  it('is a no-op for an undefined secrets block (the export was made with the toggle off)', async () => {
    await restoreExportSecrets(undefined);

    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });
});
