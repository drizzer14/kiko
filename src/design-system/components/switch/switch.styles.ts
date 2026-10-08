import { StyleSheet } from 'react-native-unistyles';

// Only used for the labeled row layout; the toggle itself is styled through
// `trackColor`/`thumbColor` props on the native `Switch`, not `style`.
export const styles = StyleSheet.create(() => ({
  row: {
    justifyContent: 'space-between',
    // The 31pt toggle is taller than a body line, so center it on the label.
    alignItems: 'center',
  },
  // RN's `flexShrink` defaults to 0 (unlike web flexbox's default of 1), so
  // without this the label never shrinks below its content width — it
  // overflows past the fixed-size toggle instead of wrapping onto a second
  // line. `flexShrink: 1` lets the label take only the width left over after
  // the toggle, which is what makes it wrap instead of overlap.
  label: {
    flexShrink: 1,
  },
}));
