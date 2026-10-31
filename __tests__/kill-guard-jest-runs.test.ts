import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import {
  createFakeRepository,
  decideInEachFolder,
} from './test-support/kill-guard-fake-repository';
import { decideAll } from './test-support/kill-guard-decide';
import { removeTemporaryDirectories } from './test-support/temporary-directory';

// The full-suite jest deny of scripts/checks/kill-guard.js: a jest runner (`npx jest`, `jest`,
// `node_modules/.bin/jest`, `npm test`, `npm t`, `npm run test`, `make jest`) that names no test
// file runs every suite of the repository, which takes minutes of CPU on a machine every other
// agent shares; the one route to the whole suite is the queued verify. An ARRAY option of
// jest-cli (in either spelling, the space form or the `=` form) swallows the bare words after
// it, so a path put after one is read as one more value and the whole suite runs again.
//
// The deny judges the typed command only: a script that holds `npx jest` is never read. Every
// text here is judged, never run: `decide` is called in node as a parser only.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard.sh');
const FULL_JEST = 'fullJest';

const repository = createFakeRepository('guard-jest-runs-');
afterAll(removeTemporaryDirectories);

const WORKTREE = repository.worktree;
const HOLDING_JEST = join(repository.scratch, 'holds-npx-jest.sh');
writeFileSync(HOLDING_JEST, '#!/bin/bash\nnpx jest\nnpm test\n');

// jest-cli's own option table: the array options are read from it, not copied, so a new one in
// a later jest-cli is a red row here instead of a silent hole.
const { options: JEST_CLI_OPTIONS } = require(
  join(__dirname, '../node_modules/jest-cli/build/args.js'),
) as { options: Record<string, { type?: string; alias?: string }> };

const ARRAY_OPTIONS = Object.entries(JEST_CLI_OPTIONS)
  .filter(([, specification]) => specification.type === 'array')
  .map(([name]) => name);

const judgedInWorktree = (commands: string[]): string[] =>
  decideAll(
    commands.map((command) => [
      command,
      { projectRoot: repository.main, cwd: repository.worktree },
    ]),
  );

const kebabCase = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const DENIED_WITHOUT_A_PATH: string[] = [
  'npx jest',
  'jest',
  'npm test',
  'npm run test',
  'npm t',
  'make jest',
  'node_modules/.bin/jest --ci',
  './node_modules/.bin/jest',
  `${WORKTREE}/node_modules/.bin/jest --ci`,
  `cd ${WORKTREE} && npx jest`,
  `(cd ${WORKTREE} && npx jest)`,
  'env -u FORCE_COLOR npx jest',
  'FORCE_COLOR=0 npx jest',
  'timeout 600 npx jest',
  'nohup npx jest > out.log 2>&1 &',
  'time npx jest',
  'npx jest 2>&1 | tail -20',
  'true && npx jest',
  "sh -c 'npx jest'",
  "bash -lc 'npx jest --ci'",
  'eval "npx jest"',
  'echo $(npx jest)',
  // Only options remain: a value an option takes is no test path.
  'npx jest --ci --coverage',
  'npx jest --maxWorkers=2',
  'npx jest --maxWorkers 2',
  'npx jest --config jest.config.js',
  // A name filter loads every suite, and a variable the text cannot resolve may hold nothing.
  'npx jest -t name',
  'npx jest --testNamePattern name',
  'npx jest $FILES',
  'npx jest "$FILES"',
  'npx jest --ci $FILES',
];

