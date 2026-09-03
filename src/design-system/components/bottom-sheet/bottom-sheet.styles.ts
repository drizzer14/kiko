import type { DimensionValue } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

// The single base padding step every sheet keeps around its content, shared by
// the top, horizontal, and (on top of the safe-area inset) bottom edges. Three
// of the four original sheets already used spacing(4) here; it also matches the
// app's standard container padding (see the Screen primitive's top/horizontal
// and scroll-content padding), so a sheet's bottom breathing room reads in
// parity with its own top and sides. The icon picker's old spacing(6) was the
// lone outlier and its extra room was never needed (its grid carries its own
// internal gaps); the filter menu used spacing(4) but dropped the safe-area
// inset entirely (bug A2) — this one owner adds `insets.bottom` for every sheet
// so neither drift can recur.
const SHEET_PADDING_STEP = 4;

export const styles = StyleSheet.create((theme) => ({
  // Fills the modal window and pins the sheet to the bottom edge. The scrim and
  // the sheet are siblings inside it (not parent/child), so a tap on the sheet
  // never reaches the scrim's dismiss handler and no responder trickery is
  // needed — the scrim simply sits behind the opaque sheet.
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // The full-bleed dismiss scrim behind the sheet. True-black (the OLED
  // background token) is on-brand for the dark theme; a tap anywhere on the
  // exposed area above the sheet dismisses. It fills the whole overlay and the
  // opaque sheet renders on top of it, so only the area above the sheet takes a
  // tap.
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.background,
  },
  // The sheet card: flush to the screen's left/right/bottom edges with only its
  // top corners rounded — a clean bottom sheet, no floating frame. The Modal
  // renders outside any SafeAreaView, so the sheet owns the bottom safe-area
  // inset itself (`bottomInset` is `useSafeAreaInsets().bottom` from the call
  // site) on top of the single base step, or its last row would sit flush
  // against the home indicator. `maxHeight`, when set, lets a tall sheet scroll
  // its own content instead of growing past the viewport.
  sheet: (bottomInset: number, maxHeight: DimensionValue | undefined) => ({
    maxHeight,
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    backgroundColor: theme.colors.surfaceHigh,
    paddingTop: theme.spacing(SHEET_PADDING_STEP),
    paddingHorizontal: theme.spacing(SHEET_PADDING_STEP),
    paddingBottom: theme.spacing(SHEET_PADDING_STEP) + bottomInset,
  }),
}));
