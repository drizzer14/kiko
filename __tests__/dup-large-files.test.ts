import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

// jscpd skips a file over 1000 lines or 100kb without a word, so scripts/checks/dup.sh once
// passed a project whose largest files were never measured. The blocking run is unchanged; a
// second, non-blocking pass measures every skipped file alone and prints a WARNING per file over
// the threshold. Each test builds a throwaway project with a copy of dup.sh, the repository's
// .jscpd.json, and a wrapper around the repository's jscpd binary.
const REPOSITORY_ROOT = join(__dirname, '..');

const createdPaths: string[] = [];

function createTempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  createdPaths.push(directory);

  return directory;
}

const DUPLICATED_BLOCK = [
  'export function computeTotal(items: number[]): number {',
  '  let total = 0;',
  '  for (const item of items) {',
  '    if (item > 0) {',
  '      total += item * 2;',
  '    }',
  '  }',
  '  return total;',
  '}',
  '',
].join('\n');

function duplicated(repetitions: number): string {
  return DUPLICATED_BLOCK.repeat(repetitions);
}

function unique(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_unused, index) => `export const value${index} = ${index} + ${index * 7919};`,
  ).join('\n');
}

interface Project {
  run: (targets?: string[], measure?: 'fail' | 'empty') => SpawnSyncReturns<string>;
  file: (name: string, content: string) => string;
}

function createProject(): Project {
  const root = createTempDirectory('kiko-dup-large-');
  const stateDirectory = createTempDirectory('kiko-dup-large-state-');
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });
  copyFileSync(join(REPOSITORY_ROOT, 'scripts/checks/dup.sh'), join(root, 'scripts/checks/dup.sh'));
  copyFileSync(
    join(REPOSITORY_ROOT, 'scripts/checks/_lib.sh'),
    join(root, 'scripts/checks/_lib.sh'),
  );
  copyFileSync(join(REPOSITORY_ROOT, '.jscpd.json'), join(root, '.jscpd.json'));
  // The wrapper runs the repository's jscpd, except that the per-file measuring call of the
  // large-file pass (the only call with --silent) fails or writes no report when asked to.
  const binary = join(root, 'node_modules/.bin/jscpd');
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  writeFileSync(
    binary,
    [
      '#!/usr/bin/env bash',
      'case " $* " in',
      '  *" --silent "*)',
      '    [ "$STUB_MEASURE" = fail ] && exit 3',
      '    [ "$STUB_MEASURE" = empty ] && exit 0',
      '    ;;',
      'esac',
      `exec "${join(REPOSITORY_ROOT, 'node_modules/.bin/jscpd')}" "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(binary, 0o755);

  return {
    run: (targets = [], measure) =>
      spawnSync('bash', [join(root, 'scripts/checks/dup.sh'), ...targets], {
        encoding: 'utf8',
        cwd: root,
        env: { ...process.env, TMPDIR: stateDirectory, STUB_MEASURE: measure ?? '' },
      }),
    file: (name, content) => {
      const path = join(root, name);
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

describe('scripts/checks/dup.sh large files', () => {
  it('warns about a file over 1000 lines that is over the threshold, and still exits 0', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WARNING[^\n]*src\/big\.ts[^\n]*\b\d+(\.\d+)?%/);
  });

  it('names the measured percentage', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));

    const result = project.run();

    const percentage = Number(/big\.ts[^\n]*?(\d+(?:\.\d+)?)% duplicated/.exec(result.stderr)?.[1]);
    expect(percentage).toBeGreaterThan(90);
  });

  it('prints no warning for a large file that is not duplicated', () => {
    const project = createProject();
    project.file('src/clean.ts', unique(1100));

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('prints no warning for a large file under the threshold', () => {
    const project = createProject();
    project.file('src/mostly-clean.ts', `${unique(1100)}\n${duplicated(2)}`);

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('warns about a file over 100kb even when it has fewer than 1000 lines', () => {
    const project = createProject();
    const longLine = `export const padding = '${'x'.repeat(2000)}';\n`;
    project.file('src/wide.ts', `${duplicated(3)}${longLine.repeat(60)}`);

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WARNING[^\n]*src\/wide\.ts/);
  });

  it('still fails on a small duplicated file', () => {
    const project = createProject();
    project.file('src/small.ts', duplicated(5));

    const result = project.run();

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED');
  });

  it('fails on a small duplicated file and does not run the large-file pass', () => {
    const project = createProject();
    project.file('src/small.ts', duplicated(5));
    project.file('src/big.ts', duplicated(120));

    const result = project.run();

    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain('WARNING');
  });

  it('warns only about the large files it was given in a scoped run', () => {
    const project = createProject();
    const changed = project.file('src/changed.ts', duplicated(120));
    project.file('src/untouched.ts', duplicated(130));

    const result = project.run([changed]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('changed.ts');
    expect(result.stderr).not.toContain('untouched.ts');
  });

  it('warns, never stays silent, when jscpd fails on a large file', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));

    const result = project.run([], 'fail');

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WARNING[^\n]*could not measure[^\n]*src\/big\.ts/);
  });

  it('warns when jscpd writes no figure for a large file', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));

    const result = project.run([], 'empty');

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WARNING[^\n]*could not measure[^\n]*src\/big\.ts/);
  });

  it('stays silent when no file is over the size limits', () => {
    const project = createProject();
    project.file('src/small.ts', unique(40));

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
