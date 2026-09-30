import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_TAG = '0046_add_quote_quota';
const PREVIOUS_TAG = '0045_add_reminders';
const MIGRATIONS_ROOT = join(__dirname, '../../drizzle/migrations');
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';
// drizzle-kit's own journal key, read by name so no identifier abbreviates it.
const JOURNAL_INDEX_KEY = 'idx';

type JournalEntry = { tag: string; [key: string]: unknown };

const readJournal = (): JournalEntry[] =>
  (
    JSON.parse(readFileSync(join(MIGRATIONS_ROOT, 'meta/_journal.json'), 'utf8')) as {
      entries: JournalEntry[];
    }
  ).entries;

const statements = (): string[] =>
  readFileSync(join(MIGRATIONS_ROOT, `${MIGRATION_TAG}.sql`), 'utf8')
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');

describe('quote quota migration', () => {
  it('adds one nullable text column to settings and nothing else', () => {
    expect(statements()).toEqual(['ALTER TABLE `settings` ADD `quote_quota` text;']);
  });

  it('is journal index 46, right after the reminders migration', () => {
    const journal = readJournal();
    const position = journal.findIndex((entry) => entry.tag === MIGRATION_TAG);

    expect(journal[position]?.[JOURNAL_INDEX_KEY]).toBe(46);
    expect(journal[position - 1]?.tag).toBe(PREVIOUS_TAG);
  });

  it('is bundled under the key the count-based runner resolves', () => {
    const bundle = readFileSync(join(MIGRATIONS_ROOT, 'migrations.js'), 'utf8');

    expect(bundle).toContain(`import m0046 from './${MIGRATION_TAG}.sql';`);
    expect(bundle).toMatch(/\bm0046,/);
  });

  it('keeps the existing settings row and reads its quota as null', () => {
    const database = new DatabaseSync(':memory:');

    applyMigrationsThrough(database, PREVIOUS_TAG);
    database.exec("INSERT INTO settings (id, base_currency) VALUES (1, 'USD')");

    for (const statement of statements()) {
      database.exec(statement);
    }

    expect(database.prepare('SELECT base_currency, quote_quota FROM settings').all()).toEqual([
      { base_currency: 'USD', quote_quota: null },
    ]);
  });
});
