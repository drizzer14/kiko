import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
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
  // Replaces the ceilings file's text; null removes the file.
  ceilings: (content: string | null) => void;
}

// The file the dup.sh large-file pass reads, beside dup.sh: one `<path>\t<percent>` row per
// listed file and one row under COMBINED_ROW for the no-argument combined baseline.
const CEILINGS_PATH = 'scripts/checks/dup-ceilings.tsv';
const COMBINED_ROW = '*combined*';

function ceilingsText(rows: Record<string, number>): string {
  return Object.entries(rows)
    .map(([name, percent]) => `${name}\t${percent}\n`)
    .join('');
}

function createProject(libraryPaddingLines = 0): Project {
  const root = createTemporaryDirectory('kiko-dup-large-');
  const stateDirectory = createTemporaryDirectory('kiko-dup-large-state-');
  const logPath = join(stateDirectory, 'invocations.log');
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });
  copyFileSync(join(REPOSITORY_ROOT, 'scripts/checks/dup.sh'), join(root, 'scripts/checks/dup.sh'));
  copyFileSync(
    join(REPOSITORY_ROOT, 'scripts/checks/_lib.sh'),
    join(root, 'scripts/checks/_lib.sh'),
  );
  const ceilingsFile = join(root, CEILINGS_PATH);
  writeFileSync(ceilingsFile, ceilingsText({ [COMBINED_ROW]: 100 }));
  appendFileSync(
    join(root, 'scripts/checks/_lib.sh'),
    Array.from({ length: libraryPaddingLines }, (_unused, index) => `# padding ${index}\n`).join(
      '',
    ),
  );
  // jscpd's threshold is the duplicated percentage over every file it scans, so the copied
  // scripts would be part of the denominator and their size would decide the small-file cases.
  // The project keeps the repository's own rules and only ignores its copies.
  const repositoryConfig = JSON.parse(readFileSync(join(REPOSITORY_ROOT, '.jscpd.json'), 'utf8'));
  writeFileSync(
    join(root, '.jscpd.json'),
    JSON.stringify({
      ...repositoryConfig,
      ignore: [...repositoryConfig.ignore, 'scripts/checks/**'],
    }),
  );
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
    ceilings: (content) => {
      if (content === null) {
        rmSync(ceilingsFile, { force: true });
      } else {
        writeFileSync(ceilingsFile, content);
      }
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

const NEVER_FAILS = 100;

// The rows that test the warning's format, order and batching list their fixtures in the
// ceilings file, so the WARNING path runs; the unlisted-file verdict has its own row below.
function listAtNeverFailingCeiling(project: Project, names: string[]): void {
  project.ceilings(
    ceilingsText({
      ...Object.fromEntries(names.map((name) => [name, NEVER_FAILS])),
      [COMBINED_ROW]: NEVER_FAILS,
    }),
  );
}

describe('scripts/checks/dup.sh large files', () => {
  it('warns about a file over 1000 lines that is over the threshold, naming its percentage', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));
    listAtNeverFailingCeiling(project, ['src/big.ts']);

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WARNING[^\n]*src\/big\.ts[^\n]*\b\d+(\.\d+)?%/);
    expect(measuredPercentage(result.stderr, 'big\\.ts')).toBeGreaterThan(90);
  });

  it('warns about a file between 10% and 50% when FORCE_COLOR colors every node number', () => {
    const project = createProject();
    project.file('src/middling.ts', `${unique(1100)}\n${duplicated(30)}`);
    listAtNeverFailingCeiling(project, ['src/middling.ts']);

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
    listAtNeverFailingCeiling(project, ['src/wide.ts']);

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

  it.each([300, 2000])(
    'still fails on a small duplicated file when the copied _lib.sh holds %i more lines',
    (paddingLines) => {
      const project = createProject(paddingLines);
      project.file('src/small.ts', duplicated(5));

      const result = project.run();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('CHECK FAILED');
    },
  );

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
    listAtNeverFailingCeiling(project, ['src/changed.ts', 'src/untouched.ts']);

    const result = project.run([changed]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('changed.ts');
    expect(result.stderr).not.toContain('untouched.ts');
  });

  it('prints the warning again on a repeated scoped run whose blocking pass dedup skips', () => {
    const project = createProject();
    const changed = project.file('src/changed.ts', duplicated(120));
    listAtNeverFailingCeiling(project, ['src/changed.ts']);
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

    listAtNeverFailingCeiling(
      project,
      ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `src/${name}.ts`),
    );

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

    listAtNeverFailingCeiling(
      project,
      ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `src/${name}.ts`),
    );

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

  it('fails, never stays silent, when jscpd fails on a large file (flipped by P11 A row 6, pending user)', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));
    listAtNeverFailingCeiling(project, ['src/big.ts']);

    const result = project.run([], { stub: 'measure-fail' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED');
    expect(result.stderr).toMatch(/could not measure[^\n]*src\/big\.ts[^\n]*jscpd failed/);
  });

  it('fails when jscpd writes no figure for a large file (flipped by P11 A row 6, pending user)', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));
    listAtNeverFailingCeiling(project, ['src/big.ts']);

    const result = project.run([], { stub: 'measure-empty' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED');
    expect(result.stderr).toMatch(/could not measure[^\n]*src\/big\.ts[^\n]*no figure/);
  });

  it('fails, never stays silent, when jscpd cannot list the files it skipped (flipped by P11 A row 6, pending user)', () => {
    const project = createProject();
    project.file('src/big.ts', duplicated(120));
    listAtNeverFailingCeiling(project, ['src/big.ts']);

    const result = project.run([], { stub: 'list-fail' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED');
    expect(result.stderr).toMatch(/could not list/);
  });

  it('stays silent when no file is over the size limits', () => {
    const project = createProject();
    project.file('src/small.ts', unique(40));

    const result = project.run();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});

// The figure jscpd measures, alone with the limits raised, for LISTED_CONTENT; jscpd is
// deterministic, so the ceiling rows below can sit exactly at it and 0.01 under it.
const LISTED_CONTENT = `${unique(1100)}\n${duplicated(30)}`;
const LISTED_FIGURE = 18.98;
const LISTED_PATH = 'src/listed.ts';

function listedRow(ceiling: number): string {
  return ceilingsText({ [LISTED_PATH]: ceiling, [COMBINED_ROW]: NEVER_FAILS });
}

describe('scripts/checks/dup.sh ceilings file', () => {
  it('measures the listed fixture at the figure the rows assume', () => {
    const project = createProject();
    project.file(LISTED_PATH, LISTED_CONTENT);
    project.ceilings(listedRow(NEVER_FAILS));

    const result = project.run();

    expect(measuredPercentage(result.stderr, 'listed\\.ts')).toBe(LISTED_FIGURE);
  });

  describe('a listed file', () => {
    it.each([
      ['well under its ceiling', LISTED_FIGURE + 10],
      ['exactly at its ceiling', LISTED_FIGURE],
    ])('stays a WARNING, exit 0, when %s', (_title, ceiling) => {
      const project = createProject();
      project.file(LISTED_PATH, LISTED_CONTENT);
      project.ceilings(listedRow(ceiling));

      const result = project.run();

      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(
        /WARNING: check:dup src\/listed\.ts is over jscpd's size limit/,
      );
      expect(result.stderr).not.toContain('CHECK FAILED');
    });

    it.each([
      ['0.01 above its ceiling', LISTED_FIGURE - 0.01],
      ['far above its ceiling', 5],
    ])('FAILS, exit 2, naming the file, its figure and its ceiling, when %s', (_title, ceiling) => {
      const project = createProject();
      project.file(LISTED_PATH, LISTED_CONTENT);
      project.ceilings(listedRow(ceiling));

      const result = project.run();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('CHECK FAILED');
      expect(result.stderr).toContain(LISTED_PATH);
      expect(result.stderr).toContain(String(LISTED_FIGURE));
      expect(result.stderr).toContain(String(ceiling));
    });

    it('FAILS on every repeated scoped run, because the dedup skips only the blocking pass', () => {
      const project = createProject();
      const listed = project.file(LISTED_PATH, LISTED_CONTENT);
      project.ceilings(listedRow(LISTED_FIGURE - 0.01));

      const first = project.run([listed]);
      const second = project.run([listed]);

      expect([first.status, second.status]).toEqual([2, 2]);
      expect(second.stderr).toContain(LISTED_PATH);
    });

    it('is a WARNING that names the file when its row points at a deleted file', () => {
      const project = createProject();
      project.file('src/small.ts', unique(40));
      project.ceilings(ceilingsText({ 'src/gone.ts': 9, [COMBINED_ROW]: NEVER_FAILS }));

      const result = project.run();

      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/WARNING[^\n]*src\/gone\.ts/);
    });
  });

  describe('a file that is not listed', () => {
    it('FAILS, exit 2, naming the file, when it is over the size limit and over the threshold', () => {
      const project = createProject();
      project.file('src/unlisted.ts', duplicated(120));

      const result = project.run();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('CHECK FAILED');
      expect(result.stderr).toContain('src/unlisted.ts');
    });

    it('stays silent, exit 0, over 1000 lines and under the threshold', () => {
      const project = createProject();
      project.file('src/unlisted.ts', unique(1101));

      const result = project.run();

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('stays silent, exit 0, when a large file measures under the threshold', () => {
      const project = createProject();
      project.file('src/mostly-clean.ts', `${unique(1100)}\n${duplicated(2)}`);

      const result = project.run();

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  describe('the combined figure', () => {
    const copyingFiles = (project: Project) => [
      project.file('src/first.ts', unique(1100)),
      project.file('src/second.ts', unique(1100)),
    ];

    it('FAILS, exit 2, on a no-argument run above its baseline', () => {
      const project = createProject();
      copyingFiles(project);
      project.ceilings(ceilingsText({ [COMBINED_ROW]: 7.33 }));

      const result = project.run();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('CHECK FAILED');
      expect(result.stderr).toContain('combined');
      expect(result.stderr).toContain('7.33');
    });

    it('stays a WARNING, exit 0, on a no-argument run at or under its baseline', () => {
      const project = createProject();
      copyingFiles(project);
      project.ceilings(ceilingsText({ [COMBINED_ROW]: NEVER_FAILS }));

      const result = project.run();

      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/WARNING: check:dup combined run/);
    });

    it('stays a WARNING, exit 0, on a scoped run above the baseline', () => {
      const project = createProject();
      const scope = copyingFiles(project);
      project.ceilings(ceilingsText({ [COMBINED_ROW]: 7.33 }));

      const result = project.run(scope);

      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/WARNING: check:dup combined run/);
      expect(result.stderr).not.toContain('CHECK FAILED');
    });
  });

  describe('fails closed', () => {
    // A file over 100kb is skipped by size, from its stat, before jscpd reads it; only the
    // raised-limit listing reads it, so an unreadable one is a real jscpd failure of that pass.
    it('with exit 2 when jscpd fails to list a large file it cannot read', () => {
      const project = createProject();
      const unreadable = project.file(
        LISTED_PATH,
        `${duplicated(3)}${`export const padding = '${'x'.repeat(2000)}';\n`.repeat(60)}`,
      );
      project.ceilings(listedRow(NEVER_FAILS));
      chmodSync(unreadable, 0o000);

      const result = project.run();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('CHECK FAILED');
    });

    it('with exit 2 when the ceilings file is missing and only small files are in scope', () => {
      const project = createProject();
      const small = project.file('src/small.ts', unique(40));
      project.ceilings(null);

      const result = project.run([small]);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('CHECK FAILED');
      expect(result.stderr).toContain('dup-ceilings.tsv');
    });

    it('with exit 2 when the ceilings file is missing', () => {
      const project = createProject();
      project.file(LISTED_PATH, LISTED_CONTENT);
      project.ceilings(null);

      const result = project.run();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('CHECK FAILED');
      expect(result.stderr).toContain('dup-ceilings.tsv');
    });

    it.each([
      ['a percentage that is not a number', `${LISTED_PATH}\tabc\n${COMBINED_ROW}\t100\n`],
      ['a row with no tab', `${LISTED_PATH} 18.98\n${COMBINED_ROW}\t100\n`],
      ['an empty percentage', `${LISTED_PATH}\t\n${COMBINED_ROW}\t100\n`],
      ['a negative percentage', `${LISTED_PATH}\t-1\n${COMBINED_ROW}\t100\n`],
      ['a repeated path', `${LISTED_PATH}\t10\n${LISTED_PATH}\t20\n${COMBINED_ROW}\t100\n`],
      ['no combined row', `${LISTED_PATH}\t10\n`],
    ])('with exit 2 when the ceilings file holds %s', (_title, content) => {
      const project = createProject();
      project.file(LISTED_PATH, LISTED_CONTENT);
      project.ceilings(content);

      const result = project.run();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('CHECK FAILED');
      expect(result.stderr).toContain('dup-ceilings.tsv');
    });
  });

  it('still exits 2 and names the path when a path argument was deleted', () => {
    const project = createProject();

    const result = project.run(['src/gone/does-not-exist.test.ts']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('does not exist');
  });
});
