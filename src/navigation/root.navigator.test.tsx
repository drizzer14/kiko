import { NavigationContainer } from '@react-navigation/native';
import { render, within } from '@testing-library/react-native';

// The real Settings screen (wired into RootNavigator) pulls in db/client,
// which opens a real op-sqlite connection at module load. op-sqlite has no
// Jest binary, so stub it the same way every repo test does.
// `@bottom-tabs/react-navigation` (native tab navigator) is stubbed by the
// manual mock at `__mocks__/@bottom-tabs/react-navigation.tsx`, which Jest
// applies automatically for every test that pulls it in transitively — see
// that file for why and what it renders.
import { darkTheme } from '../design-system/theme';

import { navigationDarkTheme } from './dark-theme';
import '../design-system/unistyles';
import RootNavigator from './root.navigator';

describe('RootNavigator', () => {
  it('renders the four bottom tabs', async () => {
    const { findByTestId } = await render(
      <NavigationContainer theme={navigationDarkTheme}>
        <RootNavigator />
      </NavigationContainer>,
    );
    const tabBar = within(await findByTestId('tab-bar'));
    expect(tabBar.getByText('Home')).toBeTruthy();
    expect(tabBar.getByText('Accounts')).toBeTruthy();
    expect(tabBar.getByText('Statistics')).toBeTruthy();
    expect(tabBar.getByText('Settings')).toBeTruthy();
  });

  // Bug B1: the native UITabBar rebuilds its styling on every tab's
  // `onAppear` (see react-native-bottom-tabs `TabAppearModifier`). With no
  // `tabBarStyle`, that rebuild calls `configureWithDefaultBackground()`,
  // whose material re-resolves against the ambient interface style. The app
  // is dark-only (pins `UIUserInterfaceStyle = Dark`), and pinning
  // `tabBarStyle.backgroundColor` to the dark background token additionally
  // forces the bar's background to a concrete color on every rebuild, keeping
  // one consistent dark scheme. `barTintColor` is NOT a real prop of the
  // native navigator — see root.navigator.tsx.
  it('pins the tab-bar background to the active theme background so the scheme cannot flip', async () => {
    const { findByTestId } = await render(
      <NavigationContainer theme={navigationDarkTheme}>
        <RootNavigator />
      </NavigationContainer>,
    );
    const tabBar = await findByTestId('tab-bar');
    expect(tabBar.props.tabBarStyle.backgroundColor).toBe(darkTheme.colors.background);
  });

  // Task 6: the tab bar's colors must be read from `useUnistyles().theme` at
  // render time, not from a hardcoded `darkTheme` import. Under the global
  // Jest mock (`react-native-unistyles/mocks`), `useUnistyles().theme`
  // always resolves to the same `darkTheme` object as the static import (the
  // first-registered theme — see design-system/unistyles.ts), so a plain
  // value assertion cannot tell the two sourcing strategies apart. This test
  // spies on the hook itself to return a theme whose color values are
  // deliberately distinct from `darkTheme`, proving the navigator reads
  // through the hook rather than the static import.
  //
  // `jest.requireMock`, not `import * as` — `import * as X` compiles through
  // Babel's `_interopRequireWildcard`, which for a plain (non-`__esModule`)
  // CJS mock object COPIES each property by value onto a fresh namespace
  // object rather than exposing a live reference; spying on that copy leaves
  // the module's own cached export — the one `root.navigator.tsx`'s named
  // import actually reads — untouched. `jest.requireMock` returns the exact
  // cached mock module object instead.
  it("reads the tab bar's colors from the active theme via useUnistyles, not a hardcoded darkTheme import", async () => {
    const Unistyles = jest.requireMock(
      'react-native-unistyles',
    ) as typeof import('react-native-unistyles');
    // `UnistylesTheme` itself is an internal type not re-exported from the
    // package root; derive the active-theme shape from the hook's own
    // return type instead of reaching into an unexported path. `fakeTheme`
    // deliberately holds colors outside the closed dark/light union (see the
    // comment above), so the cast through `unknown` is the sanctioned
    // boundary for a synthetic test fixture, not an `any` bypass.
    type ActiveTheme = ReturnType<typeof Unistyles.useUnistyles>['theme'];
    const fakeTheme = {
      ...darkTheme,
      colors: {
        ...darkTheme.colors,
        background: '#123456',
        accent: '#abcdef',
        textSecondary: '#fedcba',
      },
    } as unknown as ActiveTheme;
    jest.spyOn(Unistyles, 'useUnistyles').mockReturnValue({
      theme: fakeTheme,
      rt: Unistyles.UnistylesRuntime,
    });

    const { findByTestId } = await render(
      <NavigationContainer theme={navigationDarkTheme}>
        <RootNavigator />
      </NavigationContainer>,
    );
    const tabBar = await findByTestId('tab-bar');

    expect(tabBar.props.tabBarStyle.backgroundColor).toBe(fakeTheme.colors.background);
    expect(tabBar.props.tabBarActiveTintColor).toBe(fakeTheme.colors.accent);
    expect(tabBar.props.tabBarInactiveTintColor).toBe(fakeTheme.colors.textSecondary);

    jest.restoreAllMocks();
  });
});
