import { isChartRowShared, SHARED_ROW_MIN_PANE_WIDTH } from './chart-rows';

describe('isChartRowShared', () => {
  it('pins the shared-row width', () => {
    expect(SHARED_ROW_MIN_PANE_WIDTH).toBe(480);
  });

  it.each([
    ['half of an iPad mini portrait window', 371.5, false],
    ['one point below the shared-row width', 479, false],
    ['the shared-row width', 480, true],
    ['half of a 13-inch landscape window', 687.5, true],
    ['a wide pane', 688, true],
  ])('on a large window, %s (%d) shares the row: %s', (_name, paneWidth, expected) => {
    expect(isChartRowShared(true, paneWidth)).toBe(expected);
  });

  it.each([
    ['the shared-row width', 480],
    ['half of a split-view window', 515.5],
    ['a wide pane', 688],
    ['a narrow pane', 371.5],
  ])('never shares the row on a window that is not large, at %s (%d)', (_name, paneWidth) => {
    expect(isChartRowShared(false, paneWidth)).toBe(false);
  });

  it.each([true, false])('does not share the row without a pane width (large: %s)', (isLarge) => {
    expect(isChartRowShared(isLarge, null)).toBe(false);
  });
});
