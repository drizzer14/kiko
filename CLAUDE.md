# Kiko quality harness

This project uses a Biome-adapted, LLM-guarding quality harness. Every
check runs through a wrapper in `scripts/checks/` that prints a
structured failure block on failure and stays silent on success.

**Standing rule: fix the underlying issue. Never weaken a check to get
green.** No `|| true`. No global auto-suppress. An ignore-list entry
needs a concrete, specific justification (see "Documented exceptions"
below).

## Checks

| Command | Tool | Threshold | Tier |
|---|---|---|---|
| `npm run check:lint` | Biome | any lint/format violation fails | fast (PostToolUse) |
| `npm run check:dup` | jscpd | >5% duplicated lines/tokens fails | medium (Stop/SubagentStop) |
| `npm run check:knip` | Knip | any unused file/export/dependency fails | medium |
| `npm run check:deps` | depcheck + `npm ci --dry-run` | any unused/missing dep, or broken lockfile, fails; a changed dependency block is surfaced for confirmation | medium |
| `npm run check:security` | Semgrep (`p/typescript`, `p/react`, `p/secrets`, `rules/semgrep-mobile.yml`) | any Class A (ERROR) finding fails; Class B (WARNING) findings are surfaced, override-eligible, non-blocking | fast |
| `npm run check:rules` | `scripts/checks/semgrep-rules.sh` — Semgrep (`rules/semgrep-mobile.yml`) against `rules/fixtures/` | for every fixture present: a rule that reports nothing on its positive fixture, misses a line pinned there by an `EXPECT-FINDING` comment, or matches its negative one fails; so does a fixture id with only one half of its pair present, and a scan that proved nothing (no fixtures, a fixture semgrep never opened, a semgrep error, or a semgrep/verifier crash). A rule with no fixture at all is not detected here — the fixture set is the input | medium |
| `npm run check:plist` | plist.sh (`plutil`) | any Info.plist security invariant violation fails | medium |
| `npm run check:secrets` | gitleaks | any detected secret fails | fast |
| `npm run check:overrides` | override-guard.sh | any bare `biome-ignore` (no `OVERRIDE(...)`) fails | medium |
| `npm run check:typecheck` | tsc (`--noEmit`) | any type error fails | medium |
| `npm run check:import-order` (on next; arrives on main with release 1.1) | `scripts/checks/import-order.sh` | an import block not sorted per kiko-code-style's "Import ordering" fails | fast (per-file) + project-wide |
| `npm run check:full-word-identifiers` (on next; arrives on main with release 1.1) | `scripts/checks/full-word-identifiers.sh` | a denylisted abbreviation in an identifier fails (see the analyzer's own denylist) | fast (per-file) + project-wide |
| `npm run check:screen-imports` (on next; arrives on main with release 1.1) | `scripts/checks/screen-imports.sh` | a cross-screen import fails | project-wide + pre-write guard |
| `npm run check:feature-imports` (on next; arrives on main with release 1.1) | `scripts/checks/feature-imports.sh` | an import that crosses a feature without its barrel, or a `--tree` layout finding, fails | project-wide + pre-write guard |
| `npm run check:blank-line-separation` (on next; arrives on main with release 1.1) | `scripts/checks/blank-line-separation.sh` | a blank-line-separation violation fails | project-wide + pre-write guard |
| `npm run check:guard-replay` (on next; arrives on main with release 1.1) | `scripts/checks/guard-replay.sh` — the pre-write guard replayed over each `.ts`/`.tsx` file the session changed | any finding the change ADDED fails (a Bash/python write bypassed the guard); fails closed | medium (Stop/SubagentStop) + project-wide |
| `npm run check:mutation` | Stryker (Jest runner) | mutation score below 60 (break threshold; ratchet up over time) fails; more than 30 source files to mutate (`MUTATION_FILE_CAP` in `mutation.sh`) fails before Stryker starts — no env var bypasses the cap (cap on next; arrives on main with release 1.1) | deep only |
| `bash scripts/checks/osv.sh` | osv-scanner | any known CVE in `package-lock.json` fails | deep only |

Composite scripts:

- `npm run check:all` — the fast + medium tier checks, in order:
  lint, dup, knip, deps, security, rules, plist, secrets, overrides,
  typecheck. On next (arrives on main with release 1.1) the order is:
  lint, dup, knip, deps, security, rules, plist, secrets, overrides,
  import-order, full-word-identifiers, screen-imports, feature-imports,
  blank-line-separation, guard-replay, typecheck.
- `npm run check:deep` — the heavy tier: mutation testing, then
  osv-scanner. It is not wired to any hook because it is slow; it is a
  manual checkpoint. **Mutation testing runs per SMALL change set only,
  never on a whole project or a whole release** (a whole-release run
  went 10 h 16 min with no result). The mutation step mutates ONLY the
  source files changed against the merge-base with
  `${KIKO_MUTATION_BASE:-main}` (tests/fixtures excluded): set
  `KIKO_MUTATION_BASE` to that change set's own base commit so only its
  files are mutated. More than 30 files to mutate (`MUTATION_FILE_CAP`
  in `scripts/checks/mutation.sh`) exits 2 before Stryker starts;
  `KIKO_MUTATION_FULL=1` (whole project) and a `KIKO_MUTATION_BASE`
  that does not resolve are refused directly (exit 2), and no env var
  bypasses the cap (cap and refusals on next; arrive on main with
  release 1.1). There is no release-scope deep gate. **Who and when:**
  the coordinator runs `KIKO_MUTATION_BASE=<change set base sha> make
  deep`, detached, for each reviewed change set (<= 30 source files)
  before its merge into next. Orchestrators never run it; a BATCH READY
  names the change-set base sha and the file count. The mutation step tees its output to a stable,
  tailable progress log and prints an ETA from run history — a
  per-mutant rate (seconds/mutant) derived from past runs, times this
  run's actual mutant count, printed live the moment Stryker reports
  that count — for a human to watch directly. The full never-poll rule
  (agents await only the exit code) lives in the `ops` skill — see it,
  and the `kiko-linter` skill, before running this yourself.

Automatic wiring (`harness/kiko/hooks/hooks.json`, via the
`kiko` plugin — see "Harness agents" below): the fast tier
(`scripts/checks/fast.sh`: lint, security, secrets on the touched
file) runs on `PostToolUse` for `Edit|Write|MultiEdit`. The medium
tier (`scripts/checks/medium.sh`: dup, override-guard scoped to the
session's changed source files; knip, deps, the Semgrep rule
fixtures, the Info.plist security assertions, and typecheck
project-wide) runs on `Stop` and `SubagentStop`, and stays silent
only when the session changed neither a source file nor a harness
input — a rule `.yml`, a file under `rules/fixtures/`, a wrapper in
`scripts/checks/`, or `ios/Kiko/Info.plist`. A session that edited
only a rule, a fixture, or the plist is the one most likely to have
broken a rule (or unpinned a credential-bearing host), so it must not
be the one that runs nothing. `tsc --noEmit` is project-wide by
nature — a type error surfaces in the file that CONSUMES a changed
type, not only in the file that was edited — so it never takes a
changed-file argument. Both wrappers exit `2` on failure and print
the structured block to stderr, which is how Claude Code surfaces the
failure back to the agent. A fresh checkout must run `npm install`
before these hooks work — every wrapper's tool lives in
`node_modules`.

A `PreToolUse` hook (`scripts/checks/kill-guard.sh`) runs on every
`Bash` tool call and denies `pkill`, `killall`, and any pattern- or
process-group `kill` (including via `xargs`, `$(...)`, or a
`sh -c`/`bash -c` string) before the command runs. Stop only a
process ID you started yourself (`kill <pid>`), or let the tool
timeout end a hung command. The hook is not part of the
fast/medium/deep tiers and has no dedup fingerprint.

**Content dedup (a check skips when its inputs did not change).** Every
check fingerprints its own real inputs and skips its next run when that
fingerprint is unchanged, so a subagent-driven session or a non-source
change does not re-trigger a check that already passed; `osv-scanner` is
the one exception — it is never deduped, because its result depends on
the external vulnerability database, which changes even when the
lockfile does not. Full mechanism (fingerprint scope per tier, the
`medium.sh` and `mutation.sh` locks, skip-only-on-PASS) is in
`docs/harness/checks-internals.md`.

## Override protocol

A Biome lint rule may only be suppressed with a justified override —
never a bare `biome-ignore`:

```ts
// biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(third-party boundary) the vendor SDK returns an untyped payload here
const raw: any = sdk.rawResponse();
```

`npm run check:overrides` fails on any `biome-ignore` comment that
does not contain `OVERRIDE(...)`. Do not delete the guard or move a
suppressed pattern elsewhere to dodge it — either justify the
override with a specific reason, or fix the code so the ignore is not
needed at all.

The same principle applies to every other ignore-list style
exception in this repo (see "Documented exceptions" below): a
suppression is only acceptable when it names a concrete reason a
human or agent can verify.

## Documented exceptions

Every ignore-list / suppression exception in this repo is a real, verified
usage with a concrete justification — not dead weight. The full inventory
(`knip.json`, `tsconfig.json` `types`, `.depcheckrc.json`, `.gitleaks.toml`,
`.jscpd.json`, `rules/fixtures/**`, the Stryker mutate-set and sandbox
exclusions, `.npmrc` `min-release-age-exclude`, and the tracked public-only
`.env.test`) lives in
**`docs/harness/documented-exceptions.md`**. Read
and UPDATE that file when you add, change, or rely on an exception. The
standing rule holds: a suppression is acceptable only when it names a
concrete reason a human or agent can verify (see "Override protocol" above).

## Guideline 5.6 — no hidden features

Standing architecture rule, not a one-off cleanup: every feature ships
VISIBLE to an App Store reviewer in a release build — no flag-gated or
conditional-visibility feature, and no demo/seed/screenshot module in
or imported from app `src/`. The full rule, the mechanized Semgrep
check (`kiko-no-hidden-feature-flag-or-demo-import`), and its known
limits live in **`.claude/skills/kiko-architecture/SKILL.md`**
("Guideline 5.6 — no hidden features"). Read that section before
adding any build/env flag that controls what a user sees, or any
dev-only demo/seed module.

## Dependency hygiene

Exact-pinning, the `.npmrc` 7-day minimum age, the npm version
requirement, the `.env` public-only rule, and the tracked/accepted
dependency CVEs are documented IN FULL in
**`docs/harness/dependency-hygiene.md`**. Standing rule: the accepted
CVEs there (`image-size`, `decode-uri-component`) are tracked, real
debt, not a suppressed finding — never silence them; re-check
periodically and pin the moment a fix ships.

## Future stubs (disabled — do not enable without discussion)

```bash
# FUTURE (disabled): a pre-commit hook could run `npm run check:all`.
# FUTURE (disabled): a CI job could run `npm run check:all` and `npm run check:deep` as required checks.
```

## Harness agents

The Kiko agent harness is a local Claude Code plugin at
`harness/kiko/` (`kiko` in the local
`harness/.claude-plugin/marketplace.json`). It ships thirteen role agents,
five project skills (four thin-wrap superpowers, plus a `release`
skill that documents the release-publishing workflow), one vendored
review command, and the tier hooks documented above.

A fresh checkout must run `npm install` before the harness hooks
work — the check tools they call (Biome, jscpd, Knip, depcheck,
Stryker) live in `node_modules`; `semgrep` and `gitleaks` are resolved
from `PATH` instead.

### Delegation rule

The coordinator delegates all work to these agents and never edits
app files inline. Complex or parallel work is split into separate
Orca worktrees. If no agent fits a task, the coordinator reports the
gap — it does not do the task itself.

### Skill drift rule

This rule applies to every session, at all times. After every
completed code iteration (a feature, phase, or fix that is developed
and tested), the session runs `kiko:retrospect` to verify BOTH skill
locations (`.claude/skills/` and `harness/kiko/skills/`, plus
`harness/kiko/agents/`) against the new code. Then `kiko:scribe`
fixes the drift and commits, before the next iteration or the merge.
The completion report names the drift-fix sha (or states "no drift
found"). The coordinator checks that sha before it merges.

### The thirteen agents

| Agent | Role | model | effort | Spawn command |
|---|---|---|---|---|
| developer | Writes all TypeScript/React Native code | sonnet | high | `claude --agent developer --effort high` |
| planner | Writes implementation plans from a spec or feature request | opus | medium | `claude --agent planner --effort medium` |
| debugger | Isolates faults, writes no code | sonnet | high | `claude --agent debugger --effort high` |
| reviewer | Reviews diffs: correctness, project conventions, App Store compliance (`kiko-compliance` skill), then ponytail over-engineering findings | opus | high | `claude --agent reviewer --effort high` |
| qa | Writes Jest/RNTL unit tests and Maestro E2E flows | sonnet | medium | `claude --agent qa --effort medium` |
| designer | Owns theme tokens and shared styled components | sonnet | medium | `claude --agent designer --effort medium` |
| explorer | Read-only codebase search | sonnet | low | `claude --agent explorer --effort low` |
| retrospect | Gathers durable lessons after a run | sonnet | medium | `claude --agent retrospect --effort medium` |
| scribe | Persists durable knowledge (memory, skills, agents, plugin) | sonnet | low | `claude --agent scribe --effort low` |
| ops | Runs builds, installs, pods, and the harness checks | haiku | low | `claude --agent ops --effort low` |
| pm | Reports the live task board, branches, and worktrees from Orca and git; verifies narrative docs and flags drift | sonnet | low | `claude --agent pm --effort low` |
| auditor | Read-only whole-codebase audit (security, performance, bundle, dependencies); reports ranked findings, writes no code | sonnet | medium | `claude --agent auditor --effort medium` |
| researcher | Read-only web research and live API probes; returns findings with source URL + check date per claim | sonnet | medium | `claude --agent researcher --effort medium` |

Agent frontmatter sets both `model` and `effort`; the Agent tool
applies both on dispatch. Passing `--effort` at spawn time is only
needed for a standalone `claude --agent` session, and must match the
frontmatter, per the table above.

### Ponytail isolation

The reviewer's `/ponytail-review` command vendors only the review
prompt from ponytail 4.9.0 (`harness/kiko/commands/ponytail-review.md`).
No ponytail hooks are registered anywhere (no `SessionStart`,
`SubagentStart`, or `UserPromptSubmit` from ponytail). The ponytail
persona applies only inside that command's own output; the STE style
and every other agent's output stay unaffected.

### Superpowers

The plugin does not copy superpowers. Its skills
(`harness-workflow`, `design-system`, `retrospect`, `ops`) and its
agents point at superpowers skills directly (`superpowers:test-driven-development`,
`superpowers:systematic-debugging`, `superpowers:using-git-worktrees`,
`superpowers:requesting-code-review`, `superpowers:writing-skills`,
`superpowers:dispatching-parallel-agents`, `superpowers:brainstorming`,
`superpowers:writing-plans`, `superpowers:executing-plans`,
`superpowers:subagent-driven-development`,
`superpowers:verification-before-completion`,
`superpowers:finishing-a-development-branch`), reusing the installed
`superpowers` plugin rather than duplicating any of its content.
