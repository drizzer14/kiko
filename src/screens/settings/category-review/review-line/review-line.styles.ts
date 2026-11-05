import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The name and its counts on the left, the button on the right, centred on the pair so it holds
  // its place as a long name wraps.
  main: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lines: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
  action: {
    flexShrink: 0,
  },
}));
