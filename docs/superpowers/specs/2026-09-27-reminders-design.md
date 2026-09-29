# Reminders (user-configured, local notifications) — design, 1.2
Status: implemented on branch reminders (tasks 1/5-5/5); pending device tests; user key review done 2026-09-29

## User decisions (2026-09-27, user's own words summarized)
1. Scope: BOTH reminder types — (a) import a bank statement, (b) add transactions to a manual account.
2. NO account names (or any account identifier) in notification text — potentially sensitive on the lock screen. Also never amounts/balances.
3. Release 1.2.
4. Own native module (Swift, wraps UNUserNotificationCenter + a thin TurboModule spec), NOT expo-notifications, NOT notifee (archived 2026-04-07).
5. Placement: a Settings > Reminders page (list of all reminders, edit/pause/delete) AND each account gets its OWN reminder control page, reached from the place closest to that account (the account detail screen). Contextual offer at TWO moments (user's addition 2026-09-28): (a) after a statement import completes, and (b) after the user adds a MANUAL transaction to an account that already has prior similar transactions (a sign the user logs this account by hand regularly).
6. Import reminders are allowed on ANY account that has had at least one statement import, including bank-synced accounts (for example Monobank); add-transaction reminders stay for manual accounts (accounts.institution IS NULL).
7. Trigger (b) of the contextual offer: the offer appears when the user adds the SECOND manual transaction on an account, that is at least ONE earlier source='manual' transaction on the same account within the last 30 days (coordinator's reading of the user's answer "3 but 2x" / "for the second transaction"; the user may still correct it). No category/payee matching.
8. User decisions 2026-09-28 (resolving the plan's "Open questions for the user"): account-detail entry point = a bell icon button in the header, left of Edit (Q1). Settings row = its own card directly below System (Q2). New-reminder defaults: import = monthly on day 1 at 19:00, add transactions = daily at 20:00 (Q3). A reminder firing while Kiko is open shows banner + list + sound (Q4). Interruption level: Active for reminders, Passive for the "Reminders paused" notice (Q5, recommendation taken as-is). Backups include reminders (Q6). Import reminder tap opens the account and shows the file picker once (Q7, recommendation taken). Add-transactions tap opens the account screen; if the account has exactly one holding, it opens the new-transaction form directly (Q8). Offer (b) — CHANGED from the plan's recommendation — appears on ACCOUNT DETAIL ONLY, never on holding detail (Q9). Decision 7 reading confirmed: at least 2 distinct entry times in the last 30 days, a transfer's two legs counting once (Q10). Per-account reminders only in 1.2, no global reminder (Q11). Monthly on day 29-31 fires on the month's last day, with a hint in the form (Q12). Every-N-days range is 2-365 (Q13). "Tomorrow" snooze = the same time of day, one day later (Q14). en/uk wording: the user reviews the key table at each BATCH READY (Q15). Two standing directives also recorded: (1) user questions during this track go to the coordinator pff-ios-9b by SendMessage, never AskUserQuestion; (2) until a build passes App Store review, the user is the only user of the app — a backward-compatibility edge case (for example an old `.kiko` backup with no reminders key) takes the simplest option with a one-line documented known limit (it restores with no reminders), but the migration itself stays crash-safe, and a pre-migration backup must still restore successfully after the migration runs (proven by a test).

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
- Storage: new additive migration; reminder rules in a new `reminders` table, one row per (account, kind) — no global reminder; two nullable `settings` columns hold non-rule state (offer dismissals, notifications-deliverable-since); settingsRepo-style repo. Mind the op-sqlite single queue on app open.
- No aps-environment entitlement, no UIBackgroundModes needed for local notifications. Check PrivacyInfo.xcprivacy if UserDefaults is used in the native module.
- Compliance: 2.5.4 (local notifications allowed), 2.5.16 (content relates to app), 4.5.4, 5.1.2(i) (never required); 5.6: the Reminders UI ships visible, no flag gating.
- Contextual offer: shown only when the account has no reminder yet; one-time and dismissible per account (a dismissal is remembered, so the offer never repeats as nagging); it is an in-app, non-modal prompt, never a notification; it opens that account's reminder page prefilled with the matching type (import or add transactions).

## Known limits
- Non-Gregorian device calendar (Buddhist, Japanese, Hebrew, Islamic, …): a scheduled reminder never fires, because the trigger's floating year/month/day components (Gregorian, from JS) are matched against `Calendar.current`. Accepted for 1.2 under the only-user directive (decision 8); fix = in `KikoRemindersCenter.swift`, when `Calendar.current.identifier != .gregorian`, convert the Gregorian components to `Calendar.current` components (era included), still with no time zone. The "Tomorrow" snooze is unaffected (it uses `Calendar.current` throughout).
- Old backup: a `.kiko` from before reminders has no `reminders` key and restores with no reminders (`snapshot.reminders ?? []`). After a restore, `replanRestoredReminders` restarts every reminder's ignored count (`activeSince = now`) before the first re-plan, so a restored reminder is not back-off paused for the time the backup was away.
- Drain-then-write: `drainReminderResponses` empties the native queue before `recordEngagements` commits. If that write fails, the drain rejects: those taps are lost (logged), they are neither recorded nor routed, and back-off may count a tapped fire as ignored. A failed LATER plan step (`authorizationStatus`, `planInputsQuery`, `replaceRequests`) still routes the drained taps. The fix needs a native "ack after commit" API.
- Time change between a "Tomorrow" tap and the snooze: the planner frees the slot at the CURRENT `minuteOfDay`, but the native snooze fires at the OLD time. That day gets one notification, at the old time, and never a duplicate.
- A restore copies `notifications_deliverable_since` from the source device (the settings row is restored whole). The first sync on a device without permission clears it.
- A queued response saved by an older development build (no `requestIdentifier`) is dropped by the JS parser. Development builds of this unmerged feature only.
- The ignored count starts at the first sync that sees permission, not when the user turned it on, so a pause can come later than expected; early only in the permission off-then-on-while-closed case below.
- More than 64 pending requests (20+ reminders): `planAllReminders` keeps the earliest 64, so a reminder's paused notice can be cut, and the reminder then pauses with no notice shown.
- A "Tomorrow" snooze copies the original body natively, so its day count is one day stale.
- A reminder that fires while Kiko is open shows the text of the last re-plan; a transaction added minutes before does not change it (a data write triggers no re-plan).
- `planInputsQuery` drives from the `transactions_source` index and scans every import/manual row: a performance cost, not a correctness issue.
- The "Tomorrow" action (options `[]`) may run while the device is locked; the DB key read can then fail with errSecInteractionNotAllowed. Task 5/5 device test; fix = `.authenticationRequired` if it reproduces.
- Permission off then on while the app is closed can pause a reminder early.
- A queued "Reminders paused" notice delivered after the user re-enables notifications is misleading.
- A crash between `clearSnoozes` and `replaceRequests` can cause one duplicate notification.
- A narrow race between the response drain and the request replace can free a new snooze's slot once.
- Spring-forward: a nonexistent local time (for example 03:30 on the Kyiv spring-forward day) is sent as-is; whether iOS fires or skips it is unverified (device test).
- The offer counts a categorized opening-balance or balance-edit row, when the user later sets a category on it (`setCategory`). This can only cause an extra offer, never a missed one.
- Two separate exchanges between the same two holdings with the same `time` in ms count as one entry for the offer (the form seeds `time` from `Date.now()`, so this needs the same picked instant twice).
- Editing the date of one leg of an exchange gives the legs different `time`s, so that transfer counts twice for the offer. This can only cause an extra offer.
- A binary without the `KikoReminders` native module plans nothing and routes nothing. Every trigger logs "re-plan failed", and the response subscribe logs once. The app does not crash.
- An import-reminder tap opens the file picker from an effect on `AccountDetail` once its loading gate is ready. That can be during the push transition; whether the picker then presents or silently does not show is unverified (device check).
- After a restore, the ignored-count restart (`activeSince = now`) also turns off the smart skip for the next occurrence: data from before the restart never skips, so that occurrence fires even if data arrived since the previous one.
- Restore race: a re-plan that started between the restore's commit and the `restartIgnoredCounts` write (for example, the app went to the background at that moment) can still back-off pause a restored reminder. Closing it inside `restoreDataSnapshot`'s transaction would break the pinned restore round-trip.
- A restored `last_snoozed_at` from another device keeps that slot free until it goes stale, although this device has no such snooze request: after a cross-device restore inside a snooze window, at most one occurrence is missed.
- On a cold first visit of a day (no cache), the offer card can appear after the balance and holdings have rendered and push the content down (device check). A revisit is served from the cache. Fix if noticeable: a readiness flag from the hook that joins the page's `isReady`.

## Decisions (user, 2026-09-29)
The user accepted all six overnight defaults as built ("accept all defaults").
1. A synced account with no statement import keeps the bell; its Reminders page shows the empty-state caption `reminders.emptyNoKinds` (the caption keeps its final "."). The bell stays on every account.
2. No in-form Delete: a reminder is deleted only from its page row's touch-and-hold menu (`kiko-no-confirm-sheet-in-form`).
3. At most one reminder offer per visit of the account page; after the user decides one offer, the other does not show until the next visit.
4. Balance rows do not count toward the add-transactions offer (opening-balance and balance-edit rows: manual, no category, no transfer marker).
5. The one-holding shortcut: only an add-transactions tap opens `TransactionForm` directly, and only when the account has exactly one open holding and that holding takes transactions (not ledgerless: card, cash, crypto asset, jar). For a single deposit, bond, property item, metal or loan holding, the tap opens the account page.
6. A tap on the "Reminders paused" notice opens that account's Reminders page (`AccountReminders`, above the account page), where the user can turn the reminder on again.
7. Every-N-days unit: `forms.units.days` is a plural key (en `days_one`/`days_other`, plus `_few`/`_many` duplicates of the plural form, kept for the `typeof en` parity rule; uk `days_one`/`days_few`/`days_many`/`days_other` = день/дні/днів/дня). Its count is the interval field value via `everyDaysPluralCount` (`src/reminders/rules/reminder-draft.ts`); an empty or non-whole field gives count 0 (uk "днів", en "days"). Read the locale files for the current strings.

## Open items for the planner
- Manual account = accounts.institution IS NULL (isSyncedAccount in src/holdings/deletable/deletable.ts); resolved by user decision 6 — import reminders apply to any account with >=1 statement import, including synced accounts; add-transaction reminders stay manual-only.
- Device tests: reboot, app update, time-zone change, DST.
- Competitor gaps not verified: Spendee, Monefy, Money Lover, CoinKeeper, Day One, Daylio.
- "Prior similar transactions" for trigger (b) resolved by user decision 7 — as built: at least 2 distinct user-entered entries (a transfer or a payment with change counts once; balance rows excluded) created since local midnight 30 days ago.

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
