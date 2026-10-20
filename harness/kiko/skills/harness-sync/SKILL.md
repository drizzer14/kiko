---
name: harness-sync
description: Use when porting generic harness changes from pff-ios (scripts/checks, rules, harness/kiko, docs/harness) to the drizzer14/harness repo, when planning the next sync, or when classifying a pff-ios harness commit as generic or Kiko-only.
---

# Harness sync: pff-ios to drizzer14/harness

## Purpose

Port the GENERIC parts of the Kiko harness from pff-ios to the generic harness repo
(github `drizzer14/harness`, local `~/Developer/Projects/harness`). Kiko-only parts stay in
pff-ios. A sync is one branch in a harness-repo worktree, one orchestrator session, one
BATCH READY, and a coordinator-run merge and push after the user's OK.

## Last sync point

Re-verify before you use any value below: `git -C ~/Developer/Projects/harness log -1`, its
changelog head, and `git -C <pff-ios> log --oneline -1 main`.

- The source of truth is `git -C ~/Developer/Projects/harness log -1` plus the head of the
  harness CHANGELOG; the next sync source starts after the pff-ios range they record.
- One recorded fact: the sync of 2026-10-19 started from pff-ios `e2d96c17..32f3d0c8` on
  harness `7a9ef0c`.
- Find the range with
  `git -C <pff-ios> log --oneline <last point>..main -- harness scripts/checks scripts/wait-load.sh rules docs/harness CLAUDE.md __tests__`.
  Re-verify the sync point against the harness `git log` and CHANGELOG before you use it.

Pending for the next sync (landed in pff-ios 2026-10-11 on branch loan-schedule-cards, not yet
in the harness repo):
- The generic Node rule `kiko-component-i18n-namespace` (pff-ios `99a6f0bc`, fixed in
  `0fb10efc`): a `NODE_RULES` row with `overridable: false`,
  `component-i18n-namespace.js`/`.sh`, `check:component-i18n-namespace` in `check:all`, exit 2
  on a missing scan root. Portable only to a repo that uses the
  `src/design-system/components/<name>/` convention.
- Capitalization-tolerant history-word phrases in the history-word comment rule (`0fb10efc`).
- H8 generic ports (pff-ios branch harness-h8): the TIMEOUT-HEAVY rerun inside the mutation gate
  (`mutation.sh`, `mutation-score.js --rerun-candidates`, `mutation-rerun.js`); the gate start
  defer on load in `job-queue.sh`; the `ff-main.sh` rule refusing a plugin.json version
  decrease, removal or unreadable version; the `knip-ignore-documented` pin suite
  (`__tests__/knip-ignore-documented.test.ts`).
- H9 generic port: the Stryker jest-runner exact-Set patch (`patches/@stryker-mutator+jest-runner+
  8.7.1.patch`, `__tests__/stryker-jest-runner-patch.test.ts`, the `mutation.sh` patched-runner
  preflight, and the `docs/harness/dependency-hygiene.md` "Standing patch" section). The
  mechanism is generic (it touches only the installed runner, not Kiko code); port
  it only to a repo that runs Stryker's jest runner at those exact pinned versions.
- H7 set 5, generic comment-width and history changes: `comment-line-width.js` reads `#`
  comments (shell, YAML, shebang files); `comment-line-width.sh` widened scope, per-file mode
  and the shrink-only exact-line pin file; the `fast.sh` case for shell, YAML and githooks
  writes; the markdown prose-width jest invariant with its shrink-only pin file; the three
  history rules widened to `__tests__` and scripts js, and the three generic shell
  history rules in `semgrep-mobile.yml` (they read `*.sh`, `*.bash` and `githooks/*`).
