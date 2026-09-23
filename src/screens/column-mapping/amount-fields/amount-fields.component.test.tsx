import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import AmountFields from './amount-fields.component';

const columnOptions = [
  { value: 0, label: 'Date' },
  { value: 3, label: 'Amount' },
  { value: 4, label: 'Debit' },
  { value: 5, label: 'Credit' },
];

describe('AmountFields', () => {
  it('shows a single amount-column field in single mode', async () => {
    const { getByTestId, queryByTestId } = await render(
      <AmountFields
        columnOptions={columnOptions}
        mode="single"
        onModeChange={jest.fn()}
        amountColumn={undefined}
        onAmountColumnChange={jest.fn()}
        debitColumn={undefined}
        onDebitColumnChange={jest.fn()}
        creditColumn={undefined}
        onCreditColumnChange={jest.fn()}
      />,
    );

    expect(getByTestId('column-mapping-amount-column')).toBeTruthy();
    expect(queryByTestId('column-mapping-debit-column')).toBeNull();
    expect(queryByTestId('column-mapping-credit-column')).toBeNull();
  });

  it('shows debit and credit column fields in debitCredit mode', async () => {
    const { getByTestId, queryByTestId } = await render(
      <AmountFields
        columnOptions={columnOptions}
        mode="debitCredit"
        onModeChange={jest.fn()}
        amountColumn={undefined}
        onAmountColumnChange={jest.fn()}
        debitColumn={undefined}
        onDebitColumnChange={jest.fn()}
        creditColumn={undefined}
        onCreditColumnChange={jest.fn()}
      />,
    );

    expect(queryByTestId('column-mapping-amount-column')).toBeNull();
    expect(getByTestId('column-mapping-debit-column')).toBeTruthy();
    expect(getByTestId('column-mapping-credit-column')).toBeTruthy();
  });

  it('calls onModeChange when the debitCredit pill is pressed', async () => {
    const onModeChange = jest.fn();
    const { getByText } = await render(
      <AmountFields
        columnOptions={columnOptions}
        mode="single"
        onModeChange={onModeChange}
        amountColumn={undefined}
        onAmountColumnChange={jest.fn()}
        debitColumn={undefined}
        onDebitColumnChange={jest.fn()}
        creditColumn={undefined}
        onCreditColumnChange={jest.fn()}
      />,
    );

    await fireEvent.press(getByText('Debit and credit columns'));

    expect(onModeChange).toHaveBeenCalledWith('debitCredit');
  });
});
