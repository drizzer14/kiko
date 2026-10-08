# iPhone Duo adaptive-layout design

Date: 2026-09-21
Status: approved design (from brainstorming session) — this document records the plan, it does not introduce new scope.
Branch: `duo-adaptive` (off `next`)

## Context

The iPhone Duo (simulator device type, model `iPhone19,4`, minRuntime iOS
27.1) is a new foldable-class / dual-panel iPhone. It exposes two
independent physical display panels plus a large resizable scene surface;
only the primary panel renders the app. **We target the PRIMARY PANEL
ONLY. Spanning both panels is explicitly out of scope.**

Measured render geometry on the primary panel (read live from the running
app via the Hermes/CDP inspector reading `RNCSafeAreaContext`/`DeviceInfo`
native constants and the React fiber tree):

- Window: 466 x 678 pt, scale 3
- Safe-area insets: top 0, bottom 34, left 0, right 84

iOS treats 466 pt as a **regular horizontal size class** (evidenced by the
84 pt right inset). At regular width, Apple's native tab-bar machinery
moves `react-native-bottom-tabs`' SwiftUI `TabView` to a **right-edge
sidebar** presentation. This is OS behavior; `sidebarAdaptable` is **not**
set in this repo.

## Problem / root cause

Single, shared root cause for all 3 reported bugs; category = native
scene/trait machinery, **not** a missing JS responsive layout.

In sidebar mode the native tab bar reports its height as the **full
screen height** (678 pt) instead of a short bar. Source:
`node_modules/react-native-bottom-tabs/ios/TabViewImpl.swift:76-78`
(`onTabBarMeasured(Int(tabController.tabBar.frame.size.height))`).
Confirmed live: `BottomTabBarHeightContext` = 678.

The app trusts this value in one shared formula:
`resolveBottomClearance(tabBarHeight, insetBottom) = max(tabBarHeight -
insetBottom, 0)` at
`src/design-system/components/screen/bottom-clearance.ts:18`. So
`bottomClearance = 678 - 34 = 644`, and every `Screen` footer gets
`paddingBottom = 16 + 644 = 660`
(`src/design-system/components/screen/screen.styles.ts:84-88`), producing
a ~676 pt footer `View` that covers the screen.

Three reported bugs, all this one cause:

1. **Add-transaction FAB "missing" on Home** — the FAB was not covered
   by the native sidebar chrome. The same poisoned `bottomClearance`
   pushed it off-screen: `bottom: bottomOffset + 16` with
   `bottomOffset = 644` put the 56 pt circle at roughly y = -38 on a
   678 pt-tall window, above the top edge
   (`src/screens/home/add-transaction-fab/add-transaction-fab.styles.ts:14`).
   Confirmed on the Duo simulator.
2. **Settings shows only the title** — the cards render correctly and
   are correctly positioned; the giant ~676 pt footer sibling `View`
   (`screen.component.tsx:119-123`) covers them (later JSX sibling =
   higher z-order). The native large "Settings" title is a separate
   UIKit layer, so it stays visible.
3. **Accounts "Add account" button behind the header** — the same
   poisoned `bottomClearance` collapses the footer to the top,
   overlapping the large-title header band. Header height is also
   reported as 0 on the active stack (`HeaderHeightContext` = 0 on the
   focused stack vs 82 on backgrounded stacks) — a second symptom of the
   same scene anomaly.

## Goals

- **Phase 1**: the app renders correctly and is usable on the Duo
  primary-panel regular-width scene with the native right sidebar. No
  visual redesign.
- **Phase 2**: the wide regular-width canvas gets a real adaptive
  layout, and iPad + Duo share ONE adaptive system.

## Non-goals

- Spanning both panels as one surface. (Phase 2 now uses the inner display as its own adaptive
  layout; see the Phase 2 spec.)
- Any change to the submitted 1.0.0 / build 20 (this track is parallel;
  branch off `next`).
- Patching `node_modules`/`react-native-bottom-tabs` native code (fix in
  our own JS layer).

## Design — Phase 1 (correctness)

1. **Robust clearance**: change `bottom-clearance.ts` so it rejects an
   implausible native tab-bar height (the sidebar full-screen-height
   misreport) and derives bottom clearance from the bottom safe-area
   inset in that case. One function, unit-tested with the real numbers.
2. **One sidebar-detection helper**: a single function decides "the tab
   bar is not at the bottom" from geometry (implausible tab-bar height,
   and/or a nonzero horizontal safe-area inset). `Screen` and the FAB
   both key off this one helper so they never disagree.