- H7 set 6, generic mutation and queue changes: the TIMEOUT-HEAVY gate in `mutation-score.js`
  and its `mutation.sh` block; `mutation-score.js` refusing a plain entry; the `--list`
  over-count warning; the job-queue START line naming the head sha; doc-suite discovery of
  pin-file literals; the history-id flag exemption; the tracked-scripts-executable
  invariant; the job-queue gate forwarding the `--list` `warning:` line and printing each
  TIMEOUT-HEAVY line before the DONE line (see the ops skill's "Load rule"); the doc
  fingerprint covering every pin-file literal form that discovery accepts; the history-id
  exemption narrowed to a hyphen with no word character before it.
- H7 set 7, generic main-merge guard: `scripts/ff-main.sh` (moves main only to a sha with a
  green queued `verify` line); the done.log sixth field (the tested HEAD); the kill-guard
  `mainFastForward` kind with its scan of scripts and data bodies; the docs for these; in
  `job-queue.sh`: `tree_is_clean` (`--no-optional-locks` and `--untracked-files=all`),
  `confirm_tested_head`, and `read_tested_head`'s unknown rule.
- H8 task 2, generic queue changes: the `lost` done.log lines (a pruned dead waiter's ticket; a
  reclaimed dead lock, lock form); the queue `format` stamp (an older copy refuses, exit 2) and
  the old-copy WARNING; `run_awaited` (`cmd & wait $!`, so a pid-only SIGINT is not lost on bash
  3.2) with the in-flight command ended first in `stop_on_signal` (`end_in_flight`, before
  `terminate_job_group`) and again at the top of cleanup on the EXIT path (a pid reaped during a
  long terminate poll can be reused); the no-settle-sleep rule for queue tests (rendezvous, never
  a clock; the poll-bound exemption holds only inside the braces of the loop holding the bound,
  and a renamed `timers/promises` `setTimeout` import counts); the `done.log` short-line WARNING
  (short
  lines before the first 6-field line fold into ONE summary WARNING, later ones get their own with
  the line number). `ff-main.sh` plugin version rule,
  for a repo that ships a `plugin.json`: refuse (exit 2) a commit changing the plugin folder
  (`plugin.json` excluded) unless its version is strictly above main's (numeric dotted compare;
  an unreadable or missing version refuses).
- H7 set 3, generic doc-suite gate: the `medium.sh` doc-reading-suites Stop step; the `_lib.sh`
  helpers `harness_doc_roots_pattern`, `harness_doc_suites`, `harness_doc_files`,
  `harness_doc_suite_fixtures`, `harness_doc_fingerprint`, and `harness_doc_suites_by_hand`;
  `make doc-suites`; `guard-replay.js step-budget`; the `--maxWorkers=2` doc run and its
  300-25-60 budget.
- H7 set 8, generic probe and test support: the `kill-guard-probe.sh` stub warm-up before the
  alarm and its `KIKO_PROBE_STUB_FIRST_RUN_DELAY` test seam; the
  `__tests__/test-support/warm-executables.ts` helper (`warmExecutables`) and its use in the
  tests that exec a fresh script; the `fast.sh` shell, YAML and githooks arm that runs
  `security.sh` beside `comment-line-width.sh`.
- pff-ios `339a3d7c`: generic `import-order.js` change (`ambientBlockEnd`, `checkRun`,
  `fixRun`; `__tests__/import-order.test.ts` +4 cases). Portable as is; carry the gap /1
  closer widening if it lands first.
- pff-ios commit "test(job-queue): await every killed child's exit before the sandboxes
  go": the job-queue test teardown awaits every killed child's exit before
  `rmSync` (the port of harness `5f126ee`), plus a pass-count bound
  (`TEARDOWN_POLL_LIMIT` polls x 20 ms, about 30 s) that `5f126ee` lacks. Port the bound back
  to the harness repo: without it, a red row's stub loop, which ends only on sandbox removal,
  hangs the afterEach.
- The CLAUDE.md trim (docs/harness/checks.md split).

## Classification

Build a table FIRST: every pff-ios commit in the range, marked generic (port) or Kiko-only
(skip), with a reason. The coordinator approves the table before any port. The brief's
"likely generic" list is a guess: sync 2 missed about 12 items, so read the whole range.

Generic (ported in sync 2):
- kill-guard: wait-loop deny, `ps -p` pid waits, cp/mv and xargs cp/mv into protected dirs,
  python/node write gaps, GNU xargs flags and options, env and sudo value options.
