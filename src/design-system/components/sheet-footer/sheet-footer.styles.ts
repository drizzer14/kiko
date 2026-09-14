import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
  // The shared action-row layout every choice sheet's footer now renders
  // through (previously duplicated as each screen's own `actions` style —
  // trend-filter-field.styles.ts and date-range-field.styles.ts). Buttons stay
  // packed to the trailing (body-end) edge in DOM order — secondary/destructive
  // first, primary last — matching the button-hierarchy spec's "secondary
  // left, primary right" rule. `alignItems: 'center'` keeps two differently
  // sized Buttons (e.g. a `regular` 50pt primary beside a `compact` 44pt
  // secondary) baseline-aligned instead of stretching to match heights.
  //
  // No top margin/padding lives here: the space above the footer already comes
  // from `BottomSheet`'s own `gap` prop, which spaces every one of its direct
  // children uniformly (including the footer, the last child) — adding a
  // second, footer-owned top spacing would double it. A call site that ever
  // renders `SheetFooter` outside a `BottomSheet` (or nested deeper than a
  // direct child) is responsible for its own leading spacing the same way any
  // other `Box` sibling would be.
  footer: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
});
