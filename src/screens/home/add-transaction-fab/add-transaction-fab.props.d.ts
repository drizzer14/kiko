export type AddTransactionFabProps = {
  // Fired on tap — Home wires this to `navigate('TransactionForm', {})`, the
  // empty-create entry that opens the shared form with no holding fixed.
  onPress: () => void;
  // The Home list's own bottom clearance (the floating tab-bar gap). The FAB
  // sits OUTSIDE the scroll content, so it lifts itself above this so it never
  // overlaps the tab bar.
  bottomOffset: number;
};
