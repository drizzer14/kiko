# HANDOFF — Kiko 1.0.0: BUILD 25 ready for user resubmission; harness agents re-tuned (2026-09-22)



## ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-10-10 ~11:50) — READ THIS FIRST
Coordinator: session "Coordinator" (job 828f039f; cleared on user request after the retrospect).
FIRST ACTIONS of the next session:
1. WALK THE USER THROUGH THE NIGHT (user request): memory/refs/night-summary-2026-10-10.md, section by section; collect the user's answers to every "OVERNIGHT, needs user confirmation" item (Duo R35-R48 + the kind-picker design choice; Binance planner items 1-15) and the build 29 upload.
2. SendMessage your name to duo-adaptive-c1 (idle, terminal term_8bc6b2a6-4285-4ec4-b6a6-62af9c82f2d6) and to the PM "Status". Arm `bash memory/refs/gaugewatch.sh term_8bc6b2a6-4285-4ec4-b6a6-62af9c82f2d6` (run_in_background) after reading its status line.
3. GATE QUEUE (coordinator runs; one Stryker at a time; caffeinate -i): (a) the Duo task 5 gate may still run (job script /Users/drizzer14/.claude/jobs/828f039f/tmp/duo-gates.sh; result line in tmp/duo-gates-summary.txt; log tmp/gate-duo-task5.log; it was a background job of the cleared session — if its result never arrives, read the summary file and the log); (b) re-gate of 6 named files at duo tip 811610c4 by direct Stryker in deep-gate (`git -C deep-gate checkout --detach 811610c4`; files: src/screens/home/add-transaction-fab/add-transaction-fab.component.tsx, src/native-specs/NativeDisplayRegions.ts, src/native-specs/NativeKikoReminders.ts, src/navigation/home-stack/home.stack.tsx, src/navigation/statistics-stack/statistics.stack.tsx, src/navigation/pane-stack/create-pane-stack-navigator/create-pane-stack-navigator.tsx; floor 60 per file from reports/mutation/mutation.json; mutation.sh has no file-list mode); (c) the Duo task 6 gate in /private/tmp/claude-501/-Users-drizzer14-orca-workspaces-pff-ios-duo-adaptive/a6b4ae83-2499-4362-9fb5-25d94d7e8154/scratchpad/wt-task6 with KIKO_MUTATION_BASE=6b03cbcb. Then "gate window free" -> the Duo user sim session.
4. Retrospect 2026-10-10 DONE: 16 lessons; drift fixed in 3610f1b4 (ops checkout owner, caffeinate, incremental baseline, bundle markers; BATCH READY full jest; re-gate method; plugin 0.3.11) — main = next = 3610f1b4 (docs on top of the build 29 release commit 622c236f; the archive is 622c236f). The user runs `claude plugin update kiko@kiko-marketplace` then /reload-plugins in each session. Memory updated (7 files).
Full log: memory/refs/morning-list-2026-10-09.md (from "NEW COORDINATOR (after /clear").
| Thing | Value |
|---|---|
| main = next | 3610f1b4 (retro docs) on top of 622c236f = "chore(release): v1.1.0 (build 29)", the archived commit. make verify 594 suites / 11148 tests. Contains: exchange-rate fix (already on main before), iOS 18 fallback, onboarding-fixes rounds 1+2 (tips REMOVED, "Help" label, holdings empty state, Add holding from pickers, Title Case rows), key-loss fail-safe (DatabaseKeyMissingError; 7 known limits in kiko-architecture), release skill What's New format (plugin 0.3.10). NO tag yet. |
| BUILD 29 | ARCHIVED ~/Library/Developer/Xcode/Archives/2026-10-10/Kiko-1.1.0-29.xcarchive (Release, Xcode 27.0; invariants OK). USER uploads via Organizer + submits. Texts: memory/refs/release-1.1.0-build29/ (whats-new en/uk in the user's format, review-notes-build29.md — RE-RUN the nav grep at 622c236f before pasting, checklist.md). Reviewer kit: memory/refs/reviewer-kit/ (kiko-demo.kiko = build 29 file, key unchanged, HOW-TO-IMPORT-build29.txt). Privacy site published (gh-pages 75efa5c8), check exit 0. Screenshots: the USER re-shoots. Tag v1.1.0 + GitHub release (github-changelog.md) ONLY after the App Store publishes. |
| DUO | Orchestrator duo-adaptive-c1 (terminal term_8bc6b2a6-4285-4ec4-b6a6-62af9c82f2d6), idle. duo-adaptive = 811610c4: tasks 1-6 + build 29 merged in (a36dbe58) + R47 + gate tests; make verify 630/11833. Gates: task 3 GREEN; tasks 1, 2, 4 per-file fails fixed by tests (re-gate pending); task 5 running; task 6 pending. Then ONE user sim session (hinge log, content off the hinge, M2 numbers, captures, selected-row look R34, icon contrast, heading width, R40 timing). OVERNIGHT rulings R35-R48 + kind-picker design choice need the user. Merge into next only for a build archived with Xcode 27.1 (check 27A9275 is GM). |
| BINANCE | Spec approved 7aa2aeaf (D1-D7), plan faa02e1f (7 tasks) on worktree binance-pay-history. 15 OVERNIGHT planner decisions need the user. Implementation after build 29 + user OK. |
| Worktrees | next, deep-gate, device-deploy (at 622c236f), gh-pages, duo-adaptive, ipad-adaptive, binance-pay-history. |

## ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-10-08 evening) — superseded by 2026-10-10 above
Previous coordinator: session "Coordinator" (job 828f039f; cleared on user request). Log: memory/refs/morning-list-2026-10-09.md (entries after "HARNESS SYNC 2 PUSHED"). FIRST ACTIONS:
1. SendMessage your name to duo-adaptive-3e (Duo orchestrator, terminal term_6568a95c-a207-4867-bd07-9be9ed5c1e05, WORKING). Arm `bash memory/refs/gaugewatch.sh term_6568a95c-a207-4867-bd07-9be9ed5c1e05` (run_in_background) after reading its status line.
2. Two scribes of the old session may still report to "Coordinator": (a) report-handback (worktree ~/orca/workspaces/pff-ios/report-handback: ops model haiku->sonnet, SubagentHandback wording in every agent file, a Jest guard, plugin 0.3.8); (b) retrospect drift (worktree ~/orca/workspaces/pff-ios/drift-1008: kiko-translator + CLAUDE.md Superpowers list; plus a skill commit on ios18-fallback; plus memory lessons). If nothing arrives, check the worktrees' git log. Then merge each into next (merge-tree first; single-action commands), make verify, ff main; the user runs `claude plugin update kiko@kiko-marketplace` + you send /reload-plugins.
3. ONBOARDING FEEDBACK (user device test, 7 items): memory/refs/onboarding-feedback-2026-10-08.md. Item 6 was answered (3 tips). Start a fix track for build 29: UX audit first (harness-workflow), researcher for HIG/TipKit tip styling, designer, developer; every visual change needs the user's device OK.
4. Allow rules: the user added Bash allow rules (.claude/settings.local.json). Keep ONE action per command (memory one-action-per-command-for-allow-rules); the classifier blocks compound kill/merge and self-edits of settings.

### State (2026-10-08 ~17:40)
| Thing | Value |
|---|---|
| main = next | b758a649 (harness-sync skill a786d659, InfoHint 57b9c950, drift fix 700f899a plugin 0.3.7, onboarding merge). make verify PASS 11061 tests. Installed on the iPhone 15 Pro (iOS 27.0) as Release-AdHoc 1.1.0 (28); user device-tested onboarding (feedback above). |
| iOS 18 FALLBACK | Branch ios18-fallback tip c690a5b9 (+ maybe a scribe skill commit on top): on iOS < 26 the sheet is opaque #1C1C1E, scrim 0.55 (scrimFallback), scrolled header systemChromeMaterialDark via src/navigation/large-title-screen-options. Re-review APPROVED. Mutation gate NOT done (a run was voided by laptop sleep + Duo sim load: 23/32 timeouts). RESUME: laptop open, `bash scripts/wait-load.sh 8`, `git -C ~/orca/workspaces/pff-ios/deep-gate checkout --detach <ios18 tip>`, `KIKO_MUTATION_BASE=b758a649 make deep -C ~/orca/workspaces/pff-ios/deep-gate` (8 files), then merge into next, make verify, ff main. Do NOT run during a Duo simulator session. User's device is iOS 18.7 (the "iOS 26 glass" complaint was the iOS 18 fallback). Open: the Home "+" FAB and the keyboard Done pill still use the translucent fallback on iOS 18 (user to look). |
| DUO PHASE 2 | Spec + plan approved on duo-adaptive (5d25c86d): docs/superpowers/specs/2026-10-08-iphone-duo-phase2-adaptive-design.md, docs/superpowers/plans/2026-10-08-iphone-duo-phase2.md. Rulings 1A (Duo only; iPad later), 3A (remount accepted; useDraftParam), 4A (opposite-pane rule wins). Orchestrator duo-adaptive-3e runs task 1/5 (merge main; merge commit 685213fb). USER RULING option A: a Device Hub session with the user at 19:00 or later (task 1 regression captures + task 2 sim facts, plan flag 2) FIRST, then task 1 BATCH READY, then the coordinator runs make deep per task. NEVER merge duo-adaptive into next before build 29 is archived (needs the Xcode 27.1 SDK). Brief: memory/refs/brief-duo-phase2-orchestrator.md. Apple guidance + facts: memory/refs/duo-phase2-brainstorm-2026-10-08.md. |
| BUILD 29 | Will contain onboarding + InfoHint + iOS 18 fallback + the onboarding feedback fixes. Archive with Xcode 27.0. Review notes must name "Help" (tips REMOVED 2026-10-09, user) and the empty states; never mention tips. |
| HARNESS | harness repo origin/main = cc5cd0f (1.4.0, 2026-10-09: run log plugin/scripts/run-log.mjs + harness-workflow "Run log" section; local harness checkout still at 4978749, behind 3). pff-ios plugin 0.3.8 on main (0.3.9 on onboarding-fixes). BACKLOG AFTER BUILD 29 (user 2026-10-09): port the 1.4.0 run log into pff-ios (kiko plugin script + harness-workflow section; replaces hand-written BATCH READY TIMES and feeds kiko:estimator), via kiko:harness-sync in the reverse direction, then /reload-plugins everywhere. Onboarding follow-up task (list in memory/refs/review-onboarding-fixes-cs2.md final section + review-onboarding-fixes-round2.md): sweep the 136 changeLanguage-in-test-body hits then flip that rule to ERROR; date-rule provenance false positives; 2 dropped doc pointers (bottom-sheet.styles.ts:252, theme.ts:1); cash+crypto hint edge in create-holding-target; holdingFormStart .exhaustive; S1 implicit-JSX-arrow guard rule; 2 leftover tests. Planner rule "every task tip must be safe on its own"; review dispatch names its top risk question; comment guard for plan ids like "(Bundle B)". Other backlog: gitleaks allowlist build/.* + documented-exceptions row; rule-inventory test into check:all; Biome lint/suspicious/useAwait; S1 guard (module-scope arrow with implicit JSX return); sweep 136 changeLanguage-in-test-body hits then flip that rule to ERROR; bundle markers must not match migration SQL comments (deploy check false positive on 0055). Backlog (mechanizable): headerLargeTitle guard rule, mutation-score timeout-share warning, pinned RNTL asyncUtilTimeout, skill-date check; optional faster load gate (user asked why agents "poll": wait-load.sh waits on the 5-min load average). |
| Worktrees | next, deep-gate, device-deploy, duo-adaptive, ipad-adaptive, gh-pages, ios18-fallback, drift-1008, report-handback, onboarding (remove after archiving only .superpowers/sdd; already archived to memory/refs/sdd-archive/onboarding — just remove). Branch bank-providers deleted (plan saved: memory/refs/bank-providers-plan-3cba29ab.md). |

## ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-10-09) — superseded by 2026-10-08 evening above
Previous coordinator: session "Coordinator" (job 828f039f; cleared on user request). Full log of 10-08..09: memory/refs/morning-list-2026-10-09.md. FIRST ACTIONS of the new coordinator:
1. SendMessage your name to onboarding-a0 (WORKING) and harness-sync-2-a9 (waiting for the user's accept-edits "go"). Arm `bash memory/refs/gaugewatch.sh term_bd2a156d-6a73-4ec5-8e6e-c4d4f3b6b27a` (onboarding-a0; run_in_background) after reading its status line.
2. Background agents of the old session may still report to "Coordinator" (they are subagents of the cleared session; their results may not reach you): designer InfoHint (worktree connect-hint-icon), ops Duo measurements (/Users/drizzer14/.claude/jobs/828f039f/tmp/duo/), debugger iOS-26 glass root cause. If nothing arrives, CHECK THE WORKTREE / output folder and re-dispatch.
3. Read the rules learned this run (memory): no-usr-bin-git-bypass (never isolation:worktree for git agents; plain `git worktree add` + non-isolated agent), kill-guard-cd-main-compound-reads-as-main-merge, shut-down-booted-simulators-after-capture, device-xcode-hub "Xcode 27.1 side by side".

### State (2026-10-09 morning)
| Thing | Value |
|---|---|
| main = next | bb318f08. Since cdb14143: source-map-js 1.2.2 + shell-quote 1.11.0 pins (e36e7fbb, 4992fc79); kill-guard xargs/env/sudo/stdbuf/time (d1cb6573..f8102c15); kill-guard cp/mv-into-folder + xargs fill rule + GNU abbrevs (3331487a, f3908902, d21fbdc0); account-form Connect reminder (merge bb318f08: first Save with a typed-but-unconnected Monobank/Binance/wallet input shows forms.account.connectHint; second Save saves unconnected). make verify PASS 578 suites / 10909 tests; deep gate of the reminder GREEN (late — coordinator merged before the gate; logged). v1.0.0 tag + GitHub release published (c6433990 = build 23, LIVE on the App Store). |
| Releases | Build 23 = 1.0.0 LIVE. Build 25 NOT used. Build 28 NOT uploaded (superseded). NEXT = BUILD 29 (glass fix + onboarding + Connect reminder + InfoHint + cleanup-c refactors), archived with Xcode 27.0 (NOT 27.1 — 27.1 SDK switches iPhone Duo to edge-to-edge + vertical bars). Review notes for build 29 must name "Help" and the empty states (tips removed 2026-10-09). |
| Xcode | Xcode.app = 27.0 (xcode-select default, archive toolchain). Xcode-27.1.app beside it. simctl / Device Hub sims need DEVELOPER_DIR=/Applications/Xcode-27.1.app/Contents/Developer; Maestro needs JAVA_HOME=/opt/homebrew/opt/openjdk@21; Xcode 27 has no Simulator app. |
| ONBOARDING | [SUPERSEDED 2026-10-09: tips REMOVED by the user; Help page is "Help"; review notes must not mention tips] Session onboarding-a0 (term_bd2a156d-6a73-4ec5-8e6e-c4d4f3b6b27a), worktree ~/orca/workspaces/pff-ios/onboarding, branch onboarding. Spec 42e41f39, plan 0f151f55 (16 tasks). BATCH READY at 963c7ce2: make verify green (591/10929), deep gate GREEN (81.26%, base f8102c15, 24 files), Maestro .maestro/onboarding-fresh-install.yaml 17/17, merge-tree vs main CLEAN. IN PROGRESS: (a) demo-file tip setting — buildDemoSnapshot option per output file (marketing screenshot file = tips hidden; reviewer file kiko-demo-en.kiko = tips shown) + regen; (b) task-14 wording commit with the user's decisions (sent; see morning list). THEN: merge into next in the next worktree (`git -C <next> merge --no-ff <tip>`, never with a leading cd into main) -> make verify -> ff main. A wording-only change needs no new deep gate. Device checks for the user after install: empty-state position on Accounts/Statistics, TipCard close button on multi-line text, "Show tips again" gives no feedback, small-device footer + tip. |
| CONNECT REMINDER ICON | User said YES to an info icon. kiko:designer (old session) builds InfoHint (SymbolIcon info.circle + caption) on branch connect-hint-icon, worktree ~/orca/workspaces/pff-ios/connect-hint-icon (from bb318f08). Then review -> deep gate (base bb318f08) -> merge. |
| GLASS (iOS 26) | User: "Before we switched to iOS 27, it looked good on iOS 26. Replicate that look." Worst on iOS 26.0 device: the BOTTOM SHEET (our BottomSheet = GlassSurface material bloom -> LiquidGlassView effect "clear", no backdrop/wash; bottom-sheet.component.tsx ~:346) and the native HEADER on a scrolled screen (native stack, headerLargeTitle only; OS decides). Simulator comparison (26.0/26.5/27.0) showed cards identical, only native tab bar/FAB differ — not conclusive. A kiko:debugger (old session) is finding the root cause: code change since the iOS 27 switch vs the Xcode 27 SDK linkage. NEXT: from its result, a short design + spec with the user, then build for build 29. iOS < 26 blur tier = later step (own small Fabric UIVisualEffectView component recommended by research). |
| HARNESS SYNC 2 | Session harness-sync-2-a9, worktree ~/orca/workspaces/harness/harness-sync-2. BATCH READY at aafe44a (68 commits; npm test 1874/1874 re-run by coordinator). USER OK to merge + push. WAITING: the user switches that terminal to accept-edits and says "go"; the orchestrator bumps plugin/.claude-plugin/plugin.json 1.2.0 -> 1.3.0 + one sentence in ops/harness-workflow SKILL.md, commits, sends the tip sha; THEN the coordinator fast-forwards harness main (~/Developer/Projects/harness) to it and pushes. Then (user-approved earlier) kiko:scribe writes the kiko:harness-sync skill from BATCH-READY.md "SYNC LESSONS" (/private/tmp/claude-501/-Users-drizzer14-orca-workspaces-harness-harness-sync-2/8b0ca22d-d63a-4f9a-9ec7-10af3665147e/scratchpad/BATCH-READY.md) + plugin bump. Next sync source point: pff-ios main d21fbdc0 (+ port-back f3908902, d21fbdc0). |
| iPHONE DUO | Branch duo-adaptive: main merged in as 2bae1c5e (make verify green). Apple published Duo docs (HIG designing-for-iphone-duo, tech overview, iphone-duo/prepare): launch 2026-10-23; from April 2027 new submissions need Duo screenshots; 27.1 SDK = edge-to-edge + vertical bars (verticalBarEdge trait); inner display portrait keeps horizontal bars. Our sidebar heuristic is wrong for inner-portrait; insets can be left OR right. kiko:ops (old session) measures per pose on the 27.1 Duo sim into /Users/drizzer14/.claude/jobs/828f039f/tmp/duo/. NEXT: brainstorm a spec update with the user (correct on both displays + all poses, no controls in the hinge, maybe a native verticalBarEdge bridge) -> planner Phase 2 -> fresh orchestrator. Ships in a LATER build archived with Xcode 27.1. |

### Open rule work (later track)
env -S `\_` / `${VAR}`; cp -rT/contents into a worktree root (`cp -a /tmp/snap/. .`, `xargs cp -rT {} "$BK"/`); variable pathlib mode; kiko-linter SKILL.md ~:273 over-long line; splitStringOption letter class duplicates env set; Connect-reminder edge case (switching crypto source during a pending wallet connect clears the Binance hint, UI only); check:knip false failure under .claude/worktrees; check:deps npm ci hint; rg missing for Grep/Glob agents (`brew install ripgrep`); kill-guard heredoc-append gap unreproduced (memory kill-guard-heredoc-append-gap-unreproduced).

## ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-10-07) — superseded by 2026-10-09 above
Previous coordinator: session "Coordinator" (formerly clear-conversation-history; cleared on user request after the retrospect). FIRST ACTIONS of the new coordinator:
1. SendMessage your name to harness-sync-2-a9 (WORKING) and to round-c-9b + cleanup-c-97 (both idle). Arm `bash memory/refs/gaugewatch.sh <terminal>` (run_in_background; threshold is now 40%) for each session that works. Terminals: harness-sync-2-a9 term_f3baf7f7-cfd5-4d62-8f63-66948ad875f0; round-c-9b term_48cb9d15-e69c-4217-af7b-d1eac3df550a; cleanup-c-97 term_9b263612-4331-4423-b18a-7393a7ddfa98. READ a terminal's status line before arming.
2. Tell the user to run `! claude plugin update kiko@kiko-marketplace` then `/reload-plugins` in each session: main carries plugin 0.3.5 (retro 358fdcd3).
3. Wait for HARNESS SYNC 2 (see below). Coordinator log for 10-05..07: memory/refs/morning-list-2026-10-05.md; retrospect: memory/refs/retro-coordinator-2026-10-07.md.

### State (2026-10-07)
| Thing | Value |
|---|---|
| main = next | 5cfcfc4e (5 commits past 358fdcd3's set: source-map-js + shell-quote pins, kill-guard xargs/env/sudo; make verify 578 suites / 10776 tests). Everything merged: Round C brief 3 (windows 1-6: STAT-N4, SEC-C3, HOLD-I1, STAT-C1, SYNC-C1/C2/C3, REM-C1, TX-C1 option C, TX-C2 cascade + "every write/delete moves the balance", TX-C3, PERF-C1, C7 tombstones, 0b manual rows stay on top, migrations 0052-0054, privacy pages, Notes/kit), cleanup-c tasks 1-16 (refactors REF-C1/C3/C4/C10/C12/C14/C16, history-word + task-id sweeps, check:closure, wait-load.sh, check:all list invariant, kill-guard python-write + WAIT-LOOP denies, check:deps node_modules self-link block, osv dev-dep overrides, 7 CLAUDE.md edits), build 28 bump 24127d5a, plugin 0.3.5. Every merge result passed make verify (last: 578 suites / 10723 tests). |
| iPhone | 86dea9bc Release-AdHoc (window 6 merge; user LGTM'd 064849b8 device checks; 0054 runs on next open). |
| Build 28 | ARCHIVED: ~/orca/workspaces/pff-ios/build-28/ios/build/Kiko.xcarchive (1.1.0 (28), Apple Distribution) + Export/Kiko.ipa. UPLOAD GATED: the user uploads only after 1.0.0 build 25 passes App Review (memory upload-after-previous-build-passes-review). Then, in order: upload build 28; ASC release-notes line "Requires iOS 18.2 or later." / "Потрібна iOS 18.2 або новіша."; App Privacy "Data Not Collected"; export "exempt"; paste memory/refs/review-notes-build28.md (user-approved, 3888 bytes); reviewer kit memory/refs/reviewer-kit/ (kiko-demo.kiko + key + HOW-TO-IMPORT-build28.txt); AFTER submitting: publish the privacy policy from the gh-pages worktree (cp ../round-c-b/docs/privacy-site/{index,en}.html; only those 2 files change), then `npm run privacy:site -- check` = 0. Tag v1.1.0 + GitHub release only after the App Store publishes (release skill). Keep the build-28 worktree until the upload. |
| HARNESS SYNC 2 | WORKING: session harness-sync-2-a9, worktree ~/orca/workspaces/harness/harness-sync-2 (branch harness-sync-2, base harness origin/main 1b9b164), run with `claude --model opus --plugin-dir <worktree>/plugin`. Brief memory/refs/brief-harness-sync-2.md (source pff-ios 4fa3689b..068a1424, 152 commits classified). Plan 1/9-7/9 port, 8/9 plugin text, 9/9 review + BATCH READY (CHANGELOG 1.3.0 + "SYNC LESSONS"). USER RULING: before 8/9 the orchestrator sends "READY FOR 8/9: leave auto mode"; tell the user, who presses shift+tab in that terminal; 8/9 waits for the user's confirmation. After BATCH READY: run the harness repo's npm test, then after the user's OK fast-forward the harness main and push. |
| Then | USER-APPROVED: kiko:scribe writes a new kiko:harness-sync skill (harness/kiko/skills/harness-sync) from the sync 2 "SYNC LESSONS" + memory/refs/brief-harness-sync*.md: classification generic vs Kiko-only, config rulings, process, BATCH READY format, last sync point (pff-ios 068a1424 or newer), carried follow-ups (guard-replay, shipped-migrations, plural-count, estimator); plugin bump. |
| Open rule work (later track) | kill-guard deny for `ln -s .../node_modules`; a rule that a new CREATE INDEX migration has an EXPLAIN QUERY PLAN test; history-word arms ("any more", build numbers, "confirmed YYYY-MM-DD"); ids in describe/it titles; cleanup-c follow-ups (FILTER_ALL barrel, test-only exports wcagContrastRatio/bondPaymentBackfills/TITLE_KEYS/captureSetDatabaseTransaction, jest ignore .stryker-tmp/, the 4 held transactions.repo history findings, transaction-form :1093 "A1"); Round C open items TX-C1 option A (clock-reach column), SYNC-C1 A2 (cross-currency jar pairing), date-time-row dead placeholder props; kill-guard env -S gaps, both live on macOS in pff-ios and the harness repo: the `\_` separator (`env -S 'pkill\_x'` runs pkill) and `${VAR}` expansion (`env -S 'pk${N}ill x'`); kill-guard.js splitStringOption letter class `/^-([^CuPaS-]*)S(.*)$/s` duplicates env's value-letter set (derive it from OPTION_WRAPPERS); optional pin row `sudo -h pkill x` (allowed by design); check:knip hint/fix for `.claude/worktrees/` (it reports scripts/ensure-env.js and scripts/privacy-site.js as unused there); check:deps hint to run `npm ci` on ELSPROBLEMS. |
| Worktrees | keep: deep-gate (Stryker), device-deploy (at 86dea9bc), build-28, gh-pages, next, round-c (idle), cleanup-c (idle). Prune when idle sessions close: round-c-b (merged), implicit-accounts (track done), mutation-gate (stale). |

### Lessons this session (in memory + skills; see the retro file)
try-harness-commit-when-user-says; coordinator-runs-denied-device-build; upload-after-previous-build-passes-review; every-migration-gets-a-review; mutation-stryker-hub (dry-run timeout root cause, combine windows by count); orchestrator-context-watch (late gauge read -> 40% threshold); scratch-copy-never-shares-node-modules; pgrep-waiter-self-match-trap (now mechanized by the WAIT-LOOP deny). harness-workflow: offer-then-commit, exact `merge --ff-only <sha>`, make verify at every merge commit.

## ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-10-05 13:00) — superseded by the 2026-10-07 section above
Previous coordinator: clear-conversation-history (cleared on user request after the retrospect). FIRST ACTIONS of the new coordinator:
1. SendMessage your name to implicit-accounts-78 and round-c-d3 (both idle; they report to "clear-conversation-history") and the PM pff-ios-89.
2. No gauge watcher is needed while both orchestrators are idle; re-arm `bash memory/refs/gaugewatch.sh <terminal>` (run_in_background) when one starts work. Terminals: implicit-accounts-78 term_9e99c907-14dc-4e65-9189-e2f005332d28; round-c-d3 term_02ee8eb6-52da-4099-9efd-bb391e8d586c. READ a terminal's status line before arming (memory verify-watched-terminal-identity).
3. Tell the user to run `! claude plugin update kiko@kiko-marketplace` then `/reload-plugins` in each session: main now carries plugin 0.3.0 (kiko:estimator + harness-workflow/ops/release/estimator skill edits).
4. Continue the Round C TRIAGE walk-through with the user (parts 2-4 below), then brief round-c-d3 with all rulings.

### State (2026-10-05 13:00)
| Thing | Value |
|---|---|
| main = next | f2d16772 (v1.1.0 build 27 release commit 1c7c8731 + coordinator drift fix f2d16772). Everything of the night merged (implicit fixes 1-8, min iOS 18.2, migrations 0050+0051, type fields create-only, Round C CS1-CS4, guard rules 1/5-5/5 + 6/6, tag guard-rules-end). check:all PASS in the next worktree. |
| iPhone | next 15851635 installed (user LGTM 2026-10-05; migration 0051 ran after a .kiko export). |
| v1.1.0 build 27 | ARCHIVED: ~/Library/Developer/Xcode/Archives/2026-10-05/Kiko.xcarchive (Release config, KikoDistribution profile, Apple Distribution, min iOS 18.2, iPhone only, App Group ok, get-task-allow false, Xcode 27.0 27A266a). NOT uploaded: the USER uploads via the Organizer. It does NOT contain the triage-part-1 fixes; if the user wants them in the distributed version -> fix, bump to build 28, re-archive. Tag v1.1.0 + GitHub release ONLY after the App Store publishes (release skill). 1.0.0 build 25 still "Waiting for Review". |
| Submission blockers | COMP-C1 live gh-pages privacy policy is the 12 Sep text (publish the 2 Oct md as html; user approves + pushes gh-pages); COMP-C3 reviewer Notes + kit stale (rewrite; demo .kiko now has real bank ids after CS3). |
| round-c-d3 | idle; worktree round-c tip 0e53e212 (merged). FINDINGS/LEDGER/CLOSURE in round-c .superpowers/sdd/round-c/. CS5 (TX-C1) parked: options 1/2/3 (planner: 3 now + 1 later). |
| implicit-accounts-78 | idle; track done; close it after the user has no more device items for it (tag + remove its worktree). |
| deep-gate | idle; device-deploy at 1c7c8731. |
| Main checkout gotcha | `check:all` in the MAIN checkout fails gitleaks on Podfile.lock checksums in an untracked copied diff under memory/refs/ (false positive; worktrees pass). Release skill documents it now. A real fix (exclude memory/ with a documented reason) is an open harness item. |

### TRIAGE — user rulings so far (part 1, 2026-10-05) -> build in Round C
- TX-C2 = cascade delete (exchange pair id = new column + migration; split by changeGroupId; deposit reverses the contribution; synced partner skipped) + warning AND a confirmation dialog.
- TX-C3 = preview "balance will be set to X" + imported rows deletable with balance-boundary reversal + correct edit notice (not "synced").
- STAT-N4 = cap the transaction form date at today.
- HOLD-I1 = cap a within-tolerance matched payment's principal at the installment's scheduled principal.

### TRIAGE — still to ask (parts 2-4; details + recommendations in round-c FINDINGS.md "Important — morning triage")
2. SYNC-C1 (jar statements; needs ONE authenticated /personal/statement/<jarId> call via the user's hidden-prompt script, memory api-key-verification-via-user-script), SYNC-C2 (recommended: mark sync-closes, reopen only those), SYNC-C3 (recommended A: re-sync every stored address), STAT-C1 (A flat-at-live vs B empty state), ACC-C2 (allow bank edit while institution is NULL vs accept), CS5/TX-C1 options 1/2/3.
3. Submission: COMP-C1 publish, COMP-C3 Notes + kit, COMP-I1 reviewer inputs (public BTC address, a UA ISIN, sample files), COMP-I2..I4 (App Privacy stays "Data Not Collected"; iOS 18.2 line in the release notes; export compliance "exempt").
4. PERF-C1 (column-mapping useMemo, S), REM-C1 (Gregorian calendar on reminder triggers, S), refactor scheduling (recommended first: REF-C1, C3, C4, C10, C12, C14, C16), index on transactions.loan_holding_id (measured 4.2 ms vs 0.05 ms at 100k rows; migration), history-word sweep timing (236 WARNING lines), the unused biome-ignore at src/db/use-live-query.ts ~162, SEC-C3 cache check on device, later harness ideas (check:all list == package.json invariant; closure-table script; load-rule script; gitleaks memory/ exclusion).

### Lessons this session (in memory; index compacted 21.1 -> 11.9 KB, archive/ holds the superseded files)
retrospect-2026-10-05; force-color-breaks-node-p-stamps; verify-watched-terminal-identity; fast-audit-means-coverage-gaps; closure-table-one-row-per-id; touching-weak-file-needs-tests-first; load rule (skills harness-workflow + ops).

## ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-10-05 07:50) — superseded by 2026-10-05 13:00 above
Coordinator: clear-conversation-history. Full night log + morning items: memory/refs/morning-list-2026-10-04.md (section "Night 2026-10-05" and below).

### State (2026-10-05 07:50)
| Thing | Value |
|---|---|
| main | 253dbe87 (handoff docs; app 09a7a8f1-era, plugin 0.2.7 live). WAITS for the user's device OK of next, then ff + `claude plugin update kiko@kiko-marketplace` + /reload-plugins (plugin 0.3.0, unreleased, adds kiko:estimator + harness-workflow edits). |
| next | 15851635: implicit-accounts round (device fixes 1-8, min iOS 18.2, migrations 0050+0051, type fields create-only), Round C CS1-CS4, guard rules 1/5-5/5 + 6/6 (tag guard-rules-end 2cab4306). make verify PASS (9782). |
| iPhone | 07fae7f1. NEXT INSTALL = next 15851635 (app code = 351e30f1/2c85d5cb): migration 0051 -> user .kiko export FIRST; Podfile changed (iOS 18.2) -> make pods in device-deploy before the build. |
| Sessions | implicit-accounts-78 (term_9e99c907-14dc-4e65-9189-e2f005332d28) idle, waits for device results. round-c-d3 (term_02ee8eb6-52da-4099-9efd-bb391e8d586c, worktree round-c tip 0e53e212) idle, waits for the user's triage; FINDINGS/LEDGER/CLOSURE in round-c .superpowers/sdd/round-c/. guard-rules closed (worktree removal pending in Orca). |
| deep-gate | detached a9c1d051 era, idle. |

### Morning, in order
1. .kiko export -> install next 15851635 (ops; make pods first) -> device checks of implicit fixes 4-8 + Round C CS1-CS4 + SEC-C3 cache check.
2. Round C triage (FINDINGS.md "Important — morning triage"): TX-C2, TX-C3, SYNC-C1 (live jar call), SYNC-C2, SYNC-C3, STAT-C1, STAT-N4, HOLD-I1, ACC-C2, CS5/TX-C1 options 1/2/3; submission COMP-C1 (publish policy), COMP-C3 (Notes + kit), COMP-I1..I4; PERF-C1; REM-C1; refactor scheduling; loan_holding_id index.
3. NAME the next version (no bump until named).
4. Guard follow-ups: history-word sweep timing (236); unused biome-ignore use-live-query.ts ~162; MEMORY.md compaction (~20 KB of 24.4).
5. After device OK: main ff, plugin update.

### Lessons this night (in memory)
Fast audit = coverage gaps; closure table one row per id (+ fail-without-fix proof column); touching a weak file needs kill tests; gate runs only at load < 10 with one jest-heavy agent per track; pipefail early-exit pipes were a fail-open gate (fixed + rule).

## ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-10-04 04:00) — superseded by 2026-10-05 above
Coordinator: clear-conversation-history. Orchestrator implicit-accounts-30 (terminal term_ffb68015-1e84-49d4-b5be-c2c065118c68, worktree ~/orca/workspaces/pff-ios/implicit-accounts) is idle after TRACK DONE; it reports to clear-conversation-history. Gauge watcher armed on that terminal. Morning list: memory/refs/morning-list-2026-10-04.md.

### State (2026-10-04 04:00)
| Thing | Value |
|---|---|
| main | 09a7a8f1 + this handoff commit. WAITS for the user's device OK of next, then `git -C <main> merge --ff-only <next>` + `claude plugin update kiko@kiko-marketplace` + /reload-plugins (plugin 0.3.0: kiko:estimator). User chose to WAIT (2026-10-04). |
| next | 604339e1 = implicit-accounts 3665d3bd + mutation-gate (change-set score: total >= 75, file >= 60; b5ceb93a) + drift fix 4fa39449 + device-feedback fix round 83974517 (lift on hold on all grids, no tap after lift, no-fade leaving pick, loan kinds with icons, implicit account edit/rename by option 1, account filters by id, stale filter prune). make verify PASS (9268 tests). All fix-round mutation windows PASS (79.44, 82.86, 83.39, 81.24). |
| iPhone | 3665d3bd (migrations 0049+0050 applied). Next install = 604339e1 (no new migration) AFTER the user reviews strings/icons/overnight defaults. |
| deep-gate | detached 83974517, idle |
| App Store | 1.0.0 build 25 "Waiting for Review". No version bumps. |

### Morning, in order
1. User review: NEW holdingDetail.accountLabel "Account: {{name}}"/"Рахунок: {{name}}"; REMOVED forms.holding.loanKindLabel/loanKindPlaceholder/loanKindSheetTitle; loan-kind icons house.circle.fill/car.fill/cart.fill/person.fill; 7 overnight defaults; open item: index on transactions.loan_holding_id (coordinator: wait); 4 guard-rule proposals (top: fail on an edited shipped migration). Full TRACK DONE: implicit-accounts worktree .superpowers/sdd/implicit-property-loan-accounts/track-done.md (23 device checks).
2. Device install of 604339e1 (kiko:ops, UDID 00008130-0018712A1E32001C, Release-AdHoc, env -u FORCE_COLOR), then the 23 device checks.
3. After the user's OK: main ff, plugin update + reload, close implicit-accounts-30, tag + remove the implicit-accounts worktree.

### Lessons this run (in memory)
FORCE_COLOR=3 in background sessions breaks node -p stamps (run make verify as env -u FORCE_COLOR); read a terminal's status-line name before arming/moving the gauge watcher (a peer's ORCA_TERMINAL_HANDLE can be inherited and wrong); never edit a shipped migration, comments included; a skill caveat "until X lands" needs its retire condition.

## ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-10-03 21:55) — superseded by 2026-10-04 above
Previous coordinator: pff-ios-9b (cleared on user request after the retrospect). FIRST ACTIONS of the new coordinator:
1. SendMessage your name to implicit-accounts-a5 (orchestrator, terminal term_4c35e90a-1333-4daf-9b38-f34b74e25212, worktree ~/orca/workspaces/pff-ios/implicit-accounts) and the PM pff-ios-89; they report to "pff-ios-9b".
2. Re-arm the gauge watcher: `bash memory/refs/gaugewatch.sh term_4c35e90a-1333-4daf-9b38-f34b74e25212` (Bash run_in_background); on "HANDOVER" ask for its handoff file. Brief template: memory/refs/brief-implicit-accounts.md.
3. Read memory/refs/duration-log.md (estimates come from it, skill kiko:estimator) and memory/refs/morning-list-2026-10-03.md (user items).
4. The MUTATION-GATE subagent of the old coordinator session may be gone after /clear: check ~/orca/workspaces/pff-ios/mutation-gate (see below) and resume with a NEW kiko:developer if its work is uncommitted.

### State (2026-10-03 21:55)
| Thing | Value |
|---|---|
| main | ce40f411 (old; plugin 0.2.7 live). WAITS for the user's device OK, then `git -C <main> merge --ff-only <next sha>` from a verified state + `claude plugin update kiko@kiko-marketplace` + /reload-plugins (plugin 0.3.0 adds kiko:estimator). This handoff commit sits on main: merge main into next first (clean, docs only) |
| next | 51804bc7 (coordinator retrospect drift fix 2026-10-03: ops mutation caveat, harness-workflow fresh-agent rule, kiko-architecture op-sqlite SQLite 3.51.3 + single quotes) on c37d866a = Round B 1/9-9/9, shares-cut (required bank/broker pick + "Other bank" migration 0049; shares/EODHD REMOVED, no migration; per-type name placeholders), implicit-accounts spec 50f8b776 + plan 0e507f16, kiko:estimator skill + plugin 0.3.0. Migrations 0046-0049 (0050 comes with implicit accounts). |
| implicit-accounts (implicit-accounts-a5) | tasks 1/9-8/9 DONE (tip 348b3738); mutation PASS for 1-7 (changed-file scores 52-100, see below), task 8/9 window (base 0cc210fb, tip 348b3738) PASS: changed files 81-93 (holdings.repo 88.02, accounts.stack 88.89, account-form 82.71, holding-form 83.38, accounts.repo 90.51, filter-menu 81.08, route-response 92.92), 20 min, osv accepted advisories only. ALL 8 code tasks passed mutation. Task 9/9 RUNNING since 21:35 (whole-branch review + retrospect + scribe, then make verify, TRACK DONE with the device checklist; estimate 22:45-23:15). Then: ONE merge of the branch tip into next (conditional merge-tree), make verify, device install. |
| mutation-gate (worktree ~/orca/workspaces/pff-ios/mutation-gate, branch mutation-gate, base c37d866a) | kiko:developer (subagent of the old coordinator) building the gate fix: score ONLY the change set's files from Stryker's report, FAIL if change set < 75 or any file < 60, declaration files (src/db/schema.ts, migration snapshots) excluded with a documented reason. At 21:51: UNCOMMITTED edits in mutation.sh, stryker.conf.json, CLAUDE.md, kiko-linter, documented-exceptions, knip.json, tests + new __tests__/mutation-score.test.ts. Fixture copy of the incremental report: .superpowers/fixtures/stryker-incremental-after-ia7.json (100 MB, never commit). Then: kiko:reviewer, merge into next. |
| deep-gate | ~/orca/workspaces/pff-ios/deep-gate detached at 348b3738, idle. One mutation run at a time |
| iPhone | 10aef4f2 build (Round B, migrations 0046-0048). Next install = next after implicit-accounts merge (migrations 0049 + 0050): user takes a .kiko export FIRST |
| App Store | 1.0.0 build 25 "Waiting for Review". No next version yet: do not bump versions |
| Worktrees removed | round-b (tag round-b-end), shares-cut (tag shares-cut-end); notes in memory/refs/round-b-superpowers/ and shares-cut-superpowers/ |

### User decisions this run (all relayed; also in memory)
- Round B: all overnight defaults approved (REM-2 midpoint skip rule; silent back-off pause accepted; restore keeps the live lock; appVersion stays 1.0.0; credentialsNotRestoredMessage approved; task 9/9 perf defaults).
- SHARES CUT (decided 2026-10-02): no shares, no EODHD; broker accounts + bonds + metals with lots stay; no share migration (no such data ever existed); keep every migration file (counting runner).
- New bank/broker accounts need an explicit pick (create only); "Free" -> "Other bank" (id 'other', last row, migration 0049).
- Per-type holding name placeholders (loan "Mortgage"/"Іпотека", property "Apartment or car"/"Квартира або авто").
- IMPLICIT ACCOUNTS (spec + plan approved): one Properties ("Майно") and one Loans ("Кредити") account by kind; existing ones merge (migration 0050); holdings listed directly with drag order; create from Add account; no new reminders for these kinds; Back animates; icon written in the same insert as the create.
- Accepted osv debt: image-size, decode-uri-component, braces (build-time only, no fix).
- Mutation gate: change set >= 75, file >= 60 (fix in progress).
- Agents: a FRESH agent by default; reuse via SendMessage only for a same-task re-review/fix round with small context. Finished agents cannot be removed from the list (never `claude rm`). Keep ipad-adaptive-e7 and duo-adaptive-d4 open.
- Do no work for states the single user's data cannot have (no reminders on property/debt, no duplicate account names, no share data, no EODHD key).
- Durations: estimate from memory/refs/duration-log.md (kiko:estimator), TIMES line in every BATCH READY, a row per task and per mutation window.

### Open user items
Privacy policy text review + gh-pages publish before the 1.2 upload (policy date stays 2 October 2026); App Store Connect: confirm 1.0.0 was never approved; device checks of Round B 1-9, shares-cut and implicit accounts (lists in the BATCH READY / TRACK DONE files under memory/refs/*-superpowers and the implicit-accounts worktree); pay-in-parts research (docs/research/pay-in-parts.md) waits for a scope decision.

### Next steps, in order
1. implicit-accounts: task 8/9 mutation result -> task 9/9 TRACK DONE -> merge into next (one merge) -> make verify.
2. mutation-gate: finish (developer), review, merge into next.
3. Device install of next (export first; ops brief pins UDID 00008130-0018712A1E32001C, Release-AdHoc, EXPECT key).
4. After the user's device OK: main ff, plugin update + reload, close the implicit-accounts session, tag + remove its worktree.

## ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-10-02) — superseded by 2026-10-03 above
Previous coordinator: pff-ios-9b (handover on user request after the retrospect). FIRST ACTIONS of the new coordinator:
1. SendMessage your name to round-b-b6 (Round B orchestrator, terminal term_52a0c6da-cf54-46c0-94b8-02ac5d1fc8d6, worktree ~/orca/workspaces/pff-ios/round-b) and the PM pff-ios-89; they report to "pff-ios-9b".
2. Re-arm ONLY the gauge watcher: `bash memory/refs/gaugewatch.sh term_52a0c6da-cf54-46c0-94b8-02ac5d1fc8d6` with Bash run_in_background; on "HANDOVER" ask the session for its handoff file. Brief template: memory/refs/brief-round-b.md.
3. Read memory/refs/morning-list-2026-10-02.md (all questions ANSWERED 2026-10-02 morning; the answers are in the Round B triage below) and memory/refs/followups-after-round-a.md (open follow-ups).

### State (2026-10-02)
| Thing | Value |
|---|---|
| main | c6098ad3 (follow-ups track; plugin 0.2.7 live). main waits for the user's P5 device check before the next ff |
| next | 253708dc (retrospect drift fix, plugin 0.2.9; goes live after the next main ff + claude plugin update) on top of b9da9588 = Round A, Reminders + round 2, follow-ups, P5 tasks 1/8-8/8 (broker kind, shares, EODHD BYOK, quota guard, migration 0046_add_quote_quota; next free migration 0047) |
| Round B (round-b-b6) | steps 1-2 DONE (FINDINGS: ~/orca/workspaces/pff-ios/round-b/.superpowers/sdd/round-b/FINDINGS.md; 1 Critical, 2 Critical-conditional, 18 Important, ~70 Minor). Step 3 RUNNING: Round B task 1/9 import times + keys; then 2/9 statistics + Close holding; 3/9 release docs + kit (1.2 reviewer Notes DRAFT for user review, privacy policy, demo .kiko, localized display name Kiko/Кіко, DiskSpace manifest); 4/9 balance anchor + block import on synced accounts; 5/9 share refresh + invalid-key status + quota text (local reset time; uk disclaimer "...і не є його партнером."; drop "Daily limit" caption); 6/9 share form + lot edit/delete + currency guard + split lots; 7/9 reminders (snooze fix, skip rules); 8/9 backup + auth (EXPORT_VERSION 2, keep live lockEnabled); 9/9 perf. Per task: BATCH READY -> coordinator mutation run in deep-gate -> merge into next |
| deep-gate | ~/orca/workspaces/pff-ios/deep-gate detached b9da9588 (one mutation run at a time; Semgrep timeouts under load = re-run at low load) |
| iPhone | c6098ad3 build. NEXT device session = P5 + Round B, AFTER Round B tasks 5/9 and 6/9 (user choice); the user takes a .kiko export FIRST (migration 0046) |
| harness repo | drizzer14/harness 1.2.0 PUBLISHED (main 1b9b164, pushed 2026-10-02, no tag) |
| App Store | 1.0.0 build 25 "Waiting for Review". There is NO next App Store version yet (user): do not bump versions |

### Round B triage answers (user, 2026-10-02)
iPhone zone Kyiv on 09-30 and now (INT-B1 does not touch the user's data; code fix only). Closed Monobank cards/jars are outside Kiko's known range (STAT-N1 = code fix, Important). App Review key = a separate FREE EODHD key the user creates (notes explain 20/day). Do NOT ask EODHD for a written OK. Build 25 App Privacy = "Data Not Collected". Home-screen name localized: Kiko (en) / Кіко (uk). Rulings: REM-2 skip tonight if data was added today, an edit keeps the skip; skip rule = skip a fire only if data was added on its own local day before it fires; REM-5 "Set up" counts as the decision; block "Import statement" on Monobank-synced accounts; STAT-N3 bond line ends at the typed price. Scope = Critical + Important + cheap same-file Minors. P5 keys and overnight defaults approved with 2 changes (uk broker disclaimer; reset time in local time).

### Next steps for the coordinator, in order
1. Round B tasks 1/9-9/9 as BATCH READY arrives (mutation per task, merge, tell round-b-b6). Relay the 1.2 Notes draft (task 3/9) and the new local-time wording (task 5/9) to the user.
2. After tasks 5/9 + 6/9: the combined device session (export first; then P5 + Round B device checks from each BATCH READY). Then main ff after the user's LGTM, plugin update.
3. Round B end: drift pass, TRACK DONE, close the session (copy .superpowers to memory/refs, tag, remove the worktree).
4. Then 1.2 release prep only when the user names a version (gates: reviewer Notes + free key, privacy policy + App Privacy for EODHD, demo .kiko, screenshots).

### Rules learned this run (all in memory)
CVE patch/minor fixes older than 7 days: no user OK needed. Orchestrators report at EVERY milestone and route user items through the coordinator. Numbered names only ("task N/M", "step N/M", "option N"), never letters or "CS-n". A session outside pff-ios needs `claude --plugin-dir`; harness-repo plugin/** edits need auto mode OFF. `orca worktree rm` deletes the branch (tag first). Brief memory path is ~/.claude/projects/.../memory/MEMORY.md. Verify a device install with devicectl device info apps. Hold a merge whose text promises a later change set's feature. Hermes has no Intl.PluralRules.

## ⭐⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-09-29 11:05) — superseded by 2026-10-02 above
Previous coordinator: pff-ios-9b (handover on user request after the retrospect). FIRST ACTIONS of the new coordinator:
1. SendMessage your name to round-a-b7 (Round A, terminal term_f33cae3e-52bb-4734-8bb6-b84558b4c75c) and reminders-8e (Reminders, terminal term_06904bf8-4706-44bf-a28a-3c665bce472b) and the PM pff-ios-89; they report to "pff-ios-9b".
2. Re-arm ONLY the gauge watcher (user rules: no idle/prompt/long-agent polling): `bash memory/refs/gaugewatch.sh <terminal>` with Bash run_in_background, one per orchestrator terminal; on "HANDOVER" ask that session for its handoff file; brief templates: memory/refs/brief-round-a-2.md, memory/refs/brief-reminders-2.md.
3. Read the user's morning list: memory/refs/morning-list-2026-09-29.md (overnight defaults, i18n keys, fast-uri CVE decision, device checks, release gates). NOTHING on it is answered yet except where marked.

### State (2026-09-29 11:05)
| Thing | Value |
|---|---|
| main | 7eeaeaf0 (docs + harness rules; plugin 0.2.4 live). next -> main merge WAITS for the user (after CQ1 is on main, only `git -C <main> merge --ff-only <sha>` from a verified worktree) |
| next | bb715cc9 = CQ1, CQ2, Round A tasks 1-7/13, Reminders tasks 1-6/6 (feature complete), migrations 0043-0045 (next free 0046), main's harness rules. make verify at 66da63ab: jest 461/6885 PASS, check:security failed on 5 Semgrep TIMEOUTS only (load from Stryker) -> RE-RUN `npm run check:all` in the next worktree at low load before calling next green |
| deep-gate | running Round A tasks 8/13+9/13 mutation at c2dbc416, KIKO_MUTATION_BASE=61644398 (15 files, 2292 mutants; log scratchpad of the old session deep-c2dbc416.log is NOT durable — if lost, re-run). On pass: merge c2dbc416's round-a range into next (conditional merge pattern), make verify, tell Round A |
| Round A (round-a-b7) | tasks 8/13 + 9/13 done (mutation running); task 10/13 (CS-K, PERF-3) in progress at 5c6834f7; then 11/13 L1 + 12/13 L2 guard rules (+ candidate: tests must not parse mutated src text), 13/13 M TZ tests (+ TZ-flip rule WARNING->ERROR). CS-J deferred until an App Store pass. Before each BATCH READY: merge next into round-a. |
| Reminders (reminders-8e) | ALL 6 tasks on next. Remaining: prune worktree reminders-t3; user review of 6 overnight defaults + i18n keys; ~30 device checks; release gates (App Review notes, a demo reminder in the demo .kiko, screenshot 04 re-shoot). Then the track closes (TRACK DONE -> close the session, copy .superpowers to memory/refs, prune worktrees) |
| iPhone | 686d8114 (old). Next device session = combined: CS-E prompts, Reminders, 0043/0044/0045 with a .kiko export FIRST, SYNC-4 / Binance header, PERF-3 |
| App Store | 1.0.0 build 25 "Waiting for Review" since ~2026-09-22. User rule: the user is the ONLY user until they report a review pass |

### Next steps for the coordinator, in order
1. Re-run check:all on next at low load; then Round A tasks 8/13+9/13 mutation result -> merge -> make verify.
2. Morning list with the user (memory/refs/morning-list-2026-09-29.md): overnight defaults, i18n keys, fast-uri 3.1.6 -> 3.1.8 (dev only, lockfile change needs OK), device session scheduling, next -> main.
3. Round A tasks 10-13/13 as they arrive (one mutation run at a time in deep-gate; Semgrep timeouts under load = rerun, never raise the timeout).
4. After Round A's drift pass: HARNESS SYNC (step 6 of the 2026-09-27 list below; scope there + the retrospect 2026-09-29 rules: merge pattern, stacked merge points, mutation base after a track merge, tests must not parse mutated src text).
5. Then the rest of 1.2: P5 broker/shares/EODHD + the deferred list; then ROUND B.

### Rules learned this run (all in memory)
User questions go through the coordinator (never AskUserQuestion in a peer terminal); numbered task names "task N/M"; report-back rule in every agent + an expected duration per dispatch; the user is the only user until an App Store pass; no waiting-prompt polling (gauge watcher only); merge only in a conditional after a clean merge-tree test; close a session at its handover/TRACK DONE and copy its .superpowers folder before `orca worktree rm`; stacked merge points for gated tracks; mutation base = next's sha after a track merged next; tests must not parse the text of a mutated src file; parser-review stopping rule; peer-relayed answers: read the user's own words in the peer terminal, ask one clarifying question if ambiguous.

## ⭐⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-09-27 23:30) — READ THIS FIRST
Previous coordinator: pff-ios-9b (handover on user request after the retrospect). FIRST ACTION of the new coordinator: SendMessage your
name to the feat orchestrator shares-assets-research-49 (session 9) and the PM pff-ios-89 (both report to "pff-ios-9b"). Then RE-ARM the
SILENT watcher (no cron, no Monitor; user rule, memory silent-cron-checks): run the scratchpad-style trackwatch.sh (copy from
/private/tmp/claude-501/-Users-drizzer14-Developer-Projects-pff-ios/c321b4c1-efa6-4e7b-ad55-68ee2c17942d/scratchpad/trackwatch.sh) with
Bash run_in_background on the session 9 terminal term_76d2219c-4a86-4f7b-80d1-84a1dc2e4ed3; it sleeps 30 min first, then prints + exits only
on gauge >= 50% (handover) or idle > 60 min. Re-arm it after each event. HANDOVER THRESHOLD 50%. Brief template for the next feat orchestrator:
the same scratchpad, brief-feat9.txt.

### State
| Thing | Value |
|---|---|
| main | 7cbc3faa (retrospect drift fix; plugin 0.2.2 at 7fffcd5f; plugin text 7cbc3faa NOT live until a 0.2.3 bump — see below) |
| next | 738f06aa = release 1.1 content: feat merged twice (13455209, e85be58c guard replay) + main merged in |
| feat/assets-debts | 298efbb0 (session 9: kill-guard fix round 2 for git stash / unquoted heredoc deny + scribe; scoped re-review + make verify running) |
| iPhone | ce610048 (Release-AdHoc, D10 icons; device-deploy HEAD ce610048); user LGTM on DEV4, DEV5, D10 |
| App Store | 1.0.0 build 25 "Waiting for Review" since ~2026-09-22; advice given: wait to ~day 7, then Contact Us; do not resubmit |
| generic harness repo | github drizzer14/harness main c950940 (synced 2026-09-27) |
| deep-gate checkout | ~/orca/workspaces/pff-ios/deep-gate (detached a4e8d71d, node_modules ready); use it for per-change-set mutation runs |

### Next steps for the coordinator, in order
1. Session 9 sends BATCH READY (base ccb611dd, ~2 source files for the tag icon + kill-guard harness). Run the per-change-set mutation run
   yourself: in deep-gate, checkout --detach <tip>, KIKO_MUTATION_BASE=<base> make deep, run_in_background, await the exit code only (osv
   separately with bash scripts/checks/osv.sh; known CVEs only = OK). Then merge feat into next (clean merges: coordinator; conflicts: a
   kiko:developer), make verify on next yourself, send MERGED.
2. Deploy the tag-icon build (standard kiko:ops install brief; UTF-16-aware bundle check; if devicectl says unavailable/4016, the iPhone is not on the Mac WiFi network: ask the user to join it, or USB).
3. Session 9 then does CQ1 (kill-guard deny git apply/merge/rebase on the main checkout) and CQ2 (deploy-device.sh UTF-16 bundle check +
   one launch retry), each its own change set.
4. DONE (bbf4cb3f, plugin 0.2.3 live after /reload-plugins). Was: USER must run ONE command to make 7cbc3faa's agent/skill text live (plugin 0.2.3; stage explicitly):
   ! cd /Users/drizzer14/Developer/Projects/pff-ios && sed -i '' 's/"version": "0.2.2"/"version": "0.2.3"/' harness/kiko/.claude-plugin/plugin.json && git add harness/kiko/.claude-plugin/plugin.json && git commit -m "chore(harness): kiko plugin 0.2.3" && claude plugin update kiko@kiko-marketplace
   then /reload-plugins in every running session. Afterwards merge main into next (clean; keeps next ahead of main).
5. When the 1.1 feat track is closed: ROUND A bug hunt + security (plan: "RELEASE ROADMAP" below). Then 1.2 (P5 broker/shares/EODHD +
   deferred list), then ROUND B.
6. HARNESS SYNC after Round A's drift pass (user decision 2026-09-28): port the generic parts to github drizzer14/harness (last sync c950940, 2026-09-27) via an orchestrator session in an Orca worktree of ~/Developer/Projects/harness; one review; coordinator runs npm test, fast-forwards main, pushes after the user's OK. Scope: kill-guard main-checkout ff-only rule + parser fixes + known limits (CQ1; main path configurable); sentinel probe runner kill-guard-probe.sh + tests; deps-ranges.js + deps.sh range/ELSPROBLEMS checks (CS-D); report-back rule in all role agents + expected-duration rule (plugin 0.2.4); user-questions-via-coordinator rule (harness-workflow); the numbered-task-names rule (Task N/M); mutation lessons (wall-clock guards and tests that parse the text of a mutated file both break under Stryker); suite-wide Jest TZ pin pattern (no per-test pins); the rule-inventory Jest invariant and any generic JS rules from Round A CS-L. NOT generic: deploy-device.sh UTF-16 check, Kiko category/Date.UTC Semgrep rules.

### Rules learned this run (all in memory)
Mutation only on small diffs (cap 30, coordinator runs it per change set before merge); no whole-release deep gate. Hooks: the dispatcher runs
from the MAIN checkout (never apply/merge hook files in place there); agents/skills from the plugin cache (bump + update + reload). A commit
command for the user stages every path. Peer-relayed approvals: read the user's own words. Silent watcher only. Researcher 403: curl yourself.

## OVERNIGHT 2026-09-29 (user: "Continue working overnight")
- next = 9956d521 (CQ1, CQ2, Round A tasks 1-5/13, main docs, plugin 0.2.4). main = 9212f591 (docs + harness rules); merge next->main waits for the user (ff-only).
- Round A (round-a-b7, term_f33cae3e, worktree round-a): tasks 6/13+7/13 (migrations 0043+0044, base 0f92e062, tip bdedd922) mutation RUNNING in deep-gate; then merge the whole range into next at once, make verify, tell Reminders. Queue: 8/13 H all-fiat history (running), 9/13 I Binance, 10/13 K PERF-3, 11/13 L1 + 12/13 L2 guard rules, 13/13 M TZ tests (+ TZ-flip rule WARNING->ERROR). CS-J deferred.
- Reminders (reminders-c9, term_471334f3, worktree reminders): tasks 1/5 (mutation 96) + 2/5 (migration 0045 placeholder, reviewed) wait for 0043/0044 on next -> merge next, renumber, green make verify, BATCH READY (report file count from base 2bc3f9e5). Task 3/5 in progress, then 4/5, 5/5.
- Rules: user questions via coordinator; overnight = orchestrators use their recommended default, marked "OVERNIGHT DEFAULT, pending user"; numbered task names "task N/M"; report-back rule; gauge-only watchers (scratchpad gaugewatch.sh) on both terminals.
- Morning for the user: overnight defaults; new i18n keys; the combined device session (CS-E prompts, Reminders module, 0043/0044 with a .kiko export first, SYNC-4, PERF-3); HARNESS SYNC after Round A (HANDOFF step 6).

## OVERNIGHT 2026-09-28 (user directive ~01:30: "Continue working through the night")
- next = 686d8114 (feat 298efbb0 merged; mutation 90.24; coordinator make verify 410/5764). iPhone = 686d8114 (Release-AdHoc; tag icon; user retest pending).
- feat SESSION 9 shares-assets-research-49 (term_76d2219c-...): overnight mode (no AskUserQuestion; rulings to coordinator, 15-min default). CQ1 (main-checkout git deny; USER approved ff-only form + CLAUDE.md paragraph) -> review -> BATCH READY; then CQ2 -> BATCH READY; then TRACK DONE + ledger.
- ROUND A started early (read-only steps 1+2 only; app code on next is stable because CQ1/CQ2 are harness-only): Orca worktree round-a (branch round-a at 686d8114), orchestrator round-a-34, terminal term_97b615ac-1f80-42fb-a4e6-1218c33799c2, brief .superpowers/sdd/round-a/BRIEF.md, report .superpowers/sdd/round-a/FINDINGS.md. No fixes before the user triages.
- Watchers (coordinator session, run_in_background): scratchpad trackwatch.sh (feat) and trackwatch2.sh <terminal> <worktree> (round-a; counts .superpowers/sdd file writes as activity).
- Reminders 1.2 spec: docs/superpowers/specs/2026-09-27-reminders-design.md (e3e1fdb9, 84c2324b).
- ~07:15: CQ1 merged into next 6623d7c1, CQ2 into next f5651e56; coordinator make verify 413/6054 exit 0. Session 9 TRACK DONE (idle; morning list .superpowers/sdd/shares-property-metals-debts/MORNING-session9.md). MAIN NOT UPDATED: merge next->main needs the user; after CQ1 is on main, update main only with `git -C <main> merge --ff-only <sha>` from a verified worktree.
- Round A: FINDINGS ready (C2, cond-C1, I23, M46); CS-A sync fixes round-a 3efefa9a (base 686d8114) mutation 70.41 PASS, NOT merged; CS-B then CS-C in progress; morning items in round-a .superpowers/sdd/round-a/MORNING.md.
- MORNING for the user: triage Round A findings; CQ1/CQ2 overnight ledger decisions; tag-icon retest.
- INCIDENT ~02:00: a CQ1 reviewer probe runner executed a real `pkill x` (line-continuation escaped its rewrite). Coordinator verified Orca, watchers and all sessions alive; any open user process with lowercase "x" in its name may have received SIGTERM. Mitigation: committed safe runner (stubs first on PATH) in CQ1; rule sent to both tracks; memory no-pattern-kill-by-agents updated.

## RELEASE ROADMAP (user directive 2026-09-27): two BUG-HUNT + SECURITY rounds
Order: finish the 1.1 feat track (assets-debts, merged into next) -> ROUND A -> 1.2 (the postponed work: P5 broker/shares/EODHD + the deferred list + Reminders (spec docs/superpowers/specs/2026-09-27-reminders-design.md)) -> ROUND B -> 1.2 release prep.
Each round (coordinator runs it as its own Orca track + orchestrator session, from next):
1. Read-only audits in parallel (kiko:auditor): SECURITY (network hosts/ATS/TLS, Keychain tokens and API secrets, .kiko export crypto, logging of personal data, URL schemes/deep links, Info.plist + privacy manifest, gitleaks over history, osv CVEs incl. the tracked accepted ones), PERFORMANCE (op-sqlite single queue, app-open work, live queries, statistics), DEPENDENCIES/BUNDLE.
2. Bug hunt (kiko:debugger, read-only, parallel slices): holdings (bonds, deposits, loans, metals, property), transactions + statement import, rates/prices/sync, statistics + net worth, backup/restore + migrations, auth/lock; plus a DIVERGENT-TWINS hunt and data-integrity invariants; Maestro E2E flows.
3. Triage with the user: ranked findings; Critical/Important fixed in change sets (<= 30 source files each, one review, coordinator mutation run per change set before merge); every mechanizable finding becomes a guard rule/checker.
4. Deferred debt picked up in Round A: createSingleFlight helper, deploy-device.sh launch-grep false-fail, the worklet-remote-function Semgrep rule, the harness hooks self-check, pre-submission items (screenshots 07/10, privacy policy wording).
5. Exit: device test by the user, merge into next, retrospect + drift pass.
Round B adds: the 1.2 surfaces (broker/EODHD API keys and new network domains, new stored secrets, new data flows; the new Reminders native module and notification permission) and a full kiko-compliance pass before the 1.2 App Store submission.

## 2026-09-27 ~22:00: feat SESSION 9 (term_76d2219c-4a86-4f7b-80d1-84a1dc2e4ed3) replaced session 8 at 51%; tip 49ed0a04; queue: kill-guard fix round (git stash + unquoted heredoc deny, user-approved) -> re-review -> BATCH READY (base ccb611dd, 2 source files) + deployable (tag icon). next = e85be58c (guard replay merged). Harness-only main commit (8 agent/skill files + plugin 0.2.2) waits for the user.

## 2026-09-27 ~18:00: feat/assets-debts 62c38965 MERGED into next = 13455209 (release 1.1; make verify 408/5562 coordinator-verified; 5 harness conflicts resolved feat-first + next-only lines). main unchanged. Harness text in next reaches sessions only after main + plugin bump (0.2.1 now).

## 2026-09-27 day: whole-release deep gate STOPPED by the user after 10 h (mutation only on small diffs; memory mutation-only-on-small-diffs; harness cap task held for the user's OK in session 8). Session 8 = shares-assets-research-c2.

## OVERNIGHT 2026-09-27 (user directive 00:58: work overnight, deep gate if in time, DEPLOY 09:30)
02:30: session 7 handed over at 51%; feat SESSION 8 = shares-assets-research-c2 (term_845005f8-4411-4d77-9ef6-8c0953196049), tip 5ea2f805, in overnight mode (brief scratchpad brief-feat8.txt): device fix round 3 -> IMPORTS T9-T17 + review -> T43 (read-only in parallel; fixes between IMPORTS tasks) -> drift. FREEZE CANDIDATE sha by 04:30 at the latest.
Deep gate: separate checkout ~/orca/workspaces/pff-ios/deep-gate (detached worktree, npm ci done at 6c56d31f); run KIKO_MUTATION_BASE=next make deep there on the freeze sha (best effort; no rate history -> unknown duration). Coordinator crons: 04:37 freeze fallback + deep gate start; 08:43 deploy prep (kiko:ops, standard brief) + morning summary. Overnight keys ship unapproved in the 09:30 device build; review in the morning. Silent watcher scratchpad trackwatch.sh (gauge >= 50% or idle > 60 min).

## ⭐⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-09-26 12:55) — READ THIS FIRST
Previous coordinator: pff-ios-9b (hands over now on user request). FIRST ACTION of the new coordinator: SendMessage your
name to shares-assets-research-72 (feat), pre-write-guard-00 (guard) and the PM pff-ios-89; they report to "pff-ios-9b".
Then RE-ARM the watchers (they were session-only and die with the old coordinator): per orchestrator terminal, run the
scratchpad-style ctxwatch loop (orca terminal read -> result.terminal.tail -> last `C [█░]+ NN%`, exit at 50%) and a
CronCreate at 17,47 * * * * that checks both tracks (git log -1, orca worktree ps, gauge; handover at 50%; unblock if idle
>60 min). HANDOVER THRESHOLD = 50% (user rule). Orchestrator brief template: see the session 5/6 briefs below (opus,
--permission-mode auto; read the handoff file; delegation rule; one review per phase/group; fix rounds only Critical/Important;
coordinator = SendMessage target).

### Running sessions (Orca)
| Session | Worktree / branch | Terminal | State |
|---|---|---|---|
| shares-assets-research-5d (feat SESSION 7, started 2026-09-26 after session 6 handed over at 50%; tip 8b71cbf, P6 tasks 1-5 done; next FB1 fix round, re-review, P2c, P6 tasks 6-11) | shares-assets-research / feat/assets-debts | term_aa4a5fe0-e7f2-4e28-8298-7b4108f938a3 | OLD session 6 row:  FB1 round: P1-P5 built (7ee9f6d); review found C1 (live-query cache seeds edit forms with stale rows -> lost lot) + I1 (backfill marks a failed coin known-empty); fix round queued AFTER the running P6 developer; then P2c follow-up (preview starts at the header row, 5 rows, Show more/less); then scoped re-review -> deployable sha. P6 in progress (tip 144d2967 units). ~44% context. |
| pre-write-guard-00 (guard session 2) | pre-write-guard / pre-write-guard | term_72f7b430-5387-4e3c-8238-c7ae3c164e7c | Final fix wave done 199e7dd (re-review clean). Running: Ruling X (conflict-marker files editable; baseline = union of ours/theirs findings) + Task 24 drift pass incl. the feedback->guard-rule MECHANISM (kiko-linter "Adding a pre-write guard rule", pinned-value rules, harness-workflow classification, reviewer mechanizable tag). Then final report -> coordinator merges. Tip 4ed5be0e. |
| pff-ios-89 | main | — | standing PM; message at EVERY milestone |
| ipad-adaptive-e7, duo-adaptive-d4 | own worktrees | — | idle, unmerged; user: KEEP |

### Next steps for the coordinator, in order (user-approved END ORDER)
1. DONE 2026-09-26: guard merged into feat (2163a66b + fixup 5307e076, make verify 386/5003 coordinator-verified); guard worktree+branch pruned; notes copied to feat .superpowers/sdd/2026-09-25-pre-write-guard/; plugin 0.2.1 on main (4d0daf62, c22d3fb7), next == main. NEW queued feat task IMPORTS (@kiko alias + barrels across feature folders; memory imports-kiko-alias-and-barrels) after the FB1 deployable, before T43. KEYS: ALL APPROVED by the user 2026-09-26 (KEYS-overnight + KEYS-pre-write-guard) with 3 changes relayed to session 7: syncedNotice uk 'Цю транзакцію синхронізовано, тому можна змінити лише категорію та зв’язок із кредитом.'; loanLenderName uk 'Кредитор'; loanLenderNamePlaceholder without 'e.g.'. cost stays 'Вартість'; guard error keys stay separate. Was: Guard final report -> merge pre-write-guard INTO feat/assets-debts (onto the feat tip; last known 144d2967). Expect a conflict in
   src/rates/rates-refresh/rates-refresh.ts (~327: take FEAT's side, 0898a16c) and rule-11 blank-line hits in feat code (run
   node scripts/checks/blank-line-separation.js --write + import-order.js --write in a fixup commit, like 9ab2cf2f). Keep the rule
   move intact: kiko-no-switch / kiko-no-nullable-map-ternary / kiko-no-use-animated-keyboard / kiko-no-history-id-comment only in
   rules/semgrep-prewrite.yml. Conflicted .ts/.tsx: after the plugin refresh the guard is active; Ruling X makes conflict files
   editable. Use a kiko:developer (model opus until 2026-09-27 16:00) — never edit app files inline.
2. DONE 2026-09-26 (plugin cache 0.2.0; coordinator + guard reloaded; pkill -0 probe DENIED in the coordinator = kill-guard live). Was: USER refreshes the kiko plugin ONCE (plugin 0.2.0 on main): `! claude plugin update kiko@kiko-marketplace`, then /reload-plugins
   in every running session. PROVE liveness with a harmless probe: `pkill -0 -f __nonexistent__` must be DENIED (verified 2026-09-26:
   kill-guard was NEVER live; the cache is still 0.1.0 from 09-04).
3. Feat: S1, S2 (held for the guard merge), FB1-MECH (guard rules for FB1 findings incl. no-swipe; FB1-MECH.md), T43 whole-branch
   review + fix rounds.
4. DEVICE TEST by the user (deploy the T43 deployable; user approves strings) + fix rounds.
5. THEN the one deep gate: KIKO_MUTATION_BASE=next make deep on feat (run detached, await the exit code; effectively green = mutation
   >= threshold AND osv only the known CVEs).
6. Merge feat/assets-debts into next (release 1.1). Prune pre-write-guard worktree+branch after its merge (KEYS.md copy already saved).

### Device
iPhone (UDID 00008130-0018712A1E32001C, app data container 11300148-8CFA-440B-8C97-DB08CEB653CA) has ce610048 (Release-AdHoc, installed 2026-09-27 15:17, make verify 407/5552; D10 footer icons; retest RETEST-D10-addendum.md). Before: f2282acb (installed 2026-09-27 14:40, make verify 407/5545; device rounds 4+5 incl. D5-D9; retest RETEST-DEV4 + RETEST-DEV5). Before: a4e8d71d (installed 2026-09-27 ~09:00, overnight freeze; gate evidence = session 8 make verify 02:52; a re-run under Stryker load failed only on Semgrep timeouts -> re-run the gate after the deep gate). Before: 8667c8f0 (installed 2026-09-27, make verify 401/5339; retest RETEST-DEV2-addendum.md; D4 yield to maturity). Before: e1ded680 (installed 2026-09-26 20:45, make verify 399/5285; retest RETEST-DEV1-addendum.md). Before: 8adaf394 (installed 2026-09-26 19:1x, make verify 397/5206; all keys through P6 approved). User device test: RETEST-FB1-P6-addendum.md + the 3 earlier RETEST files. Was: 5cb70fb.
device-deploy HEAD = ce610048, npm install done (.env keys from C2). EVERY ops install brief must pin the UDID, Release-AdHoc and the
container UUID check (an ops run once installed on the iPhone 17 SIMULATOR with a Distribution config and reported SUCCESS).

### Pending for the USER (approve before a deploy that ships them)
- KEYS-overnight.md (feat sdd folder): ~22 pending keys (B1b term max, PROP-UX Property, phase 3 x8, phase 5 x12 + 1 changed, FB1 keys).
  uk questions: Cost "Вартість" vs "Собівартість"; "Ім’я кредитора" -> "Кредитор".
- KEYS-pre-write-guard.md (feat sdd folder; copy of the guard's KEYS.md): 11 sync-error keys + "Use passcode" / localized Cancel
  biometric labels. Coordinator concern: 7 are developer messages -> suggest one user-facing Binance error; full stops.
- Retest scripts in the feat sdd folder: RETEST-0930.md, RETEST-phase3-addendum.md, RETEST-phase4-5-addendum.md (0042 net-worth
  check for base UAH/USD/EUR; loan links).
- Visible guard changes: holding select checkmark moves to the leading side (SelectableRow); "Use Passcode" -> "Use passcode".

### User decisions this run (all relayed; logged in DECISIONS-overnight.md)
P5 broker/shares DEFERRED to a later release; lighter reviews; handover at 50%; no request/query without data (P-NOWORK); "price as
of" caption removed everywhere (silent newest-rate fallback); Property section in Accounts; property Type lists categories; P6:
icons (briefcase for business), ownership (whole value x share, percent OR fraction, tracked over time in PropertyMeta.ownership,
no migration; applies to real estate/business/vehicle/valuable/other, NOT loan given), metal types in the Type select (also for
bank accounts), units on inputs, months/years term toggle, purity 999.9 ‰, loan ledger + ALL upcoming payments, Outstanding from
linked payments when any EVERYWHERE; share changes editable/deletable via CONTEXT MENU (NO SWIPE, swipe was removed); native iOS
chip/segment style (#747478 thumb) incl. icon-picker tiles; mapping preview rows stay 44 pt; preview starts at the header row +
Show more/less; approved visuals are LOCKED (kiko-design-system "Locked decisions"); feedback findings must become guard rules.

### Main / harness state
main 312bffa8 (next == main): e5fba750 pre-write hook entry; 2cfc9452 dispatcher (hooks resolve the edited file's own worktree)
+ plugin 0.2.0; 0ef9c67 handover 50%; 312bffa8 retrospect drift fix + lessons (hook liveness, dispatcher, device installs, negative
claims, debugger symptom rule, locked visuals, review cadence). Gate exit 0 at 312bffa8 (coordinator-verified). Nothing pushed.
Capacity: SONNET weekly limit until 2026-09-27 16:00 Kyiv -> dispatch roles with model "opus".

## ⭐⭐⭐⭐⭐⭐ COORDINATOR HANDOFF (2026-09-24 ~18:30) — READ THIS FIRST
Previous coordinator: pff-ios-9b. FIRST ACTION of the new coordinator: SendMessage your new name to the running
sessions below (they report to "pff-ios-9b" today) and to the PM pff-ios-89.

### Running sessions (Orca)
| Session | Worktree / branch | State | Next |
|---|---|---|---|
| hotfix-build-26-65 | hotfix-build-26 / hotfix-build-26 (from main 924f97b) | code FINAL c71aa7c (rates + addManyDedup chunking, reviewed); user DEVICE OK (BTC in net worth after clean reinstall) | it is bumping CURRENT_PROJECT_VERSION 25->26 + make gate; will send the sha |
| shares-assets-research-bb (feat session 4, terminal feat-assets-debts-4) | shares-assets-research / feat/assets-debts | T30 done b3a030a; review doc merged 4aed3ac; F4 part 1 fix round 2-3 running; F4 part 2 reviewed, fix round queued | then deployable sha + i18n keys for user review -> install; then queued refactor + review fix batches + UAH-star rates (after build 26 merges in) + T31-T33, P5, wrap-up |
| pff-ios-89 | main | standing PM | message it at EVERY milestone |
| ipad-adaptive-e7, duo-adaptive-d4 | own worktrees | idle, unmerged; user: KEEP, do not ask again | — |

### Immediate TODO for the new coordinator (build 26)
UPDATE ~19:00: bump done 28de06e; ops ARCHIVE running from device-deploy @28de06e; hotfix merged into main as c0b47c2
make verify GREEN (276/3223); next ff to c0b47c2; hotfix worktree+branch pruned; feat session 4 told to
merge main (notes sent). Still to do: archive result -> user upload; retrospect/scribe drift result.
UPDATE ~20:45: ARCHIVE READY ~/Library/Developer/Xcode/Archives/2026-09-24/Kiko.xcarchive (build 26, 27A266a, invariants
verified by coordinator). Drift fix c2d6635 on main; next ff to c2d6635. Feat session 4 merges main @c2d6635 next, then
USER runs /reload-plugins there. F4 part 1 keys (41) APPROVED by user. USER DECISION: build 26 is uploaded ONLY if build 25 fails App Store review;
if build 25 passes, the build 26 fix ships in the 1.1 release instead (archive kept as a standby).
UPDATE ~22:30: F4 @2f783ef INSTALLED on iPhone (Release-AdHoc). All 57 F4 keys approved. Refactor questions answered
(mocks in jest.mock exempt; list-or-empty ternary -> fnts; 4 switches -> match(); statistics.screen.tsx:330 backfill
bug -> separate bug commit) and GO given. USER DEVICE BUGS sent to feat session 4 as a priority fix round: (1) mapped
import: completion sheet flashes, navigates back, then re-opens the import form; (2) fixing one field's validation
error makes other fields show errors that do not clear until all are filled. User sends MORE F4 findings on 2026-09-25.
User must /reload-plugins in feat session 4 (87bfb55).
OVERNIGHT (user directive: finish ALL pending track work overnight; user reviews the batch in the morning): feat session 4
runs phases 1-7 (F4 bugs, refactor, review batches, UAH-star, T31-T33, P5, T43); no merge to next, no check:deep (mine).
Files: .superpowers/sdd/shares-property-metals-debts/DECISIONS-overnight.md + KEYS-overnight.md. Cron watch :17/:47 +
ctxwatch (scratchpad) on term_1fd1d997. PHASE 1 DONE 575f19a (both F4 bugs fixed; retest F4FIX1-retest-script.md);
NOT deployed: it carries 2 unapproved keys (maturity/purchase date required errors) -> deploy after morning key review.
~03:xx 2026-09-25: session 4 handed over at 1700c91 (R1, R1.d full-words, R2 ts-pattern done). ORCHESTRATOR SESSION 5 started
in the feat worktree, terminal term_317ce1c6-0db4-4e59-893d-28c5e115f2fa (claude --model opus --permission-mode auto);
next R3 descriptor refactor. New user rule: full words in identifiers (memory no-abbreviated-identifiers).
2026-09-25 ~23:00: phase 2 DONE; phase 3 B1 (abb5055, INSTALLED on iPhone), bug 3 loading gate (8a60d8b), D7a (543d7b8,
unreviewed). USER: handover threshold 50% (main 0ef9c67). Session 5 handed over; ORCHESTRATOR SESSION 6 in the feat worktree,
terminal term_64b728cd-967c-47b3-9338-55d575630639. User answers: skills id sweep; week start = device region; cleanup
migration for stray deposit/bond rows; term error names the max (new key). NEW WORK (coordinator, brainstorming): PreToolUse
pre-write guard hook that BLOCKS common style/design/architecture mistakes; mined list of 17 candidates sent to the user for
approval (tier 1 reuse feat checks, tier 2 new exact rules, tier 3 pinned sites); next: approaches -> spec -> plan.
~23:20: pre-write guard spec 51f05e8 + plan d4262b4 (25 tasks) APPROVED; track worktree pre-write-guard (from feat 543d7b8),
orchestrator pre-write-guard-c7 (term_0d9b42d3-1821-46bd-9bc5-1d53c1d4e2ce). Rule 16 = decision 20 (secondaryTonal; feat skips it).
Feat: B1b afaa178+ceed243 (migration 0040 cleanup). USER: P-NOWORK priority (no request/query without data; spinner 200 ms delay;
device timing runs approved in upgrade order); REMOVE "price as of" caption, always today's rate, silent newest-rate fallback.
USER SCOPE: P5 (broker/shares/EODHD) DEFERRED to a later release; LIGHTER REVIEWS (one per phase/group, Critical/Important only).
2026-09-26 00:40: USER wants a FRESH BUILD on the iPhone at 09:30 (pending strings ALLOWED in this device build, review on phone).
Feat session 6 sends the deployable sha by 08:45 (P-NOWORK fix round incl. C1 empty net-worth for UAH-only users + PROP-UX, one
review). Coordinator one-shot cron 08:50 prepares device-deploy + kiko:ops install. Timing runs skipped (phone locked).
02:00 c05ec8b INSTALLED on iPhone (09:30 build). OPS NOTE for the NEXT device build (feat 09bdba5 or later, C2): public URLs
moved to .env (NBU_API_ENDPOINT, COINGECKO_MARKET_CHART_ENDPOINT, PRIVACY_POLICY_URL_EN/UK) -> run `npm install` in device-deploy
first (postinstall ensure-env appends the keys). S1/S2 held until the pre-write-guard merge into feat.
05:50: PHASE 3 CLOSED 5cb70fb (feat). 5cb70fb INSTALLED on the PHYSICAL iPhone (Release-AdHoc, container 11300148 matches,
npm install done in device-deploy) = the 09:30 build. (A first ops run wrongly installed on the iPhone 17 SIMULATOR with the
Release/Distribution config; memory ops-brief-pin-physical-udid.) Guard: G1-G4 done; Task 17 merge ac64375a done by coordinator's
developer. Morning items for the user: RETEST-0930.md + RETEST-phase3-addendum.md; KEYS-overnight.md (10 pending) + uk Cost
"Вартість" vs "Собівартість"; guard KEYS.md (11 sync-error strings; coordinator concern: 7 are developer messages -> suggest one
user-facing Binance message; full stops); visible guard changes (checkmark leading, "Use passcode").
GUARD KEYS copied (worktree KEYS.md is untracked and dies with the prune) to the feat sdd folder:
.superpowers/sdd/shares-property-metals-debts/KEYS-pre-write-guard.md (11 sync-error keys + the "Use passcode" / localized
Cancel biometric prompt labels). USER MUST APPROVE before any deploy that ships the guard merge.
2026-09-26 12:30 END ORDER (user): guard final report -> coordinator merges pre-write-guard into feat -> user refreshes the kiko
plugin once (`claude plugin update kiko@kiko-marketplace` + /reload-plugins) -> feat: S1, S2, FB1-MECH, T43 -> DEVICE TEST by the
user (+ fix rounds) -> THEN the one deep gate (KIKO_MUTATION_BASE=next make deep) -> merge into next. FB1 in progress (P1,P3,P4
done). Sonnet blocked until 2026-09-27 16:00 (roles on opus).
1. When the hotfix session sends the bump sha: `git -C ~/orca/workspaces/pff-ios/device-deploy checkout -q --detach <sha>`,
   then kiko:ops archives Release / KikoDistribution there: FORCE_BUNDLING=1, clean build (rm ios/build + pod install
   if needed), NON-beta Xcode (check DTXcodeBuild), move the .xcarchive to ~/Library/Developer/Xcode/Archives/<date>/,
   verify invariants (UIDeviceFamily [1], distribution identity, App Group group.com.dmytro-vasylkivskyi.kiko,
   get-task-allow=false). User uploads via Organizer and REPLACES build 25 in App Store review. NO git tag until published.
2. Merge hotfix-build-26 into main (merge commit), make gate, ff next, then tell feat session 4 to merge main.
   Merge notes (from the hotfix session): conflicts in transactions.repo.ts (take feat side, hand-port the chunked
   category-override lookup into insertDedupRowsTx), chunk-for-table.ts doc comment (feat wording + both callers),
   kiko-architecture Price data section (addManyDedup -> insertDedupRowsTx). Then prune the hotfix-build-26 worktree.
3. Feat session 4 skips its own rates chunk fix (it comes from main); after that merge it does the UAH-star rate model
   (user approved) + a logged Left on failed refresh.

### Decisions made today (all already sent to feat session 4; details in its SDD folder CODEREVIEW-decisions.md)
- All 31 codebase-review decisions (doc: docs/reviews/2026-09-codebase-review.md on feat). Notables: @kiko/* aliases;
  public URLs to .env; remove APP_LOCK_ENABLED; stop exporting dbKeyHex; migrate dedup keys; repos return Money;
  bond funding window +/-7 days; Sync/Change bank secondaryTonal, red ghost Cancel everywhere; About into content only
  if no scroll; seed date comment stays (exception).
- New code rules (to skills via scribe in session 4's queued refactor): one component per file (small local
  non-exported allowed); comments explain WHY only, no task/review/spec ids; nullable-map ternary BANNED -> fnts/maybe;
  fnts FIRST; ts-pattern exhaustive for branching on kind/type; readability+consistency, no line limits; casing by role;
  full stops by role; tabs only when fields change (tx type stays select = exception; Top/Manual tabs no glyphs);
  capabilities visible (increase.indent on all banks; no receipt icon on mapping-only banks).
- No hotfix for other build-25 bugs (import balance etc. ship via feat). Rates UAH star YES; no purity migration.
- Strings: everything up to T28 + F1/F3/F4-part-1 approved EXCEPT what session 4 sends next (F4 keys table).

### Harness / infra state
- main d0e91de: kill-guard PreToolUse hook (blocks pkill/killall/pattern kills) + CLAUDE.md line; researcher agent;
  skill drift rule. next == main. Sessions need /reload-plugins to get the hook.
- Generic harness repo ~/Developer/Projects/harness pushed to GitHub (c950940, 2026-09-27 sync: kill-guard, dispatcher, pre-write guard engine, opt-in style checkers, 30-file mutation cap, process lessons; plugin 1.1.0; npm test 404/404). Before: (66045b1). Next sync later: one-component,
  comment rule, fnts/ts-pattern ideas, kill-guard.
- ~/.claude/settings.json: allow git push; force pushes ask.
- device-deploy = ~/orca/workspaces/pff-ios/device-deploy (detached install checkout, NEVER prune). Phone has build
  26 candidate c71aa7c (clean reinstall).
- Context watcher: scratchpad ctxwatch.sh per orchestrator terminal (hand over at 70%); sessions cannot see gauges.

## ⭐⭐⭐⭐⭐ LATEST (2026-09-23) — next merged into main; shares/assets research started
- `next` (build 25, submitted to App Store) merged into `main` as `58fc479`. Conflicts only in CLAUDE.md +
  reviewer.md: kept main's model/effort (reviewer opus/high, qa/designer medium, explorer low) + next's
  kiko-compliance reviewer text. `check:all` GREEN on main. `next` fast-forwarded to `58fc479` (now == main).
- Research track `shares-assets-research` (orca worktree off next, opus orchestrator session): feasibility of
  shares (how Ukrainians buy them, valuation, price sources) + a generic "asset" account type and its name (en/uk).
  Deliverable: docs/research/shares-and-assets-feasibility.md, committed on that branch; reports to coordinator
  pff-ios-9b by SendMessage. No app code in this track.
- DONE: research committed `ddad8ee` on shares-assets-research (NOT merged). MVP = manual share holding, OVDP
  prefill + metals via NBU (no new host), "Property / Майно" kind. Awaiting user answers to section 6 (7 questions).
- User answered (Property/Майно yes; value = price-series like rates; shares auto-priced; metals own type; debts in
  scope; all brokers; BYOK ok; + Bond ISIN/Manual chip; + Diia/non-bank institutions). ROUND 2 design spec committed
  `58acf9a` (phases P1-P9, section 10). Awaiting user answers to section 11 (8 questions); then planning.
- Section 11 answered (ISIN+qty; metals under banks that sell them; EODHD only; no cash leg; interest-only spend;
  "Debt/Борг"; ship ALL phases together; add 4 banks + research their statement exports). Session now writing the
  implementation plan via kiko:planner; user reviews the plan before implementation.
- PLAN committed `f700a73`: docs/plans/shares-property-metals-debts.md, 47 tasks T1-T47, P1-P10, one branch
  feat/assets-debts off next. Gated: T36 IBKR sync, T40/41 Freedom24, T42/43 Revolut. Awaiting user plan review +
  7 questions (Monobank metals, PUMB synthetic fixture, ProCredit xls, manual loan link, IBKR XML parser, 4 banks
  caption, EODHD licence). Implementation NOT started.
- Plan answers: Monobank no metals; PUMB synthetic GO; ProCredit .xls YES (new parser dep approved if safe);
  auto-link loan payments? (evaluating); XML package if safe; retry format search for 4 banks; EODHD BYOK = same
  model as Monobank/Binance (closed). Session doing ROUND 4 plan update.
- Pruned 2026-09-23: review-5-6-fixes (worktree+branch), currency-fix (branch) — both merged. Kept duo-adaptive,
  ipad-adaptive, bank-providers (unmerged work), gh-pages, next. PM pff-ios-89 updated by message.
- ROUND 4 plan committed `48f8615`: 50 tasks. saxen 11.1.1 approved as direct dep (IBKR XML); ProCredit .xls =
  hand-rolled OLE2/BIFF reader (T49/T50); loan auto-link FEASIBLE (T48); no new bank formats. Awaiting user: plan
  approval + xls fixture writer (LibreOffice cask vs xlwt venv).
- ROUND 5 scope cut (user): no integration without a real sample/account; user has ONLY Monobank, no brokers.
  Keep existing importers; drop T44/T49/T50 (synthetic fixtures) + all broker sync/import T32-T43 + saxen. Brokers =
  manual shares + EODHD BYOK. NEW: generic column-mapping import (CSV/XLSX) built FIRST as a POC for device test.
  Implementation APPROVED on feat/assets-debts in the shares-assets-research worktree; session stops after the POC
  and messages coordinator for a device deploy (ops).
- Round 5 plan `b82abf5`: 44 tasks. P0 generic import POC T1-T9 (migration 0034 settings.statementMappings),
  P1 T10-16, P2 T17-21, P3 T22-25, P4 T26-33, P5 T34-41, wrap-up T42-44. Implementing on feat/assets-debts (P0 first).
  Device test: import into a separate "Import test" account (a Monobank CSV into the synced holding duplicates rows).
- P0 DONE `3fca697` (make verify green). User approved i18n with 2 uk fixes (Розділювач); session commits the fix
  after T16; coordinator cherry-picks it onto the detached deploy checkout ~/orca/workspaces/pff-ios/device-deploy
  (npm ci + pod install done by ops) then ops deploys. Session continues P1 on feat/assets-debts.
- uk fix `0116aed` cherry-picked onto device-deploy as `bb9845c`; ops deploying P0 to iPhone. P1 DONE `50291cc`
  (gate PASS, jest 299/3424); P1 i18n keys await user review. Session on P2 (metals).
- P0 DEPLOYED to iPhone 2026-09-23 (bb9845c, Release-AdHoc, container 11300148-...; bundle verified: "Map columns
  manually" + Розділювач present, Роздільник absent). User runs the T9 device checklist.
- NEW track skill-gap-analysis (orca worktree off main, analysis only) -> docs/harness/skill-gap-analysis.md. DONE `2a1ad58` (25 findings); user approved the 3 skill items: feat session
  creates kiko-pricing/kiko-statement-import (#7,#8,#12,#25); skill-gap-analysis session
  fixes the rest on its branch (incl. NEW researcher agent, drift-per-iteration rule in harness-workflow).
  STANDING RULE: retrospect+scribe drift pass after every completed phase, sha in the report.
  main: bef3f45 CLAUDE.md "Skill drift rule" (user-approved); a5021be merge of skill-gap a932fef (drift rule in
  harness-workflow/retrospect + HIGH drift fixes); gate GREEN; next ff to a5021be. feat merges main at next phase
  boundary. App Group entitlement removal = USER decision (needs new provisioning profile).
  P1 strings APPROVED as-is except uk: subtitle "...позики", loanGiven "Позика". P0 reinstalled clean on iPhone.
  feat: 294165e P1 uk strings; 074957f merge main (a5021be); T17 1b0e589 (metals kind). Session needs
  /reload-plugins (user) for new agent defs.
  USER P0 DEVICE FEEDBACK sent to feat session as a P0 fix round before T18 (13 items: preview footer/holding
  select/deposit table; map-columns spacing/table widths/small chips/dividers/result table+example/required marks/
  blue header row; NET WORTH clamps negative to 0 -> debugger, check if on main). Then deploy branch tip.
  T17 metals i18n keys APPROVED by user.
  main 924f97b: skill-gap final 27cece4 merged (c73947a) + researcher in CLAUDE.md; gate green; next ff; skill-gap
  worktree+branch pruned. feat to merge main after F1 round (FieldTrigger move, snapshot invariant). Net-worth clamp:
  debugger found NO clamp in code (pie drops <=0 accounts by design); asked user for screen+numbers. T18 keys await review.
  PRODUCTION BUG (build 25): statement import never updates holdings.balanceMinorUnits -> imported-only holding
  value stays at opening balance (Home total 0). User: fix rule B (add net of new rows; use statement closing balance
  when present and not older than newest tx); NO hotfix build (build 25 stays in review). Feat session makes a
  main-compatible commit; coordinator cherry-picks it onto main for the next release. T18 keys approved.
  Fix track: worktree ~/orca/workspaces/pff-ios/import-balance-fix, branch fix/import-balance off main 924f97b
  (commit A, main-compatible) -> coordinator merges to main; feat merges it + commit B (optional Balance column).
  F1 UI round done (bcb8440, 0d2ae76, 7f537a2, 21d53cc); merge main f3bfd24+ec907e0; verify green 306/3494. Bank-picker
  fix in progress (edit form has no identity picker; also on main, accepted). Main-only: b7790cf hides Import for
  bank-less accounts; keep BRANCH behavior at merge. F1 drift pass requested. F1 keys + table choice APPROVED; deploy tip after bank fix + drift.
  Import-balance commit A 9fb54b7 on fix/import-balance (verify green 274/3204); reviewer pass requested BEFORE merge
  to main + into feat. Rule: Monobank CSV closing balance used (only format with one); synced holding balance never
  changed; no extra ledger row. User AGREED to (a) closing balance for a new holding and (b) no extra ledger row.
  DEPLOYED 6c05b0d (= 2210980 + noBank "Free"/"Довільний", branch fix/nobank-label) to iPhone as an upgrade (data
  kept), from ~/orca/workspaces/pff-ios/device-deploy. User ruled I2 YES (history rule + typed-balance date anchor), I3 NO
  migration (1.0.0 unpublished). fix/import-balance review follow-up 006b4f4; rulings being applied, then re-review.
  F2 device feedback (16 items: Connect label, holding select create/icon, tx card example, map-columns nav bug,
  5 cols, bold row, segmented tabs, counterparty question, pass holding + required, headers/spacing, import modal,
  net worth 0 = import-balance bug) sent to feat session after T19. Debug: bug2 no id return, bug6 picker URI re-read
  (fix keepLocalCopy), all net-worth surfaces read balance (covered by fix). Counterparty = option (b): keep mapping +
  show comment on transaction detail.
  ORCHESTRATOR SWAP 2026-09-24: old feat session (context full) closed; NEW session in terminal feat-assets-debts-2
  (same worktree) from .superpowers/sdd/shares-property-metals-debts/HANDOFF-orchestrator.md. feat tip 1f43b0d (P2
  code-complete, T20 9b83d36, T21 1f43b0d). fix/import-balance 0e445ff "approve with minors" (N1,N3); R1 needs user.
  T20 metal keys await user review. P2 DONE: drift cf169ae (feat tip). User: NO test data pack / NO mock APIs
  (tests every form by hand). R1 = (b) (import-only holding counts every new row). T20 keys approved except uk
  metalFormBankAccount -> user chose "Металевий рахунок" / "Metal account" (researcher-sourced); all T20 keys approved.
  OVERNIGHT 2026-09-24: user away until ~09:30; NO device installs before then. feat session continues all phases,
  collects i18n keys + "DEFAULT, pending user" decisions for morning review. fix/import-balance R1(b) a7fdf96 adds
  migration (closingBalanceAppliedAt) that clashes with feat 0034/0035 (count-based runner) -> DEFAULT: NOT merged to
  main alone; lands via feat as 0036. FINAL 31fadc5 (APPROVE; column holdings.balanceSetAt + backfill;
  defaults D-I1 sync rows are a boundary, D-I2 only create/edit/closing stamp balanceSetAt). Restore of build-25
  backups must backfill too (task added on feat). 0ec3e73 = Metal account string.
  feat 8136095: import-balance merged (0036), commit B Balance column, restore backfill, drift. F3 part 1 37edcdd
  (verify 3617), part 2 (designer) running. Morning keys so far: balanceColumn, transaction.comment, importResultTitle.
  F3 DONE feat 6c7ac97 (verify 314/3671). Shared TransactionCard + SegmentedControl. 6c7ac97 also changed harness
  (harness-workflow: DEFAULT pending user applied now; qa.md) -> show user in morning. F3 keys + defaults in session
  overnight-list.md. Next P3. SWAP 2: session 2 handed over at 30% (clean boundary); SESSION 3 = terminal
  feat-assets-debts-3 (term_4c0077aa...), watcher ctxwatch.sh at 70%.
  Session 3: P3 T22-T24 done, T25 ISIN mode in re-review; P4 T26 done, T27 running; tip 5513ccf; migration 0037
  bond_register. Resolved by Round A task 13/13 (6fe86bf4, 7c1ae560, 3397f9b1): no-op per-test TZ flips removed; kiko-no-process-env-time-zone-in-test is ERROR.
  Review notes must name a live ISIN (e.g. UA4000234215). No archive before T27+T28.
  P3 DONE (drift 4a5c77e; also touched harness developer.md/qa.md). verify green 322/3825 at 020585e. 18 P3 keys +
  defaults in overnight-list.md.
  MORNING 2026-09-24: user approved ALL keys up to T28; NEW rule: title/sentence case aligned app-wide (session measures,
  proposes rule for user, then one commit + invariant/translator rule, before T29). CASE RULE approved: titles Title Case; buttons/chips/menus/captions/errors + field labels
  (C1) sentence case; uk sentence case. FULL-STOP rule accepted (A none: titles/buttons/chips/labels/placeholders/empty/alert titles/progress;
  B always: descriptions/hints/errors/alert bodies). Mapping icon increase.indent on ALL banks. F4 + UX CONSISTENCY AUDIT requested (user: new inventions + repeated old mistakes): reviewer audit vs
  kiko-design-system + memory UX files, fix app-wide, scribe distills. Next install only after F4 is done. rawPreview keeps Title Case.
  CASE DONE (drift 34de00d). T29 fix round 0a21fe4 in re-review. MAIN BUG: addManyDedup unchunked (import >=2980
  rows, sync >=2731; first connect safe = 31 days) -> USER: no hotfix, ships in next release via feat. DO NOT DEPLOY f5eb1ec..74e503d: T29 restore "too many SQL variables" (>=1821 tx). Debugger checking MAIN for
  the same limit. T28 done 8330697; CASE track 706c760+94ae8ae+74e503d in re-review. DEPLOYED 9a21555 (upgrade, data kept; phone was locked, app not auto-launched). Context watcher at 70% running (bg script ctxwatch.sh).
  HARNESS SYNC: generic repo ~/Developer/Projects/harness (github drizzer14/harness, last d8fd578 2026-09-18) added
  to Orca; worktree ~/orca/workspaces/harness/harness-sync, session ports generic changes since then; NO push —
  coordinator reviews + pushes. DONE: 10 commits 322af28..66045b1, harness main ff
  locally (ahead 10), PUSHED to github (d8fd578..66045b1) after user permission;
  harness-sync worktree pruned. ~/.claude/settings.json: allow git push, ask for force pushes. Memory UX rule list to be replaced by a skill pointer after F4 scribe lands.
  NEW USER RULE: max ONE component per file (exception: small local non-exported component). Queued for session 4
  after F4: scribe -> kiko-code-style, explorer measures violations (user sees list first), developer splits,
  mechanize (Semgrep/Jest). Also a candidate for the next harness repo sync.
  First targets (user-named): holding-form.screen.tsx (2323 lines, 2 components, ~20 per-type helpers) and
  holding-detail.screen.test.tsx (1380 lines, inline mocks). NO line/size rule (user: "lines are irrelevant; readability
  and consistency"); explorer reports multi-component files, mixed responsibilities, inconsistent sibling structure.
  COMMENT RULE approved: why-only comments, no task/review/spec ids or history in code; mechanized check; whole-src
  comment cleanup with the refactor (baseline 20% comment lines).
  BANNED nullable-map ternary (9 in src) -> fnts/maybe foldMap + Semgrep rule. fnts FIRST (only 11 files use it: 9
  guard, 2 either) -> skill rewrite + explorer list of hand-rolled equivalents; queued for session 4.
  ts-pattern: library used (19 files), rule prescriptive, but new code drifted: kind/type === literal 18 (next) -> 49
  (22 in holding-form). Queued: convert branching to match().exhaustive(); 4 legacy switches = user decision.
  WHOLE-CODEBASE REVIEW: worktree codebase-review (branch off feat 35e0ce4), session in terminal term_04c485df...,
  read-only reviewers/auditors per area vs skills + recent user rules + memory feedback; deliverable
  docs/reviews/2026-09-codebase-review.md; fixes AFTER the feat refactor. Watcher at 70%.
  SWAP 3 -> SESSION 4 (terminal feat-assets-debts-4, term_1fd1d997...). F4 part 1 done 7da7464 (verify 3955);
  next: review part 1, T30 fixes, F4 part 2, then deployable sha; then queued refactor, T31-T33, P5, wrap-up.
  REVIEW EARLY ALERT: probable prod bug rates.repo upsertMany unchunked (buildPairs 110x110 -> ~60k params > 32766);
  session 4 verifies (live monobank /bank/currency count + debugger) before fixing. Also high: Face ID sheet strings
  hardcoded English (biometrics.ts:130); secrets export includes SQLCipher dbKeyHex w/o disclosure; REPLACE import
  leaves old Keychain secrets. User to decide on these.
  INCIDENT: review subagent ran pkill -f "cat" (Orca helpers/simulator restarted; no repo damage). User approved:
  PreToolUse hook blocking pkill/killall/pattern kills + rule text -> worktree no-pattern-kill (off main), session
  term_2cad637a...; coordinator merges to main, then feat.
  REVIEW DONE c3a61df (1,196 rows, 38 bugs). User decided 26 of 31 (sent to session 4; doc to be merged into feat).
  Then 6 leave comment, 7 repos return Money, 20 my button recs, 21 About to content only if no scroll, 26 +/-7d. RATES BUG CONFIRMED (normal Monobank refresh always fails; only NBU fallback
  writes). User: hotfix build 26 YES (running), UAH star YES (feat, after merging build 26),
  no purity migration.
  BUILD 26 HOTFIX (user-ordered): worktree hotfix-build-26 off main 924f97b, session term_1bcf56a3...: ONLY the
  chunked rate write (same helper name/path as feat chunkForTable), TDD, verify, review -> coordinator device-deploys
  for user check -> bump 25->26 -> ops archive; no tag until published.
  KILL-GUARD merged to main (ca2c3c0 + CLAUDE.md d0e91de), gate green, next ff, worktree pruned; sessions need
  /reload-plugins. BUILD 26 app code final 61af350 (drift b99c450); user: device test = CLEAN REINSTALL, addManyDedup
  fix INCLUDED in build 26 (session implementing).
  PRUNED 2026-09-24: worktrees codebase-review, import-balance-fix, nobank-label (+ branches; all contained in feat);
  branch shares-assets-research. Kept: device-deploy (deploy checkout), hotfix-build-26 (active), duo/ipad-adaptive (user: KEEP,
  do not ask again), bank-providers (unmerged), gh-pages, next.
  DEVICE-DEPLOY checkout = ~/orca/workspaces/pff-ios/device-deploy (renamed from p0-deploy 2026-09-24): detached, NOT
  stale, has node_modules + Pods + build cache; move HEAD to the commit to install; next ops build there must be clean.
  BUILD 26 final code c71aa7c (APPROVE; rates + addManyDedup chunking); DEPLOYED clean reinstall c71aa7c 18:00 (phone locked,
  not auto-launched); waiting for user device OK -> bump 26 -> archive.
  Merge notes vs feat: transactions.repo.ts (port chunked category-override lookup into insertDedupRowsTx),
  chunk-for-table.ts doc, kiko-architecture section rename. Follow-ups a/b for feat.
  Session 4: T30 DONE b3a030a (verify 329/3987); review doc merged 4aed3ac; F4 part 1 fix round 2 running.
  F4 part 2 reviewed (fix round queued). User: tx type stays select (exception); Top/Manual tabs no glyphs, smaller
  labels; drop receipt icon on mapping-only banks.
  P1 i18n fixes NOT approved (my misread; cancel sent to feat session) — P1 strings still await user review.

## ⭐⭐⭐⭐ LATEST (2026-09-22, after build 25) — harness agent models + effort re-tuned
Commit `db700db` on `main` (NOT on `next`): planner + reviewer moved to `opus` (Opus 5.5 alias); per-agent
`effort:` now lives in each `harness/kiko/agents/*.md` FRONTMATTER, so the Agent tool applies it on dispatch
(before, effort was only an HTML comment = applied only to standalone `claude --agent --effort` sessions).
Table (model/effort): developer sonnet/high, debugger sonnet/high, reviewer OPUS/high, planner OPUS/medium,
qa sonnet/medium (was high), designer sonnet/medium (was high), retrospect sonnet/medium, auditor sonnet/medium,
explorer sonnet/low (was medium), pm sonnet/low (was medium), scribe sonnet/low, ops haiku/low. CLAUDE.md table
updated to match; `check:all` GREEN (scribe run). User ran `/reload-plugins` after the commit. Memory
[[kiko-harness-design]] updated.
NOTE: `next` does not have `db700db`. A worktree based on `next` runs the OLD agent defs until main is merged
into it (or next->main lands) — see [[harness-changes-need-track-merge-reload]].
NOTHING ELSE CHANGED. Build 25 state below is still current: the user still has to upload the build-25 ipa via
Transporter. Deferred items (deploy-device.sh launch-grep bug, createSingleFlight extraction, whole-branch
reviewer pass 11->25, stale ipa/archive cleanup) are still open and not started.


## ⭐⭐⭐ CURRENT STATE — BUILD 25 ARCHIVED + VERIFIED, device-LGTM, ready for resubmission (2026-09-22, latest)
BUILD 25 is the submittable build: the currency-conversion fix (bundled seed so non-UAH holdings are valued
immediately/offline) PLUS the NBU live-rate fallback (live rates now load on the device without the pinned Monobank
host). BOTH device-VERIFIED by the user (LGTM: holdings counted; USD value shifted off the ~44.6 seed to the live
NBU rate). ARCHIVE DONE + coordinator-RE-VERIFIED: `~/Library/Developer/Xcode/Archives/2026-09-22/Kiko-1.0.0-25.xcarchive`
(263M, Organizer) + `~/Desktop/Kiko-1.0.0-build25.ipa` (21M). Coordinator independently confirmed CFBundleVersion=25,
MARKETING_VERSION=1.0.0, DTXcodeBuild=27A266a (non-beta), UIDeviceFamily=[1], App Group new-present/old-absent,
5.6 grep 0/0/0 in main.jsbundle AND the binary. ops confirmed the valid Apple Distribution cert (2E0A4B9D…),
KikoDistribution profile, get-task-allow=false. NO git tag (two-phase — tag only after the App Store PUBLISHES).
Build 25 was ARCHIVED from `cc2de6d`; two docs-only commits sit on top now (`e4b4360` kiko-architecture Price-data
fold, `4fdedc5` kiko-domain net-worth fix) — the archived binary is unaffected. `next` HEAD = `4fdedc5`.
REMAINING = USER-SIDE: upload `~/Desktop/Kiko-1.0.0-build25.ipa` via Transporter (NOT the Organizer — Xcode 27
quirk); reuse the build-agnostic resubmission-kit Notes + reply + reviewer kit (update any shown build ref to 25).
AFTER the App Store PUBLISHES: v1.0.0 tag + gh release + next->main merge (release skill Part A).
FIX COMMITS on `next`: `b82a96f` (fiat seed fallback) + `0cc61a2` (NBU live fallback) + the earlier `83821bf`
(manual-only pull-to-refresh rate refresh) + `fdc8895` (4 bug-hunt hardening fixes: C1 use-sync, C2 sensebank, P1
zero-rate, P2 binance single-flight). Build-number bumps: 23=c643399, 24=df50b31, 25=cc2de6d.
SUPERSEDED BUILDS: build 23 archive+ipa DELETED. Build 24 archive+ipa (`~/Desktop/Kiko-1.0.0-build24.ipa`, seed-only,
no NBU) still on disk — a valid fallback but build 25 supersedes it; delete after 25 submits if desired. Older stale
desktop ipas (13/20/22) + the build-22 archive remain — offered cleanup, user has not decided.
DEFERRED (non-urgent): the createSingleFlight helper extraction (bug-hunt P2 dup vs `src/crypto-sync/sync/sync.ts`);
`scripts/deploy-device.sh` launch-success grep false exit-1 (ops re-ran the launch to work around it) — small harness
bug worth fixing; a whole-branch kiko:reviewer pass of the build 11->25 commits before the eventual next->main merge.
LESSON persisted: [[device-verify-before-build-network-behavior]] — I archived build 23 on a Jest-green assumption
and its fix was the wrong layer; network/device behavior must be device-verified BEFORE archiving. From build 24 on
I device-verified first, which is why 24 and 25 were right.
RETROSPECT DONE (kiko:retrospect `a54c081682571e0e0`): coordinator persisted 3 memory changes — new
[[device-install-wifi-ddi-mount-flaky]] (WiFi DDI-mount error 12040/12044 ≠ build failure; USB or retry);
strengthened [[clean-iosbuild-needs-pod-install]] (order the `ios/build` clean BEFORE `pod install` in any archive
BRIEF — my brief had it backwards twice); strengthened [[device-verify-before-build-network-behavior]] (token-vs-
network diagnostic tip). ONE real skill drift found + FIXED by kiko:scribe (commit `4fdedc5` on next):
`.claude/skills/kiko-domain/SKILL.md` "Net worth" said a missing-rate currency is dropped "e.g. BTC" — was stale;
with the fiat seed the silent-drop case is CRYPTO ONLY; scribe repointed it at kiko-architecture "Price data".
All other skill code-refs verified accurate. RETROSPECT COMPLETE. `next` HEAD = `4fdedc5`.

_(superseded — build 24 is the seed-only fallback build, still archived + device-LGTM:)_
## ⭐ BUILD 24 ARCHIVED + VERIFIED, device-LGTM (2026-09-22)
On top of the device-verified seed fix (build 24), added a LIVE-RATE fallback so rates are not frozen at the seed
snapshot on the user's device. `refreshRates` now tries the pinned Monobank fetch first (existing retry) and, on
failure, fetches CURRENT official rates from NBU (`bank.gov.ua`, already UNPINNED — `src/rates/nbu-rates/`, modeled
on `src/rates/nbu-history/`). Monobank stays preferred; only one fiat source's rows per run; both-fail writes
nothing (seed still covers offline). NBU covers 40 of the app's currencies; the seed covers the rest. Crypto + the
Monobank pinning unchanged. kiko:developer + kiko:reviewer clean; `make verify` GREEN (272 suites/3179 tests).
Commit `0cc61a2` (NBU fallback) on `next`; build-25 bump `cc2de6d` (24->25, all 3 configs). `next` HEAD = cc2de6d.
BUILD 25 INSTALLED + LAUNCHED on the device (`Dmytro's iPhone`, CFBundleVersion=25, embedded bundle). AWAITING the
user's on-device confirmation that a non-UAH holding's value shifts off the seed rate (~44.6/USD) to the current
NBU official rate — proving live rates now load without Monobank. NO ARCHIVE of 25 yet (device-verify first).
IF THE USER CONFIRMS: coordinator archives build 25 (same known-good recipe as build 24) and it becomes the
submittable build; then the scribe folds the NBU fallback into the kiko-architecture "Price data" section + the
foundation-design spec (FLAGGED DRIFT — not yet done). IF NOT (value stays at the seed): NBU is not loading on the
device either — capture the on-device fetch error for bank.gov.ua and dig further.
BUILD 24 = the seed-only counting fix, ARCHIVED + device-LGTM + coordinator-verified, ipa on Desktop
(`~/Desktop/Kiko-1.0.0-build24.ipa`), READY as a fallback if the user wants to submit the counting fix without
waiting for the live-rate work. Build 23 archive + ipa DELETED (superseded). Older stale desktop ipas (13/20/22)
+ the build-22 archive remain — offered cleanup, user has not decided.
DEFERRED (non-urgent): the createSingleFlight helper extraction; `scripts/deploy-device.sh` launch-success grep
reports a false exit-1 (ops worked around it by re-running the launch) — small harness bug; the skill-drift fold
above.

_(superseded by build 25's device test — build 24 stays archived + ready as the fallback build:)_
## ⭐ BUILD 24 ARCHIVED + VERIFIED, device-LGTM (2026-09-22)
The real currency-conversion fix is committed on `next`, device-VERIFIED (user LGTM: a non-UAH holding is now
counted in net worth + account value on build 24, `Dmytro's iPhone`), and ARCHIVED. This time device-verify came
BEFORE the archive.
ARCHIVE DONE + coordinator-RE-VERIFIED: `~/Library/Developer/Xcode/Archives/2026-09-22/Kiko-1.0.0-24.xcarchive`
(264M, Organizer) + `~/Desktop/Kiko-1.0.0-build24.ipa` (21M). Coordinator independently confirmed CFBundleVersion=24,
MARKETING_VERSION=1.0.0, DTXcodeBuild=27A266a (non-beta), UIDeviceFamily=[1], App Group new-present/old-absent,
5.6 grep 0/0/0 in main.jsbundle AND the binary. ops also confirmed the valid Apple Distribution cert (2E0A4B9D…,
not the revoked twin), KikoDistribution profile, get-task-allow=false. NO git tag (two-phase rule — tag only after
the App Store PUBLISHES). `next` HEAD = `df50b31`.
REMAINING = USER-SIDE: upload `~/Desktop/Kiko-1.0.0-build24.ipa` via Transporter (NOT the Organizer — Xcode 27
quirk); the resubmission-kit Notes + reply + reviewer kit are build-number-agnostic (update any shown "build 22/23"
ref to 24). AFTER the App Store PUBLISHES: v1.0.0 tag + gh release + next->main merge (release skill Part A).
Superseded build-23 archive/.ipa still on disk — DELETE them (do not submit build 23).
TRUE ROOT CAUSE (recap): `currency_rates` is empty until a live Monobank `/bank/currency` fetch persists a row;
on the user's device that fetch NEVER persists (candidate: ATS cert pinning `ios/Kiko/Info.plist:56-71` on
api.monobank.ua — per-host, so it also blocks the public tokenless currency fetch; the token being blocked is
IRRELEVANT — the currency endpoint needs no token). A non-UAH holding with no `<cur>:UAH` row was SILENTLY dropped
from net worth AND account value.
THE FIX (kiko:developer, reviewer-clean, make verify green 271 suites/3171 tests; commit `b82a96f` on `next`):
a bundled static fiat rate seed `src/rates/fiat-rate-seed/fiat-rate-seed.ts` (ALL 107 fiat currencies vs UAH,
captured 2026-09-22, composed via the SAME `buildPairs` the live path uses) wired as a FALLBACK in
`buildRateTable` (`net-worth-view.ts`): `{ ...FIAT_RATE_SEED_TABLE, ...rateTableFromRows(liveRows) }` — live rows
win per pair, seed fills gaps, no DB write. So a non-UAH holding is valued IMMEDIATELY on creation, offline, no
token. Plus a bounded live-fetch retry (respects the 5-min throttle). Crypto stays a separate live-only path
(unseeded). SIDE EFFECT (accepted by the user): the transaction "Convert to Exchange" form now auto-prefills an
approximate counterpart from the seed. Build-24 bump commit `df50b31` on `next` (23->24, all 3 configs).
IF THE USER CONFIRMS ON DEVICE: coordinator archives build 24 (recipe: pod install AFTER any ios/build clean;
two-phase build-then-archive on ONE derivedDataPath; non-beta Xcode 27A266a; verify 7 invariants + 5.6 grep 0/0/0
+ DTXcodeBuild), ipa to Desktop, then USER submits via Transporter with the build-agnostic resubmission-kit.
IF NOT: keep digging ON DEVICE (capture the on-device NSURLSession error for /bank/currency; assess relaxing/
fixing the api.monobank.ua pinning, or sourcing live fiat rates from the already-UNPINNED NBU host bank.gov.ua —
`src/rates/nbu-history/` already fetches it for history).
DEFERRED (non-urgent): the createSingleFlight helper extraction (from the earlier bug-hunt P2); a live-fiat-rate
source that does not depend on the pinned Monobank host (NBU is the candidate) so device rates are not stuck at the
seed snapshot long-term; the stale PostToolUse Biome hook (main-repo biome.json) still misfires on worktree edits.
LESSON (own it): I archived build 23 on a Jest-green assumption WITHOUT device verification, and its fix was the
wrong layer — the bug was never the pull-to-refresh gating, it was the empty rate table + silent drop. Verify
currency/network behavior ON THE DEVICE before any build. [[fix-divergent-twins]] did not apply here; the real
lesson is device-verify-before-build.

_(superseded — build 23 was archived + invariant-verified, but it does NOT fix the bug; DO NOT SUBMIT build 23:)_
## ⛔ BUILD 23 IS NOT A VALID FIX; DO NOT SUBMIT IT (2026-09-22)
User tested build 23 ON DEVICE: a non-UAH holding is STILL never counted in net worth OR account value. Expected:
counted RIGHT AFTER holding creation (pull-to-refresh must be irrelevant). The build-23 fix (83821bf/fdc8895 +
the c643399 bump) targeted the WRONG layer.
TRUE ROOT CAUSE (kiko:debugger opus `aeed20d6580aff283`, proven by running the real refreshRates->buildRateTable->
guardedNetWorth chain in Jest): a non-UAH holding is counted ONLY if `currency_rates` holds a `<cur>:UAH` row. On
the device that table is EMPTY. `canConvert` (`src/rates/net-worth-view/net-worth-view.ts:33-40`) short-circuits
true for `currency === base` (UAH always counts) but needs `rates['USD:UAH']` for a non-UAH currency; missing ->
`guardedNetWorth`/`guardedBreakdown` (:43-75) SILENTLY drop it from the total AND per-account value
(accounts.screen.tsx:139, account-detail.screen.tsx:103, account-contribution.ts:58 all use guardedNetWorth).
Once a rate row exists, BOTH totals recover — NO second aggregation bug. P1's `rate>0` is correct, not the cause.
THE DEFECT: `refreshRates` (`src/rates/rates-refresh/rates-refresh.ts:96-122`) is the SOLE writer of currency_rates
and writes NOTHING unless a live HTTPS fetch to `api.monobank.ua/bank/currency` succeeds (`fetchFiatRates` throws
on any non-OK -> `buildPairs`=[] -> upsertMany skipped). There is NO offline/static seed, NO create-time fetch,
and the failure is never surfaced. refreshRates DOES fetch the full supported set regardless of accounts (verified
against the live feed) — so the table is empty only because the on-device fetch never persists.
WHY THE DEVICE FETCH FAILS (unconfirmed; needs device evidence) — candidates in priority order:
(1) ATS cert pinning `ios/Kiko/Info.plist:54-71` pins api.monobank.ua to two Amazon CA SPKI hashes; a device chain
mismatch kills TLS natively before JS sees it — permanent, device-only, Release-only, fits "never" (BUT the pins
match from the debugger's network today; note: this host is ALSO the Monobank personal-API host, so if pinning
were broken, Monobank SYNC would fail too — a live reachability check splits this). (2) Monobank 429 (transient,
not "never"). (3) stale embedded jsbundle in the .ipa ([[release-build-ships-stale-jsbundle]]).
RECOMMENDED FIX (debugger): (a) a BUNDLED STATIC rate seed for the supported set, loaded at first run / merged in
buildRateTable when a pair is absent, refined by the live fetch — makes a non-UAH holding valued immediately even
offline/429/pinning-broken (this is what actually satisfies "counted right after creation"); (b) STOP silently
dropping unconvertible holdings — surface a "rate unavailable/retrying" state + retry refreshRates on failure. AND
capture the on-device NSURLSession error for /bank/currency to confirm the sub-cause.
STATUS: awaiting user direction (quick device reachability check first, vs go straight to the robust seed+surface
fix). NO new build. Build 23 artifacts still exist on disk but MUST NOT be submitted. Prior fixes 83821bf/fdc8895
are correct-but-irrelevant and can stay on `next`.
COORDINATOR MISS (own it): shipped build 23 on an unverified device assumption; a Jest-green fix is NOT device-proof.
Verify currency/network behavior on the DEVICE before any build. [[no-test-code-in-appstore-build]] class of caution.

_(superseded — build 23 was archived + invariant-verified, but it does NOT fix the bug:)_
## ⭐⭐⭐ CURRENT STATE — BUILD 23 ARCHIVED + VERIFIED, ready for resubmission (2026-09-22, later)
BUILD 23 = the 5 correctness fixes below, archived + verified. Build-number bump 22->23 committed `c643399` on
`next` (all 3 pbxproj configs; MARKETING_VERSION + package.json stay 1.0.0). kiko:ops archived + exported it;
coordinator INDEPENDENTLY re-verified the archived `.app`: CFBundleVersion=23, CFBundleShortVersionString=1.0.0,
DTXcodeBuild=27A266a (NON-beta 27.0 GM), UIDeviceFamily=[1], 5.6 grep SCREENSHOT/seedScreenshotData/screenshot-seed
= 0/0/0 in BOTH main.jsbundle AND the Kiko binary. Signing = the VALID Apple Distribution cert (SHA-1 2E0A4B9D…,
NOT the revoked twin), KikoDistribution profile, App Group group.com.dmytro-vasylkivskyi.kiko present / old
group.com.dmytro.pff absent, get-task-allow=false (ops-verified).
ARTIFACTS: archive `~/Library/Developer/Xcode/Archives/2026-09-22/Kiko-1.0.0-23.xcarchive` (264M, in the
Organizer); ipa `~/Desktop/Kiko-1.0.0-build23.ipa` (21M). NO git tag (two-phase rule — tag only after the App
Store PUBLISHES). `next` HEAD = `c643399`.
BUILD-GOTCHA HIT + RESOLVED: the first archive attempt failed with a misleading `LiquidGlass.modulemap not found`;
real cause was `rm -rf ios/build` wiping the ReactCodegen generated inputs (`ios/build/generated/...`). Fix =
re-run `pod install` AFTER any `ios/build` clean, before xcodebuild — this is memory
[[clean-iosbuild-needs-pod-install]]. The two-phase build-then-archive on one derived-data path was not the actual
fix but is fine practice.
**REMAINING = USER-SIDE:** upload `~/Desktop/Kiko-1.0.0-build23.ipa` via Transporter (NOT the Organizer — Xcode 27
export quirk); the 5.6 Notes + Resolution-Center reply + reviewer kit from `memory/refs/resubmission-kit.md` +
`memory/refs/reviewer-kit/` are build-number-agnostic and still valid (update any "build 22" ref to 23 if shown).
NOTE: these 5 fixes were verified by Jest + the archive invariants only — NOT yet run on a physical device. A
device smoke-test of the currency fix (create a non-UAH holding on a fresh install, no Monobank, pull-to-refresh,
confirm it counts in net worth) is RECOMMENDED before Transporter, at the user's discretion. AFTER the App Store
PUBLISHES: `v1.0.0` git tag + `gh release` + merge `next` -> `main` (release skill Part A).
DEFERRED DEBT (non-urgent): extract a shared `createSingleFlight<K,V>()` helper (P2 duplicates the pattern in
`src/crypto-sync/sync/sync.ts`); the deferred items from the build-22 block below still stand.

_(the 5 fixes that build 23 ships, detail:)_
## ⭐⭐⭐ FIXES IN BUILD 23 — 5 correctness fixes on `next` (2026-09-22)
User reported a resurfaced bug on build 22: on a FRESH INSTALL, a non-UAH holding created BEFORE connecting
Monobank does not get currency conversion (dropped from net worth/totals). kiko:debugger root cause: Home's
pull-to-refresh (`useSyncAll`) early-returned when `jobs.length === 0` (manual-only account list), skipping
`refreshRates()` — so `currency_rates` stayed empty and `canConvert` returned false. The identical bug was fixed
in the sibling `useAutoSync` (commit `c1de228`) but never applied to `useSyncAll`. FIX committed `83821bf` on
`next` (decouple refreshRates from the sync fan-out; mirror useAutoSync); kiko:reviewer clean.
Then USER directed an OPUS bug hunt before any build ("cannot afford another rejection"). kiko:auditor (opus,
read-only) found NO ship-blocker, NO build-breaker; re-confirmed the 5.6 hidden-feature class CLEAN. It found 4
lower-severity items. USER chose "fix all four". kiko:developer fixed all 4 (TDD), kiko:reviewer clean, committed
`fdc8895` on `next`:
- C1 `src/sync/use-sync/use-sync.ts` — a rate-refresh failure no longer reports a successful account sync as
  failed (own `either`, only after sync success; preserves the useCryptoSync "no refresh on failure" contract).
- C2 `src/statement-import/formats/sensebank-csv/sensebank-csv.format.ts` — throw StatementParseError when a row
  has BOTH debit and credit (was silently dropping the credit); mirrors the business-csv guard.
- P1 `src/rates/net-worth-view/net-worth-view.ts` — treat a non-positive/non-finite rate as no rate (`canConvert`
  requires rate > 0; buildRateTable drops non-positive), so a zeroed rate excludes a holding from BOTH the total
  and the breakdown consistently.
- P2 `src/crypto-sync/run-crypto-sync/run-crypto-sync.ts` — a per-account single-flight lock over the whole
  Binance arm (balance + tx import) so an overlapping Connect + pull-to-refresh joins one run (was double-running
  the tx import; idempotent, so wasted requests only).
`make verify` GREEN on committed `next` @ `fdc8895` (270 suites / 3153 tests + full check:all). `next` is now
3 app-commits AHEAD of the archived build-22 binary (`40517b3`): 83821bf + fdc8895 (+ 0993290 skills doc). So
the ARCHIVED build 22 does NOT contain these 5 fixes.
**NO BUILD MADE (user: "No build yet").** Next step is the USER's call: (a) build 23 off `next` to ship these
fixes, or (b) resubmit the existing build-22 archive (without the fixes) and land build 23 later. Await the user.
DEFERRED DEBT (reviewer ponytail, non-urgent): extract a shared `createSingleFlight<K,V>()` helper — P2's
`inFlightBinanceSyncs` duplicates the single-flight pattern in `src/crypto-sync/sync/sync.ts`; not done now to
avoid refactoring stable proven code right before a build (~10-12 lines removable when done).

_(prior current state, still valid — build 22 archive is unchanged:)_
## ⭐⭐⭐ CURRENT STATE — BUILD 22 ARCHIVED (5.6 remediation), ready for resubmission (2026-09-22)
**BUILD 22 READY FOR RESUBMISSION (2026-09-22).** 5.6 remediation. Two independent audits proved the code has
NO hidden features; the likely real trigger is REVIEWABILITY (empty first-run + the reviewer not reaching the
demo). Fixes: (1) two in-app consent disclosures — a Keychain data-handling line at Monobank/Binance credential
entry + a "not a bank / not affiliated" note on the bank picker (en+uk; uk uses Кіко; user reviewed + tweaked
the uk); (2) Privacy Policy updated + PUSHED to gh-pages (`854b31c`) with an independence clause (uk page now
uses Кіко ×15); (3) reviewer NOTES + a Resolution-Center reply rewritten around reviewability →
`memory/refs/review-notes-build21.md` (the pasteable text is build-number-agnostic, still valid; reviewer kit =
`kiko-demo.kiko` + `kiko-demo-key.txt`, key fIjWEQ…).
BUILD 22 on `next` @ `40517b3` (ff'd `review-5-6-fixes`; bumped CURRENT_PROJECT_VERSION 20→21→22 ×3;
MARKETING_VERSION + package.json stay 1.0.0). `make verify` GREEN at build 21 (22 is a build-number-only bump).
ARCHIVE DONE + VERIFIED (kiko:ops `a7b4f1d38e3d3cf77`):
`~/Library/Developer/Xcode/Archives/2026-09-22/Kiko-1.0.0-22.xcarchive` + `~/Desktop/Kiko-1.0.0-build22.ipa`
(22M). Two rework reasons captured: the FIRST archive used a BETA Xcode (ASC rejects) → rebuilt with NON-BETA
Xcode 27.0 / 27A266a (DTXcodeBuild=27A266a verified in the archived app); then build 21's number was already
spent on ASC → bumped to 22. 7/7 invariants PASS; 5.6 grep 0/0/0 in .app AND .ipa; both disclosures present in
main.jsbundle; coordinator re-confirmed files + CFBundleVersion=22 + DTXcodeBuild=27A266a; the superseded
build-21 archive + .ipa were deleted.
Reviewed on the iPhone 17 sim (user LGTM). NO git tag (two-phase rule). USER submits `Kiko-1.0.0-build22.ipa`
via Transporter + fills Notes/reply + attaches the reviewer kit. STRATEGY: user plans to appeal AND resubmit
the stronger build 22.
HOUSEKEEPING (coordinator, deferred): Metros bg on 8081 (next/Duo) + 8083 (review-5-6-fixes); worktrees
`review-5-6-fixes` + `gh-pages` prune when done; the Duo track (`duo-adaptive`) is still ON HOLD (Phase 1 done,
not merged); offer to fold review-notes-build21.md into resubmission-kit.md pending.

**RETROSPECT (2026-09-22):** coordinator wrote 5 durable memories — [[appstore-5-6-hidden-features-reviewability]],
[[appstore-no-beta-xcode-and-bump-build]], [[iphone-duo-sidebar-tabbar-geometry]], [[sim-debug-needs-persistent-metro]],
[[kiko-ukrainian-name-cyrillic]] — and COMPACTED MEMORY.md (was 21.7KB, near the read limit → shortened to one line
per entry, stale current-state block dropped). kiko:retrospect (`a90fe25e6ddc02ef5`) DONE. Skill drift was MOSTLY A FALSE ALARM: the retrospect read the FROZEN
`main` checkout's stale `.claude/skills/`, but `next`'s copies were already ahead. kiko:scribe (`a269f3b3a241b7471`,
commit `0993290` on next) fixed only the 2 GENUINE items on next: kiko-design-system entity-colors path, and
kiko-linter dead `ios/KikoWidget` refs (the ~45 other flagged paths do not exist on next; kiko-translator was
already clean). Reviewer-model VERIFIED: opus IS on next (5048c66) + the live plugin cache; `main` shows sonnet
only because it is frozen (resolves at next→main). LESSONS: a drift scan must read the LIVE-line (next) skills,
not frozen-main's stale copies; and the live agents load main's (still-stale) skills until next→main — accepted
interim, do NOT edit frozen main to fix it. DEFERRED (post-publication): a
whole-branch kiko:reviewer pass of the build-11→22 commits; the Semgrep worklet-remote-function rule (kiko-linter
backlog); the 3 circular deps (statistics↔rates↔holdings via barrels) noted in `memory/refs/codegraph-2026-09-21.md`;
HOW-TO-IMPORT.txt still says "build 20"; folding review-notes-build21.md into resubmission-kit.md.

_(the rejection + investigation that led here, historical:)_
**BUILD 20 REJECTED (2026-09-21, Guideline 5.6 — Developer Code of Conduct).** Apple: "a pattern of unusual
behavior commonly associated with fraudulent activity... the app contains features that appear to have been
intentionally hidden during the review process." This is a REPEAT 5.6 (build 7 was 5.6). Coordinator first-pass
grep of build 20's shipping code (next worktree): NO feature-gating env flag (only public API-URL @env vars),
NO gated providers (`bankProviderIds = ['monobank']` only), NO reviewer/sandbox/TestFlight detection, NO
residual SCREENSHOT/KikoTestEnv module — leans toward "no actual hidden feature" (a possible Apple
pattern-match), but the multi-bank catalog / add-bank surface + crypto surfaces need a close look.
kiko:auditor (Opus, `a6777c5ce1900ae64`) DONE — CLEAN, high confidence: ZERO Class-A findings. Every feature is
unconditionally present, reachable, and functional; NO reviewer/sandbox/date/locale/remote gating; build-7's
SHOW_UNREADY flag + screenshot-seed apparatus confirmed GONE. Multi-bank surface is HONEST: monobank connects;
the other 5 banks are labeled "import only" and each has a REAL statement parser (not stubs). So the path is
branch B: Resolution-Center reply (assert no hidden features; explain the removed screenshot-seed apparatus; map
the honest multi-bank + crypto design; offer the reviewer demo .kiko + a walkthrough; ask them to name the
specific feature), then APPEAL if unresolved. NO code change; build 20 binary stands. One pre-emptible Class-B
note for the reply: db-config's `APP_LOCK_ENABLED` / `DB_ENCRYPTION_ENABLED` are hardcoded-true always-on
invariants (no runtime flip), not hidden toggles.
SECOND independent ADVERSARIAL 5.6 audit (kiko:auditor Opus `a598cbce3d6476b4f`) ALSO CLEAN — re-derived from
direct read/grep (did not re-trust the first): exactly 15 screen files = 15 registered screens, all
unconditional; NO env/build/remote/date/locale/first-launch/URL-scheme/launch-arg/gesture gate; multi-bank +
crypto honest (Monobank-only connect registry, deleted-bank folders gone, all 6 parsers real, Binance/BTC live);
native clean (only the standard Metro-vs-embedded `#if DEBUG`). Its words: "the Guideline 5.6 rejection is not
supported by the current code." Text CODEGRAPH written: `memory/refs/codegraph-2026-09-21.md` (nav
reachability map + 25-domain dep graph + 3 real circular-dep cleanup candidates; knip is the authoritative
no-orphan proof, NOT madge). USER IS APPEALING (not resubmitting). Appeal evidence package READY = reachability
map + BOTH clean audits + knip proof + the "prior 5.6 was the now-removed screenshot-seed apparatus" narrative.
NO code change; build 20 binary stands. NEXT: coordinator to draft a paste-ready appeal statement into
resubmission-kit.md when the user confirms. NOTE: build 20 archive + .ipa still exist; no new build yet. main FROZEN; no tag.

_(prior state, now historical:)_
## ⭐⭐⭐ CURRENT STATE — BUILD 20 SUBMITTED, AWAITING APPLE (2026-09-21)
The user SUBMITTED build 20 (1.0.0) for App Store review on 2026-09-21. This is the honest 1.0.0 (Monobank
CONNECT only; other 5 banks import-only; 5.6 screenshot-subsystem purged) PLUS a long on-device fix loop this
run (builds 11-20): `.kiko` import (Hermes has no TextDecoder -> hand-rolled `utf8.ts`,
[[hermes-no-textdecoder-handroll-utf8]]); import success-message language; the currency-sheet keyboard
(background-scroll gating, sheet lift, a Release-only worklet-directive crash + a UIScene/appDelegate.window
crash [[scene-lifecycle-appdelegate-window-crash]], keyboard-corner glass, single-tap select, the missed
Settings consumer); and creating a card holding on a non-synced bank.

- **`next` @ `5048c66`** = build 20 / 1.0.0 app (`f016fd5`) + the retrospect skill-lessons doc commit (`b9d087c`)
  + a harness commit (`5048c66`) setting the kiko:reviewer agent model to Opus 4.8 [1m] (harness/docs only —
  does NOT change the app or the submitted build 20 archive; note the `duo-adaptive` branch was cut from the
  earlier b9d087c, so it does not yet carry `5048c66`). WORKTREE TOPOLOGY CHANGED
  2026-09-21: the old `currency-fix` worktree directory was removed at the orca layer (NO commits lost — the
  `next` and `currency-fix` branches both still point to `b9d087c`); `next` was re-materialized at
  `/Users/drizzer14/orca/workspaces/pff-ios/next` (deps NOT yet installed — needs `npm ci` + `pod install`
  before a build). Pruned stale worktrees `build-1-0-0` + `screenshot-purge`, and merged branches
  `build-round1` / `harness-src` / `screenshot-purge`. KEPT: `bank-providers` branch (1 unmerged commit),
  `ipad-adaptive` worktree + branch (parked, 15 commits). `make verify` was GREEN on the build-20 tree.
- **Archive DONE + VERIFIED:** `~/Library/Developer/Xcode/Archives/2026-09-21/Kiko-1.0.0-20.xcarchive` (Organizer);
  .ipa `~/Desktop/Kiko-1.0.0-build20.ipa`. All 7 invariants PASS; archived + .ipa bundle grep 0/0/0.
- **Resubmission materials:** `memory/refs/resubmission-kit.md` (build 20; section A reply + section B ASC Notes,
  first-person) + `memory/refs/reviewer-kit/` (en demo .kiko + key + HOW-TO-IMPORT). USER uploaded via Transporter.
- **main @ `d27e517`** FROZEN (rejected build 7). Nothing pushed. **NO git tag** (two-phase rule).

**NEXT (coordinator), by Apple's decision:**
- **If Apple PUBLISHES:** `v1.0.0` git tag + `gh release create` + merge `next` -> `main` (release skill Part A;
  the tag waits for PUBLICATION, not approval). Decide the pre-existing icon deletions + untracked Makefile at merge.
- **If Apple REJECTS:** read the reason, route analysis to kiko:debugger / fix, new build, re-archive, resubmit.

## ⏳ NEW ACTIVE TRACK (2026-09-21) — iPhone Duo adaptive layout (parallel to build 20)
User launched build 20 on a NEW iPhone Duo simulator (foldable-class, model iPhone19,4). The iOS 27.1 runtime
the Duo needs was NOT installed; user ran `xcodebuild -downloadPlatform iOS` → I created the Duo sim (UDID
`E862974E-9919-42E2-B689-79502A171D93`, iOS 27.1) and ops built+launched build 20 (Debug+Metro) from the `next`
worktree. NOTE: Metro runs in THIS coordinator session's background (`react-native start` in
/Users/drizzer14/orca/workspaces/pff-ios/next) — the Debug app breaks ("No script URL") if this session ends.
User found 3 layout bugs and directed a NEW BRANCH for full Duo adaptive support.
- ROOT CAUSE (kiko:debugger, category b = native scene, NOT a missing JS layout): the Duo primary panel is
  466x678pt = REGULAR horizontal size class (right safe-area inset 84) → `react-native-bottom-tabs`' SwiftUI
  TabView auto-adopts a RIGHT-EDGE SIDEBAR and misreports its height as 678 (full screen) → poisons
  `resolveBottomClearance` (`bottom-clearance.ts:18`) → ~660pt footer padding covers/mispositions content
  (Settings empty, Accounts add-account at top). FAB (`add-transaction-fab.styles.ts:14`, `right:16`) collides
  with the right sidebar (missing). Header height reports 0 on the active stack. ALL 3 user bugs = this one
  cause; a width-breakpoint system alone would NOT fix it.
- DECISION (user-approved, brainstorming architectural path): 2 phases. Phase 1 CORRECTNESS (robust clearance
  from safe-area insets + ONE sidebar-detection helper both Screen & FAB share + FAB right-inset anchor +
  zero-header floor + Screen horizontal insets; no visual redesign). Phase 2 ADAPTIVE (re-apply the parked
  ipad-adaptive pattern onto next — breakpoints/useIsAtLeastBreakpoint/TwoPaneLayout/content-width-cap — keyed
  off SIZE CLASS not raw width [466pt is regular yet < old sm:500]; retire the SCREENSHOT_MODE code
  ipad-adaptive still carries). PRIMARY PANEL ONLY (Duo has 2 physical panels; spanning = out of scope).
- Branch `duo-adaptive` off `next` @ b9d087c (worktree /Users/drizzer14/orca/workspaces/pff-ios/duo-adaptive).
  Spec committed `41b7315` (docs/superpowers/specs/2026-09-21-iphone-duo-adaptive-layout-design.md), user-approved.
  Phase 1 plan DONE (kiko:planner, commit `aeacc03`, docs/superpowers/plans/2026-09-21-iphone-duo-adaptive-layout-phase1.md;
  6 TDD tasks; sidebar-detection signal = tabBarHeight > 50% of window height OR any nonzero horizontal
  safe-area inset — ALSO fixes landscape iPhone Pro Max/Plus, which iOS reports as regular-width).
  Phase 1 EXECUTION delegated (user directive) to an opus ORCHESTRATOR claude session running IN the
  duo-adaptive worktree (orca terminal title `duo-orchestrator`, handle
  `term_768b7b73-f475-4acf-80fc-daeb04d724c6`), driving kiko:developer + kiko:qa via
  superpowers:subagent-driven-development. It reports back to THIS coordinator (`Continue from handoff [f7d4dc]`)
  on done/blocked. Poll it with: `orca terminal read --terminal term_768b7b73-f475-4acf-80fc-daeb04d724c6 --json`.
  Coordinator still owns: integration to next, whole-branch kiko:reviewer pass, deep gate, device deploy.
  Screenshots on the Duo sim = USER-AUTHORIZED for this track. ipad-adaptive = REFERENCE for Phase 2 (do NOT
  merge — stale base + carries the stripped SCREENSHOT_MODE); retire once its pattern is re-applied.

**RETROSPECT DONE (kiko:retrospect `a9ab65dec726e9307`).** Coordinator wrote 3 new memories:
[[worklet-directive-debug-swallows-release-aborts]], [[prop-drilled-fix-enumerate-all-consumers]],
[[ios-simulator-hardware-keyboard-suppresses-onscreen]]. NOTE: the retrospect's skill-drift findings A/B
("kiko-linter/6 skills don't exist", "agent refs stale") were FALSE — it only searched `harness/kiko/skills/`
(the 5 plugin skills) and missed the 8 domain skills in **`.claude/skills/`** (kiko-architecture/charts/
code-style/design-system/domain/gestures/linter/translator all exist). Agent refs + CLAUDE.md `kiko-linter`
ref are CORRECT — do not "fix" them.
**SCRIBE DONE (kiko:scribe `af192df1d0a79b3b1`, commit `b9d087c` on next):** lessons distilled into next's
skills — kiko-gestures (worklet-directive rule + useAnimatedKeyboard ban), kiko-design-system (BottomSheet
keyboard geometry + `keyboardShouldPersistTaps`), kiko-domain (card/jar creatability by sync; also fixed a
pre-existing stale pointer there), kiko-linter (Semgrep-worklet-rule BACKLOG) + the review-to-biome-inventory.
GOTCHA that cost a retry: `main`'s `.claude/skills/` are STALE (100+ lines behind next's — main frozen at
d27e517), so the FIRST scribe pass edited main's stale copies (commit `c2a4a76`, wrong base). Coordinator RESET
main back to d27e517 (`--mixed` + targeted `git checkout` of the 5 files, HANDOFF.md preserved; c2a4a76
orphaned/reflog-recoverable) and re-ran the scribe on next's copies in the worktree. LESSON: dispatch skill
edits to the WORKTREE's `.claude/skills/` (next), never the frozen main repo's stale copies.
DEFERRED harness task (post-publication, kiko:linter): implement the Semgrep worklet-remote-function rule +
fixtures (documented in the kiko-linter skill backlog).

**DEFERRED cleanup (post-publication, on `next`):** whole-branch kiko:reviewer pass of the currency-fix build
11-20 commits; remove the now-redundant `toFilePath`/file:// strip in `import-data.ts` (RNFS strips file://
internally — dead code); compact `~/.claude/.../memory/MEMORY.md` to < 17.1KB; prune the currency-fix +
stale build-1-0-0/screenshot-purge/ipad-adaptive worktrees per policy.

---
_The detailed build 13 -> 20 blow-by-blow below is HISTORICAL (kept for detail); the durable lessons are in memory._

## ⏳ HISTORICAL — CURRENCY/CARD/CRASH FIX SAGA (builds 13-20, resolved 2026-09-21)

BUG (currency search input in the CurrencyField BottomSheet): tapping it scrolls the background form to the
top; typing makes the whole sheet disappear; dismissing the keyboard restores it; after selecting a currency
the screen stays scrolled out of view.

ROOT CAUSE (debugger `a0658a1bb4bf4bf5c`, confirmed): the app's `BottomSheet` is a HAND-ROLLED RN `Modal`
(NOT @gorhom). CurrencyField's search `TextField` is the ONLY focusable input in the app that lives inside a
sheet. The app's only keyboard-reactive code is `Screen`'s `automaticallyAdjustKeyboardInsets={true}`
(`screen.component.tsx:76`) on the ScrollView hosting the FORM BEHIND the sheet -> focusing the sheet input
scrolls that background ScrollView (symptom 1); the sheet has no keyboard handling (2/3); neither
`handleSelect` nor the sheet `onDismiss` calls `Keyboard.dismiss()` (symptom 4).

BOTH fixes INTEGRATED — build 15 on `next` (`f69021e`), DEPLOYING. Merge `5548b70` combined currency-fix
(`fa8e861`) + card-holding-fix (`e36fa21`) off build 14; merge-tree clean; coordinator re-ran `make verify`
GREEN on the MERGED tree (3128 tests, holding-form.screen.tsx carries both fixes in disjoint regions); ff'd
`next` -> merge -> bumped 14->15 (`f69021e`). card-holding-fix worktree+branch PRUNED (integrated). `next`
lives in worktree `/Users/drizzer14/orca/workspaces/pff-ios/currency-fix` (branch currency-fix @ f69021e).
BUILD 15 CRASHED on cold launch (app-wide) — ROOT CAUSE CONFIRMED + REPRODUCED (debugger `aed8ad1acef60f2cb`
on the sim). reanimated 4.6.0 `useAnimatedKeyboard()` (the build-15 sheet-lift, `bottom-sheet.component.tsx:151`)
-> `REAKeyboardEventObserver.mm:245` calls `[[UIApplication delegate] window]`, but this app owns its window on
SceneDelegate (iOS 27 UIScene lifecycle) -> unrecognized selector -> SIGABRT ~instantly on launch (the shared
BottomSheet is rendered by 16 screens). NOT Modal-specific, NOT the card fix. [[scene-lifecycle-appdelegate-window-crash]],
[[ios27-crash-uiscene-lifecycle-gap]]. FIX (IN FLIGHT, kiko:developer `a1bbf5ad543292a7f`): replace
`useAnimatedKeyboard` with a `useSharedValue` driven by RN core `Keyboard` events (`keyboardWillChangeFrame`/
`keyboardWillHide`, Scene-safe) — KEEPS the sheet-lift; update the reanimated jest mock + the bottom-sheet
keyboard-lift tests; `make verify` + a SIMULATOR launch (udid 81860A3D-...) to confirm no crash. NO build bump
(coordinator bumps 15 -> 16). Builds 13/14/15 all NOT submittable.
CRASH FIXED — build 16 on `next` (`e972cc8`), DEPLOYING. kiko:developer `a1bbf5ad543292a7f` (commit `d85f806`)
replaced `useAnimatedKeyboard` with a `useSharedValue` driven by RN `Keyboard` events (Scene-safe), keeping the
sheet-lift; jest mock + bottom-sheet lift tests updated. Developer VERIFIED on the sim: app launched, alive 68s,
NO new crash `.ips`. Coordinator re-ran `make verify` GREEN (3132 tests), ff'd `next` `f69021e`->`d85f806`,
bumped 15->16 (`e972cc8`), ff'd next. BUILD 16 CRASH — ROOT CAUSE CONFIRMED + REPRODUCED (debugger `aa93db705a757ee1c`, RELEASE build on the iOS 27
sim). It is a RELEASE-vs-DEBUG bug, NOT iOS-27-specific: `resolveKeyboardAwareMaxHeight`
(`bottom-sheet.keyboard.ts:26`) lacks a `'worklet'` directive but is called inside the `useAnimatedStyle`
worklet in `bottom-sheet.component.tsx` -> captured as a "remote function" -> throws when the UI thread calls
it. In DEBUG the worklets runtime CATCHES the throw (`#ifndef NDEBUG`, warning only); in RELEASE (NDEBUG, the
device's Release-AdHoc build) there is NO catch -> uncaught Hermes JSError -> SIGABRT the instant ANY BottomSheet
mounts (useAnimatedStyle runs every render regardless of `visible`; 12+ screens). EXC_CRASH/SIGABRT, Hermes
throwPendingError in an AnimationFrame worklet — a different signature from build 15's [appDelegate window].
**KEY PROCESS LESSON: verify crash fixes with a RELEASE build (device or a Release-AdHoc sim build), NOT a
Debug build — Debug swallows Release-only worklet crashes. My build-16 "sim verified" used a Debug build, which
is why this slipped.** Repro recipe: `FORCE_BUNDLING=1 xcodebuild ... -configuration Release-AdHoc -sdk
iphonesimulator ... CODE_SIGNING_ALLOWED=NO` then `codesign --force --sign - --entitlements
ios/Kiko/Kiko.entitlements` then simctl install/launch on `8AC59549-...`.
FIX DONE + RELEASE-VERIFIED — build 17 on `next` (`2387061`), DEPLOYING. kiko:developer `aa5a9a78376eeaac3`
(commit `1a7d577`) added `'worklet';` to `resolveKeyboardAwareMaxHeight`. SWEEP: no other same-class cases (all
other worklets are inline or `.runOnJS(true)`; exactly one `'worklet'` directive in src/ now). Verified with a
RELEASE-AdHoc build on the iOS 27 sim (`8AC59549`): app launched, Home rendered (which mounts a hidden
BottomSheet via date-range-field — the crash-triggering path), pid alive 2+ min, ZERO new crash `.ips` +
screenshot of the rendered Home. Coordinator re-ran `make verify` GREEN (3132 tests), ff'd `next`
`e972cc8`->`1a7d577`, bumped 16->17 (`2387061`), ff'd next. BUILD 17 on device (user 2026-09-20): NO CRASH (fixed), the sheet lifts, card holding works — BIG progress.
REMAINING = a VISUAL polish on the currency sheet keyboard: a large BLACK band between the sheet bottom and the
keyboard's floating "Done" pill, + the sheet's bottom padding looks too aggressive.
CAUSE (from code): (1) the sheet keeps its safe-area `bottomInset` in `paddingBottom` even when the keyboard is
open (redundant — keyboard covers the home indicator); (2) the "Done" `InputAccessoryView`'s container
(`use-keyboard-done-accessory.tsx` / `keyboard-done-accessory.styles.ts accessoryContainer`) is TRANSPARENT with
a padding gap, and iOS includes it in `endCoordinates`, so the sheet lifts above it and the transparent band
shows the dark scrim = black.
FIX DONE — build 18 on `next` (`6ffe6f2`), DEPLOYING. kiko:developer `a40478dd3978d4427` (commit `2be0986`)
added `resolveKeyboardAwareBottomPadding` (`'worklet'`-tagged, same pattern as the max-height resolver): drops
the redundant safe-area `bottomInset` from the sheet's `paddingBottom` while `keyboardHeight > 0` (50pt -> 16pt;
the 34pt safe-area inset was 86% of the excess). Kept the Done pill + its intentional 8pt float gap. MEASURED on
a RELEASE iOS-27 sim via Maestro hierarchy dumps (point-space frames); before/after screenshots in
`/tmp/currency-fix-shots/` — coordinator reviewed after-fix.png: black void gone, an extra currency row now
visible, Done pill floats in a small normal gap. Coordinator re-ran `make verify` GREEN (3136 tests), ff'd
`next` `2387061`->`2be0986`, bumped 17->18 (`6ffe6f2`). BUILD 18 on device: the black band is UNCHANGED (user: "identical to the previous build"). Build 18 only
trimmed the sheet's INTERNAL padding (one more row shows) but the visible black band is the KEYBOARD ACCESSORY
STRIP, which build 18 did not touch.
USER's authoritative diagnosis (2026-09-20): "The black bar appears because you move the sheet too high relative
to the keyboard. The bottom padding of the sheet should be the thing visible under the input accessory view
instead of the black bar, if you've moved it correctly." So: the lift uses the FULL keyboard frame (which iOS
reports INCLUDING the accessory), landing the sheet's bottom edge at the accessory-strip TOP -> the transparent
strip below shows the black backdrop. Build 18's padding removal was BACKWARDS — the padding should FILL behind
the accessory.
CORRECTED FIX DONE — build 19 on `next` (`fde5ef2`), DEPLOYING. kiko:developer `a71633c7ac354e5ed` (commit
`27a3f4c`): `resolveKeyboardLift = max(0, keyboardHeight - accessoryHeight)` (lift to the keyboard KEYS, not the
accessory top); `KEYBOARD_ACCESSORY_HEIGHT = 60` shared constant (pill 44 + 2*8 padding) exported from
`keyboard-done-accessory.styles.ts`; `resolveKeyboardAwareBottomPadding` keyboard-open = `max(0, accessoryHeight
- basePadding)` = 44 (so outer 44 + inner content buffer 16 = 60 = accessory height exactly). Result (measured on
RELEASE iOS-27 sim): gap above the Done pill = 8pt, gap below = 8pt (SYMMETRIC), sheet glass fills behind the
pill, NO black band. Coordinator reviewed the screenshot (Base Currency, "eu" search) — clean. Re-ran `make
verify` GREEN (3140 tests), ff'd `next` `6ffe6f2`->`27a3f4c`, bumped 18->19 (`fde5ef2`). BUILD 19 on device: symmetric spacing CONFIRMED good, but the user found 2 more currency-sheet items:
1. TWO-TAP SELECT (functional): with the keyboard open, the first tap on a currency row only dismisses the
   keyboard; a second tap selects. Fix: `keyboardShouldPersistTaps="handled"` on the FlatList in
   `currency-field.component.tsx` (~L170-188).
2. KEYBOARD ROUNDED CORNERS (visual): black notches show at the keyboard's rounded top corners; extend the
   sheet's glass DOWN behind the keyboard by ~the corner radius to fill them, compensating content padding so
   the Done-pill symmetry is retained.
3. SETTINGS SCROLL (functional): the background-scroll bug (fix C) STILL happens on the Settings base-currency
   selector — fix C was wired into account-form + holding-form but NOT `settings.screen.tsx` (renders CurrencyField
   ~L207 in a `<Screen>` ~L115, 0 gating). Add the same wiring (isCurrencySheetOpen + onOpenChange +
   automaticallyAdjustKeyboardInsets={!open}). COMPLETE CurrencyField consumer list = settings + account-form +
   holding-form (forms done; settings is the LAST). `bank-type-field` matches a CurrencyField grep only in a
   COMMENT — not a real consumer. (Lesson: fix C's per-consumer prop-drilling missed Settings; all consumers now
   covered — a future new CurrencyField-in-a-scroll-Screen consumer must also gate; consider a shared context if
   a 4th appears.)
ALL 3 FIXED — build 20 on `next` (`f016fd5`), DEPLOYING. kiko:developer `a71633c7ac354e5ed` (commit `23245e8`):
(1) `keyboardShouldPersistTaps="handled"` on the currency FlatList -> single-tap select; (2)
`KEYBOARD_CORNER_OVERLAP=28` folded into the effective accessory height (lift -28 / padding +28, symmetry
unchanged) so the sheet glass covers the keyboard's rounded corners; (3) fix-C wiring added to
`settings.screen.tsx`. Verified on RELEASE iOS-27 sim (hierarchy: sheet edge 524->552, content/pill/gaps
unchanged 8/8pt; corner notch RGB ~19 -> ~33 = gone). Coordinator reviewed the screenshot, re-ran `make verify`
GREEN (3142 tests), ff'd `next` `fde5ef2`->`23245e8`, bumped 19->20 (`f016fd5`). BUILD 20 LGTM ON DEVICE (user 2026-09-21) — single-tap select, keyboard corners, Settings scroll, card
holding, no crash all confirmed. User directive: "make a new archive."
BUILD 20 ARCHIVE DONE + VERIFIED (kiko:ops `a4f3034fc4829ae96`, 2026-09-21). Archive
`~/Library/Developer/Xcode/Archives/2026-09-21/Kiko-1.0.0-20.xcarchive` (264 MB, in the Organizer); .ipa
`~/Desktop/Kiko-1.0.0-build20.ipa` (21 MB). ALL 7 invariants PASS (Apple Distribution valid cert 2E0A4B9D,
KikoDistribution e8991dd0, UIDeviceFamily [1], App Group new present / old absent, get-task-allow=false, 1.0.0
/ build 20); archived + .ipa bundle grep SCREENSHOT/seedScreenshotData/screenshot-seed = 0/0/0. NO git tag
(two-phase rule — tag only after the App Store PUBLISHES). resubmission-kit.md updated to build 20 (header,
section A reply, section B Notes, section D screenshots, section E gate). reviewer-kit/ = en demo + key +
HOW-TO-IMPORT (build refs current).

**REMAINING = USER-SIDE ONLY (the resubmission is unblocked):**
1. Upload `~/Desktop/Kiko-1.0.0-build20.ipa` via **Transporter** (NOT the Organizer — Xcode 27 export quirk).
2. In App Store Connect: fill App Review Information -> Notes with resubmission-kit section B; send the section-A
   reply in the Resolution Center; attach the reviewer .zip (en demo .kiko + key + HOW-TO-IMPORT + the demo
   video the USER records); capture marketing screenshots (uk demo `e2e/screenshot/fixtures/kiko-demo-uk.kiko`,
   same key; 6.9"=1320x2868, 6.5"=1284x2778).
3. AFTER the App Store PUBLISHES: `v1.0.0` git tag + `gh release` + `next`->`main` merge (release skill Part A;
   two-phase rule). Until then, NO tag, nothing pushed.

DEFERRED cleanup (post-resubmission, on next, + a whole-branch kiko:reviewer pass of the currency-fix branch's
build 11-20 commits): remove the redundant `toFilePath`/file:// strip in import-data.ts; compact MEMORY.md <
17.1KB; prune the currency-fix + old build-1-0-0/screenshot-purge worktrees once integrated to main. (single-tap select; keyboard corners; Settings scroll;
card holding; no crash). On LGTM -> re-archive build 20 (recipe in DONE section; update resubmission-kit refs to
build 20) -> USER submits. Builds 13-19 SUPERSEDED. (currency search keyboard spacing + card holding + no
crash). On LGTM -> re-archive build 19 (recipe in DONE section; update resubmission-kit refs to build 19) ->
USER submits. Builds 13-18 SUPERSEDED. Builds 13-18 SUPERSEDED. + re-confirms currency search + card holding +
no crash. On LGTM -> re-archive build 18 (recipe in DONE section; update resubmission-kit refs to build 18) ->
USER submits. Builds 13-17 SUPERSEDED.
(Sandbox sim note for future keyboard repros: XCTest/Maestro sets the sim's hardware keyboard ON, which
SUPPRESSES the on-screen keyboard + its keyboardWillChangeFrame; toggle it off via CoreSimulator
`SimDevice.setHardwareKeyboardEnabled:` to reproduce keyboard-driven layout.)
FOLLOW-UP (deferred, high value): a Semgrep rule in `rules/semgrep-mobile.yml` catching "plain imported function
called inside a reanimated worklet hook" — this bug class is invisible to TS + Jest (reanimated mocked) and only
crashes in Release on device. Route to kiko:linter/scribe.
Builds 13/14/15/16 all NOT submittable.
COORDINATOR NEXT: verify (make verify + the RELEASE iOS-27-sim no-crash evidence) -> ff next -> bump 16 -> 17
-> device deploy -> USER re-tests launch + currency + card -> re-archive build 17. — (1) app launches (no crash), (2) currency search incl.
shrink-to-one-result (input stays above keyboard, no background scroll), (3) create a card holding on a
non-synced bank. On LGTM -> re-archive build 16 (recipe in DONE section; update resubmission-kit refs to build
16) -> USER submits. Builds 13/14/15 SUPERSEDED.

COORDINATOR NEXT: user re-tests BOTH on build 15 — (1) currency search: tap input, type, filter to ONE result
(sheet shrinks -> input must stay ABOVE the keyboard), select, confirm no background scroll left behind; (2)
create a card holding on a non-synced (import-only) bank. On LGTM -> re-archive build 15 (kiko:ops, recipe in
the DONE section; update resubmission-kit refs to build 15) -> USER submits.

--- (detail of the two fixes, now integrated:) ---

### BUG 1 — currency-search keyboard/scroll (ROOT CAUSE CONFIRMED)
Build 14's fix A+B had ZERO effect on device (all 4 behaviors persist). Re-diagnosis (currency debugger
`a0658a1bb4bf4bf5c`, resumed): the WHOLE bug is ONE prop — `automaticallyAdjustKeyboardInsets={true}` on the
BACKGROUND ScrollView (`screen.component.tsx:88`, used by account-form + holding-form). When the currency
sheet's search field (in a Modal) focuses, that background ScrollView wrongly reacts to the keyboard for a
responder it does not contain, and does not self-correct. A+B were the wrong layer (B's KeyboardAvoidingView
is inert — the 66%-capped sheet's top-pinned input is never under the keyboard). FIX (IN FLIGHT, kiko:developer `ad60769bf73bd9c96`, worktree
`/Users/drizzer14/orca/workspaces/pff-ios/currency-fix`) — now the FULL currency-sheet keyboard behavior in one
task:
  - C (background scroll): prop-drill `onOpenChange` from CurrencyField + an `automaticallyAdjustKeyboardInsets?`
    prop on Screen (default true); account-form + holding-form hold `isCurrencySheetOpen` and pass
    `automaticallyAdjustKeyboardInsets={!open}`.
  - LIFT (USER request 2026-09-20): the debugger's "input is always above the keyboard" assumption is WRONG when
    the results shrink (e.g. one match -> the sheet shrinks and its input can end up BEHIND the keyboard). So the
    hand-rolled Modal BottomSheet must LIFT above the keyboard — offset the card up by the keyboard height
    (reanimated `useAnimatedKeyboard()`, or Keyboard events -> shared value) and cap max height against
    window-minus-keyboard. Must be a no-op for the 12+ input-less sheets (height 0 when no keyboard).
  - KEEP attempt A (Keyboard.dismiss hygiene). REPLACE attempt B: the LIFT supersedes B, so B's KeyboardAvoidingView
    wrap + its style + the date-field test tweak are REMOVED as part of this task (B was inert for a Modal sheet).
  - FALLBACK if the background scroll still drifts after C: snapshot+restore the ScrollView offset around the sheet
    lifecycle (reanimated scrollableRef/useScrollOffset already in holding-form) — targeted restore, NOT a redesign;
    do NOT move the input out of the Modal.

### BUG 2 — cannot create a "card" holding on a NON-SYNCED bank (ROOT CAUSE CONFIRMED)
`creatableHoldingTypesForAccountKind` (`holding-type.ts:57-61`) is a STATIC per-kind map that drops sync-only
types `['card','jar']` for ALL bank accounts; correct only for LIVE-SYNCED (Monobank) accounts where the sync
pipeline creates cards. Import-only banks (no `institution`) have no sync, so `card` should be creatable. FIX DONE (kiko:developer `a51070cd5c3ea4571`, commit `e36fa21`, worktree
`/Users/drizzer14/orca/workspaces/pff-ios/card-holding-fix`, off d7bc28b; make verify green 3118 tests):
replaced the static map with `creatableHoldingTypesForAccount(kind, isSynced)`; non-synced bank gets
`['card','term_deposit','bond']` (card FIRST, so card is now the DEFAULT create type for a non-synced bank —
acceptable), synced bank `['term_deposit','bond']`; `jar` excluded ALWAYS. Call site holding-form.screen.tsx
uses `isSyncedAccount(accounts.at(0))`. Test default `mockAccountInstitution` changed null->'monobank' to
preserve unrelated tests. AWAITING integration (after the currency fix, merge both -> build 15).

COORDINATOR NEXT: on each developer report -> `make verify` green myself in that worktree. Integration: ff
`next` to whichever fix lands first, then MERGE (not ff) the other onto next (different files: currency touches
currency-field/screen/*-form; card touches holding-type/holding-form — holding-form.screen.tsx is touched by
BOTH: currency adds isCurrencySheetOpen+onOpenChange, card changes line ~340 creatable-types — check merge-tree
first, [[integration-merge-lessons-2026-09-12]]). Then bump build 14 -> 15 (one bump for both), device deploy,
USER re-tests BOTH, then re-archive build 15.
DEFERRED cleanup (post-resubmission, on next, + a whole-branch kiko:reviewer pass): remove the redundant
`toFilePath`/file:// strip in import-data.ts; compact MEMORY.md < 17.1KB. (Bug-1 attempt B is no longer
deferred — the currency LIFT task removes it.)

---


**Read first:** the auto-memory index `~/.claude/projects/-Users-drizzer14-Developer-Projects-pff-ios/memory/MEMORY.md`.
Verify every claim here against git + orca before acting. **Coordinator = THIS session** (the name
changes each /clear; old `pff-ios-82` gone). Standing PM = `pff-ios-89`. Repo id for `orca`:
`d1d4f630-dcc4-4263-9912-1a82f56c380e`.

## ⏳ HISTORICAL (was "start here" for the import fix; SUPERSEDED by build 20 submission) — BUILD 11 DEVICE DEPLOY → IMPORT → ARCHIVE
The 5.6 purge is DONE and on `next`. The `.kiko` import-read bug is FIXED and INTEGRATED. Build 10 is
BROKEN (import fails on device) — **do NOT submit build 9 or 10.** Build 11 is the fix.

**DONE this session (coordinator):**
- Import-read fix by kiko:developer `a2804c7aadfc8c8f4`: `src/data-transfer/import-data.ts` adds `toFilePath`
  (strips `file://` + `decodeURIComponent`, guarded), applied before every `RNFS.readFile`. Commit `148ba5b`
  + tests. `make verify` GREEN in the worktree (coordinator re-ran it: lint + full jest + check:all).
- Integrated: `next` fast-forwarded `a7a54c0` -> `148ba5b` -> **`9a3cd22`** (build 11 bump:
  `CURRENT_PROJECT_VERSION` 10 -> 11 in all 3 pbxproj configs; MARKETING_VERSION + package.json stay 1.0.0).
  Worktree `/Users/drizzer14/orca/workspaces/pff-ios/integrate-purge` (branch `integrate-purge`) HEAD =
  `9a3cd22` = `next`.

**BUILD 11 DEPLOYED to device `00008130-0018712A1E32001C`** (kiko:ops `a2e51f67943e90656`, `make deploy
DEVICE=…` — `make deploy` refused to guess among 8 iPhone-shaped targets, so DEVICE= is required).
Verified: on-device Bundle Version = 11 / 1.0.0; 5.6 bundle-grep 0/0/0 (used `grep -a -c` — Hermes
bytecode bundle); data container `11300148-8CFA-440B-8C97-DB08CEB653CA` = the SAME as before (data
preserved, not wiped). **AWAITING the user's on-device import test on build 11.**

**BUILD 11 STILL FAILS on device (user confirmed).** The `file://` strip was REDUNDANT — the debugger
(`a030dc3044906379a`) proved `react-native-fs` `normalizeFilePath` already strips `file://` (FS.common.js:30),
and `decodeURIComponent` was a no-op for these filenames. So build 11 changed nothing. DO NOT re-propose the
file:// strip.

**DEBUGGER FINDINGS (device-only bug, jest-blind because RNFS + the picker are mocked in tests):**
- The generic "invalid file" alert is a FUNNEL in `import-data.screen.tsx` runImport catch (~L115-121): every
  error NOT prefixed `data-transfer/decrypt` shows it. User sees "invalid file" (NOT "wrong key") => failure
  is BEFORE decrypt: the read (`RNFS.readFile`, ~import-data.ts:105, UNWRAPPED), the pre-decrypt JSON.parse
  (~L111), or the envelope-shape check (~L115).
- Crypto/parse/shape logic CONFIRMED SOUND: debugger decrypted `kiko-demo-uk.kiko` + `kiko-demo.key`
  standalone in Node — bytes + key are fine. Key-entry mangling ruled out (trim + whitespace-strip guards).
- LEADING HYPOTHESIS (#1): `keepLocalCopy` (import-data.screen.tsx ~L85-92) silently FAILS on device and the
  screen falls back to the picker's transient `asCopy:true` temp URL, which is dead by the time RNFS.readFile
  runs after the user types the key + confirms the ConfirmSheet. Its failure/`copyError` is never surfaced.
  #2: readFile returns corrupted text (real native base64->utf8) => JSON.parse fails. #3 (weak, ruled out by
  symptom): GCM divergence would show the "wrong key" alert, not "invalid file".

**ROOT CAUSE CONFIRMED (device diagnostic + Node cross-check + elimination) — Hermes `TextDecoder`.**
The diagnostic build (d9e29d2, since DROPPED) showed the on-device alert: `stage=payload-json-parse`,
`keepLocalCopy=success`, `fileUri=…/Library/Caches/…/kiko-export-…kiko`. So: the file read OK, JSON-parsed OK,
envelope shape OK, DECRYPT OK (GCM tag verified — a decrypt failure shows the "wrong key" alert, not this),
and the failure is `JSON.parse(bytesToUtf8(plaintext))` at `import-data.ts:139`. `bytesToUtf8` =
`new TextDecoder().decode()` (`@noble/ciphers/utils.js`). RN 0.87.1 Hermes ships NO TextEncoder/TextDecoder
polyfill; `base64.ts` is already hand-rolled for this exact Hermes reason. Node cross-check: both demo
fixtures decrypt + `JSON.parse` fine in Node (33394 bytes, 616 Cyrillic chars — the demo DOES contain
Cyrillic, so it is not an ASCII-only test; but the fault is the DECODER, not the content — proven by
elimination: line 139 is only bytesToUtf8 + JSON.parse, and the parse is proven good). Build 11's `file://`
strip was redundant (RNFS strips file:// internally) — that is why builds 9/10/11 all failed identically.

**FIX INTEGRATED — build 12 on `next` (`a9dc6e1`).** kiko:developer `ac7f2c3b60615cff8` added the hand-rolled
Hermes-safe codec `src/data-transfer/utf8/utf8.ts` (`utf8Encode`/`utf8Decode`, core-JS only, standard UTF-8,
byte-compatible with existing files), replacing `bytesToUtf8` at import-data.ts:139 + `utf8ToBytes` at
export-data.ts:52 (commit `6c97106`; 15 codec tests incl. Cyrillic/emoji + a byte-for-byte `TextEncoder`
parity test). Coordinator re-ran `make verify` GREEN (269 suites / 3109 tests), ff'd `next`
`9a3cd22` -> `6c97106`, bumped build 11 -> 12 (`a9dc6e1`, all 3 pbxproj configs), ff'd next.

**BUILD 12 IMPORT CONFIRMED WORKING ON DEVICE (user 2026-09-19).** The Hermes-TextDecoder root cause is
fixed. [[hermes-no-textdecoder-handroll-utf8]].

**USER-REPORTED NITPICK (small, does NOT block review):** after importing data whose `language` differs (e.g.
uk), the "Import complete" success alert stays in the OLD language. Cause: `runImport`
(import-data.screen.tsx ~L113) resolves `t('...successMessage')` immediately, before `useSyncLanguageWithSettings`
(async live-query useEffect) applies the restored language. Does NOT affect App Review — the reviewer imports
`kiko-demo-en.kiko` (settings.language='en', app stays English; en/uk demos DIFFER only in the language setting
+ nonce, data/merchant names are Cyrillic in both). USER CHOSE (2026-09-19): fix the nitpick first, then
archive build 13.

**NITPICK FIXED — build 13 on `next` (`b8e696f`), DEPLOYING.** kiko:developer `a62aa837f2a4af6d9` (commit
`cc87f01`): `importData` returns `languageRestored` (from the payload settings row); `runImport`
`await i18n.changeLanguage(languageRestored)` before the success alert, and builds the message with `i18n.t()`
(NOT the hook's `t` — react-i18next 17's `useTranslation` `t` is fixed to the render-time language, so it does
not pick up a mid-function `changeLanguage`; the raw instance `i18n.t` reads the live language). Coordinator
re-ran `make verify` GREEN (3111 tests), ff'd `next` `a9dc6e1`->`cc87f01`, bumped 12->13 (`b8e696f`), ff'd next.
IN FLIGHT: kiko:ops `acc3eaf7cd55e5e2e` deploying build 13 (`make deploy DEVICE=…`).

**BUILD 13 LGTM ON DEVICE (user 2026-09-19)** — import works + uk-demo success alert in Ukrainian. User
directive: "Make a review-ready build and let me handle the rest." (User handles Transporter upload +
resubmission + demo video.)

**BUILD 13 ARCHIVE DONE + VERIFIED (kiko:ops `a329bc6dba8916571`).** Archive
`~/Library/Developer/Xcode/Archives/2026-09-19/Kiko-1.0.0-13.xcarchive` (in the Organizer); .ipa
`~/Desktop/Kiko-1.0.0-build13.ipa` (21 MB). ALL 7 invariants PASS (Apple Distribution via the VALID cert —
the revoked twin was auto-skipped; KikoDistribution; UIDeviceFamily [1]; App Group
group.com.dmytro-vasylkivskyi.kiko present / group.com.dmytro.pff absent; get-task-allow=false; 1.0.0 /
build 13); archived-bundle grep SCREENSHOT/seedScreenshotData/screenshot-seed = 0/0/0. NO git tag (two-phase
rule — tag only after the App Store PUBLISHES). pod install touched only gitignored Pods/build (Podfile.lock
untouched).

**RESUBMISSION MATERIALS READY (coordinator finalized, first-person singular — solo dev):**
`memory/refs/resubmission-kit.md` updated to build 13 (section A Resolution-Center reply + section B App
Review Information Notes, both paste-ready, no "we"). Reviewer kit `memory/refs/reviewer-kit/` = the EN demo
`kiko-demo-en.kiko` (VERIFIED = en variant, so the reviewer stays in English) + `kiko-demo.key` (matches) +
`HOW-TO-IMPORT.txt` (build 13). USER records `demo.mp4`, zips, uploads `.ipa` via Transporter, submits.

**REMAINING:**
1. USER-SIDE (user said "let me handle the rest"): upload `~/Desktop/Kiko-1.0.0-build13.ipa` via Transporter;
   fill App Review Information with the section-B Notes; send the section-A reply; record + attach the demo
   video; capture marketing screenshots (uk demo `e2e/screenshot/fixtures/kiko-demo-uk.kiko`, same key).
2. AFTER the App Store PUBLISHES: `v1.0.0` git tag + `gh release` + `next`->`main` merge (release skill
   Part A; two-phase rule).
3. DEFERRED (non-blocking, post-resubmission cleanup on next): remove the now-redundant `toFilePath`/`file://`
   strip in import-data.ts (RNFS strips file:// internally — dead code); the import-fix commits 11-13 have not
   had a formal whole-branch kiko:reviewer pass (small, device-verified, gate-green — user directed straight
   to build). Compact `~/.claude/.../memory/MEMORY.md` to < 17.1KB (index near the read limit).
2. **ONLY after the user confirms the import works on device**, dispatch **kiko:ops (sonnet)** for the BUILD
   11 distribution archive + .ipa (deliberately deferred so a failed device test does not waste an archive).
   WORKING recipe (build 9/10): clean `ios/build`; `pod install` (regenerates ReactCodegen — the "Build input
   file cannot be found" gotcha); archive `-configuration Release` with `CODE_SIGN_IDENTITY="Apple
   Distribution"` + `PROVISIONING_PROFILE_SPECIFIER=KikoDistribution` + `DEVELOPMENT_TEAM=M52858LNYL` (fresh
   outside-repo `-derivedDataPath`); standard `xcodebuild -exportArchive` (Xcode 27 export WORKS on a CLEAN
   archive — do NOT hand-zip). Archive -> `~/Library/Developer/Xcode/Archives/2026-09-19/Kiko-1.0.0-11.xcarchive`;
   .ipa -> `~/Desktop/Kiko-1.0.0-build11.ipa`. Re-grep the archived bundle = 0 screenshot markers.
3. USER uploads build 11's .ipa via **Transporter** (not the Organizer — Xcode 27 quirk; not build 9/10).
4. Then resubmission proceeds (materials READY — memory/refs/resubmission-kit.md + reviewer-kit/; UPDATE the
   kit's "build 10" refs to build 11).

THE BUG (fixed, for the record): import showed "This does not look like a valid Kiko export file" on EVERY
import (demo files AND the user's own export). ROOT CAUSE: `RNFS.readFile` got the document picker's
percent-encoded `file://…` URI, which it cannot read (treats it as a literal nonexistent path). FIX = strip
the scheme + percent-decode before readFile. `export-data.ts` already writes a scheme-less path, so only the
read side needed it.

## ⏳ ACTIVE TRACKS (2026-09-19, superseded by the section above — kept for detail)

## ⏳ ACTIVE TRACKS (2026-09-19, this session)
1. **screenshot-purge** — **CODE DONE + VERIFIED + INTEGRATED (deep gate running).** Final branch
   commit `c83e1d1` (off df2a503). Purged ALL SCREENSHOT_MODE/@env from the shipping tree (5 src/
   files + `App.tsx` ReducedMotionConfig gate) with **NO replacement** — `KikoTestEnv` native
   module DISCARDED (would ship in the App Store build = 5.6 violation, [[no-test-code-in-appstore-build]]).
   Demo dataset -> 2 committed encrypted fixtures `e2e/screenshot/fixtures/kiko-demo-{uk,en}.kiko`
   + `kiko-demo.key` (uk = user manual shots, en = reviewer), imported via the real Import UI.
   Automated screenshot-regression subsystem RETIRED (env.screenshots*, maestro flows, pixelmatch,
   23 baseline PNGs); the 20 shipped `screenshots/appstore/` PNGs untouched. Version bumped to
   build 9. Coordinator VERIFIED read-only (apparatus gone from shipping src/+App.tsx+ios/,
   version 9x3, fixtures present, retired files gone, merge clean). **Integrated:** merged into
   worktree branch `integrate-purge` (merge `cfb70fb`, at
   `/Users/drizzer14/orca/workspaces/pff-ios/integrate-purge`); `npm ci` + `make verify` GREEN on
   the integrated tree (knip/deps clean, gitleaks does NOT flag the demo .key). **`next` NOT yet
   advanced** — fast-forward `next` -> `cfb70fb` ONLY after the deep gate passes. Deep gate RUNNING
   (bg id b62l4g5pb, `KIKO_MUTATION_BASE=next make deep`, log
   `/var/folders/.../kiko-harness/56027de0a6b40902/mutation/progress.log`). Orchestrator stood
   down. Doc-drift follow-ups (non-blocking, deferred): `docs/research/2026-09-04-app-store-publishing.md`
   + `docs/plans/bank-providers.md` still describe the deleted check:screenshots flow.
2. **deploy-build8** (orca worktree off next; kiko:ops haiku). **DONE.** Round-8 Settings fix
   (chevron centered on the title line + Import/Export group-divider left inset to the label's
   first letter) built + committed (2 commits: `f8f66b8` fix + `3264aa5` Podfile.lock sync of the
   statement-import native pods that next was missing) + installed on device (build 8) + **user
   LGTM on phone**. **Integrated into next: next fast-forwarded df2a503 -> `3264aa5`** (linear,
   already make-verify-green). Worktree kept for now (built app + pods) in case of another device
   iteration before build 9; prune when build 9 deploys.

Durable work-docs: `memory/refs/` (translation-review-2026-09-18, device-feedback-round-3/4/6,
resubmission-kit, export-import-plan, screenshot-purge-brief-2026-09-19, settings-fix-brief-2026-09-19).
NOTE: `memory/` is an UNTRACKED dir in the repo working tree (survives resets; not committed).

## ⏳ QUEUED — when the purge lands (user directive 2026-09-19: "prepare the build and all appstore info when the purge is done")
After screenshot-purge reports done (code + make verify green) + reviewed: (a) integrate
screenshot-purge into next (check:all), then the COORDINATOR runs the SINGLE deep gate
`KIKO_MUTATION_BASE=next make deep` — detached, tee'd to the stable progress log, with a human
`tail -F` surfaced to the user, awaiting ONLY the exit code. NEVER poll it and NEVER let a
babysitting subagent run it ([[check-deep-no-incremental-output]] — the orchestrator wait-looped
on it 2026-09-19; deep gate moved back to the coordinator). The track does NOT run the deep gate.
(b) verify SCREENSHOT grep = 0 in src/+App.tsx AND the archived bundle; (c) kiko:ops build 9
device deploy + fresh distribution
archive -> Xcode Archives, re-grep archived bundle = 0; (d) coordinator finalizes
`memory/refs/resubmission-kit.md` (App Review Information notes + reply-to-reviewer explaining the
5.6 fix + how to test via the demo .kiko import); (e) assemble the reviewer .zip (demo .kiko + key;
USER records the demo video); (f) scribe wires the archive-bundle-grep into the release skill.
**NOT in scope: marketing screenshots — the USER makes those manually from their phone.**

## ✅ DONE (historical) — 5.6 PURGE directive (was the start-here; COMPLETED — see the top section)
The 5.6 purge below was fully executed: SCREENSHOT_MODE physically gone from src/+App.tsx, demo data is
now the committed `.kiko` fixtures imported via the real Import UI, deep gate green, build 9/10 archived.
The ONLY remaining blocker is the `.kiko` import-read `file://` bug (see the top section). Original directive:
Base: next @ df2a503 (1.0.0 / build 8). The opus audit (`memory/refs/appstore-audit-2026-09-19.md`) found
the app clean EXCEPT a 5.6 residue. USER DECIDED: **PURGE ALL `SCREENSHOT_MODE` from src/** (not just the
seed). Deliverables the user asked for, in order:

1. **PURGE all SCREENSHOT_MODE/SCREENSHOT_STABLE_GLASS from src/** (5 files: `src/auth/use-app-lock.ts`,
   `src/design-system/components/glass-surface/glass-surface.component.tsx`,
   `src/design-system/components/screen/screen.component.tsx`, `src/env.d.ts`,
   `src/migration/migrations-gate/migrations.gate.tsx`). Re-architect to e2e-ONLY:
   - The demo-data SEED → an external **demo `.kiko` import** (via the real import feature; the demo dataset
     at `e2e/screenshot/seed/screenshot-seed.ts`; fabricated data, NO secrets). This same demo `.kiko` + key
     serves BOTH the marketing screenshots AND the reviewer.
   - stable-glass render + biometric-prompt-suppression → an e2e-only mechanism (Maestro launch args / a
     test-only hook), NO src/ @env flag. **THIS IS THE HARD PART — PLAN IT FIRST (kiko:planner)**: check:
     screenshots (regression) + marketing capture both currently depend on these flags.
   - Bump CURRENT_PROJECT_VERSION 8 → **9** (all 3 pbxproj configs; MARKETING_VERSION stays 1.0.0;
     package.json 1.0.0). make verify green; then re-grep src/ AND the built bundle for
     SCREENSHOT/seedScreenshotData/screenshot-seed = **0** ([[guidelines-compliance-is-architecture-rule]]:
     verify the shipped bundle, DCE is not enough).
2. **Deploy build 9 to the phone** (kiko:ops, device 00008130-0018712A1E32001C) + **fresh distribution
   archive** (build 9) → Xcode Archives; re-grep the archived bundle = 0 screenshot markers. Build 8's
   archive is SUPERSEDED — upload build 9, not 8.
3. **New marketing screenshots** (App Store set, 6.9"=1320x2868 + 6.5"=1284x2778) via the demo `.kiko`
   import + the new e2e stable-glass mechanism. docs/harness/screenshots-check.md + [[screenshot-build-recipe]].
4. **Coordinator drafts** (finalize `memory/refs/resubmission-kit.md`): (a) App Review Information text (ASC
   notes + how to test with the demo file); (b) **Reply to reviewer** — what the 5.6 violation was (the
   SCREENSHOT_MODE demo-seed apparatus in src/), how we fixed it (physically purged ALL SCREENSHOT_MODE from
   src/; demo data is now an external .kiko the reviewer imports), how to review (import the provided demo
   .kiko with its key).
5. **Reviewer `.zip`:** demo `.kiko` + its key (coordinator assembles) + the demo VIDEO (USER records).
USER-SIDE pre-submit (audit #2/#3): confirm ASC account type (5.1.1(ix) — be ready with the read-only/
no-custody Review-Notes defense) + the ASC App Privacy label accuracy (third-party API calls). Privacy URL
CONFIRMED live. Wire the archive-bundle-grep into the release skill (scribe).

## ⭐ LIVE STATE (2026-09-19)
- **next @ `df2a503`** = the honest 1.0.0: glass + Monobank-connect-only + statement-import (6 formats) +
  encrypted export/import + form-validation overhaul + device-feedback rounds 1-7 + **version-synced to
  MARKETING_VERSION 1.0.0 / CURRENT_PROJECT_VERSION 8** (build 7 was the rejected 1.0.0 build; next had
  drifted to 1.1.0) + the Info.plist `--` comment fix. `make verify` GREEN (269 suites / 3114 tests,
  check:all incl. knip green — so next is Knip-clean).
- **main @ `d27e517`** FROZEN (rejected build 7 = 1.0.0/build 7). Nothing pushed. No tag until the App
  Store PUBLISHES (release skill two-phase rule).
- **TestFlight archive ✅ DONE** — `~/Library/Developer/Xcode/Archives/2026-09-19/Kiko-1.0.0-8.xcarchive`
  (264 MB, in the Xcode Organizer). All 7 invariants PASS (UIDeviceFamily [1]; Apple Distribution signing +
  KikoDistribution profile; App Group group.com.dmytro-vasylkivskyi.kiko present / group.com.dmytro.pff
  absent; get-task-allow=false; 1.0.0 / build 8). **USER uploads to TestFlight** via Organizer (NOT App
  Store submission yet). Archived from the `Release` config (bound to the KikoDistribution profile).
- **check:deep ✅ EFFECTIVELY-GREEN** (2026-09-19 02:53, base fbe49fc): mutation 69.87 ≥ 60 (3191 mutants,
  138 min); osv exit 2 but ONLY the 3 known CVEs (decode-uri-component + image-size ×2), no new ones. This
  is the authoritative final 1.0.0 deep.
- **FULL guidelines audit ✅ DONE** (opus, full report → `memory/refs/appstore-audit-2026-09-19.md`).
  Clean on the code axes that caused the 3 rejections; no smoking gun. **1 real MUST-FIX before App Store
  submission (NOT blocking TestFlight):** the 5.6 screenshot-seed GATE still ships — coordinator grep of the
  ACTUAL build-8 main.jsbundle shows the demo DATA is ABSENT (Rozetka/Сільпо/screenshot-seed/SCREENSHOT_MODE
  all 0) but `seedScreenshotDataIfEnabled`+`seedScreenshotData` (=1 each) survive Metro DCE. Physically
  remove the gate from src/ (migrations.gate.tsx:112-119) per [[guidelines-compliance-is-architecture-rule]]
  + wire the archive-bundle-grep into the release skill (scribe). USER-SIDE: #2 individual-dev account
  (5.1.1(ix)) Review-Notes defense, #3 ASC App Privacy label accuracy. #4 privacy URL CONFIRMED LIVE.
  Prune build-1-0-0 (audit + archive done).
- **FULL guidelines saved** for the audit: `memory/refs/appstore-guidelines-full-2026-09-19.txt` (all 5
  sections, 710 lines, fetched from the official URL — the WHOLE doc, not the finance-subset).

## NEXT STEPS (coordinator)
1. On the ops archive report: confirm all invariants PASS; tell the user the archive is in the Organizer,
   ready to upload to TestFlight. If any invariant fails, do NOT hand off — fix + re-archive.
2. **Run `check:deep` OVERNIGHT** (user directive — build first, deep after; it does NOT gate the build).
   Coordinator runs it itself in bg + a human `tail -F`; base fbe49fc or main as appropriate; effectively-
   green = mutation ≥ 60 AND osv only the 3 known CVEs. Report in the morning.
2b. **AFTER check:deep — FULL App Store guidelines compliance audit (USER directive 2026-09-19).**
   USER: do NOT trust a "finance-app-relevant" subset after three rejections — audit against the COMPLETE
   guidelines. Dispatch kiko:auditor with **model opus, HIGH effort**, read-only, whole-codebase (src/ +
   native: Info.plist, *.entitlements, PrivacyInfo.xcprivacy, ATS/pinning, pbxproj). The auditor READS the
   full guidelines from `memory/refs/appstore-guidelines-full-2026-09-19.txt` (all 5 sections) and goes
   through EVERY numbered guideline 1.x-5.x in order, marking each PASS / FAIL / N-A-with-reason against the
   real code, ranked findings with file:line. kiko-compliance + kiko-architecture 5.6 are supplements, NOT
   the scope. (Guidelines already fetched + saved — no web access needed by the auditor.)
3. Prune build-1-0-0 + its external derived data after the archive verifies.
4. DEFERRED to post-App-Store-PUBLICATION (release skill Part A steps 4-5 + user standing directive):
   the `v1.0.0` git tag + `gh release create` + the `next` → `main` merge. The main checkout is clean at
   d27e517 (see incident below); when merging next→main later, decide the pre-existing icon deletions +
   untracked Makefile first.

## ROUNDS 1-7 (all applied, reviewed, on device, user-reviewed — mostly lgtm)
Full item lists in `memory/refs/device-feedback-round-*.md`. Rounds: r1-2 (settings/forms polish + bank
picker), r3 (error states Option A native reflow + scroll + settings/bank-selector), r4 (error spacing,
scroll header-inset fix, deposit validation, export "does nothing" bug = path join + file:// scheme +
auto-share, import empty validation, sync section hidden for import-only banks, group-below-System),
r5 (scroll under/overshoot = live useHeaderHeight + content clamp; time-margin phantom-gap wrapper),
r6 (date+time single row, split-returns gap = round-4 regression, occlusion-aware ALL add-row scrolls,
divider right inset), r7 (chevron = title fontSize, divider spans to chevron glyph edge). Each track:
whole-branch review + make verify green; no new strings in r3/r5/r6/r7; r2/r4 added a few i18n keys (all
user-approved). User verified on device each round.

## INCIDENT (2026-09-19) — coordinator git mistake, RESOLVED
The coordinator carelessly ran `git checkout next -- .` in the MAIN checkout, polluting its working tree
(next's files over d27e517) and firing the Knip Stop-hook repeatedly. Branches were never affected. User
authorized + coordinator ran `git reset --hard HEAD` → main checkout clean at d27e517; memory/refs (untracked)
survived. Lesson reinforced: [[no-git-checkout-in-shared-worktree]] — NEVER prepend checkout/restore/reset to
an inspection command. A feedback draft was queued.

## STANDING (this session's durable decisions)
- [[hybrid-review-cadence]] — harness gates every task; ONE whole-branch kiko:reviewer pass before merge;
  early per-task review only for a foundational/risk-sensitive task.
- kiko-compliance skill extended (2.5.2 remote-code + conditional IAP/SIWA/account-deletion triggers).
- generic-harness port pushed to origin (git@github.com:drizzer14/harness.git @ d8fd578).
- QUEUED non-blocking cleanups: deriveTestID 3-way dedup; settings icon-offset shared constant; knip.json
  babel-plugin hints (deferred). Post-1.0.0: distill rounds 1-7 UI/UX findings into kiko-design-system.

## ENVIRONMENT
Xcode 27 (Device Hub; simctl/xcodebuild/devicectl headless). Device: Dmytro's iPhone
00008130-0018712A1E32001C, bundle com.dmytro-vasylkivskyi.kiko, data container 11300148-… (preservation
check). Hermes bundle stores Cyrillic as UTF-16LE — bundle-freshness greps need a non-ASCII marker check.
Fresh worktree needs `npm ci` (+ `pod install` for device/archive). PostToolUse Biome hook resolves against
the MAIN repo config, not the worktree — its organizeImports warnings are false positives; trust the
worktree's own `make gate`.
