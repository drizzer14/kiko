import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // A read-only chip row (an edit form's uneditable kind/type/currency): dimmed
  // so it reads as fixed while still showing which value is selected.
  disabled: {
    opacity: 0.5,
  },
}));
