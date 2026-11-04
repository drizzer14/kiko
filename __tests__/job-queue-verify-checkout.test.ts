import {
  rmSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  realpathSync,
  readFileSync,
  copyFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type ChildProcess, spawn, spawnSync, execFileSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { warmExecutables } from './test-support/warm-executables';
import { isolatedGitEnvironment } from './test-support/isolated-git';
import { LOW_LOAD, writeSysctlStub } from './test-support/sysctl-stub';
import { writeFile, writeExecutable } from './test-support/mutation-repository';

// A queued verify of a repository runs in one shared sibling checkout of its main checkout, at the
// commit read at enqueue. Each row runs the real scripts/job-queue.sh and
// scripts/verify-checkout.sh against a throwaway repository and queue, with `make` and `npm`
// stubbed.
const SCRIPT = join(__dirname, '../scripts/job-queue.sh');
const HEADER = '── make verify: stage 2b (real-semgrep suites) ──';
const SKIPPED = '── make verify: stage 2b SKIPPED (no trigger path changed since 0123456789ab) ──';
const REASON = '── make verify: stage 2b runs in full (no --scoped flag) ──';

jest.setTimeout(120_000);

const MAKE_STUB = [
  '#!/usr/bin/env bash',
  '{',
  '  printf "make %s\\n" "$*"',
  '  printf "  head %s\\n" "$(git -C "$2" rev-parse HEAD 2> /dev/null || echo none)"',
  '  printf "  scoped %s\\n" "$(printenv KIKO_VERIFY_SCOPED || echo unset)"',
  '  printf "  force-color %s\\n" "$(printenv FORCE_COLOR || echo unset)"',
  '} >> "$KIKO_STUB_CALLS"',
  '[ -z "$(printenv KIKO_STUB_HOOK)" ] || bash -c "$KIKO_STUB_HOOK"',
  '[ -z "$(printenv KIKO_STUB_OUTPUT)" ] || printenv KIKO_STUB_OUTPUT',
  'exit "$(printenv KIKO_STUB_EXIT || echo 0)"',
  '',
].join('\n');

const NPM_STUB = [
  '#!/usr/bin/env bash',
  'printf "npm %s in %s\\n" "$*" "$PWD" >> "$KIKO_STUB_CALLS"',
  '[ -z "$(printenv KIKO_STUB_NPM_OUTPUT)" ] || printenv KIKO_STUB_NPM_OUTPUT',
  'if [ -n "$(printenv KIKO_STUB_NPM_PID)" ]; then',
  '  printf "%s" "$$" > "$KIKO_STUB_NPM_PID"',
  '  exec sleep 60',
  'fi',
  'exit 0',
  '',
].join('\n');

// A copy of a support script that records which copy ran, so a row sees where the queue read it.
const supportStub = (name: string, copy: string): string =>
  ['#!/usr/bin/env bash', `echo "${name} ${copy} $*" >> "$KIKO_STUB_CALLS"`, ''].join('\n');

type Fixture = { root: string; queue: string; environment: NodeJS.ProcessEnv; calls: string };

const children: ChildProcess[] = [];

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((settle) => setTimeout(settle, milliseconds));

// A poll count, not a measured time, bounds the wait, so a state that never appears fails the row.
const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let poll = 0; !condition(); poll += 1) {
    if (poll >= 3000) throw new Error('the awaited queue state never appeared');

    await sleep(20);
  }
};

afterEach(async () => {
  for (const child of children) {
    if (!hasExited(child)) child.kill();
  }

  for (let poll = 0; !children.every(hasExited) && poll < 1500; poll += 1) {
    await sleep(20);
  }

  children.length = 0;
  removeTemporaryDirectories();
});

