# Recurring Charges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings entry lists the charges that repeated in the user's own rows, with the recurrence date and links to every past charge. No forecast of any kind.

**Architecture:** One pure function (`detectRecurringSeries`, injected `now`) over a narrow read of the whole ledger, behind one hook shared by two screens in the Settings stack. It writes nothing. The only stored item is a nullable settings column of hidden merchant keys. Names group by `merchantNameOf`, imported, never copied.

**Tech Stack:** React Native, Hermes, op-sqlite (SQLCipher), Drizzle, react-native-unistyles, i18next, ts-pattern, jest with `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-11-03-recurring-design.md`. Refer to it by section; this plan does not copy it. Every count here is a floor: the developer measures. Every code fact names a symbol, not a line: re-grep each fact on the actual base before building on it.

## Assumed user answers (NOT yet approved)

Q1 = A (pattern plus last charge). Q2 = A (detected only, plus hide). Q3 = A (a Settings row). See "If the user answers differently" at the end.

**Pending measurement:** spec section 10.2 reads RESULT PENDING until `kiko:ops` runs `measure-recurring.mjs` and the planner fills it. Task 1/3 may start before that; the K of its counted pin is set from its own first run either way.

## Global Constraints

- No next charge date, no reminder, no amount prediction, no projected total, no sum of any kind, in any output or text. No output date is later than `now`. Stopped steps back from `now`, never forward from a charge (spec 6, 7).
- `merchantNameOf`, `merchantSpellingOf`, `mostUsedSpelling` come from `@kiko/transactions/merchant-name`. No copy, no wrapper with other rules, no local normalizing (spec 3).
- Eligibility calls the existing functions (`rowsForTransferMatch`, `internalTransferTransactionIds`, `mccExcludedTransferTransactionIds`, `descriptionExcludedTransferTransactionIds`, `exchangeFundingMatches`, `ibanOf`). No MCC, wording or marker list of its own beyond the structural fields of spec 4.
- Never sum or compare across currencies; the group key holds the currency.
- Detection writes nothing. A row is never marked.
- Guideline 2.5.19: no flag, no condition on the entry row; the screen explains itself with no data.
- UI: shared components and theme tokens only (no hex, no raw spacing). No import across screen folders (`check:screen-imports`); across features through the barrel (`check:feature-imports`).
- A catalogue key added: same step in `en.ts` and `uk.ts`; kiko-translator casing and full-stop rules; plurals `_one/_few/_many/_other` in both through `count`; uk apostrophe U+02BC; uk says «Кіко», «натиснути»; a screen or heading title goes in `title-keys.ts`. A text naming what a later set builds does not ship before that set (spec 14).
- Never log a name or an IBAN: a failure log is fixed text.
- Tests: kiko-testing. Fixtures use the local `Date` constructor and pinned instants, never the real clock plus a day span. A real SQLite test uses `executingClient` and `applyAllMigrations`. A property test goes through `sweep`, with its site in `__tests__/property-sweep-sites.test.ts`. No history note or task id in a test or comment. A qa red commit reads a missing export by a runtime lookup so the staged typecheck passes; the green commit tidies it. Show the red output. Never `--no-verify`. Keep jest output in a file.
- Harness: the orchestrator never queues. A task ends with READY FOR VERIFY to the coordinator, who queues `bash scripts/job-queue.sh verify <worktree> <label>`, reruns until green, and merges. Mutation gates are paused by the user, none is scheduled; if lifted, the gate is per set with `KIKO_MUTATION_BASE` at that set's own base, never one whole-track run. No agent runs `check:all`, full jest or verify.
- Dev test command: `make jest-affected BASE=<task base>`; exit 3 (`AFFECTS EVERY SUITE`) is expected for `en.ts`, `uk.ts` or `schema.ts`: run the named files of the task instead and say so in the READY report.

Run-log gaps: this track closes none and leaves all open. Nearest, left open: `20261015T1657-kiko-binance-backfill-fix/2` (no mechanized index check; this plan adds no index).

## Review Focus

