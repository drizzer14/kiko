import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { formatTime } from '@kiko/dates';
import { remindersNative } from '@kiko/reminders/native';

import TimeField from './time-field.component';
import type { TimeFieldProps } from './time-field.props';

// Current value: 4 March 2026, 09:30.
const MORNING = new Date(2026, 2, 4, 9, 30).getTime();

const renderTimeField = (overrides: Partial<TimeFieldProps> = {}) =>
  render(
    <TimeField
      label="Time"
      sheetTitle="Select a Time"
      value={MORNING}
      onChange={jest.fn()}
      placeholder="Pick a time"
      {...overrides}
    />,
  );

describe('TimeField', () => {
  it('shows the placeholder while no time is set', async () => {
    const { getByText } = await renderTimeField({ value: null });

    expect(getByText('Pick a time')).toBeTruthy();
  });

  it('shows the current time-of-day as HH:mm', async () => {
    const value = new Date(2026, 2, 4, 9, 5).getTime();
    const { getByText } = await renderTimeField({ value });

    expect(getByText(formatTime(value, { uses24Hour: true }))).toBeTruthy();
    expect(getByText('09:05')).toBeTruthy();
  });

  // The native picker follows the iOS 24-Hour Time setting, so the label must too.
  it('shows the time on the 12-hour clock when the device uses it', async () => {
    const uses24HourClock = jest.spyOn(remindersNative, 'uses24HourClock').mockReturnValue(false);
    const value = new Date(2026, 2, 4, 21, 5).getTime();

    const { getByText } = await renderTimeField({ value });

    expect(getByText('9:05\xA0PM')).toBeTruthy();
    uses24HourClock.mockRestore();
  });

  it('shows sheetTitle, not label, as the sheet header', async () => {
    const { getByLabelText, queryByText } = await renderTimeField();

    expect(queryByText('Select a Time')).toBeNull();

    await fireEvent.press(getByLabelText('Time'));

    expect(queryByText('Select a Time')).toBeTruthy();
  });

  it('combines the picked hours/minutes with the DAY of the current value', async () => {
    const onChange = jest.fn();
    const { getByLabelText, getByTestId } = await renderTimeField({ onChange });

    await fireEvent.press(getByLabelText('Time'));
    // The user picks 14:45 — the calendar day of the picked Date is irrelevant;
    // only its time-of-day is combined with the value's day.
    await fireEvent(
      getByTestId('Time picker'),
      'change',
      { type: 'set' },
      new Date(1999, 11, 31, 14, 45),
    );

    // Day stays 4 March 2026; time becomes 14:45.
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 2, 4, 14, 45).getTime());
  });

  it('ignores a dismissed pick with no date', async () => {
    const onChange = jest.fn();
    const { getByLabelText, getByTestId } = await renderTimeField({ onChange });

    await fireEvent.press(getByLabelText('Time'));
    // A dismissal fires onChange with no second argument.
    await fireEvent(getByTestId('Time picker'), 'change', { type: 'dismissed' }, undefined);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('is inert and dimmed when disabled: a press does not open the picker', async () => {
    const { getByLabelText, queryByTestId } = await renderTimeField({ disabled: true });

    const field = getByLabelText('Time');
    expect(field.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(field);
    expect(queryByTestId('Time picker')).toBeNull();
  });

  it('dims the field to read as locked when disabled', async () => {
    const { getByText } = await renderTimeField({ value: null, disabled: true });

    const fieldRow = getByText('Pick a time').parent;
    expect(StyleSheet.flatten(fieldRow?.props.style).opacity).toBe(0.5);
  });
});
