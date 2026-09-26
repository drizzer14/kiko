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
  the barrel/`.styles.ts` drop-with-reinclusion step) and `CLAUDE.md`'s
  "Documented exceptions" for the mutate-set and sandbox exclusions this
  mirrors. An empty changed set exits 0 (nothing to mutate).
  `KIKO_MUTATION_FULL=1` forces the whole project, and an unresolvable
  merge-base also falls back to the whole project — the gate never
  silently mutates nothing. See `CLAUDE.md`'s `check:deep` section for
  when to override the base (`KIKO_MUTATION_BASE=next` when deep-gating
  an integration stacked on `next`). This keeps the manual `check:deep` cheap;
  the diff logic is tested hermetically (a throwaway git repo, the real
  script, an arg-capturing stub) in `__tests__/mutation-stream.test.ts`.

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
`--exclude` flag needs a matching "Documented exceptions" entry in
`CLAUDE.md` — see that section for the required shape: name the
config, name the exact path/value excluded, and state the concrete,
verifiable reason (a measured false-positive rate, a tool that cannot
parse the language, a generated-and-cumulative file format), not a
vague "not relevant". `rules/fixtures/**` is the running example: it
is excluded from Biome/Knip/jscpd/the real Semgrep scan, each
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
task id (`T28`), `Task N`, review-round id (`I1`/`M2`/`N3`/`U7`),
spec/decision id (`spec 6.2`, `D14`), bug number, `USER-DECISION`,
`Requirement X`, `controller ruling N`, `section X.N`, `task brief`/
`parity brief` (with an optional `'s`), `Review Focus N`, `Minor N`,
`audit N`, `RULING RN`, `fix round N`, `round-N`, `device[- ]feedback`,
or `on-device review` left behind in a `src/**` comment. Two
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
`src/` (overridable via `IMPORT_ORDER_SRC_ROOT`, used only by the
test to point at a disposable temp fixture tree instead of the real,
much larger repo `src/`).

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
  `check:blank-line-separation`) have NO inline override. A
  `kiko-override:` gets a write past the guard, and `check:all` still
  fails on that line. A Node-rule exception needs a checker-level
  exemption (like `EXEMPTIONS` in `full-word-identifiers.js`), which is
  developer code work. Decide how a justified exception passes both the
  guard and the project-wide checker before a new Node rule ships.

## Node checkers: blank-line separation and cross-screen imports

Both run as `node scripts/checks/<name>.js <file>`, as a guard
`NODE_RULES` row, and project-wide through a `.sh` wrapper in
`check:all`. Both are in `knip.json`'s `ignore` (reached only via
`node`).

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
   - `severity: ERROR`, a `message`, `metadata.fix` (one line), and
     `metadata.skill` (`"<skill> › <heading>"`). A finding without
     `metadata.skill` makes the guard deny "could not check".
   - The guard, `check:security`, and `check:rules` load the whole file.
     Nothing else needs wiring.
   - Fixture pair: `rules/fixtures/<rule-id>.bad.<ext>` and
     `.good.<ext>` (see "The fixture contract"). A rule with a
     path-prefixed `paths.include` needs the nested layout
     `rules/fixtures/<rule-id>/<mirrored path>/<name>.(bad|good).<ext>`.
   - Add the id to `RULE_IDS_WITH_FIXTURES` in
     `__tests__/pre-write-guard-rules.test.ts`; a path-scoped rule also
     needs `NESTED_FIXTURE_PREFIXES` and `PROBE_DIRECTORIES` entries.
3. **Node rule.**
   - Write `scripts/checks/<name>.js`: exit 0 clean, exit 1 with
     findings on stdout. Any other exit, a signal, stderr output, or
     exit 1 with no parseable finding makes the guard deny.
   - Add `parse<Name>CheckerOutput(stdout)` returning
     `[{ line, matchedText, detailText? }]`. `matchedText` is the
     new-finding key: keep it stable under unrelated edits (no line
     numbers). Put display-only text in `detailText`.
   - Add one `NODE_RULES` row: `ruleId`, `extensions`, `fix`, `skill`,
     `run`. `pre-write-guard.sh` needs no change.
   - Node rules have no `rules/fixtures/` pair. Prove them with
     `__tests__/<name>.test.ts` and a case in
     `__tests__/pre-write-guard.test.ts`.
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
   - A row in `docs/harness/review-to-biome-inventory.md` (always).
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
shell rule. A new rule of any kind gets a row there — including the
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
