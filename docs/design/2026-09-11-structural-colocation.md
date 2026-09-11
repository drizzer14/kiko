# Structural co-location — folder-per-thing pass (2026-09-11)

Applies the user's standing "folder-per-thing" directive to the clear
flat-folder cases in `src/` domain-logic folders. A "thing" (a
logic unit / repo, together with its own test and any styles or
`.props.d.ts`) lives in its OWN folder named after it, not scattered
as loose siblings in a shared flat folder.

## Convention

Matches the existing precedent (`src/crypto-sync/binance/`,
`src/crypto-sync/btc-wallet/`, `src/calendar/*`, `src/auth/lock-gate/`,
the design-system component folders): each grouped unit folder holds
its source + test (+ styles / `.d.ts`) plus a one-line `index.ts`
barrel so existing import specifiers keep resolving unchanged.

- Logic unit (named exports): `export * from './<unit>';`
- Component (default export): `export { default } from './<unit>';`

No aggregating area-level barrel was created. Only each moved file's
own relative imports were rewritten for the new folder depth; file
contents are otherwise byte-identical. `@kiko/*` alias imports and
external importers were untouched (they resolve through the new
barrel).

## Already done in c677212 (shared screen components)

- `card-context-menu`, `edit-header-button`, `icon-editor` moved into
  `src/design-system/components/`.
- `grid-interaction` moved into `src/design-system/grid-interaction/`.
- 9 importers + 3 comments rewritten.

## Co-located in this pass

- `src/statistics/` — 11 units (type-breakdown, trend-filter,
  transfer-exclusion, reconcile-bond-funding, net-worth-series,
  internal-transfers, exchange-exclusion, category-trend,
  category-breakdown, buckets, account-contribution).
  `holding-value-at.ts` left loose (single source, no test).
- `src/rates/` — 13 units (rates.repo, rates-refresh,
  rate-history.repo, net-worth-view, nbu-history, monobank-rates,
  history-entry, history-backfill, currency-totals, conversion,
  coingecko, coingecko-history, active-holdings).
- `src/holdings/` — 12 units (tax, interest, holdings.repo,
  holding-value, holding-type, holding-metadata, exchange-destination,
  exchange-convert, entity-symbols, entity-colors, derived-entries,
  deletable).
- `src/transactions/` — 6 units (transactions.repo, transaction-span,
  row-description, normalize-name, exchange-description,
  default-description).
- `src/currency/` — 6 units (parse, money, format, currency,
  currency-symbols, compact).
- `src/sync/` — 6 units (use-sync, use-sync-all, use-crypto-sync,
  use-auto-sync, sync-jobs, settle-limited).
- `src/monobank/` — 9 units (token, throttle, sync, sync-status,
  monobank.client, migrate-credential, mcc-category, disconnect,
  currency-code). `__fixtures__/` and `monobank.types.d.ts`
  (type-augmentation) kept flat at the area root.
- `src/crypto-sync/` — 4 top-level units (sync, run-crypto-sync,
  provider, disconnect). `resync-request.ts` left loose (single
  source, no test). The already-grouped `binance/` and `btc-wallet/`
  subfolders untouched.
- `src/categories/` — 3 units (category-overrides.repo,
  category-display, categories.repo).
- `src/migration/` — 4 units: `migrations.gate` (source + styles +
  test, default-export barrel) plus migration-bridge,
  migrate-legacy-db, import-from-old-app. `migration-files.ts` and
  `migration-constants.ts` left loose (single source, no test).
- `src/i18n/` — 4 hook/helper units (use-sync-language-with-settings,
  device-language [both test variants kept with the source],
  default-category-title, active-locale). `index.ts` (module entry
  point), `i18next.d.ts` (type augmentation), and `locales/` kept flat
  at the area root.

## Loose single-file exceptions (kept flat, not moved)

`src/statistics/holding-value-at.ts`,
`src/crypto-sync/resync-request.ts`,
`src/migration/migration-files.ts`,
`src/migration/migration-constants.ts` — each is a single source file
with no test/styles; a one-file folder adds nothing.

## Skipped areas (reason)

- `src/navigation/` — deliberate route-registry convention of parallel
  `*.stack.tsx` siblings; grouping is disruptive, not clearly
  beneficial. DEFERRED.
- `src/db/` — `schema.ts` has five separate test files (a
  many-tests-to-one-source fan-out, not a 1:1 pair); the folder
  boundary/naming is ambiguous. DEFERRED.
- `src/test-support/` — cross-cutting shared test helpers with no
  owning test; they belong flat.
- `src/dates/` — only 4 files; low-value/bikeshed grouping. DEFERRED
  as low priority.
- `src/design-system/` top-level primitives (entity-tint, palette,
  theme, unistyles, disabled-field-style, disabled-opacity) — app-wide
  singletons; folder-per-file here is a bigger design-system call.
  DEFERRED.

## Deferred by decision

An `entity/` grouping (entity-tint, entity-colors, entity-symbols,
entity-header-icon, entity-amount-header) was NOT created — DEFERRED.
Note `entity-colors`/`entity-symbols` still got their own folders
WITHIN `src/holdings/` per the holdings area above; that is not the
deferred cross-cutting `entity/` move.
