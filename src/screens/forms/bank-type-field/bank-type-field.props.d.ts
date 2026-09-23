import type { BankId } from '../../../bank-sync/bank-catalog';

export type BankTypeFieldProps = {
  label: string;
  // null = either nothing picked yet, or the user explicitly picked the
  // sheet's own "No bank" row — the field is OPTIONAL either way (a plain
  // manual bank account with no specific bank identity is valid); the
  // caller never passes `required`.
  selected: BankId | null;
  onSelect: (bankId: BankId | null) => void;
  testID?: string;
};
