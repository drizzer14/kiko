// `removeSyncedRows` is the one delete a sync makes of its own rows (a Binance fiat order that was
// refunded). It reads and deletes by the `(source, external_id)` key, so only a real engine proves
// that the source filter reaches the SQL, and that the holding's balance, which the exchange owns,
// is left as it was.
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

const row = (over: {
  externalId?: string;
  source?: 'binance' | 'monobank' | 'manual' | 'import';
  holdingId?: string;
}) => ({
  holdingId: over.holdingId ?? 'spot',
  amountMinorUnits: 100,
  time: TIME,
  source: over.source ?? 'binance',
  externalId: over.externalId,
});

const storedKeys = (): string[] =>
  (
    mockDatabase
      .prepare('SELECT source, external_id FROM transactions ORDER BY source, external_id')
      .all() as { source: string; external_id: string | null }[]
  ).map((stored) => `${stored.source}:${stored.external_id}`);

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  mockDatabase.exec(
    "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Binance', 'crypto')",
  );
  mockDatabase.exec(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES
      ('spot', 'account', 'Euro', 'crypto_asset', 'EUR', 500),
      ('funding', 'account', 'Funding', 'crypto_asset', 'EUR', 700)`,
  );
});

afterEach(() => {
  mockDatabase.close();
});

describe('transactionsRepo.removeSyncedRows', () => {
  it('deletes the rows of the source that hold the keys, on any holding, and counts them', async () => {
    await transactionsRepo.addManyDedup([
      row({ externalId: 'a' }),
      row({ externalId: 'b', holdingId: 'funding' }),
      row({ externalId: 'c' }),
    ]);

    const removed = await transactionsRepo.removeSyncedRows('binance', ['a', 'b']);

    expect(removed).toBe(2);
    expect(storedKeys()).toEqual(['binance:c']);
  });

  it('keeps a row of another source or a manual row whose key matches', async () => {
    await transactionsRepo.addManyDedup([
      row({ externalId: 'a' }),
      row({ externalId: 'a', source: 'monobank' }),
      row({ externalId: 'a', source: 'import' }),
      row({ source: 'manual' }),
    ]);

    await transactionsRepo.removeSyncedRows('binance', ['a']);

    expect(storedKeys()).toEqual(['import:a', 'manual:null', 'monobank:a']);
  });

  it('leaves the balance of the holding as the exchange set it', async () => {
    await transactionsRepo.addManyDedup([row({ externalId: 'a' })]);

    await transactionsRepo.removeSyncedRows('binance', ['a']);

    expect(
      mockDatabase
        .prepare("SELECT balance_minor_units AS balance FROM holdings WHERE id = 'spot'")
        .get(),
    ).toEqual({ balance: 500 });
  });

  it('deletes a row the user categorized and noted too', async () => {
    await transactionsRepo.addManyDedup([row({ externalId: 'a' })]);
    const { id } = mockDatabase
      .prepare("SELECT id FROM transactions WHERE external_id = 'a'")
      .get() as {
      id: string;
    };
    await transactionsRepo.setCategory({ transactionId: id, category: 'Gifts' });
    mockDatabase.prepare("UPDATE transactions SET comment = 'for Anna' WHERE id = ?").run(id);

    const removed = await transactionsRepo.removeSyncedRows('binance', ['a']);

    expect(removed).toBe(1);
    expect(storedKeys()).toEqual([]);
  });

  it('does nothing for a key no row holds, a repeated key or an empty list', async () => {
    await transactionsRepo.addManyDedup([row({ externalId: 'a' })]);

    expect(await transactionsRepo.removeSyncedRows('binance', [])).toBe(0);
    expect(await transactionsRepo.removeSyncedRows('binance', ['missing'])).toBe(0);
    expect(await transactionsRepo.removeSyncedRows('binance', ['a', 'a'])).toBe(1);
    expect(await transactionsRepo.removeSyncedRows('binance', ['a'])).toBe(0);
    expect(storedKeys()).toEqual([]);
  });
});
