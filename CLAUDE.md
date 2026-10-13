# Kiko quality harness

This project uses a Biome-adapted, LLM-guarding quality harness. Every
check runs through a wrapper in `scripts/checks/` that prints a
structured failure block on failure and stays silent on success.
`scripts/checks/security.sh` and `scripts/checks/dup.sh` are stated
exceptions: they write notices and WARNING lines to stderr with exit 0.
The other exceptions (the deep tier's streaming, the hook guards' JSON,
`kill-guard.sh` and `pre-write-guard.sh`) are listed in kiko-linter's
"The wrapper contract".

**Standing rule: fix the underlying issue. Never weaken a check to get
green.** No `|| true`. No global auto-suppress. An ignore-list entry
needs a concrete, specific justification (see "Documented exceptions"
below).

## Checks

Full thresholds, tiers, and mechanism: **`docs/harness/checks.md`**
("Checks" table, "Composite scripts", "Automatic wiring"). Each row
below is the short form; read the row's full text there before changing
or relying on its edge cases.

| Command | Tool | Threshold (short) | Tier |
|---|---|---|---|
| `npm run check:lint` | Biome | any lint/format violation fails | fast (PostToolUse) |
| `npm run check:dup` | jscpd (`scripts/checks/dup.sh`) | >5% duplicated lines/tokens fails; over-limit large files only WARN (tracked debt) | medium (Stop/SubagentStop) |
| `npm run check:knip` | Knip | any unused file/export/dependency fails | medium |
| `npm run check:deps` | depcheck, `npm ci --dry-run`, `deps-ranges.js`, `npm ls --all` | unused/missing dep, broken lockfile, non-exact spec, ELSPROBLEMS, or a `node_modules/node_modules` link/folder fails (fix: `rm node_modules/node_modules` for a link, `npm ci` for a folder, never `rm -r node_modules`) | medium |
| `npm run check:security` | Semgrep | any Class A (ERROR) finding or Semgrep failure fails; Class B (WARNING) is surfaced, non-blocking | fast |
| `npm run check:rules` | `scripts/checks/semgrep-rules.sh` | a rule that misses its positive fixture or matches its negative one fails | medium |
| (PreToolUse hook) | `scripts/checks/pre-write-guard.sh` + `.js` | any NEW finding (or a "could not check") denies the write before it lands; fail-closed | PreToolUse (pre-write) |
| `npm run check:plist` | plist.sh (`plutil`) | any Info.plist / privacy-manifest security invariant violation fails | medium |
| `npm run check:secrets` | gitleaks | any detected secret fails | fast |
| `npm run check:overrides` | override-guard.sh | any bare `biome-ignore`, `nosemgrep`, `kiko-override:`, or `Stryker disable` (no `OVERRIDE(...)`) fails | medium |
| `npm run check:import-order` | `scripts/checks/import-order.sh` | an import block not sorted per kiko-code-style "Import ordering" fails; run project-wide before committing | fast (per-file) + project-wide |
| `npm run check:full-word-identifiers` | `scripts/checks/full-word-identifiers.sh` | a denylisted abbreviation as a whole identifier part fails, unless on the analyzer's `EXEMPTIONS` | fast (per-file) + project-wide |
| `npm run check:screen-imports` | `scripts/checks/screen-imports.sh` | a cross-screen import fails | project-wide + pre-write guard |
| `npm run check:feature-imports` | `scripts/checks/feature-imports.sh` | an import crossing a feature without its barrel, or a `--tree` layout finding, fails | project-wide + pre-write guard |
| `npm run check:blank-line-separation` | `scripts/checks/blank-line-separation.sh` | a blank-line-separation violation fails | project-wide + pre-write guard |
| `npm run check:comment-line-width` | `scripts/checks/comment-line-width.sh` | a comment line over 100 columns fails; no override | project-wide + pre-write guard |
| `npm run check:component-i18n-namespace` | `scripts/checks/component-i18n-namespace.sh` | a component reading another component's i18n namespace fails | project-wide + pre-write guard |
| `npm run check:guard-replay` | `scripts/checks/guard-replay.sh` | any finding a change ADDED (a write that bypassed the pre-write guard) fails; fail-closed | medium + project-wide |
| `npm run check:shipped-migrations` | `scripts/checks/shipped-migrations.sh` | a shipped migration modified, deleted, or renamed fails; no override | medium + project-wide |
| `npm run check:closure -- <table.md>` | `scripts/checks/closure-table.sh` | a malformed closure-table row fails; manual, not in `check:all` | manual |
| `npm run check:typecheck` | tsc (`--noEmit`) | any type error fails | medium |
| `npm run check:mutation` | Stryker + `scripts/checks/mutation-score.js` | change-set score below 75 total or 60 per file fails; more than 30 source files fails before Stryker starts | deep only |
| `bash scripts/checks/osv.sh` | osv-scanner | any known CVE in `package-lock.json` fails | deep only |

