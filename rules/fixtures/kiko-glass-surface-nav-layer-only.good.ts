// Semgrep fixture (NEGATIVE): a content-layer module reads `Card`, the
// solid, bordered content surface — never `GlassSurface`, which is reserved
// for the navigation layer. `kiko-glass-surface-nav-layer-only` MUST report
// nothing here.

import Card from '@kiko/design-system/components/card';

export const contentLayerSurface = Card;
