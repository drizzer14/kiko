## Reminders (local notifications)

`src/reminders/` owns user-set local reminders. Each unit's header
comment holds its rules; this section says where each part lives and
what a change must keep.

- **Storage.** Table `reminders` (`src/db/schema.ts`): one row per
  `(account_id, kind)` (unique index `reminders_account_kind`;
  `account_id` is NOT NULL, so there is no global reminder), a NO
  ACTION foreign key to `accounts`. `schedule` is the whole
  `ReminderSchedule` as JSON; the planner re-validates it with
  `isReminderSchedule`, since a restored row may carry another build's
  shape. `last_snoozed_at` is the latest "Tomorrow" tap while that
  snooze is still pending. Two nullable `settings` columns hold state
  that is not a rule: `reminder_offer_dismissals` (JSON map account id
  -> dismissed kinds; `settingsRepo.dismissReminderOffer` /
  `isReminderOfferDismissed`; `recordReminderOfferDismissal(databaseTransaction,
  accountId, kind)` is the same read-modify-write inside a caller's own
  `write()`) and `notifications_deliverable_since`
  (`settingsRepo.notificationsDeliverableSinceQuery` /
  `setNotificationsDeliverableSince`). Read `schema.ts` for the
  columns; do not copy them here.
- **Repository.** `remindersRepo` (`src/reminders/repo/reminders.repo.ts`).
  Page reads: `listByAccountQuery`, `byIdQuery`, `hasImportQuery`
  (`LIMIT 1`, any holding of the account; only the after-import offer
  reads it), `listWithAccountQuery`
  (every reminder with its account's name/institution/archivedAt, in
  accounts-list order: `sort_order`, `created_at`, `id`; it reads no
  transactions, so the list subscribes to `reminders` and `accounts`
  only), and `manualEntryDaysQuery(accountId,
  since)` (see "Offer"). Restore: no repository method:
  `restoreDataSnapshot` inserts each restored reminder with `activeSince`
  set to the restore time and `lastSnoozedAt` null, the pause and
  engagement columns kept, inside its own transaction. User writes: `create`,
  `update` (a changed schedule restarts `activeSince` and ends a
  back-off pause, but not a user pause; it keeps a pending snooze,
  because iOS keeps it), `setPaused` (resume restarts `activeSince`; a
  no-op when already in the target state), and `remove` (one `write()`:
  `DELETE ... RETURNING` the account and kind, then
  `recordReminderOfferDismissal` for the deleted row, so the offer for
  that kind never returns on that account; an unknown id records
  nothing). Re-plan side: `hasAnyQuery`, `planInputsQuery`,
  `recordEngagements`, `markBackoffPaused`, `clearSnoozes`. Read the
  file for signatures.
- **Rules.** `src/reminders/rules/` is pure.
  `eligibleReminderKinds(account)` takes the account's `kind` and
  `institution`: an import reminder is allowed on every BANK account no
  sync owns (`kind === 'bank' && !isSyncedAccount(account)`, user
  decision 2026-10-01), ones with no import yet included, and on no
  other account, since only such an account takes a statement import
  (`account-detail.screen.tsx` shows Import and handles the
  `importStatement` intent only there, and `importRows` refuses a
  synced account); add-transactions reminders need a non-synced account
  of any kind.
  The scheduler's `isSchedulable` uses the same function (with
  `planInputsQuery`'s `accountKind` column, since that row's `kind` is
  the reminder's), so a reminder the page shows as unavailable is never
  scheduled. With no
  import yet, an import reminder plans as usual with a null day count
  (body `reminders.notification.statementImportBodyNoData`); the first
  import is its first `lastDataAt`. The form draft helpers are exported
  from `src/reminders/rules/reminder-draft.ts` (read it for the current
  set). `withFrequency` preselects today's weekday when switching to
  weekly and 7 when switching to every-N-days. The interval field's
  plural "days" suffix takes its count from `everyDaysPluralCount` (the
  typed text), not from the validated interval, so the unit agrees with
  what the user typed even out of range. The page
  lists eligible kinds plus any saved kind that is no longer eligible.
  A saved reminder on a synced account is unavailable, of either kind;
  `reminder-row.component.tsx`'s `unavailableCaption` shows
  `reminders.unavailable.statementImport` or
  `reminders.unavailable.addTransactions` per kind. A synced account of
  any kind (a bank or crypto connect) has no eligible
  kind; with no saved reminder either, its page shows the caption
  `reminders.emptyNoKinds` instead of rows.
