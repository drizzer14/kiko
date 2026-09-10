# Phase B2 diagnosis — 2026-09-10

Debugger: kiko:debugger. Worktree `phase-b2-diagnose` on local main `e33b181`
(Phase A + Phase B). No code changed. Each item reports root cause, the
anchoring `file:line`, and a recommended fix approach.

---

## 1) REGRESSION — every entity icon renders blank (cards + icon picker)

**Status: confirmed (static).**

### Root cause

`SymbolIcon` sets the native view frame from the RAW `size` prop, not from the
resolved size.

`src/design-system/components/symbol/symbol.component.tsx:42`

```tsx
style={{ width: size, height: size }}
```

Commit `eaf91dd` removed the `size = 20` default parameter and replaced it with
`const resolvedSize = size ?? theme.iconSizes.body` (line 24). The
`SFSymbolView` `size` prop was updated to `resolvedSize` (line 29), but the
`style` frame on line 42 was left reading the ORIGINAL `size`.

A `SFSymbolView` has no intrinsic size under Fabric (see the comment at
symbol.component.tsx:38-41), so Yoga needs an explicit `width`/`height`. When a
call site omits `size`, `size` is `undefined`, the frame becomes
`{ width: undefined, height: undefined }`, Yoga lays the view out at 0x0, and
the glyph never paints.

This matches the symptom exactly:

- Holding card — `src/screens/account-detail/holding-card/holding-card.component.tsx:95`
  passes NO `size` → blank.
- Icon picker — `src/screens/settings/icon-picker-modal/icon-picker-modal.component.tsx:257`
  passes NO `size` → blank.
- Entity header icon — `src/screens/entity-header-icon/entity-header-icon.component.tsx:25`
  passes `size={28}` → still renders (explains why only default-size glyphs broke).

SF-Symbol iOS-27 availability and a prop rename were ruled out: the breakage hits
EVERY default-size glyph regardless of symbol name, and the frame math fully
explains it.

### Recommended fix

Use the resolved size in the style frame:
`style={{ width: resolvedSize, height: resolvedSize }}` at
symbol.component.tsx:42.

---

## 7) Monobank total ~120 UAH higher than the statement; per-asset values match

**Status: leading root cause identified; confirm one number on-device.**

### Root cause (leading)

The Monobank sync stores the card `balance` WITHOUT subtracting `creditLimit`.

`src/monobank/sync.ts:230`

```ts
balanceMinorUnits: account.balance,
```

Monobank's account `balance` field is own funds PLUS the available credit limit
(`account.creditLimit`). `creditLimit` is never read or subtracted anywhere in
`src/` — verified: the identifier appears only in
`src/monobank/monobank.types.d.ts:14` and the test fixtures (both `0`). Net worth
is assets-only (kiko-domain), so a credit limit is the bank's money and must not
count as an asset.

Why this matches the symptom precisely:

- The per-card figure in Kiko equals `balance` (incl. limit), which ALSO equals
  the per-card balance Monobank's own statement/app shows — so each per-asset
  value "matches the statement."
- The user's true own-money TOTAL excludes the limit, so the Kiko total reads
  high by the credit limit (a ~120 UAH overdraft limit fits).

### Aggregation path reviewed (rounding ruled out)

The headline/account total sums each holding converted-and-rounded individually:

- `src/rates/conversion.ts:30-39` — `netWorth` reduces with
  `sum.add(convert(holdingValue(h), base))`.
- `src/rates/conversion.ts:26-27` + `src/currency/money.ts:25` — `convert` ->
  `Money.fromMajor` -> `Math.round`, so each holding is rounded before the sum.

This "sum of rounded conversions" differs from "round of the summed conversion"
by at most a fraction of a cent per holding — it CANNOT produce 120 UAH. A
double-count was also ruled out: `upsertByMetadataKey`
(`src/repositories/holdings.repo.ts:63-95`) dedups correctly on
`json_extract(metadata,'$.monobankId')`, and both the per-asset card grid and
the total use the identical `activeHoldings` set and the same `holdingValue`
(`src/screens/account-detail/account-detail.screen.tsx:117,126-127`;
accounts list `src/screens/accounts/accounts.screen.tsx:110-113`).

### Recommended fix + verification

1. On-device: read the connected Monobank account's `creditLimit` and confirm it
   equals the ~120 UAH gap.
2. If confirmed, store own funds at the sync boundary:
   `balanceMinorUnits: account.balance - account.creditLimit` (sync.ts:230), and
   decide how a negative own-funds (used overdraft) should display.
3. If the gap is NOT the credit limit, add per-holding instrumentation to the sum
   (log each holding id, currency, `balanceMinorUnits`, `holdingValue`, converted
   value, running total) and reconcile against the statement line items to find a
   stale/duplicate DB row.

### UPDATE (2026-09-10, after coordinator feedback)

- The user confirmed the card's `creditLimit` is 0, so the credit-limit
  hypothesis is ruled out.
- **Item 7 not reproducible after a fresh sync; transient staleness; closed.**
  The +120 UAH was stale/pending data, not a code bug. No fix is needed.
