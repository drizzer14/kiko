import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { type SpawnSyncReturns, execFileSync, spawnSync } from 'node:child_process';

import { isolatedGitEnvironment } from './test-support/isolated-git';

// githooks/pre-commit and githooks/pre-merge-commit run scripts/checks/commit-typecheck.sh, which
// typechecks a temporary copy of the STAGED index. Every case here runs the real hook inside a
// throwaway git repository with an isolated git environment, so nothing here touches the real
// repository's config. A fake node_modules/.bin/tsc fails when any `.ts` file of the snapshot it
// runs in contains BROKEN, and records where it ran and with which arguments.
const ROOT = join(__dirname, '..');
const BLOCK_TITLE = 'TypeScript on the staged commit (pre-commit)';
const HOOK_NAMES = ['pre-commit', 'pre-merge-commit'];
const BROKEN = 'export const broken: number = BROKEN;\n';
const GOOD = 'export const good = 2;\n';

const FAKE_TSC = [
  '#!/usr/bin/env bash',
  '{',
  '  pwd -P',
  '  readlink node_modules || echo none',
  '  printf "%s\\n" "$@"',
  '} > "$KIKO_FAKE_TSC_MARKER"',
  'if [ -n "$KIKO_FAKE_TSC_TERM" ]; then',
  '  kill -TERM "$PPID"',
  '  exit 0',
  'fi',
  'matches="$(grep -rn --include=\'*.ts\' BROKEN . || true)"',
  '[ -n "$matches" ] || exit 0',
  'printf "%s\\n" "$matches" | while IFS=: read -r file line rest; do',
  '  printf "%s(%s,1): error TS9999: BROKEN is not allowed\\n" "$(printf %s "$file" | cut -c3-)" "$line"',
  'done',
  'exit 2',
].join('\n');

type Repository = {
  base: string;
  root: string;
  home: string;
  temporary: string;
  marker: string;
};

type GitResult = SpawnSyncReturns<string>;

const environmentOf = (repository: Repository, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
  isolatedGitEnvironment(repository.home, {
    TMPDIR: repository.temporary,
    KIKO_FAKE_TSC_MARKER: repository.marker,
    ...extra,
  });

const git = (repository: Repository, ...gitArguments: string[]): GitResult =>
  spawnSync('git', gitArguments, {
    cwd: repository.root,
    encoding: 'utf8',
    env: environmentOf(repository),
  });

const mustGit = (repository: Repository, ...gitArguments: string[]): string => {
  const result = git(repository, ...gitArguments);

  if (result.status !== 0) {
    throw new Error(`git ${gitArguments.join(' ')} failed: ${result.stderr}`);
  }

  return result.stdout;
};

const writeFile = (repository: Repository, relativePath: string, body: string): void => {
  const target = join(repository.root, relativePath);

  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, body);
};

const stage = (repository: Repository, files: Record<string, string>): void => {
  for (const [relativePath, body] of Object.entries(files)) {
    writeFile(repository, relativePath, body);
  }
  mustGit(repository, 'add', '--', ...Object.keys(files));
};

const commit = (repository: Repository, ...extra: string[]): GitResult =>
  git(repository, 'commit', '-q', '-m', 'change', ...extra);

// A setup commit that must not reach the hook, so the marker and the temporary folder stay clean.
const commitUnchecked = (repository: Repository, files: Record<string, string>): void => {
  stage(repository, files);
  mustGit(repository, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'setup');
};

const head = (repository: Repository): string => mustGit(repository, 'rev-parse', 'HEAD').trim();

const snapshotLeftovers = (repository: Repository): string[] =>
  readdirSync(repository.temporary).filter((name) => name.startsWith('kiko-typecheck'));

// The fake tsc's record of its last run: where it ran, what node_modules was, its arguments.
const recordedRun = (
  repository: Repository,
): { directory: string; modules: string; argv: string[] } => {
  const [directory, modules, ...argv] = readFileSync(repository.marker, 'utf8').trim().split('\n');

  return { directory, modules, argv };
};

