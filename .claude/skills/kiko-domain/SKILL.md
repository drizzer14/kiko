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

- **Account** — a bank, cash stash, or crypto wallet. `id`, `name`,
  `kind` (see `schema.ts`'s `accounts.kind` enum for the current
  member set), `institution` (nullable, e.g. `monobank`), `icon`,
  `color`, `sortOrder`, `archivedAt` (nullable), `createdAt`.
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
  (nullable), `comment` (nullable), `source` (see `schema.ts`'s
  `transactions.source` enum), `externalId` (nullable, unique per
  source — used to dedup a re-imported Monobank statement item),
  `createdAt`.
- **CurrencyRate** — cache of the latest known conversion rate.
  `base`, `quote`, `rate` (a scaled integer or text — never a raw
  float, to avoid drift), `source` (see `schema.ts`'s
  `currencyRates.source` enum), `fetchedAt`. A sibling table,
  `currencyRateHistory`, additionally keeps one row per
  (base, quote, day) for the historical net-worth chart — read
  `schema.ts` directly, this skill does not restate its columns.
- **Settings** — single row: `baseCurrency`, `lastSyncAt`
  (nullable). The Monobank token is never stored here — see
  `kiko-architecture` for the Keychain rule.

A manual balance adjustment always writes a `manual` Transaction, so
a holding's balance history stays derivable from its transactions.

## Sync-only holding types are not manually creatable

Some `Holding.type` members are owned exclusively by the Monobank sync
pipeline (`src/monobank/sync.ts`, which creates those rows
programmatically) and must never appear as an option on the manual
create form — a bank's create form offers only the remaining,
non-sync types. Per Layer 2, this rule's exact type membership is not
restated here: read `src/holdings/holding-type.ts`
(`syncOnlyHoldingTypes`, `isSyncOnlyHoldingType`,
`creatableHoldingTypesForAccountKind`) for the current sync-only set
and the derived creatable-per-account-kind set, and cross-check
against `sync.ts` for which types it actually writes.

## Entity glyphs: one source of truth

The default SF Symbol for an `Account.kind` and for a `Holding.type`
each has exactly one source of truth: `src/holdings/entity-symbols.ts`
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
- Methods: `add`, `subtract`, `negate`, `convert(rate,
  targetCurrency)`, `format(locale)`, `isZero`, plus comparison
  helpers.
- `add` and `subtract` reject a currency mismatch — they throw or
  return a typed error, they never silently coerce. `convert` is the
  only way to change a `Money`'s currency.
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

## Category color resolution

A category's display color is never read as a raw
`category.color ?? undefined` at the call site — every renderer
(chart legend, filter chip, transaction-row icon) resolves it through
`resolveCategoryColor(storedColor, key)`
(`src/statistics/category-breakdown.ts`), which falls back to a
stable palette hash keyed on `category?.toLowerCase() || 'uncategorized'`
when no color is stored. The raw-fallback pattern renders gray for an
uncolored category while a chip for that same category shows a
palette hue — a past transaction-row icon regressed this way.

## Spending-exclusion pipeline

An internal money movement (cash-out, own-account transfer, one leg of
a same-user transfer between holdings) is excluded from the spending
view — read `src/statistics/transfer-exclusion.ts` (MCC/description
based, backed by `transactions.counterIban` and
`settings.defaultCategoryKey`) and `src/statistics/internal-transfers.ts`
(the matched-pair fallback) directly rather than trusting a restated
MCC list here; see `kiko-architecture` for the same pointer.

## App lock / security settings

`settings.lockEnabled` is LIVE — wired through `src/auth/use-app-lock.ts`
and the `AppLockSetting` component
(`src/screens/settings/app-lock-setting/`). `settings.lockGraceSeconds`
is LEGACY/DEAD: it defaults to 30 and has no reader anywhere in `src/`
(a grace-period-after-backgrounding design was built, then replaced
with a cold-launch-only lock; the column was intentionally left in
place rather than dropped via a migration). Treat it as legacy — do
not re-wire it without a deliberate decision to resurrect the grace
period, and re-check `src/db/schema.ts` before relying on this
description if the lock design changes again.

## Net worth

Net worth is **assets-only** — liabilities and debt are out of scope
for this sub-project. It is the sum of every non-archived holding's
balance, each converted to the user's selected base currency (stored
in `Settings.baseCurrency`) using the latest cached `CurrencyRate`.
An archived account's or closed holding's balance is excluded.
