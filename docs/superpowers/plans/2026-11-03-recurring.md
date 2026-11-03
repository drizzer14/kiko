# Recurring Charges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings entry lists the charges that repeated in the user's own rows, with the recurrence date and links to every past charge. No forecast of any kind.

**Architecture:** One pure function (`detectRecurringSeries`, injected `now`) over a narrow read of the whole ledger, behind one hook shared by two screens in the Settings stack. It writes nothing. The only stored item is a nullable settings column of hidden merchant keys. Names group by `merchantNameOf`, imported, never copied.

**Tech Stack:** React Native, Hermes, op-sqlite (SQLCipher), Drizzle, react-native-unistyles, i18next, ts-pattern, jest with `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-11-03-recurring-design.md`. Refer to it by section; this plan does not copy it, except the world matrix, whose rows are the contract ("The matrix" below). Every count here is a floor: the developer measures. Every code fact names a symbol, not a line: re-grep each fact on the actual base before building on it.

## Assumed user answers (NOT yet approved)

Q1 = A (pattern plus last charge). Q2 = A (detected only, plus hide). Q3 = A (a Settings row). Q4 = A (the demo seed changes, S14). See "If the user answers differently" at the end.

**Measurement:** spec section 10.2 holds it. It comes from node with JIT and sqlite3 with no encryption, so no device figure exists: the device checks of tasks 1/3 and 2/3 record one. The K of the counted pin is set from its own first run. Base of this plan's facts: c9896e1f9.

**One release:** the three sets merge into `next` one at a time and `next` tolerates each middle state, but a release holds all three or none: hide is the remedy for the accepted yearly false match (spec 15).

## Global Constraints

- No next charge date, no reminder, no amount prediction, no projected total, no sum of any kind, in any output or text. No output date has a local day later than today. Stopped steps back from `now`, never forward from a charge (spec 6, 7).
- `merchantNameOf`, `merchantSpellingOf`, `smallestSpelling` come from `@kiko/transactions/merchant-name` (category plan read at branch tip 2034e8d9f; re-grep). No copy, no wrapper with other rules, no local normalizing (spec 3).
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

1. An import of older rows while the series screen is open moves the earliest charge, so `seriesId` no longer resolves. Expected: the one series with the same merchant key, currency and period; with none or several, the neutral list text, never a guess and never a claim about the merchant. Pinned in task 2/3.
2. The first read is still queued when the screen mounts. Expected: `LoadingState`, never the empty state. Pinned in task 1/3.
3. A name with a Unicode trap (NFD, NBSP, final sigma) across rows of one merchant must land in one series with one shown name. Pinned in task 1/3.
4. A row deleted or edited from the form opened through a link: the live read refreshes and the series may end. Expected: the read is `paused` under the form, so on Back the last rows show until the re-read lands; then the shorter list, the fallback series, or the neutral text. A link opened in that gap resolves by its own id and the form handles a deleted row. Pinned in task 2/3.
5. A file with a malformed `recurringHiddenMerchants` (array, number, wrong value type). Expected: reads as nothing hidden, no crash, the next hide overwrites it cleanly. Pinned in task 3/3.

## Details settled by this plan

