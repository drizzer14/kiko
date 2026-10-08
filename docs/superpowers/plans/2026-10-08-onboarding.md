# First-time onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empty states, three contextual tips, and a "Help & Tips" page, so a new user adds a first account and learns "apply category to all" without outside help.

**Architecture:** One additive settings column (`dismissed_tips`, migration 0055) holds dismissed tip ids. A plain `src/tips/` feature owns the id registry, a pure `pickTip`, and `useTip`. Two new design-system components (`EmptyState`, `TipCard`) render the UI. A plain `src/help/` feature owns the help-topic registry; two new Settings-stack screens render it.

**Tech Stack:** React Native 0.87, op-sqlite + Drizzle, react-navigation 7, react-i18next, unistyles v3, Jest/RNTL with `node:sqlite` (`@kiko/test-support/real-sqlite`), Maestro.

**Spec:** `docs/superpowers/specs/2026-10-08-onboarding-design.md` (commit 42e41f39).

## Spec claims checked against the code (mismatches first)

Read these before Task 1. Each line names what the code says and what this plan does.

1. **"Glass card" / "glass group" vs. the content-layer rule.** `Card` (`src/design-system/components/card/card.component.tsx`) is the content-layer surface; Liquid Glass is for the navigation layer only (kiko-design-system, memory `liquid-glass-bloom-and-ceiling`). The plan builds `TipCard` and the Help list on `Card`, not `GlassSurface`. The glass branch for build 29 may restyle `Card`; it then restyles these too. Coordinator: confirm with the user, or let the glass design decide.
2. **`db/schema.ts` typed as `TipId[]`.** If `src/db` imports `TipId` from `src/tips`, the dependency goes the wrong way. The stored list can also hold ids this build does not know (a database from a newer app). The plan types the column `string[]` and narrows it to `TipId` in `src/tips` (`dismissedTipIds`).
3. **Accounts empty state is not new.** `accounts.screen.tsx:426` already renders `t('accounts.emptyState')` under the exact spec condition. Task 7/16 replaces it with `EmptyState`. Home's "No transactions" (`home.emptyTransactions`) also exists already.
4. **"No account" on Home/Statistics is not defined in the spec.** The plan uses the Accounts screen's own condition for all three screens: no live non-implicit account and no open holding under the live property/debt account. A user with only a flat has net worth, so "Start with an account" would be wrong for them.
5. **Home's "no transactions" is windowed.** Home reads only the picked date range (`listWithContextBetweenQuery`). If the extra sentence keyed off the visible list, it would show for a user with transactions outside the range. The plan keys it off the whole-ledger span (`transactionsRepo.contextSpanQuery()`, `earliest === null`).
6. **No existing query for "transactions exist".** Account detail and Settings read no transactions. Task 9/16 adds `transactionsRepo.anyQuery()` and `anyInAccountQuery(accountId)`. Both are `LIMIT 1` reads on existing indexes, so there is no new index.
7. **"Apply to all" wording.** The real sheet is titled "Apply Category to All" (`forms.transaction.applyCategoryToAll`) and its button reads "Apply" (`forms.transaction.apply`). The help steps must name "Apply", not "Apply to all".
8. **Casing rule vs. spec labels.** kiko-translator puts row labels and buttons in sentence case. The en row label therefore becomes "Help & tips" (the nav title stays "Help & Tips"), and the button becomes "Open categories". The user decides in Task 14/16.
9. **Statement import has two success sites.** `statement-import.screen.tsx:395` and `column-mapping.screen.tsx:855` both call `useImportResultSheet().show`. The dismiss goes in `show` (`src/statement-import/use-import-result-sheet/use-import-result-sheet.ts`), which covers both.
10. **The old `.kiko` file without the key.** Drizzle's SQLite insert fills an absent key from the schema `.default(...)` (`drizzle-orm/sqlite-core/dialect.js:365`). So `.default([])` restores `[]` with no restore code. `src/db/settings-columns.test.ts` fails a new settings column until it is listed. `dismissedTips` goes in `TAKEN_FROM_FILE_ON_RESTORE`.
11. **The worktree has no `node_modules`.** Run `npm ci` in `/Users/drizzer14/orca/workspaces/pff-ios/onboarding` once before Task 1. Never symlink or share the main checkout's `node_modules` (memory `scratch-copy-never-shares-node-modules`).

## Build 29 overlap

- **account-connect-reminder** (branch at f8102c15, no commits yet): this plan does **not** edit `src/screens/forms/account-form/account-form.screen.tsx`. It only navigates to `AccountForm` with `{}`. If that branch adds a required `AccountForm` param, `openAccountForm` (Task 7/16) must pass it. Shared files are likely: `src/i18n/locales/en.ts`, `uk.ts`, and `src/navigation/types/types.d.ts`. Expect text-only merge conflicts.
- **Migration index.** The index namespace is shared (kiko-architecture). This plan takes `0055`. If the connect-reminder or glass branch also adds a migration, the second to merge renumbers its own before merging. Never renumber after a build ships.
- **Glass work** (not yet designed): likely touches `Card`/`GlassSurface` and therefore the look of `TipCard`, `EmptyState`, and the Help list. Merge onboarding first, or have the glass plan list these three as consumers.

