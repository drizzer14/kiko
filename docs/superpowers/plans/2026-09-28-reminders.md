# Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User-configured local reminders (statement import; add transactions) per account, with smart skip, back-off, a Settings list, a per-account page, contextual offers, tap routing, and a "Tomorrow" snooze.

**Architecture:** An app-local TurboModule (Swift core + a thin ObjC++ adapter) wraps `UNUserNotificationCenter`. JS owns every decision: a pure planner turns reminder rows + per-account data timestamps into at most 64 one-off calendar requests (floating local time), and a scheduler replaces the pending set on launch, foreground, background, language change, and every reminder write. Storage is one additive migration: a `reminders` table (including `last_snoozed_at`) and two nullable `settings` columns (`reminder_offer_dismissals` JSON, `notifications_deliverable_since` integer).

**Tech Stack:** RN 0.87.1 New Architecture (app-level `codegenConfig`), Swift + ObjC++, op-sqlite + Drizzle, i18next, fnts, ts-pattern, Jest/RNTL.

**Spec:** `docs/superpowers/specs/2026-09-27-reminders-design.md` (the 7 user decisions are binding).

## Global Constraints

- Own native module; no expo-notifications, no notifee, no new npm dependency (all deps are exact-pinned; a new one needs user approval + an exact version; none is expected).
- Notification text: no account name or identifier, no amount or balance, no app name in the TITLE. Informational wording.
- Interruption level `active` (reminders) or `passive` (the final back-off notice). NEVER `timeSensitive`.
- Permission: request full authorization only on a reminder save while status is `notDetermined`. Never at launch.
- Pre-alert: ONE "Continue" button, no Cancel, no "Allow" label. Denied: keep the reminder, show a non-modal banner with a button that runs `Linking.openSettings()`.
- 64 pending requests per app. Re-plan on launch, foreground, background, language change, and after every reminder write or data restore.
- Import reminders: any account with >= 1 `source = 'import'` transaction (synced accounts included). Add-transaction reminders: manual accounts only (`isSyncedAccount(account) === false`, `src/holdings/deletable/deletable.ts`).
- Offer (b) fires on the SECOND manual transaction: >= 2 distinct `created_at` values among `source = 'manual'` rows of the account in the last 30 days. No category/payee matching.
- Guideline 5.6: the UI ships visible, no flag. No test-only code in `src/` (mocks live in `jest/setup.js`; no test counters/seams exported from `src/`).
- No `aps-environment` entitlement, no `UIBackgroundModes`, no Info.plist key (local notifications need no usage string). `PrivacyInfo.xcprivacy` already declares `NSPrivacyAccessedAPICategoryUserDefaults` / `CA92.1`; the native response queue uses the app's own UserDefaults, so no change there; the Task A2 check confirms it.
- Code style: fnts first (`maybe`/`foldMap`/`pipe`/`guard`), ts-pattern for closed unions, full-word identifiers (no `prev`, `idx`, `e`, `res`, `val`, …), `@kiko/<feature>` barrels, folder-per-unit, `.props.d.ts` for type-only files, every write inside `write()`/`db.transaction()`, no full-table select inside a write.
- Dates: calendar arithmetic on local components (`new Date(y, m, d + k)`), never `+ DAY_MS` (memory: DST fixed-ms fixture artefact). DST tests set `process.env.TZ = 'Europe/Kyiv'` in `beforeAll` (precedent `src/statistics/buckets/buckets.test.ts:84`).
- Shared files (settings screen, navigation types, account/holding detail, import screens): small additive edits only. No visual change to any locked visual (kiko-design-system "Locked decisions").
- uk strings use "Кіко" and the typographic apostrophe `’`. The user reviews every new en/uk key before any deploy that ships them.

## Migration index (read before CS-B)

- Runner (`src/db/run-migrations.ts`): `COUNT(*)` of `__drizzle_migrations` = applied entries; applies `journal.entries.slice(count)` in journal ORDER; resolves each entry's SQL by `m${idx.padStart(4,'0')}` in `drizzle/migrations/migrations.js`. So journal POSITION decides what runs, `idx` decides which SQL. Indexes are a namespace shared by every branch.
- As built: 0043 and 0044 (Round A) are on next, and `0045_add_reminders` follows 0044 on next (next 61644398). The next free migration index is **0046**.
- HARD GATE: CS-B merges into next, and any build containing CS-B is deployed to a device, ONLY after next's journal tail already contains 0043 and 0044, with NNNN directly after that tail. If the tail is different at that time, renumber.
- Files that change on renumber: `drizzle/migrations/NNNN_add_reminders.sql` (file name), `drizzle/migrations/meta/NNNN_snapshot.json` (file name; `prevId` = the id of the newest snapshot on next), `drizzle/migrations/meta/_journal.json` (entry `idx` and `tag`, placed last), `drizzle/migrations/migrations.js` (import line + `mNNNN` key), `src/db/schema.reminders.test.ts` (the tag string). The scribe then updates kiko-architecture's "Next free migration index" line. If Round A added a snapshot, delete these four artifacts, merge next, and re-run `npx drizzle-kit generate --name add_reminders` rather than hand-edit `prevId`.

## Review Focus

1. A DST day (Kyiv spring-forward 2027-03-28 03:30 does not exist; fall-back 2026-10-25 03:30 happens twice): the reminder fires once, on that day, near the chosen time. Pinned in Task B2 tests.
2. Monthly on day 29/30/31 in a shorter month or February (leap and non-leap): it fires on that month's last day, never skips the month. Pinned in Task B2.
3. The user changes time zone and does not open the app: the reminder fires at the chosen LOCAL time in the new zone (floating `DateComponents`, no `timeZone`). Pinned in A2 (Swift builds components without a time zone) and B3 (requests carry local components, never instants).
4. Many accounts (for example 20 accounts x 2 kinds): only the earliest 64 requests are pending, and the kept snoozes still fit. Pinned in Task B3.
5. A tap on a notification for a deleted account or reminder, or while the app lock is up: no crash; no navigation for a missing account; routing runs after unlock. Pinned in Task D2.

---

## Change sets

| CS | Scope | Non-test files | Mutated files* | Depends on |
|---|---|---|---|---|
| A | Native module + JS wrapper | 14 | 2 | next 49097442 |
| B | Storage, pure schedule/planner, scheduler, app wiring, backup | 28 | 15 | A; Round A 0043/0044 on next |
| C1 | Per-account page, reminder form, permission flow, account-detail entry | 30 | 13 | B |
| C2 | Settings > Reminders list + contextual offers + restore re-plan | 18 | 10 | C1 |
| D | Tap routing, "Tomorrow" category, hidden-preview placeholder | 12 | 7 | C2 |

\* The `mutation.sh` filter: `.ts/.tsx`, not tests, `index.ts`, `.styles.ts`, `.d.ts`, `i18n/locales/`, or `scripts/checks/`. Every CS is far below the 30-file cap.

Why this split: all native code sits in CS-A, so there is one pod-install and Release-build round. CS-A's wrapper gets its first production consumer in CS-B, so merge A and B back to back. Knip counts test imports as use (test files are Jest entries), so A is green alone. If knip still reports the wrapper, merge A and B together. Do not add an ignore entry. C is split in two to stay under 30 files: C1 gives the create/edit path, and C2 adds the list and the offers. No release is cut from next until D is merged (5.6: no half-feature in a shipping build).

Per CS, after all its tasks: `make verify` (lint, full Jest, then `check:all`); run it until it is green. Then the coordinator runs `KIKO_MUTATION_BASE=<that CS's own base sha> make deep`, detached, and awaits only the exit code. The BATCH READY message gives the base sha and the mutated-file count.

---

## CS-A — Native module (no UI)

Base: the reminders branch after Task A0.

### Task A0: Sync with next (ops)

