# Redesign feedback — remaining bugs (user-reported, 2026-09-01)

The 15-task plan (`2026-09-01-redesign-feedback-review.md`) has scaffolding in
the worktree but several items do NOT actually work. A keyword audit falsely
reported them done. These are the real, user-observed gaps:

- [ ] **B1 — Bottom navbar still bugged** (plan Task 4 / Task 8). Define the
  exact misbehavior with the user (color change on press? covering content?
  back-nav?). Verify against `react-native-bottom-tabs` options.
- [ ] **B2 — Accounts and Settings screen titles not visible** (plan Task 3).
  The scrollable large-title `Screen` did not fix the header; titles are
  missing/hidden.
- [ ] **B3 — Account, Holding, HoldingForm screen titles broken** (plan Task 5
  title block). Titles wrong/missing on these stack screens.
- [ ] **B4 — Categories not seeded** (plan Task 13). The `categories` table is
  empty → Categories screen shows nothing and every transaction renders
  "Uncategorized" (Task 14 resolve has no data). The seed migration did not run
  or did not populate on the existing DB.
- [ ] **B5 — "Add account" button covered by the bottom nav bar** (plan Task 10).
  The footer does not clear the floating glass tab bar height + safe area.
  (A developer is mid-fix on the footer; must add tab-bar-height clearance.)
- [ ] **B6 — Accounts render as one single box, not separate cards.** Each
  account should be its own card/`GlassSurface`, not all inside one container.

## Notes
- All in worktree `/Users/drizzer14/orca/workspaces/pff-ios/pff-redesign-phase-1`,
  commits held; safety tag `pre-recovery-backup`.
- Verify each fix on sim `EC8E0DAA-548D-47B0-BB46-CD538331A639` via
  `xcrun simctl io <udid> screenshot` — keyword checks are NOT sufficient.
- The user will iterate on design in a fresh session; this list is the concrete
  starting backlog.
