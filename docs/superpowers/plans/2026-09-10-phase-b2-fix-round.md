# Phase B2 Fix Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 12 on-device findings from the Phase B review across four
parallel tracks plus one sequenced final design pass.

**Architecture:** Four parallel tracks (BUGFIX, DOMAIN, FORMS, DESIGN-core)
each own a disjoint set of files, so no two run concurrently on one file. One
final DESIGN-audit pass (item 13, an app-wide Button audit) runs AFTER every
parallel track integrates, so it audits the final code and never conflicts.

**Tech Stack:** React Native, TypeScript, react-native-unistyles, Drizzle +
op-sqlite, Jest + React Native Testing Library. See `kiko-architecture`,
`kiko-domain`, `kiko-design-system`, `kiko-code-style`.

**Spec:** Debugger diagnosis at
`/Users/drizzer14/orca/workspaces/pff-ios/phase-b2-diagnose/docs/debug/2026-09-10-phase-b2-diagnosis.md`
(items 1, 8, 12). Items 2–6, 9–13 are direct review findings.

**Base:** worktree `phase-b2-plan` on local main `e33b181` (all of Phase A +
Phase B). Item 7 is DROPPED (the +120 UAH was transient stale/pending data,
not a defect). The round is 13 items: 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13,
14. (Item 14 is the principled follow-up to the dropped item 7 — the stale
lingering holding was the likely cause of that transient over-count.)

## Global Constraints

- **Never weaken a check to get green.** Fix the underlying issue. No
  `|| true`, no global suppress, no bare `biome-ignore` (use `OVERRIDE(...)`).
- **Every DB write goes through `db.transaction()`** (kiko-architecture). This
  round writes no new schema; no migration is expected.
- **Secrets live in the iOS Keychain only** — never `.env`, the database, a
  holding's metadata, React state kept after use, or a log (kiko-architecture).
- **Read a token/color/spacing/icon-size from `theme`**, never an inline
  literal (kiko-design-system).
- **`ts-pattern`'s exhaustive `match`** for any closed-literal mapping.
- **Every control is at least 44pt tall** — `size="compact"` holds the 44pt
  floor; never wrap a control in extra hit padding (kiko-design-system).
- **Money math never uses floats** — convert at the repository/`Money`
  boundary (kiko-domain).
- Test one behavior per test; run the failing test first and confirm it fails.

---

## Track overview

| Track | Items | Owner role | Key files (exclusive to the track in wave 1) |
|---|---|---|---|
| BUGFIX | 1, 8, 12, 14 | developer | `symbol.component.tsx`, `holding-value.ts`, `holding-value-at.ts`, `binance.transactions.ts`, `monobank/sync.ts` (+ tests) |
| DOMAIN | 2, 4 | developer | `holding-detail.screen.tsx` (+ test) |
| FORMS | 3, 5, 6 | developer | field primitives, a new `FieldLabel`, the four form screens, `date-range-field.component.tsx` |
| DESIGN-core | 9, 10, 11 | designer | `trend-filter-field.*`, `categories.screen.tsx` |
| DESIGN-audit | 13 | designer | app-wide Button call sites (runs in wave 2, off the integrated main) |

**Zero cross-track shared files in wave 1.** Item 9 keeps BOTH its design half
(9a) and its logic half (9b) in one DESIGN-core task, so the shared file
`trend-filter-field.component.tsx` has ONE owner. Item 13 (the app-wide Button
change) is DEFERRED to wave 2, so its many touch points never race the parallel
tracks. See "Integration model" at the end.

## Shared-file map (which track owns which file)

| File | Owner | Notes |
|---|---|---|
| `src/design-system/components/symbol/symbol.component.tsx` | BUGFIX (1) | one-line fix + test |
| `src/holdings/holding-value.ts` | BUGFIX (8) | bond purchaseDate boundary |
| `src/statistics/holding-value-at.ts` | BUGFIX (8) | valuation-at-time (read-only likely) |
| `src/crypto-sync/binance/binance.transactions.ts` | BUGFIX (12) | import description |
| `src/monobank/sync.ts` | BUGFIX (14) | guarded stale-holding close |
| `src/screens/holding-detail/holding-detail.screen.tsx` | DOMAIN (2 + 4) | both items, same worktree, sequenced |
| field primitives + `FieldLabel` + 4 form screens | FORMS (3 + 5) | item 3 first, then item 5 |
| `src/screens/home/date-range-field/date-range-field.component.tsx` | FORMS (6) | one-line `initialDate` change |
| `src/screens/statistics/trend-filter-field/*` | DESIGN-core (9a + 9b) | one combined task |
| `src/screens/settings/categories.screen.tsx` | DESIGN-core (10 + 11) | one combined task |
| every `<Button>` call site app-wide | DESIGN-audit (13) | wave 2, off final main |

**Intra-track shared files (one owner, sequence the tasks):**

- DOMAIN: `holding-detail.screen.tsx` — item 4 (Task D1) adds a rates query +
  the converted value line in the value-header block (lines ~132–154 and
  238–261); item 2 (Task D2) adds an account query + the footer add-block
  (lines ~132–137 and 218–235). Do D1 then D2 in the one worktree, so the two
  edits to the shared import/hook region layer cleanly.
- FORMS: `account-form.screen.tsx` — item 3 (Task F1) adds `required` markers;
  item 5 (Task F2) adds the credential fields. Do F1 then F2.
- DESIGN-core: `categories.screen.tsx` — items 10 and 11 are one task (Task
  G2).

---

# BUGFIX track (items 1, 8, 12, 14)

Owner: developer. Files are exclusive to this track. Integrate with
`npm run check:all` when approved.

## Task B1 — item 1 (P0): entity icons render blank at default size

**Root cause (debugger-confirmed):** `SymbolIcon` sets the native view frame
from the RAW `size` prop, not the resolved size. Commit `eaf91dd` added
`const resolvedSize = size ?? theme.iconSizes.body` (line 24) and passed it to
`SFSymbolView`'s `size` (line 29) but left the style frame on line 42 reading
the original `size`. A `SFSymbolView` has no intrinsic size under Fabric, so a
call site that omits `size` lays out `{ width: undefined, height: undefined }`
= 0×0 and the glyph never paints (holding-card:95, icon-picker-modal:257,
every ledger-row category icon). A site passing an explicit `size` still works.

**Files:**
- Modify: `src/design-system/components/symbol/symbol.component.tsx:42`
- Test: `src/design-system/components/symbol/symbol.component.test.tsx`

**Approach:** Change the style frame on line 42 to use `resolvedSize`:
`style={{ width: resolvedSize, height: resolvedSize }}`.

- [ ] **Step 1: Write the failing test.** In the symbol test, render
  `<SymbolIcon name="star" />` with NO `size` prop, using the existing
  `react-native-nitro-sfsymbols` test double / RNTL. Assert the rendered
  `SFSymbolView` receives a numeric, non-zero `style.width` and `style.height`
  equal to the theme `iconSizes.body` value. (Read the existing tests in that
  file to reuse their render + theme-access helpers.)

