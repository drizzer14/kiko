import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// The wait-loop deny of scripts/checks/kill-guard.js: a `while` or `until`
// loop that scans the process table (`ps`, `pgrep -f`) for make verify,
// check:all, jest, stryker, semgrep, or xcodebuild matches its own command
// line, so the wait never ends. A one-time scan outside a loop, and a loop
// that scans nothing (a file, a pid, scripts/wait-load.sh), stay allowed.
//
// Every text here is judged, never run: `decide` is called in node as a
// parser only, and the hook rows only pipe JSON into kill-guard.sh.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard.sh');
const GUARD = join(__dirname, '../scripts/checks/kill-guard.js');

const DECIDE_SCRIPT = [
  'const { decide } = require(process.argv[1]);',
  'const finding = decide(process.argv[2], {});',
  'process.stdout.write(finding === null ? "allow" : finding.kind);',
].join('\n');

const decide = (command: string): string =>
  spawnSync('node', ['-e', DECIDE_SCRIPT, GUARD, command], { encoding: 'utf8' }).stdout;

const run = (command: string): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  });

const REASON_LABELS = ['WHAT FAILED:', 'DETAILS:', 'WHY IT MATTERS:', 'HOW TO FIX:', 'DO NOT:'];

const DENIED_WAIT_LOOPS: string[] = [
  "until ! ps -axo command | grep -qE '[m]ake verify|check:all|[j]est'; do sleep 30; done",
  'while pgrep -f stryker; do sleep 5; done',
  "while pgrep -f 'make verify' >/dev/null; do sleep 5; done",
  'until ! pgrep -f jest; do sleep 1; done',
  'while ps aux | grep -q "[j]est"; do sleep 1; done',
  'while ps aux | grep semgrep | grep -v grep; do sleep 2; done',
  'until [ -z "$(pgrep -f xcodebuild)" ]; do sleep 5; done',
  'while [ "$(ps aux | grep -c jest)" -gt 1 ]; do sleep 1; done',
  "while true; do pgrep -f 'check:all' || break; sleep 2; done",
  'while true\ndo\n  if ! ps aux | grep -q jest; then break; fi\n  sleep 1\ndone',
  `zsh -c "until ! ps -axo command | grep -qE '[m]ake verify'; do sleep 30; done"`,
  "bash -c 'while pgrep -f stryker; do sleep 5; done'",
  'echo $(until pgrep -f jest; do sleep 1; done)',
  'while sudo pgrep -f jest; do sleep 1; done',
  "timeout 600 bash -c 'until ! pgrep -f xcodebuild; do sleep 5; done'",
  '(while pgrep -afl jest; do sleep 1; done) &',
  'while pgrep --full stryker; do sleep 1; done',
  'npm run check:all & while pgrep -f check:all; do sleep 10; done',
  "until ! ps aux | egrep -q 'Make  Verify'; do sleep 1; done",
  'for i in 1 2; do until pgrep -f jest; do sleep 1; done; done',
  "while ps -ef | awk '/[j]est/ {found=1} END {exit !found}'; do sleep 1; done",
  'while [[ "$(ps -axo command)" == *xcodebuild* ]]; do sleep 5; done',
  'while ps aux > /tmp/p.txt; grep -q semgrep /tmp/p.txt; do sleep 1; done',
  'while sleep 1; do ps aux | rg -q jest || break; done',
  'until ! ps -ep $pid | grep -q jest; do sleep 1; done',
  'until ! ps -A -p 1 | grep -q jest; do sleep 1; done',
  "until ! pgrep -f 'jest|stryker'; do sleep 1; done",
  "eval 'until ! pgrep -f jest; do sleep 1; done'",
  "bash <<'EOF'\nuntil ! pgrep -f jest; do sleep 1; done\nEOF",
  'while top -l 1 | grep -q xcodebuild; do sleep 5; done',
  'while true; do bash -c "pgrep -f jest" || break; done',
  'echo start; while pgrep -f jest > /dev/null 2>&1; do sleep 1; done; echo done',
  'while ps aux | grep -q "make[ ]verify"; do sleep 1; done',
  'while ps aux | grep -q "je[s]t"; do sleep 1; done',
  'while true; do while pgrep -f jest; do sleep 1; done; done',
  'for i in 1 2; do echo $i; done; while pgrep -f jest; do sleep 1; done',
];

