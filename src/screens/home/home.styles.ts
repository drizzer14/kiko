import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The scrollable content column: header + filter bar stay fixed height, the
  // FlatList below is the only flexed (and therefore scrollable) child.
  content: {
    flex: 1,
  },
  // Centered net-worth header block.
  header: {
    alignItems: 'center',
  },
  // Extra breathing room above the currency breakdown. The header's own
  // `gap={1}` already sits between the balance and the breakdown; this adds a
  // second `spacing(1)` on top so the visible gap there is ~2x the others,
  // separating the per-currency table from the headline figure.
  breakdown: {
    marginTop: theme.spacing(1),
    alignSelf: 'stretch',
  },
  // A date separator between day groups in the transaction SectionList.
  sectionHeader: {
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(1),
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
    paddingVertical: theme.spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // The primary line of a row: description on the left, amount on the right.
  rowMain: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // The leading cluster of a row: category icon + description, kept together on
  // the left so the row's space-between only splits this cluster from the amount.
  rowLead: {
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
