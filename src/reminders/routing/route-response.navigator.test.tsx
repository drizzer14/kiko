// The tap routing on a real, fully migrated `node:sqlite` engine and the REAL
// React Navigation routers: a spy cannot show which screens end up on the
// stack, or what happens when the Accounts stack has not mounted yet.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

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
import { DatabaseSync } from 'node:sqlite';
import { type FC, type ReactNode, useState } from 'react';
import { act, render } from '@testing-library/react-native';
import { navigationRef } from '@kiko/navigation/navigation-ref';
import type { NotificationResponse } from '@kiko/reminders/native';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { resetTabStackOnBlur } from '@kiko/navigation/reset-tab-stack-on-blur';
import type { AccountsStackParamList, TabParamList } from '@kiko/navigation/types';

import '@kiko/design-system/unistyles';

import { routeLatestResponse } from './route-response';

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

      <AccountsStack.Screen name="HoldingDetail" component={ParamsStub} />

      <AccountsStack.Screen name="TransactionForm" component={ParamsStub} />

      <AccountsStack.Screen name="AccountReminders" component={ParamsStub} />
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

const run = (statement: string, ...parameters: (string | number | null)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const seedAccount = (accountId: string, name: string, kind = 'cash'): void => {
  run('INSERT INTO accounts (id, name, kind) VALUES (?, ?, ?)', accountId, name, kind);
};

const seedHolding = (
  holdingId: string,
  accountId: string,
  closedAt: number | null = null,
  type = 'cash',
) => {
  run(
    "INSERT INTO holdings (id, account_id, name, type, currency, closed_at) VALUES (?, ?, 'Wallet', ?, 'UAH', ?)",
    holdingId,
    accountId,
    type,
    closedAt,
  );
};

const seedReminder = (
  reminderId: string,
  accountId: string,
  kind: 'statement_import' | 'add_transactions',
): void => {
  run(
    'INSERT INTO reminders (id, account_id, kind, schedule, active_since) VALUES (?, ?, ?, ?, 0)',
    reminderId,
    accountId,
    kind,
    JSON.stringify({ frequency: 'daily', minuteOfDay: 20 * 60 }),
  );
};

const tap = (
  reminderId: string,
  overrides: Partial<NotificationResponse> = {},
): NotificationResponse => ({
  reminderId,
  requestIdentifier: `kiko.reminder.${reminderId}.202610012000`,
  action: 'open',
  respondedAt: 1000,
  ...overrides,
});

const route = async (responses: NotificationResponse[]): Promise<void> => {
  await act(async () => {
    await routeLatestResponse(responses, navigationRef);
  });
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  seedAccount('cash', 'Cash');
  seedAccount('bank', 'Mono', 'bank');
  seedReminder('add-cash', 'cash', 'add_transactions');
  seedReminder('import-bank', 'bank', 'statement_import');
  seedAccount('properties', 'Properties', 'property');
  seedReminder('add-properties', 'properties', 'add_transactions');
});

