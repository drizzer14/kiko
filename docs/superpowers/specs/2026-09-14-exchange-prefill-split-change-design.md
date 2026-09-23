# Design spec: Exchange prefill (card → cash) + Split change across holdings

Status: FOR USER REVIEW — design only, no implementation. This spec
becomes an implementation track LATER, after the crypto track
integrates. Every model claim below is grounded in the code as it
stands on `next-exchange-split-plan` (based on `next` @ 039e2ac); each
cites its `path:line`/symbol. Where a stated requirement contradicts
the real code, that is called out explicitly in-line and again in
section 5.

---

## 1. Context — the shared card ↔ cash money-movement workflow

Both features are variations on ONE workflow: a single physical
money-movement that must land as MULTIPLE ledger rows across DIFFERENT
holdings, written atomically, without double-counting in the spending
pie or in net worth.

### 1.1 The grounded model

- **A transaction is one signed amount against ONE holding.**
  `transactions` (`src/db/schema.ts:66`) has `holdingId` (FK, `:70`),
  `amountMinorUnits` (signed integer, `:73`), `time` (unix ms, `:74`),
  `source` (`'manual' | 'monobank' | 'btc_wallet' | 'binance'`, `:115`),
  `externalId` (nullable, unique per `(source, external_id)`, `:120`),
  and the structural exchange marker
  `exchangeCounterpartHoldingId` (`:108`).

- **`Money` is minor-units integer math.** `Money`
  (`src/currency/money/money.ts:9`; note kiko-domain cites the stale
  path `src/currency/money.ts`) holds `{ currency, minorUnits }`,
  built via `Money.of` (`:18`) / `Money.fromMajor` (`:22`), with
  `add`/`subtract`/`negate` that throw on a currency mismatch
  (`#assertSameCurrency`, `:28`). Per-currency scale (`BTC` = 8,
  fiat = 2) via `currencyScale`.

- **A manual write updates its holding's balance in the same
  transaction.** `recordManualTx`
  (`src/transactions/repo/transactions.repo.ts:74`) inserts the row
  AND does a read-inside-transaction `balance += amountMinorUnits`
  (`:96`–`:106`). `recordManual` (`:278`) wraps it in one `write(...)`.
  This is the ONE place a manual row + its balance move together, and
  it targets exactly one holding.

- **An Exchange is TWO independent rows in ONE `write(...)`, tied by
  the marker.** `recordExchange` (`:291`): a source leg
  `−valueOutMinorUnits` on `sourceHoldingId`, a destination leg
  dispatched by `exchangeReceivePath(destinationType)`
  (`src/holdings/exchange-destination/exchange-destination.ts:12`) —
  `plain` (`+valueIn`) for cash/card/crypto_asset, `contribution`
  (deposit metadata, no credit row) for term_deposit, `excluded`
  (throws) for bond/jar. Each leg stores the OTHER leg's holding id in
  `exchangeCounterpartHoldingId`; NO description is persisted — the
  label resolves at render time
  (`src/transactions/exchange-description.ts`). Source and target
  currencies MAY differ; each leg is `Money.fromMajor` in its own
  holding's currency (`transaction-form.screen.tsx:968`–`969`).

- **Convert already records the MISSING leg of an EXISTING row.**
  `recordExchangeCounterpart` (`:353`) writes only the one absent leg
  and NEVER mutates the existing row, except `markExistingLegTx`
  (`:118`) sets the marker back on it — **but only when the existing
  row's `source === 'manual'`** (`:128`). A synced (bank-owned) row is
  left unmarked by design (the documented residual on `schema.ts:105`).
  Eligibility is `canConvertToExchange`
  (`src/holdings/exchange-convert/exchange-convert.ts:17`) =
  `isExchangeSourceType` (cash/card, `exchange-destination.ts:26`)
  AND a non-zero amount; direction is chosen by the existing amount's
  sign (`exchangeConvertDirection`, `:20`): an EXPENSE (`< 0`) →
  `record-destination`, an INCOME (`> 0`) → `record-source`.

