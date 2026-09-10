---
name: kiko-linter
description: Invoke when adding or changing a harness check (scripts/checks/*.sh), a Semgrep rule in rules/semgrep-mobile.yml, a fixture under rules/fixtures, a Biome rule, a plist assertion, or a Jest invariant test that mechanizes a review finding.
---

# Kiko linter and harness-check authoring

Source of truth: `CLAUDE.md` (the checks table, "Override protocol",
"Documented exceptions") and `scripts/checks/_lib.sh`. This skill
states the conventions for adding to the harness itself — the checks
that check the app, not the app's own code style (see
`kiko-code-style` for that). Some files named below
(`scripts/checks/semgrep-rules.sh`, `scripts/checks/plist.sh`,
`scripts/checks/typecheck.sh`, `rules/fixtures/`) land with the
2026-09-06 security-pass-fixes / bug-hunt-fixes branches — check
`ls scripts/checks/` before assuming a given wrapper already exists on
the branch you're on.

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

  `mutation.sh` also DIFF-SCOPES by default: it mutates only the `.ts`/
  `.tsx` source files this branch changed vs the merge-base with
  `${KIKO_MUTATION_BASE:-main}` (tests and fixtures — `*.test.ts(x)`,
  `__tests__/`, `rules/fixtures/` — excluded to match the config's mutate
  excludes), passed to Stryker as an explicit `--mutate` list that
  overrides the whole-tree glob. An empty changed set exits 0 (nothing to
  mutate). `KIKO_MUTATION_FULL=1` forces the whole project, and an
  unresolvable merge-base also falls back to the whole project — the gate
  never silently mutates nothing. This keeps the manual `check:deep`
  cheap; the diff logic is tested hermetically (a throwaway git repo, the
  real script, an arg-capturing stub) in `__tests__/mutation-stream.test.ts`.

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
  never path-prefixed (e.g. `"ios/KikoWidget/*.swift"`). A
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
both `ios/Kiko/Info.plist` and `ios/KikoWidget/Info.plist` plus the
fail-closed proofs for a missing file or a broken `plutil`.
