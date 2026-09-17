import type { ImportResult } from '../../../statement-import/import-statement';

export type ImportOutcomeProps = {
  /** A caught `importStatement` failure's message, if the last attempt
   * threw. */
  error?: string;
  /** The last successful `importStatement` result, if any. */
  result?: ImportResult;
};
