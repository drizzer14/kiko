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
  // A read-only (synced) date field: dimmed to read as locked, matching the
  // disabled TextField (`inputDisabled`) and ChipRow (`disabled`) opacity so a
  // field a synced transaction cannot change looks the same everywhere.
  fieldDisabled: {
    opacity: 0.5,
  },
}));
