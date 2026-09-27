import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';

// scripts/checks/kill-guard-probe.sh runs one kill-guard probe string in a
// real bash or zsh, with pkill/killall/kill/xargs stubbed first on PATH and
// the shell's kill builtin disabled, and prints what the stubs received. A
// reviewer probe once ran a real pkill because its runner only rewrote the
// word `pkill`, and `pk\<newline>ill` slipped past that rewrite.
//
// This test must never send a real signal, even with a broken runner:
// every probe uses signal 0 (or killall's `-s`, which only prints) against
// a process name or pid that does not exist, and the test puts its own
// stubs first on PATH before the runner starts.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard-probe.sh');
const NO_SUCH_PROCESS = `kiko-probe-no-such-process-${process.pid}`;
const NO_SUCH_PID = '4194303';
const SHELLS = ['bash', 'zsh'];

const fallback = mkdtempSync(join(tmpdir(), 'kill-guard-probe-test-'));
const FALLBACK_LOG = join(fallback, 'stub.log');
writeFileSync(FALLBACK_LOG, '');

for (const name of ['pkill', 'killall', 'kill', 'xargs']) {
  const stub = join(fallback, name);
  writeFileSync(stub, `#!/bin/sh\necho "${name} $*" >> '${FALLBACK_LOG}'\nexit 0\n`);
  chmodSync(stub, 0o755);
}

const runProbe = (
  shell: string,
  probe: string,
  environment: Record<string, string> = {},
): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT, shell, probe], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, PATH: `${fallback}:${process.env.PATH}`, ...environment },
  });

const expectOnlyTheRunnerStubs = (result: SpawnSyncReturns<string>, call: string): void => {
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`STUB ${call}`);
  expect(result.stdout).toMatch(/^EXIT \d+$/m);
  expect(readFileSync(FALLBACK_LOG, 'utf8')).toBe('');
};

describe('scripts/checks/kill-guard-probe.sh (safe probe runner)', () => {
  it.each(SHELLS)('sends a line-continued pkill to the stub in %s', (shell) => {
    const result = runProbe(shell, `pk\\\nill -0 -f ${NO_SUCH_PROCESS}`);

    expectOnlyTheRunnerStubs(result, `pkill -0 -f ${NO_SUCH_PROCESS}`);
  });

  it.each(SHELLS)('sends the kill builtin to the stub in %s', (shell) => {
    const result = runProbe(shell, `kill -0 ${NO_SUCH_PID}`);

    expectOnlyTheRunnerStubs(result, `kill -0 ${NO_SUCH_PID}`);
  });

  it.each(SHELLS)('sends killall and xargs to the stubs in %s', (shell) => {
    const result = runProbe(
      shell,
      `killall -s ${NO_SUCH_PROCESS}; echo ${NO_SUCH_PID} | xargs kill -0`,
    );

    expectOnlyTheRunnerStubs(result, `killall -s ${NO_SUCH_PROCESS}`);
    expect(result.stdout).toContain('STUB xargs kill -0');
  });

  it.each(SHELLS)('sends git to a stub in a scratch directory in %s', (shell) => {
    const result = runProbe(shell, 'git stash list; pwd > here.txt; git -C "$PWD" status');

    expectOnlyTheRunnerStubs(result, 'git stash list');
    expect(result.stdout).toMatch(/^STUB git -C \S*kill-guard-probe\.\S+\/cwd status$/m);
  });

  it.each(SHELLS)('refuses a probe that names a kill binary by path in %s', (shell) => {
    const result = runProbe(shell, `/usr/bin/pkill -0 -f ${NO_SUCH_PROCESS}`);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refused');
    expect(result.stdout).not.toContain('STUB');
  });

  it.each([
    'PATH=/usr/bin pkill -0 x',
    'command -p kill -0 1',
    'enable kill',
    'builtin kill -0 1',
    'env -i pkill -0 x',
    'sudo pkill -0 x',
  ])('refuses a probe that could reach past the stubs: %s', (probe) => {
    const result = runProbe('bash', probe);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refused');
  });

  it.each(SHELLS)('refuses to run when the kill builtin stays enabled in %s', (shell) => {
    const result = runProbe(shell, `kill -0 ${NO_SUCH_PID}`, { KIKO_PROBE_SKIP_DISABLE: '1' });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('refused to run');
    expect(result.stdout).not.toContain('STUB');
  });

  it.each(SHELLS)('refuses to run when its stubs are not first on PATH in %s', (shell) => {
    const result = runProbe(shell, `kill -0 ${NO_SUCH_PID}`, {
      KIKO_PROBE_PATH_BEFORE_SHIMS: fallback,
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('refused to run');
    expect(result.stdout).not.toContain('STUB');
    expect(readFileSync(FALLBACK_LOG, 'utf8')).toBe('');
  });

  it('refuses a shell other than bash or zsh', () => {
    const result = runProbe('sh', 'true');

    expect(result.status).toBe(2);
  });
});
