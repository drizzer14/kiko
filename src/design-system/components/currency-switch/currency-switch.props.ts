import type { Currency } from '../../../currency/currency';

export type CurrencySwitchProps = {
  selected: Currency | undefined;
  onSelect: (currency: Currency) => void;
};
