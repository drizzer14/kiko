// The rewrite and the rule write are SQL over the stored ledger: which rows are candidates, which
// the exchange, balance-setting and split-change columns and the by-hand flag exclude, and how the
// statements are chunked can only be shown against a real engine.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { database } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { parseRuleMatchers, type CategoryRuleMatcher } from '@kiko/categories/category-rules';

import {
  categoryRulesRepo,
  rewriteDescriptionRowsQuery,
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
  untrackedCounterpart?: string;
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
         untracked_counterpart, sets_balance, change_group_id)
       VALUES (?, ?, ?, 1000, ?, ?, 'manual', ?, ?, ?, ?, ?, ?)`,
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
      row.untrackedCounterpart ?? null,
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

describe('categoryRulesRepo.countRulesOfCategory', () => {
  it('counts the rules of a category whatever the case of the stored key', async () => {
    insertRule({ id: 'lower', category: 'food', matchers: [{ type: 'nameIs', text: 'Silpo' }] });
    insertRule({ id: 'capital', category: 'Food', matchers: [{ type: 'nameIs', text: 'Atb' }] });
    insertRule({ id: 'upper', category: 'FOOD', matchers: [{ type: 'nameIs', text: 'Novus' }] });
    insertRule({ id: 'other', category: 'shops', matchers: [{ type: 'nameIs', text: 'Rozetka' }] });

    expect(await categoryRulesRepo.countRulesOfCategory('food')).toBe(3);
    expect(await categoryRulesRepo.countRulesOfCategory('Food')).toBe(3);
  });

  it('counts a rule that can no longer be read, because deleting the category removes it too', async () => {
    insertRule({ id: 'readable', category: 'food', matchers: [{ type: 'nameIs', text: 'Silpo' }] });
    mockDatabase
      .prepare(
        'INSERT INTO category_rules (id, category, matchers, created_at, updated_at) VALUES (?, ?, ?, 1, 1)',
      )
      .run('broken', 'food', 'not json');

    expect(await categoryRulesRepo.countRulesOfCategory('food')).toBe(2);
  });

  it('counts nothing for a category without rules', async () => {
    insertRule({ id: 'other', category: 'shops', matchers: [{ type: 'nameIs', text: 'Rozetka' }] });

    expect(await categoryRulesRepo.countRulesOfCategory('food')).toBe(0);
  });
});

describe('categoryRulesRepo.deleteRule', () => {
  it('deletes only the rule it is given and changes no transaction', async () => {
    insertRule({ id: 'gone', category: 'food', matchers: [{ type: 'nameIs', text: 'Silpo' }] });
    insertRule({ id: 'kept', category: 'food', matchers: [{ type: 'nameIs', text: 'Atb' }] });
    insertTransaction({ id: 'row-1', description: 'Silpo', category: 'food' });
    insertTransaction({
      id: 'row-2',
      description: 'Silpo',
      category: 'groceries',
      categorySetByHand: true,
    });

    await categoryRulesRepo.deleteRule('gone');

    expect(storedRules().map((rule) => rule.id)).toEqual(['kept']);
    expect(categoriesOf()).toEqual({ 'row-1': 'food', 'row-2': 'groceries' });
    expect(flagOf('row-1')).toBe(0);
    expect(flagOf('row-2')).toBe(1);
  });

  it('does nothing for a rule that is not stored', async () => {
    insertRule({ id: 'kept', category: 'food', matchers: [{ type: 'nameIs', text: 'Atb' }] });

    await categoryRulesRepo.deleteRule('missing');

    expect(storedRules().map((rule) => rule.id)).toEqual(['kept']);
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

  describe('when a stronger rule of another category wins the source row', () => {
    const SILPO_EXPENSE_SHOPS: RuleSeed = {
      id: 'silpo-expense',
      category: 'shops',
      matchers: [
        { type: 'nameIs', text: 'silpo' },
        { type: 'direction', direction: 'expense' },
      ],
    };

    const seedRows = (): void => {
      insertTransaction({ id: 'source', description: 'Silpo', category: 'shops' });
      insertTransaction({ id: 'same-expense', description: 'Silpo', category: 'shops' });
      insertTransaction({
        id: 'income',
        description: 'Silpo',
        category: 'groceries',
        amountMinorUnits: 100,
      });
    };

    it('gives the source row the picked category and keeps it there by hand, so the pick stays', async () => {
      insertRule(SILPO_EXPENSE_SHOPS);
      seedRows();

      await categoryRulesRepo.applyNameRule({
        name: 'Silpo',
        category: 'food',
        sourceTransactionId: 'source',
      });

      expect(categoriesOf().source).toBe('food');
      expect(flagOf('source')).toBe(1);
    });

    it('leaves the other rows that stronger rule wins in its category, and moves the rest', async () => {
      insertRule(SILPO_EXPENSE_SHOPS);
      seedRows();

      const updated = await categoryRulesRepo.applyNameRule({
        name: 'Silpo',
        category: 'food',
        sourceTransactionId: 'source',
      });

      expect(updated).toBe(2);
      expect(categoriesOf()).toEqual({ income: 'food', 'same-expense': 'shops', source: 'food' });
      expect(flagOf('income')).toBe(0);
      expect(flagOf('same-expense')).toBe(0);
    });

    it('creates the name rule for the picked category beside the stronger one', async () => {
      insertRule(SILPO_EXPENSE_SHOPS);
      seedRows();

      await categoryRulesRepo.applyNameRule({
        name: 'Silpo',
        category: 'food',
        sourceTransactionId: 'source',
      });

      const added = storedRules().filter((rule) => rule.id !== SILPO_EXPENSE_SHOPS.id);

      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ category: 'food' });
      expect(parseRuleMatchers(added[0].matchers)).toEqual([{ type: 'nameIs', text: 'Silpo' }]);
    });

    it('moves the name rule that already exists instead of adding another, and keeps the pick', async () => {
      insertRule(SILPO_EXPENSE_SHOPS);
      insertRule({
        id: 'silpo-name',
        category: 'groceries',
        matchers: [{ type: 'nameIs', text: 'Silpo' }],
      });
      seedRows();

      await categoryRulesRepo.applyNameRule({
        name: 'Silpo',
        category: 'food',
        sourceTransactionId: 'source',
      });

      expect(storedRules().map((rule) => rule.id)).toEqual(['silpo-expense', 'silpo-name']);
      expect(storedRules().find((rule) => rule.id === 'silpo-name')).toMatchObject({
        category: 'food',
      });
      expect(categoriesOf().source).toBe('food');
      expect(flagOf('source')).toBe(1);
    });

    it('frees the source row as usual when the stronger rule has the picked category too', async () => {
      insertRule({ ...SILPO_EXPENSE_SHOPS, category: 'food' });
      insertTransaction({
        id: 'source',
        description: 'Silpo',
        category: 'groceries',
        categorySetByHand: true,
      });

      await categoryRulesRepo.applyNameRule({
        name: 'Silpo',
        category: 'food',
        sourceTransactionId: 'source',
      });

      expect(categoriesOf().source).toBe('food');
      expect(flagOf('source')).toBe(0);
    });

    it('frees the source row as usual when the stronger rule is stored with the picked category in other case', async () => {
      insertRule({ ...SILPO_EXPENSE_SHOPS, category: 'Food' });
      insertTransaction({
        id: 'source',
        description: 'Silpo',
        category: 'groceries',
        categorySetByHand: true,
      });

      await categoryRulesRepo.applyNameRule({
        name: 'Silpo',
        category: 'food',
        sourceTransactionId: 'source',
      });

      expect(categoriesOf().source).toBe('food');
      expect(flagOf('source')).toBe(0);
    });
  });

  it('does not count a source row that holds the picked category in other case', async () => {
    insertTransaction({ id: 'source', description: 'Silpo', category: 'Food' });

    const updated = await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: 'source',
    });

    expect(updated).toBe(0);
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

  it('counts only the rewrite when the source row no longer exists', async () => {
    insertTransaction({ id: 'plain', description: 'Silpo', category: 'groceries' });
    insertTransaction({ id: 'other', description: 'Atb', category: 'groceries' });

    const updated = await categoryRulesRepo.applyNameRule({
      name: 'Silpo',
      category: 'food',
      sourceTransactionId: 'deleted',
    });

    expect(updated).toBe(1);
    expect(categoriesOf()).toEqual({ other: 'groceries', plain: 'food' });
    expect(storedRules()).toHaveLength(1);
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

const SILPO_FOOD = [{ type: 'nameIs', text: 'Silpo' }] satisfies CategoryRuleMatcher[];

describe('categoryRulesRepo.countRuleRewrite', () => {
  it('counts the rows a new rule would change, ranking the draft as the newest of its strength', async () => {
    insertRule({
      id: 'older',
      category: 'shops',
      matchers: [{ type: 'nameStartsWith', text: 'sil' }],
    });
    insertTransaction({ id: 'silpo', description: 'Silpo', category: 'shops' });
    insertTransaction({ id: 'atb', description: 'Atb', category: 'shops' });

    const count = await categoryRulesRepo.countRuleRewrite({
      id: null,
      category: 'food',
      matchers: SILPO_FOOD,
    });

    expect(count).toBe(1);
  });

  it('ranks the draft by its distinct matchers, so a matcher written twice adds no strength', async () => {
    insertRule({
      id: 'stronger',
      category: 'shops',
      matchers: [
        { type: 'nameIs', text: 'silpo' },
        { type: 'direction', direction: 'expense' },
      ],
    });
    insertTransaction({ id: 'expense', description: 'Silpo', category: 'shops' });
    insertTransaction({
      id: 'income',
      description: 'Silpo',
      category: 'shops',
      amountMinorUnits: 100,
    });

    const count = await categoryRulesRepo.countRuleRewrite({
      id: null,
      category: 'food',
      matchers: [
        { type: 'nameIs', text: 'Silpo' },
        { type: 'nameIs', text: 'SILPO ' },
      ],
    });

    expect(count).toBe(1);
  });

  it('judges a rule that is being edited as it would be saved, not as it is stored', async () => {
    insertRule({ id: 'edited', category: 'shops', matchers: SILPO_FOOD });
    insertTransaction({ id: 'silpo', description: 'Silpo', category: 'shops' });
    insertTransaction({ id: 'atb', description: 'Atb', category: 'groceries' });

    expect(
      await categoryRulesRepo.countRuleRewrite({
        id: 'edited',
        category: 'food',
        matchers: SILPO_FOOD,
      }),
    ).toBe(1);
    expect(
      await categoryRulesRepo.countRuleRewrite({
        id: 'edited',
        category: 'shops',
        matchers: [{ type: 'nameIs', text: 'Atb' }],
      }),
    ).toBe(1);
  });

  it('counts nothing for a rule saved again exactly as it is stored', async () => {
    insertRule({ id: 'stored', category: 'food', matchers: SILPO_FOOD });
    insertTransaction({ id: 'silpo', description: 'Silpo', category: 'groceries' });

    expect(
      await categoryRulesRepo.countRuleRewrite({
        id: 'stored',
        category: 'food',
        matchers: SILPO_FOOD,
      }),
    ).toBe(0);
  });

  it('counts nothing for a rule whose stored category differs from its page only in case', async () => {
    insertRule({ id: 'stored', category: 'Food', matchers: SILPO_FOOD });
    insertTransaction({ id: 'silpo', description: 'Silpo', category: 'groceries' });

    expect(
      await categoryRulesRepo.countRuleRewrite({
        id: 'stored',
        category: 'food',
        matchers: SILPO_FOOD,
      }),
    ).toBe(0);
  });

  it('does not count a row whose category differs from the rule only in case', async () => {
    insertTransaction({ id: 'capitalized', description: 'Silpo', category: 'Food' });
    insertTransaction({ id: 'other', description: 'Silpo', category: 'groceries' });

    expect(
      await categoryRulesRepo.countRuleRewrite({
        id: null,
        category: 'food',
        matchers: SILPO_FOOD,
      }),
    ).toBe(1);
  });

  it('counts only the rows a rule may rewrite', async () => {
    insertTransaction({
      id: 'picked',
      description: 'Silpo',
      category: 'groceries',
      categorySetByHand: true,
    });
    insertTransaction({
      id: 'exchange',
      description: 'Silpo',
      category: 'groceries',
      exchangePairId: 'pair',
    });
    insertTransaction({ id: 'plain', description: 'Silpo', category: 'groceries' });

    expect(
      await categoryRulesRepo.countRuleRewrite({
        id: null,
        category: 'food',
        matchers: SILPO_FOOD,
      }),
    ).toBe(1);
  });

  it('writes nothing', async () => {
    insertRule({ id: 'older', category: 'shops', matchers: SILPO_FOOD });
    insertTransaction({ id: 'silpo', description: 'Silpo', category: 'shops' });
    const rulesBefore = storedRules();

    await categoryRulesRepo.countRuleRewrite({ id: null, category: 'food', matchers: SILPO_FOOD });

    expect(storedRules()).toEqual(rulesBefore);
    expect(categoriesOf()).toEqual({ silpo: 'shops' });
  });
});

describe('categoryRulesRepo.saveRule', () => {
  const saveFood = (applyToExisting: boolean, id: string | null = null) =>
    categoryRulesRepo.saveRule({ id, category: 'food', matchers: SILPO_FOOD, applyToExisting });

  it('applies a new rule to the rows it wins, counting only the rows that change', async () => {
    insertTransaction({ id: 'differs', description: 'Silpo', category: 'groceries' });
    insertTransaction({ id: 'uncategorised', description: 'silpo', category: null });
    insertTransaction({ id: 'already', description: 'Silpo', category: 'food' });
    insertTransaction({ id: 'other', description: 'Atb', category: 'groceries' });

    const saved = await saveFood(true);

    expect(saved.changed).toBe(2);
    expect(categoriesOf()).toEqual({
      already: 'food',
      differs: 'food',
      other: 'groceries',
      uncategorised: 'food',
    });
    expect(storedRules()).toHaveLength(1);
    expect(storedRules()[0]).toMatchObject({ id: saved.id, category: 'food' });
    expect(parseRuleMatchers(storedRules()[0].matchers)).toEqual(SILPO_FOOD);
  });

  it('leaves a row a stronger rule wins as it is', async () => {
    insertRule({
      id: 'stronger',
      category: 'shops',
      matchers: [
        { type: 'nameIs', text: 'silpo' },
        { type: 'direction', direction: 'expense' },
      ],
    });
    insertTransaction({ id: 'expense', description: 'Silpo', category: 'groceries' });
    insertTransaction({
      id: 'income',
      description: 'Silpo',
      category: 'groceries',
      amountMinorUnits: 100,
    });

    const saved = await saveFood(true);

    expect(saved.changed).toBe(1);
    expect(categoriesOf()).toEqual({ expense: 'groceries', income: 'food' });
  });

  it('leaves a row picked by hand, an exchange leg, a balance-setting row and a split-change row alone', async () => {
    insertTransaction({
      id: 'picked',
      description: 'Silpo',
      category: 'groceries',
      categorySetByHand: true,
    });
    insertTransaction({
      id: 'exchange',
      description: 'Silpo',
      category: 'groceries',
      exchangePairId: 'pair',
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

    const saved = await saveFood(true);

    expect(saved.changed).toBe(0);
    expect(categoriesOf()).toEqual({
      balance: 'groceries',
      change: 'groceries',
      exchange: 'groceries',
      picked: 'groceries',
    });
    expect(flagOf('picked')).toBe(1);
  });

  it('leaves both legs of a wallet transfer alone for a rule with no name, and rewrites a plain row', async () => {
    const withoutName: CategoryRuleMatcher[] = [{ type: 'direction', direction: 'expense' }];

    insertTransaction({
      id: 'to-futures',
      description: 'Transfer',
      category: 'groceries',
      untrackedCounterpart: 'wallet:UMFUTURE',
    });
    insertTransaction({
      id: 'to-funding',
      description: 'Transfer',
      category: 'groceries',
      exchangePairId: 'pair',
      exchangeCounterpartHoldingId: 'usd-card',
    });
    insertTransaction({ id: 'plain', description: 'Silpo', category: 'groceries' });
    const draft = { id: null, category: 'food', matchers: withoutName };

    const promised = await categoryRulesRepo.countRuleRewrite(draft);
    const saved = await categoryRulesRepo.saveRule({ ...draft, applyToExisting: true });

    expect(promised).toBe(1);
    expect(saved.changed).toBe(1);
    expect(categoriesOf()).toEqual({
      plain: 'food',
      'to-funding': 'groceries',
      'to-futures': 'groceries',
    });
  });

  it('changes exactly the number of rows the count promised, on data that did not change', async () => {
    insertRule({
      id: 'older',
      category: 'shops',
      matchers: [{ type: 'nameStartsWith', text: 'sil' }],
    });
    insertTransaction({ id: 'a', description: 'Silpo', category: 'shops' });
    insertTransaction({ id: 'b', description: ' SILPO', category: 'groceries' });
    insertTransaction({ id: 'c', description: 'Silpo', category: 'food' });
    insertTransaction({ id: 'd', description: 'Silpo', category: null, categorySetByHand: true });
    insertTransaction({ id: 'e', description: 'Atb', category: 'groceries' });
    const draft = { id: null, category: 'food', matchers: SILPO_FOOD };

    const promised = await categoryRulesRepo.countRuleRewrite(draft);
    const saved = await categoryRulesRepo.saveRule({ ...draft, applyToExisting: true });

    expect(promised).toBe(2);
    expect(saved.changed).toBe(promised);
  });

  it('includes a row inserted after the count that the rule wins', async () => {
    insertTransaction({ id: 'before', description: 'Silpo', category: 'groceries' });
    const draft = { id: null, category: 'food', matchers: SILPO_FOOD };

    const promised = await categoryRulesRepo.countRuleRewrite(draft);

    insertTransaction({ id: 'landed', description: 'Silpo', category: 'groceries' });

    const saved = await categoryRulesRepo.saveRule({ ...draft, applyToExisting: true });

    expect(saved.changed).toBe(promised + 1);
    expect(categoriesOf()).toEqual({ before: 'food', landed: 'food' });
  });

  it('saves the rule alone when it is not applied to the existing rows', async () => {
    insertTransaction({ id: 'silpo', description: 'Silpo', category: 'groceries' });

    const saved = await saveFood(false);

    expect(saved.changed).toBe(0);
    expect(categoriesOf()).toEqual({ silpo: 'groceries' });
    expect(storedRules().map((rule) => rule.id)).toEqual([saved.id]);
  });

  it('stamps a new rule with one time for its creation and its last change', async () => {
    const before = Date.now();
    const saved = await saveFood(false);
    const [rule] = storedRules();

    expect(rule.id).toBe(saved.id);
    expect(rule.created_at).toBeGreaterThanOrEqual(before);
    expect(rule.updated_at).toBe(rule.created_at);
  });

  it('writes nothing for a rule saved again exactly as it is stored', async () => {
    insertRule({ id: 'stored', category: 'food', matchers: SILPO_FOOD });
    insertTransaction({ id: 'silpo', description: 'Silpo', category: 'groceries' });
    const rulesBefore = storedRules();

    const saved = await saveFood(true, 'stored');

    expect(saved).toEqual({ id: 'stored', changed: 0 });
    expect(storedRules()).toEqual(rulesBefore);
    expect(categoriesOf()).toEqual({ silpo: 'groceries' });
  });

  it('writes nothing for a rule whose stored category differs from its page only in case', async () => {
    insertRule({ id: 'stored', category: 'Food', matchers: SILPO_FOOD });
    insertTransaction({ id: 'silpo', description: 'Silpo', category: 'groceries' });
    const rulesBefore = storedRules();

    const saved = await saveFood(true, 'stored');

    expect(saved).toEqual({ id: 'stored', changed: 0 });
    expect(storedRules()).toEqual(rulesBefore);
    expect(categoriesOf()).toEqual({ silpo: 'groceries' });
  });

  it('keeps the creation time of an edited rule and makes it the newest', async () => {
    insertRule({ id: 'stored', category: 'shops', matchers: SILPO_FOOD });

    await saveFood(false, 'stored');

    const [rule, ...others] = storedRules();

    expect(others).toEqual([]);
    expect(rule).toMatchObject({ id: 'stored', category: 'food', created_at: 500 });
    expect(rule.updated_at).toBeGreaterThan(SEEDED_UPDATED_AT);
  });

  it('never takes a row back from a rule that no longer matches it', async () => {
    insertRule({ id: 'edited', category: 'food', matchers: SILPO_FOOD });
    insertTransaction({ id: 'was-silpo', description: 'Silpo', category: 'food' });
    insertTransaction({ id: 'atb', description: 'Atb', category: 'groceries' });

    const saved = await categoryRulesRepo.saveRule({
      id: 'edited',
      category: 'food',
      matchers: [{ type: 'nameIs', text: 'Atb' }],
      applyToExisting: true,
    });

    expect(saved.changed).toBe(1);
    expect(categoriesOf()).toEqual({ atb: 'food', 'was-silpo': 'food' });
  });

  it('moves the rows an edited rule wins to the new category when only the category changes', async () => {
    insertRule({ id: 'edited', category: 'shops', matchers: SILPO_FOOD });
    insertTransaction({ id: 'one', description: 'Silpo', category: 'shops' });
    insertTransaction({ id: 'two', description: 'Silpo', category: 'shops' });
    insertTransaction({ id: 'other', description: 'Atb', category: 'shops' });

    const saved = await saveFood(true, 'edited');

    expect(saved.changed).toBe(2);
    expect(categoriesOf()).toEqual({ one: 'food', other: 'shops', two: 'food' });
  });

  it('refuses a rule with no condition', async () => {
    await expect(
      categoryRulesRepo.saveRule({
        id: null,
        category: 'food',
        matchers: [],
        applyToExisting: true,
      }),
    ).rejects.toThrow(new Error('categoryRulesRepo.saveRule: noMatchers'));
    expect(storedRules()).toEqual([]);
  });

  it('refuses a rule whose conditions can never match together', async () => {
    insertTransaction({ id: 'silpo', description: 'Silpo', category: 'groceries' });

    await expect(
      categoryRulesRepo.saveRule({
        id: null,
        category: 'food',
        matchers: [
          { type: 'time', operator: 'after', minuteOfDay: 22 * 60 },
          { type: 'time', operator: 'before', minuteOfDay: 6 * 60 },
        ],
        applyToExisting: true,
      }),
    ).rejects.toThrow(new Error('categoryRulesRepo.saveRule: neverMatches'));
    expect(storedRules()).toEqual([]);
    expect(categoriesOf()).toEqual({ silpo: 'groceries' });
  });

  it('refuses a second rule with the conditions of another one, and changes nothing', async () => {
    insertRule({ id: 'taken', category: 'shops', matchers: SILPO_FOOD });
    insertTransaction({ id: 'silpo', description: 'Silpo', category: 'groceries' });
    const rulesBefore = storedRules();

    await expect(
      categoryRulesRepo.saveRule({
        id: null,
        category: 'food',
        matchers: [{ type: 'nameIs', text: ' SILPO ' }],
        applyToExisting: true,
      }),
    ).rejects.toThrow(new Error('categoryRulesRepo.saveRule: duplicate'));
    expect(storedRules()).toEqual(rulesBefore);
    expect(categoriesOf()).toEqual({ silpo: 'groceries' });
  });

  // A matcher the engine cannot even match is refused as one that never matches; one it could match
  // but could not read back from storage is refused as unreadable.
  it.each([
    ['a blank name', 'unreadable', { type: 'nameIs', text: '   ' }],
    [
      'a negative amount',
      'neverMatches',
      { type: 'amount', operator: 'eq', minorUnits: -1, currency: 'UAH' },
    ],
    [
      'a fractional amount',
      'unreadable',
      { type: 'amount', operator: 'eq', minorUnits: 1.5, currency: 'UAH' },
    ],
    [
      'a minute past the end of the day',
      'neverMatches',
      { type: 'time', operator: 'after', minuteOfDay: 1440 },
    ],
  ] satisfies [string, string, CategoryRuleMatcher][])(
    'refuses a rule with %s as %s',
    async (_label, reason, matcher) => {
      await expect(
        categoryRulesRepo.saveRule({
          id: null,
          category: 'food',
          matchers: [matcher],
          applyToExisting: false,
        }),
      ).rejects.toThrow(new Error(`categoryRulesRepo.saveRule: ${reason}`));
      expect(storedRules()).toEqual([]);
    },
  );
});

describe('categoryRulesRepo.saveRule over a large ledger', () => {
  const SMALL_EXPENSE: CategoryRuleMatcher[] = [
    { type: 'direction', direction: 'expense' },
    { type: 'amount', operator: 'lte', minorUnits: 500, currency: 'UAH' },
  ];

  it('pages through every row for a rule with no name, joining the currency from the holding', async () => {
    insertRule({ id: 'small-expense', category: 'shops', matchers: SMALL_EXPENSE });
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
    const { changed } = await categoryRulesRepo.saveRule({
      id: 'small-expense',
      category: 'coffee',
      matchers: SMALL_EXPENSE,
      applyToExisting: true,
    });

    expect(changed).toBe(4_501);
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
