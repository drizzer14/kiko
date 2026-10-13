import {
  rmSync,
  lstatSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  readlinkSync,
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

import {
  writeFile,
  commitAll,
  writeExecutable,
  buildMutationRepository,
} from './test-support/mutation-repository';

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
  '[ -z "$(printenv KIKO_STUB_OUTPUT)" ] || printenv KIKO_STUB_OUTPUT',
  'exit "$(printenv KIKO_STUB_EXIT || echo 0)"',
  '',
].join('\n');

// Records its own call, then runs the command it wraps, as the real `caffeinate -i <command>`.
const CAFFEINATE_STUB = [
  '#!/usr/bin/env bash',
  'printf "caffeinate %s\\n" "$*" >> "$KIKO_STUB_CALLS"',
  'shift',
  'exec "$@"',
  '',
].join('\n');

// Logs one line per power check, and fails like a broken pmset while the `power.fail` file exists.
const PMSET_STUB = [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$*" >> "$KIKO_STUB_POWER_LOG"',
  '[ ! -e "$KIKO_STUB_POWER.fail" ] || exit 1',
  'cat "$KIKO_STUB_POWER"',
  '',
].join('\n');

const UPTIME_STUB = [
  '#!/usr/bin/env bash',
  'echo "15:35  up 26 days,  2:46, 15 users, load averages: 1.50 2.50 3.50"',
  '',
].join('\n');

