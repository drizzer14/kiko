import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';
import type { FC } from 'react';
import { darkTheme } from '../design-system/theme';
import AccountsStack from './accounts.stack';
import HomeStack from './home.stack';
import SettingsStack from './settings.stack';
import StatisticsStack from './statistics.stack';
import type { TabParamList } from './types';

const Tabs = createNativeBottomTabNavigator<TabParamList>();

/**
 * The app's native bottom-tab navigator. Each tab hosts its own native stack.
 * Icons are SF Symbols (`{ sfSymbol }` is the library's `AppleIcon` shape);
 * `NavigationContainer` and its dark theme are provided by the app root.
 *
 * The active/inactive tints are pinned to design tokens directly on the
 * navigator. Left unset, the adapter derives the active tint from the
 * navigation theme `primary` and computes the inactive tint at runtime
 * (`Color(text).mix(card, 0.5)`), so the scheme is implicit and the native
 * tab bar can flash an unexpected tint on interaction. Pinning both makes
 * the scheme deterministic while keeping accent blue as the active color.
 *
 * `barTintColor` pins the bar's *background* (Bug B1). The library rebuilds
 * the UITabBar appearance on every tab's `onAppear` (react-native-bottom-tabs
 * `TabAppearModifier` → `configureStandardAppearance`). With no `barTintColor`
 * that rebuild calls `configureWithDefaultBackground()`, whose glass material
 * re-resolves against the ambient `userInterfaceStyle` — and because the app
 * pins dark only in JS (the `NavigationContainer` theme), not natively (no
 * `UIUserInterfaceStyle` in Info.plist), that ambient style is unpinned, so
 * the bar flips light/dark between pages. Setting `barTintColor` forces
 * `appearance.backgroundColor` to the concrete, scheme-independent dark
 * background token on every rebuild, so the bar holds one consistent scheme.
 */
const RootNavigator: FC = () => (
  <Tabs.Navigator
    barTintColor={darkTheme.colors.background}
    tabBarActiveTintColor={darkTheme.colors.accent}
    tabBarInactiveTintColor={darkTheme.colors.textSecondary}
  >
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
      name="StatisticsTab"
      component={StatisticsStack}
      options={{ title: 'Statistics', tabBarIcon: () => ({ sfSymbol: 'chart.xyaxis.line' }) }}
    />
    <Tabs.Screen
      name="SettingsTab"
      component={SettingsStack}
      options={{ title: 'Settings', tabBarIcon: () => ({ sfSymbol: 'gearshape.fill' }) }}
    />
  </Tabs.Navigator>
);

export default RootNavigator;