describe('reminder tap routing (real router)', () => {
  describe.each([
    ['a warm tap', 'warm'],
    ['a tap that launched the app', 'cold'],
  ])('%s', (_label, launch) => {
    // A cold launch asks to route before the navigator has mounted.
    const routeTap = async (responses: NotificationResponse[]): Promise<void> => {
      if (launch === 'cold') {
        await route(responses);
        await renderApp();

        return;
      }

      await renderApp();
      await route(responses);
    };

    it('opens the new-transaction form above the account with one open holding', async () => {
      seedHolding('wallet', 'cash');
      seedHolding('old-wallet', 'cash', 1);

      await routeTap([tap('add-cash')]);

      expect(focusedTab()).toBe('AccountsTab');
      expect(accountsStack()).toEqual([
        onStack('Accounts'),
        onStack('AccountDetail', { accountId: 'cash', name: 'Cash' }),
        onStack('TransactionForm', { holdingId: 'wallet' }),
      ]);
    });

    it('opens only the account with two open holdings', async () => {
      seedHolding('wallet', 'cash');
      seedHolding('jar', 'cash');

      await routeTap([tap('add-cash')]);

      expect(accountsStack()).toEqual([
        onStack('Accounts'),
        onStack('AccountDetail', { accountId: 'cash', name: 'Cash' }),
      ]);
    });

    it('opens the account with the file picker intent for an import reminder', async () => {
      await routeTap([tap('import-bank')]);

      expect(accountsStack()).toEqual([
        onStack('Accounts'),
        onStack('AccountDetail', { accountId: 'bank', name: 'Mono', intent: 'importStatement' }),
      ]);
    });

    it('opens the account reminders page above the account for the paused notice', async () => {
      await routeTap([tap('add-cash', { requestIdentifier: 'kiko.reminder.add-cash.paused' })]);

      expect(accountsStack()).toEqual([
        onStack('Accounts'),
        onStack('AccountDetail', { accountId: 'cash', name: 'Cash' }),
        onStack('AccountReminders', { accountId: 'cash' }),
      ]);
    });

    // An implicit account has no AccountDetail page, so a tap never opens one.
    it('opens only the Accounts root for a tap on an implicit account reminder', async () => {
      seedHolding('flat', 'properties', null, 'property_item');

      await routeTap([tap('add-properties')]);

      expect(focusedTab()).toBe('AccountsTab');
      expect(accountsStack()).toEqual([onStack('Accounts')]);
    });

    it('opens the account reminders page above the Accounts root for its paused notice', async () => {
      await routeTap([
        tap('add-properties', { requestIdentifier: 'kiko.reminder.add-properties.paused' }),
      ]);

      expect(focusedTab()).toBe('AccountsTab');
      expect(accountsStack()).toEqual([
        onStack('Accounts'),
        onStack('AccountReminders', { accountId: 'properties' }),
      ]);
    });

    it('routes only the latest of two queued taps', async () => {
      await routeTap([
        tap('add-cash', { respondedAt: 1000 }),
        tap('import-bank', { respondedAt: 2000 }),
      ]);

      expect(accountsStack()).toEqual([
        onStack('Accounts'),
        onStack('AccountDetail', { accountId: 'bank', name: 'Mono', intent: 'importStatement' }),
      ]);
    });

    it('stays put, without an error, for a reminder deleted with its account', async () => {
      await routeTap([tap('deleted-reminder')]);

      expect(focusedTab()).toBe('HomeTab');
      expect(accountsStack()).toEqual([]);
    });
  });

  it('opens only the account when its one open holding takes no transactions', async () => {
    seedHolding('deposit', 'cash', null, 'term_deposit');
    await renderApp();

    await route([tap('add-cash')]);

    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'cash', name: 'Cash' }),
    ]);
  });

  const openAccount = async (accountId: string, name: string): Promise<void> => {
    await act(async () => {
      navigationRef.navigate('AccountsTab', {
        screen: 'AccountDetail',
        params: { accountId, name },
        initial: false,
      });
    });
  };

  it('opens the tapped account above the pages the Accounts tab already shows, keeping them', async () => {
    seedHolding('wallet', 'cash');
    seedHolding('jar', 'cash');
    await renderApp();
    await openAccount('bank', 'Mono');
    await act(async () => {
      navigationRef.navigate('AccountsTab', {
        screen: 'HoldingDetail',
        params: { holdingId: 'card', name: 'Card' },
      });
    });
    const keysBefore = accountsStack().map(({ key }) => key);

    await route([tap('add-cash')]);

    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'bank', name: 'Mono' }),
      onStack('HoldingDetail'),
      onStack('AccountDetail', { accountId: 'cash', name: 'Cash' }),
    ]);
    expect(accountsStack().map(({ key }) => key)).toEqual([...keysBefore, expect.any(String)]);
  });

  it('gives the page of the tapped account, already on top, the new params in place', async () => {
    await renderApp();
    await openAccount('bank', 'Mono');
    const [, pageBefore] = accountsStack();

    await route([tap('import-bank')]);

    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'bank', name: 'Mono', intent: 'importStatement' }),
    ]);
    expect(accountsStack()[1]?.key).toBe(pageBefore?.key);
  });

  it('navigates once, with a stack that ends at the account reminders page, for an implicit account’s paused notice', async () => {
    await renderApp();
    const navigate = jest.spyOn(navigationRef, 'navigate');

    await route([
      tap('add-properties', { requestIdentifier: 'kiko.reminder.add-properties.paused' }),
    ]);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('AccountsTab', {
      state: {
        routes: [
          expect.objectContaining({ name: 'Accounts' }),
          { name: 'AccountReminders', params: { accountId: 'properties' } },
        ],
        index: 1,
      },
    });
    navigate.mockRestore();
  });

  it('keeps the pages the tab shows, adding no account page, for an implicit account’s tap', async () => {
    await renderApp();
    await openAccount('bank', 'Mono');
    const keysBefore = accountsStack().map(({ key }) => key);

    await route([tap('add-properties')]);

    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'bank', name: 'Mono' }),
    ]);
    expect(accountsStack().map(({ key }) => key)).toEqual(keysBefore);
  });

  it('opens the next screen above the page of the tapped account already on top', async () => {
    seedHolding('wallet', 'cash');
    await renderApp();
    await openAccount('cash', 'Cash');

    await route([tap('add-cash')]);

    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'cash', name: 'Cash' }),
      onStack('TransactionForm', { holdingId: 'wallet' }),
    ]);
  });

  it('opens only the newer of two routes that waited for the navigator', async () => {
    await route([tap('add-cash')]);
    await route([tap('import-bank')]);
    await renderApp();

    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'bank', name: 'Mono', intent: 'importStatement' }),
    ]);
  });
});
