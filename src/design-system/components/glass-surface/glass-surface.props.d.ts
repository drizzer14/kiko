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
  // scrolling card does not apply there. `BottomSheet` is the one consumer
  // today (its `glassFill`); a new consumer should confirm the same static-
  // backdrop condition before reaching for this instead of `transparent`. A
  // `tint` (an entity card, which must stay opaque) always wins over this too,
  // the same as `transparent`. Defaults to `false`.
  material?: boolean;
  // Draws the shared card edge: a hairline separator border in the theme's
  // `border` token. Routed through a Unistyles-managed style member inside the
  // component (not a plain inline `borderWidth`/`borderColor`) for the same
  // ShadowNode-reconciliation reason as `tint`: a foreign inline border is not
  // written to the native node until the next React commit, so it appears only
  // intermittently on the first paint. Routing it through the managed style
  // makes the border land on the first frame every time (G2).
  bordered?: boolean;
};
