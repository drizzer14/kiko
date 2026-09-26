import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '@kiko/i18n/init';

import CurrencyFields from './currency-fields.component';

const columnOptions = [
  { value: 0, label: 'Date' },
  { value: 6, label: 'Currency' },
];

describe('CurrencyFields', () => {
  it('shows a currency-column field in column mode', async () => {
    const { getByTestId, queryByTestId } = await render(
      <CurrencyFields
        columnOptions={columnOptions}
        mode="column"
        onModeChange={jest.fn()}
        currencyColumn={undefined}
        onCurrencyColumnChange={jest.fn()}
        fixedCurrency="UAH"
        onFixedCurrencyChange={jest.fn()}
      />,
    );

    expect(getByTestId('column-mapping-currency-column')).toBeTruthy();
    expect(queryByTestId('column-mapping-fixed-currency')).toBeNull();
  });

  it('shows the fixed-currency field in fixed mode, defaulted from the caller', async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <CurrencyFields
        columnOptions={columnOptions}
        mode="fixed"
        onModeChange={jest.fn()}
        currencyColumn={undefined}
        onCurrencyColumnChange={jest.fn()}
        fixedCurrency="UAH"
        onFixedCurrencyChange={jest.fn()}
      />,
    );

    expect(queryByTestId('column-mapping-currency-column')).toBeNull();
    expect(getByTestId('column-mapping-fixed-currency')).toBeTruthy();
    expect(getByText('Ukrainian Hryvnia')).toBeTruthy();
  });

  it('calls onModeChange when the currency-column pill is pressed', async () => {
    const onModeChange = jest.fn();
    const { getByText } = await render(
      <CurrencyFields
        columnOptions={columnOptions}
        mode="fixed"
        onModeChange={onModeChange}
        currencyColumn={undefined}
        onCurrencyColumnChange={jest.fn()}
        fixedCurrency="UAH"
        onFixedCurrencyChange={jest.fn()}
      />,
    );

    await fireEvent.press(getByText('Currency column'));

    expect(onModeChange).toHaveBeenCalledWith('column');
  });
});
