# iPhone Duo Phase 2 (adaptive layout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One adaptive system (`single` / `columns` / `rows`) for the iPhone Duo (the iPad is a later track; the rule is device-agnostic): two equal panes with a fold gap, an opposite-pane navigation rule over one navigation state per tab, and a `DisplayRegions` native bridge for size class, bar edge, and fold.

**Architecture:** A codegen TurboModule (`DisplayRegions`, ObjC++ adapter + Swift, the `KikoReminders` pattern) feeds a JS store; pure functions derive the layout mode and pane geometry; a custom pane-stack navigator (StackRouter + `NativeStackView`) renders one native stack in `single` mode and one native stack per pane in two-pane mode, from the same state.

**Tech Stack:** React Native 0.87.1, `@react-navigation/native` 7.3.17, `@react-navigation/native-stack` 7.18.9 (exports `NativeStackView`), `react-native-bottom-tabs` 1.4.0, `react-native-unistyles` 3.3.0, `react-native-safe-area-context` 5.9.1, Jest + RNTL, Swift/ObjC++ (UIKit, iOS 27.1 SDK).

**Spec:** `docs/superpowers/specs/2026-10-08-iphone-duo-phase2-adaptive-design.md` (Phase 1 context: `docs/superpowers/specs/2026-09-21-iphone-duo-adaptive-layout-design.md`, `docs/superpowers/plans/2026-09-21-iphone-duo-adaptive-layout-phase1.md`).

## Flagged points (ambiguous or contradictory against the code) and their rulings

User rulings 2026-10-08 ("1a, 3a, 4a"): points 1, 3, and 4 are ruled, point 2 has no ruling
(the default is kept), and points 5-13 are "default accepted 2026-10-08". The spec was updated
to match points 1, 3, and 4.

1. **[RULED 1A, 2026-10-08] Duo only in this track.** `TARGETED_DEVICE_FAMILY = 1` (`ios/Kiko.xcodeproj/project.pbxproj:351,387,653`); the release skill asserts `UIDeviceFamily` `[1]`. Ruling: the iPad layouts, the iPad captures, and the iPad family work are out of this plan; the iPad is a later, separate track. The layout rule (`resolveLayoutMode`, `resolvePaneGeometry`, the pane-stack navigator) reads only the size class, the window shape, and the fold, never the device, so it will also serve the iPad later without change.
2. **[no ruling, default kept] iPhone orientation is portrait-only.** `UISupportedInterfaceOrientations` = Portrait (`ios/Kiko/Info.plist:133-136`). The spec's non-goal keeps regular iPhones portrait-only, but Duo inner landscape (`columns`) needs a landscape window. There is no Duo-only plist key in the code base. Default: task 2/5 step 1/9 captures the CURRENT build in inner landscape first. If the window is letterboxed or rotated, stop and ask; do not add landscape keys silently.
3. **[RULED 3A, 2026-10-08] Remount on fold and unfold is accepted.** Switching between one `NativeStackView` (`single`) and one per pane (two-pane) remounts the screen components. What survives: the navigation state, route params (including form drafts, so a half-filled form survives), and the live-query cache. What does not: scroll position. Every form keeps its draft in route params (`navigation.setParams`), as the Accounts form swap already does (`carriesDraft`, `src/navigation/accounts-stack/accounts.stack.tsx:24`). Task 5/5 step 6/10 is now unconditional.
4. **[RULED 4A, 2026-10-08] The opposite-pane rule wins.** After a fold and an unfold the layout returns to what it was (Home tab: the form on the left, Home on the right). The router keeps each route's stored pane across a fold; a route pushed while folded takes the pane opposite to its opener; an empty pane shows its default. This reverses the spec's earlier unfold rule ("top screen to primary, list part to companion"); task 4/5 carries the "was:" matrix.
5. **[default accepted 2026-10-08] Navigation from a default selection.** A holding form opened from the DEFAULT first-account page: after a fold, does Back go to that account page or to the list? Default: the first navigation away from a default materializes the default as a tapped stack route, so it survives the fold. Affects task 4/5 step 3/8.
6. **[default accepted 2026-10-08] "First account in the list".** The Accounts list holds account sections and loose holdings (`src/screens/accounts/implicit-account-heading`, `navigate('HoldingDetail')` at `accounts.screen.tsx:385`). Default: the first `AccountDetail` row in display order, never a holding row. Affects task 5/5 step 7/10.
7. **[default accepted 2026-10-08] Phase 1 heuristic "REPLACED by verticalBarEdge".** `isSidebarTabBarMode` (the implausible tab-bar height OR a side inset) feeds `resolveBottomClearance`, `useHeaderInset`, Home, and HoldingDetail. On iOS < 27.1 the bridge returns `none`. "Today's behaviour holds" can mean main (no guard) or this branch (guard). It is also unknown whether the tab bar still misreports its height in inner portrait (horizontal bars). Default: drive both helpers from `verticalBarEdge !== 'none'`, and keep the implausible-height check (> 50% of the window) as a fallback clamp inside `resolveBottomClearance` only. The side-inset signal is deleted. Affects task 2/5 step 8/9.
8. **[default accepted 2026-10-08] Fold value when flat.** Section 1 says "fold width 0 when flat -> hairline"; section 3 says `foldRegion` is null when flat. Default: native returns null for a zero-area region, and JS treats null as flat (hairline). The simulator poses in the spec are all flat, so the fold gap is unit-tested only until the real device check after 2026-10-23. Affects task 2/5 and task 3/5.
9. **[default accepted 2026-10-08] Codegen precedent and location.** The spec names the SceneDelegate blur as precedent. The codegen precedent is `KikoReminders` (`src/reminders/native/NativeKikoReminders.ts`, `ios/Kiko/Reminders/RCTKikoReminders.mm` + Swift). `package.json` `codegenConfig.jsSrcsDir` is ONE folder, `src/reminders/native`. Default: move both specs to `src/native-specs/` (set `jsSrcsDir` to it, add `"DisplayRegions": "RCTDisplayRegions"` to `modulesProvider`, update the paths in `kiko-no-native-reminders-module-import`, `jest/setup.js`, and the reminders lazy-load test). Alternatives: `jsSrcsDir: "src"` (codegen parses every file) or a spec inside `src/reminders/native` (wrong owner). Affects task 2/5 step 3/9.
10. **[default accepted 2026-10-08] UIKit symbol names.** `traitCollection.verticalBarEdge` and `reservedRegions(.division)` are spec text. Task 2/5 step 2/9 greps the iOS 27.1 SDK headers first and stops if the names or types differ.
11. **[default accepted 2026-10-08] Statistics-tab Back after a fold.** A transaction opened from the Home companion on the Statistics tab gives the stack `[Statistics, TransactionForm]`, so Back after a fold returns to Statistics, not Home. Default: accept (it follows from "one state per tab"). Affects task 4/5 step 1/8.
12. **[default accepted 2026-10-08] Width cap 600 pt.** Inner landscape halves are about 475 pt (2853 px / 3 / 2, if the scale is 3), so the cap never applies there. Inner portrait is about 669 pt wide, so it applies in `rows` mode. The iPad check belongs to the later iPad track (point 1). Default: token `layout.paneMaxWidth = 600`; confirm the Duo scale in task 2/5 step 1/9.
13. **[default accepted 2026-10-08] Release toolchain.** "Archive with Xcode 27.1" conflicts with the no-beta-Xcode rule (memory `appstore-no-beta-xcode-and-bump-build`) if 27.1 is still a beta at release time. This is a release-time check, outside this plan.

