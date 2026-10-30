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
import type { LayoutMode } from '@kiko/display-regions';
import { act, render, waitFor } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import HomeStack from '../home-stack';
import AccountsStack from '../accounts-stack';
import SettingsStack from '../settings-stack';
import StatisticsStack from '../statistics-stack';
import { openAccountForm } from '../open-account-form';

// The layout mode a test can change, as the native module reports it: through a subscription.
const mockLayout = { mode: 'columns' as LayoutMode, listeners: new Set<() => void>() };

jest.mock('@kiko/display-regions', () => {
  const { useSyncExternalStore } = require('react');

  return {
    ...jest.requireActual('@kiko/display-regions'),
    useLayoutMode: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockLayout.listeners.add(listener);

          return () => mockLayout.listeners.delete(listener);
        },
        () => mockLayout.mode,
      ),
    useFoldRegion: () => null,
  };
});

type Navigation = Record<string, (...args: unknown[]) => unknown>;
type CapturedViewProps = {
  descriptors: Record<string, { navigation: Navigation }>;
  state: { routes: { key: string; name: string }[] };
};

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

type Step = { name: string; params?: object };

type StackBase = {
  name: string;
  Stack: ComponentType;
  target: string;
  // The pane every step above the list takes, defaults included.
  detailPane: 'companion' | 'primary';
  // Two steps, the second opened from the first.
  walk: [Step, Step];
};

type StackWithDefault = StackBase & {
  // The route keys the stack stands in as a default, and where a screen it opens lands.
  defaults: string[];
  // The screen the stack stands in as its default, which becomes a real route once a step is
  // opened from it.
  defaultScreen: string;
};

type StackWithoutDefault = StackBase & { defaults: []; defaultScreen?: undefined };

type StackCase = StackWithDefault | StackWithoutDefault;

const hasDefault = (stack: StackCase): stack is StackWithDefault => stack.defaults.length > 0;

