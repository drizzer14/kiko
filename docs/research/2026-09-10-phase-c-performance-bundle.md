# Phase C — Performance and Bundle-Size Audit (Kiko iOS)

## Method

This audit covers runtime performance and bundle size across `src/`. The
worktree is `final-hardening-audit` at `82b9145` (clean tree). The audit
used static analysis only. There was no build, no on-device profiling,
and no `node_modules` present. Every runtime cost below is **estimated**
unless the text states otherwise. The auditor reconciled the findings
against `docs/superpowers/specs/2026-09-06-bug-hunt-tasks.md` and
`docs/security/2026-09-06-security-pass-findings.md`. The only
performance-adjacent prior item (T-27, the widget's over-broad live
query) is **moot** — the net-worth widget was fully removed. The `.env`
inlining is clean: all values are public URLs, per the CLAUDE.md rule.
This was verified and is not a finding.

## Findings (most severe first)

### C1 — The `transactions` table has no index on `holding_id` or `time`

- **Claim:** The `transactions` table has no index on `holding_id` or
  `time`, so filter and sort queries do full table scans.
- **Where:** `src/db/schema.ts:59-115` (the only index is
  `uniqueIndex('transactions_source_external')` on
  `(source, external_id)`). Confirmed against every migration:
  `drizzle/migrations/*.sql` creates no other index on `transactions`.
- **Failure scenario:** SQLite does not auto-index foreign keys. Every
  `where(eq(transactions.holdingId, …))` (`listByHoldingQuery`,
  `latestSyncedTimeQuery`, `holdingIdsWithHoldQuery` in
  `transactions.repo.ts`) does a full table scan. Every
  `orderBy(desc(transactions.time))` (`listAllQuery`,
  `listAllWithContextQuery`) does a full sort of the whole table. These
  are the queries behind Home, Statistics, holding-detail, and the sync
  cursor. They re-run on every reactive fire (see C5).
- **Expected win (estimated):** Holding-detail open and the incremental
  sync cursor change from an O(rows) scan to an O(log n) seek. The two
  ordered list queries get an index-ordered read instead of a full sort
  on each fire. The win is largest on a synced Monobank history with
  thousands of rows.
- **Severity:** High.
- **Proposed fix:** Add a migration that creates an index on
  `transactions(holding_id)` and an ordering index on
  `transactions(time)`, or a combined `(holding_id, time)` index to
  serve both the per-holding filter and the descending-time order.
  Declare them in the Drizzle schema so a regenerate does not drop them.

### C2 — The holding-detail transaction ledger is not virtualized

- **Claim:** The holding-detail ledger renders every row eagerly with
  `.map()` inside a ScrollView instead of a virtualized list.
- **Where:** `src/screens/holding-detail/holding-detail.screen.tsx:361`
  (`ledger.map(...)`) inside `<Screen scroll>` (near line 300). The
  `ledger` is built at lines 246-253.
- **Failure scenario:** Home uses a virtualized `SectionList`, but
  holding-detail renders every ledger row eagerly. Each row is a
  `GlassSurface` (a real Liquid Glass native view on iOS 26+) plus, for
  stored rows, a `SwipeableRow` (PanResponder). A synced Monobank card
  can carry hundreds to thousands of transactions. All rows mount at once
  on screen open.
- **Expected win (estimated):** The mount cost and memory on open of a
  high-volume holding become bounded. This removes a likely multi-hundred
  millisecond first-paint stall and scroll jank. Confirm with an
  on-device trace on a holding that has a large history.
- **Severity:** High.
- **Proposed fix:** Render the ledger through a virtualized `FlatList`
  instead of `.map()`. Keep the derived-plus-stored merge as the `data`.
  Keep the header and summary as a `ListHeaderComponent`.

### C3 — No component uses `React.memo`; Home rows and Statistics charts re-render every parent render

- **Claim:** No component in the app uses `React.memo`, so Home rows and
  the Statistics charts re-render on every parent render.