const ALLOWED_WAIT_COMMANDS: string[] = [
  'ps aux | grep jest',
  "pgrep -f '@stryker-mutator'",
  'pgrep -fl xcodebuild',
  'if pgrep -f jest; then echo running; fi',
  'ps aux | grep -c semgrep; sleep 1',
  'until bash scripts/wait-load.sh 10 3600; do sleep 1; done',
  'bash scripts/wait-load.sh 10 3600 && npx jest foo',
  'until [ -f /tmp/done.flag ]; do sleep 1; done',
  "while ! grep -q 'Tests:' /tmp/jest.log; do sleep 5; done",
  'while kill -0 4242 2>/dev/null; do sleep 1; done',
  'while ps -p 4242 >/dev/null; do sleep 1; done',
  'until ! ps -p "$pid"; do sleep 1; done',
  'while ps -p "$pid"; do echo "waiting for jest"; sleep 1; done',
  // pgrep without -f matches a process name, never the loop's own command line.
  'while pgrep -x xcodebuild; do sleep 5; done',
  'while pgrep jest; do sleep 5; done',
  'while read name; do echo "$name"; done < names.txt',
  'while true; do ps -axo pid,etime | head -3; sleep 1; done',
  'echo "while pgrep -f jest; do sleep 1; done"',
  'git commit -m "never use until pgrep -f jest loops"',
  'ps aux | grep jest; while true; do sleep 1; done',
  'while true; do sleep 1; done; ps aux | grep jest',
  'grep -rn "pgrep -f jest" docs/',
  'until jest --listTests; do sleep 1; done',
  // A pid wait: ps -p lists one pid, so a filter on a job name in the body is no scan.
  'while ps -p $pid >/dev/null; do grep -c PASS /tmp/jest.log; sleep 5; done',
  `while ps -p "$XPID" > /dev/null; do tail -1 /tmp/build.log | grep -E 'Compiling|xcodebuild'; sleep 10; done`,
  'while ps --pid $pid >/dev/null; do grep -c jest /tmp/log; sleep 5; done',
  'while ps -q $pid >/dev/null; do grep -c jest /tmp/log; sleep 5; done',
  'while ps -p $pid -o command= | grep -q node; do grep -c jest /tmp/log; sleep 5; done',
  // The scan flags reset when a loop closes: a later loop's filter is not paired with it.
  'while ps aux | grep -q foo; do sleep 1; done; while ! grep -q jest /tmp/log; do sleep 1; done',
  // An unclosed loop never runs, so prose in a heredoc body that starts a line with
  // while/until and later quotes a scan is text.
  'git commit -m "$(cat <<\'X\'\nfix(harness): stop self-matching waiters\n\nThe orchestrator kept a waiter alive\nwhile the gate ran; its `pgrep -f jest` matched itself.\nX\n)"',
  'git commit -m "$(cat <<\'X\'\ndocs: note\n\nKeep polling\nuntil the run ends. A one-time `pgrep -f stryker` is fine.\nX\n)"',
  'gh pr create --title t --body "$(cat <<\'X\'\n## Summary\n- kill-guard: deny a wait loop\nwhile `ps aux | grep jest` is fine once\nX\n)"',
  "git commit -F - <<'X'\ndocs: explain the self-match trap\n\nuntil the load drops, agents used to run\nps aux | grep jest in a loop.\nX",
  // What feeds a loop runs once, outside it.
  'while read line; do echo "$line"; done < <(ps aux | grep jest)',
  'while read line; do echo "$line"; done <<< "$(ps aux | grep jest)"',
  'for i in 1 2 3; do pgrep -f jest || break; done',
  'while true; do sleep 1; done; pgrep -f jest',
  'while read line; do echo "$line"; done < list.txt; ps aux | grep jest',
  'git commit -m "$(cat <<\'EOF\'\nfeat: deny wait loops\n\nUntil the load drops, wait with wait-load.sh.\nEOF\n)"',
];

describe('kill-guard wait-loop deny (parser only)', () => {
  it.each(DENIED_WAIT_LOOPS)('denies: %s', (command) => {
    expect(decide(command)).toBe('waitLoop');
  });

  it.each(ALLOWED_WAIT_COMMANDS)('allows: %s', (command) => {
    expect(decide(command)).toBe('allow');
  });
});

describe('kill-guard.sh wait-loop deny (hook)', () => {
  it('prints the standard WHAT/DETAILS/WHY/HOW/DO-NOT block with the way out', () => {
    const result = run('until ! ps -axo command | grep -qE "[j]est"; do sleep 30; done');

    expect(result.status).toBe(0);
    const { hookSpecificOutput } = JSON.parse(result.stdout);
    const reason: string = hookSpecificOutput.permissionDecisionReason;
    expect(hookSpecificOutput.permissionDecision).toBe('deny');
    expect(REASON_LABELS.filter((label) => !reason.includes(label))).toEqual([]);
    expect(reason).toContain('jest');
    expect(reason).toContain('bash scripts/wait-load.sh <load> <timeout>');
    expect(reason).toContain('run_in_background');
    expect(reason).toContain('exit code');
    expect(reason).toContain('ps|grep');
    expect(reason).toContain('pgrep');
  });

  it('allows a wait through wait-load.sh', () => {
    const result = run('bash scripts/wait-load.sh 10 3600 && env -u FORCE_COLOR npx jest foo');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});

// The guard runs on every Bash call, so the scan must stay linear: an input
// long enough to show a quadratic pass must still finish well inside the
// hook's timeout.
describe('kill-guard wait-loop deny timing (linear)', () => {
  const judgedWithin = (command: string, decision: string): void => {
    const started = Date.now();

    expect(decide(command)).toBe(decision);
    expect(Date.now() - started).toBeLessThan(2000);
  };

  it('judges 3000 loops that scan nothing', () => {
    judgedWithin('while true; do sleep 1; done; '.repeat(3000), 'allow');
  });

  it('judges 2000 nested loops that scan nothing', () => {
    judgedWithin(`${'while true; do '.repeat(2000)}sleep 1; ${'done; '.repeat(2000)}`, 'allow');
  });

  it('judges one loop holding 3000 spans that scan nothing', () => {
    judgedWithin(`while true; do echo ${'$(date) '.repeat(3000)}; done`, 'allow');
  });

  it('finds a scan after 5000 plain commands', () => {
    judgedWithin(`${'echo x; '.repeat(5000)}until pgrep -f jest; do sleep 1; done`, 'waitLoop');
  });

  it('finds a scan in a loop holding 3000 other commands', () => {
    judgedWithin(`while true; do ${'echo x; '.repeat(3000)}pgrep -f jest; done`, 'waitLoop');
  });
});
