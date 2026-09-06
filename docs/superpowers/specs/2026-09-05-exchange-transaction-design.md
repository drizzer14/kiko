# Exchange transaction type — design spec

Date: 2026-09-05
Revised: 2026-09-06 — added convert-existing-transaction mode (create-mode unchanged)
Status: approved, pending an updated implementation plan
Scope owner: Kiko coordinator

## Overview

Add an Exchange transaction type that moves value from a source
holding to a destination holding, with an independent amount on each
side so it also covers a currency change (for example UAH to USD).
Exchange is available two ways: a create-only mode on the transaction
form (the original design, unchanged), and by converting an existing
transaction into its missing counterpart leg (added in this revision).

## Approved decisions

- Exchange is available two ways. Create-mode: a create-only mode on
  the transaction form, presented next to Income and Expense, exactly
  as originally designed (see "Fields" below). Convert-mode: an
  existing expense or income transaction on a cash/card holding can be
  converted into an Exchange by adding its missing counterpart leg —
  in EITHER direction, by the sign of the existing transaction. The
  existing row is NEVER modified by convert-mode, which is what makes
  it safe to apply to a synced (Monobank) row: `transactionsRepo.update`
  and `.remove` already refuse to mutate a synced row
  (`src/repositories/transactions.repo.ts:110`, `:148`), and
  convert-mode does not need to update it — it only inserts one new
  manual leg. There is no link/group column between the two rows; they
  are related only by description text, the same convention as
  create-mode's two independent legs. See "Convert an existing
  transaction" below for the full design.
- The source holding is the holding the create form is opened from.
  There is no separate "From" field.
- Fields: Value Out (in the source currency), To (a select of the
  destination holding), Value In (in the destination currency), Date
  (optional, default now).
- Source eligibility: Exchange is offered only when the source
  holding type is liquid — cash or card.
- Destination eligibility and receive mapping (by destination type):
  - `cash`, `card`, `crypto_asset` -> a plain transaction (+Value In)
  - `term_deposit` -> a contribution (`appendDepositContribution`)
  - `bond`, `jar` -> EXCLUDED as destinations

  Reason for excluding bond and jar: a bond's value is derived from
  its metadata (not a plain balance), and a jar is Monobank-owned;
  neither has a clear "receive an arbitrary amount" path. A defined
  bond-buy semantic is explicitly out of scope for this spec.

  This mapping is exhaustive over the holding-type enum defined at
  `src/db/schema.ts:25` (the `type` column enum on the holdings
  table). Re-check that definition at implementation time to confirm
  no member has been added or removed since this spec was written;
  the six members named above (`card`, `term_deposit`, `bond`,
  `cash`, `crypto_asset`, `jar`) are current as of 2026-09-05.
- The rate is implicit. The user types both amounts, so no automatic
  conversion is performed.
- Ledger model: two INDEPENDENT rows, tied only by description text
  ("Exchange to `<destination name>`" on the source leg, "Exchange
  from `<source name>`" on the destination leg). No schema change and
  no migration.

## Architecture

- Both legs are written in ONE `db.transaction()` call so a partial
  failure rolls back both legs. This follows the project hard rule
  that every write goes through `db.transaction()`.
- Add a repository function (for example
  `transactionsRepo.recordExchange`) that, in a single transaction:
  - Source leg: insert a plain transaction with
    `amount = -(Value Out in source minor units)` and adjust the
    source holding balance, exactly as `recordManual` does
    (`src/repositories/transactions.repo.ts:60`).
  - Destination leg: dispatch by destination type — `term_deposit`
    uses the deposit-contribution write
    (`src/repositories/holdings.repo.ts:98`,
    `appendDepositContribution`); `cash`/`card`/`crypto_asset` use
    the plain-transaction write (+Value In). The dispatch is a small
    pure mapping from destination type to the write to perform.
- Convert entered major amounts to minor units with `Money.fromMajor`
  at the form boundary, using each holding's own currency (source
  currency for Value Out, destination currency for Value In). See
  `src/currency/money.ts` and `src/currency/parse.ts`.
