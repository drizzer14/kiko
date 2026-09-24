import type { ImportResult } from '../../../statement-import/import-statement';

export type ImportResultSheetProps = {
  /** Whether the sheet is mounted and shown — visible only after a
   * SUCCESSFUL import (a defined `result`); an import error stays the
   * screen's existing inline `ImportOutcome` text, unchanged. */
  visible: boolean;
  /** The successful `importStatement`/`importParsedStatement` result, shown
   * through the same `ImportOutcome` body both screens already render
   * inline. */
  result: ImportResult | undefined;
  /** Runs when the sheet's one "Done" action is pressed, or on a scrim/back
   * dismiss — the caller navigates back to the account screen from here. */
  onDone: () => void;
};
