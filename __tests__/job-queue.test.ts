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
import { warmExecutables } from './test-support/warm-executables';
import { HIGH_LOAD, LOW_LOAD, sysctlCallCount, writeSysctlStub } from './test-support/sysctl-stub';

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
  warmExecutables([
    writeExecutable(join(bin, 'make'), TOOL_STUB),
    writeExecutable(join(bin, 'npm'), TOOL_STUB),
    writeExecutable(join(bin, 'caffeinate'), CAFFEINATE_STUB),
    writeExecutable(join(bin, 'pmset'), PMSET_STUB),
    writeExecutable(join(bin, 'uptime'), UPTIME_STUB),
  ]);
  // A gate reads the 5-minute load before it starts, so every sandbox starts on a quiet machine
  // instead of the real one.
  writeSysctlStub(bin, LOW_LOAD, LOW_LOAD, 0);
  warmExecutables([join(bin, 'sysctl')]);
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

const POLL_LIMIT = 3000;

// Twice the 60 s poll budget (POLL_LIMIT x 20 ms), so a state that never appears fails with its
// own message and a chain test that waits twice in a row still fits.
jest.setTimeout(120_000);

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

// About 30 s (TEARDOWN_POLL_LIMIT x 20 ms), below the 120 s hook timeout and well above a green
// teardown.
const TEARDOWN_POLL_LIMIT = 1500;

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

// A killed waiter's TERM trap still removes its ticket, claim, and lock in the sandbox, so the
// folders are removed only once every child has exited: an rmSync that races the trap fails with
// ENOTEMPTY on a loaded machine.
afterEach(async () => {
  const children = sandboxes.flatMap((sandbox) => sandbox.children);

  for (const child of children) {
    if (!hasExited(child)) {
      child.kill();
    }
  }

  // Bounded by a poll count, and it breaks instead of throwing (unlike waitFor) so the sandboxes
  // are still removed: a red row can leave a stub loop that ends only when its sandbox is removed.
  for (let poll = 0; !children.every(hasExited); poll += 1) {
    if (poll >= TEARDOWN_POLL_LIMIT) {
      break;
    }

    await new Promise((settle) => setTimeout(settle, 20));
  }

  for (const sandbox of sandboxes) {
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
    expect(finished[0]).toMatch(/^verify one 3 \S+ \S+ (?:[0-9a-f]{40}|unknown)$/);
  });

  it('prints the head sha and the load average on the START line', () => {
    const sandbox = createSandbox();
    const { worktree } = createGateWorktree(sandbox, 'one', listing(1));

    const result = runQueue(sandbox, 'verify', worktree, 'one');

    expect(result.stdout).toMatch(
      /^START one at \d\d:\d\d head [0-9a-f]{12} \(load: 1\.50 2\.50 3\.50\)$/m,
    );
  });

  it('names the worktree HEAD at start on the START line of a job that is not a gate', () => {
    const sandbox = createSandbox();
    const { worktree } = createGateWorktree(sandbox, 'one', listing(1));
    writeFile(worktree, 'later.txt', 'a later commit\n');
    commitAll(worktree, 'a later commit');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: worktree,
      encoding: 'utf8',
    }).trim();

    const result = runQueue(sandbox, 'verify', worktree, 'one');

    expect(result.stdout).toMatch(
      new RegExp(`^START one at \\d\\d:\\d\\d head ${head.slice(0, 12)} `, 'm'),
    );
  });

  it('prints head unknown for a worktree that is not a git repository', () => {
    const sandbox = createSandbox();

    const result = runQueue(sandbox, 'verify', createWorktree(sandbox, 'one'), 'one');

    expect(result.stdout).toMatch(/^START one at \d\d:\d\d head unknown \(load: /m);
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
  // The stub's `listed` marker is not a change to the tree a job is tested on.
  writeFileSync(join(worktree, '.git/info/exclude'), 'scripts/checks/listed\n');
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

  it('prints a TIMEOUT-HEAVY line once, although the gate output holds it twice', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    const heavy = 'TIMEOUT-HEAVY src/a.ts: timeout 7 of 10 detected (70 %), killed 3';
    sandbox.environment.KIKO_STUB_OUTPUT = `noise\n${heavy}\nGATE: FAIL\n${heavy}`;

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);

    expect(result.stdout.split('\n').filter((line) => line === heavy)).toEqual([heavy]);
    expect(result.stdout).not.toContain('noise');
  });

  describe('the gate log lines mutation.sh and mutation-score.js print on a failure', () => {
    const FIRST_RUN = [
      'FIRST RUN: src/a.ts: 100.00 killed=2 timeout=5 survived=0 noCoverage=0',
      'FIRST RUN: CHANGE SET TOTAL: 100.00 killed=2 timeout=5 survived=0 noCoverage=0',
      'FIRST RUN: GATE: change set >= 75, each file >= 60, a file fails TIMEOUT-HEAVY when timeout > 50% of detected and >= 3',
      'FIRST RUN: TIMEOUT-HEAVY src/a.ts: timeout 5 of 7 detected (71.4 %), killed 2, score without timeouts 28.57 < 60',
    ];
    const RERUN = 'RERUN src/a.ts: 5 timed out -> 3 killed, 1 survived, 1 timeout';
    const FINAL_TOTAL = 'CHANGE SET TOTAL: 80.00 killed=4 timeout=1 survived=1 noCoverage=0';
    const FINAL_GATE = 'GATE: change set >= 75, each file >= 60';
    const FINAL_HEAVY = 'TIMEOUT-HEAVY src/a.ts: timeout 1 of 5 detected (20.0 %), killed 4';
    const BLOCK = 'CHECK FAILED: Stryker (mutation testing)';

    const stdoutLines = (stubOutput: string): string[] => {
      const sandbox = createSandbox();
      const gate = createGateWorktree(sandbox, 'gate', listing(12));
      sandbox.environment.KIKO_STUB_OUTPUT = stubOutput;

      return runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head).stdout.split('\n');
    };

    it.each([
      [
        'REPORT SCOPE MISMATCH',
        'REPORT SCOPE MISMATCH: the report does not belong to this run (its recorded config.mutate differs from the changed files).',
      ],
      ['RERUN', RERUN],
      ['RERUN SKIPPED (cap)', 'RERUN SKIPPED: 500 mutants over the cap'],
      ['RERUN SKIPPED (load)', 'RERUN SKIPPED: load'],
    ])('prints the %s line once, although the gate log holds it twice', (_name, line) => {
      const lines = stdoutLines(`noise\n${line}\n${BLOCK}\n${line}`);

      expect(lines.filter((candidate) => candidate === line)).toEqual([line]);
      expect(lines).not.toContain('noise');
    });

    it('shows the final verdict and the RERUN line, never the first run it replaced', () => {
      const lines = stdoutLines(
        [
          ...FIRST_RUN,
          RERUN,
          FINAL_TOTAL,
          FINAL_GATE,
          FINAL_HEAVY,
          BLOCK,
          RERUN,
          FINAL_TOTAL,
          FINAL_GATE,
          FINAL_HEAVY,
        ].join('\n'),
      );

      expect(lines.filter((line) => line === RERUN)).toEqual([RERUN]);
      expect(lines).toContain(FINAL_TOTAL);
      expect(lines.filter((line) => line === FINAL_HEAVY)).toEqual([FINAL_HEAVY]);
      expect(lines.filter((line) => line.startsWith('FIRST RUN: '))).toEqual([]);
    });
  });

  it('forwards the --list warning line to the waiter, once', () => {
    const sandbox = createSandbox();
    const warning = 'warning: 300 changed lines, but this branch added only 20 of them itself';
    const gate = createGateWorktree(sandbox, 'gate', [...listing(12), warning]);

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);

    expect(result.status).toBe(0);
    expect(result.stdout.split('\n').filter((line) => line === warning)).toEqual([warning]);
    expect(result.stdout).not.toContain('mutable files:');
  });

  it.each([
    ['the full expected head', (head: string) => head],
    ['an abbreviated expected head', (head: string) => head.slice(0, 7)],
  ])('prints the 12-character worktree head on the START line from %s', (_name, expected) => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', expected(gate.head));

    expect(result.stdout).toMatch(
      new RegExp(`^START gate at \\d\\d:\\d\\d head ${gate.head.slice(0, 12)} \\(load: `, 'm'),
    );
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
  // A warm-up run has no sandbox variables and must not block.
  '[ -n "$KIKO_STUB_PID" ] || exit 0',
  'echo $$ > "$KIKO_STUB_PID"',
  'exec sleep 60',
  '',
].join('\n');

