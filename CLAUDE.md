# Kiko quality harness

Every check runs through a wrapper in `scripts/checks/` that prints a failure block on failure
and stays silent on success (exceptions: kiko-linter's "The wrapper contract").
`scripts/job-queue.sh` is not a checks wrapper.

**Standing rule: fix the underlying issue. Never weaken a check to get
green.** No `|| true`. No global auto-suppress. An ignore-list entry
needs a concrete, specific justification (see "Documented exceptions"
below).

## Checks

Full rows: **`docs/harness/checks.md`**; read the row before relying on an edge case.

| Command | Tool | Threshold (short) | Tier |
|---|---|---|---|
| `npm run check:lint` | Biome | any violation fails | fast |
| `npm run check:dup` | jscpd | >5% duplicated fails; `scripts/checks/dup-ceilings.tsv` | medium |
| `npm run check:knip` | Knip | unused file/export/dependency fails | medium |
| `npm run check:deps` | depcheck, npm | unused/missing dep, bad lockfile, non-exact spec fails (never `rm -r node_modules`) | medium |
| `npm run check:security` | Semgrep | Class A (ERROR) fails; Class B (WARNING) surfaced | fast |
| `npm run check:rules` | `scripts/checks/semgrep-rules.sh` | a rule missing its fixture fails | medium |
| `npm run check:plist` | `plutil` | Info.plist / privacy-manifest violation fails | medium |
| `npm run check:secrets` | gitleaks | any secret fails | fast |
| `npm run check:overrides` | override-guard.sh | a bare suppression comment fails | medium |
| `npm run check:import-order` | `scripts/checks/import-order.sh` | unsorted imports fail (kiko-code-style "Import ordering"); run project-wide before committing | fast + project-wide |
| `npm run check:full-word-identifiers` | `scripts/checks/full-word-identifiers.sh` | a denylisted abbreviation fails (`EXEMPTIONS`) | fast + project-wide |
| `npm run check:screen-imports` | `scripts/checks/screen-imports.sh` | a cross-screen import fails | project-wide + pre-write |
| `npm run check:feature-imports` | `scripts/checks/feature-imports.sh` | crossing a feature without its barrel fails | project-wide + pre-write |
| `npm run check:blank-line-separation` | `scripts/checks/blank-line-separation.sh` | a violation fails | project-wide + pre-write |
| `npm run check:comment-line-width` | `scripts/checks/comment-line-width.sh` | a comment line over 100 columns fails; only shrink-only pins | project-wide + pre-write + fast |
| `npm run check:component-i18n-namespace` | `scripts/checks/component-i18n-namespace.sh` | reading another component's namespace fails | project-wide + pre-write |
| `npm run check:guard-replay` | `scripts/checks/guard-replay.sh` | a finding that bypassed the pre-write guard fails; fail-closed (on a Stop deadline failure run it by hand) | medium + project-wide |
| `npm run check:shipped-migrations` | `scripts/checks/shipped-migrations.sh` | a shipped migration changed fails; no override | medium + project-wide |
| `npm run check:typecheck` | tsc | any type error fails | medium |
| `npm run check:permissions` | `scripts/checks/permission-doctor.sh` | an unworkable permission rule or settings drift fails | manual |

Composite scripts:

- `npm run check:all` — the fast + medium tier checks, in order:
  lint, dup, knip, deps, security, rules, plist, secrets, overrides,
  import-order, full-word-identifiers, screen-imports, feature-imports,
  blank-line-separation, comment-line-width, component-i18n-namespace, shipped-migrations, guard-replay, typecheck.
  `__tests__/check-all-lists.test.ts` pins this list to `package.json` and the hooks.
- `npm run check:deep` — the heavy tier: `check:mutation` (Stryker +
  `mutation-score.js`), then `bash scripts/checks/osv.sh` (a known CVE in `package-lock.json`
  fails). Manual; queue the gate with `scripts/job-queue.sh gate <worktree> <label> <base> <head>`.
  **Mutation runs per SMALL change set only, never on a whole project or release**: set
  `KIKO_MUTATION_BASE` to the change set's own base commit; more than 30 files to mutate
  (`MUTATION_FILE_CAP` in `scripts/checks/mutation.sh`) exits 2; no env var bypasses the cap. The
  coordinator queues the gate per reviewed change set before its merge into next and logs it per
  harness-workflow's "Run log"; orchestrators never run it. Agents await only the exit code.
  Full rules: `docs/harness/checks.md`.
  Mutation gates are paused by the user since 2026-10-25 until lifted; verify + review only
  (the gate text stays).
- `make jest-affected [BASE=<ref>]` is the default dev test command: it runs only the jest suites
  the change can affect. Exit 3 (`AFFECTS EVERY SUITE`) means queue the verify. The full suite
  runs only in the queued verify; named-file jest (`npx jest <files> --maxWorkers=2`) stays
  allowed. Detail: `docs/harness/checks.md` "Makefile targets: `make jest-affected`".

## Automatic wiring

Detail for every hook, and the full deny list: `docs/harness/checks.md` "Automatic wiring" and
kiko-linter (section names are in checks.md). Hooks live in `harness/kiko/hooks/hooks.json` and run
`harness/kiko/hooks/dispatch.sh <script-name>`, which execs the edited worktree's own
`scripts/checks/<script-name>`. Hook changes reach running sessions only after a plugin reinstall
plus `/reload-plugins`.

- `PostToolUse` (`Edit|Write|MultiEdit`): `scripts/checks/fast.sh`, per-file checks.
- `Stop`/`SubagentStop`: `scripts/checks/medium.sh` (also the doc-reading jest suites when skill,
  agent, docs or CLAUDE.md text changed: on a failure run `make doc-suites`). A repeated `Stop`
  skips it with a note. Wrappers exit `2` and print the failure block to stderr.
- `PreToolUse` `Edit|Write|MultiEdit`: `pre-write-guard.sh` denies a write that adds a finding
  from `rules/semgrep-prewrite.yml` or `NODE_RULES`; fail-closed, never bypass.
- `PreToolUse` `Bash`: `scripts/checks/kill-guard.sh` denies, in short:
  - `pkill`, `killall`, pattern/process-group `kill`; stop only a pid you started (`kill <pid>`).
  - any `git stash`; a heredoc with an unquoted delimiter.
  - `git apply|merge|rebase|pull|cherry-pick|revert|am` on the MAIN checkout
    `/Users/drizzer14/Developer/Projects/pff-ios`, and any command that moves `main`: merge in a
    detached worktree, then `bash scripts/ff-main.sh <sha>` (it can exit 2 AFTER main moved; a
    re-run retries only the patch-package step).
  - a shell write into a guarded tree (for example `src/`, `__tests__/`, `rules/`, `scripts/`,
    any `*.yml`; "SHELL-WRITE deny"): use Edit/Write. Full list: `WRITE_GUARDED_TREES`,
    `docs/harness/checks.md` "Automatic wiring".
  - a whole-repository job or full jest run typed outside the queue: queue it with
    `bash scripts/job-queue.sh verify|check-all|security|gate ...` (harness sync:
    `harness-verify <harness worktree> <label>`); name files for jest
    (`npx jest <files> --maxWorkers=2`).
  - a commit/merge/pull that skips `githooks/` (`--no-verify`, `-n`, `core.hooksPath`); repair
    with `bash scripts/ensure-git-hooks.sh` or `npm ci`.
  - a `while`/`until` loop scanning the process table (use `scripts/wait-load.sh` or a background
    job); a command the guard cannot judge.

## Pre-commit typecheck

`githooks/pre-commit` and `githooks/pre-merge-commit` run `scripts/checks/commit-typecheck.sh`
(`tsc --noEmit` on the staged index; exit 2 aborts). User ruling 2026-10-13: typecheck only,
never the rest of `check:all`. Never pass `--no-verify`/`-n` or `-c core.hooksPath`. Detail:
`docs/harness/checks.md` "Pre-commit typecheck".

## Override protocol

A suppression is never bare: `npm run check:overrides` fails any `biome-ignore`, `nosemgrep`,
`kiko-override:`, or `Stryker disable` comment without `OVERRIDE(reason)`. Justify it that way, or
fix the code; never delete the guard or move the pattern to dodge it. A `kiko-override:` on a Node
rule passes only the pre-write guard; `check:all` still fails on that line (see kiko-linter's
"Override forms and where each is honored").

## Documented exceptions

A suppression or ignore-list entry needs a concrete, verifiable reason. Inventory:
**`docs/harness/documented-exceptions.md`**; read and UPDATE it when you add, change, or rely
on one.

## Guideline 2.5.19 — no hidden features (formerly 2.3.1(a); Apple's rejection cited 5.6)

Every feature ships VISIBLE to an App Store reviewer in a release build: no flag-gated or
conditional-visibility feature, no demo/seed/screenshot module in or imported from app `src/`.
Full rule and checks: **`.claude/skills/kiko-architecture/SKILL.md`** ("Guideline 2.5.19 — no
hidden features"); read it before adding any build/env flag that controls what a user sees, or
any dev-only demo/seed module.

## Dependency hygiene

Exact-pinning, the `.npmrc` 7-day minimum age, the `.env` public-only rule and the tracked CVEs
are in **`docs/harness/dependency-hygiene.md`**. Its "Known dependency CVEs" are tracked, real
debt: never silence them; pin the moment a fix ships.

Future stubs (disabled, do not enable without discussion): a pre-commit `check:all`, a CI job.

## Harness agents

Local Claude Code plugin `harness/kiko/` (`kiko`, in `harness/.claude-plugin/marketplace.json`):
thirteen role agents, project skills, a vendored review command, the
`harness/kiko/scripts/run-log.mjs` run log, and the tier hooks above. Run `npm install` first;
`semgrep` and `gitleaks` come from `PATH`.

### Delegation rule

The coordinator delegates all work to these agents and never edits app files inline; complex or
parallel work goes into separate Orca worktrees. If no agent fits, it reports the gap.

### Skill drift rule

Applies to every session. After every completed code iteration (developed and tested), the
session runs `kiko:retrospect` to verify BOTH skill locations (`.claude/skills/`,
`harness/kiko/skills/`, plus `harness/kiko/agents/`) against the new code. Then `kiko:scribe`
fixes the drift and commits, before the next iteration or the merge. The completion report names
the drift-fix sha (or "no drift found"); the coordinator checks it before merging.

### The thirteen agents

developer, planner, debugger, reviewer, qa, designer, explorer, retrospect, scribe, ops, pm,
auditor, researcher. Role, model, effort, spawn command, "Ponytail isolation" and "Superpowers":
`docs/harness/agents.md`. Agent frontmatter sets `model` and `effort`; the Agent tool applies both.