- **Create-Exchange is CASH-source-only; Convert is the wider
  cash/card rule.** The form's mode row offers Exchange only from a
  cash holding on a fresh add — `resolveModeOptions`
  (`transaction-form.screen.tsx:236`) gates on `isExchangeCreateSourceType`
  (`exchange-destination.ts:40`, cash only). Convert-mode keeps the
  wider `isExchangeSourceType` (cash/card, `resolveConvertView`,
  `transaction-form.screen.tsx:352`). This distinction is load-bearing
  for Feature 1: a CARD is NOT a valid create-Exchange source, but a
  card row IS convertible.

- **A synced card withdrawal's real row shape.** `mapStatementItem`
  (`src/monobank/sync/sync.ts:232`): `amountMinorUnits: item.amount`
  (negative for a withdrawal, `:238`), `mcc: item.mcc` (`:241`),
  `category: categoryForMcc(item.mcc)` (`:247`), `source: 'monobank'`
  (`:249`), `externalId: ${accountId}:${item.id}` (`:258`),
  `hold`/`counterIban` set. It is written on the card's holding.
  Re-syncing REFRESHES only bank-owned columns and never
  `category`/`comment`/the exchange marker (`addManyDedup`
  `onConflictDoUpdate` set, `transactions.repo.ts:544`).

- **Net worth reads BALANCES, not rows.** `netWorth`
  (`src/rates/conversion/conversion.ts:30`) sums
  `holdingValue(holding, now)` (which, for cash/card, is
  `balanceMinorUnits` — `src/holdings/holding-value/holding-value.ts`,
  `ValuableHolding` at `:8`) converted to base via `convert` (`:18`,
  `RateTable` keyed `` `${base}:${quote}` `` in MAJOR units, `:16`).
  So any set of rows whose signed amounts sum to `−X` across the
  affected holdings moves net worth by exactly `−X`, automatically.

- **The spending pie counts NEGATIVES ONLY, and drops internal
  movements.** `spendingByCategory`
  (`src/statistics/category-breakdown/category-breakdown.ts`) skips
  every row with `amountMinorUnits >= 0` (`:143`) and every id in
  `excludedTransactionIds` (`:146`). Exchange legs are excluded via
  their marker (`exchangeExcludedTxIds`,
  `src/statistics/exchange-exclusion/exchange-exclusion.ts:16`). A
  cash-out is ALSO excluded by MCC: `isTransferOrCashOut`
  (`src/statistics/transfer-exclusion/transfer-exclusion.ts`) drops
  `mcc ∈ {6011, 6012, 6540}` ALWAYS (`:23`, `ALWAYS_EXCLUDED_MCCS`).
  **This is decisive for Feature 1** — a real ATM card withdrawal is
  already dropped from spending by its MCC, so leaving the synced row
  unmarked introduces no double-count.

### 1.2 Contradictions between the task's stated model and the code

- **"The shared form uses SheetFooter + CurrencyField."** It does
  NOT. The create-transaction form
  (`src/screens/forms/transaction-form.screen.tsx`) renders its Save
  button through `Screen`'s `footer` prop (`:1123`), not `SheetFooter`
  (`src/design-system/components/sheet-footer/`, whose only consumers
  are the trend-filter, date-range, and icon-picker sheets). Money
  amounts are entered with `TextField` + `keyboardType="decimal-pad"`
  + a currency-symbol `suffix` (e.g. `exchange-fields.component.tsx:38`),
  never `CurrencyField`. **`CurrencyField`
  (`src/design-system/components/currency-field/currency-field.props.d.ts`)
  is a currency-CODE picker (UAH/USD/BTC)** used by the holding/account
  forms and Settings, not a money-amount field. The recent rework
  (commits 55911bb/14be97b) virtualized that CODE picker and added a
  keyboard toolbar; it did not put `CurrencyField` into the transaction
  form. Both features below build on the ACTUAL components
  (`TextField`, `HoldingSelectField`, `Screen` footer, `BottomSheet`),
  not the assumed ones.