| # | Decision | Reason |
|---|---|---|
| S1 | New feature folder `src/recurring/`, one folder per unit with its barrel: `eligibility`, `detection`, `recurrence-text`, `use-recurring-series`. | The hook is shared by two screens, which may not import each other; `src/statistics` must not gain a non-statistic; `src/transactions` importing `src/statistics` is avoided. |
| S2 | `seriesId` = id of the earliest charge by (time, id); list key the same. Route params hold `{ seriesId, merchantKey, currency, period, name }`. A miss on `seriesId` takes the series with the same `merchantKey`, `currency` and `period` only when there is exactly one. | Params are JSON; a whole id list stays out of params. Two monthly Apple series must not be guessed between. Spec 9.3. |
| S3 | Shown name: `smallestSpelling` over the series' `merchantSpellingOf` values. `merchantSpellingOf`'s comment, which says `nameStartsWith` text only, is widened in task 1/3 step 4. | One spelling, order-free, the category plan's S1 pick. A cut prefix: a series crosses store numbers. |
| S4 | The narrow query selects: `id, holdingId, amountMinorUnits, time, description, mcc, counterIban, categorySetByHand, setsBalance, changeGroupId, exchangePairId, exchangeCounterpartHoldingId, untrackedCounterpart, loanHoldingId, source`. No `where`, no `orderBy`. | The matchers need both signs and blank rows (spec 10.1); the function sorts by itself, so an order would only cost. |
| S5 | `newestRowTimeByHolding` is computed in the one pass over the read, before any filter but the local-day one: a row later than today is no activity. `stoppedCutoff(period, now)` is one function; `isStopped` compares the last charge to it, and `quiet` compares that holding's newest row to it. | Spec 7: a row of either sign counts, one cutoff for both. |
| S6 | Group key `JSON.stringify([key, currency])`. | As `groupKeyOf` in `sync-adoption.ts`. |
| S7 | Constants, all in `detection.ts`, named and exported only if a test reads them: `MONTHLY`, `YEARLY`, `WEEKLY` period records (spec 5.1); `AMOUNT_STEP = 1.25`, `WEEKLY_AMOUNT_STEP = 1.1`, `MIN_FIT_SHARE = 0.75`, `MIN_OCCUPANCY = 0.75`, `MIN_COVERAGE = 0.5`, `ONE_A_SLOT_MIN_CHARGES = 6`, `DAY_SPLIT_GAP = 3`, `TWIN_DAY_REACH = 1`, `STOPPED_GRACE_DAYS`, `LEAVES_AFTER_MONTHS = 24`, `AROUND_DAY_SPREAD = 6`. | No magic number; the matrix pins them. |
| S8 | The list and series screens are `FlatList` with `LargeTitleHeading` and `useLargeTitleScroll`, `HoldingDetail` the model. | kiko-design-system's custom list screen. |
| S9 | Sections as a flat array of `{ kind: 'heading' } / { kind: 'series' } / { kind: 'hidden' }`, not `SectionList`. | `HoldingDetail`'s flattened list; the first scroll view drives the large title. |
| S10 | The hide button is `Button` secondary in the list footer of the series screen; "Show again" a small secondary `Button` on the hidden row. No new shared component, so no `kiko:designer` step. | Reversible, so no `ConfirmSheet`. |
| S11 | A set's tasks stack in this worktree; each base is the previous tip. Task 1/3 starts from a merge of `next` holding `1.4-category-automation task 2/6`. | One editor; spec 3. |
| S12 | The hidden column is generated at the journal tail + 1 of the task's base. A later-merging branch renumbers by deleting its four artifacts, merging `next` and re-running `npx drizzle-kit generate` (never a hand-edited `prevId`). No number in a test title, comment or skill. Allowed only before a build ships. | Same rule as the category plan's S6. |
| S13 | The hook returns the unfiltered `series`, `hiddenMerchants` from task 3/3, and the list filters. Its memo keys on `startOfLocalDay(now)`, and that value is the `now` detection receives. | The series screen then keeps its series between the hide write and `goBack`, with no flash of the neutral text. Back runs no detection. Spec 9.3, 9.5. |
| S14 | Demo seed: in `buildMonthlyExpenses`, a row's new field marks it as a steady bill: `Netflix`, `text.kyivstar`, `text.kyivteploenergo`, `YASNO`, `text.kyivvodokanal`. In `buildMainCardTransactions`, every other row that `buildMonthlyExpenses` gives, in odd `month` values only, sits a named constant of 10 days nearer the middle of its 30-day month (a `dayOfMonth` under 15 adds it, else subtracts it). Amount unchanged, one row a month as before, `month` 0 never moves. The same edit read in memory on the reference gives exactly those five on all 731 daily anchors; the pin decides, not this sample. | The merged seed reads 24 series and moving only `text.groceryStore` leaves 23, so a reviewer would still read ATB and Fora as subscriptions (spec 12). The row stays in its 30-day month, so `MONTHLY_INCOME_MINOR_UNITS`'s deliberate down months keep their totals. `month` 0 stays, so the default 30-day window, the README's window counts and the "12 newest rows" and "3 newest" pins of `screenshot-seed.test.ts` read the same rows. |

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
  quiet: { since: number; holdingName: string } | null; // since = that holding's newest row; null unless stopped
};
export const detectRecurringSeries: (input: RecurringInput, now: number) => RecurringSeries[];
// `now` is read only through its local day.
// RecurringInput: { rows: readonly RecurringLedgerRow[]; holdings: readonly Pick<HoldingRow, 'id' | 'accountId' | 'name' | 'currency' | 'metadata'>[]; accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[] }

// @kiko/recurring/eligibility
export const recurringExcludedIds: (rows, holdings, accounts) => ReadonlySet<string>;
export const isRecurringCandidate: (row, holding, account) => boolean; // the structural part of spec 4

// @kiko/recurring/recurrence-text
export const recurrenceLine: (period: RecurringPeriod, recurrence: Recurrence, t: TFunction) => string;
export const lastChargeLine: (series: RecurringSeries, t: TFunction) => string; // last charge, no charge since, or quiet