- Net worth behavior is correct by construction: the source loses
  Value Out in its currency and the destination gains Value In in its
  currency, so net worth changes by (Value In minus Value Out)
  converted to the base currency — which is the real gain or loss of
  the exchange. A same-currency, equal-amount exchange leaves net
  worth unchanged.
- `recordExchange` is composed of two single-leg writes: a source
  "payment" write (plain negative) and a destination "receipt" write
  (plain positive, or a `term_deposit` contribution). Convert-mode
  (below) reuses these same single-leg writes directly, calling only
  the ONE that is missing, so create-mode and convert-mode can never
  disagree on source eligibility, destination dispatch, or the
  description convention. Exact function names are left to the
  implementation plan; a source "payment" write and a destination
  "receipt" write that `recordExchange` composes is a clear enough
  suggestion to build from.

## Components

- `transactionsRepo.recordExchange` (new): performs both legs in one
  `db.transaction()`. Reads each holding's balance INSIDE the
  transaction (never from a render snapshot), matching the existing
  `recordManual` pattern.
- A pure destination-receive dispatch helper: destination type ->
  which write path (contribution vs plain transaction). Keep it
  exhaustive with `ts-pattern` per the code-style skill.
- Transaction form (`src/screens/forms/transaction-form.screen.tsx`):
  add the Exchange mode. When the source holding is cash or card,
  show the Exchange option in the mode row. In Exchange mode render:
  Value Out (amount field), To (destination select over all OPEN
  holdings except the source, and excluding bond/jar destinations),
  Value In (amount field), Date. Hide the category picker in Exchange
  mode (an exchange has no category).
- The destination select lists open holdings only (closed holdings
  excluded), excludes the source holding itself, and excludes bond
  and jar types.
- Same screen, edit mode: add a "Convert to Exchange" action (see
  below) when the existing transaction is eligible. This screen
  already opens an existing row via the `transactionId` route param
  (`:124`) and already special-cases a synced row as read-only except
  its category (`isReadOnly = existing?.source === 'monobank'`,
  `:148`, with the footer still showing Save when only the category
  changed, `:296`); the new action is additive to that existing logic,
  not a replacement of it.

## Convert an existing transaction

Use case: a cash-out or cash-in against a synced bank account spawns
its own bank transaction automatically, but the counterpart cash
movement must be recorded manually. Converting the existing
transaction records that missing counterpart in one action.

- **Ledger model.** The simplest option, generalized to either leg:
  "no link, add destination only." Convert-mode records exactly ONE
  new manual leg — the missing counterpart. The existing row is NEVER
  modified. No schema change, no migration, no link/group column (the
  transactions table has none today —
  `src/db/schema.ts:39`). Because there is no link, two things follow
  and are both accepted as risk (see "Scope/risks"): the existing
  expense still counts as spending in statistics even after
  conversion, and the app cannot detect that a row has already been
  converted, so converting the same row twice creates two counterpart
  legs.
- **Direction, by the sign of the existing transaction.**
  - Existing EXPENSE (`amountMinorUnits < 0`): the existing row is the
    SOURCE leg. The user records the DESTINATION (received) leg
    manually. The fixed, read-only side of the convert form is Value
    Out, equal to the existing amount in the existing holding's
    currency. The new manual leg is a positive receipt on the picked
    destination holding, with description
    `Exchange from <existing holding name>`, dispatched by destination
    type exactly as create-mode's destination dispatch does
    (`cash`/`card`/`crypto_asset` -> plain transaction; `term_deposit`
    -> contribution; `bond`/`jar` -> excluded from the picker).
  - Existing INCOME (`amountMinorUnits > 0`): the existing row is the
    DESTINATION leg. The user records the SOURCE (paid) leg manually.
    The fixed, read-only side of the convert form is Value In, equal
    to the existing amount in the existing holding's currency. The new
    manual leg is a negative payment on the picked source holding,
    with description `Exchange to <existing holding name>`. The picked
    source must be liquid (cash or card), the same source eligibility
    as create-mode; a source leg is always a plain negative
    transaction, never a contribution.
  - A zero-amount existing transaction has no sign to select a
    direction from, so it is not eligible (see "Eligibility" below).
