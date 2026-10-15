import {
  chmodSync,
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

// The script-content kill scan of scripts/checks/kill-guard.js: when a command runs a script file
// (`bash x.sh`, `source x.sh`, `. x.sh`, `./x.sh` with a shell shebang), the guard reads that file
// (one level, a regular file of at most 256 KiB) and denies a kill in it: a pkill, a killall, or a
// pattern or process-group kill. A script in a scratchpad outside the project is a place the
// pre-write guard never looks. scripts/job-queue.sh at the root of a worktree of this
// repository is exempt: its own group TERM is the one allowed group kill.
//
// Every text here is judged, never run: `decide` is called in node as a parser only. The scripts
// the rows name are written by this test into a scratch folder.
const GUARD = join(__dirname, '../scripts/checks/kill-guard.js');
const REPOSITORY_ROOT = join(__dirname, '..');

const DECIDE_SCRIPT = [
  'const { decide } = require(process.argv[1]);',
  'const cases = JSON.parse(process.argv[2]);',
  'const kinds = cases.map(([command, options]) => {',
  '  const finding = decide(command, options);',
  '  return finding === null ? "allow" : finding.kind;',
  '});',
  'process.stdout.write(JSON.stringify(kinds));',
].join('\n');

type Options = Record<string, unknown>;

// Judges every case in one node process; a case is `[command, options]`.
const decideAll = (cases: [string, Options][]): string[] =>
  JSON.parse(
    spawnSync('node', ['-e', DECIDE_SCRIPT, GUARD, JSON.stringify(cases)], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }).stdout,
  );

const decide = (command: string, options: Options = {}): string =>
  decideAll([[command, options]])[0];

const SCRATCH = createTemporaryDirectory('guard-scripts-');
afterAll(removeTemporaryDirectories);

const scriptWith = (name: string, body: string, mode = 0o644): string => {
  const file = join(SCRATCH, name);
  writeFileSync(file, body);
  chmodSync(file, mode);

  return file;
};

const KILLING = scriptWith('kills.sh', '#!/bin/bash\necho start\npkill node\n', 0o755);
scriptWith('kills-all.sh', 'killall Simulator\n');
scriptWith('kills-group.sh', 'kill -9 -1\n');
scriptWith('kills-zero.sh', 'sleep 1\nkill 0\n');
scriptWith('kills-pattern.sh', 'kill $(pgrep -f metro)\n');
scriptWith('kills-piped.sh', 'pgrep node | xargs kill -9\n');
scriptWith('kills-nested.sh', 'if true; then\n  bash -c "pkill -f cat"\nfi\n');
scriptWith('stash-then-kill.sh', 'git stash\npkill node\n');
scriptWith('kills-env.sh', '#!/usr/bin/env bash\npkill node\n', 0o755);
scriptWith('kills-zsh.sh', '#!/bin/zsh -f\npkill node\n', 0o755);
scriptWith('kills-plain.sh', 'pkill node\n', 0o755);
scriptWith('kills.py', '#!/usr/bin/env python3\nimport os\nos.killpg(1, 9)\n# pkill node\n', 0o755);
scriptWith('own-pid.sh', 'sleep 30 &\npid=$!\nkill "$pid"\nkill -0 "$pid"\n');
// The shapes a third-party script (superpowers' stop-server.sh) uses to stop only its own server.
scriptWith('own-argument.sh', '#!/bin/bash\nif kill -0 "$1" 2>/dev/null; then\n  kill "$1"\nfi\n');
scriptWith('own-empty-pid.sh', 'SERVER_PID=""\nkill -0 "$SERVER_PID"\nkill -s 0 "$SERVER_PID"\n');
scriptWith('null-signal.sh', 'kill -0 0\nkill -0 -1\nkill -s 0 -1\npgrep node | xargs kill -0\n');
// The kill builtin reads a later `-s SIG` or `-n N` after a signal 0, so these send SIGKILL to all.
// A word the shell expands before the builtin parses it can become that later option, and so can a
// later `-N` signal number.
const SIGNAL_ZERO_THEN_OPTION = [
  'kill -0 -s KILL -1',
  'kill -s 0 -s KILL -1',
  'kill -0 -n 9 -1',
  'kill -0 -sKILL -1',
  'kill -s 0 -n 9 -1',
  'kill -0 $(printf %s -sKILL) -1',
  'kill -0 `printf %s -sKILL` -1',
  'kill -0 $sig -1',
  'kill -0 ${sig} -1',
  'sig=-sKILL; kill -0 $sig -1',
  'kill -s 0 $sig -1',
  'kill -0 "$opt" -1',
  'kill -0 $1 -1',
  'kill -0 "$@"',
  'kill -0 $@',
  'kill -0 $*',
  'set -- -sKILL -1; kill -0 "$@"',
  'kill -0 -[s]KILL -1',
  'kill -0 -?KILL -1',
  'kill -0 *KILL -1',
  'kill -0 $(pgrep x)',
  'kill -0 {-sKILL,-1}',
  'kill -0 -{s,}KILL -1',
  'kill -0 -9 -1',
  'kill -0 -1 -1',
  'kill -s 0 -9 -1',
];
SIGNAL_ZERO_THEN_OPTION.forEach((command, index) => {
  scriptWith(`kills-after-null-signal-${index}.sh`, `${command}\n`);
});
// A script file is read for kills only, so a heredoc in it that names another bypass is text.
const MAIN_CHECKOUT = '/Users/drizzer14/Developer/Projects/pff-ios';
scriptWith('help-stash.sh', "cat <<'EOF'\ngit stash is banned here\nEOF\n");
scriptWith('help-no-verify.sh', "cat <<'EOF'\ngit commit --no-verify is banned\nEOF\n");
scriptWith('help-main-merge.sh', `cat <<'EOF'\ngit -C ${MAIN_CHECKOUT} merge x\nEOF\n`);
scriptWith('runs-heredoc-kill.sh', "bash <<'EOF'\npkill node\nEOF\n");
scriptWith('runs-heredoc-stash.sh', "bash <<'EOF'\ngit stash\nEOF\n");
scriptWith('comment.sh', '# pkill node\necho "pkill node"\n');
scriptWith(
  'other-findings.sh',
  'git stash\necho x > src/x.ts\ncat <<EOF\nbody\nEOF\nwhile pgrep -f jest; do sleep 1; done\ngit commit -n -m x\nexport GIT_CONFIG_KEY_0=core.hooksPath\n',
);
scriptWith('sources.sh', `source ${KILLING}\nbash ${KILLING}\n`);
scriptWith('huge.sh', `${'# padding\n'.repeat(30000)}pkill node\n`);
scriptWith('empty.sh', '');
scriptWith('shebang-only.sh', '#!/bin/bash\n', 0o755);
mkdirSync(join(SCRATCH, 'folder.sh'));
symlinkSync(KILLING, join(SCRATCH, 'link-to-kills.sh'));
const MISSING = join(SCRATCH, 'missing.sh');

