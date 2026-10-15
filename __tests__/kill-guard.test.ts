import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/kill-guard.sh is the PreToolUse hook wired in
// harness/kiko/hooks/hooks.json under the Bash tool. It reads the hook's
// tool_input JSON payload from stdin, tokenizes the command line (dropping
// `#` comments, and recursing into $(...)/backticks, a shell's `-c`/`-lc`
// argument, a heredoc or here-string a shell reads as its script, and an
// `eval` string),
// and prints the documented deny JSON when the command is a pkill/killall,
// a kill/pkill/killall reached through a pattern (xargs, a subshell), or a
// process-group/broadcast kill (0, a negative pid, `--` then a negative
// pid), any `git stash` subcommand, a heredoc whose delimiter is not
// quoted, or a git history change (`apply`, `merge`, `rebase`, `pull`,
// `cherry-pick`, `revert`, `am`) aimed at the main checkout other than a
// fast-forward-only update or a recovery option (the last three with a
// WHAT/DETAILS/WHY/HOW/DO-NOT reason). It must
// ALWAYS exit 0 — even on malformed input — so a broken guard
// never blocks the Bash tool itself. See scripts/checks/kill-guard.js for
// the full rationale.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard.sh');

// The guard expands `~` and `$HOME` from HOME; pinning it keeps the
// main-checkout rows independent of the machine running the suite.
const HOME_DIRECTORY = '/Users/drizzer14';

