import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

type GlassRadius = 'md' | 'lg';

export type GlassSurfaceProps = ViewProps & {
  children?: ReactNode;
  padding?: number;
  radius?: GlassRadius;
  // An optional entity-color wash for the surface, as a ready-to-apply CSS
  // color string (the `rgba(...)` returned by `entityTintBackground`). It is
  // applied through a Unistyles-managed style member inside the component — not
  // as a plain inline `backgroundColor` appended to the style array — because
  // Unistyles writes the surface's managed style straight to the native
  // ShadowNode and a foreign inline color is not reconciled onto the node until
  // the next React commit, which paints the card transparent on its first frame
  // and only tints it after a re-render. Routing the tint through the managed
  // style makes it land on the first paint.
  tint?: string;
};