// @kiko/recurring/use-recurring-series
export const useRecurringSeries: () => { series: RecurringSeries[]; isLoading: boolean }; // unfiltered; task 3/3 adds hiddenMerchants (S13)

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
| 1/3 | `e2e/screenshot/seed/screenshot-seed.ts`, `e2e/screenshot/fixtures/README.md`, the demo `.kiko` files, `merchant-name.ts` (its comment), `settings.screen.tsx`, `settings.stack.tsx`, `src/navigation/types/types.d.ts`, `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts`, `help-topic.screen.tsx`, `entry-symbols.ts`, `transactions.repo.ts` | `1.4-small` regroups the Settings cards and pins the exact five-card order in two tests of `settings.screen.test.tsx`: one added `Card`, merged by hand, both pins edited to six (spec 9.1). `1.4-category-automation` adds one route and edits the seed in its task 2/6, so regenerate the `.kiko` files on the merge. Its `buildStoreNumberTransactions` (draft name `Fora`) and later `buildSuggestionTransactions` (draft name `Aroma Kava`) add rows under merchants S14 moves: step 11's pin runs on the base that holds them |
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

## The matrix (the contract of task 1/3 step 3)

`now` is 3 Nov 2026 12:00, Europe/Kyiv. "m(N, D, A)" is N charges on day D at amount A, newest in Oct 2026, one month back each; a day past a month's end clamps. A row is a Monobank debit on UAH holding `card` at 10:30 unless the row says otherwise. Stopped and quiet are false unless stated. Amounts are in major units. Spec 5.4 states why each row exists and what it read before this fix.

| World | Rows | Expected |
|---|---|---|
| Daily grocery shop | 500 daily rows, 100 to 1,600, seeded random | none |
| Weekly shop, moving amount | 20 weekly rows, 600 to 1,500 | none |
| One visit a month, random day, one price | m(12, 1, 600), each moved 0 to 26 days, seeded | none |
| Monthly rent | m(12, 1, 18,000) moved 0, 1 or 2 days, turn about | monthly x12, `aroundDay` 2 |
| Netflix, moved 15th to 18th | m(6, 18, 249) plus the older six of m(12, 15, 249) | monthly x12, `onDay` 18 |
| Netflix, moved a week once | m(6, 3, 249) plus the older six of m(12, 15, 249) | monthly x12 |
| Apple twice, different amounts and days | m(10, 5, 99), m(10, 20, 399) | monthly x10 twice |
| Apple twice, close amounts | m(10, 5, 99), m(10, 20, 119) | monthly x10 twice |
| Apple twice, same amount | m(10, 5, 99), m(10, 20, 99) | monthly x10 twice |
| Apple twice, same amount and day | m(10, 5, 99) twice | none (FS accepted) |
| Apple monthly and yearly | m(24, 5, 99), 12 Mar 2025 and 2026 at 999 | monthly x24, yearly x2 |
| Yearly domain, two charges | 12 Mar 2024 at 400, 12 Mar 2025 at 420 | yearly x2, stopped, quiet |
| Yearly renewal, moved days | 2, 6, 4 Jun of 2024, 2025, 2026 at 400, 410, 450 | yearly x3 |
| Two visits a year apart | 10 Apr 2025 at 2,000, 14 Apr 2026 at 2,100 | yearly x2 (FM accepted) |
| Weekly, two-week gap | 12 Mondays back from 26 Oct at 500, a two-week gap at the sixth | weekly x12, `onWeekday` Monday |
| Skipped month | m(10, 10, 900), the fifth removed | monthly x9 |
| Price change of 50 percent | m(8, 7, A), A 299 for the newest 3, else 199 | monthly x8 |
| Two changes in two years | m(24, 8, A), A 400, 300, 200 by eights | monthly x24 |
| Stopped subscription | m(12, 3, 199) without its newest 4 | monthly x8, stopped, quiet |
| Foreign charge in hryvnia | m(14, 9, A), A = 800 + 9i + 13(i mod 2) | monthly x14 |
| The 31st against February | Last day of Jan to Oct 2026 at 5,000 | monthly x10, `lastDay` |
| Card change, one currency | m(5, 11, 159) on `card2`, the older five of m(10, 11, 159) on `card` | monthly x10 |
| Two currencies | m(6, 3, 10) on a USD holding, m(6, 3, 400) | monthly x6 twice |
| Import twin, same day | m(6, 2, 250), and again as `import` | monthly x6 |
| Two charges only | m(2, 2, 250) | none |
| Rarer one-offs | m(12, 14, 99), 2 Mar at 4,500, 22 May at 1,200, 1 Aug at 7,000 | monthly x12 |
| Utility bill, wide amounts | m(12, 20, A), A cycles 400, 900, 1,500, 600 | monthly x12 |
| Each structural exclusion | m(12, 5, 1,000) with an exchange pair, a balance set, a change group, a linked loan, a crypto holding, one merchant each | none |
| Each matcher exclusion | The same with a cash-out MCC, own IBAN, deposit wording, matched pair, funded exchange debit | none |
| Name holding a month | "Оренда за <month>", m(6, 1, 15,000) | none (FS accepted) |
| Seasonal bill | 20th of Nov 2025 to Oct 2026 at 130, 100, 105, 110, 100, 108, 400, 700, 900, 800, 500, 300 | monthly x12 |
| Seasonal, one moved day | The same with its ninth on the 28th | monthly x12 |
| Apple among more frequent purchases | m(12, 5, 99), plus 15 rows one per month back from Oct, on days 3, 9, 17, 22, 28, 2, 11, 19, 25, 7, 13, 21, 27, 1, 16, at 29, 49, 199, 399, 29 by turn | monthly x12 |
| Apple, purchases near its price | The same at 89, 109, 119, 399, 29 by turn | monthly x12 |
| Apple, three purchases at its price | The same at 99, 109, 119, 399, 29 by turn | monthly x14: two same-priced one-offs stay linked (accepted) |
| Apple, most purchases at its price | The same at 99, 29 by turn | none (FS accepted) |
| Apple, too few charges | m(5, 5, 99), with the first purchase list | none (FS accepted) |
| Two large price changes | m(18, 6, A), A 170 for the newest 4, then 130 for 6, then 100 for 8 | monthly x18 |
| `daysBetween` order | 15 Aug, 15 Sep, 5 Oct at 90 | none |
| Funded debit, no hand category | m(8, 9, 4,100), all ids in `excludedIds` | none |
| Funded debit, hand category | m(8, 9, 4,100), `categorySetByHand` true | monthly x8 (FM accepted) |
| Quiet: sync dead with a newer other row | Netflix on the 15th, Spotify on the 18th, four months each, ending Aug; a coffee on 20 Aug | both monthly x4, stopped, quiet since 20 Aug |
| Quiet: import-only ledger | `import` rows on the 2nd, Jan to May 2026, and an `import` coffee on 25 May | monthly x5, stopped, quiet since 25 May |
| Quiet: black idle, white active | `black`: m(9, 3, 199) without its newest 4, a coffee on 20 Jun. `white`, one account: m(6, 4, 99) | black's series stopped, quiet since 20 Jun, naming `black`; white's active |
| Not quiet: card in use | m(12, 3, 199) without its newest 4, a coffee on 28 Oct | monthly x8, stopped, not quiet |
| Not quiet: a credit | The same, with a credit on 28 Oct in place of the coffee | monthly x8, stopped, not quiet |
| Future-dated manual row | m(8, 15, 15,000) as `manual`, and 15 Nov and 15 Dec 2026 as `manual` | monthly x8; last charge 15 Oct; no output day after today |
| Row later today | m(5, 3, 99), and 3 Nov at 23:50 | monthly x6; last charge today |
| Fold [monobank, import, import] | m(6, 2, 250), again as `import`, one more `import` on 2 Oct | monthly x7 |
| Date-only twin one day apart | m(6, 2, 250), m(6, 3, 250) as `import` | monthly x6, the Monobank rows kept |
| Twin two days apart | m(6, 2, 250), m(6, 4, 250) as `import` | none (FS accepted) |
| Any world above, rows shuffled | | The same result |
| Any world above, `withDeviceZoneOffset`, across a DST change | | The same result |

