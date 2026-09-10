import { execFileSync, spawnSync } from 'node:child_process';
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

// scripts/checks/mutation.sh (the check:deep mutation step) must STREAM Stryker's
// output to stdout live while preserving the exit code AND the structured failure
// block. It is manual and NOT hook-wired, so the "silent on success" hook
// contract does not apply — a passing run's output is meant to reach stdout.
//
// The real Stryker run takes minutes, so these drive the wrapper against a fast
// STUB binary via the KIKO_MUTATION_BIN seam, and point TMPDIR at a fresh dir so
// the content-dedup skip and the single-flight lock start clean.
const SCRIPT = join(__dirname, '../scripts/checks/mutation.sh');

type Run = { code: number | null; stdout: string; stderr: string };

const makeStub = (tmp: string, body: string): string => {
  const bin = join(tmp, 'stryker-stub');
  writeFileSync(bin, body, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return bin;
};

// The streaming tests force the whole-project path (KIKO_MUTATION_FULL=1) so
// they are independent of the diff-scoping (tested separately, in its own
// hermetic git repo below).
const run = (bin: string, tmp: string, callLog: string): Run => {
  const result = spawnSync('bash', [SCRIPT], {
    env: {
      ...process.env,
      KIKO_MUTATION_BIN: bin,
      KIKO_MUTATION_FULL: '1',
      TMPDIR: tmp,
      KIKO_STUB_CALLS: callLog,
    },
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

// A stub that records each invocation (so a dedup test can count calls), prints
// two distinctive lines, then exits with the given code.
const stubBody = (exitCode: number): string =>
  [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$$" >> "$KIKO_STUB_CALLS"',
    'echo "STRYKER-STREAM-LINE-1"',
    'echo "STRYKER-STREAM-LINE-2"',
    `exit ${exitCode}`,
  ].join('\n');

const freshTmp = (): string => mkdtempSync(join(tmpdir(), 'kiko-mut-'));

const callCount = (callLog: string): number =>
  readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length;

describe('scripts/checks/mutation.sh streaming', () => {
  it('streams the Stryker output to stdout on a PASSING run (not swallowed)', () => {
    const tmp = freshTmp();
    const callLog = join(tmp, 'calls');
    const bin = makeStub(tmp, stubBody(0));

    const result = run(bin, tmp, callLog);

    expect(result.code).toBe(0);
    // The core regression: a passing run used to capture the output into a
    // variable and print nothing. It must now reach stdout live.
    expect(result.stdout).toContain('STRYKER-STREAM-LINE-1');
    expect(result.stdout).toContain('STRYKER-STREAM-LINE-2');
  });

  it('prints the tail -f watch command and writes the streamed output to that progress log', () => {
    const tmp = freshTmp();
    const callLog = join(tmp, 'calls');
    const bin = makeStub(tmp, stubBody(0));

    const result = run(bin, tmp, callLog);

    expect(result.code).toBe(0);
    // The wrapper prints the exact command a human runs to watch the run live.
    expect(result.stdout).toContain('Watch live progress:  tail -f ');
    const match = result.stdout.match(/Watch live progress: {2}tail -f (\S+)/);
    expect(match).not.toBeNull();
    const logPath = (match as RegExpMatchArray)[1];
    // It is a stable, tailable file (under the mutation state dir), and the
    // streamed Stryker output was tee'd into it — so `tail -f` shows the run.
    expect(logPath).toContain('/mutation/progress.log');
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, 'utf8')).toContain('STRYKER-STREAM-LINE-1');
  });

  it('prints the no-history estimate on the first run and records that completed run', () => {
    const tmp = freshTmp();
    const callLog = join(tmp, 'calls');
    const bin = makeStub(tmp, stubBody(0));

    const result = run(bin, tmp, callLog);

    expect(result.code).toBe(0);
    // With no prior runs the wrapper says so plainly rather than inventing an ETA.
    expect(result.stdout).toContain('No mutation history yet');
    // A completed run is appended to the history TSV so the NEXT run can estimate.
    const match = result.stdout.match(/Watch live progress: {2}tail -f (\S+)/);
    expect(match).not.toBeNull();
    const historyFile = (match as RegExpMatchArray)[1].replace('progress.log', 'history.tsv');
    expect(existsSync(historyFile)).toBe(true);
    // Record shape: iso<TAB>duration<TAB>count<TAB>score — a numeric duration field.
    expect(readFileSync(historyFile, 'utf8').split('\t')[1]).toMatch(/^\d+$/);
  });

  it('streams the output, prints the failure block, and exits 2 on a FAILING run', () => {
    const tmp = freshTmp();
    const callLog = join(tmp, 'calls');
    const bin = makeStub(tmp, stubBody(1));

    const result = run(bin, tmp, callLog);

    expect(result.code).toBe(2);
    // Output is streamed to stdout (not only echoed inside the block)...
    expect(result.stdout).toContain('STRYKER-STREAM-LINE-1');
    // ...and the structured failure block still prints to stderr.
    expect(result.stderr).toContain('CHECK FAILED: Stryker');
    expect(result.stderr).toContain('STRYKER-STREAM-LINE-1');
  });

  it('records a pass so an identical second run is content-deduped (Stryker not re-run)', () => {
    const tmp = freshTmp();
    const callLog = join(tmp, 'calls');
    const bin = makeStub(tmp, stubBody(0));

    const first = run(bin, tmp, callLog);
    const second = run(bin, tmp, callLog);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    // The single-flight + content-dedup machinery is preserved: the second,
    // identical run skips without invoking Stryker again.
    expect(callCount(callLog)).toBe(1);
  });

  it('does NOT record a skip on a FAILING run, so it re-runs next time', () => {
    const tmp = freshTmp();
    const callLog = join(tmp, 'calls');
    const bin = makeStub(tmp, stubBody(1));

    run(bin, tmp, callLog);
    run(bin, tmp, callLog);

    // A skip is only recorded on a PASS, so a failing check always re-runs.
    expect(callCount(callLog)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Diff scoping: check:deep mutates only the source files THIS branch changed
// vs the merge-base with $KIKO_MUTATION_BASE, not the whole project. These build
// a throwaway git repo, copy the real mutation.sh + _lib.sh into it, and run it
// there against an argument-capturing stub — so the merge-base/diff/exclude/
// --mutate logic is exercised for real, deterministically.
// ---------------------------------------------------------------------------

const gitq = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
};

const writeFile = (root: string, rel: string, body: string): void => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

// The stub records every argument it is invoked with (one per line) so a test
// can assert the exact --mutate list Stryker would receive.
const ARG_STUB = ['#!/usr/bin/env bash', 'printf "%s\\n" "$@" >> "$KIKO_STUB_ARGS"', 'exit 0'].join(
  '\n',
);

// Build a repo with `main` holding one source file, then a `feature` branch that
// adds a mutable source file plus a test file and a fixture file (both excluded).
const buildRepo = (): { root: string; script: string } => {
  const root = mkdtempSync(join(tmpdir(), 'kiko-mutrepo-'));
  gitq(root, 'init', '-q', '-b', 'main');
  gitq(root, 'config', 'user.email', 'test@example.com');
  gitq(root, 'config', 'user.name', 'Test');

  copyFileSync(SCRIPT, mkAndReturn(root, 'scripts/checks/mutation.sh'));
  copyFileSync(
    join(__dirname, '../scripts/checks/_lib.sh'),
    mkAndReturn(root, 'scripts/checks/_lib.sh'),
  );

  writeFile(root, 'src/keep.ts', 'export const a = 1;\n');
  gitq(root, 'add', '-A');
  gitq(root, 'commit', '-qm', 'base');

  gitq(root, 'checkout', '-q', '-b', 'feature');
  writeFile(root, 'src/changed.ts', 'export const b = 2;\n');
  writeFile(root, 'src/changed.test.ts', 'test("x", () => {});\n');
  writeFile(root, 'rules/fixtures/bad.ts', 'export const c = 3;\n');
  gitq(root, 'add', '-A');
  gitq(root, 'commit', '-qm', 'feature change');

  return { root, script: join(root, 'scripts/checks/mutation.sh') };
};

// Ensure a destination directory exists and return its path (for copyFileSync).
function mkAndReturn(root: string, rel: string): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  return abs;
}

type DiffRun = { code: number | null; args: string[] | null };

const runInRepo = (script: string, env: Record<string, string>): DiffRun => {
  const root = dirname(dirname(dirname(script)));
  const argsFile = join(mkdtempSync(join(tmpdir(), 'kiko-args-')), 'args');
  const stub = join(dirname(argsFile), 'stub');
  writeFileSync(stub, ARG_STUB, { mode: 0o755 });
  chmodSync(stub, 0o755);

  const result = spawnSync('bash', [script], {
    cwd: root,
    env: {
      ...process.env,
      KIKO_MUTATION_BIN: stub,
      KIKO_STUB_ARGS: argsFile,
      TMPDIR: mkdtempSync(join(tmpdir(), 'kiko-state-')),
      ...env,
    },
    encoding: 'utf8',
  });

  const args = existsSync(argsFile)
    ? readFileSync(argsFile, 'utf8').split('\n').filter(Boolean)
    : null;
  return { code: result.status, args };
};

describe('scripts/checks/mutation.sh diff scoping', () => {
  it('mutates only the source files changed vs the base, excluding tests and fixtures', () => {
    const { script } = buildRepo();
    // On `feature`, changed vs `main`: src/changed.ts, src/changed.test.ts,
    // rules/fixtures/bad.ts. Only src/changed.ts is a mutable source file.
    const result = runInRepo(script, { KIKO_MUTATION_BASE: 'main' });

    expect(result.code).toBe(0);
    expect(result.args).not.toBeNull();
    const mutate = (result.args ?? []).find((arg) => arg.startsWith('--mutate='));
    expect(mutate).toBeDefined();
    expect(mutate).toContain('src/changed.ts');
    expect(mutate).not.toContain('src/changed.test.ts');
    expect(mutate).not.toContain('rules/fixtures/bad.ts');
    expect(mutate).not.toContain('src/keep.ts');
  });

  it('passes cleanly (exit 0) without invoking Stryker when nothing changed vs the base', () => {
    const { script } = buildRepo();
    // Run from `main` itself: merge-base(main, HEAD=main) = main, empty diff.
    const root = dirname(dirname(dirname(script)));
    gitq(root, 'checkout', '-q', 'main');

    const result = runInRepo(script, { KIKO_MUTATION_BASE: 'main' });

    expect(result.code).toBe(0);
    expect(result.args).toBeNull(); // the stub never ran
  });

  it('passes cleanly without Stryker when only test/fixture files changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'kiko-mutrepo-'));
    gitq(root, 'init', '-q', '-b', 'main');
    gitq(root, 'config', 'user.email', 'test@example.com');
    gitq(root, 'config', 'user.name', 'Test');
    copyFileSync(SCRIPT, mkAndReturn(root, 'scripts/checks/mutation.sh'));
    copyFileSync(
      join(__dirname, '../scripts/checks/_lib.sh'),
      mkAndReturn(root, 'scripts/checks/_lib.sh'),
    );
    writeFile(root, 'src/keep.ts', 'export const a = 1;\n');
    gitq(root, 'add', '-A');
    gitq(root, 'commit', '-qm', 'base');
    gitq(root, 'checkout', '-q', '-b', 'feature');
    // ONLY a test file changes — the exclusion filter empties the set.
    writeFile(root, 'src/keep.test.ts', 'test("x", () => {});\n');
    gitq(root, 'add', '-A');
    gitq(root, 'commit', '-qm', 'test only');

    const result = runInRepo(join(root, 'scripts/checks/mutation.sh'), {
      KIKO_MUTATION_BASE: 'main',
    });

    expect(result.code).toBe(0);
    expect(result.args).toBeNull();
  });

  it('KIKO_MUTATION_FULL=1 runs the whole project with no --mutate flag', () => {
    const { script } = buildRepo();

    const result = runInRepo(script, { KIKO_MUTATION_FULL: '1' });

    expect(result.code).toBe(0);
    expect(result.args).not.toBeNull();
    expect(result.args).toContain('run');
    expect((result.args ?? []).some((arg) => arg.startsWith('--mutate'))).toBe(false);
  });
});
