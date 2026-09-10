import { fireEvent, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import '../../../i18n';

import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

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

    fireEvent.changeText(getByLabelText('Value In'), '42');

    expect(onChangeCounterpartAmount).toHaveBeenCalledWith('42');
  });

  it('marks only the two save-gating counterpart fields as required', async () => {
    const { getAllByText } = await render(<ConvertExchangeFields {...baseProps} />);

    // The counterpart holding picker and its amount gate save, so each shows
    // the required asterisk; the read-only fixed leg, Date, and Time do not.
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(2);
  });
});
