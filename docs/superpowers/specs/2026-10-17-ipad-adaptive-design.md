# iPad adaptive-layout design

Date: 2026-10-17
Status: user-approved design (2026-10-17, as is, all 8 orchestrator calls accepted). User rulings:
direction B (round 2), portrait stacked (round 3), a live iPad device check before merge.
"Orchestrator call" marks a choice the user did not make in the brainstorming; the user accepted
each one at approval.
Branch: `ipad-phase3`, stacked on `duo-adaptive` 5a3dacaf.
Builds on: `docs/superpowers/specs/2026-10-08-iphone-duo-phase2-adaptive-design.md` (the layout
rule, the panes, the pane navigation) and its Phase 1 spec.

## Context and facts

Each fact names its source from the "Sources" list at the end. "Repo" facts are at 5a3dacaf.

- Repo: the app is iPhone-only. `TARGETED_DEVICE_FAMILY = 1` at
  `ios/Kiko.xcodeproj/project.pbxproj:370, 406, 672`. Today iPad users get the scaled iPhone app
  (compatibility mode; forum report, not an Apple page).
- Repo: `resolveLayoutMode` (`src/display-regions/layout-mode/layout-mode.ts:8-18`): compact width
  gives `single`; regular width gives `rows` when taller than wide, else `columns`. No width
  threshold exists. Panes are equal halves. In two-pane modes only, screen content is capped at
  `paneMaxWidth` 600 (`paneCap` in `src/design-system/components/screen/screen.styles.ts`); `single`
  has no cap. A BottomSheet in split modes is capped at `sheetMaxWidth` 540 (`theme.ts:72-73`), and
  its frame comes from `resolvePaneGeometry` too (`bottom-sheet.layout.ts` `centredFrame`).
- Repo: a detail opens in `oppositePane(config.rootPane)` (`pane-assignment.ts` `openFrom`). Home
  and Statistics stacks have `rootPane: 'primary'`, so details open in the companion pane. In the
  approved Duo, Statistics is the left (companion) pane on the Home tab and the right (primary) pane
  on the Statistics tab: it already changes sides between the two tabs.
- Repo: `Info.plist` already has the scene manifest (single scene,
  `UIApplicationSupportsMultipleScenes` false), all four orientations under
  `UISupportedInterfaceOrientations~ipad`, a launch storyboard, and no `UIRequiresFullScreen`.
- Apple (TN3192): from the iOS 27 / iPadOS 27 SDK, `UIRequiresFullScreen` no longer opts out of
  resizing; "the system resizes your app's scene discretely". A resizable app needs a launch
  screen, all orientations, and no `UIRequiresFullScreen`.
- Apple (TN3187): the UIScene lifecycle is required after iOS 26; multiple windows are not.
- Apple (screenshot specifications): an app that runs on iPad needs at least one 13-inch iPad
  screenshot (2064x2752 or 2048x2732 portrait, or the landscape sizes).
- Apple (App Review Guideline 2.4.1): "iPhone apps should run on iPad whenever possible."
- Forums (QA1623 as quoted there; Apple text not fetched): App Store Connect refuses an update that
  supports fewer devices than the live version. This design treats the iPad family as ONE-WAY.
- Apple (HIG Layout): decide layout by size class, never by device type or orientation; "Don't
  change your app's functionality based on the space it occupies." Apple publishes no numeric
  size-class thresholds. Third-party sources: full screen and 1/2, 2/3 Split View are regular width
  on large iPads; 1/3 and Slide Over are compact; 1/2 is compact on most smaller iPads.
- React Native 0.87.1 (`RCTActionSheetManager.mm:52-77`): on iPad an action sheet or share sheet
  with no anchor shows as a popover on the parent view with no arrow. It does not crash.

## Goals

- Kiko runs natively on iPad, with the same device-agnostic layout rule as the Duo (Duo spec
  Section 1). No code reads the device idiom.
- Every window size from 320 to 1366 pt works, because iPadOS 27 can resize any app (TN3192).
- The approved Duo panes and shared components carry over. A new iPad visual exists only where the
  user approves it (see "Direction", open).
- The iPad uses its large screen for a dashboard: the Statistics cards in a reflowing grid, beside
  the transactions on a wide window (user ruling 2026-10-17, direction B).

## Non-goals

- Two Kiko windows side by side (multiple scenes stay off; TN3187 does not require them).
- Landscape on regular iPhones (unchanged: portrait only, single pane).
- Old `ipad-adaptive` code. It supplies ideas only (Duo spec line 139). Its `SCREENSHOT_MODE` and
  seed code never come back (Guideline 2.3.1(a) rule, CLAUDE.md).
