import {
  mkdirSync,
  existsSync,
  mkdtempSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  writeStrykerStub,
  mutationStateFile,
  wrapperEnvironment,
  buildMutationRepository,
} from './test-support/mutation-repository';
import { HIGH_LOAD, LOW_LOAD, sysctlCallCount, writeSysctlStub } from './test-support/sysctl-stub';

// When a gate fails on TIMEOUT-HEAVY alone, scripts/checks/mutation.sh reruns the timed-out
// mutants inside the same gate: it removes them from reports/stryker-incremental.json, waits for a
// quiet machine, runs Stryker once more with `--concurrency 1`, and scores that final report. A
// stub Stryker answers the two calls: the first writes a report and the incremental file, the
// second records the incremental file it was given and writes the rerun report.
const ENTRY = 'src/changed.ts:1-1';
const WAIT_LOAD = join(__dirname, '../scripts/wait-load.sh');

type Row = [identifier: string, status: string];

const rows = (statuses: string[], firstIdentifier = 1): Row[] =>
  statuses.map((status, offset) => [String(firstIdentifier + offset), status]);

const reportOf = (mutants: Row[], scope: string[] = [ENTRY]): string =>
  JSON.stringify({
    config: { mutate: scope },
    files: {
      'src/changed.ts': {
        mutants: mutants.map(([identifier, status]) => ({
          id: identifier,
          status,
          location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
        })),
      },
    },
  });

const incrementalOf = (mutants: Row[]): string =>
  JSON.stringify({
    schemaVersion: '1',
    testFiles: {},
    files: {
      'src/changed.ts': {
        language: 'typescript',
        source: 'export const changed = 1;\n',
        mutants: mutants.map(([identifier, status]) => ({ id: identifier, status })),
      },
      'src/other.ts': {
        language: 'typescript',
        source: 'export const other = 2;\n',
        mutants: [{ id: '900', status: 'Killed' }],
      },
    },
  });

const STUB = [
  '#!/usr/bin/env bash',
  'state="$KIKO_STUB_STATE"',
  'count="$(( $(cat "$state/count" 2>/dev/null || echo 0) + 1 ))"',
  'printf "%s" "$count" > "$state/count"',
  'printf "%s\\n" "$*" >> "$state/arguments"',
  'mkdir -p reports/mutation',
  'if [ "$count" -eq 1 ]; then',
  '  sleep 1',
  '  echo "10/50 tested (3 survived, 4 timed out)"',
  '  echo "FIRST-STUB-OUTPUT"',
  '  cp "$state/first.json" reports/mutation/mutation.json',
  '  [ ! -e "$state/incremental.json" ] || cp "$state/incremental.json" reports/stryker-incremental.json',
  '  exit 0',
  'fi',
  'cp reports/stryker-incremental.json "$state/seen-incremental.json" 2>/dev/null',
  'echo "2/2 tested (0 survived, 2 timed out)"',
  'echo "SECOND-STUB-OUTPUT"',
  '[ ! -e "$state/second.json" ] || cp "$state/second.json" reports/mutation/mutation.json',
  'exit "$(cat "$state/second-exit" 2>/dev/null || echo 0)"',
  '',
].join('\n');

type Scenario = {
  first: string;
  // The rerun report; none means the second Stryker writes no report.
  second?: string;
  // The second Stryker's exit code as text; none exits 0.
  secondExit?: string;
  // The incremental file the first run leaves; none leaves no file.
  incremental?: string;
  load?: { high: string; highCalls: number };
  environment?: Record<string, string>;
};

