import { StyleSheet } from 'react-native-unistyles';

// Seven columns, a month's shape as in the iOS Reminders "Monthly > Each" grid.
// Not `100 / 7`: Yoga resolves a percentage in 32-bit float and wraps a line
// when the running width is strictly greater than the row, so seven exact
// sevenths overshoot by a float ulp on common row widths (390pt, 414pt) and
// the grid falls to six columns. 14.28% leaves a sub-point slack that no float
// rounding closes.
const CELL_WIDTH = '14.28%';

// Grid neighbours sit too close for a chip's hitSlop to reach 44pt without
// overlapping the next chip's target, so the cell itself is the real 44pt box
// and the compact chip look (ChipRow's 34pt) is drawn inside it. The inset is
// the cell's padding rather than a fixed cell height, so a chip grown by a
// large text size keeps the same inset the grid's negative margin undoes.
const CELL_MIN_HEIGHT = 44;
const CHIP_MIN_HEIGHT = 34;
const CHIP_INSET = (CELL_MIN_HEIGHT - CHIP_MIN_HEIGHT) / 2;

export const styles = StyleSheet.create((theme) => ({
  // The negative margins pull the grid's footprint back to the visible chips,
  // so the caption and the outer chip edges line up with the other fields.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: -CHIP_INSET,
    marginHorizontal: -theme.spacing(0.5),
  },
  cell: {
    width: CELL_WIDTH,
    paddingVertical: CHIP_INSET,
    paddingHorizontal: theme.spacing(0.5),
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
