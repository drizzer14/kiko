import { NavigationContainer } from '@react-navigation/native';
import { render, within } from '@testing-library/react-native';

// The real Settings screen (wired into RootNavigator) pulls in db/client,
// which opens a real op-sqlite connection at module load. op-sqlite has no
// Jest binary, so stub it the same way every repo test does.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

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

  // Bug B1: the native UITabBar rebuilds its appearance on every tab's
  // `onAppear` (see react-native-bottom-tabs `TabAppearModifier`). With no
  // `barTintColor`, that rebuild calls `configureWithDefaultBackground()`,
  // whose material re-resolves against the ambient (unpinned) interface
  // style, so the glass bar flips light/dark between pages. Pinning
  // `barTintColor` to the dark background token forces
  // `appearance.backgroundColor` to a concrete, scheme-independent color on
  // every rebuild, keeping one consistent dark scheme.
  it('pins the tab-bar background to the dark background token so the scheme cannot flip', async () => {
    const { findByTestId } = await render(
      <NavigationContainer theme={navigationDarkTheme}>
        <RootNavigator />
      </NavigationContainer>,
    );
    const tabBar = await findByTestId('tab-bar');
    expect(tabBar.props.barTintColor).toBe(darkTheme.colors.background);
  });
});
