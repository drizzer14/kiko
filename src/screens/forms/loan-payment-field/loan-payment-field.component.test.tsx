import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

import LoanPaymentField from '.';
import type { LoanPaymentFieldProps } from './loan-payment-field.props';

const options: HoldingSelectOption[] = [
  {
    id: 'loan-1',
    name: 'Car loan',
    icon: 'arrow.down.backward.circle.fill',
    color: '#AA3322',
    currency: 'UAH',
    accountName: 'Debts',
  },
];

const renderLoanPaymentField = (overrides: Partial<LoanPaymentFieldProps> = {}) =>
  render(
    <LoanPaymentField
      label="Loan payment"
      sheetTitle="Loan Payment"
      noneLabel="None"
      options={options}
      selectedId={null}
      onSelect={jest.fn()}
      linkSource={null}
      autoLinkedCaption="Linked automatically."
      undoLabel="Undo"
      onUndo={jest.fn()}
      {...overrides}
    />,
  );

describe('LoanPaymentField', () => {
  it('shows "None" when nothing is linked', async () => {
    const { getByText } = await renderLoanPaymentField();

    expect(getByText('None')).toBeTruthy();
  });

  it('shows the linked loan holding name', async () => {
    const { getByText } = await renderLoanPaymentField({
      selectedId: 'loan-1',
      linkSource: 'manual',
    });

    expect(getByText('Car loan')).toBeTruthy();
  });

  it('reports the picked loan holding id at once (no Save gating)', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText } = await renderLoanPaymentField({ onSelect });

    await fireEvent.press(getByLabelText('Loan payment'));
    await fireEvent.press(getByText('Car loan'));

    expect(onSelect).toHaveBeenCalledWith('loan-1');
  });

  it('forwards sheetTitle as the sheet header', async () => {
    const { getByLabelText, queryByText } = await renderLoanPaymentField();

    expect(queryByText('Loan Payment')).toBeNull();

    await fireEvent.press(getByLabelText('Loan payment'));

    expect(queryByText('Loan Payment')).toBeTruthy();
  });

  it('reports null when "None" is picked from an existing link', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getAllByText } = await renderLoanPaymentField({
      selectedId: 'loan-1',
      onSelect,
      linkSource: 'manual',
    });

    await fireEvent.press(getByLabelText('Loan payment'));
    // "None" appears once as the sheet row's own label (the trigger itself
    // reads the loan's name while a real link is selected).
    await fireEvent.press(getAllByText('None')[0]);

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('shows the auto-link caption and Undo only when linkSource is "auto"', async () => {
    const { getByText, queryByText } = await renderLoanPaymentField({
      selectedId: 'loan-1',
      linkSource: 'auto',
    });

    expect(getByText('Linked automatically.')).toBeTruthy();
    expect(getByText('Undo')).toBeTruthy();
    expect(queryByText('Linked automatically.')).not.toBeNull();
  });

  it('hides the auto-link caption and Undo for a manual link', async () => {
    const { queryByText } = await renderLoanPaymentField({
      selectedId: 'loan-1',
      linkSource: 'manual',
    });

    expect(queryByText('Linked automatically.')).toBeNull();
    expect(queryByText('Undo')).toBeNull();
  });

  it('fires onUndo when Undo is pressed', async () => {
    const onUndo = jest.fn();
    const { getByText } = await renderLoanPaymentField({
      selectedId: 'loan-1',
      linkSource: 'auto',
      onUndo,
    });

    await fireEvent.press(getByText('Undo'));

    expect(onUndo).toHaveBeenCalled();
  });
});
