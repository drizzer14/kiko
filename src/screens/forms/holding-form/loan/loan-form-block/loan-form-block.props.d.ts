import type { UseLoanFieldsResult } from '../use-loan-fields/use-loan-fields';
import type { HoldingSelectOption } from '../../../holding-select-field/holding-select-field.props';

export type LoanFormBlockProps = {
  fields: UseLoanFieldsResult;
  attemptedSave: boolean;
  // Every OPEN, non-ledgerless holding in this loan's own currency — built
  // and filtered by `HoldingFormScreen` (the same holdings-derived-option
  // pattern every other picker on this screen follows), not owned by
  // `useLoanFields` itself.
  paymentHoldingOptions: readonly HoldingSelectOption[];
};
