import Foundation
import UserNotifications

/// The native side of the `KikoReminders` TurboModule. JS makes every
/// scheduling decision; this class only mirrors the request set JS hands it
/// into `UNUserNotificationCenter`, and queues the user's responses for JS.
@objc public final class KikoRemindersCenter: NSObject {
  @objc public static let shared = KikoRemindersCenter()

  static let reminderIdentifierPrefix = "kiko.reminder."
  static let snoozeIdentifierPrefix = "kiko.snooze."
  static let reminderCategoryIdentifier = "kiko.reminder"
  static let noticeCategoryIdentifier = "kiko.reminder.notice"
  static let snoozeActionIdentifier = "TOMORROW"
  static let responsesKey = "kiko.reminders.responses"
  static let maximumQueuedResponses = 20
  // iOS keeps only the soonest 64 pending local notifications per app and
  // silently drops the rest.
  static let maximumPendingRequests = 64

  private let center = UNUserNotificationCenter.current()
  private let stateLock = NSLock()
  // One replace at a time: two overlapping replaces would each read the
  // pending set before the other's adds, and leave the union scheduled.
  private let replaceQueue = DispatchQueue(label: "com.kiko.reminders.replace")
  private var responseEmitter: ((String) -> Void)?
  private weak var responseEmitterOwner: AnyObject?

  override private init() {
    super.init()
  }

  // MARK: - Authorization

  @objc(authorizationStatusWithCompletion:)
  public func authorizationStatus(completion: @escaping (String) -> Void) {
    center.getNotificationSettings { settings in
      completion(Self.statusName(settings.authorizationStatus))
    }
  }

