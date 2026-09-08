# Light-Scheme + Charts Review Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the 13 user review-round items for the light color scheme, charts, and native appearance chrome on branch `drizzer14/light-scheme-charts`, without weakening any harness check.

**Architecture:** Five ordered phases. Phase 1 rebuilds the appearance-selection UI into two switches and makes native chrome follow the scheme. Phase 2 lands the design-system foundation tokens (`onAccent`) and the light palette/entity-tint calibration that Phase 3's component fixes consume. Phase 3 fixes three light-scheme component defects. Phase 4 fixes the statistics Reset target and adds the net-worth area gradient. Phase 5 fixes the native app-icon asset catalog.

**Tech Stack:** React Native 0.87, react-native-unistyles v3 (two themes: `dark`/`light`), ts-pattern, react-native-svg (manual Jest mock), react-native-calendars, Jest + React Native Testing Library, Swift (AppDelegate), Xcode asset catalog.

**Spec:** This plan is the spec of record for the round. It builds on the token architecture in `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`, the trend button-state truth table in `docs/superpowers/plans/2026-09-07-trend-daily-and-saved-categories.md`, and the design authority in `.claude/skills/kiko-design-system`, `.claude/skills/kiko-charts`, `.claude/skills/kiko-code-style`, `.claude/skills/kiko-architecture`, plus `src/design-system/theme.ts`, `palette.ts`, `entity-tint.ts`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Never weaken a harness check.** No `|| true`, no bare `biome-ignore` (use `OVERRIDE(reason)`), no new ignore-list entry without a concrete justification. Fix the underlying issue.
- **Every DB write goes through `db.transaction`** — i.e. `write((tx) => …)` in `src/db/client.ts`; repositories only. No direct `database.update` from a screen.
- **i18n parity:** `src/i18n/locales/en.ts` and `uk.ts` must have IDENTICAL leaf keys — `src/i18n/locales/en.uk.parity.test.ts` enforces it. Any new string is added to BOTH; any removed string is removed from BOTH.
- **Button casing:** English `Button` copy is sentence case; `src/i18n/locales/en.button-casing.test.ts` enforces it. UI headings/section titles are Title Case (kiko-design-system "JSX layout conventions").
- **Design tokens only:** no inline hex, spacing, or radius literal in a component — read `theme.colors.*`, `theme.spacing(n)`, `theme.radii.*`. Prefer a design-system layout prop (`<Box direction="row">`) over an inline style.
- **Keep `colorScheme` threading intact:** every entity/category/chart color resolves through `resolveEntityColor` / `resolveCategoryColor` / `entityCardBackground` with the active `resolveColorScheme(rt.themeName)` argument. Never hand-roll `stored ?? default` or a scheme-blind palette read.
- **Palettes only ever GROW paired 1:1 by key** (`palette.ts`) — never remove/rename a swatch key, never leave dark/light unpaired.
- **SF Symbol availability floor is iOS 26.6.1** — verify any new symbol's `minimumOS` in `name_availability.plist` before use (`.claude/skills` / `sf-symbols-ios27-availability` memory). No new symbol is introduced by this plan; if one is, verify it.
- **Run `npm run check:all` at the end of every task** (lint, dup, knip, deps, security, rules, plist, secrets, overrides, typecheck) and **`npm run check:deep` once after the final task**. Run verbose commands through an Orca terminal per `harness/kiko/skills/harness-workflow/SKILL.md`, not the foreground shell.
- **Do NOT deploy to device.** The coordinator owns the redeploy + on-device review step. Native tasks (Phase 1 Task 4, Phase 5 Task 15) stop at a successful build check.

### Cross-task file collisions (sequence, do not parallelize these)

- `src/design-system/theme.ts` — Task 5 (`onAccent`) then Task 6 (light palette). Both in Phase 2; land Task 5 first.
- `src/screens/settings/system.screen.tsx` — Task 1 only.
- `src/screens/statistics/statistics.screen.tsx` + `statistics.screen.test.tsx` — Task 13 only.
- `src/design-system/components/net-worth-line/**` — Task 14 only.
- `src/design-system/entity-tint.ts` — Task 7 only.
- `src/design-system/components/button/**` + `switch/**` — Task 5 only.

---

## File Structure

**Phase 1 (appearance mechanism):**
- Create `src/design-system/components/appearance-toggles/appearance-toggles.component.tsx` + `.props.d.ts` + `appearance-toggles.mapping.ts` + `appearance-toggles.mapping.test.ts` + `appearance-toggles.component.test.tsx` + `index.ts` — the two-switch replacement for `AppearanceSwitch`.
- Delete `src/design-system/components/appearance-switch/**` — the 3-chip switcher, its only consumer is `system.screen.tsx`.
- Modify `src/screens/settings/system.screen.tsx` — mount the new toggles.
- Modify `src/i18n/locales/en.ts` + `uk.ts` — replace the `appearance` string block.
- Modify `ios/Kiko/AppDelegate.swift` — scheme-aware privacy overlay.

**Phase 2 (tokens):**
- Modify `src/design-system/theme.ts` — add `onAccent`; audit light `colors`.
- Modify `src/design-system/components/button/button.component.tsx` + `button.styles.ts` + `button.component.test.tsx` — variant-aware label color.
- Modify `src/design-system/components/switch/switch.component.tsx` (+ create `switch.component.test.tsx`) — thumb through `onAccent`.
- Modify `src/design-system/entity-tint.ts` + `entity-tint.test.ts` — light card-background calibration.

**Phase 3 (components):**
- Modify `src/screens/settings/add-category-row/add-category-row.component.tsx` (+ its test) — default color seed + enabled-looking label.
- Modify `src/screens/calendar/kiko-calendar/kiko-calendar.component.tsx` (+ its test) — `textDisabledColor`.

**Phase 4 (charts + statistics):**
- Modify `src/screens/statistics/statistics.screen.tsx` + `statistics.screen.test.tsx` — Reset target.
- Modify `src/design-system/components/net-worth-line/net-worth-line.component.tsx` + `.test.tsx` — area gradient.
- (Task 12 is a documentation stub only — no code.)

**Phase 5 (native asset):**
- Modify `ios/Kiko/Images.xcassets/AppIcon.appiconset/Contents.json`.

---

## PHASE 1 — Appearance mechanism (foundation)

### Task 1: Two-switch appearance control (item 2)

Replace the 3-chip `AppearanceSwitch` on the System page with two switches: **Follow system setting** and **Dark mode**. Maps to the existing `settings.appearance` union `'system' | 'light' | 'dark'` (`'system'` = Follow ON; `'light'`/`'dark'` = Follow OFF). While Follow is ON, the Dark switch is disabled and REFLECTS the live OS-resolved scheme.

**Files:**
- Create: `src/design-system/components/appearance-toggles/appearance-toggles.mapping.ts`
- Create: `src/design-system/components/appearance-toggles/appearance-toggles.mapping.test.ts`
- Create: `src/design-system/components/appearance-toggles/appearance-toggles.props.d.ts`
- Create: `src/design-system/components/appearance-toggles/appearance-toggles.component.tsx`
- Create: `src/design-system/components/appearance-toggles/appearance-toggles.component.test.tsx`
- Create: `src/design-system/components/appearance-toggles/index.ts`
- Delete: `src/design-system/components/appearance-switch/` (whole folder: `.component.tsx`, `.props.d.ts`, `index.ts`, and any test)
- Modify: `src/screens/settings/system.screen.tsx:8` (import) and `:62-70` (card body)
- Modify: `src/i18n/locales/en.ts:62-66` and `src/i18n/locales/uk.ts:54-58`

