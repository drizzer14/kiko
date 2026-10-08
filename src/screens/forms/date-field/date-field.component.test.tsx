import { formatDate } from '@kiko/dates';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';
import '@kiko/design-system/unistyles';

import DateField from './date-field.component';
import type { DateFieldProps } from './date-field.props';

const renderDateField = (overrides: Partial<DateFieldProps> = {}) =>
  render(
    <DateField
      label="Start Date"
      sheetTitle="Select a Start Date"
      value={null}
      onChange={jest.fn()}
      placeholder="Pick a day"
      {...overrides}
    />,
  );

describe('DateField', () => {
  it('shows the placeholder while no date is picked', async () => {
    const { getByText } = await renderDateField();

    expect(getByText('Pick a day')).toBeTruthy();
  });

  it('shows the picked date as DD.MM.YYYY', async () => {
    const value = new Date(2026, 0, 15).getTime();
    const { getByText } = await renderDateField({ value });

    expect(getByText(formatDate(value))).toBeTruthy();
  });

  it('pads the sheet clear of the home indicator (bottom safe-area inset)', async () => {
    const { getByLabelText, getByTestId } = await renderDateField();

    await fireEvent.press(getByLabelText('Start Date'));

    // Walk up from the calendar itself to the sheet Box that wraps it.
    const node = ancestorWithStyle(getByTestId('Start Date calendar'), 'paddingBottom');

    // The safe-area mock reports a 0 bottom inset by default, so the padding
    // collapses to the sheet's own base spacing(4) = 16 — this only proves the
    // inset is additive, not double-subtracted or dropped.
    expect(StyleSheet.flatten(node.props.style).paddingBottom).toBeGreaterThanOrEqual(16);
  });

  it('is inert and dimmed when disabled: a press does not open the calendar', async () => {
    const { getByLabelText, queryByTestId } = await renderDateField({ disabled: true });

    const field = getByLabelText('Start Date');
    // A disabled field reports its disabled a11y state and swallows the press so
    // a synced (Monobank) transaction's date cannot be changed here.
    expect(field.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(field);
    expect(queryByTestId('Start Date calendar')).toBeNull();
  });

  it('dims the field to read as locked when disabled', async () => {
    const { getByText } = await renderDateField({ disabled: true });

    // The bordered field chip dims to opacity 0.5, matching the disabled
    // TextField / ChipRow treatment; the field row is the parent of the
    // placeholder Text (placeholder Text -> field Box).
    const fieldRow = getByText('Pick a day').parent;
    expect(StyleSheet.flatten(fieldRow?.props.style).opacity).toBe(0.5);
  });

  it('shows sheetTitle, not label, as the sheet header', async () => {
    const { getByLabelText, queryByText } = await renderDateField();

    expect(queryByText('Select a Start Date')).toBeNull();

    await fireEvent.press(getByLabelText('Start Date'));

    expect(queryByText('Select a Start Date')).toBeTruthy();
  });

  it('opens the calendar on the current value', async () => {
    const value = new Date(2026, 2, 4).getTime();
    const { getByLabelText, getByTestId } = await renderDateField({ value });

    await fireEvent.press(getByLabelText('Start Date'));

    expect(getByTestId('Start Date calendar').props.initialDate).toBe('2026-03-04');
  });

  it('opens the calendar and reports the picked day as a local-midnight timestamp', async () => {
    const onChange = jest.fn();
    const { getByLabelText, getByTestId } = await renderDateField({ onChange });

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

  it('caps the calendar at the local day of maxDate, so a later day cannot be picked', async () => {
    const maxDate = new Date(2026, 9, 5, 23, 59).getTime();
    const { getByLabelText, getByTestId } = await renderDateField({ maxDate });

    await fireEvent.press(getByLabelText('Start Date'));

    expect(getByTestId('Start Date calendar').props.maxDate).toBe('2026-10-05');
  });

  it('leaves the calendar uncapped when no maxDate is given', async () => {
    const { getByLabelText, getByTestId } = await renderDateField();

    await fireEvent.press(getByLabelText('Start Date'));

    expect(getByTestId('Start Date calendar').props.maxDate).toBeUndefined();
  });

  it('preserves the existing time-of-day when only the day is re-picked', async () => {
    const onChange = jest.fn();
    // An existing value at 14:37:09 on 4 March 2026 — a day pick must move the
    // day only, never clobber the time-of-day back to midnight (so a paired
    // TimeField and DateField do not overwrite each other).
    const value = new Date(2026, 2, 4, 14, 37, 9).getTime();
    const { getByLabelText, getByTestId } = await renderDateField({ value, onChange });

    await fireEvent.press(getByLabelText('Start Date'));
    await fireEvent(getByTestId('Start Date calendar'), 'dayPress', {
      year: 2026,
      month: 6,
      day: 20,
      dateString: '2026-06-20',
      timestamp: 0,
    });

    // Day becomes 20 June 2026; the 14:37:09 time-of-day carries over.
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 5, 20, 14, 37, 9).getTime());
  });

  it('marks the label with a required asterisk when required', async () => {
    const { getByText } = await renderDateField({ required: true });

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders no error message by default', async () => {
    const { queryByText } = await renderDateField();

    expect(queryByText('Select a date.')).toBeNull();
  });

  it('renders the error message directly under the field when set, uniform with every other field (Option A: no outline)', async () => {
    const { getByText } = await renderDateField({ error: 'Select a date.' });

    expect(getByText('Select a date.')).toBeTruthy();
    // Same reflow error model as TextField: no per-field outline, ever — the
    // field row's own border stays its ordinary neutral token.
    const fieldRow = getByText('Pick a day').parent;
    expect(StyleSheet.flatten(fieldRow?.props.style).borderColor).not.toBe('#FF453A');
  });

  it('reflows rather than reserves: no error node renders while valid', async () => {
    const { queryByTestId } = await renderDateField({ testID: 'maturity-date-field' });

    expect(queryByTestId('maturity-date-field-error')).toBeNull();
  });

  it('derives the error testID from the field testID, matching TextField', async () => {
    const { getByTestId } = await renderDateField({
      error: 'Select a date.',
      testID: 'maturity-date-field',
    });

    expect(getByTestId('maturity-date-field-error')).toBeTruthy();
  });
});
