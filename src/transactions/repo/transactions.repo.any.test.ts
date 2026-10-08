// The onboarding tips and empty states ask only whether a transaction exists, so the two
// "any" reads are `LIMIT 1` selects instead of a read of the ledger. Only a real engine
// shows that the account read counts the rows of THAT account alone, and that neither
// read walks the whole ledger without an index.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const insertTransaction = (id: string, holdingId: string): void => {
  mockDatabase
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, source)
       VALUES (?, ?, -100, 1, ?, 'manual')`,
    )
    .run(id, holdingId, `row ${id}`);
};

const planOf = (query: { toSQL: () => { sql: string; params: unknown[] } }): string[] => {
  const { sql, params } = query.toSQL();

  return (
    mockDatabase.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as (string | number)[])) as {
      detail: string;
    }[]
  ).map((step) => step.detail);
};

describe('the "any transaction" reads', () => {
  beforeEach(() => {
    mockDatabase = new DatabaseSync(':memory:');
    applyAllMigrations(mockDatabase);
    mockDatabase.exec(`
      INSERT INTO accounts (id, name, kind) VALUES ('a', 'Monobank', 'bank'), ('b', 'Cash', 'cash');
      INSERT INTO holdings (id, account_id, name, type, currency) VALUES
        ('h-a', 'a', 'Card', 'card', 'UAH'), ('h-b', 'b', 'Wallet', 'cash', 'UAH');
    `);
  });

  describe('anyQuery', () => {
    it('returns no row while the ledger is empty', async () => {
      expect(await transactionsRepo.anyQuery()).toHaveLength(0);
    });

    it('returns one row however many transactions there are', async () => {
      insertTransaction('t-1', 'h-a');
      insertTransaction('t-2', 'h-b');

      expect(await transactionsRepo.anyQuery()).toEqual([{ id: expect.any(String) }]);
    });

    it('walks an index of the ledger, never the table itself', () => {
      expect(planOf(transactionsRepo.anyQuery())).toEqual([
        expect.stringMatching(/^SCAN transactions USING (COVERING )?INDEX /),
      ]);
    });
  });

  describe('anyInAccountQuery', () => {
    it('returns one row when a holding of the account has a transaction', async () => {
      insertTransaction('t-1', 'h-a');

      expect(await transactionsRepo.anyInAccountQuery('a')).toEqual([{ id: 't-1' }]);
    });

    it('returns one row however many transactions the account has', async () => {
      insertTransaction('t-1', 'h-a');
      insertTransaction('t-2', 'h-a');

      expect(await transactionsRepo.anyInAccountQuery('a')).toHaveLength(1);
    });

    it('returns no row for a transaction of another account', async () => {
      insertTransaction('t-1', 'h-b');

      expect(await transactionsRepo.anyInAccountQuery('a')).toHaveLength(0);
    });

    it('returns no row for an account without transactions', async () => {
      expect(await transactionsRepo.anyInAccountQuery('a')).toHaveLength(0);
    });

    it('searches the holding index of the transactions, never scanning the ledger', () => {
      const plan = planOf(transactionsRepo.anyInAccountQuery('a'));

      expect(plan).toContainEqual(
        expect.stringContaining('SEARCH transactions USING INDEX transactions_holding_id'),
      );
      expect(plan).not.toContainEqual('SCAN transactions');
    });
  });
});