const createSandbox = (): Sandbox => {
  const root = mkdtempSync(join(tmpdir(), 'kiko-job-queue-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeExecutable(join(bin, 'make'), TOOL_STUB);
  writeExecutable(join(bin, 'npm'), TOOL_STUB);
  writeExecutable(join(bin, 'caffeinate'), CAFFEINATE_STUB);
  writeExecutable(join(bin, 'pmset'), PMSET_STUB);
  writeExecutable(join(bin, 'uptime'), UPTIME_STUB);
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
      KIKO_QUEUE_CAFFEINATE: join(bin, 'caffeinate'),
      KIKO_STUB_POWER: join(root, 'power'),
      KIKO_STUB_POWER_LOG: join(root, 'power-checks'),
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
    expect(lockPresent(sandbox)).toBe(false);
    expect(isPresent(join(sandbox.queue, 'claim'))).toBe(false);
    const finished = readLines(join(sandbox.queue, 'done.log'));
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatch(/^verify one 3 \S+ \S+$/);
  });

  it('prints the load average on the START line', () => {
    const sandbox = createSandbox();

    const result = runQueue(sandbox, 'verify', createWorktree(sandbox, 'one'), 'one');

    expect(result.stdout).toMatch(/^START one at \d\d:\d\d \(load: 1\.50 2\.50 3\.50\)$/m);
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
// reads a size without running a real mutation gate. `listLines` is the stub's whole output. The
// stub names the `changed lines:` figure in a comment, as a mutation.sh with the changed-line gate
// does, unless `hasChangedLineGate` is false (a tip from before that gate). It leaves a `listed`
// file beside itself when run, so a test can prove the queue never ran it.
const createGateWorktree = (
  sandbox: Sandbox,
  name: string,
  listLines: string[],
  listExit = 0,
  hasChangedLineGate = true,
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
      ...(hasChangedLineGate ? ['# prints a changed lines: figure'] : []),
      '[ "$1" = "--list" ] || exit 9',
      ': > "$(dirname "$0")/listed"',
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

// The lock is a symlink whose target text is its owner record, `<waiter pid> <job group or ->
// <kind> <label> <worktree>`. One atomic call takes the lock and names its owner.
const holdLock = (
  sandbox: Sandbox,
  owner = `${process.pid} - verify other /elsewhere`,
  name = 'lock',
): string => {
  const lock = join(sandbox.queue, name);
  mkdirSync(sandbox.queue, { recursive: true });
  symlinkSync(owner, lock);

  return lock;
};

// A lock is a dangling symlink, which `existsSync` reports as absent.
const isPresent = (path: string): boolean => {
  try {
    lstatSync(path);

    return true;
  } catch {
    return false;
  }
};

const lockPresent = (sandbox: Sandbox): boolean => isPresent(join(sandbox.queue, 'lock'));

const powerChecks = (sandbox: Sandbox): number =>
  readLines(sandbox.environment.KIKO_STUB_POWER_LOG as string).length;

// Every pass of the wait loop reads the power state once, so a count of those reads is the queue's
// own clock: a test that asserts a waiter did NOT act first waits until it has looped a few times.
const waitForPasses = async (sandbox: Sandbox, passes = 3): Promise<void> => {
  const target = powerChecks(sandbox) + passes;

  await waitFor(() => powerChecks(sandbox) >= target);
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

describe('scripts/job-queue.sh a gate', () => {
  it('runs make deep under caffeinate with the mutation base, logging to logs/', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    sandbox.environment.KIKO_STUB_OUTPUT = 'noise\nCHANGE SET 80\nGATE: PASS';

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'abc1234base', gate.head);

    expect(result.status).toBe(0);
    expect(readLines(sandbox.environment.KIKO_STUB_CALLS as string)).toEqual([
      `caffeinate -i make -C ${gate.worktree} deep`,
      `make -C ${gate.worktree} deep`,
      expect.stringMatching(/^ {2}cwd /),
      '  force-color unset',
      '  base abc1234base',
    ]);
    expect(readLines(join(sandbox.queue, 'logs', 'gate-gate.log'))).toEqual([
      'noise',
      'CHANGE SET 80',
      'GATE: PASS',
    ]);
    expect(result.stdout).toContain('GATE: PASS');
    expect(result.stdout).not.toContain('noise');
  });

  it('runs make directly when caffeinate is absent', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    sandbox.environment.KIKO_QUEUE_CAFFEINATE = join(sandbox.root, 'no-such-caffeinate');

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);

    expect(result.status).toBe(0);
    expect(readLines(sandbox.environment.KIKO_STUB_CALLS as string)[0]).toBe(
      `make -C ${gate.worktree} deep`,
    );
  });

  it('removes the Stryker incremental report and temporary directory before the run', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    mkdirSync(join(gate.worktree, 'reports'));
    writeFileSync(join(gate.worktree, 'reports/stryker-incremental.json'), '{}');
    writeFileSync(join(gate.worktree, 'reports/mutation.json'), '{}');
    mkdirSync(join(gate.worktree, '.stryker-tmp'));
    writeFileSync(join(gate.worktree, '.stryker-tmp/sandbox'), 'x');

    runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);

    expect(existsSync(join(gate.worktree, 'reports/stryker-incremental.json'))).toBe(false);
    expect(existsSync(join(gate.worktree, '.stryker-tmp'))).toBe(false);
    expect(existsSync(join(gate.worktree, 'reports/mutation.json'))).toBe(true);
  });

  it('accepts an abbreviated expected head', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head.slice(0, 9));

    expect(result.status).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([gate.worktree]);
  });

  it('reads the size from the real mutation.sh --list output', () => {
    const sandbox = createSandbox();
    const { root } = buildMutationRepository(join(sandbox.root, 'real'), {
      'src/changed.ts': 'export const changed = 1;\n',
    });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    const result = runQueue(sandbox, 'gate', root, 'real', 'main', head);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^QUEUED real \(gate, size 1\)/m);
  });
});

