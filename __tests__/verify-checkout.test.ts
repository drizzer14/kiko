import {
  rmSync,
  chmodSync,
  existsSync,
  mkdirSync,
  lstatSync,
  symlinkSync,
  realpathSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { warmExecutables } from './test-support/warm-executables';
import { writeExecutable } from './test-support/mutation-repository';
import { isolatedGitEnvironment } from './test-support/isolated-git';

// scripts/verify-checkout.sh prepares the one shared checkout a queued verify runs in. Each row
// runs the real script against a throwaway repository, with `npm` and `node` stubbed: nothing
// installs.
const SCRIPT = join(__dirname, '../scripts/verify-checkout.sh');
const STAMP = 'node_modules/.kiko-verify-install';

jest.setTimeout(120_000);

afterEach(() => {
  removeTemporaryDirectories();
});

const NPM_STUB = [
  '#!/usr/bin/env bash',
  '{ printf "npm %s\\n" "$*"; printf "cwd %s\\n" "$PWD"; } >> "$KIKO_STUB_NPM_CALLS"',
  'exit "$(printenv KIKO_STUB_NPM_EXIT || echo 0)"',
  '',
].join('\n');

const NODE_STUB = [
  '#!/usr/bin/env bash',
  'if [ "$1" = --version ]; then printf "%s\\n" "$KIKO_STUB_NODE_VERSION"; exit 0; fi',
  '{ printf "node %s\\n" "$*"; printf "cwd %s\\n" "$PWD"; } >> "$KIKO_STUB_NODE_CALLS"',
  'exit "$(printenv KIKO_STUB_NODE_EXIT || echo 0)"',
  '',
].join('\n');

type Fixture = {
  repository: string;
  checkout: string;
  environment: NodeJS.ProcessEnv;
  commit: (files: Record<string, string>) => string;
  run: (sha: string, extra?: NodeJS.ProcessEnv) => SpawnSyncReturns<string>;
  runAt: (checkoutPath: string, sha: string) => SpawnSyncReturns<string>;
  git: (directory: string, ...gitArguments: string[]) => SpawnSyncReturns<string>;
  mustGit: (directory: string, ...gitArguments: string[]) => string;
  npmCalls: () => string[];
  nodeCalls: () => string[];
};

const readLines = (path: string): string[] =>
  existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : [];

const writeTree = (root: string, files: Record<string, string>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
};

type FixtureNames = { parentPrefix?: string; repositoryName?: string };

const createFixture = ({
  parentPrefix = 'kiko-verify-checkout-',
  repositoryName = 'repository',
}: FixtureNames = {}): Fixture => {
  const parent = createTemporaryDirectory(parentPrefix);
  const home = createTemporaryDirectory('kiko-verify-checkout-home-');
  const stubs = join(parent, 'stubs');
  mkdirSync(stubs);
  warmExecutables([
    writeExecutable(join(stubs, 'npm'), NPM_STUB),
    writeExecutable(join(stubs, 'node'), NODE_STUB),
  ]);
  const repository = join(parent, repositoryName);
  mkdirSync(repository);
  const environment: NodeJS.ProcessEnv = isolatedGitEnvironment(home, {
    PATH: `${stubs}:${process.env.PATH}`,
    GIT_AUTHOR_NAME: 'Kiko Test',
    GIT_AUTHOR_EMAIL: 'test@kiko.invalid',
    GIT_COMMITTER_NAME: 'Kiko Test',
    GIT_COMMITTER_EMAIL: 'test@kiko.invalid',
    KIKO_STUB_NPM_CALLS: join(parent, 'npm-calls'),
    KIKO_STUB_NODE_CALLS: join(parent, 'node-calls'),
    KIKO_STUB_NODE_VERSION: 'v1.0.0',
  });
  const git = (directory: string, ...gitArguments: string[]): SpawnSyncReturns<string> =>
    spawnSync('git', gitArguments, { cwd: directory, encoding: 'utf8', env: environment });
  const mustGit = (directory: string, ...gitArguments: string[]): string => {
    const result = git(directory, ...gitArguments);

    if (result.status !== 0) throw new Error(`git ${gitArguments.join(' ')}: ${result.stderr}`);

    return result.stdout.trim();
  };
  mustGit(repository, 'init', '-q', '-b', 'main');
  const checkout = join(parent, `${repositoryName}-verify`);
  const runAt = (checkoutPath: string, sha: string, extra: NodeJS.ProcessEnv = {}) =>
    spawnSync('bash', [SCRIPT, repository, checkoutPath, sha], {
      encoding: 'utf8',
      env: { ...environment, ...extra },
    });

  return {
    repository,
    checkout,
    environment,
    git,
    mustGit,
    runAt,
    commit: (files) => {
      writeTree(repository, files);
      mustGit(repository, 'add', '-A');
      mustGit(repository, 'commit', '-q', '-m', 'change');

      return mustGit(repository, 'rev-parse', 'HEAD');
    },
    run: (sha, extra = {}) => runAt(checkout, sha, extra),
    npmCalls: () => readLines(join(parent, 'npm-calls')),
    nodeCalls: () => readLines(join(parent, 'node-calls')),
  };
};

const INSTALLABLE = {
  'package.json': '{"name":"one"}\n',
  'package-lock.json': '{"lockfileVersion":3}\n',
  'patches/a.patch': 'patch a\n',
};

const npmInstalls = (fixture: Fixture): string[] =>
  fixture.npmCalls().filter((line) => line.startsWith('npm '));

describe('scripts/verify-checkout.sh the checkout', () => {
  it('creates a detached linked worktree at the sha when the folder is missing', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    expect(fixture.git(fixture.checkout, 'rev-parse', 'HEAD').stdout.trim()).toBe(sha);
    expect(fixture.git(fixture.checkout, 'symbolic-ref', '-q', 'HEAD').status).toBe(1);
    expect(fixture.git(fixture.repository, 'worktree', 'list', '--porcelain').stdout).toContain(
      `worktree ${realpathSync(fixture.checkout)}\n`,
    );
  });

  it('recreates a checkout whose folder was deleted by hand', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });
    fixture.run(sha);
    rmSync(fixture.checkout, { recursive: true, force: true });

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    expect(fixture.git(fixture.checkout, 'rev-parse', 'HEAD').stdout.trim()).toBe(sha);
    const listed = fixture.git(fixture.repository, 'worktree', 'list', '--porcelain').stdout;
    const entry = `worktree ${realpathSync(fixture.checkout)}`;
    expect(listed.split('\n').filter((line) => line === entry)).toHaveLength(1);
  });

  it('refuses a plain folder at the path and keeps its files', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });
    writeTree(fixture.checkout, { 'marker.txt': 'mine\n' });

    const result = fixture.run(sha);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(readFileSync(join(fixture.checkout, 'marker.txt'), 'utf8')).toBe('mine\n');
  });

  it('refuses a clone at the path and keeps its files', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });
    fixture.mustGit(dirname(fixture.checkout), 'clone', '-q', fixture.repository, fixture.checkout);
    writeTree(fixture.checkout, { 'marker.txt': 'mine\n' });

    const result = fixture.run(sha);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(readFileSync(join(fixture.checkout, 'marker.txt'), 'utf8')).toBe('mine\n');
  });

  it('refuses a linked worktree of another repository and keeps its files', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });
    const other = join(dirname(fixture.repository), 'other');
    mkdirSync(other);
    fixture.mustGit(other, 'init', '-q', '-b', 'main');
    writeTree(other, { 'b.txt': 'two\n' });
    fixture.mustGit(other, 'add', '-A');
    fixture.mustGit(other, 'commit', '-q', '-m', 'other');
    fixture.mustGit(other, 'worktree', 'add', '-q', '--detach', fixture.checkout);
    writeTree(fixture.checkout, { 'marker.txt': 'mine\n' });

    const result = fixture.run(sha);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(readFileSync(join(fixture.checkout, 'marker.txt'), 'utf8')).toBe('mine\n');
  });

  it('refuses the main checkout of the repository itself and keeps its files', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });
    writeTree(fixture.repository, { 'marker.txt': 'mine\n' });

    const result = fixture.runAt(fixture.repository, sha);

    expect(result.status).toBe(2);
    expect(readFileSync(join(fixture.repository, 'marker.txt'), 'utf8')).toBe('mine\n');
  });

  it("removes the checkout's own index.lock, keeps the main checkout's, and goes on", () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });
    fixture.run(sha);
    const gitDirectory = fixture.git(fixture.checkout, 'rev-parse', '--absolute-git-dir').stdout;
    const lock = join(gitDirectory.trim(), 'index.lock');
    const mainLock = join(fixture.repository, '.git/index.lock');
    writeFileSync(lock, '');
    writeFileSync(mainLock, '');

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(mainLock)).toBe(true);
  });

  it('fails when git checkout of the sha fails', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });
    fixture.run(sha);
    const second = fixture.commit({ 'a.txt': 'two\n' });
    const gitDirectory = fixture.git(fixture.checkout, 'rev-parse', '--absolute-git-dir').stdout;
    writeFileSync(join(gitDirectory.trim(), 'HEAD.lock'), '');

    const result = fixture.run(second);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('git checkout of the sha failed');
    expect(fixture.git(fixture.checkout, 'rev-parse', 'HEAD').stdout.trim()).toBe(sha);
  });

  it('fails when git clean of the checkout fails', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });
    fixture.run(sha);
    const locked = join(fixture.checkout, 'locked');
    writeTree(fixture.checkout, { 'locked/file.txt': 'x\n' });
    chmodSync(locked, 0o500);

    try {
      const result = fixture.run(sha);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('git clean of the checkout failed');
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it('moves an existing checkout to another sha', () => {
    const fixture = createFixture();
    const first = fixture.commit({ 'a.txt': 'one\n' });
    const second = fixture.commit({ 'a.txt': 'two\n' });
    fixture.run(first);

    const result = fixture.run(second);

    expect(result.status).toBe(0);
    expect(fixture.git(fixture.checkout, 'rev-parse', 'HEAD').stdout.trim()).toBe(second);
    expect(readFileSync(join(fixture.checkout, 'a.txt'), 'utf8')).toBe('two\n');
  });

  it('moves a checkout whose registered gitdir path is relative to its git directory', () => {
    const fixture = createFixture();
    const first = fixture.commit({ 'a.txt': 'one\n' });
    const second = fixture.commit({ 'a.txt': 'two\n' });
    fixture.run(first);
    const gitDirectory = realpathSync(
      fixture.mustGit(fixture.checkout, 'rev-parse', '--absolute-git-dir'),
    );
    const registered = relative(gitDirectory, join(realpathSync(fixture.checkout), '.git'));
    writeFileSync(join(gitDirectory, 'gitdir'), `${registered}\n`);

    const result = fixture.run(second);

    expect(registered.startsWith('..')).toBe(true);
    expect(result.status).toBe(0);
    expect(fixture.git(fixture.checkout, 'rev-parse', 'HEAD').stdout.trim()).toBe(second);
  });

  it('drops a tracked edit, an untracked file, an ignored file, and a nested repository', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n', '.gitignore': 'ignored.log\n' });
    fixture.run(sha);
    writeTree(fixture.checkout, {
      'a.txt': 'edited\n',
      'untracked.txt': 'x\n',
      'ignored.log': 'x\n',
    });
    mkdirSync(join(fixture.checkout, 'nested'));
    fixture.mustGit(join(fixture.checkout, 'nested'), 'init', '-q');

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    expect(readFileSync(join(fixture.checkout, 'a.txt'), 'utf8')).toBe('one\n');
    expect(existsSync(join(fixture.checkout, 'untracked.txt'))).toBe(false);
    expect(existsSync(join(fixture.checkout, 'ignored.log'))).toBe(false);
    expect(existsSync(join(fixture.checkout, 'nested'))).toBe(false);
  });

  it('keeps node_modules and .env across a run', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n', '.gitignore': 'node_modules\n.env\n' });
    fixture.run(sha);
    writeTree(fixture.checkout, { 'node_modules/kept/index.js': 'x\n', '.env': 'KEY=1\n' });

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    expect(existsSync(join(fixture.checkout, 'node_modules/kept/index.js'))).toBe(true);
    expect(readFileSync(join(fixture.checkout, '.env'), 'utf8')).toBe('KEY=1\n');
  });

  it('exits 2 for a sha the repository lacks', () => {
    const fixture = createFixture();
    fixture.commit({ 'a.txt': 'one\n' });

    const result = fixture.run('0123456789abcdef0123456789abcdef01234567');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(existsSync(fixture.checkout)).toBe(false);
  });

  it.each([
    ['no argument', () => []],
    ['one argument', (fixture: Fixture) => [fixture.repository]],
    ['two arguments', (fixture: Fixture) => [fixture.repository, fixture.checkout]],
    [
      'four arguments',
      (fixture: Fixture, sha: string) => [fixture.repository, fixture.checkout, sha, 'extra'],
    ],
  ])('exits 2 for %s', (_title, scriptArguments) => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });

    const result = spawnSync('bash', [SCRIPT, ...scriptArguments(fixture, sha)], {
      encoding: 'utf8',
      env: fixture.environment,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(existsSync(fixture.checkout)).toBe(false);
  });
});