1. An import of older rows while the series screen is open moves the earliest charge, so `seriesId` no longer resolves. Expected: `EmptyState`, never another series. Pinned in task 2/3.
2. The first read is still queued when the screen mounts. Expected: `LoadingState`, never the empty state. Pinned in task 1/3.
3. A name with a Unicode trap (NFD, NBSP, final sigma) across rows of one merchant must land in one series with one shown name. Pinned in task 1/3.
4. A row deleted or edited from the form opened through a link: the live read refreshes and the series may end. Expected: back lands on the gone state or the shorter list, no stale row. Pinned in task 2/3.
5. A file with a malformed `recurringHiddenMerchants` (array, number, wrong value type). Expected: reads as nothing hidden, no crash, the next hide overwrites it cleanly. Pinned in task 3/3.

## Details settled by this plan

| # | Decision | Reason |
|---|---|---|
| S1 | New feature folder `src/recurring/`, one folder per unit with its barrel: `eligibility`, `detection`, `recurrence-text`, `use-recurring-series`. | The hook is shared by two screens, which may not import each other; `src/statistics` must not gain a non-statistic; `src/transactions` importing `src/statistics` is avoided. |
| S2 | `seriesId` = id of the earliest charge by (time, id); list key the same. Route params hold `{ seriesId, name }`. | Params are JSON; a whole id list stays out of params. Spec 9.3. |
| S3 | Shown name: `mostUsedSpelling` over the series' `merchantSpellingOf` counts, as the category plan's S1. | One spelling, order-free. |
| S4 | The narrow query selects: `id, holdingId, amountMinorUnits, time, description, mcc, counterIban, categorySetByHand, setsBalance, changeGroupId, exchangePairId, exchangeCounterpartHoldingId, untrackedCounterpart, loanHoldingId, source`. No `where`, no `orderBy`. | The matchers need both signs and blank rows (spec 10.1); the function sorts by itself, so an order would only cost. This is the exact SQL the measure script runs as candidate A. |
| S5 | `newestRowTimeByHolding` is computed in the one pass over the read, before any filter. `isAccountQuiet` reads it. | Spec 7: a row of either sign counts. |
| S6 | Group key `JSON.stringify([key, currency])`. | As `groupKeyOf` in `sync-adoption.ts`. |
| S7 | Constants, all in `detection.ts`, named and exported only if a test reads them: `MONTHLY`, `YEARLY`, `WEEKLY` period records (spec 5.1); `AMOUNT_STEP = 1.25`, `WEEKLY_AMOUNT_STEP = 1.1`, `MIN_FIT_SHARE = 0.75`, `MIN_OCCUPANCY = 0.75`, `MIN_COVERAGE = 0.5`, `VARIABLE_MONTHLY_MIN_CHARGES = 6`, `DAY_SPLIT_GAP = 3`, `STOPPED_GRACE_DAYS`, `LEAVES_AFTER_MONTHS = 24`, `AROUND_DAY_SPREAD = 6`. | No magic number; the matrix pins them. |
| S8 | The list and series screens are `FlatList` with `LargeTitleHeading` and `useLargeTitleScroll`, `HoldingDetail` the model. | kiko-design-system's custom list screen. |
| S9 | Sections as a flat array of `{ kind: 'heading' } / { kind: 'series' } / { kind: 'hidden' }`, not `SectionList`. | `HoldingDetail`'s flattened list; the first scroll view drives the large title. |
| S10 | The hide button is `Button` secondary in the list footer of the series screen; "Show again" a small secondary `Button` on the hidden row. No new shared component, so no `kiko:designer` step. | Reversible, so no `ConfirmSheet`. |
| S11 | A set's tasks stack in this worktree; each base is the previous tip. Task 1/3 starts from a merge of `next` holding `1.4-category-automation task 2/6`. | One editor; spec 3. |
| S12 | The hidden column is generated at the journal tail + 1 of the task's base. A later-merging branch renumbers by deleting its four artifacts, merging `next` and re-running `npx drizzle-kit generate` (never a hand-edited `prevId`). No number in a test title, comment or skill. Allowed only before a build ships. | Same rule as the category plan's S6. |

