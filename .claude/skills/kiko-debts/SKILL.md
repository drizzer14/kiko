---
name: kiko-debts
description: Invoke whenever you touch src/loans/**, src/holdings/loan-schedule/**, src/holdings/loan-ledger/**, src/screens/forms/holding-form/loan/**, src/statistics/loan-payments/**, src/screens/forms/loan-payment-field/**, src/holdings/holding-descriptor/loan/**, or work on a debt account, a `loan` holding, loan schedule math (annuity, differentiated, none), the loan ledger and its outstanding read, a loan payment link (`loanHoldingId`, `loanLinkSource`, `loanLinkRejected`), or the automatic loan-payment matcher. Read before writing a loan form field, a schedule or outstanding read, a loan-link write or the matcher. For the Money value object, the holding schema and every shared amount rule see kiko-domain; for the price book see kiko-pricing; for the form and screen patterns see kiko-architecture.
---

# Kiko debts

## Debts — the `debt` kind, `loan` type, and schedule math

`accounts.kind` gains `debt` (en "Debt", uk "Борг") and
`holdings.type` gains `loan`, TS-only enum widenings (no migration,
same as `property`/`metals`). `loan` is `isLedgerlessHoldingType`
(`src/holdings/holding-descriptor/holding-descriptors.ts`) — like
`property_item`/`metal`, a loan
holding writes NO `Transaction` ledger rows of its own; every payment
lives on the LINKED bank holding instead (the `loanHoldingId`
column). `debt` maps to `loan` alone in `holdingTypesForAccountKind`,
and `loan` is excluded from every Exchange source/destination
predicate in `exchange-destination.ts` (a loan is never an Exchange
leg). Entity color: `entityColorsDark.red`, shared between the `debt`
kind and its sole `loan` type. Glyphs differ: the `debt` kind keeps
`minus.circle.fill` (persisted on existing account rows; changing it
needs a 0032-style migration), while the `loan` type is
`arrow.down.backward.circle.fill` (iOS 14), the mirror of a loan given's
`arrow.up.forward.circle.fill` — a saved loan holding stores a null icon,
so the new glyph needs no migration. That type glyph is now only the
fallback for a loan with no valid kind: a loan's default glyph follows its
kind (below). Account detail has no "Add loan" footer button; the Help topic
footer
has one (kiko-design-system D10).

A `debt` account's Type field IS its loan-kind picker (`LoanKindField`,
`src/screens/forms/holding-form/loan/loan-kind-field/`, testID
`loan-kind-field`): `loan` is that account kind's only holding type, so
`HoldingFormScreen`'s `typeSlotFor` renders this `SelectField` wrapper —
over `loanKinds` in the fixed order Mortgage/Car loan/Consumer loan/From a
person, one SF Symbol per kind (`loanKindSymbol`, `entity-symbols.ts`) — in
the generic `HoldingTypeField`'s slot. The stored holding type stays `loan`;
the pick writes `LoanMeta.kind` (`useLoanFields`' `kind`/`setKind`), and
`LoanSection` carries no kind field. Same "Type" label/sheet-title/placeholder
keys as the property field; editable in create and edit mode, never
disabled. A loan card's default glyph
follows its kind: `defaultHoldingSymbol` reads it leniently (`loanKindOf`),
and a loan with a missing/invalid kind shows the loan type's own glyph
(`holdingTypeSymbol.loan`); the form's untouched icon chip follows the
picked kind until the user picks an icon. A stored icon is never changed: a
loan saved with a NULL icon (what an untouched create writes) now follows its
kind on every card, a loan with a stored icon keeps it.

`LoanMeta` (`src/holdings/holding-metadata/holding-metadata.ts`):
`kind` (`'mortgage' | 'car_loan' | 'consumer_loan' | 'personal'` —
`personal` is money owed to a person, not a bank), `principalMinorUnits`,
`startDate`, `schedule` (`'annuity' | 'differentiated' | 'none'`), and
`annualRatePct?`/`termMonths?` — both OPTIONAL, since a `none`
(informal) loan carries no known rate/term; the create form is
expected to require them for `annuity`/`differentiated`, not
`asLoanMeta` itself, which accepts either shape. Three more OPTIONAL
fields — `paymentHoldingId?`, `lenderName?`, `lenderIban?` — are the
automatic loan-payment matcher's own inputs (below); `undefined` for
every loan saved before they existed, same convention. A loan the user
GAVE to someone (not owed BY them) is not a `loan` holding at all — it
stays the existing `property` category `loan_given`, which is
an ASSET, not a debt.

`src/holdings/loan-schedule/` is the amortization math, mirroring
`src/holdings/interest/`'s pattern (local-midnight `addMonths` due
dates, integer-minor-unit rounding, the last period absorbing drift)
rather than the BigInt decimal-string helpers — an interest RATE is a
plain percentage `number`, the same convention `TermDepositMeta.annualRatePct`/
`BondMeta.couponPct` already use, never the price/quantity/purity
decimal-string rule.

- `loanInstallments(meta)`: the full monthly amortization table for
  `annuity`/`differentiated` (empty for `none` — an informal debt has
  no schedule at all). `annuity` computes one constant payment per
  period via the standard formula and rounds it ONCE; every period but
  the last derives its principal as `roundedPayment - interest`.
  `differentiated` instead holds a constant PRINCIPAL per period
  (`round(principal / termMonths)`). Either way every non-last principal is
  capped at the remaining balance, so the balance never goes negative. A
  tiny loan paid off before its term keeps its row count
  (`installmentIndexOf` and the ledger count rows) and its trailing rows
  are zero-payment rows. The LAST principal is whatever balance remains, so
  the principals sum exactly to the loan principal and the schedule ends at
  exactly 0. Payment 1 is due ON `startDate`; row k is
  `addMonths(startDate, k - 1)`. Read `loanInstallments` and
  `isScheduledPayment` in
  `src/holdings/loan-schedule/loan-schedule.ts`; its test
  (`loan-schedule.test.ts`) pins the invariants.
  A fix to shared money math ships with a property test of the invariant AND
  a before/after sweep showing normal inputs unchanged. It never changes the
  row count of the schedule (indexes and the ledger count rows).
- `loanOutstandingMinorAt(meta, holdingId, book, instant)`: `none` reads the manual
  `holding:<id>` price-point series directly (the same mechanism
  Property's "Update value" uses), clamped to never go below 0.
  `annuity`/`differentiated` are computed AT READ TIME from the
  schedule: the LATEST manual correction point on the loan's own
  `holding:<id>` instrument (if any, at or before `instant`'s local
  day) anchors a fresh baseline value; only the scheduled PRINCIPAL
  due STRICTLY AFTER that correction's day (and at or before `instant`)
  is subtracted from it. With no correction ever recorded, the anchor
  is simply the loan's own principal at `startDate`, and rows due ON or
  after (`>=`) that day are subtracted, because payment 1 is due on the
  start day. The read is 0 before the start day
  (`isOnOrAfterLoanStartDay`, exported from `loan-schedule.ts` and shared
  by the schedule, the ledger, the matcher, statistics and
  `use-loan-fields`). Either path
  clamps to 0 — an overpaid/over-corrected loan reads as paid off,
  never negative. The anchor itself is `loanAnchorAt(meta, holdingId,
  book, instant)` — `LoanAnchor`, `{ dayKey, valueMinorUnits,
  fromCorrection }` — shared with the loan ledger below, so both anchor
  on the exact same correction.
- `withinInstallmentTolerance(installmentPayment, paymentAbs, currency)` —
  whether a payment is within the larger of ±1 % or ±1.00 of an
  installment's scheduled payment; shared by the matcher and the ledger.
- `loanPaymentSplitsMinor(meta, payments, currency, plan?)` →
  `{ interestMinorUnits, excessMinorUnits }[]`, one per payment: the
  interest share plus the within-tolerance fee above the scheduled
  payment (a prepayment above the tolerance, a partial payment, and a
  `none` loan have no excess).
- `loanInterestPerPaymentMinor(meta, payments, plan?)` → one interest
  amount per payment, in the given order ("interest-only spending" — the
  derived-entry wiring itself is kiko-domain's "Spending-exclusion
  pipeline" section): `none` always counts 0 interest
  (an informal debt has no schedule to derive interest from).
  Otherwise each payment maps to the installment whose `dueDate` is
  NEAREST to the payment's own local day (not necessarily the next
  unpaid one), and each installment's scheduled interest is counted
  ONCE across every payment mapped to it: earliest payment first, each
  counts what is left of that interest, capped at its own `|amount|`;
  the rest is principal. So an installment paid in two halves (two
  payments a day apart before the same due date; `loan-schedule.test.ts`,
  "counts an installment paid in two halves") counts its interest on the
  first half only, and a partial
  payment never counts more interest than it actually paid. Always pass
  ALL of one loan's counted payments together — interest per payment
  one at a time counted a split installment's interest twice. A payment
  MORE THAN ONE PERIOD outside the
  schedule is not mapped: a payment
  before the START DAY (lower bound = the start day,
  `isOnOrAfterLoanStartDay`) counts 0, and so does one past the upper
  bound, `addMonths(startDate, installments.length)`, inclusive. A start-day
  payment IS row 1. Read `installmentIndexOf` for both bounds.
- `loanPlanOf(meta)` → `LoanPlan` (`{ installments, dueDayKeys }`): the
  table plus each row's day key, built ONCE per loan. `loanOutstandingMinorAt`
  and `loanInterestPerPaymentMinor` take it as an optional last argument
  (default: build it); every caller that repeats a read for the same loan
  (each linked payment, each net-worth bucket, each statistics
  transaction) builds it once and passes it. Rebuilding it per payment per
  bucket froze Statistics (a 30-year loan with 60 linked payments over 260
  weekly buckets took ~5-8 s; now ~16 ms — pinned by a budget test in
  `net-worth-series.test.ts`).

**The loan ledger — linked payments drive the outstanding everywhere
(user-approved).** `src/holdings/loan-ledger/` reads the loan's linked
payments from the `PriceBook` (`book.loanPayments`, kiko-pricing — one
live read of every linked payment across all loans, never a query per
holding). A payment COUNTS for an instant when it is a debit, in the
loan's own currency (the rule `loanPaymentExcludedTransactionIds`
applies), is on or after the loan's start day (`buildLedger` ignores a
pre-start payment in the branch choice, paid-so-far, principal and
outstanding; user ruling Q6 = A), and its LOCAL day is on or before the
instant's local day —
the local-day rule a ledger holding's running balance follows, so a
net-worth bucket sees the payer card's debit and the loan's drop
together.

- `loanLedgerOutstandingMinorAt(meta, loan, book, instant)` — the ONE
  outstanding every site reads (the descriptor below: card, detail
  Value, Home/Accounts totals, statistics, every net-worth bucket; the
  detail's upcoming-payments guard; the form's schedule-to-`none`
  edit). No counted payment: exactly `loanOutstandingMinorAt` (pinned —
  a loan with no linked payment values as it always did). Otherwise:
  the anchor minus the principal part (`|amount|` minus its
  `loanInterestPerPaymentMinor` share minus its within-tolerance excess)
  of each counted payment dated strictly
  after a correction anchor's day (ON or after the day for the start-day
  anchor, since payment 1 is due then; `loanLedgerOutstandingMinorAt`),
  clamped at 0; 0 before the start day. The
  anchor (`ledgerAnchorAt`) is the latest correction on or before the
  instant (`loanAnchorAt`); with none, an `annuity`/`differentiated`
  loan anchors on the SCHEDULE outstanding (`loanOutstandingMinorAt`)
  at the EARLIER of (a) the end of the local day before its FIRST
  linked payment and (b) the end of the local day before the due date
  of the installment that payment maps to (`installmentIndexOf`'s own
  nearest-due-date mapping, `loan-schedule.ts` — the same mapping
  `loanInterestPerPaymentMinor` attributes that payment's interest by),
  because auto-links only reach back as far as the bank sync window and
  a loan's earlier payments are often never linked. Reading from before
  the DUE date rather than before the payment itself is what keeps a
  payment landing a few days late (a real-world norm, not an edge case)
  from double-subtracting its own installment's principal — once by the
  schedule anchor, once by the link — which had permanently understated
  every loan with a late first link by one installment's principal. So
  the history never steps up at the first link: it follows the schedule
  up to that day, then drops by each linked payment's principal part. A
  `none` loan (no schedule) keeps the principal at the start day. A link
  before the start day is ignored. A link ON the start day is payment 1
  and counts. A payment on or before a
  correction's day is already inside that correction. The ledger (the
  `LoanPlan` plus
  every paying-down payment with its day key, interest part and excess) is built
  once per `PriceBook` and cached in a `WeakMap` keyed by the book, then
  by loan id + currency + the schedule terms (the loan form reads one
  book with the old AND the new terms, so the terms must be in the key).
- `loanLedgerSummary(meta, loan, book, now)` — the detail's breakdown:
  `principalMinorUnits`, `paidSoFarMinorUnits` (Σ `|amount|`),
  `interestPaidMinorUnits` (Σ `loanInterestPerPaymentMinor`; 0 for
  `none`), `principalRepaidMinorUnits` (Σ principal parts; fees are left out, and
  `paidSoFarMinorUnits` stays the bank total, so the rows are not an equation), and
  `outstandingMinorUnits` (the function above at `now`).
- `loanRemaindersAfterMinor(meta, loan, book, now, rows)` → one balance
  per upcoming row (`UpcomingLoanInstallment`, a `LoanInstallment` plus
  `remainderMinorUnits`): the header outstanding minus a running total of
  the scheduled principal the header does not already count, floored at
  0. Schedule branch: a row due on or before today is counted. Ledger
  branch: a row subtracts `max(0, row principal - principal paid by the
  counted payments mapped to it)`, so a partly paid row keeps its unpaid
  principal. Pins: `loan-ledger.property.test.ts` and its due-today row;
  read `loan-ledger.ts`.

Known limit: with linked payments and no correction, the outstanding
before the first link is the schedule's, so a loan paid off faster or
slower than its schedule before the first link reads off by that
difference until the user records a correction ("Update
outstanding").

Known limit: a manual link before the start day is ignored by money but
still listed in the loan's list (a display-only gap).

Known limit: a MANUAL loan link (not the automatic ±7-day matcher) more
than half an installment period late still maps to its nearest
installment by due date (`installmentIndexOf`'s nearest-due-date
mapping), the same mapping the anchor logic above reads from. When the
link is that late, "nearest by due date" lands on a LATER installment
than the one this payment actually paid down, so the anchor logic's
"before the due date" guard no longer lines up with the payment's real
target, and the principal for the installment in between is subtracted
twice. Automatic links are not affected: the matcher's own ±7-day
window is always well inside half a period, so it never picks the
wrong installment in the first place.

`holding-descriptor/loan/loan.descriptor.ts`'s valuation branch (`gross = net = -outstanding`,
`principalOrCost = -principal`, interest/tax always 0 — a loan never
accrues either AT VALUATION time) backs the net-worth assets-minus-debt
rule. The `loanHoldingId` link column + its repo
functions are covered in their own subsection below. Interest-only
spending is wired through kiko-domain's "Spending-exclusion pipeline"
section's loan-payments module. `loanPaymentIdOf(entryId)` and `loanEntryPartOf(entryId)`
(`src/statistics/loan-payments/loan-payments.ts`) map a derived `loan-interest:<id>` or
`loan-excess:<id>` entry back to its payment and to 'interest' or 'fee'; the Tables cell rows
show the part on each row and take the description from the payment's own row.
The transaction-form field (`LoanPaymentField`) and the automatic payment-linking matcher
are BOTH wired — see "The automatic loan-payment matcher" subsection below for the matcher's own
rules and every call site.

### Loan form + detail

A loan is created through the implicit entry (see "`property_item` /
`metal` create-form sections"): Debt in the account form swaps in this
holding form with `implicitKind: 'debt'`, and Save creates the loan under
the one implicit debt account.

`src/screens/forms/holding-form/loan/loan-section/` (kind `SelectField`,
principal, start date, schedule SegmentedControl, rate/term AND the
matcher's own optional "Paid from"/lender-name/lender-IBAN fields all
hidden for `'none'`) and its own `use-loan-fields/` hook — a full `HoldingTypeForm`
(`src/screens/forms/holding-form/holding-type-form/`): state,
per-schedule `loanReasonKey` validation, edit-mode `seed`,
`createPayload`, and `saveEdit` — mirror `useBondIsinMode`'s
extraction, the same way every other holding type's own `use<Type>Fields`
hook does. Unlike `PropertySection`/`MetalSection`'s
create-only-lot fields, EVERY loan field stays editable in both create and
edit mode (mirrors term_deposit/bond) — there is no fixed-at-creation
"first lot" a loan's principal/dates/schedule freeze against. Its own leaf
component (`LoanFormBlock`,
`src/screens/forms/holding-form/loan/loan-form-block/`) renders from one
arm of `HoldingFormScreen`'s single `match(type)…exhaustive()` — the same
dispatch every holding type's own form block renders from;
collapsing what used to be five independent `{type === '…' && (...)}`
JSX gates into one match is itself what keeps the screen under its
cognitive-complexity budget (kiko-code-style). A `'none'`-schedule CREATE
additionally writes a first `manual` price point on the new holding's own
`holding:<id>` series, equal to the principal at the start date
(`buildLoanCreatePayload`,
`src/screens/forms/holding-form/loan/use-loan-fields/`) — mirroring
`PropertySection`'s own first-point convention, so
`loanOutstandingMinorAt`'s manual-series read never comes up empty before
the user records a real correction. An `'annuity'`/`'differentiated'`
CREATE writes none — its outstanding is computed at read time from
principal + schedule.

`holding-detail.screen.tsx`: `loan`'s `holdingDetailSpecs` entry
(`holding-detail-spec/`) gives `'updateValue'` too — it reuses
`PricePointForm` to write a correction onto the SAME `holding:<id>`
manual series every schedule reads a correction from (not just
`'none'`), with the footer button's own label swapped to "Update
outstanding" (`holdingDetail.updateOutstanding`) for that type, and
`PricePointFormScreen` itself overriding the stack's static "Update
Value" title to "Update Outstanding" once the holding loads as a loan.
Every loan (any schedule, `none` included) shows the ledger breakdown
table under the Value header — its spec entry's `breakdown` is
`{ kind: 'loan' }`, rendered by the screen's `loanBreakdownRows` through
the shared `SummaryTable`: Principal / Paid so far / Interest paid /
Principal repaid / Outstanding (`loanLedgerSummary`, above; testIDs
`loan-ledger-principal`, `-paid-so-far`, `-interest-paid`,
`-principal-repaid`, `-outstanding`). Its Outstanding row is the same
number as the Value header, the card, and net worth. Principal repaid is
hidden when it equals Paid so far (`showsPrincipalRepaid` in the screen). An
interest-0 split reads `holdingDetail.paymentSplitPrincipalOnly`
(`paymentSplitText`, `src/screens/holding-detail/payment-split-text/`).
An `'annuity'`/`'differentiated'` loan additionally lists the next scheduled
installments in the loan's ONE day-grouped ledger, beside its linked payments
(the loan entry's own `upcomingInstallments` — every `loanInstallments` row that
`isScheduledPayment` accepts and that is due on or after today's local day
(zero-payment rows after an early payoff are skipped), in schedule order; its
first row is the next installment). Read the screen's `LedgerRow` (a
`kind: 'scheduled'` row), `scheduled-payment-row/`, `use-scheduled-preview/`
(the preview count and the expand toggle) and `use-linked-loan-payments/`
under `src/screens/holding-detail/`. A scheduled row is built on the shared
`EntryCard`, signed and red like a linked row; read
`scheduled-payment-row.component.tsx` for its lines. A linked payment card
shows `paymentSplitText` plus `holdingDetail.remainingBalance`
(`loanLinkedPaymentBreakdownsMinor` in `loan-ledger.ts`, which shares
`balanceAfterPaymentsMinor` with the outstanding read). An ignored payment
(before the start, another currency, a credit, a future one) shows neither.
A `'none'` schedule and every other holding type list no scheduled rows.
The scheduled list is also empty once `loanLedgerOutstandingMinorAt` reads 0
(`upcomingInstallments`' own `<= 0` guard) — a loan fully repaid by its
linked payments, or overpaid/over-corrected, lists nothing even while
`loanInstallments` still has future rows on the loan's ORIGINAL schedule.
Zero-payment rows are skipped too; the filter lives in
`src/screens/holding-detail/holding-detail-spec/holding-detail-spec.ts`.

A loan correction (the "Update outstanding" `PricePointForm` write
above) accepts **0**, unlike every other holding type's "Update
value" (`> 0`): a 0 point means repaid. `loanOutstandingMinorAt`
already clamps every read at 0, and a 0 write never deletes the
holding's earlier points — net worth reads 0 from that day forward
while an earlier day still reads its own, earlier correction.

**Loan EDIT reconciliation** — `holdingsRepo.updateLoan` writes the
metadata patch and a `LoanPricePointOp` in ONE transaction
(`buildLoanPricePointOp`,
`src/screens/forms/holding-form/loan/use-loan-fields/`, called from that
hook's own `saveEdit`), reconciling the loan's manual `holding:<id>`
series against what the metadata edit just changed:

- (a) a schedule change INTO `'none'` (from `'annuity'`/
  `'differentiated'`) preserves the OLD schedule's current outstanding
  as a manual point, so the debt never silently reads as 0 the instant
  the schedule is cleared — the outstanding every screen showed before
  the edit (`loanLedgerOutstandingMinorAt`: the linked payments' when
  any count, else the schedule's), so the value does not jump. Normally
  that point is dated TODAY. But
  `loanOutstandingMinorAt` reads 0 for any instant before the loan's
  own `startDate` (a future-start loan) — dating it today would then
  write a PERMANENT 0 that outlives the start date once it arrives.
  When today is still before the start day, the op instead writes the
  new metadata's own PRINCIPAL at the start day, mirroring the
  create-mode `'none'` first point.
- (b) a `'none'` loan's principal/start-date edit MOVES its start-day
  point — deletes the point at the OLD start day and writes the new
  principal at the NEW start day. Any later correction point stays
  untouched (an edge case: if the new start day lands on or after an
  existing correction's day, that correction is overwritten or
  shadowed — rare, and the ruling is written this way deliberately).
- (c) a `'none'` loan moving OUT to a schedule DELETES the point at its
  OLD start day (`{ kind: 'delete', day }`) — the first point its create
  wrote, holding the OLD principal. Left in place, `loanAnchorAt` reads
  it as a correction and the schedule counts down from the old principal
  (pinned in `use-loan-fields.test.ts`). Moving it to the new start day
  is NOT equivalent: a
  correction anchor (`fromCorrection: true`) skips the ledger's
  "schedule before the first link" anchor. Any later correction stays —
  it is still valid for a scheduled loan.
- (d) every other transition leaves the manual series untouched.

A fresh holding (`oldMeta === null`) has nothing to reconcile.

`termMonths` is capped at `MAX_TERM_MONTHS` (`src/holdings/term-limits/`,
600 months / 50 years — comfortably above any real mortgage/car-loan
term): an uncapped value would make `loanInstallments` build an
unbounded row count for a degenerate but technically-valid positive
integer. A term deposit's own `termMonths` is capped at the SAME
shared constant, for the identical reason on its compounding math;
there is no separate deposit-specific cap.

Both terms are ENTERED in months or years and STORED as `termMonths`:
the deposit and loan forms share one `TermField`
(`src/screens/forms/term-field/`) — a number field whose suffix follows
a Months/Years `ChipRow` (a unit choice that leaves the form the same,
like the metal Unit chips). `src/screens/forms/term-reasons/` is the ONE term
check both twins call: `termReasonKey(value, unit)` (a whole number
above 0, at most `termMaxFor(unit)` — 600 months or 50 years, each
with its own error key naming the unit), `termMonthsFromInput` (years
x 12) for the payload, and `termInputFromMonths` for the edit seed (a
whole number of years seeds Years, anything else Months). Switching the
unit keeps the typed number and revalidates it in the new unit.

### Loan-payment link column + repo

Migration 0038 adds three columns to `transactions`: `loanHoldingId`
(text, nullable — the linked loan holding), `loanLinkSource` (text enum
`'auto' | 'manual'`, nullable), and `loanLinkRejected` (integer boolean,
NOT NULL default `false`). The two link columns are kept in lockstep — never a
`loanLinkSource` with no `loanHoldingId` or vice versa.

**Two separate write paths, not one**: only a
MANUAL action may ever move `loanLinkRejected`.

- `transactionsRepo.setLoanPayment({ transactionId, loanHoldingId })` is the
  MANUAL path (the user's own picker). A manual LINK
  (`loanHoldingId` non-null) clears `loanLinkRejected`, un-rejecting a row
  the user had previously undone — a fresh manual pick always overrides an
  earlier Undo. A manual **"None"** (`loanHoldingId: null`) **SETS**
  `loanLinkRejected` — the user's explicit "not a loan payment"
  has to stick, or the very next sync would just auto-link the row again.
  A manual None clearing the flag instead would make "None" not stick.
  `loanHoldingId: null` also nulls `loanLinkSource`, keeping the two
  columns in lockstep. No `source`-column gate — exactly like `setCategory`,
  the link is user state, not a mutation of bank-owned ledger data, so it
  is allowed on a synced (`monobank`/`binance`/`import`) row too.
- `transactionsRepo.setAutoLoanLinks(links: { transactionId, loanHoldingId }[])`
  is the matcher's path: writes every link in ONE `db.transaction()` call, NEVER touches
  `loanLinkRejected`, and its own WHERE clause skips any row that is
  already linked (`loanHoldingId` non-null) or already rejected — so a
  stale candidate read, or a race with the user's own Undo/manual link,
  can never silently overwrite either.
- `transactionsRepo.undoAutoLoanLink(transactionId)` is the Undo
  affordance: clears both link columns and sets `loanLinkRejected`, scoped
  to `loanLinkSource = 'auto'` — calling it on a manual link is a no-op,
  not a rejection.

`transactionsRepo.addManyDedup`'s upsert (the shared `(source, external_id)`
conflict path both the Monobank sync and statement import share) never
refreshes any of the three loan-link columns on a re-sync — its
`onConflictDoUpdate` `set` names only the bank-owned columns, the same
exclusion `comment` relies on (`category` is excluded except in
`ruleWonTransactionSet`'s guarded CASE; see kiko-domain's "Re-syncing an
existing `externalId`" paragraph) (see
that function's own existing doc comment). Its `setWhere` is derived from
that SAME `set`
column list (`BANK_OWNED_TRANSACTION_COLUMNS`), so the UPDATE — and the
`transactions` reactive-query fire it would otherwise trigger — is skipped
entirely when a re-fetched row is unchanged; the loan-link columns are
excluded from that comparison too, since they are never in `set` either.
A settled-amount re-fetch of an already-linked payment
therefore keeps its link untouched. Its underlying insert
(`upsertDedupRowsDatabaseTransaction`) is chunked through `chunkForTable`
(below) — a whole
statement-import file or Monobank sync above a few thousand rows failed
`SQLITE_MAX_VARIABLE_NUMBER` before this.

`clearLoanLinksForHoldingsDatabaseTransaction(databaseTransaction, holdingIds)`
(a module export of `src/holdings/repo/holdings.repo.ts`, not private to the
holding delete) clears `loanHoldingId`/`loanLinkSource` on every OTHER
holding's transaction that still points at one of `holdingIds`, in the SAME
`write()` transaction as the delete itself (`UPDATE transactions SET
loan_holding_id = NULL, loan_link_source = NULL WHERE loan_holding_id IN
(...)`) — a no-op for every non-loan holding, since nothing ever points a
`loanHoldingId` at one. Both delete paths call it:
`removeHoldingDatabaseTransaction` (one holding,
reached through `transactionsRepo.removeHolding`) AND `accountsRepo.remove`
(every holding a deleted DEBT
account owned, since a loan lives on a manual `debt` account) — a loan
deleted either way never leaves a dangling link behind. A dangling link is
never left to rot: once cleared, the payment counts as normal spending
again, exactly like an unlinked transaction always has. `loanLinkRejected`
is deliberately left untouched by this cascade — it is not part of "the
link".

`restoreDataSnapshot` inserts every `transactions` row verbatim with no
per-row column handling for these three columns (unlike
`holdings.balanceSetAt`'s and `transactions.setsBalance`'s dedicated
legacy backfills), so a `.kiko` exported
before this migration — whose transaction rows carry no
`loanHoldingId`/`loanLinkSource`/`loanLinkRejected` keys at all — restores
unchanged and SQLite defaults the missing columns itself (null / null /
false), the same way `counterIban`/`changeGroupId` already do for an older
export. Chunking every insert by a fixed row count breaks once a
table's own column count grows: three new columns took `transactions`
from 15 to 18 columns, so
the OLD fixed 2000-rows-per-chunk constant bound 2000 x 18 = 36000
parameters — over SQLite's 32766-bound-parameter ceiling — and a `.kiko`
backup with >= 1821 transactions failed to restore. `chunkForTable`
(`src/db/chunk-for-table.ts`, shared with `upsertDedupRowsDatabaseTransaction`
above) derives
the row count per chunk from the TARGET table's own column count
(`getTableColumns`, floor-divided into a safety margin under the ceiling)
instead of a fixed row constant, so a future column added to any of these
tables can never silently repeat this — the widest table just gets a
smaller chunk automatically.

### The automatic loan-payment matcher

`matchLoanPayments` (`src/loans/payment-matcher/`) is a pure, idempotent
function: `{ transactions, loans, now } -> { transactionId, loanHoldingId,
dueDate }[]`. `loans` takes plain holding rows (`Pick<HoldingRow, 'id' |
'currency' | 'metadata'>`) and parses `LoanMeta` internally, mirroring
`loan-payments.ts`'s own `LoanHolding` convention. A link is proposed only
when ALL of these hold, checked over the FULL candidate matrix (never a
sequential filter, so an ambiguity check never depends on which one runs
first):

1. **Amount**: within the LARGER of ±1% or ±1.00 (the loan's own currency)
   of the scheduled installment's own payment (`withinInstallmentTolerance`,
   `src/holdings/loan-schedule/`). The ledger books the part above the
   scheduled payment as a fee, not principal; the cap is decided by amount
   alone, for an auto or a manual link.
2. **Date**: the transaction's local day is 3 days before to 7 days after
   the installment's own `dueDate` — both bounds inclusive — and never
   before the loan's start day (`withinDateWindow` clamps with
   `isOnOrAfterLoanStartDay`; row 1's window opens ON the start day).
3. **A third signal**, at least one of: the transaction's `holdingId`
   equals the loan's own `paymentHoldingId`; its `counterIban` equals the
   loan's own `lenderIban` (both compared through `normalizeIban` — strips
   whitespace, uppercases, so a cosmetic difference between a typed IBAN and
   a bank feed's own `counterIban` never false-negatives); or its
   `description` contains (case-insensitive) one of a fixed keyword list
   (`кредит`, `погашення`, `іпотек`, `позик`, `loan`, `mortgage`,
   `repayment`) or the loan's own `lenderName` (only when
   `lenderName.trim().length >= 3` — shorter is too likely to appear inside
   an unrelated description by coincidence). Amount + date ALONE never links
   (a same-size monthly rent must not false-positive).
4. **Uniqueness**: exactly one candidate transaction per installment, and
   that transaction matches exactly one installment of one loan — two
   candidates for one installment, or one transaction matching two
   installments (same loan or different), links neither.

The candidate transaction itself must be a debit, not already linked
(`loanHoldingId` null), not previously rejected (`loanLinkRejected`
false), and not one leg of an Exchange/Convert (the structural
`exchangeCounterpartHoldingId` marker) — `transactionsRepo.
loanMatchCandidatesQuery({ minTime, currencies })` pre-filters all four in
SQL (P-NOWORK: never read a row the matcher can never link) plus bounds the
scan to `time >= minTime` and `currencies` (the caller derives `minTime`
as `startOfLocalDay` of the earliest open loan's own `startDate`, one
eligibility definition with the matcher; `WINDOW_BEFORE_DAYS` is private
to the matcher and `use-loan-auto-link` no longer imports it, and
`currencies` as the open loans' own distinct
currencies — never a whole-table scan), and the pure function also
re-checks the four eligibility conditions itself, so it stays correct when
unit-tested directly. An informal (`'none'`-schedule) loan is never
matched: `loanInstallments` already returns `[]` for it, so it contributes
no candidate installment at all — no separate schedule check is needed.
A zero-payment row is never a matcher candidate
(`src/loans/payment-matcher/payment-matcher.ts`), because the matcher's 1.00
tolerance floor would otherwise match a debit of up to 1.00.
`now` bounds installments to `dueDate <= now + 3 days` (the window's own
before-margin) — a cheap UPPER bound only, never a lower one (the lower
bound is the loan start day, above), so a freshly
created/edited loan backfills its WHOLE past history the first time this
runs.

**An installment already taken by a linked row never accepts a second
one.** `matchLoanPayments` takes an optional `linkedPayments` — every row
ALREADY linked (manual or auto alike) to one of `loans`, read separately
through `transactionsRepo.loanLinkedPaymentsQuery(loanHoldingIds)` — because
`loanMatchCandidatesQuery` itself EXCLUDES an already-linked row from its
own candidate read, so without this second list the installment that row
already paid would look unpaid again on the very next run, and a LATER
same-amount transaction (a same-size monthly rent, say, arriving with its
own valid third signal) could take its place — silently double-counting one
installment across two real payments. An installment counts as taken the
moment ANY `linkedPayments` row for that SAME loan still passes rules 1
(amount) and 2 (date) against it — the third signal is deliberately not
re-checked (the link already proved it once, and `linkedPayments` carries
no description/holdingId/counterIban to re-check it with anyway) — and a
taken installment is removed from consideration entirely before the
candidate matrix is built, so neither the real linked row (already excluded
from candidates) nor any other transaction can claim it. `linkedPayments`
defaults to none, so an existing caller/test that has no such list yet
keeps its prior behavior unchanged.

**A loan edit that changes what the matcher would now require clears that
loan's own AUTO links first.** `holdingsRepo.updateLoan`'s optional 4th
param `clearAutoLinks` (default `false`) clears ONLY this loan's
`loanLinkSource = 'auto'` rows (never a manual link, never a rejected row)
in the SAME transaction as the metadata patch. The loan form's own
`saveEdit` (`use-loan-fields.ts`, `loanEditInvalidatesAutoLinks`) passes
`true` when EITHER the amortization schedule itself changed — compared as
`loanInstallments(oldMeta)` vs `loanInstallments(newMeta)` (`dueDate` +
`paymentMinorUnits`, so a `principalMinorUnits`, `schedule`,
`annualRatePct`, `termMonths`, OR `startDate` edit is all caught the same
way, with no per-field list to drift out of sync with `loanInstallments`'s
own math) — OR one of rule 3's own "paid from"/lender signals changed
(`paymentHoldingId`, `lenderIban` compared normalized, `lenderName`): any of
these changes what `loanInstallments` or rule 3 would derive going forward,
so a stale AUTO link proved against the OLD terms would otherwise count as
"taken" (above) forever, even once it no longer corresponds to any real
installment of the new ones. A `'none'`-schedule loan has no installments at
all regardless of principal, so it never receives an AUTO link to begin
with — an edit to one never clears anything. Clearing it here, before the
fire-and-forget matcher re-run that follows every loan edit, lets that
re-run recompute cleanly.

`src/loans/use-loan-auto-link/` (`runLoanAutoLink`, a plain async
function, not a hook — so a non-component caller, e.g.
`import-statement.ts`, can call it directly): reads
`holdingsRepo.loanHoldingsQuery()` (every OPEN loan) FIRST and returns
before ever touching the transaction table when it is empty, or when every
loan holding's own metadata fails to parse (P-NOWORK — there is then no
installment, currency, or start date to bound the read with either);
otherwise reads `transactionsRepo.loanMatchCandidatesQuery` (bounded, above)
and `transactionsRepo.loanLinkedPaymentsQuery` (the taken-installment input,
above) together, runs `matchLoanPayments`, and writes any result through
`transactionsRepo.setAutoLoanLinks`. Never rejects — every failure is
caught and logged, the same "log instead of drop" contract
`refresh-market-data.ts` established for its own background refreshes, so
a failed auto-link never turns a successful sync/import/save into a shown
error. Called after: every sync completion path (`useSync`, `useSyncAll`,
`useAutoSync` — the same three sync surfaces (`useSyncAll`/`useAutoSync`
reach `refreshMarketData` through `settleJobsBesideMarketRefresh`;
`grep -rn "refreshMarketData(" src` lists the direct callers));
`importParsedStatement` (ONE
insertion point covers both its callers — the dedicated `importStatement`
and the column-mapping screen's direct call); a `.kiko` backup restore
(`data-transfer/import-data.ts`, fire-and-forget, right after the same
gated market-data refresh a restore already triggers — a bulk restore
bypasses every OTHER call site above); and a loan CREATE or EDIT in
`holding-form.screen.tsx` (`runLoanAutoLinkIfLoan`, gated on `type ===
'loan'`, fire-and-forget on both paths — unlike `refreshMarketData`, which
never fires on an edit at all, a loan's principal/schedule/
paymentHoldingId/lenderName/lenderIban all stay editable, so an edit needs
a fresh run too).

`transactionsRepo.setAutoLoanLinks` additionally re-checks that each
link's target loan holding still exists, INSIDE its own write
transaction, before writing it — the matcher computes its candidates from
a snapshot read moments earlier, so a loan holding can be deleted in the
gap between that read and this write; a link whose loan fails that check
is simply skipped (no error), closing the one race
`clearLoanLinksForHoldingsDatabaseTransaction` cannot: that cascade only
clears a link that ALREADY exists at delete time, not one this call has
not written yet.

`paymentHoldingId`/`lenderName`/`lenderIban` are entered in the loan
form's own `LoanSection` (`PaymentHoldingField`'s "Paid from" picker plus
two plain text fields), hidden alongside rate/term for a `'none'`
schedule — the matcher never links against an informal debt at all, so
they would do nothing there. None are required. `PaymentHoldingField`
(`src/screens/forms/payment-holding-field/`) is the clearable
single-select holding-picker chrome `LoanPaymentField` (the transaction
form's own loan-payment field) also composes, for its own auto-link
caption + Undo on top.

`buildPaymentHoldingOptions` (`holding-form.screen.tsx`) unions the loan's
own CURRENTLY selected `paymentHoldingId` back into the "Paid from"
picker's options even once that holding has since closed or moved
currency — the same "a filter never hides an active selection" rule
`buildLoanOptions` (below) already follows on the transaction form's own
loan-payment field, or the picker would resolve no match for a link that
still exists in the metadata and silently show "None". `isLoanFieldVisible`
(`src/screens/forms/transaction-form/mode-and-actions/mode-and-actions.ts`)
shows that field whenever the row already
carries `selectedLoanHoldingId`, regardless of the row's own amount
sign — a linked row later edited from debit to credit must still reach the
field where None/Undo live.

**The loan holding-detail screen's own list is the only way to review an
auto link** (a loan is ledgerless, so it carries no ledger of its own
transactions to review). There is no separate Linked Payments section, divider
or heading: a loan shows the same Transactions divider and heading as any
holding, and every transaction linked (manual or auto) to that loan is a list
row, via `useLinkedLoanPayments` (`transactionsRepo.listLinkedToLoanQuery`,
one live query, disabled outright for a non-loan holding). A row with a blank
label shows the payer holding's name. Tapping a row opens the transaction
form, where None/Undo live. With no row at all the list shows an `EmptyState`
(`holding-detail-loan-payments-empty`,
`holdingDetail.emptyLoanPayments.title`/`.message`). A loan also reads
`accountsRepo.listQuery()` for the View actions. Code: the list in
`src/screens/holding-detail/holding-detail.screen.tsx`.
