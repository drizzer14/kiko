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

import { buildMutationRepository, writeExecutable } from './test-support/mutation-repository';

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

const createSandbox = (): Sandbox => {
  const root = mkdtempSync(join(tmpdir(), 'kiko-job-queue-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeExecutable(join(bin, 'make'), TOOL_STUB);
  writeExecutable(join(bin, 'npm'), TOOL_STUB);
  writeExecutable(join(bin, 'caffeinate'), CAFFEINATE_STUB);
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
      KIKO_QUEUE_CAFFEINATE: join(bin, 'caffeinate'),
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

  it('exits 3 without calling make, and releases the lock, when HEAD is not the expected one', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', 'deadbee');

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('HEAD moved');
    expect(startedWorktrees(sandbox)).toEqual([]);
    expect(existsSync(join(sandbox.queue, 'lock'))).toBe(false);
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
});

describe('scripts/job-queue.sh status', () => {
  it('prints "queue empty" for an empty state directory', () => {
    const result = runQueue(createSandbox(), 'status');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('queue empty');
  });

  it('shows the running job, the queued tickets, and battery power', () => {
    const sandbox = createSandbox();
    holdLock(sandbox, `${process.pid} gate other-label /elsewhere`);
    mkdirSync(join(sandbox.queue, 'tickets'), { recursive: true });
    writeFileSync(join(sandbox.queue, 'tickets', `1-0000000000-1-${process.pid}-next`), '');
    writeFileSync(sandbox.environment.KIKO_STUB_POWER as string, BATTERY_POWER);

    const result = runQueue(sandbox, 'status');

    expect(result.stdout).toContain(`running: ${process.pid} gate other-label /elsewhere`);
    expect(result.stdout).toContain(`queued: 1-0000000000-1-${process.pid}-next`);
    expect(result.stdout).toContain('battery power: no job starts');
    expect(result.stdout).not.toContain('queue empty');
  });
});
