import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "Kiko",
      in: window,
      launchOptions: launchOptions
    )

    excludeDatabaseFilesFromBackup()

    return true
  }

  // MARK: - Privacy: app-switcher snapshot redaction

  // Tag used to find and remove the overlay; arbitrary non-zero value.
  private let privacyOverlayTag = 0x4B49_4B4F // "KIKO"

  func applicationWillResignActive(_ application: UIApplication) {
    showPrivacyOverlay()
  }

  func applicationDidEnterBackground(_ application: UIApplication) {
    showPrivacyOverlay()
    excludeDatabaseFilesFromBackup()
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    hidePrivacyOverlay()
  }

  /// A native cover, not a JS one: the app-switcher snapshot is taken as soon as
  /// the app resigns active, before a React render could paint, so only a view
  /// added synchronously here is guaranteed to be in the snapshot.
  ///
  /// The overlay is two layers in one tagged container. The base is an OPAQUE
  /// view in the app's true-black theme background: it hides the live content
  /// unconditionally, the instant it is inserted. This matters because a live
  /// `UIBlurEffect` is composited asynchronously by the render server, and iOS
  /// sometimes captures the app-switcher snapshot BEFORE the blur rasterizes —
  /// so a blur-only cover is intermittently captured as transparent over the
  /// real balances. The opaque base removes that race: privacy is guaranteed by
  /// the base regardless of blur render timing. On top of the base sits the
  /// `.systemChromeMaterialDark` `UIVisualEffectView` purely for aesthetics —
  /// once the blur pass runs it reads as the intended strong native iOS privacy
  /// blur, and the dark chrome material sits well against the true-black base.
  /// Both layers live in the single tagged container, so `hidePrivacyOverlay`
  /// removes them together.
  private func showPrivacyOverlay() {
    guard let window, window.viewWithTag(privacyOverlayTag) == nil else { return }
    let container = UIView(frame: window.bounds)
    container.tag = privacyOverlayTag
    container.isOpaque = true
    container.backgroundColor = .black
    container.autoresizingMask = [.flexibleWidth, .flexibleHeight]

    let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterialDark))
    blur.frame = container.bounds
    blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    container.addSubview(blur)

    window.addSubview(container)
  }

  private func hidePrivacyOverlay() {
    window?.viewWithTag(privacyOverlayTag)?.removeFromSuperview()
  }

  // MARK: - Privacy: keep the database out of iCloud / iTunes backups

  /// op-sqlite stores its files in the app's Library directory, which iOS backs
  /// up by default. Mark the encrypted database and its SQLite sidecar files as
  /// excluded, plus any transient plaintext residue. Runs at launch and on every
  /// background transition because JS creates the files lazily; the attribute
  /// persists once set. File names mirror `src/db/encrypted-database.ts`.
  private func excludeDatabaseFilesFromBackup() {
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
