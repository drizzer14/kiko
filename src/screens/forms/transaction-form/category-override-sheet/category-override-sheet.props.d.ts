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
  // The name's text before a store number, or `null` for a name with none: it offers the rule for
  // every name that starts the same way.
  prefix: string | null;
  onOfferPrefix: () => void;
  // The preview behind that offer is loading.
  isOfferingPrefix: boolean;
  // Non-null while the preview of the prefix rule is shown in place of the first step.
  prefixConfirm: {
    message: string;
    onConfirm: () => void;
    onBack: () => void;
    isApplying: boolean;
  } | null;
};
