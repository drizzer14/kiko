import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The trend-filter migration replaces the single `trend_category_keys` setting
// with the richer `trend_filter` JSON. It adds the new column and migrates any
// existing saved keys into a `{ mode: 'manual', keys: [...] }` value; a null
// stays null (the row is left untouched and the chart falls back to the
// default). The runner applies raw SQL on device, so this test asserts the
// migration's SQL and its registration rather than executing SQLite.
const migrationsDir = join(__dirname, '../../drizzle/migrations');

const combinedSql = (): string =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
    .join('\n');

describe('trend_filter migration', () => {
  it('adds the trend_filter column', () => {
    expect(combinedSql()).toContain('ADD `trend_filter` text');
  });

  it('migrates an existing non-null trend_category_keys into a manual filter', () => {
    const sql = combinedSql();

    expect(sql).toContain("json_object('mode', 'manual', 'keys', json(`trend_category_keys`))");
    expect(sql).toContain('WHERE `trend_category_keys` IS NOT NULL');
  });

  it('registers the migration under the journal idx the runner resolves it by', () => {
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const entry = journal.entries.find((candidate) => candidate.tag === '0025_add_trend_filter');

    expect(entry?.idx).toBe(25);
    expect(index).toContain('m0025');
  });
});
