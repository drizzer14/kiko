import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Tracked plus untracked-but-not-ignored files, kept only when on disk, so a check that resolves a
// name against the repository sees the same files existsSync gives: a new file resolves, a
// deleted one does not.
export const repositoryFiles = (root: string): string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((file) => file !== '' && existsSync(join(root, file)));
