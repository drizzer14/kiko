import { EXPORT_DB_FILE, SECRETS_FILE } from './migration-constants';

const HEX_KEY = 'ab'.repeat(32);
const RAW_KEY = `x'${HEX_KEY}'`;
const CONTAINER = '/private/var/mobile/Shared/AppGroup/UUID';
const EXPORT_PATH = `${CONTAINER}/${EXPORT_DB_FILE}`;
const SECRETS_PATH = `${CONTAINER}/${SECRETS_FILE}`;

const encExecute = jest.fn(async () => ({ rows: [], rowsAffected: 0 }));
const encClose = jest.fn();
const mockOpen = jest.fn((..._a: unknown[]) => ({ execute: encExecute, close: encClose }));
jest.mock('@op-engineering/op-sqlite', () => ({ open: (...a: unknown[]) => mockOpen(...a) }));

const mockReadDbKey = jest.fn<Promise<string | undefined>, []>();
jest.mock('../keys/db-key', () => ({
  readDbKey: () => mockReadDbKey(),
  toSQLCipherRawKey: (k: string) => `x'${k}'`,
}));

const mockBridge = {
  sharedContainerPath: jest.fn(async (..._a: unknown[]) => CONTAINER as string | null),
  fileExists: jest.fn(async (..._a: unknown[]) => false),
  deleteFile: jest.fn(async (..._a: unknown[]) => undefined),
  writeTextFile: jest.fn(async (..._a: unknown[]) => undefined),
};
// Forward through arrows so the factory (evaluated during the hoisted import
// of `export-for-new-app`, before `mockBridge` is assigned) reads the live
// object at call time rather than capturing its undefined initial value.
jest.mock('./migration-bridge', () => ({
  migrationBridge: {
    sharedContainerPath: (...a: unknown[]) => mockBridge.sharedContainerPath(...a),
    fileExists: (...a: unknown[]) => mockBridge.fileExists(...a),
    deleteFile: (...a: unknown[]) => mockBridge.deleteFile(...a),
    writeTextFile: (...a: unknown[]) => mockBridge.writeTextFile(...a),
  },
}));

const mockReadToken = jest.fn<Promise<string | undefined>, []>();
jest.mock('../../monobank/token', () => ({ readToken: () => mockReadToken() }));

const mockReadCredentials = jest.fn();
jest.mock('../../crypto-sync/binance/binance.credentials', () => ({
  readCredentials: () => mockReadCredentials(),
}));

import { exportForNewApp } from './export-for-new-app';

beforeEach(() => {
  jest.clearAllMocks();
  mockReadDbKey.mockResolvedValue(HEX_KEY);
  mockBridge.sharedContainerPath.mockResolvedValue(CONTAINER);
  mockBridge.fileExists.mockResolvedValue(false);
  mockReadToken.mockResolvedValue('mono-tok');
  mockReadCredentials.mockResolvedValue({ apiKey: 'AK', secret: 'SK' });
});

describe('exportForNewApp', () => {
  it('opens the encrypted DB with the Keychain key and runs the empty-key decrypt export', async () => {
    await exportForNewApp();

    expect(mockOpen).toHaveBeenCalledWith({ name: 'kiko-encrypted.db', encryptionKey: RAW_KEY });
    expect(encExecute.mock.calls).toEqual([
      ['ATTACH DATABASE ? AS plaintext_out KEY ?', [EXPORT_PATH, '']],
      ["SELECT sqlcipher_export('plaintext_out')"],
      ['DETACH DATABASE plaintext_out'],
    ]);
    expect(encClose).toHaveBeenCalledTimes(1);
  });

  it('deletes a stale export target AND its sidecars before writing a fresh one', async () => {
    await exportForNewApp();

    // The main file plus every SQLite sidecar, so a leftover -wal/-journal from
    // an aborted prior export cannot shadow the freshly-created target.
    expect(mockBridge.deleteFile).toHaveBeenCalledWith(EXPORT_PATH);
    expect(mockBridge.deleteFile).toHaveBeenCalledWith(`${EXPORT_PATH}-wal`);
    expect(mockBridge.deleteFile).toHaveBeenCalledWith(`${EXPORT_PATH}-shm`);
    expect(mockBridge.deleteFile).toHaveBeenCalledWith(`${EXPORT_PATH}-journal`);
  });

  it('writes both secrets as one JSON file, wallet address never included', async () => {
    await exportForNewApp();

    expect(mockBridge.writeTextFile).toHaveBeenCalledWith(
      JSON.stringify({
        monobankToken: 'mono-tok',
        binanceCredentials: { apiKey: 'AK', secret: 'SK' },
      }),
      SECRETS_PATH,
    );
  });

  it('serializes nulls when a secret is absent', async () => {
    mockReadToken.mockResolvedValue(undefined);
    mockReadCredentials.mockResolvedValue(undefined);

    await exportForNewApp();

    expect(mockBridge.writeTextFile).toHaveBeenCalledWith(
      JSON.stringify({ monobankToken: null, binanceCredentials: null }),
      SECRETS_PATH,
    );
  });

  it('throws when there is no DB key to open the encrypted database', async () => {
    mockReadDbKey.mockResolvedValue(undefined);

    await expect(exportForNewApp()).rejects.toThrow('no database key');
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('throws when the shared container is unavailable', async () => {
    mockBridge.sharedContainerPath.mockResolvedValue(null);

    await expect(exportForNewApp()).rejects.toThrow('shared container');
  });
});
