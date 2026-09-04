import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field showing the current selection: a bordered chip matching
  // an ACTIVE TextField / the DateField field (same border color, radius,
  // padding, and — crucially — no surface fill, which would read as disabled),
  // so the two form pickers read as one family.
  field: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
  },
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
