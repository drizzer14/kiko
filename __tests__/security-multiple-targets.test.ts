import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/security.sh once read only its first argument, so a call
// with several files scanned the first and passed the rest unseen; its
// failure block was empty when Semgrep (run with --quiet) failed with the
// reason only in its JSON; and a dedup skip exited 0 silently, which read as a
// fresh scan. A stub `semgrep` first on PATH stands in for the binary: it
// records every invocation's arguments and answers from the files it is given.
const SCRIPT = join(__dirname, '../scripts/checks/security.sh');
const REPOSITORY_ROOT = join(__dirname, '..');

const createdPaths: string[] = [];

function createTempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  createdPaths.push(directory);

  return directory;
}

const CLASS_A_RESULT = {
  check_id: 'rules.kiko-test-rule',
  path: 'vulnerable.ts',
  start: { line: 3 },
  extra: { severity: 'ERROR', message: 'disabled TLS validation' },
};

const FINDING_OUTPUT = JSON.stringify({ results: [CLASS_A_RESULT], errors: [] });
const CLEAN_OUTPUT = JSON.stringify({ results: [], errors: [] });

interface Harness {
  invocations: () => string[];
  run: (targets: string[], extraEnvironment?: Record<string, string>) => SpawnSyncReturns<string>;
  file: (name: string, content?: string) => string;
}

