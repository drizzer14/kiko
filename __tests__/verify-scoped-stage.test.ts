import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { readTextFile } from './test-support/read-text-file';
import { isolatedGitEnvironment } from './test-support/isolated-git';

// Stage 2b runs the real-semgrep suites for 10 minutes. A scoped verify skips it when no path that
// the suites can read changed (scripts/checks/semgrep-suite-triggers.txt), so each row below reads
// the jest call count: 2 means 2b ran, 1 means it was skipped, and the absence is never vacuous.
const ROOT = join(__dirname, '..');
const VERIFY_SCRIPT = join(ROOT, 'scripts/checks/verify.sh');
const SUITE_LIST = join(ROOT, 'scripts/checks/semgrep-jest-suites.txt');
const TRIGGER_LIST = join(ROOT, 'scripts/checks/semgrep-suite-triggers.txt');
const SKIPPED_HEADER = '── make verify: stage 2b SKIPPED (';
const RUNS_IN_FULL_HEADER = '── make verify: stage 2b runs in full (';

jest.setTimeout(120_000);

afterEach(() => {
  removeTemporaryDirectories();
});

type Fixture = {
  git: (...gitArguments: string[]) => string;
  commit: (files: Record<string, string>, message?: string) => string;
  root: string;
  home: string;
};

type VerifyRun = {
  jestCalls: number;
  flagSeen: string[];
  status: number | null;
  stderr: string;
  stdout: string;
};

type FixtureOptions = { triggerList?: string | null };

// Extra executables written into the stub folder after the defaults, so a row can wrap git or
// replace mktemp; each text is a whole script.
type StubScripts = (context: { stubs: string; realGit: string }) => Record<string, string>;

type VerifyOptions = {
  flag?: string | null;
  failingGitCommand?: string;
  stubScripts?: StubScripts;
};

const realGit = (): string =>
  spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim() || '/usr/bin/git';

// A repository on `main` holding copies of verify.sh and the two lists, so the branch commit of a
// row changes only the paths that row names.
const createFixture = (options: FixtureOptions = {}): Fixture => {
  const root = createTemporaryDirectory('kiko-verify-scoped-');
  const home = createTemporaryDirectory('kiko-verify-scoped-home-');
  const environment = isolatedGitEnvironment(home, {
    GIT_AUTHOR_NAME: 'Kiko Test',
    GIT_AUTHOR_EMAIL: 'test@kiko.invalid',
    GIT_COMMITTER_NAME: 'Kiko Test',
    GIT_COMMITTER_EMAIL: 'test@kiko.invalid',
  });
  const git = (...gitArguments: string[]): string => {
    const result = spawnSync('git', gitArguments, {
      cwd: root,
      encoding: 'utf8',
      env: environment,
    });

    if (result.status !== 0) throw new Error(`git ${gitArguments.join(' ')}: ${result.stderr}`);

    return result.stdout.trim();
  };
  const commit = (files: Record<string, string>, message = 'change'): string => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }

    git('add', '-A');
    git('commit', '-q', '-m', message);

    return git('rev-parse', 'HEAD');
  };

  git('init', '-q', '-b', 'main');
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });
  copyFileSync(VERIFY_SCRIPT, join(root, 'scripts/checks/verify.sh'));
  copyFileSync(SUITE_LIST, join(root, 'scripts/checks/semgrep-jest-suites.txt'));

  if (options.triggerList === undefined) {
    copyFileSync(TRIGGER_LIST, join(root, 'scripts/checks/semgrep-suite-triggers.txt'));
  } else if (options.triggerList !== null) {
    writeFileSync(join(root, 'scripts/checks/semgrep-suite-triggers.txt'), options.triggerList);
  }

  commit(
    {
      'scripts/a.sh': 'echo a\n',
      'src/keep.ts': 'export const keep = 1;\n',
      'harness/kiko/run.sh': 'echo run\n',
      'harness/existing.md': 'existing\n',
    },
    'base',
  );

  return { git, commit, root, home };
};

