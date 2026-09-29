import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import { savedReminder } from '@kiko/test-support/saved-reminder';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';

import ReminderRow from '.';
import type { ReminderRowProps } from './reminder-row.props';

const renderRow = async (overrides: Partial<ReminderRowProps> = {}) => {
  const props: ReminderRowProps = {
    kind: 'add_transactions',
    reminder: savedReminder(),
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
    const restored = savedReminder({ schedule: { frequency: 'hourly' } as never });
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

    const paused = await renderRow({
      reminder: savedReminder({ pausedAt: 1, pauseReason: 'user' }),
    });

    expect(paused.getByLabelText('Reminder on').props.value).toBe(false);
  });

  it('pauses when switched off, and resumes when switched on', async () => {
    const onPausedChange = jest.fn();
    const active = await renderRow({ onPausedChange });

    await fireEvent(active.getByLabelText('Reminder on'), 'valueChange', false);

    expect(onPausedChange).toHaveBeenLastCalledWith(true);

    const paused = await renderRow({
      reminder: savedReminder({ pausedAt: 1, pauseReason: 'backoff' }),
      onPausedChange,
    });

    await fireEvent(paused.getByLabelText('Reminder on'), 'valueChange', true);

    expect(onPausedChange).toHaveBeenLastCalledWith(false);
  });

  // VoiceOver reads the row as one element, so the switch inside it is out of
  // reach; the row itself must carry the switch's state and action.
  it('gives VoiceOver the on state and a Turn off action on an active reminder', async () => {
    const { getByRole, props } = await renderRow();
    const row = getByRole('button', { name: /Add transactions/ });

    expect(row.props.accessibilityValue).toEqual({ text: 'On' });
    expect(row.props.accessibilityActions).toEqual([{ name: 'togglePaused', label: 'Turn off' }]);

    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'togglePaused' } });

    expect(props.onPausedChange).toHaveBeenCalledWith(true);
  });

  it('gives VoiceOver the off state and a Turn on action on a paused reminder', async () => {
    const { getByRole, props } = await renderRow({
      reminder: savedReminder({ pausedAt: 1, pauseReason: 'user' }),
    });
    const row = getByRole('button', { name: /Add transactions/ });

    expect(row.props.accessibilityValue).toEqual({ text: 'Off' });
    expect(row.props.accessibilityActions).toEqual([{ name: 'togglePaused', label: 'Turn on' }]);

    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'togglePaused' } });

    expect(props.onPausedChange).toHaveBeenCalledWith(false);
  });

  it('ignores another accessibility action', async () => {
    const { getByRole, props } = await renderRow();

    await fireEvent(getByRole('button', { name: /Add transactions/ }), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });

    expect(props.onPausedChange).not.toHaveBeenCalled();
  });

  it('offers no pause action when there is nothing saved', async () => {
    const { getByRole } = await renderRow({ kind: 'statement_import', reminder: undefined });
    const row = getByRole('button', { name: /Statement import/ });

    expect(row.props.accessibilityActions).toBeUndefined();
    expect(row.props.accessibilityValue?.text).toBeUndefined();
  });

  it('says a reminder paused itself after no response', async () => {
    const { getByText } = await renderRow({
      reminder: savedReminder({ pausedAt: 1, pauseReason: 'backoff' }),
    });

    expect(getByText('Paused after 3 reminders with no response.')).toBeTruthy();
  });

  it('does not blame no response for a pause the user made', async () => {
    const { queryByText } = await renderRow({
      reminder: savedReminder({ pausedAt: 1, pauseReason: 'user' }),
    });

    expect(queryByText('Paused after 3 reminders with no response.')).toBeNull();
  });

  it('says nothing is sent while the account is archived', async () => {
    const { getByText } = await renderRow({ accountArchived: true });

    expect(getByText('Not sent while the account is archived.')).toBeTruthy();
  });

  it('says an add-transactions reminder the account no longer allows needs a hand-kept account', async () => {
    const { getByText } = await renderRow({ available: false });

    expect(getByText('Available only for accounts you track by hand.')).toBeTruthy();
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
