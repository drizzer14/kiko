import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { remindersRepo } from '@kiko/reminders/repo';
import { remindersNative } from '@kiko/reminders/native';
import { scrollToField, useHeaderInset } from '@kiko/design-system/scroll-to-field';
import { expectNavBarSaveOnly, pressSave } from '@kiko/test-support/form-header-items';
import { localDayOf, type ReminderSchedule, weekdayOf } from '@kiko/reminders/schedule';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import ReminderFormScreen from '.';

type ReminderFormProps = ComponentProps<typeof ReminderFormScreen>;

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
    byIdQuery: (reminderId: string) => ({ toSQL: () => ({ sql: '', params: [reminderId] }) }),
    create: jest.fn(async () => 'r-new'),
    update: jest.fn(async () => undefined),
  },
}));
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

const authorizationStatus = jest.spyOn(remindersNative, 'authorizationStatus');
const requestAuthorization = jest.spyOn(remindersNative, 'requestAuthorization');

const today = localDayOf(Date.now());

const savedReminder = (schedule: ReminderSchedule) => ({
  id: 'r-1',
  accountId: 'a-1',
  kind: 'add_transactions',
  schedule,
  pausedAt: null,
  pauseReason: null,
  activeSince: 0,
  lastEngagedAt: null,
  lastSnoozedAt: null,
  createdAt: 0,
  updatedAt: 0,
});

let navigation = navigationSpy();

const renderCreate = (kind: 'statement_import' | 'add_transactions' = 'add_transactions') => {
  mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false, isFresh: true });

  return render(
    <ReminderFormScreen
      navigation={asNavigationProp<ReminderFormProps['navigation']>(navigation)}
      route={asRouteProp<ReminderFormProps['route']>('ReminderForm', { accountId: 'a-1', kind })}
    />,
  );
};

const renderEdit = (schedule: ReminderSchedule) => {
  mockUseLiveQuery.mockReturnValue({
    data: [savedReminder(schedule)],
    isLoading: false,
    isFresh: true,
  });

  return render(
    <ReminderFormScreen
      navigation={asNavigationProp<ReminderFormProps['navigation']>(navigation)}
      route={asRouteProp<ReminderFormProps['route']>('ReminderForm', { reminderId: 'r-1' })}
    />,
  );
};

type Screen = Awaited<ReturnType<typeof renderCreate>>;

const DAY_NAME = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/;

const selectedDayNames = (screen: Screen): string[] =>
  screen
    .getAllByRole('button')
    .filter((button) => button.props.accessibilityState?.selected === true)
    .flatMap((button) => within(button).queryAllByText(DAY_NAME))
    .map((text) => String(text.props.children));

// The Jest Modal unmounts once hidden, so the close report is read while the
// sheet is still up and called after it closes, as iOS does.
const closedSignalOf = (screen: Screen): (() => void) =>
  screen.getByTestId('notification-pre-alert-sheet-modal').props.onDismiss;

const pickTime = async (screen: Screen, hours: number, minutes: number): Promise<void> => {
  await fireEvent.press(screen.getByLabelText('Time'));
  await fireEvent(
    screen.getByTestId('Time picker'),
    'change',
    { type: 'set' },
    new Date(1999, 11, 31, hours, minutes),
  );
};

beforeEach(() => {
  navigation = navigationSpy();
  mockSyncReminders.mockResolvedValue(undefined);
  authorizationStatus.mockReset().mockResolvedValue('authorized');
  requestAuthorization.mockReset().mockResolvedValue(true);
});

