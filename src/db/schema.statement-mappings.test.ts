import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const migrationsDir = join(__dirname, '../../drizzle/migrations');

const combinedSql = (): string =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
    .join('\n');

describe('statement_mappings migration', () => {
  it('adds the statement_mappings column to settings', () => {
    expect(combinedSql()).toContain('ALTER TABLE `settings` ADD `statement_mappings` text;');
  });

  it('registers the new migration in the migrations index', () => {
    expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain('0034');
  });

  it('registers the migration under a journal idx the runner resolves it by', () => {
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const entry = journal.entries.find(
      (candidate) => candidate.tag === '0034_add_statement_mappings',
    );

    expect(entry).toBeDefined();
    expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain(
      `m${String(entry?.idx).padStart(4, '0')}`,
    );
  });
});
