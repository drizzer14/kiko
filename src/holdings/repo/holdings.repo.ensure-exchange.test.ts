// `ensureExchangeHoldings` must never touch a row that already exists, open or
// closed: the fake `databaseTransaction` in `holdings.repo.test.ts` cannot tell
// an insert from a blind overwrite, so this file applies the REAL, shipped
// migration SQL (`applyAllMigrations`) to an in-process `node:sqlite` engine and
// routes the repo's own `write(...)` through `executingDrizzle` against it.
let mockWorkDatabase: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockWorkDatabase),
  };
});

import { asc } from 'drizzle-orm';
import { DatabaseSync } from 'node:sqlite';
import { type database, holdings } from '@kiko/db';
import { applyAllMigrations, executingDrizzle } from '@kiko/test-support/real-sqlite';

import { holdingsRepo } from './holdings.repo';

const openTestDatabase = (
  institution: string | null = 'binance',
): { rawDatabase: DatabaseSync; drizzleDatabase: typeof database } => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Binance', 'crypto', ?)",
    )
    .run(institution);
  rawDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-2', 'Binance 2', 'crypto', ?)",
    )
    .run(institution);
  const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);
  mockWorkDatabase = drizzleDatabase;

  return { rawDatabase, drizzleDatabase };
};

const FUNDING = {
  accountId: 'acc-1',
  name: 'Binance Funding',
  type: 'crypto_asset',
  currency: 'BTC',
  balanceMinorUnits: 0,
  metadataField: 'binanceAsset',
  metadataKey: 'BTC:funding',
} as const;

const insertFunding = (
  rawDatabase: DatabaseSync,
  row: { id: string; accountId: string; balance: number; closedAt: number | null },
): void => {
  rawDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata, closed_at)
       VALUES (?, ?, 'My Funding', 'crypto_asset', 'BTC', ?, ?, ?)`,
    )
    .run(
      row.id,
      row.accountId,
      row.balance,
      JSON.stringify({ binanceAsset: 'BTC:funding', syncedAt: 500 }),
      row.closedAt,
    );
};

describe('holdingsRepo.ensureExchangeHoldings', () => {
  it('inserts a missing key at the given balance with only the key in its metadata', async () => {
    const { drizzleDatabase } = openTestDatabase();

    await holdingsRepo.ensureExchangeHoldings([FUNDING]);

    const rows = await drizzleDatabase.select().from(holdings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: 'acc-1',
      name: 'Binance Funding',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 0,
      closedAt: null,
    });
    expect(rows[0].metadata).toEqual({ binanceAsset: 'BTC:funding' });
  });

  it('is a no-op on a disconnected account: no holding is created', async () => {
    const { drizzleDatabase } = openTestDatabase(null);

    await holdingsRepo.ensureExchangeHoldings([FUNDING]);

    expect(await drizzleDatabase.select().from(holdings)).toEqual([]);
  });

  it('skips a disconnected account but still creates the connected one in the same batch', async () => {
    const { rawDatabase, drizzleDatabase } = openTestDatabase();
    rawDatabase.prepare("UPDATE accounts SET institution = NULL WHERE id = 'acc-2'").run();

    await holdingsRepo.ensureExchangeHoldings([FUNDING, { ...FUNDING, accountId: 'acc-2' }]);

    const rows = await drizzleDatabase.select().from(holdings);
    expect(rows.map((row) => row.accountId)).toEqual(['acc-1']);
  });

  it.each([
    ['open', 5, null],
    ['CLOSED', 7, 1_000],
  ])(
    'leaves an existing %s row untouched: balance, name, close mark, and metadata, with no second row',
    async (_state, balance, closedAt) => {
      const { rawDatabase, drizzleDatabase } = openTestDatabase();
      insertFunding(rawDatabase, { id: 'h-funding', accountId: 'acc-1', balance, closedAt });

      await holdingsRepo.ensureExchangeHoldings([FUNDING]);

      const rows = await drizzleDatabase.select().from(holdings);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: 'h-funding',
        name: 'My Funding',
        balanceMinorUnits: balance,
        closedAt,
      });
      expect(rows[0].metadata).toEqual({ binanceAsset: 'BTC:funding', syncedAt: 500 });
    },
  );

  it('does not count a key of ANOTHER account as existing', async () => {
    const { rawDatabase, drizzleDatabase } = openTestDatabase();
    insertFunding(rawDatabase, { id: 'h-other', accountId: 'acc-2', balance: 9, closedAt: null });

    await holdingsRepo.ensureExchangeHoldings([FUNDING]);

    const rows = await drizzleDatabase.select().from(holdings).orderBy(asc(holdings.name));
    expect(rows.map((row) => [row.accountId, row.balanceMinorUnits])).toEqual([
      ['acc-1', 0],
      ['acc-2', 9],
    ]);
  });

  it('inserts only the missing keys of one batch', async () => {
    const { rawDatabase, drizzleDatabase } = openTestDatabase();
    insertFunding(rawDatabase, { id: 'h-funding', accountId: 'acc-1', balance: 5, closedAt: null });

    await holdingsRepo.ensureExchangeHoldings([
      FUNDING,
      { ...FUNDING, name: 'Binance Earn', metadataKey: 'BTC:earn' },
    ]);

    const rows = await drizzleDatabase.select().from(holdings);
    expect(rows.map((row) => row.name).sort()).toEqual(['Binance Earn', 'My Funding']);
  });
});
