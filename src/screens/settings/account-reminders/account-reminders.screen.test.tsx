import type { ComponentProps } from 'react';
import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { ReminderRow } from '@kiko/db';
import {
  NOT_DETERMINED_NOTICE,
  permissionNoticeCases,
} from '@kiko/test-support/permission-notice-cases';
import { remindersRepo } from '@kiko/reminders/repo';
import { remindersNative } from '@kiko/reminders/native';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import { savedReminder } from '@kiko/test-support/saved-reminder';
import { useNotificationPermission } from '@kiko/reminders/permission';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import AccountRemindersScreen from '.';

type AccountRemindersProps = ComponentProps<typeof AccountRemindersScreen>;

const mockUseLiveQuery = jest.fn();
const mockSyncReminders = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: (...args: unknown[]) => mockSyncReminders(...args),
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) => ({ toSQL: () => ({ sql: 'account', params: [accountId] }) }),
  },
}));
jest.mock('@kiko/reminders/repo/reminders.repo', () => ({
  remindersRepo: {
    listByAccountQuery: (accountId: string) => ({
      toSQL: () => ({ sql: 'reminders', params: [accountId] }),
    }),
    setPaused: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  },
}));

const authorizationStatus = jest.spyOn(remindersNative, 'authorizationStatus');
const requestAuthorization = jest.spyOn(remindersNative, 'requestAuthorization');

type Account = { id: string; institution: string | null; archivedAt: number | null };

const MANUAL: Account = { id: 'a-1', institution: null, archivedAt: null };
const SYNCED: Account = { id: 'a-1', institution: 'monobank', archivedAt: null };

const seed = (data: { account?: Account; reminders?: ReminderRow[]; loading?: boolean }): void => {
  const resultByTable: Record<string, unknown[]> = {
    accounts: [data.account ?? MANUAL],
    reminders: data.reminders ?? [],
  };

  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: resultByTable[tables[0]] ?? [],
    isLoading: data.loading ?? false,
    isFresh: true,
  }));
};

let navigation = navigationSpy();

const renderScreen = () =>
  render(
    <AccountRemindersScreen
      navigation={asNavigationProp<AccountRemindersProps['navigation']>(navigation)}
      route={asRouteProp<AccountRemindersProps['route']>('AccountReminders', {
        accountId: 'a-1',
        name: 'Cash',
      })}
    />,
    { wrapper: GestureRootWrapper },
  );

beforeEach(() => {
  navigation = navigationSpy();
  mockSyncReminders.mockResolvedValue(undefined);
  authorizationStatus.mockReset().mockResolvedValue('authorized');
  requestAuthorization.mockReset().mockResolvedValue(true);
});

describe('AccountRemindersScreen — rows', () => {
  it('lists both kinds, import first, on a manual account before any import', async () => {
    seed({ account: MANUAL });

    const { getAllByText } = await renderScreen();

    expect(
      getAllByText(/^(Statement import|Add transactions)$/).map((text) => text.props.children),
    ).toEqual(['Statement import', 'Add transactions']);
  });

  it('offers only statement import on a synced account, before any import', async () => {
    seed({ account: SYNCED });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Statement import')).toBeTruthy();
    expect(queryByText('Add transactions')).toBeNull();
  });

  it('reads no transactions to decide which kinds it offers', async () => {
    seed({ account: SYNCED });

    await renderScreen();

    expect(mockUseLiveQuery.mock.calls.map(([, tables]) => tables)).not.toContainEqual(
      expect.arrayContaining(['transactions']),
    );
  });

  it('keeps a saved reminder the account no longer allows, and says why', async () => {
    seed({ account: SYNCED, reminders: [savedReminder()] });

    const { getByText } = await renderScreen();

    expect(getByText('Add transactions')).toBeTruthy();
    expect(getByText('Available only for accounts you track by hand.')).toBeTruthy();
  });

  it('says saved reminders are not sent while the account is archived', async () => {
    seed({ account: { ...MANUAL, archivedAt: 1 }, reminders: [savedReminder()] });

    const { getByText } = await renderScreen();

    expect(getByText('Not sent while the account is archived.')).toBeTruthy();
  });

  it('shows a spinner, and no rows, until its reads settle', async () => {
    seed({ account: MANUAL, loading: true });

    const { getByTestId, queryByText } = await renderScreen();

    expect(getByTestId('account-reminders-loading')).toBeTruthy();
    expect(queryByText('Add transactions')).toBeNull();
  });

  it('opens a new reminder of the row’s kind for this account', async () => {
    seed({ account: MANUAL });

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Add transactions'));

    expect(navigation.navigate).toHaveBeenCalledWith('ReminderForm', {
      accountId: 'a-1',
      kind: 'add_transactions',
    });
  });

  it('opens a saved reminder by its id', async () => {
    seed({ account: MANUAL, reminders: [savedReminder()] });

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Add transactions'));

    expect(navigation.navigate).toHaveBeenCalledWith('ReminderForm', { reminderId: 'r-1' });
  });

  it('pauses a reminder from its switch, then re-plans', async () => {
    seed({ account: MANUAL, reminders: [savedReminder()] });

    const { getByLabelText } = await renderScreen();

    await fireEvent(getByLabelText('Reminder on'), 'valueChange', false);

    expect(remindersRepo.setPaused).toHaveBeenCalledWith('r-1', true);
    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalled());
  });

  it('deletes a reminder from the touch-and-hold menu, then re-plans', async () => {
    seed({ account: MANUAL, reminders: [savedReminder()] });

    const { getByTestId } = await renderScreen();

    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(remindersRepo.remove).toHaveBeenCalledWith('r-1');
    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalled());
  });
});

describe('AccountRemindersScreen — notification permission', () => {
  permissionNoticeCases({
    renderList: (withReminder) => {
      seed({ account: MANUAL, reminders: withReminder ? [savedReminder()] : [] });

      return renderScreen();
    },
    syncReminders: mockSyncReminders,
    afterPreAlert: () => expect(navigation.goBack).not.toHaveBeenCalled(),
  });

  it('hides the notice once the reminder form’s prompt turns notifications on', async () => {
    authorizationStatus.mockResolvedValue('notDetermined');
    seed({ account: MANUAL, reminders: [savedReminder()] });

    const { findByText, queryByText } = await renderScreen();

    expect(await findByText(NOT_DETERMINED_NOTICE)).toBeTruthy();

    const form = await renderHook(() => useNotificationPermission());

    authorizationStatus.mockResolvedValue('authorized');
    await act(async () => {
      await form.result.current.request();
    });

    expect(queryByText(NOT_DETERMINED_NOTICE)).toBeNull();
  });
});
