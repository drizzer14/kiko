// The double-mount gate (duo-phase2). On a wide window Home and Statistics are each mounted in two
// tabs (a root in one, a default in the other), so their live queries exist twice. This walks the
// real RootNavigator, panes and visibility included, with a counting stand-in for `useLiveQuery`
// that keeps its paused/dirty contract (kiko-architecture, "`paused` vs `enabled`"), and holds the
// cost to three limits. A breach fails the change set. The same walk checks the defaults the
// Accounts and Settings tabs fill their primary pane with, which a focus-based screen would miss.
import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { holdingsRepo } from '@kiko/holdings/repo';
import { remindersRepo } from '@kiko/reminders/repo';
import { routeLatestResponse } from '@kiko/reminders/routing';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

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
  // A read lands as a new render, with whatever `mockRows` holds by then.
  rerender: () => void;
};

type Read = { id: string; instance: string };

// What the stand-in `useLiveQuery` saw: who subscribed, and who read. A read is the mount read, a
// write landing on an unpaused subscription, or the one read after a pause a write made dirty.
const mockSubscriptions = new Map<string, Subscription>();
let mockReads: Read[] = [];
// The rows a table answers with; none by default, so every screen is empty.
let mockRows: Record<string, unknown[]> = {};

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
      subscription.rerender();
    }
  }
};

jest.mock('@kiko/db/use-live-query', () => {
  const { useContext, useEffect, useId, useRef, useState } = jest.requireActual('react');
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
      const [, setRenders] = useState(0);

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
          rerender: () => setRenders((count: number) => count + 1),
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
          subscription.rerender();
        }
      }, [id, isPaused]);

      return { data: mockRows[tables[0]] ?? [], isLoading: false, isFresh: true };
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
    { wrapper: GestureRootWrapper },
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
    mockRows = {};
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