// Every stub logs the flag it sees, so the log names one entry per stage that ran.
const runVerify = (fixture: Fixture, options: VerifyOptions = {}): VerifyRun => {
  const flag = options.flag === undefined ? '1' : options.flag;
  const stubs = createTemporaryDirectory('kiko-verify-scoped-stubs-');
  const log = join(stubs, 'calls.log');
  const record = [
    '#!/bin/sh',
    'if [ "$1" = jest ]; then label=jest; else label=gate; fi',
    `printf '%s|%s\\n' "$label" "\${KIKO_VERIFY_SCOPED-unset}" >> "${log}"`,
    'exit 0',
    '',
  ].join('\n');

  writeFileSync(log, '');

  for (const [name, text] of [
    ['npm', record],
    ['npx', record],
    ['node', '#!/bin/sh\nexit 0\n'],
  ] as const) {
    writeFileSync(join(stubs, name), text);
    chmodSync(join(stubs, name), 0o755);
  }

  if (options.failingGitCommand !== undefined) {
    writeFileSync(
      join(stubs, 'git'),
      `#!/bin/sh\nif [ "$1" = ${options.failingGitCommand} ]; then exit 1; fi\nexec "${realGit()}" "$@"\n`,
    );
    chmodSync(join(stubs, 'git'), 0o755);
  }

  const extraStubs = options.stubScripts?.({ stubs, realGit: realGit() }) ?? {};

  for (const [name, text] of Object.entries(extraStubs)) {
    writeFileSync(join(stubs, name), text);
    chmodSync(join(stubs, name), 0o755);
  }

  const environment: NodeJS.ProcessEnv = {
    ...isolatedGitEnvironment(fixture.home),
    PATH: `${stubs}:${process.env.PATH}`,
    KIKO_VERIFY_SCOPED: undefined,
  };

  if (flag !== null) environment.KIKO_VERIFY_SCOPED = flag;

  const result = spawnSync('bash', [join(fixture.root, 'scripts/checks/verify.sh')], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: environment,
  });
  const entries = readTextFile(log)
    .split('\n')
    .filter((line) => line !== '');

  return {
    jestCalls: entries.filter((entry) => entry.startsWith('jest|')).length,
    flagSeen: entries.map((entry) => entry.split('|')[1] ?? ''),
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
};

const reasonLine = (run: VerifyRun): string =>
  run.stdout.split('\n').find((line) => line.startsWith(RUNS_IN_FULL_HEADER)) ?? '';

// A work branch with one commit of the given files, off the base on main.
const branchWith = (fixture: Fixture, files: Record<string, string>): void => {
  fixture.git('switch', '-q', '-c', 'work');
  fixture.commit(files);
};

const expectFullRun = (run: VerifyRun, reasonFragment: string): void => {
  expect({ jestCalls: run.jestCalls, status: run.status }).toEqual({ jestCalls: 2, status: 0 });
  expect(reasonLine(run)).toContain(reasonFragment);
};

const expectSkip = (run: VerifyRun): void => {
  expect({ jestCalls: run.jestCalls, status: run.status }).toEqual({ jestCalls: 1, status: 0 });
  expect(run.stdout.split('\n').filter((line) => line.startsWith(SKIPPED_HEADER))).toHaveLength(1);
  expect(reasonLine(run)).toBe('');
};

const srcOnly = { 'src/new.ts': 'export const created = 1;\n' };