Composite scripts:

- `npm run check:all` — the fast + medium tier checks, in order:
  lint, dup, knip, deps, security, rules, plist, secrets, overrides,
  import-order, full-word-identifiers, screen-imports, feature-imports,
  blank-line-separation, comment-line-width, component-i18n-namespace, shipped-migrations, guard-replay, typecheck.
  `__tests__/check-all-lists.test.ts` pins this list to `package.json` and the hooks.
- `npm run check:deep` — the heavy tier: mutation testing, then
  osv-scanner. Manual, wired to no hook. **Mutation runs per SMALL change
  set only, never on a whole project or release** (a whole-release run went
  10 h 16 min with no result): set `KIKO_MUTATION_BASE` to the change set's
  own base commit; more than 30 files to mutate (`MUTATION_FILE_CAP` in
  `scripts/checks/mutation.sh`) exits 2; `KIKO_MUTATION_FULL=1` and an
  unresolved base are refused; no env var bypasses the cap. The coordinator
  runs `KIKO_MUTATION_BASE=<change set base sha> make deep`, detached, per
  reviewed change set before its merge into next; orchestrators never run
  it. `KIKO_MUTATION_BASE=<base sha> make mutable` previews the files and
  line count. Agents await only the exit code (see the `ops` and
  `kiko-linter` skills). Full rules: `docs/harness/checks.md` "Composite
  scripts".

Content dedup: a check skips a run whose inputs did not change since its
last PASS (see `docs/harness/checks-internals.md`).

## Automatic wiring

Detail for every hook: `docs/harness/checks.md` "Automatic wiring".
Hooks live in `harness/kiko/hooks/hooks.json` (via the `kiko` plugin) and
run `harness/kiko/hooks/dispatch.sh <script-name>`, which execs the edited
worktree's own `scripts/checks/<script-name>`. Hook changes reach running
sessions only after a plugin reinstall plus `/reload-plugins`.

- `PostToolUse` (`Edit|Write|MultiEdit`): `scripts/checks/fast.sh` (lint,
  security, secrets, import-order, full-word-identifiers on the touched file).
- `Stop`/`SubagentStop`: `scripts/checks/medium.sh` (dup, overrides, knip,
  deps, rules, plist, typecheck, shipped-migrations, guard replay). Wrappers
  exit `2` and print the failure block to stderr. A fresh checkout needs
  `npm install` first.
- `PreToolUse` `Edit|Write|MultiEdit`: `pre-write-guard.sh` denies a write
  that adds a finding from `rules/semgrep-prewrite.yml` or `NODE_RULES`;
  fail-closed.
- `PreToolUse` `Bash`: `scripts/checks/kill-guard.sh` denies (rationale and
  limits in kiko-linter, section names in quotes):
  - `pkill`, `killall`, any pattern/process-group `kill` (incl. via `xargs`,
    `$(...)`, `sh -c`); stop only a pid you started with `kill <pid>`.
  - any `git stash`, in any directory (commit a WIP or copy files instead).
  - a heredoc with an unquoted delimiter (`<<EOF`; `<<'EOF'` passes).
  - `git apply|merge|rebase|pull|cherry-pick|revert|am` on the MAIN checkout
    `/Users/drizzer14/Developer/Projects/pff-ios` ("MAIN-CHECKOUT deny");
    allowed: `merge --ff-only`, `pull --ff-only`, `--abort|--quit|--skip|--continue`.
    Merge in a separate detached worktree, then
    `git -C /Users/drizzer14/Developer/Projects/pff-ios merge --ff-only <sha>`.
  - a shell write (`sed -i`, `perl -i`, `>`/`>>`, `tee`, `cp`/`mv`,
    python/node one-liner) into `src/`, `__tests__/`, `rules/`, `e2e/` of any
    worktree ("SHELL-WRITE deny"); use Edit/Write, and `git mv` to rename.
  - a `while`/`until` loop that scans the process table for make verify,
    check:all, jest, stryker, semgrep, or xcodebuild ("WAIT-LOOP deny"); wait
    with `bash scripts/wait-load.sh <load> <timeout>` or a background job.

