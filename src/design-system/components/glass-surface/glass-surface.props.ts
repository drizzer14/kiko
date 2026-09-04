import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

type GlassRadius = 'md' | 'lg';

export type GlassSurfaceProps = ViewProps & {
  children?: ReactNode;
  padding?: number;
  radius?: GlassRadius;
  // An optional 45deg entity-color gradient wash for the surface: its two
  // rgba() stops (see `entityGradientStops` in `design-system/entity-tint.ts`)
  // — the flat `entityTintBackground` wash as `from`, the same wash over a
  // slightly lighter version of the same hue as `to` — plus the single shared
  // `opacity` both stops render at. Rendered as a `react-native-svg`
  // `<LinearGradient>` filling the surface, absolutely positioned BEHIND
  // `children` and clipped to the surface's own rounded corners by
  // `styles.surface`'s `overflow: hidden`. It is a normal child element, not a
  // foreign inline style appended to the style array, so — unlike the flat
  // `tint` background this replaced — there is no ShadowNode-reconciliation
  // gap to route around: it paints on the first frame the same way `children`
  // always has.
  //
  // `opacity` is passed to each `<Stop>`'s `stopOpacity` prop SEPARATELY from
  // its `stopColor` — react-native-svg's native gradient extractor masks off
  // whatever alpha channel is embedded in an rgba() `stopColor` and
  // substitutes `stopOpacity` (defaulting to 1, fully opaque) instead, so an
  // rgba() color alone renders fully opaque regardless of its own alpha. This
  // was the "gradient renders as a bright solid color instead of a subtle
  // wash" bug (design review round 2) — `from`/`to` alone were never enough.
  gradient?: { from: string; to: string; opacity: number };
  // Draws the shared card edge: a hairline separator border in the theme's
  // `border` token. Routed through a Unistyles-managed style member inside the
  // component (not a plain inline `borderWidth`/`borderColor`) for the same
  // ShadowNode-reconciliation reason as `tint`: a foreign inline border is not
  // written to the native node until the next React commit, so it appears only
  // intermittently on the first paint. Routing it through the managed style
  // makes the border land on the first frame every time (G2).
  bordered?: boolean;
};