const runScenario = (scenario: Scenario) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiko-mut-rerun-'));
  const root = join(temporaryDirectory, 'project');
  buildMutationRepository(root, { 'src/changed.ts': 'export const changed = 1;\n' });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(WAIT_LOAD, join(root, 'scripts/wait-load.sh'));

  const state = join(temporaryDirectory, 'state');
  const bin = join(temporaryDirectory, 'bin');
  mkdirSync(state);
  mkdirSync(bin);
  writeFileSync(join(state, 'first.json'), scenario.first);

  for (const [name, body] of [
    ['second.json', scenario.second],
    ['incremental.json', scenario.incremental],
    ['second-exit', scenario.secondExit],
  ] as const) {
    if (body !== undefined) {
      writeFileSync(join(state, name), body);
    }
  }

  writeSysctlStub(bin, scenario.load?.high ?? HIGH_LOAD, LOW_LOAD, scenario.load?.highCalls ?? 0);
  const result = spawnSync('bash', [join(root, 'scripts/checks/mutation.sh')], {
    encoding: 'utf8',
    env: wrapperEnvironment({
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: temporaryDirectory,
      KIKO_MUTATION_BIN: writeStrykerStub(temporaryDirectory, STUB),
      KIKO_STUB_STATE: state,
      KIKO_WAIT_LOAD_INTERVAL: '1',
      ...scenario.environment,
    }),
  });
  const read = (name: string): string | undefined =>
    existsSync(join(state, name)) ? readFileSync(join(state, name), 'utf8') : undefined;
  const history = (kind: 'history' | 'files'): string[][] =>
    readFileSync(mutationStateFile(root, temporaryDirectory, kind), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'));

  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    lines: result.stdout.split('\n'),
    stubCalls: (read('arguments') ?? '').split('\n').filter(Boolean),
    seenIncremental: read('seen-incremental.json'),
    loadReads: sysctlCallCount(bin),
    history,
  };
};

const ALL_KILLED = rows(['Killed', 'Killed', 'Killed', 'Killed', 'Killed']);
const FIRST = rows(['Killed', 'Killed', 'Timeout', 'Timeout', 'Timeout']);
const rerunLines = (lines: string[]): string[] => lines.filter((line) => line.startsWith('RERUN'));
const mutantIdentifiers = (incremental: string | undefined, path: string): string[] =>
  (
    JSON.parse(incremental ?? '{}') as { files: Record<string, { mutants: { id: string }[] }> }
  ).files[path].mutants.map(({ id }) => id);

