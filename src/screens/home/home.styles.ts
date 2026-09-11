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
  // The FIRST day header drops the separator top pad: the content column's
  // `gap(4)` already sits between the pinned filter/sync band and the list, so
  // adding `sectionHeader`'s own top pad on top would make the gap above the
  // list unequal to the gap between the filters row and the sync-progress bar.
  firstSectionHeader: {
    paddingTop: 0,
  },
  // The large centered balance amount, one step up from `title` on the
  // `display` typography token — the net worth is the single most prominent
  // figure on this screen. MoneyText still owns the tone color, so this
  // deliberately omits `color`.
  balance: {
    ...theme.typography.display,
    textAlign: 'center',
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
