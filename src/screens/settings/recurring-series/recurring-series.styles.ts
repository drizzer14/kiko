import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The list is the screen's scroll view, a direct child of `Screen` (`bleedTop`), so iOS tracks
  // it for the large title.
  list: {
    flex: 1,
  },
  // The list owns the screen's padding, as the ledger of a holding does: `spacing(4)` below the
  // title, the content margin at the sides, and the tab bar's clearance under the last row.
  listContent: (bottomClearance: number, contentMargin: number) => ({
    paddingTop: theme.spacing(4),
    paddingHorizontal: contentMargin,
    paddingBottom: theme.spacing(4) + bottomClearance,
  }),
  header: {
    paddingBottom: theme.spacing(4),
  },
  // The gap below each card, so the charges read as a stack of cards, as Home's rows do.
  chargeCard: {
    marginBottom: theme.spacing(2),
  },
}));
