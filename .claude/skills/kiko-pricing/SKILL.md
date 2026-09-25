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

### History backfill

The Statistics screen drives an incremental, non-blocking backfill of
`currency_rate_history` (`src/rates/history-backfill/history-backfill.ts`):
`planBackfillRun` decides whether a mount/focus needs a run for the
current transaction span, `missingDays` lists the still-uncovered UTC
days, and `runBackfill` fetches, composes and upserts them, returning
a `BackfillStatus`. A failed run must NEVER be reported as `'complete'`,
in either of the two ways it can fail: `runBackfill` settles NBU and
CoinGecko independently (`Promise.allSettled`) and resolves `'failed'`
itself (a Right value, `lastDay` unchanged) when BOTH reject for the
span — only one provider rejecting still composes from whichever
succeeded, the existing partial-history behavior; a rejected
`runBackfill` PROMISE (any other failure) is instead caught by the
screen's own catch arm into the same `'failed'` state. Either way the
screen resets its span ref, so `planBackfillRun` treats the span as
never-run and retries it on the next focus refresh, instead of leaving
the line permanently stuck on stale/partial history. The screen's own
effect must guard its async settle against a REAL unmount only (an
`isMounted`-style ref flipped inside its own unmount-only effect) — a
dep-change cleanup (a refocus advancing `now`, the same trigger that
drives the retry above) fires the identical cleanup lifecycle event and
must not drop a still-pending run's eventual settle, or the line gets
stuck on "loading" with no retry at all. A settle needs a SECOND,
independent guard against a run SUPERSEDED by a later one, not merely
against an unmount: an older transaction extending `spanStart` earlier
can start a new run before an already-in-flight run's own settle
arrives, and that stale settle must not overwrite the newer run's
state or reset its span ref out from under it. A run-token ref, bumped
only when the effect actually starts a run (never on a plain refocus,
which the span-ref check above already turns into a no-op) and
captured locally for that run's own `.then`, tells the two apart: a
settle applies only when its captured token still matches the ref's
current value.

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
`rateTableAt`/`earliestRateTable` above).

