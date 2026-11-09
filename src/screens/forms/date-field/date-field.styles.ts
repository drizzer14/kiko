import { StyleSheet } from 'react-native-unistyles';
import { disabledFieldStyle } from '@kiko/design-system/disabled-field-style';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field: a bordered chip matching an ACTIVE TextField's chrome
  // (same border color, radius, fill, padding). The fill is `fieldBackground`
  // (unfilled in dark, white in light), never `surface`: dark `surface` is
  // exactly the disabled-TextField treatment (see text-field.styles.ts
  // `inputDisabled`) and would make the field read as disabled. A leading
  // calendar icon precedes the formatted date / placeholder.
  field: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.fieldBackground,
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
