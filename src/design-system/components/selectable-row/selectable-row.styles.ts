import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // One selectable row's tap area: rounded and inset so the selected fill
  // reads as a contained row rather than an edge-to-edge band, holding the
  // 44pt HIG minimum height so the row is a comfortable tap target.
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // The selected row's fill: the FILLED accent surface — the app's standard
  // selection vocabulary (OptionPills / ChipRow's selected pill, and the
  // Statistics manual-mode category row this component generalizes) — so a
  // chosen option reads unambiguously against a low-contrast surface, with
  // the row's onAccent label/icon/checkmark carrying the contrast on top.
  optionSelected: {
    backgroundColor: theme.colors.accent,
  },
  // The row's inner layout: a fixed-width check slot, an optional icon slot,
  // then the label.
  optionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
  },
  check: {
    width: theme.spacing(5),
    alignItems: 'center',
  },
  icon: {
    width: theme.spacing(5),
    alignItems: 'center',
  },
  // A wider leading slot for a TEXT mark (`leadingText`): a 3-4 character
  // currency mark ("AED", "Mex$") needs more room than the SF Symbol glyph
  // the plain `icon` slot above is sized for. `leadingTextMark` below still
  // shrinks to fit as a safety net for the widest marks, so this slot only
  // needs to comfortably fit the common case, not the absolute worst case.
  iconText: {
    width: theme.spacing(11),
    alignItems: 'center',
  },
  // The text mark itself: sized to the same visual footprint as the SF
  // Symbol icon it stands in for (`iconSizes.body`, the icon slot's own
  // glyph size) and bold enough to read as a glyph rather than body copy.
  leadingTextMark: {
    fontSize: theme.iconSizes.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  label: {
    flex: 1,
  },
}));
