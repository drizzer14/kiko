// drizzle/migrations/0056-add-category-rules.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the copy of every override into a rule and the
// new flag are proven against real rows.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseRuleMatchers } from '@kiko/categories/category-rules';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

const MIGRATION_SQL = readFileSync(join(__dirname, '0056_add_category_rules.sql'), 'utf8');

type Column = { name: string; type: string; notnull: number; dflt_value: string | null };

type RuleRow = {
  id: string;
  category: string;
  matchers: string;
  created_at: number;
  updated_at: number;
};

type OverrideSeed = {
  normalizedName: string;
  category: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
};

const OVERRIDES: OverrideSeed[] = [
  {
    normalizedName: 'silpo',
    category: 'food',
    displayName: 'Silpo',
    createdAt: 1_000,
    updatedAt: 2_000,
  },
  {
    normalizedName: 'сільпо',
    category: 'food',
    displayName: 'Сільпо',
    createdAt: 1_100,
    updatedAt: 2_100,
  },
  {
    normalizedName: 'atb market',
    category: 'groceries',
    displayName: 'ATB MaRKet',
    createdAt: 1_200,
    updatedAt: 2_200,
  },
  {
    normalizedName: 'atb market shop',
    category: 'groceries',
    displayName: 'ATB  Market   Shop',
    createdAt: 1_300,
    updatedAt: 2_300,
  },
  { normalizedName: '', category: 'other', displayName: '   ', createdAt: 1_400, updatedAt: 2_400 },
];

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')) {
    database.exec(statement);
  }
};

const insertOverride = (database: DatabaseSync, override: OverrideSeed): void => {
  database
    .prepare(
      `INSERT INTO category_overrides (normalized_name, category, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      override.normalizedName,
      override.category,
      override.displayName,
      override.createdAt,
      override.updatedAt,
    );
};

const insertTransaction = (database: DatabaseSync, id: string): void => {
  database
    .prepare(
      `INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')
       ON CONFLICT (id) DO NOTHING`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
       VALUES ('holding', 'account', 'Card', 'card', 'UAH', 100)
       ON CONFLICT (id) DO NOTHING`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category, source)
       VALUES (?, 'holding', -100, 1000, 'Silpo', 'food', 'manual')`,
    )
    .run(id);
};

const databaseThrough0055 = (overrides: OverrideSeed[] = OVERRIDES): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0055_add_dismissed_tips');

  for (const override of overrides) {
    insertOverride(database, override);
  }

  return database;
};

const rulesOf = (database: DatabaseSync): RuleRow[] =>
  database.prepare('SELECT * FROM category_rules ORDER BY created_at').all() as RuleRow[];

const columnsOf = (database: DatabaseSync, table: string): Column[] =>
  database.prepare(`SELECT * FROM pragma_table_info('${table}')`).all() as Column[];

describe('migration 0056: category rules replace category overrides', () => {
  it('turns every override into exactly one rule with its category and timestamps', () => {
    const database = databaseThrough0055();

    applyMigration(database);

    expect(
      rulesOf(database).map(({ category, created_at, updated_at }) => ({
        category,
        created_at,
        updated_at,
      })),
    ).toEqual(
      OVERRIDES.map(({ category, createdAt, updatedAt }) => ({
        category,
        created_at: createdAt,
        updated_at: updatedAt,
      })),
    );
  });

  it('stores one nameIs matcher whose text is the display name', () => {
    const database = databaseThrough0055();

    applyMigration(database);

    const readable = rulesOf(database).filter((rule) => parseRuleMatchers(rule.matchers) !== null);

    expect(readable.map((rule) => parseRuleMatchers(rule.matchers))).toEqual(
      OVERRIDES.filter((override) => override.displayName.trim() !== '').map((override) => [
        { type: 'nameIs', text: override.displayName },
      ]),
    );
  });

  it('keeps a text that normalizes to the override key it came from', () => {
    const database = databaseThrough0055();

    applyMigration(database);

    const keys = rulesOf(database)
      .flatMap((rule) => parseRuleMatchers(rule.matchers) ?? [])
      .map((matcher) => (matcher.type === 'nameIs' ? normalizeTransactionName(matcher.text) : ''));

    expect(keys).toEqual(
      OVERRIDES.filter((override) => override.displayName.trim() !== '').map(
        (override) => override.normalizedName,
      ),
    );
  });

  it('stores a blank display name as a rule that fails the guard', () => {
    const database = databaseThrough0055();

    applyMigration(database);

    const blank = rulesOf(database).filter((rule) => parseRuleMatchers(rule.matchers) === null);

    expect(blank).toHaveLength(1);
    expect(blank[0]).toMatchObject({ category: 'other' });
  });

  it('gives every rule its own id of 32 hex characters', () => {
    const database = databaseThrough0055();

    applyMigration(database);

    const ids = rulesOf(database).map((rule) => rule.id);

    expect(new Set(ids).size).toBe(OVERRIDES.length);
    expect(ids.every((id) => /^[0-9a-f]{32}$/.test(id))).toBe(true);
  });

  it('makes no rule from no overrides', () => {
    const database = databaseThrough0055([]);

    applyMigration(database);

    expect(rulesOf(database)).toEqual([]);
  });

  it('drops the overrides table', () => {
    const database = databaseThrough0055();

    applyMigration(database);

    expect(columnsOf(database, 'category_overrides')).toEqual([]);
  });

  it('adds the by-hand flag, NOT NULL and defaulting to 0', () => {
    const database = databaseThrough0055();

    expect(columnsOf(database, 'transactions').map((column) => column.name)).not.toContain(
      'category_set_by_hand',
    );

    applyMigration(database);

    expect(
      columnsOf(database, 'transactions').find((column) => column.name === 'category_set_by_hand'),
    ).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: 'false' });
  });

  it('leaves every existing transaction unflagged', () => {
    const database = databaseThrough0055();

    insertTransaction(database, 'first');
    insertTransaction(database, 'second');
    applyMigration(database);

    expect(database.prepare('SELECT category_set_by_hand AS flag FROM transactions').all()).toEqual(
      [{ flag: 0 }, { flag: 0 }],
    );
  });

  it('has no index on the rules table beyond its primary key', () => {
    const database = databaseThrough0055();

    applyMigration(database);

    expect(
      (database.prepare("PRAGMA index_list('category_rules')").all() as { origin: string }[]).map(
        (index) => index.origin,
      ),
    ).toEqual(['pk']);
  });
});
