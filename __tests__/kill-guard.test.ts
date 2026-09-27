import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/kill-guard.sh is the PreToolUse hook wired in
// harness/kiko/hooks/hooks.json under the Bash tool. It reads the hook's
// tool_input JSON payload from stdin, tokenizes the command line (recursing
// into $(...)/backticks and a quoted `sh -c`/`bash -c`/`zsh -c` argument),
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
];

const HEREDOC_COMMANDS: string[] = [
  'cat <<EOF\nhello\nEOF',
  'cat <<-EOF\n\thello\n\tEOF',
  'cat << EOF\nhello\nEOF',
  'cat > notes.txt <<END_OF_TEXT\nhello\nEND_OF_TEXT',
  'git commit -m "$(cat <<EOF\nmessage\nEOF\n)"',
  "bash -c 'cat <<EOF\nhello\nEOF'",
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
  'echo "write <<EOF only when quoted"',
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
