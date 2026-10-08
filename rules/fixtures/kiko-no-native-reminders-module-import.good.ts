// Semgrep fixture (NEGATIVE): kiko-architecture's "Native iOS shell". Nothing
// here loads the reminders TurboModule spec at run time, so
// `kiko-no-native-reminders-module-import` (and every other rule) MUST report
// zero findings.

// Type-only imports and re-exports are erased by Babel.
import type { Spec } from '../../src/reminders/native/NativeKikoReminders';
import type NativeModuleInstance from '../../src/reminders/native/NativeKikoReminders';
// biome-ignore format: OVERRIDE(pattern-regex probe) the rule's regex must skip `import` and `type` split by several spaces
import   type { Spec as SpacedSpec } from '../../src/reminders/native/NativeKikoReminders';

export type { Spec as ReExportedSpec } from '../../src/reminders/native/NativeKikoReminders';

// The wrapper's barrel is the sanctioned way in.
import { remindersNative } from '../../src/reminders/native';

// Jest names the file to mock it; it never loads the real module this way.
jest.mock('../../src/reminders/native/NativeKikoReminders');
jest.doMock('../../src/reminders/native/NativeKikoReminders', () => ({}));

const mockedNativeModule = jest.requireMock('../../src/reminders/native/NativeKikoReminders') as {
  default: Spec;
};

// Prose that says import, then a quoted path on a later line: not a statement.
export const describedPath = "copied from '../../src/reminders/native/NativeKikoReminders'";

export const usedBindings: [
  typeof remindersNative,
  Spec,
  typeof NativeModuleInstance | undefined,
  SpacedSpec | undefined,
] = [remindersNative, mockedNativeModule.default, undefined, undefined];
