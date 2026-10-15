import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

// scripts/checks/fast.sh is the PostToolUse tier. A write to a shell, YAML or githooks file runs
// comment-line-width.sh on that file alone: it blocks (exit 2) on a `#` comment line over 100
// columns, and never on a code line, a shebang, or a file of another type.
const FAST = join(__dirname, '../scripts/checks/fast.sh');
const LIMIT = 100;

afterEach(removeTemporaryDirectories);

const runFast = (relativePath: string, source: string): SpawnSyncReturns<string> => {
  const file = join(createTemporaryDirectory('fast-hook-comment-width-'), relativePath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, source);

  return spawnSync('bash', [FAST], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_input: { file_path: file } }),
  });
};

const wordsOfWidth = (lead: string, width: number): string =>
  `${lead}${' ab'.repeat(width)}`.slice(0, width - 1).concat('x');

describe.each([
  ['a .sh file', 'scripts/probe.sh', ''],
  ['a .bash file', 'scripts/probe.bash', ''],
  ['a .yml file', 'rules/probe.yml', ''],
  ['a .yaml file', '.maestro/probe.yaml', ''],
  ['a githooks file', 'githooks/pre-commit', '#!/usr/bin/env bash\n'],
])('fast.sh on a write to %s', (_label, path, shebang) => {
  it('blocks on a # comment line over 100 columns and names the line', () => {
    const result = runFast(path, `${shebang}echo ok\n${wordsOfWidth('# ', LIMIT + 1)}\n`);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Comment line width');
    expect(result.stderr).toContain(`${path}:${shebang === '' ? 2 : 3}: 101 columns:`);
  });

  it('passes a # comment of exactly 100 columns', () => {
    expect(runFast(path, `${shebang}${wordsOfWidth('# ', LIMIT)}\n`)).toMatchObject({
      status: 0,
      stderr: '',
    });
  });

  it('passes a code line, a trailing comment, and a first-line shebang over 100 columns', () => {
    const long = 'a'.repeat(LIMIT);
    const source = `#!/usr/bin/env ${long}\necho ${long}\necho ok # ${long} ${long}\n`;

    expect(runFast(path, source)).toMatchObject({ status: 0, stderr: '' });
  });
});

// An explicit `any` fails Biome's lint, so a lint block in the output shows the write reached
// lint.sh and not only the comment-width check.
describe('fast.sh on a TypeScript or JavaScript write under a githooks segment', () => {
  it.each([
    ['githooks/probe.ts'],
    ['githooks/probe.tsx'],
    ['githooks/probe.js'],
    ['nested/githooks/probe.ts'],
  ])('runs the full fast tier on %s, not only the comment-width check', (path) => {
    const result = runFast(path, 'export const probe: any = 1;\n');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Biome (lint + format)');
  });
});

describe('fast.sh on a write to a file of another type', () => {
  it.each([
    ['notes.md', `${wordsOfWidth('# ', LIMIT + 1)}\n`],
    ['probe.json', `${wordsOfWidth('# ', LIMIT + 1)}\n`],
  ])('does not read %s for comment width', (path, source) => {
    expect(runFast(path, source)).toMatchObject({ status: 0, stderr: '' });
  });
});