// An array option swallows the path after it, in the space form and in the `=` form alike (a
// measured fact of jest-cli 29.7.0: 882 suites listed, the named test absent).
const DENIED_ARRAY_OPTION_BEFORE_A_PATH: string[] = [
  'npx jest --testPathIgnorePatterns e2e src/a.test.ts',
  'npx jest --testPathIgnorePatterns=e2e src/a.test.ts',
  'npx jest --roots src src/a.test.ts',
  'npx jest --roots=src src/a.test.ts',
  'npx jest --testPathPattern=binance src/a.test.ts',
  'npx jest --testPathPattern binance src/a.test.ts',
  'npx jest --ci --testPathIgnorePatterns e2e src/a.test.ts',
  'npx jest --testPathIgnorePatterns e2e src/a.test.ts src/b.test.ts',
  'node_modules/.bin/jest --testPathIgnorePatterns=e2e src/a.test.ts',
  `cd ${WORKTREE} && npx jest --testPathIgnorePatterns e2e src/a.test.ts`,
  'env -u FORCE_COLOR npx jest --roots src src/a.test.ts',
  'KIKO_REGEN_DEMO=1 npx jest --roots src src/a.test.ts',
];

const ALLOWED_RUNS: string[] = [
  'npx jest src/a.test.ts --maxWorkers=2',
  'node_modules/.bin/jest src/a.test.ts',
  './node_modules/.bin/jest src/a.test.ts src/b.test.ts',
  'npx jest --ci src/a.test.ts',
  'npx jest --maxWorkers=2 src/a.test.ts',
  'npx jest --maxWorkers 2 src/a.test.ts',
  'npx jest -c jest.config.js src/a.test.ts',
  'npx jest --coverage=false src/a.test.ts',
  // The path comes first, or a dash option stands between the array option and the path.
  'npx jest src/a.test.ts --testPathIgnorePatterns e2e',
  'npx jest src/a.test.ts --testPathIgnorePatterns=e2e',
  'npx jest src/a.test.ts --roots src',
  'npx jest --testPathIgnorePatterns e2e --ci src/a.test.ts',
  'npx jest --testPathIgnorePatterns=e2e --ci src/a.test.ts',
  // A filter is not the full suite when it is the only option, and a name filter beside a path
  // keeps the path.
  'npx jest --testPathPattern=binance',
  'npx jest -t name src/a.test.ts',
  'npx jest src/a.test.ts -t name',
  'npx jest --testNamePattern name src/a.test.ts',
  'npx jest --findRelatedTests src/a.ts',
  'npx jest --findRelatedTests src/a.ts src/b.ts',
  'npx jest --listTests --findRelatedTests src/a.ts',
  // The affected-tests runner names its suites itself, so typing it is no full-suite run.
  'make jest-affected',
  'make jest-affected BASE=origin/main',
  'bash scripts/checks/jest-affected.sh',
  'bash scripts/checks/jest-affected.sh origin/main --list',
  // These run no test, whatever else the command holds.
  'npx jest --listTests',
  'npx jest --help',
  'npx jest --version',
  'npx jest --showConfig',
  'npx jest --listTests --ci',
  'npx jest --ci --listTests',
  'npx jest --listTests --findRelatedTests',
  'npx jest --listTests --testPathIgnorePatterns e2e src/a.test.ts',
  'npx jest src/a.test.ts --listTests',
  'npx jest --showConfig --roots src',
  'npx jest --help --ci',
  // A path after `--` reaches jest through npm; none there is the full suite.
  'npm test -- src/a.test.ts',
  'npm run test -- src/a.test.ts',
  'npm t -- src/a.test.ts',
  'npm test -- src/a.test.ts --maxWorkers=2',
  // An environment prefix is judged on the jest words after it.
  'KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts',
  'env -u FORCE_COLOR npx jest src/a.test.ts',
  'env FORCE_COLOR=0 npx jest src/a.test.ts --maxWorkers=2',
  `cd ${WORKTREE} && npx jest src/a.test.ts`,
  'timeout 600 npx jest src/a.test.ts',
  'npx jest src/a.test.ts 2>&1 | tail -20',
  // Other commands, and text that only mentions a runner.
  'make doc-suites',
  'make mutable',
  `bash scripts/job-queue.sh verify ${WORKTREE} label`,
  'grep "npx jest" x',
  'echo npx jest',
  'echo "npm test"',
  'git commit -m "npx jest"',
  "grep -rn 'npm test' docs/",
  'npm run check:lint',
  'npm run check:typecheck',
  'npm install',
  // The deny judges the typed command, so a script that holds a runner runs as typed.
  `bash ${HOLDING_JEST}`,
];