const DENIED: string[] = [
  ...SIGNAL_ZERO_THEN_OPTION.map((_command, index) => `bash kills-after-null-signal-${index}.sh`),
  'bash kills.sh',
  'sh kills.sh',
  'zsh kills.sh',
  'dash kills.sh',
  'source kills.sh',
  '. kills.sh',
  './kills.sh',
  'bash ./kills.sh',
  'bash -x kills.sh',
  'bash -eu kills.sh',
  'bash -o pipefail kills.sh',
  'bash +o noglob kills.sh',
  'bash -O extglob kills.sh',
  'bash --norc kills.sh',
  'bash --rcfile /dev/null kills.sh',
  'bash -- kills.sh',
  'bash kills.sh arg1 arg2',
  'sh link-to-kills.sh',
  `bash ${KILLING}`,
  `sh ${KILLING}`,
  `source ${KILLING}`,
  `. ${KILLING}`,
  KILLING,
  `${KILLING} arg`,
  `cd ${SCRATCH} && bash kills.sh`,
  `cd ${SCRATCH} && ./kills.sh`,
  'true && bash kills.sh',
  'ls; bash kills.sh',
  '(bash kills.sh)',
  'echo x | bash kills.sh',
  'sudo bash kills.sh',
  'env FOO=1 bash kills.sh',
  'nice -n 5 bash kills.sh',
  'timeout 5 bash kills.sh',
  'time bash kills.sh',
  'sh -c "bash kills.sh"',
  'bash -c "source kills.sh"',
  'eval "bash kills.sh"',
  'echo $(bash kills.sh)',
  'bash kills-all.sh',
  'bash kills-group.sh',
  'bash kills-zero.sh',
  'bash kills-pattern.sh',
  'bash kills-piped.sh',
  'bash kills-nested.sh',
  'bash stash-then-kill.sh',
  'bash runs-heredoc-kill.sh',
  './kills-env.sh',
  './kills-zsh.sh',
  `bash ${join(SCRATCH, 'kills-all.sh')}`,
  'bash kills-plain.sh',
  'source kills-plain.sh',
];