const createFixture = (): Fixture => {
  const root = realpathSync(createTemporaryDirectory('kiko-verify-job-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  warmExecutables([
    writeExecutable(join(bin, 'make'), MAKE_STUB),
    writeExecutable(join(bin, 'npm'), NPM_STUB),
  ]);
  writeSysctlStub(bin, LOW_LOAD, LOW_LOAD, 0);
  warmExecutables([join(bin, 'sysctl')]);
  const calls = join(root, 'calls');

  return {
    root,
    calls,
    queue: join(root, 'queue'),
    environment: isolatedGitEnvironment(home, {
      PATH: `${bin}:${process.env.PATH}`,
      KIKO_QUEUE_DIR: join(root, 'queue'),
      KIKO_QUEUE_POLL_SECONDS: '0.1',
      KIKO_QUEUE_PMSET: join(bin, 'no-such-pmset'),
      KIKO_QUEUE_CAFFEINATE: join(bin, 'no-such-caffeinate'),
      KIKO_STUB_CALLS: calls,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    }),
  };
};

const git = (fixture: Fixture, cwd: string, ...gitArguments: string[]): string =>
  execFileSync('git', gitArguments, { cwd, env: fixture.environment, encoding: 'utf8' }).trim();

const createRepository = (
  fixture: Fixture,
  name: string,
  files: Record<string, string> = {},
): string => {
  const directory = join(fixture.root, name);
  mkdirSync(directory);
  git(fixture, directory, 'init', '-q', '-b', 'main');
  writeFile(directory, 'base.txt', 'base\n');

  for (const [path, body] of Object.entries(files)) {
    writeFile(directory, path, body);
  }

  git(fixture, directory, 'add', '-A');
  git(fixture, directory, 'commit', '-qm', 'base');

  return directory;
};

const commitFile = (fixture: Fixture, directory: string, path: string): string => {
  writeFile(directory, path, `${path}\n`);
  git(fixture, directory, 'add', '-A');
  git(fixture, directory, 'commit', '-qm', path);

  return git(fixture, directory, 'rev-parse', 'HEAD');
};

const headOf = (fixture: Fixture, directory: string): string =>
  git(fixture, directory, 'rev-parse', 'HEAD');

const runQueueFrom = (fixture: Fixture, script: string, ...queueArguments: string[]) =>
  spawnSync('bash', [script, ...queueArguments], { env: fixture.environment, encoding: 'utf8' });

const runQueue = (fixture: Fixture, ...queueArguments: string[]) =>
  runQueueFrom(fixture, SCRIPT, ...queueArguments);

type Waiter = { child: ChildProcess; stdout: () => string; finished: Promise<number | null> };

