export type ConfirmSheetProps = {
  /** Whether the sheet and its dismiss scrim are mounted and shown. */
  visible: boolean;
  /**
   * The sheet's heading, rendered in the draggable header — e.g. a card
   * menu's `Delete "<name>"` or the transaction form's `Delete Transaction`.
   */
  title: string;
  /**
   * An optional body message under the title. Omitted for a bare, title-only
   * confirm (the card long-press delete passes none).
   */
  message?: string;
  /** The confirm button's label (e.g. `Delete`). */
  confirmLabel: string;
  /**
   * Runs the confirmed action. Guard a double-submit at the call site by
   * wrapping it in `useSubmitOnce` (the transaction-form delete does this).
   */
  onConfirm: () => void;
  /**
   * Runs on the Cancel button AND on a scrim/back dismiss — a dismiss behaves
   * like Cancel.
   */
  onCancel: () => void;
  /**
   * When true the confirm button uses the `destructive` Button variant (a red
   * fill); otherwise the accent `primary` variant. Defaults to false.
   */
  destructive?: boolean;
  /** An optional testID forwarded onto the confirm button. */
  confirmTestID?: string;
};
