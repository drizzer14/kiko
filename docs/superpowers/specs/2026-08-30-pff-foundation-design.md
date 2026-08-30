# PFF foundation — design spec

Date: 2026-08-30
Status: approved decisions, pending user review of this spec
Sub-project: 1 of 3 (Foundation). Later: statistics/views page; theme refinement.

## Purpose

PFF is a personal finance app. It holds one person's finances in one
place: bank statements, transactions, bonds, deposits, cash, and
crypto. This foundation sub-project delivers the domain data models,
local storage, manual data entry, Monobank synchronization, price
data collection, and simple screens to present the data.

Visual polish is out of scope. A minimal OLED dark theme starts here
and is refined later.

## Locked decisions

Each decision below was confirmed with the user during brainstorming.

| Area | Decision |
|---|---|
| Domain model | Three levels: Account -> Holding -> Transaction, plus CurrencyRate and Settings. |
| Persistence | Local-only, on-device. No backend. |
| Storage engine | op-sqlite + Drizzle ORM. |
| Data flow | Reactive live queries via a custom hook on op-sqlite reactive queries. |
| Base currency | User-selectable, stored in Settings. |
| Price data | Monobank public currency API for fiat; CoinGecko for BTC. |
| Styling | react-native-unistyles v3. |
| Sync trigger | Manual "Sync" button now. Background sync and webhooks later. |
| Monobank token | Stored in the iOS Keychain, never in the database or logs. |
| Currencies | BTC, USD, EUR, UAH. |

## Code style

- Follow the sibling `ovpn-ui` conventions, adapted to Biome (this
  repo uses Biome, not Prettier). Full names, no abbreviations.
  Uppercase abbreviations keep their case (JSON, IBAN, MCC, ID).
  `import type` for type-only imports; inline `type` for mixed.
- Functional style by default. Use OOP for data modeling and
  procedural where it fits better. Example: the `Money` value object
  is OOP; the sync pipeline and repositories are functional.
- Use `ts-pattern` for exhaustive mapping (currency codes, account
  and holding types, Monobank kinds).
- Use `fnts` (github.com/drizzer14/fnts) for functional composition
  in transform pipelines.

## Domain model

Data is modeled with OOP where it carries behavior; tables are plain
Drizzle schema.

### Money value object (OOP)

`Money` holds `{ currency, minorUnits }` as an immutable value object.

- `minorUnits` is an integer. Scale is per currency: BTC uses 8
  decimals (satoshis); USD, EUR, and UAH use 2 (cents).
- Methods: `add`, `subtract`, `negate`, `convert(rate, targetCurrency)`,
  `format(locale)`, `isZero`, comparison helpers.
- `add` and `subtract` reject a currency mismatch. Conversion is the
  only way to change currency.

Rationale: money must never be a float. Integer minor units plus a
known scale prevent rounding errors.

### Tables (Drizzle schema)

- **Account** — `id`, `name`, `kind` (`bank` | `cash` | `crypto` |
  `broker`), `institution` (nullable, e.g. `monobank`), `sortOrder`,
  `archivedAt` (nullable), `createdAt`.
- **Holding** — `id`, `accountId` (FK), `name`, `type` (`card` |
  `term_deposit` | `bond` | `cash` | `crypto_asset` | `jar`),
  `currency` (`BTC` | `USD` | `EUR` | `UAH`), `balanceMinorUnits`
  (integer), `metadata` (JSON: masked PAN, IBAN, deposit rate,
  maturity, Monobank account or jar id), `sortOrder`, `closedAt`
  (nullable), `createdAt`.
- **Transaction** — `id`, `holdingId` (FK), `amountMinorUnits`
  (signed integer), `time` (unix milliseconds), `description`,
  `category` (nullable), `mcc` (nullable), `comment` (nullable),
  `source` (`manual` | `monobank`), `externalId` (nullable, unique
  per source, for dedup), `createdAt`.
- **CurrencyRate** — `base`, `quote`, `rate` (stored as a scaled
  integer or text to avoid float drift), `source` (`monobank` |
  `coingecko`), `fetchedAt`. Cache of the latest known rates.
- **Settings** — single row: `baseCurrency`, `lastSyncAt` (nullable).
  The Monobank token is NOT here; it lives in the Keychain.

Net worth = sum of every non-archived holding's balance converted to
the base currency using the latest cached rates.

## Storage and migrations

- Open the database with op-sqlite `open()`; wrap with
  `drizzle(opsqliteDb)`.
- Define the schema in TypeScript.
- Generate migrations with drizzle-kit using `driver: 'expo'` (this
  is the correct driver value for op-sqlite migration generation).
- Bundle migrations and apply them on launch with
  `drizzle-orm/op-sqlite/migrator` + `useMigrations`. The app shows a
  loading state until migrations succeed and an error state on
  failure.

## Data flow — reactive queries

