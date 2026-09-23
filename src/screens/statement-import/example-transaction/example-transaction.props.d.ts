import type { ParsedTransaction } from '../../../statement-import/parser';

export type ExampleTransactionProps = {
  // The row to preview — normally `PreviewStats.firstTransaction`, the FIRST
  // parsed row in on-file order.
  transaction: ParsedTransaction;
  testID?: string;
};
