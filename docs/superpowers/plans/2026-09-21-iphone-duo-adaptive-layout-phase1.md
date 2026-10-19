# iPhone Duo adaptive-layout — Phase 1 (correctness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kiko render and behave correctly on the iPhone Duo primary-panel regular-width scene (native right-edge tab-bar sidebar) — no visual redesign, no adaptive/two-pane layout. That is Phase 2, a separate later plan; this plan is Phase 1 only.

**Architecture:** One new pure geometry helper (`isSidebarTabBarMode`) is the single source of truth for "the native tab bar is not at the bottom." `Screen`'s shared `resolveBottomClearance` and the Home FAB both key off it so they can never disagree. Every fix is additive and gated behind that one boolean: when it is `false` (every shipped iPhone today), every changed formula reduces to exactly today's value — zero behavior change on a normal device.

**Tech Stack:** React Native 0.87.1, `react-native-bottom-tabs` (`useBottomTabBarHeight`), `react-native-safe-area-context` (`useSafeAreaInsets`), `react-native` `useWindowDimensions`/`Dimensions`, `@react-navigation/elements` (`HeaderHeightContext`), Jest + `@testing-library/react-native`, Biome, `react-native-unistyles` v3.

**Spec:** `docs/superpowers/specs/2026-09-21-iphone-duo-adaptive-layout-design.md` (Phase 1 section, "Design — Phase 1 (correctness)"). Executors read both documents; this plan does not restate the spec's context/root-cause sections, only what to build.

## Global Constraints

- Branch `duo-adaptive`, off `next` (build 20 / 1.0.0). Does not touch the submitted build — parallel track.
- Phase 1 is correctness-only: **no visual redesign**. Every changed formula must reduce to today's exact value when `isSidebarTabBarMode(...)` is `false`.
- No `node_modules`/`react-native-bottom-tabs` patch — the fix lives entirely in this repo's own JS/TS layer.
- Do **not** reintroduce `SCREENSHOT_MODE` or any screenshot-subsystem code (App Store 5.6; stripped from `next`, stays stripped).
- TDD throughout: every behavioral change starts with a failing test.
- `make gate` (lint, dup, knip, deps, security, rules, plist, secrets, overrides, typecheck) must stay green at every task checkpoint. `make verify` (lint, full Jest, then `make gate`) must pass before this plan is done. No check weakening, no new `biome-ignore` without a justified `OVERRIDE(...)`.
- Full unabbreviated names, 2-space indent, single quotes, `import type`/inline `type` per `kiko-code-style`; blank line before every `return`/`if`/`for`; components read `theme.spacing(...)`, never a raw pixel literal.
- Simulator target for the final verification task: iPhone Duo, UDID `E862974E-9919-42E2-B689-79502A171D93`, iOS 27.1.

---

## Design decision: the sidebar-detection signal (settling the spec's open question)

**Signal:** `isSidebarTabBarMode(tabBarHeight, windowHeight, insetLeft, insetRight)` returns `true` when **either**:

