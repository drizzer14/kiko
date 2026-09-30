import type { BrokerId } from '@kiko/brokers';

export type BrokerTypeFieldProps = {
  label: string;
  // A separate key from the sentence-case `label` (kiko-translator: one key
  // per UI role), even where the two read the same.
  sheetTitle: string;
  // null = nothing picked yet. Optional: the account name already says which
  // broker it is, so the caller never passes `required`.
  selected: BrokerId | null;
  onSelect: (brokerId: BrokerId) => void;
  testID?: string;
};
