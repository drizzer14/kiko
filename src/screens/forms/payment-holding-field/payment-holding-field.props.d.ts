import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

export type PaymentHoldingFieldProps = {
  label: string;
  // The picker sheet's header: a Title Case sheet title, a separate key from
  // the sentence-case `label` (kiko-translator: one key per UI role).
  sheetTitle: string;
  // The synthetic "clear the link" row's own label ("None"), prepended
  // ahead of `options` and shown as the trigger's value whenever
  // `selectedId` is `null`. Mirrors `LoanPaymentField`'s own `noneLabel`.
  noneLabel: string;
  options: readonly HoldingSelectOption[];
  selectedId: string | null;
  // Fires for BOTH a real pick and "None" (`null`).
  onSelect: (id: string | null) => void;
  testID?: string;
  // When set AND `options` is empty (the "None" row is not an option), the sheet
  // shows one "Add holding" row that calls this. The field then selects the
  // holding created on that round trip, once it appears among `options`.
  onCreateNew?: () => void;
};
