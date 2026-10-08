import UIKit
import os

/// The native side of the `DisplayRegions` TurboModule: the foreground window's horizontal size
/// class, the system's preferred vertical bar edge, and the fold's division region. JS decides
/// the layout from them; this class only reads them and reports a change.
///
/// The vertical bar edge and the division region exist from iOS 27.1. On an older system, or
/// when the app is built with an older SDK, they read as no bar and no fold, which JS treats as
/// the ordinary single-window iPhone.
@MainActor
@objc public final class DisplayRegionsCenter: NSObject {
  @objc public static let shared = DisplayRegionsCenter()

  private static let logger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "", category: "DisplayRegions")

  // The emitter points into the JS runtime and is set and removed from the TurboModule's own
  // threads, so it sits behind a lock instead of the main actor: `removeChangeEmitter` must have
  // taken effect before it returns, or a queued refresh could still emit into a torn-down runtime.
  private nonisolated let emitterLock = NSLock()
  nonisolated(unsafe) private var changeEmitter: ((String) -> Void)?
  nonisolated(unsafe) private weak var changeEmitterOwner: AnyObject?
  // The last snapshot the observers saw, so an event that changes nothing emits nothing. A JS
  // read never touches it: a read that updated it would hide the change from the observer that
  // follows, and the JS side would keep what it rendered before.
  private var lastObservedJson: String?
  private weak var observedWindow: UIWindow?
  private var traitRegistration: UITraitChangeRegistration?
  private var geometryObservation: NSKeyValueObservation?
  private var hingeInteraction: UIInteraction?
  private var notificationObservers: [NSObjectProtocol] = []

  override private init() {
    super.init()
  }

  // MARK: - Reading

  /// The current snapshot as JSON, read live. Main thread only.
  @objc public func snapshotJson() -> String {
    return Self.encode(readSnapshot())
  }

  struct Snapshot {
    var horizontalSizeClass: String
    var verticalBarEdge: String
    var foldRegion: CGRect?
  }

  static let fallbackSnapshot = Snapshot(
    horizontalSizeClass: "compact",
    verticalBarEdge: "none",
    foldRegion: nil
  )

  static func encode(_ snapshot: Snapshot) -> String {
    let fold: Any
    if let region = snapshot.foldRegion {
      fold = [
        "x": region.origin.x,
        "y": region.origin.y,
        "width": region.size.width,
        "height": region.size.height,
      ]
    } else {
      fold = NSNull()
    }

    let object: [String: Any] = [
      "horizontalSizeClass": snapshot.horizontalSizeClass,
      "verticalBarEdge": snapshot.verticalBarEdge,
      "foldRegion": fold,
    ]

    guard
      let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
      let json = String(data: data, encoding: .utf8)
    else {
      return encode(fallbackSnapshot)
    }

    return json
  }

  // The foreground scene's key window, else the first window of the best scene there is.
  private func foregroundWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene =
      scenes.first { $0.activationState == .foregroundActive }
      ?? scenes.first { $0.activationState == .foregroundInactive }
      ?? scenes.first

    return scene?.keyWindow ?? scene?.windows.first
  }

  private func readSnapshot() -> Snapshot {
    guard let window = foregroundWindow() else {
      return Self.fallbackSnapshot
    }

    return Snapshot(
      horizontalSizeClass: window.traitCollection.horizontalSizeClass == .regular
        ? "regular" : "compact",
      verticalBarEdge: Self.verticalBarEdgeName(of: window),
      foldRegion: Self.foldRegion(of: window)
    )
  }

  // MARK: - iOS 27.1 symbols
  //
  // `UITraitCollection.verticalBarEdge` and `UIView.reservedRegions(kind:)` ship in the iOS 27.1
  // SDK. The version check is UIKit's own build number in that SDK (9127.0.85), because every
  // Xcode 27 compiler reports Swift 6.4 and so cannot tell the 27.0 SDK from the 27.1 one.

  #if canImport(UIKit, _version: 9127.0.85)
    private static func verticalBarEdgeName(of window: UIWindow) -> String {
      guard #available(iOS 27.1, *) else {
        return "none"
      }

      switch window.traitCollection.verticalBarEdge {
      case .leading: return "leading"
      case .trailing: return "trailing"
      default: return "none"
      }
    }

    // `.division` is the fold. The default query returns active regions only, so a flat device
    // gives none. The frame is already in window points because the query runs on the window.
    private static func foldRegion(of window: UIWindow) -> CGRect? {
      guard #available(iOS 27.1, *) else {
        return nil
      }

      return window.reservedRegions(kind: .division)
        .map(\.frame)
        .first { $0.width > 0 && $0.height > 0 }
    }

    // The traits that decide the size class and the bar edge.
    private static func observedTraits() -> [UITrait] {
      guard #available(iOS 27.1, *) else {
        return [UITraitHorizontalSizeClass.self]
      }

      return [UITraitHorizontalSizeClass.self] + UITraitCollection.systemTraitsAffectingVerticalBarEdge
    }

    // The traits, the window geometry and the scene state do not move when a flat device starts to
    // fold, so the hinge is observed itself. Its handler also runs once on adding, which `refresh`
    // finds unchanged.
    private func makeHingeInteraction(for window: UIWindow) -> UIInteraction? {
      guard #available(iOS 27.1, *) else {
        return nil
      }

      let interaction = UIHingeInteraction { [weak self] _, _ in
        self?.refreshAfterLayout()
      }
      window.addInteraction(interaction)

      return interaction
    }
  #else
    private static func verticalBarEdgeName(of window: UIWindow) -> String {
      return "none"
    }

    private static func foldRegion(of window: UIWindow) -> CGRect? {
      return nil
    }

    private static func observedTraits() -> [UITrait] {
      return [UITraitHorizontalSizeClass.self]
    }

    private func makeHingeInteraction(for window: UIWindow) -> UIInteraction? {
      return nil
    }
  #endif

  // MARK: - Observing

  /// Registered once the TurboModule hands over its callback. The callback points into the JS
  /// runtime, so `removeChangeEmitter` must run before that runtime goes away.
  @objc(setChangeEmitter:owner:)
  public nonisolated func setChangeEmitter(_ emitter: @escaping (String) -> Void, owner: AnyObject) {
    emitterLock.lock()
    changeEmitter = emitter
    changeEmitterOwner = owner
    emitterLock.unlock()

    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        self.startObserving()
      }
    }
  }

  @objc(removeChangeEmitterForOwner:)
  public nonisolated func removeChangeEmitter(owner: AnyObject) {
    emitterLock.lock()
    defer { emitterLock.unlock() }

    if changeEmitterOwner === owner {
      changeEmitter = nil
      changeEmitterOwner = nil
    }
  }

  private nonisolated func currentChangeEmitter() -> ((String) -> Void)? {
    emitterLock.lock()
    defer { emitterLock.unlock() }

    return changeEmitterOwner == nil ? nil : changeEmitter
  }

  private func startObserving() {
    guard notificationObservers.isEmpty else {
      attachToForegroundWindow()
      return
    }

    // The key window moves with scene activation, so re-attach and re-read on each.
    let names: [Notification.Name] = [
      UIScene.didActivateNotification,
      UIWindow.didBecomeKeyNotification,
    ]
    notificationObservers = names.map { name in
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) {
        [weak self] _ in
        MainActor.assumeIsolated {
          self?.attachToForegroundWindow()
          self?.refresh()
        }
      }
    }

    lastObservedJson = snapshotJson()
    attachToForegroundWindow()
  }

  // The trait and geometry observers follow the foreground window, and are dropped from the one
  // it replaces.
  private func attachToForegroundWindow() {
    guard let window = foregroundWindow(), window !== observedWindow else {
      return
    }

    if let previous = observedWindow {
      if let registration = traitRegistration {
        previous.unregisterForTraitChanges(registration)
      }

      if let interaction = hingeInteraction {
        previous.removeInteraction(interaction)
      }
    }

    observedWindow = window
    traitRegistration = window.registerForTraitChanges(Self.observedTraits()) {
      [weak self] (_: UIWindow, _) in
      self?.refresh()
    }
    hingeInteraction = makeHingeInteraction(for: window)
    geometryObservation = window.windowScene?.observe(\.effectiveGeometry, options: []) {
      [weak self] _, _ in
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          self?.refresh()
        }
      }
    }
  }

  // UIKit finishes the layout pass that a hinge change starts after the callback returns, so the
  // reserved region is read on the next turn of the main queue.
  private func refreshAfterLayout() {
    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        self.refresh()
      }
    }
  }

  private func refresh() {
    let json = snapshotJson()

    guard json != lastObservedJson else {
      return
    }

    lastObservedJson = json

    guard let emitter = currentChangeEmitter() else {
      return
    }

    logEmitted(json)
    emitter(json)
  }

  // One line per emit, never per read, so a Release build can be checked with
  // `log stream --level debug --predicate 'category == "DisplayRegions"'`. The payload is public
  // because it holds only layout numbers.
  private func logEmitted(_ json: String) {
    let bounds = foregroundWindow()?.bounds ?? .zero
    let scale = foregroundWindow()?.traitCollection.displayScale ?? 0

    Self.logger.debug(
      "emit \(json, privacy: .public) windowBounds=\(bounds.width, privacy: .public)x\(bounds.height, privacy: .public)pt scale=\(scale, privacy: .public)"
    )
  }
}
