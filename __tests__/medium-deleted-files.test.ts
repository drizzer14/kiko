import {
  chmodSync,
  closeSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// git lists a deleted file in the session's changed files, and jscpd fails with ENOENT on a path
// that is not on disk, so the content-reading wrappers (jscpd, override-guard) must get only
// files still on disk. Every test runs COPIES of medium.sh and _lib.sh in a throwaway
// repository; the other wrappers are stubs that log their arguments and fail the way jscpd does
// on a missing path, so the test proves what medium.sh passes them.
const CHECKS = join(__dirname, '../scripts/checks');

const FILE_ARGUMENT_WRAPPERS = ['dup.sh', 'override-guard.sh'];
const PLAIN_WRAPPERS = [
  'shipped-migrations.sh',
  'guard-replay.sh',
  'knip.sh',
  'deps.sh',
  'semgrep-rules.sh',
  'plist.sh',
  'typecheck.sh',
];

type Project = { root: string; state: string };

const git = (cwd: string, ...gitArguments: string[]): string =>
  execFileSync('git', gitArguments, { cwd, encoding: 'utf8', stdio: 'pipe' });

const writeFile = (root: string, relativePath: string, body: string): void => {
  const absolutePath = join(root, relativePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, body);
};

const writeExecutable = (root: string, relativePath: string, body: string): void => {
  writeFile(root, relativePath, body);
  chmodSync(join(root, relativePath), 0o755);
};

const logFor = (project: Project, wrapper: string): string => join(project.state, `${wrapper}.log`);

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);

  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const buildProject = (committedFiles: Record<string, string>): Project => {
  const root = makeTemporaryDirectory('kiko-medium-deleted-');
  const state = makeTemporaryDirectory('kiko-medium-deleted-state-');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  cpSync(join(CHECKS, 'medium.sh'), join(root, 'scripts/checks/medium.sh'));
  cpSync(join(CHECKS, '_lib.sh'), join(root, 'scripts/checks/_lib.sh'));

  for (const wrapper of FILE_ARGUMENT_WRAPPERS) {
    writeExecutable(
      root,
      `scripts/checks/${wrapper}`,
      [
        '#!/usr/bin/env bash',
        `printf '%s\\n' "$@" >> "${logFor({ root, state }, wrapper)}"`,
        'for path in "$@"; do',
        '  [ -e "$path" ] || { echo "ENOENT lstat $path" >&2; exit 2; }',
        'done',
        '',
      ].join('\n'),
    );
  }

  for (const wrapper of PLAIN_WRAPPERS) {
    writeExecutable(
      root,
      `scripts/checks/${wrapper}`,
      ['#!/usr/bin/env bash', `echo ran >> "${logFor({ root, state }, wrapper)}"`, ''].join('\n'),
    );
  }

  for (const [relativePath, body] of Object.entries(committedFiles)) {
    writeFile(root, relativePath, body);
  }

  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');

  return { root, state };
};

const runMedium = (project: Project): { code: number | null; stderr: string } => {
  const result = spawnSync('bash', [join(project.root, 'scripts/checks/medium.sh')], {
    cwd: project.root,
    env: { ...process.env, TMPDIR: project.state },
    encoding: 'utf8',
  });

  return { code: result.status, stderr: result.stderr };
};