- [ ] `git -C /Users/drizzer14/orca/workspaces/pff-ios/reminders merge 49097442` (merge next into reminders in THIS worktree, never in the main checkout). Resolve nothing by hand without asking; the spec/plan docs do not conflict.
- [ ] `npm ci` (the exact-pinned lockfile). Check: `npm run check:deps` green.
- [ ] Record `git rev-parse HEAD` as the CS-A base sha.

### Task A1: TurboModule spec + JS wrapper (developer; tests first)

**Files:**
- Modify: `package.json`: add `codegenConfig` `{ "name": "KikoSpecs", "type": "modules", "jsSrcsDir": "src/reminders/native", "ios": { "modulesProvider": { "KikoReminders": "RCTKikoReminders" } } }` (app-level config, read by `node_modules/react-native/scripts/codegen/generate-artifacts-executor/generateRCTModuleProviders.js`).
- Create: `src/reminders/native/NativeKikoReminders.ts`. Codegen needs the file name `Native*` with one dot (`@react-native/codegen` `filterJSFile`). Record this in `docs/harness/documented-exceptions.md` if any naming check objects.
- Create: `src/reminders/native/reminders-native.ts`, `src/reminders/native/index.ts`.
- Modify: `scripts/checks/feature-imports.js`: add `'reminders'` to `CONTAINERS`.
- Modify: `jest/setup.js`: add a global `jest.mock('@kiko/reminders/native/NativeKikoReminders', …)` with jest.fn defaults (`authorizationStatus → 'notDetermined'`, `requestAuthorization → true`, `replaceRequests → undefined`, `registerCategories → undefined`, `drainResponses → '[]'`, `onResponse → { remove }`).
- Modify: `docs/harness/documented-exceptions.md` (only if needed).
- Test: `src/reminders/native/reminders-native.test.ts`.

**Interfaces (produces):**
```ts
// NativeKikoReminders.ts (the codegen spec)
export interface Spec extends TurboModule {
  authorizationStatus(): Promise<string>;
  requestAuthorization(): Promise<boolean>;
  replaceRequests(requestsJson: string, keepSnoozeReminderIds: ReadonlyArray<string>): Promise<void>;
  registerCategories(snoozeTitle: string, hiddenPreviewsBodyPlaceholder: string): void;
  drainResponses(): Promise<string>;
  readonly onResponse: CodegenTypes.EventEmitter<string>; // payload: reminderId
}
export default TurboModuleRegistry.getEnforcing<Spec>('KikoReminders');

// reminders-native.ts
export type NotificationAuthorization = 'notDetermined' | 'denied' | 'authorized';
export type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number }; // month 1-12
export type NativeReminderRequest = {
  identifier: string; reminderId: string; accountId: string;
  kind: 'statement_import' | 'add_transactions';
  title: string; body: string; interruptionLevel: 'active' | 'passive';
  fireAt: LocalDateTime; categoryIdentifier?: string; threadIdentifier: string;
};
export type NotificationResponse = { reminderId: string; action: 'open' | 'snooze'; respondedAt: number };
export const remindersNative: {
  authorizationStatus(): Promise<NotificationAuthorization>; // provisional/ephemeral map to 'authorized'; unknown maps to 'denied'
  requestAuthorization(): Promise<boolean>;
  replaceRequests(requests: readonly NativeReminderRequest[], keepSnoozeReminderIds: readonly string[]): Promise<void>;
  registerCategories(snoozeTitle: string, hiddenPreviewsBodyPlaceholder: string): void;
  drainResponses(): Promise<NotificationResponse[]>; // malformed JSON or bad entries → dropped (eitherSync + guard)
  onResponse(listener: () => void): { remove: () => void };
};
export const REMINDER_IDENTIFIER_PREFIX = 'kiko.reminder.';
export const SNOOZE_IDENTIFIER_PREFIX = 'kiko.snooze.';
```

- [ ] Write failing tests: status mapping (each native string; unknown → `'denied'`); `replaceRequests` passes `JSON.stringify(requests)` + the id list; `drainResponses` parses valid entries, drops an entry with a missing `reminderId` or an unknown `action`, returns `[]` for `'not json'`.
- [ ] `npx jest src/reminders/native` → FAIL.
- [ ] Implement. `npx jest src/reminders/native` → PASS. `npm run check:feature-imports && npm run check:knip && npm run check:typecheck` → green.
- [ ] Commit (explicit paths).

### Task A2: Swift core, delegate, ObjC++ adapter, Xcode wiring (developer)

**Files:**
- Create: `ios/Kiko/Reminders/KikoRemindersCenter.swift`: `@objc public final class KikoRemindersCenter: NSObject`, `@objc public static let shared`:
  - `authorizationStatus(completion:)` maps `UNAuthorizationStatus` to `"notDetermined" | "denied" | "authorized" | "provisional" | "ephemeral"`.
  - `requestAuthorization(completion:)` uses `[.alert, .sound]` (no badge).
  - `replaceRequests(json:keepSnoozeReminderIds:completion:)` decodes a `Codable` request array; reads pending requests; removes every `kiko.reminder.*` request and every `kiko.snooze.<id>` request whose id is not kept; adds the new requests in the given order until pending reaches 64. Each request uses `UNCalendarNotificationTrigger(dateMatching: DateComponents(year:month:day:hour:minute:) /* no timeZone: floating */, repeats: false)`. Content sets `interruptionLevel` (`.active`/`.passive`), `sound = .default` only for active, `threadIdentifier`, the optional `categoryIdentifier`, and `userInfo = ["reminderId", "accountId", "kind"]`.
  - `registerCategories(snoozeTitle:placeholder:)` registers `kiko.reminder` (one `UNNotificationAction` id `TOMORROW`, options `[]`: nondestructive, background) and `kiko.reminder.notice` (no actions). Both use `hiddenPreviewsBodyPlaceholder`.
  - `drainResponses() -> String` reads and clears the UserDefaults key `kiko.reminders.responses` (a JSON array, at most 20 entries).
- Create: `ios/Kiko/Reminders/KikoNotificationDelegate.swift`: `UNUserNotificationCenterDelegate`.
  - `willPresent` returns `[.banner, .list, .sound]`.
  - `didReceive`: for the default action it appends `{reminderId, action:"open", respondedAt}`; for `TOMORROW` it appends `"snooze"` and adds `kiko.snooze.<reminderId>` with the same content at tomorrow's date and the delivered notification's hour and minute (Calendar arithmetic, floating components). Then it calls the registered emitter block (if the JS module is live), then `completionHandler()`. No JS is needed, so a background-launched snooze works.
