import {
  CommonActions,
  createNavigationContainerRef,
  createNavigatorFactory,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { View } from 'react-native';
import { type FC, useEffect } from 'react';
import LazyTabs from '@kiko/test-support/lazy-tabs';
import { act, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import HomeStack from '../home-stack';
import { SETTLE_DELAY_MS } from '../pane-stack';
import StatisticsStack from '../statistics-stack';
import type { TransactionFormParams } from '../types';

// The window as the native module reports it: a large flag a test changes, and the columns mode
// every window in these tests has (a full-screen iPad and a split-view window both split in two).
const mockWindow = { isLarge: false, listeners: new Set<() => void>() };

jest.mock('@kiko/display-regions', () => {
  const { useSyncExternalStore } = require('react');

  return {
    ...jest.requireActual('@kiko/display-regions'),
    useLayoutMode: () => 'columns',
    useFoldRegion: () => null,
    useIsLargeWindow: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockWindow.listeners.add(listener);

          return () => mockWindow.listeners.delete(listener);
        },
        () => mockWindow.isLarge,
      ),
  };
});

type ShownRoute = { key: string; name: string };

// A native stack that renders nothing but records the routes each pane is handed: the screens
// inside are not under test, the routes are.
const mockShownRoutes: ShownRoute[] = [];
jest.mock('@react-navigation/native-stack', () => ({
  ...jest.requireActual('@react-navigation/native-stack'),
  NativeStackView: ({ state }: { state: { routes: ShownRoute[] } }) => {
    for (const { key, name } of state.routes) {
      mockShownRoutes.push({ key, name });
    }

    return null;
  },
}));

const setLargeWindow = async (isLarge: boolean): Promise<void> => {
  await act(async () => {
    mockWindow.isLarge = isLarge;

    for (const listener of mockWindow.listeners) {
      listener();
    }
  });
};

const elapse = async (milliseconds: number): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
};

const settle = (): Promise<void> => elapse(SETTLE_DELAY_MS);

// The key a pane navigator gives the default of an empty companion pane.
const COMPANION_DEFAULT_KEY = 'pane-default:companion';

const Tabs = createNavigatorFactory(LazyTabs)();
const navigationRef = createNavigationContainerRef<ParamListBase>();
const mountedHomeStacks = jest.fn();

const CountedHomeStack: FC = () => {
  useEffect(() => {
    mountedHomeStacks();
  }, []);

  return <HomeStack />;
};

const AccountsStub: FC = () => <View />;

const renderTabs = async (initialRouteName: 'HomeTab' | 'StatisticsTab'): Promise<void> => {
  await render(
    <NavigationContainer ref={navigationRef}>
      <Tabs.Navigator initialRouteName={initialRouteName}>
        <Tabs.Screen name="HomeTab" component={CountedHomeStack} />

        <Tabs.Screen name="AccountsTab" component={AccountsStub} />

        <Tabs.Screen name="StatisticsTab" component={StatisticsStack} />
      </Tabs.Navigator>
    </NavigationContainer>,
  );
};

type StackRoute = { key: string; name: string; params?: object; isDefault?: boolean };
type StackState = {
  key: string;
  routes: StackRoute[];
  panes: Record<string, string | undefined>;
};

const focusedTab = (): string | undefined => {
  const state = navigationRef.getRootState();

  return state?.routes[state.index]?.name;
};

const stackOf = (tab: string): StackState | undefined =>
  navigationRef.getRootState()?.routes.find(({ name }) => name === tab)?.state as
    | StackState
    | undefined;

// What `useOpenInPane` dispatches from a screen of the stack: the screen opens in the detail pane,
// above the route on top. The pane navigator's own action, because the screens inside are not
// rendered here to call the hook.
const openIn = async (tab: string, screen: string, params: object): Promise<void> => {
  const stack = stackOf(tab);
  const opener = stack?.routes.at(-1);

  await act(async () => {
    navigationRef.dispatch({
      type: 'PANE_OPEN',
      payload: { openerKey: opener?.key, route: { name: screen, params } },
      target: stack?.key,
    });
  });
};

const goToTab = async (tab: string): Promise<void> => {
  await act(async () => {
    navigationRef.dispatch(CommonActions.navigate(tab));
  });
};

const typedForm: TransactionFormParams = {
  transactionId: 't1',
  draft: {
    primaryHoldingId: 'h1',
    mode: 'expense',
    amount: '12.50',
    description: 'half typed',
    changeReturns: [],
    valueIn: '',
    destinationHoldingId: null,
    converting: false,
    counterpartHoldingId: null,
    counterpartAmount: '',
    time: 1760000000000,
    selectedCategory: null,
    userPickedCategory: false,
    prefilledLabel: null,
    saveAsTemplate: false,
    templateName: '',
    tab: 'manual',
    pickedTemplateId: null,
  },
};

