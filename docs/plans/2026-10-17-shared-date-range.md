# Shared date range for Home and Statistics: plan

Brief (user-approved): `memory/refs/brief-shared-date-range.md`. Base: `0c456466`.
Every fact below names a symbol or anchor text. Re-grep each one on the actual base before you
rely on it. Every count is a floor; measure it again.

## Findings

- **Launch behaviour today: the range resets at launch.** `useDateRangeSelection` holds the pick in
  `useState<CustomRange | null>(null)`, and `null` means "derive `defaultDateRange(now)`". Nothing
  persists it: there is no MMKV or AsyncStorage anywhere in `src/`, the `settings` table in
  `src/db/schema.ts` has no range column, and no other range state exists. The shared range keeps
  this behaviour: it lives in memory and starts on the default at every launch.
- **Consumers (floor: 2).** Only `src/screens/home/home.screen.tsx` (import plus the
  `useDateRangeSelection(now)` call) and `src/screens/statistics/statistics.screen.tsx` (the same
  two lines) use it. No test mocks `@kiko/design-system/use-date-range-selection`. Tests that depend
  on its behaviour: `use-date-range-selection.test.ts` (5 its) and both screen test files. Several
  its in each screen file apply a range (the `'Apply'` press after `date-range-calendar`
  `onDayPress`), and later its expect the default (`'defaults the date-range field to the last 30
  days…'`). This means shared state must not leak between its.
- **`now` (ruling D2: one default from one clock).** Each screen keeps passing its own `now`: Home
  passes `Date.now()` per render and Statistics passes `useFocusRefreshedNow()`. The store keeps a
  `clock`, the LATEST `now` any reader has published (it only moves forward). Every reader derives
  the default from that one clock, so both screens always show the same default. Results stay the
  same because every consumer day-aligns the bounds: Home's `dateRangeBounds`, Statistics'
  `rangeFrom`/`rangeTo` (`startOfLocalDay`/`endOfLocalDay`), and the field's date-only
  `activeRangeLabel`. The default's `to` instant may be earlier than the caller's `now` on the same
  day, but no consumer reads that instant. A pick is the same `Date` objects on both screens.

## Mechanism (chosen)

The pick moves into one module-level store with `useSyncExternalStore`, inside
`src/design-system/use-date-range-selection/use-date-range-selection.ts`. The codebase already uses
this pattern for state that several screens show: `src/monobank/sync-status/sync-status.ts`,
`src/reminders/permission/use-notification-permission.ts`, and kiko-architecture's "Shared system
status" bullet ("lives in ONE module store … never in per-component `useState`").

- No provider, so there is no mount point. It works on every layout (Duo inner two-pane, iPad, Duo
  outer, iPhone) because every mounted reader subscribes to the same module.
- **Resets when the last reader unsubscribes** (the `listeners.size === 0` reset in
  `use-notification-permission.ts`). Today a range lives as long as its screen stays mounted. Now
  it lives as long as either screen stays mounted. The tabs stay mounted in the app, so a pick
  survives a tab switch, the same as today. In jest, RNTL's auto-cleanup unmounts after each it, so
  the existing screen its stay independent with no test-only reset export.
- **Clock (D2), option (a).** Each reader publishes its `now` in a `useLayoutEffect` keyed on
  `now`; it never writes the store during render. `publishNow(next)` ignores a `next` that is not
  newer than `clock`. A newer `next` on the same local day (`startOfLocalDay`) updates `clock`
  silently: the snapshot object stays the same and nobody is notified. Only a newer DAY (or a pick
  or a Clear) replaces the snapshot `{ customRange, defaultRange }` and notifies. Home publishes a
  newer `Date.now()` on every render, so a same-day publish must not change the snapshot, or the
  re-render would loop. While `clock` is `null` (before the first publish, the first frame after a
  launch), a reader falls back to its own `now`. The last unsubscribe resets `clock` to `null`
  together with the pick (D1).
- **Why (a) over (b), a store-owned midnight timer or AppState clock.** A JS timer does not fire
  while the app is suspended, so (b) would also need an AppState listener. It would also ignore
  Statistics' focus refresh and add a second clock source. (a) keeps today's triggers and only
  spreads them to both screens. It still honours the hook's reason: a tab left mounted past
  midnight moves to the new day on the next trigger from either screen.