- Corroborating observation (not a fix): `upsertAllHoldings`
  (`src/monobank/sync.ts:319-372`) only UPSERTS the holdings present in the
  current client-info snapshot. There is no reconciliation step that closes a
  holding Monobank stops returning (a closed card, a deleted jar). Such a row
  keeps `closedAt = null` and its last-synced balance, so it stays in the total
  until something updates it — a plausible mechanism for the transient staleness.
  Tracked as a possible future hardening, not part of this diagnosis round.

---

## 8) Net-worth chart dips today on a card→bond transfer

**Status: confirmed (static) — wrong lever pulled in Phase B.**

### Root cause

The net-worth line is built by a DIFFERENT code path that never consults
`transfer-exclusion.ts`. Adding the stem `облігац` to transfer-exclusion
(`src/statistics/transfer-exclusion.ts:73`) only affects the SPENDING category
breakdown, not the net-worth line.

Proof the two paths are separate:

- `src/screens/statistics/statistics.screen.tsx:398-399` — comment:
  "Scoped to THIS chart only — every other view (net worth, by-type, account pie)
  still sees the full ledger."
- `src/statistics/net-worth-series.ts:88-96` — `buildNetWorthSeries` sums the
  full `txByHolding` ledger per bucket; no exclusion set is passed in.

The dip itself is a valuation-timing gap, not an exclusion gap. For a
card/cash/crypto holding the value is reconstructed from its full ledger:

`src/statistics/holding-value-at.ts:36-40`

```ts
const applied = transactions
  .filter((transaction) => transaction.time <= t)
  .reduce((sum, transaction) => sum + transaction.amountMinorUnits, 0);
return openingBalance + applied;
```

So the bond-purchase debit on the card (a real "Купівля облігацій" row, typically
a Monobank-synced debit) reduces net worth at its timestamp. Net worth is
assets-only, so it is only kept flat if the offsetting bond asset is valued on the
SAME day. A bond holding is valued by `bondBreakdown`
(`src/holdings/holding-value.ts:102-135`), which returns zero while
`meta.purchaseDate > now` (line 114). If the card debit is dated before the bond
holding's `purchaseDate` (or the bond holding is absent/mis-dated), there is a
window where the card already dropped but the bond contributes nothing → the dip.

### Recommended fix approach

Do NOT try to exclude the transfer from the net-worth line — a card→bond move is
asset-neutral and should net to zero. Instead ensure the counterpart bond asset
is credited on the debit's day: co-date the bond holding's `purchaseDate` with the
card debit and confirm the bond holding is in `filtered.visibleHoldings`. On
device, inspect the bond holding row's `purchaseDate` metadata versus the card
debit `time`. Separately, clarify to the user that the Phase B transfer-exclusion
fix correctly addressed the SPENDING chart, which is a different chart.

---

## 12) Category-suggestion modal missing when changing category on the crypto holding screen

**Status: confirmed (static) — the deciding factor is the description, not the screen.**

### Root cause

Both ledgers open the SAME `TransactionForm` for a row:

- Home ledger — `src/screens/home/home.screen.tsx:412`
- Holding-detail ledger — `src/screens/holding-detail/holding-detail.screen.tsx:336-338`

The "Apply Category to All" sheet is gated on a NON-BLANK normalized description,
not on the originating screen:

- `src/screens/forms/transaction-form.screen.tsx:1054` — the rule name is the
  row's description: `const name = isReadOnly ? (existing?.description ?? '') : description;`
- `src/screens/forms/transaction-form.screen.tsx:216-225` —
  `resolveCategoryOverrideRequest` returns `null` when
  `normalizeTransactionName(name) === ''` (guard at line 221).
- `src/screens/forms/transaction-form.screen.tsx:1057-1061` — the sheet opens
  only when that request is non-null.

Crypto (Binance) transactions import with an EMPTY description:

- `src/crypto-sync/binance/binance.transactions.ts:177` and `:209` —
  `description: ''`.
- `normalizeTransactionName('')` is `''`
  (`src/transactions/normalize-name.ts:8`).

So for a crypto row the override request is `null`, the sheet is skipped, and the
category is written single-row via the fallback at
`src/screens/forms/transaction-form.screen.tsx:1072-1076`
(`transactionsRepo.setCategory`). A Monobank ledger row carries a merchant
description, so the sheet opens there. This is the behavior the code comments
already describe (transaction-form.screen.tsx:720-725).

Conclusion: this is description-gated, working as currently designed — a name
rule has no name to match on for a blank-description crypto row. It is a
consistency gap, not a crash.

### Recommended fix approach (product decision needed)

- Option A (keep single-row write): accept that blank-description rows skip the
  name rule; optionally tell the user the pick applied to this row only.
- Option B (enable propagation for crypto): give crypto transactions a stable,
  matchable description at import (for example the asset ticker or operation
  type) at binance.transactions.ts:177,209, so the name rule can group same-asset
  rows. Weigh that this would make the rule propagate across every same-ticker
  crypto row.
