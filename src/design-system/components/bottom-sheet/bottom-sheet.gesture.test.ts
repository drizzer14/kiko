import {
  clampSheetTranslate,
  DISMISS_DISTANCE_RATIO,
  DISMISS_VELOCITY,
  shouldDismissSheet,
} from './bottom-sheet.gesture';

describe('clampSheetTranslate', () => {
  it('passes a downward (positive) translation through unchanged', () => {
    expect(clampSheetTranslate(120)).toBe(120);
  });

  it('clamps an upward (negative) translation to 0 — the sheet never rises above rest', () => {
    expect(clampSheetTranslate(-40)).toBe(0);
  });

  it('rests at 0 for a zero translation', () => {
    expect(clampSheetTranslate(0)).toBe(0);
  });
});

describe('shouldDismissSheet', () => {
  const HEIGHT = 400;
  const THRESHOLD = HEIGHT * DISMISS_DISTANCE_RATIO; // 100

  it('dismisses when the drag passes the distance threshold at rest velocity', () => {
    expect(shouldDismissSheet(THRESHOLD + 1, 0, HEIGHT)).toBe(true);
  });

  it('does not dismiss a small drag below the threshold at rest velocity', () => {
    expect(shouldDismissSheet(THRESHOLD - 1, 0, HEIGHT)).toBe(false);
  });

  it('dismisses on a fast downward flick even below the distance threshold', () => {
    expect(shouldDismissSheet(10, DISMISS_VELOCITY + 1, HEIGHT)).toBe(true);
  });

  it('does not dismiss a slow drag below both the distance and velocity thresholds', () => {
    expect(shouldDismissSheet(10, DISMISS_VELOCITY - 1, HEIGHT)).toBe(false);
  });

  it('does not dismiss an upward drag (negative translation and velocity)', () => {
    expect(shouldDismissSheet(-200, -1200, HEIGHT)).toBe(false);
  });
});
