// A mutable backing value (not a plain literal) so a test can flip
// `TemporaryDirectoryPath`'s trailing-slash presence WITHOUT `jest.isolateModules`
// — the mock is one shared module instance across every test in this file, and
// the getter re-reads the variable on every access, matching how the real
// native constant is read once but could plausibly omit the slash on either OS
// version.
let mockTemporaryDirectoryPath = '/tmp/';
const mockWriteFile = jest.fn();
jest.mock('react-native-fs', () => ({
  get TemporaryDirectoryPath() {
    return mockTemporaryDirectoryPath;
  },
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

const mockReadDataSnapshot = jest.fn();
jest.mock('./snapshot/read-snapshot', () => ({ readDataSnapshot: () => mockReadDataSnapshot() }));

const mockReadExportSecrets = jest.fn();
jest.mock('./secrets/read-secrets', () => ({
  readExportSecrets: (accounts: unknown) => mockReadExportSecrets(accounts),
}));

import { utf8Decode } from './utf8/utf8';
import { exportData } from './export-data';
import type { ExportPayload } from './payload';
import { decryptEnvelope } from './crypto/envelope';
import { decodeBase64ToBytes } from './base64/base64';

const writtenPayload = (keyBase64: string): ExportPayload => {
  const [, contents] = mockWriteFile.mock.calls[0] as [string, string];

  return JSON.parse(
    utf8Decode(decryptEnvelope(JSON.parse(contents), decodeBase64ToBytes(keyBase64))),
  ) as ExportPayload;
};

const emptySnapshot = {
  accounts: [{ id: 'a1' }],
  holdings: [],
  transactions: [],
  currencyRates: [],
  currencyRateHistory: [],
  settings: [],
  syncState: [],
  categories: [],
  categoryOverrides: [],
};

describe('exportData', () => {
  beforeEach(() => {
    mockTemporaryDirectoryPath = '/tmp/';
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockReadDataSnapshot.mockReset().mockResolvedValue(emptySnapshot);
    mockReadExportSecrets
      .mockReset()
      .mockResolvedValue({ monobankTokens: [], binanceCredentials: [] });
  });

  it('writes an encrypted .kiko file and returns a base64 key, WITHOUT reading secrets when the toggle is off', async () => {
    const result = await exportData({ includeSecrets: false });

    expect(mockReadExportSecrets).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const [path, contents, encoding] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(path).toBe(result.fileUri);
    expect(path).toMatch(/^\/tmp\/kiko-export-\d+\.kiko$/);
    expect(encoding).toBe('utf8');

    const envelope = JSON.parse(contents) as {
      format: string;
      version: number;
      nonce: string;
      ciphertext: string;
    };
    expect(envelope.format).toBe('kiko-export');
    expect(envelope.version).toBe(1);
    expect(typeof envelope.nonce).toBe('string');
    expect(typeof envelope.ciphertext).toBe('string');

    // The key is never written into the file itself.
    expect(contents).not.toContain(result.keyBase64);
    expect(result.keyBase64.length).toBeGreaterThan(0);
  });

  it('reads secrets (keyed off the just-read accounts) when the toggle is on', async () => {
    mockReadExportSecrets.mockResolvedValue({
      monobankTokens: [{ accountId: 'a1', token: 'mono-token' }],
      binanceCredentials: [],
    });

    await exportData({ includeSecrets: true });

    expect(mockReadExportSecrets).toHaveBeenCalledWith(emptySnapshot.accounts);
  });

  it('writes the EODHD key into the encrypted file only when the toggle is on', async () => {
    mockReadExportSecrets.mockResolvedValue({
      monobankTokens: [],
      binanceCredentials: [],
      eodhdKey: 'fake-eodhd-key-0000',
    });

    const withSecrets = await exportData({ includeSecrets: true });

    expect(writtenPayload(withSecrets.keyBase64).secrets?.eodhdKey).toBe('fake-eodhd-key-0000');

    mockWriteFile.mockClear();
    const withoutSecrets = await exportData({ includeSecrets: false });

    expect(writtenPayload(withoutSecrets.keyBase64)).not.toHaveProperty('secrets');
    expect(mockWriteFile.mock.calls[0][1]).not.toContain('fake-eodhd-key-0000');
  });

  it('still joins a valid path when TemporaryDirectoryPath has NO trailing slash', async () => {
    // A bare `${dir}${file}` concatenation silently produces a malformed
    // path (no `/` separator) when the native constant omits the trailing
    // slash — a real cross-OS-version drift, not a hypothetical, and the
    // likely root cause of an on-device "Export does nothing" report: a
    // malformed path fails `writeFile` before any share sheet or key card
    // ever appears.
    mockTemporaryDirectoryPath = '/tmp';

    const result = await exportData({ includeSecrets: false });

    expect(result.fileUri).toMatch(/^\/tmp\/kiko-export-\d+\.kiko$/);
    expect(mockWriteFile).toHaveBeenCalledWith(result.fileUri, expect.any(String), 'utf8');
  });
});
