# First-time onboarding: empty states, tips, and Help & Tips

Date: 2026-10-08. Status: approved by the user section by section (brainstorm, 2026-10-08).
Ships in: build 29 (with the glass work and the account-form Connect reminder).

## Goal

A new user creates a first account and learns how to apply a category to all
transactions with the same name, without outside help. An experienced user is never
blocked. The design follows Apple's HIG "Onboarding" and "Offering help" pages:
teach in context, prefer context-specific tips over a single onboarding flow, keep
help easy to dismiss and easy to find again later in a help or settings area.

Users: new App Store users, many Ukrainian; every string is in English and Ukrainian.

## Decisions (user rulings)

- Style: contextual. No intro screens, no carousel, no guided walkthrough.
- Tips: an own design-system component, not TipKit. No new dependency, no native code.
- Help page: an in-app task list in Settings ("Help & Tips"), one row per task.
- Categories flow: teach the existing path only. No new "apply to all" action in
  Settings > Categories.
- Tip state: approach A. Empty states derive from data (no flag). Tips use one JSON
  list column `settings.dismissed_tips` (migration 0055).
- New tips for later features always appear: the list stores per-tip ids, never a
  global "hide all tips" flag.

## 1. Empty states

New shared design-system component `EmptyState` (designer): SF Symbol icon, short
title, one or two sentences, optional primary button. Pattern of Apple's
`ContentUnavailableView`. Existing tokens only.

| Screen | Condition | Content |
|---|---|---|
| Accounts | no account and no property/debt holding | Title "No accounts yet". Text: an account can be a bank card, cash, crypto, or property; Monobank, Binance, and Bitcoin can sync. Button "Add account" opens `AccountForm`. While this empty state shows, the footer "Add account" button is hidden. |
| Home | no account | Title "Start with an account". Text: Kiko totals your net worth from your accounts. Button "Add account" goes to the Accounts tab and opens `AccountForm`. |
| Home | accounts exist, no transactions | Existing "No transactions" plus one sentence: add a transaction with "+", or import a bank statement from an account's page. No button. |
| Statistics | no account | One screen-level empty state instead of empty charts, same "Add account" button. |

Unchanged: Settings > Categories (always has default categories); the charts'
"No spending to show" when accounts exist but no spending data exists.

## 2. Tips

New shared component `TipCard` (designer): a glass card, one or two sentences, a close
button with an accessibility label. Shown inline directly above the control it
explains.

| Id | Where | Shows when | Text (draft, en) | Dismissed when the user… |
|---|---|---|---|---|
| `accountDetail.importStatement` | Account detail, above "Import statement" | bank account, no sync, no transactions | "Export a statement from your bank's app as CSV or XLSX, then import it here." | closes it, or completes one statement import |
| `settings.categories` | Settings, above the "Categories" row | at least one transaction exists | "Create your own categories and choose their icon and color." | closes it, or opens Categories |
| `transaction.applyToAll` | Transaction form (edit), above the category field | at least one category exists and no category override exists | "Change the category and save: you can apply it to every transaction with the same name, now and in future imports." | closes it, or uses "Apply to all" once |

Rules:
- At most one tip on a screen at a time; one function picks it.
- No tip on a screen that shows an empty state.
- No tip for sync (Monobank, Binance, Bitcoin).
- A tip id is never reused. A tip whose text changes enough to show again gets a new id.
- Never a global "hide all tips" flag.

## 3. Help & Tips page

Settings gets a row "Help & Tips" (SF Symbol `questionmark.circle`) after "Categories",
before the footer. It opens `HelpScreen` in the Settings stack:
1. A task list in a glass group: "Add an account", "Manage categories".
2. A "Show tips again" button: clears `dismissed_tips`. It never hides future tips.
3. A short privacy line: all data stays on the device.

Each task row opens `HelpTopicScreen`: numbered steps plus one action button.

| Task | Steps (summary) | Button |
|---|---|---|
| Add an account | 1. Accounts tab > "Add account". 2. Choose the type (bank, cash, crypto, property, metals, debt, broker). 3. Enter a name; cash needs a currency and a starting balance; a bank account needs its bank. 4. Optional: connect Monobank (token), Binance (API key), or Bitcoin (wallet address). 5. Other banks: open the account and use "Import statement" with a CSV or XLSX file from the bank. | "Add account" (opens `AccountForm`) |
| Manage categories | 1. Settings > Categories. 2. "Add category", enter the name, choose icon and color. 3. To apply it to all transactions with the same name: open one of them, change its category, tap Save. 4. Choose "Apply to all"; the rule also applies to future imports. | "Open Categories" |

Content: a typed topic registry (id, title key, step keys, action) and en/uk catalog
strings that follow the catalog rules. A new task is one registry entry plus strings.

## 4. Data and storage

- Migration 0055: `ALTER TABLE settings ADD COLUMN dismissed_tips text NOT NULL DEFAULT '[]'`.
  A single ADD COLUMN, no data copy. It gets its own migration review. Never edited
  after it ships.
- `db/schema.ts`: JSON text column typed as `TipId[]`.
- `settingsRepo.dismissTip(id)`: adds the id once (idempotent). `settingsRepo.resetTips()`:
  sets `[]`.
- Tip registry: one file with the typed `TipId` list; a test checks each id is unique.
  Unknown stored ids are ignored (an older app reading a newer database).
- `useTip(id, condition)`: reads the settings row through the existing live query;
  returns `visible` and `dismiss`; `visible` = condition true and id not in the list.
- Dismiss by action: statement import success, Categories screen focus, and
  "Apply to all" success each call `dismissTip` for their tip.
- `.kiko` export/import: the column is part of the settings snapshot; a restore keeps it.
  An older file without the key restores as `[]` (tips may show once; harmless).

## 5. Ownership, tests, release

| Part | Agent |
|---|---|
| `EmptyState`, `TipCard` | designer |
| Migration 0055, schema, repo, registry, `useTip` | developer |
| Empty states, the 3 tips, `HelpScreen`, `HelpTopicScreen`, Settings row | developer |
| en/uk strings | developer, then a separate translation review before deploy |
| Jest/RNTL tests, one Maestro fresh-install flow | qa |
| Migration review, then one whole-branch review | reviewer |

Tests:
- Repo: `dismissTip` idempotent; `resetTips` clears; unknown ids ignored.
- Migration 0055 applies on a 0054 database; default `[]`.
- `.kiko` round trip keeps the list; an old file without the key restores `[]`.
- `useTip`: condition and list decide visibility; one tip per screen; no tip with an empty state.
- Each empty state: shows under its data condition; its button navigates correctly;
  the Accounts footer button is hidden while the empty state shows.
- Each tip: shows under its condition; close hides it permanently; its action hides it.
- Help: each topic renders its steps; each action button navigates; "Show tips again" works.
- i18n parity, casing, and final-stop tests cover the new keys.
- Maestro: fresh install > Accounts empty state > "Add account"; Settings > Help & Tips.

Release (build 29):
- Ships with the glass work and the account-form Connect reminder.
- The user checks everything on a device before the archive.
- App Store review notes name "Help & Tips" and the empty states. Nothing is hidden or
  flag-gated (Guideline 5.6 / 2.3.1).
- Retrospect and scribe update HANDOFF.md and the skills after the work.

Out of scope: intro screens, TipKit, a direct "apply to all" action in
Settings > Categories, tips for sync.
