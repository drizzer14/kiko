import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field's own bordered-chip style now lives in the shared
  // `FieldTrigger` (see field-trigger.styles.ts) — this file no longer needs
  // its own copy.
  // The option rows scroll within the sheet's capped height rather than growing
  // it, so a long category list stays reachable (mirrors the icon picker).
  scroll: {
    flexShrink: 1,
  },
  // A single category row inside the select sheet: icon + title. The selected
  // row's accent tint is applied inline (a runtime selected value, not a static
  // token); padding/radius mirror the field chip so a row reads in parity.
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // Pushes the trailing checkmark to the row's far edge, so the selected row
  // reads with the tick right-aligned regardless of its title length.
  checkmark: {
    marginLeft: 'auto',
  },
}));
