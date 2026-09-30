import { StyleSheet } from 'react-native-unistyles';
import { CHIP_GAP_STEP, CHIP_MIN_HEIGHT, CHIP_TAP_INSET } from '@kiko/design-system/chip-geometry';

// Seven columns, a month's shape as in the iOS Reminders "Monthly > Each" grid.
// Not `100 / 7`: Yoga resolves a percentage in 32-bit float and wraps a line
// when the running width is strictly greater than the row, so seven exact
// sevenths overshoot by a float ulp on common row widths (390pt, 414pt) and
// the grid falls to six columns. 14.28% leaves a sub-point slack that no float
// rounding closes.
const CELL_WIDTH = '14.28%';

// Grid neighbours sit too close for a chip's hitSlop to reach 44pt without
// overlapping the next chip's target, so the cell itself is the real 44pt box
// and ChipRow's compact chip is drawn inside it. The inset is the cell's
// padding rather than a fixed cell height, so a chip grown by a large text
// size keeps the same inset the grid's negative margin undoes. Across a row
// the two half-gaps add up to ChipRow's own chip gap, so the day chips sit as
// far apart as the weekday chips; down a column the 44pt target, not the
// gap, sets the spacing.
const CELL_HORIZONTAL_STEP = CHIP_GAP_STEP / 2;

export const styles = StyleSheet.create((theme) => ({
  // The negative margins pull the grid's footprint back to the visible chips,
  // so the caption and the outer chip edges line up with the other fields.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: -CHIP_TAP_INSET,
    marginHorizontal: -theme.spacing(CELL_HORIZONTAL_STEP),
  },
  cell: {
    width: CELL_WIDTH,
    paddingVertical: CHIP_TAP_INSET,
    paddingHorizontal: theme.spacing(CELL_HORIZONTAL_STEP),
  },
  chip: {
    minHeight: CHIP_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.sm,
  },
  chipSelected: {
    backgroundColor: theme.colors.accent,
  },
  chipUnselected: {
    backgroundColor: theme.colors.neutralSubtle,
  },
}));
