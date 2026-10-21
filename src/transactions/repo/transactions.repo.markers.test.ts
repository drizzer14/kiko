// A history walk writes a leg's movement markers (the paired counterpart holding,
// the pair id, the untracked wallet code) in the SAME `addManyDedup` upsert that
// writes its amount. Only a real engine shows that the markers land on insert and
// that a refresh of the same key never rewrites them.
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

type NewRow = Parameters<typeof transactionsRepo.addManyDedup>[0][number];

const leg = (overrides: Partial<NewRow>): NewRow => ({
  holdingId: 'spot',
  amountMinorUnits: -100_000,
  time: TIME,
  source: 'binance',
  externalId: 'account:transfer:1',
  ...overrides,
});

const storedMarkers = (externalId: string) =>
  mockDatabase
    .prepare(
      `SELECT amount_minor_units AS amount,
        exchange_counterpart_holding_id AS counterpart,
        exchange_pair_id AS pairId,
        untracked_counterpart AS untracked
       FROM transactions WHERE external_id = ?`,
    )
    .get(externalId) as {
    amount: number;
    counterpart: string | null;
    pairId: string | null;
    untracked: string | null;
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
      ('spot', 'account', 'Bitcoin', 'crypto_asset', 'BTC', 0),
      ('funding', 'account', 'Bitcoin (Funding)', 'crypto_asset', 'BTC', 0)`,
  );
});

describe('addManyDedup stores the movement markers', () => {
  it('writes the counterpart holding and the pair id of a paired leg', async () => {
    await transactionsRepo.addManyDedup([
      leg({ exchangeCounterpartHoldingId: 'funding', exchangePairId: 'account:transfer:1' }),
    ]);

    expect(storedMarkers('account:transfer:1')).toMatchObject({
      counterpart: 'funding',
      pairId: 'account:transfer:1',
      untracked: null,
    });
  });

  it('writes the untracked wallet code of a one-leg movement', async () => {
    await transactionsRepo.addManyDedup([leg({ untrackedCounterpart: 'wallet:UMFUTURE' })]);

    expect(storedMarkers('account:transfer:1')).toMatchObject({
      counterpart: null,
      pairId: null,
      untracked: 'wallet:UMFUTURE',
    });
  });

  it('refreshes the amount of a stored key and leaves its markers as stored', async () => {
    await transactionsRepo.addManyDedup([
      leg({
        exchangeCounterpartHoldingId: 'funding',
        exchangePairId: 'account:transfer:1',
        untrackedCounterpart: 'wallet:MARGIN',
      }),
    ]);

    await transactionsRepo.addManyDedup([leg({ amountMinorUnits: -250_000 })]);

    expect(storedMarkers('account:transfer:1')).toEqual({
      amount: -250_000,
      counterpart: 'funding',
      pairId: 'account:transfer:1',
      untracked: 'wallet:MARGIN',
    });
  });
});

describe('addManyDedup stores the operation label', () => {
  const storedOperation = (externalId: string): string | null =>
    (
      mockDatabase
        .prepare('SELECT operation AS value FROM transactions WHERE external_id = ?')
        .get(externalId) as { value: string | null }
    ).value;

  it('stores the operation a new row carries', async () => {
    await transactionsRepo.addManyDedup([leg({ operation: 'trade-fee' })]);

    expect(storedOperation('account:transfer:1')).toBe('trade-fee');
  });

  it('keeps the stored operation when the same key is upserted with another', async () => {
    await transactionsRepo.addManyDedup([leg({ operation: 'trade' })]);

    await transactionsRepo.addManyDedup([
      leg({ amountMinorUnits: -250_000, operation: 'convert' }),
    ]);

    expect(storedOperation('account:transfer:1')).toBe('trade');
    expect(storedMarkers('account:transfer:1').amount).toBe(-250_000);
  });

  it('stores null for a row with no operation', async () => {
    await transactionsRepo.addManyDedup([leg({})]);

    expect(storedOperation('account:transfer:1')).toBeNull();
  });
});
