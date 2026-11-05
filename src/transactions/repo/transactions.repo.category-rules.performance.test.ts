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

jest.mock('@kiko/transactions/merchant-name', () => {
  const actual = jest.requireActual('@kiko/transactions/merchant-name') as {
    merchantNameOf: (name: string) => unknown;
  };

  return { ...actual, merchantNameOf: jest.fn((name: string) => actual.merchantNameOf(name)) };
});

import {
  type CategoryRuleMatcher,
  type ReviewCandidate,
  hasNoRealCategory,
  isRewriteEligible,
  matchesRule,
  parseRuleMatchers,
  planReviewGroups,
  planRuleRewrite,
  prepareRules,
  subjectOfStoredRow,
} from '@kiko/categories/category-rules';
import { DatabaseSync } from 'node:sqlite';
import { IN_CLAUSE_CHUNK_SIZE } from '@kiko/db';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';
import { buildRulesPerformanceFixture } from '@kiko/categories/category-rules/__fixtures__/rules-performance-fixture';

import { transactionsRepo } from './transactions.repo';

const INSERT_BATCH_SIZE = 10_000;
// The rewrite's keyset page length (`REWRITE_PAGE_SIZE` in the rules repo).
const REWRITE_PAGE_SIZE = 2_000;
const TEST_TIMEOUT = 120_000;
// A name rule that wins a few of the fixture's rows, and the no-name rule that wins the most.
const NAME_RULE_ID = 'rule-119';
const NO_NAME_RULE_ID = 'rule-190';
const REWRITTEN_CATEGORY = 'rewritten';

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
       source, category_set_by_hand, mcc)
     VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
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
      row.mcc,
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

// A count of page reads alone cannot tell the blank-row page from the keyset page of every row.
const blankPageReadsOf = (statements: string[]): string[] =>
  statements.filter((sql) => /"description" = \? and "transactions"\."id" > \?/i.test(sql));

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
      expect(
        countOf(statements, /^select "id", "name", "currency", "account_id" from "holdings"/i),
      ).toBe(1);
    },
    TEST_TIMEOUT,
  );
});

