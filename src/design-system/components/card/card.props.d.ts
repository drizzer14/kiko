import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

// Mirrors `GlassSurface`'s own `GlassRadius` subset (`md`/`lg`/`full`, no
// `sm`) so a caller migrating between the two surfaces (see `Card`'s own doc
// comment) never has to reconcile a different radius vocabulary.
type CardRadius = 'md' | 'lg' | 'full';

export type CardProps = ViewProps & {
  children?: ReactNode;
  padding?: number;
  radius?: CardRadius;
};
