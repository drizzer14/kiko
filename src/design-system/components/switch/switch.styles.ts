import { StyleSheet } from 'react-native-unistyles';

// Only used for the labeled row layout; the toggle itself is styled through
// `trackColor`/`thumbColor` props on the native `Switch`, not `style`.
export const styles = StyleSheet.create(() => ({
  row: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
}));
