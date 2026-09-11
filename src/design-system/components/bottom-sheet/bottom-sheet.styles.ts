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

// An EXTRA buffer kept at the very end of a sheet's own content, on top of
// `sheet`'s own bottom padding below. Bug A: the Home filter menu (short,
// never-scrolled content) read roomier at the bottom than every other sheet,
// because `sheet`'s own bottom padding is applied to the OUTER card, not the
// content — a short sheet's content simply falls short of the card's full
// height, so `sheet`'s padding shows in full underneath it, while a taller
// sheet's content runs right up to (or past, and scrolls within) that same
// capped height, leaving nothing extra below the last row. Living on the
// CONTENT itself (`scrollContent`'s own `contentContainerStyle` below, and
// `box` below for a `scrollable={false}` sheet) rather than solely on
// `sheet`'s own padding guarantees this same buffer renders directly beneath
// the very last row (or, for a pinned-actions sheet, the pinned row itself)
// in every case — short content, content that fills the cap, and content
// scrolled all the way to its end alike. Matches `SHEET_PADDING_STEP` itself
// (both are "the one base step"), so every sheet's existing
// "pads the sheet clear of the home indicator" test — which asserts the
// FIRST ancestor `paddingBottom` it finds is at least the base step, spacing(4)
// = 16 — still holds once that first-found ancestor becomes this content-level
// padding rather than `sheet`'s own.
const CONTENT_BOTTOM_PADDING_STEP = SHEET_PADDING_STEP;

