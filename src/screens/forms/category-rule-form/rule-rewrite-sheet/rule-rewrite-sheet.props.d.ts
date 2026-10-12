export type RuleRewriteSheetProps = {
  visible: boolean;
  // How many existing transactions saving the rule would change. Kept while the sheet closes, so
  // its text does not change under the fade.
  count: number;
  onApply: () => void;
  isApplying: boolean;
  onKeepNew: () => void;
  isKeepingNew: boolean;
  // The scrim, the back gesture and Cancel all call this: nothing is saved.
  onDismiss: () => void;
  // The sheet has finished closing, the point where the screen may leave.
  onClosed: () => void;
};
