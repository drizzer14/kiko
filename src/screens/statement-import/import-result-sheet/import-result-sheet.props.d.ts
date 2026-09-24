import type { ImportResult } from '../../../statement-import/import-statement';

export type ImportResultSheetProps = {
  /** Whether the sheet is shown. Re-introduced as its own prop in fix round
   * 2 (N4) — round 1's ponytail review dropped it because both call sites
   * always passed `result !== undefined`, but N4 needs the two DECOUPLED:
   * on Done, the caller closes the sheet (`visible={false}`) FIRST, while
   * still passing the last `result` so the body's content is correct for
   * whatever the sheet's own closing animation shows, and only pops the
   * screen afterward. */
  visible: boolean;
  /** The successful `importStatement`/`importParsedStatement` result, shown
   * through the same `ImportOutcome` body both screens already render
   * inline. Stays defined through a Done-triggered close (never reset to
   * `undefined` — M4) so the closing sheet's last content is correct. An
   * import ERROR stays the screen's existing inline `ImportOutcome` text,
   * unchanged — this sheet is never shown for that case. */
  result: ImportResult | undefined;
  /** Runs when the sheet's one "Done" action is pressed, or on a scrim/back
   * dismiss — the caller closes the sheet (`visible={false}`) here. Does
   * NOT navigate — see `onClosed`. */
  onDone: () => void;
  /** Runs once the sheet has ACTUALLY finished closing — `BottomSheet`'s own
   * pass-through of RN `Modal`'s real `onDismiss` (R2-1, fix round 3). The
   * caller navigates from here, not from `onDone`, so a native-stack pop
   * never lands mid-animation. */
  onClosed: () => void;
};
