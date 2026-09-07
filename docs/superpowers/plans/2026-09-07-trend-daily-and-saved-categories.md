# Spending-Trend Daily Window + Saved Category Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the Statistics "Spending Trend by Category" chart from calendar-month buckets to daily buckets over the last 30 days, and let the user persist a category selection (Save/Reset) that overrides the default top-3-by-expense.

**Architecture:** Two independent changes on branch `drizzer14/light-scheme-charts` in worktree `/Users/drizzer14/orca/workspaces/pff-ios/integration-consolidated`. Change 1 reworks the pure builder `src/statistics/category-trend.ts` (bucket granularity + fixed relative window, driven by a new `now` reference param) plus one axis-label formatter in the chart component; the chart component stays bucket-agnostic. Change 2 adds a nullable JSON `settings` column via a new drizzle migration, a `settingsRepo` setter, and Save/Reset UI on the trend filter row in `statistics.screen.tsx`, replacing the top-3-only seed with `saved ?? preset`.

**Tech Stack:** React Native, TypeScript, drizzle-orm (expo/op-sqlite migrations), react-native-unistyles, react-native-svg, i18next, Jest + React Native Testing Library.

**Spec:** This plan is the spec of record (task brief from the coordinator, 2026-09-07). No separate design doc; the "Decisions / open questions" section captures the two points the user must confirm.

## Global Constraints

- **Do not regress `colorScheme` threading.** `buildCategoryTrend` already takes `colorScheme: 'light' | 'dark'` and passes it to `resolveCategoryColor`; keep it in every signature and call site.
- **Selection keys are the STABLE `categories.key` slug**, never the localized display title (title changes under a live language switch). All selection/preset/saved sets store lowercased slugs.
- **`.env` is public-only; secrets never touch the DB.** The saved selection is a user-preference category-key list, not a secret — a plain `settings` column is correct.
- **Migrations are additive and non-destructive on a live single-user DB.** The new column is nullable with no default; existing rows read `null` and behave exactly as today (fall back to preset).
- **No hand-rolled UI the design system already provides.** The Save control is the shared `Button`; the Reset control is the shared `SymbolIcon` inside a `Pressable` (the same icon-in-Pressable pattern `FilterMenu` uses — there is no icon-button primitive).
- **SF Symbol availability floor.** Device is iOS 26.6.1; a symbol whose first availability is an iOS-27/"2026" release renders blank. Use `arrow.counterclockwise` (available since iOS 13). Verify against `name_availability.plist` if any other symbol is substituted.
- **i18n parity is enforced** by `src/i18n/locales/en.uk.parity.test.ts` (identical leaf-key sets) and casing by `src/i18n/locales/en.button-casing.test.ts`. Every new `en` key needs the matching `uk` key.
- **Harness checkpoints:** run `npm run check:all` at the end of each task; run `npm run check:deep` once before declaring the feature done. Run verbose commands through an Orca terminal per `harness/kiko/skills/harness-workflow/SKILL.md`.

---

## File Structure

**Change 1 (daily window):**
- `src/statistics/category-trend.ts` — MODIFY. Replace month bucketing with day bucketing; replace `earliest..latest` span with a fixed last-30-days window anchored on a new `now` param; update type/field doc comments; drop the now-unused `minMonth`/`maxMonth` tracking.
- `src/statistics/category-trend.test.ts` — MODIFY. Rework month-oriented cases to day windows; add window-boundary and 30-bucket cases; every `build(...)` passes an explicit `now`.
- `src/design-system/components/category-trend-line/category-trend-line.component.tsx` — MODIFY only `formatAxisTime` (line ~131-132) to a day-level format and the block/type doc comments that say "month". Geometry stays bucket-agnostic.
- `src/design-system/components/category-trend-line/category-trend-line.component.test.tsx` — MODIFY the axis-label assertion(s) to the day format.
- `src/screens/statistics/statistics.screen.tsx` — MODIFY the `buildCategoryTrend({...})` call (~line 646) to pass `now`, and add `now` to that memo's dep array.