---

## 1.4-recurring task 1/3: detection and the list

**Goal:** the Settings row, the list with its sections, the recurrence text, the empty state, and a demo file a reviewer can read. Rows do not open yet. **Needs:** `1.4-category-automation task 2/6` on `next`. **Base:** a merge of that `next` into this branch.

**Files (floor 32, tests included; mutable 13; the developer measures).**
- Create: `src/recurring/eligibility/{eligibility.ts,index.ts,eligibility.test.ts}`; `src/recurring/detection/{detection.ts,detection.d.ts,index.ts,detection.test.ts,detection.performance.test.ts}`; `src/recurring/recurrence-text/{recurrence-text.ts,index.ts,recurrence-text.test.ts}`; `src/recurring/use-recurring-series/{use-recurring-series.ts,index.ts,use-recurring-series.test.tsx}`; `src/screens/settings/recurring-charges/{recurring-charges.screen.tsx,recurring-charges.styles.ts,index.ts,recurring-charges.screen.test.tsx}` with a `recurring-series-row/` unit
- Modify: `src/transactions/repo/transactions.repo.ts` plus a real SQLite pin, `src/navigation/settings-stack/settings.stack.tsx` and its test, `src/navigation/types/types.d.ts`, `src/navigation/entry-symbols/entry-symbols.ts`, `src/screens/settings/settings/settings.screen.tsx` and its test, `src/i18n/locales/{en,uk,title-keys}.ts`, `src/help/help-topics.ts` and its test (`TOPIC_TITLES`), `src/screens/settings/help-topic/help-topic.screen.tsx`, `src/transactions/merchant-name/merchant-name.ts` (one comment)
- Demo: create `e2e/screenshot/fixtures/build-demo-snapshot.recurring.test.ts`; modify `e2e/screenshot/seed/screenshot-seed.ts`, `e2e/screenshot/fixtures/README.md`; regenerate `e2e/screenshot/fixtures/kiko-demo-en.kiko` and `kiko-demo-uk.kiko`

