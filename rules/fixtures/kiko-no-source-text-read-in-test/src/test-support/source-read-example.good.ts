// Semgrep fixture (NEGATIVE, NESTED): a test reads data fixtures and
// migration files, never a `.ts`/`.tsx` source that mutation testing rewrites.
import { join } from 'node:path';
import fs, { readFileSync } from 'node:fs';

const MIGRATIONS_ROOT = join(__dirname, '..', '..', 'drizzle', 'migrations');

const FIXTURE_PATH = join(__dirname, '__fixtures__/statement-sample.csv');

export const fixtureText = (): string => readFileSync(FIXTURE_PATH, 'utf8');

export const workbookBytes = (): Buffer =>
  readFileSync(join(__dirname, '__fixtures__/statement-sample.xlsx'));

export const migrationSql = (tag: string): string =>
  readFileSync(join(MIGRATIONS_ROOT, `${tag}.sql`), 'utf8');

export const journalText = (): string =>
  readFileSync(join(MIGRATIONS_ROOT, 'meta/_journal.json'), 'utf8');

export const memberReadText = (): string => fs.readFileSync(FIXTURE_PATH, 'utf8');

export const memberReadBytes = (): Buffer =>
  fs.readFileSync(join(__dirname, '__fixtures__/statement-sample.xlsx'));

export const promiseReadText = (): Promise<string> =>
  fs.promises.readFile('statement-sample.csv', 'utf8');
