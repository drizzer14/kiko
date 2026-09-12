import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The chart card: a vertical list of bar rows, each row a labelled bar, with
  // a gap so consecutive rows read as distinct entries.
  container: {
    rowGap: theme.spacing(3),
  },
  // One bar row: the label/amount header line stacked above the bar itself.
  row: {
    rowGap: theme.spacing(1),
  },
  // The header line of a row: the type name pushed to the left, its converted
  // amount to the right, so amounts align down the column.
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
  },
  // The empty state fills roughly the chart's footprint and centres its
  // message, so a range with no data reads as intentional rather than broken.
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing(8),
  },
}));
