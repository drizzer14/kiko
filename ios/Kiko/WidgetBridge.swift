import Foundation
import React
import WidgetKit

/// Bridges the JS `widgetBridge` wrapper (`src/widget/widget-bridge.ts`) to the
/// `KikoWidget` WidgetKit extension. It writes the serialized net-worth snapshot
/// into the App Group container the extension shares with the main app — or
/// deletes it again while the app lock is on — then asks WidgetKit to reload the
/// extension's timelines.
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

  /// Writes `json` to `fileURL`, then re-applies its two at-rest protections:
  /// `.completeUntilFirstUserAuthentication` and `isExcludedFromBackup`. Both
  /// MUST be re-applied after every write — `atomically: true` renames a
  /// temporary file into place, and the new inode inherits neither. If either
  /// call throws, the cleartext file is removed before the error is rethrown, so
  /// the failure mode is "no snapshot", never "unprotected snapshot". Why these
  /// two attributes, and why not `.complete`: docs/security/README.md (S2/S3).
  private static func writeProtected(_ json: String, to fileURL: URL) throws {
    try json.write(to: fileURL, atomically: true, encoding: .utf8)

    do {
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: fileURL.path
      )

      var mutableURL = fileURL
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try mutableURL.setResourceValues(values)
    } catch {
      // Best-effort cleanup: an already-absent file (`fileNoSuchFile`) is the
      // desired end state, and no removal failure may mask the hardening error.
      try? FileManager.default.removeItem(at: fileURL)

      throw error
    }
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
      try Self.writeProtected(json, to: fileURL)
      resolve(nil)
    } catch {
      reject("write_error", "Failed to write the widget snapshot", error)
    }
  }

  /// Deletes the snapshot from the shared App Group container — the widget
  /// process has no lock gate (docs/security/README.md, S2/S3). Resolves with
  /// `nil` when the file is gone, including when it was never there.
  ///
  /// The selector is pinned explicitly. With a labelled first parameter Swift
  /// would infer `clearSnapshotWithResolver:rejecter:`, while the
  /// `RCT_EXTERN_METHOD` macro in `WidgetBridge.m` declares
  /// `clearSnapshot:rejecter:` — and `RCTModuleMethod` builds its invocation from
  /// the macro's selector, asserting the module implements exactly that. The two
  /// must match or the first call traps at runtime. `writeSnapshot` above needs
  /// no annotation: its unlabelled first parameter already yields
  /// `writeSnapshot:resolver:rejecter:`.
  @objc(clearSnapshot:rejecter:)
  func clearSnapshot(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard
      let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: Self.appGroupID
      )
    else {
      reject("clear_error", "App Group container is unavailable", nil)
      return
    }

    let fileURL = containerURL.appendingPathComponent(Self.snapshotFileName)

    do {
      try FileManager.default.removeItem(at: fileURL)
      resolve(nil)
    } catch CocoaError.fileNoSuchFile {
      resolve(nil)
    } catch {
      reject("clear_error", "Failed to clear the widget snapshot", error)
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
