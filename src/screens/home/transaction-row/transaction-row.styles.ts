import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A single transaction row, a glass card (M2): the GlassSurface owns the
  // padding and radius; this only sets the gap BELOW each card so the list
  // reads as a stack of cards rather than hairline-separated rows.
  rowCard: {
    marginBottom: theme.spacing(2),
  },
  // The primary line of a row: description on the left, amount on the right.
  // Top-aligned so the icon and amount stay anchored to the top of the row and
  // hold their place as a long title wraps and grows downward.
  rowMain: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  // The leading cluster of a row: category icon + description, kept together on
  // the left so the row's space-between only splits this cluster from the
  // amount. `flex: 1` bounds it to the space left of the amount, and the right
  // margin keeps a long, wrapping description clear of the amount column. Top-
  // aligned so the icon sticks to the first line of a wrapping title.
  rowLead: {
    alignItems: 'flex-start',
    flex: 1,
    marginRight: theme.spacing(3),
  },
  // The description cell inside the lead cluster: `flex: 1` lets a long title
  // wrap onto multiple lines within the bounded lead column instead of pushing
  // the amount off-screen.
  rowDescription: {
    flex: 1,
  },
  // The trailing amount cell: never shrinks, so the amount stays fully visible
  // no matter how long the description grows.
  rowAmount: {
    flexShrink: 0,
  },
  // The row's secondary line: the account · category meta on the left, the
  // transaction time pinned to the bottom-right. `flex-end` keeps the time on
  // the last baseline even if the meta caption wraps onto a second line.
  rowFooter: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  // The meta caption cell: `flex: 1` bounds it to the space left of the time so
  // a long account · category label wraps within it instead of pushing the time
  // off the row.
  rowFooterMeta: {
    flex: 1,
  },
}));
