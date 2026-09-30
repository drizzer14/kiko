import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';

import {
  writeFile,
  commitAll,
  mutatedFiles,
  writeExecutable,
  type ArgumentStubRun,
  copyMutationScripts,
  runWithArgumentStub,
  buildMutationRepository,
} from './test-support/mutation-repository';

// scripts/checks/mutation.sh refuses to start Stryker when more than 30 source
// files would be mutated, and refuses a whole-project run outright: a
// whole-release run once took 10 h 16 min with no result. The wrapper runs
// against an argument-capturing stub, so every refusal is proven without a real
// mutation run.
const sources = (prefix: string, count: number): Record<string, string> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `src/${prefix}-${index}.ts`,
      `export const value${index} = ${index};\n`,
    ]),
  );

const buildRepository = (featureFiles: Record<string, string>): { root: string; script: string } =>
  buildMutationRepository(mkdtempSync(join(tmpdir(), 'kiko-mutation-cap-')), featureFiles);

const expectRefusal = (result: ArgumentStubRun, message: string): void => {
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('CHECK FAILED: Stryker');
  expect(result.stderr).toContain(message);
  // Stryker never started.
  expect(result.stubArguments).toBeNull();
};

const expectCapFailure = (result: ArgumentStubRun, count: number): void => {
  expectRefusal(result, `${count} files would be mutated (> 30).`);
  expect(result.stderr).toContain('10 h 16 min');
  expect(result.stderr).toContain('KIKO_MUTATION_BASE');
  expect(result.stderr).toContain('No env override to skip the cap');
};