- **"Feature 1 is a fresh create-Exchange from the card."** It cannot
  be, as stated — create-Exchange is cash-source-only
  (`isExchangeCreateSourceType`, cash only). The card→cash movement is
  natively a CONVERT of the existing synced withdrawal (an expense on a
  card holding, which the wider `isExchangeSourceType` cash/card rule
  admits). This reframes Feature 1 (see section 2).

---

## 2. Feature 1 — Exchange prefill (card → cash)

**Scenario.** The user withdraws cash from a synced card. The sync
imports a card-withdrawal row (negative, `source: 'monobank'`, on the
card holding). The user then records the matching cash deposit as an
exchange, with the cash (target) amount seeded from a rate applied to
the withdrawal (source) amount. Source and target currencies MAY
differ.

### 2.1 Grounded model touchpoints

- The withdrawal is an EXPENSE on a card holding →
  `canConvertToExchange` is TRUE (cash/card, non-zero,
  `exchange-convert.ts:17`), direction `record-destination`
  (`:23`). This is EXACTLY what the existing Convert flow already does
  (`recordExchangeCounterpart`, `transactions.repo.ts:353`;
  `saveConvert`, `transaction-form.screen.tsx:987`).
- The counterpart (cash) leg's currency comes from the picked
  destination holding (`counterpart.currency`,
  `transaction-form.screen.tsx:1008`), so cross-currency is already
  handled — a USD card withdrawal → UAH cash uses the UAH holding's
  scale.
- The ONE thing missing today: the counterpart amount field starts
  empty (`counterpartAmount` initial `''`,
  `transaction-form.screen.tsx:773`) and the user types it. Feature 1
  is: (a) get the user INTO this flow for the right withdrawal, and
  (b) SEED `counterpartAmount` from a rate.
- Rate source: `ratesRepo.allQuery()`
  (`src/rates/repo/rates.repo.ts:10`) → a `RateTable` (`base:quote`
  major, `conversion.ts:16`); seed `valueIn ≈ valueOut_major × rate`.
  A same-currency withdrawal (UAH card → UAH cash) needs no rate
  (1:1). A missing pair (`convert` throws, `conversion.ts:23`) means
  "no seed" — the field stays blank and editable, never a crash.
- The synced withdrawal itself needs NO mutation: its MCC (6011/6012/
  6540) already excludes it from the pie
  (`transfer-exclusion.ts:23`), so `markExistingLegTx` correctly
  skipping the bank row (`transactions.repo.ts:128`) causes no leak.

### 2.2 Approaches — how the user LINKS the source withdrawal

**Approach A — Convert-from-detail + rate prefill (reuse the existing
Convert path).** The user opens the synced withdrawal row in a ledger,
taps the existing "Convert to exchange" action
(`transaction-form.screen.tsx:599`), picks the cash destination; the
form PREFILLS `counterpartAmount` from the seeded rate applied to the
withdrawal's amount. The link is implicit (you started from that row's
`transactionId`).
- Trade-offs: **+** smallest change — reuses a proven, tested path
  (`recordExchangeCounterpart`) and adds only a prefill; never mutates
  the bank row; cross-currency already works. **−** the user must find
  the specific withdrawal in the ledger and know to convert it; no
  discovery affordance.

**Approach B — "Record cash deposit" create flow with a
withdrawal picker.** From the cash holding (or the global add),
open an exchange-like form that lists RECENT synced card-withdrawals
(a new query: `source='monobank'`, negative, on a card holding,
recent, not already converted). Picking one seeds the source (card
holding + Value Out = withdrawal amount) and the rate seeds Value In.
- Trade-offs: **+** entry from the cash side matches the user's mental
  "I'm depositing the cash now" framing. **−** most new UI (a new
  picker + a "recent unconverted withdrawals" query); must route the
  write through `recordExchangeCounterpart` under the hood anyway (the
  card source is not a create-Exchange source); "already converted" is
  hard to detect cheaply because the bank row is never marked (2.1).

