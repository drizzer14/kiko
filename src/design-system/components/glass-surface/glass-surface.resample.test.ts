import {
  isPositionSettled,
  MAX_SETTLE_ATTEMPTS,
  shouldStopResampling,
} from './glass-surface.resample';

describe('isPositionSettled', () => {
  it('reports not settled on the first read, with no previous position yet', () => {
    expect(isPositionSettled(undefined, { x: 0, y: 0 })).toBe(false);
  });

  it('reports settled when two consecutive reads land at the identical position', () => {
    expect(isPositionSettled({ x: 12, y: 340 }, { x: 12, y: 340 })).toBe(true);
  });

  it('reports not settled when the position moved on the x axis', () => {
    expect(isPositionSettled({ x: 12, y: 340 }, { x: 13, y: 340 })).toBe(false);
  });

  it('reports not settled when the position moved on the y axis', () => {
    // The confirmed, on-device shape of the bug: a `Sortable.Grid` card's
    // position transform is a vertical (y-axis) settle over several frames.
    expect(isPositionSettled({ x: 12, y: 340 }, { x: 12, y: 355 })).toBe(false);
  });
});

describe('shouldStopResampling', () => {
  it('does not stop while unsettled and under the attempt cap', () => {
    expect(shouldStopResampling(1, false)).toBe(false);
    expect(shouldStopResampling(MAX_SETTLE_ATTEMPTS - 1, false)).toBe(false);
  });

  it('stops the moment the position is settled, however early', () => {
    expect(shouldStopResampling(2, true)).toBe(true);
  });

  it('stops once the attempt cap is reached even if never settled', () => {
    // The bounded-loop guarantee: a card whose transform never reports two
    // identical consecutive reads (e.g. it is still animating) must not spin
    // forever — it remounts anyway once the cap is hit.
    expect(shouldStopResampling(MAX_SETTLE_ATTEMPTS, false)).toBe(true);
    expect(shouldStopResampling(MAX_SETTLE_ATTEMPTS + 1, false)).toBe(true);
  });
});
