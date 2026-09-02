import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(theme => ({
  // A single full-width category row within the GlassSurface list. Mirrors the
  // SettingsRow row/divider shape (see settings.styles.ts) so the two lists
  // read as one design language.
  row: {
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // The last row in the list has no divider beneath it.
  rowLast: {
    borderBottomWidth: 0,
  },
  // The row's header line: the leading icon-picker toggle sits next to the
  // editable title field, both vertically centered.
  header: {
    alignItems: 'center',
  },
  // The leading icon presented as a bordered, rounded chip so it reads as a
  // tappable control — mirroring the bordered rename field beside it (see
  // `input`) so both edit affordances share one visual language. `relative`
  // anchors the absolutely-positioned edit badge to this chip's corner.
  iconChip: {
    position: 'relative',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A small accent "pencil" badge peeking over the chip's lower-right corner:
  // an unmistakable cue that tapping the icon opens the picker.
  editBadge: {
    position: 'absolute',
    right: -theme.spacing(1),
    bottom: -theme.spacing(1),
    padding: theme.spacing(1),
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The rename field grows to fill the row width beside the fixed icon toggle.
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(2),
    ...theme.typography.body,
  },
  // The curated icon picker: a wrapping grid of equal, tappable swatches
  // revealed beneath the row when its icon toggle is pressed.
  iconGrid: {
    flexWrap: 'wrap',
  },
  // One curated icon swatch — a fixed-size, centered, tappable tile.
  iconOption: {
    width: theme.spacing(11),
    height: theme.spacing(11),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.sm,
  },
}));