- [ ] **Step 2: Run the test, confirm it FAILS** with `width`/`height` being
  `undefined` (0×0). Run: `npx jest src/design-system/components/symbol`.

- [ ] **Step 3: Apply the fix.** Edit line 42 to
  `style={{ width: resolvedSize, height: resolvedSize }}`.

- [ ] **Step 4: Run the test, confirm it PASSES**, and confirm the pre-existing
  explicit-`size` test still passes. Run: `npx jest src/design-system/components/symbol`.

- [ ] **Step 5: Commit.**

```bash
git add src/design-system/components/symbol/symbol.component.tsx src/design-system/components/symbol/symbol.component.test.tsx
git commit -m "fix(design): SymbolIcon frame uses resolvedSize so default-size glyphs paint"
```

## Task B2 — item 8: net-worth line dips on an asset-neutral card→bond move

**Root cause (debugger-confirmed):** The net-worth line never consults
`transfer-exclusion.ts` — it sums the full ledger through `buildNetWorthSeries`
(`net-worth-series.ts:88-96`) → `holdingValueAt`. A card→bond move is
asset-neutral, so the correct fix is NOT to exclude it, but to make the bond
asset credit on the SAME day the card debits. The card debit subtracts at
`holding-value-at.ts:36-40`; the bond credits only once its
`meta.purchaseDate <= t` (`holding-value.ts:114`, `bondBreakdown` returns zero
while `purchaseDate > now`). If the bond's `purchaseDate` is later than the
card debit's day, there is a window where the card already dropped but the bond
contributes nothing → the dip.

**PRODUCT DECISION (record in the plan, confirm with the user):** A card→bond
move is recorded as TWO facts, and they must be co-dated:
1. the card DEBIT (the "Купівля облігацій" row — a synced Monobank statement
   item, or a manual expense), on day D;
2. a BOND holding created through the holding form with `purchaseDate` = day D.

The net-worth line stays flat across D only when the bond's `purchaseDate` day
equals the debit's day. The recommended, principled fix has two parts:

- **(8a) Day-granular bond-start boundary.** `bondBreakdown`'s guard
  `meta.purchaseDate > now` (holding-value.ts:114) compares exact
  milliseconds. The debit `time` is an exact timestamp (e.g. 14:00) while the
  user-picked `purchaseDate` is local midnight of day D, and each net-worth
  bucket `t` is a UTC-day key. Comparing raw ms makes the bond flip to its
  nominal on a different instant than the debit lands, so a same-day move still
  shows a one-bucket dip or spike. Compare by DAY, not by instant: the bond
  carries value for a bucket whose day is at or after the `purchaseDate`'s day.
- **(8b) Recording convention** (no code, documented here): when the user buys
  a bond funded from a card, they set the bond `purchaseDate` to the debit's
  day. The form default (`purchaseDate ?? Date.now()`, holding-form.screen.tsx:374)
  already lands "today", which matches a same-day purchase.

**Files:**
- Modify: `src/holdings/holding-value.ts` (the `bondBreakdown` purchaseDate
  guard, ~line 114; and the maturity guard at ~line 119 for symmetry).
- Read/verify: `src/statistics/holding-value-at.ts` (bonds route through
  `holdingValueBreakdown(holding, t)`, so the boundary fix flows into the
  series with no change here — confirm, do not edit unless a test forces it).
- Test: `src/statistics/net-worth-series.test.ts` (add the regression) and
  `src/holdings/holding-value.test.ts` (the boundary unit).

**Approach:** Introduce one shared local-day comparison. Reuse the existing
day helpers (`src/dates/local-day.ts` — `startOfLocalDay`) so the bond value
turns on for any `t` whose local day is ≥ the `purchaseDate`'s local day (and
turns off for any `t` whose local day is ≥ the `maturityDate`'s local day),
rather than on the exact millisecond. Keep the arithmetic in `Money` minor
units.

