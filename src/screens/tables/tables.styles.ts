import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
  // The table scrolls inside its own room, and the controls scroll inside it, above the caption;
  // only the empty state keeps them above its message. One column fills the screen either way.
  content: {
    flex: 1,
  },
  // The two filters on one row, wrapping when a narrow device cannot hold both.
  filterBar: {
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});
