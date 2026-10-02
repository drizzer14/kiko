let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { database, holdings } from '@kiko/db';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { SaleExceedsHoldingError } from '../lots';

import { holdingsRepo } from './holdings.repo';

const DAY = Date.UTC(2026, 0, 10);

const openDatabase = (metadata: Record<string, unknown>): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('broker-1', 'Broker', 'broker')")
    .run();
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('share-1', 'broker-1', 'Apple', 'share', 'USD', 0, ?)`,
    )
    .run(JSON.stringify(metadata));
};

const storedMetadata = async (): Promise<unknown> =>
  (await database.select({ metadata: holdings.metadata }).from(holdings))[0].metadata;

const lot = { day: DAY, quantityDelta: '10', costMinorUnits: 100_000 };

describe('holdingsRepo.changeLots', () => {
  it('keeps every other stored metadata key', async () => {
    openDatabase({ quoteSource: 'eodhd', symbol: 'AAPL.US', quoteCurrency: 'USD', lots: [lot] });

    await holdingsRepo.changeLots('share-1', { kind: 'remove', index: 0 });

    expect(await storedMetadata()).toEqual({
      quoteSource: 'eodhd',
      symbol: 'AAPL.US',
      quoteCurrency: 'USD',
      lots: [],
    });
  });

  it('refuses lots it cannot read, leaving them stored as they were', async () => {
    const unreadable = { quoteSource: 'manual', lots: [lot, { day: 'x' }] };
    openDatabase(unreadable);

    await expect(
      holdingsRepo.changeLots('share-1', { kind: 'add', lot: { ...lot, quantityDelta: '1' } }),
    ).rejects.toThrow('changeLots: stored lots are unreadable');
    expect(await storedMetadata()).toEqual(unreadable);
  });

  it('adds the first lot to a holding with no lots key', async () => {
    openDatabase({ quoteSource: 'manual' });

    await holdingsRepo.changeLots('share-1', { kind: 'add', lot });

    expect(await storedMetadata()).toEqual({ quoteSource: 'manual', lots: [lot] });
  });

  it('refuses a sale larger than is held before it, leaving the lots stored as they were', async () => {
    const stored = { quoteSource: 'manual', lots: [lot] };
    openDatabase(stored);

    await expect(
      holdingsRepo.changeLots('share-1', {
        kind: 'add',
        lot: { day: DAY, quantityDelta: '-11', costMinorUnits: 0 },
      }),
    ).rejects.toThrow(SaleExceedsHoldingError);
    expect(await storedMetadata()).toEqual(stored);
  });

  it('refuses a holding that is not stored', async () => {
    openDatabase({ quoteSource: 'manual', lots: [lot] });

    await expect(holdingsRepo.changeLots('share-2', { kind: 'remove', index: 0 })).rejects.toThrow(
      'changeLots: no such holding',
    );
  });
});

describe('holdingsRepo.updateShareFromStored', () => {
  it('hands the build the metadata stored at the time of the write', async () => {
    const stored = { quoteSource: 'eodhd', symbol: 'AAPL.US', quoteCurrency: 'USD', lots: [lot] };
    openDatabase(stored);
    const buildMetadata = jest.fn(() => ({ ...stored, isin: 'US0378331005' }));

    await holdingsRepo.updateShareFromStored(
      'share-1',
      { name: 'Apple', color: null },
      buildMetadata,
    );

    expect(buildMetadata).toHaveBeenCalledWith(stored);
    expect(await storedMetadata()).toEqual({ ...stored, isin: 'US0378331005' });
  });
});
