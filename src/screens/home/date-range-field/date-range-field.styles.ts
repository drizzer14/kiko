import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable range field: a bordered, filled chip matching the Accounts /
  // Categories dropdowns' chrome (same border, fill, radius, padding) so the
  // three filter controls read as one consistent row. A leading calendar icon
  // sits before the range label.
  field: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
  },
  // The Clear/Apply action row, pushed to the trailing edge of the sheet.
  // Rendered as a SIBLING of the sheet's own inner `ScrollView` (below), never
  // inside it — a bottom sheet's cap (F5 fix) means the heading + calendar can
  // scroll on a small screen, but Apply/Clear must always stay reachable, so
  // they sit outside the scrollable region.
  actions: {
    justifyContent: 'flex-end',
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
