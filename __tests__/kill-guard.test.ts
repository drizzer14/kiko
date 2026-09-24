import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/kill-guard.sh is the PreToolUse hook wired in
// harness/kiko/hooks/hooks.json under the Bash tool. It reads the hook's
// tool_input JSON payload from stdin, tokenizes the command line (recursing
// into $(...)/backticks and a quoted `sh -c`/`bash -c`/`zsh -c` argument),
// and prints the documented deny JSON when the command is a pkill/killall,
// a kill/pkill/killall reached through a pattern (xargs, a subshell), or a
// process-group/broadcast kill (0, a negative pid, `--` then a negative
// pid). It must ALWAYS exit 0 — even on malformed input — so a broken guard
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

describe('scripts/checks/kill-guard.sh (PreToolUse Bash guard)', () => {
  it.each(BLOCKED_COMMANDS)('denies: %s', (command) => {
    const result = run(payloadFor(command));

    expect(result.status).toBe(0);
    const stdout = result.stdout.trim();
    expect(stdout).not.toBe('');
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('kill <pid>');
  });

  it.each(ALLOWED_COMMANDS)('allows: %s', (command) => {
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
