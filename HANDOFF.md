# HANDOFF — Phase B2 complete + deployed, awaiting on-device review (2026-09-10)

**Read first:** `BOARD.md` (the live board, owned + kept current by the PM
session, the single writer). Then ask the PM for a fresh ground-truth snapshot.
Do not trust this file over the PM + git + orca.

## Current state

- `main` @ `e447a80` — **local only, NOT pushed.**
- **Deployed build = `75225f0`.** The `e447a80` commit is docs-only (it preserves
  the Phase B2 plan + diagnosis docs); it added no source, so the deployed source
  is `75225f0`.
- Everything is merged to `main`: Phase A (6 features + round-2 + the binance
  category/read-only fix), Phase B (the 13-item feedback round), and Phase B2
  (the on-device feedback round below).
- `check:all` is green on `main`. The end-of-round `check:deep` gate is GREEN
  (mutation 71.92% >= 60; osv shows only the 3 accepted advisories).
- Phase B2 is **built, gated, deployed, and live on the iPhone.**
- Only one worktree exists (`main`). All Phase A/B/B2 feature worktrees are
  pruned and their branches deleted. Other local branch:
  `harness/orca-terminal-script-rule` (unrelated).

## Phase B2 — the closed round

13 shipped items (1-6, 8-14; item 7 dropped as transient stale data). Delivered
in two waves of parallel tracks off `main` @ `e33b181`, each integrated rolling
(`check:all` + prune), then one `check:deep` gate before the deploy:

- Wave 1: domain (`3a1e155`) -> design (`cffa23e`) -> bugfix (`0d5ed8c`) ->
  forms (`bba1ac7`).
- Wave 2: app-wide compact-button audit -> `75225f0`.
- Docs preserved: `e447a80`.

Plan: `docs/superpowers/plans/2026-09-10-phase-b2-fix-round.md`.
Diagnosis: `docs/debug/2026-09-10-phase-b2-diagnosis.md`.

## In flight

The user is reviewing the Phase B2 build on the device now. See the
**device-confirm list** in `BOARD.md` (items 9a/10/11 plus the earlier Phase B
density/glass items). Nothing is blocked; the coordinator awaits the LGTM.

## Next steps, in order

1. User on-device review returns. Fix any reported items; otherwise proceed.
2. **Final Hardening phase** (fresh branches off `main`, parallel where
   independent, then consolidate findings -> one fix wave -> final deploy ->
   App Store):
   - Bug-hunt review (whole-app).
   - Security analysis.
   - Phase C — performance + bundle-size audit (C1 bundle-size, C2 app/native
     size, C3 runtime perf, C4 fix pass, C5 verify + final deploy).
   - Screenshot / visual-regression tests — Maestro `takeScreenshot` + pixel-diff
     (odiff/pixelmatch) + CI on a macOS runner (user has macOS). Recommendation
     doc: `docs/research/2026-09-10-simulator-screenshot-tests.md`.
   - Full-repo ponytail (over-engineering) review + codestyle pass, INCLUDING a
     new `kiko-code-style` rule applied repo-wide: "group non-component files
     into feature-based folders (a repo file with its test, related modules),
     not only component folders." This apply is a STRUCTURAL REFACTOR and needs
     its own plan at the hardening phase.

## Topology + sessions

- Worktree: `main` only.
- The PM session is the live-state anchor and SINGLE WRITER of `BOARD.md`. If it
  is cleared, re-boot it: "You are the kiko:pm; read BOARD.md; verify against
  git + orca; resume as single writer; do not echo board changes."
- `pff-ios-a5` — ops session in the main worktree; reuse it for integrations,
  the gate, and device builds (do not respawn per task).
- The coordinator (`pff-ios-d3`) delegates all work to role sessions in
  worktrees and never edits app files inline.

## Conventions in force this session (see the memory dir)

- Delegate to Claude sessions / Orca worktrees, never the in-process Agent tool;
  spawn plain `claude` (auto mode) and instruct into a role.
- PM owns `BOARD.md`; never echo its board changes back to the user (they view it
  in a split terminal). `TodoWrite` is not in this harness — `BOARD.md` is the
  task list.
- Close stale sessions and prune integrated worktrees autonomously (no asking).
- Multi-track round integration: rolling — integrate each approved track to
  `main` with `check:all`, prune its worktree, and run ONE `check:deep` gate on
  `main` after all tracks land (base = pre-round `main`). Partition shared files
  by line range per track so merges auto-resolve; the PM diffs touched ranges
  before each integration.
- Reliable long-run await = launch as a harness background task
  (`run_in_background`), never a `while pgrep stryker` loop (its own command line
  contains "stryker" -> self-match deadlock; match `@stryker-mutator` instead).
- Deploy after a green round without asking; device builds/deploys go to ops.
  Prove freshness with the bundle marker, not the container UUID (the UUID is the
  persistent data container and does not change per build).
- Design review is live-on-device (no screenshots for design; screenshots are
  regression-only).

## Key docs

- Phase B plan: `docs/superpowers/plans/2026-09-10-phase-b-feedback-round.md`
- Phase B2 plan: `docs/superpowers/plans/2026-09-10-phase-b2-fix-round.md`
- Phase B2 diagnosis: `docs/debug/2026-09-10-phase-b2-diagnosis.md`
- iOS HIG audit: `docs/design/2026-09-10-ios-hig-audit.md`
- Screenshot-test research: `docs/research/2026-09-10-simulator-screenshot-tests.md`
