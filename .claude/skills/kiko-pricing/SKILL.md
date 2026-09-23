---
name: kiko-pricing
description: Invoke whenever you touch src/prices/** or src/rates/**, or work on a currency rate, a price point, NBU, Monobank currency, CoinGecko, a priced holding, or a property_item/metal value. Read before writing a rate-refresh call, a price_points write, or a PriceBook consumer.
---

# Kiko pricing

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Data collection" section) plus this branch's own T11/T17 work. This
skill covers both currency-rate resolution and the separate
non-currency `price_points` store.

## Currency-rate fallback chain

- Fiat cross rates, live: Monobank's `GET /bank/currency` (public,
  cert-pinned host, cached upstream about every 5 minutes) is the
  PREFERRED source, tried with a bounded retry. Only if that fails
  entirely does `src/rates/rates-refresh/rates-refresh.ts` fall back
  to NBU's current-rate feed (`src/rates/nbu-rates/nbu-rates.ts`,
  `bank.gov.ua`, deliberately UNPINNED, fewer currencies than
  Monobank). It's a sequential fallback, not a second concurrent
  source — only one provider's rows are composed and written per
  refresh; both failing writes nothing.
- Fiat cross rates, offline floor: a bundled STATIC seed,
  `src/rates/fiat-rate-seed/fiat-rate-seed.ts`, covers all 107 fiat
  currencies vs UAH from a Monobank snapshot (see the file for the
  capture date — it is a real, fixed date, not "current"). In
  `buildRateTable` (`src/rates/net-worth-view/net-worth-view.ts`) the
  seed is overlaid by live DB rows — `{ ...FIAT_RATE_SEED_TABLE,
  ...liveRows }` — so a live rate always wins per pair and the seed
  only fills a gap. This is a read-time overlay, never written to the
  DB, and is why a non-UAH fiat holding values correctly immediately,
  even fully offline on a fresh install before any live refresh has
  ever run. Crypto has no seed entry — see below.
- BTC price: CoinGecko free API, quoted in USD; derive other pairs
  from it. No offline seed for crypto; an unrated crypto holding is
  excluded until a live CoinGecko price lands.
- Store live results in `CurrencyRate`. Refresh on sync, throttled to
  respect each provider's own cache window — do not poll faster than
  the upstream cache refreshes.

## Rate history

`src/rates/rate-history-repo/rate-history.repo.ts` keeps
`currencyRateHistory`, one row per `(base, quote, day)`, separate from
the latest-only `CurrencyRate` cache — this is what backs the
historical net-worth chart. `rateHistoryRepo.upsertMany` chunks at
2000 rows (10000 bound params, under SQLite's
`SQLITE_MAX_VARIABLE_NUMBER`) and upserts on the `(base, quote, day)`
unique index. Two read helpers build a flat `RateTable` for a given
`day` from a row set: `rateTableAt` resolves each pair to its NEAREST
row AT OR BEFORE `day` (carry-forward across a gap, e.g. a Friday rate
covers the weekend), omitting a pair with no row at or before `day`;
`earliestRateTable` instead takes each pair's EARLIEST stored row, so
a bucket before a pair's first history row still prices that holding
(flat at the oldest known rate) instead of dropping it from the
leading buckets. `price_points`' own `priceAt` (below) mirrors this
same nearest-at-or-before / earliest-fallback shape.

## `price_points` table and `PriceBook`

`price_points` (migration `0035`) is a SEPARATE, non-currency price
store — it does not touch `CurrencyRate`/`currencyRateHistory` at all.
It prices one instrument (a share ticker, a metal, or one specific
holding priced directly — the `share:`/`metal:`/`holding:` namespaces
in `src/prices/instrument/`) per `(instrument, day)` row:

- `instrument` is a free-text key, never an FK, built by one of three
  namespacing functions — `share:<symbol>`, `metal:<metal>`,
  `holding:<holdingId>` — so the three kinds can never collide in one
  table. `holding:<id>` is for a thing priced directly (e.g. a
  property), not through a market symbol.
- `day` is a normalized UTC-midnight epoch value of the price's LOCAL
  calendar date — same convention as `currencyRateHistory.day`. Read
  via `dayKeyOf` (`src/prices/price-book/`), which reads the
  DEVICE-LOCAL `Date` getters (not the UTC ones) so a Kyiv-local day
  keys correctly across a DST transition.
- `price` is a decimal STRING (never a float), `currency` is the
  price's own currency, `source` is `manual | nbu | eodhd` — read
  `src/db/schema.ts` directly for the enum rather than trusting this
  list if it drifts.

`pricePointsRepo` (`src/prices/price-points-repo/`) is the repository:
`allQuery` (hand to `useLiveQuery`), `upsertMany` (chunked at 2000
rows to stay under SQLite's bound-parameter limit, upserts on the
`(instrument, day)` unique index — a re-fetched price overwrites in
place), `removeInstrument`.

`PriceBook` (`src/prices/price-book/`) groups the flat row set by
`instrument`, sorted `day` ascending. `priceAt(book, instrument,
instant)` is a CARRY-FORWARD lookup: the nearest point at or before
`instant`'s local day, falling back to the EARLIEST point when every
stored point is later than the requested day (mirrors
`rateTableAt`/`earliestRateTable` above). `usePriceBook()`
(`src/prices/use-price-book/`) wraps `allQuery` in
`useLiveQuery(..., ['price_points'])` and is the reactive entry point
every value reader (`holdingValueBreakdown`, `holdingValueAt`,
`buildNetWorthSeries`, `netWorth`, `guardedNetWorth`/
`guardedBreakdown`, `sumByCurrency`, `buildTypeBreakdown`,
`buildAccountContribution`) and every screen that renders a value
(`home`, `accounts`, `account-detail` + its `HoldingCard`,
`holding-detail`, `statistics`) threads through, same pattern as the
existing rate-table threading; `EMPTY_PRICE_BOOK` is the default for a
caller with none available (e.g. a test fixture), so the default
resolves to "no price," never a crash. A snapshot export/restore
(`src/data-transfer/snapshot/`) includes `pricePoints` alongside the
other tables; a legacy export with no `pricePoints` key restores with
an EMPTY `price_points` table (`?? []` defensive read in
`restore-snapshot.ts`), never an error.

## Priced holdings

A **priced holding type** (`isPricedHoldingType`, `pricedHoldingTypes`
— `src/holdings/priced-value/`; `property_item` and `metal` are
members as of T17, more land later — read that file rather than
trusting a member list restated here) is valued through the
`PriceBook`, not through an interest engine or its raw stored balance.
`quantityAt(lots, instant)` and `costBasisMinorAt(lots, instant)`
(`src/holdings/lots/`) read the holding's `metadata.lots` array — one
entry per buy/sell, `{ day, quantityDelta, costMinorUnits }` — to
derive the quantity and cost basis held as of an instant; `quantityAt`
never returns below `"0"`. `pricedValueMinor(holding, book, instant)`
(`src/holdings/priced-value/`) branches on `holding.type`:

- `property_item` multiplies `quantityAt(...)` by the price point for
  the holding's OWN `holding:<id>` instrument (`multiplyToMinorUnits`,
  the BigInt-backed decimal helper in `src/currency/decimal/` — never
  a float multiply).
- `metal` multiplies `quantityAt(...)` by `purity` by the price point
  for the metal's SHARED `metal:<XAU|XAG|XPT|XPD>` instrument — NOT a
  per-holding instrument; every holding of the same metal reads the
  same NBU points. `unit === 'g'` additionally divides by 31.1034768
  (one troy ounce in grams — NBU quotes precious metals per troy
  ounce). The value is hard-fixed to UAH regardless of
  `holding.currency`, since NBU quotes precious metals only in UAH —
  the metal create-form is expected to always create a `metal` holding
  with `currency: 'UAH'` to match; this is a documented assumption,
  not enforced by code.

Either branch returns `null` when the holding has no `id`, no valid
`lots`/metal metadata, or no stored price point yet.

**A priced holding with no price point values at its lots' cost basis,
never 0** — `holdingValueBreakdown`'s `pricedBreakdown` branch
(`src/holdings/holding-value/`) falls back to `costBasisMinorAt`
whenever `pricedValueMinor` returns `null`. `pricedLotsOf(holding)`
picks `asMetalMeta` vs `asPropertyMeta` before this shared cost-basis
logic runs, so a `metal` holding's differently-shaped metadata never
silently mis-parses into the flat stored balance. For a priced type,
`gross = net =` the resolved value and `principalOrCost` is ALWAYS the
cost basis (even when gross also equals the cost basis on the
no-price-point path) — the holding-detail breakdown needs cost basis
available separately to show a live gain/loss. `interest`/`tax` are
always zero: a priced holding never accrues interest or withholds tax.

**A priced holding writes no ledger (`Transaction`) rows for its
revaluations.** Its lots array is the only source of quantity/cost-basis
history; a price change moves its VALUE without ever touching its
`balanceMinorUnits` or emitting a transaction. Consequently
`holdingValueAt` (`src/statistics/holding-value-at.ts`) cannot
back-derive a priced holding's historical value from `currentBalance -
sum(transactions)` the way it does for a ledger-backed holding — it
branches on `isLedgerlessHoldingType` and instead calls
`holdingValueBreakdown` (with the caller's `PriceBook`) directly for
that instant. This is why the net-worth series is FLAT for a priced
holding across every bucket with no matching ledger entries: the
series reflects the priced value at each bucket's instant, not a
ledger reconstruction.

**The optional `id` field pattern.** `ValuableHolding`
(`src/holdings/holding-value/`) and `PricedHolding`
(`src/holdings/priced-value/`) both declare `id` as OPTIONAL
(`{ id?: HoldingRow['id'] }`) on their `Pick<HoldingRow, ...>` read
types, not required — the standing convention for threading an
identity-dependent capability (here: resolving a `holding:<id>` or
`metal:<...>` instrument key) through a `Pick`-based read type without
forcing every existing literal test fixture across the codebase to
gain the field just to type-check. A holding value with no `id` (a
synthetic fixture, or any caller that only has the `Pick`ed fields)
simply cannot resolve its own instrument key, so `pricedValueMinor`
treats it identically to "no stored price point yet" (falls back to
cost basis) — never a runtime error. Apply the same optional-`id`-on-a-
`Pick` pattern the next time a capability needs a holding's identity
threaded through one of these narrowed read types.

## Recording a lot: LotForm and the sell cost rule

`src/screens/forms/lot-form/lot-form.screen.tsx` (T18) records one
buy/sell lot against a `isLotFormHoldingType` holding (`metal` only —
see `kiko-domain`'s "Sync-only holding types" section for that
grouping), reached from holding-detail's `addLot` footer action. It
writes NO `Transaction` row and NO `price_points` row for either
direction — a buy/sell only appends to `holding.metadata.lots` via
`holdingsRepo.update`, since the holding is ledgerless and priced off
the shared `metal:<XAU|...>` instrument, not a per-holding series.

**Sell cost rule: proportional average cost, not FIFO/LIFO.** On a
sell, the removed cost basis is `costBasisBeforeMajor * quantitySold /
heldQuantity` — `costBasisMinorAt(existingLots, date)` shifted from
minor to major (`shiftDecimal`), then run through
`multiplyToMinorUnits([costBasisBeforeMajor, quantity], currency,
heldQuantity)` (the BigInt-backed decimal helper, `src/currency/decimal/`).
Stored as a NEGATIVE `costMinorUnits` on the new lot entry, mirroring
`quantityDelta`'s own negative-on-sale sign (`lots.ts`'s documented
contract). A sell whose quantity exceeds `quantityAt(lots, date)` is
rejected client-side before save (the `sellExceeds` check) and never
written.

A metal holding's lots also surface as ledger-display rows: `metalEntries`
(`src/holdings/derived-entries/derived-entries.ts`) turns each lot into a
`DerivedEntry`, reusing the `'purchase'`/`'sale'` `DerivedEntryKind`s
previously bond-only (a buy lot → `'purchase'`, a sell lot →
`'sale'`) — do not assume those kinds mean "bond" when reading that file.

## Creating and clearing a priced holding's price series

`holdingsRepo.create`'s `NewHolding` type takes an optional
`firstPricePoint: { day, price }` (`src/holdings/repo/holdings.repo.ts`)
— when present, the SAME transaction that inserts the holding also
inserts one `manual` price point on that holding's own `holding:<id>`
instrument, so a freshly created priced holding never reads as "no
price yet" for even one render. `holdingsRepo.remove` does the
matching cleanup: it deletes the holding's own `holding:<id>` price
series inline on the same `tx` (not through
`pricePointsRepo.removeInstrument`, which would open its own
transaction), so a deleted holding never leaves an orphaned series
behind. This create/remove symmetry only applies to a holding's own
`holding:<id>` series — a `metal` holding shares its instrument with
every other holding of that metal, so removing one metal holding must
NOT clear `metal:<XAU|...>`'s series (nothing else consumes it yet as
of T17; watch for this the moment a metal-specific remove path is
added).

A `metal` holding's create payload is the one documented exception
that never sets `firstPricePoint`: `buildMetalCreatePayload`
(`holding-form.screen.tsx`) writes a zero stored balance and one lot,
but no manual price point — a metal's price comes from the shared
`metal:<XAU|XAG|XPT|XPD>` instrument, priced separately by
`refreshMetalPrices` (see "NBU metal prices — current and history
(T19)" below), never a per-holding one. `property_item`, by contrast,
always writes `firstPricePoint` equal to its entered cost. See
`holding-form.screen.tsx`'s own comment on the metal CREATE payload
for the current rationale.

`holding-detail.screen.tsx`'s `priceAsOfCaption` splits its "Value as
of" / "Price as of" caption on holding type: a `metal` holding reads
`latestPoint(priceBook, metalInstrument(meta.metal))` and renders the
`holdingDetail.priceAsOf` wording (distinct from the generic "Value as
of" caption every other priced holding type uses), since it is showing
the metal's shared market price, not a holding-specific value.

## `PricePointForm` — "Update value"

`src/screens/forms/price-point-form/price-point-form.screen.tsx`,
reached from `holding-detail.screen.tsx`'s `updateValue` footer action
(gated by `isPricedHoldingType`/`isLedgerlessHoldingType` — a priced
holding takes neither the `contribution` nor `transaction` footer
action, an entirely separate branch), writes a new `manual` price
point through `pricePointsRepo.upsertMany` directly on the holding's
own `holding:<id>` instrument — it does not go through
`holdingsRepo`. It mirrors `contribution-form`'s shape: a grouped-
amount `TextField` plus the shared `DateField`, defaulting to today.

## Instrument namespaces

`src/prices/instrument/` exports the three namespacing functions —
`shareInstrument(symbol)`, `metalInstrument(metal)`,
`holdingInstrument(holdingId)` — that build the `share:`/`metal:`/
`holding:` prefixed keys used throughout this skill. Never hand-build
one of these strings inline; always go through the namespacing
function so a format change only needs to happen in one place.

## Bank metal allow-list

`bankCatalog` entries (`src/bank-sync/bank-catalog/`) carry
`sellsMetals: boolean` (`true` only for PrivatBank as of T17 — read
the catalog for the current set) and `bankSellsMetals(bankId)`,
defaulting to `false` for an unset/unrecognized `bankId` —
deliberately the OPPOSITE default from `isConnectableBank`'s
permissive `true`, since an unknown bank must not silently unlock the
allow-listed `metal` holding type. Guideline 5.6: `sellsMetals` is
always-rendered data on the fully-rendered static catalog array, never
a visibility flag — every bank row always renders in the bank picker;
only the CREATABLE holding-type set differs. `metal` is allow-listed
rather than sync-gated (unlike the `syncOnlyHoldingTypes` rule in
`kiko-domain`): `creatableHoldingTypesForAccount(kind, isSynced,
bankId?)` gates `metal` on `bankSellsMetals(bankId)` ONLY when `kind
=== 'bank'`; a standalone `metals`-kind account is never gated (no
bank to check).

## Refresh throttles

Rate and price refresh runs on sync, throttled to respect each
provider's own cache window (see "Currency-rate fallback chain"
above) — do not poll faster than the upstream cache refreshes. No
dedicated quota-guard or once-per-day scheduler exists yet as of T17;
do not assume one when reading a refresh call site.

## NBU metal prices — current and history (T19)

`src/prices/nbu-metals/` is the metals client, mirroring `nbu-rates.ts`/
`nbu-history.ts`'s pattern (fetch + `guard`-based validation + recorded
JSON fixtures, no network in tests) but living under `src/prices/`
rather than `src/rates/`, since it feeds `price_points`, not
`CurrencyRate`. Both functions read `bank.gov.ua` — no new host, no
new pinning (kiko-compliance: this host stays keyless and unpinned).

- `fetchNbuMetalsCurrent(fetchImpl)` reads the SAME current-exchange
  URL `nbu-rates.ts`'s `EXCHANGE_ENDPOINT` reads for fiat — a live
  probe (2026-09-24) confirmed XAU/XAG/XPT/XPD rows ride in that same
  payload, with no `units` divisor ever observed on a metal row — so
  no second "current" endpoint is needed. Returns `{ metal, price }[]`
  (a decimal string in UAH, via `decimalFromJsonNumber`); it carries
  no day of its own — the caller stamps "today"'s local day on it.
- `fetchNbuMetalHistory(metal, start, end, fetchImpl)` reads the SAME
  range URL `nbu-history.ts`'s `RANGE_ENDPOINT` reads for USD/EUR, one
  call per metal (`valcode=xau` etc., lowercased) — the same live
  probe confirmed the range endpoint returns one row PER DAY for a
  metal (weekend/holiday days carry forward the last banking day's
  rate), so the range path applies rather than a weekly-sample
  fallback. Returns `{ metal, day, price }[]`.

`src/prices/metal-refresh/refreshMetalPrices({ now, fetchImpl, ... })`
is the scheduler, called next to `refreshRates` from both
`useAutoSync` and `useSyncAll` (failures swallowed the same way, via
the SAME `either(...)` wrapper each hook already uses around
`refreshRates`). It refreshes ONLY currently held metals — scanned
from every `metal` holding's `asMetalMeta(...).metal`, never a metal
nobody owns — at most once per LOCAL day per metal, resolved by
comparing `dayKeyOf(now())` against the latest stored `metal:<X>`
`price_points.day`. A metal with no stored point yet is backfilled in
ONE `fetchNbuMetalHistory` call spanning its earliest lot day (the
minimum `day` across that metal's holdings' `metadata.lots`) through
today; an already-priced metal instead takes a single SHARED
`fetchNbuMetalsCurrent` call for just today's point, regardless of how
many metals need it that run. Every row is accumulated in memory
first and written through exactly ONE final `pricePointsRepo.upsertMany`
call — a fetch failure for any held metal rejects before that call is
ever reached, so a failed run writes NOTHING (never a partial write),
matching the "fails closed" convention `kiko-pricing`'s "Refresh
throttles" section already documents for rates.

## Later (not built yet — do not invent detail)

An EODHD quotes client for shares, a request-quota guard, and a
scheduled backfill for non-metal instruments are planned for
T38-T41 but do not exist in code yet. When one of those lands, extend
this skill's "Currency-rate fallback chain" / "`price_points`"
sections rather than writing a new one — do not leave the future work
as a stale placeholder once it ships.
