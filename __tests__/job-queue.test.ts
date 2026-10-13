import {
  rmSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {
  type ChildProcess,
  type SpawnSyncReturns,
  spawn,
  spawnSync,
  execFileSync,
} from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeExecutable } from './test-support/mutation-repository';

// scripts/job-queue.sh is the one in-repo queue for heavy jobs. Each test runs it against a
// throwaway KIKO_QUEUE_DIR with `make`, `npm`, `caffeinate`, and `pmset` stubbed, so no real job
// runs and no real power state is read.
const SCRIPT = join(__dirname, '../scripts/job-queue.sh');
const AC_POWER = "Now drawing from 'AC Power'\n";

type Sandbox = {
  root: string;
  queue: string;
  environment: NodeJS.ProcessEnv;
  children: ChildProcess[];
};

let sandboxes: Sandbox[] = [];

// One stub body serves `make` and `npm`: it records its own name, arguments, working directory,
// and the variables a test asserts on.
const TOOL_STUB = [
  '#!/usr/bin/env bash',
  '{',
  '  printf "%s %s\\n" "$(basename "$0")" "$*"',
  '  printf "  cwd %s\\n" "$PWD"',
  '  printf "  force-color %s\\n" "$(printenv FORCE_COLOR || echo unset)"',
  '  printf "  base %s\\n" "$(printenv KIKO_MUTATION_BASE || echo unset)"',
  '} >> "$KIKO_STUB_CALLS"',
  'exit "$(printenv KIKO_STUB_EXIT || echo 0)"',
  '',
].join('\n');

const createSandbox = (): Sandbox => {
  const root = mkdtempSync(join(tmpdir(), 'kiko-job-queue-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeExecutable(join(bin, 'make'), TOOL_STUB);
  writeExecutable(join(bin, 'npm'), TOOL_STUB);
  writeExecutable(join(bin, 'pmset'), '#!/usr/bin/env bash\ncat "$KIKO_STUB_POWER"\n');
  writeFileSync(join(root, 'power'), AC_POWER);

  const sandbox: Sandbox = {
    root,
    queue: join(root, 'queue'),
    environment: {
      ...process.env,
      FORCE_COLOR: '1',
      PATH: `${bin}:${process.env.PATH}`,
      KIKO_QUEUE_DIR: join(root, 'queue'),
      KIKO_QUEUE_POLL_SECONDS: '0.1',
      KIKO_QUEUE_PMSET: join(bin, 'pmset'),
      KIKO_STUB_POWER: join(root, 'power'),
      KIKO_STUB_CALLS: join(root, 'calls'),
    },
    children: [],
  };
  sandboxes.push(sandbox);

  return sandbox;
};

const runQueue = (sandbox: Sandbox, ...queueArguments: string[]): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT, ...queueArguments], {
    encoding: 'utf8',
    env: sandbox.environment,
  });

type Finished = { code: number | null; stdout: string; stderr: string };

type Waiter = {
  child: ChildProcess;
  finished: Promise<Finished>;
  stdout: () => string;
};

// A queue process that stays alive while the test inspects the queue state around it.
const startQueue = (sandbox: Sandbox, ...queueArguments: string[]): Waiter => {
  const child = spawn('bash', [SCRIPT, ...queueArguments], {
    env: sandbox.environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  sandbox.children.push(child);

  return {
    child,
    stdout: () => stdout,
    finished: new Promise((settle) => {
      child.on('close', (code) => settle({ code, stdout, stderr }));
    }),
  };
};

const POLL_LIMIT = 500;

// Longer than the poll limit allows, so a state that never appears fails with its own message.
jest.setTimeout(20_000);

// Polls a file-system or output condition. A poll count (not a measured time) bounds it, so a
// condition that never holds fails the test instead of leaving a loop that keeps jest alive.
const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let poll = 0; !condition(); poll += 1) {
    if (poll >= POLL_LIMIT) {
      throw new Error('the awaited queue state never appeared');
    }

    await new Promise((settle) => setTimeout(settle, 20));
  }
};

