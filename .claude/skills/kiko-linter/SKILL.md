---
name: kiko-linter
description: Invoke when adding or changing a harness check (scripts/checks/*.sh), a Semgrep rule in rules/semgrep-mobile.yml, a fixture under rules/fixtures, a Biome rule, a plist assertion, or a Jest invariant test that mechanizes a review finding.
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

## Semgrep facts verified on 1.175 — don't relearn these the hard way

- `paths.include` must be a **basename** pattern (e.g. `"*.swift"`),
  never path-prefixed (e.g. `"ios/Kiko/*.swift"`). A
  path-prefixed include silently matches **nothing** when the fixture
  runner scans `rules/fixtures/` directly (the fixture isn't under
  that prefix) — verified by sabotage: the prefixed form drew zero
  findings on its own positive fixture.
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

## Class A vs Class B

`rules/semgrep-mobile.yml` groups rules into two severities, both
enforced by `scripts/checks/security.sh` (read that file's current
findings-handling for the exact mechanism, not restated here):

- **Class A (ERROR)** — a deterministic, always-a-bug pattern (e.g.
  TLS validation disabled, a secret written to AsyncStorage). Any
  Class A finding fails the check; there is no override path.
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

## Backlog: a rule for a plain function called inside a worklet

A proposed but NOT YET IMPLEMENTED Semgrep rule (documentation only —
do not implement without a dedicated pass): flag a plain,
non-`'worklet'`-tagged function called synchronously inside a
reanimated worklet hook (`useAnimatedStyle`, `useDerivedValue`,
`useAnimatedReaction`, `useAnimatedScrollHandler`, a `Gesture.*`
worklet callback). This is a real, previously-shipped bug class (see
`kiko-gestures`'s "Every function called inside a worklet needs its
own `'worklet'` directive" and memory
`worklet-directive-debug-swallows-release-aborts`): the missing
directive is invisible to `tsc` and to Jest (reanimated's worklet
runtime is mocked there, and Debug builds only warn), and only
SIGABRTs in a RELEASE build — exactly the class of finding this
harness exists to mechanize so it stops depending on a reviewer
happening to notice it. Needs a `rules/fixtures/<rule-id>.bad.ts` /
`.good.ts` pair per the fixture contract above before it can land;
tracked as a backlog item in `docs/harness/review-to-biome-inventory.md`.

## F4 code-style mechanization candidates — all four now implemented

The nullable-ternary rule is `kiko-no-nullable-map-ternary` (Semgrep
ERROR, `rules/semgrep-mobile.yml`) — see "Semgrep pattern strings need
quoting" below for the one gotcha that cost the most time writing it.
The one-exported-component-per-`.tsx` check is a Jest invariant, not
Semgrep — see "One exported component per `.tsx` — a Jest invariant,
not Semgrep" below. The import-length-sort check is a hand-rolled
shell+JS checker/fixer at the fast tier — see "Import length-sort — a
hand-rolled checker (and fixer)" below. The comment-history check is
`kiko-no-history-id-comment` (Semgrep ERROR, `rules/semgrep-mobile.yml`)
— see "`kiko-no-history-id-comment`" below.

## `kiko-no-history-id-comment`

Mechanizes kiko-code-style's "Comments: WHY only, never history": no
task id (`T28`), review-round id (`I1`/`M2`/`N3`/`U7`), spec/decision
id (`spec 6.2`, `D14`), bug number, or `USER-DECISION` left behind in a
`src/**` comment. Two `pattern-regex` arms, one per comment syntax —
a single regex spanning both `//` and `/* */` would have to
special-case where a line comment ends and a block comment does not.
The block-comment arm's `(?:(?!\*/)[\s\S])*?` (not a bare `[\s\S]*?`)
keeps a match from crossing a real `*/` into a LATER, unrelated block
comment.

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
rules/semgrep-mobile.yml src` reports 0 findings for it.

The same standalone-token collision applies to the `R\d`/`F\d`/`G\d`/
`C\d` families (added for review-round/audit ids like `R2-1`, `F3`,
`G2`, `C1`): a genuine prose sentence that happens to name "room R2"
or "gate G1" as its OWN standalone token is syntactically identical to
a real id and is accepted, not narrowed, the same way `D2` is above
— there is no regex that tells "room R2" apart from a real review id
without reading the surrounding English. `round-N` and `Phase N`
DON'T have this problem: the digit is part of the id shape itself
(`round-3`, `Phase 2 (Task ...`), so ordinary prose that says "a round
trip" or "the final phase" (no trailing digit) never matches at all —
see `rules/fixtures/kiko-no-history-id-comment.good.ts` for both.

## One exported component per `.tsx` — a Jest invariant, not Semgrep

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
directly above that group's first import) — folding it would strand
that prefix mid-chain once the group boundary disappears, with
nowhere left to attach it. `mergeAdjacentSameKindGroups` returns this
second case as `blockedByPrefix` (the 1-based ORIGINAL group number),
and `--write` prints `left for hand merge: <file> group N (prefix
comment)` and exits non-zero for it — never a silent no-op that reads
as "nothing to fix" while the merge violation is still there.

## `kiko-no-switch` — an AST `switch` pattern, not a keyword regex

`kiko-no-switch` (`rules/semgrep-mobile.yml`, Class A) mechanizes
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
list (18 entries: the drizzle migration-journal shape, NBU register's
`val_code`, Binance's `{code, msg}` error body and its `txId`
history-record field, Esplora's `tx_count`, and React Native
`FlatList`'s own `initialNumToRender` prop).

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
