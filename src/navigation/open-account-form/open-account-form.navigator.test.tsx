// `openAccountForm` on the REAL React Navigation routers: a spy cannot show
// which screens end up on the Accounts stack when the tab was never visited,
// or is deep in a stack.
import {
  createNavigatorFactory,
  NavigationContainer,
  type NavigationProp,
  TabRouter,
  useNavigationBuilder,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import { type FC, type ReactNode, useState } from 'react';
import { act, render } from '@testing-library/react-native';
import { navigationRef } from '@kiko/navigation/navigation-ref';
import { resetTabStackOnBlur } from '@kiko/navigation/reset-tab-stack-on-blur';
import type { AccountsStackParamList, TabParamList } from '@kiko/navigation/types';

import '@kiko/design-system/unistyles';

import { openAccountForm } from '.';

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

const AccountsTab: FC = () => {
  return (
    <AccountsStack.Navigator screenListeners={resetTabStackOnBlur}>
      <AccountsStack.Screen name="Accounts" component={ParamsStub} />

      <AccountsStack.Screen name="AccountDetail" component={ParamsStub} />

      <AccountsStack.Screen name="AccountForm" component={ParamsStub} />
    </AccountsStack.Navigator>
  );
};

const HomeTab: FC = () => {
  return <Text testID="screen-Home">home</Text>;
};

const renderApp = () =>
  render(
    <NavigationContainer ref={navigationRef}>
      <Tabs.Navigator initialRouteName="HomeTab">
        <Tabs.Screen name="HomeTab" component={HomeTab} />

        <Tabs.Screen name="AccountsTab" component={AccountsTab} />
      </Tabs.Navigator>
    </NavigationContainer>,
  );

type StackRoute = { key: string; name: string; params?: object };

const focusedTab = (): keyof TabParamList | undefined => {
  const state = navigationRef.getRootState();

  return state?.routes[state.index]?.name as keyof TabParamList | undefined;
};

const accountsStack = (): StackRoute[] => {
  const tabs = navigationRef.getRootState()?.routes ?? [];
  const accountsTab = tabs.find(({ name }) => name === 'AccountsTab');

  return (accountsTab?.state?.routes ?? []) as StackRoute[];
};

const onStack = (name: string, params?: object) =>
  expect.objectContaining(params === undefined ? { name } : { name, params });

// A screen holds the tab navigator's prop; the container ref is the same
// router's object, typed with a looser `routeNames`.
const tabNavigation = navigationRef as unknown as NavigationProp<TabParamList>;

const open = async (): Promise<void> => {
  await act(async () => {
    openAccountForm(tabNavigation);
  });
};

const openAccount = async (accountId: string, name: string): Promise<void> => {
  await act(async () => {
    navigationRef.navigate('AccountsTab', {
      screen: 'AccountDetail',
      params: { accountId, name },
      initial: false,
    });
  });
};

const goBack = async (): Promise<void> => {
  await act(async () => {
    navigationRef.goBack();
  });
};

describe('openAccountForm (real router)', () => {
  it('opens the form above the Accounts root when the Accounts tab was never visited', async () => {
    await renderApp();
    expect(accountsStack()).toEqual([]);

    await open();

    expect(focusedTab()).toBe('AccountsTab');
    expect(accountsStack()).toEqual([onStack('Accounts'), onStack('AccountForm', {})]);

    await goBack();

    expect(accountsStack()).toEqual([onStack('Accounts')]);
  });

  it('keeps the page the Accounts tab shows and puts the form above it', async () => {
    await renderApp();
    await openAccount('bank', 'Mono');
    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'bank', name: 'Mono' }),
    ]);

    await open();

    expect(focusedTab()).toBe('AccountsTab');
    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'bank', name: 'Mono' }),
      onStack('AccountForm', {}),
    ]);

    await goBack();

    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'bank', name: 'Mono' }),
    ]);
  });

  it('navigates once, naming the form screen', async () => {
    await renderApp();
    const navigate = jest.spyOn(navigationRef, 'navigate');

    await open();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('AccountsTab', {
      screen: 'AccountForm',
      params: {},
      initial: false,
    });
    navigate.mockRestore();
  });
});
