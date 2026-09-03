import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A leading-icon status line: keeps the SF Symbol vertically centered against
  // its adjacent status text (token result, last-sync time), and the sync
  // action beside its last-sync status.
  statusLine: {
    alignItems: 'center',
  },
  // The balance block sits directly under the large navigation title, so give
  // it breathing room at the top rather than crowding the heading against the
  // header — matching the roomier feel of the rest of the screen.
  balanceBlock: {
    paddingTop: theme.spacing(2),
  },
  // The account's primary number: larger than body so the total balance reads
  // as the headline of the screen. Only size/weight live here — MoneyText still
  // owns the tone color, so this deliberately omits `color`.
  balance: {
    fontSize: theme.typography.title.fontSize,
    fontWeight: theme.typography.title.fontWeight,
  },
  // Extra space above the per-currency breakdown so it reads as a distinct
  // block beneath the headline number rather than crowding right under it.
  breakdown: {
    marginTop: theme.spacing(3),
  },
  // A hairline rule separating the Balance / Synchronization / Holdings
  // sections, drawn in the theme's separator color. Vertical margin gives each
  // section room to breathe rather than crowding the rule against its neighbors.
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: theme.spacing(2),
    backgroundColor: theme.colors.border,
  },
  // The token field's column: grows to fill the row beside the trailing paste
  // icon button, so the shared TextField stretches to the available width.
  tokenFieldColumn: {
    flex: 1,
  },
  // The token-entry row: the field grows while its trailing paste icon button
  // aligns to the field's input row (the shared TextField sits below its caption
  // label), so the button lines up with the input rather than floating against
  // the taller captioned block.
  fieldRow: {
    alignItems: 'flex-end',
  },
  // A bare icon button (paste, edit) — padding gives a comfortable tap target
  // without the filled chrome of the shared Button.
  iconButton: {
    padding: theme.spacing(2),
  },
  // The link's touch target: hugs its text at the leading edge rather than
  // stretching across the column.
  linkPressable: {
    alignSelf: 'flex-start',
  },
  // A text link (opens the Monobank API page) — accent-colored body text with
  // no button chrome, the iOS link affordance.
  link: {
    color: theme.colors.accent,
    ...theme.typography.body,
  },
}));
