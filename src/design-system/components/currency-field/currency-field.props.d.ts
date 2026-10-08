import type { Currency } from '@kiko/currency/currency';

export type CurrencyFieldProps = {
  /** Caption above the field and the trigger's accessibility label. */
  label: string;
  /**
   * The picker sheet's header: a Title Case sheet title, a separate key from
   * the sentence-case `label` (kiko-translator: one key per UI role).
   */
  sheetTitle: string;
  /**
   * Suppress the inline caption above the trigger while still using `label` for
   * the trigger's accessibility label. Defaults to false.
   * Set by a caller that already labels the control externally (the Settings
   * base-currency row wraps the field in its own labeled SettingsRow); the
   * account/holding forms omit it and keep their inline caption.
   */
  hideLabel?: boolean;
  /** The current selection, or undefined to show the placeholder. */
  selected: Currency | undefined;
  onSelect: (currency: Currency) => void;
  /**
   * The pickable set. Defaults to `currencyOptions`. The cash-account form
   * passes `fiatCurrencyOptions` (fiat only); the holding form passes its
   * type's `holdingCurrencyOptions` (fiat only for cash, the full set
   * otherwise — a crypto holding needs a crypto currency).
   */
  options?: readonly Currency[];
  /**
   * Lists the crypto group before the fiat group (each keeps its own order).
   * Defaults to false. The crypto-holding create form sets it, where a crypto
   * currency is the likely pick.
   */
  cryptoFirst?: boolean;
  /** Shows the required asterisk on the label. Defaults to false. */
  required?: boolean;
  /** Read-only: the trigger is inert and dimmed, no sheet opens. Defaults to false. */
  disabled?: boolean;
  /**
   * Same contract as every other field: FieldTrigger renders this under the
   * field (reflow, not reserve) and tints the label negative.
   */
  error?: string;
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
