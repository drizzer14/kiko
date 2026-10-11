// The rules at the size the spec budgets for (50 000 transactions, 200 rules), on a real engine:
// what the insert path decides, how many statements the rewrite costs and how many pages it reads.
// Only results and counted work are asserted: a wall-clock bound fails under a loaded machine or
// a mutation run, so the timings are measured by hand and recorded in the run log.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import {
  matchesRule,
  planRuleRewrite,
  prepareRules,
  subjectOfStoredRow,
} from '@kiko/categories/category-rules';
import { DatabaseSync } from 'node:sqlite';
import { write, IN_CLAUSE_CHUNK_SIZE } from '@kiko/db';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { rewriteForRuleDatabaseTransaction } from '@kiko/categories/category-rules-repo';
import { buildRulesPerformanceFixture } from '@kiko/categories/category-rules/__fixtures__/rules-performance-fixture';

import { transactionsRepo } from './transactions.repo';

const INSERT_BATCH_SIZE = 10_000;
// The rewrite's keyset page length (`REWRITE_PAGE_SIZE` in the rules repo).
const REWRITE_PAGE_SIZE = 2_000;
const TEST_TIMEOUT = 120_000;
// A name rule that wins a few of the fixture's rows, and the no-name rule that wins the most.
const NAME_RULE_ID = 'rule-119';
const NO_NAME_RULE_ID = 'rule-190';

const HOLDINGS_PER_CURRENCY = { UAH: 8, USD: 4, EUR: 3, GBP: 3, BTC: 2 } as const;

const { rules, rows } = buildRulesPerformanceFixture();
const prepared = prepareRules(rules);

type FixtureRow = (typeof rows)[number];

const holdingIdOf = (row: FixtureRow, index: number): string => {
  const currency = row.currency as keyof typeof HOLDINGS_PER_CURRENCY;

  return `${currency}-${index % HOLDINGS_PER_CURRENCY[currency]}`;
};

const seedHoldingsAndRules = (): void => {
  mockDatabase.exec("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");

  const insertHolding = mockDatabase.prepare(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
     VALUES (?, 'account', ?, ?, ?, 0)`,
  );

  for (const [currency, count] of Object.entries(HOLDINGS_PER_CURRENCY)) {
    for (let index = 0; index < count; index += 1) {
      const holdingId = `${currency}-${index}`;

      insertHolding.run(
        holdingId,
        holdingId,
        currency === 'BTC' ? 'crypto_asset' : 'card',
        currency,
      );
    }
  }

  const insertRule = mockDatabase.prepare(
    'INSERT INTO category_rules (id, category, matchers, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );

  for (const rule of rules) {
    insertRule.run(rule.id, rule.category, rule.matchers, rule.createdAt, rule.updatedAt);
  }
};

const seedLedger = (): void => {
  const insertRow = mockDatabase.prepare(
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category,
       source, category_set_by_hand)
     VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`,
  );

  mockDatabase.exec('BEGIN');
  rows.forEach((row, index) => {
    insertRow.run(
      row.id,
      holdingIdOf(row, index),
      row.amountMinorUnits,
      row.time,
      row.description,
      row.category,
      row.categorySetByHand ? 1 : 0,
    );
  });
  mockDatabase.exec('COMMIT');
};

const categoriesById = (): Map<string, string | null> =>
  new Map(
    // A synced row is found by its external id, a seeded one by its own.
    (
      mockDatabase
        .prepare('SELECT coalesce(external_id, id) AS key, category FROM transactions')
        .all() as {
        key: string;
        category: string | null;
      }[]
    ).map((row) => [row.key, row.category]),
  );

// Records every statement the engine prepares from here on.
const spyOnStatements = (): string[] => {
  const statements: string[] = [];
  const prepare = mockDatabase.prepare.bind(mockDatabase);

  jest.spyOn(mockDatabase, 'prepare').mockImplementation((sql: string) => {
    statements.push(sql);

    return prepare(sql);
  });

  return statements;
};

