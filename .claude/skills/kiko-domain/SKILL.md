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
  holder, or standalone precious-metals holder. `id`, `name`, `kind`
  (see `schema.ts`'s `accounts.kind` enum for the current member set —
  as of T17 this includes `property` and `metals` alongside `bank`/
  `cash`/`crypto`; both are manually-created-only kinds with no sync
  concept), `institution` (nullable, e.g. `monobank` — marks a LIVE
  sync connection), `bankId` (nullable, migration `0033`; see below),
  `icon`, `color`, `sortOrder`, `archivedAt` (nullable), `createdAt`.
  `holdingTypesForAccountKind` (`src/holdings/holding-type/`) maps
  each account kind to its allowed `Holding.type` set — `property`
  maps to `property_item`, `metals` maps to `metal` — read that file
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
  `src/bank-sync/bank-catalog/` — read that file for the current
  6-bank set (`BankId`/`bankCatalog`) rather than trusting a list
  copied here. It is **identity-only, independent of `institution`**:
  only Monobank has a live API Connect today (`connectable: true` in
  the catalog), the other 5 entries are import-only, scoping which
  `statement-import` parser applies. That parser is only ever a
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

## Net worth

Net worth is **assets-only** — liabilities and debt are out of scope
for this sub-project. It is the sum of every non-archived holding's
balance, each converted to the user's selected base currency (stored
in `Settings.baseCurrency`). An archived account's or closed holding's
balance is excluded. The headline total (`guardedNetWorth`) and the
per-currency breakdown shown beneath it (`guardedBreakdown`) share one
`canConvert` filter in `src/rates/`, so a currency with no resolvable
rate is dropped from both — never included in the breakdown after
being excluded from the total. See `kiko-pricing`'s "Currency-rate
fallback chain" section for how a rate is resolved (Monobank → NBU →
bundled fiat seed); today CRYPTO is the only currency class that can still hit
this silent-drop path (no offline seed, so an unrated crypto holding
is excluded until a live CoinGecko price lands) — every fiat currency
is covered by the bundled seed and effectively never drops.

## Price series and priced holdings

See `kiko-pricing` for `price_points`, `PriceBook`, priced-holding
valuation (`property_item`/`metal`), the create-time `firstPricePoint`
and remove-time series cleanup, and `PricePointForm` / "Update value".
