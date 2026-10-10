import { StyleSheet } from 'react-native-unistyles';

// Seven columns, so the 14 swatches are two whole rows at every form width from about 280pt up.
// Not `100 / 7`: Yoga resolves a percentage in 32-bit float and wraps a line when the running
// width is strictly greater than the row, so seven exact sevenths overshoot by a float ulp on
// common row widths and the row falls to six. 14.28% leaves a sub-point slack that no float
// rounding closes (the day-of-month grid's `CELL_WIDTH` is the same constant for the same reason).
const CELL_WIDTH = '14.28%';

export const styles = StyleSheet.create((theme) => ({
  // Fixed columns wrap into rows; only the row gap is set, since the cells share the row evenly.
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: theme.spacing(2),
  },
  // The tappable cell: it takes one column and centres the ring in it.
  swatchCell: {
    width: CELL_WIDTH,
    alignItems: 'center',
  },
  // The ring around each swatch. A constant-width border keeps every
  // swatch the same size whether or not it is selected (a transparent ring when
  // unselected, a visible one when selected — set inline from the theme), so the
  // selection never shifts the row's layout.
  swatchRing: {
    padding: theme.spacing(1),
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The color disc itself. Its `backgroundColor` is the entity-color hex, set
  // inline (a runtime value, not a static token).
  swatch: {
    width: theme.spacing(7),
    height: theme.spacing(7),
    borderRadius: 999,
  },
}));
