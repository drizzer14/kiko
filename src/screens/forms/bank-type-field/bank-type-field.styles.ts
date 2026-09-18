import { StyleSheet } from 'react-native-unistyles';

// Mirrors `add-bank-sheet.styles.ts`'s `option` style — the two sheets share
// the same row chrome by design.
export const styles = StyleSheet.create((theme) => ({
  option: {
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