const run = (payload: string): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, HOME: HOME_DIRECTORY },
  });

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
  'pgrep x | xargs -iR kill R',
  'pgrep x | xargs -eS kill',
  'pgrep x | xargs -lP kill',
  'pgrep x | xargs -0iR kill R',
  'pgrep x | xargs -tiR kill R',
  'pgrep x | xargs --max-procs 2 kill',
  'pgrep x | xargs --max-args 1 kill',
  'pgrep x | xargs --arg-file f kill',
  'pgrep x | xargs --max-p 2 kill',
  'pgrep x | xargs -a f kill',
  'env -S "pkill x"',
  'env --split-string "pkill x"',
  'env --split-string="pkill x"',
  'env --s "pkill x"',
  'env -i -S "pkill x"',
  'env -iS "pkill x"',
  'env -S"pkill x"',
  'env -u FOO -S "pkill x"',
  'env -P /bin pkill x',
  'env -C /tmp pkill x',
  'env -a name pkill x',
  'env --argv0 name pkill x',
  'sudo -h host pkill x',
  'sudo --user me pkill x',
  'sudo --close-from 5 pkill x',
  'sudo --chdir /tmp pkill x',
  'sudo --host host pkill x',
  'sudo --prompt p pkill x',
  'sudo --chroot / pkill x',
  'sudo --command-timeout 5 pkill x',
  'sudo --other-user me pkill x',
  'sudo --role r pkill x',
  'sudo --type t pkill x',
  'sudo --u me pkill x',
  'timeout --s 9 5 pkill x',
  'nice --adj 5 pkill x',
  'stdbuf --output L pkill x',
  'stdbuf --o L pkill x',
  'stdbuf -oL pkill x',
  'stdbuf -o L pkill x',
  'stdbuf -i0 -o0 pkill x',
  'time pkill x',
  'time -o /tmp/timing pkill x',
  'time -f %e pkill x',
  'time --output /tmp/timing pkill x',
  'time --format %e pkill x',
  "echo `echo it's` ; pkill x",
  '[[ x =~ (a)#b ]]; pkill x',
  '[[ x == (a|b)#c ]]; pkill x',
  '[[ x =~ a|(b)#c ]]; pkill x',
  'ls (a|b)#c ; pkill x',
  "cat <<$'EOF'\nit's\nEOF\npkill x\n$EOF",
  'cat <<$"EOF"\nit\'s\nEOF\npkill x\n$EOF',
  'cat <<$"EOF"\nit\'s\n$EOF\npkill x\nEOF',
  'cat <<E$"OF"\nit\'s\nE$OF\npkill x\nEOF',
  'cat <<E$"OF"\nit\'s\nEOF\npkill x\nE$OF',
  'cat <<$"EOF"\nEOF\nit\'s\n$EOF\npkill x',
  'cat <<E$"OF"\nEOF\nit\'s\nE$OF\npkill x',
  'cat <<$"EOF"\n$EOF\nit\'s\nEOF\npkill x',
  'cat <<E$"OF"\nE$OF\nit\'s\nEOF\npkill x',
  'cat <<$"EOF"\n$EOF\necho "\nEOF\npkill x\n"',
  '2>/dev/null pkill x',
  '>/dev/null pkill x',
  'cat <<"E\\"OF"\nit\'s\nE"OF\npkill x\nE\\"OF',
  'cat <<"E\\\\OF"\nit\'s\nE\\OF\npkill x\nE\\\\OF',
  'cat <<"E\\$OF"\nit\'s\nE$OF\npkill x\nE\\$OF',
  'cat <<"E\\`OF"\nit\'s\nE`OF\npkill x\nE\\`OF',
  'exec -a name pkill x',
  'echo hi |\\\npkill x',
  'ls (a|b)#c |\\\npkill x',
  'kill 00>/dev/null',
  'kill -9 000>/dev/null',
  'kill 1234 00>/dev/null',
  '12>/dev/null pkill x',
  '>|/dev/null pkill x',
  '2>|/dev/null pkill x',
  'echo \\>| pkill x',
  'echo \\>& pkill x',
  '(2>/dev/null pkill x)',
  '>! /dev/null pkill x',
  '>>! /dev/null pkill x',
  'bash <<< "pkill x"',
  "sh <<<'pkill x'",
  'zsh <<< "sudo pkill x"',
  '$(which pkill) -f foo',
  '`command -v killall` Simulator',
  '"$(which pkill)" -f foo',
  '$(true)pkill x',
  '$(command -v kill) -9 -1',
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
  'ls | xargs -iR echo R',
  'ls | xargs -0iR grep foo R',
  'ls | xargs -tiR echo R',
  'ls | xargs --replace=R echo R',
  'env -P /bin ls',
  'env -iS "echo hi"',
  'env --split-string="echo pkill"',
  'sudo --close-from 5 ls',
  'stdbuf -oL ls',
  'time -o /tmp/t ls',
  'npm run check:all',
  '# pkill x is banned here',
  'echo a#b',
  `echo \${#x} $#`,
  '(kill 1234)',
  '{ kill "$pid"; }',
  'command -v pkill',
  'kill 1234 &>/dev/null',
  'kill $PID 2>/dev/null',
  'FOO=1 npm test',
  'time npm test',
  'eval "echo hi"',
  "bash -lc 'npm test'",
  '(echo hi)# c; pkill x',
  "cat <<$'EOF'\nit's\nEOF",
  'cat <<"E\\"OF"\nit\'s\nE"OF',
  'exec -a name npm test',
  'kill 1234 0>/dev/null',
  'kill 1234 10>/dev/null',
  'kill $PID 2>&1',
  'echo x >| pkill',
  'echo x >! pkill',
  'bash <<< "npm test"',
  '$(git rev-parse HEAD)',
  'echo $(date)',
  '$(command -v kill) 1234',
  'PID=$(pgrep -f metro)',
  'X=$(command -v pkill) npm test',
  'pid=1234; kill $pid',
  'sleep 30 & pid=$!; kill "$pid"',
  'pid=$(pgrep -f metro); kill "$pid"',
  'pid=-1; pid=$(cat pid.txt); kill -9 $pid',
  // A kill target or a command word is judged as written: a variable the command assigns is never
  // read into it (only a write target and a git directory are), so a `$pid` is always "your own".
  'pid=-1; kill -9 $pid',
  'pid=0 && kill "$pid"',
  `export pid=-1234; kill -9 \${pid}`,
  'c=pkill; $c node',
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
  '(2>/dev/null git stash)',
  '$(true)git stash',
  '`true` git stash',
  'bash <<< "git stash"',
  "cat > f.md <<'EOF'\n- `git stash` is banned\nEOF",
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
  "bash <<< 'cat <<X\nhello\nX'",
];

