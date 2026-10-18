// Semgrep fixture (POSITIVE): kiko-architecture's "Native iOS shell". The
// display-regions TurboModule spec throws at module load on a binary built
// without the module, so only the wrapper may load it, lazily on first use.
// `kiko-no-native-display-regions-module-import` MUST report a finding on
// every pinned line below: each one loads the spec from outside the wrapper.

// A default value binding.
// EXPECT-FINDING
import NativeDisplayRegions from '../../src/native-specs/NativeDisplayRegions';

export const defaultBinding = NativeDisplayRegions;

// The alias form app code writes.
// EXPECT-FINDING
import { default as AliasedNativeModule } from '@kiko/native-specs/NativeDisplayRegions';

export const aliasedBinding = AliasedNativeModule;

// A mixed clause still loads the module, even with a type member in it.
// EXPECT-FINDING
import { type Spec, default as MixedNativeModule } from '../../src/native-specs/NativeDisplayRegions';

export const mixedBinding: Spec = MixedNativeModule;

// A clause spread over several lines, naming the file with its extension.
// EXPECT-FINDING
import {
  default as MultiLineNativeModule,
} from '../../src/native-specs/NativeDisplayRegions.ts';

export const multiLineBinding = MultiLineNativeModule;

// A bare side-effect load.
// EXPECT-FINDING
import '../../src/native-specs/NativeDisplayRegions';

// A value re-export.
// EXPECT-FINDING
export { default as ReExportedNativeModule } from '../../src/native-specs/NativeDisplayRegions';

// A CommonJS load outside the wrapper.
// EXPECT-FINDING
export const requiredNativeModule: Spec = require('../../src/native-specs/NativeDisplayRegions').default;

// A dynamic load.
// EXPECT-FINDING
export const loadNativeModuleLater = () => import('../../src/native-specs/NativeDisplayRegions');