- **Midnight crossing, Duo inner screen, no pick.** (1) Something re-renders Home after midnight
  (a focus change, a data write). Home renders with the store's old-day default, because the clock
  is still yesterday's. (2) Home's layout effect publishes the new-day `Date.now()`. The day
  changed, so the store notifies. (3) Home and Statistics re-render synchronously in the
  layout-effect phase, before paint, and both show the new-day default. (4) Home's re-render
  publishes a newer `now` on the same day. That is silent, so there is no loop. Statistics' own
  older `now` is ignored because it is not newer. A Statistics re-focus first does the same
  through its `setNow`. **No frame shows two ranges:** the publish runs in a layout effect, so both
  panes commit the new day before the next paint. The window lasts only inside one commit and is
  not visible. The trigger is any reader rendering with a later-day `now` (Home re-render,
  Statistics focus); no timer is involved.
- No new dependency. No migration.

## Merge risk

The screen files do not change at all: the import and the `useDateRangeSelection(now)` call keep
the same text. Nothing conflicts with duo-adaptive, binance-backfill-fix or currency-pickers. The
only conflict risk is the hook file and its test. No other track touches them on the base
(re-check with `git log` on the other track tips before BATCH READY).

## Open gaps (`run-log stats --gaps`)

None of the 10 open gaps involves this area. All stay open (H7 harness carries, binance drizzle
guard and index check, the release-1-2 barrel follow-up, the currency-pickers ternary sweep). This
plan adds no migration, so it needs no `kiko:reviewer` migration step or EXPLAIN test.

## shared-date-range task 1/1

Base commit = this change set's base (`0c456466` unless the branch moved; record the sha).

### step 1/6: red hook tests (kiko:qa)

File: `src/design-system/use-date-range-selection/use-date-range-selection.test.ts`. Keep the 5
existing its unchanged. Add a `describe('shared between readers', …)` that renders TWO hooks in
ONE `render` (one probe component that calls the hook twice, or two `renderHook` calls; a pick in
one must show in the other):

- `it('shows a pick made in one reader in every mounted reader')`
- `it('clears the pick for every mounted reader')`
- (D2: replaces the dropped "each reader's own now" it.) `it('moves every reader to the new day
  when any reader passes a later-day now')`: two readers on day D; rerender reader A only with a
  `now` on D+1; both equal `defaultDateRange(that later now)` by day. Red on the base, where B
  stays on D.
- `it('keeps the newer day when a reader passes an older now')`: A on D+1, B on D; both show D+1.
  Red on the base.
- `it('does not re-render other readers when a later now falls on the same day')`: a render
  counter in the probe component. B's count is unchanged after A rerenders with a later same-day
  `now`. Passes on the base (it pins that the shared store does not loop).
- `it('keeps the pick while one reader unmounts and another stays mounted')`
- `it('starts on the default range again after every reader unmounts')` (this is the launch pin:
  nothing survives the last reader)

Red check: on the base (per-instance `useState`), the pick, clear, keep-on-unmount, later-day and
older-now its fail. The reset-after-unmount and same-day-no-re-render its pass. Mark that in the commit message; they pin unchanged behaviour. Commit red.

### step 2/6: red two-screen test (kiko:qa)

New file: `src/navigation/root-navigator/shared-date-range.navigator.test.tsx`. It sits next to the
other cross-screen navigation tests. It must not go under `src/screens/`, because
`screen-imports.js` treats the first segment under `src/screens/` as the screen, so a file there
cannot import both. Import `HomeScreen` from `@kiko/screens/home` and `StatisticsScreen` from
`@kiko/screens/statistics` (the barrels the stacks use). Render both in ONE `render` (a fragment).
Take only the mocks each screen needs from `home.screen.test.tsx` and `statistics.screen.test.tsx`.
Do not paste whole mock blocks: the new file must pass `bash scripts/checks/dup.sh` on its own.
Scope queries with `within(...)` per screen, because both screens render `date-range-calendar`,
`'Date range'` and `'Apply'`. Read the shown range from what each screen's field shows, or from the
live-query bounds each screen requests. Never parse src text.

- `it('shows the same default range on Home and Statistics')`
- `it('shows a range applied on Home on Statistics too')`
- `it('shows a range applied on Statistics on Home too')`
- `it('returns both screens to the default range when Clear is pressed on either')`
- `it('starts both screens on the default range after both unmount and mount again')` (launch pin)
- `it('moves both screens to the same new-day range after midnight with no pick')` (D2). Use jest
  modern fake timers. `jest.setSystemTime` to 23:59 on day D, then render both (assert the same
  day D range). Then `jest.setSystemTime` to 00:01 on D+1 and drive Home's trigger: RNTL
  `rerender` of the same tree, so Home reads a new `Date.now()` while Statistics keeps its mocked
  focus `now`. Assert both screens show the range ending D+1. Red on the base, where Statistics
  still shows D. If Statistics' `useFocusRefreshedNow` is mocked, keep it on day D for this it.

