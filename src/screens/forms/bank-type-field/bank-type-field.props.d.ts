import type { BankId } from '@kiko/bank-sync/bank-catalog';

export type BankTypeFieldProps = {
  label: string;
  // The picker sheet's header: a Title Case sheet title, a separate key from
  // the sentence-case `label` (kiko-translator: one key per UI role).
  sheetTitle: string;
  // null = nothing picked yet, shown as the placeholder. A bank is picked
  // from the list, `other` last, the same as a broker.
  selected: BankId | null;
  onSelect: (bankId: BankId) => void;
  // The create form passes `required` and, after a blocked Save, `error`; the
  // edit form passes neither, since an account saved without a bank is never
  // forced to pick one on edit.
  required?: boolean;
  error?: string;
  testID?: string;
};
