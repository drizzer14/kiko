import type { Currency } from '../../../currency/currency';
import type { ColumnSelectFieldOption } from '../column-select-field/column-select-field.props';

export type CurrencyMode = 'column' | 'fixed';

export type CurrencyFieldsProps = {
  columnOptions: ColumnSelectFieldOption<number>[];
  mode: CurrencyMode;
  onModeChange: (mode: CurrencyMode) => void;
  currencyColumn: number | undefined;
  onCurrencyColumnChange: (value: number | undefined) => void;
  fixedCurrency: Currency;
  onFixedCurrencyChange: (currency: Currency) => void;
};