// The queue runs this in the window between starting the job and learning its pid, with its own pid
// as the argument. It waits until the job has written its pid, so the job is certainly running,
// then sends the queue the signal a test names. It ends on its own once the sandbox is deleted.
const FORK_HOOK_STUB = [
  '#!/usr/bin/env bash',
  `while [ ! -s "$KIKO_STUB_PID" ] && [ -d "\${KIKO_STUB_PID%/*}" ]; do`,
  '  sleep 0.02',
  'done',
  'kill -s "$KIKO_STUB_HOOK_SIGNAL" "$1"',
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
  `  while [ ! -e "$KIKO_STUB_RELEASE" ] && [ -d "\${KIKO_STUB_RELEASE%/*}" ]; do`,
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
  'if [ -n "$KIKO_STUB_IGNORE_TERM" ]; then',
  '  trap "" TERM',
  'else',
  '  trap \'echo term >> "$KIKO_STUB_LEAF_LOG"\' TERM',
  'fi',
  'echo $$ > "$KIKO_STUB_GRANDCHILD"',
  // The loop starts no child per pass: a `$(dirname ...)` that the group TERM kills would end it.
  `while [ ! -e "$KIKO_STUB_RELEASE" ] && [ -d "\${KIKO_STUB_RELEASE%/*}" ]; do`,
  '  sleep 0.05 &',
  '  wait $!',
  'done',
  '',
].join('\n');

// Installs the chain as the job and points its stubs at the files a test reads.
const useChain = (sandbox: Sandbox): void => {
  const bin = join(sandbox.root, 'bin');
  warmExecutables([
    writeExecutable(join(bin, 'make'), CHAIN_MAKE_STUB),
    writeExecutable(join(bin, 'chain-npm'), CHAIN_NPM_STUB),
    writeExecutable(join(bin, 'chain-leaf'), CHAIN_LEAF_STUB),
  ]);
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
    warmExecutables([writeExecutable(join(sandbox.root, 'bin/make'), BLOCKING_MAKE_STUB)]);
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
    warmExecutables([writeExecutable(join(sandbox.root, 'bin/make'), BLOCKING_MAKE_STUB)]);
    sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
    const worktree = createWorktree(sandbox, 'one');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => readLines(join(sandbox.root, 'job-pid')).length === 1);
    const lock = join(sandbox.queue, 'lock');
    // The queue renames the job group into the owner record after the job starts; a lock
    // swapped before that rename would be overwritten by it.
    await waitFor(() => readlinkSync(lock).split(' ')[1] === String(readPid(sandbox, 'job-pid')));
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
    warmExecutables([writeExecutable(join(sandbox.root, 'bin/make'), BLOCKING_MAKE_STUB)]);
    sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
    const worktree = createWorktree(sandbox, 'one');
    const foreign = startForeignGroup(sandbox);

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(() => readLines(join(sandbox.root, 'job-pid')).length === 1);
    const jobPid = Number(readFileSync(join(sandbox.root, 'job-pid'), 'utf8'));
    // The queue names the job group in the record after the job starts; a lock swapped before
    // that rename would be overwritten by it.
    await waitFor(() => readlinkSync(join(sandbox.queue, 'lock')).split(' ')[1] === String(jobPid));
    rmSync(join(sandbox.queue, 'lock'));
    holdLock(sandbox, `${waiter.child.pid} ${foreign} verify one ${worktree}`);
    waiter.child.kill(signal);
    const result = await waiter.finished;

    expect(result.code).toBe(exitCode);
    expect(processIsAlive(jobPid)).toBe(false);
    expect(processIsAlive(foreign)).toBe(true);
  });

  it(`stops the job and keeps no lock when ${signal} arrives before the queue knows the job's pid`, async () => {
    const sandbox = createSandbox();
    warmExecutables([
      writeExecutable(join(sandbox.root, 'bin/make'), BLOCKING_MAKE_STUB),
      writeExecutable(join(sandbox.root, 'bin/fork-hook'), FORK_HOOK_STUB),
    ]);
    sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
    sandbox.environment.KIKO_STUB_HOOK_SIGNAL = signal;
    sandbox.environment.KIKO_QUEUE_FORK_HOOK = join(sandbox.root, 'bin/fork-hook');
    const worktree = createWorktree(sandbox, 'one');

    const result = await startQueue(sandbox, 'verify', worktree, 'one').finished;

    expect(result.code).toBe(exitCode);
    expect(processIsAlive(readPid(sandbox, 'job-pid'))).toBe(false);
    expect(lockPresent(sandbox)).toBe(false);
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
    expect(existsSync(join(sandbox.queue, 'done.log'))).toBe(false);
  });

  it(`sends no group signal on ${signal} when pgrep cannot tell, and keeps the lock`, async () => {
    const sandbox = createSandbox();
    useChain(sandbox);
    warmExecutables([
      writeExecutable(join(sandbox.root, 'bin/pgrep'), '#!/usr/bin/env bash\nexit 2\n'),
    ]);
    sandbox.environment.KIKO_QUEUE_STOP_POLLS = '3';
    const worktree = createWorktree(sandbox, 'one');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    const { jobPid, leafPid } = await waitForChain(sandbox);
    await waitFor(() => readlinkSync(join(sandbox.queue, 'lock')).split(' ')[1] === String(jobPid));
    waiter.child.kill(signal);
    await waitFor(() => waiter.child.exitCode !== null);

    expect(waiter.child.exitCode).toBe(exitCode);
    expect(readLines(join(sandbox.root, 'leaf-log'))).toEqual([]);
    expect(processIsAlive(leafPid)).toBe(true);
    expect(readlinkSync(join(sandbox.queue, 'lock'))).toBe(
      `${waiter.child.pid} ${jobPid} verify one ${worktree}`,
    );
    writeFileSync(join(sandbox.root, 'release'), '');
    process.kill(leafPid, 'SIGKILL');
    await waitFor(() => !processIsAlive(leafPid));
  });
});