3. ~~**FAB position**~~ — DROPPED as unnecessary. `Screen`'s
   `SafeAreaView` already reserves the left/right safe-area insets
   (`edges={['left','right','bottom']}` at
   `src/design-system/components/screen/screen.component.tsx:18`, used
   at :76 and :161; the plain branch at :179 has no `edges` prop, which
   defaults to all edges), and the FAB is positioned relative to that
   already-inset content. Confirmed on-device: adding an app-level
   right-inset offset on top of it floated the FAB in the middle of the
   screen (128-182 pt) instead of at the content's right edge. Reverted
   in commit `e505081`.
4. **Zero header height**: stop the footer/clearance depending on a
   header height that reports 0 on the active stack; floor it or read a
   robust value.
5. ~~**Horizontal insets**~~ — DROPPED as unnecessary, same root cause
   as item 3: `Screen`'s `SafeAreaView` already reserves the left/right
   safe-area insets, so having `Screen` apply them again double-counted
   them. Confirmed on-device: content shrank from 350 pt wide to
   266 pt. Reverted in commit `e505081`.

The real Phase 1 fix is items 1 and 2 — robust clearance that ignores
the poisoned tab-bar height, behind one shared sidebar-detection
helper — plus item 4, the zero-header-height floor. Items 3 and 5 were
unnecessary and reverted, as noted above.

**Testing**: unit tests feeding the real measured case (466x678, right
84, tabBar 678); Duo-sim screenshot verification; regression check that
a normal iPhone (bottom bar) is unchanged.

## Design — Phase 2 (adaptive layout)

Phase 2 is specified in
`docs/superpowers/specs/2026-10-08-iphone-duo-phase2-adaptive-design.md`
(user-approved 2026-10-08). It replaces the earlier plan to re-apply the `ipad-adaptive`
pattern; the inner display is now in scope.

## Existing foundation to reuse

From the parked `ipad-adaptive` branch
(`/Users/drizzer14/orca/workspaces/pff-ios/ipad-adaptive`):

Reusable, width-driven, compliance-safe pieces:

- `design-system/unistyles.ts` `breakpoints` {xs:0, sm:500, md:768,
  lg:1024}
- `design-system/use-is-at-least-breakpoint.ts` (`useIsAtLeastBreakpoint
  = useWindowDimensions().width >= breakpoints[bp]`)
- `design-system/components/two-pane-layout/` (master/detail, detail
  only renders when the caller passes it)
- `theme.ts` `layout` tokens {contentMaxWidth:700, masterPaneWidth:360,
  twoPaneGap:24}
- `Screen` gains `releaseWidthCapAtLarge` + `topClearance`

**Caveats (document these):**

(a) `ipad-adaptive` is a **stale base** vs `next` — it lacks `next`'s
`Screen` keyboard-inset props, the Settings Import/Export card, and it
diverges on the Card vs GlassSurface system; so **re-apply** the
pattern, do not merge.

(b) Its breakpoint numbers are iPad-calibrated and need recalibration.

(c) It still contains `src/screenshot/screenshot-mode.ts` + a
`SCREENSHOT_MODE`-gated prop in `Screen` — **must not** be reintroduced
(5.6).

(d) Its `sidebarAdaptable`/`topClearance` is iPadOS-specific and
unverified on the Duo.

## Testing

See the per-phase Testing subsections above:

- Phase 1: unit tests feeding the real measured case (466x678, right
  84, tabBar 678); Duo-sim screenshot verification; regression check
  that a normal iPhone (bottom bar) is unchanged.
- Phase 2: unit tests for breakpoint/mount-gating; the `ipad-adaptive`
  tests re-applied; Duo-sim visual verification; iPhone + iPad
  regression.

## Track & branching

Branch `duo-adaptive` off `next` (build 20 / 1.0.0). Parallel to the App
Store submission; does not touch build 20. The parked `ipad-adaptive`
branch is a reference and is retired once its pattern is re-applied.

## Open questions

- The exact JS signal for "sidebar mode": an implausible-tab-bar-height
  guard vs a horizontal-size-class read vs the right-inset. Phase 1
  will pick the most robust; the plan will settle the exact threshold.
- Whether Settings should adopt two-pane in Phase 2 or stay
  single-column with a width cap.
- Whether the Duo exposes a second scene state we could not toggle via
  `simctl` (no fold verb found); if a second state appears, re-verify
  geometry.
