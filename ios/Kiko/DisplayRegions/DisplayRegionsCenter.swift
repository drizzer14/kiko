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
  // threads, so it sits behind a lock instead of the main actor. An emit runs under the same lock,
  // so no emit starts after `removeChangeEmitter` took the lock and none is still running when it
  // returns; a queued refresh can never emit into a torn-down runtime.
  private nonisolated let emitterLock = NSLock()
  nonisolated(unsafe) private var changeEmitter: ((String) -> Void)?
  nonisolated(unsafe) private weak var changeEmitterOwner: AnyObject?
  // The last snapshot the observers saw, so an event that changes nothing emits nothing. A JS
  // read never touches it: a read that updated it would hide the change from the observer that
  // follows, and the JS side would keep what it rendered before.
  private var lastObservedJson: String?
  // What the hinge handler last reported, nil until it reported a hinge. Only a closed or fully
  // open hinge is known to have no fold; any other status, `unknown` included, leaves the region
  // query to decide, because the handler's first call can report `unknown` while a fold is active.
  private var lastHinge: HingeState?
  private var settleTask: Task<Void, Never>?
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

  struct HingeState: Equatable {
    var status: Int
    var hidesFold: Bool
  }

  // Where a read came from, for the debug log.
  private enum ReadSource: String {
    case hinge, geometry, trait, notification, settle
  }

  // How long after a trigger the settle reads run. The reserved region reaches the window as its
  // own update, later than the hinge, the traits and the geometry, and no API reports it.
  private static let settleOffsets: [Duration] = [.milliseconds(300), .milliseconds(1200)]

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
      foldRegion: lastHinge?.hidesFold == true ? nil : Self.foldRegion(of: window)
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
    // fold, so the hinge is observed itself. Its handler also runs once on adding.
    private func makeHingeInteraction(for window: UIWindow) -> UIInteraction? {
      guard #available(iOS 27.1, *) else {
        return nil
      }

      let interaction = UIHingeInteraction { [weak self] _, update in
        let hinge = update.hinge

        self?.hingeDidUpdate(
          hinge.map {
            HingeState(
              status: $0.status.rawValue,
              hidesFold: $0.status == .closed || $0.status == .fullyOpen)
          },
          angle: hinge.map { Double($0.angle) }
        )
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
        [weak self] notification in
        let isActivation = notification.name == UIScene.didActivateNotification

        MainActor.assumeIsolated {
          // The region query decides until the new window's handler reports again, because the
          // status it reported before the scene went away may no longer hold.
          if isActivation {
            self?.lastHinge = nil
          }

          self?.attachToForegroundWindow()
          self?.trigger(.notification)
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
    lastHinge = nil
    traitRegistration = window.registerForTraitChanges(Self.observedTraits()) {
      [weak self] (_: UIWindow, _) in
      self?.trigger(.trait)
    }
    hingeInteraction = makeHingeInteraction(for: window)
    geometryObservation = window.windowScene?.observe(\.effectiveGeometry, options: []) {
      [weak self] _, _ in
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          self?.trigger(.geometry)
        }
      }
    }
  }

  // The hinge reports its angle continuously. A change of status reads at once. An angle tick with
  // the same status only restarts the settle reads: the division region can turn active later than
  // the status change, or with no status change at all, and only these ticks follow it.
  private func hingeDidUpdate(_ hinge: HingeState?, angle: Double?) {
    let status = hinge.map { String($0.status) } ?? "none"
    let angleText = angle.map { String($0) } ?? "none"

    Self.logger.debug(
      "hinge handler status=\(status, privacy: .public) angle=\(angleText, privacy: .public)")

    guard hinge != lastHinge else {
      scheduleSettleReads()
      return
    }

    lastHinge = hinge
    trigger(.hinge)
  }

  // Every trigger reads at once and again twice later, restarting the later reads, because the
  // reserved region lands after the trigger and nothing reports when. `lastObservedJson` keeps a
  // read that finds nothing new from emitting.
  private func trigger(_ source: ReadSource) {
    refresh(source)
    scheduleSettleReads()
  }

  private func scheduleSettleReads() {
    settleTask?.cancel()
    settleTask = Task { [weak self] in
      let clock = ContinuousClock()
      let start = clock.now

      for offset in Self.settleOffsets {
        try? await clock.sleep(until: start + offset)

        guard !Task.isCancelled else {
          return
        }

        self?.refresh(.settle)
      }
    }
  }

  private func refresh(_ source: ReadSource) {
    let json = snapshotJson()
    let changed = json != lastObservedJson

    Self.logger.debug(
      "read source=\(source.rawValue, privacy: .public) changed=\(changed, privacy: .public)")

    guard changed else {
      return
    }

    lastObservedJson = json

    // The emit runs under the lock, so `removeChangeEmitter` cannot return while it is in flight.
    emitterLock.lock()
    defer { emitterLock.unlock() }

    guard changeEmitterOwner != nil, let emitter = changeEmitter else {
      return
    }

    logEmitted(json)
    emitter(json)
  }

  // One line per emit, beside one per read and one per hinge update, so a Release build can be
  // checked with `log stream --level debug --predicate 'category == "DisplayRegions"'`. The payload
  // is public because it holds only layout numbers.
  private func logEmitted(_ json: String) {
    let bounds = foregroundWindow()?.bounds ?? .zero
    let scale = foregroundWindow()?.traitCollection.displayScale ?? 0

    Self.logger.debug(
      "emit \(json, privacy: .public) windowBounds=\(bounds.width, privacy: .public)x\(bounds.height, privacy: .public)pt scale=\(scale, privacy: .public)"
    )
  }
}