// Passes through to the real mv. After the first rename of a `lock.*` file (the queue recording
// its job group) it blocks until the test creates the release file, as a slow rename would; the
// bounded poll (80 s, past the test's own 60 s wait) ends it on its own so a failing run cannot
// hang.
const BLOCKING_MV_STUB = [
  '#!/usr/bin/env bash',
  '/bin/mv "$@" || exit $?',
  'armed=0',
  'for argument in "$@"; do',
  `  case "\${argument##*/}" in lock.*) armed=1 ;; esac`,
  'done',
  '[ "$armed" = 1 ] || exit 0',
  '[ -n "$KIKO_STUB_MV_ARMED" ] || exit 0',
  'mkdir "$KIKO_STUB_MV_ARMED.once" 2> /dev/null || exit 0',
  'for ((poll = 0; poll < 4000; poll += 1)); do',
  '  [ ! -e "$KIKO_STUB_MV_RELEASE" ] || exit 0',
  '  sleep 0.02',
  'done',
  '',
].join('\n');

describe('scripts/job-queue.sh on SIGINT during the lock record rename', () => {
  it('exits 130 without waiting for the rename that records the job group to return', async () => {
    const sandbox = createSandbox();
    warmExecutables([
      writeExecutable(join(sandbox.root, 'bin/make'), BLOCKING_MAKE_STUB),
      writeExecutable(join(sandbox.root, 'bin/mv'), BLOCKING_MV_STUB),
    ]);
    sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
    sandbox.environment.KIKO_STUB_MV_ARMED = join(sandbox.root, 'mv-armed');
    sandbox.environment.KIKO_STUB_MV_RELEASE = join(sandbox.root, 'release');
    const worktree = createWorktree(sandbox, 'one');
    const release = (): void => writeFileSync(join(sandbox.root, 'release'), '');

    try {
      const waiter = startQueue(sandbox, 'verify', worktree, 'one');
      await waitFor(() => readLines(join(sandbox.root, 'job-pid')).length === 1);
      const jobPid = readPid(sandbox, 'job-pid');
      await waitFor(
        () => readlinkSync(join(sandbox.queue, 'lock')).split(' ')[1] === String(jobPid),
      );
      waiter.child.kill('SIGINT');
      const exitedBeforeRelease = await waitFor(() => waiter.child.exitCode !== null).then(
        () => true,
        () => false,
      );

      expect(exitedBeforeRelease).toBe(true);
      expect(waiter.child.exitCode).toBe(130);
      expect(processIsAlive(jobPid)).toBe(false);
    } finally {
      release();
    }
  });
});

// Blocks BEFORE the real mv, on the first rename of a `lock.*` file (the queue recording its job
// group): it writes its pid to the armed file, then waits for the release file, as a rename
// that is still in flight when the queue is interrupted. The bounded poll (80 s) ends it on its
// own so a failing run cannot hang.
const PRE_RENAME_BLOCKING_MV_STUB = [
  '#!/usr/bin/env bash',
  'armed=0',
  'for argument in "$@"; do',
  `  case "\${argument##*/}" in lock.*) armed=1 ;; esac`,
  'done',
  '[ "$armed" = 1 ] || exec /bin/mv "$@"',
  '[ -n "$KIKO_STUB_MV_ARMED" ] || exec /bin/mv "$@"',
  'mkdir "$KIKO_STUB_MV_ARMED.once" 2> /dev/null || exec /bin/mv "$@"',
  'echo $$ > "$KIKO_STUB_MV_ARMED"',
  'for ((poll = 0; poll < 4000; poll += 1)); do',
  '  [ ! -e "$KIKO_STUB_MV_RELEASE" ] || break',
  '  sleep 0.02',
  'done',
  'exec /bin/mv "$@"',
  '',
].join('\n');

describe('scripts/job-queue.sh on SIGINT before the lock record rename lands', () => {
  it('leaves no lock behind when the rename that records the job group lands after the exit', async () => {
    const sandbox = createSandbox();
    warmExecutables([
      writeExecutable(join(sandbox.root, 'bin/make'), BLOCKING_MAKE_STUB),
      writeExecutable(join(sandbox.root, 'bin/mv'), PRE_RENAME_BLOCKING_MV_STUB),
    ]);
    sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
    sandbox.environment.KIKO_STUB_MV_ARMED = join(sandbox.root, 'mv-armed');
    sandbox.environment.KIKO_STUB_MV_RELEASE = join(sandbox.root, 'release');
    const worktree = createWorktree(sandbox, 'one');
    const release = (): void => writeFileSync(join(sandbox.root, 'release'), '');

    try {
      const waiter = startQueue(sandbox, 'verify', worktree, 'one');
      await waitFor(() => readLines(join(sandbox.root, 'mv-armed')).length === 1);
      const renamePid = readPid(sandbox, 'mv-armed');
      waiter.child.kill('SIGINT');
      await waitFor(() => waiter.child.exitCode !== null);
      release();
      await waitFor(() => !processIsAlive(renamePid));

      expect(waiter.child.exitCode).toBe(130);
      expect(lockPresent(sandbox)).toBe(false);
      expect(entriesOf(sandbox.queue).filter((entry) => entry.startsWith('lock'))).toEqual([]);
    } finally {
      release();
    }
  });
});

