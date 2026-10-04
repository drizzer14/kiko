import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Tile and name, centered on each other as the Settings > Reminders account
  // heading does. It takes the width the section total leaves, as the account
  // card's lead cluster does, so a long name wraps instead of pushing the
  // total off the screen.
  heading: {
    alignItems: 'center',
    flex: 1,
    marginRight: theme.spacing(3),
  },
  // A `Text` does not shrink in a row, so its own box lets a long name wrap.
  name: {
    flex: 1,
  },
}));
