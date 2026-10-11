import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
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
    // With rename detection off git lists the old path as deleted, the case only the
    // existence test covers.
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
