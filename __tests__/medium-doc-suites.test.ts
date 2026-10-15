import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { readTextFile } from './test-support/read-text-file';
import { isolatedGitEnvironment } from './test-support/isolated-git';

// medium.sh runs the doc-reading jest suites when a file under a doc root changed, uncommitted or
// committed since the guard replay's mark. Every test runs COPIES of medium.sh and _lib.sh in a
// throwaway repository; the other wrappers are no-op stubs, and jest is a stub at
// node_modules/.bin/jest, so the test proves which suites medium.sh hands jest and when.
const CHECKS = join(__dirname, '../scripts/checks');

const NO_OP_WRAPPERS = [
  'dup.sh',
  'override-guard.sh',
  'shipped-migrations.sh',
  'knip.sh',
  'deps.sh',
  'semgrep-rules.sh',
  'plist.sh',
  'typecheck.sh',
];

// The guard replay's budget constants: the doc step's deadline is read from the same place.
const { HOOK_BUDGET_SECONDS, GUARD_CALL_TAIL_SECONDS, LATER_CHECKS_RESERVE_SECONDS } = require(
  join(CHECKS, 'guard-replay.js'),
);

// Spawned bash, git and a sleeping stub: far above a normal run, for a full-jest load.
jest.setTimeout(120_000);

type Project = { root: string; state: string };
type Outcome = { code: number | null; stderr: string };

const git = (project: Project, ...gitArguments: string[]): string =>
  execFileSync('git', gitArguments, {
    cwd: project.root,
    encoding: 'utf8',
    env: isolatedGitEnvironment(project.state),
    stdio: 'pipe',
  });

const writeFile = (project: Project, relativePath: string, body: string, mode = 0o644): void => {
  const absolutePath = join(project.root, relativePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, body);
  chmodSync(absolutePath, mode);
};

const stubScript = (...lines: string[]): string => ['#!/usr/bin/env bash', ...lines, ''].join('\n');

const stateFile = (project: Project, name: string): string => join(project.state, name);

// Joined at run time: this suite names the file-read call only as fixture text, and the doc-suite
// discovery must not select it for that.
const READER = ['readFile', 'Sync'].join('');

const suiteReading = (root: string): string =>
  `import { ${READER} } from 'node:fs';\n${READER}('${root}/x.md');\n`;

// The suites medium.sh must discover in the sandbox, in sorted order.
const DISCOVERED = ['__tests__/a-doc.test.ts', '__tests__/b-skill.test.ts'];

const buildProject = (): Project => {
  const state = createTemporaryDirectory('kiko-doc-suites-state-');
  const project: Project = { root: createTemporaryDirectory('kiko-doc-suites-'), state };
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'config', 'user.email', 'test@example.com');
  git(project, 'config', 'user.name', 'Test');
  cpSync(join(CHECKS, 'medium.sh'), join(project.root, 'scripts/checks/medium.sh'));
  cpSync(join(CHECKS, '_lib.sh'), join(project.root, 'scripts/checks/_lib.sh'));
  cpSync(join(CHECKS, 'guard-replay.js'), join(project.root, 'scripts/checks/guard-replay.js'));
  cpSync(join(__dirname, '../Makefile'), join(project.root, 'Makefile'));

  for (const wrapper of NO_OP_WRAPPERS) {
    writeFile(project, `scripts/checks/${wrapper}`, stubScript('exit 0'), 0o755);
  }

  // The real replay moves this worktree's mark to HEAD on a pass; the stub does the same.
  writeFile(
    project,
    'scripts/checks/guard-replay.sh',
    stubScript(
      'source "$(dirname "$0")/_lib.sh"',
      'git update-ref "$(harness_replay_ref "$PWD")" HEAD',
    ),
    0o755,
  );
  writeFile(
    project,
    'node_modules/.bin/jest',
    stubScript(
      `echo "$@" >> "${stateFile(project, 'jest.runs')}"`,
      `mode="$(cat "${stateFile(project, 'jest.mode')}" 2>/dev/null)"`,
      '[ "$mode" = fail ] && { echo "FAIL __tests__/a-doc.test.ts doc drifted" >&2; exit 1; }',
      `[ "$mode" = hang ] && { echo $$ > "${stateFile(project, 'jest.pid')}"; exec sleep 600; }`,
      'exit 0',
    ),
    0o755,
  );
  writeFile(project, '__tests__/a-doc.test.ts', suiteReading('docs/harness'));
  writeFile(project, '__tests__/b-skill.test.ts', suiteReading('.claude/skills'));
  writeFile(project, '__tests__/c-no-root.test.ts', suiteReading('src/features'));
  writeFile(project, '__tests__/d-no-read.test.ts', "export const root = 'docs/harness/x.md';\n");
  writeFile(project, '.gitignore', 'node_modules/\n');
  writeFile(project, 'CLAUDE.md', 'base\n');
  writeFile(project, 'docs/harness/base.md', 'base\n');
  git(project, 'add', '-A');
  git(project, 'commit', '-qm', 'base');

  return project;
};

