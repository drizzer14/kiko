import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(theme => ({
  // Centered net-worth header block.
  header: {
    alignItems: 'center',
  },
  // The large centered balance amount. Only size/weight/alignment live here —
  // MoneyText still owns the tone color, so this deliberately omits `color`.
  balance: {
    fontSize: 40,
    fontWeight: '700',
    textAlign: 'center',
  },
  // A single transaction row: description + amount on one line, context below.
  row: {
    paddingVertical: theme.spacing(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // The primary line of a row: description on the left, amount on the right.
  rowMain: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
}));