## Global Constraints

- No new dependency, no native code, no TipKit, no intro screens.
- Every user-facing string is in `en.ts` and `uk.ts` with the same key set. Casing and final "." follow kiko-translator. uk uses `’` and "Кіко".
- No flag-gated or hidden UI (Guideline 5.6). Every new screen and state is reachable in a release build.
- Never store a global "hide all tips" flag. Never reuse a tip id. "Show tips again" only clears the list.
- Every write goes through `write()` (one `db.transaction()`).
- An empty state is gated on `useDataReady`, never on `data.length === 0` alone.
- Migration 0055 is never edited once shipped (`check:shipped-migrations`).
- Writes to `src/`, `__tests__/`, and `rules/` go through Edit/Write only, never a shell redirect (kill-guard SHELL-WRITE deny).

## Review Focus

1. **Tip flash before settings load.** `useTip` returns `visible: false` while the settings query is loading, so a dismissed tip never shows for one frame. Pinned in Task 4/16.
2. **An older app writing over a newer list.** `dismissTip` keeps stored ids it does not know (`['future.tip']` + dismiss gives both). `dismissedTipIds` ignores them for display. Pinned in Task 3/16.
3. **Home with transactions outside the picked range.** The extra sentence does not show; it shows only for an empty ledger. Pinned in Task 8/16.
4. **Property-only or debt-only user.** None of the three "no account" empty states shows. Pinned in Task 7/16 (predicate) and Task 8/16 (screens).
5. **Cross-tab "Add account" when the Accounts tab was never opened, or is deep in a stack.** The stack ends `[…, AccountForm]` with Accounts at the root, from one `navigate` call. Pinned with a real-navigator test in Task 7/16 (memory `nested-tab-stack-one-navigate`).

---

## Mutation gate (per change set)

Each task below is one change set. The coordinator runs `KIKO_MUTATION_BASE=<that task's base sha> make mutable`, then `make deep` detached, before merge. Never a whole-branch run. Expected mutable source files (tests, `index.ts`, `*.styles.ts`, `.d.ts`, locales, and `.js` are excluded by the gate):

| Task | Mutable files | Count |
|---|---|---|
| 1/16 | `src/db/schema.ts` (excluded from the score, counted in the list) | 1 |
| 3/16 | `src/settings/settings.repo.ts`, `src/tips/tip-ids.ts` (minimal) | 2 |
| 4/16 | `src/tips/tip-ids.ts`, `src/tips/pick-tip.ts`, `src/tips/use-tip.ts` | 3 |
| 5/16 | `src/design-system/components/empty-state/empty-state.component.tsx` | 1 |
| 6/16 | `src/design-system/components/tip-card/tip-card.component.tsx` | 1 |
| 7/16 | `src/holdings/implicit-account/implicit-account.ts`, `src/navigation/open-account-form/open-account-form.ts`, `src/screens/accounts/accounts.screen.tsx` | 3 |
| 8/16 | `src/screens/home/home.screen.tsx`, `src/screens/statistics/statistics.screen.tsx` | 2 |
| 9/16 | `src/transactions/repo/transactions.repo.ts`, `src/screens/account-detail/account-detail.screen.tsx`, `src/statement-import/use-import-result-sheet/use-import-result-sheet.ts` | 3 |
| 10/16 | `src/screens/settings/settings/settings.screen.tsx`, `src/screens/settings/categories/categories.screen.tsx` | 2 |
| 11/16 | `src/screens/forms/transaction-form/transaction-form.screen.tsx` | 1 |
| 12/16 | `src/help/help-topics.ts`, `src/screens/settings/help/help.screen.tsx`, `src/screens/settings/help-topic/help-topic.screen.tsx`, `src/navigation/settings-stack/settings.stack.tsx`, `src/screens/settings/settings/settings.screen.tsx` | 5 |
| 13/16, 15/16 | tests / Maestro only | 0 |

**Whole branch: 22 unique mutable source files** (under the 30 cap even in total, but the gate still runs per task). Slow runs to expect: `transactions.repo.ts` (about 2,000 lines, Task 9/16) and `transaction-form.screen.tsx` (120 KB, Task 11/16). Stryker mutates whole files, so each sits in a small change set of its own.

---

### onboarding task 1/16: migration 0055 and schema column (developer)

