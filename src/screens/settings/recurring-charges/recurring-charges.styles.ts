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
    gap: theme.spacing(2),
  }),
  // The total of all, laid out as a group heading: the label on the left, the money opposite it.
  totalRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
  totalAmount: {
    flexShrink: 0,
  },
  // The name block on the left and its button on the right, centered against the block, which is
  // three lines for a marked chain without a charge.
  entryRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  entryName: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
}));
