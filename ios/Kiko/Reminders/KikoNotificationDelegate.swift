import Foundation
import UserNotifications

/// Must be the notification center's delegate before launch finishes (set in
/// `AppDelegate`), or a tap that cold-launches the app and a background
/// "Tomorrow" action are delivered to no one. Needs no JS: a snooze is
/// scheduled here, and JS reads the queued response on its next drain.
final class KikoNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  static let shared = KikoNotificationDelegate()

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let notification = response.notification

    guard let reminderId = notification.request.content.userInfo["reminderId"] as? String else {
      completionHandler()
      return
    }

    let reminders = KikoRemindersCenter.shared
    let requestIdentifier = notification.request.identifier

    switch response.actionIdentifier {
    case UNNotificationDefaultActionIdentifier:
      reminders.enqueueResponse(reminderId: reminderId, requestIdentifier: requestIdentifier, action: "open")
      reminders.emitResponse(reminderId: reminderId)
      completionHandler()
    case KikoRemindersCenter.snoozeActionIdentifier:
      reminders.enqueueResponse(reminderId: reminderId, requestIdentifier: requestIdentifier, action: "snooze")
      reminders.emitResponse(reminderId: reminderId)
      // The completion handler waits for the add: the system may suspend a
      // background-launched app as soon as it is called.
      scheduleSnooze(of: notification, reminderId: reminderId, center: center, completion: completionHandler)
    default:
      completionHandler()
    }
  }

  private func scheduleSnooze(
    of notification: UNNotification,
    reminderId: String,
    center: UNUserNotificationCenter,
    completion: @escaping () -> Void
  ) {
    guard
      let content = notification.request.content.mutableCopy() as? UNMutableNotificationContent,
      let fireAt = Self.tomorrow(atTimeOf: notification)
    else {
      completion()
      return
    }

    let request = UNNotificationRequest(
      identifier: KikoRemindersCenter.snoozeIdentifierPrefix + reminderId,
      content: content,
      trigger: UNCalendarNotificationTrigger(dateMatching: fireAt, repeats: false)
    )

    // iOS can run this action with no JS at all (the app killed, or the
    // device locked), and JS may not re-plan before the next fire. The snooze
    // stands in for the regular request at its minute, so that one would fire
    // twice; and a snooze restarts the ignored count, so the paused notice JS
    // planned would come a fire early. JS plans both again on its next re-plan.
    center.removePendingNotificationRequests(
      withIdentifiers: Self.requestsReplacedBySnooze(of: reminderId, at: fireAt)
    )

    center.add(request) { _ in
      completion()
    }
  }

  // The identifiers JS gives the regular request at a minute and the paused
  // notice (`plan-reminder.ts`): the reminder id, then the local fire minute as
  // yyyyMMddHHmm, or "paused".
  static func requestsReplacedBySnooze(of reminderId: String, at fireAt: DateComponents) -> [String] {
    let prefix = KikoRemindersCenter.reminderIdentifierPrefix + reminderId + "."
    let pausedNotice = prefix + "paused"

    guard
      let year = fireAt.year,
      let month = fireAt.month,
      let day = fireAt.day,
      let hour = fireAt.hour,
      let minute = fireAt.minute
    else {
      return [pausedNotice]
    }

    let fireStamp = String(format: "%ld%02ld%02ld%02ld%02ld", year, month, day, hour, minute)

    return [prefix + fireStamp, pausedNotice]
  }

  // The scheduled trigger's own hour and minute are preferred over the
  // delivery time, which can drift from the chosen time (a DST gap, a delayed
  // delivery). Built from local calendar days, with no time zone, the same
  // floating form as every reminder. Gregorian whatever calendar the user
  // picked (Buddhist, Japanese): JS plans every request on Gregorian dates, so
  // only a Gregorian day gives the identifier of the regular request this
  // snooze replaces.
  static func tomorrow(atTimeOf notification: UNNotification, now: Date = Date()) -> DateComponents? {
    let calendar = Calendar.gregorian
    let scheduledTime = (notification.request.trigger as? UNCalendarNotificationTrigger)?.dateComponents
    let deliveredTime = calendar.dateComponents([.hour, .minute], from: notification.date)

    guard
      let hour = scheduledTime?.hour ?? deliveredTime.hour,
      let minute = scheduledTime?.minute ?? deliveredTime.minute,
      let tomorrow = calendar.date(byAdding: .day, value: 1, to: now)
    else {
      return nil
    }

    let day = calendar.dateComponents([.year, .month, .day], from: tomorrow)

    return DateComponents(
      calendar: calendar,
      year: day.year,
      month: day.month,
      day: day.day,
      hour: hour,
      minute: minute
    )
  }
}
