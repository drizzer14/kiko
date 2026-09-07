import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// `updateTitle`/`updateIcon` run their update through the `write` helper (one
// op-sqlite transaction). Override `write` to run the callback against a fake
// transaction handle so the test can capture the update payload issued inside
// that single transaction.
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

import { categories, categoryOverrides, transactions } from '../db/schema';

// CANONICAL_SEED is the canonical seed the migration must insert: one stable
// slug per MCC category (src/monobank/mcc-category.ts) plus `other`. Task 14's
// MCC -> display-key mapping must produce these exact keys. Shared with the
// screen tests via one fixture so the canonical list lives in a single place.
import { SEEDED_CATEGORIES as CANONICAL_SEED } from './__fixtures__/seeded-categories';
import { categoriesRepo } from './categories.repo';

describe('categoriesRepo', () => {
  it('exposes a live query selecting every category row', () => {
    expect(categoriesRepo.allQuery().toSQL().sql).toContain('categories');
  });

  it('allQuery orders by sortOrder then key', () => {
    // The reorderable categories list renders in the user-controlled
    // `sort_order`, with the stable `key` as a tiebreak (categories have no
    // createdAt, so the primary-key slug is the deterministic fallback).
    const { sql } = categoriesRepo.allQuery().toSQL();
    const orderBy = sql.toLowerCase().split('order by')[1] ?? '';
    expect(orderBy).toContain('sort_order');
    expect(orderBy).toContain('key');
  });

  it('updateTitle writes the new title for the given key', async () => {
    const captured: { set?: Record<string, unknown>; whereCalled: boolean } = {
      whereCalled: false,
    };
    mockTx = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.set = values;
          return {
            where: () => {
              captured.whereCalled = true;
              return Promise.resolve();
            },
          };
        },
      }),
    };

    await categoriesRepo.updateTitle('groceries', 'Food');

    expect(captured.set).toEqual({ title: 'Food' });
    expect(captured.whereCalled).toBe(true);
  });

  // A fake write-transaction handle for the create path. `create` first reads
  // the current global max `sort_order` via `select(...).from(categories)` (to
  // append at `max + 1`), then inserts. This answers that max query with
  // `maxSortOrder` and captures the insert payload.
  const makeCreateTx = (
    maxSortOrder = -1,
  ): { tx: unknown; captured: { values?: Record<string, unknown> } } => {
    const captured: { values?: Record<string, unknown> } = {};
    const tx = {
      select: () => ({ from: () => Promise.resolve([{ value: maxSortOrder }]) }),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          captured.values = values;

          return Promise.resolve();
        },
      }),
    };
    return { tx, captured };
  };

  it('create inserts a new category with a generated key, title and icon', async () => {
    const { tx, captured } = makeCreateTx();
    mockTx = tx;

    await categoriesRepo.create({ title: 'Travel', icon: 'airplane' });

    expect(captured.values).toMatchObject({ title: 'Travel', icon: 'airplane' });
    // The key is generated (not one of the seeded slugs), so it must be a
    // non-empty string the caller never supplied.
    const generatedKey = captured.values?.key;
    expect(typeof generatedKey).toBe('string');
    expect((generatedKey as string).length).toBeGreaterThan(0);
  });

  it('create appends the category at the global sortOrder = max + 1', async () => {
    const { tx, captured } = makeCreateTx(4);
    mockTx = tx;

    await categoriesRepo.create({ title: 'Travel', icon: 'airplane' });

    expect(captured.values).toMatchObject({ sortOrder: 5 });
  });

  it('create uses sortOrder 0 for the first category', async () => {
    const { tx, captured } = makeCreateTx(-1);
    mockTx = tx;

    await categoriesRepo.create({ title: 'Travel', icon: 'airplane' });

    expect(captured.values).toMatchObject({ sortOrder: 0 });
  });

  it('updateIcon writes the new icon for the given key', async () => {
    const captured: { set?: Record<string, unknown>; whereCalled: boolean } = {
      whereCalled: false,
    };
    mockTx = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.set = values;
          return {
            where: () => {
              captured.whereCalled = true;
              return Promise.resolve();
            },
          };
        },
      }),
    };

    await categoriesRepo.updateIcon('groceries', 'basket');

    expect(captured.set).toEqual({ icon: 'basket' });
    expect(captured.whereCalled).toBe(true);
  });

  it('updateColor writes the new color for the given key', async () => {
    const captured: { set?: Record<string, unknown>; whereCalled: boolean } = {
      whereCalled: false,
    };
    mockTx = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.set = values;
          return {
            where: () => {
              captured.whereCalled = true;
              return Promise.resolve();
            },
          };
        },
      }),
    };

    await categoriesRepo.updateColor('groceries', '#FFCC00');

    expect(captured.set).toEqual({ color: '#FFCC00' });
    expect(captured.whereCalled).toBe(true);
  });

  it('create persists the picked color when supplied, and null when omitted', async () => {
    const captured: { values?: Record<string, unknown> } = {};
    mockTx = {
      select: () => ({ from: () => Promise.resolve([{ value: -1 }]) }),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          captured.values = values;
          return Promise.resolve();
        },
      }),
    };

    await categoriesRepo.create({ title: 'Travel', icon: 'airplane', color: '#33AAFF' });
    expect(captured.values).toMatchObject({ title: 'Travel', icon: 'airplane', color: '#33AAFF' });

    await categoriesRepo.create({ title: 'Travel', icon: 'airplane' });
    expect(captured.values).toMatchObject({ color: null });
  });
});

