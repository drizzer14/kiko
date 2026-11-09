## Review cadence

- One `kiko:reviewer` pass per phase or task group, plus one
  whole-branch pass before merge. Never a review after every step.
- Cheap same-file Minors may ride a Critical/Important fix round; never
  open a fix round for Minors alone.
- Every migration, including a pure CREATE INDEX, goes to `kiko:reviewer`
  before its window's BATCH READY, which names the migration number. The
  brief asks which existing queries touch the column or table and which
  index each now uses. A new index without an EXPLAIN QUERY PLAN test is
  a finding.
- Each track ends with one `kiko:designer` consistency review before its final READY (user
  ruling 2026-11-06). The brief says READ ONLY, because the agent has write tools. It covers
  every screen and component the track touched: shared design-system components with no local
  copies, tokens only, the same patterns as sibling screens (dividers, headers, buttons, tones,
  empty states), en and uk, dark, and light once it ships. Its findings become one small fix
  set with its own fresh review. The final READY names the designer review file.

## Orchestrator defaults never widen or contradict

An orchestrator's default choices never contradict an established
design or code pattern, and never widen a user instruction beyond
what was asked; take the narrowest reading.

## UI feedback rounds: audit before fixing

Before fixing a round of UI feedback, run a UX-consistency audit of
the affected screens against `kiko-design-system` and against how
the same pattern is already built elsewhere; fix the pattern
everywhere it appears, then distill new rules into the skill.
Then classify every finding (see "Classify every finding").

## Classify every finding

After each UI feedback round and each phase or whole-branch review,
classify EVERY finding, with a one-line reason:

- (a) mechanizable now: add a pre-write guard rule in the same round;
- (b) mechanizable with a pinned value: add a pinned-value rule in the
  same round;
- (c) judgment-only: stays with the reviewer.

The round's report lists the classification. The scribe or developer
adds the rules, following kiko-linter's "Adding a pre-write guard rule"
and "Pinned-value rules for locked user-approved visuals". The
reviewer's `mechanizable: yes/pinned/no` tag is the first draft.

## Large reviews

Split a big review into parallel read-only reviewer slices by commit
range, each writing its own output file. Review a mechanical sweep by
static proof, not by sampling: resolve every import binding and
`jest.mock`/`require` target at both commits, count cycles, and check
each side-effect import's predecessors. A reviewer of a multi-thousand-line move goes past 150k
context: split the review per new skill and re-review with a fresh reviewer.

## The Stop-hook dup check is scoped

`medium.sh`'s Stop/SubagentStop hook runs jscpd scoped to the
session's own changed files (`scripts/checks/dup.sh <changed files still on disk>`)
— the project-wide `npm run check:dup` (no args, scans the whole
repo) can be green while this scoped run fails, or vice versa. Run the
same scoped command yourself before reporting done:
`bash scripts/checks/dup.sh <changed files still on disk>` (space-separated paths;
this is the same wrapper `check:dup` calls, `scripts/checks/dup.sh`,
which accepts file args and falls back to the whole repo with none).
Each touched test file must also pass the check alone, not only as
part of the whole changed-file set. A touched test file that is already over 5% alone is step
work: the step dedups it, never a later cleanup. A `WARNING` on exit 0 means a large
file (or a scoped combined large-file run) is over 5% but at or under its ceiling in
`scripts/checks/dup-ceilings.tsv`: it does not block, but do not grow a figure. Every other
large-file finding (above the ceiling, unlisted, could not measure or list, mktemp) exits 2
and names the file and the ceilings file. The
large-file pass runs on every call, a dedup skip included; see kiko-linter
"`check:dup` measures the files jscpd skips for size".

## Relay-verify subagent claims

Before closing a round, re-run (or have a fresh reviewer re-run) any
check a subagent claims already passed — do not relay a "green" claim
without independent verification. Also spot-check that a skill
section a report cites actually exists at the stated path/heading
before trusting a claim built on it.

The orchestrator quotes the jest summary lines itself ("Test Suites: N
passed", "Tests: N passed") in every BATCH READY, and never relays an
agent's "passed" verdict (ops misreported a failed `make verify` as
passing twice on 2026-10-10).

## A signal or race flake needs a measured probe

For a signal or race flake a source read is a hypothesis only. A fix needs a probe of N trials
with a baseline (H8: foreground `mv` lost 90/2600, `mv & wait $!` 0/3400) and a red row that
fails on the base. Load and signal probes go to `kiko:ops`.

A fix that moves work to the background lists its new interleavings in the brief (late completion
after cleanup, pid reuse during a long stop, a signal while starting), each with a rendezvous
red row.

A date written into a doc comes from `git log -1 --format=%cs` (or `date +%F`) at write time,
never from a session's own notes clock.

## Probe an unmeasured UIKit behavior before a native fix

A native fix that rests on an unmeasured UIKit behavior gets a cheap, behavior-changing probe in a
scratch worktree BEFORE a developer starts (iPad F2, 2026-10-27). The probe's measured result goes
into the brief; a source read is a hypothesis only.

## Probe a live API before building on its shape

Before building code that depends on an API's response shape, probe it
with real read-only calls (2026-10-10: the probe showed Binance
walletTypes are strings and the Pay direction-by-shape rule false on
all C2C receives).

## Deferred-to-scribe items must be named explicitly

A "deferred to the scribe step" item that is not a skill edit (plan
text, other docs) must be named explicitly in the brief handed to
`kiko:scribe` — never left implicit for the scribe to guess at. A ruling
that reverses a spec or plan sentence names that sentence (file:line) in
the scribe list at once, not at the end of the set.

## Write the rule into its skill, not a third brief

When a fix brief is about to restate the same rule a second time,
write the rule into its owning skill instead — a brief that repeats a
rule already stated once is a sign the rule belongs in the skill, not
in another one-off brief.