// The stub answers with a Class A finding when `vulnerable.ts` is among its
// arguments, exits with STUB_EXIT and prints STUB_STDOUT verbatim when
// STUB_EXIT is set, and answers with a clean scan otherwise. It never writes
// stderr: the real Semgrep, run with --quiet, does not either.
function createHarness(): Harness {
  const stubDirectory = createTempDirectory('kiko-security-multi-stub-');
  const stateDirectory = createTempDirectory('kiko-security-multi-state-');
  const workDirectory = createTempDirectory('kiko-security-multi-work-');
  const logPath = join(stubDirectory, 'invocations.log');
  const stubPath = join(stubDirectory, 'semgrep');
  writeFileSync(
    stubPath,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> "${logPath}"`,
      'if [ -n "$STUB_EXIT" ]; then',
      '  printf "%s" "$STUB_STDOUT"',
      '  exit "$STUB_EXIT"',
      'fi',
      'case "$*" in',
      `  *vulnerable.ts*) printf '%s' '${FINDING_OUTPUT}'; exit 1 ;;`,
      `  *) printf '%s' '${CLEAN_OUTPUT}'; exit 0 ;;`,
      'esac',
      '',
    ].join('\n'),
  );
  chmodSync(stubPath, 0o755);

  return {
    invocations: () =>
      existsSync(logPath)
        ? readFileSync(logPath, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
        : [],
    run: (targets, extraEnvironment = {}) =>
      spawnSync('bash', [SCRIPT, ...targets], {
        encoding: 'utf8',
        cwd: REPOSITORY_ROOT,
        env: {
          ...process.env,
          PATH: `${stubDirectory}:${process.env.PATH}`,
          TMPDIR: stateDirectory,
          ...extraEnvironment,
        },
      }),
    file: (name, content = 'export const value = 1;\n') => {
      const path = join(workDirectory, name);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);

      return path;
    },
  };
}

afterEach(() => {
  while (createdPaths.length > 0) {
    const directory = createdPaths.pop();

    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('scripts/checks/security.sh with several targets', () => {
  it('hands every file argument to Semgrep', () => {
    const harness = createHarness();
    const first = harness.file('clean.ts');
    const second = harness.file('other.ts');

    const result = harness.run([first, second]);

    expect(result.status).toBe(0);
    expect(harness.invocations()).toHaveLength(1);
    expect(harness.invocations()[0]).toContain(first);
    expect(harness.invocations()[0]).toContain(second);
  });

  it('fails on a Class A finding in the second file', () => {
    const harness = createHarness();

    const result = harness.run([harness.file('clean.ts'), harness.file('vulnerable.ts')]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('vulnerable.ts');
  });

  it('keeps skipping a positive fixture among several arguments', () => {
    const harness = createHarness();
    const fixture = join(REPOSITORY_ROOT, 'rules/fixtures/kiko-no-history-id-comment.bad.ts');
    const real = harness.file('clean.ts');

    const result = harness.run([fixture, real]);

    expect(result.status).toBe(0);
    expect(harness.invocations()).toHaveLength(1);
    expect(harness.invocations()[0]).toContain(real);
    expect(harness.invocations()[0]).not.toContain('rules/fixtures');
  });

  it.each([
    ['absolute', `${REPOSITORY_ROOT}/rules/fixtures/../../package.json`],
    ['relative', 'rules/fixtures/../../package.json'],
  ])('scans a %s path that only starts under rules/fixtures/ and climbs out', (_form, target) => {
    const harness = createHarness();

    const result = harness.run([target]);

    expect(result.status).toBe(0);
    expect(harness.invocations()).toHaveLength(1);
    expect(harness.invocations()[0]).toContain('package.json');
  });

  it('does not call Semgrep when every argument is a positive fixture', () => {
    const harness = createHarness();
    const fixture = join(REPOSITORY_ROOT, 'rules/fixtures/kiko-no-history-id-comment.bad.ts');

    const result = harness.run([fixture, fixture]);

    expect(result.status).toBe(0);
    expect(harness.invocations()).toHaveLength(0);
  });
});

describe('scripts/checks/security.sh failure DETAILS', () => {
  it('names the Semgrep errors[] message when Semgrep fails with an empty stderr', () => {
    const harness = createHarness();
    const stdout = JSON.stringify({
      results: [],
      errors: [{ code: 7, level: 'error', message: 'invalid configuration file found' }],
    });

    const result = harness.run([harness.file('clean.ts')], {
      STUB_EXIT: '7',
      STUB_STDOUT: stdout,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('invalid configuration file found');
  });

  it('names the exit code when Semgrep fails with no output at all', () => {
    const harness = createHarness();

    const result = harness.run([harness.file('clean.ts')], { STUB_EXIT: '3' });

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/DETAILS:[^\n]*exit 3/);
  });

  it('names the rule, location, and message of a Class A finding', () => {
    const harness = createHarness();

    const result = harness.run([harness.file('vulnerable.ts')]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('rules.kiko-test-rule');
    expect(result.stderr).toContain('vulnerable.ts:3');
    expect(result.stderr).toContain('disabled TLS validation');
  });
});

describe('scripts/checks/security.sh dedup', () => {
  it('says a dedup skip is not a fresh scan', () => {
    const harness = createHarness();
    const target = harness.file('clean.ts');

    expect(harness.run([target]).status).toBe(0);
    const second = harness.run([target]);

    expect(second.status).toBe(0);
    expect(harness.invocations()).toHaveLength(1);
    expect(second.stderr).toContain('SKIPPED');
    expect(second.stderr).toContain('not a fresh scan');
  });

  it('rescans a multi-target call when any one of the files changed', () => {
    const harness = createHarness();
    const first = harness.file('clean.ts');
    const second = harness.file('other.ts');

    expect(harness.run([first, second]).status).toBe(0);
    expect(harness.run([first, second]).stderr).toContain('SKIPPED');
    expect(harness.invocations()).toHaveLength(1);

    harness.file('other.ts', 'export const value = 2;\n');
    const third = harness.run([first, second]);

    expect(third.stderr).not.toContain('SKIPPED');
    expect(harness.invocations()).toHaveLength(2);
  });

  it('does not let a passed pair vouch for one of its files scanned alone', () => {
    const harness = createHarness();
    const first = harness.file('clean.ts');
    const second = harness.file('other.ts');

    expect(harness.run([first, second]).status).toBe(0);
    const alone = harness.run([first]);

    expect(alone.stderr).not.toContain('SKIPPED');
    expect(harness.invocations()).toHaveLength(2);
  });

  it('never dedups a failing call', () => {
    const harness = createHarness();
    const target = harness.file('vulnerable.ts');

    expect(harness.run([target]).status).toBe(2);
    expect(harness.run([target]).status).toBe(2);
    expect(harness.invocations()).toHaveLength(2);
  });
});