// The blocking rename, but it leaves a marker file when it is terminated, so a job can tell
// whether the in-flight command was ended before the job itself was.
const MARKING_PRE_RENAME_MV_STUB = PRE_RENAME_BLOCKING_MV_STUB.replace(
  '#!/usr/bin/env bash\n',
  '#!/usr/bin/env bash\ntrap \'echo ended > "$KIKO_STUB_MV_TERMINATED"; exit 143\' TERM\n',
);

// On TERM the job records whether the marker already exists, then ends its own sleep and exits.
const ORDER_RECORDING_MAKE_STUB = [
  '#!/usr/bin/env bash',
  '[ -n "$KIKO_STUB_PID" ] || exit 0',
  'echo $$ > "$KIKO_STUB_PID"',
  `trap 'if [ -e "$KIKO_STUB_MV_TERMINATED" ]; then echo in-flight-first > "$KIKO_STUB_ORDER"; else echo job-first > "$KIKO_STUB_ORDER"; fi; kill "$sleeper"; exit 0' TERM`,
  'sleep 60 &',
  'sleeper=$!',
  'wait "$sleeper"',
  '',
].join('\n');

describe('scripts/job-queue.sh stop order on a signal', () => {
  it('ends the in-flight record command before it terminates the job group', async () => {
    const sandbox = createSandbox();
    warmExecutables([
      writeExecutable(join(sandbox.root, 'bin/make'), ORDER_RECORDING_MAKE_STUB),
      writeExecutable(join(sandbox.root, 'bin/mv'), MARKING_PRE_RENAME_MV_STUB),
    ]);
    sandbox.environment.KIKO_STUB_PID = join(sandbox.root, 'job-pid');
    sandbox.environment.KIKO_STUB_MV_ARMED = join(sandbox.root, 'mv-armed');
    sandbox.environment.KIKO_STUB_MV_RELEASE = join(sandbox.root, 'release');
    sandbox.environment.KIKO_STUB_MV_TERMINATED = join(sandbox.root, 'mv-terminated');
    sandbox.environment.KIKO_STUB_ORDER = join(sandbox.root, 'order');
    const worktree = createWorktree(sandbox, 'one');
    const release = (): void => writeFileSync(join(sandbox.root, 'release'), '');

    try {
      const waiter = startQueue(sandbox, 'verify', worktree, 'one');
      await waitFor(() => readLines(join(sandbox.root, 'mv-armed')).length === 1);
      waiter.child.kill('SIGINT');
      await waitFor(() => waiter.child.exitCode !== null);

      expect(readLines(join(sandbox.root, 'order'))).toEqual(['in-flight-first']);
    } finally {
      release();
    }
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
    warmExecutables([writeExecutable(join(sandbox.root, 'bin/make'), LEAKING_MAKE_STUB)]);
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

const ISO_STAMP = '\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ';

const lostLines = (sandbox: Sandbox): string[] =>
  readLines(join(sandbox.queue, 'done.log')).filter((line) => line.split(' ')[0] === 'lost');

const lockLostLines = (sandbox: Sandbox): string[] =>
  readLines(join(sandbox.queue, 'done.log')).filter((line) => line.split(' ')[2] === 'lost');

// The prune reads a ticket's waiter pid through `cut -f4`. This stub holds each waiter there, on
// the dead ticket only, until both waiters have arrived, so both certainly see the ticket still
// present and reach the removal together: only an atomic removal then writes one LOST line. The
// bounded poll (80 s) ends it on its own so a failing run cannot hang.
const PRUNE_BARRIER_CUT_STUB = [
  '#!/usr/bin/env bash',
  '[ -n "$KIKO_STUB_CUT_ARRIVALS" ] || exec /usr/bin/cut "$@"',
  'input="$(cat)"',
  `case "$input" in *-ghost) ;; *) printf '%s\\n' "$input" | /usr/bin/cut "$@"; exit $? ;; esac`,
  `case "$*" in *-f4*) ;; *) printf '%s\\n' "$input" | /usr/bin/cut "$@"; exit $? ;; esac`,
  'mkdir -p "$KIKO_STUB_CUT_ARRIVALS"',
  ': > "$KIKO_STUB_CUT_ARRIVALS/$PPID"',
  'for ((poll = 0; poll < 4000; poll += 1)); do',
  '  arrivals=("$KIKO_STUB_CUT_ARRIVALS"/*)',
  '  [ "${#arrivals[@]}" -lt 2 ] || break',
  '  sleep 0.02',
  'done',
  `printf '%s\\n' "$input" | /usr/bin/cut "$@"`,
  '',
].join('\n');

describe('scripts/job-queue.sh LOST lines', () => {
  it('writes one done.log line for a ticket whose waiter is dead, queued time from its epoch', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const waiterPid = deadPid();
    mkdirSync(join(sandbox.queue, 'tickets'), { recursive: true });
    writeFileSync(join(sandbox.queue, 'tickets', `1-0000000000-1700000000-${waiterPid}-ghost`), '');

    const result = await startQueue(sandbox, 'verify', worktree, 'one').finished;

    expect(result.code).toBe(0);
    const lines = lostLines(sandbox);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      new RegExp(`^lost ghost ${waiterPid} 2023-11-14T22:13:20Z ${ISO_STAMP} unknown$`),
    );
  });

  it('writes the line once when two waiters prune the same dead ticket', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const waiterPid = deadPid();
    const ticket = join(sandbox.queue, 'tickets', `1-0000000000-1700000000-${waiterPid}-ghost`);
    mkdirSync(join(sandbox.queue, 'tickets'), { recursive: true });
    writeFileSync(ticket, '');
    warmExecutables([writeExecutable(join(sandbox.root, 'bin/cut'), PRUNE_BARRIER_CUT_STUB)]);
    sandbox.environment.KIKO_STUB_CUT_ARRIVALS = join(sandbox.root, 'prune-arrivals');
    // A lock held by a live pid keeps both waiters polling (and pruning) without either starting
    // a job.
    holdLock(sandbox);

    startQueue(sandbox, 'verify', worktree, 'one');
    startQueue(sandbox, 'verify', worktree, 'two');
    await waitFor(() => !isPresent(ticket));
    await waitForPasses(sandbox, 6);

    expect(entriesOf(join(sandbox.root, 'prune-arrivals'))).toHaveLength(2);
    expect(lostLines(sandbox)).toHaveLength(1);
  });

  it('writes one line from the owner record for a reclaimed dead lock', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    holdLock(sandbox, `${deadPid()} - gate ghost /elsewhere`);

    const result = await startQueue(sandbox, 'verify', worktree, 'one').finished;

    expect(result.code).toBe(0);
    const lines = lockLostLines(sandbox);
    expect(lines).toHaveLength(1);
    const [kind, label, outcome, start, end, head] = lines[0].split(' ');
    expect([kind, label, outcome, head]).toEqual(['gate', 'ghost', 'lost', 'unknown']);
    expect(start).toMatch(new RegExp(`^${ISO_STAMP}$`));
    expect(end).toBe(start);
  });
});