describe('scripts/job-queue.sh gate refusals', () => {
  it('exits 2 without a ticket when --list exits 2 (above the cap)', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', ['mutable files: 31 (cap 30)'], 2);

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mutation.sh --list exited 2');
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
    expect(startedWorktrees(sandbox)).toEqual([]);
  });

  it('exits 2 and says to merge main when --list prints no changed-lines line', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', ['mutable files: 1 (cap 30)']);

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('merge main');
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
  });

  it('exits 2 and says to merge main, without running mutation.sh, for a tip before the gate', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', ['mutable files: 1 (cap 30)'], 0, false);

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('merge main');
    expect(isPresent(join(gate.worktree, 'scripts/checks/listed'))).toBe(false);
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
  });

  it('exits 2 and says to merge main when the worktree has no mutation.sh', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    rmSync(join(gate.worktree, 'scripts/checks/mutation.sh'));

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('merge main');
  });

  it('exits 3 at enqueue, before sizing, when HEAD is not the expected one', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', 'deadbee');

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('HEAD moved');
    expect(isPresent(join(gate.worktree, 'scripts/checks/listed'))).toBe(false);
    expect(startedWorktrees(sandbox)).toEqual([]);
    expect(lockPresent(sandbox)).toBe(false);
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
  });

  it('exits 3 without calling make, keeping the Stryker state, when HEAD moves while queued', async () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    mkdirSync(join(gate.worktree, 'reports'));
    writeFileSync(join(gate.worktree, 'reports/stryker-incremental.json'), '{}');
    mkdirSync(join(gate.worktree, '.stryker-tmp'));
    const lock = holdLock(sandbox);

    const waiter = startQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 1);
    writeFile(gate.worktree, 'moved.txt', 'moved\n');
    commitAll(gate.worktree, 'moved');
    rmSync(lock);
    const result = await waiter.finished;

    expect(result.code).toBe(3);
    expect(result.stderr).toContain('HEAD moved');
    expect(startedWorktrees(sandbox)).toEqual([]);
    expect(lockPresent(sandbox)).toBe(false);
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
    expect(existsSync(join(gate.worktree, 'reports/stryker-incremental.json'))).toBe(true);
    expect(existsSync(join(gate.worktree, '.stryker-tmp'))).toBe(true);
  });
});

// One process with no child, so the job's group is empty the moment the job itself is gone. It
// ends on its own after a minute, so a failed test cannot leave it running for long.
const BLOCKING_MAKE_STUB = [
  '#!/usr/bin/env bash',
  'echo $$ > "$KIKO_STUB_PID"',
  'exec sleep 60',
  '',
].join('\n');

// A job that ends at once and leaves a child running: a leaked process. The child runs until the
// test creates the release file, or until the sandbox is deleted, so a failed test cannot leave it
// looping.
const LEAKING_MAKE_STUB = [
  '#!/usr/bin/env bash',
  'printf "make %s\\n" "$*" >> "$KIKO_STUB_CALLS"',
  'echo $$ > "$KIKO_STUB_PID"',
  '(',
  '  while [ ! -e "$KIKO_STUB_RELEASE" ] && [ -d "$(dirname "$KIKO_STUB_RELEASE")" ]; do',
  '    sleep 0.05',
  '  done',
  ') &',
  'echo $! > "$KIKO_STUB_GRANDCHILD"',
  'exit 0',
  '',
].join('\n');

// A real job is a chain: make starts npm, npm starts the leaf (jest, Stryker) that does the work.
// The stubs below are that chain, each writing its own pid. The leaf catches TERM and keeps
// running until the test creates the release file, as a leaf that shuts down slowly does; with
// KIKO_STUB_IGNORE_TERM set it ignores TERM and never ends on its own account.
const CHAIN_MAKE_STUB = [
  '#!/usr/bin/env bash',
  'printf "make %s\\n" "$*" >> "$KIKO_STUB_CALLS"',
  'echo $$ > "$KIKO_STUB_PID"',
  '"$KIKO_STUB_BIN/chain-npm"',
  '',
].join('\n');

const CHAIN_NPM_STUB = [
  '#!/usr/bin/env bash',
  'echo $$ > "$KIKO_STUB_MIDDLE"',
  '"$KIKO_STUB_BIN/chain-leaf"',
  '',
].join('\n');

const CHAIN_LEAF_STUB = [
  '#!/usr/bin/env bash',
  'if [ -n "$(printenv KIKO_STUB_IGNORE_TERM)" ]; then',
  '  trap "" TERM',
  'else',
  '  trap \'echo term >> "$KIKO_STUB_LEAF_LOG"\' TERM',
  'fi',
  'echo $$ > "$KIKO_STUB_GRANDCHILD"',
  'while [ ! -e "$KIKO_STUB_RELEASE" ] && [ -d "$(dirname "$KIKO_STUB_RELEASE")" ]; do',
  '  sleep 0.05 &',
  '  wait $!',
  'done',
  '',
].join('\n');