describe('scripts/checks/mutation.sh file cap', () => {
  it.each([29, 30])('runs Stryker when %i changed files would be mutated', (count) => {
    const { script } = buildRepository(sources('changed', count));

    const result = runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' });

    expect(result.code).toBe(0);
    expect(result.stubArguments).toContain('run');
    expect(mutatedFiles(result.stubArguments)).toHaveLength(count);
  });

  it('fails with exit 2 and the structured block, without Stryker, at 31 files', () => {
    const { script } = buildRepository(sources('changed', 31));

    expectCapFailure(runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' }), 31);
  });

  it('counts only the files left after the test, fixture, barrel, and styles excludes', () => {
    const { root, script } = buildRepository(sources('changed', 30));
    writeFile(root, 'src/changed-0.test.ts', 'test("x", () => {});\n');
    writeFile(root, 'rules/fixtures/bad.ts', 'export const bad = 1;\n');
    writeFile(root, 'src/feature/index.ts', "export * from './feature';\n");
    writeFile(root, 'src/feature/feature.styles.ts', 'export const styles = {};\n');
    commitAll(root, 'excluded files');

    const result = runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' });

    expect(result.code).toBe(0);
    expect(mutatedFiles(result.stubArguments)).toHaveLength(30);
  });

  it('no env var raises the cap', () => {
    const { script } = buildRepository(sources('changed', 31));

    const result = runWithArgumentStub(script, {
      KIKO_MUTATION_BASE: 'main',
      MUTATION_FILE_CAP: '1000',
    });

    expectCapFailure(result, 31);
  });

  it('refuses KIKO_MUTATION_FULL=1 directly, even when the project is one file', () => {
    const { script } = buildRepository(sources('changed', 1));

    const result = runWithArgumentStub(script, { KIKO_MUTATION_FULL: '1' });

    expectRefusal(result, 'KIKO_MUTATION_FULL=1: a whole-project run is always above the cap');
  });

  it('refuses a base that does not resolve and names it', () => {
    const { script } = buildRepository(sources('changed', 1));

    const result = runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'no-such-branch' });

    expectRefusal(result, 'KIKO_MUTATION_BASE=no-such-branch does not resolve to a commit');
  });

  it('refuses outside a git worktree, where the default base cannot resolve', () => {
    const root = mkdtempSync(join(tmpdir(), 'kiko-mutation-cap-no-git-'));
    const script = copyMutationScripts(root);
    writeFile(root, 'src/loose.ts', 'export const loose = 1;\n');

    const result = runWithArgumentStub(script, {});

    expectRefusal(result, 'KIKO_MUTATION_BASE=main does not resolve to a commit');
  });

  it('fails closed when the changed-file list cannot be read after the base resolves', () => {
    const { script } = buildRepository(sources('changed', 1));
    const realGit = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const shimDirectory = mkdtempSync(join(tmpdir(), 'kiko-mutation-cap-git-'));
    writeExecutable(
      join(shimDirectory, 'git'),
      [
        '#!/usr/bin/env bash',
        'for gitArgument in "$@"; do',
        '  [ "$gitArgument" = "--name-only" ] && exit 128',
        'done',
        `exec "${realGit}" "$@"`,
      ].join('\n'),
    );

    const result = runWithArgumentStub(script, {
      KIKO_MUTATION_BASE: 'main',
      PATH: `${shimDirectory}:${process.env.PATH ?? ''}`,
    });

    expectRefusal(result, 'Could not list the files changed since the merge-base with main');
  });

  it('never lets the dedup record of a narrower pass hide a refused scope', () => {
    const { root, script } = buildRepository(sources('changed', 31));
    writeFile(root, 'src/last.ts', 'export const last = 1;\n');
    commitAll(root, 'one more file');
    const sharedState = { TMPDIR: mkdtempSync(join(tmpdir(), 'kiko-mutation-cap-state-')) };

    const narrow = runWithArgumentStub(script, { ...sharedState, KIKO_MUTATION_BASE: 'HEAD~1' });

    expect(narrow.code).toBe(0);
    expect(mutatedFiles(narrow.stubArguments)).toEqual(['src/last.ts']);
    expectCapFailure(
      runWithArgumentStub(script, { ...sharedState, KIKO_MUTATION_BASE: 'main' }),
      32,
    );
    expectRefusal(
      runWithArgumentStub(script, { ...sharedState, KIKO_MUTATION_FULL: '1' }),
      'KIKO_MUTATION_FULL=1',
    );
  });

  it('--list prints the filtered files and the count, exits 0, and never starts Stryker', () => {
    const { root, script } = buildRepository(sources('changed', 3));
    writeFile(root, 'src/changed-0.test.ts', 'test("x", () => {});\n');
    writeFile(root, 'src/feature/index.ts', "export * from './feature';\n");
    commitAll(root, 'excluded files');

    const result = runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' }, ['--list']);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      'src/changed-0.ts\nsrc/changed-1.ts\nsrc/changed-2.ts\nmutable files: 3 (cap 30)\n',
    );
    expect(result.stubArguments).toBeNull();
  });

  it('--list prints a zero count when no mutable file changed', () => {
    const { script } = buildRepository({});

    const result = runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' }, ['--list']);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('mutable files: 0 (cap 30)\n');
  });

  it('--list over the cap prints the list, then the cap block, and exits 2', () => {
    const { script } = buildRepository(sources('changed', 31));

    const result = runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' }, ['--list']);

    expectCapFailure(result, 31);
    expect(result.stdout.split('\n').filter((line) => line.startsWith('src/'))).toHaveLength(31);
    expect(result.stdout).toContain('mutable files: 31 (cap 30)');
  });

  it('--list keeps the KIKO_MUTATION_FULL and unresolvable-base refusals', () => {
    const { script } = buildRepository(sources('changed', 1));

    expectRefusal(
      runWithArgumentStub(script, { KIKO_MUTATION_FULL: '1' }, ['--list']),
      'KIKO_MUTATION_FULL=1: a whole-project run is always above the cap',
    );
    expectRefusal(
      runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'no-such-branch' }, ['--list']),
      'KIKO_MUTATION_BASE=no-such-branch does not resolve to a commit',
    );
  });

  it('--list needs no Stryker binary', () => {
    const { root, script } = buildRepository(sources('changed', 1));

    const result = runWithArgumentStub(
      script,
      { KIKO_MUTATION_BASE: 'main', KIKO_MUTATION_BIN: join(root, 'no-such-stryker') },
      ['--list'],
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('src/changed-0.ts\nmutable files: 1 (cap 30)\n');
  });

  it('--list runs while a live run holds the global lock, and leaves that lock in place', () => {
    const { script } = buildRepository(sources('changed', 1));
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiko-mutation-cap-lock-'));
    const lockDirectory = join(temporaryDirectory, 'kiko-harness', 'mutation.global.lock');
    mkdirSync(lockDirectory, { recursive: true });
    // process.pid is this test runner, so the holder reads as alive.
    writeFileSync(join(lockDirectory, 'pid'), String(process.pid));

    const result = runWithArgumentStub(
      script,
      { KIKO_MUTATION_BASE: 'main', TMPDIR: temporaryDirectory },
      ['--list'],
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('src/changed-0.ts\nmutable files: 1 (cap 30)\n');
    expect(existsSync(join(lockDirectory, 'pid'))).toBe(true);
  });

  it('records the scope with a pass, so a wider scope at the same HEAD still runs Stryker', () => {
    const { root, script } = buildRepository(sources('changed', 2));
    writeFile(root, 'src/last.ts', 'export const last = 1;\n');
    commitAll(root, 'one more file');
    const sharedState = { TMPDIR: mkdtempSync(join(tmpdir(), 'kiko-mutation-cap-state-')) };

    const narrow = runWithArgumentStub(script, { ...sharedState, KIKO_MUTATION_BASE: 'HEAD~1' });
    const wide = runWithArgumentStub(script, { ...sharedState, KIKO_MUTATION_BASE: 'main' });

    expect(narrow.code).toBe(0);
    expect(wide.code).toBe(0);
    expect(mutatedFiles(wide.stubArguments)).toHaveLength(3);
  });
});
