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
  // A card in a grid row fills its cell, so the cards of one row end at the tallest one's height.
  gridCard: {
    flexGrow: 1,
  },
  // A chart card's title sits above the chart itself; the card's own
  // GlassSurface padding frames the whole block.
  cardTitle: {
    ...theme.typography.heading,
  },
}));
