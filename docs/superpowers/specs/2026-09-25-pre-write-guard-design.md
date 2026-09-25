# Pre-write guard — design spec

Date: 2026-09-25
Status: approved design, not yet implemented
Branch this spec lives on: `pre-write-guard` (based on `feat/assets-debts` at `543d7b8`)

## Goal

An agent must not be able to WRITE a known common mistake into the
tree in the first place. Every other check in this repo (`fast.sh` on
`PostToolUse`, `medium.sh` on `Stop`/`SubagentStop`) inspects a file
AFTER the `Edit`/`Write`/`MultiEdit` tool call already changed it on
disk. The pre-write guard is a new `PreToolUse` hook that inspects the
PROPOSED content of an `Edit`, `Write`, or `MultiEdit` tool call
BEFORE it is applied, and DENIES the tool call outright when the
proposed content newly introduces one of the 17 rules below. Scope of
the 17 rules: code style, design system usage, and architecture. It is
not a general lint pass — see "Out of scope" below for what stays with
the human/`kiko:reviewer` review step instead.

## The 17 rules

### Tier 1 — reuse an existing check, unchanged, just run earlier

These already exist as `rules/semgrep-mobile.yml` Semgrep rule ids or
as one of the Node checks under `scripts/checks/`. The pre-write guard
runs the SAME rule/scanner against the proposed content; it does not
redefine or duplicate the rule's logic.

1. `kiko-no-history-id-comment` (`rules/semgrep-mobile.yml`) — no task
   id / review-round id / spec-decision id / bug number in a comment.
2. `kiko-no-nullable-map-ternary` (`rules/semgrep-mobile.yml`) — no
   hand-rolled `x === undefined ? undefined : f(x)` (and the `null`/
   `== null`/list-or-empty variants).
3. `kiko-no-switch` (`rules/semgrep-mobile.yml`) — `switch` is banned;
   use `ts-pattern`'s `match(...).exhaustive()` or a typed
   `Record<Literal, X>`.
4. Import order (`scripts/checks/import-order.js`) — the leading
   import header's 3-group, length-sorted shape it already checks.
5. Full-word identifiers (`scripts/checks/full-word-identifiers.js`)
   — its denylist and its exact `EXEMPTIONS` array, unchanged; the
   pre-write guard consults the exemptions list already in that file
   rather than re-deciding exemptions itself.
6. One component per file (`scripts/checks/one-component-per-file.ts`,
   `exportedComponentNames`) — at most one exported, component-like
   declaration per `.tsx` file. Exemptions carried over unchanged: a
   small, non-exported local component, and an inline mock component
   declared inside a `jest.mock(...)` factory body (already excluded
   structurally in `one-component-per-file.ts` because a factory body
   is indented, never column-0).
7. `kiko-no-use-animated-keyboard` (`rules/semgrep-mobile.yml`) —
   `useAnimatedKeyboard()` is banned; use React Native's plain
   `Keyboard` events instead.

### Tier 2 — new exact rules, each shipped with a fixture pair

Each of these is a NEW rule the implementation task adds, with a
`<rule-id>.bad.<ext>` / `<rule-id>.good.<ext>` fixture pair under
`rules/fixtures/` (or the pre-write-guard's own equivalent fixture
location — see "Semgrep rule set" below), exactly as
`scripts/checks/semgrep-rules.sh` already requires for every
`rules/semgrep-mobile.yml` rule.

8. No raw hex or `rgba(...)` color literal outside
   `src/design-system/theme/`. A color value belongs in the theme
   token layer (`src/design-system/palette.ts`, `src/design-system/theme.ts`
   — read those files for the current token set; do not copy it here)
   and every other file references a token, never a literal.
