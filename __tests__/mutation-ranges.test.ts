import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

import {
  twelveLines,
  writeExecutable,
  runWithArgumentStub,
  buildMutationRepository,
} from './test-support/mutation-repository';

// scripts/checks/mutation-ranges.js turns `git diff -U0` output (stdin) into the
// added-line ranges of the paths given as arguments, one `<path>\t<ranges>` line
// per argument in argument order. It spawns the real script with a synthetic
// diff on stdin (the mutation-score.test.ts pattern).
const SCRIPT = join(__dirname, '../scripts/checks/mutation-ranges.js');

type CliResult = { code: number | null; stdout: string; stderr: string };

const run = (diff: string, paths: string[]): CliResult => {
  const result = spawnSync('node', [SCRIPT, ...paths], { input: diff, encoding: 'utf8' });

  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const modifiedHeader = (path: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
  ].join('\n');

// A hunk body is irrelevant to the ranges, so only the header line is written.
const diffOf = (path: string, ...hunkHeaders: string[]): string =>
  `${[modifiedHeader(path), ...hunkHeaders].join('\n')}\n`;

describe('mutation-ranges.js', () => {
  it('prints the added-line ranges of a modified file, and a hunk without a count adds one line', () => {
    const result = run(diffOf('src/a.ts', '@@ -3,2 +3,2 @@', '@@ -9 +10 @@'), ['src/a.ts']);

    expect(result).toEqual({ code: 0, stdout: 'src/a.ts\t3-4,10-10\n', stderr: '' });
  });

  it('adds no range for a pure deletion, and keeps only the added hunk of a mixed one', () => {
    const onlyDeletion = run(diffOf('src/a.ts', '@@ -4,2 +3,0 @@'), ['src/a.ts']);
    const mixed = run(diffOf('src/a.ts', '@@ -4,2 +3,0 @@', '@@ -9,0 +7 @@'), ['src/a.ts']);

    expect(onlyDeletion).toEqual({ code: 0, stdout: 'src/a.ts\t\n', stderr: '' });
    expect(mixed.stdout).toBe('src/a.ts\t7-7\n');
  });

  it('reads a new file as one range from line 1', () => {
    const diff = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,12 @@',
      '',
    ].join('\n');

    expect(run(diff, ['src/new.ts']).stdout).toBe('src/new.ts\t1-12\n');
  });

  it('merges adjacent and overlapping ranges, and sorts them', () => {
    const adjacent = run(diffOf('src/a.ts', '@@ -3,0 +3,2 @@', '@@ -5,0 +5 @@'), ['src/a.ts']);
    const overlapping = run(diffOf('src/a.ts', '@@ -3,0 +3,4 @@', '@@ -5,0 +5,5 @@'), ['src/a.ts']);
    const unsorted = run(diffOf('src/a.ts', '@@ -9,0 +20,2 @@', '@@ -1,0 +3 @@'), ['src/a.ts']);

    expect(adjacent.stdout).toBe('src/a.ts\t3-5\n');
    expect(overlapping.stdout).toBe('src/a.ts\t3-9\n');
    expect(unsorted.stdout).toBe('src/a.ts\t3-3,20-21\n');
  });

  it('does not widen hunks that are one line apart', () => {
    const result = run(diffOf('src/a.ts', '@@ -3,0 +3 @@', '@@ -5,0 +5 @@'), ['src/a.ts']);

    expect(result.stdout).toBe('src/a.ts\t3-3,5-5\n');
  });

  it('keys the hunks of a renamed file by its new path', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/moved.ts',
      'similarity index 90%',
      'rename from src/old.ts',
      'rename to src/moved.ts',
      'index 1111111..2222222 100644',
      '--- a/src/old.ts',
      '+++ b/src/moved.ts',
      '@@ -4 +4 @@',
      '',
    ].join('\n');

    expect(run(diff, ['src/moved.ts'])).toEqual({
      code: 0,
      stdout: 'src/moved.ts\t4-4\n',
      stderr: '',
    });
  });

  it('prints an empty range field for a pure rename, which has no +++ line and no hunk', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/moved.ts',
      'similarity index 100%',
      'rename from src/old.ts',
      'rename to src/moved.ts',
      '',
    ].join('\n');

    expect(run(diff, ['src/moved.ts'])).toEqual({
      code: 0,
      stdout: 'src/moved.ts\t\n',
      stderr: '',
    });
  });

  it('finds a pure rename whose path holds a space, by matching the header against the argument', () => {
    const diff = [
      'diff --git a/src/old name.ts b/src/new name.ts',
      'similarity index 100%',
      'rename from src/old name.ts',
      'rename to src/new name.ts',
      '',
    ].join('\n');

    expect(run(diff, ['src/new name.ts'])).toEqual({
      code: 0,
      stdout: 'src/new name.ts\t\n',
      stderr: '',
    });
  });

  it('finds a mode-only change, which has no +++ line and no hunk', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'old mode 100644',
      'new mode 100755',
      '',
    ].join('\n');

    expect(run(diff, ['src/a.ts']).stdout).toBe('src/a.ts\t\n');
  });

  it('exits 2 when an argument path is absent from every diff header', () => {
    const result = run(diffOf('src/a.ts', '@@ -3 +3 @@'), ['src/a.ts', 'src/missing.ts']);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('src/missing.ts');
  });

  it('exits 2 for an empty diff', () => {
    expect(run('', ['src/a.ts']).code).toBe(2);
  });

  it('does not print the hunks of a path that is not an argument', () => {
    const diff = `${diffOf('src/other.ts', '@@ -1 +1,5 @@')}${diffOf('src/a.ts', '@@ -2 +2 @@')}`;

    expect(run(diff, ['src/a.ts']).stdout).toBe('src/a.ts\t2-2\n');
  });

  it('prints one line per argument in argument order', () => {
    const diff = `${diffOf('src/a.ts', '@@ -2 +2 @@')}${diffOf('src/b.ts', '@@ -7 +7,2 @@')}`;

    expect(run(diff, ['src/b.ts', 'src/a.ts']).stdout).toBe('src/b.ts\t7-8\nsrc/a.ts\t2-2\n');
  });

  it('does not read an added line that looks like a file header as a header', () => {
    const diff = `${[
      modifiedHeader('src/a.ts'),
      '@@ -0,0 +1,2 @@',
      '+++ b/src/other.ts',
      '+@@ -1 +1,99 @@',
      modifiedHeader('src/b.ts'),
      '@@ -4 +4 @@',
    ].join('\n')}\n`;

    expect(run(diff, ['src/a.ts', 'src/b.ts']).stdout).toBe('src/a.ts\t1-2\nsrc/b.ts\t4-4\n');
  });

  it('exits 2 without an argument', () => {
    expect(run(diffOf('src/a.ts', '@@ -2 +2 @@'), []).code).toBe(2);
  });
});

