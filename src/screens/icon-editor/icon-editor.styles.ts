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
    // Pin the chip to the shared control height (the iOS 44pt minimum tap
    // target) so it lines up exactly with the name field beside it, which
    // carries the same `minHeight` — otherwise the 20pt glyph makes the chip a
    // hair taller than the text input and the two boxes read as misaligned.
    minHeight: theme.spacing(11),
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
