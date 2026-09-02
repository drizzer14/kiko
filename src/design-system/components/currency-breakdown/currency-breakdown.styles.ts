import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The breakdown is a two-column table: two equal columns of currency cells
  // sitting side by side, with a gutter between them.
  table: {
    flexDirection: 'row',
    columnGap: theme.spacing(4),
  },
  // One column of the table: an equal share of the width, stacking its cells
  // vertically with a small gap between rows.
  column: {
    flex: 1,
    rowGap: theme.spacing(1),
  },
  // A single currency+amount cell: code and amount pushed to opposite edges so
  // amounts align down the column.
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  },
}));
