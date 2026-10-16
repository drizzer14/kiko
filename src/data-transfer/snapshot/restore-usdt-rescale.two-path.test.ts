// src/data-transfer/snapshot/restore-usdt-rescale.two-path.test.ts
//
// A `.kiko` file written while USDT was stored at two decimals must restore to the same
// database as a live device holding the same data after its own upgrade. Path 1 applies the
// shipped migration SQL and then the launch steps the migrations gate runs; path 2 exports the
// same seed as a version 3 snapshot, restores it on a fresh database and runs the same launch
// steps. A version 4 file restores as it is, and a version 3 file with a USDT amount that cannot
// be rescaled exactly is refused whole.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { computeDedupKeyBase } from '@kiko/statement-import/mapping';
import { rezoneImportTimes } from '@kiko/statement-import/rezone-import-times';
import { upgradeStoredDedupKeys } from '@kiko/statement-import/upgrade-stored-dedup-keys';
import { applyAllMigrations, applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

import { EXPORT_VERSION } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const USDT_RESCALE_SQL = readFileSync(
  join(__dirname, '..', '..', '..', 'drizzle', 'migrations', '0059_usdt_scale_8.sql'),
  'utf8',
);

// The snapshot reader selects the cursor column the later migration adds, so the scale 2 database
// carries it too (null on the settings row).
const HISTORY_BACKFILL_CURSOR_SQL = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'drizzle',
    'migrations',
    '0060_add_history_backfill_cursor.sql',
  ),
  'utf8',
);

const SCALE_TWO_VERSION = 3;
const IMPORTED_AT = Date.UTC(2026, 2, 3, 9, 45, 0);
const JSON_COLUMNS = ['metadata', 'matchers', 'draft'];

type Parameter = string | number | null;

const run = (target: DatabaseSync, statement: string, ...parameters: Parameter[]): void => {
  target.prepare(statement).run(...parameters);
};

const insertHolding = (
  target: DatabaseSync,
  id: string,
  currency: string,
  balance: number,
  metadata: string | null = null,
  syncedBalance: number | null = null,
): void => {
  run(
    target,
    `INSERT INTO holdings
       (id, account_id, name, type, currency, balance_minor_units, synced_balance_minor_units,
        metadata)
     VALUES (?, 'account', ?, 'crypto_asset', ?, ?, ?, ?)`,
    id,
    id,
    currency,
    balance,
    syncedBalance,
    metadata,
  );
};

const insertRow = (
  target: DatabaseSync,
  id: string,
  holdingId: string,
  amount: number,
  externalId: string | null = null,
): void => {
  run(
    target,
    `INSERT INTO transactions
       (id, holding_id, amount_minor_units, time, source, external_id, description)
     VALUES (?, ?, ?, ?, ?, ?, 'coffee')`,
    id,
    holdingId,
    amount,
    IMPORTED_AT,
    externalId === null ? 'manual' : 'import',
    externalId,
  );
};

const insertRule = (target: DatabaseSync, id: string, matchers: string): void => {
  run(
    target,
    "INSERT INTO category_rules (id, category, matchers) VALUES (?, 'food', ?)",
    id,
    matchers,
  );
};

const insertTemplate = (target: DatabaseSync, id: string, draft: unknown): void => {
  run(
    target,
    "INSERT INTO transaction_templates (id, name, draft) VALUES (?, 'Template', ?)",
    id,
    JSON.stringify(draft),
  );
};

const keyOf = (holdingId: string, amount: number): string =>
  computeDedupKeyBase(holdingId, IMPORTED_AT / 1000, amount, 'coffee');