const ALLOWED: string[] = [
  'bash own-pid.sh',
  'source own-pid.sh',
  'bash own-argument.sh 4242',
  'bash own-empty-pid.sh',
  'bash null-signal.sh',
  'bash comment.sh',
  'bash other-findings.sh',
  'bash help-stash.sh',
  'bash help-no-verify.sh',
  'bash help-main-merge.sh',
  'bash runs-heredoc-stash.sh',
  'bash sources.sh',
  'bash empty.sh',
  'bash shebang-only.sh',
  './shebang-only.sh',
  'bash missing.sh',
  'bash',
  'bash -x',
  'sh -c "echo hi" kills.sh',
  'bash -c "echo hi" kills.sh',
  'bash -s kills.sh',
  'bash folder.sh',
  'bash huge.sh',
  'bash $SCRIPT',
  'bash "$SCRIPT"',
  'bash $(pwd)/kills.sh',
  'bash ~/no-such-script.sh',
  './kills.py',
  'python3 kills.py',
  './kills-plain.sh',
  './missing.sh',
  `bash ${MISSING}`,
  'cat kills.sh',
  'cp kills.sh /tmp/kills-copy.sh',
  'echo bash kills.sh',
  'git commit -m "bash kills.sh"',
  'grep pkill kills.sh',
  'ls kills.sh',
  'chmod +x kills.sh',
  'make verify',
];

const inScratch: Options = { cwd: SCRATCH };

describe('kill-guard script-content kill scan (parser only)', () => {
  it.each(DENIED)('denies a script that holds a kill: %s', (command) => {
    expect(decide(command, inScratch)).toBe('scriptKill');
  });

  // One level only: sources.sh runs a script that holds a kill, but holds none of its own.
  it.each(ALLOWED)('allows: %s', (command) => {
    expect(decide(command, inScratch)).toBe('allow');
  });

  it('does not read a relative script when the payload has no cwd', () => {
    expect(decide('bash kills.sh')).toBe('allow');
    expect(decide(`bash ${KILLING}`)).toBe('scriptKill');
  });

  it('keeps every other deny for the command itself', () => {
    expect(decide('pkill node', inScratch)).toBe('kill');
    expect(decide('git stash', inScratch)).toBe('stash');
  });

  it('names the script in DETAILS', () => {
    const detail = spawnSync(
      'node',
      [
        '-e',
        'const f = require(process.argv[1]).decide(process.argv[2], { cwd: process.argv[3] });' +
          'process.stdout.write(f.detail);',
        GUARD,
        'bash kills.sh',
        SCRATCH,
      ],
      { encoding: 'utf8' },
    ).stdout;

    expect(detail).toContain(KILLING);
    expect(detail).toContain('pkill node');
  });
});

// scripts/job-queue.sh sends TERM to the process group of its own job: the one allowed group kill.
// Its exemption holds only for the file at the root of a worktree of this repository.
const FAKE_MAIN = join(SCRATCH, 'fake-main');
const FAKE_WORKTREE = join(SCRATCH, 'fake-worktree');
const FAKE_OTHER = join(SCRATCH, 'fake-other');
const REAL_QUEUE = join(REPOSITORY_ROOT, 'scripts/job-queue.sh');

for (const folder of [
  'fake-main/.git/worktrees/fake-worktree',
  'fake-main/scripts',
  'fake-worktree/scripts',
  'fake-other/.git',
  'fake-other/scripts',
  'unrelated/scripts',
  'copies',
]) {
  mkdirSync(join(SCRATCH, folder), { recursive: true });
}
writeFileSync(join(FAKE_MAIN, '.git/worktrees/fake-worktree/commondir'), '../..\n');
writeFileSync(
  join(FAKE_WORKTREE, '.git'),
  `gitdir: ${join(FAKE_MAIN, '.git/worktrees/fake-worktree')}\n`,
);

for (const place of [
  'fake-main/scripts',
  'fake-worktree/scripts',
  'fake-other/scripts',
  'unrelated/scripts',
  'copies',
]) {
  copyFileSync(REAL_QUEUE, join(SCRATCH, place, 'job-queue.sh'));
}
writeFileSync(join(FAKE_MAIN, 'scripts/other-queue.sh'), 'kill -s TERM -- "-$group"\n');

const fakeRepository: Options = { projectRoot: FAKE_MAIN };

