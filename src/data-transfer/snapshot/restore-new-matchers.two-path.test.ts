// src/data-transfer/snapshot/restore-new-matchers.two-path.test.ts
//
// A rule's `matchers` column is a JSON string the restore never reads, only checks for shape. The
// literals below are what a stored rule of each new kind looks like, with spacing and key order a
// rewrite would lose. Path 1 sends them through this build's export and restore (export version 5)
// and expects every byte back. Path 2 puts the same literals into a file as release 1.3 wrote it
// (no mark key) and restores that into this build, where each reads again and works on new rows.
// Release 1.3's parser reads a type it does not know as unreadable and the whole rule with it, so
// the bytes are the only thing that has to survive.
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

import { DatabaseSync } from 'node:sqlite';
import { utf8ToBytes } from '@noble/ciphers/utils.js';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';
import { type CategoryRuleMatcher, parseRuleMatchers } from '@kiko/categories/category-rules';

import { importData } from '../import-data';
import { encodeBytesToBase64 } from '../base64/base64';
import { generateExportKey } from '../crypto/generate-key';
import { EXPORT_VERSION, encryptEnvelope } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';

const NAME_CONTAINS_JSON = '[ {"text":"Market", "type":"nameContains"} ]';
const MCC_JSON = '[ {"code":5411,  "type":"mcc"} ]';
const ACCOUNT_JSON = '[ {"accountId":"second-account", "type":"account"} ]';
const COUNTER_IBAN_JSON = '[ {"iban":"UA213223130000026007233566001", "type":"counterIban"} ]';
const MIX_JSON = '[ {"text":"ATB", "type":"nameIs"},  {"code":5411, "type":"mcc"} ]';

type KindCase = {
  kind: string;
  id: string;
  json: string;
  category: string;
  matchers: CategoryRuleMatcher[];
  row: Record<string, unknown>;
};

// Each row is won by its own rule alone: the mix needs both of its conditions, so a row with only
// the name or only the code belongs to the code rule or to none.
const KINDS: KindCase[] = [
  {
    kind: 'nameContains',
    id: 'rule-name-contains',
    json: NAME_CONTAINS_JSON,
    category: 'gifts',
    matchers: [{ type: 'nameContains', text: 'Market' }],
    row: { description: 'Silpo Market 12' },
  },
  {
    kind: 'mcc',
    id: 'rule-mcc',
    json: MCC_JSON,
    category: 'travel',
    matchers: [{ type: 'mcc', code: 5411 }],
    row: { description: 'Anything', mcc: 5411 },
  },
  {
    kind: 'account',
    id: 'rule-account',
    json: ACCOUNT_JSON,
    category: 'groceries',
    matchers: [{ type: 'account', accountId: 'second-account' }],
    row: { description: 'Anything', holdingId: 'second-card' },
  },
  {
    kind: 'counterIban',
    id: 'rule-counter-iban',
    json: COUNTER_IBAN_JSON,
    category: 'food',
    matchers: [{ type: 'counterIban', iban: 'UA213223130000026007233566001' }],
    row: { description: 'Anything', counterIban: 'ua21 3223 1300 0002 6007 2335 6600 1' },
  },
  {
    kind: 'mix',
    id: 'rule-mix',
    json: MIX_JSON,
    category: 'shopping',
    matchers: [
      { type: 'nameIs', text: 'ATB' },
      { type: 'mcc', code: 5411 },
    ],
    row: { description: 'ATB', mcc: 5411 },
  },
];

type FileRow = Record<string, unknown>;

const ledgerDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);
  target.exec('PRAGMA foreign_keys = ON;');
  target.exec(`
    INSERT INTO accounts (id, name, kind)
      VALUES ('first-account', 'First', 'bank'), ('second-account', 'Second', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency)
      VALUES ('first-card', 'first-account', 'Card', 'card', 'UAH'),
             ('second-card', 'second-account', 'Card', 'card', 'UAH');
  `);

  return target;
};