**Files:**
- Create: `drizzle/migrations/0055_add_dismissed_tips.sql`, `drizzle/migrations/meta/0055_snapshot.json` (generated), `drizzle/migrations/0055-add-dismissed-tips.test.ts`
- Modify: `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js` (generated; re-check layout), `src/db/schema.ts` (settings table, after `notificationsDeliverableSince`/`quoteQuota`), `src/db/settings-columns.test.ts` (`TAKEN_FROM_FILE_ON_RESTORE` += `'dismissedTips'`)

**Interfaces:** Produces `settings.dismissedTips: string[]` (NOT NULL, default `[]`), so `SettingsRow['dismissedTips']` is `string[]`.

- [ ] **step 1/6:** Write `0055-add-dismissed-tips.test.ts` in the shape of `0054-add-deleted-import-keys.test.ts`. Use `applyMigrationsThrough(db, '0054_add_deleted_import_keys')` and insert a settings row `(id) VALUES (1)`. Then assert: (1) before the migration, `pragma_table_info('settings')` has no `dismissed_tips`; (2) after it, the column is `text`, `notnull = 1`, `dflt_value = "'[]'"`; (3) the existing row reads `'[]'`; (4) a new `INSERT INTO settings (id) VALUES (2)` reads `'[]'`; (5) `UPDATE settings SET dismissed_tips = NULL` throws (NOT NULL).
- [ ] **step 2/6:** Run `npx jest drizzle/migrations/0055-add-dismissed-tips.test.ts`. Expected: FAIL (file missing).
- [ ] **step 3/6:** In `schema.ts`, add a WHY comment (dismissed tip ids; unknown ids are kept and ignored; never a global flag; reset by "Show tips again") and:
  ```ts
  dismissedTips: text('dismissed_tips', { mode: 'json' }).$type<string[]>().notNull().default([]),
  ```
  Then run `npx drizzle-kit generate --name add_dismissed_tips` and `./node_modules/.bin/biome check --write drizzle/migrations`. The `.sql` body must be exactly one statement: ``ALTER TABLE `settings` ADD `dismissed_tips` text DEFAULT '[]' NOT NULL;`` (single-quoted literal). Prepend a `/* */` header in the 0054 style: purpose; additive only, one ADD COLUMN, no data copy, so a crash leaves the database at 0054 and it retries whole; the restore mirror is the schema default (an old file without the key restores `[]`). Re-check `migrations.js` against its previous import/export layout.
- [ ] **step 4/6:** Add `'dismissedTips'` to `TAKEN_FROM_FILE_ON_RESTORE` in `src/db/settings-columns.test.ts`.
- [ ] **step 5/6:** Run `npx jest drizzle/migrations src/db src/data-transfer`. Expected: PASS. A two-path test that selects `settings` through Drizzle from an older tag fails with "no such column". Fix it with `columnsWithout(getTableColumns(settings), 'dismissedTips')`, the 0047 precedent. Then run `npx tsc --noEmit`.
- [ ] **step 6/6:** Commit `feat(db): migration 0055 settings.dismissed_tips`.

### onboarding task 2/16: migration 0055 review (reviewer)

**Files:** none (read-only).
- [ ] **step 1/2:** Dispatch `kiko:reviewer` on Task 1/16's diff. The brief asks: (1) Is the SQL a single additive ADD COLUMN with a single-quoted default, matching the snapshot? (2) Which existing queries touch `settings` (`settingsRepo.getQuery` `select()`, `readDataSnapshot`, `restoreDataSnapshot` insert, `readLiveDeviceSettings`), and do any break on a 0054 database or an old `.kiko`? (3) Is the journal idx 55 with no collision on `next`? (4) Does the header state the crash-safe order? There is no new index, so no EXPLAIN QUERY PLAN test is needed; the reviewer confirms that.
- [ ] **step 2/2:** The developer fixes Critical/Important findings before Task 3/16. The BATCH READY names "migration 0055".

### onboarding task 3/16: settingsRepo.dismissTip / resetTips (developer)

**Files:**
- Modify: `src/settings/settings.repo.ts`
- Create: `src/settings/settings.repo.tips.test.ts` (real SQLite: `executingClient` + `applyAllMigrations`, shaped like `holdings.repo.create-icon.test.ts`)

**Interfaces:**
- Consumes: `settings.dismissedTips` (Task 1/16).
- Produces: `settingsRepo.dismissTip(tipId: TipId): Promise<void>` and `settingsRepo.resetTips(): Promise<void>`. `TipId` is imported **type-only** from `@kiko/tips` (Task 4/16 creates it). Because steps run in order, step 1/5 creates `src/tips/tip-ids.ts` and `src/tips/index.ts` with only `TIP_IDS` and `TipId`; Task 4/16 adds the rest.

- [ ] **step 1/5:** Create the minimal `src/tips/tip-ids.ts`:
  ```ts
  export const TIP_IDS = ['accountDetail.importStatement', 'settings.categories', 'transaction.applyToAll'] as const;
  export type TipId = (typeof TIP_IDS)[number];
  ```
  and `src/tips/index.ts` (`export * from './tip-ids';`).
