import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { repositoryFiles } from './test-support/repository-files';

// A shell comment wraps at 100 columns, like a TypeScript one (check:comment-line-width reads only
// TypeScript and JavaScript). A comment line is a line whose first non-blank character is `#`; the
// shebang is a command, not a comment. Columns are code points, as comment-line-width.js counts.
const ROOT = join(__dirname, '..');
const LINE_WIDTH = 100;

const columnsOf = (text: string): number => [...text].length;

const isCommentLine = (line: string): boolean => {
  const trimmed = line.trimStart();

  return trimmed.startsWith('#') && !trimmed.startsWith('#!');
};

const overlongCommentLines = (source: string): number[] =>
  source
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => isCommentLine(line) && columnsOf(line) > LINE_WIDTH)
    .map(({ number }) => number);

const shellScripts = (): string[] =>
  repositoryFiles(ROOT).filter((file) => /^scripts\/.*\.sh$/.test(file));

describe('shell comments wrap at 100 columns', () => {
  it('scans the scripts it is meant to', () => {
    expect(shellScripts()).toEqual(
      expect.arrayContaining(['scripts/checks/mutation.sh', 'scripts/checks/medium.sh']),
    );
  });

  it.each([
    ['a comment of exactly 100 columns', `# ${'a'.repeat(98)}`, []],
    ['a comment of 101 columns', `# ${'a'.repeat(99)}`, [1]],
    ['an indented comment past 100 columns', `  # ${'a'.repeat(98)}`, [1]],
    ['a shebang past 100 columns', `#!/usr/bin/env ${'a'.repeat(100)}`, []],
    ['a code line past 100 columns', `echo ${'a'.repeat(100)}`, []],
    ['a comment of 100 wide code points holding a multi-byte letter', `# ${'é'.repeat(98)}`, []],
    ['the second line of two', `# short\n# ${'a'.repeat(99)}`, [2]],
  ])('finds the overlong lines of %s', (_label, source, expected) => {
    expect(overlongCommentLines(source)).toEqual(expected);
  });

  it('holds for every comment line of every script under scripts/', () => {
    const offenders = shellScripts().flatMap((file) =>
      overlongCommentLines(readFileSync(join(ROOT, file), 'utf8')).map(
        (number) => `${file}:${number}`,
      ),
    );

    expect(offenders).toEqual([]);
  });
});
