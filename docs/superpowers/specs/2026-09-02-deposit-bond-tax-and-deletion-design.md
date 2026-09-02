# Deposit/bond maturity interest, taxes, top-ups, and entity deletion

- Status: approved design, pre-implementation
- Date: 2026-09-02
- Base branch: `drizzer14/pff-redesign-review`
- Related skills: `pff-domain`, `pff-architecture`, `pff-code-style`, `pff-design-system`

## Goal

Add three capabilities to PFF:

1. Term-deposit interest and tax, with support for multiple
   contributions (top-ups) over the deposit term.
2. Bond coupon accrual and tax, with a per-holding government
   (tax-free) vs corporate (taxable) distinction.
3. Deletion of manual entities (accounts, holdings, transactions),
   with synced (Monobank) entities guarded against deletion.

## Confirmed domain decisions

These are user decisions, confirmed before design:

- **Deposit interest tax rate**: 23% (18% personal income tax + 5%
  military levy), applied to interest earned, not to principal.
- **Tax timing**: continuous. The shown value is always net-of-tax as
  interest accrues.
- **Value display**: net value is the headline. The holding-detail
  screen also shows gross value, interest earned, and tax.
- **Bond tax**: per holding. A government bond (OVDP) is tax-free. A
  corporate bond is taxed at the same 23% on coupon income.
- **Deposit top-ups**: a deposit holds a list of contributions. The
  user enters one or more at creation and can add a top-up later.
- **Delete affordance**: swipe-to-delete on list rows, built with a
  custom `SwipeableRow` primitive (no new dependency).

## Non-goals

- Bonds are single-purchase. A bond is not modeled as a series of
  purchases in this work.
- No bond redemption gain or discount/premium modeling. A bond value
  is nominal plus linear coupon accrual, as today.
- No full generic holding-edit screen. Deposit top-up is a single
  focused action, not a rewrite of the create form into an edit form.
- No liabilities or debt (net worth stays assets-only, per
  `pff-domain`).
- Liquid tax-rate configuration per holding is out of scope. The 23%
  rate is a single shared constant for deposits and corporate bonds.

## Part A — Interest, tax, and net value

### A1. Tax module — `src/holdings/tax.ts` (new)

Pure functions, integer minor units, no float drift.

- `INTEREST_TAX_RATE_PCT = 23` — a constant with a comment naming the
  two components (18% PIT + 5% military levy).
- `taxOnInterestMinor(interestMinor: number): number` — returns the
  tax on positive interest only. Returns `0` when `interestMinor <= 0`.
  Rounds down (`Math.floor`) so tax never exceeds the interest.

The rate lives in one place. Both the deposit path and the corporate
bond path call `taxOnInterestMinor`. (An earlier draft also defined a
`netInterestMinor` helper; it was removed as dead code — the value
breakdown computes `net = gross - tax` inline, so a separate helper had
no production consumer.)

### A2. Contributions model — `src/holdings/holding-metadata.ts`

Replace the single principal/start-date fields with a contributions
list.

New `TermDepositMeta` shape:

```ts
export type DepositContribution = {
  amountMinorUnits: number;
  date: number; // epoch ms
};

export type TermDepositMeta = {
  contributions: DepositContribution[]; // at least one, sorted by date ascending at read time
  annualRatePct: number;
  termMonths: number;
  recapitalization: boolean;
  compounding: CompoundingFrequency;
};
```

`asTermDepositMeta` back-compat rules (no DB migration; metadata is
JSON):

- If `contributions` is a non-empty array of valid
  `{ amountMinorUnits: number, date: number }` items, use it.
- Else if the old fields `principalMinorUnits: number` and
  `startDate: number` are present and valid, normalize to a single
  contribution `[{ amountMinorUnits: principalMinorUnits, date: startDate }]`.
- Else return `null` (holding falls back to `cachedBalance`).
- Always return `contributions` sorted by `date` ascending, so the
  earliest contribution is index 0.

`BondMeta` gains a tax flag:

```ts
export type BondKind = 'government' | 'corporate';

export type BondMeta = {
  quantity: number;
  faceValueMinorUnits: number;
  couponPct: number;
  purchaseDate: number;
  maturityDate: number;
  bondKind: BondKind;
};
```

`asBondMeta` back-compat: a missing or invalid `bondKind` reads as
`'government'` (tax-free), so no existing bond is taxed by surprise.

### A3. Interest per contribution — `src/holdings/interest.ts`

The primitive helpers (`addMonths`, `daysBetween`, `compoundedMajor`,
`accruedMajor`, `periodDays`, `periodsPerYear`) stay as they are and
keep their tests.

Add helpers that fold over contributions:

- The deposit maturity anchors to the earliest contribution date:
  `maturity = addMonths(contributions[0].date, termMonths)`.
