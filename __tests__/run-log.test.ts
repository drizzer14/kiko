import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// harness/kiko/scripts/run-log.mjs is the plugin's run log (start / event / finish / stats). It
// is a byte-identical port of the harness repo's plugin/scripts/run-log.mjs, so the CLI contract
// pinned here is the harness repo's own. Every test spawns the script as a child process with
// HARNESS_RUNS_DIR pointing at a temp dir, so nothing ever touches the real
// ~/.claude/harness-runs. Most run it with the cwd set to a throwaway local git repo (no remote
// unless a test adds one, no network); the stats and consumer-line tests use a plain temp dir.
// Stats fixtures are written straight into the runs dir so their timestamps can be old.
const SCRIPT = join(__dirname, '../harness/kiko/scripts/run-log.mjs');
const IDENTITY = [
  ...['-c', 'user.name=run-log test', '-c', 'user.email=run-log@example.com'],
  ...['-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false'],
];
const RUN_ID_PATTERN = '\\d{8}T\\d{4}';
// Each test spawns many node and git processes, which outlasts Jest's 5 s default on a busy host.
const TEST_TIMEOUT_MILLISECONDS = 120_000;

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface RunRecord {
  v: number;
  runId: string;
  repo: string;
  branch: string;
  baseSha: string | null;
  cwd: string;
  task: string;
  jira: string | null;
  shape: string;
  orca: { taskId: string | null; dispatchId: string | null } | null;
  startedAt: string;
}

interface EventLine {
  v: number;
  ts: string;
  phase: string | null;
  step: number | null;
  group: number | null;
  gate: string;
  role: string | null;
  attempt: number | null;
  verdict: string;
  findings: number | null;
  mechanizable: number | null;
  note: string | null;
  reason: string | null;
  minutes: number | null;
}

interface GapOpenLine {
  v: number;
  op: 'open';
  gap: string;
  repo: string;
  run: string;
  ts: string;
  text: string;
}

interface GapCloseLine {
  v: number;
  op: 'close';
  gap: string;
  run: string;
  ts: string;
  note: string | null;
}

interface Summary {
  v: number;
  runId: string;
  outcome: string;
  finishedAt: string;
  totals: {
    events: number;
    byGate: Record<string, Record<string, number>>;
    stalls: number;
    retries: number;
    waitMinutes: number;
  };
  retro: { recorded: number | null; gaps: number | null } | null;
}

interface Started {
  runs: string;
  repo: string;
  runId: string;
}

jest.setTimeout(TEST_TIMEOUT_MILLISECONDS);

const createdPaths: string[] = [];

afterAll(() => {
  for (const path of createdPaths) {
    rmSync(path, { recursive: true, force: true });
  }
});

// The environment without inherited GIT_* variables (a hook run would otherwise point git at
// another repository).
function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

function git(directory: string, ...args: string[]): string {
  return execFileSync('git', [...IDENTITY, ...args], {
    cwd: directory,
    env: cleanEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tempDirectory(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'kiko-run-log-')));
  createdPaths.push(directory);

  return directory;
}

// A git repo in a folder called `name`, on branch `branch`, with one commit; `remote` becomes
// origin.
function tempRepository(options: { name?: string; branch?: string; remote?: string } = {}): string {
  const { name = 'demo-repo', branch = 'main', remote } = options;
  const directory = join(tempDirectory(), name);
  mkdirSync(directory);
  git(directory, 'init', '-q', '-b', branch);

  if (remote) git(directory, 'remote', 'add', 'origin', remote);

  git(directory, 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'test commit');

  return directory;
}

function childEnvironment(runs: string): NodeJS.ProcessEnv {
  return { ...cleanEnvironment(), HARNESS_RUNS_DIR: runs };
}

function run(runs: string, cwd: string, ...args: string[]): CommandResult {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    env: childEnvironment(runs),
    encoding: 'utf8',
  });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function ok(result: CommandResult): CommandResult {
  if (result.status !== 0) {
    throw new Error(`exit ${result.status}: ${result.stderr}`);
  }

  return result;
}

// A loop over several bad invocations needs to say which one failed.
function expectStatus(result: CommandResult, status: number, label: string): void {
  expect({ label, status: result.status }).toEqual({ label, status });
}

function utcMinute(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').slice(0, 13);
}

function runIds(runs: string): string[] {
  return existsSync(runs) ? readdirSync(runs).filter((entry) => entry !== 'bin') : [];
}

function startRun(runs: string, cwd: string, ...extra: string[]): string {
  return ok(
    run(runs, cwd, 'start', '--task', 'demo task', '--shape', 'build', ...extra),
  ).stdout.trim();
}

function readJson<Shape>(path: string): Shape {
  return JSON.parse(readFileSync(path, 'utf8')) as Shape;
}