// `directory` is the path the hook reaches the project by; a symlink to it works too.
const runMedium = (
  project: Project,
  extra: NodeJS.ProcessEnv = {},
  directory = project.root,
): Outcome => {
  const result = spawnSync('bash', [join(directory, 'scripts/checks/medium.sh')], {
    cwd: directory,
    env: {
      ...process.env,
      TMPDIR: project.state,
      ...extra,
    },
    encoding: 'utf8',
  });

  return { code: result.status, stderr: result.stderr };
};

// `make doc-suites`, the by-hand run, against the same state directory the hook reads.
const runByHand = (project: Project): Outcome => {
  const result = spawnSync('make', ['doc-suites'], {
    cwd: project.root,
    env: { ...process.env, TMPDIR: project.state },
    encoding: 'utf8',
  });

  return { code: result.status, stderr: result.stderr };
};

// One entry per jest run, each every argument that run was given.
const jestCalls = (project: Project): string[][] => {
  try {
    return readTextFile(stateFile(project, 'jest.runs'))
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' '));
  } catch {
    return [];
  }
};

// One entry per jest run, each the suites that run was given.
const jestRuns = (project: Project): string[][] =>
  jestCalls(project).map((call) => call.filter((argument) => !argument.startsWith('--')));

// A directory holding a `date` that answers its first `+%s` with the real time (the hook's start)
// and every later one with a time far past any budget, so the doc step reaches its deadline at
// once; any other `date` call passes through.
const futureClockDirectory = (project: Project): string => {
  const directory = join(project.root, 'future-clock');
  const started = stateFile(project, 'clock.started');

  writeFile(
    project,
    'future-clock/date',
    stubScript(
      'if [ "$1" != "+%s" ]; then exec /bin/date "$@"; fi',
      `if [ -e "${started}" ]; then echo $(( $(/bin/date +%s) + 100000 )); exit 0; fi`,
      `: > "${started}"`,
      '/bin/date +%s',
    ),
    0o755,
  );

  return directory;
};

// The lock directory medium.sh takes for this project, held by this test process (alive), so the
// run under test waits for it.
const holdLock = (project: Project): void => {
  const stateDirectory = execFileSync(
    'bash',
    ['-c', 'source "$1/scripts/checks/_lib.sh"; harness_state_dir "$1"', 'bash', project.root],
    { encoding: 'utf8', env: { ...process.env, TMPDIR: project.state } },
  );
  const lock = join(stateDirectory, 'medium.lock');

  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'pid'), String(process.pid));
};

// A directory holding a `sleep` that, on the first call (the lock wait's), records the doc pass
// for the doc state on disk and frees the lock: another Stop finished while this one waited.
const finishingHolderDirectory = (project: Project): string => {
  const flag = stateFile(project, 'holder.finished');

  writeFile(
    project,
    'lock-wait/sleep',
    stubScript(
      `if [ ! -e "${flag}" ]; then`,
      `  : > "${flag}"`,
      `  source "${project.root}/scripts/checks/_lib.sh"`,
      '  physical="$(pwd -P)"',
      '  harness_mark_pass "$physical" doc-suites "$(harness_doc_fingerprint "$physical")"',
      `  rm -rf "$(harness_state_dir "${project.root}")/medium.lock"`,
      'fi',
      'exec /bin/sleep "$@"',
    ),
    0o755,
  );

  return join(project.root, 'lock-wait');
};

// A directory holding a `shasum` that fails for the doc fingerprint's input (it names a doc file)
// and passes any other call through, so the state directory and pass key still hash.
const failingHashDirectory = (project: Project): string => {
  writeFile(
    project,
    'failing-hash/shasum',
    stubScript(
      'input="$(cat)"',
      'case "$input" in *base.md*) exit 1 ;; esac',
      'printf "%s\\n" "$input" | /usr/bin/shasum "$@"',
    ),
    0o755,
  );

  return join(project.root, 'failing-hash');
};

// A first run records the doc pass and moves the stub replay's mark to the base commit; its jest
// call is forgotten, so a row counts only the runs its own change causes.
const projectWithPass = (): Project => {
  const project = buildProject();

  expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
  expect(jestRuns(project)).toEqual([DISCOVERED]);
  rmSync(stateFile(project, 'jest.runs'));

  return project;
};

// What `npm run check:guard-replay` does: the stub replay moves the mark to HEAD.
const replayByHand = (project: Project): void => {
  execFileSync('bash', [join(project.root, 'scripts/checks/guard-replay.sh')], {
    cwd: project.root,
    env: isolatedGitEnvironment(project.state),
    stdio: 'pipe',
  });
};

