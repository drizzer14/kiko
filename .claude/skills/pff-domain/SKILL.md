---
name: pff-domain
description: Invoke whenever you touch the domain model — the Account/Holding/Transaction schema, the Money value object, currency codes, or net worth calculation. Read before writing a Drizzle table, a repository, a form, or any code that handles an amount.
---

# PFF domain model

Source of truth: `docs/superpowers/specs/2026-08-30-pff-foundation-design.md`
("Domain model" section). This skill summarizes the settled contract;
if the two ever disagree, the spec wins and this skill needs updating.

## The three levels

`Account -> Holding -> Transaction`, plus two supporting tables:

- **Account** — a bank, cash stash, crypto wallet, or broker.
  `id`, `name`, `kind` (`bank` | `cash` | `crypto` | `broker`),
  `institution` (nullable, e.g. `monobank`), `sortOrder`,
  `archivedAt` (nullable), `createdAt`.
- **Holding** — a balance-bearing thing under an account (a card, a
  jar, a term deposit, a crypto asset). `id`, `accountId` (FK),
  `name`, `type` (`card` | `term_deposit` | `bond` | `cash` |
  `crypto_asset` | `jar`), `currency` (`BTC` | `USD` | `EUR` |
  `UAH`), `balanceMinorUnits` (integer), `metadata` (JSON: masked
  PAN, IBAN, deposit rate, maturity, Monobank account/jar id),
  `sortOrder`, `closedAt` (nullable), `createdAt`.
- **Transaction** — a movement against a holding. `id`, `holdingId`
  (FK), `amountMinorUnits` (signed integer), `time` (unix
  milliseconds), `description`, `category` (nullable), `mcc`
  (nullable), `comment` (nullable), `source` (`manual` |
  `monobank`), `externalId` (nullable, unique per source — used to
  dedup a re-imported Monobank statement item), `createdAt`.
- **CurrencyRate** — cache of the latest known conversion rate.
  `base`, `quote`, `rate` (a scaled integer or text — never a raw
  float, to avoid drift), `source` (`monobank` | `coingecko`),
  `fetchedAt`.
- **Settings** — single row: `baseCurrency`, `lastSyncAt`
  (nullable). The Monobank token is never stored here — see
  `pff-architecture` for the Keychain rule.

A manual balance adjustment always writes a `manual` Transaction, so
a holding's balance history stays derivable from its transactions.

## The `Money` value object

`Money` is the one place amounts are OOP (see `pff-code-style` for
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

Exactly four, for this sub-project: `BTC` (scale 8), `USD`, `EUR`,
`UAH` (scale 2 each). Map a currency code to its scale with
`ts-pattern`'s exhaustive `match` — a currency literal type, not a
free string, so adding a fifth currency is a compile error everywhere
the mapping is missing.

Monobank statement currencies arrive as ISO 4217 numeric codes
(`980` = UAH, `840` = USD, `978` = EUR); map them to our currency
literal with `ts-pattern` at the sync boundary, never store the raw
numeric code.

## Net worth

Net worth is **assets-only** — liabilities and debt are out of scope
for this sub-project. It is the sum of every non-archived holding's
balance, each converted to the user's selected base currency (stored
in `Settings.baseCurrency`) using the latest cached `CurrencyRate`.
An archived account's or closed holding's balance is excluded.
