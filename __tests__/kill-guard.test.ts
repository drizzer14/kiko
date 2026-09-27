import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/kill-guard.sh is the PreToolUse hook wired in
// harness/kiko/hooks/hooks.json under the Bash tool. It reads the hook's
// tool_input JSON payload from stdin, tokenizes the command line (dropping
// `#` comments, and recursing into $(...)/backticks, a shell's `-c`/`-lc`
// argument, and an `eval` string),
// and prints the documented deny JSON when the command is a pkill/killall,
// a kill/pkill/killall reached through a pattern (xargs, a subshell), or a
// process-group/broadcast kill (0, a negative pid, `--` then a negative
// pid), any `git stash` subcommand, a heredoc whose delimiter is not
// quoted, or a `git apply`/`merge`/`rebase` aimed at the main checkout (the
// last three with a WHAT/DETAILS/WHY/HOW/DO-NOT reason). It must
// ALWAYS exit 0 — even on malformed input — so a broken guard
// never blocks the Bash tool itself. See scripts/checks/kill-guard.js for
// the full rationale.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard.sh');

const run = (payload: string): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT], { input: payload, encoding: 'utf8' });

const payloadFor = (command: string): string => JSON.stringify({ tool_input: { command } });

const BLOCKED_COMMANDS: string[] = [
  'pkill -f "cat" -U drizzer14',
  'killall Simulator',
  '/usr/bin/pkill node',
  'sleep 1; pkill cat',
  'true && killall -9 node',
  "ps aux | grep cat | awk '{print $2}' | xargs kill",
  'pgrep node | xargs kill -9',
  'kill $(pgrep -f metro)',
  'sh -c "pkill -f cat"',
  "bash -c 'kill -9 -1'",
  'kill -9 -1',
  'kill 0',
  'kill -- -1234',
  'kill -TERM -1234',
  'sudo pkill cat',
  'kill node',
  "# don't hang\npkill -f cat",
  "echo hi # it's fine\npkill x",
  'echo "$(true # it\'s\n)"\npkill x',
  'echo a#b; pkill x',
  `echo \${#x}; pkill x`,
  'echo $#; pkill x',
  'FOO=1 pkill x',
  '(pkill x)',
  '{ pkill x; }',
  'if pkill x; then :; fi',
  "bash -lc 'pkill x'",
  'sudo -u me pkill x',
  'nice -n 5 pkill x',
  'eval "pkill x"',
  'pgrep x | xargs -n 1 kill',
  'echo $(( $(pkill x) + 1 ))',
  'echo $[ $(pkill x) + 1 ]',
  'git commit -m "$(cat <<\'EOF\'\nfix: thing (closes #12)\nEOF\n)"; pkill -f cat',
  `echo \${x/ #/}; pkill x`,
  'sudo -iu me pkill x',
  'builtin kill 0',
  'command -p pkill x',
  'pgrep x | xargs -0n 1 kill',
  "gh pr create --body-file - <<'EOF'\n## What's new\nIt's done\nEOF\npkill x",
  "x=$(cat <<'EOF'\nsee #12)\nPR #45's fix\nit's\nEOF\n); pkill -f cat",
  'git commit -m "$(cat <<\'EOF\'\n#1 ((\nx)\nsay "hi\nEOF\n)"; pkill x',
  "bash <<'EOF'\npkill x\nEOF",
  'eval "$(cat <<\'EOF\'\npkill x\nEOF\n)"',
  "cat <<'EOF'\nan unterminated body\npkill x",
  "cat <<-'EOF'\n\tbody\n\tEOF\npkill x",
  "cat <<'A' - <<'B'\na\nA\nb\nB\npkill x",
  'nohup -- pkill x',
  'command -- pkill x',
  'pgrep x | xargs -J % kill %',
  'env -S "pkill x"',
  "echo `echo it's` ; pkill x",
  '[[ x =~ (a)#b ]]; pkill x',
  '[[ x == (a|b)#c ]]; pkill x',
  '[[ x =~ a|(b)#c ]]; pkill x',
  'ls (a|b)#c ; pkill x',
  "cat <<$'EOF'\nit's\nEOF\npkill x\n$EOF",
  'cat <<$"EOF"\nit\'s\nEOF\npkill x\n$EOF',
  'cat <<"E\\"OF"\nit\'s\nE"OF\npkill x\nE\\"OF',
  'cat <<"E\\\\OF"\nit\'s\nE\\OF\npkill x\nE\\\\OF',
  'cat <<"E\\$OF"\nit\'s\nE$OF\npkill x\nE\\$OF',
  'cat <<"E\\`OF"\nit\'s\nE`OF\npkill x\nE\\`OF',
  'exec -a name pkill x',
  'echo hi |\\\npkill x',
  'ls (a|b)#c |\\\npkill x',
];

