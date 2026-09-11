import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(__dirname, '../../drizzle/migrations');
const sqlFiles = (): string[] =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'));

// The per-connection Monobank sync cursor lives in its own `sync_state` table,
// de-globalizing the former single-row `settings` cursor (see the table comment
// in `src/db/schema.ts`). Migration 0027 creates the table.
describe('sync_state table migration', () => {
  it('creates the sync_state table with the per-connection cursor columns', () => {
    const combined = sqlFiles().join('\n');

    expect(combined).toContain('CREATE TABLE `sync_state`');
    expect(combined).toContain('`account_id` text PRIMARY KEY NOT NULL');
    expect(combined).toContain('`last_sync_at` integer');
    expect(combined).toContain('`last_full_sync_at` integer');
    expect(combined).toContain('`last_sync_display_at` integer');
    expect(combined).toContain('`failed_sync_monobank_ids` text');
    expect(combined).toContain('REFERENCES `accounts`(`id`)');
  });

  it('registers the create-table migration in the index', () => {
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(index).toContain("import m0027 from './0027_add_sync_state.sql';");
    expect(index).toMatch(/\bm0027,/);
  });
});

// The backfill seeds one `sync_state` row from the current global `settings`
// cursor for the account that currently holds `institution = 'monobank'` (at
// most one today), so an already-synced user lands on their existing cursor
// rather than a full re-fetch. Data-only (no snapshot), same class as 0022.
describe('sync_state backfill migration', () => {
  const backfill = (): string =>
    readFileSync(join(migrationsDir, '0028_backfill_sync_state.sql'), 'utf8');

  it('copies the four cursor columns from settings into sync_state for the connected account', () => {
    const sql = backfill();

    expect(sql).toContain('INSERT INTO `sync_state`');
    for (const column of [
      'account_id',
      'last_sync_at',
      'last_full_sync_at',
      'last_sync_display_at',
      'failed_sync_monobank_ids',
    ]) {
      expect(sql).toContain(`\`${column}\``);
    }
    expect(sql).toContain('FROM `accounts`');
    expect(sql).toContain('`settings`');
    expect(sql).toContain("`institution` = 'monobank'");
  });

  it('is re-runnable: it only inserts a row that does not already exist', () => {
    const sql = backfill();

    // The `NOT EXISTS` guard against `sync_state` makes a second run a no-op, so
    // it never overwrites a cursor a later real sync already advanced.
    expect(sql).toMatch(/NOT EXISTS[\s\S]*FROM `sync_state`/);
  });

  it('carries no snapshot (a data-only migration), like 0022', () => {
    expect(readdirSync(join(migrationsDir, 'meta'))).not.toContain('0028_snapshot.json');
  });

  it('registers the backfill under the journal idx the runner resolves it by', () => {
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const entry = journal.entries.find((candidate) => candidate.tag === '0028_backfill_sync_state');
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(entry?.idx).toBe(28);
    expect(readdirSync(migrationsDir)).toContain('0028_backfill_sync_state.sql');
    expect(index).toContain("import m0028 from './0028_backfill_sync_state.sql';");
    expect(index).toMatch(/\bm0028,/);
  });
});
