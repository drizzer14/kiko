import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

export type PaymentHoldingFieldProps = {
  label: string;
  // The synthetic "clear the link" row's own label ("None"), prepended
  // ahead of `options` and shown as the trigger's value whenever
  // `selectedId` is `null`. Mirrors `LoanPaymentField`'s own `noneLabel`.
  noneLabel: string;
  options: readonly HoldingSelectOption[];
  selectedId: string | null;
  // Fires for BOTH a real pick and "None" (`null`).
  onSelect: (id: string | null) => void;
  testID?: string;
};