**Change 2 (saved selection):**
- `src/db/schema.ts` — MODIFY the `settings` table: add nullable `trendCategoryKeys` JSON column.
- `drizzle/migrations/0019_add_trend_category_keys.sql` — CREATE (via `drizzle-kit generate`).
- `drizzle/migrations/meta/0019_snapshot.json` — CREATE (generated).
- `drizzle/migrations/meta/_journal.json` — MODIFY (generated: appends idx 19 entry).
- `drizzle/migrations/migrations.js` — MODIFY (hand-edit: import `m0019`, add to `migrations` map — drizzle-kit does NOT touch this file).
- `src/repositories/settings.repo.ts` — MODIFY: add `setTrendCategoryKeys(keys: string[] | null)`.
- `src/repositories/settings.repo.test.ts` — MODIFY: round-trip test for the new setter (array and null).
- `src/screens/statistics/statistics.screen.tsx` — MODIFY: read `saved`, compute `preset`, seed `current = saved ?? preset`, add Save + Reset controls and their enable/press logic, add set-equality helper.
- `src/screens/statistics/statistics.styles.ts` — MODIFY: add the one-row layout style (left group + right-aligned Save).
- `src/screens/statistics/statistics.screen.test.tsx` — MODIFY: mount-uses-saved-else-preset, Save enable/disable, Reset enable/revert/clears-saved.
- `src/i18n/locales/en.ts` / `src/i18n/locales/uk.ts` — MODIFY: add `statistics.resetTrendCategories` (Reset accessibility label). Reuse existing `common.save` for the Save button label (see Decision D3).

---

## Task 1: Daily buckets over the last 30 days (builder)

**Files:**
- Modify: `src/statistics/category-trend.ts`
- Test: `src/statistics/category-trend.test.ts`

**Interfaces:**
- Consumes: `TrendTransaction` (unchanged), `resolveCategoryColor`, `resolveCategoryDisplay`, `convert`, `canConvert`, `Money`, `toMajor` (all unchanged).
- Produces: `buildCategoryTrend(input)` gains a required field `now: number` (a unix-ms reference "today"). Series shape (`CategoryTrendSeries` / `CategoryTrendPoint`) is UNCHANGED — `t` is now a UTC-midnight-of-day instant instead of first-of-month, and there are exactly 30 points per series.

