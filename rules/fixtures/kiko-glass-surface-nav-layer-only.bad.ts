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

// A path ending in the component's OWN file, not the bare module directory
// (`glass-surface/glass-surface.component`), which the original regex
// (anchored to end exactly at `glass-surface`) missed entirely.
// EXPECT-FINDING
import GlassSurfaceComponent from '../../src/design-system/components/glass-surface/glass-surface.component';

export const glassSurfaceComponentOutsideNavLayer = GlassSurfaceComponent;

// The statement below restates GlassSurface's default binding through a
// curly-brace clause, using the OTHER leading keyword the rule's
// pattern-regex now covers — the original regex required only the keyword
// the first case above uses. Deliberately no such keyword text appears
// earlier in this block either, for the same reason cited at the top of
// this file.
// EXPECT-FINDING
export { default as ReExportedGlassSurface } from '../../src/design-system/components/glass-surface';

// The alias form. Under the feature rule (B2) a module outside the design
// system reaches the component only through its unit barrel under the
// `@kiko/` alias, so this is the form app code really writes. No leading
// keyword of the rule's pattern-regex appears in this block either.
// EXPECT-FINDING
import AliasedGlassSurface from '@kiko/design-system/components/glass-surface';

export const aliasedGlassSurfaceOutsideNavLayer = AliasedGlassSurface;