describe('kill-guard full-suite jest deny (parser only, fake repository)', () => {
  it.each([...DENIED_WITHOUT_A_PATH, ...DENIED_ARRAY_OPTION_BEFORE_A_PATH])(
    'denies in every folder: %s',
    (command) => {
      expect(decideInEachFolder(repository, command)).toEqual([FULL_JEST, FULL_JEST, FULL_JEST]);
    },
  );

  it.each(ALLOWED_RUNS)('allows in every folder: %s', (command) => {
    expect(decideInEachFolder(repository, command)).toEqual(['allow', 'allow', 'allow']);
  });

  it('reads 21 array options from jest-cli, none of them with an alias', () => {
    expect(ARRAY_OPTIONS).toHaveLength(21);
    expect(ARRAY_OPTIONS.filter((name) => JEST_CLI_OPTIONS[name].alias !== undefined)).toEqual([]);
  });

  // yargs reads the camelCase name and its kebab-case spelling alike (measured: 885 lines listed
  // for `--test-path-ignore-patterns=e2e <path>`).
  it.each(ARRAY_OPTIONS)(
    'denies the array option --%s before a path, in every spelling',
    (name) => {
      const kebab = kebabCase(name);
      const swallowing = [
        `npx jest --${name} x src/a.test.ts`,
        `npx jest --${name}=x src/a.test.ts`,
        `npx jest --${kebab} x src/a.test.ts`,
        `npx jest --${kebab}=x src/a.test.ts`,
      ];

      expect(judgedInWorktree(swallowing)).toEqual(swallowing.map(() => FULL_JEST));
    },
  );

  it.each(ARRAY_OPTIONS)(
    'allows the array option --%s after a path or past a dash option',
    (name) => {
      const kebab = kebabCase(name);
      const safe = [
        `npx jest src/a.test.ts --${name} x`,
        `npx jest src/a.test.ts --${name}=x`,
        `npx jest --${name} x --ci src/a.test.ts`,
        `npx jest --${name}=x --ci src/a.test.ts`,
        `npx jest --${kebab}=x --ci src/a.test.ts`,
      ];

      expect(judgedInWorktree(safe)).toEqual(safe.map(() => 'allow'));
    },
  );
});

describe('scripts/checks/kill-guard.sh full-suite jest deny (hook entry)', () => {
  const run = (command: string) =>
    spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ cwd: join(__dirname, '..'), tool_input: { command } }),
      encoding: 'utf8',
    });

  const reasonOf = (command: string): string => {
    const result = run(command);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe('');
    const { hookSpecificOutput } = JSON.parse(result.stdout.trim());
    expect(hookSpecificOutput.permissionDecision).toBe('deny');

    return hookSpecificOutput.permissionDecisionReason;
  };

  it('denies a bare runner with the standard block and names the queued verify', () => {
    const reason = reasonOf('npx jest');

    expect(
      ['WHAT FAILED:', 'DETAILS:', 'WHY IT MATTERS:', 'HOW TO FIX:', 'DO NOT:'].filter(
        (label) => !reason.includes(label),
      ),
    ).toEqual([]);
    expect(reason).toContain('scripts/job-queue.sh');
  });

  it('names the array option that swallowed the path', () => {
    expect(reasonOf('npx jest --testPathIgnorePatterns e2e src/a.test.ts')).toContain(
      'testPathIgnorePatterns',
    );
  });

  it('allows a runner that names a test file', () => {
    const result = run('npx jest src/a.test.ts --maxWorkers=2');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});
