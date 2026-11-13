import { StyleSheet } from 'react-native-unistyles';
import { disabledFieldStyle } from '@kiko/design-system/disabled-field-style';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field showing the current selection: a bordered chip matching
  // an ACTIVE TextField (same border color, radius, padding, and the
  // `fieldBackground` fill: unfilled in dark, where a `surface` fill would read
  // as disabled; white in light), so every form picker reads as one family.
  // Lives here, not per-caller: DateField, TimeField, CategoryField and
  // HoldingSelectField all render this one box.
  field: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.fieldBackground,
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
  },
  // The value's box: it grows so the trailing content and the chevron sit at the end of the row,
  // and shrinks so a long value wraps beside them instead of pushing the chevron out of the field.
  value: {
    flexGrow: 1,
    flexShrink: 1,
  },
  // A capped trigger is the column's width up to the shared cap, whatever its label, so a long
  // value wraps inside the cap, not widening the field.
  fieldCapped: {
    maxWidth: theme.layout.selectTriggerMaxWidth,
  },
  // A read-only trigger: the SAME shared treatment as the disabled TextField
  // (`disabledFieldStyle` — border darkens to `surfaceHigh`, fills
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
