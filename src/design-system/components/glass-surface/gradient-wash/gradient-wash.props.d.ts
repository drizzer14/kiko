import type { GlassSurfaceProps } from '../glass-surface.props';

export type GradientWashProps = {
  // The resolved two-stop entity gradient. Reuses `GlassSurface`'s own
  // `gradient` type (unwrapped from its optional) so the shape stays defined in
  // exactly one place — the wash is only ever rendered once `gradient` is set,
  // so here it is required, not optional.
  gradient: NonNullable<GlassSurfaceProps['gradient']>;
  // Suffixed onto the `<Svg>`/`<Stop>`/`<Rect>` testIDs so a test can assert the
  // resolved stop colors and the fixed viewBox without reaching into native SVG
  // internals.
  testID?: string;
};
