import { StyleSheet } from 'react-native-unistyles';

import { disabledFieldStyle } from '../../disabled-field-style';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field showing the current selection: a bordered chip matching
  // an ACTIVE TextField / the DateField field (same border color, radius,
  // padding, and — crucially — no surface fill, which would read as disabled),
  // so every form picker reads as one family. Lives here, not per-caller: it
  // was a byte-for-byte copy across CategoryField and HoldingSelectField
  // before both were unified onto this one shared trigger.
  field: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
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
  // The leading TEXT mark (`leadingText`, e.g. a currency symbol): renders
  // through the same `variant="body"` Text as the trigger's own `value` (see
  // `field-trigger.component.tsx`), so it must match the VALUE's text size,
  // not the SF Symbol icon's glyph footprint an earlier version sized it to
  // (an inline `fontSize: theme.iconSizes.body` override — an icon size,
  // wrong scale for a text mark sitting beside body text; the same device
  // bug SelectableRow's own `leadingTextMark` was fixed for). Leaving
  // `fontSize` unset lets the mark inherit `theme.typography.body`'s size
  // straight from the `variant` prop, the same way `value` does; only the
  // weight is overridden here, bold enough to read as a glyph-like mark
  // rather than plain body copy.
  leadingTextMark: {
    fontWeight: '600',
  },
}));
