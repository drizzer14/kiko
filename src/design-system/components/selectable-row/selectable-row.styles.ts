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
  // selection vocabulary (ChipRow's selected chip, and the
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
  // The text mark itself: it renders through the same `variant="body"` Text
  // as the row's own label (see `selectable-row.component.tsx`), so it must
  // match the LABEL's text size, not the SF Symbol glyph footprint an
  // earlier version sized it to (`theme.iconSizes.body` — an icon size,
  // wrong scale for a text mark sitting beside body text). Leaving `fontSize`
  // unset lets the mark inherit `theme.typography.body`'s size straight from
  // the `variant` prop, the same way the label does; only the weight/
  // alignment are overridden here, bold enough to read as a glyph-like mark
  // rather than plain body copy. `adjustsFontSizeToFit` +
  // `minimumFontScale={0.6}` (set on the `Text` itself) remain the shrink
  // safety net for the widest marks (e.g. "Mex$").
  leadingTextMark: {
    fontWeight: '600',
    textAlign: 'center',
  },
  label: {
    flex: 1,
  },
  // The title line: the label on the left, an optional `trailing` node
  // (the bank picker's capability icons) pinned to the far right.
  // Top-aligned so a `trailing` icon lines up with
  // the label's FIRST line rather than the full label+description height —
  // the same `alignItems: 'flex-start'` reasoning as `SettingsRow`'s own
  // header row.
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  // The label's own wrapper inside `titleRow`: `flexShrink: 1` (RN's default
  // is 0) lets the label give up width to `trailing` instead of pushing it
  // out past the row.
  titleText: {
    flexShrink: 1,
  },
  // A small leading gutter so `trailing` never crowds a label that wraps up
  // against it.
  trailing: {
    marginLeft: theme.spacing(2),
  },
  // The optional `description` slot's gap from the label line above it.
  descriptionRow: {
    marginTop: theme.spacing(1),
  },
}));