describe('rewriting 50 000 rows for a saved rule', () => {
  // The stored rule saved again with a category no row has and applied to the existing rows. It is
  // the newest of its strength once saved, so the plan reads the rules the same way.
  const savedRules = (ruleId: string) =>
    rules.map((rule) =>
      rule.id === ruleId ? { ...rule, category: REWRITTEN_CATEGORY, updatedAt: Date.now() } : rule,
    );

  const plannedFor = (ruleId: string): string[] =>
    planRuleRewrite(prepareRules(savedRules(ruleId)), ruleId, rows);

  const rewriteFor = async (ruleId: string): Promise<number> => {
    const stored = rules.find((rule) => rule.id === ruleId);
    const { changed } = await categoryRulesRepo.saveRule({
      id: ruleId,
      category: REWRITTEN_CATEGORY,
      matchers: parseRuleMatchers(stored?.matchers ?? '') ?? [],
      applyToExisting: true,
    });

    return changed;
  };

  const changedRowIds = (before: Map<string, string | null>): string[] =>
    [...categoriesById()]
      .filter(([rowId, category]) => before.get(rowId) !== category)
      .map(([rowId]) => rowId);

  it(
    'updates exactly the planned rows of a name rule in one statement, and pages only the blank rows',
    async () => {
      seedLedger();

      const planned = plannedFor(NAME_RULE_ID);
      const before = categoriesById();
      const statements = spyOnStatements();
      const updated = await rewriteFor(NAME_RULE_ID);

      expect(planned.length).toBeGreaterThan(0);
      expect(updated).toBe(planned.length);
      expect(changedRowIds(before).sort()).toEqual([...planned].sort());
      expect(countOf(statements, /^update "transactions"/i)).toBe(
        Math.ceil(planned.length / IN_CLAUSE_CHUNK_SIZE),
      );
      // The ledger is not paged: the one page read is the blank rows' (a label is not stored, so
      // they are always candidates), and this ledger has none.
      expect(pageReadsOf(statements)).toBe(1);

      const [blankPageRead] = blankPageReadsOf(statements);

      expect(blankPageReadsOf(statements)).toHaveLength(1);
      expect(mockDatabase.prepare(blankPageRead).all('', '', REWRITE_PAGE_SIZE)).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    'updates exactly the planned rows of a rule with no name, reading every row a page at a time',
    async () => {
      seedLedger();

      const planned = plannedFor(NO_NAME_RULE_ID);
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

describe('rewriting 50 000 rows for a rule with a new condition', () => {
  const MERCHANT_CODE = 5411;
  const CONTAINED_TEXT = 'rozetka 1';

  // A one-matcher rule stored under its own id, then saved again with a category no row has, so it
  // is the newest of its strength once saved, as in the rewrite above.
  const withOwnRule = (ruleId: string, matcher: CategoryRuleMatcher) => {
    const matchers = JSON.stringify([matcher]);

    mockDatabase
      .prepare(
        'INSERT INTO category_rules (id, category, matchers, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(ruleId, 'seeded', matchers, 9_000, 9_000);

    const plan = planRuleRewrite(
      prepareRules([
        ...rules,
        {
          id: ruleId,
          category: REWRITTEN_CATEGORY,
          matchers,
          createdAt: 9_000,
          updatedAt: Date.now(),
        },
      ]),
      ruleId,
      rows,
    );
    const rewrite = async (): Promise<number> =>
      (
        await categoryRulesRepo.saveRule({
          id: ruleId,
          category: REWRITTEN_CATEGORY,
          matchers: [matcher],
          applyToExisting: true,
        })
      ).changed;

    return { plan, rewrite };
  };

  const changedRowIds = (before: Map<string, string | null>): string[] =>
    [...categoriesById()]
      .filter(([rowId, category]) => before.get(rowId) !== category)
      .map(([rowId]) => rowId);

  it(
    'updates exactly the planned rows of an mcc rule, a page at a time',
    async () => {
      seedLedger();

      const { plan, rewrite } = withOwnRule('rule-own-mcc', { type: 'mcc', code: MERCHANT_CODE });
      const before = categoriesById();
      const statements = spyOnStatements();
      const updated = await rewrite();

      expect(plan.length).toBeGreaterThan(0);
      expect(updated).toBe(plan.length);
      expect(changedRowIds(before).sort()).toEqual([...plan].sort());
      expect(countOf(statements, /^update "transactions"/i)).toBe(
        Math.ceil(plan.length / IN_CLAUSE_CHUNK_SIZE),
      );
      // A code is read from the row itself, so every row is paged, and an exact multiple of the
      // page length costs one empty page.
      expect(pageReadsOf(statements)).toBe(Math.floor(rows.length / REWRITE_PAGE_SIZE) + 1);
      expect(blankPageReadsOf(statements)).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    'updates exactly the planned rows of a nameContains rule with no page of the ledger',
    async () => {
      seedLedger();

      const { plan, rewrite } = withOwnRule('rule-own-contains', {
        type: 'nameContains',
        text: CONTAINED_TEXT,
      });
      const before = categoriesById();
      const statements = spyOnStatements();
      const updated = await rewrite();

      expect(plan.length).toBeGreaterThan(0);
      expect(updated).toBe(plan.length);
      expect(changedRowIds(before).sort()).toEqual([...plan].sort());
      expect(countOf(statements, /^update "transactions"/i)).toBe(
        Math.ceil(plan.length / IN_CLAUSE_CHUNK_SIZE),
      );
      // Only the blank rows' page is read; this ledger has none.
      expect(pageReadsOf(statements)).toBe(1);
      expect(blankPageReadsOf(statements)).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );
});

describe('listing the review groups of 50 000 rows', () => {
  type ReviewCandidateQuery = PromiseLike<ReviewCandidate[]> & {
    toSQL: () => { sql: string; params: unknown[] };
  };

  const reviewCandidateRowsQuery = (): ReviewCandidateQuery =>
    (
      categoryRulesRepo as unknown as { reviewCandidateRowsQuery: () => ReviewCandidateQuery }
    ).reviewCandidateRowsQuery();

  const candidateRows: ReviewCandidate[] = rows.map((row) => ({
    ...row,
    exchangeCounterpartHoldingId: null,
    untrackedCounterpart: null,
  }));

  const knownCategoryKeys = (): ReadonlySet<string> =>
    new Set(
      (mockDatabase.prepare('SELECT key FROM categories').all() as { key: string }[]).map((row) =>
        row.key.toLowerCase(),
      ),
    );

  // Found by scanning every rule for every row, so it shares neither the name index nor the order
  // of the checks of the code under test.
  const bruteForceKept = (known: ReadonlySet<string>): ReviewCandidate[] =>
    candidateRows.filter(
      (row) =>
        hasNoRealCategory(row, known) &&
        isRewriteEligible(row) &&
        !prepared.ordered.some((rule) => matchesRule(rule, subjectOfStoredRow(row))),
    );

  it(
    'plans the review list from one candidate read',
    async () => {
      seedLedger();

      const known = knownCategoryKeys();
      const statements = spyOnStatements();
      const read = await reviewCandidateRowsQuery();
      const groups = planReviewGroups(prepared, read, known);

      expect(countOf(statements, /^select .* from "transactions"/i)).toBe(1);
      expect(countOf(statements, /^(insert|update|delete)/i)).toBe(0);
      expect(read.length).toBeGreaterThan(0);
      expect(read.length).toBeLessThan(rows.length);
      expect(groups.length).toBeGreaterThan(0);
      expect(groups).toEqual(planReviewGroups(prepared, candidateRows, known));
    },
    TEST_TIMEOUT,
  );

  it(
    'planReviewGroups keeps only what the brute-force filter keeps',
    () => {
      const known = knownCategoryKeys();
      const kept = bruteForceKept(known);
      const keptByKey = new Map<string, number>();

      for (const row of kept) {
        const { key } = merchantNameOf(row.description);

        keptByKey.set(key, (keptByKey.get(key) ?? 0) + 1);
      }

      const groups = planReviewGroups(prepared, candidateRows, known);

      expect(kept.length).toBeGreaterThan(0);
      expect(kept.length).toBeLessThan(rows.length);
      expect(new Map(groups.map((group) => [group.key, group.rowCount]))).toEqual(keptByKey);
    },
    TEST_TIMEOUT,
  );

  it(
    'calls merchantNameOf once per distinct description',
    () => {
      jest.mocked(merchantNameOf).mockClear();
      planReviewGroups(prepared, candidateRows, knownCategoryKeys());

      const described = jest.mocked(merchantNameOf).mock.calls.map(([name]) => name);

      expect(described.length).toBeGreaterThan(0);
      expect(new Set(described).size).toBe(described.length);
      expect(described.length).toBeLessThanOrEqual(
        new Set(rows.map((row) => row.description)).size,
      );
    },
    TEST_TIMEOUT,
  );

  it('reviewCandidateRowsQuery scans the table with no temp B-tree', () => {
    const { sql: statement, params } = reviewCandidateRowsQuery().toSQL();
    const plan = (
      mockDatabase
        .prepare(`EXPLAIN QUERY PLAN ${statement}`)
        .all(...(params as (string | number)[])) as { detail: string }[]
    ).map((step) => step.detail);

    expect(plan).toContainEqual(expect.stringContaining('SCAN transactions'));
    expect(plan.join('\n')).not.toMatch(/TEMP B-TREE/);
  });
});
