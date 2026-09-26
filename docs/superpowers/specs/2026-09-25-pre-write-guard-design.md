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

Each of these is a NEW rule the implementation task adds to
`rules/semgrep-prewrite.yml` (see "Checks run" below for that file's
existence and role), with a `<rule-id>.bad.<ext>` / `<rule-id>.good.<ext>`
fixture pair under `rules/fixtures/`, exactly as
`scripts/checks/semgrep-rules.sh` already requires for every
`rules/semgrep-mobile.yml` rule — once `semgrep-rules.sh` is updated
(per "Checks run") to also load `rules/semgrep-prewrite.yml`, the same
fixture-proof contract covers these new rules with no separate
fixture directory needed.

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
matcher `Edit|Write|MultiEdit`. The command itself guards the
script's presence and passes the guard's own exit code through
unchanged, rather than relying on Claude Code's handling of a command
that fails to run:

```json
{
  "matcher": "Edit|Write|MultiEdit",
  "hooks": [
    {
      "type": "command",
      "command": "f=\"${CLAUDE_PROJECT_DIR}/scripts/checks/pre-write-guard.sh\"; [ -f \"$f\" ] || exit 0; exec bash \"$f\"",
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

This `hooks.json` entry lands on `main` at once, BEFORE
`scripts/checks/pre-write-guard.sh` exists there — `hooks.json` is
shared config every worktree reads, and a worktree without the script
yet (any checkout older than the commit that adds it) must never see
a hook error on every single edit just because the wiring landed
first. The `[ -f "$f" ] || exit 0` guard inside the command itself is
what makes that safe: when the script is absent, the command exits 0
before ever trying to run it — a real no-op, not a "failed to run"
condition Claude Code happens to treat as non-blocking. When the
script IS present, `exec bash "$f"` replaces the guard command with
the script's own process, so the script's exit code (0 pass, 2 deny)
is exactly what Claude Code sees — nothing about the presence check
weakens or alters the fail-closed behavior described below once the
script exists and runs. This is the ONLY no-op path in this design;
there is no second "rule set present but script missing" case to
handle, because the script itself will not exist without its rule set
in the same commit (see "Rollout").

**Approved deviation (Task 21b, 2026-09-26):** every `hooks.json`
command above now reads `bash
"${CLAUDE_PLUGIN_ROOT}/hooks/dispatch.sh" <script-name>.sh` instead of
the literal `${CLAUDE_PROJECT_DIR}/scripts/checks/<script-name>.sh`
shown in the JSON block. `CLAUDE_PROJECT_DIR` is the COORDINATOR's own
checkout for a subagent's hook call, not necessarily the checkout that
owns the file being edited — a subagent started in the main repo but
editing a file in a different worktree ran the main repo's rules
against a file it did not own (a real Class A finding was missed on
the fast tier this way, and this guard would have treated every such
worktree edit as "outside the project" and allowed it unchecked).
`harness/kiko/hooks/dispatch.sh` resolves the edited file's own
worktree (`git rev-parse --show-toplevel` from `tool_input.file_path`,
walking up to the nearest existing ancestor for a brand-new file's own
not-yet-created directory; the payload's own `cwd` for a hook with no
`tool_input`; `CLAUDE_PROJECT_DIR` as the last-resort fallback), then
execs that worktree's own `scripts/checks/<script-name>.sh` with
`CLAUDE_PROJECT_DIR` set to that SAME resolved root, replaying the
original stdin bytes unchanged and passing stdout/stderr/exit code
through untouched. `CLAUDE_PLUGIN_ROOT` (not `CLAUDE_PROJECT_DIR`)
locates the dispatcher itself — but it is NOT the physical
`harness/kiko/` directory in this checkout. Claude Code resolves it to
the plugin's CACHE copy (`~/.claude/plugins/cache/kiko-marketplace/
kiko/<version>/`), a materialized copy the plugin system makes from
the marketplace source, refreshed only on a plugin reinstall or a
version bump in `harness/kiko/.claude-plugin/plugin.json` — not on
every commit to this checkout. Only the resolved `CLAUDE_PROJECT_DIR`
varies per invocation regardless of checkout; `CLAUDE_PLUGIN_ROOT`
itself is stable ACROSS checkouts but stale until that cache is
refreshed (see "Rollout" below for what this means for THIS change).
The "script absent ->
exit 0" no-op described above generalizes to all four hooks (fail-open
by DELEGATION: a malformed payload, or `node` itself being
unavailable, degrades to "extract nothing, fall back to
`CLAUDE_PROJECT_DIR`, still invoke the target script," letting each
script's own already-tested contract — this guard denies on malformed
JSON or a node crash; `kill-guard.sh` always allows — decide the
outcome, rather than a second copy of that logic in the dispatcher). A
`git rev-parse` failure is NOT delegated uniformly (fix round 2, g5b):
only a "not a git repository" failure (a plain non-repo directory)
falls back this way; any OTHER git failure (the `git` binary itself
broken, a corrupt `.git`, a permission error) is treated as a genuine
dispatcher crash — denying for `pre-write-guard.sh`, and keeping every
other hook's own kept semantics — since silently falling back on THAT
case could let an unchecked write through. The resolved root is also
bound to `CLAUDE_PROJECT_DIR`'s own repository (same repo, or a linked
worktree of it, by `git rev-parse --git-common-dir`); an unrelated
repository falls back to `CLAUDE_PROJECT_DIR` instead of running its
own scripts against `CLAUDE_PROJECT_DIR`'s rules. See
`harness/kiko/hooks/dispatch.sh`'s own header comment and
`__tests__/hook-dispatch.test.ts` for the full behavior and its tests.

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

ONE Semgrep invocation, against the AFTER tree, using a new file
`rules/semgrep-prewrite.yml` that holds exactly the pre-write-eligible
rules — 1–3 and 7 (the four Tier-1 rules) plus 8–10 and 12–17 (the
Tier-2/3 rules that are a per-line/per-pattern match Semgrep can
express). Decided mechanism, not left open: the four Tier-1 rule
BODIES (`kiko-no-history-id-comment`, `kiko-no-nullable-map-ternary`,
`kiko-no-switch`, `kiko-no-use-animated-keyboard`) MOVE out of
`rules/semgrep-mobile.yml` into `rules/semgrep-prewrite.yml` — they
are deleted from `rules/semgrep-mobile.yml`, not copied — so there is
exactly one source of truth for each rule body and no way for the two
files to drift against each other. Every full-tree Semgrep wrapper
that today loads `rules/semgrep-mobile.yml` alone —
`scripts/checks/security.sh` (`check:security`, three separate
`semgrep ... --config` invocations in that file) and
`scripts/checks/semgrep-rules.sh` (`check:rules`, one invocation) —
is updated to load BOTH files, adding a second
`--config "$ROOT/rules/semgrep-prewrite.yml"` alongside the existing
`--config "$ROOT/rules/semgrep-mobile.yml"` (Semgrep's `--config` flag
is already repeatable — `security.sh` already passes it four times in
a row for `p/typescript`, `p/react`, `p/secrets`, and
`rules/semgrep-mobile.yml`). Full-tree coverage of the four moved
rules is therefore unchanged: `check:security` and `check:rules` still
scan the whole tree for them, now via `rules/semgrep-prewrite.yml`
instead of `rules/semgrep-mobile.yml`. Any other wrapper that loads
`rules/semgrep-mobile.yml` at implementation time must be found (grep
the tree for `semgrep-mobile.yml`) and updated the same way; this spec
does not assume `security.sh` and `semgrep-rules.sh` are the only two.
The pre-write guard itself loads ONLY `rules/semgrep-prewrite.yml` —
never `rules/semgrep-mobile.yml` — since the rules that stay in
`rules/semgrep-mobile.yml` (everything not in the 17, for example
`kiko-disabled-tls`, `kiko-secret-in-db-or-log`) are intentionally out
of this guard's scope.

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

The BEFORE pass re-runs only the Node rules that reported a finding in
AFTER: a BEFORE finding can only match an AFTER finding of the same
rule, so the other rows cannot change the result.

### Merge-conflict files

A merge-conflict file does not parse, so BEFORE cannot be the baseline
as-is. The guard splits a conflicted BEFORE into its ours and theirs
sides (`conflictSides` in `pre-write-guard.js`):

- BEFORE with conflict markers never denies on its own parse error. A
  side that does not parse is dropped from the baseline; if both are
  dropped, the write is allowed and `check:all` checks the finished
  file.
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

See `afterTreesFor` and `throwIfEditBrokeASide` in `pre-write-guard.js`.

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
  As built: the guard honors either spelling for any rule id. A
  `kiko-override:` on a Node rule passes the guard, but `check:all`
  still fails on that line, because the project-wide Node checkers have
  no inline override. Use `nosemgrep:` for Semgrep rules; a Node-rule
  exception needs a checker-level exemption.

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
one already described in "Trigger and wiring": `scripts/checks/pre-write-guard.sh`
itself is entirely ABSENT from this checkout (an older worktree that
predates this feature) — that is not a runtime failure of an existing
guard, it is the guard not existing yet in this checkout, and is
detected by the hooks.json command's own `[ -f "$f" ]` presence check
before the script is ever invoked. Once the script exists and runs at
all, every failure inside it — including `rules/semgrep-prewrite.yml`
being unexpectedly missing or unreadable — is a real failure and
denies, per the paragraph above; there is no separate "rule set
missing" no-op, because the script and its rule set land in one
commit (see "Rollout").

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

- A fixture pair per NEW Semgrep-checked rule (8–10, 12–17) under
  `rules/fixtures/`, proven by `scripts/checks/semgrep-rules.sh` once
  that script loads `rules/semgrep-prewrite.yml` alongside
  `rules/semgrep-mobile.yml` (see "Checks run") — the same
  `check:rules`-equivalent proof (fires on `.bad.`, silent on `.good.`)
  it already requires for every `rules/semgrep-mobile.yml` rule,
  applied unchanged to the moved and new pre-write rules. Rule 11
  (the Node-checked blank-line rule) is proven the same way
  `import-order.js`/`full-word-identifiers.js` already are: by that
  script's own Jest test, not a Semgrep fixture.
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

**Task 21b's own rollout need:** `harness/kiko/hooks/dispatch.sh` and
its `hooks.json` wiring only take effect once `CLAUDE_PLUGIN_ROOT`'s
plugin CACHE copy is refreshed (see "Trigger and wiring" above) — a
plain merge into a running track's checkout is not enough, since the
cache is a separate materialized copy, not a symlink into this repo.
`harness/kiko/.claude-plugin/plugin.json`'s `version` has never been
bumped in this repo's history (checked via `git log` on that file), so
bumping it is not this repo's convention; the refresh instead comes
from a plugin reinstall (or an equivalent forced cache rebuild) after
the merge, before `/reload-plugins` can pick up the new dispatcher in
any running session.

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
- **Merge overlap with the feat track's own rules file.** This design
  requires DELETING the four Tier-1 rule bodies from
  `rules/semgrep-mobile.yml` (moving them to
  `rules/semgrep-prewrite.yml`, per "Checks run" above), which touches
  the exact file `feat/assets-debts` (and whatever else lands on
  `rules/semgrep-mobile.yml` in between) may also be editing
  concurrently — a real conflict surface, not just a hypothetical one,
  since this is a structural edit to a shared file rather than a pure
  addition. Mitigation: the move (the deletion from
  `rules/semgrep-mobile.yml`, the addition to the new file, and the
  `security.sh`/`semgrep-rules.sh` wrapper updates that load both
  files) lands in ONE commit, so there is never a landed state where
  the rule body is missing from both files or present in both; the
  coordinator diffs `rules/semgrep-mobile.yml` explicitly at merge
  time regardless, per the standing "verify committed state"
  discipline for any shared-file merge, and resolves a real conflict
  by keeping the move intact rather than reverting it.
