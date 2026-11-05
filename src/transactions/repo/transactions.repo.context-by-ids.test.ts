// The series screen reads the rows of one series by id. Only a real engine shows the join, the
// order and the variable limit of a list longer than one statement can bind.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { IN_CLAUSE_CHUNK_SIZE } from '@kiko/db';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

type ContextRows = Awaited<ReturnType<typeof transactionsRepo.listWithContextBetweenQuery>>;

const BASE_TIME = Date.UTC(2026, 8, 20, 10);

const contextRowsByIds = (ids: readonly string[]): Promise<ContextRows> => {
  const lookup = (transactionsRepo as unknown as Record<string, unknown>)
    .listWithContextByIdsQuery as ((given: readonly string[]) => Promise<ContextRows>) | undefined;

  if (lookup === undefined) {
    throw new Error('transactionsRepo.listWithContextByIdsQuery does not exist');
  }

  return lookup(ids);
};

const insertRow = (id: string, holdingId: string, dayOffset: number): void => {
  mockDatabase.exec(`
    INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, source)
    VALUES ('${id}', '${holdingId}', -4500, ${BASE_TIME + dayOffset * DAY_MS}, 'Netflix ${id}', 'manual');
  `);
};

const idsOf = (rows: ContextRows): string[] => rows.map((row) => row.id);

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES ('account', 'Monobank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency) VALUES
      ('card', 'account', 'Card', 'card', 'UAH'),
      ('gone', 'account', 'Gone', 'card', 'UAH');
  `);
});

describe('transactionsRepo.listWithContextByIdsQuery', () => {
  it('returns exactly the given ids, newest first', async () => {
    insertRow('oldest', 'card', 0);
    insertRow('newest', 'card', 60);
    insertRow('middle', 'card', 30);
    insertRow('unasked', 'card', 45);

    const rows = await contextRowsByIds(['oldest', 'newest', 'middle']);

    expect(idsOf(rows)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('would return the unasked row for a wider read, so its absence is a filter', async () => {
    insertRow('asked', 'card', 0);
    insertRow('unasked', 'card', 45);

    const everyRow = await transactionsRepo.listWithContextBetweenQuery(undefined, undefined);

    expect(idsOf(everyRow)).toContain('unasked');
    expect(idsOf(await contextRowsByIds(['asked']))).toEqual(['asked']);
  });

  it('returns each row in the shape of the context read', async () => {
    insertRow('first', 'card', 0);
    insertRow('second', 'card', 30);

    const everyRow = await transactionsRepo.listWithContextBetweenQuery(undefined, undefined);
    const rows = await contextRowsByIds(['first', 'second']);

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(everyRow);
    expect(rows[0]).toMatchObject({
      id: 'second',
      currency: 'UAH',
      holdingId: 'card',
      accountId: 'account',
      accountName: 'Monobank',
      holdingName: 'Card',
    });
  });

  it('returns nothing for an empty list and for ids no row holds', async () => {
    insertRow('present', 'card', 0);

    expect(await contextRowsByIds([])).toEqual([]);
    expect(await contextRowsByIds(['missing'])).toEqual([]);
    expect(idsOf(await contextRowsByIds(['present']))).toEqual(['present']);
  });

  it('reads more ids than one statement binds, in chunks, newest first across them', async () => {
    insertRow('early', 'card', 0);
    insertRow('late', 'card', 90);
    insertRow('between', 'card', 40);

    const fillers = Array.from(
      { length: IN_CLAUSE_CHUNK_SIZE + 1_500 },
      (_unused, index) => `absent-${index}`,
    );
    const ids = ['early', ...fillers.slice(0, IN_CLAUSE_CHUNK_SIZE), 'late', 'between', ...fillers];

    expect(ids.length).toBeGreaterThan(IN_CLAUSE_CHUNK_SIZE * 2);
    expect(idsOf(await contextRowsByIds(ids))).toEqual(['late', 'between', 'early']);
  });

  it('leaves out the rows of a deleted holding', async () => {
    insertRow('kept', 'card', 0);
    insertRow('removed', 'gone', 10);

    expect(idsOf(await contextRowsByIds(['kept', 'removed']))).toEqual(['removed', 'kept']);

    await transactionsRepo.removeHolding('gone');

    expect(idsOf(await contextRowsByIds(['kept', 'removed']))).toEqual(['kept']);
  });
});