**Approach C — Auto-suggest / smart match.** After a sync imports a
cash-out (detectable by `mcc ∈ {6011,6012,6540}`,
`transfer-exclusion.ts:23`), surface a suggestion — a Home/ledger
banner or a per-row affordance "Record the cash you withdrew?" — that
opens the Convert flow (Approach A) pre-targeted and pre-seeded.
- Trade-offs: **+** best UX, near-zero user effort. **−** most work
  and the only heuristic-bearing option (false positives if a cash-out
  was not turned into a tracked cash holding); should layer ON TOP of
  A, not replace it.

### 2.3 Recommendation

**Approach A now, with Approach C as a fast-follow.** A is the
minimal, lowest-risk, model-aligned change: it reuses
`recordExchangeCounterpart`/`saveConvert` untouched and adds only a
one-time prefill of `counterpartAmount` from `ratesRepo` when the
Convert flow opens on a synced cash-out. C then adds discovery on top
without changing the write path. B is rejected as the primary: it
duplicates entry UI and needs the hard "already converted" signal the
data model deliberately does not carry on bank rows.

### 2.4 Feature 1 — open decisions (see also section 4)

- F1-1 Linking approach: A / B / C. **Rec: A + later C.**
- F1-2 Rate to seed from: latest cached rate (`currencyRates` via
  `ratesRepo.allQuery`) vs the historical rate at the withdrawal's
  `time` (`currencyRateHistory`, `schema.ts:148`). **Rec: latest
  cached, field editable** — the user is recording the cash now and
  can correct it.
- F1-3 Same-currency case: seed Value In = Value Out (1:1) when card
  and cash currencies match. **Rec: yes.**
- F1-4 Missing-rate case: leave Value In blank + editable (no seed),
  never block. **Rec: yes.**
- F1-5 Expose the rate as its own editable field, or only prefill the
  computed Value In? The current `ExchangeFields`/`ConvertExchangeFields`
  have Value Out / To / Value In, NO rate field. **Rec: prefill Value
  In directly, add no rate field** (keeps the two-amount model).
- F1-6 Mark the synced source withdrawal as an exchange leg? Its MCC
  already excludes it from spending (2.1). **Rec: NO — do not mutate
  the bank row; keep the invariant.**

---

## 3. Feature 2 — Split change across holdings

**Model (user-chosen): "record full, then return change."** The full
payment (e.g. `−21200`) records on ONE holding; N return entries
(e.g. `+20`, `+8`) distribute into OTHER holdings; all committed in
ONE action; net effect `−21172`. NON-synced / manual only.

### 3.1 Grounded model touchpoints & the enforced constraint

- **A return MUST be a separate row on its target holding.**
  `recordManualTx` (`transactions.repo.ts:74`) updates exactly ONE
  holding's balance; there is no line-item table. So distributing
  change into OTHER holdings is only possible as additional rows on
  those holdings — a JSON "line items" column on the one payment row
  could never move a second holding's balance. This RULES OUT a pure
  line-items model.
- **Net worth nets automatically.** `−21200` on A `+20` on B `+8` on
  C sums to `−21172` across the three balances, which `netWorth`
  (`conversion.ts:30`) reflects with no extra work (each converted to
  base). The task's `−21172` claim is grounded.
- **The spending pie will OVERSTATE by the change unless netted.**
  The payment `−21200` is a negative row and counts FULL in its
  category; the `+20`/`+8` returns are positive, so
  `spendingByCategory` skips them (`category-breakdown.ts:143`). With
  no link the category reads `−21200`, not the real `−21172`. This is
  the central correctness decision for Feature 2.
- **The 1:1 marker does not fit 1:N.** `exchangeCounterpartHoldingId`
  (`schema.ts:108`) holds ONE counterpart holding id — it cannot
  express one payment ↔ N returns, and marking a positive return with
  it changes nothing in the pie (returns are already skipped as
  positives). Grouping/netting a split therefore needs a NEW
  mechanism, not this column.
