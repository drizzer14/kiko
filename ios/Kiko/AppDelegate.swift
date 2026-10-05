import UIKit
import UserNotifications
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  /// Captured here (the one place the system hands it to us) so
  /// SceneDelegate can forward it into `startReactNative`, which is now
  /// called once the scene connects, not from `didFinishLaunchingWithOptions`.
  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    self.launchOptions = launchOptions

    excludeDatabaseFilesFromBackup()
    purgeStoredURLCacheOnce()

    // Before launch finishes, or a tap that cold-launches the app and a
    // background notification action are lost.
    UNUserNotificationCenter.current().delegate = KikoNotificationDelegate.shared

    return true
  }

  // MARK: - Privacy: keep the database out of iCloud / iTunes backups

  /// op-sqlite stores its files in the app's Library directory, which iOS backs
  /// up by default. Mark the encrypted database and its SQLite sidecar files as
  /// excluded, plus any transient plaintext residue. Runs at launch and on every
  /// background transition (via `SceneDelegate.sceneDidEnterBackground` — under
  /// the scene-based lifecycle the app-level `applicationDidEnterBackground` no
  /// longer fires) because JS creates the files lazily; the attribute persists
  /// once set. File names mirror `src/db/encrypted-database.ts`.
  func excludeDatabaseFilesFromBackup() {
    let fileManager = FileManager.default
    guard let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
    let baseNames = ["kiko-encrypted.db", "kiko.db", "pff.db"]
    let suffixes = ["", "-wal", "-shm", "-journal"]
    for baseName in baseNames {
      for suffix in suffixes {
        var url = library.appendingPathComponent(baseName + suffix)
        guard fileManager.fileExists(atPath: url.path) else { continue }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
      }
    }
  }

  // MARK: - Privacy: purge the URL cache once

  private static let urlCachePurgedKey = "kiko.urlCachePurged"

  /// Builds before the `Cache-Control: no-store` request header shipped let
  /// NSURLCache write every Monobank request, X-Token header included, to
  /// Library/Caches/<bundle>/Cache.db; `no-store` stops new rows but never
  /// removes the stored ones. This drops them once per install. The once-key
  /// lives in UserDefaults, not the database: the cache is device-local, so a
  /// restored backup must not skip the purge on a device that still holds old
  /// rows. The key is written only AFTER the purge returned, so a launch killed
  /// mid-purge runs it again on the next one. It runs here, before JS starts,
  /// so no request races it.
  func purgeStoredURLCacheOnce() {
    let defaults = UserDefaults.standard
    guard !defaults.bool(forKey: Self.urlCachePurgedKey) else { return }
    URLCache.shared.removeAllCachedResponses()
    defaults.set(true, forKey: Self.urlCachePurgedKey)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
