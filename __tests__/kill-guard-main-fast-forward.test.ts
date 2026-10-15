import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

// The main checkout moves only through `bash scripts/ff-main.sh <sha>`, which fast-forwards it to a
// commit a queued verify passed on. A raw `git merge --ff-only` or `git pull --ff-only` aimed at
// it is the finding `mainFastForward`: typed, inside a `-c` string, through a variable the same
// command assigns, in a heredoc body (a shell reads it or not), and in a script file a shell runs.
// A form with another option stays `mainCheckout`, and help and recovery options stay allowed.
//
// Every text here is judged, never run: `decide` is called in node as a parser only.
const GUARD = join(__dirname, '../scripts/checks/kill-guard.js');
const KILL_GUARD_HOOK = join(__dirname, '../scripts/checks/kill-guard.sh');
const REPOSITORY_ROOT = join(__dirname, '..');
const MAIN_CHECKOUT = '/Users/drizzer14/Developer/Projects/pff-ios';
const WORKTREE = '/Users/drizzer14/orca/workspaces/pff-ios/shares-assets-research';

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
// [payload cwd, command]
type Row = [directory: string, command: string];

const decideAll = (cases: [string, Options][]): string[] =>
  JSON.parse(
    spawnSync('node', ['-e', DECIDE_SCRIPT, GUARD, JSON.stringify(cases)], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }).stdout,
  );

const decide = (command: string, options: Options = {}): string =>
  decideAll([[command, options]])[0];

const decideIn = (directory: string, command: string): string =>
  decide(command, { cwd: directory });

const hookReason = (command: string, cwd: string): string =>
  JSON.parse(
    spawnSync('bash', [KILL_GUARD_HOOK], {
      input: JSON.stringify({ cwd, tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, HOME: '/Users/drizzer14' },
    }).stdout,
  ).hookSpecificOutput.permissionDecisionReason;

const FAST_FORWARD_DENIED: Row[] = [
  [MAIN_CHECKOUT, 'git merge --ff-only feat/x'],
  [MAIN_CHECKOUT, 'git merge --ff-only 1a2b3c4'],
  [MAIN_CHECKOUT, 'git pull --ff-only'],
  [MAIN_CHECKOUT, 'git pull --ff-only origin main'],
  [`${MAIN_CHECKOUT}/`, 'git merge --ff-only 1a2b3c4'],
  [`${MAIN_CHECKOUT}/src`, 'git -C .. merge --ff-only 1a2b3c4'],
  ['/USERS/drizzer14/Developer/Projects/pff-ios', 'git pull --ff-only'],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} merge --ff-only 1a2b3c4`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} pull --ff-only`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT}/ pull --ff-only origin main`],
  [WORKTREE, 'git -C /users/drizzer14/developer/projects/PFF-IOS merge --ff-only 1a2b3c4'],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} -c core.pager=cat merge --ff-only 1a2b3c4`],
  [WORKTREE, `git --git-dir=${MAIN_CHECKOUT}/.git merge --ff-only 1a2b3c4`],
  [WORKTREE, `git --work-tree ${MAIN_CHECKOUT} pull --ff-only`],
  [WORKTREE, `GIT_DIR=${MAIN_CHECKOUT}/.git git merge --ff-only 1a2b3c4`],
  [WORKTREE, `env GIT_WORK_TREE=${MAIN_CHECKOUT} git pull --ff-only`],
  [WORKTREE, `cd ${MAIN_CHECKOUT} && git merge --ff-only 1a2b3c4`],
  [WORKTREE, `cd ${MAIN_CHECKOUT}; git status; git pull --ff-only`],
  [WORKTREE, `(cd ${MAIN_CHECKOUT} && git merge --ff-only 1a2b3c4)`],
  [WORKTREE, `pushd ${MAIN_CHECKOUT} >/dev/null && git merge --ff-only 1a2b3c4`],
  [MAIN_CHECKOUT, 'sudo git merge --ff-only 1a2b3c4'],
  [MAIN_CHECKOUT, '(cd /tmp); git merge --ff-only 1a2b3c4'],
  [MAIN_CHECKOUT, 'cd /tmp || git merge --ff-only 1a2b3c4'],
  [WORKTREE, `echo "$(git -C ${MAIN_CHECKOUT} merge --ff-only 1a2b3c4)"`],
  [WORKTREE, `sh -c "git -C ${MAIN_CHECKOUT} merge --ff-only 1a2b3c4"`],
  [WORKTREE, `cd ${MAIN_CHECKOUT} && bash -c 'git pull --ff-only'`],
  [WORKTREE, `eval "git -C ${MAIN_CHECKOUT} pull --ff-only"`],
  // A directory the command assigns is read into `-C`.
  [WORKTREE, `d=${MAIN_CHECKOUT}; git -C $d merge --ff-only 1a2b3c4`],
  [WORKTREE, `export d=${MAIN_CHECKOUT} && git -C "\${d}" pull --ff-only`],
];

