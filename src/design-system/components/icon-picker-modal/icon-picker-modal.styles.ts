import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The grid scrolls within the sheet's capped height rather than growing it.
  scroll: {
    flexShrink: 1,
  },
  // The wrapping grid of equal, tappable icon swatches.
  grid: {
    flexWrap: 'wrap',
  },
  // One curated icon swatch — a fixed-size, centered, tappable tile.
  option: {
    width: theme.spacing(11),
    height: theme.spacing(11),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.sm,
  },
}));