// A quoted heredoc body that no shell runs is text: a note or a commit message may show any
// command in backticks. The body is judged for a kill or a git stash only (it can still be piped
// to a shell), and a variable the command assigns never reaches into it.
const HEREDOC_DATA_COMMANDS: string[] = [
  "cat > f.md <<'EOF'\n- `pid=-1; kill -9 $pid` denies\nEOF",
  "git commit -F - <<'EOF'\ndocs: the guard reads `pid=-1; kill -9 $pid` as a group kill\nEOF",
  'git commit -m "$(cat <<\'EOF\'\ndocs: `pid=-1; kill -9 $pid` now denies\nEOF\n)"',
  "pid=-1; cat > notes.md <<'EOF'\nkill -9 $pid\nEOF",
  "cat > f.md <<'EOF'\nthe guard denies `git commit-tree` in every form\nEOF",
  "git commit -F - <<'EOF'\nfix: deny `git commit-tree`\nEOF",
  "cat > f.md <<'EOF'\n- `export GIT_CONFIG_KEY_0=core.hooksPath` denies\nEOF",
  "cat > f.md <<'EOF'\n- `git -c include.path=/tmp/x commit` denies\nEOF",
  "cat > f.md <<'EOF'\n- `git config --unset core.hooksPath` denies\nEOF",
  "cat > f.md <<'EOF'\n- `git commit --no-verify` denies\nEOF",
  "cat > f.md <<'EOF'\n- `git -C /Users/drizzer14/Developer/Projects/pff-ios merge x` denies\nEOF",
  "cat > f.md <<'EOF'\n- `while ps | grep jest; do sleep 1; done` denies\nEOF",
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
// there breaks every hook in every session: git apply/merge/rebase/pull/
// cherry-pick/revert/am aimed at it is denied, except a fast-forward-only
// update and the recovery options; the same commands anywhere else pass.
const MAIN_CHECKOUT = '/Users/drizzer14/Developer/Projects/pff-ios';
const WORKTREE = '/Users/drizzer14/orca/workspaces/pff-ios/shares-assets-research';

// [payload cwd, command]
const MAIN_CHECKOUT_COMMANDS: [string, string][] = [
  [MAIN_CHECKOUT, 'git merge feat/x'],
  [MAIN_CHECKOUT, 'git apply x.patch'],
  [MAIN_CHECKOUT, 'git rebase main'],
  [MAIN_CHECKOUT, 'git merge --no-ff feat/x'],
  [MAIN_CHECKOUT, 'git merge --squash feat/x'],
  [MAIN_CHECKOUT, 'git merge --ff-only --no-ff feat/x'],
  [MAIN_CHECKOUT, 'git pull'],
  [MAIN_CHECKOUT, 'git pull origin main'],
  [MAIN_CHECKOUT, 'git pull --rebase'],
  [MAIN_CHECKOUT, 'git pull --ff-only --rebase'],
  [MAIN_CHECKOUT, 'git cherry-pick 1a2b3c4'],
  [MAIN_CHECKOUT, 'git revert HEAD'],
  [MAIN_CHECKOUT, 'git am x.patch'],
  [MAIN_CHECKOUT, 'git apply --stat --apply x.patch'],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} pull --no-ff`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} cherry-pick 1a2b3c4`],
  // A directory the command assigns is read into `-C`.
  [WORKTREE, `d=${MAIN_CHECKOUT}; git -C $d merge feat/x`],
  [WORKTREE, `export d=${MAIN_CHECKOUT} && git -C "\${d}" pull --no-ff`],
  [WORKTREE, 'cd ~/Developer/Projects/pff-ios && git merge feat/x'],
  [WORKTREE, 'cd $HOME/Developer/Projects/pff-ios && git merge feat/x'],
  [WORKTREE, `cd "\${HOME}/Developer/Projects/pff-ios" && git rebase main`],
  [WORKTREE, 'cd && cd Developer/Projects/pff-ios && git merge feat/x'],
  [WORKTREE, 'git -C ~/Developer/Projects/pff-ios merge feat/x'],
  [WORKTREE, 'git --git-dir=$HOME/Developer/Projects/pff-ios/.git rebase main'],
  [WORKTREE, 'git --work-tree ~/Developer/Projects/pff-ios apply x.patch'],
  [WORKTREE, 'git -C /users/drizzer14/developer/projects/PFF-IOS merge feat/x'],
  ['/USERS/drizzer14/Developer/Projects/pff-ios', 'git merge feat/x'],
  [WORKTREE, `GIT_DIR=${MAIN_CHECKOUT}/.git git merge feat/x`],
  [WORKTREE, `GIT_WORK_TREE=${MAIN_CHECKOUT} git apply x.patch`],
  [WORKTREE, `env GIT_DIR=${MAIN_CHECKOUT}/.git git rebase main`],
  [WORKTREE, 'GIT_DIR=~/Developer/Projects/pff-ios/.git git merge feat/x'],
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
  [MAIN_CHECKOUT, 'cd /tmp || git merge feat/x'],
  [MAIN_CHECKOUT, 'cd /tmp & git merge feat/x'],
  [MAIN_CHECKOUT, 'cd /tmp | git merge feat/x'],
  [MAIN_CHECKOUT, 'pushd /tmp; pushd; git merge feat/x'],
  [WORKTREE, `cd ${MAIN_CHECKOUT} || true; git merge feat/x`],
  [`${MAIN_CHECKOUT}/.claude/worktrees`, 'git merge feat/x'],
  [`${MAIN_CHECKOUT}/.claude`, 'git merge feat/x'],
  [WORKTREE, `cd ${MAIN_CHECKOUT} >/dev/null 2>&1 && git merge feat/x`],
  [WORKTREE, `cd ${MAIN_CHECKOUT} &>/dev/null && git merge feat/x`],
  [WORKTREE, `cd ${MAIN_CHECKOUT} 2>&1; git rebase main`],
  [WORKTREE, `pushd ${MAIN_CHECKOUT} >&- && git pull origin main`],
  [MAIN_CHECKOUT, 'false && cd /tmp; git merge feat/x'],
  [MAIN_CHECKOUT, 'false || cd /tmp; git merge feat/x'],
  [MAIN_CHECKOUT, 'true | cd /tmp; git merge feat/x'],
  [MAIN_CHECKOUT, 'pushd /tmp; popd; git merge feat/x'],
  [WORKTREE, `cd ${MAIN_CHECKOUT} || exit 1; git merge feat/x`],
  [MAIN_CHECKOUT, '>/dev/null git merge feat/x'],
  [WORKTREE, `cd ${MAIN_CHECKOUT}>/dev/null && git merge feat/x`],
  [WORKTREE, `cd > /dev/null ${MAIN_CHECKOUT} && git merge feat/x`],
  [MAIN_CHECKOUT, 'git fetch && cd /tmp/a && make && cd /tmp/b; git merge feat/x'],
  [MAIN_CHECKOUT, 'false &&\ncd /tmp; git merge feat/x'],
  [WORKTREE, `cd ${MAIN_CHECKOUT} >|/dev/null && git merge feat/x`],
  [WORKTREE, `cd ${MAIN_CHECKOUT} 2>|/dev/null && git merge feat/x`],
  [WORKTREE, `pushd ${MAIN_CHECKOUT} >|/dev/null; git merge feat/x`],
  [MAIN_CHECKOUT, '>|/dev/null git merge feat/x'],
  [MAIN_CHECKOUT, '(2>/dev/null git merge feat/x)'],
  [MAIN_CHECKOUT, '>! /dev/null git merge feat/x'],
  [MAIN_CHECKOUT, '$(true)git merge feat/x'],
  [MAIN_CHECKOUT, 'git 10>/dev/null merge feat/x'],
  [WORKTREE, `$(true)cd ${MAIN_CHECKOUT} && git merge feat/x`],
  // No `.git` there: not a worktree, so git would run in the main checkout.
  [`${MAIN_CHECKOUT}/.claude/worktrees/agent-1`, 'git merge feat/x'],
  [MAIN_CHECKOUT, `cd ${MAIN_CHECKOUT}/.claude/worktrees/agent-1 && git rebase main`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT}/.claude/worktrees/agent-1 merge feat/x`],
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
  [MAIN_CHECKOUT, 'git merge --ff-only feat/x'],
  [MAIN_CHECKOUT, 'git merge --ff-only 1a2b3c4'],
  [MAIN_CHECKOUT, 'git pull --ff-only'],
  [MAIN_CHECKOUT, 'git pull --ff-only origin main'],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} merge --ff-only 1a2b3c4`],
  [WORKTREE, `git -C ${MAIN_CHECKOUT} pull --ff-only`],
  [MAIN_CHECKOUT, 'git apply --check x.patch'],
  [MAIN_CHECKOUT, 'git apply --stat x.patch'],
  [WORKTREE, 'cd ~/orca/workspaces/pff-ios/shares-assets-research && git merge feat/x'],
  [MAIN_CHECKOUT, 'git -C ~/orca/workspaces/pff-ios/shares-assets-research merge feat/x'],
  [WORKTREE, 'GIT_DIR=/tmp/scratch/.git git merge feat/x'],
  [WORKTREE, 'git pull'],
  [WORKTREE, 'git cherry-pick 1a2b3c4'],
  [WORKTREE, 'git revert HEAD'],
  [WORKTREE, 'git am x.patch'],
  [MAIN_CHECKOUT, `cd ${WORKTREE}; git merge feat/x`],
  [MAIN_CHECKOUT, `cd ${WORKTREE}\ngit merge feat/x`],
  [MAIN_CHECKOUT, `pushd ${WORKTREE} && git merge feat/x`],
  [MAIN_CHECKOUT, 'git am --resolved'],
  [MAIN_CHECKOUT, 'git rebase --edit-todo'],
  [MAIN_CHECKOUT, 'git rebase --show-current-patch'],
  [MAIN_CHECKOUT, 'git am --show-current-patch'],
  [MAIN_CHECKOUT, `cd ${WORKTREE} >/dev/null 2>&1 && git merge feat/x`],
  [MAIN_CHECKOUT, `cd ${WORKTREE} || exit 1; git merge feat/x`],
  [MAIN_CHECKOUT, `cd ${WORKTREE} || return; git merge feat/x`],
  [WORKTREE, 'pushd /tmp && popd && git merge feat/x'],
  [MAIN_CHECKOUT, `echo a && cd ${WORKTREE} &&\ngit merge feat/x`],
  [MAIN_CHECKOUT, `git fetch && cd ${WORKTREE} && npm test &&\ngit merge feat/x`],
];

