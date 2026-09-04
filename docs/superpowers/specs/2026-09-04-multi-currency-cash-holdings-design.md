# Multi-currency cash holdings — design spec

Date: 2026-09-04
Status: approved (user pre-approved), pending implementation plan
Scope owner: Kiko coordinator

## Problem

A holding today stores exactly one currency and one balance
(`holdings.currency`, `holdings.balanceMinorUnits`). A real cash
envelope can hold several currencies at once (for example UAH bills,
USD bills, and EUR bills in one envelope). The app must let a single
**cash** holding store several currency balances.

## Decisions (fixed)

- **Scope: cash holdings only.** Card, jar, term deposit, bond, and
  crypto-asset holdings stay single-currency. Each of those is
  inherently one currency (cards and jars are synced in one currency;
  a deposit or bond is denominated in one currency; a crypto asset is
  one coin).
- **Interaction: direct balances.** The user edits each currency
  amount directly. There is NO per-currency transaction ledger.
- **Storage: a child table** (`holding_balances`), not JSON.
- **Currencies: fiat only — UAH, USD, EUR.** BTC is excluded, because
  physical cash is not BTC.
- **Every cash holding is uniformly a set of one-or-more currency
  balances.** A single-currency cash holding is a set of one.

## Out of scope (YAGNI)

- Per-currency transactions for cash.
- BTC or any crypto inside a cash holding.
- Multi-currency for any non-cash holding type.
- The scrapped "auto-create a transaction on holding creation" feature.

## Data model

New table `holding_balances`:

| Column | Type | Notes |
|---|---|---|
| `holdingId` | text, FK → `holdings.id` | not null |
| `currency` | text enum `UAH \| USD \| EUR` | not null; fiat only |
| `balanceMinorUnits` | integer | not null, default 0 |

- Unique index on `(holdingId, currency)` — one row per currency per
  holding.
- Row order in the UI follows the app's canonical currency order
  (UAH, USD, EUR); no `sortOrder` column is needed.
- A cash holding stores every currency amount here — the primary and
  the extras alike, one row each.
- `holdings.currency` for a cash row marks the display/primary
  currency (used for a label and the default first row).
  `holdings.balanceMinorUnits` is unused for a cash row (kept 0); its
  value comes from `holding_balances`.
- Non-cash holdings do not use this table and are unchanged.

## Migration

- Create the `holding_balances` table.
- Backfill: for each existing cash holding, insert one
  `holding_balances` row from its current
  `(currency, balanceMinorUnits)`.
- Non-cash rows are untouched. The source columns on `holdings` stay,
  so the backfill is non-destructive.
- Gate behind the existing `MigrationsGate`.

## Repositories

- New `src/repositories/holding-balances.repo.ts`:
  - `balancesForHolding(holdingId)` → `{ currency, balanceMinorUnits }[]`.
  - `balancesForHoldings(holdingIds)` → batched read for lists/screens.
  - `replaceBalances(holdingId, balances)` — upsert each currency,
    delete removed currencies, in one `db.transaction()`.
- `src/repositories/holdings.repo.ts`:
  - Creating or editing a cash holding writes the balance list through
    the balances repo, in the SAME transaction as the holding write.
  - Reading a cash holding loads its balances (join or batched second
    query via `balancesForHoldings`).

## Value and net worth

The net-worth layer stops assuming one amount per holding.

- Add an expansion step: each holding becomes one or more
  currency-amount entries `{ currency, minorUnits }`.
  - Non-cash holding → one entry, from the existing
    `holdingValue(holding, now)`.
  - Cash holding → N entries, one per `holding_balances` row.
- `netWorth` / `guardedNetWorth` (in `src/rates/conversion.ts` and
  `src/rates/net-worth-view.ts`) operate on entries: convert each entry
  to the base currency and sum. The existing "skip a pair with no
  rate" guard (`canConvert`) applies per entry, so a first run with no
  rates still renders.
- `holdingValue` and `holdingValueBreakdown` are UNCHANGED for the
  non-cash types (deposit, bond, flat). Cash uses the new entry
  expansion, not a single `Money`.

## Forms

The cash holding create/edit form (`holding-form.screen.tsx`) gains a
balances editor:

- A list of rows. Each row = a currency picker (fiat set UAH/USD/EUR
  minus the currencies already chosen) plus an amount field.
- Add-row and remove-row controls.
- Rules: at least one row required; a duplicate currency is blocked;
  amount is a non-negative minor-units value.
- Reuse the existing amount input and the shared currency chip/switch
  primitives; do not hand-roll.
- On save, write the balance list.

## Display

- **Cash holding card:** the base-currency total (sum of the holding's
  balances converted to the base currency) via `MoneyText`.
- **Cash holding detail:** the per-currency breakdown through the
  existing `CurrencyBreakdown` component, under the shared "Value"
  header (the `EntityAmountHeader` from the round-2 UX work). No
  transaction ledger.
- **Statistics / net worth:** a cash holding contributes its
  per-currency balances, each converted to the base currency.

## Edge cases

- A cash holding must have at least one currency row. A zero amount in
  a row is allowed (an empty slot).
- Deleting a cash holding cascades and removes its `holding_balances`
  rows.
- A cash balance in a currency with no known rate is excluded from the
  net-worth sum (existing guard, now per entry), never a crash.
- Switching a holding's kind is not supported by this feature; kind is
  locked in edit mode (existing behavior).

## Testing (TDD)

Unit tests, written before the implementation:

- `holding-balances.repo`: read, batched read, replace (upsert +
  delete), transaction atomicity.
- Migration backfill: an existing single-currency cash holding gets
  exactly one balance row equal to its old `(currency, balance)`.
- Net worth: a multi-currency cash holding sums each balance converted
  to the base currency; an unconvertible currency is skipped.
- Entry expansion: non-cash → one entry; cash → N entries.
- Form rules: add/remove rows, duplicate-currency blocked, at least one
  row, BTC not offered.

## Affected files (initial map)

- `src/db/schema.ts` (new table), a new Drizzle migration.
- `src/repositories/holding-balances.repo.ts` (new) + test.
- `src/repositories/holdings.repo.ts` (cash create/edit/read).
- `src/rates/conversion.ts`, `src/rates/net-worth-view.ts` (entries).
- `src/holdings/holding-value.ts` (cash expansion helper; non-cash
  unchanged).
- `src/screens/forms/holding-form.screen.tsx` (balances editor).
- The cash holding card and holding-detail screen (display).
- Statistics screen (reads net worth; likely no change if the entry
  refactor is internal to the net-worth layer).
