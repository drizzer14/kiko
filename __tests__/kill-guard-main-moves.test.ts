import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { decide, decideAll } from './test-support/kill-guard-decide';

// The main checkout moves only through `bash scripts/ff-main.sh <sha>`, after a queued verify
// passed on the commit. A git command that moves the branch `main` any other way is the finding
// `mainMove`: a `reset` that names a commit, `checkout -B main`, `switch -C main`, and the commands
// that write the ref (`update-ref`, `branch -m|-f|-d`, `fetch`/`push` into `main`, `symbolic-ref`,
// `worktree add -B`). It is reached as the other main-checkout findings are: the payload cwd, `-C`,
// `--git-dir`, `--work-tree`, `GIT_DIR=`, `cd`/`pushd`, a `-c` string, `eval`, a variable the same
// command assigns, a heredoc body a shell runs, and a script file a shell runs. A heredoc body that
// no shell runs (a commit message) is text, so a move written there stays allowed.
//
// Every text here is judged, never run: `decide` is called in node as a parser only. The fake main
// checkout is passed as both `mainCheckoutPath` and `projectRoot`.
const GUARD_HOOK = join(__dirname, '../scripts/checks/kill-guard.sh');
const REAL_MAIN_CHECKOUT = '/Users/drizzer14/Developer/Projects/pff-ios';

const SCRATCH = createTemporaryDirectory('guard-main-moves-');
afterAll(removeTemporaryDirectories);

const MAIN = join(SCRATCH, 'main');
const PLAIN = join(SCRATCH, 'plain');
const LINKED = join(SCRATCH, 'linked');
const OTHER = join(SCRATCH, 'other');

// A linked worktree whose HEAD file already names `main` (an earlier session put it there), and
// one on a detached commit.
const ON_MAIN = join(SCRATCH, 'on-main');
const DETACHED = join(SCRATCH, 'detached');

for (const folder of [
  'main/.git/worktrees/linked',
  'main/.git/worktrees/on-main',
  'main/.git/worktrees/detached',
  'main/src',
  'linked/src',
  'on-main/src',
  'detached/src',
  'other/.git',
  'other/src',
  'plain',
]) {
  mkdirSync(join(SCRATCH, folder), { recursive: true });
}
writeFileSync(join(MAIN, 'HANDOFF.md'), 'notes\n');

const linkWorktree = (worktree: string, name: string, head: string): void => {
  writeFileSync(join(MAIN, '.git/worktrees', name, 'commondir'), '../..\n');
  writeFileSync(join(MAIN, '.git/worktrees', name, 'HEAD'), `${head}\n`);
  writeFileSync(join(worktree, '.git'), `gitdir: ${join(MAIN, '.git/worktrees', name)}\n`);
};

linkWorktree(LINKED, 'linked', 'ref: refs/heads/feat');
linkWorktree(ON_MAIN, 'on-main', 'ref: refs/heads/main');
linkWorktree(DETACHED, 'detached', '1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b');

const optionsIn = (directory: string): Record<string, unknown> => ({
  cwd: directory,
  mainCheckoutPath: MAIN,
  projectRoot: MAIN,
});

const COMMIT = '1a2b3c4';

// `update-ref HEAD` follows the symbolic HEAD, so it writes the branch the work tree is on.
const HEAD_UPDATE_REFS: string[] = [
  `update-ref HEAD ${COMMIT}`,
  'update-ref -d HEAD',
  `update-ref -m message HEAD ${COMMIT}`,
  `update-ref head ${COMMIT}`,
];

// The git subcommand text (after `git `) that moves `main` wherever it runs against the checkout.
const MOVING_SUBCOMMANDS: string[] = [
  `reset --hard ${COMMIT}`,
  'reset --soft HEAD~1',
  `reset --mixed ${COMMIT}`,
  `reset --merge ${COMMIT}`,
  `reset --keep ${COMMIT}`,
  `reset ${COMMIT}`,
  `reset -q --hard ${COMMIT}`,
  'reset HEAD~1',
  'reset ORIG_HEAD',
  'reset --hard @{u}',
  'reset --hard origin/main',
  'reset --hard HEAD~0',
  `reset ${COMMIT} --`,
  `checkout -B main ${COMMIT}`,
  `checkout -fB main ${COMMIT}`,
  `checkout -Bmain ${COMMIT}`,
  `checkout -B MAIN ${COMMIT}`,
  `switch -C main ${COMMIT}`,
  `switch --force-create main ${COMMIT}`,
  `update-ref refs/heads/main ${COMMIT}`,
  'update-ref -d refs/heads/main',
  `update-ref -m message refs/heads/main ${COMMIT}`,
  `update-ref --no-deref refs/heads/main ${COMMIT}`,
  `update-ref main ${COMMIT}`,
  `update-ref heads/main ${COMMIT}`,
  `update-ref refs/heads/Main ${COMMIT}`,
  ...HEAD_UPDATE_REFS,
  'branch -m main old',
  'branch -M main old',
  'branch -m old main',
  'branch -M x main',
  'branch --move main old',
  `branch -f main ${COMMIT}`,
  `branch --force main ${COMMIT}`,
  'branch -C x main',
  'branch -d main',
  'branch -D main',
  'branch --delete main',
  'fetch -u . x:main',
  'fetch -fu . x:main',
  'fetch . +x:main',
  'fetch --update-head-ok . x:refs/heads/main',
  'fetch --depth 1 . x:main',
  "fetch -u . 'refs/heads/*:refs/heads/*'",
  "fetch -u . '+refs/heads/*:refs/heads/*'",
  "fetch -u . 'refs/*:refs/*'",
  "fetch -u . 'refs/heads/m*:refs/heads/m*'",
  "fetch -u --refmap='refs/heads/*:refs/heads/*' . main",
  'fetch -u --refmap=refs/heads/x:refs/heads/main . x',
  'fetch -u --refmap refs/heads/x:refs/heads/main . x',
  "fetch -u --refmap 'refs/heads/*:refs/heads/*' origin main",
  'fetch --refmap=refs/heads/x:main . x',
  'fetch --refmap= --refmap=refs/heads/x:refs/heads/main . x',
  'push -f . x:main',
  'push . x:refs/heads/main',
  'push --force . +x:main',
  "push . 'refs/heads/*:refs/heads/*'",
  'symbolic-ref refs/heads/main refs/heads/feat',
  'symbolic-ref HEAD refs/heads/feat',
  'worktree add -B main ../z x',
];