// Recovery from a stuck operation stays allowed in the main checkout.
const RECOVERY_IN_MAIN_CHECKOUT: string[] = [
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'am',
].flatMap((subcommand) =>
  ['--abort', '--quit', '--skip', '--continue'].map((option) => `git ${subcommand} ${option}`),
);

// The tracked githooks/ run the typecheck on every commit and merge commit, so a commit or merge
// that skips them — `--no-verify` or commit's `-n` — is denied. Each spelling is checked alone,
// inside a flag cluster, through a global option, and inside a shell string.
const NO_VERIFY_COMMANDS: string[] = [
  'git commit --no-verify',
  'git commit -n',
  'git commit -anm x',
  'git commit -nm "msg"',
  'git commit -vn',
  'git commit -a -n -m x',
  'git commit -m x --no-verify',
  'git commit --amend -n',
  'git commit --no-verif -m x',
  'git commit --no-v -m x',
  'git commit -m x -n',
  'git commit --message x --no-verify',
  `git -C ${WORKTREE} commit --no-verify`,
  `git -C ${WORKTREE} commit -m x -n`,
  `git -C ${MAIN_CHECKOUT} commit --no-verify -m x`,
  'git merge --no-verify',
  'git merge --no-ff --no-verify feature',
  'git merge feature --no-verify',
  'sh -c "git commit --no-verify -m x"',
  "bash -c 'git commit -n -m x'",
  'sh -c "git merge --no-verify feature"',
  'git add -A && git commit -n -m x',
  'cd /tmp/scratch && git commit --no-verify',
  'sudo git commit -n',
  'env FOO=1 git commit --no-verify',
  'echo $(git commit -n)',
  '(git commit -n)',
  'git commit -m "$(cat <<\'EOF\'\nfix: thing\nEOF\n)" --no-verify',
  'git pull --no-verify',
  'git pull --no-verify origin main',
  'git pull --rebase --no-verify',
];

