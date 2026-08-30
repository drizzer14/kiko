---
name: pff-architecture
description: Invoke whenever you touch storage, a repository, a screen's data hook, migrations, or the Monobank sync pipeline. Read before writing any op-sqlite/Drizzle code, any db.transaction call, any useLiveQuery consumer, or any code that reads the Monobank API or the Keychain token.
---

# PFF architecture

Source of truth: `docs/superpowers/specs/2026-08-30-pff-foundation-design.md`
("Storage and migrations", "Data flow — reactive queries", "Data
collection" sections). This skill summarizes the settled contract.

## Storage: op-sqlite + Drizzle

- `@op-engineering/op-sqlite` (^18.1.4) is the SQLite engine.
  `drizzle-orm` (^0.45.2) is the ORM on top of it: open the database
  with op-sqlite's `open()`, wrap it with `drizzle(opsqliteDb)`.
- The schema is defined in TypeScript (Drizzle schema, not raw SQL).
- Generate migrations with `drizzle-kit` using `driver: 'expo'` —
  this is the correct driver value for op-sqlite migration
  generation, despite the name.
- Bundle migrations into the app and apply them on launch with
  `drizzle-orm/op-sqlite/migrator` + `useMigrations`. Show a loading
  state until migrations succeed, and an error state if they fail —
  never proceed past a failed migration.

## Hard rule: every write goes through `db.transaction()`

op-sqlite's reactive queries (`db.reactiveExecute`) fire their
callback **only** when the write that changed the underlying table
ran inside a `db.transaction()` call. A write issued outside a
transaction is invisible to every live query watching that table —
the UI will silently go stale.

This is non-negotiable: **every** insert, update, and delete —
including a single-statement one — must be wrapped in
`db.transaction()`. There is no exception for "it's just one
statement."

## The `useLiveQuery` pattern

Drizzle's own `useLiveQuery` hook only supports `expo-sqlite`, not
`op-sqlite`, so this project has a custom hook built directly on
op-sqlite's reactive primitive:

```ts
useLiveQuery(drizzleQuery, tables)
```

It:

1. Calls `drizzleQuery.toSQL()` to get `{ sql, params }`.
2. Registers `db.reactiveExecute({ query, arguments, fireOn: tables,
   callback })`.
3. Maps the raw rows back to the typed result shape Drizzle would
   have produced.
4. Unsubscribes on unmount.

`tables` is the list of table names the query depends on (matching
`fireOn`) — get this list wrong and the query either never refreshes
or refreshes on unrelated writes.

## Repository module shape

One functional module per entity: `accountsRepo`, `holdingsRepo`,
`transactionsRepo`, `ratesRepo`, `settingsRepo`. A repository is a
plain module of exported functions, not a class.

- **Read functions return a Drizzle query builder**, not already-
  executed data — the caller passes that query straight into
  `useLiveQuery`. Do not `await` or `.execute()` a read function's
  result inside the repository; that would make it non-reactive.
- **Write functions perform the actual transactional write** and
  return once it's durable — every write function body is (or calls
  into) a `db.transaction()` call, per the hard rule above.
- Repositories are the only place raw Drizzle rows are converted
  to/from domain types (e.g. `balanceMinorUnits` -> `Money`,
  see `pff-domain`).

## Monobank sync pipeline (functional)

The sync pipeline is deliberately functional, not OOP — see
`pff-code-style` for when each style applies.

1. Read the personal token from the iOS Keychain via
   `react-native-keychain`. **Never** store the token in the
   database or write it to a log — Settings holds `baseCurrency` and
   `lastSyncAt` only, not the token.
2. `GET /personal/client-info` with header `X-Token`; map each bank
   account and jar to a Holding under one `monobank` Account.
3. `GET /personal/statement/{account}/{from}/{to}` per holding;
   import each item as a Transaction, deduplicated by `externalId`
   (the Monobank statement id). Respect the API's constraints: a
   31-day-max statement window, 1 request per 60 seconds, and at
   most 500 items per response — page the window and throttle
   requests accordingly.
4. Map Monobank's ISO 4217 numeric currency codes to the app's
   currency literal with `ts-pattern` (see `pff-domain`). Amounts
   and balances already arrive in integer minor units — no float
   conversion needed there.
5. Compose the pipeline's transform steps with `fnts` (see
   `pff-code-style`).

Confirm exact Monobank field names against the live API during
implementation — the spec's shape is a best-effort description, not
a verified schema.

## Price data

- Fiat cross rates: `GET /bank/currency` (public Monobank endpoint,
  cached upstream about every 5 minutes).
- BTC price: CoinGecko free API, quoted in USD; derive other pairs
  from it.
- Store results in `CurrencyRate`. Refresh on sync, throttled to
  respect each provider's own cache window — do not poll faster than
  the upstream cache refreshes.
