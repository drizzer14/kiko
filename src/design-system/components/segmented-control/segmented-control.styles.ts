import { StyleSheet } from 'react-native-unistyles';

// The REAL touch target: every
// segment `Pressable` is itself at least `SEGMENT_MIN_HEIGHT` (44pt) tall
// in real layout, with no `hitSlop`. The shorter, native-matching visible
// track (32pt) and selected pill (24pt, a 4pt ring of track around it) are
// absolutely-positioned decorative layers inset from that real box.
//
// The 44pt box must not add empty space above/below the 32pt visible
// track, so `container` pulls its own layout footprint back to the track
// with a negative `marginVertical` (`-TRACK_INSET`). The parent then lays
// the control out as 32pt, while the container's own frame stays 44pt and
// overflows its parent by `TRACK_INSET` at each edge. RN 0.87 Fabric keeps
// that overflow hit-testable: the parent's `overflowInset` is computed
// from its children's frames (`YogaLayoutableShadowNode::getContentBounds`
// + `calculateOverflowInset`), so it is non-zero, and
// `RCTViewComponentView betterHitTest` only drops an outside-bounds touch
// when `overflowInset` is zero (or the view clips). A parent with
// `overflow: 'hidden'` would clip the overflow band — do not wrap the
// control in one.
const SEGMENT_MIN_HEIGHT = 44;
// The visible track height, matching native `UISegmentedControl`.
const TRACK_HEIGHT = 32;
// How far the visible track insets from the 44pt real bounds, top and
// bottom (6pt). Also the container's negative vertical margin.
const TRACK_INSET = (SEGMENT_MIN_HEIGHT - TRACK_HEIGHT) / 2;

export const styles = StyleSheet.create((theme) => ({
  // The outer positioning context for the absolutely-positioned track
  // fill underneath the real, full-height segment row. The negative
  // margin cancels the 44pt box's extra height in the parent's layout, so
  // the control occupies only the visible 32pt track (see the header).
  container: {
    position: 'relative',
    marginVertical: -TRACK_INSET,
  },
  // The real, 44pt-tall row of segment `Pressable`s — see `segment` below.
  // `paddingHorizontal` reproduces the track's own `padding` (the gap
  // between the track's outer edge and its segments cluster) as REAL
  // layout, so every segment's actual touchable box matches its visible
  // position exactly — `hitSlop` extends touch BEYOND a view's real
  // bounds instead, which is not what this inset needs.
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
  // One segment: the REAL touch target, at least 44pt tall. `minHeight`
  // (not a fixed `height`) lets it grow with Dynamic Type at accessibility
  // text sizes; the track and pill are insets, so they grow with it.
  // `position: 'relative'` anchors the selected pill to ITS bounds.
  segment: {
    flex: 1,
    position: 'relative',
    minHeight: SEGMENT_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing(2),
  },
  // The selected segment's pill: inset `TRACK_INSET + spacing(1)` (10pt)
  // top/bottom from the segment's real bounds, so it sits 24pt tall inside
  // the 32pt track with a 4pt ring of track above and below it, like the
  // native thumb. It fills the segment's width edge to edge; the ring at
  // the outer ends comes from `row`'s `paddingHorizontal`. Rendered BEHIND
  // the label `Text` (JSX order), `pointerEvents="none"`.
  segmentSelected: {
    position: 'absolute',
    top: TRACK_INSET + theme.spacing(1),
    bottom: TRACK_INSET + theme.spacing(1),
    left: 0,
    right: 0,
    backgroundColor: theme.colors.segmentSelected,
    borderRadius: theme.radii.sm,
  },
  label: {
    textAlign: 'center',
  },
  // UIKit renders a segmented control's selected label semibold. Composed
  // ALONGSIDE `label` (never alone — never a duplicate `textAlign:
  // 'center'`), adding only the weight.
  selectedLabel: {
    fontWeight: '600',
  },
}));
