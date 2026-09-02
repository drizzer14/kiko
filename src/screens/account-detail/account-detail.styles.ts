import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A leading-icon status line: keeps the SF Symbol vertically centered against
  // its adjacent status text (token result, last-sync time), and the sync
  // action beside its last-sync status.
  statusLine: {
    alignItems: 'center',
  },
  // The account's primary number: larger than body so the total balance reads
  // as the headline of the screen. Only size/weight live here — MoneyText still
  // owns the tone color, so this deliberately omits `color`.
  balance: {
    fontSize: theme.typography.title.fontSize,
    fontWeight: theme.typography.title.fontWeight,
  },
  // A hairline rule separating the Balance / Synchronization / Holdings
  // sections, drawn in the theme's separator color.
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  // A bordered, filled text field affordance shared by the Monobank token entry
  // and the inline holding-title rename. Grows to fill its row beside a trailing
  // icon button.
  textField: {
    flex: 1,
    color: theme.colors.textPrimary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(2),
    ...theme.typography.body,
  },
  // The token-entry row: the field grows while its trailing paste icon button
  // stays vertically centered against it.
  fieldRow: {
    alignItems: 'center',
  },
  // A bare icon button (paste, edit) — padding gives a comfortable tap target
  // without the filled-button chrome of PressableButton.
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