describe('scripts/checks/verify.sh scoped stage 2b skip', () => {
  it('skips 2b on a branch that changes only a src file', () => {
    const fixture = createFixture();
    const mainTip = fixture.git('rev-parse', 'main');

    branchWith(fixture, srcOnly);

    const run = runVerify(fixture);

    expectSkip(run);
    expect(run.stdout).toContain(
      `${SKIPPED_HEADER}no trigger path changed since ${mainTip.slice(0, 12)}) ──`,
    );
    expect(run.stdout).toContain('✔ make verify: gate and stage 2a passed; stage 2b skipped');
    expect(run.stdout).not.toContain('── make verify: stage 2b (');
  });

  it.each([
    'scriptsother/a.txt',
    'Makefile.old',
    'package.json.bak',
    '__tests__/other.test.ts',
    'src/i18n/locales/uk.ts',
  ])('skips 2b on a change near a trigger: %s', (path) => {
    const fixture = createFixture();

    branchWith(fixture, { [path]: 'changed\n' });

    expectSkip(runVerify(fixture));
  });

  it('measures from the newer base when next contains main', () => {
    const fixture = createFixture();

    fixture.git('switch', '-q', '-c', 'next');
    fixture.commit({ 'rules/x.yml': 'rules: []\n' });
    branchWith(fixture, srcOnly);

    expectSkip(runVerify(fixture));
  });

  it('measures from the newer base when main contains next', () => {
    const fixture = createFixture();

    fixture.git('branch', 'next');
    fixture.commit({ 'rules/x.yml': 'rules: []\n' });
    branchWith(fixture, srcOnly);

    expectSkip(runVerify(fixture));
  });

  it('works with no local next branch', () => {
    const fixture = createFixture();

    fixture.commit({ 'rules/x.yml': 'rules: []\n' });
    branchWith(fixture, srcOnly);

    expect(fixture.git('branch', '--list', 'next')).toBe('');
    expectSkip(runVerify(fixture));
  });

  it('measures from the shared base when next sits at the same commit as main', () => {
    const fixture = createFixture();

    fixture.git('branch', 'next');
    branchWith(fixture, srcOnly);

    expectSkip(runVerify(fixture));
  });

  it('skips 2b when the trigger list has trigger lines and no exclude line', () => {
    const fixture = createFixture({ triggerList: 'scripts/\nrules/\n' });

    branchWith(fixture, srcOnly);

    expectSkip(runVerify(fixture));
  });
});