- [ ] **step 2/5:** Write the failing tests. Each starts from `INSERT INTO settings (id) VALUES (1)`:
  - `dismissTip('settings.categories')` stores `["settings.categories"]`. Calling it twice still stores it once.
  - Dismissing two different ids stores both, in order.
  - Stored `'["future.tip"]'` plus `dismissTip('settings.categories')` gives `["future.tip","settings.categories"]` (an unknown id is kept).
  - `resetTips()` stores `[]`, from any list, unknown ids included.
- [ ] **step 3/5:** Run `npx jest src/settings/settings.repo.tips.test.ts`. Expected: FAIL (`dismissTip` is not a function).
- [ ] **step 4/5:** Implement both inside `write()`. `dismissTip` is a read-modify-write, the `saveStatementMapping` shape: it selects `dismissedTips` for `SETTINGS_ID`, returns early if the id is already in the list, else sets `[...existing, tipId]`. `resetTips` is `.set({ dismissedTips: [] })`. Run `npx jest src/settings`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(settings): dismissTip and resetTips`.

### onboarding task 4/16: tip registry, pickTip, useTip (developer)

**Files:**
- Modify: `src/tips/tip-ids.ts`
- Create: `src/tips/pick-tip.ts`, `src/tips/use-tip.ts`, `src/tips/tip-ids.test.ts`, `src/tips/pick-tip.test.ts`, `src/tips/use-tip.test.tsx`
- `src/tips/` is a plain feature folder with one root barrel, like `src/accounts/`; it is not a container, so `feature-imports.js` needs no change.

**Interfaces (produces):**
```ts
// tip-ids.ts
export const RETIRED_TIP_IDS: readonly string[] = [];
export const isTipId = (value: string): value is TipId;
export const dismissedTipIds = (stored: readonly string[]): ReadonlySet<TipId>; // unknown ids dropped
// pick-tip.ts
export type TipCandidate = { id: TipId; condition: boolean };
export const pickTip = (candidates: readonly TipCandidate[], dismissed: ReadonlySet<TipId>): TipId | null;
// use-tip.ts
export const useTip = (id: TipId, condition: boolean): { visible: boolean; dismiss: () => void };
```
`useTip` reads `useLiveQuery(settingsRepo.getQuery(), ['settings'], true, { cached: true })`. It returns `visible = !isLoading && pickTip([{ id, condition }], dismissedTipIds(row?.dismissedTips ?? [])) === id`. `dismiss` runs `logOnFailure('tips.dismiss', () => settingsRepo.dismissTip(id))` from `@kiko/diagnostics`. There is no Alert: a failed dismiss leaves the tip shown, which is harmless.

- [ ] **step 1/5:** Write the failing tests:
  - `tip-ids.test.ts`: ids are unique (`new Set(TIP_IDS).size === TIP_IDS.length`); no id is in `RETIRED_TIP_IDS`; `isTipId('nope') === false`; `dismissedTipIds(['future.tip', 'settings.categories'])` holds only `settings.categories`.
  - `pick-tip.test.ts`: it returns the first candidate whose condition is true and whose id is not dismissed; `null` when every candidate is false or dismissed; it never returns two ids. This one function enforces "one tip per screen".
  - `use-tip.test.tsx` (mock `@kiko/db` `useLiveQuery`, the existing screen-test pattern): `visible` is false while `isLoading` (Review Focus 1); true when the condition holds and the id is not dismissed; false when it is dismissed or the condition is false; `dismiss()` calls `settingsRepo.dismissTip(id)` once.
- [ ] **step 2/5:** Run `npx jest src/tips`. Expected: FAIL.
- [ ] **step 3/5:** Implement. Export everything from `src/tips/index.ts`.
- [ ] **step 4/5:** Run `npx jest src/tips src/settings && npx tsc --noEmit && npm run check:feature-imports`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(tips): tip registry, pickTip, useTip`.

### onboarding task 5/16: EmptyState component (designer)

**Files:** Create `src/design-system/components/empty-state/` with `empty-state.component.tsx`, `empty-state.props.d.ts`, `empty-state.styles.ts`, `empty-state.component.test.tsx`, and `index.ts`.

**Interfaces (produces):**
```ts
export type EmptyStateProps = {
  icon: string;                    // SF Symbol name
  title: string;                   // sentence case, no final "."
  message: string;                 // one or two sentences, final "."
  action?: { label: string; icon?: string; onPress: () => void };
  testID?: string;
};
```
Pattern: `ContentUnavailableView`. The content is centered: `Symbol` (`textSecondary`), the title, the message (`caption`, `textSecondary`, centered), then an optional `Button variant="primary"`. Use existing tokens only. The title must **not** use `variant="heading"`: an empty-state headline is sentence case (kiko-translator), and `heading` would pull its keys into `TITLE_KEYS`. Use `body` or `title` with semibold, as the designer picks.

