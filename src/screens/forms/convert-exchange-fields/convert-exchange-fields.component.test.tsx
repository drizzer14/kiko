import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

import ConvertExchangeFields from './convert-exchange-fields.component';

const options: HoldingSelectOption[] = [
  {
    id: 'h1',
    name: 'Cash USD',
    icon: 'banknote',
    color: '#3366FF',
    currency: 'USD',
    accountName: 'Wallet',
  },
];

const baseProps = {
  fixedLabel: 'Value Out',
  fixedValue: '1,000.00',
  counterpartLabel: 'To',
  counterpartSheetTitle: 'Select a Destination',
  counterpartPlaceholder: 'Select holding',
  counterpartOptions: options,
  counterpartHoldingId: null,
  onSelectCounterpart: jest.fn(),
  counterpartAmountLabel: 'Value In',
  counterpartAmount: '',
  onChangeCounterpartAmount: jest.fn(),
  fixedSuffix: '₴',
  counterpartSuffix: '$',
  time: 0,
  onChangeTime: jest.fn(),
};

describe('ConvertExchangeFields', () => {
  it('shows the fixed (read-only) side value', async () => {
    const { getByText, getByDisplayValue } = await render(<ConvertExchangeFields {...baseProps} />);

    expect(getByText('Value Out')).toBeTruthy();
    expect(getByDisplayValue('1,000.00')).toBeTruthy();
  });

  it('shows the fixed and counterpart legs each their own currency glyph', async () => {
    const { getByText } = await render(<ConvertExchangeFields {...baseProps} />);

    // The fixed existing leg reads in hryvnia, the counterpart leg in dollars.
    expect(getByText('₴')).toBeTruthy();
    expect(getByText('$')).toBeTruthy();
  });

  it("shows counterpartSheetTitle as the counterpart picker's sheet header", async () => {
    const { getByLabelText, queryByText } = await render(<ConvertExchangeFields {...baseProps} />);

    expect(queryByText('Select a Destination')).toBeNull();

    await fireEvent.press(getByLabelText('To'));

    expect(queryByText('Select a Destination')).toBeTruthy();
  });

  it('reports the picked counterpart holding', async () => {
    const onSelectCounterpart = jest.fn();
    const { getByLabelText, getByText } = await render(
      <ConvertExchangeFields {...baseProps} onSelectCounterpart={onSelectCounterpart} />,
    );

    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));

    expect(onSelectCounterpart).toHaveBeenCalledWith('h1');
  });

  it('reports the entered counterpart amount', async () => {
    const onChangeCounterpartAmount = jest.fn();
    const { getByLabelText } = await render(
      <ConvertExchangeFields
        {...baseProps}
        onChangeCounterpartAmount={onChangeCounterpartAmount}
      />,
    );

    await fireEvent.changeText(getByLabelText('Value In'), '42');

    expect(onChangeCounterpartAmount).toHaveBeenCalledWith('42');
  });

  it('marks only the two save-gating counterpart fields as required', async () => {
    const { getAllByText } = await render(<ConvertExchangeFields {...baseProps} />);

    // The counterpart holding picker and its amount gate save, so each shows
    // the required asterisk; the read-only fixed leg, Date, and Time do not.
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(2);
  });

  it('renders counterpartError directly after the counterpart picker', async () => {
    const { getByText } = await render(
      <ConvertExchangeFields {...baseProps} counterpartError="Select a counterpart account." />,
    );

    expect(getByText('Select a counterpart account.')).toBeTruthy();
  });

  it('adds the same vertical gap above the counterpart error that a text field has above its own', async () => {
    const { getByText } = await render(
      <ConvertExchangeFields {...baseProps} counterpartError="Select a counterpart account." />,
    );

    // A select field's error lacked the same
    // gap TextField's own `Box gap={1}` already gives its error line.
    const errorGroup = getByText('Select a counterpart account.').parent?.parent;
    expect(StyleSheet.flatten(errorGroup?.props.style).gap).toBe(darkTheme.spacing(1));
  });

  it('applies counterpartAmountError to the counterpart amount field', async () => {
    const { getByLabelText, getByText } = await render(
      <ConvertExchangeFields
        {...baseProps}
        counterpartAmountError="Enter an amount greater than 0."
      />,
    );

    expect(getByText('Enter an amount greater than 0.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(getByLabelText('Value In').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });
});
