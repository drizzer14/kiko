import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const run = (bin: string, tmp: string, callLog: string): Run => {
  const result = spawnSync('bash', [SCRIPT], {
    env: { ...process.env, KIKO_MUTATION_BIN: bin, TMPDIR: tmp, KIKO_STUB_CALLS: callLog },
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