9. `GlassSurface` (`src/design-system/components/glass-surface/`) may
   only be imported at a nav-layer call site: a bottom sheet, the tab
   bar, a keyboard accessory, or a FAB. This is an import-site
   allowlist keyed on the IMPORTING file's path, not the component's
   own file — `glass-surface.component.tsx` itself, its own test file,
   and its sibling `.styles.ts`/`.hook.ts` files are never flagged for
   importing their own module. The allowlist is a list of path
   glob/prefix patterns maintained in the rule's own source (Semgrep
   rule metadata or a small Node check, per "Semgrep rule set" below);
   read that source for the exact current allowlist rather than
   restating it here, since a new nav-layer surface can extend it.
10. No hand-built copy of a shared component that already exists for
    the purpose. Named patterns this rule starts with (the set grows
    as new duplicated patterns are found in review):
    - a raw divider (a `View` styled as a 1px hairline) instead of the
      shared divider component;
    - a raw error `Text` instead of `FieldError`
      (`src/design-system/components/field-error/`);
    - a raw `Pressable` built as a selectable row instead of
      `SelectableRow` (`src/design-system/components/selectable-row/`).
11. A blank line is required immediately before a `return`, `if`, or
    `for`/`while` statement (when it is not the first statement in its
    block), and between two adjacent JSX sibling elements at the same
    nesting level (when they are not the only two children and there
    is no comment already separating them). This is a NEW style rule,
    not previously mechanized anywhere in `rules/semgrep-mobile.yml`
    or Biome.
12. No import from another screen's folder. A file under
    `src/screens/<screen-a>/` must not import from
    `src/screens/<screen-b>/**` for any `screen-b !== screen-a`; shared
    code belongs in `src/design-system/`, a shared hook/util directory,
    or is re-exported through an explicit barrel outside `src/screens/`.
    This is distinct from the existing
    `kiko-no-import-screens-outside-ui` rule, which restricts what
    NON-screen code may import from `src/screens/`; this new rule
    restricts screen-to-screen imports instead.
13. No hard-coded user-facing string in a sync/provider module: a
    string literal passed to `throw new Error(...)` under
    `src/crypto-sync/**` or `src/monobank/**`, and a biometric-cancel
    label string, must come from the i18n layer, not a literal in the
    module.
14. A placeholder string (an input's `placeholder` prop, or an i18n
    key ending `Placeholder`) must not be textually equal to its
    sibling label string, checked per key-name pairing in `en.ts` and
    `uk.ts` (a `fooLabel`/`fooPlaceholder` pair, or equivalent naming,
    whose two string VALUES are identical is flagged).
15. A function used inside a Reanimated worklet context (passed to
    `useAnimatedStyle`, `useDerivedValue`, `runOnUI`, a
    gesture-handler callback, or referenced from inside one of those)
    needs the `'worklet'` directive as its first statement. This is a
    heuristic, not a full type-flow analysis: false negatives (a
    worklet-context function the heuristic fails to flag) are
    accepted; a false positive (flagging a function that is not
    actually run on the UI thread) is expected to be rare given the
    named-call-site heuristic, but is not mathematically impossible —
    an override is available for a confirmed false positive (see
    "Override protocol" below).

### Tier 3 — narrow, pinned call sites

16. Fixed button variants at named call sites: the Sync button and the
    Change bank button use `variant="secondaryTonal"`; every sheet's
    Cancel button uses one style everywhere — `variant="ghost"` with
    a red/destructive text color (see
    `src/design-system/components/button/button.props.d.ts` for the
    current `ButtonVariant` union this cites against — `secondaryTonal`
    and `ghost` are both confirmed present there as of this spec).
    Read that file at implementation time to re-verify the variant
    names are still current before pinning them into the rule.
17. A known Nitro view prop must never be passed `undefined` at a
    call site where the underlying native prop requires a concrete
    value — the confirmed case is `SFSymbolView`'s `fallbackName` prop
    (see the `sfsymbol-fallbackname-null-crash` memory: a prop that
    silently flips from a string to `undefined` serializes to `null`
    and aborts a Release build). The rule's own source lists the exact
    set of Nitro props known to have this failure mode; that set
    starts at just `SFSymbolView.fallbackName` and grows as new cases
    are confirmed — read the rule source for the current set rather
    than assuming this list is exhaustive.

