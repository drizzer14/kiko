// The one-time MCC back-fill runs after a restore: real SQLite through `importData` with a real
// encrypted envelope, the real back-fill, and the lot recost doubled.
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

type Seed = {
  id: string;
  mcc: number | null;
  category: string | null;
  description?: string;
  categorySetByHand?: boolean;
};

const addLedger = (target: DatabaseSync): void => {
  target.exec(`
    INSERT INTO settings (id) VALUES (1);
    INSERT INTO accounts (id, name, kind) VALUES ('bank', 'Bank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency)
      VALUES ('card', 'bank', 'Card', 'card', 'UAH');
  `);
};

const currentDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);
  addLedger(target);

  return target;
};

const insertRow = (target: DatabaseSync, seed: Seed): void => {
  target
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category,
        mcc, source, category_set_by_hand)
       VALUES (?, 'card', -100, 1000, ?, ?, ?, 'manual', ?)`,
    )
    .run(
      seed.id,
      seed.description ?? 'ATB',
      seed.category,
      seed.mcc,
      seed.categorySetByHand === true ? 1 : 0,
    );
};

const categoryOf = (id: string): string | null =>
  (
    mockDatabase.prepare('SELECT category FROM transactions WHERE id = ?').get(id) as {
      category: string | null;
    }
  ).category;

const rowsOf = (target: DatabaseSync, ...ids: string[]) =>
  target
    .prepare(`SELECT * FROM transactions WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(...ids);

const markOf = (target: DatabaseSync): number =>
  (
    target.prepare('SELECT mcc_categories_backfilled AS mark FROM settings WHERE id = 1').get() as {
      mark: number;
    }
  ).mark;

const travelRowsOf = (target: DatabaseSync): unknown[] =>
  target.prepare("SELECT key FROM categories WHERE key = 'travel'").all();

// Exports `source` the way the app does, lets `editTables` change the file's JSON, and restores it
// into a fresh current database, which `mockDatabase` then holds.
const restoreFileOf = async (
  source: DatabaseSync,
  editTables: (tables: Record<string, unknown[]>) => void = () => undefined,
): Promise<void> => {
  mockDatabase = source;

  const tables = JSON.parse(JSON.stringify(await readDataSnapshot()));

  editTables(tables);

  const key = generateExportKey();
  const envelope = encryptEnvelope(
    utf8ToBytes(JSON.stringify({ exportedAt: 1, appVersion: '1.3.0', tables })),
    key,
  );

  mockReadFile.mockResolvedValue(JSON.stringify(envelope));
  mockDatabase = currentDatabase();
  await importData({ fileUri: '/tmp/earlier.kiko', keyBase64: encodeBytesToBase64(key) });
};

const withoutMarkKey = (tables: Record<string, unknown[]>): void => {
  for (const settingsRow of tables.settings as Record<string, unknown>[]) {
    delete settingsRow.mccCategoriesBackfilled;
  }
};

const seedAddedCodeRows = (target: DatabaseSync): void => {
  insertRow(target, { id: 'grocery', mcc: 5300, category: 'other' });
  insertRow(target, { id: 'unmapped', mcc: 6300, category: 'other' });
  insertRow(target, { id: 'original', mcc: 5411, category: 'other' });
};

describe('the MCC back-fill after a restore', () => {
  it('moves an added-code row and sets the mark for a file with no key', async () => {
    const source = currentDatabase();

    seedAddedCodeRows(source);

    await restoreFileOf(source, withoutMarkKey);

    expect(categoryOf('grocery')).toBe('groceries');
    expect(categoryOf('unmapped')).toBe('other');
    expect(categoryOf('original')).toBe('other');
    expect(markOf(mockDatabase)).toBe(1);
  });

  it('leaves an added-code row in other for a file with the mark', async () => {
    const source = currentDatabase();

    seedAddedCodeRows(source);
    source.exec('UPDATE settings SET mcc_categories_backfilled = 1');

    await restoreFileOf(source);

    expect(categoryOf('grocery')).toBe('other');
    expect(markOf(mockDatabase)).toBe(1);
  });

  it('keeps the mark through a round trip', async () => {
    const source = currentDatabase();

    source.exec('UPDATE settings SET mcc_categories_backfilled = 1');

    await restoreFileOf(source);

    expect(markOf(mockDatabase)).toBe(1);
  });

  it("restores an older file's hand-set and rule-won rows as stored", async () => {
    const source = currentDatabase();

    source.exec(`
      INSERT INTO category_rules (id, category, matchers, created_at, updated_at)
        VALUES ('keeps-other', 'other', '[{"type":"nameIs","text":"Pinned"}]', 1, 1);
    `);
    insertRow(source, { id: 'hand', mcc: 5300, category: 'other', categorySetByHand: true });
    insertRow(source, { id: 'ruled', mcc: 5300, category: 'other', description: 'Pinned' });
    insertRow(source, { id: 'mover', mcc: 5300, category: 'other' });
    const kept = rowsOf(source, 'hand', 'ruled');

    await restoreFileOf(source, withoutMarkKey);

    expect(rowsOf(mockDatabase, 'hand', 'ruled')).toEqual(kept);
    expect(categoryOf('mover')).toBe('groceries');
  });
});

describe('the order of a restore: Travel first, back-fill second', () => {
  it('moves a hotel row of an older file to Travel, restored first', async () => {
    const source = new DatabaseSync(':memory:');

    applyMigrationsThrough(source, '0063_add_transaction_operation');
    addMccCategoriesBackfilledColumn(source);
    addLedger(source);
    insertRow(source, { id: 'hotel', mcc: 7011, category: 'other' });
    insertRow(source, { id: 'grocery', mcc: 5300, category: 'other' });
    expect(travelRowsOf(source)).toEqual([]);

    await restoreFileOf(source, withoutMarkKey);

    expect(travelRowsOf(mockDatabase)).toHaveLength(1);
    expect(categoryOf('hotel')).toBe('travel');
    expect(categoryOf('grocery')).toBe('groceries');
  });

  it.each([
    ['false', 0, { hotel: 'other', grocery: 'groceries' }],
    ['true', 1, { hotel: 'other', grocery: 'other' }],
  ])(
    'leaves a hotel row of a 1.4 file without Travel in other, mark %s',
    async (_label, mark, expected) => {
      const source = currentDatabase();

      mockDatabase = source;
      await categoriesRepo.delete('travel');
      insertRow(source, { id: 'hotel', mcc: 7011, category: 'other' });
      insertRow(source, { id: 'grocery', mcc: 5300, category: 'other' });
      source.prepare('UPDATE settings SET mcc_categories_backfilled = ?').run(mark);

      await restoreFileOf(source);

      expect(travelRowsOf(mockDatabase)).toEqual([]);
      expect({ hotel: categoryOf('hotel'), grocery: categoryOf('grocery') }).toEqual(expected);
    },
  );
});
