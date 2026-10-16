import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The primary line of an entry: description on the left, amount on the right, split by
  // space-between.
  rowMain: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // The leading cluster of an entry: icon + description, kept together on the left so the
  // row's space-between only splits this cluster from the amount. `flex: 1` bounds it to the
  // space left of the amount; top-aligned so the icon sticks to the first line of a wrapping
  // title.
  rowLead: {
    flex: 1,
    alignItems: 'flex-start',
  },
  // The description cell: `flex: 1` lets a long title wrap onto multiple lines within the
  // bounded row instead of pushing the amount off-screen.
  rowDescription: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
  // The trailing amount cell: never shrinks, so the amount stays fully visible no matter how
  // long the description grows.
  rowAmount: {
    flexShrink: 0,
  },
  // The entry's secondary lines pinned to the right so they sit BELOW the value column
  // instead of left-aligned under the description, mirroring the Home row's footer. The
  // shrink-wrapped box is itself right-flush (`alignSelf`), and `alignItems` keeps each of
  // several lines right-flush inside it.
  rowFooter: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  // A footer line that wraps: the box above only right-flushes each Text's frame, so without
  // this the continuation line would start at the frame's left edge instead of staying flush
  // with the amount column.
  rowFooterLine: {
    textAlign: 'right',
  },
}));
