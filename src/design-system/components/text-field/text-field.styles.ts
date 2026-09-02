import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(3),
    color: theme.colors.textPrimary,
    ...theme.typography.body,
  },
  // Applied on top of `input` when `editable === false`, so the field reads
  // clearly as non-editable rather than merely un-focusable.
  inputDisabled: {
    borderColor: theme.colors.surfaceHigh,
    backgroundColor: theme.colors.surface,
    color: theme.colors.textSecondary,
    opacity: 0.5,
  },
}));