// Categories is the Settings tab's default for the primary pane. It is on screen without being the
// focused route, so the tip that points at it has to be answered by its visibility.
describe('the Settings tab with Categories as its default', () => {
  beforeEach(() => {
    mockSubscriptions.clear();
    mockReads = [];
    mockRows = {};
    mockLayoutMode = 'columns';
  });

  it('answers the categories tip once the tab shows it, and marks its row', async () => {
    const dismissTip = jest.spyOn(settingsRepo, 'dismissTip').mockResolvedValue(undefined);
    // The walk opens the Settings tab among the others and comes back to Home.
    const { getByTestId } = await walkTabs();

    expect(dismissTip).toHaveBeenCalledTimes(1);
    expect(dismissTip).toHaveBeenCalledWith('settings.categories');

    await goTo('SettingsTab');

    expect(getByTestId('settings-row-categories').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(getByTestId('settings-row-help').props.accessibilityState).toEqual({ selected: false });

    dismissTip.mockRestore();
  });
});

type StackRoute = { key: string; name: string; isDefault?: boolean; params?: object };

// A manual account row, with what the account page reads from it.
const accountRow = (id: string, name: string, kind: string) => ({
  id,
  name,
  kind,
  archivedAt: null,
  institution: null,
  bankId: null,
});

const accountsRoutes = (): StackRoute[] => {
  const tab = navigationRef.getRootState()?.routes.find(({ name }) => name === 'AccountsTab');

  return (tab?.state?.routes ?? []) as StackRoute[];
};

const accountsPanes = (): Record<string, string | undefined> => {
  const tab = navigationRef.getRootState()?.routes.find(({ name }) => name === 'AccountsTab');
  const state = (tab?.state ?? { panes: {} }) as unknown as {
    panes: Record<string, string | undefined>;
  };

  return state.panes;
};

const paneOf = (name: string): string | undefined => {
  const route = accountsRoutes().find((candidate) => candidate.name === name);

  return accountsPanes()[route?.key ?? ''];
};

// The Accounts list fills the primary pane of a wide window with a runtime default, which moves
// the stack's focus off the list; the list must stay live and the default must survive the tab
// being left and entered again.
describe('the Accounts tab with a runtime default in its primary pane', () => {
  beforeEach(() => {
    mockSubscriptions.clear();
    mockReads = [];
    mockRows = {};
    mockLayoutMode = 'columns';
  });

  it('shows the empty pane while there is no account', async () => {
    await walkTabs();
    await goTo('AccountsTab');

    expect(accountsRoutes().map(({ name, isDefault }) => [name, isDefault])).toEqual([
      ['Accounts', undefined],
      ['AccountsEmptyPane', true],
    ]);
  });

  it('shows the first account once there is one', async () => {
    mockRows = { accounts: [accountRow('a', 'Monobank', 'bank')] };
    await walkTabs();
    await goTo('AccountsTab');

    expect(accountsRoutes().map(({ name, isDefault }) => [name, isDefault])).toEqual([
      ['Accounts', undefined],
      ['AccountDetail', true],
    ]);
  });

  it('keeps the list reading a write while its default shows', async () => {
    await walkTabs();
    await goTo('AccountsTab');
    mockReads = [];

    await act(async () => {
      mockWrite('accounts');
    });

    expect(mockReads.map(({ instance }) => instance)).toContain('AccountsTab/Accounts');
  });

  it('drops the default when the tab is left, and puts it back when the tab is entered again', async () => {
    await walkTabs();
    await goTo('AccountsTab');
    await goTo('HomeTab');

    // The blur pops the tab to its root, and the tab left behind must not fill it again.
    expect(accountsRoutes().map(({ name }) => name)).toEqual(['Accounts']);

    await goTo('AccountsTab');

    expect(accountsRoutes().map(({ name, isDefault }) => [name, isDefault])).toEqual([
      ['Accounts', undefined],
      ['AccountsEmptyPane', true],
    ]);
  });

  describe('what the default page opens', () => {
    it('opens the holding form in the companion pane and keeps the account page in the primary', async () => {
      mockRows = { accounts: [accountRow('a', 'Monobank', 'bank')] };
      const { getByText } = await walkTabs();
      await goTo('AccountsTab');

      expect(accountsRoutes().at(-1)?.isDefault).toBe(true);

      await fireEvent.press(getByText('Add holding'));

      expect(accountsRoutes().map(({ name, isDefault }) => [name, isDefault])).toEqual([
        ['Accounts', undefined],
        ['AccountDetail', undefined],
        ['HoldingForm', undefined],
      ]);
      expect(paneOf('AccountDetail')).toBe('primary');
      expect(paneOf('HoldingForm')).toBe('companion');
    });

    it('leads Back from the form to the account page after a fold', async () => {
      mockRows = { accounts: [accountRow('a', 'Monobank', 'bank')] };
      const { getByText } = await walkTabs();
      await goTo('AccountsTab');
      await fireEvent.press(getByText('Add holding'));

      await act(async () => {
        navigationRef.dispatch({ type: 'PANE_FOLD' });
      });

      expect(accountsRoutes().map(({ name }) => name)).toEqual([
        'Accounts',
        'AccountDetail',
        'HoldingForm',
      ]);

      await act(async () => {
        navigationRef.goBack();
      });

      expect(accountsRoutes().map(({ name }) => name)).toEqual(['Accounts', 'AccountDetail']);
    });

    it('opens the account form from the empty pane in the companion pane', async () => {
      const { getByTestId } = await walkTabs();
      await goTo('AccountsTab');
      await fireEvent.press(within(getByTestId('accounts-empty-pane')).getByText('Add account'));

      expect(accountsRoutes().map(({ name, isDefault }) => [name, isDefault])).toEqual([
        ['Accounts', undefined],
        ['AccountsEmptyPane', undefined],
        ['AccountForm', undefined],
      ]);
      expect(paneOf('AccountForm')).toBe('companion');
    });
  });

  // The tap rebuilds the whole stack with one navigate; the account the list put in the pane is
  // not the user's, so it must not come through that rebuild as a page the user opened.
  describe('when a reminder tap opens another account', () => {
    const SAVINGS = accountRow('c', 'Savings', 'cash');

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('replaces the default with the account of the reminder, beside the list', async () => {
      jest
        .spyOn(remindersRepo, 'byIdQuery')
        .mockResolvedValue([{ id: 'r', accountId: 'c', kind: 'add_transactions' }] as never);
      jest.spyOn(accountsRepo, 'byIdQuery').mockResolvedValue([SAVINGS] as never);
      jest.spyOn(holdingsRepo, 'listByAccountQuery').mockResolvedValue([]);
      mockRows = { accounts: [accountRow('a', 'Monobank', 'bank'), SAVINGS] };
      const { getAllByRole } = await walkTabs();
      await goTo('AccountsTab');

      expect(accountsRoutes().at(-1)).toMatchObject({ isDefault: true });

      await act(async () => {
        await routeLatestResponse(
          [{ reminderId: 'r', requestIdentifier: 'r', action: 'open', respondedAt: 1 }],
          navigationRef as unknown as Parameters<typeof routeLatestResponse>[1],
        );
      });

      expect(accountsRoutes().map(({ name, isDefault }) => [name, isDefault])).toEqual([
        ['Accounts', undefined],
        ['AccountDetail', undefined],
      ]);
      expect(accountsRoutes().at(-1)?.params).toMatchObject({ accountId: 'c' });

      // The pane assignment is derived, not stored: the list marks the row of the primary pane's
      // top route, so Savings is there and the list is still the companion's.
      const selected = getAllByRole('button').filter(
        (row) => row.props.accessibilityState?.selected === true,
      );

      expect(selected).toHaveLength(1);
      expect(within(selected[0]).getByText('Savings')).toBeTruthy();
    });
  });

  describe('when the entity behind the page the user opened is deleted', () => {
    const SAVINGS = accountRow('c', 'Savings', 'cash');

    it('returns the pane to the first account when a tapped account is deleted from the list', async () => {
      mockRows = { accounts: [accountRow('a', 'Monobank', 'bank'), SAVINGS] };
      const { getByTestId } = await walkTabs();
      await goTo('AccountsTab');
      await fireEvent.press(within(getByTestId('accounts-grid')).getByText('Savings'));

      expect(accountsRoutes().at(-1)?.params).toMatchObject({ accountId: 'c' });

      mockRows = { accounts: [accountRow('a', 'Monobank', 'bank')] };
      await act(async () => {
        mockWrite('accounts');
      });

      expect(accountsRoutes().map(({ name, isDefault }) => [name, isDefault])).toEqual([
        ['Accounts', undefined],
        ['AccountDetail', true],
      ]);
      expect(accountsRoutes().at(-1)?.params).toMatchObject({ accountId: 'a' });
    });

    it('shows the empty pane when the last account is deleted', async () => {
      mockRows = { accounts: [SAVINGS] };
      const { getByTestId } = await walkTabs();
      await goTo('AccountsTab');
      await fireEvent.press(within(getByTestId('accounts-grid')).getByText('Savings'));

      expect(accountsRoutes().at(-1)?.isDefault).toBeUndefined();

      mockRows = {};
      await act(async () => {
        mockWrite('accounts');
      });

      expect(accountsRoutes().map(({ name, isDefault }) => [name, isDefault])).toEqual([
        ['Accounts', undefined],
        ['AccountsEmptyPane', true],
      ]);
    });

    it('returns the pane to its default when a tapped holding is deleted', async () => {
      const property = { ...accountRow('p', 'Properties', 'property'), name: 'Properties' };
      const apartment = {
        id: 'h1',
        name: 'Apartment',
        icon: null,
        color: null,
        accountId: 'p',
        currency: 'UAH',
        balanceMinorUnits: 0,
        type: 'property_item',
        closedAt: null,
        metadata: {
          category: 'real_estate',
          lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500_000 }],
        },
      };

      mockRows = { accounts: [property, SAVINGS], holdings: [apartment] };
      const { getByTestId } = await walkTabs();
      await goTo('AccountsTab');
      await fireEvent.press(within(getByTestId('accounts-property-grid')).getByText('Apartment'));

      expect(accountsRoutes().at(-1)).toMatchObject({ name: 'HoldingDetail' });

      mockRows = { accounts: [property, SAVINGS], holdings: [] };
      await act(async () => {
        mockWrite('holdings');
      });

      expect(accountsRoutes().map(({ name }) => name)).not.toContain('HoldingDetail');
      expect(accountsRoutes().at(-1)).toMatchObject({ name: 'AccountDetail', isDefault: true });
    });
  });

  it('leaves a row the user tapped alone', async () => {
    mockRows = {
      accounts: [accountRow('a', 'Monobank', 'bank'), accountRow('c', 'Savings', 'cash')],
    };
    const { getByTestId } = await walkTabs();
    await goTo('AccountsTab');

    await fireEvent.press(within(getByTestId('accounts-grid')).getByText('Savings'));

    const routes = accountsRoutes();

    expect(routes.map(({ name }) => name)).toEqual(['Accounts', 'AccountDetail']);
    expect(routes.at(-1)?.isDefault).toBeUndefined();
    expect(routes.at(-1)?.params).toMatchObject({ accountId: 'c' });
  });
});
