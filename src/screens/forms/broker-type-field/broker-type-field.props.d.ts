import type { BrokerId } from '@kiko/brokers';

export type BrokerTypeFieldProps = {
  label: string;
  // A separate key from the sentence-case `label` (kiko-translator: one key
  // per UI role), even where the two read the same.
  sheetTitle: string;
  // null = nothing picked yet.
  selected: BrokerId | null;
  onSelect: (brokerId: BrokerId) => void;
  // The create form passes `required` and, after a blocked Save, `error`; the
  // edit form passes neither, since an account saved without a broker is never
  // forced to pick one on edit.
  required?: boolean;
  // Read-only: shows the stored broker and opens no sheet. The edit form sets
  // it, because an account's broker is chosen on create only.
  disabled?: boolean;
  error?: string;
  testID?: string;
};
