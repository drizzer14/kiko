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
  // A wrapped line starts at the left edge of its own box, so the value in the right-hand column
  // is aligned to the right, as the last charge of a series row is.
  wrappedValue: {
    textAlign: 'right',
  },
  // `flex-end` matches the right-aligned values of the summary table.
  paidLines: {
    alignItems: 'flex-end',
    gap: theme.spacing(1),
  },
  // The gap below each card, so the charges read as a stack of cards, as Home's rows do.
  chargeCard: {
    marginBottom: theme.spacing(2),
  },
}));
