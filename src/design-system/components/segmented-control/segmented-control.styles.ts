import { StyleSheet } from 'react-native-unistyles';

// The REAL touch target (F3 fix round 3, N6): RN 0.87's Fabric hit-test
// (`RCTViewComponentView betterHitTest`) drops a touch that falls outside
// the PARENT's own layout bounds when that parent does not overflow —
// `hitSlop` never counts toward that overflow, so a `hitSlop`-only
// "44pt target on a 32pt element" (fix round 2's approach) is a 32pt
// target on a real device, not 44pt. Every segment `Pressable` is now
// itself 44pt tall in real layout — no `hitSlop` at all — with the
// SHORTER visible track/pill drawn as absolutely-positioned decorative
// layers underneath, so the visual is unchanged.
const SEGMENT_HEIGHT = 44;
// The visible track/pill height, matching native `UISegmentedControl`.
const TRACK_HEIGHT = 32;
// How far the visible track/pill insets from the segment's own 44pt real
// bounds, top and bottom, to land at the shorter `TRACK_HEIGHT`.
const TRACK_INSET = (SEGMENT_HEIGHT - TRACK_HEIGHT) / 2;

export const styles = StyleSheet.create((theme) => ({
  // The outer positioning context for the absolutely-positioned track
  // fill underneath the real, full-height segment row.
  container: {
    position: 'relative',
  },
  // The real, 44pt-tall row of segment `Pressable`s — see `segment` below.
  // `paddingHorizontal` reproduces the OLD track's own `padding` (the gap
  // between the track's outer edge and its segments cluster) as REAL
  // layout, which shrinks the row's usable width but never drops a touch
  // (unlike `hitSlop`, which tries to grow BEYOND real bounds).
  row: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing(1),
  },
  // The visible, `TRACK_HEIGHT`-tall track background — a decorative layer
  // painted UNDER the real segment row, spanning the FULL container width
  // (the segments cluster insets from it via `row`'s own padding above,
  // exactly reproducing the old single-`Box` track's look).
  // `pointerEvents="none"` (set by the component) keeps it out of hit
  // testing entirely; it is purely visual.
  trackFill: {
    position: 'absolute',
    top: TRACK_INSET,
    bottom: TRACK_INSET,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.sm,
  },
  // One segment: the REAL 44pt-tall touch target. `position: 'relative'`
  // so its own selected-pill fill (below) can anchor to ITS bounds.
  segment: {
    flex: 1,
    position: 'relative',
    height: SEGMENT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing(2),
  },
  // The selected segment's own `TRACK_HEIGHT`-tall pill fill — inset the
  // SAME `TRACK_INSET` top/bottom as `trackFill` (both measure off the
  // identical 44pt base), filling the segment's own width edge-to-edge
  // (no additional horizontal inset — segments sit flush against each
  // other, matching native `UISegmentedControl`). Rendered BEHIND the
  // segment's own label `Text` (JSX order), `pointerEvents="none"`.
  segmentSelected: {
    position: 'absolute',
    top: TRACK_INSET,
    bottom: TRACK_INSET,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.segmentSelected,
    borderRadius: theme.radii.sm,
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
