import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
import { currencyOptions } from '../../../currency/currency';
import { currencySignSymbol } from '../../../currency/currency-symbols';

import CurrencySwitch from '.';

describe('CurrencySwitch', () => {
  it('reports the pressed currency through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(<CurrencySwitch selected="UAH" onSelect={onSelect} />);

    await fireEvent.press(getByText('USD'));

    expect(onSelect).toHaveBeenCalledWith('USD');
  });

  it('renders each currency code as a pill', async () => {
    const { getByText } = await render(<CurrencySwitch selected="UAH" onSelect={jest.fn()} />);

    for (const currency of currencyOptions) {
      expect(getByText(currency)).toBeTruthy();
    }
  });

  it("renders each pill's currency-sign SF Symbol before its code", async () => {
    const { toJSON } = await render(<CurrencySwitch selected="UAH" onSelect={jest.fn()} />);

    // The mocked SFSymbolView forwards `name` to a host View, so each currency's
    // sign glyph name (hryvniasign, dollarsign, …) appears in the rendered tree.
    const tree = JSON.stringify(toJSON());
    for (const currency of currencyOptions) {
      expect(tree).toContain(currencySignSymbol[currency]);
    }
  });

  it('marks the selected currency via accessibilityState', async () => {
    const { getByText } = await render(<CurrencySwitch selected="EUR" onSelect={jest.fn()} />);

    // The label Text sits inside the Pressable pill, so its parent carries the
    // selection state.
    expect(getByText('EUR').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('USD').parent?.props.accessibilityState.selected).toBe(false);
  });
});
