// The double-mount gate (duo-phase2). On a wide window Home and Statistics are each mounted in two
// tabs (a root in one, a default in the other), so their live queries exist twice. This walks the
// real RootNavigator, panes and visibility included, with a counting stand-in for `useLiveQuery`
// that keeps its paused/dirty contract (kiko-architecture, "`paused` vs `enabled`"), and holds the
// cost to three limits. A breach fails the change set.
import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { act, render, waitFor } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import RootNavigator from './root.navigator';

let mockLayoutMode: 'single' | 'columns' = 'columns';
jest.mock('@kiko/display-regions', () => ({
  ...jest.requireActual('@kiko/display-regions'),
  useLayoutMode: () => mockLayoutMode,
  useFoldRegion: () => null,
}));

// The native tab bar mounts a tab when it is first focused and keeps it mounted, so a hidden tab
// stays a live subscriber. `TabNameContext` tells a stand-in query which tab it runs in.
jest.mock('@bottom-tabs/react-navigation', () => {
  const { useState, createContext } = jest.requireActual('react');
  const { View: HostView } = jest.requireActual('react-native');
  const native = jest.requireActual('@react-navigation/native');
  const TabNameContext = createContext('');

  const LazyTabs = ({ children }: { children: unknown }) => {
    const { state, descriptors, NavigationContent } = native.useNavigationBuilder(
      native.TabRouter,
      { children },
    );
    const focusedKey = state.routes[state.index]?.key ?? '';
    const [loadedKeys, setLoadedKeys] = useState([focusedKey]);

    if (!loadedKeys.includes(focusedKey)) {
      setLoadedKeys([...loadedKeys, focusedKey]);
    }

    return (
      <NavigationContent>
        {state.routes
          .filter((route: { key: string }) => loadedKeys.includes(route.key))
          .map((route: { key: string; name: string }) => (
            <HostView
              key={route.key}
              style={route.key === focusedKey ? undefined : { display: 'none' }}
            >
              <TabNameContext.Provider value={route.name}>
                {descriptors[route.key]?.render()}
              </TabNameContext.Provider>
            </HostView>
          ))}
      </NavigationContent>
    );
  };

  return {
    createNativeBottomTabNavigator: native.createNavigatorFactory(LazyTabs),
    TabNameContext,
  };
});

type Subscription = {
  instance: string;
  tables: string[];
  isPaused: boolean;
  isDirty: boolean;
};

type Read = { id: string; instance: string };

// What the stand-in `useLiveQuery` saw: who subscribed, and who read. A read is the mount read, a
// write landing on an unpaused subscription, or the one read after a pause a write made dirty.
const mockSubscriptions = new Map<string, Subscription>();
let mockReads: Read[] = [];

const mockRead = (id: string): void => {
  const subscription = mockSubscriptions.get(id);

  if (subscription !== undefined) {
    mockReads.push({ id, instance: subscription.instance });
  }
};

const mockWrite = (table: string): void => {
  for (const [id, subscription] of mockSubscriptions) {
    if (!subscription.tables.includes(table)) {
      continue;
    }

    if (subscription.isPaused) {
      subscription.isDirty = true;
    } else {
      mockRead(id);
    }
  }
};

jest.mock('@kiko/db/use-live-query', () => {
  const { useContext, useEffect, useId, useRef } = jest.requireActual('react');
  const native = jest.requireActual('@react-navigation/native');

  return {
    useLiveQuery: (
      _query: unknown,
      tables: string[],
      enabled: boolean,
      options?: { paused?: boolean },
    ) => {
      const id = useId();
      const route = useContext(native.NavigationRouteContext);
      const tab = useContext(jest.requireMock('@bottom-tabs/react-navigation').TabNameContext);
      const instance = `${tab}/${route?.name}`;
      const tablesKey = tables.join(',');
      const isPaused = options?.paused ?? false;
      const pausedRef = useRef(isPaused);

      pausedRef.current = isPaused;

      // The mount read always runs, paused or not; `enabled: false` skips everything.
      useEffect(() => {
        if (!enabled) {
          return undefined;
        }

        mockSubscriptions.set(id, {
          instance,
          tables: tablesKey.split(','),
          isPaused: pausedRef.current,
          isDirty: false,
        });
        mockRead(id);

        return () => {
          mockSubscriptions.delete(id);
        };
      }, [id, enabled, instance, tablesKey]);

      // Flipping `paused` never re-subscribes; leaving it runs one read if a write made it dirty.
      useEffect(() => {
        const subscription = mockSubscriptions.get(id);

        if (subscription === undefined || subscription.isPaused === isPaused) {
          return;
        }

        subscription.isPaused = isPaused;

        if (!isPaused && subscription.isDirty) {
          subscription.isDirty = false;
          mockRead(id);
        }
      }, [id, isPaused]);

      return { data: [], isLoading: false, isFresh: true };
    },
  };
});

const navigationRef = createNavigationContainerRef<ParamListBase>();

// Home and Statistics are the screens whose cost is under test.
const underTest = (instance: string): boolean => /\/(Home|Statistics)$/.test(instance);

const subscriptionCount = (): number =>
  [...mockSubscriptions.values()].filter(({ instance }) => underTest(instance)).length;

const goTo = async (tab: string): Promise<void> => {
  await act(async () => {
    navigationRef.navigate(tab);
  });
};

// Visits every tab, then comes back to Home.
const walkTabs = async () => {
  const rendered = await render(
    <NavigationContainer ref={navigationRef}>
      <RootNavigator />
    </NavigationContainer>,
  );

  await waitFor(() => expect(navigationRef.isReady()).toBe(true));

  for (const tab of ['AccountsTab', 'StatisticsTab', 'SettingsTab', 'HomeTab']) {
    await goTo(tab);
  }

  return rendered;
};

describe('the double-mount gate', () => {
  beforeEach(() => {
    mockSubscriptions.clear();
    mockReads = [];
    mockLayoutMode = 'columns';
  });

  it('limit 1: reads after a write come only from the visible instances', async () => {
    await walkTabs();
    mockReads = [];

    await act(async () => {
      mockWrite('transactions');
    });

    const readers = new Set(mockReads.map(({ instance }) => instance).filter(underTest));

    expect([...readers].sort()).toEqual(['HomeTab/Home', 'HomeTab/Statistics']);
  });

  it('limit 2: holds the live subscriptions to at most twice the single-pane walk', async () => {
    mockLayoutMode = 'single';
    const singlePane = await walkTabs();
    const single = subscriptionCount();

    await singlePane.unmount();
    mockSubscriptions.clear();
    mockLayoutMode = 'columns';
    await walkTabs();
    const columns = subscriptionCount();

    expect(single).toBeGreaterThan(0);
    expect(columns).toBeGreaterThan(single);
    expect(columns).toBeLessThanOrEqual(2 * single);
  });

  it('limit 3: opening the Statistics tab reads each dirty query once per newly visible instance', async () => {
    await walkTabs();
    await act(async () => {
      mockWrite('transactions');
    });

    const dirty = [...mockSubscriptions.entries()].filter(
      ([, { instance, isDirty }]) => isDirty && instance.startsWith('StatisticsTab/'),
    );

    expect(dirty.length).toBeGreaterThan(0);
    mockReads = [];

    await goTo('StatisticsTab');

    const reads = mockReads.filter(({ instance }) => underTest(instance));

    expect(reads.map(({ id }) => id).sort()).toEqual(dirty.map(([id]) => id).sort());
    expect(new Set(reads.map(({ instance }) => instance))).toEqual(
      new Set(['StatisticsTab/Statistics', 'StatisticsTab/Home']),
    );
  });
});
