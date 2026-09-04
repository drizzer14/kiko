import type { FC, ReactNode } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { StyleSheet as RNStyleSheet, View } from 'react-native';
import { isLiquidGlassSupported, LiquidGlassView } from '@callstack/liquid-glass';
import GradientWash from './gradient-wash';
import { styles } from './glass-surface.styles';
import type { GlassSurfaceProps } from './glass-surface.props';

// A shared surface for card-like grouping (accounts list, settings sections):
// real Liquid Glass material on iOS 26+, a themed flat surface everywhere
// else. isLiquidGlassSupported renders LiquidGlassView as a plain View with
// no effect on unsupported iOS, so the fallback background/radius below is
// still required in that branch, not only in the explicit `else`.
//
// The surface is composed as stacked `absoluteFill` layers inside one plain
// parent `View`, painted back-to-front:
//   1. the `backdrop` (glass path, tinted cards only) — an opaque themed
//      `View` painted UNDER the glass so the translucent backdrop-sampling
//      material refracts a FIXED color instead of live screen content;
//   2. the base — the Liquid Glass material (glass path) or the flat themed
//      background (fallback path), a layer with NO children;
//   3. the `wash` — the entity-color gradient, a SIBLING drawn OVER the base;
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
//     library's own `tintColor` prop (fed the card's own `gradient.from`), a
//     fixed tint that no recomposite can wash out;
//   - a tinted card also gets the opaque `backdrop` layer UNDER the glass, so
//     the material samples a constant color, not the live screen — pinning the
//     card's lightness across scroll/reorder/navigation. Gradient-less
//     surfaces (settings/statistics sections) keep the see-through live glass:
//     they carry no entity tint and are not the unstable-card case.
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
// contentView. It stays as a subtle diagonal accent over the now-stable base.
const GlassSurface: FC<GlassSurfaceProps> = ({
  children,
  style,
  padding,
  radius = 'md',
  gradient,
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
  // The opaque backdrop UNDER the glass, for a tinted entity card only (a
  // `gradient` is set). It pins what the translucent glass samples to a fixed
  // color so the card's lightness cannot drift on recomposite (see the block
  // comment). A gradient-less glass surface renders NO backdrop and keeps the
  // live see-through material. The fallback (non-glass) branch needs no
  // backdrop: its base already IS the opaque themed surface.
  const backdrop: ReactNode = isLiquidGlassSupported && gradient !== undefined && (
    <View
      style={[RNStyleSheet.absoluteFill, styles.opaqueBase]}
      testID={testID && `${testID}-backdrop`}
    />
  );
  // The base fill: the real glass material where supported, the flat themed
  // surface otherwise. An `absoluteFill` sibling with NO children, so the wash
  // is never inserted into the glass contentView (see the block comment above).
  // The entity color is composited into the material via `tintColor` (fed the
  // card's own `gradient.from`, `undefined` for a plain surface), and
  // `animated={false}` stops the frost-in replaying on remount (drag pickup).
  // The glass layer carries its OWN `borderRadius`: iOS computes the glass
  // material's corners from the glass view's own corner config, so the parent's
  // `overflow: hidden` mask alone hard-crops a SQUARE box — the glass needs the
  // radius directly to round its material. The flat fallback has no
  // corner-aware rendering, so the parent mask is enough there.
  const base: ReactNode = isLiquidGlassSupported ? (
    <LiquidGlassView
      effect="regular"
      colorScheme="dark"
      tintColor={gradient?.from}
      animated={false}
      style={[RNStyleSheet.absoluteFill, { borderRadius: theme.radii[radius] }]}
      testID={testID && `${testID}-base`}
    />
  ) : (
    <View
      style={[RNStyleSheet.absoluteFill, styles.opaqueBase]}
      testID={testID && `${testID}-base`}
    />
  );
  // The gradient wash: an `absoluteFill` sibling layered OVER the base, below
  // `children`. Rendered as a plain element (not a style-prop hack).
  const wash: ReactNode = gradient !== undefined && (
    <GradientWash gradient={gradient} testID={testID} />
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
