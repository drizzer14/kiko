import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

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
    createdAt: 0,
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

  describe('"Add holding" row', () => {
    it('is absent when the field has no onCreateNew', async () => {
      const { getByLabelText, queryByTestId } = await renderPaymentHoldingField({
        options: [],
        testID: 'paid-from',
      });

      await fireEvent.press(getByLabelText('Paid from'));

      expect(queryByTestId('paid-from-create-new')).toBeNull();
    });

    it('is absent once the picker has a real option', async () => {
      const { getByLabelText, queryByTestId } = await renderPaymentHoldingField({
        onCreateNew: jest.fn(),
        testID: 'paid-from',
      });

      await fireEvent.press(getByLabelText('Paid from'));

      expect(queryByTestId('paid-from-create-new')).toBeNull();
    });

    it('is shown beside the lone "None" row when the picker has no options', async () => {
      const { getByLabelText, getByTestId, getByText } = await renderPaymentHoldingField({
        options: [],
        onCreateNew: jest.fn(),
        testID: 'paid-from',
      });

      await fireEvent.press(getByLabelText('Paid from'));

      expect(getByTestId('paid-from-option-none')).toBeTruthy();
      expect(getByTestId('paid-from-create-new')).toBeTruthy();
      expect(getByText('Add holding')).toBeTruthy();
    });

    it('closes the sheet and calls onCreateNew once when pressed', async () => {
      const onCreateNew = jest.fn();
      const { getByLabelText, getByTestId, queryByText } = await renderPaymentHoldingField({
        options: [],
        onCreateNew,
        testID: 'paid-from',
      });

      await fireEvent.press(getByLabelText('Paid from'));
      await fireEvent.press(getByTestId('paid-from-create-new'));

      expect(onCreateNew).toHaveBeenCalledTimes(1);
      expect(queryByText('Paid From')).toBeNull();
    });

    it('selects the holding created after the press', async () => {
      const onSelect = jest.fn();
      const { getByLabelText, getByTestId, rerender } = await renderPaymentHoldingField({
        options: [],
        onCreateNew: jest.fn(),
        onSelect,
        testID: 'paid-from',
      });

      await fireEvent.press(getByLabelText('Paid from'));
      await fireEvent.press(getByTestId('paid-from-create-new'));
      await rerender(
        <PaymentHoldingField
          label="Paid from"
          sheetTitle="Paid From"
          noneLabel="None"
          options={[{ ...options[0], id: 'created', createdAt: Date.now() }]}
          selectedId={null}
          onSelect={onSelect}
          onCreateNew={jest.fn()}
          testID="paid-from"
        />,
      );

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith('created');
    });
  });
});
