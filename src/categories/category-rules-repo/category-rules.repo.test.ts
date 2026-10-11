// The rewrite and the rule write are SQL over the stored ledger: which rows are candidates, which
// the exchange, balance-setting and split-change columns and the by-hand flag exclude, and how the
// statements are chunked can only be shown against a real engine.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { database, write } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { parseRuleMatchers, type CategoryRuleMatcher } from '@kiko/categories/category-rules';

import {
  categoryRulesRepo,
  rewriteDescriptionRowsQuery,
  rewriteForRuleDatabaseTransaction,
  rewritePageQuery,
} from './category-rules.repo';

type TransactionSeed = {
  id: string;
  description: string;
  category?: string | null;
  amountMinorUnits?: number;
  holdingId?: string;
  categorySetByHand?: boolean;
  exchangePairId?: string;
  exchangeCounterpartHoldingId?: string;
  setsBalance?: boolean;
  changeGroupId?: string;
};

type RuleSeed = {
  id: string;
  category: string;
  matchers: CategoryRuleMatcher[];
  createdAt?: number;
  updatedAt?: number;
};

type StoredRule = {
  id: string;
  category: string;
  matchers: string;
  created_at: number;
  updated_at: number;
};

const SEEDED_UPDATED_AT = 1_000;

const insertTransaction = (row: TransactionSeed): void => {
  mockDatabase
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category,
         source, category_set_by_hand, exchange_pair_id, exchange_counterpart_holding_id,
         sets_balance, change_group_id)
       VALUES (?, ?, ?, 1000, ?, ?, 'manual', ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.holdingId ?? 'uah-card',
      row.amountMinorUnits ?? -100,
      row.description,
      row.category ?? null,
      row.categorySetByHand ? 1 : 0,
      row.exchangePairId ?? null,
      row.exchangeCounterpartHoldingId ?? null,
      row.setsBalance ? 1 : 0,
      row.changeGroupId ?? null,
    );
};

const insertRule = (rule: RuleSeed): void => {
  mockDatabase
    .prepare(
      'INSERT INTO category_rules (id, category, matchers, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      rule.id,
      rule.category,
      JSON.stringify(rule.matchers),
      rule.createdAt ?? 500,
      rule.updatedAt ?? SEEDED_UPDATED_AT,
    );
};

const categoriesOf = (): Record<string, string | null> =>
  Object.fromEntries(
    (
      mockDatabase.prepare('SELECT id, category FROM transactions ORDER BY id').all() as {
        id: string;
        category: string | null;
      }[]
    ).map((row) => [row.id, row.category]),
  );

const flagOf = (id: string): number =>
  (
    mockDatabase
      .prepare('SELECT category_set_by_hand AS flag FROM transactions WHERE id = ?')
      .get(id) as { flag: number }
  ).flag;

const storedRules = (): StoredRule[] =>
  mockDatabase.prepare('SELECT * FROM category_rules ORDER BY id').all() as StoredRule[];