1. `tabBarHeight / windowHeight > 0.5` — an *implausible fraction* of the window height. A real bottom tab bar tops out around 49–83pt even at the largest Dynamic Type size, on the shortest current iPhone window (~667pt) that is at most ≈12%. The sidebar misreport is the sidebar's own full-height frame — measured 678/678 = 100%. A 50% threshold sits with wide margin above every real bottom-bar ratio and wide margin below the sidebar case, so it never misfires on ordinary geometry variation (Dynamic Type, a taller custom bar, a short iPad-mini-class window), **or**
2. `insetLeft > 0 || insetRight > 0` — a nonzero **horizontal** safe-area inset. A compact-width iPhone in portrait always reports `left: 0, right: 0`; a nonzero horizontal inset only appears at a **regular horizontal size class**, which is exactly the trait that moves the native tab bar to a sidebar (confirmed in the spec: `sidebarAdaptable` is not set in this repo — this is OS behavior triggered by size class alone). This also means the same code path fires on a landscape iPhone Pro Max/Plus (Apple's Plus/Max-class iPhones report a regular horizontal size class in landscape), not just the Duo simulator — this fix generalizes beyond the one device it was diagnosed on.

**Why OR, not AND:** both signals are expected to co-occur on every real regular-width scene, since they both derive from the identical native trait-collection/size-class change. OR gives defense-in-depth — either signal alone is sufficient to catch the anomaly — with negligible false-positive risk, because signal 2 alone can only ever fire when the device is already at regular width (never on an ordinary compact-width iPhone portrait scene, where `insetLeft`/`insetRight` are always `0`).

**File:** `src/design-system/components/screen/sidebar-mode.ts`, exported as `isSidebarTabBarMode`, re-exported from `src/design-system/components/screen/index.ts` alongside `resolveBottomClearance` — so `Screen`, Home, and Holding Detail all import and call the exact same function rather than each re-deriving the rule (mirrors the existing `resolveBottomClearance` "one shared place" contract in `kiko-design-system`).

---

### Task 1: Sidebar-detection helper

**Files:**
- Create: `src/design-system/components/screen/sidebar-mode.ts`
- Create: `src/design-system/components/screen/sidebar-mode.test.ts`
- Modify: `src/design-system/components/screen/index.ts`

**Interfaces:**
- Produces: `isSidebarTabBarMode(tabBarHeight: number, windowHeight: number, insetLeft: number, insetRight: number): boolean`, re-exported from `src/design-system/components/screen`. Every later task imports this from `'../../design-system/components/screen'` (or the correct relative depth for its own file).

- [ ] **Step 1: Write the failing test**

Create `src/design-system/components/screen/sidebar-mode.test.ts`:

```ts
import { isSidebarTabBarMode } from './sidebar-mode';

describe('isSidebarTabBarMode', () => {
  it('detects the exact measured Duo primary-panel geometry (implausible tab-bar height AND a nonzero right inset)', () => {
    expect(isSidebarTabBarMode(678, 678, 0, 84)).toBe(true);
  });

  it('is false for an ordinary bottom-tab-bar iPhone', () => {
    expect(isSidebarTabBarMode(80, 844, 0, 0)).toBe(false);
  });

  it('is true from an implausible tab-bar height alone, even with zero insets', () => {
    expect(isSidebarTabBarMode(500, 678, 0, 0)).toBe(true);
  });

  it('is true from a nonzero horizontal inset alone, even with a plausible tab-bar height', () => {
    // A landscape Plus/Max-class iPhone: regular width, so the OS could move
    // the tab bar to a sidebar even where a shorter bar height still gets
    // reported correctly — the inset signal alone must still catch it.
    expect(isSidebarTabBarMode(60, 926, 0, 20)).toBe(true);
  });

  it('does not divide by zero or false-positive on a zero window height', () => {
    expect(isSidebarTabBarMode(0, 0, 0, 0)).toBe(false);
  });

  it('is false right at the implausibility threshold boundary (not strictly greater)', () => {
    expect(isSidebarTabBarMode(339, 678, 0, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/design-system/components/screen/sidebar-mode.test.ts`
Expected: FAIL — `Cannot find module './sidebar-mode'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/design-system/components/screen/sidebar-mode.ts`:

```ts
// The fraction of window height a native BOTTOM tab bar can plausibly reach.
// A real bottom tab bar tops out well under this even at the largest Dynamic
// Type size and on the shortest current iPhone window (~667pt, ~83pt bar =
// ~12%). The sidebar misreport is the tab bar's FULL frame height — measured
// 678/678 = 100% on the Duo primary panel. This threshold sits with wide
// margin above the former and wide margin below the latter, so it never
// misfires on ordinary bottom-bar geometry. See the duo-adaptive design doc
// and this plan's "Design decision" section for the full justification.
const IMPLAUSIBLE_TAB_BAR_HEIGHT_FRACTION = 0.5;

// The single, shared "is the native tab bar NOT at the bottom" signal.
// `Screen`'s bottom-clearance/horizontal-padding math and the Home
// AddTransactionFab both key off this ONE function so they can never
// disagree about which mode the app is in.
//
// True when EITHER: the reported tab-bar height is an implausible fraction
// of the window height (the sidebar misreport itself), OR a nonzero
// horizontal safe-area inset is present (only possible at a regular
// horizontal size class — the same trait that moves the tab bar to a
// sidebar in the first place, on the Duo primary panel and on a landscape
// Plus/Max-class iPhone alike). Either signal alone is sufficient; both are
// expected to co-occur on a real regular-width scene.
export const isSidebarTabBarMode = (
  tabBarHeight: number,
  windowHeight: number,
  insetLeft: number,
  insetRight: number,
): boolean => {
  const isImplausibleTabBarHeight =
    windowHeight > 0 && tabBarHeight / windowHeight > IMPLAUSIBLE_TAB_BAR_HEIGHT_FRACTION;
  const hasHorizontalInset = insetLeft > 0 || insetRight > 0;

  return isImplausibleTabBarHeight || hasHorizontalInset;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/design-system/components/screen/sidebar-mode.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Export it from the folder barrel**

Edit `src/design-system/components/screen/index.ts` — current content:

```ts
export { resolveBottomClearance } from './bottom-clearance';
export { default } from './screen.component';
```

New content:

```ts
export { resolveBottomClearance } from './bottom-clearance';
export { isSidebarTabBarMode } from './sidebar-mode';
export { default } from './screen.component';
```

- [ ] **Step 6: Gate check**

Run: `make gate`
Expected: PASS (typecheck passes — `isSidebarTabBarMode` is exported but not yet consumed anywhere, which is not a `noUnusedExports`-style failure for a named barrel export).

- [ ] **Step 7: Commit**

```bash
git add src/design-system/components/screen/sidebar-mode.ts src/design-system/components/screen/sidebar-mode.test.ts src/design-system/components/screen/index.ts
git commit -m "feat(design-system): add isSidebarTabBarMode, the shared Duo sidebar-detection signal"
```

---

### Task 2: Sidebar-aware bottom clearance (Screen, Home's list, Holding Detail)

**Files:**
- Modify: `src/design-system/components/screen/bottom-clearance.ts`
- Modify: `src/design-system/components/screen/bottom-clearance.test.ts`
- Modify: `src/design-system/components/screen/screen.component.tsx`
- Modify: `src/screens/home/home.screen.tsx`
- Modify: `src/screens/home/home.screen.test.tsx`
- Modify: `src/screens/holding-detail/holding-detail.screen.tsx`
- Modify: `.claude/skills/kiko-design-system/SKILL.md`

**Interfaces:**
- Consumes: `isSidebarTabBarMode` from Task 1 (`src/design-system/components/screen`).
- Produces: `resolveBottomClearance(tabBarHeight: number, insetBottom: number, isSidebarMode: boolean): number` (signature change — third parameter is now **required**, no default, so every call site makes an explicit, correct choice). `home.screen.tsx` gains a local `isSidebarMode` boolean computed once, which Task 4 reuses to anchor the FAB — do not recompute it a second way there.

- [ ] **Step 1: Write the failing test**

Edit `src/design-system/components/screen/bottom-clearance.test.ts` — replace the whole file:

```ts
import { resolveBottomClearance } from './bottom-clearance';

describe('resolveBottomClearance', () => {
  describe('bottom-bar mode (isSidebarMode = false)', () => {
    it('subtracts the inset the SafeAreaView already reserves', () => {
      expect(resolveBottomClearance(80, 34, false)).toBe(46);
    });

    it('clamps to zero when the inset alone exceeds the bar', () => {
      expect(resolveBottomClearance(20, 34, false)).toBe(0);
    });

    it('is the full bar height with no inset', () => {
      expect(resolveBottomClearance(80, 0, false)).toBe(80);
    });
  });

  describe('sidebar mode (isSidebarMode = true)', () => {
    it('ignores the poisoned full-window-height tab bar and adds ZERO extra clearance — the exact measured Duo geometry', () => {
      // 678 - 34 = 644 would be the bug (a ~676pt footer covering the
      // screen). There is no floating bottom bar to clear in sidebar mode —
      // the SafeAreaView's own bottom-inset reservation is already the
      // full, correct clearance, exactly the existing zero-clamp's own
      // documented invariant, just reached via a reliable signal instead of
      // an accidental `tabBarHeight <= insetBottom`.
      expect(resolveBottomClearance(678, 34, true)).toBe(0);
    });

    it('adds zero clearance regardless of how implausible the reported tab-bar height is', () => {
      expect(resolveBottomClearance(999_999, 34, true)).toBe(0);
      expect(resolveBottomClearance(0, 34, true)).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/design-system/components/screen/bottom-clearance.test.ts`
Expected: FAIL — TS2554 "Expected 3 arguments, but got 2" on every call (the current implementation only takes 2 params).

- [ ] **Step 3: Write minimal implementation**

Edit `src/design-system/components/screen/bottom-clearance.ts` — replace the whole file:

```ts
/**
 * The clearance a view that owns the screen's true bottom edge must add ABOVE
 * the safe-area inset, so its last row clears the floating native glass tab
 * bar exactly once.
 *
 * The enclosing `SafeAreaView` already reserves `insetBottom` as its own
 * padding, so a consumer that adds the full `tabBarHeight` on top of it
 * double-counts the inset. Home did exactly that — 80 + 16 + 34 = 130 pt of
 * dead space under the last transaction, against 96 pt on every other screen —
 * because it opts out of `Screen`'s own bottom handling with `bleedBottom` and
 * computed its own clearance. This function is the ONE place that arithmetic
 * lives, shared by `Screen` and by every `bleedBottom` child.
 *
 * `isSidebarMode` (see `isSidebarTabBarMode`, `sidebar-mode.ts`) — when the
 * native tab bar renders as a right-edge sidebar (a regular-width scene, e.g.
 * the iPhone Duo primary panel or a landscape Plus/Max-class iPhone), it
 * misreports its own height as the FULL WINDOW HEIGHT rather than a short
 * bar (confirmed: 678pt on a 678pt-tall window). `tabBarHeight` is therefore
 * UNTRUSTED in sidebar mode and ignored entirely: there is no floating
 * bottom bar to clear at all in that mode, so the correct extra clearance is
 * ZERO — the SafeAreaView's own bottom-inset reservation is already the
 * full, correct clearance, exactly the same invariant the ordinary zero-clamp
 * below already documents, just reached through a reliable signal instead of
 * the accidental `tabBarHeight <= insetBottom` case (which the bug's real
 * numbers, 678 > 34, never triggers).
 *
 * Clamped at 0 in bottom-bar mode too: on a device whose bottom inset alone
 * exceeds the bar height, the SafeAreaView's reservation is already the
 * full, correct clearance and nothing more is needed.
 */
export const resolveBottomClearance = (
  tabBarHeight: number,
  insetBottom: number,
  isSidebarMode: boolean,
): number => {
  if (isSidebarMode) {
    return 0;
  }

  return Math.max(tabBarHeight - insetBottom, 0);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/design-system/components/screen/bottom-clearance.test.ts`
Expected: PASS (5 tests). The wider suite now fails to typecheck at the other three call sites — expected, fixed in the next steps.

- [ ] **Step 5: Wire it into `Screen`**

Edit `src/design-system/components/screen/screen.component.tsx`. Current lines 1–9:

```ts
import type { FC } from 'react';
import { ScrollView, View } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveBottomClearance } from './bottom-clearance';
import type { ScreenProps } from './screen.props';
import { styles } from './screen.styles';
```

New:

```ts
import type { FC } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveBottomClearance } from './bottom-clearance';
import { isSidebarTabBarMode } from './sidebar-mode';
import type { ScreenProps } from './screen.props';
import { styles } from './screen.styles';
```

Current lines 45–54 (inside the component body):

```ts
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  // Both `SafeAreaView` branches below already reserve `insets.bottom`
  // themselves as real padding — `edges` includes `'bottom'` in the scroll
  // branch's explicit list, and in the plain branch's default (an unset
  // `edges` prop reserves every edge). Adding the FULL tab-bar height again
  // on top of that reservation double-counts the inset. See
  // `bottom-clearance.ts` for the shared arithmetic (also used by every
  // `bleedBottom` child, e.g. Home's transaction list) and its full rationale.
  const bottomClearance = resolveBottomClearance(tabBarHeight, insets.bottom);
```

New:

```ts
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const windowHeight = useWindowDimensions().height;
  // The ONE shared signal for "the native tab bar is a right-edge sidebar,
  // not a bottom bar" (a regular-width scene — the iPhone Duo primary panel,
  // or a landscape Plus/Max-class iPhone). See `sidebar-mode.ts`.
  const isSidebarMode = isSidebarTabBarMode(tabBarHeight, windowHeight, insets.left, insets.right);
  // Both `SafeAreaView` branches below already reserve `insets.bottom`
  // themselves as real padding — `edges` includes `'bottom'` in the scroll
  // branch's explicit list, and in the plain branch's default (an unset
  // `edges` prop reserves every edge). Adding the FULL tab-bar height again
  // on top of that reservation double-counts the inset. See
  // `bottom-clearance.ts` for the shared arithmetic (also used by every
  // `bleedBottom` child, e.g. Home's transaction list) and its full
  // rationale, including why `isSidebarMode` makes the tab-bar height
  // untrusted entirely in that mode.
  const bottomClearance = resolveBottomClearance(tabBarHeight, insets.bottom, isSidebarMode);
```

(Leave every other line in this file untouched for this task — the horizontal-padding wiring is Task 3.)

- [ ] **Step 6: Wire it into Home's list clearance**

Edit `src/screens/home/home.screen.tsx`. Current line 14–16:

```ts
import { RefreshControl, SectionList } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
```

New:

```ts
import { RefreshControl, SectionList, useWindowDimensions } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
```

Current line 32:

```ts
import Screen, { resolveBottomClearance } from '../../design-system/components/screen';
```

New:

```ts
import Screen, { isSidebarTabBarMode, resolveBottomClearance } from '../../design-system/components/screen';
```

Current lines 90–92:

```ts
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const listBottomClearance = resolveBottomClearance(tabBarHeight, insets.bottom);
```

New:

```ts
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const windowHeight = useWindowDimensions().height;
  // The ONE shared signal Screen itself uses (see `sidebar-mode.ts`) — Home
  // computes its own clearance because it opts out of Screen's own bottom
  // handling with `bleedBottom`, so it must key off the identical function,
  // never re-derive the rule. Task 4 (`AddTransactionFab`'s right anchor)
  // reuses this same `isSidebarMode` value below.
  const isSidebarMode = isSidebarTabBarMode(tabBarHeight, windowHeight, insets.left, insets.right);
  const listBottomClearance = resolveBottomClearance(tabBarHeight, insets.bottom, isSidebarMode);
```

- [ ] **Step 7: Update the existing Home test's direct call**

Edit `src/screens/home/home.screen.test.tsx` line 937. Current:

```ts
    expect(listPadding).toBe(resolveBottomClearance(MOCK_TAB_BAR_HEIGHT, MOCK_BOTTOM_INSET));
```

New:

```ts
    expect(listPadding).toBe(resolveBottomClearance(MOCK_TAB_BAR_HEIGHT, MOCK_BOTTOM_INSET, false));
```

(This file's mocked insets are `{ left: 0, right: 0, ... }`, so `isSidebarMode` is `false` here — this is a pure signature-compatibility update, the asserted value is unchanged.)

- [ ] **Step 8: Wire it into Holding Detail's list clearance**

Edit `src/screens/holding-detail/holding-detail.screen.tsx` line 11. Current:

```ts
import { FlatList, Pressable } from 'react-native';
```

New:

```ts
import { FlatList, Pressable, useWindowDimensions } from 'react-native';
```

Line 36. Current:

```ts
import Screen, { resolveBottomClearance } from '../../design-system/components/screen';
```

New:

```ts
import Screen, { isSidebarTabBarMode, resolveBottomClearance } from '../../design-system/components/screen';
```

Lines 470–473. Current:

```ts
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const listBottomClearance =
    footerAction === 'none' ? resolveBottomClearance(tabBarHeight, insets.bottom) : 0;
```

New:

```ts
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const windowHeight = useWindowDimensions().height;
  const isSidebarMode = isSidebarTabBarMode(tabBarHeight, windowHeight, insets.left, insets.right);
  const listBottomClearance =
    footerAction === 'none' ? resolveBottomClearance(tabBarHeight, insets.bottom, isSidebarMode) : 0;
```

(`holding-detail.screen.test.tsx` has no direct mocks for `useBottomTabBarHeight`/`useSafeAreaInsets` — it relies on the global manual mocks, both zero — so `isSidebarMode` resolves `false` there and every existing assertion is unaffected. No test file change needed for this call site.)

- [ ] **Step 9: Run the full suite and gate**

Run: `npx jest src/design-system/components/screen src/screens/home src/screens/holding-detail`
Expected: PASS, all files.

Run: `make gate`
Expected: PASS.

- [ ] **Step 10: Update the design-system skill doc**

Edit `.claude/skills/kiko-design-system/SKILL.md`. Find the `Screen` bullet's sentence:

> A `bleedBottom` child that owns the screen's true bottom edge itself — must compute that same clearance with the shared `resolveBottomClearance(tabBarHeight, insetBottom)` helper exported from `src/design-system/components/screen/bottom-clearance.ts` — never re-derive it inline, or it double-counts the bottom safe-area inset Screen's `SafeAreaView` already reserves.

Replace with:

> A `bleedBottom` child that owns the screen's true bottom edge itself — must compute that same clearance with the shared `resolveBottomClearance(tabBarHeight, insetBottom, isSidebarMode)` helper exported from `src/design-system/components/screen/bottom-clearance.ts` — never re-derive it inline, or it double-counts the bottom safe-area inset Screen's `SafeAreaView` already reserves. `isSidebarMode` comes from the shared `isSidebarTabBarMode` (`sidebar-mode.ts`, same folder): on a regular-width scene where the native tab bar renders as a right-edge sidebar (the iPhone Duo primary panel, or a landscape Plus/Max-class iPhone), the tab bar misreports its own height as the full window height, so `resolveBottomClearance` ignores it entirely and returns `0` extra clearance in that mode.

- [ ] **Step 11: Commit**

```bash
git add src/design-system/components/screen/bottom-clearance.ts src/design-system/components/screen/bottom-clearance.test.ts src/design-system/components/screen/screen.component.tsx src/screens/home/home.screen.tsx src/screens/home/home.screen.test.tsx src/screens/holding-detail/holding-detail.screen.tsx .claude/skills/kiko-design-system/SKILL.md
git commit -m "fix(design-system): make resolveBottomClearance ignore the poisoned sidebar tab-bar height"
```

---

### Task 3: Screen horizontal insets (content/footer/scroll padding clear of the sidebar)

**Files:**
- Modify: `src/design-system/components/screen/screen.styles.ts`
- Modify: `src/design-system/components/screen/screen.component.tsx`
- Modify: `src/design-system/components/screen/screen.component.test.tsx`

**Interfaces:**
- Consumes: `isSidebarTabBarMode` (Task 1), the `isSidebarMode` local variable Task 2 already added to `screen.component.tsx`.
- Produces: `styles.content`, `styles.scrollContent`, `styles.footer` each gain a `horizontalClearance: { left: number; right: number }` parameter (additive — every existing positional parameter keeps its position).

This mirrors `resolveBottomClearance`'s own pattern exactly: a base spacing step, plus an explicit, geometry-derived amount added on top, computed once and gated behind `isSidebarMode` — never relying on the outer `SafeAreaView`'s own (untested-for-this-axis, and per the spec's live-measured FAB bug, apparently insufficient on its own) edge reservation.

- [ ] **Step 1: Write the failing test**

Edit `src/design-system/components/screen/screen.component.test.tsx`. First, make the two local mocks mutable so a dedicated case below can override them per test (every other existing test in this file is unaffected — the default return values are unchanged).

Current lines 17–75 (the two `jest.mock` blocks):

```ts
const MOCK_TAB_BAR_HEIGHT = 80;
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => MOCK_TAB_BAR_HEIGHT,
}));
```

New:

```ts
const MOCK_TAB_BAR_HEIGHT = 80;
// A mutable `jest.fn()` wrapper (not a plain arrow factory) so the dedicated
// "Duo sidebar mode" cases at the end of this file can override it per test
// and restore it afterwards — every other test here never touches it, so it
// keeps returning this exact default throughout.
const mockUseBottomTabBarHeight = jest.fn(() => MOCK_TAB_BAR_HEIGHT);
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => mockUseBottomTabBarHeight(),
}));
```

Then, inside the `react-native-safe-area-context` mock factory, the current last line:

```ts
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: MOCK_BOTTOM_INSET, left: 0 }),
```

New — first add a mutable wrapper right above the `jest.mock` call (immediately after `const MOCK_BOTTOM_INSET = 34;`):

```ts
const MOCK_BOTTOM_INSET = 34;
// Same mutable-wrapper treatment as `mockUseBottomTabBarHeight` above, for
// the same reason.
const mockUseSafeAreaInsets = jest.fn(() => ({
  top: 0,
  right: 0,
  bottom: MOCK_BOTTOM_INSET,
  left: 0,
}));
```

and change the mock factory's last line to:

```ts
    useSafeAreaInsets: () => mockUseSafeAreaInsets(),