Red check: the second, third, fourth and sixth fail on the base. The first and fifth pass (they pin the
behaviour). Run per-file `bash scripts/checks/screen-imports.sh <file>` and
`npm run check:feature-imports`. Commit red.

### step 3/6: shared store (kiko:developer)

File: `src/design-system/use-date-range-selection/use-date-range-selection.ts` only.

- Module scope: `let sharedCustomRange: CustomRange | null = null`, a `listeners` Set, a
  `setSharedCustomRange(next)` that publishes and notifies (it exits early when `next` is the same
  object), `subscribe` (on the last unsubscribe, reset `sharedCustomRange` to `null`; do not
  notify), and `getSnapshot`. All are stable module functions, shaped like `sync-status.ts`.
- Module scope also holds `clock: number | null` and a snapshot
  `{ customRange, defaultRange }`. Replace the snapshot only on a pick, a Clear, or a publish that
  moves `clock` to a newer local day (`startOfLocalDay` from `@kiko/dates`). `publishNow(next)`
  ignores a `next <= clock` and updates `clock` silently on a newer same-day value. See Mechanism.
- The hook: `const snapshot = useSyncExternalStore(subscribe, getSnapshot)` and
  `useLayoutEffect(() => publishNow(now), [now])`. The range is
  `snapshot.customRange ?? (snapshot.defaultRange ?? defaultDateRange(now))`, where the last part
  is the null-clock fallback. The return shape and the `applyDateRange` / `clearDateRange`
  signatures stay the same.
- Do not export the store internals (Knip). `index.ts` does not change.
- Update the hook's doc comment: one pick and one default shared by every reader (Home and
  Statistics). The default comes from the latest `now` any reader published and moves only on a
  new day. The store resets when no reader is mounted. Keep the "a tab stays mounted … past
  midnight" reason.
- Existing screen its: check for any it that moves a mocked `now` BACKWARD inside one render (the
  store ignores an older `now`). Report any such it. Do not edit it.

Check: the step 1/6 and 2/6 tests turn green. The existing 5 hook its and the existing its in
`home.screen.test.tsx` and `statistics.screen.test.tsx` pass with no change (no leak between its).

### step 4/6: confirm the screen files are untouched (kiko:developer)

`git diff <base> -- src/screens/home/home.screen.tsx src/screens/statistics/statistics.screen.tsx`
must be empty. If a type or lint change forces an edit, stop and report it. Do not widen the diff.
Then run `npm run check:all` through `scripts/job-queue.sh` from this worktree.

### step 5/6: review and verify

- `kiko:reviewer` on the change set. Top question: can a pick leak, or reset too early, on a layout
  change (Duo fold/unfold, iPad split) where one pane remounts?
- `make verify`, queued from this worktree, run until green.
- Deep gate (the coordinator runs it): `KIKO_MUTATION_BASE=<task base sha> make deep`. Get the file
  count from `KIKO_MUTATION_BASE=<base> make mutable` (expected about 1 mutable src file; measure
  it). The hook file must meet the per-file floor. The reset-on-last-unsubscribe and the same-value
  early exit need the step 1/6 its to kill their mutants.

### step 6/6: drift (kiko:retrospect, then kiko:scribe)

- In `.claude/skills/kiko-domain/SKILL.md`, the section "The 'no custom range = derive the default
  from now' pattern" says the hook keeps a "private `customRange`". Change it to ONE shared module
  store for both screens that resets with no reader.
- Add the date range to kiko-architecture's "Shared system status" bullet (or a sibling
  "Shared UI state" bullet).
- Mirror both edits in `harness/kiko/skills/` if those copies exist.
- UI done: `kiko:ops` builds for the Duo simulator (uninstall first), and the user confirms that
  both panes stay in sync.

BATCH READY names: the base sha, the run id, the mutable file count, the merge-risk line above,
and the green tests.

## Scenario matrix

| Action | Home | Statistics | was: (today) |
|---|---|---|---|
| Launch | default | default | default / default |
| Apply on Home | pick | pick | pick / default |
| Apply on Statistics | pick | pick | default / pick |
| Clear on either | default | default | only that screen resets |
| Tab switch, both mounted | pick kept | pick kept | each kept its own |
| Both unmount, then mount | default | default | default / default |
| No pick, past midnight, either screen's trigger (D2) | new-day default | the same new-day default | Home moved on its re-render, Statistics only on its re-focus (could differ by a day) |
