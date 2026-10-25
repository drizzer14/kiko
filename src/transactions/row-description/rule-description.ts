import { transactionRowDescription } from './row-description';

type RowDescriptionInput = Parameters<typeof transactionRowDescription>[0];

// A stored default-description row holds '' and shows its label only at render time, so a rule
// that read the stored text could never match what the user sees. This is the ONE name every apply
// path of a category rule reads: the stored description, or for a blank one the label the lists
// show, in the language the app runs in now.
export const ruleDescriptionOf = (
  input: Omit<RowDescriptionInput, 'transaction'> & {
    transaction: Omit<RowDescriptionInput['transaction'], 'description'> & {
      description?: string | null;
    };
  },
): string =>
  transactionRowDescription({
    ...input,
    transaction: { ...input.transaction, description: input.transaction.description ?? '' },
  });
