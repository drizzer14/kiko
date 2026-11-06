import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The name and its recurrence line on the left, the last charge's amount and its date on the
  // right, top-aligned so the amount stays at the first line as a long name wraps, as a
  // transaction card's does.
  main: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  lines: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
  // The amount never shrinks. The cap is what lets the long quiet line wrap inside the column
  // instead of running past the card and squeezing the name to nothing.
  amount: {
    flexShrink: 0,
    maxWidth: '60%',
    alignItems: 'flex-end',
  },
  // A wrapped line starts at the frame's left edge unless it is aligned itself, and the column
  // only right-flushes the frame.
  lastCharge: {
    textAlign: 'right',
  },
}));
