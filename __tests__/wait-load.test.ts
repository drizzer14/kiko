import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

import { writeExecutable } from './test-support/mutation-repository';

// scripts/wait-load.sh waits until the 5-minute load average (the second number of
// `sysctl -n vm.loadavg`) is below its first argument, so a heavy command starts on a quiet
// machine. The tests put a stub `sysctl` first on PATH, so no real load is read.
const SCRIPT = join(__dirname, '../scripts/wait-load.sh');
const HIGH = '{ 1.50 12.25 3.00 }';
const LOW = '{ 1.50 4.25 3.00 }';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'wait-load-test-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

// The stub answers `highCalls` times with `high`, then with `low` forever; it fails any other
// invocation, so a script that asked sysctl for something else cannot pass by accident.
const writeSysctlStub = (high: string, low: string, highCalls: number): void => {
  writeExecutable(
    join(directory, 'sysctl'),
    [
      '#!/usr/bin/env bash',
      '[ "$*" = "-n vm.loadavg" ] || exit 1',
      `calls="${join(directory, 'calls')}"`,
      'count="$(cat "$calls" 2>/dev/null || echo 0)"',
      'printf %s "$((count + 1))" > "$calls"',
      `if [ "$count" -lt ${highCalls} ]; then printf '%s\\n' '${high}'; else printf '%s\\n' '${low}'; fi`,
      '',
    ].join('\n'),
  );
};

const callCount = (): number => Number(readFileSync(join(directory, 'calls'), 'utf8'));

const runWith = (
  environment: Record<string, string>,
  ...scriptArguments: string[]
): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT, ...scriptArguments], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      KIKO_WAIT_LOAD_INTERVAL: '1',
      ...environment,
    },
  });

const run = (...scriptArguments: string[]): SpawnSyncReturns<string> =>
  runWith({}, ...scriptArguments);

describe('scripts/wait-load.sh', () => {
  it('exits 0 and prints nothing when the load is already below the maximum', () => {
    writeSysctlStub(HIGH, LOW, 0);

    const result = run('10');

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(callCount()).toBe(1);
  });

  it('waits while the load is high, prints one start line, and exits 0 once it drops', () => {
    writeSysctlStub(HIGH, LOW, 2);

    const result = run('10');

    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split('\n')).toEqual([
      'wait-load: waiting for the 5-minute load average to drop below 10 (now 12.25, timeout 3600s)',
    ]);
    expect(result.stderr).toBe('');
    expect(callCount()).toBe(3);
  });

  it('reads the second number, so a high 1-minute or 15-minute average does not block it', () => {
    writeSysctlStub('{ 40.00 4.25 40.00 }', LOW, 99);

    expect(run('10').status).toBe(0);
  });

  it('exits 2 with a clear message when the timeout passes before the load drops', () => {
    writeSysctlStub(HIGH, LOW, 9999);

    const result = run('10', '1');

    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      'wait-load: timed out after 1s: the 5-minute load average is 12.25, not below 10\n',
    );
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
  });

  it('treats a load equal to the maximum as not below it', () => {
    writeSysctlStub('{ 1.00 10.00 1.00 }', LOW, 9999);

    const result = run('10', '0');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not below 10');
  });

  it('compares decimals, so 9.99 is below 10 and 10.01 is not', () => {
    writeSysctlStub('{ 1.00 9.99 1.00 }', LOW, 9999);

    expect(run('10', '0').status).toBe(0);

    writeSysctlStub('{ 1.00 10.01 1.00 }', LOW, 9999);

    expect(run('10', '0').status).toBe(2);
  });

  it('reads a locale that prints a comma decimal, and accepts a comma maximum', () => {
    writeSysctlStub('{ 1,50 4,25 3,00 }', LOW, 9999);

    expect(run('10').status).toBe(0);
    expect(run('4,5').status).toBe(0);
    expect(run('4,2', '0').status).toBe(2);
  });

  it('exits 3 when sysctl prints something that is not a load average', () => {
    writeSysctlStub('garbage', 'garbage', 9999);

    const result = run('10');

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('could not read the 5-minute load average');
  });

  it('exits 3 when sysctl is not on PATH', () => {
    const result = spawnSync('bash', [SCRIPT, '10'], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', KIKO_WAIT_LOAD_INTERVAL: '1' },
    });

    // The real /usr/sbin/sysctl is not on this PATH, so the read fails the way a missing tool does.
    expect(result.status).toBe(3);
  });

  it.each([
    ['no arguments', []],
    ['a non-numeric maximum', ['soon']],
    ['a maximum with two decimal points', ['1.2.3']],
    ['three arguments', ['10', '5', '7']],
  ])('exits 64 with the usage line for %s', (_name, scriptArguments) => {
    writeSysctlStub(HIGH, LOW, 0);

    const result = run(...scriptArguments);

    expect(result.status).toBe(64);
    expect(result.stderr).toBe('usage: wait-load.sh <max> [timeout-seconds]\n');
  });

  it.each([
    ['a non-numeric timeout', ['10', 'forever'], {}, 'the timeout argument must be a whole number'],
    ['a negative timeout', ['10', '-5'], {}, 'the timeout argument must be a whole number'],
    [
      'a decimal poll interval',
      ['10'],
      { KIKO_WAIT_LOAD_INTERVAL: '0.1' },
      'KIKO_WAIT_LOAD_INTERVAL',
    ],
    ['a zero poll interval', ['10'], { KIKO_WAIT_LOAD_INTERVAL: '0' }, 'KIKO_WAIT_LOAD_INTERVAL'],
    ['an empty poll interval', ['10'], { KIKO_WAIT_LOAD_INTERVAL: '' }, 'KIKO_WAIT_LOAD_INTERVAL'],
    [
      'a text poll interval',
      ['10'],
      { KIKO_WAIT_LOAD_INTERVAL: 'soon' },
      'KIKO_WAIT_LOAD_INTERVAL',
    ],
  ])('exits 64 naming the bad value for %s', (_name, scriptArguments, environment, message) => {
    writeSysctlStub(HIGH, LOW, 0);

    const result = runWith(environment, ...scriptArguments);

    expect(result.status).toBe(64);
    expect(result.stderr).toContain(message);
  });
});
