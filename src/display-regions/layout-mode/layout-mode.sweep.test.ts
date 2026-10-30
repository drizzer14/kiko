import { type LayoutMode, MINIMUM_PANE_LENGTH, resolveLayoutMode } from '.';

const SMALLEST_LENGTH = 320;
const LARGEST_LENGTH = 1376;
const DIVIDER = 1;
// A rule broken everywhere would otherwise collect a million strings.
const MISMATCHES_REPORTED = 10;

const expectedRegularMode = (width: number): LayoutMode => {
  const splitLength = 2 * MINIMUM_PANE_LENGTH + DIVIDER;

  return width >= splitLength ? 'columns' : 'single';
};

const mismatchesAt = (width: number, height: number): string[] => {
  const found: string[] = [];
  const expected = expectedRegularMode(width);

  if (resolveLayoutMode('compact', width, height) !== 'single') {
    found.push(`compact ${width}x${height}`);
  }

  if (resolveLayoutMode('regular', width, height) !== expected) {
    found.push(`regular ${width}x${height} expected ${expected}`);
  }

  return found;
};

describe('resolveLayoutMode over every integer window', () => {
  // One `it` over 1,117,249 windows, each in both size classes: an `it.each` here would register
  // that many tests.
  it('is single on compact, and splits a regular window exactly when two minimum panes fit', () => {
    const mismatches: string[] = [];

    expect(MINIMUM_PANE_LENGTH).toBe(360);

    for (let width = SMALLEST_LENGTH; width <= LARGEST_LENGTH; width += 1) {
      for (let height = SMALLEST_LENGTH; height <= LARGEST_LENGTH; height += 1) {
        if (mismatches.length < MISMATCHES_REPORTED) {
          mismatches.push(...mismatchesAt(width, height));
        }
      }
    }

    expect(mismatches.slice(0, MISMATCHES_REPORTED)).toEqual([]);
  });
});
