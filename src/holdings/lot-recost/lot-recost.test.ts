let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { isRecord } from '@kiko/type-guards';
import { database, holdings, settings } from '@kiko/db';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { recostStoredLots } from './lot-recost';

const JANUARY = Date.UTC(2026, 0, 10);
const FEBRUARY = Date.UTC(2026, 1, 10);
const MARCH = Date.UTC(2026, 2, 10);

const buy = (day: number, quantity: string, costMinorUnits: number) => ({
  day,
  quantityDelta: quantity,
  costMinorUnits,
});

const sell = (day: number, quantity: string, costMinorUnits: number) => ({
  day,
  quantityDelta: `-${quantity}`,
  costMinorUnits,
});

// Bought 10 for 1,000 in January and sold 4 in March, costed at 400; then a
// buy of 10 for 3,000 dated February was added. An older build kept the
// March sale at 400; held 20 for 4,000 before it, the sale costs 800.
const STALE_LOTS = [
  buy(JANUARY, '10', 100_000),
  sell(MARCH, '4', -40_000),
  buy(FEBRUARY, '10', 300_000),
];
const RECOSTED_LOTS = [
  buy(JANUARY, '10', 100_000),
  sell(MARCH, '4', -80_000),
  buy(FEBRUARY, '10', 300_000),
];

type Seed = { id: string; type: string; currency: string; metadata: Record<string, unknown> };

const share = (id: string, lots: unknown): Seed => ({
  id,
  type: 'share',
  currency: 'USD',
  metadata: { quoteSource: 'eodhd', symbol: 'AAPL.US', quoteCurrency: 'USD', lots },
});

const metal = (id: string, lots: unknown): Seed => ({
  id,
  type: 'metal',
  currency: 'UAH',
  metadata: { metal: 'XAU', form: 'bar', unit: 'oz', purity: '1', lots },
});

const openDatabase = (seeds: Seed[]): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('INSERT INTO settings (id) VALUES (1)');
  mockDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('broker-1', 'Broker', 'broker')")
    .run();

  const insert = mockDatabase.prepare(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
     VALUES (?, 'broker-1', ?, ?, ?, 0, ?)`,
  );

  for (const seed of seeds) {
    insert.run(seed.id, seed.id, seed.type, seed.currency, JSON.stringify(seed.metadata));
  }

  // Every holding row the recost writes, so a test can tell "no write" from
  // "wrote the same value back".
  mockDatabase.exec(`
    CREATE TABLE holding_writes (id TEXT NOT NULL);
    CREATE TRIGGER holding_writes_log AFTER UPDATE ON holdings
    BEGIN INSERT INTO holding_writes (id) VALUES (NEW.id); END;
  `);
};

const writtenHoldingIds = (): string[] =>
  (mockDatabase.prepare('SELECT id FROM holding_writes').all() as { id: string }[]).map(
    (row) => row.id,
  );

const storedMetadata = async (id: string): Promise<Record<string, unknown>> => {
  const rows = await database.select().from(holdings);
  const metadata = rows.find((row) => row.id === id)?.metadata;

  return isRecord(metadata) ? metadata : {};
};

const isRecosted = async (): Promise<boolean | undefined> =>
  (await database.select({ lotsRecosted: settings.lotsRecosted }).from(settings)).at(0)
    ?.lotsRecosted;

describe('recostStoredLots', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('costs a sale recorded before a later-added backdated buy again, in the one lot order', async () => {
    openDatabase([share('share-1', STALE_LOTS)]);

    await recostStoredLots();

    expect(await storedMetadata('share-1')).toEqual(share('share-1', RECOSTED_LOTS).metadata);
    expect(await isRecosted()).toBe(true);
  });

  it('costs a metal holding the same way, in its own currency', async () => {
    openDatabase([metal('metal-1', STALE_LOTS)]);

    await recostStoredLots();

    expect((await storedMetadata('metal-1')).lots).toEqual(RECOSTED_LOTS);
  });

  it('writes nothing to a list whose sale costs are already right', async () => {
    openDatabase([share('share-1', RECOSTED_LOTS), share('share-2', STALE_LOTS)]);

    await recostStoredLots();

    expect(writtenHoldingIds()).toEqual(['share-2']);
    expect(await isRecosted()).toBe(true);
  });

  it('leaves a list with a sale larger than what is held before it as stored, and logs it', async () => {
    const oversized = [buy(JANUARY, '3', 90_000), sell(MARCH, '5', -90_000)];
    openDatabase([share('share-1', oversized), share('share-2', STALE_LOTS)]);

    await recostStoredLots();

    expect((await storedMetadata('share-1')).lots).toEqual(oversized);
    expect((await storedMetadata('share-2')).lots).toEqual(RECOSTED_LOTS);
    expect(writtenHoldingIds()).toEqual(['share-2']);
    expect(warn).toHaveBeenCalledWith('[lot-recost] a holding keeps its stored lots', {
      name: 'SaleExceedsHoldingError',
      code: undefined,
    });
    expect(await isRecosted()).toBe(true);
  });

  it('leaves unreadable lots and holdings without lots as stored', async () => {
    const unreadable = [buy(JANUARY, '10', 100_000), { day: 'x' }];
    openDatabase([share('share-1', unreadable), share('share-2', undefined)]);

    await recostStoredLots();

    expect((await storedMetadata('share-1')).lots).toEqual(unreadable);
    expect(writtenHoldingIds()).toEqual([]);
  });

  it('runs once: a later open reads the flag and writes nothing', async () => {
    openDatabase([share('share-1', RECOSTED_LOTS)]);
    await recostStoredLots();
    mockDatabase
      .prepare("UPDATE holdings SET metadata = ? WHERE id = 'share-1'")
      .run(JSON.stringify(share('share-1', STALE_LOTS).metadata));

    await recostStoredLots();

    expect((await storedMetadata('share-1')).lots).toEqual(STALE_LOTS);
  });

  it('never rejects, and leaves the flag unset for the next open when its write fails', async () => {
    openDatabase([share('share-1', STALE_LOTS)]);
    mockDatabase.exec(`
      CREATE TRIGGER refuse_writes BEFORE UPDATE ON holdings
      BEGIN SELECT RAISE(ABORT, 'disk full'); END;
    `);

    await expect(recostStoredLots()).resolves.toBeUndefined();

    expect(await isRecosted()).toBe(false);
    expect((await storedMetadata('share-1')).lots).toEqual(STALE_LOTS);
    expect(warn).toHaveBeenCalledWith('[lot-recost] recost failed', expect.anything());
  });
});
