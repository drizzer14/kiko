import {
  NavigationContainerRefContext,
  NavigationContext,
  NavigationRouteContext,
} from '@react-navigation/native';
import { reportWindow } from '@kiko/test-support/window-size';
import { act, renderHook } from '@testing-library/react-native';
import type { ContextType, FC, PropsWithChildren } from 'react';

import '@kiko/design-system/unistyles';

import { useLeaveStatisticsTabWhenMerged } from './use-leave-statistics-tab-when-merged';

type FakeRoute = { key?: string; name: string; params?: object };
type FakeStack = { key?: string; routes: FakeRoute[] };
type RootRoute = FakeRoute & { state?: FakeStack };
type RootState = { routes: RootRoute[] };
type Listener = () => void;

const STATISTICS_KEY = 'statistics-tab';

const statisticsRoute = (state?: FakeStack): RootRoute => ({
  key: STATISTICS_KEY,
  name: 'StatisticsTab',
  state,
});

const CARRIED_STACK: FakeStack = {
  key: 'statistics-stack',
  routes: [
    { key: 's0', name: 'Statistics' },
    { key: 's1', name: 'TransactionForm', params: { a: 1 } },
  ],
};

const HOME_STACK: FakeStack = { key: 'home-key', routes: [{ key: 'h0', name: 'Home' }] };

const homeTab = (state?: FakeStack): RootRoute => ({ key: 'home-tab', name: 'HomeTab', state });

const OPEN_IN_HOME = {
  type: 'PANE_OPEN',
  payload: { openerKey: 'h0', route: { name: 'TransactionForm', params: { a: 1 } } },
  target: 'home-key',
};

type Harness = {
  navigation: {
    isFocused: jest.Mock;
    navigate: jest.Mock;
    dispatch: jest.Mock;
    addListener: jest.Mock;
  };
  container: { getRootState: jest.Mock; addListener: jest.Mock };
  unsubscribe: jest.Mock;
  setRoot: (state: RootState | undefined) => void;
  stateListeners: () => Listener[];
};

const buildHarness = (initialRoot: RootState | undefined): Harness => {
  let root = initialRoot;
  const listeners = new Map<string, Set<Listener>>();
  const unsubscribe = jest.fn();
  const container = {
    getRootState: jest.fn(() => root),
    addListener: jest.fn((event: string, listener: Listener) => {
      const forEvent = listeners.get(event) ?? new Set<Listener>();

      forEvent.add(listener);
      listeners.set(event, forEvent);
      unsubscribe.mockImplementation(() => forEvent.delete(listener));

      return unsubscribe;
    }),
  };
  const navigation = {
    isFocused: jest.fn(() => true),
    navigate: jest.fn(),
    dispatch: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  };

  return {
    navigation,
    container,
    unsubscribe,
    setRoot: (state) => {
      root = state;
    },
    stateListeners: () => [...(listeners.get('state') ?? [])],
  };
};

type Provided = { navigation?: boolean; container?: boolean; route?: boolean };

const renderLeave = async (
  harness: Harness,
  { navigation = true, container = true, route = true }: Provided = {},
): Promise<void> => {
  const containerValue = harness.container as unknown as ContextType<
    typeof NavigationContainerRefContext
  >;
  const navigationValue = harness.navigation as unknown as ContextType<typeof NavigationContext>;
  const routeValue = { key: STATISTICS_KEY, name: 'StatisticsTab' } as ContextType<
    typeof NavigationRouteContext
  >;
  const wrapper: FC<PropsWithChildren> = ({ children }) => (
    <NavigationContainerRefContext.Provider value={container ? containerValue : undefined}>
      <NavigationContext.Provider value={navigation ? navigationValue : undefined}>
        <NavigationRouteContext.Provider value={route ? routeValue : undefined}>
          {children}
        </NavigationRouteContext.Provider>
      </NavigationContext.Provider>
    </NavigationContainerRefContext.Provider>
  );

  await renderHook(() => useLeaveStatisticsTabWhenMerged(), { wrapper });
};

const callStateListeners = async (harness: Harness): Promise<void> => {
  await act(async () => {
    for (const listener of harness.stateListeners()) {
      listener();
    }
  });
};

