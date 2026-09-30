// The compact chip look shared by ChipRow's wrap-flow chips and
// DayOfMonthGrid's day chips, so the weekday row and the day-of-month grid
// on the reminder form draw the same chip at the same spacing (user request
// 2026-09-30). Its visible height sits below the HIG 44pt tap-target floor
// on purpose, mirroring Button's `small` size.
export const CHIP_MIN_HEIGHT = 34;

// A spacing-scale multiplier, not points: the gap between two chips.
export const CHIP_GAP_STEP = 2;

const MIN_TAP_TARGET = 44;

// How far a chip's tap target reaches past each of its top and bottom edges
// to meet 44pt.
export const CHIP_TAP_INSET = (MIN_TAP_TARGET - CHIP_MIN_HEIGHT) / 2;
