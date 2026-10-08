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

- Harness main `4978749` (plugin 1.3.0, pushed 2026-10-09) holds pff-ios source up to
  `068a1424`.
- The next sync source starts after that point. It must include pff-ios `3331487a`,
  `f3908902`, and `d21fbdc0`: kill-guard cp/mv into a protected folder itself, the xargs fill
  rule (a fill names a folder only for a recursive copy or a move), and GNU abbreviations read
  as recursive. The xargs unresolved-destination regression also exists in harness `30500db`.
- Find the range with
  `git -C <pff-ios> log --oneline <last point>..main -- harness scripts/checks scripts/wait-load.sh rules docs/harness CLAUDE.md __tests__`.
  Re-verify the sync point against the harness `git log` and CHANGELOG before you use it.

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
- Comment rules: history-word, task-id, early-exit pipe consumer, history-id comment,
  comment-line-width.
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
   expected duration. Name the permission mode (below).
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
   `git -C <harness main worktree> merge --ff-only <tip>` and push. The orchestrator never
   pushes and never merges into main.

### Environment (plugin/** edits)

Settings `defaultMode: "auto"` makes role agents' `plugin/**` edits fail, even after the
orchestrator leaves auto mode, and the mode can return by itself. The RTK PreToolUse hook
rewrites Bash calls, so auto mode gives "no verdict" on them (git included). `/permissions`
grants do not help. Ask the user to turn auto mode off (accept-edits worked) in that
orchestrator's own terminal BEFORE the plugin text change set; see memory
`harness-repo-plugin-edits-need-auto-mode-off`.

## BATCH READY format

```
BATCH READY — HARNESS SYNC <N>

Base: <sha> (harness main, plugin <version>). Tip: <sha> (branch, <n> commits). Not pushed, not merged.
Source range: pff-ios <from>..<to> (<n> commits), plus <extra shas>.

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
CHANGELOG: <entry> / VERSION BUMP PROPOSAL: <version>, with any plugin/** line needing the user.
FOLLOW-UPS: ...
```

Every count and exit code is the orchestrator's own measured result.

## Carried follow-ups

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
- Mutation: colocated tests under `__tests__/` not seen by the comment-only filter; the
  filter runs before the cap (slow on huge diffs); `harness_code_fingerprint` ignores `.sh`
  and `.cjs` edits.
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