## Global Constraints

- Layout mode comes from the horizontal size class + window shape only; never `Platform.isPad`, idiom, orientation, or `UIScreen.main`.
- Panes are EQUAL halves; partly folded gap = `foldRegion` frame; flat = hairline divider; per-pane content max width 600 pt (token).
- Primary pane = right in `columns`, bottom in `rows`; companion = left / top.
- Regular iPhones stay portrait-only and `single`; no RTL-specific layout; sheets/modals unchanged.
- Duo only: no iPad layout, iPad capture, or device-family change in this track (ruling 1A). No code reads the device, so the iPad track reuses the rule as is.
- Fold/unfold remounts screens; navigation state, route params (form drafts included), and the data cache survive; scroll position does not (ruling 3A).
- No new dependency (`docs/harness/dependency-hygiene.md`); no build/env flag gating UI (5.6, `kiko-architecture`); no migration in this plan.
- Older system (iOS < 27.1 or older SDK): `verticalBarEdge: 'none'`, `foldRegion: null`, behaviour = task 1/5 result.
- Code style: full-word identifiers, fnts first, one unit per folder with `index.ts` barrel, `@kiko/` alias, import length-sort (`kiko-code-style`); no cross-screen imports.
- Each change set <= 30 mutable files; count with `KIKO_MUTATION_BASE=<base> make mutable`, never by hand.

## Review Focus

1. A companion pane that is visible but not the focused route: `paused: !isFocused` (Home, Statistics, Accounts) would freeze it. Expected: a visible pane refreshes on writes. Pinned in task 4/5 step 5/8 and task 5/5 step 2/10.
2. Rotating or folding during an open sheet or an unsaved transaction form: expected no crash, the sheet stays, the form draft survives (flag 3). Pinned in task 5/5 step 6/10.
3. The native module missing (older binary, Jest, a bundle against a stale build): expected `single`-safe values, never a throw at import. Pinned in task 2/5 step 4/9.
4. A list row tapped twice fast, or a second row while a detail is open: expected one detail in primary (replace), no stacked duplicates. Pinned in task 4/5 step 1/8.
5. Leaving a tab in two-pane mode: `resetTabStackOnBlur` pops to the root; defaults must re-appear on return, and a tapped selection must not leak into another tab. Pinned in task 4/5 step 6/8.

## Verification common to every task

