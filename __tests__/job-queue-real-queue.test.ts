import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, copyFileSync, mkdirSync, realpathSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { warmExecutables } from './test-support/warm-executables';
import { isolatedGitEnvironment } from './test-support/isolated-git';
import { LOW_LOAD, writeSysctlStub } from './test-support/sysctl-stub';
import { writeFile, writeExecutable } from './test-support/mutation-repository';

// The real queue is ${KIKO_QUEUE_DIR:-$HOME/.claude/kiko-queue}, and scripts/ff-main.sh trusts the
// `verify` lines in its done.log. A hand-run `job-queue.sh verify <scratch repository>` once wrote
// a verify line there for a commit nobody had verified. Every row here points HOME at a temporary
// folder and leaves KIKO_QUEUE_DIR unset, so the default queue resolves inside that folder and no
// row can touch the real one.
const SCRIPT = join(__dirname, '../scripts/job-queue.sh');

jest.setTimeout(120_000);

afterEach(removeTemporaryDirectories);

type Fixture = {
  root: string;
  home: string;
  queue: string;
  environment: NodeJS.ProcessEnv;
};

const runGit = (cwd: string, environment: NodeJS.ProcessEnv, ...gitArguments: string[]): string =>
  execFileSync('git', gitArguments, { cwd, env: environment, encoding: 'utf8' }).trim();

