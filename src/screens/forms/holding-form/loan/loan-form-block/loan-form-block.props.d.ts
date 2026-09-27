import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

import type { UseLoanFieldsResult } from '../use-loan-fields/use-loan-fields';

export type LoanFormBlockProps = {
  fields: UseLoanFieldsResult;
  attemptedSave: boolean;
  // Every OPEN, non-ledgerless holding in this loan's own currency — built
  // and filtered by `HoldingFormScreen` (the same holdings-derived-option
  // pattern every other picker on this screen follows), not owned by
  // `useLoanFields` itself.
  paymentHoldingOptions: readonly HoldingSelectOption[];
};