const seedRules = (target: DatabaseSync): void => {
  for (const [index, { id, json, category }] of KINDS.entries()) {
    target
      .prepare(
        `INSERT INTO category_rules (id, category, matchers, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, category, json, index + 1, index + 10);
  }
};

// Rows no rule has touched: a row a rule would win and has no category, and rows that hold a
// category of their own beside each condition.
const seedLedgerRows = (target: DatabaseSync): void => {
  target.exec(`
    INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category,
      mcc, counter_iban, source, category_set_by_hand)
    VALUES ('pending', 'first-card', -100, 1000, 'Silpo Market', NULL, NULL, NULL, 'manual', 0),
           ('coded', 'first-card', -200, 2000, 'Anything', 'groceries', 5411, NULL, 'manual', 0),
           ('picked', 'second-card', -300, 3000, 'ATB', 'shopping', 5411, NULL, 'manual', 1),
           ('transfer', 'first-card', -400, 4000, 'Anything', 'food', NULL,
             'UA213223130000026007233566001', 'manual', 0);
  `);
};

const exportedTables = async (source: DatabaseSync): Promise<Record<string, FileRow[]>> => {
  mockDatabase = source;

  return JSON.parse(JSON.stringify(await readDataSnapshot()));
};

const importFile = async (
  tables: Record<string, FileRow[]>,
  appVersion: string,
): Promise<number> => {
  const key = generateExportKey();
  const envelope = encryptEnvelope(
    utf8ToBytes(JSON.stringify({ exportedAt: 1, appVersion, tables })),
    key,
  );

  mockReadFile.mockResolvedValue(JSON.stringify(envelope));
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  await importData({ fileUri: '/tmp/new-matchers.kiko', keyBase64: encodeBytesToBase64(key) });

  return envelope.version;
};

const storedMatchersOf = (id: string): string | undefined =>
  (
    mockDatabase.prepare('SELECT matchers FROM category_rules WHERE id = ?').get(id) as
      | { matchers: string }
      | undefined
  )?.matchers;

const allRows = (table: string, order: string): unknown[] =>
  mockDatabase.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();

const categoryOf = (id: string): string | null =>
  (
    mockDatabase.prepare('SELECT category FROM transactions WHERE id = ?').get(id) as {
      category: string | null;
    }
  ).category;

const transactionRow = (id: string): unknown =>
  mockDatabase.prepare('SELECT * FROM transactions WHERE id = ?').get(id);

const importedCategory = async (row: Record<string, unknown>, externalId: string) => {
  const holdingId = (row.holdingId as string | undefined) ?? 'first-card';

  await transactionsRepo.importRows({
    holdingId,
    rows: [
      {
        holdingId,
        amountMinorUnits: -100,
        time: 9000,
        source: 'import',
        externalId,
        category: 'other',
        ...row,
      },
    ],
  });

  return (
    mockDatabase
      .prepare('SELECT category FROM transactions WHERE external_id = ?')
      .get(externalId) as { category: string | null }
  ).category;
};

describe('a file this build wrote, restored into this build', () => {
  let source: DatabaseSync;
  let version: number;

  beforeEach(async () => {
    source = ledgerDatabase();
    seedRules(source);
    seedLedgerRows(source);
    source.exec('INSERT INTO settings (id, mcc_categories_backfilled) VALUES (1, 1)');
    version = await importFile(await exportedTables(source), '1.4.0');
  });

  it.each(KINDS.map(({ kind, id, json }) => [kind, id, json]))(
    "restores a %s rule's JSON byte for byte",
    (_kind, id, json) => {
      expect(storedMatchersOf(id as string)).toBe(json);
    },
  );

  it('restores every row with its category and rewrites none', () => {
    expect(version).toBe(5);
    expect(version).toBe(EXPORT_VERSION);
    expect(allRows('transactions', 'id')).toEqual(
      source.prepare('SELECT * FROM transactions ORDER BY id').all(),
    );
    expect(allRows('category_rules', 'id')).toEqual(
      source.prepare('SELECT * FROM category_rules ORDER BY id').all(),
    );
    expect(categoryOf('pending')).toBeNull();
  });
});

describe('a release 1.3 file, restored into this build', () => {
  const releaseThirteenTables = async (): Promise<Record<string, FileRow[]>> => {
    const source = ledgerDatabase();

    seedLedgerRows(source);
    source.exec('INSERT INTO settings (id) VALUES (1)');

    const tables = await exportedTables(source);

    for (const row of tables.settings) {
      delete row.mccCategoriesBackfilled;
    }

    tables.categoryRules = KINDS.map(({ id, json, category }, index) => ({
      id,
      category,
      matchers: json,
      createdAt: index + 1,
      updatedAt: index + 10,
    }));

    return tables;
  };

  beforeEach(async () => {
    await importFile(await releaseThirteenTables(), '1.3.0');
  });

  it.each(KINDS.map(({ kind, id, json, matchers }) => [kind, id, json, matchers]))(
    'the same bytes read again in this build, %s',
    (_kind, id, json, matchers) => {
      expect(storedMatchersOf(id as string)).toBe(json);
      expect(parseRuleMatchers(json as string)).toEqual(matchers);
    },
  );

  it.each(KINDS.map(({ kind, category, row }) => [kind, category, row]))(
    'the rule wins a new row after the restore, %s',
    async (kind, category, row) => {
      expect(await importedCategory(row as Record<string, unknown>, `new-${kind}`)).toBe(category);
    },
  );

  it('a mix reads again whole', async () => {
    expect(await importedCategory({ description: 'ATB' }, 'name-only')).toBe('other');
    expect(await importedCategory({ description: 'Anything', mcc: 5411 }, 'code-only')).toBe(
      'travel',
    );
    expect(await importedCategory({ description: 'ATB', mcc: 5411 }, 'both')).toBe('shopping');
  });

  it('a row that holds a category of its own comes back whole, as the file had it', () => {
    const seeded = ledgerDatabase();

    seedLedgerRows(seeded);

    expect(transactionRow('coded')).toEqual(
      seeded.prepare('SELECT * FROM transactions WHERE id = ?').get('coded'),
    );
    expect(categoryOf('coded')).toBe('groceries');
  });

  it('a row the rule would win keeps its category until the user applies', async () => {
    const rule = KINDS[0];

    expect(categoryOf('pending')).toBeNull();

    const { changed } = await categoryRulesRepo.saveRule({
      id: rule.id,
      category: 'travel',
      matchers: rule.matchers,
      applyToExisting: true,
    });

    expect(changed).toBe(1);
    expect(categoryOf('pending')).toBe('travel');
  });
});