// Installs the chain as the job and points its stubs at the files a test reads.
const useChain = (sandbox: Sandbox): void => {
  const bin = join(sandbox.root, 'bin');
  writeExecutable(join(bin, 'make'), CHAIN_MAKE_STUB);
  writeExecutable(join(bin, 'chain-npm'), CHAIN_NPM_STUB);
  writeExecutable(join(bin, 'chain-leaf'), CHAIN_LEAF_STUB);
  sandbox.environment.KIKO_STUB_BIN = bin;
  sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
  sandbox.environment.KIKO_STUB_MIDDLE = join(sandbox.root, 'middle-pid');
  sandbox.environment.KIKO_STUB_GRANDCHILD = join(sandbox.root, 'leaf-pid');
  sandbox.environment.KIKO_STUB_LEAF_LOG = join(sandbox.root, 'leaf-log');
  sandbox.environment.KIKO_STUB_RELEASE = join(sandbox.root, 'release');
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

const groupOf = (pid: number): string =>
  execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim();

const readPid = (sandbox: Sandbox, name: string): number =>
  Number(readFileSync(join(sandbox.root, name), 'utf8'));

// Waits until the chain stubs have all written their pids.
const waitForChain = async (
  sandbox: Sandbox,
): Promise<{ jobPid: number; middlePid: number; leafPid: number }> => {
  await waitFor(() => readLines(join(sandbox.root, 'leaf-pid')).length === 1);

  return {
    jobPid: readPid(sandbox, 'job-pid'),
    middlePid: readPid(sandbox, 'middle-pid'),
    leafPid: readPid(sandbox, 'leaf-pid'),
  };
};

// A process in a group of its own that the queue never created: `detached` makes it a group
// leader, as a job the queue did not start would be. The pid is the group id.
const startForeignGroup = (sandbox: Sandbox): number => {
  const leader = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  sandbox.children.push(leader);

  return leader.pid as number;
};

// A poll interval far above the jest timeout: a signal that waited for the sleep to end would
// fail the test, so no signal test reads a clock.
const LONG_POLL_SECONDS = '600';

describe.each([
  ['SIGTERM', 143],
  ['SIGINT', 130],
] as const)('scripts/job-queue.sh on %s', (signal, exitCode) => {
  it(`exits ${exitCode} from the wait loop and removes only its own ticket`, async () => {
    const sandbox = createSandbox();
    sandbox.environment.KIKO_QUEUE_POLL_SECONDS = LONG_POLL_SECONDS;
    const worktree = createWorktree(sandbox, 'one');
    const lock = holdLock(sandbox);
    const owner = readlinkSync(lock);

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 1);
    waiter.child.kill(signal);
    const result = await waiter.finished;

    expect(result.code).toBe(exitCode);
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
    expect(readlinkSync(lock)).toBe(owner);
    expect(startedWorktrees(sandbox)).toEqual([]);
  });

  it(`exits ${exitCode} from the wait loop even when its ticket is already gone`, async () => {
    const sandbox = createSandbox();
    sandbox.environment.KIKO_QUEUE_POLL_SECONDS = LONG_POLL_SECONDS;
    const worktree = createWorktree(sandbox, 'one');
    holdLock(sandbox);

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 1);

    for (const ticket of entriesOf(join(sandbox.queue, 'tickets'))) {
      rmSync(join(sandbox.queue, 'tickets', ticket));
    }

    waiter.child.kill(signal);
    const result = await waiter.finished;

    expect(result.code).toBe(exitCode);
  });

  it(`exits ${exitCode} while the job runs, stops the job, and releases the lock`, async () => {
    const sandbox = createSandbox();
    writeExecutable(join(sandbox.root, 'bin/make'), BLOCKING_MAKE_STUB);
    sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
    sandbox.environment.KIKO_STUB_RELEASE = join(sandbox.root, 'release');
    const worktree = createWorktree(sandbox, 'one');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => readLines(join(sandbox.root, 'job-pid')).length === 1);
    const jobPid = Number(readFileSync(join(sandbox.root, 'job-pid'), 'utf8'));
    expect(processIsAlive(jobPid)).toBe(true);
    waiter.child.kill(signal);
    const result = await waiter.finished;

    expect(result.code).toBe(exitCode);
    expect(processIsAlive(jobPid)).toBe(false);
    expect(lockPresent(sandbox)).toBe(false);
    expect(isPresent(join(sandbox.queue, 'claim'))).toBe(false);
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
    expect(existsSync(join(sandbox.queue, 'done.log'))).toBe(false);
  });

  it(`exits ${exitCode} without removing a lock another waiter now holds`, async () => {
    const sandbox = createSandbox();
    writeExecutable(join(sandbox.root, 'bin/make'), BLOCKING_MAKE_STUB);
    sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
    const worktree = createWorktree(sandbox, 'one');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => readLines(join(sandbox.root, 'job-pid')).length === 1);
    const lock = join(sandbox.queue, 'lock');
    rmSync(lock);
    holdLock(sandbox, `${process.pid} - verify other /elsewhere`);
    waiter.child.kill(signal);
    const result = await waiter.finished;

    expect(result.code).toBe(exitCode);
    expect(readlinkSync(lock)).toBe(`${process.pid} - verify other /elsewhere`);
  });

  it(`ends the whole job chain on ${signal}, and the next job starts only after the leaf is gone`, async () => {
    const sandbox = createSandbox();
    useChain(sandbox);
    sandbox.environment.KIKO_QUEUE_STOP_POLLS = '1000';
    const worktree = createWorktree(sandbox, 'one');
    const nextWorktree = createWorktree(sandbox, 'two');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    const { jobPid, middlePid, leafPid } = await waitForChain(sandbox);
    // The job leads a process group of its own, and the whole chain belongs to it.
    expect(groupOf(jobPid)).toBe(String(jobPid));
    expect(groupOf(middlePid)).toBe(String(jobPid));
    expect(groupOf(leafPid)).toBe(String(jobPid));
    await waitFor(() => readlinkSync(join(sandbox.queue, 'lock')).split(' ')[1] === String(jobPid));
    const next = startQueue(sandbox, 'verify', nextWorktree, 'two');
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 1);
    waiter.child.kill(signal);
    await waitFor(() => readLines(join(sandbox.root, 'leaf-log')).length === 1);
    await waitFor(() => !processIsAlive(jobPid) && !processIsAlive(middlePid));
    await waitForPasses(sandbox);

    expect(processIsAlive(leafPid)).toBe(true);
    expect(waiter.child.exitCode).toBeNull();
    expect(readlinkSync(join(sandbox.queue, 'lock'))).toBe(
      `${waiter.child.pid} ${jobPid} verify one ${worktree}`,
    );
    expect(next.child.exitCode).toBeNull();
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
    writeFileSync(join(sandbox.root, 'release'), '');
    const result = await waiter.finished;
    const nextResult = await next.finished;

    expect(result.code).toBe(exitCode);
    expect(processIsAlive(leafPid)).toBe(false);
    expect(nextResult.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree, nextWorktree]);
    expect(lockPresent(sandbox)).toBe(false);
  });

  it(`exits ${exitCode} and keeps the lock, naming the group, when the leaf does not end`, async () => {
    const sandbox = createSandbox();
    useChain(sandbox);
    sandbox.environment.KIKO_STUB_IGNORE_TERM = '1';
    sandbox.environment.KIKO_QUEUE_STOP_POLLS = '3';
    const worktree = createWorktree(sandbox, 'one');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    const { jobPid, leafPid } = await waitForChain(sandbox);
    await waitFor(() => readlinkSync(join(sandbox.queue, 'lock')).split(' ')[1] === String(jobPid));
    waiter.child.kill(signal);
    // The leaf holds the queue's output pipes open, so `finished` (the close event) would wait for
    // it; the exit code is read as soon as the queue itself has gone.
    await waitFor(() => waiter.child.exitCode !== null);

    expect(waiter.child.exitCode).toBe(exitCode);
    expect(processIsAlive(leafPid)).toBe(true);
    expect(readlinkSync(join(sandbox.queue, 'lock'))).toBe(
      `${waiter.child.pid} ${jobPid} verify one ${worktree}`,
    );
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
    writeFileSync(join(sandbox.root, 'release'), '');
    process.kill(leafPid, 'SIGKILL');
    await waitFor(() => !processIsAlive(leafPid));
  });

  it(`never signals the group a lock names when ${signal} stops a waiter that started nothing`, async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const foreign = startForeignGroup(sandbox);
    holdLock(sandbox, `${process.pid} ${foreign} verify other /elsewhere`);

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 1);
    await waitForPasses(sandbox);
    waiter.child.kill(signal);
    const result = await waiter.finished;

    expect(result.code).toBe(exitCode);
    expect(processIsAlive(foreign)).toBe(true);
  });

  it(`signals only the group it created for its own job on ${signal}, not the one its record names`, async () => {
    const sandbox = createSandbox();
    writeExecutable(join(sandbox.root, 'bin/make'), BLOCKING_MAKE_STUB);
    sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
    const worktree = createWorktree(sandbox, 'one');
    const foreign = startForeignGroup(sandbox);

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => readLines(join(sandbox.root, 'job-pid')).length === 1);
    const jobPid = Number(readFileSync(join(sandbox.root, 'job-pid'), 'utf8'));
    rmSync(join(sandbox.queue, 'lock'));
    holdLock(sandbox, `${waiter.child.pid} ${foreign} verify one ${worktree}`);
    waiter.child.kill(signal);
    const result = await waiter.finished;

    expect(result.code).toBe(exitCode);
    expect(processIsAlive(jobPid)).toBe(false);
    expect(processIsAlive(foreign)).toBe(true);
  });
});

