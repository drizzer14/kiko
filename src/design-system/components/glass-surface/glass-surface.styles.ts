import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(theme => ({
  // Shared by both the liquid-glass branch and the plain-View fallback so
  // children always clip to the surface's rounded corners.
  surface: {
    overflow: 'hidden',
  },
  // Only applied on the fallback branch (isLiquidGlassSupported === false),
  // where there is no native glass material to supply a background.
  fallback: {
    backgroundColor: theme.colors.surface,
  },
}));