- Recapitalization on — gross value is the sum over contributions of
  `compoundedMajor(contribMajor_i, rate, compounding, daysBetween(date_i, min(now, maturity)))`.
- Recapitalization off — value stays at the sum of contribution
  amounts. Accrued interest is the sum over contributions of the
  current-period simple accrual (the existing `accruedInterest`
  logic, applied per contribution and summed).

### A4. Value breakdown — `src/holdings/holding-value.ts`

Add a breakdown function beside the existing `holdingValue`.

```ts
export type HoldingValueBreakdown = {
  gross: Money;              // value before tax
  principalOrCost: Money;    // deposit: sum of contributions; bond: nominal
  interest: Money;           // gross - principalOrCost (>= 0)
  tax: Money;                // tax withheld on interest (0 when tax-free)
  net: Money;                // gross - tax
};

export const holdingValueBreakdown = (
  holding: ValuableHolding,
  now: number,
): HoldingValueBreakdown;
```

Rules:

- **Term deposit, recapitalization on**: `gross` = compounded sum.
  `principalOrCost` = sum of contributions. `interest` = gross −
  principalOrCost. `tax` = `taxOnInterestMinor(interest)`. `net` =
  gross − tax.
- **Term deposit, recapitalization off**: `gross` = `net` =
  `principalOrCost` = sum of contributions (interest is paid out, not
  held, so the holding value does not grow). `interest` and `tax` in
  the breakdown describe the *current-period accrued* interest and its
  tax, for display only — they do not change `net`.
- **Bond, government**: `gross` = `net` = nominal + accrued coupon.
  `principalOrCost` = nominal. `interest` = accrued coupon. `tax` =
  zero.
- **Bond, corporate**: same as government, but `tax` =
  `taxOnInterestMinor(accrued coupon)` and `net` = gross − tax.
- **Other holding types**: `gross` = `net` = `principalOrCost` =
  cached balance. `interest` = `tax` = zero.

`holdingValue(holding, now)` returns `breakdown.net`, so net worth
becomes net-of-tax automatically (the "continuous" choice). The
existing `accruedInterest` export stays for the recapitalization-off
detail, updated to sum over contributions.

All breakdown fields are `Money` in the holding's own currency.
Compute tax in minor units through `tax.ts`, then wrap in `Money`.

### A5. Net-worth `now` bug fix

`guardedNetWorth` in `src/rates/net-worth-view.ts` requires `now` as
its 4th argument, but two call sites omit it:

- `src/screens/accounts/accounts.screen.tsx:77`
- `src/screens/account-detail/account-detail.screen.tsx:143`

Pass `Date.now()` at both call sites. Add a test that fails without
the argument (for example, a term-deposit holding whose net-of-tax
value differs from its cached balance, asserted through the screen's
net-worth output). This makes deposit/bond growth and tax show
correctly on those two screens.

### A6. Holding-detail display

On the holding-detail screen for a term deposit or a bond:

- Headline: `net` value (via `MoneyText`).
- Detail rows: gross value, interest earned, and tax withheld.
- For a term deposit, also keep the accrued-interest detail already
  shown, now net-of-tax where recapitalization is off.

## Part B — Deposit contributions UI

### B1. Create form — `src/screens/forms/holding-form.screen.tsx`

Replace the deposit section's single Principal and Start Date inputs
with a repeatable contributions list:

- Each row: an amount input (decimal-pad) and a date input
  (`YYYY-MM-DD`).
- An "Add contribution" control appends an empty row. A remove
  control drops a row. At least one row is required.
- `buildMetadata` for `term_deposit` produces
  `contributions: [{ amountMinorUnits, date }, ...]` from the rows,
  plus the unchanged rate, term, recapitalization, and compounding.
- Keep bond fields, and add a `bondKind` chip row (government vs
  corporate) to the bond section.

### B2. Top-up action

The deposit's holding-detail screen gets an "Add contribution" action:

- It opens an amount + date input (a small inline form or a simple
  prompt), validates them, and appends one contribution.
- It calls a new repository write (see B3). The live query refreshes
  because the write runs inside `db.transaction()`.

### B3. Repository write — `src/repositories/holdings.repo.ts`

Add `appendDepositContribution(id, contribution)`:

- Reads the holding, parses its `term_deposit` metadata, appends the
  contribution, sorts contributions by date, and writes the metadata
  back — all inside one `db.transaction()`.
- Refuses (typed error) when the holding is not a term deposit or when
  metadata is invalid.

## Part C — Deletion

### C1. Synced predicates — `src/holdings/deletable.ts` (new) or a repo-shared module

One source of truth for both UI and repositories:

- `isSyncedTransaction(row): boolean` — `row.source === 'monobank'`.
- `isSyncedHolding(row): boolean` — the holding metadata carries a
  `monobankId` (card or jar). Reuse the existing `monobankIdOf` shape
  from `src/monobank/sync.ts` rather than re-deriving it.
