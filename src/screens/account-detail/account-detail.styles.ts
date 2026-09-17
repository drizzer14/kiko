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
  // The token-entry row's default cross-axis alignment. The trailing paste
  // button's OWN wrapper (`pasteButtonWrapper` below) now overrides this with
  // `alignSelf: 'center'` so the button centers on the input instead, but
  // `fieldRow` itself stays `flex-end` — other row content (a future trailing
  // element with no override of its own) still bottom-anchors against the
  // field's input row (the shared TextField sits below its caption label) by
  // default.
  fieldRow: {
    alignItems: 'flex-end',
  },
  // The trailing paste-icon button's wrapper (`ClipboardTextField`): centers
  // the button VERTICALLY against the whole row — in practice, against the
  // TextField's input box, since the field's own caption label is the only
  // other thing making the row taller than the button. This OVERRIDES
  // `fieldRow`'s `alignItems: 'flex-end'` for just this one child (Yoga lets a
  // child's own `alignSelf` win over its parent's `alignItems`). The wrapper
  // still exists (rather than centering the `Button` directly) to isolate
  // `Button`'s own `size="small"` `alignSelf: 'flex-start'` (button.styles.ts)
  // from the row: unwrapped, `Button`'s own `alignSelf` would win over
  // whatever this row applies, pinning it to the row's cross-axis start
  // instead of taking this centered placement.
  pasteButtonWrapper: {
    alignSelf: 'center',
  },
  // The link's touch target: hugs its text at the leading edge rather than
  // stretching across the column.
  linkPressable: {
    alignSelf: 'flex-start',
  },
}));
