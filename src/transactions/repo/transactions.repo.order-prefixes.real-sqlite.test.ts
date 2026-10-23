// `importedOrderPrefixesQuery` answers "which of these order key prefixes already have a stored
// row" with one range read per prefix on the `(source, external_id)` unique index. Only a real
// engine proves the range edges, the `source` filter and the index the planner picks.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const TIME = Date.UTC(2026, 8, 20, 10);

const seedRows = async (
  externalIds: string[],
  source: 'binance' | 'monobank' = 'binance',
): Promise<void> => {
  await transactionsRepo.addManyDedup(
    externalIds.map((externalId) => ({
      holdingId: 'spot',
      amountMinorUnits: 100,
      time: TIME,
      source,
      externalId,
    })),
  );
};

type PreparedStatement = { sql: string; parameters: unknown[] };

const recordReads = (): PreparedStatement[] => {
  const statements: PreparedStatement[] = [];
  const prepare = mockDatabase.prepare.bind(mockDatabase);

  jest.spyOn(mockDatabase, 'prepare').mockImplementation((sql: string) => {
    const statement = prepare(sql);
    const all = statement.all.bind(statement);

    statement.all = (...parameters: never[]) => {
      statements.push({ sql, parameters });

      return all(...parameters);
    };

    return statement;
  });

  return statements;
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  mockDatabase.exec(
    "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Binance', 'crypto')",
  );
  mockDatabase.exec(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES
      ('spot', 'account', 'Bitcoin', 'crypto_asset', 'BTC', 0)`,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('transactionsRepo.importedOrderPrefixesQuery', () => {
  it('returns the prefixes a stored row of the asked source starts with, and no others', async () => {
    await seedRows(['pair-1:buy', 'pair-1:sell', 'pair-3:buy']);

    const found = await transactionsRepo.importedOrderPrefixesQuery('binance', [
      'pair-1:',
      'pair-2:',
      'pair-3:',
    ]);

    expect([...found].sort()).toEqual(['pair-1:', 'pair-3:']);
  });

  it('does not count a row of another source whose key starts with the prefix', async () => {
    await seedRows(['pair-1:buy'], 'monobank');

    const found = await transactionsRepo.importedOrderPrefixesQuery('binance', ['pair-1:']);

    expect(found.size).toBe(0);
  });

  it('does not match an order whose id only starts with the digits of the prefix', async () => {
    await seedRows(['pair-123:buy']);

    const found = await transactionsRepo.importedOrderPrefixesQuery('binance', [
      'pair-12:',
      'pair-123:',
    ]);

    expect([...found]).toEqual(['pair-123:']);
  });

  it('matches a stored key that is exactly the prefix', async () => {
    await seedRows(['pair-1:']);

    const found = await transactionsRepo.importedOrderPrefixesQuery('binance', ['pair-1:']);

    expect([...found]).toEqual(['pair-1:']);
  });

  it('does not match a key that sorts just past the prefix range', async () => {
    await seedRows(['pair-1;buy', 'pair-0:buy']);

    const found = await transactionsRepo.importedOrderPrefixesQuery('binance', ['pair-1:']);

    expect(found.size).toBe(0);
  });

  it('treats a percent sign or underscore in a prefix as plain text', async () => {
    await seedRows(['pair-1:buy']);

    const found = await transactionsRepo.importedOrderPrefixesQuery('binance', [
      'pair%:',
      'pair_1:',
    ]);

    expect(found.size).toBe(0);
  });

  it('returns the prefix from whichever holding stores the row', async () => {
    mockDatabase.exec(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES
        ('funding', 'account', 'Funding', 'crypto_asset', 'BTC', 0)`,
    );
    await transactionsRepo.addManyDedup([
      {
        holdingId: 'funding',
        amountMinorUnits: 100,
        time: TIME,
        source: 'binance',
        externalId: 'pair-9:buy',
      },
    ]);

    const found = await transactionsRepo.importedOrderPrefixesQuery('binance', ['pair-9:']);

    expect([...found]).toEqual(['pair-9:']);
  });

  it('sends no query for an empty list', async () => {
    const statements = recordReads();

    const found = await transactionsRepo.importedOrderPrefixesQuery('binance', []);

    expect(found.size).toBe(0);
    expect(statements).toEqual([]);
  });

  it('sends one query for a page of prefixes', async () => {
    await seedRows(['pair-5:buy']);
    const statements = recordReads();

    await transactionsRepo.importedOrderPrefixesQuery('binance', ['pair-4:', 'pair-5:', 'pair-6:']);

    expect(statements).toHaveLength(1);
  });

  it('answers a thousand prefixes in one page', async () => {
    await seedRows(['pair-777:buy']);
    const prefixes = Array.from({ length: 1_000 }, (_, index) => `pair-${index}:`);

    const found = await transactionsRepo.importedOrderPrefixesQuery('binance', prefixes);

    expect([...found]).toEqual(['pair-777:']);
  });

  it('searches the source and external id unique index with a range, never scanning the ledger', async () => {
    await seedRows(['pair-1:buy']);
    const statements = recordReads();

    await transactionsRepo.importedOrderPrefixesQuery('binance', ['pair-1:', 'pair-2:']);

    const [read] = statements;
    const plan = (
      mockDatabase
        .prepare(`EXPLAIN QUERY PLAN ${read?.sql}`)
        .all(...((read?.parameters ?? []) as (string | number)[])) as { detail: string }[]
    ).map((step) => step.detail);

    expect(plan).toContainEqual(
      expect.stringMatching(
        /SEARCH transactions USING (COVERING )?INDEX transactions_source_external \(source=\? AND external_id>\? AND external_id<\?\)/,
      ),
    );
    expect(plan.some((detail) => detail.includes('SCAN transactions'))).toBe(false);
  });
});
