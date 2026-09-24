import { StyleSheet } from 'react-native-unistyles';

// The segment's own content height. Together with the track's `spacing(1)`
// padding on both edges, the track's total VISIBLE height is 24 + 2*4 =
// 32pt — matching native `UISegmentedControl`. The component's own
// `SEGMENT_HIT_SLOP` restores the 44pt HIG touch target on top of this
// segment's OWN 24pt height (F3 fix round 2, M1 — round 1's hitSlop math
// used the 32pt track as its base by mistake; `hitSlop` only ever expands
// the element it's set on, which is this 24pt segment, not the track).
const SEGMENT_MIN_HEIGHT = 24;

export const styles = StyleSheet.create((theme) => ({
  track: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(1),
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SEGMENT_MIN_HEIGHT,
    paddingHorizontal: theme.spacing(2),
    borderRadius: theme.radii.sm,
  },
  // `theme.colors.segmentSelected` (F3 fix round 1, I3): a >=3:1 WCAG
  // non-text contrast ratio against the `surface` track, unlike the former
  // `surfaceHigh` fill (1.35:1) — see the token's own doc comment in
  // theme.ts.
  segmentSelected: {
    backgroundColor: theme.colors.segmentSelected,
  },
  label: {
    textAlign: 'center',
  },
  // UIKit renders a segmented control's selected label semibold. Composed
  // ALONGSIDE `label` (never alone — F3 fix round 2, N5 ponytail dropped
  // the duplicate `textAlign: 'center'` this used to repeat), adding only
  // the weight.
  selectedLabel: {
    fontWeight: '600',
  },
}));
