import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/kill-guard-probe.sh runs one SENTINEL probe in a real bash
// or zsh. A probe names `kg_sentinel_target` wherever a kill command would
// be, and a scratch folder wherever the main checkout would be; the sentinel
// and git are stubs first on PATH that only log what they received. No real
// command has the sentinel's name, so an escape past the stubs finds nothing
// to run. The runner refuses any text that names a kill command or the real
// main checkout.
//
// Every text these tests pass is harmless even with a broken runner: the
// sentinel runs nothing real, git only runs in a scratch folder, and each
// refused text only prints or looks a name up.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard-probe.sh');
const SENTINEL = 'kg_sentinel_target';
const SHELLS = ['bash', 'zsh'];
// The runner refuses any text holding the letters of a kill command, a
// folder name included.
const SCRATCH_MAIN = mkdtempSync(join(tmpdir(), 'guard-probe-main-'));

const runProbe = (shell: string, probe: string): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT, shell, probe], { encoding: 'utf8', timeout: 30_000 });

const expectStub = (result: SpawnSyncReturns<string>, call: string): void => {
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`STUB ${call}`);
  expect(result.stdout).toMatch(/^EXIT \d+$/m);
};

describe('scripts/checks/kill-guard-probe.sh (sentinel probe runner)', () => {
  it.each(SHELLS)('sends a line-continued sentinel to the stub in %s', (shell) => {
    expectStub(runProbe(shell, 'kg_senti\\\nnel_target -x'), `${SENTINEL} -x`);
  });

  it.each(SHELLS)('sends a sentinel run by a child shell to the stub in %s', (shell) => {
    const result = runProbe(shell, `bash -c '${SENTINEL} -y'; sh -c '${SENTINEL} -z'`);

    expectStub(result, `${SENTINEL} -y`);
    expect(result.stdout).toContain(`STUB ${SENTINEL} -z`);
  });

  it.each(SHELLS)('sends git to the stub, in the folder the probe chose, in %s', (shell) => {
    const result = runProbe(shell, `cd ${SCRATCH_MAIN} && git merge feat/x`);

    expectStub(result, `git cwd=${SCRATCH_MAIN} merge feat/x`);
  });

  it.each([
    'type -t kill',
    'command -v pkill',
    'echo KILLALL',
    'echo pk\\\nill',
    "echo pk''ill",
    'echo /Users/drizzer14/Developer/Projects/pff-ios',
    'echo ~/developer/projects/PFF-IOS',
  ])('refuses text that names a kill command or the main checkout: %s', (probe) => {
    const result = runProbe('bash', probe);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refused');
    expect(result.stdout).toBe('');
  });

  it('refuses a shell other than bash or zsh', () => {
    expect(runProbe('sh', 'true').status).toBe(2);
  });
});
