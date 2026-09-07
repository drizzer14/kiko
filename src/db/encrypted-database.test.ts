import {
  ENCRYPTED_DATABASE_NAME,
  LEGACY_PLAINTEXT_DATABASE_NAME,
  LIVE_PLAINTEXT_DATABASE_NAME,
  openEncryptedDatabase,
} from './encrypted-database';

const HEX_KEY = 'cd'.repeat(32);
const RAW_KEY = `x'${HEX_KEY}'`;
const LIBRARY_DIR = '/var/mobile/Containers/Data/Application/APP/Library';

type FakeDb = {
  name: string;
  execute: jest.Mock;
  executeSync: jest.Mock;
  delete: jest.Mock;
  close: jest.Mock;
  getDbPath: () => string;
};

const mockFiles = new Set<string>();
const mockHandles = new Map<string, FakeDb>();
const mockOpen = jest.fn();
const mockIsSQLCipher = jest.fn(() => true);

jest.mock('@op-engineering/op-sqlite', () => ({
  open: (...args: unknown[]) => mockOpen(...args),
  isSQLCipher: () => mockIsSQLCipher(),
}));

const mockReadDbKey = jest.fn<Promise<string | undefined>, []>();
const mockGenerateDbKey = jest.fn(() => 'cd'.repeat(32));
const mockStoreDbKey = jest.fn(async (_keyHex: string) => undefined);
jest.mock('./keys/db-key', () => ({
  readDbKey: () => mockReadDbKey(),
  generateDbKey: () => mockGenerateDbKey(),
  storeDbKey: (keyHex: string) => mockStoreDbKey(keyHex),
  toSQLCipherRawKey: (keyHex: string) => "x'".concat(keyHex, "'"),
}));

// migrateLegacyDatabase returns the live plaintext kiko.db connection (with any
// pre-rename pff.db already folded in). Tests set userTables to model an
// upgrade (>0) or a fresh install (0).
const mockMigrateLegacyDatabase = jest.fn<FakeDb, []>();
jest.mock('./migrate-legacy-db', () => ({
  migrateLegacyDatabase: () => mockMigrateLegacyDatabase(),
}));

const handleFor = (name: string, userTables = 0): FakeDb => {
  const existing = mockHandles.get(name);

  if (existing !== undefined) {
    return existing;
  }

  const handle: FakeDb = {
    name,
    execute: jest.fn(async () => ({ rows: [], rowsAffected: 0 })),
    executeSync: jest.fn(() => ({ rows: [{ n: userTables }] })),
    delete: jest.fn(() => {
      mockFiles.delete(name);
    }),
    close: jest.fn(),
    getDbPath: () => `${LIBRARY_DIR}/${name}`,
  };
  mockHandles.set(name, handle);

  return handle;
};

const orderOf = (mock: jest.Mock, callIndex = 0): number =>
  mock.mock.invocationCallOrder[callIndex];

beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockHandles.clear();
  mockIsSQLCipher.mockReturnValue(true);
  mockReadDbKey.mockResolvedValue(undefined);
  // Default: fresh install — migrateLegacyDatabase returns an empty kiko.db.
  mockMigrateLegacyDatabase.mockImplementation(() => handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 0));
  mockOpen.mockImplementation((options: { name: string; failOnCreate?: boolean }) => {
    if (options.failOnCreate === true && !mockFiles.has(options.name)) {
      throw new Error(`no such file: ${options.name}`);
    }

    mockFiles.add(options.name);

    return handleFor(options.name);
  });
});

