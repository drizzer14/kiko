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
  // A single checkable option row: a leading check slot then the option label.
  // Vertical padding gives each row a comfortable tap target; the sheet stays
  // open as rows are toggled, so several can be checked in one pass.
  option: {
    alignItems: 'center',
    paddingVertical: theme.spacing(2),
  },
  // The fixed-width leading slot that holds the checkmark when an option is
  // selected, so every label starts at the same x whether checked or not.
  check: {
    width: 18,
    alignItems: 'center',
  },
  // The fixed-width slot that holds an option's own icon (an account/category
  // glyph), reserved on every row of an icon-bearing menu so the labels stay
  // aligned whether or not a given row has an icon (the "All" row does not).
  icon: {
    width: 18,
    alignItems: 'center',
  },
}));
