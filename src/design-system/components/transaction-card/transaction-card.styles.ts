import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The primary line: category icon + title on the left, amount on the
  // right. Top-aligned so the icon and amount stay anchored as a long title
  // wraps and grows downward.
  rowMain: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  // The leading cluster: category icon + title, kept together so the row's
  // space-between only splits this cluster from the amount.
  rowLead: {
    alignItems: 'flex-start',
    flex: 1,
    marginRight: theme.spacing(3),
  },
  rowDescription: {
    flex: 1,
  },
  rowAmount: {
    flexShrink: 0,
  },
  // The secondary line: the left caption grows to fill the space left of the
  // right one, which stays pinned to the last baseline.
  rowFooter: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  rowFooterMeta: {
    flex: 1,
  },
}));