const argumentsSeenBy = (project: Project, wrapper: string): string[] => {
  try {
    return readFileSync(logFor(project, wrapper), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

const ran = (project: Project, wrapper: string): boolean =>
  argumentsSeenBy(project, wrapper).length > 0;

describe('medium.sh changed-file list', () => {
  it('does not hand a deleted source file to the content-reading wrappers', () => {
    const project = buildProject({
      'src/gone.ts': 'export const gone = 1;\n',
      'src/kept.ts': 'export const kept = 1;\n',
    });
    execFileSync('rm', [join(project.root, 'src/gone.ts')]);
    writeFile(project.root, 'src/kept.ts', 'export const kept = 2;\n');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(argumentsSeenBy(project, 'dup.sh')).toEqual(['src/kept.ts']);
    expect(argumentsSeenBy(project, 'override-guard.sh')).toEqual(['src/kept.ts']);
  });

  it('still runs the project-wide checks when the only change is a deletion', () => {
    const project = buildProject({ 'src/gone.ts': 'export const gone = 1;\n' });
    execFileSync('rm', [join(project.root, 'src/gone.ts')]);

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(ran(project, 'dup.sh')).toBe(false);
    expect(ran(project, 'override-guard.sh')).toBe(false);
    // A deleted file can break an import elsewhere, so the session must not be silent.
    expect(ran(project, 'typecheck.sh')).toBe(true);
    expect(ran(project, 'knip.sh')).toBe(true);
    expect(ran(project, 'guard-replay.sh')).toBe(true);
    expect(ran(project, 'shipped-migrations.sh')).toBe(true);
  });

  it('hands a renamed file to the wrappers under its new path only', () => {
    const project = buildProject({ 'src/old.ts': 'export const moved = 1;\n' });
    // With rename detection off git lists the old path as deleted. medium.sh keeps it in the
    // trigger list (a deletion can break an import) and applies the existence test afterwards,
    // so the wrappers that read file contents get the new path only.
    git(project.root, 'config', 'diff.renames', 'false');
    git(project.root, 'mv', 'src/old.ts', 'src/new.ts');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(argumentsSeenBy(project, 'dup.sh')).toEqual(['src/new.ts']);
  });

  it('hands an untracked file whose name holds a quote to the wrappers', () => {
    const project = buildProject({ 'src/kept.ts': 'export const kept = 1;\n' });
    writeFile(project.root, 'src/we"ird.ts', 'export const weird = 1;\n');

    expect(runMedium(project)).toEqual({ code: 0, stderr: '' });
    expect(argumentsSeenBy(project, 'dup.sh')).toEqual(['src/we"ird.ts']);
    expect(argumentsSeenBy(project, 'override-guard.sh')).toEqual(['src/we"ird.ts']);
  });
});

// A Stop that fires again after the hook already blocked it (stop_hook_active) must not run the
// tier a second time: knip fails the same way on the same tree, and the session loops. Only a
// `Stop` event skips; SubagentStop blocks as before. The hook payload arrives on stdin as a file,
// the way dispatch.sh replays it, so the runs below hand over a file descriptor.
describe('medium.sh on a repeated Stop', () => {
  const ALL_WRAPPERS = [...FILE_ARGUMENT_WRAPPERS, ...PLAIN_WRAPPERS];

  // A session with one changed source file, so the tier is due, and a knip that fails.
  const buildBlockingProject = (): Project => {
    const project = buildProject({ 'src/kept.ts': 'export const kept = 1;\n' });
    writeFile(project.root, 'src/kept.ts', 'export const kept = 2;\n');
    writeExecutable(
      project.root,
      'scripts/checks/knip.sh',
      [
        '#!/usr/bin/env bash',
        `echo ran >> "${logFor(project, 'knip.sh')}"`,
        'echo "unused export" >&2',
        'exit 2',
        '',
      ].join('\n'),
    );

    return project;
  };

  const runWithPayloadFile = (
    project: Project,
    payload: string,
  ): { code: number | null; stderr: string } => {
    const payloadFile = join(project.state, 'payload.json');
    writeFileSync(payloadFile, payload);
    const descriptor = openSync(payloadFile, 'r');

    try {
      const result = spawnSync('bash', [join(project.root, 'scripts/checks/medium.sh')], {
        cwd: project.root,
        env: { ...process.env, TMPDIR: project.state },
        encoding: 'utf8',
        stdio: [descriptor, 'pipe', 'pipe'],
      });

      return { code: result.status, stderr: result.stderr };
    } finally {
      closeSync(descriptor);
    }
  };

  const hookPayload = (eventName: string, active: unknown): string =>
    JSON.stringify({ hook_event_name: eventName, stop_hook_active: active, cwd: '/somewhere' });

  it('exits 0 with a one-line note and runs no check on a Stop with stop_hook_active true', () => {
    const project = buildBlockingProject();

    const result = runWithPayloadFile(project, hookPayload('Stop', true));

    expect(result.code).toBe(0);
    expect(result.stderr).toBe(
      'medium tier: skipped on a repeated Stop (stop_hook_active); run npm run check:all before you commit\n',
    );
    expect(ALL_WRAPPERS.filter((wrapper) => ran(project, wrapper))).toEqual([]);
  });

  it('skips a repeated Stop on a tree changed since the block, and runs nothing again', () => {
    const project = buildBlockingProject();

    expect(runWithPayloadFile(project, hookPayload('Stop', false)).code).toBe(2);
    writeFile(project.root, 'src/kept.ts', 'export const kept = 3;\n');
    writeFile(project.root, 'src/added.ts', 'export const added = 1;\n');
    const repeated = runWithPayloadFile(project, hookPayload('Stop', true));

    expect(repeated.code).toBe(0);
    expect(repeated.stderr).toContain('skipped on a repeated Stop');
    expect(argumentsSeenBy(project, 'knip.sh')).toEqual(['ran']);
  });

  it.each([
    ['a first Stop (stop_hook_active false)', hookPayload('Stop', false)],
    ['a Stop with no stop_hook_active field', JSON.stringify({ hook_event_name: 'Stop' })],
    ['a Stop with stop_hook_active null', hookPayload('Stop', null)],
    ['a Stop with stop_hook_active the text "true"', hookPayload('Stop', 'true')],
    ['a SubagentStop with stop_hook_active true', hookPayload('SubagentStop', true)],
    ['a SubagentStop with stop_hook_active false', hookPayload('SubagentStop', false)],
    ['a payload with no event name', JSON.stringify({ stop_hook_active: true })],
    ['a malformed payload', '{"hook_event_name": "Stop", "stop_hook_active": tru'],
    ['an empty payload', ''],
    ['a payload that is not an object', '[1, 2]'],
  ])('still runs the tier and blocks on %s', (_label, payload) => {
    const project = buildBlockingProject();

    const result = runWithPayloadFile(project, payload);

    expect(result.code).toBe(2);
    expect(result.stderr).not.toContain('skipped on a repeated Stop');
    expect(ran(project, 'knip.sh')).toBe(true);
  });

  it('still runs the tier when stdin holds no payload (a manual run, a closed stdin)', () => {
    const project = buildBlockingProject();

    expect(runMedium(project).code).toBe(2);
    expect(ran(project, 'knip.sh')).toBe(true);
  });

  it('reads the payload from a file only, never from a pipe a caller may leave open', () => {
    const project = buildBlockingProject();
    const result = spawnSync('bash', [join(project.root, 'scripts/checks/medium.sh')], {
      cwd: project.root,
      env: { ...process.env, TMPDIR: project.state },
      encoding: 'utf8',
      input: hookPayload('Stop', true),
    });

    expect(result.status).toBe(2);
    expect(ran(project, 'knip.sh')).toBe(true);
  });
});

describe('dup.sh with a path that is not on disk', () => {
  const buildDupProject = (): Project => {
    const root = makeTemporaryDirectory('kiko-dup-missing-');
    const state = makeTemporaryDirectory('kiko-dup-missing-state-');
    cpSync(join(CHECKS, 'dup.sh'), join(root, 'scripts/checks/dup.sh'));
    cpSync(join(CHECKS, '_lib.sh'), join(root, 'scripts/checks/_lib.sh'));
    writeExecutable(
      root,
      'node_modules/.bin/jscpd',
      ['#!/usr/bin/env bash', `echo called >> "${join(state, 'jscpd.log')}"`, 'exit 0', ''].join(
        '\n',
      ),
    );
    writeFile(root, 'src/present.ts', 'export const present = 1;\n');

    return { root, state };
  };

  it('names the missing path and never calls jscpd', () => {
    const project = buildDupProject();
    const result = spawnSync(
      'bash',
      [join(project.root, 'scripts/checks/dup.sh'), 'src/present.ts', 'src/deleted.ts'],
      { cwd: project.root, env: { ...process.env, TMPDIR: project.state }, encoding: 'utf8' },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('src/deleted.ts');
    expect(result.stderr).not.toContain('duplicated code above the configured threshold');
    expect(argumentsSeenBy(project, 'jscpd')).toEqual([]);
  });
});
