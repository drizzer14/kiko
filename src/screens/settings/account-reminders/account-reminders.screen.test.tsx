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

type Account = { id: string; kind: string; institution: string | null; archivedAt: number | null };

const MANUAL: Account = { id: 'a-1', kind: 'bank', institution: null, archivedAt: null };
const SYNCED: Account = { id: 'a-1', kind: 'bank', institution: 'monobank', archivedAt: null };
const CASH: Account = { id: 'a-1', kind: 'cash', institution: null, archivedAt: null };
const SYNCED_CRYPTO: Account = {
  id: 'a-1',
  kind: 'crypto',
  institution: 'binance',
  archivedAt: null,
};
const NO_KINDS_CAPTION = 'Reminders are available for accounts you track by hand.';

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
  it('lists both kinds, import first, on a manual bank account before any import', async () => {
    seed({ account: MANUAL });

    const { getAllByText } = await renderScreen();

    expect(
      getAllByText(/^(Statement import|Add transactions)$/).map((text) => text.props.children),
    ).toEqual(['Statement import', 'Add transactions']);
  });

  it('offers no kind on a synced bank account, and explains the empty page', async () => {
    seed({ account: SYNCED });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText(NO_KINDS_CAPTION)).toBeTruthy();
    expect(queryByText('Statement import')).toBeNull();
    expect(queryByText('Add transactions')).toBeNull();
  });

  it('keeps a saved statement-import reminder on a synced bank, and says why it is not sent', async () => {
    seed({ account: SYNCED, reminders: [savedReminder({ kind: 'statement_import' })] });

    const { getByText } = await renderScreen();

    expect(getByText('Statement import')).toBeTruthy();
    expect(getByText('Available only for bank accounts you track by hand.')).toBeTruthy();
  });

  it('offers only add transactions on an account that is not a bank', async () => {
    seed({ account: CASH });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Add transactions')).toBeTruthy();
    expect(queryByText('Statement import')).toBeNull();
    expect(queryByText(NO_KINDS_CAPTION)).toBeNull();
  });

  it('explains an empty page on a synced account that is not a bank', async () => {
    seed({ account: SYNCED_CRYPTO });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText(NO_KINDS_CAPTION)).toBeTruthy();
    expect(queryByText('Statement import')).toBeNull();
    expect(queryByText('Add transactions')).toBeNull();
  });

  it('shows no empty caption while a saved reminder is listed', async () => {
    seed({ account: SYNCED_CRYPTO, reminders: [savedReminder()] });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Add transactions')).toBeTruthy();
    expect(queryByText(NO_KINDS_CAPTION)).toBeNull();
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

  // The AccountDetail of an implicit account has no bell and offers no new
  // reminder, but one a merge left on it stays active and manageable here:
  // never marked as unavailable, and still paused and deleted from its row.
  it.each(['property', 'debt'])(
    'keeps a saved reminder on a live %s account active, with no unavailable note',
    async (kind) => {
      seed({ account: { ...CASH, kind }, reminders: [savedReminder()] });

      const { getByText, queryByText } = await renderScreen();

      expect(getByText('Add transactions')).toBeTruthy();
      expect(queryByText('Available only for accounts you track by hand.')).toBeNull();
      expect(queryByText('Not sent while the account is archived.')).toBeNull();
    },
  );

  // No NEW reminder for an implicit account: the page lists only what is
  // saved, so deleting the last one leaves no row that opens the create form.
  describe.each(['property', 'debt'])('a live %s account', (kind) => {
    const implicit = { ...CASH, kind };

    it('offers no row to create a reminder when it has none saved', async () => {
      seed({ account: implicit });

      const { queryByText, getByText } = await renderScreen();

      expect(queryByText('Add transactions')).toBeNull();
      expect(queryByText('Statement import')).toBeNull();
      expect(getByText(NO_KINDS_CAPTION)).toBeTruthy();
    });

    it('lists only the saved reminder, and opens it by its id', async () => {
      seed({ account: implicit, reminders: [savedReminder()] });

      const { getByText, queryByText } = await renderScreen();

      expect(queryByText(NO_KINDS_CAPTION)).toBeNull();

      await fireEvent.press(getByText('Add transactions'));

      expect(navigation.navigate).toHaveBeenCalledWith('ReminderForm', { reminderId: 'r-1' });
    });

    it('offers no create row once its only saved reminder is deleted', async () => {
      seed({ account: implicit, reminders: [savedReminder()] });

      const { getByText, queryByText, rerender } = await renderScreen();

      expect(getByText('Add transactions')).toBeTruthy();

      seed({ account: implicit, reminders: [] });
      await rerender(
        <AccountRemindersScreen
          navigation={asNavigationProp<AccountRemindersProps['navigation']>(navigation)}
          route={asRouteProp<AccountRemindersProps['route']>('AccountReminders', {
            accountId: 'a-1',
          })}
        />,
      );

      expect(queryByText('Add transactions')).toBeNull();
      expect(navigation.navigate).not.toHaveBeenCalled();
    });
  });

  it('lists the eligible kinds of an ARCHIVED implicit-kind account, a plain account', async () => {
    seed({ account: { ...CASH, kind: 'property', archivedAt: 5 } });

    const { getByText } = await renderScreen();

    expect(getByText('Add transactions')).toBeTruthy();
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
