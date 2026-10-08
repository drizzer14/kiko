import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The same rounded surfaceHigh block as the transaction form's read-only
  // notice, so every inline explanatory notice reads as one family.
  banner: {
    borderRadius: theme.radii.sm,
  },
}));
