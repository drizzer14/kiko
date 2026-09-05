import type { DB } from '@op-engineering/op-sqlite';

jest.mock('@op-engineering/op-sqlite', () => ({}));

const mockExecute = jest.fn(async () => ({ rows: [], rowsAffected: 0 }));
const mockOpened = { execute: mockExecute, executeRaw: jest.fn() };
const mockOpenEncryptedDatabase = jest.fn(async () => mockOpened);
jest.mock('./encrypted-database', () => ({
  openEncryptedDatabase: () => mockOpenEncryptedDatabase(),
}));

// The plaintext launch path (encryption flag OFF) opens kiko.db through the
// legacy-rename migration and never touches the encrypted-database module.
const mockPlaintext = { execute: mockExecute, executeRaw: jest.fn() };
const mockMigrateLegacyDatabase = jest.fn(() => mockPlaintext);
jest.mock('./migrate-legacy-db', () => ({
  migrateLegacyDatabase: () => mockMigrateLegacyDatabase(),
}));

// The encryption feature flag, read at call time by the client so a test can
// select the plaintext (OFF) or encrypted (ON) launch path per case.
let mockEncryptionEnabled = false;
jest.mock('./db-config', () => ({
  get DB_ENCRYPTION_ENABLED() {
    return mockEncryptionEnabled;
  },
}));

import { wrapClientForDrizzle } from './client';

const loadClient = (): typeof import('./client') =>
  require('./client') as typeof import('./client');

describe('wrapClientForDrizzle', () => {
  it('unwraps executeRaw().rawRows for drizzle reads (executeRawAsync)', async () => {
    const rawRows = [
      ['a1', 100],
      ['a2', 250],
    ];
    const executeRaw = jest.fn(async () => ({
      rawRows,
      columnNames: ['id', 'balance'],
      rowsAffected: 0,
    }));
    const client = { executeRaw } as unknown as DB;

    const wrapped = wrapClientForDrizzle(client);
    const rows = await wrapped.executeRawAsync('SELECT id, balance FROM accounts WHERE k = ?', [
      'x',
    ]);

    expect(rows).toBe(rawRows);
    expect(executeRaw).toHaveBeenCalledWith('SELECT id, balance FROM accounts WHERE k = ?', ['x']);
  });

  it('leaves the write-path method (executeAsync) delegating unchanged', () => {
    const executeAsync = jest.fn();
    const executeRaw = jest.fn();
    const client = { executeAsync, executeRaw } as unknown as DB;

    const wrapped = wrapClientForDrizzle(client);

    expect((wrapped as unknown as { executeAsync: unknown }).executeAsync).toBe(executeAsync);
  });

  it('overrides only executeRawAsync, not the underlying executeRaw reference', () => {
    const executeRaw = jest.fn();
    const client = { executeRaw } as unknown as DB;

    const wrapped = wrapClientForDrizzle(client);

    expect(wrapped.executeRawAsync).not.toBe(executeRaw);
    expect((wrapped as unknown as { executeRaw: unknown }).executeRaw).toBe(executeRaw);
  });
});

describe('initDatabase / rawDatabase (encryption enabled)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // These cases exercise the cluster-2 encrypted launch path.
    mockEncryptionEnabled = true;
  });

  it('throws a clear error when the connection is used before initDatabase()', () => {
    const { rawDatabase } = loadClient();

    expect(() => rawDatabase.execute('SELECT 1')).toThrow('Database is not initialized');
  });

  it('opens the encrypted database and enables foreign keys on it', async () => {
    const { initDatabase } = loadClient();

    await initDatabase();

    expect(mockOpenEncryptedDatabase).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith('PRAGMA foreign_keys = ON');
  });

  it('forwards rawDatabase calls to the live connection after init', async () => {
    const { initDatabase, rawDatabase } = loadClient();

    await initDatabase();
    await rawDatabase.execute('SELECT 1');

    expect(mockExecute).toHaveBeenLastCalledWith('SELECT 1');
  });

  it('lets drizzle query builders be constructed before init (no execution)', () => {
    const { database } = loadClient();
    const { settings } = require('./schema') as typeof import('./schema');

    expect(database.select().from(settings).toSQL().sql).toContain('settings');
    expect(mockOpenEncryptedDatabase).not.toHaveBeenCalled();
  });

  it('shares one open across concurrent callers and memoizes a completed init', async () => {
    const { initDatabase } = loadClient();

    await Promise.all([initDatabase(), initDatabase()]);
    await initDatabase();

    expect(mockOpenEncryptedDatabase).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed init instead of replaying the rejection', async () => {
    const { initDatabase } = loadClient();
    mockOpenEncryptedDatabase.mockRejectedValueOnce(new Error('keychain unavailable'));

    await expect(initDatabase()).rejects.toThrow('keychain unavailable');
    await expect(initDatabase()).resolves.toBeUndefined();

    expect(mockOpenEncryptedDatabase).toHaveBeenCalledTimes(2);
  });
});

describe('initDatabase (encryption disabled: plaintext launch path)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockEncryptionEnabled = false;
  });

  it('opens the plaintext kiko.db via migrateLegacyDatabase and enables foreign keys', async () => {
    const { initDatabase } = loadClient();

    await initDatabase();

    expect(mockMigrateLegacyDatabase).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith('PRAGMA foreign_keys = ON');
  });

  it('never touches the encrypted / key / SQLCipher-assert path when the flag is OFF', async () => {
    const { initDatabase } = loadClient();

    await initDatabase();

    // openEncryptedDatabase is the sole entry point to assertSQLCipherBuild, the
    // db-key create/read, and the plaintext -> encrypted export; its never being
    // called proves none of them ran on the OFF path.
    expect(mockOpenEncryptedDatabase).not.toHaveBeenCalled();
  });

  it('forwards rawDatabase calls to the live plaintext connection after init', async () => {
    const { initDatabase, rawDatabase } = loadClient();

    await initDatabase();
    await rawDatabase.execute('SELECT 1');

    expect(mockExecute).toHaveBeenLastCalledWith('SELECT 1');
  });
});