// A pid that is certainly dead: the subshell prints its own pid and exits before spawnSync returns.
const deadPid = (): string =>
  spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim();

describe('scripts/job-queue.sh stale state', () => {
  it('removes a ticket and a lock whose owners are gone, then runs the job', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const staleTicket = `1-0000000000-1-${deadPid()}-ghost`;
    mkdirSync(join(sandbox.queue, 'tickets'), { recursive: true });
    writeFileSync(join(sandbox.queue, 'tickets', staleTicket), '');
    holdLock(sandbox, `${deadPid()} - verify ghost /elsewhere`);

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    const result = await waiter.finished;

    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
    expect(lockPresent(sandbox)).toBe(false);
  });

  it('reclaims a lock whose record names no pid at all, once nothing it names is alive', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    holdLock(sandbox, 'garbage');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => waiter.child.exitCode !== null);
    const result = await waiter.finished;

    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
    expect(lockPresent(sandbox)).toBe(false);
  });

  it('does not reclaim a lock whose record names only a live waiter pid', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const lock = holdLock(sandbox, `${process.pid}`);

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 1);
    await waitForPasses(sandbox);

    expect(waiter.child.exitCode).toBeNull();
    expect(startedWorktrees(sandbox)).toEqual([]);
    expect(readlinkSync(lock)).toBe(`${process.pid}`);
  });

  it('does not reclaim a lock whose waiter is dead while its job group still has a member', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    // `detached` makes the process the leader of a group of its own, as a queued job is.
    const leader = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
    sandbox.children.push(leader);
    const leaderExited = new Promise((settle) => leader.on('exit', settle));
    const record = `${deadPid()} ${leader.pid} verify ghost /elsewhere`;
    const lock = holdLock(sandbox, record);

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 1);
    await waitForPasses(sandbox);

    expect(waiter.child.exitCode).toBeNull();
    expect(startedWorktrees(sandbox)).toEqual([]);
    expect(readlinkSync(lock)).toBe(record);
    leader.kill();
    await leaderExited;
    const result = await waiter.finished;
    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
  });

  it('lets only the head waiter reclaim a stale lock', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const staleRecord = `${deadPid()} - verify ghost /elsewhere`;
    const lock = holdLock(sandbox, staleRecord);
    // A live waiter's ticket that sorts first, so the waiter below is not the head.
    mkdirSync(join(sandbox.queue, 'tickets'), { recursive: true });
    const headTicket = join(sandbox.queue, 'tickets', `1-0000000000-1-${process.pid}-head`);
    writeFileSync(headTicket, '');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 2);
    await waitForPasses(sandbox);

    expect(waiter.child.exitCode).toBeNull();
    expect(startedWorktrees(sandbox)).toEqual([]);
    expect(readlinkSync(lock)).toBe(staleRecord);
    rmSync(headTicket);
    const result = await waiter.finished;
    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
  });

  it('waits while another waiter holds the claim, and starts once the claim is gone', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const claim = holdLock(sandbox, `${process.pid}`, 'claim');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => entriesOf(join(sandbox.queue, 'tickets')).length === 1);
    await waitForPasses(sandbox);

    expect(waiter.child.exitCode).toBeNull();
    expect(startedWorktrees(sandbox)).toEqual([]);
    rmSync(claim);
    const result = await waiter.finished;
    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
  });

  it('reclaims a claim whose holder is dead', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    holdLock(sandbox, deadPid(), 'claim');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => waiter.child.exitCode !== null);
    const result = await waiter.finished;

    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
    expect(isPresent(join(sandbox.queue, 'claim'))).toBe(false);
  });

  it('keeps the lock after the job ends while a process of the job still runs, then frees it', async () => {
    const sandbox = createSandbox();
    writeExecutable(join(sandbox.root, 'bin/make'), LEAKING_MAKE_STUB);
    sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
    sandbox.environment.KIKO_STUB_GRANDCHILD = join(sandbox.root, 'grandchild-pid');
    sandbox.environment.KIKO_STUB_RELEASE = join(sandbox.root, 'release');
    const worktree = createWorktree(sandbox, 'one');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => waiter.stdout().includes('DRAIN one'));
    const jobPid = readFileSync(join(sandbox.root, 'job-pid'), 'utf8').trim();

    expect(waiter.child.exitCode).toBeNull();
    expect(readlinkSync(join(sandbox.queue, 'lock'))).toBe(
      `${waiter.child.pid} ${jobPid} verify one ${worktree}`,
    );
    expect(existsSync(join(sandbox.queue, 'done.log'))).toBe(false);
    writeFileSync(join(sandbox.root, 'release'), '');
    const result = await waiter.finished;

    expect(result.code).toBe(0);
    expect(lockPresent(sandbox)).toBe(false);
    expect(readLines(join(sandbox.queue, 'done.log'))).toHaveLength(1);
  });

  it('removes a ticket with a malformed name, which would hold the head forever', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    mkdirSync(join(sandbox.queue, 'tickets'), { recursive: true });
    writeFileSync(join(sandbox.queue, 'tickets', '0-junk'), '');

    const result = await startQueue(sandbox, 'verify', worktree, 'one').finished;

    expect(result.code).toBe(0);
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
  });
});