describe('scripts/checks/verify.sh scoped stage 2b runs in full', () => {
  it('runs 2b when the flag is unset', () => {
    const fixture = createFixture();

    branchWith(fixture, srcOnly);

    expectFullRun(runVerify(fixture, { flag: null }), 'no --scoped');
  });

  it.each(['0', 'true', ''])('runs 2b when the flag is %p', (flag) => {
    const fixture = createFixture();

    branchWith(fixture, srcOnly);

    expectFullRun(runVerify(fixture, { flag }), 'no --scoped');
  });

  it('runs 2b when main is missing', () => {
    const fixture = createFixture();

    branchWith(fixture, srcOnly);
    fixture.git('branch', '-m', 'main', 'trunk');

    expectFullRun(runVerify(fixture), 'main');
  });

  // Two commits that each merged the other's parent have two best common ancestors.
  const crissCross = (fixture: Fixture): string => {
    fixture.git('switch', '-q', '-c', 'left');
    const left = fixture.commit({ 'src/left.ts': 'left\n' });

    fixture.git('switch', '-q', '-c', 'right', 'main');
    fixture.commit({ 'src/right.ts': 'right\n' });
    fixture.git('merge', '-q', '--no-edit', left);

    const rightMerge = fixture.git('rev-parse', 'HEAD');

    fixture.git('switch', '-q', 'left');
    fixture.git('merge', '-q', '--no-edit', 'right~1');
    fixture.git('switch', '-q', '-c', 'work', rightMerge);
    fixture.commit(srcOnly);

    return fixture.git('rev-parse', 'left');
  };

  it('runs 2b when HEAD has two merge bases with main', () => {
    const fixture = createFixture();
    const leftMerge = crissCross(fixture);

    fixture.git('branch', '-f', 'main', leftMerge);

    expectFullRun(runVerify(fixture), 'merge base');
  });

  it('runs 2b when HEAD has two merge bases with next', () => {
    const fixture = createFixture();
    const leftMerge = crissCross(fixture);

    fixture.git('branch', 'next', leftMerge);

    expectFullRun(runVerify(fixture), 'merge base');
  });

  it('runs 2b when neither base contains the other', () => {
    const fixture = createFixture();

    fixture.git('switch', '-q', '-c', 'next');
    fixture.commit({ 'src/next.ts': 'next\n' });
    fixture.git('switch', '-q', 'main');
    fixture.commit({ 'src/main.ts': 'main\n' });
    fixture.git('switch', '-q', '-c', 'work');
    fixture.git('merge', '-q', '--no-edit', 'next');
    fixture.commit(srcOnly);

    expectFullRun(runVerify(fixture), 'neither');
  });

  it('runs 2b when HEAD is on main', () => {
    const fixture = createFixture();

    fixture.commit(srcOnly);

    expectFullRun(runVerify(fixture), 'reachable');
  });

  it('runs 2b when HEAD is on next', () => {
    const fixture = createFixture();

    fixture.git('switch', '-q', '-c', 'next');
    fixture.commit(srcOnly);

    expectFullRun(runVerify(fixture), 'reachable');
  });

  it('runs 2b when HEAD is behind the main tip', () => {
    const fixture = createFixture();
    const older = fixture.git('rev-parse', 'HEAD');

    fixture.commit(srcOnly);
    fixture.git('switch', '-q', '--detach', older);

    expectFullRun(runVerify(fixture), 'reachable');
  });

  it('runs 2b when a merge-base call fails', () => {
    const fixture = createFixture();

    branchWith(fixture, srcOnly);

    expectFullRun(runVerify(fixture, { failingGitCommand: 'merge-base' }), 'merge-base');
  });

  it('runs 2b when the diff call fails', () => {
    const fixture = createFixture();

    branchWith(fixture, srcOnly);

    expectFullRun(runVerify(fixture, { failingGitCommand: 'diff' }), 'diff');
  });

  it.each(['refs/heads/main', 'refs/heads/next'])(
    'runs 2b when the rev-parse of %s fails',
    (ref) => {
      const fixture = createFixture();

      fixture.git('branch', 'next');
      branchWith(fixture, srcOnly);

      const run = runVerify(fixture, {
        stubScripts: ({ realGit: git }) => ({
          git: [
            '#!/bin/sh',
            'for argument in "$@"; do',
            `  if [ "$1" = rev-parse ] && [ "$argument" = ${ref} ]; then exit 128; fi`,
            'done',
            `exec "${git}" "$@"`,
            '',
          ].join('\n'),
        }),
      });

      expectFullRun(run, 'rev-parse');
    },
  );

  it('runs 2b when HEAD has no merge base with main', () => {
    const fixture = createFixture();

    fixture.git('checkout', '-q', '--orphan', 'work');
    fixture.commit(srcOnly);

    expectFullRun(runVerify(fixture), 'git merge-base against refs/heads/main');
  });

  // Call 1 asks whether the main base is inside the next base (next contains main); call 2 is
  // the mirror and only runs when call 1 answers no (main contains next).
  it.each([
    [1, 'next contains main'],
    [2, 'main contains next'],
  ])('runs 2b when the is-ancestor call %i fails and %s', (failingCall, arrangement) => {
    const fixture = createFixture();

    if (arrangement === 'next contains main') {
      fixture.git('switch', '-q', '-c', 'next');
      fixture.commit({ 'rules/x.yml': 'rules: []\n' });
    } else {
      fixture.git('branch', 'next');
      fixture.commit({ 'rules/x.yml': 'rules: []\n' });
    }

    branchWith(fixture, srcOnly);

    const run = runVerify(fixture, {
      stubScripts: ({ stubs, realGit: git }) => ({
        git: [
          '#!/bin/sh',
          'if [ "$1" = merge-base ] && [ "$2" = --is-ancestor ]; then',
          `  count=$(( $(cat "${stubs}/count" 2>/dev/null || echo 0) + 1 ))`,
          `  echo "$count" > "${stubs}/count"`,
          `  if [ "$count" = ${failingCall} ]; then exit 3; fi`,
          'fi',
          `exec "${git}" "$@"`,
          '',
        ].join('\n'),
      }),
    });

    expectFullRun(run, 'is-ancestor');
  });

  it('runs 2b when the changed-path listing cannot be read after the diff', () => {
    const fixture = createFixture();

    branchWith(fixture, srcOnly);

    const run = runVerify(fixture, {
      stubScripts: ({ stubs, realGit: git }) => ({
        mktemp: `#!/bin/sh\n: > "${stubs}/listing"\necho "${stubs}/listing"\n`,
        git: `#!/bin/sh\n"${git}" "$@"\ncode=$?\nif [ "$1" = diff ]; then rm -f "${stubs}/listing"; fi\nexit $code\n`,
      }),
    });

    expectFullRun(run, 'changed-path listing');
  });

  it('runs 2b when the trigger list cannot be read', () => {
    const fixture = createFixture();

    branchWith(fixture, srcOnly);
    chmodSync(join(fixture.root, 'scripts/checks/semgrep-suite-triggers.txt'), 0o000);

    expectFullRun(runVerify(fixture), 'trigger list could not be read');
  });

  it('prints no marker line forged by a newline in a changed path', () => {
    const fixture = createFixture();
    const forged = `${SKIPPED_HEADER}x`;

    branchWith(fixture, { [`scripts/a\n${forged}`]: 'x\n' });

    const run = runVerify(fixture);
    const lines = run.stdout.split('\n');

    expect({ jestCalls: run.jestCalls, status: run.status }).toEqual({ jestCalls: 2, status: 0 });
    expect(lines.filter((line) => line.startsWith(SKIPPED_HEADER))).toEqual([]);
    expect(lines.filter((line) => line.startsWith(RUNS_IN_FULL_HEADER))).toHaveLength(1);
  });

  it('runs 2b when a trigger path changed and the trigger list has no exclude line', () => {
    const fixture = createFixture({ triggerList: 'scripts/\nrules/\n' });

    branchWith(fixture, { 'rules/x.yml': 'rules: []\n' });

    expectFullRun(runVerify(fixture), 'rules/x.yml');
  });

  it('runs 2b when a Cyrillic path under scripts/ changed', () => {
    const fixture = createFixture();

    branchWith(fixture, { 'scripts/файл.sh': 'echo\n' });

    expectFullRun(runVerify(fixture), 'scripts/файл.sh');
  });

  it('runs 2b when a file was renamed out of scripts/', () => {
    const fixture = createFixture();

    fixture.git('switch', '-q', '-c', 'work');
    mkdirSync(join(fixture.root, 'src'), { recursive: true });
    renameSync(join(fixture.root, 'scripts/a.sh'), join(fixture.root, 'src/a.sh'));
    fixture.commit({}, 'rename');

    expectFullRun(runVerify(fixture), 'scripts/a.sh');
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['comments only', '# nothing\n'],
    ['spaces only', '   \n\t\n'],
    ['an exclude with no trigger line', '!harness/*.md\n'],
  ])('runs 2b when the trigger list is %s', (_name, triggerList) => {
    const fixture = createFixture({ triggerList });

    branchWith(fixture, srcOnly);

    expectFullRun(runVerify(fixture), 'trigger list');
  });

  it('runs 2b when a merge commit brings in a trigger path', () => {
    const fixture = createFixture();

    fixture.git('switch', '-q', '-c', 'side');
    fixture.commit({ 'rules/x.yml': 'rules: []\n' });
    fixture.git('switch', '-q', '-c', 'work', 'main');
    fixture.commit(srcOnly);
    fixture.git('merge', '-q', '--no-edit', 'side');

    expectFullRun(runVerify(fixture), 'rules/x.yml');
  });

  it('runs 2b when a listed suite changed', () => {
    const fixture = createFixture();

    branchWith(fixture, { '__tests__/guard-replay.test.ts': 'changed\n' });

    expectFullRun(runVerify(fixture), '__tests__/guard-replay.test.ts');
  });

  it('runs 2b when the en catalogue changed', () => {
    const fixture = createFixture();

    branchWith(fixture, { 'src/i18n/locales/en.ts': 'export const en = {};\n' });

    expectFullRun(runVerify(fixture), 'src/i18n/locales/en.ts');
  });

  const shippedEntries = readTextFile(TRIGGER_LIST)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const shippedTriggerLines = shippedEntries.filter((line) => !line.startsWith('!'));

  it('the shipped list holds exactly the specified trigger lines and the Markdown exclude', () => {
    expect([...shippedEntries].sort()).toEqual(
      [
        'scripts/',
        'rules/',
        'harness/',
        'githooks/',
        'patches/',
        '__mocks__/',
        'jest/',
        '__tests__/test-support/',
        'package.json',
        'package-lock.json',
        'jest.config.js',
        'babel.config.js',
        'tsconfig.json',
        '.env.test',
        'biome.json',
        'Makefile',
        'src/i18n/locales/en.ts',
        '!harness/*.md',
      ].sort(),
    );
  });

  it.each(shippedTriggerLines)('runs 2b when a trigger line matches: %s', (line) => {
    const fixture = createFixture();
    const path = line.endsWith('/') ? `${line}zz/changed.txt` : line;

    branchWith(fixture, { [path]: 'changed\n' });

    expectFullRun(runVerify(fixture), path);
  });

  it.each([
    'package.json',
    'package-lock.json',
    'jest.config.js',
    'babel.config.js',
    'tsconfig.json',
    '.env.test',
    'jest/x',
    '__mocks__/x',
    'patches/x',
  ])('the shipped list holds every path of the jest-affected every-suite group: %s', (path) => {
    const fixture = createFixture();

    branchWith(fixture, { [path]: 'changed\n' });

    expectFullRun(runVerify(fixture), path);
  });

  it('prints the first trigger path in diff order, once', () => {
    const fixture = createFixture();

    branchWith(fixture, { 'rules/a.yml': 'a\n', 'scripts/b.sh': 'b\n' });

    const run = runVerify(fixture);
    const mentions = run.stdout.split('\n').filter((line) => line.includes('rules/a.yml'));

    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toContain(RUNS_IN_FULL_HEADER);
    expect(run.stdout).not.toContain('scripts/b.sh');
  });
});