op-sqlite reactive queries fire only when a write runs inside a
transaction. Drizzle's own `useLiveQuery` supports expo-sqlite only,
not op-sqlite. Therefore:

- Build a `useLiveQuery(drizzleQuery, tables)` hook. It calls
  `drizzleQuery.toSQL()` to get `{ sql, params }`, registers
  `db.reactiveExecute({ query, arguments, fireOn: tables, callback })`,
  maps rows back to typed results, and unsubscribes on unmount.
- Route every write through `db.transaction()`. This is a hard rule;
  a write outside a transaction will not trigger reactive updates.
- Repository modules (functional) per entity: `accountsRepo`,
  `holdingsRepo`, `transactionsRepo`, `ratesRepo`, `settingsRepo`.
  Read functions return Drizzle query objects for `useLiveQuery`.
  Write functions perform transactional writes.

## Data collection

### Manual entry

Create and edit accounts, holdings, and transactions through forms. A
manual balance adjustment writes a `manual` transaction so history
stays consistent.

### Monobank synchronization (functional pipeline)

- Read the personal token from the iOS Keychain
  (react-native-keychain). Never store it in the database or logs.
- `GET /personal/client-info` with header `X-Token`. Map each bank
  account and jar to a Holding under a single `monobank` Account.
- `GET /personal/statement/{account}/{from}/{to}`. Import each item
  as a Transaction. Deduplicate by `externalId` (the Monobank
  statement id). The statement window is at most 31 days; the API
  limit is 1 request per 60 seconds; a response returns at most 500
  items. The sync respects the rate limit and pages the window.
- Map Monobank ISO 4217 numeric currency codes to our currency
  (980 = UAH, 840 = USD, 978 = EUR) with `ts-pattern`. Amounts and
  balances already arrive in integer minor units.
- Exact field names are confirmed against the live Monobank API
  during implementation.

### Price data

- Fiat rates: `GET /bank/currency` (public, cached about once per 5
  minutes). Provides UAH, USD, and EUR cross rates.
- BTC price: CoinGecko free API, in USD; derive the other pairs.
- Store results in CurrencyRate. Refresh on sync with a throttle so
  the app respects each provider's cache window.

## Screens (simple)

Navigation uses React Navigation native stack.

1. **Home / Net worth** — total net worth in the base currency; a
   list of accounts with converted subtotals; a "Sync" button; a
   base-currency switch.
2. **Account detail** — the holdings under the account with balances.
3. **Holding detail** — the transactions for the holding.
4. **Add / Edit forms** — account, holding, transaction.
5. **Settings** — base currency, Monobank token entry, trigger sync,
   last sync time.

Every screen reads through `useLiveQuery`, so it updates after a sync
or a manual edit without manual refresh.

## Design system (started here)

An OLED dark theme by the Habr method
(https://habr.com/ru/articles/499202/):

- True-black background (`#000000`) for OLED power saving.
- Desaturated accent colors; avoid fully saturated colors on black.
- Off-white primary text to cut halation; a dimmer secondary text.
- Elevation by translucent surface overlays, not by pure white.
- Distinct positive and negative money colors.

Tokens: color, spacing, typography, radii. Built as a
react-native-unistyles v3 theme. Minimal primitives now: `Screen`,
`Box`, `Text`, and a `MoneyText` that formats a `Money` value.

## Project skills to author first

Per the user's request, author these project skills before feature
code, so agents share the same rules:

- **domain** — the Account/Holding/Transaction model, `Money`, and
  currency rules.
- **architecture** — storage, the reactive `useLiveQuery` rule
  (writes in transactions), repositories, and the sync pipeline
  shape.
- **code-style** — functional-first with OOP for data models,
  `ts-pattern` and `fnts` usage, adapted `ovpn-ui` conventions under
  Biome.
- **design-system** — the OLED theme tokens and primitives.

## Out of scope (this sub-project)

- The statistics and views page (time ranges, filters, breakdowns).
- Background sync and Monobank webhooks.
- Any bank other than Monobank.
- Liabilities and debt (net worth is assets-only for now).
- Visual polish beyond the minimal theme.

## Testing

- Unit-test the `Money` value object, currency mapping, rate
  conversion, and statement dedup logic with Jest.
- Unit-test repository read and write functions against an in-memory
  or temporary SQLite database.
- Component-test the screens with React Native Testing Library.
- The Monobank client is tested against recorded fixtures, not the
  live API.

## Dependencies to add

- `@op-engineering/op-sqlite`, `drizzle-orm`, `drizzle-kit` (dev).
- `react-native-unistyles` (v3) and its native peer dependencies.
- `@react-navigation/native`, `@react-navigation/native-stack`, and
  peers (`react-native-screens`, `react-native-safe-area-context` —
  already present).
- `react-native-keychain`.
- `ts-pattern`, `fnts`.

All additions respect the 7-day dependency minimum age in `.npmrc`.
