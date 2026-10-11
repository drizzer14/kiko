export type FormFooterProps = {
  onSave: () => void;
  isSubmitting: boolean;
  // Set only on an Edit template: it adds the secondary Create transaction button.
  onCreateTransaction?: () => void;
};
