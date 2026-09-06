import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field: a bordered chip matching an ACTIVE TextField's chrome
  // (same border color, radius, padding, and — crucially — no surface fill),
  // identical to DateField's field so the paired Date/Time row reads as one
  // control. A leading clock icon precedes the formatted time / placeholder.
  field: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
  },
  // A read-only (synced) time field: dimmed to read as locked, matching the
  // disabled DateField (`fieldDisabled`) and TextField opacity so a field a
  // synced transaction cannot change looks the same everywhere.
  fieldDisabled: {
    opacity: 0.5,
  },
}));
