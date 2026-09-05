import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Fills the window with the theme background so nothing behind it (and no
  // white flash) can show while the gate is deciding or locked.
  fill: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    textAlign: 'center',
  },
}));
