import { isChartRowShared, SHARED_ROW_MIN_PANE_WIDTH } from './chart-rows';

// One spacing unit is 4 pt. The legend widths come from pie-chart.styles.ts: legendValue
// `spacing(28)` (line 43), legendPercent `spacing(11)` (line 48), the legendRow column gap
// `spacing(2)` (line 23), swatch `spacing(3)` (line 55) and the legendName gap `spacing(2)`
// (line 31). The 200 pt donut (pie-chart.component.tsx:46) is narrower than the legend row, so the
// legend row sets the card width.
const SPACING_UNIT = 4;
const LEGEND_VALUE_WIDTH = 28 * SPACING_UNIT;
const LEGEND_PERCENT_WIDTH = 11 * SPACING_UNIT;
const LEGEND_COLUMN_GAPS = 2 * (2 * SPACING_UNIT);
const LEGEND_SWATCH_AND_GAP = 3 * SPACING_UNIT + 2 * SPACING_UNIT;
const LEGEND_FIXED_WIDTH =
  LEGEND_VALUE_WIDTH + LEGEND_PERCENT_WIDTH + LEGEND_COLUMN_GAPS + LEGEND_SWATCH_AND_GAP;
const NAME_LABEL_WIDTH = 80;
const CARD_PADDING = 32;
const SCREEN_PADDING = 32;
const ROW_GAP = 16;
// The row holds two cards, so the pane carries two card widths, the row gap and the screen padding.
const DERIVED_MIN_PANE_WIDTH =
  2 * (LEGEND_FIXED_WIDTH + NAME_LABEL_WIDTH + CARD_PADDING) + SCREEN_PADDING + ROW_GAP;

describe('isChartRowShared', () => {
  it('derives the shared-row width from the pie legend so a name keeps its room', () => {
    expect(LEGEND_FIXED_WIDTH).toBe(192);
    expect(DERIVED_MIN_PANE_WIDTH).toBe(656);
    expect(SHARED_ROW_MIN_PANE_WIDTH).toBe(DERIVED_MIN_PANE_WIDTH);
  });

  it.each([
    ['half of an iPad mini portrait window', 371.5, false],
    ['a pane that fits the columns but not a name', 480, false],
    ['half of a split-view window', 515.5, false],
    ['a pane under the shared-row width', 597, false],
    ['one point below the shared-row width', 655, false],
    ['the shared-row width', 656, true],
    ['half of a 13-inch landscape window', 687.5, true],
    ['a wide pane', 688, true],
  ])('on a large window, %s (%d) shares the row: %s', (_name, paneWidth, expected) => {
    expect(isChartRowShared(true, paneWidth)).toBe(expected);
  });

  it.each([
    ['the shared-row width', 656],
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
