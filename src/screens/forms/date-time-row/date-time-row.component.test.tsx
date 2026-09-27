import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';

import DateTimeRow from './date-time-row.component';

const noop = (): void => {};

describe('DateTimeRow', () => {
  it('renders both the Date and Time fields', async () => {
    const { getByLabelText } = await render(<DateTimeRow time={0} onChangeTime={noop} />);

    expect(getByLabelText('Date')).toBeTruthy();
    expect(getByLabelText('Time')).toBeTruthy();
  });

  // Date and Time render SIDE BY SIDE in one row, each taking an equal
  // share, rather than stacked full-width.
  it('lays the two fields out in a single row with a gap, not stacked', async () => {
    const { getByLabelText } = await render(<DateTimeRow time={0} onChangeTime={noop} />);

    // Walk up from the Date field's own accessible Pressable to the shared
    // row Box two levels up (the row Box -> the flex-1 View wrapper -> the
    // Pressable), mirroring how DateField/TimeField nest their own trigger.
    const row = getByLabelText('Date').parent?.parent?.parent;
    const flatStyle = StyleSheet.flatten(row?.props.style);

    expect(flatStyle.flexDirection).toBe('row');
    expect(flatStyle.gap).toBe(darkTheme.spacing(3));
  });

  it('gives each field an equal (flex: 1) share of the row', async () => {
    const { getByLabelText } = await render(<DateTimeRow time={0} onChangeTime={noop} />);

    const dateColumn = getByLabelText('Date').parent?.parent;
    const timeColumn = getByLabelText('Time').parent?.parent;

    expect(StyleSheet.flatten(dateColumn?.props.style).flex).toBe(1);
    expect(StyleSheet.flatten(timeColumn?.props.style).flex).toBe(1);
  });

  it('disables both fields when disabled is passed', async () => {
    const { getByLabelText } = await render(<DateTimeRow time={0} onChangeTime={noop} disabled />);

    expect(getByLabelText('Date').props.accessibilityState.disabled).toBe(true);
    expect(getByLabelText('Time').props.accessibilityState.disabled).toBe(true);
  });

  it('applies the given testIDs to the Date and Time triggers', async () => {
    const { getByTestId } = await render(
      <DateTimeRow
        time={0}
        onChangeTime={noop}
        dateTestID="row-date-field"
        timeTestID="row-time-field"
      />,
    );

    expect(getByTestId('row-date-field')).toBeTruthy();
    expect(getByTestId('row-time-field')).toBeTruthy();
  });
});
