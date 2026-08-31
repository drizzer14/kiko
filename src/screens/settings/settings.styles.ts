import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(theme => ({
  // Groups a section's rows into a single inset-grouped-style card, the way
  // iOS Settings groups related rows under a section header.
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    overflow: 'hidden',
  },
  // A single row within a card.
  row: {
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // The last row in a card has no divider beneath it.
  rowLast: {
    borderBottomWidth: 0,
  },
  // The Monobank token entry field, laid out flush inside its row (the row
  // itself supplies the padding).
  tokenInput: {
    color: theme.colors.textPrimary,
    fontSize: theme.typography.body.fontSize,
    padding: 0,
  },
}));
