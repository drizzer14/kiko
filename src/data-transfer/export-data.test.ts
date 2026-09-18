const mockWriteFile = jest.fn();
jest.mock('react-native-fs', () => ({
  TemporaryDirectoryPath: '/tmp/',
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

const mockReadDataSnapshot = jest.fn();
jest.mock('./snapshot/read-snapshot', () => ({ readDataSnapshot: () => mockReadDataSnapshot() }));

const mockReadExportSecrets = jest.fn();
jest.mock('./secrets/read-secrets', () => ({
  readExportSecrets: (accounts: unknown) => mockReadExportSecrets(accounts),
}));

import { exportData } from './export-data';

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
      dbKeyHex: 'deadbeef'.repeat(8),
      monobankTokens: [{ accountId: 'a1', token: 'mono-token' }],
      binanceCredentials: [],
    });

    await exportData({ includeSecrets: true });

    expect(mockReadExportSecrets).toHaveBeenCalledWith(emptySnapshot.accounts);
  });
});
