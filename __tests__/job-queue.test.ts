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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

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
};

let sandboxes: Sandbox[] = [];

// One stub body serves `make` and `npm`: it records its own name, arguments, working directory,
// and the variables a test asserts on.
const TOOL_STUB = [
  '#!/usr/bin/env bash',
  '{',
  '  printf "%s %s\\n" "$(basename "$0")" "$*"',
  '  printf "  cwd %s\\n" "$PWD"',
  '  printf "  force-color %s\\n" "${FORCE_COLOR-unset}"',
  '  printf "  base %s\\n" "${KIKO_MUTATION_BASE-unset}"',
  '} >> "$KIKO_STUB_CALLS"',
  'exit "${KIKO_STUB_EXIT-0}"',
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
  };
  sandboxes.push(sandbox);

  return sandbox;
};

const runQueue = (sandbox: Sandbox, ...queueArguments: string[]): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT, ...queueArguments], {
    encoding: 'utf8',
    env: sandbox.environment,
  });

afterEach(() => {
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

describe('scripts/job-queue.sh status', () => {
  it('prints "queue empty" for an empty state directory', () => {
    const result = runQueue(createSandbox(), 'status');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('queue empty');
  });
});