const startQueueFrom = (fixture: Fixture, script: string, ...queueArguments: string[]): Waiter => {
  const child = spawn('bash', [script, ...queueArguments], {
    env: fixture.environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  children.push(child);

  return {
    child,
    stdout: () => stdout,
    finished: new Promise((settle) => child.on('close', (code) => settle(code))),
  };
};

const startQueue = (fixture: Fixture, ...queueArguments: string[]): Waiter =>
  startQueueFrom(fixture, SCRIPT, ...queueArguments);

const lockPath = (fixture: Fixture): string => join(fixture.queue, 'lock');

const holdLock = (fixture: Fixture): void => {
  mkdirSync(fixture.queue, { recursive: true });
  symlinkSync(`${process.pid} - verify other /elsewhere`, lockPath(fixture));
};

const lockPresent = (fixture: Fixture): boolean =>
  spawnSync('test', ['-L', lockPath(fixture)]).status === 0;

const readLines = (path: string): string[] =>
  existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : [];

type MakeCall = { directory: string; target: string; head: string; scoped: string; color: string };

const makeCalls = (fixture: Fixture): MakeCall[] => {
  const lines = readLines(fixture.calls);

  return lines.flatMap((line, index) => {
    if (!line.startsWith('make ')) return [];
    const [, , directory, target] = line.split(' ');

    return [
      {
        directory,
        target,
        head: lines[index + 1].replace('  head ', ''),
        scoped: lines[index + 2].replace('  scoped ', ''),
        color: lines[index + 3].replace('  force-color ', ''),
      },
    ];
  });
};

const doneLines = (fixture: Fixture): string[] => readLines(join(fixture.queue, 'done.log'));

const doneFields = (fixture: Fixture): string[] => (doneLines(fixture)[0] ?? '').split(' ');

const ticketNames = (fixture: Fixture): string[] =>
  spawnSync('ls', [join(fixture.queue, 'tickets')], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean);

const verifyLog = (fixture: Fixture, label: string): string =>
  readFileSync(join(fixture.queue, `logs/verify-${label}.log`), 'utf8');

const siblingOf = (directory: string): string => `${directory}-verify`;

describe('scripts/job-queue.sh a verify checkout', () => {
  it('runs make in the sibling checkout at the enqueue sha, not in the worktree', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');

    const result = runQueue(fixture, 'verify', repository, 'one');

    expect(result.status).toBe(0);
    expect(makeCalls(fixture)).toEqual([
      {
        directory: siblingOf(repository),
        target: 'verify',
        head: headOf(fixture, repository),
        scoped: 'unset',
        color: 'unset',
      },
    ]);
  });

  it('names the sibling of the main checkout when queued for a linked worktree', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const linked = join(fixture.root, 'own-linked');
    git(fixture, repository, 'worktree', 'add', '-q', '--detach', linked);

    const result = runQueue(fixture, 'verify', linked, 'one');

    expect(result.status).toBe(0);
    expect(makeCalls(fixture).map((call) => call.directory)).toEqual([siblingOf(repository)]);
  });

  it('runs make in the sibling checkout when the repository path holds a space', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own repository');

    const result = runQueue(fixture, 'verify', repository, 'one');

    expect(result.status).toBe(0);
    expect(readLines(fixture.calls).slice(0, 2)).toEqual([
      `make -C ${siblingOf(repository)} verify`,
      `  head ${headOf(fixture, repository)}`,
    ]);
    expect(doneFields(fixture)[5]).toBe(headOf(fixture, repository));
  });

  it('gives a scratch repository its own checkout path', () => {
    const fixture = createFixture();
    const first = createRepository(fixture, 'first');
    const second = createRepository(fixture, 'second');

    runQueue(fixture, 'verify', first, 'one');
    runQueue(fixture, 'verify', second, 'two');

    expect(makeCalls(fixture).map((call) => call.directory)).toEqual([
      siblingOf(first),
      siblingOf(second),
    ]);
  });

  it('tests the enqueue sha when the worktree HEAD moves while queued', async () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const enqueued = headOf(fixture, repository);
    holdLock(fixture);

    const waiter = startQueue(fixture, 'verify', repository, 'one');
    await waitFor(() => waiter.stdout().includes('QUEUED one'));
    commitFile(fixture, repository, 'later.txt');
    rmSync(lockPath(fixture));
    const code = await waiter.finished;

    expect(code).toBe(0);
    expect(makeCalls(fixture).map((call) => call.head)).toEqual([enqueued]);
    expect(doneFields(fixture)[5]).toBe(enqueued);
  });

  it('runs a verify whose worktree changed while queued, and the line counts', async () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const enqueued = headOf(fixture, repository);
    holdLock(fixture);

    const waiter = startQueue(fixture, 'verify', repository, 'one');
    await waitFor(() => waiter.stdout().includes('QUEUED one'));
    writeFile(repository, 'untracked.txt', 'new\n');
    rmSync(lockPath(fixture));
    const code = await waiter.finished;

    expect(code).toBe(0);
    expect(doneFields(fixture)[5]).toBe(enqueued);
    expect(existsSync(join(siblingOf(repository), 'untracked.txt'))).toBe(false);
  });

  it('keeps the sha when the worktree is edited during the job', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const enqueued = headOf(fixture, repository);
    fixture.environment.KIKO_STUB_HOOK = `echo edit >> "${repository}/base.txt"`;

    const result = runQueue(fixture, 'verify', repository, 'one');

    expect(result.status).toBe(0);
    expect(doneFields(fixture)[5]).toBe(enqueued);
    expect(result.stdout).not.toContain('NOTE one');
  });

  it('runs when the worktree folder is removed while queued', async () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const linked = join(fixture.root, 'own-linked');
    git(fixture, repository, 'worktree', 'add', '-q', '--detach', linked);
    const enqueued = headOf(fixture, linked);
    holdLock(fixture);

    const waiter = startQueue(fixture, 'verify', linked, 'one');
    await waitFor(() => waiter.stdout().includes('QUEUED one'));
    rmSync(linked, { recursive: true, force: true });
    rmSync(lockPath(fixture));
    const code = await waiter.finished;

    expect(code).toBe(0);
    expect(makeCalls(fixture).map((call) => call.head)).toEqual([enqueued]);
    expect(doneFields(fixture)[5]).toBe(enqueued);
  });

  it('accepts --sha on a dirty worktree and tests that commit', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const older = headOf(fixture, repository);
    commitFile(fixture, repository, 'later.txt');
    writeFile(repository, 'dirty.txt', 'dirty\n');

    const result = runQueue(fixture, 'verify', repository, 'one', '--sha', older.slice(0, 9));

    expect(result.status).toBe(0);
    expect(makeCalls(fixture).map((call) => call.head)).toEqual([older]);
    expect(doneFields(fixture)[5]).toBe(older);
    expect(result.stdout).toContain(`head ${older.slice(0, 12)} `);
  });

  it.each([
    ['--sha first', (sha: string) => ['--sha', sha, '--scoped']],
    ['--scoped first', (sha: string) => ['--scoped', '--sha', sha]],
  ])('accepts --sha and --scoped in either order: %s', (_title, flags) => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const sha = headOf(fixture, repository);

    const result = runQueue(fixture, 'verify', repository, 'one', ...flags(sha));

    expect(result.status).toBe(0);
    expect(makeCalls(fixture).map((call) => call.scoped)).toEqual(['1']);
    expect(doneFields(fixture)[5]).toBe(sha);
  });

  it.each([
    ['an unknown commit', () => 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
    ['a branch name', () => 'main'],
    [
      'a branch named like a short sha',
      (fixture: Fixture, repository: string) => {
        git(fixture, repository, 'branch', 'deadbee');

        return 'deadbee';
      },
    ],
  ])('exits 2 with no ticket for --sha %s', (_title, spell) => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const argument = spell(fixture, repository);

    const result = runQueue(fixture, 'verify', repository, 'one', '--sha', argument);

    expect(result.status).toBe(2);
    expect(ticketNames(fixture)).toEqual([]);
    expect(makeCalls(fixture)).toEqual([]);
    expect(doneLines(fixture)).toEqual([]);
  });

  it('exits 2 with no ticket for --sha of a plain folder', () => {
    const fixture = createFixture();
    const folder = join(fixture.root, 'plain');
    mkdirSync(folder);

    const result = runQueue(fixture, 'verify', folder, 'one', '--sha', 'abc1234');

    expect(result.status).toBe(2);
    expect(ticketNames(fixture)).toEqual([]);
    expect(makeCalls(fixture)).toEqual([]);
  });

  it.each([
    ['--sha with no value', ['verify', 'WORKTREE', 'one', '--sha']],
    ['--sha with an empty value', ['verify', 'WORKTREE', 'one', '--sha', '']],
    ['--sha twice', ['verify', 'WORKTREE', 'one', '--sha', 'abc1234', '--sha', 'abc1234']],
    ['--scoped twice', ['verify', 'WORKTREE', 'one', '--scoped', '--scoped']],
    ['an unknown flag', ['verify', 'WORKTREE', 'one', '--fast']],
    ['check-all with --scoped', ['check-all', 'WORKTREE', 'one', '--scoped']],
    ['security with --sha', ['security', 'WORKTREE', 'one', '--sha', 'abc1234']],
    ['gate with --scoped', ['gate', 'WORKTREE', 'one', 'main', 'abc1234', '--scoped']],
  ])('exits 2 for %s', (_title, queueArguments) => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');

    const result = runQueue(
      fixture,
      ...queueArguments.map((argument) => (argument === 'WORKTREE' ? repository : argument)),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
    expect(makeCalls(fixture)).toEqual([]);
  });

  it('refuses a dirty worktree with no --sha at exit 3', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    writeFile(repository, 'dirty.txt', 'dirty\n');

    const result = runQueue(fixture, 'verify', repository, 'one');

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('dirty.txt');
    expect(makeCalls(fixture)).toEqual([]);
  });

  it('refuses at enqueue when neither the main checkout nor the queuing folder has the script', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const loose = join(fixture.root, 'loose');
    mkdirSync(loose);
    copyFileSync(SCRIPT, join(loose, 'job-queue.sh'));

    const result = runQueueFrom(fixture, join(loose, 'job-queue.sh'), 'verify', repository, 'one');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('verify-checkout.sh');
    expect(ticketNames(fixture)).toEqual([]);
    expect(makeCalls(fixture)).toEqual([]);
  });
});

