## The wrapper contract

`scripts/job-queue.sh` is not a `scripts/checks` wrapper: its QUEUED/WAITING/START/DONE lines are its normal stdout, not a failure block.
`scripts/checks/jest-affected.sh` (`make jest-affected`) is a runner, not a `scripts/checks` wrapper
either: its stdout plan line and, for an every-suite path, its exit 3 notice are normal output
(its exit 2 prints a failure block). Detail: `docs/harness/checks.md` "Makefile targets".
A gate forwards the `--list` over-count `warning:` line before QUEUED and prints each
`TIMEOUT-HEAVY` line of its log before the DONE line (the ops skill's "Load rule" has the order).
The rerun and the manual fallback for a TIMEOUT-HEAVY file:
`docs/harness/checks.md` "Clearing a TIMEOUT-HEAVY file".

Every check wrapper in `scripts/checks/` follows the same shape (read
`scripts/checks/_lib.sh` for the exact helper):

- `source "$DIR/_lib.sh"` for `print_block`.
- Comments in a shell script wrap at 100 columns, as in any other source file;
  `npm run check:comment-line-width` checks it (`__tests__/comment-line-width.test.ts`; scope
  in the `comment-line-width.js` bullet below).
- On failure: call `print_block` (a structured WHAT/DETAILS/WHY/HOW/
  DO-NOT block) to stderr, then `exit 2`.
- A missing path is a failure, never a pass. A missing scan root or a missing path argument
  exits 2 with the standard block that names the path (`harness_require_path` in `_lib.sh`).
  A per-file wrapper given a directory exits 2 ("takes a file", `harness_require_file`).
  One exception: `medium.sh` filters deleted files before it calls `dup.sh` and
  `override-guard.sh`, so a deleted file on the medium tier is skipped silently, while a
  direct call with a deleted path exits 2. `component-i18n-namespace.sh` keeps its own `-d`
  block for its fixed root. `__tests__/wrapper-missing-path.test.ts` pins this.
- A per-file wrapper takes one path or none, and refuses more than one. It reads only its
  first argument, so a second path was skipped silently and its findings never reported.
  `harness_require_one_target <check title> "$@"` in `_lib.sh` is the first call of
  `import-order.sh`, `full-word-identifiers.sh`, `comment-line-width.sh`,
  `blank-line-separation.sh`, `feature-imports.sh`, `screen-imports.sh`, `lint.sh` and
  `secrets.sh`: two or more arguments exit 2 with the standard block, whose fix is one run per
  path (or no path for the project-wide scan). The no-argument default is unchanged.
  `dup.sh`, `override-guard.sh` and `security.sh` scan every path they get and stay open to
  several; `dup.sh` also reads `scripts/checks/dup-ceilings.tsv` up front and exits 2 when it
  is missing or malformed. `__tests__/wrapper-one-path.test.ts` pins this.
- On success: **silent**, `exit 0`. A wrapper that prints anything on
  success breaks the "stays silent on success" contract every other
  wrapper and every hook relies on. One exception is the deep,
  manual tier that is NOT hook-wired (`scripts/checks/mutation.sh`):
  `check:deep` is run by hand, never on `Stop`/`SubagentStop`, so the
  hook contract does not apply and it STREAMS Stryker's output to stdout
  live (`"$BIN" run 2>&1 | tee "$tmp"`, exit code via `PIPESTATUS[0]`) so
  a multi-minute run shows progress. It still prints the structured block
  and `exit 2` on failure, and still records the content-dedup pass
  fingerprint on success. Its streaming and exit-code behavior is tested
  against a stub binary through the `KIKO_MUTATION_BIN` seam
  (`__tests__/mutation-stream.test.ts`); the seam defaults to the pinned
  `node_modules` binary, so production and the pinned-version guarantee
  are unchanged. A fast, hook-wired wrapper must still be silent on
  success, with stated exceptions in `security.sh` that write to
  stderr and exit 0, namely (a) the dedup-skip notice (`SKIPPED, not a fresh
  scan`), because a skip exits 0 without scanning and must never read as a
  fresh scan; and (b) the Class B WARNING block, because a non-blocking
  finding is override-eligible and still has to be seen; and (c) the re-scan WARNING, one per
  timed-out rule and file pair that passed its single re-scan (exit 0; see "Semgrep errors fail
  the check too" below). `dup.sh` states
  its own exception: its large-file `WARNING` lines (a listed file at or under its ceiling; see
  "`check:dup` measures the files jscpd skips for size" in SKILL.md), because a measurement of
  tracked debt still has to be seen. Any other large-file finding exits 2. `medium.sh` states
  a third: on a repeated Stop (payload `stop_hook_active: true`) it writes a one-line
  `medium tier: skipped on a repeated Stop` note to stderr and exits 0. A hook that exits 0
  does not feed its stderr back to the agent, unless a later check in the
  same tier fails: the tier's whole stderr is then shown, so a `dup.sh`
  WARNING or a `security.sh` SKIPPED notice can appear beside an unrelated
  failure. It is tracked debt, not that failure; otherwise these (and the `medium.sh` repeated-Stop note, which reaches a human only) are for a
  human or a manual `check:security`/`check:dup` run.
  `__tests__/wrapper-stderr-exit-zero.test.ts` pins this: a `scripts/checks/*.sh` wrapper that
  writes to stderr and exits 0 must be named in the list item that cites that test, and a new one
  without a mention fails; keep `dup.sh`, `medium.sh` and `security.sh` named. The test reads
  the skill through `readSkillText`, so the list item may live in a reference file that SKILL.md
  links to.

  `medium.sh`'s doc step (see `docs/harness/checks.md` "Automatic wiring") has a deadline exit
  shaped like the guard replay's: at hookStarted + the budget that
  `node scripts/checks/guard-replay.js step-budget` prints it stops its own jest pid and exits 2
  with a block that says to run `make doc-suites` by hand; zero suites, a missing jest, an
  unreadable budget or a fingerprint hash failure (while doc files or suites exist) also
  exit 2. A by-hand `make doc-suites` pass records the doc fingerprint and clears the block.
  `harness_doc_suites` also discovers a suite that names a quoted pin-file literal, and
  `harness_doc_suite_fixtures` fingerprints every pin-file literal form that
  discovery accepts (`scripts/checks/` `.pinned` and `.pinned.json`, with or without `../`);
  read both in `scripts/checks/_lib.sh`.

  Another exception, of a different shape: `scripts/checks/kill-guard.sh`
  (+ its sibling `scripts/checks/kill-guard.js`) is a `PreToolUse` hook on
  the Bash tool, not a check wrapper — it has no fail/pass, only allow/deny
  a command before Bash ever runs it, so it does not follow the
  fail-loud/`exit 2` half of the contract either: it ALWAYS exits 0, prints
  nothing on allow, and prints the documented `permissionDecision: "deny"`
  JSON on stdout (never stderr) when the command is a pkill/killall or a
  pattern/process-group kill, and also when node runs but `kill-guard.js`
  cannot load (a failed node run: any non-zero status or signal; fail-closed).
  It has no `print_block`/`_lib.sh` dependency
  and no content-dedup fingerprint — a `PreToolUse` hook runs on every Bash
  call by design, and skipping one because "nothing changed" would mean
  skipping the one call the guard exists to catch. See `docs/harness/checks.md` "Automatic
  wiring" and `harness/kiko/hooks/hooks.json`'s `PreToolUse`
  entry for the wiring, and `kill-guard.js` for the tokenizer. The other
  hook guard, `pre-write-guard.sh`, prints the same deny JSON on stdout but
  exits 2; its paragraph below starts "Another exception, of yet another shape".

  The same tokenizer (user-approved; it binds the user's own sessions
  too) also denies a `git stash` subcommand in command position — `git`
  after the command-position unwrap, its global options skipped
  (`GIT_OPTIONS_WITH_VALUE` lists the ones that consume the next word) —
  and a top-level `<<`/`<<-` heredoc whose delimiter word is non-empty and
  has no quote or backslash in it (`<<$X`, `<<1`, `<<.` deny too; a `<<<`
  here-string and arithmetic `$((…))`, `((…))`, `$[…]` shifts pass).
  The unwrap (shared by the kill and stash checks; read `unwrap`,
  `isLeadIn`, `RESERVED_WORDS`, and `OPTION_WRAPPERS` in `kill-guard.js`
  for the closed sets) skips lead-in words (`(`/`{` group openers,
  reserved words, `NAME=value` prefixes, an end-of-options `--`) and
  wrappers such as `sudo`, `nice`, `time` (`-o file`, GNU `-f format`,
  and `--output`/`--format` take a value), `stdbuf` (`-i`/`-o`/`-e` and
  `--input`/`--output`/`--error` take a value, glued as in `-oL` or
  separate as in `-o L`), `env`, `exec` (`-a name`
  takes a value), `timeout`, `xargs` (BSD `-J`/`-R`/`-S` take a value;
  GNU `-i`/`-e`/`-l` take only a glued value, so in `-iR` or `-eS` the
  `R`/`S` is that value, never a next-word option, and a group holding
  one never takes the next word — `XARGS_GLUED_ONLY_OPTIONS`; the
  optional-value `--replace`/`--eof`/`--max-lines` take only `=value`).
  For every option wrapper (`sudo`, `nice`, `time`, `stdbuf`, `env`,
  `timeout`, `xargs`) and for git's global options, a `--long` option
  listed as taking a value, or any abbreviation of one (`--max-p`,
  `sudo --u me`, `timeout --s 9 5`, `nice --adj 5`, `stdbuf --o L`),
  takes the next word
  (`abbreviatesLongOption`); git rejects abbreviations, so there it only
  over-skips a word, a fail-safe. `sudo` lists its long value options
  (`--close-from`, `--chdir`, `--host`, `--prompt`, `--chroot`,
  `--command-timeout`, `--other-user`, `--role`, `--type`) and `-h`;
  `env` lists `-C`, `-P`, `-a`, `-u` and their long forms. `env`'s
  `-S`/`--split-string` (also glued `-Sstr`, `--split-string=str`, a
  group `-iS`, any leading position, or an abbreviation) is not skipped
  as a value: its string is split into words and re-parsed as the
  command line (`envSplitCommand`). `xargs --rep=R` sets the
  placeholder like `--replace=R`.
  The unwrap also reads a command typed inside a wrapper (read `kill-guard.js`; rows in
  `__tests__/kill-guard-wrapped-commands.test.ts`): `caffeinate` (`-t`/`-w` take a value),
  `arch`, `sandbox-exec`, `script` (BSD `script [-q] [file] cmd`), `screen` (a command
  argument, and `-X stuff|screen|exec|eval`, also with `-r`/`-x`), and `tmux`
  (`new-session`, `new-window`, `split-window`, `respawn-pane`, `respawn-window`, `run-shell`,
  `if-shell`, `display-popup` (`popup` is its alias), `pipe-pane`; `send-keys` words joined in
  order and shell-quoted; a `;` splits tmux commands; a global `-c` text; unique command
  prefixes). The tmux tables are UNVERIFIED (tmux is not installed here; deny-leaning). Every
  `--text`/`--command` value of any `orca` call is judged as a typed line (ruling R2); a next
  word that starts with `--` is not a value. `osascript` text matching the case-insensitive
  regex `/\bdo\s*(?:shell\s*)?script\b/i` (any whitespace; covers "do shell script",
  "do script", `doShellScript`, `doScript`) is denied as kind `osascriptShell`
  (R3: prose false positives are accepted; the sender rewords). A `$'...'` ANSI-C string is
  decoded in the shared quote removal; `$'` opens one only after an odd run of unescaped `$`
  (`opensAnsiCQuote`: `$$'` is a pid then a quote).
  Known limits, NOT denied (each blind spot sits beside the deny): `ssh`; `at` (gap
  `20261023T1404-kiko-harness-h11/1`); an osascript script file or stdin; an orca text in a
  variable, split across sends, or judged by the target terminal's cwd; util-linux
  `script -c`; other `screen -X` commands; the tmux commands inside an `if-shell` argument;
  `caffeinate -ti` (the tool refuses it); a backslash-newline inside a `$` run
  (`$\<newline>$'...'` reads as the opposite quote kind); R3 prose false positives, incl. a
  backticked command and `set doscript to 1`.
  There is no closer stripping: an unquoted `)` ends the segment, like
  `;`. Any shell flag group holding `c` (`-lc`, `-xc`) counts as `-c`,
  and `eval`'s arguments are scanned as a command string. `$(...)`,
  backtick, `$[...]`, and `<(...)`/`>(...)` spans are each scanned as a
  command. A backtick span ends at the first backtick no backslash
  escapes; quotes inside it do not hide that backtick. `$((…))`/`((…))`
  is arithmetic only when its inner paren closes right before the last
  one; then its `<<` is a shift and only its own spans run. A
  backslash-newline is dropped, as the shell does, so a pipe or `&&`
  continued onto the next line still reaches the command there. An
  unquoted `#` at word start is a comment to the newline, so a quote
  inside it hides nothing; a `#` inside `${…}` is not a comment. A `#`
  right after `)` is a comment ONLY when that `)` closes a subshell `(`
  opened at word start in command position; never inside `[[ … ]]` and
  never after a glob group (`ls (a|b)#c`).
  Heredoc bodies: at the newline ending a `<<`/`<<-` operator's line,
  each queued body is skipped up to its delimiter line (quote removal on
  the word; `<<-` strips leading tabs; several heredocs on one line are
  read in order). Body text is never parsed as shell, so a `#`, an
  apostrophe, or a `<<word` in a body hides or denies nothing. Each body
  is still judged on its own, because a body can run (`bash <<'EOF'`,
  `eval "$(cat <<'EOF' …)"`, `ssh host <<'EOF'`, `cat <<'EOF' | sh`). A
  data body is judged for the `DATA_KINDS` kinds (read the set in
  `scripts/checks/kill-guard.js`) by the plain triggers; a run body (eval, `sh -c "$(cat <<…)"`,
  `source /dev/stdin`, a span, `<(...)`) is judged in full, and only a body that a shell
  without `-c` reads as its script is also checked for an unquoted
  heredoc (see "Heredoc bodies and `rules.kinds`" below). An
  unterminated body: the rest of the input is scanned as
  shell (fail closed).
  A shell `-c` flag is matched anywhere in the arguments, not only
  before the command string (errs toward deny). A nested unquoted
  heredoc inside a body that runs is denied only when that body is a
  shell's stdin script (`bash <<'EOF'`); a kill or `git stash` line in
  a body of a typed command is denied, while a heredoc inside a scanned script file is judged
  for the kills and a raw main fast-forward (`SCRIPT_KINDS` in kill-guard.js).
  Here-strings: a `<<<` target that a
  shell without `-c` reads (`bash <<< "…"`) is its script, judged in full
  (a redirect into a guarded folder is a shell write, `bash <<< "git commit-tree HEAD"` a hook
  skip). A command
  substitution in command position (`$(which pkill) -f x`,
  `` `true` git stash ``, `$(true)cd <main> && …`) is judged twice: as
  each guarded name any span in the segment shows, and as the next word
  (a span that prints nothing); so it denies these unquoted,
  space-separated forms when a span names a kill command or builds a
  main-checkout or stash git command. A span glued before the name
  inside quotes is not covered (see the limits list).
  `X=$(…) cmd` stays an assignment. Heredoc delimiter handling: quote
  removal drops a `$` before `'…'` (`$'EOF'` ends at `EOF` in both
  shells); `$"EOF"` differs by shell (bash ends at `EOF`, zsh at `$EOF`),
  so the guard ALWAYS scans every command once per shell reading (bash,
  then zsh) and either finding denies — at any nesting level, because
  the outer text cannot show a `$"…"` nested in a `-c` or `eval` string
  (`\$\"EOF\"`); inside
  double quotes, unescapes `\"`, `\\`, `\$`, and a backslash-backtick
  (`"E\"OF"` ends at `E"OF`); a delimiter line with trailing spaces does
  not end the body (bash agrees); bash's `EOF)` shorthand inside `$(` is
  not recognized as the delimiter line. Redirect words: every redirect
  operator and its target (read `tokenize()` and
  `REDIRECT_OPERATOR_BY_READING` in `kill-guard.js` for the operator
  sets) is dropped wherever it sits — before the command word
  (`2>/dev/null pkill x` denies), glued to a path, or detached
  (`cd dir>/dev/null` reads `dir`). The descriptor rule follows the
  shell reading, and both readings are scanned: in the bash reading any
  unquoted number right before `<`/`>` is the descriptor, in the zsh
  reading only one digit is (so `kill 00>/dev/null` denies). A `(`/`{`
  group opener is split off before that test (`(2>/dev/null pkill x)`
  denies). A `|` or `&` right after an unescaped `<`/`>` belongs to the
  operator: `>|`, `2>|`, `2>&1`, `<&3` are redirects, not pipes or
  backgrounds; an escaped `\>` starts nothing. In the zsh reading `>!`,
  `>>!`, `>&!`, `&>!` are redirects too. `-` is never part of the
  operator (`>&-`, `<<-EOF`). So `kill <pid> 2>/dev/null` and
  `kill <pid> &>/dev/null` are allowed. The agent rule stays
  absolute regardless: never `git stash` or pattern-kill in any form.
  The ONE allowed group kill (user ruling 2026-10-13): `scripts/job-queue.sh` may send TERM to the process group it created for its own job (`set -m`, then the group-TERM form its header shows), only while `pgrep -g` finds a member, never any other group; the lock stays live while any process of that group lives. An agent's own group or pattern kill is still denied.
  Every deny carries the `print_block` WHAT/DETAILS/WHY/HOW/DO-NOT shape
  as plain text in the one JSON reason field; the kill deny keeps its
  one-line reason. Deny/allow cases for each form live in
  `__tests__/kill-guard.test.ts`.

  MAIN-CHECKOUT deny (coordinator ruling): every session's hooks run
  from the main checkout, so a conflict marker there breaks every hook.
  The guard denies the git subcommands in `MAIN_CHECKOUT_SUBCOMMANDS`
  (read the set in `kill-guard.js`; at the time of writing: `apply`,
  `merge`, `rebase`, `pull`, `cherry-pick`, `revert`, `am`) whose write
  target (work tree or git dir) is inside `MAIN_CHECKOUT_PATH`, the one
  constant that pins the path; a folder under
  `<main>/.claude/worktrees/<name>` is a separate worktree, and is
  excluded, only when `<name>/.git` exists (`isInsideMainCheckout`). The target comes from the payload
  `cwd`, from `cd`/`pushd`/`cd -` earlier in the same command — which
  moves the directory across `&&`, `;`, or a newline; before a
  background `&` it moves nothing. The `&` of a redirect (`2>&1`, `>&-`,
  `<&3`, `&>file`, `&>>file`) is NOT a separator, and a redirect word is
  never a `cd` target. A `cd` after `&&`, `||`, or `|` may not have run,
  so both the old and new directory stay possible (after `&&` the old
  one comes back at the next other separator; an `&&`, `||`, or `|` at
  line end continues onto the next line and does NOT release the saved
  directory; a second `cd` in one `&&` chain keeps every earlier
  directory possible too); before a plain `||` both
  stay possible too, except `cd x || exit`/`|| return`, which keeps only
  the new directory. `pushd` pushes, a bare `pushd` swaps, `popd` pops,
  and `+N`/`-N` leave any saved directory possible; a subshell's `cd`
  ends with the subshell — from `git -C` (stacked and relative),
  `--git-dir`, `--work-tree`, and from `GIT_DIR=`/`GIT_WORK_TREE=`
  prefixes (also after `env`). A leading `~`, `$HOME`, or `${HOME}`
  expands to the home directory, a bare `cd` goes home, and the compare
  is case-insensitive (APFS). Nested text (`$(...)`, a `-c` string,
  `eval`, a shell-read body) runs in its segment's directory. Allowed
  there (`leavesMainCheckoutSafe`; read `RECOVERY_OPTIONS` in
  `kill-guard.js` for the closed set): `-h`/`--help`; the recovery
  options (at the time of writing `--abort`, `--quit`, `--skip`,
  `--continue`, `--resolved`, `--edit-todo`, `--show-current-patch`);
  `git apply --check`,
  `--stat`, `--numstat`, `--summary` without `--apply`. A `merge` or `pull` whose only option
  is `--ff-only` (strict, because a later `--no-ff`/`--rebase` overrides it) aimed at main is
  its own kind, `mainFastForward` (typed, cd/`-C`/`--git-dir`/`--work-tree`/`GIT_DIR` forms,
  run bodies, same-command variables, data bodies, scanned scripts); its HOW TO FIX is
  `bash scripts/ff-main.sh <sha>`. Any other merge on main stays `mainCheckout`, whose HOW TO
  FIX also names `scripts/ff-main.sh`. The way out: do the real merge in a separate detached
  worktree, have the coordinator queue `scripts/job-queue.sh verify` on the merge commit, then
  `bash scripts/ff-main.sh <sha>` (it needs the LAST `verify` line of done.log for that full
  sha to be exit 0; read its header; a `harness/kiko` change also needs a plugin.json
  version strictly above main's, and no commit may lower, remove, or make unreadable that
  version while main has a readable one, user ruling 2026-10-18). After the move, when main
  has a `patches/` folder, it runs main's own `node_modules/.bin/patch-package --error-on-fail`
  (header step 8); a missing binary or a failed patch exits 2 AFTER main moved ("main DID
  move"), and a re-run only retries the patch step. A `package-lock.json` or `patches/`
  difference prints one WARNING naming `npm ci`, which the script never runs.
  `scripts/ff-main.sh` needs no exemption: its merge uses
  a variable target. A help or recovery option lets
  the whole command through from ANY argument position, even as another
  option's value (see the limits list). A session
  in the main checkout gets this deny only after the guard merges to
  main, because it runs main's own `kill-guard.js`.

  The `mainMove` kind (user ruling: any command that moves the branch `main` goes through
  `scripts/ff-main.sh`). Source: `scripts/checks/kill-guard-main-moves.js` (`mainMoveTarget`;
  `mainMoveFinding` in `kill-guard.js` calls it), rows in `__tests__/kill-guard-main-moves.test.ts`.
  Two scopes. A `reset`, `symbolic-ref HEAD <ref>` and `update-ref HEAD` (without `--no-deref`)
  move the branch of the work tree they run in, so they count against the main checkout and
  against a linked worktree whose HEAD names `main` (`headNamesMain`);
  `git reset --soft HEAD~1` there is denied (user ruling: "any reset that moves HEAD of
  main"), while `--hard` with no commit (or `HEAD`/`@`) and a `-- <path>` reset stay allowed.
  A command that
  writes the ref by name (`update-ref`, `checkout -B`, `switch -C`, `branch -m|-f|-d`,
  `fetch`/`pull`/`push` into it, `symbolic-ref refs/heads/main`, `worktree add -B`) counts from
  ANY worktree of this repository, since all worktrees share the refs; a `pull` runs
  `fetch --update-head-ok`. A fetch or pull counts too when a `remote.<n>.fetch` refspec from
  `-c`, `--config-env` (value unseen, so it counts) or `GIT_CONFIG_*` can write `main`; an
  `export` or bare assignment of such a refspec is denied by itself
  (`environmentFetchWritesMain`), as one for core.hooksPath is. A command that puts a linked
  worktree onto `main` (`symbolic-ref HEAD <main ref>`, `checkout|switch
  --ignore-other-worktrees main`, `worktree add -f` onto `main`) is a main move, since a reset
  there then moves it. The header of `kill-guard-main-moves.js` is the full list.
  In both scopes a place the text
  cannot name (a `-C` or `cd` target held in a variable, a relative one with no payload `cwd`,
  or a plain command with no `-C` and no `cwd`) fails closed, even when the command assigns the
  variable (the "an assignment can only ADD a deny" invariant below). An unrelated repository
  or a plain folder is no target, so a reset there is allowed; a no-cwd move with an absolute
  `--git-dir` of an unrelated repository is allowed. With cwd in main and `--git-dir=<other>`, a
  reset, `symbolic-ref HEAD` and `update-ref HEAD` stay denied, while a ref-name command is
  judged on the named git directory only and is allowed. `mainMove` is in
  `SCRIPT_KINDS` and `EXPANDED_KINDS` (read both in `kill-guard.js`) and is NOT in `DATA_KINDS`.
  The way out is `bash scripts/ff-main.sh <sha>`. Known limits are in "Known limits" below.

  SHELL-WRITE deny (why: the pre-write guard sees only Edit/Write/
  MultiEdit, so a file a Bash command writes lands unchecked until
  guard-replay at Stop). Rule: deny a Bash write into a guarded tree (read
  `WRITE_GUARDED_TREES` in `scripts/checks/kill-guard.js` for the current list; `harness/kiko/`
  is whole, its scripts, hooks, skills, agents and `.claude-plugin/plugin.json` included), or
  into any `*.yml`/`*.yaml` file (user ruling 2, 2026-10-18).
  (An entry may hold several segments (`.claude/skills`, `harness/kiko`): it matches a resolved
  path inside any worktree of this repository, and an unresolved path fails closed when its
  segments appear as consecutive non-final segments (as written, or with its `.` and `//`
  segments folded); matching is case-folded. A python/node join counts each literal path as a
  folder with a file after it, so `os.path.join('skills', n)` run from `.claude` is denied.
  A `cp`/`mv` is also denied when a folder lands exactly on `<worktree>/.claude` or
  `<worktree>/harness` (`cp -r /tmp/x/.claude .`: the folder may hold a tree), and when a
  recursive copy puts a source's contents there (`cp -r`, `-R`, `-a`; `-T` counts only
  together with one of those, and a recursive `-T` copy counts whatever the source looks
  like): without `-T`, a source ending in `/` or `/.`, or with a glob or variable as its
  last segment (`cp -r /tmp/x/* .claude/`). A file copied into `.claude/` and a slash-less
  folder copied into `harness/` (`cp -r /tmp/kikox harness/`) stay allowed.
  Missing-destination rule: a `cp -r` or `mv` of ONE folder onto a destination that does not
  exist makes the destination a copy of that folder (measured on macOS; `-T` and
  `--no-target-directory` included, so a `gmv -T` twin denies too), so the text cannot say what
  lands there. It is denied when the destination is a missing `<worktree>/.claude`,
  `<worktree>/harness`, or a `.git` folder (`createdFolders`, `guardedPlace` with `missing`);
  it is allowed when the folder exists: without `-T` the copy lands inside it, and a `-T` move
  never lands inside, but it cannot replace a tracked, non-empty `.claude` or `harness`.
  The same `.git` rules: a copy of a folder's CONTENTS into a `.git` folder or a linked worktree's
  `.git/worktrees/<n>/` (a glob, `src/.`, a variable, `cp -rT`, `cp -t .git <glob>`) is
  denied, because it may write `config`, `config.worktree` or the hooks setting
  (`namesGitFolder`, `namesWorktreeGitFolder`, `gitConfigsIn`); a write to a path that names a
  git config file is judged by `namesGitConfig` (`GIT_CONFIG_PATH`: `.git/config`,
  `.git/config.worktree`, `.git/worktrees/<n>/config.worktree`), also when unresolved.
  `scripts/` and `githooks/` match like `src/`: resolved inside any worktree of this repository, or
  unresolved with a non-final folder segment of that name. A YAML file (`YAML_FILE`,
  `isYamlInsideWorktree`; case-insensitive final extension) counts at any depth inside a project
  worktree except under `node_modules/`, and counts when unresolved (fail closed). Resolved and
  NOT covered: a scripts folder under `ios/` or `docs/`. `docs/superpowers` is a guarded tree
  with no parent-folder rule (`TREES_WITHOUT_PARENT_RULE`), so the rest of `docs/` stays
  shell-writable.
  Known limits: (a) an unquoted command-substitution prefix on a write target
  (`echo x > $(pwd)/src/a`) tokenizes as a standalone word, so the guarded path is never seen
  and the write is allowed, for every guarded tree; the quoted form is denied. (b) A `~/...`
  target resolves through HOME and is judged like any resolved path (outside every worktree is
  allowed). (c) `xargs cp`/`mv` into a resolved worktree folder, a prefix such as
  `<wt>/harness/` included, is denied through the YAML marker (`xargs-input.yml`, a YAML file
  inside a worktree); the tree names fill only where the text resolves them. An unresolved
  destination such as `$X/harness/` is denied only for a recursive `cp` or a `mv`, through the
  `src` marker (`$X/harness/src/_`); a plain `cp` there stays allowed. The parent-folder rule
  above is not applied behind `xargs`. (d) A copy of a folder's CONTENTS into a worktree ROOT
  (`cp -r /tmp/x/ .`, `cp -r /tmp/x/. .`, `cp -r /tmp/x/* .`) is allowed for every tree (the
  pinned allowed row is `cp -r /tmp/x/* .`); the contents rule above reaches only the
  destinations it names (`<wt>/.claude`, `<wt>/harness`, a `.git` folder, a linked
  worktree's `.git/worktrees/<n>/`).
  A shell `cp` into a scratch worktree's `scripts/` (the gate-scratch pattern) is now denied:
  build the scratch from a git merge or commit, or use `git archive <sha> scripts |
  tar -x -C <folder>` into a folder that is not a worktree (a `job-queue.sh` run from that copy
  gets exit 3 for verify/gate/check-all on the real queue; use a temporary `KIKO_QUEUE_DIR`;
  the guard judges redirects, `cp`/`mv`,
  `sed`, `tee`, and interpreters, not the archive extractor; not run against the guard, so
  re-verify). Formatter
  `--write` and reads stay allowed. `drizzle/` is
  checked by the pre-write guard and guard-replay for `drizzle/migrations/*.test.ts` (`.ts` is in
  scope); a `.sql` or `.json` there has no pre-write rule, and shipped-migrations covers a shipped
  migration at Stop; `e2e/` joined
  on 2026-10-11 after a python write broke
  `e2e/screenshot/seed/demo-text.ts`; the pre-write guard and guard-replay
  read any `.ts`/`.tsx` outside `EXCLUDED_PREFIXES`, so `e2e/*.ts` is in
  their scope) — a writing redirect,
  an in-place `sed`/`perl`, `tee`, a `cp`/`mv` (also `gcp`/`gmv`) whose
  destination lands in a tree, a python/node write call (a
  `-c`/`-e` one-liner, or a script the interpreter reads from a heredoc
  or here-string on its stdin: `python3 - <<'PY'`, `node <<'JS'`, with a
  quoted delimiter; an unquoted one is also judged, and denies as a
  write when it writes),
  or an in-place edit behind `xargs` (any file), or a `cp`/`mv` behind
  `xargs` whose destination the input may be — at the top level or in
  the nested text the other denies reach, except a heredoc body no shell
  or interpreter reads (text: a commit message, a notes file). Read
  `commandWrite`, `writtenFiles`, `isWritingRedirect`,
  `interpreterProgramOf`, `writeCallTargets`, and
  `writeCallCandidates` in `kill-guard.js` for the closed sets; a write
  call with a literal target "writes" it, one with a variable or
  expression target "may write" (a bare variable, or an expression with
  no string literal of its own such as `Path(name)` or
  `os.path.join(root, name)`: any literal in the code; any other
  expression: its own literals, each also without its leading `/`
  (`root + '/src/x.ts'`), the joined literals, and `<folder>/_` for a
  literal that is itself a tree folder (`os.path.join(root, 'src',
  name)`), plus argv when it reads `sys.argv`/`process.argv`). The
  write calls are python/node `open`/`openSync` with a writing mode,
  `writeFile`/`writeFileSync`/`appendFile`/`appendFileSync`/
  `createWriteStream`, pathlib's `.write_text`/`.write_bytes`/`.open('w')`
  (also a `mode='w'` keyword in any place, `.open(encoding='utf8',
  mode='w')`; the path is its receiver). A `{` in a path
  (a python f-string field, a `.format` placeholder, a brace group)
  makes it unresolved, like `$`. A `cp`/`mv` writes `DIR/<source name>`
  for `-t DIR`, and for three or more operands or a destination ending
  in `/`; `-T` writes the destination itself; with exactly two operands
  both the destination and `destination/<source name>` count, since the
  text cannot tell a folder (so `cp x.ts src` denies). A destination may
  be a folder, and what it copies lands inside it, so a written path that
  is a tree folder itself counts too (`guardedPlace`): `cp -a /tmp/snap/.
  src/` and `cp -T /tmp/x src` deny, and, judged by the resolved path
  rather than the destination word, so do `cp -r /tmp/backup/src .` and
  `mv /tmp/rules .`, while `cp -r /tmp/srcx .` passes. A moved source is
  removed, not written, so moving a tree file out to `/tmp/` passes.
  Behind `xargs` (`xargsCopyMoveTargets`), a `cp`/`mv` is judged by its
  own destination only when the input cannot reach it: a `-t DIR`/
  `--target-directory` value, or, with a placeholder (`-I`, `-J`, GNU
  `-i`/`--replace`), a last operand that does not hold the placeholder.
  The input may carry any name, so each source it fills counts as a
  plain file and as each tree folder's name; so
  `find src … | xargs cp -t /tmp/snaps`,
  `ls src/*.ts | xargs -I{} cp {} /tmp/backup/`, and
  `ls | xargs -I{} cp {} /tmp/bk/src/` pass, and `xargs cp -t src/` and,
  at a worktree root, `ls | xargs -I{} cp -r {} .` deny. For a
  destination the text cannot resolve (`"$BK"/`, a glob, a span) the
  folder-name fills count only for a recursive copy (`-r`, `-R`, `-a`,
  `--recursive`, `--archive`, or a GNU abbreviation such as `--recur`)
  or any `mv`, since a plain `cp` cannot copy a folder: `ls | xargs -I{} cp {} "$BK"/` passes, `ls | xargs
  -I{} cp -r {} "$BK"/` and `… mv {} "$BK"/old/` deny. The input may
  also be a YAML file, so a `cp`/`mv` behind `xargs` whose destination
  RESOLVES inside a project worktree folder (not under `node_modules/`)
  is denied whatever the input files are (fail closed: the names are
  unknowable): `ls | xargs -I{} cp {} .maestro/` denies. An unresolved
  destination gets no YAML check, only the folder-name fills above.
  Known YAML limits: outside `xargs`, a recursive folder copy
  (`-T` included) that holds YAML passes, since the folder's name cannot tell
  (`cp -r /tmp/flows .maestro/` allowed; only a literal `*.yml` path
  denies); an `xargs` `cp`/`mv` whose destination the text cannot
  resolve still lets a YAML file into a worktree (`cd "$X" && ls
  /tmp/*.yml | xargs cp -t .maestro` and `… xargs cp -t "$WT/.maestro"`
  pass, while the tree analog `cd "$X" && ls | xargs cp -t src` denies;
  kept so the backup forms `xargs cp -t "$BK"` and `"$(mktemp -d)"/`
  pass, and the deny's DO NOT line forbids routing through a variable);
  a YAML file under `node_modules/` passes; a move out of a
  YAML path is no write. Use Edit/Write for YAML. The deny hint ends
  "write the literal path, or use Edit or Write". Otherwise (no
  placeholder, so the input is appended last, or a destination holding
  the placeholder) it denies as a write of any file. `git mv` stays
  allowed and is the way to move a file: guard-replay follows it as a
  rename, while a plain `mv` reads as a new file whose every existing
  finding looks new. Worktree test (`isProjectWorktree`): the
  tree must sit at the root of a folder whose `.git` shares this
  checkout's common git directory (an unreadable `.git` counts), so
  another repository's `src/` or a `src/` without `.git` beside it
  passes. Paths resolve from the payload `cwd` and the tracked
  `cd`/`pushd`, case-folded; a path the text cannot resolve (a `$VAR`,
  a glob, a span, a relative path with no known directory) denies when
  a folder in it is named like a tree. Allowed: reads, a redirect to
  `/dev/null` or outside the trees, git itself, a script file, and a
  formatter's or fixer's own `--write` (guard-replay re-checks what it
  changes at Stop). After any `biome check --write`, run
  `node scripts/checks/import-order.js <file>` on each touched file: biome can re-wrap an
  import into a shape kiko-import-order rejects, and only guard-replay at Stop sees it.
  Rows: `__tests__/kill-guard-writes.test.ts`
  (`projectRoot` is a test-only `decide` option). Where it is live:
  `dispatch.sh` runs `kill-guard.js` from the Bash call's own worktree,
  so `hooks.json` is unchanged and no plugin reinstall is needed; a
  session in the main checkout gets it only after the merge to main.

  A shell redirect into a tree is denied inside a `git worktree add` of this repository, or for a
  path the guard cannot resolve; it is not denied inside an unrelated temporary repository, yet
  build its fixture tree with the helpers in `__tests__/test-support/` inside a jest test, or with
  Edit/Write.

  Heavy-job and full-jest deny (the findings `heavyJob` and `fullJest`; why: a whole-repository
  job takes minutes of CPU on a machine every agent and session shares, and two at once make
  Semgrep and jest time out). Rule: deny a typed command that starts a whole-repository job
  outside the queue (`heavyJob`: a heavy `make` target, a heavy `npm run` script, a heavy check
  script, a Semgrep or `security.sh` run whose target is the whole repository or absent) or a
  jest run that would run every suite (`fullJest`: a runner with no test file once option
  values are removed, or an array option of jest-cli directly before a bare word, in the space
  or `=` form, because the option takes the word as one more value; `npm test` needs
  `-- <files>`). Read `HEAVY_MAKE_TARGETS`, `HEAVY_NPM_SCRIPTS`, `HEAVY_SCRIPT`,
  `SEMGREP_OPTIONS_WITH_VALUE`, `MAKE_DRY_RUN_FLAGS` and `JEST_ARRAY_OPTIONS` in
  `scripts/checks/kill-guard.js` for the closed sets, never a copy here; `JEST_ARRAY_OPTIONS`
  is compared with jest-cli's own table by `__tests__/kill-guard-jest-options.test.ts`, and
  Semgrep options match exactly (Semgrep abbreviates nothing). Only the typed command is judged:
  `heavyJob` and `fullJest` are in neither `SCRIPT_KINDS` nor `DATA_KINDS`, so a script file or
  a heredoc body that holds `make verify` is text (`scripts/job-queue.sh` runs `make verify`
  itself). A dry run (`make -n verify`), `make mutable`, `mutation.sh --list`, `security.sh
  <file>`, Semgrep on a subfolder or file, a jest run that names a test file or a lone
  `--testPathPattern` filter, and `--listTests|--help|--version|--showConfig` stay allowed.
  The way out is the queue: `bash scripts/job-queue.sh verify|check-all|security <worktree>
  <label>` or `gate <worktree> <label> <base> <head>`, run in the background and awaited on its
  exit code; a role agent asks the coordinator. A queued command is noted as `rules.queued`
  (`noteQueuedJob`, `isQueueScript`). Rows: `__tests__/kill-guard-heavy-jobs.test.ts`,
  `-jest-runs`, `-jest-options`, `-queue-edges`. Known limits (all allowed; the docs never
  prescribe one of these routes, and (a) is a gap in the run log): (a) a command typed
  inside ssh, at, an osascript script file or stdin, or an orca text held in a variable, split
  across sends, or judged against the target terminal's cwd, is not judged (the unwrap and
  the wrapper blind spots are listed after "The unwrap" paragraph); (b) `make -Nn verify`,
  `make -I -n verify`, `make -o -n verify` and `make -W -n verify` read as a dry run
  (`MAKE_DRY_RUN_FLAGS` lacks `N`; the word test accepts any word); (c) `$PWD/`, `${PWD}/`,
  `$(pwd)` and other `$X` targets for `security.sh` and Semgrep are allowed (only an exact
  `$PWD` names the repository); (d) `cd scripts/checks && bash verify.sh` is allowed (the
  script pattern matches the typed path); (e) runners it does not know are allowed: `node
  node_modules/.bin/jest`, `pnpm jest`, `yarn jest`, `npm exec jest`, `bunx jest`, `semgrep
  ci`; (f) in a repository whose `test` script is not jest (the harness repository runs `node
  --test`), `npm test` is still `fullJest`, which fails closed. Tree segments compare
  lower-cased.

  WAIT-LOOP deny (why: a `while`/`until` loop whose process scan names
  the job it waits for matches its OWN command line, so it never ends;
  the `[j]est` bracket trick only helps while the word appears nowhere
  else in that command line, and a sibling waiter with the same pattern
  deadlocks with it). Rule: deny a Bash command with a `while` or `until`
  loop (condition or body, through its matching `done`) that both lists
  processes and names a watched job where it filters them. Lists
  (`PROCESS_LISTERS`, `listsAllProcesses`, `scanTraits`): `top`,
  `pstree`, `ps` (but a `ps` named by pid with `-p`, `--pid`, or `-q`
  and no `-A`/`-e`/`-a`/`-x`/BSD `a`/`x` lists only those pids: a pid
  wait, not a scan; the `p`/`q` must end its flag group or be glued to
  the pid, so a glued `-o` value such as `-opid,command` is no pid
  option, and a letter after a glued `-o` is no `a`/`e`/`x` flag), or `pgrep` WITH `-f` (any flag group holding `f` before a
  letter that takes a value: `-fu fred` counts, the glued `-ufred` or
  `-Gstaff` does not) or `--full`. Names a job:
  `make verify` (any non-word run between the two words), `check:all`,
  `jest`, `stryker`, `semgrep`, `xcodebuild` (`WATCHED_JOB`, case folded,
  after `[`, `]`, `\` are dropped so `[j]est` and `make[ ]verify` count)
  in the arguments of a filter (`TEXT_FILTERS`: `grep`/`egrep`/`fgrep`/
  `rg`/`ag`/`ack`, `awk`/`gawk`, `sed`/`gsed`, `[`/`[[`/`test`) or of the
  `pgrep -f` itself. The two may sit in different commands of the loop
  (`ps aux | grep jest`, `ps aux > f; grep jest f`), in a `$(...)`/
  backtick span of it (`until [ -z "$(pgrep -f jest)" ]`), or in a `-c`
  string or `eval` text it runs. Loop tracking (`observeWaitLoops`): the
  segments of one line are walked in order; a `while`/`until` (after
  lead-in words: `do`, `then`, a group opener) opens a wait loop, `for`
  and `select` open a loop that is only counted, `done` closes the last
  open one. The scan is judged only when the outermost wait loop's
  `done` closes it (an unclosed `while` never runs, so a wrapped prose
  line starting with `while` in a commit message never denies), and the
  scan flags reset then — so a one-time scan before or after a loop,
  or in another loop, never counts. The
  walk runs at every nesting level the other denies reach (a `-c`
  string, a span, a heredoc body, `eval`), once per segment (linear;
  `__tests__/kill-guard-wait-loops.test.ts` has the step-count rows, `stepsFor`). Reason:
  the standard WHAT/DETAILS/WHY/HOW/DO-NOT block; HOW points to
  `bash scripts/wait-load.sh <load> <timeout>` (chain it with `&&`) for
  a load wait, and to the tool's own `run_in_background` and its exit
  code for a job the agent started. Allowed: a one-time `ps`/`pgrep`
  outside a loop; a loop that scans nothing (`until bash
  scripts/wait-load.sh …`, `until [ -f flag ]`, `while kill -0 <pid>`,
  `while ps -p <pid>`, even with `grep -c jest log` in its body,
  `while ! grep -q … log`); `pgrep` without `-f`
  (`pgrep -x xcodebuild`: a name match cannot see the loop's own
  command line); a bounded `for` loop (it ends). Rows:
  `__tests__/kill-guard-wait-loops.test.ts`. Where it is live: like the
  shell-write deny, `dispatch.sh` runs `kill-guard.js` from the Bash
  call's own worktree, and `hooks.json` is unchanged, so the deny needs
  no plugin reinstall; a session in the main checkout gets it only after
  the merge to main. Only an agent-text change shipped beside it (the
  plugin version bump) reaches a running session after a plugin
  reinstall and `/reload-plugins`.

  SHELL-WRITE deny, git config files and same-command variables. The write target predicate
  (`isGitConfigFile`, `namesGitConfig`) also covers `.git/config`, `.git/config.worktree`, and
  `.git/worktrees/<n>/config.worktree` of any repository, and an unresolved path that spells
  `.git/config` denies; the reason names the git config file and `scripts/ensure-git-hooks.sh`.
  Not denied: `rm` or `mv`-away of `.git/config`, and `git config --edit`. A variable the SAME
  command assigns with a literal value (bare, `export`, `declare`, `typeset`, `local`,
  `readonly`; a later assignment wins; a subshell's scope ends with it; a `NAME=v cmd` prefix and
  an assignment before `&` or `|` do not persist) is expanded in later words, redirect targets,
  and nested text (`expandVariables`, `assignedVariables`, `withVariables`, `isLiteralValue`;
  `findDanger`'s place is `{ directories, variables }`). The expansion reaches only write
  targets (words and redirect targets) and git directories (`git -C $d`). `segmentFinding`
  judges a segment as written first, then, when the command assigned a variable the segment
  reads, once more with the values filled in (`expandedReading`); the second reading reports
  only the kinds in `EXPANDED_KINDS` (read the set in `kill-guard.js`), so an assignment can
  only ADD a deny, never remove one. A git folder the text cannot name (a `-C`/`cd` target in
  a variable) fails closed for `mainMove` even when the command assigns the variable.
  A kill target and a command word are never expanded: `pid=-1; kill -9 $pid` is judged as
  written (an unknown `$pid` is the agent's own) and is not denied. A value that is itself an
  expansion (`$!`, `$(...)`, `$other`) stays unknown; a value over 4 KiB
  (`VARIABLE_VALUE_LIMIT`) is unknown, and one word never expands past 16 KiB
  (`EXPANDED_WORD_LIMIT`). Not tracked: `unset`, `cd $d`, `f+=x`, loop variables; an assignment
  in a branch that may not run counts as run for the expanded reading, which only adds, and the
  raw reading still denies what the text denies. A command's variables live in a persistent
  trie (`setVariable` copies one name's path, `lookupVariable` walks it), so a scope per segment
  needs no fold and an assignment or lookup costs the name's length.
  A variable the command does not assign stays unresolved because failing closed
  would deny `tmp=$(mktemp); cp x "$tmp"` and existing allow rows.

  Script-content kill scan. The guard reads a script file a command runs (`bash|sh|zsh|dash
  <file>`, `source <file>` or `. <file>`, a path run directly whose first line names a
  shell, or a shell or `source /dev/stdin` that a `< file` redirect feeds, including
  `bash < f`) and denies a pkill, killall, or pattern or process-group kill in it (kind
  `scriptKill`; `scriptKillFinding`, `scriptFileOf`, `shellScriptOperand`, `readScriptFile`).
  One level only, a regular file of at most 256 KiB, and only the kinds in `SCRIPT_KINDS`
  (read the set in `kill-guard.js`: kills, a raw `mainFastForward`, and a `mainMove`; a stash
  or write inside it is not judged). A `mainFastForward` or `mainMove` found in a script keeps
  its own kind (`SCRIPT_GIT_KINDS`); any other finding is reported as `scriptKill`. The
  script scan tracks no variables; a data heredoc in a script that prints a raw main
  fast-forward is denied; a non-ff main merge held in a script is not judged. A heredoc inside
  a scanned script is judged for those kinds too; `DATA_KINDS` applies to typed commands only.
  Not read: `cat f | bash` (text piped into a shell) and a script path held in a variable.
  `kill -0`
  and `kill -s 0` send no signal and are harmless ONLY when no later word before the targets can be
  an option: a word matching `/^-[A-Za-z]/`, a word that may expand (a leading `~`, or `$`,
  a backtick, `*`, `?`, `[`, `{`, a subshell placeholder; `mayBeOption` in
  `scripts/checks/kill-guard.js` is the source), or a `-N` word with more words after it.
  A later `-s`, `-n`, or `-sSIG` replaces the 0 with a real signal, so whenever such a word
  appears the kill is judged by its targets. These deny, typed or inside a scanned script:
  `kill -0 -s KILL -1`, `kill -s 0 -s KILL -1`, `kill -0 -n 9 -1`, `kill -0 -sKILL -1`,
  `kill -s 0 -n 9 -1`.
  `$1`..`$9` is a caller's own pid like a named variable; both rules apply to typed commands as
  well as the script scan (`sendsNoSignal`, `isDangerousKillTarget`, `killFinding`).
  `isQueueScript` exempts `scripts/job-queue.sh`
  whose worktree root shares this
  repository's git directory readably; a copy outside a worktree or in another repository
  denies. Known limits, NOT denied: a script built in the same command, a missing or larger
  file, a variable path, a script that sources another, a file for a non-shell interpreter,
  and `make` targets; a `cp -R` copy of a linked worktree counts as this repository. Pinned by
  `__tests__/kill-guard-scripts.test.ts` (every tracked file with a shell shebang, the
  extensionless `githooks/pre-commit` and `pre-merge-commit` included, the routine coordinator
  commands, the queue-script rows).

  Heredoc bodies and `rules.kinds` (null judges every kind; `SCRIPT_KINDS` and `DATA_KINDS` in
  `kill-guard.js` are the closed sets; read them there). A body no shell runs (`cat > f
  <<'EOF'`, `ssh host <<'EOF'`) is data: `nestedFinding` judges it for `DATA_KINDS` (read the
  set in `kill-guard.js`: the kinds the guard judged there before the newer denies; `mainMove`
  is deliberately not in it, so a note that documents a `git reset` is allowed) by the base
  triggers only, with no variable
  tracking, no shell-write
  check, no script scan, and none of the newer triggers (`git commit-tree`, a `GIT_CONFIG_*`
  export, `include.path`, a prefix-resolved `git config` option). So a note or commit message
  that documents those commands in a heredoc is allowed, while a base-trigger text (`git commit
  --no-verify`, a main-checkout merge) in it still denies. A body a shell or eval RUNS is
  judged in full (`rules.outputRuns`, `rulesForSpans`, `RUNNING_COMMANDS`): `bash <<'EOF'`,
  `sh -c "$(cat <<'EOF' ...)"`, `eval "$(cat <<'EOF' ...)"`, `eval ... <<'EOF'`, `source|.
  /dev/stdin <<'EOF'`, a span in command position, and `<(...)`.

  The `internalError` kind: `decide` fails closed, so an error thrown while judging returns an
  `internalError` finding (`INTERNAL_ERROR_REASON_LINES`) and the command is denied. A
  malformed or unreadable payload, an empty command, and a missing node still allow.
  `kill-guard.sh` exits 0 always and denies through its JSON, also when judging crashed. An EXIT
  trap removes its stderr temp file, so a signalled run strands no file.
  A load failure is not an `internalError` finding: when node runs but `kill-guard.js` cannot
  load (missing sibling module, syntax error, any non-zero node exit, a signal), the wrapper
  itself prints a deny ("kill-guard could not load ..."); its DETAILS line names node's status
  and the first error line. Node missing and a malformed payload stay allows. Rows:
  `__tests__/kill-guard-hook-load.test.ts`. A test fixture that copies the guard uses the
  `__tests__/test-support/copy-kill-guard.ts` helper, which copies the guard plus every sibling
  module it requires (derived from the `require('./x')` calls, transitively), never a hand list.

  NO-VERIFY deny (why: the tracked `githooks/pre-commit` and `githooks/pre-merge-commit` run
  `scripts/checks/commit-typecheck.sh`, a typecheck of the staged index; a commit that skips them
  lands a type error on the branch). Rule: deny a `git commit`, `git merge`, or `git pull` that
  skips the hooks: `--no-verify` or an abbreviation of it, commit's `-n` (alone or inside a flag
  group; on `merge` and `pull` `-n` is `--no-stat`, so it is no bypass), `-c core.hooksPath=...`
  or `--config-env=core.hooksPath=...` before the subcommand, and a `NAME=value` prefix that sets
  core.hooksPath through `GIT_CONFIG_COUNT` with `GIT_CONFIG_KEY_<n>`, or through
  `GIT_CONFIG_PARAMETERS`. It also denies a `git config` that writes or unsets core.hooksPath in
  any scope (the `set`/`unset` forms of git 2.46 too), because that switches the hooks off for
  every worktree. Entry points: `skipsHooks` (the `--no-verify`/`-n` options only),
  `rewritesHooksPath`, `runsWithHooksConfig` (the `-c`/`--config-env` entries and the
  GIT_CONFIG_* variables), `environmentSetsHooksPath` in `scripts/checks/kill-guard.js`;
  `hookFinding` combines them for a command that runs. The kind is `noVerify` for
  `--no-verify`/`-n` and `hooksConfig` for the `rewritesHooksPath` and `runsWithHooksConfig`
  findings. A data body uses `dataBodyHookFinding` (`writesCoreHooksPath`,
  `runsWithCoreHooksPath`, `skipsHooks`). Allowed: a
  `--get` read of the key, `git config core.hooksPath` with no value, `-n` after another
  option's value or after `--`, text in a commit message (within the data-body rule below), and
  `git log -n`. The repair route for an unset core.hooksPath
  is `bash scripts/ensure-git-hooks.sh` or `npm ci`; a direct `git config core.hooksPath githooks`
  is denied too. That script also rewrites a same-folder spelling (`~`, an absolute path) to
  `githooks` with one NOTICE and exit 0, only when the last value is in this repository's common
  config and resolves to a githooks folder of a worktree of this repository; any other value
  exits 2 (its header). The pre-commit hook itself: `scripts/checks/commit-typecheck.sh` copies the
  staged index to a temporary folder and runs `tsc --noEmit` there; it fails closed and skips a
  commit whose staged diff touches no file tsc reads (see `docs/harness/checks-internals.md`).
  A person may bypass in their own shell; the deny binds agent Bash calls only. Rows:
  `__tests__/kill-guard.test.ts`, `__tests__/commit-typecheck.test.ts`,
  `__tests__/ensure-git-hooks.test.ts`, `__tests__/kill-guard-hook-skips.test.ts`.

  The `noVerify` kind covers `--no-verify`, `-n`, and `git commit-tree` in every form (it
  writes a commit no hook runs for; `git update-ref` is no `noVerify`, and stays allowed unless
  it moves `main`, which is `mainMove`). The kind `hooksConfig`
  (entry points `rewritesHooksPath`, `environmentSetsHooksPath`, `environmentFinding`) carries a
  reason naming
  `scripts/ensure-git-hooks.sh`. A `git config` long option resolves by git's unique-prefix rule
  (`CONFIG_LONG_OPTIONS`, the union of git 2.38.1 and later-git names, read through
  `resolveConfigLongOption`): an ambiguous or unknown option denies when the command names a
  hooksPath or include key or the `core` section. `--remove-section` and `--rename-section` of
  `core` (case-insensitive, also the subcommand forms) deny. `--value` takes the next word.
  `include.path` and `includeIf.<c>.path` are treated like core.hooksPath (a write, `-c`,
  `--config-env`, or GIT_CONFIG_* denies; a read allows), since the included file can set the
  key. An `export`, `declare -x`, `typeset`, `local`, `readonly`, or bare assignment of
  `GIT_CONFIG_KEY_<n>` to those keys, or of `GIT_CONFIG_PARAMETERS` holding them, denies by
  itself. A `GIT_CONFIG_GLOBAL` or `GIT_CONFIG_SYSTEM` file swap is not judged:
  `scripts/ensure-git-hooks.sh` writes core.hooksPath in the local scope (or rewrites a
  same-folder spelling), which outranks the global
  and system scopes and every file they include, so a swapped file switches nothing off.
  Known limits, NOT denied: a bypass built at run time.

  Probing the kill-guard (rule): SENTINEL probes only. A probe that
  EXECUTES shell text runs ONLY through the committed runner
  `scripts/checks/kill-guard-probe.sh bash|zsh '<probe>'` (read its
  header for the full contract). The probe text writes the sentinel
  command `kg_sentinel_target` in place of any kill command, and a
  test-only fake main folder in place of the real main checkout; judge
  that same text with `decide(text, { sentinelKillCommands:
  ['kg_sentinel_target'], mainCheckoutPath })`. The sentinel and `git`
  stubs sit first on PATH and only log (git also logs its working
  folder); no real command has the sentinel's name. The runner refuses
  (exit 2) text holding `kill` (covers pkill, killall, kill) or
  `pff-ios`, after it folds case, joins line continuations, drops
  `$ ' " \ { } , ( )` and the backtick, and collapses `/./` and `//`;
  it checks a second reading with every `$(…)`, backtick span, `${…}`,
  `$name`, and special parameter taken out whole. It also refuses the
  listed spellings (not every word-building construct; see the limits
  list): a glob character (`?`, `*`, `[`), a brace
  alternative (`{a,b}`, `{a..b}`), any `$'…'` escape but `\n`, `\t`,
  `\\`, `\'`, `\"`, and a `$(…)`, backtick span, `$@`, or `$*` glued to
  other text in one word. So a probe with `[[ ]]`, a glob, or `$?`
  cannot run through it; such a fact needs a sentinel spelling without
  them, or stays parser-only (read the runner's header for the exact
  set). The test-only env var
  `KIKO_PROBE_REFUSE_ALSO` adds refused words; the refusal tests use it
  with the sentinel and a fake folder (`kg/fake_main`). The runner runs each stub once before
  its alarm starts and clears the log, so the alarm bounds only the probe's own work; the
  test-only `KIKO_PROBE_STUB_FIRST_RUN_DELAY=<seconds>` makes a stub sleep on its first call to
  prove it (read the runner's header). A tightening of the guard is proven by a differential
  over every test literal x every cwd, base against HEAD; a hand-picked sample is not proof.
  Method: a `NODE_OPTIONS` `--require` preload, kept in the scratchpad, wraps `decide()` of the
  worktree's `kill-guard.js`. At each call, while the test fixtures still exist, it judges the
  same (command, options) with BASE and HEAD copies extracted by `git archive`, also across a
  fixed set of cwds, and records every flipped pair; classify each as intended or not (H9
  2026-10-18: 43,738 pairs, 0 deny->allow). The preload only calls `decide()`; it never executes
  a command. Timing-bound tests may fail under the preload (overhead); the proof run of the
  suites is the plain one. Classify a probe row by the path it resolves to (and its cwd),
  never by a regex over the command text.
  Writing a red row for a path rule: do not assume `~/` stays unresolved (`resolveDirectory`
  expands HOME). A tree entry of 2 or more segments needs the parent-folder `cp`/`mv` rule and
  a resolved-candidate check in `expressionPaths`. Judge resolved paths, never literal text,
  when a resolved path is available.
  No real kill
  word and no real main path is ever handed to the runner; they appear
  ONLY in NON-executed parser tests (node: string -> `decide()`). The
  `decide(command, options)` options `sentinelKillCommands` and
  `mainCheckoutPath` are test-only: the hook entry passes only
  `{ cwd: payload.cwd }` and ignores both (tested in
  `__tests__/kill-guard.test.ts`). Probe authors always write the
  sentinel. Never write a runner that
  rewrites a kill word by string. Incident: such a runner once ran a
  real kill command because a line continuation dodged the rewrite.

  Known limits (accepted; coordinator ruling). The kill-guard guards
  cooperative agents against ACCIDENTAL commands; it is a heuristic
  tokenizer, not a shell parser, and not an adversarial boundary.
  Stopping rule: an exotic, obfuscated, or run-time-built form is a
  known limit to list here, not a bug to fix. Re-verify each item in
  `kill-guard.js`, `kill-guard-probe.sh`, and their tests.
  - Commit-hook bypass, NOT denied: `git rebase`, `cherry-pick`, and `am` replay commits
    without running pre-commit.
  - NOT denied: a kill or stash through an alias, a function, a script
    file the kill scan does not read (see the script-content scan above), or a variable
    (`$CMD`; a command word and a kill target are never expanded from a same-command
    assignment); a word built at run time
    (`a=pk; ${a}ill x`, `$(printf pk)ill x`, `$(cat name.txt) x`); a
    span glued after the command word (`git$(true) stash`); a span
    glued before the name inside quotes (`"$(true)git" stash`,
    `"$(true)cd" <main> && git merge x`); text piped into a shell
    (`echo "… x" | bash`, `cat <<< "… x" | bash`,
    `bash -c "$(cat)" <<< "… x"`); an ANSI-C here-string into a shell
    (`bash <<< $'… x'`); `exec` oddities and other wrapper forms
    outside the `unwrap` sets.
  - Main-checkout deny, NOT denied: a path through another variable,
    `~user`, a glob, or a symlink; a git alias, script, or function;
    `export GIT_DIR=…` as its own earlier command; `env -C <main>`;
    a help or recovery option
    used as another option's value (`git merge -m --abort x` really
    merges); `cd $VAR` (counts as not main); a span as the `cd` target
    (`cd "$(echo <main>)" && git merge x`).
  - `mainMove` deny, NOT denied: a ref held in a variable, `update-ref --stdin`, an abbreviated
    long option, a push to a remote, `push -d . main` (no colon, so `refspecWritesMain` misses
    it; git itself refuses it while main is checked out, by its receive deny-current-branch
    and deny-delete-current defaults, measured on git 2.38.1; `push . :main` is denied), a git
    folder that aliases main's through a symlink, firmlink or `commondir` (compared as text;
    gap 20261021T0832-kiko-harness-h10/1), `--git-dir=~/x` (the guard reads `~` as the home
    folder, `HOME_PREFIX` in `resolveDirectory`; the shell leaves `~` as is after `--git-dir=`
    and git reads `<cwd>/~/x`), `git config remote.<n>.fetch <refspec into main>` (not
    judged), a key held in a variable (`GIT_CONFIG_KEY_0=$K`), `git -c "$X" fetch -u`, a value
    option before `--ignore-other-worktrees`, and a linked worktree whose HEAD file cannot be
    read (allowed). Script scan: `cat f | bash`, a script path in a
    variable. Over-denied: `isInsideProjectWorktree` matches any prefix folder that is a
    project worktree, so a reset in a repository nested in main's folder and a ref-name move of
    main in a repository nested in ANY worktree are denied; and a `-C`/`cd` target held in a
    variable (fails closed). Detail: "The `mainMove` kind" above.
  - Nested unquoted heredoc in `cat <<'EOF' | bash`,
    `eval "$(cat <<'EOF' …)"`, or `bash -c "$(cat <<'EOF' …)"`: not
    denied. Heredoc delimiter corner cases beyond those modeled above
    (bash's `EOF)` shorthand, trailing spaces).
  - Shell-write deny, NOT denied: a path held in a variable the command
    does not assign, or assigns from an expansion, or a loop
    variable (`sed -i ... "$f"`, `for f in ...; do ... > "$f"; done`) unless
    its text names a tree folder; a `cd` into a tree through a variable
    then a relative path (`cd $VAR/src && echo x > y.ts`; plain
    `cd $VAR && echo x > src/…` IS denied); `eval` of a built string;
    base64 or otherwise encoded code; a path built at run time in the
    interpreter from pieces that never spell a tree folder
    (`Path(root) / ('s' + 'rc') / name`, `'%s/src/x' % root`: a `%`
    placeholder is not read as unresolved, so it passes unless the
    literal resolves into a tree from the working folder); a script
    file that writes (`python3 tool.py`,
    `node x.js`, `bash x.sh`); text piped into a shell or interpreter
    (`cat <<'EOF' | bash`, `cat <<'PY' | python3 -`, `echo … | python3`),
    and an interpreter's `-c` string built by a command substitution
    (`python3 -c "$(cat <<'PY' … PY)"`: its code is the span, not read);
    ruby and perl code of any form (`-e`, a stdin heredoc, `ruby -i`;
    the interpreter has no reader here, and the option forms —
    `perl -C7 -e`, `ruby -W:no-deprecated -e`, several `-e` — are too
    many to chase; guard-replay is the backstop); any
    `find … -exec`/`-execdir`
    command, an in-place edit or a `cp`/`mv` alike
    (`find src -exec sed -i … {} +`, `find /tmp -exec cp {} src/ \;`,
    `find … -exec mv {} rules/ +`, `find … -exec sh -c 'sed -i …
    "$1"' _ {} \;`); `xargs -I{} sh -c '… {}'` (the `{}` is not read as
    the input); a `cp`/`mv` whose destination is a variable (the "SHELL-WRITE deny, git config
    files and same-command variables" paragraph above: only an unassigned or
    expansion-derived variable passes); other writers and tools — `dd of=`,
    `install`, `rsync`, `ditto`, `ln`, `truncate`, `touch`, `patch`, `awk`'s own
    `print >`, `ex`/`vim -c`, a `npx`/`uv run` wrapper
    around python or node, and a python/node write API outside
    the listed calls (`shutil`, `os.open`, `fs.writeSync` on an fd,
    `fs.cpSync`); a symlink into a tree.
  - Shell-write deny, deny-leaning (over-denied): any in-place edit or
    `tee` behind `xargs`, whatever the files; a `cp`/`mv` behind `xargs`
    with neither `-t` nor a placeholder (`xargs cp x /tmp/y/`: the input
    is appended last, so the text cannot pin the destination), or whose
    destination holds the placeholder; a `$VAR`/glob path that
    names a folder `src`, `__tests__`, `rules`, or `e2e` anywhere
    (`> "$TMPDIR/src/x"`); a relative tree path when the payload has no
    `cwd`; an interpreter one-liner or stdin script that writes through a
    BARE variable, or through an expression with no string literal of
    its own (`Path(name)`), while any string literal in it names a tree
    file (it may only read that file; DETAILS says "may write"); a
    write target that holds a literal named exactly like a tree folder
    (`os.path.join('/tmp', 'src')`); a `{` anywhere in a path (`echo x >
    /tmp/{a,b}/src/y` names a tree folder with an unresolved part);
    `sed -i` run GNU-style on
    macOS (`sed -i 's/a/b/' f`, which BSD sed rejects).
  - Wait-loop deny, NOT denied: a pattern held in a variable
    (`pgrep -f "$name"`) or built at run time; a scan in a script file
    the loop calls; `for`/`select` loops and `watch` (a bounded loop
    ends on its own); `pgrep` without `-f`, and `pidof`/`lsof` (a name
    match cannot see the loop's own command line); a loop behind a
    wrapper outside the `unwrap` sets (`time while …`); a job name
    outside the watched six (`check:deep`, `make gate`); a regex class
    that spells a name without its letters (`make[[:space:]]verify`).
    A stdin script (`while bash <<< "pgrep -f jest"; do sleep 1; done`,
    a heredoc body into a shell inside the loop): `scriptOf` reads only
    `-c` and `eval`.
    Over-denied: a lister and a filter naming a watched job anywhere in
    the same outermost loop, even when unrelated (`while ps aux | head
    -1; do grep -q jest f; done`); prose in a heredoc body (a commit
    message) that spells a complete `while`/`until` … `done` loop with a
    scan in it, since a body is judged like the kill and stash denies
    judge it. An UNCLOSED loop is never judged (a wrapped prose line
    starting with `while`/`until` is not a loop).
  - bash 3.2 only (zsh fails): a command after a heredoc inside
    `<(`/`$(` whose body holds an unbalanced paren, and
    `echo $( (echo a)#c ); pkill x`, both run and are not denied.
  - Deny-leaning (over-denied): a failed `cd typo; git merge` counts as
    moved; `pushd -n`/`popd -n` count as moving; from main,
    `cd <wt> || { echo no; exit 1; }; git merge` (a brace group after
    `||` is not read as an exit); `--git-dir=<main>/.git/worktrees/<name>`;
    a `merge --ff-only` with any extra option (that is `mainCheckout`, not `mainFastForward`);
    a heredoc body line that
    literally is a covered command, even when only written to a file
    (write such text with the Write tool, or `git commit -F <file>`);
    every guarded name in any command-position span is tried
    (`$(which python) git stash`, `$(git log --grep kill) 0` deny); from
    main, `"$(git rev-parse --show-toplevel)/x.sh" merge` (the quoted
    span plus path is one word, read as git).
  - Probe runner: not an OS sandbox. Its text checks cannot see a word
    built from a variable holding text, or a main path that does not
    spell `pff-ios`; nor a plain `'…$'` string right before an ANSI-C
    `$'…'` word, a brace alternative holding a quoted space
    (`{g,' '}`), or a command substitution whose output is the word
    (`$(printf '…\141…')`); real git stays reachable by a PATH edit or
    `/usr/bin/git` (it runs in the empty scratch folder).

  Another exception, of yet another shape: `scripts/checks/pre-write-guard.sh`
  (+ `pre-write-guard.js`) is the `PreToolUse` hook on `Edit|Write|MultiEdit` —
  it denies a write BEFORE it lands, rather than checking a file already on
  disk. It DENIES (exit 2, plus the `permissionDecision: "deny"` JSON on
  stdout and the reason on stderr) the moment either Semgrep
  (`rules/semgrep-prewrite.yml`) or one of the `NODE_RULES` checkers in
  `pre-write-guard.js` reports a NEW finding against the proposed post-edit
  content; a check that could not run at all (a Semgrep/Node crash,
  malformed stdin, a timeout) also denies — fail-closed, the opposite of
  `kill-guard.sh`'s allows (a malformed payload, a missing node), though
  kill-guard.sh now also fails closed on a load failure. It has NO content-dedup
  fingerprint, for the same reason `kill-guard.sh` has none: a pre-write
  check must run on every single write by design, not just when something
  changed since last time. Env seams override its defaults for testing
  (`KIKO_PREWRITE_TIMEOUT_MS`, `KIKO_PREWRITE_RULES`,
  `KIKO_PREWRITE_SEMGREP_BIN`, `KIKO_PREWRITE_NODE_BIN` — read
  `pre-write-guard.js` for their exact defaults and the closed `NODE_RULES`
  set). See `docs/superpowers/specs/2026-09-25-pre-write-guard-design.md`
  for the full design and `docs/harness/checks.md` "Automatic wiring" for the hook wiring.

  `mutation.sh` also DIFF-SCOPES by default: it mutates only the CHANGED LINES of the `.ts`/
  `.tsx` source files this branch changed vs the merge-base with
  `${KIKO_MUTATION_BASE:-main}`, passed to Stryker as explicit
  `--mutate` entries (`path:start-end`, one per added-line range; read
  `scripts/checks/mutation-ranges.js` for the parse) that overrides the whole-tree glob — and this
  `--mutate` list REPLACES the config's own `mutate[]` excludes
  wholesale, so the script's own filtering is the only thing excluding
  tests/fixtures/low-logic files on a diff-scoped run. Do not restate
  that exclusion set here — it drifts; read `scripts/checks/mutation.sh`
  directly for the current filter (both the path-pattern exclusion and
  the barrel/`.styles.ts` drop-with-reinclusion step) and
  `docs/harness/documented-exceptions.md` for the mutate-set and sandbox exclusions this
  mirrors. An empty changed set exits 0 (nothing to mutate); a `git
  diff` that fails after the base resolves exits 2 instead (an
  unreadable list never counts as nothing). `KIKO_MUTATION_FULL=1` and
  a base that does not resolve are refused directly (exit 2, the block
  names which case) — the gate never falls back to the whole project
  and never silently mutates nothing. This keeps the manual
  `check:deep` cheap; the diff logic is tested hermetically (a
  throwaway git repo, the real script, an arg-capturing stub) in
  `__tests__/mutation-stream.test.ts`.

  `mutation.sh` also leaves out a changed file whose diff against the
  merge-base touches ONLY comments or whitespace (a comment-only edit of one
  screen once cost a 178-minute run). `scripts/checks/comment-only-changes.js`
  decides it exactly, from the TypeScript compiler's own parse trees of the
  base and HEAD text; its header states how the two are compared and what each
  verdict means. ONE LIST: `mutation.sh` filters `changed` once, right after
  `mutable_source_files`, so `--mutate`, the scorer, the fingerprint, the cap
  and `--list` all read the same entries (`--list` prints each skipped file as
  `skipped (comment-only): <path>`; its count line counts only the mutated
  files, and a file with no added line, a pure rename or a pure deletion, prints
  `skipped (no added lines): <path>` and is not counted). FAIL CLOSED: the script prints a path only when it PROVED the file
  comment-only; a non-`.ts`/`.tsx` file, a new, renamed or deleted one, a
  parse diagnostic, a failing `git show`, `typescript` that cannot be
  required, any exception, and a script that crashes all keep the file. A file
  whose base or HEAD text contains `Stryker` (a `disable`/`restore` directive
  changes the mutant set) or `@jsx` (a pragma changes how the file compiles)
  is kept whatever else changed. A changed colocated test beside a comment-only
  source never keeps it (user ruling 2026-10-14, G1 a): the file mutates nothing, and
  no whole-file keep exists. The changed-files `git diff --name-only`
  (`diff_names` in `scripts/checks/mutation.sh`) runs with `-c core.quotePath=false`, so a
  non-ASCII file name matches. Tests:
  `__tests__/comment-only-changes.test.ts` (the parse cases, one spawn) and
  `__tests__/mutation-comment-only.test.ts` (the wrapper, against the stub).

  `mutation.sh` also CAPS the run: after the file selection and excludes
  above, it counts the files it would mutate and, above
  `MUTATION_FILE_CAP` (30, a plain assignment in the script), prints the
  structured block and exits 2 BEFORE Stryker starts. A patched-runner preflight (after the
  0-file exit and the `--list` exit, before the dedup skip; a 0-file change set exits 0 on an
  unpatched tree) exits 2 the same way when the installed
  `@stryker-mutator/jest-runner` files lack the `kiko-patch: exact covering-test selection`
  marker. `__tests__/stryker-jest-runner-patch.test.ts` pins `@stryker-mutator/jest-runner`,
  `@stryker-mutator/core` and `jest-circus` versions and runs the patched code; an upgrade of
  any of the three re-derives and re-proves the patch (`docs/harness/dependency-hygiene.md`
  "Standing patch"). The scorer fails a TIMEOUT-HEAVY file
  (`TIMEOUT_HEAVY_SHARE`, `TIMEOUT_HEAVY_MINIMUM` in `mutation-score.js`; rule in
  `docs/harness/checks.md`): `mutation-score.js` exits 1, `mutation.sh` exits 2. When it is
  the only failure, the gate reruns the timed-out mutants alone and the final rerun report is
  the verdict. Only if that report still fails or the rerun was skipped does the orchestrator
  prove each timed-out mutant in plain jest or write it in the BATCH READY as equivalent
  (`docs/harness/checks.md`, "Clearing a TIMEOUT-HEAVY file"). Never raise the timeout; no
  allowlist file. `mutation.sh --list` can print a `warning:` line after `changed lines: N`
  for a merged track (`warn_over_count`). Mutation testing
  runs per small change set only (a whole-release run went 10 h 16 min
  with no result): the fix is `KIKO_MUTATION_BASE` set to the change
  set's own base commit, never a raised cap. The coordinator runs it per
  reviewed change set (harness-workflow's "Mutation testing: small change
  sets only"). No env var bypasses the
  cap. `mutation.sh --list` (`make mutable`) prints each file's ranges (`<file> 3-7,12-12 (6 changed lines)`;
  every file prints its ranges), `changed lines: N`, and
  `mutable files: N (cap …)` after the same refusals and the same
  `mutable_source_files` filter, then a `timeout share (history)` line (always
  printed, `none` included; read the printf in `mutation.sh`), then exits (2 above the cap) before
  the dedup skip; it needs no Stryker binary and never takes the global
  lock. Any argument other than `--list` (a typo like `--lsit`) exits 2
  with the structured block before the Stryker-binary check, the lock,
  or the list, so it never starts a run. Every refusal runs BEFORE the content-dedup skip, and the dedup
  fingerprint includes the scope (merge-base sha + selected file list),
  so a pass over a narrow change set never skips a wider or refused one
  at the same HEAD. The cap and the refusals are tested hermetically in
  `__tests__/mutation-cap.test.ts` (29 and 30 files run the stub; 31,
  `KIKO_MUTATION_FULL=1`, a bad base, a failing `git diff` shim, and a
  broad run after a narrow pass fail without it). Every doc that copies
  the cap number is pinned to the assignment by
  `__tests__/mutation-cap-docs.test.ts`; a doc that newly states the
  number goes in its list. A skill in that list is read through `readSkillText`, so a cap
  statement in a linked reference file counts and must match too. The stream, lock, and
  cap tests share their throwaway-repository, stub, and wrapper-run helpers
  through `__tests__/test-support/mutation-repository.ts` (excluded from
  Jest's suite list by `jest.config.js` `testPathIgnorePatterns`, which
  ignores only the non-`*.test.*` files there). Those helpers drop
  the variables in `SCOPE_VARIABLES` (same file; read the set there) from the
  wrapper's env, so a developer's own `export`, or one the verify makes,
  never changes the scope a test runs or lets a row pass without the
  wrapper's own export; a test's own explicit setting still wins. A new env
  switch a wrapper exports joins that set in the same commit.

  `mutation.sh` also gives a watching HUMAN a live progress display and a
  split ETA, so nobody polls the run — its exit code stays the only
  signal an agent waits on (the ops agent's no-poll rule is unchanged). It tees
  Stryker's combined output to a stable, tailable progress log and prints the
  exact `tail -f <path>` command to watch it; the ETA is the cost of a normal
  and of a timed-out mutant, fitted from history (`harness_mutation_costs`; it
  refuses a fit when the timeout shares of the runs are near-equal, and then
  falls back to the median rate plus a timeout floor, using
  `harness_mutation_run_share`), split by this change set's timeout share
  (`harness_mutation_timeout_share`) and THIS run's actual mutant count. It is
  printed LIVE the moment Stryker's own output first reports that count (an
  anchored "N/M tested" token, parsed by `harness_mutation_run_counts`, so a
  "1/2/3" in a test title never counts) — not before the run starts — and an
  "Estimate at N%" update follows at each 10% boundary (only with the timeout
  clause). With no usable history it prints a plain "no estimate" line instead.
  History is keyed by the git COMMON dir (`harness_mutation_history_dir`), so
  all worktrees share it (old per-worktree records are not read); the progress
  log stays per worktree. Beside `history.tsv` (one record per run) a
  `files.tsv` holds per-file tested/timedOut counts per run
  (`harness_mutation_files_append`). Each completed run (a pass OR a
  break-threshold failure — Stryker exit 0, or exit 1 WITH a report; exit 1
  with no report is a crash, as is any other code) is appended to an
  out-of-repo history TSV that feeds the next run's rate. All of this lives in
  the `harness_mutation_*` helpers in `scripts/checks/_lib.sh` (progress-log
  path, history file/append, the pure `harness_fmt_duration` and
  `harness_mutation_rate`, and `harness_mutation_eta_filter` — a pass-through
  pipe stage, not a pure formatter, that streams Stryker's output unchanged
  and prints the one live ETA line when the count first appears) — read those
  for the exact paths, TSV fields, and formats rather than duplicating them
  here, since they drift. The contract that matters: it is all GUARDED and
  MUST NOT change the gate's pass/fail — a missing/corrupt history just means
  "no estimate", and the progress/ETA lines print only after the
  dedup/no-change early exits, i.e. only when Stryker will actually run. The
  pure ETA/history helpers are unit-tested in `__tests__/mutation-eta.test.ts`;
  the watch-command + progress-log + history-record + live-ETA-filter
  behavior is tested against the stub binary in
  `__tests__/mutation-stream.test.ts`.

  `mutation.sh` also holds a GLOBAL (machine-wide) single-flight lock, so
  only ONE Stryker runs at a time across ALL worktrees — many parallel
  worktree sessions each launching Stryker overloads the machine. The
  lock is a fixed path from `harness_global_lock_dir` (under `TMPDIR`,
  NOT keyed by the worktree, unlike the per-worktree
  `harness_state_dir`). Acquire is fail-fast via `harness_try_lock`: a
  live holder makes it print the structured block (naming the holding pid
  and worktree from `harness_lock_holder`) and `exit 2`, never block or
  queue; a stale lock (holder process gone) is reclaimed. Release runs on
  normal exit AND on INT/TERM via a trap, so a killed run never strands
  the lock. The lock only widens the SCOPE of the guard to global; the
  content-dedup fingerprints still use the per-worktree state dir. The
  global mutual exclusion is verified without a real run by pre-holding
  the lock with a live pid and asserting the wrapper fails fast
  (`__tests__/mutation-lock.test.ts`).

  After a Stryker run that completes with its own whole-report sanity
  floor intact (exit 0 — Stryker's own `thresholds.break`, kept only as
  a floor over the WHOLE accumulated incremental report, not this
  change set), `mutation.sh` gates on the CHANGE SET's own score
  instead: it reads `stryker.conf.json`'s `json` reporter output
  (`reports/mutation/mutation.json`) and passes it, plus the same
  changed-file list already computed for `--mutate`, to
  `scripts/checks/mutation-score.js` — a dependency-free Node script
  (`node:*` requires only, consistent with every other Node checker
  here) that computes killed+timeout over
  killed+timeout+survived+noCoverage per file and for the change set
  as a whole, restricted to those files. Read the `check:mutation` row in
  `docs/harness/checks.md` for the exact thresholds (they ratchet over
  time, so are not restated here; the scorer prints them on its `GATE:`
  line) and `mutation-score.js` itself for
  the declaration-only exclusion allowlist (one allowlist, each entry
  with a concrete reason — mirrored in
  `docs/harness/documented-exceptions.md`). The report records its own
  scope in `config.mutate`; the scorer fails closed when that list
  differs from the changed-file list (the report is not this run's).
  Given that match, a changed file with no entry in `report.files` is a
  file with no mutants (Stryker writes only files that have some) and
  is n/a, not a failure; but a changed file Stryker cannot resolve
  (its `did not result in any files` warning) fails the run. Stryker `disable` comments turn mutants into
  Ignored, which the score leaves out, so `check:overrides` fails any
  such comment without `OVERRIDE(...)`. The
  scorer takes the exact `--mutate` entries as arguments and grades only mutants fully inside a range,
  because Stryker's incremental mode carries old out-of-range mutants with their old statuses into
  `reports/mutation/mutation.json` (core `incremental-differ.js` lines 128-142). It exits 2 when one file is given both as a
  (non-range) `--mutate` entry (one file given both as a plain path and as a range is one
  instance; Stryker reads that as "do not mutate"). A kept path with `[ ( * ? {` is refused with
  exit 2, after the lock in a run and with no lock in `--list`, always before Stryker. The diff uses
  `--find-renames --inter-hunk-context=0 --text --no-textconv`, run with `GIT_DIFF_OPTS=` (a -diff/binary attribute, a textconv driver, or a context width in that variable must not change the hunks). One `cleanup` removes the lock and the temp file for `mutation-ranges.js` stderr on EXIT, INT (exit 130), and TERM (exit 143). General rule: any checker that parses `git diff` hunks forces `--text --no-textconv --no-ext-diff` and `-c core.quotePath=false`, and treats a failed or unparsable diff as a block, never as "nothing to do" (H6 review 2026-10-12: a binary/textconv `.ts` diff gave no hunk and the gate passed with nothing mutated; fixed in 5f31d626). User ruling 2026-10-12, no edge-straddling mutant: Stryker 8.7.1 creates a mutant only when its whole node lies inside a range (its fully-inside rule, instrumenter syntax-helpers.js), and the scorer grades only mutants fully inside a range. Cost: an edit inside a multi-line block, condition, object or array, or an arrow body loses that construct's whole-node mutants; the inner mutants on the changed lines stay. User ruling 2026-10-12, source plus colocated test: when a source file and its colocated test both change, only the changed source lines are mutated. Cost: a weakened test is checked only against the changed lines, not the whole file. The
  scorer is unit-tested directly against constructed report fixtures
  in `__tests__/mutation-score.test.ts` (no mutated-src-text parsing,
  no real Stryker run); the existing cap/lock/streaming/eta tests drive
  the real `mutation.sh` against a stub Stryker binary that also writes
  a trivially-passing report, so they keep testing the WRAPPER's own
  machinery rather than the scorer. `__tests__/mutation-gate.test.ts`
  covers the wrapper's own handling of the verdict: a failing score, a
  missing report, a report of another run, an exit-1 crash, and a stale
  report (`mutation.sh` deletes
  `reports/mutation/mutation.json` before each run so an earlier run's
  report is never read as this run's).
- Fail closed: a missing required tool (semgrep, plutil, tsc) or a
  tool that crashes/exits non-zero-non-one is a **failure block**, not
  a silent pass and not a skip. A scan that never actually ran must
  never report success — assert that something was scanned (e.g. the
  fixture path appears in the scanner's own "paths scanned" list)
  rather than trusting a clean exit code alone.
- Never `|| true`, never a global auto-suppress, never a threshold
  loosened to get green. Fix the underlying issue instead — this is
  the project's standing rule, restated here because a new wrapper is
  exactly where it's tempting to special-case something quietly.
