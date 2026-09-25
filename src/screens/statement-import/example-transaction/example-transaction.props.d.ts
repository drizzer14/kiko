import type { ParsedTransaction } from '../../../statement-import/parser';

export type ExampleTransactionProps = {
  // The row to preview — normally `PreviewStats.firstTransaction`, the FIRST
  // parsed row in on-file order.
  transaction: ParsedTransaction;
  // The chosen target holding's name — feeds
  // `transactionRowDescription`'s own income/expense fallback label, the
  // same one Home falls back to for a stored row with no description. A
  // preview rendered before a holding is chosen (or with an unknown one)
  // passes `undefined`; the fallback then reads with an empty name, still
  // never a blank title.
  holdingName?: string;
  testID?: string;
};