- `isSyncedAccount(row): boolean` — `row.institution === 'monobank'`.

### C2. Repository `remove` functions

Each is a `db.transaction()` write, per the hard rule in
`pff-architecture`.

- `transactionsRepo.remove(id)`:
  - Refuse (typed error) when the transaction is synced.
  - Delete the transaction row.
  - Reverse its effect on the holding's stored balance in the same
    transaction: `balanceMinorUnits -= amountMinorUnits`.
- `holdingsRepo.remove(id)`:
  - Refuse when the holding is synced (`monobankId` present).
  - Delete all transactions of the holding, then the holding, in one
    transaction.
- `accountsRepo.remove(id)`:
  - Refuse when the account is synced (`institution === 'monobank'`).
  - Delete all transactions of all holdings of the account, then the
    holdings, then the account, in one transaction.

The guards are defense in depth. The UI also hides the swipe action on
a synced row, so a synced entity cannot reach the delete call.

### C3. Swipe-to-delete UI — `SwipeableRow` (new design-system primitive)

- Location: `src/design-system/components/swipeable-row`.
- Built on React Native's built-in `Animated` + `PanResponder`. No new
  dependency, no native pod rebuild, no babel change.
- Behavior: a horizontal swipe reveals a red "Delete" action. Tapping
  the action opens a confirm dialog (`Alert`). On confirm, it calls the
  provided `onDelete` handler. It snaps back on release without a full
  swipe.
- Props include `onDelete`, `disabled` (a synced row passes
  `disabled`, so no swipe action appears), and the row content as
  children.
- Testability: the handler wiring and the disabled state are unit-
  testable in Jest. The gesture math is kept minimal and behind the
  primitive.

Apply `SwipeableRow` to:

- Accounts list rows — `src/screens/accounts/accounts.screen.tsx`
  (synced Monobank account: disabled).
- Account-detail holding rows —
  `src/screens/account-detail/account-detail.screen.tsx` (synced
  card/jar holding: disabled).
- Holding-detail transaction rows —
  `src/screens/holding-detail/holding-detail.screen.tsx` (synced
  transaction: disabled).

### C4. Transaction-edit delete button

`src/screens/forms/transaction-form.screen.tsx` already gates on
manual vs synced. Add a delete button visible only for a manual
transaction, with the same confirm dialog, calling
`transactionsRepo.remove`.

## Testing (TDD, no Simulator)

Write the test first for each unit.

- `tax.ts`: rate application, floor rounding, zero/negative interest
  returns zero tax.
- `holding-metadata.ts`: new contributions parsing, old-shape
  normalization to a single contribution, `bondKind` default to
  government, invalid inputs return null.
- `interest.ts`: per-contribution compounding and accrual, maturity
  anchored to earliest contribution.
- `holding-value.ts`: breakdown for each mode (deposit recap on/off,
  bond government/corporate, other types); `holdingValue` returns net.
- `holdings.repo.ts`: `appendDepositContribution` appends and sorts,
  refuses non-deposits; `remove` cascades and refuses synced.
- `accounts.repo.ts` / `transactions.repo.ts`: `remove` cascade,
  synced refusal, balance reversal.
- `deletable.ts`: the three predicates.
- Screens: swipe action present on a manual row, absent/disabled on a
  synced row; confirm dialog shown; repo `remove` called; contributions
  list add/remove in the create form; top-up action; the
  `guardedNetWorth` `now` fix on the two screens.

Keep `npm run check:all` green throughout. Never weaken a check.

## Work split (disjoint file sets, for parallel subagents)

1. **Domain/tax** — `src/holdings/tax.ts`, `holding-metadata.ts`,
   `interest.ts`, `holding-value.ts`, and their tests. Also
   `src/holdings/deletable.ts`.
2. **Repositories** — `src/repositories/holdings.repo.ts`,
   `accounts.repo.ts`, `transactions.repo.ts`, and their tests.
3. **Design system** — `src/design-system/components/swipeable-row`
   and its test.
4. **Screens** — `holding-form.screen.tsx`, `holding-detail`,
   `account-detail`, `accounts`, `transaction-form.screen.tsx`, and
   their tests, plus the `guardedNetWorth` `now` fix.

Groups 1, 2, and 3 have no shared files and can run in parallel.
Group 4 depends on all three, so it runs after them.

## Risks and open points

- The gesture math in `SwipeableRow` is the one part not fully covered
  by unit tests. The user verifies swipe feel on device; the harness
  verifies logic in Jest.
- The recapitalization-off tax semantics (tax reduces the accrued-
  interest detail, not the held value) is a modeling choice. It is
  explicit here so the reviewer can check it against intent.
- Balance reversal on transaction delete assumes the stored balance is
  the running total the app maintains. The developer confirms this
  against `setBalance` / `recordManual` behavior during implementation.
