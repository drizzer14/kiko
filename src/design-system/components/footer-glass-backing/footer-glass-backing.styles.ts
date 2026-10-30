import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The capsule mask: the Button's Pressable draws no fill and does not clip, so the layer rounds
  // its own corners.
  layer: {
    borderRadius: theme.radii.full,
    overflow: 'hidden',
  },
  tone: (color: string) => ({
    backgroundColor: color,
  }),
}));
