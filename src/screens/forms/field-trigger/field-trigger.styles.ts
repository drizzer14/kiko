import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field showing the current selection: a bordered chip matching
  // an ACTIVE TextField / the DateField field (same border color, radius,
  // padding, and — crucially — no surface fill, which would read as disabled),
  // so every form picker reads as one family. Lives here, not per-caller: it
  // was a byte-for-byte copy across CategoryField and HoldingSelectField
  // before both were unified onto this one shared trigger.
  field: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
  },
}));
