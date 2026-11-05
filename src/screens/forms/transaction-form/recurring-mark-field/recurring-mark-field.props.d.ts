import type { RecurringInput, RecurringLedgerRow } from '@kiko/recurring/detection';

export type RecurringMarkFieldProps = {
  // The stored row: its description and amount, never the draft's.
  existing: RecurringLedgerRow;
  holdings: RecurringInput['holdings'];
  accounts: RecurringInput['accounts'];
};
