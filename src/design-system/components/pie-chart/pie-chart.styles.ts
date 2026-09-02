import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The chart card: the donut centred above its legend, with a gap so the
  // legend reads as a caption to the ring rather than crowding it.
  container: {
    rowGap: theme.spacing(3),
  },
  // Centres the donut horizontally within the card.
  chart: {
    alignItems: 'center',
  },
  // The legend is a vertical list, one row per account slice.
  legend: {
    rowGap: theme.spacing(2),
  },
  // One legend row: the account (swatch + name) pushed to the left edge, the
  // figures (amount + percent) to the right, so amounts align down the column.
  legendEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
  },
  // The account side of a legend row: colour swatch beside the account name.
  legendAccount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    flexShrink: 1,
  },
  // The figures side of a legend row: converted amount beside its share.
  legendFigures: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
  },
  // The small square swatch; its background colour is filled per-entry from
  // the slice palette, so only the shared shape lives here.
  swatch: {
    width: theme.spacing(3),
    height: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // The empty state centres its message over roughly the donut's footprint,
  // so an empty selection reads as intentional rather than broken.
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing(8),
  },
}));
