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

    switch response.actionIdentifier {
    case UNNotificationDefaultActionIdentifier:
      reminders.enqueueResponse(reminderId: reminderId, action: "open")
      reminders.emitResponse(reminderId: reminderId)
      completionHandler()
    case KikoRemindersCenter.snoozeActionIdentifier:
      reminders.enqueueResponse(reminderId: reminderId, action: "snooze")
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

    center.add(request) { _ in
      completion()
    }
  }

  // The scheduled trigger's own hour and minute are preferred over the
  // delivery time, which can drift from the chosen time (a DST gap, a delayed
  // delivery). Built from local calendar days, with no time zone, the same
  // floating form as every reminder.
  static func tomorrow(atTimeOf notification: UNNotification, now: Date = Date()) -> DateComponents? {
    let calendar = Calendar.current
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

    return DateComponents(year: day.year, month: day.month, day: day.day, hour: hour, minute: minute)
  }
}
