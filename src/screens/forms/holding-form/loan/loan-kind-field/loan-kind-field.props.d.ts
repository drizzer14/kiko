import type { LoanKind } from '@kiko/holdings/holding-metadata';

export type LoanKindFieldProps = {
  selected: LoanKind;
  onSelect: (kind: LoanKind) => void;
  testID?: string;
};
