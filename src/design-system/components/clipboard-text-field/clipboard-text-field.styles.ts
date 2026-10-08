import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // `ClipboardTextField`'s own [input, paste button] row — the field's caption
  // label and its error line render OUTSIDE this row entirely (see the
  // component's own doc comment for why: centering against a row that also
  // contained the label or the error was the root cause of the earlier failed
  // attempts to center the button on the input, and of the button dropping
  // below the input once an error appeared). With neither inside it, this
  // row's only two children are the bare `TextField` (a fixed 44pt input box,
  // `flex: 1`) and the paste button's wrapper — both fixed-height boxes with
  // nothing else contributing height, so `alignItems: 'center'` centers the
  // button's box exactly on the input's box, with no coordinate to compute or
  // get wrong.
  inputRow: {
    alignItems: 'center',
  },
  // The field's own column: grows to fill the row beside the trailing paste
  // icon button, so the `TextField` stretches to the available width.
  tokenFieldColumn: {
    flex: 1,
  },
  // The trailing paste-icon button's wrapper. `Button`'s own `size="small"`
  // sets `alignSelf: 'flex-start'` (button.styles.ts), which — left
  // unwrapped — would win over `inputRow`'s `alignItems: 'center'` in Yoga (a
  // child's own `alignSelf` always overrides its parent's `alignItems`) and
  // pin the button to the row's cross-axis start instead. This wrapper's own
  // `alignSelf: 'center'` is technically redundant with `inputRow`'s
  // `alignItems: 'center'` today (an unset `alignSelf` would inherit the same
  // value), but is kept EXPLICIT so this wrapper's placement stays centered
  // even if `inputRow`'s own alignment ever changes for an unrelated reason —
  // the one thing this style exists to guarantee.
  // The negative horizontal margin gives the paste glyph a compact icon-button
  // spacing without shrinking the Button's own 44pt-wide tap target (12pt
  // padding + 20pt glyph + 12pt padding): with `inputRow`'s 4pt gap, the glyph
  // sits 12pt from the input and 8pt from the row's end, and the tap target
  // starts exactly at the input's edge, never overlapping it.
  pasteButtonWrapper: {
    alignSelf: 'center',
    marginHorizontal: -theme.spacing(1),
  },
}));
