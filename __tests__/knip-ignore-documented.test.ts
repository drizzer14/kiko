import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// CLAUDE.md "Documented exceptions": an ignore-list entry needs a concrete, verifiable reason in
// docs/harness/documented-exceptions.md. Without this pin a new `knip.json` `ignore` entry ships
// with no bullet and nothing fails.
const REPOSITORY_ROOT = join(__dirname, '..');

const readRepositoryFile = (file: string): string =>
  readFileSync(join(REPOSITORY_ROOT, file), 'utf8');

const ignoreEntries = (): string[] =>
  (JSON.parse(readRepositoryFile('knip.json')) as { ignore: string[] }).ignore;

const exceptionBullets = (): string[] =>
  readRepositoryFile('docs/harness/documented-exceptions.md')
    .split(/^(?=- )/m)
    .filter((bullet) => bullet.startsWith('- '))
    .map((bullet) => bullet.replace(/\s+/g, ' '));

describe('knip.json ignore entries in docs/harness/documented-exceptions.md', () => {
  it('lists at least one ignore entry, so the rows below cannot pass on an empty list', () => {
    expect(ignoreEntries().length).toBeGreaterThan(0);
  });

  it.each(ignoreEntries())('has a `knip.json` `ignore` bullet naming %s', (entry) => {
    const naming = exceptionBullets().filter(
      (bullet) => bullet.includes('`knip.json` `ignore`') && bullet.includes(`\`${entry}\``),
    );

    expect(naming).not.toEqual([]);
  });
});
