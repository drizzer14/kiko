# Net worth scrub line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A vertical dashed line on the Statistics net-worth chart, always shown, that starts on the present day, moves to the nearest data point under a horizontal drag, stays where released, and shows that day's net worth in a small label.

**Architecture:** Pure math in a new `net-worth-line.scrub.ts` (index snap, label placement, selection reset), wired into `NetWorthLine` through a thin `Gesture.Pan()` adapter (the `bottom-sheet.gesture.ts` split from kiko-gestures "Pure-gesture-math testability pattern"). All state lives inside the component; `statistics.screen.tsx` is untouched.

**Tech Stack:** react-native-svg (`Line`), react-native-gesture-handler 3.2.1 (legacy `Gesture.Pan()` builder, as in `bottom-sheet.component.tsx`), react-native-haptic-feedback `trigger`, `@react-navigation/native` `NavigationContext`.

**Spec:** `/Users/drizzer14/Developer/Projects/pff-ios/memory/refs/brief-net-worth-scrub-line.md` (user-approved design, G1-G6).

## Global Constraints

- Re-grep every code fact below on the actual base before you rely on it; anchors are symbol names, never line numbers.
- Every count in this plan (files, cases, call sites) is a floor; the developer measures.
- Same style as the baseline: `REFERENCE_DASH`, `theme.colors.textSecondary`, `GRID_STROKE_WIDTH` (the constants/token `testID="net-worth-line-reference"` uses). No new colour, no new dash constant.
- Chart data, axes, period selector unchanged. `statistics.screen.tsx` unchanged (also changed on duo-adaptive, binance-backfill-fix, currency-pickers).
- No new dependency. `__mocks__/react-native-svg.tsx` already exports `Line`; no mock change.
- kiko-code-style: full-word identifiers, explicit `return` in components, blank-line rules, `.concat` over multi-part templates, comments WHY-only at 100 columns, import ordering.
- Pan callbacks reach haptics and `setState`, so `.runOnJS(true)` (kiko-gestures "`runOnJS(true)` for non-worklet callbacks"). No worklet code is added.
- 2.3.1(a): the line is always visible; no flag.

## Review Focus

1. A vertical scroll that starts on the chart must still scroll the page (G5): Jest cannot see this; only the user's device/simulator check proves it.
2. A small vertical drift during a horizontal scrub may scroll the page by a few points (RN core `ScrollView` in `Screen` is not composed with the Pan). Accepted unless the user objects on device.
3. With `preserveAspectRatio="none"`, the X axis stretches: the vertical line's stroke width scales with plot width (`plotWidth / VIEW_WIDTH`) and the baseline's dash scales horizontally. Same constants, slightly different rendered pixels. Simulator check.
4. The label must not cover the selected point badly near the top of the plot; it sits at the plot top on the `surface` background.
5. Live data updates (a write elsewhere, backfill progress) must NOT reset a scrubbed line: only the range key (first t, last t, point count) or a focus event resets it.

## Open gaps (run-log `stats --gaps --repo kiko`, read 2026-10-17)