## Interfaces (Produces)

```ts
// @kiko/recurring/detection
export type RecurringPeriod = 'weekly' | 'monthly' | 'yearly';
export type Recurrence =
  | { kind: 'onDay'; day: number }
  | { kind: 'aroundDay'; day: number }
  | { kind: 'lastDay' }
  | { kind: 'onWeekday'; weekday: number }
  | { kind: 'onDate'; time: number }
  | { kind: 'none' };
export type RecurringSeries = {
  id: string;
  merchantKey: string;
  name: string;
  currency: Currency;
  period: RecurringPeriod;
  recurrence: Recurrence;
  chargeIds: string[];            // newest first; a folded twin is not in it
  lastChargeTime: number;
  lastChargeAmountMinorUnits: number;
  lastChargeHoldingId: string;
  isStopped: boolean;
  isAccountQuiet: boolean;
};
export const detectRecurringSeries: (input: RecurringInput, now: number) => RecurringSeries[];
// RecurringInput: { rows: readonly RecurringLedgerRow[]; holdings: readonly Pick<HoldingRow, 'id' | 'accountId' | 'currency' | 'metadata'>[]; accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[] }

// @kiko/recurring/eligibility
export const recurringExcludedIds: (rows, holdings, accounts) => ReadonlySet<string>;
export const isRecurringCandidate: (row, holding, account) => boolean; // the structural part of spec 4

// @kiko/recurring/recurrence-text
export const recurrenceLine: (period: RecurringPeriod, recurrence: Recurrence, t: TFunction) => string;
export const lastChargeLine: (series: RecurringSeries, t: TFunction) => string; // last charge, no charge since, or quiet

// @kiko/recurring/use-recurring-series
export const useRecurringSeries: () => { series: RecurringSeries[]; isLoading: boolean }; // task 3/3 adds hiddenMerchants

// transactionsRepo
recurringLedgerQuery: () => /* S4 */;
listWithContextByIdsQuery: (ids: readonly string[]) => /* contextRowsQuery where id in, time desc */; // task 2/3

// settingsRepo (task 3/3)
hideRecurringMerchant: (key: string, name: string) => Promise<void>;
showRecurringMerchant: (key: string) => Promise<void>;
```

## Conflict surface

| Task | Shared files | Other tracks |
|---|---|---|
| 1/3 | `settings.screen.tsx`, `settings.stack.tsx`, `src/navigation/types/types.d.ts`, `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts`, `help-topic.screen.tsx`, `entry-symbols.ts`, `transactions.repo.ts` | `1.4-small` regroups the Settings cards: one added `Card`, merged by hand. `1.4-category-automation` adds one route: added lines |
| 2/3 | `settings.stack.tsx`, `types.d.ts`, `en.ts`, `uk.ts`, `transactions.repo.ts` | same |
| 3/3 | `schema.ts`, journal, `migrations.js`, `envelope.test.ts`, `settings-columns.test.ts`, `import-data.back-compat.test.ts`, `real-sqlite.ts`, `settings.repo.ts` | `1.4-category-automation` adds two migrations: S12 |
| All UI | theme tokens | `1.4-light-scheme`: applies by itself. `1.4-tables`: Statistics untouched. `1.4-bybit`: covered by the account kind allow-list |

## Closing steps (every task, same order)

- **Review:** `kiko:reviewer` on the task's diff from its base. The diff of test files is checked for edited pins.
- **Drift:** `kiko:retrospect` checks `.claude/skills/`, `harness/kiko/skills/`, `harness/kiko/agents/` against the task's code.
- **Scribe:** `kiko:scribe` fixes the drift and commits; the report names the sha or "no drift found".
- **Device:** the coordinator gets the user's device confirm on the items the task lists (UI needs it; a queued build goes through the coordinator).
- **Ready:** READY FOR VERIFY to the coordinator: worktree, label `1.4-recurring-task-N`, base sha, head sha, mutable file count (`make mutable`), named-file runs and their output path. The coordinator queues the verify, reruns until green, and merges.

