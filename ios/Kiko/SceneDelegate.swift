import UIKit
import React
import React_RCTAppDelegate

/// Owns the scene-bound window under iOS 27's mandatory UIScene lifecycle
/// (see the `UIApplicationSceneManifest` in `ios/Kiko/Info.plist`). AppDelegate
/// still builds and holds the RN factory (`RCTReactNativeFactory`) so there is
/// only ever one React Native instance; this delegate starts React Native on a
/// window that is actually bound to a `UIWindowScene`. A `UIWindow` with
/// `windowScene == nil` is never displayed under the scene lifecycle — that was
/// the cause of the black screen after Info.plist step 1 added the manifest
/// without a matching scene delegate.
///
/// RN 0.87 pattern verified against
/// `node_modules/react-native/Libraries/AppDelegate/RCTReactNativeFactory.mm`:
/// `startReactNativeWithModuleName:inWindow:launchOptions:` only creates the
/// root view via `rootViewFactory`, sets `window.rootViewController`, and
/// calls `window.makeKeyAndVisible()` — it never touches `windowScene`, so the
/// caller is responsible for constructing the window from a connected scene
/// before handing it to the factory. That single call replaces the app-level
/// `UIWindow(frame: UIScreen.main.bounds)` construction that used to live in
/// `AppDelegate.didFinishLaunchingWithOptions`.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window

    factory.startReactNative(
      withModuleName: "Kiko",
      in: window,
      launchOptions: appDelegate.launchOptions
    )
  }

  // MARK: - Privacy: app-switcher snapshot redaction

  // Tag used to find and remove the overlay; arbitrary non-zero value.
  private let privacyOverlayTag = 0x4B49_4B4F // "KIKO"

  /// The app-level `applicationWillResignActive` / `applicationDidEnterBackground`
  /// / `applicationDidBecomeActive` callbacks do NOT fire once the app adopts
  /// the scene lifecycle (see the Info.plist `UIApplicationSceneManifest`
  /// comment); their `UIWindowSceneDelegate` equivalents below drive the
  /// privacy overlay instead, operating on this scene's own window.
  func sceneWillResignActive(_ scene: UIScene) {
    showPrivacyOverlay()
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    showPrivacyOverlay()
    (UIApplication.shared.delegate as? AppDelegate)?.excludeDatabaseFilesFromBackup()
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    hidePrivacyOverlay()
  }

  /// A native cover, not a JS one: the app-switcher snapshot is taken as soon as
  /// the app resigns active, before a React render could paint, so only a view
  /// added synchronously here is guaranteed to be in the snapshot.
  ///
  /// The overlay is two layers in one tagged container. The base is an OPAQUE
  /// view in the system background color: it hides the live content
  /// unconditionally, the instant it is inserted. This matters because a live
  /// `UIBlurEffect` is composited asynchronously by the render server, and iOS
  /// sometimes captures the app-switcher snapshot BEFORE the blur rasterizes —
  /// so a blur-only cover is intermittently captured as transparent over the
  /// real balances. The opaque base removes that race: privacy is guaranteed by
  /// the base regardless of blur render timing. On top of the base sits a
  /// `.systemChromeMaterial` `UIVisualEffectView` purely for aesthetics — once
  /// the blur pass runs it reads as the intended strong native iOS privacy blur.
  ///
  /// Both the base color and the blur material adapt to the ACTIVE color scheme.
  /// React Native 0.87's `Appearance.setColorScheme` (driven by
  /// `applyAppearance` in `src/appearance/appearance.ts`) sets
  /// `window.overrideUserInterfaceStyle` on every window — verified in
  /// `RCTAppearance.mm`'s `setColorScheme:`, which walks every scene's windows —
  /// so `window.traitCollection.userInterfaceStyle` reflects the user's PINNED
  /// scheme ('light'/'dark'), and the OS scheme under 'auto' (which clears the
  /// override). Resolving `UIColor.systemBackground` and using the un-suffixed
  /// `.systemChromeMaterial` against that trait collection makes the cover match
  /// whichever scheme is live, instead of the old hardcoded true-black base /
  /// dark chrome that stayed dark on the light theme.
  ///
  /// Both layers live in the single tagged container, so `hidePrivacyOverlay`
  /// removes them together.
  private func showPrivacyOverlay() {
    guard let window, window.viewWithTag(privacyOverlayTag) == nil else { return }
    let container = UIView(frame: window.bounds)
    container.tag = privacyOverlayTag
    container.isOpaque = true
    container.backgroundColor = UIColor.systemBackground.resolvedColor(with: window.traitCollection)
    container.autoresizingMask = [.flexibleWidth, .flexibleHeight]

    let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
    blur.frame = container.bounds
    blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    container.addSubview(blur)

    window.addSubview(container)
  }

  private func hidePrivacyOverlay() {
    window?.viewWithTag(privacyOverlayTag)?.removeFromSuperview()
  }
}