// The twin of each moving form: it leaves `main` where it is, so the guard lets it run.
const STAYING_SUBCOMMANDS: string[] = [
  'reset',
  'reset --hard',
  'reset --hard HEAD',
  'reset --hard @',
  'reset --hard head',
  'reset HEAD',
  'reset -q',
  'reset -- HANDOFF.md',
  `reset ${COMMIT} -- HANDOFF.md`,
  'reset -p',
  `reset -p ${COMMIT}`,
  'reset --patch',
  'reset --pathspec-from-file=paths.txt',
  'reset -h',
  'reset --help',
  `checkout -B feat ${COMMIT}`,
  `switch -C feat ${COMMIT}`,
  'checkout feat',
  'checkout -b feat',
  'checkout -- HANDOFF.md',
  'switch feat',
  `update-ref refs/heads/x ${COMMIT}`,
  'update-ref -d refs/heads/x',
  `update-ref refs/kiko/floor ${COMMIT}`,
  `update-ref refs/heads/mainline ${COMMIT}`,
  `update-ref refs/heads/feat/main ${COMMIT}`,
  `update-ref refs/remotes/origin/main ${COMMIT}`,
  `update-ref $ref ${COMMIT}`,
  'update-ref -h',
  `update-ref --no-deref HEAD ${COMMIT}`,
  'update-ref --no-deref -d HEAD',
  'branch',
  'branch -vv',
  'branch -f x main',
  `branch -f feat ${COMMIT}`,
  'branch -c main x',
  'branch --merged main',
  'branch --contains main',
  'branch --list main',
  'branch -m old new',
  'branch -d feat',
  'fetch',
  'fetch origin',
  'fetch origin main',
  "fetch -u . 'refs/heads/*:refs/remotes/x/*'",
  "fetch -u . 'refs/heads/*:refs/heads/feature/*'",
  "fetch -u --refmap='refs/heads/*:refs/remotes/x/*' . main",
  "fetch -u --refmap 'refs/heads/*:refs/remotes/x/*' origin main",
  'fetch --refmap= origin main',
  'fetch --refmap= . x:feat',
  'fetch -u --refmap=refs/heads/x:refs/heads/feat . x',
  'fetch --depth 1 origin main',
  'fetch -j 4 origin',
  'push origin x:main',
  "push origin 'refs/heads/*:refs/heads/*'",
  'push origin main',
  'push . x:feat',
  'symbolic-ref --short HEAD',
  'symbolic-ref HEAD',
  'symbolic-ref -q HEAD',
  `worktree add ../z ${COMMIT}`,
  `worktree add -B feat ../z ${COMMIT}`,
  'worktree list',
  'commit -m x',
  'commit --amend --no-edit',
  'log --oneline -3',
  'status',
  'diff',
  'add -A',
  'rev-parse HEAD',
];

type Context = [label: string, directory: string, wrap: (subcommand: string) => string];

// Every way a command comes to aim at the main checkout.
const MAIN_CONTEXTS: Context[] = [
  ['cwd is the main checkout', MAIN, (subcommand) => `git ${subcommand}`],
  ['cwd is a folder in the main checkout', `${MAIN}/src`, (subcommand) => `git ${subcommand}`],
  ['cwd has a trailing slash', `${MAIN}/`, (subcommand) => `git ${subcommand}`],
  ['-C names it from a plain folder', PLAIN, (subcommand) => `git -C ${MAIN} ${subcommand}`],
  ['-C names it with a trailing slash', PLAIN, (subcommand) => `git -C ${MAIN}/ ${subcommand}`],
  ['-C . from the main checkout', MAIN, (subcommand) => `git -C . ${subcommand}`],
  ['-C src from the main checkout', MAIN, (subcommand) => `git -C src ${subcommand}`],
  ['-C .. from a folder in it', `${MAIN}/src`, (subcommand) => `git -C .. ${subcommand}`],
  [
    '-C beside a -c option',
    PLAIN,
    (subcommand) => `git -c core.pager=cat -C ${MAIN} ${subcommand}`,
  ],
  ['--git-dir', PLAIN, (subcommand) => `git --git-dir=${MAIN}/.git ${subcommand}`],
  ['--work-tree', PLAIN, (subcommand) => `git --work-tree ${MAIN} ${subcommand}`],
  ['GIT_DIR=', PLAIN, (subcommand) => `GIT_DIR=${MAIN}/.git git ${subcommand}`],
  ['env GIT_WORK_TREE=', PLAIN, (subcommand) => `env GIT_WORK_TREE=${MAIN} git ${subcommand}`],
  ['cd main &&', PLAIN, (subcommand) => `cd ${MAIN} && git ${subcommand}`],
  ['cd main ;', PLAIN, (subcommand) => `cd ${MAIN}; git status; git ${subcommand}`],
  ['cd in a subshell', PLAIN, (subcommand) => `(cd ${MAIN} && git ${subcommand})`],
  ['pushd main', PLAIN, (subcommand) => `pushd ${MAIN} >/dev/null && git ${subcommand}`],
  ['cd into a folder of main', MAIN, (subcommand) => `cd src && git ${subcommand}`],
  ['sudo', MAIN, (subcommand) => `sudo git ${subcommand}`],
  ['after &&', MAIN, (subcommand) => `true && git ${subcommand}`],
  ['inside $(...)', PLAIN, (subcommand) => `echo "$(git -C ${MAIN} ${subcommand})"`],
  ['inside sh -c', PLAIN, (subcommand) => `sh -c "git -C ${MAIN} ${subcommand}"`],
  ['inside bash -c after cd', PLAIN, (subcommand) => `cd ${MAIN} && bash -c 'git ${subcommand}'`],
  ['inside eval', PLAIN, (subcommand) => `eval "git -C ${MAIN} ${subcommand}"`],
  ['a variable the command assigns', PLAIN, (subcommand) => `d=${MAIN}; git -C $d ${subcommand}`],
  [
    'an exported variable',
    PLAIN,
    (subcommand) => `export d=${MAIN} && git -C "\${d}" ${subcommand}`,
  ],
];

