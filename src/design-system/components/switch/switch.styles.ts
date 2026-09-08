import { StyleSheet } from 'react-native-unistyles';

// Only used for the labeled row layout; the toggle itself is styled through
// `trackColor`/`thumbColor` props on the native `Switch`, not `style`.
export const styles = StyleSheet.create(() => ({
  row: {
    justifyContent: 'space-between',
    // Top-align the toggle to the label's FIRST line, not the label's full
    // (possibly multi-line, once wrapped) height — a long label like "Follow
    // system setting" must wrap without dragging the toggle down with it.
    alignItems: 'flex-start',
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
