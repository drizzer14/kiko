import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((_theme) => ({
  // Vertically centers the category glyph against the sheet's heading, so the
  // colored icon reads on the same baseline as "Apply Category to All".
  confirmHeader: {
    alignItems: 'center',
  },
}));
