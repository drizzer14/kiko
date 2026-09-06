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
  // Opts a tint-LESS glass surface into the opaque themed backdrop that a
  // tinted card gets automatically (see `GlassSurface`'s `backdrop`). It paints
  // the same neutral `styles.opaqueBase` fill UNDER the glass so the
  // translucent material samples a CONSTANT color instead of live screen
  // content — the anti-drift/anti-pop-in fix — but adds NO color wash, so the
  // card stays visually neutral. Use it for a neutral card that must not drift
  // or pop in (the settings categories card) but must not carry an entity
  // color either. Ignored on the non-glass fallback path (its base already IS
  // opaque) and redundant when a `tint` is set (a tint enables the backdrop on
  // its own). Defaults to `false`.
  solidBackdrop?: boolean;
  // Draws the shared card edge: a hairline separator border in the theme's
  // `border` token. Routed through a Unistyles-managed style member inside the
  // component (not a plain inline `borderWidth`/`borderColor`) for the same
  // ShadowNode-reconciliation reason as `tint`: a foreign inline border is not
  // written to the native node until the next React commit, so it appears only
  // intermittently on the first paint. Routing it through the managed style
  // makes the border land on the first frame every time (G2).
  bordered?: boolean;
};
