import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { repositoryFiles } from './test-support/repository-files';
import { lineCountBefore } from './test-support/markdown-code-spans';

// A plan or a spec that files a gap as a "known limit" ships the gap with no owner: the gap is
// fixed, or put to the user as an open question. This makes the phrase fail `make verify` in the
// design docs under docs/superpowers/ instead of waiting for a review to find it.
const REPOSITORY_ROOT = join(__dirname, '..');

const SCOPE_PATTERN = /^docs\/superpowers\/.+\.md$/;

const KNOWN_LIMIT_PATTERN = /known\s+limit(?:ation)?/gi;

// Dated design docs that predate the rule, exempt by exact path, each with the count of matches it
// holds. A doc that gains a match, or loses one without the count dropping here, fails, so the
// debt only shrinks; a new doc is never added.
const PREDATING_DOCS: Readonly<Record<string, number>> = {
  'docs/superpowers/plans/2026-09-28-reminders.md': 1,
  'docs/superpowers/specs/2026-09-27-reminders-design.md': 2,
};

const PREDATING_PATHS = Object.keys(PREDATING_DOCS);

const knownLimitLines = (markdown: string): number[] =>
  [...markdown.matchAll(KNOWN_LIMIT_PATTERN)].map(
    (match) => lineCountBefore(markdown, match.index ?? 0) + 1,
  );

const scopeFiles = repositoryFiles(REPOSITORY_ROOT).filter((file) => SCOPE_PATTERN.test(file));

const readRepositoryFile = (file: string): string =>
  readFileSync(join(REPOSITORY_ROOT, file), 'utf8');

describe('knownLimitLines', () => {
  it('finds the phrase in any case, singular, plural and as "limitation" (POSITIVE)', () => {
    expect(
      knownLimitLines(
        '# Title\n\n## Known limits\n\nA known limitation of the import.\nThe KNOWN LIMIT stays.\n',
      ),
    ).toEqual([3, 5, 6]);
  });

  it('finds the phrase wrapped across a line break, at the line of its first word (POSITIVE)', () => {
    expect(
      knownLimitLines('A note\non the known\nlimit of the import,\nand a known\n  limitation.\n'),
    ).toEqual([2, 4]);
  });

  it('skips a text that has no such phrase (NEGATIVE)', () => {
    expect(knownLimitLines('A known issue, a limit, and the limits of known data.\n')).toEqual([]);
  });
});

describe('docs/superpowers has no "known limit"', () => {
  it('scans the plans and the specs', () => {
    expect(scopeFiles).toEqual(expect.arrayContaining([...PREDATING_PATHS]));
  });

  it('holds the phrase only in the dated docs that predate the rule', () => {
    expect(
      scopeFiles
        .filter((file) => !PREDATING_PATHS.includes(file))
        .flatMap((file) =>
          knownLimitLines(readRepositoryFile(file)).map((line) => `${file}:${line}`),
        ),
    ).toEqual([]);
  });

  it('holds in each dated doc exactly the matches it held when the rule landed', () => {
    expect(
      Object.fromEntries(
        PREDATING_PATHS.map((file) => [file, knownLimitLines(readRepositoryFile(file)).length]),
      ),
    ).toEqual(PREDATING_DOCS);
  });
});
