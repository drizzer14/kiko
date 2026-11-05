// src/data-transfer/snapshot/restore-travel-category.two-path.test.ts
//
// Travel is the one seeded row release 1.3 does not know. Path 1 carries a file this build wrote
// into release 1.3's schema (the journal tail before the seed): its tables take the row and its
// transactions. Path 2 carries a release 1.3 export (no mark key) into this build through
// `importData` with the real back-fill: the hotel rows move, a hand-set row stays, and a file
// with no Travel row gains it.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

const mockReadFile = jest.fn();
jest.mock('react-native-fs', () => ({ readFile: (...args: unknown[]) => mockReadFile(...args) }));

jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/holdings/lot-recost/lot-recost', () => ({
  recostStoredLots: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/reminders/use-reminder-scheduler', () => ({
  replanRestoredReminders: jest.fn().mockResolvedValue(undefined),
}));

import { i18n } from '@kiko/i18n/init';
import {
  addFundingMatchRowsTable,
  addMccCategoriesBackfilledColumn,
  addRecurringMerchantChoicesColumn,
  applyAllMigrations,
  applyMigrationsThrough,
} from '@kiko/test-support/real-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { getTableColumns } from 'drizzle-orm';
import { act } from '@testing-library/react-native';
import { utf8ToBytes } from '@noble/ciphers/utils.js';
import { resolveDefaultCategoryTitle } from '@kiko/i18n/default-category-title';
import { accounts, categories, holdings, settings, transactions } from '@kiko/db';

import { importData } from '../import-data';
import { encryptEnvelope } from '../crypto/envelope';
import { encodeBytesToBase64 } from '../base64/base64';
import { generateExportKey } from '../crypto/generate-key';

import { readDataSnapshot } from './read-snapshot';

const RELEASE_1_3_TAIL = '0063_add_transaction_operation';
const MARK_COLUMN = 'mcc_categories_backfilled';

type CategoryRow = {
  key: string;
  title: string;
  icon: string;
  color: string | null;
  sort_order: number;
};

type FileRow = Record<string, unknown>;

type SQLiteTable = Parameters<typeof getTableColumns>[0];

const TRAVEL_SEED: CategoryRow = {
  key: 'travel',
  title: 'Travel',
  icon: 'airplane',
  color: '#40C8E0',
  sort_order: 11,
};

const addLedger = (target: DatabaseSync): void => {
  target.exec(`
    INSERT INTO settings (id) VALUES (1);
    INSERT INTO accounts (id, name, kind) VALUES ('bank', 'Bank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency)
      VALUES ('card', 'bank', 'Card', 'card', 'UAH');
  `);
};

