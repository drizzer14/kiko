# Statistics Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Statistics" tab with a per-currency indexed line chart of balance over time and a per-account pie chart of current net worth, both filterable by date range and account.

**Architecture:** A pure data module (`src/statistics/`) shapes repository rows into chart series; two dumb `react-native-svg` chart components render from props; a screen composes them with the existing `DateRangeField` and account filter. No currency conversion in the line chart; the pie chart converts at current rates.

**Tech Stack:** React Native 0.87, TypeScript, react-native-unistyles, drizzle/op-sqlite via `useLiveQuery`, new dependency `react-native-svg`, Jest + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-03-statistics-design.md`

## Global Constraints

- Base working copy: a new worktree off a checkpoint commit of `drizzer14/pff-consolidated`.
- `npm run check:all` must stay green; never weaken a check (standing harness rule). Fix `.depcheckrc.json` / `knip.json` only with a concrete justification.
- `.npmrc` enforces `min-release-age=7`; pick a `react-native-svg` version older than 7 days, else add a documented exclude.
- Follow existing patterns: screens under `src/screens/<name>/`, dumb components under `src/design-system/components/<name>/`, unistyles `StyleSheet`, theme tokens only (no magic colors).
- Dark theme is the only theme; use `src/design-system/theme.ts` tokens.
- TDD every data/logic task: failing test first, then implement.
- Commit after each task with a `feat(statistics):` / `chore:` message. Hold any push; the user reviews via Orca.

---

### Task 1: Add react-native-svg and wire native + harness config

**Files:**
- Modify: `package.json` (dependencies), `package-lock.json`
- Modify: `ios/Podfile.lock` (via `pod install`)
- Modify if needed: `.depcheckrc.json`, `knip.json`

**Interfaces:**
- Produces: `react-native-svg` importable (`Svg`, `Path`, `Polyline`, `Line`, `G`, `Text` as `SvgText`, `Circle`).

- [ ] **Step 1:** Install a >=7-day-old stable version: `npm install react-native-svg@<pinned>` in the worktree. Verify `.npmrc` min-age does not block it; if it does, add `react-native-svg` to `min-release-age-exclude` in `.npmrc` with a one-line justification comment.
- [ ] **Step 2:** `cd ios && pod install` to add the RNSVG pod. Confirm `ios/Podfile.lock` gains RNSVG.
- [ ] **Step 3:** Run `npm run check:deps` and `npm run check:knip`. If either flags `react-native-svg` as unused (it is imported only from app code, so it should be seen), do NOT suppress unless truly a false positive; a real import in Task 5 resolves it — run this step again after Task 5 if needed.
- [ ] **Step 4:** Smoke-test the bundle: `npx jest` still green (no import yet), and a trivial `import Svg from 'react-native-svg'` in a scratch test resolves. Remove the scratch test.
- [ ] **Step 5:** Commit: `chore(statistics): add react-native-svg dependency and pod`.

---

### Task 2: Categorical chart palette in the theme

**Files:**
- Modify: `src/design-system/theme.ts`
- Test: `src/design-system/theme.test.ts` (create if absent, else add a case)

**Interfaces:**
- Produces: `theme.colors.chartSeries: readonly string[]` — at least 6 distinct, accessible hues on the dark background, plus a helper convention: consumers pick `chartSeries[i % chartSeries.length]`.

- [ ] **Step 1:** Write a failing test asserting `darkTheme.colors.chartSeries` is an array of length >= 6, every entry a hex string, all distinct.
- [ ] **Step 2:** Run it; expect FAIL (undefined).
- [ ] **Step 3:** Add `chartSeries` to `darkTheme.colors` — 6-8 hues distinct from each other and legible on `#000` (e.g. systemBlue `#0A84FF`, systemGreen `#30D158`, systemOrange `#FF9F0A`, systemPurple `#BF5AF2`, systemTeal `#40C8E0`, systemPink `#FF375F`, systemYellow `#FFD60A`, systemIndigo `#5E5CE6`). Keep `accent`, `positive`, `negative` unchanged.
- [ ] **Step 4:** Run the test; expect PASS. Run `npm run check:lint`.
- [ ] **Step 5:** Commit: `feat(statistics): add categorical chart palette`.

---

### Task 3: Data module — per-currency indexed time series (line chart)

**Files:**
- Create: `src/statistics/currency-series.ts`
- Test: `src/statistics/currency-series.test.ts`

**Interfaces:**
- Consumes: `Holding` (`src/holdings/...`), transaction rows (`{ holdingId, time, amountMinorUnits }`), `holdingValueBreakdown(holding, now)` (`src/holdings/holding-value.ts`), `Currency` (`src/currency/currency`).
- Produces:
  ```ts
  export type SeriesPoint = { t: number; pct: number }; // pct = percent change vs range start
  export type CurrencySeries = { currency: Currency; points: SeriesPoint[] };
  export function buildCurrencySeries(input: {
    holdings: Holding[];
    txByHolding: Map<string, { time: number; amountMinorUnits: number }[]>;
    range: { from: number; to: number };
    bucketDays?: number; // default 1
  }): CurrencySeries[];
  ```