### Out of scope (stays with `kiko:reviewer`)

The pre-write guard does not attempt, and must not be extended to
attempt without a new design decision, any of: fnts-vs-try/catch
style choice, general button-hierarchy judgment beyond the 3 pinned
sites in rule 16, near-duplicate-but-not-identical string detection,
"divergent twins" (a fix applied to one of two structurally identical
files but not the other), dead code, or whole-app sibling-structure
consistency. These require judgment a mechanized rule cannot safely
automate at deny-the-write granularity; they stay in
`kiko:reviewer`'s whole-diff pass.

## Trigger and wiring

A new `PreToolUse` entry is added to `harness/kiko/hooks/hooks.json`,
matcher `Edit|Write|MultiEdit`:

```json
{
  "matcher": "Edit|Write|MultiEdit",
  "hooks": [
    {
      "type": "command",
      "command": "bash ${CLAUDE_PROJECT_DIR}/scripts/checks/pre-write-guard.sh",
      "timeout": 30
    }
  ]
}
```

This is added alongside the existing `PreToolUse` `Bash` matcher
(`kill-guard.sh`) already in `harness/kiko/hooks/hooks.json`, not in
place of it — `PreToolUse` accepts multiple matcher entries, one per
tool pattern, and Claude Code runs the one whose matcher matches the
tool being called.

This `hooks.json` entry lands on `main` immediately, in the same
initial-wiring commit as `scripts/checks/pre-write-guard.sh` itself
(see "Rollout" below) — it is never merged with the entry present but
the script absent, because `hooks.json` is shared config every worktree
reads and Claude Code invokes the hook COMMAND regardless of whether
the referenced script exists in that particular worktree's checkout.
`pre-write-guard.sh`'s own first lines therefore check for their own
required tooling (Node, `semgrep`) and for their own required sibling
files (the pre-write rule set — see "Semgrep rule set" below); when a
worktree does not yet have the rule set (a worktree still on an older
commit than the one that adds it), the script must recognize that
specific "sibling file absent" case and exit 0 (no-op), the same way a
missing `scripts/checks/pre-write-guard.sh` file itself would make the
hook command fail to execute and Claude Code treats a failed-to-run
hook command as non-blocking. This no-op path is DIFFERENT from every
other failure path in this spec (see "Fail closed" below): the
distinction is "this repo checkout predates the feature entirely" vs.
"the feature exists here and something in it broke."

## File scope

Only `.ts`/`.tsx` files are in scope, matching the file types every
Tier 1/2/3 rule above actually targets. Excluded from the guard
regardless of extension:

- `rules/fixtures/**` — a bad fixture is REQUIRED to contain the
  violation it fixture-tests; running the guard against it would
  deny the very file `check:rules` (`scripts/checks/semgrep-rules.sh`)
  needs to exist.
- `node_modules/**`, `ios/**`, `android/**` — never edited by an
  agent as source; excluded the same way `override-guard.sh` already
  excludes `node_modules` and `ios` from its own scan
  (`--exclude-dir=node_modules --exclude-dir=ios`).
- Any generated file: `ios/**`/`android/**` covers the native
  generated trees; there is no other generated `.ts`/`.tsx` output
  checked into this repo as of this spec (verify at implementation
  time — if one is added later, add it here).

A file outside `.ts`/`.tsx` (for example `.md`, `.json`, `.yml`) is
never in scope; the guard exits 0 immediately once it reads the
target file path and the extension does not match, mirroring how
`fast.sh` and the individual check wrappers (`import-order.sh`,
`full-word-identifiers.sh`) already gate on extension before doing any
real work.

## Rebuilding the proposed content

A `PreToolUse` hook for `Edit`/`Write`/`MultiEdit` receives the tool's
input JSON on stdin (the same `tool_input` shape `fast.sh` already
reads for its own `PostToolUse` case, and the same shape
`kill-guard.js` already reads for the `Bash` case). The guard must
reconstruct BOTH the file's content before the edit (reading it off
disk, or empty string for a file that does not yet exist) and its
content after the edit would apply, entirely from that JSON — the
edit has not been applied to disk yet, that is the entire point of a
`PreToolUse` hook.