// A change to the git config that holds core.hooksPath switches the hooks off for every worktree: a
// `-c` or `--config-env` entry for one command, a GIT_CONFIG_* variable in front of the command, or
// a `git config` that writes or unsets the key or removes or renames its section. git reads each
// `--long` option as an exact name or a unique prefix, so `--unset-a` is `--unset-all`; an option
// that is ambiguous or unknown denies when the command names the key (fail closed).
const CONFIG_REWRITE_COMMANDS: string[] = [
  'git -c core.hooksPath=/dev/null commit -m x',
  'git -c core.hooksPath=/dev/null merge feature',
  'git -c CORE.HOOKSPATH=/dev/null commit -m x',
  'git -c core.hookspath= commit -m x',
  'git -c user.name=x -c core.hooksPath=/dev/null commit',
  'git --config-env=core.hooksPath=HOOKS commit -m x',
  'git --config-env core.hooksPath=HOOKS commit',
  `git -C ${WORKTREE} -c core.hooksPath=/dev/null commit -m x`,
  "bash -lc 'git -c core.hooksPath=/dev/null commit'",
  'git -c core.hooksPath=/dev/null pull',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
  'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x GIT_CONFIG_KEY_1=CORE.HOOKSPATH GIT_CONFIG_VALUE_1= git commit -m x',
  'env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hookspath GIT_CONFIG_VALUE_0=/dev/null git merge feature',
  'GIT_CONFIG_PARAMETERS="\'core.hooksPath=/dev/null\'" git commit -m x',
  "GIT_CONFIG_PARAMETERS=\"'user.name=x' 'core.hookspath=/dev/null'\" git commit -m x",
  'git config core.hooksPath /dev/null',
  'git config core.hooksPath ""',
  'git config --local core.hooksPath ""',
  'git config --global core.hooksPath /dev/null',
  'git config --unset core.hooksPath',
  'git config --unset-all core.hooksPath',
  'git config --global --unset CORE.HOOKSPATH',
  'git config --add core.hooksPath /dev/null',
  'git config --replace-all core.hookspath /dev/null',
  'git config set core.hooksPath /dev/null',
  'git config unset core.hooksPath',
  'git config -f .git/config core.hooksPath /dev/null',
  `git -C ${WORKTREE} config core.hooksPath ""`,
  'sh -c "git config --unset core.hooksPath"',
  'git add -A && git config core.hooksPath /dev/null',
  'git config --unset-a core.hooksPath',
  'git config --unset-al core.hooksPath',
  'git config --global --unset-a CORE.HOOKSPATH',
  'git config --repl core.hooksPath x',
  'git config --ad core.hooksPath x',
  `git -C ${WORKTREE} config --unset-a core.hooksPath`,
  'git config --fil .git/config --unset-a core.hooksPath',
  'git config -f .git/config --unset-a core.hooksPath',
  'git config --rem core',
  'git config --remove-section CORE',
  'git config --rename-section core x',
  'git config --ren Core x',
  'git config remove-section core',
  'git config rename-section core x',
  'git config --value=x core.hooksPath y',
  'git config --value x core.hooksPath y',
  'git config --un core.hooksPath',
  'git config --re core',
  'git config --bogus core.hooksPath',
];

