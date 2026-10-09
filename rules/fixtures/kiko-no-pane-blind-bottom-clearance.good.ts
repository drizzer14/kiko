// Semgrep fixture (NEGATIVE): kiko-design-system's Component set (Screen).
// Nothing here loads `resolveBottomClearance` or its module file at run time
// from outside the Screen folder, so `kiko-no-pane-blind-bottom-clearance` (and
// every other rule) MUST report zero findings.

// The pane-aware hook is the sanctioned way in.
import Screen, { useBottomClearance } from '@kiko/design-system/components/screen';

// A type-only re-export is erased by Babel.
export type { resolveBottomClearance as ReExportedClearance } from '@kiko/design-system/components/screen/bottom-clearance';

// Jest names the file to mock it; it never loads the real module this way.
jest.mock('@kiko/design-system/components/screen/bottom-clearance');

// Prose that names the function or the file is not an import statement.
export const description = "see resolveBottomClearance in '../screen/bottom-clearance'";

export const usedBindings: [typeof Screen, typeof useBottomClearance] = [
  Screen,
  useBottomClearance,
];
