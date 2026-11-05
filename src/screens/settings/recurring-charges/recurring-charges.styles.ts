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
  // The merchant's name on the left and the way back on the right, centered against the name block,
  // which is one line for a hidden merchant and three for a marked chain without a charge. Both are
  // laid out alike.
  entryRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  entryName: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
}));