## Override protocol

A Biome lint rule may only be suppressed with a justified override — never a bare `biome-ignore`:

```ts
// biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(third-party boundary) the vendor SDK returns an untyped payload here
const raw: any = sdk.rawResponse();
```

`npm run check:overrides` fails on any `biome-ignore`, `nosemgrep`, `kiko-override:`, or `Stryker
disable` comment that does not contain `OVERRIDE(...)`. A `kiko-override:` on a Node rule passes
only the pre-write guard; `check:all` still fails on that line, because the project-wide Node
checkers have no inline override. Use `nosemgrep:` for Semgrep rules; a Node-rule exception needs a
checker-level exemption (see kiko-linter's "Override forms and where each is honored"). Do not
delete the guard or move a suppressed pattern elsewhere to dodge it — either justify the override
with a specific reason, or fix the code so the ignore is not needed at all.

The same principle applies to every other ignore-list style exception in this repo (see "Documented
exceptions" below): a suppression is only acceptable when it names a concrete reason a human or
agent can verify.

## Documented exceptions

Every ignore-list / suppression exception in this repo is a real, verified usage with a concrete
justification — not dead weight. The full inventory of every ignore-list and allowlist lives in
**`docs/harness/documented-exceptions.md`**. Read and UPDATE that file when you add, change, or rely
on an exception. The standing rule holds: a suppression is acceptable only when it names a concrete
reason a human or agent can verify (see "Override protocol" above).

## Guideline 5.6 — no hidden features

Standing architecture rule, not a one-off cleanup: every feature ships VISIBLE to an App Store
reviewer in a release build — no flag-gated or conditional-visibility feature, and no
demo/seed/screenshot module in or imported from app `src/`. The full rule, the mechanized Semgrep
check (`kiko-no-hidden-feature-flag-or-demo-import`), and its known limits live in
**`.claude/skills/kiko-architecture/SKILL.md`** ("Guideline 5.6 — no hidden features"). Read that
section before adding any build/env flag that controls what a user sees, or any dev-only demo/seed
module.

## Dependency hygiene

Exact-pinning, the `.npmrc` 7-day minimum age, the npm version requirement, the `.env` public-only
rule, and the tracked/accepted dependency CVEs are documented IN FULL in
**`docs/harness/dependency-hygiene.md`**. Standing rule: the CVEs listed under "Known dependency
CVEs" there are tracked, real debt, not a suppressed finding — never silence them; re-check
periodically and pin the moment a fix ships.

## Future stubs (disabled — do not enable without discussion)

```bash
# FUTURE (disabled): a pre-commit hook could run `npm run check:all`.
# FUTURE (disabled): a CI job could run `npm run check:all` and `npm run check:deep` as required checks.
```

## Harness agents

The Kiko agent harness is a local Claude Code plugin at `harness/kiko/` (`kiko` in the local
`harness/.claude-plugin/marketplace.json`). It ships thirteen role agents, seven project skills
(four thin-wrap superpowers, plus `release`, `estimator`, and `harness-sync`), one vendored review
command, the `harness/kiko/scripts/run-log.mjs` run log, and the tier hooks above. A fresh checkout
must run `npm install` first; `semgrep` and `gitleaks` come from `PATH`.

### Delegation rule

The coordinator delegates all work to these agents and never edits app files inline. Complex or
parallel work is split into separate Orca worktrees. If no agent fits a task, the coordinator
reports the gap — it does not do the task itself.

### Skill drift rule

This rule applies to every session, at all times. After every completed code iteration (a feature,
phase, or fix that is developed and tested), the session runs `kiko:retrospect` to verify BOTH skill
locations (`.claude/skills/` and `harness/kiko/skills/`, plus `harness/kiko/agents/`) against the
new code. Then `kiko:scribe` fixes the drift and commits, before the next iteration or the merge.
The completion report names the drift-fix sha (or states "no drift found"). The coordinator checks
that sha before it merges.

### The thirteen agents

developer, planner, debugger, reviewer, qa, designer, explorer,
retrospect, scribe, ops, pm, auditor, researcher. Role, model, effort, and
spawn command per agent, plus "Ponytail isolation" (the reviewer's
`/ponytail-review` vendors only the review prompt from ponytail 4.9.0, no
ponytail hooks anywhere) and "Superpowers" (the plugin points at the
installed `superpowers` skills, never copies them): `docs/harness/agents.md`.
Agent frontmatter sets `model` and `effort`; the Agent tool applies both.