```

(Leave the rest of the `react-native-safe-area-context` mock factory — the `mockSafeAreaView` component — untouched.)

Now add the new test, near the end of the file, just before the final `});` that closes `describe('Screen', ...)`:

```ts
  describe('Duo sidebar mode (regular-width scene, native right-edge sidebar)', () => {
    const DUO_INSETS = { top: 0, right: 84, bottom: MOCK_BOTTOM_INSET, left: 0 };

    afterEach(() => {
      mockUseBottomTabBarHeight.mockReturnValue(MOCK_TAB_BAR_HEIGHT);
      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        right: 0,
        bottom: MOCK_BOTTOM_INSET,
        left: 0,
      });
    });

    it('ignores the poisoned tab-bar height and pads content clear of the right sidebar inset — the exact measured Duo primary-panel geometry', async () => {
      mockUseBottomTabBarHeight.mockReturnValue(678);
      mockUseSafeAreaInsets.mockReturnValue(DUO_INSETS);

      const { getByTestId } = await renderScreen({ footer: footerNode });

      const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

      // Sidebar mode distrusts the tab-bar height entirely: the footer's own
      // padding is just the gap (16) plus 0 extra clearance, not 16 + 644 —
      // the ~676pt footer that used to cover the screen.
      expect(footerStyle.paddingBottom).toBe(FOOTER_GAP);
      // Padded clear of the 84pt right sidebar inset, on top of the base
      // spacing(4) = 16 step, so the sidebar chrome no longer paints over it.
      expect(footerStyle.paddingRight).toBe(16 + 84);
    });

    it("keeps today's horizontal padding unchanged when the tab bar is NOT a sidebar", async () => {
      const { getByTestId } = await renderScreen({ footer: footerNode });

      const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

      expect(footerStyle.paddingRight).toBe(16);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/design-system/components/screen/screen.component.test.tsx`
Expected: FAIL — `footerStyle.paddingRight` is `undefined` (the current `footer` style only sets `paddingHorizontal`, which `StyleSheet.flatten` returns verbatim as `paddingHorizontal`, not `paddingRight`).

- [ ] **Step 3: Write minimal implementation**

Edit `src/design-system/components/screen/screen.styles.ts`. Current `content`, `scrollContent`, and `footer` entries:

```ts
  content: (ownsClearance: boolean, bottomClearance: number) => ({
    flex: 1,
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: ownsClearance
      ? theme.spacing(FOOTER_GAP_STEP) + bottomClearance
      : theme.spacing(4),
  }),
  scrollContent: (hasFooter: boolean) => ({
    padding: theme.spacing(4),
    paddingBottom: hasFooter ? 0 : theme.spacing(4),
  }),
  footer: (bottomClearance: number) => ({
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: theme.spacing(FOOTER_GAP_STEP) + bottomClearance,
  }),
```

New — add a shared `HorizontalClearance` type near the top of the file (after the `FOOTER_GAP_STEP` constant) and thread it through all three functions:

```ts
// Extra left/right padding, on top of the base spacing step, added ONLY on a
// regular-width scene where the native tab bar is a right-edge sidebar (see
// `isSidebarTabBarMode`, `sidebar-mode.ts`) — `{ left: 0, right: 0 }` on
// every ordinary bottom-tab-bar iPhone, which reduces every padding value
// below to exactly today's, byte-for-byte. Computed once in
// `screen.component.tsx` from `useSafeAreaInsets()`, never re-derived here.
type HorizontalClearance = { left: number; right: number };
```

```ts
  content: (
    ownsClearance: boolean,
    bottomClearance: number,
    horizontalClearance: HorizontalClearance,
  ) => ({
    flex: 1,
    paddingTop: theme.spacing(4),
    paddingLeft: theme.spacing(4) + horizontalClearance.left,
    paddingRight: theme.spacing(4) + horizontalClearance.right,
    paddingBottom: ownsClearance
      ? theme.spacing(FOOTER_GAP_STEP) + bottomClearance
      : theme.spacing(4),
  }),
  scrollContent: (hasFooter: boolean, horizontalClearance: HorizontalClearance) => ({
    paddingTop: theme.spacing(4),
    paddingLeft: theme.spacing(4) + horizontalClearance.left,
    paddingRight: theme.spacing(4) + horizontalClearance.right,
    paddingBottom: hasFooter ? 0 : theme.spacing(4),
  }),
  footer: (bottomClearance: number, horizontalClearance: HorizontalClearance) => ({
    paddingTop: theme.spacing(4),
    paddingLeft: theme.spacing(4) + horizontalClearance.left,
    paddingRight: theme.spacing(4) + horizontalClearance.right,
    paddingBottom: theme.spacing(FOOTER_GAP_STEP) + bottomClearance,
  }),
```

Note: `scrollContent` previously used the `padding: theme.spacing(4)` shorthand (covering all four sides) with `paddingBottom` overridden after it. Splitting it into explicit `paddingTop`/`paddingLeft`/`paddingRight` (`paddingBottom` still decided separately) preserves the exact same four resolved values when `horizontalClearance` is `{ left: 0, right: 0 }`.

Now edit `src/design-system/components/screen/screen.component.tsx` to compute and pass `horizontalClearance`. Add this line right after the `isSidebarMode` line Task 2 added:

```ts
  const isSidebarMode = isSidebarTabBarMode(tabBarHeight, windowHeight, insets.left, insets.right);
  const horizontalClearance = isSidebarMode
    ? { left: insets.left, right: insets.right }
    : { left: 0, right: 0 };
```

Then update the three call sites that reference `styles.content`, `styles.scrollContent`, `styles.footer` (there are two `footer` render sites — the `scroll` branch and the `bleedTop` branch — plus a third in the plain branch; update all three, and the one `scrollContent` call, and the one `content` call):

`contentContainerStyle={styles.scrollContent(footer !== undefined)}` →
`contentContainerStyle={styles.scrollContent(footer !== undefined, horizontalClearance)}`

Every `style={styles.footer(bottomClearance)}` (three occurrences: scroll branch, `bleedTop` branch, plain branch) →
`style={styles.footer(bottomClearance, horizontalClearance)}`

`style={styles.content(contentOwnsClearance, bottomClearance)}` →
`style={styles.content(contentOwnsClearance, bottomClearance, horizontalClearance)}`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/design-system/components/screen/screen.component.test.tsx`
Expected: PASS — all 24 pre-existing tests (unchanged — every mocked inset there is `{ left: 0, right: 0 }`, so `horizontalClearance` resolves `{0,0}` and every asserted padding value is identical to before) plus the 2 new ones.

- [ ] **Step 5: Full-file and gate check**

Run: `npx jest src/design-system/components/screen`
Expected: PASS, every file.

Run: `make gate`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/design-system/components/screen/screen.styles.ts src/design-system/components/screen/screen.component.tsx src/design-system/components/screen/screen.component.test.tsx
git commit -m "fix(design-system): pad Screen content clear of the sidebar's horizontal safe-area inset"
```

---

### Task 4: FAB anchors clear of the right sidebar inset

**Files:**
- Modify: `src/screens/home/add-transaction-fab/add-transaction-fab.props.d.ts`
- Modify: `src/screens/home/add-transaction-fab/add-transaction-fab.styles.ts`
- Modify: `src/screens/home/add-transaction-fab/add-transaction-fab.component.tsx`
- Modify: `src/screens/home/add-transaction-fab/add-transaction-fab.component.test.tsx`
- Modify: `src/screens/home/home.screen.tsx`
- Modify: `src/screens/home/home.screen.test.tsx`

**Interfaces:**
- Consumes: `AddTransactionFabProps` (existing), the `isSidebarMode` local variable Task 2 added to `home.screen.tsx`.
- Produces: `AddTransactionFabProps.rightOffset?: number` (new, optional, defaults `0` — omitting it, as every existing call site except Home's does, reproduces today's exact position).

- [ ] **Step 1: Write the failing test**

Edit `src/screens/home/add-transaction-fab/add-transaction-fab.component.test.tsx` — add two new `it` blocks at the end of the `describe('AddTransactionFab', ...)` block:

```ts
  it('keeps the right anchor unchanged when rightOffset is omitted (an ordinary bottom tab bar)', async () => {
    const { getByLabelText } = await render(
      <AddTransactionFab onPress={() => undefined} bottomOffset={0} />,
    );

    const fab = getByLabelText('Add transaction');
    const flattened = StyleSheet.flatten(fab.props.style);

    expect(flattened.right).toBe(16);
  });

  it('anchors clear of the right safe-area inset when given a nonzero rightOffset (a sidebar tab bar)', async () => {
    const { getByLabelText } = await render(
      <AddTransactionFab onPress={() => undefined} bottomOffset={0} rightOffset={84} />,
    );

    const fab = getByLabelText('Add transaction');
    const flattened = StyleSheet.flatten(fab.props.style);

    // The usual spacing(4) = 16 gap, PLUS the 84pt sidebar inset — clear of
    // the native sidebar chrome, never underneath it.
    expect(flattened.right).toBe(16 + 84);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/home/add-transaction-fab/add-transaction-fab.component.test.tsx`
Expected: FAIL — the second new test fails TypeScript compilation (`rightOffset` does not exist on `AddTransactionFabProps`); the first passes already (it only pins today's existing behavior).

- [ ] **Step 3: Write minimal implementation**

Edit `src/screens/home/add-transaction-fab/add-transaction-fab.props.d.ts`. Current:

```ts
export type AddTransactionFabProps = {
  // Fired on tap — Home wires this to `navigate('TransactionForm', {})`, the
  // empty-create entry that opens the shared form with no holding fixed.
  onPress: () => void;
  // The Home list's own bottom clearance (the floating tab-bar gap). The FAB
  // sits OUTSIDE the scroll content, so it lifts itself above this so it never
  // overlaps the tab bar.
  bottomOffset: number;
};
```

New:

```ts
export type AddTransactionFabProps = {
  // Fired on tap — Home wires this to `navigate('TransactionForm', {})`, the
  // empty-create entry that opens the shared form with no holding fixed.
  onPress: () => void;
  // The Home list's own bottom clearance (the floating tab-bar gap). The FAB
  // sits OUTSIDE the scroll content, so it lifts itself above this so it never
  // overlaps the tab bar.
  bottomOffset: number;
  // Extra clearance from the right edge when the native tab bar renders as a
  // right-edge sidebar instead of a bottom bar (see `isSidebarTabBarMode`) —
  // the sidebar's own width (the right safe-area inset), so the circle sits
  // clear of its chrome instead of underneath it. Defaults to `0`, leaving
  // today's fixed right anchor unchanged on an ordinary bottom-tab-bar
  // iPhone.
  rightOffset?: number;
};
```

Edit `src/screens/home/add-transaction-fab/add-transaction-fab.styles.ts`. Current `fab`:

```ts
  fab: (bottomOffset: number) => ({
    position: 'absolute' as const,
    right: theme.spacing(4),
    bottom: bottomOffset + theme.spacing(4),
    width: theme.spacing(14),
    height: theme.spacing(14),
    borderRadius: theme.radii.full,
  }),
```

New:

```ts
  fab: (bottomOffset: number, rightOffset: number) => ({
    position: 'absolute' as const,
    right: rightOffset + theme.spacing(4),
    bottom: bottomOffset + theme.spacing(4),
    width: theme.spacing(14),
    height: theme.spacing(14),
    borderRadius: theme.radii.full,
  }),
```

Edit `src/screens/home/add-transaction-fab/add-transaction-fab.component.tsx`. Current:

```ts
const AddTransactionFab: FC<AddTransactionFabProps> = ({ onPress, bottomOffset }) => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  // `bottomOffset` is a runtime value, so the positioned base style is a
  // function call — memoized so a Home re-render (e.g. a reactive fire during a
  // sync) does not rebuild an identical style object each time.
  const fabStyle = useMemo(() => styles.fab(bottomOffset), [bottomOffset]);
```

New:

```ts
const AddTransactionFab: FC<AddTransactionFabProps> = ({ onPress, bottomOffset, rightOffset = 0 }) => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  // `bottomOffset`/`rightOffset` are runtime values, so the positioned base
  // style is a function call — memoized so a Home re-render (e.g. a reactive
  // fire during a sync) does not rebuild an identical style object each time.
  const fabStyle = useMemo(
    () => styles.fab(bottomOffset, rightOffset),
    [bottomOffset, rightOffset],
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/home/add-transaction-fab`
Expected: PASS, all tests (7 total).

- [ ] **Step 5: Wire Home to pass rightOffset**

Edit `src/screens/home/home.screen.tsx`. Current line 90–92 area now reads (after Task 2's edit):

```ts
  const isSidebarMode = isSidebarTabBarMode(tabBarHeight, windowHeight, insets.left, insets.right);
  const listBottomClearance = resolveBottomClearance(tabBarHeight, insets.bottom, isSidebarMode);
```

Add directly below it:

```ts
  // The FAB is a positioned sibling, not a Screen `footer`/`content` child, so
  // it needs its own explicit clearance from the SAME `isSidebarMode` signal
  // — the sidebar's own width (the right safe-area inset) when present, `0`
  // otherwise (today's unchanged fixed anchor).
  const fabRightOffset = isSidebarMode ? insets.right : 0;
```

Current line 502:

```ts
        <AddTransactionFab onPress={handleAddTransaction} bottomOffset={listBottomClearance} />
```

New:

```ts
        <AddTransactionFab
          onPress={handleAddTransaction}
          bottomOffset={listBottomClearance}
          rightOffset={fabRightOffset}
        />
```

- [ ] **Step 6: Write the failing Home-level test (the exact measured case, end to end)**

Edit `src/screens/home/home.screen.test.tsx`. Task 2 only changed this file's direct `resolveBottomClearance(...)` call (Step 7) — its two mocks are still the original static factories. Make both mutable now, together, the same way Task 3 already did for `screen.component.test.tsx`. Current lines 38–41:

```ts
const MOCK_TAB_BAR_HEIGHT = 80;
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => MOCK_TAB_BAR_HEIGHT,
}));
```

New:

```ts
const MOCK_TAB_BAR_HEIGHT = 80;
// Mutable so the dedicated "Duo sidebar mode" cases below can override it
// per test and restore it afterwards — see `mockUseSafeAreaInsets` just
// below for the identical treatment and rationale.
const mockUseBottomTabBarHeight = jest.fn(() => MOCK_TAB_BAR_HEIGHT);
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => mockUseBottomTabBarHeight(),
}));
```

Current lines 43–51:

```ts
const MOCK_BOTTOM_INSET = 34;
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');

  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: MOCK_BOTTOM_INSET, left: 0 }),
  };
});
```

New:

```ts
const MOCK_BOTTOM_INSET = 34;
// A plain arrow-returning factory can't be overridden per test, so this is a
// mutable `jest.fn()` wrapper instead — its default return value is exactly
// what every existing test in this file expects (a bottom-tab-bar iPhone,
// zero horizontal inset); only the dedicated "Duo sidebar mode" tests at the
// end of this file override it, restoring it in their own `afterEach`.
const mockUseSafeAreaInsets = jest.fn(() => ({
  top: 0,
  right: 0,
  bottom: MOCK_BOTTOM_INSET,
  left: 0,
}));
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');

  return {
    ...actual,
    useSafeAreaInsets: () => mockUseSafeAreaInsets(),
  };
});
```

Extend the file's existing `import { StyleSheet } from 'react-native';` (line 3) to also import `Dimensions`:

```ts
import { Dimensions, StyleSheet } from 'react-native';
```

Now add a new nested `describe` block just before the file's final `});` (the one closing `describe('HomeScreen', ...)`, at the current end of the file):

```ts
  describe('Duo sidebar mode (regular-width scene, native right-edge sidebar)', () => {
    // The primary panel's measured live geometry — see the duo-adaptive
    // design doc's "Context" section.
    const DUO_TAB_BAR_HEIGHT = 678;
    const DUO_WINDOW_FRAME = { width: 466, height: 678, scale: 3, fontScale: 1 };
    const DUO_INSETS = { top: 0, right: 84, bottom: MOCK_BOTTOM_INSET, left: 0 };
    const NORMAL_IPHONE_WINDOW_FRAME = { width: 393, height: 852, scale: 3, fontScale: 1 };

    afterEach(() => {
      mockUseBottomTabBarHeight.mockReturnValue(MOCK_TAB_BAR_HEIGHT);
      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        right: 0,
        bottom: MOCK_BOTTOM_INSET,
        left: 0,
      });
      Dimensions.set({ window: NORMAL_IPHONE_WINDOW_FRAME, screen: NORMAL_IPHONE_WINDOW_FRAME });
    });

    it('ignores the poisoned tab-bar height, drops the list clearance to 0, and anchors the FAB clear of the right sidebar inset — the exact measured Duo primary-panel geometry', async () => {
      mockUseBottomTabBarHeight.mockReturnValue(DUO_TAB_BAR_HEIGHT);
      mockUseSafeAreaInsets.mockReturnValue(DUO_INSETS);
      Dimensions.set({ window: DUO_WINDOW_FRAME, screen: DUO_WINDOW_FRAME });

      const { getByTestId, getByLabelText } = await renderHome();

      const listPadding = getByTestId('home-transactions').props.contentContainerStyle
        .paddingBottom;

      // Not 678 - 34 = 644 (the bug) — sidebar mode distrusts the tab-bar
      // height entirely.
      expect(listPadding).toBe(0);

      const fab = getByLabelText('Add transaction');
      const flattened = StyleSheet.flatten(fab.props.style);

      // The usual spacing(4) = 16 gap, PLUS the 84pt sidebar inset.
      expect(flattened.right).toBe(16 + 84);
    });

    it('keeps the ordinary bottom-tab-bar clearance and FAB anchor unchanged when the tab bar is NOT a sidebar', async () => {
      mockUseBottomTabBarHeight.mockReturnValue(MOCK_TAB_BAR_HEIGHT);
      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        right: 0,
        bottom: MOCK_BOTTOM_INSET,
        left: 0,
      });
      Dimensions.set({ window: NORMAL_IPHONE_WINDOW_FRAME, screen: NORMAL_IPHONE_WINDOW_FRAME });

      const { getByTestId, getByLabelText } = await renderHome();

      const listPadding = getByTestId('home-transactions').props.contentContainerStyle
        .paddingBottom;
      expect(listPadding).toBe(MOCK_TAB_BAR_HEIGHT - MOCK_BOTTOM_INSET);

      const fab = getByLabelText('Add transaction');
      const flattened = StyleSheet.flatten(fab.props.style);
      expect(flattened.right).toBe(16);
    });
  });
