import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The rows scroll within the sheet's capped height rather than growing it, so the total below
  // them stays in view however many rows there are.
  list: {
    flexShrink: 1,
  },
  // The gap the sheet's own column puts between its children, which the list's rows do not get.
  rows: {
    gap: theme.spacing(2),
  },
  // The label on the left and the sum on the right, as the rows above it split theirs.
  total: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing(3),
  },
}));
