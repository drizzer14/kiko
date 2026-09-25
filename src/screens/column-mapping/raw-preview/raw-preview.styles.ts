import { StyleSheet } from 'react-native-unistyles';

// The HIG 44pt tap-target floor: the row's own `paddingVertical` plus a
// caption line only reached ~34pt of real tappable height. `minHeight` (not
// `hitSlop`) grows the row's REAL layout box —
// `hitSlop` would extend into the next row (they sit directly adjacent under
// a `gap={2}` stack, not far enough apart to safely grow past their own
// bounds) and create overlapping touch targets between two rows.
const ROW_MIN_HEIGHT = 44;

export const styles = StyleSheet.create((theme) => ({
  // One raw-table row: cells laid out in a horizontal Box, the WHOLE grid
  // wrapped in a single horizontal ScrollView by the component (so every
  // row's cells stay column-aligned as the user scrolls sideways).
  // `paddingVertical` is deliberately generous (device-feedback-round-F1
  // item 5, "a little more vertical space") — every row also sits under a
  // `gap={2}` (the component's outer Box), up from `gap={1}`.
  row: {
    minHeight: ROW_MIN_HEIGHT,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(2),
    borderRadius: theme.radii.sm,
    // `row`'s own `direction="row"` makes the cross axis vertical — this
    // centers each cell's text within the taller `minHeight` box instead of
    // leaving it pinned to the top.
    alignItems: 'center',
  },
  // The tapped-as-header row paints the theme's accent BLUE (device-feedback-
  // round-F1 item 12) — the same filled-accent selection vocabulary
  // ChipRow uses, replacing the former neutral `surfaceHigh` tint.
  // Its cell text switches to the always-white `onAccent` tone (the
  // `SymbolIcon`/`Text`-on-accent-fill rule, `kiko-design-system`'s "The
  // `onAccent` rule") — done by the component, not here.
  selectedRow: {
    backgroundColor: theme.colors.accent,
  },
  // Each cell's own WIDTH is set inline per column (`computeColumnWidths`,
  // device-feedback-round-F1 item 6) — this only supplies the shared
  // trailing gap between columns.
  cell: {
    paddingRight: theme.spacing(2),
  },
  // The selected header row's own cell text: bolder than the
  // caption step's own regular 400 weight, so the chosen row reads as
  // clearly distinct at a glance, not only by its accent fill. `'600'`
  // (semibold) — the app's own selected-label weight everywhere else
  // (ChipRow, SelectableRow, FieldTrigger), not `'700'`.
  selectedCellText: {
    fontWeight: '600',
  },
}));
