// The stored set of the Funding ledger on a real `node:sqlite` engine with the shipped migrations
// and foreign keys on: the read of one account, the upsert and the delete by key, and the prune.
// Each statement filters by `account_id`, so a row of another account is never read, changed or
// removed (A88, store part).
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { databaseClientOver } = require('@kiko/test-support/real-sqlite');

  return databaseClientOver(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { type FundingMatchRow, write } from '@kiko/db';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { bybitFundingMatchRepo } from './bybit.funding-match.repo';

const ACCOUNT = 'acc-1';
const OTHER_ACCOUNT = 'acc-2';

const rowOf = (overrides: Partial<FundingMatchRow> = {}): FundingMatchRow => ({
  accountId: ACCOUNT,
  side: 'ledger',
  recordKey: 'key-1',
  series: null,
  coin: 'USDT',
  direction: 'I',
  amount: '100',
  fee: null,
  tax: null,
  timeStart: 1_000,
  timeEnd: 1_000,
  earnPrincipal: false,
  ...overrides,
});

const storedRows = (accountId: string): { side: string; recordKey: string }[] =>
  (
    mockDatabase
      .prepare(
        `SELECT side, record_key AS recordKey FROM funding_match_rows
         WHERE account_id = ? ORDER BY side, record_key`,
      )
      .all(accountId) as { side: string; recordKey: string }[]
  ).map(({ side, recordKey }) => ({ side, recordKey }));

const keysOf = (count: number): string[] => Array.from({ length: count }, (_, at) => `key-${at}`);

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');

  for (const id of [ACCOUNT, OTHER_ACCOUNT]) {
    mockDatabase
      .prepare('INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, ?, ?)')
      .run(id, 'Bybit', 'crypto', 'bybit');
  }
});

