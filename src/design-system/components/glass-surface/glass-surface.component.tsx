import { isLiquidGlassSupported, LiquidGlassView } from '@callstack/liquid-glass';
import type { FC, ReactNode } from 'react';
import { StyleSheet as RNStyleSheet, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { GlassSurfaceProps } from './glass-surface.props';
import { styles } from './glass-surface.styles';

// Extracted to keep the component's own cognitive complexity down: the
// backdrop fill has a strict precedence — an entity `tint` (opaque) beats
// `translucentStrong` (the stronger 0.80-alpha pin), which beats `transparent`
// (the softer 0.60-alpha pin), which beats no backdrop at all (a plain or
// `material` surface).
const resolveBackdropFill = (
  tint: string | undefined,
  isStrong: boolean,
  isTransparent: boolean,
) => {
  if (tint !== undefined) return styles.opaqueBase;
  if (isStrong) return styles.strongTranslucentBase;
  if (isTransparent) return styles.translucentBase;
  return false;
};

// Same precedence idea for the non-glass fallback fill: `translucentStrong`'s
// stronger pin beats `transparent`/`material`'s shared translucent fill, which
// beats the opaque themed base a plain surface falls back to.
const resolveFallbackFill = (isStrong: boolean, isTransparent: boolean, isMaterial: boolean) => {
  if (isStrong) return styles.strongTranslucentBase;
  if (isTransparent || isMaterial) return styles.translucentBase;
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
  // `transparent` is a NEUTRAL-surface variant, so a `tint` (an entity card)
  // always wins over it — the two are contradictory and a tinted card must stay
  // opaque.
  const isTransparent = transparent && tint === undefined;
  // `translucentStrong` is a NEUTRAL variant too (the middle option between
  // `transparent` and an opaque `tint` card), so a `tint` wins over it for the
  // same reason.
  const isStrong = translucentStrong && tint === undefined;
  // `material` is the live-blur variant (see the prop doc): a `tint` wins over
  // it too, for the same reason. It never adds a backdrop (see `backdropFill`
  // below, which `material` deliberately does not feed) — only the FALLBACK
  // fill (`fallbackFill` below) reads it, so the glass path is byte-for-byte
  // the same "no backdrop, live sample" tree a plain surface already renders.
  const isMaterial = material && tint === undefined;
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
  //     and keeps the fully-live see-through material.
  // The fallback (non-glass) branch needs no backdrop: its own base IS the flat
  // themed fill (see `base`). See `resolveBackdropFill` above for the exact
  // precedence.
  const backdropFill = resolveBackdropFill(tint, isStrong, isTransparent);
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
  // path's backdrop. See `resolveFallbackFill` above for the exact precedence.
  const fallbackFill = resolveFallbackFill(isStrong, isTransparent, isMaterial);
  const base: ReactNode = isLiquidGlassSupported ? (
    <LiquidGlassView
      // The app is dark-only (native chrome is pinned dark via
      // `UIUserInterfaceStyle`), so the glass material samples its backdrop
      // under a fixed dark interface style — no scheme flip to repaint for.
      effect="regular"
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
    <View style={[styles.surface, edge, sizing, style]} testID={testID} {...props}>
      {backdrop}

      {base}

      {wash}

      {children}
    </View>
  );
};

export default GlassSurface;