- **Where:** A grep for `React.memo` or `= memo(` across `src` returns
  zero hits. Home `renderTransaction` and `renderDayHeader` are recreated
  every render (`home.screen.tsx:396,459`, not `useCallback`). The charts
  `PieChart`, `BarChart`, `NetWorthLine`, and `CategoryTrendLine` are
  plain function components with no internal `useMemo` on geometry
  (`pie-chart.component.tsx:205-208`, `bar-chart.component.tsx:117`,
  `net-worth-line.component.tsx:455,638`).
- **Failure scenario:** Statistics is well-memoized at the data layer.
  But because the six chart children are not memo-wrapped, every screen
  re-render (each reactive fire during a sync, each filter or date
  change) re-invokes all six charts and recomputes their scales, arcs,
  and segments even when their memoized slice arrays are unchanged. On
  Home, a new `renderItem` identity each render defeats the SectionList
  row bail-out, so all visible rows re-run `resolveCategoryDisplay`,
  `transactionRowDescription`, and `Money.of` on every filter toggle.
- **Expected win (estimated):** Filter and date interactions and mid-sync
  re-renders stop repeating chart geometry and row work whose inputs did
  not change. Confirm with a React DevTools or Flipper render-count
  profile while you toggle a filter and during a sync.
- **Severity:** Medium.
- **Proposed fix:** Wrap the four chart components in `React.memo`.
  Extract the Home transaction row into its own `React.memo` component.
  Wrap `renderTransaction` and `renderDayHeader` in `useCallback` so
  stable props let the memo bail out.

### C4 — The Accounts screen recomputes an N×M holdings filter plus net worth per card, every render

- **Claim:** The Accounts screen filters all holdings per card and
  recomputes net worth per card on every render, with no memoization.
- **Where:** `src/screens/accounts/accounts.screen.tsx:109-113` —
  `renderItem` calls `holdings.filter(h => h.accountId === item.id …)`
  per card, then `guardedNetWorth(...)` per card. Nothing is memoized
  (`activeAccounts` and `rateTable` are rebuilt each render). The same
  class of problem is in holding-detail: `ledger` (merge and sort) and
  `holdingNameById` (`new Map`) are rebuilt every render (holding-detail
  uses zero `useMemo`, verified).
- **Failure scenario:** For A accounts and H holdings, this is O(A×H)
  filtering plus A currency-conversion passes on every render. Accounts
  re-renders on every reactive fire during a sync (its four live
  queries). Holding-detail re-sorts its full ledger on every render or
  state change.
- **Expected win (estimated):** This collapses the per-card filtering to
  one O(H) group-by pass and stops re-sorting the ledger when unrelated
  state changes. The win is small on a lean account set and grows with
  the holding count and the sync fire frequency.
- **Severity:** Medium.
- **Proposed fix:** Build a `holdingsByAccount` Map once with `useMemo`
  and index into it per card. Memoize `ledger`, `holdingNameById`, and
  `derived` in holding-detail on their real inputs.

### C5 — Each reactive fire re-runs the full query; Home holds six live queries including a full join and sort

- **Claim:** Each reactive fire re-runs the full query, and Home holds
  six live queries including a full join and sort of all transactions.
- **Where:** `src/db/use-live-query.ts:44-102` (it re-awaits the entire
  `query` on every `reactiveExecute` callback and sets a fresh array).
  `home.screen.tsx:157-166` (six live queries, including
  `listAllWithContextQuery`, a two-way inner join over all transactions
  ordered by descending time, `transactions.repo.ts:246-269`).
- **Failure scenario:** A multi-card Monobank sync commits each card's
  transactions in its own transaction for fault isolation, so N cards
  cause N reactive fires. Each fire re-runs the full join and sort
  (unindexed — see C1) and re-drives the whole Home memo pipeline
  (`categoryOptions` iterating all rows, `filteredTransactions`,
  `groupByDay`). A minor extra cost: `query.toSQL()` plus
  `JSON.stringify(params)` run for all six or seven queries on every
  render (`use-live-query.ts:32-33`).
