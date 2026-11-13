import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A bordered, filled chip that opens a filter sheet. The fill is `surface`, not the form fields'
  // `fieldBackground`, so a filter reads as a control on the screen rather than as an input. There
  // is no `alignSelf` on purpose: the row a pill sits in aligns it, and a caller that needs it to
  // hug its content inside a column sets `alignItems` on its own root. The height is a minimum, so
  // a larger Dynamic Type size grows the pill; the hit slop adds the rest of the 44 pt target.
  pill: {
    minHeight: theme.layout.filterPillHeight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
  },
  // An applied filter: the accent tint fills the pill and the hairline turns accent. The label
  // keeps `textPrimary`, because accent text on this tint misses 4.5:1 on some backdrops.
  pillActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSubtle,
  },
  row: {
    alignItems: 'center',
  },
  // Text's `style` admits typography keys only, so the shrink sits on a wrapper: a long label
  // wraps beside the glyph and the chevron instead of pushing the chevron out of the pill.
  label: {
    flexShrink: 1,
  },
}));