// A heredoc body that a shell runs is shell text, judged in full.
const RUN_BODY_TEMPLATES: ((line: string) => string)[] = [
  (line) => `bash <<'EOF'\n${line}\nEOF`,
  (line) => `eval "$(cat <<'EOF'\n${line}\nEOF\n)"`,
  (line) => `sh -c "$(cat <<'EOF'\n${line}\nEOF\n)"`,
  (line) => `source /dev/stdin <<'EOF'\n${line}\nEOF`,
  (line) => `$(cat <<'EOF'\n${line}\nEOF\n)`,
];

// A body that no shell runs is text, yet it is judged for this finding as it is for
// `mainCheckout`: a note cannot be told apart from a command piped to a shell.
const DATA_BODY_TEMPLATES: ((line: string) => string)[] = [
  (line) => `cat > f.md <<'EOF'\n${line}\nEOF`,
  (line) => `git commit -F - <<'EOF'\n${line}\nEOF`,
  (line) => `git commit -m "$(cat <<'EOF'\n${line}\nEOF\n)"`,
  (line) => `cat > f.md <<'EOF'\n- \`${line}\` denies\nEOF`,
];

const BODY_LINES: string[] = [
  `git -C ${MAIN_CHECKOUT} merge --ff-only 1a2b3c4`,
  `git -C ${MAIN_CHECKOUT} pull --ff-only`,
  `cd ${MAIN_CHECKOUT} && git pull --ff-only origin main`,
];

const FAST_FORWARD_ALLOWED: Row[] = [
  [WORKTREE, 'git merge --ff-only feat/x'],
  [WORKTREE, 'git pull --ff-only'],
  [WORKTREE, 'git pull --ff-only origin main'],
  [`${MAIN_CHECKOUT}-other`, 'git merge --ff-only 1a2b3c4'],
  [MAIN_CHECKOUT, `git -C ${WORKTREE} merge --ff-only 1a2b3c4`],
  [MAIN_CHECKOUT, `cd ${WORKTREE} && git pull --ff-only`],
  [MAIN_CHECKOUT, `(cd ${WORKTREE} && git merge --ff-only 1a2b3c4)`],
  [MAIN_CHECKOUT, 'echo git merge --ff-only 1a2b3c4'],
  [MAIN_CHECKOUT, 'git log --oneline main..feat/x'],
  [MAIN_CHECKOUT, 'git merge-base --is-ancestor HEAD 1a2b3c4'],
  // The way main moves.
  [MAIN_CHECKOUT, 'bash scripts/ff-main.sh 1a2b3c4'],
  [WORKTREE, `bash ${REPOSITORY_ROOT}/scripts/ff-main.sh 1a2b3c4`],
  [REPOSITORY_ROOT, 'bash scripts/ff-main.sh 1a2b3c4'],
  // Help, recovery, and a read-only apply on the main checkout.
  [MAIN_CHECKOUT, 'git merge -h'],
  [MAIN_CHECKOUT, 'git merge --help'],
  [MAIN_CHECKOUT, 'git pull -h'],
  [MAIN_CHECKOUT, 'git merge --ff-only -h'],
  [MAIN_CHECKOUT, 'git pull --ff-only --help'],
  [MAIN_CHECKOUT, 'git apply --check x.patch'],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} merge --abort`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} merge --quit`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} merge --continue`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} rebase --abort`],
  [MAIN_CHECKOUT, 'git merge --abort'],
  [MAIN_CHECKOUT, 'git merge --quit'],
  [MAIN_CHECKOUT, 'git merge --continue'],
  [MAIN_CHECKOUT, 'git rebase --skip'],
  [MAIN_CHECKOUT, 'git cherry-pick --continue'],
];

