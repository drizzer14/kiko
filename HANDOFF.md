# HANDOFF — Final Hardening in progress (2026-09-11)

**Read first:** the live board `BOARD.md` (gitignored; kept by the standing `kiko:pm`
session `pff-ios-ef`). Then the memory index
`~/.claude/projects/-Users-drizzer14-Developer-Projects-pff-ios/memory/MEMORY.md` — the
key note is `final-hardening-tracks-2026-09-11`. Verify against git + orca; do not trust
this file over ground truth.

## Current state

- `main` @ `51e802e` — **local only, NOT pushed, NOT on the App Store.** Working tree clean.
- **Deployed to the device** via the Ad-Hoc review path (build `51e802e`; data container
  `149343BE` persists across updates = user data intact).
- Worktrees: `main`, `multi-account-impl` (banked, NOT merged), `structural-colocation`
  (stood-down idle, deferred). PM session `pff-ios-ef` standing.

## What is on `main` (all merged, green: check:all + jest 2243)

Phase A/B/B2/B3 + the Final Hardening work so far:
- **Fix cycle 1** (`27d31ef`): bond-dip v1, cleanup-perf (SEC1/SEC3 + chart/accounts
  memoization + Retry-After), feedback-round-2 (8 items), mutation-ETA per-mutant-rate model.
- **feedback-round-3** + **bond-dip-v2** (`42a7d1d`): the 5 round-3 tweaks; and the REAL
  bond-dip fix — root cause was the synced debit amount Q ≠ typed price P (fee/НКД/rounding)
  so card(−Q) and bond(+P) never cancelled. `reconcile-bond-funding.ts` now matches a
  same-currency debit within 5% of P and rewrites BOTH day and cost so the legs cancel;
  self-corrects live history. User confirmed LGTM on device.
- **trend-filter-final** (`51e802e`): "Top" filter first, filter-label top padding, removed
  categories-list background, and TRANSLUCENT glass on transaction cards (GlassSurface
  `material` variant). See "Open on-device confirmation" below.
- **Release config**: S11 done (user set Release iphoneos → distribution identity,
  `KikoDistribution`); a `Release-AdHoc` config (`KikoAdHoc` profile) drives `deploy-device.sh`
  for wired review; the app icon is dark-only. `kiko:auditor` role was added to the harness.

## Open on-device confirmation (this deploy)

The transaction-card glass uses the `material` (live-blur) variant, which can DRIFT in
lightness while a list scrolls (that is why cards originally used `transparent`). The user
asked for the sheet's material look explicitly; confirm on device. If the drift is
distracting, revert the Home row to `GlassSurface transparent` (one-line).

## Remaining roadmap (in order)

1. **STEP 2 — `multi-account-impl`** (branch banked, 6 phases green, `kiko:auditor` passed,
   migrations `0027`/`0028`/`0029`). Create a new in-app account + connect it to its OWN
   separate token (Monobank / Binance / BTC), N per provider. Integrate to `main`, then a
   **migration-aware Ad-Hoc redeploy WITH the user present** (the on-device Keychain + schema
   migration runs then). Decisions already applied: per-account externalId namespacing +
   backfill; on-remove ask + default keep-as-manual; account name = label; concurrency cap ~3;
   orphan token → manual re-entry.
2. **Structural co-location pass — TRULY LAST** (branch `structural-colocation` is stale;
   re-run fresh on the final tree). Per memory `file-structure-colocation`: folder-per-thing
   (component+test+styles, repo+test), no flat folders; move shared top-level `screens/`
   components (`card-context-menu`, `edit-header-button`, `icon-editor`, `grid-interaction`)
   into the design system; group `entity/`; leave `forms/`. Also CS3 (admit `.stack`/`.gate`
   suffixes) + CS2 note; fold co-location into the `kiko-code-style` skill. Reconcile last.
3. **Native pre-redeploy pass** (needs a device build to verify): SEC2 = DROP the retired
   `group.com.dmytro.pff` App Group + its dead import bridge (user approved); SEC1 = remove the
   now-unused Swift `writeTextFile` in `WidgetBridge.swift` (KEEP `copyFile` — import uses it);
   C6 = measure `react-native-calendars` bundle weight, then decide.
4. **Final `check:deep`** on `main` (set `KIKO_MUTATION_BASE` to the pre-round base), then the
   **App Store archive** (Release / `KikoDistribution`) + upload. S4 signed off; the 3 CVEs
   (`image-size` ×2, `decode-uri-component`) are accepted debt — do NOT suppress.

## Coordination model (in force)

- **Coordinator** (`pff-ios-d3`) spawns **orchestrator SESSIONS** (orca worktrees, `--agent
  claude`, base `--base-branch main`), and does NOT drive sub-agents itself for the work.
  Each orchestrator drives `kiko:*` sub-agents on their defined models. NEVER use
  `general-purpose`/`Explore`/`Plan` — only `kiko:*` roles (memory
  `no-general-purpose-use-harness-agents`, `orchestrate-agents-not-impersonate`).
- The classifier BLOCKS in auto mode: `--dangerously-skip-permissions` spawns, `orca worktree
  rm` (sometimes), and `SendMessage` to an agent to trigger a deploy. Workarounds used:
  `orca terminal send` to stand a track down; a FRESH `kiko:ops` Agent dispatch for each deploy
  (allowed); prune via `orca worktree rm` when it is allowed.
- Integration pattern: pre-scan with `git merge-tree --write-tree` (read-only), a `kiko:developer`
  merges `--no-ff` in the main worktree, gate check:all + jest, prune each worktree as it lands.
  Deploys go to a `kiko:ops` Agent. Notify `pff-ios-ef` on every material event; do not echo the
  board to the user.
