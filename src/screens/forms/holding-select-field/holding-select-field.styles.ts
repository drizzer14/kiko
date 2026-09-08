import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field's own bordered-chip style now lives in the shared
  // `FieldTrigger` (see field-trigger.styles.ts) — this file no longer needs
  // its own copy.
  // Pushes the collapsed field's trailing account-name caption to the field's
  // right edge, so the picked holding's account reads disambiguated even
  // while the sheet is closed.
  fieldAccount: {
    marginLeft: 'auto',
  },
  // A single holding row inside the select sheet: icon + name (+ currency
  // caption). The selected row's accent tint is applied inline (a runtime
  // selected value, not a static token); padding/radius mirror the field chip
  // so a row reads in parity.
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // Lets the name + currency caption stack vertically and take up the space
  // between the leading icon and the trailing checkmark.
  optionText: {
    flexShrink: 1,
  },
  // Pushes the trailing checkmark to the row's far edge, so the selected row
  // reads with the tick right-aligned regardless of its name length.
  checkmark: {
    marginLeft: 'auto',
  },
}));