describe('ReminderFormScreen — create', () => {
  it('explains what the reminder is for', async () => {
    const screen = await renderCreate('statement_import');

    expect(
      screen.getByText('Reminds you to import a new statement for this account.'),
    ).toBeTruthy();
  });

  it('offers Save only as the prominent nav-bar item, never as a body button', async () => {
    expectNavBarSaveOnly(navigation.setOptions, await renderCreate());
  });

  it('saves an add-transactions reminder daily at 20:00 by default', async () => {
    await renderCreate('add_transactions');

    await pressSave(navigation.setOptions);

    expect(remindersRepo.create).toHaveBeenCalledWith({
      accountId: 'a-1',
      kind: 'add_transactions',
      schedule: { frequency: 'daily', minuteOfDay: 20 * 60 },
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('saves an import reminder monthly on day 1 at 19:00 by default', async () => {
    await renderCreate('statement_import');

    await pressSave(navigation.setOptions);

    expect(remindersRepo.create).toHaveBeenCalledWith({
      accountId: 'a-1',
      kind: 'statement_import',
      schedule: { frequency: 'monthly', minuteOfDay: 19 * 60, dayOfMonth: 1 },
    });
  });

  it('saves the time the user picked, keeping only its hours and minutes', async () => {
    const screen = await renderCreate();

    await pickTime(screen, 7, 15);
    await pressSave(navigation.setOptions);

    expect(remindersRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: { frequency: 'daily', minuteOfDay: 7 * 60 + 15 } }),
    );
  });

  it('shows the saved time in the time field', async () => {
    const screen = await renderCreate();

    expect(within(screen.getByLabelText('Time')).getByText('20:00')).toBeTruthy();
  });

  it('preselects today’s weekday on a switch to weekly, and saves the days picked', async () => {
    const screen = await renderCreate();

    await fireEvent.press(screen.getByText('Weekly'));

    expect(selectedDayNames(screen)).toHaveLength(1);

    const otherDay = weekdayOf(today) === 3 ? 'Thu' : 'Wed';
    const otherWeekday = otherDay === 'Thu' ? 4 : 3;

    await fireEvent.press(screen.getByText(otherDay));
    await pressSave(navigation.setOptions);

    expect(remindersRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: {
          frequency: 'weekly',
          minuteOfDay: 20 * 60,
          weekdays: [weekdayOf(today), otherWeekday].sort((left, right) => left - right),
        },
      }),
    );
  });

  it('saves a monthly reminder on the day picked', async () => {
    const screen = await renderCreate();

    await fireEvent.press(screen.getByText('Monthly'));
    await fireEvent.press(screen.getByTestId('reminder-day-of-month-option-31'));
    await pressSave(navigation.setOptions);

    expect(remindersRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: { frequency: 'monthly', minuteOfDay: 20 * 60, dayOfMonth: 31 },
      }),
    );
  });

  it('marks the saved day in the day grid on edit', async () => {
    const screen = await renderEdit({ frequency: 'monthly', minuteOfDay: 20 * 60, dayOfMonth: 15 });

    expect(
      screen.getByTestId('reminder-day-of-month-option-15').props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(
      screen.getByTestId('reminder-day-of-month-option-1').props.accessibilityState,
    ).toMatchObject({ selected: false });
  });

  it.each([29, 30, 31])('shows the last-day hint for day %i, and not for day 28', async (day) => {
    const hint = 'In shorter months, the reminder comes on the last day.';
    const screen = await renderCreate('statement_import');

    expect(screen.queryByText(hint)).toBeNull();

    await fireEvent.press(screen.getByTestId(`reminder-day-of-month-option-${day}`));

    expect(screen.getByText(hint)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('reminder-day-of-month-option-28'));

    expect(screen.queryByText(hint)).toBeNull();
  });

  it('preselects 7 days on a switch to every N days, and saves the interval anchored on today', async () => {
    const screen = await renderCreate();

    await fireEvent.press(screen.getByText('Every N days'));

    expect(screen.getByLabelText('Repeat every').props.value).toBe('7');

    await fireEvent.changeText(screen.getByLabelText('Repeat every'), '14');
    await pressSave(navigation.setOptions);

    expect(remindersRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: { frequency: 'interval', minuteOfDay: 20 * 60, everyDays: 14, anchorDay: today },
      }),
    );
  });

  it('blocks a weekly save with no day, shows the error under the days, and scrolls to it', async () => {
    const screen = await renderCreate();

    await fireEvent.press(screen.getByText('Weekly'));

    const [preselectedDay] = selectedDayNames(screen);

    await fireEvent.press(screen.getByText(preselectedDay));

    expect(selectedDayNames(screen)).toEqual([]);

    await pressSave(navigation.setOptions);

    expect(screen.getByText('No days selected.')).toBeTruthy();
    expect(remindersRepo.create).not.toHaveBeenCalled();
    expect(scrollToField).toHaveBeenCalledTimes(1);
  });

  it('blocks an interval outside 2-365, shows the error under the field, and scrolls to it', async () => {
    const screen = await renderCreate();

    await fireEvent.press(screen.getByText('Every N days'));
    await fireEvent.changeText(screen.getByLabelText('Repeat every'), '1');
    await pressSave(navigation.setOptions);

    expect(screen.getByText('Enter a number of days from 2 to 365.')).toBeTruthy();
    expect(remindersRepo.create).not.toHaveBeenCalled();
    expect(scrollToField).toHaveBeenCalledTimes(1);
  });

  it('scrolls each blocked field, with the live scroll geometry, to a different mounted target', async () => {
    (useHeaderInset as jest.Mock).mockReturnValue(96);
    const scrollToFieldMock = scrollToField as jest.Mock;
    const screen = await renderCreate();

    await fireEvent(screen.getByTestId('screen-scroll-view'), 'contentSizeChange', 0, 640);
    await fireEvent.press(screen.getByText('Weekly'));
    const [preselectedDay] = selectedDayNames(screen);

    await fireEvent.press(screen.getByText(preselectedDay));
    await pressSave(navigation.setOptions);

    const [scrollableRef, weekdaysFieldRef, weekdaysGeometry, weekdaysOnSettled] =
      scrollToFieldMock.mock.calls[0];
    expect(scrollableRef).toEqual({ current: null });
    expect(weekdaysFieldRef.current).not.toBeNull();
    expect(weekdaysGeometry).toEqual({ currentOffset: 0, headerInset: 96, contentHeight: 640 });
    expect(weekdaysOnSettled).toBeUndefined();

    await fireEvent.press(screen.getByText('Every N days'));
    await fireEvent.changeText(screen.getByLabelText('Repeat every'), '1');
    scrollToFieldMock.mockClear();
    await pressSave(navigation.setOptions);

    const [, intervalFieldRef, intervalGeometry, intervalOnSettled] =
      scrollToFieldMock.mock.calls[0];
    expect(intervalFieldRef.current).not.toBeNull();
    expect(intervalFieldRef).not.toBe(weekdaysFieldRef);
    expect(intervalGeometry).toEqual({ currentOffset: 0, headerInset: 96, contentHeight: 640 });
    expect(intervalOnSettled).toEqual(expect.any(Function));
  });

  it('re-plans the reminders after the write', async () => {
    await renderCreate();

    await pressSave(navigation.setOptions);

    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalled());
  });

  it('keeps the form open and says so when the write fails', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    jest.mocked(remindersRepo.create).mockRejectedValueOnce(new Error('disk full'));

    await renderCreate();

    await pressSave(navigation.setOptions);

    expect(alert).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();

    alert.mockRestore();
  });
});