This plan closes none and leaves all open (none is in this track's scope):
`20261014T0952-kiko-harness-h7/1`, `20261015T0021-kiko-harness-h7/1`, `20261015T0639-kiko-harness-h7/1`,
`20261015T1119-kiko-harness-h7/1`, `20261015T1119-kiko-harness-h7/2`, `20261015T1318-kiko-harness-h7/2`,
`20261015T1657-kiko-binance-backfill-fix/1`, `20261015T1657-kiko-binance-backfill-fix/2`,
`20261015T1035-kiko-release-1-2/3`, `20261016T2009-kiko-currency-pickers/1`.
(The last one names `net-worth-series.ts`, a different file from this track's; not touched.)

## Files touched (floor)

| File | Change |
|---|---|
| `src/screens/statistics/net-worth-line/net-worth-line.scrub.ts` | NEW: pure functions + exported constants |
| `src/screens/statistics/net-worth-line/net-worth-line.scrub.test.ts` | NEW (qa): pure-math tests |
| `src/screens/statistics/net-worth-line/net-worth-line.scrub-line.test.tsx` | NEW (qa): component tests for the line, label, gesture, reset, haptic, a11y |
| `src/screens/statistics/net-worth-line/net-worth-line.component.tsx` | line, label (local non-exported `ScrubLabel`), Pan, selection state, focus reset, a11y |
| `src/screens/statistics/net-worth-line/net-worth-line.styles.ts` | `scrubLabel` style (absolute, `top: 0`, `theme.colors.surface` background, small padding) |
| `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts` | `components.netWorthLine.*` keys (see "New strings") |

The existing `net-worth-line.component.test.tsx` (975 lines) is NOT extended: a new file keeps it under the jscpd large-file line (memory "Touched test file passes dup.sh alone"). `src/test-support/focus-navigation.tsx` (`makeFocusNavigation`) and `gesture-root-wrapper.tsx` are reused, not changed.

## Pure functions (`net-worth-line.scrub.ts`)

Exported constants: `SCRUB_ACTIVE_OFFSET_X = 10`, `SCRUB_FAIL_OFFSET_Y = 10` (points), `SCRUB_LABEL_GAP` (px; the developer picks a `theme.spacing` multiple and passes it in, or a plain number, one place only).

1. `toLogicalX(touchX: number, plotWidth: number, viewWidth: number): number | null`
   - Domain: `touchX` any finite number (may be negative or past the plot: the finger leaves the plot mid-drag); `plotWidth` the plot View's laid-out width, `>= 0`; `viewWidth > 0` (the component passes `VIEW_WIDTH`).
   - Returns `touchX * viewWidth / plotWidth`; returns `null` when `plotWidth <= 0` (not measured yet), and the caller then ignores the move.
2. `nearestPointIndex(pointXs: readonly number[], x: number): number` (G1 snap, clamp both ends)
   - Domain: `pointXs` non-empty, ascending (non-strict; duplicates allowed), the points' logical x (`scales.x(point.t)`); `x` any finite number.
   - Returns the index with the smallest `|pointXs[i] - x|`; `x <= pointXs[0]` gives `0`; `x >= last` gives `length - 1`; an exact tie between two neighbours gives the LOWER index; duplicate xs give the first of them.
3. `placeScrubLabel(lineX: number, labelWidth: number, plotWidth: number, gap: number): { side: 'right' | 'left' | 'clamped'; left: number }` (G3)
   - Domain: all in device px; `plotWidth >= 0`; `labelWidth >= 0`; `gap >= 0`; `lineX` in `[0, plotWidth]`.
   - `right` (default, faces into the plot) when `lineX + gap + labelWidth <= plotWidth`: `left = lineX + gap`.
   - else `left` when `lineX - gap - labelWidth >= 0`: `left = lineX - gap - labelWidth`.
   - else `clamped`: `left = min(max(lineX - labelWidth / 2, 0), max(plotWidth - labelWidth, 0))`.
   - Invariant: `left >= 0` and `left + labelWidth <= plotWidth` whenever `labelWidth <= plotWidth`.
4. `scrubRangeKey(points: readonly NetWorthPoint[]): string` (G6 reset signal)
   - Domain: non-empty `points`. Returns first `t`, last `t` and `length` joined (use `.concat`). A period change moves the first or last `t`; a live amount update or backfill progress changes neither.
5. `resolveScrubIndex(selection: ScrubSelection | null, points: readonly NetWorthPoint[]): number` (default + reset, "derive, don't re-seat")
   - `type ScrubSelection = { rangeKey: string; index: number }`. Domain: non-empty `points`.
   - Returns `points.length - 1` (present day) when `selection` is `null` or `selection.rangeKey !== scrubRangeKey(points)`; else `selection.index` clamped to `[0, points.length - 1]`.
6. `stepScrubIndex(index: number, delta: 1 | -1, count: number): number` (only if the coordinator picks a11y option A)
   - Domain: `count >= 1`, `index` in `[0, count - 1]`. Returns `index + delta` clamped to `[0, count - 1]`.

## Component change (`net-worth-line.component.tsx`)

- State (declared BEFORE the `points.length === 0` early return, so hook order is stable): `const [selection, setSelection] = useState<ScrubSelection | null>(null)`, `plotWidth` and `labelWidth` (`useState<number>(0)`, from `onLayout` on the `styles.plot` View and on the label View), and `lastTickIndex` (`useRef<number | null>`) for the haptic.
- Selected index: `resolveScrubIndex(selection, points)`. No `useEffect` re-seat. Default = last point (present day).
- G6 resets:
  - period change: derived through `scrubRangeKey` (data identity of the range, not the `points` array reference, so a live update does not reset);
  - screen re-open: `const navigation = useContext(NavigationContext)` and an effect `navigation?.addListener('focus', () => setSelection(null))`, the `use-select-created-holding.ts` pattern; outside a navigator (`undefined`) it is a no-op. Statistics is a tab whose screen stays mounted, so `focus` is the re-open signal. `statistics.screen.tsx` stays untouched.
- Line, after the polylines inside the same `<Svg>`: `<Line testID="net-worth-line-scrub" x1={x} y1={PADDING_Y} x2={x} y2={baselineY} stroke={theme.colors.textSecondary} strokeWidth={GRID_STROKE_WIDTH} strokeDasharray={REFERENCE_DASH} />`, `x = scales.x(points[index].t)`.
- Label: a local, non-exported `ScrubLabel` component in the same file (kiko-code-style "small local, non-reusable component" exception; `StatusMessage` is the precedent), rendered inside the plot View, `pointerEvents="none"`, `testID="net-worth-line-scrub-label"`, style `styles.scrubLabel` + `{ left }` from `placeScrubLabel(scales.x(t) / VIEW_WIDTH * plotWidth, labelWidth, plotWidth, SCRUB_LABEL_GAP)`. Content (G2): `<MoneyText money={Money.fromMajor(baseCurrency, point.amount)} context="balance" style={{ fontSize: theme.typography.caption.fontSize, fontWeight: '600' }} numberOfLines={1} />`, then `<Text variant="caption" tone="textSecondary">{formatDate(point.t)}</Text>` (`DD.MM.YYYY`; the year matters on long periods). Hidden (`opacity: 0`) until `labelWidth > 0 && plotWidth > 0`, so the first frame never draws a mis-placed label.
- Gesture (G5): wrap the `styles.plot` View in `<GestureDetector gesture={scrub}>`:
  ```
  Gesture.Pan()
    .activeOffsetX([-SCRUB_ACTIVE_OFFSET_X, SCRUB_ACTIVE_OFFSET_X])
    .failOffsetY([-SCRUB_FAIL_OFFSET_Y, SCRUB_FAIL_OFFSET_Y])
    .runOnJS(true)
    .withTestId(NET_WORTH_SCRUB_GESTURE_TEST_ID)
    .onStart(moveTo).onUpdate(moveTo)
  ```
  `moveTo(event)`: `toLogicalX(event.x, plotWidth, VIEW_WIDTH)`; `null` returns; else `nearestPointIndex(points.map((point) => scales.x(point.t)), logicalX)`; when it differs from `lastTickIndex.current ?? currentIndex`: set the ref, `trigger('selection')` (G4; the iOS picker/scrub tick; `react-native-haptic-feedback` `trigger`, the same import `CardContextMenu` uses; there is no wrapper helper in `src/`), `setSelection({ rangeKey: scrubRangeKey(points), index })`. A move inside the same point does nothing. Nothing happens on end: the line stays (brief).
  - Composition with the ScrollView: `Screen`'s scroll branch is an RN core `ScrollView`, vertical only. The Pan activates only after 10 pt horizontal travel and fails after 10 pt vertical travel first, so a vertical swipe fails the Pan and the native scroll keeps the touch; a horizontal drag does not move a vertical ScrollView. No `simultaneousWithExternalGesture`/`blocksExternalGesture`: both need a gesture-handler ScrollView or `Gesture.Native()` inside `Screen`, outside this folder. Review Focus 2 states the accepted drift.
  - Export `NET_WORTH_SCRUB_GESTURE_TEST_ID = 'net-worth-line-scrub-gesture'` from the component file (the `HOLD_GESTURE_TEST_ID` precedent) so tests use `getByGestureTestId`.
- a11y: per the coordinator's decision (below). Option A adds `accessible`, `accessibilityRole="adjustable"`, `accessibilityLabel`, `accessibilityValue={{ text }}`, `accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}`, `onAccessibilityAction` (`stepScrubIndex`, `setSelection`, no haptic) on the plot View. Option B adds `accessible` + `accessibilityLabel={text}` on the label View only. `text = t('components.netWorthLine.selectedDay', { amount: formatMoney(money, activeLocale()), date: formatDate(point.t) })`.

### Scenario matrix (behaviour after the change; no earlier rule is reversed, so no "was:" column)

| Event | Line index | Haptic |
|---|---|---|
| First render, N points | N - 1 | none |
| Drag to a new point i | i | 1 tick |
| Drag within the same point | unchanged | none |
| Drag past the right/left edge | N - 1 / 0 | 1 tick only if the index changed |
| Release | stays at i | none |
| Amounts change, same range key (live write, backfill) | stays at i | none |
| Period change (first or last t, or count, changes) | new N - 1 | none |
| Tab re-focus (`focus` event) | N - 1 | none |
| One point | 0, label clamped/placed by width | none |
| Points become empty | empty/loading state, no line | none |

## Decisions for the coordinator

**Rulings (scrub-a1, 2026-10-17, OVERNIGHT DEFAULTS, the user is away; on the morning list):**
D1 = Option A (adjustable plot, `stepScrubIndex`, both strings). D2 = `trigger('selection')`.
D3 = no tap-to-jump. Precedent: coordinator overnight mode (take the recommended option).
Cost if wrong: A to B drops `stepScrubIndex`, one string and three tests; D2/D3 are one-line changes.

1. **VoiceOver (pick one).**
   - **Option A (recommended): the plot is one `adjustable` element.** VoiceOver reads "Net worth by day, <amount>, <date>, adjustable"; swipe up/down moves the line one point (`stepScrubIndex`), reusing the same selection state, so a VoiceOver user gets the feature, not only the present-day value. Cost: one pure function, the a11y props, two strings, three more tests.
   - **Option B (smallest): the label is an accessible text element.** VoiceOver reads "<amount>, <date>" for whatever day the line is on (the present day unless a sighted drag moved it). Read-only; a VoiceOver user cannot move the line. Cost: one string, one test.
2. **Haptic type.** Plan uses `trigger('selection')` (the iOS selection-changed tick for scrubbing a value). Alternative: `'impactLight'`. Default: `'selection'` unless the coordinator says otherwise.
3. **Tap to jump.** The brief names only a drag; a tap does not move the line (the Pan needs 10 pt horizontal travel). Default: no tap-to-jump (YAGNI); say so if the user wants it.

## New strings (en + uk), `components.netWorthLine.*` — USER uk REVIEW REQUIRED before a shipping deploy

| Key | en | uk | Needed by |
|---|---|---|---|
| `components.netWorthLine.selectedDay` | `{{amount}}, {{date}}` | `{{amount}}, {{date}}` | A and B (a11y text only; the visible label uses MoneyText + date, no string) |
| `components.netWorthLine.chartAccessibilityLabel` | `Net worth by day` | `Капітал за днями` | A only |

Sentence case, no final "." (accessibility label role, kiko-translator). The en/uk parity test (`en.uk.parity.test.ts`) must stay green; `check:component-i18n-namespace` passes because the keys sit under the component's own `components.netWorthLine` namespace.

---

## net-worth-scrub task 1/1 (one change set: the math has no caller without the component, and the reviewer judges them together)

### step 1/4: plan (this file) — done, committed.

### step 2/4: qa writes the red tests

- [ ] **`net-worth-line.scrub.test.ts`** (pure; every case fails today with "Cannot find module './net-worth-line.scrub'"; after the developer's change each case pins one boundary):
  - `toLogicalX`: `(0, 240, 320) -> 0`; `(240, 240, 320) -> 320`; `(120, 240, 320) -> 160`; `(-30, 240, 320) -> -40`; `(10, 0, 320) -> null`; `(10, -1, 320) -> null`.
  - `nearestPointIndex` with `[8, 160, 312]`: `x = -100 -> 0`, `x = 8 -> 0`, `x = 84 -> 0` (exact tie, lower index), `x = 84.0001 -> 1`, `x = 83.9999 -> 0`, `x = 236 -> 1` (tie), `x = 236.0001 -> 2`, `x = 312 -> 2`, `x = 999 -> 2`; single `[8]` with any x -> `0`; duplicates `[8, 8, 312]`, `x = 8 -> 0`.
  - `placeScrubLabel` (plotWidth 240, labelWidth 80, gap 6): `lineX 0 -> right, 6`; `lineX 154 -> right, 160` (exact fit `154 + 6 + 80 = 240`); `lineX 155 -> left, 69`; `lineX 86 -> right` (both fit, default right); `lineX 240 -> left, 154`; narrow plot 100, label 80, lineX 50 -> `clamped, 10` (50 - 40, max 20); label 120 wider than plot 100, lineX 50 -> `clamped, 0`; invariant loop over lineX 0..240 step 1: `left >= 0 && left + 80 <= 240`.
  - `scrubRangeKey`: same first/last t and length with different amounts -> equal keys; first t changed -> different; last t changed -> different; length changed (same ends) -> different.
  - `resolveScrubIndex`: `null -> length - 1`; matching key index 2 -> 2; stale key -> `length - 1`; matching key index 9 with 4 points -> 3 (clamp).
  - `stepScrubIndex` (only if option A): `(0, -1, 4) -> 0`, `(3, 1, 4) -> 3`, `(1, 1, 4) -> 2`, `(2, -1, 4) -> 1`, `(0, 1, 1) -> 0`.
- [ ] **`net-worth-line.scrub-line.test.tsx`** (render with `{ wrapper: GestureRootWrapper }`; real i18n init and `@kiko/design-system/unistyles` as the existing component test does; set the language in a hook, never an `it` body; fire `layout` on the plot View and the label View with `nativeEvent.layout.width` so placement runs; `trigger` is already mocked in `jest/setup.js`; fixture: 4 points on consecutive local days via `startOfLocalDay`, distinct amounts). Each case fails today because there is no `net-worth-line-scrub` element, no exported `NET_WORTH_SCRUB_GESTURE_TEST_ID`, or no label:
  - dash/stroke equality: `net-worth-line-scrub` props `strokeDasharray`, `stroke`, `strokeWidth` equal `net-worth-line-reference`'s; `x1 === x2`; `y1`/`y2` equal the x-grid lines' `y1`/`y2`.
  - default at the last point: scrub `x1` equals the x of the last point (read from the polyline's last `points` pair); label shows the last point's amount (`formatMoney` of `Money.fromMajor`) and `formatDate(lastPoint.t)`.
  - gesture config pin (Jest is blind to hit-testing): `getByGestureTestId(NET_WORTH_SCRUB_GESTURE_TEST_ID).config` has `activeOffsetXStart === -10`, `activeOffsetXEnd === 10`, `failOffsetYStart === -10`, `failOffsetYEnd === 10`, and `SCRUB_ACTIVE_OFFSET_X === 10`, `SCRUB_FAIL_OFFSET_Y === 10`. qa probes the config field names in `node_modules/react-native-gesture-handler/src/handlers/gestures/panGesture.ts` first.
  - drag snaps: `fireGestureHandler` `BEGAN, ACTIVE (x near point 1), END` -> scrub `x1` equals point 1's x; label shows point 1's amount and date; after END the line stays at point 1.
  - haptic per new day only: ACTIVE at point 1, then two updates still nearest point 1, then one at point 2 -> `trigger` called exactly twice, each with `'selection'`; a drag that stays on the default last point -> `trigger` not called.
  - reset on period change: re-render with points whose first t differs -> scrub back at the new last point; re-render with SAME t's but new amounts -> scrub stays at point 1.
  - reset on re-open: render inside `makeFocusNavigation().provide(...)`, drag to point 1, `fireFocus()` in `act` -> scrub at the last point.
  - label never clipped: with plot width 240 and label width 80, at the last point the label's `left` is `<= 160` (flipped left); after a drag to point 0 it sits right of the line.
  - a11y (per decision): A -> the plot element has `accessibilityRole 'adjustable'`, `accessibilityValue.text` is the `selectedDay` string for the selected point, `onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } })` moves to point 2 and does not call `trigger`; B -> the label element's `accessibilityLabel` is the `selectedDay` string.
  - empty and loading states render no `net-worth-line-scrub` (guards the hook-order move).
- [ ] Run `npx jest src/screens/statistics/net-worth-line` and confirm every new case is red for the stated reason (module/element/export missing), never a typo. Commit the red tests (pre-commit typecheck passes only if the test file imports nothing missing: per memory "qa: no red commit with missing imports", qa commits the pure test and the component test as one WIP commit only after confirming typecheck, or hands the red files to the developer uncommitted; coordinator's choice).

### step 3/4: developer makes them green

- [ ] Add `net-worth-line.scrub.ts` per "Pure functions". Run `npx jest src/screens/statistics/net-worth-line/net-worth-line.scrub.test.ts` -> green.
- [ ] Change `net-worth-line.component.tsx` and `net-worth-line.styles.ts` per "Component change"; add the strings to `en.ts` and `uk.ts`. Run `npx jest src/screens/statistics` (includes `statistics.screen.test.tsx`, which renders `NetWorthLine` without a navigator) and `npx jest src/i18n` -> green.
- [ ] `npm run check:all` from this worktree -> green (lint, dup, knip, typecheck, import-order, full-word-identifiers, blank-line-separation, comment-line-width, component-i18n-namespace, guard-replay).
- [ ] Commit (timeout 300000, never `--no-verify`).
- [ ] `make verify` once at the end, queued through this worktree's own `scripts/job-queue.sh`, re-run until green.

### step 4/4: reviewer

- [ ] `kiko:reviewer` with kiko-compliance and kiko-design-system: same-style line (no new colour), label tokens, a11y, gesture config, hook order, no reset on a live update. No migration in this set, so no migration review or EXPLAIN QUERY PLAN test.
- [ ] Fix round, if any, re-runs step 3's checks.

### After the change set (coordinator)

- Deep gate: `KIKO_MUTATION_BASE=<this change set's base sha: the plan commit> make mutable` for the file count (expected under 10, well below `MUTATION_FILE_CAP` 30), then `KIKO_MUTATION_BASE=<same sha> make deep`, detached, via `scripts/job-queue.sh gate`. Never a whole-branch run.
- User's uk review of the new strings; user's simulator check (kiko:ops, uninstall first): vertical scroll from the chart, horizontal scrub, label at both edges, haptic on device.

## Skill text this makes stale (for the scribe step)

- **kiko-charts** (`.claude/skills/` and `harness/kiko/skills/`): new section "Net-worth scrub line": the testIDs `net-worth-line-scrub`, `net-worth-line-scrub-label`, `NET_WORTH_SCRUB_GESTURE_TEST_ID`; same dash/stroke as the reference; default present day and the `scrubRangeKey` + focus reset; and the one sanctioned use of a measured plot width (`toLogicalX`, touch px to logical units, plus label placement in px) next to the "do not read `onLayout` width inside a chart's geometry math" rule, which stays true for the scales.
- **kiko-gestures**: add `src/screens/statistics/net-worth-line/` to "Source files"; new section "A horizontal Pan inside a vertical ScrollView" (`activeOffsetX`/`failOffsetY` values, why no external-gesture composition, the accepted drift); name `net-worth-line.scrub.ts` as a second worked example under "Pure-gesture-math testability pattern"; the `'selection'` haptic for a per-step scrub next to `CardContextMenu`'s `'impactMedium'`.
- **kiko-design-system**: only if option A lands, add the adjustable-chart pattern to the accessibility notes.

## Review fix round (scrub-a1 rulings, 2026-10-17, after kiko:reviewer FIX FIRST on ecc68c4b)

- R3 fix in this round: C1 (clear a stale selection during render when the range key changes; test:
  drag on range A, rerender B, rerender A, line on the last point), P1 (help step 2, en + uk, text
  below, OVERNIGHT DEFAULT pending the user's uk review), and the cheap same-file Minors S1 (the two
  import-order breaks), S2 (theme.spacing for the label gap, typography token for the amount
  weight), O1 (placeScrubLabel returns `left` only), O2 (drop the unreachable clamp), O3 (one
  selectedMoney value; drop the default `context="balance"`).
- R4 S1 is mechanizable: import-order.js keeps scanning past an ambient `declare module` block, in
  its own commit, with a positive and a negative test case, a project-wide `npm run
  check:import-order` differential (base vs HEAD: the only new findings may be the files this
  track touches; any other file newly failing = stop and report), and a harness-sync port item.
- Deferred: S3 to the scribe step (kiko-charts measured-width rule, kiko-gestures Source files);
  P2 to the coordinator (Notes for Review, screenshot 06 refresh, resubmission-kit stale flag).
- P1 text, help.topics.viewStatistics.steps.2:
  - en: "Net Worth Over Time" shows your net worth across those dates. The horizontal dashed line
    is its value on the first day: the line is green above it and red below it. The vertical
    dashed line shows your net worth on one day, the last of those dates at first. Drag across the chart to move it
    to another day.
  - uk: «Капітал з часом» показує ваш капітал за ці дати. Горизонтальна пунктирна лінія — його
    значення в перший день: вище за неї лінія зелена, нижче — червона. Вертикальна пунктирна
    лінія показує капітал за один день, спочатку за останню з цих дат. Проведіть пальцем по графіку, щоб
    перемістити її на інший день.

## Review 2 rulings (scrub-a1, whole-branch APPROVE at 8d881c63, 8 Minor)

- R5: the P1 text above is corrected ("today at first" was false for a range that ends in the
  past; the line starts on the last point, endOfLocalDay(dateTo)). Same-file Minors ride it: #1
  clear a stale selection also while points are empty (the clear sits before the empty return);
  #4 the amount weight is a plain '600' (the documented semibold convention), not the heading token.
  Coordinator order: one check-all + one verify at the new tip.
- #2/#7 (import-order closer shapes, cross-run duplicate test) -> run-log gap /1. #8 not taken
  (R4 ruled). #5/#6 -> scribe step (kiko-linter, kiko-code-style, import-order.js header comment,
  harness-sync port item).