const STACKS: StackCase[] = [
  {
    name: 'Home',
    Stack: HomeStack,
    defaults: ['pane-default:companion'],
    defaultScreen: 'Statistics',
    target: 'TransactionForm',
    detailPane: 'companion',
    walk: [
      { name: 'TransactionForm', params: { transactionId: 't1' } },
      { name: 'HoldingForm', params: {} },
    ],
  },
  {
    name: 'Statistics',
    Stack: StatisticsStack,
    defaults: ['pane-default:companion'],
    defaultScreen: 'Home',
    target: 'TransactionForm',
    detailPane: 'companion',
    walk: [
      { name: 'TransactionForm', params: { transactionId: 't1' } },
      { name: 'HoldingForm', params: {} },
    ],
  },
  {
    name: 'Accounts',
    Stack: AccountsStack,
    defaults: [],
    target: 'AccountDetail',
    detailPane: 'primary',
    walk: [
      { name: 'AccountDetail', params: { accountId: 'a', name: 'Monobank', kind: 'bank' } },
      { name: 'HoldingDetail', params: { holdingId: 'h', name: 'Wallet' } },
    ],
  },
  {
    name: 'Settings',
    Stack: SettingsStack,
    defaults: ['pane-default:primary'],
    defaultScreen: 'Categories',
    target: 'System',
    detailPane: 'primary',
    walk: [{ name: 'Help' }, { name: 'HelpTopic', params: { topicId: 'addAccount' } }],
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

describe.each(STACKS)('the $name stack in two panes', ({ Stack, defaults, target, detailPane }) => {
  beforeEach(async () => {
    await renderStack(Stack);
  });

  it('shows a default only where its config names one', () => {
    expect(Object.keys(defaultNavigations())).toEqual(defaults);
  });

  it('shows a default in the detail pane, never in the list pane', () => {
    expect(
      Object.keys(defaultNavigations()).every((key) => key === `pane-default:${detailPane}`),
    ).toBe(true);
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

  it('opens what a default screen navigates to in the detail pane, where the default is', async () => {
    for (const navigation of Object.values(defaultNavigations())) {
      await act(async () => {
        navigation.navigate(target, { id: 'x' });
      });

      const { routes, panes } = stackState();
      const opened = routes.at(-1);

      expect(opened?.name).toBe(target);
      expect(opened?.isDefault).toBeUndefined();
      expect(panes[opened?.key ?? '']).toBe(detailPane);
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
  // which is safe only while that object is none of a real route's. Identity says little (a
  // helper the real object lost to the stand-in could still be a different function), so this
  // pins what the opened route's own navigation does: its helpers act on the stack and its
  // options reach the screen, where the stand-in makes both a no-op.
  it('PINS React Navigation: a route made after the stand-in has a navigation of its own', async () => {
    for (const standIn of Object.values(defaultNavigations())) {
      await act(async () => {
        standIn.navigate(target, { id: 'x' });
      });

      const opened = stackState().routes.at(-1);
      const descriptorOf = () =>
        mockCapturedViews
          .flatMap(({ descriptors }) => Object.entries(descriptors))
          .filter(([key]) => key === opened?.key)
          .at(-1)?.[1] as { navigation: Navigation; options: { title?: string } } | undefined;
      const own = descriptorOf()?.navigation;

      expect(own).toBeDefined();
      expect(own).not.toBe(standIn);

      await act(async () => {
        own?.setOptions({ title: 'set by the opened route' });
      });

      expect(descriptorOf()?.options.title).toBe('set by the opened route');

      await act(async () => {
        own?.goBack();
      });

      expect(stackState().routes.map((route) => route.key)).not.toContain(opened?.key);
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

// The window settles on one pane and back, as it does when the device folds and unfolds; the
// navigator folds and unfolds itself (usePaneFold) once the mode has settled.
const settleTo = async (mode: LayoutMode): Promise<void> => {
  await act(async () => {
    mockLayout.mode = mode;

    for (const listener of mockLayout.listeners) {
      listener();
    }
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
};

// The routes each pane was last given, by name: the slice that holds the root is the list pane's,
// the other one is the detail pane's. Read it while the window shows two panes.
const renderedPanes = (rootKey: string) => {
  const slices = [...mockCapturedViews].reverse();
  const namesOf = (slice: CapturedViewProps | undefined) =>
    slice?.state.routes.map((route) => route.name);
  const holdsRoot = ({ state }: CapturedViewProps) =>
    state.routes.some((route) => route.key === rootKey);

  return {
    list: namesOf(slices.find(holdsRoot)),
    detail: namesOf(slices.find((slice) => !holdsRoot(slice))),
  };
};

// A fold and an unfold wait for the window to settle, which takes timers the test controls.
const useSettlingTimers = (): void => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLayout.mode = 'columns';
  });

  afterEach(() => {
    jest.useRealTimers();
    mockLayout.mode = 'columns';
  });
};

// The list never moves: every step above the root is in the detail pane, whoever opened it, and
// a fold and an unfold put each of them back where it was.
describe.each(STACKS)('the $name stack: only the root is in the list pane', ({ Stack, walk }) => {
  const [first, second] = walk;
  const rootKey = () => stackState().routes[0].key;
  const rootName = () => stackState().routes[0].name;
  const detail = [first.name, second.name];

  const open = async (openerKey: string, step: Step) => {
    await act(async () => {
      navigationRef.dispatch({ type: 'PANE_OPEN', payload: { openerKey, route: step } });
    });
  };

  const ownNavigation = (key: string): Navigation | undefined =>
    [...mockCapturedViews]
      .reverse()
      .map(({ descriptors }) => descriptors[key]?.navigation)
      .find((navigation) => navigation !== undefined);

  const expectDetailPaneHoldsTheSteps = async () => {
    expect(renderedPanes(rootKey())).toEqual({ list: [rootName()], detail });

    await settleTo('single');

    expect(stackState().routes.map((route) => route.name)).toEqual([rootName(), ...detail]);

    await settleTo('columns');

    expect(renderedPanes(rootKey())).toEqual({ list: [rootName()], detail });
  };

  useSettlingTimers();

  beforeEach(async () => {
    await renderStack(Stack);
  });

  it('puts a step opened from the list, and the one opened from it, in the detail pane', async () => {
    await open(rootKey(), first);
    await open(stackState().routes.at(-1)?.key ?? '', second);

    await expectDetailPaneHoldsTheSteps();
  });

  // A screen that asks its own navigation for the next one is not opened through `openFrom`.
  it('puts what the page asks its own navigation for in the detail pane', async () => {
    await open(rootKey(), first);
    await act(async () => {
      ownNavigation(stackState().routes.at(-1)?.key ?? '')?.navigate(second.name, second.params);
    });

    await expectDetailPaneHoldsTheSteps();
  });

  it('puts what a navigate with no source asks for in the detail pane', async () => {
    await open(rootKey(), first);
    await act(async () => {
      navigationRef.navigate(second.name, second.params);
    });

    await expectDetailPaneHoldsTheSteps();
  });

  it('puts a second tap in the list in the detail pane, in place of the steps', async () => {
    await open(rootKey(), first);
    await open(stackState().routes.at(-1)?.key ?? '', second);
    await open(rootKey(), first);

    expect(renderedPanes(rootKey())).toEqual({ list: [rootName()], detail: [first.name] });
  });
});

// The list closes an account's page when the account is deleted: a step opened from that page
// goes with it, as it would be left in the pane with nothing to go back to.
describe('the Accounts stack: closing an account page', () => {
  const open = async (openerKey: string, step: Step) => {
    await act(async () => {
      navigationRef.dispatch({ type: 'PANE_OPEN', payload: { openerKey, route: step } });
    });
  };

  beforeEach(async () => {
    await renderStack(AccountsStack);
  });

  it('closes the steps opened from the page with it', async () => {
    await open(stackState().routes[0].key, {
      name: 'AccountDetail',
      params: { accountId: 'a', name: 'Monobank', kind: 'bank' },
    });
    await open(stackState().routes.at(-1)?.key ?? '', {
      name: 'ReminderForm',
      params: { accountId: 'a' },
    });

    expect(stackState().routes.map((route) => route.name)).toEqual([
      'Accounts',
      'AccountDetail',
      'ReminderForm',
    ]);

    const pageKey = stackState().routes[1].key;

    await act(async () => {
      navigationRef.dispatch({ type: 'PANE_CLOSE', payload: { routeKey: pageKey } });
    });

    expect(stackState().routes.map((route) => route.name)).toEqual(['Accounts']);
  });
});

describe.each(STACKS.filter(hasDefault))(
  'the $name stack: the steps above its default',
  ({ Stack, walk, defaultScreen }) => {
    const [first, second] = walk;

    beforeEach(async () => {
      await renderStack(Stack);
    });

    it('puts the default as a real route, the screen it opens, and the one opened from it, in the detail pane', async () => {
      await act(async () => {
        Object.values(defaultNavigations())[0].navigate(first.name, first.params);
      });

      const firstKey = stackState().routes.at(-1)?.key ?? '';
      const rootKey = stackState().routes[0].key;

      await act(async () => {
        const own = [...mockCapturedViews]
          .reverse()
          .map(({ descriptors }) => descriptors[firstKey]?.navigation)
          .find((navigation) => navigation !== undefined);

        own?.navigate(second.name, second.params);
      });

      expect(renderedPanes(rootKey)).toEqual({
        list: [stackState().routes[0].name],
        detail: [defaultScreen, first.name, second.name],
      });
    });
  },
);

// A reminder tap rebuilds the Accounts stack with one navigate that carries the whole state, so
// no pane is stored and no `openFrom` runs: the position in the stack is all the router has.
describe('the Accounts stack rebuilt by a reminder tap', () => {
  const nestedState = () =>
    (
      navigationRef.getRootState() as unknown as {
        routes: { state?: { routes: { key: string }[]; panes: Record<string, string> } }[];
      }
    ).routes[0].state;

  beforeEach(async () => {
    mockCapturedViews.length = 0;

    await render(
      <NavigationContainer ref={navigationRef}>
        <Tabs.Navigator>
          <Tabs.Screen name="AccountsTab" component={AccountsStack} />
        </Tabs.Navigator>
      </NavigationContainer>,
    );
    await waitFor(() => expect(navigationRef.isReady()).toBe(true));
  });

  it('puts the account page and the screen above it in the detail pane', async () => {
    const routes = [
      { name: 'Accounts' },
      { name: 'AccountDetail', params: { accountId: 'a', name: 'Monobank', kind: 'bank' } },
      { name: 'TransactionForm', params: { holdingId: 'h' } },
    ];

    await act(async () => {
      navigationRef.navigate('AccountsTab', { state: { routes, index: routes.length - 1 } });
    });

    expect(nestedState()?.panes).toEqual({});
    expect(renderedPanes(nestedState()?.routes[0].key ?? '')).toEqual({
      list: ['Accounts'],
      detail: ['AccountDetail', 'TransactionForm'],
    });
  });
});

// A page the user opened keeps its pane through a fold and an unfold; the pane assignment tests
// pin the rule, and this is the Settings stack it is for: Help and the topic opened from it, both
// in the detail pane.
describe('the Settings stack across a fold and an unfold', () => {
  const panesOfRoutes = () => {
    const { routes, panes } = stackState();

    return routes.map((route) => [route.name, panes[route.key]]);
  };

  useSettlingTimers();

  it('keeps Help and the topic opened from it where they were', async () => {
    await renderStack(SettingsStack);
    await act(async () => {
      navigationRef.navigate('Help');
    });
    await act(async () => {
      navigationRef.navigate('HelpTopic', { topicId: 'addAccount' });
    });

    await settleTo('single');

    expect(stackState().routes.map((route) => route.name)).toEqual([
      'Settings',
      'Help',
      'HelpTopic',
    ]);

    await settleTo('columns');

    expect(panesOfRoutes()).toEqual([
      ['Settings', 'companion'],
      ['Help', 'primary'],
      ['HelpTopic', 'primary'],
    ]);
  });

  it('shows Categories again once Help is closed', async () => {
    await renderStack(SettingsStack);
    await act(async () => {
      navigationRef.navigate('Help');
    });
    await act(async () => {
      navigationRef.goBack();
    });

    expect(stackState().routes.map((route) => route.name)).toEqual(['Settings']);
    expect(Object.keys(defaultNavigations())).toEqual(['pane-default:primary']);
  });
});

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
