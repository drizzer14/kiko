import type { UnistylesThemes } from 'react-native-unistyles';
import { StyleSheet } from 'react-native-unistyles';

// The registered app theme — same pattern as disabled-field-style.ts's
// `AppTheme`: a plain function needs the concrete theme shape to compute a
// value shared between this StyleSheet (which receives `theme` from
// Unistyles) and the component itself (which reads `theme` via
// `useUnistyles()` to size its `Svg`, a runtime prop the StyleSheet cannot
// supply).
type AppTheme = UnistylesThemes[keyof UnistylesThemes];

// The squircle tile's fixed side length — roomy enough to hold the default
// `body` glyph (20pt, see theme.ts) with generous internal padding around it,
// the iOS Settings icon-tile proportion. Derived from the shared spacing
// scale (`theme.spacing(9)` = 36), never a bare literal, per the
// design-system skill's "spacing comes from the shared scale" rule. Exported
// so the component's own `Svg` width/height (a runtime prop, not a style —
// react-native-svg has no percentage-of-parent sizing here) stays in
// lockstep with this StyleSheet's own tile size.
export const iconTileSize = (theme: AppTheme): number => theme.spacing(9);

export const styles = StyleSheet.create((theme) => ({
  // The tile's own box: fixed square, clipped to the squircle radius so
  // nothing (the gradient fill, a mis-measured child) ever paints past the
  // rounded corners. `theme.radii.md` is the closest token on the shared
  // radius scale to the iOS continuous-corner "squircle" proportion at this
  // tile size — never an invented radius value. The hairline `borderWidth` +
  // `specularRim` token is the STATIC glass-edge border (see the token's own
  // doc comment in `theme.ts`): a thin, bright white rim imitating the
  // specular edge a real iOS app-icon glass material catches, deliberately a
  // plain styled border rather than the real `@callstack/liquid-glass` (see
  // the design-system skill's "Glass border on entity icon tiles" note) — it
  // reads identically regardless of the tile's own entity-color gradient
  // underneath, unlike `GlassSurface`'s neutral-gray `border` token.
  tile: {
    width: iconTileSize(theme),
    height: iconTileSize(theme),
    borderRadius: theme.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.specularRim,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The gradient `Svg` sits UNDER the glyph as an absolutely-positioned
  // sibling filling the tile, the same layering shape `GlassSurface`'s own
  // backdrop/wash layers use (a base fill, then the icon on top) — never a
  // second, competing way to stack a background under content.
  gradientFill: {
    position: 'absolute',
  },
}));
