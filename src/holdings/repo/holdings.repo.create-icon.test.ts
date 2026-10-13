// The icon is part of the create input and goes in the same write as the row.
// A second write for it could fail after the row exists, and the form's retry
// would then insert the holding again. The rollback is a SQL behaviour, so
// only a real engine shows it.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { holdingsRepo } from './holdings.repo';

type HoldingRecord = { id: string; icon: string | null; color: string | null };

const storedHoldings = (): HoldingRecord[] =>
  mockDatabase.prepare('SELECT id, icon, color FROM holdings').all() as HoldingRecord[];

const flat = {
  accountId: 'property-account',
  name: 'Flat',
  type: 'property_item',
  currency: 'USD',
} as const;

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind) VALUES ('property-account', 'Properties', 'property')",
    )
    .run();
});

describe('holdingsRepo.create: the icon', () => {
  it('stores the icon passed to create on the new row', async () => {
    const holdingId = await holdingsRepo.create({ ...flat, icon: 'house', color: '#112233' });

    expect(storedHoldings()).toEqual([{ id: holdingId, icon: 'house', color: '#112233' }]);
  });

  it('stores no icon when none is passed, or when it is null', async () => {
    await holdingsRepo.create(flat);
    await holdingsRepo.create({ ...flat, icon: null });

    expect(storedHoldings().map((holding) => holding.icon)).toEqual([null, null]);
  });

  it('a failure after the row insert rolls the whole create back, so a retry cannot duplicate it', async () => {
    const failingFirstPricePoint = { day: 1, price: null } as unknown as {
      day: number;
      price: string;
    };

    await expect(
      holdingsRepo.create({ ...flat, icon: 'house', firstPricePoint: failingFirstPricePoint }),
    ).rejects.toHaveProperty('cause.message', 'NOT NULL constraint failed: price_points.price');

    expect(storedHoldings()).toEqual([]);
  });
});