- [ ] **Step 1: Write the failing regression test** in
  `net-worth-series.test.ts`. Build a card holding with a single debit of
  −X on day D (a timestamp mid-day D) and a bond holding whose nominal value is
  +X with `purchaseDate` at local midnight of day D and a later `maturityDate`.
  Feed both through `buildNetWorthSeries` over a range spanning D−1 … D+1 with a
  minimal `historyRows`/rate table (copy an existing test's fixture). Assert the
  net-worth `amount` on day D equals the amount on day D−1 (flat — no dip).

- [ ] **Step 2: Run the test, confirm it FAILS** (day D dips by X, because the
  bond turns on at a different instant than the debit lands). Run:
  `npx jest src/statistics/net-worth-series`.

- [ ] **Step 3: Write a focused unit test** in `holding-value.test.ts`: a bond
  with `purchaseDate` at local midnight of day D reports its nominal `net` when
  valued at any instant on day D (including 00:00 and 23:59 local), and reports
  zero for any instant on day D−1. Run it and confirm the D-00:00 case fails
  under the current raw-ms guard.

- [ ] **Step 4: Apply the day-granular boundary** in `bondBreakdown`
  (holding-value.ts): value the bond when the valuation day is at or after the
  `purchaseDate`'s local day, and stop valuing it when the valuation day is at
  or after the `maturityDate`'s local day. Use the `src/dates/local-day.ts`
  helper; add no new date helper (kiko-domain "Dates": local-day is the unit).

- [ ] **Step 5: Run both tests, confirm they PASS**, then run the whole holding
  + statistics suites so no existing bond/deposit valuation test regressed. Run:
  `npx jest src/holdings src/statistics`.

- [ ] **Step 6: Commit.**

```bash
git add src/holdings/holding-value.ts src/holdings/holding-value.test.ts src/statistics/net-worth-series.test.ts
git commit -m "fix(holdings): value a bond by local day so a same-day card->bond move is net-worth-neutral"
```

## Task B3 — item 12: category-suggestion modal missing for a crypto row

**Root cause (debugger-confirmed):** The "Apply category to all" sheet is gated
on a NON-BLANK normalized description, not on the screen
(`transaction-form.screen.tsx:216-225`, `resolveCategoryOverrideRequest`
returns `null` when `normalizeTransactionName(name) === ''`). Binance rows
import with `description: ''` (`binance.transactions.ts:177,209`), so the sheet
is skipped and the category is written single-row. A Monobank row carries a
merchant description, so the sheet appears there.

**FIX (chosen):** Give crypto rows a stable, matchable description at import so
the name rule can group them. Keep `transaction-form.screen.tsx` UNTOUCHED
(that file is the FORMS track's, item 3) — the change is entirely at the import
boundary.

**Files:**
- Modify: `src/crypto-sync/binance/binance.transactions.ts` (the two `null`
  description literals at line 177 `depositRow` and line 209 `withdrawalRow`).
- Test: `src/crypto-sync/binance/binance.transactions.test.ts`.

**Approach:** Set `description` to the stable asset ticker `BINANCE_ASSET`
(`'BTC'`) on both mapped rows — a non-localized, non-empty, stable string, so
`normalizeTransactionName('BTC') !== ''` and the modal appears. The signed
amount (green +/red −) still distinguishes a deposit from a withdrawal in the
ledger. **Confirm two things during implementation:**
1. **Display:** `row-description.ts` returns a stored description verbatim
   (`if (description) return description`), so the ledger row will read "BTC"
   instead of the income/expense default. This is the accepted tradeoff the
   item names ("e.g. the asset ticker"). Confirm with the user that "BTC" is
   the desired row label; if a friendlier stable string is wanted, use a
   non-localized constant, never a `t(...)` call (a localized description would
   change under a language switch and break name matching).
2. **Existing rows:** whether `addManyDedup`
   (`src/repositories/transactions.repo.ts`) refreshes `description` on
   re-sync. If `description` is in its `onConflictDoUpdate` refreshable set,
   already-imported rows gain the ticker on the next sync; if not, only newly
   imported rows get it. State which in the commit message; do NOT widen the
   refreshable set as part of this item (that would also overwrite a
   user-typed description — out of scope).

- [ ] **Step 1: Write the failing test.** In `binance.transactions.test.ts`,
  assert that a mapped deposit row and a mapped withdrawal row each carry
  `description: 'BTC'` (not `''`). Reuse the file's existing deposit/withdrawal
  fixtures.

- [ ] **Step 2: Run the test, confirm it FAILS** (`description` is `''`). Run:
  `npx jest src/crypto-sync/binance/binance.transactions`.

- [ ] **Step 3: Apply the fix** — set `description: BINANCE_ASSET` on both the
  `depositRow` return (line 177) and the `withdrawalRow` return (line 209).

- [ ] **Step 4: Run the test, confirm it PASSES**, and run the whole binance
  suite. Run: `npx jest src/crypto-sync/binance`.

- [ ] **Step 5: Commit.**

```bash
git add src/crypto-sync/binance/binance.transactions.ts src/crypto-sync/binance/binance.transactions.test.ts
git commit -m "fix(crypto): stamp binance rows with the asset ticker so the category-apply sheet appears"
```

## Task B4 — item 14: guarded stale-holding cleanup in Monobank sync

**Root cause (debugger):** `upsertAllHoldings` (`src/monobank/sync.ts:319-372`)
only UPSERTS the holdings present in the current client-info snapshot. A holding
Monobank stops returning (a closed card, a deleted jar) keeps `closedAt = null`
and its last-synced balance, so it lingers in the net-worth total until some
later event removes it — the likely cause of the transient over-count that was
old item 7. FIX: on a FULL, SUCCESSFUL sync, CLOSE (set `closedAt`) every
holding under the Monobank account that is absent from the snapshot.

**GUARD (load-bearing — the whole point of the item):** a partial, failed, or
empty API response must NEVER close a live holding. Reconcile only against a
snapshot known to be complete. Close absent holdings ONLY when ALL hold:
1. `isFullFetch` is true (the periodic complete reconciliation path);
2. `failures.length === 0` (no per-card statement failure this run);
3. the snapshot is non-empty — at least one account or jar came back
   (`accounts.length + (jars?.length ?? 0) > 0`).

`fetchClientInfo` throwing already aborts the run before this code
(`runSyncInner` line 873), so a network failure can never reach the close
step; the non-empty guard defends against a successful-but-empty body.

**Files:**
- Modify: `src/monobank/sync.ts` — add a `closeHoldings` seam to `SyncDeps`
  (wired in `defaultDeps` to a `holdingsRepo` close write), and call it near
  the end of `runSyncInner` on the guarded full-clean path (after the per-card
  loop, alongside the `setLastSyncAt`/`setLastFullSyncAt` sequence, but only
  when the guard holds).
- Modify (verify/extend): `src/repositories/holdings.repo.ts` — a
  `close`/`closeMany` write that sets `closedAt` inside ONE `db.transaction()`
  for the whole stale set (kiko-architecture: one transaction for a bulk write,
  never one per row). Reuse an existing close write if present.
- Test: `src/monobank/sync.test.ts`.

**Approach:** Build the present-id set from the RAW snapshot — every
`account.id` and `jar.id` returned by client-info, INCLUDING
unrepresentable-currency ones (those are skipped from upsert but are still
present, so they must not be closed). Read the account's current holdings
(`deps.listHoldingsByAccount(accountId)`, already available) and select the
ones whose `metadata.monobankId` is set, not in the present-id set, and
`closedAt == null`. Close them in one transaction via the new seam. A holding
with no `monobankId` is never closed. Do the close inside the `if` that already
checks the guard conditions; register it as a seam so a test can assert the
exact ids passed (or that it was NOT called).

```ts
// after the per-card loop, on the full-clean path only:
if (isFullFetch && failures.length === 0 && accounts.length + (jars?.length ?? 0) > 0) {
  const present = new Set<string>([
    ...accounts.map((account) => account.id),
    ...(jars ?? []).map((jar) => jar.id),
  ]);
  const current = await deps.listHoldingsByAccount(accountId);
  const staleIds = current
    .filter((holding) => {
      const id = monobankIdOf(holding.metadata);
      return id !== undefined && !present.has(id) && holding.closedAt == null;
    })
    .map((holding) => holding.id);

  if (staleIds.length > 0) {
    await deps.closeHoldings(staleIds);
  }
}
```

Place this so it does NOT run on the partial-failure `throw` path (guard 2
already excludes it). Do not close on an incremental (non-full) run even though
client-info is complete there too — the item scopes the reconciliation to the
full-fetch path, the most conservative choice.

- [ ] **Step 1: Write the failing tests** in `sync.test.ts`, using the injected
  `SyncDeps` fakes the file already uses. (a) A FULL sync whose client-info
  returns a complete snapshot MISSING a previously-synced card closes that
  holding: assert `closeHoldings` is called with that holding's id, and (if the
  fake DB supports it) the closed holding drops out of the net-worth total.
  (b) A sync where client-info returns an EMPTY snapshot (guard 3 fails), and a
  PARTIAL-failure full sync (guard 2 fails), each leave the holding OPEN: assert
  `closeHoldings` is NOT called. Add (c): an incremental (non-full) run does NOT
  close (guard 1). Add (d): an unrepresentable-currency card still in the
  snapshot is NOT closed (it is present, just not upserted).

- [ ] **Step 2: Run the tests, confirm (a) FAILS** (nothing closes today). Run:
  `npx jest src/monobank/sync`.

- [ ] **Step 3: Implement** the `closeHoldings` seam (`SyncDeps` +
  `defaultDeps` wiring), the `holdingsRepo` bulk-close write (one
  `db.transaction()`), and the guarded reconciliation block.

- [ ] **Step 4: Run the tests, confirm all PASS**, then run the whole monobank
  suite so no existing sync test regressed. Run: `npx jest src/monobank`.

- [ ] **Step 5: Commit.**

```bash
git add src/monobank/sync.ts src/monobank/sync.test.ts src/repositories/holdings.repo.ts
git commit -m "fix(monobank): close stale holdings absent from a complete full-sync snapshot (guarded)"
```

---

# DOMAIN track (items 2, 4)

Owner: developer. Both items edit only `holding-detail.screen.tsx` (+ its
test). Do Task D1 (item 4) FIRST, then Task D2 (item 2), in one worktree.

## Task D1 — item 4: main-currency secondary value on the holding DETAIL screen

**Goal:** Phase B added a converted base-currency caption to holding CARDS
(`holding-card.component.tsx:49-52,106-112`) but not to the holding DETAIL
screen. Show the same converted line under the detail screen's Value amount.

**Files:**
- Modify: `src/screens/holding-detail/holding-detail.screen.tsx`
  - Imports region (top of file): add `ratesRepo`, `buildRateTable`, `convert`,
    `canConvert`, `formatMoney`, `activeLocale` (mirror the imports
    `holding-card.component.tsx` already uses).
  - Hooks region (~lines 132–154): add
    `const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);`
    and derive `baseCurrency` from the settings row already loaded
    (`settingsRows.at(0)?.baseCurrency ?? 'UAH'`) and `rateTable = buildRateTable(rates)`.
  - Value-header block (lines 238–261): render a converted caption beneath the
    `EntityAmountHeader`, guarded exactly as the card does.
- Test: `src/screens/holding-detail/holding-detail.screen.test.tsx`.

**Approach:** Compute the converted value the same way the card does:

```ts
const convertedToBase =
  holding !== undefined &&
  breakdown !== null &&
  holding.currency !== baseCurrency &&
  canConvert(holding.currency, baseCurrency, rateTable)
    ? convert(breakdown.net, baseCurrency, rateTable)
    : null;
```

Render it under the `EntityAmountHeader` (inside the same `Box gap={1}` at
lines 239–260, after the breakdown block) as a muted caption:

```tsx
{convertedToBase && (
  <Text variant="caption" tone="textSecondary" testID="holding-detail-converted">
    {formatMoney(convertedToBase, activeLocale())}
  </Text>
)}
```

Reuse `MoneyText`/`formatMoney` per kiko-design-system; do not hand-format.
`convert` throws on a missing rate pair, so the `canConvert` guard is
load-bearing (a BTC holding before the first rate sync shows no second line).

- [ ] **Step 1: Write the failing test.** Render `HoldingDetailScreen` for a
  holding in a non-base currency (e.g. a USD holding with base UAH) with a rate
  present in the mocked `rates` live query. Assert a node with testID
  `holding-detail-converted` renders the converted base-currency amount.
  Add a second case: a holding already in the base currency renders NO such
  node. (Reuse the file's existing live-query mocking harness.)

- [ ] **Step 2: Run the test, confirm it FAILS** (no converted node). Run:
  `npx jest src/screens/holding-detail`.

- [ ] **Step 3: Implement** the rates query, the `convertedToBase` derivation,
  and the caption node per the approach above.

- [ ] **Step 4: Run the test, confirm it PASSES**, and run the whole
  holding-detail suite. Run: `npx jest src/screens/holding-detail`.

- [ ] **Step 5: Commit.**

```bash
git add src/screens/holding-detail/holding-detail.screen.tsx src/screens/holding-detail/holding-detail.screen.test.tsx
git commit -m "feat(holding-detail): show the main-currency converted value under the amount"
```

## Task D2 — item 2: block adding manual transactions into synced holdings and bonds

**Goal:** A synced (Monobank) holding's ledger is owned by the sync, and a bond
carries no manual ledger (its value derives from metadata — kiko-domain), so
neither should offer an "Add transaction" action. Block the ONE entry point:
the holding-detail footer (`holding-detail.screen.tsx:226-234`). Home's
`TransactionForm` navigation is edit-only (`transactionId`), so there is no
other add entry point to guard.

**Files:**
- Modify: `src/screens/holding-detail/holding-detail.screen.tsx`
  - Imports: add `isSyncedHolding` from `../../holdings/deletable`, and
    `accountsRepo`.
  - Hooks region (~lines 132–137): load the owning account so the sync gate can
    read `institution`. The screen already has `holding?.accountId`; add
    `const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(holding?.accountId ?? ''), ['accounts']);`
    (mirror `account-detail.screen.tsx`'s `byIdQuery` usage) and
    `const account = accounts.at(0);`.
  - Footer block (lines 218–235): compute the gate and hide the add action.
- Test: `src/screens/holding-detail/holding-detail.screen.test.tsx`.

**Approach:** Compute one predicate:

```ts
const isBond = holding?.type === 'bond';
const isSynced = isSyncedHolding(holding ?? { metadata: null }, account);
// A term_deposit still takes contributions (the deposit lifecycle), so it is
// NOT blocked here — only a bond and a synced holding are.
const canAddManualTransaction = holding !== undefined && !isBond && !isSynced;
```

`isSyncedHolding` (deletable.ts) already requires BOTH a connected account
institution AND a sync key in metadata, so a DISCONNECTED former-Monobank
holding correctly counts as manual again and keeps its add action. In the
footer, render the `Button` only when the action is allowed — for a
`term_deposit` keep the existing "Add contribution" path; for a plain holding
keep "Add transaction"; for a bond or a synced holding render no footer button.

```tsx
footer={
  isDeposit ? (
    <Button onPress={() => navigation.navigate('ContributionForm', { holdingId })}>
      {t('forms.holding.addContribution')}
    </Button>
  ) : canAddManualTransaction ? (
    <Button onPress={() => navigation.navigate('TransactionForm', { holdingId })}>
      {t('holdingDetail.addTransaction')}
    </Button>
  ) : undefined
}
```

(`Screen`'s `footer` accepts an absent node — verify against
`screen.props`; if it requires a node, pass `null`.) Keep the "Add
transaction" footer Button at its current full-width `regular` size — it is a
primary CTA, so item 13 (wave 2) will leave it unchanged.

- [ ] **Step 1: Write the failing tests.** (a) A bond holding renders NO
  "Add transaction" footer button. (b) A synced card holding under a
  `monobank` account renders NO footer button. (c) A plain manual card holding
  still renders the "Add transaction" button. (d) A `term_deposit` still
  renders "Add contribution". Reuse the file's render harness; mock the
  `accounts` live query to return the owning account with the right
  `institution`.

- [ ] **Step 2: Run the tests, confirm (a) and (b) FAIL** (the button still
  renders today). Run: `npx jest src/screens/holding-detail`.

- [ ] **Step 3: Implement** the account query, the `canAddManualTransaction`
  gate, and the footer branching.

- [ ] **Step 4: Run the tests, confirm all PASS.** Run:
  `npx jest src/screens/holding-detail`.

- [ ] **Step 5: Commit.**

```bash
git add src/screens/holding-detail/holding-detail.screen.tsx src/screens/holding-detail/holding-detail.screen.test.tsx
git commit -m "feat(holding-detail): hide the add-transaction action for synced holdings and bonds"
```

---

# FORMS track (items 3, 5, 6)

Owner: developer. Do Task F1 (item 3) FIRST — it adds the shared `required`
mechanism and touches the form screens — then Task F2 (item 5), which adds
fields to `account-form.screen.tsx` that F1 already established the pattern for.
Task F3 (item 6) is independent.

## Task F1 — item 3: mark required form fields with a red asterisk

**Goal:** Every field a form's validity gate requires must show a red asterisk
after its label. Add the marker once, in a shared label component, and thread a
`required` flag through the field primitives so no screen hand-rolls a label.

**Files:**
- Create: `src/design-system/components/field-label/field-label.component.tsx`,
  `.props.d.ts`, `index.ts`, `.component.test.tsx` (one component per folder —
  kiko-code-style).
- Modify (add an optional `required?: boolean` prop that renders the marker via
  `FieldLabel`):
  - `src/design-system/components/text-field/text-field.component.tsx` +
    `.props.d.ts` (the caption at lines 57–59).
  - `src/screens/forms/chip-row/chip-row.component.tsx` + `.props.d.ts` (the
    caption at lines 33–37).
  - `src/screens/forms/date-field/date-field.component.tsx` + `.props.d.ts`
    (the caption at lines 82–84).
  - `src/screens/forms/field-trigger/field-trigger.component.tsx` +
    `.props.d.ts` (the caption at lines 25–27) — used by CategoryField and
    HoldingSelectField.
  - `src/screens/forms/holding-identity-field/holding-identity-field.component.tsx`
    + `.props.d.ts` (the name caption at lines 57–60) — the name field.
- Apply `required` at the call sites in:
  - `account-form.screen.tsx` (name via `HoldingIdentityField`).
  - `holding-form.screen.tsx` (name; and the type-specific required fields per
    `isTermDepositValid`/`isBondValid`).
  - `transaction-form.screen.tsx` (amount; and category on create per
    `isSaveDisabled`).
  - `contribution-form.screen.tsx` (amount, date per its `canSave`).
- Test: the new `field-label.component.test.tsx`; plus one assertion per
  touched primitive test that `required` renders the asterisk.

**Approach:**

`FieldLabel` renders the label text plus, when `required`, a red asterisk in
`theme.colors.negative`:

```tsx
const FieldLabel: FC<{ label: string; required?: boolean }> = ({ label, required = false }) => (
  <Box direction="row" gap={1}>
    <Text variant="caption" tone="textSecondary">
      {label}
    </Text>

    {required && (
      <Text variant="caption" tone="negative" accessibilityElementsHidden>
        *
      </Text>
    )}
  </Box>
);
```

Confirm `Text` exposes a `negative` tone; if it does not, add it to the Text
tone set (kiko-design-system, Text tones) rather than passing an inline color
(`Text` excludes `color` by design). Each field primitive replaces its inline
`<Text variant="caption" tone="textSecondary">{label}</Text>` caption with
`<FieldLabel label={label} required={required} />`. The asterisk is decorative;
keep it out of the accessible name (the field already labels itself), and
instead reflect required-ness through the primitive's existing
`accessibilityLabel`/state if the field already sets one — do not regress
VoiceOver.

**Which fields are required (source of truth = each form's validity gate):**

- account-form: `name` (canSave = `trimmedName !== ''`, line 109). Currency and
  initial value are NOT required.
- holding-form: `name` (isValid, line 421); term_deposit → contribution amount +
  date, `annualRatePct`, `termMonths` (isTermDepositValid, lines 395–406); bond
  → `quantity`, `faceValue`, `couponPct`, `purchaseDate`, `maturityDate`
  (isBondValid, lines 411–418). Balance, compounding, bond kind, coupon
  frequency carry defaults → NOT required.
- transaction-form: `amount` always; `category` on create (isSaveDisabled line
  205); exchange/convert → destination + the amount fields (lines 186–195).
  Mark exactly the fields that gate save in the CURRENT mode.
- contribution-form: `amount` + `date` per its `canSave` (read the file to
  confirm the exact gate).

Mark a field `required` iff its emptiness blocks save in the active mode. Do
not mark a field the gate does not require.

- [ ] **Step 1: Write the failing `FieldLabel` test** — renders the label; with
  `required` renders a `*` node; without `required` renders no `*`.

- [ ] **Step 2: Run it, confirm it FAILS** (component does not exist). Run:
  `npx jest src/design-system/components/field-label`.

- [ ] **Step 3: Implement `FieldLabel`** (folder + barrel + props). Run the
  test, confirm it PASSES.

- [ ] **Step 4: Thread `required` through each primitive.** For each of
  TextField, ChipRow, DateField, FieldTrigger, HoldingIdentityField: add the
  optional prop and swap the caption for `FieldLabel`. Add one test per
  primitive: `required` renders the asterisk. Run each and confirm PASS.

- [ ] **Step 5: Apply `required` at the form call sites** per the required-field
  list above. Add a test in each affected screen test asserting a known-required
  field shows the marker and a known-optional field does not (at least one form
  is enough for the screen-level assertion; the primitive tests cover the rest).

- [ ] **Step 6: Run the full forms + design-system suites**, confirm PASS. Run:
  `npx jest src/screens/forms src/design-system/components`.

- [ ] **Step 7: Commit.**

```bash
git add src/design-system/components/field-label src/design-system/components/text-field src/screens/forms
git commit -m "feat(forms): mark required fields with a red asterisk via a shared FieldLabel"
```

## Task F2 — item 5: optional sync credential fields on the account CREATION form

**Goal:** Let the user optionally enter sync credentials at account creation —
a Monobank token for a `bank` account, a Binance API key + secret for a
`crypto` account. Sync setup is OPTIONAL: an account still creates with no
credentials. Secrets go to the Keychain, never `.env`/DB/logs.

**Files:**
- Modify: `src/screens/forms/account-form.screen.tsx`
  - Imports: `saveToken` (`../../monobank/token`), `saveCredentials`
    (`../../crypto-sync/binance/binance.credentials`), `TextField`.
  - State: `monobankToken` (bank), `binanceApiKey` + `binanceSecret` (crypto),
    all secure, all optional.
  - Render: a create-mode-only optional credential block per kind — a masked
    `TextField` for the bank token; two masked `TextField`s for the crypto
    key/secret. Reuse the existing `secureTextEntry`, `autoCapitalize="none"`,
    `autoCorrect={false}` treatment from `monobank-token-field` /
    `binance-credentials-field`. Mark these fields NOT required (item 3 leaves
    them un-asterisked).
  - Save wiring: after the account row is created (the existing `create` /
    `createCashAccount` paths, lines 131–157), if a credential was entered,
    persist it to the Keychain and mark/connect the account.
- Test: `src/screens/forms/account-form.screen.test.tsx`.

**Approach & product notes (confirm with the user):**

- **Bank (Monobank):** on save, if `monobankToken.trim() !== ''`, call
  `saveToken(token)` (Keychain), then trigger the same Connect action the
  detail screen uses (`useSync().sync(accountId)` marks `institution:
  'monobank'` and runs the first import — see
  `account-detail.screen.tsx:155-170`, `monobank/sync.ts` `runSync` with
  `targetAccountId`). Keep it optional: no token → plain account create,
  unchanged.
- **Crypto (Binance):** on save, if both key and secret are non-empty, call
  `saveCredentials({ apiKey, secret })` (Keychain), then run the crypto Connect
  (`useCryptoSync().sync({ providerId: 'binance', targetAccountId })` — see
  `crypto-sync-section.component.tsx:74-75`).
- **DECISION — verify vs. save-then-connect:** the detail-screen fields VERIFY
  the credential (`fetchClientInfo` / `fetchAccount`) BEFORE saving, and surface
  an invalid-token status. At creation the account does not yet exist, so
  decide: (Option A, recommended) create the account first, then save +
  connect, and surface any sync failure the same way the detail screen does
  (`useSync().error`); a bad token leaves a created-but-unconnected account the
  user can fix from the detail screen. (Option B) verify the credential BEFORE
  creating the account and block creation on an invalid one. Recommend Option A
  (an account is still useful without sync; the detail screen already owns the
  connect/repair flow). Confirm with the user.
- **Single-connection invariant:** `resolveMonobankAccountId` /
  `runBalanceSync` already reject a second connection per institution, so a
  connect at creation is safe; surface the thrown localized message the same
  way the detail screen does.
- Do NOT read a stored secret back into state; write-only, matching
  `monobank-token-field`'s security comment (lines 40–41).

- [ ] **Step 1: Write the failing tests.** (a) A `bank` create with a token
  entered calls `saveToken` with that token and triggers the connect. (b) A
  `bank` create with an empty token creates the account and calls neither. (c)
  A `crypto` create with key+secret calls `saveCredentials` and the crypto
  connect. (d) A `crypto` create with a missing secret does neither. Mock
  `saveToken`, `saveCredentials`, and the sync hooks; reuse the file's harness.

- [ ] **Step 2: Run the tests, confirm the credential paths FAIL** (no fields
  yet). Run: `npx jest src/screens/forms/account-form`.

- [ ] **Step 3: Implement** the credential fields (create-mode + kind-gated),
  the state, and the save-then-connect wiring per the approach.

- [ ] **Step 4: Run the tests, confirm PASS**, and run the full forms suite.
  Run: `npx jest src/screens/forms`.

- [ ] **Step 5: Commit.**

```bash
git add src/screens/forms/account-form.screen.tsx src/screens/forms/account-form.screen.test.tsx
git commit -m "feat(forms): optional Monobank/Binance credentials on account creation"
```

## Task F3 — item 6: open the date-range calendar at the END date

**Goal:** The range calendar opens on the START bound today
(`date-range-field.component.tsx:244`, `initialDate={toCalendarKey(draftFrom ?? selectableFloor)}`).
Open it on the END bound instead, so the most recent month shows first.

**Files:**
- Modify: `src/screens/home/date-range-field/date-range-field.component.tsx:244`.
- Test: `src/screens/home/date-range-field/date-range-field.component.test.tsx`.

**Approach:** Anchor on the end (draft) bound, falling back to the start, then
the selectable ceiling:
`initialDate={toCalendarKey(draftTo ?? draftFrom ?? selectableCeiling)}`.

- [ ] **Step 1: Write the failing test.** Open the sheet with a draft range
  whose `to` is a later month than `from`; assert the `KikoCalendar` receives an
  `initialDate` equal to the end bound's calendar key (not the start's). Reuse
  the file's existing calendar-prop assertions.

- [ ] **Step 2: Run it, confirm it FAILS** (initialDate is the start). Run:
  `npx jest src/screens/home/date-range-field`.

- [ ] **Step 3: Apply the one-line change** at line 244.

- [ ] **Step 4: Run it, confirm it PASSES.** Run:
  `npx jest src/screens/home/date-range-field`.

- [ ] **Step 5: Commit.**

```bash
git add src/screens/home/date-range-field/date-range-field.component.tsx src/screens/home/date-range-field/date-range-field.component.test.tsx
git commit -m "fix(forms): open the date-range calendar at the end date"
```

---

# DESIGN-core track (items 9, 10, 11)

Owner: designer. Files are exclusive to this track in wave 1. Item 9 keeps
BOTH halves (9a design + 9b logic) in one task so `trend-filter-field.*` has one
owner.

## Task G1 — item 9 (9a + 9b): trend-chart filter hierarchy and Save disabling

**Goal:**
- **9a (design):** the selected filter rows look almost identical to unselected
  rows AND to the big bottom "Save" button. Differentiate the selected state and
  make the Save action visually distinct from the filter rows.
- **9b (logic):** the "Save" button is not disabled when nothing new is
  selected. Disable it until the draft differs from the applied filter.

**Files:**
- Modify: `src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx`.
- Modify: `src/screens/statistics/trend-filter-field/trend-filter-field.styles.ts`.
- Test: `src/screens/statistics/trend-filter-field/trend-filter-field.component.test.tsx`.

**Approach — 9b (logic):** Compute whether the draft differs from the applied
`filter`, and disable Save when it does not:

```ts
const isDirty = ((): boolean => {
  const applied = seedDraft(filter);
  if (draft.mode !== applied.mode) {
    return true;
  }
  if (draft.mode === 'manual') {
    return draft.manualKeys.size !== applied.manualKeys.size ||
      [...draft.manualKeys].some((key) => !applied.manualKeys.has(key));
  }
  return draft.amount !== applied.amount || draft.by !== applied.by;
})();
```

Set `disabled={!isDirty}` on the Save `Button` (line 251). Keep the block-body
arrow form for a genuinely-hard-to-scan expression (kiko-code-style). This is a
pure comparison; unit-test it directly.

**Approach — 9a (design):** Raise the visual hierarchy so three things read as
three distinct levels:
1. **Selected filter row** — the checkbox rows (lines 200–238) rely only on a
   small checkmark. Strengthen the selected row: a filled/tinted row background
   or a bolder label + the accent checkmark, so a selected category is
   obviously distinct from an unselected one at a glance. Prefer the same
   selected-state vocabulary the app already uses (the `OptionPills`/`ChipRow`
   selected treatment: `accent` fill + `onAccent` label — kiko-design-system),
   so this reads as one system, not a new pattern.
2. **Save button** — it currently reads like a selected control. Keep it as the
   primary action pill but ensure the filter rows no longer share its fill;
   with the selected-row treatment above using the pill vocabulary, give the
   action row clear separation (the existing `styles.actions` row) so the
   primary Save still reads as the single call-to-action.
3. Read `kiko-design-system` "OptionPills" and the `onAccent` rule before
   picking colors; use tokens only, no inline hex.

Keep every color/spacing from `theme`. Do not change the filter's behavior
(manual vs top, the applied-label logic) — only its selected-state appearance
and the Save disabling.

- [ ] **Step 1: Write the failing 9b test.** Open the sheet; with no change,
  assert the Save button (`${testID}-save`) is `disabled`. Toggle a manual
  category (or change the top amount), assert Save becomes enabled. Revert the
  toggle, assert Save is disabled again. Reuse the file's testIDs
  (`-option-<value>`, `-save`, `-clear`).

- [ ] **Step 2: Run it, confirm it FAILS** (Save is always enabled). Run:
  `npx jest src/screens/statistics/trend-filter-field`.

- [ ] **Step 3: Implement `isDirty` + `disabled={!isDirty}`.** Run the test,
  confirm it PASSES.

- [ ] **Step 4: Write a 9a assertion** for the selected-state distinction that
  is testable without a screenshot — for example, a selected manual row exposes
  `accessibilityState={{ checked: true }}` (already present) AND renders the
  strengthened selected styling node/testID you add; assert the selected row
  differs from an unselected one by that marker. (Design polish itself is
  verified on-device at the round's deploy — see kiko memory
  "no-screenshots-for-design-review".)

- [ ] **Step 5: Implement the 9a selected-row + action-row styling.** Run the
  suite, confirm PASS. Run: `npx jest src/screens/statistics/trend-filter-field`.

- [ ] **Step 6: Commit.**

```bash
git add src/screens/statistics/trend-filter-field
git commit -m "fix(statistics): differentiate trend-filter selected rows and disable Save until dirty"
```

## Task G2 — items 10 + 11: category card ghost delete, star padding, disabled default delete

**Goal:**
- **10:** the remove-category button must be a red ghost button, verified
  on-device.
- **11:** the default category's star has different padding than the
  set-default star; unify them. Also show a "Delete" button on the default
  category, but DISABLED, for layout consistency with other cards.

**Files:**
- Modify: `src/screens/settings/categories.screen.tsx`.
- Test: `src/screens/settings/categories.screen.test.tsx`.

**Finding on item 10 (verified in code):** the delete control at
`categories.screen.tsx:220-231` is ALREADY a red ghost button
(`variant="ghost"`, `icon="trash"`, `textColor={theme.colors.negative}`, label
"Delete"), and the `ghost` variant paints `backgroundColor: 'transparent'`
(`button.styles.ts:35`). So the CODE is already correct; the on-device "still
not a ghost button" is a STALE BUILD (Phase B item 2.3 landed in the repo but
not on the reviewed device). **Item 10 needs no code change** beyond item 11's
edits to the same button. The round's deploy is the on-device verification; if
after deploy it still reads non-ghost, escalate to a Button-variant
investigation rather than editing this call site.

**Approach — item 11:**
- **Star padding parity.** The default card's marker is a bare `SymbolIcon`
  (`star.fill`, lines 179–184) with no padding, while the set-default control is
  a compact ghost `Button` (`icon="star"`, lines 186–194) that owns its 44pt
  target and padding. Render the default marker as the SAME compact ghost
  `Button` shape (`variant="ghost"`, `size="compact"`, `fullWidth={false}`,
  `icon="star.fill"`, `textColor={theme.colors.textPrimary}`), made
  non-actionable — `disabled` (so it dims and is inert) OR a no-op `onPress`
  with the same padding. Use `disabled` so it reads as a static marker while
  keeping identical geometry. Keep its `accessibilityLabel`
  (`categories.isDefaultLabel`).
- **Disabled Delete on the default card.** Change the delete block (lines
  219–231) from `{!isDefault && (<Button.../>)}` to ALWAYS render the delete
  `Button`, passing `disabled={isDefault}`. The default category can never be
  deleted (its `onPress` is guarded; the disabled state makes that visible and
  keeps the bottom row's layout identical across all cards). Keep the red ghost
  treatment (item 10).

- [ ] **Step 1: Write the failing tests.** (a) The default category card
  renders a Delete button that is `disabled`. (b) The default marker star and
  the set-default star render with the same control shape (assert both are the
  compact ghost Button — e.g. by a shared testID or role/label you add), i.e.
  the default no longer renders a bare icon. (c) A non-default card's Delete is
  a red ghost, enabled (regression guard). Reuse the file's harness and the
  `categories.*Label` a11y labels.

- [ ] **Step 2: Run them, confirm (a) and (b) FAIL** (default renders no Delete
  and a bare star today). Run: `npx jest src/screens/settings/categories`.

- [ ] **Step 3: Implement** the default-star-as-compact-ghost-Button and the
  always-rendered `disabled={isDefault}` Delete.

- [ ] **Step 4: Run the suite, confirm PASS.** Run:
  `npx jest src/screens/settings/categories`.

- [ ] **Step 5: Commit.**

```bash
git add src/screens/settings/categories.screen.tsx src/screens/settings/categories.screen.test.tsx
git commit -m "fix(settings): unify category default-star padding and show a disabled Delete on the default"
```

---

# DESIGN-audit pass (item 13) — WAVE 2, sequenced last

Owner: designer. Runs in a FRESH worktree off the integrated main AFTER all
four wave-1 tracks land, so it audits the final Button call sites and never
races another track.

## Task A1 — item 13: app-wide compact-button audit

**Goal:** Many secondary/inline actions still use the tall `regular` Button
("Sync now" was one example). Audit EVERY `<Button>` call site and switch
lower-emphasis / inline / secondary actions to `size="compact"` (usually
`fullWidth={false}`, `variant` secondary or ghost), while keeping primary CTAs
and full-width form submits at `size="regular"`.

**The criterion (apply uniformly):**
- **Keep `regular` + `fullWidth`:** the single primary call-to-action of a
  screen or a bottom sheet — a footer/submit "Save"/"Add …" and the primary
  action in a two-button sheet action row.
- **Switch to `size="compact"` + `fullWidth={false}`:** an inline action beside
  text or status, a per-row add/remove control, a secondary action, a ghost
  header/nav-style action, and the non-primary button in a two-button row.
- Preserve each button's `variant`, `icon`, `textColor`, and
  `accessibilityLabel`. `compact` holds the 44pt floor (button.styles.ts), so
  no hit-padding is needed.

**Enumerated call sites (verified inventory at plan time — RE-GREP off the
integrated main before editing, since wave-1 tracks add/alter buttons):**

Already `compact` (leave as-is; regression baseline):
- `account-detail.screen.tsx:278` (Sync/Connect), `:294` (Disconnect).
- `crypto-sync-section.component.tsx:121` (Sync now), `:135` (Disconnect).
- `binance-credentials-field.component.tsx:140` (Connect).
- `monobank-token-field.component.tsx:155` (Save token).
- `wallet-address-field.component.tsx:90` (Connect).
- `icon-picker-modal.component.tsx:215` (Remove), `:220` (Cancel).
- `holding-form.screen.tsx:594` (Add contribution).
- `categories.screen.tsx` set-default/delete/reorder (compact ghost) and the
  new default-star/disabled-delete from Task G2.

Keep `regular` + full-width (primary CTA — do NOT change):
- `account-form.screen.tsx:166` (Save footer).
- `holding-form.screen.tsx:499` (Save footer).
- `contribution-form.screen.tsx:84` (Save footer).
- `transaction-form.screen.tsx:1113` (Save footer), `:1210` (primary Apply
  override in the confirm sheet).
- `holding-detail.screen.tsx:226` (Add transaction / Add contribution footer).
- `accounts.screen.tsx:70` (verify: if it is the primary add-account CTA, keep
  regular).
- `lock-gate.component.tsx:88` (Unlock — the single primary action).
- `add-category-row.component.tsx:153` (Save — primary of the inline form).
- The primary button of each sheet action row: `date-range-field:256` (Apply),
  `trend-filter-field:251` (Save — after Task G1).

Switch to `compact` + `fullWidth={false}` (secondary/inline — CHANGE):
- `holding-form.screen.tsx:579` (per-row Remove contribution) — already
  `destructiveTonal`, add `size="compact"` if not present (verify).
- `add-category-row.component.tsx:147` (Cancel — the secondary of the inline
  form).
- `date-range-field.component.tsx:252` (Clear — the secondary in the sheet
  action row).
- `trend-filter-field.component.tsx:242` (Clear — the secondary in the sheet
  action row).
- `transaction-form.screen.tsx:1215` (Apply-to-one — secondary in the confirm
  sheet), `:1220` (Cancel override — ghost, secondary).
- Any button the re-grep surfaces that matches the "secondary/inline" criterion.

**RESOLVE overlaps with wave-1 work:** several of these files were edited by
FORMS (item 3 asterisks; item 5 fields; item 6) and DESIGN-core (item 9 Save,
item 11 category buttons). Because item 13 runs AFTER those integrate, it edits
the FINAL version of each file. Re-grep and re-read each file before editing.
Do NOT reintroduce a `regular` size onto a control a wave-1 task already set.

**Files:** every file in the inventory above (re-grep to confirm). **Test:**
each touched screen/component test — add or update an assertion that the
audited button renders with `size="compact"` where changed and stays `regular`
where kept. Prefer asserting on a stable prop/testID over snapshotting.

- [ ] **Step 1: Re-grep the inventory** off the integrated main:
  `grep -rn "<Button" src --include="*.tsx" | grep -v "\.test\." | grep -v button.component`.
  Reconcile against the enumerated list; note any new call sites.

- [ ] **Step 2: Classify each call site** by the criterion above (primary CTA →
  keep regular; secondary/inline → compact). Write it down per site.

- [ ] **Step 3: For each site to CHANGE, write/adjust its test first** to expect
  `size="compact"` + `fullWidth={false}`, run it, confirm it FAILS.

- [ ] **Step 4: Apply the changes** site by site.

- [ ] **Step 5: Run the full suite**, confirm PASS. Run: `npx jest`.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "refactor(design): audit Button sizes — compact for secondary/inline, regular for primary CTAs"
```

---

# Integration model — ROLLING, one deep gate

Follow kiko memory `rolling-per-track-integration-one-deep-gate`,
`orca-worktree-base-local-main`, `cross-track-shared-file-line-partitioning`,
and `prune-worktrees-as-integrated`.

1. **Worktrees.** Create one Orca worktree per WAVE-1 track (BUGFIX, DOMAIN,
   FORMS, DESIGN-core), each `--base-branch main`, and verify each worktree's
   head equals local main `e33b181` before dispatching. There are NO cross-track
   shared files in wave 1, so no line-range partitioning is needed this round —
   the one file each track shares is shared only WITHIN that track (see the
   intra-track notes), where a single owner sequences the tasks.

2. **Wave 1 (parallel).** Run the four tracks concurrently. Each track:
   - implements its tasks in order (BUGFIX: B1→B2→B3→B4; DOMAIN: D1→D2; FORMS:
     F1→F2→F3; DESIGN-core: G1→G2);
   - runs its own `npx jest` on the touched suites green;
   - is reviewed (kiko:reviewer) and approved.

3. **Rolling integration per track.** As each wave-1 track is approved,
   integrate it to main with a fast `npm run check:all`, then PRUNE its worktree
   immediately (do not batch). Because the tracks touch disjoint files, the
   merges are conflict-free in any order.

4. **Wave 2 — item 13.** After ALL four wave-1 tracks have integrated to main,
   create a fresh worktree off the updated main and run Task A1 (the app-wide
   Button audit) against the final code. Review, `npm run check:all`, integrate,
   prune.

5. **One deep gate.** After item 13 lands, run ONE `npm run check:deep` on main
   with `KIKO_MUTATION_BASE=e33b181` (the pre-round main), so mutation testing
   covers every source file this round changed. Await its single return; never
   poll or tail it (kiko memory `check-deep-no-incremental-output`,
   `mutation-run-overload-guard`). Accept the documented tracked CVEs
   (`image-size`, `decode-uri-component`) — do not suppress them.

6. **Deploy.** After `check:deep` is green, deploy to the connected iPhone via
   the ops role (`npm run deploy:device`) — this is the on-device verification
   for items 6, 9, 10, 11, 13 (kiko memory `prefer-device-over-simulator`,
   `no-screenshots-for-design-review`, `deploy-without-asking`). Confirm on
   device: entity icons paint (item 1), the category delete reads as a red
   ghost (item 10), the default star padding matches and its Delete is disabled
   (item 11), the trend-filter hierarchy reads clearly (item 9a), the range
   calendar opens on the end month (item 6), and secondary buttons are compact
   (item 13).

## Open product decisions to confirm with the user

- **Item 8:** the card→bond recording convention (co-date the bond
  `purchaseDate` with the card debit's day). Confirm this is the intended model.
- **Item 12:** the crypto row description = the asset ticker "BTC" (changes the
  ledger row label from the income/expense default to "BTC"). Confirm the label
  is acceptable, and whether existing rows should gain it on re-sync.
- **Item 5:** verify-before-create (Option B) vs create-then-connect (Option A,
  recommended) for credentials entered at account creation.
