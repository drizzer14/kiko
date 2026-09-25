// Semgrep fixture (POSITIVE): kiko-design-system's "Component set
// (GlassSurface)" — `GlassSurface` renders Apple's Liquid Glass material,
// reserved for the NAVIGATION layer (the tab bar, `BottomSheet`, the
// keyboard "Done" accessory, the Home add-transaction FAB). A content-layer
// module reaches for `Card` instead. `kiko-glass-surface-nav-layer-only`
// MUST report a finding on the pinned line below — this file's own path is
// not on the nav-layer allowlist. Deliberately no keyword the rule's
// `pattern-regex` matches appears earlier in this comment block, since the
// pattern's `[^;]*` spans newlines up to the first semicolon.

// EXPECT-FINDING
import GlassSurface from '../../src/design-system/components/glass-surface';

export const glassSurfaceOutsideNavLayer = GlassSurface;
