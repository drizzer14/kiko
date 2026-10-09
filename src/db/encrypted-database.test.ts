import {
  ENCRYPTED_DATABASE_NAME,
  LEGACY_PLAINTEXT_DATABASE_NAME,
  LIVE_PLAINTEXT_DATABASE_NAME,
  openEncryptedDatabase,
} from './encrypted-database';
import { DatabaseKeyMissingError } from './database-key-missing-error';

const HEX_KEY = 'cd'.repeat(32);
const RAW_KEY = `x'${HEX_KEY}'`;
const LIBRARY_DIR = '/var/mobile/Containers/Data/Application/APP/Library';
const ENCRYPTED_PATH = `${LIBRARY_DIR}/kiko-encrypted.db`;

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
  IOS_LIBRARY_PATH: '/var/mobile/Containers/Data/Application/APP/Library',
}));

const mockExists = jest.fn<Promise<boolean>, [string]>();
jest.mock('react-native-fs', () => ({
  exists: (path: string) => mockExists(path),
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
jest.mock('@kiko/migration/migrate-legacy-db', () => ({
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

// Models SQLCipher's export: ATTACH creates the keyed file, which then holds 5 tables.
const exportCreatesEncryptedFile = (plaintext: FakeDb): void => {
  handleFor(ENCRYPTED_DATABASE_NAME, 5);
  plaintext.execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith('ATTACH')) {
      mockFiles.add(ENCRYPTED_DATABASE_NAME);
    }

    return { rows: [], rowsAffected: 0 };
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockHandles.clear();
  mockIsSQLCipher.mockReturnValue(true);
  mockReadDbKey.mockResolvedValue(undefined);
  mockExists.mockImplementation(
    async (path) =>
      path.startsWith(`${LIBRARY_DIR}/`) && mockFiles.has(path.slice(LIBRARY_DIR.length + 1)),
  );
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

    it('proves the stored key opens the encrypted file before it deletes any plaintext', async () => {
      mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);

      await openEncryptedDatabase();

      const proofIndex = mockOpen.mock.calls.findIndex(
        ([options]) =>
          options.name === ENCRYPTED_DATABASE_NAME && options.encryptionKey === RAW_KEY,
      );
      const proofHandle = handleFor(ENCRYPTED_DATABASE_NAME);
      expect(orderOf(mockOpen, proofIndex)).toBeLessThan(
        orderOf(handleFor(LIVE_PLAINTEXT_DATABASE_NAME).delete),
      );
      expect(proofHandle.executeSync).toHaveBeenCalledWith(
        expect.stringContaining('sqlite_master'),
      );
      expect(orderOf(proofHandle.executeSync)).toBeLessThan(
        orderOf(handleFor(LIVE_PLAINTEXT_DATABASE_NAME).delete),
      );
    });

    it('keeps the plaintext and rejects when the stored key does not open the encrypted file', async () => {
      mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);
      mockFiles.add(LEGACY_PLAINTEXT_DATABASE_NAME);
      handleFor(ENCRYPTED_DATABASE_NAME).executeSync.mockImplementation(() => {
        throw new Error('file is not a database');
      });

      await expect(openEncryptedDatabase()).rejects.toThrow('does not open the encrypted database');

      expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(true);
      expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(true);
      expect(handleFor(ENCRYPTED_DATABASE_NAME).close).toHaveBeenCalled();
      expect(mockStoreDbKey).not.toHaveBeenCalled();
    });

    it('opens the proof on the existing file only, so it can never create an empty keyed one', async () => {
      await openEncryptedDatabase();

      const proofCall = mockOpen.mock.calls.find(
        ([options]) =>
          options.name === ENCRYPTED_DATABASE_NAME && options.encryptionKey === RAW_KEY,
      );
      expect(proofCall?.[0].failOnCreate).toBe(true);
      expect(mockExists).toHaveBeenCalledWith(ENCRYPTED_PATH);
    });

    it('puts the real cause in the failure message and keeps it attached as the cause', async () => {
      handleFor(ENCRYPTED_DATABASE_NAME).executeSync.mockImplementation(() => {
        throw new Error('disk I/O error');
      });

      const failure = await openEncryptedDatabase().catch((caught: unknown) => caught);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        'The stored database key does not open the encrypted database: disk I/O error',
      );
      expect((failure as Error).cause).toEqual(new Error('disk I/O error'));
    });

    it('reports a non-Error throw by its string form', async () => {
      handleFor(ENCRYPTED_DATABASE_NAME).executeSync.mockImplementation(() => {
        throw 'sqlite busy';
      });

      await expect(openEncryptedDatabase()).rejects.toThrow(
        'The stored database key does not open the encrypted database: sqlite busy',
      );
    });
  });

  describe('key in the Keychain but the encrypted file is gone', () => {
    beforeEach(() => {
      mockReadDbKey.mockResolvedValue(HEX_KEY);
    });

    describe('populated plaintext kiko.db (for example a restored backup)', () => {
      let plaintext: FakeDb;

      beforeEach(() => {
        plaintext = handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 5);
        mockMigrateLegacyDatabase.mockImplementation(() => plaintext);
        mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);
        mockFiles.add(LEGACY_PLAINTEXT_DATABASE_NAME);
        exportCreatesEncryptedFile(plaintext);
      });

      it('exports the plaintext into a new encrypted file keyed with the existing key', async () => {
        const db = await openEncryptedDatabase();

        expect(plaintext.execute.mock.calls).toEqual([
          ['ATTACH DATABASE ? AS encrypted KEY ?', [ENCRYPTED_PATH, RAW_KEY]],
          ["SELECT sqlcipher_export('encrypted')"],
          ['DETACH DATABASE encrypted'],
        ]);
        expect(db).toBe(handleFor(ENCRYPTED_DATABASE_NAME));
        expect(mockGenerateDbKey).not.toHaveBeenCalled();
        expect(mockStoreDbKey).not.toHaveBeenCalled();
      });

      it('deletes the plaintext only after the export is verified by reading it back', async () => {
        await openEncryptedDatabase();

        const encrypted = handleFor(ENCRYPTED_DATABASE_NAME);
        const detachIndex = plaintext.execute.mock.calls.findIndex(
          ([sql]) => sql === 'DETACH DATABASE encrypted',
        );
        expect(orderOf(plaintext.execute, detachIndex)).toBeLessThan(
          orderOf(encrypted.executeSync),
        );
        expect(orderOf(encrypted.executeSync)).toBeLessThan(orderOf(plaintext.delete));
        expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(false);
        expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(false);
        expect(mockFiles.has(ENCRYPTED_DATABASE_NAME)).toBe(true);
      });

      it('keeps the plaintext when the export fails', async () => {
        plaintext.execute.mockImplementation(async (sql: string) => {
          if (sql.includes('sqlcipher_export')) {
            throw new Error('disk full');
          }

          return { rows: [], rowsAffected: 0 };
        });

        await expect(openEncryptedDatabase()).rejects.toThrow('disk full');

        expect(plaintext.delete).not.toHaveBeenCalled();
        expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(true);
        expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(true);
        expect(mockStoreDbKey).not.toHaveBeenCalled();
      });

      it('keeps the plaintext when the exported file holds no tables', async () => {
        handleFor(ENCRYPTED_DATABASE_NAME).executeSync.mockReturnValue({ rows: [{ n: 0 }] });

        await expect(openEncryptedDatabase()).rejects.toThrow('holds no tables');

        expect(plaintext.delete).not.toHaveBeenCalled();
        expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(true);
        expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(true);
      });

      it('keeps the plaintext when the exported file cannot be read back, naming the export', async () => {
        handleFor(ENCRYPTED_DATABASE_NAME).executeSync.mockImplementation(() => {
          throw new Error('file is not a database');
        });

        const failure = await openEncryptedDatabase().catch((caught: unknown) => caught);

        expect((failure as Error).message).toBe(
          'The encrypted copy could not be read back: file is not a database',
        );
        expect((failure as Error).cause).toEqual(new Error('file is not a database'));
        expect(plaintext.delete).not.toHaveBeenCalled();
        expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(true);
      });
    });

    describe('no plaintext data either', () => {
      it('creates a fresh encrypted database with the existing key and loses nothing', async () => {
        const db = await openEncryptedDatabase();

        expect(db).toBe(handleFor(ENCRYPTED_DATABASE_NAME));
        expect(mockOpen).toHaveBeenLastCalledWith({
          name: ENCRYPTED_DATABASE_NAME,
          encryptionKey: RAW_KEY,
        });
        expect(handleFor(LIVE_PLAINTEXT_DATABASE_NAME).execute).not.toHaveBeenCalled();
        expect(mockGenerateDbKey).not.toHaveBeenCalled();
        expect(mockStoreDbKey).not.toHaveBeenCalled();
      });

      it('still scrubs an empty plaintext residue', async () => {
        mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);
        mockFiles.add(LEGACY_PLAINTEXT_DATABASE_NAME);

        await openEncryptedDatabase();

        expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(false);
        expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(false);
      });
    });
  });

  describe('key and encrypted file present, but plaintext still holds data', () => {
    // A kill after ATTACH leaves a 0-byte keyed file that the key opens with 0 tables. The app
    // never opens the encrypted file before the plaintext is deleted, so it never served it.
    const modelKilledExport = (plaintext: FakeDb): void => {
      mockReadDbKey.mockResolvedValue(HEX_KEY);
      mockMigrateLegacyDatabase.mockImplementation(() => plaintext);
      mockFiles.add(ENCRYPTED_DATABASE_NAME);
      exportCreatesEncryptedFile(plaintext);
    };

    it('rebuilds the file from a populated kiko.db and deletes the plaintext only after verifying it', async () => {
      const plaintext = handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 5);
      mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);
      mockFiles.add(LEGACY_PLAINTEXT_DATABASE_NAME);
      modelKilledExport(plaintext);

      const db = await openEncryptedDatabase();

      const encrypted = handleFor(ENCRYPTED_DATABASE_NAME);
      expect(encrypted.delete).toHaveBeenCalledTimes(1);
      expect(orderOf(encrypted.delete)).toBeLessThan(orderOf(plaintext.execute));
      expect(plaintext.execute.mock.calls[0]).toEqual([
        'ATTACH DATABASE ? AS encrypted KEY ?',
        [ENCRYPTED_PATH, RAW_KEY],
      ]);
      expect(orderOf(encrypted.executeSync)).toBeLessThan(orderOf(plaintext.delete));
      expect(mockFiles.has(ENCRYPTED_DATABASE_NAME)).toBe(true);
      expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(false);
      expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(false);
      expect(db).toBe(encrypted);
      expect(mockStoreDbKey).not.toHaveBeenCalled();
    });

    it('rebuilds from a populated pff.db when kiko.db is empty', async () => {
      const plaintext = handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 3);
      handleFor(LEGACY_PLAINTEXT_DATABASE_NAME, 3);
      mockFiles.add(LEGACY_PLAINTEXT_DATABASE_NAME);
      modelKilledExport(plaintext);
      mockMigrateLegacyDatabase.mockImplementation(() => {
        mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);

        return plaintext;
      });

      await openEncryptedDatabase();

      expect(plaintext.execute).toHaveBeenCalledTimes(3);
      expect(orderOf(handleFor(ENCRYPTED_DATABASE_NAME).executeSync)).toBeLessThan(
        orderOf(plaintext.delete),
      );
      expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(false);
      expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(false);
    });

    it('keeps the plaintext when the rebuilt export fails, so the next launch can redo it', async () => {
      const plaintext = handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 5);
      mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);
      modelKilledExport(plaintext);
      plaintext.execute.mockImplementation(async (sql: string) => {
        if (sql.includes('sqlcipher_export')) {
          throw new Error('disk full');
        }

        return { rows: [], rowsAffected: 0 };
      });

      await expect(openEncryptedDatabase()).rejects.toThrow('disk full');

      expect(plaintext.delete).not.toHaveBeenCalled();
      expect(mockFiles.has(LIVE_PLAINTEXT_DATABASE_NAME)).toBe(true);
    });

    it('keeps trusting an encrypted file with no tables when no plaintext holds data', async () => {
      mockReadDbKey.mockResolvedValue(HEX_KEY);
      mockFiles.add(ENCRYPTED_DATABASE_NAME);
      handleFor(ENCRYPTED_DATABASE_NAME, 0);

      await openEncryptedDatabase();

      expect(mockMigrateLegacyDatabase).not.toHaveBeenCalled();
      expect(handleFor(ENCRYPTED_DATABASE_NAME).delete).not.toHaveBeenCalled();
    });
  });

  describe('fresh install: no key, empty plaintext', () => {
    it('does not create the encrypted file just to probe for it', async () => {
      await openEncryptedDatabase();

      const probe = mockOpen.mock.calls.find(
        ([options]) =>
          options.name === ENCRYPTED_DATABASE_NAME && options.encryptionKey === undefined,
      );
      expect(probe?.[0].failOnCreate).toBe(true);
    });

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
        ([options]) =>
          options.name === ENCRYPTED_DATABASE_NAME && options.encryptionKey !== undefined,
      );
      expect(orderOf(mockStoreDbKey)).toBeLessThan(orderOf(mockOpen, encryptedOpenIndex));
    });
  });

  describe('key lost: no key, existing encrypted file, nothing to migrate', () => {
    beforeEach(() => {
      mockFiles.add(ENCRYPTED_DATABASE_NAME);
    });

    const everyDelete = (): jest.Mock[] => [...mockHandles.values()].map((handle) => handle.delete);

    it('throws the distinct missing-key error', async () => {
      await expect(openEncryptedDatabase()).rejects.toBeInstanceOf(DatabaseKeyMissingError);
      expect(mockExists).toHaveBeenCalledWith(ENCRYPTED_PATH);
    });

    it('refuses when the kiko.db table count cannot be read, never treating it as populated', async () => {
      mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);
      const live = handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 5);
      live.executeSync.mockImplementation(() => {
        throw new Error('database disk image is malformed');
      });

      await expect(openEncryptedDatabase()).rejects.toBeInstanceOf(DatabaseKeyMissingError);

      expect(mockMigrateLegacyDatabase).not.toHaveBeenCalled();
      expect(live.close).toHaveBeenCalled();
      expect(live.delete).not.toHaveBeenCalled();
    });

    it('generates no key, stores no key, and deletes no file', async () => {
      await expect(openEncryptedDatabase()).rejects.toThrow();

      expect(mockGenerateDbKey).not.toHaveBeenCalled();
      expect(mockStoreDbKey).not.toHaveBeenCalled();

      for (const deleteMock of everyDelete()) {
        expect(deleteMock).not.toHaveBeenCalled();
      }
      expect(mockFiles.has(ENCRYPTED_DATABASE_NAME)).toBe(true);
    });

    it('never opens the encrypted file with a key and closes every handle it opened', async () => {
      mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);

      await expect(openEncryptedDatabase()).rejects.toThrow();

      expect(mockOpen.mock.calls.some(([options]) => options.encryptionKey !== undefined)).toBe(
        false,
      );
      expect(mockHandles.size).toBeGreaterThan(0);

      for (const handle of mockHandles.values()) {
        expect(handle.close).toHaveBeenCalled();
      }
    });

    it('refuses without running the legacy migration, whatever pff.db holds', async () => {
      // The real migration would rebuild a populated kiko.db from a surviving pff.db and
      // hide the missing key behind it.
      mockFiles.add(LEGACY_PLAINTEXT_DATABASE_NAME);
      mockMigrateLegacyDatabase.mockImplementation(() =>
        handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 5),
      );

      await expect(openEncryptedDatabase()).rejects.toBeInstanceOf(DatabaseKeyMissingError);

      expect(mockMigrateLegacyDatabase).not.toHaveBeenCalled();
      expect(mockGenerateDbKey).not.toHaveBeenCalled();
      expect(mockStoreDbKey).not.toHaveBeenCalled();

      for (const deleteMock of everyDelete()) {
        expect(deleteMock).not.toHaveBeenCalled();
      }
      expect(mockFiles.has(ENCRYPTED_DATABASE_NAME)).toBe(true);
      expect(mockFiles.has(LEGACY_PLAINTEXT_DATABASE_NAME)).toBe(true);
    });

    it('also refuses when kiko.db exists but holds no tables', async () => {
      mockFiles.add(LEGACY_PLAINTEXT_DATABASE_NAME);
      mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);
      mockMigrateLegacyDatabase.mockImplementation(() =>
        handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 5),
      );

      await expect(openEncryptedDatabase()).rejects.toBeInstanceOf(DatabaseKeyMissingError);

      expect(mockMigrateLegacyDatabase).not.toHaveBeenCalled();
      expect(mockStoreDbKey).not.toHaveBeenCalled();

      for (const deleteMock of everyDelete()) {
        expect(deleteMock).not.toHaveBeenCalled();
      }
    });

    it('treats a file that exists but fails to open as existing, not as absent', async () => {
      mockFiles.delete(ENCRYPTED_DATABASE_NAME);
      mockExists.mockImplementation(async (path) => path === ENCRYPTED_PATH);

      await expect(openEncryptedDatabase()).rejects.toBeInstanceOf(DatabaseKeyMissingError);

      expect(mockExists).toHaveBeenCalledWith(ENCRYPTED_PATH);

      expect(mockGenerateDbKey).not.toHaveBeenCalled();
      expect(mockStoreDbKey).not.toHaveBeenCalled();
    });

    it('opens the existing database on a later launch once the key is readable again', async () => {
      await expect(openEncryptedDatabase()).rejects.toBeInstanceOf(DatabaseKeyMissingError);
      mockReadDbKey.mockResolvedValue(HEX_KEY);

      const db = await openEncryptedDatabase();

      expect(db).toBe(handleFor(ENCRYPTED_DATABASE_NAME));
      expect(mockOpen).toHaveBeenLastCalledWith({
        name: ENCRYPTED_DATABASE_NAME,
        encryptionKey: RAW_KEY,
      });
      expect(mockStoreDbKey).not.toHaveBeenCalled();
      expect(handleFor(ENCRYPTED_DATABASE_NAME).delete).not.toHaveBeenCalled();
    });
  });

  describe('upgrade: no key, populated plaintext kiko.db', () => {
    beforeEach(() => {
      // Cached first so the guard's keyless probe of kiko.db sees the same 5 tables.
      handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 5);
      mockMigrateLegacyDatabase.mockImplementation(() =>
        handleFor(LIVE_PLAINTEXT_DATABASE_NAME, 5),
      );
      mockFiles.add(LIVE_PLAINTEXT_DATABASE_NAME);
      mockFiles.add(LEGACY_PLAINTEXT_DATABASE_NAME);
      exportCreatesEncryptedFile(handleFor(LIVE_PLAINTEXT_DATABASE_NAME));
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
