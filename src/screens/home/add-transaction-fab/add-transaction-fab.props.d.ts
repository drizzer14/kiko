export type AddTransactionFabProps = {
  // Fired on tap — Home wires this to `navigate('TransactionForm', {})`, the
  // empty-create entry that opens the shared form with no holding fixed.
  onPress: () => void;
  // The FAB's bottom edge inside Home's box. Home computes it once and gives the list its
  // end space from the same number, so the button and the last row cannot drift apart.
  bottom: number;
};