// An initialized repository that holds the hooks, the script, and the fake tsc, with nothing
// committed and the hook switched off.
const initializeRepository = (): Repository => {
  const base = mkdtempSync(join(tmpdir(), 'commit-typecheck-'));
  const repository: Repository = {
    base,
    root: join(base, 'repository'),
    home: join(base, 'home'),
    temporary: join(base, 'temporary'),
    marker: join(base, 'marker'),
  };

  for (const directory of [repository.root, repository.home, repository.temporary]) {
    mkdirSync(directory, { recursive: true });
  }
  mustGit(repository, 'init', '-q', '-b', 'main');
  mustGit(repository, 'config', 'user.name', 'Hook Test');
  mustGit(repository, 'config', 'user.email', 'hook-test@example.invalid');
  mustGit(repository, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(repository.root, 'githooks'));
  mkdirSync(join(repository.root, 'scripts/checks'), { recursive: true });

  for (const hook of HOOK_NAMES) {
    copyFileSync(join(ROOT, 'githooks', hook), join(repository.root, 'githooks', hook));
    chmodSync(join(repository.root, 'githooks', hook), 0o755);
  }

  for (const script of ['commit-typecheck.sh', '_lib.sh']) {
    copyFileSync(
      join(ROOT, 'scripts/checks', script),
      join(repository.root, 'scripts/checks', script),
    );
  }
  mkdirSync(join(repository.root, 'node_modules/.bin'), { recursive: true });
  writeFileSync(join(repository.root, 'node_modules/.bin/tsc'), FAKE_TSC);
  chmodSync(join(repository.root, 'node_modules/.bin/tsc'), 0o755);
  writeFile(repository, '.gitignore', 'node_modules/\n');

  return repository;
};

const createRepository = (): Repository => {
  const repository = initializeRepository();

  writeFile(repository, 'src/a.ts', 'export const a = 1;\n');
  writeFile(repository, 'docs/readme.md', '# readme\n');
  mustGit(repository, 'add', '-A');
  mustGit(repository, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'initial');
  mustGit(repository, 'config', 'core.hooksPath', 'githooks');

  return repository;
};

const expectBlocked = (result: GitResult, repository: Repository, before: string): void => {
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(`CHECK FAILED: ${BLOCK_TITLE}`);
  expect(head(repository)).toBe(before);
};

let repository: Repository;

beforeEach(() => {
  repository = createRepository();
});

afterEach(() => {
  rmSync(repository.base, { recursive: true, force: true });
});

