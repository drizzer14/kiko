import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A leading-icon status line: keeps the SF Symbol vertically centered against
  // its adjacent status text (token result, last-sync time), and the sync
  // action beside its last-sync status.
  statusLine: {
    alignItems: 'center',
  },
  // The holdings grid: a 2-up wrap of square cards. Items are ~half-width and
  // laid out with space-between so two sit per row with a gutter between them;
  // rowGap separates successive rows vertically as the grid wraps.
  holdingsGrid: {
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing(3),
  },
  // One grid cell: just under half the row width, leaving the space-between
  // gutter as the horizontal gap between the two columns.
  holdingGridItem: {
    width: '48%',
  },
  // The account's metadata header: the icon chip on the left, the name field
  // growing beside it. Bottom-aligned so the chip lines up with the field's
  // input row (which sits below its caption label) rather than its caption.
  metadataHeader: {
    alignItems: 'flex-end',
  },
  // The name field's column: grows to fill the row beside the fixed-width icon
  // chip, so a long account name has room to render.
  metadataNameBlock: {
    flex: 1,
  },
  // A labelled name field: a bordered, filled input matching the token field's
  // treatment, so the editable name reads as a proper field rather than a tiny
  // inline control.
  nameField: {
    color: theme.colors.textPrimary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(2),
    ...theme.typography.body,
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