describe('ReminderFormScreen — notification permission', () => {
  it('saves and goes back with no pre-alert once notifications are allowed', async () => {
    const screen = await renderCreate();

    await pressSave(navigation.setOptions);

    expect(screen.queryByText('Reminder Notifications')).toBeNull();
    expect(requestAuthorization).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('saves and goes back with no pre-alert when notifications are denied', async () => {
    authorizationStatus.mockResolvedValue('denied');

    const screen = await renderCreate();

    await pressSave(navigation.setOptions);

    expect(remindersRepo.create).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Reminder Notifications')).toBeNull();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('shows a pre-alert with exactly one button, not labelled Allow, on the first save', async () => {
    authorizationStatus.mockResolvedValue('notDetermined');

    const screen = await renderCreate();

    await pressSave(navigation.setOptions);

    expect(remindersRepo.create).toHaveBeenCalledTimes(1);

    const sheet = screen.getByTestId('notification-pre-alert-sheet');
    const buttons = within(sheet).getAllByRole('button');

    expect(buttons).toHaveLength(1);
    expect(within(buttons[0]).getByText('Continue')).toBeTruthy();
    expect(within(buttons[0]).queryByText(/allow/i)).toBeNull();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(requestAuthorization).not.toHaveBeenCalled();
  });

  it('asks iOS once the pre-alert has closed, then re-plans and goes back, even when denied', async () => {
    authorizationStatus.mockResolvedValue('notDetermined');
    requestAuthorization.mockImplementation(async () => {
      authorizationStatus.mockResolvedValue('denied');

      return false;
    });

    const screen = await renderCreate();

    await pressSave(navigation.setOptions);
    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalledTimes(1));

    const reportClosed = closedSignalOf(screen);

    await fireEvent.press(screen.getByText('Continue'));

    expect(screen.queryByText('Reminder Notifications')).toBeNull();
    expect(requestAuthorization).not.toHaveBeenCalled();

    await act(async () => {
      reportClosed();
    });

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(requestAuthorization).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalledTimes(2));
    expect(remindersRepo.create).toHaveBeenCalledTimes(1);
  });

  it('asks iOS only once even if the closed signal repeats', async () => {
    authorizationStatus.mockResolvedValue('notDetermined');

    const screen = await renderCreate();

    await pressSave(navigation.setOptions);

    const reportClosed = closedSignalOf(screen);

    await fireEvent.press(screen.getByText('Continue'));
    await act(async () => {
      reportClosed();
      reportClosed();
    });

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(requestAuthorization).toHaveBeenCalledTimes(1);
  });
});

