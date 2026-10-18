// Semgrep fixture (POSITIVE): kiko-design-system's Component set (Screen).
// `resolveBottomClearance` is pane-blind, so only the Screen folder may import
// it. `kiko-no-pane-blind-bottom-clearance` MUST report a finding on every
// pinned line below: each one loads the function, or its module file, from
// outside `src/design-system/components/screen/`.

// A named import from the module file, by alias.
// EXPECT-FINDING
import { resolveBottomClearance } from '@kiko/design-system/components/screen/bottom-clearance';

export const aliasedClearance = resolveBottomClearance(80, 34, 'bottom');

// A named import with an alias binding, from the Screen barrel. The barrel does
// not export the function today; the rule guards a future re-export.
// @ts-expect-error: the Screen barrel does not export the function
// EXPECT-FINDING
import { resolveBottomClearance as pickClearance } from '@kiko/design-system/components/screen';

export const barrelClearance = pickClearance(80, 34, 'bottom');

// A clause spread over several lines.
// EXPECT-FINDING
import {
  resolveBottomClearance as multiLineClearance,
} from '../../src/design-system/components/screen/bottom-clearance';

export const multiLine = multiLineClearance(80, 34, 'bottom');

// A relative import of the module file, naming no function.
// EXPECT-FINDING
import * as clearanceModule from '../../src/design-system/components/screen/bottom-clearance';

export const moduleBinding = clearanceModule;

// A bare side-effect load of the module file.
// EXPECT-FINDING
import '../../src/design-system/components/screen/bottom-clearance';

// A value re-export of the function.
// EXPECT-FINDING
export { resolveBottomClearance as reExportedClearance } from '../../src/design-system/components/screen/bottom-clearance';

// A CommonJS load of the module file.
// EXPECT-FINDING
export const requiredClearance = require('../../src/design-system/components/screen/bottom-clearance').resolveBottomClearance;

// A dynamic load of the module file.
// EXPECT-FINDING
export const loadClearanceLater = () => import('../../src/design-system/components/screen/bottom-clearance');