const insertTransaction = (
  target: DatabaseSync,
  id: string,
  mcc: number,
  category: string,
  hand: boolean,
): void => {
  target
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category,
        mcc, source, category_set_by_hand)
       VALUES (?, 'card', -100, 1000, 'Hotel', ?, ?, 'manual', ?)`,
    )
    .run(id, category, mcc, hand ? 1 : 0);
};

const columnNamesOf = (target: DatabaseSync, table: string): string[] =>
  (
    target.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]
  ).map(({ name }) => name);

const columnNameOf = (table: SQLiteTable, key: string): string => {
  const column = Object.entries(getTableColumns(table)).find(([property]) => property === key);

  if (column === undefined) {
    throw new Error(`no column for the file key ${key}`);
  }

  return column[1].name;
};

const asSqlValue = (value: unknown): string | number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  return typeof value === 'object' ? JSON.stringify(value) : (value as string | number);
};

// What release 1.3's restore did: each file row goes in under the columns its own table has, and a
// key the table lacks is dropped.
const insertRaw = (target: DatabaseSync, table: SQLiteTable, name: string, rows: FileRow[]) => {
  const present = new Set(columnNamesOf(target, name));

  for (const row of rows) {
    const entries = Object.entries(row)
      .map(([key, value]) => [columnNameOf(table, key), asSqlValue(value)] as const)
      .filter(([column]) => present.has(column));

    target
      .prepare(
        `INSERT INTO ${name} (${entries.map(([column]) => column).join(', ')}) VALUES (${entries
          .map(() => '?')
          .join(', ')})`,
      )
      .run(...entries.map(([, value]) => value));
  }
};

const fileOf = async (source: DatabaseSync): Promise<Record<string, FileRow[]>> => {
  mockDatabase = source;

  return JSON.parse(JSON.stringify(await readDataSnapshot()));
};

const importFile = async (tables: Record<string, FileRow[]>): Promise<void> => {
  const key = generateExportKey();
  const envelope = encryptEnvelope(
    utf8ToBytes(JSON.stringify({ exportedAt: 1, appVersion: '1.3.0', tables })),
    key,
  );

  mockReadFile.mockResolvedValue(JSON.stringify(envelope));
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  await importData({ fileUri: '/tmp/release-1-3.kiko', keyBase64: encodeBytesToBase64(key) });
};

const withoutMarkKey = (tables: Record<string, FileRow[]>): Record<string, FileRow[]> => {
  for (const row of tables.settings ?? []) {
    delete row.mccCategoriesBackfilled;
  }

  return tables;
};

const categoryOf = (id: string): string | null =>
  (
    mockDatabase.prepare('SELECT category FROM transactions WHERE id = ?').get(id) as {
      category: string | null;
    }
  ).category;

const travelRowsOf = (target: DatabaseSync): CategoryRow[] =>
  target.prepare("SELECT * FROM categories WHERE key = 'travel'").all() as CategoryRow[];

const releaseThirteenWorld = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyMigrationsThrough(target, RELEASE_1_3_TAIL);
  addMccCategoriesBackfilledColumn(target);
  addFundingMatchRowsTable(target);
  addRecurringMerchantChoicesColumn(target);
  addLedger(target);

  return target;
};

describe('a file this build wrote, into release 1.3', () => {
  const thisBuildFile = async (): Promise<Record<string, FileRow[]>> => {
    const source = new DatabaseSync(':memory:');

    applyAllMigrations(source);
    addLedger(source);
    insertTransaction(source, 'hotel', 7011, 'travel', false);

    return fileOf(source);
  };

  const releaseThirteenTarget = (): DatabaseSync => {
    const target = new DatabaseSync(':memory:');

    applyMigrationsThrough(target, RELEASE_1_3_TAIL);

    return target;
  };

  it("release 1.3's tables take the Travel row and its transactions with no refusal", async () => {
    const tables = await thisBuildFile();
    const target = releaseThirteenTarget();

    expect(tables.categories.some((row) => row.key === 'travel')).toBe(true);

    target.exec('DELETE FROM categories');
    insertRaw(target, accounts, 'accounts', tables.accounts);
    insertRaw(target, holdings, 'holdings', tables.holdings);
    insertRaw(target, categories, 'categories', tables.categories);
    insertRaw(target, transactions, 'transactions', tables.transactions);
    insertRaw(target, settings, 'settings', tables.settings);

    expect(travelRowsOf(target)).toEqual([TRAVEL_SEED]);
    expect(target.prepare("SELECT category FROM transactions WHERE id = 'hotel'").get()).toEqual({
      category: 'travel',
    });
  });

  it('the Travel row holds only columns release 1.3 has', async () => {
    const tables = await thisBuildFile();
    const travel = tables.categories.find((row) => row.key === 'travel');
    const rowColumns = Object.keys(travel ?? {}).map((key) => columnNameOf(categories, key));

    expect(rowColumns.length).toBeGreaterThan(0);
    expect(columnNamesOf(releaseThirteenTarget(), 'categories').sort()).toEqual(
      [...rowColumns].sort(),
    );
  });

  it('the only settings key release 1.3 drops is the mark', async () => {
    const tables = await thisBuildFile();
    const fileColumns = Object.keys(tables.settings[0] ?? {}).map((key) =>
      columnNameOf(settings, key),
    );
    const kept = new Set(columnNamesOf(releaseThirteenTarget(), 'settings'));

    expect(fileColumns.filter((column) => !kept.has(column))).toEqual([MARK_COLUMN]);
    expect([...kept].filter((column) => !fileColumns.includes(column))).toEqual([]);
  });
});

describe('a release 1.3 export, into this build', () => {
  const hotelWorld = (withTravel: boolean): DatabaseSync => {
    const source = releaseThirteenWorld();

    if (withTravel) {
      source.exec(`
        INSERT INTO categories (key, title, icon, color, sort_order)
          VALUES ('travel', 'Travel', 'airplane', '#40C8E0', 11);
      `);
    }

    insertTransaction(source, 'hotel', 7011, 'other', false);
    insertTransaction(source, 'picked', 7011, 'other', true);

    return source;
  };

  describe('shown in uk', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it("keeps the file's Travel row and shows it translated in uk", async () => {
      await importFile(withoutMarkKey(await fileOf(hotelWorld(true))));

      const [travel] = travelRowsOf(mockDatabase);

      expect(travelRowsOf(mockDatabase)).toEqual([TRAVEL_SEED]);
      expect(resolveDefaultCategoryTitle('travel', travel?.title ?? '')).toBe('Подорожі');
    });
  });

  it('moves the hotel row to Travel and sets the mark', async () => {
    await importFile(withoutMarkKey(await fileOf(hotelWorld(true))));

    expect(categoryOf('hotel')).toBe('travel');
    expect(
      mockDatabase.prepare('SELECT mcc_categories_backfilled AS mark FROM settings').get(),
    ).toEqual({ mark: 1 });
  });

  it('a row hand-set in release 1.3 stays', async () => {
    await importFile(withoutMarkKey(await fileOf(hotelWorld(true))));

    expect(categoryOf('hotel')).toBe('travel');
    expect(categoryOf('picked')).toBe('other');
  });

  it('a file with no Travel row gains it', async () => {
    const tables = withoutMarkKey(await fileOf(hotelWorld(false)));

    expect(tables.categories.some((row) => row.key === 'travel')).toBe(false);

    await importFile(tables);

    expect(travelRowsOf(mockDatabase)).toEqual([TRAVEL_SEED]);
    expect(categoryOf('hotel')).toBe('travel');
  });
});
