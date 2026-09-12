import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

type GlassRadius = 'md' | 'lg';

export type GlassSurfaceProps = ViewProps & {
  children?: ReactNode;
  padding?: number;
  radius?: GlassRadius;
  // An optional flat entity-color background for the surface: one resolved,
  // OPAQUE `#RRGGBB` string (see `entityCardBackground` in
  // `design-system/entity-tint.ts` — the entity hue, darkened enough to read
  // as a card tone, with no alpha compositing on top). Rendered as a plain
  // absolutely-positioned `View` sibling filling the surface, BEHIND
  // `children` and clipped to the surface's own rounded corners by
  // `styles.surface`'s `overflow: hidden`. It is a normal child element, not
  // a foreign inline style appended to the PARENT's own style array, so
  // there is no ShadowNode-reconciliation gap to route around: it paints on
  // the first frame the same way `children` always has (the
  // first-paint-transparent bug an inline style on the parent node used to
  // hit). Opaque by design (F4 device bug fix): the wash fully covers
  // whichever base sits under it (the flat themed surface on the fallback
  // path, the Liquid Glass material on the glass path), so the visible
  // result is identical on both paths and can no longer be diluted by
  // re-blending with what's underneath.
  //
  // This single color also feeds the real Liquid Glass material's own
  // `tintColor` prop (see `GlassSurface`'s `base` below) — one flat, already-
  // darkened hue for both the glass tint and the fallback wash, not two
  // gradient stops.
  tint?: string;
  // Renders the surface as a see-through frosted glass PANEL: the neutral
  // translucent variant. On the glass path it paints a TRANSLUCENT
  // `styles.translucentBase` backdrop UNDER the see-through material (not the
  // opaque backdrop a tinted card gets), so the material samples a
  // PARTIALLY-pinned color — the lightness drift and drag pop-in are softened,
  // not fully removed, while the screen behind reads through. On the non-glass
  // fallback path it uses the SAME translucent fill as the base, so that path
  // reads see-through too. It carries NO color wash, so the panel stays
  // visually neutral. Use it for a neutral card meant to read as airy
  // see-through glass (the settings and category cards). It is a NEUTRAL
  // variant, so a `tint` (an entity card, which must stay opaque) always wins:
  // `transparent` is ignored when a `tint` is set. Defaults to `false`.
  transparent?: boolean;
  // A middle-ground neutral backdrop, like `transparent` but MORE opaque: it
  // also paints a TRANSLUCENT backdrop UNDER the glass on both the glass and
  // fallback paths (so the material samples a pinned color and the fallback
  // reads see-through), but with a MORE opaque fill —
  // `theme.colors.surfaceTranslucentStrong` (0.80 alpha) instead of
  // `transparent`'s `surfaceTranslucent` (0.60) — so a scrolling card drifts
  // LESS in lightness on scroll while still reading see-through, not opaque.
  // It sits between `material` (no backdrop at all, so the glass samples the
  // live content behind it — maximum drift) and `transparent` (a softer 0.60
  // partial pin): `material` < `transparent` < `translucentStrong` < an
  // opaque `tint` card, in order of how much the backdrop pins the sample.
  // It is a NEUTRAL variant, so a `tint` (an entity card, which must stay
  // opaque) always wins over it, the same as `transparent`/`material`.
  // Defaults to `false`.
  //
  // Device bug fix: the backdrop-alpha bump above was, on its own, INVISIBLE
  // on the Home transaction card — the live glass material samples/refracts
  // whatever backdrop sits under it, so a 0.60 -> 0.80 alpha change gets
  // washed out instead of reliably darkening the visible card. On the REAL
  // glass path only, this variant therefore ALSO paints a NEUTRAL DARK
  // `wash` — a flat overlay drawn OVER the finished glass (`theme.colors
  // .surfaceWashStrong`), the same layering slot as an entity `tint`'s color
  // wash but neutral (no hue). A wash painted on top of the already-
  // composited glass is not subject to the material's refraction, so it is
  // the reliable lever that actually darkens the card while it stays glassy
  // and see-through. The non-glass fallback does NOT get this extra wash: its
  // `base` already IS the stronger translucent fill directly (nothing sits
  // between it and the screen behind to wash the alpha out), so it was never
  // the broken path and needs no second darkening layer.
  translucentStrong?: boolean;
  // Renders the surface as a REAL translucent blur MATERIAL: the live
  // see-through glass (same as a plain surface — no backdrop layer under the
  // glass, so it is not muted or color-pinned) on the glass path, but with a
  // TRANSLUCENT (not opaque) fallback fill on the non-glass path, so a device
  // without Liquid Glass still reads see-through rather than a solid panel.
  // This is DIFFERENT from `transparent`: `transparent` paints a translucent
  // `surfaceTranslucent` backdrop UNDER the glass on both paths (a PARTIAL
  // pin, for a scrolling card whose drift needs softening); `material` paints
  // NO backdrop on the glass path at all, so the glass samples the live
  // content behind it for a true blur look. Reach for it only for a surface
  // whose backdrop is STATIC while shown (a modal bottom sheet) — the
  // lightness-drift concern that motivates `transparent`'s partial pin for a
  // scrolling card does not apply there. `BottomSheet` is the first consumer
  // (its `glassFill`), and the STATIC-backdrop condition is why it can. The
  // Home transaction row is a SECOND consumer that does NOT meet that
  // condition — it is a scrolling list card, so its live glass sample drifts in
  // lightness on scroll — but takes `material` anyway per an explicit product
  // decision to match the sheet's look, knowingly accepting that drift over
  // `transparent`'s partial pin. So the static-backdrop rule is the DEFAULT
  // guidance, not an invariant: a new consumer should still confirm it before
  // reaching for this over `transparent`, or record (as the row does) a
  // deliberate choice to accept the drift. A `tint` (an entity card, which must
  // stay opaque) always wins over this too, the same as `transparent`. Defaults
  // to `false`.
  material?: boolean;
  // Opts the surface into MAXIMUM live-sampling by the real Liquid Glass
  // material — a BASE-GLASS property (not tied to any one variant), applied
  // APP-WIDE to every neutral (non-`tint`) `GlassSurface` consumer: every
  // Statistics chart card, the Settings/System/category cards, the Home
  // net-worth card, the BottomSheet's shared `material` glass fill, the
  // Home transaction row (`translucentStrong`), and the holding-detail
  // ledger rows. Proved first on exactly one surface (the Statistics
  // account-contribution pie card) before this rollout.
  //
  // The Settings category card (`categories.screen.tsx`'s `CategoryCard`,
  // `transparent bordered`) already shows a weak version of this on-device
  // today: `transparent`'s own translucent (0.60-alpha) backdrop UNDER the
  // glass only PARTIALLY pins what the material samples, so some of the real
  // screen behind/adjacent to the card — the destructive-red Delete button
  // beside it — still bleeds through and blooms into the glass, just weakly.
  // `bloom` is that same lever, pushed further, as an explicit opt-in: on the
  // real glass path it OMITS the backdrop layer entirely (the same
  // fully-live-sample tree a plain or `material` surface already renders —
  // see the component's own block comment), removing the pin so a vivid
  // nearby color (a destructive-red button, a gold chart bar, a chart
  // segment) bleeds through at full strength, AND switches the native
  // `UIGlassEffect` style from `'regular'` to `'clear'` — Apple's more
  // transparent, less legibility-biased material variant, so whatever bleeds
  // through reads with more of its original saturation instead of muted/
  // frosted. Both are genuine `LiquidGlassView` props (`effect`, and simply
  // not rendering a backdrop `View`) — never a painted overlay, gradient
  // layer, or drop-shadow, and no new color of its own: `bloom` does not
  // inject a hue, it only permits more of what is ALREADY on screen through.
  // Composable with `transparent`: `bloom` overrides `transparent`'s own
  // backdrop pin on the glass path (bloom wins — opting in means wanting the
  // live sample), but the non-glass FALLBACK still reads `transparent`'s
  // translucent fill, since there is no real optical sampling on that path
  // to strengthen. A `tint` (an entity card, which must stay pinned and
  // stable — see the `tint` prop's drift-fix doc) always wins over `bloom`,
  // the same precedence as every other neutral variant.
  //
  // Composable with `translucentStrong` too — the Home transaction row's
  // case, and the one place this composition matters most since it is a
  // SCROLLING card. `resolveBackdropFill`'s precedence checks `isBloom`
  // before `isStrong`, so `bloom` wins on the backdrop: the 0.80-alpha pin
  // is removed and the glass live-samples the real screen behind the row.
  // `resolveWashFill`, by contrast, is driven by `isStrong` alone and does
  // not read `isBloom` at all, so `translucentStrong`'s neutral dark
  // `surfaceWashStrong` overlay keeps painting OVER the now-backdrop-less,
  // `'clear'`-effect glass. This is a deliberate, coherent combination, not
  // an accidental side effect of the shared precedence: the dark wash is
  // KEPT for row-text legibility over the now-live-sampling material, while
  // the backdrop pin — the anti-drift mechanism `translucentStrong` exists
  // for — is the one thing `bloom` intentionally trades away on this
  // surface, per the product decision to accept the resulting drift
  // everywhere bloom is applied, including scrolling rows.
  //
  // TRADEOFF, stated explicitly: MORE live sampling means MORE lightness/
  // color drift on a card whose surroundings change — the exact instability
  // `translucentStrong`'s pin (the Home transaction row) exists to kill.
  // Applied app-wide per an explicit product decision (see the doc above)
  // that knowingly accepts this drift even on a scrolling surface, not only
  // a static one. Defaults to `false`.
  //
  // FIRST-PAINT RE-SAMPLE (device bug, confirmed 2026-09-12). The real glass
  // path's `LiquidGlassView` has NO backdrop under it when `bloom` is set
  // (see above) and runs with `effect="clear"` (see the component's
  // `glassEffect`) — a `'clear'`-effect glass samples its backdrop exactly
  // once, at native layout, with no imperative re-sample API. That is fine
  // for a surface that lays out once, already in its real on-screen
  // position (a plain `<Screen scroll>` child, e.g. the Statistics pie
  // card). It is NOT fine for a surface managed by
  // `react-native-sortables`' `Sortable.Grid` (the categories screen's
  // category card): Sortable MEASURES each item first, then
  // transform-repositions it, so the glass's one-shot sample fired during
  // the measure pass — before the transform landed, with nothing solid to
  // sample — leaving the card fully transparent until an unrelated event
  // (a drag, which teleports the card into a portal and remounts a fresh
  // `LiquidGlassView` already in its final position) forced a second
  // sample. `GlassSurface` now compensates for this ITSELF: a `bloom`
  // surface on the real glass path gets exactly one forced remount on a
  // post-mount frame (`needsResample`/`remountToken` in the component),
  // regardless of what kind of layout container it sits in — no consumer
  // needs to opt into or work around this, and `bloom`'s own no-backdrop/
  // `'clear'`-effect semantics documented above are unchanged.
  bloom?: boolean;
  // Draws the shared card edge: a hairline separator border in the theme's
  // `border` token. Routed through a Unistyles-managed style member inside the
  // component (not a plain inline `borderWidth`/`borderColor`) for the same
  // ShadowNode-reconciliation reason as `tint`: a foreign inline border is not
  // written to the native node until the next React commit, so it appears only
  // intermittently on the first paint. Routing it through the managed style
  // makes the border land on the first frame every time (G2).
  bordered?: boolean;
};
