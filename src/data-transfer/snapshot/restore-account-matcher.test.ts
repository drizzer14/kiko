// An `account` matcher names an account by id. A restore replaces the rules and the accounts
// together from one file, so the ids agree; the only rewrite of an account id is the merge of
// implicit accounts, which a file that holds such a matcher never needs. An id that no account row
// carries reads as a deleted account and never matches. Real SQLite, the real export read and the
// real restore.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';

import { EXPORT_VERSION } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';
import { withImplicitAccountsMerged } from './with-implicit-accounts-merged';

type AccountSeed = { id: string; kind: 'bank' | 'property' };

const openDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON;');

  return database;
};

const seedAccount = ({ id, kind }: AccountSeed): void => {
  mockDatabase.prepare('INSERT INTO accounts (id, name, kind) VALUES (?, ?, ?)').run(id, id, kind);
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency)
       VALUES (?, ?, 'Holding', 'card', 'UAH')`,
    )
    .run(`${id}-holding`, id);
};

const seedRuleOn = (accountId: string): string => {
  const matchers = JSON.stringify([{ type: 'account', accountId }]);

  mockDatabase
    .prepare(
      `INSERT INTO category_rules (id, category, matchers, created_at, updated_at)
       VALUES ('account-rule', 'travel', ?, 1, 1)`,
    )
    .run(matchers);

  return matchers;
};

const restoredDatabase = async (): Promise<void> => {
  const snapshot = JSON.parse(JSON.stringify(await readDataSnapshot()));

  mockDatabase = openDatabase();
  await restoreDataSnapshot(snapshot, EXPORT_VERSION);
};

const storedMatchers = (): string[] =>
  (
    mockDatabase.prepare('SELECT matchers FROM category_rules ORDER BY id').all() as {
      matchers: string;
    }[]
  ).map((row) => row.matchers);

const importedCategoryOn = async (
  holdingId: string,
  externalId: string,
): Promise<string | null> => {
  await transactionsRepo.importRows({
    holdingId,
    rows: [
      {
        holdingId,
        amountMinorUnits: -100,
        time: 2000,
        description: 'Anything',
        source: 'import',
        externalId,
        category: 'shopping',
      },
    ],
  });

  return (
    mockDatabase
      .prepare('SELECT category FROM transactions WHERE external_id = ?')
      .get(externalId) as { category: string | null }
  ).category;
};

beforeEach(() => {
  mockDatabase = openDatabase();
});

describe('restoring a file that holds an account matcher', () => {
  it("restoring a file keeps an account matcher's id and it matches", async () => {
    seedAccount({ id: 'bank-account', kind: 'bank' });
    seedAccount({ id: 'other-account', kind: 'bank' });

    const matchers = seedRuleOn('bank-account');

    await restoredDatabase();

    expect(storedMatchers()).toEqual([matchers]);
    expect(await importedCategoryOn('bank-account-holding', 'on-account')).toBe('travel');
    expect(await importedCategoryOn('other-account-holding', 'elsewhere')).toBe('shopping');
  });

  it('withImplicitAccountsMerged keeps the id of a rule on a property account in a current file', async () => {
    seedAccount({ id: 'property-account', kind: 'property' });

    const matchers = seedRuleOn('property-account');
    const snapshot = JSON.parse(JSON.stringify(await readDataSnapshot()));
    const merged = withImplicitAccountsMerged(snapshot);

    expect(merged.accounts).toBe(snapshot.accounts);
    expect(merged.holdings).toBe(snapshot.holdings);

    await restoredDatabase();

    expect(storedMatchers()).toEqual([matchers]);
    expect(
      (mockDatabase.prepare('SELECT id FROM accounts').all() as { id: string }[]).map(
        (row) => row.id,
      ),
    ).toEqual(['property-account']);
    expect(await importedCategoryOn('property-account-holding', 'on-property')).toBe('travel');
  });

  it('a rule on an id in no row reads as Deleted account and never matches', async () => {
    seedAccount({ id: 'bank-account', kind: 'bank' });

    const matchers = seedRuleOn('gone-account');

    await restoredDatabase();

    const listedIds = (
      mockDatabase.prepare('SELECT id FROM accounts').all() as { id: string }[]
    ).map((row) => row.id);
    const probe = {
      id: null,
      category: 'gifts',
      matchers: [
        { type: 'account' as const, accountId: 'gone-account' },
        { type: 'direction' as const, direction: 'expense' as const },
      ],
    };

    expect(storedMatchers()).toEqual([matchers]);
    expect(listedIds).not.toContain('gone-account');
    expect(await importedCategoryOn('bank-account-holding', 'on-bank')).toBe('shopping');
    expect(await categoryRulesRepo.countRuleRewrite(probe)).toBe(0);
  });
});