function readEvents(runs: string, runId: string): EventLine[] {
  return readFileSync(join(runs, runId, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as EventLine);
}

// The usual setup: a runs dir, a repo and a started run.
function started(...extra: string[]): Started {
  const runs = tempDirectory();
  const repo = tempRepository();

  return { runs, repo, runId: startRun(runs, repo, ...extra) };
}

function event(runs: string, repo: string, runId: string, ...args: string[]): CommandResult {
  return ok(run(runs, repo, 'event', '--run', runId, ...args));
}

describe('start', () => {
  test('prints only the runId, <UTC minute>-<repo>-<branch>, and creates run.json', () => {
    const runs = tempDirectory();
    const repo = tempRepository({ name: 'demo-repo', branch: 'feature-x' });
    const before = utcMinute(new Date());
    const result = ok(run(runs, repo, 'start', '--task', 'build the thing', '--shape', 'build'));
    const after = utcMinute(new Date());
    const runId = result.stdout.trim();

    expect(result.stdout).toBe(`${runId}\n`);

    const match = new RegExp(`^(${RUN_ID_PATTERN})-demo-repo-feature-x$`).exec(runId);

    expect(match).not.toBeNull();
    expect([before, after]).toContain(match?.[1]);
    expect(runIds(runs)).toEqual([runId]);
  });

  test('writes run.json with the v1 fields', () => {
    const runs = tempDirectory();
    const repo = tempRepository({ name: 'demo-repo', branch: 'feature-x' });
    const runId = startRun(runs, repo, '--jira', 'https://jira.example.com/browse/DS-1');
    const record = readJson<RunRecord>(join(runs, runId, 'run.json'));

    expect(Object.keys(record)).toEqual([
      ...['v', 'runId', 'repo', 'branch', 'baseSha', 'cwd'],
      ...['task', 'jira', 'shape', 'orca', 'startedAt'],
    ]);
    expect(record.v).toBe(1);
    expect(record.runId).toBe(runId);
    expect(record.repo).toBe('demo-repo');
    expect(record.branch).toBe('feature-x');
    expect(record.baseSha).toBe(git(repo, 'rev-parse', 'HEAD'));
    expect(record.cwd).toBe(repo);
    expect(record.task).toBe('demo task');
    expect(record.jira).toBe('https://jira.example.com/browse/DS-1');
    expect(record.shape).toBe('build');
    expect(record.orca).toBeNull();
    expect(new Date(record.startedAt).toISOString()).toBe(record.startedAt);
  });

  test('jira is null without --jira, and orca holds the ids it was given', () => {
    const runs = tempDirectory();
    const repo = tempRepository();
    const plain = readJson<RunRecord>(join(runs, startRun(runs, repo), 'run.json'));

    expect(plain.jira).toBeNull();
    expect(plain.orca).toBeNull();

    const both = readJson<RunRecord>(
      join(runs, startRun(runs, repo, '--orca-task', 't-1', '--orca-dispatch', 'd-1'), 'run.json'),
    );

    expect(both.orca).toEqual({ taskId: 't-1', dispatchId: 'd-1' });

    const onlyTask = readJson<RunRecord>(
      join(runs, startRun(runs, repo, '--orca-task', 't-2'), 'run.json'),
    );

    expect(onlyTask.orca).toEqual({ taskId: 't-2', dispatchId: null });
  });

  test('slugs the repo from the origin url (last segment, .git stripped) and the branch', () => {
    const runs = tempDirectory();
    const repo = tempRepository({
      name: 'folder-name',
      branch: 'Feature/ABC_1',
      remote: 'https://git.example.com/team/Some_Repo.git',
    });

    expect(startRun(runs, repo)).toMatch(new RegExp(`^${RUN_ID_PATTERN}-some-repo-feature-abc-1$`));
  });

  test('falls back to the git top-level folder name without a remote, from any subfolder', () => {
    const runs = tempDirectory();
    const repo = tempRepository({ name: 'My_Repo.Name' });
    mkdirSync(join(repo, 'sub'));

    expect(startRun(runs, join(repo, 'sub'))).toMatch(
      new RegExp(`^${RUN_ID_PATTERN}-my-repo-name-main$`),
    );
  });

  test('uses the cwd name and `detached` outside a git repo', () => {
    const runs = tempDirectory();
    const plain = join(tempDirectory(), 'Plain_Dir');
    mkdirSync(plain);
    const runId = startRun(runs, plain);

    expect(runId).toMatch(new RegExp(`^${RUN_ID_PATTERN}-plain-dir-detached$`));
    expect(readJson<RunRecord>(join(runs, runId, 'run.json')).cwd).toBe(plain);
  });

  test('uses `detached` for a detached HEAD', () => {
    const runs = tempDirectory();
    const repo = tempRepository({ name: 'demo-repo' });
    git(repo, 'checkout', '-q', '--detach');

    expect(startRun(runs, repo)).toMatch(new RegExp(`^${RUN_ID_PATTERN}-demo-repo-detached$`));
  });

  test('a taken id gets -2, -3, ...', () => {
    // Two starts only collide inside one UTC minute, so retry on the rare minute rollover.
    for (let attempt = 0; attempt < 3; attempt++) {
      const runs = tempDirectory();
      const repo = tempRepository();
      const ids = [startRun(runs, repo), startRun(runs, repo), startRun(runs, repo)];

      if (new Set(ids.map((id) => id.slice(0, 13))).size > 1) continue;

      expect(ids[1]).toBe(`${ids[0]}-2`);
      expect(ids[2]).toBe(`${ids[0]}-3`);
      expect(runIds(runs).sort()).toEqual([...ids].sort());

      return;
    }

    throw new Error('three attempts all crossed a UTC minute boundary');
  });

  test('a usage error exits 2 with usage on stderr and creates no run', () => {
    const runs = tempDirectory();
    const repo = tempRepository();
    const bad = [
      ['start', '--shape', 'build'],
      ['start', '--task', 'x'],
      ['start', '--task', 'x', '--shape', 'wrong'],
    ];

    for (const args of bad) {
      const result = run(runs, repo, ...args);
      expectStatus(result, 2, args.join(' '));
      expect(result.stderr.trim()).not.toBe('');
      expect(result.stdout).toBe('');
    }

    expect(runIds(runs)).toEqual([]);
  });

  test('accepts every shape', () => {
    const runs = tempDirectory();
    const repo = tempRepository();

    for (const shape of ['build', 'fix', 'research', 'review']) {
      const runId = ok(run(runs, repo, 'start', '--task', 'x', '--shape', shape)).stdout.trim();

      expect(readJson<RunRecord>(join(runs, runId, 'run.json')).shape).toBe(shape);
    }
  });
});

describe('command line', () => {
  test('no command and an unknown command exit 2 with usage on stderr', () => {
    const runs = tempDirectory();
    const repo = tempRepository();

    for (const args of [[], ['frobnicate']]) {
      const result = run(runs, repo, ...args);
      expectStatus(result, 2, args.join(' '));
      expect(result.stderr.trim()).not.toBe('');
    }
  });

  test('event and finish on an unknown run exit 1 and create nothing', () => {
    const runs = tempDirectory();
    const repo = tempRepository();

    expect(
      run(runs, repo, 'event', '--run', 'nope', '--gate', 'check', '--verdict', 'pass').status,
    ).toBe(1);
    expect(run(runs, repo, 'finish', '--run', 'nope', '--outcome', 'done').status).toBe(1);
    expect(runIds(runs)).toEqual([]);
  });

  test('--run cannot leave the runs dir or name a hidden folder', () => {
    const runs = tempDirectory();
    const repo = tempRepository();
    const outside = tempDirectory();
    writeFileSync(join(outside, 'run.json'), '{}');
    mkdirSync(join(runs, '.hidden'));
    writeFileSync(join(runs, '.hidden', 'run.json'), '{}');
    // A real run first, so `x/../..` is a path that normalizes out of the runs dir.
    mkdirSync(join(runs, 'x'));
    writeFileSync(join(runs, 'x', 'run.json'), '{}');

    for (const runId of [relative(runs, outside), `x/../${relative(runs, outside)}`, '.hidden']) {
      const result = run(
        runs,
        repo,
        ...['event', '--run', runId, '--gate', 'check', '--verdict', 'pass'],
      );
      expectStatus(result, 1, runId);
      expect(result.stderr).toMatch(/unknown run/);
    }

    expect(existsSync(join(outside, 'events.jsonl'))).toBe(false);
    expect(existsSync(join(runs, '.hidden', 'events.jsonl'))).toBe(false);
  });

  test('an empty HARNESS_RUNS_DIR falls back to <HOME>/.claude/harness-runs', () => {
    const home = tempDirectory();
    const environment = { ...cleanEnvironment(), HARNESS_RUNS_DIR: '', HOME: home };
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'start', '--task', 'x', '--shape', 'build'],
      {
        cwd: tempRepository(),
        env: environment,
        encoding: 'utf8',
      },
    );
    const root = join(home, '.claude', 'harness-runs');

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(readdirSync(root).sort()).toEqual(['bin', result.stdout.trim()].sort());
  });

  test('event and finish without --run exit 2', () => {
    const runs = tempDirectory();
    const repo = tempRepository();

    expect(run(runs, repo, 'event', '--gate', 'check', '--verdict', 'pass').status).toBe(2);
    expect(run(runs, repo, 'finish', '--outcome', 'done').status).toBe(2);
  });
});

describe('self copy', () => {
  const binCopy = (runs: string): string => join(runs, 'bin', 'run-log.mjs');
  const sameBytes = (first: string, second: string): boolean =>
    readFileSync(first).equals(readFileSync(second));

  test('every command leaves a byte-identical copy at <root>/bin/run-log.mjs', () => {
    const { runs, repo, runId } = started();

    expect(sameBytes(SCRIPT, binCopy(runs))).toBe(true);

    rmSync(join(runs, 'bin'), { recursive: true });
    event(runs, repo, runId, '--gate', 'check', '--verdict', 'pass');

    expect(sameBytes(SCRIPT, binCopy(runs))).toBe(true);

    rmSync(join(runs, 'bin'), { recursive: true });
    ok(run(runs, repo, 'finish', '--run', runId, '--outcome', 'done'));

    expect(sameBytes(SCRIPT, binCopy(runs))).toBe(true);

    rmSync(join(runs, 'bin'), { recursive: true });
    ok(run(runs, repo, 'stats'));

    expect(sameBytes(SCRIPT, binCopy(runs))).toBe(true);
  });

  test('a stale copy is replaced', () => {
    const { runs, repo } = started();
    writeFileSync(binCopy(runs), '// stale\n');
    startRun(runs, repo);

    expect(sameBytes(SCRIPT, binCopy(runs))).toBe(true);
  });

  // A rewrite goes through a temp file and a rename, so it always changes the inode.
  test('an identical copy is not rewritten', () => {
    const { runs, repo } = started();
    const before = statSync(binCopy(runs)).ino;
    startRun(runs, repo);

    expect(statSync(binCopy(runs)).ino).toBe(before);
  });

  test('the copy runs standalone and leaves itself untouched', () => {
    const { runs, repo } = started();
    const copy = binCopy(runs);
    const before = statSync(copy).ino;
    const result = spawnSync(process.execPath, [copy, 'start', '--task', 'x', '--shape', 'fix'], {
      cwd: repo,
      env: childEnvironment(runs),
      encoding: 'utf8',
    });

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(result.stdout.trim()).toMatch(new RegExp(`^${RUN_ID_PATTERN}-demo-repo-main(-\\d+)?$`));
    expect(statSync(copy).ino).toBe(before);
    expect(sameBytes(SCRIPT, copy)).toBe(true);
  });

  test('a failed copy warns on stderr and never fails the command', () => {
    const runs = tempDirectory();
    const repo = tempRepository();
    writeFileSync(join(runs, 'bin'), 'a file where the bin directory should go');
    const result = run(runs, repo, 'start', '--task', 'x', '--shape', 'build');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(new RegExp(`^${RUN_ID_PATTERN}-demo-repo-main$`));
    expect(result.stderr.trim()).not.toBe('');
  });
});

