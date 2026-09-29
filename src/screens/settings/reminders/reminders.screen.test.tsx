import type { ComponentProps } from 'react';
import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { remindersRepo } from '@kiko/reminders/repo';
import type { AccountRow, ReminderRow } from '@kiko/db';
import { remindersNative } from '@kiko/reminders/native';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import { savedReminder } from '@kiko/test-support/saved-reminder';
import { accountKindSymbol } from '@kiko/holdings/entity-symbols';
import { defaultAccountColor } from '@kiko/holdings/entity-colors';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { permissionNoticeCases } from '@kiko/test-support/permission-notice-cases';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import RemindersScreen from '.';

type RemindersProps = ComponentProps<typeof RemindersScreen>;

const mockUseLiveQuery = jest.fn();
const mockSyncReminders = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: (...args: unknown[]) => mockSyncReminders(...args),
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/reminders/repo/reminders.repo', () => ({
  remindersRepo: {
    listWithAccountQuery: () => ({ toSQL: () => ({ sql: 'reminders', params: [] }) }),
    setPaused: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  },
}));

const authorizationStatus = jest.spyOn(remindersNative, 'authorizationStatus');
const requestAuthorization = jest.spyOn(remindersNative, 'requestAuthorization');

jest.mock('@kiko/design-system/components/entity-icon-tile', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ name, color }: { name: string; color: string }) => (
      <RNText>{`tile:${name}:${color}`}</RNText>
    ),
  };
});

type Account = Pick<AccountRow, 'name' | 'kind' | 'icon' | 'color' | 'institution' | 'archivedAt'>;

type ListedReminder = { reminder: ReminderRow; account: Account };

const CASH: Account = {
  name: 'Cash',
  kind: 'cash',
  icon: null,
  color: null,
  institution: null,
  archivedAt: null,
};
const CARD: Account = {
  name: 'Card',
  kind: 'bank',
  icon: 'creditcard',
  color: '#AF52DE',
  institution: 'monobank',
  archivedAt: null,
};

const listed = (overrides: Partial<ReminderRow> = {}, account: Account = CASH): ListedReminder => ({
  reminder: savedReminder(overrides),
  account,
});

const CARD_AND_CASH = [
  listed({ id: 'r-1', accountId: 'a-2', kind: 'statement_import' }, CARD),
  listed({ id: 'r-2', accountId: 'a-1', kind: 'add_transactions' }, CASH),
];

const seed = (rows: ListedReminder[], loading = false): void => {
  mockUseLiveQuery.mockImplementation(() => ({ data: rows, isLoading: loading, isFresh: true }));
};

let navigation = navigationSpy();

const renderScreen = () =>
  render(
    <RemindersScreen
      navigation={asNavigationProp<RemindersProps['navigation']>(navigation)}
      route={asRouteProp<RemindersProps['route']>('Reminders')}
    />,
    { wrapper: GestureRootWrapper },
  );

const EMPTY_LIST = 'No reminders yet';
const EMPTY_HINT = 'Set up a reminder from an account’s page.';

beforeEach(() => {
  navigation = navigationSpy();
  mockSyncReminders.mockResolvedValue(undefined);
  authorizationStatus.mockReset().mockResolvedValue('authorized');
  requestAuthorization.mockReset().mockResolvedValue(true);
});