describe('the Statistics tab when the window turns into a merged Home', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockWindow.isLarge = false;
    mountedHomeStacks.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('at the Statistics root', () => {
    beforeEach(async () => {
      await renderTabs('StatisticsTab');
    });

    it('stays on the Statistics tab while the window is not large', async () => {
      await settle();

      expect(focusedTab()).toBe('StatisticsTab');
    });

    it('stays on the Statistics tab until the large window has lasted the settle delay', async () => {
      await setLargeWindow(true);
      await elapse(SETTLE_DELAY_MS - 1);

      expect(focusedTab()).toBe('StatisticsTab');
    });

    it('moves to the Home tab once the large window has lasted the settle delay', async () => {
      await setLargeWindow(true);
      await settle();

      expect(focusedTab()).toBe('HomeTab');
    });

    it('shows Home in the primary pane and Statistics in the companion on the Home tab', async () => {
      await setLargeWindow(true);
      mockShownRoutes.length = 0;
      await settle();

      const home = stackOf('HomeTab');
      const root = home?.routes.find(({ name }) => name === 'Home');

      expect(home?.routes.map(({ name }) => name)).toEqual(['Home']);
      expect(mockShownRoutes).toContainEqual({ key: root?.key, name: 'Home' });
      expect(mockShownRoutes).toContainEqual({ key: COMPANION_DEFAULT_KEY, name: 'Statistics' });
    });

    it('does not move for a large window that is gone within the settle delay', async () => {
      await setLargeWindow(true);
      await elapse(SETTLE_DELAY_MS - 1);
      await setLargeWindow(false);
      await elapse(SETTLE_DELAY_MS * 2);

      expect(focusedTab()).toBe('StatisticsTab');
    });
  });

  describe('with a form opened from the Home companion of a split-view window', () => {
    beforeEach(async () => {
      await renderTabs('StatisticsTab');
      await openIn('StatisticsTab', 'TransactionForm', typedForm);
    });

    it('holds the form on the Statistics stack before the window turns large', () => {
      expect(stackOf('StatisticsTab')?.routes.map(({ name }) => name)).toContain('TransactionForm');
    });

    it('carries the form and its draft to the Home tab, with the params it had', async () => {
      await setLargeWindow(true);
      await settle();

      const form = stackOf('HomeTab')?.routes.find(({ name }) => name === 'TransactionForm');

      expect(focusedTab()).toBe('HomeTab');
      expect(form?.params).toEqual(typedForm);
    });

    it('opens the carried form in the companion pane of the Home stack, above its root', async () => {
      await setLargeWindow(true);
      await settle();

      const home = stackOf('HomeTab');
      const form = home?.routes.find(({ name }) => name === 'TransactionForm');

      expect(home?.routes.map(({ name }) => name)).toEqual(['Home', 'TransactionForm']);
      expect(home?.panes[form?.key ?? '']).toBe('companion');
    });

    it('carries a form opened from the carried form, after it and with its params', async () => {
      const holdingForm = { accountId: 'account-1' };

      await openIn('StatisticsTab', 'HoldingForm', holdingForm);
      await setLargeWindow(true);
      await settle();

      const carried = stackOf('HomeTab')?.routes.filter(({ name }) =>
        ['TransactionForm', 'HoldingForm'].includes(name),
      );

      expect(carried?.map(({ name, params }) => [name, params])).toEqual([
        ['TransactionForm', typedForm],
        ['HoldingForm', holdingForm],
      ]);
    });

    it('carries nothing before the large window has lasted the settle delay', async () => {
      await setLargeWindow(true);
      await elapse(SETTLE_DELAY_MS - 1);

      expect(stackOf('HomeTab')).toBeUndefined();
    });
  });

  describe('on a tab other than Statistics', () => {
    it('stays on the Accounts tab when a Statistics tab that was visited turns merged', async () => {
      await renderTabs('StatisticsTab');
      await goToTab('AccountsTab');
      await setLargeWindow(true);
      await settle();

      expect(focusedTab()).toBe('AccountsTab');
    });

    it('leaves the Statistics tab when it is navigated to while merged, after it mounted', async () => {
      await renderTabs('StatisticsTab');
      await goToTab('AccountsTab');
      await setLargeWindow(true);
      await settle();
      await goToTab('StatisticsTab');
      await settle();

      expect(focusedTab()).toBe('HomeTab');
    });
  });

  describe('a Home tab with a form open, when the window stops being large', () => {
    beforeEach(async () => {
      mockWindow.isLarge = true;
      await renderTabs('HomeTab');
      await openIn('HomeTab', 'TransactionForm', typedForm);
    });

    it('stays on the Home tab with the same form route and the params it had', async () => {
      const before = stackOf('HomeTab')?.routes.find(({ name }) => name === 'TransactionForm');

      await setLargeWindow(false);
      await settle();

      const after = stackOf('HomeTab')?.routes.find(({ name }) => name === 'TransactionForm');

      expect(focusedTab()).toBe('HomeTab');
      expect(before).toBeDefined();
      expect(after?.key).toBe(before?.key);
      expect(after?.params).toEqual(typedForm);
    });

    it('mounts the Home stack once', async () => {
      await setLargeWindow(false);
      await settle();

      expect(mountedHomeStacks).toHaveBeenCalledTimes(1);
    });
  });
});
