import type { BankId } from '@kiko/bank-sync/bank-catalog';

export type BankTypeFieldProps = {
  label: string;
  // The picker sheet's header: a Title Case sheet title, a separate key from
  // the sentence-case `label` (kiko-translator: one key per UI role).
  sheetTitle: string;
  // null = either nothing picked yet, or the user explicitly picked the
  // sheet's own "Free" row — the field is OPTIONAL either way (a plain
  // manual bank account with no specific bank identity is valid); the
  // caller never passes `required`.
  selected: BankId | null;
  onSelect: (bankId: BankId | null) => void;
  testID?: string;
};
