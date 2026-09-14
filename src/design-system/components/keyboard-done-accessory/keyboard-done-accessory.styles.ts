import { StyleSheet } from 'react-native-unistyles';

// The toolbar's minimum height (and the Done button's tap target). No Apple
// doc gives a literal point value for a `UIToolbar`/input-accessory bar's
// height (`UIToolbar`'s own doc only names "standard-height"/"compact-height"
// style variants, no number — see `keyboardAccessoryBackground`'s doc comment
// in `theme.ts` for the full research writeup this component shares).
// 44 is kept: it is both the iOS HIG minimum touch target AND the
// long-established standard iPhone toolbar/nav-bar height, so it satisfies
// the touch-target requirement and reads as a standard-height bar even
// without a literal Apple citation for the second claim.
const TOOLBAR_MIN_HEIGHT = 44;

// The bottom-corner radius the accessory bar rounds to, so its silhouette
// meets the real system keyboard's own rounded top corners with no gap (see
// `accessoryContainer`'s own doc comment below for the full investigation).
// Reuses `theme.radii.lg` — the SAME token `BottomSheet`'s own Liquid-Glass
// sheet card already rounds its top corners to (`bottom-sheet.styles.ts`'s
// `sheet`/`glassFill`) — rather than inventing a new radius value: Apple's
// "Adopting Liquid Glass" guidance directs matching "rounded shapes that are
// concentric to their containers" for exactly this class of surface, and
// this app's own `lg` token is already the established "Liquid-Glass grouped
// surface, increased corner radius" value other native-chrome-adjacent
// surfaces round to.
const ACCESSORY_BOTTOM_RADIUS = 'lg' as const;

