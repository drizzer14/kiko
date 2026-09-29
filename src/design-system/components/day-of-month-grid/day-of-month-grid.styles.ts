import { StyleSheet } from 'react-native-unistyles';

// A month's shape, as in the iOS calendar and the Reminders "Monthly > Each"
// day grid.
const COLUMN_COUNT = 7;

// Grid neighbours sit too close for a chip's hitSlop to reach 44pt without
// overlapping the next chip's target, so the cell itself is the real 44pt box
// and the compact chip look (ChipRow's 34pt) is drawn inside it.
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
    width: `${100 / COLUMN_COUNT}%` as const,
    minHeight: CELL_MIN_HEIGHT,
    justifyContent: 'center',
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
