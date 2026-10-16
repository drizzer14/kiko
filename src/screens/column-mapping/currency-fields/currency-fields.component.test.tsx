import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { holdCurrencies } from '@kiko/test-support/held-currencies';

import CurrencyFields from './currency-fields.component';

jest.mock(
  '@kiko/holdings/use-held-currencies',
  () => jest.requireActual('@kiko/test-support/held-currencies').heldCurrenciesModule,
);

const columnOptions = [
  { value: 0, label: 'Date' },
  { value: 6, label: 'Currency' },
];

const renderFields = (overrides: Partial<ComponentProps<typeof CurrencyFields>> = {}) =>
  render(
    <CurrencyFields
      columnOptions={columnOptions}
      mode="fixed"
      onModeChange={jest.fn()}
      currencyColumn={undefined}
      onCurrencyColumnChange={jest.fn()}
      fixedCurrency="UAH"
      onFixedCurrencyChange={jest.fn()}
      targetHolding={undefined}
      {...overrides}
    />,
  );

describe('CurrencyFields', () => {
  beforeEach(() => {
    holdCurrencies([]);
  });

  it('fixed mode lists the target currency first under Holding currency, once', async () => {
    holdCurrencies(['USD']);
    const { getByTestId, getAllByTestId, getByPlaceholderText } = await renderFields({
      fixedCurrency: 'EUR',
      targetHolding: { currency: 'EUR', type: 'cash' },
    });

    await fireEvent.press(getByTestId('column-mapping-fixed-currency'));

    expect(getByTestId('currency-group-target')).toHaveTextContent('Holding currency');
    expect(
      getAllByTestId(/^currency-(group|option)-/)
        .slice(0, 4)
        .map((row) => String(row.props.testID)),
    ).toEqual([
      'currency-group-target',
      'currency-option-EUR',
      'currency-group-fiat',
      'currency-option-USD',
    ]);

    await fireEvent.changeText(getByPlaceholderText('Search by code or name'), 'euro');

    expect(getAllByTestId('currency-option-EUR')).toHaveLength(1);
  });

  it('lists the user currencies first when no target holding is chosen', async () => {
    holdCurrencies(['USD', 'BTC']);
    const { getByTestId, getAllByTestId } = await renderFields();

    await fireEvent.press(getByTestId('column-mapping-fixed-currency'));

    expect(getByTestId('currency-group-held')).toHaveTextContent('Your currencies');
    expect(
      getAllByTestId(/^currency-option-/)
        .slice(0, 2)
        .map((row) => String(row.props.testID)),
    ).toEqual(['currency-option-BTC', 'currency-option-USD']);
  });

  it('shows a currency-column field in column mode', async () => {
    const { getByTestId, queryByTestId } = await renderFields({ mode: 'column' });

    expect(getByTestId('column-mapping-currency-column')).toBeTruthy();
    expect(queryByTestId('column-mapping-fixed-currency')).toBeNull();
  });

  it('shows the fixed-currency field in fixed mode, defaulted from the caller', async () => {
    const { getByTestId, getByText, queryByTestId } = await renderFields();

    expect(queryByTestId('column-mapping-currency-column')).toBeNull();
    expect(getByTestId('column-mapping-fixed-currency')).toBeTruthy();
    expect(getByText('Ukrainian Hryvnia')).toBeTruthy();
  });

  it('calls onModeChange when the currency-column pill is pressed', async () => {
    const onModeChange = jest.fn();
    const { getByText } = await renderFields({ onModeChange });

    await fireEvent.press(getByText('Currency column'));

    expect(onModeChange).toHaveBeenCalledWith('column');
  });
});
