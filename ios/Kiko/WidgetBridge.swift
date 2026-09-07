import Foundation
import React

/// Bridges the JS migration layer (`src/db/migration/`) to the native file
/// system so the one-time old-app -> new-app database import can read the old
/// app's shared App Group container, copy the exported DB across, and clean up
/// the bridge afterwards. These are generic file primitives; nothing here is
/// widget-specific.
///
/// No bridging header exists in this project (see `AppDelegate.swift`): the
/// React-Core pod defines its own module map, so `import React` alone exposes
/// the Objective-C `RCTPromiseResolveBlock` / `RCTPromiseRejectBlock` typedefs
/// used below without one.
@objc(WidgetBridge)
class WidgetBridge: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc func sharedContainerPath(
    _ appGroupID: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    resolve(
      FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
        .path
    )
  }

  @objc func fileExists(
    _ path: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    resolve(FileManager.default.fileExists(atPath: path))
  }

  @objc func deleteFile(
    _ path: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      if FileManager.default.fileExists(atPath: path) {
        try FileManager.default.removeItem(atPath: path)
      }
      resolve(nil)
    } catch {
      reject("delete_error", "Failed to delete file", error)
    }
  }

  @objc func copyFile(
    _ fromPath: String,
    toPath: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      if FileManager.default.fileExists(atPath: toPath) {
        try FileManager.default.removeItem(atPath: toPath)
      }
      try FileManager.default.copyItem(atPath: fromPath, toPath: toPath)
      resolve(nil)
    } catch {
      reject("copy_error", "Failed to copy file", error)
    }
  }

  @objc func readTextFile(
    _ path: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    resolve(try? String(contentsOfFile: path, encoding: .utf8))
  }

  @objc func writeTextFile(
    _ text: String,
    toPath: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      try text.write(toFile: toPath, atomically: true, encoding: .utf8)
      resolve(nil)
    } catch {
      reject("write_error", "Failed to write file", error)
    }
  }
}