**Interfaces:**
- Consumes: `Appearance` and `appearances` from `src/appearance/appearance.ts`; `resolveColorScheme` from `src/design-system/color-scheme.ts`; the shared `Switch` from `src/design-system/components/switch`; `useUnistyles` (`rt.themeName`).
- Produces: `appearanceFromToggles(followSystem: boolean, darkOn: boolean): Appearance`; `togglesFromAppearance(appearance: Appearance, resolvedScheme: 'light' | 'dark'): { followSystem: boolean; darkOn: boolean }`; a default-export `AppearanceToggles` FC with props `{ appearance: Appearance; onChange: (next: Appearance) => void }`.

- [ ] **Step 1: Write the failing mapping test**

`appearance-toggles.mapping.test.ts`:

```ts
import { appearanceFromToggles, togglesFromAppearance } from './appearance-toggles.mapping';

describe('appearanceFromToggles', () => {
  it('follow ON maps to system regardless of dark flag', () => {
    expect(appearanceFromToggles(true, false)).toBe('system');
    expect(appearanceFromToggles(true, true)).toBe('system');
  });

  it('follow OFF maps to dark/light by the dark flag', () => {
    expect(appearanceFromToggles(false, true)).toBe('dark');
    expect(appearanceFromToggles(false, false)).toBe('light');
  });
});

describe('togglesFromAppearance', () => {
  it('system reflects the resolved OS scheme in the dark flag, follow ON', () => {
    expect(togglesFromAppearance('system', 'dark')).toEqual({ followSystem: true, darkOn: true });
    expect(togglesFromAppearance('system', 'light')).toEqual({ followSystem: true, darkOn: false });
  });

  it('pinned light/dark ignores the resolved scheme, follow OFF', () => {
    expect(togglesFromAppearance('dark', 'light')).toEqual({ followSystem: false, darkOn: true });
    expect(togglesFromAppearance('light', 'dark')).toEqual({ followSystem: false, darkOn: false });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/design-system/components/appearance-toggles/appearance-toggles.mapping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapping**

`appearance-toggles.mapping.ts`:

```ts
import type { Appearance } from '../../../appearance/appearance';

// Follow ON always persists 'system' (the OS drives the scheme); Follow OFF
// pins the concrete scheme from the Dark switch.
export const appearanceFromToggles = (followSystem: boolean, darkOn: boolean): Appearance =>
  followSystem ? 'system' : darkOn ? 'dark' : 'light';

// Derive the two switch positions for the current setting. While following the
// system, the Dark switch is a read-only REFLECTION of the live OS-resolved
// scheme (resolvedScheme); when pinned, it reflects the pinned choice itself.
export const togglesFromAppearance = (
  appearance: Appearance,
  resolvedScheme: 'light' | 'dark',
): { followSystem: boolean; darkOn: boolean } => {
  if (appearance === 'system') {
    return { followSystem: true, darkOn: resolvedScheme === 'dark' };
  }

  return { followSystem: false, darkOn: appearance === 'dark' };
};
```

Note: the nested ternary in `appearanceFromToggles` is a two-branch boolean predicate, which kiko-design-system permits over `match`; if Biome flags nesting, split into a small `if`.

- [ ] **Step 4: Run the mapping test, verify it passes**

Run: `npx jest src/design-system/components/appearance-toggles/appearance-toggles.mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Add i18n strings (both locales)**

In `en.ts`, replace the `appearance` block:

```ts
  appearance: {
    followSystem: 'Follow system setting',
    darkMode: 'Dark mode',
  },
```

In `uk.ts`:

```ts
  appearance: {
    followSystem: 'Слідувати системним налаштуванням',
    darkMode: 'Темний режим',
  },
```

Grep first to confirm nothing else references the removed leaf keys:
Run: `rtk grep -rn "appearance.system\|appearance.light\|appearance.dark" src/` — expect only the soon-deleted `appearance-switch` and its test.

- [ ] **Step 6: Write the props file**

`appearance-toggles.props.d.ts`:

```ts
import type { Appearance } from '../../../appearance/appearance';

export type AppearanceTogglesProps = {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
};
```

- [ ] **Step 7: Write the failing component test**

