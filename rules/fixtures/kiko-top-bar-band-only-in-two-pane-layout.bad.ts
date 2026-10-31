// Semgrep fixture (POSITIVE): kiko-design-system's Component set (Screen).
// `useTopBarBand` is the top clearance read as a window band, and `TwoPaneLayout` already
// starts each pane below it, so only the Screen folder and the two-pane-layout folder may
// import it. `kiko-top-bar-band-only-in-two-pane-layout` MUST report a finding on every
// pinned line below.

// A named import from the Screen barrel.
// EXPECT-FINDING
import { useTopBarBand } from '@kiko/design-system/components/screen';

export const barrelBand = useTopBarBand;

// The hook under an alias, from its module file.
// EXPECT-FINDING
import { useTopBarBand as useBand } from '@kiko/design-system/components/screen/use-top-bar-band';

export const aliasedBand = useBand;

// A clause spread over several lines.
// EXPECT-FINDING
import {
  useTopBarBand as multiLineBand,
} from '../../src/design-system/components/screen/use-top-bar-band';

export const multiLine = multiLineBand;

// The module file, loaded by namespace, naming no function.
// EXPECT-FINDING
import * as bandModule from '../../src/design-system/components/screen/use-top-bar-band';

export const bandModuleBinding = bandModule;

// A bare side-effect load of the module file.
// EXPECT-FINDING
import '../../src/design-system/components/screen/use-top-bar-band';

// A value re-export of the hook through the barrel.
// EXPECT-FINDING
export { useTopBarBand as reExportedBand } from '@kiko/design-system/components/screen';

// A CommonJS load of the module file.
// EXPECT-FINDING
export const requiredBand = require('../../src/design-system/components/screen/use-top-bar-band').useTopBarBand;

// A dynamic load of the module file.
// EXPECT-FINDING
export const loadBandLater = () => import('../../src/design-system/components/screen/use-top-bar-band');
