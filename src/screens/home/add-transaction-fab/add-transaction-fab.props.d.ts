export type AddTransactionFabProps = {
  // Fired on tap — Home wires this to `navigate('TransactionForm', {})`, the
  // empty-create entry that opens the shared form with no holding fixed.
  onPress: () => void;
  // The Home list's own bottom clearance (the floating tab-bar gap). The FAB
  // sits OUTSIDE the scroll content, so it lifts itself above this so it never
  // overlaps the tab bar.
  bottomOffset: number;
  // Extra clearance from the right edge when the native tab bar renders as a
  // right-edge sidebar instead of a bottom bar (see `isSidebarTabBarMode`) —
  // the sidebar's own width (the right safe-area inset), so the circle sits
  // clear of its chrome instead of underneath it. Defaults to `0`, leaving
  // today's fixed right anchor unchanged on an ordinary bottom-tab-bar
  // iPhone.
  rightOffset?: number;
};