- [ ] **Step 1:** Write failing tests with fixtures:
  - Two holdings same currency (UAH), transactions across the range: series sums both, one line, points bucketed by day, `pct` at `from` = 0, later points = `(value_t / value_from - 1) * 100`.
  - A `term_deposit` holding: value at each bucket uses `holdingValueBreakdown(holding, t)` so the line rises with accrued interest even with no transactions.
  - Start balance reconstruction: `startBalance = currentBalance - sum(tx.time > from)`; assert a holding created before the range with later deposits starts at the right base.
  - A currency with a zero start value: guard divide-by-zero (pct = 0 baseline; if start is 0, index against the first non-zero value or report absolute-from-zero — document the choice in a comment and test it).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement `buildCurrencySeries`: bucket the range into days; for each bucket end `t`, compute each holding's value at `t` (cash/card/jar = reconstructed balance; deposit/bond = `holdingValueBreakdown(holding, t)`), group by `holding.currency`, sum per currency; index each currency's series to its `from` value.
- [ ] **Step 4:** Run; expect PASS. `npm run check:lint`.
- [ ] **Step 5:** Commit: `feat(statistics): per-currency indexed time series builder`.

---

### Task 4: Data module — per-account contribution (pie chart)

**Files:**
- Create: `src/statistics/account-contribution.ts`
- Test: `src/statistics/account-contribution.test.ts`

**Interfaces:**
- Consumes: `guardedNetWorth` (`src/rates/net-worth-view.ts`), `buildRateTable`, `Account`, `Holding`, `Currency`.
- Produces:
  ```ts
  export type AccountSlice = { accountId: string; name: string; amount: number; share: number };
  export function buildAccountContribution(input: {
    accounts: Account[];         // non-archived, already filtered to selection
    holdings: Holding[];         // open holdings
    rateTable: RateTable;
    baseCurrency: Currency;
    now: number;
  }): AccountSlice[]; // share in [0,1], sums to ~1 across returned slices (excluding unconvertible)
  ```

- [ ] **Step 1:** Write failing tests:
  - Three accounts, mixed currencies with rates present: each `amount` = `guardedNetWorth(accountHoldings, base, rateTable, now)`, `share = amount / totalConverted`; shares sum to 1.
  - An account whose holding currency has no rate: excluded from the total and the slices (guarded).
  - An account with zero net worth: `amount` 0, `share` 0, still listed or filtered — pick "filter out zero/negative slices" and test it.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement: per account sum via `guardedNetWorth`; compute total; derive shares; drop zero/unconvertible.
- [ ] **Step 4:** Run; expect PASS. `npm run check:lint`.
- [ ] **Step 5:** Commit: `feat(statistics): per-account contribution builder`.

---

### Task 5: LineChart SVG component (dumb)

**Files:**
- Create: `src/design-system/components/line-chart/line-chart.component.tsx`, `line-chart.styles.ts`, `index.ts`
- Test: `src/design-system/components/line-chart/line-chart.component.test.tsx`

**Interfaces:**
- Consumes: `CurrencySeries[]` (Task 3), `theme.colors.chartSeries`.
- Produces:
  ```ts
  export type LineChartProps = { series: CurrencySeries[]; height?: number };
  ```
  Renders an `Svg` with a 0% baseline, light gridlines, one `Polyline` per series colored `chartSeries[i % n]`, and a legend row (color swatch + currency code). Empty state when `series` is empty.

- [ ] **Step 1:** Write failing tests: renders one polyline per series; renders a legend entry per currency; renders an empty-state message for `series=[]`. (Assert via testIDs / accessibility labels, since RNSVG renders host elements.)
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement: map each series' `{t, pct}` to SVG coordinates (x = time scaled across width; y = pct scaled with a symmetric domain around 0); draw `Polyline`; draw the baseline `Line` at 0%; legend from `chartSeries`. Use the first real `import ... from 'react-native-svg'` here (resolves Task 1's knip/deps concern).
- [ ] **Step 4:** Run; expect PASS. `npm run check:lint`.
- [ ] **Step 5:** Commit: `feat(statistics): line chart svg component`.

---

### Task 6: PieChart SVG component (dumb)

**Files:**
- Create: `src/design-system/components/pie-chart/pie-chart.component.tsx`, `pie-chart.styles.ts`, `index.ts`
- Test: `src/design-system/components/pie-chart/pie-chart.component.test.tsx`

