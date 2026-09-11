import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The dropdown anchor: a bordered, filled chip that opens the checkable sheet
  // on press. Icon + label sit centered in a row. Matches the date-range field's
  // chrome so the three filter controls read as one consistent row.
  button: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
  },
}));