Window definition (make these the literal constants in the file):
- `const TREND_WINDOW_DAYS = 30;`
- `const MS_PER_DAY = 86_400_000;`
- `dayBucket(time)` = `Date.UTC(getUTCFullYear, getUTCMonth, getUTCDate)` of `time` (UTC-midnight of the day, matching the existing UTC convention so buckets never drift in a positive-UTC-offset locale).
- `endDay = dayBucket(now)`. `startDay = endDay - (TREND_WINDOW_DAYS - 1) * MS_PER_DAY`.
- The bucket set is the 30 consecutive daily instants `startDay, startDay + MS_PER_DAY, …, endDay` (inclusive both ends).
- An expense whose `dayBucket(time)` falls OUTSIDE `[startDay, endDay]` is skipped entirely (it must not affect a series' points nor its sort `total`).

- [ ] **Step 1: Write the failing tests**

Add/rework in `category-trend.test.ts`. Anchor every build on a fixed `now`; keep the existing `DISPLAY`, `tx`, `categoryColor` helpers. Replace the JAN/FEB/MAR month constants with day-relative ones.

```ts
const NOW = Date.UTC(2025, 2, 31, 12, 0, 0); // 2025-03-31, midday UTC
const dayMs = 86_400_000;
const dayBucketOf = (t: number): number => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const buildTrend = (
  transactions: TrendTransaction[],
  extra: Partial<Parameters<typeof buildCategoryTrend>[0]> = {},
): ReturnType<typeof buildCategoryTrend> =>
  buildCategoryTrend({
    transactions,
    categoryDisplay: DISPLAY,
    rateTable: {}, // same rateTable helper the file already uses
    baseCurrency: 'UAH',
    defaultCategoryKey: 'other',
    colorScheme: DARK,
    now: NOW,
    ...extra,
  });

it('emits exactly 30 daily buckets ending on now, ascending', () => {
  const series = buildTrend([tx({ time: NOW, amountMinorUnits: -10_00 })]);
  const points = series[0].points;
  expect(points).toHaveLength(30);
  expect(points[29].t).toBe(dayBucketOf(NOW));
  expect(points[0].t).toBe(dayBucketOf(NOW) - 29 * dayMs);
  for (let i = 1; i < points.length; i += 1) {
    expect(points[i].t - points[i - 1].t).toBe(dayMs);
  }
});

it('buckets a same-day expense into that UTC day and no other', () => {
  const series = buildTrend([tx({ time: NOW, amountMinorUnits: -25_00 })]);
  const nonZero = series[0].points.filter((p) => p.amount !== 0);
  expect(nonZero).toEqual([{ t: dayBucketOf(NOW), amount: 25 }]);
});

it('drops expenses older than the 30-day window (no bucket, no total)', () => {
  const old = tx({ time: NOW - 40 * dayMs, amountMinorUnits: -99_00, category: 'transport' });
  const recent = tx({ time: NOW - 2 * dayMs, amountMinorUnits: -10_00, category: 'groceries' });
  const series = buildTrend([old, recent]);
  expect(series.map((s) => s.key)).toEqual(['groceries']); // transport fully excluded
});

it('keeps the window fixed regardless of the newest transaction being old', () => {
  const series = buildTrend([tx({ time: NOW - 100 * dayMs, amountMinorUnits: -5_00 })]);
  // Every point is zero because the only expense is outside the window; empty series.
  expect(series).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/statistics/category-trend.test.ts` (via an Orca terminal).
Expected: FAIL — `now` is not yet a param; buckets are still monthly.

- [ ] **Step 3: Rework the builder**

In `category-trend.ts`:
1. Replace `monthBucket` with `dayBucket` (UTC-midnight-of-day) and add the `TREND_WINDOW_DAYS` / `MS_PER_DAY` constants.
2. Replace `monthsBetween(earliest, latest)` with `daysWindow(now)` returning the 30-instant array `startDay..endDay`.
3. In `accumulateSpend`, add `now` (or the precomputed `startDay`/`endDay`) to its input; after computing `const day = dayBucket(transaction.time)`, `continue` when `day < startDay || day > endDay`. Remove `minMonth`/`maxMonth` and the `TrendTotals` min/max fields — `accumulateSpend` now returns just `{ totals }`.
4. In `buildCategoryTrend`, destructure `now` from input, compute `const days = daysWindow(now)`, and map each series' points over `days` (`entry.byDay.get(t) ?? 0`). Rename the accumulator field `byMonth` → `byDay`.
5. Update every doc comment that says "month" / "calendar-month" / "first-of-month" to the day-window wording (the `CategoryTrendPoint` comment, the `CategoryTrendSeries` comment, the `TrendTransaction` comment about which bucket `time` decides, the `buildCategoryTrend` JSDoc). State: "each point is that category's total EXPENSE for one UTC-day bucket; the series spans the last 30 days ending today (`now`), so every series has exactly 30 points."

Signature after change:
```ts
export const buildCategoryTrend = (input: {
  transactions: TrendTransaction[];
  categoryDisplay: ReadonlyMap<string, { title: string; icon: string; color: string | null }>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  colorScheme: 'light' | 'dark';
  now: number;
  excludedCategories?: ReadonlySet<string>;
  excludedTransactionIds?: ReadonlySet<string>;
}): CategoryTrendSeries[] => { /* ... */ };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/statistics/category-trend.test.ts`.
Expected: PASS.

- [ ] **Step 5: Update the screen call site**

In `statistics.screen.tsx`, the `trendSeries` memo (~line 646): add `now,` to the `buildCategoryTrend({...})` argument and add `now` to the memo's dependency array (~line 659-667). `now` is already defined at mount (`const now = useMemo(() => Date.now(), []);`, ~line 190).

- [ ] **Step 6: Run check:all**

Run: `npm run check:all` (via an Orca terminal). Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/statistics/category-trend.ts src/statistics/category-trend.test.ts src/screens/statistics/statistics.screen.tsx
git commit -m "feat(statistics): bucket spending trend by day over the last 30 days"
```

---

## Task 2: Day-level axis label (chart component)

**Files:**
- Modify: `src/design-system/components/category-trend-line/category-trend-line.component.tsx`
- Test: `src/design-system/components/category-trend-line/category-trend-line.component.test.tsx`

**Interfaces:**
- Consumes: `CategoryTrendSeries` (unchanged), `activeLocale()`.
- Produces: no signature change. Only `formatAxisTime` output changes and doc comments.

- [ ] **Step 1: Write/adjust the failing test**

In the component test, assert the X-axis labels read as day-level (e.g. `Mar 31`), not `Mar 25`-style month/year. Locate the existing X-axis-label assertion (search for `formatAxisTime` output or an `x-tick` label) and update its expected string to the day format for the fixtures' timestamps under the test locale. If no such assertion exists, add one that renders a series spanning known day buckets and asserts a `category-trend-line-x-tick-*` label matches `/^[A-Za-z]{3} \d{1,2}$/` (month-abbrev + day-of-month).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/design-system/components/category-trend-line/category-trend-line.component.test.tsx`.
Expected: FAIL — formatter still emits `{ month: 'short', year: '2-digit' }`.

- [ ] **Step 3: Change the formatter and comments**

```ts
const formatAxisTime = (t: number): string =>
  new Date(t).toLocaleDateString(activeLocale(), { month: 'short', day: 'numeric' });
```
Update the component's top-of-file block comment and the `CategoryTrendLineProps` doc that say "calendar-month bucket" / "month buckets on the X axis" to "one UTC-day bucket" / "day buckets over the last 30 days". Leave all geometry (`buildScales`, `buildXTicks`, `X_TICK_FRACTIONS`) untouched — it already reads `point.t` as opaque timestamps and is bucket-agnostic.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/design-system/components/category-trend-line/category-trend-line.component.test.tsx`.
Expected: PASS.

- [ ] **Step 5: Run check:all and commit**

Run: `npm run check:all`.
```bash
git add src/design-system/components/category-trend-line/
git commit -m "feat(statistics): render trend x-axis as day-level labels"
```

---

## Task 3: Persist the trend category selection (schema + migration + repo)

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/migrations/0019_add_trend_category_keys.sql`, `drizzle/migrations/meta/0019_snapshot.json`
- Modify: `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js`, `src/repositories/settings.repo.ts`
- Test: `src/repositories/settings.repo.test.ts`

**Interfaces:**
- Produces: `settings.trendCategoryKeys: string[] | null` on `SettingsRow`; `settingsRepo.setTrendCategoryKeys(keys: string[] | null)` (writes the JSON array, or `null` to clear).

- [ ] **Step 1: Add the schema column**

In `schema.ts`, inside `settings` (after `appearance`), add:
```ts
  // The user's SAVED spending-trend category selection: a JSON array of stable
  // `categories.key` slugs that overrides the default "top 3 by expense" seed on
  // the Statistics trend chart. NULL means "no saved selection" — the chart falls
  // back to the live top-3-by-expense preset. Written by settingsRepo
  // .setTrendCategoryKeys (Save persists the current set; Reset clears to null).
  trendCategoryKeys: text('trend_category_keys', { mode: 'json' }).$type<string[]>(),
```
No `.notNull()` and no `.default(...)` — the column is nullable so existing rows read `null`.

- [ ] **Step 2: Generate the migration**

Run (via an Orca terminal): `npx --no-install drizzle-kit generate --name add_trend_category_keys`.
Expected output: `drizzle/migrations/0019_add_trend_category_keys.sql`, `meta/0019_snapshot.json`, and an appended idx-19 entry in `meta/_journal.json`. Verify the `.sql` is purely additive:
```sql
ALTER TABLE `settings` ADD `trend_category_keys` text;
```
If drizzle-kit emits anything beyond a single additive `ADD` on `settings`, STOP and reconcile — the migration must be non-destructive (see Global Constraints).

- [ ] **Step 3: Wire the migration into migrations.js (hand-edit)**

drizzle-kit does not touch `migrations.js`. Add the import next to `m0018`:
```js
import m0018 from './0018_add_appearance.sql';
import m0019 from './0019_add_trend_category_keys.sql';
```
and add `m0019,` to the `migrations` object after `m0018`.

- [ ] **Step 4: Write the failing repo test**

In `settings.repo.test.ts`, add a round-trip using the existing `makeSettingsRowTx` + `spyOnSettingsSelect` harness:
```ts
it('persists a saved trend selection and clears it with null', async () => {
  const store: Record<string, unknown>[] = [{ id: 1 }];
  mockTx = makeSettingsRowTx(store);
  spyOnSettingsSelect(store);

  await settingsRepo.setTrendCategoryKeys(['groceries', 'transport']);
  expect(store[0].trendCategoryKeys).toEqual(['groceries', 'transport']);

  await settingsRepo.setTrendCategoryKeys(null);
  expect(store[0].trendCategoryKeys).toBeNull();
});
```
(Match the file's actual `mockTx`/helper wiring — mirror an existing setter test in that file exactly.)

- [ ] **Step 5: Run test to verify it fails**

Run: `npx jest src/repositories/settings.repo.test.ts`.
Expected: FAIL — `setTrendCategoryKeys` is not defined.

- [ ] **Step 6: Add the setter**

In `settings.repo.ts`, add to the `settingsRepo` object:
```ts
  /**
   * Persist (or clear) the user's saved spending-trend category selection: a
   * JSON array of stable `categories.key` slugs, or `null` to fall back to the
   * live top-3-by-expense preset. Written by Save; cleared to `null` by Reset.
   */
  setTrendCategoryKeys: (keys: string[] | null) =>
    write((tx) =>
      tx.update(settings).set({ trendCategoryKeys: keys }).where(eq(settings.id, SETTINGS_ID)),
    ),
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest src/repositories/settings.repo.test.ts src/db/settings-columns.test.ts`.
Expected: PASS. `settings-columns.test.ts` passes because `trendCategoryKeys` is now referenced in `settings.repo.ts` (and the screen in Task 4) outside `schema.ts` — no exception-list entry is needed.

- [ ] **Step 8: Run check:all and commit**

Run: `npm run check:all`.
```bash
git add src/db/schema.ts drizzle/migrations/ src/repositories/settings.repo.ts src/repositories/settings.repo.test.ts
git commit -m "feat(settings): add nullable trendCategoryKeys column + setter"
```

---

## Task 4: Save / Reset UI + saved-else-preset seed (screen)

**Files:**
- Modify: `src/screens/statistics/statistics.screen.tsx`, `src/screens/statistics/statistics.styles.ts`
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts`
- Test: `src/screens/statistics/statistics.screen.test.tsx`

**Interfaces:**
- Consumes: `settingsRepo.setTrendCategoryKeys` (Task 3), `settingsRows.at(0)?.trendCategoryKeys` (live query already read at ~line 160), `allCategorySlices` (already computed, sorted by spend desc), `selectedTrendCategories` state + `setSelectedTrendCategories`.
- Produces: nothing consumed downstream.

Definitions to implement:
- `preset` = `new Set(allCategorySlices.slice(0, 3).map((s) => s.key))` — the live top-3-by-expense (memoize as `presetTrendKeys`).
- `saved` = `settingsRows.at(0)?.trendCategoryKeys ?? null` (a `string[] | null`); `savedSet = saved ? new Set(saved) : null`.
- `current` = the existing `selectedTrendCategories` state Set.
- Set-equality helper (order-independent):
```ts
const sameKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((key) => b.has(key));
```

- [ ] **Step 1: Add i18n keys**

`en.ts` — inside the `statistics` block (keep alpha order), add:
```ts
    resetTrendCategories: 'Reset to default',
```
`uk.ts` — matching key in its `statistics` block:
```ts
    resetTrendCategories: 'Скинути до типових',
```
Use existing `common.save` (`'Save'` / `'Зберегти'`) for the Save button label — do not add a new Save key (see Decision D3). The `en.uk.parity` and `en.button-casing` tests must stay green.

- [ ] **Step 2: Write the failing screen tests**

In `statistics.screen.test.tsx`, add (mirror the file's existing render/query helpers and DB mocks). Assert against the existing `testID="statistics-trend-filter"` label (`Categories · N`) and the new controls `testID="statistics-trend-save"` / `testID="statistics-trend-reset"`:
- **Mount uses saved when present:** seed the settings mock row with `trendCategoryKeys: ['transport']` and assert the filter label reads `Categories · 1` (not the top-3 `· 3`) after data settles.
- **Mount uses preset when saved is null:** `trendCategoryKeys: null` → filter label `Categories · 3`.
- **Save disabled at preset:** with saved null and current == preset, `statistics-trend-save` is `disabled`.
- **Save enabled after a change, then persists:** toggle one category off, assert Save enabled, press it, assert `settingsRepo.setTrendCategoryKeys` called with the current keys.
- **Save disabled when current == saved:** with saved `['a','b']` and current `['a','b']`, Save disabled.
- **Reset disabled at preset, enabled after change; press reverts + clears:** after a change, `statistics-trend-reset` enabled; pressing it restores the label to `Categories · 3` and calls `setTrendCategoryKeys(null)`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/screens/statistics/statistics.screen.test.tsx`.
Expected: FAIL — controls and seed logic not present.

- [ ] **Step 4: Replace the seed effect**

Replace the top-3-only seed effect (~lines 540-547) so it seeds `current = saved ?? preset` exactly once, gated on the preset being available:
```ts
useEffect(() => {
  if (trendSeededRef.current || allCategorySlices.length === 0) {
    return;
  }
  trendSeededRef.current = true;
  const preset = allCategorySlices.slice(0, 3).map((slice) => slice.key);
  const saved = settingsRows.at(0)?.trendCategoryKeys ?? null;
  setSelectedTrendCategories(new Set(saved ?? preset));
}, [allCategorySlices, settingsRows]);
```
Update the effect's comment to describe `saved ?? preset`. (The `trendSeededRef` guard still prevents clobbering later user edits.)

- [ ] **Step 5: Add the derived state (preset, saved, enable flags)**

Near the other trend memos, add:
```ts
const presetTrendKeys = useMemo(
  () => new Set(allCategorySlices.slice(0, 3).map((slice) => slice.key)),
  [allCategorySlices],
);
const savedTrendKeys = useMemo(() => {
  const saved = settingsRows.at(0)?.trendCategoryKeys ?? null;
  return saved ? new Set(saved) : null;
}, [settingsRows]);

// Save is enabled only when the current selection differs from the preset AND
// from the last-saved selection (disabled at the preset, and disabled when
// nothing changed since the last Save — see plan Decision D1).
const canSaveTrend =
  !sameKeys(selectedTrendCategories, presetTrendKeys) &&
  !(savedTrendKeys !== null && sameKeys(selectedTrendCategories, savedTrendKeys));

// Reset is enabled whenever the current selection differs from the preset.
const canResetTrend = !sameKeys(selectedTrendCategories, presetTrendKeys);

const saveTrendSelection = (): void => {
  void settingsRepo.setTrendCategoryKeys([...selectedTrendCategories]);
};
const resetTrendSelection = (): void => {
  setSelectedTrendCategories(new Set(presetTrendKeys));
  void settingsRepo.setTrendCategoryKeys(null);
};
```
Add the `sameKeys` helper near `toggleFilter` (module scope).

- [ ] **Step 6: Add the layout style**

In `statistics.styles.ts`, add:
```ts
  // The trend filter row: FilterMenu + Reset icon left-grouped, Save right-aligned.
  trendFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trendFilterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  // The icon-only Reset control; dims when disabled (mirrors Button's disabled).
  trendResetButton: {
    padding: theme.spacing[1],
  },
  trendResetDisabled: {
    opacity: 0.4,
  },
```
(Use the theme's real spacing token names — mirror what `filterBar`/other styles use.)

- [ ] **Step 7: Render Save + Reset on the trend row**

Replace the trend filter `Box` (~lines 786-794) with the one-row layout `[Categories · N] [reset]        [Save]`:
```tsx
<Box direction="row" style={styles.trendFilterBar}>
  <Box direction="row" style={styles.trendFilterLeft}>
    <FilterMenu
      label={t('statistics.filterCategories')}
      testID="statistics-trend-filter"
      options={categoryOptions}
      selected={selectedTrendCategories}
      onToggle={toggleFilter(setSelectedTrendCategories)}
    />
    <Pressable
      testID="statistics-trend-reset"
      accessibilityRole="button"
      accessibilityLabel={t('statistics.resetTrendCategories')}
      disabled={!canResetTrend}
      onPress={resetTrendSelection}
      style={[styles.trendResetButton, !canResetTrend && styles.trendResetDisabled]}
    >
      <SymbolIcon name="arrow.counterclockwise" size={18} />
    </Pressable>
  </Box>

  <Button
    testID="statistics-trend-save"
    size="compact"
    fullWidth={false}
    disabled={!canSaveTrend}
    onPress={saveTrendSelection}
  >
    {t('common.save')}
  </Button>
</Box>
```
Add the imports at the top of the screen if missing: `Pressable` from `react-native`, `SymbolIcon` from the design-system symbol component, and `Button` from the design-system button component. (`Button` requires a `testID` prop — confirm `ButtonProps` allows `testID`; if not, wrap in a `View` carrying the testID, or extend `ButtonProps` in a separate designer task. See Decision D4.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest src/screens/statistics/statistics.screen.test.tsx`.
Expected: PASS.

- [ ] **Step 9: Run check:all and commit**

Run: `npm run check:all`.
```bash
git add src/screens/statistics/ src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "feat(statistics): save/reset persisted trend category selection"
```

---

## Task 5: Full verification

- [ ] **Step 1: Full unit suite** — Run `npx jest` (via Orca terminal). Expected: green.
- [ ] **Step 2: Deep checks** — Run `npm run check:deep`. Expected: mutation score ≥ 60 and osv-scanner clean apart from the pre-tracked, documented CVEs in CLAUDE.md (image-size, decode-uri-component). Do NOT suppress anything to get green.
- [ ] **Step 3: On-device verification (ops)** — Hand to the ops agent: `npm run deploy:device`, then on the phone confirm (a) the trend chart shows daily labels over the last 30 days, (b) Save is disabled at the top-3 default, (c) changing the selection enables Save + Reset, (d) Save persists across an app relaunch, (e) Reset reverts to top-3 and re-disables both. Existing installs (null column) must open unchanged.

---

## Button-state truth table

Let `P` = preset set (top-3-by-expense), `S` = saved set (`null` when no saved selection), `C` = current selection. `≟` is order-independent set-equality (`sameKeys`).

| Case | C ≟ P | S | C ≟ S | Save enabled | Reset enabled |
|---|---|---|---|---|---|
| Fresh, at default | yes | null | — | **no** | **no** |
| Fresh, changed from default | no | null | — | **yes** | **yes** |
| Has saved, showing saved (=default) | yes | =P | yes | **no** | **no** |
| Has saved, showing saved (≠default) | no | S | yes | **no** | **yes** |
| Has saved, changed away from saved (≠default) | no | S | no | **yes** | **yes** |
| Has saved, changed back to default | yes | S(≠P) | no | **no** | **no** |

Rules restated:
- **Save enabled** ⇔ `C ≠ P` AND (`S` is null OR `C ≠ S`).
- **Reset enabled** ⇔ `C ≠ P`.
- **Save press** → `setTrendCategoryKeys([...C])` (S becomes C).
- **Reset press** → `C := P` and `setTrendCategoryKeys(null)` (S becomes null).

---

## Decisions / open questions

- **D1 — Save also disabled when already-saved (refinement of the literal spec).** The spec says "Save is disabled when exactly the preset categories are selected." This plan additionally disables Save when the current selection equals the *already-saved* selection (no-op re-save). This matches normal Save-button semantics and is reflected in the truth table. **Confirm** this refinement, or Save should be enabled for any non-preset selection even if unchanged since the last save.
- **D2 — Day-axis label format.** Plan uses `toLocaleDateString(locale, { month: 'short', day: 'numeric' })` → e.g. `Mar 31` / locale-appropriate. Alternatives: `{ day: 'numeric' }` (just the day-of-month, shortest) or `{ month: 'numeric', day: 'numeric' }` (`3/31`). With only 5 X-ticks across 30 days, month+day reads clearest across a month boundary. **Confirm** the format.
- **D3 — Reuse `common.save` for the Save label.** `common.save` already exists as `'Save'` / `'Зберегти'` (exactly the Ukrainian the user specified). The plan reuses it rather than adding `statistics.saveTrendCategories`. If a chart-specific label is preferred later, add a dedicated key. **Confirm** reuse is acceptable.
- **D4 — `Button` testID / icon-only.** The Save control is the shared `Button`; confirm `ButtonProps` accepts `testID` (if not, this is a tiny designer task to add it, or wrap in a testID-bearing `View`). The Reset control is an icon-only `Pressable` + `SymbolIcon` because there is no icon-button primitive in the design system — if the designer wants a reusable `IconButton`, that is a separate follow-up, not in scope here.
- **D5 — Stale saved keys.** A saved key whose category was later deleted simply won't match any live slice (it contributes nothing to the chart and shows as `Categories · N` counting the stored key). This is harmless and left as-is; flag if the user wants saved keys pruned against live categories on load.
- **D6 — SF Symbol.** Reset uses `arrow.counterclockwise` (iOS 13+, safe on the iOS 26.6.1 device). Substitute only after checking `name_availability.plist`.