describe('githooks and scripts/checks/commit-typecheck.sh', () => {
  it('commits silently and advances HEAD when the staged files typecheck', () => {
    const before = head(repository);
    stage(repository, { 'src/a.ts': GOOD });

    const result = commit(repository);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(head(repository)).not.toBe(before);
    expect(existsSync(repository.marker)).toBe(true);
  });

  it('checks the index: a broken unstaged edit does not fail a good staged commit', () => {
    stage(repository, { 'src/a.ts': GOOD });
    writeFile(repository, 'src/a.ts', BROKEN);

    const result = commit(repository);

    expect(result.status).toBe(0);
    expect(mustGit(repository, 'show', 'HEAD:src/a.ts')).toBe(GOOD);
  });

  it('blocks a broken staged file even when the fix is only unstaged, and names file and line', () => {
    const before = head(repository);
    stage(repository, { 'src/a.ts': BROKEN });
    writeFile(repository, 'src/a.ts', GOOD);

    const result = commit(repository);

    expectBlocked(result, repository, before);
    expect(result.stderr).toContain('src/a.ts(1,1): error TS9999');
    expect(result.stderr).toContain('--no-verify');
  });

  it('ignores an untracked broken file when the staged commit is good', () => {
    stage(repository, { 'src/a.ts': GOOD });
    writeFile(repository, 'src/wip.ts', BROKEN);

    const result = commit(repository);

    expect(result.status).toBe(0);
  });

  it('checks the files `git commit -a` stages from the working tree', () => {
    const before = head(repository);
    writeFile(repository, 'src/a.ts', BROKEN);

    const result = commit(repository, '-a');

    expectBlocked(result, repository, before);
    expect(result.stderr).toContain('src/a.ts(1,1)');
  });

  it('ignores an untracked broken file under `git commit -a`', () => {
    writeFile(repository, 'src/a.ts', GOOD);
    writeFile(repository, 'src/b.ts', BROKEN);

    const result = commit(repository, '-a');

    expect(result.status).toBe(0);
  });

  it('checks the files a commit with paths stages', () => {
    const before = head(repository);
    writeFile(repository, 'src/a.ts', BROKEN);

    const result = commit(repository, '--', 'src/a.ts');

    expectBlocked(result, repository, before);
  });

  it('checks an amended commit', () => {
    const before = head(repository);
    stage(repository, { 'src/a.ts': BROKEN });

    const result = commit(repository, '--amend');

    expectBlocked(result, repository, before);
  });

  it('commits a docs-only change silently without running tsc', () => {
    stage(repository, { 'docs/readme.md': '# changed\n' });

    const result = commit(repository);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(existsSync(repository.marker)).toBe(false);
  });

  it('runs tsc when the name filter itself fails, instead of reading that as no match', () => {
    const toolFolder = join(repository.base, 'broken-grep');
    mkdirSync(toolFolder);
    writeFileSync(join(toolFolder, 'grep'), '#!/bin/sh\nexit 2\n');
    chmodSync(join(toolFolder, 'grep'), 0o755);
    stage(repository, { 'docs/readme.md': '# changed\n' });

    const result = spawnSync('git', ['commit', '-q', '-m', 'change'], {
      cwd: repository.root,
      encoding: 'utf8',
      env: environmentOf(repository, { PATH: `${toolFolder}:${process.env.PATH}` }),
    });

    expect(result.status).toBe(0);
    expect(existsSync(repository.marker)).toBe(true);
  });

  it.each(['x.ts', 'x.tsx', 'x.js', 'x.jsx', 'x.mjs', 'x.cjs', 'x.json', 'sub/dir/x.d.ts'])(
    'runs tsc when the staged diff holds %s',
    (file) => {
      stage(repository, { [file]: '{}\n' });

      const result = commit(repository);

      expect(result.status).toBe(0);
      expect(existsSync(repository.marker)).toBe(true);
    },
  );

  it.each(['x.md', 'x.png', 'x.sql', 'ios/Podfile', 'x.json.bak', 'tsfile', 'ts'])(
    'skips tsc when the staged diff holds only %s',
    (file) => {
      stage(repository, { [file]: 'text\n' });

      const result = commit(repository);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(existsSync(repository.marker)).toBe(false);
    },
  );

  it('runs tsc when a source file is renamed to a non-source name', () => {
    mustGit(repository, 'mv', 'src/a.ts', 'src/a.txt');

    const result = commit(repository);

    expect(result.status).toBe(0);
    expect(existsSync(repository.marker)).toBe(true);
  });

  it('runs tsc when a source file is deleted', () => {
    mustGit(repository, 'rm', '-q', 'src/a.ts');

    const result = commit(repository);

    expect(result.status).toBe(0);
    expect(existsSync(repository.marker)).toBe(true);
  });

  it('runs tsc for a non-ASCII source file name', () => {
    stage(repository, { 'src/файл.ts': GOOD });

    const result = commit(repository);

    expect(result.status).toBe(0);
    expect(existsSync(repository.marker)).toBe(true);
  });

  it('checks the very first commit, whose HEAD does not exist yet', () => {
    const fresh = initializeRepository();
    writeFile(fresh, 'src/first.ts', BROKEN);
    mustGit(fresh, 'add', '-A');
    mustGit(fresh, 'config', 'core.hooksPath', 'githooks');

    const result = git(fresh, 'commit', '-q', '-m', 'first');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('src/first.ts(1,1): error TS9999');
    expect(git(fresh, 'rev-parse', '-q', '--verify', 'HEAD').status).not.toBe(0);
    rmSync(fresh.base, { recursive: true, force: true });
  });

  describe('merge commits and other operations', () => {
    const diverge = (featureFile: string): string => {
      mustGit(repository, 'switch', '-q', '-c', 'feature');
      commitUnchecked(repository, { 'src/b.ts': featureFile });
      const featureTip = head(repository);

      mustGit(repository, 'switch', '-q', 'main');
      commitUnchecked(repository, { 'src/c.ts': GOOD });

      return featureTip;
    };

    it('blocks a clean `git merge --no-ff` whose merged files do not typecheck', () => {
      diverge(BROKEN);
      const before = head(repository);

      const result = git(repository, 'merge', '--no-ff', '-q', '-m', 'merge', 'feature');

      expectBlocked(result, repository, before);
      expect(result.stderr).toContain('src/b.ts(1,1): error TS9999');
    });

    it('lets a clean merge of files that typecheck through', () => {
      diverge(GOOD);
      const before = head(repository);

      const result = git(repository, 'merge', '--no-ff', '-q', '-m', 'merge', 'feature');
      const parents = mustGit(repository, 'rev-list', '--parents', '-n', '1', 'HEAD');

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(head(repository)).not.toBe(before);
      expect(parents.trim().split(' ')).toHaveLength(3);
    });

    it('runs no hook for a fast-forward, which creates no commit', () => {
      mustGit(repository, 'switch', '-q', '-c', 'feature');
      commitUnchecked(repository, { 'src/b.ts': BROKEN });
      const featureTip = head(repository);
      mustGit(repository, 'switch', '-q', 'main');

      const result = git(repository, 'merge', '--ff-only', '-q', 'feature');

      expect(result.status).toBe(0);
      expect(head(repository)).toBe(featureTip);
      expect(existsSync(repository.marker)).toBe(false);
    });

    it('runs no hook for a cherry-pick', () => {
      const featureTip = diverge(BROKEN);

      const result = git(repository, 'cherry-pick', featureTip);

      expect(result.status).toBe(0);
      expect(existsSync(repository.marker)).toBe(false);
    });

    it('runs no hook for a rebase', () => {
      diverge(BROKEN);
      mustGit(repository, 'switch', '-q', 'feature');

      const result = git(repository, 'rebase', '-q', 'main');

      expect(result.status).toBe(0);
      expect(existsSync(repository.marker)).toBe(false);
    });
  });

  it('lets the user bypass the hook with --no-verify', () => {
    stage(repository, { 'src/a.ts': BROKEN });

    const result = commit(repository, '--no-verify');

    expect(result.status).toBe(0);
    expect(existsSync(repository.marker)).toBe(false);
  });

  describe('a missing tool', () => {
    it('blocks a source commit when tsc is not installed, and says to run npm ci', () => {
      const before = head(repository);
      rmSync(join(repository.root, 'node_modules'), { recursive: true });
      stage(repository, { 'src/a.ts': GOOD });

      const result = commit(repository);

      expectBlocked(result, repository, before);
      expect(result.stderr).toContain('npm ci');
    });

    it('lets a docs-only commit through when tsc is not installed', () => {
      rmSync(join(repository.root, 'node_modules'), { recursive: true });
      stage(repository, { 'docs/readme.md': '# changed\n' });

      const result = commit(repository);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('blocks a source commit when node is not on PATH', () => {
      const toolFolder = join(repository.base, 'tools');
      const tools = ['git', 'mktemp', 'rm', 'ln', 'mkdir', 'grep', 'tr', 'cat', 'dirname', 'bash'];
      mkdirSync(toolFolder);

      for (const tool of tools) {
        const found = ['/usr/bin', '/bin'].map((folder) => join(folder, tool)).find(existsSync);

        if (found !== undefined) {
          symlinkSync(found, join(toolFolder, tool));
        }
      }
      stage(repository, { 'src/a.ts': GOOD });

      const result = spawnSync('/bin/bash', ['scripts/checks/commit-typecheck.sh'], {
        cwd: repository.root,
        encoding: 'utf8',
        env: environmentOf(repository, { PATH: toolFolder }),
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain(`CHECK FAILED: ${BLOCK_TITLE}`);
      expect(result.stderr).toContain('node is not on PATH');
      expect(existsSync(repository.marker)).toBe(false);
    });
  });

  describe('the snapshot', () => {
    it('runs tsc inside the temporary folder, never inside the repository', () => {
      stage(repository, { 'src/a.ts': GOOD });
      commit(repository);

      const { directory, modules, argv } = recordedRun(repository);

      // The fake tsc prints its physical directory, which is already gone when this reads it.
      expect(directory.startsWith(realpathSync(repository.temporary) + sep)).toBe(true);
      expect(directory.startsWith(realpathSync(repository.root))).toBe(false);
      expect(modules).toBe(join(realpathSync(repository.root), 'node_modules'));
      expect(argv).toEqual(['--noEmit', '-p', '.']);
    });

    it('is gone after a pass', () => {
      stage(repository, { 'src/a.ts': GOOD });

      commit(repository);

      expect(snapshotLeftovers(repository)).toEqual([]);
    });

    it('is gone after a failure', () => {
      stage(repository, { 'src/a.ts': BROKEN });

      commit(repository);

      expect(snapshotLeftovers(repository)).toEqual([]);
    });

    it('is gone after the script is terminated, and the exit status is 143', () => {
      stage(repository, { 'src/a.ts': GOOD });

      const result = spawnSync('bash', ['scripts/checks/commit-typecheck.sh'], {
        cwd: repository.root,
        encoding: 'utf8',
        env: environmentOf(repository, { KIKO_FAKE_TSC_TERM: '1' }),
      });

      expect(result.status).toBe(143);
      expect(snapshotLeftovers(repository)).toEqual([]);
    });
  });
});

describe('the tracked hooks', () => {
  it.each(HOOK_NAMES)('githooks/%s is a two-line executable that runs the typecheck', (hook) => {
    const file = join(ROOT, 'githooks', hook);

    expect(statSync(file).mode & 0o111).toBe(0o111);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toEqual([
      '#!/usr/bin/env bash',
      'exec bash scripts/checks/commit-typecheck.sh',
    ]);
  });

  it('git tracks both hooks with mode 100755', () => {
    const listing = execFileSync(
      'git',
      ['ls-files', '-s', 'githooks/pre-commit', 'githooks/pre-merge-commit'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const modes = listing
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split(' ')[0]);

    expect(modes).toEqual(['100755', '100755']);
  });
});
