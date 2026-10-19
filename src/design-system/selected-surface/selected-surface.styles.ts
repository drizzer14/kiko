import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The one selection look, the filled-accent vocabulary of `ChipRow` and the trend-filter rows
  // (kiko-design-system, "The `onAccent` rule"). The border takes the fill's colour as well, so a
  // bordered surface keeps its border width and the content inside does not shift.
  fill: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
}));