---

## 1.4-recurring task 1/3: detection and the list

**Goal:** the Settings row, the list with its sections, the recurrence text, the empty state. Rows do not open yet. **Needs:** `1.4-category-automation task 2/6` on `next`. **Base:** a merge of that `next` into this branch.

**Files (floor 26, tests included; mutable 13; the developer measures).**
- Create: `src/recurring/eligibility/{eligibility.ts,index.ts,eligibility.test.ts}`; `src/recurring/detection/{detection.ts,detection.d.ts,index.ts,detection.test.ts,detection.performance.test.ts}`; `src/recurring/recurrence-text/{recurrence-text.ts,index.ts,recurrence-text.test.ts}`; `src/recurring/use-recurring-series/{use-recurring-series.ts,index.ts,use-recurring-series.test.tsx}`; `src/screens/settings/recurring-charges/{recurring-charges.screen.tsx,recurring-charges.styles.ts,index.ts,recurring-charges.screen.test.tsx}` with a `recurring-series-row/` unit
- Modify: `src/transactions/repo/transactions.repo.ts` plus a real SQLite pin, `src/navigation/settings-stack/settings.stack.tsx` and its test, `src/navigation/types/types.d.ts`, `src/navigation/entry-symbols/entry-symbols.ts`, `src/screens/settings/settings/settings.screen.tsx` and its test, `src/i18n/locales/{en,uk,title-keys}.ts`, `src/help/help-topics.ts` and its test (`TOPIC_TITLES`), `src/screens/settings/help-topic/help-topic.screen.tsx`

**Acceptance:** every world of spec 5.4 and one per exclusion rule are pins; a clean install shows the row and the empty state; loading gates on `isLoading`; all new strings in both catalogues; `make jest-affected` or the named files green.

