import type { ImportResult } from '../../../statement-import/import-statement';

export type ImportResultSheetProps = {
  /** The successful `importStatement`/`importParsedStatement` result, shown
   * through the same `ImportOutcome` body both screens already render
   * inline. The sheet is visible exactly when this is defined — a
   * SUCCESSFUL import; an import error stays the screen's existing inline
   * `ImportOutcome` text, unchanged. There is no separate `visible` prop
   * (ponytail review, fix round 1): both call sites always passed
   * `result !== undefined`, so a second prop carrying the same information
   * was redundant. */
  result: ImportResult | undefined;
  /** Runs when the sheet's one "Done" action is pressed, or on a scrim/back
   * dismiss — the caller navigates back to the account screen from here. */
  onDone: () => void;
};
