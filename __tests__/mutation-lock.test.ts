import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// scripts/checks/mutation.sh holds a GLOBAL (machine-wide) single-flight lock so
// only ONE Stryker runs at a time across ALL worktrees — two different worktrees
// each launching Stryker overloads the machine. These prove the lock logic
// directly (a live holder, a stale holder, and release-on-exit) WITHOUT a real
// multi-minute mutation run: the wrapper drives a fast STUB via KIKO_MUTATION_BIN,
// and TMPDIR is pointed at a fresh dir so the fixed global lock path is isolated
// per test. The global lock lives at $TMPDIR/kiko-harness/mutation.global.lock.
const SCRIPT = join(__dirname, '../scripts/checks/mutation.sh');

const freshTmp = (): string => mkdtempSync(join(tmpdir(), 'kiko-lock-'));

const globalLockDir = (tmp: string): string => join(tmp, 'kiko-harness', 'mutation.global.lock');

const makeStub = (tmp: string, exitCode: number): string => {
  const bin = join(tmp, 'stryker-stub');
  const body = [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$$" >> "$KIKO_STUB_CALLS"',
    'echo "STRYKER-RAN"',
    `exit ${exitCode}`,
  ].join('\n');
  writeFileSync(bin, body, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return bin;
};

type Run = { code: number | null; stdout: string; stderr: string };

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

const stubRanCount = (callLog: string): number =>
  existsSync(callLog) ? readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length : 0;

// Pre-create the global lock dir holding <pid> as its holder, as if another
// worktree's run owned it.
const holdLock = (tmp: string, pid: string, worktree: string): string => {
  const dir = globalLockDir(tmp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pid'), pid);
  writeFileSync(join(dir, 'holder'), worktree);
  return dir;
};

// A pid that is guaranteed dead: bash -c 'echo $$' prints its own pid, then the
// subshell exits before spawnSync returns synchronously.
const deadPid = (): string =>
  spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim();

describe('scripts/checks/mutation.sh global single-flight lock', () => {
  it('FAILS FAST (exit 2) when a LIVE holder in another worktree holds the global lock', () => {
    const tmp = freshTmp();
    const callLog = join(tmp, 'calls');
    const bin = makeStub(tmp, 0);
    // process.pid is this test runner — alive for the wrapper's kill -0 check.
    const lockDir = holdLock(tmp, String(process.pid), '/some/other/worktree');

    const result = run(bin, tmp, callLog);

    expect(result.code).toBe(2);
    // The refusal names the fixed global lock path and who holds it...
    expect(result.stderr).toContain('refusing to start a second Stryker');
    expect(result.stderr).toContain(lockDir);
    expect(result.stderr).toContain('worktree /some/other/worktree');
    // ...and no second Stryker was spawned.
    expect(stubRanCount(callLog)).toBe(0);
    // The holder's lock is left intact (the refused run must not release it).
    expect(existsSync(lockDir)).toBe(true);
  });

  it('reclaims a STALE lock (holder process gone) and runs Stryker', () => {
    const tmp = freshTmp();
    const callLog = join(tmp, 'calls');
    const bin = makeStub(tmp, 0);
    holdLock(tmp, deadPid(), '/a/dead/worktree');

    const result = run(bin, tmp, callLog);

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain('refusing to start a second Stryker');
    // The stale lock was reclaimed, so Stryker ran exactly once.
    expect(stubRanCount(callLog)).toBe(1);
  });

  it('releases the global lock on normal exit (trap cleanup)', () => {
    const tmp = freshTmp();
    const callLog = join(tmp, 'calls');
    const bin = makeStub(tmp, 0);

    const result = run(bin, tmp, callLog);

    expect(result.code).toBe(0);
    // The EXIT trap removed the lock, so the next run acquires cleanly.
    expect(existsSync(globalLockDir(tmp))).toBe(false);
  });
});