describe('categoriesRepo.reorder', () => {
  it('rewrites each category sortOrder to its 0-based index in the new order', async () => {
    const sortOrders: unknown[] = [];
    mockTx = {
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: () => {
            sortOrders.push(set.sortOrder);
            return Promise.resolve();
          },
        }),
      }),
    };

    await categoriesRepo.reorder(['c3', 'c1', 'c2']);

    expect(sortOrders).toEqual([0, 1, 2]);
  });
});

describe('categoriesRepo.delete', () => {
  // Fake tx: read the single settings row (for the current default key), then
  // the two category reassign updates (transactions + overrides) and the
  // category-row delete, each captured so the test can assert the whole
  // transaction without a real database.
  const makeTx = (settingsRows: { defaultCategoryKey: string }[]) => {
    const captured: {
      txUpdate?: Record<string, unknown>;
      txWhere?: unknown;
      overrideUpdate?: Record<string, unknown>;
      overrideWhere?: unknown;
      deletedTable?: unknown;
    } = {};
    const tx = {
      select: () => ({ from: () => Promise.resolve(settingsRows) }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: (predicate: unknown) => {
            if (table === transactions) {
              captured.txUpdate = values;
              captured.txWhere = predicate;
            }
            if (table === categoryOverrides) {
              captured.overrideUpdate = values;
              captured.overrideWhere = predicate;
            }
            return Promise.resolve();
          },
        }),
      }),
      delete: (table: unknown) => ({
        where: () => {
          captured.deletedTable = table;
          return Promise.resolve();
        },
      }),
    };

    return { tx, captured };
  };

  it('reassigns matching transactions and overrides to the default, then removes the category row', async () => {
    const { tx, captured } = makeTx([{ defaultCategoryKey: 'other' }]);
    mockTx = tx;

    await categoriesRepo.delete('groceries');

    expect(captured.txUpdate).toEqual({ category: 'other' });
    expect(captured.overrideUpdate).toEqual({ category: 'other' });
    expect(captured.deletedTable).toBe(categories);
  });

  // The reassign predicates are the thing under test here, and this suite
  // drives a FAKE transaction handle (there is no in-memory SQLite in the Jest
  // environment — op-sqlite is a native module), so the observable behaviour is
  // the SQL the repository compiles. Render it through Drizzle's own SQLite
  // dialect and assert the comparison is case-insensitive: a row synced before
  // `categoryForMcc` emitted slugs stores 'Groceries', and neither column is
  // COLLATE NOCASE, so a plain `category = 'groceries'` would match none of
  // them and leave them orphaned on a deleted category.
  const dialect = new SQLiteSyncDialect();
  const renderPredicate = (predicate: unknown): { sql: string; params: unknown[] } => {
    const query = dialect.sqlToQuery(predicate as SQL);

    return { sql: query.sql, params: [...query.params] };
  };

  it('reassigns a capitalized legacy category on delete', async () => {
    const { tx, captured } = makeTx([{ defaultCategoryKey: 'other' }]);
    mockTx = tx;

    await categoriesRepo.delete('groceries');

    expect(renderPredicate(captured.txWhere)).toEqual({
      sql: 'lower("transactions"."category") = ?',
      params: ['groceries'],
    });
  });

  it('reassigns a capitalized legacy override on delete', async () => {
    const { tx, captured } = makeTx([{ defaultCategoryKey: 'other' }]);
    mockTx = tx;

    await categoriesRepo.delete('groceries');

    expect(renderPredicate(captured.overrideWhere)).toEqual({
      sql: 'lower("category_overrides"."category") = ?',
      params: ['groceries'],
    });
  });

  it('compares against the lowercased key even when the key itself is capitalized', async () => {
    const { tx, captured } = makeTx([{ defaultCategoryKey: 'other' }]);
    mockTx = tx;

    await categoriesRepo.delete('Groceries');

    expect(renderPredicate(captured.txWhere).params).toEqual(['groceries']);
    expect(renderPredicate(captured.overrideWhere).params).toEqual(['groceries']);
  });

  it('reassigns to the CURRENT (configurable) default, not a hardcoded one', async () => {
    const { tx, captured } = makeTx([{ defaultCategoryKey: 'shopping' }]);
    mockTx = tx;

    await categoriesRepo.delete('groceries');

    expect(captured.txUpdate).toEqual({ category: 'shopping' });
    expect(captured.overrideUpdate).toEqual({ category: 'shopping' });
  });

  it('refuses to delete the default category and writes nothing', async () => {
    const { tx, captured } = makeTx([{ defaultCategoryKey: 'other' }]);
    mockTx = tx;

    await expect(categoriesRepo.delete('other')).rejects.toThrow(/default/i);

    expect(captured.txUpdate).toBeUndefined();
    expect(captured.overrideUpdate).toBeUndefined();
    expect(captured.deletedTable).toBeUndefined();
  });
});

