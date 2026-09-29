export type NotificationPreAlertSheetProps = {
  visible: boolean;
  /** Runs on the one Continue button and on a scrim/back dismiss; the caller
   * closes the sheet here. */
  onContinue: () => void;
  /** Runs once the sheet has finished closing (RN `Modal`'s own
   * `onDismiss`). The caller asks iOS for permission from here, so the system
   * prompt never lands on a sheet that is still animating out. */
  onClosed: () => void;
};