type Track = { directory: string; head: string; lock: string; gitDirectory: string };

// A linked worktree of the fixture's repository that is not the verify checkout, with a marker
// file and an index.lock a job of its own track could hold.
const createTrack = (fixture: Fixture, sha: string): Track => {
  const directory = join(dirname(fixture.repository), 'track');
  fixture.mustGit(fixture.repository, 'worktree', 'add', '-q', '--detach', directory, sha);
  writeTree(directory, { 'marker.txt': 'mine\n' });
  const gitDirectory = fixture.mustGit(directory, 'rev-parse', '--absolute-git-dir');
  const lock = join(gitDirectory, 'index.lock');
  writeFileSync(lock, '');

  return { directory, head: fixture.mustGit(directory, 'rev-parse', 'HEAD'), lock, gitDirectory };
};

const expectTrackUntouched = (fixture: Fixture, track: Track): void => {
  expect(readFileSync(join(track.directory, 'marker.txt'), 'utf8')).toBe('mine\n');
  expect(existsSync(track.lock)).toBe(true);
  expect(fixture.mustGit(track.directory, 'rev-parse', 'HEAD')).toBe(track.head);
};

describe('scripts/verify-checkout.sh the checkout path', () => {
  it('refuses a symlink to a track worktree and leaves the track untouched', () => {
    const fixture = createFixture();
    const first = fixture.commit({ 'a.txt': 'one\n' });
    const track = createTrack(fixture, first);
    const second = fixture.commit({ 'a.txt': 'two\n' });
    symlinkSync(track.directory, fixture.checkout);

    const result = fixture.run(second);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(lstatSync(fixture.checkout).isSymbolicLink()).toBe(true);
    expectTrackUntouched(fixture, track);
  });

  it('refuses a symlink spelled with a trailing slash', () => {
    const fixture = createFixture();
    const first = fixture.commit({ 'a.txt': 'one\n' });
    const track = createTrack(fixture, first);
    const second = fixture.commit({ 'a.txt': 'two\n' });
    symlinkSync(track.directory, fixture.checkout);

    const result = fixture.runAt(`${fixture.checkout}/`, second);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expectTrackUntouched(fixture, track);
  });

  it('refuses a dangling symlink and creates nothing behind it', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });
    const nowhere = join(dirname(fixture.repository), 'nowhere');
    symlinkSync(nowhere, fixture.checkout);

    const result = fixture.run(sha);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(lstatSync(fixture.checkout).isSymbolicLink()).toBe(true);
    expect(existsSync(nowhere)).toBe(false);
  });

  it('refuses a track worktree passed as the checkout and leaves it untouched', () => {
    const fixture = createFixture();
    const first = fixture.commit({ 'a.txt': 'one\n' });
    const track = createTrack(fixture, first);
    const second = fixture.commit({ 'a.txt': 'two\n' });

    const result = fixture.runAt(track.directory, second);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expectTrackUntouched(fixture, track);
  });

  it("refuses a hand-made .git file that names the main checkout's git directory", () => {
    const fixture = createFixture();
    const first = fixture.commit({ 'a.txt': 'one\n' });
    const second = fixture.commit({ 'a.txt': 'two\n' });
    writeTree(fixture.checkout, {
      '.git': `gitdir: ${join(fixture.repository, '.git')}\n`,
      'marker.txt': 'mine\n',
    });

    const result = fixture.run(first);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(readFileSync(join(fixture.checkout, 'marker.txt'), 'utf8')).toBe('mine\n');
    expect(fixture.mustGit(fixture.repository, 'rev-parse', 'HEAD')).toBe(second);
  });

  it("refuses a hand-made .git file that names a track worktree's git directory", () => {
    const fixture = createFixture();
    const first = fixture.commit({ 'a.txt': 'one\n' });
    const track = createTrack(fixture, first);
    const second = fixture.commit({ 'a.txt': 'two\n' });
    writeTree(fixture.checkout, {
      '.git': `gitdir: ${track.gitDirectory}\n`,
      'marker.txt': 'mine\n',
    });

    const result = fixture.run(second);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(readFileSync(join(fixture.checkout, 'marker.txt'), 'utf8')).toBe('mine\n');
    expectTrackUntouched(fixture, track);
  });

  it('refuses an empty checkout path and names the expected one', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'a.txt': 'one\n' });

    const result = fixture.runAt('', sha);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(result.stderr).toContain(`${realpathSync(dirname(fixture.checkout))}/repository-verify`);
    expect(existsSync(fixture.checkout)).toBe(false);
  });

  it('prepares a checkout whose repository and parent folders hold a space', () => {
    const fixture = createFixture({
      parentPrefix: 'kiko verify checkout-',
      repositoryName: 'my repository',
    });
    const sha = fixture.commit({ 'a.txt': 'one\n' });

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    expect(fixture.mustGit(fixture.checkout, 'rev-parse', 'HEAD')).toBe(sha);
    expect(fixture.mustGit(fixture.checkout, 'rev-parse', '--show-toplevel')).toBe(
      realpathSync(fixture.checkout),
    );
  });

  it.each([
    ['an uppercase letter', 'ABCDEF1'],
    ['a letter past f', 'abcdefg'],
    ['a branch name', 'main'],
    ['a revision suffix', 'HEAD~1'],
    ['an empty argument', ''],
    ['an option', '--all'],
  ])('exits 2 for a sha with %s and creates no checkout', (_title, requested) => {
    const fixture = createFixture();
    fixture.commit({ 'a.txt': 'one\n' });

    const result = fixture.run(requested);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(existsSync(fixture.checkout)).toBe(false);
  });
});