- **Expected win (estimated):** There are fewer full re-scans during a
  sync (compounded by C1's missing `time` index) and a smoother mid-sync
  Home. Most of this is inherent to the reactive model. The realistic
  lever is C1 plus not re-serializing the SQL each render. Confirm by
  counting query executions during a real multi-card sync.
- **Severity:** Medium.
- **Proposed fix:** Land C1 first, because indexes make each re-run
  cheap. Optionally cache each query's `toSQL()` result keyed by the
  builder so `useLiveQuery` does not re-serialize every render. Consider
  whether the per-card loop can batch its commits without losing fault
  isolation. This is a larger change — flag it, do not force it.

### C6 — `react-native-calendars` is a heavy dependency for one date-range sheet

- **Claim:** `react-native-calendars` is a large dependency used only for
  one date-range sheet.
- **Where:** `package.json:44`. It is used only via `KikoCalendar`
  behind the date-range `BottomSheet`
  (`src/screens/home/date-range-field/date-range-field.component.tsx:14`,
  mounted on `open` state) and the `DateField` form field.
- **Failure scenario (estimated):** `react-native-calendars`
  transitively pulls `xdate` and lodash-family utilities and is one of
  the larger JavaScript dependencies. It is bundled into the main Hermes
  bundle. React Native has no code-splitting, so a lazy import would
  defer module init, not shrink the bundle. This could not be measured
  because `node_modules` is absent in this worktree.
- **Severity:** Low.
- **Proposed fix:** During an on-device or bundle-analyzer pass, measure
  its contribution. If it dominates, weigh replacing the single-purpose
  range calendar with a lighter or hand-rolled month grid (the app
  already hand-rolls its charts). Do not act without a measured size.

### C7 — Inline style objects and inline callbacks are recreated per render

- **Claim:** Inline style objects and inline callbacks create new
  identities each render and defeat child memoization.
- **Where:** For example, `holding-detail.screen.tsx:336`
  (`style={{ flexDirection: 'row', justifyContent: 'space-between' }}`
  inside a `.map`), and inline `renderItem` and `onPress` closures across
  Home and Accounts. This also breaks the kiko-design-system rule to
  prefer a `Box direction` prop over an inline style.
- **Failure scenario (estimated):** New object and function identities
  each render are negligible on their own. But they defeat any child
  memoization added in C3 or C4.
- **Severity:** Low.
- **Proposed fix:** Move static style objects into the `.styles.ts`
  module or into `Box` props. Hoist stable callbacks. Do this together
  with C3 and C4 so the memo bail-outs engage.

## Measured vs estimated

- **Verified statically (not runtime-measured):** the missing
  `transactions` indexes (C1 — read the schema and all migrations);
  holding-detail renders via `.map()` in a ScrollView with zero `useMemo`
  (C2 and C4 — read the file); zero `React.memo` usage app-wide and no
  internal chart geometry memo (C3 — grep and read); the N×M per-card
  filter in Accounts (C4 — read the file); `useLiveQuery` re-awaits the
  full query per fire and Home holds six queries including the full join
  (C5 — read both files); `.env` contains only public URLs (no finding).
- **Estimated (could not profile — no build, no device, no
  `node_modules`):** every latency, jank, and memory magnitude; the
  sync-time re-render counts; and all bundle-size weights (C6
  especially).
- **An on-device profiling pass should measure:**
  1. `EXPLAIN QUERY PLAN` on `listByHoldingQuery` and
     `listAllWithContextQuery` before and after C1, to confirm the
     scan-to-seek change and the sort elimination.
  2. A Flipper or Instruments trace opening a high-volume synced holding,
     to quantify C2's first-paint and memory.
  3. React render-count plus commit duration on Home and Statistics while
     you toggle a filter and during a real multi-card Monobank sync
     (C3 and C5).
  4. A Metro bundle-size or source-map-explorer report to rank
     `react-native-calendars` and confirm C6.
