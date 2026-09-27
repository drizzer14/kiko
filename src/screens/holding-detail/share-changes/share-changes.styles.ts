import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // The day on the left, the share on the right, the same split as a ledger row.
  row: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
}));