const commitAll = (project: Project, message: string): void => {
  git(project, 'add', '-A');
  git(project, 'commit', '-qm', message);
};

afterEach(removeTemporaryDirectories);

describe('medium.sh doc-suites step trigger is the doc fingerprint, not the replay mark', () => {
  it('runs on a clean tree with no recorded pass, then not again', () => {
    const project = buildProject();

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([DISCOVERED]);
  });

  it('runs for a committed doc edit after a by-hand replay moved the mark past it', () => {
    const project = projectWithPass();
    writeFile(project, 'docs/harness/committed.md', 'committed\n');
    commitAll(project, 'doc');
    replayByHand(project);

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([DISCOVERED]);
  });

  it.each([
    ['moved out of a doc root and staged', false],
    ['moved out of a doc root and committed', true],
  ])('runs for a doc file %s', (_label, committed) => {
    const project = projectWithPass();
    git(project, 'mv', 'docs/harness/base.md', 'notes-base.md');

    if (committed) commitAll(project, 'move');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([DISCOVERED]);
  });

  it.each([
    ['deleted and unstaged', false],
    ['deleted and committed', true],
  ])('runs for a doc file %s', (_label, committed) => {
    const project = projectWithPass();
    rmSync(join(project.root, 'docs/harness/base.md'));

    if (committed) commitAll(project, 'delete');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([DISCOVERED]);
  });

  it('skips a code-only Stop while the doc fingerprint equals the recorded pass', () => {
    const project = projectWithPass();
    writeFile(project, 'src/code.ts', 'export const code = 1;\n');
    commitAll(project, 'code');
    writeFile(project, 'src/more.ts', 'export const more = 1;\n');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([]);
  });

  it('stays silent in a project with no doc file and no suite', () => {
    const project = buildProject();
    git(project, 'rm', '-q', '-f', 'CLAUDE.md', 'docs/harness/base.md', '__tests__/a-doc.test.ts');
    git(project, 'rm', '-q', '-f', '__tests__/b-skill.test.ts', '__tests__/c-no-root.test.ts');
    git(project, 'rm', '-q', '-f', '__tests__/d-no-read.test.ts');
    commitAll(project, 'empty');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([]);
  });
});

