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

// The first-add refresh trigger (kiko-architecture): an import bulk-inserts
// holdings directly, bypassing the sync fan-out that normally triggers a
// rate/metal refresh — so a restored foreign-currency/metal/crypto holding
// needs the SAME gated refresh triggered explicitly, right here.
const mockRefreshRates = jest.fn().mockResolvedValue(undefined);
const mockRefreshMetalPrices = jest.fn().mockResolvedValue(undefined);
jest.mock('../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
}));
jest.mock('../prices/metal-refresh', () => ({
  refreshMetalPrices: (...args: unknown[]) => mockRefreshMetalPrices(...args),
}));

import { utf8ToBytes } from '@noble/ciphers/utils.js';

import { importData } from './import-data';
import { encryptEnvelope } from './crypto/envelope';
import { encodeBytesToBase64 } from './base64/base64';
import { generateExportKey } from './crypto/generate-key';

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
    mockRefreshRates.mockClear();
    mockRefreshMetalPrices.mockClear();
  });

  it('decrypts a valid file, restores the snapshot and secrets, and returns row counts', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    const summary = await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(mockRestoreDataSnapshot).toHaveBeenCalledWith(payload.tables);
    expect(mockRestoreExportSecrets).toHaveBeenCalledWith(undefined);
    expect(summary).toEqual({
      accountsRestored: 1,
      holdingsRestored: 1,
      transactionsRestored: 1,
      languageRestored: null,
    });
  });

  // kiko-architecture: a restored foreign-currency/metal/crypto holding needs
  // its price/rate visible without an app restart — an import bulk-inserts
  // directly, bypassing the sync fan-out that normally triggers this.
  it('triggers the gated rate/metal refresh after a successful restore', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(mockRefreshRates).toHaveBeenCalled();
    expect(mockRefreshMetalPrices).toHaveBeenCalled();
  });

  // The refresh is a background nicety, not an import precondition —
  // `importData` must resolve with its row-count summary without sitting on
  // the network, even while the refresh is still pending.
  it('resolves with the row-count summary without waiting for the refresh to settle', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    let resolveRefresh: () => void = () => {};
    mockRefreshRates.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveRefresh = () => resolve(undefined);
        }),
    );

    const summary = await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(summary).toEqual({
      accountsRestored: 1,
      holdingsRestored: 1,
      transactionsRestored: 1,
      languageRestored: null,
    });

    resolveRefresh();
  });

  // The success alert is built from `t()` right after `importData` resolves
  // (import-data.screen.tsx `runImport`) — if the imported settings row
  // carries a different language, the caller needs it BEFORE building that
  // alert so it can switch i18n first. See the file header comment.
  it('returns the imported settings row language as languageRestored', async () => {
    const key = generateExportKey();
    const payloadWithLanguage = {
      ...payload,
      tables: { ...payload.tables, settings: [{ id: 1, language: 'uk' }] },
    };
    const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(payloadWithLanguage)), key);
    mockReadFile.mockResolvedValue(JSON.stringify(envelope));

    const summary = await importData({
      fileUri: '/tmp/x.kiko',
      keyBase64: encodeBytesToBase64(key),
    });

    expect(summary.languageRestored).toBe('uk');
  });

  // The document picker / `keepLocalCopy` hand back a percent-encoded
  // `file://…` URI, but `RNFS.readFile` wants a plain filesystem path —
  // handed the URI literally, the real module throws and every import fails
  // as "invalid file". Assert the scheme is stripped and the rest
  // percent-decoded before `RNFS.readFile` is ever called.
  it('reads a percent-encoded file:// uri as a decoded, scheme-less path', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    await importData({
      fileUri: 'file:///var/mobile/Containers/Data/tmp/kiko%20export.kiko',
      keyBase64,
    });

    expect(mockReadFile).toHaveBeenCalledWith(
      '/var/mobile/Containers/Data/tmp/kiko export.kiko',
      'utf8',
    );
  });

  it('passes a plain, scheme-less path through unchanged', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(mockReadFile).toHaveBeenCalledWith('/tmp/x.kiko', 'utf8');
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
