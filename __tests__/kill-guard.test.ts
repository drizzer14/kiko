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
// pid), any `git stash` subcommand, or a heredoc whose delimiter is not
// quoted (the last two with a WHAT/DETAILS/WHY/HOW/DO-NOT reason). It must
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
];

const denyReasonFor = (command: string): string => {
  const result = run(payloadFor(command));

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