- **Constraint enforcement (NON-synced / manual).** The payment and
  every return go through the manual path (`source: 'manual'`). The
  form already blocks editing bank-owned rows via `isReadOnly`
  (`transaction-form.screen.tsx:738`); split-change is offered only on
  a create/manual expense, never on a `isReadOnly` row. **Confirmed
  against the model:** returns are always freshly-written manual rows,
  so the constraint holds by construction.
- **Atomic-multi-row precedent exists.** `recordExchange`
  (`transactions.repo.ts:291`) already writes 2 rows across 2 holdings
  in one `write(...)`; a `recordManualWithReturns(payment, returns[])`
  follows the identical shape (one `write`, N+1 `recordManualTx`
  calls).
- **Dynamic add/remove-row UI precedent.** The holding/deposit form's
  contribution rows (`src/screens/forms/holding-form.screen.tsx`,
  `holding-form.contribution-buttons.test.tsx`) already establish an
  add-a-row / remove-a-row pattern; Remove uses the
  `destructiveTonal` + `size="small"` + trash-icon convention
  (kiko-design-system, "Button").

### 3.2 Approaches

**Approach A — N linked manual rows, atomic, with a new
`changeGroupId` column.** New nullable `transactions.changeGroupId`
(a shared UUID across the payment + its returns; additive Drizzle
enum-free text column, no CHECK, migration is cheap). New repo method
`recordManualWithReturns` writes the payment `−21200` on A and each
`+return` on its holding in ONE `write(...)`. Statistics nets the
group: subtract each linked return from its payment's category so the
pie shows `−21172` (a small change in `spendingByCategory` /
`category-breakdown.ts`, or an exclusion-plus-synthetic-net). Ledger
can label returns "Change from <payment>" resolved at render time
(same pattern as the exchange label).
- Trade-offs: **+** the only faithful AND fully-correct option (net
  worth AND pie), atomic, groups in the ledger. **−** a migration + a
  statistics change + new UI.

**Approach B — N unlinked manual rows, atomic, no schema change.**
Same atomic `write(...)`, but no grouping column. Net worth correct
(`−21172`); ledger shows all rows individually; the pie OVERSTATES the
category by the change (`−21200`), because positive returns are
skipped and nothing nets them.
- Trade-offs: **+** simplest — no migration, no statistics change,
  reuses `recordManualTx`. **−** the spending pie is wrong by the
  change amount; no ledger grouping/label.

**Approach C — collapse to net (record real cost only).** Record
`−21172` on A, no return rows.
- Trade-offs: **+** pie exactly correct, no schema/stats change.
  **−** REJECTED: it contradicts the user's chosen "record full then
  return change" model, loses the change trail, and — decisively —
  cannot put change into OTHER holdings, since a single row moves only
  one holding's balance (3.1). If the change physically landed as cash
  in another holding, that holding's balance would be wrong.

### 3.3 Recommendation

**Approach A** — the atomic `recordManualWithReturns` + a
`changeGroupId` column + a netting tweak in `spendingByCategory`. It is
the only option that honours the stated model, keeps net worth AND the
spending pie correct, and writes atomically. **Fallback: B**, if the
user prefers to avoid a schema + statistics change and accepts that the
category pie overstates by the (usually small) change amount.

### 3.4 Illustrative sketch (NOT implementation)

```ts
// schema.ts (additive, no migration CHECK): text('change_group_id')
// nullable — shared across the payment + its returns.

// transactions.repo.ts — same shape as recordExchange (:291)
type ChangeReturn = { holdingId: string; amountMinorUnits: number }; // > 0
recordManualWithReturns({
  payment: ManualTransaction,      // amount < 0, carries category
  returns: ChangeReturn[],         // each on a DIFFERENT holding
}) => write(tx => {
  const groupId = id();
  await recordManualTx(tx, { ...payment, changeGroupId: groupId });
  for (const r of returns)
    await recordManualTx(tx, { ...r, changeGroupId: groupId });
});
// spendingByCategory: for a payment with linked returns, count
// (payment + Σ returns) in the payment's category (→ −21172), not the
// bare payment (−21200). Returns stay excluded as their own rows.
```