- [ ] **step 1/4:** Write the failing tests: the icon, title, and message render; there is no button without `action`; the button press calls `onPress`; `testID`s pass through (`<testID>-action`).
- [ ] **step 2/4:** Run `npx jest src/design-system/components/empty-state`. Expected: FAIL.
- [ ] **step 3/4:** Implement. Add a `EmptyState` entry under "Component set" in `.claude/skills/kiko-design-system/SKILL.md` (same task, per the skill-drift rule).
- [ ] **step 4/4:** Run `npx jest src/design-system/components/empty-state`. Expected: PASS. Commit `feat(design-system): EmptyState`.

### onboarding task 6/16: TipCard component (designer)

**Files:** Create `src/design-system/components/tip-card/` with `tip-card.component.tsx`, `tip-card.props.d.ts`, `tip-card.styles.ts`, `tip-card.component.test.tsx`, and `index.ts`.

**Interfaces (produces):**
```ts
export type TipCardProps = {
  message: string;
  closeLabel: string;   // accessibility label of the close button
  onClose: () => void;
  testID?: string;
};
```
A `Card` (see mismatch 1) holding the message (`body`, `textPrimary`) and a trailing icon-only ghost close button (`xmark`, 44pt hit target, `accessibilityLabel={closeLabel}`). It is inline, not modal, with no warning tone; follow the `ReminderOfferCard` precedent.

- [ ] **step 1/4:** Write the failing tests: the message renders; the close button has `accessibilityRole="button"` and the given label; pressing it calls `onClose` once.
- [ ] **step 2/4:** Run `npx jest src/design-system/components/tip-card`. Expected: FAIL.
- [ ] **step 3/4:** Implement. Add a `TipCard` entry to kiko-design-system "Component set" that states the rule: one per screen, through `useTip`.
- [ ] **step 4/4:** Run the same jest command. Expected: PASS. Commit `feat(design-system): TipCard`.

### onboarding task 7/16: "no accounts" predicate, cross-tab openAccountForm, Accounts empty state (developer)

**Files:**
- Modify: `src/holdings/implicit-account/implicit-account.ts` and its test (add `hasNoAccounts`)
- Create: `src/navigation/open-account-form/open-account-form.ts`, `open-account-form.navigator.test.tsx`, `index.ts`
- Modify: `src/screens/accounts/accounts.screen.tsx`, `accounts.screen.test.tsx`, `src/i18n/locales/en.ts`, `uk.ts`

**Interfaces (produces):**
```ts
export const hasNoAccounts = (
  accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[],
  holdings: readonly Pick<HoldingRow, 'accountId' | 'closedAt'>[],
): boolean; // no live non-implicit account AND no open holding under a live implicit account
export const openAccountForm = (navigation: NavigationProp<TabParamList>): void;
```
`openAccountForm` makes one call: `navigation.navigate('AccountsTab', { screen: 'AccountForm', params: {}, initial: false })`. The real-navigator test decides. If that call loses the Accounts root, build the state from the current Accounts stack the way `src/reminders/routing/route-response.ts` `navigateNow` does.

Strings: `accounts.empty.title` "No accounts yet" (this replaces `accounts.emptyState`, so delete the old key) and `accounts.empty.message`: "An account can be a bank card, cash, crypto, or property. Monobank, Binance, and Bitcoin accounts can sync." Write uk for both. The button reuses `accounts.addAccount`.

- [ ] **step 1/5:** Write the failing tests:
  - `hasNoAccounts`: true for none; true for an archived bank only; true for a live property account with only a closed holding; false for a live cash account; false for a property account with an open flat (Review Focus 4).
  - Navigator test (real `NavigationContainer` + the real stacks, the `route-response.navigator.test.tsx` pattern): from Home with the Accounts tab never visited, the Accounts stack becomes `[Accounts, AccountForm]`. With Accounts at `[Accounts, AccountDetail]`, it becomes `[Accounts, AccountDetail, AccountForm]` or `[Accounts, AccountForm]`; pin whichever the call gives. In both cases Back lands on an Accounts screen (Review Focus 5).
  - `accounts.screen.test.tsx`: under the condition, `EmptyState` (`testID="accounts-empty"`) renders; its action navigates to `AccountForm` `{}`; `add-account-footer` is **absent**; it is not rendered while loading (`useDataReady`). With one account, the footer is present and the empty state is absent.