afterEach(() => {
  for (const sandbox of sandboxes) {
    for (const child of sandbox.children) {
      child.kill();
    }

    rmSync(sandbox.root, { recursive: true, force: true });
  }

  sandboxes = [];
});

describe('scripts/job-queue.sh usage', () => {
  it('exits 2 with the usage on stderr when given no arguments', () => {
    const result = runQueue(createSandbox());

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
  });

  it('exits 2 and names an unknown kind', () => {
    const result = runQueue(createSandbox(), 'frobnicate', '/somewhere', 'label');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown command: frobnicate');
    expect(result.stderr).toContain('usage:');
  });

  it.each([
    ['verify without a worktree or label', ['verify']],
    ['verify without a label', ['verify', '/somewhere']],
    ['verify with an extra argument', ['verify', '/somewhere', 'label', 'extra']],
    ['gate without an expected head', ['gate', '/somewhere', 'label', 'base']],
    ['gate with an unknown flag', ['gate', '/somewhere', 'label', 'base', 'abc1234', '--short']],
    ['a label with a slash', ['verify', '/somewhere', 'a/b']],
    ['a label with a space', ['verify', '/somewhere', 'a b']],
  ])('exits 2 for %s', (_title, queueArguments) => {
    const result = runQueue(createSandbox(), ...queueArguments);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
  });

  it('exits 2 when the worktree is not a directory', () => {
    const sandbox = createSandbox();

    const result = runQueue(sandbox, 'verify', join(sandbox.root, 'missing'), 'label');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not a directory');
  });
});

const createWorktree = (sandbox: Sandbox, name: string): string => {
  const worktree = join(sandbox.root, name);
  mkdirSync(worktree);

  return worktree;
};

const readLines = (path: string): string[] =>
  existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : [];

const entriesOf = (directory: string): string[] =>
  existsSync(directory) ? readdirSync(directory) : [];

describe('scripts/job-queue.sh a single job', () => {
  it('runs make verify with FORCE_COLOR unset, in the worktree it was given', () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');

    const result = runQueue(sandbox, 'verify', worktree, 'one');

    expect(result.status).toBe(0);
    expect(readLines(sandbox.environment.KIKO_STUB_CALLS as string)).toEqual([
      `make -C ${worktree} verify`,
      expect.stringMatching(/^ {2}cwd /),
      '  force-color unset',
      '  base unset',
    ]);
  });

  it('passes the job exit code through and prints QUEUED, START, and DONE lines', () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    sandbox.environment.KIKO_STUB_EXIT = '7';

    const result = runQueue(sandbox, 'verify', worktree, 'one');

    expect(result.status).toBe(7);
    expect(result.stdout).toMatch(/^QUEUED one \(verify\)/m);
    expect(result.stdout).toMatch(/^START one /m);
    expect(result.stdout).toMatch(/^DONE one exit 7 /m);
  });

  it('leaves no ticket and no lock, and one done.log line', () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    sandbox.environment.KIKO_STUB_EXIT = '3';

    runQueue(sandbox, 'verify', worktree, 'one');

    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
    expect(existsSync(join(sandbox.queue, 'lock'))).toBe(false);
    const finished = readLines(join(sandbox.queue, 'done.log'));
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatch(/^verify one 3 \S+ \S+$/);
  });

  it('runs npm --prefix <worktree> run check:all for check-all', () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');

    const result = runQueue(sandbox, 'check-all', worktree, 'one');

    expect(result.status).toBe(0);
    expect(readLines(sandbox.environment.KIKO_STUB_CALLS as string)[0]).toBe(
      `npm --prefix ${worktree} run check:all`,
    );
    expect(readLines(sandbox.environment.KIKO_STUB_CALLS as string)).toContain(
      '  force-color unset',
    );
  });

  it('runs npm run check:security inside the worktree for security', () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');

    const result = runQueue(sandbox, 'security', worktree, 'one');

    expect(result.status).toBe(0);
    const calls = readLines(sandbox.environment.KIKO_STUB_CALLS as string);
    expect(calls[0]).toBe('npm run check:security');
    expect(realpathSync(calls[1].replace('  cwd ', ''))).toBe(realpathSync(worktree));
    expect(calls).toContain('  force-color unset');
  });
});