describe('scripts/job-queue.sh the support scripts of a verify', () => {
  // A folder holding a queue script beside stub copies of the two scripts a verify reads.
  const writeSupportFolder = (root: string, name: string, copy: string): string => {
    const folder = join(root, name);
    mkdirSync(folder);
    copyFileSync(SCRIPT, join(folder, 'job-queue.sh'));
    writeFile(folder, 'verify-checkout.sh', supportStub('prepare', copy));
    writeFile(folder, 'wait-load.sh', supportStub('wait-load', copy));

    return join(folder, 'job-queue.sh');
  };

  // `<script> <copy>` for each call of a support script, in call order.
  const supportCalls = (fixture: Fixture): string[] =>
    readLines(fixture.calls)
      .filter((line) => /^(prepare|wait-load) /.test(line))
      .map((line) => line.split(' ').slice(0, 2).join(' '));

  it('runs when the track that holds the queued script is removed while queued', async () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own', {
      'scripts/job-queue.sh': readFileSync(SCRIPT, 'utf8'),
      'scripts/verify-checkout.sh': supportStub('prepare', 'main'),
      'scripts/wait-load.sh': supportStub('wait-load', 'main'),
    });
    const track = join(fixture.root, 'own-track');
    git(fixture, repository, 'worktree', 'add', '-q', '--detach', track);
    holdLock(fixture);

    const waiter = startQueueFrom(
      fixture,
      join(track, 'scripts/job-queue.sh'),
      'verify',
      track,
      'one',
    );
    await waitFor(() => waiter.stdout().includes('QUEUED one'));
    rmSync(track, { recursive: true, force: true });
    rmSync(lockPath(fixture));
    const code = await waiter.finished;

    expect(code).toBe(0);
    expect(supportCalls(fixture)).toEqual(['wait-load main', 'prepare main']);
    expect(waiter.stdout()).not.toContain('load unknown');
    expect(makeCalls(fixture)).toHaveLength(1);
  });

  it("prepares and reads the load with the main checkout's copy when the queuing copy differs", () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own', {
      'scripts/verify-checkout.sh': supportStub('prepare', 'main'),
      'scripts/wait-load.sh': supportStub('wait-load', 'main'),
    });
    const script = writeSupportFolder(fixture.root, 'loose', 'track');

    const result = runQueueFrom(fixture, script, 'verify', repository, 'one');

    expect(result.status).toBe(0);
    expect(supportCalls(fixture)).toEqual(['wait-load main', 'prepare main']);
  });

  it("falls back to the queuing script's copy when the main checkout has none", () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const script = writeSupportFolder(fixture.root, 'loose', 'track');

    const result = runQueueFrom(fixture, script, 'verify', repository, 'one');

    expect(result.status).toBe(0);
    expect(supportCalls(fixture)).toEqual(['wait-load track', 'prepare track']);
  });

  it("keeps reading the queuing script's copy for a kind other than verify", () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own', {
      'package.json': '{}\n',
      'scripts/wait-load.sh': supportStub('wait-load', 'main'),
    });
    const script = writeSupportFolder(fixture.root, 'loose', 'track');

    const result = runQueueFrom(fixture, script, 'check-all', repository, 'one');

    expect(result.status).toBe(0);
    expect(supportCalls(fixture)).toEqual(['wait-load track']);
  });
});

