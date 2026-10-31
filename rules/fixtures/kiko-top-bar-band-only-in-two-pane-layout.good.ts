// Semgrep fixture (NEGATIVE): kiko-design-system's Component set (Screen).
// Nothing here loads `useTopBarBand` or its module file at run time from outside the Screen
// and two-pane-layout folders, so `kiko-top-bar-band-only-in-two-pane-layout` (and every
// other rule) MUST report zero findings.

// The sanctioned way in for a screen is Screen itself.
import Screen from '@kiko/design-system/components/screen';

// A type-only re-export is erased by Babel.
export type { useTopBarBand as ReExportedBand } from '@kiko/design-system/components/screen/use-top-bar-band';

// Jest names the file to mock it; it never loads the real module this way.
jest.mock('@kiko/design-system/components/screen/use-top-bar-band');

// Prose that names the hook or the file is not an import statement.
export const bandDescription = "see useTopBarBand in '../screen/use-top-bar-band'";

export const usedScreen: typeof Screen = Screen;