// The one-action commits the coordinator runs in the main checkout, and git spellings that only
// look like a bypass: `-n` is a message, a log limit, or merge's --no-stat.
const ALLOWED_COMMIT_COMMANDS: string[] = [
  'git commit -m "-n"',
  'git commit -m "use --no-verify never"',
  'git commit -m x',
  'git commit -amn',
  'git commit --message=-n',
  'git commit --message -n',
  'git commit -F -',
  'git commit -- -n',
  'git commit --amend --no-edit',
  'git log -n 3',
  'git log -n3',
  'git merge --ff-only abc1234',
  `git -C ${WORKTREE} merge -n feature`,
  'git -c user.name=x commit -m y',
  'git -c core.pager=cat log',
  'git -c core.hooksPath=/dev/null status',
  'git commit -m x # -n',
  'echo git commit -n',
  'git -C /tmp/scratch log -n 3',
  `git -C ${MAIN_CHECKOUT} commit -m "docs: x"`,
  `git -C ${MAIN_CHECKOUT} commit -- HANDOFF.md -m "x"`,
  `git -C ${MAIN_CHECKOUT} log -n 3`,
  `git -C ${MAIN_CHECKOUT} merge --ff-only abc1234`,
  `git -C ${WORKTREE} commit -m "feat: x"`,
  'git commit -m "$(cat <<\'EOF\'\nfix: thing\nEOF\n)"',
  'git config core.hooksPath',
  'git config --get core.hooksPath',
  'git config --local --get core.hooksPath',
  'git config --get-all core.hooksPath',
  'git config --show-origin --get-all core.hooksPath',
  'git config get core.hooksPath',
  'git config --get-a core.hooksPath',
  'git config --li',
  'git config --show-o --get core.hooksPath',
  'git config --get --default x core.hooksPath',
  'git config --def x --get core.hooksPath',
  'git config --list',
  'git config --remove-section user',
  'git config --rem user',
  'git config --unset-a user.name',
  'git config --value x user.name y',
  'git config --bogus user.name',
  'git config user.name x',
  'git config --global --unset user.name',
  'git config --unset core.pager',
  'git config core.hooksPathFoo x',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=cat git commit -m x',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git status',
  'GIT_CONFIG_PARAMETERS="\'core.pager=cat\'" git commit -m x',
];

