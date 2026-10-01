---
name: kiko-linter
description: Invoke when adding or changing a harness check (scripts/checks/*.sh), a Semgrep rule in rules/semgrep-mobile.yml or rules/semgrep-prewrite.yml, a pre-write guard rule (pre-write-guard.js NODE_RULES), a Node checker (scripts/checks/*.js), a fixture under rules/fixtures, a Biome rule, a plist assertion, or a Jest invariant test that mechanizes a review finding.
---

# Kiko linter and harness-check authoring

Source of truth: `CLAUDE.md` (the checks table, "Override protocol",
"Documented exceptions") and `scripts/checks/_lib.sh`. This skill
states the conventions for adding to the harness itself — the checks
that check the app, not the app's own code style (see
`kiko-code-style` for that). The files named below
(`scripts/checks/semgrep-rules.sh`, `scripts/checks/plist.sh`,
`scripts/checks/typecheck.sh`, `rules/fixtures/`) all exist in the
tree today.

The root `Makefile`'s `verify` target (`make verify`, wrapping
`scripts/checks/verify.sh`) is the single end-of-work command for the
developer/qa agents: it runs lint, then the full Jest suite, then
`check:all` (the fast+medium gate) as ORDERED, FAIL-FAST stages,
stopping at the first failing stage rather than always running all
three. Read `verify.sh` directly for the exact stage commands rather
than restating them here; a new harness check that belongs in the
fast+medium gate is picked up by `make verify` automatically through
`check:all`, with no `Makefile` change needed.

## The wrapper contract

Every check wrapper in `scripts/checks/` follows the same shape (read
`scripts/checks/_lib.sh` for the exact helper):

- `source "$DIR/_lib.sh"` for `print_block`.
- On failure: call `print_block` (a structured WHAT/DETAILS/WHY/HOW/
  DO-NOT block) to stderr, then `exit 2`.
- On success: **silent**, `exit 0`. A wrapper that prints anything on
  success breaks the "stays silent on success" contract every other
  wrapper and every hook relies on. The ONE exception is the deep,
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
  success.

  A SECOND exception, of a different shape: `scripts/checks/kill-guard.sh`
  (+ its sibling `scripts/checks/kill-guard.js`) is a `PreToolUse` hook on
  the Bash tool, not a check wrapper — it has no fail/pass, only allow/deny
  a command before Bash ever runs it, so it does not follow the
  fail-loud/`exit 2` half of the contract either: it ALWAYS exits 0, prints
  nothing on allow, and prints the documented `permissionDecision: "deny"`
  JSON on stdout (never stderr) when the command is a pkill/killall or a
  pattern/process-group kill. It has no `print_block`/`_lib.sh` dependency
  and no content-dedup fingerprint — a `PreToolUse` hook runs on every Bash
  call by design, and skipping one because "nothing changed" would mean
  skipping the one call the guard exists to catch. See CLAUDE.md's
  "Automatic wiring" and `harness/kiko/hooks/hooks.json`'s `PreToolUse`
  entry for the wiring, and `kill-guard.js` for the tokenizer.

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
  wrappers such as `sudo`, `nice`, `time`, `env`, `exec` (`-a name`
  takes a value), `timeout`, `xargs` (BSD `-J`/`-R`/`-S` take a value);
  `env -S`/`--split-string` splits its one word into the command line.
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
  is still checked on its own for a kill or `git stash` line, because a
  body can run (`bash <<'EOF'`, `eval "$(cat <<'EOF' …)"`,
  `ssh host <<'EOF'`, `cat <<'EOF' | sh`); only a body that a shell
  without `-c` reads as its script is also checked for an unquoted
  heredoc. An unterminated body: the rest of the input is scanned as
  shell (fail closed).
  A shell `-c` flag is matched anywhere in the arguments, not only
  before the command string (errs toward deny). A nested unquoted
  heredoc inside a body that runs is denied only when that body is a
  shell's stdin script (`bash <<'EOF'`); a kill or `git stash` line in
  any running body is still denied. Here-strings: a `<<<` target that a
  shell without `-c` reads (`bash <<< "…"`) is its script, scanned like
  a shell stdin body (kill, stash, unquoted heredoc). A command
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
  `--stat`, `--numstat`, `--summary` without `--apply`; and the one
  update form, `git merge --ff-only <ref>` or
  `git pull --ff-only [remote [ref]]` with no other option (strict,
  because a later `--no-ff`/`--rebase` overrides `--ff-only`). The way
  out: do the real merge in a separate detached worktree, verify it, then
  `git -C <main> merge --ff-only <sha>`. A help or recovery option lets
  the whole command through from ANY argument position, even as another
  option's value (see the limits list). A session
  in the main checkout gets this deny only after the guard merges to
  main, because it runs main's own `kill-guard.js`.

  SHELL-WRITE deny (why: the pre-write guard sees only Edit/Write/
  MultiEdit, so a file a Bash command writes lands unchecked until
  guard-replay at Stop). Rule: deny a Bash write into `src/`,
  `__tests__/`, or `rules/` (`WRITE_GUARDED_TREES`) — a writing redirect,
  an in-place `sed`/`perl`, `tee`, a `cp`/`mv` (also `gcp`/`gmv`) whose
  destination lands in a tree, a python/node one-liner write call,
  or an in-place edit behind `xargs` (any file), or a `cp`/`mv` behind
  `xargs` whose destination the input may be — at the top level or in
  the nested text the other denies reach, except a heredoc body no shell
  or interpreter reads (text: a commit message, a notes file). Read
  `commandWrite`, `writtenFiles`, `isWritingRedirect`, and
  `writeCallCandidates` in `kill-guard.js` for the closed sets; a write
  call with a literal target "writes" it, one with a variable or
  expression target "may write" (a bare variable: any literal in the
  code; an expression: its own literals, plus argv when it reads
  `sys.argv`/`process.argv`). A `cp`/`mv` writes `DIR/<source name>`
  for `-t DIR`, and for three or more operands or a destination ending
  in `/`; `-T` writes the destination itself; with exactly two operands
  both the destination and `destination/<source name>` count, since the
  text cannot tell a folder (so `cp x.ts src` denies). A moved source is
  removed, not written, so moving a tree file out to `/tmp/` passes.
  Behind `xargs` (`xargsCopyMoveTargets`), a `cp`/`mv` is judged by its
  own destination only when the input cannot reach it: a `-t DIR`/
  `--target-directory` value, or, with a placeholder (`-I`, `-J`, GNU
  `-i`/`--replace`), a last operand that does not hold the placeholder;
  so `find src … | xargs cp -t /tmp/snaps` and
  `ls src/*.ts | xargs -I{} cp {} /tmp/backup/` pass, and
  `xargs cp -t src/` denies. Otherwise (no placeholder, so the input is
  appended last, or a destination holding the placeholder) it denies as
  a write of any file. `git mv` stays
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
  changes at Stop). Rows: `__tests__/kill-guard-writes.test.ts`
  (`projectRoot` is a test-only `decide` option). Where it is live:
  `dispatch.sh` runs `kill-guard.js` from the Bash call's own worktree,
  so `hooks.json` is unchanged and no plugin reinstall is needed; a
  session in the main checkout gets it only after the merge to main.

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
  with the sentinel and a fake folder (`kg/fake_main`). No real kill
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
  - NOT denied: a kill or stash through an alias, a function, a script
    file, or a variable (`$CMD`); a word built at run time
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
    `git -c pull.rebase=true pull --ff-only`; a help or recovery option
    used as another option's value (`git merge -m --abort x` really
    merges); `cd $VAR` (counts as not main); a span as the `cd` target
    (`cd "$(echo <main>)" && git merge x`).
  - Nested unquoted heredoc in `cat <<'EOF' | bash`,
    `eval "$(cat <<'EOF' …)"`, or `bash -c "$(cat <<'EOF' …)"`: not
    denied. Heredoc delimiter corner cases beyond those modeled above
    (bash's `EOF)` shorthand, trailing spaces).
  - Shell-write deny, NOT denied: a path held in a variable or loop
    variable (`sed -i … "$f"`, `for f in …; do … > "$f"; done`) unless
    its text names a tree folder; a `cd` into a tree through a variable
    then a relative path (`cd $VAR/src && echo x > y.ts`; plain
    `cd $VAR && echo x > src/…` IS denied); `eval` of a built string;
    base64 or otherwise encoded code; a path built at run time in the
    interpreter beyond joined literals (`Path('src') / 'x'`,
    `'src/' + name`); a script file that writes (`python3 tool.py`,
    `node x.js`, `bash x.sh`); text piped into a shell or interpreter
    (`cat <<'EOF' | bash`, `echo … | python3`); `perl -e` code (its
    `open(… ">" …)` is not checked); any `find … -exec`/`-execdir`
    command, an in-place edit or a `cp`/`mv` alike
    (`find src -exec sed -i … {} +`, `find /tmp -exec cp {} src/ \;`,
    `find … -exec mv {} rules/ +`, `find … -exec sh -c 'sed -i …
    "$1"' _ {} \;`); `xargs -I{} sh -c '… {}'` (the `{}` is not read as
    the input); a `cp`/`mv` whose destination is a variable (the
    variable-path rule above); other writers and tools — `dd of=`,
    `install`, `rsync`, `ditto`, `ln`, `truncate`, `touch`, `patch`, `awk`'s own
    `print >`, `ruby -i`/`-e`, `ex`/`vim -c`, a `npx`/`uv run` wrapper
    around python or node, and a python/node write API outside the
    listed calls (`shutil`, `os.open`, `fs.writeSync` on an fd,
    `fs.cpSync`); a symlink into a tree.
  - Shell-write deny, deny-leaning (over-denied): any in-place edit or
    `tee` behind `xargs`, whatever the files; a `cp`/`mv` behind `xargs`
    with neither `-t` nor a placeholder (`xargs cp x /tmp/y/`: the input
    is appended last, so the text cannot pin the destination), or whose
    destination holds the placeholder; a `$VAR`/glob path that
    names a folder `src`, `__tests__`, or `rules` anywhere
    (`> "$TMPDIR/src/x"`); a relative tree path when the payload has no
    `cwd`; an interpreter one-liner that writes through a BARE variable
    while any string literal in it names a tree file (it may only read
    that file; DETAILS says "may write"); `sed -i` run GNU-style on
    macOS (`sed -i 's/a/b/' f`, which BSD sed rejects).
  - bash 3.2 only (zsh fails): a command after a heredoc inside
    `<(`/`$(` whose body holds an unbalanced paren, and
    `echo $( (echo a)#c ); pkill x`, both run and are not denied.
  - Deny-leaning (over-denied): a failed `cd typo; git merge` counts as
    moved; `pushd -n`/`popd -n` count as moving; from main,
    `cd <wt> || { echo no; exit 1; }; git merge` (a brace group after
    `||` is not read as an exit); `--git-dir=<main>/.git/worktrees/<name>`;
    a `merge --ff-only` with any extra option; a heredoc body line that
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

  A THIRD exception, of yet another shape: `scripts/checks/pre-write-guard.sh`
  (+ `pre-write-guard.js`) is the `PreToolUse` hook on `Edit|Write|MultiEdit` —
  it denies a write BEFORE it lands, rather than checking a file already on
  disk. It DENIES (exit 2, plus the `permissionDecision: "deny"` JSON on
  stdout and the reason on stderr) the moment either Semgrep
  (`rules/semgrep-prewrite.yml`) or one of the `NODE_RULES` checkers in
  `pre-write-guard.js` reports a NEW finding against the proposed post-edit
  content; a check that could not run at all (a Semgrep/Node crash,
  malformed stdin, a timeout) also denies — fail-closed, the opposite of
  `kill-guard.sh`'s always-allow default. It has NO content-dedup
  fingerprint, for the same reason `kill-guard.sh` has none: a pre-write
  check must run on every single write by design, not just when something
  changed since last time. Env seams override its defaults for testing
  (`KIKO_PREWRITE_TIMEOUT_MS`, `KIKO_PREWRITE_RULES`,
  `KIKO_PREWRITE_SEMGREP_BIN`, `KIKO_PREWRITE_NODE_BIN` — read
  `pre-write-guard.js` for their exact defaults and the closed `NODE_RULES`
  set). See `docs/superpowers/specs/2026-09-25-pre-write-guard-design.md`
  for the full design and CLAUDE.md's "Automatic wiring" for the hook wiring.

  `mutation.sh` also DIFF-SCOPES by default: it mutates only the `.ts`/
  `.tsx` source files this branch changed vs the merge-base with
  `${KIKO_MUTATION_BASE:-main}`, passed to Stryker as an explicit
  `--mutate` list that overrides the whole-tree glob — and this
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

  `mutation.sh` also CAPS the run: after the file selection and excludes
  above, it counts the files it would mutate and, above
  `MUTATION_FILE_CAP` (30, a plain assignment in the script), prints the
  structured block and exits 2 BEFORE Stryker starts. Mutation testing
  runs per small change set only (a whole-release run went 10 h 16 min
  with no result): the fix is `KIKO_MUTATION_BASE` set to the change
  set's own base commit, never a raised cap. The coordinator runs it per
  reviewed change set (harness-workflow's "Mutation testing: small change
  sets only"). No env var bypasses the
  cap. `mutation.sh --list` (`make mutable`) prints the file list and
  `mutable files: N (cap …)` after the same refusals and the same
  `mutable_source_files` filter, then exits (2 above the cap) before
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
  number goes in its list. The stream, lock, and
  cap tests share their throwaway-repository, stub, and wrapper-run helpers
  through `__tests__/test-support/mutation-repository.ts` (excluded from
  Jest's suite list by `jest.config.js` `testPathIgnorePatterns`, which
  ignores only the non-`*.test.*` files there). Those helpers drop an
  inherited `KIKO_MUTATION_BASE` and `KIKO_MUTATION_FULL` from the wrapper's
  env, so a developer's own `export` never changes the scope a test runs;
  a test's own explicit setting still wins.

  `mutation.sh` also gives a watching HUMAN a live progress display and a
  per-mutant-rate ETA, so nobody polls the run — its exit code stays the only
  signal an agent waits on (the ops agent's no-poll rule is unchanged). It tees
  Stryker's combined output to a stable, tailable progress log and prints the
  exact `tail -f <path>` command to watch it; the ETA is a per-mutant rate
  (median seconds/mutant from history) times THIS run's actual mutant count,
  printed LIVE the moment Stryker's own output first reports that count (an
  "N/M tested" counter) — not before the run starts. With no usable history it
  prints a plain "no estimate" line instead. Each completed run (a pass OR a
  break-threshold failure — Stryker exit 0 or 1, not a crash) is appended to an
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

## The fixture contract (Semgrep rules)

A Semgrep rule that mechanizes a finding needs a fixture pair, run by
`scripts/checks/semgrep-rules.sh`:

- `rules/fixtures/<rule-id>.bad.<ext>` — must draw at least one finding
  from its own rule.
- `rules/fixtures/<rule-id>.good.<ext>` — must draw zero findings from
  every rule.
- Discovery is by **filename**: the runner credits a finding toward a
  rule only when the finding's fixture file is literally named for
  that rule id. A companion rule (see "taint does not propagate
  through `.then`" below) needs **its own** dedicated fixture pair —
  a finding that happens to land on a *different* rule's fixture file
  proves nothing about the companion rule; this was a real gap, caught
  and fixed only because a reviewer deliberately broke the companion
  rule and watched the check stay green.
- An optional `// EXPECT-FINDING` comment directly above a line in a
  `.bad` fixture pins the rule to fire on that exact line — use this
  when a coarse ">= 1 finding anywhere in the file" contract could stay
  green after a regression that only breaks matching for a renamed
  binding (e.g. keying a rule on a metavariable name like `snapshot`
  or `item` instead of on the member being read).
- The runner asserts every fixture file appears in the scanner's
  `paths.scanned` list — a fixture Semgrep never opened must fail the
  check, not silently prove nothing.
- Biome format-checks a `.good.` fixture (never lints it; `biome.json`
  `overrides`) and skips a `.bad.` one. Format a new good fixture with
  `npx biome format --write <file>`. A `pattern-regex` probe whose layout
  is the point keeps it with
  `// biome-ignore format: OVERRIDE(<reason>)` on the line above
  (example: `rules/fixtures/kiko-no-native-reminders-module-import.good.ts`).

## `semgrep-prewrite.yml` vs `semgrep-mobile.yml` — where a rule lives

`rules/semgrep-prewrite.yml` holds only the rules the pre-write guard
(`scripts/checks/pre-write-guard.js`, `KIKO_PREWRITE_RULES`) needs to
deny a write before it lands. Every one of those rules is ALSO loaded
as an additional `--config` by `scripts/checks/security.sh` and
`scripts/checks/semgrep-rules.sh` alongside `rules/semgrep-mobile.yml`,
so the project-wide gate keeps proving them against the real tree and
their `rules/fixtures/` pair unchanged. Each rule in
`semgrep-prewrite.yml` carries `metadata: { fix, skill }` —
`metadata.fix` is the one-line fix an agent applies, `metadata.skill`
points at the skill section (this file) explaining why; the guard
itself denies fail-closed on any rule missing `metadata.skill`, since
a deny that cannot point the agent anywhere is a guard bug. Add a NEW
prewrite-checkable rule to `semgrep-prewrite.yml` directly, not to
`semgrep-mobile.yml` — see that file's own header comment for the full
reasoning.

## Semgrep facts verified on 1.175 — don't relearn these the hard way

- `paths.include` CAN be path-prefixed (e.g. `"src/screens/**"`), but
  only when the fixture for that rule is placed at the MIRRORED nested
  path under `rules/fixtures/<rule-id>/<mirrored path>/...` rather than
  flat at `rules/fixtures/<rule-id>.bad.<ext>` — the fixture runner
  scans `rules/fixtures/` directly, so a flat fixture silently draws
  **zero** findings against a path-prefixed include (the fixture isn't
  under that prefix) — verified by sabotage: the prefixed form drew
  zero findings against a flat fixture. A **basename-only** pattern
  (e.g. `"*.swift"`) needs no nesting. `kiko-no-literal-sync-error`
  (`rules/semgrep-prewrite.yml`, `paths.include: src/crypto-sync/**,
  src/monobank/**`) is the nested-fixture example — its fixture pair
  lives at `rules/fixtures/kiko-no-literal-sync-error/src/monobank/...`,
  mirroring the included path; read it directly for the current shape.
  (`kiko-no-cross-screen-import` is NOT a Semgrep rule and has no
  fixture pair at all — it is a `NODE_RULES` entry in
  `pre-write-guard.js`, run via `scripts/checks/screen-imports.js`.)
- `pattern-inside: func $F(...) { ... }` (or any brace-delimited
  container pattern) matches **nothing** in Swift — Semgrep's rules
  here are effectively file-scoped for Swift, not function-scoped. A
  Swift rule that needs to be "inside a function" should scope by
  file content instead (e.g. `pattern-regex` over the whole file, or
  requiring co-occurring markers), not by `pattern-inside`.
- Taint mode does **not** propagate through a `.then(callback)`
  parameter — neither a `propagator` nor a `focus-metavariable` source
  closes this. A `readSecret().then((value) => { setState(value) })`
  shape needs a **separate syntactic companion rule** (not taint mode)
  with its own fixture pair, sharing only a message theme with the
  taint rule.
- `metavariable-regex` is **start-anchored** against the metavariable's
  text. A regex like `\.(formatted|total)(\.|$)` matches nothing when
  the metavariable itself starts with a member access
  (`snap.total.formatted`) — it needs a leading `.*` (`.*\.(formatted|
  total)(\.|$)`) to match anywhere in the text. Verified empirically:
  the anchored form drew 0 findings, the `.*`-prefixed form drew the
  expected 4.
- `paths.exclude`, unlike `paths.include` above, IS safe to path-prefix
  (e.g. `"src/screens/**"`) — verified empirically against a throwaway
  rule+tree that a path-prefixed exclude matches correctly whether
  Semgrep's target is a whole directory, an absolute directory path, or
  a single absolute file path (`fast.sh`'s per-file scan). The failure
  modes are asymmetric: an `include` that fails to match fails CLOSED
  (the rule silently never fires — the `rules/fixtures/` gotcha above),
  while an `exclude` that fails to match fails OPEN (the rule still
  applies) — which is exactly why `kiko-no-import-screens-outside-ui`
  (`rules/semgrep-mobile.yml`) uses a path-prefixed `paths.exclude` for
  `src/screens/**`/`src/navigation/**` instead of trying to scope the
  rule down with `paths.include`.
- A `pattern:`/`pattern-either` string containing a bare `:` (a ternary
  `? … : …`, an object literal, a type annotation) MUST be YAML-quoted
  (`pattern: "$X ? $A : $B"`), never left bare
  (`pattern: $X ? $A : $B`). Left bare, YAML parses everything after
  the first unquoted `:` as a nested mapping key, which Semgrep then
  rejects as "Invalid YAML file: mapping values are not allowed here"
  — but that error is only visible when the config is invalid; a
  **subtly wrong but still-parseable** unquoted pattern silently
  matches NOTHING instead of erroring, which is what actually happened
  writing `kiko-no-nullable-map-ternary`: `pattern: $A ? $B : $C`
  parsed as valid YAML with a truncated pattern string and produced
  zero findings against a fixture the rule was later proven (once
  quoted) to match. Verified empirically: the bare form gave 0
  findings on a trivial `true ? 1 : 2` fixture; the quoted form gave 1.
  Quote every ternary/object/type-annotation pattern string from the
  start, rather than debugging a mysteriously-empty result set.
- A bare `switch ($X) { ... }` pattern matches NO real `switch` statement
  — a switch's body is a case-clause list, not a generic statement block,
  so the block-ellipsis operator does not generalize to it the way it
  does for a function/if body. Anchor on a real clause instead:
  `switch ($X) { case $C: ... }` (`kiko-no-switch`) — verified
  empirically: the bare form gave 0 findings against a real `switch`
  fixture with three `case` arms; the clause-anchored form matched.

## Semgrep facts verified on 2026-09-25 (pre-write guard build-out)

- An unanchored `paths.include`/`paths.exclude` glob (e.g. `src/screens/**`,
  no leading `**/` or root pin) matches correctly whether Semgrep's target
  is the real repo root or a completely different root (a worktree, a
  fixture directory scanned directly) — the guard's per-write scan runs
  Semgrep against a temp copy of the proposed content, not the repo tree,
  and the same include/exclude patterns still resolved correctly there.
- Never read `extra.lines` from Semgrep JSON: this Semgrep version
  reports it as the literal string "requires login". Slice the matched
  text from the scanned file by the UTF-8 BYTE offsets
  (`start.offset`/`end.offset` on a Buffer), as `buildFinding` in
  `pre-write-guard.js` does.
- A `// nosemgrep: <rule-id> OVERRIDE(<reason>) <justification>` comment
  is honored by Semgrep's own suppression even with trailing text after
  the rule id. That holds for `check:security` only. The pre-write guard
  runs Semgrep with `--disable-nosem` and applies its own override
  matcher instead — see "Override forms and where each is honored".
- Inside ONE `patterns:` list, a text-based `pattern-regex` narrows the
  matched span to its own matched text, and a sibling negative filter
  (`pattern-not-regex` or a structural `pattern-not`) is then checked
  against that narrowed span, not the original node — so the exclusion
  silently never fires and every candidate matches. To exclude a value,
  capture it as a metavariable and filter it with `metavariable-regex`
  (which does not narrow the span), and give each text-based filter its
  own `patterns:` arm under a top-level `pattern-either` (the
  `kiko-pinned-*` Button rules in `rules/semgrep-prewrite.yml`). A
  narrowed span also reports the finding at the narrowed child line, not
  the enclosing statement, so an `EXPECT-FINDING` pin cannot land there
  (`kiko-no-hand-built-selectable-row`'s fixture cannot pin at all).

## Semgrep facts verified on 2026-09-28 (the Round A guard rules)

1. `pattern-not: import type { $X } from 'm'` also matches the VALUE
   import `import { X } from 'm'`, so the rule removed every finding
   and reported nothing. Use `pattern-regex` with a `(?!type\b)`
   lookahead after `import`/`export` instead
   (`kiko-no-root-calendars-value-import`).
2. `pattern-not: "{...}"` in a `metavariable-pattern` does NOT exclude
   an object-literal argument. Filter the argument's own text with
   ``metavariable-regex: ^(?!['"`{])`` instead
   (`kiko-no-raw-error-in-console`).
3. A deep-expression pattern
   `$O.$M(..., (...) => <... $X.$N(..., (...) => <... $DATE ...>, ...) ...>, ...)`
   reports the OUTER call's line, so its `EXPECT-FINDING` pin goes above
   the outer call, not above the inner one
   (`kiko-no-per-bucket-date-in-statistics`).
4. Inside an arrow with a BLOCK body, the deep-expression operator
   `<... $X ...>` reaches only the block's `return` statement, not a
   `const` initializer or an expression statement. To match a block-body
   callback, add a separate statement-sequence arm:
   `$O.$M(..., (...) => {` / `...` / `$X.$N(..., (...) => <... $DATE ...>, ...);`
   / `...` / `}, ...)`. That arm also matches the inner call as a `const`
   initializer, and it reports the outer call's line. Do
   not scope with `pattern-inside: $O.$M(..., (...) => { ... }, ...)`
   instead: `{ ... }` also matches an EXPRESSION body, so a one-off
   `rows.map((row) => new Date(row))` matches itself and fires
   (`kiko-no-per-bucket-date-in-statistics`).

## Semgrep facts verified on 2026-09-29 (`kiko-no-needless-async-either-thunk`)

- Semgrep IGNORES the `async` keyword of an arrow function in a
  pattern: `const $F = async () => $B` also matches
  `const f = () => …`, and `either(async () => $F())` also matches
  `either(() => f())`. `async function $F(...) { ... }` DOES require
  the keyword. To require an async arrow, capture the initializer
  (`const $F = $INITIALIZER;`) and filter it with
  `metavariable-regex` (`^(async\b|useCallback\(\s*async\b)`).
- A `pattern-inside` that opens with `...` before a common statement
  (`...` / `const $F = $INITIALIZER;` / `...`) is quadratic on a large
  file: each `const` opens a range on both sides. It ran 63 s on
  `transaction-form.screen.tsx` (2818 lines) and the guard denied
  "could not check" on every write to it. Even the rarer
  `async function $F` arm with a leading `...` cost 0.15-0.26 s of rule
  match time per large file, and under `check:security`'s full-tree
  load it hit the per-rule timeout on `holding-form.screen.test.tsx`
  (4173 lines), which fails the gate. The guard speed check did not
  show that. So open no `pattern-inside` with `...`: write
  `<declaration>` / `...`. The rule then costs at most 0.08 s of rule
  match time per file (Semgrep `--time`, `match_times`, not wall time),
  and it accepts a known false negative: a use placed before a hoisted
  `async function` declaration is not flagged. For every new statement-sequence rule, run both the
  guard speed check in "Adding a pre-write guard rule" AND a
  whole-tree `npm run check:security`; the fixtures are too small to
  show either cost.
- `either(async (...$REST) => $F(...$REST))` matches nothing when the
  target's rest parameter has a type annotation
  (`(...rest: []) => …`); write `(...$REST: $TYPE)`.

## Semgrep facts verified on 2026-09-29 (`kiko-no-source-text-read-in-test`)

- With `options: { symbolic_propagation: true }`, a top-level
  `pattern-not: $READ($JOIN(..., "=~/\.csv$/"), ...)` also drops
  `readFileSync(FIXTURE_PATH)` when `const FIXTURE_PATH = join(…,
  'x.csv')`, and it sees through two levels
  (`join(migrationsDir, name)` with `migrationsDir` a `const` join).
  The same filter as a `metavariable-pattern` on the path argument does
  NOT see through the `const`: every identifier path fired.
- A pattern on `readFileSync(...)` also matches a renamed named import
  (`import { readFileSync as read }`), a default or namespace import
  (`fs.readFileSync`), `require('node:fs').readFileSync`, and
  `fs.promises.readFile` via `$FS.readFile(...)`.
- A metavariable callee `$READ(...)` also matches a member call
  (`fs.readFileSync(…)`, `fs.promises.readFile(…)`), so a
  `pattern-not: $READ(...)` needs no `$FS.$READ(...)` twin. The good
  fixture's `fs.` reads pin this.
- Semgrep skipped every file when it scanned a DIRECTORY under the
  scratchpad (`paths.scanned` was empty, no error); naming the file
  scanned it. Scan a probe file by its path, and read `paths.scanned`
  before trusting a zero.

## Semgrep facts verified on 2026-10-01 (the P5 guard rules)

- A bare `{}` in a pattern matches ANY object literal. Pin an empty
  side with `metavariable-regex` on `^\{\s*\}$`.
- A bare JSX attribute (`<Button fullWidth />`) reads as `={true}`.
- `metavariable-comparison` folds constant arithmetic
  (`24 * 60 * 60 * 1000`).
- Constant propagation makes `pattern: $X` plus a comparison match an
  identifier use too, so write each operand as literal text.
- A QUOTED number-literal pattern (`"86400000"`) matches every spelling
  of that value. Quote it in YAML: unquoted `864e5` is a float.
- `options: { constant_propagation: false }` stops a literal pattern
  from matching a propagated identifier. Fixtures cannot pin this
  option: the verifier checks only positive lines, so a stray
  identifier match in a good fixture is the only signal.
- `pattern-not-inside` with an object pattern skips by range: the whole
  object literal's span.
- Semgrep reports a parenthesized JSX expression at the `(` line; pin
  `EXPECT-FINDING` there.

## Class A vs Class B

`rules/semgrep-mobile.yml` groups rules into two severities, both
enforced by `scripts/checks/security.sh` (read that file's current
findings-handling for the exact mechanism, not restated here):

- **Class A (ERROR)** — a deterministic, always-a-bug pattern (e.g.
  TLS validation disabled, a secret written to AsyncStorage). Any
  Class A finding fails the check; there is no override path.
- **Semgrep errors fail the check too.** A Semgrep exit code other than
  0/1, output that is not valid JSON, or an `errors[]` entry at level
  `error` or of type `Timeout` (Semgrep reports a timeout at warn level
  with exit 0) fails `check:security`. Other warn-level errors stay
  non-blocking. Read `scripts/checks/security.sh` for the exact test.
- **Class B (WARNING)** — a pattern that is usually right but can have
  a legitimate exception (e.g. taint mode also flags a value merely
  *derived* from a secret, which is a judgment call, not a
  deterministic violation). Class B findings are surfaced,
  override-eligible, and non-blocking on their own. Use Class B only
  when the rule's own comment can state a concrete, verifiable reason
  a finding might be a false positive — the same "justified, not bare"
  standard as a `biome-ignore` override.

## Every new ignore/exclude entry needs a CLAUDE.md exception

Any new entry in `.jscpd.json`, `biome.json`'s `files.includes`,
`knip.json`, `.depcheckrc.json`, `.gitleaks.toml`, or a semgrep
`--exclude` flag needs a matching entry in
`docs/harness/documented-exceptions.md` — see that file for the required shape: name the
config, name the exact path/value excluded, and state the concrete,
verifiable reason (a measured false-positive rate, a tool that cannot
parse the language, a generated-and-cumulative file format), not a
vague "not relevant". `rules/fixtures/**` is the running example: it
Biome skips its bad fixtures (`rules/fixtures/**/*.bad.*`) and only
format-checks the good ones, and it is excluded from Knip/jscpd/the real
Semgrep scan, each
independently verified as load-bearing by probing with a deliberately
bad file and confirming the check would otherwise fire on it.

## `check:dup`'s changed-file scope can surface PRE-EXISTING duplication

`check:dup`'s jscpd run is scoped to the session's changed source
files (see `CLAUDE.md`'s "Automatic wiring"), so a new test file
entering that changed-file set can pull an EXISTING sibling test file
along with it and cross the 5% threshold together, even though the
duplication (e.g. repeated fixture-building closures) predated the new
file and the new file didn't add any of it. The fix is still root-cause
extraction of the shared helper/builder into one place reused by both
old and new tests — never an ignore-list entry (the check fired
correctly; the duplication is real, just older than the diff) — and it
belongs in the SAME commit as the feature that triggered the check, so
`git log` shows one coherent change rather than a drive-by refactor
with no test-behavior delta.

## Implemented: a rule for a plain function called inside a worklet

Formerly a documented backlog item, now IMPLEMENTED:
`kiko-worklet-directive-required` (`rules/semgrep-prewrite.yml`) flags
a call to a SAME-FILE helper (declared as `const $F = (...) => ...` or
`function $F`) without a `'worklet'` directive, made inside the callback
argument of a reanimated worklet hook, `runOnUI`, or a
`Gesture.$G().$ON(...)` callback — read the rule for the closed hook
list. It does NOT catch an imported helper (that stays a review item),
excludes a helper declared inside the callback itself, and excludes
test files (Jest mocks reanimated; the rule's comment states the
timeout reason). Known false positive: a call in the deps argument of
`useAnimatedStyle` is flagged too. This is a real, previously-shipped bug class (see
`kiko-gestures`'s "Every function called inside a worklet needs its
own `'worklet'` directive" and memory
`worklet-directive-debug-swallows-release-aborts`): the missing
directive is invisible to `tsc` and to Jest (reanimated's worklet
runtime is mocked there, and Debug builds only warn), and only
SIGABRTs in a RELEASE build. See the rule itself for its fixture pair
and `docs/harness/review-to-biome-inventory.md` for the closed backlog
row.

## F4 code-style mechanization candidates — all four now implemented

The nullable-ternary rule is `kiko-no-nullable-map-ternary` (Semgrep
ERROR, `rules/semgrep-prewrite.yml`) — see "Semgrep pattern strings need
quoting" below for the one gotcha that cost the most time writing it.
The one-exported-component-per-`.tsx` check is a Jest invariant plus a
pre-write guard Node rule, not Semgrep — see "One exported component per
`.tsx` — a Jest invariant and a guard rule" below. The import-length-sort check is a hand-rolled
shell+JS checker/fixer at the fast tier — see "Import length-sort — a
hand-rolled checker (and fixer)" below. The comment-history check is
`kiko-no-history-id-comment` (Semgrep ERROR, `rules/semgrep-prewrite.yml`)
— see "`kiko-no-history-id-comment`" below.

## `kiko-no-history-id-comment`

Mechanizes kiko-code-style's "Comments: WHY only, never history": no
task id, review-round id, spec/decision id, or plan citation left
behind in a `src/**` comment. The member list is the two
`pattern-regex` arms of `kiko-no-history-id-comment` in
`rules/semgrep-prewrite.yml`. Read them for the current set; the
fixture pair shows each member. Two
`pattern-regex` arms, one per comment syntax —
a single regex spanning both `//` and `/* */` would have to
special-case where a line comment ends and a block comment does not.
The block-comment arm's `(?:(?!\*/)[\s\S])*?` (not a bare `[\s\S]*?`)
keeps a match from crossing a real `*/` into a LATER, unrelated block
comment.

Both arms are additionally anchored at line start with
`^(?:[^'"`\n]|'[^'\n]*'|"[^"\n]*"|`[^`\n]*`)*` — a char-by-char walk
that treats any COMPLETE same-line quoted string as one atomic skip,
so a `//` or `/*` that only appears INSIDE a string literal (a glob
like `'src/**/*.ts'`, a MIME wildcard `'*/*'`, a note like `'foo //
T12'`) never opens a match — only a real `//`/`/*` reached after
skipping every complete string earlier on that line can.

**Scope: `paths.exclude`, not `paths.include: ["src/**"]`.** A
path-prefixed `paths.include` would silently draw ZERO findings when
`semgrep-rules.sh` scans `rules/fixtures/` directly for this rule's
own positive fixture — the exact `paths.include` gotcha documented
above (a fixture isn't under a `src/**`-prefixed include, so it fails
CLOSED, invisibly). `paths.exclude` has no such failure mode (see
"Semgrep facts verified on 1.175" above), so the rule instead excludes
`__tests__/**`, `e2e/**`, `scripts/**`, and `harness/**` (harness/test
tooling, not shipped app comments — some of these are covered by their
own dedicated harness checks instead), plus the two root files
`App.tsx` and `drizzle.config.ts` individually (root-level files
outside any `src/**`-style prefix an include could have named).
`__mocks__/**` is NOT excluded — a test mock's comments are exactly
the kind of file this rule should hold to the same standard as any
other, and excluding it would hide real hits.

`\b` word boundaries alone clear most of the false-positive shapes a
real sweep found, with no extra tuning needed: `i18n`/`ISIN`/`UTF-8`/
`ISO 4217` (the denylisted letter has no boundary before the digits
that follow it), an ISO instant's `T` glued directly to the date
before it (no boundary before the `T`), a hex color (the run of hex
digits never lands a boundary at exactly one denylisted letter), and a
denylisted letter+digit glued inside a larger camelCase domain word
like `computeD1Delta` (no boundary on either side) — see
`rules/fixtures/kiko-no-history-id-comment.good.ts` for a worked
example of each. The line-comment arm also excludes a `:` immediately
before the `//` (`(?<!:)`) — without it, the `//` inside an
`http://`/`https://` URL string literal (not a comment at all) reads
as a comment opener too.

**A new check lands together with the fix of its own existing
violations** — an ERROR rule alone, with no fix, would break the gate
on landing. This one **shipped WARNING first**: a real domain word CAN
still collide with the id shape as its OWN standalone token, not
merely a substring — no regex fix closes that gap the way the
boundary tricks above do (a short account-position label like a bare
`D2` in a list is syntactically identical to a real decision id). A
repo-wide sweep (every id-family hit, every `.superpowers/` path
citation, and every `round-N`/`device[- ]feedback`/`on-device review`
history-word cousin the id regex family covers) fixed that residual
class by rewording the handful of real collisions rather than
loosening the rule, and the rule is now **ERROR**: `semgrep --config
rules/semgrep-prewrite.yml src` reports 0 findings for it (run it as
`semgrep --metrics off --quiet --config rules/semgrep-prewrite.yml src`).

The same standalone-token collision applies to the `R\d`/`F\d`/`G\d`/
`C\d` families (added for review-round/audit ids like `R2-1`, `F3`,
`G2`, `C1`): a genuine prose sentence that happens to name "room R2"
or "gate G1" as its OWN standalone token is syntactically identical to
a real id and is accepted, not narrowed, the same way `D2` is above
— there is no regex that tells "room R2" apart from a real review id
without reading the surrounding English. `round-N` DOESN'T have this
problem: the digit is part of the id shape itself (`round-3`), so
ordinary prose that says "a round trip" (no hyphenated digit) never
matches at all — see `rules/fixtures/kiko-no-history-id-comment.good.ts`.

**A hyphenated debugger/verifier-report family**
(`(?:SYNC|INT|TWIN|TX|HOLD|BAK|STAT|AUTH|PERF|SEC|DEP|DEPS|CS)-\d+`,
2026-09-28) catches a debugger or verifier report's own finding id
(`SYNC-1`, `INT-1`, `TWIN-4`, `DEPS-3`, …) left behind in a comment —
the multi-round bug-hunt process names findings this way in its own
`.superpowers/sdd/` raw reports, and a fix comment citing that id
verbatim is exactly the "history, not WHY" shape this rule bans. Every
prefix here is at least two letters, so an ordinary sentence gluing
"SYNC"/"DEPS"/"TWIN" directly to a hyphen and digits by coincidence is
rare — but NOT impossible: the family originally also listed a bare
`V`, which collided with a real "V-8" reference and was dropped before
shipping (a single-letter member needs the same standalone-token
carve-out the `R\d`/`F\d`/`G\d`/`C\d` families above already carry, and
this family's whole point was to avoid that class of member). A
repo-wide sweep found zero remaining collisions before this family
shipped as ERROR directly (no WARNING-first rollout was needed, unlike
the original id families above) — see the fixture pair's own entries
(`SYNC-1`, `DEPS-3` positive; a lowercase/unhyphenated `sync`/`int`
negative probe, plus a `UTF-8`/`SHA-256`/`ISO-8601`/`Windows-1251`
regression lock against real WORD-digit technical vocabulary) for the
worked example.

**Hyphenated single-letter ids and `NEW-N` (2026-09-29).** The
single-letter families take an optional hyphen (`T-?\d{1,3}`), so a
`T-32`, `C-1`, or `M-3` id is caught like `T32`, and the hyphenated
report family gained `NEW` (`NEW-1`). `D` is the one letter WITHOUT the
hyphen: "day D-1" is the day before the purchase day D in the
net-worth and holding-value tests, a real domain token. The leading
`\b` still keeps `UTF-8`/`UTC-1`/`GMT-5` silent (no boundary before the
letter), and a `T-shirt`/`U-turn` has no digit after the hyphen.
`NEW-\d+` needs the hyphen right after `NEW`, so `NEWS-1` does not
match. Fixture pair: the four hyphen pins at the end of `.bad.ts`
and item 19 in `.good.ts`.

**`Phase N` is not a family member at all** — a bare `Phase\s\d+`
collides with ordinary engineering prose no digit-anchoring can fix
("Phase 1 copies the rows; Phase 2 deletes the source only after
commit" is ordinary prose that collides with the digit-anchored
pattern, not a review-round id). A "Phase N (Task M)" citation is
still caught without it: the existing `Task\s\d+` family member fires
on the "Task M" half of that exact shape, which is the only pattern
this codebase's real "Phase N" citations ever actually needed — see
the `.bad.ts`/`.good.ts` fixture pair for both the still-caught shape
and the prose the narrowing excludes.

**`the brief` is narrowed to `(?:task|parity)\sbrief(?:'s)?`** — the
bare word "brief" collides with ordinary English on its own ("brief"
as an adjective: "a brief window", "a brief moment"), which no
boundary trick fixes either. Requiring the specific "task"/"parity"
qualifier this codebase's own SDD vocabulary uses keeps every real
citation (`the parity brief's own signature`, `the task brief's
base64-decode ruling`) while a "brief window"-style sentence never
opens a match at all — see the fixture pair's `task brief`/`parity
brief` positive shapes and the `brief window` negative probe.

**A second, narrower member catches the same vocabulary without a
"task"/"parity" qualifier: `per\sthe\sbrief|the\sbrief's`.** A residual
gap left a bare "per the brief" or "the brief's own …" citation
uncaught, since neither has a "task"/"parity" qualifier before
"brief" for the member above to match. This member is deliberately
narrower than the bare word "brief" itself — it only fires on the
literal "per the" lead-in or a possessive "'s" directly after
"brief" — so it still never opens a match on "the brief window" (no
possessive, no "per the" lead-in) or "a brief native spinner" (plain
adjective use, no "the"/"per the" at all). Fixture pair: the `.bad.ts`
positive shapes ("per the brief, …", "the brief's residual gap …")
and the `.good.ts` negative probe covering both adjective shapes.

**The plan-history members (2026-09-29) need a citation shape, never a
bare `the plan` or `plan`.** `the plan` is domain prose in this codebase:
the rezone import computes and loads a plan (`rezone-import-times.ts`:
"Compute the plan (pure).", "Load the plan"), and the reminders planner
builds one (`sync-reminders.ts`: "the plan stops keeping its slot
free"). So each member requires a shape only a citation takes: a
numbered decision (`decision 18`, `Decision 6:`), a possessive (`the
plan's disposition`), a `doc` suffix (`plan doc`), or a `per`/`by`
lead-in (`per the plan`, `by the plan`). A bare `decision` (no digit)
stays silent too ("a decision the user makes"). The group's trailing
`\b` keeps a bare `commit` member from matching `commits` ("each batch
commits in one transaction"); only `[Ss]eparate\scommits?` takes the
plural, because "separate commits" is a citation and "separate" never
leads a database sentence. `in this plan`, `this plan also`, and a
dated plan name (`\d{4}-\d{2}-\d{2}\s[\w-]+\splan`, "(2026-09-11
multi-account plan)") are citation shapes too: the rezone and
reminders code says "the plan" or "this planner", never "in this plan".
Fixture pair: the plan-history pins in `.bad.ts` and items 16 and 18 in
`.good.ts`.

**The section members (2026-09-29) need a number.** `[Ss]ection\s[A-Z0-9]+\.\d+`
fires only on a word "section" followed by a dotted number, so a
"Section" header row, "2 sections", and "subsection 2.1" (no word
boundary before "section") stay silent. `§\s?\d` sits OUTSIDE the `\b(...)`
group in both arms: `§` is not a word character, so a `\b` before it
would need a letter or digit right before the sign and miss "(§2.1)".
The optional space also catches a spaced "(§ 3)". An
external standard's section (`RFC 4231 §4.3`) is the same
standalone-token class as `D2` above: accepted, not narrowed. Cite the
test case or the heading instead ("RFC 4231 test case 2"). Fixture
pair: the five section pins at the end of `.bad.ts` and item 17 in
`.good.ts`.

**`next commit` can collide with database prose.** `commit` is also a
SQL transaction commit, so a real sentence like "the next commit
flushes the batch" is syntactically identical to a "lands in the next
commit" citation. It is the same standalone-token class as `D2` above:
accepted, not narrowed. The src tree has 0 such sentences today; if
one appears, reword it ("the following transaction commit"). The same
holds for `the plan's` in the reminders planner: write "the plan keeps
its slot", never "the plan's slot". `by the plan` and `per the plan` are
the same class: "the slot chosen by the plan" or "decided by the plan
owner" in rezone or reminders prose is syntactically a citation. The
src tree has 0 such sentences today; if one appears, reword it ("the
slot the plan chose").

**The user-request members (2026-09-30) need a date or a
sentence-opening past tense.** "user request" and "user feedback" are
domain prose too (a request to the server, feedback shown as a toast),
and "the user asked for" can describe runtime state ("retry only if the
user asked for one"). So there are two members, each the narrowest
shape the real hits took:
`user\s+(?:(?://|\*(?!/))\s*)?(?:request|feedback)\s+(?:(?://|\*(?!/))\s*)?\d{4}-\d{2}-\d{2}`
("(user request 2026-09-30)") needs an ISO date right after the words,
and `(?<=//\s|[.;:]\s|\*\s)[Tt]he\s+user\s+asked\s+for` needs "the user
asked for" to open a comment or a sentence. The optional `//` or `*`
between the words lets a member span a comment line break ("(user" at a
line end, "// feedback 2026-09-30)" on the next line); a bare `\s+`
cannot, because the next line's `//` is not whitespace. A comment or a
sentence that opens with a runtime "The user asked for a refresh, so …"
is the same standalone-token class as `D2` above: accepted, not
narrowed. Write "When the user asks for a refresh, …" instead. Fixture
pair: the six user-request pins at the end of `.bad.ts` and item 20 in
`.good.ts`.

**The branch, task, option, plan, and review-date members (2026-09-30).**
Six more citation shapes, each in both arms: `on\sthis\sbranch`,
`this\stask's`, `Option\s[A-Z]`, `for\sthis\splan`, `this\splan's`, and
`review,\s<ISO date>` ("(review, 2026-09-14)"). Each needs its whole shape:
"optional", "the Options list", a lowercase "option A/B toggle", "a branch
on this path", "the plan keeps its slot", and "review the rows, then retry"
stay silent. `Option\s[A-Z]` is the same standalone-token class as `D2`
above: a real UI option named by a capital letter ("Option B in the
picker") is syntactically identical to a design-option citation, and is
accepted, not narrowed. Name the option by what it does instead.
`on\sthis\sbranch` is the same class: "on this branch" also names a code
branch ("`value` is null on this branch" of an `if`), which is accepted,
not narrowed. Write "in this case" or "here" for a code branch. The
sweep that landed these members found 39 hits in 26 files; each was
reworded to keep the WHY, and a design option became the name of its
model ("the reflow error model", "connect-first"), never a blank.
Fixture pair: the twelve pins after the user-request pins in `.bad.ts`
and item 21 in `.good.ts`.

**The commit-range member (2026-09-30).** A git range of two 7-40
character hex ids, each holding at least one hex letter,
`(?=[0-9]*[a-f])[0-9a-f]{7,40}\.{2,3}(?=[0-9]*[a-f])[0-9a-f]{7,40}`, in
both arms: "a build from 6c3190ee..28eb0967" cites history the same way
a branch name does. The three-dot form counts too. "a 0..255 byte", "the
a..f digits", "cafe..beef", "1234567.89", and a digit-only span such as
"1700000000000..1700086400000" (two epoch-millisecond numbers) stay
silent. The sweep found 1 hit, in `reminder-row.component.tsx`,
reworded. Fixture pair: the three commit-range pins at the end of
`.bad.ts`, and item 22 plus the digit-range pin after it in `.good.ts`.

## One exported component per `.tsx` — a Jest invariant and a guard rule

The pre-write guard also runs it in-process as the Node rule
`kiko-one-component-per-file` (`.tsx` only; it reports each exported
component after the first). The Jest invariant below stays the
project-wide check.

`scripts/checks/one-component-per-file.ts` mechanizes kiko-code-style's
"One component per file". It lives alongside the other check tooling
(`import-order.js`, `kill-guard.js`, `full-word-identifiers.js`), not
under `src/` — a harness rule, not app code — and is excluded from
Stryker's mutate set there (`stryker.conf.json`'s `!scripts/checks/**`;
see `docs/harness/documented-exceptions.md`). Its test,
`__tests__/one-component-per-file.test.ts`, imports it directly (a
plain module import, unlike the `.sh`-spawned checks). Semgrep has no
way to express "a second exported-component declaration exists
elsewhere in this file" without `pattern-inside`/taint scoping, and
neither spans two independent top-level statements — so this is a
Jest invariant instead: `exportedComponentNames(source)` returns the
name of every top-level, exported, component-like declaration in a
`.tsx` source string, and `one-component-per-file.test.ts` asserts
every real file under `src/` returns at most one name (0 known
violations today).

The scanner is a hand-rolled heuristic, not a TypeScript AST parse —
consistent with this project's Semgrep-regex style elsewhere (e.g.
`settings-columns.test.ts`'s column-name scan): it blanks every
string/template/comment span first (so a regex never matches text
that only *looks* like a declaration inside a literal), then finds
each top-level (column-0 — Biome formats every top-level statement
flush-left) declaration opener, and classifies each by regex
(`export default function Name`, `export function Name`,
`export const Name`, a two-step `const Name = …; export default
Name;` alias, or a plain local `const`/`function` that might later be
aliased). "Component-like" is `return`/`=>` leading into JSX, or an
`FC`/`FunctionComponent` type annotation on the declaration's own
line.

The jest.mock exemption (an inline mock component defined inside a
`jest.mock(...)` factory body never counts, per the brief) holds for
a structural reason worth knowing before touching this file: a
`jest.mock` factory body is a plain callback, and `export` is only
valid at module top level — so a factory body can **never**
syntactically contain a top-level `export`, meaning an export-keyword
scanner could never mistake an inline mock component for an exported
one in the first place. The scanner still explicitly blanks
`jest.mock(...)` call bodies (bracket-matching, after the noise-blank
pass) as a second, defensive layer — matching the design this rule
shipped with — so a mock factory's own `const`/`function` text can
never be mistaken for a *local* declaration a later `export default
Name;` might resolve to either.

## Import length-sort — a hand-rolled checker (and fixer)

`scripts/checks/import-order.js` (+ its wrapper `import-order.sh`)
mechanizes kiko-code-style's "Import ordering" rule — see that
section for the exact rule (3 blank-line-separated groups, sort
ascending by ending-physical-line length, value-before-type as an
equal-length tiebreak, a bare side-effect import as a barrier). Wired
at the **fast tier** (`fast.sh`, alongside `lint.sh`/`security.sh`/
`secrets.sh`): the rule is purely per-file with no cross-file
dependency, so per-edit feedback catches drift immediately instead of
waiting for `Stop`. It is ALSO wired project-wide
(`npm run check:import-order`, part of `check:all`) — `import-order.sh`
takes an optional file argument: given one (the fast-tier hook), it
checks only that file; given none, it walks every `.ts`/`.tsx` under
`src/`, `__tests__/`, `e2e/`, plus `App.tsx` (overridable via
`IMPORT_ORDER_SRC_ROOT`, used only by the test to point at a
disposable temp fixture tree instead of the real, much larger repo).
The per-file mode skips a file under `rules/fixtures/` (absolute under
its own root, or relative) and exits 0, since the pre-write guard
(`EXCLUDED_PREFIXES`) and the project-wide roots never read it either:
a fixture may hold any import order on purpose. `full-word-identifiers.sh`
keeps checking fixtures per file, because its project-wide roots
include `rules/fixtures/`.

Tested by spawning the `.sh` end-to-end against fixture files on disk
(`__tests__/import-order.test.ts`, the `__tests__/kill-guard.test.ts`
pattern) — not by importing `import-order.js`'s internals directly.
`import-order.js` is in `knip.json`'s `ignore` list for the same
reason `kill-guard.js` is (see `docs/harness/documented-exceptions.md`):
it is reached only via a `node` invocation from its `.sh` wrapper,
never a static `import`/`require`, so Knip's reachability graph can't
see it.

The scanner is a hand-rolled heuristic (blank comments/strings first,
then walk the leading column-0 run of blank/comment/import lines),
the same style as the one-component-per-file scanner above, with one
extra design point worth knowing before touching it: a comment run
sitting directly above the FIRST import of a blank-line-delimited
group is treated as a PINNED group-level prefix — it never moves, and
is never treated as "belonging" to that first import — which is what
lets a file's own header doc-comment (or a general group-rationale
comment) stay put even when the import beneath it needs to move to a
new position. A comment glued to any OTHER (non-first) import in a
group, by contrast, must travel WITH that import when it moves — the
scanner marks the whole group "unsafe" and its `--write` mode leaves
it completely untouched, rather than guess where the comment should
end up. This is a real, load-bearing distinction, not a hypothetical:
a repo-wide sweep once found 210 files with a real violation;
`--write` resolved all but 7 of them, each left unresolved by exactly
this "comment glued to a non-first import" safety rule. Those 7 were
re-sorted by hand (moving the comment WITH its import, alongside the
file-level prefix comment when both were present in the same file —
see `net-worth-series.test.ts` for a worked example of both rules
applying in the same file at once).

`--write` (`node scripts/checks/import-order.js --write <file...>`) is
a repo-sweep tool, not part of the check-wrapper contract (see "The
wrapper contract" above — a checker only checks) — it is invoked by
hand, never from `import-order.sh`.

Two adjacent groups of the SAME kind (no other-kind group or
side-effect barrier between them) is also a checked violation —
`mergeAdjacentSameKindGroups` folds them into one group and re-sorts
the result, so `--write` fixes this shape itself; it only leaves the
merge for a human when the "comment glued to a non-first import"
safety rule above marks one of the two groups unsafe to touch, OR
when the LATER group has its own PREFIX comment (a comment run
directly above that group's first import) or its own INTERIOR comment
(glued to one of its non-first imports) — folding either would strand
that comment mid-chain once the group boundary disappears, with
nowhere left to attach it.

**The general rule: `--write` re-checks its own output and reports
ANYTHING it could not fix.** Rather than tracking each unfixable shape
as its own bespoke reason, `writeFile` re-runs the plain checker
(`checkImportOrder`) against the text it just wrote (or left
unchanged) and prints `left for hand fix: <file> <reason>` — the exact
same violation string the non-`--write` check would have printed —
for every violation still present, exiting non-zero. This covers a
blocked merge (prefix or interior comment on the later group) and a
group `--write` left completely untouched (a comment glued to a
non-first import) with the same mechanism, so a future unfixable shape
is caught by construction instead of needing its own new tracking
list — never a silent no-op that reads as "nothing to fix" while a
violation is still there.

**Duplicate specifier.** `checkDuplicateSpecifiers` counts every
declaration in the leading import header by its exact specifier
string and flags a specifier with two or more
(`duplicate import of '<specifier>' (<n> declarations)`). It is a
finding of this same analyzer, not a separate check, so it runs
everywhere the analyzer runs: the fast tier, `check:import-order`,
and the pre-write guard's `kiko-import-order` Node rule. The
`matchedText` carries no line number, so an unrelated edit in a file
with a pre-existing duplicate is not a new finding. Adding a third
declaration changes the count and so the text, and the guard denies
it. When you merge a duplicate by hand, delete the old pair BEFORE you
insert the merged line in its sorted position; the other order briefly
makes three declarations, which the guard denies. A namespace import
is exempt (it cannot share a declaration with named imports). A bare
side-effect import beside a VALUE import of the same module counts. A
bare side-effect import beside only `import type` declarations does
not (`duplicateCount`): Babel erases `import type`, so deleting the
bare import would stop the module from running, and `useImportType`
forbids folding it into a value import. Two type-only declarations
beside it still fail.
Biome 2.5.11 has no lint rule for this: only the `organizeImports`
assist merges duplicates, and it is off here. `--write` never merges a
duplicate, because the merged line needs rewrapping at Biome's line
width and a placement for any glued comment. The general re-check
above reports it as `left for hand fix`.

## `kiko-no-switch` — an AST `switch` pattern, not a keyword regex

`kiko-no-switch` (`rules/semgrep-prewrite.yml`, Class A) mechanizes
kiko-code-style's ts-pattern section: `switch` is banned outright, no
exception. It matches the AST shape of a real `switch` statement rather
than a bare keyword-plus-paren regex — unlike `kiko-repo-no-class`'s
`\bclass\s+\w`, a keyword regex over `switch` has real false-positive
shapes worth avoiding: a comment or string/template literal that merely
*mentions* `switch(`, and a `.switch(...)` method call (an
RxJS-observable-style chain, for example) — none of these are a `switch`
STATEMENT, and the AST pattern naturally ignores all of them. A bare
`switch ($X) { ... }` pattern does NOT match a switch's case-clause list
(verified empirically — 0 findings against the bad fixture's real
`switch`), so the rule is a `pattern-either` of two arms, each anchored
on a real clause label: `switch ($X) { case $C: ... }` and
`switch ($X) { default: ... }`. The `case`-anchored arm draws one finding
per case label in a given switch (ellipsis-after-metavariable matches
once per possible starting clause) — harmless duplication for a keyword
ban, and the fixture's own `EXPECT-FINDING` line only needs at least one
match to start there. Fixture pair:
`rules/fixtures/kiko-no-switch.{bad,good}.ts`, the `.good.ts` one
covering all four false-positive shapes plus the genuine
`match(...).exhaustive()` conversion.

A closed-set mapping over a discriminant read from storage or network —
a DB row's `HoldingType`, a settings-JSON field's own `mode`/`kind` —
needs its catch-all arm to stay `.otherwise()`, not `.exhaustive()`,
whenever the ORIGINAL `switch`/if-chain/ternary-chain tolerated ANY
unmatched runtime value (a trailing `default`, an unconditional trailing
statement, or an implicit "anything else" ternary/if-else branch) — not
just the few other literal members named in the other arms. A fully
literal `.exhaustive()` there silently turns "tolerate a stale or
malformed value" into "crash on it", which is a real behavior change,
not a mechanical rewrite — caught by real Jest suites whose fixtures
either omit the discriminant field entirely or deliberately store an
unrecognized one, relying on exactly that tolerance (`holdingValueBreakdown`'s
`HoldingType` dispatch — two suites with `type`-less holding fixtures;
`resolveTrendFilter`'s stored `trend_filter` JSON `mode`; the
column-mapping screen's stored `statement_mappings` JSON `amount`/
`currency` `mode`). This risk is specific to a discriminant read off
persisted/external data; a purely LOCAL type this codebase's own code
constructs (a `useState` literal, a pure helper's own return value, a
caller-supplied op) has no such stale-data path and stays genuinely
`.exhaustive()`.

## Full words in identifiers — exact-path exemption allowlist, not a suppression comment

`scripts/checks/full-word-identifiers.js` (+ its wrapper `.sh`) mechanizes
kiko-code-style's "Full words in identifiers" rule. Wired at the fast tier
(`fast.sh`, alongside `lint.sh`/`security.sh`/`import-order.sh`) — every
`.ts`/`.tsx` is in scope, and a `.js`/`.mjs`/`.cjs` is in scope only under
a `scripts/` directory (the fast tier's own harness-tooling files, the
only place today's tree mixes CommonJS/ESM with TypeScript) — the rule is
purely per-file with no cross-file dependency. Project-wide via `npm run
check:full-word-identifiers` (part of `check:all`) mirrors that: every
`.ts`/`.tsx` under `src/`, `__tests__/`, `rules/fixtures/`, `scripts/`,
`jest/`, `__mocks__/`, `e2e/`, plus `App.tsx` and `drizzle.config.ts`
themselves, and a second pass for `.js`/`.mjs`/`.cjs` under any `scripts/`
directory in scope — everything the fast tier already checks on a fresh
edit, so the project-wide scan can never silently miss a file the hook
guards.

The scanner is the same `blankNoise`-then-scan shape as
`import-order.js`/`one-component-per-file.ts`: blank every string,
template, comment, AND regex-literal span first (a bare letter inside a
regex, e.g. the `e` in `/e([+-]\d+)/`, is not an identifier — a real false
positive hit writing this rule, in `src/currency/decimal/decimal.ts`), then
scan every remaining identifier-like token and split it into lowercase word
parts on snake_case underscores and camelCase/PascalCase transitions
(including the acronym-run boundary — `maskedPAN` splits `masked` + `PAN`,
not `masked` + `PANValue`-style). A word part is flagged only when it
EQUALS a denylisted word from the exact table in kiko-code-style's "Full
words in identifiers" section — never a substring match, so `context`,
`value`, and `cube` never trip on the `ctx`/`val`/`cb` entries buried
inside them (no camelCase transition means no split, so the whole word
stays one part).

This is a hand-rolled checker, not Semgrep, for the same reason
`import-order.js` is: Semgrep has no primitive that splits an identifier
into word parts and tests each against a list across every
identifier-bearing syntax position (a `const` declaration, a function
parameter, a type/interface member, a destructuring binding, a JSX prop) at
once — writing that as `pattern-either` branches would need one branch per
syntax position, is fragile the same way the quoting/anchoring gotchas
above are, and Semgrep still couldn't do the case-preserving word-part
split itself.

**Exact-path exemption allowlist, not an inline suppression comment.** The
brief's exception for "a name forced by a third-party API, a DB column, a
persisted JSON key" is NOT syntactically detectable — a DB column's JS-side
field name is a plain identifier, indistinguishable from any other. Rather
than a new per-line suppression-comment syntax (which would need its own
override-guard-style justification check), this rule uses an exact
`{ suffix: '<path from repo root>', word: '<denylisted word>', name:
'<exact identifier>' }` allowlist in the analyzer file itself, checked by
path SUFFIX match (so a temp fixture ending in the same relative path also
matches — this is what makes the allowlist unit-testable without coupling
the test to real repo files). Keyed by (path, word, EXACT NAME), not by
word alone — the name field is load-bearing, not redundant: exempting
`idx` in `src/db/run-migrations.ts` (drizzle-kit's own generated
migration-journal JSON shape — see that file's own header comment) does
NOT exempt `idx` anywhere else, and a (path, word)-only key would have
been too WIDE inside a single file too — `src/crypto-sync/binance/binance.transactions.ts`
needed its wire-mirrored `txId` field exempted while a DIFFERENT `tx`-bearing
identifier in that SAME file (`BinanceTransactionSyncDeps`, this codebase's own type
name) still needed the ordinary rename. Every entry needs a concrete,
verified external-format citation, the same standard as every other
ignore-list exception in this repo — see
`docs/harness/documented-exceptions.md` for the full, individually-cited
list; read `EXEMPTIONS` in `scripts/checks/full-word-identifiers.js`
for the current set.

## Override forms and where each is honored

- Semgrep rule: `// nosemgrep: <rule-id> OVERRIDE(<reason>) <why>`.
- Node rule (a `NODE_RULES` row): `// kiko-override: <rule-id> OVERRIDE(<reason>) <why>`.
- Put the comment on the finding's line or the line above.
  `check:overrides` fails any `biome-ignore`, `nosemgrep`, or
  `kiko-override:` comment without `OVERRIDE(`.
- The pre-write guard accepts either spelling for any rule id (its
  `OVERRIDE_COMMENT_PATTERN` in `pre-write-guard.js`).
- `check:security` honors only Semgrep's own `nosemgrep`.
- The project-wide Node checkers (`check:import-order`,
  `check:full-word-identifiers`, `check:screen-imports`,
  `check:feature-imports`, `check:blank-line-separation`) have NO inline override. A
  `kiko-override:` gets a write past the guard, and `check:all` still
  fails on that line. A Node-rule exception needs a checker-level
  exemption (like `EXEMPTIONS` in `full-word-identifiers.js`), which is
  developer code work. Decide how a justified exception passes both the
  guard and the project-wide checker before a new Node rule ships.

## Node checkers

Each runs as `node scripts/checks/<name>.js <file>`, as a guard
`NODE_RULES` row, and project-wide through a `.sh` wrapper in
`check:all` (`plural-count.js`: a Jest invariant instead, see its bullet). Every checker and the shared scanner stay reachable for
knip only through `knip.json`'s `ignore` (read the list there; it
includes `feature-imports.js` and `specifier-scanner.js`). None has a
report or JSON mode.

Each `NODE_RULES` row names its own `projectCheck`, the gate a deny for
a pre-existing finding points at. A Semgrep deny names
`check:security`.

- `blank-line-separation.js` (`kiko-blank-line-separation`) enforces
  kiko-code-style's "Blank lines before statement blocks" and "Blank
  line between adjacent JSX sibling nodes". Read the checker for its
  keyword set and its exemptions; kiko-code-style states the rule.
  `--write` inserts the missing blank lines, then re-checks its own
  output.
- `screen-imports.js` (`kiko-no-cross-screen-import`) enforces
  the "No imports across screen folders" bullet in
  kiko-design-system's "Component set". It resolves
  relative specifiers against the importing file, which Semgrep cannot
  do. No `--write`.
- `feature-imports.js` (`kiko-feature-imports`) enforces
  kiko-code-style's "Feature imports (B2)". Per-file mode is FS-free,
  so it works on the guard's mirror. `treeRootOf` resolves a file
  inside the checker's own checkout against that root first, and only
  a path outside it (the guard mirror) by its first `src/`-style
  segment. `--tree` checks layout invariants and feature-level value
  cycles; its `barrel-leak` also catches the two-statement form
  (`import { b } …` then `export { b }`, `export default b` or
  `export const a = b`), with comments inside the import braces
  ignored. Its classification
  (`CONTAINERS`, `TEST_ONLY`, `AMBIENT_LOOSE`, …) lives in the checker;
  read it there. No `--write`.
- `specifier-scanner.js` is the shared import-specifier scanner. A new
  checker that reads import specifiers reuses it.
- `plural-count.js` (`kiko-plural-key-needs-count`) enforces kiko-translator's
  "A plural key is always called with `count`". It has no `.sh` wrapper
  and no `check:*` gate: its project-wide check is the Jest invariant
  `__tests__/plural-count.test.ts`, the same setup as
  `kiko-one-component-per-file`. It reads the plural key set from its own
  checkout's en.ts, never from the guard mirror. It is a scanner over
  `specifier-scanner.js`'s `blankNoise`, not the `typescript` compiler
  API: the guard-replay scratch checkout has no `node_modules`, so a
  checker that requires an npm package fails closed on every replayed
  file. Every checker in `scripts/checks/` stays dependency-free for the
  same reason. No `--write`.

A Jest invariant, `__tests__/cited-paths.test.ts`, fails when a skill,
agent or harness doc cites a repo path in an inline code span that does
not exist. Fix the citation in the text; never allowlist it. A sentence
that names a path that is gone (a move, a removal) writes it without
backticks, so it is not a citation; no prose wording exempts a
backticked path. The test's header defines what counts as a citation.
A partial citation that drops the root (`design-system/entity-tint/`,
`checks/lint.sh`) counts too when its first segment is a child folder
of a cited root; it fails only when no file or folder outside
`rules/fixtures/` ends with it. The partial check reads the files on
disk that git tracks or would track
(`git ls-files --cached --others --exclude-standard`, kept when
`existsSync`), so, as with the rooted `existsSync` check, a new
uncommitted file resolves and a deleted one does not.

## Pre-write guard and merge-conflict files

The guard reads the file on disk (BEFORE) and the proposed content
(AFTER). For a file with merge-conflict markers:

- BEFORE with conflict markers never causes a deny from its own parse
  error.
- A write that keeps markers is checked only if it keeps whole blocks
  (`<<<<<<<`, `=======`, `>>>>>>>`). The guard rebuilds new-ours and
  new-theirs. Every finding must exist in the union of the old-ours and
  old-theirs findings (max count). One baseline, not per side, so a block
  resolved to theirs does not falsely deny. A full resolution is the
  zero-block case of the same rule.
- A write that keeps markers without a whole block, or adds markers to a
  clean file, is denied.
- A new side that does not parse while the same side parsed on disk is
  denied. A side already broken on disk is tolerated, and its Node-checker
  findings are dropped too.
- A file WITHOUT markers that does not parse on disk is denied on every
  write. If both on-disk and new content fail to parse, the deny gives the
  on-disk advice: ask the user how to repair it. Do not work around it
  with a Bash write.
- The one-exported-component check runs in a worker thread, so the two
  sides run in parallel. A shared-code edit while a block stays on a very
  large `.tsx` can still exceed the 3 s p95 (known scanner cost).

The baseline pass re-runs only the Node rules that found something in
a new tree. See `conflictSides`, `afterTreesFor`, and
`throwIfEditBrokeASide` in `scripts/checks/pre-write-guard.js`.

## Pre-write guard replay on the Stop tier

The pre-write guard sees only `Edit`/`Write`/`MultiEdit`. The
kill-guard's SHELL-WRITE deny (above) blocks the common Bash write
forms into `src/`, `__tests__/`, and `rules/`. It allows the `--write`
fixers and git itself, which write source legitimately. What it does
not see still reaches disk unchecked: a script file that writes,
`find -exec`, a path held in a variable, and a commit of any
of these (see its Known limits). The replay catches those writes after
they land.

- **Where.** `scripts/checks/guard-replay.sh` (+ `guard-replay.js`, the
  planner and runner). `medium.sh` runs it on `Stop`/`SubagentStop`
  under its lock. It is also `npm run check:guard-replay`, part of
  `check:all`.
- **Engine.** It runs the unchanged `pre-write-guard.sh` once per file,
  as a `Write` of the working-tree content. The BEFORE content sits at
  the same relative path in a scratch `CLAUDE_PROJECT_DIR`. The
  new-finding diff, both override forms, `isInScope`, conflict-marker
  handling, and fail-closed handling are therefore the guard's own. A
  new guard rule reaches the replay with no change here.
- **Which commits.** Selection is by reachability from PASSED replays,
  not by how a commit was made or which branch has it: every commit in
  HEAD (all parents, not only the first-parent line) that no mark ref
  reaches and that is newer than the floor or has a session commit as
  a parent. Each worktree's mark is a git ref,
  `refs/kiko/guard-replay/<worktree id>` (the id hashes the worktree's
  git dir; see `harness_replay_ref` in `_lib.sh`), moved to HEAD on a
  pass and never on a failure. A pass never moves it back: when HEAD is
  the mark or an ancestor of it, the mark stays; a missing mark, one
  that is not a commit, and one HEAD diverged from (a rebase, an amend)
  move to HEAD. A mark vouches for the tree at the HEAD it recorded,
  not for each commit it reaches; see Known limits. A plain commit, an amend, a
  rebase, a cherry-pick, a `pull --rebase`, and every commit of a topic
  branch merged in (`--no-ff` or fast-forward) are all replayed. A
  backup branch, a `switch -c`, or a worktree made from HEAD hides
  nothing, because a branch name is no proof a replay passed. Commits
  another worktree's replay passed are reached by that worktree's mark
  and skipped, so a clean `git merge next` of gated work replays
  nothing.
- **Floor and never-replayed branches.** The repository's first replay
  records `refs/kiko/guard-replay-floor` (24 h before that run), pass or
  fail, and no run replays a commit older than it unless one of its
  parents is a session commit. A merge of a branch
  no replay ever passed (the first merge of `next` after the replay
  landed, or commits made by hand with no Stop hook) replays that
  branch's commits newer than the floor against their own history; they
  pass when they were written through Edit/Write. When they are too
  many, the Stop-tier deadline stops the run and says to run
  `npm run check:guard-replay` by hand, which records the pass. The
  floor does not slide, so a failed first replay resumed days later
  still fails. See `docs/harness/checks-internals.md` for the ref
  layout.
- **Files and BEFORE.** Every `.ts`/`.tsx` file changed in the working
  tree against HEAD (tracked and untracked, staged renames followed),
  plus every file a session commit touched. BEFORE is the file at the
  parent of the earliest session commit that touched it, otherwise at
  HEAD. When the file is absent there, it is a new file (every finding
  is new, as in the guard). AFTER is always the working-tree file, so a
  later fix clears the finding.
- **Merge commits.** Each session commit carries a baseline per path
  along its own line of history. A session merge keeps, for a path it
  left as one parent had it, that parent's baseline (none when that
  parent's version was already checked). For the paths it left
  different from every parent, the set `git diff-tree --cc` lists (a
  conflict resolution, a join of both sides, or anything written into
  the merge before it was committed), BEFORE is one conflict block of
  both parents' baselines, so the guard's own conflicted-BEFORE handling
  takes the union of both sides' findings. A clean merge of checked
  parents therefore replays nothing, and a finding this worktree already
  passed is never blamed on a merged-in branch that touched the same
  file.
- **Failure.** Exit 2 with the structured block. It holds each failing
  file's guard reason (file, rule, line) and says the write bypassed the
  pre-write guard. A guard crash or timeout arrives as the guard's own
  "could not check" deny and fails too. During an unfinished merge
  (`MERGE_HEAD` or unmerged paths) the block names the unfinished merge
  instead, since a file with conflict markers cannot parse. A replay
  that cannot run (git, node) fails closed with its own block.
- **Deadline.** On the Stop tier the replay starts no guard call after
  `stopTierDeadlineSeconds`: at most 150 s, and less when `medium.sh`'s
  own elapsed time (lock wait, `dup.sh`), the 25 s in-flight guard call,
  and a 60 s reserve for the later checks leave less of the 300 s hook
  budget. It then fails with a block telling the agent to run
  `npm run check:guard-replay` by hand, which has no deadline and
  records its pass. A killed Stop hook would otherwise end the turn with
  no error and no check. The `KIKO_GUARD_REPLAY_DEADLINE_SECONDS` test
  seam only lowers the 150 s ceiling.
- **Dedup and speed.** See `docs/harness/checks-internals.md`'s "Guard
  replay: fingerprint, mark, and deadline" for the fingerprint, the
  mark, and the measured time.
- **Known limits.** A plain `mv` (unstaged) reads as a delete plus a new
  file, so every finding the moved file carries counts as new: move
  with `git mv`. A file whose merge baseline has more than two versions
  (an octopus merge, or nested merges that each changed it) is checked
  against the first two only. A merge that applies one side's change to
  a file the other side renamed compares it with the renamed side's
  baseline only, so a finding the change brought reads as new. All
  three fail closed (a finding reads as new, never as old). A commit
  with a forged committer date older than the floor
  (`GIT_COMMITTER_DATE`) whose parents are all outside the session is
  skipped, so its own change is not replayed; it hides no commit under
  it, and an old-dated commit on top of session commits stays in the
  session. That is deliberate evasion, not a slip. Deleting a mark ref
  by hand only widens the replay. Deleting the floor while no mark ref
  exists (a first replay that failed), or deleting every `refs/kiko/*`
  ref, records a NEW floor 24 h before the next run, later than the old
  one, so older unchecked commits drop out. Never delete the replay's
  refs. A mark attests its tip tree only. (1) Another worktree that
  takes a Bash-written commit, fixes the file, and passes its replay
  before the author's Stop makes the author's replay pass while the
  author's tree still holds the violation, until it takes the fix.
  (2) After a pass at a fixing commit, `git reset --hard HEAD~1` passes
  (the mark on the fix reaches the older commit, so the plan is empty)
  while the tree holds the violation again. The mark stays on the fix,
  so a later revert of the fix fails; a new commit made on the older
  commit diverges from the mark and moves it there, and the violation
  is then taken as checked. `make verify` (full Jest + `check:all`) is
  the backstop: `check:security` scans `rules/semgrep-prewrite.yml`
  project-wide, and every Node rule has its own project-wide check —
  some in `check:all`, and `kiko-one-component-per-file`'s as a Jest
  test, which runs only under `make verify`. A branch no replay
  ever passed costs replay time when merged (see "Floor and
  never-replayed branches").
- **Tests.** `__tests__/guard-replay.test.ts`: a throwaway repository
  with a linked worktree, copies of the real wrappers and rule file,
  and the real Semgrep. It covers a Bash-written violation (tracked and
  new file), a committed one, a fixed one, a pre-existing one, one under
  a commit with a forged old committer date, a revert of a passed fix
  after a reset back (the mark does not move back), the mark moving to
  a rebased HEAD, rebase,
  reset plus cherry-pick, `pull --rebase`, a clean rebase, a backup
  branch, `switch -c`, a sibling worktree made after a flag, merges
  (fast forward and clean of work another worktree passed, joined both
  sides, a write staged into the merge, a Bash-resolved conflict plus a
  track worktree, a `--no-ff` merge of an own topic, a never-passed
  branch, one older than the floor), an unfinished merge, the fixers,
  the floor across a failed first replay (the
  `KIKO_GUARD_REPLAY_NOW_SECONDS` test seam, which only moves the clock
  back), the dedup skip, a crashing engine,
  the deadline (a slow Semgrep stub through the
  `KIKO_GUARD_REPLAY_DEADLINE_SECONDS` test seam, a spent hook budget,
  and the clamp), and `medium.sh` itself.

## Harness and hook changes land through a worktree

Merge a harness/hook change in a worktree first, never straight into
`main`. Before it lands, run `bash -n` on each changed shell script
under `harness/kiko/hooks/` and grep `harness/kiko/hooks/*` for
conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`). A broken hook
breaks every session's tool calls.

## Adding a pre-write guard rule

Use this for every review finding or user feedback item classified as
mechanizable (see harness-workflow's "Classify every finding").

1. **Choose the engine.**
   - Semgrep: a syntactic pattern in one file. Add it to
     `rules/semgrep-prewrite.yml`, never `rules/semgrep-mobile.yml`.
   - Node: cross-line layout, path resolution, or word splitting that
     Semgrep cannot express. Add a `NODE_RULES` row in
     `scripts/checks/pre-write-guard.js`.
   - The guard only checks `.ts`/`.tsx` outside `rules/fixtures/`,
     `node_modules/`, `ios/`, and `android/` (`isInScope`).
2. **Semgrep rule.**
   - `severity: ERROR` by default, plus a `message`, `metadata.fix`, and
     `metadata.skill`. One exception: a rule whose pattern already has
     findings in the tree that a later track removes may land as
     `severity: WARNING`. The pre-write guard denies any NEW finding
     whatever its severity, while `check:security` only surfaces
     WARNING (Class B) without failing. Example:
     `kiko-no-process-env-time-zone-in-test` landed as WARNING with 26
     findings and was promoted to ERROR after the sweep. Promote such a
     rule to ERROR when `check:security` reports 0 findings for that
     rule id (not when a grep is empty). Record the promotion condition
     in the rule's comment and in
     `docs/harness/review-to-biome-inventory.md`.
     `metadata.skill` uses `"<skill> › <heading>"`. A finding without
     `metadata.skill` makes the guard deny "could not check".
     `__tests__/skill-citations.test.ts` fails a `metadata.skill` or a
     `NODE_RULES` `skill` that names no real heading. Cite the heading
     exactly (backticks do not matter); a trailing ` (Qualifier)` and
     ` / `-joined headings are allowed, a prefix is not.
   - The guard, `check:security`, and `check:rules` load the whole file.
     Nothing else needs wiring.
   - Fixture pair: `rules/fixtures/<rule-id>.bad.<ext>` and
     `.good.<ext>` (see "The fixture contract"). A rule with a
     path-prefixed `paths.include` needs the nested layout
     `rules/fixtures/<rule-id>/<mirrored path>/<name>.(bad|good).<ext>`.
   - Add the id to `RULE_IDS_WITH_FIXTURES` in
     `__tests__/pre-write-guard-rules.test.ts`; a path-scoped rule also
     needs `NESTED_FIXTURE_PREFIXES` and `PROBE_DIRECTORIES` entries.
   - A legitimate existing site in a file the rule targets gets a
     per-line `// nosemgrep: <id> OVERRIDE(<reason>)`, never a file
     entry in `paths.exclude`. A whole-file exclude hides the rule from
     its own motivating file. `paths.exclude` is for a helper's own sink
     file or a whole out-of-scope tree. `__tests__/rule-inventory.test.ts`
     fails an exclude entry with no glob character that names one test
     file (`.test.ts`, `.test.tsx`, `.spec.*`, or a file under
     `__tests__/` or `e2e/`); a glob such as `"*.test.ts"` stays fine.
     Write `exclude:` as a block list (one `- "…"` item per line): the
     test reads only block items, so a flow list (`exclude: [...]`)
     reads as empty and fails it.
3. **Node rule.**
   - Write `scripts/checks/<name>.js`: exit 0 clean, exit 1 with
     findings on stdout. Any other exit, a signal, stderr output, or
     exit 1 with no parseable finding makes the guard deny.
   - Add `parse<Name>CheckerOutput(stdout)` returning
     `[{ line, matchedText, detailText? }]`. `matchedText` is the
     new-finding key: keep it stable under unrelated edits (no line
     numbers). Put display-only text in `detailText`. When a finding has
     `detailText`, the deny message prints it in place of `matchedText`,
     so `detailText` must still name the offending code.
   - Add one `NODE_RULES` row: `ruleId`, `extensions`, `fix`, `skill`,
     `projectCheck` (the project-wide gate the deny reason names for a
     pre-existing finding, e.g. `check:<name>`), and `run`.
     `pre-write-guard.sh` needs no change.
   - Node rules have no `rules/fixtures/` pair. Prove them with
     `__tests__/<name>.test.ts` and a case in
     `__tests__/pre-write-guard.test.ts`.
   - A new Node rule also runs on the probed negative (good) fixtures of
     `__tests__/pre-write-guard-rules.test.ts`. Make those fixtures pass
     the new rule, never exempt them.
   - Project-wide gate: `scripts/checks/<name>.sh` (copy
     `screen-imports.sh`), `package.json` `check:<name>` plus a
     `check:all` entry, and a `knip.json` `ignore` entry.
4. **Sweep in the same commit.** Fix every existing violation in the
   commit that adds the gate. A gate without its sweep breaks
   `check:all`. If the sweep is too big for one dispatch, land the guard
   row first with no gate (it blocks only NEW findings), then the sweep
   plus the gate wiring together.
5. **Deny message.** The author controls the rule id, `fix` (the correct
   pattern, one line), and `skill`. The `skill` section must exist and
   state the rule. Read `denyReason` in `pre-write-guard.js`
   for the full shape.
6. **Override form.** See "Override forms and where each is honored".
7. **Docs.**
   - A row in `docs/harness/review-to-biome-inventory.md` (always; its
     first cell is the exact rule id, see "Every mechanized finding gets
     an inventory row").
   - `docs/harness/documented-exceptions.md` for any new exclude or
     allowlist entry.
   - The CLAUDE.md checks table and `check:all` list only for a new
     `check:*` gate.
8. **Speed check.** Guard p95 must stay under 3 s. Run 20 guard calls on
   the largest real `.tsx` under `src/screens/` and take the 19th sorted
   time:

   ```bash
   F=$PWD/src/screens/forms/transaction-form/transaction-form.screen.tsx
   S=<your scratchpad>
   node -e 'const fs=require("fs");const f=process.argv[1];const line=fs.readFileSync(f,"utf8").split("\n").find(l=>/^\s*const \w+ = /.test(l));process.stdout.write(JSON.stringify({tool_name:"Edit",tool_input:{file_path:f,old_string:line,new_string:line}}))' "$F" > "$S/b.json"
   for i in $(seq 20); do CLAUDE_PROJECT_DIR=$PWD /usr/bin/time -p bash scripts/checks/pre-write-guard.sh < "$S/b.json" 2>&1 >/dev/null | awk '/^real/{print $2}'; done | sort -n | sed -n '10p;19p'
   ```

   It prints p50, then p95. A pattern that can go quadratic (a
   statement-sequence `pattern-inside` with a weak prefilter) must
   exclude files where it cannot apply; a Semgrep timeout becomes a
   "could not check" deny.

## Pinned-value rules for locked user-approved visuals

When the user approves a specific visual value at a known site, pin it
with a Semgrep rule so a change needs an override that names the
approval. Model: the `kiko-pinned-*` rules in
`rules/semgrep-prewrite.yml`.

Shape:

- Anchor on a UNIQUE site marker, such as the i18n label child or a
  named style key.
- One `patterns:` arm per way the pin can break, under a top-level
  `pattern-either`:
  - the value is present but different: capture it as a metavariable
    and reject everything else with `metavariable-regex`;
  - the attribute is absent and the default differs: `pattern` plus
    `pattern-not` with the attribute.
- Never combine `pattern-regex` with a negative filter in one arm (see
  "Semgrep facts verified on 2026-09-25").
- `metadata.skill` points at the skill section that states the pinned
  value.

Worked example (illustrative, not a real rule): pin the Summary table
preview to 5 rows.

```yaml
  - id: kiko-pinned-summary-preview-rows
    languages: [typescript]
    severity: ERROR
    message: The Summary preview table is pinned to previewRowCount={5}.
    metadata:
      fix: 'Use `previewRowCount={5}` on the Summary preview table.'
      skill: "kiko-design-system › <section that states the pin>"
    pattern-either:
      - patterns:
          - pattern: <SummaryTable ... testID="summary-preview" ... previewRowCount={$COUNT} ... />
          - metavariable-regex:
              metavariable: $COUNT
              regex: "^(?!5$).*$"
      - patterns:
          - pattern: <SummaryTable ... testID="summary-preview" ... />
          - pattern-not: <SummaryTable ... previewRowCount={$COUNT} ... />
```

To change a pinned value, do one of these:

- add `// nosemgrep: <rule-id> OVERRIDE(user-approved <date>) <why>`
  that names the user approval; or
- edit the rule in the same commit as the approved design change.

## Every mechanized finding gets an inventory row

`docs/harness/review-to-biome-inventory.md` tracks every review
finding that has been (or could be) mechanized into a Biome/Semgrep/
shell rule. A new rule of any kind gets a row there — enforced for
every Semgrep rule id by `__tests__/rule-inventory.test.ts` (the first
cell holds the exact rule id) — including the
basename-pattern `paths.include` scope, so a future rule copying the
row as a template inherits the correct (non-path-prefixed) form
instead of a stale mistake. A finding that is deliberately **not**
mechanized (e.g. Semgrep cannot read `Info.plist`, so a plist
assertion belongs in a shell check instead) gets a row noting why, not
silence.

## The medium-tier trigger filter must include the files you guard

`scripts/checks/medium.sh` early-exits silently when the session
touched no source file. A new harness check that guards a
non-`.ts`/`.tsx`/`.js` file (a Semgrep rule file, a fixture, another
`scripts/checks/*.sh` wrapper, `ios/Kiko/Info.plist`) must extend the
filter's harness-input pattern to include that file — otherwise a
session that edits only that file never triggers the new check on
`Stop`/`SubagentStop`. Read `medium.sh`'s current filter regex before
adding a new triggering path; extend it, don't bypass the early-exit
guard itself (a session that changed nothing must stay silent).

## Plist assertions

`scripts/checks/plist.sh` holds Info.plist invariants as a list of
named assertions (e.g. every credential-bearing host resolved from
`src/` + `.env` must appear in `NSPinnedDomains`). Add a new plist
invariant there as another named assertion in that same script, not as
a new standalone wrapper — `plist.sh` already owns `plutil -lint` on
`ios/Kiko/Info.plist` plus the fail-closed proofs for a missing file
or a broken `plutil`.

A credential marker is a credential header or the bare word `api_token`
(a query-parameter credential), quoted or not, so an object key the Biome
formatter unquotes and a template query string (`?api_token=${key}`) both
match. Read `scripts/checks/plist.sh` for the exact marker set.

Section 1b: a client that sends an `api_token` must also send a
`Cache-Control: no-store` request header (NSURLCache keys its disk
cache by URL). A comment, an unused constant, or `no-cache` never
satisfies it. Read section 1b of `scripts/checks/plist.sh` for the
accepted header forms.