**Interfaces:**
- Consumes: `AccountSlice[]` (Task 4), `theme.colors.chartSeries`, `MoneyText`/`Money` for legend amounts.
- Produces:
  ```ts
  export type PieChartProps = { slices: AccountSlice[]; baseCurrency: Currency; size?: number };
  ```
  Renders an `Svg` donut/pie of arcs (one `Path` per slice, colored `chartSeries[i % n]`) and a legend (swatch + account name + amount + percent). Empty state when `slices=[]`.

- [ ] **Step 1:** Write failing tests: renders one arc path per slice; legend shows account name and a percent; empty-state for no slices.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement arc geometry: cumulative angles from `share`; build each `Path` `d` with `A` arc commands (or a small polar-to-cartesian helper); legend rows with amount (via `MoneyText`) and `Math.round(share*100)%`.
- [ ] **Step 4:** Run; expect PASS. `npm run check:lint`.
- [ ] **Step 5:** Commit: `feat(statistics): pie chart svg component`.

---

### Task 7: Navigation — Statistics tab and stack

**Files:**
- Modify: `src/navigation/types.ts` (add `StatisticsStackParamList`, add `StatisticsTab` to `TabParamList`)
- Create: `src/navigation/statistics.stack.tsx`
- Modify: `src/navigation/root.navigator.tsx` (register 4th tab)
- Test: extend the navigation test if one exists, else a smoke render test of the stack.

**Interfaces:**
- Consumes: `StatisticsScreen` (Task 8) — import lazily is fine, but the screen must exist; to keep this task independently testable, register a minimal placeholder screen here and swap to the real screen in Task 8. Alternatively order Task 8 before wiring — pick and note it.
- Produces: a `StatisticsTab` reachable in the tab bar with SF Symbol `chart.xyaxis.line`.

- [ ] **Step 1:** Write a failing test: rendering the root navigator shows a "Statistics" tab (by accessibility label / tab title).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Add the param lists; create `statistics.stack.tsx` mirroring `settings.stack.tsx` (`headerLargeTitle`, `resetTabStackOnBlur`); register the 4th `Tabs.Screen` with the SF Symbol icon. Point it at the Task 8 screen (or a placeholder if Task 8 is later).
- [ ] **Step 4:** Run; expect PASS. `npm run check:lint`.
- [ ] **Step 5:** Commit: `feat(statistics): navigation tab and stack`.

---

### Task 8: Statistics screen — compose data, charts, and filters

**Files:**
- Create: `src/screens/statistics/statistics.screen.tsx`, `statistics.styles.ts`
- Test: `src/screens/statistics/statistics.screen.test.tsx`
- Modify: `src/navigation/statistics.stack.tsx` (point to the real screen if Task 7 used a placeholder)

**Interfaces:**
- Consumes: `useLiveQuery` over `accountsRepo`, `holdingsRepo`, `transactionsRepo`, `ratesRepo`, `settingsRepo`; `buildCurrencySeries` (T3), `buildAccountContribution` (T4), `LineChart` (T5), `PieChart` (T6), `DateRangeField` (`src/screens/home/date-range-field/`), the account `FilterMenu` (`src/screens/home/filter-menu/`).
- Produces: `StatisticsScreen` default export.

- [ ] **Step 1:** Write failing tests (with mocked repos / fixtures): the screen renders the line chart and the pie chart and both legends; changing the selected accounts changes the pie slices; changing the date range changes the line series; an empty-data state renders both empty charts without crashing.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement: read base currency + rate table; hold selected-account `Set` and date-range state (default range = earliest transaction time to now); build `txByHolding` from `transactionsRepo`; call the two builders; render inside `Screen` with the filter bar (account multi-select + `DateRangeField`) above the two chart cards (reuse `GlassSurface`/card styling). Keep the screen thin — all math lives in `src/statistics/`.
- [ ] **Step 4:** Run; expect PASS. Run `npm run check:all`.
- [ ] **Step 5:** Commit: `feat(statistics): statistics screen with charts and filters`.

---

### Task 9: Final integration and gate

**Files:** none new (verification + any small fixups)

- [ ] **Step 1:** Run the full `npx jest` and `npm run check:all` in the worktree; both green.
- [ ] **Step 2:** Confirm the tab appears and the screen composes (reason through the render; a device build is the user's call, held for now).
- [ ] **Step 3:** Re-run `npm run check:deps`/`check:knip` to confirm `react-native-svg` is seen through the real imports (Tasks 5-6).
- [ ] **Step 4:** Commit any fixups: `chore(statistics): final integration gate`.

---

## Self-review notes
- Spec coverage: nav (T7), line chart data (T3) + component (T5), pie data (T4) + component (T6), filters + screen (T8), palette (T2), dependency (T1), gate (T9). All spec sections mapped.
- Divide-by-zero on indexing (T3) and unconvertible/zero accounts (T4) are called out explicitly.
- Ordering note: Task 7 references Task 8's screen — use a placeholder in T7 or run T8 first; the executor picks and records it.
