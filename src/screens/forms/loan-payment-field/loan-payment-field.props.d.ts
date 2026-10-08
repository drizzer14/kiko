import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

export type LoanPaymentFieldProps = {
  label: string;
  // Forwarded to `PaymentHoldingField` as its Title Case sheet header.
  sheetTitle: string;
  // The synthetic "clear the link" row's own label ("None"), prepended
  // ahead of `options` and shown as the trigger's value whenever
  // `selectedId` is `null`.
  noneLabel: string;
  // Every OPEN loan holding in the payment's own currency — the caller
  // (the transaction form) builds and filters this list; this component
  // only renders what it is given, mirroring `HoldingSelectField`.
  options: readonly HoldingSelectOption[];
  selectedId: string | null;
  // Fires for BOTH a real pick and "None" (`null`) — the caller persists
  // either at once through `transactionsRepo.setLoanPayment`, with no
  // Save-button gating.
  onSelect: (loanHoldingId: string | null) => void;
  // `'auto'` renders the "linked automatically" caption + Undo below the
  // trigger; `'manual'` and `null` (no link) render neither.
  linkSource: 'auto' | 'manual' | null;
  autoLinkedCaption: string;
  undoLabel: string;
  onUndo: () => void;
  testID?: string;
};
