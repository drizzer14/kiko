import type { TargetHoldingOption } from '../target-holding-sheet/target-holding-sheet.props';

export type TargetHoldingFieldProps = {
  label: string;
  required?: boolean;
  holdings: TargetHoldingOption[];
  accountId?: string;
  selectedId: string | undefined;
  onSelect: (holdingId: string) => void;
  onCreateNew: () => void;
  testID?: string;
};