const ALLOWED_COMMANDS: string[] = [
  'kill 1234',
  'kill -9 1234',
  'kill -TERM 1234 5678',
  'kill -s TERM 1234',
  'kill "$pid"',
  'kill -0 4242',
  'grep -rn pkill docs/',
  'echo "never use killall"',
  'git commit -m "block pkill and killall"',
  'ls -la',
  'npm run check:all',
  '# pkill x is banned here',
  'echo a#b',
  `echo \${#x} $#`,
  '(kill 1234)',
  '{ kill "$pid"; }',
  'command -v pkill',
  'FOO=1 npm test',
  'time npm test',
  'eval "echo hi"',
  "bash -lc 'npm test'",
  '(echo hi)# c; pkill x',
  "cat <<$'EOF'\nit's\nEOF",
  'cat <<"E\\"OF"\nit\'s\nE"OF',
  'exec -a name npm test',
];

// A git stash in any directory — this repository, a worktree, or a scratch
// clone — reached directly, through a global option, or inside a `-c`
// string.
const STASH_COMMANDS: string[] = [
  'git stash',
  'git stash pop',
  'git stash push -u -m my-tag',
  '/usr/bin/git stash list',
  'git -C /tmp/scratch-clone stash',
  'git -C "/tmp/scratch clone" stash apply',
  'git --git-dir /tmp/scratch/.git stash list',
  'git --git-dir=/tmp/scratch/.git --work-tree=/tmp/scratch stash',
  'git -c core.pager=cat stash show',
  'git --no-pager stash list',
  'cd /tmp/scratch && git stash',
  'env GIT_DIR=/tmp/scratch/.git git stash',
  'sh -c "git stash"',
  "bash -c 'git -C /tmp/scratch stash drop'",
  'echo $(git stash)',
  '(cd /tmp/scratch-clone && git stash -q)',
  '( git stash )',
  '{ git stash; }',
  'GIT_DIR=/tmp/scratch/.git git stash',
  'HUSKY=0 git stash push',
  'if git stash; then :; fi',
  'if false; then :; elif git stash; then :; fi',
  'if false; then :; else git stash; fi',
  'while git stash; do :; done',
  'until git stash; do :; done',
  'for d in a b; do git -C $d stash; done',
  '! git stash',
  'time git stash',
  'time -p git stash',
  "bash -lc 'git stash'",
  "bash -ec 'git stash'",
  "sh -xc 'git stash'",
  "dash -c 'git stash'",
  'sudo -u me git stash',
  'sudo -g staff git stash',
  'nice git stash',
  'nice -n 10 git stash',
  'eval "git stash"',
  'eval git stash',
  'git commit -m "$(cat <<\'EOF\'\nfix: thing (closes #12)\nEOF\n)"; git stash',
  'gh pr create --body "$(cat <<\'EOF\'\n- (#12) done\nEOF\n)" && git stash',
  "cat > /tmp/pr.md <<'EOF'\n## What's changed\n- it's fixed\nEOF\ngit stash",
  "git commit -F - <<'EOF'\nfix: PR #45's regression\n\nIt's fixed.\nEOF\ngit stash",
  "git commit -m \"$(cat <<'EOF'\nfix: it's fixed\nEOF\n)\"; git stash",
  '(git stash)>/dev/null',
  '(git stash) 2>&1',
  '(git stash)# c',
  'case x in a) git stash ;; esac',
  'exec -a name git stash',
  'npm test &&\\\ngit stash',
];

const HEREDOC_COMMANDS: string[] = [
  'cat <<EOF\nhello\nEOF',
  'cat <<-EOF\n\thello\n\tEOF',
  'cat << EOF\nhello\nEOF',
  'cat > notes.txt <<END_OF_TEXT\nhello\nEND_OF_TEXT',
  'git commit -m "$(cat <<EOF\nmessage\nEOF\n)"',
  "bash -c 'cat <<EOF\nhello\nEOF'",
  "bash -lc 'cat <<EOF\nhello\nEOF'",
  "# write the skill text; it's long\ncat > f.md <<EOF\nrun `git apply -3`\nEOF",
  'cat <<$X\nhello\n$X',
  'cat <<1\nhello\n1',
  'cat <<.\nhello\n.',
  'git commit -m "$(cat <<\'EOF\'\nfix: thing (see #12)\nEOF\n)" && cat > f.md <<EOF\n`x`\nEOF',
  "bash <<'EOF'\ncat <<X\n`x`\nX\nEOF",
];

