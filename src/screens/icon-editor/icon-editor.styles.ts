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
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
