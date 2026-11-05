import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The name and its lines on the left, the last charge's amount on the right, top-aligned so the
  // amount stays at the first line as a long name wraps, as a transaction card's does.
  main: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  lines: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
  amount: {
    flexShrink: 0,
  },
}));
