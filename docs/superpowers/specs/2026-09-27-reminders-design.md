# Reminders (user-configured, local notifications) — design, 1.2
Status: research done 2026-09-27; USER DECISIONS recorded; needs a plan (kiko:planner) when 1.2 starts. Target release: 1.2 (after Round A).

## User decisions (2026-09-27, user's own words summarized)
1. Scope: BOTH reminder types — (a) import a bank statement, (b) add transactions to a manual account.
2. NO account names (or any account identifier) in notification text — potentially sensitive on the lock screen. Also never amounts/balances.
3. Release 1.2.
4. Own native module (Swift, wraps UNUserNotificationCenter + a thin TurboModule spec), NOT expo-notifications, NOT notifee (archived 2026-04-07).
5. Placement: a Settings > Reminders page (list of all reminders, edit/pause/delete) AND each account gets its OWN reminder control page, reached from the place closest to that account (the account detail screen). Contextual offer after a statement import completes, too.

## Design
- Frame: a reminder the USER sets up in Kiko on the user's own schedule — useful, never noise.
- Schedules: daily at time; weekly on day(s); monthly on day N; every N days. Reuse TimeField (src/screens/forms/time-field) for time; weekly needs a new day picker.
- Smart skip: a reminder does not fire if the account had a new import or transaction since the previous fire (derive from transactions.time / createdAt per account; no import-log exists today).
- Back-off: after 3 ignored reminders, send ONE final "Reminders paused — turn them on again in Kiko" and stop (Duolingo/Monarch pattern). Ignored = not tapped and no new data.
- Content: informational, not a command (HIG "Avoid sending a notification that tells people to perform specific tasks within your app"), e.g. "9 days since your last statement import". No account name, no amounts, no app name in the title. hiddenPreviewsBodyPlaceholder = "Reminder" (localized). en + uk strings; user reviews them before any deploy.
- Tap: deep link to the exact account's statement-import (StatementImport needs a file, so open the account detail with the picker action) or TransactionForm {holdingId}/account. Deep linking does not exist today (no linking prop in App.tsx, no URL scheme); route via userInfo payload + navigation ref, not a public URL scheme unless needed.
- Action: one nondestructive "Tomorrow" (snooze) action; no "Open" action (HIG).
- Interruption level: Passive or Active; NEVER Time Sensitive (HIG: only for events within an hour).
- Permission: request full authorization only when the user saves the FIRST reminder; never at launch. Optional pre-alert screen: ONE "Continue" button, no Cancel, no "Allow" label (HIG Privacy). If denied: keep the reminder, show a non-modal banner with a button that opens iOS Settings (UIApplication.openSettingsURLString).
- Re-schedule all pending requests on every app launch/foreground (reboot/update/time-zone behavior is not documented by Apple; 64 pending-request limit per app; one repeating request counts once).
- Storage: new additive migration; reminder rules in a new table (per account + global) rather than settings columns, since each account has its own reminders; settingsRepo-style repo. Mind the op-sqlite single queue on app open.
- No aps-environment entitlement, no UIBackgroundModes needed for local notifications. Check PrivacyInfo.xcprivacy if UserDefaults is used in the native module.
- Compliance: 2.5.4 (local notifications allowed), 2.5.16 (content relates to app), 4.5.4, 5.1.2(i) (never required); 5.6: the Reminders UI ships visible, no flag gating.

## Open items for the planner
- Manual account = accounts.institution IS NULL (isSyncedAccount in src/holdings/deletable/deletable.ts). Should import reminders also apply to synced accounts that import statements? (ask the user)
- Device tests: reboot, app update, time-zone change, DST.
- Competitor gaps not verified: Spendee, Monefy, Money Lover, CoinKeeper, Day One, Daylio.

## Sources (checked 2026-09-27)
- HIG Notifications / Managing notifications / Privacy: https://developer.apple.com/design/human-interface-guidelines/notifications , .../managing-notifications , .../privacy (text read via https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json)
- NN/G Five Mistakes in Designing Mobile Push Notifications: https://www.nngroup.com/articles/push-notification/
- Monarch connection alerts: https://help.monarch.com/hc/en-us/articles/39129010722836-Connection-Status-Messaging
- Toshl reminders: https://toshl.com/blog/how-to-set-reminders-for-upcoming-bills-incomes-and-make-sure-you-pay-them-ios/
- Apple Journal schedule: https://support.apple.com/guide/iphone/build-a-journaling-habit-iph70107aec2/ios
- Brainscape skip-if-done: https://brainscape.zendesk.com/hc/en-us/articles/19832796175757-Study-streaks-reminders-on-the-mobile-app-Reminder-notifications
- notifee archived: https://github.com/invertase/notifee/issues/1254
- 64 pending limit (Apple engineer): https://developer.apple.com/forums/thread/811171
- App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
