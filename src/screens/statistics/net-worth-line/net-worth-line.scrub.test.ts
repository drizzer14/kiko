import type { NetWorthPoint } from '@kiko/statistics/net-worth-series';

import {
  nearestPointIndex,
  placeScrubLabel,
  resolveScrubIndex,
  SCRUB_ACTIVE_OFFSET_X,
  SCRUB_FAIL_OFFSET_Y,
  scrubRangeKey,
  stepScrubIndex,
  toLogicalX,
} from './net-worth-line.scrub';

const series = (times: number[], amounts?: number[]): NetWorthPoint[] =>
  times.map((t, index) => ({ t, amount: amounts?.[index] ?? 100 + index }));

describe('scrub constants', () => {
  it('activates after 10 points of horizontal travel and fails after 10 vertical', () => {
    expect(SCRUB_ACTIVE_OFFSET_X).toBe(10);
    expect(SCRUB_FAIL_OFFSET_Y).toBe(10);
  });
});

describe('toLogicalX', () => {
  it.each([
    [0, 240, 320, 0],
    [240, 240, 320, 320],
    [120, 240, 320, 160],
    [-30, 240, 320, -40],
    [300, 240, 320, 400],
  ])(
    'maps touch %p on a %p wide plot to %p logical units',
    (touchX, plotWidth, viewWidth, want) => {
      expect(toLogicalX(touchX, plotWidth, viewWidth)).toBe(want);
    },
  );

  it.each([
    [10, 0],
    [10, -1],
  ])('returns null for touch %p when the plot width is %p (not measured)', (touchX, plotWidth) => {
    expect(toLogicalX(touchX, plotWidth, 320)).toBeNull();
  });
});

describe('nearestPointIndex', () => {
  const xs = [8, 160, 312];

  it.each([
    [-100, 0],
    [8, 0],
    [83.9999, 0],
    [84, 0],
    [84.0001, 1],
    [160, 1],
    [235.9999, 1],
    [236, 1],
    [236.0001, 2],
    [312, 2],
    [999, 2],
  ])('snaps x = %p to index %p (an exact tie goes to the earlier point)', (x, want) => {
    expect(nearestPointIndex(xs, x)).toBe(want);
  });

  it('returns 0 for a one-point series wherever the touch is', () => {
    expect(nearestPointIndex([8], -50)).toBe(0);
    expect(nearestPointIndex([8], 8)).toBe(0);
    expect(nearestPointIndex([8], 5000)).toBe(0);
  });

  it('returns the first of duplicate xs', () => {
    expect(nearestPointIndex([8, 8, 312], 8)).toBe(0);
  });
});

describe('placeScrubLabel', () => {
  const place = (lineX: number, labelWidth = 80, plotWidth = 240) =>
    placeScrubLabel(lineX, labelWidth, plotWidth, 6);

  it('puts the label right of a line at the left edge', () => {
    expect(place(0)).toBe(6);
  });

  it('keeps the right side while the label exactly fits (154 + 6 + 80 = 240)', () => {
    expect(place(154)).toBe(160);
  });

  it('flips left one pixel past the exact fit', () => {
    expect(place(155)).toBe(69);
  });

  it('defaults to the right side when both sides fit', () => {
    expect(place(86)).toBe(92);
  });

  it('flips left for a line at the right edge', () => {
    expect(place(240)).toBe(154);
  });

  it('clamps and centres when neither side fits, inside the plot', () => {
    expect(place(50, 80, 100)).toBe(10);
  });

  it('clamps to 0 when the label is wider than the plot', () => {
    expect(place(50, 120, 100)).toBe(0);
  });

  it('keeps the left side when the label sits exactly flush with the plot start', () => {
    expect(place(86, 80, 100)).toBe(0);
  });

  it('clamps against the plot end when neither side fits and the centre overshoots', () => {
    expect(place(80, 80, 100)).toBe(20);
  });

  it('never leaves a 100-wide plot for any line position', () => {
    for (let lineX = 0; lineX <= 100; lineX += 1) {
      const left = place(lineX, 80, 100);

      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + 80).toBeLessThanOrEqual(100);
    }
  });

  it('never leaves the plot for any line position', () => {
    for (let lineX = 0; lineX <= 240; lineX += 1) {
      const left = place(lineX);

      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + 80).toBeLessThanOrEqual(240);
    }
  });
});

describe('scrubRangeKey', () => {
  const base = series([10, 20, 30, 40]);

  it('is equal when only the amounts change (a live update)', () => {
    expect(scrubRangeKey(series([10, 20, 30, 40], [1, 2, 3, 4]))).toBe(scrubRangeKey(base));
  });

  it('differs when the first t changes', () => {
    expect(scrubRangeKey(series([11, 20, 30, 40]))).not.toBe(scrubRangeKey(base));
  });

  it('differs when the last t changes', () => {
    expect(scrubRangeKey(series([10, 20, 30, 41]))).not.toBe(scrubRangeKey(base));
  });

  it('differs when the count changes with the same ends', () => {
    expect(scrubRangeKey(series([10, 20, 25, 30, 40]))).not.toBe(scrubRangeKey(base));
  });

  it('does not collide a first t of 1 and last t of 23 with first 12 and last 3', () => {
    expect(scrubRangeKey(series([1, 23]))).not.toBe(scrubRangeKey(series([12, 3])));
  });
});

describe('resolveScrubIndex', () => {
  const points = series([10, 20, 30, 40]);
  const rangeKey = scrubRangeKey(points);

  it('defaults to the present day when nothing is selected', () => {
    expect(resolveScrubIndex(null, points)).toBe(3);
  });

  it('keeps the selected index while the range key matches', () => {
    expect(resolveScrubIndex({ rangeKey, index: 2 }, points)).toBe(2);
  });

  it('goes back to the present day when the range key is stale', () => {
    expect(resolveScrubIndex({ rangeKey: 'stale', index: 1 }, points)).toBe(3);
  });

  it('resolves a one-point series to 0', () => {
    expect(resolveScrubIndex(null, series([10]))).toBe(0);
  });
});

describe('stepScrubIndex', () => {
  it.each([
    [0, -1, 4, 0],
    [3, 1, 4, 3],
    [1, 1, 4, 2],
    [2, -1, 4, 1],
    [0, 1, 1, 0],
  ] as const)('steps index %p by %p of %p points to %p', (index, delta, count, want) => {
    expect(stepScrubIndex(index, delta, count)).toBe(want);
  });
});
