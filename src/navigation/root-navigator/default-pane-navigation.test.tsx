import {
  CommonActions,
  createNavigationContainerRef,
  createNavigatorFactory,
  NavigationContainer,
  type ParamListBase,
  StackActions,
  TabRouter,
  useNavigationBuilder,
} from '@react-navigation/native';
import { View } from 'react-native';
import type { ComponentType, ReactNode } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import HomeStack from '../home-stack';
import AccountsStack from '../accounts-stack';
import SettingsStack from '../settings-stack';
import StatisticsStack from '../statistics-stack';
import { openAccountForm } from '../open-account-form';

jest.mock('@kiko/display-regions', () => ({
  ...jest.requireActual('@kiko/display-regions'),
  useLayoutMode: () => 'columns',
  useFoldRegion: () => null,
}));

type Navigation = Record<string, (...args: unknown[]) => unknown>;
type CapturedViewProps = { descriptors: Record<string, { navigation: Navigation }> };

// A native stack that only records what the navigator hands it: the default screen's navigation
// is the descriptor's own, the one the screen is rendered with.
const mockCapturedViews: CapturedViewProps[] = [];
jest.mock('@react-navigation/native-stack', () => ({
  ...jest.requireActual('@react-navigation/native-stack'),
  NativeStackView: (props: CapturedViewProps) => {
    mockCapturedViews.push(props);

    return null;
  },
}));

type StackCase = {
  name: string;
  Stack: ComponentType;
  // The route keys the stack stands in as a default, and where a screen it opens lands.
  defaults: string[];
  target: string;
  opensIn: 'companion' | 'primary';
};

const STACKS: StackCase[] = [
  {
    name: 'Home',
    Stack: HomeStack,
    defaults: ['pane-default:companion'],
    target: 'TransactionForm',
    opensIn: 'primary',
  },
  {
    name: 'Statistics',
    Stack: StatisticsStack,
    defaults: ['pane-default:companion'],
    target: 'TransactionForm',
    opensIn: 'primary',
  },
  {
    name: 'Accounts',
    Stack: AccountsStack,
    defaults: [],
    target: 'AccountDetail',
    opensIn: 'primary',
  },
  {
    name: 'Settings',
    Stack: SettingsStack,
    defaults: ['pane-default:primary'],
    target: 'System',
    opensIn: 'companion',
  },
];

const navigationRef = createNavigationContainerRef<ParamListBase>();

const renderStack = async (Stack: ComponentType): Promise<void> => {
  mockCapturedViews.length = 0;

  await render(
    <NavigationContainer ref={navigationRef}>
      <Stack />
    </NavigationContainer>,
  );
  await waitFor(() => expect(navigationRef.isReady()).toBe(true));
};

const defaultNavigations = (): Record<string, Navigation> =>
  Object.fromEntries(
    mockCapturedViews
      .flatMap(({ descriptors }) => Object.entries(descriptors))
      .filter(([key]) => key.startsWith('pane-default:'))
      .map(([key, descriptor]) => [key, descriptor.navigation]),
  );

const stackState = () =>
  navigationRef.getRootState() as unknown as {
    routes: { key: string; name: string; isDefault?: boolean }[];
    panes: Record<string, string | undefined>;
  };

