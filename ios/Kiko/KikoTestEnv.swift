import Foundation

// Tiny constants module for the screenshot/regression capture harness (see
// `src/test-support/ui-test-capture.ts` for the JS-side reader, and the
// screenshot-purge plan's Design §A for the full rationale). Exposes two
// booleans, computed once at launch from the process's own launch arguments,
// so a capture harness (Maestro/Xcode/devicectl) can ask the app to render an
// opaque stable-glass surface and/or suppress the biometric auto-prompt —
// WITHOUT any build-time flag: every build (App Store or capture) ships the
// identical binary, and a normally-launched build (no user, ever, controls
// process launch arguments on their own device) reads both constants `false`.
//
// OPS TODO: this file and `KikoTestEnv.m` are authored but not yet wired —
// add both to the Xcode target's "Kiko" group/target membership, then run
// `pod install` (a plain `RCTBridgeModule` needs no new Podfile entry, but the
// project needs to pick up the new source files) before either constant can
// actually flip.
@objc(KikoTestEnv)
final class KikoTestEnv: NSObject, RCTBridgeModule {
  static func moduleName() -> String! {
    "KikoTestEnv"
  }

  static func requiresMainQueueSetup() -> Bool {
    true
  }

  func constantsToExport() -> [AnyHashable: Any]! {
    let arguments = ProcessInfo.processInfo.arguments

    return [
      "stableGlass": arguments.contains("-kikoStableGlass"),
      "uiTestCapture": arguments.contains("-kikoUiTestCapture"),
    ]
  }
}
