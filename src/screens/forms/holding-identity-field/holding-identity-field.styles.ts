import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The icon chip on the left, the name field growing beside it. Bottom-aligned
  // so the chip lines up with the field's input row (which sits below its
  // caption label) rather than its caption.
  container: {
    alignItems: 'flex-end',
  },
  // The caption-free variant (a category row): with no field labels above the
  // controls, the chip and the input are the same height, so center them
  // against each other instead of bottom-aligning.
  containerBare: {
    alignItems: 'center',
  },
  // The name field's column: grows to fill the row beside the fixed-width icon
  // chip, so a long holding name has room to render.
  nameBlock: {
    flex: 1,
  },
  // A labelled name field: a bordered, filled input so the editable name reads
  // as a proper field rather than a tiny inline control. Pinned to the shared
  // control height (the iOS 44pt minimum tap target) so it matches the icon
  // chip beside it exactly — the chip carries the same `minHeight`, so the two
  // boxes are identical in height instead of the chip reading a hair taller.
  nameField: {
    color: theme.colors.textPrimary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(2),
    minHeight: theme.spacing(11),
    ...theme.typography.body,
  },
}));