const BATTERY_POWER = "Now drawing from 'Battery Power'\n";

describe('scripts/job-queue.sh hold and release', () => {
  it('hold records the reason, status shows it, and release removes it', () => {
    const sandbox = createSandbox();

    const held = runQueue(sandbox, 'hold', 'on', 'battery');
    const recordedReason = readFileSync(join(sandbox.queue, 'hold'), 'utf8').trim();
    const statusWhileHeld = runQueue(sandbox, 'status');
    const released = runQueue(sandbox, 'release');
    const statusAfter = runQueue(sandbox, 'status');

    expect(held.status).toBe(0);
    expect(recordedReason).toBe('on battery');
    expect(statusWhileHeld.stdout).toContain('hold: on battery');
    expect(released.status).toBe(0);
    expect(statusAfter.stdout.trim()).toBe('queue empty');
  });

  it('release succeeds when nothing is held', () => {
    expect(runQueue(createSandbox(), 'release').status).toBe(0);
  });

  it('hold without a reason exits 2', () => {
    const result = runQueue(createSandbox(), 'hold');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
  });

  it('starts no job while the queue is held, then runs it after release', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    runQueue(sandbox, 'hold', 'battery');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => waiter.stdout().includes('WAITING one: hold (battery)'));

    expect(waiter.child.exitCode).toBeNull();
    expect(startedWorktrees(sandbox)).toEqual([]);
    runQueue(sandbox, 'release');
    const result = await waiter.finished;
    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
  });
});