- [ ] **step 1/13 (kiko:qa): eligibility pins.** `eligibility.test.ts`, each monthly over twelve months, one world per rule of spec 4: out by `setsBalance`, `changeGroupId`, each of the three exchange markers, 6011 MCC, 4829 to an own IBAN, "Поповнення депозиту" wording, a matched pair, a funded exchange debit, `loanHoldingId`, a crypto account (Binance's ticker as description), an archived account, a missing holding, a credit, a blank description. In: a 4829 to a third party, a closed holding, a `hold` row, a manual row, an import row. Positive twin for each absence (kiko-testing, "An absence assertion must not go vacuous"). Red: `npx jest src/recurring/eligibility --maxWorkers=2`. Commit `test(recurring): which rows count as charges`.
- [ ] **step 2/13 (kiko:developer): eligibility.** Spec 4. Only calls the named functions. Green, same command. Knip reports exports until step 10: one developer run covers steps 2, 4, 6, 8, 10; a Stop-hook Knip failure in between is that unfinished work. Commit `feat(recurring): eligibility`.
- [ ] **step 3/13 (kiko:qa): the matrix.** `detection.test.ts`: `it.each` over every world of spec 5.4 with periods, count, recurrence, `isStopped`. Add: `isAccountQuiet` true and false (a newer credit on the holding makes it false); a stopped boundary either side for each period; the leave bound; the twin fold's kept order (synced over manual over import), and two same-source rows staying two; a folded row out of `chargeIds`; a Unicode trap across one merchant gives one series and one name. Property, through `sweep`, over random ledgers: shuffling gives a deep-equal result; every time in the output is `<= now`; `chargeIds` are disjoint across series; a series' charges share one currency. Under `withDeviceZoneOffset`: the 31st and a DST-crossing series give the same result. Sample keys for the hide list's dependency: `Netflix`, `ATB 0212`, `Silpo Market 12` against their keys. Red, named file. Commit `test(recurring): the false-match and false-miss matrix`.
- [ ] **step 4/13 (kiko:developer): detection.** Spec 5.2, 5.3, 6, 7; S5, S6, S7. Reuse `addMonths` and `daysBetween` from `@kiko/holdings/interest`; `startOfLocalDay` from `@kiko/dates`; `DAY_MS` only from `@kiko/dates`. Stepping back uses local calendar fields (`new Date(y, m, d - n)`), never a fixed day span (`kiko-no-fixed-day-offset-into-local-day`). A reference exists in `measure-recurring.mjs` for reading, not for copying. Green, named file. Commit `feat(recurring): detectRecurringSeries`.
- [ ] **step 5/13 (kiko:qa): counted-work pins.** `detection.performance.test.ts` on `buildRulesPerformanceFixture().rows`, mapped to `RecurringLedgerRow` by index on its own lines; the fixture is not edited (its shape pin holds): a `merchantNameOf` spy (`jest.mock` with `requireActual`) sees at most one call per distinct description; instrumented rows count reads of `time`, bound `rows x (log2(rows) + K)`, K set from this first run, stated in the test's constant, and never raised after; two fixture rows planted monthly are found (a non-vacuous twin). No wall clock (the header of `transactions.repo.category-rules.performance.test.ts`). Commit `test(recurring): counted work on a large ledger`.
- [ ] **step 6/13 (kiko:developer): query and hook.** `recurringLedgerQuery` (S4), a real SQLite pin: the row shape, and EXPLAIN QUERY PLAN is `SCAN transactions` with no `TEMP B-TREE`. `useRecurringSeries`: the reads of spec 9.5, `paused: !useIsScreenVisible()` on every call, no `cached`, `now` from `useVisibleRefreshedNow`, `useMemo` on rows, holdings, accounts, `now`. Its test: a write while hidden shows only on return (the existing pattern for tab screens); `isLoading` true until all reads settle; one detection per fire. If the count pin of step 5 fails: spec 10.4's fix, never a weaker bound. Commit `feat(recurring): the live read`.
- [ ] **step 7/13 (kiko:qa): text pins.** `recurrence-text.test.ts`, one `describe` per language with the language set in a hook: each `Recurrence` kind; `lastChargeLine` for active, stopped, quiet; dates as `formatDate` and `formatDayMonth`; uk weekdays accusative including «у пʼятницю» with U+02BC; `chargeCount` at 1, 2, 5, 21. Commit `test(recurring): the recurrence text`.
- [ ] **step 8/13 (kiko:developer): text and catalogue.** `recurrence-text.ts` with `ts-pattern` `.exhaustive()`; the keys of spec 13 that this task uses; `title-keys.ts`. Not `notRecurring`, `hiddenHeading`, `showAgain`, `seriesGone*`. Run: `npx jest src/recurring/recurrence-text src/i18n/locales --maxWorkers=2`. Commit `feat(i18n): recurring charges copy`.
- [ ] **step 9/13 (kiko:qa): screen pins.** `recurring-charges.screen.test.tsx`: loading shows `LoadingState`, not the empty state, while a read is queued; no series shows the empty state with its title and message; active then the stopped heading, ordered per spec 9.2; a row shows name, recurrence line, last charge, and amount in its own currency; two series under one name both listed; stopped and quiet lines. `settings.screen.test.tsx`: the row is there with no data, opens `RecurringCharges`, marked `selected` through `isShown`. `settings.stack.test.tsx`: the route and its title. `help-topics.test.ts`: `TOPIC_TITLES` row. Commit `test(settings): recurring charges list`.
- [ ] **step 10/13 (kiko:developer): list, entry, help.** S8, S9. `entrySymbol.recurringCharges = 'repeat'`, checked against kiko-design-system "SF Symbol availability". A `Card` with `SettingsRow` beside its siblings, testID `settings-card-recurring-charges`. Route `RecurringCharges: undefined`. Help topic with steps 1 and 2 of spec 14, action `openRecurringCharges` and `help.actions.openRecurringCharges` in both catalogues. Run the named files of this task and `npx jest src/help src/i18n/locales src/screens/settings src/navigation/settings-stack --maxWorkers=2`; `make doc-suites` if a skill or doc changed. Commit `feat(settings): recurring charges list`.
- [ ] **step 11/13 Review (kiko:reviewer).** Top question: can any code path produce a future date or a total? Second: does anything but `merchantNameOf` decide a merchant?
- [ ] **step 12/13 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-domain ("Spending-exclusion pipeline" gains: a new exclusion rule also goes in `recurringExcludedIds`; a new section for the detection rule points at `src/recurring/`), kiko-architecture (the new whole-ledger live read; route list). Report the sha or "no drift found".
- [ ] **step 13/13 Device and Ready.** Device confirm by the user: a clean install shows the row and the empty text (uk too); the real ledger opens with no felt stall (name it if there is one: spec 10.4); no false match the user objects to, listed by name for the coordinator; iPad two panes and Duo fold. Label `1.4-recurring-task-1`.

---

## 1.4-recurring task 2/3: the series screen and its links

**Goal:** a list row opens one series; each past charge opens its form. **Needs:** task 1/3. **Base:** task 1/3 tip.

**Files (floor 12, tests included; mutable 6).**
- Create: `src/screens/settings/recurring-series/{recurring-series.screen.tsx,recurring-series.styles.ts,index.ts,recurring-series.screen.test.tsx,recurring-series.navigator.test.tsx}`
- Modify: `recurring-series-row` and the list screen (pressable), `transactions.repo.ts` plus a real SQLite pin, `settings.stack.tsx`, `types.d.ts`, `en.ts`, `uk.ts`, `help-topics.ts` and its test

**Acceptance:** every charge in `chargeIds` is one row, newest first, and opens `TransactionForm { transactionId }`; synced rows open read-only, manual rows editable (the form's own rule); back walks form, series, list; on two panes all three stay in the detail pane; a gone series shows the gone state.

- [ ] **step 1/8 (kiko:qa): query pin.** `listWithContextByIdsQuery`, real SQLite: returns exactly the ids, newest first, through `contextRowsQuery`'s shape; more ids than `IN_CLAUSE_CHUNK_SIZE` read in chunks (the existing chunk helper); a deleted holding's rows absent. Red. Commit `test(transactions): context rows by id`.
- [ ] **step 2/8 (kiko:developer): query.** Green, named file. Commit `feat(transactions): context rows by id`.
- [ ] **step 3/8 (kiko:qa): screen pins.** `recurring-series.screen.test.tsx`: header with recurrence line, last-charge line and `chargeCount`; rows newest first with the date in the trailing slot; a tap calls the pane opener with `TransactionForm` and that `transactionId`; an unknown `seriesId` shows `EmptyState`, no other series; a charge deleted in a live fire drops from the list; loading gated on `isLoading`. List test gains: a tap opens `RecurringSeries` with `seriesId` and `name`. Commit `test(settings): recurring series screen`.
- [ ] **step 4/8 (kiko:developer): screen.** S8. Shared `TransactionCard`, `transactionRowDescription`, `resolveCategoryDisplay`, `resolveCategoryColor`, `accountDisplayName` for the footer (an implicit account never by its raw name). Route `RecurringSeries: { seriesId: string; name: string }`, title from `route.params.name`, set to the merchant's text, not translated. Help step 3 and the `seriesGone*` keys in both catalogues. Run named files. Commit `feat(settings): recurring series and its links`.
- [ ] **step 5/8 (kiko:qa): navigator pins.** `recurring-series.navigator.test.tsx` with `navigator-stack-probe`: single mode: list to series to form, back twice; split mode: all three in the detail pane, Settings stays in the list pane, the menu row stays marked; a fold keeps the route and its params; the form opened this way for a manual row saves and returns (the path the Settings stack did not have). Green at once is acceptable when the pane rule already holds: show the run, and prove one pin by a temporary wrong route name. Commit `test(navigation): series links in the Settings stack`.
- [ ] **step 6/8 Review (kiko:reviewer).** Top question: can a link open the wrong transaction after a live refresh?
- [ ] **step 7/8 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-architecture "Pane navigation" only if a rule changed; route lists. Report the sha or "no drift found".
- [ ] **step 8/8 Device and Ready.** Device confirm by the user: a tap on a charge opens the right transaction, synced read-only, manual editable; back order on phone, iPad, unfolded and folded Duo; the two-pane look. Label `1.4-recurring-task-2`.

---

## 1.4-recurring task 3/3: hide a false match

**Goal:** "Not a recurring charge", the "Hidden" section with "Show again", the stored list and its restore paths. **Needs:** task 2/3. **Base:** task 2/3 tip. One migration.

**Files (floor 18 plus generated ones; mutable 5).**
- Create: the migration `.sql`, its snapshot and test (generated by `npx drizzle-kit generate`), `src/data-transfer/snapshot/restore-recurring-hidden-merchants.test.ts`
- Modify: `src/db/schema.ts`, `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js`, `src/settings/settings.repo.ts` and its test, `use-recurring-series.ts` and its test, both screens and their tests, `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts` and its test, `src/db/settings-columns.test.ts` (`TAKEN_FROM_FILE_ON_RESTORE`), `src/data-transfer/crypto/envelope.test.ts` (`VERSION_DECISIONS` note, `migrationCount` plus one, **no bump**), `src/data-transfer/import-data.back-compat.test.ts` (`EARLIER_BUILD_SETTINGS_COLUMNS`), `src/test-support/real-sqlite.ts`, the two-path suites below

**Upgrade worlds.** No owed state: NULL means nothing hidden, no one-time step, so no app-open or restore mirror. Asked per harness-workflow, "An acceptance pin's seed or world", which seeds are older-build worlds:

| Seed | World | Effect | Re-seed, by its own line |
|---|---|---|---|
| `restore-*.two-path.test.ts` using `applyMigrationsThrough` (12 files is the floor) | Database below the new migration, read through today's schema | `no such column` if it reads `settings` | `addRecurringHiddenMerchantsColumn(source)` beside the existing `add...Column` line, per failing file, never inside a shared helper |
| `import-data.back-compat.test.ts` | Older-build file through `importData` | The list of columns an earlier build lacked | The key in `EARLIER_BUILD_SETTINGS_COLUMNS` |
| `e2e/screenshot/fixtures/build-demo-snapshot.ts` | Current demo | The typed settings row needs the key if it spells every column | `recurringHiddenMerchants: null` on its own line; regenerate the demo `.kiko` files if the developer measures that they change |

After those, other suites stay green unchanged. A failure elsewhere is reported, never fixed by editing an expectation.

**Acceptance:** hide and show round-trip; a hidden merchant's series leave the list and the merchant shows under "Hidden", also with no rows; nothing on a transaction changes; the paths of spec 11 are pins.

- [ ] **step 1/10 (kiko:qa): repo pins.** `settings.repo.test.ts`, real SQLite: `hideRecurringMerchant` stores key and name; a second keeps the first; hide twice is one entry, last name; `showRecurringMerchant` removes one and an absent key is a no-op; the writes touch no `transactions` row (count and checksum); a malformed stored value reads as empty and the next hide replaces it. Commit `test(settings): the hidden merchant list`.
- [ ] **step 2/10 (kiko:developer): column and repo.** S12. `recurringHiddenMerchants: text('recurring_hidden_merchants', { mode: 'json' }).$type<Record<string, string>>()`; a schema comment says what it holds and why NULL. Migration by `npx drizzle-kit generate`, its test. Read-modify-write in one `write()`, as `recordReminderOfferDismissal`; a parser (`hiddenMerchantsOf`) for a non-object. `addRecurringHiddenMerchantsColumn` in `real-sqlite.ts`. Run the upgrade-world files measured above. Commit `feat(settings): store hidden recurring merchants`.
- [ ] **step 3/10 (kiko:qa): restore pins.** `restore-recurring-hidden-merchants.test.ts`, as `restore-dismissed-tips.test.ts`: a round trip keeps the list; a file with no key restores with none; a file's list replaces the live one (taken from the file, not `KEPT_FROM_LIVE_ON_RESTORE`); a malformed value in a file restores and reads as nothing hidden. `settings-columns.test.ts` and the `VERSION_DECISIONS` note in this step. Green at once is acceptable where the restore already does it by column: show the run, and prove one pin by a temporary wrong column. Commit `test(restore): the hidden merchant list`.
- [ ] **step 4/10 (kiko:qa): UI pins.** Series screen: the button shows, a tap calls `hideRecurringMerchant` with `merchantKey` and `name`, a rejected write shows the save alert and stays, a second tap during the write is blocked (`useSubmitOnce`). List: hidden series leave, the "Hidden" section lists each name in key order, including a hidden name with no rows; "Show again" calls `showRecurringMerchant`; two series under one key both go; with only hidden merchants the empty state and the section both show. Hook: a `settings` write re-derives without a new ledger read. Commit `test(settings): hide and show a recurring merchant`.
- [ ] **step 5/10 (kiko:developer): UI.** S9, S10. The hook gains `hiddenMerchants`, filtering by `merchantKey` after detection, so a hide runs no detection. After a hide the series screen closes back to the list through `navigation.goBack()`. Remaining keys of spec 13; `hiddenHeading` in `title-keys.ts`; help step 4. Failure log fixed text. Run named files, `src/i18n/locales`, `src/help`. Commit `feat(settings): hide a false match`.
- [ ] **step 6/10 (kiko:qa): the sample-key pin.** The sample table of task 1/3 step 3 gains a comment: these keys are stored in `settings.recurringHiddenMerchants`; a change of `merchantNameOf` shows here, with spec 8's consequence. Confirm it fails when a sample's key is altered. No commit without the proof shown. Commit `test(recurring): stored keys follow the name function`.
- [ ] **step 7/10 Migration review (kiko:reviewer).** Required before BATCH READY, on the migration, schema, restore pins and `VERSION_DECISIONS` note. Top question: can any older-build path lose or change a row? Also read `git show release-1.3:src/data-transfer/import-data.ts` and the restore on that ref to confirm the key is dropped. No index, so no index EXPLAIN test.
- [ ] **step 8/10 Review (kiko:reviewer).** The whole diff. Top question: does anything other than the settings row change on hide?
- [ ] **step 9/10 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-architecture's data-transfer section, kiko-domain. Add to `docs/harness` only if a check moved. Report the sha or "no drift found".
- [ ] **step 10/10 Device and Ready.** Device confirm by the user: hide, the row goes, "Hidden" names it, show brings it back; export then restore keeps the list; both languages. Note the renumber need in the report if another migration reached `next` first (S12). Label `1.4-recurring-task-3`.

---

## Mutable file counts (floors; `make mutable` measures; the cap is 30)

| Task | Floor |
|---|---|
| 1/3 | 13 |
| 2/3 | 6 |
| 3/3 | 5 |

Mutation gates are paused by the user; this table is for a lift.

## Not in the tasks

A forecast, a reminder, a total, a period beyond the three, a user mark, an edit of Statistics, an edit of `merchantNameOf`, a change to `category`. What's New goes in App Store Connect at release (spec 14), and Notes for Review through the release skill. Filling spec 10.2 is the planner's, after `kiko:ops` runs the script.

## If the user answers differently

- **Q1 = B:** `Recurrence` shrinks to the period; `recurrence-text` loses the day and weekday keys; the matrix loses its recurrence column; no change to detection.
- **Q1 = C:** `Recurrence` gains `{ kind: 'dayRange'; from; to }` over the last 3 charges in place of `onDay` and `aroundDay`.
- **Q2 = B:** a new set after 3/3, with its own spec section: a second stored list, a period choice, a control in the transaction form, which meets `CategoryOverrideSheet`'s neighbours. Tasks 1/3 to 3/3 stay.
- **Q3 = B:** the two routes register in the Home and Statistics stacks and both param lists; the entry goes in `statistics.screen.tsx` below the grid, with `useOpenInPane` from a possible stand-in, and a Settings row still ships for the clean install. The conflict surface moves to `1.4-tables`. Task 1/3 grows by the stack tests.
- **If `1.4-category-automation` loses B3:** spec 3: its steps for `merchant-name.ts` move into task 1/3 as first caller. Never a copy.
