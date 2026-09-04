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
  // The full-bleed dismiss scrim behind the sheet: a tap anywhere on the
  // exposed area above the sheet dismisses. It fills the whole overlay and
  // the opaque sheet renders on top of it, so only the area above the sheet
  // takes a tap. Position/size only — no color here. The scrim's own
  // translucent-black/blur fill is `backdropGlass`/`backdropFallback`
  // below, a child of this Pressable, per `pff-design-system`'s
  // "GlassSurface `isLiquidGlassSupported` branch": the visual layer
  // structurally branches on the same `isLiquidGlassSupported` check
  // GlassSurface uses, not a single tree with a conditional style.
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Fills the backdrop Pressable's own bounds for either branch below —
  // shared sizing so the LiquidGlassView (iOS 26+, real blur material via
  // its own `effect`/`colorScheme`/`tintColor` props) and the plain-View
  // fallback cover the Pressable identically.
  backdropFill: {
    flex: 1,
  },
  // The non-liquid-glass fallback (older iOS, or Android): no real blur
  // material is available without a new native dependency (see
  // `pff-design-system` / the harness's dependency-age guard), so this
  // stays a flat translucent-black dim — `theme.colors.scrim`, not the
  // opaque `background` token — enough contrast for the sheet on top
  // without ever reading as solid black.
  backdropFallback: {
    backgroundColor: theme.colors.scrim,
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