// mutation.sh runs the real reader on a real `git diff -U0`, in a throwaway repository whose
// `main` holds twelve lines of src/changed.ts and whose `feature` edits lines 3 and 7.
const buildChangedLinesRepository = (root: string): { root: string; script: string } =>
  buildMutationRepository(
    root,
    {
      'src/changed.ts': twelveLines({
        3: 'export const edited3 = 3;',
        7: 'export const edited7 = 7;',
      }),
    },
    { 'src/changed.ts': twelveLines() },
  );

// Git's own variable name, spelled as a string: its last word is on the abbreviation denylist.
const GIT_DIFF_CONTEXT_VARIABLE = 'GIT_DIFF_OPTS';

describe('mutation.sh changed lines', () => {
  it('prints the same ranges with --unified=3 in git diff options of the environment', () => {
    const { script } = buildChangedLinesRepository(
      join(mkdtempSync(join(tmpdir(), 'kiko-mutation-ranges-')), 'project'),
    );

    const plain = runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' }, ['--list']);
    const widened = runWithArgumentStub(
      script,
      { KIKO_MUTATION_BASE: 'main', [GIT_DIFF_CONTEXT_VARIABLE]: '--unified=3' },
      ['--list'],
    );

    expect(plain.stdout).toContain('src/changed.ts 3-3,7-7 (2 changed lines)');
    expect(widened.stdout).toBe(plain.stdout);
  });
});

