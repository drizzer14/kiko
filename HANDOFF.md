# HANDOFF — Backlog cleared; app awaiting App Store review (2026-09-12)

**Read first:** the live board `BOARD.md` (kept by the standing `kiko:pm` session `pff-ios-ef` —
ask it for a ground-truth snapshot). Then the memory index
`~/.claude/projects/-Users-drizzer14-Developer-Projects-pff-ios/memory/MEMORY.md`. Verify against
git + orca; do not trust this file over ground truth.

## Current state

- **`main` is at `f354a37`, PUSHED** to `origin` (`git@github.com:drizzer14/kiko.git`, repo is
  PUBLIC). Tree clean. Only the `main` worktree remains (all Orca worktrees pruned). Standing PM =
  `pff-ios-ef`.
- **Build 3 is SUBMITTED for App Store review** (marketing 1.0, build 3). Awaiting Apple review. No
  git release tag yet — the `vX.Y.Z` tag/GitHub release is created ONLY after the App Store
  publishes (memory [[release-after-appstore-publishes]]).
- **Privacy policy is LIVE and its hosting is now correctly configured.** It serves from the
  `gh-pages` branch (root): `https://drizzer14.github.io/kiko/` (uk primary, title "Політика
  конфіденційності") and `/en.html` (en). This session FIXED a misconfiguration — GitHub Pages was
  pointed at `main`/`docs` and its builds were erroring (which would have published the whole
  internal `docs/` tree and broken the policy URL, since `docs/` has no `index.html`); it was
  repointed to `gh-pages`/root and rebuilt green.

## What shipped this session (all green: check:all + jest; regression suite green on device)

- **Repo-hygiene cleanup** (`a2a6305`) — removed 6 accidental `scratch_*.png` dev captures from the
  PUBLIC repo tip and added a `scratch*` `.gitignore` pattern. History intentionally NOT rewritten
  (user choice; they were app-UI screenshots, no secrets). Full scan confirmed no other trash, no
  secrets, `.env` correctly untracked.
- **Privacy-policy Pages fix** — see Current state above. Verified: both URLs 200, build green.
- **Stale local branches deleted** — `structural-colocation` (`be06201`) and
  `harness/orca-terminal-script-rule` (`c872ef7`), both local-only + superseded (reflog-recoverable).
- **Full-repo over-engineering (ponytail) review + cuts** (integrated at `577cddc`) — auditor +
  reviewer swept `src/`; verdict "already lean". Actioned 5 of 6 cuts: dropped `BalanceProvider.kind`
  + `ProviderBalance.currency` literal, collapsed `resyncRequest` arms, deduped `MonobankHolding`,
  moved the 4 chart components into `src/screens/statistics/` (+ `kiko-charts` skill path fix). Item 5
  (`useSync` alias) was VERIFIED intentional and kept.
- **Scribe follow-ups** (integrated at `577cddc`) — split the `kiko:release` skill's "First release"
  section (tag-less archive vs post-publication tag) and folded the screenshot build recipe + App
  Store gotchas into `docs/` (CLAUDE.md untouched, per the standing user instruction).
- **`icon-editor` layering fix** (integrated at `577cddc`) — relocated `icon-picker-modal` out of
  `screens/` into the design-system, removing the design-system→screens import violation.
- **Visual regression expansion** (integrated at `f354a37`) — 8 new rich shots (`r05`–`r12`): 3
  filled EDIT forms (account/holding/transaction), the bond add-form, and the category/date/time/
  override bottom sheets. `check:screenshots` PASSES all 19 rich shots (8 new at 0 mismatch; the
  flagged `r10` native time-spinner passed cleanly, NO exclusion fallback needed).

## New durable lessons recorded to memory this session

- [[screenshot-build-recipe]] UPDATED — the embedded build must be RELEASE (`--dev false`); a DEV
  bundle's LogBox "Open debugger to view warnings." banner covers the tab bar and eats Maestro taps.
  Verify the jsbundle greps for `isStableGlass` AND for the ABSENCE of that banner string. OpenJDK 21
  is keg-only on this machine: `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`.
- [[maestro-bottomsheet-dismiss-point-tap]] NEW — a Maestro flow cannot dismiss a Kiko `BottomSheet`
  by tapping its backdrop `testID` (center lands on the sheet card); dismiss via `tapOn: point:
  "50%,15%"` (the exposed scrim).

## Notes for the next session

- **Known cosmetic leftover (not worth a track):** the `backdropTestID` props added to `DateField`/
  `TimeField` during the regression testID sweep are unused by the final flow (dismiss uses a
  scrim point-tap). They are harmless valid optional props and `check:all` is green.
- **`check:screenshots` needs the ops build recipe + a booted pinned simulator** — it is manual/deep
  only, not in `check:all`/`check:deep`, not hook-wired. See [[screenshot-build-recipe]].
- **Backlog is effectively empty.** Remaining open items are the deferred full-repo ponytail follow-ups
  (none actioned needed — verdict was "lean"), and long-tail ideas the PM board tracks. Ask PM
  `pff-ios-ef` / read `BOARD.md` for the live list before starting anything.
- **Still waiting on Apple's review outcome.** Cut the git tag / GitHub release only after the App
  Store actually publishes.

## Coordination model (in force)

- I am the **worktree coordinator, not an agent orchestrator** (user re-correction 2026-09-12). Spawn
  orchestrator SESSIONS (`orca worktree create --agent claude --base-branch main`, verify head == local
  main) that drive the `kiko:*` agents; do NOT drive role agents directly, even for small or read-only
  tasks. Integration (pure `git merge` + gate check:all/jest + prune), memory, and PM/peer messaging are
  mine and stay direct. Deploys/archives/screenshot-baselines via a fresh `kiko:ops` Agent are allowed.
  Notify `pff-ios-ef` on every material event; do not echo the board to the user. Repo id for `orca`:
  `d1d4f630-dcc4-4263-9912-1a82f56c380e`.
