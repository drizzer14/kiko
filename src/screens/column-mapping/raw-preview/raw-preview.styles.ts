import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // One raw-table row: cells laid out in a horizontal Box, the WHOLE grid
  // wrapped in a single horizontal ScrollView by the component (so every
  // row's cells stay column-aligned as the user scrolls sideways).
  row: {
    paddingVertical: theme.spacing(1),
    paddingHorizontal: theme.spacing(2),
    borderRadius: theme.radii.sm,
  },
  // The tapped-as-header row reads as a raised, selected surface — the same
  // `surfaceHigh` a selected settings row uses elsewhere.
  selectedRow: {
    backgroundColor: theme.colors.surfaceHigh,
  },
  // A fixed minimum width per cell keeps every row's columns aligned as the
  // grid scrolls, regardless of how short an individual cell's own text is.
  cell: {
    minWidth: 96,
    paddingRight: theme.spacing(2),
  },
}));