- [ ] **step 2/5:** Run `npx jest src/holdings/implicit-account src/navigation/open-account-form src/screens/accounts`. Expected: FAIL.
- [ ] **step 3/5:** Implement. The screen reuses `hasNoAccounts(accounts, holdings)` instead of the inline three-way check. Drop the `footer` prop while it is true. Icon: `genericEntitySymbol.account`.
- [ ] **step 4/5:** Run the step 2/5 command plus `npx jest src/i18n`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(accounts): empty state with Add account`.

### onboarding task 8/16: Home and Statistics empty states (developer)

**Files:** Modify `src/screens/home/home.screen.tsx`, `home.screen.test.tsx`, `src/screens/statistics/statistics.screen.tsx`, `statistics.screen.test.tsx`, `en.ts`, and `uk.ts`.

**Interfaces:** Consumes `hasNoAccounts`, `openAccountForm` (Task 7/16), and `EmptyState`.

Strings (shared by Home and Statistics): `emptyStates.noAccounts.title` "Start with an account" and `emptyStates.noAccounts.message` "Kiko totals your net worth from your accounts." Add `home.emptyLedgerHint`: 'Add a transaction with "+", or import a bank statement from an account’s page.' Write uk for all three.

- [ ] **step 1/5:** Write the failing tests:
  - Home: with no accounts, after ready, `home-empty` renders and the transaction list and FAB do not. Its action calls `navigation.navigate('AccountsTab', …)` as `openAccountForm` does.
  - Home: with accounts and `contextSpanQuery` `earliest: null`, the list's empty slot shows `home.emptyTransactions` **and** `home.emptyLedgerHint`.
  - Home: with accounts, an empty window, and a non-null span (rows outside the range), the hint is absent (Review Focus 3).
  - Home: with only an open flat, there is no `home-empty` (Review Focus 4).
  - Statistics: with no accounts, `statistics-empty` renders in place of the charts, with the same action. With accounts but no spending, the existing `statistics.noSpendingToShow` is unchanged.
  - Neither screen renders a `TipCard`. This pins "no tip with an empty state".
- [ ] **step 2/5:** Run `npx jest src/screens/home src/screens/statistics`. Expected: FAIL.
- [ ] **step 3/5:** Implement. Home branches after `hasBeenReady`, on `hasNoAccounts(accounts, holdings)`. The hint renders inside the existing `ListEmptyComponent` only when `spanRows.at(0)?.earliest == null`. Statistics branches after `isReady`, inside the same `Screen` props as the ready branch.
- [ ] **step 4/5:** Run the step 2/5 command plus `npx jest src/i18n`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(home,statistics): no-account empty states`.

### onboarding task 9/16: tip `accountDetail.importStatement` and dismiss on import (developer)

**Files:**
- Modify: `src/transactions/repo/transactions.repo.ts` (+ a test in `src/transactions/repo/`), `src/screens/account-detail/account-detail.screen.tsx`, `account-detail.screen.test.tsx`, `src/statement-import/use-import-result-sheet/use-import-result-sheet.ts`, `use-import-result-sheet.test.ts`, `en.ts`, `uk.ts`

**Interfaces (produces):**
```ts
transactionsRepo.anyQuery: () => /* select({ id }) from transactions limit 1 */;
transactionsRepo.anyInAccountQuery: (accountId: string) =>
  /* select({ id }) from transactions inner join holdings on holding_id where holdings.account_id = ? limit 1 */;
```
Strings: `tips.importStatement` "Export a statement from your bank’s app as CSV or XLSX, then import it here." and `tips.close` "Close tip". Write uk for both.

- [ ] **step 1/6:** Write the failing tests:
  - Repo (real SQLite): `anyInAccountQuery('a')` returns 1 row when a holding of `a` has a transaction, and 0 rows for another account's transaction or for none. `anyQuery()` returns 1 row or 0. Add an EXPLAIN QUERY PLAN assertion that neither does a full `SCAN transactions` without an index (expect `transactions_holding_id` for the account query). These queries are new, though the index is not.
  - Screen: a bank account with no sync and no transactions shows `TipCard` (`testID="tip-import-statement"`) inside the footer, above the Import statement button. It is hidden for a synced account, a non-bank account, an account with a transaction, a dismissed id, and while loading. Pressing close calls `settingsRepo.dismissTip('accountDetail.importStatement')`.
  - Hook: `show(result)` calls `settingsRepo.dismissTip('accountDetail.importStatement')` once, for `imported: 0` too (a completed import).
- [ ] **step 2/6:** Run `npx jest src/transactions/repo src/screens/account-detail src/statement-import/use-import-result-sheet`. Expected: FAIL.
- [ ] **step 3/6:** Implement the two queries (read builders, no `await`).
- [ ] **step 4/6:** In account detail, read `useLiveQuery(transactionsRepo.anyInAccountQuery(accountId), ['transactions', 'holdings'], true, { cached: true })` and add its `isLoading` to `useDataReady`. Then `useTip('accountDetail.importStatement', canImportStatement && anyRows.length === 0)` and render the `TipCard` as the first child of the footer `Box` when `visible`. In `show`, add `void logOnFailure('tips.dismiss', () => settingsRepo.dismissTip('accountDetail.importStatement'))`.
- [ ] **step 5/6:** Run the step 2/6 command plus `npx jest src/screens/statement-import src/screens/column-mapping src/i18n`. Expected: PASS.
- [ ] **step 6/6:** Commit `feat(tips): import-statement tip`.