- **Summary.** `describeSchedule(schedule, t, firstDay, clock)`
  (`src/reminders/schedule/describe-schedule.ts`) reads the time on the
  device's clock (`clock` from `useTimeClock`; see "Time of day" in
  kiko-translator). The uk preposition comes from `{{at}}` and follows the
  hour as shown (`hourOnClock`), choosing between `reminders.schedule.at`
  and `reminders.schedule.atEleven`; the uk "о"/"об" rule itself lives in
  kiko-translator ("Time of day") — read it there.
- **Shared system status.** Any cached OS/system status (a permission,
  a sync status) that several screens show lives in ONE module store
  (`useSyncExternalStore`; see `src/monobank/sync-status/`,
  `src/reminders/permission/`), never in per-component `useState`.
- **Shared UI state across screens.** State two mounted screens must show
  identically (the Home/Statistics date range; see kiko-domain's 'The "no custom
  range = derive the default from now" pattern') lives in ONE module store read
  with `useSyncExternalStore`
  (`src/design-system/use-date-range-selection/`), never per-screen
  `useState`. The date range store resets when no reader is mounted, deferred
  one `Promise.resolve().then(...)` microtask with a `listeners.size === 0`
  re-check, so a same-commit swap of every reader keeps it; never
  `queueMicrotask`. The Statistics account and category picks
  (`src/design-system/use-statistics-filter-selection/`) are the exception:
  they live for the whole app session and never reset on unsubscribe (a pick
  survives a form opened over the companion; every launch starts on 'all').
  Tests that pick a filter reset them with
  `afterEach(resetStatisticsFilterSelection)` from
  `@kiko/test-support/reset-statistics-filter-selection`.
  The Tables period is kept the same way (`src/statistics/use-tables-period-selection/`): a
  session store, so a Tables screen opened again, or after a pop, starts on the last pick, not
  on a route param across stacks. Tests reset it with `afterEach(resetTablesPeriodSelection)` from
  `@kiko/test-support/tables-period-selection`.
  A reader publishes into the store in `useLayoutEffect`, never during
  render. The notification-permission store resets at once on
  `size === 0`: the deferral applies only where a whole-tree swap must keep
  the state.
- **Permission.** `useNotificationPermission()`
  (`src/reminders/permission/`) returns `{ status, request }` and never
  rejects. `status` is ONE module-level store read through
  `useSyncExternalStore` (the `src/monobank/sync-status/` pattern), so a
  read or an answer in one instance re-renders every mounted one: the
  reminder form's prompt clears the list's notice with no AppState
  change. Never hold it in per-component `useState` (the notice then
  stayed until tapped). It reads the status on mount and on every
  AppState `active` (for a change made in iOS Settings), and exposes no
  public refresh. A generation counter, bumped on every publish, drops a
  read that started before a newer answer (the system prompt itself
  fires AppState `active`, so its read races `request()`). When the last
  instance unmounts the store resets to `undefined`: nothing watched
  iOS Settings meanwhile, so a remount never shows a stale status (this
  also isolates tests, with no test-only reset export).
  `request()` is the only way to show the system prompt: a direct
  `remindersNative.requestAuthorization` call publishes no answer to the
  store and does not count a failed prompt as denied. Semgrep
  `kiko-no-direct-notification-permission-request`
  (`rules/semgrep-prewrite.yml`) denies it outside
  `src/reminders/permission/`, tests, and `src/test-support/`.
  `useNotificationPreAlert(onAnswered?)`
  is the one ask flow: pre-alert sheet, then `request()` after the
  sheet has closed, then `replanReminders()`, then `onAnswered`. iOS is
  asked only (a) on a form save while `status === 'notDetermined'` or
  (b) from a reminders list's NoticeBanner. `usePermissionNotice(hasReminders)`
  (`src/reminders/permission/`) builds that notice and the pre-alert
  sheet props for BOTH lists (the account page and Settings >
  Reminders). With no saved reminder there is no notice. A
  denied status still saves; the page's banner then offers
  `Linking.openSettings()`.
- **Re-plan after a write.** `replanReminders` (exported from
  `src/reminders/use-reminder-scheduler/`) is the module-level
  single-flight trigger that the scheduler hook ALSO uses. Every
  reminder write (form save, pause, delete, permission answer), and
  every write that changes what may be scheduled (an account delete,
  which takes its reminder rows; a bank or crypto connect,
  after its sync whatever the result, and a successful disconnect, since
  a synced account sends no reminder), calls it rather than
  `syncReminders` directly, so an older re-plan can never overwrite a
  newer one. A page write goes through `writeThenReplan(write, t)`
  (same unit): a failed write shows the save-error alert and does not
  re-plan. After a backup restore, `importData` calls
  `replanRestoredReminders()` instead (see "Backup/restore").
- **Screens.** `ReminderForm` (`src/screens/forms/reminder-form/`,
  params `{ reminderId } | { accountId, kind }`) and `AccountReminders`
  (`src/screens/settings/account-reminders/`, params `{ accountId }`) — `AccountReminders` is registered in the Accounts stack.
  The Settings stack lives in `src/navigation/settings-stack/` (its screen list is the code's).
The Home AND Settings stacks register `TransactionForm`, `AccountForm` and `HoldingForm`
  (`HoldingFormParams`, no `returnTo`; neither stack passes `returnTo`) as
  well as the Accounts stack, because leaving the tab resets its stack and would lose the
  transaction form's draft; both take options from `src/navigation/swapped-form-options/`. A form
  that stays mounted underneath uses `navigate`, but a `HoldingForm` opening another `HoldingForm`
  uses `push` (navigate to its own name only changes params).
  The Statistics stack (`src/navigation/statistics-stack/statistics.stack.tsx`) registers both too,
  because its `TransactionForm` opens them from an empty holding picker. The type-level
  `MissingCreateForms` assertion in `src/navigation/types/types.test.ts` requires `AccountForm` and
  `HoldingForm` in every stack param list that has `TransactionForm`; add a new stack to that
  test's union.
  `ReminderForm` is registered in BOTH the Accounts and Settings
  stacks, so its props type is structural (`route.params:
  ReminderFormParams` plus the `goBack`/`setOptions` it reads), not
  `NativeStackScreenProps` of one stack. `Reminders`
  (`src/screens/settings/reminders/`, Settings stack) lists every
  reminder under a heading for its account: the account's
  `EntityIconTile` (its stored icon/color, else the kind defaults, as
  on the account card) beside its name, so `listWithAccountQuery`
  reads the account's `kind`, `icon`, and `color` too. It uses the
  same `ReminderRow` and has no Add (reminders are created from an account's
  page). It opens from the Reminders row (`settings-row-reminders`) in the Settings
  group card (order: Categories, Reminders, Transaction templates;
  `src/screens/settings/settings/settings.screen.tsx`). The account page is reached from a
  native `bell` bar item in `AccountDetail`'s
  `unstable_headerRightItems`, left of Edit in its own glass capsule
  (see kiko-design-system's "Header bar items"), shown on every account
  EXCEPT a live implicit property or debt account (which takes no new
  reminders; see "Tap routing" below). The form has NO Delete: a reminder is deleted only
  from the page row's touch-and-hold `CardContextMenu`, the same as a
  transaction.
- **Offer.** `useReminderOffer({ accountId, account, settings, trigger })`
  (`src/reminders/offer/`) returns `{ kind, dismiss }` or `undefined`.
  It takes the page's OWN account and settings rows, because a second
  subscription would queue the same reads again on op-sqlite's one
  worker. With no `trigger`, it does no reads. The offer shows only
  while the account is not archived, can have that kind
  (`eligibleReminderKinds`), has no reminder of that kind, and was not
  dismissed there (`isReminderOfferDismissed`). Deleting a reminder
  counts as a dismissal: a delete is the user's decision, so the offer
  for that kind never shows again on that account (the bell and Settings
  still add one). A paused reminder (user or back-off) keeps its row, so
  it blocks the offer too. KNOWN LIMITS: a delete made on a build that
  did not record it left no dismissal, so that offer shows once more
  until the user taps "Not now"; a `.kiko` restore replaces the
  dismissals with the backup's. Each trigger read waits
  for that decision. `afterImport` reads `hasImportQuery` and needs a
  row: the import is the trigger (eligibility itself needs no import).
  `manualActivity` reads `manualEntryDaysQuery` only for an eligible
  (non-synced) account and needs at least 2 entries. The window starts
  at local midnight 30 calendar days back and is fixed once per mount.
  `manualEntryDaysQuery` counts only rows the user entered: `source =
  'manual'` AND (`category` OR `exchange_counterpart_holding_id` OR
  `change_group_id` set); opening-balance and balance-edit rows have
  none of these. It counts one key per entry: `coalesce(change_group_id,
  time || sorted holding pair, created_at)`, so a transfer's legs, or a
  payment and its change returns, count once even a second apart in
  `created_at`. Wiring: `AccountDetail` passes `route.params.reminderOffer
  ?? 'manualActivity'`. `reminderOffer?: 'afterImport'` is set by the
  `popTo` in `useImportResultSheet`, shared by BOTH import screens
  (`statement-import.screen.tsx`, `column-mapping.screen.tsx`). A per-mount `offerDecided` latch, set
  on accept and on a successful dismiss, makes the trigger `undefined`,
  so a visit shows at most ONE offer; a live implicit account (property or
  debt) always gets an `undefined` trigger, so it never shows one. Accept and dismiss both clear the
  param. Accept ("Set up") is the user's answer too: it opens the form
  at once, then records the decision through the offer's `dismiss`, so
  the offer never returns on that account even when the form is left
  unsaved; a failed write there is only logged (no alert over the
  form). A failed dismiss ("Not now") shows the save-error alert and
  keeps the card. The card (`ReminderOfferCard`) sits first in
  `account-detail-content`. The hook runs above the page's loading
  gate, so a cached offer is there on the first ready frame. There is
  no offer on holding detail (user decision Q9).
- **Planner.** `planReminder` / `planAllReminders`
  (`src/reminders/planner/`) are pure; the rules are in
  `plan-reminder.ts`'s header. The smart-skip rule changed more than once, so it lives only in
  `plan-reminder.ts`'s header and the spec's "Smart skip" (worked cases):
  read them, do not restate it here. `activeSince` plays no part in the
  skip. The ignored count
  starts at the latest of `activeSince`, `deliverableSince`,
  `lastEngagedAt` and `lastDataAt`; `lastSnoozedAt` frees the regular occurrence at the
  snooze minute. The sync passes `lastSnoozedAt: null` once data
  arrived at or after the snooze.
- **Scheduler.** `src/reminders/scheduler/sync-reminders.ts` has two
  steps, run in this order by every re-plan. `drainReminderResponses()`
  is the ONE reader of the native response queue: it drains it, stores
  the engagements (a tap on the paused notice is not engagement), and
  returns the responses. `syncReminders(t, now?)` does not touch the
  queue. It calls `registerCategories` with
  the active language's `reminders.notification.snoozeAction` and
  `hiddenPreviewsPlaceholder` on EVERY sync, before any
  `replaceRequests`. `reminderContent` gives a reminder the
  `kiko.reminder` category (the one "Tomorrow" action) and the paused
  notice `kiko.reminder.notice` (no action); the ids are
  `REMINDER_CATEGORY_IDENTIFIER`/`NOTICE_CATEGORY_IDENTIFIER` in
  `reminders-native.ts` and must equal
  `reminderCategoryIdentifier`/`noticeCategoryIdentifier` in
  `ios/Kiko/Reminders/KikoRemindersCenter.swift`. The request
  identifiers are a JS<->Swift contract too: `plan-reminder.ts`
  (`requestIdentifier`/`pausedNoticeIdentifier`) names a regular request
  `kiko.reminder.<reminder id>.<yyyyMMddHHmm>` (the local fire minute on
  the GREGORIAN calendar, `fireStamp`) and the paused notice
  `kiko.reminder.<reminder id>.paused`; a snooze is
  `kiko.snooze.<reminder id>`. The native "Tomorrow"
  (`ios/Kiko/Reminders/KikoNotificationDelegate.swift`,
  `requestsReplacedBySnooze`) rebuilds the first two to remove the regular
  request at the snooze minute and the paused notice, and `tomorrow`
  builds its day on `Calendar.gregorian` (`KikoRemindersCenter.swift`:
  `Calendar(identifier: .gregorian)`, time zone = autoupdatingCurrent),
  never `Calendar.current`, so its stamp equals `fireStamp` under any
  device calendar; it returns that Gregorian `LocalDateTime`, and
  `requestsReplacedBySnooze` reads it. Every `UNCalendarNotificationTrigger`
  takes `.floatingDateComponents` (`KikoRemindersCenter.swift`): the
  Gregorian DAY built into a noon Date and converted with
  `Calendar.current.dateComponents([.era, .year, .month, .day]`; the planned
  hour and minute pass through unchanged (a DST gap would shift a Date
  built at 03:30 to 04:30, away from the JS stamp). The components go over
  with NO `calendar:` and NO `timeZone:`. The trigger reads components in the
  device calendar, so a Buddhist or Japanese device needs that conversion;
  a `Calendar` on the components is banned, since it always carries a zone,
  the trigger is archived with it, and the reminder would stop floating
  with the device zone. `__tests__/reminders-gregorian-calendar.test.ts`
  pins it. Change the format on both sides together.
  `replaceRequests` also removes every DELIVERED notification in the
  `kiko.reminder` category (a regular reminder or a snooze) whose
  reminder has no planned request and no kept snooze
  (`orphanedReminderIdentifiers` in `KikoRemindersCenter.swift`), so a
  deleted or paused reminder's banner offers no "Tomorrow"; the paused
  notice (`kiko.reminder.notice`) stays. Then it gates
  on `hasAnyQuery` (no
  reminders -> `replaceRequests([], [])` and no plan-input query).
  Then it syncs `notifications_deliverable_since` from
  `authorizationStatus()` (written only when it changes; while iOS
  cannot show notifications, nothing is back-off paused), plans,
  persists back-off pauses, clears stale snoozes, and replaces the
  pending requests.
- **Mount.** `useReminderScheduler()`
  (`src/reminders/use-reminder-scheduler/`) runs in `AppRoot`
  (`App.tsx`), below `MigrationsGate` and `LockGate`. It re-plans on
  mount, on AppState `active` and `background`, on an i18n
  `languageChanged` event, and on `remindersNative.onResponse` (a tap
  that lands after the `active` re-plan drained the queue). It is
  single-flight with at most one queued follow-up via `replanReminders`,
  and it never rejects (a failed drain, plan or route is logged). A
  failed drain plans and routes nothing, since the plan must see the
  engagements first. A failed plan still routes the drained taps, since
  the queue no longer holds them. The `onResponse` subscribe loads the
  native module synchronously, so it is wrapped in `eitherSync`: on a
  binary without the module it logs once, gets a no-op `remove`, and
  on a real binary without the module, `drainReminderResponses` then also
  rejects on every trigger, so each one logs "re-plan failed" and plans
  nothing, without crashing the app. `use-reminder-scheduler.lazy-load.test.ts`
  pins only the mount: no throw, one log, and the other triggers still run
  (it mocks the scheduler).
- **Tap routing.** Every re-plan whose drain succeeded hands the responses
  it returned to
  `routeLatestResponse(responses, navigationRef)`
  (`src/reminders/routing/`), so every trigger routes. It routes the latest `open` response (the
  last one in the queue, which appends in tap order); a snooze never
  routes. A reminder that is gone (deleted,
  or deleted with its account) routes nowhere. `routeFor` is pure: an
  import reminder opens `AccountDetail` with `intent: 'importStatement'`;
  add transactions with exactly ONE open holding, of a type that takes
  transactions (`!isLedgerlessHoldingType(type)`,
  `src/holdings/holding-descriptor/holding-descriptors.ts`; grep
  `ledgerless: true` for the current ledgerless set), opens
  `TransactionForm { holdingId }` above `AccountDetail`, and otherwise
  `AccountDetail` only (a single ledgerless holding included);
  the paused notice opens `AccountReminders` above `AccountDetail`. An
  IMPLICIT account (`isImplicitAccount`: a live property or debt account)
  routes like any other account, since it has its own `AccountDetail` (its
  section heading on the Accounts screen opens it): the page title is
  `accountDisplayName(account, i18n.t)` (the stored name is an English
  sentinel while unrenamed; `routeFor` is pure but reads the module-level
  `i18n`, as the other non-React modules do), and a merged reminder on one
  opens `AccountDetail` only (its holdings are ledgerless), or its paused
  notice `AccountReminders` above `AccountDetail`. That AccountDetail has no
  Reminders bell and never shows the reminder offer (the screen passes
  `useReminderOffer` no trigger for a live implicit account), so nothing
  builds an entry point to create a reminder for one; a merged reminder that
  survives stays in Settings > Reminders (pause, delete) and is still
  scheduled, which is why `eligibleReminderKinds` is NOT narrowed for the
  implicit kinds (it also decides `isSchedulable` and the "available" state
  of a saved reminder). `AccountReminders` closes the last path to the
  create form: for a live implicit account it lists ONLY the reminders
  saved on it (`kinds = isImplicitAccount(account) ? saved : eligible ∪
  saved`; a saved one still reads as available, since `available` keeps
  using `eligibleReminderKinds`), so deleting the merged reminder leaves no
  unset `add_transactions` row to open `ReminderForm` in create mode. An
  implicit account with none saved shows the empty caption.
  `AccountDetail` takes an optional `kind` route param (the account's kind;
  every navigate site passes it: the Accounts heading row, the main-grid
  card, `routeFor`; a `popTo` with `merge` keeps the one already there):
  the header items are set before the account row loads, so the bell is
  decided from the loaded account's kind, else the `kind` hint, and with
  neither it is left out until the row loads, so it never flashes on an
  implicit account.
  A reminder NOTIFICATION never names its account (its title and body are
  generic catalogue text), so the planner needs no display name. The
  navigate is ONE `navigate('AccountsTab', { state })` carrying the whole
  Accounts stack, rebuilt from the root (`openAccountsPages`,
  `src/navigation/open-accounts-pages/open-accounts-pages.ts`, whose private `rebuiltStack`
  builds it; the rule and its known limit are in "Pane navigation" in SKILL.md).
  Two nested navigates back to back lose
  the first, because the second replaces the tab's nested params before
  the stack reads them (`route-response.navigator.test.tsx`, on the real
  routers). Before `navigationRef.isReady()` (a tap that launched
  the app) the route waits for the container's `ready` event. Routes that
  waited all navigate in the same tick, so the newest one's stack wins.
  `navigationRef` (`src/navigation/navigation-ref/`) is the
  `NavigationContainer` ref in `AppRoot`, below `LockGate`, so nothing
  routes before unlock. No URL scheme and no `linking` prop. On
  `intent: 'importStatement'`, `AccountDetail` waits for its loading gate,
  clears the param, then opens the file picker once, on a bank account
  only.
- **Account delete.** `accountsRepo.remove` first runs
  `cascadeLinkedRowsDatabaseTransaction` (`transactions.repo.ts`) over ALL the
  account's holdings, closed ones included, so the other legs of an Exchange,
  Convert or split and a deposit's contributions on OTHER accounts' holdings go
  with it, in the same transaction. The confirm text for it is
  `removeHoldingsNoticeOf(holdingIds, t)` (`transactions/remove-notice/`, which
  composes `transactionsRepo.removeHoldingsPlan` and `removeHoldingsNotice`),
  whose sentences are the `holdings.deleteLinked.*` keys. It also deletes the account's
  `reminders` rows in the same transaction, before the account row (NO
  ACTION FK), next to the `sync_state` delete. The Accounts screen runs
  it through `writeThenReplan`, so the deleted reminders' pending
  requests go at once. After the commit it also clears the account's own
  Keychain items (the list in `clearKeychainItems`,
  `src/accounts/accounts.repo.ts`): a failed first
  Connect stores a token or key pair under the account's id while the
  account still reads as manual, so a deletable account can own one. The
  clear never rejects (a failed one is logged): the delete has committed,
  and a rejection would show the save error and skip the re-plan. On the
  create form, a Binance connect that fails clears only the write it made, and only
  when row P does not exist, read through
  `accountsRepo.exists` (the write queue rule in the repository section of SKILL.md;
  `grep -rn accountsRepo.exists src` lists the callers), so no pair stays
  under an id with no account. A failed read keeps the keys. The same helper
  (`clearPairIfRowMissing` in `account-form.screen.tsx`) also clears the write stored after
  the field unmounted. Both go through `clearCredentialsIfWrittenBy`, which compares the
  per-write token (in memory, recorded after `setGenericPassword` resolves, dropped after a
  reset resolves; a restart loses tokens, so nothing is cleared: fail safe) inside the
  per-account serialized Keychain write chain. The `readCredentials` access-policy repair is
  one serialized compare-and-set step (re-read inside the step, re-save the same pair only if
  unchanged; it records no new token); `readCredentials` calls this serialized repair, never an
  unserialized re-save (that could restore a pair a clear had just removed; pinned by "the
  access-policy repair is one serialized step > leaves a pair that was cleared between its read
  and its save cleared" in `binance.credentials.test.ts`). No step calls another serialized step (no
  re-entry). Save writes
  the picked icon in the same `saveFormAccount` write (a second write that
  failed after the row existed would read as no row).
- **Backup/restore.** `DataSnapshot.reminders` is read ordered by
  `id`. `restoreDataSnapshot` deletes `reminders` before
  `holdings`/`accounts` and inserts them last, with `snapshot.reminders
  ?? []`, so a pre-reminders `.kiko` restores with no reminders. The
  settings row comes from the backup except the columns this device
  keeps (`KEPT_FROM_LIVE_ON_RESTORE`; read the file), so of the two
  reminder settings columns only `reminderOfferDismissals` comes from the
  backup: `notificationsDeliverableSince` stays this device's, because a
  file from another device cannot know when iOS first allowed
  notifications here (`restore-across-reminders-migration.test.ts` pins the old-backup
  case). `importData` awaits
  `replanRestoredReminders()` (`src/reminders/use-reminder-scheduler/`)
  right after the snapshot commits, ahead of every later step: the
  re-plan drops the replaced data's pending requests and snoozes, and a
  later step that threw would leave them on the device to fire beside
  the restored reminders; the screen applies the restored language only
  after `importData` resolves, and that language change re-plans too, so
  it sees the restarted counts. The restart itself (counted from the
  backup, every reminder would read as ignored and back-off pause at once;
  a restored snooze has no request on this device) happens inside the
  restore's transaction, so a kill or a re-plan right after the commit
  cannot see the backup's start. The helper runs
  `remindersNative.replaceRequests([], [])` (every pending request goes,
  snoozes included: a snooze pending here belongs to the replaced data
  and would fire beside the regular reminder), then `replanReminders()`.
  A failed drop is logged and still re-plans; it never rejects.
- SQLite's multi-argument `max(a, b)` returns NULL as soon as one
  argument is NULL; for "latest of a column and a value" use
  `coalesce(max(col, v), col, v)` (see `latest()` in
  `reminders.repo.ts`).