describe('openEncryptedDatabase', () => {
  it('refuses to run on an op-sqlite build without SQLCipher', async () => {
    mockIsSQLCipher.mockReturnValue(false);

    await expect(openEncryptedDatabase()).rejects.toThrow('without SQLCipher');
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockMigrateLegacyDatabase).not.toHaveBeenCalled();
  });

  describe('steady state: key already in the Keychain', () => {
    beforeEach(() => {
      mockReadDbKey.mockResolvedValue(HEX_KEY);
      mockFiles.add(ENCRYPTED_DATABASE_NAME);
    });

    it('opens the encrypted database with the stored key and never runs the legacy migration', async () => {
      const db = await openEncryptedDatabase();

      expect(db).toBe(handleFor(ENCRYPTED_DATABASE_NAME));
      expect(mockOpen).toHaveBeenCalledWith({
        name: ENCRYPTED_DATABASE_NAME,
        encryptionKey: RAW_KEY,
      });
      expect(mockMigrateLegacyDatabase).not.toHaveBeenCalled();
      expect(mockGenerateDbKey).not.toHaveBeenCalled();
      expect(mockStoreDbKey).not.toHaveBeenCalled();
    });

    it('scrubs leftover plaintext kiko.db and pff.db from an interrupted earlier migration', async () => {
      mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);
      mockFiles.add(LEGACY_PLAINTEXT_DATABASE_NAME);

      await openEncryptedDatabase();

      expect(handleFor(LIVE_PLAINTEXT_DATABASE_NAME).delete).toHaveBeenCalledTimes(1);
      expect(handleFor(LEGACY_PLAINTEXT_DATABASE_NAME).delete).toHaveBeenCalledTimes(1);
      expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(false);
      expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(false);
    });

    it('does not create a plaintext file just to check for one', async () => {
      await openEncryptedDatabase();

      const plaintextOpens = mockOpen.mock.calls.filter(
        ([options]) =>
          options.name === LIVE_PLAINTEXT_DATABASE_NAME ||
          options.name === LEGACY_PLAINTEXT_DATABASE_NAME,
      );
      for (const [options] of plaintextOpens) {
        expect(options.failOnCreate).toBe(true);
      }
      expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(false);
      expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(false);
    });
  });

  describe('fresh install: no key, empty plaintext', () => {
    it('stores a key and opens a new encrypted database without any export', async () => {
      const db = await openEncryptedDatabase();

      expect(mockGenerateDbKey).toHaveBeenCalledTimes(1);
      expect(mockStoreDbKey).toHaveBeenCalledWith(HEX_KEY);
      expect(db).toBe(handleFor(ENCRYPTED_DATABASE_NAME));
      expect(mockOpen).toHaveBeenLastCalledWith({
        name: ENCRYPTED_DATABASE_NAME,
        encryptionKey: RAW_KEY,
      });
      expect(handleFor(LIVE_PLAINTEXT_DATABASE_NAME).execute).not.toHaveBeenCalled();
    });

    it('persists the key before opening the encrypted file', async () => {
      await openEncryptedDatabase();

      const encryptedOpenIndex = mockOpen.mock.calls.findIndex(
        ([options]) => options.name === ENCRYPTED_DATABASE_NAME,
      );
      expect(orderOf(mockStoreDbKey)).toBeLessThan(orderOf(mockOpen, encryptedOpenIndex));
    });
  });

  describe('upgrade: no key, populated plaintext kiko.db', () => {
    beforeEach(() => {
      mockMigrateLegacyDatabase.mockImplementation(() =>
        handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 5),
      );
      mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);
      mockFiles.add(LEGACY_PLAINTEXT_DATABASE_NAME);
    });

    it('exports the plaintext database into an encrypted copy beside it, keyed with the new key', async () => {
      await openEncryptedDatabase();

      const plaintext = handleFor(LIVE_PLAINTEXT_DATABASE_NAME);
      expect(plaintext.execute.mock.calls).toEqual([
        [
          'ATTACH DATABASE ? AS encrypted KEY ?',
          [`${LIBRARY_DIR}/${ENCRYPTED_DATABASE_NAME}`, RAW_KEY],
        ],
        ["SELECT sqlcipher_export('encrypted')"],
        ['DETACH DATABASE encrypted'],
      ]);
    });

    it('stores the key only after the export finished, then deletes BOTH plaintext files', async () => {
      await openEncryptedDatabase();

      const plaintext = handleFor(LIVE_PLAINTEXT_DATABASE_NAME);
      const detachIndex = plaintext.execute.mock.calls.findIndex(
        ([sql]) => sql === 'DETACH DATABASE encrypted',
      );
      expect(orderOf(plaintext.execute, detachIndex)).toBeLessThan(orderOf(mockStoreDbKey));
      expect(orderOf(mockStoreDbKey)).toBeLessThan(orderOf(plaintext.delete));
      expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(false);
      expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(false);
    });

    it('opens the encrypted database with that same key', async () => {
      const db = await openEncryptedDatabase();

      expect(db).toBe(handleFor(ENCRYPTED_DATABASE_NAME));
      expect(mockOpen).toHaveBeenLastCalledWith({
        name: ENCRYPTED_DATABASE_NAME,
        encryptionKey: RAW_KEY,
      });
    });

    it('discards a stale partial encrypted file before exporting into it', async () => {
      mockFiles.add(ENCRYPTED_DATABASE_NAME);

      await openEncryptedDatabase();

      const stale = handleFor(ENCRYPTED_DATABASE_NAME);
      const plaintext = handleFor(LIVE_PLAINTEXT_DATABASE_NAME);
      expect(stale.delete).toHaveBeenCalledTimes(1);
      expect(orderOf(stale.delete)).toBeLessThan(orderOf(plaintext.execute));
    });

    it('leaves the plaintext intact and stores no key when the export fails', async () => {
      // Match the migrateLegacyDatabase mock (5 user tables) so the populated
      // plaintext handle is cached with the upgrade branch's table count before
      // openEncryptedDatabase draws it — otherwise the default (0) would route
      // through the fresh-install branch and skip the export entirely.
      const plaintext = handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 5);
      plaintext.execute.mockImplementation(async (sql: string) => {
        if (sql.includes('sqlcipher_export')) {
          throw new Error('disk full');
        }

        return { rows: [], rowsAffected: 0 };
      });

      await expect(openEncryptedDatabase()).rejects.toThrow('disk full');

      expect(mockStoreDbKey).not.toHaveBeenCalled();
      expect(plaintext.delete).not.toHaveBeenCalled();
      expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(true);
    });
  });
});
