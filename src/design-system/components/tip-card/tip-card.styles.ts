import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
  },
  // The message takes the row's free width so a long translation wraps beside
  // the close button instead of pushing it off the card.
  message: {
    flex: 1,
  },
}));
