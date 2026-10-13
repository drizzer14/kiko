import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

// Each test builds a throwaway project with a copy of scripts/checks/dup.sh, the repository's
// .jscpd.json, and a wrapper around the repository's jscpd binary, so the real jscpd measures
// real files and the wrapper can fail or log the calls the large-file pass makes.
const REPOSITORY_ROOT = join(__dirname, '..');

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

interface RunOptions {
  // 'measure-fail' / 'measure-empty': the calls that measure (they carry --silent) exit 3 or
  // write no report. 'list-fail': the calls that list files (they carry --debug) exit 3.
  // 'slow-combined': the combined measurement sleeps, then logs 'combined-done'.
  stub?: 'measure-fail' | 'measure-empty' | 'list-fail' | 'slow-combined';
  environment?: Record<string, string>;
}

interface Project {
  run: (targets?: string[], options?: RunOptions) => SpawnSyncReturns<string>;
  file: (name: string, content: string) => string;
  invocations: () => string[];
}

function createProject(): Project {
  const root = createTemporaryDirectory('kiko-dup-large-');
  const stateDirectory = createTemporaryDirectory('kiko-dup-large-state-');
  const logPath = join(stateDirectory, 'invocations.log');
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });
  copyFileSync(join(REPOSITORY_ROOT, 'scripts/checks/dup.sh'), join(root, 'scripts/checks/dup.sh'));
  copyFileSync(
    join(REPOSITORY_ROOT, 'scripts/checks/_lib.sh'),
    join(root, 'scripts/checks/_lib.sh'),
  );
  copyFileSync(join(REPOSITORY_ROOT, '.jscpd.json'), join(root, '.jscpd.json'));
  const binary = join(root, 'node_modules/.bin/jscpd');
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  writeFileSync(
    binary,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> "${logPath}"`,
      'case " $* " in',
      '  *" --silent "*)',
      '    [ "$STUB_MODE" = measure-fail ] && exit 3',
      '    [ "$STUB_MODE" = measure-empty ] && exit 0',
      '    case "$*" in',
      `      *"/combined"*) [ "$STUB_MODE" = slow-combined ] && { sleep 3; printf 'combined-done\\n' >> "${logPath}"; } ;;`,
      '    esac',
      '    ;;',
      '  *" --debug "*)',
      '    [ "$STUB_MODE" = list-fail ] && exit 3',
      '    ;;',
      'esac',
      `exec "${join(REPOSITORY_ROOT, 'node_modules/.bin/jscpd')}" "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(binary, 0o755);

  return {
    run: (targets = [], options = {}) =>
      spawnSync('bash', [join(root, 'scripts/checks/dup.sh'), ...targets], {
        encoding: 'utf8',
        cwd: root,
        env: {
          ...process.env,
          TMPDIR: stateDirectory,
          STUB_MODE: options.stub ?? '',
          ...options.environment,
        },
      }),
    file: (name, content) => {
      const path = join(root, name);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);

      return path;
    },
    invocations: () =>
      existsSync(logPath)
        ? readFileSync(logPath, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
        : [],
  };
}

function measuredPercentage(stderr: string, fileName: string): number {
  const figure = new RegExp(`${fileName}[^\\n]*?(\\d+(?:\\.\\d+)?)% duplicated`).exec(stderr)?.[1];

  return Number(figure);
}

afterEach(() => {
  removeTemporaryDirectories();
});

describe('scripts/checks/dup.sh large files', () => {
  it('warns about a file over 1000 lines that is over the threshold, naming its percentage', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WARNING[^\n]*src\/big\.ts[^\n]*\b\d+(\.\d+)?%/);
    expect(measuredPercentage(result.stderr, 'big\\.ts')).toBeGreaterThan(90);
  });

  it('warns about a file between 10% and 50% when FORCE_COLOR colors every node number', () => {
    const project = createProject();
    project.file('src/middling.ts', `${unique(1100)}\n${duplicated(30)}`);

    const result = project.run([], { environment: { FORCE_COLOR: '3' } });

    const percentage = measuredPercentage(result.stderr, 'middling\\.ts');
    expect(result.status).toBe(0);
    expect(percentage).toBeGreaterThan(10);
    expect(percentage).toBeLessThan(50);
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

  it('prints no warning for a large file that .gitignore or the jscpd config ignores', () => {
    const project = createProject();
    project.file('.gitignore', 'ignored/\n');
    project.file('ignored/big.ts', duplicated(120));
    project.file('ios/big.ts', duplicated(120));
    project.file('src/small.ts', unique(40));

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
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

  it('prints the warning again on a repeated scoped run whose blocking pass dedup skips', () => {
    const project = createProject();
    const changed = project.file('src/changed.ts', duplicated(120));
    const blockingCalls = () => project.invocations().filter((call) => !call.includes(' --'));

    const first = project.run([changed]);
    const blockingCallsAfterFirst = blockingCalls().length;
    const second = project.run([changed]);

    expect(first.stderr).toContain('WARNING');
    expect(second.status).toBe(0);
    expect(second.stderr).toMatch(/WARNING[^\n]*changed\.ts/);
    expect(blockingCalls()).toHaveLength(blockingCallsAfterFirst);
  });

  it('warns about every large file, in path order, when there are more than four', () => {
    const project = createProject();

    for (const name of ['f', 'e', 'd', 'c', 'b', 'a']) {
      project.file(`src/${name}.ts`, duplicated(120));
    }

    const result = project.run();

    const warned = [...result.stderr.matchAll(/WARNING: check:dup src\/(\w)\.ts/g)].map(
      (match) => match[1],
    );
    expect(warned).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('warns on the combined run when two large files copy each other', () => {
    const project = createProject();
    project.file('src/first.ts', unique(1100));
    project.file('src/second.ts', unique(1100));

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/WARNING: check:dup src\//);
    expect(measuredPercentage(result.stderr, 'combined run')).toBeGreaterThan(30);
  });

  it('starts the second batch of file measurements while the combined run is still going', () => {
    const project = createProject();

    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
      project.file(`src/${name}.ts`, duplicated(120));
    }

    const result = project.run([], { stub: 'slow-combined' });

    const calls = project.invocations();
    const combinedDone = calls.indexOf('combined-done');
    const fifthFileStart = calls.findIndex(
      (call) => call.includes('--silent') && call.includes('/5 ') && !call.includes('/combined'),
    );
    expect(result.status).toBe(0);
    expect(combinedDone).toBeGreaterThan(-1);
    expect(fifthFileStart).toBeGreaterThan(-1);
    expect(fifthFileStart).toBeLessThan(combinedDone);
  });

  it('runs no combined measurement when no file in scope is over the size limits', () => {
    const project = createProject();
    project.file('src/small.ts', unique(40));

    const result = project.run();

    expect(result.status).toBe(0);
    expect(project.invocations().filter((call) => call.includes('--silent'))).toHaveLength(0);
  });

  it('warns, never stays silent, when jscpd fails on a large file', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));

    const result = project.run([], { stub: 'measure-fail' });

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WARNING[^\n]*could not measure[^\n]*src\/big\.ts/);
  });

  it('warns when jscpd writes no figure for a large file', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));

    const result = project.run([], { stub: 'measure-empty' });

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WARNING[^\n]*could not measure[^\n]*src\/big\.ts/);
  });

  it('warns, never stays silent, when jscpd cannot list the files it skipped', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));

    const result = project.run([], { stub: 'list-fail' });

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WARNING[^\n]*could not list/);
  });

  it('stays silent when no file is over the size limits', () => {
    const project = createProject();
    project.file('src/small.ts', unique(40));

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
