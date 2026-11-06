import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The list is the screen's scroll view, a direct child of `Screen` (`bleedTop`), so iOS tracks
  // it for the large title.
  list: {
    flex: 1,
  },
  // The list owns the screen's padding, as the ledger of a holding does: `spacing(4)` below the
  // title, the content margin at the sides, and under the last row either the floating footer's
  // end padding, so the last charge stops at the footer's top edge, or the tab bar's clearance.
  listContent: (
    bottomClearance: number,
    contentMargin: number,
    floatingFooterEnd: number | undefined,
  ) => ({
    paddingTop: theme.spacing(4),
    paddingHorizontal: contentMargin,
    paddingBottom: floatingFooterEnd ?? theme.spacing(4) + bottomClearance,
  }),
  header: {
    paddingBottom: theme.spacing(4),
  },
  // What the series paid so far: the label on the left, the money opposite it.
  paidRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paidLabel: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
  paidAmount: {
    flexShrink: 0,
  },
  // The gap below each card, so the charges read as a stack of cards, as Home's rows do.
  chargeCard: {
    marginBottom: theme.spacing(2),
  },
}));