describe('scripts/checks/mutation.sh rerun of the timed-out mutants', () => {
  // These rows hold on the code before the rerun existed: a gate that passes, or that fails on
  // anything besides TIMEOUT-HEAVY alone, never reruns.
  describe('without a rerun', () => {
    it('passes a first run that clears the gate, with one Stryker call and no RERUN line', () => {
      const run = runScenario({ first: reportOf(rows(['Killed', 'Killed', 'Killed', 'Killed'])) });

      expect(run.code).toBe(0);
      expect(run.stubCalls).toEqual([`run --mutate=${ENTRY}`]);
      expect(run.lines).toContain(
        'CHANGE SET TOTAL: 100.00 killed=4 timeout=0 survived=0 noCoverage=0',
      );
      expect(rerunLines(run.lines)).toEqual([]);
    });

    it.each([
      [
        'a file below the floor',
        reportOf(
          rows(['Killed', 'Timeout', 'Timeout', 'Timeout', 'Survived', 'Survived', 'Survived']),
        ),
      ],
      ['a report of another scope', reportOf(FIRST, ['src/changed.ts:1-2'])],
    ])('fails a heavy file with %s as before, with one Stryker call', (_name, first) => {
      const run = runScenario({ first, incremental: incrementalOf(FIRST) });

      expect(run.code).toBe(2);
      expect(run.stubCalls).toHaveLength(1);
      expect(rerunLines(run.lines)).toEqual([]);
    });
  });

  it('passes when the rerun kills every timed-out mutant, and scores only the final report', () => {
    const run = runScenario({
      first: reportOf(FIRST),
      incremental: incrementalOf(FIRST),
      second: reportOf(ALL_KILLED),
    });

    expect(run.code).toBe(0);
    expect(run.lines).toContain(
      'RERUN src/changed.ts: 3 timed out -> 3 killed, 0 survived, 0 timeout',
    );
    expect(run.lines).toContain(
      'FIRST RUN: CHANGE SET TOTAL: 100.00 killed=2 timeout=3 survived=0 noCoverage=0',
    );
    expect(run.lines).toContain(
      'CHANGE SET TOTAL: 100.00 killed=5 timeout=0 survived=0 noCoverage=0',
    );
    expect(run.lines.filter((line) => line.startsWith('TIMEOUT-HEAVY '))).toEqual([]);
    expect(run.lines.some((line) => line.startsWith('FIRST RUN: TIMEOUT-HEAVY '))).toBe(true);
    expect(run.stdout).toContain('FIRST-STUB-OUTPUT');
    expect(run.stdout).toContain('SECOND-STUB-OUTPUT');
  });

  it('runs Stryker again on the same entries, one worker, with only the timed-out mutants dropped', () => {
    const run = runScenario({
      first: reportOf(FIRST),
      incremental: incrementalOf(FIRST),
      second: reportOf(ALL_KILLED),
    });

    expect(run.stubCalls).toHaveLength(2);
    expect(run.stubCalls[0]).toBe(`run --mutate=${ENTRY}`);
    expect(run.stubCalls[1]).toContain(`--mutate=${ENTRY}`);
    expect(run.stubCalls[1]).toContain('--concurrency 1');
    expect(mutantIdentifiers(run.seenIncremental, 'src/changed.ts')).toEqual(['1', '2']);
    expect(mutantIdentifiers(run.seenIncremental, 'src/other.ts')).toEqual(['900']);
  });

  it('records the final scorer rows in the file history and only the first run in the run history', () => {
    const run = runScenario({
      first: reportOf(FIRST),
      incremental: incrementalOf(FIRST),
      second: reportOf(ALL_KILLED),
    });

    // iso, path, killed + timeout + survived, timeout.
    expect(run.history('files').map((row) => row.slice(1))).toEqual([['src/changed.ts', '5', '0']]);
    // iso, duration, mutants, score, tested, timed out: the second call's counter is not here.
    expect(run.history('history').map((row) => row.slice(2))).toEqual([['50', '', '10', '4']]);
  });

  it('passes when the rerun leaves fewer than three real loops, whatever share they are', () => {
    const first = rows(['Killed', 'Killed', 'Timeout', 'Timeout', 'Timeout', 'Timeout', 'Timeout']);
    const run = runScenario({
      first: reportOf(first),
      incremental: incrementalOf(first),
      second: reportOf(
        rows(['Killed', 'Killed', 'Killed', 'Killed', 'Killed', 'Timeout', 'Timeout']),
      ),
    });

    expect(run.code).toBe(0);
    expect(run.lines).toContain(
      'RERUN src/changed.ts: 5 timed out -> 3 killed, 0 survived, 2 timeout',
    );
    expect(run.lines).toContain(
      'CHANGE SET TOTAL: 100.00 killed=5 timeout=2 survived=0 noCoverage=0',
    );
  });

  it('fails on the final report when the rerun leaves the file TIMEOUT-HEAVY', () => {
    const run = runScenario({
      first: reportOf(FIRST),
      incremental: incrementalOf(FIRST),
      second: reportOf(FIRST),
    });

    expect(run.code).toBe(2);
    expect(run.lines).toContain(
      'RERUN src/changed.ts: 3 timed out -> 0 killed, 0 survived, 3 timeout',
    );
    expect(run.lines.filter((line) => line.startsWith('TIMEOUT-HEAVY '))).toHaveLength(1);
    expect(run.lines.filter((line) => line.startsWith('FIRST RUN: TIMEOUT-HEAVY '))).toHaveLength(
      1,
    );
    expect(run.stderr).toContain('TIMEOUT-HEAVY src/changed.ts');
  });

  it('counts a mutant the rerun leaves surviving, and passes while the file stays above the floor', () => {
    const run = runScenario({
      first: reportOf(FIRST),
      incremental: incrementalOf(FIRST),
      second: reportOf(rows(['Killed', 'Killed', 'Killed', 'Killed', 'Survived'])),
    });

    expect(run.code).toBe(0);
    expect(run.lines).toContain(
      'RERUN src/changed.ts: 3 timed out -> 2 killed, 1 survived, 0 timeout',
    );
  });

  it('fails when the survivors of the rerun drop the file below the floor', () => {
    const first = rows(['Killed', 'Timeout', 'Timeout', 'Timeout']);
    const run = runScenario({
      first: reportOf(first),
      incremental: incrementalOf(first),
      second: reportOf(rows(['Killed', 'Survived', 'Survived', 'Survived'])),
    });

    expect(run.code).toBe(2);
    expect(run.lines).toContain(
      'RERUN src/changed.ts: 3 timed out -> 0 killed, 3 survived, 0 timeout',
    );
    expect(run.lines).toContain(
      'CHANGE SET TOTAL: 25.00 killed=1 timeout=0 survived=3 noCoverage=0',
    );
    expect(run.stderr).toContain("CHANGE SET's own mutation score failed");
  });

  it('skips the rerun over the mutant cap and fails as before', () => {
    const many = rows(Array.from({ length: 500 }, () => 'Timeout'));
    const run = runScenario({
      first: reportOf(many),
      incremental: incrementalOf(many),
      second: reportOf(many),
    });

    expect(run.code).toBe(2);
    expect(run.lines).toContain('RERUN SKIPPED: 500 mutants over the cap');
    expect(run.stubCalls).toHaveLength(1);
  });

  describe('the load wait before the rerun', () => {
    it('skips the rerun when the wait for a quiet machine expires, and fails as before', () => {
      const run = runScenario({
        first: reportOf(FIRST),
        incremental: incrementalOf(FIRST),
        second: reportOf(ALL_KILLED),
        load: { high: HIGH_LOAD, highCalls: 9999 },
        environment: { KIKO_MUTATION_RERUN_WAIT_SECONDS: '1' },
      });

      expect(run.code).toBe(2);
      expect(run.lines).toContain('RERUN SKIPPED: load');
      expect(run.stubCalls).toHaveLength(1);
      expect(run.stderr).toContain('TIMEOUT-HEAVY src/changed.ts');
    });

    it('reruns once the load drops below the limit', () => {
      const run = runScenario({
        first: reportOf(FIRST),
        incremental: incrementalOf(FIRST),
        second: reportOf(ALL_KILLED),
        load: { high: HIGH_LOAD, highCalls: 2 },
      });

      expect(run.code).toBe(0);
      expect(run.stubCalls).toHaveLength(2);
      expect(run.loadReads).toBeGreaterThanOrEqual(3);
    });
  });

  describe('a rerun that cannot be prepared', () => {
    it.each([
      ['has no incremental file', undefined],
      ['has an unparsable incremental file', '{"files": {'],
      [
        'has an incremental file without one of the mutants',
        incrementalOf(rows(['Killed', 'Killed', 'Timeout'])),
      ],
    ])(
      'fails with a block and runs no second Stryker when the first run %s',
      (_name, incremental) => {
        const run = runScenario({
          first: reportOf(FIRST),
          incremental,
          second: reportOf(ALL_KILLED),
        });

        expect(run.code).toBe(2);
        expect(run.stderr).toContain('stryker-incremental.json');
        expect(run.stubCalls).toHaveLength(1);
      },
    );
  });

  describe('a rerun Stryker that does not finish a run', () => {
    it.each([
      ['crashes', '3'],
      ['exits 1 and writes no report', '1'],
    ])('fails with the crash block when the second Stryker %s', (_name, secondExit) => {
      const run = runScenario({
        first: reportOf(FIRST),
        incremental: incrementalOf(FIRST),
        secondExit,
      });

      expect(run.code).toBe(2);
      expect(run.stubCalls).toHaveLength(2);
      expect(run.stderr).toContain('rather than completing a run');
    });

    it('never scores the first report again when the second Stryker writes none', () => {
      const run = runScenario({ first: reportOf(FIRST), incremental: incrementalOf(FIRST) });

      expect(run.code).toBe(2);
      expect(run.stubCalls).toHaveLength(2);
      expect(run.stderr).toContain('wrote no JSON report');
    });
  });
});
