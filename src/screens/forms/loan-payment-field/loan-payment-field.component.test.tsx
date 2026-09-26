import { fireEvent, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

import LoanPaymentField from '.';

const options: HoldingSelectOption[] = [
  {
    id: 'loan-1',
    name: 'Car loan',
    icon: 'minus.circle.fill',
    color: '#AA3322',
    currency: 'UAH',
    accountName: 'Debts',
  },
];

describe('LoanPaymentField', () => {
  it('shows "None" when nothing is linked', async () => {
    const { getByText } = await render(
      <LoanPaymentField
        label="Loan payment"
        noneLabel="None"
        options={options}
        selectedId={null}
        onSelect={jest.fn()}
        linkSource={null}
        autoLinkedCaption="Linked automatically."
        undoLabel="Undo"
        onUndo={jest.fn()}
      />,
    );

    expect(getByText('None')).toBeTruthy();
  });

  it('shows the linked loan holding name', async () => {
    const { getByText } = await render(
      <LoanPaymentField
        label="Loan payment"
        noneLabel="None"
        options={options}
        selectedId="loan-1"
        onSelect={jest.fn()}
        linkSource="manual"
        autoLinkedCaption="Linked automatically."
        undoLabel="Undo"
        onUndo={jest.fn()}
      />,
    );

    expect(getByText('Car loan')).toBeTruthy();
  });

  it('reports the picked loan holding id at once (no Save gating)', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText } = await render(
      <LoanPaymentField
        label="Loan payment"
        noneLabel="None"
        options={options}
        selectedId={null}
        onSelect={onSelect}
        linkSource={null}
        autoLinkedCaption="Linked automatically."
        undoLabel="Undo"
        onUndo={jest.fn()}
      />,
    );

    await fireEvent.press(getByLabelText('Loan payment'));
    await fireEvent.press(getByText('Car loan'));

    expect(onSelect).toHaveBeenCalledWith('loan-1');
  });

  it('reports null when "None" is picked from an existing link', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getAllByText } = await render(
      <LoanPaymentField
        label="Loan payment"
        noneLabel="None"
        options={options}
        selectedId="loan-1"
        onSelect={onSelect}
        linkSource="manual"
        autoLinkedCaption="Linked automatically."
        undoLabel="Undo"
        onUndo={jest.fn()}
      />,
    );

    await fireEvent.press(getByLabelText('Loan payment'));
    // "None" appears once as the sheet row's own label (the trigger itself
    // reads the loan's name while a real link is selected).
    await fireEvent.press(getAllByText('None')[0]);

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('shows the auto-link caption and Undo only when linkSource is "auto"', async () => {
    const { getByText, queryByText } = await render(
      <LoanPaymentField
        label="Loan payment"
        noneLabel="None"
        options={options}
        selectedId="loan-1"
        onSelect={jest.fn()}
        linkSource="auto"
        autoLinkedCaption="Linked automatically."
        undoLabel="Undo"
        onUndo={jest.fn()}
      />,
    );

    expect(getByText('Linked automatically.')).toBeTruthy();
    expect(getByText('Undo')).toBeTruthy();
    expect(queryByText('Linked automatically.')).not.toBeNull();
  });

  it('hides the auto-link caption and Undo for a manual link', async () => {
    const { queryByText } = await render(
      <LoanPaymentField
        label="Loan payment"
        noneLabel="None"
        options={options}
        selectedId="loan-1"
        onSelect={jest.fn()}
        linkSource="manual"
        autoLinkedCaption="Linked automatically."
        undoLabel="Undo"
        onUndo={jest.fn()}
      />,
    );

    expect(queryByText('Linked automatically.')).toBeNull();
    expect(queryByText('Undo')).toBeNull();
  });

  it('fires onUndo when Undo is pressed', async () => {
    const onUndo = jest.fn();
    const { getByText } = await render(
      <LoanPaymentField
        label="Loan payment"
        noneLabel="None"
        options={options}
        selectedId="loan-1"
        onSelect={jest.fn()}
        linkSource="auto"
        autoLinkedCaption="Linked automatically."
        undoLabel="Undo"
        onUndo={onUndo}
      />,
    );

    await fireEvent.press(getByText('Undo'));

    expect(onUndo).toHaveBeenCalled();
  });
});
