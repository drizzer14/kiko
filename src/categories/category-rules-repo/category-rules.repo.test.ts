// The rewrite and the rule write are SQL over the stored ledger: which rows are candidates, which
// the balance-setting and split-change columns and the by-hand flag exclude, how an exchange leg
// reads by its counterpart holding, and how the statements are chunked can only be shown against a
// real engine.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { database } from '@kiko/db';
import { i18n } from '@kiko/i18n/init';
import {
  parseRuleMatchers,
  type CategoryRuleMatcher,
  type NameRuleKind,
} from '@kiko/categories/category-rules';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

import {
  categoryRulesRepo,
  rewriteBlankPageQuery,
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

const NAME_AND_DIRECTION_MATCHERS: CategoryRuleMatcher[] = [
  { type: 'nameIs', text: 'silpo' },
  { type: 'direction', direction: 'expense' },
];

const insertSilpo = (id: string, seed: Partial<TransactionSeed> = {}): void => {
  insertTransaction({ id, description: 'Silpo', category: 'groceries', ...seed });
};

const applySilpoRule = (sourceTransactionId: string | null = null) =>
  categoryRulesRepo.applyNameRule({ name: 'Silpo', category: 'food', sourceTransactionId });

const addedRulesBeside = (rule: RuleSeed): StoredRule[] =>
  storedRules().filter((stored) => stored.id !== rule.id);

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
    insertSilpo('plain');
    insertTransaction({ id: 'spaced', description: '  SILPO  ', category: null });
    insertTransaction({ id: 'cyrillic', description: 'Сільпо', category: 'groceries' });
    insertTransaction({ id: 'other', description: 'Atb', category: 'groceries' });

    await applySilpoRule();

    expect(categoriesOf()).toEqual({
      cyrillic: 'groceries',
      other: 'groceries',
      plain: 'food',
      spaced: 'food',
    });
  });

  it('keeps a row whose category the user picked by hand', async () => {
    insertSilpo('picked', { categorySetByHand: true });

    const updated = await applySilpoRule();

    expect(updated).toBe(0);
    expect(categoriesOf()).toEqual({ picked: 'groceries' });
    expect(flagOf('picked')).toBe(1);
  });

  it('does not count a row that already has the category', async () => {
    insertSilpo('already', { category: 'food' });
    insertSilpo('moved');

    const updated = await applySilpoRule();

    expect(updated).toBe(1);
    expect(categoriesOf()).toEqual({ already: 'food', moved: 'food' });
  });

  it('gives an exchange leg the category, and leaves a balance-setting row and a split-change row alone', async () => {
    insertSilpo('exchange-pair', { exchangePairId: 'pair' });
    insertSilpo('exchange-counterpart', { exchangeCounterpartHoldingId: 'usd-card' });
    insertSilpo('untracked', { untrackedCounterpart: 'wallet:UMFUTURE' });
    insertSilpo('balance', { setsBalance: true });
    insertSilpo('change', { changeGroupId: 'group' });
    insertSilpo('plain');

    const updated = await applySilpoRule();

    expect(updated).toBe(4);
    expect(categoriesOf()).toEqual({
      balance: 'groceries',
      change: 'groceries',
      'exchange-counterpart': 'food',
      'exchange-pair': 'food',
      plain: 'food',
      untracked: 'food',
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
      matchers: NAME_AND_DIRECTION_MATCHERS,
    };

    insertRule(stronger);
    insertSilpo('expense');
    insertSilpo('income', { amountMinorUnits: 100 });

    const updated = await applySilpoRule();

    const rules = storedRules();
    const added = addedRulesBeside(stronger);

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
    insertSilpo('source', { categorySetByHand: true });

    const updated = await applySilpoRule('source');

    expect(updated).toBe(1);
    expect(categoriesOf()).toEqual({ source: 'food' });
    expect(flagOf('source')).toBe(0);
  });

  describe('when a stronger rule of another category wins the source row', () => {
    const SILPO_EXPENSE_SHOPS: RuleSeed = {
      id: 'silpo-expense',
      category: 'shops',
      matchers: NAME_AND_DIRECTION_MATCHERS,
    };

    const seedRows = (): void => {
      insertSilpo('source', { category: 'shops' });
      insertSilpo('same-expense', { category: 'shops' });
      insertSilpo('income', { amountMinorUnits: 100 });
    };

    it('gives the source row the picked category and keeps it there by hand, so the pick stays', async () => {
      insertRule(SILPO_EXPENSE_SHOPS);
      seedRows();

      await applySilpoRule('source');

      expect(categoriesOf().source).toBe('food');
      expect(flagOf('source')).toBe(1);
    });

    it('leaves the other rows that stronger rule wins in its category, and moves the rest', async () => {
      insertRule(SILPO_EXPENSE_SHOPS);
      seedRows();

      const updated = await applySilpoRule('source');

      expect(updated).toBe(2);
      expect(categoriesOf()).toEqual({ income: 'food', 'same-expense': 'shops', source: 'food' });
      expect(flagOf('income')).toBe(0);
      expect(flagOf('same-expense')).toBe(0);
    });

    it('creates the name rule for the picked category beside the stronger one', async () => {
      insertRule(SILPO_EXPENSE_SHOPS);
      seedRows();

      await applySilpoRule('source');

      const added = addedRulesBeside(SILPO_EXPENSE_SHOPS);

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

      await applySilpoRule('source');

      expect(storedRules().map((rule) => rule.id)).toEqual(['silpo-expense', 'silpo-name']);
      expect(storedRules().find((rule) => rule.id === 'silpo-name')).toMatchObject({
        category: 'food',
      });
      expect(categoriesOf().source).toBe('food');
      expect(flagOf('source')).toBe(1);
    });

    it('frees the source row as usual when the stronger rule has the picked category too', async () => {
      insertRule({ ...SILPO_EXPENSE_SHOPS, category: 'food' });
      insertSilpo('source', { categorySetByHand: true });

      await applySilpoRule('source');

      expect(categoriesOf().source).toBe('food');
      expect(flagOf('source')).toBe(0);
    });

    it('frees the source row as usual when the stronger rule is stored with the picked category in other case', async () => {
      insertRule({ ...SILPO_EXPENSE_SHOPS, category: 'Food' });
      insertSilpo('source', { categorySetByHand: true });

      await applySilpoRule('source');

      expect(categoriesOf().source).toBe('food');
      expect(flagOf('source')).toBe(0);
    });
  });

  it('does not count a source row that holds the picked category in other case', async () => {
    insertSilpo('source', { category: 'Food' });

    const updated = await applySilpoRule('source');

    expect(updated).toBe(0);
  });

  it('gives a split-change source row the picked category, while other split-change rows keep theirs', async () => {
    insertSilpo('source', { changeGroupId: 'group', categorySetByHand: true });
    insertSilpo('other-change', { changeGroupId: 'group' });
    insertSilpo('plain');

    const updated = await applySilpoRule('source');

    expect(updated).toBe(2);
    expect(categoriesOf()).toEqual({
      'other-change': 'groceries',
      plain: 'food',
      source: 'food',
    });
    expect(flagOf('source')).toBe(0);
  });

  it('gives an exchange-leg source row the picked category, and the other exchange legs follow the rule', async () => {
    insertSilpo('source', { exchangePairId: 'pair', categorySetByHand: true });
    insertSilpo('other-leg', { exchangeCounterpartHoldingId: 'usd-card' });

    await applySilpoRule('source');

    expect(categoriesOf()).toEqual({ 'other-leg': 'food', source: 'food' });
    expect(flagOf('source')).toBe(0);
  });

  it('gives a balance-setting source row the picked category', async () => {
    insertSilpo('source', { setsBalance: true });

    await applySilpoRule('source');

    expect(categoriesOf()).toEqual({ source: 'food' });
  });

  it('gives a source row whose description is not the rule name the picked category too', async () => {
    insertSilpo('source', { description: 'Silpo Market' });

    const updated = await applySilpoRule('source');

    expect(updated).toBe(1);
    expect(categoriesOf()).toEqual({ source: 'food' });
  });

  it('counts only the rewrite when the source row no longer exists', async () => {
    insertSilpo('plain');
    insertTransaction({ id: 'other', description: 'Atb', category: 'groceries' });

    const updated = await applySilpoRule('deleted');

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

const countFoodRewrite = (id: string | null) =>
  categoryRulesRepo.countRuleRewrite({ id, category: 'food', matchers: SILPO_FOOD });

// A stored rule that a save of the same rule over its page would leave as it is.
const seedStoredRule = (storedCategory: string): void => {
  insertRule({ id: 'stored', category: storedCategory, matchers: SILPO_FOOD });
  insertSilpo('silpo');
};

describe('categoryRulesRepo.countRuleRewrite', () => {
  it('counts the rows a new rule would change, ranking the draft as the newest of its strength', async () => {
    insertRule({
      id: 'older',
      category: 'shops',
      matchers: [{ type: 'nameStartsWith', text: 'sil' }],
    });
    insertSilpo('silpo', { category: 'shops' });
    insertTransaction({ id: 'atb', description: 'Atb', category: 'shops' });

    const count = await countFoodRewrite(null);

    expect(count).toBe(1);
  });

  it('ranks the draft by its distinct matchers, so a matcher written twice adds no strength', async () => {
    insertRule({ id: 'stronger', category: 'shops', matchers: NAME_AND_DIRECTION_MATCHERS });
    insertSilpo('expense', { category: 'shops' });
    insertSilpo('income', { category: 'shops', amountMinorUnits: 100 });

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
    insertSilpo('silpo', { category: 'shops' });
    insertTransaction({ id: 'atb', description: 'Atb', category: 'groceries' });

    expect(await countFoodRewrite('edited')).toBe(1);
    expect(
      await categoryRulesRepo.countRuleRewrite({
        id: 'edited',
        category: 'shops',
        matchers: [{ type: 'nameIs', text: 'Atb' }],
      }),
    ).toBe(1);
  });

  it('counts nothing for a rule saved again exactly as it is stored', async () => {
    seedStoredRule('food');

    expect(await countFoodRewrite('stored')).toBe(0);
  });

  it('counts nothing for a rule whose stored category differs from its page only in case', async () => {
    seedStoredRule('Food');

    expect(await countFoodRewrite('stored')).toBe(0);
  });

  it('does not count a row whose category differs from the rule only in case', async () => {
    insertSilpo('capitalized', { category: 'Food' });
    insertSilpo('other');

    expect(await countFoodRewrite(null)).toBe(1);
  });

  it('counts only the rows a rule may rewrite, an exchange leg among them', async () => {
    insertSilpo('picked', { categorySetByHand: true });
    insertSilpo('balance', { setsBalance: true });
    insertSilpo('change', { changeGroupId: 'group' });
    insertSilpo('exchange', { exchangeCounterpartHoldingId: 'usd-card' });
    insertSilpo('plain');

    expect(await countFoodRewrite(null)).toBe(2);
  });

  it('writes nothing', async () => {
    insertRule({ id: 'older', category: 'shops', matchers: SILPO_FOOD });
    insertSilpo('silpo', { category: 'shops' });
    const rulesBefore = storedRules();

    await countFoodRewrite(null);

    expect(storedRules()).toEqual(rulesBefore);
    expect(categoriesOf()).toEqual({ silpo: 'shops' });
  });
});

describe('categoryRulesRepo.saveRule', () => {
  const saveFood = (applyToExisting: boolean, id: string | null = null) =>
    categoryRulesRepo.saveRule({ id, category: 'food', matchers: SILPO_FOOD, applyToExisting });

  const saveStoredRuleAgain = async (storedCategory: string) => {
    seedStoredRule(storedCategory);

    const rulesBefore = storedRules();

    return { saved: await saveFood(true, 'stored'), rulesBefore };
  };

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
    insertRule({ id: 'stronger', category: 'shops', matchers: NAME_AND_DIRECTION_MATCHERS });
    insertSilpo('expense');
    insertSilpo('income', { amountMinorUnits: 100 });

    const saved = await saveFood(true);

    expect(saved.changed).toBe(1);
    expect(categoriesOf()).toEqual({ expense: 'groceries', income: 'food' });
  });

  it('leaves a row picked by hand, a balance-setting row and a split-change row alone', async () => {
    insertSilpo('picked', { categorySetByHand: true });
    insertSilpo('balance', { setsBalance: true });
    insertSilpo('change', { changeGroupId: 'group' });

    const saved = await saveFood(true);

    expect(saved.changed).toBe(0);
    expect(categoriesOf()).toEqual({
      balance: 'groceries',
      change: 'groceries',
      picked: 'groceries',
    });
    expect(flagOf('picked')).toBe(1);
  });

  it('rewrites an exchange leg of every kind, and counts it in what the confirm promised', async () => {
    insertSilpo('pair', { exchangePairId: 'pair' });
    insertSilpo('counterpart', { exchangeCounterpartHoldingId: 'usd-card' });
    insertSilpo('untracked', { untrackedCounterpart: 'wallet:UMFUTURE' });
    const draft = { id: null, category: 'food', matchers: SILPO_FOOD };

    const promised = await categoryRulesRepo.countRuleRewrite(draft);
    const saved = await categoryRulesRepo.saveRule({ ...draft, applyToExisting: true });

    expect(promised).toBe(3);
    expect(saved.changed).toBe(3);
    expect(categoriesOf()).toEqual({ counterpart: 'food', pair: 'food', untracked: 'food' });
  });

  it('rewrites both legs of a wallet transfer for a rule with no name, and a plain row', async () => {
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

    expect(promised).toBe(3);
    expect(saved.changed).toBe(3);
    expect(categoriesOf()).toEqual({
      plain: 'food',
      'to-funding': 'food',
      'to-futures': 'food',
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
    const { saved, rulesBefore } = await saveStoredRuleAgain('food');

    expect(saved).toEqual({ id: 'stored', changed: 0 });
    expect(storedRules()).toEqual(rulesBefore);
    expect(categoriesOf()).toEqual({ silpo: 'groceries' });
  });

  it('writes nothing for a rule whose stored category differs from its page only in case', async () => {
    const { saved, rulesBefore } = await saveStoredRuleAgain('Food');

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

  it('reads the first page from the lowest id, including an id that starts with a digit', async () => {
    insertTransaction({ id: '0-first', description: 'a', amountMinorUnits: -300 });
    insertTransaction({ id: 'second', description: 'b', amountMinorUnits: -300 });

    const draft = { id: null, category: 'coffee', matchers: SMALL_EXPENSE };
    const counted = await categoryRulesRepo.countRuleRewrite(draft);
    const { changed } = await categoryRulesRepo.saveRule({ ...draft, applyToExisting: true });

    expect([counted, changed]).toEqual([2, 2]);
    expect(categoriesOf()).toEqual({ '0-first': 'coffee', second: 'coffee' });
  });
});

// A default-description row stores '' and shows its label ("UAH card expense") only at render
// time, so a rule reads the label, in the language the app runs in now.
describe('a row with no description', () => {
  const startsWith = (text: string): CategoryRuleMatcher => ({ type: 'nameStartsWith', text });
  const CARD_EXPENSE: CategoryRuleMatcher[] = [startsWith('UAH card expense')];
  const insertBlank = (id: string, seed: Partial<TransactionSeed> = {}): void => {
    insertTransaction({ id, description: '', category: 'groceries', ...seed });
  };
  const seedBlankRows = (): void => {
    insertBlank('blank-1');
    insertBlank('blank-2');
    insertBlank('blank-income', { amountMinorUnits: 100 });
    insertBlank('blank-dollar', { holdingId: 'usd-card' });
    insertTransaction({ id: 'named', description: 'Silpo', category: 'groceries' });
    insertBlank('leg', { exchangePairId: 'pair', exchangeCounterpartHoldingId: 'usd-card' });
  };
  const CARD_EXPENSE_DRAFT = { id: null, category: 'food', matchers: CARD_EXPENSE };
  const applyCardExpense = () =>
    categoryRulesRepo.saveRule({ ...CARD_EXPENSE_DRAFT, applyToExisting: true });

  it('counts the rows whose label the rule matches, and not a leg whose label reads another way', async () => {
    seedBlankRows();

    expect(await categoryRulesRepo.countRuleRewrite(CARD_EXPENSE_DRAFT)).toBe(2);
  });

  it('counts and rewrites a blank leg by the label it shows, with its counterpart named', async () => {
    seedBlankRows();
    const draft = { id: null, category: 'food', matchers: [startsWith('Exchange to USD card')] };

    const counted = await categoryRulesRepo.countRuleRewrite(draft);
    const { changed } = await categoryRulesRepo.saveRule({ ...draft, applyToExisting: true });

    expect([counted, changed]).toEqual([1, 1]);
    expect(categoriesOf()).toMatchObject({ leg: 'food', 'blank-1': 'groceries' });
  });

  it('reads a blank leg between two holdings of one currency as a transfer', async () => {
    mockDatabase.exec(`
      INSERT INTO holdings (id, account_id, name, type, currency)
        VALUES ('uah-savings', 'account', 'UAH savings', 'card', 'UAH');
    `);
    insertBlank('transfer-leg', {
      exchangePairId: 'pair',
      exchangeCounterpartHoldingId: 'uah-savings',
    });

    const exchange = await categoryRulesRepo.countRuleRewrite({
      id: null,
      category: 'food',
      matchers: [startsWith('Exchange to')],
    });
    const transfer = await categoryRulesRepo.countRuleRewrite({
      id: null,
      category: 'food',
      matchers: [startsWith('Transfer to UAH savings')],
    });

    expect([exchange, transfer]).toEqual([0, 1]);
  });

  it('rewrites exactly the rows the confirm counted', async () => {
    seedBlankRows();
    insertRule({ id: 'other', category: 'shops', matchers: [{ type: 'nameIs', text: 'Atb' }] });

    const counted = await categoryRulesRepo.countRuleRewrite(CARD_EXPENSE_DRAFT);
    const { changed } = await applyCardExpense();

    expect(changed).toBe(counted);
    expect(categoriesOf()).toMatchObject({
      'blank-1': 'food',
      'blank-2': 'food',
      'blank-income': 'groceries',
      'blank-dollar': 'groceries',
      named: 'groceries',
      leg: 'groceries',
    });
  });

  it('leaves a row with a real description to its description, whatever its label would read', async () => {
    insertTransaction({ id: 'named', description: 'Silpo', category: 'groceries' });

    expect((await applyCardExpense()).changed).toBe(0);
    expect(categoriesOf().named).toBe('groceries');
  });

  it('names the label by the holding the row lies on', async () => {
    seedBlankRows();

    await categoryRulesRepo.saveRule({
      id: null,
      category: 'food',
      matchers: [startsWith('USD card')],
      applyToExisting: true,
    });

    expect(categoriesOf()).toMatchObject({ 'blank-dollar': 'food', 'blank-1': 'groceries' });
  });

  it('judges a rule on the label together with its other matchers', async () => {
    seedBlankRows();
    insertBlank('blank-large', { amountMinorUnits: -50_000 });

    const { changed } = await categoryRulesRepo.saveRule({
      id: null,
      category: 'rent',
      matchers: [
        ...CARD_EXPENSE,
        { type: 'amount', operator: 'gt', minorUnits: 10_000, currency: 'UAH' },
      ],
      applyToExisting: true,
    });

    expect(changed).toBe(1);
    expect(categoriesOf()).toMatchObject({ 'blank-large': 'rent', 'blank-1': 'groceries' });
  });

  it('does not rewrite a blank row a stronger rule wins by its label, through a rule with no name', async () => {
    insertRule({
      id: 'stronger',
      category: 'bills',
      matchers: [startsWith('UAH card'), { type: 'direction', direction: 'expense' }],
    });
    insertBlank('blank-1', { category: 'bills' });
    insertBlank('blank-dollar', { holdingId: 'usd-card' });

    const { changed } = await categoryRulesRepo.saveRule({
      id: null,
      category: 'food',
      matchers: [{ type: 'direction', direction: 'expense' }],
      applyToExisting: true,
    });

    expect(changed).toBe(1);
    expect(categoriesOf()).toMatchObject({ 'blank-1': 'bills', 'blank-dollar': 'food' });
  });

  it('reads every page of the blank rows', async () => {
    mockDatabase.exec('BEGIN');

    const insert = mockDatabase.prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, source)
       VALUES (?, 'uah-card', -300, 1000, '', 'manual')`,
    );

    for (let index = 0; index < 4_500; index += 1) {
      insert.run(`blank-${String(index).padStart(5, '0')}`);
    }

    mockDatabase.exec('COMMIT');

    expect((await applyCardExpense()).changed).toBe(4_500);
  });

  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('uk');
    });

    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('counts and rewrites the rows the Ukrainian label matches, and not the English one', async () => {
      seedBlankRows();

      const counted = await categoryRulesRepo.countRuleRewrite({
        id: null,
        category: 'food',
        matchers: [startsWith('Витрата')],
      });
      const english = await categoryRulesRepo.countRuleRewrite(CARD_EXPENSE_DRAFT);
      const { changed } = await categoryRulesRepo.saveRule({
        id: null,
        category: 'food',
        matchers: [startsWith('Витрата')],
        applyToExisting: true,
      });

      expect([counted, english, changed]).toEqual([3, 0, 3]);
      expect(categoriesOf()).toMatchObject({
        'blank-1': 'food',
        'blank-2': 'food',
        'blank-dollar': 'food',
        'blank-income': 'groceries',
        leg: 'groceries',
      });
    });

    it('counts and rewrites a blank leg by the Ukrainian label with its counterpart', async () => {
      seedBlankRows();
      const draft = { id: null, category: 'food', matchers: [startsWith('Обмін на USD card')] };

      const counted = await categoryRulesRepo.countRuleRewrite(draft);
      const { changed } = await categoryRulesRepo.saveRule({ ...draft, applyToExisting: true });

      expect([counted, changed]).toEqual([1, 1]);
      expect(categoriesOf()).toMatchObject({ leg: 'food', 'blank-1': 'groceries' });
    });
  });

  describe('as the row the user applies a name rule from', () => {
    const STRONGER_BY_LABEL: RuleSeed = {
      id: 'stronger',
      category: 'bills',
      matchers: [startsWith('UAH card'), { type: 'direction', direction: 'expense' }],
    };

    it('sees the stronger rule that wins the row by its label and keeps the pick by hand', async () => {
      insertRule(STRONGER_BY_LABEL);
      insertBlank('source');

      await applySilpoRule('source');

      expect(categoriesOf().source).toBe('food');
      expect(flagOf('source')).toBe(1);
    });

    it('sees a blank leg by its exchange label', async () => {
      insertRule({
        id: 'stronger',
        category: 'bills',
        matchers: [startsWith('Exchange to'), { type: 'direction', direction: 'expense' }],
      });
      insertBlank('source', { exchangePairId: 'pair', exchangeCounterpartHoldingId: 'usd-card' });

      await applySilpoRule('source');

      expect(categoriesOf().source).toBe('food');
      expect(flagOf('source')).toBe(1);
    });

    it('sees the counterpart holding named in the label of an exchange leg', async () => {
      insertRule({
        id: 'stronger',
        category: 'bills',
        matchers: [startsWith('Exchange to USD card'), { type: 'direction', direction: 'expense' }],
      });
      insertBlank('source', { exchangePairId: 'pair', exchangeCounterpartHoldingId: 'usd-card' });

      await applySilpoRule('source');

      expect(flagOf('source')).toBe(1);
    });

    it('reads a leg between two holdings of one currency as a transfer', async () => {
      mockDatabase.exec(`
        INSERT INTO holdings (id, account_id, name, type, currency)
          VALUES ('uah-savings', 'account', 'UAH savings', 'card', 'UAH');
      `);
      insertRule({
        id: 'stronger',
        category: 'bills',
        matchers: [startsWith('Transfer to'), { type: 'direction', direction: 'expense' }],
      });
      insertBlank('source', {
        exchangePairId: 'pair',
        exchangeCounterpartHoldingId: 'uah-savings',
      });

      await applySilpoRule('source');

      expect(flagOf('source')).toBe(1);
    });

    describe('in Ukrainian', () => {
      beforeEach(async () => {
        await i18n.changeLanguage('uk');
      });

      afterEach(async () => {
        await i18n.changeLanguage('en');
      });

      it('sees the stronger rule by the Ukrainian label', async () => {
        insertRule({
          id: 'stronger',
          category: 'bills',
          matchers: [startsWith('Витрата: UAH'), { type: 'direction', direction: 'expense' }],
        });
        insertBlank('source');

        await applySilpoRule('source');

        expect(flagOf('source')).toBe(1);
      });
    });
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

  it('pages the blank rows by the primary key too, with no sort step', () => {
    const plan = planOf(rewriteBlankPageQuery(database, 'some-id'));

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

describe('a name rule of a store-number name', () => {
  type NameRulePreview = { count: number; names: string[] };
  type PreviewInput = {
    text: string;
    kind: NameRuleKind;
    category: string;
    sourceTransactionId?: string | null;
  };
  type ApplyInput = {
    name: string;
    kind?: NameRuleKind;
    category: string;
    sourceTransactionId: string | null;
  };

  const previewNameRule = (input: PreviewInput): Promise<NameRulePreview> =>
    categoryRulesRepo.previewNameRule({ sourceTransactionId: null, ...input });
  const applyNameRule = (input: ApplyInput): Promise<number> =>
    categoryRulesRepo.applyNameRule(input);

  const insertAtb = (
    id: string,
    description: string,
    seed: Partial<TransactionSeed> = {},
  ): void => {
    insertTransaction({ id, description, category: 'groceries', ...seed });
  };
  const seedAtbRows = (): void => {
    insertAtb('first', 'ATB 0212');
    insertAtb('second', 'atb  0212');
    insertAtb('third', 'ATB 0340');
    insertAtb('market', 'ATB Market');
    insertAtb('bank', 'ATBANK');
    insertAtb('hand', 'ATB 1', { categorySetByHand: true });
    insertAtb('balance', 'ATB Balance', { setsBalance: true });
    insertAtb('silpo', 'Silpo');
  };
  const PREFIX_TO_FOOD: PreviewInput = { text: 'ATB', kind: 'nameStartsWith', category: 'food' };
  const applyPrefixToFood = (sourceTransactionId: string | null = null): Promise<number> =>
    applyNameRule({
      name: PREFIX_TO_FOOD.text,
      kind: 'nameStartsWith',
      category: 'food',
      sourceTransactionId,
    });
  const matchersOf = (rule: StoredRule): CategoryRuleMatcher[] =>
    parseRuleMatchers(rule.matchers) ?? [];
  const changedIdsSince = (before: Record<string, string | null>): string[] =>
    Object.entries(categoriesOf())
      .filter(([id, category]) => before[id] !== category)
      .map(([id]) => id)
      .sort();

  describe('previewNameRule', () => {
    it('counts exactly the rows applyNameRule then changes', async () => {
      seedAtbRows();
      const before = categoriesOf();

      const preview = await previewNameRule(PREFIX_TO_FOOD);
      await applyPrefixToFood();
      const changed = changedIdsSince(before);
      const changedNames = (
        mockDatabase
          .prepare(
            `SELECT description FROM transactions WHERE id IN (${changed.map(() => '?').join(',')})`,
          )
          .all(...changed) as { description: string }[]
      ).map((row) => normalizeTransactionName(row.description));

      expect(changed).toEqual(['bank', 'first', 'market', 'second', 'third']);
      expect(preview.count).toBe(changed.length);
      expect([...new Set(changedNames)].sort()).toEqual(
        preview.names.map(normalizeTransactionName).sort(),
      );
    });

    it('writes nothing and adds no rule', async () => {
      seedAtbRows();
      insertRule({
        id: 'older',
        category: 'shops',
        matchers: [{ type: 'nameIs', text: 'ATB 0212' }],
      });
      const rowsBefore = mockDatabase.prepare('SELECT * FROM transactions ORDER BY id').all();
      const rulesBefore = storedRules();
      const statements = spyOnStatements();

      await previewNameRule(PREFIX_TO_FOOD);

      expect(statements.filter((sql) => /^\s*(insert|update|delete)\b/i.test(sql))).toEqual([]);
      expect(mockDatabase.prepare('SELECT * FROM transactions ORDER BY id').all()).toEqual(
        rowsBefore,
      );
      expect(storedRules()).toEqual(rulesBefore);
    });

    it('lists each normalized name once in full, most rows first', async () => {
      seedAtbRows();

      const { names } = await previewNameRule(PREFIX_TO_FOOD);

      expect(names).toEqual(['ATB 0212', 'ATB 0340', 'ATB Market', 'ATBANK']);
    });

    it('does not list a name a hand-set, balance-setting or already moved row alone holds', async () => {
      seedAtbRows();
      insertAtb('moved', 'ATB Moved', { category: 'food' });

      const { names } = await previewNameRule(PREFIX_TO_FOOD);

      expect(names).toEqual(['ATB 0212', 'ATB 0340', 'ATB Market', 'ATBANK']);
      expect(names).not.toContain('ATB 1');
      expect(names).not.toContain('ATB Balance');
      expect(names).not.toContain('ATB Moved');
    });

    it('of a one-name store-number rule counts its own rows', async () => {
      seedAtbRows();

      const preview = await previewNameRule({
        text: 'ATB 0212',
        kind: 'nameIs',
        category: 'food',
      });

      expect(preview).toEqual({ count: 2, names: ['ATB 0212'] });
    });

    it.each<NameRuleKind>(['nameIs', 'nameStartsWith'])(
      'of a blank text is zero with no names, kind %s',
      async (kind) => {
        seedAtbRows();

        expect(await previewNameRule({ text: '   ', kind, category: 'food' })).toEqual({
          count: 0,
          names: [],
        });
      },
    );

    it("includes a blank row's label as a name", async () => {
      insertTransaction({ id: 'blank', description: '', category: 'groceries' });
      insertAtb('named', 'Silpo');

      const preview = await previewNameRule({
        text: 'UAH card expense',
        kind: 'nameStartsWith',
        category: 'food',
      });

      expect(preview).toEqual({ count: 1, names: ['UAH card expense'] });
    });
  });

  describe('previewNameRule beside the source row Apply moves', () => {
    // The preview, then the apply with the same source: the one number and the one set of names.
    const previewThenApply = async (sourceTransactionId: string | null) => {
      const before = categoriesOf();
      const preview = await previewNameRule({ ...PREFIX_TO_FOOD, sourceTransactionId });
      const updated = await applyPrefixToFood(sourceTransactionId);
      const changed = changedIdsSince(before);

      return { preview, updated, changed };
    };

    const stronger: RuleSeed = {
      id: 'stronger',
      category: 'shops',
      matchers: [
        { type: 'nameIs', text: 'ATB 0212' },
        { type: 'direction', direction: 'expense' },
      ],
    };

    it.each<[string, Partial<TransactionSeed>, RuleSeed[]]>([
      ['a hand-set source', { categorySetByHand: true }, []],
      ['a balance-setting source', { setsBalance: true }, []],
      ['a source a stronger rule wins', { category: 'shops' }, [stronger]],
    ])('counts %s as the row Apply moves', async (_title, seed, rules) => {
      rules.forEach(insertRule);
      insertAtb('source', 'ATB 0212', seed);
      insertAtb('plain', 'ATB 0340');

      const { preview, updated, changed } = await previewThenApply('source');

      expect(changed).toEqual(['plain', 'source']);
      expect(updated).toBe(2);
      expect(preview).toEqual({ count: 2, names: ['ATB 0212', 'ATB 0340'] });
    });

    it('counts a hand-set source alone as the one row Apply moves', async () => {
      insertAtb('source', 'ATB 0212', { categorySetByHand: true });

      const { preview, updated, changed } = await previewThenApply('source');

      expect(changed).toEqual(['source']);
      expect(updated).toBe(1);
      expect(preview).toEqual({ count: 1, names: ['ATB 0212'] });
    });

    it('counts a source the rule already wins once', async () => {
      insertAtb('source', 'ATB 0212');
      insertAtb('plain', 'ATB 0340');

      const { preview, updated, changed } = await previewThenApply('source');

      expect(changed).toEqual(['plain', 'source']);
      expect(updated).toBe(2);
      expect(preview).toEqual({ count: 2, names: ['ATB 0212', 'ATB 0340'] });
    });

    it('leaves out a source already in the target category', async () => {
      insertAtb('source', 'ATB 0212', { category: 'food', categorySetByHand: true });
      insertAtb('plain', 'ATB 0340');

      const { preview, updated, changed } = await previewThenApply('source');

      expect(changed).toEqual(['plain']);
      expect(updated).toBe(1);
      expect(preview).toEqual({ count: 1, names: ['ATB 0340'] });
    });

    it('adds no row for a null source', async () => {
      insertAtb('source', 'ATB 0212', { categorySetByHand: true });
      insertAtb('plain', 'ATB 0340');

      const { preview, updated, changed } = await previewThenApply(null);

      expect(changed).toEqual(['plain']);
      expect(updated).toBe(1);
      expect(preview).toEqual({ count: 1, names: ['ATB 0340'] });
    });

    it('adds no row for a source that does not exist', async () => {
      insertAtb('plain', 'ATB 0340');

      const { preview, updated } = await previewThenApply('missing');

      expect(updated).toBe(1);
      expect(preview).toEqual({ count: 1, names: ['ATB 0340'] });
    });

    it('names a blank source by its label', async () => {
      insertTransaction({ id: 'source', description: '', categorySetByHand: true });

      const preview = await previewNameRule({
        text: 'UAH card',
        kind: 'nameStartsWith',
        category: 'food',
        sourceTransactionId: 'source',
      });

      expect(preview).toEqual({ count: 1, names: ['UAH card expense'] });
    });
  });

  describe('applyNameRule', () => {
    it('with no kind still writes nameIs', async () => {
      seedAtbRows();

      await applyNameRule({ name: 'ATB 0212', category: 'food', sourceTransactionId: null });

      expect(storedRules().map(matchersOf)).toEqual([[{ type: 'nameIs', text: 'ATB 0212' }]]);
      expect(categoriesOf()).toMatchObject({ first: 'food', second: 'food', third: 'groceries' });
    });

    it('stores nameStartsWith with the trimmed text as typed', async () => {
      seedAtbRows();

      await applyNameRule({
        name: '  Atb ',
        kind: 'nameStartsWith',
        category: 'food',
        sourceTransactionId: null,
      });

      expect(storedRules().map(matchersOf)).toEqual([[{ type: 'nameStartsWith', text: 'Atb' }]]);
    });

    it('moves an existing prefix rule to the new category and keeps its id', async () => {
      seedAtbRows();
      insertRule({
        id: 'prefix',
        category: 'groceries',
        matchers: [{ type: 'nameStartsWith', text: 'ATB' }],
      });
      insertRule({
        id: 'whole',
        category: 'shops',
        matchers: [{ type: 'nameIs', text: 'ATB' }],
      });

      await applyPrefixToFood();

      const rules = storedRules();

      expect(rules.map((rule) => rule.id)).toEqual(['prefix', 'whole']);
      expect(rules.find((rule) => rule.id === 'prefix')).toMatchObject({
        category: 'food',
        created_at: 500,
      });
      expect(rules.find((rule) => rule.id === 'whole')).toMatchObject({ category: 'shops' });
    });

    it('adds a prefix rule that takes rows from an older one-matcher rule by updatedAt and counts them', async () => {
      insertRule({
        id: 'older',
        category: 'shops',
        matchers: [{ type: 'nameIs', text: 'ATB 0212' }],
      });
      insertAtb('ruled', 'ATB 0212', { category: 'shops' });
      insertAtb('plain', 'ATB 0340');

      const updated = await applyPrefixToFood();

      expect(updated).toBe(2);
      expect(categoriesOf()).toEqual({ plain: 'food', ruled: 'food' });
      expect(storedRules().map((rule) => rule.id)).toContain('older');
      expect(storedRules()).toHaveLength(2);
    });

    it('leaves a row a rule with more conditions wins', async () => {
      insertRule({
        id: 'stronger',
        category: 'shops',
        matchers: [
          { type: 'nameIs', text: 'ATB 0212' },
          { type: 'direction', direction: 'expense' },
        ],
      });
      insertAtb('expense', 'ATB 0212', { category: 'shops' });
      insertAtb('income', 'ATB 0212', { amountMinorUnits: 100 });

      await applyPrefixToFood();

      expect(categoriesOf()).toEqual({ expense: 'shops', income: 'food' });
    });

    it('sets no hand flag on a row moved by a prefix rule', async () => {
      seedAtbRows();

      await applyPrefixToFood();

      expect(categoriesOf()).toMatchObject({ third: 'food', hand: 'groceries' });
      expect(flagOf('third')).toBe(0);
      expect(flagOf('hand')).toBe(1);
    });

    it('frees the source row as Apply does', async () => {
      seedAtbRows();

      const updated = await applyPrefixToFood('hand');

      expect(updated).toBe(6);
      expect(categoriesOf()).toMatchObject({ hand: 'food', third: 'food' });
      expect(flagOf('hand')).toBe(0);
    });
  });
});
