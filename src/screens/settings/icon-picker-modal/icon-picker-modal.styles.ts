import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Fills the screen and pins the sheet to the bottom, iOS bottom-sheet style.
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // A dimmed, tappable scrim behind the sheet. Using the true-black background
  // token at reduced opacity keeps the dim on-theme without a raw color
  // literal. It fills the whole overlay; the opaque sheet renders on top of
  // it, so only the exposed area above the sheet reads a tap.
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.background,
    opacity: 0.5,
  },
  // The raised card holding the picker. Rounded only along its top edge so it
  // reads as a sheet sliding up from the bottom. This Modal renders outside
  // any SafeAreaView, so its own bottom padding must add the bottom safe-area
  // inset (the home indicator's zone) itself, or the sheet sits flush against
  // it — `bottomInset` is `useSafeAreaInsets().bottom` from the call site.
  sheet: (bottomInset: number) => ({
    maxHeight: '80%',
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: theme.spacing(6) + bottomInset,
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
  }),
  // The sheet's title line: heading on the left, cancel control on the right.
  header: {
    alignItems: 'center',
    justifyContent: 'space-between',
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