- Jest on the touched suites: `npx jest <test paths named in the task>`.
- `bash scripts/wait-load.sh 10` (background, wait on exit code), then `npm run check:all`.
- `KIKO_MUTATION_BASE=<task base sha> make mutable` and record `mutable files: N` (cap 30). The coordinator runs `KIKO_MUTATION_BASE=<task base sha> make deep` detached per reviewed change set; the developer does not.
- `kiko:reviewer` on the change set before BATCH READY; BATCH READY names the base sha and the `make mutable` count.
- Task bases: task 1/5 = main `b758a649`; task N/5 = the tip of task N-1/5 (stacked merge points, harness-workflow "Stacked merge points").
- `make verify` (`env -u FORCE_COLOR make verify`, after `wait-load.sh 8`) at the two merge points: end of task 1/5 and end of task 5/5.
- Skill drift: after each task, `kiko:retrospect` + `kiko:scribe` (the coordinator), with the skill text named in the task.

---

### duo-phase2 task 1/5: bring duo-adaptive up to main

**Estimated mutable files: 8** (the Phase 1 source files: `bottom-clearance.ts`, `screen.component.tsx`, `scroll-to-field.ts`, `sidebar-mode.ts`, `sidebar-mode/index.ts`, `holding-detail.screen.tsx`, `add-transaction-fab.component.tsx`, `home.screen.tsx`). Base: main `b758a649`.

