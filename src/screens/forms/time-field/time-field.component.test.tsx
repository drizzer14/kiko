import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import '../../../design-system/unistyles';
import { formatTime } from '../../../dates/format';

import TimeField from './time-field.component';

describe('TimeField', () => {
  it('shows the placeholder while no time is set', async () => {
    const { getByText } = await render(
      <TimeField label="Time" value={null} onChange={jest.fn()} placeholder="Pick a time" />,
    );

    expect(getByText('Pick a time')).toBeTruthy();
  });

  it('shows the current time-of-day as HH:mm', async () => {
    const value = new Date(2026, 2, 4, 9, 5).getTime();
    const { getByText } = await render(
      <TimeField label="Time" value={value} onChange={jest.fn()} />,
    );

    expect(getByText(formatTime(value))).toBeTruthy();
    expect(getByText('09:05')).toBeTruthy();
  });

  it('combines the picked hours/minutes with the DAY of the current value', async () => {
    const onChange = jest.fn();
    // Current value: 4 March 2026, 09:30.
    const value = new Date(2026, 2, 4, 9, 30).getTime();
    const { getByLabelText, getByTestId } = await render(
      <TimeField label="Time" value={value} onChange={onChange} />,
    );

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
    const value = new Date(2026, 2, 4, 9, 30).getTime();
    const { getByLabelText, getByTestId } = await render(
      <TimeField label="Time" value={value} onChange={onChange} />,
    );

    await fireEvent.press(getByLabelText('Time'));
    // A dismissal fires onChange with no second argument.
    await fireEvent(getByTestId('Time picker'), 'change', { type: 'dismissed' }, undefined);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('is inert and dimmed when disabled: a press does not open the picker', async () => {
    const { getByLabelText, queryByTestId } = await render(
      <TimeField
        label="Time"
        value={new Date(2026, 2, 4, 9, 30).getTime()}
        onChange={jest.fn()}
        disabled
      />,
    );

    const field = getByLabelText('Time');
    expect(field.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(field);
    expect(queryByTestId('Time picker')).toBeNull();
  });

  it('dims the field to read as locked when disabled', async () => {
    const { getByText } = await render(
      <TimeField
        label="Time"
        value={null}
        onChange={jest.fn()}
        placeholder="Pick a time"
        disabled
      />,
    );

    const fieldRow = getByText('Pick a time').parent;
    expect(StyleSheet.flatten(fieldRow?.props.style).opacity).toBe(0.5);
  });
});