### 3.5 Feature 2 — open decisions (see also section 4)

- F2-1 Linked vs unlinked: A (`changeGroupId` + netting) vs B
  (unlinked, pie overstates). **Rec: A.**
- F2-2 Validation rule: returns ≤ payment? = payment − realCost?
  free-form? There is NO separate "real cost" input — real cost is
  DERIVED as `payment − Σ returns`, so "= payment − realCost" is
  circular. **Rec: each return `> 0` AND `Σ returns < |payment|`** (net
  stays an expense); reject anything else.
- F2-3 Return targets: a different holding per return, or may a return
  land on the paying holding / repeat a holding? **Rec: any OPEN
  holding except the payer, each distinct** (a return to the payer just
  nets the amount — better modelled by a smaller payment).
- F2-4 Arbitrary N: a dynamic add/remove-row list reusing the deposit
  form's contribution-rows pattern + `destructiveTonal`/`small` Remove.
  **Rec: yes.**
- F2-5 Ledger appearance of returns: plain positive rows, or a
  resolved "Change from <payment>" label (needs the `changeGroupId`
  link, A only). **Rec: labelled, with A.**
- F2-6 Statistics net effect: net the linked returns into the
  payment's category (`−21172`), or leave the payment full + returns
  ignored (`−21200`, overstates). **Rec: net (A).**
- F2-7 Currency of returns: same currency as the payment, or any? A
  cross-currency `Σ returns < |payment|` check needs a rate; physical
  change is usually the same currency. **Rec: restrict returns to the
  payment's currency for v1**, note cross-currency as future.
- F2-8 Exchange-mode split: the task says split lives in the create
  form for "manual OR exchange." An exchange already has two legs;
  adding change-returns on top is a compound movement. **Rec: v1
  supports split on the plain manual EXPENSE path only; exchange +
  split deferred** — flag for the user.
- F2-9 Availability gate: offered only on a fresh manual expense
  create (`!isReadOnly`, `!isEditing`, expense sign). **Rec: yes** —
  matches how the form already gates Exchange (`resolveModeOptions`,
  `:236`).

---

## 4. Consolidated open decisions needing the user's call

Each is an explicit choice; the recommendation is the default if the
user does not override it.

### Feature 1 — Exchange prefill

1. **F1-1 Linking approach.** A (convert-from-detail + prefill) / B
   (create flow with withdrawal picker) / C (auto-suggest after
   sync). **Rec: A now, C as fast-follow.**
2. **F1-2 Rate source.** Latest cached rate / historical rate at the
   withdrawal's time. **Rec: latest cached, editable.**
3. **F1-3 Same-currency withdrawal.** Seed Value In = Value Out (1:1).
   **Rec: yes.**
4. **F1-4 Missing-rate pair.** Leave Value In blank + editable, no
   crash. **Rec: yes.**
5. **F1-5 Rate field vs direct prefill.** Add a rate field / just
   prefill the computed Value In. **Rec: direct prefill, no rate
   field.**
6. **F1-6 Mark the synced withdrawal as an exchange leg?** Yes / No.
   **Rec: No — its MCC already excludes it from spending; do not mutate
   the bank row.**

### Feature 2 — Split change

7. **F2-1 Linked vs unlinked.** A (`changeGroupId` + netting) / B
   (unlinked, pie overstates by the change). **Rec: A.**
8. **F2-2 Validation.** **Rec: each return `> 0` AND
   `Σ returns < |payment|`;** reject "= payment − realCost" (circular,
   no realCost input).
9. **F2-3 Return targets.** **Rec: any open holding except the payer,
   each distinct.**
10. **F2-4 Arbitrary N via dynamic rows.** **Rec: yes, reuse the
    deposit contribution-rows UI pattern.**
11. **F2-5 Return rows: separate linked rows vs line-items on one
    row.** **Rec: separate linked rows — line-items cannot move a
    second holding's balance (`recordManualTx` targets one holding).**
