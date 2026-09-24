---
name: kiko-domain
description: Invoke whenever you touch the domain model — the Account/Holding/Transaction schema, the Money value object, currency codes, or net worth calculation. Read before writing a Drizzle table, a repository, a form, or any code that handles an amount.
---

# Kiko domain model

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Domain model" section). This skill summarizes the settled contract;
if the two ever disagree, the spec wins and this skill needs updating.

## The three levels

`Account -> Holding -> Transaction`, plus supporting tables. **The
enumerated `{ enum: [...] }` column values below (`kind`, `type`,
`currency`, `source`) drift — a kind gets added or removed in code
without this skill being updated in lockstep (this happened: `broker`
was once a valid `Account.kind` and was later dropped). Do not trust
an enum list copied into this prose as current. Read
`src/db/schema.ts` directly for the live `sqliteTable` column
definitions before relying on a specific member being present or
absent** — this skill states the shape and non-enum facts only:

- **Account** — a bank, cash stash, crypto wallet, standalone property
  holder, standalone precious-metals holder, or debt holder. `id`,
  `name`, `kind` (see `schema.ts`'s `accounts.kind` enum for the
  current member set — as of T26 this includes `property`, `metals`,
  and `debt` alongside `bank`/`cash`/`crypto`; all three of the
  non-`bank`/`cash`/`crypto` kinds are manually-created-only kinds
  with no sync concept), `institution` (nullable, e.g. `monobank` —
  marks a LIVE sync connection), `bankId` (nullable, migration
  `0033`; see below), `icon`, `color`, `sortOrder`, `archivedAt`
  (nullable), `createdAt`. `holdingTypesForAccountKind`
  (`src/holdings/holding-type/`) maps each account kind to its
  allowed `Holding.type` set — `property` maps to `property_item`,
  `metals` maps to `metal`, `debt` maps to `loan` — read that file
  rather than trusting a mapping copied here. `metal` is ALSO
  creatable under a `bank`-kind account, gated by that bank's own
  `sellsMetals` catalog flag (see `kiko-pricing`'s "Bank metal
  allow-list" section) — the only holding type creatable under two
  different account kinds by two different rules.

  **`bankId`** is the "which bank does this account represent" field
  set from the account-form's bank picker (`BankTypeField`,
  `src/screens/forms/bank-type-field/`), rendered in BOTH create and
  edit mode (423b6a6 — edit used to skip it entirely) with an explicit
  no-bank row (`onSelect(null)`, `accountForm.noBank` i18n key in
  `en.ts`/`uk.ts` — cite the key, not the rendered label, since it can
  drift) so a Bank account can be created or
  returned to on purpose with no bank identity at all — the intended
  target for the generic column-mapping import when no dedicated
  parser applies. The live-sync Connect field (Monobank) stays
  create-only; editing `bankId` on an already-connected account never
  writes `institution`, so its sync is untouched regardless of which
  identity is picked. Backed by the catalog at
  `src/bank-sync/bank-catalog/` — read that file for the current bank
  set (`BankId`/`bankCatalog`) rather than trusting a count or list
  copied here; it grows over time (P3 added PUMB, Oschadbank,
  Raiffeisen, and Ukrgasbank, each with no dedicated `statement-import`
  parser — `statementFormatId` is optional for exactly this reason). It
  is **identity-only, independent of `institution`**: only Monobank has
  a live API Connect today (`connectable: true` in the catalog), every
  other entry is import-only, scoping which `statement-import` parser
  applies when it has one. That parser is only ever a
  PREFERENCE, not a gate: "Import statement" is offered on every bank
  account regardless of `bankId`, and a file that doesn't match its
  dedicated format (or has none) falls through to the generic
  column-mapping import (`kiko-statement-import`'s "Column mapping"
  section) — a dedicated format still wins whenever it
  actually matches. `bankId` is deliberately **never read** by
  `isSyncedAccount`/`isSyncedHolding`
  (`src/holdings/deletable/`) or any provider-registry lookup — those
  stay keyed on `institution` alone, so tagging an account
  `bankId: 'privatbank'` can never make it look connected. This is the
  Guideline 5.6 invariant (see `guidelines-compliance-is-architecture-rule`
  in memory): never wire a picker selection into a connected-ness
  check.

## Bank catalog and provider registry