describe('scripts/checks/verify.sh scoped markdown exclude under harness/', () => {
  it.each([
    ['a nested skill file', 'harness/kiko/skills/x/SKILL.md'],
    ['a top-level file', 'harness/top.md'],
    ['a Cyrillic path', 'harness/kiko/файл.md'],
  ])('skips 2b for %s', (_name, path) => {
    const fixture = createFixture();

    branchWith(fixture, { [path]: 'text\n' });

    expectSkip(runVerify(fixture));
  });

  it.each([
    ['a shell script', { 'harness/kiko/hooks/dispatch.sh': 'echo\n' }, 'dispatch.sh'],
    [
      'a Markdown file beside a non-Markdown file',
      { 'harness/a.md': 'a\n', 'harness/b.json': '{}\n' },
      'harness/b.json',
    ],
    ['a name that only contains .md', { 'harness/x.md.sh': 'echo\n' }, 'harness/x.md.sh'],
    ['a Cyrillic non-Markdown path', { 'harness/kiko/файл.sh': 'echo\n' }, 'harness/kiko/файл.sh'],
    ['an upper-case extension', { 'harness/x.MD': 'x\n' }, 'harness/x.MD'],
    ['Markdown outside harness/', { 'scripts/notes.md': 'x\n' }, 'scripts/notes.md'],
  ])('runs 2b for %s', (_name, files, fragment) => {
    const fixture = createFixture();

    branchWith(fixture, files);

    expectFullRun(runVerify(fixture), fragment);
  });

  it('runs 2b when a shell script was renamed to Markdown', () => {
    const fixture = createFixture();

    fixture.git('switch', '-q', '-c', 'work');
    renameSync(
      join(fixture.root, 'harness/kiko/run.sh'),
      join(fixture.root, 'harness/kiko/run.md'),
    );
    fixture.commit({}, 'rename');

    expectFullRun(runVerify(fixture), 'harness/kiko/run.sh');
  });
});

describe('scripts/checks/verify.sh scoped flag handling', () => {
  it('hides the flag from every stage', () => {
    const fixture = createFixture();

    branchWith(fixture, { 'rules/x.yml': 'rules: []\n' });

    const run = runVerify(fixture);

    expect({ jestCalls: run.jestCalls, flagSeen: run.flagSeen }).toEqual({
      jestCalls: 2,
      flagSeen: ['unset', 'unset', 'unset'],
    });
  });
});
