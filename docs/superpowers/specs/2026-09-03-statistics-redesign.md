# Statistics redesign — design (2026-09-03)

Supersedes parts of `2026-09-03-statistics-design.md`. User-approved directions (chat):
Option A (backfill historical rates), horizontal bar chart for the by-type block, add the
**NBU API** as the historical fiat source.

## Goal

Rework the Statistics screen into three blocks, in this order:
1. **By-type horizontal bar chart (FIRST)** — total value of each holding TYPE (card, term
   deposit, bond, cash, crypto, jar) across all accounts, converted to the base currency.
2. **Net-worth line chart** — a single line of total net worth over time, all currencies
   converted to base using HISTORICAL rates, plus a horizontal **dashed gray reference line** at
   the net worth at the start of the selected period, and **Y-axis amount labels**.
3. **Account-contribution pie** — unchanged (each account's share of current net worth).

This replaces the current per-currency indexed line chart. It requires a new historical
rate-history subsystem.

## A. Rate-history subsystem (new)

### Storage
- New table `currency_rate_history` (`src/db/schema.ts`): `base`, `quote` (the 4-currency enum),
  `day` (integer, UTC-midnight epoch-ms or YYYYMMDD), `rate` (scaled text), `source`
  (monobank|coingecko|nbu). Unique index `(base, quote, day)`. Leave the existing
  `currency_rates` (latest cache) UNTOUCHED — history is a separate table.
- New drizzle migration via `npx drizzle-kit generate` (schema → migration + snapshot + journal).
- New `rateHistoryRepo`: `upsertMany` keyed on `(base, quote, day)`; `historyRows()` reactive
  select; a `rateTableAt(day)` builder that returns the flat `RateTable` for a day, using the
  nearest available day AT OR BEFORE the target (carry-forward across weekend/holiday gaps).

### Sources / backfill
- **Fiat (UAH↔USD/EUR)** — NBU open API. Per-date endpoint:
  `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=YYYYMMDD&json` (returns UAH
  per currency for that date). Investigate a range endpoint to avoid one call per day; if none,
  fetch per business day with throttling. NBU has no auth.
- **Crypto (BTC/USD)** — CoinGecko historical:
  `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=N&interval=daily`
  returns a daily price array in one call. New endpoint constant (the current spot
  `PRICE_ENDPOINT` cannot be reused). No auth (free tier; mind rate limits).
- Compose every ordered pair among {BTC,USD,EUR,UAH} per day into a UAH-denominated price and
  store, mirroring the current `rates-refresh` pivot logic, but per day.
- **Backfill span**: from the earliest holding/transaction date to today. **Trigger**: a one-time
  incremental backfill (store the last-backfilled day; on Statistics open, fetch any missing days
  up to today). Show a loading state on the line chart while history is incomplete; the line is
  accurate for days already stored and carry-forwards gaps.
- Respect rate limits: batch CoinGecko in one range call; throttle NBU per-day calls; make the
  backfill resumable (never block the whole app; the other two charts do not need history).

### Day-aware conversion
- `rateTableAt(day)` (above) feeds a day-aware net-worth series builder: for each day bucket `t`,
  compute each holding's value at `t` (reuse `holdingValueAt`), convert via `rateTableAt(t)` to
  base, sum → one absolute net-worth point. This is a NEW builder in `src/statistics/`
  (e.g. `net-worth-series.ts`), additive next to the existing per-currency builder (the
  per-currency indexed line is retired from the screen but the module can stay or be removed).

## B. Charts

- **ByTypeBar** (new, `src/design-system/components/bar-chart/`): horizontal bars, one per holding
  type present, length ∝ converted value, sorted by value desc; value label + type label per bar;
  palette `chartSeries`. Built with `react-native-svg` (`Rect` + `SvgText`).
- **NetWorthLine** (rework the existing `line-chart` or a new component): a single `Polyline` of
  absolute net worth over time; a horizontal **dashed** `Line` (gray) at the start-of-period
  value; **Y-axis labels** (amounts formatted via `Money`/`MoneyText`, ~3-5 ticks); X time axis.
  Empty/loading states.
- **PieChart** (account contribution): unchanged.

## C. Screen

`src/screens/statistics/statistics.screen.tsx`: render the three blocks in order (by-type bar,
net-worth line, account pie), keeping the existing filter bar (account multi-select +
`DateRangeField`). The net-worth line uses the day-aware converted series; the by-type bar and pie
use current rates (they are "now" snapshots). Base currency + rate table as today.

## Testing
- Unit-test `rateTableAt` (nearest-prior-day carry-forward, gaps), the per-day pivot, the
  net-worth series builder (converted, absolute, start-reference), the by-type aggregation
  (sum per type, sorted), and the two new chart components (bars, line + dashed ref + Y labels).
- Mock the NBU/CoinGecko historical fetches in tests (no live network).

## Out of scope / follow-up
- Real-time backfill progress UI beyond a simple loading state.
- Intraday rates (daily granularity only).

## Open implementation questions (resolve during planning)
- Exact NBU range endpoint vs per-day (investigate to bound the number of calls).
- CoinGecko free-tier `market_chart` day limit / rate limit for a multi-year span.
- Backfill trigger placement (Statistics open vs app start) and how to surface partial history.
