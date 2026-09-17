import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // One catalog row: title + about + eligibility caption, stacked. Mirrors
  // HoldingSelectField's own hand-rolled sheet row padding/radius so a picker
  // row reads in parity across the app.
  option: {
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
