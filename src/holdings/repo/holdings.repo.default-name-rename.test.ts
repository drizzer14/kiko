// The transition rename of a Binance BTC holding from an earlier default name runs ONCE per
// holding. The fake `databaseTransaction` in `holdings.repo.test.ts` keeps no row between two
// upserts, so a mark that must stop the NEXT sync can only be proven on a real engine: the REAL,
// shipped migration SQL (`applyAllMigrations`) on an in-process `node:sqlite`, with the repo's own
// `write(...)` routed through `executingDrizzle` against it.
let mockWorkDatabase: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockWorkDatabase),
  };
});

import type { database } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations, executingDrizzle } from '@kiko/test-support/real-sqlite';

import { holdingsRepo } from './holdings.repo';

const MARK = 'defaultNameRenameSettled';

const openTestDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('acc-1', 'Binance', 'crypto')")
    .run();
  mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

  return rawDatabase;
};

const seedHolding = (rawDatabase: DatabaseSync, name: string, metadataKey: string): void => {
  rawDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('h-1', 'acc-1', ?, 'crypto_asset', 'BTC', 100, ?)`,
    )
    .run(name, JSON.stringify({ binanceAsset: metadataKey, syncedAt: 500 }));
};

const renameByUser = (rawDatabase: DatabaseSync, name: string): void => {
  rawDatabase.prepare('UPDATE holdings SET name = ?').run(name);
};

const stored = (rawDatabase: DatabaseSync): { name: string; metadata: Record<string, unknown> } => {
  const row = rawDatabase.prepare('SELECT name, metadata FROM holdings').get() as {
    name: string;
    metadata: string;
  };

  return { name: row.name, metadata: JSON.parse(row.metadata) };
};

// The exact shape a balance sync writes for a BTC balance: a fresh `{ syncedAt }` object, the new
// default name, and the wallet's earlier default names.
const syncOf = (name: string, metadataKey: string, renameFromDefaults?: readonly string[]) =>
  holdingsRepo.upsertExchangeMany([
    {
      accountId: 'acc-1',
      name,
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 250,
      metadata: { syncedAt: 2_000 },
      metadataField: 'binanceAsset',
      metadataKey,
      renameFromDefaults,
    },
  ]);

const SPOT_DEFAULTS = ['Binance BTC', 'Binance Spot'];

const WALLETS: [string, string, string, string[]][] = [
  ['Spot', 'BTC', 'Binance Spot · BTC', SPOT_DEFAULTS],
  ['Funding', 'BTC:funding', 'Binance Funding · BTC', ['Binance Funding']],
  ['Earn', 'BTC:earn', 'Binance Earn · BTC', ['Binance Earn']],
];

describe('holdingsRepo.upsertExchangeMany — the default-name rename runs once per holding', () => {
  it.each(WALLETS)(
    'the first sync after the upgrade renames a %s holding still on an old default once and marks it',
    async (_wallet, metadataKey, name, defaults) => {
      const rawDatabase = openTestDatabase();
      seedHolding(rawDatabase, defaults[0], metadataKey);

      await syncOf(name, metadataKey, defaults);

      expect(stored(rawDatabase)).toEqual({
        name,
        metadata: { binanceAsset: metadataKey, syncedAt: 2_000, [MARK]: true },
      });
    },
  );

  it.each(WALLETS)(
    'a %s holding the user renames back to an old default survives the next sync',
    async (_wallet, metadataKey, name, defaults) => {
      const rawDatabase = openTestDatabase();
      seedHolding(rawDatabase, defaults[0], metadataKey);
      await syncOf(name, metadataKey, defaults);

      for (const oldDefault of defaults) {
        renameByUser(rawDatabase, oldDefault);
        await syncOf(name, metadataKey, defaults);

        expect(stored(rawDatabase).name).toBe(oldDefault);
      }
    },
  );

  it('a later user rename is not touched by the sync after the first one', async () => {
    const rawDatabase = openTestDatabase();
    seedHolding(rawDatabase, 'Binance BTC', 'BTC');
    await syncOf('Binance Spot · BTC', 'BTC', SPOT_DEFAULTS);
    renameByUser(rawDatabase, 'My stack');

    await syncOf('Binance Spot · BTC', 'BTC', SPOT_DEFAULTS);

    expect(stored(rawDatabase).name).toBe('My stack');
  });

  it('marks a holding that already has a custom name on its first sync, so a later rename-back survives', async () => {
    const rawDatabase = openTestDatabase();
    seedHolding(rawDatabase, 'My stack', 'BTC');

    await syncOf('Binance Spot · BTC', 'BTC', SPOT_DEFAULTS);

    expect(stored(rawDatabase)).toEqual({
      name: 'My stack',
      metadata: { binanceAsset: 'BTC', syncedAt: 2_000, [MARK]: true },
    });

    renameByUser(rawDatabase, 'Binance Spot');
    await syncOf('Binance Spot · BTC', 'BTC', SPOT_DEFAULTS);

    expect(stored(rawDatabase).name).toBe('Binance Spot');
  });

  it('marks a holding the sync inserts, so a user rename to an old default survives', async () => {
    const rawDatabase = openTestDatabase();
    await syncOf('Binance Funding · BTC', 'BTC:funding', ['Binance Funding']);

    expect(stored(rawDatabase).metadata).toEqual({
      binanceAsset: 'BTC:funding',
      syncedAt: 2_000,
      [MARK]: true,
    });

    renameByUser(rawDatabase, 'Binance Funding');
    await syncOf('Binance Funding · BTC', 'BTC:funding', ['Binance Funding']);

    expect(stored(rawDatabase).name).toBe('Binance Funding');
  });

  it('keeps the mark through a sync that carries no rename defaults', async () => {
    const rawDatabase = openTestDatabase();
    seedHolding(rawDatabase, 'Binance BTC', 'BTC');
    await syncOf('Binance Spot · BTC', 'BTC', SPOT_DEFAULTS);

    await syncOf('Binance Spot · BTC', 'BTC');

    expect(stored(rawDatabase).metadata).toMatchObject({ [MARK]: true });
  });

  it('never marks a holding whose sync carries no rename defaults', async () => {
    const rawDatabase = openTestDatabase();

    await syncOf('Binance Spot · USDT', 'USDT');

    expect(stored(rawDatabase).metadata).toEqual({ binanceAsset: 'USDT', syncedAt: 2_000 });
  });
});
