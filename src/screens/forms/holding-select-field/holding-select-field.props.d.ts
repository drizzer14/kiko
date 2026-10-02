import type { Currency } from '@kiko/currency/currency';

export type HoldingSelectOption = {
  id: string;
  name: string;
  icon: string;
  color: string;
  currency: Currency;
  accountName: string; // the parent account's display name
};

export type HoldingSelectFieldProps = {
  label: string;
  // The picker sheet's header: a Title Case sheet title, a separate key from
  // the sentence-case `label` (kiko-translator: one key per UI role).
  sheetTitle: string;
  placeholder: string;
  options: readonly HoldingSelectOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  // When true, the label shows a red asterisk marking the field as required.
  // Defaults to false. Forwarded to the shared FieldTrigger.
  required?: boolean;
  // The validation-failure message, or `undefined` while valid. Forwarded to
  // the shared FieldTrigger, which renders it under the field and turns the
  // label red.
  error?: string;
  // Turns the label red with no error line of its own, for a field whose one
  // error renders under its whole group (a split payment's return rows).
  // Forwarded to the shared FieldTrigger.
  invalid?: boolean;
};