// Any option beside `--ff-only` can override it, so these are not a fast-forward-only form.
const STILL_MAIN_CHECKOUT: Row[] = [
  [MAIN_CHECKOUT, 'git merge feat/x'],
  [MAIN_CHECKOUT, 'git merge --no-ff feat/x'],
  [MAIN_CHECKOUT, 'git merge --ff-only --no-ff feat/x'],
  [MAIN_CHECKOUT, 'git pull'],
  [MAIN_CHECKOUT, 'git pull origin main'],
  [MAIN_CHECKOUT, 'git pull --ff-only --rebase'],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} merge --ff-only --squash feat/x`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} rebase main`],
];

describe('kill-guard: a raw fast-forward of the main checkout (parser only)', () => {
  it.each(FAST_FORWARD_DENIED)('denies as mainFastForward: in %s, %s', (directory, command) => {
    expect(decideIn(directory, command)).toBe('mainFastForward');
  });

  it('denies a command that names the main checkout when the payload has no cwd', () => {
    expect(decide(`git -C ${MAIN_CHECKOUT} merge --ff-only 1a2b3c4`)).toBe('mainFastForward');
    expect(decide('git merge --ff-only 1a2b3c4')).toBe('allow');
  });

  it.each(RUN_BODY_TEMPLATES.map((wrap, index) => [index, wrap] as const))(
    'denies a line a shell runs from a heredoc body (template %i)',
    (_index, wrap) => {
      const kinds = decideAll(BODY_LINES.map((line) => [wrap(line), { cwd: WORKTREE }]));

      expect(kinds).toEqual(BODY_LINES.map(() => 'mainFastForward'));
    },
  );

  it.each(DATA_BODY_TEMPLATES.map((wrap, index) => [index, wrap] as const))(
    'denies a line in a heredoc body that no shell runs (template %i)',
    (_index, wrap) => {
      const kinds = decideAll(BODY_LINES.map((line) => [wrap(line), { cwd: WORKTREE }]));

      expect(kinds).toEqual(BODY_LINES.map(() => 'mainFastForward'));
    },
  );

  it('allows a body that no shell runs when it names a worktree', () => {
    const body = `cat > f.md <<'EOF'\ngit -C ${WORKTREE} merge --ff-only x\nEOF`;

    expect(decideIn(WORKTREE, body)).toBe('allow');
  });

  it.each(FAST_FORWARD_ALLOWED)('allows: in %s, %s', (directory, command) => {
    expect(decideIn(directory, command)).toBe('allow');
  });

  it.each(STILL_MAIN_CHECKOUT)('keeps mainCheckout for: in %s, %s', (directory, command) => {
    expect(decideIn(directory, command)).toBe('mainCheckout');
  });
});

describe('kill-guard: the block for a raw fast-forward of the main checkout', () => {
  it.each([
    [MAIN_CHECKOUT, 'git merge --ff-only 1a2b3c4'],
    [WORKTREE, `git -C ${MAIN_CHECKOUT} pull --ff-only`],
  ])('names ff-main.sh as the way out: in %s, %s', (directory, command) => {
    const reason = hookReason(command, directory);

    for (const line of ['WHAT FAILED:', 'DETAILS:', 'WHY IT MATTERS:', 'HOW TO FIX:', 'DO NOT:']) {
      expect(reason).toContain(line);
    }
    expect(reason).toContain(`${command} (runs in ${MAIN_CHECKOUT})`);
    expect(reason).toContain('bash scripts/ff-main.sh <sha>');
    expect(reason).toContain('bash scripts/job-queue.sh verify');
    expect(reason).toContain('--abort, --quit, --skip, and --continue stay allowed');
  });

  it('sends a merge that is not a fast-forward to ff-main.sh as well', () => {
    const reason = hookReason('git merge feat/x', MAIN_CHECKOUT);

    expect(reason).toContain('bash scripts/ff-main.sh <sha>');
    expect(reason).toContain('separate detached worktree');
    expect(reason).not.toContain('merge --ff-only <sha>');
  });
});

