import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { createTemporaryDirectory } from './temporary-directory';
import { type DecideOptions, decideAll } from './kill-guard-decide';

export type FakeRepository = {
  scratch: string;
  main: string;
  worktree: string;
  outside: string;
  folders: [label: string, options: DecideOptions][];
};

// A fake repository for the kill-guard rows that judge one command from the folders a session
// can stand in: `main` (its own .git folder), `worktree` (a linked worktree of main, a .git
// file) and `outside` (no repository at all). Every command is judged, never run, with `main` as
// the guard's test-only `projectRoot`.
export const createFakeRepository = (prefix: string): FakeRepository => {
  const scratch = createTemporaryDirectory(prefix);
  const main = join(scratch, 'main');
  const worktree = join(scratch, 'worktree');
  const outside = join(scratch, 'outside');

  for (const folder of [
    'main/.git/worktrees/worktree',
    'main/src',
    'main/docs/harness',
    'main/docs/superpowers/plans',
    'worktree/src',
    'worktree/docs/harness',
    'worktree/docs/superpowers/plans',
    'outside',
  ]) {
    mkdirSync(join(scratch, folder), { recursive: true });
  }
  writeFileSync(join(main, '.git/worktrees/worktree/commondir'), '../..\n');
  writeFileSync(join(worktree, '.git'), `gitdir: ${join(main, '.git/worktrees/worktree')}\n`);

  return {
    scratch,
    main,
    worktree,
    outside,
    folders: [
      ['a linked worktree', { projectRoot: main, cwd: worktree }],
      ['the main checkout', { projectRoot: main, cwd: main }],
      ['a folder outside the project', { projectRoot: main, cwd: outside }],
    ],
  };
};

// The verdicts for one command, one per folder of the repository, in `folders` order.
export const decideInEachFolder = (
  repository: FakeRepository,
  command: string | ((folder: string) => string),
): string[] =>
  decideAll(
    repository.folders.map(([, options]) => [
      typeof command === 'string' ? command : command(String(options.cwd)),
      options,
    ]),
  );
