import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
  // Right-aligned so the total and its caption hug the card's right edge, and never squeezed by
  // a long name beside them.
  column: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
});
