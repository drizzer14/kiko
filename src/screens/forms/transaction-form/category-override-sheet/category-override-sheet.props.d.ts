export type CategoryOverrideSheetProps = {
  visible: boolean;
  // Dismissing the sheet (scrim/back) and the Cancel button both call this.
  onDismiss: () => void;
  // The picked category's glyph name, or `null` while no override is pending.
  categoryIcon: string | null;
  message: string;
  // Offered only when an existing row is being edited: a brand-new unsaved row
  // has no id to target and already carries its category.
  canApplyToOne: boolean;
  onApply: () => void;
  isApplying: boolean;
  onApplyOne: () => void;
  isApplyingOne: boolean;
  // Either write in flight: Cancel is disabled while it runs.
  isWriting: boolean;
};