describe('RemindersScreen — list', () => {
  it('reads every reminder with its account, live on the tables its rows depend on', async () => {
    seed([]);

    await renderScreen();

    expect(mockUseLiveQuery).toHaveBeenCalledWith(
      expect.anything(),
      ['reminders', 'accounts'],
      true,
      { cached: true },
    );
  });

  it('lists each reminder under the name of its account', async () => {
    seed(CARD_AND_CASH);

    const { getByTestId, getAllByText } = await renderScreen();

    const card = getByTestId('reminders-account-a-2');
    const cash = getByTestId('reminders-account-a-1');

    expect(within(card).getByText('Card')).toBeTruthy();
    expect(within(card).getByText('Statement import')).toBeTruthy();
    expect(within(card).queryByText('Add transactions')).toBeNull();
    expect(within(cash).getByText('Cash')).toBeTruthy();
    expect(within(cash).getByText('Add transactions')).toBeTruthy();
    expect(getAllByText(/^(Card|Cash)$/).map((text) => text.props.children)).toEqual([
      'Card',
      'Cash',
    ]);
  });

  it('shows each account’s icon tile beside its name', async () => {
    seed(CARD_AND_CASH);

    const { getByTestId } = await renderScreen();

    expect(
      within(getByTestId('reminders-account-a-2')).getByText('tile:creditcard:#AF52DE'),
    ).toBeTruthy();
    expect(
      within(getByTestId('reminders-account-a-1')).getByText(
        `tile:${accountKindSymbol.cash}:${defaultAccountColor.cash}`,
      ),
    ).toBeTruthy();
  });

  it('separates the accounts with a divider, and only between them', async () => {
    seed([
      listed({ id: 'r-1', accountId: 'a-1' }, CASH),
      listed({ id: 'r-2', accountId: 'a-2', kind: 'statement_import' }, CARD),
      listed({ id: 'r-3', accountId: 'a-3' }, { ...CASH, name: 'Savings' }),
    ]);

    const { getAllByTestId } = await renderScreen();

    expect(getAllByTestId('reminders-account-divider')).toHaveLength(2);
  });

  it('lists import first within an account', async () => {
    seed([
      listed({ id: 'r-1', kind: 'add_transactions' }, CASH),
      listed({ id: 'r-2', kind: 'statement_import' }, CASH),
    ]);

    const { getAllByText } = await renderScreen();

    expect(
      getAllByText(/^(Statement import|Add transactions)$/).map((text) => text.props.children),
    ).toEqual(['Statement import', 'Add transactions']);
  });

  it('shows each saved schedule', async () => {
    seed([listed()]);

    const { getByText } = await renderScreen();

    expect(getByText('Every day at 20:00')).toBeTruthy();
  });

  it('says why a reminder the account no longer allows is not sent', async () => {
    seed([listed({ kind: 'add_transactions' }, CARD)]);

    const { getByText } = await renderScreen();

    expect(getByText('Available only for accounts you track by hand.')).toBeTruthy();
  });

  it('never says an import reminder is not sent, on a synced account with no import too', async () => {
    seed([listed({ kind: 'statement_import' }, CARD)]);

    const { getByText, getAllByText } = await renderScreen();

    expect(getByText('Statement import')).toBeTruthy();
    expect(getAllByText(/./).map((text) => text.props.children)).not.toContainEqual(
      expect.stringMatching(/^Available/),
    );
  });

  it('says a reminder is not sent while its account is archived', async () => {
    seed([listed({}, { ...CASH, archivedAt: 1 })]);

    const { getByText } = await renderScreen();

    expect(getByText('Not sent while the account is archived.')).toBeTruthy();
  });

  it('explains an empty list', async () => {
    seed([]);

    const { getByText } = await renderScreen();

    expect(getByText(EMPTY_LIST)).toBeTruthy();
    expect(getByText(EMPTY_HINT)).toBeTruthy();
  });

  it('shows a spinner, and no empty state, until the list is read', async () => {
    seed([], true);

    const { getByTestId, queryByText } = await renderScreen();

    expect(getByTestId('reminders-loading')).toBeTruthy();
    expect(queryByText(EMPTY_LIST)).toBeNull();
  });

  it('opens a reminder by its id', async () => {
    seed([listed({ id: 'r-7' })]);

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Add transactions'));

    expect(navigation.navigate).toHaveBeenCalledWith('ReminderForm', { reminderId: 'r-7' });
  });

  it('pauses a reminder from its switch, then re-plans', async () => {
    seed([listed({ id: 'r-7' })]);

    const { getByLabelText } = await renderScreen();

    await fireEvent(getByLabelText('Reminder on'), 'valueChange', false);

    expect(remindersRepo.setPaused).toHaveBeenCalledWith('r-7', true);
    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalled());
  });

  it('resumes a paused reminder from its switch, then re-plans', async () => {
    seed([listed({ id: 'r-7', pausedAt: 1, pauseReason: 'user' })]);

    const { getByLabelText } = await renderScreen();

    await fireEvent(getByLabelText('Reminder on'), 'valueChange', true);

    expect(remindersRepo.setPaused).toHaveBeenCalledWith('r-7', false);
    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalled());
  });

  it('deletes a reminder from the touch-and-hold menu, then re-plans', async () => {
    seed([listed({ id: 'r-7' })]);

    const { getByTestId } = await renderScreen();

    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(remindersRepo.remove).toHaveBeenCalledWith('r-7');
    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalled());
  });
});

describe('RemindersScreen — notification permission', () => {
  permissionNoticeCases({
    renderList: (withReminder) => {
      seed(withReminder ? [listed()] : []);

      return renderScreen();
    },
    syncReminders: mockSyncReminders,
  });
});
