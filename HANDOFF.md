# HANDOFF — App submitted to the App Store (2026-09-12)

**Read first:** the live board `BOARD.md` (kept by the standing `kiko:pm` session `pff-ios-ef` —
ask it for a ground-truth snapshot). Then the memory index
`~/.claude/projects/-Users-drizzer14-Developer-Projects-pff-ios/memory/MEMORY.md`. Verify against
git + orca; do not trust this file over ground truth.

## Current state

- **Build 3 is SUBMITTED for App Store review** (marketing 1.0, build 3). Archive was
  `~/Library/Developer/Xcode/Archives/2026-09-12/Kiko-build-3.xcarchive`, all invariants verified,
  uploaded by the user. Awaiting Apple review.
- **`main` is PUSHED** to `origin` (`git@github.com:drizzer14/kiko.git`, repo is PUBLIC). No git
  release tag yet — the `vX.Y.Z` tag/GitHub release is created ONLY after the App Store publishes
  (memory [[release-after-appstore-publishes]]).
- **Privacy policy is LIVE** on GitHub Pages from a dedicated `gh-pages` branch (so hosting did not
  require pushing app history): `https://drizzer14.github.io/kiko/` (uk primary) and `/en.html` (en).
  Sources: `docs/privacy-policy.md` (uk), `docs/privacy-policy.en.md` (en).
- All Orca worktrees are pruned; only `main` remains. Standing PM = `pff-ios-ef`.

## What shipped this session (all green: check:all + jest)

- **Bottom-sheet fixes** — the scrim's Liquid Glass rim pushed off-screen (32pt overscan, blur kept),
  and the drag-to-close grab zone raised to a 44pt `minHeight`. User LGTM on-device.
- **Categories glass first-paint fix** — the `clear` bloom material samples once at native layout, and
  a `react-native-sortables` card's transform settles progressively, so lower cards read transparent.
  Fix = `useBloomResample` hook (`glass-surface.resample.hook.ts`) that re-samples once the card's
  composited position settles. Bloom intact. User LGTM on-device.
- **`.env` untracked + auto-generated** — `.env` is gitignored; `scripts/ensure-env.js` (postinstall,
  after patch-package) copies `.env.example` → `.env` when missing. `.env` is public-only.
- **`kiko:release` skill** — `harness/kiko/skills/release/SKILL.md` (semver vX.Y.Z tags, user-facing
  changelog, version sync, App Store archive checklist; never attaches builds to GitHub).
- **Screenshots infra merged** — 10 uk marketing PNGs (`screenshots/appstore/6.9-inch/uk/`, 1320x2868)
  plus a 6.5" resized set (`screenshots/appstore/6.5-inch/uk/`, 1284x2778, for the listing's 6.5" slot);
  a stable-glass pixelmatch regression suite (`check:screenshots` / `:empty` / `:locked`). The seed is
  dev/test-only; net worth ~151k UAH, volatile net-worth line.
- **Export compliance** — `Info.plist` declares `ITSAppUsesNonExemptEncryption = false` (standard/exempt
  crypto: SQLCipher AES + HMAC). Build 3 was answered manually; builds 4+ skip the prompt.
- **Proper README** — replaced the RN-CLI boilerplate with a real Kiko README (uk `README.md` primary,
  en `README.en.md`).

## Notes for the next session

- **check:screenshots is a BUILD-RECIPE, not a code issue** — it needs an EMBEDDED build (Maestro has
  no Metro): FORCE_BUNDLING + clean + pod install + grep the jsbundle for the `isStableGlass` marker +
  OpenJDK 21. See memory [[screenshot-build-recipe]].
- **Scribe follow-ups (deferred):** update the `kiko:release` skill's "First release" section to
  separate the tag-less archive step from the post-publication release; optionally fold the screenshot
  build recipe + App Store submission gotchas into `docs/` or the ops skill (the user said DO NOT edit
  CLAUDE.md for the recipe — confirm first).
- **Backlog:** the user asked to "proceed with our backlog" in the fresh session — ask PM `pff-ios-ef`
  for the live board / read `BOARD.md` to establish it before starting.

## Coordination model (in force)

- I am the **worktree coordinator, not an agent orchestrator** (user re-correction 2026-09-12). Spawn
  orchestrator SESSIONS (`orca worktree create --agent claude --base-branch main`, verify head == local
  main) that drive the `kiko:*` agents; do NOT drive role agents directly, even for small or read-only
  tasks. Integration (pure `git merge` + gate check:all/jest + prune), memory, and PM/peer messaging are
  mine and stay direct. Deploys/archives via a fresh `kiko:ops` Agent are allowed. Notify `pff-ios-ef`
  on every material event; do not echo the board to the user. Repo id for `orca`:
  `d1d4f630-dcc4-4263-9912-1a82f56c380e`.