**`usePriceBook()` contract: `{ book, isLoading }`, not a bare
`PriceBook`.** (`src/prices/use-price-book/`) wraps `allQuery` in
`useLiveQuery(..., ['price_points'])` and threads that call's own
`isLoading` straight through — every consumer destructures `const {
book: priceBook } = usePriceBook();`, and a screen that gates its own
empty state additionally destructures `isLoading: priceBookLoading`
and folds it into its `useDataReady(...)` call (see
`kiko-architecture`'s useLiveQuery consumer rule). This is the
reactive entry point every value reader (`holdingValueBreakdown`,
`holdingValueAt`, `buildNetWorthSeries`, `netWorth`, `guardedNetWorth`/
`guardedBreakdown`, `sumByCurrency`, `buildTypeBreakdown`,
`buildAccountContribution`) and every screen that renders a value
(`home`, `accounts`, `account-detail` + its `HoldingCard`,
`holding-detail`, `statistics`, `holding-form`) threads through, same
pattern as the existing rate-table threading; `EMPTY_PRICE_BOOK` is
the default for a caller with none available (e.g. a test fixture), so
the default resolves to "no price," never a crash. A snapshot
export/restore (`src/data-transfer/snapshot/`) includes `pricePoints`
alongside the other tables; a legacy export with no `pricePoints` key
restores with an EMPTY `price_points` table (`?? []` defensive read in
`restore-snapshot.ts`), never an error.

Any new consumer of `priceAt` (or a similarly-shaped "nearest point in
time" helper) must explicitly re-check whether the helper's fallback
direction matches the new caller's own invariant. `priceAt`'s
earliest-point fallback exists for "no earlier point yet" callers; a
caller that requires a correction to never anchor a query for BEFORE
that correction's own date needs its own guard, since the shared
fallback will otherwise hand back a later point to an earlier query.
This bit `loanOutstandingMinorAt`, which anchored on ANY stored
correction point, including one dated after the queried instant (T26
review I1, fixed `9cf5791`→`6901d27`) — read
`loan-schedule.ts`'s `loanOutstandingMinorAt` for the fix shape.

## Priced holdings

A **priced holding type** — `property_item` and `metal` are members
today, more land later — is one whose own descriptor's `priced` spec
is non-null; read the flag-table test in `holding-descriptors.test.ts`
rather than trusting a member list restated here. It is valued through
the `PriceBook`, not through an interest engine or its raw stored
balance. `quantityAt(lots, instant)` and `costBasisMinorAt(lots,
instant)` (`src/holdings/lots/`) read the holding's `metadata.lots`
array — one entry per buy/sell, `{ day, quantityDelta, costMinorUnits
}` — to derive the quantity and cost basis held as of an instant;
`quantityAt` never returns below `"0"`. Each priced type's own
descriptor (`src/holdings/holding-descriptor/property-item/`,
`.../metal/`) is built through `pricedDescriptor`
(`src/holdings/holding-descriptor/priced-parts/`), which wires the
type's own `priced` spec to its `breakdown`. `PricedHolding`
(`src/holdings/priced-value/`) always carries an `id` — every real
caller already has a full row (see "`id` is required on the value
read types" below) — but only `property_item`'s `value` reads it;
`metal`'s reads a SHARED instrument and never touches `holding.id` at
all. Each spec's `value` returns a `Money`, not a bare number, in the
spec's OWN currency — not necessarily `holding.currency`:

- `property_item` multiplies `quantityAt(...)` by the price point for
  the holding's OWN `holding:<id>` instrument (`multiplyToMinorUnits`,
  the BigInt-backed decimal helper in `src/currency/decimal/` — never
  a float multiply), returned as Money in the HOLDING's currency (a
  per-holding manual revaluation, always entered in that currency).
- `metal` multiplies `quantityAt(...)` by `purity` by the price point
  for the metal's SHARED `metal:<XAU|XAG|XPT|XPD>` instrument — NOT a
  per-holding instrument; every holding of the same metal reads the
  same NBU points, so `metal`'s `value` never reads `holding.id` at
  all. `unit === 'g'` additionally divides by 31.1034768 (one troy
  ounce in grams — NBU quotes precious metals per troy ounce). The
  returned Money carries the PRICE POINT ROW's own stored `currency`
  (always UAH in practice — NBU quotes precious metals only in UAH),
  NOT `holding.currency`; the two can disagree for an invalid/restore-only
  row, and `pricedBreakdown` below is the one place that decides
  whether such a mismatch is safe to surface.

Either descriptor's `value` returns `null` when the holding has no
`lots`/metal metadata or no stored price point yet. A `loan` holding
(not priced, `priced: null`) reads its own `holding:<id>`
manual-correction series the same way `property_item` does —
`loan.descriptor.ts`'s `loanBreakdown` calls
`loanOutstandingMinorAt(meta, holding.id, book, now)` directly, since
`ValuableHolding` guarantees an `id` too.

**A priced holding with no price point — or an invalid one — values at
its lots' cost basis, never 0** — `pricedDescriptor(spec, rest)`
(`src/holdings/holding-descriptor/priced-parts/`), which every priced
type's own descriptor is built through, wires its `breakdown` to that
SAME `spec` internally (the private `pricedBreakdown` helper), so a
per-type file can never pass a `priced` spec its `breakdown` reads a
different one from. That shared breakdown falls back to
`costBasisMinorAt` whenever `pricedValueOrNull` returns `null`, OR when
the returned Money's own `currency` disagrees with `holding.currency`
— a metal row is priced in the price point's stored currency (always
UAH), so an invalid/restore-only row whose OWN `currency` column reads
something else (e.g. `USD`) would otherwise have that UAH amount
displayed under the wrong currency label, not converted. The guard
treats that exactly like "no price point yet": cost basis, in the
holding's own currency. `spec.lots(metadata)` — each descriptor's own
`asMetalMeta`/`asPropertyMeta` parse — runs before this shared
cost-basis logic, so a `metal` holding's differently-shaped metadata
never silently mis-parses into the flat stored balance. For a priced
type,
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

**`id` is required on the value read types.** `ValuableHolding`
(`src/holdings/holding-value/`), `PricedHolding`
(`src/holdings/priced-value/`), `BreakdownHolding`
(`src/statistics/type-breakdown/`), and `ContributionHolding`
(`src/statistics/account-contribution/`) all include `id` as a plain
required member of their `Pick<HoldingRow, ...>` — every real caller
already has a full row. Neither `property_item`'s nor `loan`'s own
value reader guards a missing `id` any longer (both branches were dead
once the type required one) — `loan.descriptor.ts`'s `loanBreakdown`
calls `loanOutstandingMinorAt(meta, holding.id, book, now)` directly. A
test that needs to exercise a runtime shape looser than a real
`HoldingRow` (never a real stored row) builds an id-less object and
casts it back to the read type, rather than widening the type back to
optional.

## Recording a lot: LotForm and the sell cost rule

