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
  // The token field's column: grows to fill the row beside the trailing paste
  // icon button, so the shared TextField stretches to the available width.
  tokenFieldColumn: {
    flex: 1,
  },
  // `ClipboardTextField`'s own [input, paste button] row — the field's caption
  // label now renders OUTSIDE this row entirely (see the component's own doc
  // comment for why: centering against a row that also contained the label
  // was the root cause of two earlier failed attempts to center the button on
  // the input). With no label inside it, this row's only two children are the
  // bare `TextField` (a fixed 44pt input box, `flex: 1`) and the paste
  // button's wrapper — both fixed-height boxes with nothing else contributing
  // height, so `alignItems: 'center'` centers the button's box exactly on the
  // input's box, with no coordinate to compute or get wrong. Named `inputRow`,
  // not `fieldRow`, because it deliberately no longer spans the whole labeled
  // field the way it used to — grepped (2026-09-17): `ClipboardTextField` is
  // this style's only consumer, so the rename is safe.
  inputRow: {
    alignItems: 'center',
  },
  // The trailing paste-icon button's wrapper (`ClipboardTextField`). `Button`'s
  // own `size="small"` sets `alignSelf: 'flex-start'` (button.styles.ts),
  // which — left unwrapped — would win over `inputRow`'s `alignItems: 'center'`
  // in Yoga (a child's own `alignSelf` always overrides its parent's
  // `alignItems`) and pin the button to the row's cross-axis start instead.
  // This wrapper's own `alignSelf: 'center'` is technically redundant with
  // `inputRow`'s `alignItems: 'center'` today (an unset `alignSelf` would
  // inherit the same value), but is kept EXPLICIT so this wrapper's placement
  // stays centered even if `inputRow`'s own alignment ever changes for an
  // unrelated reason — the one thing this style exists to guarantee.
  pasteButtonWrapper: {
    alignSelf: 'center',
  },
  // The link's touch target: hugs its text at the leading edge rather than
  // stretching across the column.
  linkPressable: {
    alignSelf: 'flex-start',
  },
}));
