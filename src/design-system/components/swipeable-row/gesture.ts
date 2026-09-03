// Pure gesture arbitration and settle logic for SwipeableRow, extracted so
// the horizontal-vs-vertical decision and the snap resting state are unit
// testable in isolation from the native PanResponder.

// Horizontal travel to fully reveal the delete action, and the drag distance
// past which a release snaps open instead of closed.
export const ACTION_WIDTH = 88;
export const OPEN_THRESHOLD = ACTION_WIDTH / 2;

// The pan claims the gesture only after this much clear horizontal travel
// (the react-native-gesture-handler activeOffsetX([-n, n]) equivalent) ...
const ACTIVE_OFFSET_X = 12;
// ... and forfeits it to the enclosing scroll view the moment vertical travel
// crosses this (the failOffsetY([-m, m]) equivalent), so a vertical drag lets
// the list scroll and never partially opens the row.
const FAIL_OFFSET_Y = 12;

// activeOffsetX([-n, n]).failOffsetY([-m, m]) expressed as a pure predicate on
// the accumulated gesture translation:
//   - vertical intent (|dy| past FAIL_OFFSET_Y) => never claim (let it scroll)
//   - clear, dominant horizontal intent (|dx| past ACTIVE_OFFSET_X and larger
//     than |dy|) => claim the swipe
//   - anything still ambiguous => do not claim yet (lets a tap through)
export const shouldClaimSwipe = (dx: number, dy: number): boolean => {
  if (Math.abs(dy) > FAIL_OFFSET_Y) {
    return false;
  }
  return Math.abs(dx) > ACTIVE_OFFSET_X && Math.abs(dx) > Math.abs(dy);
};

// The row only travels left (to reveal a right-anchored action) and never past
// fully open; clamp the live translation while dragging.
export const clampTranslate = (offset: number, dx: number): number =>
  Math.min(0, Math.max(-ACTION_WIDTH, offset + dx));

// Once the card has slid left past this small threshold (or is fully open), its
// right edge and the delete button merge into a single straight seam: the
// card's right corners square off to meet the button's square left edge with no
// rounded gap between them.
export const MERGE_THRESHOLD = 8;

// Whether the card's right corners should square off to meet the delete button.
// Driven off the live translateX value (0 when closed, down to -ACTION_WIDTH
// when fully open); false at rest restores the card's normal right-corner
// radius once the row settles back closed.
export const shouldMergeEdge = (translateXValue: number): boolean =>
  translateXValue <= -MERGE_THRESHOLD;

// Settle: from wherever the gesture ended (release OR a termination stolen by
// the scroll view), resolve to a single stable resting state — fully open past
// the threshold, otherwise fully closed. Never a partial rest.
export const resolveSnap = (offset: number, dx: number): number =>
  offset + dx < -OPEN_THRESHOLD ? -ACTION_WIDTH : 0;