const countOf = (statements: string[], pattern: RegExp): number =>
  statements.filter((sql) => pattern.test(sql)).length;

const pageReadsOf = (statements: string[]): number =>
  countOf(statements, /order by "transactions"\."id" asc limit/i);

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  seedHoldingsAndRules();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('inserting a batch of 10 000 rows against 200 rules', () => {
  const batch = rows.slice(0, INSERT_BATCH_SIZE);

  // The first rule in priority order that matches, found by scanning every rule, so it does not
  // share the name index the insert path evaluates through.
  const expectedCategory = (row: FixtureRow): string | null =>
    prepared.ordered.find((rule) => matchesRule(rule, subjectOfStoredRow(row)))?.category ??
    row.category;

  it(
    'gives every row the category of the first matching rule, else the bank category',
    async () => {
      const statements = spyOnStatements();

      await transactionsRepo.addManyDedup(
        batch.map((row, index) => ({
          holdingId: holdingIdOf(row, index),
          amountMinorUnits: row.amountMinorUnits,
          time: row.time,
          source: 'monobank',
          description: row.description,
          category: row.category ?? undefined,
          externalId: row.id,
        })),
      );

      const stored = categoriesById();
      const disagreements = batch.filter((row) => stored.get(row.id) !== expectedCategory(row));
      const ruleWon = batch.filter((row) => expectedCategory(row) !== row.category);

      expect(stored.size).toBe(INSERT_BATCH_SIZE);
      expect(disagreements).toEqual([]);
      // Rows the rules re-categorise and rows they leave alone are both present, so the
      // comparison above can fail in either direction.
      expect(ruleWon.length).toBeGreaterThan(100);
      expect(ruleWon.length).toBeLessThan(INSERT_BATCH_SIZE);
      expect(countOf(statements, /^select .* from "category_rules"/i)).toBe(1);
      expect(countOf(statements, /^select "id", "currency" from "holdings"/i)).toBe(1);
    },
    TEST_TIMEOUT,
  );
});

describe('rewriting 50 000 rows for a saved rule', () => {
  const rewriteFor = (ruleId: string): Promise<number> =>
    write((databaseTransaction) => rewriteForRuleDatabaseTransaction(databaseTransaction, ruleId));

  const changedRowIds = (before: Map<string, string | null>): string[] =>
    [...categoriesById()]
      .filter(([rowId, category]) => before.get(rowId) !== category)
      .map(([rowId]) => rowId);

  it(
    'updates exactly the planned rows of a name rule in one statement, with no page read',
    async () => {
      seedLedger();

      const planned = planRuleRewrite(prepared, NAME_RULE_ID, rows);
      const before = categoriesById();
      const statements = spyOnStatements();
      const updated = await rewriteFor(NAME_RULE_ID);

      expect(planned.length).toBeGreaterThan(0);
      expect(updated).toBe(planned.length);
      expect(changedRowIds(before).sort()).toEqual([...planned].sort());
      expect(countOf(statements, /^update "transactions"/i)).toBe(
        Math.ceil(planned.length / IN_CLAUSE_CHUNK_SIZE),
      );
      expect(pageReadsOf(statements)).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'updates exactly the planned rows of a rule with no name, reading every row a page at a time',
    async () => {
      seedLedger();

      const planned = planRuleRewrite(prepared, NO_NAME_RULE_ID, rows);
      const before = categoriesById();
      const statements = spyOnStatements();
      const updated = await rewriteFor(NO_NAME_RULE_ID);

      expect(planned.length).toBeGreaterThan(0);
      expect(updated).toBe(planned.length);
      expect(changedRowIds(before).sort()).toEqual([...planned].sort());
      expect(countOf(statements, /^update "transactions"/i)).toBe(
        Math.ceil(planned.length / IN_CLAUSE_CHUNK_SIZE),
      );
      // A page is read until one comes back short, so an exact multiple costs one empty page.
      expect(pageReadsOf(statements)).toBe(Math.floor(rows.length / REWRITE_PAGE_SIZE) + 1);
    },
    TEST_TIMEOUT,
  );
});
