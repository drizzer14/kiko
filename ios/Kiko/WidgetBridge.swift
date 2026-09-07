import Foundation
import React
import WidgetKit

/// Bridges the JS `widgetBridge` wrapper (`src/widget/widget-bridge.ts`) to the
/// `KikoWidget` WidgetKit extension. It writes the serialized net-worth snapshot
/// into the App Group container the extension shares with the main app, then
/// asks WidgetKit to reload the extension's timelines.
///
/// No bridging header exists in this project (see `AppDelegate.swift`): the
/// React-Core pod defines its own module map, so `import React` alone exposes
/// the Objective-C `RCTPromiseResolveBlock` / `RCTPromiseRejectBlock` typedefs
/// used below without one.
@objc(WidgetBridge)
class WidgetBridge: NSObject {
  /// Must match the App Group id enabled on the `Kiko` target's entitlements
  /// (Task 6, Step 2) and on the `KikoWidget` extension target (Task 7).
  private static let appGroupID = "group.com.dmytro-vasylkivskyi.kiko"

  /// The file the `KikoWidget` extension reads its timeline data from.
  private static let snapshotFileName = "net-worth-snapshot.json"

  @objc static func requiresMainQueueSetup() -> Bool {
    false
  }

  /// Writes the raw JSON string into the shared App Group container. Resolves
  /// with `nil` on success. Never logs `json` — it encodes the user's net
  /// worth.
  @objc func writeSnapshot(
    _ json: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard
      let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: Self.appGroupID
      )
    else {
      reject("write_error", "App Group container is unavailable", nil)
      return
    }

    let fileURL = containerURL.appendingPathComponent(Self.snapshotFileName)

    do {
      try json.write(to: fileURL, atomically: true, encoding: .utf8)
      resolve(nil)
    } catch {
      reject("write_error", "Failed to write the widget snapshot", error)
    }
  }

  /// Asks WidgetKit to reload the `KikoWidget` extension's timelines so it
  /// picks up the freshly written snapshot.
  @objc func reloadWidget() {
    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
