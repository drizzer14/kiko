import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The chart card: the SVG plot stacked above its legend row, with a small
  // gap so the legend reads as a caption to the plot rather than part of it.
  container: {
    rowGap: theme.spacing(2),
  },
  // The legend sits below the plot as a wrapping row of entries, one per
  // currency line, so many currencies flow onto a second row instead of
  // overflowing the card width.
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: theme.spacing(3),
    rowGap: theme.spacing(1),
  },
  // One legend entry: a colour swatch matching the line, then its currency
  // code, sitting together on a single baseline.
  legendEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  // The small square swatch; its background colour is filled per-entry from
  // the series palette, so only the shared shape lives here.
  swatch: {
    width: theme.spacing(3),
    height: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // The empty state fills roughly the plot's footprint and centres its
  // message, so a range with no data reads as intentional rather than broken.
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing(8),
  },
}));
