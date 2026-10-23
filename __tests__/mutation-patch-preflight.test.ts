import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import {
  PATCH_MARKER,
  RUNNER_PACKAGE,
  PATCHED_RUNNER_FILES,
} from './test-support/stryker-jest-runner';
import {
  type ArgumentStubRun,
  runWithArgumentStub,
  buildMutationRepository,
} from './test-support/mutation-repository';

// scripts/checks/mutation.sh refuses to start Stryker when the installed jest runner lacks the
// exact-selection patch: postinstall runs patch-package --error-on-fail, so a failed apply fails
// npm ci, but a tree installed with --ignore-scripts would otherwise turn every heavy mutant back
// into a regex timeout without a word.
const runnerFile = (root: string, file: string): string =>
  join(root, 'node_modules', RUNNER_PACKAGE, file);

const buildRepository = (): { root: string; script: string } =>
  buildMutationRepository(mkdtempSync(join(tmpdir(), 'kiko-mutation-patch-')), {
    'src/changed.ts': 'export const changed = 1;\n',
  });

const expectPreflightFailure = (result: ArgumentStubRun): void => {
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('CHECK FAILED: Stryker');
  expect(result.stderr).toContain(PATCH_MARKER);
  expect(result.stderr).toContain('npm ci');
  expect(result.stderr).toContain('patch-package');
  // Stryker never started.
  expect(result.stubArguments).toBeNull();
};

describe('scripts/checks/mutation.sh patched-runner preflight', () => {
  it('runs Stryker when both patched runner files carry the marker', () => {
    const { script } = buildRepository();

    const result = runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' });

    expect(result.code).toBe(0);
    expect(result.stubArguments).toContain('run');
  });

  it.each(PATCHED_RUNNER_FILES)('exits 2 before Stryker when %s lacks the marker', (file) => {
    const { root, script } = buildRepository();
    writeFileSync(runnerFile(root, file), '// unpatched upstream file\n');

    expectPreflightFailure(runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' }));
  });

  it.each(PATCHED_RUNNER_FILES)('exits 2 before Stryker when %s is missing', (file) => {
    const { root, script } = buildRepository();
    rmSync(runnerFile(root, file));

    expectPreflightFailure(runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' }));
  });

  it('exits 2 before Stryker when the jest runner is not installed at all', () => {
    const { root, script } = buildRepository();
    rmSync(join(root, 'node_modules', RUNNER_PACKAGE), { recursive: true });

    expectPreflightFailure(runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' }));
  });
});
