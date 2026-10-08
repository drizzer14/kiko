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
    const { getByLabelText, getByText } = await renderPaymentHoldingField({
      onSelect,
    });

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
    const openSheet = async (overrides: Partial<PaymentHoldingFieldProps>) => {
      const view = await renderPaymentHoldingField({
        testID: 'paid-from',
        ...overrides,
      });

      await fireEvent.press(view.getByLabelText('Paid from'));

      return view;
    };

    it.each([
      ['the field has no onCreateNew', { options: [] }],
      ['the picker has a real option', { onCreateNew: jest.fn() }],
    ])('is absent when %s', async (_reason, overrides) => {
      const view = await openSheet(overrides);

      expect(view.queryByTestId('paid-from-create-new')).toBeNull();
    });

    it('sits beside the lone "None" row, then reports once, closes the sheet and selects the new holding', async () => {
      const onCreateNew = jest.fn();
      const onSelect = jest.fn();
      const view = await openSheet({ options: [], onCreateNew, onSelect });

      expect(view.getByTestId('paid-from-option-none')).toBeTruthy();

      await fireEvent.press(view.getByText('Add holding'));

      expect(onCreateNew).toHaveBeenCalledTimes(1);
      expect(view.queryByText('Paid From')).toBeNull();

      const created = { ...options[0], id: 'created', createdAt: Date.now() };

      await view.rerender(
        <PaymentHoldingField
          label="Paid from"
          sheetTitle="Paid From"
          noneLabel="None"
          options={[created]}
          selectedId={null}
          onSelect={onSelect}
          onCreateNew={onCreateNew}
        />,
      );

      expect(onSelect.mock.calls).toEqual([['created']]);
    });
  });
});
