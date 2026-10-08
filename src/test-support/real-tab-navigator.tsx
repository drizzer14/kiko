// The REAL React Navigation routers for the navigator tests: a spy cannot show
// which screens end up on the Accounts stack, or what happens when the tab has
// not mounted yet. The Accounts tab's screens are stubs that print their params.
import {
  createNavigatorFactory,
  NavigationContainer,
  TabRouter,
  useNavigationBuilder,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import { render } from '@testing-library/react-native';
import { type FC, type ReactNode, useState } from 'react';
import { navigationRef } from '@kiko/navigation/navigation-ref';
import { resetTabStackOnBlur } from '@kiko/navigation/reset-tab-stack-on-blur';
import type { AccountsStackParamList, TabParamList } from '@kiko/navigation/types';

// Mounts a tab only once it is first focused and keeps it mounted after, as
// the native bottom tabs do, on the real TabRouter.
const LazyTabs: FC<{ children: ReactNode; initialRouteName?: string }> = ({
  children,
  initialRouteName,
}) => {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
    children,
    initialRouteName,
  });
  const focusedKey = state.routes[state.index]?.key ?? '';
  const [loadedKeys, setLoadedKeys] = useState([focusedKey]);

  if (!loadedKeys.includes(focusedKey)) {
    setLoadedKeys([...loadedKeys, focusedKey]);
  }

  return (
    <NavigationContent>
      {state.routes
        .filter((route) => loadedKeys.includes(route.key))
        .map((route) => (
          <View key={route.key} style={route.key === focusedKey ? undefined : { display: 'none' }}>
            {descriptors[route.key]?.render()}
          </View>
        ))}
    </NavigationContent>
  );
};

const Tabs = createNavigatorFactory(LazyTabs)();
const AccountsStack = createNativeStackNavigator<AccountsStackParamList>();

type AccountsScreen<Name extends keyof AccountsStackParamList> = FC<
  NativeStackScreenProps<AccountsStackParamList, Name>
>;

const ParamsStub: AccountsScreen<keyof AccountsStackParamList> = ({ route }) => {
  return <Text testID={`screen-${route.name}`}>{JSON.stringify(route.params ?? {})}</Text>;
};

const HomeTab: FC = () => {
  return <Text testID="screen-Home">home</Text>;
};

/**
 * Renders Home and Accounts tabs on the real routers, Home first. The Accounts
 * stack registers exactly the screens named, in that order, each a stub.
 */
export const renderRealTabs = (accountsScreens: readonly (keyof AccountsStackParamList)[]) => {
  const AccountsTab: FC = () => {
    return (
      <AccountsStack.Navigator screenListeners={resetTabStackOnBlur}>
        {accountsScreens.map((name) => (
          <AccountsStack.Screen key={name} name={name} component={ParamsStub} />
        ))}
      </AccountsStack.Navigator>
    );
  };

  return render(
    <NavigationContainer ref={navigationRef}>
      <Tabs.Navigator initialRouteName="HomeTab">
        <Tabs.Screen name="HomeTab" component={HomeTab} />

        <Tabs.Screen name="AccountsTab" component={AccountsTab} />
      </Tabs.Navigator>
    </NavigationContainer>,
  );
};

type StackRoute = { key: string; name: string; params?: object };

export const focusedTab = (): keyof TabParamList | undefined => {
  const state = navigationRef.getRootState();

  return state?.routes[state.index]?.name as keyof TabParamList | undefined;
};

export const accountsStack = (): StackRoute[] => {
  const tabs = navigationRef.getRootState()?.routes ?? [];
  const accountsTab = tabs.find(({ name }) => name === 'AccountsTab');

  return (accountsTab?.state?.routes ?? []) as StackRoute[];
};

export const onStack = (name: string, params?: object) =>
  expect.objectContaining(params === undefined ? { name } : { name, params });
