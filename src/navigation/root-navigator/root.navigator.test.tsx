// The real Settings screen (wired into RootNavigator) pulls in db/client,
// which opens a real op-sqlite connection at module load. op-sqlite has no
// Jest binary, so stub it the same way every repo test does.
// `@bottom-tabs/react-navigation` (native tab navigator) is stubbed by the
// manual mock at `__mocks__/@bottom-tabs/react-navigation.tsx`, which Jest
// applies automatically for every test that pulls it in transitively — see
// that file for why and what it renders.
import { en } from '@kiko/i18n/locales';
import { darkTheme } from '@kiko/design-system/theme';
import { NavigationContainer } from '@react-navigation/native';
import { act, render, within } from '@testing-library/react-native';
import { reportWindow, resizeWindow } from '@kiko/test-support/window-size';

import '@kiko/design-system/unistyles';

import { SETTLE_DELAY_MS } from '../pane-stack';
import { navigationDarkTheme } from '../navigation-theme';

import RootNavigator from './root.navigator';

beforeEach(() => {
  reportWindow('compact', 390, 844);
});

describe('RootNavigator', () => {
  it('renders the four bottom tabs on a window that is not large', async () => {
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

  // The four tab SF Symbols. Home and Statistics are decided KEEPs; Accounts
  // takes the entity.account standard (`tray`) and Settings takes `gear` under
  // the app-wide icon rework. The mock surfaces each `tabBarIcon()`'s resolved
  // `sfSymbol` on a `tab-icon-<name>` host element.
  it('wires each tab to its SF Symbol (Accounts=tray, Settings=gear, Home/Statistics unchanged)', async () => {
    const { findByTestId } = await render(
      <NavigationContainer theme={navigationDarkTheme}>
        <RootNavigator />
      </NavigationContainer>,
    );

    expect((await findByTestId('tab-icon-HomeTab')).props.sfSymbol).toBe('house.fill');
    expect((await findByTestId('tab-icon-AccountsTab')).props.sfSymbol).toBe('tray');
    expect((await findByTestId('tab-icon-StatisticsTab')).props.sfSymbol).toBe('chart.xyaxis.line');
    expect((await findByTestId('tab-icon-SettingsTab')).props.sfSymbol).toBe('gear');
  });

  // The iPad floating top bar exposes no SF Symbol ids, so the Maestro flows key on an explicit
  // `tabBarButtonTestID` instead, the same on every device.
  it('gives each tab a stable test id on every device (tab-home, tab-accounts, tab-statistics, tab-settings)', async () => {
    const { findByTestId } = await render(
      <NavigationContainer theme={navigationDarkTheme}>
        <RootNavigator />
      </NavigationContainer>,
    );

    expect((await findByTestId('tab-home')).props.accessibilityLabel).toBe('tab-button-HomeTab');
    expect((await findByTestId('tab-accounts')).props.accessibilityLabel).toBe(
      'tab-button-AccountsTab',
    );
    expect((await findByTestId('tab-statistics')).props.accessibilityLabel).toBe(
      'tab-button-StatisticsTab',
    );
    expect((await findByTestId('tab-settings')).props.accessibilityLabel).toBe(
      'tab-button-SettingsTab',
    );
  });

  // The native UITabBar rebuilds its styling on every tab's
  // `onAppear` (see react-native-bottom-tabs `TabAppearModifier`). With no
  // `tabBarStyle`, that rebuild calls `configureWithDefaultBackground()`,
  // whose material re-resolves against the ambient interface style. Pinning
  // `tabBarStyle.backgroundColor` to the active theme's background token
  // forces the bar's background to a concrete color on every rebuild, keeping
  // one consistent scheme. `barTintColor` is NOT a real prop of the
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

  // The tab bar's colors must be read from `useUnistyles().theme` at
  // render time, not from a hardcoded `darkTheme` import. Under the global
  // Jest mock (`react-native-unistyles/mocks`), `useUnistyles().theme`
  // always resolves to the same `darkTheme` object as the static import (the
  // first-registered theme — see design-system/unistyles/unistyles.ts), so a plain
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

  describe('the tab set of a window', () => {
    const renderRoot = () =>
      render(
        <NavigationContainer theme={navigationDarkTheme}>
          <RootNavigator />
        </NavigationContainer>,
      );

    const TAB_LABELS = [en.home.title, en.accounts.title, en.statistics.title, en.settings.title];

    it.each([
      ['an iPhone', 'compact', 390, 844],
      ['the Duo outer window', 'compact', 466, 678],
      ['the Duo inner window in landscape', 'regular', 951, 669],
      ['the Duo inner window in portrait', 'regular', 669, 951],
      ['a split-view window in landscape', 'regular', 1032, 683],
      ['a split-view window in portrait', 'regular', 683, 909],
      ['a regular window too small to split', 'regular', 710, 500],
    ] as const)('shows all four tabs on %s', async (_name, sizeClass, width, height) => {
      reportWindow(sizeClass, width, height);
      const { findByTestId, getByTestId } = await renderRoot();
      const tabBar = within(await findByTestId('tab-bar'));

      for (const label of TAB_LABELS) {
        expect(tabBar.getByText(label)).toBeTruthy();
      }

      expect(getByTestId('tab-statistics')).toBeTruthy();
    });

    it.each([
      ['an iPad mini in portrait', 744, 1133],
      ['an iPad mini in landscape', 1133, 744],
      ['an 11-inch iPad in portrait', 820, 1180],
      ['an 11-inch iPad in landscape', 1180, 820],
      ['a 13-inch iPad in portrait', 1032, 1376],
      ['a 13-inch iPad in landscape', 1376, 1032],
    ] as const)('hides the Statistics tab on %s', async (_name, width, height) => {
      reportWindow('regular', width, height);
      const { findByTestId, queryByTestId } = await renderRoot();
      const tabBar = within(await findByTestId('tab-bar'));

      for (const label of TAB_LABELS.filter((label) => label !== en.statistics.title)) {
        expect(tabBar.getByText(label)).toBeTruthy();
      }

      expect(tabBar.queryByText(en.statistics.title)).toBeNull();
      expect(queryByTestId('tab-statistics')).toBeNull();
    });

    describe('when the window changes size', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      const elapse = async (milliseconds: number): Promise<void> => {
        await act(async () => {
          jest.advanceTimersByTime(milliseconds);
        });
      };

      it('keeps the Statistics tab until the large window has lasted the settle delay', async () => {
        reportWindow('regular', 1032, 683);
        const { getByTestId, queryByTestId } = await renderRoot();

        await resizeWindow(1376, 1032);
        await elapse(SETTLE_DELAY_MS - 1);

        expect(getByTestId('tab-statistics')).toBeTruthy();

        await elapse(1);

        expect(queryByTestId('tab-statistics')).toBeNull();
      });

      it('brings the Statistics tab back once a window that is no longer large has lasted the settle delay', async () => {
        reportWindow('regular', 1376, 1032);
        const { getByTestId, queryByTestId } = await renderRoot();

        await resizeWindow(1032, 683);
        await elapse(SETTLE_DELAY_MS - 1);

        expect(queryByTestId('tab-statistics')).toBeNull();

        await elapse(1);

        expect(getByTestId('tab-statistics')).toBeTruthy();
      });

      it('never hides the Statistics tab for a large window that is gone within the settle delay', async () => {
        reportWindow('regular', 1032, 683);
        const { getByTestId } = await renderRoot();

        await resizeWindow(1376, 1032);
        await elapse(SETTLE_DELAY_MS - 1);
        await resizeWindow(1032, 683);
        await elapse(SETTLE_DELAY_MS * 2);

        expect(getByTestId('tab-statistics')).toBeTruthy();
      });
    });
  });
});
