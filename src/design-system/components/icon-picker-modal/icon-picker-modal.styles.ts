import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The Remove/Cancel action row. The heading it used to share this row with
  // now renders through the shared BottomSheet's own `header` prop instead
  // (see `icon-picker-modal.component.tsx`) — task C2 will standardize this
  // into a shared footer; until then this stays a lone right-aligned row.
  actionsRow: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
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
