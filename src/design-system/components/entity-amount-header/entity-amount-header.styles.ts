import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The "Balance"/"Value" label on one side, the optional icon slot on the
  // other, in their OWN row — sharing a row with just the label, rather than
  // the label+amount column below, is what pins the icon's vertical center to
  // the label's: `alignItems: 'center'` here only ever has these two items to
  // center against each other, so the icon lines up with the label's line
  // regardless of the icon's own size relative to it. `space-between` pins the
  // icon to the row's trailing edge — the label row stretches to the full
  // header width by default (its parent `Box` is an unstyled column, whose
  // default cross-axis `alignItems: 'stretch'` gives this row that width), so
  // the icon still lands at the header's trailing edge, opposite the label.
  labelRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // The account's/holding's primary number: larger than body so it reads as
  // the headline of the screen — the same title-scale treatment on both
  // "Balance" (account-detail) and "Value" (holding-detail). Only size/weight
  // live here — MoneyText still owns the tone color, so this omits `color`.
  amount: {
    fontSize: theme.typography.title.fontSize,
    fontWeight: theme.typography.title.fontWeight,
  },
  // Space between the label and the optional trailing icon, so the icon never
  // sits flush against a very long label. Harmless with `space-between` above
  // (which already keeps the two apart on the current fixed "Balance"/"Value"
  // labels) — a guard for a future longer label, not load-bearing today.
  iconSlot: {
    marginLeft: theme.spacing(3),
  },
}));
