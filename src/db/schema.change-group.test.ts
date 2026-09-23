import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(__dirname, '../../drizzle/migrations');

const combinedSql = (): string =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
    .join('\n');

describe('change_group_id migration', () => {
  it('adds the change_group_id column to transactions', () => {
    expect(combinedSql()).toContain('ALTER TABLE `transactions` ADD `change_group_id` text;');
  });

  it('registers the new migration in the migrations index', () => {
    expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain('0030');
  });

  it('registers the migration under a journal idx the runner resolves it by', () => {
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const entry = journal.entries.find((candidate) => candidate.tag === '0030_add_change_group_id');

    expect(entry).toBeDefined();
    expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain(
      `m${String(entry?.idx).padStart(4, '0')}`,
    );
  });
});