const createFixture = (): Fixture => {
  const root = realpathSync(createTemporaryDirectory('kiko-real-queue-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  const stub = ['#!/usr/bin/env bash', 'exit 0', ''].join('\n');
  warmExecutables([
    writeExecutable(join(bin, 'make'), stub),
    writeExecutable(join(bin, 'npm'), stub),
  ]);
  writeSysctlStub(bin, LOW_LOAD, LOW_LOAD, 0);
  warmExecutables([join(bin, 'sysctl')]);
  const environment = isolatedGitEnvironment(home, {
    PATH: `${bin}:${process.env.PATH}`,
    KIKO_QUEUE_PMSET: join(bin, 'no-such-pmset'),
    KIKO_QUEUE_POLL_SECONDS: '0.1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  });
  delete environment.KIKO_QUEUE_DIR;

  return { root, home, queue: join(home, '.claude/kiko-queue'), environment };
};

const createRepository = (
  fixture: Fixture,
  name: string,
  files: Record<string, string> = {},
): string => {
  const directory = join(fixture.root, name);
  mkdirSync(directory);
  runGit(directory, fixture.environment, 'init', '-q', '-b', 'main');
  writeFile(directory, 'base.txt', 'base\n');

  for (const [path, body] of Object.entries(files)) {
    writeFile(directory, path, body);
  }

  runGit(directory, fixture.environment, 'add', '-A');
  runGit(directory, fixture.environment, 'commit', '-qm', 'base');

  return directory;
};

const runQueue = (fixture: Fixture, script: string, ...queueArguments: string[]) =>
  spawnSync('bash', [script, ...queueArguments], {
    env: fixture.environment,
    encoding: 'utf8',
  });

const doneLines = (fixture: Fixture): string[] => {
  const path = join(fixture.queue, 'done.log');

  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : [];
};

const headOf = (fixture: Fixture, directory: string): string =>
  runGit(directory, fixture.environment, 'rev-parse', 'HEAD');

describe('scripts/job-queue.sh on the real queue: a foreign repository', () => {
  it.each(['verify', 'check-all', 'gate'])(
    'refuses a %s of a scratch repository with exit 3, no done.log line, and no ticket',
    (kind) => {
      const fixture = createFixture();
      const scratch = createRepository(fixture, 'scratch');
      const gateArguments = kind === 'gate' ? ['base', headOf(fixture, scratch)] : [];

      const result = runQueue(fixture, SCRIPT, kind, scratch, 'foreign', ...gateArguments);

      expect(result.status).toBe(3);
      expect(result.stderr).toContain('KIKO_QUEUE_DIR');
      expect(result.stderr).toContain(scratch);
      expect(doneLines(fixture)).toEqual([]);
      expect(existsSync(join(fixture.queue, 'tickets'))).toBe(false);
      expect(existsSync(fixture.queue)).toBe(false);
    },
  );

  it('refuses a verify of a folder that is no repository at all', () => {
    const fixture = createFixture();
    const folder = join(fixture.root, 'plain');
    mkdirSync(folder);

    const result = runQueue(fixture, SCRIPT, 'verify', folder, 'plain');

    expect(result.status).toBe(3);
    expect(existsSync(fixture.queue)).toBe(false);
  });

  it('refuses when the script sits outside any repository, since it cannot name its own', () => {
    const fixture = createFixture();
    const own = createRepository(fixture, 'own');
    const loose = join(fixture.root, 'job-queue-copy.sh');
    copyFileSync(SCRIPT, loose);

    const result = runQueue(fixture, loose, 'verify', own, 'copy');

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('KIKO_QUEUE_DIR');
    expect(existsSync(fixture.queue)).toBe(false);
  });

  it('treats an explicit KIKO_QUEUE_DIR that names the real default path as the real queue', () => {
    const fixture = createFixture();
    const scratch = createRepository(fixture, 'scratch');
    fixture.environment.KIKO_QUEUE_DIR = fixture.queue;

    const result = runQueue(fixture, SCRIPT, 'verify', scratch, 'explicit');

    expect(result.status).toBe(3);
    expect(existsSync(fixture.queue)).toBe(false);
  });

  it('does not restrict a temporary KIKO_QUEUE_DIR, which is how every other test runs', () => {
    const fixture = createFixture();
    const scratch = createRepository(fixture, 'scratch');
    fixture.environment.KIKO_QUEUE_DIR = join(fixture.root, 'other-queue');

    const result = runQueue(fixture, SCRIPT, 'verify', scratch, 'temporary');

    expect(result.status).toBe(0);
    expect(existsSync(fixture.queue)).toBe(false);
  });

  it('accepts a harness-verify of a foreign repository, and refuses a verify of it', () => {
    const fixture = createFixture();
    const harness = createRepository(fixture, 'harness', { 'package.json': '{}\n' });

    const accepted = runQueue(fixture, SCRIPT, 'harness-verify', harness, 'harness');
    const refused = runQueue(fixture, SCRIPT, 'verify', harness, 'harness');

    expect(accepted.status).toBe(0);
    expect(doneLines(fixture)).toHaveLength(1);
    expect(doneLines(fixture)[0]).toMatch(/^harness-verify harness 0 /);
    expect(refused.status).toBe(3);
    expect(doneLines(fixture)).toHaveLength(1);
  });

  it('leaves a security job on a foreign repository unchanged', () => {
    const fixture = createFixture();
    const scratch = createRepository(fixture, 'scratch');

    const result = runQueue(fixture, SCRIPT, 'security', scratch, 'scan');

    expect(result.status).toBe(0);
    expect(doneLines(fixture)[0]).toMatch(/^security scan 0 /);
  });
});

describe('scripts/job-queue.sh on the real queue: a worktree of its own repository', () => {
  // A scratch repository that holds its own copy of the script, with a linked worktree.
  const createOwnRepository = (fixture: Fixture) => {
    const main = createRepository(fixture, 'own');
    const linked = join(fixture.root, 'own-linked');
    mkdirSync(join(main, 'scripts'));
    copyFileSync(SCRIPT, join(main, 'scripts/job-queue.sh'));
    runGit(main, fixture.environment, 'add', '-A');
    runGit(main, fixture.environment, 'commit', '-qm', 'add the queue script');
    runGit(main, fixture.environment, 'worktree', 'add', '-q', '--detach', linked);

    return { main, linked };
  };

  it.each([
    ['a linked worktree, run from the main checkout', 'main', 'linked'],
    ['the main checkout, run from a linked worktree', 'linked', 'main'],
    ['its own checkout', 'main', 'main'],
  ] as const)('accepts a verify of %s', (_title, from, target) => {
    const fixture = createFixture();
    const places = createOwnRepository(fixture);

    const result = runQueue(
      fixture,
      join(places[from], 'scripts/job-queue.sh'),
      'verify',
      places[target],
      'own',
    );

    expect(result.status).toBe(0);
    expect(doneLines(fixture)).toHaveLength(1);
    expect(doneLines(fixture)[0]).toMatch(/^verify own 0 \S+ \S+ [0-9a-f]{40}$/);
  });
});
