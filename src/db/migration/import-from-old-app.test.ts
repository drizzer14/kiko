import { EXPORT_DB_FILE, SECRETS_FILE } from './migration-constants';

const CONTAINER = '/private/var/mobile/Shared/AppGroup/UUID';
const EXPORT_PATH = `${CONTAINER}/${EXPORT_DB_FILE}`;
const SECRETS_PATH = `${CONTAINER}/${SECRETS_FILE}`;
const LIVE_PATH = '/var/mobile/Containers/Data/Application/APP/Library/kiko.db';

const tmpClose = jest.fn();
const tmpDelete = jest.fn();
const mockOpen = jest.fn(() => ({
  getDbPath: () => LIVE_PATH,
  close: tmpClose,
  delete: tmpDelete,
}));
jest.mock('@op-engineering/op-sqlite', () => ({ open: (...a: unknown[]) => mockOpen(...a) }));

const mockResetDbKey = jest.fn(async () => undefined);
jest.mock('../keys/db-key', () => ({ resetDbKey: () => mockResetDbKey() }));

const mockBridge = {
  sharedContainerPath: jest.fn(async () => CONTAINER as string | null),
  fileExists: jest.fn(async () => true),
  copyFile: jest.fn(async () => undefined),
  readTextFile: jest.fn(async () => null as string | null),
  deleteFile: jest.fn(async () => undefined),
};
// Forward through arrows so the factory (evaluated during the hoisted import
// of `import-from-old-app`, before `mockBridge` is assigned) reads the live
// object at call time rather than capturing its undefined initial value.
jest.mock('./migration-bridge', () => ({
  migrationBridge: {
    sharedContainerPath: (...a: unknown[]) => mockBridge.sharedContainerPath(...a),
    fileExists: (...a: unknown[]) => mockBridge.fileExists(...a),
    copyFile: (...a: unknown[]) => mockBridge.copyFile(...a),
    readTextFile: (...a: unknown[]) => mockBridge.readTextFile(...a),
    deleteFile: (...a: unknown[]) => mockBridge.deleteFile(...a),
  },
}));

const mockSaveToken = jest.fn(async () => undefined);
jest.mock('../../monobank/token', () => ({ saveToken: (t: string) => mockSaveToken(t) }));

const mockSaveCredentials = jest.fn(async () => undefined);
jest.mock('../../crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (c: unknown) => mockSaveCredentials(c),
}));

import { finalizeImportBridge, importFromOldApp } from './import-from-old-app';

beforeEach(() => {
  jest.clearAllMocks();
  mockBridge.sharedContainerPath.mockResolvedValue(CONTAINER);
  mockBridge.fileExists.mockResolvedValue(true);
  mockBridge.readTextFile.mockResolvedValue(
    JSON.stringify({
      monobankToken: 'mono-tok',
      binanceCredentials: { apiKey: 'AK', secret: 'SK' },
    }),
  );
});

describe('importFromOldApp', () => {
  it('runs the import even when a stale DB key survived, clearing it before the copy', async () => {
    // The old bundle id ran before, so iOS may keep a STALE kiko.db.key Keychain
    // item across a container wipe/reinstall. A pending export (file present) must
    // still import: it clears the stale key FIRST so establishKey() mints a fresh
    // key for the imported data, then copies. Gating on key presence (the old bug)
    // would leave the user with an empty self-initialized DB.
    const order: string[] = [];
    mockResetDbKey.mockImplementation(async () => {
      order.push('reset');
    });
    mockBridge.copyFile.mockImplementation(async () => {
      order.push('copy');
    });

    await expect(importFromOldApp()).resolves.toBe(true);

    expect(mockResetDbKey).toHaveBeenCalledTimes(1);
    expect(mockBridge.copyFile).toHaveBeenCalledWith(EXPORT_PATH, LIVE_PATH);
    expect(order).toEqual(['reset', 'copy']);
  });

  it('is a no-op when no export file is present (fresh install)', async () => {
    mockBridge.fileExists.mockResolvedValue(false);

    await expect(importFromOldApp()).resolves.toBe(false);
    expect(mockResetDbKey).not.toHaveBeenCalled();
    expect(mockBridge.copyFile).not.toHaveBeenCalled();
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  it('copies the export onto the resolved live kiko.db path and cleans the probe file', async () => {
    await expect(importFromOldApp()).resolves.toBe(true);

    expect(mockOpen).toHaveBeenCalledWith({ name: 'kiko.db' });
    expect(tmpClose).toHaveBeenCalledTimes(1);
    expect(tmpDelete).toHaveBeenCalledTimes(1);
    expect(mockBridge.copyFile).toHaveBeenCalledWith(EXPORT_PATH, LIVE_PATH);
  });

  it('restores both secrets from the JSON into the new Keychain', async () => {
    await importFromOldApp();

    expect(mockSaveToken).toHaveBeenCalledWith('mono-tok');
    expect(mockSaveCredentials).toHaveBeenCalledWith({ apiKey: 'AK', secret: 'SK' });
  });

  it('skips a missing secret without throwing', async () => {
    mockBridge.readTextFile.mockResolvedValue(
      JSON.stringify({ monobankToken: null, binanceCredentials: null }),
    );

    await expect(importFromOldApp()).resolves.toBe(true);
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  it('degrades a corrupt/truncated secrets file to the same no-op as a missing one', async () => {
    // An existing-but-malformed file (e.g. a crash mid export-write) returns a
    // non-null string from readTextFile; an unguarded JSON.parse would throw
    // AFTER copyFile ran and brick every relaunch. It must instead complete the
    // DB import and restore no secret.
    mockBridge.readTextFile.mockResolvedValue('{ "monobankToken": "trunc');

    await expect(importFromOldApp()).resolves.toBe(true);
    expect(mockBridge.copyFile).toHaveBeenCalledWith(EXPORT_PATH, LIVE_PATH);
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });
});

describe('finalizeImportBridge', () => {
  it('deletes both bridge files AND the export DB sidecars from the shared container', async () => {
    await finalizeImportBridge();

    expect(mockBridge.deleteFile).toHaveBeenCalledWith(EXPORT_PATH);
    expect(mockBridge.deleteFile).toHaveBeenCalledWith(`${EXPORT_PATH}-wal`);
    expect(mockBridge.deleteFile).toHaveBeenCalledWith(`${EXPORT_PATH}-shm`);
    expect(mockBridge.deleteFile).toHaveBeenCalledWith(`${EXPORT_PATH}-journal`);
    expect(mockBridge.deleteFile).toHaveBeenCalledWith(SECRETS_PATH);
  });

  it('never throws when the wipe fails', async () => {
    mockBridge.deleteFile.mockRejectedValue(new Error('container gone'));

    await expect(finalizeImportBridge()).resolves.toBeUndefined();
  });

  it('no-ops when the shared container is unavailable', async () => {
    mockBridge.sharedContainerPath.mockResolvedValue(null);

    await finalizeImportBridge();

    expect(mockBridge.deleteFile).not.toHaveBeenCalled();
  });
});