// Every field class: balances, rows, every metadata field, array elements that are not
// objects, bare numbers, a string and a real field, matchers, templates of both exchange
// sides, keys (plain, suffixed with the legacy occurrence number, bank-issued, under a UAH
// holding) and the rows that must stay as stored.
const seedScaleTwoDatabase = (target: DatabaseSync): void => {
  run(target, "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Crypto', 'crypto')");
  run(target, 'INSERT INTO settings (id) VALUES (1)');
  insertHolding(
    target,
    'usdt-1',
    'USDT',
    12345,
    JSON.stringify({
      principalMinorUnits: 100,
      faceValueMinorUnits: 200,
      purchasePriceMinorUnits: 300,
      contributions: [{ amountMinorUnits: 400, at: 1 }, 'text', null, true],
      lots: [{ costMinorUnits: 500, quantity: 2 }, { quantity: 1 }, 7, false],
    }),
    12345,
  );
  insertHolding(
    target,
    'usdt-2',
    'USDT',
    -7,
    '{"lots":[{"costMinorUnits":600},1.50,1e5,0.30000000000000004],"contributions":[false,12]}',
  );
  insertHolding(
    target,
    'usdt-3',
    'USDT',
    0,
    '{"principalMinorUnits":"5000","faceValueMinorUnits":12.5,"purchasePriceMinorUnits":700}',
  );
  insertHolding(target, 'hryvnia', 'UAH', 9000, JSON.stringify({ principalMinorUnits: 100 }));
  insertHolding(target, 'bitcoin', 'BTC', 12345, JSON.stringify({ lots: [{ costMinorUnits: 9 }] }));
  insertRow(target, 'manual', 'usdt-1', -250);
  insertRow(target, 'plain-key', 'usdt-1', -1250, keyOf('usdt-1', -1250));
  insertRow(target, 'legacy-twin', 'usdt-1', -1250, `${keyOf('usdt-1', -1250)} 1`);
  insertRow(target, 'second-holding', 'usdt-2', 500, keyOf('usdt-2', 500));
  insertRow(target, 'hryvnia-key', 'hryvnia', -300, keyOf('hryvnia', -300));
  insertRow(target, 'moved', 'hryvnia', -450, keyOf('usdt-1', -450));
  insertRow(target, 'bank-issued', 'usdt-1', -5, 'bank-issued-id');
  run(
    target,
    'INSERT INTO deleted_import_keys (holding_id, external_id) VALUES (?, ?), (?, ?), (?, ?)',
    'usdt-1',
    keyOf('usdt-1', -999),
    'usdt-1',
    `${keyOf('usdt-1', -999)}␟1`,
    'hryvnia',
    keyOf('hryvnia', -999),
  );
  insertRule(
    target,
    'amount-rule',
    JSON.stringify([
      { type: 'amount', currency: 'USDT', minorUnits: 100000, comparison: 'atLeast' },
      { type: 'amount', currency: 'UAH', minorUnits: 100000, comparison: 'atLeast' },
      { type: 'nameIs', text: 'Silpo' },
    ]),
  );
  insertRule(
    target,
    'bare-rule',
    '[{"type":"amount","currency":"USDT","minorUnits":100},true,1.50,"text"]',
  );
  insertRule(target, 'broken-rule', 'not json');
  insertRule(target, 'name-rule', JSON.stringify([{ type: 'nameIs', text: 'Silpo' }]));
  insertTemplate(target, 'amount-template', {
    currency: 'USDT',
    amountMinorUnits: 5000,
    returns: [{ amountMinorUnits: 700 }, 'text'],
  });
  insertTemplate(target, 'sell-template', {
    currency: 'USDT',
    amountMinorUnits: 5000,
    exchange: { destinationCurrency: 'UAH', valueInMinorUnits: 20500 },
  });
  insertTemplate(target, 'buy-template', {
    currency: 'UAH',
    amountMinorUnits: 20500,
    exchange: { destinationCurrency: 'USDT', valueInMinorUnits: 5000 },
  });
  insertTemplate(target, 'hryvnia-template', {
    currency: 'UAH',
    holdingId: 'usdt-1',
    amountMinorUnits: 5000,
  });
  run(
    target,
    `INSERT INTO price_points (instrument, day, price, currency, source)
     VALUES ('holding:usdt-1', 1, '41.25', 'USDT', 'manual')`,
  );
  run(
    target,
    `INSERT INTO currency_rates (base, quote, rate, source, fetched_at)
     VALUES ('USDT', 'UAH', '41.25', 'coingecko', 1)`,
  );
};

const scaleTwoDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyMigrationsThrough(target, '0058_add_untracked_counterpart');
  target.exec(HISTORY_BACKFILL_CURSOR_SQL);
  seedScaleTwoDatabase(target);

  return target;
};

const freshDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);

  return target;
};

const parsedOrText = (value: unknown): unknown => {
  try {
    return JSON.parse(value as string);
  } catch {
    return value;
  }
};

// JSON columns are compared parsed: a rewritten column keeps each element's value, not its text.
const tablesOf = (target: DatabaseSync): Record<string, unknown[]> => {
  const names = (
    target
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%drizzle%'`,
      )
      .all() as { name: string }[]
  ).map((table) => table.name);

  return Object.fromEntries(
    names.map((name) => [
      name,
      (target.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[])
        .map((tableRow) =>
          Object.fromEntries(
            Object.entries(tableRow).map(([column, value]) => [
              column,
              JSON_COLUMNS.includes(column) ? parsedOrText(value) : value,
            ]),
          ),
        )
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    ]),
  );
};

const textOf = (target: DatabaseSync, statement: string): unknown =>
  (target.prepare(statement).get() as { value: unknown }).value;

const usdtBalanceOf = (target: DatabaseSync): unknown =>
  textOf(target, "SELECT balance_minor_units AS value FROM holdings WHERE id = 'usdt-1'");

// Rows with no USDT field in them: their JSON text stays as it was, byte for byte.
const UNTOUCHED = [
  ['metadata', 'holdings', 'hryvnia'],
  ['matchers', 'category_rules', 'name-rule'],
  ['draft', 'transaction_templates', 'hryvnia-template'],
] as const;

const storedTextOf = (target: DatabaseSync, [column, table, id]: (typeof UNTOUCHED)[number]) =>
  textOf(target, `SELECT ${column} AS value FROM ${table} WHERE id = '${id}'`);

const launchSteps = async (target: DatabaseSync): Promise<void> => {
  mockDatabase = target;
  await upgradeStoredDedupKeys();
  await rezoneImportTimes();
};

const migrated = async (source: DatabaseSync): Promise<DatabaseSync> => {
  for (const statement of USDT_RESCALE_SQL.split('--> statement-breakpoint')) {
    source.exec(statement);
  }

  await launchSteps(source);

  return source;
};

const exported = async (source: DatabaseSync): Promise<DataSnapshot> => {
  mockDatabase = source;

  return JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;
};

const restored = async (snapshot: DataSnapshot, version: number): Promise<DatabaseSync> => {
  const target = freshDatabase();

  mockDatabase = target;
  await restoreDataSnapshot(snapshot, version);
  await launchSteps(target);

  return target;
};

describe('restoring a .kiko file written with USDT at two decimals', () => {
  it('restores a version 3 backup equal to the migrated database', async () => {
    const source = scaleTwoDatabase();
    const snapshot = await exported(source);
    const live = await migrated(source);
    const result = await restored(snapshot, SCALE_TWO_VERSION);

    expect(tablesOf(result)).toEqual(tablesOf(live));
    expect(usdtBalanceOf(result)).toBe(12_345_000_000);
    expect(UNTOUCHED.map((field) => storedTextOf(result, field))).toEqual(
      UNTOUCHED.map((field) => storedTextOf(live, field)),
    );
  });

  it('restores a version 4 backup byte-unchanged', async () => {
    const live = await migrated(scaleTwoDatabase());
    const result = await restored(await exported(live), EXPORT_VERSION);

    expect(tablesOf(result)).toEqual(tablesOf(live));
    expect(usdtBalanceOf(result)).toBe(12_345_000_000);
  });

  it('refuses a version 3 backup over the bound and keeps the live data', async () => {
    const overBound = scaleTwoDatabase();

    run(overBound, "UPDATE holdings SET balance_minor_units = 9007199255 WHERE id = 'usdt-1'");
    const snapshot = await exported(overBound);
    const live = await migrated(scaleTwoDatabase());
    const before = tablesOf(live);

    mockDatabase = live;
    await expect(restoreDataSnapshot(snapshot, SCALE_TWO_VERSION)).rejects.toThrow(
      /^data-transfer\/amount-too-large/,
    );

    expect(tablesOf(live)).toEqual(before);
  });
});
