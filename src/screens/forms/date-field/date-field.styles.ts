import { StyleSheet } from 'react-native-unistyles';

import { disabledFieldStyle } from '../../../design-system/disabled-field-style';

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
  // A read-only (synced) date field: the SAME shared treatment as the disabled
  // TextField (`disabledFieldStyle` — border darkens to `surfaceHigh`, fills
  // with `surface`, dims to 0.5 opacity), so a field a synced transaction
  // cannot change looks the same as a disabled text input everywhere, in both
  // themes. Paired with forcing the value/placeholder Text to `textSecondary`
  // tone in date-field.component.tsx, mirroring `inputDisabled`'s `color`.
  fieldDisabled: {
    ...disabledFieldStyle(theme),
  },
}));