export const styles = StyleSheet.create((theme) => ({
  // Fills the modal window and pins the sheet to the bottom edge. The scrim and
  // the sheet are siblings inside it (not parent/child), so a tap on the sheet
  // never reaches the scrim's dismiss handler and no responder trickery is
  // needed — the scrim simply sits behind the sheet, in paint order.
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // The full-bleed dismiss scrim behind the sheet: a tap anywhere on the
  // exposed area above the sheet dismisses. It fills the whole overlay and
  // the sheet renders on top of it, so only the area above the sheet
  // takes a tap. Position/size only — no color here. The scrim's own
  // translucent-black/blur fill is `backdropGlass`/`backdropFallback`
  // below, a child of this Pressable, per `kiko-design-system`'s
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
  // `kiko-design-system` / the harness's dependency-age guard), so this
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
  // against the home indicator. `maxHeight` is always set by the component
  // (the resolved 66%-of-window cap, or a call site's own stricter override —
  // see `BottomSheet`'s own comment), never left unset, so a tall sheet always
  // scrolls its own content instead of growing past the viewport.
  //
  // `overflow: 'hidden'` clips the card to this exact top-rounded/bottom-flush
  // shape — needed now that `glassFill` below (the translucent glass
  // background, a `GlassSurface`) deliberately extends past this View's own
  // bottom edge: without the clip, that extension would render past the
  // sheet's intended silhouette.
  //
  // The sheet is a grouped surface: its base sits one level below the
  // cards/controls on it, so a selected pill (`surfaceHigh`) reads as raised
  // rather than blending into the sheet. It used `surfaceHigh` itself before —
  // the SAME tone as a selected pill — which the trend filter sheet blended
  // into (on-device review). The base fill itself now lives on `glassFill`'s
  // `GlassSurface` (its `material` variant — a real live-blur on iOS 26+ that
  // reads the true content behind the sheet, or the same `surfaceTranslucent`
  // token on the non-glass fallback, composited over true-black to
  // ~rgb(17,17,18) there — darker than `surfaceHigh` #2C2C2E, so the elevation
  // split still holds), not a `backgroundColor` here. No in-sheet element uses
  // the `surface`/`surfaceTranslucent` tone for
  // its own chrome (it is `surfaceHigh`, `accent`, or transparent — the
  // icon-picker-modal's unselected tiles were moved from `surface` to
  // `surfaceHigh` for exactly this reason), so none blends, and every sheet
  // gains the correct grouped elevation. A new in-sheet control must sit at
  // `surfaceHigh` (or above), never `surface`, or it blends into this base.
  sheet: (bottomInset: number, maxHeight: number) => ({
    maxHeight,
    overflow: 'hidden',
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    paddingTop: theme.spacing(SHEET_PADDING_STEP),
    paddingHorizontal: theme.spacing(SHEET_PADDING_STEP),
    paddingBottom: theme.spacing(SHEET_PADDING_STEP) + bottomInset,
  }),
  // The translucent glass MATERIAL background, painted BEHIND the grabber +
  // body (it
  // renders first in `BottomSheet`; a later sibling always paints over an
  // earlier one, the same back-to-front convention `GlassSurface` itself uses
  // for its own backdrop/base/wash/children layers — see
  // `glass-surface.component.tsx`). Absolutely fills the sheet card's own
  // width, pinned to its top, but its `bottom` is pulled `theme.radii.lg`
  // PAST the card's own bottom edge on purpose: `GlassSurface` exposes only a
  // single ALL-corner `radius` (there is no top-only variant), so sizing it to
  // match the card exactly would round its bottom-left/bottom-right corners
  // too, leaking the dismiss scrim through a small gap right at the bottom of
  // the screen. Extending it by exactly the radius pushes the point where
  // `GlassSurface`'s own rounded-rect shape starts curving inward to precisely
  // the sheet card's bottom edge — `sheet`'s own `overflow: 'hidden'` above
  // then clips everything below that edge, so what's left is a flat straight
  // bottom and correct top-rounded corners (which align exactly with `sheet`'s
  // `borderTopLeftRadius`/`borderTopRightRadius`, since both read the same
  // `theme.radii.lg`).
  glassFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: -theme.radii.lg,
  },
  // DEVICE BUG (F5) fix: the 66% cap (`sheet.maxHeight` above) is forced on
  // every sheet, but until now the sheet card rendered no scroll container of
  // its own, so a plain-Box sheet whose content ran taller than the cap
  // (filter-menu, date-field, date-range-field, the transaction-form
  // category-override confirm) simply got CLIPPED at 66% with no way to
  // reach its own lower rows. `flexShrink: 1` is what makes the ScrollView
  // actually shrink to fit inside the capped parent `Box` (`sheet` above)
  // instead of growing it to its content's natural height — a bare
  // `ScrollView` with no explicit sizing ignores its parent's `maxHeight`.
  // The default `scrollable` path in `BottomSheet` wraps `children` in a
  // `ScrollView` styled with this; the `scrollable={false}` opt-out (a sheet
  // that needs a pinned header/footer/actions row around its OWN inner
  // ScrollView — date-range-field's Apply/Clear row, category-field's
  // scroll-to-selected ref, icon-picker-modal's Remove/Cancel header) skips
  // this entirely and owns its own scroll region instead.
  scrollBody: {
    flexShrink: 1,
  },
  // The top drag region: the grabber pill (and, when a call site passes one, an
  // optional header node under it) in a hit area the vertical Pan is attached to
  // (and ONLY here, never the scrollable body, so the drag never fights the
  // sheet's own ScrollView). Extending the header into this same region is what
  // makes a drag ANYWHERE across the header — not only on the small pill — drive
  // the dismiss. Its bottom pad separates the region from the first content row;
  // the sheet card's own `paddingTop` sits above it. `gap` only takes effect
  // when a header is present (a lone grabber is a single child, so there is
  // nothing to space) — so a headerless sheet keeps its exact prior layout. The
  // grabber centers itself via its own `alignSelf` below rather than this
  // region's `alignItems`, so the header stays full-width/left-aligned (the
  // region's default `stretch`) instead of being centered with the pill.
  grabberRegion: {
    paddingTop: theme.spacing(1),
    paddingBottom: theme.spacing(3),
    gap: theme.spacing(3),
  },
  // The grabber pill itself: the standard iOS ~36x5pt rounded handle, in the
  // muted separator gray so it reads as a subtle affordance on the sheet
  // surface rather than a hard line. `alignSelf: 'center'` keeps it centered
  // now that its region no longer sets `alignItems: 'center'` (so an optional
  // header sibling can stay left-aligned).
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.border,
  },
  // The vertical gap between the sheet's own top-level children (the
  // call-site's `gap` prop, in theme.spacing steps), applied to the
  // centralized `ScrollView`'s own content container on the default
  // `scrollable` path (`box` below is the `scrollable={false}` opt-out
  // path's equivalent). A `ScrollView`'s OWN `style` never lays out its
  // children (only `contentContainerStyle` does), so the gap cannot live on
  // `scrollBody` above. `paddingBottom` is the extra comfortable-bottom-space
  // buffer (bug A, see `CONTENT_BOTTOM_PADDING_STEP` above) — living in the
  // content container itself means it is still visible even once the
  // ScrollView is scrolled all the way to its end, unlike padding on `sheet`
  // (which only ever shows beneath content short enough to never need to
  // scroll).
  scrollContent: (gap: number) => ({
    gap,
    paddingBottom: theme.spacing(CONTENT_BOTTOM_PADDING_STEP),
  }),
  // The `scrollable={false}` opt-out's body wrapper (a pinned-actions sheet:
  // date-range-field's Clear/Apply row, category-field's and
  // icon-picker-modal's own header + inner ScrollView, each rendered as a
  // plain child of this `Box` alongside the pinned row). `flexShrink: 1` lets
  // this `Box` participate in the sheet's 66% cap the SAME way `scrollBody`
  // above does — a plain `View` (React Native's Yoga default `flexShrink: 0`,
  // unlike the web's `1`) would otherwise refuse to shrink at all here, so
  // only its OWN inner `flexShrink: 1` ScrollView (each opted-out sheet's own
  // `styles.scroll`) was what kept the whole thing inside the cap; this
  // closes that gap in the ONE shared wrapper instead of relying on every
  // opted-out sheet getting its own inner ScrollView's sizing exactly right.
  // `paddingBottom` gives it the SAME comfortable bottom buffer as
  // `scrollContent` above (bug A) — directly beneath whichever child renders
  // last: a pinned actions row (date-range-field), or the sheet's own inner
  // ScrollView's frame (category-field, icon-picker-modal).
  box: {
    flexShrink: 1,
    paddingBottom: theme.spacing(CONTENT_BOTTOM_PADDING_STEP),
  },
}));
