import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, execFileSync, spawnSync } from 'node:child_process';

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

const ensure = (directory: string, extra: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> =>
  spawnSync('bash', ['scripts/ensure-git-hooks.sh'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...environment(), ...extra },
  });

// A `git` ahead of the real one on PATH that fails every `--get` read with exit 3 (the status for
// an unreadable config file) and passes everything else through.
const gitFailingReads = (): NodeJS.ProcessEnv => {
  const tools = join(base, 'tools');
  const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

  mkdirSync(tools);
  writeFileSync(
    join(tools, 'git'),
    `#!/bin/sh\nfor word in "$@"; do [ "$word" = "--get" ] && exit 3; done\nexec ${realGit} "$@"\n`,
  );
  chmodSync(join(tools, 'git'), 0o755);

  return { PATH: `${tools}:${process.env.PATH}` };
};

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

  it('blocks with exit 2 when the write fails, and does not read as installed', () => {
    writeFileSync(join(root, '.git/config.lock'), '');

    const result = ensure(root);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: core.hooksPath could not be set');
    expect(git(root, 'config', '--local', '--get', 'core.hooksPath').status).toBe(1);
  });

  it('blocks with exit 2 when reading the setting fails with a status other than 1', () => {
    const result = ensure(root, gitFailingReads());

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: core.hooksPath could not be read');
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

// Invariant: only a value whose realpath is a githooks folder of this repository, set in its own
// common config file, may be rewritten to githooks. Every other value keeps the refusal.
describe('scripts/ensure-git-hooks.sh, a hooks path that names this repository githooks folder', () => {
  const makeFolder = (directory: string, name: string): string => {
    const folder = join(directory, name);

    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'pre-commit'), '#!/bin/sh\n');

    return folder;
  };

  const noticeLines = (result: SpawnSyncReturns<string>): string[] =>
    result.stderr.split('\n').filter((line) => line.includes('NOTICE'));

  const expectRepaired = (result: SpawnSyncReturns<string>, directory: string): void => {
    expect(result.status).toBe(0);
    expect(noticeLines(result)).toHaveLength(1);
    expect(result.stderr).not.toContain('CHECK FAILED');
    expect(hooksPath(directory)).toBe('githooks\n');
  };

  const expectRefused = (
    result: SpawnSyncReturns<string>,
    directory: string,
    value: string,
  ): void => {
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`CHECK FAILED: ${BLOCK_TITLE}`);
    expect(noticeLines(result)).toHaveLength(0);
    expect(hooksPath(directory)).toBe(`${value}\n`);
  };

  it('rewrites the absolute path of its own githooks folder to githooks, with one notice', () => {
    const own = makeFolder(realpathSync(root), 'githooks');
    mustGit(root, 'config', 'core.hooksPath', own);

    expectRepaired(ensure(root), root);
  });

  it('rewrites a symlinked spelling of its own githooks folder', () => {
    makeFolder(realpathSync(root), 'githooks');
    const alias = join(base, 'alias');
    symlinkSync(realpathSync(root), alias);
    mustGit(root, 'config', 'core.hooksPath', join(alias, 'githooks'));

    expectRepaired(ensure(root), root);
  });

  it.each(['githooks/', './githooks/', './githooks'])(
    'rewrites the relative spelling %s of its own githooks folder',
    (spelling) => {
      makeFolder(root, 'githooks');
      mustGit(root, 'config', 'core.hooksPath', spelling);

      expectRepaired(ensure(root), root);
    },
  );

  it('rewrites a home-relative spelling of its own githooks folder', () => {
    makeFolder(root, 'githooks');
    mustGit(root, 'config', 'core.hooksPath', '~/repository/githooks');

    expectRepaired(ensure(root, { HOME: realpathSync(base) }), root);
  });

  it('refuses a home-relative githooks folder that is not this repository', () => {
    makeFolder(realpathSync(base), 'elsewhere/githooks');
    mustGit(root, 'config', 'core.hooksPath', '~/elsewhere/githooks');

    expectRefused(ensure(root, { HOME: realpathSync(base) }), root, '~/elsewhere/githooks');
  });

  it('rewrites the main checkout githooks path set in the common config, from a linked worktree', () => {
    const own = makeFolder(realpathSync(root), 'githooks');
    mustGit(root, 'add', '-A');
    mustGit(root, 'commit', '-q', '-m', 'hooks');
    const linked = join(base, 'linked');
    mustGit(root, 'worktree', 'add', '-q', '-b', 'linked', linked);
    mustGit(root, 'config', 'core.hooksPath', own);

    const result = ensure(linked);

    expect(result.status).toBe(0);
    expect(noticeLines(result)).toHaveLength(1);
    expect(mustGit(root, 'config', '--file', join(root, '.git/config'), 'core.hooksPath')).toBe(
      'githooks\n',
    );
  });

  it('refuses the githooks folder of another repository and leaves the value', () => {
    const foreign = join(base, 'foreign');
    mkdirSync(foreign);
    mustGit(foreign, 'init', '-q', '-b', 'main');
    const foreignHooks = makeFolder(realpathSync(foreign), 'githooks');
    mustGit(root, 'config', 'core.hooksPath', foreignHooks);

    expectRefused(ensure(root), root, foreignHooks);
  });

  it('refuses the own githooks path when only the global config sets it', () => {
    const own = makeFolder(realpathSync(root), 'githooks');
    writeFileSync(join(home, '.gitconfig'), `[core]\n\thooksPath = ${own}\n`);

    const result = ensure(root);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`CHECK FAILED: ${BLOCK_TITLE}`);
    expect(noticeLines(result)).toHaveLength(0);
    expect(git(root, 'config', '--local', '--get', 'core.hooksPath').status).toBe(1);
    expect(readFileSync(join(home, '.gitconfig'), 'utf8')).toContain(own);
  });

  it('refuses the own githooks path when only config.worktree sets it', () => {
    const own = makeFolder(realpathSync(root), 'githooks');
    mustGit(root, 'config', 'extensions.worktreeConfig', 'true');
    mustGit(root, 'config', '--worktree', 'core.hooksPath', own);

    const result = ensure(root);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`CHECK FAILED: ${BLOCK_TITLE}`);
    expect(noticeLines(result)).toHaveLength(0);
    expect(hooksPath(root)).toBe(`${own}\n`);
    expect(git(root, 'config', '--local', '--get', 'core.hooksPath').status).toBe(1);
  });

  it.each(['.husky', 'scripts'])(
    'refuses %s, another folder of this repository, by absolute path',
    (name) => {
      const other = makeFolder(realpathSync(root), name);
      mustGit(root, 'config', 'core.hooksPath', other);

      expectRefused(ensure(root), root, other);
    },
  );

  it('refuses a githooks path that does not exist', () => {
    const missing = join(realpathSync(root), 'githooks');
    mustGit(root, 'config', 'core.hooksPath', missing);

    expectRefused(ensure(root), root, missing);
  });
});

describe('package.json postinstall', () => {
  it('ends with the hooks step', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    expect(manifest.scripts.postinstall).toMatch(/ && bash scripts\/ensure-git-hooks\.sh$/);
  });
});