describe.each(STACKS)('the $name stack in two panes', ({ Stack, defaults, target, opensIn }) => {
  beforeEach(async () => {
    await renderStack(Stack);
  });

  it('shows a default only where its config names one', () => {
    expect(Object.keys(defaultNavigations())).toEqual(defaults);
  });

  it('INVARIANT: no navigation call from a default screen throws', async () => {
    for (const navigation of Object.values(defaultNavigations())) {
      for (const call of [
        () => navigation.navigate(target, { id: 'x' }),
        () => navigation.push(target),
        () => navigation.replace(target),
        () => navigation.goBack(),
        () => navigation.pop(),
        () => navigation.popToTop(),
        () => navigation.popTo(target),
        () => navigation.setParams({ id: 'x' }),
        () => navigation.setOptions({ title: 'x' }),
        () => navigation.dispatch(CommonActions.navigate(target)),
        () => navigation.dispatch(StackActions.push(target)),
        () => navigation.dispatch(CommonActions.goBack()),
        () => navigation.dispatch((state: unknown) => CommonActions.setParams({ state })),
      ]) {
        await act(async () => {
          call();
        });
      }

      expect(navigation.isFocused()).toBe(false);
      expect(() => navigation.addListener('focus', jest.fn())).not.toThrow();
    }
  });

  it('opens what a default screen navigates to in the pane opposite the default', async () => {
    for (const navigation of Object.values(defaultNavigations())) {
      await act(async () => {
        navigation.navigate(target, { id: 'x' });
      });

      const { routes, panes } = stackState();
      const opened = routes.at(-1);

      expect(opened?.name).toBe(target);
      expect(opened?.isDefault).toBeUndefined();
      expect(panes[opened?.key ?? '']).toBe(opensIn);
      expect(routes.filter((route) => route.isDefault === true)).toEqual([]);
    }
  });

  it('opens the same screen from a push or a dispatched navigate too', async () => {
    for (const navigation of Object.values(defaultNavigations())) {
      await act(async () => {
        navigation.push(target);
      });

      expect(stackState().routes.at(-1)?.name).toBe(target);

      await act(async () => {
        navigation.dispatch(CommonActions.navigate(target, { id: 'y' }));
      });

      expect(stackState().routes.filter((route) => route.name === target)).toHaveLength(1);
    }
  });

  // The stand-in changes the navigation object React Navigation made for the default in place,
  // which is safe only while that object is none of a real route's.
  it('PINS React Navigation: a route made after the stand-in has a navigation of its own', async () => {
    for (const standIn of Object.values(defaultNavigations())) {
      await act(async () => {
        standIn.navigate(target, { id: 'x' });
      });

      const opened = stackState().routes.at(-1);
      const own = mockCapturedViews
        .flatMap(({ descriptors }) => Object.entries(descriptors))
        .filter(([key]) => key === opened?.key)
        .at(-1)?.[1].navigation;

      expect(own).toBeDefined();
      expect(own).not.toBe(standIn);
      expect(own?.navigate).not.toBe(standIn.navigate);
      expect(own?.dispatch).not.toBe(standIn.dispatch);
    }
  });

  it('leaves the stack alone for going back, popping and options', async () => {
    const before = stackState().routes.map((route) => route.key);

    for (const navigation of Object.values(defaultNavigations())) {
      await act(async () => {
        navigation.goBack();
        navigation.pop();
        navigation.popToTop();
        navigation.setOptions({ title: 'x' });
      });
    }

    expect(stackState().routes.map((route) => route.key)).toEqual(before);
  });
});

// Every tab stays mounted, as the native bottom tabs keep them.
const TabNavigator = ({ children }: { children: ReactNode }) => {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, { children });

  return (
    <NavigationContent>
      {state.routes.map((route) => (
        <View key={route.key}>{descriptors[route.key]?.render()}</View>
      ))}
    </NavigationContent>
  );
};

const Tabs = createNavigatorFactory(TabNavigator)();
const AccountsTab = () => null;

const focusedTab = (): string | undefined => {
  const tabs = navigationRef.getRootState();

  return tabs?.routes[tabs.index]?.name;
};

describe.each(STACKS.filter(({ defaults }) => defaults.length > 0))(
  'the $name stack in two panes under a tab navigator',
  ({ Stack }) => {
    beforeEach(async () => {
      mockCapturedViews.length = 0;

      await render(
        <NavigationContainer ref={navigationRef}>
          <Tabs.Navigator>
            <Tabs.Screen name="StackTab" component={Stack} />

            <Tabs.Screen name="AccountsTab" component={AccountsTab} />
          </Tabs.Navigator>
        </NavigationContainer>,
      );
      await waitFor(() => expect(navigationRef.isReady()).toBe(true));
    });

    it.each([
      [
        'openAccountForm',
        (navigation: Navigation) =>
          openAccountForm(navigation as unknown as Parameters<typeof openAccountForm>[0]),
      ],
      ['a navigate to a tab', (navigation: Navigation) => navigation.navigate('AccountsTab')],
    ])('hands %s from a default screen on to the tab navigator', async (_label, call) => {
      const tabs = navigationRef.getRootState();
      const before = tabs?.routes[0]?.state?.routes.map((route) => route.key);

      expect(focusedTab()).toBe('StackTab');

      for (const navigation of Object.values(defaultNavigations())) {
        await act(async () => {
          navigationRef.navigate('StackTab');
        });
        expect(focusedTab()).toBe('StackTab');

        await act(async () => {
          call(navigation);
        });

        expect(focusedTab()).toBe('AccountsTab');

        expect(
          navigationRef.getRootState()?.routes[0]?.state?.routes.map((route) => route.key),
        ).toEqual(before);
      }
    });
  },
);

describe('two stacks with a default each, as two tabs', () => {
  it('PINS React Navigation: each navigator has a placeholder navigation of its own', async () => {
    mockCapturedViews.length = 0;

    await render(
      <NavigationContainer ref={navigationRef}>
        <Tabs.Navigator>
          <Tabs.Screen name="HomeTab" component={HomeStack} />

          <Tabs.Screen name="StatisticsTab" component={StatisticsStack} />
        </Tabs.Navigator>
      </NavigationContainer>,
    );
    await waitFor(() => expect(navigationRef.isReady()).toBe(true));

    const placeholders = new Set(
      mockCapturedViews
        .map(({ descriptors }) => descriptors['pane-default:companion']?.navigation)
        .filter((navigation) => navigation !== undefined),
    );

    expect(placeholders.size).toBe(2);
  });
});
