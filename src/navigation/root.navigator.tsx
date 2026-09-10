import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';

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
 * the scheme deterministic while keeping the active theme's accent color as
 * the active tint.
 *
 * `tabBarStyle.backgroundColor` pins the bar's *background* (Bug B1). The
 * library rebuilds the UITabBar styling on every tab's `onAppear`
 * (react-native-bottom-tabs `TabAppearModifier` → `configureStandardAppearance`).
 * With no `tabBarStyle` that rebuild calls `configureWithDefaultBackground()`,
 * whose glass material re-resolves against the ambient `userInterfaceStyle`.
 * The app is dark-only and pins `UIUserInterfaceStyle = Dark` in Info.plist,
 * so that ambient style is always dark; setting `tabBarStyle.backgroundColor`
 * additionally forces the bar's background to the concrete dark background
 * token on every rebuild, so the bar holds one consistent dark scheme.
 */
const RootNavigator: FC = () => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  return (
    <Tabs.Navigator
      // `tabBarStyle.backgroundColor` — NOT `barTintColor` — is the real
      // NativeBottomTabNavigationConfig member. `barTintColor` is not a
      // NativeBottomTabNavigatorProps member at all: the adapter passes it
      // through `...rest` and react-native-bottom-tabs' TabView then
      // re-declares `barTintColor={tabBarStyle?.backgroundColor}` AFTER that
      // spread (TabView.tsx:477), so the native view received `undefined` and
      // `configureWithDefaultBackground()` re-resolved the bar's glass against
      // the ambient userInterfaceStyle on every tab's `onAppear` — the bar
      // flipped light/dark between pages (bug B1). The app is dark-only and pins
      // `UIUserInterfaceStyle = Dark` in Info.plist, so the ambient native style
      // is always dark. This concrete backgroundColor still pins the exact token.
      tabBarStyle={{ backgroundColor: theme.colors.background }}
      tabBarActiveTintColor={theme.colors.accent}
      tabBarInactiveTintColor={theme.colors.textSecondary}
    >
      <Tabs.Screen
        name="HomeTab"
        component={HomeStack}
        options={{ title: t('home.title'), tabBarIcon: () => ({ sfSymbol: 'house.fill' }) }}
      />
      <Tabs.Screen
        name="AccountsTab"
        component={AccountsStack}
        options={{
          title: t('accounts.title'),
          tabBarIcon: () => ({ sfSymbol: 'wallet.pass.fill' }),
        }}
      />
      <Tabs.Screen
        name="StatisticsTab"
        component={StatisticsStack}
        options={{
          title: t('statistics.title'),
          tabBarIcon: () => ({ sfSymbol: 'chart.xyaxis.line' }),
        }}
      />
      <Tabs.Screen
        name="SettingsTab"
        component={SettingsStack}
        options={{ title: t('settings.title'), tabBarIcon: () => ({ sfSymbol: 'gearshape.fill' }) }}
      />
    </Tabs.Navigator>
  );
};

export default RootNavigator;
