import type { FC } from 'react';

import { currencyOptions } from '../../../currency/currency';
import { currencySignSymbol } from '../../../currency/currency-symbols';
import OptionPills from '../option-pills';

import type { CurrencySwitchProps } from './currency-switch.props';

// A segmented base-currency toggle, not an action button — so it delegates to
// the shared OptionPills pill selector (a transparent, selected-state control),
// passing each currency's sign glyph as the pill icon. OptionPills is the one
// place the pill markup lives, kept shared so future pill selectors reuse it.
const CurrencySwitch: FC<CurrencySwitchProps> = ({ selected, onSelect }) => {
  return (
    <OptionPills
      options={currencyOptions}
      selected={selected}
      onSelect={onSelect}
      icon={(currency) => currencySignSymbol[currency]}
    />
  );
};

export default CurrencySwitch;
