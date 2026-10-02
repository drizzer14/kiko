# Implicit Properties and Loans accounts — design

Status: design only (not yet planned or built)

## Goal

The user's request (quoted): "I think having explicit accounts for loans
and properties is excessive, since in the majority of cases it leads to
either one account for each property/loan or singular property/loan
accounts for all the properties/loans held by the user. What if we
modify the flow of creating properties/loans as follows: when property
or loan type is selected, assign it to an implicit Properties/Loans
account (new if none existed, or existing one), and let them create a
holding inside of it in that same form. On the Accounts screen, display
holdings of these accounts in their respective list groups instead of
accounts."

Success: adding a property or a loan is one step; no account layer that
only repeats the holding.

## Scope

- In: account kinds `property` (holds only `property_item`) and `debt`
  (holds only `loan`) — `holdingTypesForAccountKind` in
  `src/holdings/holding-type/holding-type.ts` maps `property: ['property_item']`
  and `debt: ['loan']`.
- Out (user decision): `metals` and `cash` stay explicit accounts ("you
  can have more than one precious metal/cash holdings spread out in
  several accounts, such as wallet/safe for cash or multiple
  banks/institutions for metals").

## Current state (verified)

- `accounts.kind` is a text enum in `src/db/schema.ts`
  (`accounts` table, line ~20): `['bank', 'cash', 'crypto', 'property',
  'metals', 'debt', 'broker']`. This is one value wider than the brief
  assumed — it also includes `broker` — but that kind is untouched by
  this design.
- The Accounts screen (`src/screens/accounts/accounts.screen.tsx`,
  around line 113-135) already partitions accounts into `mainAccounts`,
  `propertyAccounts`, and `debtAccounts` in one pass, each rendered in
  its own `Sortable.Grid` section with its own section total.
- CORRECTION to the brief: the `holdings` table already has a stored
  order column — `sortOrder: integer('sort_order').notNull().default(0)`
  (`src/db/schema.ts`), the same column name and shape the `accounts`
  table uses for its own drag order. The brief said "holdings have no
  stored order column"; that is not what the code shows. This design
  does not need to add a `holdings.sort_order` column — it already
  exists — so decision 3 below is adjusted to reuse it rather than add
  it.
- Account names show in holding pickers
  (`src/screens/forms/holding-select-field/`), the Home filter bar,
  Statistics, and Reminders settings.
- Reminders: one row per `(account, kind)`, enforced by the
  `reminders_account_kind` unique index; eligibility rules are in
  `src/reminders/rules/eligibility.ts` (an add-transactions reminder is
  eligible for any non-synced account).
- The debt account page has an "Add loan" footer button
  (`accountDetail.addLoan`, `src/screens/account-detail/account-detail.screen.tsx`
  line ~61), added in Round B task 2/9 of the reminders track.
- The migration runner counts applied migrations by file; the latest
  migration on `next` is `0049-bank-accounts-other-bank` (confirmed —
  matches the brief). This work's migration takes `0050`, re-checked at
  plan time in case another track lands first.

## Decisions

1. Model = Option 1: keep the `accounts` table. At most ONE `property`
   account and ONE `debt` account exist ("implicit accounts"), enforced
   by a partial unique index on `accounts.kind` for those two kinds. No
   new flag column: the implicit account is found by its kind.
   Rejected: option 2 (holdings without an account — every
   query/export/reminder/picker assumes an account, which is high data
   risk); option 3 (a hidden account per holding — keeps the account
   layer and still needs a reminder merge).
2. Display name: the implicit account's name is rendered from i18n by
   kind ("Properties" / "Нерухомість", "Loans" / "Кредити" — en+uk
   pending the user's text review), never read from the stored `name`
   column. That column stays NOT NULL; it stores a fixed sentinel value,
   decided at plan time.
3. Migration (one, crash-safe, per the migration-ordering convention):
   per kind (`property`, `debt`) — keep the OLDEST account of that kind
   (by `createdAt` or `sortOrder`; the plan picks and justifies one),
   move every holding of the other accounts of that kind onto it (using
   the holdings' EXISTING `sort_order` column — nothing new needed
   there, correcting the brief's assumption above), merge reminders (one
   per reminder kind on the kept account; keep the earliest-created; the
   plan defines how schedule/paused/snooze state merges across the
   merged accounts), then delete the emptied accounts and add the
   partial unique index on `accounts.kind`. A `.kiko` restore of an
   older file applies the SAME merge (two-path test: migration =
   restore). Every column that references `accounts.id` (transactions,
   price points, loan links such as `paymentHoldingId`, statement
   mappings) is re-pointed or verified unaffected by the plan, which
   lists each one explicitly.
4. Create flow: the account form's kind list still offers Property and
   Loan. Picking one swaps the account fields for the holding fields of
   that type (name, icon, color, value; loan schedule fields for a
   loan). Save creates the implicit account if none exists yet, then
   creates the holding, in one transaction. No account name/icon/bank
   pickers show for these two kinds.
5. Accounts screen: the Property and Debts sections show ONE CARD PER
   HOLDING (drag-and-drop by `holdings.sort_order`, user decision), with
   their section totals unchanged. Tap opens holding detail. Long-press
   opens the existing `CardContextMenu` (Close holding / Close loan /
   Delete, per the Round B rules already in place). The implicit
   accounts never render as cards themselves; there is no account-detail
   screen for them; the debt page's "Add loan" footer button
   (`accountDetail.addLoan`) is removed, since it becomes unreachable.
6. Elsewhere: pickers, filters, Statistics, and Reminders show the
   localized implicit name in place of a stored account name. Reminders
   for these two kinds remain possible on the implicit account;
   eligibility is unchanged.
7. Guideline 5.6: everything ships visible, no flag gating any part of
   this flow.

## Testing

- Real-SQLite migration tests: no property/debt accounts; one of each;
  several accounts of each kind with reminders on each (verifying the
  merge result); a restore of an older `.kiko` with several accounts of
  each kind (two-path equality against the live migration).
- Form tests: create a property, create a loan, confirm the implicit
  account is created once and reused on the next holding of that kind.
- Accounts screen tests: holding cards render per section, drag order
  persists, section totals stay unchanged, tap opens holding detail,
  long-press opens the existing context menu.
- Device check on the user's real data: balances and net worth
  unchanged after the upgrade. Take a `.kiko` export first.

## Open for the plan

- The sentinel value stored in the implicit account's `name` column.
- Which account is kept when merging (`createdAt` vs `sortOrder`), with
  justification.
- The exact reminder-state merge rule (schedule/paused/snooze) across
  merged accounts.
- The full enumerated list of every column referencing `accounts.id`
  that this migration must re-point or verify.
- Final en/uk i18n text for the implicit account names (user review).