const ALLOWED_GIT_AND_HEREDOC_COMMANDS: string[] = [
  'git status',
  'git -C /tmp/scratch log --oneline',
  'git --git-dir=/tmp/scratch/.git log',
  'git log --grep stash',
  'git commit -m "never run git stash"',
  'grep -rn "git stash" docs/',
  'echo git stash',
  "cat <<'EOF'\n`date`\nEOF",
  'cat <<"EOF"\nhello\nEOF',
  'cat <<\\EOF\nhello\nEOF',
  "cat <<-'EOF'\n\thello\n\tEOF",
  "cat << 'EOF'\nhello\nEOF",
  'git commit -m "$(cat <<\'EOF\'\nmessage\nEOF\n)"',
  'cat <<<"a here-string"',
  'echo $((1 << 2))',
  'echo $((1 << n))',
  'echo $(( x<<2 ))',
  '(( x = 1 << n ))',
  'echo $[1<<2]',
  'echo "write <<EOF only when quoted"',
  'git show stash@{0}',
  '(cd /tmp && git status)',
  "bash -c 'echo $((1<<2))'",
  "eval 'echo $((1 << 2))'",
  'eval "echo \\$((1<<2))"',
  'git commit -m "$(cat <<\'EOF\'\nfix: thing (closes #12)\nEOF\n)"',
  'sudo -iu me npm test',
  'command -v pkill && command -V killall',
  "git commit -m \"$(cat <<'EOF'\nfeat: debts (#12)\n\n## Summary\nIt's done; closes #45.\nShift: 1 << 2\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF\n)\"",
  'gh pr create --title "x (#12)" --body "$(cat <<\'EOF\'\n## Summary\n- it\'s fixed (closes #45)\n- 1 << 2 and x << $n\n\n## Test plan\n- [x] make verify\nEOF\n)"',
  "cat > /tmp/pr.md <<'EOF'\n## What's changed\n- it's fixed\n- write cat <<EOF only quoted\nEOF",
  "git commit -F - <<'EOF'\nfix: PR #45's regression\n\nIt's fixed.\nEOF",
  'diff <(ls a) <(ls b)',
];

// The hooks' dispatcher runs from the main checkout, so a conflict marker
// there breaks every hook in every session: git apply/merge/rebase aimed at
// it is denied, and the same commands anywhere else pass.
const MAIN_CHECKOUT = '/Users/drizzer14/Developer/Projects/pff-ios';
const WORKTREE = '/Users/drizzer14/orca/workspaces/pff-ios/shares-assets-research';

// [payload cwd, command]
const MAIN_CHECKOUT_COMMANDS: [string, string][] = [
  [MAIN_CHECKOUT, 'git merge feat/x'],
  [MAIN_CHECKOUT, 'git apply x.patch'],
  [MAIN_CHECKOUT, 'git rebase main'],
  [MAIN_CHECKOUT, 'git merge --ff-only feat/x'],
  [MAIN_CHECKOUT, 'git rebase --continue'],
  [`${MAIN_CHECKOUT}/`, 'git merge feat/x'],
  [`${MAIN_CHECKOUT}/src/screens`, 'git apply -3 x.patch'],
  [`${MAIN_CHECKOUT}/src`, 'git -C .. merge feat/x'],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} merge feat/x`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT}/ merge feat/x`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT}/src rebase main`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} -c core.pager=cat merge feat/x`],
  [WORKTREE, `cd ${MAIN_CHECKOUT} && git apply x.patch`],
  [WORKTREE, `cd ${MAIN_CHECKOUT}; git status; git rebase main`],
  [WORKTREE, `(cd ${MAIN_CHECKOUT} && git merge feat/x)`],
  [WORKTREE, 'cd ../../../../Developer/Projects/pff-ios && git merge feat/x'],
  [WORKTREE, `cd ${MAIN_CHECKOUT} && echo "$(git merge feat/x)"`],
  [WORKTREE, `cd ${MAIN_CHECKOUT} && bash -c 'git merge feat/x'`],
  [WORKTREE, `git --git-dir=${MAIN_CHECKOUT}/.git rebase main`],
  [WORKTREE, `git --git-dir ${MAIN_CHECKOUT}/.git merge feat/x`],
  [WORKTREE, `git --work-tree=${MAIN_CHECKOUT} apply x.patch`],
  [MAIN_CHECKOUT, '(cd /tmp); git merge feat/x'],
  [MAIN_CHECKOUT, 'sudo git merge feat/x'],
  [MAIN_CHECKOUT, 'sh -c "git rebase main"'],
];

