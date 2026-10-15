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
  ])('runs in %s the spelling %s when it is not refused', (shell, probe, call) => {
    expectStub(runProbe(shell, probe), call);
  });

  // A glob, an ANSI-C escape, an expansion inside a word, or a brace
  // alternative lets the shell rebuild a word the text never spells out.
  it.each([
    'kg_sentinel_tar?et -x',
    'kg_sentinel_tar*et -x',
    'kg_sentinel_tar[g]et -x',
    "$'kg_sentinel_t\\x61rget' -x",
    "$'kg_sentinel_t\\141rget' -x",
    "$'kg_sentinel_t\\u0061rget' -x",
    'kg_sentinel_targ$@et -x',
    `kg_sentinel_targ\${@}et -x`,
    'kg_sentinel_targ$(:)et -x',
    'kg_sentinel_targ$( )et -x',
    'kg_sentinel_targ`:`et -x',
    'kg_sentinel_targ"$(echo e)"t -x',
    '$(:)kg_sentinel_target -x',
    `kg_sentinel_targ\${unset}et -x`,
    'kg_sentinel_tar{g,x}et -x',
    'kg_sentinel_tar{g..g}et -x',
    'cd /tmp/kg/fake{_,}main',
  ])('refuses a spelling the shell rebuilds: %s', (probe) => {
    const result = runProbe('bash', probe, REFUSE_ALSO);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refused');
    expect(result.stdout).toBe('');
  });

  it.each(SHELLS)('runs a command substitution that stands alone as a word in %s', (shell) => {
    const result = runProbe(shell, `${SENTINEL} "$(printf a)" $(printf b)`);

    expectStub(result, `${SENTINEL} a b`);
  });

  // The stub's first exec of a never-seen script can wait seconds on macOS
  // (XProtect); the runner warms each stub before its alarm starts, so the
  // alarm bounds only the probe's own work. The seam makes a stub sleep on
  // its first call only, which stands in for that wait.
  describe('first-exec delay of a stub', () => {
    const SLOW_FIRST_EXEC = { KIKO_PROBE_TIMEOUT: '1', KIKO_PROBE_STUB_FIRST_RUN_DELAY: '2' };

    it.each(SHELLS)('does not count a stub first-exec delay against the alarm in %s', (shell) => {
      const result = runProbe(
        shell,
        `bash -c '${SENTINEL} -y'; sh -c '${SENTINEL} -z'`,
        SLOW_FIRST_EXEC,
      );

      expectStub(result, `${SENTINEL} -y`);
      expect(result.stdout).toContain(`STUB ${SENTINEL} -z`);
      expect(result.stdout).toMatch(/^EXIT 0$/m);
    });

    it.each(SHELLS)('does not count a git first-exec delay against the alarm in %s', (shell) => {
      const result = runProbe(shell, `cd ${SCRATCH_MAIN} && git merge feat/x`, SLOW_FIRST_EXEC);

      expectStub(result, `git cwd=${SCRATCH_MAIN} merge feat/x`);
      expect(result.stdout).toMatch(/^EXIT 0$/m);
    });

    // A busy loop, not `sleep`: a sleep child would hold the output pipe
    // until the reader's own alarm (limit + 2 s) and hide the early stop.
    it.each(SHELLS)('stops a probe that runs past the limit, on time, in %s', (shell) => {
      const started = Date.now();
      const result = runProbe(shell, 'while true; do :; done', { KIKO_PROBE_TIMEOUT: '1' });

      expect(Date.now() - started).toBeLessThan(3000);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^EXIT 142$/m);
    });

    it.each(SHELLS)('keeps the warm-up call out of the log in %s', (shell) => {
      const result = runProbe(shell, 'true', { KIKO_PROBE_STUB_FIRST_RUN_DELAY: '0' });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe('EXIT 0\n');
    });
  });

  it('refuses a shell other than bash or zsh', () => {
    expect(runProbe('sh', 'true').status).toBe(2);
  });
});
