import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The filter row: account multi-select on the left, date-range field on the
  // right, wrapping if the two controls exceed one line on a narrow device.
  filterBar: {
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  // The no-account empty state, centered in the page.
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A card in the shared row fills its cell, so the two cards end at the taller one's height, and
  // so does the body inside it, which gives the chart body below the room to centre in.
  sharedRowFill: {
    flexGrow: 1,
  },
  // The chart, centred vertically in the room the shorter card has left under its title.
  chartBody: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  // A chart card's title sits above the chart itself; the card's own
  // GlassSurface padding frames the whole block.
  cardTitle: {
    ...theme.typography.heading,
  },
}));
