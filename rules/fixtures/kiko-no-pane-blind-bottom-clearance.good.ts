// Semgrep fixture (NEGATIVE): kiko-design-system's Component set (Screen).
// Nothing here loads `resolveBottomClearance` or its module file at run time
// from outside the Screen folder, so `kiko-no-pane-blind-bottom-clearance` (and
// every other rule) MUST report zero findings.

// The pane-aware hook is the sanctioned way in.
import Screen, { useBottomClearance } from '../../src/design-system/components/screen';

// A type-only import is erased by Babel.
import type { resolveBottomClearance } from '../../src/design-system/components/screen/bottom-clearance';

export type { resolveBottomClearance as ReExportedClearance } from '../../src/design-system/components/screen/bottom-clearance';

// Jest names the file to mock it; it never loads the real module this way.
jest.mock('../../src/design-system/components/screen/bottom-clearance');

// Prose that names the function or the file is not an import statement.
export const description = "see resolveBottomClearance in '../screen/bottom-clearance'";

// A module whose name only ends the same way is another module.
import { useBottomClearance as useClearanceHook } from '../../src/design-system/components/screen/use-bottom-clearance';

export const usedBindings: [
  typeof Screen,
  typeof useBottomClearance,
  typeof useClearanceHook,
  typeof resolveBottomClearance | undefined,
] = [Screen, useBottomClearance, useClearanceHook, undefined];
