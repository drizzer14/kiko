import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // One raw-table row: cells laid out in a horizontal Box, the WHOLE grid
  // wrapped in a single horizontal ScrollView by the component (so every
  // row's cells stay column-aligned as the user scrolls sideways).
  // `paddingVertical` is deliberately generous (device-feedback-round-F1
  // item 5, "a little more vertical space") — every row also sits under a
  // `gap={2}` (the component's outer Box), up from `gap={1}`.
  row: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(2),
    borderRadius: theme.radii.sm,
  },
  // The tapped-as-header row paints the theme's accent BLUE (device-feedback-
  // round-F1 item 12) — the same filled-accent selection vocabulary
  // OptionPills/ChipRow use, replacing the former neutral `surfaceHigh` tint.
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
  // The selected header row's own cell text (F3 item 8): bolder than the
  // caption step's own regular 400 weight, so the chosen row reads as
  // clearly distinct at a glance, not only by its accent fill.
  selectedCellText: {
    fontWeight: '700',
  },
}));
