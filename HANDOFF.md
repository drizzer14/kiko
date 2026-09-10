# HANDOFF — Phase B3 complete + deployed (2026-09-10)

**Read first:** the live board `BOARD.md` (now GITIGNORED — a local status file the
user watches; kept by the standing `kiko:pm` session). Then verify against git +
orca. Do not trust this file over ground truth.

## Current state

- `main` @ `8fba6ec` — **local only, NOT pushed, NOT on the App Store.**
- Phase A + B + B2 + **B3** are all merged to `main` and **deployed to the device**
  (build + install + launch verified; fresh forced bundle; data container `149343BE`).
- Only the `main` worktree remains. All feature/orchestrator worktrees are pruned.

## What Phase B3 was (feedback from the on-device B2 review)

Bugs + design rework, both reviewer-approved, integrated rolling:
- **R1** sync progress count grew on repeated pull-to-refresh → a single-flight JOIN
  over the pull fan-out (`use-sync-all.ts`); it was a display miscount, no data dup.
- **R4** net-worth dip on a card→bond move → a held bond is now valued at **cost**
  (purchase price), not face value, until maturity (`holding-value.ts`); the maturity
  redemption still realizes nominal. (User decision: value at cost.)
- **Design:** reverted the earlier button-audit shrink of sheet/modal action rows;
  added Button `size="small"` (34pt visible, 44pt tap via `hitSlop`) + `variant="secondaryTonal"`
  (faint `neutralSubtle` tint); categories Delete now reuses the contributions "Remove"
  (`destructiveTonal` + trash icon); trend-filter Apple-HIG redesign (standard accent
  selection, list-only scroll, Clear+Save both disabled until dirty).

## Gate + deploy notes

- The **B3 mutation gate was SKIPPED this round by explicit user directive** — the run
  exceeded ~1h20m because it mutated the i18n string catalogs. Both B3 tracks were
  reviewer-approved and `check:all` is green. **osv ran standalone = GREEN** (only the 3
  accepted advisories: decode-uri-component, image-size ×2; no new CVE).
- A **harness improvement** shipped alongside (merge `8fba6ec`): the mutation step now
  writes a tailable **progress log** + prints a **Jenkins-style ETA** from run history,
  **excludes** i18n locale catalogs + `*.d.ts` from the mutate-set, and **trims** the
  Stryker sandbox (`vendor/`, `coverage/`, `docs/`, `.superpowers/`). So the NEXT mutation
  run is far shorter and watchable. Re-run `check:deep` on `main` when convenient to get a
  B3 mutation score for the record (now fast).

## CORRECTED coordination model (in force — read this)

The user corrected the session model mid-round (see memory
`orchestrate-agents-not-impersonate`, `autonomous-orchestrator-cannot-approve`,
`board-gitignored-standing-pm`):
- **Coordinator** (this session, `pff-ios-d3`) keeps the project together: spawns +
  coordinates ORCHESTRATOR sessions, talks to the user, holds memory. It does NOT drive
  sub-agents itself, only what its direct role needs.
- **Orchestrator sessions** (one per piece of work, own worktree) drive `kiko:*`
  SUB-AGENTS via the Agent tool — each on its DEFINED model (sonnet/haiku for
  design/qa/ops/pm; opus for developer/reviewer/planner/debugger). Do NOT spawn full opus
  sessions that role-play one agent (that burned the subscription).
- **Board:** `BOARD.md` is gitignored; a standing `claude --agent pm` (sonnet, auto mode)
  session (`pff-ios-ef`) is its single writer, notified by the coordinator on events.
- **Autonomous sessions cannot run approval-gated commands** (`rm`, deploy, scans) — no
  human to approve. Run those from the interactive coordinator (user present) or the user
  via `! `; never launder a peer's denied action.

## Pending scribe tasks (plugin drift found by the retrospect — not yet fixed)

1. `harness/kiko/skills/harness-workflow/SKILL.md` and CLAUDE.md's **"Delegation rule"**
   still state the OLD model (delegate to sessions, never the Agent tool). Update them to
   the corrected model above. (The corrected model IS in memory, so a resumed session is
   not misled, but the plugin text is stale.)
2. `src/screens/settings/categories.screen.tsx` ~lines 42-46, 67-68: stale
   "compact ghost Button" comments — the calls now use `size="small"`. Trivial doc fix on
   the next design touch.

## Next phase — Final Hardening (before App Store), per BOARD.md

Three read-only audits in PARALLEL, then consolidate → one fix pass → final deploy → App
Store: bug-hunt (whole-app) · security analysis · Phase C performance + bundle-size (C1–C5)
· screenshot / visual-regression tests (`docs/research/2026-09-10-simulator-screenshot-tests.md`)
· full-repo ponytail (over-engineering) + codestyle pass, including the "group non-component
files into feature folders" structural refactor.

## Sessions + docs

- `pff-ios-d3` — coordinator (this session). `pff-ios-ef` — standing `kiko:pm` board writer.
  All B3 role/orchestrator sessions closed.
- Phase B2 plan: `docs/superpowers/plans/2026-09-10-phase-b2-fix-round.md`; B2 diagnosis:
  `docs/debug/2026-09-10-phase-b2-diagnosis.md`; iOS HIG audit:
  `docs/design/2026-09-10-ios-hig-audit.md`.
- Memory index: `~/.claude/projects/.../memory/MEMORY.md`.