// A script file a shell runs is read for a kill and for a raw fast-forward of the main checkout.
const SCRATCH = createTemporaryDirectory('guard-main-fast-forward-');
afterAll(removeTemporaryDirectories);

const scriptWith = (name: string, body: string, mode = 0o644): string => {
  const file = join(SCRATCH, name);
  writeFileSync(file, body);
  chmodSync(file, mode);

  return file;
};

const FAST_FORWARD_LINE = `git -C ${MAIN_CHECKOUT} merge --ff-only 1a2b3c4`;
const HOLDING_BODY = `#!/bin/bash\n${FAST_FORWARD_LINE}\n`;
const HOLDING_FAST_FORWARD = scriptWith('holds-ff.sh', HOLDING_BODY, 0o755);
scriptWith('holds-pull.sh', `cd ${MAIN_CHECKOUT}\ngit pull --ff-only\n`);
scriptWith('holds-ff-heredoc.sh', `bash <<'EOF'\n${FAST_FORWARD_LINE}\nEOF\n`);
scriptWith('holds-ff-in-cwd.sh', 'git merge --ff-only 1a2b3c4\n');
scriptWith('holds-worktree-ff.sh', `git -C ${WORKTREE} merge --ff-only 1a2b3c4\n`);
scriptWith('holds-ff-comment.sh', `# ${FAST_FORWARD_LINE}\necho "${FAST_FORWARD_LINE}"\n`);

const inScratch: Options = { cwd: SCRATCH };

describe('kill-guard script scan: a raw fast-forward of the main checkout', () => {
  it.each([
    'bash holds-ff.sh',
    'sh holds-ff.sh',
    'source holds-ff.sh',
    '. holds-ff.sh',
    './holds-ff.sh',
    `bash ${HOLDING_FAST_FORWARD}`,
    'bash holds-pull.sh',
    'bash holds-ff-heredoc.sh',
    'sh -c "bash holds-ff.sh"',
    'true && bash holds-ff.sh',
  ])('denies a script that holds one: %s', (command) => {
    expect(decide(command, inScratch)).toBe('mainFastForward');
  });

  it('names the script and the command in DETAILS', () => {
    const detail = spawnSync(
      'node',
      [
        '-e',
        'const f = require(process.argv[1]).decide(process.argv[2], { cwd: process.argv[3] });' +
          'process.stdout.write(f.detail);',
        GUARD,
        'bash holds-ff.sh',
        SCRATCH,
      ],
      { encoding: 'utf8' },
    ).stdout;

    expect(detail).toContain(`${HOLDING_FAST_FORWARD} holds`);
    expect(detail).toContain('merge --ff-only 1a2b3c4');
  });

  it('judges a script that runs where the main checkout is', () => {
    expect(decideIn(MAIN_CHECKOUT, `bash ${SCRATCH}/holds-ff-in-cwd.sh`)).toBe('mainFastForward');
    expect(decideIn(WORKTREE, `bash ${SCRATCH}/holds-ff-in-cwd.sh`)).toBe('allow');
  });

  it.each(['bash holds-worktree-ff.sh', 'bash holds-ff-comment.sh'])('allows: %s', (command) => {
    expect(decide(command, inScratch)).toBe('allow');
  });
});

// The shipped scripts/ff-main.sh moves main through a variable target, which the script scan does
// not resolve, so running it needs no exemption.
const REAL_FF_MAIN = join(REPOSITORY_ROOT, 'scripts/ff-main.sh');
scriptWith('ff-main-copy.sh', readFileSync(REAL_FF_MAIN, 'utf8'), 0o755);

describe('kill-guard script scan: the shipped scripts/ff-main.sh', () => {
  it.each([
    ['by relative path in this repository', REPOSITORY_ROOT, 'bash scripts/ff-main.sh 1a2b3c4'],
    ['by absolute path', SCRATCH, `bash ${REAL_FF_MAIN} 1a2b3c4`],
    ['as a copy outside any worktree', SCRATCH, 'bash ff-main-copy.sh 1a2b3c4'],
    ['as a copy executed directly', SCRATCH, './ff-main-copy.sh 1a2b3c4'],
  ])('allows running it %s', (_label, cwd, command) => {
    expect(decide(command, { cwd })).toBe('allow');
  });
});
