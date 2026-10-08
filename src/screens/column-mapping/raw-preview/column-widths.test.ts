import { computeColumnWidths } from './column-widths';

describe('computeColumnWidths', () => {
  it('returns one width per column, taken from the LONGEST cell seen in that column across every row', () => {
    const widths = computeColumnWidths([
      ['Date', 'Description', 'Amount'],
      ['01.07.2025', 'Coffee', -123.45],
      ['02.07.2025', 'A much longer description here', 5000],
    ]);

    expect(widths).toHaveLength(3);
    // Column 1 (description) is the widest across the three rows, so its
    // width must exceed column 0 (a short fixed-format date).
    expect(widths[1]).toBeGreaterThan(widths[0]);
  });

  it('clamps every width to a minimum, so a column of short/empty cells stays tappable', () => {
    const widths = computeColumnWidths([['', 'x']]);

    expect(widths[0]).toBeGreaterThanOrEqual(64);
  });

  it('clamps every width to a maximum, so one very long cell cannot blow out the whole grid', () => {
    const widths = computeColumnWidths([['a'.repeat(500)]]);

    expect(widths[0]).toBeLessThanOrEqual(220);
  });

  it('returns an empty array for no rows', () => {
    expect(computeColumnWidths([])).toEqual([]);
  });
});
