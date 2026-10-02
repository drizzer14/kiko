// A file an earlier build wrote must still restore: the real import, the real
// credentials step and the real restore on a fully migrated `node:sqlite`
// engine; only the Keychain writes, the file read, and the work after the
// restore are doubled.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

const mockReadFile = jest.fn();
jest.mock('react-native-fs', () => ({ readFile: (...args: unknown[]) => mockReadFile(...args) }));

const mockSaveToken = jest.fn();
jest.mock('@kiko/monobank/token', () => ({
  saveToken: (id: string, token: string) => mockSaveToken(id, token),
}));

const mockSaveCredentials = jest.fn();
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (id: string, credentials: unknown) => mockSaveCredentials(id, credentials),
}));

jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/holdings/lot-recost/lot-recost', () => ({
  recostStoredLots: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/reminders/use-reminder-scheduler', () => ({
  replanRestoredReminders: jest.fn().mockResolvedValue(undefined),
}));

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { utf8ToBytes } from '@noble/ciphers/utils.js';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { importData } from './import-data';
import { encryptEnvelope } from './crypto/envelope';
import { encodeBytesToBase64 } from './base64/base64';
import { generateExportKey } from './crypto/generate-key';
import { readDataSnapshot } from './snapshot/read-snapshot';

const DEMO_FIXTURES = join(__dirname, '..', '..', 'e2e', 'screenshot', 'fixtures');

const openDatabase = (accountIds: readonly string[] = []): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('INSERT INTO settings (id) VALUES (1)');

  for (const id of accountIds) {
    database
      .prepare("INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, 'bank', ?)")
      .run(id, id, id.startsWith('mono') ? 'monobank' : 'binance');
  }

  return database;
};

// What a build that predates the reminders, the price points, the bond
// register, and the settings columns of 1.2 wrote.
const EARLIER_BUILD_SETTINGS_COLUMNS = [
  'reminderOfferDismissals',
  'notificationsDeliverableSince',
  'lockEnabled',
  'quoteQuota',
  'lotsRecosted',
  'importTimesRezoned',
];

// A statement-import row an earlier build stored with the bank's wall clock
// read as UTC; the restore reads those digits as Kyiv time.
const LEGACY_IMPORT_TIME = Date.UTC(2026, 2, 3, 9, 45, 0);
const REZONED_IMPORT_TIME = Date.UTC(2026, 2, 3, 7, 45, 0);

const insertLegacyImportRow = (database: DatabaseSync): void => {
  database
    .prepare(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('h1', 'mono1', 'Card', 'cash', 'UAH')",
    )
    .run();
  database
    .prepare(
      "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source) VALUES ('t1', 'h1', -100, ?, 'import')",
    )
    .run(LEGACY_IMPORT_TIME);
};

const earlierBuildPayload = async (
  secrets?: unknown,
  seed?: (database: DatabaseSync) => void,
): Promise<unknown> => {
  mockDatabase = openDatabase(['mono1', 'bin1']);
  seed?.(mockDatabase);

  const tables = JSON.parse(JSON.stringify(await readDataSnapshot())) as Record<string, unknown>;

  for (const table of ['reminders', 'pricePoints', 'bondRegister']) {
    delete tables[table];
  }

  for (const row of tables.settings as Record<string, unknown>[]) {
    for (const column of EARLIER_BUILD_SETTINGS_COLUMNS) {
      delete row[column];
    }
  }

  return { exportedAt: 1, appVersion: '1.0.0', tables, secrets };
};

const versionOneFile = (payload: unknown): string => {
  const key = generateExportKey();
  const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(payload)), key);

  mockReadFile.mockResolvedValue(JSON.stringify({ ...envelope, version: 1 }));

  return encodeBytesToBase64(key);
};

const importVersionOne = async (payload: unknown) =>
  importData({ fileUri: '/tmp/earlier.kiko', keyBase64: versionOneFile(payload) });

const storedAccountIds = (): string[] =>
  (mockDatabase.prepare('SELECT id FROM accounts ORDER BY id').all() as { id: string }[]).map(
    ({ id }) => id,
  );

const storedImportTime = (): number =>
  (mockDatabase.prepare("SELECT time FROM transactions WHERE id = 't1'").get() as { time: number })
    .time;

const importTimesRezoned = (): number =>
  (
    mockDatabase
      .prepare('SELECT import_times_rezoned AS flag FROM settings WHERE id = 1')
      .get() as {
      flag: number;
    }
  ).flag;

