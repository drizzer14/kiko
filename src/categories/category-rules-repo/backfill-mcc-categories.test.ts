let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { categoriesRepo } from '@kiko/categories/repo';
import { ADDED_MCC_CODES } from '@kiko/monobank/mcc-category';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { IN_CLAUSE_CHUNK_SIZE, database, settings } from '@kiko/db';

type RowsQuery = PromiseLike<{ id: string }[]> & {
  toSQL: () => { sql: string; params: unknown[] };
};

// Read at run time: the module does not exist yet.
const backfill = () =>
  jest.requireActual('./backfill-mcc-categories') as {
    backfillMccCategories: () => Promise<void>;
    mccBackfillRowsQuery: (databaseTransaction: typeof database) => RowsQuery;
  };

const FAILURE_TAG = '[mcc-backfill] back-fill failed';
const SECRET_NAME = 'Secret Shop';
const SECRET_IBAN = 'UA213223130000026007233566001';

type Seed = {
  id: string;
  mcc: number | null;
  category: string | null;
  description?: string;
  categorySetByHand?: boolean;
  setsBalance?: boolean;
  changeGroupId?: string;
};

const openDatabase = (): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('INSERT INTO settings (id) VALUES (1)');
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES ('bank', 'Bank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
      VALUES ('card', 'bank', 'Card', 'card', 'UAH', 12345);
  `);
};

const insertRow = (seed: Seed): void => {
  mockDatabase
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category,
        mcc, source, category_set_by_hand, sets_balance, change_group_id, counter_iban)
       VALUES (?, 'card', -100, 1000, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
    )
    .run(
      seed.id,
      seed.description ?? 'ATB',
      seed.category,
      seed.mcc,
      seed.categorySetByHand === true ? 1 : 0,
      seed.setsBalance === true ? 1 : 0,
      seed.changeGroupId ?? null,
      SECRET_IBAN,
    );
};

const categoryOf = (id: string): string | null =>
  (
    mockDatabase.prepare('SELECT category FROM transactions WHERE id = ?').get(id) as {
      category: string | null;
    }
  ).category;

const rowsOf = (...ids: string[]) =>
  mockDatabase
    .prepare(`SELECT * FROM transactions WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(...ids);

const markOf = async (): Promise<boolean | undefined> =>
  (await database.select({ mark: settings.mccCategoriesBackfilled }).from(settings)).at(0)?.mark;

const refuseMarkWrite = (): void => {
  mockDatabase.exec(`
    CREATE TRIGGER refuse_mark BEFORE UPDATE OF mcc_categories_backfilled ON settings
    BEGIN SELECT RAISE(ABORT, 'refused'); END;
  `);
};

describe('backfillMccCategories', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    openDatabase();
  });

  afterEach(() => {
    warn.mockRestore();
    jest.restoreAllMocks();
  });

  it('moves every planned row to its own mapped category and sets the mark', async () => {
    insertRow({ id: 'grocery', mcc: 5300, category: 'other' });
    insertRow({ id: 'rail', mcc: 4112, category: null });
    insertRow({ id: 'hotel', mcc: 7011, category: 'other' });
    insertRow({ id: 'unmapped', mcc: 6300, category: 'other' });

    await backfill().backfillMccCategories();

    expect(categoryOf('grocery')).toBe('groceries');
    expect(categoryOf('rail')).toBe('transport');
    expect(categoryOf('hotel')).toBe('travel');
    expect(categoryOf('unmapped')).toBe('other');
    expect(await markOf()).toBe(true);
  });

  it('leaves a hotel row for review when Travel was deleted', async () => {
    await categoriesRepo.delete('travel');
    insertRow({ id: 'hotel', mcc: 7011, category: 'other' });
    insertRow({ id: 'grocery', mcc: 5300, category: 'other' });

    await backfill().backfillMccCategories();

    expect(categoryOf('grocery')).toBe('groceries');
    expect(categoryOf('hotel')).toBe('other');
    expect(await markOf()).toBe(true);
  });

  it('leaves a row in a user category titled Travel', async () => {
    mockDatabase.exec(`
      INSERT INTO categories (key, title, icon, color, sort_order)
        VALUES ('0b9f2f7a-user-travel', 'Travel', 'airplane', '#112233', 40);
    `);
    insertRow({ id: 'own', mcc: 7011, category: '0b9f2f7a-user-travel' });
    insertRow({ id: 'hotel', mcc: 7011, category: 'other' });

    await backfill().backfillMccCategories();

    expect(categoryOf('own')).toBe('0b9f2f7a-user-travel');
    expect(categoryOf('hotel')).toBe('travel');
  });

  it('leaves hand-set, structural, rule-won, original-map and deleted-target rows as stored', async () => {
    await categoriesRepo.delete('dining');
    mockDatabase.exec(`
      INSERT INTO category_rules (id, category, matchers, created_at, updated_at)
        VALUES ('keeps-other', 'other', '[{"type":"nameIs","text":"Pinned"}]', 1, 1),
               ('elsewhere', 'food', '[{"type":"nameIs","text":"Elsewhere"}]', 2, 2);
    `);
    insertRow({ id: 'hand', mcc: 5300, category: 'other', categorySetByHand: true });
    insertRow({ id: 'balance', mcc: 5300, category: 'other', setsBalance: true });
    insertRow({ id: 'split', mcc: 5300, category: 'other', changeGroupId: 'group-1' });
    insertRow({ id: 'rule-other', mcc: 5300, category: 'other', description: 'Pinned' });
    insertRow({ id: 'rule-elsewhere', mcc: 5300, category: 'other', description: 'Elsewhere' });
    insertRow({ id: 'original', mcc: 5411, category: 'other' });
    insertRow({ id: 'deleted-target', mcc: 5811, category: 'other' });
    insertRow({ id: 'mover', mcc: 5300, category: 'other' });
    const kept = [
      'hand',
      'balance',
      'split',
      'rule-other',
      'rule-elsewhere',
      'original',
      'deleted-target',
    ];
    const before = rowsOf(...kept);

    await backfill().backfillMccCategories();

    expect(rowsOf(...kept)).toEqual(before);
    expect(categoryOf('mover')).toBe('groceries');
  });

  it('sets no hand flag on a moved row', async () => {
    insertRow({ id: 'grocery', mcc: 5300, category: 'other' });

    await backfill().backfillMccCategories();

    expect(categoryOf('grocery')).toBe('groceries');
    expect(
      (
        mockDatabase
          .prepare("SELECT category_set_by_hand AS flag FROM transactions WHERE id = 'grocery'")
          .get() as { flag: number }
      ).flag,
    ).toBe(0);
  });

  it('rolls every row back and leaves the mark unset when the mark cannot be written', async () => {
    insertRow({ id: 'grocery', mcc: 5300, category: 'other' });
    insertRow({ id: 'hotel', mcc: 7011, category: null });
    const before = rowsOf('grocery', 'hotel');
    refuseMarkWrite();

    await backfill().backfillMccCategories();

    expect(rowsOf('grocery', 'hotel')).toEqual(before);
    expect(await markOf()).toBe(false);

    mockDatabase.exec('DROP TRIGGER refuse_mark');
    await backfill().backfillMccCategories();

    expect(categoryOf('grocery')).toBe('groceries');
    expect(categoryOf('hotel')).toBe('travel');
    expect(await markOf()).toBe(true);
  });

  it('never rejects and logs its fixed text with no name when the write fails', async () => {
    insertRow({ id: 'grocery', mcc: 5300, category: 'other', description: SECRET_NAME });
    refuseMarkWrite();

    await expect(backfill().backfillMccCategories()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(FAILURE_TAG, expect.anything());

    const rendered = JSON.stringify(warn.mock.calls);

    expect(rendered).not.toContain(SECRET_NAME);
    expect(rendered).not.toContain(SECRET_IBAN);
  });

  it('runs once: a row that became other after the first run stays other', async () => {
    insertRow({ id: 'grocery', mcc: 5300, category: 'other' });
    await backfill().backfillMccCategories();
    mockDatabase.exec("UPDATE transactions SET category = 'other' WHERE id = 'grocery'");
    insertRow({ id: 'late', mcc: 5300, category: 'other' });

    await backfill().backfillMccCategories();

    expect(categoryOf('grocery')).toBe('other');
    expect(categoryOf('late')).toBe('other');
  });

  it('reads only the mark on a later open', async () => {
    insertRow({ id: 'grocery', mcc: 5300, category: 'other' });
    await backfill().backfillMccCategories();
    const prepared: string[] = [];
    const prepare = mockDatabase.prepare.bind(mockDatabase);
    jest.spyOn(mockDatabase, 'prepare').mockImplementation((sql: string) => {
      prepared.push(sql);

      return prepare(sql);
    });

    await backfill().backfillMccCategories();

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatch(/^select .* from "settings"/);
  });

  it('re-reads the mark inside the write', async () => {
    insertRow({ id: 'grocery', mcc: 5300, category: 'other' });
    const exec = mockDatabase.exec.bind(mockDatabase);
    jest.spyOn(mockDatabase, 'exec').mockImplementation((sql: string) => {
      if (sql === 'BEGIN') {
        exec('UPDATE settings SET mcc_categories_backfilled = 1');
      }

      return exec(sql);
    });

    await backfill().backfillMccCategories();

    expect(categoryOf('grocery')).toBe('other');
  });

  it('leaves balances untouched', async () => {
    insertRow({ id: 'grocery', mcc: 5300, category: 'other' });
    insertRow({ id: 'hotel', mcc: 7011, category: 'other' });
    const balanceBefore = mockDatabase.prepare('SELECT * FROM holdings').all();

    await backfill().backfillMccCategories();

    expect(categoryOf('hotel')).toBe('travel');
    expect(mockDatabase.prepare('SELECT * FROM holdings').all()).toEqual(balanceBefore);
    expect(
      (
        mockDatabase.prepare('SELECT balance_minor_units AS balance FROM holdings').get() as {
          balance: number;
        }
      ).balance,
    ).toBe(12345);
  });
});

