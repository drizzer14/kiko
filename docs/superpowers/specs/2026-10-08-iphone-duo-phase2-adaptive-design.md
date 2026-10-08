# iPhone Duo Phase 2 adaptive-layout design

Date: 2026-10-08
Status: user-approved design (brainstorming session, 2026-10-08)
Branch: `duo-adaptive`
Replaces: the Phase 2 section of
`docs/superpowers/specs/2026-09-21-iphone-duo-adaptive-layout-design.md`.

## Context and facts

Each fact names its source from the "Sources" list at the end.

- Simulator, Xcode 27.1 Duo (Xcode 27.1 Duo simulator captures, 2026-10-08):
  - closed portrait: outer display 1398x2034 px, vertical bars (status bar and tab bar) on the right;
  - inner landscape: 2853x2007 px, vertical bars on the right;
  - inner portrait: 2007x2853 px, horizontal bars (status bar top, tab bar bottom with labels).
- Apple guidance (HIG; Prepare page; Tech Talks 111461, 111462, 111463, 111466):
  - same hierarchy on both displays, with one extra level on the inner display (Mail);
  - split views collapse to one stack on the outer display and tile on the inner display;
  - the fold is a reserved region of kind `.division`, active only when partly folded, width 0
    when flat;
  - `traitCollection.verticalBarEdge` tells where the bars are;
  - size classes: outer portrait is compact width, inner is regular/regular; do not use idiom,
    orientation, or `UIScreen.main`;
  - from April 2027 every submitted app needs iPhone Duo screenshots (Prepare page; sizes: outer
    1398x2034 and 2034x1398; inner 2007x2853 and 2853x2007, screenshot specifications).
- User, 2026-10-08: the hinge is at the middle, depending on orientation. Inner landscape has a
  vertical fold line; inner portrait has a horizontal fold line. Apple does not state the fold
  axis (HIG).

## Goals

- A full adaptive layout per pose for the Duo and the iPad, in one system.
- Continuity: what the outer display shows continues in the primary pane of the inner display.
  State survives fold and unfold: one navigation tree, nothing remounts.

## Non-goals

- Landscape on regular iPhones. They stay portrait-only and always single-pane.
- Two copies of Kiko side by side in multitasking.
- Per-language-direction layouts. Apple keeps bars on the same side in RTL, and Kiko is en/uk.

## Section 1 - layout rule

`useLayoutMode()` returns `single`, `columns`, or `rows` from the horizontal size class and the
window shape. It never reads the device idiom (Apple: do not treat "regular width" as "iPad").

- Compact width gives `single` (regular iPhones, the Duo outer display, a narrow iPad window in
  Split View or Slide Over).
- Regular width, wider than tall, gives `columns` (Duo inner landscape, iPad landscape).
- Regular width, taller than wide, gives `rows` (Duo inner portrait, iPad portrait).

The two panes are EQUAL halves, so the fold falls between them. When partly folded the panes
keep a gap equal to the fold region frame. When flat (fold width 0) a hairline divider separates
them. Inside each pane, lists and forms are centered with a maximum width of 600 pt (a proposal;
the planner checks it against the iPad). Native bars stay where the system puts them. Panes
respect safe areas.

## Section 2 - pane mapping and navigation

The primary pane is what the outer display shows: right in `columns`, bottom in `rows`. The
companion pane is left in `columns`, top in `rows`.

Mapping, outer display to inner (companion | primary):

| Outer shows | Companion | Primary |
|---|---|---|
| Home | Statistics | Home |
| Statistics | Home | Statistics |
| Accounts (list) | accounts list | first account in the list (empty state "Add an account" when none) |
| Settings (menu) | settings menu | Categories |

If the stack already shows a detail screen (an account page, Help), that screen stays primary.

ONE RULE (user-confirmed): a screen opens in the pane OPPOSITE to the pane that opened it. When
it closes, that pane shows again what it showed before. Examples:

- The transaction form opened from Home (right) opens on the left, in place of Statistics.
- On the Statistics tab, a transaction tapped in Home (left) opens on the right, in place of
  Statistics.
- A list row opens its detail on the right (replace, not push; the row is highlighted).
- A holding form opened from an account page (right) opens on the left, in place of the list.

Fold and unfold use one React Navigation state per tab:

- Unfold: the list part goes to the companion pane and the top screen to the primary pane.
- Fold: the outer display shows the top screen with a back button (for example the transaction
  form, back to Home; an account page, back to the list).
- A default selection the user did not tap (first account, Categories) does NOT survive a fold;
  the outer display then shows the list. A tapped selection survives.

Sheets and modals keep their current behaviour over both panes; the system moves sheets off the
fold.

Cost: Home and Statistics screens are mounted in both tabs, so more live queries run once both
tabs have been opened. The planner measures it.

## Section 3 - fold, bars, native bridge

Own Swift module `DisplayRegions` (codegen spec, no new dependency; precedent: the native blur in
`ios/Kiko/SceneDelegate.swift`) exposing live values:

- `horizontalSizeClass`: `compact` or `regular`.
- `verticalBarEdge`: `leading`, `trailing`, or `none`, from `traitCollection.verticalBarEdge`.
- `foldRegion`: the `reservedRegions(.division)` frame in window points, or null when flat or on
  other devices.

JS does all layout.

- Fold: the gap equals `foldRegion` while partly folded. System sheets, alerts, and menus need
  nothing. Scrollable lists may cross the fold (HIG).
- Bars: native bars stay untouched. The Phase 1 "sidebar mode" guess (tab-bar height over 50% or
  a side inset) is REPLACED by `verticalBarEdge`. Content stays clear of bars through safe
  areas. Our floating controls follow `verticalBarEdge`: the "+" button sits next to the
  vertical tab bar, and bottom right when the bars are horizontal.
- Older systems (iOS before 27.1, or an older SDK): `none` and null, so today's behaviour holds.
  An iOS 27.1 SDK build extends to the full display with vertical bars; older SDK builds are
  letterboxed (Prepare page).

## Section 4 - testing and delivery

Change sets, each at most 30 source files with one mutation gate each:

1. Base: bring `duo-adaptive` up to `main`; keep the Phase 1 fixes.
2. Native bridge and hooks: `useLayoutMode`, `useVerticalBarEdge`, `useFoldRegion`.
3. `TwoPaneLayout`: halves, fold gap, width cap.
4. Navigation: the opposite-pane rule, defaults, fold/unfold mapping.
5. Screens: Home and Statistics first, then Accounts and Settings.

Nothing is merged directly from `ipad-adaptive`; it supplies ideas only.

Unit tests:

- each layout-mode row, with a mocked native module;
- `TwoPaneLayout` placement, fold gap, and width cap;
- the navigation rule: opposite pane, close restores, a default does not survive a fold, a tapped
  selection survives, fold mapping with a back button;
- the older-system path.

Simulators: the Duo in all three poses (the user sets the pose in Device Hub; ops captures; the
screenshots become the App Store Duo set), iPad landscape and portrait, and a regular iPhone
regression. Known tooling limits: the Device Hub window shows a spinner on the inner display
while the framebuffer is fine, and the CLI cannot navigate (Xcode 27.1 Duo simulator captures, 2026-10-08). A real Duo device check
follows after 2026-10-23 if a device is available.

Release: a later build, archived with Xcode 27.1, before April 2027.

## Open questions

- The exact width cap (600 pt is a proposal).
- Whether both Duo screenshot sets (outer and inner) are required; Apple's page does not say.

## Sources (checked 2026-10-08)

- HIG, designing for iPhone Duo:
  https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo
  (JSON form: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/designing-for-iphone-duo.json)
- Prepare your app for iPhone Duo: https://developer.apple.com/iphone-duo/prepare/
- Apple developer news: https://developer.apple.com/news/?id=kkphp5qo
- App Store Connect screenshot specifications:
  https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- Tech Talk, Prepare your app for iPhone Duo:
  https://developer.apple.com/videos/play/tech-talks/111461/
- Tech Talk, Raise the bar with iPhone Duo:
  https://developer.apple.com/videos/play/tech-talks/111462/
- Tech Talk, Strike a pose with adaptive layouts on iPhone Duo:
  https://developer.apple.com/videos/play/tech-talks/111463/
- Tech Talk, Design for iPhone Duo:
  https://developer.apple.com/videos/play/tech-talks/111466/
- SwiftUI reserved regions: https://developer.apple.com/documentation/swiftui/reservedregion
- UIKit reserved regions: https://developer.apple.com/documentation/uikit/uiview/reservedregion