// A stand-in for `node` that runs the real one, except that the changed-line reader announces
// itself with a ready file and then holds until the test creates the release file.
const HOLDING_NODE_STUB = [
  '#!/usr/bin/env bash',
  'case "$1" in',
  '  */mutation-ranges.js)',
  '    : > "$KIKO_STUB_READY"',
  // The directory test ends the loop when the sandbox is deleted, so a failed test cannot leave
  // the stub looping.
  `    while [ ! -e "$KIKO_STUB_RELEASE" ] && [ -d "\${KIKO_STUB_RELEASE%/*}" ]; do`,
  '      sleep 0.05',
  '    done',
  '    ;;',
  'esac',
  'exec "$KIKO_REAL_NODE" "$@"',
  '',
].join('\n');

const POLL_LIMIT = 500;

// A poll count (not a measured time) bounds the wait, so a state that never appears fails the test
// instead of leaving a loop that keeps jest alive.
const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let poll = 0; !condition(); poll += 1) {
    if (poll >= POLL_LIMIT) {
      throw new Error('the awaited state never appeared');
    }

    await new Promise((settle) => setTimeout(settle, 20));
  }
};

const sandboxes: string[] = [];

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

const rangesTemporaryFiles = (directory: string): string[] =>
  readdirSync(directory).filter((name) => name.startsWith('kiko-mutation-ranges.'));

describe('mutation.sh signals while the changed-line reader runs', () => {
  it.each([
    ['--list', 'TERM', 143],
    ['--list', 'INT', 130],
    ['a run', 'TERM', 143],
    ['a run', 'INT', 130],
  ] as const)(
    '%s: %s leaves no temporary file and no lock, and exits %i',
    async (mode, signal, exitCode) => {
      const sandbox = mkdtempSync(join(tmpdir(), 'kiko-mutation-signal-'));
      sandboxes.push(sandbox);
      const { script, root } = buildChangedLinesRepository(join(sandbox, 'project'));
      const state = join(sandbox, 'state');
      mkdirSync(state);
      mkdirSync(join(sandbox, 'bin'));
      writeExecutable(join(sandbox, 'bin/node'), HOLDING_NODE_STUB);
      const stryker = writeExecutable(join(sandbox, 'stryker'), '#!/usr/bin/env bash\nexit 0\n');
      const ready = join(sandbox, 'ready');

      const child = spawn('bash', mode === '--list' ? [script, '--list'] : [script], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${join(sandbox, 'bin')}:${process.env.PATH}`,
          TMPDIR: state,
          KIKO_MUTATION_BASE: 'main',
          KIKO_MUTATION_FULL: undefined,
          KIKO_MUTATION_BIN: stryker,
          KIKO_REAL_NODE: process.execPath,
          KIKO_STUB_READY: ready,
          KIKO_STUB_RELEASE: join(sandbox, 'release'),
        },
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      const closed = new Promise<number | null>((settle) => {
        child.on('close', (code) => settle(code));
      });
      await waitFor(() => existsSync(ready));
      expect(rangesTemporaryFiles(state)).toHaveLength(1);

      // Bash runs a trap only after its foreground command ends, so the reader is released after
      // the signal is sent.
      child.kill(signal === 'TERM' ? 'SIGTERM' : 'SIGINT');
      writeFileSync(join(sandbox, 'release'), '');

      expect(await closed).toBe(exitCode);
      expect(rangesTemporaryFiles(state)).toEqual([]);
      expect(existsSync(join(state, 'kiko-harness', 'mutation.global.lock'))).toBe(false);
    },
  );
});
