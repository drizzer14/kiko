import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Shared by both the liquid-glass branch and the plain-View fallback so
  // children always clip to the surface's rounded corners.
  surface: {
    overflow: 'hidden',
  },
  // The opaque themed base, used in two places:
  //   - the non-glass fallback branch (isLiquidGlassSupported === false),
  //     where there is no native glass material to supply a background;
  //   - the constant backdrop painted UNDER the real glass for a tinted
  //     entity card (a `gradient` is set), so the translucent
  //     backdrop-sampling glass refracts a FIXED opaque color instead of
  //     whatever live screen content sits behind the card. Sampling live
  //     content was the root cause of the card tint shifting lightness on
  //     scroll/reorder/navigation — a constant backdrop pins it.
  opaqueBase: {
    backgroundColor: theme.colors.surface,
  },
  // The translucent themed base, used in two matching places for the
  // `transparent` frosted-panel variant so the glass and non-glass paths read
  // alike (see `GlassSurface`'s `transparent` prop):
  //   - the translucent backdrop painted UNDER the real glass, so the material
  //     samples a PARTIALLY-pinned color and the screen behind reads through;
  //   - the flat fill on the non-glass fallback branch, so that path is
  //     see-through too rather than a solid block.
  // The `surfaceTranslucent` token composites over the true-black background to
  // a very dark tone, so white body text stays legible on it.
  translucentBase: {
    backgroundColor: theme.colors.surfaceTranslucent,
  },
  // The card edge, applied when `bordered` is set. A Unistyles-managed member
  // (not a plain inline object) for the same reason as `tinted`: Unistyles
  // writes it straight to the native ShadowNode, so the hairline separator
  // paints on the first frame rather than intermittently after a re-render
  // (G2). Uses the theme's `border` separator token at the iOS hairline width.
  bordered: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
}));
