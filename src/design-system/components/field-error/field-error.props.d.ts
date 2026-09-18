export type FieldErrorProps = {
  // The validation-failure message shown inline, in the `negative` (red)
  // caption tone — the reason a blocked Save button (or a single field) is
  // invalid right now. The caller decides WHETHER to render this at all —
  // there is no `visible` prop — the same way account-form's own
  // `!canSave && <Box>...` hint is gated at the call site.
  message: string;
  // Optional testID applied to the outer Box, so a test can target one
  // form's reason line deterministically among several.
  testID?: string;
};
