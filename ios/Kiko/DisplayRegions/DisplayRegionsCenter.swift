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
  // An angle tick arrived while a settle pair was running, so the pair's reads may all precede it.
  private var hasTickDuringSettle = false
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
    var tabBarEdge: String
    var foldRegion: CGRect?
  }

  // Where the tab bar was found and its frame in window points; `frame` is nil on every miss.
  // `tabBarIsHidden` and `tabBarFrame` are the controller's own tab bar, kept for the debug log
  // only: they say why a floating or missing bar came out as it did. `rejectedFrame` is the frame
  // `isInsideWindow` dropped when no frame was accepted; it too is for the log only, so `frame`
  // stays nil and the snapshot reads `none`.
  struct TabBarReading {
    var kind: String
    var frame: CGRect?
    var tabBarIsHidden: Bool?
    var tabBarFrame: CGRect?
    var rejectedFrame: CGRect? = nil

    var loggedFrame: CGRect? {
      frame ?? rejectedFrame
    }

    static let missing = TabBarReading(
      kind: "none", frame: nil, tabBarIsHidden: nil, tabBarFrame: nil)
  }

  // A snapshot with the tab bar reading, the window bounds and the display scale that produced it.
  struct SnapshotReading {
    var snapshot: Snapshot
    var tabBar: TabBarReading
    var windowBounds: CGRect
    var displayScale: CGFloat
  }

  struct HingeState: Equatable {
    var status: Int
    var hidesFold: Bool
  }

  // Where a read came from, for the debug log.
  private enum ReadSource: String {
    case hinge, geometry, trait, notification, settle, request
  }

  // The bound on the tab bar walk. A real tree holds a handful of controllers, so reaching it
  // means a tree this code does not know, and the walk gives up with no frame.
  private static let maximumWalkedControllers = 64

  // The same kind of bound on the floating bar descent: views visited, and levels below the
  // controller's view (which is level 0).
  private static let maximumVisitedViews = 128
  private static let maximumDescentDepth = 6

  // A floating bar is small on both sides next to the window; a view whose short side reaches
  // half the window's is content.
  private static let floatingBarShortSideLimit: CGFloat = 0.5

  // How far, in points, a candidate frame may reach past the window and still count as inside it.
  private static let windowFrameTolerance: CGFloat = 1

  // An invisible view still holds a frame, so a view at or under this alpha counts as hidden.
  private static let minimumVisibleAlpha: CGFloat = 0.01

  // How long after a trigger the settle reads run. The reserved region reaches the window as its
  // own update, later than the hinge, the traits and the geometry, and no API reports it.
  private static let settleOffsets: [Duration] = [.milliseconds(300), .milliseconds(1200)]

  static let fallbackSnapshot = Snapshot(
    horizontalSizeClass: "compact",
    verticalBarEdge: "none",
    tabBarEdge: "none",
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
      "tabBarEdge": snapshot.tabBarEdge,
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
    return readSnapshotWithTabBar().snapshot
  }

  // The tab bar reading, the window bounds and the display scale come back with the snapshot they
  // produced, so the debug logs of a read and of its emit need no second walk of the view tree.
  private func readSnapshotWithTabBar() -> SnapshotReading {
    guard let window = foregroundWindow() else {
      return SnapshotReading(
        snapshot: Self.fallbackSnapshot, tabBar: .missing, windowBounds: .zero, displayScale: 0)
    }

    let tabBar = Self.readTabBar(in: window)
    let snapshot = Snapshot(
      horizontalSizeClass: window.traitCollection.horizontalSizeClass == .regular
        ? "regular" : "compact",
      verticalBarEdge: Self.verticalBarEdgeName(of: window),
      tabBarEdge: Self.tabBarEdgeName(
        frame: tabBar.frame,
        windowBounds: window.bounds,
        isRightToLeft: window.traitCollection.layoutDirection == .rightToLeft),
      foldRegion: lastHinge?.hidesFold == true ? nil : Self.foldRegion(of: window)
    )

    return SnapshotReading(
      snapshot: snapshot, tabBar: tabBar, windowBounds: window.bounds,
      displayScale: window.traitCollection.displayScale)
  }

  // MARK: - Tab bar edge
  //
  // Public UIKit only, no class-name match and no device idiom. Every miss, whatever the view
  // tree looks like, reads as no frame and so as `none`, which JS treats as "unknown".

  // The window's tab bar: a breadth-first walk of the view controllers from the root, through
  // `children` only (a presented controller sits over the bar and does not move it), to the first
  // tab bar controller whose view is in this window and holds a visible bar. The bar is the
  // controller's `tabBar`, else the floating bar: the OUTERMOST visible short view below the
  // controller's view, outside the selected tab's content. Not the smallest: a vertical bar's inner
  // item cells are wider than tall, so the smallest view would read a side bar as top or bottom.
  private static func readTabBar(in window: UIWindow) -> TabBarReading {
    guard
      window.windowScene != nil,
      window.bounds.width > 0,
      window.bounds.height > 0,
      let root = window.rootViewController
    else {
      return .missing
    }

    var queue = [root]
    var visited = 0
    var rejectedReading: TabBarReading?

    while visited < queue.count, visited < maximumWalkedControllers {
      let controller = queue[visited]
      visited += 1

      if let tabController = controller as? UITabBarController,
        tabController.isViewLoaded,
        tabController.view.window === window
      {
        let reading = tabBarReading(of: tabController, in: window)

        if reading.frame != nil {
          return reading
        }

        if rejectedReading == nil, reading.rejectedFrame != nil {
          rejectedReading = reading
        }
      }

      queue.append(contentsOf: controller.children)
    }

    return rejectedReading ?? .missing
  }

  private static func tabBarReading(
    of controller: UITabBarController, in window: UIWindow
  ) -> TabBarReading {
    let tabBar = controller.tabBar
    let tabBarCandidate = visibleFrame(of: tabBar, in: window)
    let ownFrame = tabBar.convert(tabBar.bounds, to: window)

    if let tabBarFrame = tabBarCandidate,
      isInsideWindow(frame: tabBarFrame, windowBounds: window.bounds)
    {
      return TabBarReading(
        kind: "tabBar", frame: tabBarFrame, tabBarIsHidden: tabBar.isHidden, tabBarFrame: ownFrame)
    }

    let floatingCandidate = floatingBarFrame(
      below: controller.view, selectedView: controller.selectedViewController?.viewIfLoaded,
      in: window)

    if let floating = floatingCandidate,
      isInsideWindow(frame: floating, windowBounds: window.bounds)
    {
      return TabBarReading(
        kind: "floating", frame: floating, tabBarIsHidden: tabBar.isHidden, tabBarFrame: ownFrame)
    }

    // Past both accept checks, a candidate that exists is one `isInsideWindow` dropped; the log
    // keeps it so it can say a candidate was seen and refused.
    let rejectedKinds = [
      tabBarCandidate.map { _ in "tabBar" },
      floatingCandidate.map { _ in "floating" },
    ].compactMap { $0 }

    return TabBarReading(
      kind: rejectedKinds.isEmpty ? "none" : "rejected(\(rejectedKinds.joined(separator: ",")))",
      frame: nil,
      tabBarIsHidden: tabBar.isHidden,
      tabBarFrame: ownFrame,
      rejectedFrame: floatingCandidate ?? tabBarCandidate)
  }

  // A breadth-first descent below the controller's view; the first view in that order that is
  // effectively visible and short next to the window wins. It stops at a subtree holding the
  // selected content (read with `viewIfLoaded`: an unloaded view is not in the tree, and a read
  // must not load one) and never enters a hidden or transparent view. Past the depth bound it
  // stops queueing deeper views and keeps scanning the ones already queued; past the visited bound
  // it returns no frame.
  private static func floatingBarFrame(
    below root: UIView, selectedView: UIView?, in window: UIWindow
  ) -> CGRect? {
    guard let selectedView else {
      return nil
    }

    let shortSideLimit = min(window.bounds.width, window.bounds.height) * floatingBarShortSideLimit
    var queue = root.subviews.map { (view: $0, depth: 1) }
    var visited = 0

    while visited < queue.count {
      guard visited < maximumVisitedViews else {
        return nil
      }

      let (view, depth) = queue[visited]
      visited += 1

      guard !selectedView.isDescendant(of: view),
        !view.isHidden,
        view.alpha > minimumVisibleAlpha
      else {
        continue
      }

      if let frame = visibleFrame(of: view, in: window),
        min(frame.width, frame.height) < shortSideLimit
      {
        return frame
      }

      if depth < maximumDescentDepth {
        queue.append(contentsOf: view.subviews.map { (view: $0, depth: depth + 1) })
      }
    }

    return nil
  }

  // The view's frame in window points when it is effectively visible: it and every superview up to
  // the window are shown and not transparent, and the frame is not empty and meets the window.
  private static func visibleFrame(of view: UIView, in window: UIWindow) -> CGRect? {
    var ancestor: UIView? = view

    while let current = ancestor, current !== window {
      guard !current.isHidden, current.alpha > minimumVisibleAlpha else {
        return nil
      }

      ancestor = current.superview
    }

    guard ancestor === window else {
      return nil
    }

    let frame = view.convert(view.bounds, to: window)

    guard !frame.isEmpty, frame.intersects(window.bounds) else {
      return nil
    }

    return frame
  }

  // A candidate frame reaching outside the window is stale: the tree still holds the layout of the
  // size the window had before a resize, so the frame is rejected and reads as no bar. The
  // tolerance absorbs sub-point rounding of a bar that sits flush with the window's edge.
  static func isInsideWindow(frame: CGRect, windowBounds: CGRect) -> Bool {
    return windowBounds.insetBy(dx: -windowFrameTolerance, dy: -windowFrameTolerance).contains(frame)
  }

  // A tall bar is a side bar, and which side is read against the reading direction; otherwise the
  // half of the window the bar's centre lies in decides between top and bottom.
  static func tabBarEdgeName(frame: CGRect?, windowBounds: CGRect, isRightToLeft: Bool) -> String {
    guard let frame else {
      return "none"
    }

    if frame.height > frame.width {
      if frame.midX < windowBounds.midX {
        return isRightToLeft ? "trailing" : "leading"
      }

      return isRightToLeft ? "leading" : "trailing"
    }

    return frame.midY < windowBounds.midY ? "top" : "bottom"
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

  /// The first snapshot is read before the tab view mounts and nothing native fires when it
  /// appears, so JS asks for one more read. It hops to main like `setChangeEmitter`, and an
  /// unchanged snapshot emits nothing.
  @objc public nonisolated func requestRefresh() {
    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        self.trigger(.request)
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
  // the same status starts the settle reads when none are pending: the division region can turn
  // active later than the status change, or with no status change at all, and only these ticks
  // follow it. A pending pair is never restarted, so a stream of ticks cannot postpone its reads
  // past 1.2 s; a tick that lands inside it is remembered, and the pair's end starts one more, so
  // the last read always comes at least 1.2 s after the last tick.
  private func hingeDidUpdate(_ hinge: HingeState?, angle: Double?) {
    let status = hinge.map { String($0.status) } ?? "none"
    let angleText = angle.map { String($0) } ?? "none"

    Self.logger.debug(
      "hinge handler status=\(status, privacy: .public) angle=\(angleText, privacy: .public)")

    guard hinge != lastHinge else {
      if settleTask == nil {
        scheduleSettleReads()
      } else {
        hasTickDuringSettle = true
      }

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
    startSettlePair()
  }

  private func startSettlePair() {
    hasTickDuringSettle = false
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

      // A cancelled task was replaced in the same main-actor turn, so only the current one
      // reaches here uncancelled; it either continues with the next pair or clears the slot.
      guard !Task.isCancelled, let center = self else {
        return
      }

      if center.hasTickDuringSettle {
        center.startSettlePair()
      } else {
        center.settleTask = nil
      }
    }
  }

  private func refresh(_ source: ReadSource) {
    let read = readSnapshotWithTabBar()
    let json = Self.encode(read.snapshot)
    let changed = json != lastObservedJson
    let candidateFrame = Self.describe(read.tabBar.loggedFrame)

    Self.logger.debug(
      "read source=\(source.rawValue, privacy: .public) changed=\(changed, privacy: .public) tabBarEdge=\(read.snapshot.tabBarEdge, privacy: .public) candidate=\(read.tabBar.kind, privacy: .public) candidateFrame=\(candidateFrame, privacy: .public)"
    )

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

    logEmitted(json, read: read)
    emitter(json)
  }

  // One line per emit, beside one per read and one per hinge update, so a Release build can be
  // checked with `log stream --level debug --predicate 'category == "DisplayRegions"'`. The payload
  // is public because it holds only layout numbers, and so do the tab bar candidate, its window
  // frame and the controller's own tab bar, which say why an edge came out.
  private func logEmitted(_ json: String, read: SnapshotReading) {
    let bounds = read.windowBounds
    let scale = read.displayScale
    let reading = read.tabBar
    let frame = Self.describe(reading.loggedFrame)
    let tabBarFrame = Self.describe(reading.tabBarFrame)
    let tabBarIsHidden = reading.tabBarIsHidden.map { String($0) } ?? "none"

    Self.logger.debug(
      "emit \(json, privacy: .public) windowBounds=\(bounds.width, privacy: .public)x\(bounds.height, privacy: .public)pt scale=\(scale, privacy: .public) candidate=\(reading.kind, privacy: .public) candidateFrame=\(frame, privacy: .public) tabBarHidden=\(tabBarIsHidden, privacy: .public) tabBarFrame=\(tabBarFrame, privacy: .public)"
    )
  }

  private static func describe(_ frame: CGRect?) -> String {
    return frame.map { "\($0.origin.x),\($0.origin.y) \($0.width)x\($0.height)" } ?? "none"
  }
}