- `Write`: AFTER is `tool_input.content` verbatim. BEFORE is the
  current on-disk content of `tool_input.file_path` if the file
  exists, or empty string if it does not (a new file).
- `Edit`: BEFORE is the current on-disk content of
  `tool_input.file_path`. AFTER is BEFORE with
  `tool_input.old_string` replaced by `tool_input.new_string` — every
  occurrence when `tool_input.replace_all` is true, otherwise the
  first (and, per the Edit tool's own contract, only, since a
  non-unique `old_string` is itself a tool error) occurrence.
- `MultiEdit`: BEFORE is the current on-disk content of
  `tool_input.file_path`. AFTER is produced by applying
  `tool_input.edits` in array order, each one exactly as the single-
  `Edit` case above, to the running result of the previous edit in
  the array — the same order the real `MultiEdit` tool applies them
  in.

Both BEFORE and AFTER are written to a temporary root that MIRRORS the
file's real repo-relative path (for example
`<tmp>/src/screens/holdings/holdings.screen.tsx`), not a flat
temp-file name — this is required so the existing Semgrep rule set's
`paths.include`/`paths.exclude` patterns (which match on repo-relative
path) still apply correctly when Semgrep is pointed at the temp root
instead of the real tree, and so a Tier 2/3 rule that keys off path
(rule 9's nav-layer allowlist, rule 12's screen-folder rule, rule 13's
`src/crypto-sync/**`/`src/monobank/**` scope) evaluates against the
correct path.

## Checks run