describe('scripts/job-queue.sh a verify environment', () => {
  it('sets KIKO_VERIFY_SCOPED=1 for make only with --scoped', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');

    runQueue(fixture, 'verify', repository, 'plain');
    runQueue(fixture, 'verify', repository, 'flagged', '--scoped');

    expect(makeCalls(fixture).map((call) => call.scoped)).toEqual(['unset', '1']);
  });

  it('removes an inherited KIKO_VERIFY_SCOPED with no flag', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    fixture.environment.KIKO_VERIFY_SCOPED = '1';
    fixture.environment.FORCE_COLOR = '1';

    runQueue(fixture, 'verify', repository, 'one');

    expect(makeCalls(fixture).map((call) => [call.scoped, call.color])).toEqual([
      ['unset', 'unset'],
    ]);
  });
});

describe('scripts/job-queue.sh the prepare step of a verify', () => {
  it('records a failed prepare as a failed verify', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    mkdirSync(siblingOf(repository));
    writeFile(siblingOf(repository), 'marker.txt', 'mine\n');

    const result = runQueue(fixture, 'verify', repository, 'one');

    expect(result.status).toBe(2);
    expect(makeCalls(fixture)).toEqual([]);
    expect(doneFields(fixture).slice(0, 3)).toEqual(['verify', 'one', '2']);
    expect(doneFields(fixture)[5]).toBe('unknown');
    expect(verifyLog(fixture, 'one')).toContain('CHECK FAILED: verify-checkout.sh');
    expect(readFileSync(join(siblingOf(repository), 'marker.txt'), 'utf8')).toBe('mine\n');
  });

  it('writes the prepare output to the verify log', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own', { 'package-lock.json': '{}\n' });
    fixture.environment.KIKO_STUB_NPM_OUTPUT = 'npm printed this line';

    const result = runQueue(fixture, 'verify', repository, 'one');

    expect(result.status).toBe(0);
    expect(readLines(fixture.calls)).toContain(`npm ci in ${siblingOf(repository)}`);
    expect(verifyLog(fixture, 'one')).toContain('npm printed this line');
  });

  it.each([
    ['TERM', 143],
    ['INT', 130],
  ] as const)('stops the prepare step on %s and frees the lock', async (signal, code) => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own', { 'package-lock.json': '{}\n' });
    const pidFile = join(fixture.root, 'npm.pid');
    fixture.environment.KIKO_STUB_NPM_PID = pidFile;

    const waiter = startQueue(fixture, 'verify', repository, 'one');
    await waitFor(() => existsSync(pidFile));
    const stubPid = Number(readFileSync(pidFile, 'utf8'));
    waiter.child.kill(`SIG${signal}`);
    const exitCode = await waiter.finished;

    expect(exitCode).toBe(code);
    expect(lockPresent(fixture)).toBe(false);
    expect(spawnSync('kill', ['-0', String(stubPid)]).status).not.toBe(0);
    expect(makeCalls(fixture)).toEqual([]);
  });

  it('records unknown and a NOTE when the job dirties the checkout', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    const change = `cd "${siblingOf(repository)}" && echo new > made-by-job.txt`;
    fixture.environment.KIKO_STUB_HOOK = change;

    const result = runQueue(fixture, 'verify', repository, 'one');

    expect(doneFields(fixture)[5]).toBe('unknown');
    expect(result.stdout).toContain('NOTE one: the tree changed during the job: made-by-job.txt');
  });
});

