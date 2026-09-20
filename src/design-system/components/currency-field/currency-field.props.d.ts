import type { Currency } from '../../../currency/currency';

export type CurrencyFieldProps = {
  /** Caption above the field and the trigger's accessibility label. */
  label: string;
  /**
   * Suppress the inline caption above the trigger while still using `label` for
   * the sheet heading and the trigger's accessibility label. Defaults to false.
   * Set by a caller that already labels the control externally (the Settings
   * base-currency row wraps the field in its own labeled SettingsRow); the
   * account/holding forms omit it and keep their inline caption.
   */
  hideLabel?: boolean;
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
  /**
   * Notifies a hosting Screen when this field's sheet opens or closes, so it
   * can suspend its own `automaticallyAdjustKeyboardInsets` while the sheet's
   * search field can be focused — that background ScrollView otherwise
   * misfires a scroll/inset adjustment for a responder it does not even
   * contain (see `screen.component.tsx`).
   */
  onOpenChange?: (open: boolean) => void;
};