**Acceptance:** every row of "The matrix" and one world per exclusion rule are pins; the demo file shows the five named bills as series and no shop; a clean install shows the row and the empty state; loading gates on `isLoading`; all new strings in both catalogues; `make jest-affected` or the named files green.

- [ ] **step 1/15 (kiko:qa): eligibility pins.** `eligibility.test.ts`, each monthly over twelve months, one world per rule of spec 4: out by `setsBalance`, `changeGroupId`, each of the three exchange markers, 6011 MCC, 4829 to an own IBAN, "Поповнення депозиту" wording, a matched pair, a funded exchange debit, `loanHoldingId`, a crypto account (Binance's ticker as description), an archived account, a missing holding, a credit, a blank description, a manual row whose local day is later than today. In: a 4829 to a third party, a closed holding, a `hold` row, a manual row, an import row, a row later today, and a funded debit with `categorySetByHand` (the accepted result of spec 4). Positive twin for each absence (kiko-testing, "An absence assertion must not go vacuous"). Red: `npx jest src/recurring/eligibility --maxWorkers=2`. Commit `test(recurring): which rows count as charges`.
- [ ] **step 2/15 (kiko:developer): eligibility.** Spec 4. Only calls the named functions. Green, same command. Knip reports exports until step 10: one developer run covers steps 2, 4, 6, 8, 10, 12; a Stop-hook Knip failure in between is that unfinished work. Commit `feat(recurring): eligibility`.
- [ ] **step 3/15 (kiko:qa): the matrix.** `detection.test.ts`: `it.each` over every row of "The matrix" below, with periods, count, recurrence, `isStopped`, `quiet`. Add: a stopped boundary either side for each period, and the same for `quiet`, on the same cutoff; the leave bound; the fold's kept order (synced over manual over import), and two same-source rows staying two; a folded row out of `chargeIds`; a Unicode trap across one merchant gives one series and one name. Property, through `sweep`, over random ledgers with rows on every side of today: shuffling gives a deep-equal result; every time in the output has a local day `<=` today's; a result is the same for any `now` on one local day; `chargeIds` are disjoint across series; a series' charges share one currency; a fold never leaves fewer charges for one day and amount than the largest count of one source. Under `withDeviceZoneOffset`: the 31st and a DST-crossing series give the same result. Sample keys for the hide list's dependency: `Netflix`, `ATB 0212`, `Silpo Market 12` against their keys. Red, named file. Commit `test(recurring): the false-match and false-miss matrix`.
- [ ] **step 4/15 (kiko:developer): detection.** Spec 5.2, 5.3, 6, 7; S3, S5, S6, S7. Reuse `addMonths` and `daysBetween` from `@kiko/holdings/interest`, with a deviation read as the larger of both orders because `daysBetween` clamps at zero; `startOfLocalDay` from `@kiko/dates`; `DAY_MS` only from `@kiko/dates`. Widen `merchantSpellingOf`'s comment, its one edit there. Stepping back uses local calendar fields (`new Date(y, m, d - n)`), never a fixed day span (`kiko-no-fixed-day-offset-into-local-day`). Green, named file. Commit `feat(recurring): detectRecurringSeries`.
- [ ] **step 5/15 (kiko:qa): counted-work pins.** `detection.performance.test.ts` on `buildRulesPerformanceFixture().rows`, mapped to `RecurringLedgerRow` by index on its own lines; the fixture is not edited (its shape pin holds): a `merchantNameOf` spy (`jest.mock` with `requireActual`) sees at most one call per distinct description; instrumented rows count reads of `time`, bound `rows x (log2(rows) + K)`, K set from this first run, stated in the test's constant, and never raised after; three fixture rows planted monthly are found (a non-vacuous twin; the monthly minimum is 3). No wall clock (the header of `transactions.repo.category-rules.performance.test.ts`). Once step 6 runs it green, the READY report lists every other series detection finds on the fixture, by key, period and charge count, read by a temporary line not committed; spec 10.2 leaves the reference's extra series not proven, and a monthly among them is a finding, not a pin to loosen. Commit `test(recurring): counted work on a large ledger`.
- [ ] **step 6/15 (kiko:developer): query and hook.** `recurringLedgerQuery` (S4), a real SQLite pin: the row shape, and EXPLAIN QUERY PLAN is `SCAN transactions` with no `TEMP B-TREE`. `useRecurringSeries`: the reads of spec 9.5, `paused: !useIsScreenVisible()` on every call, no `cached`, `now` from `useVisibleRefreshedNow`, `useMemo` on rows, holdings, accounts and `startOfLocalDay(now)` (S13). Its test: a write while hidden shows only on return (the existing pattern for tab screens); `isLoading` true until all reads settle; one detection per fire; a return on the same local day runs no detection, a return on the next day runs one (a spy on `detectRecurringSeries`). If the count pin of step 5 fails: spec 10.4's fix, never a weaker bound. Commit `feat(recurring): the live read`.
- [ ] **step 7/15 (kiko:qa): text pins.** `recurrence-text.test.ts`, one `describe` per language with the language set in a hook: each `Recurrence` kind; `lastChargeLine` for active, stopped, and quiet with the holding's name and the holding's newest date; dates as `formatDate` and `formatDayMonth`; uk weekdays accusative including «у пʼятницю» with U+02BC; every uk recurrence line in its past frame, no «Списання» opening one. Commit `test(recurring): the recurrence text`.
- [ ] **step 8/15 (kiko:developer): text and catalogue.** `recurrence-text.ts` with `ts-pattern` `.exhaustive()`; the keys of spec 13 that this task uses, the uk past frame checked against kiko-translator's rules (any wording it changes goes in spec 13 and the step 7 pins in this step); `title-keys.ts`. Not `notRecurring`, `hiddenHeading`, `showAgain`, `listChanged*`, `chargeCount`. Run: `npx jest src/recurring/recurrence-text src/i18n/locales --maxWorkers=2`. Commit `feat(i18n): recurring charges copy`.
- [ ] **step 9/15 (kiko:qa): screen pins.** `recurring-charges.screen.test.tsx`: loading shows `LoadingState`, not the empty state, while a read is queued; no series shows the empty state with its title and message; active then the stopped heading, ordered per spec 9.2; a row shows name, recurrence line, last charge, and amount in its own currency; two series under one name both listed; stopped and quiet lines, each with its amount, so two stopped rows under one name differ. `settings.screen.test.tsx`: the row is there with no data, directly above `settings-card-help` in the exact-order pin, opens `RecurringCharges`, marked `selected` through `isShown`. `settings.stack.test.tsx`: the route and its title. `help-topics.test.ts`: `TOPIC_TITLES` row. Commit `test(settings): recurring charges list`.
- [ ] **step 10/15 (kiko:developer): list, entry, help.** S8, S9. `entrySymbol.recurringCharges = 'repeat'`, checked against kiko-design-system "SF Symbol availability". A `Card` with `SettingsRow`, testID `settings-card-recurring-charges`, directly above `settings-card-help` (spec 9.1). Route `RecurringCharges: undefined`. Help topic with steps 1 and 2 of spec 14, action `openRecurringCharges` and `help.actions.openRecurringCharges` in both catalogues. Run the named files of this task and `npx jest src/help src/i18n/locales src/screens/settings src/navigation/settings-stack --maxWorkers=2`; `make doc-suites` if a skill or doc changed. Commit `feat(settings): recurring charges list`.
- [ ] **step 11/15 (kiko:qa): demo pin.** `e2e/screenshot/fixtures/build-demo-snapshot.recurring.test.ts`, beside `build-demo-snapshot.rule-demo.test.ts`: for en and uk, map `buildDemoSnapshot(buildScreenshotDataset(language, anchor))` to `RecurringInput` and run the real `detectRecurringSeries` at the anchor. The series' `merchantKey`s equal, by `toEqual` after a sort, the keys of `Netflix`, `demoText[language].kyivstar`, `.kyivteploenergo`, `YASNO` and `.kyivvodokanal`; each monthly, not stopped. The positive twin: the rows of `text.groceryStore`, `text.discountSupermarket` and `Uklon` are present in the same input and none of them is a series. Anchors: `Date.UTC(2026, 10, 3, 9)`, and in en the 1st and the 28th of each month of 2027, since a 30-day seed moves against calendar months. `text.utilities` is gone from the merged seed: no pin names it. Red: 24 series against 5. Commit `test(demo): the reviewer's file shows the bills and no shop`.
- [ ] **step 12/15 (kiko:developer): demo seed.** S14. A sentence in `e2e/screenshot/fixtures/README.md` says which merchants stay steady and why the others move. Regenerate the two `.kiko` files the way the fixtures README states (`KIKO_REGEN_DEMO=1` on `generate-demo-kiko.test.ts`), not the frozen `kiko-demo-en-1.1.kiko`. Run `build-demo-snapshot` tests, `generate-demo-kiko.test.ts`, `screenshot-seed.test.ts`, step 11's file. The seed's net-worth, spread, "12 newest rows" and "3 newest" pins stay as they are; a failure there is reported, not edited. Commit `feat(demo): shops move within their month, bills stay steady`.
- [ ] **step 13/15 Review (kiko:reviewer).** Top question: can any code path produce a future date or a total? Second: does anything but `merchantNameOf` decide a merchant?
- [ ] **step 14/15 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-domain ("Spending-exclusion pipeline" gains: a new exclusion rule also goes in `recurringExcludedIds`; a new section for the detection rule points at `src/recurring/`), kiko-architecture (the new whole-ledger live read; route list). Report the sha or "no drift found".
- [ ] **step 15/15 Device and Ready.** Device confirm by the user: a clean install shows the row and the empty text (uk too); on a release build on the user's real ledger, the report records that ledger's row count and the time from opening the list to the list showing, and the user names any stall (spec 10.3, fix path 10.4; the app shows no row count, so the coordinator settles with the user how to read it before this check); no false match the user objects to, listed by name for the coordinator; the demo file imported shows the five bills and no shop; iPad two panes and Duo fold. Label `1.4-recurring-task-1`.

---

## 1.4-recurring task 2/3: the series screen and its links

**Goal:** a list row opens one series; each past charge opens its form. **Needs:** task 1/3. **Base:** task 1/3 tip.

**Files (floor 12, tests included; mutable 6).**
- Create: `src/screens/settings/recurring-series/{recurring-series.screen.tsx,recurring-series.styles.ts,index.ts,recurring-series.screen.test.tsx,recurring-series.navigator.test.tsx}`
- Modify: `recurring-series-row` and the list screen (pressable), `transactions.repo.ts` plus a real SQLite pin, `settings.stack.tsx`, `types.d.ts`, `en.ts`, `uk.ts`, `help-topics.ts` and its test (`chargeCount` lands here, its first user)

**Acceptance:** every charge in `chargeIds` is one row, newest first, and opens `TransactionForm { transactionId }`; synced rows open read-only, manual rows editable (the form's own rule); back walks form, series, list; on two panes all three stay in the detail pane; a miss on `seriesId` follows S2.

- [ ] **step 1/8 (kiko:qa): query pin.** `listWithContextByIdsQuery`, real SQLite: returns exactly the ids, newest first, through `contextRowsQuery`'s shape; more ids than `IN_CLAUSE_CHUNK_SIZE` read in chunks (the existing chunk helper); a deleted holding's rows absent. Red. Commit `test(transactions): context rows by id`.
- [ ] **step 2/8 (kiko:developer): query.** Green, named file. Commit `feat(transactions): context rows by id`.
- [ ] **step 3/8 (kiko:qa): screen pins.** `recurring-series.screen.test.tsx`: header with recurrence line, last-charge line and `chargeCount` at 1, 2, 5, 21 in both languages; rows newest first with the date in the trailing slot; a tap calls the pane opener with `TransactionForm` and that `transactionId`; a miss on `seriesId` with exactly one series of the same `merchantKey`, `currency` and `period` shows that series; with none, and with two (two monthly Apple series), `EmptyState` with the `listChanged*` text, no other series, and no word about the merchant; the earliest charge deleted while the series still lists keeps the series on screen; a charge deleted in a live fire drops from the list; loading gated on `isLoading`. List test gains: a tap opens `RecurringSeries` with all of S2's params. Commit `test(settings): recurring series screen`.
- [ ] **step 4/8 (kiko:developer): screen.** S8. Shared `TransactionCard`, `transactionRowDescription`, `resolveCategoryDisplay`, `resolveCategoryColor`, `accountDisplayName` for the footer (an implicit account never by its raw name). Route `RecurringSeries: { seriesId: string; merchantKey: string; currency: Currency; period: RecurringPeriod; name: string }` (S2), title from `route.params.name`, set to the merchant's text, not translated. Help step 3, `chargeCount_*` and the `listChanged*` keys in both catalogues. Run named files. Commit `feat(settings): recurring series and its links`.
- [ ] **step 5/8 (kiko:qa): navigator pins.** `recurring-series.navigator.test.tsx` with `navigator-stack-probe`: single mode: list to series to form, back twice; split mode: all three in the detail pane, Settings stays in the list pane, the menu row stays marked; a fold keeps the route and its params; the form opened this way for a manual row saves and returns (the path the Settings stack did not have). Green at once is acceptable when the pane rule already holds: show the run, and prove one pin by a temporary wrong route name. Commit `test(navigation): series links in the Settings stack`.
- [ ] **step 6/8 Review (kiko:reviewer).** Top question: can a link open the wrong transaction after a live refresh?
- [ ] **step 7/8 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-architecture "Pane navigation" only if a rule changed; route lists. Report the sha or "no drift found".
- [ ] **step 8/8 Device and Ready.** Device confirm by the user: a tap on a charge opens the right transaction, synced read-only, manual editable; back order on phone, iPad, unfolded and folded Duo; the two-pane look; on a release build on the real ledger, the report records its row count and the time from opening a series (a second whole-ledger read plus detection, spec 10.3) to the series showing, and the user names any stall there or on Back (fix path spec 10.4). Label `1.4-recurring-task-2`.

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
- [ ] **step 4/10 (kiko:qa): UI pins.** Series screen: the button shows, a tap calls `hideRecurringMerchant` with `merchantKey` and `name`, a rejected write shows the save alert and stays, a second tap during the write is blocked (`useSubmitOnce`); between the hide write's live fire and `goBack` the screen still shows its series, never the `listChanged*` text. List: hidden series leave, the "Hidden" section lists each name in key order, including a hidden name with no rows; "Show again" calls `showRecurringMerchant`; two series under one key both go; with only hidden merchants the empty state and the section both show. Hook: a `settings` write runs no detection and no new ledger read. Commit `test(settings): hide and show a recurring merchant`.
- [ ] **step 5/10 (kiko:developer): UI.** S9, S10. The hook gains `hiddenMerchants`; the list screen filters by `merchantKey` after detection (S13), so a hide runs no detection and the series screen keeps its series. After a hide the series screen closes back to the list through `navigation.goBack()`. Remaining keys of spec 13; `hiddenHeading` in `title-keys.ts`; help step 4. Failure log fixed text. Run named files, `src/i18n/locales`, `src/help`. Commit `feat(settings): hide a false match`.
- [ ] **step 6/10 (kiko:qa): the sample-key pin.** The sample table of task 1/3 step 3 gains a comment: these keys are stored in `settings.recurringHiddenMerchants`; a change of `merchantNameOf` shows here, with spec 8's consequence. Confirm it fails when a sample's key is altered. No commit without the proof shown. Commit `test(recurring): stored keys follow the name function`.
- [ ] **step 7/10 Migration review (kiko:reviewer).** Required before BATCH READY, on the migration, schema, restore pins and `VERSION_DECISIONS` note. Top question: can any older-build path lose or change a row? Also read `git show release-1.3:src/data-transfer/import-data.ts` and the restore on that ref to confirm the key is dropped. No index, so no index EXPLAIN test.
- [ ] **step 8/10 Review (kiko:reviewer).** The whole diff. Top question: does anything other than the settings row change on hide?
- [ ] **step 9/10 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-architecture's data-transfer section, kiko-domain. Add to `docs/harness` only if a check moved. Report the sha or "no drift found".
- [ ] **step 10/10 Device and Ready.** Device confirm by the user: hide, the row goes, "Hidden" names it, show brings it back; export then restore keeps the list; both languages. Note the renumber need in the report if another migration reached `next` first (S12). Label `1.4-recurring-task-3`.

---

## Mutable file counts (floors; `make mutable` measures; the cap is 30)

| Task | Floor |
|---|---|
| 1/3 | 13 (the demo test and seed are not app code; `make mutable` decides) |
| 2/3 | 6 |
| 3/3 | 5 |

Mutation gates are paused by the user; this table is for a lift.

## Not in the tasks

A forecast, a reminder, a total, a period beyond the three, a user mark, an edit of Statistics, an edit of `merchantNameOf`, a change to `category`. What's New goes in App Store Connect at release (spec 14), and Notes for Review through the release skill.

## If the user answers differently

- **Q1 = B:** `Recurrence` shrinks to the period; `recurrence-text` loses the day and weekday keys; the matrix loses its recurrence column; no change to detection.
- **Q1 = C:** `Recurrence` gains `{ kind: 'dayRange'; from; to }` over the last 3 charges in place of `onDay` and `aroundDay`.
- **Q2 = B:** a new set after 3/3, with its own spec section: a second stored list, a period choice, a control in the transaction form, which meets `CategoryOverrideSheet`'s neighbours. Tasks 1/3 to 3/3 stay.
- **Q3 = B:** the two routes register in the Home and Statistics stacks and both param lists; the entry goes in `statistics.screen.tsx` below the grid, with `useOpenInPane` from a possible stand-in, and a Settings row still ships for the clean install. The conflict surface moves to `1.4-tables`. Task 1/3 grows by the stack tests.
- **Q4 = B:** drop S14, the seed edit and the `.kiko` regeneration from task 1/3. The demo pin of step 11 holds that the real function finds the named series on the unchanged seed, with no exact set. The file floor falls by those files.
- **If `1.4-category-automation` loses B3:** spec 3: its steps for `merchant-name.ts` move into task 1/3 as first caller. Never a copy.
