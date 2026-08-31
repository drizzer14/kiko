# PFF Redesign Phase 1 — Design System + Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give PFF a native-iOS shell — iOS-matched dark tokens, glass surfaces, SF Symbols, and a native bottom-tab navigation with no Home title and no back button — while keeping every existing screen reachable and every test green.

**Architecture:** Re-derive the unistyles dark theme to Apple's dark system palette. Add three native modules (native tab bar, liquid glass, SF Symbols). Replace the single native stack with a native bottom-tab navigator whose three tabs (Home, Accounts, Settings) each host a native stack for detail and form screens. Set a dark navigation theme so the black background shows behind every screen.

**Tech Stack:** React Native 0.87, react-native-unistyles v3, @react-navigation/native v7, react-native-bottom-tabs, @callstack/liquid-glass, react-native-nitro-sfsymbols, Jest + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-31-pff-redesign-design.md`

## Global Constraints

- Visual target: native Apple iOS, dark-only. Background token `#000000`.
- React Native >= 0.80 required for `@callstack/liquid-glass` (repo runs 0.87).
- Full liquid glass and native tab glass need an Xcode 26 build and iOS 26 runtime; older toolchains fall back to a solid native bar.
- Dependency hygiene: `.npmrc` enforces `min-release-age=7` (days). Pin any new package to a version older than 7 days, or add a documented `min-release-age-exclude` entry with a reason.
- Any string-only Babel/native reference must get a documented exception in `knip.json`, `.depcheckrc.json`, and `CLAUDE.md`, same as `inline-import` and `react-native-dotenv`.
- Harness standing rule: fix the underlying issue; never weaken a check. No `|| true`, no bare `biome-ignore` (use `OVERRIDE(...)`).
- **Commit within this worktree branch only.** Each task ends with a commit on `drizzer14/pff-redesign-phase-1` (the SDD review machinery needs BASE..HEAD ranges). Never push, never merge, never touch `main`. The user reviews the branch diff via Orca before anything lands. (Memory: `hold-commits-for-user-review` — intent preserved: nothing unreviewed reaches main.)
- Delegation: each task names its owner role agent. The coordinator does not edit app files inline.
- Naming: full names, no abbreviations. Uppercase abbreviations keep case (JSON, IBAN, MCC, ID). `import type` for type-only imports.

---

### Task 1: Add the native tab-bar dependency and pods

**Owner:** `pff:ops`

> **Scope ruling (controller):** Phase 1 adds ONLY `react-native-bottom-tabs`
> (plus its React Navigation integration). `@callstack/liquid-glass` and
> `react-native-nitro-sfsymbols` move to Phase 2, where Home consumes them.
> The native tab bar renders iOS 26 glass and SF Symbol icons from UIKit
> itself, so Phase 1 needs neither package; adding them now would fail
> `check:knip` / `check:deps` as unused.

**Files:**
- Modify: `package.json` (dependencies), `package-lock.json`
- Modify: `ios/Podfile.lock` (from `pod install`)
- Modify (if needed): `.depcheckrc.json`, `CLAUDE.md` (documented exceptions)

**Interfaces:**
- Produces: `react-native-bottom-tabs` (and its React Navigation integration) resolvable from source, with pods installed. Node modules restored in the worktree.

- [ ] **Step 1: Restore the worktree's base dependencies.** This is a fresh checkout. Run `npm install` (Group A already added `babel-plugin-inline-import` to `package.json`). Then `cd ios && pod install`. Confirm `node_modules` and pods exist.

- [ ] **Step 2: Confirm the toolchain.** Run `xcodebuild -version` and record it. If it is below Xcode 26, note in the task report that native-tab glass will fall back to a solid bar; do not block — the redesign still works.

- [ ] **Step 3: Choose min-age-safe versions.** Run `npm view react-native-bottom-tabs time --json` and select the newest version published more than 7 days ago. Do the same for the React Navigation integration package. Record the exact versions. If none is older than 7 days, stop and report; the user decides on a `min-release-age-exclude` entry.

- [ ] **Step 4: Install.** Confirm the exact integration package name from the React Navigation "Native Bottom Tabs" docs at install time (it is a separate package from `react-native-bottom-tabs`). Install both at the pinned versions.

```bash
npm install react-native-bottom-tabs@<pinned> <native-bottom-tabs-navigation-integration>@<pinned>
```