describe('scripts/verify-checkout.sh the install stamp', () => {
  it('runs npm ci once with no flag, in the checkout, on a missing stamp', () => {
    const fixture = createFixture();
    const sha = fixture.commit(INSTALLABLE);

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    const calls = fixture.npmCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe('npm ci');
    expect(realpathSync(calls[1].replace('cwd ', ''))).toBe(realpathSync(fixture.checkout));
    expect(existsSync(join(fixture.checkout, STAMP))).toBe(true);
  });

  it('skips the install at the same sha', () => {
    const fixture = createFixture();
    const sha = fixture.commit(INSTALLABLE);
    fixture.run(sha);

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    expect(npmInstalls(fixture)).toHaveLength(1);
  });

  it('skips the install at another sha with the same inputs', () => {
    const fixture = createFixture();
    const first = fixture.commit(INSTALLABLE);
    const second = fixture.commit({ 'src/other.ts': 'export {};\n' });
    fixture.run(first);

    const result = fixture.run(second);

    expect(result.status).toBe(0);
    expect(npmInstalls(fixture)).toHaveLength(1);
  });

  it.each([
    ['package-lock.json', { 'package-lock.json': '{"lockfileVersion":4}\n' }, {}],
    ['package.json', { 'package.json': '{"name":"two"}\n' }, {}],
    ['a file in patches', { 'patches/b.patch': 'patch b\n' }, {}],
    ['the node version', { 'src/other.ts': 'export {};\n' }, { KIKO_STUB_NODE_VERSION: 'v2.0.0' }],
  ])('installs again when %s changes', (_title, change, environment) => {
    const fixture = createFixture();
    const first = fixture.commit(INSTALLABLE);
    const second = fixture.commit(change);
    fixture.run(first);

    const result = fixture.run(second, environment);

    expect(result.status).toBe(0);
    expect(npmInstalls(fixture)).toHaveLength(2);
  });

  it('exits 2 and writes no stamp when npm ci fails, and the next run installs', () => {
    const fixture = createFixture();
    const sha = fixture.commit(INSTALLABLE);

    const failed = fixture.run(sha, { KIKO_STUB_NPM_EXIT: '1' });

    expect(failed.status).toBe(2);
    expect(failed.stderr).toContain('CHECK FAILED: verify-checkout.sh');
    expect(existsSync(join(fixture.checkout, STAMP))).toBe(false);
    expect(fixture.run(sha).status).toBe(0);
    expect(npmInstalls(fixture)).toHaveLength(2);
  });

  it('drops the old stamp before a failing install, so the earlier sha installs again', () => {
    const fixture = createFixture();
    const first = fixture.commit(INSTALLABLE);
    const second = fixture.commit({ 'package-lock.json': '{"lockfileVersion":4}\n' });
    fixture.run(first);
    fixture.run(second, { KIKO_STUB_NPM_EXIT: '1' });

    const result = fixture.run(first);

    expect(result.status).toBe(0);
    expect(npmInstalls(fixture)).toHaveLength(3);
  });

  it('calls no npm when the sha has no package-lock.json', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'package.json': '{"name":"one"}\n' });

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    expect(fixture.npmCalls()).toEqual([]);
  });
});

