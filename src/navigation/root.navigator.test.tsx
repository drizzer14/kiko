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
import { navigationDarkTheme } from './dark-theme';
import '../design-system/unistyles';
import RootNavigator from './root.navigator';

describe('RootNavigator', () => {
  it('renders the three bottom tabs', async () => {
    const { findByTestId } = await render(
      <NavigationContainer theme={navigationDarkTheme}>
        <RootNavigator />
      </NavigationContainer>,
    );
    const tabBar = within(await findByTestId('tab-bar'));
    expect(tabBar.getByText('Home')).toBeTruthy();
    expect(tabBar.getByText('Accounts')).toBeTruthy();
    expect(tabBar.getByText('Settings')).toBeTruthy();
  });
});
