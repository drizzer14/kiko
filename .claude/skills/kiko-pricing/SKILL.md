---
name: kiko-pricing
description: Invoke whenever you touch src/prices/** or src/rates/**, or work on a currency rate, a price point, NBU, Monobank currency, CoinGecko, a priced holding, or a property_item/metal value. Read before writing a rate-refresh call, a price_points write, or a PriceBook consumer.
---

# Kiko pricing

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Data collection" section). This
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
  ...liveRows }` — so a live UAH price always wins PER CURRENCY and the
  seed only fills a gap. This is a read-time overlay, never written to
  the DB, and is why a non-UAH fiat holding values correctly
  immediately, even fully offline on a fresh install before any live
  refresh has ever run. Crypto has no seed entry — see below.
- BTC price: CoinGecko free API, quoted in USD; derive other pairs
  from it. No offline seed for crypto; an unrated crypto holding is
  excluded until a live CoinGecko price lands. `rate(BTC, UAH) =
  rate(BTC, USD) x rate(USD, UAH)` from the SAME run's fiat anchor
  (Monobank buy rate, else NBU) — stored as ONE `BTC:UAH` row, always
  `source = 'coingecko'`; no fiat anchor that run (both fiat providers
  failed) means no crypto row at all, exactly as before, until a run
  with a fiat anchor lands. `ETH`/`USDT` derive the same way.
- Store live results in `CurrencyRate`, one `X:UAH` row per priced
  currency (`buildUahRows`, `rates-refresh.ts`) — never a cross row
  between two non-UAH currencies, since a cross rate resolves at READ
  TIME through `rateBetween` (below). A full Monobank sync writes
  ~109 rows (106 fiat + 3 crypto), not the ~11,990-row cross join a
  legacy write once composed (kiko-architecture's "Bulk insert" section).
  Refresh on sync, throttled to respect each provider's own cache
  window — do not poll faster than the upstream cache refreshes.
- **`RateTable` is a currency -> UAH-price map, resolved at READ TIME
  through the UAH pivot, not a stored cross-pair lookup.**
  `src/rates/conversion/conversion.ts`'s `RateTable =
  Partial<Record<Currency, number>>` holds each currency's price in
  ONE UAH (`rate(X, UAH)`); `UAH` itself is never a key — its own price
  is implicit `1`. Every A->B conversion resolves through
  `rateBetween(rates, from, to)`: the same currency is always `1`
  (even with nothing stored), otherwise `uahPer(from) / uahPer(to)`
  when BOTH legs resolve to a finite, positive UAH price, else
  `undefined` — `convert` and `canConvert` both read this ONE function
  rather than indexing a `${base}:${quote}` string key. `rateTableFromRows`
  (parsing a live DB row, or the seed) keeps only an `X:UAH` star row
  (`quote === 'UAH'`, `base !== 'UAH'`) and drops a stray cross row —
  a legacy `X:Y` pair, or `UAH` itself as `base` — unread rather than
  corrupting the table.

## Rate history

`src/rates/rate-history-repo/rate-history.repo.ts` keeps
`currencyRateHistory`, one row per `(base, quote, day)`, separate from
the latest-only `CurrencyRate` cache — this is what backs the
historical net-worth chart. `rateHistoryRepo.upsertMany` chunks at
2000 rows (10000 bound params, under SQLite's
`SQLITE_MAX_VARIABLE_NUMBER`) and upserts on the `(base, quote, day)`
unique index. Two read helpers build a per-currency `RateTable` for a
given `day` from a row set, reading only an `X:UAH` star row
(`quote === 'UAH'`, `base !== 'UAH'`) and ignoring a stray cross row
the same way `rateTableFromRows` does: `rateTableAt` resolves each
CURRENCY to its NEAREST row AT OR BEFORE `day` (carry-forward across a
gap, e.g. a Friday rate covers the weekend), omitting a currency with
no row at or before `day`; `earliestRateTable` instead takes each
currency's EARLIEST stored row, so a bucket before a currency's first
history row still prices that holding (flat at the oldest known rate)
instead of dropping it from the leading buckets. `price_points`' own
`priceAt` (below) mirrors this same nearest-at-or-before /
earliest-fallback shape.

`buildNetWorthSeries` (`net-worth-series.ts`) layers a THIRD, weaker
fallback under both of these: the bundled static `FIAT_RATE_SEED_TABLE`
(`fiat-rate-seed.ts`, covering all 107 fiat currencies). Precedence,
weakest first: `{ ...FIAT_RATE_SEED_TABLE, ...earliestRateTable(...),
...rateTableAt(...) }`, so a real historical row always wins over the
earliest-known row, which always wins over the flat seed — a fiat
currency the backfill has never fetched history for at all (it only
fetches the currencies actually used — see "History backfill" below)
still prices every past bucket at the seed's flat rate instead of
dropping the holding out entirely.

A legacy stored cross/inverse row (any row with `quote !== 'UAH'` or
`base === 'UAH'`) is removed both at upgrade and at restore: migration
`0042_uah_star_rates` deletes one from a live device (deriving a
missing star row first, from an inverse or a legacy cross pair, so no
currency loses its conversion), and
`restore-snapshot.ts`'s `withRatesNormalizedToUah` applies the
identical rule to a `.kiko` import — see kiko-architecture's
migrations section for the full derive-then-delete shape.

### History backfill

`fetchNbuHistory` (`nbu-history.ts`) is data-driven, not a hard-coded
USD/EUR pair: it takes the currency list to fetch (`valcode =
currency.toLowerCase()`) and settles each currency's own NBU range
request INDEPENDENTLY (an `either`-wrapped fetch per currency, spaced
by a `createRequestGate` at `NBU_HISTORY_REQUEST_INTERVAL_MS = 250`)
— one currency's HTTP failure lands in its own `failedCurrencies`
list and never discards another currency's already-fetched rows; the
function itself never rejects. `historyCurrencies()`
(`open-currencies-gate.ts`) decides WHICH fiat currencies are worth
fetching: the union of every held fiat currency (open AND closed — a
closed holding still needs its own past-bucket history, read via
`holdingsRepo.historyCurrenciesQuery()`, which has no
`closedAt`/archived-account filter) and the base currency, minus
`UAH` — but only when some held currency, fiat OR crypto, genuinely
differs from the base (nothing to convert otherwise, even though the
union would include the base); `USD` is then added unconditionally
whenever any crypto is held, as the crypto anchor.

`composeHistoryRows` writes one `X:UAH` row per priced currency per
day (every fiat currency NBU answered for, plus every held crypto) —
never a cross row between two non-UAH currencies, mirroring
`rates-refresh.ts`'s own `buildUahRows` but once per historical day
instead of once per live run. The compose list is DATA-DRIVEN, read
directly off whichever `X:UAH` anchor timelines are present in the
fetched entries — never a fixed currency list — so a newly used fiat
(GBP, PLN, any of the ~40 NBU quotes) composes automatically with no
code change. A gap in one provider's own series (NBU has no
weekend/holiday quote; CoinGecko prices every calendar day) no longer
stalls the OTHER currency's row: each currency's own `X:UAH` row
carries forward from ITS OWN nearest earlier anchor independently,
rather than a single stored cross pair carrying both legs forward as
one joint unit — coverage is a strict superset of the old cross-join
shape, never fewer converting buckets on a gap day.

A fiat currency NBU does not quote at all (NBU covers about 40 of the
107 supported currencies) answers with a fulfilled, EMPTY range —
never a rejection — so it is recorded in `knownEmptyCurrenciesThisRun`
like any other never-backfilled currency the provider answered empty
for, and `buildNetWorthSeries`' bundled `FIAT_RATE_SEED_TABLE` (below)
backs its value at a flat rate instead of ever dropping the holding.

The Statistics screen drives an incremental, non-blocking backfill of
`currency_rate_history` (`src/rates/history-backfill/history-backfill.ts`):
`planBackfillRun` decides whether a mount/focus needs a run for the
current span — from the earliest transaction OR the earliest priced-lot day
(`earliestLotDay` in `src/screens/statistics/statistics.screen.tsx`,
converted with `localMidnightOfDayKey`), whichever is older, to now; it
runs when transactions OR holdings exist — `missingDays` lists the still-uncovered UTC
days, and `runBackfill` fetches, composes and upserts them, returning
a `BackfillStatus`. A failed run must NEVER be reported as `'complete'`,
in either of the two ways it can fail: `runBackfill` settles NBU and
CoinGecko independently (`Promise.allSettled`) and resolves `'failed'`
itself (a Right value, `lastDay` unchanged) whenever an ATTEMPTED leg
rejected and the currencies it owns did not end up composed this run
(`unresolvedFailures`) — NOT only when BOTH legs reject. An earlier
version resolved `'failed'` only on a double rejection, so an
UNATTEMPTED leg (no crypto held at all)
resolved fulfilled and silently masked a fiat-only user's failed NBU
fetch as `'complete'`, and a crypto leg that itself succeeded still
composed zero rows whenever the SAME-run NBU leg failed (`composeHistoryRows`
needs the same-run `USD:UAH` anchor to price a crypto pair), so
"only one leg rejected" was never a safe signal that real progress
happened. Any rows that DID compose (e.g. fiat succeeded while crypto
failed) are still persisted before the `'failed'` return — a partial
success is never re-fetched on retry. A rejected `runBackfill` PROMISE
(any other failure) is instead caught by the screen's own catch arm
into the same `'failed'` state. Either way the screen resets its span
ref, so `planBackfillRun` treats the span as never-run and retries it
on the next focus refresh, instead of leaving the line permanently
stuck on stale/partial history.

The resume cursor itself is now PER CURRENCY, not one shared
max(day) across every stored row (`resolveResumeCursor`, fed by
`deriveLastBackfilledDayByCurrency(historyRows)` — the SAME
`historyRows` the screen already reads for `deriveLastBackfilledDay`,
so this needs no new query): it is the OLDEST last-backfilled day
among every currently-held currency (every fiat currency
`historyCurrencies()` reports, plus every held crypto), never the
newest. A single shared cursor let a
currency whose OWN leg kept failing hide behind a different
currency's success — once the shared max(day) reached today (from
whatever currency drove it there), `missingDays` reported nothing
missing at all, and the lagging currency's own gap (e.g. one held
coin's history stalled at an earlier day while NBU kept advancing to
today) was never re-derived, staying permanently gapped. Resuming from
the per-currency MINIMUM instead means the most-lagging held currency
always drives the window; the idempotent `(base, quote, day)` upsert
makes re-covering an already-current currency in that same wider
window free. A currency with no stored day at all still forces the
whole span (`null`), same as before, UNLESS `knownEmptyCurrencies`
already confirmed it has no data to give — see that set's own doc
comment in `history-backfill.ts` for the retry-vs-remembered-empty
distinction (a REJECTED leg or a per-coin `failedCurrencies` entry is
never recorded as known-empty; only a leg that fully answered yet
composed nothing for a NEVER-backfilled currency is).

The caller's own `lastBackfilledDay` OVERRIDES that per-currency
minimum with an explicit `null` — `resolveBackfillWindow` checks it
first. `planBackfillRun` passes exactly that null whenever an older
transaction or lot extends `spanStart` EARLIER than any prior run covered (see
below): the forward, per-currency minimum cannot see a gap that opens
BELOW the newest day every held currency already reached, so without
this override it would report nothing missing and silently skip the
newly-opened earlier span forever. A non-null caller value means no
such earlier extension happened, so the per-currency minimum decides
normally.

`planBackfillRun` takes a fourth argument, `currenciesChanged`, so a
NEW currency held mid-session (a GBP holding added while Statistics
stays mounted) re-runs the backfill WITHOUT a restart, even though
`spanStart` itself never moved: `statistics.screen.tsx` derives a
sorted `historyCurrencyKey` from every held holding's currency plus
the base, tracked in its own ref (`backfillRanForCurrencyKeyRef`)
alongside the existing span ref — set the same way, and RESTORED the
same way on a failed settle, so a retry after a rejected run still
sees the currency set as changed if it genuinely still is. Unlike the
earlier-extension case, a currency-set-only change resumes from the
ORDINARY incremental cursor (not `null`): `runBackfill`'s own
per-currency window already widens for the newly-held currency on its
own (it has no stored day at all, so `resolveResumeCursor` treats it
as maximally behind), so there is nothing this override needs to force.

The screen's own effect must guard its async settle against a REAL unmount only (an
`isMounted`-style ref flipped inside its own unmount-only effect) — a
dep-change cleanup (a refocus advancing `now`, the same trigger that
drives the retry above) fires the identical cleanup lifecycle event and
must not drop a still-pending run's eventual settle, or the line gets
stuck on "loading" with no retry at all. A settle needs a SECOND,
independent guard against a run SUPERSEDED by a later one, not merely
against an unmount: an older transaction or lot extending `spanStart` earlier
can start a new run before an already-in-flight run's own settle
arrives, and that stale settle must not overwrite the newer run's
state or reset its span ref out from under it. A run-token ref, bumped
only when the effect actually starts a run (never on a plain refocus,
which the span-ref check above already turns into a no-op) and
captured locally for that run's own `.then`, tells the two apart: a
settle applies only when its captured token still matches the ref's
current value.

The effect's own dependency array deliberately EXCLUDES
`lastBackfilledDay`/`lastBackfilledDayByCurrency`, even though the
effect body needs both: a run's own upsert — including one that
resolves `'failed'` overall but still persisted the currencies that DID
compose — changes `historyRows`, and with it these two
`historyRows`-derived values, on the VERY NEXT render. If either were a
dependency, that self-triggered re-render would re-enter the effect
immediately, at the SAME `now`, with the span ref just cleared by the
failure handler to allow a LATER retry — a permanent request loop for a
currency whose provider never answers, for as long as Statistics stays
mounted. The effect instead reads both through "latest" refs (`useRef`
assigned directly during render, the same pattern `categories.screen.tsx`'s
`orderedKeysRef` uses for a stable callback that still sees fresh data),
so only a dependency that genuinely changed for an unrelated reason
(`now` advancing on a real focus, `spanStart` moving) re-enters it — the
effect's own write echoing back through `historyRows` cannot.

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
  keys correctly across a DST transition. A day key is a UTC-midnight
  ENCODING of a local date, NOT an instant: never compare it with a real
  instant directly — convert it first with `localMidnightOfDayKey`
  (same module).
- `price` is a decimal STRING (never a float), `currency` is the
  price's own currency, `source` is `manual | nbu | eodhd` — read
  `src/db/schema.ts` directly for the enum rather than trusting this
  list if it drifts.

`pricePointsRepo` (`src/prices/price-points-repo/`) is the repository:
`allQuery` (hand to `useLiveQuery`), `upsertMany` (chunked at 2000
rows to stay under SQLite's bound-parameter limit, upserts on the
`(instrument, day)` unique index — a re-fetched price overwrites in
place), `removeInstrument`.

`PriceBook` (`src/prices/price-book/`) is `{ points, loanPayments }`:
every valuation input a holding row does not carry itself.
`points` groups the flat `price_points` row set by `instrument`, sorted
`day` ascending. `loanPayments` groups every linked loan payment
(`LoanLedgerPayment`: `loanHoldingId`, `time`, `amountMinorUnits`, and the
PAYER holding's `currency`) by loan id, sorted `time` ascending — the input
a loan's outstanding reads (`loanLedgerOutstandingMinorAt`, kiko-domain's
"Debts" section), so the card, detail, totals, statistics, and every
net-worth bucket read the same number with no new parameter.
`buildPriceBook(points, payments = [])` builds both; a payment row whose
link is null is skipped. `priceAt(book, instrument,
instant)` is a CARRY-FORWARD lookup: the nearest point at or before
`instant`'s local day, falling back to the EARLIEST point when every
stored point is later than the requested day (mirrors
`rateTableAt`/`earliestRateTable` above). It bisects the day-sorted series
(O(log n) per call); the test pins it against the old filter on every day.

**`usePriceBook()` contract: `{ book, isLoading }`, not a bare
`PriceBook`.** (`src/prices/use-price-book/`) wraps `allQuery` in
`useLiveQuery(..., ['price_points'])`, and
`transactionsRepo.loanLedgerPaymentsQuery()` (one read across every loan,
joined to the payer holding for its currency) in
`useLiveQuery(..., ['transactions', 'holdings'])`, gated by its third
argument `loanPaymentsEnabled` (kiko-architecture). Its `isLoading` is
true while either read is on its first load — every consumer destructures `const {
book: priceBook } = usePriceBook();`, and a screen that gates its own
empty state additionally destructures `isLoading: priceBookLoading`
and folds it into its `useDataReady(...)` call (see
`kiko-architecture`'s useLiveQuery consumer rule). A form that WRITES
from the book (`holding-form`'s edit `saveEdit`: a loan changed into
`'none'` stores its current outstanding as a manual point) destructures
`isLoading: isPriceBookLoading` and keeps Save disabled on an edit until
it is false — saved against a still-empty book, that point would be the
schedule-only value, forever. This is the
reactive entry point every value reader (`holdingValueBreakdown`,
`createHoldingValuer`, `buildNetWorthSeries`, `netWorth`, `guardedNetWorth`/
`guardedBreakdown`, `sumByCurrency`, `buildTypeBreakdown`,
`buildAccountContribution`) and every screen that renders a value
(`home`, `accounts`, `account-detail` + its `HoldingCard`,
`holding-detail`, `statistics`, `holding-form`) threads through, same
pattern as the existing rate-table threading; `EMPTY_PRICE_BOOK` is
the default for a caller with none available (e.g. a test fixture), so
the default resolves to "no price, no loan payment," never a crash. A
test builds a book through `buildPriceBook`/`EMPTY_PRICE_BOOK`, never a
bare `new Map()` (the book is an object, not a map). A snapshot
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
`loanOutstandingMinorAt` must guard against this: never anchor on a
stored correction point dated after the queried instant — read
`loan-schedule.ts`'s `loanOutstandingMinorAt` for the fix shape.

## Priced holdings

A **priced holding type** — `property_item`, `metal`, and `share` are
members today — is one whose own descriptor's `priced` spec
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
- `share` multiplies `quantityAt(...)` by the price point for its
  instrument, chosen by `ShareMeta.quoteSource`: the shared
  `shareInstrument(symbol)` for EODHD, the holding's OWN
  `holdingInstrument(holding.id)` for manual (read
  `src/holdings/holding-descriptor/share/share.descriptor.ts`). Money is
  in the point's currency. A share with no point yet (an EODHD share
  before its first refresh) shows its cost basis, with no "No price
  yet" caption — the `metal` precedent.

Either descriptor's `value` returns `null` when the holding has no
`lots`/metal metadata or no stored price point yet. A `loan` holding
(not priced, `priced: null`) reads its own `holding:<id>`
manual-correction series the same way `property_item` does —
`loan.descriptor.ts`'s `loanBreakdown` calls
`loanLedgerOutstandingMinorAt(meta, holding, book, now)` directly (the
same book also carries the loan's linked payments), since
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
no-price-point path) — cost basis is kept separate from the resolved
value for exactly this reason: `property_item`/`metal`'s own
`holdingDetailSpecs` entry (`holding-detail-spec/`) is `{ kind: 'priced' }`,
which `holding-detail.screen.tsx`'s `pricedBreakdownRows` renders as
Cost / Value / Gain (`gross.subtract(principalOrCost)`, MoneyText's own
sign-based tone — never a hardcoded green) — no interest/tax row, since
`interest`/`tax` are always zero: a priced holding never accrues
interest or withholds tax, so those rows would only ever read a
misleading zero.

### Ownership share (`property_item`)

Price points and lots always describe the WHOLE asset: the user enters
the whole value and the whole cost. A `PricedSpec` may carry an optional
`share(metadata, instant)`; `pricedBreakdown` scales the resolved value
and the cost basis each ONCE by the share at `now`
(`scaleMinorUnits`, `src/currency/decimal/` — BigInt, half away from
zero), so `gross = net =` owned value, `principalOrCost` = owned cost,
and the detail's Gain is the owned gain. Only `property_item` sets it
(`metal` owns the whole). Its share comes from `metadata.ownership`, a
list of dated changes `{ day, numerator, denominator }` (a `dayKeyOf`
key, a reduced fraction `0 < n <= d`), parsed all-or-nothing by
`asOwnershipChanges` (`src/holdings/ownership/`); an invalid list makes
`asPropertyMeta` reject the row, like invalid lots. `ownershipAt(changes,
instant)` reads the latest change on or before the instant's local
day, and reads 1/1 BEFORE the first change and with no changes. Unlike
`priceAt`, the first change never carries back: an edit that halves a
property owned whole since 2020, effective 2025-06-01, stores one
change and must leave every bucket before 2025-06-01 whole, and a
future effective day leaves today whole (the card and the detail show
no share until then — `ownershipChangeAt` is undefined). A share set at
creation is still one change dated the LOT day; a property's value is
`quantityAt(lots) x price`, zero before its first lot even when a price
point is older, so "created at 1/2" reads 1/2 everywhere it has value. `ownershipApplies(category)` is false for
`loan_given`, which always values whole even with a stored list. Every
valuation site — card, Home totals, statistics, net-worth history —
gets the share of its own instant through the same
`breakdown(holding, now, book)` seam; there is no ownership query and
no new parameter. A property with no `ownership` key values exactly as
before (`src/holdings/ownership/existing-holdings-pin.test.ts`).
The card and the detail read the whole value too, through
`propertyOwnershipView(holding, now, book)`
(`property-item.descriptor.ts`): `{ share, input, since, whole, owned }`
from the same `pricedWholeParts` (`priced-parts.ts`) and `ownedMoney`
the breakdown uses, so `owned` always equals the breakdown's value;
null when the property is owned whole, is a loan given, or is not a
property.

**A priced holding writes no ledger (`Transaction`) rows for its
revaluations.** Its lots array is the only source of quantity/cost-basis
history; a price change moves its VALUE without ever touching its
`balanceMinorUnits` or emitting a transaction. Consequently
`createHoldingValuer`
(`src/statistics/holding-value-at/holding-value-at.ts`) cannot back-derive a
priced holding's historical value from `currentBalance -
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
calls `loanLedgerOutstandingMinorAt(meta, holding, book, now)` directly. A
test that needs to exercise a runtime shape looser than a real
`HoldingRow` (never a real stored row) builds an id-less object and
casts it back to the read type, rather than widening the type back to
optional.

## Recording a lot: LotForm and the sell cost rule

`src/screens/forms/lot-form/lot-form.screen.tsx` records one buy/sell
lot against a lot-form-eligible holding (`metal` and `share` — see
`holdingDetailSpecs`, `holding-detail-spec/`, and the paragraph
closing `kiko-domain`'s "Sync-only holding types are not manually
creatable" section for that single-type entry), reached from
holding-detail's `addLot` footer action (a new lot), or from a lot
row's long-press menu (`LotRowMenu`, `src/screens/holding-detail/lot-row-menu/`:
Edit opens the form with `lotIndex`, Delete removes the lot). It writes
NO `Transaction` row and NO `price_points` row for either direction:
every add, edit, and delete goes through `holdingsRepo.changeLots(holdingId,
change)` (a `LotChange`: `add`, `edit` at an index, or `remove` at an
index), which re-reads the stored lots inside its own write, never a
screen's copy, and keeps every other metadata key as stored. A stored
list with one unreadable entry is refused, never written over. After the
write, the form calls `refreshAfterHoldingWrite` (see kiko-architecture's
"The first add triggers the gated refresh"), since a new or re-dated lot
can fall before the stored prices.

**Sell cost rule: proportional average cost, not FIFO/LIFO.** A sale
removes `costBasisBefore * quantitySold / heldQuantity` (BigInt-backed
`multiplyToMinorUnits`, `src/currency/decimal/`), stored as a NEGATIVE
`costMinorUnits`, mirroring `quantityDelta`'s own negative-on-sale sign.
A sale's cost is never typed: `withLotChange`
(`src/holdings/lots/lot-change.ts`) applies the change and then works
out EVERY sale's cost again, because a backdated, edited, or removed buy
moves the average of every later sale.

**One lot order for the cost and the overdraw check.** Every walk over
the lots (`inLotOrder` there) takes the same order: by day, a day's buys
before its sells, then the recorded order. So a buy recorded after a
same-day sale still covers it. A change that leaves any sale larger than
the quantity held before it in that order throws
`SaleExceedsHoldingError`; no sale is ever costed from less than it
takes, so no stale stored cost survives. Example: buy Jan 10 10 for
1,000, sell Mar 10 4, buy Mar 10 10 for 3,000; delete the January buy →
allowed (the March buy covers the sale), the sale re-costs to 1,200.00,
and April holds 6 at a basis of 1,800.00. `hasNegativeHolding` walks the
same order; the Lot form (`sellExceedsError`/`coversLaterSaleError`) and
the lot row's Delete offer run it on `changedLots` (the change with no
re-cost), and the repo refuses through `withLotChange` itself. A refusal
inside the write (the lots changed since the render) shows the shared
save-error alert. `share-money.matrix.test.ts`
(`src/data-transfer/snapshot/`) holds the operation x state cells.

**Stored lots are costed again once per device.** An older build costed a
sale in recorded order, so `recostStoredLots` (`src/holdings/lot-recost/`)
works every share, metal, and property lot list out again with
`recostLots` (the same order), once (`settings.lotsRecosted`) and again
after a restore of an older backup; kiko-architecture has the launch-step
shape. A list with a sale larger than what is held before it stays as
stored: the recost cannot cost it. The holding detail shows
`OversizedSaleNotice` (`src/screens/holding-detail/oversized-sale-notice/`,
share and metal, `hasNegativeHolding` over the stored lots, worked out on
the fly) asking the user to edit or delete that sale, which re-costs
every lot through `changeLots`.

A lot-priced holding's lots also surface as ledger-display rows: the
shared `lotEntries` (`src/holdings/holding-descriptor/entry-parts/entry-parts.ts`,
called by both the `metal` and `share` descriptors' `entries`) turns
each lot into a `DerivedEntry`. Always reuse it for a new lot-priced
type; never copy the mapping. It reuses the
`'purchase'`/`'sale'` `DerivedEntryKind`s previously bond-only (a buy lot →
`'purchase'`, a sell lot → `'sale'`) — do not assume those kinds mean "bond"
when reading that file. Its label is "Sale" for a sell; with `canSplit`
(the `share` descriptor passes it, a metal never splits) a buy at exactly 0
cost reads "Split" (`holdingDetail.split`, a stock split), every other buy
"Purchase".

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
NOT clear `metal:<XAU|...>`'s series (nothing else consumes it yet;
watch for this the moment a metal-specific remove path is added).

A `metal` holding's create payload is the one documented exception
that never sets `firstPricePoint`: `buildMetalCreatePayload`
(`src/screens/forms/holding-form/metal/use-metal-fields/`)
writes a zero stored balance and one lot, but no manual price point — a
metal's price comes from the shared `metal:<XAU|XAG|XPT|XPD>`
instrument, priced separately by `refreshMetalPrices` (see "NBU metal
prices — current and history" below), never a per-holding one.
`property_item`, by contrast, always writes `firstPricePoint` equal to
its entered cost. A `share` writes `firstPricePoint` (total cost ÷
quantity, on `holding:<id>`) only for a manual price source; an EODHD
share writes none, like `metal` — read `use-share-fields.ts`'s
`createPayload`. A manual share's later prices go through the Price
point form (`src/screens/forms/price-point-form/`), which gives a share
its own title/field/Save/error keys the same way it does a loan (read
that screen's per-kind key table). See that hook's own comment on the metal CREATE
payload for the current rationale.

**A share price keeps its own places.** Always store a share price
through `sharePriceOf` (`src/prices/share-price/`), which keeps up to
`SHARE_PRICE_SCALE` decimal places (read the value there) — never
through `Money`, which rounds to the currency's minor unit. The Price
point form uses `sharePriceOf` for the `share` kind; totals keep the
minor-unit `Money` path. A share edit saves through
`holdingsRepo.updateShareFromStored`, which builds the metadata from the
row stored at the time of the write (the lots come from there; a stored
list with one unreadable entry makes the build throw, so the write rolls
back and the form shows the save-error alert). When that edit switches
the share from EODHD to Manual, the same write carries EVERY
`share:<symbol>` close to `holding:<id>` as `manual` points
(`carryShareClosesDatabaseTransaction`), so no past value moves with
the switch; a typed price inside the closes' day span gives way, one
outside it stays. Only closes in the holding's own currency are carried
or allowed to displace a typed price: a close in another currency never
priced the holding (its value fell back to cost).

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
bank to check). Where `metal` is creatable, the holding form's Type
select lists the four metals in its place (`MetalTypeField` — see
kiko-domain's "`property_item` / `metal` create-form sections").

## Refresh throttles

Rate and price refresh runs on sync, throttled to respect each
provider's own cache window (see "Currency-rate fallback chain"
above) — do not poll faster than the upstream cache refreshes.
EODHD share prices have their own quota guard — see "EODHD quota guard
and share refresh" below.

`shouldThrottle` (`rates-refresh.ts`) treats `UAH` as always present
in its "does every held currency already have a rate" check: a star
row's `quote` is always `UAH` and its `base` never is, so
`presentCurrenciesQuery` (a distinct `base` read) can never list
`UAH` itself. Without this exception a base-USD user who holds UAH
would read as permanently "unrated" and bypass the throttle on every
single sync, not just a genuine gap.

## NBU metal prices — current and history

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
  range URL `nbu-history.ts`'s `RANGE_ENDPOINT` reads per fiat currency, one
  call per metal (`valcode=xau` etc., lowercased) — the same live
  probe confirmed the range endpoint returns one row PER DAY for a
  metal (weekend/holiday days carry forward the last banking day's
  rate), so the range path applies rather than a weekly-sample
  fallback. Returns `{ metal, day, price }[]`.

`src/prices/metal-refresh/refreshMetalPrices({ now, fetchImpl, ... })`
is the scheduler, run CONCURRENTLY with `refreshRates` through
`src/sync/refresh-market-data/` — every sync surface (`useSync`,
`useSyncAll`, `useAutoSync`) and every fire-and-forget "first add"
trigger (`holding-form.screen.tsx`, `import-data.ts`) now calls
`refreshMarketData({ throttled, metals })` instead of orchestrating
`Promise.allSettled([refreshRates(...), refreshMetalPrices()])`
directly. The two share no data dependency (`refreshMetalPrices`
reads/writes `price_points` only, `refreshRates` reads/writes
`currency_rates` only), so running them concurrently — rather than
strictly sequentially, `refreshMetalPrices` not even STARTING until
`refreshRates` had settled — overlaps their network + DB work and
shrinks the app-open DB-read burst's wall-clock span; see
`kiko-architecture`'s "op-sqlite's ONE worker thread" section for why
that burst matters to every OTHER screen's own reads. `allSettled`,
not `all`: `Promise.all` settles (rejects) the instant EITHER promise
rejects, which would let `refreshMarketData` itself resolve — and, in
`useSyncAll`, the single-flight lock around the whole fan-out —
release while the OTHER promise keeps running orphaned; a pull that
then arrives sees the lock already free and starts a SECOND fan-out
(caught in review, not a shipped production bug).

`refreshMarketData` never rejects, but a rejected step (or
`refreshRates`'s own `'failed'`/`'partial'` `RatesRefreshOutcome`, mirroring
`BackfillStatus`) is no longer silently dropped: it is collected,
logged through the ONE exported `warnRefreshFailure(step, reason)`
(through `logFailure` from `@kiko/diagnostics`, name and code only; no
UI, no new string — the narrowest
default), and returned as a `Left`. `throttled` reads
`ratesRepo.latestFetchedAt()` first (a failed read is logged too and
the run proceeds unthrottled); `metals` gates whether
`refreshMetalPrices` runs at all. `useAutoSync` also passes its OWN
outer catch-all's Left (reading accounts/sync-state/credentials) to
the SAME `warnRefreshFailure`, tagged `'auto-sync'`, instead of
dropping it — but never double-logs a `refreshMarketData` Left, since
that failure was already logged inside `refreshMarketData` itself.
It refreshes ONLY currently held metals — scanned from every `metal`
holding's `asMetalMeta(...).metal`, never a metal nobody owns, and
INCLUDING a closed holding's own lots (the history chart still needs
its pre-close prices, so `listHoldings`' default, `holdingsRepo.allQuery()`,
is never filtered down to open holdings only here) — at most once per
LOCAL day per metal for the ordinary one-day-forward case, resolved by
comparing `dayKeyOf(now())` against the stored `metal:<X>`
`price_points.day` range. This is already write-minimal, verified by
test rather than changed: **zero network calls and zero writes** when
there are no held metal holdings at all (the `earliestDays.size === 0`
early return, before either fetch function is ever referenced) and
equally when every held metal already fully covers its earliest lot
through today (`planRefresh` drops it from both the `backfill` and
`current` work lists). `planRefresh` mirrors `history-backfill.ts`'s
`missingDays` idea: a metal is backfilled via ONE `fetchNbuMetalHistory`
range call per missing span whenever it has never been priced at all, a
lot is added dated BEFORE its earliest stored point (the range from
that lot's day through the day before the first stored day), or more
than one day is missing since its last stored point (the whole gap in
one range call, not just today) — the earlier-lot check runs
UNCONDITIONALLY, never short-circuited by the "already refreshed today"
guard, since that guard covers only the forward gap and a stale earlier
gap must still fill in even once today's point is stored. Only a metal
that already covers back to its earliest lot AND is short exactly one
day (yesterday's point is the newest stored) takes the cheap path: a
single SHARED `fetchNbuMetalsCurrent` call for just today's point,
regardless of how many metals need it that run. Every row is
accumulated in memory first and written through exactly ONE final
`pricePointsRepo.upsertMany` call — a fetch failure for any held metal
rejects before that call is ever reached, so a failed run writes
NOTHING (never a partial write), matching the "fails closed" convention
`kiko-pricing`'s "Refresh throttles" section already documents for
rates.

## EODHD client

`src/prices/eodhd/eodhd.client.ts` is the only EODHD caller; the user's
own key (BYOK) comes from `src/prices/eodhd-key/` (Keychain). Read the
client for the exact shapes.

- `fetchEod(symbol, fromDay, toDay, key)` returns end-of-day closes for one
  `CODE.EXCHANGE` symbol, oldest first; a range with no trading day is `[]`.
- `fetchUserLimits(key)` returns the daily limit, today's used calls, and
  EODHD's own day (UTC; the limit resets at midnight GMT). The `/user`
  call costs 0 calls.
- Status mapping: 401 bad key (`EodhdAuthError`), 403 not in plan
  (`EodhdNotInPlanError`), 402 daily limit (`EodhdQuotaError`), 429 rate
  limit (`EodhdRateLimitError`), status >= 500 (`EodhdServerError`), no
  response or a request past the client's timeout (an `AbortController`
  abort; `EodhdNetworkError`), else `EodhdUnavailableError`. Read the
  timeout value in the client. What a refresh does with each error is in
  "EODHD quota guard and share refresh" below. EODHD error bodies are plain
  text even with `fmt=json`: always branch on the status only, never parse
  the body.
- Closes are exact decimal strings via `decimalFromJsonNumber`
  (`@kiko/currency/decimal`), never a float.
- Units (live-verified): a listing's `Currency` gives the close's unit,
  and a `GBX` close is in pence, not pounds. Refresh and search always read
  the unit from each listing's `Currency`, never from the exchange (an LSE
  row can be USD).
- `searchSymbols(query, key, fetchImpl, exchange?, timeoutMs?)` is the third
  entry point (share search, the refresh's unit lookup, and the share form's
  Save lookup). A request past `REQUEST_TIMEOUT_MS` (read it in the client),
  or past the caller's own shorter `timeoutMs`, aborts as `EodhdNetworkError`,
  0 calls spent.
- EODHD facts (live-verified): the demo token gets 403 on search and on
  non-US EOD; a search result's ISIN can be null; results include
  non-primary listings; `extraLimit` is never added to the daily limit;
  `apiRequestsDate` is EODHD's own day.
- Cache and logging rules for the key-in-URL: `kiko-compliance` 5.1.5.

## EODHD quota guard and share refresh

Code: `src/prices/quote-quota/quote-quota.ts` (pure quota maths),
`src/prices/share-refresh/share-refresh.ts` (`refreshSharePrices`),
`share-refresh-write.ts` (the one final write). Read those files for the
exact constants (default limit, search reserve, history span).

- **Quota state**: `QuoteQuota` in `settings.quoteQuota` (migration
  `0046_add_quote_quota`). The day is a UTC day, because EODHD resets at
  midnight GMT; `currentQuota` starts a fresh day when the stored one is
  older. The calls a run plans are RESERVED (saved) before any fetch, so a
  crash over-counts and never exceeds the limit. The final write settles
  the reservation by the delta (reserved vs spent) and keeps the stored
  `dailyLimit`; it commits in the same transaction as the prices
  (`updateQuoteQuotaDatabaseTransaction`, `src/settings/settings.repo.ts`).
- **Serialised runs**: `refreshSharePrices` chains each run on the previous
  one's promise, so two overlapping runs never plan from the same quota.
- **Gate order**: no active EODHD share → return before the Keychain read;
  a stored `isKeyRejected` → `keyRejected` before the Keychain read (the key
  state is read before the key, so a key saved in between is a newer key);
  no key → return before any network.
- **Budget**: a refresh spends at most `refreshAllowance` (daily limit − the
  search reserve, R2); a search may use the rest. When more symbols need a
  call than the allowance covers, the OLDEST latest price goes first (R1).
- **One forward call per symbol per UTC day**: a call for a symbol's newest
  closes (`isForward`) is reserved in `quota.symbols`, and a symbol already
  there gets no forward call again that day, even when its answer brought no
  new close. A call for older history only is not reserved there.
- **Skip fresh symbols**: no forward call while the symbol's latest stored
  close (`lastDay`) is on or after the last weekday (for a sold-out listing,
  the last weekday before its `lastLotDay`), or while the symbol is backed
  off (`isBackedOff`).
- **Backfill range**: a forward call runs from the day after the latest
  point. History is asked for when the earliest wanted day (the listing's
  earliest lot, clamped to the history span of 1 year) is before the earlier
  of the first stored close and `backfilledFrom[symbol]`, and that gap holds
  a weekday. It goes in ONE call with the forward one when both are due (the
  same cost), else alone up to the day before the first stored close. An
  answered call that reached back stores `backfilledFrom[symbol]`, so a range
  with no close is never asked for again. History is not asked for while
  `isBackfillBackedOff` holds (a back-off struck with the same `firstLotDay`,
  before its `retryDay`); an even older lot asks again. A future-dated lot is
  skipped.
- **Error handling** (`stopFor`, `costOfFailure`): 401 stops the run and
  stores `isKeyRejected`, which stops every later refresh and search until a
  key is saved or checked again (`recheckRejectedKey`); 402 stops and marks
  the day used up; 429 stops only (does not mark the day); a network error (a
  timeout included) stops the run and counts 0 calls spent;
  `EodhdServerError` stops the run as failed, counts 1 call, and leaves the
  unanswered symbols open for a later run; a midnight UTC passed during the
  run stops it (`dayChanged`, status `ok`), so the next run plans on the new
  day. A 403, 404 or bad body (`EodhdNotInPlanError`,
  `EodhdUnavailableError`), a unit search with no exact listing, and a
  sold-out listing whose closes stop short of its sale STRIKE the symbol: it
  is backed off for 2, 4, 8, 16, then every 30 days (`SymbolBackoff` in
  `quote-quota.ts`, keyed by the `firstLotDay`/`lastLotDay` it was struck
  with; a newer lot asks the newest closes again, an older lot its history).
  A held symbol whose forward call EODHD answers with no close
  `EMPTY_ANSWERS_BEFORE_STRIKE` times in a row (read its value in
  `src/prices/quote-quota/quote-quota.ts`;`emptyAnswers`, counted in the same `SymbolBackoff`) is struck too, and
  again at each empty answer after; a forward answer with a close newer than
  the stored ones (`row.day > latestDay`) deletes the back-off and its count.
  A forward call that also asked for history and brought only older closes
  counts as empty. The count outlasts a week-long market holiday
  (Golden Week, Lunar New Year), so such a pause never strikes a live
  listing. An answer to a history-only
  call neither ends a back-off nor counts as empty.
- **Unit rule**: a listing with no `quoteCurrency` is resolved once by one
  search call (that call costs 1 more) and saved on the holding. The holding
  currency a unit fits is `unitHoldingCurrency` (`share-search.ts`): `GBX`
  fits `GBP`, every other unit only its own currency. The refresh's
  `pointUnit`, the share form's Currency check, and the detail notice all
  read this one rule. A `GBX` close on a `GBP` holding is divided by 100; any
  other unit/currency mismatch skips the symbol. A unit the share form
  stored at Save (see "Share search") spends no refresh lookup.
- **Key saves and restores** (`quote-quota.ts`): `withSavedKey` (a key saved
  in Share prices) and `withRestoredKey` (a key restored from a backup,
  `restore-secrets.ts`) both start a new key generation (`keyGeneration`,
  `withNewKey`): the rejection and the back-offs go; `withSavedKey` also
  starts today's calls and symbols over unless `/user` reported this key's
  own count for today. `withRestoredKey` keeps the calls this device spent
  and marks the limit unconfirmed. `withRestoredPrices` (a restore replaces
  every price) forgets today's symbols, the back-offs and `backfilledFrom`,
  keeping the calls and the key state. An answer about a key lands only
  while its generation is still the stored one (`forKey` in `daily-limit.ts`,
  `withKeyAnswers` in `settle`).
- **Unconfirmed daily limit**: `QuoteQuota.isLimitUnconfirmed` (optional;
  read `quote-quota.ts`) is carried by `currentQuota` and cleared by
  `withUserLimits`. A key saved while `/user` answers with a limit error is
  still saved: `limitErrorQuota` (`src/prices/daily-limit/daily-limit.ts`)
  builds `markUsedUp(withUnconfirmedLimit(...))` for a 402 and
  `withUnconfirmedLimit(...)` for a 429, and `limitErrorKeyQuota` in
  `src/screens/settings/share-prices/share-prices.screen.tsx` applies it
  over `withSavedKey`. `confirmDailyLimit` acts only while the limit is
  unconfirmed: it reads the key, calls `/user` (0 calls), and stores the
  limit and count, overwriting only while the stored limit is still
  unconfirmed; a 401 marks the key rejected; any other failure leaves the
  limit unconfirmed. Rule: every refresh entry point that may plan
  under a restored or saved key runs `confirmDailyLimit` first, and it never
  blocks the refresh (fire-and-forget:
  `confirmDailyLimit().catch(log).then(refresh)`; a failed check never holds
  the refresh back). Share prices also runs it on each open. Find the
  current call sites with `git grep confirmDailyLimit src`. The refresh itself never reads
  `/user` (R3). In `withUserLimits`, EODHD's count wins only when EODHD's day
  is today (UTC).
- **Rejected key**: `recheckRejectedKey` (Share prices' "Check again") asks
  `/user` again (0 calls); an accepted key, or a limit error, clears
  `isKeyRejected` (`withoutRejection`) and stores the limit EODHD reports or
  `limitErrorQuota`'s; any other answer leaves the key rejected.
- **Accepted limit**: a key saved during a refresh can leave the local count
  too low (`withUserLimits` overwrites the calls, then the refresh's delta
  settle subtracts its reservation); the next 402 corrects it via
  `markUsedUp`.
- **Logs carry no symbol**: a symbol is personal portfolio data; log only
  the error name/code and a fixed reason.

## Share search

Code: `src/prices/share-search/share-search.ts` (`searchShares`). Rules:

- Read the quota first: a stored `isKeyRejected` → `keyRejected`, no
  Keychain read, no network. Then read the key; no key → `noKey`, no network.
- Reserve 1 call atomically on the UTC day before the request. A search may
  use the calls up to `dailyLimit` itself (the refresh's search reserve is
  for it). A full day → `quotaExhausted`, no network.
- 402 marks the day used up; 401 marks the key rejected (for the key
  generation it read) and returns `keyRejected`; a request with no answer
  (`EodhdNetworkError`) gives the call back (spent 0); any other error spends
  1.
- A `GBX` listing becomes a `GBP` holding with `quoteCurrency` `GBX`. Drop a
  listing whose currency is outside the form's own options. Primary
  listings first.
- One call per explicit Search press, never per keystroke: the sheet's
  Search button runs through `useSubmitOnce`
  (`share-search-sheet.component.tsx`). A search between a refresh's
  reservation and its settle keeps its call (the delta settle; see
  `share-search.test.ts`).
- A picked listing's `quoteCurrency` is kept only while the source is EODHD
  and the ticker equals the picked symbol (`keptQuoteCurrency`,
  `use-share-fields.ts`); a ticker edit drops it, and Save looks it up again
  (below), or else the refresh resolves it with one search call.

### Unit lookup at Save and the currency guard

A share held in another currency than the one its listing's unit fits is
never priced, so the share form checks it before it writes.

- **Picked listing**: its unit is known, so a currency it does not fit
  blocks Save at once with an error on the Currency field
  (`shareFieldErrors`' `currencyError`, `share-reasons.ts`). No call.
- **Hand-typed EODHD ticker**: Save runs `lookupShareUnit(symbol)`
  (`share-search.ts`): the refresh's own code + exchange search
  (`listingSearchOf`), under the same quota rules as a search, with its own
  shorter timeout (private `SAVE_LOOKUP_TIMEOUT_MS`,
  `src/prices/share-search/share-search.ts`) instead of the client's
  (`REQUEST_TIMEOUT_MS`, `src/prices/eodhd/eodhd.client.ts`); read the
  values there. It
  answers the exact listing's unit, or `undefined` (no key, a rejected key,
  no calls left, no answer, no listing of that symbol, or a failed read),
  which saves as before. A found unit is stored as `quoteCurrency`, so the
  first refresh spends no lookup; a unit the currency does not fit blocks
  Save on the Currency field. The same ticker is never looked up twice.
- **Create and edit**: create runs it through `checkCreate`. An edit runs it
  through `checkEdit` only when the share now names a listing its stored row
  did not (a switch from Manual to EODHD, or another ticker) and no pick
  told the unit; an unchanged source and ticker, a switch to Manual, or a
  pick make no call. The form contract is kiko-domain's "Adding a holding
  type" step 3.
- **Save spinner**: Save shows its `loading` spinner only while this lookup
  runs (`isLookingUpUnit`); it is not dimmed then (kiko-design-system's
  Button `loading`), and stays disabled for any other submit.
- **Mismatch text**: a create gets `forms.holding.shareCurrencyMismatchError`
  ("Choose {{currency}}…"). An edit, where the Currency field is read-only,
  gets `shareCurrencyMismatchEditError` instead: Manual, or delete the share
  and add it again in that currency (`currencyFieldReasonKey` reads
  `isEdit`, `share-reasons.ts`).
- **Unsupported unit**: a unit whose currency no share can be held in
  (`isShareUnitSupported` false; read the set there, e.g. `ZAC` cents) gets the
  Manual-only text `forms.holding.shareCurrencyUnsupportedError` on create and
  edit alike, instead of either mismatch text.
- **Stored mismatch**: a share an older build stored in another currency
  than its unit fits shows `ListingCurrencyNotice` on its detail
  (`src/screens/holding-detail/listing-currency-notice/`, a NoticeBanner):
  `holdingDetail.listingCurrencyMismatch` names both ways out (Manual, or a
  new share in that currency), `holdingDetail.listingCurrencyUnsupported`
  only Manual.

## Later (not built yet — do not invent detail)

A scheduled backfill for non-metal instruments is planned but does not
exist in code yet. When it lands, extend the matching section above rather
than writing a new one.
