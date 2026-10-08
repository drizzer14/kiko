import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getTableColumns } from 'drizzle-orm';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { settings } from './schema';
import { KEPT_FROM_LIVE_ON_RESTORE } from './kept-from-live-on-restore';

/**
 * A removed feature can leave a live-but-unread schema column behind
 * (`settings.lockGraceSeconds` did). This test walks the
 * `settings` table's TypeScript column properties and asserts every one of them
 * is mentioned somewhere in `src/` outside `schema.ts` (the declaration site)
 * and this file itself (see `SELF_PATH` below).
 *
 * The exception list is EXACT, not a floor: a new reader-less column fails, and
 * so does re-wiring a listed one without removing it here. That makes the list
 * a deliberate decision gate rather than a place to hide dead schema.
 *
 * Test files (`*.test.ts(x)`) are excluded from the scan: a column named only
 * in a test fixture (e.g. a round-trip export/import sample) is not a
 * production reader, and counting it would let a test mask a genuinely dead
 * column, defeating the gate.
 */
const DOCUMENTED_READERLESS_COLUMNS = [
  // Legacy: the abandoned background-grace design. The shipped lock is
  // cold-launch-only. Deliberately not dropped — see docs/security/README.md
  // and the comment on the column in schema.ts.
  'lockGraceSeconds',
  // Legacy: the removed light/dark color-scheme feature. The app is
  // dark-only, so nothing reads or writes this column. Deliberately
  // not dropped (migrations here are additive-only — a removed feature's
  // harmless retained column stays) — see the comment on the column in
  // schema.ts.
  'appearance',
  // Superseded: the previous spending-trend selection (a JSON array of category
  // slugs). Replaced by `trendFilter`; migration 0025 copies any saved value
  // across as a manual filter. Nothing in src/ reads or writes it —
  // deliberately not dropped (same additive-only class) — see the comment on
  // the column in schema.ts.
  'trendCategoryKeys',
  // Legacy: the removed EODHD share-price daily quota. Nothing reads or writes
  // it — deliberately not dropped, so a future drizzle-kit generate
  // does not emit a DROP that diverges from the migration snapshots — see the
  // comment on the column in schema.ts.
  'quoteQuota',
  // Interim, not legacy: the dismissed tip ids (migration 0055). The tips
  // repo that reads and writes it lands in a later onboarding task, which must
  // remove this entry when it adds the first reader.
  'dismissedTips',
];

// What a `.kiko` restore does with each column (`restoreDataSnapshot`): the
// ones in `KEPT_FROM_LIVE_ON_RESTORE`, which the restore reads, belong to THIS
// device and stay; every other column comes from the file. Like the readerless
// list, the two lists are exact: a new column fails here until someone decides
// which it is.
const TAKEN_FROM_FILE_ON_RESTORE = [
  'id',
  'baseCurrency',
  'lastSyncAt',
  'defaultCategoryKey',
  'lockGraceSeconds',
  'language',
  'appearance',
  'lastSyncDisplayAt',
  'lastFullSyncAt',
  'trendCategoryKeys',
  'trendFilter',
  'failedSyncMonobankIds',
  'statementMappings',
  'dedupKeysUpgraded',
  'importTimesRezoned',
  'reminderOfferDismissals',
  'lotsRecosted',
  'quoteQuota',
  'dismissedTips',
];

const SCHEMA_PATH = join(__dirname, 'schema.ts');
// This test file must name the documented exception (`lockGraceSeconds`) in
// its own comment and array literal above, which would otherwise register as
// a "reader" of the column purely from its own text — masking the exact
// column it exists to flag. Excluded from the scan for that reason, the same
// way schema.ts (the column's declaration site) is excluded.
const SELF_PATH = __filename;
const SRC_ROOT = join(__dirname, '..');

// Reads the column names off the live table object, not schema.ts's own
// text: Stryker's instrumented copy of schema.ts does not contain the
// literal `export const settings = sqliteTable('settings', {` a text split
// would need to match against, so a live table read is the only form immune
// to that rewrite.
const settingsColumns = (): string[] => Object.keys(getTableColumns(settings));

const sourceFiles = (directory: string): string[] => {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }

    if (
      !/\.tsx?$/.test(entry) ||
      /\.test\.tsx?$/.test(entry) ||
      full === SCHEMA_PATH ||
      full === SELF_PATH
    ) {
      return [];
    }

    return [full];
  });
};

describe('settings schema columns', () => {
  it('has every column referenced outside schema.ts, except the documented legacy ones', () => {
    const columns = settingsColumns();
    expect(columns.length).toBeGreaterThan(0);

    // Only whole-word column names are searched, and Stryker keeps every identifier.
    // nosemgrep: kiko-no-source-text-read-in-test OVERRIDE(whole-word name search)
    const sources = sourceFiles(SRC_ROOT).map((file) => readFileSync(file, 'utf8'));
    const readerless = columns.filter(
      (column) => !sources.some((source) => new RegExp(`\\b${column}\\b`).test(source)),
    );

    expect(readerless.sort()).toEqual([...DOCUMENTED_READERLESS_COLUMNS].sort());
  });

  it('has every column classified as kept from the live row or taken from the file on a restore', () => {
    expect(settingsColumns().sort()).toEqual(
      [...KEPT_FROM_LIVE_ON_RESTORE, ...TAKEN_FROM_FILE_ON_RESTORE].sort(),
    );
  });

  it('adds import_times_rezoned via migration 0043, defaulting to false', () => {
    const database = new DatabaseSync(':memory:');

    applyAllMigrations(database);

    const columnInfo = database.prepare('PRAGMA table_info(settings)').all() as {
      name: string;
      notnull: number;
      dflt_value: string;
    }[];
    const importTimesRezoned = columnInfo.find((column) => column.name === 'import_times_rezoned');

    expect(importTimesRezoned).toBeDefined();
    expect(importTimesRezoned?.notnull).toBe(1);
    expect(importTimesRezoned?.dflt_value).toBe('false');
  });

  it('adds lots_recosted via migration 0048, defaulting to false', () => {
    const database = new DatabaseSync(':memory:');

    applyAllMigrations(database);

    const columnInfo = database.prepare('PRAGMA table_info(settings)').all() as {
      name: string;
      notnull: number;
      dflt_value: string;
    }[];
    const lotsRecosted = columnInfo.find((column) => column.name === 'lots_recosted');

    expect(lotsRecosted).toBeDefined();
    expect(lotsRecosted?.notnull).toBe(1);
    expect(lotsRecosted?.dflt_value).toBe('false');
  });
});