export const styles = StyleSheet.create((theme) => ({
  // The InputAccessoryView host, styled as a real iOS input-accessory toolbar
  // so it reads as PART OF the keyboard directly below it, not a detached
  // strip.
  //
  // MATERIAL (review, 2026-09-14, addendum to the 2026-09-14 fix): the
  // accessory previously painted only the flat `keyboardAccessoryBackground`
  // color approximation, because a live blur material could not be verified
  // safely in this native host at the time (see that token's own doc comment
  // in `theme.ts` for the original investigation). Apple's HIG "Virtual
  // keyboards" page (developer.apple.com/design/human-interface-guidelines/
  // virtual-keyboards, "Place custom controls above the keyboard
  // thoughtfully", updated June 9, 2025) now gives EXPLICIT guidance for
  // exactly this control: "If other views in your app use Liquid Glass, or
  // if your view looks out of place above the keyboard, apply Liquid Glass
  // to the view that contains your controls to maintain consistency." This
  // is the authoritative source `iconTileBorder`'s investigation and the
  // original version of this token found lacking — a literal, on-topic
  // recommendation, not a paraphrased adjacent API. `accessoryGlass` below
  // (a `GlassSurface material` overlay) is the real Liquid Glass response to
  // that guidance.
  //
  // SOLID FALLBACK (the blank-first-paint risk flagged in review):
  // `keyboardAccessoryBackground` stays as THIS View's own `backgroundColor`
  // — a plain RN background, always painted immediately by the host,
  // regardless of native glass timing — so it is the base layer BEHIND
  // `accessoryGlass`, never removed. If the glass overlay renders correctly
  // it visually replaces this fill; if it is ever blank/late/fails to paint
  // in this still-novel `InputAccessoryView` host, this solid fill keeps
  // showing through underneath it — the bar can never render blank. See
  // `use-keyboard-done-accessory.tsx`'s own doc comment for the full layering
  // order.
  //
  // GEOMETRY (addendum, 2026-09-14, on-device review): a flat rectangular
  // bar sitting flush above the real system keyboard left a visible gap at
  // its own two bottom corners, because the keyboard's own top edge is
  // rounded (Liquid Glass; see "Adopting Liquid Glass",
  // developer.apple.com/documentation/technologyoverviews/
  // adopting-liquid-glass, "Controls": "the shape of the hardware informs
  // the curvature of controls... many controls adopt rounder forms", and
  // "Consider aligning the shape of controls with other rounded elements...
  // using rounded shapes that are concentric to their containers"), so a
  // square-cornered bar does not fully cover the corner region right above
  // it. Apple publishes no literal keyboard corner-radius point value (the
  // same "described only qualitatively, never numerically" pattern as the
  // `iconTileBorder`/`keyboardAccessoryBackground` investigations above) —
  // the reasoned fix, following the SAME strategy `BottomSheet`'s own
  // `BACKDROP_RIM_OVERSCAN` already uses for an analogous Liquid-Glass/
  // native-geometry mismatch (extend past the exact boundary rather than
  // guess a precise native number), is to round this bar's own BOTTOM two
  // corners to `ACCESSORY_BOTTOM_RADIUS` — generous enough that the bar's
  // silhouette curves in ahead of the keyboard's own corner, so no gap can
  // open between them regardless of the keyboard's exact curve. The TOP
  // edge stays square (it borders app content, not the keyboard, via the
  // hairline `border` below) — only the bottom two corners round.
  // `overflow: 'hidden'` clips BOTH the solid fill and `accessoryGlass`
  // (below) to this same rounded silhouette, so the two layers can never
  // show mismatched corners.
  //
  // Height/padding hold the 44pt bar (see `TOOLBAR_MIN_HEIGHT` above). The
  // Done button stays trailing (`alignItems: 'flex-end'`, the original
  // placement), vertically centered, and renders as a later sibling so it
  // always paints on top of the glass/solid layers.
  accessoryContainer: {
    minHeight: TOOLBAR_MIN_HEIGHT,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingVertical: theme.spacing(1),
    paddingHorizontal: theme.spacing(4),
    backgroundColor: theme.colors.keyboardAccessoryBackground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    borderBottomLeftRadius: theme.radii[ACCESSORY_BOTTOM_RADIUS],
    borderBottomRightRadius: theme.radii[ACCESSORY_BOTTOM_RADIUS],
    overflow: 'hidden',
  },
  // The live Liquid Glass overlay, an absolutely-positioned sibling painted
  // OVER the container's own solid `backgroundColor` (see
  // `accessoryContainer`'s doc comment above) and UNDER the Done button.
  // `GlassSurface`'s `material` variant is the live-blur variant (no
  // color-pinning backdrop, so it samples real content behind the bar on the
  // glass path; a translucent, never-opaque fallback fill elsewhere) — the
  // same variant `BottomSheet` already uses for its own card background.
  // `radius="lg"` matches `ACCESSORY_BOTTOM_RADIUS` above, and this layer is
  // pushed `theme.radii.lg` PAST the container's own TOP edge — mirroring
  // `bottom-sheet.styles.ts`'s `glassFill` (which extends PAST the sheet
  // card's bottom edge for the reverse reason): `GlassSurface` exposes only
  // a single ALL-corner radius, so sizing this layer to match the container
  // exactly would round its TOP two corners too, which must stay square.
  // Extending it upward by the radius pushes where its rounding starts
  // curving inward up past the container's own top edge, where
  // `accessoryContainer`'s `overflow: 'hidden'` clips it away — what's left
  // visible is a square top and correctly bottom-rounded corners, aligned
  // with the container's own `borderBottomLeftRadius`/
  // `borderBottomRightRadius` since both read the same token.
  accessoryGlass: {
    position: 'absolute',
    top: -theme.radii[ACCESSORY_BOTTOM_RADIUS],
    left: 0,
    right: 0,
    bottom: 0,
  },
  // The trailing Done control. RN's core `<Button>` cannot carry a
  // background/weight/layout, so it is a `Pressable` + DS `Text`; this keeps a
  // >= 44pt tap target even though the label alone is short.
  doneButton: {
    minWidth: TOOLBAR_MIN_HEIGHT,
    minHeight: TOOLBAR_MIN_HEIGHT,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  // The Done label: accent (systemBlue) link tone via the DS `Text` `tone`, and
  // a semibold weight here so it reads as iOS's emphasized Done action. Only the
  // weight is a style override; the color stays the authoritative `accent` tone
  // token (Text excludes `color` from its style prop by design).
  doneLabel: {
    fontWeight: '600',
  },
}));