`src/screens/forms/lot-form/lot-form.screen.tsx` records one buy/sell
lot against a lot-form-eligible holding (`metal` only — see
`holdingDetailSpecs`, `holding-detail-spec/`, and the paragraph
closing `kiko-domain`'s "Sync-only holding types are not manually
creatable" section for that single-type entry), reached from
holding-detail's `addLot` footer action. It writes NO `Transaction`
row and NO `price_points` row for either
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
(`src/holdings/holding-descriptor/metal/metal.descriptor.ts`, wired as
`metalDescriptor.entries`) turns each lot into a `DerivedEntry`, reusing the
`'purchase'`/`'sale'` `DerivedEntryKind`s previously bond-only (a buy lot →
`'purchase'`, a sell lot → `'sale'`) — do not assume those kinds mean "bond"
when reading that file.

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
(`src/screens/forms/holding-form/metal/use-metal-fields/`, R3 Phase C)
writes a zero stored balance and one lot, but no manual price point — a
metal's price comes from the shared `metal:<XAU|XAG|XPT|XPD>`
instrument, priced separately by `refreshMetalPrices` (see "NBU metal
prices — current and history (T19)" below), never a per-holding one.
`property_item`, by contrast, always writes `firstPricePoint` equal to
its entered cost. See that hook's own comment on the metal CREATE
payload for the current rationale.

**No "price as of" / "value as of" caption anywhere (user decision).** A priced holding's card and detail screen show only
its computed value, never a caption naming the date of the underlying
price point — this was removed from the holding card, the holding
detail Value header, and `property_item`'s (which has no feed — a
user-entered price) descriptor alike; `PricedSpec` carries no
`captionInstrument`/`captionKey` any longer. Behavior instead: each
refresh fetches today's price/rate for the held set only (see
kiko-architecture's gate rule); if today's value cannot be fetched,
the newest known value is used silently, with no caption surfacing
how stale it is, and the next refresh tries again.

## `PricePointForm` — "Update value"

`src/screens/forms/price-point-form/price-point-form.screen.tsx`,
reached from `holding-detail.screen.tsx`'s `updateValue` footer action
(`property_item`/`metal`'s own `holdingDetailSpecs` entry,
`holding-detail-spec/` — a priced holding takes neither the
`contribution` nor `transaction` footer action, an entirely separate
branch), writes a new `manual` price
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
`sellsMetals: boolean` (`true` for the banks that currently sell
metals — read the catalog (`bankCatalog`) for the current set, do not
trust a bank name or task tag copied here) and `bankSellsMetals(bankId)`,
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
is the scheduler, run CONCURRENTLY with `refreshRates` from both
`useAutoSync` and `useSyncAll` — `await Promise.allSettled([refreshRates(...),
refreshMetalPrices()])`, inside the SAME `either(...)` wrapper each
hook already used around `refreshRates` alone. The two share no data
dependency (`refreshMetalPrices` reads/writes `price_points` only,
`refreshRates` reads/writes `currency_rates` only), so running them
concurrently — rather than strictly sequentially, `refreshMetalPrices`
not even STARTING until `refreshRates` had settled — overlaps their
network + DB work and shrinks the app-open DB-read burst's wall-clock
span; see `kiko-architecture`'s "op-sqlite's ONE worker thread"
section for why that burst matters to every OTHER screen's own reads.
`allSettled`, not `all`: `Promise.all` settles (rejects) the instant
EITHER promise rejects, which would let the enclosing `either(...)`
call — and, in `useSyncAll`, the single-flight lock around the whole
fan-out — resolve/release while the OTHER promise keeps running
orphaned; a pull that then arrives sees the lock already free and
starts a SECOND fan-out (caught in review, not a shipped production bug).
`allSettled` never rejects, so a rejected step is swallowed exactly as
before by the same catch-all `either` — only the release TIMING
changes, not which failures are silent.
It refreshes ONLY currently held metals — scanned from every `metal`
holding's `asMetalMeta(...).metal`, never a metal nobody owns — at
most once per LOCAL day per metal, resolved by comparing
`dayKeyOf(now())` against the latest stored `metal:<X>`
`price_points.day`. This is already write-minimal, verified by test
rather than changed: **zero network calls and zero writes** when there
are no held metal holdings at all (the `earliestDays.size === 0` early
return, before either fetch function is ever referenced) and equally
when every held metal already has today's point stored (`planRefresh`
drops it from both the `backfill` and `current` work lists). A metal
with no stored point yet is backfilled in ONE `fetchNbuMetalHistory`
call spanning its earliest lot day (the minimum `day` across that
metal's holdings' `metadata.lots`) through today; an already-priced
metal instead takes a single SHARED `fetchNbuMetalsCurrent` call for
just today's point, regardless of how many metals need it that run.
Every row is accumulated in memory first and written through exactly
ONE final `pricePointsRepo.upsertMany` call — a fetch failure for any
held metal rejects before that call is ever reached, so a failed run
writes NOTHING (never a partial write), matching the "fails closed"
convention `kiko-pricing`'s "Refresh throttles" section already
documents for rates.

## Later (not built yet — do not invent detail)

An EODHD quotes client for shares, a request-quota guard, and a
scheduled backfill for non-metal instruments are planned for
T38-T41 but do not exist in code yet. When one of those lands, extend
this skill's "Currency-rate fallback chain" / "`price_points`"
sections rather than writing a new one — do not leave the future work
as a stale placeholder once it ships.
