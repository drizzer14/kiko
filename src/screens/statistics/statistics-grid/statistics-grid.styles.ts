import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
  // Equal-width cells; `minWidth: 0` lets a card narrower than its content shrink with its column
  // instead of widening the row.
  cell: {
    flex: 1,
    minWidth: 0,
  },
});