const textsOf = (rule: StoredRule): string[] =>
  (parseRuleMatchers(rule.matchers) ?? []).flatMap((matcher) =>
    matcher.type === 'nameIs' ? [matcher.text] : [],
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

const insertFillerRows = (count: number): void => {
  mockDatabase.exec('BEGIN');

  const insert = mockDatabase.prepare(
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, source)
     VALUES (?, 'uah-card', -300, 1000, 'filler', 'manual')`,
  );

  for (let index = 0; index < count; index += 1) {
    insert.run(`filler-${String(index).padStart(5, '0')}`);
  }

  mockDatabase.exec('COMMIT');
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency)
      VALUES ('uah-card', 'account', 'UAH card', 'card', 'UAH'),
             ('usd-card', 'account', 'USD card', 'card', 'USD');
  `);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('categoryRulesRepo.allQuery', () => {
  it('builds a reactive query targeting category_rules', () => {
    expect(categoryRulesRepo.allQuery().toSQL().sql).toContain('category_rules');
  });
});

describe('categoryRulesRepo.applyNameRule', () => {
  it('changes exactly the rows whose normalized name matches, and leaves the other names alone', async () => {
    insertRule({ id: 'atb-rule', category: 'shops', matchers: [{ type: 'nameIs', text: 'Atb' }] });
    insertTransaction({ id: 'plain', description: 'Silpo', category: 'groceries' });
    insertTransaction({ id: 'spaced', description: '  SILPO  ', category: null });
    insertTransaction({ id: 'cyrillic', description: 'Сільпо', category: 'groceries' });
    insertTransaction({ id: 'other', description: 'Atb', category: 'groceries' });

    await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: null,
    });

    expect(categoriesOf()).toEqual({
      cyrillic: 'groceries',
      other: 'groceries',
      plain: 'food',
      spaced: 'food',
    });
  });

  it('keeps a row whose category the user picked by hand', async () => {
    insertTransaction({
      id: 'picked',
      description: 'Silpo',
      category: 'groceries',
      categorySetByHand: true,
    });

    const updated = await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: null,
    });

    expect(updated).toBe(0);
    expect(categoriesOf()).toEqual({ picked: 'groceries' });
    expect(flagOf('picked')).toBe(1);
  });

  it('does not count a row that already has the category', async () => {
    insertTransaction({ id: 'already', description: 'Silpo', category: 'food' });
    insertTransaction({ id: 'moved', description: 'Silpo', category: 'groceries' });

    const updated = await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: null,
    });

    expect(updated).toBe(1);
    expect(categoriesOf()).toEqual({ already: 'food', moved: 'food' });
  });

  it('leaves an exchange leg, a balance-setting row and a split-change row alone', async () => {
    insertTransaction({
      id: 'exchange-pair',
      description: 'Silpo',
      category: 'groceries',
      exchangePairId: 'pair',
    });
    insertTransaction({
      id: 'exchange-counterpart',
      description: 'Silpo',
      category: 'groceries',
      exchangeCounterpartHoldingId: 'usd-card',
    });
    insertTransaction({
      id: 'balance',
      description: 'Silpo',
      category: 'groceries',
      setsBalance: true,
    });
    insertTransaction({
      id: 'change',
      description: 'Silpo',
      category: 'groceries',
      changeGroupId: 'group',
    });
    insertTransaction({ id: 'plain', description: 'Silpo', category: 'groceries' });

    const updated = await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: null,
    });

    expect(updated).toBe(1);
    expect(categoriesOf()).toEqual({
      balance: 'groceries',
      change: 'groceries',
      'exchange-counterpart': 'groceries',
      'exchange-pair': 'groceries',
      plain: 'food',
    });
  });

  it('moves the rule that is exactly that one name, keeping its id and creation time', async () => {
    insertRule({
      id: 'silpo-rule',
      category: 'groceries',
      matchers: [{ type: 'nameIs', text: 'SILPO' }],
    });

    await categoryRulesRepo.applyNameRule({
      name: '  Silpo ',
      category: 'food',
      sourceTransactionId: null,
    });

    const [rule, ...others] = storedRules();

    expect(others).toEqual([]);
    expect(rule).toMatchObject({ id: 'silpo-rule', category: 'food', created_at: 500 });
    expect(textsOf(rule)).toEqual(['Silpo']);
    expect(rule.updated_at).toBeGreaterThan(SEEDED_UPDATED_AT);
  });

  it('adds a rule when none is exactly that name, and leaves a stronger rule on that name alone', async () => {
    const stronger: RuleSeed = {
      id: 'silpo-expense',
      category: 'shops',
      matchers: [
        { type: 'nameIs', text: 'silpo' },
        { type: 'direction', direction: 'expense' },
      ],
    };

    insertRule(stronger);
    insertTransaction({ id: 'expense', description: 'Silpo', category: 'groceries' });
    insertTransaction({
      id: 'income',
      description: 'Silpo',
      category: 'groceries',
      amountMinorUnits: 100,
    });

    const updated = await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: null,
    });

    const rules = storedRules();
    const added = rules.filter((rule) => rule.id !== stronger.id);

    expect(rules.find((rule) => rule.id === stronger.id)).toMatchObject({
      category: 'shops',
      created_at: 500,
      updated_at: SEEDED_UPDATED_AT,
      matchers: JSON.stringify(stronger.matchers),
    });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ category: 'food' });
    expect(parseRuleMatchers(added[0].matchers)).toEqual([{ type: 'nameIs', text: 'Silpo' }]);
    expect(updated).toBe(1);
    expect(categoriesOf()).toEqual({ expense: 'groceries', income: 'food' });
  });

  it('frees the source row from the by-hand mark so the rule moves it', async () => {
    insertTransaction({
      id: 'source',
      description: 'Silpo',
      category: 'groceries',
      categorySetByHand: true,
    });

    const updated = await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: 'source',
    });

    expect(updated).toBe(1);
    expect(categoriesOf()).toEqual({ source: 'food' });
    expect(flagOf('source')).toBe(0);
  });

  it('gives a split-change source row the picked category, while other split-change rows keep theirs', async () => {
    insertTransaction({
      id: 'source',
      description: 'Silpo',
      category: 'groceries',
      changeGroupId: 'group',
      categorySetByHand: true,
    });
    insertTransaction({
      id: 'other-change',
      description: 'Silpo',
      category: 'groceries',
      changeGroupId: 'group',
    });
    insertTransaction({ id: 'plain', description: 'Silpo', category: 'groceries' });

    const updated = await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: 'source',
    });

    expect(updated).toBe(2);
    expect(categoriesOf()).toEqual({
      'other-change': 'groceries',
      plain: 'food',
      source: 'food',
    });
    expect(flagOf('source')).toBe(0);
  });

  it('gives an exchange-leg source row the picked category, while other exchange legs keep theirs', async () => {
    insertTransaction({
      id: 'source',
      description: 'Silpo',
      category: 'groceries',
      exchangePairId: 'pair',
      categorySetByHand: true,
    });
    insertTransaction({
      id: 'other-leg',
      description: 'Silpo',
      category: 'groceries',
      exchangeCounterpartHoldingId: 'usd-card',
    });

    await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: 'source',
    });

    expect(categoriesOf()).toEqual({ 'other-leg': 'groceries', source: 'food' });
    expect(flagOf('source')).toBe(0);
  });

  it('gives a balance-setting source row the picked category', async () => {
    insertTransaction({
      id: 'source',
      description: 'Silpo',
      category: 'groceries',
      setsBalance: true,
    });

    await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: 'source',
    });

    expect(categoriesOf()).toEqual({ source: 'food' });
  });

  it('gives a source row whose description is not the rule name the picked category too', async () => {
    insertTransaction({ id: 'source', description: 'Silpo Market', category: 'groceries' });

    const updated = await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: 'source',
    });

    expect(updated).toBe(1);
    expect(categoriesOf()).toEqual({ source: 'food' });
  });

  it('writes nothing for a blank name', async () => {
    insertTransaction({ id: 'plain', description: '', category: 'groceries' });

    const updated = await categoryRulesRepo.applyNameRule({
      name: '   ',
      category: 'food',
      sourceTransactionId: null,
    });

    expect(updated).toBe(0);
    expect(storedRules()).toEqual([]);
    expect(categoriesOf()).toEqual({ plain: 'groceries' });
  });

  it('updates every row when more descriptions match than one IN list may hold', async () => {
    // One or two spaces between 16 words: 2^15 raw spellings of one normalized name.
    const words = Array.from({ length: 16 }, (_, index) => `w${index}`);
    const spellings = Array.from({ length: 32_001 }, (_, number) =>
      words.reduce(
        (text, word, index) => `${text}${(number >> (index - 1)) & 1 ? '  ' : ' '}${word}`,
      ),
    );

    mockDatabase.exec('BEGIN');

    const insert = mockDatabase.prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category, source)
       VALUES (?, 'uah-card', -100, 1000, ?, 'groceries', 'manual')`,
    );

    spellings.forEach((spelling, index) => {
      insert.run(`row-${index}`, spelling);
    });
    mockDatabase.exec('COMMIT');

    const statements = spyOnStatements();
    const updated = await categoryRulesRepo.applyNameRule({
      name: words.join(' '),
      category: 'food',
      sourceTransactionId: null,
    });

    expect(updated).toBe(32_001);
    expect(
      mockDatabase
        .prepare("SELECT count(*) AS total FROM transactions WHERE category = 'food'")
        .get(),
    ).toEqual({ total: 32_001 });
    expect(statements.filter((sql) => /^update "transactions"/i.test(sql))).toHaveLength(2);
  });
});

describe('rewriteForRuleDatabaseTransaction', () => {
  const rewriteFor = (ruleId: string): Promise<number> =>
    write((databaseTransaction) => rewriteForRuleDatabaseTransaction(databaseTransaction, ruleId));

  it('pages through every row for a rule with no name, joining the currency from the holding', async () => {
    insertRule({
      id: 'small-expense',
      category: 'coffee',
      matchers: [
        { type: 'direction', direction: 'expense' },
        { type: 'amount', operator: 'lte', minorUnits: 500, currency: 'UAH' },
      ],
    });
    insertTransaction({ id: 'matching', description: 'a', amountMinorUnits: -300 });
    insertTransaction({ id: 'too-large', description: 'b', amountMinorUnits: -900 });
    insertTransaction({ id: 'income', description: 'c', amountMinorUnits: 300 });
    insertTransaction({
      id: 'other-currency',
      description: 'd',
      amountMinorUnits: -300,
      holdingId: 'usd-card',
    });
    insertTransaction({
      id: 'picked',
      description: 'e',
      amountMinorUnits: -300,
      categorySetByHand: true,
    });
    insertFillerRows(4_500);

    const statements = spyOnStatements();
    const updated = await rewriteFor('small-expense');

    expect(updated).toBe(4_501);
    expect(categoriesOf()).toMatchObject({
      matching: 'coffee',
      'too-large': null,
      income: null,
      'other-currency': null,
      picked: null,
      'filler-00000': 'coffee',
      'filler-04499': 'coffee',
    });
    expect(
      statements.filter((sql) => /^select/i.test(sql) && /from "transactions"/i.test(sql)),
    ).toHaveLength(3);
  });

  it('changes nothing for a rule that is not stored', async () => {
    insertTransaction({ id: 'plain', description: 'Silpo', category: 'groceries' });

    expect(await rewriteFor('missing')).toBe(0);
    expect(categoriesOf()).toEqual({ plain: 'groceries' });
  });
});

describe('the rewrite queries', () => {
  const planOf = (query: { toSQL: () => { sql: string; params: unknown[] } }): string[] => {
    const { sql, params } = query.toSQL();

    return (
      mockDatabase.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as (string | number)[])) as {
        detail: string;
      }[]
    ).map((step) => step.detail);
  };

  it('pages the ledger by its primary key, with no sort step', () => {
    const plan = planOf(rewritePageQuery(database, 'some-id'));

    expect(plan).toContainEqual(
      expect.stringContaining(
        'SEARCH transactions USING INDEX sqlite_autoindex_transactions_1 (id>?)',
      ),
    );
    expect(plan.join('\n')).not.toMatch(/TEMP B-TREE/);
    expect(plan.join('\n')).not.toMatch(/transactions_exchange_pair_id/);
  });

  it('reads the rows of a description list with a plain scan, never through an exchange index', () => {
    const plan = planOf(rewriteDescriptionRowsQuery(database, ['silpo', 'atb']));

    expect(plan).toContainEqual(expect.stringContaining('SCAN transactions'));
    expect(plan.join('\n')).not.toMatch(/transactions_exchange_pair_id/);
  });
});
