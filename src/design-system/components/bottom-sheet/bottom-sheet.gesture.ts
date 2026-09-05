// The pure decision + settle math behind the sheet's drag-down-to-close, kept
// free of any gesture object so it is unit-tested with plain numbers (the same
// split as `swipeable-row/gesture.ts`). The component wires these into a
// `Gesture.Pan()` as a thin adapter.

/** Fraction of the sheet's own height a downward drag must pass to dismiss on release. */
export const DISMISS_DISTANCE_RATIO = 0.25;

/**
 * Downward release velocity (points/second) that dismisses regardless of
 * distance — a flick. A quick toss of the sheet closes it even if the finger
 * did not travel a quarter of the way down.
 */
export const DISMISS_VELOCITY = 800;

/**
 * Clamp a raw pan translation to the sheet's allowed travel: downward only. An
 * upward drag (negative translation) is ignored so the sheet never rises above
 * its resting position.
 */
export const clampSheetTranslate = (translationY: number): number =>
  translationY > 0 ? translationY : 0;

/**
 * Whether a release should dismiss the sheet: the drag passed the distance
 * threshold (a fraction of the sheet's own measured height) OR the downward
 * flick velocity is high enough. A small or upward drag settles back to rest
 * instead.
 */
export const shouldDismissSheet = (
  translationY: number,
  velocityY: number,
  sheetHeight: number,
): boolean => translationY > sheetHeight * DISMISS_DISTANCE_RATIO || velocityY > DISMISS_VELOCITY;
