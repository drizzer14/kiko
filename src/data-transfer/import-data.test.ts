const mockReadFile = jest.fn();
jest.mock('react-native-fs', () => ({ readFile: (...args: unknown[]) => mockReadFile(...args) }));

const mockRestoreDataSnapshot = jest.fn();
jest.mock('./snapshot/restore-snapshot', () => ({
  restoreDataSnapshot: (snapshot: unknown) => mockRestoreDataSnapshot(snapshot),
}));

const mockRestoreExportSecrets = jest.fn();
jest.mock('./secrets/restore-secrets', () => ({
  restoreExportSecrets: (secrets: unknown) => mockRestoreExportSecrets(secrets),
}));

import { utf8ToBytes } from '@noble/ciphers/utils.js';

import { encodeBytesToBase64 } from './base64/base64';
import { encryptEnvelope } from './crypto/envelope';
import { generateExportKey } from './crypto/generate-key';
import { importData } from './import-data';

const payload = {
  exportedAt: 1,
  appVersion: '1.1.0',
  tables: {
    accounts: [{ id: 'a1' }],
    holdings: [{ id: 'h1' }],
    transactions: [{ id: 't1' }],
    currencyRates: [],
    currencyRateHistory: [],
    settings: [],
    syncState: [],
    categories: [],
    categoryOverrides: [],
  },
};

const encryptedFixture = (): { fileText: string; keyBase64: string } => {
  const key = generateExportKey();
  const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(payload)), key);
  return { fileText: JSON.stringify(envelope), keyBase64: encodeBytesToBase64(key) };
};

describe('importData', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockRestoreDataSnapshot.mockReset().mockResolvedValue(undefined);
    mockRestoreExportSecrets.mockReset().mockResolvedValue(undefined);
  });

  it('decrypts a valid file, restores the snapshot and secrets, and returns row counts', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    const summary = await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(mockRestoreDataSnapshot).toHaveBeenCalledWith(payload.tables);
    expect(mockRestoreExportSecrets).toHaveBeenCalledWith(undefined);
    expect(summary).toEqual({ accountsRestored: 1, holdingsRestored: 1, transactionsRestored: 1 });
  });

  it('throws a decrypt-prefixed error on the wrong key and never restores anything', async () => {
    const { fileText } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    const wrongKey = encodeBytesToBase64(generateExportKey());

    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64: wrongKey })).rejects.toThrow(
      'data-transfer/decrypt',
    );
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });

  it('throws a decrypt-prefixed error on a tampered file and never restores anything', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    const envelope = JSON.parse(fileText) as { ciphertext: string };
    const tamperedSuffix = envelope.ciphertext.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA';
    const tampered = {
      ...envelope,
      ciphertext: `${envelope.ciphertext.slice(0, -4)}${tamperedSuffix}`,
    };
    mockReadFile.mockResolvedValue(JSON.stringify(tampered));

    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64 })).rejects.toThrow(
      'data-transfer/decrypt',
    );
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });

  it('throws an import-prefixed error on unparseable JSON', async () => {
    mockReadFile.mockResolvedValue('not json');

    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64: 'anything' })).rejects.toThrow(
      'data-transfer/import',
    );
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });

  it('throws an import-prefixed error on a valid-JSON file with the wrong header', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ version: 99, format: 'not-kiko', nonce: '', ciphertext: '' }),
    );

    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64: 'anything' })).rejects.toThrow(
      'data-transfer/import',
    );
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });

  it('throws an import-prefixed error on a decrypted payload missing a required table and never restores anything', async () => {
    const key = generateExportKey();
    const malformedPayload = {
      exportedAt: 1,
      appVersion: '1.1.0',
      tables: { accounts: [], holdings: [] },
    };
    const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(malformedPayload)), key);
    mockReadFile.mockResolvedValue(JSON.stringify(envelope));

    await expect(
      importData({ fileUri: '/tmp/x.kiko', keyBase64: encodeBytesToBase64(key) }),
    ).rejects.toThrow('data-transfer/import');
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });

  it('throws a decrypt-prefixed error on a garbled keyBase64 and never restores anything', async () => {
    const { fileText } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    await expect(
      importData({ fileUri: '/tmp/x.kiko', keyBase64: '!!!not-base64!!!' }),
    ).rejects.toThrow('data-transfer/decrypt');
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });
});
