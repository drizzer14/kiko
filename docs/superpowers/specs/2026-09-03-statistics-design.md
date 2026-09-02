# Statistics screen — design (2026-09-03)

## Goal

A new "Statistics" screen (4th bottom tab) with two charts and filters.

- **Line chart** — money over time, one line per currency, each indexed to its own start
  value (percent change), no currency conversion.
- **Pie chart** — each account's share of current total net worth, converted to the base
  currency.

Approved by the user in chat (2026-09-03): pie chart converts at current rates; the feature is
built in a new worktree based on a checkpoint commit of `drizzer14/pff-consolidated`.

## Navigation

- New bottom tab "Statistics", SF Symbol `chart.xyaxis.line`.
- Add `StatisticsStackParamList` to `src/navigation/types.ts`; add `StatisticsTab` to
  `TabParamList`; add `src/navigation/statistics.stack.tsx` mirroring `settings.stack.tsx`;
  register a 4th `Tabs.Screen` in `src/navigation/root.navigator.tsx`.

## Line chart — "Balance over time"

- One line per currency present in the user's holdings.
- Y axis = percent change, each currency indexed to its value at the START of the selected
  range (start = 0%). Shared baseline; lines are comparable in shape, not absolute amount.
- X axis = time across the selected date range, bucketed by day.
- Value per currency at time `t` = sum over all holdings of that currency of the holding's
  value at `t`:
  - card / cash / jar: running balance = opening balance + sum of that holding's transactions
    with `time <= t`.
  - term_deposit / bond: computed value via `holdingValueBreakdown(holding, t)` (the signature
    already takes `now` = `t`), so accrued interest / coupons are correct at each past date.
- Opening balance: `holdings.balanceMinorUnits` is the CURRENT balance. Derive the start-of-range
  balance as `currentBalance - sum(transactions with time > startOfRange)` (walk the ledger
  backward), or the opening balance as `currentBalance - sum(all transactions)`. The developer
  picks the cleanest reconstruction and unit-tests it.
- NO currency conversion in this chart.
- Only accounts selected in the filter contribute.

## Pie chart — "Account contribution"

- One slice per non-archived account = that account's share of total net worth right now.
- Per account: `guardedNetWorth(accountHoldings, baseCurrency, rateTable, now)` (the pattern
  `accounts.screen.tsx` already uses per account).
- Converts every account to the base currency at current rates (accurate as "now"). Accounts
  that cannot convert are excluded by the guard.
- Only accounts selected in the filter are shown.

## Filters

- **Date range** — controls the line-chart window. Reuse `DateRangeField`
  (`src/screens/home/date-range-field/`). Default window: all-time (min transaction date to now).
- **Account multi-select** — controls which accounts feed BOTH charts. Reuse the Home
  `FilterMenu` (`src/screens/home/filter-menu/`) or `chip-selector`.
- No currency filter (all currencies show as separate lines).

## Charting implementation

- Add `react-native-svg` (a single new dependency). It needs a native rebuild and
  `cd ios && pod install`. Handle `.depcheckrc.json` / `knip.json` if the static scan cannot see
  it, and the `.npmrc` `min-release-age` rule (add a documented exclude only if a fresh version
  is otherwise blocked; prefer an established version that satisfies the 7-day rule).
- Hand-draw the two charts with `react-native-svg`:
  - Line chart: axes, light gridlines, one `Polyline` per currency colored from the categorical
    palette, plus a legend (color -> currency).
  - Pie chart: one `Path` arc per account colored from the palette, plus a legend
    (color -> account, with amount and percent).
- Static v1 — no tooltips, zoom, or gestures.
- Keep units small and testable: pure data-shaping functions in a new `src/statistics/` module;
  dumb SVG components that render from props.

## Palette

- Add a categorical chart palette to `src/design-system/theme.ts` (e.g. `colors.chartSeries`:
  an array of N distinct, accessible hues on the dark theme). Used for both line series and pie
  slices. Cycle if series exceed N.

## Data module (`src/statistics/`, new)

- `buildCurrencySeries(holdings, transactionsByHolding, range, now): { currency, points: {t, pct}[] }[]`
  — per-currency indexed time series for the line chart.
- `buildAccountContribution(accounts, holdings, rateTable, baseCurrency, now): { accountId, name, amount, share }[]`
  — per-account converted totals and shares for the pie chart.
- Pure and unit-tested; the screen composes them via `useLiveQuery` over the existing repos
  (accounts, holdings, transactions, rates, settings).

## Testing

- Unit-test the data module against fixtures: per-currency reconstruction and indexing;
  deposit/bond value at past dates; account shares summing to 100%; guarded exclusion of
  unconvertible accounts.
- Component tests: the screen renders both charts and both legends; changing the account filter
  and the date range changes the rendered data.

## Out of scope (v1 / future)

- Historical FX accuracy (avoided: the line chart never converts).
- A net-worth snapshot table (the accurate-going-forward option, deferred).
- Chart interactivity (tooltips, zoom, selection).

## Build logistics

- New Orca worktree based on a checkpoint commit of `drizzer14/pff-consolidated`, taken AFTER the
  in-flight deposit/bond agent finishes and `npm run check:all` is green.
- Adding `react-native-svg` requires `npm install` + `pod install` in the new worktree before the
  first native run.
