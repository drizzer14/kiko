import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { readTextFile } from './test-support/read-text-file';
import { isolatedGitEnvironment } from './test-support/isolated-git';

// medium.sh runs the doc-reading jest suites when a file under a doc root changed, uncommitted or
// committed since the guard replay's mark. Every test runs COPIES of medium.sh and _lib.sh in a
// throwaway repository; the other wrappers are no-op stubs, and jest is a stub reached through
// KIKO_DOC_SUITES_JEST, so the test proves which suites medium.sh hands jest and when.
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
    'jest-stub.sh',
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
  writeFile(project, 'CLAUDE.md', 'base\n');
  writeFile(project, 'docs/harness/base.md', 'base\n');
  git(project, 'add', '-A');
  git(project, 'commit', '-qm', 'base');

  return project;
};

const runMedium = (project: Project, extra: NodeJS.ProcessEnv = {}): Outcome => {
  const result = spawnSync('bash', [join(project.root, 'scripts/checks/medium.sh')], {
    cwd: project.root,
    env: {
      ...process.env,
      TMPDIR: project.state,
      KIKO_DOC_SUITES_JEST: join(project.root, 'jest-stub.sh'),
      ...extra,
    },
    encoding: 'utf8',
  });

  return { code: result.status, stderr: result.stderr };
};

// One entry per jest run, each the suites that run was given.
const jestRuns = (project: Project): string[][] => {
  try {
    return readTextFile(stateFile(project, 'jest.runs'))
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' '));
  } catch {
    return [];
  }
};

// A first run moves the stub replay's mark to the base commit, so a later commit is "since the
// mark".
const projectWithMark = (): Project => {
  const project = buildProject();

  expect(runMedium(project)).toEqual({ code: 0, stderr: '' });

  return project;
};

afterEach(removeTemporaryDirectories);

describe('medium.sh doc-suites step', () => {
  it.each([
    ['harness/kiko/skills/', 'harness/kiko/skills/demo/SKILL.md'],
    ['harness/kiko/agents/', 'harness/kiko/agents/demo.md'],
    ['.claude/skills/', '.claude/skills/demo/SKILL.md'],
    ['docs/', 'docs/harness/new.md'],
    ['CLAUDE.md', 'CLAUDE.md'],
  ])('runs the discovered suites after an uncommitted change under %s', (_root, path) => {
    const project = projectWithMark();
    writeFile(project, path, 'changed\n');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([DISCOVERED]);
  });

  it('runs once for a clean tree after a commit that changed a doc, then not again', () => {
    const project = projectWithMark();
    writeFile(project, 'docs/harness/committed.md', 'committed\n');
    git(project, 'add', '-A');
    git(project, 'commit', '-qm', 'doc');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([DISCOVERED]);
    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toHaveLength(1);
  });

  it('does not run again on a second Stop with the same doc state', () => {
    const project = projectWithMark();
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    expect(runMedium(project).code).toBe(0);
    expect(runMedium(project).code).toBe(0);
    expect(jestRuns(project)).toHaveLength(1);
  });

  it('runs again when the doc changes after a pass', () => {
    const project = projectWithMark();
    writeFile(project, 'docs/harness/new.md', 'one\n');
    runMedium(project);
    writeFile(project, 'docs/harness/new.md', 'two\n');
    runMedium(project);

    expect(jestRuns(project)).toHaveLength(2);
  });

  it('does not run for a change outside the doc roots', () => {
    const project = projectWithMark();
    writeFile(project, 'src/code.ts', 'export const code = 1;\n');
    writeFile(project, 'README.md', 'readme\n');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(jestRuns(project)).toEqual([]);
  });

  it('exits 2 with a block naming make doc-suites when a suite fails, and keeps failing', () => {
    const project = projectWithMark();
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
    const project = projectWithMark();
    writeFileSync(stateFile(project, 'jest.mode'), 'hang');
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    const outcome = runMedium(project, { KIKO_DOC_SUITES_DEADLINE_SECONDS: '2' });
    const stubPid = Number(readTextFile(stateFile(project, 'jest.pid')));

    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toContain('run make doc-suites by hand');
    expect(() => process.kill(stubPid, 0)).toThrow();
  });

  it('discovers a new suite with a doc-root literal and a file read, and skips one without', () => {
    const project = projectWithMark();
    writeFile(project, '__tests__/e-new.test.ts', suiteReading('harness/kiko/agents'));
    writeFile(project, '__tests__/f-no-root.test.ts', suiteReading('lib/other'));
    writeFile(project, 'docs/harness/new.md', 'changed\n');

    expect(runMedium(project).code).toBe(0);
    expect(jestRuns(project)).toEqual([[...DISCOVERED, '__tests__/e-new.test.ts']]);
  });
});