```

- [ ] **Step 7: Run test to verify it passes**

Steps 3–5 already landed the FAB's `rightOffset` prop and Home's wiring earlier in this task, so this test should go straight to PASS once added — there is no separate RED run for it in this task (Steps 1–2 already exercised the RED state for the FAB-level prop itself; this Home-level test is the end-to-end confirmation that the wiring composes correctly).

Run: `npx jest src/screens/home/home.screen.test.tsx`
Expected: PASS — all tests in the file (the pre-existing ~35 plus the 2 new ones in the "Duo sidebar mode" block).

- [ ] **Step 8: Full check and gate**

Run: `npx jest src/screens/home`
Expected: PASS, every file.

Run: `make gate`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/screens/home/add-transaction-fab/add-transaction-fab.props.d.ts src/screens/home/add-transaction-fab/add-transaction-fab.styles.ts src/screens/home/add-transaction-fab/add-transaction-fab.component.tsx src/screens/home/add-transaction-fab/add-transaction-fab.component.test.tsx src/screens/home/home.screen.tsx src/screens/home/home.screen.test.tsx
git commit -m "fix(home): anchor AddTransactionFab clear of the right sidebar inset"
```

---

### Task 5: Header-height robustness (form field auto-scroll, not the footer)

**Files:**
- Modify: `src/screens/forms/scroll-to-field/scroll-to-field.ts`
- Modify: `src/screens/forms/scroll-to-field/scroll-to-field.test.ts`