- **Eligibility** — when the "Convert to Exchange" action appears on
  the transaction-form edit screen:
  - The existing transaction's holding is liquid (cash or card), for
    parity with create-mode's source eligibility.
  - The existing transaction amount is non-zero (an expense or an
    income). The sign selects the direction per the rule above.
  - Applies to BOTH manual and synced (Monobank) transactions — a
    synced, otherwise-read-only transaction still shows the action.
    This synced case is the primary use case this feature exists for.
- **Reuse / architecture.** Convert-mode does not call
  `recordExchange`. It calls only the ONE single-leg write that
  `recordExchange` would otherwise compose — the destination "receipt"
  write for an expense-sourced conversion, or the source "payment"
  write for an income-sourced conversion — so create-mode and
  convert-mode share the same source-eligibility check, the same
  destination-dispatch mapping, and the same description convention,
  and can never drift apart. The existing row is read, never written.
- **Holding select for the other leg.** The select always excludes the
  existing holding itself and any closed holding. In the expense case
  (picking a destination) it additionally excludes `bond`/`jar`,
  identical to create-mode's destination exclusions. In the income
  case (picking a source) it is additionally restricted to liquid
  `cash`/`card`, identical to create-mode's source eligibility.
- **Flow summary.** The user opens an existing expense or income
  transaction, taps "Convert to Exchange," fills in the one missing
  leg on a single-counterpart form, and saves. The full step-by-step
  is in "Data flow" below.

## Data flow

Create-mode:

1. The user opens the create form from a liquid holding (cash or
   card) and selects Exchange.
2. The user enters Value Out, picks the destination in To, enters
   Value In, and optionally sets the Date.
3. On save, `recordExchange` runs one `db.transaction()`: the
   negative source leg plus the type-dispatched destination receive.
4. The op-sqlite reactive queries refresh the home list, both holding
   balances, and net worth.

Convert-mode:

1. The user opens an existing expense or income transaction on a
   cash/card holding (manual or synced).
2. The user taps "Convert to Exchange" (shown only when the
   transaction is eligible — see "Convert an existing transaction").
3. A single-counterpart form appears: the fixed, read-only side (Value
   Out for an expense source, or Value In for an income destination)
   equal to the existing amount in the existing holding's currency; a
   holding select for the OTHER leg (labeled "To" for the destination
   in the expense case, "From" for the source in the income case); an
   amount field for the OTHER leg in that holding's currency; a Date
   field defaulting to the existing transaction's time.
4. On save, the app writes the ONE new manual leg and adjusts that
   holding's balance in one `db.transaction()`. The existing row is
   not touched.
5. The op-sqlite reactive queries refresh the home list, the new
   leg's holding balance, and net worth (the existing holding's
   balance is unchanged, since its row was never modified).

## Error handling

Create-mode:

- Reject a blank, non-numeric, or non-positive Value Out or Value In.
- Reject a destination equal to the source.
- The `term_deposit` receive reuses `appendDepositContribution`'s own
  validation (it throws on a non-deposit or invalid metadata).
- One `db.transaction()`: any failure rolls back both legs, so the
  ledger and both balances can never desync.
- Caveat (noted, not blocking): a card is always a Monobank-synced
  holding, so a card leg may later collide with the bank's own
  imported transfer. This matches existing app behavior — the app
  already allows manual movements on synced holdings
  (`src/screens/holding-detail/holding-detail.screen.tsx:193`) — and
  the user reconciles it as today.

