// Semgrep fixture (NEGATIVE): kiko-design-system's Component set (Screen).
// Nothing here loads `useTabBarPlacement` or its module file at run time from outside the
// Screen and pane-stack-view folders, so
// `kiko-tab-bar-placement-only-in-screen-and-pane-stack-view` (and every other rule) MUST
// report zero findings.

// The sanctioned way in for a screen is Screen itself.
import Screen from '@kiko/design-system/components/screen';

// A type-only re-export is erased by Babel.
export type { useTabBarPlacement as ReExportedPlacement } from '@kiko/design-system/components/screen/use-tab-bar-placement';

// Jest names the file to mock it; it never loads the real module this way.
jest.mock('@kiko/design-system/components/screen/use-tab-bar-placement');
jest.mock('@kiko/design-system/components/screen/use-is-tab-bar-at-top');

// A type-only re-export of the boolean hook is erased too.
export type { useIsTabBarAtTop as ReExportedAtTop } from '@kiko/design-system/components/screen/use-is-tab-bar-at-top';

jest.mock('@kiko/design-system/components/screen/use-is-tab-bar-not-at-bottom');

// A type-only re-export of the not-at-the-bottom hook is erased too.
export type { useIsTabBarNotAtBottom as ReExportedNotAtBottom } from '@kiko/design-system/components/screen/use-is-tab-bar-not-at-bottom';

// Prose that names the hook or the file is not an import statement.
export const placementDescription = "see useTabBarPlacement in '../screen/use-tab-bar-placement'";

export const usedScreen: typeof Screen = Screen;
