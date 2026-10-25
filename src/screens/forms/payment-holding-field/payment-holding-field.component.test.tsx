import { act, fireEvent, render } from '@testing-library/react-native';
import { makeFocusNavigation } from '@kiko/test-support/focus-navigation';
import { handBackCreatedOption } from '@kiko/screens/forms/use-select-created-option';
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

// The field hears the screen's focus through its navigation, so it renders inside one the test
// can fire focus on.
const renderPaymentHoldingField = async (overrides: Partial<PaymentHoldingFieldProps> = {}) => {
  const { provide, fireFocus } = makeFocusNavigation();
  const field = (props: Partial<PaymentHoldingFieldProps>) =>
    provide(
      <PaymentHoldingField
        label="Paid from"
        sheetTitle="Paid From"
        noneLabel="None"
        options={options}
        selectedId={null}
        onSelect={jest.fn()}
        {...overrides}
        {...props}
      />,
    );
  const view = await render(field({}));

  return {
    ...view,
    fireFocus: () => act(async () => fireFocus()),
    rerenderWith: (props: Partial<PaymentHoldingFieldProps>) => view.rerender(field(props)),
  };
};

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
      expect(onCreateNew).toHaveBeenCalledWith(expect.any(String));
      expect(view.queryByText('Paid From')).toBeNull();

      handBackCreatedOption(onCreateNew.mock.calls[0][0], 'created');
      await view.rerenderWith({ options: [{ ...options[0], id: 'created' }] });
      await view.fireFocus();

      expect(onSelect.mock.calls).toEqual([['created']]);
    });

    it('selects nothing on a cancel, even when another holding appeared during the round trip', async () => {
      const onSelect = jest.fn();
      const view = await openSheet({ options: [], onCreateNew: jest.fn(), onSelect });

      await fireEvent.press(view.getByText('Add holding'));
      await view.rerenderWith({
        options: [{ ...options[0], id: 'synced', createdAt: Date.now() }],
      });
      await view.fireFocus();

      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