**Interfaces:**
- Consumes: `isSidebarTabBarMode` (Task 1).
- Produces: `resolveHeaderInset(reportedHeight: number, isSidebarMode: boolean): number`, a new exported pure function; `useHeaderInset()`'s existing return type/contract is unchanged (still `number`), only its internal computation changes.

**Grounding (read before touching this task):** grepping the tree confirms no current footer/bottom-clearance code (`bottom-clearance.ts`, `Screen`, the FAB) reads `HeaderHeightContext` at all — the design doc's "header height reports 0 on the active stack" observation is documented there as **a second, separate symptom of the same scene anomaly**, not the cause of any of the 3 reported bugs (all 3 are fully explained and fixed by Tasks 2–4). The two real consumers of `HeaderHeightContext` in this codebase are `useHeaderInset()` (`scroll-to-field.ts`, used only by the 4 form screens' Save-press "scroll to the first invalid field" logic) and `useScrollToTopOnTabPress` (the active-tab-retap scroll-to-top hook). Only `useHeaderInset()` gets a fix here — every one of ITS real (non-test) call sites is a form screen pushed under a genuine native-stack header, so a `0` report there in sidebar mode is ALWAYS the bug, never a legitimate "no header" case, and flooring it is safe. `useScrollToTopOnTabPress` is different: Home is a genuine caller with NO header (`headerHeight` legitimately `0`, documented in that file's own comment), so the SAME context value `0` is ambiguous there between "no header" and "misreporting" — flooring it would wrongly inflate Home's own already-correct `0` target. That hook is therefore left unchanged in this task, with a regression test instead (Step 6) proving its existing `?? 0` degrade path stays safe (no crash, no overshoot) under the Duo's exact reported values.

- [ ] **Step 1: Write the failing test**

Edit `src/screens/forms/scroll-to-field/scroll-to-field.test.ts`. `jest.mock(...)` factories must sit at module scope (Jest/Babel hoists them above the file's own `import` statements) — a call inside an `it` body would be too late, since this file's top-level `import { useHeaderInset, ... } from './scroll-to-field'` has already resolved `scroll-to-field.ts`'s own imports of `react-native-safe-area-context` by the time any test runs. So the new mock is a **module-scope, mutable** `jest.fn()` wrapper (the same pattern Tasks 2–4 already use), added right after the existing imports and before `headerHeightWrapper`:

```ts
import { Keyboard } from 'react-native';
import { createElement, type ReactNode } from 'react';
import type { ScrollViewInstance } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { HeaderHeightContext } from '@react-navigation/elements';

import {
  useHeaderInset,
  resolveHeaderInset,
  resolveFieldScrollTarget,
  scrollToField,
  type FieldInstance,
} from './scroll-to-field';

// A mutable `jest.fn()` wrapper so the dedicated sidebar-mode cases below can
// override the reported insets per test and restore them afterwards. Every
// OTHER test in this file (and every real caller of `useHeaderInset` — the 4
// form screens, none of which mock this module at all) keeps this exact
// zero-inset default, which resolves `isSidebarMode` to `false` and leaves
// `useHeaderInset` an exact passthrough of `HeaderHeightContext` — no
// existing behavior changes. `useBottomTabBarHeight` needs no local mock
// here: the global manual mock (`__mocks__/react-native-bottom-tabs.tsx`)
// already returns `0`, and a nonzero horizontal inset alone is sufficient to
// flip `isSidebarTabBarMode` (see its own "Design decision" — either signal
// alone is sufficient), so this file never needs to touch the tab-bar-height
// or window-dimensions signals at all.
const mockUseSafeAreaInsets = jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockUseSafeAreaInsets(),
}));

// Plain `createElement` (not JSX) — this module stays a `.ts` file, so JSX
// syntax is not parsed here.
const headerHeightWrapper =
  (value: number) =>
  ({ children }: { children: ReactNode }) =>
    createElement(HeaderHeightContext.Provider, { value }, children);
```

Add these new tests inside the existing `describe('useHeaderInset', ...)` block, after the existing two `it`s — each restores the mock's default in its own body so the three tests stay independent (no shared `afterEach` needed for just three cases):

```ts
  it('floors an implausible zero header height to the known backgrounded-stack value, ONLY in sidebar mode (a nonzero right safe-area inset)', async () => {
    mockUseSafeAreaInsets.mockReturnValueOnce({ top: 0, right: 84, bottom: 34, left: 0 });

    const { result } = await renderHook(() => useHeaderInset(), {
      wrapper: headerHeightWrapper(0),
    });

    expect(result.current).toBe(82);
  });

  it('does NOT floor a genuinely absent header context, even in sidebar mode (Home has no header at all)', async () => {
    mockUseSafeAreaInsets.mockReturnValueOnce({ top: 0, right: 84, bottom: 34, left: 0 });

    const { result } = await renderHook(() => useHeaderInset());

    expect(result.current).toBe(0);
  });

  it('never floors an already-nonzero reported height, in or out of sidebar mode', async () => {
    mockUseSafeAreaInsets.mockReturnValueOnce({ top: 0, right: 84, bottom: 34, left: 0 });

    const { result } = await renderHook(() => useHeaderInset(), {
      wrapper: headerHeightWrapper(140),
    });

    expect(result.current).toBe(140);
  });
```

(`mockReturnValueOnce` self-restores after each call — no `afterEach` needed here, unlike Tasks 2–4's `mockReturnValue`-based overrides, which persist across renders within one test.)

And add a standalone `describe('resolveHeaderInset', ...)` block for the pure function directly, after the `describe('useHeaderInset', ...)` block closes:

```ts
describe('resolveHeaderInset', () => {
  it('floors a reported 0 to the known backgrounded-stack value in sidebar mode', () => {
    expect(resolveHeaderInset(0, true)).toBe(82);
  });

  it('passes a reported 0 straight through outside sidebar mode (a genuine no-header screen, e.g. Home)', () => {
    expect(resolveHeaderInset(0, false)).toBe(0);
  });

  it('never floors an already-nonzero reported height', () => {
    expect(resolveHeaderInset(44, true)).toBe(44);
    expect(resolveHeaderInset(96, false)).toBe(96);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/scroll-to-field/scroll-to-field.test.ts`
Expected: FAIL — `resolveHeaderInset` is not exported yet (TS2305), and the first new `useHeaderInset` case asserts `82` against the current always-passthrough implementation (which returns `0`).

- [ ] **Step 3: Write minimal implementation**

Edit `src/screens/forms/scroll-to-field/scroll-to-field.ts`. Current imports (lines 1–4):

```ts
import { Keyboard } from 'react-native';
import type { ScrollViewInstance, View } from 'react-native';
import { HeaderHeightContext } from '@react-navigation/elements';
import { type ComponentRef, type RefObject, useContext } from 'react';
```

New:

```ts
import { Keyboard, useWindowDimensions } from 'react-native';
import type { ScrollViewInstance, View } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderHeightContext } from '@react-navigation/elements';
import { type ComponentRef, type RefObject, useContext } from 'react';

import { isSidebarTabBarMode } from '../../../design-system/components/screen';
```

Current `useHeaderInset` (lines 32–43):

```ts
// The live inset a scrolled-to field must clear at the top of the scroll
// viewport: React Navigation's own current header height, which ALREADY
// includes the safe-area top inset — do not add a screen's own
// `useSafeAreaInsets().top` on top of it, that would double-count it. Unlike
// the fixed `COMPACT_HEADER_HEIGHT` assumption this replaced, this tracks a
// COLLAPSING large-title header's true current height (see
// accounts.stack.tsx / home.stack.tsx's `headerLargeTitle: true`), so a
// near-top field no longer lands under a header band whose height was
// assumed smaller than the large title's real (still expanded, or partially
// so) height.
//
// Reads `HeaderHeightContext` directly rather than
// `@react-navigation/elements`'s own `useHeaderHeight()` wrapper, which
// THROWS when no header context is present. Every real caller
// (account-form, holding-form, transaction-form, contribution-form) renders
// under a real native-stack header, so the context is always there in the
// app — but each of those screens' own unit tests renders the bare screen
// component directly, with no navigator (and so no header) around it at all,
// and a throwing read would crash every one of those tests, not just a
// scroll-specific one. Degrading to `0` outside a header context mirrors the
// same choice `use-scroll-to-top-on-tab-press.ts` already makes for the same
// reason.
export const useHeaderInset = (): number => useContext(HeaderHeightContext) ?? 0;
```

New:

```ts
// The known `HeaderHeightContext` value React Navigation reports for a
// COLLAPSED large-title header on a BACKGROUNDED native-stack (measured live
// on the Duo primary panel — see the duo-adaptive design doc's "Context"
// section). Used ONLY as a floor for the FOCUSED stack's own implausible `0`
// report in sidebar mode below — a pragmatic Phase 1 value, not a live
// per-screen measurement; Phase 2 may replace it with something more
// precise if this proves insufficient on device.
const DUO_SIDEBAR_HEADER_INSET_FLOOR = 82;

// Every REAL (non-test) caller of `useHeaderInset` is a form screen pushed
// under a genuine native-stack header, so a reported `0` there is NEVER a
// legitimate "no header" case — unlike `HeaderHeightContext`'s OTHER
// consumer, `use-scroll-to-top-on-tab-press.ts`, whose Home caller
// legitimately has no header at all and must NOT be floored. On a
// regular-width scene the native tab bar renders as a right-edge sidebar
// (see `isSidebarTabBarMode`) and `HeaderHeightContext` has been observed
// reporting `0` on the FOCUSED stack (vs the correct ~82 on a backgrounded
// one) — the same scene-geometry anomaly `resolveBottomClearance` guards
// against. Gated behind `isSidebarMode` so an ordinary iPhone's own
// legitimate `0` (a bare unit-test render with no navigator at all) is never
// touched.
export const resolveHeaderInset = (reportedHeight: number, isSidebarMode: boolean): number => {
  if (isSidebarMode && reportedHeight === 0) {
    return DUO_SIDEBAR_HEADER_INSET_FLOOR;
  }

  return reportedHeight;
};

// The live inset a scrolled-to field must clear at the top of the scroll
// viewport: React Navigation's own current header height, which ALREADY
// includes the safe-area top inset — do not add a screen's own
// `useSafeAreaInsets().top` on top of it, that would double-count it. Unlike
// the fixed `COMPACT_HEADER_HEIGHT` assumption this replaced, this tracks a
// COLLAPSING large-title header's true current height (see
// accounts.stack.tsx / home.stack.tsx's `headerLargeTitle: true`), so a
// near-top field no longer lands under a header band whose height was
// assumed smaller than the large title's real (still expanded, or partially
// so) height.
//
// Reads `HeaderHeightContext` directly rather than
// `@react-navigation/elements`'s own `useHeaderHeight()` wrapper, which
// THROWS when no header context is present. Every real caller
// (account-form, holding-form, transaction-form, contribution-form) renders
// under a real native-stack header, so the context is always there in the
// app — but each of those screens' own unit tests renders the bare screen
// component directly, with no navigator (and so no header) around it at all,
// and a throwing read would crash every one of those tests, not just a
// scroll-specific one. Degrading to `0` outside a header context mirrors the
// same choice `use-scroll-to-top-on-tab-press.ts` already makes for the same
// reason; `resolveHeaderInset` then floors that (or a genuine but
// implausible `0`) ONLY in sidebar mode.
export const useHeaderInset = (): number => {
  const reportedHeight = useContext(HeaderHeightContext) ?? 0;
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const windowHeight = useWindowDimensions().height;
  const isSidebarMode = isSidebarTabBarMode(tabBarHeight, windowHeight, insets.left, insets.right);

  return resolveHeaderInset(reportedHeight, isSidebarMode);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/scroll-to-field/scroll-to-field.test.ts`
Expected: PASS — every pre-existing test (the "degrades to 0 outside a header context" test still resolves `0`: `mockUseSafeAreaInsets` keeps returning its zero-inset default there, so `isSidebarMode` is `false`) plus the 6 new ones.

- [ ] **Step 5: Full-file and gate check**

Run: `npx jest src/screens/forms/scroll-to-field src/screens/forms/account-form src/screens/forms/holding-form src/screens/forms/transaction-form src/screens/forms/contribution-form`
Expected: PASS, every file — the 4 form screens all consume `useHeaderInset()` and must be unaffected (they don't mock bottom-tabs/safe-area-context/Dimensions, so `isSidebarMode` resolves `false` and every field-scroll assertion is unchanged).

Run: `make gate`
Expected: PASS.

- [ ] **Step 6: Regression-lock `useScrollToTopOnTabPress`'s existing safe degrade (no production change)**

This step adds a characterization test only — `use-scroll-to-top-on-tab-press.ts` is intentionally left untouched (see this task's "Grounding" note above).

Edit `src/navigation/use-scroll-to-top-on-tab-press.test.tsx`. Add one new test to the existing `describe('useScrollToTopOnTabPress', ...)` block, matching the file's own established per-test shape (a local `scrollTo` spy, `setup(scrollRef, options)`, a synchronous `fireTabPress()`):

```ts
  it('degrades identically to the no-header case when a REAL header context reports the Duo sidebar-mode anomaly (0 on the focused stack)', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    // `headerHeight: 0` wraps a REAL `HeaderHeightContext.Provider` reporting
    // the literal value 0 — the Duo anomaly (a screen that DOES have a
    // header, misreporting 0) — not the `undefined` "no provider at all"
    // case the "targets y: 0 when there is no header context" test above
    // already covers. This hook has no sidebar-mode signal of its own (see
    // this task's "Grounding" note) and is not expected to gain one in
    // Phase 1 — Home's own legitimate 0 must stay untouched. This proves the
    // existing `?? 0` / max-latch path degrades a present-but-0 context
    // exactly the same way it already degrades an absent one: target stays
    // 0, never past it, never throws.
    const { fireTabPress } = await setup(scrollRef, { headerHeight: 0 });

    fireTabPress();

    expect(scrollTo).toHaveBeenCalledWith({ y: -0, animated: true });
  });
```

Run: `npx jest src/navigation/use-scroll-to-top-on-tab-press.test.tsx`
Expected: PASS — this is a pure characterization test against unchanged production code (`use-scroll-to-top-on-tab-press.ts` is not modified in this task), so it passes immediately once added.

- [ ] **Step 7: Commit**

```bash
git add src/screens/forms/scroll-to-field/scroll-to-field.ts src/screens/forms/scroll-to-field/scroll-to-field.test.ts src/navigation/use-scroll-to-top-on-tab-press.test.tsx
git commit -m "fix(forms): floor implausible zero header height in sidebar mode for field auto-scroll"
```

---

### Task 6: `make verify` and on-device/sim verification

**Files:** none (verification only — no code changes expected; if verification surfaces a real defect, open a follow-up task rather than patching silently here).

- [ ] **Step 1: Full harness gate**

Run: `make verify`
Expected: PASS (lint, full Jest suite, then `make gate`). This is the plan's required, blocking check — do not consider Phase 1 done until this is green.

- [ ] **Step 2: Build and install on the Duo simulator**

```bash
xcrun simctl boot E862974E-9919-42E2-B689-79502A171D93 2>/dev/null || true
npx react-native run-ios --udid E862974E-9919-42E2-B689-79502A171D93
```

If a Release/embedded-bundle build is needed instead of a Metro-attached Debug build, follow the existing simulator build recipe this repo already uses for other simulator verification (clean `ios/build`, `pod install`, `FORCE_BUNDLING=1`) — read `docs/harness/` and this repo's own build scripts before improvising a new one. Do **not** set any `SCREENSHOT_MODE`/screenshot-subsystem env var — none should exist in this branch (Global Constraints).

- [ ] **Step 3: Capture and inspect screenshots on the Duo sim**

```bash
xcrun simctl io E862974E-9919-42E2-B689-79502A171D93 screenshot /tmp/duo-home.png
# Navigate to Settings and Accounts in the running sim, then:
xcrun simctl io E862974E-9919-42E2-B689-79502A171D93 screenshot /tmp/duo-settings.png
xcrun simctl io E862974E-9919-42E2-B689-79502A171D93 screenshot /tmp/duo-accounts.png
```

Read each PNG (the `Read` tool renders images). Confirm, against the primary-panel/right-edge-sidebar layout:

- **Home:** the AddTransactionFab circle is fully visible, clear of the native sidebar chrome (not painted over, not clipped).
- **Settings:** every settings card is visible below the title (not hidden behind an oversized footer).
- **Accounts:** the "Add account" button sits pinned at the true bottom edge, not overlapping the large-title header band.

If any of the three still shows the reported defect, treat this as a real finding — stop, do not patch ad hoc; open a debugger/developer follow-up task citing the specific screenshot and geometry, rather than silently reworking this plan's already-committed tasks.

- [ ] **Step 4: Normal-iPhone regression check**

```bash
xcrun simctl list devicetypes | grep -i "iPhone 17\|iPhone 16"
```

Boot an ordinary (non-Duo, non-Plus/Max-landscape) iPhone simulator, install the same build, and capture Home/Settings/Accounts screenshots the same way. Confirm every screen is pixel-identical in layout to the pre-Phase-1 baseline — the FAB at its usual bottom-right position, footers at their usual height, no new horizontal padding. This is the manual counterpart to the automated regression tests already in Tasks 2–5 (all of which pin the `isSidebarMode = false` case byte-for-byte); this step exists to confirm nothing about the REAL device rendering pipeline (Yoga layout, the real `SafeAreaView` native shadow node) diverges from what the Jest mocks predicted.

- [ ] **Step 5: Report**

Summarize, in the session's final report: `make verify` result, the 3 Duo screenshots' pass/fail per screen, and the normal-iPhone regression result. Do not mark Phase 1 done if any check above failed.

---

## Self-review notes (for the plan author, not a task to execute)

- **Spec coverage:** all 5 Phase 1 design-doc bullets map onto a task — (1) robust clearance → Task 2, (2) one sidebar-detection helper → Task 1, (3) FAB position → Task 4, (4) zero header height → Task 5, (5) horizontal insets → Task 3. The open sidebar-signal question is settled above with an explicit rule, threshold, and justification. Testing requirements (exact measured case, normal-iPhone regression) are satisfied end-to-end in Task 4's Home-level test and per-unit in Tasks 1, 2, 3, 5. Phase 2 (adaptive layout, `ipad-adaptive` re-application) is explicitly out of scope and not planned here.
- **No placeholders:** every step above has real, complete code — no "TBD"/"add error handling"/"similar to Task N" placeholders.
- **Type consistency:** `resolveBottomClearance(tabBarHeight, insetBottom, isSidebarMode)`, `isSidebarTabBarMode(tabBarHeight, windowHeight, insetLeft, insetRight)`, `resolveHeaderInset(reportedHeight, isSidebarMode)`, and `AddTransactionFabProps.rightOffset?: number` are used with the identical signature everywhere they appear across Tasks 1–5.
