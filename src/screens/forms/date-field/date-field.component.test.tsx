import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import '../../../design-system/unistyles';
import { formatDate } from '../../../dates/format';
import DateField from './date-field.component';

describe('DateField', () => {
  it('shows the placeholder while no date is picked', async () => {
    const { getByText } = await render(
      <DateField label="Start Date" value={null} onChange={jest.fn()} placeholder="Pick a day" />,
    );

    expect(getByText('Pick a day')).toBeTruthy();
  });

  it('shows the picked date as DD.MM.YYYY', async () => {
    const value = new Date(2026, 0, 15).getTime();
    const { getByText } = await render(
      <DateField label="Start Date" value={value} onChange={jest.fn()} />,
    );

    expect(getByText(formatDate(value))).toBeTruthy();
  });

  it('pads the sheet clear of the home indicator (bottom safe-area inset)', async () => {
    const { getByLabelText, getByTestId } = await render(
      <DateField label="Start Date" value={null} onChange={jest.fn()} />,
    );

    await fireEvent.press(getByLabelText('Start Date'));

    // Walk up from the calendar itself to the sheet Box that wraps it.
    let node = getByTestId('Start Date calendar');
    while (node && StyleSheet.flatten(node.props.style)?.paddingBottom === undefined) {
      node = node.parent;
    }

    // The safe-area mock reports a 0 bottom inset by default, so the padding
    // collapses to the sheet's own base spacing(4) = 16 — this only proves the
    // inset is additive, not double-subtracted or dropped.
    expect(StyleSheet.flatten(node.props.style).paddingBottom).toBeGreaterThanOrEqual(16);
  });

  it('is inert and dimmed when disabled: a press does not open the calendar', async () => {
    const { getByLabelText, queryByTestId } = await render(
      <DateField label="Start Date" value={null} onChange={jest.fn()} disabled />,
    );

    const field = getByLabelText('Start Date');
    // A disabled field reports its disabled a11y state and swallows the press so
    // a synced (Monobank) transaction's date cannot be changed here.
    expect(field.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(field);
    expect(queryByTestId('Start Date calendar')).toBeNull();
  });

  it('dims the field to read as locked when disabled', async () => {
    const { getByText } = await render(
      <DateField
        label="Start Date"
        value={null}
        onChange={jest.fn()}
        placeholder="Pick a day"
        disabled
      />,
    );

    // The bordered field chip dims to opacity 0.5, matching the disabled
    // TextField / ChipRow treatment; the field row is the parent of the
    // placeholder Text (placeholder Text -> field Box).
    const fieldRow = getByText('Pick a day').parent;
    expect(StyleSheet.flatten(fieldRow?.props.style).opacity).toBe(0.5);
  });

  it('opens the calendar and reports the picked day as a local-midnight timestamp', async () => {
    const onChange = jest.fn();
    const { getByLabelText, getByTestId } = await render(
      <DateField label="Start Date" value={null} onChange={onChange} />,
    );

    await fireEvent.press(getByLabelText('Start Date'));
    await fireEvent(getByTestId('Start Date calendar'), 'dayPress', {
      year: 2026,
      month: 3,
      day: 4,
      dateString: '2026-03-04',
      timestamp: 0,
    });

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 2, 4).getTime());
  });
});
