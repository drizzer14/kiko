// The loan matcher reads its candidates with `loanMatchCandidatesQuery`. A Binance move
// from Spot to a wallet Kiko does not track carries `untrackedCounterpart` and no
// counterpart holding; like an Exchange leg it is the user's own money moving, never a
// loan payment. Only a real engine proves the filter reaches the SQL.
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

const debit = (externalId: string, overrides: Partial<NewRow> = {}): NewRow => ({
  holdingId: 'spot',
  amountMinorUnits: -250_000,
  time: TIME,
  source: 'binance',
  externalId,
  ...overrides,
});

const storedId = (externalId: string): string =>
  (
    mockDatabase.prepare('SELECT id FROM transactions WHERE external_id = ?').get(externalId) as {
      id: string;
    }
  ).id;

describe('transactionsRepo.loanMatchCandidatesQuery', () => {
  it('leaves out a move to a wallet Kiko does not track, and keeps a plain debit', async () => {
    await transactionsRepo.addManyDedup([
      debit('plain'),
      debit('to-futures', { untrackedCounterpart: 'wallet:UMFUTURE' }),
    ]);

    const candidates = await transactionsRepo.loanMatchCandidatesQuery({
      minTime: 0,
      currencies: ['BTC'],
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual([storedId('plain')]);
  });
});
