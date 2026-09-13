import type { Currency } from '../../../currency/currency';

export type CurrencyFieldProps = {
  /** Caption above the field and the trigger's accessibility label. */
  label: string;
  /** The current selection, or undefined to show the placeholder. */
  selected: Currency | undefined;
  onSelect: (currency: Currency) => void;
  /**
   * The pickable set, in display order. Defaults to `currencyOptions`. The
   * cash-account form passes `fiatCurrencyOptions` (fiat only); the holding
   * form passes the full set (a crypto holding needs a crypto currency).
   */
  options?: readonly Currency[];
  /** Shows the required asterisk on the label. Defaults to false. */
  required?: boolean;
  /** Read-only: the trigger is inert and dimmed, no sheet opens. Defaults to false. */
  disabled?: boolean;
  /** testID for the trigger, so a flow can open the sheet. */
  testID?: string;
};
