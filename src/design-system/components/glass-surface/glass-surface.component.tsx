import { isLiquidGlassSupported, LiquidGlassView } from '@callstack/liquid-glass';
import { SCREENSHOT_MODE, SCREENSHOT_STABLE_GLASS } from '@env';
import type { FC, ReactNode } from 'react';
import { StyleSheet as RNStyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { GlassSurfaceProps } from './glass-surface.props';
import { useBloomResample } from './glass-surface.resample.hook';
import { styles } from './glass-surface.styles';

// Extracted to keep the component's own cognitive complexity down: the
// backdrop fill has a strict precedence — an entity `tint` (opaque) beats
// `bloom` (explicitly NO backdrop — maximum live sample), which beats
// `translucentStrong` (the stronger 0.80-alpha pin), which beats `transparent`
// (the softer 0.60-alpha pin), which beats no backdrop at all (a plain or
// `material` surface).
const resolveBackdropFill = (
  tint: string | undefined,
  isStrong: boolean,
  isTransparent: boolean,
  isBloom: boolean,
) => {
  if (tint !== undefined) return styles.opaqueBase;
  if (isBloom) return false;
  if (isStrong) return styles.strongTranslucentBase;
  if (isTransparent) return styles.translucentBase;
  return false;
};

// Same precedence idea for the non-glass fallback fill: there is no real
// optical sampling to strengthen on this path, so `bloom` does not remove
// the fallback fill the way it removes the glass-path backdrop — it only
// guarantees the fallback stays translucent (the same fill `transparent`
// already gives), same as `material`. `translucentStrong`'s stronger pin
// still beats all of `transparent`/`material`/`bloom`'s shared translucent
// fill, which beats the opaque themed base a plain surface falls back to.
const resolveFallbackFill = (
  isStrong: boolean,
  isTransparent: boolean,
  isMaterial: boolean,
  isBloom: boolean,
) => {
  if (isStrong) return styles.strongTranslucentBase;
  if (isTransparent || isMaterial || isBloom) return styles.translucentBase;
  return styles.opaqueBase;
};

// The `wash` layer's fill and gate. An entity `tint` always wins (its colored
// wash exists on BOTH the glass and fallback paths, unconditionally, because
// the fallback's own base is a generic themed gray it needs recoloring out
// of). `translucentStrong`'s neutral dark wash is different: it is gated to
// `isGlassPath` ONLY — see the `strongWash` style and `surfaceWashStrong`
// token doc comments for why the non-glass fallback does not need it.
const resolveWashFill = (tint: string | undefined, isStrong: boolean, isGlassPath: boolean) => {
  if (tint !== undefined) return { backgroundColor: tint };
  if (isStrong && isGlassPath) return styles.strongWash;
  return undefined;
};

// Every neutral variant (`transparent`, `translucentStrong`, `material`,
// `bloom`) shares the same precedence rule against an entity `tint`: the two
// are contradictory, so `tint` always wins. Extracted to a plain function
// (a call adds no cognitive-complexity cost, unlike an inline `&&`) purely to
// keep `GlassSurface`'s own complexity under budget — see the four call
// sites below for what each variant means on its own.
const isActiveVariant = (flag: boolean, tint: string | undefined): boolean =>
  flag && tint === undefined;

// The OPAQUE stable-glass surface, rendered ONLY when `isStableGlass()` is true
// (the pixelmatch regression build — see the branch in GlassSurface and the
// `isStableGlass` doc). No live LiquidGlass, no bloom: a fixed design-system
// `surface` fill (`styles.opaqueBase`, the same token the tinted-card backdrop
// and non-glass fallback use — never a hardcoded color) with the entity `tint`
// painted as a flat wash over it, so a tinted card keeps its color but pinned.
// Layer testIDs mirror the live path (`-base`, `-wash`) so a single test can
// assert either branch. Split out purely to keep GlassSurface's cognitive
// complexity under budget.
export const StableSurface: FC<{
  children: ReactNode;
  style: StyleProp<ViewStyle>;
  tint: string | undefined;
  testID: string | undefined;
}> = ({ children, style, tint, testID }) => {
  const wash: ReactNode = tint !== undefined && (
    <View
      style={[RNStyleSheet.absoluteFill, { backgroundColor: tint }]}
      testID={testID && `${testID}-wash`}
    />
  );

  return (
    <View style={style} testID={testID}>
      <View
        style={[RNStyleSheet.absoluteFill, styles.opaqueBase]}
        testID={testID && `${testID}-base`}
      />

      {wash}

      {children}
    </View>
  );
};

// A shared surface for card-like grouping (accounts list, settings sections):
// real Liquid Glass material on iOS 26+, a themed flat surface everywhere
// else. isLiquidGlassSupported renders LiquidGlassView as a plain View with
// no effect on unsupported iOS, so the fallback background/radius below is
// still required in that branch, not only in the explicit `else`.
//
// The surface is composed as stacked `absoluteFill` layers inside one plain
// parent `View`, painted back-to-front:
//   1. the `backdrop` (glass path) — a themed `View` painted UNDER the glass so
//      the translucent backdrop-sampling material refracts a FIXED color
//      instead of live screen content. Its fill depends on the variant: OPAQUE
//      `surface` for a tinted entity card, TRANSLUCENT `surfaceTranslucent` for
//      a `transparent` frosted panel, and NONE for a plain live-glass surface;
//   2. the base — the Liquid Glass material (glass path) or the flat themed
//      background (fallback path), a layer with NO children;
//   3. the `wash` — a flat fill, a SIBLING drawn OVER the base: the
//      entity-color tint for a `tint` card (both paths), or, on the REAL
//      glass path only, `translucentStrong`'s own neutral dark overlay (see
//      below);
//   4. `children`, on top of the wash.
//
// STABILITY — why the tint no longer drifts. A `LiquidGlassView` with
// `effect="regular"` samples whatever sits behind it, so on device the card's
// visible background was ~90% a LIVE glass sample of the screen behind the
// card and only ~10% fixed wash. Every scroll, reorder, or navigation changed
// what was behind the card, the glass re-refracted, and the card's lightness
// shifted (and it flashed on drag pickup — see `animated` below). Two fixes,
// both here:
//   - the entity color is composited INTO the material NATIVELY via the
//     library's own `tintColor` prop (fed the card's own `tint`), a fixed
//     tint that no recomposite can wash out;
//   - a tinted card also gets the opaque `backdrop` layer UNDER the glass, so
//     the material samples a constant color, not the live screen — pinning the
//     card's lightness across scroll/reorder/navigation. This opaque backdrop
//     is the prescribed anti-drift mechanism, and it also stops the glass
//     compositing a frame over nothing solid (the pop-in).
//
// A `transparent` NEUTRAL surface (the frosted see-through panel — settings and
// category cards) sits between the two: it gets a TRANSLUCENT
// `surfaceTranslucent` backdrop instead of an opaque one. The translucent
// backdrop is a real filled `View`, so it still gives the glass something solid
// to composite over (no pop-in) and PARTIALLY pins the sampled color (the
// lightness drift is softened, not fully removed), while its alpha lets the
// screen behind read through — the see-through look. It carries NO wash.
// `translucentStrong` is a fourth, MORE-opaque neutral option between
// `transparent` and an opaque `tint` card: the SAME translucent-backdrop
// mechanism, with the stronger `surfaceTranslucentStrong` fill (0.80 vs 0.60
// alpha) — BUT that backdrop bump alone turned out to be INVISIBLE on device
// (the Home transaction card): a `LiquidGlassView` with `effect="regular"`
// samples/refracts whatever backdrop sits under it, so the alpha difference
// gets washed out on the real glass path instead of reliably darkening the
// card. `translucentStrong` therefore ALSO paints a NEUTRAL DARK `wash` — a
// flat overlay drawn OVER the finished glass (`surfaceWashStrong`, see the
// `wash` layer below and the token's own doc comment in `theme.ts`) — but
// ONLY on the real glass path; the non-glass fallback's own base already
// renders the stronger fill directly with nothing sampling it away, so it
// never needed a second darkening layer. A plain surface that opts into
// neither `tint`, `transparent`, `translucentStrong`, nor `material` keeps
// the fully-live see-through glass: no backdrop, no wash.
//
// `bloom` is a fifth, ORTHOGONAL base-glass property (see its prop doc): the
// OPPOSITE lever from `translucentStrong`'s anti-drift pin. It OMITS the
// backdrop on the glass path entirely — the same fully-live-sample tree a
// plain/`material` surface already renders — and switches the native
// `UIGlassEffect` style from `'regular'` to `'clear'`, so a vivid neighboring
// color already on screen (a destructive-red Delete button, a gold chart
// bar) bleeds through and blooms into the glass at full, saturated strength
// instead of the muted, partially-pinned bleed `transparent`'s own 0.60-alpha
// backdrop already lets through weakly (see the Settings category card,
// which shows exactly this today). It injects no color of its own — never a
// painted overlay, gradient layer, or drop-shadow. Proved first on exactly
// one consumer (the Statistics account-contribution pie card), then rolled
// out app-wide to every neutral (non-`tint`) `GlassSurface` — including the
// Home transaction row's `translucentStrong` card and the holding-detail
// ledger rows, both scrolling surfaces where the drift tradeoff below was
// knowingly accepted rather than avoided (see the `bloom` prop doc's
// "Composable with `translucentStrong`" paragraph for the transaction row's
// exact backdrop-removed/wash-kept combination).
//
// A backdrop-less `'clear'`-effect glass only samples once, at native
// layout — see the `needsResample`/`remountToken` block below for the
// one-shot post-mount re-sample this component now performs for exactly
// that combination, and why a `Sortable.Grid`-managed card (the category
// card) needed it while a plain `<Screen scroll>` child (the Statistics pie
// card) did not.
//
// `animated={false}` stops the frost-in animation replaying on every remount.
// react-native-sortables teleports the dragged card into a portal, remounting
// a fresh `LiquidGlassView`; with the library's `animated` default of `true`
// the glass replayed its frost-in on every pickup, a visible flash.
//
// The wash is deliberately NOT a child of `LiquidGlassView`. When it was, it
// landed inside the native `UIGlassEffect` contentView, so every React commit
// re-lensed and re-frosted the glass OVER the thin 8–14% tint. Layering the
// wash as a sibling over the finished glass keeps the tint out of the
// contentView. It stays as a subtle flat accent over the now-stable base.
const GlassSurface: FC<GlassSurfaceProps> = ({
  children,
  style,
  padding,
  radius = 'md',
  tint,
  transparent = false,
  translucentStrong = false,
  material = false,
  bloom = false,
  bordered = false,
  testID,
  ...props
}) => {
  const { theme } = useUnistyles();
  const sizing = [
    { borderRadius: theme.radii[radius] },
    padding !== undefined && { padding: theme.spacing(padding) },
  ];
  // The card edge goes through the Unistyles-managed `bordered` member so it
  // lands on the first paint (see the `bordered` prop docs).
  const edge = bordered ? styles.bordered : false;

  // `bloom` is a BASE-GLASS property, not tied to any one variant (see the
  // prop doc): a `tint` still wins over it for the same reason as the other
  // neutral variants. Hoisted above the `isStableGlass()` early return below
  // (and so is `needsResample`) because both feed `useBloomResample`, a
  // hook — every hook this component calls must run unconditionally, before
  // any early return, per the rules of hooks.
  const isBloom = isActiveVariant(bloom, tint);
  // FIRST-PAINT RE-SAMPLE (device bug, confirmed 2026-09-12 on the categories
  // screen's `Sortable.Grid`-managed card): see `useBloomResample`
  // (`glass-surface.resample.hook.ts`) for the full mechanism doc. `bloom` on
  // the real glass path renders a backdrop-less `LiquidGlassView` with
  // `effect="clear"` (see `glassEffect`/`base` below), which samples its
  // backdrop exactly once, at native layout — scoped to `needsResample`
  // (glass-path `bloom` only): every other variant is already pinned by its
  // own backdrop/wash layer on the first frame and never needed a second
  // native remount.
  const needsResample = isBloom && isLiquidGlassSupported;
  const { remountToken, surfaceRef } = useBloomResample(needsResample);

  // STABLE-GLASS regression mode: a build made against `.env.screenshots.stable`
  // (or the empty/locked stable variants) sets BOTH `SCREENSHOT_MODE=true` and
  // `SCREENSHOT_STABLE_GLASS=true`, so this renders a fixed opaque surface with no
  // live LiquidGlass sampling and no bloom, giving pixelmatch byte-stable pixels.
  // PRODUCTION SAFETY (5.6): both keys are absent from the committed `.env`, so
  // react-native-dotenv inlines `undefined` for each, this AND folds to `false`,
  // and Metro deletes the branch — no screenshot flag reaches the Release bundle,
  // and the live tree below renders byte-for-byte unchanged.
  if (SCREENSHOT_MODE === 'true' && SCREENSHOT_STABLE_GLASS === 'true') {
    return (
      <StableSurface style={[styles.surface, edge, sizing, style]} tint={tint} testID={testID}>
        {children}
      </StableSurface>
    );
  }
  // `transparent` is a NEUTRAL-surface variant, so a `tint` (an entity card)
  // always wins over it — the two are contradictory and a tinted card must stay
  // opaque.
  const isTransparent = isActiveVariant(transparent, tint);
  // `translucentStrong` is a NEUTRAL variant too (the middle option between
  // `transparent` and an opaque `tint` card), so a `tint` wins over it for the
  // same reason.
  const isStrong = isActiveVariant(translucentStrong, tint);
  // `material` is the live-blur variant (see the prop doc): a `tint` wins over
  // it too, for the same reason. It never adds a backdrop (see `backdropFill`
  // below, which `material` deliberately does not feed) — only the FALLBACK
  // fill (`fallbackFill` below) reads it, so the glass path is byte-for-byte
  // the same "no backdrop, live sample" tree a plain surface already renders.
  const isMaterial = isActiveVariant(material, tint);
  // The backdrop UNDER the glass, and its fill, both depend on the variant:
  //   - a tinted entity card gets the OPAQUE `surface` fill — a fixed color the
  //     translucent glass samples so the card's lightness cannot drift and the
  //     material never composites over nothing solid (the pop-in);
  //   - a `translucentStrong` card gets the STRONGER `surfaceTranslucentStrong`
  //     fill — a scrolling card that must pin its live sample MORE (less drift)
  //     while staying see-through, between a `transparent` panel and an opaque
  //     `tint` card;
  //   - a `transparent` frosted panel gets the TRANSLUCENT `surfaceTranslucent`
  //     fill — a real filled View (so still no pop-in) that partially pins the
  //     sample and lets the screen behind read through;
  //   - a plain or `material` surface (none of the above) renders NO backdrop
  //     and keeps the fully-live see-through material;
  //   - `bloom` (see the prop doc) also renders NO backdrop — it OVERRIDES
  //     `transparent`'s own partial pin (bloom wins: opting in means wanting
  //     the live sample), so the glass samples nothing but the real screen
  //     behind/adjacent to the card at full strength.
  // The fallback (non-glass) branch needs no backdrop: its own base IS the flat
  // themed fill (see `base`). See `resolveBackdropFill` above for the exact
  // precedence.
  const backdropFill = resolveBackdropFill(tint, isStrong, isTransparent, isBloom);
  const backdrop: ReactNode = isLiquidGlassSupported && backdropFill && (
    <View
      style={[RNStyleSheet.absoluteFill, backdropFill]}
      testID={testID && `${testID}-backdrop`}
    />
  );
  // The base fill: the real glass material where supported, the flat themed
  // surface otherwise. An `absoluteFill` sibling with NO children, so the wash
  // is never inserted into the glass contentView (see the block comment above).
  // The entity color is composited into the material via `tintColor` (fed the
  // card's own `tint`, `undefined` for a plain surface), and `animated={false}`
  // stops the frost-in replaying on remount (drag pickup). The glass layer
  // carries its OWN `borderRadius`: iOS computes the glass material's corners
  // from the glass view's own corner config, so the parent's `overflow:
  // hidden` mask alone hard-crops a SQUARE box — the glass needs the radius
  // directly to round its material. The flat fallback has no corner-aware
  // rendering, so the parent mask is enough there — but a `transparent` surface
  // uses the TRANSLUCENT fill there so the non-glass path reads see-through too.
  // `material` reads the SAME translucent fill here — its glass-path tree is
  // otherwise identical to a plain surface's (no backdrop above), so only the
  // non-glass fallback needs to branch for it too, or a device without Liquid
  // Glass would render the sheet as a solid opaque panel instead of see-through.
  // `translucentStrong` reads its OWN stronger fill here too, so the fallback
  // path reads the same "more opaque, still see-through" panel as the glass
  // path's backdrop. `bloom` reads the SAME translucent fill here too — there
  // is no real optical sampling on this path to strengthen, so it only needs
  // to stay see-through, the same as `material`. See `resolveFallbackFill`
  // above for the exact precedence.
  const fallbackFill = resolveFallbackFill(isStrong, isTransparent, isMaterial, isBloom);
  // `bloom` switches the native `UIGlassEffect` style from `'regular'` to
  // `'clear'` (see the prop doc) — Apple's more transparent, less
  // legibility-biased material, so whatever bleeds through the now-backdrop-
  // less glass reads with more of its original saturation. `tint` never
  // changes this: an entity card always wins over `bloom` on the backdrop
  // above, so `effect` staying `'regular'` there is consistent with keeping
  // that card pinned and stable.
  const glassEffect = isBloom ? 'clear' : 'regular';
  const base: ReactNode = isLiquidGlassSupported ? (
    <LiquidGlassView
      // `key={remountToken}` is the first-paint re-sample fix above: it stays
      // `0` (never remounts) for every surface but a `bloom` one, and flips
      // exactly once, on a post-mount frame, for a `bloom` surface — forcing
      // a fresh native view that lays out (and samples) in this surface's
      // real, final position rather than wherever it was when first
      // measured.
      key={remountToken}
      // The app is dark-only (native chrome is pinned dark via
      // `UIUserInterfaceStyle`), so the glass material samples its backdrop
      // under a fixed dark interface style — no scheme flip to repaint for.
      effect={glassEffect}
      colorScheme="dark"
      tintColor={tint}
      animated={false}
      style={[RNStyleSheet.absoluteFill, { borderRadius: theme.radii[radius] }]}
      testID={testID && `${testID}-base`}
    />
  ) : (
    <View style={[RNStyleSheet.absoluteFill, fallbackFill]} testID={testID && `${testID}-base`} />
  );
  // The flat wash: an `absoluteFill` sibling layered OVER the base, below
  // `children`. A plain colored `View`, not a gradient — see the `tint` prop
  // docs for why this is a fresh child element rather than an inline style
  // folded onto the parent's own style array. Two fills share this one layer
  // (see `resolveWashFill` above): the entity-color tint (both paths,
  // unconditionally), or `translucentStrong`'s neutral dark overlay — but
  // the LATTER only on the real glass path (`isLiquidGlassSupported`), since
  // that is the only path the backdrop-alpha bump alone failed to darken; the
  // non-glass fallback's own base already renders the stronger fill directly.
  const washFill = resolveWashFill(tint, isStrong, isLiquidGlassSupported);
  const wash: ReactNode = washFill && (
    <View style={[RNStyleSheet.absoluteFill, washFill]} testID={testID && `${testID}-wash`} />
  );

  return (
    <View ref={surfaceRef} style={[styles.surface, edge, sizing, style]} testID={testID} {...props}>
      {backdrop}

      {base}

      {wash}

      {children}
    </View>
  );
};

export default GlassSurface;
