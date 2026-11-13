import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The field sits in a column (Home's filter area), where a child stretches to the column's
  // width by default; this lets the pill hug its content like its siblings in a row do.
  root: {
    alignItems: 'flex-start',
  },
  // The heading + calendar's own scrollable region: `BottomSheet` renders NO
  // ScrollView of its own here (`scrollable={false}`, since the Clear/Apply
  // row above needs to stay OUTSIDE any scroll region, unlike every plain
  // sheet). `flexShrink: 1` is what lets this ScrollView actually shrink to
  // fit the sheet's 66% cap instead of growing it — a bare `ScrollView` with
  // no explicit sizing ignores its parent's height limit.
  scroll: {
    flexShrink: 1,
  },
  // The heading-to-calendar gap, matching the sheet's own former single `gap`
  // value now that the two live inside a nested `ScrollView` rather than as
  // direct children of `BottomSheet`.
  scrollContent: {
    gap: theme.spacing(4),
  },
}));
