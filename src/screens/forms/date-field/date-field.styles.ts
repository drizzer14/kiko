import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field: a bordered chip matching an ACTIVE TextField's chrome
  // (same border color, radius, padding, and — crucially — no surface fill). A
  // `surface` background made it read as disabled, since that fill is exactly
  // the disabled-TextField treatment (see text-field.styles.ts `inputDisabled`);
  // dropping it keeps the field looking tappable. A leading calendar icon
  // precedes the formatted date / placeholder.
  field: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
  },
  // The full-screen scrim behind the calendar sheet; a tap dismisses without
  // selecting. True-black is on-brand for the OLED theme.
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: theme.colors.background,
  },
  // The calendar sheet: flush to the screen's bottom edge with rounded top
  // corners — a clean bottom sheet, no floating card frame.
  sheet: {
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    backgroundColor: theme.colors.surfaceHigh,
    padding: theme.spacing(4),
  },
}));