describe('categories seed migration', () => {
  const migrationsDir = join(__dirname, '../../drizzle/migrations');
  const migrationFiles = (): { name: string; sql: string }[] =>
    readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') }));

  const createMigration = (): { name: string; sql: string } => {
    const file = migrationFiles().find(({ sql }) => sql.includes('CREATE TABLE `categories`'));
    if (file === undefined) {
      throw new Error('No migration creates the categories table');
    }
    return file;
  };

  const seedMigration = (): { name: string; sql: string } => {
    const file = migrationFiles().find(
      ({ sql }) => sql.includes('INSERT') && sql.includes('`categories`'),
    );
    if (file === undefined) {
      throw new Error('No migration seeds the categories table');
    }
    return file;
  };

  it('creates the categories table', () => {
    expect(createMigration().sql).toContain('CREATE TABLE `categories`');
  });

  it('seeds the categories in a separate migration applied after the create migration', () => {
    // The seed MUST live in its own, later migration. A database that already
    // applied a create-only categories migration (its create timestamp already
    // recorded) receives the seed only if the seed is a distinct, later journal
    // entry — otherwise the seed never runs and every transaction resolves to
    // the neutral fallback. This is exactly bug B4.
    const create = createMigration();
    const seed = seedMigration();

    expect(seed.name).not.toBe(create.name);
    expect(seed.name > create.name).toBe(true);
  });

  it('seeds exactly the ten canonical categories idempotently with non-empty title and icon', () => {
    const { sql } = seedMigration();

    for (const { key, title, icon } of CANONICAL_SEED) {
      expect(title.length).toBeGreaterThan(0);
      expect(icon.length).toBeGreaterThan(0);
      expect(sql).toContain(`'${key}'`);
      expect(sql).toContain(`'${title}'`);
      expect(sql).toContain(`'${icon}'`);
    }

    // `INSERT OR IGNORE` keeps the seed idempotent: re-applying it against a
    // table that already holds some (or all) canonical rows must not throw on
    // the primary-key conflict.
    const insertCount = (sql.match(/INSERT OR IGNORE INTO `categories`/g) ?? []).length;
    expect(insertCount).toBe(CANONICAL_SEED.length);
  });

  it('adds a nullable color column to the categories table in a later migration', () => {
    const files = migrationFiles();
    const create = createMigration();
    const alter = files.find(({ sql }) => /ALTER TABLE `categories` ADD `color` text/i.test(sql));

    expect(alter).toBeDefined();
    // The ALTER must be its own, later migration than the create — a DB that already
    // recorded the create timestamp only picks up the column via a distinct later entry.
    expect((alter as { name: string }).name > create.name).toBe(true);
  });

  it('adds a sort_order column to the categories table and backfills it in a later migration', () => {
    const files = migrationFiles();
    const create = createMigration();
    const alter = files.find(({ sql }) =>
      /ALTER TABLE `categories` ADD `sort_order` integer DEFAULT 0 NOT NULL/i.test(sql),
    );

    expect(alter).toBeDefined();
    // Its own, later migration than the create — a DB that already recorded the
    // create timestamp only picks up the new column via a distinct later entry.
    expect((alter as { name: string }).name > create.name).toBe(true);
    // The same migration backfills a stable per-row rank from `rowid`, so the
    // current display order is preserved on upgrade instead of collapsing to a
    // `sort_order = 0` tie (mirrors 0006_backfill_sort_order for accounts/holdings).
    expect((alter as { sql: string }).sql).toMatch(/UPDATE `categories` SET `sort_order`/i);
    expect((alter as { sql: string }).sql).toContain('rowid');
  });
});