  static func statusName(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .authorized: return "authorized"
    case .provisional: return "provisional"
    case .ephemeral: return "ephemeral"
    @unknown default: return "unknown"
    }
  }

  // An error from the system prompt means notifications stay off, which JS
  // handles the same way as a refusal.
  @objc(requestAuthorizationWithCompletion:)
  public func requestAuthorization(completion: @escaping (Bool) -> Void) {
    center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
      completion(granted)
    }
  }

  // MARK: - Requests

  @objc(replaceRequestsWithJson:keepSnoozeReminderIds:completion:)
  public func replaceRequests(
    json: String,
    keepSnoozeReminderIds: [String],
    completion: @escaping (Error?) -> Void
  ) {
    replaceQueue.async {
      completion(self.replaceRequestsNow(json: json, keepSnoozeReminderIds: keepSnoozeReminderIds))
    }
  }

  private func replaceRequestsNow(json: String, keepSnoozeReminderIds: [String]) -> Error? {
    let requests: [ReminderRequest]

    do {
      requests = try JSONDecoder().decode([ReminderRequest].self, from: Data(json.utf8))
    } catch {
      return error
    }

    let keptSnoozeIdentifiers = Set(keepSnoozeReminderIds.map { Self.snoozeIdentifierPrefix + $0 })
    let pendingIdentifiers = pendingRequestIdentifiers()
    let staleIdentifiers = pendingIdentifiers.filter { identifier in
      identifier.hasPrefix(Self.reminderIdentifierPrefix)
        || (identifier.hasPrefix(Self.snoozeIdentifierPrefix)
          && !keptSnoozeIdentifiers.contains(identifier))
    }

    center.removePendingNotificationRequests(withIdentifiers: staleIdentifiers)
    center.removeDeliveredNotifications(
      withIdentifiers: Self.orphanedReminderIdentifiers(
        in: deliveredNotifications().map(\.request),
        liveReminderIds: Set(requests.map(\.reminderId)).union(keepSnoozeReminderIds)
      )
    )

    let capacity = max(0, Self.maximumPendingRequests - (pendingIdentifiers.count - staleIdentifiers.count))
    var firstError: Error?

    for request in requests.prefix(capacity) {
      if let error = add(Self.notificationRequest(from: request)), firstError == nil {
        firstError = error
      }
    }

    return firstError
  }

  // Blocking waits are safe here: they only ever run on `replaceQueue`, never
  // on the main thread or the JS thread.
  private func pendingRequestIdentifiers() -> [String] {
    let semaphore = DispatchSemaphore(value: 0)
    var identifiers: [String] = []

    center.getPendingNotificationRequests { pending in
      identifiers = pending.map(\.identifier)
      semaphore.signal()
    }

    semaphore.wait()

    return identifiers
  }

  private func deliveredNotifications() -> [UNNotification] {
    let semaphore = DispatchSemaphore(value: 0)
    var notifications: [UNNotification] = []

    center.getDeliveredNotifications { delivered in
      notifications = delivered
      semaphore.signal()
    }

    semaphore.wait()

    return notifications
  }

  // A delivered reminder of a reminder JS no longer schedules (deleted, with
  // its account or not, paused, or unavailable) still offers "Tomorrow", and
  // that snooze would fire with the app closed and route nowhere. The paused
  // notice has no action and stays: it may not have been read yet.
  static func orphanedReminderIdentifiers(
    in delivered: [UNNotificationRequest],
    liveReminderIds: Set<String>
  ) -> [String] {
    delivered.compactMap { request in
      guard
        request.content.categoryIdentifier == reminderCategoryIdentifier,
        let reminderId = request.content.userInfo["reminderId"] as? String,
        !liveReminderIds.contains(reminderId)
      else {
        return nil
      }

      return request.identifier
    }
  }

  private func add(_ request: UNNotificationRequest) -> Error? {
    let semaphore = DispatchSemaphore(value: 0)
    var addError: Error?

    center.add(request) { error in
      addError = error
      semaphore.signal()
    }

    semaphore.wait()

    return addError
  }

  static func notificationRequest(from request: ReminderRequest) -> UNNotificationRequest {
    let content = UNMutableNotificationContent()
    content.title = request.title
    content.body = request.body
    content.threadIdentifier = request.threadIdentifier
    content.userInfo = [
      "reminderId": request.reminderId,
      "accountId": request.accountId,
      "kind": request.kind,
    ]

    if let categoryIdentifier = request.categoryIdentifier {
      content.categoryIdentifier = categoryIdentifier
    }

    switch request.interruptionLevel {
    case .active:
      content.interruptionLevel = .active
      content.sound = .default
    case .passive:
      content.interruptionLevel = .passive
    }

    let trigger = UNCalendarNotificationTrigger(
      dateMatching: request.fireAt.floatingDateComponents,
      repeats: false
    )

    return UNNotificationRequest(identifier: request.identifier, content: content, trigger: trigger)
  }

  // MARK: - Categories

  @objc(registerCategoriesWithSnoozeTitle:placeholder:)
  public func registerCategories(snoozeTitle: String, placeholder: String) {
    // No options: the snooze runs in the background without unlocking the
    // device or opening the app.
    let snooze = UNNotificationAction(
      identifier: Self.snoozeActionIdentifier,
      title: snoozeTitle,
      options: []
    )
    let reminder = UNNotificationCategory(
      identifier: Self.reminderCategoryIdentifier,
      actions: [snooze],
      intentIdentifiers: [],
      hiddenPreviewsBodyPlaceholder: placeholder,
      options: []
    )
    let notice = UNNotificationCategory(
      identifier: Self.noticeCategoryIdentifier,
      actions: [],
      intentIdentifiers: [],
      hiddenPreviewsBodyPlaceholder: placeholder,
      options: []
    )

    center.setNotificationCategories([reminder, notice])
  }

  // MARK: - Responses

  @objc public func drainResponses() -> String {
    stateLock.lock()
    defer { stateLock.unlock() }

    let defaults = UserDefaults.standard
    let queued = defaults.string(forKey: Self.responsesKey) ?? "[]"
    defaults.removeObject(forKey: Self.responsesKey)

    return queued
  }

  // The queue lives in UserDefaults, not memory, so a tap or a snooze made
  // while JS is not running (a cold launch, a background action) still
  // reaches JS on its next drain.
  func enqueueResponse(reminderId: String, requestIdentifier: String, action: String) {
    stateLock.lock()
    defer { stateLock.unlock() }

    let defaults = UserDefaults.standard
    let decoder = JSONDecoder()
    let stored = defaults.string(forKey: Self.responsesKey).flatMap { json in
      try? decoder.decode([QueuedResponse].self, from: Data(json.utf8))
    }
    let respondedAt = Int64((Date().timeIntervalSince1970 * 1000).rounded())
    let queued = (stored ?? []) + [
      QueuedResponse(
        reminderId: reminderId,
        requestIdentifier: requestIdentifier,
        action: action,
        respondedAt: respondedAt
      ),
    ]
    let kept = Array(queued.suffix(Self.maximumQueuedResponses))

    if let data = try? JSONEncoder().encode(kept), let json = String(data: data, encoding: .utf8) {
      defaults.set(json, forKey: Self.responsesKey)
    }
  }

  // MARK: - Response events

  // The owner check stops an invalidated module from clearing the emitter of
  // the module that replaced it.
  @objc(setResponseEmitter:owner:)
  public func setResponseEmitter(_ emitter: @escaping (String) -> Void, owner: AnyObject) {
    stateLock.lock()
    defer { stateLock.unlock() }

    responseEmitter = emitter
    responseEmitterOwner = owner
  }

  @objc(removeResponseEmitterForOwner:)
  public func removeResponseEmitter(owner: AnyObject) {
    stateLock.lock()
    defer { stateLock.unlock() }

    if responseEmitterOwner === owner {
      responseEmitter = nil
      responseEmitterOwner = nil
    }
  }

  func emitResponse(reminderId: String) {
    stateLock.lock()
    let emitter = responseEmitterOwner == nil ? nil : responseEmitter
    stateLock.unlock()

    emitter?(reminderId)
  }
}

