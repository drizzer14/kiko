import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/kill-guard-probe.sh runs one SENTINEL probe in a real bash
// or zsh. A probe names `kg_sentinel_target` wherever a kill command would
// be, and a scratch folder wherever the main checkout would be; the sentinel
// and git are stubs first on PATH that only log what they received. No real
// command has the sentinel's name, so a probe that escapes the stub (a
// child shell, a PATH edit) finds no sentinel to run. Real git stays
// reachable by a PATH edit or /usr/bin/git; it would run in the runner's
// empty scratch folder.
//
// These tests never hand the runner a real kill word or the real main
// checkout. The refusal rows prove each spelling with the sentinel and a
// fake folder, added to the refusal list through the runner's test-only
// KIKO_PROBE_REFUSE_ALSO; the built-in words go through the same check.
// Every text here is harmless even with a broken runner: the sentinel runs
// nothing real, and git runs only in a scratch folder.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard-probe.sh');
const SENTINEL = 'kg_sentinel_target';
const SHELLS = ['bash', 'zsh'];
// The runner refuses any text holding the letters of a kill command, a
// folder name included.
const SCRATCH_MAIN = mkdtempSync(join(tmpdir(), 'guard-probe-main-'));
const REFUSE_ALSO = { KIKO_PROBE_REFUSE_ALSO: `${SENTINEL} kg/fake_main` };

const runProbe = (
  shell: string,
  probe: string,
  environment: Record<string, string> = {},
): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT, shell, probe], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, ...environment },
  });

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
    `${SENTINEL} -x`,
    'KG_SENTINEL_TARGET -x',
    "kg_senti$''nel_target -x",
    'kg_senti$""nel_target -x',
    'kg_senti{n,}el_target -x',
    'kg_senti``nel_target -x',
    'kg_senti$()nel_target -x',
    "kg_senti'n'el_target -x",
    'kg_senti"n"el_target -x',
    'kg_senti\\nel_target -x',
    'kg_senti\\\nnel_target -x',
    'cd /tmp/kg/./fake_main',
    'cd /tmp/kg//fake_main',
    "cd /tmp/kg/fake_$''main",
    'cd /tmp/KG/Fake_Main',
  ])('refuses every spelling of a refused word: %s', (probe) => {
    const result = runProbe('bash', probe, REFUSE_ALSO);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refused');
    expect(result.stdout).toBe('');
  });

  // Without the refusal, these spellings do reach the command: the shell
  // rebuilds the word, which is why the refusal has to see through them.
  it.each([
    ['bash', "kg_senti$''nel_target -x", `${SENTINEL} -x`],
    ['zsh', "kg_senti$''nel_target -x", `${SENTINEL} -x`],
    ['bash', 'kg_senti{n,}el_target -x', `${SENTINEL} kg_sentiel_target -x`],
  ])('runs in %s the spelling %s when it is not refused', (shell, probe, call) => {
    expectStub(runProbe(shell, probe), call);
  });

  it('refuses a shell other than bash or zsh', () => {
    expect(runProbe('sh', 'true').status).toBe(2);
  });
});
