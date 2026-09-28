import { Linking } from 'react-native';
import type { ComponentProps } from 'react';
import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { ReminderRow } from '@kiko/db';
import { remindersRepo } from '@kiko/reminders/repo';
import { remindersNative } from '@kiko/reminders/native';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
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
    hasImportQuery: (accountId: string) => ({
      toSQL: () => ({ sql: 'import', params: [accountId] }),
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

const reminder = (overrides: Partial<ReminderRow> = {}): ReminderRow => ({
  id: 'r-1',
  accountId: 'a-1',
  kind: 'add_transactions',
  schedule: { frequency: 'daily', minuteOfDay: 20 * 60 },
  pausedAt: null,
  pauseReason: null,
  activeSince: 0,
  lastEngagedAt: null,
  lastSnoozedAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const seed = (data: {
  account?: Account;
  reminders?: ReminderRow[];
  hasImport?: boolean;
  loading?: boolean;
}): void => {
  const resultByTable: Record<string, unknown[]> = {
    accounts: [data.account ?? MANUAL],
    reminders: data.reminders ?? [],
    transactions: data.hasImport ? [{ id: 't-1' }] : [],
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
  it('offers only add-transactions on a manual account with no import', async () => {
    seed({ account: MANUAL, hasImport: false });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Add transactions')).toBeTruthy();
    expect(queryByText('Statement import')).toBeNull();
  });

  it('offers only statement import on a synced account with an import', async () => {
    seed({ account: SYNCED, hasImport: true });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Statement import')).toBeTruthy();
    expect(queryByText('Add transactions')).toBeNull();
  });

  it('lists import first on a manual account with an import', async () => {
    seed({ account: MANUAL, hasImport: true });

    const { getAllByText } = await renderScreen();

    expect(
      getAllByText(/^(Statement import|Add transactions)$/).map((text) => text.props.children),
    ).toEqual(['Statement import', 'Add transactions']);
  });

  it('keeps a saved reminder the account no longer allows, and says why', async () => {
    seed({ account: SYNCED, hasImport: false, reminders: [reminder()] });

    const { getByText } = await renderScreen();

    expect(getByText('Add transactions')).toBeTruthy();
    expect(getByText('Not available while the account is connected to a bank.')).toBeTruthy();
  });

  it('says saved reminders are not sent while the account is archived', async () => {
    seed({ account: { ...MANUAL, archivedAt: 1 }, reminders: [reminder()] });

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
    seed({ account: MANUAL, reminders: [reminder()] });

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Add transactions'));

    expect(navigation.navigate).toHaveBeenCalledWith('ReminderForm', { reminderId: 'r-1' });
  });

  it('pauses a reminder from its switch, then re-plans', async () => {
    seed({ account: MANUAL, reminders: [reminder()] });

    const { getByLabelText } = await renderScreen();

    await fireEvent(getByLabelText('Reminder on'), 'valueChange', false);

    expect(remindersRepo.setPaused).toHaveBeenCalledWith('r-1', true);
    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalled());
  });

  it('deletes a reminder from the touch-and-hold menu, then re-plans', async () => {
    seed({ account: MANUAL, reminders: [reminder()] });

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
  const deniedMessage = 'Notifications are off for Kiko, so reminders can’t appear.';
  const notDeterminedMessage = 'Turn on notifications so your reminders can appear.';

  it('shows no notice while notifications are allowed', async () => {
    seed({ account: MANUAL, reminders: [reminder()] });

    const { queryByText } = await renderScreen();

    await waitFor(() => expect(authorizationStatus).toHaveBeenCalled());
    expect(queryByText(deniedMessage)).toBeNull();
    expect(queryByText(notDeterminedMessage)).toBeNull();
  });

  it('opens iOS Settings from the notice when notifications are denied', async () => {
    authorizationStatus.mockResolvedValue('denied');
    seed({ account: MANUAL, reminders: [reminder()] });

    const { findByText, getByText } = await renderScreen();

    expect(await findByText(deniedMessage)).toBeTruthy();

    await fireEvent.press(getByText('Open iOS settings'));

    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('shows no notice while there is no reminder to deliver', async () => {
    authorizationStatus.mockResolvedValue('denied');
    seed({ account: MANUAL, reminders: [] });

    const { queryByText } = await renderScreen();

    await waitFor(() => expect(authorizationStatus).toHaveBeenCalled());
    expect(queryByText(deniedMessage)).toBeNull();
  });

  it('asks iOS through the pre-alert when a restored reminder has never asked', async () => {
    authorizationStatus.mockResolvedValue('notDetermined');
    seed({ account: MANUAL, reminders: [reminder()] });

    const { findByText, getByText, getByTestId, queryByText } = await renderScreen();

    expect(await findByText(notDeterminedMessage)).toBeTruthy();

    await fireEvent.press(getByText('Turn on notifications'));

    expect(getByText('Reminder Notifications')).toBeTruthy();
    expect(requestAuthorization).not.toHaveBeenCalled();

    const reportClosed: () => void = getByTestId('notification-pre-alert-sheet-modal').props
      .onDismiss;

    authorizationStatus.mockResolvedValue('authorized');
    await fireEvent.press(getByText('Continue'));
    await act(async () => {
      reportClosed();
    });

    await waitFor(() => expect(requestAuthorization).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalled());
    await waitFor(() => expect(queryByText(notDeterminedMessage)).toBeNull());
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
