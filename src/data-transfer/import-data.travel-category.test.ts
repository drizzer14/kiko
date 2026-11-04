// Travel is a seeded category a user can delete. A file this build wrote after that delete must
// restore without it; a file from before the seed existed must gain it. Real SQLite through
// `importData` with a real encrypted envelope.
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

import {
  addMccCategoriesBackfilledColumn,
  applyAllMigrations,
  applyMigrationsThrough,
} from '@kiko/test-support/real-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { utf8ToBytes } from '@noble/ciphers/utils.js';
import { categoriesRepo } from '@kiko/categories/repo';

import { importData } from './import-data';
import { encryptEnvelope } from './crypto/envelope';
import { encodeBytesToBase64 } from './base64/base64';
import { generateExportKey } from './crypto/generate-key';
import { readDataSnapshot } from './snapshot/read-snapshot';

type CategoryRow = {
  key: string;
  title: string;
  icon: string;
  color: string | null;
  sort_order: number;
};

const TRAVEL_SEED: CategoryRow = {
  key: 'travel',
  title: 'Travel',
  icon: 'airplane',
  color: '#40C8E0',
  sort_order: 11,
};

const currentDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);
  target.exec('INSERT INTO settings (id) VALUES (1)');

  return target;
};

const travelRowsOf = (target: DatabaseSync): CategoryRow[] =>
  target.prepare("SELECT * FROM categories WHERE key = 'travel'").all() as CategoryRow[];

const categoryCountOf = (target: DatabaseSync): number =>
  (target.prepare('SELECT count(*) AS total FROM categories').get() as { total: number }).total;

// Exports `source` the way the app does, lets `editTables` change the file's JSON, and restores it
// into a fresh current database, which `mockDatabase` then holds. Returns the file's tables.
const restoreFileOf = async (
  source: DatabaseSync,
  editTables: (tables: Record<string, unknown[]>) => void = () => undefined,
): Promise<Record<string, unknown[]>> => {
  mockDatabase = source;

  const tables = JSON.parse(JSON.stringify(await readDataSnapshot()));

  editTables(tables);

  const key = generateExportKey();
  const envelope = encryptEnvelope(
    utf8ToBytes(JSON.stringify({ exportedAt: 1, appVersion: '1.4.0', tables })),
    key,
  );

  mockReadFile.mockResolvedValue(JSON.stringify(envelope));
  mockDatabase = currentDatabase();
  await importData({ fileUri: '/tmp/current.kiko', keyBase64: encodeBytesToBase64(key) });

  return tables;
};

describe('restoring Travel', () => {
  it('a file this build wrote after Travel was deleted restores without it', async () => {
    const source = currentDatabase();

    mockDatabase = source;
    await categoriesRepo.delete('travel');

    const tables = await restoreFileOf(source);

    expect(Object.hasOwn(tables.settings.at(0) as object, 'mccCategoriesBackfilled')).toBe(true);
    expect(travelRowsOf(source)).toEqual([]);
    expect(travelRowsOf(mockDatabase)).toEqual([]);
    expect(categoryCountOf(mockDatabase)).toBe(categoryCountOf(source));
  });

  it('a file this build wrote with Travel restores the same row', async () => {
    const source = currentDatabase();

    source.exec(
      "UPDATE categories SET title = 'Trips', icon = 'suitcase', color = '#123456', sort_order = 3 WHERE key = 'travel'",
    );

    await restoreFileOf(source);

    expect(travelRowsOf(mockDatabase)).toEqual([
      { key: 'travel', title: 'Trips', icon: 'suitcase', color: '#123456', sort_order: 3 },
    ]);
  });

  it('a file from before 1.4 gains Travel', async () => {
    const source = new DatabaseSync(':memory:');

    applyMigrationsThrough(source, '0063_add_transaction_operation');
    addMccCategoriesBackfilledColumn(source);
    source.exec('INSERT INTO settings (id) VALUES (1)');
    expect(travelRowsOf(source)).toEqual([]);

    await restoreFileOf(source, (tables) => {
      const [settingsRow] = tables.settings as Record<string, unknown>[];

      delete settingsRow?.mccCategoriesBackfilled;
    });

    expect(travelRowsOf(mockDatabase)).toEqual([TRAVEL_SEED]);
  });
});
