import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Row + wrap turns the pill list into a grid. The negative margin cancels
  // each cell's own gutter padding below so the grid's outer edge stays flush
  // while the gaps between cells still read as the theme's spacing(2) gap.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    margin: -theme.spacing(1),
  },
  // Each pill's 50%-wide slot — always 2 columns, however many currencies
  // exist, since two cells fill a row before the third wraps.
  cell: {
    width: '50%',
    padding: theme.spacing(1),
  },
  // A compact segmented pill. Only the shape lives here; the selected/unselected
  // fill is a runtime theme color layered on at the call site (see the
  // component), so the transparent-unselected rationale stays next to its use.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(2),
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
