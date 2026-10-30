import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Opaque black, the colour the translucent tonal tint composites over on the screen's
  // `background`, so the solid button reads as the tonal button does on a plain screen.
  solid: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radii.md,
  },
  tint: (color: string) => ({
    backgroundColor: color,
    borderRadius: theme.radii.md,
  }),
}));
