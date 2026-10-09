import type { Currency } from '@kiko/currency/currency';

export type HoldingSelectOption = {
  id: string;
  name: string;
  icon: string;
  color: string;
  currency: Currency;
  accountName: string; // the parent account's display name
  // The holding's `created_at` (ms). The "Add holding" round trip selects only
  // a holding stamped inside its own window, never one a sync adds later.
  createdAt: number;
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
  // When set AND `options` is empty, the sheet shows one "Add holding" row that
  // calls this (the caller opens the create form). The field then selects the
  // holding created on that round trip, once it appears among `options`.
  onCreateNew?: () => void;
};