describe('scripts/job-queue.sh the 7th done.log field of a verify', () => {
  it.each([
    ['full', 'the 2b header', [HEADER]],
    ['full', 'the 2b header and a SKIPPED text inside another line', [HEADER, `x ${SKIPPED}`]],
    ['partial', 'the 2b header and the SKIPPED line', [HEADER, SKIPPED]],
    ['partial', 'the SKIPPED line alone', [SKIPPED]],
    ['partial', 'no 2b header', ['── make verify: stage 2a (jest) ──']],
    ['partial', 'the 2b header text inside another line', [`noise ${HEADER}`]],
    ['partial', 'the runs-in-full reason line and no header', [REASON]],
  ])('writes %s as the 7th field for %s', (field, _title, lines) => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    fixture.environment.KIKO_STUB_OUTPUT = lines.join('\n');

    runQueue(fixture, 'verify', repository, 'one');

    expect(doneFields(fixture)).toHaveLength(7);
    expect(doneFields(fixture)[6]).toBe(field);
  });

  it('writes partial for a verify of a folder that is no repository, run in place', () => {
    const fixture = createFixture();
    const folder = join(fixture.root, 'plain');
    mkdirSync(folder);

    const result = runQueue(fixture, 'verify', folder, 'one');

    expect(result.status).toBe(0);
    expect(makeCalls(fixture).map((call) => call.directory)).toEqual([folder]);
    expect(doneFields(fixture)[5]).toBe('unknown');
    expect(doneFields(fixture)[6]).toBe('partial');
  });

  it('runs a repository with an unborn HEAD in place and records unknown', () => {
    const fixture = createFixture();
    const unborn = join(fixture.root, 'unborn');
    mkdirSync(unborn);
    git(fixture, unborn, 'init', '-q', '-b', 'main');

    const result = runQueue(fixture, 'verify', unborn, 'one');

    expect(result.status).toBe(0);
    expect(makeCalls(fixture).map((call) => call.directory)).toEqual([unborn]);
    expect(doneFields(fixture)[5]).toBe('unknown');
    expect(existsSync(siblingOf(unborn))).toBe(false);
  });

  it('keeps full when the header falls out of the trimmed log', () => {
    const fixture = createFixture();
    const repository = createRepository(fixture, 'own');
    // More summary lines than the kept summary holds come first, so the header is dropped by the
    // summary and, with the noise after it, by the kept tail too.
    fixture.environment.KIKO_STUB_OUTPUT = [
      ...Array.from({ length: 150 }, (_, index) => `Tests: ${index} passed`),
      HEADER,
      ...Array.from({ length: 500 }, (_, index) => `noise ${index}`),
    ].join('\n');

    runQueue(fixture, 'verify', repository, 'one');

    expect(verifyLog(fixture, 'one')).not.toContain(HEADER);
    expect(doneFields(fixture)[6]).toBe('full');
  });
});

