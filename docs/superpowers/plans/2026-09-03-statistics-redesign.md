# Statistics Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Add a historical rate-history subsystem (NBU fiat + CoinGecko crypto), and rework the Statistics screen into a by-type horizontal bar chart (first), a converted net-worth line over time (dashed start reference + Y-axis labels), and the existing account pie.

**Architecture:** New `currency_rate_history` table + `rateHistoryRepo` (day-keyed, carry-forward `rateTableAt`); fetch modules for NBU + CoinGecko historical; an incremental backfill; a day-aware net-worth series builder and a by-type aggregation; two svg chart components; a reordered screen.

**Tech Stack:** RN 0.87, TS, drizzle/op-sqlite, react-native-svg (installed), Jest.

**Spec:** `docs/superpowers/specs/2026-09-03-statistics-redesign.md`

## Global Constraints
- Worktree `/Users/drizzer14/orca/workspaces/pff-ios/pff-statistics`, branch `drizzer14/pff-statistics`.
- `npm run check:all` stays green; never weaken a check. Migrations via `npx drizzle-kit generate` (never hand-edit journal/snapshot).
- No live network in tests — mock NBU/CoinGecko fetches.
- Currencies: BTC, USD, EUR, UAH. Rates stored as scaled text, never floats.
- Commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Rate-history schema, migration, repo
- Create table `currency_rate_history` in `src/db/schema.ts`: `base`, `quote` (enum), `day` (integer), `rate` (text), `source` (enum monobank|coingecko|nbu). Unique index `(base, quote, day)`. Do NOT change `currency_rates`.
- `npx drizzle-kit generate` → new migration + snapshot + journal + regenerated `migrations.js`. Verify SQL.
- `src/repositories/rate-history.repo.ts`: `upsertMany(rows)` (conflict on base,quote,day), `historyRowsQuery()` reactive select, and `rateTableAt(rows, day): RateTable` (nearest available day AT OR BEFORE `day`, carry-forward; returns flat "BASE:QUOTE"→number). Unit-test `rateTableAt` (exact day, gap carry-forward, no-data-before returns empty/partial).
- Commit `feat(rates): currency_rate_history table + repo`.

### Task 2: Historical fetch modules (NBU + CoinGecko)
- `src/rates/nbu-history.ts`: fetch official fiat rates by date from NBU. FIRST investigate whether NBU exposes a date-RANGE endpoint for a currency (to avoid one call/day); if yes use it, else fetch per business day with throttling. Endpoint base: `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=YYYYMMDD&json` (returns UAH-per-currency array). Parse USD, EUR (and UAH=1). Return `{ day, base:'USD'|'EUR', quote:'UAH', rate }[]`-shaped entries per day. Guard/catch like `coingecko.ts`.
- `src/rates/coingecko-history.ts`: `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=<N>&interval=daily` → daily `[ts, price]` array → `{ day, base:'BTC', quote:'USD', rate }[]`. One call covers the whole span.
- Mock network in tests (fixture responses); assert parsing + shape + error handling. Do NOT hit live APIs in tests.
- Commit `feat(rates): NBU + CoinGecko historical fetch modules`.

### Task 3: Incremental backfill orchestration
- `src/rates/history-backfill.ts`: given a target span (earliest holding/transaction day → today) and the last-backfilled day (persist it in settings or a small meta row), fetch the missing days from NBU + CoinGecko, compose EVERY ordered pair among {BTC,USD,EUR,UAH} per day into a UAH-denominated price (mirror `rates-refresh.ts` pivot, per day), and `rateHistoryRepo.upsertMany`. Resumable, throttled, never blocks app start. Expose a `backfillStatus` (idle/loading/complete + last day) the screen can show.
- Unit-test the per-day pivot/compose and the missing-days computation with mocked fetch modules.
- Commit `feat(rates): incremental historical backfill`.

### Task 4: Day-aware net-worth series + by-type aggregation
- `src/statistics/net-worth-series.ts`: `buildNetWorthSeries({holdings, txByHolding, historyRows, baseCurrency, range})` → `{ points: {t, amount}[]; startReference: number }`. For each day bucket, value each holding at `t` (reuse `holdingValueAt` from `currency-series.ts` or extract shared), convert via `rateTableAt(historyRows, t)` to base, sum. `startReference` = the series value at range start (for the dashed line). Absolute base-currency amounts. Skip/flat-carry days without rates.
- `src/statistics/type-breakdown.ts`: `buildTypeBreakdown({holdings, rateTable, baseCurrency, now})` → `{ type, amount }[]` sorted desc, value = sum of that type's holdings converted to base (current rates); exclude zero.
- Unit-test both against fixtures (conversion, start reference, per-type sums, sorting).
- Commit `feat(statistics): net-worth series + type-breakdown builders`.

### Task 5: BarChart + NetWorthLine components
- `src/design-system/components/bar-chart/`: horizontal bars (`Rect` per entry, length ∝ amount, sorted desc), type label + amount label (MoneyText), palette `chartSeries`, empty state. Props `{ data: {type,amount}[]; baseCurrency; height? }`.
- `src/design-system/components/net-worth-line/` (or rework `line-chart`): single `Polyline` of absolute amounts, a horizontal DASHED gray `Line` at `startReference`, Y-axis amount labels (~4 ticks, MoneyText/formatted), X time axis, empty + loading states. Props `{ points: {t,amount}[]; startReference; baseCurrency; loading?; height? }`.
- TDD via testIDs (bars per entry, dashed ref present, Y-tick labels, empty/loading).
- Commit `feat(statistics): bar chart + net-worth line components`.

### Task 6: Statistics screen redesign + backfill wiring
- `src/screens/statistics/statistics.screen.tsx`: render blocks in order — (1) BarChart (by type), (2) NetWorthLine (converted, with dashed start ref + Y labels), (3) account PieChart (unchanged). Keep the filter bar (account multi-select + DateRangeField). Trigger the backfill on mount (non-blocking); pass its status as the line's `loading`. The bar + pie use the current `rateTable`; the line uses `historyRows` via `buildNetWorthSeries`. Retire the per-currency `LineChart` usage from the screen.
- TDD: renders the three blocks in order; the line shows a loading state until history is present; filters drive the data.
- Commit `feat(statistics): redesigned screen — by-type bar, net-worth line, pie`.

### Task 7: Gate
- `npm run check:all` + `npx jest` green. Confirm knip clean (retired exports removed). Commit any fixups.

## Self-review notes
- Migration (Task 1) is the only schema change; keep `currency_rates` untouched.
- Network only in fetch modules (Tasks 2-3), always mocked in tests.
- `holdingValueAt` may need extracting to a shared spot if both `currency-series.ts` and `net-worth-series.ts` use it — do it in Task 4, note it.