ONE Semgrep invocation, against the AFTER tree, using a dedicated
pre-write rule set covering rules 1–3, 7–10, and 12–17 (every Tier
1/2/3 rule that is a per-line/per-pattern match Semgrep can express).
This dedicated rule set is EITHER a new file
`rules/semgrep-prewrite.yml` that imports/duplicates the Tier-1 rule
bodies from `rules/semgrep-mobile.yml` plus the new Tier 2/3 rule
bodies, OR a shared `rules/semgrep-mobile.yml` with the Tier-1 rule
ids added to a `metadata.prewrite: true` tag the guard filters on via
`semgrep --config rules/semgrep-mobile.yml --severity ERROR
--include-metadata prewrite` (exact CLI flag to be confirmed against
the installed Semgrep version at implementation time). Decision for
implementation: a SEPARATE `rules/semgrep-prewrite.yml` is preferred
over a tag/filter on the shared file, because a pre-write rule must
run on a temp-mirrored tree with different path roots than the real
`check:rules`/`check:security` scans, and mixing that path-shape
concern into the single shared rule file risks a rule silently
changing behavior for the FULL-TREE `check:rules` run too. A separate
file keeps the two rule sets independently editable; the Tier-1 rule
BODIES are still shared (the pre-write file references or copies the
same rule body — never a redefinition that could drift from
`rules/semgrep-mobile.yml`'s own version of the rule). The exact
sharing mechanism (a YAML anchor/copy vs. Semgrep's own multi-file
`--config` merging both files) is an implementation detail to resolve
against the installed Semgrep version's capabilities; either is
acceptable as long as a Tier-1 rule's body is never hand-duplicated in
a way that could drift.

Then, in the SAME `pre-write-guard.sh` run, the Node checks — rule 4
(`import-order.js`), rule 5 (`full-word-identifiers.js`), rule 6
(`one-component-per-file.ts`'s `exportedComponentNames`), and rule 11
(new: blank-line-before-return/if/for-while and between JSX siblings)
— against the AFTER tree's file, using each script's existing CLI
entry point unchanged for rules 4–6, plus a new script
(`scripts/checks/blank-line-separation.js`, naming to be fixed at
implementation time) for rule 11.

## New-findings-only comparison

The guard denies ONLY a finding the edit ADDS — a violation already
present in BEFORE never blocks unrelated work in the same file. This
matches the standing rule elsewhere in this harness that an existing
violation is swept separately from a new rule's introduction (see
CLAUDE.md's Semgrep rules table: "every new ERROR rule lands with a
sweep of existing violations in the tree" — the pre-write guard
applies that same principle at write time instead of at rule-creation
time).

The guard therefore runs every check (the Semgrep pass and the four
Node passes) TWICE per proposed edit — once against BEFORE, once
against AFTER — and diffs the two finding sets. The matching key
between a BEFORE finding and an AFTER finding, used to decide "is this
the same violation, just shifted by a line number" vs. "this is new,"
is:

```
(rule id, normalized matched text, occurrence index)
```

where "normalized matched text" is the finding's own matched span with
all whitespace runs collapsed to a single space and leading/trailing
whitespace trimmed (so reformatting alone never turns a stable
violation into a "new" one), and "occurrence index" is the finding's
1-based rank among all findings sharing the same (rule id, normalized
matched text) pair in that scan, in file order (so two textually
identical violations of the same rule in the same file are matched to
each other pairwise by position among duplicates, not merged into one
key). Line number is explicitly NOT part of the key — an edit earlier
in the file that shifts every subsequent line must never cause an
untouched later violation to read as "new." A finding present in the
AFTER key set but absent from the BEFORE key set is new and blocks the
write; a finding present in both is pre-existing and is reported to
neither the agent nor the transcript by this hook (it is still visible
to `check:rules`/`check:all`, which are unaffected by this hook).

## Deny message

On a block, the hook's stdout is the documented Claude Code
`PreToolUse` deny JSON — the same
`hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision:
'deny', permissionDecisionReason: <text> }` shape `kill-guard.js`
already emits for the `Bash` case (see `scripts/checks/kill-guard.js`).
`permissionDecisionReason` is a structured message containing, per new
finding: the rule id, the line number in the PROPOSED (AFTER) file,
the exact offending matched text, the correct pattern to use instead,
and a pointer to the skill section that states the rule (for example
"see `kiko-code-style`'s Import ordering section" for rule 4, or
"see `kiko-design-system`'s GlassSurface section" for rule 9) — the
same five-part shape (WHAT/DETAILS/WHY/HOW/DO-NOT) every other check
wrapper's `print_block` already uses via `scripts/checks/_lib.sh`,
adapted to a single JSON string field since a `PreToolUse` deny reason
is plain text, not a block written to stderr.

## Override protocol

An exception needs the same justified form CLAUDE.md's "Override
protocol" already requires for a bare `biome-ignore`: a
rule-id-specific comment placed on (or immediately above) the line the
finding would otherwise attach to.

- Semgrep-checked rules (1–3, 7–10, 12–17): `// nosemgrep: <rule-id>
  OVERRIDE(<reason>) <specific justification>` — Semgrep's own
  `nosemgrep: <rule-id>` suppression syntax, with the same
  `OVERRIDE(...)` marker CLAUDE.md already requires, so a bare
  `nosemgrep` with no `OVERRIDE(...)` is exactly as invalid as a bare
  `biome-ignore`.
- Node-checked rules (4–6, 11): a rule-specific override comment
  recognized by that script — for rules 4–6 this is a NEW capability
  none of `import-order.js`, `full-word-identifiers.js`, or
  `one-component-per-file.ts` has today (today they have no override
  syntax at all, because they are not deny-gating a write; they only
  report). Implementation must add a
  `// kiko-override: <rule-id> OVERRIDE(<reason>) <justification>`
  convention understood by the pre-write guard's wrapping of these
  scripts (not necessarily by the scripts' own existing project-wide
  `check:import-order`/`check:full-word-identifiers` modes, which have
  never needed one before and can keep failing loudly on anything
  the pre-write guard would have exempted, forcing a real fix or a
  documented exception through CLAUDE.md's normal exceptions list
  instead).

`npm run check:overrides` (`scripts/checks/override-guard.sh`) must be
extended, at implementation time, to also fail on a bare `nosemgrep:`
or bare `kiko-override:` comment with no `OVERRIDE(...)`, the same way
it already fails on a bare `biome-ignore` — this closes the same
suppression-without-justification gap for the two new comment forms
this feature introduces.

## Fail closed

If the guard errors internally (a crash in the rebuild logic, Semgrep
failing to start, a Node check throwing) or times out, the guard
DENIES the write and prints the error as the deny reason. It never
allows a write it did not successfully check — "I could not check
this" is treated the same as "I found a problem," not the same as "I
found nothing." The ONE case that is a no-op rather than a deny is the
one already described in "Trigger and wiring": the pre-write rule set
or script itself is entirely ABSENT from this checkout (an older
worktree that predates this feature) — that is not a runtime failure
of an existing guard, it is the guard not existing yet in this
checkout, and is detected by the wrapper script checking for its own
required sibling files' presence before attempting anything else.

## Speed target

Target: under 3 seconds per edit, measured as both p50 and p95 against
a real file in this repo (not a synthetic microbenchmark) at
implementation time, and stated in the implementation's own PR/commit
rather than assumed here. The two BEFORE/AFTER Semgrep runs plus four
BEFORE/AFTER Node-check pairs (8 total sub-invocations per edit) are
the dominant cost; if Semgrep's own process-startup overhead makes
that target unreachable, the accepted mitigation is caching the
PARSED rule set between invocations (for example Semgrep's own
`--metrics off` plus its built-in rule-cache behavior, or precompiling
the rule YAML once and reusing that compiled form across the guard's
own repeated invocations within a session) — never a persistent
Semgrep daemon left running as a detached background process, because
that would be a process an agent would have to remember to kill,
which conflicts with this harness's standing "no pattern/process-group
kill, stop only a PID you started yourself" discipline and adds an
operational burden this guard must not create.

## Relation to the existing check tiers

Nothing already in `fast.sh` (`PostToolUse`) or `medium.sh`
(`Stop`/`SubagentStop`) is removed. The pre-write guard is a NEW,
earlier tier — it runs before the write lands at all, `fast.sh` still
runs after the write lands (catching anything outside the pre-write
guard's 17-rule scope: Biome lint/format, the full `security.sh`
Class A Semgrep set beyond the pre-write subset, secrets), and
`medium.sh` still runs at `Stop`/`SubagentStop` unchanged (`dup`,
`knip`, `deps`, the full `check:rules` fixture proof, plist, typecheck,
`override-guard.sh` project-scoped). A rule the pre-write guard
successfully blocks will, by construction, never be seen by `fast.sh`
or `medium.sh` — those two tiers are unaffected in their own logic,
just less likely to ever find one of these 17 specific violations,
because the agent was denied from writing it.

## Tests

- A fixture pair per NEW rule (8–17, ten rules) under whatever
  location the "Semgrep rule set" decision above lands on
  (`rules/fixtures/` if the rules are folded into
  `rules/semgrep-mobile.yml`'s tag-filtered scheme, or a parallel
  `rules/fixtures-prewrite/` if `rules/semgrep-prewrite.yml` is a
  separate file — either way, `check:rules`-equivalent proof that each
  new rule still fires on its bad fixture and stays quiet on its good
  one is required before the rule is considered shipped, per
  `scripts/checks/semgrep-rules.sh`'s existing contract).
- Jest tests for the guard's own logic
  (`__tests__/pre-write-guard.test.ts` or co-located, naming to be
  fixed at implementation time), covering at minimum:
  - `Write` rebuild (new file, and overwriting an existing file).
  - `Edit` rebuild, both single-occurrence and `replace_all: true`.
  - `MultiEdit` rebuild, edits applied in array order, each building
    on the previous edit's result.
  - New-only blocking survives a line shift: a violation already
    present in BEFORE, on a line whose number changes in AFTER purely
    because of unrelated lines added earlier in the file, is NOT
    reported as new.
  - A justified override (`OVERRIDE(...)` present) is accepted and the
    write proceeds; a bare `nosemgrep`/`kiko-override` with no
    `OVERRIDE(...)` is rejected the same way `check:overrides` rejects
    a bare `biome-ignore`.
  - Fail-closed: an internal error (a thrown exception, a Semgrep
    process that exits with neither 0 nor 1) results in a deny, not an
    allow.
  - No-op outside scope: a non-`.ts`/`.tsx` file, and a path under
    `rules/fixtures/**`, both produce no deny regardless of content.

## Docs to update at implementation time

These are NOT updated by this spec itself — they are the follow-up
work list for the implementation task:

- `CLAUDE.md`'s checks table (a new row for the pre-write guard) and
  its "Automatic wiring" paragraph (a new `PreToolUse` matcher
  alongside `kill-guard.sh`).
- `docs/harness/documented-exceptions.md` (the new
  `nosemgrep`/`kiko-override` suppression forms, once any real
  exception is actually used).
- The `kiko-linter` skill (`.claude/skills/kiko-linter/SKILL.md`) —
  the pre-write guard's own wrapper-contract shape (it is neither a
  plain silent-on-success check wrapper like the rest, nor exactly
  `kill-guard.sh`'s always-exit-0 shape, since it DOES deny/fail —
  document its own contract explicitly, the way `kill-guard.sh`'s
  contract is called out as a named exception today).
- The `harness-workflow` skill (`harness/kiko/skills/harness-workflow/`
  or `.claude/skills/` equivalent, per the skill-drift rule) — an
  agent now has 17 additional ways a write can be denied outright,
  which changes what "the harness blocked me" looks like in practice.

## Rollout

The user updates the `kiko` plugin and runs `/reload-plugins` in every
currently-running session once the `hooks.json` change and
`pre-write-guard.sh` land — a running session does not pick up a new
hook without a reload (see CLAUDE.md's existing rule that a harness
change needs a track merge + reload to reach a running track). The
coordinator merges the `pre-write-guard` branch into
`feat/assets-debts` at a clean boundary (no in-flight edit mid-merge in
either branch); the feature then reaches `main` whenever
`feat/assets-debts` itself merges to `main`, following the same
rolling-per-track-integration path every other track on this repo
already uses.

## Risks

- **False positives blocking real work.** A rule (most likely 9, the
  `GlassSurface` nav-layer allowlist, or 15, the worklet-directive
  heuristic) can flag a legitimate edit it should not. Mitigation: the
  override protocol above gives an agent (or a human) an immediate,
  auditable way past a specific false positive without weakening the
  rule for everyone else; and every Tier 2/3 rule ships with a fixture
  pair that documents the exact positive/negative boundary, so a false
  positive found in practice becomes a fixture-tested fix to the rule
  itself rather than a one-off suppression that hides the next real
  case too.
- **Speed.** Running 8 sub-invocations (2 trees times 4 check groups)
  synchronously inside a `PreToolUse` hook, which blocks the tool call
  until it returns, risks a slow edit loop if the 3-second target is
  missed. Mitigation: measure p50/p95 against a real file before
  declaring the feature done (see "Speed target"), and cache the
  parsed Semgrep rule set between invocations rather than reparsing
  YAML on every single edit.
- **Merge overlap with the feat track's own rules file.** This branch
  and `feat/assets-debts` (and whatever else lands on
  `rules/semgrep-mobile.yml` in between) can both edit that same file
  concurrently; a Tier 1 rule id or a rule body could diverge or
  conflict at merge time. Mitigation: keeping the pre-write-only rule
  additions in a SEPARATE file (the preferred `rules/semgrep-prewrite.yml`
  option under "Checks run" above) rather than growing
  `rules/semgrep-mobile.yml` itself minimizes the surface a merge
  conflict can touch; the coordinator still diffs
  `rules/semgrep-mobile.yml` explicitly at merge time regardless, per
  the standing "verify committed state" discipline for any shared-file
  merge.