### onboarding task 10/16: tip `settings.categories` and dismiss on Categories focus (developer)

**Files:** Modify `src/screens/settings/settings/settings.screen.tsx`, `settings.screen.test.tsx`, `src/screens/settings/categories/categories.screen.tsx`, `categories.screen.test.tsx`, `en.ts`, and `uk.ts`.

String: `tips.categories` "Create your own categories and choose their icon and color." Write uk.

- [ ] **step 1/5:** Write the failing tests:
  - Settings: with one transaction (`transactionsRepo.anyQuery` returns a row), `tip-categories` renders directly above `settings-card-categories`. It is hidden with no transactions, when dismissed, and while loading. Close calls `dismissTip('settings.categories')`.
  - Categories: on focus it calls `dismissTip('settings.categories')` once.
- [ ] **step 2/5:** Run `npx jest src/screens/settings/settings src/screens/settings/categories`. Expected: FAIL.
- [ ] **step 3/5:** Implement. Settings adds the `anyQuery` read to `useDataReady` and calls `useTip('settings.categories', anyRows.length > 0)`. Categories adds `useFocusEffect(useCallback(() => { void logOnFailure(…dismissTip('settings.categories')) }, []))`.
- [ ] **step 4/5:** Run the step 2/5 command plus `npx jest src/i18n`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(tips): categories tip`.

### onboarding task 11/16: tip `transaction.applyToAll` and dismiss on Apply (developer)

**Files:** Modify `src/screens/forms/transaction-form/transaction-form.screen.tsx`, `transaction-form.screen.test.tsx`, `en.ts`, and `uk.ts`.

String: `tips.applyToAll` "Change the category and save: you can apply it to every transaction with the same name, now and in future imports." Write uk.

- [ ] **step 1/5:** Write the failing tests:
  - The tip shows when opening an existing income/expense row (manual or synced) while `categories.length > 0` and `overrideRules.length === 0`. It is hidden on create and duplicate, on an exchange, when any override exists, and when dismissed.
  - Close dismisses the tip.
  - The override sheet's "Apply" success (`applyOverride` resolves) calls `dismissTip('transaction.applyToAll')`. "Just for this one" does not.
- [ ] **step 2/5:** Run `npx jest src/screens/forms/transaction-form`. Expected: FAIL.
- [ ] **step 3/5:** Implement. Call `useTip('transaction.applyToAll', existing !== undefined && !isExchange && categories.length > 0 && overrideRules.length === 0)` in the screen. Pass `tip` (visible + dismiss) down to the fields sub-component, which renders `TipCard` directly above the `CategoryField` `View`. In `applyOverride`, after `upsertCategoryOverride` resolves and before `goBack`, add `void logOnFailure(…dismissTip('transaction.applyToAll'))`.
- [ ] **step 4/5:** Run `npx jest src/screens/forms/transaction-form src/i18n`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(tips): apply-to-all tip`.

### onboarding task 12/16: Help & Tips screens and Settings row (developer)

**Files:**
- Create: `src/help/help-topics.ts`, `src/help/help-topics.test.ts`, `src/help/index.ts` (plain feature)
- Create: `src/screens/settings/help/` (`help.screen.tsx`, `help.screen.test.tsx`, `index.ts`) and `src/screens/settings/help-topic/` (`help-topic.screen.tsx`, `help-topic.screen.test.tsx`, `index.ts`)
- Modify: `src/navigation/types/types.d.ts` (`SettingsStackParamList` += `Help: undefined; HelpTopic: { topicId: HelpTopicId }`), `src/navigation/settings-stack/settings.stack.tsx`, `settings.stack.test.tsx`, `src/screens/settings/settings/settings.screen.tsx`, `settings.screen.test.tsx`, `src/i18n/locales/title-keys.ts`, `en.ts`, `uk.ts`

**Interfaces (produces):**
```ts
export type HelpAction = 'addAccount' | 'openCategories';
export type HelpTopic = { id: HelpTopicId; titleKey: string; rowLabelKey: string; stepKeys: readonly string[]; action: HelpAction };
export const HELP_TOPICS: readonly HelpTopic[]; // addAccount (5 steps), manageCategories (4 steps)
export type HelpTopicId = 'addAccount' | 'manageCategories';
```
Strings:
- `help.title` "Help & Tips" (nav title, goes in TITLE_KEYS). `help.rowLabel` "Help & tips" (see mismatch 8).
- `help.showTipsAgain` "Show tips again". `help.privacy` "All your data stays on this device."
- Per topic: `help.topics.<id>.title` (Title Case, TITLE_KEYS), `.rowLabel` (sentence case), `.steps.1…n` (each ends "."), and `help.actions.openCategories` "Open categories".
- Step text follows the spec table. Manage-categories step 4 names the real "Apply" button (mismatch 7).
- uk for all.

