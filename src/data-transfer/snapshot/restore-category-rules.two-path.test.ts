// src/data-transfer/snapshot/restore-category-rules.two-path.test.ts
//
// A `.kiko` file written before category rules existed carries `categoryOverrides` and no
// by-hand mark on its rows. It must restore to the same rules and the same marks as a live
// device's own migration 0056 upgrade. Path 1 runs the real migration SQL on a real engine; path 2
// reads an identically seeded pre-0056 database the way that older build's export did, writes it
// as a version 2 file and imports it through `importData`.
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

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  applyAllMigrations,
  applyMigrationsThrough,
  columnsWithout,
  executingDrizzle,
} from '@kiko/test-support/real-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { asc, getTableColumns } from 'drizzle-orm';
import { utf8ToBytes } from '@noble/ciphers/utils.js';
import { parseRuleMatchers } from '@kiko/categories/category-rules';
import { type database, accounts, holdings, transactions } from '@kiko/db';

import { importData } from '../import-data';
import { encryptEnvelope } from '../crypto/envelope';
import { encodeBytesToBase64 } from '../base64/base64';
import { generateExportKey } from '../crypto/generate-key';

import { readDataSnapshot } from './read-snapshot';

const MIGRATION_0056_SQL = readFileSync(
  join(__dirname, '..', '..', '..', 'drizzle', 'migrations', '0056_add_category_rules.sql'),
  'utf8',
);

type LegacyOverride = {
  normalizedName: string;
  category: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
};

type StoredRule = {
  id: string;
  category: string;
  matchers: string;
  created_at: number;
  updated_at: number;
};

const OVERRIDES: LegacyOverride[] = [
  { normalizedName: 'silpo', category: 'food', displayName: 'Silpo', createdAt: 1, updatedAt: 2 },
  { normalizedName: 'сільпо', category: 'food', displayName: 'Сільпо', createdAt: 3, updatedAt: 4 },
  {
    normalizedName: 'atb market',
    category: 'groceries',
    displayName: 'ATB MaRKet',
    createdAt: 5,
    updatedAt: 6,
  },
  {
    normalizedName: 'atb market shop',
    category: 'groceries',
    displayName: 'ATB  Market   Shop',
    createdAt: 7,
    updatedAt: 8,
  },
  { normalizedName: '', category: 'other', displayName: '   ', createdAt: 9, updatedAt: 10 },
];

const seedPre0056Ledger = (target: DatabaseSync): void => {
  target.exec(`
    INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency)
      VALUES ('card', 'account', 'Card', 'card', 'UAH');
    INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category, source)
      VALUES ('first', 'card', -100, 1000, 'Silpo', 'food', 'manual'),
             ('second', 'card', -200, 2000, 'Atb', NULL, 'manual');
  `);

  for (const override of OVERRIDES) {
    target
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
  }
};

const preMigrationDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyMigrationsThrough(target, '0055_add_dismissed_tips');
  seedPre0056Ledger(target);

  return target;
};

const freshDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);

  return target;
};

