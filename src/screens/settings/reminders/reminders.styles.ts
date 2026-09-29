import { StyleSheet } from 'react-native-unistyles';

// Centered like the Accounts and Home empty lists.
export const styles = StyleSheet.create(() => ({
  empty: {
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
  },
  // Centered on the tile, as the account card centers its name beside it.
  accountHeading: {
    alignItems: 'center',
  },
  // A `Text` does not shrink in a row, so its own box lets a long name wrap.
  accountName: {
    flex: 1,
  },
}));