`appearance-toggles.component.test.tsx` (RNTL; the app's Unistyles Jest mock resolves `rt.themeName` to `'dark'` by default — `src/design-system/unistyles.ts` registers dark first):

```tsx
import { fireEvent, render } from '@testing-library/react-native';

import AppearanceToggles from './appearance-toggles.component';

describe('AppearanceToggles', () => {
  it('follow ON disables the dark switch and reflects the resolved scheme', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<AppearanceToggles appearance="system" onChange={onChange} />);

    const dark = getByTestId('appearance-toggle-dark');
    expect(dark.props.accessibilityState.disabled).toBe(true);
    // Jest mock resolves themeName to 'dark' -> reflected ON.
    expect(dark.props.value).toBe(true);
  });

  it('turning Follow OFF pins the currently reflected scheme', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<AppearanceToggles appearance="system" onChange={onChange} />);

    fireEvent(getByTestId('appearance-toggle-follow'), 'valueChange', false);
    // Reflected scheme was dark -> pin 'dark'.
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('pinned dark enables the dark switch; toggling it OFF pins light', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<AppearanceToggles appearance="dark" onChange={onChange} />);

    const dark = getByTestId('appearance-toggle-dark');
    expect(dark.props.accessibilityState.disabled).toBe(false);
    fireEvent(dark, 'valueChange', false);
    expect(onChange).toHaveBeenCalledWith('light');
  });
});
```

- [ ] **Step 8: Run it, verify it fails**

Run: `npx jest src/design-system/components/appearance-toggles/appearance-toggles.component.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 9: Implement the component**

`appearance-toggles.component.tsx` — two `Switch` rows (labeled). The Dark switch is `disabled` while Follow ON, and its `value` reflects the live resolved scheme via `resolveColorScheme(rt.themeName)`. Pass a `testID` to each `Switch` (thread a `testID` prop through `Switch` if it does not already accept one — check `switch.props.d.ts`; if absent, add `testID?: string` to `SwitchProps` and forward it to the RN `Switch`, keeping the token-driven props after the spread per kiko-design-system "Wrapping a React Native primitive").

```tsx
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';

import { resolveColorScheme } from '../../color-scheme';
import Box from '../box';
import Switch from '../switch';

import { appearanceFromToggles, togglesFromAppearance } from './appearance-toggles.mapping';
import type { AppearanceTogglesProps } from './appearance-toggles.props';

const AppearanceToggles: FC<AppearanceTogglesProps> = ({ appearance, onChange }) => {
  const { t } = useTranslation();
  const { rt } = useUnistyles();
  const resolvedScheme = resolveColorScheme(rt.themeName);
  const { followSystem, darkOn } = togglesFromAppearance(appearance, resolvedScheme);

  return (
    <Box gap={3}>
      <Switch
        testID="appearance-toggle-follow"
        label={t('appearance.followSystem')}
        value={followSystem}
        onValueChange={(next) => onChange(appearanceFromToggles(next, darkOn))}
      />

      <Switch
        testID="appearance-toggle-dark"
        label={t('appearance.darkMode')}
        value={darkOn}
        disabled={followSystem}
        onValueChange={(next) => onChange(appearanceFromToggles(followSystem, next))}
      />
    </Box>
  );
};

export default AppearanceToggles;
```

`index.ts`: `export { default } from './appearance-toggles.component';`

- [ ] **Step 10: Run the component test, verify it passes**

Run: `npx jest src/design-system/components/appearance-toggles`
Expected: PASS.

- [ ] **Step 11: Wire into `system.screen.tsx` and delete the old switch**

In `system.screen.tsx`: replace the import `AppearanceSwitch` (line 8) with `AppearanceToggles from '../../design-system/components/appearance-toggles'`, and replace the `SettingsRow`+`AppearanceSwitch` body (lines 63-69) — the toggles carry their own labels, so render `AppearanceToggles` inside the `GlassSurface` (keep the `settings-card-color-scheme` testID and the `settings.colorScheme` heading via a `SettingsRow` label with no child, or move the toggles below a heading `Text`). Keep `handleSelectAppearance` as `onChange`. Then delete `src/design-system/components/appearance-switch/`.

Verify no dangling import: `rtk grep -rn "appearance-switch" src/` — expect zero. Knip flags the deleted folder's exports if any import survives.

- [ ] **Step 12: Run the checks**

Run: `npm run check:all` (through an Orca terminal). Expect green: parity test, button-casing test, knip (no orphaned `appearance-switch`), typecheck.

- [ ] **Step 13: Commit**

```bash
git add src/design-system/components/appearance-toggles src/screens/settings/system.screen.tsx src/i18n/locales/en.ts src/i18n/locales/uk.ts
git rm -r src/design-system/components/appearance-switch
git commit -m "feat(settings): two-switch appearance control (Follow system + Dark mode)"
```

---

### Task 2: Verify live scheme re-render (item 3)

Confirm that flipping the appearance re-renders ALL app colors live with no restart, and fix any non-reactive color read. This is a VERIFICATION + targeted-fix task; do NOT manufacture work — if the audit finds nothing, the deliverable is the recorded audit plus green checks.

**Files:**
- Read-only audit across `src/` (no guaranteed edit).
- If a gap is found: modify the offending file + add a focused test.

**Interfaces:**
- Consumes: nothing new. The live path is `applyAppearance` (`src/appearance/appearance.ts`) → `UnistylesRuntime.setTheme`/`setAdaptiveThemes` + `RNAppearance.setColorScheme`, driven from `useSyncAppearanceWithSettings` when Task 1's toggles write `settings.appearance`.

- [ ] **Step 1: Audit for non-reactive color reads**

Run each and reason about the results:
- `rtk grep -rn "darkTheme\|lightTheme" src/ --include=*.tsx` — a component importing a theme object directly (bypassing `useUnistyles`) would not re-render on switch. Expect: none outside `theme.ts`/`unistyles.ts`.
- `rtk grep -rn "resolveColorScheme(rt.themeName)" src/` — every consumer reads `rt.themeName` INSIDE render via `useUnistyles()`, so it recomputes on theme change. Confirm none cache it in a module scope or a `useMemo` with an empty dep array.
- `rtk grep -rn "StyleSheet.create" src/ --include=*.styles.ts | wc -l` vs any raw `const x = darkTheme.colors` — Unistyles `StyleSheet.create((theme) => …)` is inherently reactive; a raw literal is not.

- [ ] **Step 2: Confirm native chrome is handled elsewhere**

The native tab bar / stack headers / date picker follow the scheme via `RNAppearance.setColorScheme` inside `applyAppearance` (already present). The privacy overlay is the ONE native surface not yet reactive — that is Task 4, not this task. Record this in the audit note.

- [ ] **Step 3: Fix any real gap found**

If (and only if) the audit finds a component reading a theme object directly or caching `colorScheme`, refactor it to read through `useUnistyles()` in render, and add a small RNTL test asserting the color-bearing prop is present (a full live-switch test is brittle under the Unistyles Jest mock — prefer asserting the read path, not a runtime theme flip).

- [ ] **Step 4: Run the checks**

Run: `npm run check:all`. Expect green. Deliverable: the recorded audit findings (in the commit message or a short note) + any fix.

- [ ] **Step 5: Commit**

```bash
git commit -am "chore(appearance): verify live scheme re-render; <fix or 'no gap found'>"
```

---

### Task 3: (folded into Task 4) — no separate task

Item 10 is the only native appearance item; it is Task 4.

---

### Task 4: Native privacy overlay follows the active scheme (item 10)

The app-switcher/backgrounding privacy cover (`showPrivacyOverlay()` in `AppDelegate.swift`) is hardcoded `.black` + `.systemChromeMaterialDark`, so it stays dark on the light scheme. Make it follow the active scheme. NATIVE task (developer authors Swift; ops runs the build check). No device deploy — the coordinator owns redeploy.

**Files:**
- Modify: `ios/Kiko/AppDelegate.swift:72-86` (`showPrivacyOverlay()`)

**Interfaces:**
- Consumes: `window.traitCollection.userInterfaceStyle` (only valid if RN sets `window.overrideUserInterfaceStyle`; see Step 1).

- [ ] **Step 1: Verify how native reads the scheme (WRITE DOWN THE RESULT)**

React Native 0.87's `Appearance.setColorScheme('light' | 'dark' | 'auto')` (called from `applyAppearance`) is the app-level override. Verify whether it sets `keyWindow.overrideUserInterfaceStyle` (making `window.traitCollection.userInterfaceStyle` authoritative for the PINNED scheme, not just the OS one). Check RN 0.87 source: `React/Base/RCTAppearance.mm` / `RCTOverrideAppearance` and whether it walks windows setting `overrideUserInterfaceStyle`. Use Context7 (`/facebook/react-native`) or read the Pod source under `ios/Pods/`.
  - **If YES** (override is set on the window): proceed with Step 2 reading `window.traitCollection` — it reflects the user's pinned choice AND the OS choice under `'auto'`.
  - **If NO** (override not set): the trait follows the OS only, so a user who pinned `light` while the OS is dark would get a dark overlay. Fallback plan: read the persisted appearance. Add a tiny native read of the same value RN persists, OR (preferred) set `window.overrideUserInterfaceStyle` ourselves inside a minimal bridge invoked from `applyAppearance`. State which path was taken in the commit message.

- [ ] **Step 2: Make the overlay adaptive (assuming Step 1 = YES)**

Replace the hardcoded base color and blur style with values resolved from the window's trait collection:

```swift
private func showPrivacyOverlay() {
  guard let window, window.viewWithTag(privacyOverlayTag) == nil else { return }
  let container = UIView(frame: window.bounds)
  container.tag = privacyOverlayTag
  container.isOpaque = true
  // Adaptive opaque base: resolves to the light/dark system background against
  // the window's active interface style (the pinned scheme when RN set the
  // window override, else the OS scheme). Replaces the hardcoded `.black`.
  container.backgroundColor = UIColor.systemBackground.resolvedColor(with: window.traitCollection)
  container.autoresizingMask = [.flexibleWidth, .flexibleHeight]

  // `.systemChromeMaterial` (no Light/Dark suffix) adapts to the effect view's
  // trait collection, replacing the hardcoded `.systemChromeMaterialDark`.
  let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
  blur.frame = container.bounds
  blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
  container.addSubview(blur)

  window.addSubview(container)
}
```

Update the doc comment above the function so it no longer claims a hardcoded true-black base / dark chrome.

- [ ] **Step 3: Build check (ops), no deploy**

Run a compile/build of the iOS target to confirm the Swift change builds (ops agent, per the `harness-workflow` run pattern). Do NOT run `deploy:device` — the coordinator owns on-device verification of the overlay in both schemes.

- [ ] **Step 4: Run the JS checks**

Run: `npm run check:all` (unchanged JS; confirms the plist/security invariants still pass — `check:plist` covers `Info.plist`).

- [ ] **Step 5: Commit**

```bash
git add ios/Kiko/AppDelegate.swift
git commit -m "fix(ios): privacy overlay follows the active color scheme"
```

---

## PHASE 2 — Light palette + entity colors (designer-owned tokens)

### Task 5: `onAccent` token + white-on-blue foregrounds (item 5)

Blue primary buttons and switch thumbs currently key their foreground off `theme.colors.textPrimary`, which is white on dark but BLACK on light. Add one token `onAccent` (white in BOTH themes) and route the primary/destructive Button label + icon and the Switch thumb through it — while keeping secondary/ghost labels on `textPrimary` (their backgrounds are `surfaceHigh`/transparent, which need an adapting foreground). **Land this before Phase 3.**

**Files:**
- Modify: `src/design-system/theme.ts:36-57` (dark colors) and `:64-81` (light colors)
- Modify: `src/design-system/components/button/button.component.tsx:29`, `:46`
- Modify: `src/design-system/components/button/button.styles.ts:59-68` (label `color`)
- Modify: `src/design-system/components/button/button.component.test.tsx`
- Modify: `src/design-system/components/switch/switch.component.tsx:24`
- Create: `src/design-system/components/switch/switch.component.test.tsx`

**Interfaces:**
- Produces: `theme.colors.onAccent: '#FFFFFF'` (both themes). A variant-aware `labelColor` in `Button`.

- [ ] **Step 1: Add the token to both themes**

In `theme.ts` `darkTheme.colors` and `lightTheme.colors`, add (after `accent`):

```ts
    // Foreground for anything sitting ON a filled accent/destructive surface —
    // a primary Button's label+icon, a Switch thumb on the accent track. White
    // in BOTH themes: `textPrimary` flips to black on light and would vanish on
    // a blue/red fill. This is the one always-white foreground token.
    onAccent: '#FFFFFF',
```

Both blocks are `as const`; keep the pairing 1:1.

- [ ] **Step 2: Write the failing Button test**

In `button.component.test.tsx`, add cases asserting the primary label + icon use `onAccent` (white) and a secondary label uses `textPrimary`. The `Button` renders `RNText` for the label and `SymbolIcon` (query by the icon's testID if present, else assert the label `RNText` `style.color`). Under the Jest mock the theme is dark, so `onAccent` and `textPrimary` are both white — to distinguish, assert against `theme.colors.onAccent` by importing it, and add a secondary-variant case where the label color equals `textPrimary` (also white on dark, so this test's DISCRIMINATING value is the code path, not the hex). Prefer asserting the resolved `color` equals `darkTheme.colors.onAccent` for primary and `darkTheme.colors.textPrimary` for secondary — identical on dark but proves the wiring, and the light theme (where they differ) is covered by the mapping being variant-keyed.

```tsx
import { darkTheme } from '../../theme';

it('primary label renders onAccent', () => {
  const { getByText } = render(<Button variant="primary">Save</Button>);
  const label = getByText('Save');
  const flat = Array.isArray(label.props.style)
    ? Object.assign({}, ...label.props.style.flat())
    : label.props.style;
  expect(flat.color).toBe(darkTheme.colors.onAccent);
});

it('secondary label renders textPrimary', () => {
  const { getByText } = render(<Button variant="secondary">Cancel</Button>);
  const label = getByText('Cancel');
  const flat = Array.isArray(label.props.style)
    ? Object.assign({}, ...label.props.style.flat())
    : label.props.style;
  expect(flat.color).toBe(darkTheme.colors.textPrimary);
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `npx jest src/design-system/components/button`
Expected: FAIL — label still hardcoded to `textPrimary` for all variants.

- [ ] **Step 4: Implement variant-aware label color**

In `button.component.tsx`, compute the color from the variant with `ts-pattern` (closed union → `match().exhaustive()` per kiko-code-style), keeping the `textColor` override:

```ts
import { match } from 'ts-pattern';
// ...
const variantLabelColor = match(variant)
  .with('primary', 'destructive', () => theme.colors.onAccent)
  .with('secondary', 'ghost', () => theme.colors.textPrimary)
  .exhaustive();
const labelColor = textColor ?? variantLabelColor;
```

Update the label `RNText` to always apply `labelColor`:

```tsx
<RNText style={[styles.label, { color: labelColor }]}>{children}</RNText>
```

Remove the now-authoritative `color: theme.colors.textPrimary` from `button.styles.ts` `label` (the color moves entirely to the component so it can vary by variant); keep the rest of `label` (typography, weight) and update its doc comment to say the color is applied by the component per variant. `SymbolIcon` already receives `color={labelColor}`.

- [ ] **Step 5: Run the Button test, verify it passes**

Run: `npx jest src/design-system/components/button`
Expected: PASS.

- [ ] **Step 6: Write the failing Switch test + fix the thumb**

Create `switch.component.test.tsx` asserting the RN `Switch` `thumbColor` equals `darkTheme.colors.onAccent`:

```tsx
import { render } from '@testing-library/react-native';

import { darkTheme } from '../../theme';
import Switch from './switch.component';

it('thumb uses onAccent (white on both schemes)', () => {
  const { UNSAFE_getByType } = render(<Switch value onValueChange={() => {}} testID="s" />);
  // Query the RN Switch and read thumbColor.
});
```

(Use `getByTestId` once `Switch` forwards `testID` — added in Task 1 Step 9. Read `.props.thumbColor`.) Then in `switch.component.tsx:24` change `thumbColor={theme.colors.textPrimary}` to `thumbColor={theme.colors.onAccent}`.

- [ ] **Step 7: Run the Switch test, verify it passes**

Run: `npx jest src/design-system/components/switch`
Expected: PASS.

- [ ] **Step 8: Run the checks**

Run: `npm run check:all`. Expect green (typecheck sees the new `onAccent` key across both themes).

- [ ] **Step 9: Commit**

```bash
git add src/design-system/theme.ts src/design-system/components/button src/design-system/components/switch
git commit -m "feat(design-system): add onAccent token; route primary Button + Switch thumb through it"
```

---

### Task 6: Light palette contrast audit (item 9)

Reassess each light `colors` token in `theme.ts` against Apple HIG light system colors and adequate contrast. Do NOT rewrite — the light values are already close (`systemGroupedBackground` etc.). Verify and adjust only a token that measurably fails; keep dark/light paired 1:1.

**Files:**
- Modify (only if a mismatch is found): `src/design-system/theme.ts:64-81`

**Interfaces:**
- Produces: unchanged token shape; possibly refined light hex values with updated comments.

- [ ] **Step 1: Audit each light token against its Apple HIG reference**

Confirm the current light values against Apple's light-mode system palette:
- `background #F2F2F7` = systemGroupedBackground ✓
- `surface #FFFFFF` = secondarySystemGroupedBackground ✓
- `surfaceHigh #E5E5EA` = systemGray5 ✓
- `textPrimary #000000` = label ✓
- `textSecondary rgba(60,60,67,0.60)` = secondaryLabel ✓
- `accent #007AFF` = systemBlue (light) ✓
- `positive #34C759` = systemGreen (light) ✓
- `negative #FF3B30` = systemRed (light) ✓
- `border #C6C6C8` = separator/opaqueSeparator family ✓
- `scrim rgba(0,0,0,0.40)` — a modal dim; confirm it reads as a dim over a light screen (0.40 is intentionally lighter than dark's 0.55).

For each, confirm the primary text token clears WCAG contrast against the surface it sits on (`#000` on `#FFF` = 21:1; `secondaryLabel` on white ≈ 4.6:1 ✓).

- [ ] **Step 2: Adjust only a failing token**

If any token measurably fails HIG parity or contrast, update the light hex and its inline comment, keeping the dark counterpart untouched and the pairing intact. If all pass (expected), make NO code change — record the audit result in the commit message.

- [ ] **Step 3: Run the checks**

Run: `npm run check:all`. Expect green (existing theme snapshot/consumer tests unaffected if no value changed).

- [ ] **Step 4: Commit**

```bash
git commit -am "chore(theme): audit light palette against Apple HIG; <adjust <token> | no change needed>"
```

---

### Task 7: Light entity-tint / card-background calibration (item 4)

Category and entity card backgrounds on light are produced by `entityCardBackground(hex, 'light')` → `lightenHex(hex, CARD_LIGHTEN_PERCENT)`, whose `90` is a mirror of the dark percent and was never device-reviewed for light. Calibrate the light path so cards read correctly, keeping `resolveEntityColor`/`entityCardBackground` the single pipeline. NOTE: `entityTintBackground`/`ENTITY_TINT_OPACITY` are used ONLY by tests (grep-verified — no production consumer), so they are out of scope; the production lever is `CARD_LIGHTEN_PERCENT`. The exact numeric is DEVICE-REVIEWABLE, and this plan does not deploy — set a reasoned provisional value and defer the final numeric to the coordinator's device review.

**Files:**
- Modify: `src/design-system/entity-tint.ts:218-222` (`CARD_LIGHTEN_PERCENT` + comment)
- Modify: `src/design-system/entity-tint.test.ts` (add a light card-background assertion)

**Interfaces:**
- Consumes: `lightenHex`, `entityCardBackground` (already scheme-aware, default `'dark'`).
- Produces: unchanged signatures; a possibly-tuned `CARD_LIGHTEN_PERCENT`.

- [ ] **Step 1: Add a failing light card-background test**

In `entity-tint.test.ts`, lock the light derivation for a saturated swatch so a regression is caught and the intended percent is documented:

```ts
it('light card background lightens toward white with a hint of hue', () => {
  // systemRed light #FF3B30 at CARD_LIGHTEN_PERCENT — a pale, legible pink on
  // white, with black body text on top.
  expect(entityCardBackground('#FF3B30', 'light')).toBe(lightenHex('#FF3B30', 85));
});
```

(Use the percent chosen in Step 2; if you keep 90, assert `lightenHex('#FF3B30', 90)`.)

- [ ] **Step 2: Choose a provisional light percent**

Keep `CARD_LIGHTEN_PERCENT` at a value that preserves a visible hue hint without washing out to `surface` white. Dark's history was 55→70→90 (near-black hint). For light, a slightly stronger hue than the direct mirror often reads better on white; set `85` as the provisional (or keep `90` if the reviewer prefers the exact mirror). Update the `DEVICE-REVIEWABLE` comment to record that this round set the light value and that the coordinator must confirm it on-device this cycle:

```ts
// Mirror of CARD_DARKEN_PERCENT for the light theme. Provisional at 85 (a hint
// stronger than the direct 90 mirror, so a light card is not washed flat to the
// white `surface`). DEVICE-REVIEWABLE — the coordinator confirms this on the
// light theme on-device this round and adjusts if a card reads too pale or too
// saturated (same review loop the darken percent went through: 55 -> 70 -> 90).
const CARD_LIGHTEN_PERCENT = 85;
```

- [ ] **Step 3: Run the entity-tint tests**

Run: `npx jest src/design-system/entity-tint.test.ts`
Expected: PASS (with the percent matching Step 1/2).

- [ ] **Step 4: Run the checks**

Run: `npm run check:all`. Expect green — mutation coverage for `entity-tint.ts` is exercised by `check:deep` at the end.

- [ ] **Step 5: Commit**

```bash
git add src/design-system/entity-tint.ts src/design-system/entity-tint.test.ts
git commit -m "chore(entity-tint): provisional light card-background percent (device-review pending)"
```

---

## PHASE 3 — Component fixes (consume Phase 2 tokens)

### Task 8: Seed a default color in the Add-category form (item 6)

The add-category form opens with `color === null` → `value={color ?? ''}` → NO swatch ringed, unlike the accounts form which always rings a default. Seed a sensible default so a swatch is ringed from open, mirroring accounts UX, while still persisting `null` when the user never picks (so the row keeps its per-key palette fallback).

**Files:**
- Modify: `src/screens/settings/add-category-row/add-category-row.component.tsx:37`, `:41`, `:104-106`, `:121-126`
- Modify/Create: `src/screens/settings/add-category-row/add-category-row.component.test.tsx`

**Interfaces:**
- Consumes: `resolveCategoryColor(storedColor, key, scheme)` from `src/statistics/category-breakdown.ts` (rings the key-hash fallback); `resolveColorScheme(rt.themeName)`.
- Produces: no signature change; `categoriesRepo.create` still receives `color: string | null` (persist `null` when unpicked).

- [ ] **Step 1: Write the failing test**

Assert that on open, the ColorPicker has a ringed swatch (its `value` is a valid hex, not `''`). The ring is applied in `ColorPicker` when a swatch hex `=== value`; assert `value` resolves to a concrete swatch. Test the DERIVED display value rather than internal state: render the expanded form and assert the ColorPicker receives a non-empty `value`.

```tsx
it('rings a default color swatch when the add-category form opens', () => {
  const { getByTestId } = render(<AddCategoryRow />);
  fireEvent.press(getByTestId('add-category-card').findByRole?.('button') ?? /* open */ );
  // Assert the ColorPicker's ringed swatch exists (query the swatch whose
  // accessibility label matches the resolved default, ringed).
});
```

(Adapt to `ColorPicker`'s actual swatch testIDs/labels; the point is `value` is a real hex on open.)

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/screens/settings/add-category-row`
Expected: FAIL — `value` is `''` on open, no ring.

- [ ] **Step 3: Implement the default seed**

The category has no stored key until saved, so seed the DISPLAY value the same way the row editor rings its fallback: compute a preview key-hash color for the in-progress name (or a stable placeholder key) via `resolveCategoryColor(color, previewKey, colorScheme)`, and pass THAT resolved hex as the ColorPicker `value` while still storing `color` (nullable) for persistence. Concretely:

```tsx
import { useUnistyles } from 'react-native-unistyles';
import { resolveColorScheme } from '../../../design-system/color-scheme';
import { resolveCategoryColor } from '../../../statistics/category-breakdown';
// ...
const { rt } = useUnistyles();
const colorScheme = resolveColorScheme(rt.themeName);
// A stable preview key so an unpicked new category still rings a swatch on open,
// matching the accounts form's kind-default ring. `color` (nullable) is what
// persists; this only drives which swatch reads as selected.
const previewColor = resolveCategoryColor(color, trimmedName || 'new-category', colorScheme);
```

Then `value={previewColor}` on the `ColorPicker` (line 121-126), keeping `onSelect={setColor}` and `color` persisted as `null` when unpicked in `categoriesRepo.create` (line 61). Update the misleading `value=''` comment block (lines 117-120).

Also set `iconColor={previewColor}` (line 105) so the icon preview matches the ringed swatch instead of `color ?? undefined`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx jest src/screens/settings/add-category-row`
Expected: PASS. Also assert tapping a swatch updates the ring (picked color reflects) and that `create` still receives `null` when unpicked.

- [ ] **Step 5: Run the checks**

Run: `npm run check:all`. Expect green.

- [ ] **Step 6: Commit**

```bash
git add src/screens/settings/add-category-row
git commit -m "fix(categories): ring a default color swatch when the add form opens"
```

---

### Task 9: Make the "Add category" label read as enabled (item 7)

The collapsed Add-category row's label uses `tone="textSecondary"` (muted) while its plus icon is `textPrimary`, so the row looks disabled. Make the label read enabled/tappable. Designer judgment on final tone; recommend `tone="textPrimary"` to match the icon (the whole row is a live `Pressable`, no disabled state).

**Files:**
- Modify: `src/screens/settings/add-category-row/add-category-row.component.tsx:83-85`
- Modify: `src/screens/settings/add-category-row/add-category-row.component.test.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Write/adjust the failing test**

Assert the collapsed label's tone is `textPrimary` (query the `Text` by its content `t('categories.addCategory')` and assert the resolved tone/color equals `theme.colors.textPrimary`).

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/screens/settings/add-category-row`
Expected: FAIL — currently `textSecondary`.

- [ ] **Step 3: Change the tone**

Line 83: `<Text variant="body" tone="textSecondary">` → `<Text variant="body" tone="textPrimary">`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx jest src/screens/settings/add-category-row`
Expected: PASS.

- [ ] **Step 5: Run the checks + commit**

Run: `npm run check:all`.

```bash
git commit -am "fix(categories): Add category label reads enabled (textPrimary)"
```

---

### Task 10: Thread `textDisabledColor` into the calendar (item 8)

`kiko-calendar.component.tsx`'s `calendarTheme` never sets `textDisabledColor`; the library default `#d9e1e8` is ≈ light `surfaceHigh #E5E5EA` (the calendar background), so disabled days are invisible on light. Thread `textDisabledColor` from the theme so disabled days have contrast on both schemes.

**Files:**
- Modify: `src/screens/calendar/kiko-calendar/kiko-calendar.component.tsx:63-79`
- Modify/Create: `src/screens/calendar/kiko-calendar/kiko-calendar.component.test.tsx` (if a test exists; else add a focused one)

**Interfaces:** none new. Uses `theme.colors.textSecondary` (the muted-but-legible tone) for disabled days.

- [ ] **Step 1: Write the failing test**

Assert the `Calendar` receives a `theme.textDisabledColor` equal to `theme.colors.textSecondary`. `Calendar` is from `react-native-calendars` — query the rendered `Calendar` (or assert on `calendarTheme`) by reading the `theme` prop it is given. If the library is not mockable enough to inspect, extract `calendarTheme` into an exported pure builder `buildCalendarTheme(theme)` and unit-test that it includes `textDisabledColor`.

```ts
it('sets a legible disabled-day color', () => {
  expect(buildCalendarTheme(darkTheme).textDisabledColor).toBe(darkTheme.colors.textSecondary);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/screens/calendar/kiko-calendar`
Expected: FAIL — `textDisabledColor` absent.

- [ ] **Step 3: Add the key**

In `calendarTheme` (line 63-79), add:

```ts
    // Disabled days: the library default (#d9e1e8) is ≈ light surfaceHigh, so
    // out-of-range days vanish on light. Use the theme's muted-but-legible
    // secondary tone so they read dimmed yet visible on both schemes.
    textDisabledColor: theme.colors.textSecondary,
```

(If Step 1 extracted `buildCalendarTheme`, move the whole object there and consume it in the component.)

- [ ] **Step 4: Run the test, verify it passes + checks**

Run: `npx jest src/screens/calendar/kiko-calendar` then `npm run check:all`. Expect green.

- [ ] **Step 5: Commit**

```bash
git add src/screens/calendar/kiko-calendar
git commit -m "fix(calendar): thread textDisabledColor so disabled days show on light"
```

---

## PHASE 4 — Charts + statistics

### Task 11: Reset targets the saved preset, not the app default (item 1)

`resetTrendSelection` currently sets the selection to the live `presetTrendKeys` AND clears the saved value (`setTrendCategoryKeys(null)`). Change it to target `savedTrendKeys ?? presetTrendKeys` and NOT clear the saved value. Adjust `canResetTrend` to enable when the current selection differs from that saved-or-preset target. Preserve the button-state truth-table intent from `docs/superpowers/plans/2026-09-07-trend-daily-and-saved-categories.md` (`canSaveTrend` unchanged).

**Files:**
- Modify: `src/screens/statistics/statistics.screen.tsx:727-739`
- Modify: `src/screens/statistics/statistics.screen.test.tsx`

**Interfaces:**
- Consumes: `savedTrendKeys` (`Set<string> | null`, already pruned), `presetTrendKeys` (`Set<string>`), `sameKeys`, `setSelectedTrendCategories`, `settingsRepo.setTrendCategoryKeys`.
- Produces: a `resetTargetTrendKeys` local; unchanged `canSaveTrend`.

- [ ] **Step 1: Update the failing test first**

In `statistics.screen.test.tsx`, change/add cases:
- Reset restores the SAVED selection (not the live preset) when a saved selection exists, and does NOT clear it (no `setTrendCategoryKeys(null)` call, saved persists across a remount).
- With no saved selection, Reset restores the live preset (unchanged behavior for that case).
- `statistics-trend-reset` is DISABLED when the current selection already equals the saved-or-preset target, ENABLED when it differs.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/screens/statistics/statistics.screen.test.tsx -t trend`
Expected: FAIL — Reset still clears saved / targets preset.

- [ ] **Step 3: Implement the new target**

Replace lines 727-739:

```ts
  // The target Reset restores to: the user's last SAVED selection when one
  // exists, else the live top-3-by-expense preset. Reset no longer clears the
  // saved value — it returns to it.
  const resetTargetTrendKeys = savedTrendKeys ?? presetTrendKeys;

  // Reset is enabled whenever the current selection differs from that target.
  const canResetTrend = !sameKeys(selectedTrendCategories, resetTargetTrendKeys);

  // Save persists the current selection as the saved set.
  const saveTrendSelection = (): void => {
    settingsRepo.setTrendCategoryKeys([...selectedTrendCategories]);
  };
  // Reset restores the saved-or-preset target WITHOUT clearing the saved value.
  const resetTrendSelection = (): void => {
    setSelectedTrendCategories(new Set(resetTargetTrendKeys));
  };
```

Leave `canSaveTrend` (lines 723-725) unchanged.

- [ ] **Step 4: Run the test, verify it passes + checks**

Run: `npx jest src/screens/statistics/statistics.screen.test.tsx` then `npm run check:all`. Expect green.

- [ ] **Step 5: Commit**

```bash
git add src/screens/statistics/statistics.screen.tsx src/screens/statistics/statistics.screen.test.tsx
git commit -m "fix(statistics): Reset restores the saved trend selection, not the app default"
```

---

### Task 12: Remove the donut-center "Total" caption (item 11) — UNBLOCKED

> **UNBLOCKED 2026-09-08: user confirmed the target = the center "Total" caption only. Keep the amount.**

Remove ONLY the caption `t('components.pieChart.total')` ("Total") from the `centerTotal` block in `src/design-system/components/pie-chart/pie-chart.component.tsx:226-228` (the `<Text variant="caption" tone="textSecondary">`). KEEP the `MoneyText` amount and the `-center-total` testID wrapper (the amount still renders there). Then drop the now-unused `total` key from the `pieChart` block in BOTH `src/i18n/locales/en.ts` and `uk.ts` (leave `emptyDefault`). Update `pie-chart.component.test.tsx` (and any snapshot) that asserted the "Total" caption.

**Files:**
- Modify: `src/design-system/components/pie-chart/pie-chart.component.tsx` (remove the caption `Text` in the centerTotal block; the `Text` import may become unused — remove it if so, but check the empty-state/legend `Text` usages first).
- Modify: `src/design-system/components/pie-chart/pie-chart.component.test.tsx` (drop the caption assertion; assert the amount still renders and the caption is gone).
- Modify: `src/i18n/locales/en.ts` + `uk.ts` (remove `components.pieChart.total` from both; parity test must stay green).

**Interfaces:** none new.

- [ ] **Step 1: Adjust the failing test** — remove/replace the "Total" caption assertion in `pie-chart.component.test.tsx`; add an assertion that the center amount (`centerTotal` MoneyText) still renders and that no element carries the removed caption text.
- [ ] **Step 2: Run it, verify it fails** — `npx jest src/design-system/components/pie-chart` (fails while the caption is still rendered).
- [ ] **Step 3: Remove the caption + i18n key** — delete the caption `Text` (lines 226-228); if the `Text` import is now unused in the file, remove it (verify no other `Text` usage remains — the legend/empty-state may still use it). Remove `total:` from the `pieChart` block in both `en.ts` and `uk.ts`.
- [ ] **Step 4: Run the test + parity, verify pass** — `npx jest src/design-system/components/pie-chart src/i18n/locales/en.uk.parity.test.ts`.
- [ ] **Step 5: Run the checks + commit** — `npm run check:all` (knip must not flag an orphaned key; typecheck clean).

```bash
git add src/design-system/components/pie-chart src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "fix(charts): remove the donut-center Total caption, keep the amount"
```

---

### Task 13: Net-worth line area gradient (item 12)

Add a red/green area fill under the net-worth line, fading to transparent from the line down to the baseline. Single-color-by-sign (recommended, stated below), one vertical `LinearGradient` for the whole area. Follow kiko-charts: every new SVG primitive carries a `testID`; set `stopOpacity` explicitly (native masks rgba alpha in `stopColor`).

**Sign→color rule (recommended, single color):** the area color keys off whether the LATEST point's value is at/above `startReference` (`positive` green) or below it (`negative` red) — one gradient for the whole area, keeping it simple. If the user later wants per-segment coloring (green above the reference, red below, split at the crossing), that is a follow-up; flag it, do not build it now.

**Files:**
- Modify: `src/design-system/components/net-worth-line/net-worth-line.component.tsx` (imports line 4; new helpers near line 182; render near line 341)
- Modify: `src/design-system/components/net-worth-line/net-worth-line.component.test.tsx`
- Mock: `__mocks__/react-native-svg.tsx` already exports `LinearGradient`, `Defs`, `Stop`, `Path` (verified) — NO mock change needed; confirm before writing the test.

**Interfaces:**
- Consumes: `Scales` (`buildScales`), `theme.colors.positive` / `theme.colors.negative`, `baselineY` (already computed at line 256 as `height - PADDING_Y`).
- Produces: `toAreaPath(points: NetWorthPoint[], scales: Scales, baselineY: number): string`; `areaColor(points: NetWorthPoint[], startReference: number, theme): string`.

- [ ] **Step 1: Confirm the mock exports the primitives**

Run: `rtk grep -n "LinearGradient\|Defs\|Stop\|export const Path" __mocks__/react-native-svg.tsx`
Expected: all four present (they are). No mock edit.

- [ ] **Step 2: Write the failing pure-helper tests**

In `net-worth-line.component.test.tsx`:

```tsx
import { areaColor, toAreaPath } from './net-worth-line.component';
import { darkTheme } from '../../theme';

describe('areaColor', () => {
  it('is positive-green when the latest value is at/above the reference', () => {
    const pts = [{ t: 0, amount: 10 }, { t: 1, amount: 15 }];
    expect(areaColor(pts, 10, darkTheme)).toBe(darkTheme.colors.positive);
  });

  it('is negative-red when the latest value is below the reference', () => {
    const pts = [{ t: 0, amount: 10 }, { t: 1, amount: 5 }];
    expect(areaColor(pts, 10, darkTheme)).toBe(darkTheme.colors.negative);
  });
});

describe('toAreaPath', () => {
  it('closes the polyline down to the baseline', () => {
    // Assert the path starts at the first point, traces the line, then drops to
    // baselineY under the last x and back under the first x, closing with Z.
    // (Assert the string contains the expected first/last coords + a trailing Z.)
  });
});
```

Export `toAreaPath` and `areaColor` (they must be importable — add `export` to the helpers). Also add a render test asserting `net-worth-line-area` (Path) `fill="url(#net-worth-line-gradient)"` and that `net-worth-line-gradient-stop-top` / `-bottom` carry explicit `stopOpacity` values (top > 0, bottom `0`) and a `stopColor` equal to the resolved area color.

- [ ] **Step 3: Run them, verify they fail**

Run: `npx jest src/design-system/components/net-worth-line`
Expected: FAIL — helpers not exported / primitives not rendered.

- [ ] **Step 4: Implement the helpers**

Near `toPolylinePoints` (line 182):

```ts
// The filled area under the line: the polyline path, then dropped straight down
// to the plot baseline under the last point and back under the first, closed —
// so a vertical gradient fills between the line and the baseline.
export const toAreaPath = (
  points: NetWorthPoint[],
  scales: Scales,
  baselineY: number,
): string => {
  const line = points.map((p) => `${scales.x(p.t)},${scales.y(p.amount)}`).join(' L ');
  const firstX = scales.x(points[0].t);
  const lastX = scales.x(points[points.length - 1].t);

  return `M ${line} L ${lastX},${baselineY} L ${firstX},${baselineY} Z`;
};

// One color for the whole area by net sign: green when the latest value is at or
// above the start reference, red when below. A single gradient keeps the fill
// simple; per-segment crossing coloring is a deferred follow-up.
export const areaColor = (
  points: NetWorthPoint[],
  startReference: number,
  theme: { colors: { positive: string; negative: string } },
): string =>
  points[points.length - 1].amount >= startReference
    ? theme.colors.positive
    : theme.colors.negative;
```

- [ ] **Step 5: Render the gradient + area (behind the line)**

Add `Defs`, `LinearGradient`, `Stop`, `Path` to the import from `react-native-svg` (line 4). Inside the `<Svg>`, BEFORE the `<Polyline>` (so the line draws on top), add:

```tsx
<Defs>
  <LinearGradient
    testID="net-worth-line-gradient"
    id="net-worth-line-gradient"
    x1="0"
    y1={PADDING_Y}
    x2="0"
    y2={baselineY}
    gradientUnits="userSpaceOnUse"
  >
    <Stop
      testID="net-worth-line-gradient-stop-top"
      offset="0"
      stopColor={areaColor(points, startReference, theme)}
      stopOpacity={0.3}
    />
    <Stop
      testID="net-worth-line-gradient-stop-bottom"
      offset="1"
      stopColor={areaColor(points, startReference, theme)}
      stopOpacity={0}
    />
  </LinearGradient>
</Defs>

<Path
  testID="net-worth-line-area"
  d={toAreaPath(points, scales, baselineY)}
  fill="url(#net-worth-line-gradient)"
  stroke="none"
/>
```

Keep the existing `<Polyline>` unchanged (line stroke stays `entityColors.white`). `stopOpacity` is set explicitly on both stops per kiko-charts (native masks rgba alpha).

- [ ] **Step 6: Run the tests, verify they pass**

Run: `npx jest src/design-system/components/net-worth-line`
Expected: PASS. Confirm the empty/loading states (no points) still short-circuit before the area render (they return early at line 233).

- [ ] **Step 7: Run the checks + commit**

Run: `npm run check:all`.

```bash
git add src/design-system/components/net-worth-line
git commit -m "feat(charts): net-worth line area gradient (green/red by net sign, fading to transparent)"
```

---

## PHASE 5 — Native asset catalog

### Task 14: Add explicit dark (and evaluate tinted) app-icon slots (item 13)

The light app icon never shows because `AppIcon.appiconset/Contents.json` has only a base slot (no `appearances`) plus a `luminosity/light` slot — with no explicit `dark` slot, iOS's appearance switcher does not treat the base as the dark variant, so the light one is never offered/used. Add an explicit `dark` appearance slot (pointing at the existing base `AppIcon-1024.png`), and evaluate a `tinted` slot. NATIVE asset task (developer authors `Contents.json`; ops runs a build check). No device deploy — the coordinator owns on-device verification.

**Files:**
- Modify: `ios/Kiko/Images.xcassets/AppIcon.appiconset/Contents.json`

**Interfaces:** none (asset catalog).

- [ ] **Step 1: Add the explicit dark slot**

Rewrite `Contents.json` so the base image is ALSO declared as the explicit `dark` luminosity variant, alongside the existing `light` one:

```json
{
  "images" : [
    {
      "filename" : "AppIcon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        { "appearance" : "luminosity", "value" : "dark" }
      ],
      "filename" : "AppIcon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        { "appearance" : "luminosity", "value" : "light" }
      ],
      "filename" : "AppIcon-1024-light.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
```

- [ ] **Step 2: Evaluate a tinted slot**

A `tinted` (monochrome) slot is iOS 18's home-screen tint mode. If no dedicated grayscale asset exists, DO NOT invent one (a tinted slot pointing at the full-color icon renders poorly). Record the decision: add a `tinted` slot only if a grayscale `AppIcon-1024-tinted.png` is provided; otherwise omit it and note it as a follow-up. Default for this task: OMIT tinted (no asset), ship the dark slot only.

- [ ] **Step 3: Build check (ops), no deploy**

Run an iOS build of the target (ops) to confirm the asset catalog compiles (`actool` runs during the build; a malformed `Contents.json` fails the build). Do NOT `deploy:device` — the coordinator verifies the light/dark/switcher behavior on-device during redeploy.

- [ ] **Step 4: Run the JS checks + commit**

Run: `npm run check:all` (JS unaffected; confirms nothing else regressed).

```bash
git add ios/Kiko/Images.xcassets/AppIcon.appiconset/Contents.json
git commit -m "fix(ios): explicit dark app-icon slot so the light variant is offered"
```

---

## Final checkpoint

- [ ] **Run the deep tier once, after Task 14**

Run: `npm run check:deep` (through an Orca terminal) — mutation testing (break threshold 60) then osv-scanner. Expect green apart from the KNOWN, tracked CVEs documented in `CLAUDE.md` ("Known dependency CVEs": `image-size`, `decode-uri-component`); do NOT suppress them. If mutation score dropped below threshold on the new pure helpers (`appearanceFromToggles`/`togglesFromAppearance`, `toAreaPath`/`areaColor`, the button variant color, the reset target), add the missing killing tests — do not lower the threshold.

- [ ] **Report to the coordinator for redeploy**

The plan does NOT deploy. Hand back to the coordinator: the two native changes (Task 4 privacy overlay, Task 14 app icon) and the two DEVICE-REVIEWABLE calibrations (Task 6 light palette if adjusted, Task 7 `CARD_LIGHTEN_PERCENT`) need on-device verification in BOTH schemes, and Task 12 remains BLOCKED pending user confirmation of the pie-chart "description text" target.

---

## Self-Review

- **Spec coverage:** all 13 user items are mapped — item 2 → Task 1, item 3 → Task 2, item 10 → Task 4, item 9 → Task 6, item 5 → Task 5, item 4 → Task 7, item 6 → Task 8, item 7 → Task 9, item 8 → Task 10, item 1 → Task 11, item 11 → Task 12 (BLOCKED stub), item 12 → Task 13, item 13 → Task 14. (Task 3 intentionally folded into Task 4; numbering skips it.)
- **Ordering:** Phase 2 `onAccent` (Task 5) and light-tint calibration (Task 7) precede the Phase 3 component fixes; Task 5 precedes Task 6 on the shared `theme.ts`.
- **Type consistency:** `appearanceFromToggles`/`togglesFromAppearance`, `toAreaPath`/`areaColor`, `resetTargetTrendKeys`, and `onAccent` are named identically everywhere they appear.
