import { NativeModules } from 'react-native';

import type { KikoTestEnvModule } from './native-test-env';

// The native module (`ios/Kiko/KikoTestEnv.swift` + `KikoTestEnv.m`) exports
// two constants computed once, at launch, from
// `ProcessInfo.processInfo.arguments`. It is absent on every Jest run and on
// any build predating its native wiring — `NativeModules.KikoTestEnv` is then
// `undefined`, and both predicates below fail safe to `false`, exactly the
// production behaviour: a normally-launched Release build (no `-kikoStableGlass`
// / `-kikoUiTestCapture` launch argument) always reads `false` for both.
const nativeTestEnv = (): KikoTestEnvModule | undefined =>
  (NativeModules as { KikoTestEnv?: KikoTestEnvModule }).KikoTestEnv;

// True only in a regression-capture build launched with `-kikoStableGlass`
// (see `GlassSurface`'s opaque-surface branch). Never true in a build a user
// can install from the App Store — the launch argument is reachable only by a
// harness (Maestro/Xcode/devicectl) with dev control of the launch.
export const isStableGlassCapture = (): boolean => nativeTestEnv()?.stableGlass === true;

// True only in a capture build launched with `-kikoUiTestCapture` (see
// `useAppLock`'s `promptOnMount`). Same production-safety note as above.
export const isUiTestCapture = (): boolean => nativeTestEnv()?.uiTestCapture === true;