describe('scripts/verify-checkout.sh ensure-env', () => {
  it('runs ensure-env on every run, stamp hit included, from the checkout', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ ...INSTALLABLE, 'scripts/ensure-env.js': '// stub\n' });

    fixture.run(sha);
    fixture.run(sha);

    const calls = fixture.nodeCalls();
    expect(calls.filter((line) => line === 'node scripts/ensure-env.js')).toHaveLength(2);
    const directories = calls.filter((line) => line.startsWith('cwd '));
    expect(directories.map((line) => realpathSync(line.replace('cwd ', '')))).toEqual([
      realpathSync(fixture.checkout),
      realpathSync(fixture.checkout),
    ]);
  });

  it('calls no ensure-env when the sha lacks the file', () => {
    const fixture = createFixture();
    const sha = fixture.commit(INSTALLABLE);

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    expect(fixture.nodeCalls().join('\n')).not.toContain('ensure-env');
  });

  it('exits 2 when ensure-env fails', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ 'scripts/ensure-env.js': '// stub\n' });

    const result = fixture.run(sha, { KIKO_STUB_NODE_EXIT: '1' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: verify-checkout.sh');
  });

  it('prints nothing on success', () => {
    const fixture = createFixture();
    const sha = fixture.commit({ ...INSTALLABLE, 'scripts/ensure-env.js': '// stub\n' });

    const result = fixture.run(sha);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
