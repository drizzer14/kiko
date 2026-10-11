# Kiko quality harness

This project uses a Biome-adapted, LLM-guarding quality harness. Every
check runs through a wrapper in `scripts/checks/` that prints a
structured failure block on failure and stays silent on success.
`scripts/checks/security.sh` is a stated exception: it writes the
dedup-skip notice (so a skip never reads as a fresh scan) and the Class B
WARNING block (a finding that does not block still has to be seen) to
stderr with exit 0. So is `scripts/checks/dup.sh`, whose large-file
WARNING lines (tracked debt that does not block) go to stderr with exit 0.
The other exceptions (the deep tier's streaming, the hook guards' JSON) are
listed in kiko-linter's "The wrapper contract".

**Standing rule: fix the underlying issue. Never weaken a check to get
green.** No `|| true`. No global auto-suppress. An ignore-list entry
needs a concrete, specific justification (see "Documented exceptions"
below).

## Checks

| Command | Tool | Threshold | Tier |
|---|---|---|---|
| `npm run check:lint` | Biome | any lint/format violation fails (Biome skips only the bad fixtures `rules/fixtures/**/*.bad.*`; a good fixture is format-checked, never linted — see `docs/harness/documented-exceptions.md`) | fast (PostToolUse) |
| `npm run check:dup` | jscpd (`scripts/checks/dup.sh`) | >5% duplicated lines/tokens fails. jscpd skips a file over 1000 lines or 100kb without a word, so a second NON-blocking pass (it runs on every call, a dedup skip included) measures each such file alone with the limits raised, plus one combined run of the whole scope, and prints a `WARNING` on stderr (file and percentage; exit code unchanged) for every figure over 5% or one it cannot measure. A scoped run covers only the files it was given. Exit 0 means a hook shows nothing, so a person or a manual `check:dup` run is the reader. Tracked debt, not an allowlist: it becomes a failure once the sweep track brings every large file, and the combined total, to 5% or less (see `docs/harness/documented-exceptions.md`) | medium (Stop/SubagentStop) |
| `npm run check:knip` | Knip | any unused file/export/dependency fails | medium |
| `npm run check:deps` | depcheck + `npm ci --dry-run` + `deps-ranges.js` (exact-pin allowlist) + `npm ls --all` | any unused/missing dep, or broken lockfile, fails; any non-exact-semver spec in dependencies/devDependencies/optionalDependencies/peerDependencies/overrides fails; any `npm ls --all` ELSPROBLEMS (an unsatisfied resolved-tree requirement) fails; a changed dependency block is surfaced for confirmation; a `node_modules/node_modules` link or folder fails before npm ls runs; the fix is `rm node_modules/node_modules` for a link and `npm ci` for a folder, never `rm -r node_modules` | medium |
| `npm run check:security` | Semgrep (`p/typescript`, `p/react`, `p/secrets`, `rules/semgrep-mobile.yml`, `rules/semgrep-prewrite.yml`) | any Class A (ERROR) finding fails; Class B (WARNING) findings are surfaced, override-eligible, non-blocking; a Semgrep error, timeout, bad exit code, or invalid JSON output also fails (see `security.sh`); every argument is scanned in one call, and a dedup skip says so on stderr | fast |
| `npm run check:rules` | `scripts/checks/semgrep-rules.sh` — Semgrep (`rules/semgrep-mobile.yml` and `rules/semgrep-prewrite.yml`) against `rules/fixtures/` | for every fixture present: a rule that reports nothing on its positive fixture, misses a line pinned there by an `EXPECT-FINDING` comment, or matches its negative one fails; so does a fixture id with only one half of its pair present, and a scan that proved nothing (no fixtures, a fixture semgrep never opened, a semgrep error, or a semgrep/verifier crash). A rule with no fixture at all is not detected here — the fixture set is the input | medium |
| (PreToolUse hook) | `scripts/checks/pre-write-guard.sh` + `.js` — Semgrep (`rules/semgrep-prewrite.yml`) plus the Node-checker rules in `pre-write-guard.js`'s own `NODE_RULES` (see that file for the closed rule set) against the proposed post-edit content of an `Edit`/`Write`/`MultiEdit` target | any NEW finding from a Semgrep rule in `rules/semgrep-prewrite.yml` or a Node rule in `pre-write-guard.js`'s `NODE_RULES` denies the write before it lands; a "could not check" failure (Semgrep/Node crash, malformed input) denies too — fail-closed, never bypass | PreToolUse (pre-write) |
| `npm run check:plist` | plist.sh (`plutil`) | any Info.plist security invariant violation fails; a credential client (a credential header or the api_token parameter) without a Cache-Control: no-store request header fails; so does a localized app-name table (`ios/Kiko/*.lproj/InfoPlist.strings`) missing from the Resources build phase, or a missing DiskSpace required-reason entry in `PrivacyInfo.xcprivacy` while any dependency on check 5's linked list in `scripts/checks/plist.sh` ships (fail-closed; see `plist.sh`) | medium |
| `npm run check:secrets` | gitleaks | any detected secret fails; `.gitleaks.toml` allowlists `memory/refs/`, which `.gitignore` (`/memory/`) keeps out of git; see `docs/harness/documented-exceptions.md` | fast |
| `npm run check:overrides` | override-guard.sh | any bare `biome-ignore`, `nosemgrep`, `kiko-override:`, or `Stryker disable` comment (no `OVERRIDE(...)`) fails | medium |
| `npm run check:import-order` | `scripts/checks/import-order.sh` (+ `.js` analyzer) | a leading import block not sorted per kiko-code-style's "Import ordering" (3 blank-line-separated groups, ascending by ending-line length, value-before-type tiebreak, side-effect import as a barrier) fails; two ADJACENT groups of the same kind (no side-effect import as a barrier between them) also fail and must be merged into one; two declarations of ONE module specifier in the header (value+value, type+type, value+type, or a bare side-effect import beside a VALUE import; a namespace import, and a bare side-effect import beside only `import type` declarations, are exempt) also fail — `--write` fixes what it safely can, then re-checks its own output and prints `left for hand fix: <file> <reason>` and exits non-zero for ANY violation it could not fix (a merge blocked by a later group's own prefix or interior comment, a group left untouched because a comment is glued to a non-first import, or a duplicate specifier, which `--write` never merges), for a human to fix by hand. The pre-write guard runs the same analyzer as its `kiko-import-order` Node rule. The per-file fast tier can miss a multi-file/grouping violation that the project-wide `check:import-order` catches, so run the project-wide check before committing. The per-file mode skips a file under `rules/fixtures/`, which the pre-write guard and the project-wide roots never read either | fast (per-file) + project-wide (`check:all`) |
| `npm run check:full-word-identifiers` | `scripts/checks/full-word-identifiers.sh` (+ `.js` analyzer) | any denylisted abbreviation (`cond`/`btn`/`idx`/`acc`/`tx`/`err`/`val`/`prev`/`cfg`/`e`/`res`/`msg`/`cb`/`ctx`/`el`/`opts`/`tmp`/`num`/`arr`/`obj`/`str`) as a whole camelCase/PascalCase/snake_case part of an identifier fails, unless the exact `(file path, denylisted word, identifier name)` triple is on the analyzer's own `EXEMPTIONS` allowlist (an exact-name match, not a whole-file exemption — see `docs/harness/documented-exceptions.md`) | fast (per-file) + project-wide (`check:all`) |
| `npm run check:screen-imports` | `scripts/checks/screen-imports.sh` | a cross-screen import (`kiko-no-cross-screen-import`) fails project-wide | project-wide (`check:all`) + pre-write guard |
| `npm run check:feature-imports` | `scripts/checks/feature-imports.sh` (+ `feature-imports.js`) | an import that crosses a feature without its barrel (`kiko-feature-imports`, B2) fails; so do the `--tree` layout findings over `src/` (loose file at a container root, unit without `index.ts`, undeclared container, a barrel that re-exports test code or another feature, a feature-level value-import cycle) | project-wide (`check:all`) + pre-write guard |
| `npm run check:blank-line-separation` | `scripts/checks/blank-line-separation.sh` | a blank-line-separation violation (`kiko-blank-line-separation`) fails project-wide | project-wide (`check:all`) + pre-write guard |
| `npm run check:comment-line-width` | `scripts/checks/comment-line-width.sh` (+ `.js`) | a physical line over 100 columns holding comment text (`kiko-comment-line-width`) fails project-wide, unless the comment has no wrap point (one long URL); no override of any kind (kiko-code-style "Wrap comments at 100 columns", kiko-linter's `comment-line-width.js` bullet) | project-wide (`check:all`) + pre-write guard |
| `npm run check:guard-replay` | `scripts/checks/guard-replay.sh` (+ `.js` planner/runner) — the unchanged pre-write guard (`pre-write-guard.sh`), run once per `.ts`/`.tsx` file the session changed, with BEFORE = the file at HEAD, or at the parent of the earliest session commit (one that no worktree's passed-replay mark ref `refs/kiko/guard-replay/<worktree id>` reaches and that is newer than the floor ref `refs/kiko/guard-replay-floor` or has a session commit as a parent; through a merge commit, a file the merge kept from one parent takes that parent's baseline, and a file it left different from every parent is checked against both parents' baselines (see `guard-replay.js`'s header)), and AFTER = the working-tree file | any finding the change ADDED fails, naming file, rule, and line (a Bash/python write or its commit bypassed the pre-write guard); a pre-existing finding does not; a replay or guard that could not run fails too (fail closed), and so does the Stop tier's deadline (at most 150 s) | medium (Stop/SubagentStop) + project-wide (`check:all`, no deadline) |
| `npm run check:shipped-migrations` | `scripts/checks/shipped-migrations.sh` (+ `.js`) | a shipped migration file that is modified, deleted, or renamed fails; a new migration passes; no override and no exemption list. The per-file rules, the baseline, and the known limits live in kiko-linter's "Shipped migrations are never edited" | medium (Stop/SubagentStop, before the replay and the HEAD-moved early exit) + project-wide (`check:all`) |
| `npm run check:closure -- <table.md>` | `scripts/checks/closure-table.sh` (+ `.js`) | a closure-table row whose id cell is a range or list, a duplicate id, a fix sha that does not resolve or is not an ancestor of HEAD, a pinning test that is not an existing file:line, or a CLOSED or CLOSED-UNPROVEN row without a sha or a test, or a CLOSED row without "yes" under "Fails on pre-fix source" fails; run by hand at a round's end, not part of `check:all`, not deduped | manual |
| `npm run check:typecheck` | tsc (`--noEmit`) | any type error fails | medium |
| `npm run check:mutation` | Stryker (Jest runner) + `scripts/checks/mutation-score.js` | a passing run is scored on the CHANGE SET only: `mutation-score.js` reads the `json` reporter's output (`reports/mutation/mutation.json`) for the files THIS run mutated and fails when the change-set total is below 75, any graded file is below 60, or the report's own recorded scope (`config.mutate`) differs from the changed-file list (the report is not this run's); a file with no mutants is n/a, not a failure. A changed file Stryker cannot resolve (its `did not result in any files` warning) fails too. Stryker's own break threshold (60, over the whole accumulated report) stays as a whole-report floor. `src/db/schema.ts` is excluded from both the total and the floor — see `docs/harness/documented-exceptions.md`. A changed file whose diff against the merge-base touches only comments or whitespace is skipped (`scripts/checks/comment-only-changes.js`, decided from the TypeScript parse and fail-closed: any doubt, a `Stryker` or JSX-pragma comment, a missing `typescript`, or a colocated test file (same folder only) changed in the same change set by more than comments keeps the file), before the cap and the scorer see the list. More than 30 source files to mutate (`MUTATION_FILE_CAP` in `mutation.sh`) fails before Stryker starts — no env var bypasses the cap; `mutation.sh --list` (`make mutable`) prints the files it would mutate and their count, then exits (2 above the cap) without Stryker, and any other argument exits 2 | deep only |
| `bash scripts/checks/osv.sh` | osv-scanner | any known CVE in `package-lock.json` fails | deep only |

Composite scripts:

- `npm run check:all` — the fast + medium tier checks, in order:
  lint, dup, knip, deps, security, rules, plist, secrets, overrides,
  import-order, full-word-identifiers, screen-imports, feature-imports,
  blank-line-separation, comment-line-width, shipped-migrations, guard-replay, typecheck.
  `__tests__/check-all-lists.test.ts` pins this list to `package.json` and the hooks.
- `npm run check:deep` — the heavy tier: mutation testing, then
  osv-scanner. It is not wired to any hook because it is slow; it is a
  manual checkpoint. **Mutation testing runs per SMALL change set only,
  never on a whole project or a whole release** (a whole-release run
  went 10 h 16 min with no result). The mutation step mutates ONLY the
  source files changed against the merge-base with
  `${KIKO_MUTATION_BASE:-main}` (tests/fixtures excluded, and so is a file
  whose diff is only comments or whitespace): set
  `KIKO_MUTATION_BASE` to that change set's own base commit so only its
  files are mutated. More than 30 files to mutate (`MUTATION_FILE_CAP`
  in `scripts/checks/mutation.sh`) exits 2 before Stryker starts;
  `KIKO_MUTATION_FULL=1` (whole project) and a `KIKO_MUTATION_BASE`
  that does not resolve are refused directly (exit 2), and no env var
  bypasses the cap. There is no release-scope deep gate. **Who and when:**
  the coordinator runs `KIKO_MUTATION_BASE=<change set base sha> make
  deep`, detached, for each reviewed change set (<= 30 source files)
  before its merge into next (and logs the result per harness-workflow's
  "Run log"). Orchestrators never run it; a BATCH READY
  names the change-set base sha, the run id, and the file count, counted
  with the gate's own filter, never by hand: `KIKO_MUTATION_BASE=<base sha>
  make mutable` (it runs `mutation.sh --list`) prints the files and
  `mutable files: N (cap …)`, exits 2 above the cap, and never starts
  Stryker or takes its lock. The mutation step tees its output to a stable,
  tailable progress log and prints an ETA from run history — a
  per-mutant rate (seconds/mutant) derived from past runs, times this
  run's actual mutant count, printed live the moment Stryker reports
  that count — for a human to watch directly. The full never-poll rule
  (agents await only the exit code) lives in the `ops` skill — see it,
  and the `kiko-linter` skill, before running this yourself.

Automatic wiring (`harness/kiko/hooks/hooks.json`, via the
`kiko` plugin — see "Harness agents" below): the fast tier
(`scripts/checks/fast.sh`: lint, security, secrets, import-order,
full-word-identifiers on the touched file) runs on `PostToolUse` for
`Edit|Write|MultiEdit`. The medium
tier (`scripts/checks/medium.sh`: dup, override-guard scoped to the
session's changed source files; knip, deps, the Semgrep rule
fixtures, the Info.plist security assertions, and typecheck
project-wide) runs on `Stop` and `SubagentStop`, and stays silent
only when the session changed neither a source file nor a harness
input and HEAD has not moved since this worktree's last passed guard
replay (read the harness-input regex in `scripts/checks/medium.sh`: rule
files, fixtures, check wrappers, the Info.plist, the Xcode
project, and every file under `drizzle/migrations/`). A session that edited
only a rule, a fixture, or the plist is the one most likely to have
broken a rule (or unpinned a credential-bearing host), so it must not
be the one that runs nothing. The medium tier also replays the
pre-write guard (`scripts/checks/guard-replay.sh`) on every changed
`.ts`/`.tsx` file, whatever wrote it — in the working tree, and in the
commits no worktree's passed replay reached (its mark ref under
`refs/kiko/guard-replay/`) — and runs that replay alone when only HEAD
moved (a turn that only committed). It stops at a deadline of at most
150 s (less when the hook's 300 s are partly spent) and then fails, telling the
agent to run `npm run check:guard-replay` by hand; see kiko-linter's
"Pre-write guard replay on the Stop tier". Right before the replay, and
before that early exit, the medium tier runs
`scripts/checks/shipped-migrations.sh`, so a turn that only committed an
edit to a shipped migration is still checked, and a failure leaves the
replay's mark ref unmoved so every later Stop fails again.
`tsc --noEmit` is project-wide by
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

The same hook (user-approved; it binds the user's own sessions too)
also denies any `git stash` subcommand in any directory, scratch
clones included (`git -C <dir> stash`, `git --git-dir … stash`, and
one inside a `sh -c`/`bash -c` string) — commit a WIP or copy the
files instead — and a heredoc whose delimiter is not quoted (`<<EOF`,
`<<-EOF`; `<<'EOF'`, `<<"EOF"`, `<<\EOF` pass), because an unquoted
heredoc expands backticked text in its body as commands. Each of
these two denies carries the standard WHAT/DETAILS/WHY/HOW/DO-NOT
block.

The same hook also denies `git apply`, `merge`, `rebase`, `pull`,
`cherry-pick`, `revert`, and `am` that target the MAIN checkout
(`/Users/drizzer14/Developer/Projects/pff-ios`), by cwd, `cd`, `-C`,
`--git-dir`/`--work-tree`, or `GIT_DIR=`, because every session's hooks
run from it. Allowed there: `git merge --ff-only <ref>`,
`git pull --ff-only`, and the recovery options `--abort`, `--quit`,
`--skip`, `--continue`. Do the real merge in a separate detached
worktree, verify it, then run
`git -C /Users/drizzer14/Developer/Projects/pff-ios merge --ff-only <sha>`.
See kiko-linter's "MAIN-CHECKOUT deny" for the full rule and limits.

The same hook also denies a shell write (`sed -i`, `perl -i`, a `>`/`>>`
redirect, `tee`, `cp`/`mv` (also `gcp`/`gmv`), a python/node one-liner or stdin heredoc
script (ruby/perl code — `-e` or a stdin script — is a known limit))
into `src/`, `__tests__/`, or `rules/` of any worktree of this
repository, because the pre-write guard sees only Edit/Write/MultiEdit:
use Edit or Write. Move or rename a file with `git mv` (`git add` a new
file first), then edit it with Edit/Write. Reads, git itself, and a
formatter's own `--write` stay allowed. See kiko-linter's "SHELL-WRITE
deny" for the full rule, limits, and where it is live.

The same hook also denies a Bash command whose `while` or `until` loop,
closed by its `done`, scans the process table for make verify, check:all,
jest, stryker, semgrep, or xcodebuild (`ps`, `top`, or `pstree` piped to a
grep, awk, sed, or `[` filter that names the job, or a `pgrep -f`/`--full`
that names it), because the loop's own command line holds the pattern, so
it matches itself and never ends; wait with
`bash scripts/wait-load.sh <load> <timeout>` chained with `&&`, or run the
job with `run_in_background` and wait on its exit code. A one-time
`ps`/`pgrep`, a pid wait (`ps -p`, `--pid`, `-q`, or `kill -0`), a `pgrep`
without `-f`, and a loop on a file stay allowed. See kiko-linter's
"WAIT-LOOP deny".

A second `PreToolUse` matcher (`Edit|Write|MultiEdit`, beside the
`Bash` matcher above) runs `scripts/checks/pre-write-guard.sh`: it
rebuilds the proposed post-edit content and denies the write when a
Semgrep rule in `rules/semgrep-prewrite.yml` or a Node-checker rule in
`pre-write-guard.js`'s `NODE_RULES` reports a NEW finding. It is a
no-op when the target script is absent from a root (matching every
other hook's own "script absent → allow" convention) and fail-closed
on any other failure (a Semgrep/Node crash, malformed input, or a
timeout all deny — see `pre-write-guard.sh`'s own header for the exit
code contract). Every hook in `hooks.json` (kill-guard, pre-write-guard,
fast, medium) invokes `harness/kiko/hooks/dispatch.sh <script-name>`
rather than a hardcoded path: the dispatcher resolves the edited
file's (or the payload's `cwd`'s) own git worktree root — bounded to
`CLAUDE_PROJECT_DIR`'s own repository — and execs that root's
`scripts/checks/<script-name>`, so a subagent editing a DIFFERENT
worktree than the coordinator's own checkout still runs that
worktree's own rules. See `dispatch.sh`'s own header for the full
resolution order and fail-closed/fail-open split per hook.

Both `import-order` and `full-word-identifiers` keep a per-file dedup
fingerprint (target file + the analyzer script's own contents);
`docs/harness/checks-internals.md` "Which call form dedups" lists every
check's dedup.

**Content dedup.** A check skips a run whose inputs did not change since
its last PASS, so a subagent-driven session or a non-source change does
not re-trigger a check that already passed. Which checks dedup, and for
which call form (a hook's file list or single file versus a no-argument
`check:all` run), is listed in `docs/harness/checks-internals.md`;
`osv-scanner` and `check:closure` never dedup because their answer
depends on outside state (the vulnerability database, which changes even
when the lockfile does not; a caller-chosen file and HEAD). Full
mechanism (fingerprint scope per tier, the `medium.sh` and
`mutation.sh` locks, skip-only-on-PASS) is in
`docs/harness/checks-internals.md`.

## Override protocol

A Biome lint rule may only be suppressed with a justified override —
never a bare `biome-ignore`:

```ts
// biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(third-party boundary) the vendor SDK returns an untyped payload here
const raw: any = sdk.rawResponse();
```

`npm run check:overrides` fails on any `biome-ignore`, `nosemgrep`,
`kiko-override:`, or `Stryker disable` comment that does not contain
`OVERRIDE(...)`. A
`kiko-override:` on a Node rule passes only the pre-write guard;
`check:all` still fails on that line, because the project-wide Node
checkers have no inline override. Use `nosemgrep:` for Semgrep rules;
a Node-rule exception needs a checker-level exemption (see kiko-linter's
"Override forms and where each is honored"). Do not delete the guard or move a
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
of every ignore-list and allowlist lives in
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
**`docs/harness/dependency-hygiene.md`**. Standing rule: the CVEs
listed under "Known dependency CVEs" there are tracked, real
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
seven project skills (four thin-wrap superpowers, plus a `release`
skill that documents the release-publishing workflow and an
`estimator` skill that states the duration-estimate rules, and a
`harness-sync` skill for porting generic harness changes to the
drizzer14/harness repo), one
vendored review command, the `harness/kiko/scripts/run-log.mjs` run log, and the tier hooks documented above.

A fresh checkout must run `npm install` before the harness hooks
work — the check tools they call (Biome, jscpd, Knip, depcheck,
Stryker) live in `node_modules`; `semgrep` and `gitleaks` are resolved
from `PATH` instead.

Changes to `harness/kiko/hooks/` (`hooks.json`, `dispatch.sh`) reach
running sessions only after a plugin reinstall (or cache rebuild) plus
`/reload-plugins`: hooks run from the plugin cache copy
(`CLAUDE_PLUGIN_ROOT`), not the checkout.

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
| ops | Runs builds, installs, pods, and the harness checks | sonnet | low | `claude --agent ops --effort low` |
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
(the folders under `harness/kiko/skills/`) and its
agents point at superpowers skills directly (`superpowers:test-driven-development`,
`superpowers:systematic-debugging`, `superpowers:using-git-worktrees`,
`superpowers:requesting-code-review`, `superpowers:writing-skills`,
`superpowers:dispatching-parallel-agents`, `superpowers:brainstorming`,
`superpowers:writing-plans`, `superpowers:executing-plans`,
`superpowers:subagent-driven-development`,
`superpowers:verification-before-completion`,
`superpowers:finishing-a-development-branch`), reusing the installed
`superpowers` plugin rather than duplicating any of its content.