- [ ] **Step 5: Pods.** Run `cd ios && pod install`. Confirm the new pod(s) appear in `ios/Podfile.lock`.

- [ ] **Step 6: Verify resolution.** Run `npm run check:deps`. If it reports the new package as unused (it is consumed in Task 5, same phase), leave it — Task 5 wires it. If depcheck's static scan cannot see a string-only or peer usage, add a documented exception matching the `react-native-screens` / `react-native-nitro-modules` pattern in `.depcheckrc.json` and `CLAUDE.md`. Do not use a blanket ignore.

- [ ] **Step 7: Report and hold.** Report the chosen versions, the Xcode version, and any exception added. Commit within this worktree branch only (per the controller commit ruling). Do not push or merge.

---

### Task 2: iOS dark color tokens

**Owner:** `pff:designer`

**Files:**
- Modify: `src/design-system/theme.ts:10-30`
- Test: `src/design-system/theme.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `darkTheme.colors` with iOS dark system values. Token names kept: `background`, `surface`, `surfaceHigh`, `textPrimary`, `textSecondary`, `accent`, `positive`, `negative`, `border`, `buttonBackground`, `buttonText`.

- [ ] **Step 1: Write the failing test.**

```ts
import { darkTheme } from './theme';

describe('darkTheme iOS dark palette', () => {
  it('uses Apple dark system color values', () => {
    expect(darkTheme.colors.background).toBe('#000000');
    expect(darkTheme.colors.surface).toBe('#1C1C1E');
    expect(darkTheme.colors.surfaceHigh).toBe('#2C2C2E');
    expect(darkTheme.colors.textPrimary).toBe('#FFFFFF');
    expect(darkTheme.colors.accent).toBe('#0A84FF');
    expect(darkTheme.colors.positive).toBe('#30D158');
    expect(darkTheme.colors.negative).toBe('#FF453A');
    expect(darkTheme.colors.border).toBe('#38383A');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `npx jest src/design-system/theme.test.ts`. Expected: FAIL (current values differ, e.g. `#EDEDED`).

- [ ] **Step 3: Update the tokens.** Set the color values in `src/design-system/theme.ts` to Apple's dark palette:

```ts
  colors: {
    background: '#000000', // systemBackground (dark)
    surface: '#1C1C1E', // secondarySystemBackground
    surfaceHigh: '#2C2C2E', // tertiarySystemBackground
    textPrimary: '#FFFFFF', // label
    textSecondary: 'rgba(235,235,245,0.60)', // secondaryLabel
    accent: '#0A84FF', // systemBlue (dark)
    positive: '#30D158', // systemGreen (dark)
    negative: '#FF453A', // systemRed (dark)
    border: '#38383A', // separator (dark)
    buttonBackground: '#0A84FF', // primary action -> systemBlue tint
    buttonText: '#FFFFFF', // label on a tinted button
  },
```

Update the file's header comment to say "iOS dark system palette" and drop the OLED-halation wording, since the tokens now match Apple's values.

- [ ] **Step 4: Run tests.** Run `npx jest src/design-system/theme.test.ts`. Expected: PASS.

- [ ] **Step 5: Check existing MoneyText/text tests.** Run `npx jest src/design-system`. Fix any test that asserted an old hex value (e.g. money-text tone snapshots), updating the expected value to the new token. Do not weaken assertions.

- [ ] **Step 6: Lint and hold.** Run `npm run check:lint`. Report. Commit within the worktree branch only; do not push or merge.

---

### Task 3: Glass surface component — DEFERRED TO PHASE 2

> **Deferred (controller ruling).** Nothing in Phase 1 consumes `GlassSurface`;
> creating it now fails `check:knip` as an unused export. It moves to Phase 2,
> where the Home balance header consumes it. Do NOT implement in Phase 1.
> The task text below is retained for the Phase 2 plan.

**Owner:** `pff:designer`

**Files:**
- Create: `src/design-system/components/glass-surface/glass-surface.component.tsx`
- Create: `src/design-system/components/glass-surface/glass-surface.component.test.tsx`

**Interfaces:**
- Consumes: `@callstack/liquid-glass`.
- Produces: `GlassSurface`, a `FC<PropsWithChildren<{ style?: StyleProp<ViewStyle> }>>` that renders children inside a glass container on iOS 26 and a plain `surface`-colored view otherwise.

- [ ] **Step 1: Confirm the library API.** Read the installed `@callstack/liquid-glass` README/types to confirm the exported component name and props (for example a `LiquidGlassView` with an `effect`/`interactive` prop). Use the real exported name in the code below; the wrapper isolates the app from it.

- [ ] **Step 2: Write the failing test.**

```tsx
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { GlassSurface } from './glass-surface.component';
import '../../unistyles';

describe('GlassSurface', () => {
  it('renders its children', () => {
    const { getByText } = render(
      <GlassSurface>
        <Text>inside glass</Text>
      </GlassSurface>,
    );
    expect(getByText('inside glass')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails.** Run `npx jest glass-surface`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement the wrapper.** Create the component. Use the confirmed export from Step 1. Fall back to a plain view (unistyles `surface` background, `radii.lg`) where glass is unavailable. Mock the native module in a `__mocks__` or `jest.mock` so the test renders children.

```tsx
import type { FC, PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
// Import the confirmed export from the library (Step 1).

export const GlassSurface: FC<PropsWithChildren<{ style?: StyleProp<ViewStyle> }>> = ({
  children,
  style,
}) => (
  <View style={[styles.surface, style]}>{children}</View>
);

const styles = StyleSheet.create((theme) => ({
  surface: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    overflow: 'hidden',
  },
}));
```

Then wrap the child tree in the library's glass view on iOS, keeping the plain `View` as the fallback branch. Add a `jest.mock` for the native module at the top of the test so it does not require the native binary.

- [ ] **Step 5: Run the test.** Run `npx jest glass-surface`. Expected: PASS.

- [ ] **Step 6: Knip and lint.** Run `npm run check:lint`. `GlassSurface` is consumed later (Task 5 / Phase 2); if `npm run check:knip` flags it as unused at this point, leave it — Task 5 consumes it in the same phase. Report. Commit within the worktree branch only; do not push or merge.

---

### Task 4: SF Symbol component — DEFERRED TO PHASE 2

> **Deferred (controller ruling).** The native tab bar renders SF Symbol icons
> from UIKit via react-native-bottom-tabs' own `sfSymbol` option, so Phase 1
> needs no `Symbol` component or `react-native-nitro-sfsymbols` package.
> Unused, it would fail `check:knip` / `check:deps`. It moves to Phase 2,
> where in-content symbols consume it. Do NOT implement in Phase 1.

**Owner:** `pff:designer`

**Files:**
- Create: `src/design-system/components/symbol/symbol.component.tsx`
- Create: `src/design-system/components/symbol/symbol.component.test.tsx`

**Interfaces:**
- Consumes: `react-native-nitro-sfsymbols`.
- Produces: `Symbol`, a `FC<{ name: string; size?: number; tone?: TextTone }>` that renders an SF Symbol tinted from a theme token.

- [ ] **Step 1: Confirm the library API.** Read the installed `react-native-nitro-sfsymbols` types to confirm the component name and props (name, size, color). Use the real export in the code below.

- [ ] **Step 2: Write the failing test.**

```tsx
import { render } from '@testing-library/react-native';
import { Symbol } from './symbol.component';
import '../../unistyles';

jest.mock('react-native-nitro-sfsymbols', () => ({
  // Return a host view that records the symbol name via testID.
  SFSymbol: ({ name }: { name: string }) => require('react-native').View({ testID: `symbol-${name}` }),
}));

describe('Symbol', () => {
  it('renders the requested SF Symbol', () => {
    const { getByTestId } = render(<Symbol name="house.fill" />);
    expect(getByTestId('symbol-house.fill')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails.** Run `npx jest symbol.component`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement.** Map `tone` to a theme color and pass `name`/`size`/`color` to the library component. Default `size` 24, default `tone` `textPrimary`.

- [ ] **Step 5: Run the test.** Run `npx jest symbol.component`. Expected: PASS.

- [ ] **Step 6: Lint and hold.** Run `npm run check:lint`. Report. Commit within the worktree branch only; do not push or merge.

---

### Task 5: Native bottom-tab navigation

**Owner:** `pff:developer`

**Files:**
- Modify: `src/navigation/types.ts` (split into per-tab param lists + tab list)
- Create: `src/navigation/home.stack.tsx`, `src/navigation/accounts.stack.tsx`, `src/navigation/settings.stack.tsx`
- Modify: `src/navigation/root.navigator.tsx` (native bottom tabs)
- Modify: `App.tsx:22-26` (dark navigation theme on `NavigationContainer`)
- Create/Modify: `src/navigation/dark-theme.ts` (React Navigation dark theme override)

**Interfaces:**
- Consumes: `Symbol` (Task 4) is not required here — native tabs use the library's own `sfSymbol` icon option. Screens: the existing screen components in `src/screens/*`.
- Produces: `RootNavigator` renders a native bottom-tab navigator with tabs `Home`, `Accounts`, `Settings`. Types: `TabParamList`, `HomeStackParamList`, `AccountsStackParamList`, `SettingsStackParamList`.

- [ ] **Step 1: Split the param lists.** Rewrite `src/navigation/types.ts`:

```ts
export type HomeStackParamList = {
  Home: undefined;
};

export type AccountsStackParamList = {
  Accounts: undefined;
  AccountDetail: { accountId: string };
  HoldingDetail: { holdingId: string };
  AccountForm: { accountId?: string };
  HoldingForm: { accountId: string; holdingId?: string };
  TransactionForm: { holdingId: string };
};

export type SettingsStackParamList = {
  Settings: undefined;
};

export type TabParamList = {
  HomeTab: undefined;
  AccountsTab: undefined;
  SettingsTab: undefined;
};
```

Note: the `Accounts` list screen is new (Phase 3). For Phase 1, register the existing `HomeScreen` as a placeholder body of the Accounts tab root ONLY IF the real Accounts screen does not yet exist; preferred is a minimal `AccountsScreen` stub that lists nothing and is replaced in Phase 3. Create a minimal stub at `src/screens/accounts/accounts.screen.tsx` returning an empty `Screen` with a large-title header "Accounts", so navigation is complete and testable now.

- [ ] **Step 2: Create the three native stacks.** Each uses `createNativeStackNavigator` with `headerLargeTitle: true` on detail/form screens. Example `accounts.stack.tsx`:

```tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import AccountsScreen from '../screens/accounts/accounts.screen';
import AccountDetailScreen from '../screens/account-detail/account-detail.screen';
import HoldingDetailScreen from '../screens/holding-detail/holding-detail.screen';
import AccountFormScreen from '../screens/forms/account-form.screen';
import HoldingFormScreen from '../screens/forms/holding-form.screen';
import TransactionFormScreen from '../screens/forms/transaction-form.screen';
import type { AccountsStackParamList } from './types';

const Stack = createNativeStackNavigator<AccountsStackParamList>();

const AccountsStack: FC = () => (
  <Stack.Navigator screenOptions={{ headerLargeTitle: true }}>
    <Stack.Screen name="Accounts" component={AccountsScreen} />
    <Stack.Screen name="AccountDetail" component={AccountDetailScreen} />
    <Stack.Screen name="HoldingDetail" component={HoldingDetailScreen} />
    <Stack.Screen name="AccountForm" component={AccountFormScreen} />
    <Stack.Screen name="HoldingForm" component={HoldingFormScreen} />
    <Stack.Screen name="TransactionForm" component={TransactionFormScreen} />
  </Stack.Navigator>
);

export default AccountsStack;
```

`home.stack.tsx` registers `HomeScreen` with `headerShown: false` (Home has no title). `settings.stack.tsx` registers `SettingsScreen`.

- [ ] **Step 3: Write the native bottom-tab navigator.** Rewrite `src/navigation/root.navigator.tsx` using the native bottom-tabs navigator. Use the confirmed API from Task 1 Step 3. Set SF Symbol icons via the `tabBarIcon` `sfSymbol` option.

```tsx
import type { FC } from 'react';
import { createNativeBottomTabNavigator } from '<native-bottom-tabs-navigation-integration>';
import HomeStack from './home.stack';
import AccountsStack from './accounts.stack';
import SettingsStack from './settings.stack';
import type { TabParamList } from './types';

const Tabs = createNativeBottomTabNavigator<TabParamList>();

const RootNavigator: FC = () => (
  <Tabs.Navigator>
    <Tabs.Screen
      name="HomeTab"
      component={HomeStack}
      options={{ title: 'Home', tabBarIcon: () => ({ sfSymbol: 'house.fill' }) }}
    />
    <Tabs.Screen
      name="AccountsTab"
      component={AccountsStack}
      options={{ title: 'Accounts', tabBarIcon: () => ({ sfSymbol: 'wallet.pass.fill' }) }}
    />
    <Tabs.Screen
      name="SettingsTab"
      component={SettingsStack}
      options={{ title: 'Settings', tabBarIcon: () => ({ sfSymbol: 'gearshape.fill' }) }}
    />
  </Tabs.Navigator>
);

export default RootNavigator;
```

Confirm the exact `tabBarIcon`/`sfSymbol` shape from the library types; adjust if it differs.

- [ ] **Step 4: Dark navigation theme.** Create `src/navigation/dark-theme.ts`:

```ts
import { DarkTheme } from '@react-navigation/native';
import { darkTheme } from '../design-system/theme';

export const navigationDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: darkTheme.colors.background,
    card: darkTheme.colors.background,
    text: darkTheme.colors.textPrimary,
    border: darkTheme.colors.border,
    primary: darkTheme.colors.accent,
  },
};
```

Apply it in `App.tsx`:

```tsx
<NavigationContainer theme={navigationDarkTheme}>
  <RootNavigator />
</NavigationContainer>
```

- [ ] **Step 5: Remove the Home title and back button.** Confirm `home.stack.tsx` sets `headerShown: false` for `Home`, and that `HomeScreen` no longer renders its own "Home" title text or any "< Home"/Settings navigation button (those move to the tab bar and later phases). Delete the in-screen Settings button added by the interim Group B work.

- [ ] **Step 6: Build check.** Run `npx react-native start --reset-cache` in the background and `curl -sS "localhost:8081/index.bundle?platform=ios" -o /dev/null -w "%{http_code}\n"`. Expected: `200` (the bundle compiles with the new imports). Report the result.

- [ ] **Step 7: Lint and hold.** Run `npm run check:lint`. Report. Commit within the worktree branch only; do not push or merge.

---

### Task 6: Navigation tests

**Owner:** `pff:qa`

**Files:**
- Modify: `src/navigation/root.navigator.test.tsx`
- Create: `jest` mock for the native bottom-tabs module (a `__mocks__` file or inline `jest.mock`)

**Interfaces:**
- Consumes: `RootNavigator` (Task 5).

- [ ] **Step 1: Add a mock for the native tab navigator.** Native bottom tabs render a native view with no Jest binary. Add a `jest.mock` that renders each screen's tab `title` as text and mounts the focused screen, so assertions can find tab labels and screen content. Place it at the top of the test file (after the op-sqlite mock).

- [ ] **Step 2: Update the boot test.** The Home screen no longer shows a "Home" title in its body, but the Home tab still has the label "Home". Update the test to assert the three tab labels render:

```tsx
it('renders the three bottom tabs', async () => {
  const { findByText } = render(
    <NavigationContainer theme={navigationDarkTheme}>
      <RootNavigator />
    </NavigationContainer>,
  );
  expect(await findByText('Home')).toBeTruthy();
  expect(await findByText('Accounts')).toBeTruthy();
  expect(await findByText('Settings')).toBeTruthy();
});
```

- [ ] **Step 3: Run the navigation test.** Run `npx jest src/navigation`. Expected: PASS.

- [ ] **Step 4: Run the full suite.** Run `npx jest`. Fix any test broken by the navigation split (for example screens that navigated via the old single stack param list). Update the types/imports; do not weaken assertions. Expected: all green.

- [ ] **Step 5: Run the harness.** Run `npm run check:all`. Resolve any knip/dup/deps finding the right way (real fix or documented exception). Report. Commit within the worktree branch only; do not push or merge.

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- Native tab bar, SF Symbols, glass, iOS tokens, dark nav theme, no Home title, no back button, existing screens reachable → Tasks 1–6. Covered.
- Currency symbols, big balance, merged list, Accounts create-by-type, token flow → later phases, correctly out of Phase 1 scope.

**Placeholder scan:** No "TBD/TODO". The two "confirm the exact package name/API at install" notes are deliberate, bounded verification steps against real installed libraries, not missing content; the surrounding code is concrete and the wrapper isolates the app from the exact export.

**Type consistency:** `TabParamList`, `HomeStackParamList`, `AccountsStackParamList`, `SettingsStackParamList` defined in Task 5 Step 1 and used consistently in Steps 2–3 and Task 6. `GlassSurface` and `Symbol` signatures match between definition and description.

## Verification (end of phase)

- `npx jest` — all tests green.
- `npm run check:all` — green.
- Metro bundle returns HTTP 200.
- Hold the whole diff for user review. Commit within the worktree branch only; do not push or merge.
