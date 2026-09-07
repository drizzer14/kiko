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
  // clearly larger `spacing(4)` on top so the per-currency table reads as a
  // distinct block well separated from the headline net-worth figure.
  breakdown: {
    marginTop: theme.spacing(4),
    alignSelf: 'stretch',
  },
  // Extra breathing room above the filter row. With the divider now grouped
  // just above it, this `spacing(4)` sits between the hairline rule and the
  // filters (mirroring the content column's `gap(4)` above the divider) so the
  // rule splits the net-worth/filters band evenly instead of doubling the gap.
  filterBar: {
    marginTop: theme.spacing(4),
  },
  // A hairline rule between the net-worth block and the filter row, drawn in
  // the theme's separator color to match the dividers used elsewhere (e.g.
  // account-detail). It carries no vertical margin of its own: the content
  // column's `gap(4)` sits above it (net-worth card → divider) and the filter
  // row's own `marginTop(4)` sits below it (divider → filters).
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  // A date separator between day groups in the transaction SectionList. A
  // generous top pad gives each date label clear separation above it.
  sectionHeader: {
    paddingTop: theme.spacing(5),
    paddingBottom: theme.spacing(1),
  },
  // The large centered balance amount, one step up from `title` on the
  // `display` typography token — the net worth is the single most prominent
  // figure on this screen. MoneyText still owns the tone color, so this
  // deliberately omits `color`.
  balance: {
    ...theme.typography.display,
    textAlign: 'center',
  },
  // A single transaction row: description + amount on one line, context below.
  row: {
    paddingVertical: theme.spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // The primary line of a row: description on the left, amount on the right.
  // Top-aligned so the icon and amount stay anchored to the top of the row and
  // hold their place as a long title wraps and grows downward.
  rowMain: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  // The leading cluster of a row: category icon + description, kept together on
  // the left so the row's space-between only splits this cluster from the
  // amount. `flex: 1` bounds it to the space left of the amount, and the right
  // margin keeps a long, wrapping description clear of the amount column. Top-
  // aligned so the icon sticks to the first line of a wrapping title.
  rowLead: {
    alignItems: 'flex-start',
    flex: 1,
    marginRight: theme.spacing(3),
  },
  // The description cell inside the lead cluster: `flex: 1` lets a long title
  // wrap onto multiple lines within the bounded lead column instead of pushing
  // the amount off-screen.
  rowDescription: {
    flex: 1,
  },
  // The trailing amount cell: never shrinks, so the amount stays fully visible
  // no matter how long the description grows.
  rowAmount: {
    flexShrink: 0,
  },
  // The row's secondary line: the account · category meta on the left, the
  // transaction time pinned to the bottom-right. `flex-end` keeps the time on
  // the last baseline even if the meta caption wraps onto a second line.
  rowFooter: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  // The meta caption cell: `flex: 1` bounds it to the space left of the time so
  // a long account · category label wraps within it instead of pushing the time
  // off the row.
  rowFooterMeta: {
    flex: 1,
  },
  // Bounds the FlatList to the remaining space below the fixed header/filter
  // bar so it scrolls instead of growing to content height.
  list: {
    flex: 1,
  },
  // `flexGrow` (not `flex`) on the content container: rows still stack from
  // the top and the container scrolls once its content overflows, but an
  // empty/short list still grows to fill the viewport so `empty` can center.
  // Bottom padding is lifted clear of the floating native glass tab bar by
  // `bottomClearance` — the bar's measured height MINUS the bottom safe-area
  // inset, computed at the call site through `resolveBottomClearance`
  // (design-system/components/screen/bottom-clearance.ts). The inset is
  // subtracted, not added: Screen's `SafeAreaView` already reserves it around
  // this content, so including it here would count it twice.
  listContent: (bottomClearance: number) => ({
    flexGrow: 1,
    paddingBottom: bottomClearance,
  }),
  // Empty-state container: fills the list viewport and centers its Text.
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