describe('kill-guard script scan: scripts/job-queue.sh exemption', () => {
  it('reads the queue script as holding a group kill, so the exemption is what lets it run', () => {
    expect(decide('bash unrelated/scripts/job-queue.sh verify /tmp/wt x', inScratch)).toBe(
      'scriptKill',
    );
  });

  it.each([
    ['from the main checkout', FAKE_MAIN, 'bash scripts/job-queue.sh verify /tmp/wt x'],
    ['from a linked worktree', FAKE_WORKTREE, 'bash scripts/job-queue.sh verify /tmp/wt x'],
    ['by absolute path', FAKE_WORKTREE, `bash ${FAKE_MAIN}/scripts/job-queue.sh gate`],
    ['by absolute path from elsewhere', SCRATCH, `bash ${FAKE_WORKTREE}/scripts/job-queue.sh gate`],
    ['executed directly', FAKE_MAIN, './scripts/job-queue.sh verify /tmp/wt x'],
    ['sourced', FAKE_MAIN, 'source scripts/job-queue.sh'],
    ['through a shell string', FAKE_MAIN, 'sh -c "bash scripts/job-queue.sh verify /tmp/wt x"'],
    ['in the background', FAKE_MAIN, 'bash scripts/job-queue.sh gate a b c d &'],
  ])('allows the queue script %s', (_label, cwd, command) => {
    expect(decide(command, { ...fakeRepository, cwd })).toBe('allow');
  });

  it.each([
    ['as a copy outside any worktree', SCRATCH, 'bash copies/job-queue.sh verify /tmp/wt x'],
    ['in a scripts folder with no repository', SCRATCH, 'bash unrelated/scripts/job-queue.sh gate'],
    ['in another repository', SCRATCH, 'bash fake-other/scripts/job-queue.sh gate'],
    ['from another repository', FAKE_OTHER, 'bash scripts/job-queue.sh gate'],
    ['under another name in this repository', FAKE_MAIN, 'bash scripts/other-queue.sh'],
    ['executed from a copy', SCRATCH, './copies/job-queue.sh gate'],
  ])('denies the queue script %s', (_label, cwd, command) => {
    expect(decide(command, { ...fakeRepository, cwd })).toBe('scriptKill');
  });
});

// The guard reads a file run directly only when its first line names a shell (see
// `SHELL_SHEBANG` in kill-guard.js), so a tracked hook with no extension counts as a script too.
const SHELL_SHEBANG = /^#!\s*(?:\S*\/)?(?:env\s+(?:-\S+\s+)*)?(?:sh|bash|zsh|dash)(?:\s|$)/;

const startsWithShellShebang = (file: string): boolean => {
  try {
    const descriptor = openSync(join(REPOSITORY_ROOT, file), 'r');
    try {
      const buffer = Buffer.alloc(128);
      const length = readSync(descriptor, buffer, 0, buffer.length, 0);

      return SHELL_SHEBANG.test(buffer.toString('utf8', 0, length));
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return false;
  }
};

const trackedShellScripts = (): string[] =>
  execFileSync('git', ['ls-files', '-z'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file.endsWith('.sh') || startsWithShellShebang(file));

// The guard reads every script a command runs, so a wrong deny here would block the
// coordinator's own routine commands: no tracked script and none of those commands may deny.
describe('kill-guard script scan: every tracked script and the routine commands', () => {
  const scripts = trackedShellScripts();
  const real: Options = { cwd: REPOSITORY_ROOT };
  const routine = [
    'bash scripts/job-queue.sh verify /tmp/some-worktree some-label',
    'bash scripts/job-queue.sh gate /tmp/some-worktree label base head',
    'bash scripts/job-queue.sh check-all /tmp/some-worktree label',
    './scripts/job-queue.sh verify /tmp/some-worktree label',
    'make verify',
    'make gate',
    'make jest',
    'bash scripts/wait-load.sh 4 300',
    'bash scripts/checks/fast.sh',
    'npm run check:all',
    'git -C /Users/drizzer14/Developer/Projects/pff-ios merge --ff-only abc1234',
    'git -C /Users/drizzer14/Developer/Projects/pff-ios log --oneline -3',
    'bash scripts/ensure-git-hooks.sh',
  ];

  it('tracks shell scripts to cover, hooks without an extension included', () => {
    expect(scripts.length).toBeGreaterThan(20);
    expect(scripts).toContain('scripts/job-queue.sh');
    expect(scripts).toContain('githooks/pre-commit');
    expect(scripts).toContain('githooks/pre-merge-commit');
  });

  it('allows `bash <file>` for every tracked shell script of this repository', () => {
    const kinds = decideAll(scripts.map((file) => [`bash ${file}`, real]));

    expect(scripts.filter((_file, index) => kinds[index] !== 'allow')).toEqual([]);
  });

  it('allows `source <file>` and the absolute path of every tracked shell script', () => {
    const kinds = decideAll(
      scripts.flatMap((file) => [
        [`source ${file}`, real],
        [`bash ${join(REPOSITORY_ROOT, file)}`, inScratch],
      ]),
    );

    expect(kinds.filter((kind) => kind !== 'allow')).toEqual([]);
  });

  it('allows the routine commands of the coordinator, from the repository root', () => {
    const kinds = decideAll(routine.map((command) => [command, real]));

    expect(routine.filter((_command, index) => kinds[index] !== 'allow')).toEqual([]);
  });

  it('allows the queue script as a worktree of this repository, by relative and absolute path', () => {
    expect(decide('bash scripts/job-queue.sh verify /tmp/wt x', real)).toBe('allow');
    expect(decide(`bash ${REAL_QUEUE} verify /tmp/wt x`, inScratch)).toBe('allow');
  });
});