describe('mccBackfillRowsQuery', () => {
  beforeEach(openDatabase);

  it('binds the added codes within the variable limit', async () => {
    insertRow({ id: 'grocery', mcc: 5300, category: 'other' });

    const query = backfill().mccBackfillRowsQuery(database);
    const { params } = query.toSQL();

    expect(params.length).toBeGreaterThanOrEqual(ADDED_MCC_CODES.length);
    expect(params.length).toBeLessThanOrEqual(IN_CLAUSE_CHUNK_SIZE);
    expect((await query).map((row) => row.id)).toEqual(['grocery']);
  });

  it('keeps the no-real-category fragment inside its own parentheses beside the code filter', async () => {
    insertRow({ id: 'listed-other', mcc: 5300, category: 'other' });
    insertRow({ id: 'listed-null', mcc: 7011, category: null });
    insertRow({ id: 'listed-orphan', mcc: 4112, category: 'ghost' });
    insertRow({ id: 'listed-real', mcc: 5300, category: 'groceries' });
    insertRow({ id: 'unlisted-other', mcc: 6300, category: 'other' });
    insertRow({ id: 'original-other', mcc: 5411, category: 'other' });

    const query = backfill().mccBackfillRowsQuery(database);
    const sql = query.toSQL().sql.toLowerCase();
    const arms = sql.indexOf(' is null');
    const open = sql.lastIndexOf('(', arms);
    let depth = 0;
    let close = open;

    for (let index = open; index < sql.length; index += 1) {
      depth += sql[index] === '(' ? 1 : 0;
      depth -= sql[index] === ')' ? 1 : 0;

      if (depth === 0) {
        close = index;
        break;
      }
    }

    const group = sql.slice(open, close + 1);

    expect(group).toContain(' is null');
    expect(group).toMatch(/lower\(.*\) = /);
    expect(group).toContain('not in (select');
    expect(sql.slice(0, open).trimEnd()).toMatch(/and$/);
    expect(sql.slice(close + 1).trim()).toMatch(/^\)*$/);
    expect((await query).map((row) => row.id).sort()).toEqual([
      'listed-null',
      'listed-orphan',
      'listed-other',
    ]);
  });
});
