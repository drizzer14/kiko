import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The title on the left and the group's total opposite it, centered on each other, as the
  // Accounts section heading is laid out.
  row: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // Tile and title, centered on each other. It takes the width the total leaves, so a long
  // category title wraps instead of pushing the total off the screen.
  lead: {
    alignItems: 'center',
    flex: 1,
    marginRight: theme.spacing(3),
  },
  // A `Text` does not shrink in a row, so its own box lets a long title wrap.
  title: {
    flex: 1,
  },
  total: {
    flexShrink: 0,
  },
}));