- [ ] **step 1/6:** Write the failing tests:
  - Registry: topic ids are unique, and every `titleKey`, `rowLabelKey`, and `stepKeys` entry exists in `en`.
  - Help screen: renders one row per topic in a `Card` group (dividers, the Settings data-transfer card pattern). A row press navigates `HelpTopic { topicId }`. "Show tips again" calls `settingsRepo.resetTips()` once. The privacy line renders.
  - Topic screen: renders numbered steps in order. `addAccount` calls `openAccountForm`; `manageCategories` navigates `Categories`. The nav title is the topic title.
  - Settings: `settings-row-help` (`questionmark.circle`) is the last card, after `settings-card-categories`, and navigates `Help`.
  - Stack test: `Help` and `HelpTopic` are registered with titles.
- [ ] **step 2/6:** Run `npx jest src/help src/screens/settings src/navigation/settings-stack`. Expected: FAIL.
- [ ] **step 3/6:** Implement the registry and the two screens (`Screen scroll`, `useScrollToTopOnTabPress` not needed, since they are not tab roots).
- [ ] **step 4/6:** Register the routes, add the Settings card, and add the title keys to `title-keys.ts`.
- [ ] **step 5/6:** Run the step 2/6 command plus `npx jest src/i18n && npx tsc --noEmit && npm run check:feature-imports`. Expected: PASS.
- [ ] **step 6/6:** Commit `feat(help): Help & Tips page and topics`.

### onboarding task 13/16: .kiko export/import and cross-screen tip tests (qa)

**Files:** Create `src/data-transfer/snapshot/restore-dismissed-tips.test.ts` (real SQLite, shaped like `restore-lock-enabled.test.ts`).

- [ ] **step 1/3:** Write these tests:
  - A round trip keeps `["settings.categories","transaction.applyToAll"]`.
  - A file whose settings row has no `dismissedTips` key restores `[]`.
  - A file with an unknown id (`["future.tip"]`) restores it verbatim, and `dismissedTipIds` ignores it.
  - A file with an empty `settings: []` restores `[]`.
  - Plus `src/data-transfer/round-trip.test.ts` still passes with the new column.
- [ ] **step 2/3:** Run `npx jest src/data-transfer`. Expected: PASS with no source change (mismatch 10). A failure here is a finding for the developer, not a test to loosen.
- [ ] **step 3/3:** Commit `test(data-transfer): dismissed tips survive restore`.

### onboarding task 14/16: translation review (coordinator, then the user; developer applies edits)

**Files:** `src/i18n/locales/en.ts`, `uk.ts` (edits only if the user asks).
- [ ] **step 1/3:** Coordinator collects `git diff <branch base>..HEAD -- src/i18n/locales/` and sends it to the user with mismatches 7 and 8 and the Statistics/Home shared copy called out.
- [ ] **step 2/3:** The developer applies the user's wording and runs `npx jest src/i18n`. Expected: PASS.
- [ ] **step 3/3:** Commit `fix(i18n): onboarding wording per review` (skip the commit if there are no edits).

### onboarding task 15/16: Maestro fresh-install flow (qa)

**Files:** Create `.maestro/onboarding-fresh-install.yaml`.
- [ ] **step 1/2:** Write the flow: `launchApp` with `clearState: true` and `clearKeychain: true` (header comment: device data is wiped; run on a simulator only). Then: Accounts tab, assert the empty-state title, tap its "Add account", assert the account form, go back, then Settings, then "Help & tips", assert both topic rows, then "Show tips again". Assert by the strings approved in Task 14/16. Mirror the `appId` and header style of `.maestro/statement-import.yaml`.
- [ ] **step 2/2:** `kiko:ops` runs it on a simulator (`maestro test .maestro/onboarding-fresh-install.yaml`). Commit `test(e2e): onboarding fresh-install flow`.

### onboarding task 16/16: verify and whole-branch review (ops, reviewer)

- [ ] **step 1/3:** `kiko:ops`: `bash scripts/wait-load.sh 8 && env -u FORCE_COLOR make verify` in the worktree, run in the background, awaiting only its exit code. Fix and re-run until green.
- [ ] **step 2/3:** `kiko:reviewer` reviews the whole branch (`git diff main...onboarding`): correctness, conventions, compliance (5.6: nothing hidden; no new permission), and the Review Focus list above. Fix Critical/Important findings and re-run `make verify`.
- [ ] **step 3/3:** Coordinator: run per-task `make deep` (see Mutation gate), then `kiko:retrospect` + `kiko:scribe` for skills and HANDOFF.md (the App Store review note names "Help & Tips" and the empty states). The user checks on a device before the build 29 archive.