type GateWorktree = { worktree: string; head: string };

// A git repository whose scripts/checks/mutation.sh prints what `--list` prints, so the queue
// reads a size without running a real mutation gate. `listLines` is the stub's whole output.
const createGateWorktree = (
  sandbox: Sandbox,
  name: string,
  listLines: string[],
  listExit = 0,
): GateWorktree => {
  const worktree = createWorktree(sandbox, name);
  const git = (...gitArguments: string[]): string =>
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...gitArguments],
      { cwd: worktree, encoding: 'utf8' },
    ).trim();
  git('init', '-q', '-b', 'main');
  mkdirSync(join(worktree, 'scripts/checks'), { recursive: true });
  writeExecutable(
    join(worktree, 'scripts/checks/mutation.sh'),
    [
      '#!/usr/bin/env bash',
      '[ "$1" = "--list" ] || exit 9',
      ...listLines.map((line) => `printf '%s\\n' '${line}'`),
      `exit ${listExit}`,
      '',
    ].join('\n'),
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'gate worktree');

  return { worktree, head: git('rev-parse', 'HEAD') };
};

const listing = (changedLines: number): string[] => [
  `src/a.ts 1-${changedLines} (${changedLines} changed lines)`,
  `changed lines: ${changedLines}`,
  'mutable files: 1 (cap 30)',
];

const holdLock = (sandbox: Sandbox, owner = `${process.pid} verify other /elsewhere`): string => {
  const lock = join(sandbox.queue, 'lock');
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner'), `${owner}\n`);

  return lock;
};

// The worktree each started job names, in the order the stub `make` was called.
const startedWorktrees = (sandbox: Sandbox): string[] =>
  readLines(sandbox.environment.KIKO_STUB_CALLS as string)
    .filter((line) => line.startsWith('make -C '))
    .map((line) => line.split(' ')[2]);

describe('scripts/job-queue.sh job order', () => {
  it('runs the shortest class first and gates by changed lines, a long gate last', async () => {
    const sandbox = createSandbox();
    const verifyWorktree = createWorktree(sandbox, 'verify');
    const big = createGateWorktree(sandbox, 'big', listing(900));
    const small = createGateWorktree(sandbox, 'small', listing(40));
    const long = createGateWorktree(sandbox, 'long', listing(5));
    const lock = holdLock(sandbox);

    const waiters = [
      startQueue(sandbox, 'gate', big.worktree, 'big', 'main', big.head),
      startQueue(sandbox, 'gate', small.worktree, 'small', 'main', small.head),
      startQueue(sandbox, 'gate', long.worktree, 'long', 'main', long.head, '--long'),
      startQueue(sandbox, 'verify', verifyWorktree, 'verify'),
    ];
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 4);
    rmSync(lock, { recursive: true });
    const results = await Promise.all(waiters.map((waiter) => waiter.finished));

    expect(results.map((result) => result.code)).toEqual([0, 0, 0, 0]);
    expect(startedWorktrees(sandbox)).toEqual([
      verifyWorktree,
      small.worktree,
      big.worktree,
      long.worktree,
    ]);
  });

  it('runs one job at a time while another holds the lock', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const lock = holdLock(sandbox);

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 1);

    expect(waiter.child.exitCode).toBeNull();
    expect(startedWorktrees(sandbox)).toEqual([]);
    rmSync(lock, { recursive: true });
    await waiter.finished;
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
  });

  it('names the ticket class, size, and pid in sort order', async () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(7));
    holdLock(sandbox);

    const waiter = startQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 1);

    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([
      expect.stringMatching(new RegExp(`^2-0000000007-\\d+-${waiter.child.pid}-gate$`)),
    ]);
  });
});

describe('scripts/job-queue.sh status', () => {
  it('prints "queue empty" for an empty state directory', () => {
    const result = runQueue(createSandbox(), 'status');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('queue empty');
  });
});