const ALLOWED_OUTSIDE_MAIN_CHECKOUT: [string, string][] = [
  [WORKTREE, 'git merge feat/x'],
  [WORKTREE, 'git apply x.patch'],
  [WORKTREE, 'git rebase main'],
  [`${MAIN_CHECKOUT}-other`, 'git merge feat/x'],
  [MAIN_CHECKOUT, `git -C ${WORKTREE} merge feat/x`],
  [MAIN_CHECKOUT, `cd ${WORKTREE} && git merge feat/x`],
  [MAIN_CHECKOUT, `(cd ${WORKTREE} && git rebase main)`],
  [MAIN_CHECKOUT, 'git status'],
  [MAIN_CHECKOUT, 'git log --oneline --merges'],
  [MAIN_CHECKOUT, 'git diff main..feat/x'],
  [MAIN_CHECKOUT, 'git merge-base main HEAD'],
  [MAIN_CHECKOUT, 'git merge-tree --write-tree main feat/x'],
  [MAIN_CHECKOUT, 'git rebase --help'],
  [MAIN_CHECKOUT, 'git merge -h'],
  [MAIN_CHECKOUT, 'echo git merge feat/x'],
  [MAIN_CHECKOUT, 'grep -rn "git rebase" docs/'],
];

const payloadIn = (directory: string, command: string): string =>
  JSON.stringify({ cwd: directory, tool_input: { command } });

const denyReasonFor = (command: string, payload = payloadFor(command)): string => {
  const result = run(payload);

  expect(result.status).toBe(0);
  const stdout = result.stdout.trim();
  expect(stdout).not.toBe('');
  const parsed = JSON.parse(stdout);
  expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');

  return parsed.hookSpecificOutput.permissionDecisionReason;
};

const expectStandardBlock = (reason: string): void => {
  expect(reason).toContain('WHAT FAILED:');
  expect(reason).toContain('DETAILS:');
  expect(reason).toContain('WHY IT MATTERS:');
  expect(reason).toContain('HOW TO FIX:');
  expect(reason).toContain('DO NOT:');
};

describe('scripts/checks/kill-guard.sh (PreToolUse Bash guard)', () => {
  it.each(BLOCKED_COMMANDS)('denies: %s', (command) => {
    expect(denyReasonFor(command)).toContain('kill <pid>');
  });

  it.each(STASH_COMMANDS)('denies git stash: %s', (command) => {
    const reason = denyReasonFor(command);

    expectStandardBlock(reason);
    expect(reason).toContain('git stash');
    expect(reason).toContain('commit a WIP');
  });

  it.each(HEREDOC_COMMANDS)('denies an unquoted heredoc delimiter: %s', (command) => {
    const reason = denyReasonFor(command);

    expectStandardBlock(reason);
    expect(reason).toContain('unquoted heredoc');
    expect(reason).toContain("<<'EOF'");
  });

  it.each([...ALLOWED_COMMANDS, ...ALLOWED_GIT_AND_HEREDOC_COMMANDS])('allows: %s', (command) => {
    const result = run(payloadFor(command));

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it.each(MAIN_CHECKOUT_COMMANDS)(
    'denies git apply/merge/rebase on the main checkout: in %s, %s',
    (directory, command) => {
      const reason = denyReasonFor(command, payloadIn(directory, command));

      expectStandardBlock(reason);
      expect(reason).toContain('main checkout');
      expect(reason).toContain('in a worktree');
    },
  );

  it.each(ALLOWED_OUTSIDE_MAIN_CHECKOUT)('allows: in %s, %s', (directory, command) => {
    const result = run(payloadIn(directory, command));

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('allows git merge when the payload names no cwd', () => {
    const result = run(payloadFor('git merge feat/x'));

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('allows on malformed JSON (never breaks the Bash tool)', () => {
    const result = run('{not json');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('allows a payload with no tool_input', () => {
    const result = run(JSON.stringify({ other: 'field' }));

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});