describe('make doc-suites, run by hand', () => {
  it('gives jest the discovered suites and records the pass the next Stop reads', () => {
    const project = projectWithPass();
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    expect(runByHand(project).code).toBe(0);
    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([DISCOVERED]);
  });

  it('records nothing when a suite fails, so the next Stop runs and blocks', () => {
    const project = projectWithPass();
    writeFile(project, 'docs/harness/new.md', 'changed\n');
    writeFileSync(stateFile(project, 'jest.mode'), 'fail');

    expect(runByHand(project).code).not.toBe(0);
    expect(runMedium(project).code).toBe(2);
    expect(jestRuns(project)).toEqual([DISCOVERED, DISCOVERED]);
  });

  it('records under the key a Stop reaching the project by a symlink reads', () => {
    const project = projectWithPass();
    const alias = join(createTemporaryDirectory('kiko-doc-suites-alias-'), 'project');
    symlinkSync(project.root, alias);
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    expect(runByHand(project).code).toBe(0);
    expect(runMedium(project, {}, alias)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([DISCOVERED]);
  });
});

describe('medium.sh doc-suites step', () => {
  it.each([
    ['harness/kiko/skills/', 'harness/kiko/skills/demo/SKILL.md'],
    ['harness/kiko/agents/', 'harness/kiko/agents/demo.md'],
    ['.claude/skills/', '.claude/skills/demo/SKILL.md'],
    ['docs/', 'docs/harness/new.md'],
    ['CLAUDE.md', 'CLAUDE.md'],
  ])('runs the discovered suites after an uncommitted change under %s', (_root, path) => {
    const project = projectWithPass();
    writeFile(project, path, 'changed\n');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([DISCOVERED]);
  });

  it('hands jest two workers before the suites, so the Stop tier leaves the machine its cores', () => {
    const project = projectWithPass();
    writeFile(project, 'docs/harness/new.md', 'changed\n');
    runMedium(project);

    expect(jestCalls(project)).toEqual([['--maxWorkers=2', ...DISCOVERED]]);
  });

  it('runs once for a clean tree after a commit that changed a doc, then not again', () => {
    const project = projectWithPass();
    writeFile(project, 'docs/harness/committed.md', 'committed\n');
    git(project, 'add', '-A');
    git(project, 'commit', '-qm', 'doc');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([DISCOVERED]);
    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toHaveLength(1);
  });

  it('does not run again on a second Stop with the same doc state', () => {
    const project = projectWithPass();
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    expect(runMedium(project).code).toBe(0);
    expect(runMedium(project).code).toBe(0);
    expect(jestRuns(project)).toHaveLength(1);
  });

  it('runs again when the doc changes after a pass', () => {
    const project = projectWithPass();
    writeFile(project, 'docs/harness/new.md', 'one\n');
    runMedium(project);
    writeFile(project, 'docs/harness/new.md', 'two\n');
    runMedium(project);

    expect(jestRuns(project)).toHaveLength(2);
  });

  it('does not run for a change outside the doc roots', () => {
    const project = projectWithPass();
    writeFile(project, 'src/code.ts', 'export const code = 1;\n');
    writeFile(project, 'README.md', 'readme\n');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([]);
  });

  it('exits 2 with a block naming make doc-suites when a suite fails, and keeps failing', () => {
    const project = projectWithPass();
    writeFileSync(stateFile(project, 'jest.mode'), 'fail');
    writeFile(project, 'docs/harness/committed.md', 'committed\n');
    git(project, 'add', '-A');
    git(project, 'commit', '-qm', 'doc');

    for (const attempt of [1, 2]) {
      const outcome = runMedium(project);

      expect({ attempt, code: outcome.code }).toEqual({ attempt, code: 2 });
      expect(outcome.stderr).toContain('CHECK FAILED');
      expect(outcome.stderr).toContain('doc drifted');
      expect(outcome.stderr).toContain('make doc-suites');
    }
    expect(jestRuns(project)).toHaveLength(2);
  });

  it('stops its own jest at the deadline, exits 2 and says to run it by hand', () => {
    const project = projectWithPass();
    writeFileSync(stateFile(project, 'jest.mode'), 'hang');
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    const outcome = runMedium(project, { KIKO_DOC_SUITES_DEADLINE_SECONDS: '2' });
    const stubPid = Number(readTextFile(stateFile(project, 'jest.pid')));

    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toContain('run make doc-suites by hand');
    expect(() => process.kill(stubPid, 0)).toThrow();
  });

  it('ends before the guard call tail and the later checks need their share of the hook', () => {
    const project = projectWithPass();
    writeFileSync(stateFile(project, 'jest.mode'), 'hang');
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    const outcome = runMedium(project, {
      PATH: `${futureClockDirectory(project)}:${process.env.PATH}`,
    });
    const budget = Number(/Stopped (\d+) s after the hook started/.exec(outcome.stderr)?.[1]);

    expect(outcome.code).toBe(2);
    expect(budget).toBeLessThanOrEqual(
      HOOK_BUDGET_SECONDS - GUARD_CALL_TAIL_SECONDS - LATER_CHECKS_RESERVE_SECONDS,
    );
  });

  it('exits 2 without running a suite when the replay engine cannot give its budget', () => {
    const project = projectWithPass();
    rmSync(join(project.root, 'scripts/checks/guard-replay.js'));
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    const outcome = runMedium(project);

    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toContain('Budget: unreadable');
    expect(jestRuns(project)).toEqual([]);
  });

  it('reads its hook budget from the number the Stop hooks are killed at', () => {
    const hooks = JSON.parse(
      readTextFile(join(__dirname, '../harness/kiko/hooks/hooks.json')),
    ).hooks;
    const timeouts = [...hooks.Stop, ...hooks.SubagentStop].flatMap(
      (entry: { hooks: { timeout: number }[] }) => entry.hooks.map((hook) => hook.timeout),
    );

    expect(timeouts).toEqual([HOOK_BUDGET_SECONDS, HOOK_BUDGET_SECONDS]);
  });

  it('skips the suites when another Stop recorded the same doc state during the lock wait', () => {
    const project = projectWithPass();
    writeFile(project, 'docs/harness/new.md', 'changed\n');
    holdLock(project);

    const outcome = runMedium(project, {
      PATH: `${finishingHolderDirectory(project)}:${process.env.PATH}`,
    });

    expect(outcome).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([]);
  });

  it('exits 2 with a block, running no suite, when docs exist and their hash fails', () => {
    const project = projectWithPass();
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    const outcome = runMedium(project, {
      PATH: `${failingHashDirectory(project)}:${process.env.PATH}`,
    });

    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toContain('CHECK FAILED: Doc-reading jest suites');
    expect(outcome.stderr).toContain('fingerprint');
    expect(jestRuns(project)).toEqual([]);
  });

  it('discovers a new suite with a doc-root literal and a file read, and skips one without', () => {
    const project = projectWithPass();
    writeFile(project, '__tests__/e-new.test.ts', suiteReading('harness/kiko/agents'));
    writeFile(project, '__tests__/f-no-root.test.ts', suiteReading('lib/other'));
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    expect(runMedium(project).code).toBe(0);
    expect(jestRuns(project)).toEqual([[...DISCOVERED, '__tests__/e-new.test.ts']]);
  });
});
