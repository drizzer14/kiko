// A rule on an account names it by id and nothing else. Deleting that account must leave the rule
// stored and inert: dropping only its condition would widen the rule, and deleting the rule would
// lose something the user wrote. Real repositories on a real, fully migrated engine.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

jest.mock('@kiko/monobank/token', () => ({ clearToken: jest.fn() }));
jest.mock('@kiko/crypto-sync/binance', () => ({ clearCredentials: jest.fn() }));

import { DatabaseSync } from 'node:sqlite';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';

import { accountsRepo } from './accounts.repo';

type StoredRule = { id: string; category: string; matchers: string };

const ACCOUNT_RULE_MATCHERS = JSON.stringify([{ type: 'account', accountId: 'doomed' }]);

const storedRules = (): StoredRule[] =>
  mockDatabase
    .prepare('SELECT id, category, matchers FROM category_rules ORDER BY id')
    .all() as StoredRule[];

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
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec(`
    PRAGMA foreign_keys = ON;
    INSERT INTO accounts (id, name, kind) VALUES ('doomed', 'Doomed', 'bank'), ('kept', 'Kept', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency)
      VALUES ('doomed-card', 'doomed', 'Card', 'card', 'UAH'),
             ('kept-card', 'kept', 'Card', 'card', 'UAH');
    INSERT INTO category_rules (id, category, matchers, created_at, updated_at)
      VALUES ('account-rule', 'travel', '${ACCOUNT_RULE_MATCHERS}', 1, 1);
  `);
});

describe('removing an account that a rule names', () => {
  it('removing an account leaves its rule, and the rule matches nothing', async () => {
    const probe = {
      id: null,
      category: 'gifts',
      matchers: [
        { type: 'account' as const, accountId: 'doomed' },
        { type: 'direction' as const, direction: 'expense' as const },
      ],
    };

    expect(await importedCategoryOn('doomed-card', 'before')).toBe('travel');

    await accountsRepo.remove('doomed');

    expect(storedRules()).toEqual([
      { id: 'account-rule', category: 'travel', matchers: ACCOUNT_RULE_MATCHERS },
    ]);
    expect(await importedCategoryOn('kept-card', 'after')).toBe('shopping');
    expect(await categoryRulesRepo.countRuleRewrite(probe)).toBe(0);
  });
});
