import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

// A check that is told to scan a path that is not on disk must say so and fail, not scan nothing
// and pass. A silent pass over a missing root reads as a clean tree.
const CHECKS = join(__dirname, '../scripts/checks');

type Run = { status: number | null; stdout: string; stderr: string };

const runWrapper = (
  wrapper: string,
  wrapperArguments: string[],
  environment: Record<string, string> = {},
): Run => {
  const result = spawnSync('bash', [join(CHECKS, wrapper), ...wrapperArguments], {
    cwd: createTemporaryDirectory('wrapper-missing-path-cwd-'),
    env: {
      ...process.env,
      TMPDIR: createTemporaryDirectory('wrapper-missing-path-state-'),
      ...environment,
    },
    encoding: 'utf8',
  });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const expectRefusal = (run: Run, missingPath: string): void => {
  expect(run.status).toBe(2);
  expect(run.stderr).toContain('CHECK FAILED');
  expect(run.stderr).toContain(missingPath);
};

afterEach(removeTemporaryDirectories);

const PROJECT_WIDE_WRAPPERS: [string, string][] = [
  ['import-order.sh', 'IMPORT_ORDER_SRC_ROOT'],
  ['full-word-identifiers.sh', 'FULL_WORD_IDENTIFIERS_SRC_ROOT'],
  ['screen-imports.sh', 'SCREEN_IMPORTS_SOURCE_ROOT'],
  ['feature-imports.sh', 'FEATURE_IMPORTS_SOURCE_ROOT'],
  ['blank-line-separation.sh', 'BLANK_LINE_SOURCE_ROOT'],
  ['comment-line-width.sh', 'COMMENT_LINE_WIDTH_SOURCE_ROOT'],
];

const PER_FILE_WRAPPERS = [
  'import-order.sh',
  'full-word-identifiers.sh',
  'screen-imports.sh',
  'feature-imports.sh',
  'blank-line-separation.sh',
  'comment-line-width.sh',
  'dup.sh',
  'override-guard.sh',
  'secrets.sh',
];

// Every other scripts/checks/*.sh, each with the reason it has no scan root or file list to refuse.
const NOT_PATH_WRAPPERS: [string, string][] = [
  ['_lib.sh', 'a sourced helper library, not a check'],
  ['closure-table.sh', 'checks one table file the caller names; closure-table.test.ts pins it'],
  ['commit-typecheck.sh', 'typechecks the staged index, which it reads from git'],
  [
    'component-i18n-namespace.sh',
    'scans one fixed root; component-i18n-namespace.test.ts pins its missing root',
  ],
  ['deps.sh', 'reads package.json and the lockfile at the repository root'],
  ['fast.sh', 'reads a hook payload on stdin'],
  ['guard-replay.sh', 'replays the files git reports changed, with options only'],
  [
    'jest-affected.sh',
    'takes a base ref and --list, the changed paths come from git; jest-affected.test.ts pins an unresolved base',
  ],
  ['kill-guard-probe.sh', 'runs one command in a real shell, a manual probe'],
  ['kill-guard.sh', 'reads a hook payload on stdin'],
  ['knip.sh', 'reads the repository root and its config'],
  ['lint.sh', 'hands its target to Biome, which refuses a path it cannot read'],
  ['medium.sh', 'runs the other wrappers, takes no path'],
  ['mutation.sh', 'takes options, the changed files come from git'],
  ['osv.sh', 'reads package-lock.json at the repository root'],
  [
    'permission-doctor.sh',
    'reads the settings files of the cwd and the user; the missing-node case below pins it',
  ],
  ['plist.sh', 'reads the one fixed Info.plist'],
  ['pre-write-guard.sh', 'reads a hook payload on stdin'],
  ['security.sh', 'hands its targets to Semgrep, which refuses a path it cannot read'],
  ['semgrep-rules.sh', 'scans the fixed fixtures directory; its test seam is a directory'],
  ['shipped-migrations.sh', 'compares the migrations folder against git history'],
  ['typecheck.sh', 'runs tsc over the project'],
  ['verify.sh', 'runs the other checks in order, takes no path'],
];

describe('every check wrapper is either covered here or named with a reason', () => {
  it('lists each scripts/checks/*.sh once', () => {
    const covered = [
      ...PROJECT_WIDE_WRAPPERS.map(([wrapper]) => wrapper),
      ...PER_FILE_WRAPPERS,
      ...NOT_PATH_WRAPPERS.map(([wrapper]) => wrapper),
    ];
    const present = readdirSync(CHECKS).filter((name) => name.endsWith('.sh'));

    expect([...new Set(covered)].sort()).toEqual(present.sort());
  });
});

describe('a project-wide root override at a missing directory', () => {
  it.each(PROJECT_WIDE_WRAPPERS)('%s exits 2 and names the path (%s)', (wrapper, variable) => {
    const missingRoot = join(createTemporaryDirectory('wrapper-missing-path-'), 'no-such-root');

    expectRefusal(runWrapper(wrapper, [], { [variable]: missingRoot }), missingRoot);
  });
});

describe('a deleted path in the file list', () => {
  it.each(PER_FILE_WRAPPERS)('%s exits 2 and names the path', (wrapper) => {
    const deleted = join(createTemporaryDirectory('wrapper-missing-path-'), 'src/deleted.ts');

    expectRefusal(runWrapper(wrapper, [deleted]), deleted);
  });

  it('secrets.sh exits 2 and names a missing directory', () => {
    const missingDirectory = join(createTemporaryDirectory('wrapper-missing-path-'), 'no-such-dir');

    expectRefusal(runWrapper('secrets.sh', [missingDirectory]), missingDirectory);
  });
});

describe('a wrapper that runs node, with node missing from PATH', () => {
  it('permission-doctor.sh fails closed with a standard block and exit 2', () => {
    const run = runWrapper('permission-doctor.sh', [], { PATH: '/usr/bin:/bin' });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('CHECK FAILED');
    expect(run.stderr).toContain('The permission doctor could not run');
  });
});

describe('a directory given to a per-file wrapper', () => {
  it.each([
    'import-order.sh',
    'full-word-identifiers.sh',
    'screen-imports.sh',
    'feature-imports.sh',
    'blank-line-separation.sh',
    'comment-line-width.sh',
  ])('%s exits 2 and says it takes a file', (wrapper) => {
    const directory = createTemporaryDirectory('wrapper-missing-path-');
    const run = runWrapper(wrapper, [directory]);

    expectRefusal(run, directory);
    expect(run.stderr).toContain('takes a file');
  });
});