describe('useLeaveStatisticsTabWhenMerged', () => {
  beforeEach(() => {
    reportWindow('regular', 1376, 1032);
  });

  afterAll(() => {
    reportWindow('compact', 390, 844);
  });

  it('leaves for the Home tab once when the Statistics route has no stack state', async () => {
    const harness = buildHarness({ routes: [statisticsRoute()] });

    await renderLeave(harness);

    expect(harness.navigation.navigate).toHaveBeenCalledTimes(1);
    expect(harness.navigation.navigate).toHaveBeenCalledWith('HomeTab');
    expect(harness.navigation.dispatch).not.toHaveBeenCalled();
  });

  it('leaves for the Home tab, carrying nothing, when there is no route context', async () => {
    const harness = buildHarness({ routes: [{ key: 'other', name: 'AccountsTab' }] });

    await renderLeave(harness, { route: false });

    expect(harness.navigation.navigate).toHaveBeenCalledWith('HomeTab');
    expect(harness.navigation.dispatch).not.toHaveBeenCalled();
  });

  it('leaves for the Home tab, carrying nothing, when the container has no state yet', async () => {
    const harness = buildHarness(undefined);

    await renderLeave(harness);

    expect(harness.navigation.navigate).toHaveBeenCalledWith('HomeTab');
    expect(harness.navigation.dispatch).not.toHaveBeenCalled();
  });

  it('does nothing without a navigation context', async () => {
    const harness = buildHarness({ routes: [statisticsRoute(CARRIED_STACK)] });

    await renderLeave(harness, { navigation: false });

    expect(harness.container.addListener).not.toHaveBeenCalled();
    expect(harness.navigation.navigate).not.toHaveBeenCalled();
  });

  it('does nothing without a container', async () => {
    const harness = buildHarness({ routes: [statisticsRoute(CARRIED_STACK)] });

    await renderLeave(harness, { container: false });

    expect(harness.navigation.isFocused).not.toHaveBeenCalled();
    expect(harness.navigation.navigate).not.toHaveBeenCalled();
    expect(harness.navigation.addListener).not.toHaveBeenCalled();
  });

  it('carries the routes above the root into the Home stack once it appears, then stops', async () => {
    const harness = buildHarness({ routes: [homeTab(), statisticsRoute(CARRIED_STACK)] });

    await renderLeave(harness);

    expect(harness.navigation.navigate).toHaveBeenCalledWith('HomeTab');
    expect(harness.navigation.dispatch).not.toHaveBeenCalled();
    expect(harness.container.addListener).toHaveBeenCalledWith('state', expect.any(Function));

    harness.setRoot({ routes: [homeTab(HOME_STACK), statisticsRoute(CARRIED_STACK)] });
    await callStateListeners(harness);

    expect(harness.navigation.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.navigation.dispatch).toHaveBeenCalledWith(OPEN_IN_HOME);
    expect(harness.unsubscribe).toHaveBeenCalled();

    await callStateListeners(harness);

    expect(harness.navigation.dispatch).toHaveBeenCalledTimes(1);
  });

  it('waits for the Home stack without throwing when there is no Home tab at all', async () => {
    const harness = buildHarness({ routes: [statisticsRoute(CARRIED_STACK)] });

    await renderLeave(harness);

    expect(harness.navigation.dispatch).not.toHaveBeenCalled();
    expect(harness.container.addListener).toHaveBeenCalledWith('state', expect.any(Function));
    expect(harness.unsubscribe).not.toHaveBeenCalled();
  });

  it('carries into the Home tab, not into another tab that has a stack', async () => {
    const harness = buildHarness({
      routes: [
        {
          key: 'acc-tab',
          name: 'AccountsTab',
          state: { key: 'acc', routes: [{ key: 'a0', name: 'X' }] },
        },
        homeTab(HOME_STACK),
        statisticsRoute(CARRIED_STACK),
      ],
    });

    await renderLeave(harness);

    expect(harness.navigation.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.navigation.dispatch).toHaveBeenCalledWith(OPEN_IN_HOME);
  });

  it('waits for the Home stack when the container loses its state after the leave', async () => {
    const harness = buildHarness(undefined);

    harness.container.getRootState
      .mockReturnValueOnce({
        routes: [homeTab(HOME_STACK), statisticsRoute(CARRIED_STACK)],
      })
      .mockReturnValue(undefined);
    await renderLeave(harness);

    expect(harness.navigation.dispatch).not.toHaveBeenCalled();
    expect(harness.container.addListener).toHaveBeenCalledWith('state', expect.any(Function));
    expect(harness.unsubscribe).not.toHaveBeenCalled();
  });

  it.each([
    ['a Home stack without a key', { routes: [{ key: 'h0', name: 'Home' }] }],
    ['a Home route without a key', { key: 'home-key', routes: [{ name: 'Home' }] }],
    ['a Home stack without routes', { key: 'home-key', routes: [] }],
  ] as const satisfies readonly (readonly [string, unknown])[])(
    'opens nothing, and stops waiting, for %s',
    async (_name, stack) => {
      const harness = buildHarness({
        routes: [homeTab(stack as unknown as FakeStack), statisticsRoute(CARRIED_STACK)],
      });

      await renderLeave(harness);

      expect(harness.navigation.dispatch).not.toHaveBeenCalled();
      expect(harness.unsubscribe).toHaveBeenCalled();
    },
  );

  it('stays on the tab, carries nothing and listens for nothing in a window that is not large', async () => {
    reportWindow('compact', 390, 844);
    const harness = buildHarness({ routes: [homeTab(HOME_STACK), statisticsRoute()] });

    await renderLeave(harness);

    expect(harness.navigation.navigate).not.toHaveBeenCalled();
    expect(harness.navigation.dispatch).not.toHaveBeenCalled();
    expect(harness.container.addListener).not.toHaveBeenCalled();
  });
});