describe('ReminderFormScreen — localization', () => {
  const enterEveryDays = async (screen: Screen, everyDaysText: string): Promise<void> => {
    await fireEvent.press(screen.getByText(i18n.t('reminders.form.frequencyInterval')));
    await fireEvent.changeText(
      screen.getByLabelText(i18n.t('reminders.form.intervalDays')),
      everyDaysText,
    );
  };

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it.each([
    ['1', 'day'],
    ['7', 'days'],
    ['21', 'days'],
    ['', 'days'],
  ])('reads %p days as %p in English', async (everyDaysText, suffix) => {
    const screen = await renderCreate();

    await enterEveryDays(screen, everyDaysText);

    expect(screen.getByText(suffix)).toBeTruthy();
  });

  // Ukrainian's "other" form ("дня") is only for a fraction, which the
  // whole-number field treats as no number.
  it.each([
    ['21', 'день'],
    ['2', 'дні'],
    ['22', 'дні'],
    ['5', 'днів'],
    ['11', 'днів'],
    ['', 'днів'],
    ['1.5', 'днів'],
  ])('reads %p days as %p in Ukrainian', async (everyDaysText, suffix) => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const screen = await renderCreate();

    await enterEveryDays(screen, everyDaysText);

    expect(screen.getByText(suffix)).toBeTruthy();
  });

  it('titles the edit screen from the Ukrainian catalogue', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    await renderEdit({ frequency: 'daily', minuteOfDay: 8 * 60 });

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Редагувати нагадування' });
  });
});

describe('ReminderFormScreen — edit', () => {
  it('titles the screen as an edit and fills in the saved schedule', async () => {
    const screen = await renderEdit({ frequency: 'weekly', minuteOfDay: 8 * 60, weekdays: [1, 3] });

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Reminder' });
    expect(screen.getByText('Weekly').props).toBeTruthy();
    expect(within(screen.getByLabelText('Time')).getByText('08:00')).toBeTruthy();
    expect(selectedDayNames(screen)).toEqual(['Mon', 'Wed']);
  });

  it('updates the saved reminder rather than creating one', async () => {
    const screen = await renderEdit({ frequency: 'daily', minuteOfDay: 8 * 60 });

    await pickTime(screen, 9, 30);
    await pressSave(navigation.setOptions);

    expect(remindersRepo.update).toHaveBeenCalledWith('r-1', {
      frequency: 'daily',
      minuteOfDay: 9 * 60 + 30,
    });
    expect(remindersRepo.create).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('keeps the saved interval anchor when the length stays the same', async () => {
    const anchorDay = { year: 2026, month: 1, day: 5 };
    await renderEdit({
      frequency: 'interval',
      minuteOfDay: 8 * 60,
      everyDays: 10,
      anchorDay,
    });

    await pressSave(navigation.setOptions);

    expect(remindersRepo.update).toHaveBeenCalledWith('r-1', {
      frequency: 'interval',
      minuteOfDay: 8 * 60,
      everyDays: 10,
      anchorDay,
    });
  });

  it('starts a stored schedule of an unknown shape from the kind defaults', async () => {
    const screen = await renderEdit({ frequency: 'hourly' } as never);

    expect(within(screen.getByLabelText('Time')).getByText('20:00')).toBeTruthy();

    await pressSave(navigation.setOptions);

    expect(remindersRepo.update).toHaveBeenCalledWith('r-1', {
      frequency: 'daily',
      minuteOfDay: 20 * 60,
    });
  });

  // A reminder is deleted from the page's touch-and-hold menu, the same way
  // a transaction is.
  it('offers no Delete in the form, while creating or editing', async () => {
    const creating = await renderCreate();

    expect(creating.queryByText('Delete reminder')).toBeNull();

    const editing = await renderEdit({ frequency: 'daily', minuteOfDay: 8 * 60 });

    expect(editing.queryByText('Delete reminder')).toBeNull();
  });
});