describe('importing a version 1 file an earlier build wrote', () => {
  beforeEach(() => {
    mockSaveToken.mockReset().mockResolvedValue(undefined);
    mockSaveCredentials.mockReset().mockResolvedValue(undefined);
  });

  describe('exported without keys', () => {
    it.each([
      ['no secrets block', undefined],
      ['an empty secrets block', {}],
      ['both arrays empty', { monobankTokens: [], binanceCredentials: [] }],
    ])('restores the data from a file with %s and writes no secret', async (_name, secrets) => {
      const payload = await earlierBuildPayload(secrets);
      mockDatabase = openDatabase(['other']);

      const summary = await importVersionOne(payload);

      expect(storedAccountIds()).toEqual(['bin1', 'mono1']);
      expect(summary.accountsRestored).toBe(2);
      expect(summary.unrestoredCredentials).toEqual([]);
      expect(mockSaveToken).not.toHaveBeenCalled();
      expect(mockSaveCredentials).not.toHaveBeenCalled();
    });
  });

  describe('exported with keys', () => {
    it('restores the data and writes each key to its own account', async () => {
      const payload = await earlierBuildPayload({
        monobankTokens: [{ accountId: 'mono1', token: 'mono-token' }],
        binanceCredentials: [{ accountId: 'bin1', apiKey: 'api-key', secret: 'api-secret' }],
      });
      mockDatabase = openDatabase();

      const summary = await importVersionOne(payload);

      expect(storedAccountIds()).toEqual(['bin1', 'mono1']);
      expect(mockSaveToken).toHaveBeenCalledWith('mono1', 'mono-token');
      expect(mockSaveCredentials).toHaveBeenCalledWith('bin1', {
        apiKey: 'api-key',
        secret: 'api-secret',
      });
      expect(summary.unrestoredCredentials).toEqual([]);
    });

    // The share prices key was removed before any build with it shipped; an
    // export made on a development build may still carry it, and it is
    // dropped without a Keychain write or a failure.
    it('restores the data and ignores an eodhdKey from an older build', async () => {
      const payload = await earlierBuildPayload({
        monobankTokens: [{ accountId: 'mono1', token: 'mono-token' }],
        binanceCredentials: [{ accountId: 'bin1', apiKey: 'api-key', secret: 'api-secret' }],
        eodhdKey: 'fake-eodhd-key-0000',
      });
      mockDatabase = openDatabase();

      const summary = await importVersionOne(payload);

      expect(storedAccountIds()).toEqual(['bin1', 'mono1']);
      expect(mockSaveToken).toHaveBeenCalledTimes(1);
      expect(mockSaveCredentials).toHaveBeenCalledTimes(1);
      expect(summary.unrestoredCredentials).toEqual([]);
    });
  });

  describe('exported after an account was deleted', () => {
    it('restores the data, drops the secret of the deleted account, and keeps the others', async () => {
      const payload = await earlierBuildPayload({
        monobankTokens: [
          { accountId: 'mono-deleted', token: 'old-token' },
          { accountId: 'mono1', token: 'mono-token' },
        ],
        binanceCredentials: [{ accountId: 'bin-deleted', apiKey: 'k', secret: 's' }],
      });
      mockDatabase = openDatabase();

      const summary = await importVersionOne(payload);

      expect(storedAccountIds()).toEqual(['bin1', 'mono1']);
      expect(mockSaveToken).toHaveBeenCalledTimes(1);
      expect(mockSaveToken).toHaveBeenCalledWith('mono1', 'mono-token');
      expect(mockSaveCredentials).not.toHaveBeenCalled();
      expect(summary.unrestoredCredentials).toEqual([]);
    });
  });

  describe('a file written before the import times were rezoned', () => {
    it('shifts a statement-import row from its wall clock read as UTC to the Kyiv instant', async () => {
      const payload = await earlierBuildPayload(undefined, insertLegacyImportRow);
      mockDatabase = openDatabase();

      await importVersionOne(payload);

      expect(storedImportTime()).toBe(REZONED_IMPORT_TIME);
      expect(storedImportTime()).not.toBe(LEGACY_IMPORT_TIME);
      expect(importTimesRezoned()).toBe(1);
    });
  });

  describe('the demo file release 1.1 wrote', () => {
    // A frozen copy of the English demo file as 1.1 wrote it: export version 1,
    // none of the settings columns of 1.2. It shares the demo key.
    it('restores, and its settings row is marked rezoned', async () => {
      mockReadFile.mockResolvedValue(
        readFileSync(join(DEMO_FIXTURES, 'kiko-demo-en-1.1.kiko'), 'utf8'),
      );
      mockDatabase = openDatabase();

      const summary = await importData({
        fileUri: '/tmp/demo.kiko',
        keyBase64: readFileSync(join(DEMO_FIXTURES, 'kiko-demo.key'), 'utf8').trim(),
      });

      expect(summary.accountsRestored).toBe(8);
      expect(summary.holdingsRestored).toBe(13);
      expect(summary.transactionsRestored).toBe(71);
      expect(storedAccountIds()).toHaveLength(8);
      expect(summary.unrestoredCredentials).toEqual([]);
      expect(importTimesRezoned()).toBe(1);
    });
  });

  describe('when the Keychain refuses a key after the data committed', () => {
    it('is a success with the connection to set up again, not a failed import', async () => {
      const payload = await earlierBuildPayload({
        monobankTokens: [{ accountId: 'mono1', token: 'mono-token' }],
        binanceCredentials: [{ accountId: 'bin1', apiKey: 'api-key', secret: 'api-secret' }],
      });
      mockDatabase = openDatabase();
      mockSaveToken.mockRejectedValue(new Error('keychain write failed'));
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const summary = await importVersionOne(payload);

      expect(storedAccountIds()).toEqual(['bin1', 'mono1']);
      expect(summary.unrestoredCredentials).toEqual(['monobank']);
      expect(mockSaveCredentials).toHaveBeenCalledTimes(1);
    });
  });
});
