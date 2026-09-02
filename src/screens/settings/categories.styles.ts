import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A single full-width category row within the GlassSurface list. Mirrors the
  // SettingsRow row/divider shape (see settings.styles.ts) so the two lists
  // read as one design language.
  row: {
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // The last row in the list has no divider beneath it.
  rowLast: {
    borderBottomWidth: 0,
  },
}));
