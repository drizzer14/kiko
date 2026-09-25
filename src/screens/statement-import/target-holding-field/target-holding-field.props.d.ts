import type { TargetHoldingOption } from '../target-holding-sheet/target-holding-sheet.props';

export type TargetHoldingFieldProps = {
  label: string;
  required?: boolean;
  holdings: TargetHoldingOption[];
  accountId?: string;
  selectedId: string | undefined;
  onSelect: (holdingId: string) => void;
  onCreateNew: () => void;
  // The "nothing picked yet" copy shown as the trigger's value — distinct
  // from `label`: a placeholder must never repeat the label text verbatim.
  placeholder: string;
  // The validation-failure message for this field, or `undefined` when it's
  // currently valid — forwarded straight to the underlying `FieldTrigger`.
  error?: string;
  // Read-only: forwarded straight to `FieldTrigger`'s own `disabled` — used
  // by a caller whose `holdings` list is still loading, so the picker cannot
  // be opened on an incomplete/empty list (kiko-architecture's useLiveQuery
  // consumer rule). Defaults to false.
  disabled?: boolean;
  testID?: string;
};
