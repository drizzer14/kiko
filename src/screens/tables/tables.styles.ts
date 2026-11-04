import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
  // The table scrolls inside its own room, so the controls above it and the table share one
  // column that fills the screen.
  content: {
    flex: 1,
  },
  // The two filters on one row, wrapping when a narrow device cannot hold both.
  filterBar: {
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});