describe('scripts/job-queue.sh old copy', () => {
  it('exits 2 naming an older copy when the queue directory format is newer than the script', () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    mkdirSync(sandbox.queue, { recursive: true });
    writeFileSync(join(sandbox.queue, 'format'), '9999\n');

    const result = runQueue(sandbox, 'verify', worktree, 'one');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('an older job-queue.sh copy');
    expect(readLines(sandbox.environment.KIKO_STUB_CALLS as string)).toEqual([]);
    expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
  });

  it('warns once on stderr and still runs the job when the worktree holds a different copy', () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    mkdirSync(join(worktree, 'scripts'));
    writeFileSync(join(worktree, 'scripts/job-queue.sh'), '#!/usr/bin/env bash\n# a newer copy\n');

    const result = runQueue(sandbox, 'verify', worktree, 'one');

    expect(result.status).toBe(0);
    expect(result.stderr.split('\n').filter((line) => line.includes('WARNING'))).toHaveLength(1);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
  });

  it('prints no warning when the worktree holds the same copy', () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    mkdirSync(join(worktree, 'scripts'));
    writeFileSync(join(worktree, 'scripts/job-queue.sh'), readFileSync(SCRIPT));

    const result = runQueue(sandbox, 'verify', worktree, 'one');

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('WARNING');
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

  // The power check runs after the hold-file check and before the lock is taken, so a hold placed
  // inside it lands in the gap a start must still back off from.
  it('starts no job when a hold lands between its hold check and its lock', async () => {
    const sandbox = createSandbox();
    const worktree = createWorktree(sandbox, 'one');
    const holdingPmset = writeExecutable(
      join(sandbox.root, 'bin/holding-pmset'),
      [
        '#!/usr/bin/env bash',
        '[ -e "$KIKO_STUB_HOLD_MARKER" ] || {',
        '  : > "$KIKO_STUB_HOLD_MARKER"',
        '  bash "$KIKO_STUB_QUEUE_SCRIPT" hold race > /dev/null',
        '}',
        'cat "$KIKO_STUB_POWER"',
        '',
      ].join('\n'),
    );
    warmExecutables([holdingPmset]);
    sandbox.environment.KIKO_QUEUE_PMSET = holdingPmset;
    sandbox.environment.KIKO_STUB_QUEUE_SCRIPT = SCRIPT;
    sandbox.environment.KIKO_STUB_HOLD_MARKER = join(sandbox.root, 'hold-placed');

    const waiter = startQueue(sandbox, 'verify', worktree, 'one');
    await waitFor(
      () => waiter.stdout().includes('WAITING one: hold (race)') || hasExited(waiter.child),
    );

    expect(waiter.stdout()).toContain('WAITING one: hold (race)');
    expect(startedWorktrees(sandbox)).toEqual([]);
    runQueue(sandbox, 'release');
    const result = await waiter.finished;
    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([worktree]);
  });

  it('status shows a job that takes the lock while the ticket list is being read', () => {
    const sandbox = createSandbox();
    const record = `${process.pid} - verify other /elsewhere`;
    const stubBin = join(sandbox.root, 'ls-bin');
    mkdirSync(stubBin);
    mkdirSync(sandbox.queue, { recursive: true });
    warmExecutables([
      writeExecutable(
        join(stubBin, 'ls'),
        [
          '#!/usr/bin/env bash',
          'ln -s "$KIKO_STUB_LOCK_RECORD" "$KIKO_QUEUE_DIR/lock" 2> /dev/null',
          'exec /bin/ls "$@"',
          '',
        ].join('\n'),
      ),
    ]);
    sandbox.environment.PATH = `${stubBin}:${sandbox.environment.PATH}`;
    sandbox.environment.KIKO_STUB_LOCK_RECORD = record;

    const result = runQueue(sandbox, 'status');

    expect(result.stdout).toContain(`running: ${record}`);
    expect(result.stdout).not.toContain('queue empty');
  });

  it('hold names the running job and says the hold does not stop it', () => {
    const sandbox = createSandbox();
    const record = `${process.pid} 4242 gate other-label /elsewhere`;
    holdLock(sandbox, record);

    const result = runQueue(sandbox, 'hold', 'busy');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`running: ${record} (a hold does not stop a running job)`);
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
    warmExecutables([
      writeExecutable(
        join(sandbox.root, 'bin/pmset'),
        '#!/usr/bin/env bash\nprintf "pmset %s\\n" "$*" >> "$KIKO_STUB_CALLS"\ncat "$KIKO_STUB_POWER"\n',
      ),
    ]);

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

  // A pmset that is present but silent, failing, or printing a first line that names no known power
  // source says nothing about the power source, so the queue holds instead of reading AC.
  it.each([
    ['prints nothing', '', false],
    ['exits non-zero', AC_POWER, true],
    ['prints an unknown power source first', "Now drawing from 'UPS Power'\n", false],
    ['prints a warning line first', `WARNING: sensor stale\n${AC_POWER}`, false],
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

// A gate at the head of the queue waits while the 5-minute load is at or above its start limit
// (10), for at most KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS (1200 s in production), then starts anyway.
// Only a gate defers: a gate's first mutants time out on drift between its dry run and its run.
describe('scripts/job-queue.sh gate start load defer', () => {
  const stubLoad = (sandbox: Sandbox, high: string, highCalls: number): void => {
    writeSysctlStub(join(sandbox.root, 'bin'), high, LOW_LOAD, highCalls);
    warmExecutables([join(sandbox.root, 'bin/sysctl')]);
  };

  // The poll sleep is a child of the waiter. A signal sent once it exists lands in the wait
  // builtin, not in the gap between the fork of the sleep and the record of its pid, where the
  // sleep would outlive the queue and hold the output pipe open.
  const sleepsBetweenPolls = (waiter: Waiter): boolean =>
    spawnSync('pgrep', ['-P', String(waiter.child.pid), '-x', 'sleep']).status === 0;

  const orderOf = (text: string, ...markers: RegExp[]): number[] =>
    markers.map((marker) => text.search(marker));

  it('waits at the head while the load is high, then starts once it drops', async () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    stubLoad(sandbox, HIGH_LOAD, 3);

    const waiter = startQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);
    await waitFor(
      () => waiter.stdout().includes('WAITING gate: load') || waiter.child.exitCode !== null,
    );
    const result = await waiter.finished;

    expect(result.stdout).toMatch(/^WAITING gate: load\b/m);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('LOAD WAIT EXPIRED');
    const [waiting, start] = orderOf(result.stdout, /^WAITING gate: load/m, /^START gate /m);
    expect(waiting).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(waiting);
    expect(startedWorktrees(sandbox)).toEqual([gate.worktree]);
  });

  it('starts anyway after the wait limit, printing LOAD WAIT EXPIRED before START', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    stubLoad(sandbox, HIGH_LOAD, 9999);
    sandbox.environment.KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS = '1';

    const result = runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^LOAD WAIT EXPIRED gate: load 12\.25$/m);
    const [waiting, expired, start] = orderOf(
      result.stdout,
      /^WAITING gate: load/m,
      /^LOAD WAIT EXPIRED gate: /m,
      /^START gate /m,
    );
    expect(waiting).toBeGreaterThanOrEqual(0);
    expect(expired).toBeGreaterThan(waiting);
    expect(start).toBeGreaterThan(expired);
    expect(startedWorktrees(sandbox)).toEqual([gate.worktree]);
  });

  describe.each(['verify', 'check-all', 'security'] as const)('a queued %s job', (jobClass) => {
    it('waits at the head while the load is high, then starts with the load on its START line', async () => {
      const sandbox = createSandbox();
      const worktree = createWorktree(sandbox, 'one');
      stubLoad(sandbox, HIGH_LOAD, 3);

      const waiter = startQueue(sandbox, jobClass, worktree, 'one');
      await waitFor(
        () => waiter.stdout().includes('WAITING one: load') || waiter.child.exitCode !== null,
      );
      const result = await waiter.finished;

      expect(result.stdout).toMatch(/^WAITING one: load at or above 10 \(waits at most 1200 s\)$/m);
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain('LOAD WAIT EXPIRED');
      const [waiting, start] = orderOf(result.stdout, /^WAITING one: load/m, /^START one /m);
      expect(waiting).toBeGreaterThanOrEqual(0);
      expect(start).toBeGreaterThan(waiting);
      expect(result.stdout).toMatch(
        /^START one at \d\d:\d\d head (?:[0-9a-f]{12}|unknown) \(load: 1\.50 2\.50 3\.50\)$/m,
      );
      expect(startedWorktrees(sandbox)).toEqual([worktree]);
    });

    it('starts anyway after the wait limit, printing LOAD WAIT EXPIRED before START', () => {
      const sandbox = createSandbox();
      const worktree = createWorktree(sandbox, 'one');
      stubLoad(sandbox, HIGH_LOAD, 9999);
      sandbox.environment.KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS = '1';

      const result = runQueue(sandbox, jobClass, worktree, 'one');

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^LOAD WAIT EXPIRED one: load 12\.25$/m);
      const [waiting, expired, start] = orderOf(
        result.stdout,
        /^WAITING one: load/m,
        /^LOAD WAIT EXPIRED one: /m,
        /^START one /m,
      );
      expect(waiting).toBeGreaterThanOrEqual(0);
      expect(expired).toBeGreaterThan(waiting);
      expect(start).toBeGreaterThan(expired);
      expect(startedWorktrees(sandbox)).toEqual([worktree]);
    });
  });

  it('prints one "load unknown" line and does not defer when the load cannot be read', async () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    stubLoad(sandbox, 'garbage', 9999);
    const lock = holdLock(sandbox);

    const waiter = startQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);
    await waitFor(() => waiter.stdout().includes('load unknown') || powerChecks(sandbox) >= 5);
    await waitForPasses(sandbox);
    rmSync(lock, { recursive: true });
    const result = await waiter.finished;

    expect(result.stdout.split('\n').filter((line) => line.includes('load unknown'))).toHaveLength(
      1,
    );
    expect(result.stdout).not.toMatch(/^WAITING /m);
    expect(result.code).toBe(0);
    expect(startedWorktrees(sandbox)).toEqual([gate.worktree]);
  });

  it('keeps the hold reason while the queue is held and reads no load, then defers after release', async () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    stubLoad(sandbox, HIGH_LOAD, 9999);
    sandbox.environment.KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS = '1';
    runQueue(sandbox, 'hold', 'maintenance');

    const waiter = startQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);
    await waitFor(() => waiter.stdout().includes('WAITING gate: hold (maintenance)'));

    expect(waiter.stdout()).not.toMatch(/^WAITING gate: load/m);
    expect(sysctlCallCount(join(sandbox.root, 'bin'))).toBe(0);
    runQueue(sandbox, 'release');
    const result = await waiter.finished;

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^WAITING gate: load\b/m);
    expect(result.stdout).toMatch(/^LOAD WAIT EXPIRED gate: load 12\.25$/m);
  });

  it('keeps the battery reason while on battery and reads no load, then defers on AC power', async () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    stubLoad(sandbox, HIGH_LOAD, 9999);
    sandbox.environment.KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS = '1';
    writeFileSync(sandbox.environment.KIKO_STUB_POWER as string, BATTERY_POWER);

    const waiter = startQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);
    await waitFor(() => waiter.stdout().includes('WAITING gate: battery power'));
    await waitForPasses(sandbox);

    expect(waiter.stdout()).not.toMatch(/^WAITING gate: load/m);
    expect(sysctlCallCount(join(sandbox.root, 'bin'))).toBe(0);
    writeFileSync(sandbox.environment.KIKO_STUB_POWER as string, AC_POWER);
    const result = await waiter.finished;

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^LOAD WAIT EXPIRED gate: load 12\.25$/m);
  });

  // A reset clock prints a fresh load WAITING line after the release; a clock that kept running
  // through the hold or battery pause expires at once, with no such line.
  it.each([
    [
      'a hold',
      (sandbox: Sandbox) => runQueue(sandbox, 'hold', 'maintenance'),
      (sandbox: Sandbox) => runQueue(sandbox, 'release'),
    ],
    [
      'battery power',
      (sandbox: Sandbox) =>
        writeFileSync(sandbox.environment.KIKO_STUB_POWER as string, BATTERY_POWER),
      (sandbox: Sandbox) => writeFileSync(sandbox.environment.KIKO_STUB_POWER as string, AC_POWER),
    ],
  ])(
    'gives the gate its full load wait again after %s that outlasted the limit',
    async (_name, engage, release) => {
      const sandbox = createSandbox();
      const gate = createGateWorktree(sandbox, 'gate', listing(12));
      stubLoad(sandbox, HIGH_LOAD, 9999);
      sandbox.environment.KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS = '1';
      // A hold reads no power state, so the poll sleep itself is the pass counter here.
      const sleepLog = join(sandbox.root, 'sleeps');
      sandbox.environment.KIKO_STUB_SLEEP_LOG = sleepLog;
      warmExecutables([
        writeExecutable(
          join(sandbox.root, 'bin', 'sleep'),
          [
            '#!/usr/bin/env bash',
            'printf "sleep\\n" >> "$KIKO_STUB_SLEEP_LOG"',
            'exec /bin/sleep "$@"',
            '',
          ].join('\n'),
        ),
      ]);

      const waiter = startQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);
      await waitFor(() => waiter.stdout().includes('WAITING gate: load'));
      engage(sandbox);
      await waitFor(() => /^WAITING gate: (hold|battery)/m.test(waiter.stdout()));
      const outlastingPasses = readLines(sleepLog).length + 20;
      await waitFor(() => readLines(sleepLog).length >= outlastingPasses);
      expect(waiter.stdout()).not.toContain('LOAD WAIT EXPIRED');
      release(sandbox);
      const result = await waiter.finished;
      const lines = result.stdout.split('\n');
      const pausedAt = lines.findIndex((line) => /^WAITING gate: (hold|battery)/.test(line));
      const afterPause = lines.slice(pausedAt + 1);
      const loadWaitingAgainAt = afterPause.findIndex((line) =>
        line.startsWith('WAITING gate: load'),
      );
      const expiredAt = afterPause.indexOf('LOAD WAIT EXPIRED gate: load 12.25');

      expect(result.code).toBe(0);
      expect(loadWaitingAgainAt).toBeGreaterThanOrEqual(0);
      expect(expiredAt).toBeGreaterThan(loadWaitingAgainAt);
    },
  );

  it('starts the wait only when the lock is free, never while a running job holds it', async () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(12));
    stubLoad(sandbox, HIGH_LOAD, 9999);
    sandbox.environment.KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS = '1';
    const lock = holdLock(sandbox);

    const waiter = startQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);
    await waitForPasses(sandbox, 20);

    expect(waiter.stdout()).not.toMatch(/^(WAITING|LOAD WAIT EXPIRED) /m);
    rmSync(lock, { recursive: true });
    const result = await waiter.finished;

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^WAITING gate: load\b/m);
    expect(result.stdout).toMatch(/^LOAD WAIT EXPIRED gate: load 12\.25$/m);
  });

  it.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
  ] as const)(
    'exits %s promptly from the load wait and removes its ticket',
    async (signal, code) => {
      const sandbox = createSandbox();
      sandbox.environment.KIKO_QUEUE_POLL_SECONDS = LONG_POLL_SECONDS;
      const gate = createGateWorktree(sandbox, 'gate', listing(12));
      stubLoad(sandbox, HIGH_LOAD, 9999);

      const waiter = startQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head);
      await waitFor(
        () => waiter.stdout().includes('WAITING gate: load') && sleepsBetweenPolls(waiter),
      );
      waiter.child.kill(signal);
      const result = await waiter.finished;

      expect(result.code).toBe(code);
      expect(entriesOf(join(sandbox.queue, 'tickets'))).toEqual([]);
      expect(lockPresent(sandbox)).toBe(false);
      expect(startedWorktrees(sandbox)).toEqual([]);
    },
  );
});

