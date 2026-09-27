import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// scripts/checks/mutation.sh refuses to start Stryker when more than 30 source
// files would be mutated: a whole-release run once took 10 h 16 min with no
// result. These build a throwaway git repo, copy the real mutation.sh + _lib.sh
// into it, and run it against an argument-capturing stub, so the cap is proven
// without a real mutation run.
const SCRIPT = join(__dirname, '../scripts/checks/mutation.sh');
const LIB = join(__dirname, '../scripts/checks/_lib.sh');

const ARGUMENT_STUB = [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$@" >> "$KIKO_STUB_ARGS"',
  'exit 0',
].join('\n');

const gitq = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
};

const writeFile = (root: string, relativePath: string, body: string): void => {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, body);
};

const copyScripts = (root: string): string => {
  const script = join(root, 'scripts/checks/mutation.sh');
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(SCRIPT, script);
  copyFileSync(LIB, join(root, 'scripts/checks/_lib.sh'));

  return script;
};

const writeSources = (root: string, prefix: string, count: number): void => {
  for (let index = 0; index < count; index += 1) {
    writeFile(root, `src/${prefix}-${index}.ts`, `export const value${index} = ${index};\n`);
  }
};

// `main` holds one source file; `feature` adds `changedCount` mutable source files.
const buildRepo = (changedCount: number): { root: string; script: string } => {
  const root = mkdtempSync(join(tmpdir(), 'kiko-mutcap-'));
  gitq(root, 'init', '-q', '-b', 'main');
  gitq(root, 'config', 'user.email', 'test@example.com');
  gitq(root, 'config', 'user.name', 'Test');
  const script = copyScripts(root);
  writeFile(root, 'src/keep.ts', 'export const kept = 1;\n');
  gitq(root, 'add', '-A');
  gitq(root, 'commit', '-qm', 'base');
  gitq(root, 'checkout', '-q', '-b', 'feature');
  writeSources(root, 'changed', changedCount);
  gitq(root, 'add', '-A');
  gitq(root, 'commit', '-qm', 'feature change');

  return { root, script };
};

type CapRun = { code: number | null; stderr: string; args: string[] | null };

const runScript = (script: string, environment: Record<string, string>): CapRun => {
  const stubDirectory = mkdtempSync(join(tmpdir(), 'kiko-mutcap-stub-'));
  const argumentsFile = join(stubDirectory, 'args');
  const stub = join(stubDirectory, 'stub');
  writeFileSync(stub, ARGUMENT_STUB, { mode: 0o755 });
  chmodSync(stub, 0o755);

  const result = spawnSync('bash', [script], {
    cwd: dirname(dirname(dirname(script))),
    env: {
      ...process.env,
      KIKO_MUTATION_BIN: stub,
      KIKO_STUB_ARGS: argumentsFile,
      TMPDIR: mkdtempSync(join(tmpdir(), 'kiko-mutcap-state-')),
      ...environment,
    },
    encoding: 'utf8',
  });

  const args = existsSync(argumentsFile)
    ? readFileSync(argumentsFile, 'utf8').split('\n').filter(Boolean)
    : null;

  return { code: result.status, stderr: result.stderr, args };
};

const mutatedFiles = (args: string[] | null): string[] =>
  (args ?? [])
    .find((argument) => argument.startsWith('--mutate='))
    ?.slice('--mutate='.length)
    .split(',') ?? [];

const expectCapFailure = (result: CapRun, count: number): void => {
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('CHECK FAILED: Stryker');
  expect(result.stderr).toContain(`${count} files would be mutated (> 30).`);
  expect(result.stderr).toContain('10 h 16 min');
  expect(result.stderr).toContain('KIKO_MUTATION_BASE');
  expect(result.stderr).toContain('No env override to skip the cap');
  // Stryker never started.
  expect(result.args).toBeNull();
};

describe('scripts/checks/mutation.sh file cap', () => {
  it.each([29, 30])('runs Stryker when %i changed files would be mutated', (count) => {
    const { script } = buildRepo(count);

    const result = runScript(script, { KIKO_MUTATION_BASE: 'main' });

    expect(result.code).toBe(0);
    expect(result.args).toContain('run');
    expect(mutatedFiles(result.args)).toHaveLength(count);
  });

  it('fails with exit 2 and the structured block, without Stryker, at 31 files', () => {
    const { script } = buildRepo(31);

    expectCapFailure(runScript(script, { KIKO_MUTATION_BASE: 'main' }), 31);
  });

  it('counts only the files left after the test, fixture, barrel, and styles excludes', () => {
    const { root, script } = buildRepo(30);
    writeFile(root, 'src/changed-0.test.ts', 'test("x", () => {});\n');
    writeFile(root, 'rules/fixtures/bad.ts', 'export const bad = 1;\n');
    writeFile(root, 'src/feature/index.ts', "export * from './feature';\n");
    writeFile(root, 'src/feature/feature.styles.ts', 'export const styles = {};\n');
    gitq(root, 'add', '-A');
    gitq(root, 'commit', '-qm', 'excluded files');

    const result = runScript(script, { KIKO_MUTATION_BASE: 'main' });

    expect(result.code).toBe(0);
    expect(mutatedFiles(result.args)).toHaveLength(30);
  });

  it('KIKO_MUTATION_FULL=1 hits the same cap when the whole project has more than 30 files', () => {
    // The feature diff alone is 1 file; the whole project is 31.
    const { root, script } = buildRepo(1);
    writeSources(root, 'project', 29);
    gitq(root, 'add', '-A');
    gitq(root, 'commit', '-qm', 'more project files');

    expectCapFailure(runScript(script, { KIKO_MUTATION_FULL: '1' }), 31);
  });

  it('KIKO_MUTATION_FULL=1 still runs Stryker on a whole project at the cap', () => {
    const { script } = buildRepo(29);

    const result = runScript(script, { KIKO_MUTATION_FULL: '1' });

    expect(result.code).toBe(0);
    expect(result.args).toContain('run');
  });

  it('an unresolvable base falls back to the whole project and hits the same cap', () => {
    const { script } = buildRepo(31);

    expectCapFailure(runScript(script, { KIKO_MUTATION_BASE: 'no-such-branch' }), 32);
  });

  it('no env var raises the cap', () => {
    const { script } = buildRepo(31);

    const result = runScript(script, {
      KIKO_MUTATION_BASE: 'main',
      MUTATION_FILE_CAP: '1000',
    });

    expectCapFailure(result, 31);
  });

  it('fails closed, without Stryker, when the whole-project file list cannot be read', () => {
    const root = mkdtempSync(join(tmpdir(), 'kiko-mutcap-nogit-'));
    const script = copyScripts(root);
    writeSources(root, 'loose', 2);

    const result = runScript(script, { KIKO_MUTATION_FULL: '1' });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: Stryker');
    expect(result.args).toBeNull();
  });
});
