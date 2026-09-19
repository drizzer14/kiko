// Type for the native `KikoTestEnv` constants module
// (`ios/Kiko/KikoTestEnv.swift` + `KikoTestEnv.m`). Exports two booleans
// computed once, at native launch, from `ProcessInfo.processInfo.arguments` —
// see `ui-test-capture.ts` for the JS-side reader that consumes this shape.
// `NativeModules`'s own ambient type (`NativeModulesStatic`) is an untyped
// index signature, so this type exists purely to give the reader's own
// `NativeModules.KikoTestEnv` cast something concrete instead of `any`.
export type KikoTestEnvModule = {
  stableGlass: boolean;
  uiTestCapture: boolean;
};