describe('bybitFundingMatchRepo', () => {
  describe('readByAccount', () => {
    it('reads every stored row of the account with each column, and no row of another account', async () => {
      const ledger = rowOf({ earnPrincipal: true });
      const source = rowOf({
        side: 'source',
        recordKey: 'withdrawal-1',
        series: 'withdraw',
        direction: 'O',
        amount: '99.5',
        fee: '0.5',
        tax: '0.1',
        timeStart: 2_000,
        timeEnd: 3_000,
      });

      await write((databaseTransaction) =>
        bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, [
          ledger,
          source,
          rowOf({ accountId: OTHER_ACCOUNT }),
        ]),
      );

      const stored = await bybitFundingMatchRepo.readByAccount(ACCOUNT);

      expect(stored).toHaveLength(2);
      expect(stored).toEqual(expect.arrayContaining([ledger, source]));
    });

    it('reads an empty list for an account with no stored row', async () => {
      await expect(bybitFundingMatchRepo.readByAccount(ACCOUNT)).resolves.toEqual([]);
    });
  });

  describe('upsertDatabaseTransaction', () => {
    it('keeps one row per account, side and key, and rewrites each column of a row it already holds', async () => {
      await write((databaseTransaction) =>
        bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, [rowOf()]),
      );

      const changed = rowOf({
        series: 'convert',
        coin: 'BTC',
        direction: 'O',
        amount: '0.5',
        fee: '0.01',
        tax: '0.02',
        timeStart: 5_000,
        timeEnd: 6_000,
        earnPrincipal: true,
      });

      await write((databaseTransaction) =>
        bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, [changed]),
      );

      await expect(bybitFundingMatchRepo.readByAccount(ACCOUNT)).resolves.toEqual([changed]);
    });

    it('holds a ledger row and a source row of the same key apart, as two keys', async () => {
      await write((databaseTransaction) =>
        bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, [
          rowOf({ side: 'ledger' }),
          rowOf({ side: 'source' }),
        ]),
      );

      expect(storedRows(ACCOUNT)).toEqual([
        { side: 'ledger', recordKey: 'key-1' },
        { side: 'source', recordKey: 'key-1' },
      ]);
    });

    it('writes nothing for an empty list', async () => {
      await expect(
        write((databaseTransaction) =>
          bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, []),
        ),
      ).resolves.toBeUndefined();

      expect(storedRows(ACCOUNT)).toEqual([]);
    });

    it('stores a batch past the bound parameter limit of one statement, each row once', async () => {
      const rows = keysOf(7_000).map((recordKey) => rowOf({ recordKey }));

      await write((databaseTransaction) =>
        bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, rows),
      );

      expect(storedRows(ACCOUNT)).toHaveLength(7_000);
    });

    it('refuses a row of an account that does not exist, and the whole batch rolls back', async () => {
      await expect(
        write((databaseTransaction) =>
          bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, [
            rowOf({ recordKey: 'kept-out' }),
            rowOf({ accountId: 'no-such-account' }),
          ]),
        ),
      ).rejects.toHaveProperty('cause.message', 'FOREIGN KEY constraint failed');

      expect(storedRows(ACCOUNT)).toEqual([]);
    });
  });

  describe('removeDatabaseTransaction', () => {
    it('removes only the named keys of the named side of the named account', async () => {
      await write((databaseTransaction) =>
        bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, [
          rowOf({ recordKey: 'a' }),
          rowOf({ recordKey: 'b' }),
          rowOf({ recordKey: 'a', side: 'source' }),
          rowOf({ recordKey: 'a', accountId: OTHER_ACCOUNT }),
        ]),
      );

      await write((databaseTransaction) =>
        bybitFundingMatchRepo.removeDatabaseTransaction(databaseTransaction, ACCOUNT, 'ledger', [
          'a',
          'missing',
        ]),
      );

      expect(storedRows(ACCOUNT)).toEqual([
        { side: 'ledger', recordKey: 'b' },
        { side: 'source', recordKey: 'a' },
      ]);
      expect(storedRows(OTHER_ACCOUNT)).toEqual([{ side: 'ledger', recordKey: 'a' }]);
    });

    it('removes nothing for an empty list of keys', async () => {
      await write((databaseTransaction) =>
        bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, [rowOf()]),
      );

      await write((databaseTransaction) =>
        bybitFundingMatchRepo.removeDatabaseTransaction(databaseTransaction, ACCOUNT, 'ledger', []),
      );

      expect(storedRows(ACCOUNT)).toEqual([{ side: 'ledger', recordKey: 'key-1' }]);
    });

    it('removes a list of keys past the bound parameter limit of one statement', async () => {
      const rows = keysOf(33_000).map((recordKey) => rowOf({ recordKey }));

      await write(async (databaseTransaction) => {
        await bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, rows);
        await bybitFundingMatchRepo.removeDatabaseTransaction(
          databaseTransaction,
          ACCOUNT,
          'ledger',
          keysOf(33_000).slice(1),
        );
      });

      expect(storedRows(ACCOUNT)).toEqual([{ side: 'ledger', recordKey: 'key-0' }]);
    });
  });

  describe('pruneDatabaseTransaction', () => {
    it('removes the rows of the account that end before the time, on both sides, and keeps a row that ends at it', async () => {
      await write((databaseTransaction) =>
        bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, [
          rowOf({ recordKey: 'old-ledger', timeStart: 100, timeEnd: 100 }),
          rowOf({ recordKey: 'old-source', side: 'source', timeStart: 100, timeEnd: 499 }),
          rowOf({ recordKey: 'at-bound', timeStart: 500, timeEnd: 500 }),
          rowOf({ recordKey: 'extent-across', side: 'source', timeStart: 100, timeEnd: 900 }),
          rowOf({ recordKey: 'other', accountId: OTHER_ACCOUNT, timeStart: 1, timeEnd: 1 }),
        ]),
      );

      await write((databaseTransaction) =>
        bybitFundingMatchRepo.pruneDatabaseTransaction(databaseTransaction, ACCOUNT, 500),
      );

      expect(storedRows(ACCOUNT)).toEqual([
        { side: 'ledger', recordKey: 'at-bound' },
        { side: 'source', recordKey: 'extent-across' },
      ]);
      expect(storedRows(OTHER_ACCOUNT)).toEqual([{ side: 'ledger', recordKey: 'other' }]);
    });
  });

  it('rolls back an upsert, a remove and a prune of one write together when it throws', async () => {
    await write((databaseTransaction) =>
      bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, [
        rowOf({ recordKey: 'stays', timeEnd: 10 }),
      ]),
    );

    await expect(
      write(async (databaseTransaction) => {
        await bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, [
          rowOf({ recordKey: 'new' }),
        ]);
        await bybitFundingMatchRepo.removeDatabaseTransaction(
          databaseTransaction,
          ACCOUNT,
          'ledger',
          ['stays'],
        );
        await bybitFundingMatchRepo.pruneDatabaseTransaction(
          databaseTransaction,
          ACCOUNT,
          1_000_000,
        );

        throw new Error('the write failed');
      }),
    ).rejects.toThrow('the write failed');

    expect(storedRows(ACCOUNT)).toEqual([{ side: 'ledger', recordKey: 'stays' }]);
  });
});
