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
| `npm run check:mutation` | Stryker (Jest runner) | mutation score below 60 (break threshold; ratchet up over time) fails | deep only |
| `bash scripts/checks/osv.sh` | osv-scanner | any known CVE in `package-lock.json` fails | deep only |
| `npm run check:screenshots` | Maestro + pixelmatch, RICH scenario | deep/manual only — see `docs/harness/screenshots-check.md` |
| `npm run check:screenshots:empty` | Maestro + pixelmatch, EMPTY scenario | deep/manual only — see `docs/harness/screenshots-check.md` |
| `npm run check:screenshots:locked` | Maestro + pixelmatch, LOCKED scenario | deep/manual only — see `docs/harness/screenshots-check.md` |

Composite scripts:

- `npm run check:all` — the fast + medium tier checks, in order:
  lint, dup, knip, deps, security, rules, plist, secrets, overrides,
  typecheck.
- `npm run check:deep` — the heavy tier: mutation testing, then
  osv-scanner. **Run this before declaring a feature done.** It is not
  wired to any hook because it is slow; it is a manual checkpoint. By
  default the mutation step mutates ONLY the source files changed
  against the merge-base with `${KIKO_MUTATION_BASE:-main}`
  (tests/fixtures excluded); set `KIKO_MUTATION_FULL=1` to force a
  whole-project run. When you deep-gate an integration branch stacked on `next`, pass `KIKO_MUTATION_BASE=next make deep`: the default `main` base diffs against the last release and re-mutates the ENTIRE next-vs-main delta (2026-09-17: 199 files / ~8850 mutants) instead of the integration's own changes (86 files vs `next`). Reserve the `main` base for a genuine full release-scope gate. The mutation step tees its output to a stable,
  tailable progress log and prints an ETA from run history — a
  per-mutant rate (seconds/mutant) derived from past runs, times this
  run's actual mutant count, printed live the moment Stryker reports
  that count — for a human to watch directly; agents still must not poll
  it — the exit code remains the only signal. See the `kiko-linter`
  skill.

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

**Content dedup (a check skips when its inputs did not change).** Every
check fingerprints its own real inputs and skips its next run when that
fingerprint is unchanged, so a subagent-driven session or a non-source
change does not re-trigger a check that already passed; `osv-scanner` is
the one exception — it is never deduped, because its result depends on
the external vulnerability database, which changes even when the
lockfile does not. Full mechanism (fingerprint scope per tier, the
`medium.sh` and `mutation.sh` locks, skip-only-on-PASS) is in
`docs/harness/checks-internals.md`.

### `check:screenshots` (App Store screenshot visual regression)

The screenshot visual-regression checks (`check:screenshots` and its
`:empty` / `:locked` siblings, and the separate marketing capture flow)
are documented IN FULL in **`docs/harness/screenshots-check.md`**. Read
that file before you touch any `.maestro/*regression*.yaml` flow,
`scripts/checks/screenshots*.sh`, `scripts/checks/screenshot-diff/*`, or
a `screenshots/regression*/` baseline. These checks are deep/manual
only — not in `check:all`/`check:deep`, not hook-wired.

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
exclusions, `.npmrc` `min-release-age-exclude`, the tracked public-only
`.env.test`, and the `check:screenshots` diff exclusions) lives in
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
`harness/.claude-plugin/marketplace.json`). It ships twelve role agents,
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

### The twelve agents

| Agent | Role | model | effort | Spawn command |
|---|---|---|---|---|
| developer | Writes all TypeScript/React Native code | sonnet | high | `claude --agent developer --effort high` |
| planner | Writes implementation plans from a spec or feature request | sonnet | medium | `claude --agent planner --effort medium` |
| debugger | Isolates faults, writes no code | sonnet | high | `claude --agent debugger --effort high` |
| reviewer | Reviews diffs: correctness, project conventions, then ponytail over-engineering findings | sonnet | high | `claude --agent reviewer --effort high` |
| qa | Writes Jest/RNTL unit tests and Maestro E2E flows | sonnet | high | `claude --agent qa --effort high` |
| designer | Owns theme tokens and shared styled components | sonnet | high | `claude --agent designer --effort high` |
| explorer | Read-only codebase search | sonnet | medium | `claude --agent explorer --effort medium` |
| retrospect | Gathers durable lessons after a run | sonnet | medium | `claude --agent retrospect --effort medium` |
| scribe | Persists durable knowledge (memory, skills, agents, plugin) | sonnet | low | `claude --agent scribe --effort low` |
| ops | Runs builds, installs, pods, and the harness checks | haiku | low | `claude --agent ops --effort low` |
| pm | Reports the live task board, branches, and worktrees from Orca and git; verifies narrative docs and flags drift | sonnet | medium | `claude --agent pm --effort medium` |
| auditor | Read-only whole-codebase audit (security, performance, bundle, dependencies); reports ranked findings, writes no code | sonnet | medium | `claude --agent auditor --effort medium` |

Agent frontmatter sets only `model` (there is no per-agent effort
field); the coordinator applies the recorded effort with `--effort`
at spawn time, per the table above.

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
