import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import type { ReminderRow as SavedReminder } from '@kiko/db';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';

import ReminderRow from '.';
import type { ReminderRowProps } from './reminder-row.props';

const saved = (overrides: Partial<SavedReminder> = {}): SavedReminder => ({
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

const renderRow = async (overrides: Partial<ReminderRowProps> = {}) => {
  const props: ReminderRowProps = {
    kind: 'add_transactions',
    reminder: saved(),
    available: true,
    accountArchived: false,
    onOpen: jest.fn(),
    onPausedChange: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  };
  const view = await render(<ReminderRow {...props} />, { wrapper: GestureRootWrapper });

  return { props, ...view };
};

const holdToDelete = async (): Promise<void> => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);
  });
};

describe('ReminderRow', () => {
  it('shows the kind and the schedule of a saved reminder', async () => {
    const { getByText } = await renderRow();

    expect(getByText('Add transactions')).toBeTruthy();
    expect(getByText('Every day at 20:00')).toBeTruthy();
  });

  it('shows Off, with no switch, when the kind has no reminder yet', async () => {
    const { getByText, queryByLabelText } = await renderRow({
      kind: 'statement_import',
      reminder: undefined,
    });

    expect(getByText('Statement import')).toBeTruthy();
    expect(getByText('Off')).toBeTruthy();
    expect(queryByLabelText('Reminder on')).toBeNull();
  });

  it('reads a stored schedule of an unknown shape as Off instead of failing', async () => {
    const restored = saved({ schedule: { frequency: 'hourly' } as never });
    const { getByText } = await renderRow({ reminder: restored });

    expect(getByText('Off')).toBeTruthy();
  });

  it('opens the reminder on a tap', async () => {
    const { getByText, props } = await renderRow();

    await fireEvent.press(getByText('Add transactions'));

    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it('turns the switch on for an active reminder, and off for a paused one', async () => {
    const active = await renderRow();

    expect(active.getByLabelText('Reminder on').props.value).toBe(true);

    const paused = await renderRow({ reminder: saved({ pausedAt: 1, pauseReason: 'user' }) });

    expect(paused.getByLabelText('Reminder on').props.value).toBe(false);
  });

  it('pauses when switched off, and resumes when switched on', async () => {
    const onPausedChange = jest.fn();
    const active = await renderRow({ onPausedChange });

    await fireEvent(active.getByLabelText('Reminder on'), 'valueChange', false);

    expect(onPausedChange).toHaveBeenLastCalledWith(true);

    const paused = await renderRow({
      reminder: saved({ pausedAt: 1, pauseReason: 'backoff' }),
      onPausedChange,
    });

    await fireEvent(paused.getByLabelText('Reminder on'), 'valueChange', true);

    expect(onPausedChange).toHaveBeenLastCalledWith(false);
  });

  it('says a reminder paused itself after no response', async () => {
    const { getByText } = await renderRow({
      reminder: saved({ pausedAt: 1, pauseReason: 'backoff' }),
    });

    expect(getByText('Paused after 3 reminders with no response.')).toBeTruthy();
  });

  it('does not blame no response for a pause the user made', async () => {
    const { queryByText } = await renderRow({
      reminder: saved({ pausedAt: 1, pauseReason: 'user' }),
    });

    expect(queryByText('Paused after 3 reminders with no response.')).toBeNull();
  });

  it('says nothing is sent while the account is archived', async () => {
    const { getByText } = await renderRow({ accountArchived: true });

    expect(getByText('Not sent while the account is archived.')).toBeTruthy();
  });

  it('says a reminder the account no longer allows is not available', async () => {
    const { getByText } = await renderRow({ available: false });

    expect(getByText('Not available while the account is connected to a bank.')).toBeTruthy();
  });

  it('deletes a saved reminder from the touch-and-hold menu, after the confirm', async () => {
    const { getByText, getByTestId, props } = await renderRow();

    await holdToDelete();

    expect(getByText('Delete "Add transactions"')).toBeTruthy();
    expect(props.onDelete).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it('offers no delete when there is nothing saved', async () => {
    await renderRow({ reminder: undefined });

    expect(() => getByGestureTestId(HOLD_GESTURE_TEST_ID)).toThrow();
  });
});