- Create: `ios/Kiko/Reminders/RCTKikoReminders.h`, `ios/Kiko/Reminders/RCTKikoReminders.mm`: subclass `NativeKikoRemindersSpecBase <NativeKikoRemindersSpec>`, `RCT_EXPORT_MODULE(KikoReminders)`, `getTurboModule:` returns `NativeKikoRemindersSpecJSI`, `#import "Kiko-Swift.h"`, forwards every method to `KikoRemindersCenter.shared`, and registers an emitter block that calls `[self emitOnResponse:reminderId]`. Verify the base-class and emitter names against the generated `build/generated/ios/KikoSpecs/KikoSpecs.h` after `pod install` (RN 0.87 docs: https://reactnative.dev/docs/turbo-native-modules-introduction and https://reactnative.dev/docs/the-new-architecture/native-modules-custom-events).
- Modify: `ios/Kiko/AppDelegate.swift`: in `didFinishLaunchingWithOptions`, before `return true`: `UNUserNotificationCenter.current().delegate = KikoNotificationDelegate.shared`. The delegate MUST be set before launch finishes, or cold-launch taps and background actions are lost. Do not touch `window` (SceneDelegate owns it; memory `scene-lifecycle-appdelegate-window-crash`).
- Modify: `ios/Kiko.xcodeproj/project.pbxproj`: add the `Reminders` group and the 4 files to the `Kiko` target. Use a throwaway Ruby script with the `xcodeproj` gem (it ships with CocoaPods), kept in the scratchpad and never committed.
- Modify (if pod install changes it): `ios/Podfile.lock`.
- Check only: `ios/Kiko/PrivacyInfo.xcprivacy` already has `NSPrivacyAccessedAPICategoryUserDefaults` + `CA92.1`. Do not edit it.

- [ ] Write the files. No JS change.
- [ ] Commit (explicit paths).

### Task A3: Native build verification (ops)

- [ ] `make pods`. Check: the codegen output contains `KikoSpecs` and `RCTModuleProviders.mm` maps `KikoReminders` → `RCTKikoReminders`.
- [ ] `make deploy` (Release-AdHoc, the pinned physical UDID; the script installs and launches). CS-A has no migration, so a device install is safe.
- [ ] Device check: cold launch does not crash (the delegate is set in AppDelegate). No visible change is expected.
- [ ] `make verify` until green. BATCH READY: CS-A base sha + mutated count 2.

**CS-A device tests (coordinator):** cold launch, relaunch after a force quit, app lock on/off. The app must not crash.

---

## CS-B — Storage, planner, scheduler, app wiring

Base: CS-A tip. Start only when the migration gate above is understood. Developing under the placeholder is fine. Merging and deploying wait for the gate.

As built, CS-B differs from the snippets below (snooze storage `last_snoozed_at`, `deliverableSince` anchor, `requestIdentifier` on responses, `clearSnoozes`, kept snoozes exclude reminders with data since the snooze). Read `src/reminders/` and kiko-architecture "Reminders (local notifications)" before building on them.

### Task B1: Schema + migration NNNN (developer; tests first)

**Files:**
- Modify: `src/db/schema.ts`: add
  ```ts
  export const reminders = sqliteTable('reminders', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    kind: text('kind', { enum: ['statement_import', 'add_transactions'] }).notNull(),
    schedule: text('schedule', { mode: 'json' }).$type<ReminderSchedule>().notNull(),
    pausedAt: integer('paused_at'),
    pauseReason: text('pause_reason', { enum: ['user', 'backoff'] }),
    activeSince: integer('active_since').notNull(),
    lastEngagedAt: integer('last_engaged_at'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  }, (table) => ({ accountKind: uniqueIndex('reminders_account_kind').on(table.accountId, table.kind) }));
  export type ReminderRow = typeof reminders.$inferSelect;
  ```
  Also add `settings.reminderOfferDismissals: text('reminder_offer_dismissals', { mode: 'json' }).$type<Record<string, ReminderKind[]>>()`. Import `ReminderSchedule`/`ReminderKind` with `import type` from `@kiko/reminders/schedule`, the same way the schema already imports types from features. If that creates a value cycle, `check:feature-imports --tree` will flag it; in that case declare the types in `src/db/schema.ts` and have the schedule unit re-use them.
- Generate: `npx drizzle-kit generate --name add_reminders`. Then rename the output to `NNNN_add_reminders.sql` and `meta/NNNN_snapshot.json`, set the journal `idx`/`tag`, and fix `migrations.js`. Run `npx biome check --write` on the generated files (kiko-architecture: drizzle-kit rewrites `migrations.js` wholesale).
- Test: `src/db/schema.reminders.test.ts`. Pattern: `schema.statement-mappings.test.ts`, plus `applyAllMigrations` from `src/test-support/real-sqlite.ts` on `node:sqlite`.

- [ ] Failing tests: the SQL creates `reminders` with the FK and the unique index; the settings column is added; the journal tag `NNNN_add_reminders` resolves to `mNNNN` in `migrations.js`. On a real migrated DB, inserting a reminder for an unknown account fails (FK), and a second `(account_id, kind)` row fails (unique).
- [ ] Implement → `npx jest src/db` PASS (also `settings-columns.test.ts`: `reminderOfferDismissals` gets its reader in Task B5).
- [ ] Commit.

### Task B2: Pure schedule math (developer; tests first)

**Files:**
- Create: `src/reminders/schedule/reminder-schedule.ts`: types + `isReminderSchedule` guard (for rows restored from a backup).
- Create: `src/reminders/schedule/occurrences.ts`, `src/reminders/schedule/index.ts`.
- Test: `src/reminders/schedule/occurrences.test.ts`.

**Interfaces (produces):**
```ts
export type ReminderKind = 'statement_import' | 'add_transactions';
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Date#getDay
export type LocalDay = { year: number; month: number; day: number };
export type ReminderSchedule =
  | { frequency: 'daily'; minuteOfDay: number }
  | { frequency: 'weekly'; minuteOfDay: number; weekdays: readonly Weekday[] }
  | { frequency: 'monthly'; minuteOfDay: number; dayOfMonth: number } // 1..31, clamped to the month's last day
  | { frequency: 'interval'; minuteOfDay: number; everyDays: number; anchorDay: LocalDay }; // 2..365
export const isReminderSchedule: (value: unknown) => value is ReminderSchedule;
export const toInstant: (local: LocalDateTime) => number;            // new Date(y, m - 1, d, h, min)
export const occurrenceAfter: (schedule: ReminderSchedule, instant: number) => LocalDateTime;          // strictly after
export const occurrenceAtOrBefore: (schedule: ReminderSchedule, instant: number) => LocalDateTime | undefined;
export const calendarDaysBetween: (fromInstant: number, to: LocalDateTime) => number; // local-date difference via Date.UTC of components
```
(`LocalDateTime` is re-used from `@kiko/reminders/native`.)

- [ ] Failing tests (TZ `Europe/Kyiv`):
  - daily: before and after today's time;
  - weekly: `[1,4]` from Tue gives Thu, from Thu after the time gives next Mon; empty weekdays → the guard rejects;
  - monthly: day 31 → 2026-11-30, 2027-02-28, 2028-02-29; day 15 before and after;
  - interval: every 9 days from anchor 2026-09-01, across the 2026-10-25 fall-back (the date stays on the calendar step, the hour is unchanged);
  - `occurrenceAfter` for 03:30 on 2027-03-28 and 2026-10-25: the returned components are that day at 03:30, and `toInstant` is monotonic across consecutive occurrences;
  - `calendarDaysBetween` across both DST days → whole calendar days;
  - `occurrenceAtOrBefore` returns `undefined` only when no occurrence exists before the instant (interval before its anchor).
- [ ] Implement (day stepping `new Date(y, m, d + k)`, ts-pattern on `frequency`) → `npx jest src/reminders/schedule` PASS.
- [ ] Commit.

### Task B3: Pure planner — smart skip, back-off, 64 cap (developer; tests first)

**Files:** Create `src/reminders/planner/plan-reminder.ts`, `src/reminders/planner/plan-all.ts`, `src/reminders/planner/index.ts`. Tests: `plan-reminder.test.ts`, `plan-all.test.ts`.

**Interfaces (produces):**
```ts
export const IGNORED_LIMIT = 3;
export const PENDING_REQUEST_LIMIT = 64;
export type ReminderPlanInput = {
  reminderId: string; accountId: string; kind: ReminderKind; schedule: ReminderSchedule;
  activeSince: number; lastEngagedAt: number | null; lastDataAt: number | null; now: number;
};
export type PlannedRequest = {
  identifier: string; // `kiko.reminder.<id>.<yyyyMMddHHmm>` | `kiko.reminder.<id>.paused`
  reminderId: string; accountId: string; kind: ReminderKind;
  fireAt: LocalDateTime; variant: 'reminder' | 'pausedNotice'; daysSinceData: number | null;
};
export const planReminder: (input: ReminderPlanInput) => { requests: PlannedRequest[]; backoffPausedAt: number | null };
export const planAllReminders: (inputs: readonly ReminderPlanInput[], limit?: number) =>
  { requests: PlannedRequest[]; backoffPauses: { reminderId: string; pausedAt: number }[] };
```
Rules (state them in the file's header comment):
- `anchor = max(activeSince, lastEngagedAt, lastDataAt)`.
- Occurrence `o` is SKIPPED when `lastDataAt >= max(occurrenceAtOrBefore(o − 1 min), activeSince)`, that is, new data arrived since the previous fire. Data from before the reminder existed never skips.
- Non-skipped occurrences in `(anchor, now]` are "fired and ignored" = `c`. The future non-skipped occurrences get ordinals `c+1, c+2, …`. Ordinals `<= 3` become `reminder` requests. Ordinal 4 becomes the single `pausedNotice`. Nothing is planned after it.
- If the ordinal-4 slot is `<= now`: no requests, and `backoffPausedAt` = that slot's instant.
- `daysSinceData = calendarDaysBetween(lastDataAt, fireAt)`, or `null` when `lastDataAt` is null.
- `planAllReminders` sorts by `toInstant(fireAt)`, then by `reminderId`, and keeps the first `limit`.

- [ ] Failing tests:
  - weekly Mon/Thu with data on Tue → Thu is skipped, the next Mon is kept;
  - data before `activeSince` → nothing is skipped;
  - 0/1/2/3 ignored fires → 3/2/1/0 reminders + 1 notice;
  - the notice slot is in the past → `backoffPausedAt` is set and no requests are planned;
  - a tap (`lastEngagedAt`) after two ignored fires resets the count;
  - new data resets the count and skips the next occurrence;
  - an import reminder with `lastDataAt: null` gives `daysSinceData: null`;
  - identifiers are stable across two runs;
  - `planAllReminders` with 20 accounts x 2 kinds keeps exactly 64, earliest first;
  - a reminder whose `schedule` fails `isReminderSchedule` is dropped, not thrown on.
- [ ] Implement → `npx jest src/reminders/planner` PASS.
- [ ] Commit.

### Task B4: Notification content (developer; tests first)

**Files:** Create `src/reminders/content/reminder-content.ts`, `src/reminders/content/index.ts`. Modify `src/i18n/locales/en.ts` and `src/i18n/locales/uk.ts` (the `reminders.notification.*` keys below). Test: `reminder-content.test.ts`.

**Interfaces:** `export const reminderContent: (request: PlannedRequest, t: TFunction) => Pick<NativeReminderRequest, 'title' | 'body' | 'interruptionLevel' | 'threadIdentifier'>`. Rules: `pausedNotice` → passive; the rest → active; `threadIdentifier = kind`.

- [ ] Failing tests: the body uses the plural count; a null count uses the no-data body (add transactions); the paused notice uses the paused title and body and is passive. For every key and every count 0/1/2/5/21, en and uk output contains no digit sequence other than the count, no "Kiko"/"Кіко" in the TITLE, and no account name (a render with an account named "Mono Black" never contains it).
- [ ] Implement → `npx jest src/reminders/content src/i18n` PASS (parity, casing, final-stop, and uk catalog tests).
- [ ] Commit.

### Task B5: Repo, scheduler, app mount, account delete, backup (developer; tests first)

**Files:**
- Create: `src/reminders/repo/reminders.repo.ts`, `src/reminders/repo/index.ts`. Functions used in this CS:
  - `hasAnyQuery()`: `select 1 … limit 1`.
  - `planInputsQuery()`: ONE query. It joins `reminders` → `accounts` (`archivedAt`, `institution`) and a grouped `MAX(transactions.created_at)` per `(holdings.account_id, source IN ('import','manual'))`, restricted to reminder accounts.
  - `recordEngagements(responses)`: one `write()` that sets `lastEngagedAt = max(existing, respondedAt)` by id.
  - `markBackoffPaused(pauses)`: one `write()` that sets `pausedAt` and `pauseReason = 'backoff'`.
  - All of it satisfies `Repository`.
- Create: `src/reminders/scheduler/sync-reminders.ts`, `src/reminders/scheduler/index.ts`.
  `export const syncReminders: (t: TFunction, now?: number) => Promise<NotificationResponse[]>`:
  1. drain the native responses, then `recordEngagements`;
  2. gate on `hasAnyQuery`: if there are no reminders, call `replaceRequests([], [])` and return;
  3. build inputs. Skip a reminder that is paused, whose account is archived, an `add_transactions` reminder on a synced account (`isSyncedAccount`), and a `statement_import` reminder with no import;
  4. `planAllReminders`, then `markBackoffPaused`, then `replaceRequests(requests + content, activeReminderIds)`;
  5. return the drained responses.
- Create: `src/reminders/use-reminder-scheduler/use-reminder-scheduler.ts`, `src/reminders/use-reminder-scheduler/index.ts`: `useReminderScheduler(): void`. It runs `syncReminders` on mount, on `AppState` → `active` and → `background` (the background run gives smart skip the newest data before the app sleeps), and when `i18n.language` changes. It is single-flight: a call made during a run queues ONE follow-up. It catches every failure (a native failure must never crash the app).
- Modify: `App.tsx`: call `useReminderScheduler()` in `AppRoot`. It sits below `MigrationsGate` + `LockGate`, so it runs after migrations and after unlock.
- Modify: `src/settings/settings.repo.ts`: add `dismissReminderOffer(accountId, kind)` (a read-modify-write inside one `write()`, the `saveStatementMapping` shape) and the pure `isReminderOfferDismissed(settingsRow, accountId, kind)`. These are the column's reader and writer; Task C2.3 consumes them.
- Modify: `src/accounts/accounts.repo.ts` `remove`: delete `reminders` where `accountId` BEFORE deleting the account (the FK; same place as the `syncState` delete).
- Modify: `src/data-transfer/snapshot/data-snapshot.d.ts` (`reminders: ReminderRow[]`), `read-snapshot.ts` (order by `id`), and `restore-snapshot.ts`. Delete `reminders` before `accounts`; insert after `accounts` with `snapshot.reminders ?? []`, the `bondRegister` pattern, so an old `.kiko` without the key restores cleanly.
- Modify: `e2e/screenshot/fixtures/build-demo-snapshot.ts`: `reminders: []`. Run `npx jest e2e/screenshot`. If a committed `.kiko` drift test fails, regenerate with `KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts`.
- Tests: `reminders.repo.test.ts` (real SQL via `src/test-support/real-sqlite.ts` for `planInputsQuery` and the two writes, with no hand-rolled fake: memory `fake-db-masks-bugs`); `sync-reminders.test.ts`; `use-reminder-scheduler.test.tsx`; `settings.repo.test.ts` (extend); `accounts.repo.foreign-keys.test.ts` (extend: deleting an account with a reminder succeeds and leaves no orphan); `restore-snapshot.test.ts` + `snapshot-covers-every-table.test.ts` (extend, including a snapshot without a `reminders` key).

- [ ] Failing tests:
  - no reminders → exactly one `replaceRequests([], [])` and no plan-input query (queue-depth gate);
  - a paused reminder, an archived account, and an add-transactions reminder on a synced account → not scheduled;
  - a tap response sets `lastEngagedAt`;
  - a back-off pause is persisted;
  - kept snooze ids equal the active reminder ids;
  - the hook runs on mount, on active, on background, and on a language change; two quick triggers → at most 2 runs; a rejected native call → no throw;
  - deleting an account removes its reminders;
  - restore round-trips the reminders.
- [ ] Implement → `npx jest src/reminders src/settings src/accounts src/data-transfer src/db e2e/screenshot` PASS. Run `grep -rn "databaseTransaction\|fake" src/**/*.test.ts` over the tests that drive the changed repos and update each fake.
- [ ] Commit.
- [ ] `make verify` until green. BATCH READY: CS-B base sha, mutated count, and the migration-gate status (the NNNN actually used).

**CS-B device tests (coordinator, only after the gate):**
- Upgrade over the current device build: the migration applies once, and `MigrationsGate` shows no error.
- Relaunch is a no-op.
- A `.kiko` export and import round-trip keeps the data.
- A cold launch with no reminders feels no slower than before (one `LIMIT 1` query).

---

## CS-C1 — Create and manage reminders per account

As built, CS-C1 differs from the snippets below:
- There is no in-form Delete. The `form.delete` and
  `form.deleteConfirmTitle` keys are removed; delete is only the
  page's touch-and-hold menu.
- `notAvailable` is replaced by `unavailable.statementImport` and
  `unavailable.addTransactions`.
- New keys: `emptyNoKinds`, `on`, `turnOff`, `turnOn`, `schedule.at`,
  `schedule.atEleven` (uk `{{at}}`: 'об' only for 11:xx).
- The save flow calls `replanReminders()`, not `syncReminders(t)`.
- The ReminderRow carries a VoiceOver pause action.
Read `src/reminders/`, the screens, and kiko-architecture 'Reminders
(local notifications)' before building on them.

Base: CS-B tip.

### Task C1.1: Shared components (designer; tests first)

**Files:**
- Modify: `src/design-system/components/chip-row/chip-row.component.tsx`, `chip-row.props.d.ts`: an additive multi-select mode, a props union `{ selected; onSelect } | { selectedValues: readonly Option[]; onToggle: (option: Option) => void }`. The chip look is unchanged (locked: compact 34pt + hitSlop, accent/neutralSubtle).
- Create: `src/design-system/components/notice-banner/notice-banner.component.tsx`, `notice-banner.props.d.ts`, `notice-banner.styles.ts`, `index.ts`. Props: `{ message: string; actionLabel?: string; onAction?: () => void; testID?: string }`. It is an inline, non-modal `surfaceHigh` block: a caption `Text` plus an optional `secondaryTonal` `small` Button. Base it on transaction-form's read-only notice styling.
- Tests: `chip-row.component.test.tsx` (extend), `notice-banner.component.test.tsx`.

- [ ] Failing tests: multi mode marks every value in `selectedValues` as selected (`accessibilityState.selected`); a tap calls `onToggle`, never `onSelect`; the single-select tests are unchanged; the banner renders the message, and the button only when both `actionLabel` and `onAction` are given.
- [ ] Implement → `npx jest src/design-system/components/chip-row src/design-system/components/notice-banner` PASS.
- [ ] Commit.

### Task C1.2: Rules, schedule summary, permission hook, repo writes (developer; tests first)

**Files:**
- Create: `src/reminders/rules/reminder-draft.ts`, `src/reminders/rules/eligibility.ts`, `src/reminders/rules/index.ts`.
  - `validateReminderDraft(draft) → { weekdaysError?: true; intervalError?: true }`. Weekly needs >= 1 day; interval is an integer 2..365.
  - `draftToSchedule(draft, today: LocalDay): ReminderSchedule`: a new or changed interval anchors on `today`.
  - `defaultDraft(kind)`: see the open question on defaults.
  - `eligibleReminderKinds(account, hasImport): ReminderKind[]`: import when `hasImport`; add_transactions when `!isSyncedAccount(account)`.
- Create: `src/reminders/schedule/describe-schedule.ts`; modify `src/reminders/schedule/index.ts`. `describeSchedule(schedule, t, firstDay: 0 | 1): string` uses `formatTime` (`@kiko/dates`), `calendar.weekday.*` in `weekStartFor(deviceRegion())` order, and the plural interval key.
- Create: `src/reminders/permission/use-notification-permission.ts`, `src/reminders/permission/index.ts`. `useNotificationPermission(): { status: NotificationAuthorization | undefined; refresh(): Promise<void>; request(): Promise<NotificationAuthorization> }`. It re-reads status on mount and on `AppState` `active` (the user may come back from iOS Settings).
- Modify: `src/reminders/repo/reminders.repo.ts`: add `listByAccountQuery(accountId)`, `byIdQuery(id)`, `hasImportQuery(accountId)` (EXISTS `source='import'`), `create(input)` (`activeSince = now`), `update(id, schedule)` (resets `activeSince`, clears a backoff pause), `setPaused(id, paused)` (a resume resets `activeSince`), and `remove(id)`. Every write is inside `write()`.
- Tests: `reminder-draft.test.ts`, `eligibility.test.ts`, `describe-schedule.test.ts`, `use-notification-permission.test.tsx`, `reminders.repo.test.ts` (extend).

- [ ] Failing tests:
  - validation for each frequency;
  - an interval re-anchors on edit;
  - eligibility for synced vs manual accounts and with vs without import;
  - summaries in en and uk (Mon-first and Sun-first order);
  - the permission hook maps and refreshes on active;
  - a resume and an edit reset `activeSince` and clear the backoff pause.
- [ ] Implement → `npx jest src/reminders` PASS.
- [ ] Commit.

### Task C1.3: Reminder form, per-account page, account-detail entry (developer; tests first)

**Files:**
- Create: `src/screens/forms/weekday-field/weekday-field.component.tsx`, `weekday-field.props.d.ts`, `index.ts`. It is a label + ChipRow in multi mode + `FieldError`.
- Create: `src/screens/forms/reminder-form/reminder-form.screen.tsx`, `index.ts`. Params `{ reminderId: string } | { accountId: string; kind: ReminderKind }`.
  - Fields: a `SegmentedControl` for frequency (it changes the form's fields, so the tabs-vs-chips rule applies); by frequency, `WeekdayField`, a `SelectField` for day of month 1..31 with a hint, or a `TextField` for the interval with the plural `forms.units.days` suffix (count = `everyDaysPluralCount`); `TimeField`. TimeField's `value` = today at `minuteOfDay`, and `onChange` keeps only the hours and minutes.
  - Footer: Save (`useSubmitOnce`, validate on press, never disabled for validation). In edit mode, Delete (`ConfirmSheet destructive`).
  - Save flow: write → if `status === 'notDetermined'`, show the pre-alert `BottomSheet` (title, message, ONE `Continue` Button; a scrim dismiss also continues) → `request()` → `syncReminders(t)` → `goBack()`. If the status is denied, save and go back all the same (the page shows the banner).
- Create: `src/screens/settings/reminder-row/reminder-row.component.tsx`, `reminder-row.props.d.ts`, `index.ts`. It is a `SettingsRow` with the kind label and the summary or `Off`. A trailing `Switch` (on = not paused) appears when the reminder exists. Tapping opens the form. A `CardContextMenu` delete appears when the reminder exists. Captions: `pausedAfterNoResponse`, `accountArchived`, `notAvailable`.
- Create: `src/screens/settings/account-reminders/account-reminders.screen.tsx`, `index.ts`. Params `{ accountId, name }`. It shows one row per `eligibleReminderKinds` entry, plus the `NoticeBanner`: `deniedMessage` + `openSettings` → `Linking.openSettings()` when denied and >= 1 reminder exists; `notDeterminedMessage` + `turnOn` → the pre-alert flow when not determined and >= 1 reminder exists (the case after a restore). It gates on `useDataReady`, never on empty data.
- Modify: `src/navigation/types/types.d.ts`: `AccountsStackParamList` gets `AccountReminders: { accountId: string; name: string }` and `ReminderForm: ReminderFormParams` (an exported union).
- Modify: `src/navigation/accounts-stack/accounts.stack.tsx`: register both routes (titles `reminders.title`, `reminders.form.createTitle`/`editTitle`).
- Modify: `src/screens/account-detail/account-detail.screen.tsx`: in `headerRight`, put an icon-only ghost `Button` (`bell`, `accessibilityLabel` `reminders.rowLabel`) before `EditHeaderButton`, which navigates to `AccountReminders`. See open question 1. Account detail cannot import `SettingsRow` (the cross-screen rule).
- Modify: `src/i18n/locales/en.ts`, `uk.ts`, `title-keys.ts` (the C1 keys below).
- Tests: `weekday-field.component.test.tsx`, `reminder-form.screen.test.tsx`, `reminder-row.component.test.tsx`, `account-reminders.screen.test.tsx`, `account-detail.screen.test.tsx` (extend: the bell navigates), `accounts.stack.test.tsx` (extend).

- [ ] Failing tests:
  - the form: create per frequency, invalid → a FieldError under the right field, and scroll to the first invalid field;
  - the first save with `notDetermined` → the pre-alert has exactly one button, and its label is not "Allow";
  - Continue → `requestAuthorization` is called once;
  - a denied result still saves and goes back;
  - a save with `authorized` → no pre-alert;
  - edit + delete confirm → the row is removed and `syncReminders` is called;
  - the page: a manual account without import shows only add_transactions; a synced account with import shows only import; the denied banner opens settings; the Switch pauses.
  - Reviewer check (not Jest): `grep -rn timeSensitive ios/Kiko/Reminders src/reminders` returns nothing.
- [ ] Implement → `npx jest src/screens/forms/reminder-form src/screens/forms/weekday-field src/screens/settings src/screens/account-detail src/navigation src/i18n` PASS.
- [ ] Commit. `make verify` until green. BATCH READY (base sha, mutated count). Hand the en/uk key diff to the coordinator for user review.

**CS-C1 device tests:**
- The first reminder save shows the pre-alert, then the iOS prompt.
- Deny → the banner → Open iOS settings → allow → return → the banner is gone.
- A reminder set 2 minutes ahead fires with the right text, and the lock screen with previews hidden shows "Reminder" (the placeholder string arrives in D; before D, iOS's own default is expected).
- Reboot the phone before the fire time → it still fires.
- Update the app (reinstall a newer build) → the pending request survives or is re-planned on launch.
- Change the time zone (Settings > General > Date & Time) → it fires at the local time in the new zone.
- A DST check with a reminder at 03:30 on a transition day, if one falls in the test window; otherwise set the device date manually.

---

## CS-C2 — Settings list, contextual offers, restore re-plan

As built, CS-C2 differs from the snippets below:
- `emptyList`/`emptyHint` landed in C2.1. The permission notice and the write-then-re-plan step are shared (`usePermissionNotice`, `writeThenReplan`). `ReminderForm` has a structural props type, because it is in both stacks.
- The dismiss button is `secondaryTonal` small, not ghost (the user's "ghost" = faint tint).
- `useReminderOffer({ accountId, account, settings, trigger })` returns `{ kind, dismiss }`. It takes the page's own rows, has no `accept`/`openForm` (the screen navigates itself), and does no reads without a trigger.
- `manualEntryDaysQuery` counts distinct entry keys (`coalesce(change_group_id, time + sorted holding pair, created_at)`) over user-entered rows only (category or transfer marker set), not `COUNT(DISTINCT created_at)` over all manual rows. The window starts at local midnight.
- No offer on an archived account. At most one offer per visit (`offerDecided` latch on AccountDetail).
- The restore calls `replanRestoredReminders()` (`restartIgnoredCounts`, then `replanReminders`; historical: `restartIgnoredCounts` no longer exists in src, read `replan-restored-reminders.ts`) before the restored language is applied, not `syncReminders(t)`.
Read `src/reminders/`, the screens, and kiko-architecture 'Reminders (local notifications)' before building on them.

Base: CS-C1 tip.

### Task C2.1: Settings > Reminders (developer; tests first)

**Files:**
- Create: `src/screens/settings/reminders/reminders.screen.tsx`, `index.ts`. All reminders grouped under a heading per account name (UI only, never in a notification), using `ReminderRow` (edit/pause/delete), the permission `NoticeBanner`, and the empty state `emptyList` + `emptyHint`. There is no Add button (reminders are created from an account's page).
- Modify: `src/reminders/repo/reminders.repo.ts`: `listWithAccountQuery()`.
- Modify: `src/navigation/types/types.d.ts` (`SettingsStackParamList.Reminders: undefined`, `ReminderForm: ReminderFormParams`), `src/navigation/settings-stack/settings.stack.tsx` (register `Reminders` + `ReminderForm`).
- Modify: `src/screens/settings/settings/settings.screen.tsx`: one new `Card` + `SettingsRow` (`icon="bell"`, `reminders.rowLabel`) → `navigate('Reminders')`. Position: see open question 2.
- Tests: `reminders.screen.test.tsx`, `settings.screen.test.tsx` (extend), `settings.stack.test.tsx` (extend).

- [ ] Failing tests: the list renders every reminder under its account; pause/edit/delete work; the empty state shows no loading flash (`useDataReady`); the Settings row navigates.
- [ ] Implement → scoped jest PASS. Commit.

### Task C2.2: Offer card + offer rules (designer: card; developer: rules; tests first)

**Files:**
- Create (designer): `src/design-system/components/reminder-offer-card/reminder-offer-card.component.tsx`, `reminder-offer-card.props.d.ts`, `reminder-offer-card.styles.ts`, `index.ts`. Props `{ message; acceptLabel; dismissLabel; onAccept; onDismiss; testID? }`. A non-modal `Card` with a primary small Button and a ghost small Button.
- Create (developer): `src/reminders/offer/use-reminder-offer.ts`, `src/reminders/offer/index.ts`. `useReminderOffer(accountId, trigger: 'afterImport' | 'manualActivity'): { kind: ReminderKind; accept(): void; dismiss(): Promise<void> } | undefined`. It shows only when that kind has no reminder, `!isReminderOfferDismissed`, and the account is eligible. `manualActivity` also needs `manualEntryDaysQuery(accountId, since = now − 30 d)` → `COUNT(DISTINCT created_at) >= 2` for `source='manual'` (decision 7). Its `useLiveQuery` tables are `['reminders', 'settings', 'transactions', 'holdings']`, and it runs its query ONLY for a manual account.
- Modify: `src/reminders/repo/reminders.repo.ts`: `manualEntryDaysQuery`.
- Tests: `reminder-offer-card.component.test.tsx`, `use-reminder-offer.test.tsx`.

- [ ] Failing tests: one manual row → no offer; two rows in 30 days → an offer; two rows with the same `created_at` (a transfer's legs) → no offer; a row 31 days old doesn't count; an existing reminder or a dismissal → no offer; a synced account → no manualActivity query at all; dismiss persists per account and kind.
- [ ] Implement → scoped jest PASS. Commit.

### Task C2.3: Wire the offers + restore re-plan (developer; tests first)

**Files:**
- Modify: `src/navigation/types/types.d.ts`: `AccountDetail: { accountId; name; reminderOffer?: 'afterImport' }`.
- Modify: `src/screens/statement-import/statement-import.screen.tsx:439` and `src/screens/column-mapping/column-mapping.screen.tsx:856`: add `reminderOffer: 'afterImport'` to the existing `popTo('AccountDetail', …, { merge: true })` params. Nothing else changes.
- Modify: `src/screens/account-detail/account-detail.screen.tsx`: at the top of the content, show `ReminderOfferCard` for `route.params.reminderOffer === 'afterImport'` (trigger a), or else for `manualActivity` (trigger b). Accept → `navigate('ReminderForm', { accountId, kind })` + `setParams({ reminderOffer: undefined })`. Dismiss → `dismiss()` + clear the param. Offer (b) shows here ONLY (user decision 2026-09-28, Q9): NOT on holding detail.
- Modify: `src/screens/settings/import-data/import-data.screen.tsx`: after a successful `importData(...)`, call `syncReminders(t)`.
- Modify: `src/i18n/locales/en.ts`, `uk.ts` (the C2 keys).
- Tests: extend `account-detail.screen.test.tsx`, `statement-import.screen.test.tsx`, `column-mapping.screen.test.tsx`, `import-data.screen.test.tsx`, and `src/navigation/root-navigator/statement-import-return.navigator.test.tsx` (real router: the param reaches AccountDetail after the popTo).

- [ ] Failing tests: an import Done → AccountDetail shows the import offer; Not now → gone and still gone after a remount; Set up → the form prefilled with the import kind; the second manual entry → the offer on account detail (not holding detail); a restore → `syncReminders` is called once.
- [ ] Implement → scoped jest PASS. Commit. `make verify` until green. BATCH READY (+ the en/uk key diff).

**CS-C2 device tests:** import a statement → the offer appears once; Not now → never again for that account; add 2 manual transactions → the offer; restore a `.kiko` with reminders → the requests are re-planned (check with a near-future reminder).

---

## CS-D — Tap routing, snooze category, hidden-preview placeholder

As built, CS-D differs from the snippets below:
- `navigateTo` does ONE `navigate('AccountsTab', { state: { routes, index } })` with the whole Accounts stack: the routes it has now (keys kept), or `[Accounts]` while the tab has not mounted, then `AccountDetail`, then the next screen. It does not do two nested navigates, because on the real routers the second replaces the tab's nested params before the stack reads the first. The tapped account's page, when already on top, takes the new params in place. Before `isReady()`, it waits for the `ready` event.
- `routeFor(response, kind, account, openHoldings: Pick<HoldingRow, 'id' | 'type'>[])`; the one-holding shortcut applies only to a holding that is not ledgerless (`isLedgerlessHoldingType`). A paused-notice tap opens `AccountReminders` above `AccountDetail`.
- `sync-reminders.ts` has two steps: `drainReminderResponses()` (the one reader of the queue; it stores engagements and returns the responses) and `syncReminders(t, now?): Promise<void>`. `replan` drains, then plans, then routes. A failed drain plans and routes nothing. A failed plan still routes.
- `registerCategories` runs on every sync, before the `hasAnyQuery` gate. The category ids are `REMINDER_CATEGORY_IDENTIFIER`/`NOTICE_CATEGORY_IDENTIFIER` in `reminders-native.ts`.
- The `onResponse` subscribe is wrapped in `eitherSync` (no-op `remove`, one log). `isPausedNoticeResponse` (`@kiko/reminders/planner`) is shared by the routing and the engagement filter; `pausedNoticeIdentifier` is private.
Read `src/reminders/`, the screens, and kiko-architecture 'Reminders (local notifications)' before building on them.

Base: CS-C2 tip. JS only (the native side is in CS-A).

### Task D1: Categories + request metadata (developer; tests first)

**Files:** Modify `src/reminders/scheduler/sync-reminders.ts`: before `replaceRequests`, call `registerCategories(t('reminders.notification.snoozeAction'), t('reminders.notification.hiddenPreviewsPlaceholder'))`. Set `categoryIdentifier` to `'kiko.reminder'` (reminders) or `'kiko.reminder.notice'` (the paused notice). Modify `src/reminders/content/reminder-content.ts` (carry `categoryIdentifier`), `en.ts`, `uk.ts`. Tests: extend `sync-reminders.test.ts`, `reminder-content.test.ts`.

- [ ] Failing tests: categories are registered on every sync with the active language's strings (en and uk); only reminder requests carry the snooze category; a snooze response counts as engagement (already covered in B5; assert that it stays green).
- [ ] Implement → scoped jest PASS. Commit.

### Task D2: Navigation ref + routing (developer; tests first)

**Files:**
- Create: `src/navigation/navigation-ref/navigation-ref.ts`, `index.ts`. `export const navigationRef = createNavigationContainerRef<TabParamList>()`.
- Modify: `App.tsx`: `<NavigationContainer ref={navigationRef} …>`.
- Create: `src/reminders/routing/route-response.ts`, `index.ts`. The pure `routeFor(response, kind, account: AccountRow | undefined, openHoldingIds: string[]): ReminderRoute | undefined`:
  - a missing account → `undefined`;
  - `statement_import` → `AccountDetail { accountId, name, intent: 'importStatement' }`;
  - `add_transactions` with exactly one open holding → AccountDetail, then `TransactionForm { holdingId }`;
  - otherwise → `AccountDetail`.
  - Also `navigateTo(route, navigationRef)`: `navigate('AccountsTab', { screen: 'AccountDetail', params, initial: false })`, then for TransactionForm `navigate('AccountsTab', { screen: 'TransactionForm', params })`. It waits for `navigationRef.isReady()`.
- Modify: `src/reminders/use-reminder-scheduler/use-reminder-scheduler.ts`. Subscribe to `remindersNative.onResponse` → trigger a sync. After each sync, route the LATEST `open` response (look up the account and holdings through the repos).
- Modify: `src/navigation/types/types.d.ts` (`AccountDetail.intent?: 'importStatement'`) and `src/screens/account-detail/account-detail.screen.tsx`. When `intent === 'importStatement'`, `isReady`, and `isBankAccount`: clear the param, then call `pickAndOpenStatement()` once.
- Tests: `route-response.test.ts`; a real-navigator test `src/reminders/routing/route-response.navigator.test.tsx` (the `statement-import-return.navigator.test.tsx` pattern; memory `jest-blind-to-hit-testing-and-navigator`); extend `use-reminder-scheduler.test.tsx` and `account-detail.screen.test.tsx`.

- [ ] Failing tests:
  - a deleted account → no navigate, no throw;
  - import → AccountDetail with Accounts beneath it, and the picker opens once, not again on re-render;
  - add transactions with one holding → TransactionForm with AccountDetail beneath it; with two holdings → AccountDetail;
  - two queued responses → only the latest is routed;
  - `onResponse` while the app is live → sync + route;
  - under `LockGate`, nothing routes before unlock (AppRoot is not mounted).
- [ ] Implement → scoped jest PASS. Commit.
- [ ] `make verify` until green. BATCH READY (+ the en/uk key diff).

**CS-D device tests (Release build):**
- A cold-launch tap (app killed) → the right account; the import tap opens the file picker.
- A warm tap from the background.
- A tap while the app lock is on → routes after Face ID.
- "Tomorrow" on a locked phone, with the app killed → a notification the next day at the same time, with no app launch needed.
- Hidden previews ("Show Previews: Never") → the body reads "Reminder" / "Нагадування".
- No reminder is ever delivered as Time Sensitive (Notification settings shows no Time Sensitive toggle for Kiko).
- Back-off: ignore 3 → the 4th is "Reminders paused"; the reminder shows as paused in the list.

---

## New i18n keys (en / uk)

New top-level section `reminders` (CS in brackets). Title Case keys go into `TITLE_KEYS` (T).

| Key | en | uk |
|---|---|---|
| `rowLabel` [C1] | Reminders | Нагадування |
| `title` (T) [C1] | Reminders | Нагадування |
| `emptyList` [C2] | No reminders yet | Нагадувань ще немає |
| `emptyHint` [C2] | Set up a reminder from an account’s page. | Налаштуйте нагадування на сторінці рахунку. |
| `kind.statementImport` [C1] | Statement import | Імпорт виписки |
| `kind.addTransactions` [C1] | Add transactions | Додавання транзакцій |
| `kindHint.statementImport` [C1] | Reminds you to import a new statement for this account. | Нагадує імпортувати нову виписку для цього рахунку. |
| `kindHint.addTransactions` [C1] | Reminds you to add new transactions to this account. | Нагадує додавати нові транзакції до цього рахунку. |
| `off` [C1] | Off | Вимкнено |
| `paused` [C1] | Paused | Призупинено |
| `pausedAfterNoResponse` [C1] | Paused after 3 reminders with no response. | Призупинено після 3 нагадувань без відповіді. |
| `accountArchived` [C1] | Not sent while the account is archived. | Не надсилається, поки рахунок в архіві. |
| `notAvailable` [C1] | Not available while the account is connected to a bank. | Недоступно, поки рахунок підключено до банку. |
| `enabledLabel` [C1] | Reminder on | Нагадування ввімкнено |
| `form.createTitle` (T) [C1] | New Reminder | Нове нагадування |
| `form.editTitle` (T) [C1] | Edit Reminder | Редагувати нагадування |
| `form.frequency` [C1] | Repeat | Повторення |
| `form.frequencyDaily` [C1] | Daily | Щодня |
| `form.frequencyWeekly` [C1] | Weekly | Щотижня |
| `form.frequencyMonthly` [C1] | Monthly | Щомісяця |
| `form.frequencyInterval` [C1] | Every N days | Кожні N днів |
| `form.time` [C1] | Time | Час |
| `form.timeSheetTitle` (T) [C1] | Time | Час |
| `form.timePlaceholder` [C1] | Select a time | Оберіть час |
| `form.weekdays` [C1] | Days | Дні |
| `form.weekdaysError` [C1] | No days selected. | Дні не вибрано. |
| `form.dayOfMonth` [C1] | Day of month | День місяця |
| `form.dayOfMonthSheetTitle` (T) [C1] | Day of Month | День місяця |
| `form.dayOfMonthPlaceholder` [C1] | Select a day | Оберіть день |
| `form.dayOfMonthHint` [C1] | In shorter months, the reminder comes on the last day. | У коротші місяці нагадування надійде в останній день. |
| `form.intervalDays` [C1] | Repeat every | Повторювати кожні |
| `form.intervalDaysError` [C1] | Enter a number of days from 2 to 365. | Введіть кількість днів від 2 до 365. |
| `form.delete` [C1] | Delete reminder | Видалити нагадування |
| `form.deleteConfirmTitle` (T) [C1] | Delete Reminder? | Видалити нагадування? |
| `schedule.daily` [C1] | Every day at {{time}} | Щодня о {{time}} |
| `schedule.weekly` [C1] | {{days}} at {{time}} | {{days}} о {{time}} |
| `schedule.monthly` [C1] | Day {{day}} of every month at {{time}} | {{day}}-го числа щомісяця о {{time}} |
| `schedule.interval_one/_other` [C1] | Every {{count}} days at {{time}} (both) | _one Кожен {{count}} день о {{time}} · _few Кожні {{count}} дні о {{time}} · _many Кожні {{count}} днів о {{time}} · _other Кожні {{count}} дня о {{time}} |
| `permission.preAlertTitle` (T) [C1] | Reminder Notifications | Сповіщення нагадувань |
| `permission.preAlertMessage` [C1] | Kiko shows your reminders as notifications at the times you choose. Next, iOS asks whether to allow them. | Кіко показує нагадування як сповіщення в обраний вами час. Далі iOS запитає, чи дозволити їх. |
| `permission.continue` [C1] | Continue | Продовжити |
| `permission.deniedMessage` [C1] | Notifications are off for Kiko, so reminders can’t appear. | Сповіщення для Кіко вимкнено, тому нагадування не з’являтимуться. |
| `permission.openSettings` [C1] | Open iOS settings | Відкрити налаштування iOS |
| `permission.notDeterminedMessage` [C1] | Turn on notifications so your reminders can appear. | Увімкніть сповіщення, щоб нагадування з’являлися. |
| `permission.turnOn` [C1] | Turn on notifications | Увімкнути сповіщення |
| `offer.statementImportMessage` [C2] | Want a reminder to import your next statement? | Нагадати про імпорт наступної виписки? |
| `offer.addTransactionsMessage` [C2] | Want a reminder to add transactions to this account? | Нагадувати про додавання транзакцій до цього рахунку? |
| `offer.setUp` [C2] | Set up reminder | Налаштувати нагадування |
| `offer.dismiss` [C2] | Not now | Не зараз |
| `notification.statementImportTitle` [B] | Statement import | Імпорт виписки |
| `notification.statementImportBody_one/_other` [B] | {{count}} day / {{count}} days since your last statement import. | _one {{count}} день від останнього імпорту виписки. · _few {{count}} дні від… · _many {{count}} днів від… · _other {{count}} дня від… |
| `notification.addTransactionsTitle` [B] | Transactions | Транзакції |
| `notification.addTransactionsBody_one/_other` [B] | {{count}} day / {{count}} days since you last added a transaction. | _one {{count}} день відтоді, як ви востаннє додали транзакцію. · _few {{count}} дні… · _many {{count}} днів… · _other {{count}} дня… |
| `notification.addTransactionsBodyNoData` [B] | No transactions added yet. | Транзакцій ще не додано. |
| `notification.pausedTitle` [B] | Reminders paused | Нагадування призупинено |
| `notification.pausedBody` [B] | Turn them on again in Kiko. | Увімкніть їх знову в Кіко. |
| `notification.hiddenPreviewsPlaceholder` [D] | Reminder | Нагадування |
| `notification.snoozeAction` [D] | Tomorrow | Завтра |
| `forms.units.days_one` / `_other` (en, plus `_few` / `_many` duplicates kept for the `typeof en` parity rule), `_one` / `_few` / `_many` / `_other` (uk) [C1] | day / days | день / дні / днів / дня (count = `everyDaysPluralCount`; empty -> 0 -> днів) |

Reused: `calendar.weekday.*`, `common.save`, `common.cancel`, `common.delete`.

---

## Skill drift (after each CS; retrospect + scribe)

- kiko-architecture: "Native iOS shell" (the notification delegate in AppDelegate, the app-level TurboModule), the new migration and "Next free migration index", `useReminderScheduler` in "App-open work gated on data presence".
- kiko-domain: reminders (kinds, eligibility, smart skip, back-off, offer rules).
- kiko-design-system: the ChipRow multi mode, NoticeBanner, ReminderOfferCard.
- kiko-compliance: "Permissions": local notifications need no plist key; never Time Sensitive.
- The `release` skill: device items for notifications.

---

## Open questions for the user — RESOLVED 2026-09-28 (see spec "User decisions" item 8)

1. **Account-detail entry point.** RESOLVED: A bell icon button in the header, left of Edit.
2. **Settings row position.** RESOLVED: its own card directly below System (a system-level preference), before Import/Export.
3. **Defaults for a new reminder.** RESOLVED: import = monthly on day 1 at 19:00; add transactions = daily at 20:00.
4. **A reminder that fires while Kiko is open.** RESOLVED: the banner (banner + list + sound).
5. **Interruption level.** RESOLVED (not asked; recommendation taken as-is): Active for reminders, Passive for the one "Reminders paused" notice.
6. **Backups carry reminders** (`.kiko` export/import). RESOLVED: yes. After a restore, the Reminders pages show "Turn on notifications" until permission is granted.
7. **Import reminder tap.** RESOLVED (recommendation taken): open the account with the file picker; the picker opens once, and Cancel leaves the user on the account.
8. **Add-transactions tap on an account with several holdings.** RESOLVED: open the account detail. With exactly one open holding, open the transaction form directly.
9. **Where offer (b) appears.** RESOLVED — CHANGED from the plan's recommendation: ACCOUNT DETAIL ONLY, never holding detail. Task C2.3's holding-detail work is removed (see that task and the CS-C2 file count below).
10. **Decision 7 reading.** RESOLVED: confirmed as >= 2 distinct entry times in the last 30 days (a transfer's two legs count once).
11. **Global (non-account) reminders.** RESOLVED: per-account only in 1.2 (`account_id NOT NULL`). A global reminder would need a later migration.
12. **Monthly on day 29–31.** RESOLVED: fires on the month's last day (the form shows a hint).
13. **Every N days range.** RESOLVED: 2–365.
14. **"Tomorrow" snooze time.** RESOLVED: the same time of day as the original, one day later.
15. **Wording.** RESOLVED: the user reviews the en/uk key table at each BATCH READY, not once up front.

## Standing directives (2026-09-28)

- User questions arising during this track go to the coordinator `pff-ios-9b` by `SendMessage`, never `AskUserQuestion`.
- Until a build passes App Store review, the user is the only user of the app: a backward-compatibility edge case (for example an old `.kiko` backup with no `reminders` key) takes the simplest option with a one-line documented known limit (it restores with no reminders) — but the migration itself stays crash-safe, and a pre-migration backup must still restore successfully after the migration runs, proven by a test.
