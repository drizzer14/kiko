// The sync-close and reopen pair of a Monobank holding, against the REAL
// shipped schema: `holdings.repo.test.ts`'s fake handle never enforces a stored
// row, so it could not tell a mark kept from a mark dropped. The `write` mock
// routes the repo's own write through `executingDrizzle`, the same shape
// `holdings.repo.walk-owned-metadata.test.ts` uses.
let mockWorkDatabase: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockWorkDatabase),
  };
});

import { eq } from 'drizzle-orm';
import { DatabaseSync } from 'node:sqlite';
import { type database, holdings } from '@kiko/db';
import { applyAllMigrations, executingDrizzle } from '@kiko/test-support/real-sqlite';

import { holdingsRepo } from './holdings.repo';

type SeedHolding = {
  id: string;
  type?: 'card' | 'jar' | 'crypto_asset';
  keyField?: 'monobankId' | 'walletAddress';
  key: string;
  closedAt?: number | null;
  extraMetadata?: Record<string, unknown>;
};

const openTestDatabase = () => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('acc-1', 'Monobank', 'bank')")
    .run();
  const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);
  mockWorkDatabase = drizzleDatabase;

  const seed = ({
    id,
    type = 'card',
    keyField = 'monobankId',
    key,
    closedAt = null,
    extraMetadata,
  }: SeedHolding) =>
    rawDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata, closed_at)
         VALUES (?, 'acc-1', 'Black', ?, 'UAH', 100, ?, ?)`,
      )
      .run(
        id,
        type,
        JSON.stringify({ [keyField]: key, syncedAt: 500, ...extraMetadata }),
        closedAt,
      );

  const rowOf = async (id: string) =>
    (await drizzleDatabase.select().from(holdings).where(eq(holdings.id, id)))[0];

  return { seed, rowOf };
};

const upsertMonobank = (monobankId: string, type: 'card' | 'jar' = 'card') =>
  holdingsRepo.upsertMonobankMany([
    {
      accountId: 'acc-1',
      name: 'Black',
      type,
      currency: 'UAH',
      balanceMinorUnits: 250,
      metadata: { syncedAt: 2_000 },
      monobankId,
    },
  ]);

describe('holdingsRepo.closeManyBySync', () => {
  it('stamps closedAt and the sync-close mark, keeping every other metadata key', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-1', key: 'card-1', extraMetadata: { iban: 'UA1' } });

    await holdingsRepo.closeManyBySync(['h-1'], 1_000);

    const row = await rowOf('h-1');

    expect(row.closedAt).not.toBeNull();
    expect(row.metadata).toEqual({
      monobankId: 'card-1',
      syncedAt: 500,
      iban: 'UA1',
      syncClosedFromMs: 1_000,
    });
  });

  it('keeps the earlier of the close instant and a pending statementFromMs (matrix row 6)', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-1', key: 'card-1', extraMetadata: { statementFromMs: 400 } });
    seed({ id: 'h-2', key: 'card-2', extraMetadata: { statementFromMs: 9_000 } });

    await holdingsRepo.closeManyBySync(['h-1', 'h-2'], 1_000);

    expect((await rowOf('h-1')).metadata).toMatchObject({ syncClosedFromMs: 400 });
    expect((await rowOf('h-2')).metadata).toMatchObject({ syncClosedFromMs: 1_000 });
  });

  it('is a no-op for an empty set', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-1', key: 'card-1' });

    await holdingsRepo.closeManyBySync([], 1_000);

    expect((await rowOf('h-1')).closedAt).toBeNull();
  });

  it('never marks or moves a holding that is already closed (the first mark is kept)', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-user', key: 'card-user', closedAt: 77 });
    seed({
      id: 'h-sync',
      key: 'card-sync',
      closedAt: 88,
      extraMetadata: { syncClosedFromMs: 300 },
    });

    await holdingsRepo.closeManyBySync(['h-user', 'h-sync'], 1_000);

    const user = await rowOf('h-user');
    const sync = await rowOf('h-sync');

    expect(user.closedAt).toBe(77);
    expect(user.metadata).toEqual({ monobankId: 'card-user', syncedAt: 500 });
    expect(sync.closedAt).toBe(88);
    expect(sync.metadata).toMatchObject({ syncClosedFromMs: 300 });
  });
});

describe('holdingsRepo.closeMany (the user close)', () => {
  it('writes no sync-close mark', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-1', key: 'card-1' });

    await holdingsRepo.closeMany(['h-1']);

    const row = await rowOf('h-1');

    expect(row.closedAt).not.toBeNull();
    expect(row.metadata).toEqual({ monobankId: 'card-1', syncedAt: 500 });
  });
});

describe('holdingsRepo.clearStatementFrom', () => {
  it('drops statementFromMs and keeps every other key', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-1', key: 'card-1', extraMetadata: { statementFromMs: 400 } });

    await holdingsRepo.clearStatementFrom('h-1');

    expect((await rowOf('h-1')).metadata).toEqual({ monobankId: 'card-1', syncedAt: 500 });
  });

  it('leaves a holding without the key untouched', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-1', key: 'card-1' });

    await holdingsRepo.clearStatementFrom('h-1');

    expect((await rowOf('h-1')).metadata).toEqual({ monobankId: 'card-1', syncedAt: 500 });
  });
});

describe('the reopen of a sync-closed holding in upsertMonobankMany', () => {
  it('reopens a sync-closed card: closedAt cleared, mark dropped, statementFromMs = the mark (row 3)', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-1', key: 'card-1', closedAt: 77, extraMetadata: { syncClosedFromMs: 300 } });

    await upsertMonobank('card-1');

    const row = await rowOf('h-1');

    expect(row.closedAt).toBeNull();
    expect(row.balanceMinorUnits).toBe(250);
    expect(row.metadata).toEqual({ monobankId: 'card-1', syncedAt: 2_000, statementFromMs: 300 });
  });

  it('reopens a sync-closed jar without a statement cursor (row 7)', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({
      id: 'h-jar',
      type: 'jar',
      key: 'jar-1',
      closedAt: 77,
      extraMetadata: { syncClosedFromMs: 300 },
    });

    await upsertMonobank('jar-1', 'jar');

    const row = await rowOf('h-jar');

    expect(row.closedAt).toBeNull();
    expect(row.metadata).toEqual({ monobankId: 'jar-1', syncedAt: 2_000 });
  });

  it('keeps a user-closed holding closed (rows 9 and 11): no mark, even with a leftover cursor', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-user', key: 'card-1', closedAt: 77 });
    seed({
      id: 'h-leftover',
      key: 'card-2',
      closedAt: 78,
      extraMetadata: { statementFromMs: 400 },
    });

    await upsertMonobank('card-1');
    await upsertMonobank('card-2');

    const user = await rowOf('h-user');
    const leftover = await rowOf('h-leftover');

    expect(user.closedAt).toBe(77);
    expect(user.balanceMinorUnits).toBe(250);
    expect(user.metadata).toEqual({ monobankId: 'card-1', syncedAt: 2_000 });
    expect(leftover.closedAt).toBe(78);
    expect(leftover.metadata).toEqual({
      monobankId: 'card-2',
      syncedAt: 2_000,
      statementFromMs: 400,
    });
  });

  it('is a no-op the second time the same snapshot syncs (row 21)', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-1', key: 'card-1', closedAt: 77, extraMetadata: { syncClosedFromMs: 300 } });

    await upsertMonobank('card-1');
    await upsertMonobank('card-1');

    const row = await rowOf('h-1');

    expect(row.closedAt).toBeNull();
    expect(row.metadata).toEqual({ monobankId: 'card-1', syncedAt: 2_000, statementFromMs: 300 });
  });

  it('carries a pending statementFromMs across an upsert of an open card (row 4)', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({ id: 'h-1', key: 'card-1', extraMetadata: { statementFromMs: 400 } });

    await upsertMonobank('card-1');

    expect((await rowOf('h-1')).metadata).toEqual({
      monobankId: 'card-1',
      syncedAt: 2_000,
      statementFromMs: 400,
    });
  });

  it('never reopens a closed wallet holding (row 22)', async () => {
    const { seed, rowOf } = openTestDatabase();
    seed({
      id: 'h-wallet',
      type: 'crypto_asset',
      keyField: 'walletAddress',
      key: 'bc1q',
      closedAt: 77,
    });

    await holdingsRepo.upsertExchangeMany([
      {
        accountId: 'acc-1',
        name: 'BTC Wallet',
        type: 'crypto_asset',
        currency: 'UAH',
        balanceMinorUnits: 400,
        metadata: { syncedAt: 2_000 },
        metadataField: 'walletAddress',
        metadataKey: 'bc1q',
      },
    ]);

    const row = await rowOf('h-wallet');

    expect(row.closedAt).toBe(77);
    expect(row.balanceMinorUnits).toBe(400);
    expect(row.metadata).toEqual({ walletAddress: 'bc1q', syncedAt: 2_000 });
  });
});