`src/bank-sync/bank-catalog/` is the identity catalog (`bankId` — see the
paragraph above; do not duplicate its `bankId`-vs-`institution` distinction
here). `src/bank-sync/provider-catalog/` and `src/bank-sync/registry/registry.ts`
are the separate LIVE-SYNC layer: `bankProviderRegistry` ties a
`BankProviderId` to its concrete `runSync`/`hasCredentials`/`disconnect`
functions (read `registry.ts:28-41`'s comment for the current rationale and
partiality contract) so that `syncJobsFor` and the account-detail screen never
hardcode a provider list — adding a new live-sync provider is one registry
entry, not a change to either caller. The registry is intentionally
`Partial`: a `BankProviderId` with no entry here is simply not yet
implemented, and callers must skip it rather than assume every id resolves.
- **Holding** — a balance-bearing thing under an account (a card, a
  jar, a term deposit, a crypto asset). `id`, `accountId` (FK),
  `name`, `type` (see `schema.ts`'s `holdings.type` enum), `currency`
  (see `schema.ts`'s `holdings.currency` enum), `icon`, `color`,
  `balanceMinorUnits` (integer), `metadata` (JSON: masked PAN, IBAN,
  deposit rate, maturity, Monobank account/jar id), `sortOrder`,
  `closedAt` (nullable), `createdAt`.
- **Transaction** — a movement against a holding. `id`, `holdingId`
  (FK), `amountMinorUnits` (signed integer), `time` (unix
  milliseconds), `description`, `category` (nullable), `mcc`
  (nullable), `hold` (nullable boolean — Monobank's pending-
  authorization flag, whose settled amount can still change; null on
  a manual row), `comment` (nullable), `source` (see `schema.ts`'s
  `transactions.source` enum), `externalId` (nullable; the key a
  re-imported synced item is upserted on, unique per `(source,
  external_id)`. For a SYNCED row it is NAMESPACED by the holding's
  account id — `${accountId}:${sourceId}` — so the global index cannot
  collide across two connections of one provider, Binance record ids
  being only per-account unique; see `kiko-architecture`'s "Namespaced
  synced externalId". A manual row's is null), `createdAt`.

  Re-syncing an existing `externalId` **refreshes** that row's
  bank-owned columns — the settled `amountMinorUnits` and `hold`
  among them — and **never** its `category` (the user's override, or
  a name rule's rewrite) or `comment`. Read `addManyDedup` in
  `src/transactions/` for the exact refreshable
  set, and `transactions.hold` in `src/db/schema.ts` for why a
  pending item is imported at its provisional amount at all, rather
  than trusting a column list restated here.
- **CurrencyRate** — cache of the latest known conversion rate.
  `base`, `quote`, `rate` (a scaled integer or text — never a raw
  float, to avoid drift), `source` (see `schema.ts`'s
  `currencyRates.source` enum), `fetchedAt`. A sibling table,
  `currencyRateHistory`, additionally keeps one row per
  (base, quote, day) for the historical net-worth chart — read
  `schema.ts` directly, this skill does not restate its columns.
- **Settings** — single row: `baseCurrency`, `lastSyncAt`
  (nullable), plus feature settings — read `src/db/schema.ts` for the
  live column set rather than trusting a list here. One is `trendFilter`,
  the Statistics trend chart's saved filter: a JSON `TrendFilter` union
  (`{ mode:'manual', keys } | { mode:'top', amount, by } | null`, see
  `src/statistics/`). It SUPERSEDES the retained-dead
  `trendCategoryKeys` column (migration 0025 copies any saved keys across
  as a manual filter; the old column is pinned reader-less in
  `src/db/settings-columns.test.ts`). The Monobank token is never stored
  here — see `kiko-architecture` for the Keychain rule.

A manual balance adjustment always writes a `manual` Transaction, so
a holding's balance history stays derivable from its transactions.
This is not a convention a caller is trusted to remember — three
repository functions enforce it, and every balance a USER sets goes
through one of them:

- **An edit**: `holdingsRepo.updateWithBalanceDelta`
  (`src/holdings/`) writes the patch AND, when
  `balanceMinorUnits` differs from the stored value, the DIFFERENCE as
  a `manual` row — one `db.transaction()`, delta computed from the row
  re-read inside it (never a render snapshot), no row at all for a zero
  delta. The holding form's edit save calls this, never
  `holdingsRepo.update`, whose bare `set(patch)` stays for the
  non-balance writers (icon/color/metadata, the sync's own writes,
  reorder) and must never be handed a `balanceMinorUnits`.
- **A new holding's opening balance**: `holdingsRepo.create`
  (`src/holdings/`) seeds the same kind of row for
  a non-zero `balanceMinorUnits`, in the transaction that inserts the
  holding. Zero seeds nothing.
- **A new cash account's opening balance**: `accountsRepo.createCashAccount`
  (`src/accounts/accounts.repo.ts`) does the same for its first
  holding, in the transaction that inserts the account and that
  holding.

Why it matters concretely: `holdingValueAt`
(`src/statistics/holding-value-at.ts`) back-derives a holding's opening
balance as `currentBalance - sum(allTransactions)`, so a balance written
without its ledger row retroactively shifts the ENTIRE historical
net-worth series by that amount, and the holding-detail transaction list
stops reconciling with its own displayed Value. None of the three routes
through `transactionsRepo.recordManual` (which would apply the amount to
the balance a second time), and none persists a description or a
category — the label resolves at render time (see the exchange section
below and `transactionRowDescription`, `src/transactions/`). A null category folds
onto `settings.defaultCategoryKey`, so a downward correction counts as
spending like any other uncategorised manual row; that is a RULED
decision (the row is editable), not an oversight to be quietly patched.

A SYNC-owned balance is the exception and writes no ledger row: the
provider owns that number (`upsertByMetadataKey` in
`src/holdings/`), and the form hides the balance field for a synced
holding entirely.

## Statement import moves the target holding's balance too

A file-based statement import (`transactionsRepo.importRows`,
`src/transactions/repo/transactions.repo.ts`, called from
`importStatement`, `src/statement-import/import-statement/`) is a
FOURTH balance writer, alongside the three above — it does NOT write
an extra ledger row (like a manual adjustment does): the imported rows
THEMSELVES already explain the balance move, the same way a Monobank
sync's own upsert does. Everything (the row upsert AND the balance
write) happens in ONE db transaction, so a partial failure can never
leave the ledger and the balance disagreeing. This was a real, shipped
production bug (App Store build 25): `importStatement` used to call
only `transactionsRepo.addManyDedup`, which upserts `transactions` and
never touches `holdings` — an import-only holding (created purely to
receive a statement, opening balance 0, never touched by anything
else) stayed at `balanceMinorUnits: 0` forever, so the Home headline
and that holding's own card showed 0 even though its transaction list
showed the real imported rows.

`importRows`'s own doc comment (`transactions.repo.ts`) is the ONE
full statement of the exact rule — the boundary, `holdings.balanceSetAt`,
the closing-balance override, the wall-clock skew, the synced-holding
exception, and why no migration repairs pre-fix data — read it there
rather than trusting a restated summary here.

## `property_item` / `metal` create-form sections

`src/screens/forms/holding-form/property-section/` is the
`property_item` create-form section: a category `ChipRow`
(`propertyCategories` from `src/holdings/holding-metadata`, editable
in both create and edit mode) plus a Cost field (create-only). One lot
plus one manual price point equal to that cost is what
`holding-form.screen.tsx` builds from it on save, via
`holdingsRepo.create`'s `firstPricePoint` param — see `kiko-pricing`'s
"Creating and clearing a priced holding's price series" section for
the create/remove symmetry.
`src/screens/forms/holding-form/metal-section/metal-section.component.tsx`
is the `metal` create-form section (T20): a metal-element `ChipRow`, a
physical-form `ChipRow`, a unit `ChipRow`, a Purity `TextField`
(pre-filled `"0.9999"`), and the first-lot Quantity/Total-cost fields
(create-only — see `MetalSectionProps.showFirstLot`'s own doc
comment). Unlike `property_item`, `metal`'s create payload writes NO
`firstPricePoint` — its price comes from the shared
`metal:<XAU|XAG|XPT|XPD>` instrument, not a per-holding one (see
`kiko-pricing`'s "Creating and clearing a priced holding's price
series" section, and `holding-form.screen.tsx`'s own comment on the
metal CREATE payload). The metal/form/unit/purity fields stay
user-editable in EDIT mode (metadata patch), mirroring
`property_item`'s category-editable pattern.

## Sync-only holding types are not manually creatable

Some `Holding.type` members are owned exclusively by the Monobank sync
pipeline (`src/monobank/sync/`, which creates those rows
programmatically) and must never appear as an option on the manual
create form — a bank's create form offers only the remaining,
non-sync types. Per Layer 2, this rule's exact type membership is not
restated here: read `src/holdings/holding-type/holding-type.ts`
(`syncOnlyHoldingTypes`, `isSyncOnlyHoldingType`,
`creatableHoldingTypesForAccount`) for the current sync-only set
and the derived creatable-per-account-kind set, and cross-check
against `sync.ts` for which types it actually writes.

The creatable set additionally depends on whether THAT PARTICULAR
account is live-synced, not just its kind:
`creatableHoldingTypesForAccount(kind, isSynced)` takes both — read
that file directly for the exact filter. `jar` is excluded
UNCONDITIONALLY, synced or not (it's a Monobank-API-specific
sub-account concept with no equivalent in a bank statement, so an
import-only account has nothing to name a manual "jar" after); `card`
is excluded ONLY when `isSynced` is true — an import-only bank account
(`isSynced` false, one of the 5 statement-import-only banks) CAN
manually create a `card` holding, since there is no sync pipeline
already owning one for it. Do not assume "sync-only type" means
"excluded regardless of `isSynced`" — `jar` and `card` behave
differently for exactly this reason.

A separate, unrelated grouping in the same file — `lotFormHoldingTypes`/
`isLotFormHoldingType` (T18) — marks which holding types record their
buy/sell history through the dedicated Lot form
(`src/screens/forms/lot-form/`, reached from holding-detail's `addLot`
footer action) rather than a fixed one-time lot or a sync. Only `metal`
is a member today; read `holding-type.ts` directly rather than trusting
that as a restated list. See `kiko-pricing`'s "Recording a lot: LotForm
and the sell cost rule" section for the form itself.

## Entity glyphs: one source of truth

The default SF Symbol for an `Account.kind` and for a `Holding.type`
each has exactly one source of truth: `src/holdings/`
(`accountKindSymbol`, `holdingTypeSymbol`). Every reader — the account
card, the account-detail header, the Kind select, the holding card,
the holding-detail header, the holding-form icon-chip fallback, the
Type select — calls that same function; never add a second kind/type
-> glyph map in a screen module. A past `holding-icon.ts` plus a
screen-exported `KIND_ICON` drifted from this file, so the icon a user
picked in a select differed from the card glyph.

## The `Money` value object

`Money` is the one place amounts are OOP (see `kiko-code-style` for
why this is the deliberate exception to functional-first). It holds
`{ currency, minorUnits }` and is immutable.

- `minorUnits` is always an integer. **Never a float.** Scale is
  per-currency: `BTC` uses 8 decimals (satoshis); `USD`, `EUR`, and
  `UAH` use 2 (cents).
- The value object itself — construction, arithmetic, and the
  currency-mismatch guard — lives in `src/currency/`. Read it
  directly for the current method set rather than trusting a list
  restated here; it drifts (this skill once claimed `Money` had
  `convert`/`format`/comparison methods it does not have).
- Converting a `Money` to a different currency is not a `Money`
  method — that owns a separate concern and lives in `src/rates`.
  Read that directory for the current conversion entry point.
- Formatting a `Money` for display is not a `Money` method either —
  that owns a separate concern and lives in
  `src/currency/`. Read it for the current formatting entry
  point.
- Any table column holding an amount is an integer minor-units
  column (`balanceMinorUnits`, `amountMinorUnits`), never a decimal
  or float column. Convert to/from `Money` at the repository
  boundary.

## Currencies

A small closed set (`BTC` at scale 8, everything else at scale 2) —
read `schema.ts`'s `currency`/`baseCurrency` enum for the exact
current member list rather than trusting a count restated here. Map a
currency code to its scale with `ts-pattern`'s exhaustive `match` — a
currency literal type, not a free string, so adding a currency is a
compile error everywhere the mapping is missing.

Monobank statement currencies arrive as ISO 4217 numeric codes
(`980` = UAH, `840` = USD, `978` = EUR); map them to our currency
literal with `ts-pattern` at the sync boundary, never store the raw
numeric code.

**One source of truth for the currency-code set: `currencyOptions` in
`src/currency/`.** The Drizzle column enums in
`src/db/schema.ts` were once a HIDDEN second, hard-coded copy of this
set (a real drift risk — the same class of bug the `Account.kind`
"broker" incident above documents); they now DERIVE from
`currencyOptions` instead. When you add, remove, or rename a currency
code, change `currency.ts` only, then verify (do not re-hardcode) that
`schema.ts`'s currency-bearing column enums, `rates-refresh.ts`'s
`allCurrencies`, and `monobank-rates.ts`'s `fiatCurrencies` all still
derive from `currencyOptions` rather than carrying their own literal
list. A Drizzle `text({ enum: [...] })` is a TS-only compile-time
hint, not a DB constraint, so changing the set needs no migration.

## Category color resolution

A category's display color is never read as a raw
`category.color ?? undefined` at the call site — every renderer
(chart legend, chart slice, filter chip, transaction-row icon)
resolves it through `resolveCategoryColor(storedColor, key)`
(`src/statistics/`), which falls back to a stable
per-key palette hash when no color is stored. The raw-fallback pattern
renders gray for an uncolored category while a chip for that same
category shows a palette hue — a past transaction-row icon regressed
this way.

The ten categories `0002_seed_categories.sql` seeds do NOT rely on that
hash fallback in practice: migration `0017_default_category_colors`
(`drizzle/migrations/`) gives each seeded key an explicit, distinct
`categories.color` — one `theme.colors.entityColors` member per key,
guarded `WHERE color IS NULL` so it never overwrites a color the user
already picked, and safe to re-run. It exists because the hash, run
over those exact ten keys against the 8-entry `chartSeries` palette,
collapses to five hues (four categories rendered an identical blue
donut wedge before the seed). The per-key hash fallback above is real
and still exercised — a user-created category with no chosen color
still falls through to it — but for the seeded ten it is a fallback
that normally never fires.

The `key` handed to it is never a raw stored value. A stored category
resolves through `resolveCategoryKey` / `resolveCategoryDisplay`
(`src/categories/`): lowercased, with a null, empty,
or unknown-to-the-categories-table slug folding onto the **default**
key (`settings.defaultCategoryKey`, read at the call site — never a
separate "uncategorized" bucket). One fold, one place: the spending
breakdown's `groupKey`, Home's `categoryKeyForRow`, and every color
lookup all go through it, so a category can never render under two
keys — and therefore two hues — at once.

Writers hold up the other end: a category value is persisted only as
the lowercase `categories.key` slug. `categoryForMcc`
(`src/monobank/`) emits the slug, not a display title,
and migration `0014_lowercase_categories` lowercased the legacy rows a
capitalized-title era had already written. Because neither
`transactions.category` nor `category_overrides.category` is COLLATE
NOCASE, `categoriesRepo.delete`'s reassignment additionally compares
case-insensitively on both sides (`lower(column) = lower(key)`), so an
un-migrated row from an older build still gets folded onto the default
instead of being orphaned on a deleted slug.

## Spending-exclusion pipeline

An internal money movement (cash-out, own-account transfer, one leg of
a same-user transfer between holdings, an Exchange/Convert leg) is
excluded from the spending view — read
the transfer-exclusion module (`src/statistics/`, MCC/description based, backed by
`transactions.counterIban` and `settings.defaultCategoryKey`),
the internal-transfers module (`src/statistics/`, the matched-pair fallback), and
the exchange-exclusion module (`src/statistics/`, the exchange-marker rule)
directly rather than trusting a restated MCC list here; see
`kiko-architecture` for the same pointer.

A linked loan payment (T29/T30, spec 5, D14 — "interest-only
spending") is excluded the same way, but REPLACED rather than simply
dropped: the loan-payments module (`src/statistics/loan-payments/`)
exports `loanPaymentExcludedTxIds(transactions, loanHoldings)`, which
drops a row from the pie/trend the same way every other exclusion
rule does, IF AND ONLY IF its `transactions.loanHoldingId` marker
(T29) points at a holding present in `loanHoldings` — Review Focus 7
(`global-constraints.md`): a dangling link (its loan holding was
deleted — `holdingsRepo.remove`/`accountsRepo.remove` already clear
the marker transactionally the moment that happens, T29) is NOT
excluded, so it counts as ordinary spending under its own category,
exactly like an unlinked row. The same module's
`loanInterestEntries({ transactions, loanHoldings })` derives one
synthetic entry per excluded row — id `loan-interest:<txId>`,
category the seeded `loan_interest` key
(`drizzle/migrations/0039_seed_loan_interest_category.sql`), amount
the NEGATIVE interest portion only (never the principal) — mapping
the payment to the installment whose due date is nearest to its own
local day and capping at the payment's own amount
(`loanInterestForPaymentMinor`, `src/holdings/loan-schedule/`, N10b).
`statistics.screen.tsx` feeds these derived entries into BOTH
`buildCategoryBreakdown` and the category trend, alongside every real
row — not into the exclusion-RULE inputs themselves (a synthetic
entry carries no mcc/description/IBAN signal, so it plays no part in
detecting a transfer).

## Exchange/Convert legs: a structural marker, a resolved label

An Exchange/Convert leg is NOT identified by its description. Both legs
carry the counterpart holding's id in a dedicated column — read
`src/db/schema.ts` (`transactions.exchangeCounterpartHoldingId`, whose
comment records why it is a column rather than a reserved `category`
value or a shared `externalId`) and `src/transactions/`
(`recordExchange` / `recordExchangeCounterpart`, which write it on both
legs inside the one transaction; an exchange into a term deposit writes
the marker on its single debit leg). Three consequences hold together:

- The marker is what the spending view excludes on, in the
  exchange-exclusion module (`src/statistics/`): no other rule can see these
  rows — a null `mcc`, an empty description, and a cross-currency pair
  the matched-pair matcher rejects.
- **The repository never writes a description for a leg.** The label is
  resolved at render time through `t` from the marker plus the
  counterpart's CURRENT name (a description the USER later types on that
  row still wins — the resolver prefers a stored one) — `exchangeLegDescription`
  (`src/transactions/`), applied by both
  transaction lists via `transactionRowDescription` (`src/transactions/`). A
  persisted sentence stayed English after a language switch and went
  stale after a rename; that is the bug the column exists to prevent.
- A repository input therefore carries holding IDs, never holding
  display names, for an exchange.

## App lock / security settings

`settings.lockEnabled` is LIVE — wired through `src/auth/use-app-lock.ts`
and the `AppLockSetting` component
(`src/screens/settings/system/app-lock-setting/`). `settings.lockGraceSeconds`
is LEGACY/DEAD: it defaults to 30 and has no reader anywhere in `src/`
(a grace-period-after-backgrounding design was built, then replaced
with a cold-launch-only lock; the column was intentionally left in
place rather than dropped via a migration). Treat it as legacy — do
not re-wire it without a deliberate decision to resurrect the grace
period, and re-check `src/db/schema.ts` before relying on this
description if the lock design changes again.
The shipped lock is **cold-launch only**: `useAppLock` decides once and never
re-locks, so a resident backgrounded process resumes without a prompt. That is
an accepted, recorded risk — see `docs/security/README.md`. `lockGraceSeconds`
is one of the documented reader-less `settings` columns pinned by
`src/db/settings-columns.test.ts`'s `DOCUMENTED_READERLESS_COLUMNS` list —
the other is `appearance` (the removed light/dark color-scheme feature; the
app is now dark-only, see `kiko-design-system`'s "Dark-only theme"); wiring
either back up means removing it from that test's list, which is the
deliberate decision gate. Read the list itself for the exact current set
rather than assuming only these two.

## Dates

Interest and schedule math (`src/holdings/` — deposit
maturity, period boundaries, coupon dates, accrual day counts) is
built entirely with **local-midnight instants**, not UTC. Read the
`daysBetween` comment in that module for why: a raw
`floor((end-start)/DAY_MS)` under- or over-counts by a day across a
Kyiv DST transition, so every boundary (`atDay`, `midCredit`,
`addMonths`) is deliberately constructed from local Y/M/D fields and
diffed via `Date.UTC(y,m,d)` on each side, making the local calendar
day the unit that's compared rather than a raw millisecond delta.
`addMonths` clamps the result's day-of-month to the target month's
length (no January-31 + 1 month rolling into March) while preserving
whatever time-of-day the input carried — it does not force the result
to local midnight, so a non-midnight input keeps its hour/minute/
second/millisecond across the step.

Tests for these helpers use two input styles side by side in
`src/holdings/`'s interest test, and both stay valid because `addMonths` preserves
the input's time-of-day rather than forcing local midnight: the file's
own `local(year, monthIndex, day)` helper for anything that crosses a
DST boundary, and `Date.UTC(...)` where the comment at the call site
says the instant is a winter (no-DST) boundary. A `Date.UTC` instant
is not local midnight on any machine whose system timezone offset
isn't zero (this repo's dev machine is Kyiv, UTC+2/+3) — build a new
test with `local(...)` unless it is specifically exercising a winter
instant the way the existing `Date.UTC` cases do.

`formatDate`/`formatDayMonth` (`src/dates/format.ts`) take an optional
`options?: { timeZone?: 'UTC' }` param: pass it when the caller's own
instant is a UTC-midnight value standing for a LOCAL calendar date
(e.g. `price_points.day` — see `kiko-pricing`'s `dayKeyOf` convention)
— reading such a value with the default LOCAL `Date` getters can land
on the previous calendar day in a negative-UTC-offset timezone. Every
other date formatter in that file stays local-timezone by default;
only pass this option for a value that is already a normalized UTC
calendar day, not for an ordinary wall-clock timestamp.

The recap-OFF first-accrual-day convention (what day a deposit starts
earning when the recap toggle is off) is unresolved — it needs a real
bank statement to confirm against, not a guess; do not implement or
assume a specific convention for it without one.

When you introduce a new epoch-ms-from-string parse of an external
feed's calendar date (e.g. `YYYY-MM-DD`), grep every consumer's own
get-date convention before picking UTC vs. local for the parse.
`BondMeta.maturityDate` was first parsed from the NBU register's
`pgs_date` as UTC midnight, but every consumer reads it through
device-local getters — silently shifting maturity (and every derived
coupon date) back a day west of UTC (T24 review I1, fixed `33333c1`).

Do not pin `process.env.TZ` mid-test to simulate a different
timezone: in this project's `jest-environment-node`, a `TZ` mutation
mid-test does not retarget `Date`/`Intl` local getters (confirmed in
`bond-register.repo.test.ts` and ~8 other pre-existing "TZ-pinned"
test files — `price-book.test.ts`, `local-day.test.ts`,
`interest.test.ts`, `format.test.ts`, the category-trend-line/
net-worth-line component tests, `statistics.screen.test.tsx`,
`net-worth-series.test.ts`). These tests may not prove what they claim
about local-day boundaries. Build fixed instants through the local
`Date` constructor directly instead (the working pattern from T24's
fix, `33333c1`) — never add a new test that pins `TZ` to simulate a
timezone.

## Net worth

**T27 (spec §5.2) changed this rule: net worth = Σ asset values − Σ
debt outstanding**, in the base currency — it is no longer
assets-only. It is the sum of every non-archived holding's value
(`holdingValue`/`holdingValueBreakdown`, `src/holdings/holding-value/`),
each converted to the user's selected base currency (stored in
`Settings.baseCurrency`). A `loan` holding's own value is NEGATIVE —
minus its outstanding balance (`loanOutstandingMinorAt`,
`src/holdings/loan-schedule/`) — so **no debt-aware branch exists
anywhere in the summation path**: `netWorth`/`guardedNetWorth`
(`src/rates/conversion/`, `src/rates/net-worth-view/`) and
`buildNetWorthSeries` (`src/statistics/net-worth-series/`) simply add
up every holding's own (possibly negative) value, exactly as they did
before loans existed. A credit-card negative balance already worked
the same way (a plain negative `balanceMinorUnits`) and still does —
a loan is just the second holding shape whose value can be negative.
The headline can now render negative; `MoneyText` already renders a
negative `Money` with a minus sign through `formatMoney`, so no
special-casing was needed there either (see `kiko-charts` for the pie
chart and net-worth line's own T27 rules). An archived account's or
closed holding's balance is excluded. The headline total
(`guardedNetWorth`) and the per-currency breakdown shown beneath it
(`guardedBreakdown`) share one `canConvert` filter in `src/rates/`, so
a currency with no resolvable rate is dropped from both — never
included in the breakdown after being excluded from the total. See
`kiko-pricing`'s "Currency-rate fallback chain" section for how a rate
is resolved (Monobank → NBU → bundled fiat seed); today CRYPTO is the
only currency class that can still hit this silent-drop path (no
offline seed, so an unrated crypto holding is excluded until a live
CoinGecko price lands) — every fiat currency is covered by the bundled
seed and effectively never drops.

`buildTypeBreakdown` (`src/statistics/type-breakdown/`, the by-type
bar) excludes `loan` outright rather than letting it slip through as a
negative bar — it is an ASSET breakdown, and debt has its own total
(see below).

**The account pie (`buildAccountContribution`,
`src/statistics/account-contribution/`) is ASSETS ONLY (T27 round 1,
I2 — spec §5.2/§5.3):** an account's slice sums only its POSITIVE
holding values; a negative holding (a `loan`'s own value, or a
non-loan holding in debit, e.g. a credit card) never reduces it and
never nets against a positive one in the same account. An account
with nothing positive to show gets no slice at all, rather than a
negative one. **The "Debts" total (`buildDebtTotal`, same file) is
where that debt goes instead**, and — per spec §5.2, "Credit-card
negative balances count as debt too" — it sums EVERY holding whose
own value is negative, not loans only: a `loan`'s already-negative
outstanding, and a non-loan holding in debit, are summed the same way,
by sign alone, no type check. `buildDebtTotal` is called ONLY on
Statistics (`statistics.screen.tsx`, rendered under the account pie).
Home has no separate debts line (ruling M3): its `guardedNetWorth`
headline and its `guardedBreakdown` per-currency breakdown both stay
SIGNED (net) sums of every holding, so the breakdown still adds up to
the headline exactly as it always did — a debt nets into its own
currency's cell there, unlike Statistics' assets-only pie. Accounts'
own "Debts" section (`accounts.screen.tsx`) computes its OWN section
total independently, via `guardedNetWorth` of just the debt-kind
accounts' holdings (M2 — every debt-kind account holds only `loan`
holdings, so this total is always <= 0); it does not call
`buildDebtTotal`, which sums across every account kind. Read
`kiko-charts` for the pie/line-specific rules.

## Price series and priced holdings

See `kiko-pricing` for `price_points`, `PriceBook`, priced-holding
valuation (`property_item`/`metal`), the create-time `firstPricePoint`
and remove-time series cleanup, and `PricePointForm` / "Update value".

## Bonds — ISIN validation and the NBU register cache (T23/T24)

`BondMeta` (`src/holdings/holding-metadata/holding-metadata.ts`)
already carries the full bond shape a Manual-mode form writes:
`quantity`, `faceValueMinorUnits`, `couponPct` (a plain `number`, not
a scaled decimal string — it is a percentage, never fed through the
BigInt decimal helper), `purchaseDate`, `purchasePriceMinorUnits`,
`maturityDate`, `bondKind` (`'government' | 'corporate'`), and
`couponFrequency` (`BondCouponFrequency` — `'monthly' | 'quarterly' |
'semiannually' | 'annually'`). `purchaseDate`/`maturityDate` are raw
epoch-ms instants (often mid-day, e.g. `Date.now()`), read through
`startOfLocalDay` wherever a day boundary matters
(`holding-value.ts`), NOT through `dayKeyOf`'s "a local calendar date
encoded as UTC midnight" convention — do not conflate the two.

`src/bonds/isin/` (T23) validates an ISIN with no side effects:
`normalizeIsin` trims/uppercases; `validateIsin` checks the ISO 6166
shape (`^[A-Z]{2}[A-Z0-9]{9}[0-9]$`) and Luhn check digit, returning
`{ ok: true, isin }` or `{ ok: false, reason: 'format' | 'checkDigit'
}` — never throws on an expected validation failure, the standing
domain convention.

`src/bonds/nbu-register/` (T24) is the NBU securities-register client
(spec 6.1/6.2), mirroring `nbu-metals.ts`'s pattern (fetch + `guard`-
based validation + a recorded JSON fixture, no network in tests) on
the SAME `bank.gov.ua` host — no new pinning (kiko-compliance: this
host stays keyless and unpinned; see `docs/security/README.md`'s host
table). `fetchNbuRegister(fetchImpl)` reads `GET
https://bank.gov.ua/depo_securities?json` and maps each record to
`BondTerms` (`{ isin, currency, faceValueMinorUnits, couponPct,
maturityDate, couponFrequency: BondCouponFrequency | null, name }`),
dropping a record with an unmodeled `val_code` currency or an
unparseable `pgs_date` rather than throwing. `nominal` ->
`faceValueMinorUnits` goes straight through `Money.fromMajor` — it is
an amount, not a scaled decimal-string price/quantity, so no
`decimalFromJsonNumber` boundary conversion is needed (the same
parity every other Money amount conversion follows). `pgs_date`
(`YYYY-MM-DD`) is parsed as a DEVICE-LOCAL midnight instant (`new
Date(year, month - 1, day)`), NOT through `parseDateTimeSeconds`'s
"read a wall-clock date as UTC" convention — `BondTerms.maturityDate`
feeds straight into `BondMeta.maturityDate` above, and every consumer
of that field reads it through local getters, so a UTC parse would
silently shift the maturity date (and every coupon date derived from
it) back a day for a user west of UTC (T24 review finding I1).
`couponFrequencyFromPayPeriod(days)` maps the register's `pay_period`
onto `BondCouponFrequency`, tolerating a ±5-day slack around each of
the four canonical periods (30/91/182/364); a period outside every
band resolves to `null` — the eventual ISIN-mode form falls back to
Manual mode with the known fields pre-filled rather than guessing
(spec 6.2).

`src/bonds/bond-register-repo/` caches the register in the
`bond_register` table (migration `0037`; `isin` primary key, `terms`
a JSON `BondTerms` column, `fetchedAt`). `bondRegisterRepo` exposes
`findByIsinQuery(isin)` and `fetchedAtQuery()` (both hand straight to
`useLiveQuery`; `fetchedAtQuery` is also awaited directly as a
one-shot read, the same dual-purpose pattern `ratesRepo` and
`pricePointsRepo` establish) and `replaceAll(rows)` — a REPLACE, not
an upsert: every existing row is deleted and the fresh set inserted in
ONE transaction, so a matured/delisted ISIN disappears from the cache
the same run it disappears from the live register.
`refreshBondRegisterIfStale({ now, fetchImpl })` gates the fetch at
most once per LOCAL calendar day, comparing the cache's single
write-time `fetchedAt` stamp against `now` through `dayKeyOf`
(`kiko-pricing`) — the same device-local-day convention `price_points`
uses, not a UTC day. `src/bonds/bond-register-repo/index.ts` is a
barrel (`export * from './bond-register.repo'`), added in T25 once the
ISIN-mode form became a real consumer — see the T24 ruling's own note
that no barrel existed yet (Knip would have flagged an unused one).

### The ISIN-mode form (T25, spec 6.3/6.4)

`BondMeta.isin?: string` (`holding-metadata.ts`) records how a bond was
added — present for one saved through ISIN mode (or typed into
Manual mode's own optional ISIN field), `undefined` for a legacy
Manual-mode bond. Once saved, the holding never depends on the
register again (spec 6.4 #5) — nothing re-validates a stored ISIN
against a later register state.

`holding-form.screen.tsx`'s bond section has an "ISIN / Manual"
`BondEntryMode` mode, the design-system `SegmentedControl` (not
`ChipRow` — F3/T24 ruling: one control type per kind of mode choice),
rendered by `BondIsinSection`
(`src/screens/forms/holding-form/bond-isin-section/`) — purely
presentational, the same `MetalSection`/`PropertySection` split.

**`useBondIsinMode`** (`src/screens/forms/holding-form/use-bond-isin-mode/`)
owns ALL of the ISIN-mode state, the `useLiveQuery` lookup
(`bondRegisterRepo.findByIsinQuery`, keyed on the normalized ISIN when
`validateIsin` passes, else an empty string that matches no row), and
THREE SEPARATE effects — extracted out of `HoldingFormScreen` (T25
review round 1, I4) specifically because a single MERGED effect
sharing one dependency array is what caused I1 below; the hook has its
own cognitive-complexity budget instead of borrowing the screen's, so
its effects stay genuinely separate with no lint-driven pressure to
recombine them:
- refreshes the register cache at most once per local day (spec 6.4
  #4), fired once per bond-section open (create or edit); the
  fire-and-forget call is `either(() => refreshBondRegisterIfStale())`
  as a bare statement (the project's standing fire-and-forget idiom —
  `either` never rejects, so a network failure can never surface as a
  form error or an unhandled rejection);
- defaults `purchaseDate` to LOCAL MIDNIGHT (`startOfLocalDay`, not a
  raw `Date.now()`) the first time ISIN mode is entered — a raw
  `Date.now()` default would leave a LATER explicit pick composed with
  that moment's clock time instead of a clean day, because
  `DateField.handleDayPress` carries an existing value's own
  time-of-day onto a newly picked day (so a paired TimeField pick is
  never clobbered);
- applies a found ISIN's terms once PER MATCH while in ISIN mode,
  tracked by a REF (`lastAppliedIsinRef`, not the effect's own
  dependency array) rather than "since `bondMode` is still isin" — the
  register lookup itself is NOT gated on `bondMode` (a valid ISIN
  typed in Manual mode resolves just as readily), so a match resolved
  while the user is in Manual mode still applies the first time they
  later switch to ISIN (T25 review round 2, N1: keying purely on
  `registerTerms?.isin` missed exactly this case, because the effect
  never ran again once `bondMode` stopped changing). This also fixes
  T25 review round 1's I1 (a merged effect re-applied on every
  unrelated change, silently overwriting a typed name or a changed
  currency) and I3 (the same merged effect re-firing on every re-tap
  of "ISIN" put the control into a loop back to Manual for an
  unmapped-frequency match).

ISIN mode shows quantity (required) and purchasePrice (optional,
defaults to nominal — unchanged from Manual) always; it hides face
value, coupon, maturity, kind, and frequency — a found ISIN fills all
of them: `bondKind` is always `'government'` (the register is
Minfin-only), `couponFrequency` only when the register's `pay_period`
maps onto a known band; an unmapped period (spec 6.2's own documented
fallback) instead switches the form to Manual ONCE, the first time
that match is applied, leaving every OTHER known field pre-filled,
rather than guessing a frequency. Re-tapping "ISIN" afterward for that
SAME match does stay in ISIN mode (I3) — but showing the register's
summary there with no visible frequency would silently let the form
carry the shared `couponFrequency` state's own untouched default into
Save, which is the exact guess spec 6.2 forbids. So ISIN mode instead
shows its OWN coupon-frequency `ChipRow` with NO default whenever the
matched terms have `couponFrequency === null`
(`needsCouponFrequencyPick`), and Save is blocked until the user picks
one (T25 review round 2, N2) — never a frequency the user did not
pick or the register did not give. In
EDIT mode, a found ISIN whose currency differs from the (locked)
holding currency is never applied at all — `isinReasonKey` returns
`'forms.holding.isinCurrencyMismatchError'` instead, blocking Save
(T25 review round 1, I5 — the currency field is locked
`disabled={isEdit}`, so a silent apply used to store one currency's
terms under a holding balance denominated in another). Outside edit
mode a found ISIN's `currency`/`name` DO overwrite the form's own
state on every new match — editable afterward, but re-applied whenever
the ISIN changes to a new found bond.

A CREATE defaults to `'isin'`; EDIT always seeds `'manual'` (spec 6.4
#6 — the stored ISIN is shown there, still editable) via
`seedBondMetaFields`, which also calls the hook's own `setBondMode`.

Validation (`isinReasonKey`, returned by the hook, backed by a
module-level pure `bondIsinReasonKey`): required and blocking in ISIN
mode; optional but still check-digit-validated when non-empty in
Manual mode; `isinNotInRegister` once shape/check-digit both pass but
the cache has no match (spec 6.4 #3 — a genuine not-found and an
offline-with-no-cache open the same way, since both leave the lookup's
result `null`); `isinCurrencyMismatchError` in edit mode per I5 above.
A maturity-before-purchase reason (`bondReasonKey`, unrelated to the
ISIN reason above) still applies unchanged in ISIN mode — a
matured-still-registered bond (spec 6.1 counts 2 in the live register)
can pass every ISIN check yet still fail this — but ISIN mode never
mounts the maturity `DateField`, so `holding-form.screen.tsx` shows and
scrolls to that reason on the purchase date `DateField` instead (T25
review round 1, I2), the one date the user actually controls there.

The five Manual-only fields (face value, coupon %, maturity date, bond
kind, coupon frequency) are their own component,
`ManualBondFields` (`src/screens/forms/holding-form/manual-bond-fields/`):
it takes `bondMode` as a prop and returns `null` outside Manual mode,
rather than the caller gating `{bondMode === 'manual' && (...)}`
around its JSX — see `kiko-code-style`'s `noExcessiveCognitiveComplexity`
entry for why a conditional NESTED inside the bond block's own
`{type === 'bond' && (...)}` gate needed a real extraction, not a
`match()` trick (T25 review round 1, I4).

## Debts — the `debt` kind, `loan` type, and schedule math (T26)

`accounts.kind` gains `debt` (en "Debt", uk "Борг" — the label ships
in T26; the "Debts" net-worth/accounts-screen wiring is T27) and
`holdings.type` gains `loan`, TS-only enum widenings (no migration,
same as `property`/`metals` at T13/T17). `loan` is `isLedgerlessHoldingType`
(`src/holdings/holding-type/`) — like `property_item`/`metal`, a loan
holding writes NO `Transaction` ledger rows of its own; every payment
lives on the LINKED bank holding instead (T29's `loanHoldingId`
column). `debt` maps to `loan` alone in `holdingTypesForAccountKind`,
and `loan` is excluded from every Exchange source/destination
predicate in `exchange-destination.ts` (a loan is never an Exchange
leg). Entity glyph/color: `minus.circle.fill` / `entityColorsDark.red`,
shared between the `debt` kind and its sole `loan` type — the same
kind-and-type icon/color reuse `property`/`property_item` and
`metals`/`metal` already follow.

`LoanMeta` (`src/holdings/holding-metadata/holding-metadata.ts`):
`kind` (`'mortgage' | 'car_loan' | 'consumer_loan' | 'personal'` —
`personal` is money owed to a person, not a bank), `principalMinorUnits`,
`startDate`, `schedule` (`'annuity' | 'differentiated' | 'none'`), and
`annualRatePct?`/`termMonths?` — both OPTIONAL, since a `none`
(informal) loan carries no known rate/term; the create form is
expected to require them for `annuity`/`differentiated` (T28), not
`asLoanMeta` itself, which accepts either shape. A loan the user GAVE
to someone (not owed BY them) is not a `loan` holding at all — it
stays the existing `property` category `loan_given` (T13), which is
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
  (`round(principal / termMonths)`). Either way the LAST installment's
  principal is simply whatever balance remains, so the schedule always
  reduces to EXACTLY 0, never a stray rounding kopeck.
- `loanOutstandingMinorAt(meta, holdingId, book, instant)` (open
  question N10a, binding default): `none` reads the manual
  `holding:<id>` price-point series directly (the same mechanism
  Property's "Update value" uses), clamped to never go below 0.
  `annuity`/`differentiated` are computed AT READ TIME from the
  schedule: the LATEST manual correction point on the loan's own
  `holding:<id>` instrument (if any, at or before `instant`'s local
  day) anchors a fresh baseline value; only the scheduled PRINCIPAL
  due STRICTLY AFTER that correction's day (and at or before `instant`)
  is subtracted from it. With no correction ever recorded, the anchor
  is simply the loan's own principal at `startDate`. Either path
  clamps to 0 — an overpaid/over-corrected loan reads as paid off,
  never negative.
- `loanInterestForPaymentMinor(meta, paymentTime, paymentAbsMinor)`
  (open question N10b, binding default; D14's "interest-only
  spending" — the derived-entry wiring itself is the "Spending-
  exclusion pipeline" section above): `none` always counts 0 interest
  (an informal debt has no schedule to derive interest from).
  Otherwise the payment maps to the installment whose `dueDate` is
  NEAREST to the payment's own local day (not necessarily the next
  unpaid one), and the interest counted is that installment's
  scheduled interest capped at `paymentAbsMinor` — a partial payment
  can never count more interest than it actually paid. M2 (T26
  review, fixed at T30): a payment MORE THAN ONE PERIOD outside the
  schedule (before `addMonths(startDate, 0)`, after
  `addMonths(startDate, installments.length + 1)`) counts 0 instead of
  still mapping to the nearest boundary installment — both bounds are
  inclusive, only a payment strictly beyond one counts 0.

`holding-value.ts`'s valuation branch (`gross = net = -outstanding`,
`principalOrCost = -principal`, interest/tax always 0 — a loan never
accrues either AT VALUATION time) and the net-worth assets-minus-debt
rule change landed at T27. The `loanHoldingId` link column + its repo
functions landed at T29 (own subsection below). Interest-only
spending (T30) landed as the "Spending-exclusion pipeline" section's
loan-payments module, above. Not yet wired as of T30 (later tasks):
the transaction-form field (T31) and the automatic payment-linking
matcher itself (T32, spec 5.4) — read each task's own brief before
assuming that works.

### Loan form + detail (T28)

`src/screens/forms/holding-form/loan-section/` (kind ChipRow,
principal, start date, schedule SegmentedControl, rate/term hidden for
`'none'`) and its own `use-loan-fields/` hook (state + per-schedule
`loanReasonKey` validation + edit-mode `seed`) mirror T25's
`useBondIsinMode` extraction — the hook exists so the loan section's
state/validation carries its own cognitive-complexity budget instead
of borrowing `HoldingFormScreen`'s (already at the ceiling before this
task). Unlike `PropertySection`/`MetalSection`'s create-only-lot
fields, EVERY loan field stays editable in both create and edit mode
(mirrors term_deposit/bond) — there is no fixed-at-creation "first
lot" a loan's principal/dates/schedule freeze against. The
`type === 'loan'` render block is its own leaf component
(`LoanFormBlock`, module-scope in `holding-form.screen.tsx`) rather
than an inline `{type === 'loan' && (...)}` conditional, for the same
complexity-budget reason. A `'none'`-schedule CREATE additionally
writes a first `manual` price point on the new holding's own
`holding:<id>` series, equal to the principal at the start date
(`buildLoanCreatePayload`) — mirroring `PropertySection`'s own
first-point convention, so `loanOutstandingMinorAt`'s manual-series
read never comes up empty before the user records a real correction.
An `'annuity'`/`'differentiated'` CREATE writes none — its outstanding
is computed at read time from principal + schedule.

`holding-detail.screen.tsx`: `footerActionFor` returns `'updateValue'`
for a loan too (checked before the ledgerless fallback) — it reuses
`PricePointForm` to write a correction onto the SAME `holding:<id>`
manual series every schedule reads a correction from (not just
`'none'`), with the footer button's own label swapped to "Update
outstanding" (`holdingDetail.updateOutstanding`) for that type, and
`PricePointFormScreen` itself overriding the stack's static "Update
Value" title to "Update Outstanding" once the holding loads as a loan.
An `'annuity'`/`'differentiated'` loan additionally shows a "Next
installment (`<date>`)" panel (`nextLoanInstallment` — the first
`loanInstallments` row due on or after today's local day) with its
principal/interest split; a `'none'` schedule and every other holding
type render nothing there. That panel is also hidden once
`loanOutstandingMinorAt` reads 0 at `now` (`nextLoanInstallment`'s own
`<= 0` guard) — a fully repaid, or overpaid/over-corrected, loan shows
no next installment even while `loanInstallments` still has future
rows on the loan's ORIGINAL schedule.

A loan correction (the "Update outstanding" `PricePointForm` write
above) accepts **0**, unlike every other holding type's "Update
value" (`> 0`): a 0 point means repaid. `loanOutstandingMinorAt`
already clamps every read at 0, and a 0 write never deletes the
holding's earlier points — net worth reads 0 from that day forward
while an earlier day still reads its own, earlier correction.

**Loan EDIT reconciliation** — `holdingsRepo.updateLoan` writes the
metadata patch and a `LoanPricePointOp` in ONE transaction
(`buildLoanPricePointOp`, `holding-form.screen.tsx`), reconciling the
loan's manual `holding:<id>` series against what the metadata edit
just changed:

- (a) a schedule change INTO `'none'` (from `'annuity'`/
  `'differentiated'`) preserves the OLD schedule's current outstanding
  as a manual point, so the debt never silently reads as 0 the instant
  the schedule is cleared. Normally that point is dated TODAY. But
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
- (c) every other transition (including `'none'` OUT to a schedule)
  leaves the manual series untouched — a correction point is still
  valid for a scheduled loan (N10a above).

A fresh holding (`oldMeta === null`) has nothing to reconcile.

`termMonths` is capped at `MAX_LOAN_TERM_MONTHS` (`use-loan-fields.ts`,
600 months / 50 years — comfortably above any real mortgage/car-loan
term): an uncapped value would make `loanInstallments` build an
unbounded row count for a degenerate but technically-valid positive
integer.

### Loan-payment link column + repo (T29, revised by review round 1)

Migration 0038 adds three columns to `transactions` (spec 5.4): `loanHoldingId`
(text, nullable — the linked loan holding), `loanLinkSource` (text enum
`'auto' | 'manual'`, nullable), and `loanLinkRejected` (integer boolean,
NOT NULL default `false`). The two link columns are kept in lockstep — never a
`loanLinkSource` with no `loanHoldingId` or vice versa.

**Two separate write paths, not one** (T29 review round 1, I2): only a
MANUAL action may ever move `loanLinkRejected`.

- `transactionsRepo.setLoanPayment({ transactionId, loanHoldingId })` is the
  MANUAL path (the user's own picker, T31). A manual LINK
  (`loanHoldingId` non-null) clears `loanLinkRejected`, un-rejecting a row
  the user had previously undone — a fresh manual pick always overrides an
  earlier Undo. A manual **"None"** (`loanHoldingId: null`) **SETS**
  `loanLinkRejected` (I3 ruling) — the user's explicit "not a loan payment"
  has to stick, or the very next sync would just auto-link the row again.
  This deviates from spec 5.4's literal text ("a manual None clears the
  flag"), which the orchestrator ruled would make "None" not stick.
  `loanHoldingId: null` also nulls `loanLinkSource`, keeping the two
  columns in lockstep. No `source`-column gate — exactly like `setCategory`,
  the link is user state, not a mutation of bank-owned ledger data, so it
  is allowed on a synced (`monobank`/`binance`/`import`) row too.
- `transactionsRepo.setAutoLoanLinks(links: { transactionId, loanHoldingId }[])`
  is the matcher's path (T32): writes every link in ONE transaction (spec
  5.4's "one `db.transaction()` writes the links"), NEVER touches
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
exclusion `category`/`comment` already rely on (see that function's own
existing doc comment). A settled-amount re-fetch of an already-linked payment
therefore keeps its link untouched. Its underlying insert
(`insertDedupRowsTx`) is chunked through `chunkForTable` (below) — a whole
statement-import file or Monobank sync above a few thousand rows failed
`SQLITE_MAX_VARIABLE_NUMBER` before this (M6).

**Review Focus 7, extended to the account-delete path (I1).**
`holdingsRepo.clearLoanLinksForHoldingsTx(tx, holdingIds)` (exported, not
private to `remove`) clears `loanHoldingId`/`loanLinkSource` on every OTHER
holding's transaction that still points at one of `holdingIds`, in the SAME
`write()` transaction as the delete itself (`UPDATE transactions SET
loan_holding_id = NULL, loan_link_source = NULL WHERE loan_holding_id IN
(...)`) — a no-op for every non-loan holding, since nothing ever points a
`loanHoldingId` at one. Both delete paths call it: `holdingsRepo.remove`
(one holding) AND `accountsRepo.remove` (every holding a deleted DEBT
account owned, since a loan lives on a manual `debt` account) — a loan
deleted either way never leaves a dangling link behind. A dangling link is
never left to rot: once cleared, the payment counts as normal spending
again, exactly like an unlinked transaction always has. `loanLinkRejected`
is deliberately left untouched by this cascade — it is not part of "the
link".

`restoreDataSnapshot` inserts every `transactions` row verbatim with no
per-row column handling for these three columns (unlike
`holdings.balanceSetAt`'s dedicated legacy backfill), so a `.kiko` exported
before this migration — whose transaction rows carry no
`loanHoldingId`/`loanLinkSource`/`loanLinkRejected` keys at all — restores
unchanged and SQLite defaults the missing columns itself (null / null /
false), the same way `counterIban`/`changeGroupId` already do for an older
export. It DID need a fix for how it chunks every insert (C1, T29 review
round 1): T29's 3 new columns took `transactions` from 15 to 18 columns, so
the OLD fixed 2000-rows-per-chunk constant bound 2000 x 18 = 36000
parameters — over SQLite's 32766-bound-parameter ceiling — and a `.kiko`
backup with >= 1821 transactions failed to restore. `chunkForTable`
(`src/db/chunk-for-table.ts`, shared with `insertDedupRowsTx` above) derives
the row count per chunk from the TARGET table's own column count
(`getTableColumns`, floor-divided into a safety margin under the ceiling)
instead of a fixed row constant, so a future column added to any of these
tables can never silently repeat this — the widest table just gets a
smaller chunk automatically.