// What a version 2 build's export held: its tables as that build read them, with the overrides
// under their own key and no rule table and no by-hand mark on a row.
const versionTwoFile = async (source: DatabaseSync): Promise<{ text: string; key: string }> => {
  const sourceDrizzle = executingDrizzle<typeof database>(source);
  const tables = {
    accounts: await sourceDrizzle.select().from(accounts).orderBy(asc(accounts.id)),
    holdings: await sourceDrizzle.select().from(holdings).orderBy(asc(holdings.id)),
    transactions: await sourceDrizzle
      .select(columnsWithout(getTableColumns(transactions), 'categorySetByHand'))
      .from(transactions)
      .orderBy(asc(transactions.id)),
    currencyRates: [],
    currencyRateHistory: [],
    settings: [],
    syncState: [],
    categories: [],
    categoryOverrides: (
      source.prepare('SELECT * FROM category_overrides').all() as {
        normalized_name: string;
        category: string;
        display_name: string;
        created_at: number;
        updated_at: number;
      }[]
    ).map((row) => ({
      normalizedName: row.normalized_name,
      category: row.category,
      displayName: row.display_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
  const key = generateExportKey();
  const envelope = encryptEnvelope(
    utf8ToBytes(JSON.stringify({ exportedAt: 1, appVersion: '1.2.0', tables })),
    key,
  );

  return {
    text: JSON.stringify({ ...envelope, version: 2 }),
    key: encodeBytesToBase64(key),
  };
};

const rulesOf = (target: DatabaseSync): StoredRule[] =>
  target.prepare('SELECT * FROM category_rules ORDER BY created_at').all() as StoredRule[];

const comparableRules = (target: DatabaseSync) =>
  rulesOf(target).map((rule) => ({
    category: rule.category,
    createdAt: rule.created_at,
    updatedAt: rule.updated_at,
    matchers: parseRuleMatchers(rule.matchers),
  }));

const flagsOf = (target: DatabaseSync): { id: string; flag: number }[] =>
  target.prepare('SELECT id, category_set_by_hand AS flag FROM transactions ORDER BY id').all() as {
    id: string;
    flag: number;
  }[];

describe('restoring a .kiko file exported before category rules existed', () => {
  it('ends with the rules and the marks the live migration 0056 upgrade makes', async () => {
    const live = preMigrationDatabase();

    live.exec(MIGRATION_0056_SQL.split('--> statement-breakpoint').join('\n'));

    const { text, key } = await versionTwoFile(preMigrationDatabase());

    mockReadFile.mockResolvedValue(text);
    mockDatabase = freshDatabase();
    await importData({ fileUri: '/tmp/earlier.kiko', keyBase64: key });

    expect(comparableRules(mockDatabase)).toEqual(comparableRules(live));
    expect(comparableRules(mockDatabase)).toHaveLength(OVERRIDES.length);
    expect(flagsOf(mockDatabase)).toEqual(flagsOf(live));
    expect(flagsOf(mockDatabase)).toEqual([
      { id: 'first', flag: 0 },
      { id: 'second', flag: 0 },
    ]);
  });

  it('stores the override with a blank display name as a rule that fails the guard, as the migration does', async () => {
    const { text, key } = await versionTwoFile(preMigrationDatabase());

    mockReadFile.mockResolvedValue(text);
    mockDatabase = freshDatabase();
    await importData({ fileUri: '/tmp/earlier.kiko', keyBase64: key });

    const unreadable = rulesOf(mockDatabase).filter(
      (rule) => parseRuleMatchers(rule.matchers) === null,
    );

    expect(unreadable.map((rule) => rule.category)).toEqual(['other']);
  });
});

describe('restoring a .kiko file this build exported', () => {
  it('keeps every rule and the by-hand mark of a row', async () => {
    const exported = freshDatabase();

    exported.exec(`
      INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank');
      INSERT INTO holdings (id, account_id, name, type, currency)
        VALUES ('card', 'account', 'Card', 'card', 'UAH');
      INSERT INTO transactions (id, holding_id, amount_minor_units, time, category, source,
        category_set_by_hand)
        VALUES ('picked', 'card', -100, 1000, 'food', 'manual', 1),
               ('plain', 'card', -200, 2000, 'food', 'manual', 0);
      INSERT INTO category_rules (id, category, matchers, created_at, updated_at)
        VALUES ('rule-1', 'food', '[{"type":"nameIs","text":"Silpo"},{"type":"direction","direction":"expense"}]', 11, 12);
    `);
    mockDatabase = exported;

    const tables = JSON.parse(JSON.stringify(await readDataSnapshot()));
    const key = generateExportKey();
    const envelope = encryptEnvelope(
      utf8ToBytes(JSON.stringify({ exportedAt: 1, appVersion: '1.2.0', tables })),
      key,
    );

    mockReadFile.mockResolvedValue(JSON.stringify(envelope));
    mockDatabase = freshDatabase();
    await importData({ fileUri: '/tmp/current.kiko', keyBase64: encodeBytesToBase64(key) });

    expect(rulesOf(mockDatabase)).toEqual(rulesOf(exported));
    expect(flagsOf(mockDatabase)).toEqual([
      { id: 'picked', flag: 1 },
      { id: 'plain', flag: 0 },
    ]);
  });
});