struct ReminderRequest: Decodable {
  // A closed set on purpose: an unknown level (such as `timeSensitive`) fails
  // the decode instead of being scheduled.
  enum InterruptionLevel: String, Decodable {
    case active
    case passive
  }

  let identifier: String
  let reminderId: String
  let accountId: String
  let kind: String
  let title: String
  let body: String
  let interruptionLevel: InterruptionLevel
  let fireAt: LocalDateTime
  let categoryIdentifier: String?
  let threadIdentifier: String
}

struct LocalDateTime: Decodable {
  let year: Int
  let month: Int
  let day: Int
  let hour: Int
  let minute: Int

  // No calendar and no time zone: the trigger matches the device's local
  // wall-clock time, so the reminder still fires at the chosen time after the
  // user changes zone. A Calendar on the components would carry a zone, and
  // the trigger is archived to the notification daemon with it, so the
  // reminder would stop floating. JS plans Gregorian dates and the trigger
  // reads plain components in the device calendar (Buddhist, Japanese,
  // Islamic), so the Gregorian date is converted to that calendar's own
  // components, era included, and only those fields are handed over.
  var floatingDateComponents: DateComponents {
    let gregorian = DateComponents(year: year, month: month, day: day, hour: hour, minute: minute)

    guard let date = Calendar.gregorian.date(from: gregorian) else {
      return gregorian
    }

    let local = Calendar.current.dateComponents([.era, .year, .month, .day, .hour, .minute], from: date)

    return DateComponents(
      era: local.era,
      year: local.year,
      month: local.month,
      day: local.day,
      hour: local.hour,
      minute: local.minute
    )
  }
}

extension Calendar {
  // The zone follows the device after a zone change, the same as the floating
  // wall-clock time the trigger matches.
  static var gregorian: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone.autoupdatingCurrent

    return calendar
  }
}

struct QueuedResponse: Codable {
  let reminderId: String
  // JS tells the paused notice from a reminder by this identifier.
  let requestIdentifier: String
  let action: String
  // Milliseconds since the epoch, the unit JS `Date` uses.
  let respondedAt: Int64
}