- A Mac Catalyst or "Designed for iPad on Mac" build.
- Per-device layouts (no iPad mini special case): only size class and window size decide.

## Direction (user ruling 2026-10-17, round 2: B "wide dashboard split")

The user's theory: use the big screen for a proper dashboard. After a survey of finance apps on
iPad (Copilot and Monarch: sidebar + dashboard; YNAB and Apple Stocks: list/detail, Stocks ~1/3 to
~2/3), the user chose B: the Statistics pane becomes a card grid that reflows by its own width, and
a wide window splits ~2/3 dashboard and ~1/3 Home. The native tab bar stays. The Duo stays as
approved. The new visual needs the user's approval on the simulator before merge.

## Section 2 - layout at iPad sizes

All rules key off the size class and the window or pane width, never the device idiom (Duo spec
Section 1, HIG Layout).

1. Reflowing card grid. The Statistics screen lays its cards out in columns by its own content
   width W (the pane width, or the window width in `single`):
   - 1 column when W < 700 pt;
   - 2 columns when 700 <= W < 1000 pt;
   - 3 columns when W >= 1000 pt.
   The 700 pt floor is above the widest Duo pane (inner portrait, ~669 pt), so every Duo pose keeps
   one column: the approved Duo visual does not change. A jest pin holds this (every Duo pane width
   gives 1 column). The values are proposals that the simulator check confirms.
   - The cards are the existing Statistics cards (`Card padding={4} radius="lg"` + heading + chart),
     unchanged. The filter bar stays at the top, full grid width.
   - At 2+ columns the grid replaces the `paneMaxWidth` 600 content cap for the Statistics pane only;
     the grid has its own outer margin. Other screens keep the 600 cap.
   - Grid shape (orchestrator call): row-aligned, no masonry. The net worth over time card spans the
     full grid width as the first row; the other four cards follow in their current screen order,
     left to right, top to bottom. Each row is as tall as its tallest card; cards stretch to the row
     height. The user approves the look on the simulator.
   - The grid does not re-lay-out while the user interacts (HIG Collections): the column count
     changes only on a window or pane width change.
   - No reordering or hiding of cards in this track (that was direction C).
2. Wide split. When the size class is regular, the window is wider than tall, and the window width
   is at least 1100 pt, the panes are unequal: the companion (left) gets ~2/3 and the primary
   (right) ~1/3, with the same hairline divider. Below 1100 pt the equal halves stay.
   - 1100 pt is above the Duo inner landscape (~951 pt), so the Duo keeps equal halves.
   - It is below every iPad full-screen landscape width (1133 mini to 1376 13-inch), so every iPad
     landscape gets the dashboard split. A 2/3 Split View on a 13-inch iPad (~910 pt) keeps halves.
   - The ratio belongs to a pane SLOT, fixed per tab (orchestrator call). It never changes on a
     tap, so the layout never jumps while the user works (HIG Collections).
     - Home tab: the companion slot (left, holds the Statistics dashboard) gets 2/3; Home 1/3.
     - Statistics tab: the primary slot (right, holds the Statistics dashboard) gets 2/3; the Home
       companion 1/3. The dashboard changes sides between these two tabs, as Statistics already does
       in the approved Duo.
     - A detail opened from the 1/3 pane (for example a transaction from Home) replaces the
       dashboard in the 2/3 slot, as in the Duo. It keeps the 600 pt content cap, centered.
     - Accounts and Settings tabs keep equal halves (a list beside a detail does not gain from 2/3).
   - `resolvePaneGeometry` takes the split ratio as an input; `TwoPaneLayout` and the BottomSheet
     `centredFrame` both pass the same value, so a sheet frame matches the panes.
   - Pane width at 1366: ~910 (dashboard, 2 columns) and ~455 (Home). The BottomSheet keeps its
     540 pt cap.
