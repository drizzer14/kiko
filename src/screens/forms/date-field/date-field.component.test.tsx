import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ancestorWithStyle } from '../../../test-support/ancestor-with-style';
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

    // Walk up from the calendar itself. The NEAREST ancestor with a defined
    // `paddingBottom` is now BottomSheet's own KeyboardAvoidingView wrapper
    // (see `bottom-sheet.component.tsx`'s keyboard-avoidance fix): React
    // Native's own 'padding'-behavior implementation always composes a
    // `paddingBottom` key onto its rendered style (0 here, since no keyboard
    // is shown under test), so it is found before the sheet card's OWN
    // base+inset padding this test actually cares about. Skip past that
    // artifact to the next ancestor that defines `paddingBottom` — the sheet
    // card itself.
    const keyboardAvoiding = ancestorWithStyle(getByTestId('Start Date calendar'), 'paddingBottom');
    const node =
      keyboardAvoiding.parent === null
        ? keyboardAvoiding
        : ancestorWithStyle(keyboardAvoiding.parent, 'paddingBottom');

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

  it('opens the calendar on the current value', async () => {
    const value = new Date(2026, 2, 4).getTime();
    const { getByLabelText, getByTestId } = await render(
      <DateField label="Start Date" value={value} onChange={jest.fn()} />,
    );

    await fireEvent.press(getByLabelText('Start Date'));

    expect(getByTestId('Start Date calendar').props.initialDate).toBe('2026-03-04');
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

  it('preserves the existing time-of-day when only the day is re-picked', async () => {
    const onChange = jest.fn();
    // An existing value at 14:37:09 on 4 March 2026 — a day pick must move the
    // day only, never clobber the time-of-day back to midnight (so a paired
    // TimeField and DateField do not overwrite each other).
    const value = new Date(2026, 2, 4, 14, 37, 9).getTime();
    const { getByLabelText, getByTestId } = await render(
      <DateField label="Start Date" value={value} onChange={onChange} />,
    );

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
    const { getByText } = await render(
      <DateField label="Start Date" value={null} onChange={jest.fn()} required />,
    );

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders no error message by default', async () => {
    const { queryByText } = await render(
      <DateField label="Start Date" value={null} onChange={jest.fn()} />,
    );

    expect(queryByText('Select a date.')).toBeNull();
  });

  it('renders the error message directly under the field when set, uniform with every other field (Option A: no outline)', async () => {
    const { getByText } = await render(
      <DateField
        label="Start Date"
        value={null}
        onChange={jest.fn()}
        placeholder="Pick a day"
        error="Select a date."
      />,
    );

    expect(getByText('Select a date.')).toBeTruthy();
    // Same Option A contract as TextField: no per-field outline, ever — the
    // field row's own border stays its ordinary neutral token.
    const fieldRow = getByText('Pick a day').parent;
    expect(StyleSheet.flatten(fieldRow?.props.style).borderColor).not.toBe('#FF453A');
  });

  it('reflows rather than reserves: no error node renders while valid', async () => {
    const { queryByTestId } = await render(
      <DateField
        label="Start Date"
        value={null}
        onChange={jest.fn()}
        testID="maturity-date-field"
      />,
    );

    expect(queryByTestId('maturity-date-field-error')).toBeNull();
  });

  it('derives the error testID from the field testID, matching TextField', async () => {
    const { getByTestId } = await render(
      <DateField
        label="Start Date"
        value={null}
        onChange={jest.fn()}
        error="Select a date."
        testID="maturity-date-field"
      />,
    );

    expect(getByTestId('maturity-date-field-error')).toBeTruthy();
  });
});