- `scripts/wait-load.sh` and its tests, installed by init.
- deps.sh `node_modules/node_modules` block; mutation.sh `--list` and argument refusal;
  unquoted changed paths; here-string in place of `printf | grep -q`.
- Mutation gate: change-set scoring (`mutation-score`), comment-only-changes filter,
  `Stryker disable` needs OVERRIDE, scaffolding out of the mutate set, json reporter.
- check:closure and the check-all-lists invariant (both manual, outside check:all).
- Comment rules: task-id, early-exit pipe consumer, history-id comment,
  comment-line-width, history-date, kiko-no-change-language-in-test-body (WARNING).
- Invariants and small fixes: typecheck TS18003 notice pass, heading citations,
  cited-paths partial citations, no single-test `paths.exclude`, Biome formats good fixtures,
  style wrappers skip `rules/fixtures/`, specifier-scanner fix.
- Plugin text: generic rules from agents and skills (harness-workflow, ops).

Kiko-only (left out in sync 2):
- plist.sh and the no-store, api_token, credential checks; privacy-site; deploy-device;
  bundle checks; SF Symbol and deployment-target checks; Modal spy; reminders; EODHD and
  shares; Round B domain rules (device-zone, price_points, day-length, nullable-map ternary,
  Button fullWidth, header items, notification permission); osv dependency bumps; app and
  test-support code.
- shipped-migrations (Drizzle-shaped) and plural-count (i18next): follow-ups, not ported.
- The tests-vs-src invariant: harness tests are `.mjs`, which Jest never collects, and init
  installs no tests.
- Timing stubs: the harness has none. Biome advice wording: tied to the RTK setup.

Rule of thumb from the briefs: a Kiko name, a Kiko path, React Native or Hermes app code, or
a Kiko domain rule makes a commit Kiko-only. A hardcoded Kiko value that a generic feature
needs becomes a config key.

## Config rulings

Switches live in the harness repo's `harness.config.json`. Read the harness README and
`harness.config.json` for the full set; the rulings so far:
- `killGuard.denyStash` and `killGuard.denyUnquotedHeredoc`: ported, OFF by default.
- `killGuard.mainCheckout`: unset = the repository's primary worktree (parent of
  `git --git-common-dir`); `false` = rule off.
- `killGuard.protectedDirs`: default `src`, `__tests__`, `rules`.
- `killGuard.waitLoopJobs`: default list; `[]` = off.
- `closure.paths`: default is the harness repo's closures docs folder (see its README); a missing default passes.
- `checkAllLists.docs`: default `CLAUDE.md`.
- `style.comment-line-width.width`: default 100, no override.
- Mutate-set gate 75 (change-set total) and 60 (per file).
- Env var `HARNESS_WAIT_LOAD_INTERVAL` for wait-load.
- `check:closure` and `check:all-lists` stay out of `check:all`.
- The probe runner's "pff-ios" refusal word is configurable.
- guard-replay is not ported; list it as a follow-up.

## Process

1. Write the brief to `memory/refs/brief-harness-sync-<N>.md` in pff-ios. Include: the source
   point, the target worktree and base, the coordinator's live session name (verify it
   resolves; sync 2 named a dead one), the real commit count, the classification step, the
   config rulings above, the NO-BYPASS rule (never `rtk proxy git`, never `/usr/bin/git`; a
   blocked git means stop and report), the BATCH READY format, report-back lines, and an
   expected duration. Name the permission mode (below). Re-read harness `origin/main` HEAD
   (`git -C ~/Developer/Projects/harness fetch`, then `log -1 origin/main`) right before you
   write the brief AND again before BATCH READY; the user may push to the harness repo
   between syncs (10 commits on 2026-10-19).
2. Create the target worktree from harness origin/main and start the orchestrator there:
   `claude --model opus --plugin-dir <worktree>/plugin`. Dispatch only the harness repo's own
   role agents (never a general-purpose, Explore, or Plan agent). A missing role is a gap to
   report.
