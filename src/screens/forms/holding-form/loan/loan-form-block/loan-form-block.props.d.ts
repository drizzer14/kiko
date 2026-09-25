import type { UseLoanFieldsResult } from '../use-loan-fields/use-loan-fields';

export type LoanFormBlockProps = {
  fields: UseLoanFieldsResult;
  attemptedSave: boolean;
};
