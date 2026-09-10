import { StyleSheet } from 'react-native-unistyles';

import { disabledFieldStyle } from '../../../design-system/disabled-field-style';

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
  // A read-only (synced) time field: the SAME shared treatment as the
  // disabled TextField and DateField (`disabledFieldStyle` — border darkens
  // to `surfaceHigh`, fills with `surface`, dims to 0.5 opacity), so a field a
  // synced transaction cannot change looks the same everywhere, in both
  // themes. Paired with forcing the value/placeholder Text to `textSecondary`
  // tone in time-field.component.tsx, mirroring TextField's `inputDisabled`
  // `color`.
  fieldDisabled: {
    ...disabledFieldStyle(theme),
  },
}));
