import { join } from 'node:path';
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

describe('a project-wide root override at a missing directory', () => {
  it.each([
    ['import-order.sh', 'IMPORT_ORDER_SRC_ROOT'],
    ['full-word-identifiers.sh', 'FULL_WORD_IDENTIFIERS_SRC_ROOT'],
    ['screen-imports.sh', 'SCREEN_IMPORTS_SOURCE_ROOT'],
    ['feature-imports.sh', 'FEATURE_IMPORTS_SOURCE_ROOT'],
    ['blank-line-separation.sh', 'BLANK_LINE_SOURCE_ROOT'],
    ['comment-line-width.sh', 'COMMENT_LINE_WIDTH_SOURCE_ROOT'],
  ])('%s exits 2 and names the path (%s)', (wrapper, variable) => {
    const missingRoot = join(createTemporaryDirectory('wrapper-missing-path-'), 'no-such-root');

    expectRefusal(runWrapper(wrapper, [], { [variable]: missingRoot }), missingRoot);
  });
});

describe('a deleted path in the file list', () => {
  it.each([
    'import-order.sh',
    'full-word-identifiers.sh',
    'screen-imports.sh',
    'feature-imports.sh',
    'blank-line-separation.sh',
    'dup.sh',
    'override-guard.sh',
    'secrets.sh',
  ])('%s exits 2 and names the path', (wrapper) => {
    const deleted = join(createTemporaryDirectory('wrapper-missing-path-'), 'src/deleted.ts');

    expectRefusal(runWrapper(wrapper, [deleted]), deleted);
  });

  it('secrets.sh exits 2 and names a missing directory', () => {
    const missingDirectory = join(createTemporaryDirectory('wrapper-missing-path-'), 'no-such-dir');

    expectRefusal(runWrapper('secrets.sh', [missingDirectory]), missingDirectory);
  });
});

describe('a directory given to a per-file wrapper', () => {
  it.each([
    'import-order.sh',
    'full-word-identifiers.sh',
    'screen-imports.sh',
    'feature-imports.sh',
    'blank-line-separation.sh',
  ])('%s exits 2 and says it takes a file', (wrapper) => {
    const directory = createTemporaryDirectory('wrapper-missing-path-');
    const run = runWrapper(wrapper, [directory]);

    expectRefusal(run, directory);
    expect(run.stderr).toContain('takes a file');
  });
});