// `reset <operand>` moves main only when the operand is a commit; an existing path in the work tree
// is a pathspec, so the verdict depends on the work tree and these run where it is known.
const PATH_OPERAND_CONTEXTS: Context[] = [MAIN_CONTEXTS[0], MAIN_CONTEXTS[3], MAIN_CONTEXTS[13]];

describe('kill-guard: a move of main the verify gate never saw (parser only)', () => {
  it.each(MAIN_CONTEXTS)('denies every moving form: %s', (_label, directory, wrap) => {
    const kinds = decideAll(
      MOVING_SUBCOMMANDS.map((subcommand) => [wrap(subcommand), optionsIn(directory)]),
    );

    expect(MOVING_SUBCOMMANDS.filter((_subcommand, index) => kinds[index] !== 'mainMove')).toEqual(
      [],
    );
  });

  it.each(MAIN_CONTEXTS)('allows every staying form: %s', (_label, directory, wrap) => {
    const kinds = decideAll(
      STAYING_SUBCOMMANDS.map((subcommand) => [wrap(subcommand), optionsIn(directory)]),
    );

    expect(STAYING_SUBCOMMANDS.filter((_subcommand, index) => kinds[index] !== 'allow')).toEqual(
      [],
    );
  });

  it.each(PATH_OPERAND_CONTEXTS)(
    'reads a lone reset operand as a path when it exists in the work tree: %s',
    (_label, directory, wrap) => {
      const options = optionsIn(directory);

      expect(decide(wrap('reset HANDOFF.md'), options)).toBe('allow');
      expect(decide(wrap('reset src'), options)).toBe('allow');
      expect(decide(wrap('reset -- NEWFILE.md'), options)).toBe('allow');
    },
  );

  it.each(PATH_OPERAND_CONTEXTS)(
    'reads a lone reset operand that is no path in the work tree as a commit: %s',
    (_label, directory, wrap) => {
      expect(decide(wrap('reset NEWFILE.md'), optionsIn(directory))).toBe('mainMove');
    },
  );

  it('denies a move of the branch main', () => {
    expect(decide('git checkout -B main 1a2b3c4', optionsIn(MAIN))).toBe('mainMove');
    expect(decide('git update-ref refs/heads/main 1a2b3c4', optionsIn(MAIN))).toBe('mainMove');
  });

  it('allows a move of the other branches', () => {
    expect(decide('git checkout -B feat 1a2b3c4', optionsIn(MAIN))).toBe('allow');
    expect(decide('git update-ref refs/heads/feat 1a2b3c4', optionsIn(MAIN))).toBe('allow');
  });

  it('denies a move that follows an allowed command in the same line', () => {
    expect(decide(`git status && git reset --hard ${COMMIT}`, optionsIn(MAIN))).toBe('mainMove');
    expect(
      decide(`cd ${MAIN} && git commit -m x && git reset --soft HEAD~1`, optionsIn(PLAIN)),
    ).toBe('mainMove');
  });
});

// The refs are shared by every worktree of a repository, so a command that names the ref `main`
// moves it from a linked worktree too; a `reset`, `symbolic-ref HEAD` or `update-ref HEAD` moves
// only the branch of the work tree it runs in.
const isBranchBound = (subcommand: string): boolean =>
  subcommand.startsWith('reset') ||
  subcommand === 'symbolic-ref HEAD refs/heads/feat' ||
  HEAD_UPDATE_REFS.includes(subcommand);

const REF_MOVING_SUBCOMMANDS = MOVING_SUBCOMMANDS.filter(
  (subcommand) => !isBranchBound(subcommand),
);
const BRANCH_BOUND_SUBCOMMANDS = MOVING_SUBCOMMANDS.filter(isBranchBound);

type Placement = [label: string, options: Record<string, unknown>, wrap: Context[2]];

const bare = (subcommand: string): string => `git ${subcommand}`;
const withoutDirectory: Record<string, unknown> = { mainCheckoutPath: MAIN, projectRoot: MAIN };

// Where a ref-name command reaches this repository: a linked worktree or a folder in one, or a
// directory the text names inside one.
const NAMED_PLACEMENTS: Placement[] = [
  ['cwd is a linked worktree', optionsIn(LINKED), bare],
  ['cwd is a folder in a linked worktree', optionsIn(`${LINKED}/src`), bare],
  ['cwd is a folder in the main checkout', optionsIn(`${MAIN}/src`), bare],
  ['-C names a linked worktree', optionsIn(PLAIN), (s) => `git -C ${LINKED} ${s}`],
  ['-C names a folder in a linked worktree', optionsIn(OTHER), (s) => `git -C ${LINKED}/src ${s}`],
  ['cd into a linked worktree', optionsIn(PLAIN), (s) => `cd ${LINKED} && git ${s}`],
  ['inside sh -c from a linked worktree', optionsIn(LINKED), (s) => `sh -c "git ${s}"`],
];

