import type { ColumnSelectFieldOption } from '../column-select-field/column-select-field.props';

export type AmountMode = 'single' | 'debitCredit';

export type AmountFieldsProps = {
  columnOptions: ColumnSelectFieldOption<number>[];
  mode: AmountMode;
  onModeChange: (mode: AmountMode) => void;
  amountColumn: number | undefined;
  onAmountColumnChange: (value: number | undefined) => void;
  debitColumn: number | undefined;
  onDebitColumnChange: (value: number | undefined) => void;
  creditColumn: number | undefined;
  onCreditColumnChange: (value: number | undefined) => void;
};