describe('scripts/job-queue.sh the other kinds', () => {
  const MUTATION_STUB = '#!/usr/bin/env bash\n# changed lines:\necho "changed lines: 1"\n';

  it.each([
    ['check-all', (worktree: string) => ['check-all', worktree, 'one']],
    ['security', (worktree: string) => ['security', worktree, 'one']],
    ['harness-verify', (worktree: string) => ['harness-verify', worktree, 'one']],
    [
      'gate',
      (worktree: string, head: string) => ['gate', worktree, 'one', 'main', head.slice(0, 9)],
    ],
  ])('keeps %s lines at 6 fields and runs them in the worktree', (kind, queueArguments) => {
    const fixture = createFixture();
    const worktree = createRepository(fixture, 'kind', {
      'package.json': '{}\n',
      'scripts/checks/mutation.sh': MUTATION_STUB,
    });

    const result = runQueue(fixture, ...queueArguments(worktree, headOf(fixture, worktree)));

    expect(result.status).toBe(0);
    expect(doneFields(fixture)).toHaveLength(6);
    expect(doneFields(fixture)[0]).toBe(kind);
    expect(readLines(fixture.calls).some((line) => line.includes(worktree))).toBe(true);
    expect(existsSync(siblingOf(worktree))).toBe(false);
  });
});