// No directory, or one the text cannot resolve on its own reading: the command fails closed, even
// when it assigns the variable a folder comes from (a loop variable, `+=` and `read` are not
// followed), and even when the value it was given names an unrelated repository.
const UNRESOLVED_PLACEMENTS: Placement[] = [
  ['the payload has no cwd', withoutDirectory, bare],
  ['a variable the command assigns', optionsIn(PLAIN), (s) => `d=${LINKED}; git -C $d ${s}`],
  [
    'a variable the command assigns, naming an unrelated repository',
    optionsIn(LINKED),
    (s) => `d=${OTHER}; git -C $d ${s}`,
  ],
  [
    'a variable the loop reassigns',
    optionsIn(PLAIN),
    (s) => `d=${PLAIN}; for d in ${LINKED}; do git -C "$d" ${s}; done`,
  ],
  [
    'a variable the command appends to',
    optionsIn(PLAIN),
    (s) => `d=${PLAIN}; d+=/..${LINKED}; git -C "$d" ${s}`,
  ],
  ['-C holds a variable', optionsIn(PLAIN), (s) => `git -C "$X" ${s}`],
  ['-C holds a variable in an unrelated repository', optionsIn(OTHER), (s) => `git -C $X ${s}`],
  ['--git-dir holds a variable', optionsIn(PLAIN), (s) => `git --git-dir="$X/.git" ${s}`],
  ['GIT_DIR holds a variable', optionsIn(PLAIN), (s) => `GIT_DIR=$X git ${s}`],
  ['cd holds a variable', optionsIn(OTHER), (s) => `cd "$X" && git ${s}`],
  ['no cwd and -C holds a variable', withoutDirectory, (s) => `git -C "$X" ${s}`],
];

const REPOSITORY_PLACEMENTS: Placement[] = [...NAMED_PLACEMENTS, ...UNRESOLVED_PLACEMENTS];

// A repository that shares nothing with this one, or no repository: its own `main` is its own.
const FOREIGN_PLACEMENTS: Placement[] = [
  ['cwd is an unrelated repository', optionsIn(OTHER), bare],
  ['cwd is a folder in an unrelated repository', optionsIn(`${OTHER}/src`), bare],
  ['cwd is a plain folder', optionsIn(PLAIN), bare],
  ['-C names an unrelated repository', optionsIn(LINKED), (s) => `git -C ${OTHER} ${s}`],
  ['-C names a plain folder', optionsIn(MAIN), (s) => `git -C ${PLAIN} ${s}`],
  ['cd into an unrelated repository', optionsIn(LINKED), (s) => `cd ${OTHER} && git ${s}`],
  ['cd into a plain folder in a subshell', optionsIn(MAIN), (s) => `(cd ${PLAIN} && git ${s})`],
  [
    '--git-dir names another repository',
    optionsIn(LINKED),
    (s) => `git --git-dir=${OTHER}/.git ${s}`,
  ],
  ['inside sh -c in an unrelated repository', optionsIn(OTHER), (s) => `sh -c "git ${s}"`],
  [
    'no cwd and --git-dir names an unrelated repository',
    withoutDirectory,
    (s) => `git --git-dir=${OTHER}/.git ${s}`,
  ],
  [
    'no cwd and GIT_DIR names an unrelated repository',
    withoutDirectory,
    (s) => `GIT_DIR=${OTHER}/.git git ${s}`,
  ],
  [
    'no cwd and --git-dir names an unrelated repository beside -c',
    withoutDirectory,
    (s) => `git -c core.pager=cat --git-dir ${OTHER}/.git ${s}`,
  ],
  ['no cwd and -C names an unrelated repository', withoutDirectory, (s) => `git -C ${OTHER} ${s}`],
  ['no cwd and -C names a plain folder', withoutDirectory, (s) => `git -C ${PLAIN} ${s}`],
];

// A git directory the text names decides the repository a branch-bound command moves, so an
// unrelated one with no cwd is no target (the FOREIGN rows), while this repository's own git
// directory, a work tree or cwd inside it, and a git directory the text cannot name still are.
const GIT_DIRECTORY_OF_THIS_REPOSITORY: Placement[] = [
  [
    'no cwd and --git-dir names this repository',
    withoutDirectory,
    (s) => `git --git-dir=${MAIN}/.git ${s}`,
  ],
  [
    'no cwd and GIT_DIR names this repository',
    withoutDirectory,
    (s) => `GIT_DIR=${MAIN}/.git git ${s}`,
  ],
  [
    'no cwd and --git-dir names a worktree of this repository',
    withoutDirectory,
    (s) => `git --git-dir=${MAIN}/.git/worktrees/linked ${s}`,
  ],
  [
    'no cwd and --git-dir names this repository with a trailing slash',
    withoutDirectory,
    (s) => `git --git-dir=${MAIN}/.git/ ${s}`,
  ],
  ['no cwd and --git-dir holds a variable', withoutDirectory, (s) => `git --git-dir="$X" ${s}`],
  ['no cwd and GIT_DIR holds a variable', withoutDirectory, (s) => `GIT_DIR=$X git ${s}`],
  ['no cwd and --git-dir is relative', withoutDirectory, (s) => `git --git-dir=.git ${s}`],
  [
    'no cwd and --work-tree holds a variable',
    withoutDirectory,
    (s) => `git --git-dir=${OTHER}/.git --work-tree="$X" ${s}`,
  ],
  [
    'no cwd and --work-tree names the main checkout',
    withoutDirectory,
    (s) => `git --git-dir=${OTHER}/.git --work-tree=${MAIN} ${s}`,
  ],
  [
    'no cwd and GIT_WORK_TREE holds a variable',
    withoutDirectory,
    (s) => `GIT_DIR=${OTHER}/.git GIT_WORK_TREE=$X git ${s}`,
  ],
  [
    'cwd is the main checkout and --git-dir names an unrelated repository',
    optionsIn(MAIN),
    (s) => `git --git-dir=${OTHER}/.git ${s}`,
  ],
  [
    'cwd is a folder in the main checkout and GIT_DIR names an unrelated repository',
    optionsIn(`${MAIN}/src`),
    (s) => `GIT_DIR=${OTHER}/.git git ${s}`,
  ],
];

