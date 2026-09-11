import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(__dirname, '../../drizzle/migrations');

// Phase 6 of the multi-account plan namespaces every SYNCED transaction's
// `external_id` by its holding's account id (`${accountId}:${sourceId}`), so the
// GLOBAL `(source, external_id)` unique index can no longer collide across two
// connections of the same provider (two Binance accounts each emit a
// `deposit:<id>` with a per-account — NOT globally unique — record id). Migration
// 0029 rewrites the existing rows to that form. Data-only (no snapshot), same
// class as 0022 / 0028.
describe('namespace external ids backfill migration', () => {
  const backfill = (): string =>
    readFileSync(join(migrationsDir, '0029_namespace_external_ids.sql'), 'utf8');

  it('rewrites external_id to the account-id-prefixed form for synced rows', () => {
    const sql = backfill();

    expect(sql).toContain('UPDATE `transactions`');
    // The namespaced form joins transactions.holding_id -> holdings.account_id
    // and prefixes the existing external id with `${account_id}:`.
    expect(sql).toContain("`account_id` || ':' || `transactions`.`external_id`");
    expect(sql).toContain('`holdings`');
    expect(sql).toContain('`holding_id`');
  });

  it('only touches monobank and binance rows, never manual ones', () => {
    const sql = backfill();

    expect(sql).toContain("`source` IN ('monobank', 'binance')");
    // A manual row carries a null external id and is excluded by source anyway.
    expect(sql).toContain('`external_id` IS NOT NULL');
    expect(sql).not.toContain("'manual'");
  });

  it('is idempotent: it skips a row already carrying the account-id prefix', () => {
    const sql = backfill();

    // The guard rewrites only a row whose external id does NOT already begin with
    // its holding's `${account_id}:`, so a second run — or a row an already-updated
    // sync wrote — is a no-op and can never double-prefix.
    expect(sql).toMatch(/NOT LIKE\s+`h`\.`account_id`\s*\|\|\s*':%'/);
  });

  it('carries no snapshot (a data-only migration), like 0022 and 0028', () => {
    expect(readdirSync(join(migrationsDir, 'meta'))).not.toContain('0029_snapshot.json');
  });

  it('registers the backfill under the journal idx the runner resolves it by', () => {
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const entry = journal.entries.find(
      (candidate) => candidate.tag === '0029_namespace_external_ids',
    );
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(entry?.idx).toBe(29);
    expect(readdirSync(migrationsDir)).toContain('0029_namespace_external_ids.sql');
    expect(index).toContain("import m0029 from './0029_namespace_external_ids.sql';");
    expect(index).toMatch(/\bm0029,/);
  });
});
