// Semgrep fixture (NEGATIVE): kiko-architecture's "Native iOS shell". Nothing
// here loads the display-regions TurboModule spec at run time, so
// `kiko-no-native-display-regions-module-import` (and every other rule) MUST
// report zero findings.

// Type-only imports and re-exports are erased by Babel.
import type { Spec } from '../../src/native-specs/NativeDisplayRegions';
import type NativeModuleInstance from '../../src/native-specs/NativeDisplayRegions';
// biome-ignore format: OVERRIDE(pattern-regex probe) the rule's regex must skip `import` and `type` split by several spaces
import   type { Spec as SpacedSpec } from '../../src/native-specs/NativeDisplayRegions';

export type { Spec as ReExportedSpec } from '../../src/native-specs/NativeDisplayRegions';

// The wrapper's barrel is the sanctioned way in.
import { displayRegionsNative } from '../../src/display-regions';

// Jest names the file to mock it; it never loads the real module this way.
jest.mock('../../src/native-specs/NativeDisplayRegions');
jest.doMock('../../src/native-specs/NativeDisplayRegions', () => ({}));

const mockedNativeModule = jest.requireMock('../../src/native-specs/NativeDisplayRegions') as {
  default: Spec;
};

// Prose that says import, then a quoted path on a later line: not a statement.
export const describedPath = "copied from '../../src/native-specs/NativeDisplayRegions'";

export const usedBindings: [
  typeof displayRegionsNative,
  Spec,
  typeof NativeModuleInstance | undefined,
  SpacedSpec | undefined,
] = [displayRegionsNative, mockedNativeModule.default, undefined, undefined];
