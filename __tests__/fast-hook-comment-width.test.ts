import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { writeExecutable } from './test-support/mutation-repository';

// scripts/checks/fast.sh is the PostToolUse tier. A write to a shell, YAML or githooks file runs
// comment-line-width.sh on that file alone: it blocks (exit 2) on a `#` comment line over 100
// columns, and never on a code line, a shebang, or a file of another type. It then runs
// security.sh on the file. A write to a .js file runs comment-line-width.sh and then the full
// tier.
const FAST = join(__dirname, '../scripts/checks/fast.sh');
const LIMIT = 100;
const NO_FINDINGS = '{"results":[],"errors":[],"paths":{"scanned":[]}}';

// A real Semgrep run takes about 4 s alone, so the 5 s default would fail under load.
jest.setTimeout(60_000);

afterEach(removeTemporaryDirectories);

// A real Semgrep run takes seconds; only the rows about the security rules pay for it, and the
// others put a stand-in that finds nothing first on PATH. A real run starts in the folder that
// holds the written file, as a hook's does in the project root, so a `githooks/*` rule path
// matches.
const runFast = (
  relativePath: string,
  source: string,
  semgrep: 'stub' | 'real' = 'stub',
): SpawnSyncReturns<string> => {
  const root = createTemporaryDirectory('fast-hook-comment-width-');
  const file = join(root, relativePath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, source);
  const stubs = createTemporaryDirectory('fast-hook-semgrep-stub-');
  writeExecutable(join(stubs, 'semgrep'), `#!/usr/bin/env bash\nprintf '%s' '${NO_FINDINGS}'\n`);

  return spawnSync('bash', [FAST], {
    encoding: 'utf8',
    cwd: semgrep === 'real' ? root : undefined,
    env:
      semgrep === 'real' ? process.env : { ...process.env, PATH: `${stubs}:${process.env.PATH}` },
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

// The pre-write guard reads only TypeScript, so a history word in a shell comment reaches the
// Semgrep rules (rules/semgrep-mobile.yml) only through security.sh on the write.
describe.each([
  ['a .sh file', 'scripts/probe.sh', ''],
  ['a .bash file', 'scripts/probe.bash', ''],
  ['a githooks file', 'githooks/pre-commit', '#!/usr/bin/env bash\n'],
])('fast.sh on a write to %s with a history word in a comment', (_label, path, shebang) => {
  it('blocks and names the rule', () => {
    const result = runFast(path, `${shebang}# this check no longer runs\necho ok\n`, 'real');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('kiko-no-history-word-shell-comment');
  });

  it('passes the same comment without the history word', () => {
    expect(runFast(path, `${shebang}# this check runs once\necho ok\n`, 'real')).toMatchObject({
      status: 0,
      stderr: '',
    });
  });
});

// The pre-write guard reads only TypeScript, so a `//` comment over 100 columns in a JavaScript
// file (the guard and the checkers under scripts/ are .js) reaches the width check only here,
// before the rest of the fast tier.
describe('fast.sh on a write to a .js file', () => {
  const path = 'scripts/probe.js';

  it('blocks on a // comment line over 100 columns and names the line', () => {
    const result = runFast(path, `export const probe = 1;\n${wordsOfWidth('// ', LIMIT + 1)}\n`);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Comment line width');
    expect(result.stderr).toContain(`${path}:2: 101 columns:`);
  });

  it('blocks on a line of a block comment over 100 columns', () => {
    const source = `/*\n${wordsOfWidth(' * ', LIMIT + 1)}\n */\nexport const probe = 1;\n`;
    const result = runFast(path, source);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${path}:2: 101 columns:`);
  });

  it('passes a // comment of exactly 100 columns and a code line over it', () => {
    const source = `${wordsOfWidth('// ', LIMIT)}\nexport const probe =\n  '${'a'.repeat(LIMIT)}';\n`;

    expect(runFast(path, source)).toMatchObject({ status: 0, stderr: '' });
  });
});

// The project-wide check reads a .js file only under scripts/ and rules/fixtures/, so a .js write
// elsewhere (the drizzle-generated header of drizzle/migrations/migrations.js is 109 columns) must
// not block on a comment the project-wide check never reads.
describe('fast.sh on a write to a .js file the project-wide check does not read', () => {
  it.each([
    ['drizzle/migrations/migrations.js'],
    ['metro.config.js'],
    ['harness/kiko/probe.js'],
    ['src/probe.js'],
    ['scriptsx/probe.js'],
  ])('passes a // comment over 100 columns in %s', (path) => {
    const source = `${wordsOfWidth('// ', LIMIT + 9)}\nexport const probe = 1;\n`;

    expect(runFast(path, source)).toMatchObject({ status: 0, stderr: '' });
  });

  it('still runs the rest of the fast tier on such a write', () => {
    const result = runFast('drizzle/migrations/migrations.js', 'export const probe: any = 1;\n');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Biome (lint + format)');
  });

  it.each([
    ['scripts/checks/probe.js'],
    ['harness/kiko/scripts/probe.js'],
    ['rules/fixtures/probe.js'],
    ['rules/fixtures/deep/probe.js'],
    ['githooks/probe.js'],
    ['nested/githooks/probe.js'],
  ])('blocks on a // comment line over 100 columns in %s', (path) => {
    const result = runFast(path, `${wordsOfWidth('// ', LIMIT + 1)}\n`);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${path}:1: 101 columns:`);
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