12. **F2-6 Ledger label for returns.** Plain positive rows / "Change
    from <payment>" resolved label. **Rec: labelled (needs A).**
13. **F2-7 Statistics netting.** Net returns into the payment's
    category (`−21172`) / leave full (`−21200`). **Rec: net (A).**
14. **F2-8 Currency of returns.** Same as payment / any. **Rec: same
    as payment for v1.**
15. **F2-9 Exchange + split.** Support on exchange create too / manual
    expense only for v1. **Rec: manual expense only for v1.**

### Cross-cutting facts the user should confirm they accept

16. **The task's "SheetFooter / CurrencyField" form description is
    inaccurate** (section 1.2). Both features are designed against the
    real components (`TextField`, `HoldingSelectField`, `Screen`
    footer, `BottomSheet`). Confirm this is fine.
17. **Feature 1 is a CONVERT, not a create-Exchange** (section 1.2 /
    2.1), because create-Exchange is cash-source-only and the source
    here is a card. Confirm the convert-based framing.

---

## 5. Where the real code contradicted a stated requirement

- **"The shared form uses SheetFooter and CurrencyField."** False.
  The transaction form uses `Screen`'s `footer` prop for Save
  (`transaction-form.screen.tsx:1123`) and `TextField` +
  `decimal-pad` + currency `suffix` for amounts; `SheetFooter` is used
  only by three sheets elsewhere, and `CurrencyField`
  (`currency-field.props.d.ts`) is a currency-CODE picker, not a money
  field, used by the holding/account/settings forms. (Section 1.2.)

- **"Feature 1 = record the cash deposit as a create-Exchange from the
  card."** Not possible as literally stated: create-Exchange is
  cash-source-only (`isExchangeCreateSourceType`,
  `exchange-destination.ts:40`). The card→cash movement is natively a
  CONVERT of the existing synced withdrawal (wider cash/card rule,
  `canConvertToExchange`, `exchange-convert.ts:17`). Feature 1 is
  re-framed accordingly. (Sections 1.2, 2.1.)

- **Feature 1's "avoid double-counting the withdrawal" concern is
  already handled.** A real ATM cash-out (`mcc ∈ {6011,6012,6540}`)
  is ALWAYS excluded from the spending pie
  (`transfer-exclusion.ts:23`), so the existing behaviour of NOT
  marking a synced row as an exchange leg (`markExistingLegTx`,
  `transactions.repo.ts:128`) does not leak. (Sections 2.1, 2.4-F1-6.)

- **Feature 2 "returns as line-items on one transaction" is
  infeasible.** A transaction row moves exactly one holding's balance
  (`recordManualTx`, `transactions.repo.ts:74`); distributing change
  into OTHER holdings requires separate rows on those holdings.
  (Sections 3.1, 4-F2-5.)

- **Feature 2 "returns must equal payment − realCost" is circular.**
  There is no independent real-cost input; real cost IS
  `payment − Σ returns`. The enforceable rule is `Σ returns <
  |payment|` with each return `> 0`. (Sections 3.5-F2-2, 4-F2-2.)

- **Minor:** kiko-domain cites `Money` at `src/currency/money.ts`; the
  real path is `src/currency/money/money.ts`. Noted so the
  implementer does not chase the wrong file.

---

## 6. Harness checkpoints for the eventual implementation track

When this design is approved and handed to the developer/qa, the plan
must gate on the standing harness:

- Run `npm run check:all` (lint, dup, knip, deps, security, rules,
  plist, secrets, overrides, typecheck) at each checkpoint.
- Run `npm run check:deep` (mutation + osv-scanner) before declaring
  the feature done.
- A `changeGroupId` schema change (Feature 2, Approach A) means a
  Drizzle migration generated per kiko-architecture ("Storage:
  op-sqlite + Drizzle") — regenerate `migrations.js`, re-run
  `npx biome check --write` over the generated artifacts, and cover the
  new repo method + the statistics netting with Jest per
  `superpowers:test-driven-development`.
</content>
</invoke>
