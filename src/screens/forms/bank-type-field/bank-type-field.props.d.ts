import type { BankId } from '../../../bank-sync/bank-catalog';

export type BankTypeFieldProps = {
  label: string;
  // null = nothing picked yet — the field is OPTIONAL (a plain manual bank
  // account with no specific bank identity is valid); the caller never
  // passes `required`.
  selected: BankId | null;
  onSelect: (bankId: BankId) => void;
  testID?: string;
};