// `git pull` and a non-fast-forward `git merge` run the merge hooks too, but outside the main
// checkout (where both are denied for another reason) these spellings are not a bypass: their
// `-n` is --no-stat, and --no-verify-signatures is a different option.
const ALLOWED_PULL_AND_MERGE_COMMANDS: string[] = [
  'git merge --no-stat feature',
  'git pull',
  'git pull --ff-only',
  'git pull -n',
  'git pull --no-stat',
  'git pull --no-verify-signatures',
  'git pull -s ours --no-edit',
  'git pull origin main -m x',
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

  it.each([...ALLOWED_COMMANDS, ...ALLOWED_GIT_AND_HEREDOC_COMMANDS, ...HEREDOC_DATA_COMMANDS])(
    'allows: %s',
    (command) => {
      const result = run(payloadFor(command));

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('');
    },
  );

  it.each(MAIN_CHECKOUT_COMMANDS)(
    'denies a git history change on the main checkout: in %s, %s',
    (directory, command) => {
      const reason = denyReasonFor(command, payloadIn(directory, command));

      expectStandardBlock(reason);
      expect(reason).toContain('main checkout');
      expect(reason).toContain('separate detached worktree');
      expect(reason).toContain(`git -C ${MAIN_CHECKOUT} merge --ff-only <sha>`);
    },
  );

  it.each(ALLOWED_OUTSIDE_MAIN_CHECKOUT)('allows: in %s, %s', (directory, command) => {
    const result = run(payloadIn(directory, command));

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it.each(RECOVERY_IN_MAIN_CHECKOUT)('allows recovery in the main checkout: %s', (command) => {
    const result = run(payloadIn(MAIN_CHECKOUT, command));

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it.each(NO_VERIFY_COMMANDS)('denies a commit that skips the hook: %s', (command) => {
    const reason = denyReasonFor(command);

    expectStandardBlock(reason);
    expect(reason).toContain('pre-commit');
    expect(reason).toContain('--no-verify');
    expect(reason).toContain('fix the type error');
  });

  it.each(CONFIG_REWRITE_COMMANDS)('denies a config rewrite of the hooks: %s', (command) => {
    const reason = denyReasonFor(command);

    expectStandardBlock(reason);
    expect(reason).toContain('bash scripts/ensure-git-hooks.sh');
    expect(reason).toContain('leave core.hooksPath as scripts/ensure-git-hooks.sh sets it');
  });

  it('names the config and environment spellings in the DO NOT line', () => {
    const reason = denyReasonFor('git config --unset core.hooksPath');

    expect(reason).toContain('git config core.hooksPath');
    expect(reason).toContain('GIT_CONFIG_');
  });

  it.each(ALLOWED_PULL_AND_MERGE_COMMANDS)('allows: %s', (command) => {
    const result = run(payloadFor(command));

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it.each(ALLOWED_COMMIT_COMMANDS)('allows: %s', (command) => {
    const result = run(payloadFor(command));

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it.each(ALLOWED_COMMIT_COMMANDS)('allows in the main checkout: %s', (command) => {
    const result = run(payloadIn(MAIN_CHECKOUT, command));

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

// The guard's exported `decide`, called in node as a parser only: nothing
// here runs the command text. Its `sentinelKillCommands` and
// `mainCheckoutPath` options exist for the sentinel probe runner and these
// tests; the hook entry point never passes them.
const GUARD = join(__dirname, '../scripts/checks/kill-guard.js');
const SENTINEL = 'kg_sentinel_target';
const DECIDE_SCRIPT = [
  'const { decide } = require(process.argv[1]);',
  'const finding = decide(process.argv[2], JSON.parse(process.argv[3]));',
  'process.stdout.write(finding === null ? "allow" : finding.kind);',
].join('\n');

const decide = (command: string, options: Record<string, unknown> = {}): string =>
  spawnSync('node', ['-e', DECIDE_SCRIPT, GUARD, command, JSON.stringify(options)], {
    encoding: 'utf8',
  }).stdout;

const FAKE_MAIN = mkdtempSync(join(tmpdir(), 'kill-guard-fake-main-'));
mkdirSync(join(FAKE_MAIN, '.claude/worktrees/agent-1'), { recursive: true });
mkdirSync(join(FAKE_MAIN, '.claude/worktrees/stray'), { recursive: true });
writeFileSync(join(FAKE_MAIN, '.claude/worktrees/agent-1/.git'), 'gitdir: elsewhere\n');

describe('kill-guard decide() test-only options (parser only)', () => {
  it.each([
    `${SENTINEL} -x`,
    `bash -c '${SENTINEL} -x'`,
    'kg_senti\\\nnel_target -x',
    `echo 1 | xargs ${SENTINEL}`,
  ])('denies the sentinel as a kill when asked: %s', (command) => {
    expect(decide(command, { sentinelKillCommands: [SENTINEL] })).toBe('kill');
  });

  // A `$"…"` delimiter nested in a `-c` or `eval` string still gets both
  // shell readings.
  it.each([
    'zsh -c "cat <<\\$\\"EOF\\"\nEOF\nit\'s\n\\$EOF\npkill x"',
    'zsh -c "cat <<E\\$\\"OF\\"\nEOF\nit\'s\nE\\$OF\npkill x"',
    'eval "cat <<\\$\\"EOF\\"\nEOF\nit\'s\n\\$EOF\npkill x"',
  ])('denies a nested $"…" heredoc under either reading: %s', (command) => {
    expect(decide(command)).toBe('kill');
  });

  it('allows the sentinel without the option', () => {
    expect(decide(`${SENTINEL} -x`)).toBe('allow');
  });

  it('checks a fake main checkout path only when asked', () => {
    expect(decide('git merge feat/x', { cwd: FAKE_MAIN, mainCheckoutPath: FAKE_MAIN })).toBe(
      'mainCheckout',
    );
    expect(decide('git merge feat/x', { cwd: FAKE_MAIN })).toBe('allow');
  });

  it.each([
    ['.claude/worktrees/agent-1', 'allow'],
    ['.claude/worktrees/agent-1/src', 'allow'],
    ['.claude/worktrees/stray', 'mainCheckout'],
    ['.claude/worktrees', 'mainCheckout'],
  ])('counts %s as a separate worktree only with its own .git: %s', (folder, decision) => {
    const options = { cwd: join(FAKE_MAIN, folder), mainCheckoutPath: FAKE_MAIN };

    expect(decide('git merge feat/x', options)).toBe(decision);
  });

  it.each([`${SENTINEL} -x`, 'git merge feat/x'])(
    'the hook entry ignores both options in its payload: %s',
    (command) => {
      const options = { sentinelKillCommands: [SENTINEL], mainCheckoutPath: FAKE_MAIN };
      const result = run(
        JSON.stringify({ cwd: FAKE_MAIN, tool_input: { command, ...options }, ...options }),
      );

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('');
    },
  );
});
