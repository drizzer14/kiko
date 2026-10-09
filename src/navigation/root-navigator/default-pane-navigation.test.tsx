import {
  CommonActions,
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
  StackActions,
} from '@react-navigation/native';
import type { ComponentType } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import HomeStack from '../home-stack';
import AccountsStack from '../accounts-stack';
import SettingsStack from '../settings-stack';
import StatisticsStack from '../statistics-stack';

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
