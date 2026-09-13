import { StyleSheet } from 'react-native-unistyles';

import { disabledFieldStyle } from '../../../design-system/disabled-field-style';

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
  // A read-only trigger: the SAME shared treatment as the disabled TextField /
  // DateField (`disabledFieldStyle` — border darkens to `surfaceHigh`, fills
  // with `surface`, dims to 0.5 opacity), so a field the domain forbids
  // changing (e.g. a holding's currency in edit mode) reads the same as every
  // other disabled field in the app.
  fieldDisabled: {
    ...disabledFieldStyle(theme),
  },
}));
