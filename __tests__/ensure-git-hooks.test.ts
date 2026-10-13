import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { isolatedGitEnvironment } from './test-support/isolated-git';

// scripts/ensure-git-hooks.sh is the `postinstall` step that points core.hooksPath at the tracked
// githooks/ folder. It runs here as a COPY inside throwaway repositories with an isolated git
// environment, so the real repository's config is never read or written.
const ROOT = join(__dirname, '..');
const BLOCK_TITLE = 'core.hooksPath is not githooks';

let base: string;
let home: string;
let root: string;

const environment = (): NodeJS.ProcessEnv => isolatedGitEnvironment(home);

const git = (directory: string, ...gitArguments: string[]): SpawnSyncReturns<string> =>
  spawnSync('git', gitArguments, { cwd: directory, encoding: 'utf8', env: environment() });

const mustGit = (directory: string, ...gitArguments: string[]): string => {
  const result = git(directory, ...gitArguments);

  if (result.status !== 0) {
    throw new Error(`git ${gitArguments.join(' ')} failed: ${result.stderr}`);
  }

  return result.stdout;
};

const installScripts = (directory: string): void => {
  mkdirSync(join(directory, 'scripts/checks'), { recursive: true });
  copyFileSync(
    join(ROOT, 'scripts/ensure-git-hooks.sh'),
    join(directory, 'scripts/ensure-git-hooks.sh'),
  );
  copyFileSync(join(ROOT, 'scripts/checks/_lib.sh'), join(directory, 'scripts/checks/_lib.sh'));
};

const ensure = (directory: string): SpawnSyncReturns<string> =>
  spawnSync('bash', ['scripts/ensure-git-hooks.sh'], {
    cwd: directory,
    encoding: 'utf8',
    env: environment(),
  });

const hooksPath = (directory: string): string => git(directory, 'config', 'core.hooksPath').stdout;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ensure-git-hooks-'));
  home = join(base, 'home');
  root = join(base, 'repository');
  mkdirSync(home);
  mkdirSync(root);
  mustGit(root, 'init', '-q', '-b', 'main');
  mustGit(root, 'config', 'user.name', 'Hook Test');
  mustGit(root, 'config', 'user.email', 'hook-test@example.invalid');
  installScripts(root);
  mustGit(root, 'add', '-A');
  mustGit(root, 'commit', '-q', '-m', 'initial');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('scripts/ensure-git-hooks.sh', () => {
  it('sets core.hooksPath to githooks when it is unset, and says nothing', () => {
    expect(hooksPath(root)).toBe('');

    const result = ensure(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(hooksPath(root)).toBe('githooks\n');
  });

  it('does nothing when core.hooksPath is already githooks', () => {
    mustGit(root, 'config', 'core.hooksPath', 'githooks');

    const result = ensure(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(hooksPath(root)).toBe('githooks\n');
  });

  it('does not write a local value when the global config already says githooks', () => {
    writeFileSync(join(home, '.gitconfig'), '[core]\n\thooksPath = githooks\n');

    const result = ensure(root);

    expect(result.status).toBe(0);
    expect(git(root, 'config', '--local', '--get', 'core.hooksPath').status).toBe(1);
  });

  it('is idempotent', () => {
    ensure(root);

    const result = ensure(root);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(hooksPath(root)).toBe('githooks\n');
  });

  it('blocks with exit 2 and leaves another hooks path untouched', () => {
    mustGit(root, 'config', 'core.hooksPath', '.husky');

    const result = ensure(root);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`CHECK FAILED: ${BLOCK_TITLE}`);
    expect(result.stderr).toContain('.husky');
    expect(hooksPath(root)).toBe('.husky\n');
  });

  it('blocks on a hooks path that only the global config sets', () => {
    writeFileSync(join(home, '.gitconfig'), '[core]\n\thooksPath = /opt/shared-hooks\n');

    const result = ensure(root);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('/opt/shared-hooks');
    expect(git(root, 'config', '--local', '--get', 'core.hooksPath').status).toBe(1);
  });

  it('exits 0 silently outside a git repository', () => {
    const plain = join(base, 'plain');
    mkdirSync(plain);
    installScripts(plain);

    const result = ensure(plain);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('exits 0 silently for a copy without its own .git inside another repository', () => {
    const nested = join(root, 'scratch');
    mkdirSync(nested);
    installScripts(nested);

    const result = ensure(nested);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(git(root, 'config', '--local', '--get', 'core.hooksPath').status).toBe(1);
  });

  it('writes the setting to the common config when run from a linked worktree', () => {
    const linked = join(base, 'linked');
    mustGit(root, 'worktree', 'add', '-q', '-b', 'linked', linked);

    const result = ensure(linked);

    expect(result.status).toBe(0);
    expect(mustGit(root, 'config', '--file', join(root, '.git/config'), 'core.hooksPath')).toBe(
      'githooks\n',
    );
    expect(hooksPath(root)).toBe('githooks\n');
  });
});

describe('package.json postinstall', () => {
  it('ends with the hooks step', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    expect(manifest.scripts.postinstall).toMatch(/ && bash scripts\/ensure-git-hooks\.sh$/);
  });
});