describe('kill-guard: a ref-name move of main from any place in this repository', () => {
  it.each(REPOSITORY_PLACEMENTS)('denies every ref-name form: %s', (_label, options, wrap) => {
    const kinds = decideAll(REF_MOVING_SUBCOMMANDS.map((s) => [wrap(s), options]));

    expect(REF_MOVING_SUBCOMMANDS.filter((_s, index) => kinds[index] !== 'mainMove')).toEqual([]);
  });

  it.each(REPOSITORY_PLACEMENTS)('allows every staying form: %s', (_label, options, wrap) => {
    const kinds = decideAll(STAYING_SUBCOMMANDS.map((s) => [wrap(s), options]));

    expect(STAYING_SUBCOMMANDS.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
  });

  it.each(FOREIGN_PLACEMENTS)('allows every moving form: %s', (_label, options, wrap) => {
    const kinds = decideAll(MOVING_SUBCOMMANDS.map((s) => [wrap(s), options]));

    expect(MOVING_SUBCOMMANDS.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
  });

  it.each(FOREIGN_PLACEMENTS)('allows every staying form: %s', (_label, options, wrap) => {
    const kinds = decideAll(STAYING_SUBCOMMANDS.map((s) => [wrap(s), options]));

    expect(STAYING_SUBCOMMANDS.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
  });

  it.each(UNRESOLVED_PLACEMENTS)(
    'denies a reset, symbolic-ref HEAD or update-ref HEAD that names a commit: %s',
    (_label, options, wrap) => {
      const kinds = decideAll(BRANCH_BOUND_SUBCOMMANDS.map((s) => [wrap(s), options]));

      expect(BRANCH_BOUND_SUBCOMMANDS.filter((_s, index) => kinds[index] !== 'mainMove')).toEqual(
        [],
      );
    },
  );

  it.each([...UNRESOLVED_PLACEMENTS, ...GIT_DIRECTORY_OF_THIS_REPOSITORY])(
    'allows a reset that moves nothing and a HEAD that stays: %s',
    (_label, options, wrap) => {
      const stays = [
        'reset',
        'reset --hard',
        'reset --hard HEAD',
        'reset -- HANDOFF.md',
        'reset -p',
        'symbolic-ref HEAD',
        `update-ref --no-deref HEAD ${COMMIT}`,
      ];
      const kinds = decideAll(stays.map((s) => [wrap(s), options]));

      expect(stays.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
    },
  );

  it.each(GIT_DIRECTORY_OF_THIS_REPOSITORY)(
    'denies a reset, symbolic-ref HEAD or update-ref HEAD that names a commit: %s',
    (_label, options, wrap) => {
      const kinds = decideAll(BRANCH_BOUND_SUBCOMMANDS.map((s) => [wrap(s), options]));

      expect(BRANCH_BOUND_SUBCOMMANDS.filter((_s, index) => kinds[index] !== 'mainMove')).toEqual(
        [],
      );
    },
  );

  it.each(NAMED_PLACEMENTS.filter(([label]) => label !== 'cwd is a folder in the main checkout'))(
    'lets a linked worktree move its own branch and its own HEAD: %s',
    (_label, options, wrap) => {
      const kinds = decideAll(BRANCH_BOUND_SUBCOMMANDS.map((s) => [wrap(s), options]));

      expect(BRANCH_BOUND_SUBCOMMANDS.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
    },
  );

  it('still denies the main checkout from a linked worktree', () => {
    expect(decide(`git -C ${MAIN} reset --hard ${COMMIT}`, optionsIn(LINKED))).toBe('mainMove');
    expect(decide(`cd ${MAIN} && git reset --soft HEAD~1`, optionsIn(LINKED))).toBe('mainMove');
  });
});

const MAIN_CHECKOUT_PLACEMENT: Placement = ['cwd is the main checkout', optionsIn(MAIN), bare];
const REPOSITORY_AND_MAIN_PLACEMENTS: Placement[] = [
  MAIN_CHECKOUT_PLACEMENT,
  ...REPOSITORY_PLACEMENTS,
];

const GLOB_INTO_HEADS = '+refs/heads/*:refs/heads/*';
const GLOB_INTO_REMOTES = '+refs/heads/*:refs/remotes/origin/*';

// A fetch refspec set on the command line with `-c` is the refspec of the remote, so a plain
// `fetch -u <remote>` writes whatever its destination names.
const CONFIGURED_FETCH_MOVES: string[] = [
  `-c 'remote.origin.fetch=${GLOB_INTO_HEADS}' fetch -u origin`,
  '-c remote.origin.fetch=refs/heads/x:refs/heads/main fetch -u origin',
  '-c remote.origin.fetch=refs/heads/x:main fetch -u origin',
  `-c 'remote.origin.fetch=${GLOB_INTO_HEADS}' fetch -u origin main`,
  `-c core.pager=cat -c 'remote.origin.fetch=${GLOB_INTO_HEADS}' fetch -u origin`,
  `-c 'remote.upstream.fetch=${GLOB_INTO_HEADS}' fetch -u upstream`,
  "-c 'remote.origin.fetch=+refs/*:refs/*' fetch -u origin",
  `-c 'remote.origin.fetch=${GLOB_INTO_HEADS}' fetch --refmap= origin feat`,
  '--config-env=remote.origin.fetch=SPEC fetch -u origin',
  '-c core.pager=cat --config-env=remote.origin.fetch=SPEC fetch -u origin',
];

const CONFIGURED_FETCH_STAYS: string[] = [
  `-c 'remote.origin.fetch=${GLOB_INTO_REMOTES}' fetch origin`,
  `-c 'remote.origin.fetch=${GLOB_INTO_REMOTES}' fetch -u origin`,
  `-c 'remote.origin.fetch=${GLOB_INTO_REMOTES}' fetch -u origin main`,
  '-c remote.origin.fetch=refs/heads/x:refs/heads/feat fetch -u origin',
  "-c 'remote.origin.fetch=+refs/heads/*:refs/heads/feature/*' fetch -u origin",
  '-c remote.origin.url=/tmp/x fetch origin',
  `-c 'remote.origin.push=${GLOB_INTO_HEADS}' fetch -u origin`,
  '-c core.pager=cat fetch -u origin',
  '--config-env=core.pager=PAGER fetch origin',
  '--config-env=remote.origin.url=URL fetch -u origin',
];

// A command that sets the configuration through the environment cannot be wrapped as a `git`
// argument, so each is a whole command.
const CONFIGURED_FETCH_ENVIRONMENT_MOVES: string[] = [
  `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.fetch GIT_CONFIG_VALUE_0='${GLOB_INTO_HEADS}' git fetch -u origin`,
  `env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.fetch GIT_CONFIG_VALUE_0='${GLOB_INTO_HEADS}' git fetch -u origin`,
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.fetch GIT_CONFIG_VALUE_0=$SPEC git fetch -u origin',
  `GIT_CONFIG_PARAMETERS="'remote.origin.fetch=${GLOB_INTO_HEADS}'" git fetch -u origin`,
];

const CONFIGURED_FETCH_ENVIRONMENT_STAYS: string[] = [
  `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.fetch GIT_CONFIG_VALUE_0='${GLOB_INTO_REMOTES}' git fetch -u origin`,
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=$PAGER git fetch -u origin',
  `GIT_CONFIG_PARAMETERS="'remote.origin.fetch=${GLOB_INTO_REMOTES}'" git fetch -u origin`,
];

const withoutWrapper = ([, , wrap]: Placement): boolean => wrap === bare;

describe('kill-guard: a fetch refspec set with -c writes the ref main', () => {
  it.each(REPOSITORY_AND_MAIN_PLACEMENTS)(
    'denies every moving form: %s',
    (_label, options, wrap) => {
      const kinds = decideAll(CONFIGURED_FETCH_MOVES.map((s) => [wrap(s), options]));

      expect(CONFIGURED_FETCH_MOVES.filter((_s, index) => kinds[index] !== 'mainMove')).toEqual([]);
    },
  );

  it.each([...REPOSITORY_AND_MAIN_PLACEMENTS, ...FOREIGN_PLACEMENTS])(
    'allows every form that writes elsewhere: %s',
    (_label, options, wrap) => {
      const kinds = decideAll(CONFIGURED_FETCH_STAYS.map((s) => [wrap(s), options]));

      expect(CONFIGURED_FETCH_STAYS.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
    },
  );

  it.each(FOREIGN_PLACEMENTS)(
    'allows every moving form in a repository that shares nothing: %s',
    (_label, options, wrap) => {
      const kinds = decideAll(CONFIGURED_FETCH_MOVES.map((s) => [wrap(s), options]));

      expect(CONFIGURED_FETCH_MOVES.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
    },
  );

  it.each(REPOSITORY_AND_MAIN_PLACEMENTS.filter(withoutWrapper))(
    'denies a refspec set through the environment: %s',
    (_label, options) => {
      const kinds = decideAll(CONFIGURED_FETCH_ENVIRONMENT_MOVES.map((s) => [s, options]));

      expect(
        CONFIGURED_FETCH_ENVIRONMENT_MOVES.filter((_s, index) => kinds[index] !== 'mainMove'),
      ).toEqual([]);
    },
  );

  it.each([...REPOSITORY_AND_MAIN_PLACEMENTS, ...FOREIGN_PLACEMENTS].filter(withoutWrapper))(
    'allows an environment setting that writes elsewhere: %s',
    (_label, options) => {
      const kinds = decideAll(CONFIGURED_FETCH_ENVIRONMENT_STAYS.map((s) => [s, options]));

      expect(
        CONFIGURED_FETCH_ENVIRONMENT_STAYS.filter((_s, index) => kinds[index] !== 'allow'),
      ).toEqual([]);
    },
  );

  it.each(FOREIGN_PLACEMENTS.filter(withoutWrapper))(
    'allows an environment setting in a repository that shares nothing: %s',
    (_label, options) => {
      const kinds = decideAll(CONFIGURED_FETCH_ENVIRONMENT_MOVES.map((s) => [s, options]));

      expect(
        CONFIGURED_FETCH_ENVIRONMENT_MOVES.filter((_s, index) => kinds[index] !== 'allow'),
      ).toEqual([]);
    },
  );
});

// These attach a linked worktree to `main` (or write `HEAD` to it), after which a `reset` in that
// worktree moves `main` itself.
const WORKTREE_ONTO_MAIN: string[] = [
  'symbolic-ref HEAD refs/heads/main',
  'symbolic-ref HEAD main',
  'symbolic-ref HEAD heads/main',
  'checkout --ignore-other-worktrees main',
  'checkout -f --ignore-other-worktrees main',
  'switch --ignore-other-worktrees main',
  'worktree add -f ../z main',
  'worktree add --force ../z main',
  'worktree add -f ../main',
  'worktree add --force ../main',
];

const WORKTREE_STAYS_OFF_MAIN: string[] = [
  'symbolic-ref HEAD refs/heads/feat',
  'symbolic-ref --short HEAD',
  'checkout --ignore-other-worktrees feat',
  'switch --ignore-other-worktrees feat',
  'checkout main',
  'switch main',
  `worktree add ../z main`,
  `worktree add -f ../z ${COMMIT}`,
  'worktree add --force ../z feat',
  'worktree add -f -b feat ../z main',
  'worktree add -f ../main -b feat',
];

describe('kill-guard: a worktree put onto main, or HEAD written to it', () => {
  it.each(REPOSITORY_AND_MAIN_PLACEMENTS)('denies every form: %s', (_label, options, wrap) => {
    const kinds = decideAll(WORKTREE_ONTO_MAIN.map((s) => [wrap(s), options]));

    expect(WORKTREE_ONTO_MAIN.filter((_s, index) => kinds[index] !== 'mainMove')).toEqual([]);
  });

  it.each([
    ...NAMED_PLACEMENTS.filter(([label]) => label !== 'cwd is a folder in the main checkout'),
    ...FOREIGN_PLACEMENTS,
  ])('allows a worktree that stays off main: %s', (_label, options, wrap) => {
    const kinds = decideAll(WORKTREE_STAYS_OFF_MAIN.map((s) => [wrap(s), options]));

    expect(WORKTREE_STAYS_OFF_MAIN.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
  });

  it.each(FOREIGN_PLACEMENTS)(
    'allows every form in a repository that shares nothing: %s',
    (_label, options, wrap) => {
      const kinds = decideAll(WORKTREE_ONTO_MAIN.map((s) => [wrap(s), options]));

      expect(WORKTREE_ONTO_MAIN.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
    },
  );

  // A git directory the text names decides which repository `symbolic-ref HEAD` writes; the main
  // checkout as cwd with another repository's git directory still counts as the main checkout.
  it.each([
    ['--git-dir names another repository', (s: string) => `git --git-dir=${OTHER}/.git ${s}`],
    ['GIT_DIR names another repository', (s: string) => `GIT_DIR=${OTHER}/.git git ${s}`],
  ])('keeps the verdict of HEAD written from the main checkout: %s', (_label, wrap) => {
    for (const target of ['refs/heads/main', 'refs/heads/feat']) {
      expect(decide(wrap(`symbolic-ref HEAD ${target}`), optionsIn(MAIN))).toBe('mainMove');
    }
  });
});

const ON_MAIN_PLACEMENTS: Placement[] = [
  ['cwd is a worktree whose HEAD names main', optionsIn(ON_MAIN), bare],
  ['cwd is a folder in it', optionsIn(`${ON_MAIN}/src`), bare],
  ['-C names it', optionsIn(PLAIN), (s) => `git -C ${ON_MAIN} ${s}`],
  ['cd into it', optionsIn(PLAIN), (s) => `cd ${ON_MAIN} && git ${s}`],
];

const OWN_BRANCH_PLACEMENTS: Placement[] = [
  ['cwd is a worktree on its own branch', optionsIn(LINKED), bare],
  ['cwd is a worktree on a detached commit', optionsIn(DETACHED), bare],
  ['cwd is a folder in a detached worktree', optionsIn(`${DETACHED}/src`), bare],
  ['-C names a detached worktree', optionsIn(PLAIN), (s) => `git -C ${DETACHED} ${s}`],
];

describe('kill-guard: a branch-bound move in a worktree whose HEAD already names main', () => {
  it.each(ON_MAIN_PLACEMENTS)('denies the moving forms: %s', (_label, options, wrap) => {
    const kinds = decideAll(BRANCH_BOUND_SUBCOMMANDS.map((s) => [wrap(s), options]));

    expect(BRANCH_BOUND_SUBCOMMANDS.filter((_s, index) => kinds[index] !== 'mainMove')).toEqual([]);
  });

  it.each(ON_MAIN_PLACEMENTS)('allows the forms that move nothing: %s', (_label, options, wrap) => {
    const stays = [
      'reset',
      'reset --hard',
      'reset -- HANDOFF.md',
      'reset -p',
      'symbolic-ref HEAD',
      `update-ref --no-deref HEAD ${COMMIT}`,
    ];
    const kinds = decideAll(stays.map((s) => [wrap(s), options]));

    expect(stays.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
  });

  it.each(OWN_BRANCH_PLACEMENTS)(
    'allows a worktree on its own branch: %s',
    (_label, options, wrap) => {
      const kinds = decideAll(BRANCH_BOUND_SUBCOMMANDS.map((s) => [wrap(s), options]));

      expect(BRANCH_BOUND_SUBCOMMANDS.filter((_s, index) => kinds[index] !== 'allow')).toEqual([]);
    },
  );
});

const BODY_LINES: string[] = [
  `git -C ${MAIN} reset --hard ${COMMIT}`,
  `git -C ${MAIN} update-ref refs/heads/main ${COMMIT}`,
  `cd ${MAIN} && git checkout -B main ${COMMIT}`,
  `git -C ${MAIN} switch -C main ${COMMIT}`,
];

const STAYING_BODY_LINES: string[] = [
  `git -C ${MAIN} reset --hard`,
  `git -C ${MAIN} update-ref refs/heads/x ${COMMIT}`,
  `cd ${MAIN} && git checkout -B feat ${COMMIT}`,
  `git -C ${MAIN} commit -m x`,
];

// A heredoc body that a shell runs is shell text, judged in full.
const RUN_BODY_TEMPLATES: ((line: string) => string)[] = [
  (line) => `bash <<'EOF'\n${line}\nEOF`,
  (line) => `eval "$(cat <<'EOF'\n${line}\nEOF\n)"`,
  (line) => `sh -c "$(cat <<'EOF'\n${line}\nEOF\n)"`,
  (line) => `source /dev/stdin <<'EOF'\n${line}\nEOF`,
  (line) => `$(cat <<'EOF'\n${line}\nEOF\n)`,
];

// A body that no shell runs is a note or a commit message, which may document a move.
const DATA_BODY_TEMPLATES: ((line: string) => string)[] = [
  (line) => `cat > f.md <<'EOF'\n${line}\nEOF`,
  (line) => `git commit -F - <<'EOF'\n${line}\nEOF`,
  (line) => `git commit -m "$(cat <<'EOF'\n${line}\nEOF\n)"`,
  (line) => `cat > f.md <<'EOF'\n- \`${line}\` denies\nEOF`,
];

const bodyKinds = (
  template: (line: string) => string,
  lines: string[],
  directory: string,
): string[] => decideAll(lines.map((line) => [template(line), optionsIn(directory)]));

describe('kill-guard: a move of main written in a heredoc body (parser only)', () => {
  it.each(RUN_BODY_TEMPLATES.map((wrap, index) => [index, wrap] as const))(
    'denies a line a shell runs from a body (template %i)',
    (_index, wrap) => {
      expect(bodyKinds(wrap, BODY_LINES, PLAIN)).toEqual(BODY_LINES.map(() => 'mainMove'));
    },
  );

  it.each(RUN_BODY_TEMPLATES.map((wrap, index) => [index, wrap] as const))(
    'allows a staying line a shell runs from a body (template %i)',
    (_index, wrap) => {
      expect(bodyKinds(wrap, STAYING_BODY_LINES, PLAIN)).toEqual(
        STAYING_BODY_LINES.map(() => 'allow'),
      );
    },
  );

  it.each(DATA_BODY_TEMPLATES.map((wrap, index) => [index, wrap] as const))(
    'allows a move written in a body no shell runs (template %i)',
    (_index, wrap) => {
      expect(bodyKinds(wrap, BODY_LINES, PLAIN)).toEqual(BODY_LINES.map(() => 'allow'));
      expect(bodyKinds(wrap, BODY_LINES, MAIN)).toEqual(BODY_LINES.map(() => 'allow'));
    },
  );
});

const scriptWith = (name: string, body: string, mode = 0o644): string => {
  const file = join(SCRATCH, name);
  writeFileSync(file, body);
  chmodSync(file, mode);

  return file;
};

const HOLDING_RESET = scriptWith(
  'holds-reset.sh',
  `#!/bin/bash\ngit -C ${MAIN} reset --hard ${COMMIT}\n`,
  0o755,
);
scriptWith('holds-reset-in-place.sh', `git reset --hard ${COMMIT}\n`);
scriptWith('holds-update-ref.sh', `cd ${MAIN}\ngit update-ref refs/heads/main ${COMMIT}\n`);
scriptWith('holds-checkout.sh', `git -C ${MAIN} checkout -B main ${COMMIT}\n`);
scriptWith('holds-switch.sh', `git -C ${MAIN} switch -C main ${COMMIT}\n`);
scriptWith('holds-heredoc.sh', `bash <<'EOF'\ngit -C ${MAIN} reset --hard ${COMMIT}\nEOF\n`);
scriptWith('holds-bare-reset.sh', `git -C ${MAIN} reset --hard\n`);
scriptWith('holds-other-ref.sh', `git -C ${MAIN} update-ref refs/heads/x ${COMMIT}\n`);
scriptWith(
  'holds-comment.sh',
  `# git -C ${MAIN} reset --hard ${COMMIT}\necho "git -C ${MAIN} reset"\n`,
);

scriptWith('holds-variable-folder.sh', `git -C "$1" update-ref refs/heads/main ${COMMIT}\n`);
scriptWith('holds-variable-reset.sh', `git -C "$1" reset --hard ${COMMIT}\n`);
scriptWith('holds-variable-other-ref.sh', `git -C "$1" update-ref refs/heads/x ${COMMIT}\n`);

describe('kill-guard script scan: a move of main (parser only)', () => {
  it.each([
    'bash holds-variable-folder.sh',
    'bash holds-variable-folder.sh /tmp',
    'bash holds-variable-reset.sh',
    'o=-c; bash holds-variable-folder.sh $o',
    'o=-c; bash holds-variable-reset.sh $o',
  ])('denies a script that moves main in a folder it is handed: %s', (command) => {
    expect(decide(command, optionsIn(SCRATCH))).toBe('mainMove');
  });

  it.each(['bash holds-variable-other-ref.sh', 'o=-c; bash holds-variable-other-ref.sh $o'])(
    'allows a script that moves another branch in a folder it is handed: %s',
    (command) => {
      expect(decide(command, optionsIn(SCRATCH))).toBe('allow');
    },
  );

  it.each([
    'bash holds-reset.sh',
    'sh holds-reset.sh',
    'source holds-reset.sh',
    '. holds-reset.sh',
    './holds-reset.sh',
    `bash ${HOLDING_RESET}`,
    'bash holds-update-ref.sh',
    'bash holds-checkout.sh',
    'bash holds-switch.sh',
    'bash holds-heredoc.sh',
    'sh -c "bash holds-reset.sh"',
    'true && bash holds-reset.sh',
  ])('denies a script that holds one: %s', (command) => {
    expect(decide(command, optionsIn(SCRATCH))).toBe('mainMove');
  });

  it('judges a script that runs where the main checkout is', () => {
    expect(decide(`bash ${SCRATCH}/holds-reset-in-place.sh`, optionsIn(MAIN))).toBe('mainMove');
  });

  it.each(['bash holds-bare-reset.sh', 'bash holds-other-ref.sh', 'bash holds-comment.sh'])(
    'allows a script that holds a staying form or a comment: %s',
    (command) => {
      expect(decide(command, optionsIn(SCRATCH))).toBe('allow');
    },
  );
});

const hookResult = (command: string, directory: string): string =>
  spawnSync('bash', [GUARD_HOOK], {
    input: JSON.stringify({ cwd: directory, tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, HOME: '/Users/drizzer14' },
  }).stdout;

describe('kill-guard: the block for a move of main', () => {
  it.each([
    [REAL_MAIN_CHECKOUT, `git reset --hard ${COMMIT}`],
    [REAL_MAIN_CHECKOUT, `git checkout -B main ${COMMIT}`],
    [__dirname, `git -C ${REAL_MAIN_CHECKOUT} update-ref refs/heads/main ${COMMIT}`],
  ])('names ff-main.sh as the way out: in %s, %s', (directory, command) => {
    const reason: string = JSON.parse(hookResult(command, directory)).hookSpecificOutput
      .permissionDecisionReason;

    for (const line of ['WHAT FAILED:', 'DETAILS:', 'WHY IT MATTERS:', 'HOW TO FIX:', 'DO NOT:']) {
      expect(reason).toContain(line);
    }
    expect(reason).toContain(`${command} (runs in ${REAL_MAIN_CHECKOUT})`);
    expect(reason).toContain('bash scripts/ff-main.sh <sha>');
    expect(reason).toContain('bash scripts/job-queue.sh verify');
    expect(reason).toContain('separate detached worktree');
  });

  it.each([
    [REAL_MAIN_CHECKOUT, 'git reset --hard'],
    [REAL_MAIN_CHECKOUT, 'git reset -- HANDOFF.md'],
    [REAL_MAIN_CHECKOUT, 'git update-ref refs/heads/x HEAD'],
  ])('lets a staying form through: in %s, %s', (directory, command) => {
    expect(hookResult(command, directory).trim()).toBe('');
  });
});
