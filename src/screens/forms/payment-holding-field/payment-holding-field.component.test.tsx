import { fireEvent, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

import PaymentHoldingField from '.';
import type { PaymentHoldingFieldProps } from './payment-holding-field.props';

const options: HoldingSelectOption[] = [
  {
    id: 'h1',
    name: 'Everyday card',
    icon: 'creditcard.fill',
    color: '#3366CC',
    currency: 'UAH',
    accountName: 'Monobank',
  },
];

const renderPaymentHoldingField = (overrides: Partial<PaymentHoldingFieldProps> = {}) =>
  render(
    <PaymentHoldingField
      label="Paid from"
      sheetTitle="Paid From"
      noneLabel="None"
      options={options}
      selectedId={null}
      onSelect={jest.fn()}
      {...overrides}
    />,
  );

describe('PaymentHoldingField', () => {
  it('shows "None" when nothing is picked', async () => {
    const { getByText } = await renderPaymentHoldingField();

    expect(getByText('None')).toBeTruthy();
  });

  it('shows the picked holding name', async () => {
    const { getByText } = await renderPaymentHoldingField({ selectedId: 'h1' });

    expect(getByText('Everyday card')).toBeTruthy();
  });

  it('reports the picked holding id at once', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText } = await renderPaymentHoldingField({ onSelect });

    await fireEvent.press(getByLabelText('Paid from'));
    await fireEvent.press(getByText('Everyday card'));

    expect(onSelect).toHaveBeenCalledWith('h1');
  });

  it('shows sheetTitle, not label, as the sheet header', async () => {
    const { getByLabelText, queryByText } = await renderPaymentHoldingField();

    expect(queryByText('Paid From')).toBeNull();

    await fireEvent.press(getByLabelText('Paid from'));

    expect(queryByText('Paid From')).toBeTruthy();
  });

  it('reports null when "None" is picked from an existing selection', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getAllByText } = await renderPaymentHoldingField({
      selectedId: 'h1',
      onSelect,
    });

    await fireEvent.press(getByLabelText('Paid from'));
    await fireEvent.press(getAllByText('None')[0]);

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
