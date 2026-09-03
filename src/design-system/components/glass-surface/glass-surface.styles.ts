import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Shared by both the liquid-glass branch and the plain-View fallback so
  // children always clip to the surface's rounded corners.
  surface: {
    overflow: 'hidden',
  },
  // Only applied on the fallback branch (isLiquidGlassSupported === false),
  // where there is no native glass material to supply a background.
  fallback: {
    backgroundColor: theme.colors.surface,
  },
  // The entity-color wash, applied when `tint` is set. A Unistyles-managed
  // dynamic member (not a plain inline object): this keeps the tint inside the
  // set of styles Unistyles writes to the native ShadowNode, so it paints on
  // the first frame rather than only after a re-render — see the `tint` prop.
  tinted: (background: string) => ({
    backgroundColor: background,
  }),
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
