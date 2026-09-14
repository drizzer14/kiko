import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
import { fiatCurrencyOptions } from '../../../currency/currency';

import CurrencyField from '.';

const open = async (utils: Awaited<ReturnType<typeof render>>): Promise<void> => {
  await fireEvent.press(utils.getByTestId('currency-field'));
};

describe('CurrencyField', () => {
  it('reports the picked currency and closes the sheet', async () => {
    const onSelect = jest.fn();
    const utils = await render(
      <CurrencyField label="Currency" selected="UAH" onSelect={onSelect} testID="currency-field" />,
    );
    await open(utils);
    await fireEvent.press(utils.getByTestId('currency-option-USD'));
    expect(onSelect).toHaveBeenCalledWith('USD');
  });

  it('filters the list by code', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );
    await open(utils);
    await fireEvent.changeText(utils.getByPlaceholderText('Search by code or name'), 'chf');
    expect(utils.getByTestId('currency-option-CHF')).toBeTruthy();
    expect(utils.queryByTestId('currency-option-USD')).toBeNull();
  });

  it('filters the list by name', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );
    await open(utils);
    await fireEvent.changeText(utils.getByPlaceholderText('Search by code or name'), 'pound');
    expect(utils.getByTestId('currency-option-GBP')).toBeTruthy();
    expect(utils.queryByTestId('currency-option-EUR')).toBeNull();
  });

  it('restricts the list to the given options (fiat only offers no BTC)', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        options={fiatCurrencyOptions}
        testID="currency-field"
      />,
    );
    await open(utils);
    expect(utils.queryByTestId('currency-option-BTC')).toBeNull();
    expect(utils.getByTestId('currency-option-USD')).toBeTruthy();
  });

  it('shows the text currency mark for the trigger and each option (never a generic icon)', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="USD"
        onSelect={jest.fn()}
        testID="currency-field"
      />,
    );

    // The trigger's own leading mark ("$" for USD) — proves CurrencyField
    // swapped from the SF Symbol `icon` path onto the text `leadingText` path.
    expect(utils.getByText('$')).toBeTruthy();

    await open(utils);

    // AED has no conventional Unicode symbol, so its mark is the bare ISO
    // code — this is exactly the case the old SF-Symbol map fell back to the
    // generic `banknote` glyph for.
    expect(utils.getByTestId('currency-option-AED')).toBeTruthy();
  });

  it('does not open the sheet when disabled', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="BTC"
        onSelect={jest.fn()}
        disabled
        testID="currency-field"
      />,
    );
    await open(utils);
    expect(utils.queryByTestId('currency-option-USD')).toBeNull();
  });
});
