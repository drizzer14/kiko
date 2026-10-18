// Semgrep fixture (POSITIVE): kiko-architecture's "Native iOS shell". The
// reminders TurboModule spec throws at module load on a binary built without
// the module, so only the wrapper may load it, lazily on first use.
// `kiko-no-native-reminders-module-import` MUST report a finding on every
// pinned line below: each one loads the spec from outside the wrapper.

// A default value binding.
// EXPECT-FINDING
import NativeKikoReminders from '../../src/native-specs/NativeKikoReminders';

export const defaultBinding = NativeKikoReminders;

// The alias form app code writes.
// EXPECT-FINDING
import { default as AliasedNativeModule } from '@kiko/native-specs/NativeKikoReminders';

export const aliasedBinding = AliasedNativeModule;

// A mixed clause still loads the module, even with a type member in it.
// EXPECT-FINDING
import { type Spec, default as MixedNativeModule } from '../../src/native-specs/NativeKikoReminders';

export const mixedBinding: Spec = MixedNativeModule;

// A clause spread over several lines, naming the file with its extension.
// EXPECT-FINDING
import {
  default as MultiLineNativeModule,
} from '../../src/native-specs/NativeKikoReminders.ts';

export const multiLineBinding = MultiLineNativeModule;

// A bare side-effect load.
// EXPECT-FINDING
import '../../src/native-specs/NativeKikoReminders';

// A value re-export.
// EXPECT-FINDING
export { default as ReExportedNativeModule } from '../../src/native-specs/NativeKikoReminders';

// A CommonJS load outside the wrapper.
// EXPECT-FINDING
export const requiredNativeModule: Spec = require('../../src/native-specs/NativeKikoReminders').default;

// A dynamic load.
// EXPECT-FINDING
export const loadNativeModuleLater = () => import('../../src/native-specs/NativeKikoReminders');
