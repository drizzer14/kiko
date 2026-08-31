import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(theme => ({
  // The scrollable content column: header + filter bar stay fixed height, the
  // FlatList below is the only flexed (and therefore scrollable) child.
  content: {
    flex: 1,
  },
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
  // Bounds the FlatList to the remaining space below the fixed header/filter
  // bar so it scrolls instead of growing to content height.
  list: {
    flex: 1,
  },
  // `flexGrow` (not `flex`) on the content container: rows still stack from
  // the top and the container scrolls once its content overflows, but an
  // empty/short list still grows to fill the viewport so `empty` can center.
  listContent: {
    flexGrow: 1,
  },
  // Empty-state container: fills the list viewport and centers its Text.
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