// A `make` stub that commits inside the worktree it was given (`make -C <dir> verify`).
const COMMITTING_MAKE_STUB = [
  '#!/usr/bin/env bash',
  'git -C "$2" -c user.name=Test -c user.email=test@example.com commit -q --allow-empty -m mid-run',
  '',
].join('\n');

// A `make` stub that changes the tree it was given (`make -C <dir> verify`) without committing,
// then passes.
const dirtyingMakeStub = (change: string): string =>
  ['#!/usr/bin/env bash', `cd "$2" && ${change}`, ''].join('\n');

const installMake = (sandbox: Sandbox, body: string): void => {
  writeExecutable(join(sandbox.root, 'bin/make'), body);
};

// `git status` follows this setting unless the queue asks for untracked files by name.
const hideUntrackedFiles = (worktree: string): void => {
  execFileSync('git', ['config', 'status.showUntrackedFiles', 'no'], { cwd: worktree });
};

const finishedLine = (sandbox: Sandbox): string =>
  readLines(join(sandbox.queue, 'done.log'))[0] as string;

describe('scripts/job-queue.sh done.log tested HEAD', () => {
  // The 6th field names the commit a job ran on only while the tree was clean at START and at the
  // end and HEAD had not moved: a dirty tree or a moved HEAD is not "verify at that sha".
  it.each([
    ['a clean tree', () => undefined, true],
    [
      'a tracked edit',
      (worktree: string) => writeFile(worktree, 'scripts/checks/mutation.sh', '# edited\n'),
      false,
    ],
    ['an untracked file', (worktree: string) => writeFile(worktree, 'new.txt', 'new\n'), false],
    [
      'a commit made by the job itself',
      (_worktree: string, sandbox: Sandbox) => installMake(sandbox, COMMITTING_MAKE_STUB),
      false,
    ],
    [
      'a tracked edit made by the job itself, never committed',
      (_worktree: string, sandbox: Sandbox) =>
        installMake(sandbox, dirtyingMakeStub('echo "# edited" >> scripts/checks/mutation.sh')),
      false,
    ],
    [
      'an untracked file made by the job itself',
      (_worktree: string, sandbox: Sandbox) =>
        installMake(sandbox, dirtyingMakeStub('echo new > made-by-job.txt')),
      false,
    ],
    [
      'an untracked file under status.showUntrackedFiles=no',
      (worktree: string) => {
        hideUntrackedFiles(worktree);
        writeFile(worktree, 'new.txt', 'new\n');
      },
      false,
    ],
    [
      'an untracked file made by the job itself under status.showUntrackedFiles=no',
      (worktree: string, sandbox: Sandbox) => {
        hideUntrackedFiles(worktree);
        installMake(sandbox, dirtyingMakeStub('echo new > made-by-job.txt'));
      },
      false,
    ],
  ])('verify on %s writes the 6th field', (_title, prepare, namesHead) => {
    const sandbox = createSandbox();
    const { worktree, head } = createGateWorktree(sandbox, 'one', listing(1));
    prepare(worktree, sandbox);

    runQueue(sandbox, 'verify', worktree, 'one');

    expect(finishedLine(sandbox).split(' ')[5]).toBe(namesHead ? head : 'unknown');
  });

  it('reads the tree status at START and at the end without taking the index lock', () => {
    const sandbox = createSandbox();
    const { worktree } = createGateWorktree(sandbox, 'one', listing(1));
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const calls = join(sandbox.root, 'git-calls');
    // The paths travel in the environment so the warm-up run, which has none, appends nothing
    // and execs nothing.
    sandbox.environment.KIKO_STUB_GIT_CALLS = calls;
    sandbox.environment.KIKO_STUB_REAL_GIT = realGit;
    warmExecutables([
      writeExecutable(
        join(sandbox.root, 'bin/git'),
        [
          '#!/usr/bin/env bash',
          'printf \'%s\\n\' "$*" >> "$KIKO_STUB_GIT_CALLS"',
          'exec "$KIKO_STUB_REAL_GIT" "$@"',
          '',
        ].join('\n'),
      ),
    ]);

    runQueue(sandbox, 'verify', worktree, 'one');

    const statusCalls = readLines(calls).filter((call) => call.includes(' status'));
    expect(statusCalls).toHaveLength(2);
    expect(statusCalls.every((call) => call.startsWith('--no-optional-locks '))).toBe(true);
  });

  it('writes the 40-character HEAD of a gate', () => {
    const sandbox = createSandbox();
    const gate = createGateWorktree(sandbox, 'gate', listing(1));

    runQueue(sandbox, 'gate', gate.worktree, 'gate', 'main', gate.head.slice(0, 9));

    expect(finishedLine(sandbox).split(' ')[5]).toBe(gate.head);
  });

  it('writes unknown for a worktree that is not a git repository', () => {
    const sandbox = createSandbox();

    runQueue(sandbox, 'verify', createWorktree(sandbox, 'one'), 'one');

    expect(finishedLine(sandbox).split(' ')[5]).toBe('unknown');
  });

  it('keeps fields 1 to 5 in the shape of the 5-field line, and the START line as it was', () => {
    const sandbox = createSandbox();
    const { worktree } = createGateWorktree(sandbox, 'one', listing(1));
    sandbox.environment.KIKO_STUB_EXIT = '4';

    const result = runQueue(sandbox, 'verify', worktree, 'one');

    expect(finishedLine(sandbox).split(' ').slice(0, 5).join(' ')).toMatch(
      /^verify one 4 \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/,
    );
    expect(finishedLine(sandbox).split(' ')).toHaveLength(6);
    expect(result.stdout).toMatch(
      /^START one at \d\d:\d\d head [0-9a-f]{12} \(load: 1\.50 2\.50 3\.50\)$/m,
    );
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

  it('prints a WARNING for each done.log line with fewer than 6 fields', () => {
    const sandbox = createSandbox();
    mkdirSync(sandbox.queue, { recursive: true });
    const shortOld = 'verify old 0 2026-10-15T10:00:00Z 2026-10-15T10:05:00Z';
    const shortTorn = 'verify torn';
    const whole = `verify whole 0 2026-10-15T10:00:00Z 2026-10-15T10:05:00Z ${'a'.repeat(40)}`;
    writeFileSync(join(sandbox.queue, 'done.log'), `${shortOld}\n${whole}\n${shortTorn}\n`);

    const result = runQueue(sandbox, 'status');
    const warnings = `${result.stdout}\n${result.stderr}`
      .split('\n')
      .filter((line) => line.includes('WARNING'));

    expect(result.status).toBe(0);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain(shortOld);
    expect(warnings[1]).toContain(shortTorn);
  });

  describe('a done.log whose old 5-field block predates the head field', () => {
    const shortAt = (index: number) =>
      `verify old-${String(index).padStart(3, '0')} 0 2026-10-15T10:00:00Z 2026-10-15T10:05:00Z`;
    const whole = `verify whole 0 2026-10-15T10:00:00Z 2026-10-15T10:05:00Z ${'a'.repeat(40)}`;
    const warningsOf = (doneLog: string) => {
      const sandbox = createSandbox();
      mkdirSync(sandbox.queue, { recursive: true });
      writeFileSync(join(sandbox.queue, 'done.log'), doneLog);
      const result = runQueue(sandbox, 'status');

      return {
        status: result.status,
        warnings: `${result.stdout}\n${result.stderr}`
          .split('\n')
          .filter((line) => line.includes('WARNING')),
      };
    };
    const leading = Array.from({ length: 60 }, (_, index) => shortAt(index + 1));

    it('summarizes the short lines before the first 6-field line in one WARNING', () => {
      const lateOne = 'verify late-one 1 2026-10-16T22:33:18Z 2026-10-16T22:44:16Z';
      const lateTwo = 'verify torn';

      const { status, warnings } = warningsOf(
        `${[...leading, whole, lateOne, lateTwo].join('\n')}\n`,
      );

      expect(status).toBe(0);
      expect(warnings).toHaveLength(3);
      expect(warnings[0]).toContain('WARNING: 60 done.log');
      expect(warnings[0]).toContain(shortAt(60));
      expect(warnings[1]).toContain(lateOne);
      expect(warnings[1]).toContain('62');
      expect(warnings[2]).toContain(lateTwo);
      expect(warnings[2]).toContain('63');
    });

    it('gives a file of only short lines a single summary WARNING', () => {
      const { warnings } = warningsOf(
        `${Array.from({ length: 5 }, (_, index) => shortAt(index + 1)).join('\n')}\n`,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('WARNING: 5 done.log');
      expect(warnings[0]).toContain(shortAt(5));
    });
  });
});
