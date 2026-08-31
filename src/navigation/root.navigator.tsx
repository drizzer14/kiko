import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';
import type { FC } from 'react';
import AccountsStack from './accounts.stack';
import HomeStack from './home.stack';
import SettingsStack from './settings.stack';
import type { TabParamList } from './types';

const Tabs = createNativeBottomTabNavigator<TabParamList>();

/**
 * The app's native bottom-tab navigator. Each tab hosts its own native stack.
 * Icons are SF Symbols (`{ sfSymbol }` is the library's `AppleIcon` shape);
 * `NavigationContainer` and its dark theme are provided by the app root.
 */
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
