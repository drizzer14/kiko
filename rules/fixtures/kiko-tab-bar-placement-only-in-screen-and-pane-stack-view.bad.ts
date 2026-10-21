// Semgrep fixture (POSITIVE): kiko-design-system's Component set (Screen).
// `useTabBarPlacement` is a pane-blind window read, so only the Screen folder and the
// pane-stack-view folder may import it.
// `kiko-tab-bar-placement-only-in-screen-and-pane-stack-view` MUST report a finding on every
// pinned line below.

// A named import, from the module file by its package path.
// EXPECT-FINDING
import { useTabBarPlacement } from '@kiko/design-system/components/screen/use-tab-bar-placement';

export const namedPlacement = useTabBarPlacement;

// The hook under an alias, from its module file.
// EXPECT-FINDING
import { useTabBarPlacement as usePlacement } from '@kiko/design-system/components/screen/use-tab-bar-placement';

export const aliasedPlacement = usePlacement;

// A clause spread over several lines.
// EXPECT-FINDING
import {
  useTabBarPlacement as multiLinePlacement,
} from '../../src/design-system/components/screen/use-tab-bar-placement';

export const multiLine = multiLinePlacement;

// The module file, loaded by namespace, naming no function.
// EXPECT-FINDING
import * as placementModule from '../../src/design-system/components/screen/use-tab-bar-placement';

export const placementModuleBinding = placementModule;

// A bare side-effect load of the module file.
// EXPECT-FINDING
import '../../src/design-system/components/screen/use-tab-bar-placement';

// A value re-export of the hook.
// EXPECT-FINDING
export { useTabBarPlacement as reExportedPlacement } from '@kiko/design-system/components/screen/use-tab-bar-placement';

// A CommonJS load of the module file.
// EXPECT-FINDING
export const requiredPlacement = require('../../src/design-system/components/screen/use-tab-bar-placement').useTabBarPlacement;

// A dynamic load of the module file.
// EXPECT-FINDING
export const loadPlacementLater = () => import('../../src/design-system/components/screen/use-tab-bar-placement');

// The boolean hook built on it, from the Screen barrel.
// EXPECT-FINDING
import { useIsTabBarAtTop } from '@kiko/design-system/components/screen';

export const barrelAtTop = useIsTabBarAtTop;

// The boolean hook's module file.
// EXPECT-FINDING
import * as atTopModule from '../../src/design-system/components/screen/use-is-tab-bar-at-top';

export const atTopModuleBinding = atTopModule;