Convert-mode:

- Reject a blank, non-numeric, or non-positive entered amount for the
  new leg (the existing-row side is fixed and not user-entered).
- Reject the picked holding being equal to the existing transaction's
  holding.
- The `term_deposit` receive path (expense case only) reuses
  `appendDepositContribution`'s own validation, same as create-mode.
- One `db.transaction()`: any failure rolls back the new leg and its
  holding-balance adjustment together, so the ledger and balance can
  never desync. The existing row is never part of this transaction,
  since it is never written.

## Testing (TDD)

Create-mode:

- Repository tests for `recordExchange`: writes both legs; adjusts
  both holding balances by the correct signed amounts; uses a
  contribution when the destination is a `term_deposit`; uses a
  plain transaction for `cash`/`card`/`crypto_asset` destinations;
  performs both legs in one transaction and rolls back on a forced
  failure; rejects a destination equal to the source.
- Form tests: Exchange mode appears only for a cash/card source; the
  To select excludes the source, closed holdings, and bond/jar;
  validation rejects empty/zero/negative amounts; save calls
  `recordExchange` with the correct minor-units and holding ids; the
  category picker is hidden in Exchange mode.
- Follow the project test conventions (Jest + React Native Testing
  Library).

Convert-mode:

- The "Convert to Exchange" action appears only when the existing
  transaction's holding is cash/card AND its amount is non-zero;
  covers both an expense and an income case, and both a manual and a
  synced (Monobank) existing transaction.
- The action does NOT appear for a zero-amount transaction, or for a
  transaction on a non-liquid holding.
- Direction selection: an expense-sourced existing transaction opens
  the destination ("To") form; an income-sourced existing transaction
  opens the source ("From") form.
- The correct single leg is written with the correct signed minor
  units, the correct holding id, and the correct description
  (`Exchange from <existing holding name>` for a destination leg,
  `Exchange to <existing holding name>` for a source leg); the
  existing row's fields (including its `source`/read-only status) are
  unchanged after the write.
- Destination dispatch in the expense case: a `term_deposit`
  destination uses a contribution write; `cash`/`card`/`crypto_asset`
  use a plain-transaction write; the destination select excludes
  `bond`/`jar`.
- Source restriction in the income case: the source select offers
  only `cash`/`card` holdings; the write is always a plain negative
  transaction, never a contribution.
- Rejects a non-positive (blank, non-numeric, zero, or negative)
  entered amount for the new leg.
- Rejects the picked holding being equal to the existing transaction's
  holding.
- One `db.transaction()` rolls back the new leg and its balance
  adjustment together on a forced failure, and never writes to or
  modifies the existing row.
- Follow the project test conventions (Jest + React Native Testing
  Library).

## Scope/risks

- No schema change and no migration (two independent rows, in both
  create-mode and convert-mode).
- Bond and jar destinations are excluded by design.
- A synced-card leg can double-count against a later bank import;
  accepted as existing behavior.
- Convert-mode accepted risks, both a direct consequence of the
  "no link" ledger model: the original expense still counts as
  spending in statistics after conversion (there is no link to
  reclassify or net it out), and the app cannot detect that a
  transaction has already been converted, so converting the same row
  twice creates two counterpart legs. The user reconciles both, same
  as the existing synced-card double-count caveat above.

## Out of scope

- A defined bond-buy or jar receive semantic.
- Linking the two legs with a transfer-group id (considered and
  rejected in favor of two independent rows — this rejection also
  covers convert-mode's new leg, which is why convert-mode adds no
  link/group column either).
- Automatic currency conversion or rate suggestion for Value In (or,
  in convert-mode, for the new leg's amount).
- Editing or re-categorizing the existing transaction as part of
  convert-mode. Convert-mode only ever adds the missing counterpart
  leg; it never edits, re-categorizes, or removes the row being
  converted.
