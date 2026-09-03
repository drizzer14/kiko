import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable range field: a bordered, filled chip matching the Accounts /
  // Categories dropdowns' chrome (same border, fill, radius, padding) so the
  // three filter controls read as one consistent row. A leading calendar icon
  // sits before the range label.
  field: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
  },
  // The Clear/Apply action row, pushed to the trailing edge of the sheet.
  actions: {
    justifyContent: 'flex-end',
  },
}));
