# HANDOFF — 2026-09-07 audit fix runs (coordinator session pff-ios-9f)

Read this first. Nothing is committed anywhere. The user holds commits for
review. Three Orca worktrees under `/Users/drizzer14/orca/workspaces/pff-ios/`,
all branched from local `main` at `e36213c`.

## 1. security-pass-fixes — DONE, in user review

Branch `drizzer14/security-pass-fixes`. 21 tasks of
`docs/superpowers/plans/2026-09-06-security-pass-fixes.md` (audit S1-S10,
rules H1-H7; S11 deferred to the App Store plan). Gate PASS (mutation 73.2%,
osv = the 3 accepted advisories), whole-branch review clean after one fix wave.
Ledger with every ruling: `.superpowers/sdd/2026-09-06-security-pass-fixes/progress.md`.

OPEN user decision: the lock-aware clear blanks the widget for every App-Lock
user, so the `---` locked-screen rendering shows only for non-lock users.
Default if unanswered: keep the clear, record the trade-off. Recommended:
keep writing the snapshot with App Lock on (`---` + privacySensitive cover the
Lock Screen) and record "home-screen widget bypasses App Lock on an unlocked
phone" as accepted risk. Implementation if chosen: drop the `lockEnabled`
branch in `src/widget/use-net-worth-widget.ts` and update
`docs/security/README.md`'s widget entry.

## 2. harness-skills — DONE, in user review

Branch `drizzer14/harness-skills`. New `.claude/skills/kiko-translator`,
`.claude/skills/kiko-linter`; `harness/kiko/agents/qa.md` testing rules;
`kiko-widget` and `kiko-domain` updates. Verified by the retrospect agent.
`package-lock.json` there carries the same one-line normalization as main.

## 3. bug-hunt-fixes — IN PROGRESS

Branch `drizzer14/bug-hunt-fixes`. Plan
`docs/superpowers/plans/2026-09-06-bug-hunt-fixes.md` (40 tasks). Ledger:
`.superpowers/sdd/2026-09-06-bug-hunt-fixes/progress.md` (rulings, deferred
minors, tree snapshots per task). Briefs `task-N-brief.md`, reports
`task-N-report.md`, review packages `task-N-review.md` in the same dir.

State at handoff:
- Tasks 1-38 complete and reviewed (Task 24 / T-29 SKIPPED by ruling: no
  recap-OFF statement).
- Task 39 (T-43): implementer DONE after handoff (report at `task-39-report.md`,
  review package `task-39-review.md` against BASE tree
  `6b69d9b3ed467a2c6266dba47878edf9b3735b68`). NEXT STEP: dispatch the task
  reviewer on that package. Points to judge: a `biome-ignore ... OVERRIDE(
  language-dependent resolver)` was added for useExhaustiveDependencies
  (precedent statistics.screen.tsx:329) — confirm the override is justified
  and narrow; an RNTL-14 async-rerender fix in the test file; the mechanism
  is the dependency-array addition (`language` on its own line), which is the
  known one-line conflict with the security branch.
- Task 40 (verification): `npm run check:all`, `npx jest`, `npx tsc --noEmit`
  (0), `npm run check:deep` (mutation >= 60, report the score), an ops
  simulator build, and the manual simulator checks the plan lists (MANUAL-1..9:
  tab bar in Light mode, interface style, drag delay on the category rename
  field, Home clearance, Statistics double-tap at the top, widget title in
  uk, etc.). Only Task 40 runs check:deep — no developer may.
- Then: whole-branch review (opus reviewer, package = full working-tree diff
  vs `git rev-parse HEAD^{tree}`; include the ledger's `minor (deferred)`
  and `Ruling:` lines), ONE fix wave, one scoped re-review, then report to the
  user with every `Ruling:` line collected.

## 4. Process (do not drift)

- Subagent-driven development per task: fresh `kiko:developer` per task with
  the brief path; `kiko:reviewer` after each task; fix rounds resume the same
  agent; model per complexity (sonnet default, opus for multi-file/schema).
- Per-task diffs WITHOUT commits: `bin/snap.sh <worktree>` prints a tree id
  (temp index + write-tree; real index untouched); `bin/pkg.sh <worktree>
  <treeA> <treeB> <out>` writes the review package. Both copied into
  `.superpowers/sdd/2026-09-06-bug-hunt-fixes/bin/`. Record BASE tree before
  each dispatch in the ledger.
- Every dispatch: NO COMMITS; never git commit/add/stash/checkout/restore/
  clean (a developer ran `git checkout --` on three screens on 2026-09-07 and
  discarded 36 tasks of uncommitted edits; recovered and verified against the
  snapshot); TDD with RED/GREEN evidence; never loosen a test; skill upkeep
  in the same task (grep `.claude/skills/*/SKILL.md` for what the task
  touches; the reviewer checks it); fix every instance of a reported pattern;
  single editor per worktree; developers never run check:deep.
- Migrations on this branch: 0014 lowercase categories, 0015 exchange marker,
  0016 transaction hold, 0017 seed category colors (numbered in execution
  order; `migrations.js` hand-restored to repo style after drizzle-kit).

## 5. After both branches are reviewed by the user

Merge order: security-pass-fixes first, then rebase bug-hunt-fixes on it,
then harness-skills. Known conflicts: `src/widget/net-worth-snapshot.ts`,
`src/widget/use-net-worth-widget.ts` and their tests (security removed
`trend` and added the clear branch; bug added `labels`, `guardedBreakdown`,
and the language dependency — take security's deletions, keep bug's
additions; the plan's Task 38/39 CONFLICT WARNING blocks say exactly how),
`ios/Kiko/Info.plist` (disjoint keys — take both; run `npm run check:plist`
right after the rebase), `scripts/checks/medium.sh`, `CLAUDE.md`,
`.claude/skills/kiko-domain/SKILL.md` and `kiko-widget/SKILL.md` (all three
branches).

Device checks owed to the user after merge: Lock Screen widget shows
`---` per amount with codes visible; Binance sync with the new pin; Face ID
unlock; Statistics double-tap at the top; category rename hold places the
cursor; Home list clearance 96pt.

Backlog surfaced (not done): stale-rates UI signal; correction-row marker;
`migrateLegacyToken` existence check via getGenericPassword; `check:rules`
yml-id cross-check + fixture backfill; account-detail `sumByCurrency`
parity; "Disconnect Wallet" casing; override-sheet Cancel-during-Apply race;
`hold` has no UI reader; an already-disconnected holding duplicates once on
reconnect.
