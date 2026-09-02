import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

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
});

describe('categories seed migration', () => {
  const migrationsDir = join(__dirname, '../../drizzle/migrations');
  const migrationFiles = (): { name: string; sql: string }[] =>
    readdirSync(migrationsDir)
      .filter(name => name.endsWith('.sql'))
      .sort()
      .map(name => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') }));

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
});