describe('scripts/job-queue.sh battery power', () => {
  it('starts no job of any class on battery, then runs them in class order on AC power', async () => {
    const sandbox = createSandbox();
    const verifyWorktree = createWorktree(sandbox, 'verify');
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    writeFileSync(sandbox.environment.KIKO_STUB_POWER as string, BATTERY_POWER);

    const gateWaiter = startQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);
    const verifyWaiter = startQueue(sandbox, 'verify', verifyWorktree, 'verify');
    await waitFor(() => gateWaiter.stdout().includes('WAITING gate: battery power'));
    await waitFor(() => verifyWaiter.stdout().includes('WAITING verify: battery power'));

    expect(gateWaiter.child.exitCode).toBeNull();
    expect(verifyWaiter.child.exitCode).toBeNull();
    expect(startedWorktrees(sandbox)).toEqual([]);
    writeFileSync(sandbox.environment.KIKO_STUB_POWER as string, AC_POWER);
    const results = await Promise.all([gateWaiter.finished, verifyWaiter.finished]);

    expect(results.map((result) => result.code)).toEqual([0, 0]);
    expect(startedWorktrees(sandbox)).toEqual([verifyWorktree, gate.worktree]);
  });

  it('asks pmset for the battery state', () => {
    const sandbox = createSandbox();
    writeExecutable(
      join(sandbox.root, 'bin/pmset'),
      '#!/usr/bin/env bash\nprintf "pmset %s\\n" "$*" >> "$KIKO_STUB_CALLS"\ncat "$KIKO_STUB_POWER"\n',
    );

    runQueue(sandbox, 'verify', createWorktree(sandbox, 'one'), 'one');

    expect(readLines(sandbox.environment.KIKO_STUB_CALLS as string)).toContain('pmset -g batt');
  });

  it('treats a machine without pmset as on AC power', () => {
    const sandbox = createSandbox();
    sandbox.environment.KIKO_QUEUE_PMSET = join(sandbox.root, 'no-such-pmset');

    const result = runQueue(sandbox, 'verify', createWorktree(sandbox, 'one'), 'one');

    expect(result.status).toBe(0);
  });

  it('reads only the first line of the pmset output, however long the output is', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const filler = `${'x'.repeat(100_000)}\n`.repeat(3);
    writeFileSync(sandbox.environment.KIKO_STUB_POWER as string, BATTERY_POWER + filler);

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => waiter.stdout().includes('WAITING one: battery power'));

    expect(startedWorktrees(sandbox)).toEqual([]);
    writeFileSync(
      sandbox.environment.KIKO_STUB_POWER as string,
      `${AC_POWER} -InternalBattery-0 (id=1)\t100%; Battery Power\n`,
    );
    const result = await waiter.finished;
    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
  });

  // A pmset that is present but silent or failing says nothing about the power source, so the
  // queue holds instead of reading AC.
  it.each([
    ['prints nothing', '', false],
    ['exits non-zero', AC_POWER, true],
  ])('holds with "power state unknown" when pmset %s', async (_title, output, fails) => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const power = sandbox.environment.KIKO_STUB_POWER as string;
    writeFileSync(power, output);

    if (fails) {
      writeFileSync(`${power}.fail`, '');
    }

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => waiter.stdout().includes('WAITING one: power state unknown'));

    expect(startedWorktrees(sandbox)).toEqual([]);
    expect(runQueue(sandbox, 'status').stdout).toContain('power state unknown: no job starts');
    rmSync(`${power}.fail`, { force: true });
    writeFileSync(power, AC_POWER);
    const result = await waiter.finished;
    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
  });
});

describe('scripts/job-queue.sh status', () => {
  it('prints "queue empty" for an empty state directory', () => {
    const result = runQueue(createSandbox(), 'status');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('queue empty');
  });

  it('shows the running job, the queued tickets, and battery power', () => {
    const sandbox = createSandbox();
    holdLock(sandbox, `${process.pid} 4242 gate other-label /elsewhere`);
    mkdirSync(join(sandbox.queue, 'tickets'), { recursive: true });
    writeFileSync(join(sandbox.queue, 'tickets', `1-0000000000-1-${process.pid}-next`), '');
    writeFileSync(sandbox.environment.KIKO_STUB_POWER as string, BATTERY_POWER);

    const result = runQueue(sandbox, 'status');

    expect(result.stdout).toContain(`running: ${process.pid} 4242 gate other-label /elsewhere`);
    expect(result.stdout).toContain(`queued: 1-0000000000-1-${process.pid}-next`);
    expect(result.stdout).toContain('battery power: no job starts');
    expect(result.stdout).not.toContain('queue empty');
  });
});