3. Minimum pane width: two panes only when each pane is at least 360 pt. A regular window narrower
   than 2 x 360 + divider (~721 pt) shows `single`. This covers narrow Split View and Stage Manager
   windows that report regular width (HIG Split views: "Set reasonable defaults for minimum and
   maximum pane sizes"). In `rows` the same 360 pt minimum applies to each pane's HEIGHT. The Duo
   inner panes (landscape ~475 wide; portrait ~669 wide x ~475 tall) stay above 360, so the Duo is
   unchanged; a jest pin holds this. A regular, taller-than-wide window narrower than 721 pt (for
   example a Stage Manager window) still gets `rows` when each pane is at least 360 pt tall.
   - The Duo pane sizes these thresholds rely on (~475, ~669, ~951) are approximate here. The plan
     takes the exact values from the Duo jest fixtures (for example
     `bottom-sheet.component.layout.test.tsx`), and the pins use those values.
   - Resizing across a threshold (721 or 1100 pt) uses the existing fold/unfold path and the 150 ms
     `SETTLE_DELAY_MS`. iPadOS 27 applies a resize when the drag ends ("resizes your app's scene
     discretely", TN3192), so a drag does not cross a threshold many times. The simulator check
     confirms that no detail route is lost on a Stage Manager resize; hysteresis is added only if it
     shows a problem.
   - `single` on a regular window also caps screen content at 600 pt, centered (orchestrator call).
     No iPhone or Duo outer window is wider than 600 pt, so their visuals do not change.
4. Portrait (user ruling 2026-10-17, round 3: stacked, the Duo rule unchanged). A portrait iPad
   (744-1032 pt wide) is below 1100, so regular width + taller than wide gives `rows`: the
   companion on top, the primary below, equal halves. On the Home tab: the dashboard strip on top
   (2 columns at 744-999 pt; 3 columns at 1000-1032 pt, the 13-inch iPad), the transactions below.
   Each pane is ~560-690 pt tall. The simulator check confirms the 3-column strip on the 13-inch.

## Screen mapping summary (iPad)

| Window | Mode | Home tab |
|---|---|---|
| compact (Slide Over, 1/3 split) | single | Home |
| regular, wider than tall, < ~721 pt | single (min pane rule) | Home |
| regular, taller than wide, pane height < 360 | single (min pane rule) | Home |
| regular, landscape 721-1099 pt | columns, halves | Statistics (1 col) / Home |
| regular, landscape >= 1100 pt | columns, 2/3 + 1/3 | dashboard (2 cols) / Home |
| regular, portrait | rows, halves | dashboard strip (2-3 cols) above Home |

## Section 1 - device family and App Store compliance

1. Set `TARGETED_DEVICE_FAMILY = "1,2"` (quoted form, as the old branch needed for the pbxproj
   parser) in all three build configurations.
2. Keep `Info.plist` as it is: single scene, iPhone portrait only, iPad all four orientations,
   launch storyboard, no `UIRequiresFullScreen`. Add `check:plist` invariants (kiko-linter) so the
   iPad keys cannot drift:
   - `UISupportedInterfaceOrientations~ipad` lists all four orientations;
   - `UIRequiresFullScreen` is absent;
   - `UIApplicationSceneManifest` is present.
   A pbxproj invariant pins `TARGETED_DEVICE_FAMILY = "1,2"` in all three configurations.
3. Launch screen: the storyboard background follows the dark-only app (no white flash on a large
   screen). Verify it against TN3208 (not yet fetched; researcher item for the plan stage).
4. The family flip is one-way. The release that first ships it needs, before upload:
   - 13-inch iPad screenshots (portrait and landscape), from the existing e2e screenshot pipeline
     outside app `src/` (2.3.1(a) rule), never iPhone frames;
   - the reviewer kit and review notes updated for iPad (kiko:release);
   - a full iPad pass of every screen in the reviewer kit on the iPad simulator and, if available,
     an iPad device (2.4.1, 2.1: a broken iPad layout is a rejection risk).
5. kiko-compliance review of the family flip: no hidden feature (the iPad layout ships visible),
   no new permission, no new network domain. `NSFaceIDUsageDescription` stays (Face ID iPads).
6. Release placement (user ruling 2026-10-17): the iPad ships in its OWN release after 1.3
   (1.3 = exchanges), and only after Duo is on main. The device-family flip lands only in that
   release, never in a 1.3 build: no 1.3 release branch or 1.3 archive may carry
   `TARGETED_DEVICE_FAMILY = "1,2"`. The layout work (Section 2) is device-agnostic and may reach
   main earlier only if it is a no-op for iPhone and Duo; the family flip itself merges to main
   only when 1.3 has shipped or has its own release branch.

## Section 3 - tab bar, bars, and clearance (verification first)

- Repo: `src/navigation/root-navigator/root.navigator.tsx:44` (props 44-59) uses `createNativeBottomTabNavigator` (react-native-bottom-tabs,
  SwiftUI TabView) without `sidebarAdaptable` (library default false).
- On iPadOS 18+ a SwiftUI TabView at regular width shows a floating tab bar at the TOP. The app's
  clearance (`use-bottom-clearance.ts`, `bottom-clearance.ts`) handles only a bottom or a vertical
  bar. There is no top clearance.
- Step 1 of the plan is a measurement on the iPad simulator, not code: where the bar sits at each
  window size class, what `verticalBarEdge` reports, the safe-area insets, and whether content
  scrolls under the top bar correctly. The measured facts go into this section before any clearance
  code (memory: root cause must match the exact symptom).
- `sidebarAdaptable` stays OFF (direction B keeps the native tab bar; HIG Sidebars: "Consider using
  a tab bar first"). The clearance work therefore targets the fixed top tab bar only.

## Section 4 - popovers, sheets, keyboard

- Share: `src/screens/settings/export-data/export-data.screen.tsx:99, :125` call `Share.share({ url })` with no anchor. Pass the
  `anchor` of the control that started the share, so the popover arrow points at it (HIG
  Popovers). Compact windows keep the sheet.
- Document picker (`src/screens/settings/import-data/import-data.screen.tsx`): verify its presentation on iPad; anchor it the same
  way if it shows as a popover.
- BottomSheet: in split modes a flat window centers the 540 pt card across the whole window, over
  the pane divider (`bottom-sheet.layout.ts:23`). Approved for Duo; recheck on iPad with the
  direction.
- Native-stack modal screens: on iPad `presentation: 'modal'` shows a page/form sheet (HIG Sheets
  prefers these). Verify each modal route on iPad; no change unless the check shows a problem.
- Keyboard: the iPad floating and split keyboards report heights differently. Verify the BottomSheet
  keyboard lift (`bottom-sheet.component.tsx:185-199`) and `scroll-to-field` with them. A hardware
  keyboard hides the on-screen keyboard; the done accessory must not leave a gap.
- Keyboard shortcuts and pointer hover: HIG expectations, not blockers. Out of scope for this track
  unless the user asks (recorded as a later idea).

## Section 5 - testing and delivery

- Jest: iPad-width cases for `resolveLayoutMode`, pane geometry, BottomSheet layout, and any new
  threshold (property test over widths 320-1366, heights 320-1366, both size classes).
- Simulator checks (later stage, never during spec): iPad Pro 13-inch and iPad mini, full screen
  portrait and landscape, Split View 1/3, 1/2, 2/3, Slide Over, and a Stage Manager free resize.
  A live iPad device check by the user before the merge (user ruling 2026-10-17; the user has an
  iPad): a device build via kiko:ops, the coordinator asks the user for the device, and the check
  covers full screen portrait and landscape, Split View, Stage Manager, and the new dashboard visual
  (memory: UI done = user confirms live). Each device finding is pinned by a test in its fix commit.
- Maestro flows: the Files app is "On My iPad" on iPad; flows that tap tabs must work with a top
  bar.
- Change sets of 30 files or fewer each (mutation cap). The plan names them.
- Ownership (orchestrator call): this track adds the 13-inch iPad capture (portrait and landscape)
  to the existing `e2e/screenshot/` pipeline as its last change set. The reviewer kit, the review
  notes, and the App Store Connect upload belong to the release track (kiko:release).

## Orchestrator calls (the user did not rule on these; check them while reading)

1. The 2/3 width belongs to a pane slot, fixed per tab; the dashboard changes sides between the Home
   and Statistics tabs, as Statistics does in the Duo today.
2. Accounts and Settings keep equal halves on wide windows.
3. Grid: row-aligned; net worth over time full width first; columns at 700 / 1000 pt.
4. A `single` regular window caps content at 600 pt (no iPhone or Duo change).
5. Resizes use the existing 150 ms settle; hysteresis only if the simulator shows lost routes.
6. 13-inch capture in this track; reviewer kit and upload in the release track.
7. `check:plist` and pbxproj invariants pin the iPad keys and the device family.
8. Keyboard shortcuts, pointer hover, and card reordering are out of scope (later ideas).
- The track merges to main only after Duo. It does not merge main on its own.

## Open questions

- None. (Release placement closed by the user 2026-10-17: Section 1, item 6.)

## Sources (checked 2026-10-17)

- TN3192: https://developer.apple.com/tutorials/data/documentation/technotes/tn3192-migrating-your-app-from-the-deprecated-uirequiresfullscreen-key.md
- TN3187: https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle.md
- Screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
- App Review Guidelines (2.3.3, 2.4.1): https://developer.apple.com/app-store/review/guidelines/
- Forums on removing device support: https://developer.apple.com/forums/thread/701706, https://developer.apple.com/forums/thread/778418
- Compatibility mode report: https://developer.apple.com/forums/thread/760259
- HIG Layout: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json
- HIG Sidebars: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/sidebars.json
- HIG Popovers: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/popovers.json
- HIG Sheets: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/sheets.json
- Size classes (third party): https://www.sap.com/design-system/fiori-design-ios/v26-4/foundations/adaptive-layout/size-classes
- Minimum scene size (best effort): https://developer.apple.com/forums/thread/802069
- React Native share/action sheet: https://reactnative.dev/docs/share, https://reactnative.dev/docs/actionsheetios