describe('event', () => {
  test('appends one schema v1 line with every field', () => {
    const { runs, repo, runId } = started();
    const before = Date.now();
    event(
      runs,
      repo,
      runId,
      ...['--gate', 'review', '--verdict', 'changes', '--phase', 'implement', '--step', '4'],
    );
    const [line] = readEvents(runs, runId);

    expect(Object.keys(line)).toEqual([
      ...['v', 'ts', 'phase', 'step', 'group', 'gate'],
      ...['role', 'attempt', 'verdict', 'findings', 'mechanizable', 'note', 'reason', 'minutes'],
    ]);
    expect(line.v).toBe(1);
    expect(new Date(line.ts).toISOString()).toBe(line.ts);
    expect(Date.parse(line.ts)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(line.ts)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(line.phase).toBe('implement');
    expect(line.step).toBe(4);
    expect(line.gate).toBe('review');
    expect(line.verdict).toBe('changes');
  });

  test('parses numbers as integers and keeps text fields', () => {
    const { runs, repo, runId } = started();
    const flags = [
      ...['--gate', 'review', '--verdict', 'changes', '--phase', 'implement'],
      ...['--step', '4', '--group', '2', '--role', 'reviewer', '--attempt', '3'],
      ...['--findings', '5', '--mechanizable', '2', '--note', 'two blockers'],
    ];
    event(runs, repo, runId, ...flags);
    const [line] = readEvents(runs, runId);

    expect(line.step).toBe(4);
    expect(line.group).toBe(2);
    expect(line.role).toBe('reviewer');
    expect(line.attempt).toBe(3);
    expect(line.findings).toBe(5);
    expect(line.mechanizable).toBe(2);
    expect(line.note).toBe('two blockers');
  });

  test('absent optional fields are null', () => {
    const { runs, repo, runId } = started();
    event(runs, repo, runId, '--gate', 'check', '--verdict', 'pass');
    const [line] = readEvents(runs, runId);

    expect(line).toMatchObject({
      phase: null,
      step: null,
      group: null,
      role: null,
      attempt: null,
      findings: null,
      mechanizable: null,
      note: null,
      reason: null,
      minutes: null,
    });
    expect(line.gate).toBe('check');
    expect(line.verdict).toBe('pass');
  });

  test('accepts every gate and every verdict', () => {
    const { runs, repo, runId } = started();
    const gates = ['check', 'test', 'review', 'human', 'commit', 'deep', 'stall', 'retro'];
    const verdicts = ['pass', 'fail', 'changes', 'approve', 'stall', 'timeout', 'skipped'];

    for (const gate of gates) event(runs, repo, runId, '--gate', gate, '--verdict', 'pass');

    for (const verdict of verdicts) {
      event(runs, repo, runId, '--gate', 'check', '--verdict', verdict);
    }

    expect(readEvents(runs, runId)).toHaveLength(gates.length + verdicts.length);
  });

  test('an invalid gate or verdict exits 2 and writes nothing', () => {
    const { runs, repo, runId } = started();
    const bad = [
      ['--gate', 'lint', '--verdict', 'pass'],
      ['--gate', 'check', '--verdict', 'maybe'],
      ['--gate', 'check'],
      ['--verdict', 'pass'],
    ];

    for (const args of bad) {
      const result = run(runs, repo, 'event', '--run', runId, ...args);
      expectStatus(result, 2, args.join(' '));
      expect(result.stderr.trim()).not.toBe('');
    }

    expect(existsSync(join(runs, runId, 'events.jsonl'))).toBe(false);
  });

  test('an invalid event after a valid one leaves the log as it was', () => {
    const { runs, repo, runId } = started();
    event(runs, repo, runId, '--gate', 'check', '--verdict', 'pass');
    const before = readFileSync(join(runs, runId, 'events.jsonl'), 'utf8');

    expect(
      run(runs, repo, 'event', '--run', runId, '--gate', 'nope', '--verdict', 'pass').status,
    ).toBe(2);
    expect(readFileSync(join(runs, runId, 'events.jsonl'), 'utf8')).toBe(before);
  });
});

describe('event: wait gate', () => {
  const waitFlags = (...extra: string[]): string[] => [
    '--gate',
    'wait',
    '--verdict',
    'pass',
    ...extra,
  ];

  test('a wait event carries its reason and minutes', () => {
    const { runs, repo, runId } = started();
    event(
      runs,
      repo,
      runId,
      ...waitFlags('--reason', 'battery', '--minutes', '450', '--step', '3', '--group', '1'),
    );
    const [line] = readEvents(runs, runId);

    expect(line).toMatchObject({
      ...{ gate: 'wait', verdict: 'pass', reason: 'battery', minutes: 450 },
      ...{ step: 3, group: 1 },
    });
  });

  test('every reason and both verdicts are accepted', () => {
    const { runs, repo, runId } = started();
    const reasons = ['battery', 'load', 'usage-limit', 'user'];

    for (const reason of reasons) {
      event(runs, repo, runId, ...waitFlags('--reason', reason, '--minutes', '5'));
    }

    const timedOut = [
      '--gate',
      'wait',
      '--verdict',
      'timeout',
      '--reason',
      'load',
      '--minutes',
      '5',
    ];
    event(runs, repo, runId, ...timedOut);

    expect(readEvents(runs, runId).map((line) => [line.verdict, line.reason])).toEqual([
      ...reasons.map((reason) => ['pass', reason]),
      ['timeout', 'load'],
    ]);
  });

  test('other gates carry a null reason and null minutes', () => {
    const { runs, repo, runId } = started();
    event(runs, repo, runId, '--gate', 'check', '--verdict', 'pass');

    expect(readEvents(runs, runId)[0]).toMatchObject({ reason: null, minutes: null });
  });

  test('a wait event that is missing or misstates a field exits 2 and writes nothing', () => {
    const { runs, repo, runId } = started();
    const bad = [
      waitFlags('--minutes', '30'),
      waitFlags('--reason', 'battery'),
      waitFlags('--reason', 'nap', '--minutes', '30'),
      waitFlags('--reason', 'battery', '--minutes', '0'),
      waitFlags('--reason', 'battery', '--minutes', '-1'),
      waitFlags('--reason', 'battery', '--minutes', 'soon'),
      waitFlags('--reason', 'battery', '--minutes', '1.5'),
      ['--gate', 'wait', '--verdict', 'approve', '--reason', 'battery', '--minutes', '30'],
      ['--gate', 'wait', '--verdict', 'fail', '--reason', 'battery', '--minutes', '30'],
    ];

    for (const args of bad) {
      const result = run(runs, repo, 'event', '--run', runId, ...args);
      expectStatus(result, 2, args.join(' '));
      expect(result.stderr).toContain('usage:');
    }

    expect(existsSync(join(runs, runId, 'events.jsonl'))).toBe(false);
  });

  test('--reason and --minutes on a gate other than wait exit 2 and write nothing', () => {
    const { runs, repo, runId } = started();
    const bad = [
      ['--gate', 'check', '--verdict', 'pass', '--reason', 'battery'],
      ['--gate', 'check', '--verdict', 'pass', '--minutes', '30'],
      ['--gate', 'review', '--verdict', 'approve', '--reason', 'load', '--minutes', '30'],
    ];

    for (const args of bad) {
      expectStatus(run(runs, repo, 'event', '--run', runId, ...args), 2, args.join(' '));
    }

    expect(existsSync(join(runs, runId, 'events.jsonl'))).toBe(false);
  });
});

describe('resume', () => {
  test('two events from two processes, one from another cwd, land in one log in order', () => {
    const { runs, repo, runId } = started();
    const elsewhere = tempDirectory();
    event(runs, repo, runId, '--gate', 'check', '--verdict', 'fail', '--step', '1');
    event(runs, elsewhere, runId, '--gate', 'check', '--verdict', 'pass', '--step', '1');
    const events = readEvents(runs, runId);

    expect(events.map((entry) => entry.verdict)).toEqual(['fail', 'pass']);
    expect(Date.parse(events[0].ts)).toBeLessThanOrEqual(Date.parse(events[1].ts));
    expect(readdirSync(join(runs, runId)).filter((name) => name === 'events.jsonl')).toHaveLength(
      1,
    );
    expect(runIds(runs)).toEqual([runId]);
  });

  test('events do not rewrite run.json', () => {
    const { runs, repo, runId } = started();
    const before = readFileSync(join(runs, runId, 'run.json'), 'utf8');
    event(runs, repo, runId, '--gate', 'check', '--verdict', 'pass');

    expect(readFileSync(join(runs, runId, 'run.json'), 'utf8')).toBe(before);
  });
});

describe('finish', () => {
  // check fails then passes on step 1 (a retry); review gets changes twice then approval on step 2
  // (two retries); a failure on step 3 followed by a pass on step 4 is no retry; a test timeout
  // then a pass on step 5 is one; one stall.
  const fixture: [string, string, number][] = [
    ['check', 'fail', 1],
    ['check', 'pass', 1],
    ['review', 'changes', 2],
    ['review', 'changes', 2],
    ['review', 'approve', 2],
    ['check', 'fail', 3],
    ['check', 'pass', 4],
    ['test', 'timeout', 5],
    ['test', 'pass', 5],
    ['stall', 'stall', 5],
  ];

  function finished(...extra: string[]): Started & { summary: Summary } {
    const setup = started();

    for (const [gate, verdict, step] of fixture) {
      event(
        setup.runs,
        setup.repo,
        setup.runId,
        ...['--gate', gate, '--verdict', verdict, '--step', String(step)],
      );
    }

    ok(run(setup.runs, setup.repo, 'finish', '--run', setup.runId, '--outcome', 'done', ...extra));

    return { ...setup, summary: readJson<Summary>(join(setup.runs, setup.runId, 'summary.json')) };
  }

  test('writes summary.json with the totals', () => {
    const { runId, summary } = finished();

    expect(Object.keys(summary)).toEqual([
      'v',
      'runId',
      'outcome',
      'finishedAt',
      'totals',
      'retro',
    ]);
    expect(summary.v).toBe(1);
    expect(summary.runId).toBe(runId);
    expect(summary.outcome).toBe('done');
    expect(new Date(summary.finishedAt).toISOString()).toBe(summary.finishedAt);
    expect(summary.totals.events).toBe(fixture.length);
    expect(summary.totals.byGate).toEqual({
      check: { fail: 2, pass: 2 },
      review: { changes: 2, approve: 1 },
      test: { timeout: 1, pass: 1 },
      stall: { stall: 1 },
    });
    expect(summary.totals.stalls).toBe(1);
  });

  test('retries are gate events after a fail, changes or timeout on the same step and gate', () => {
    const { summary } = finished();

    expect(summary.totals.retries).toBe(4);
  });

  test('retro is null without --recorded/--gaps and holds the counts with them', () => {
    expect(finished().summary.retro).toBeNull();
    expect(finished('--recorded', '4', '--gaps', '2').summary.retro).toEqual({
      recorded: 4,
      gaps: 2,
    });
  });

  test('retro with only one of --recorded/--gaps keeps the other as null', () => {
    expect(finished('--recorded', '4').summary.retro).toEqual({ recorded: 4, gaps: null });
    expect(finished('--gaps', '2').summary.retro).toEqual({ recorded: null, gaps: 2 });
  });

  test('totals.waitMinutes is the sum of the wait events and 0 without one', () => {
    expect(finished().summary.totals.waitMinutes).toBe(0);

    const { runs, repo, runId } = started();
    const wait = (minutes: string, reason: string): string[] => [
      '--gate',
      'wait',
      '--verdict',
      'pass',
      '--reason',
      reason,
      '--minutes',
      minutes,
    ];
    event(runs, repo, runId, ...wait('30', 'load'));
    event(runs, repo, runId, ...wait('450', 'battery'));
    ok(run(runs, repo, 'finish', '--run', runId, '--outcome', 'done'));
    const { totals } = readJson<Summary>(join(runs, runId, 'summary.json'));

    expect(totals.waitMinutes).toBe(480);
    expect(totals.byGate).toEqual({ wait: { pass: 2 } });
  });

  test('a wait between a failure and its retry keeps the retry and is no retry itself', () => {
    const { runs, repo, runId } = started();
    const step = ['--step', '1'];
    event(runs, repo, runId, '--gate', 'test', '--verdict', 'fail', ...step);
    const timedOut = [
      '--gate',
      'wait',
      '--verdict',
      'timeout',
      '--reason',
      'load',
      '--minutes',
      '5',
    ];
    event(runs, repo, runId, ...timedOut, ...step);
    event(runs, repo, runId, ...timedOut, ...step);
    event(runs, repo, runId, '--gate', 'test', '--verdict', 'pass', ...step);
    ok(run(runs, repo, 'finish', '--run', runId, '--outcome', 'done'));

    expect(readJson<Summary>(join(runs, runId, 'summary.json')).totals.retries).toBe(1);
  });

  test('a stall is a stall verdict on any gate or any verdict on the stall gate', () => {
    const { runs, repo, runId } = started();
    event(runs, repo, runId, '--gate', 'review', '--verdict', 'stall');
    event(runs, repo, runId, '--gate', 'stall', '--verdict', 'pass');
    event(runs, repo, runId, '--gate', 'review', '--verdict', 'pass');
    ok(run(runs, repo, 'finish', '--run', runId, '--outcome', 'done'));

    expect(readJson<Summary>(join(runs, runId, 'summary.json')).totals.stalls).toBe(2);
  });

  test('a run with no events still finishes with empty totals', () => {
    const { runs, repo, runId } = started();
    ok(run(runs, repo, 'finish', '--run', runId, '--outcome', 'aborted'));
    const summary = readJson<Summary>(join(runs, runId, 'summary.json'));

    expect(summary.outcome).toBe('aborted');
    expect(summary.totals.events).toBe(0);
    expect(summary.totals.byGate).toEqual({});
    expect(summary.totals.stalls).toBe(0);
    expect(summary.totals.retries).toBe(0);
  });

  test('an invalid outcome exits 2 and writes no summary', () => {
    const { runs, repo, runId } = started();

    for (const args of [['--outcome', 'finished'], []]) {
      expectStatus(run(runs, repo, 'finish', '--run', runId, ...args), 2, args.join(' '));
    }

    expect(existsSync(join(runs, runId, 'summary.json'))).toBe(false);
  });

  test('accepts every outcome', () => {
    for (const outcome of ['done', 'blocked', 'aborted']) {
      const { runs, repo, runId } = started();
      ok(run(runs, repo, 'finish', '--run', runId, '--outcome', outcome));

      expect(readJson<Summary>(join(runs, runId, 'summary.json')).outcome).toBe(outcome);
    }
  });
});

describe('finish --archive', () => {
  function sessionDirectory(repo: string): string {
    const directory = join(repo, 'specs', 'harness');
    mkdirSync(join(directory, 'nested'), { recursive: true });
    writeFileSync(join(directory, 'session.json'), '{"step":3}\n');
    writeFileSync(join(directory, 'context.md'), '# context\n');
    writeFileSync(join(directory, 'nested', 'deep.txt'), 'stays\n');

    return directory;
  }

  test('moves the regular files directly in the dir into <run>/artifacts/ and prints the count', () => {
    const { runs, repo, runId } = started();
    const directory = sessionDirectory(repo);
    const result = ok(
      run(runs, repo, 'finish', '--run', runId, '--outcome', 'done', '--archive', 'specs/harness'),
    );
    const artifacts = join(runs, runId, 'artifacts');

    expect(result.stdout.trim()).toBe('2');
    expect(readdirSync(artifacts).sort()).toEqual(['context.md', 'session.json']);
    expect(readFileSync(join(artifacts, 'session.json'), 'utf8')).toBe('{"step":3}\n');
    expect(readFileSync(join(artifacts, 'context.md'), 'utf8')).toBe('# context\n');
    expect(existsSync(join(directory, 'session.json'))).toBe(false);
    expect(existsSync(join(directory, 'context.md'))).toBe(false);
  });

  test('leaves subfolders and their files in place', () => {
    const { runs, repo, runId } = started();
    const directory = sessionDirectory(repo);
    ok(run(runs, repo, 'finish', '--run', runId, '--outcome', 'done', '--archive', directory));

    expect(readdirSync(directory)).toEqual(['nested']);
    expect(readFileSync(join(directory, 'nested', 'deep.txt'), 'utf8')).toBe('stays\n');
    expect(existsSync(join(runs, runId, 'artifacts', 'nested'))).toBe(false);
  });

  test('still writes summary.json, and an empty dir moves nothing', () => {
    const { runs, repo, runId } = started();
    mkdirSync(join(repo, 'empty'));
    const result = ok(
      run(runs, repo, 'finish', '--run', runId, '--outcome', 'blocked', '--archive', 'empty'),
    );

    expect(result.stdout.trim()).toBe('0');
    expect(readJson<Summary>(join(runs, runId, 'summary.json')).outcome).toBe('blocked');
  });

  test('a dir that does not exist moves nothing and prints 0', () => {
    const { runs, repo, runId } = started();
    const result = ok(
      run(runs, repo, 'finish', '--run', runId, '--outcome', 'done', '--archive', 'no-such-dir'),
    );

    expect(result.stdout.trim()).toBe('0');
    expect(existsSync(join(runs, runId, 'artifacts'))).toBe(false);
  });

  test('finish without --archive prints nothing and leaves the dir alone', () => {
    const { runs, repo, runId } = started();
    const directory = sessionDirectory(repo);
    const result = ok(run(runs, repo, 'finish', '--run', runId, '--outcome', 'done'));

    expect(result.stdout).toBe('');
    expect(readdirSync(directory).sort()).toEqual(['context.md', 'nested', 'session.json']);
  });
});

describe('stats', () => {
  type TableRow = Record<string, string>;
  // The shape an event had before the wait gate: the two wait fields are absent, not null.
  type FixtureEvent = Omit<EventLine, 'reason' | 'minutes'> &
    Partial<Pick<EventLine, 'reason' | 'minutes'>>;

  const HEADER = [
    ...['Run', 'Step group', 'Impl', 'Review', 'Verdicts', 'Steps'],
    ...['Minutes', 'Wait', 'Work', 'Target'],
    ...['Check/test retries', 'Stalls', 'Human rounds', 'Outcome'],
  ];
  const chainRun = '20260901T0900-demo-repo-feature-chain';
  const oldRun = '20200101T0900-demo-repo-old-work';
  const liveRun = '20990101T0900-other-repo-live-work';

  function line(
    ts: string,
    gate: string,
    verdict: string,
    fields: Partial<EventLine> = {},
  ): FixtureEvent {
    return {
      ...{ v: 1, ts, phase: null, step: null, group: null, gate, role: null, attempt: null },
      ...{ verdict, findings: null, mechanizable: null, note: null, ...fields },
    };
  }

  function fixtureRun(
    runs: string,
    runId: string,
    repo: string,
    startedAt: string,
    events: FixtureEvent[],
    summary?: object,
  ): void {
    const directory = join(runs, runId);
    mkdirSync(directory, { recursive: true });
    const runJson = {
      v: 1,
      runId,
      repo,
      branch: 'b',
      baseSha: null,
      cwd: '/x',
      task: 't',
      jira: null,
      shape: 'build',
    };
    writeFileSync(
      join(directory, 'run.json'),
      JSON.stringify({ ...runJson, orca: null, startedAt }),
    );

    if (events.length > 0) {
      writeFileSync(
        join(directory, 'events.jsonl'),
        `${events.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      );
    }

    if (summary) writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary));
  }

  // Group 1: a check retry, three reviews (changes, changes, approve), a stall and a human round,
  // 09:50 to 10:25. Group 2 is two steps with one approving review. The last event has neither
  // group nor step.
  function chainEvents(): FixtureEvent[] {
    const groupOne = { group: 1, step: 1 };

    return [
      line('2026-09-01T09:50:00.000Z', 'check', 'fail', groupOne),
      line('2026-09-01T09:55:00.000Z', 'check', 'pass', groupOne),
      line('2026-09-01T10:00:00.000Z', 'review', 'changes', groupOne),
      line('2026-09-01T10:05:00.000Z', 'stall', 'stall', groupOne),
      line('2026-09-01T10:10:00.000Z', 'review', 'changes', groupOne),
      line('2026-09-01T10:20:00.000Z', 'human', 'changes', groupOne),
      line('2026-09-01T10:25:00.000Z', 'review', 'approve', groupOne),
      line('2026-09-01T11:00:00.000Z', 'test', 'pass', { group: 2, step: 3 }),
      line('2026-09-01T11:10:00.000Z', 'review', 'approve', { group: 2, step: 4 }),
      line('2026-09-01T11:20:00.000Z', 'deep', 'pass'),
    ];
  }

  function fixtureRoot(): string {
    const runs = tempDirectory();
    const doneSummary = {
      v: 1,
      runId: chainRun,
      outcome: 'done',
      finishedAt: '2026-09-01T11:30:00.000Z',
    };
    fixtureRun(runs, chainRun, 'demo-repo', '2026-09-01T09:45:00.000Z', chainEvents(), doneSummary);
    const oldEvents = [line('2020-01-01T09:10:00.000Z', 'check', 'pass', { step: 1 })];
    fixtureRun(runs, oldRun, 'demo-repo', '2020-01-01T09:00:00.000Z', oldEvents);
    const now = new Date().toISOString();
    fixtureRun(runs, liveRun, 'other-repo', now, [line(now, 'check', 'pass', { step: 1 })]);

    return runs;
  }

  function cells(markdownRow: string): string[] {
    return markdownRow
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
  }

  function table(text: string, format: 'md' | 'tsv' = 'md'): TableRow[] {
    const rows =
      format === 'tsv'
        ? text
            .trim()
            .split('\n')
            .map((tableRow) => tableRow.split('\t'))
        : text
            .split('\n')
            .filter((tableRow) => tableRow.startsWith('|'))
            .map(cells)
            .filter((tableRow) => !tableRow.every((cell) => /^:?-+:?$/.test(cell)));
    const [header, ...body] = rows;

    expect(header).toEqual(HEADER);

    return body.map((tableRow) =>
      Object.fromEntries(header.map((name, index) => [name, tableRow[index]])),
    );
  }

  function stats(runs: string, ...args: string[]): TableRow[] {
    return table(
      ok(run(runs, tempDirectory(), 'stats', ...args)).stdout,
      args.includes('tsv') ? 'tsv' : 'md',
    );
  }

  function row(rows: TableRow[], runId: string, group: string): TableRow {
    const found = rows.find((entry) => entry.Run === runId && entry['Step group'] === group);

    if (!found) {
      throw new Error(`no row for ${runId} group ${group}: ${JSON.stringify(rows)}`);
    }

    return found;
  }

  const distinctRuns = (rows: TableRow[]): string[] => [...new Set(rows.map((entry) => entry.Run))];

  test('chain row: Verdicts ✗✗✓, Impl 3, Review 3, Target 2', () => {
    const chain = row(stats(fixtureRoot()), chainRun, '1');

    expect(chain.Verdicts).toBe('✗✗✓');
    expect(chain.Impl).toBe('3');
    expect(chain.Review).toBe('3');
    expect(chain.Target).toBe('2');
    expect(chain.Outcome).toBe('done');
  });

  test('the rest of the group row: steps, minutes, check/test retries, stalls, human rounds', () => {
    const chain = row(stats(fixtureRoot()), chainRun, '1');

    expect(chain.Steps).toBe('1');
    expect(chain.Minutes).toBe('35');
    expect(chain['Check/test retries']).toBe('1');
    expect(chain.Stalls).toBe('1');
    expect(chain['Human rounds']).toBe('1');
  });

  test('a group spanning two steps counts both, and an approving first review is Impl 1', () => {
    const second = row(stats(fixtureRoot()), chainRun, '2');

    expect(second.Steps).toBe('2');
    expect(second.Review).toBe('1');
    expect(second.Impl).toBe('1');
    expect(second.Verdicts).toBe('✓');
    expect(second.Minutes).toBe('10');
  });

  test('events with neither group nor step form a `-` row', () => {
    const rows = stats(fixtureRoot());

    expect(row(rows, chainRun, '-').Review).toBe('0');
    expect(rows.filter((entry) => entry.Run === chainRun)).toHaveLength(3);
  });

  test('the group falls back to the step when there is no group', () => {
    const runs = tempDirectory();
    const events = [
      line('2026-09-01T10:00:00.000Z', 'review', 'changes', { step: 7 }),
      line('2026-09-01T10:30:00.000Z', 'review', 'approve', { step: 7 }),
    ];
    fixtureRun(runs, chainRun, 'demo-repo', '2026-09-01T09:45:00.000Z', events);
    const seven = row(stats(runs), chainRun, '7');

    expect(seven.Verdicts).toBe('✗✓');
    expect(seven.Impl).toBe('2');
    expect(seven.Steps).toBe('1');
    expect(seven.Minutes).toBe('30');
  });

  test('the verdict chain stops at the first approve', () => {
    const runs = tempDirectory();
    const events = [
      line('2026-09-01T10:00:00.000Z', 'review', 'approve', { step: 1 }),
      line('2026-09-01T10:10:00.000Z', 'review', 'changes', { step: 1 }),
    ];
    fixtureRun(runs, chainRun, 'demo-repo', '2026-09-01T09:45:00.000Z', events);
    const first = row(stats(runs), chainRun, '1');

    expect(first.Verdicts).toBe('✓');
    expect(first.Impl).toBe('1');
  });

  test('a failing review counts as ✗ and a passing one as ✓', () => {
    const runs = tempDirectory();
    const events = [
      line('2026-09-01T10:00:00.000Z', 'review', 'fail', { step: 1 }),
      line('2026-09-01T10:10:00.000Z', 'review', 'pass', { step: 1 }),
    ];
    fixtureRun(runs, chainRun, 'demo-repo', '2026-09-01T09:45:00.000Z', events);

    expect(row(stats(runs), chainRun, '1').Verdicts).toBe('✗✓');
  });

  test('Outcome: the summary wins, a stale run with no summary is abandoned, a recent one is running', () => {
    const rows = stats(fixtureRoot());

    expect(row(rows, chainRun, '1').Outcome).toBe('done');
    expect(row(rows, oldRun, '1').Outcome).toBe('abandoned');
    expect(row(rows, liveRun, '1').Outcome).toBe('running');
  });

  test('a recent run with no summary and a stale last event is abandoned only after 24 h', () => {
    const runs = tempDirectory();
    const hoursAgo = (hours: number): string =>
      new Date(Date.now() - hours * 3600_000).toISOString();
    fixtureRun(runs, 'a-23h', 'demo-repo', hoursAgo(30), [
      line(hoursAgo(23), 'check', 'pass', { step: 1 }),
    ]);
    fixtureRun(runs, 'b-25h', 'demo-repo', hoursAgo(30), [
      line(hoursAgo(25), 'check', 'pass', { step: 1 }),
    ]);
    const rows = stats(runs);

    expect(row(rows, 'a-23h', '1').Outcome).toBe('running');
    expect(row(rows, 'b-25h', '1').Outcome).toBe('abandoned');
  });

  test('--since keeps runs that started on or after the date', () => {
    const rows = stats(fixtureRoot(), '--since', '2026-09-15');

    expect(distinctRuns(rows)).toEqual([liveRun]);
  });

  test('--since must be YYYY-MM-DD', () => {
    const runs = fixtureRoot();

    for (const since of ['2026-9-1', '20260901', 'yesterday']) {
      const result = run(runs, tempDirectory(), 'stats', '--since', since);
      expectStatus(result, 2, since);
      expect(result.stdout).toBe('');
    }
  });

  test('--repo keeps the runs of one repo slug', () => {
    const runs = fixtureRoot();

    expect(distinctRuns(stats(runs, '--repo', 'other-repo'))).toEqual([liveRun]);
    expect(distinctRuns(stats(runs, '--repo', 'demo-repo'))).toEqual([oldRun, chainRun]);
  });

  test('--format tsv is tab-separated with the same header and rows', () => {
    const rows = stats(fixtureRoot(), '--format', 'tsv');
    const chain = row(rows, chainRun, '1');

    expect(chain.Verdicts).toBe('✗✗✓');
    expect(chain.Impl).toBe('3');
    expect(chain.Review).toBe('3');
  });

  test('--format json is valid JSON that carries the runs', () => {
    const result = ok(run(fixtureRoot(), tempDirectory(), 'stats', '--format', 'json'));
    const data = JSON.parse(result.stdout) as TableRow[];

    expect(Array.isArray(data)).toBe(true);
    expect(Object.keys(data[0])).toEqual(HEADER);
    expect(result.stdout).toContain(chainRun);
    expect(result.stdout).toContain('✗✗✓');
  });

  test('an unknown --format exits 2', () => {
    expect(run(fixtureRoot(), tempDirectory(), 'stats', '--format', 'xml').status).toBe(2);
  });

  test('the bin directory holding the self copy is not read as a run', () => {
    const runs = fixtureRoot();
    const first = stats(runs);

    expect(existsSync(join(runs, 'bin', 'run-log.mjs'))).toBe(true);
    expect(first.some((entry) => entry.Run === 'bin')).toBe(false);
  });

  test('a run started by the script shows up in stats as running', () => {
    const { runs, repo, runId } = started();
    event(runs, repo, runId, '--gate', 'review', '--verdict', 'approve', '--step', '1');
    const mine = row(stats(runs), runId, '1');

    expect(mine.Outcome).toBe('running');
    expect(mine.Verdicts).toBe('✓');
  });

  test('events.jsonl lines that are not JSON objects are skipped by stats and finish', () => {
    const { runs, repo, runId } = started();
    event(runs, repo, runId, '--gate', 'review', '--verdict', 'approve', '--step', '1');
    appendFileSync(join(runs, runId, 'events.jsonl'), 'null\n5\n[1]\n');
    const mine = row(stats(runs), runId, '1');

    expect(mine.Verdicts).toBe('✓');

    ok(run(runs, repo, 'finish', '--run', runId, '--outcome', 'done'));

    expect(readJson<Summary>(join(runs, runId, 'summary.json')).totals.events).toBe(1);
  });

  describe('wait and work minutes', () => {
    const waitLine = (ts: string, minutes: number | null, fields: Partial<EventLine> = {}) =>
      line(ts, 'wait', 'pass', { step: 1, reason: 'battery', minutes, ...fields });
    const checkLine = (ts: string, fields: Partial<EventLine> = {}) =>
      line(ts, 'check', 'pass', { step: 1, ...fields });
    const onlyRow = (events: FixtureEvent[]): TableRow => {
      const runs = tempDirectory();
      fixtureRun(runs, chainRun, 'demo-repo', '2026-09-01T09:45:00.000Z', events);

      return row(stats(runs), chainRun, '1');
    };
    const minutesOf = (found: TableRow): string[] => [found.Minutes, found.Wait, found.Work];

    test('a group with no wait event works for its whole span', () => {
      const found = onlyRow([
        checkLine('2026-09-01T10:00:00.000Z'),
        checkLine('2026-09-01T10:40:00.000Z'),
      ]);

      expect(minutesOf(found)).toEqual(['40', '0', '40']);
    });

    test('the wait event is subtracted from the span: 450 of 480 minutes waiting leaves 30', () => {
      const found = onlyRow([
        checkLine('2026-09-01T10:00:00.000Z'),
        checkLine('2026-09-01T18:00:00.000Z'),
        waitLine('2026-09-01T18:00:00.000Z', 450),
      ]);

      expect(minutesOf(found)).toEqual(['480', '450', '30']);
    });

    test('a wait longer than the span leaves 0 work, not a negative number', () => {
      const found = onlyRow([
        checkLine('2026-09-01T10:00:00.000Z'),
        checkLine('2026-09-01T10:20:00.000Z'),
        waitLine('2026-09-01T10:20:00.000Z', 30),
      ]);

      expect(minutesOf(found)).toEqual(['20', '30', '0']);
    });

    test('one event has no span, so Minutes and Work are 0; a lone wait still shows its Wait', () => {
      expect(minutesOf(onlyRow([checkLine('2026-09-01T10:00:00.000Z')]))).toEqual(['0', '0', '0']);
      expect(minutesOf(onlyRow([waitLine('2026-09-01T10:00:00.000Z', 30)]))).toEqual([
        '0',
        '30',
        '0',
      ]);
    });

    test('every wait event of a group adds up, and another group keeps its own Wait', () => {
      const runs = tempDirectory();
      fixtureRun(runs, chainRun, 'demo-repo', '2026-09-01T09:45:00.000Z', [
        checkLine('2026-09-01T10:00:00.000Z', { group: 1 }),
        waitLine('2026-09-01T11:00:00.000Z', 60, { group: 1, reason: 'load' }),
        waitLine('2026-09-01T12:30:00.000Z', 90, { group: 1, reason: 'usage-limit' }),
        checkLine('2026-09-01T13:00:00.000Z', { group: 1 }),
        checkLine('2026-09-01T10:00:00.000Z', { group: 2, step: 2 }),
        checkLine('2026-09-01T10:30:00.000Z', { group: 2, step: 2 }),
      ]);
      const rows = stats(runs);

      expect(minutesOf(row(rows, chainRun, '1'))).toEqual(['180', '150', '30']);
      expect(minutesOf(row(rows, chainRun, '2'))).toEqual(['30', '0', '30']);
    });

    test('a wait between a failure and its retry keeps the retry and is no check or test', () => {
      const found = onlyRow([
        line('2026-09-01T10:00:00.000Z', 'test', 'fail', { step: 1 }),
        waitLine('2026-09-01T10:30:00.000Z', 30),
        line('2026-09-01T10:40:00.000Z', 'test', 'pass', { step: 1 }),
      ]);

      expect(found['Check/test retries']).toBe('1');
      expect(found.Stalls).toBe('0');
    });

    test('a wait line whose minutes is missing or not a number counts as 0 wait', () => {
      const found = onlyRow([
        checkLine('2026-09-01T10:00:00.000Z'),
        waitLine('2026-09-01T10:30:00.000Z', null),
        { ...waitLine('2026-09-01T10:40:00.000Z', 5), minutes: undefined },
        { ...waitLine('2026-09-01T10:40:00.000Z', 5), minutes: '5' as unknown as number },
      ]);

      expect(minutesOf(found)).toEqual(['40', '0', '40']);
    });

    test('an event from before the wait gate shows Wait 0 and Work equal to Minutes', () => {
      const chain = row(stats(fixtureRoot()), chainRun, '1');

      expect(minutesOf(chain)).toEqual(['35', '0', '35']);
    });

    test('tsv and json carry Wait and Work', () => {
      const runs = tempDirectory();
      fixtureRun(runs, chainRun, 'demo-repo', '2026-09-01T09:45:00.000Z', [
        checkLine('2026-09-01T10:00:00.000Z'),
        waitLine('2026-09-01T18:00:00.000Z', 450),
      ]);
      const tsv = row(stats(runs, '--format', 'tsv'), chainRun, '1');
      const [json] = JSON.parse(
        ok(run(runs, tempDirectory(), 'stats', '--format', 'json')).stdout,
      ) as object[];

      expect(minutesOf(tsv)).toEqual(['480', '450', '30']);
      expect(json).toMatchObject({ Minutes: 480, Wait: 450, Work: 30 });
    });
  });
});

describe('gap', () => {
  const GAP_HEADER = ['Gap', 'Opened', 'Run', 'Text'];

  function gapsFile(runs: string, repoSlug: string): string {
    return join(runs, 'gaps', `${repoSlug}.jsonl`);
  }

  function gapLines(runs: string, repoSlug = 'demo-repo'): (GapOpenLine | GapCloseLine)[] {
    return readFileSync(gapsFile(runs, repoSlug), 'utf8')
      .trim()
      .split('\n')
      .map((text) => JSON.parse(text) as GapOpenLine | GapCloseLine);
  }

  function gapCommand(runs: string, repo: string, runId: string, ...args: string[]): CommandResult {
    return run(runs, repo, 'gap', '--run', runId, ...args);
  }

  function openGap(runs: string, repo: string, runId: string, text: string): string {
    return ok(gapCommand(runs, repo, runId, '--open', text)).stdout.trim();
  }

  function gapRows(runs: string, ...args: string[]): Record<string, string>[] {
    const result = ok(run(runs, tempDirectory(), 'stats', '--gaps', ...args));
    const rows = result.stdout
      .split('\n')
      .filter((text) => text.startsWith('|'))
      .map((text) =>
        text
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
      .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
    const [header, ...body] = rows;

    expect(header).toEqual(GAP_HEADER);

    return body.map((cells) =>
      Object.fromEntries(header.map((name, index) => [name, cells[index]])),
    );
  }

  const gapIds = (rows: Record<string, string>[]): string[] => rows.map((found) => found.Gap);

  // Two runs in one repo (the second started later) and nothing else.
  function twoRuns(): { runs: string; repo: string; first: string; second: string } {
    const { runs, repo, runId: first } = started();

    return { runs, repo, first, second: startRun(runs, repo) };
  }

  test('open prints <runId>/<n>, counting up per run, and appends to <root>/gaps/<repo>.jsonl', () => {
    const { runs, repo, runId } = started();

    expect(ok(gapCommand(runs, repo, runId, '--open', 'first gap')).stdout).toBe(`${runId}/1\n`);
    expect(ok(gapCommand(runs, repo, runId, '--open', 'second gap')).stdout).toBe(`${runId}/2\n`);

    const lines = gapLines(runs);

    expect(lines.map((entry) => Object.keys(entry))).toEqual([
      ['v', 'op', 'gap', 'repo', 'run', 'ts', 'text'],
      ['v', 'op', 'gap', 'repo', 'run', 'ts', 'text'],
    ]);
    expect(lines).toMatchObject([
      { v: 1, op: 'open', gap: `${runId}/1`, repo: 'demo-repo' },
      { v: 1, op: 'open', gap: `${runId}/2`, repo: 'demo-repo' },
    ]);
    expect(lines.map((entry) => (entry as GapOpenLine).text)).toEqual(['first gap', 'second gap']);
    expect(lines.map((entry) => entry.run)).toEqual([runId, runId]);
    expect(new Date(lines[0].ts).toISOString()).toBe(lines[0].ts);
  });

  test('another run numbers from 1 again, and a run of another repo writes its own file', () => {
    const { runs, repo, first, second } = twoRuns();
    const elsewhere = tempRepository({ name: 'other-repo' });
    const other = startRun(runs, elsewhere);
    openGap(runs, repo, first, 'one');

    expect(openGap(runs, repo, second, 'two')).toBe(`${second}/1`);
    expect(openGap(runs, elsewhere, other, 'three')).toBe(`${other}/1`);
    expect(gapLines(runs).map((entry) => entry.gap)).toEqual([`${first}/1`, `${second}/1`]);
    expect(gapLines(runs, 'other-repo').map((entry) => entry.gap)).toEqual([`${other}/1`]);
    expect(readdirSync(join(runs, 'gaps')).sort()).toEqual(['demo-repo.jsonl', 'other-repo.jsonl']);
  });

  test('close appends a close line from a later run and prints nothing', () => {
    const { runs, repo, first, second } = twoRuns();
    openGap(runs, repo, first, 'one');
    const result = ok(gapCommand(runs, repo, second, '--close', `${first}/1`, '--note', 'fixed'));
    const [, close] = gapLines(runs);

    expect(result.stdout).toBe('');
    expect(Object.keys(close)).toEqual(['v', 'op', 'gap', 'run', 'ts', 'note']);
    expect(close).toMatchObject({
      v: 1,
      op: 'close',
      gap: `${first}/1`,
      run: second,
      note: 'fixed',
    });
    expect(new Date(close.ts).toISOString()).toBe(close.ts);
  });

  test('close without --note records a null note', () => {
    const { runs, repo, runId } = started();
    openGap(runs, repo, runId, 'one');
    ok(gapCommand(runs, repo, runId, '--close', `${runId}/1`));

    expect((gapLines(runs)[1] as GapCloseLine).note).toBeNull();
  });

  test('close of an unknown gap, a closed gap, or from an unknown run exits 1 and writes nothing', () => {
    const { runs, repo, first, second } = twoRuns();
    openGap(runs, repo, first, 'one');
    ok(gapCommand(runs, repo, second, '--close', `${first}/1`));
    const before = readFileSync(gapsFile(runs, 'demo-repo'), 'utf8');
    const bad = [
      [second, `${first}/9`],
      [second, `${first}/1`],
      [second, 'nope/1'],
      ['nope', `${first}/1`],
    ];

    for (const [runId, gapId] of bad) {
      expectStatus(gapCommand(runs, repo, runId, '--close', gapId), 1, `${runId} ${gapId}`);
    }

    expect(readFileSync(gapsFile(runs, 'demo-repo'), 'utf8')).toBe(before);
  });

  test('a run of another repo cannot close the gap', () => {
    const { runs, repo, runId } = started();
    const elsewhere = tempRepository({ name: 'other-repo' });
    const other = startRun(runs, elsewhere);
    openGap(runs, repo, runId, 'one');

    expectStatus(gapCommand(runs, elsewhere, other, '--close', `${runId}/1`), 1, 'other repo');
    expect(existsSync(gapsFile(runs, 'other-repo'))).toBe(false);
  });

  test('a bad invocation exits 2 with usage and creates no gaps file', () => {
    const { runs, repo, runId } = started();
    const bad = [
      ['--open', 'x', '--close', 'y/1'],
      ['--note', 'x'],
      ['--open', 'x', '--note', 'x'],
      ['--open', ''],
      ['--close', ''],
    ];

    for (const args of bad) {
      const result = gapCommand(runs, repo, runId, ...args);
      expectStatus(result, 2, args.join(' '));
      expect(result.stderr).toContain('usage:');
    }

    expectStatus(run(runs, repo, 'gap', '--open', 'x'), 2, 'no --run');
    expect(existsSync(join(runs, 'gaps'))).toBe(false);
  });

  test('stats --gaps lists the open gaps with Gap, Opened, Run and Text', () => {
    const { runs, repo, first, second } = twoRuns();
    openGap(runs, repo, first, 'one');
    openGap(runs, repo, first, 'two');
    openGap(runs, repo, second, 'three');
    ok(gapCommand(runs, repo, second, '--close', `${first}/2`));
    const rows = gapRows(runs);

    expect(rows).toEqual([
      { Gap: `${first}/1`, Opened: gapLines(runs)[0].ts, Run: first, Text: 'one' },
      { Gap: `${second}/1`, Opened: gapLines(runs)[2].ts, Run: second, Text: 'three' },
    ]);
  });

  test('stats --gaps reads every repo, or the one --repo names', () => {
    const { runs, repo, runId } = started();
    const elsewhere = tempRepository({ name: 'other-repo' });
    const other = startRun(runs, elsewhere);
    openGap(runs, repo, runId, 'here');
    openGap(runs, elsewhere, other, 'there');

    expect(gapIds(gapRows(runs))).toEqual([`${runId}/1`, `${other}/1`]);
    expect(gapIds(gapRows(runs, '--repo', 'other-repo'))).toEqual([`${other}/1`]);
    expect(gapRows(runs, '--repo', 'no-such-repo')).toEqual([]);
  });

  test('stats --gaps with no gaps file prints the header only', () => {
    const { runs } = started();

    expect(gapRows(runs)).toEqual([]);
    expect(ok(run(runs, tempDirectory(), 'stats', '--gaps')).stdout).toContain('| Gap |');
    expect(ok(run(runs, tempDirectory(), 'stats', '--gaps', '--format', 'json')).stdout).toBe(
      '[]\n',
    );
  });

  test('stats --gaps --format tsv and json carry the same rows', () => {
    const { runs, repo, runId } = started();
    openGap(runs, repo, runId, 'one');
    const [{ ts }] = gapLines(runs);
    const tsv = ok(run(runs, tempDirectory(), 'stats', '--gaps', '--format', 'tsv')).stdout;
    const json = ok(run(runs, tempDirectory(), 'stats', '--gaps', '--format', 'json')).stdout;

    expect(tsv).toBe(`${GAP_HEADER.join('\t')}\n${[`${runId}/1`, ts, runId, 'one'].join('\t')}\n`);
    expect(JSON.parse(json)).toEqual([{ Gap: `${runId}/1`, Opened: ts, Run: runId, Text: 'one' }]);
  });

  test('stats --gaps keeps a gap text on one table row', () => {
    const { runs, repo, runId } = started();
    openGap(runs, repo, runId, 'a | b\nc\td');
    const md = ok(run(runs, tempDirectory(), 'stats', '--gaps')).stdout;
    const tsv = ok(run(runs, tempDirectory(), 'stats', '--gaps', '--format', 'tsv')).stdout;

    expect(md).toContain('| a \\| b c d |');
    expect(tsv.trim().split('\n')).toHaveLength(2);
    expect(tsv.trim().split('\n')[1].split('\t')).toHaveLength(4);
  });

  test('stats --gaps rejects a --repo that is not a slug and --since', () => {
    const { runs } = started();

    for (const args of [
      ['--repo', '../x'],
      ['--repo', 'A b'],
      ['--since', '2026-09-01'],
    ]) {
      const result = run(runs, tempDirectory(), 'stats', '--gaps', ...args);
      expectStatus(result, 2, args.join(' '));
      expect(result.stdout).toBe('');
    }
  });

  test('a damaged line in the gaps file is skipped', () => {
    const { runs, repo, runId } = started();
    openGap(runs, repo, runId, 'one');
    appendFileSync(gapsFile(runs, 'demo-repo'), 'not json\nnull\n[1]\n{"op":"close"}\n');

    expect(gapIds(gapRows(runs))).toEqual([`${runId}/1`]);
    expect(openGap(runs, repo, runId, 'two')).toBe(`${runId}/2`);
  });

  test('the gaps folder is not read as a run by stats', () => {
    const { runs, repo, runId } = started();
    openGap(runs, repo, runId, 'one');
    const table = ok(run(runs, tempDirectory(), 'stats')).stdout;

    expect(table).not.toContain('gaps');
    expect(table).not.toContain(`${runId}/1`);
    expect(table).toContain(runId);
  });
});

const WORKFLOW_SKILL = 'harness/kiko/skills/harness-workflow/SKILL.md';
const RUN_LOG_TEXT_FILES = [
  WORKFLOW_SKILL,
  'harness/kiko/skills/estimator/SKILL.md',
  'harness/kiko/skills/retrospect/SKILL.md',
  'harness/kiko/agents/retrospect.md',
];
// The `$` is interpolated in so the shell's `${HARNESS_RUNS_DIR:-...}` never
// reads as a mistyped template placeholder.
const INSTALLED_COPY = `${'$'}{HARNESS_RUNS_DIR:-$HOME/.claude/harness-runs}/bin/run-log.mjs`;
// The project's origin remote (`git remote get-url origin`), hard-coded; the workflow
// skill's `drizzer14/kiko.git` example is compared with this literal below, so the check
// catches an edit to the skill, not a change of the real remote.
const PROJECT_REMOTE = 'git@github.com:drizzer14/kiko.git';

function skillText(path: string): string {
  return readFileSync(join(__dirname, '..', path), 'utf8');
}

// Only the workflow skill has a "## Run log" section; the other files mention the script in
// passing, so their whole text is read.
function runLogText(markdown: string): string {
  const start = markdown.indexOf('\n## Run log\n');

  if (start === -1) return markdown;

  const end = markdown.indexOf('\n## ', start + 1);

  return markdown.slice(start, end === -1 ? markdown.length : end);
}

function allRunLogText(): string[] {
  return RUN_LOG_TEXT_FILES.map((path) => runLogText(skillText(path)));
}

function gateVerdictPairs(text: string): string[] {
  return [...text.matchAll(/--gate\s+(\w+)\s+--verdict\s+(\w+)/g)].map(
    ([, gate, verdict]) => `${gate} ${verdict}`,
  );
}

// A gate named with no verdict beside it, which the script would reject for the missing flag.
function gatesWithoutVerdict(text: string): string[] {
  return [...text.matchAll(/--gate\s+(\w+)\b(?!\s+--verdict\s+\w)/g)].map(([, gate]) => gate);
}

function pairsTheScriptRejects(pairs: string[]): string[] {
  const { runs, repo, runId } = started();

  return pairs.filter((pair) => {
    const [gate, verdict] = pair.split(' ');
    // The pair alone is on trial, so a wait gets the reason and minutes it always needs.
    const waitFields = gate === 'wait' ? ['--reason', 'user', '--minutes', '1'] : [];
    const flags = ['--gate', gate, '--verdict', verdict, '--step', '1', ...waitFields];

    return run(runs, repo, 'event', '--run', runId, ...flags).status !== 0;
  });
}

// The skill prints a wrong slug on purpose as a counter-example ("`--repo pff-ios` matches
// nothing"), which is not a command to run.
function repoSlugs(text: string): string[] {
  return [...text.matchAll(/--repo\s+([^\s`]+)(?![^\s`])(?!`\s+matches nothing)/g)].map(
    ([, slugText]) => slugText,
  );
}

function bashSnippets(markdown: string): string[] {
  return [...runLogText(markdown).matchAll(/```bash\n([\s\S]*?)```/g)]
    .map(([, snippet]) => snippet)
    .filter((snippet) => snippet.includes(INSTALLED_COPY));
}

function snippetFor(markdown: string, command: string): string {
  const matching = bashSnippets(markdown).filter((snippet) => snippet.includes(` ${command} `));

  expect({ command, count: matching.length }).toEqual({ command, count: 1 });

  return matching[0];
}

// The flags a `--gate wait` command is missing; the command runs to the next backtick or the end
// of its line, and a trailing backslash continues it.
function waitFlagsMissing(text: string): string[] {
  return [...text.matchAll(/--gate\s+wait\b(?:[^`\n\\]|\\[\s\S])*/g)].flatMap(([command]) =>
    ['--reason', '--minutes'].filter((flag) => !new RegExp(`${flag}\\s+\\S`).test(command)),
  );
}

describe('run log skill text', () => {
  const mutated = (text: string): string => `## Run log\n\n${text}\n`;

  test('every --gate wait the skills write carries --reason and --minutes', () => {
    expect(allRunLogText().flatMap(waitFlagsMissing)).toEqual([]);
  });

  test('a wait command missing --reason or --minutes is reported, across a continued line too', () => {
    const text = mutated(
      [
        '`--gate wait --verdict pass --minutes 5`; `--gate wait --verdict pass --reason load`;',
        '`--gate wait --verdict pass --reason load --minutes 5`;',
        'run event --gate wait \\\n  --verdict pass --reason user \\\n  --minutes N',
      ].join('\n'),
    );

    expect(waitFlagsMissing(text)).toEqual(['--reason', '--minutes']);
  });

  test('a wait pair with its reason and minutes is accepted by the script', () => {
    const text = mutated('`--gate wait --verdict timeout --reason load --minutes 5`');

    expect(gateVerdictPairs(text)).toEqual(['wait timeout']);
    expect(pairsTheScriptRejects(gateVerdictPairs(text))).toEqual([]);
  });

  test('every gate/verdict pair the skills write is accepted by the script', () => {
    const [workflow] = allRunLogText();
    const pairs = [...new Set(allRunLogText().flatMap(gateVerdictPairs))];

    expect(gateVerdictPairs(workflow).length).toBeGreaterThan(0);
    expect(pairsTheScriptRejects(pairs)).toEqual([]);
  });

  test('every --gate the skills write has a --verdict beside it', () => {
    expect(allRunLogText().flatMap(gatesWithoutVerdict)).toEqual([]);
  });

  test('a pair the script rejects is reported', () => {
    const text = mutated('`--gate retro --verdict bogus` and `--gate review --verdict approve`');

    expect(pairsTheScriptRejects(gateVerdictPairs(text))).toEqual(['retro bogus']);
  });

  test('a gate with no verdict is reported, across a line break too', () => {
    const text = mutated(
      'the retrospect: `--gate retro`; review `--gate review\n  --verdict changes`',
    );

    expect(gatesWithoutVerdict(text)).toEqual(['retro']);
  });

  test('--repo in the skills is the slug the script derives from the project remote', () => {
    const runs = tempDirectory();
    const repo = tempRepository({ name: 'checkout-folder', remote: PROJECT_REMOTE });
    const derived = readJson<RunRecord>(join(runs, startRun(runs, repo), 'run.json')).repo;
    const slugs = allRunLogText().flatMap(repoSlugs);

    expect(skillText(WORKFLOW_SKILL)).toContain('drizzer14/kiko.git');
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.filter((slugText) => slugText !== derived)).toEqual([]);
  });

  test('a --repo that is not the derived slug is reported, a counter-example is not', () => {
    const text = mutated('`stats --repo pff-ios --format md`; `--repo pff-ios` matches nothing');

    expect(repoSlugs(text)).toEqual(['pff-ios']);
    expect(repoSlugs(mutated('`--repo pff-ios` matches nothing'))).toEqual([]);
  });
});

describe('consumer line', () => {
  const workflow = skillText(WORKFLOW_SKILL);
  const startSnippet = snippetFor(workflow, 'start');
  const finishSnippet = snippetFor(workflow, 'finish');

  function runSnippet(
    snippet: string,
    runs: string,
    cwd: string,
    runId = '',
  ): { status: number | null; stdout: string } {
    const result = spawnSync('sh', ['-c', snippet], {
      cwd,
      env: { ...childEnvironment(runs), RUN_ID: runId },
      encoding: 'utf8',
    });

    return { status: result.status, stdout: result.stdout.trim() };
  }

  test('starts a run through the installed copy and prints its id', () => {
    const { runs, repo } = started();
    const result = runSnippet(startSnippet, runs, repo);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(new RegExp(`^${RUN_ID_PATTERN}-demo-repo-main(-\\d+)?$`));
    expect(readJson<RunRecord>(join(runs, result.stdout, 'run.json')).task).toBe(
      '<track> task N/M',
    );
  });

  test('finishes the run through the installed copy', () => {
    const { runs, repo, runId } = started();

    expect(runSnippet(finishSnippet, runs, repo, runId).status).toBe(0);
    expect(readJson<Summary>(join(runs, runId, 'summary.json')).outcome).toBe('done');
  });

  test('a missing copy is skipped without failing the finish and starts nothing', () => {
    const runs = tempDirectory();
    const finished = runSnippet(finishSnippet, runs, tempDirectory(), 'any');

    expect(finished.status).toBe(0);
    expect(finished.stdout).toBe('run-log: not installed, skipped');
    expect(runSnippet(startSnippet, runs, tempDirectory()).stdout).toBe('');
    expect(runIds(runs)).toEqual([]);
  });

  test('a snippet that names the wrong file starts nothing', () => {
    const { runs, repo } = started();
    const broken = startSnippet.replace('bin/run-log.mjs', 'bin/runlog.mjs');

    expect(runSnippet(broken, runs, repo).stdout).toBe('');
    expect(runIds(runs)).toHaveLength(1);
  });

  test('a snippet with the wrong command does not finish the run', () => {
    const { runs, repo, runId } = started();
    const broken = finishSnippet.replace(' finish ', ' finnish ');

    expect(runSnippet(broken, runs, repo, runId).stdout).not.toBe('');
    expect(existsSync(join(runs, runId, 'summary.json'))).toBe(false);
  });

  test('the skill carries exactly one start and one finish snippet', () => {
    expect(bashSnippets(workflow)).toHaveLength(2);
  });
});
