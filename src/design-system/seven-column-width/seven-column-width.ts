// The cell width of a seven-column wrapping grid (the colour picker, the day-of-month grid).
// Not `100 / 7`: Yoga resolves a percentage in 32-bit float and wraps a line when the running
// width is strictly greater than the row, so seven exact sevenths overshoot by a float ulp on
// common row widths (390 pt, 414 pt) and the grid falls to six columns. 14.28% leaves a sub-point
// slack that no float rounding closes.
export const SEVEN_COLUMN_WIDTH = '14.28%';
