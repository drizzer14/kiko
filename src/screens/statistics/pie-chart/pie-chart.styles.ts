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
  // One legend row, a three-column table line: the name column flexes to fill
  // the row, then the two fixed-width figure columns sit at the right so their
  // values and percents align vertically down the list.
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: theme.spacing(2),
  },
  // The name column: colour swatch beside the account name, growing to fill the
  // width left of the figure columns. `minWidth: 0` lets a long name wrap within
  // the column rather than shove the figures out of alignment.
  legendName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    flex: 1,
    minWidth: 0,
  },
  // The name itself, in the width the swatch leaves: RN text does not shrink
  // in a row on its own, so without this a long name runs into the value.
  legendLabel: {
    flex: 1,
  },
  // The value column: a fixed width shared by every row, right-aligned so the
  // converted amounts line up on their trailing digits regardless of magnitude.
  legendValue: {
    width: theme.spacing(28),
    alignItems: 'flex-end',
  },
  // The percent column: a narrower fixed width, right-aligned for the same
  // vertical alignment as the value column beside it.
  legendPercent: {
    width: theme.spacing(11),
    alignItems: 'flex-end',
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
  // Absolutely centres the donut's total figure (and its subtle "Total"
  // caption) over the ring's hole. Sized to the same `size` as the sibling
  // `<Svg>` inline at render time — this static sheet does not know the
  // caller's `size` prop — so it centres within the exact box the ring is
  // drawn in, not merely within `chart`'s own (already-centred) bounds.
  centerTotal: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The total figure itself, at the section-title token. It sets no `lineHeight`: iOS shrinks
  // an `adjustsFontSizeToFit` text only while both its width and height overflow, and a fixed
  // line height equal to the font size never shrinks. The component bounds its width to the hole.
  // `MoneyText` still owns the tone color, so this omits `color`.
  centerAmount: {
    ...theme.typography.title,
    textAlign: 'center',
  },
}));
