import { type LayoutMode, MINIMUM_PANE_LENGTH, resolveLayoutMode } from '.';

const SMALLEST_LENGTH = 320;
const LARGEST_LENGTH = 1376;
const DIVIDER = 1;

const expectedRegularMode = (width: number, height: number): LayoutMode => {
  const isWide = width >= height;
  const splitLength = isWide ? width : height;

  if ((splitLength - DIVIDER) / 2 < MINIMUM_PANE_LENGTH) {
    return 'single';
  }

  return isWide ? 'columns' : 'rows';
};

const mismatchesAt = (width: number, height: number): string[] => {
  const found: string[] = [];
  const expected = expectedRegularMode(width, height);

  if (resolveLayoutMode('compact', width, height) !== 'single') {
    found.push(`compact ${width}x${height}`);
  }

  if (resolveLayoutMode('regular', width, height) !== expected) {
    found.push(`regular ${width}x${height} expected ${expected}`);
  }

  return found;
};

describe('resolveLayoutMode over every integer window', () => {
  // One `it` over ~2.2M windows: an `it.each` here would register that many tests.
  it('is single on compact, and splits a regular window exactly when two minimum panes fit', () => {
    const mismatches: string[] = [];

    expect(MINIMUM_PANE_LENGTH).toBe(360);

    for (let width = SMALLEST_LENGTH; width <= LARGEST_LENGTH; width += 1) {
      for (let height = SMALLEST_LENGTH; height <= LARGEST_LENGTH; height += 1) {
        mismatches.push(...mismatchesAt(width, height));
      }
    }

    expect(mismatches.slice(0, 10)).toEqual([]);
  });
});
