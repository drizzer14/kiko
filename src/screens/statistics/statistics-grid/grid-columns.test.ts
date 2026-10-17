import {
  type GridColumns,
  resolveGridColumns,
  THREE_COLUMN_MIN_WIDTH,
  toGridRows,
  TWO_COLUMN_MIN_WIDTH,
} from './grid-columns';

describe('resolveGridColumns', () => {
  it('pins the two thresholds', () => {
    expect(TWO_COLUMN_MIN_WIDTH).toBe(700);
    expect(THREE_COLUMN_MIN_WIDTH).toBe(1000);
  });

  // Every Duo width stays one column: the grid must never change a Duo screen.
  it.each([
    ['the Duo outer window', 466],
    ['a Duo companion pane', 475],
    ['a Duo pane with a half-point share', 455.5],
    ['a Duo inner-window pane', 669],
    ['an iPhone window', 390],
  ])('keeps %s at one column', (_name, width) => {
    expect(resolveGridColumns(width)).toBe(1);
  });

  it.each<[string, number, GridColumns]>([
    ['one point below the two-column width', 699, 1],
    ['the two-column width', 700, 2],
    ['one point below the three-column width', 999, 2],
    ['the three-column width', 1000, 3],
    ['an iPad wide-share pane', 910, 2],
    ['an iPad equal-share pane', 744, 2],
    ['a 13-inch iPad window', 1032, 3],
  ])('resolves %s (%d)', (_name, width, expected) => {
    expect(resolveGridColumns(width)).toBe(expected);
  });
});

describe('toGridRows', () => {
  it('fills two full rows for four items in two columns', () => {
    expect(toGridRows(['a', 'b', 'c', 'd'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('pads a short last row with spacers', () => {
    expect(toGridRows(['a', 'b', 'c', 'd'], 3)).toEqual([
      ['a', 'b', 'c'],
      ['d', null, null],
    ]);
  });

  it('puts every item in its own row at one column', () => {
    expect(toGridRows(['a', 'b'], 1)).toEqual([['a'], ['b']]);
  });

  it('returns no rows for no items', () => {
    expect(toGridRows([], 2)).toEqual([]);
  });
});
