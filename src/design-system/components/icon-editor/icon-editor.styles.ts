import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The leading icon presented as a bordered, rounded chip so it reads as a
  // tappable control — mirroring the categories row's icon affordance so the
  // two lists share one visual language. The border is the affordance; there is
  // no overlaid pencil badge.
  iconChip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(2),
    // A fixed square pinned to the shared control height (the iOS 44pt minimum
    // tap target): explicit, equal `width` and `height` rather than a
    // `minHeight` floor plus `aspectRatio`. The old aspectRatio resolved the
    // chip's square from its measured cross-size, which — beside a name field
    // held only by `minHeight`, under the row's `alignItems: 'flex-end'` — made
    // both sizes measurement-dependent: a re-render (typing, a type/color
    // change) could re-resolve the chip smaller, dropping the row height and
    // collapsing the name field toward its single-line intrinsic height. A
    // definite width === height decouples the chip from every layout pass, so it
    // and the name field stay a stable 44pt tall.
    width: theme.spacing(11),
    height: theme.spacing(11),
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
