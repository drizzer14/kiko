import type { Currency } from '@kiko/currency/currency';
import type { CurrencyGroup } from '@kiko/currency/currency-group';

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
   * The pickable currencies as groups, in display order, each already ordered:
   * the field filters them by the search and keeps the order. A heading row labels
   * a group only while more than one group is showing. Build them with
   * `useCurrencyPickerGroups` from the form's context.
   */
  groups: readonly CurrencyGroup[];
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
};
