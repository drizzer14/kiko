import type { Currency } from '@kiko/currency/currency';
import type { HoldingType } from '@kiko/holdings/holding-type';

import type { ColumnSelectFieldOption } from '../column-select-field/column-select-field.props';

export type CurrencyMode = 'column' | 'fixed';

// The holding the statement imports into: its currency heads the fixed-currency list, and its
// type decides how the rest are grouped.
export type TargetHolding = { currency: Currency; type: HoldingType };

export type CurrencyFieldsProps = {
  columnOptions: ColumnSelectFieldOption<number>[];
  mode: CurrencyMode;
  onModeChange: (mode: CurrencyMode) => void;
  currencyColumn: number | undefined;
  onCurrencyColumnChange: (value: number | undefined) => void;
  fixedCurrency: Currency;
  onFixedCurrencyChange: (currency: Currency) => void;
  targetHolding: TargetHolding | undefined;
  currencyColumnError?: string;
};