**Likely conflicts** (from `git merge-tree --write-tree HEAD main`, run 2026-10-08):
- `src/screens/home/home.screen.tsx`: CONFLICT, import block only (Phase 1 `isSidebarTabBarMode` against main's `genericEntitySymbol`, `EmptyState`, `openAccountForm`, and the `react-native` import). Keep all of them; there is one `react-native` import (`RefreshControl, ScrollView, SectionList, useWindowDimensions`).
- Auto-merged, check by hand: `src/screens/home/home.screen.test.tsx` (main +109 lines, empty states) and `.claude/skills/kiko-design-system/SKILL.md` (main +51 lines, EmptyState/TipCard/InfoHint).
- No other Phase 1 file changed on main.

- [ ] **step 1/5: merge.** In this worktree (not the main checkout): `git merge main`. Resolve `home.screen.tsx` with Edit, one whole conflict block. Then `node scripts/checks/import-order.js --write src/screens/home/home.screen.tsx` (the fix command `import-order.sh` prints), and fix any `left for hand fix` line by hand.
- [ ] **step 2/5: failing-test check.** Run `npx jest src/screens/home src/design-system/components/screen src/design-system/sidebar-mode src/design-system/scroll-to-field src/screens/holding-detail`. Expected: PASS. A failure here is a semantic conflict: the Phase 1 FAB/clearance code against main's EmptyState branch in Home. Fix it with a test that names the case (an empty ledger in sidebar mode shows EmptyState and the FAB clears the bar), written first.
- [ ] **step 3/5: commit** the merge: `Merge main into duo-adaptive (Phase 1 kept on top of main b758a649)`.
- [ ] **step 4/5: regression captures** (ops): a Release build on a regular iPhone sim and the Duo, outer display and inner landscape. Check Home with an empty ledger (main's EmptyState + FAB), Settings, and Accounts "Add account" against the Phase 1 captures.
- [ ] **step 5/5: gates.** `make verify` green (merge point 1); `KIKO_MUTATION_BASE=b758a649 make mutable` <= 30.

Skill drift: none expected (the merge only).

---

### duo-phase2 task 2/5: DisplayRegions native bridge and layout hooks

**Estimated mutable files: 16** (8 in `src/display-regions/` units + indexes, `src/native-specs/` 2 specs, 5 Phase 1 consumers, `src/reminders/native/reminders-native.ts` path change). Swift/ObjC++ are not mutated.

**Files:**
- Create: `src/native-specs/NativeDisplayRegions.ts`; move `src/reminders/native/NativeKikoReminders.ts` -> `src/native-specs/NativeKikoReminders.ts` with `git mv` (flag 9)
- Create: `src/display-regions/display-regions-native/{display-regions-native.ts,index.ts,*.test.ts}` (lazy `require`, `getSnapshot`, `subscribe`, fallback)
- Create: `src/display-regions/layout-mode/{layout-mode.ts,index.ts,layout-mode.test.ts}` (pure)
- Create: `src/display-regions/use-display-regions/{use-display-regions.ts,index.ts,*.test.tsx}` (`useSyncExternalStore`)
- Create: `src/display-regions/use-layout-mode/…`, `use-vertical-bar-edge/…`, `use-fold-region/…` (thin selectors + tests)
- Create: `src/display-regions/index.ts` (barrel; never re-exports the native spec)
- Create: `ios/Kiko/DisplayRegions/{RCTDisplayRegions.h,RCTDisplayRegions.mm,DisplayRegionsCenter.swift}`; add them to the Kiko target in `ios/Kiko.xcodeproj/project.pbxproj`
- Modify: `package.json` (`codegenConfig.jsSrcsDir`, `modulesProvider`), `jest/setup.js` (mock), `rules/semgrep-prewrite.yml` + its fixtures (spec path), `scripts/checks/feature-imports.js` `CONTAINERS` only if the checker asks, `ios/Podfile.lock`
- Modify (sidebar replacement): `src/design-system/components/screen/{bottom-clearance.ts,screen.component.tsx}`, `src/design-system/scroll-to-field/scroll-to-field.ts`, `src/screens/home/home.screen.tsx`, `src/screens/holding-detail/holding-detail.screen.tsx`; delete `src/design-system/sidebar-mode/`

**Interfaces (produces):**
```ts
type HorizontalSizeClass = 'compact' | 'regular';
type VerticalBarEdge = 'leading' | 'trailing' | 'none';
type FoldRegion = { x: number; y: number; width: number; height: number } | null; // window points
type DisplayRegionsSnapshot = { horizontalSizeClass: HorizontalSizeClass; verticalBarEdge: VerticalBarEdge; foldRegion: FoldRegion };
type LayoutMode = 'single' | 'columns' | 'rows';
const FALLBACK_SNAPSHOT: DisplayRegionsSnapshot; // { 'compact', 'none', null }
const resolveLayoutMode: (sizeClass: HorizontalSizeClass, width: number, height: number) => LayoutMode;
const useDisplayRegions: () => DisplayRegionsSnapshot;
const useLayoutMode: () => LayoutMode; // uses useWindowDimensions for the shape
const useVerticalBarEdge: () => VerticalBarEdge;
const useFoldRegion: () => FoldRegion;
// Spec (codegen): getSnapshot(): string (JSON of DisplayRegionsSnapshot); readonly onChange: CodegenTypes.EventEmitter<string>;
```
Square window (width === height) at regular width -> `columns` (one choice, pinned by a test).

- [ ] **step 1/9: sim facts first** (ops; the user sets the pose in Device Hub). Capture the current build in all three Duo poses (`xcrun simctl io <Duo UDID> screenshot /tmp/duo-<pose>.png`; trust the PNG, not the Device Hub spinner). Record window points and scale (Hermes inspector `Dimensions`, as in Phase 1). Stop on flag 2 if inner landscape is not a landscape window.
- [ ] **step 2/9: SDK symbol check.** `grep -rn 'verticalBarEdge\|reservedRegion' "$(xcrun --sdk iphonesimulator --show-sdk-path)/System/Library/Frameworks/UIKit.framework/Headers"`. Record the exact names, types, and availability. Record `xcrun swift --version` for the compile-time guard. Stop if a name differs (flag 10).
- [ ] **step 3/9: codegen spec + jest mock (test first).** Failing test `src/display-regions/display-regions-native/display-regions-native.test.ts`: `getSnapshot()` parses the mock JSON, `subscribe` delivers an `onChange` payload, and malformed JSON returns `FALLBACK_SNAPSHOT`. Then `git mv` the reminders spec, write `NativeDisplayRegions.ts`, update `package.json` and the `jest/setup.js` mock (`jest.mock('@kiko/native-specs/NativeDisplayRegions', …)`, mirroring the `KikoReminders` mock at `jest/setup.js:210-216`), the Semgrep rule path, and its fixtures. Check: the test passes; `npx jest src/reminders` passes; `npm run check:rules` passes.
- [ ] **step 4/9: fallback path (test first).** `display-regions-native.lazy-load.test.ts`: (a) importing `@kiko/display-regions` never calls `TurboModuleRegistry.getEnforcing`; (b) with the module absent (the mock throws), `getSnapshot()` returns `FALLBACK_SNAPSHOT` and `subscribe` is a no-op unsubscribe. Implement it as `reminders-native.ts` does (a lazy `require` on first use, try/catch to the fallback). Add a value-import ban for the spec next to `kiko-no-native-reminders-module-import` (a fixture pair).
- [ ] **step 5/9: `resolveLayoutMode` (test first).** `layout-mode.test.ts`, a table test, one row per spec row plus edges: compact 390x844 -> single; compact outer Duo 466x678 -> single; regular 951x669 -> columns; regular 669x951 -> rows; regular square -> columns; compact landscape -> single. Implement the pure function. It takes no device input (ruling 1A), so the later iPad track adds only table rows, not code.
- [ ] **step 6/9: hooks (test first).** `use-display-regions.test.tsx`: the hook returns the mock snapshot, re-renders on an emitted `onChange`, and unsubscribes on unmount. `use-layout-mode.test.tsx`: it combines the snapshot with mocked `useWindowDimensions`; there is one test per hook. Implement with `useSyncExternalStore` over the wrapper. Cache the parsed snapshot so `getSnapshot` is referentially stable between events; a test pins no render loop.
- [ ] **step 7/9: Swift + ObjC++ module.** `DisplayRegionsCenter.swift` (`@objc final class`, `static let shared`): reads the foreground `UIWindowScene` key window's `traitCollection.horizontalSizeClass`, `verticalBarEdge`, and the `.division` reserved region converted to window coordinates (null for zero area). It re-reads on `registerForTraitChanges` and on window-scene `effectiveGeometry` KVO, and emits only on a change. Everything iOS 27.1 sits under the compile-time SDK guard from step 2/9 plus `if #available(iOS 27.1, *)`, else `none`/null. `RCTDisplayRegions.mm` is a thin adapter: `getSnapshot` is synchronous (main-thread read via `RCTUnsafeExecuteOnMainQueueSync`, as with `uses24HourClock`), and `setEventEmitterCallback`/`invalidate` follow `RCTKikoReminders.mm:30-48`. Add framework imports before `Kiko-Swift.h` if a new `@objc` signature needs them (kiko-architecture "Native iOS shell"). Then `make pods` and commit `ios/Podfile.lock`. The module is app-local codegen, so no Podfile edit is needed: `pod install` regenerates `KikoSpecs`. Check: a Debug build on the Duo sim logs the snapshot in all three poses and on an iOS 18.x sim (`none`/null).
- [ ] **step 8/9: replace the sidebar heuristic (test first, flag 7).** Update `bottom-clearance.test.ts`: `resolveBottomClearance(tabBarHeight, insetBottom, verticalBarEdge, windowHeight)` returns 0 for `leading`/`trailing`; with `none` it clamps an implausible height (678 of 678) to 0; with `none` and 83 of 844 it returns `max(83 - 34, 0)`. Update `scroll-to-field.test.ts`: the header floor applies when `verticalBarEdge !== 'none'`. Update the Screen, Home, and HoldingDetail tests to mock `useVerticalBarEdge` in place of the geometry. Then implement and delete `src/design-system/sidebar-mode/`. Check: `npx jest src/design-system src/screens/home src/screens/holding-detail`.
- [ ] **step 9/9: gates + commit.** `check:all`; `KIKO_MUTATION_BASE=<task 1/5 tip> make mutable`. Commit: `feat(display-regions): native size class, bar edge, fold bridge + layout hooks`.

Skill drift: kiko-architecture "Native iOS shell" (a second TurboModule, the `src/native-specs/` spec folder, the fallback); kiko-design-system "Screen" (the `isSidebarMode` text becomes `verticalBarEdge`).

---

### duo-phase2 task 3/5: TwoPaneLayout

**Estimated mutable files: 6** (`pane-geometry.ts` + index, `two-pane-layout.component.tsx`, `.styles.ts`, index, theme token file).

**Files:**
- Create: `src/design-system/pane-geometry/{pane-geometry.ts,index.ts,pane-geometry.test.ts}`
- Create: `src/design-system/components/two-pane-layout/{two-pane-layout.component.tsx,two-pane-layout.props.d.ts,two-pane-layout.styles.ts,index.ts,two-pane-layout.component.test.tsx}`
- Modify: the theme token file under `src/design-system/theme/` (`layout.paneMaxWidth: 600`, `layout.hairline: StyleSheet.hairlineWidth`)

**Interfaces:**
- Consumes: `LayoutMode`, `FoldRegion`, `useLayoutMode`, `useFoldRegion` from `@kiko/display-regions`.
- Produces:
```ts
type PaneFrame = { x: number; y: number; width: number; height: number };
type PaneGeometry = { companion: PaneFrame; primary: PaneFrame; divider: PaneFrame; isFolded: boolean };
const resolvePaneGeometry: (mode: 'columns' | 'rows', window: { width: number; height: number }, fold: FoldRegion, hairline: number) => PaneGeometry;
type TwoPaneLayoutProps = { companion: ReactNode; primary: ReactNode }; // renders only when mode !== 'single'; in single renders primary
```

- [ ] **step 1/4: geometry (test first).** `pane-geometry.test.ts`: `columns` flat 951x669 gives companion x=0, width=(951-h)/2, primary on the right, divider = hairline. `rows` flat gives companion on top, primary at the bottom. `columns` folded with fold {x:465,w:21} gives companion width 465, primary x 486, no divider, `isFolded`. `rows` folded with fold {y:470,h:24} is the same on the vertical axis. A fold off-centre clamps the panes to the fold edges (equal halves only when the fold is centred, per the spec "the fold falls between them"). Implement it as a pure function.
- [ ] **step 2/4: component (test first).** `two-pane-layout.component.test.tsx` (with mocked hooks): `single` renders only `primary` (no companion element). `columns` renders the companion before the primary, with the frames from `resolvePaneGeometry`. The divider appears only when flat. Each pane's inner content is centred with `maxWidth` = `theme.layout.paneMaxWidth` (asserted on the style). Each pane wraps its content in `SafeAreaView` edges for its outer sides only, so the gap side reserves nothing.
- [ ] **step 3/4: implement**, with unistyles style functions for frames; no inline colours; the divider uses the existing divider token (see `src/design-system/components/divider`).
- [ ] **step 4/4: gates + commit.** `npx jest src/design-system/pane-geometry src/design-system/components/two-pane-layout`; `check:all`; `make mutable` (base = task 2/5 tip). Commit: `feat(design-system): TwoPaneLayout with fold gap and pane width cap`.

Skill drift: kiko-design-system component set + `layout` tokens.

---

### duo-phase2 task 4/5: pane-stack navigation (opposite-pane rule, defaults, fold/unfold)

**Estimated mutable files: 17** (pane-assignment, pane-router, pane-stack view, create navigator, pane-visibility, open-in-pane helper, their indexes; the four stacks; `reset-tab-stack-on-blur.ts`). `types.d.ts` is not mutated.

**Files:**
- Create: `src/navigation/pane-stack/pane-assignment/{pane-assignment.ts,index.ts,pane-assignment.test.ts}` (pure)
- Create: `src/navigation/pane-stack/pane-router/{pane-router.ts,index.ts,pane-router.test.ts}` (`StackRouter` + pane actions)
- Create: `src/navigation/pane-stack/pane-stack-view/{pane-stack-view.component.tsx,index.ts,*.test.tsx}`
- Create: `src/navigation/pane-stack/create-pane-stack-navigator/{create-pane-stack-navigator.tsx,index.ts,*.test.tsx}`
- Create: `src/navigation/pane-stack/pane-visibility/{pane-visibility.ts,index.ts,*.test.tsx}` (context + `useIsScreenVisible`)
- Create: `src/navigation/pane-stack/index.ts`; add `navigation/pane-stack` to `CONTAINERS` in `scripts/checks/feature-imports.js` (+ its test) if `--tree` asks
- Modify: `src/navigation/{home-stack,statistics-stack,accounts-stack,settings-stack}/*.stack.tsx`, `src/navigation/types/types.d.ts`, `src/navigation/reset-tab-stack-on-blur/reset-tab-stack-on-blur.ts`

**Interfaces:**
- Consumes: `useLayoutMode`, `TwoPaneLayout`.
- Produces:
```ts
type Pane = 'companion' | 'primary';
type PaneDefault = { name: string; params?: object; isDefault: true };
type PaneConfig = { rootPane: Pane; companionDefault?: PaneDefault; primaryDefault?: PaneDefault };
// pane-assignment.ts (pure, keyed by route key)
const openFrom: (routes: RouteLike[], panes: PaneMap, openerKey: string, next: RouteLike) => { routes; panes }; // pop above opener, push next into opposite(pane(opener))
const visibleRoutes: (routes, panes, config) => { companion: RouteLike | PaneDefault | null; primary: RouteLike | PaneDefault | null };
const foldAssignment: (routes, panes) => { routes; panes };   // drop isDefault routes; KEEP the pane of every tapped route
const unfoldAssignment: (routes, panes, config) => PaneMap;   // ruling 4A: a stored pane is kept; a key without one (pushed while folded) takes opposite(pane(route below)); the root without one takes config.rootPane
// router: actions PANE_OPEN { openerKey, route }, PANE_FOLD, PANE_UNFOLD, PANE_SHOW_DEFAULT { pane, route }
const useIsScreenVisible: () => boolean; // two-pane: route visible in a pane && tab focused; single: useIsFocused()
const useOpenInPane: () => (name, params) => void; // dispatches PANE_OPEN with the caller's route key
```
Per-tab config: Home `{ rootPane: 'primary', companionDefault: Statistics }`; Statistics `{ rootPane: 'primary', companionDefault: Home }`; Accounts `{ rootPane: 'companion' }` (`primaryDefault` set at runtime by task 5/5); Settings `{ rootPane: 'companion', primaryDefault: Categories }`. Register `Statistics` in the Home stack, and `Home` + `TransactionForm` in the Statistics stack (`types.d.ts` param lists).

- [ ] **step 1/8: pane rule (test first).** `pane-assignment.test.ts`, one `it` per case:
  - (a) Home tab: the form opened from Home (primary) goes to companion, in place of Statistics;
  - (b) closing it shows the Statistics default again;
  - (c) Statistics tab: a transaction from the Home companion goes to primary, in place of Statistics;
  - (d) Accounts: row A then row B gives the stack `[Accounts, B]`: replace, no duplicate (Review Focus 4);
  - (e) a holding form from the account page (primary) goes to companion, in place of the list;
  - (f) close restores the previous content of that pane;
  - (g) `foldAssignment` drops defaults and keeps tapped routes;
  - (h) Home tab, fold then unfold of `[Home, Form]` opened unfolded: Form back in companion (left), Home in primary (right) (ruling 4A);
  - (i) `unfoldAssignment` of `[Accounts, AccountDetail]` puts the list in companion and the detail in primary;
  - (j) SUPERSEDED by the `pane-assignment.ts` tests and `realizeStaticDefault`; was: Statistics tab: the fold gives `[Statistics, Form]` with Back to Statistics (flag 11); unfold puts Form back in primary and the Home default in companion;
  - (k) a route pushed while folded (Home tab: the form opened on the outer display) unfolds into opposite(Home) = companion, with Home in primary;
  - (l) Accounts default first account: fold drops it, unfold shows it again in primary (no stored pane needed);
  - (m) a rehydrated state with no `panes` map unfolds by alternation from `rootPane`.
  Then implement.

  Scenario matrix (ruling 4A reverses the spec's earlier unfold rule):

  | Case | Before fold | After fold + unfold (now) | was: (old unfold rule) |
  |---|---|---|---|
  | Home tab, form opened from Home | Form left, Home right | Form left, Home right | Home left, Form right |
  | Statistics tab, form opened from the Home companion | Home left, Form right | Home default left, Form right | Statistics left, Form right |
  | Accounts, tapped account | list left, account right | list left, account right | list left, account right |
  | Accounts, holding form from the account page | form left, account right | form left, account right | account left, form right |
  | Settings, ReminderForm from Reminders | form left, Reminders right | form left, Reminders right | Reminders left, form right |
  | Home tab, form opened while folded | (single) | Form left, Home right | Home left, Form right |
- [ ] **step 2/8: router (test first).** `pane-router.test.ts` drives `getStateForAction` with each action. It keeps the pane map in state (`state.panes`), so `getRehydratedState` restores it and missing keys default to the alternation from `rootPane`. `PANE_FOLD` keeps `state.panes` for the tapped routes (ruling 4A); only default routes and their keys are removed. Standard `POP`/`GO_BACK` remove the route's key from `panes`. Then implement it over `StackRouter`.
- [ ] **step 3/8: default materialization (test first, flag 5).** `PANE_OPEN` with an `openerKey` that names a default: the default becomes a real route (`isDefault` dropped) before the push. A test pins that after a fold, Back from the opened form leads to the materialized account page.
- [ ] **step 4/8: view (test first).** `pane-stack-view.test.tsx`: `single` renders one `NativeStackView` with the full state; two-pane renders `TwoPaneLayout` with one `NativeStackView` per pane, each given a sliced state (only that pane's routes, in order) and the shared descriptors. A default renders through a synthetic route in the slice. A pane's native back pops that route via the router. Mock `NativeStackView` as a host component that records its props (as the existing stack tests do).
- [ ] **step 5/8: visibility (test first, Review Focus 1).** `pane-visibility.test.tsx`: in `columns` the companion route (not the focused route) reports `true`; a covered route reports `false`; with the tab unfocused both report `false`; `single` equals `useIsFocused()`.
- [ ] **step 6/8: navigator + fold effect (test first, Review Focus 5).** `create-pane-stack-navigator.test.tsx`: a layout-mode change from two-pane to `single` dispatches `PANE_FOLD` once, and back dispatches `PANE_UNFOLD`. `resetTabStackOnBlur` keeps working: leaving the tab pops to the root, and on return the defaults re-appear. Rerender with the same mode dispatches nothing.
- [ ] **step 7/8: switch the four stacks** to `createPaneStackNavigator` with the configs above. Keep every `screenOptions`, `screenListeners`, and the Accounts `restoreDefaultAnimationOfSwappedForm`. Existing suites must stay green unchanged: `npx jest src/navigation` (root, accounts swap, statement-import return, settings, statistics stack tests).
- [ ] **step 8/8: gates + commit.** `check:all` (incl. `check:feature-imports`, `check:screen-imports`); `make mutable` (base = task 3/5 tip). Commit: `feat(navigation): pane-stack navigator with the opposite-pane rule`.

Skill drift: kiko-architecture (a new "Pane navigation" section: the rule, defaults, fold/unfold, `useIsScreenVisible`); the "`paused` vs `enabled`" section names `useIsScreenVisible` (after task 5/5).

---

### duo-phase2 task 5/5: screens (Home + Statistics, then Accounts + Settings), measurement, captures

**Estimated mutable files: 23** (`home.screen.tsx`, `statistics.screen.tsx`, `accounts.screen.tsx`, `settings.screen.tsx`, `settings-row` component, the `add-transaction-fab` component + styles, `accounts-empty-pane` screen (component, styles, index), `account-detail.screen.tsx`, `help` screen if it navigates; ruling 3A adds `use-draft-param` (hook + index) and the 8 form screens). `statistics.screen.tsx` (54.7K) and the 8 form screens dominate the mutation run, so quote the ETA from `make deep`'s history line. If `make mutable` prints more than 30, or the ETA is too long for one run, split step 6/10 (drafts) into their own change set before BATCH READY and renumber the tasks to N/6.

- [ ] **step 1/10: Home + Statistics use `useIsScreenVisible` (test first).** In `home.screen.test.tsx` and `statistics.screen.test.tsx`, replace the `useIsFocused` mock with a `useIsScreenVisible` mock. The existing "every call passes `paused`" and "hidden write shows on refocus" tests stay, keyed to visibility. Add: a visible companion (focused=false, visible=true) reads on a write. Implement the swap.
- [ ] **step 2/10: double-mount measurement M1 (test first, gate).** New `src/navigation/root-navigator/root.navigator.double-mount.test.tsx`: render `RootNavigator` in `columns` (mocked `useLayoutMode`) with a counting `useLiveQuery` mock (subscriptions registered, reads run). Visit all four tabs, return to Home, then fire one `transactions` write. **Pass limits:** (1) reads after the write come only from the visible instances (Home-tab Home + Home-tab Statistics companion); the hidden Statistics-tab instances run 0 reads; (2) total live subscriptions in `columns` <= 2x the same walk in `single` for the Home + Statistics query set; (3) switching to the Statistics tab then runs exactly one read per dirty query per newly visible instance. Any breach fails the change set.
- [ ] **step 3/10: double-mount measurement M2 (sim, user-driven).** Duo inner landscape, a Debug build, the demo `.kiko` ledger imported (`e2e/screenshot/fixtures/`, per `docs/harness/screenshots-check.md`), both Home and Statistics tabs opened. Use React DevTools Profiler on one Home pull-to-refresh: total commit time. **Pass:** <= 1.5x the same refresh in the outer display (`single`), and no blank frame on 10 Home <-> Statistics switches (the kiko-architecture "Device check" list). Record both numbers in the BATCH READY.
- [ ] **step 4/10: FAB follows `verticalBarEdge` (test first).** In `add-transaction-fab.component.test.tsx`, add one case per edge value: `trailing` puts the FAB bottom-right next to the bar; `leading` puts it bottom-left; `none` gives today's bottom-right with the clearance. In two-pane mode the FAB lives in the Home pane (primary). Implement it as a style-function argument.
- [ ] **step 5/10: Home opens the form via `useOpenInPane` (test first).** A row press, the duplicate action, and the FAB call `openInPane('TransactionForm', …)`. In single mode the existing `navigation.navigate` assertions keep their semantics (the helper falls back to `navigate`).
- [ ] **step 6/10: form drafts survive a pose change (test first, ruling 3A, Review Focus 2).** First a shared hook `src/navigation/use-draft-param/{use-draft-param.ts,index.ts,use-draft-param.test.ts}`: `useDraftParam<Draft>(navigation, route) => { initialDraft: Draft | undefined; saveDraft: (draft: Draft) => void }`. It writes `params.draft` via `navigation.setParams` on each field blur, never per keystroke. The test pins one `setParams` per blur and that the initial draft is read from params. Then, per form screen, a test: fill half the fields, unmount and remount with the route params the first mount left, and every filled value is back. The form screens are `transaction-form`, `account-form`, `holding-form`, `lot-form`, `price-point-form`, `contribution-form`, `ownership-change-form`, and `reminder-form`. The account, holding, and reminder forms already seed from `draft` (`types.d.ts:87-115`); reuse that `FormDraft` shape and extend the param lists of the other five. What does not survive: scroll position (no test; documented in the spec). A save or a cancel clears the draft (one test per form).
- [ ] **step 7/10: Accounts (test first, flag 6).** In `accounts.screen.test.tsx`: in two-pane mode with accounts loaded and no tapped selection, the screen dispatches `PANE_SHOW_DEFAULT` with the first `AccountDetail` row. With zero accounts it shows the new `src/screens/accounts-empty-pane` (the shared `EmptyState` with "Add an account", existing i18n key reuse first; new copy in en + uk via kiko-translator). The selected row is highlighted, and only in two-pane mode. A row press goes through `openInPane`. `paused` uses `useIsScreenVisible`.
- [ ] **step 8/10: Settings (test first).** In `settings.screen.test.tsx`: in two-pane mode the Categories row is highlighted while the default shows, and the highlight follows the primary route. Rows call `openInPane`. Help/HelpTopic: a detail already in the stack keeps its pane on unfold (pane-assignment tests (h) and (i) cover the rule; add one Settings integration test). Implement `settings-row` `selected`.
- [ ] **step 9/10: captures (ops; the user sets each pose in Device Hub and navigates; the CLI cannot navigate).** Release build with the demo ledger. Per pose, capture `xcrun simctl io <UDID> screenshot screenshots/duo-phase2/<pose>/<screen>.png`: closed portrait (outer), inner landscape, inner portrait. The screens are Home, Statistics, Accounts, Settings, the transaction form opened from Home, and an account page. If the Device Hub window shows a spinner on the inner display, trust the PNG. Check the sizes with `sips -g pixelWidth -g pixelHeight` against outer 1398x2034, inner 2853x2007 / 2007x2853. Also: a fold/unfold round trip on Accounts with a tapped account (it survives) and with the default (the list shows); a half-filled transaction form kept across a fold and an unfold (ruling 3A); a regular iPhone regression of all four tabs. No iPad captures (ruling 1A). The user confirms each pose live (memory `ui-changes-need-device-confirm-vs-intent`). The App Store Duo set is promoted later via `docs/harness/screenshots-check.md`.
- [ ] **step 10/10: gates + commit.** `npx jest src/screens/home src/screens/statistics src/screens/accounts src/screens/accounts-empty-pane src/screens/settings src/screens/forms src/navigation`; `check:all`; `make mutable` (base = task 4/5 tip); `make verify` green (merge point 2). Commit: `feat(screens): Duo two-pane Home, Statistics, Accounts, Settings`.

Skill drift: kiko-architecture "`paused` vs `enabled`" (`useIsScreenVisible`, the double-mount limits M1/M2); kiko-design-system (FAB edge rule, row selection in two-pane); kiko-domain if the Accounts default rule is recorded there.

---

## Self-review

- Spec coverage: section 1 is tasks 2/5 (mode) and 3/5 (halves, gap, cap). Section 2 is task 4/5 (rule, defaults, fold) and task 5/5 (mapping per tab, cost). Section 3 is task 2/5 (bridge, bars, older systems) and task 5/5 step 4/10 (FAB). Section 4 is the five tasks, the unit-test list (steps 2/5-6/9, 3/5-1/4, 4/5-1/8, 2/5-4/9), and the captures (1/5-4/5, 2/5-1/9, 5/5-9/10).
- No migration: no `kiko:reviewer` migration step and no EXPLAIN test needed.
- Open spec questions stay open: width cap (flag 12) and the Duo screenshot sets (both are captured in 5/5-9/10).