3. Plan steps: classification table (coordinator approves), then change sets of 1-2 items,
   one editor at a time, tests in the harness form (node:test `.mjs`, scripts `.cjs`), port
   each source commit range with a note of source path to target path.
4. Land a notice-pass for any Stop-tier check that is red at base (for example TS18003, "no
   TypeScript inputs") BEFORE the first long wait. At sync 2 it looped the Stop hook about 12
   turns.
5. Run heavy gates only after `bash scripts/wait-load.sh 10 3600 &&`. On a loaded Mac, report
   "blocked on load" instead of retrying.
6. Port-time adversarial tests for kill-guard; a gap found in the source guard goes back to
   pff-ios with a `node -e` repro (build the kill word at runtime).
7. One whole-diff review in parallel slices by commit range, a small slice for the plugin
   text, then one fix round split per area. Fix Critical and Important only. Then a retrospect
   drift pass.
8. The orchestrator re-verifies every "green" claim itself (sync 2 caught a misreported test
   count).
9. BATCH READY, then the coordinator re-runs `npm test` AND `npm run check:all` at the tip
   before any push, then the user's OK, then
   `git -C <harness main> merge --ff-only <tip>` (the raw form applies to a repo that has no
   `scripts/ff-main.sh`; where it exists, run `bash scripts/ff-main.sh <tip>` after a queued
   `verify` of the tip) and push. The
   orchestrator never
   pushes and never merges into main.

### Environment (plugin/** edits)

Sync orchestrators run in AUTO MODE (user ruling 2026-10-19). The auto mode environment list
in `~/.claude/settings.json` names drizzer14/harness as a trusted repo, so a session started after
that entry writes `plugin/**` in auto mode. On "classifier gave no verdict", check that entry
and start a FRESH session. Never ask the user to leave auto mode. A denial that persists goes
to the user as a patch list. See memory `harness-repo-plugin-edits-need-auto-mode-off`.

## BATCH READY format

```
BATCH READY — HARNESS SYNC <N>

Base: <sha> (harness main, plugin <version>). Tip: <sha> (branch, <n> commits). Not pushed, not merged.
Source range: pff-ios <from>..<to> (<n> commits), plus <extra shas>.
Run: <runId>. TIMES: per harness-workflow "Run log" / kiko:estimator.

GATE (run by the orchestrator at the tip, after wait-load):
- npm test: exit 0, <pass>/<total> (<suites>).
- npm run check:all: exit 0.
- npm run check:rules: exit 0.
- git status --short: empty.
- Private-name grep (kiko|pff-ios|pff|<task ids>|xcodebuild, CHANGELOG excluded): 0 hits.
- check:deep not run (no src/ to mutate) or its result.

PORTED (source -> target):
1 <scope>: <pff path> -> <harness path> (<sha range>).
...

LEFT OUT (with reason):
- <item>: <reason>.

REVIEW: <slices>, findings by severity, what was fixed, retrospect drift result.
USER RULINGS applied: ...
CANDIDATE LESSONS: see .superpowers/sdd/<track>/lessons.md; <one line per lesson, or "none">.
CHANGELOG: <entry> / VERSION BUMP PROPOSAL: <version>, with any plugin/** line needing the user.
FOLLOW-UPS: ...
```

Every count and exit code is the orchestrator's own measured result.

## Carried follow-ups

- `run-log.mjs` was ported harness -> pff-ios from `cc5cd0f` (`d761245`); the
  byte-identical rule is in `harness-workflow`'s "Run log".
- The script has no dispatch/step-start event, so per-step `Minutes` miss the work before the
  first verdict; fix in the harness repo.
- Carried from H7: the mutation ETA split by changed-line weights; the whole history-date
  rule; the retrospect run-log lines.
- Carried Minors: the doc fingerprint misses a `../fixtures/...pinned` literal
  (`harness_doc_suite_fixtures` needs a quote right before `fixtures/`; `harness_doc_suites`
  accepts `../`); `medium.sh` computes the doc lists twice per Stop.
- G1 port: in the harness repo, a comment-only source mutates nothing whatever its colocated
  tests did (pff-ios `scripts/checks/mutation.sh` has no whole-file keep).
- kill-guard: port to drizzer14/harness the config long-option prefix fix, the new denies
  (`commit-tree`, git config files, include.path, GIT_CONFIG_* exports), the
  script-content kill scan, and the same-command variable expansion. The port also carries the
  data-body kinds (`DATA_KINDS`), the run-body routing, the raw-then-expanded segment reading,
  the chained variable scope, the `internalError` wrapper, and `kill -0` / `$1`..`$9`
  (`f0e9919f`: a later option word after `kill -0` / `kill -s 0` makes the kill count;
  `20457fac`: a heredoc in a scanned script is judged for the scan's kinds; `088a78d7` and
  `7ce17ec5`: comments and test titles). It does
  NOT carry the GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM file check (deleted).
- kill-guard `drizzle/` shell-write deny (`b566307f`): the mechanism is generic, the tree list is
  kiko's, so port it as a configurable list (`WRITE_GUARDED_TREES`), not a hard-coded `drizzle`.
  The YAML rule (`YAML_FILE`, any `*.yml`/`*.yaml` in a worktree outside `node_modules/`) is
  also generic: port it as a configurable extension list.
- kill-guard multi-segment `WRITE_GUARDED_TREES` entries: the generic part is the entry rule (a
  resolved path inside any worktree matches; an unresolved path fails closed when the segments
  appear as consecutive non-final segments, as written or with its `.` and `//` segments
  folded; case-folded), the parent-folder rule (a `cp`/`mv` that lands a folder exactly on
  `<worktree>/.claude` or the plugin folder's parent, or a recursive copy of a source's
  contents there, is denied; `-T` counts only with a recursive flag), `expressionPaths`
  judges resolved `/_` candidates and `namesGuardedTree` checks raw and normalized text, and
  the `.claude/skills` and `.claude/agents` entries. The
  plugin-folder entry is repo-specific: in the harness repo it is that repo's plugin folder,
  not `harness/kiko`. Create `.claude/agents/.gitkeep` so the path resolves.

From sync 2 and earlier:
- Not yet ported: guard-replay, shipped-migrations, plural-count, the estimator skill; the
  `check:typecheck` scope for the harness's own JS.
- kill-guard regression in harness `30500db` (xargs cp/mv into an unresolved destination);
  fixed in pff-ios by `f3908902` and `d21fbdc0`; port both.
- pff-ios side: `30500db` and the stdbuf/time fixes (`f86458b`, `18b5c60`) were ported back
  as `3331487a` and `f8102c15`.
- Both repos: env `-S` `\_` separator and `${VAR}` expansion; `open(mode='w', file=...)`
  keyword-only; `cp -r /tmp/snap/* .` (glob source into a root); BSD-only `sudo -a/-c`;
  `pgrep --fu` prefix.
- Rules: the task-id skip list misses IE-11, ERC-20, CP-1252, GPT-4, FIPS-140, MPEG-4;
  prose hits "item 0", "Part B", "Audit 2024", "Option A"; history-word known misses and hits
  are pinned in fixtures.
- Mutation: the comment-only filter runs before the cap (slow on huge
  diffs); `harness_code_fingerprint` ignores `.sh` and `.cjs` edits.
- `lint.sh` ROOT from a logical pwd (symlinked project path).
- `rules/fixtures/*/src/__tests__/*.ts` match Jest's default testMatch in a project (needs
  `testPathIgnorePatterns` or a rename).
- Closure and lists small message fixes; ponytail cuts (style-common reuse, wait-load uptime
  fallback, scannedCommands walker).
- Plugin lessons needing `plugin/**` edits: never route around a hook block; "nothing to
  check" is an exit-0 notice for Stop-tier checks; report "blocked on load" instead of
  retrying; name the permission mode in a brief that edits `plugin/**`; a source-project
  token invariant.
- Plugin text: ops SKILL and harness-workflow SKILL `--list ... exits 2 above the cap` gains
  "or when the whole-project set cannot be computed".
