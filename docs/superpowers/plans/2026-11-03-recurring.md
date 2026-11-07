# Recurring Charges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings entry lists the charges that repeated in the user's own rows, with the recurrence date and links to every past charge, and a transaction can mark a charge the rule missed. No forecast of any kind.

**Architecture:** One pure function (`detectRecurringSeries`, injected `now`) over a narrow read of the whole ledger, behind one hook shared by two screens in the Settings stack. It writes nothing. The only stored item is a nullable settings column, one map of merchant keys to an entry that holds a hide flag, marks, or both. Names group by `merchantNameOf`, imported, never copied.

**Tech Stack:** React Native, Hermes, op-sqlite (SQLCipher), Drizzle, react-native-unistyles, i18next, ts-pattern, jest with `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-11-03-recurring-design.md`. Refer to it by section; this plan does not copy it, except the world matrix, whose rows are the contract ("The matrix" below). Every count here is a floor: the developer measures. Every code fact names a symbol, not a line: re-grep each fact on the actual base before building on it.

## User ruling and the fundamentals point

Relayed by the coordinator on 2026-11-03, for all 1.4 tracks: "For each feature, build the fundamentals first, then we can iterate fast on visuals and whatnot". The coordinator defines fundamentals as: the feature works end to end with correct data. Visual finish comes after, in fast rounds with the user on a device. Checks, verify, review and data correctness do not change. A feature still ships complete in the release, with nothing hidden.

**Fundamentals done: the tip of task 4/4 (step 14/14), the required device call for this feature.** Detection, the reversible hide and the mark are all in the user's Q2 answer, and a false match has no removal before task 3/4 (spec 15). No set is visual-only: apart from review, drift and Ready steps, every step of tasks 1/4 to 4/4 holds behavior, correct data or text the feature needs, so no step moved. Each set's device items wait for that call; its review and Ready do not. Visual finish follows in fast rounds, each with the same checks.

**An optional look before the point, not the point:** at task 2/4's tip, a release build on the user's real ledger shows detection on their history and gives spec 10.3's numbers early (a stall's fix, spec 10.4, changes that read). The coordinator decides whether to offer it, and task 3/4 does not wait for it.

## User answers

Relayed by the coordinator on 2026-11-03; the spec's head quotes them. Q1: "Charged monthly, on day 15" + "Last charge 15.10.2026". Q2: "1 + mark as recurring on transaction itself" (task 4/4). Q3: "Settings row, in the same group as categories" (task 1/4 steps 9 and 10). Q4: the demo seed changes so that five bills show (S14). Q5: "Name + amount chain": 100, 120, 144 stay together, and the store gains an amount; one rise over 25 percent drops later charges and shows a false "No charge since", which the user saw and accepted (spec 8.2). Q6: "One per chain". Approval: "Approve as planned"; the mark offers weekly, monthly, every 3 months, every 6 months and yearly. Merges stay as written: each set merges into `next` on the coordinator's call.

**A second consequence of Q5, found by the planner and told to the user through the coordinator (spec's head):** two subscriptions under one name within 25 percent, or at one price, sit in one chain, so a mark joins them and they can never separate.

**Measurement:** spec section 10.2 holds it. It comes from node with JIT and sqlite3 with no encryption, so no device figure exists: the look at task 2/4's tip records one, or else the call at the fundamentals point. The K of the counted pin is set from its own first run. Marks and their amount chains do not change detection's input or rule, so the reference is not re-run. Base of this plan's facts: 5256bf465 for Settings, the demo seed and task 4/4; c9896e1f9 for the rest.

**One release:** the four sets merge into `next` one at a time and `next` tolerates each middle state, but a release holds all four or none: hide is the remedy for the accepted yearly false match, and the user asked for the mark with the rest (spec 15).

## Global Constraints

- No next charge date, no reminder, no amount prediction, no projected total, no sum of any kind, in any output or text (the sum of past charges: reversed by spec 17.1 for the visual round). No output date has a local day later than today. Stopped steps back from `now`, never forward from a charge (spec 6, 7).
- `merchantNameOf`, `merchantSpellingOf`, `smallestSpelling` come from `@kiko/transactions/merchant-name` (category plan read at branch tip 71de98891, where that folder does not exist yet; re-grep). No copy, no wrapper with other rules, no local normalizing (spec 3).
- Eligibility calls the existing functions (`rowsForTransferMatch`, `internalTransferTransactionIds`, `mccExcludedTransferTransactionIds`, `descriptionExcludedTransferTransactionIds`, `exchangeFundingMatches`, `ibanOf`). No MCC, wording or marker list of its own beyond the structural fields of spec 4.
- Never sum or compare across currencies; the group key holds the currency.
- Detection writes nothing. A mark writes one settings entry, never a transaction column; a mark overrides no exclusion of spec 4. A stored amount is a selector: it compares only within its own currency's group, and no line shows it (a shown amount is the last real charge's). No widening of the 1.25 step, no merge of chains and no rule that hides the accepted false stop (spec 8.2).
- Guideline 2.5.19: no flag, no condition on the entry row; the screen explains itself with no data. The mark field shows by the row alone.
- UI: shared components and theme tokens only (no hex, no raw spacing). No import across screen folders (`check:screen-imports`); across features through the barrel (`check:feature-imports`).
- A catalogue key added: same step in `en.ts` and `uk.ts`; kiko-translator casing and full-stop rules; plurals `_one/_few/_many/_other` in both through `count`; uk apostrophe U+02BC; uk says «Кіко», «натиснути»; a screen or heading title goes in `title-keys.ts`. A text naming what a later set builds does not ship before that set (spec 14).
- Never log a name or an IBAN: a failure log is fixed text.
- Tests: kiko-testing. Fixtures use the local `Date` constructor and pinned instants, never the real clock plus a day span. A real SQLite test uses `executingClient` and `applyAllMigrations`. A property test goes through `sweep`, with its site in `__tests__/property-sweep-sites.test.ts`. No history note or task id in a test or comment. A qa red commit reads a missing export by a runtime lookup so the staged typecheck passes; the green commit tidies it. Show the red output. Never `--no-verify`. Keep jest output in a file.
- Harness: the orchestrator never queues. A task ends with READY FOR VERIFY to the coordinator, who queues `bash scripts/job-queue.sh verify <worktree> <label>`, reruns until green, and merges. Mutation gates are paused by the user, none is scheduled; if lifted, the gate is per set with `KIKO_MUTATION_BASE` at that set's own base, never one whole-track run. No agent runs `check:all`, full jest or verify.
- Dev test command: `make jest-affected BASE=<task base>`; exit 3 (`AFFECTS EVERY SUITE`) is expected for `en.ts`, `uk.ts` or `schema.ts`: run the named files of the task instead and say so in the READY report.

Run-log gaps: this track closes none and leaves all open. Nearest, left open: `20261015T1657-kiko-binance-backfill-fix/2` (no mechanized index check; this plan adds no index).

## Review Focus

1. An import of older rows while the series screen is open moves the earliest charge, so `seriesId` no longer resolves. Expected: the one series with the same merchant key, currency and period; with none or several, the neutral list text, never a guess and never a claim about the merchant. Pinned in task 2/4.
2. The first read is still queued when the screen mounts. Expected: `LoadingState`, never the empty state. Pinned in task 1/4.
3. A name with a Unicode trap (NFD, NBSP, final sigma) across rows of one merchant must land in one series with one shown name. Pinned in task 1/4.
4. A row deleted or edited from the form opened through a link: the live read refreshes and the series may end. Expected: the read is `paused` under the form, so on Back the last rows show until the re-read lands; then the shorter list, the fallback series, or the neutral text. A link opened in that gap resolves by its own id and the form handles a deleted row. Pinned in task 2/4.
5. A file with a malformed `recurringMerchantChoices` (array, number, wrong value type, an entry with no good field, a mark with an unknown period). Expected: reads as no choice, or drops that entry alone, no crash, the next write stores only good entries. Pinned in tasks 3/4 and 4/4.
6. The form opened by a series link: a mark set or removed there, then Back to a series whose result changed. Expected: spec 9.3's lookup; never a detected series sharing a row with a marked one, never a guess. A route opened on a marked series finds the piece spanning its amount or shows the neutral text, and never a detected series. Pinned in task 4/4.
7. A mark on a row the form cannot see is excluded (a matched own transfer). Expected: the row stays out of the series, and a mark with no charges in its chain shows under "Marked, No Charges", removable. Pinned in task 4/4.
8. A marked row deleted, edited, or settled at another amount, and a later row landing between two chains. Expected: the stored amount stays in the cut (spec 8.2), one result for any row order, no row in two shown series. Pinned in task 4/4.

## Details settled by this plan

| # | Decision | Reason |
|---|---|---|
| S1 | New feature folder `src/recurring/`, one folder per unit with its barrel: `eligibility`, `detection`, `recurrence-text`, `use-recurring-series`. | The hook is shared by two screens, which may not import each other; `src/statistics` must not gain a non-statistic; `src/transactions` importing `src/statistics` is avoided. |
| S2 | `seriesId` = id of the earliest charge by (time, id); list key the same. Route params hold `{ seriesId, merchantKey, currency, period, name }`. An id hit counts only with the route's `merchantKey` and `currency`; otherwise the miss path runs: the one series with the same `merchantKey`, `currency` and `period`, else the neutral text (a rename can give another merchant the earliest-charge id). Task 4/4 adds an optional `markedAmountMinorUnits?: number` to the params, absent on a detected series. A route holding it finds the piece spanning that amount, else the neutral text, with no `seriesId` step and no fallback (spec 9.3). | Params are JSON; a whole id list stays out of params. Two monthly Apple series must not be guessed between. Spec 9.3. |
| S3 | Shown name: `smallestSpelling` over the series' `merchantSpellingOf` values. `merchant-name.ts` stays untouched. | One spelling, order-free, the category plan's S1 pick. A cut prefix: a series crosses store numbers. |
| S4 | The narrow query selects: `id, holdingId, amountMinorUnits, time, description, mcc, counterIban, categorySetByHand, setsBalance, changeGroupId, exchangePairId, exchangeCounterpartHoldingId, untrackedCounterpart, loanHoldingId, source`. No `where`, no `orderBy`. | The matchers need both signs and blank rows (spec 10.1); the function sorts by itself, so an order would only cost. |
| S5 | `newestRowTimeByHolding` is computed in the one pass over the read, before any filter but the local-day one: a row later than today is no activity. `stoppedCutoff(period, now)` is one function; `isStopped` compares the last charge to it, and `quiet` compares that holding's newest row to it. | Spec 7: a row of either sign counts, one cutoff for both. |
| S6 | Group key `JSON.stringify([key, currency])`. | As `groupKeyOf` in `sync-adoption.ts`. |
| S7 | Constants, all in `detection.ts`, named and exported only if a test reads them: `MONTHLY`, `YEARLY`, `WEEKLY` period records (spec 5.1); `AMOUNT_STEP = 1.25`, `WEEKLY_AMOUNT_STEP = 1.1`, `MIN_FIT_SHARE = 0.75`, `MIN_OCCUPANCY = 0.75`, `MIN_COVERAGE = 0.5`, `ONE_A_SLOT_MIN_CHARGES = 6`, `DAY_SPLIT_GAP = 3`, `TWIN_DAY_REACH = 1`, `LEAVES_AFTER_MONTHS = 24`, `AROUND_DAY_SPREAD = 6`; each period record holds `stoppedAfter: { months, days }` (values in `detection.ts`). | No magic number; the matrix pins them. |
| S8 | The list and series screens are `FlatList` with `LargeTitleHeading` and `useLargeTitleScroll`, `HoldingDetail` the model. | kiko-design-system's custom list screen. |
| S9 | Sections as a flat array of `{ kind: 'heading'; section }` / `{ kind: 'series' }` / `{ kind: 'hidden' }` / `{ kind: 'empty' }`, not `SectionList`. The empty item stands in the flat array, because `ListEmptyComponent` cannot sit beside the hidden section. | `HoldingDetail`'s flattened list; the first scroll view drives the large title. |
| S10 | The hide button is `Button` secondary in the list footer of the series screen; "Show again" a `secondaryTonal` `Button` with `size="small"` and `fullWidth={false}` on the hidden row. No new shared component, so no `kiko:designer` step. | Reversible, so no `ConfirmSheet`. |
| S11 | A set's tasks stack in this worktree; each base is the previous tip. Task 1/4 starts from a merge of `next` holding `1.4-category-automation task 2/6`. | One editor; spec 3. |
| S12 | The choice column is generated at the journal tail + 1 of the task's base. A later-merging branch renumbers by deleting its four artifacts, merging `next` and re-running `npx drizzle-kit generate` (never a hand-edited `prevId`). No number in a test title, comment or skill. Allowed only before a build ships. | Same rule as the category plan's S6. |
| S13 | The hook returns the unfiltered `series`, `choices` from task 3/4, `markedSeries` from task 4/4, and the list filters. Its memo keys on `startOfLocalDay(now)`, and that value is the `now` detection receives. | The series screen then keeps its series between the hide write and `goBack`, with no flash of the neutral text. Back runs no detection. Spec 9.3, 9.5. |
| S14 | Demo seed: in `buildMonthlyExpenses`, a row's new field marks it as a steady bill: `Netflix`, `text.kyivstar`, `text.kyivteploenergo`, `YASNO`, `text.kyivvodokanal`. In `buildMainCardTransactions`, every other row that `buildMonthlyExpenses` gives, in odd `month` values only, moves a named constant of 10 days (a `dayOfMonth` under 15 adds ten, otherwise it subtracts ten, in odd months only). Amount unchanged, one row a month as before, `month` 0 never moves. The same edit read in memory on the reference gives exactly those five on all 731 daily anchors; the pin decides, not this sample. | The merged seed reads 24 series and moving only `text.groceryStore` leaves 23, so a reviewer would still read ATB and Fora as subscriptions (spec 12). The row stays in its 30-day month, so `MONTHLY_INCOME_MINOR_UNITS`'s deliberate down months keep their totals. `month` 0 stays, so the default 30-day window, the README's window counts and the "12 newest rows" and "3 newest" pins of `screenshot-seed.test.ts` read the same rows. Re-read at 5256bf465: the seed folder and `build-demo-snapshot.ts` are unchanged since c9896e1f9, and the probe re-run gives 24 as merged, 23 for groceries alone, and exactly the five on all 731 anchors at each shift of 6, 8, 9, 10, 11 and 12 days. |
| S15 | The mark is a `SelectField<'none' \| RecurringPeriod>` in its own child, `RecurringMarkField`, one element between `ModeAndActions` and `CommentRow`. The child holds its own `['settings']` read, enabled only for a row it offers on, and takes the screen's `holdings` and `accounts` as props; `useRowMark` adds the ledger read only when the entry holds a mark in the row's currency. The currency is that of `existing.holdingId`'s holding, never the screen's `currency`. Until `useRowMark` is ready the field states no value and stays `disabled`: a read loading or holding an `error`, the latter only on an enabled read (spec 9.6). | No growth in the screen's cognitive budget; no read on a credit or a new form; no ledger read on a row under an unmarked name; a pick must know whether it rewrites a chain or adds one; no new shared component, so no `kiko:designer` step (spec 9.6). |
| S16 | `RecurringPeriod` becomes five members in task 4/4, and `DetectedPeriod` is the three detection returns. `RecurringMerchantChoice` (`src/settings/recurring-merchant-choices.ts`, exported from `src/settings/index.ts`) in task 3/4 is `{ name; hidden: true }`, and task 4/4 makes it `{ name; hidden?: true; marks?: RecurringMark[] }` with its parser arm, where `RecurringMark` is `{ currency; amountMinorUnits; period }`, all required (spec 8.1, 8.2). An entry with neither drops. Task 3/4's parser reads `name` and `hidden` and drops the rest, which is safe because no `marks` value exists before task 4/4 and no build ships before all four sets; its readers test `.hidden === true`, never `.has`. | The column is a map of objects, so a field costs no migration; no unused type before its reader. So task 3/4 carries neither the amount nor its text. |
| S17 | `detectRecurringSeries` splits in task 4/4 into `chargeGroupsOf(input, now)` and `seriesOfGroups(groups, now)`; the composed function keeps its signature, and every matrix pin stays unedited. `markedSeriesOf(groups, markedEntries, now)` walks the marked keys only. | A mark fires `settings` alone and must run no detection (spec 9.5). |
| S18 | Spec 5.3 step 3's cut moves in task 4/4 into one exported function in `detection.ts`, `amountPiecesOf(amounts)`, and detection and `markedChainsOf` both call it, with `AMOUNT_STEP`. Detection's matrix stays unedited. `markedChainsOf` adds every stored amount of the key and currency to the charges' magnitudes before the cut; a piece's period is its lowest stored amount's, and a tie goes to the earlier period in `RECURRING_PERIODS` (`src/recurring/recurring-periods/recurring-periods.ts`), the picker's order. The parser keeps one mark per currency and amount, and `marks` read sorted by amount, then that period order, then currency; `markedSeriesOf` sorts its own input the same way, so a shuffled mark list gives one result. | One cut, never a second definition or a second tolerance. Stored amounts share one cut, so pieces share no row (spec 8.2). |

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
// Task 4/4, S16, S17: `period` widens; `Recurrence` gains { kind: 'marked' }; `RecurringSeries` gains `marks?: readonly RecurringMark[]` and `markedSpan?: { lowest: number; highest: number }` (over its charges and stored amounts, a lookup key never shown), set only by `markedSeriesOf`, absent on every detected series.
export const chargeGroupsOf: (input: RecurringInput, now: number) => ChargeGroups;
export const seriesOfGroups: (groups: ChargeGroups, now: number) => RecurringSeries[];
export const amountPiecesOf: (amounts: readonly number[]) => number[][]; // S18: spec 5.3 step 3's cut, ascending
// RecurringInput: { rows: readonly RecurringLedgerRow[]; holdings: readonly Pick<HoldingRow, 'id' | 'accountId' | 'name' | 'currency' | 'metadata'>[]; accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[] }

// @kiko/recurring/eligibility
export const recurringExcludedIds: (rows, holdings, accounts) => ReadonlySet<string>;
export const isRecurringCandidate: (row, holding, account) => boolean; // the structural part of spec 4
export const isOfferedForMark: (row, holding, account, ownIbans, now: number) => boolean; // task 4/4: the candidate test plus the two per-row matchers, the calls `recurringExcludedIds` makes

// @kiko/recurring/marked-series (task 4/4)
// MarkedEntry: { key; name; marks: readonly RecurringMark[] }. MarkedChain: { key; name; currency; period; marks: readonly RecurringMark[] }, one per piece.
export const markedSeriesOf: (groups: ChargeGroups, marked: readonly MarkedEntry[], now: number) => { series: RecurringSeries[]; withoutCharges: MarkedChain[] };
export const detectedBesideMarked: (detected: readonly RecurringSeries[], marked: readonly RecurringSeries[]) => RecurringSeries[]; // drops each detected series sharing a row with a marked one
export const markedChainOfAmount: (charges: readonly { amountMinorUnits: number }[], marks: readonly RecurringMark[], amountMinorUnits: number, currency: Currency) => { period: RecurringPeriod; marks: readonly RecurringMark[] } | null; // the piece whose lowest and highest amounts span this one, for the form; the marks are filtered to `currency`
// @kiko/recurring/use-row-mark (task 4/4)
export const useRowMark: (row: Pick<TransactionRow, 'amountMinorUnits' | 'description'>, currency: Currency, isOffered: boolean, holdings: RecurringInput['holdings'], accounts: RecurringInput['accounts']) => { chain: { period: RecurringPeriod; marks: readonly RecurringMark[] } | null; isReady: boolean };

// @kiko/recurring/recurrence-text
export const recurrenceLine: (period: RecurringPeriod, recurrence: Recurrence, t: TFunction) => string;
export const lastChargeLine: (series: RecurringSeries, t: TFunction) => string; // last charge, no charge since, or quiet

// @kiko/recurring/use-recurring-series
export const useRecurringSeries: () => { series: RecurringSeries[]; isLoading: boolean }; // unfiltered by a hide; task 3/4 adds choices, task 4/4 markedSeries and withoutCharges, and `series` then leaves out a detected series sharing a row with a marked one (S13)

// transactionsRepo
recurringLedgerQuery: () => /* S4 */;
listWithContextByIdsQuery: (ids: readonly string[]) => /* contextRowsQuery where id in (one json_each parameter, no chunking), time desc */; // task 2/4

// settingsRepo (task 3/4)
hideRecurringMerchant: (key: string, name: string) => Promise<void>;
showRecurringMerchantAgain: (key: string) => Promise<void>; // clears only the hide, an entry with neither drops; with no hide it writes nothing
recurringMerchantChoicesQuery: () => /* the one column */;
recurringMerchantChoicesOf: (stored: unknown) => ReadonlyMap<string, RecurringMerchantChoice>; // keys are user text (spec 8.1): every reader goes through this Map; a non-object reads as none; a bad entry is dropped alone
// settingsRepo (task 4/4)
markRecurringCharge: (key: string, name: string, mark: RecurringMark) => Promise<void>; // keeps the hide and the other marks, adds `mark`; a mark of the same currency and amount takes its period
setRecurringChainPeriod: (key: string, marks: readonly RecurringMark[], period: RecurringPeriod) => Promise<void>; // rewrites these marks' period in place, moves no amount, keeps the hide; writes nothing on an entry holding none of them
removeRecurringMarks: (key: string, marks: readonly RecurringMark[]) => Promise<void>; // clears only these and keeps the hide; an entry with neither drops; writes nothing on an entry holding none of them
```

## Conflict surface

| Task | Shared files | Other tracks |
|---|---|---|
| 1/4 | `e2e/screenshot/seed/screenshot-seed.ts`, `e2e/screenshot/fixtures/README.md`, the demo `.kiko` files, `settings.screen.tsx`, `settings.stack.tsx`, `src/navigation/types/types.d.ts`, `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts`, `help-topic.screen.tsx`, `entry-symbols.ts`, `transactions.repo.ts` | `1.4-small` is merged: the row goes in its group card, and its exact five-card pins stay five (spec 9.1). `1.4-category-automation` adds one route and edits the seed in its task 2/6, so regenerate the `.kiko` files on the merge. Its `buildStoreNumberTransactions` (draft name `Fora`) and later `buildSuggestionTransactions` (draft name `Aroma Kava`) add rows under merchants S14 moves: step 11's pin runs on the base that holds them |
| 2/4 | `settings.stack.tsx`, `types.d.ts`, `en.ts`, `uk.ts`, `transactions.repo.ts` | same |
| 3/4 | `schema.ts`, journal, `migrations.js`, `envelope.test.ts`, `settings-columns.test.ts`, `import-data.back-compat.test.ts`, `real-sqlite.ts`, `settings.repo.ts` | `1.4-category-automation` adds two migrations: S12 |
| 4/4 | `transaction-form.screen.tsx` (one import, one element), its suites' repo mocks, `src/test-support/transaction-form-data-layer.ts`, `settings.repo.ts`, `en.ts`, `uk.ts`, `help-topics.ts` | `1.4-category-automation task 2/6` edits the same screen at `CategoryOverrideSheet` and `use-category-override.ts`, and its later sets edit form hooks: no shared line expected (spec 9.6; read at tip 71de98891, where that set has not started) |
| All UI | theme tokens | `1.4-light-scheme`: applies by itself. `1.4-tables`: Statistics untouched. `1.4-bybit`: covered by the account kind allow-list |

## Closing steps (every task, same order)

- **Review:** `kiko:reviewer` on the task's diff from its base. The diff of test files is checked for edited pins.
- **Drift:** `kiko:retrospect` checks `.claude/skills/`, `harness/kiko/skills/`, `harness/kiko/agents/` against the task's code.
- **Scribe:** `kiko:scribe` fixes the drift and commits; the report names the sha or "no drift found".
- **Device:** the coordinator gets the user's device confirm on the items the task lists, at the fundamentals point (UI needs it; a queued build goes through the coordinator).
- **Ready:** READY FOR VERIFY to the coordinator: worktree, label `1.4-recurring-task-N`, base sha, head sha, mutable file count (`make mutable`), named-file runs and their output path. The coordinator queues the verify, reruns until green, and merges.

---

## The matrix (the contract of task 1/4 step 3)

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

## The marked matrix (the contract of task 4/4 step 3)

Rows that `1.4-recurring-visual-2 task 6/6` (one charge per period, spec 8.3) changes are listed with their `was` in that
task's table; that table wins over a cell below.

The same conventions; each row adds a stored entry for the world's name. A Mark names its period and, where the world holds more than one amount or none at that value, its stored amount; with none named, it stores the amount of the world's rows in their holding's currency (UAH unless the row says). Each table's No entry column is the result with no entry; every row also runs with no entry, and that result must hold. Hide, link and user-text-key flows are in "Marked flows" below. Line is the recurrence line. "marked" means `marks` is set; a detected series beside it has none. A world's rows outside the Expected series are in no series unless it says so. Stopped uses the monthly cutoff of 26 Sep 2026 unless the period differs.

Amount chain worlds. Each cell is hand-walked by spec 5.2, 5.3, 6, 7 and 8.2; the developer re-reads any cell a pin disagrees with and reports it, never edits to green.

| World | Rows | Mark | No entry | Expected |
|---|---|---|---|---|
| Chain stays together | 15 Aug at 100, 15 Sep at 120, 15 Oct at 144 | monthly at 100 | monthly x3, `onDay` 15 | one x3, `onDay` 15, marked; the same at 144 |
| Exactly 1.25 joins | 15 Sep at 100, 15 Oct at 125 | monthly at 100 | none | one x2, line "Marked: monthly" |
| Past 1.25 cuts | 15 Sep at 100, 15 Oct at 126 | monthly at 100 | none | one x1, line "Marked: monthly", stopped since 15 Sep, not quiet (newest row 15 Oct) |
| Rise over 25 percent (accepted) | m(8, 7, A), A 130 for the newest 3, else 100 | monthly at 100 | monthly x8, `onDay` 7 | one x5, `onDay` 7, marked, last charge 7 Jul at 100, stopped, not quiet (newest row 7 Oct); the detected x8 leaves whole |
| The same, at the new price | The same | monthly at 130 | monthly x8, `onDay` 7 | one x3, `onDay` 7, marked, last charge 7 Oct, active; the detected x8 leaves whole |
| Re-mark after a rise | The same | monthly at 100 and monthly at 130 | monthly x8, `onDay` 7 | two: x5 stopped, not quiet, and x3 active, `onDay` 7 each, no row in both |
| A later row bridges | The same, plus 7 Feb at 115 | monthly at 100 | monthly x9, `onDay` 7 | one x9, `onDay` 7, marked, active |
| Two marks, one piece | The same, plus 7 Feb at 115 | monthly at 100 and every 3 months at 130 | monthly x9, `onDay` 7 | one x9, monthly, `onDay` 7, `marks` holds both; without the 115, x5 monthly stopped and x3 "Marked: every 3 months" |
| Stored amounts share one cut | 15 Sep at 80, 15 Oct at 120 | monthly at 100 and yearly at 150 | none | one x2, monthly, line "Marked: monthly" |
| Two chains, one marked | m(10, 5, 99), m(10, 20, 399) | monthly at 99 | monthly x10 twice | marked x10, `onDay` 5, and detected monthly x10, `onDay` 20 |
| Two chains, both marked | The same | monthly at 99 and monthly at 399 | monthly x10 twice | two marked x10, no detected |
| Two detected series, one chain | m(10, 5, 99), m(10, 20, 119) | monthly at 99 | monthly x10 twice | one x20, line "Marked: monthly" (119/99 = 1.20; no pair fits), both detected leave; the same at 119, so the two never separate |
| The same, at one price | m(10, 5, 99), m(10, 20, 99) | monthly at 99 | monthly x10 twice | one x20, line "Marked: monthly", both detected leave |
| Monthly beside a marked yearly | m(24, 5, 99), 12 Mar 2025 and 2026 at 999 | yearly at 999 | monthly x24, yearly x2 | marked yearly x2, `onDate`, and detected monthly x24 |
| Rarer one-offs stay out | m(12, 14, 99), 2 Mar at 4,500, 22 May at 1,200, 1 Aug at 7,000 | monthly at 99 | monthly x12 | one x12, `onDay` 14, marked; the detected x12 leaves whole |
| A later purchase | The same, plus 1 Nov at 4,500 | monthly at 99 | monthly x12 | one x12, last charge 14 Oct at 99 |
| Cancelled, purchases go on | m(12, 14, 99) without its newest 4, 28 Oct at 4,500, 30 Oct at 7,000 | monthly at 99 | monthly x8, stopped, not quiet | one x8, `onDay` 14, marked, stopped since 14 Jun, not quiet |
| Purchases in reach link | "Apple, purchases near its price" | monthly at 99 | monthly x12 | one x21, line "Marked: monthly" (5 of 20 pairs fit), last charge 5 Oct at 99; 399 and 29 out; the detected x12 leaves whole |
| Same digits, two currencies | m(1, 3, 400) on a USD holding, m(1, 3, 400) | monthly at 400 UAH | none | one x1 in UAH; the USD row in no series |
| Two currencies, one marked | m(6, 3, 10) on a USD holding, m(6, 3, 400) | monthly at 400 UAH | monthly x6 twice | marked x6 in UAH, `onDay` 3, and detected USD x6, never summed |
| Two currencies, both marked | m(1, 3, 10) on a USD holding, m(1, 3, 400) | monthly at 10 USD and monthly at 400 UAH | none | two x1, never summed |
| Marked row deleted | 15 Sep at 120, 15 Oct at 144 | monthly at 100 | none | one x2, line "Marked: monthly" |
| Marked row edited out of reach | 15 Aug at 500, 15 Sep at 120, 15 Oct at 144 | monthly at 100 | monthly x3, `onDay` 15 | one x2, line "Marked: monthly"; the 500 row out; the detected x3 leaves whole |
| Stored amount bridges, its row deleted | 15 Sep at 99, 15 Oct at 130 | monthly at 115 | none | one x2, line "Marked: monthly" (130/99 alone would cut); with the mark removed, no series |
| Stored amount bridges, its row edited | 15 Aug at 80, 15 Sep at 120, 15 Oct at 500 | monthly at 100 | none | one x2 over 80 and 120, line "Marked: monthly", stopped since 15 Sep, not quiet (newest row 15 Oct); the 500 row out |
| A hold settled at another amount | 15 Sep at 800, 15 Oct at 838 | monthly at 835 | none | one x2, line "Marked: monthly" |
| Nothing in reach | m(6, 3, 700) | monthly at 400 | monthly x6 | no marked series; one in `withoutCharges`; detected monthly x6 stands |
| No rows, two marks in one piece | None | monthly at 100 and yearly at 120 | none | one in `withoutCharges`, period monthly, `marks` holds both |
| No rows, two pieces | None | monthly at 100 and yearly at 400 | none | two in `withoutCharges` |
| A credit at the stored amount | m(3, 3, 500) as credits, plus m(3, 3, 900) | monthly at 500 | monthly x3 at 900 | no marked series; one in `withoutCharges`; detected x3 stands |

Worlds of one amount, where the chain is the whole group:

| World | Rows | Mark | No entry | Expected |
|---|---|---|---|---|
| Quarterly | 12 Jan, Apr, Jul, 10 Oct 2026 at 300 | every 3 months | none | one x4, line "Marked: every 3 months", not stopped |
| Half-yearly | 5 Oct 2025, 5 Apr, 5 Oct 2026 at 900 | every 6 months | none | one x3, line "Marked: every 6 months", not stopped |
| One charge | 15 Oct at 250 | monthly | none | one x1, line "Marked: monthly", last charge 15 Oct |
| Two charges | 15 Sep, 15 Oct at 250 | monthly | none | one x2, line "Marked: monthly" |
| Three on one day | m(3, 15, 250) | monthly | monthly x3, `onDay` 15 | one x3, `onDay` 15, marked |
| Three on spread days | 2 Aug, 19 Sep, 28 Oct at 250 | monthly | none | one x3, line "Marked: monthly" |
| Yearly, one | 12 Mar 2026 at 400 | yearly | none | one x1, line "Marked: yearly" |
| Yearly, two | 12 Mar 2025 and 2026 at 400 | yearly | yearly x2, `onDate` | one x2, `onDate` |
| Weekly, three | 3 Mondays back from 26 Oct at 100 | weekly | none | one x3, line "Marked: weekly" |
| Weekly, four | 4 Mondays back from 26 Oct at 100 | weekly | none | one x4, line "Marked: weekly" (weekly minimum 5) |
| Weekly, five | 5 Mondays back from 26 Oct at 100 | weekly | weekly x5, `onWeekday` Monday | one x5, `onWeekday` Monday, marked |
| Quarterly charges, marked monthly | 12 Jan, Apr, Jul 2026 at 300 | monthly | none | one x3, line "Marked: monthly" (occupancy 3/7), stopped, quiet since 12 Jul |
| A month apart, marked yearly | 20 Dec 2025, 15 Jan 2026 at 400 | yearly | none | one x2, line "Marked: yearly" (0 slots) |
| Monthly, one skipped | 15 Jul, 15 Sep, 15 Oct 2026 at 250 | monthly | monthly x3, `onDay` 15 | one x3, `onDay` 15, marked |
| Monthly fit, no honest day | 1 Aug, 5 Sep, 9 Oct at 250 | monthly | monthly x3, `none` ("Charged monthly") | one x3, line "Marked: monthly" (days 1, 5, 9 fit, but spread 8, past section 6's 6, so no slot) |
| Daily shop | The daily world | monthly at its first row's amount | none | one of all rows, line "Marked: monthly" (500 seeded rows over 100 to 1,600 leave no gap over 1.25; a cut the seed does show is reported, and the count is that piece's) |
| Period conflict | m(12, 3, 199) | yearly | monthly x12, `onDay` 3 | one yearly x12, line "Marked: yearly", not stopped; the yearly cutoff decides stopped |
| Stopped, by the mark's period | 3 Jan, 3 Apr, 3 Jul 2026 at 199 | every 3 months | none | one x3, stopped by 3 months plus 14 days, quiet since 3 Jul |
| Not stopped, one day inside | 3 Jan, 3 Apr, 21 Jul 2026 at 199 | every 3 months | none | one x3, not stopped |
| Quiet | The sync-dead Netflix world | monthly | monthly x4, stopped, quiet since 20 Aug | stopped, quiet since 20 Aug |
| Name holding a month | "Оренда за жовтень", one row | monthly | none | one x1; "Оренда за вересень" stays out |
| Twin | m(2, 2, 250), and again as `import` | monthly | none | one x2 |
| Future-dated manual | 15 Oct, 15 Nov 2026 as `manual` | monthly | none | one x1; no output day after today |
| Past the leave bound | 3 May 2024 at 300 | monthly | none | one x1, stopped, quiet since 3 May 2024 (the holding's only row, S5), still listed |
| Some rows excluded | m(6, 3, 700), 3 Sep and 3 Jun with `loanHoldingId` | monthly | none | one x4, line "Marked: monthly" (`4 / 6` is under 0.75) |
| Only row a matched pair | One debit with its credit | monthly | none | no series; in `withoutCharges` |
| Each rule, all rows excluded | One merchant per kind: exchange pair, balance set, change group, linked loan, crypto holding, cash-out MCC, own IBAN, deposit wording, funded debit, archived account, missing holding | monthly | none | no series; in `withoutCharges` |
| Only a future row | 15 Nov 2026 as `manual` | monthly | none | no series; in `withoutCharges` |
| Credits only | m(3, 3, 500) as credits | monthly | none | no series; in `withoutCharges` |
| No rows | None | monthly at 100 | none | no series; in `withoutCharges` |
| Hidden key, no mark | m(6, 3, 700) | hidden | monthly x6, `onDay` 3 | not in `series` or `withoutCharges`: an entry with no marks is no marked entry |
| Hidden key, with a mark | m(6, 3, 700) | hidden, and monthly at 700 | monthly x6, `onDay` 3 | one x6, `onDay` 3, marked: a hide affects detected series only |
| Any world of either table, rows shuffled, or under `withDeviceZoneOffset` | | | | The same result |

## Marked flows (the contract of task 4/4 steps 5/14, 7/14, 9/14 and 11/14)

`was` is the result at 41be4a687 where a ruling changed it; otherwise the result before marks, the hide alone in a hidden row, and "not reachable" where the path needs a mark. "Route" is the series screen opened by link; a marked route holds `markedAmountMinorUnits`, and each marked-route row sets its `seriesId` to an id a detected series holds where one can.

| Flow | was | Expected |
|---|---|---|
| Hidden, then marked | marked; the "Hidden" line leaves | the marked series, and the "Hidden" line stays until "Show again" |
| Hidden, then marked, then removed | no entry: the detected series, no "Hidden" line | `{ name, hidden: true }`: the "Hidden" line, no series; "Show again" gives the detected series |
| Marked, then removed, then hidden | hidden | hidden; one entry at every point |
| Marked 99 beside a detected 399, then hide on the 399 | hidden, the mark gone; "Show again" gives two detected series | the marked 99 stays, the 399 leaves, a "Hidden" line; "Show again" gives the 399 beside the marked 99 |
| Hidden, then "Not marked" tapped in the form | the hide dropped, no notice | still hidden, nothing written |
| A row of 144 with 100 stored, a yearly pick | one mark at 144, the 100 replaced | the 100 now yearly; the store still holds 100 |
| A row of 399 beside a stored 99, a pick | adds beside the 99 | adds beside the 99 |
| Detected route, its whole series marked in the form, Back | not reachable | the marked series holding the route's `seriesId` |
| Detected route on an x8, a 130 row marked in the form, Back | not reachable | the neutral text: the detected series left, and its `seriesId` is not in the chain |
| Marked route, one detected monthly under the key, mark removed in the form, Back | that series, by the fallback | the neutral text |
| Marked route, Apple 99 beside a detected 399, mark removed in the form, Back | the neutral text | the neutral text |
| Marked route, yearly over a detected monthly, mark removed in the form, Back | the neutral text | the neutral text |
| Marked route, marks-only 99 x2 beside a detected 399 x10, "Not marked" in the form, Back | the detected 399, by the fallback | the neutral text, not 399 |
| Marked route, 99 x10, one 119, a detected 399 x10, marked at 99, a yearly pick on the 119 row, Back | the store moved to 119, the route's 99 missed, the detected 399 by the fallback | the marked x11, yearly: the store still holds 99, and the route's amount lies in the piece's span |
| A merchant named `constructor`, with no choice | monthly | monthly: no choice is read, and the field reads "Not marked" |
| A merchant named `__proto__`, one charge, marked, then reloaded | none | one marked series; the entry survives the write and the read |

---

## 1.4-recurring task 1/4: detection and the list

**Goal:** the Settings row, the list with its sections, the recurrence text, the empty state, and a demo file a reviewer can read. Rows do not open yet. **Needs:** `1.4-category-automation task 2/6` on `next`. **Base:** a merge of that `next` into this branch.

**Files (floor 47, was 46, tests included: 18 + 5 + 22 + 2 regenerated, counted from the lists below; mutable 13; the developer measures).**
- Create: `src/recurring/eligibility/{eligibility.ts,index.ts,eligibility.test.ts}`; `src/recurring/detection/{detection.ts,detection.types.d.ts,index.ts,detection.test.ts,detection.performance.test.ts}`; `src/test-support/recurring-ledger.ts` (the ledger helper, once `detection-test-helper.ts`); `src/recurring/recurrence-text/{recurrence-text.ts,index.ts,recurrence-text.test.ts}`; `src/recurring/use-recurring-series/{use-recurring-series.ts,index.ts,use-recurring-series.test.tsx}`; `src/screens/settings/recurring-charges/{recurring-charges.screen.tsx,recurring-charges.styles.ts,index.ts,recurring-charges.screen.test.tsx}`; `src/screens/settings/recurring-charges/recurring-series-row/{recurring-series-row.component.tsx,recurring-series-row.props.d.ts,recurring-series-row.styles.ts,index.ts,recurring-series-row.component.test.tsx}`
- Modify: `src/transactions/repo/transactions.repo.ts` plus a real SQLite pin, `src/navigation/settings-stack/settings.stack.tsx` and its test, `src/navigation/types/types.d.ts`, `src/navigation/entry-symbols/entry-symbols.ts` and its test (its exact `toEqual`), `src/screens/settings/settings/settings.screen.tsx` and its test, `src/i18n/locales/{en,uk,title-keys}.ts`, `src/help/help-topics.ts` and its test (`TOPIC_TITLES`), `src/screens/settings/help-topic/help-topic.screen.tsx` and its test (its per-action table), `__tests__/property-sweep-sites.test.ts` (its exact list, for step 3's property test), `scripts/checks/feature-imports.js` (`'recurring'` in `CONTAINERS`: step 4)
- Demo: create `e2e/screenshot/fixtures/build-demo-snapshot.recurring.test.ts`; modify `e2e/screenshot/seed/screenshot-seed.ts`, `e2e/screenshot/fixtures/README.md`; regenerate `e2e/screenshot/fixtures/kiko-demo-en.kiko` and `kiko-demo-uk.kiko`

**Acceptance:** every row of "The matrix" and one world per exclusion rule are pins; the demo file shows the five named bills as series and no shop; a clean install shows the row and the empty state; loading gates on `isLoading`; all new strings in both catalogues; `make jest-affected` or the named files green.

- [x] **step 1/15 (kiko:qa): eligibility pins. Done: b9fccc308.** `eligibility.test.ts`, each monthly over twelve months, one world per rule of spec 4: out by `setsBalance`, `changeGroupId`, each of the three exchange markers, 6011 MCC, 4829 to an own IBAN, "Поповнення депозиту" wording, a matched pair, a funded exchange debit, `loanHoldingId`, a crypto account (Binance's ticker as description), an archived account, a missing holding, a credit, a blank description. In: a 4829 to a third party, a closed holding, a `hold` row, a manual row, an import row, and a funded debit with `categorySetByHand` (the accepted result of spec 4). The local-day rule is not here: `recurringExcludedIds` and `isRecurringCandidate` take no `now`. S5 and the matrix rows "Future-dated manual row" and "Row later today" pin it. Positive twin for each absence (kiko-testing, "An absence assertion must not go vacuous"). Red: `npx jest src/recurring/eligibility --maxWorkers=2`. Commit `test(recurring): which rows count as charges`.
- [x] **step 2/15 (kiko:developer): eligibility. Done: 8a2cfc5b5.** Spec 4. Only calls the named functions. Green, same command. Knip reports exports until step 10: one developer run covers steps 2, 4, 6, 8, 10, 12; a Stop-hook Knip failure in between is that unfinished work. Commit `feat(recurring): eligibility`.
- [ ] **step 3/15 (kiko:qa): the matrix.** `detection.test.ts`: `it.each` over every row of "The matrix" below, with periods, count, recurrence, `isStopped`, `quiet`. Add: a stopped boundary either side for each period, and the same for `quiet`, on the same cutoff; the leave bound; the fold's kept order (synced over manual over import), and two same-source rows staying two; a folded row out of `chargeIds`; a Unicode trap across one merchant gives one series and one name. Property, through `sweep`, over random ledgers with rows on every side of today: shuffling gives a deep-equal result; every time in the output has a local day `<=` today's; a result is the same for any `now` on one local day; `chargeIds` are disjoint across series; a series' charges share one currency; a fold never leaves fewer charges for one day and amount than the largest count of one source. Under `withDeviceZoneOffset`: the 31st and a DST-crossing series give the same result. Sample keys for the hide list's dependency: `Netflix`, `ATB 0212`, `Silpo Market 12` against their keys. Red, named file. Commit `test(recurring): the false-match and false-miss matrix`.
- [ ] **step 4/15 (kiko:developer): detection.** First edit: `'recurring'` in `CONTAINERS` of `scripts/checks/feature-imports.js`, between `'rates'` and `'reminders'`. By reading, `src/recurring/` holds only barrelled units, so `--tree` already reports it as `undeclared-container` at 8a2cfc5b5, and `@kiko/recurring/eligibility` would read as `alias-skips-barrel`. No test pins that list. Spec 5.2, 5.3, 6, 7; S3, S5, S6, S7. Reuse `addMonths` and `daysBetween` from `@kiko/holdings/interest`, with a deviation read as the larger of both orders because `daysBetween` clamps at zero; `startOfLocalDay` from `@kiko/dates`; `DAY_MS` only from `@kiko/dates`. `merchant-name.ts` stays untouched. Stepping back uses local calendar fields (`new Date(y, m, d - n)`), never a fixed day span (`kiko-no-fixed-day-offset-into-local-day`). Green, named file. Commit `feat(recurring): detectRecurringSeries`.
- [ ] **step 5/15 (kiko:qa): counted-work pins.** `detection.performance.test.ts` on `buildRulesPerformanceFixture().rows`, mapped to `RecurringLedgerRow` by index on its own lines; the fixture is not edited (its shape pin holds): a `merchantNameOf` spy (`jest.mock` with `requireActual`) sees at most one call per distinct description; instrumented rows count reads of `time`, bound `rows x (log2(rows) + K)`, K set from this first run, stated in the test's constant, and never raised after; three fixture rows planted monthly are found (a non-vacuous twin; the monthly minimum is 3). No wall clock (the header of `transactions.repo.category-rules.performance.test.ts`). Once step 6 runs it green, the READY report lists every other series detection finds on the fixture, by key, period and charge count, read by a temporary line not committed; spec 10.2 leaves the reference's extra series not proven, and a monthly among them is a finding, not a pin to loosen. Commit `test(recurring): counted work on a large ledger`.
- [ ] **step 6/15 (kiko:developer): query and hook.** `recurringLedgerQuery` (S4), a real SQLite pin: the row shape, and EXPLAIN QUERY PLAN is `SCAN transactions` with no `TEMP B-TREE`. `useRecurringSeries`: the reads of spec 9.5, `paused: !useIsScreenVisible()` on every call, no `cached`, `now` from `useVisibleRefreshedNow`, `useMemo` on rows, holdings, accounts and `startOfLocalDay(now)` (S13). Its test: a write while hidden shows only on return (the existing pattern for tab screens); `isLoading` true until all reads settle; one detection per fire; a return on the same local day runs no detection, a return on the next day runs one (a spy on `detectRecurringSeries`). If the count pin of step 5 fails: spec 10.4's fix, never a weaker bound. Commit `feat(recurring): the live read`.
- [ ] **step 7/15 (kiko:qa): text pins.** `recurrence-text.test.ts`, one `describe` per language with the language set in a hook: each `Recurrence` kind; `lastChargeLine` for active, stopped, and quiet with the holding's name and the holding's newest date; dates as `formatDate` and `formatDayMonth`; uk weekdays accusative including «у пʼятницю» with U+02BC; every uk recurrence line in its past frame, no «Списання» opening one. Commit `test(recurring): the recurrence text`.
- [ ] **step 8/15 (kiko:developer): text and catalogue.** `recurrence-text.ts` with `ts-pattern` `.exhaustive()`; the keys of spec 13 that this task uses, the uk past frame checked against kiko-translator's rules (any wording it changes goes in spec 13 and the step 7 pins in this step); `title-keys.ts`. Not `notRecurring`, `hiddenHeading`, `showAgain`, `listChanged*`, `chargeCount`. Run: `npx jest src/recurring/recurrence-text src/i18n/locales --maxWorkers=2`. Commit `feat(i18n): recurring charges copy`.
- [ ] **step 9/15 (kiko:qa): screen pins.** `recurring-charges.screen.test.tsx`: loading shows `LoadingState`, not the empty state, while a read is queued; no series shows the empty state with its title and message; active then the stopped heading, ordered per spec 9.2; a row shows name, recurrence line, last charge, and amount in its own currency; two series under one name both listed; stopped and quiet lines, each with its amount, so two stopped rows under one name differ. `settings.screen.test.tsx`, re-grep each anchor: the row `settings-row-recurring-charges` is there with no data, inside `settings-card-categories-reminders-templates`, opens `RecurringCharges`. In one step: `groups Categories, Reminders and Transaction templates into one card, in that order` gets a widened title, regex and expected order, with the new row and `settings-divider-templates-recurring-charges` last (its regex lists names, so left as it is it passes blind); `styles the Categories-Reminders-Templates card like the Import/Export card` adds the row and the divider to its lists; `ROWS` in `the selected row` adds `['RecurringCharges', GROUP_CARD, 'settings-row-recurring-charges', false]`. Both exact five-card pins stay unedited: an edit there is a finding. `settings.stack.test.tsx`: the route and its title. `help-topics.test.ts`: `TOPIC_TITLES` row. Commit `test(settings): recurring charges list`.
- [ ] **step 10/15 (kiko:developer): list, entry, help.** S8, S9. `entrySymbol.recurringCharges = 'repeat'`, checked against kiko-design-system "SF Symbol availability". A `Divider` and a `SettingsRow` at the end of the group card, after `settings-row-transaction-templates`, with `groupedRowStyle`, `groupedDividerStyle` and `selected={isShown('RecurringCharges')}` (spec 9.1). Route `RecurringCharges: undefined`. Help topic with steps 1 and 2 of spec 14, action `openRecurringCharges` and `help.actions.openRecurringCharges` in both catalogues. Run the named files of this task and `npx jest src/help src/i18n/locales src/screens/settings src/navigation/settings-stack --maxWorkers=2`; `make doc-suites` if a skill or doc changed. Commit `feat(settings): recurring charges list`.
- [ ] **step 11/15 (kiko:qa): demo pin.** `e2e/screenshot/fixtures/build-demo-snapshot.recurring.test.ts`, beside `build-demo-snapshot.rule-demo.test.ts`: for en and uk, map `buildDemoSnapshot(buildScreenshotDataset(language, anchor))` to `RecurringInput` and run the real `detectRecurringSeries` at the anchor. The series' `merchantKey`s equal, by `toEqual` after a sort, the keys of `Netflix`, `demoText[language].kyivstar`, `.kyivteploenergo`, `YASNO` and `.kyivvodokanal`; each monthly, not stopped. The positive twin: the rows of `text.groceryStore`, `text.discountSupermarket` and `Uklon` are present in the same input and none of them is a series. Anchors: `Date.UTC(2026, 10, 3, 9)`, and in en the 1st and the 28th of each month of 2027, since a 30-day seed moves against calendar months. `text.utilities` is gone from the merged seed: no pin names it. Red: 24 series against 5. Commit `test(demo): the reviewer's file shows the bills and no shop`.
- [ ] **step 12/15 (kiko:developer): demo seed.** S14. A sentence in `e2e/screenshot/fixtures/README.md` says which merchants stay steady and why the others move. Regenerate the two `.kiko` files the way the fixtures README states (`KIKO_REGEN_DEMO=1` on `generate-demo-kiko.test.ts`), not the frozen `kiko-demo-en-1.1.kiko`. Run `build-demo-snapshot` tests, `generate-demo-kiko.test.ts`, `screenshot-seed.test.ts`, step 11's file. The seed's net-worth, spread, "12 newest rows" and "3 newest" pins stay as they are; a failure there is reported, not edited. Commit `feat(demo): shops move within their month, bills stay steady`.
- [ ] **step 13/15 Review (kiko:reviewer).** Top question: can any code path produce a future date or a total? Second: does anything but `merchantNameOf` decide a merchant?
- [ ] **step 14/15 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-domain ("Spending-exclusion pipeline" gains: a new exclusion rule also goes in `recurringExcludedIds`; a new section for the detection rule points at `src/recurring/`), kiko-architecture (the new whole-ledger live read; route list). Report the sha or "no drift found".
- [ ] **step 15/15 Ready, device items held.** No device call here. Held for task 4/4 step 14/14, the real-ledger items for the look at task 2/4's tip if it is taken: a clean install shows the row and the empty text (uk too); on a release build on the user's real ledger, the report records that ledger's row count and the time from opening the list to the list showing, and the user names any stall (spec 10.3, fix path 10.4; the app shows no row count, so the coordinator settles with the user how to read it before this check); no false match the user objects to, listed by name for the coordinator; the demo file imported shows the five bills and no shop; iPad two panes and Duo fold. Label `1.4-recurring-task-1`.

---

## 1.4-recurring task 2/4: the series screen and its links

**Goal:** a list row opens one series; each past charge opens its form. **Needs:** task 1/4. **Base:** task 1/4 tip.

**Files (floor 18, tests included, counted from the lists below; mutable 6).**
- Create: `src/screens/settings/recurring-series/{recurring-series.screen.tsx,recurring-series.styles.ts,index.ts,recurring-series.screen.test.tsx}`, `src/navigation/settings-stack/recurring-series.navigator.test.tsx`
- Modify: `recurring-series-row/` (component, props, test) and `recurring-charges.screen.tsx` and its test (pressable), `transactions.repo.ts` plus a real SQLite pin, `settings.stack.tsx`, `types.d.ts`, `en.ts`, `uk.ts`, `help-topics.ts` and its test (`chargeCount` lands here, its first user)

**Acceptance:** every charge in `chargeIds` is one row, newest first, and opens `TransactionForm { transactionId }`; synced rows open read-only, manual rows editable (the form's own rule); back walks form, series, list; on two panes all three stay in the detail pane; a miss on `seriesId` follows S2.

- [x] **step 1/8 (kiko:qa): query pin. Done: 54c9d9226.** `listWithContextByIdsQuery`, real SQLite: returns exactly the ids, newest first, through `contextRowsQuery`'s shape; a builder that binds one `json_each` parameter and does not chunk, because `useLiveQuery` calls `toSQL()` on render (`src/db/use-live-query.ts`): more ids than `IN_CLAUSE_CHUNK_SIZE` all resolve, newest first; a deleted holding's rows absent. Red. Commit `test(transactions): context rows by id`.
- [x] **step 2/8 (kiko:developer): query. Done: 857c3c410.** Green, named file. Commit `feat(transactions): context rows by id`.
- [x] **step 3/8 (kiko:qa): screen pins. Done: feb580218.** `recurring-series.screen.test.tsx`: header with recurrence line, last-charge line and `chargeCount` at 1, 2, 5, 21 in both languages; rows newest first with the date in the trailing slot; a tap calls the pane opener with `TransactionForm` and that `transactionId`; a miss on `seriesId` with exactly one series of the same `merchantKey`, `currency` and `period` shows that series; with none, and with two (two monthly Apple series), `EmptyState` with the `listChanged*` text, no other series, and no word about the merchant; the earliest charge deleted while the series still lists keeps the series on screen; a charge deleted in a live fire drops from the list; loading gated on `isLoading`. List test gains: a tap opens `RecurringSeries` with all of S2's params. Commit `test(settings): recurring series screen`.
- [x] **step 4/8 (kiko:developer): screen. Done: ae762a86f.** S8. Shared `TransactionCard`, `transactionRowDescription`, `resolveCategoryDisplay`, `resolveCategoryColor`, `accountDisplayName` for the footer (an implicit account never by its raw name). Route `RecurringSeries: { seriesId: string; merchantKey: string; currency: Currency; period: RecurringPeriod; name: string }` (S2), title from `route.params.name`, set to the merchant's text, not translated. Help step 3, `chargeCount_*` and the `listChanged*` keys in both catalogues. Run named files. Commit `feat(settings): recurring series and its links`.
- [x] **step 5/8 (kiko:qa): navigator pins. Done: 3013cb2a3, 2c730239a.** `src/navigation/settings-stack/recurring-series.navigator.test.tsx` with `navigator-stack-probe`, the real `TransactionForm` in the real Settings stack (`renderStackInContainer` takes an optional `wrapper` argument): single mode: list to series to form, back twice; split mode: all three in the detail pane, Settings stays in the list pane, the menu row stays marked; a fold keeps the route and its params; the form opened this way for a manual row saves and returns (the path the Settings stack did not have). Green at once is acceptable when the pane rule already holds: show the run, and prove one pin by a temporary wrong route name. Commit `test(navigation): series links in the Settings stack`.
- [x] **step 6/8 Review (kiko:reviewer). Done: fix round 299a242c8, e4ccd2910.** Top question: can a link open the wrong transaction after a live refresh?
- [ ] **step 7/8 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-architecture "Pane navigation" only if a rule changed; route lists. Report the sha or "no drift found".
- [ ] **step 8/8 Ready, device items held.** No required device call here: the look at this tip is optional, the coordinator decides whether to offer it, and task 3/4 does not wait for it. Held for task 4/4 step 14/14, the required call, the real-ledger items for that look if it is taken: a tap on a charge opens the right transaction, synced read-only, manual editable; back order on phone, iPad, unfolded and folded Duo; the two-pane look; on a release build on the real ledger, the report records its row count and the time from opening a series (a second whole-ledger read plus detection, spec 10.3) to the series showing, and the user names any stall there or on Back (fix path spec 10.4). Label `1.4-recurring-task-2`.

---

## 1.4-recurring task 3/4: hide a false match

**Goal:** "Not a recurring charge", the "Hidden" section with "Show again", the stored choice map and its restore paths. **Needs:** task 2/4. **Base:** task 2/4 tip. The one migration of this track; task 4/4 reuses the column, and the amount lives in its JSON, so no column, type or text for a mark runs ahead here (S16).

**Files (floor 40 plus the generated `.sql` and snapshot, 42 in `git diff --stat 070ceef7f 2b35011b5`, counted from the lists below and the upgrade worlds; mutable 6, `schema.ts` among them).**
- Create: the migration `.sql` and its snapshot (generated by `npx drizzle-kit generate`), its test `drizzle/migrations/0067-add-recurring-merchant-choices.test.ts` by hand, `src/data-transfer/snapshot/restore-recurring-merchant-choices.test.ts`, `src/settings/recurring-merchant-choices.ts` (the `RecurringMerchantChoice` type and `recurringMerchantChoicesOf`)
- Modify: `src/db/schema.ts`, `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js`, `src/settings/settings.repo.ts` and its test, `use-recurring-series.ts` and its test, both screens and their tests, `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts` and its test, `src/db/settings-columns.test.ts` (`TAKEN_FROM_FILE_ON_RESTORE`), `src/data-transfer/crypto/envelope.test.ts` (`VERSION_DECISIONS` note, `migrationCount` plus one, **no bump**), `src/data-transfer/import-data.back-compat.test.ts` (`EARLIER_BUILD_SETTINGS_COLUMNS`), `src/test-support/real-sqlite.ts` and `real-sqlite.test.ts` (under `src/test-support/`), `src/settings/index.ts` (exports the type), both screens' `.styles.ts`, `src/data-transfer/snapshot/restore-travel-category.two-path.test.ts` (its settings-key test lists exactly `MARK_COLUMN` and `'recurring_merchant_choices'`), `src/recurring/detection/detection.test.ts`, `src/navigation/settings-stack/recurring-series.navigator.test.tsx`, `e2e/screenshot/fixtures/build-demo-snapshot.ts` and the two demo `.kiko` files, the other suites below (`import-data.mcc-backfill`, `import-data.travel-category`, and the `restore-*.two-path` suites of the world row)

**Upgrade worlds.** No owed state: NULL means nothing hidden, no one-time step, so no app-open or restore mirror. Asked per harness-workflow, "An acceptance pin's seed or world", which seeds are older-build worlds:

| Seed | World | Effect | Re-seed, by its own line |
|---|---|---|---|
| Suites using `applyMigrationsThrough`, 11 on the floor as grepped at 35861c22b: nine `restore-*.two-path.test.ts`, `transactions.repo.remove-cascade.test.ts`, `real-sqlite.test.ts` (`restore-import-time-rezone.two-path.test.ts` does not use it; re-grep) | Database below the new migration, read through today's schema | `no such column` if it reads `settings` | `addRecurringMerchantChoicesColumn(source)` beside the existing `add...Column` line, per failing file, never inside a shared helper |
| `import-data.back-compat.test.ts` | Older-build file through `importData` | The list of columns an earlier build lacked | The key in `EARLIER_BUILD_SETTINGS_COLUMNS` |
| `src/data-transfer/snapshot/restore-travel-category.two-path.test.ts` | A file this build wrote, into release 1.3 | A new settings column is a failing entry in its exact list of columns release 1.3 drops | The column joins that list (`'recurring_merchant_choices'` after `MARK_COLUMN`), and `addRecurringMerchantChoicesColumn(target)` in its release-1.3 world |
| `e2e/screenshot/fixtures/build-demo-snapshot.ts` | Current demo | The typed settings row spells its columns (`reminderOfferDismissals: null`), so it needs the key | `recurringMerchantChoices: null` on its own line; regenerate the demo `.kiko` files if the developer measures that they change |

After those, other suites stay green unchanged. A failure elsewhere is reported, never fixed by editing an expectation.

**Acceptance:** hide and show round-trip; a hidden merchant's series leave the list and the merchant shows under "Hidden", also with no rows; nothing on a transaction changes; the paths of spec 11 are pins.

- [x] **step 1/10 (kiko:qa): repo pins. Done: 1b3f1e54a, ceab95d00.** `settings.repo.test.ts`, real SQLite: `hideRecurringMerchant` stores `{ name, hidden: true }`; a second keeps the first; hide twice is one entry, last name; `showRecurringMerchantAgain(key)` removes one, and an absent key is a no-op with no write; the writes touch no `transactions` row (count and checksum); a malformed stored value reads as empty and the next hide replaces it; a bad entry beside a good one is dropped alone, a non-string `name` or a `hidden` other than `true` being bad here. Keys that are user text, through a reload: with nothing stored, `recurringMerchantChoicesOf(...).has('constructor')` is false; a hide on `constructor` and on `__proto__`, each beside a plain key, reads back as that entry, and the next write keeps all three. Commit `test(settings): the recurring merchant choices`.
- [x] **step 2/10 (kiko:developer): column and repo. Done: aacddd118.** S12, S16. `recurringMerchantChoices: text('recurring_merchant_choices', { mode: 'json' }).$type<Record<string, RecurringMerchantChoice>>()`; a schema comment says what it holds and why NULL. Migration by `npx drizzle-kit generate`, its test. Read-modify-write in one `write()`, as `recordReminderOfferDismissal`; a parser (`recurringMerchantChoicesOf`) for a non-object and a bad entry, which reads `name` and `hidden` and nothing else (S16), returning a `Map` from `Object.entries`; a write stores `Object.fromEntries(map)`, never a bare index or assignment on the stored object (spec 8.1). `addRecurringMerchantChoicesColumn` in `real-sqlite.ts`. Run the upgrade-world files measured above. Commit `feat(settings): store hidden recurring merchants`.
- [x] **step 3/10 (kiko:qa): restore pins. Done: 59f3d8a3e.** `restore-recurring-merchant-choices.test.ts`, as `restore-dismissed-tips.test.ts`: a round trip keeps the list; a file with no key restores with none; a file's list replaces the live one (taken from the file, not `KEPT_FROM_LIVE_ON_RESTORE`); a malformed value in a file restores and reads as nothing hidden; a `__proto__` key survives the round trip. `settings-columns.test.ts` and the `VERSION_DECISIONS` note in this step. Green at once is acceptable where the restore already does it by column: show the run, and prove one pin by a temporary wrong column. Commit `test(restore): the recurring merchant choices`.
- [x] **step 4/10 (kiko:qa): UI pins. Done: d26c1c49d.** Series screen: the button shows, a tap calls `hideRecurringMerchant` with `merchantKey` and `name`, a rejected write shows the save alert and stays, a second tap during the write is blocked (`useSubmitOnce`); between the hide write's live fire and `goBack` the screen still shows its series, never the `listChanged*` text. List: hidden series leave, the "Hidden" section lists each name in key order, including a hidden name with no rows; "Show again" calls `showRecurringMerchantAgain` with the key; a merchant named `constructor` with no choice stays listed; two series under one key both go; with only hidden merchants the empty state and the section both show. Hook: a `settings` write runs no detection and no new ledger read. Commit `test(settings): hide and show a recurring merchant`.
- [x] **step 5/10 (kiko:developer): UI. Done: ddfec0371.** S9, S10. The hook gains `choices`; the list screen filters by `merchantKey` after detection, testing `.hidden === true` and never `.has` (S13, S16), so a hide runs no detection and the series screen keeps its series. After a hide the series screen closes back to the list through `navigation.goBack()`. Remaining keys of spec 13; `hiddenHeading` in `title-keys.ts`; help step 4. Failure log fixed text. Run named files, `src/i18n/locales`, `src/help`. Commit `feat(settings): hide a false match`.
- [x] **step 6/10 (kiko:qa): the sample-key pin. Done: 0a9988582.** The sample table of task 1/4 step 3 gains a comment: these keys are stored in `settings.recurringMerchantChoices`; a change of `merchantNameOf` shows here, with spec 8's consequence. Confirm it fails when a sample's key is altered. No commit without the proof shown. Commit `test(recurring): stored keys follow the name function`.
- [x] **step 7/10 Migration review (kiko:reviewer). Done: review APPROVE.** Required before BATCH READY, on the migration, schema, restore pins and `VERSION_DECISIONS` note. Top question: can any older-build path lose or change a row? Also read `git show release-1.3:src/data-transfer/import-data.ts` and the restore on that ref to confirm the key is dropped. No index, so no index EXPLAIN test.
- [x] **step 8/10 Review (kiko:reviewer). Done: fix rounds 933d8534e, d98c65ce4, 2b35011b5.** The whole diff. Top question: does anything other than the settings row change on hide?
- [ ] **step 9/10 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-architecture's data-transfer section, kiko-domain. Add to `docs/harness` only if a check moved. Report the sha or "no drift found".
- [ ] **step 10/10 Ready, device items held.** No device call here. Held for task 4/4 step 14/14: hide, the row goes, "Hidden" names it, show brings it back; export then restore keeps the list; both languages. Note the renumber need in the report if another migration reached `next` first (S12). Label `1.4-recurring-task-3`.

---

## 1.4-recurring task 4/4: mark as recurring

**Goal:** a "Mark as recurring" field on a stored charge's transaction form; a marked series on its amount chain on the list and series screens; "Remove mark"; "Marked, No Charges". **Needs:** task 3/4 (the store, the series screen's button). **Base:** task 3/4 tip. No migration, no column: the entry gains `marks`, the parser its arm, and nothing else in storage.

**Files (floor 41, tests included, counted from the lists below: 11 created, 26 modified, 4 by measure; mutable 12; was 38 and 11; the developer measures).**
- Create: `src/recurring/recurring-periods/{recurring-periods.ts,index.ts}` (exports `RECURRING_PERIODS`, `periodRankOf` and `compareMarks`; the types are only imported); `src/test-support/{marked-series-world.ts,marked-series-worlds.ts,marked-series-chain-worlds.ts,marked-series-hook-result.ts,recurring-mark-live-queries.ts,sqlite-live-query.ts,recurring-sqlite-world.ts}`; `src/navigation/settings-stack/recurring-series.marks.navigator.test.tsx`; `src/recurring/marked-series/{marked-series.ts,index.ts,marked-series.test.ts}`; `src/recurring/use-row-mark/{use-row-mark.ts,index.ts,use-row-mark.test.tsx}`; `src/screens/forms/transaction-form/recurring-mark-field/{recurring-mark-field.component.tsx,recurring-mark-field.props.d.ts,index.ts,recurring-mark-field.component.test.tsx}`; `src/screens/forms/transaction-form/transaction-form.recurring-mark.test.tsx`
- Modify: `src/recurring/detection/{detection.ts,detection.types.d.ts,detection.test.ts}`, `src/recurring/eligibility/{eligibility.ts,eligibility.test.ts}`, `src/recurring/recurrence-text/{recurrence-text.ts,recurrence-text.test.ts}`, `use-recurring-series.ts` and its test, `src/settings/settings.repo.ts` and its test, `restore-recurring-merchant-choices.test.ts`, both Settings screens and their tests, `recurring-series-row.component.test.tsx`, `src/navigation/settings-stack/recurring-series.navigator.test.tsx`, `transaction-form.screen.tsx`, `src/i18n/locales/{en,uk,title-keys}.ts`, `help-topics.ts` and its test, `src/navigation/types/types.d.ts` (the route's `markedAmountMinorUnits`), `__tests__/property-sweep-sites.test.ts` (step 1's site)
- Modify, by measure: `transaction-form.screen.test.tsx`, `transaction-form.exchange-funding.test.tsx`, `transaction-form.set-category.test.tsx`, `src/test-support/transaction-form-data-layer.ts`: a suite that opens a stored debit gets the settings repo mock on its own line. A navigator suite that does so too is added to this list.

**Existing suites.** No owed state and no seed of an older build changes, since task 3/4 settled the column. `detection.test.ts`'s matrix, the demo pin and the five-card pins stay unedited. A form suite gains only its repo mocks, the `settings` one and a `recurringLedgerQuery` line (in `transaction-form.templates.test.tsx` and `src/test-support/transaction-form-data-layer.ts` too), and with no mark stored the field adds no ledger read there. The list and series screen suites (`recurring-charges.screen.test.tsx`, `recurring-series.screen.test.tsx`) mock the hook with `() => ({ markedSeries: [], withoutCharges: [], ...mockResult })`. The older pin "reads no settings row" in `transaction-form.screen.test.tsx` is narrowed into three pins, because spec 9.6 requires the field's one-column read. `marks` on the series and `markedAmountMinorUnits` on the route are optional and absent on a detected series, so typed series fixtures, task 2/4's route fixtures and its list test, "a tap opens `RecurringSeries` with all of S2's params", stay unedited (detection's output does not change, spec 9.5). One named edit: the hook test of task 1/4 step 6/15 moves its spy from `detectRecurringSeries` to `seriesOfGroups`, with its counts unchanged ("one detection per fire", none on a same-day return, "next day runs one"), since the hook calls the two parts and no longer the composed function (step 8/14); both are exports the hook imports from the detection module, so the module mock sees them. Any other edited expectation is reported, not made.

**Acceptance:** every row of "The marked matrix" is a pin; the field shows on a stored charge, in the same state on every path to the form (Home, Holding Detail, a series link; the Statistics stack reaches it only through Home) and on a synced row, and on no create, duplicate, template, credit or excluded row; on the list and series screens a mark runs no detection and no new ledger read, and on the form only a name marked in that currency adds the ledger read; hide and marks are one entry per key, and neither touches the other; no row is in two shown series; a stored amount never reads another currency's group and shows on no line; no output date has a local day later than today, in a marked world too.

Order: the text steps come first, because the commit that adds `{ kind: 'marked' }` must hold `recurrenceLine`'s `.exhaustive()` arm and its keys, or the pre-commit `tsc` fails. Each qa commit reaches a missing export, kind, key or route param by a runtime lookup or a cast, so `tsc` passes on it (Global Constraints). Read for `tsc`: step 2 holds both widenings, every reader of `RecurringPeriod` at that tip included (`.exhaustive()` arms and typed fixtures over it go in that commit); step 4 adds the types only its own code reads; step 6's `hidden?: true` compiles under task 3/4's `.hidden === true` readers; steps 8 and 10 only add readers.

- [x] **step 1/14 (kiko:qa): text pins. Done: 44ceee767, b199d3655, 6754c9d36, 0a54f7e8f, correction 32ae00597.** `recurrence-text.test.ts`, per language: each `marked.*`; a marked `onDay` reads as any series; `markedEmptyMessage` names no merchant and holds no digit, in both languages; a marked `lastChargeLine` holds the last real charge. Commit `test(recurring): the marked text`.
- [x] **step 2/14 (kiko:developer): text and catalogue. Done: 44ceee767, b199d3655, 6754c9d36, 0a54f7e8f, correction 32ae00597.** `{ kind: 'marked' }` on `Recurrence`, the five-member `RecurringPeriod` and the three-member `DetectedPeriod` (S16), with `recurrenceLine`'s arm in the same commit: `detection.ts`'s period records and `stoppedCutoff` narrow to `DetectedPeriod` until step 4, and a `none` under a mark's own period reads its `marked.*` line, so the match stays total. Spec 13's new keys through kiko-translator (any changed wording goes to spec 13 and the pins here); `markedEmptyHeading` in `title-keys.ts`; `emptyMessage`'s added sentence. Run `npx jest src/recurring/recurrence-text src/recurring/detection src/i18n/locales --maxWorkers=2`. Commit `feat(i18n): mark as recurring copy`.
- [x] **step 3/14 (kiko:qa): marked pins. Done: 44ceee767, b199d3655, 6754c9d36, 0a54f7e8f, correction 32ae00597.** `marked-series.test.ts`: `it.each` over both tables of "The marked matrix", each row also run with no entry. Property, through `sweep`, with the site in `property-sweep-sites.test.ts`: random ledgers and marks with rows on every side of today: no output local day after today; shuffling is deep-equal, of the rows and of a mark list; no charge id is in two shown series, marked and detected together; a detected series under a marked key shows only when it shares no row with a marked series, and with no marks every detected series shows; a marked series' charges all share its currency, and two consecutive amounts in it never differ by more than 1.25 unless a stored amount lies between; with one mark and a charge at its amount, the series equals that charge's piece of `amountPiecesOf` over the charges alone; a fold never drops a real charge. `amountPiecesOf` over random amounts, against detection's step 3 worlds, unchanged. `eligibility.test.ts`: `isOfferedForMark` for each per-row rule of spec 4 with a positive twin, and it answers the same as `recurringExcludedIds` plus `isRecurringCandidate` for every row but a matched pair and a funded debit, which it cannot see (a sweep; the form holds the funded case by its caption). Red, named files. Commit `test(recurring): marked series`.
- [x] **step 4/14 (kiko:developer): marked series. Done: 44ceee767, b199d3655, 6754c9d36, 0a54f7e8f, correction 32ae00597.** S16, S17, S18, spec 6, 7, 8.2. `RecurringMark`, `marks?` and `markedSpan?` land here; `RECURRING_PERIODS`, `periodRankOf` and `compareMarks` land in the leaf `src/recurring/recurring-periods/recurring-periods.ts`. `isOfferedForMark` too. `amountPiecesOf` is spec 5.3 step 3's cut moved, not copied; `markedSeriesOf` reads only a mark's own `[key, currency]` group by `S6`'s key, adds the stored amounts, and keeps each piece holding one. No day test decides which charges join. The line follows spec 6: section 5.2's test on the chain's charges only, with the marked period's record and the amount test dropped, then the section 6 table; otherwise, and always for every 3 and every 6 months, `{ kind: 'marked' }`. Stopped and last charge on the chain, through `stoppedCutoff` with the two new rows of spec 7; no 24-month leave. `detectedBesideMarked` and `markedChainOfAmount` (S18). Reuse `addMonths` for every step. Green, named files. Commit `feat(recurring): marked series`.
- [x] **step 5/14 (kiko:qa): repo pins. Done: 2a9d08d18.** `settings.repo.test.ts`, real SQLite: `markRecurringCharge` stores `{ name, marks: [{ currency, amountMinorUnits, period }] }`; marking a hidden key keeps `hidden: true` beside the mark, hiding a marked key keeps its marks beside `hidden: true`, and one entry stays at every point; a mark at another amount or currency adds beside the first; the same currency and amount takes the new period; `setRecurringChainPeriod` rewrites the period of exactly those marks, every stored amount unmoved, keeps the hide, and writes nothing on an entry holding none of them; `removeRecurringMarks` clears only those marks, keeps the hide, and writes nothing on an absent entry, a hide-only entry or marks the entry does not hold; removing the last mark of a marks-only entry leaves no entry, and of a hidden entry leaves `{ name, hidden: true }`; `showRecurringMerchantAgain` on an entry with both clears the hide and keeps the marks, on a hide-only entry leaves no entry, and on a marks-only entry writes nothing; hidden, marked, removed, then shown leaves no entry; no `transactions` row changes (count and checksum). Keys that are user text, through a reload: one charge under `__proto__`, marked monthly and read through `recurringMerchantChoicesOf` into `markedSeriesOf`, gives one marked series x1, and with no entry none; a `constructor` group with no entry gives no marked series beside a positive twin, so a plain-object index fails. Parser, each dropped alone with a good mark beside it: an unknown period, an unknown currency, an amount missing, a string, a fraction, zero, negative, or past `Number.MAX_SAFE_INTEGER`; `marks` missing, not an array or empty drops the entry unless it holds `hidden: true`, and an entry whose marks are all bad keeps its hide. Two marks of one currency and amount read as one, the earlier period in `RECURRING_PERIODS`; `marks` read sorted for any stored order (S18). Restore test: a file's marks come back with their currency, amount and period, beside a hide; a bad mark in a file restores and drops that mark. Commit `test(settings): recurring marks`.
- [x] **step 6/14 (kiko:developer): repo. Done: 0be0bebc1, 6110afcd5.** S16, S18. Same `write()` shape. The parser's `marks` arm checks each mark: `isCurrency` (`@kiko/currency/currency`), a known period, `Number.isSafeInteger` and above zero. Storage gains nothing else. Green, named files. Commit `feat(settings): store a recurring mark`.
- [x] **step 7/14 (kiko:qa): list and series pins. Done: d2de9646a.** List: a marked series sits in active or stopped by its dates; a detected series sharing a row is gone while marked and returns when the mark goes; marked Apple 99 lists beside its detected 399; a hide on that 399 leaves one "Hidden" line, no detected series and the marked 99, and "Show again" returns the 399 beside it; hidden, then marked shows the marked series and the "Hidden" line; then removed shows the "Hidden" line and no series; "Marked, No Charges" lists each piece with `markedEmptyMessage`, its "Marked:" line, no amount, and "Remove mark", in order of key, currency and lowest stored amount; with only those the empty state and the section both show. Series screen: a detected series offers only "Not a recurring charge", also beside a marked one; a marked one offers only "Remove mark", which calls `removeRecurringMarks` with the key and that series' `marks`, stays on a rejected write with the save alert, blocks a second tap, and between the write's live fire and `goBack` keeps its series, never the neutral text. Lookup, spec 9.3 and every route row of "Marked flows": two marked series under one key, a route with `markedAmountMinorUnits` finds the one whose `markedSpan` holds that amount, also when no stored amount equals it; a route without it finds the marked series holding its `seriesId`, and never a detected one that left. On a route holding it, with its `seriesId` set to an id a detected series holds, a miss gives the neutral text and no detected series: Apple 99 marked beside detected 399, marked yearly over a detected monthly, marked monthly over one detected monthly, and a marks-only 99 x2 beside a detected 399 x10, each removed. On a route without it, `seriesId` still resolves among the detected series left, counting only with the route's `merchantKey` and `currency`, then the fallback. The list's tap passes `markedAmountMinorUnits`, the lowest of `marks`, on a marked series and no such key on a detected one (`recurring-series-row`'s test holds its side). A marked series' row shows its line and the last real charge's amount. Hook: the edit named under "Existing suites" lands here; a mark write runs no detection and no new ledger read in this hook (spies on `chargeGroupsOf` and on `seriesOfGroups`, each at no new call, so the rule moved into the marked memo fails; and the `['transactions']` read's call count). Commit `test(settings): marked series on both screens`.
- [x] **step 8/14 (kiko:developer): hook and screens. Done: 1bd9da1bc.** S2 (`markedAmountMinorUnits` on the route, set by the list's tap), S13, S17: the hook calls `chargeGroupsOf` and `seriesOfGroups`, never `detectRecurringSeries`; the first memo holds groups and `seriesOfGroups`, and a second holds `markedSeriesOf` and `detectedBesideMarked` on groups, the detected series, marked entries and the local day. The first memo keeps the `isReady` gate (`useDataReady` over every read). Failure log fixed text. Run named files. Commit `feat(settings): marked series on both screens`.
- [x] **step 9/14 (kiko:qa): field pins. Done: bf3e2e63b.** `recurring-mark-field.component.test.tsx`: labels, the five periods plus "Not marked" in order, the value from `useRowMark`, a pick on a row in no marked chain calls `markRecurringCharge` with the row's key, its spelling, and a mark of the row's absolute stored amount, its holding's currency and the period; a pick inside a chain calls `setRecurringChainPeriod` with the key, the chain's marks and the period; "Not marked" on a marked chain calls `removeRecurringMarks` with those marks; "Not marked" on a row of another chain calls no write; a row of 144 with 100 stored reads the period, and a pick there rewrites the 100's period with no new mark; a row of 399 beside a stored 99 reads "Not marked", and a pick adds beside the 99; while `useRowMark` is not ready and during a pick's write, `disabled`, `selected` null and no "Not marked" text, with the release as the twin; a USD row's mark stores USD, from `existing.holdingId`'s holding, also with the draft's holding changed and never the screen's `currency`; a hidden key's field reads "Not marked" and keeps its hide when that row is tapped (the repo pin of step 5), a row whose key is `constructor` with no choice reads "Not marked", a rejected write shows the save alert. `use-row-mark.test.tsx`: no ledger read with no entry, on a hide-only entry, on an entry marked only in another currency, or on a row not offered (a count over the mock's calls, each with a marked twin that reads), and no holdings or accounts read at all (props). `isReady` false: while the settings read loads; right after a first pick, with the entry landed and the ledger read still `[]`; on a rejected settings read and on a rejected ledger read, each with no chain and released by a later good fire. `isReady` true on a ledger read turned off after its rejection, by removing the last mark: its kept `error` does not count. `useRowMark` runs `chargeGroupsOf` once per fire and never `seriesOfGroups`; a fold cannot change the chain, since it keeps at least one row per amount and `markedChainOfAmount` reads only the amounts (`useRowMark` has no `foldTwins` call), so no folded-twin pin. `transaction-form.recurring-mark.test.tsx` through `transaction-form-data-layer`, with the same world over both paths, from one `PATHS` list (a `transactionId` route as Home opens it, and as a series link opens it): shown on a manual debit; shown and enabled on a synced debit whose amount stays locked and whose header has no Save; a pick there writes `settings` and no `transactions` row, and leaves Save and the draft as they were; on a manual row with an unsaved description or amount, the key and the mark's amount come from the stored row. Not shown, each with a positive twin: `holdingId`, `duplicateOfTransactionId`, `templateId`, `editTemplateId`, `newTemplate` and global add entries; a credit; a blank name; a row with a funding caption; while converting; each structural rule. The accepted gap (spec 8.2): a funded debit shows the field until the ledger read lands, then not. With no mark under the row's key and currency, the form's mount reads no new `['transactions']` query (a count over the mock's calls). Commit `test(forms): mark as recurring on a transaction`.
- [x] **step 10/14 (kiko:developer): field. Done: d92ff6a79.** S15, spec 9.6. `SelectField`, `alertOnCatch`, `useSubmitOnce` where the pick writes; `merchantNameOf` and `merchantSpellingOf` on `existing.description`, the amount from `existing.amountMinorUnits`; `useRowMark` with the third argument of `useLiveQuery` for its gated ledger read, and the ready rule of spec 9.6 over `isLoading` and `error`; `isOfferedForMark`; `exchangeFundingCaptionKey === undefined` from the screen, with no loading gate: that hook has no settled state, and the gap is accepted (spec 8.2). One import and one element in `transaction-form.screen.tsx`, gated on `existing`, `!converting` and no funding caption, through `markableRowOf` (`src/screens/forms/transaction-form/recurring-mark-field/recurring-mark-field.ts:21`, used at `transaction-form.screen.tsx:1604`), passing the screen's `holdings` and `accounts` as props. The repo mock line in each suite measured, never in a shared block that hides it. Help step 5 in both catalogues. Run `npx jest src/screens/forms/transaction-form src/help src/i18n/locales --maxWorkers=2`, output in a file. Commit `feat(forms): mark as recurring on a transaction`.
- [x] **step 11/14 (kiko:qa): navigator pins. Done: 649365811, b57f0495a.** `src/navigation/settings-stack/recurring-series.navigator.test.tsx`, and `src/navigation/settings-stack/recurring-series.marks.navigator.test.tsx` for the flows on the real hook, Home and a series link: list to detected series to form, set a mark, Back shows that key's marked series; a detected x8 with a 130 row marked, Back shows the neutral text; list to marked series to form, "Not marked", Back shows the neutral text, for one detected series, for Apple 99 marked beside detected 399, and for a marks-only 99 x2 beside a detected 399 x10; 99 x10, one 119, a detected 399 x10, marked at 99: list to marked series to the 119 row's form, a yearly pick, Back shows the marked x11, yearly, never the 399; single and split mode; a fold keeps the route. Home to form: the field reads the same state. Prove one by a temporary wrong key, if green at once. Commit `test(navigation): a mark set through a link`.
- [x] **step 12/14 Review (kiko:reviewer). Done: review, fix round 16f9b413e, 606283962, 86851d0f7, d92363a1c.** Top question: can a mark make any row count, or any date show, that section 4 and the ruling leave out? Second: can a row be in two shown series, or an amount compare across currencies? Third: do the two form paths differ anywhere? No migration in this set.
- [x] **step 13/14 Drift and Scribe (kiko:retrospect, kiko:scribe). Done: the `docs(recurring): task 4/4 drift` commit.** Check kiko-domain's recurring section (a mark, its periods, its amount chain and currency, the accepted false stop, one choice map), kiko-architecture's data-transfer section (a future scale change of a currency also rewrites this map, spec 11). Report the sha or "no drift found".
- [ ] **step 14/14 Device and Ready: fundamentals done.** The required device call for this feature. Device confirm by the user, both languages: the items held from tasks 1/4 to 3/4 (real-ledger items already read at an optional look at task 2/4's tip are not repeated, unless a spec 10.4 fix landed), and the field's look and place on a synced and a manual row; mark a missed charge, the list shows it with the expected line; change the period; mark a second price under one name; a row of the other chain reads "Not marked"; the report records the time from opening a transaction under a marked name to its field enabling (spec 10.3); remove it from the form and from the series; hide then mark: the marked series shows and the "Hidden" line stays until "Show again"; hide a detected series beside a mark: the mark stays; export then restore keeps a mark; the same field through a series link; iPad two panes and Duo fold. Label `1.4-recurring-task-4`.

---

## 1.4-recurring visual round 1

**Spec:** section 17 (rules, reads, conversion, texts, the rulings on P1 to P3 in 17.9). **Branch:** `1.4-recurring-visual-1`,
base `next` 14f997ad7. Three change sets, stacked: task 1/3, task 2/3 on its tip, and task 3/3 on task 2/3's tip. They were
"task 1/2" and "task 2/2" before item 13 joined; their steps and verify labels keep their numbers. The transaction-form set,
task 2/3, can be merged in its own order against `1.4-bybit`, which edits `transaction-form.screen.tsx` and
`transaction-form.screen.test.tsx` (`git diff --stat next...1.4-bybit`). Every count is a floor; the developer measures. Every
code fact names a symbol: re-grep each on the actual base. Rulings (USER 2026-11-05): P1 "A: Default category" (no
"Uncategorized" group), P2 "A: In their group", P3 "B: Pair with Value Out", and "Texts lgtm" for
`.superpowers/sdd/1.4-recurring/texts-visual-1.md`, so spec 17.8's rows may be copied. Item 13: "A: Everywhere" and "Texts
lgtm" for its three keys (spec 9.6 "The detected period", 8.2, 13), in task 3/3.

**Run-log gaps:** these sets close none and leave all open; none names the recurring screens. Nearest, left open:
`20261018T0952-kiko-duo-adaptive/1` (the Duo outer window shape, read for item 14's width) and
`20261103T2049-kiko-1-4-light-scheme-2/1` (dark look owed on a device; this round's device call is on the same build).

**Existing suites.** No owed state, no column, no migration, no seed: no 1.2-upgrade world is touched. Not "unchanged": the
named edits of each step below are the only edited expectations; any other is reported, not made. Each qa pin is shown red on
the base before its commit; a pin green on the base is a guard and is shown failing by a temporary mutant (lessons, candidate G).

**Checks for every step:** the fast tier on write; `npx jest <named files> --maxWorkers=2` with output in a file; `make
jest-affected BASE=<set base>` where it does not exit 3 (`en.ts`/`uk.ts` make it 3: run the named files and say so). No agent
runs `make verify`, `check:all` or full jest. At the end of each set the coordinator queues `bash scripts/job-queue.sh verify
<worktree> 1.4-recurring-visual-1-task-N` and reruns until green. Mutation gates are paused by the user; if lifted, one gate per
set, `KIKO_MUTATION_BASE` = that set's own base (task 2/3's base is task 1/3's tip, task 3/3's is task 2/3's), never one run
over the round.

### 1.4-recurring-visual-1 task 1/3: the recurring screens (items 1 to 10)

**Files (floor 34, tests included; mutable floor 6: `recurring-groups.ts`, `use-recurring-groups.ts`,
`recurring-group-heading.component.tsx`, `recurring-charges.screen.tsx`, `recurring-series-row.component.tsx`,
`recurring-series.screen.tsx`).**
- Create: `src/recurring/recurring-groups/{recurring-groups.ts,index.ts,recurring-groups.test.ts}`;
  `src/recurring/use-recurring-groups/{use-recurring-groups.ts,index.ts,use-recurring-groups.test.tsx}`;
  `src/screens/settings/recurring-charges/recurring-group-heading/{recurring-group-heading.component.tsx,recurring-group-heading.props.d.ts,recurring-group-heading.styles.ts,index.ts,recurring-group-heading.component.test.tsx}`;
  `src/screens/settings/recurring-charges/recurring-charges.screen.groups.test.tsx`;
  `src/screens/settings/recurring-series/recurring-series.screen.footer.test.tsx`.
- Modify: `src/recurring/recurrence-text/recurrence-text.test.ts`; `src/i18n/locales/{en,uk,title-keys}.ts`;
  `recurring-charges.screen.tsx`, `recurring-charges.styles.ts`; `recurring-series-row/{recurring-series-row.component.tsx,recurring-series-row.styles.ts,recurring-series-row.component.test.tsx}`;
  `recurring-series.screen.tsx`, `recurring-series.styles.ts`, `recurring-series.screen.test.tsx`;
  `recurring-charges.screen.test.tsx`, `recurring-charges.screen.marked.test.tsx`;
  `src/transactions/repo/transactions.repo.context-by-ids.test.ts`; `__tests__/property-sweep-sites.test.ts` if step 3 adds a sweep.
- Modify, by measure (each gains a `useRecurringGroups` mock line or its repo mocks, nothing else):
  `recurring-charges.screen.marked-flows.test.tsx`, `recurring-series.screen.marked.test.tsx`,
  `src/navigation/settings-stack/recurring-series.navigator.test.tsx`, `src/navigation/settings-stack/recurring-series.marks.navigator.test.tsx`.

- [ ] **step 1/9 (kiko:qa): text pins.** `recurrence-text.test.ts`, per language, every recurrence kind reads spec 17.8's
  text (red on the base: it reads "Charged ..." / «Списувалося ...»); the "Marked:" and "Last charge" lines unchanged (guards).
  `paidSoFar` resolves in both catalogues (red: key absent). Commit `test(recurring): the recurrence text without "Charged"`.
- [ ] **step 2/9 (kiko:developer): catalogue.** "Texts lgtm" is relayed (2026-11-05). Spec 17.8's rows in `en.ts` and `uk.ts` together;
  `paidSoFar` is a label (sentence case, no full stop, not a title key). Named edits in the same commit: the old texts in
  `recurring-series-row.component.test.tsx` and `recurring-series.screen.test.tsx` (grep `Charged ` and «Списувалося» in `src`
  and `docs/superpowers/specs` on the base). `stoppedHeading` stays until step 6. Run `npx jest src/recurring/recurrence-text
  src/i18n/locales src/screens/settings/recurring-charges src/screens/settings/recurring-series --maxWorkers=2`. Commit
  `feat(i18n): recurrence lines without "Charged"`.
- [ ] **step 3/9 (kiko:qa): groups and totals pins.** Red by a runtime lookup of the missing modules (Global Constraints).
  `recurring-groups.test.ts` over `recurringGroupsOf({ shown, rows, categories, defaultCategoryKey, baseCurrency, rateTable })`
  and `paidSoFarOf(series, rows)`: the category is the newest charge's (two charges, two categories, the newest wins; a
  newest row missing from `rows` takes the next id found); an unknown slug folds to the default (`resolveCategoryKey`); P1:
  a series whose newest charge has a null category, one with an empty category and one with none of its rows in `rows` all
  sit in the default category's group, at the default's place in `categories` order, beside a series stored under the
  default key itself (one group, one total, its heading the default's title and icon; red on a mutant that keys null apart),
  and no group carries an "Uncategorized" title or key; with the default key absent from `categories`, its group goes last
  with `neutralCategory()`'s display; groups in `categories` order, not by total or name (a world where the two disagree); a group holds only shown series (a hidden
  detected series beside it adds nothing); inside a group active by `newestChargeFirst`, then stopped by the same order;
  a series sum is `-amountMinorUnits` over its rows in its currency, a row of another currency skipped; a UAH and a USD series
  in one group: the USD sum goes through `convert` at `buildRateTable(rates)` once per series, the group total is the `Money`
  sum of its series in the base currency, the total of all equals the sum of the group totals (a rounding world where
  per-row conversion would differ by one minor unit, so per-row fails); a currency `canConvert` rejects is left out of the
  totals and its series still listed; with no shown series no total. `paidSoFarOf`: the sum of the listed rows in the
  series currency, no rate table taken (its signature). `use-recurring-groups.test.tsx` on a mocked `useLiveQuery` that
  records each call's sql and params: the four reads of spec 17.5 with `paused` from `useIsScreenVisible` and no `cached`;
  the id list is unique and sorted for any series order (a mutant without the sort fails); a hide (choices change, same
  series ids) adds no new by-ids key, and a mark that changes `markedSeries` adds exactly one; `isLoading` true until all four
  settle, one at a time (lessons, fix round 1/4). `transactions.repo.context-by-ids.test.ts`, real SQLite: EXPLAIN QUERY PLAN
  of `listWithContextByIdsQuery` reads `transactions` by its primary key, never `SCAN transactions` (a guard, green on the
  base: show it red with a temporary `where` that drops the id test). Commit `test(recurring): category groups and totals`.
- [ ] **step 4/9 (kiko:developer): groups and the hook.** Spec 17.2, 17.4, 17.5. `recurringGroupsOf` and `paidSoFarOf` in
  `src/recurring/recurring-groups/`, pure, importing `resolveCategoryKey`, `resolveCategoryDisplay`, `neutralCategory`
  (`@kiko/categories/category-display`), `resolveCategoryColor` (`@kiko/statistics/category-breakdown`), `canConvert`
  (`@kiko/rates/net-worth-view`), `convert` (`@kiko/rates/conversion`), `Money`; nothing from `@kiko/settings` (the
  `recurring-periods` leaf rule stays). `useRecurringGroups(shown, all)` in `src/recurring/use-recurring-groups/`: the four reads,
  `buildRateTable` in a `useMemo` on the rates rows, the id list memoized on its joined string, the grouping memo gated on
  `isReady` (`useDataReady`). Run the named files and `src/recurring`. Commit `feat(recurring): category groups and totals`.
- [ ] **step 5/9 (kiko:qa): screen pins.** `recurring-charges.screen.groups.test.tsx` (mocks both hooks): item order of spec
  17.2 (total row, groups in the given order, "Marked, No Charges", "Hidden"); each group heading shows the category title,
  its icon tile and its total under the testIDs of 17.2; a series with a null category shows under the default category's
  heading and no "Uncategorized" / «Без категорії» text renders (P1); a `Divider` before every group and section after the first item,
  "Hidden" included (item 10, red: no divider today); no total in "Marked, No Charges" or "Hidden"; no
  `recurring-charges-heading-stopped` and a stopped series inside its group after the active ones; the list shows
  `LoadingState` while either hook loads; the empty state and no total row with no series. `recurring-group-heading.component.test.tsx`:
  tile, title, total, the style contract of kiko-design-system's "user data in a row" (`ancestorWithStyle`: title box
  `flex: 1`, total box `flexShrink: 0`), not pressable. `recurring-series-row.component.test.tsx`: the last-charge line is a
  descendant of the amount's column and not of the name's (red: today it sits under the name), for the active, stopped and
  quiet lines. `recurring-series.screen.footer.test.tsx`: the button by kind is inside `screen-footer`
  (`within(getByTestId('screen-footer'))`, red: today it is in the list footer), `secondaryTonal`, regular; "All paid so far"
  with the sum of the listed rows in the series currency and no `ratesRepo` read; it waits for the rows read; Remove mark
  still holds the series between the write's fire and `goBack` (the existing pin, rerun, must stay green). Commit
  `test(settings): category groups, totals and the footer button`.
- [ ] **step 6/9 (kiko:developer): screens.** Spec 17.2, 17.3, 17.6. The list: items from `recurringGroupsOf`, the group
  heading component of shared parts (`EntityIconTile` `compact`, `Text`, `MoneyText`), `Divider spacing={2}`, the total row, the
  row's two lines; theme tokens only. P2 ("A: In their group"): remove the "No Recent Charge" section and
  `recurringCharges.stoppedHeading` from `en.ts`, `uk.ts`, `title-keys.ts`, its
  two test reads and the `STOPPED_HEADING` testID pins (`recurring-charges.screen.test.tsx`,
  `recurring-charges.screen.marked.test.tsx`: those become the in-group order of 17.2), spec 13's row marked removed, all in
  this commit (harness-workflow "Removing or renaming a catalogue key"; re-grep help topics, pin suites and uk first). The
  series screen: the header total; the button into `Screen`'s `footer` with `floatingFooter`, `secondaryTonal`; the list's
  bottom padding from `useFloatingFooterEnd()` through a child of `Screen`, as `LedgerList`; `removedSeries` untouched. The
  by-measure suites of the Files list get their mock lines. Run the named files, `src/screens/settings/recurring-charges`,
  `src/screens/settings/recurring-series`, `src/navigation/settings-stack`, `src/i18n/locales`. Commit
  `feat(settings): recurring charges by category, with totals`.
- [ ] **step 7/9 Review (kiko:reviewer).** Diff from the set's base. Top question: can a total add two currencies' minor units,
  or count a row twice (a folded twin, a row in two series, a hidden series)? Second: does a hide or a mark now run any
  whole-ledger read or detection (spec 9.5, S13)? Third: does the series screen still hold its series across Remove mark?
  No migration in this set.
- [ ] **step 8/9 Drift and Scribe (kiko:retrospect, kiko:scribe).** kiko-domain's recurring section (totals, groups, the
  stopped placement), kiko-design-system (the group heading, the lone secondary footer action on a `bleedTop` list),
  kiko-pricing (a named past-row conversion rule, `buildCategoryBreakdown`'s, now with a second reader). Report the sha or "no
  drift found"; `make doc-suites` after the last doc commit.
- [ ] **step 9/9 Device and Ready.** Device, both languages: groups, icons, totals and the total of all against a hand sum;
  a UAH and a USD series; a series with no category in the default category's group; a stopped series in its group; "Hidden" with its divider; the row's second line with a long quiet
  line; the series footer button and "All paid so far"; iPad two panes and the Duo fold. READY FOR VERIFY, label
  `1.4-recurring-visual-1-task-1`.

### 1.4-recurring-visual-1 task 2/3: the transaction form (items 11, 12, 14)

**Base:** task 1/3's tip. **Files (floor 15; mutable floor 5: `select-field.component.tsx`, `field-group.component.tsx`,
`mode-and-actions.component.tsx`, `exchange-fields.component.tsx`, `transaction-form.screen.tsx`).**
- Modify: `src/design-system/components/select-field/{select-field.component.tsx,select-field.props.d.ts,select-field.component.test.tsx}`
  (the props type is in `select-field.props.d.ts` at de3d659b0; re-grep);
  `src/screens/forms/exchange-fields/{exchange-fields.component.tsx,exchange-fields.props.d.ts}` (P3 B: an optional leading
  slot that shares the "Value Out" row; `exchange-fields.component.test.tsx` by measure only; `ExchangeFields` has one
  caller, `field-group.component.tsx`);
  `src/screens/forms/transaction-form/recurring-mark-field/{recurring-mark-field.component.tsx,recurring-mark-field.component.test.tsx}`;
  `src/screens/forms/transaction-form/mode-and-actions/{mode-and-actions.component.tsx,mode-and-actions.props.d.ts}`;
  `src/screens/forms/transaction-form/field-group/{field-group.component.tsx,field-group.props.d.ts}`;
  `src/screens/forms/transaction-form/transaction-form.screen.tsx` (the footer expression; the `typeSelectField` element moves
  into a `FieldGroup` prop; the two `ModeAndActions` props go). kiko-design-system's `SelectField` entry (component-set.md).
- Create: `src/screens/forms/transaction-form/field-group/field-group.styles.ts`;
  `src/screens/forms/transaction-form/transaction-form.layout.test.tsx` (a new suite, so `transaction-form.screen.test.tsx`,
  which `1.4-bybit` edits, stays untouched unless a by-measure edit is needed; report it if so).

- [ ] **step 1/5 (kiko:qa): field look pins (item 11).** `select-field` test: with `emptyOption` equal to the selected option
  the value's tone is `textSecondary`, with another option `textPrimary`, with no prop `textPrimary` (red: the prop is ignored;
  pass it through a cast so `tsc` holds). `recurring-mark-field.component.test.tsx`: "Not marked" in `textSecondary`, a period
  in `textPrimary`, the loading state unchanged. Commit `test(forms): "Not marked" reads as an empty value`.
- [ ] **step 2/5 (kiko:developer): field look.** Spec 17.6 item 11: `SelectField`'s optional `emptyOption`; `RecurringMarkField`
  passes `emptyOption="none"`; the component entry in kiko-design-system. Run the named files and
  `src/design-system/components/select-field`. Commit `feat(forms): the mark field's empty value as the loan field's`.
- [ ] **step 3/5 (kiko:qa then kiko:developer, one step as the coordinator asked): layout (items 12, 14).** Pins first in
  `transaction-form.layout.test.tsx`, one commit red, then the code commit. Pins: "Convert to exchange" is inside
  `screen-footer` and not in the form body (red today), absent on a create, while converting and on a template edit, where the
  footer still holds "Create transaction" (the two never meet: a world with `editTemplateId` and a stored row id asserts one
  button); its press enters convert mode. Type and Amount: at `fontScale` 1 the Type trigger and the Amount field share one
  row parent with `flexDirection: 'row'` and each sits in a `flex: 1` box (red today: separate rows); at `fontScale` 3 (set
  through `Dimensions.set` in the suite) they stack in today's order with no row parent; P3 B: in Exchange mode the Type
  trigger and "Value Out" share one `flexDirection: 'row'` parent, each in a `flex: 1` box (red today: Type above it), and
  at `fontScale` 3 they stack with Type first; a switch between Expense and Exchange leaves Type the first child of a row
  in both (it never widens); convert shows Amount alone with no Type; the invalid-amount and invalid-"Value Out" scrolls still
  reach `amountFieldRef` and `valueOutFieldRef` (rerun the existing pins). Code: spec 17.6 items 12 and 14, the
  `ExchangeFields` leading slot fed by `FieldGroup`; one named threshold constant with its source in a comment, shared by
  both rows; theme spacing only. Run `npx jest src/screens/forms/transaction-form src/screens/forms/exchange-fields
  src/design-system/components/select-field --maxWorkers=2`. Commits
  `test(forms): the convert button in the footer, type and amount in one row`, then `feat(forms): ...` the same words.
- [ ] **step 4/5 Review, Drift and Scribe (kiko:reviewer, kiko:retrospect, kiko:scribe).** Top question: does any field move
  besides Type, Amount, "Value Out" and the convert button, and does a read-only synced row still lock them? Drift:
  kiko-design-system (`SelectField`, the two-field row in both modes and its accessibility fallback, the footer), spec 9.6's
  placement text.
- [ ] **step 5/5 Device and Ready.** Device: the mark field beside the loan field (both empty); the convert button in the
  footer and the fields with no button between them; Type and Amount, and Type and "Value Out" in Exchange mode (a mode
  switch moves no field), on an iPhone, the Duo folded window, the largest
  non-accessibility size and AX1 and above (stacked, nothing clipped). READY FOR VERIFY, label `1.4-recurring-visual-1-task-2`,
  with the files of this set listed for the merge order against `1.4-bybit`.

### 1.4-recurring-visual-1 task 3/3: the detected period on the mark field (item 13)

**Rule:** spec 9.6 "The detected period" (USER 2026-11-05 "A: Everywhere"), 8.2's "The form on a detected row", 13's three
`forms.transaction.detectedRecurring.*` keys ("Texts lgtm"). **Base:** task 2/3's tip. **How the sets stack:** task 2/3 steps
1/5 and 2/5 edit `recurring-mark-field.component.tsx` and its test (the `emptyOption` tone). This set edits the same two files
on top of them, so it starts only after task 2/3's tip exists, and it merges into `next` after task 2/3. It does not edit
`transaction-form.screen.tsx` or `transaction-form.screen.test.tsx` (the `1.4-bybit` files). Re-check that with
`git diff --stat next...1.4-bybit` at its base, and report the result. Detection, the store, the routes and the list do not change.

**Design, for the pins:**
- **One pure function** decides it for both screens: `rowRecurrenceOf({ chargeGroups, key, currency, rowId, choices, today })`
  in a new leaf `src/recurring/row-recurrence/`. It returns `{ kind: 'marked', period, marks } | { kind: 'detected', period } |
  { kind: 'none' }`. It builds a `ChargeGroups` holding the row's group alone (with the same `newestTimeByHoldingId`), runs
  `seriesOfGroups` and `markedSeriesOf(..., markedEntriesOf(choices) for that key, today)`, then `detectedBesideMarked`, drops
  everything when `choices.get(key)?.hidden === true`, and finds the series whose `chargeIds` hold `rowId`.
  `markedEntriesOf` moves out of `use-recurring-series.ts` (a local `const` there today) into this module, and the list hook
  imports it: one definition. The marked chain keeps today's rule (`markedChainOfAmount`, by amount), so `writeMark` does not change.
- **`useRowMark`:** the ledger read is `enabled` when the row is offered, the settings read has settled, and the key is not
  hidden-without-a-mark-in-this-currency. So a hidden key with no mark there reads no ledger and shows "Not marked"
  (coordinator 2026-11-05: accepted; this open point is closed). The
  `chargeGroupsOf` memo stays one per ledger fire. The hook returns `{ chain, detectedPeriod, isReady }`, and the one wait
  (spec 9.6) still covers the ledger read.
- **The field:** on a detected row, `labels.none` is `t('forms.transaction.detectedRecurring.<period>')`, `selected` stays
  `'none'`, and `emptyOption` is not passed, so the value reads `textPrimary`. On a row in no series it reads "Not marked"
  with `emptyOption="none"` (task 2/3). A pick on the first row writes nothing; a period pick goes through `writeMark`, as now.

**Files (floor 13; mutable floor 4: `row-recurrence.ts`, `use-row-mark.ts`, `use-recurring-series.ts`,
`recurring-mark-field.component.tsx`).**
- Create: `src/recurring/row-recurrence/{row-recurrence.ts,index.ts,row-recurrence.test.ts,row-recurrence.properties.test.ts}`.
- Modify: `src/recurring/use-row-mark/{use-row-mark.ts,use-row-mark.test.tsx}`;
  `src/recurring/use-recurring-series/use-recurring-series.ts` (the `markedEntriesOf` import only);
  `src/screens/forms/transaction-form/recurring-mark-field/{recurring-mark-field.component.tsx,recurring-mark-field.component.test.tsx}`;
  `src/screens/forms/transaction-form/transaction-form.recurring-mark.test.tsx`; `src/i18n/locales/{en,uk}.ts`;
  `__tests__/property-sweep-sites.test.ts` (the new sweep site).
- By measure: `recurring-mark-field.props.d.ts` (unchanged unless a prop joins), the form suites that mock
  `recurringLedgerQuery` with an empty query (`transaction-form.set-category`, `.exchange-funding`, `.templates`). If
  `transaction-form.screen.test.tsx` needs a line, report it to the coordinator before writing it (the `1.4-bybit` tie).
- Docs (step 4/6): kiko-domain's recurring section (the form's detected period, the shared function), spec 9.6.

- [ ] **step 1/6 (kiko:qa): pins, red on the base.** Commit `test(recurring): the detected period on the mark field`.
  - `row-recurrence.test.ts`, red by a runtime lookup of the missing module (Global Constraints). A row a detected monthly
    series holds gives `detected`/`monthly`, and weekly and yearly worlds give theirs. A row of the same group outside the
    found series (an outlier amount) gives `none`. **Hide:** the same world with the key hidden gives `none` (and a hidden key
    with a mark still gives `marked` for a row in the chain: 8.1, the hide affects detected series only). **Overlap:** a
    detected series sharing a row with a marked chain gives `marked` on the shared row and `none` on the detected series' other
    rows; Apple 399 beside a marked Apple 99 gives `detected` on a 399 row. Another currency's group under the same key never
    counts. A mutant that runs `seriesOfGroups` on the full `ChargeGroups` (the instrumented call receives a map of size 1, as
    the cost pin below) fails.
  - `row-recurrence.properties.test.ts` (`sweep`, `@kiko/test-support/property-sweep`, the new site added to
    `__tests__/property-sweep-sites.test.ts`). It is the "matches the list" pin. Over generated ledgers (several names and
    currencies, a mark and a hide drawn per key), for every row id, `rowRecurrenceOf` equals what the list shows. The list's
    answer comes from the list's own path: `chargeGroupsOf` + `seriesOfGroups` + `markedSeriesOf` + `detectedBesideMarked` as
    `useRecurringSeries` composes them, then the list screen's hidden filter (`choices.get(merchantKey)?.hidden !== true`,
    re-grep its place after task 1/3 step 6). The answer is the period of the shown series that holds the row, or none. A
    mutant that skips the hide or the overlap fails on a drawn world (show it red on both).
  - `use-row-mark.test.tsx`, named edits with a `was:` line in the commit body. `reads no ledger for %s`: the offered cases
    flip to reading the ledger, and the hide-only entry stays at no read (was: no ledger read under an unmarked name). `builds
    the charge groups once per fire and runs no series rule` becomes "once per fire, and the series rule on the row's group
    alone". Also: `detectedPeriod` is null until both reads settle.
  - `recurring-mark-field.component.test.tsx`: "Detected: monthly" / «Виявлено: щомісяця» as the value in `textPrimary`; the
    sheet's first row reads the same; picking it writes nothing (no `settingsRepo` write); picking "Monthly" calls
    `markRecurringCharge` with the row's key, amount and currency; a hidden detected row reads "Not marked" in
    `textSecondary`; a marked row reads its marked period, as before.
  - **(a) The form does not wait for detection**, in `transaction-form.recurring-mark.test.tsx`: a stored debit with the
    `recurringLedger` read held loading (the suite's `mockLive.reads`, never landed). The form shows Description and Amount;
    typing into Amount changes its value; Save calls the repository update with the typed amount and leaves the form. Through
    all of this the mark field is present, `disabled` and states no value. Then the ledger read lands with a detected world,
    and the field reads "Detected: monthly" and is enabled. Show it red on three temporary mutants, each of which awaits
    detection: the screen renders `LoadingState` until the field's read settles; Save is `disabled` while the field is not
    ready; the field suspends (throws a promise) until ready. All three fail on the Save or on the typed value. This pins the
    order only: a synchronous detection that blocks the JS thread on a device cannot show in jest (spec 10.4 counts work, never
    time), and the device measure below covers it.
  - **Cost pin:** with a two-group ledger, one fire runs `chargeGroupsOf` once and `seriesOfGroups` once, on a map holding the
    row's group alone. A hide or a mark write (a `settings` fire) runs neither again on an unchanged ledger.
- [ ] **step 2/6 (kiko:developer): code.** The design above, theme tokens only. The three keys go into `en.ts` and `uk.ts`
  together, as approved (spec 13), in a sentence-case group under `forms.transaction` that is not in `TITLE_KEYS`. Run `npx jest
  src/recurring/row-recurrence src/recurring/use-row-mark src/recurring/use-recurring-series
  src/screens/forms/transaction-form src/i18n/locales --maxWorkers=2`. `make jest-affected` exits 3 on the catalogues, so say
  so. Commit `feat(forms): the mark field shows a detected period`.
- [ ] **step 3/6 Review (kiko:reviewer).** Diff from task 2/3's tip. Top question: for any row, can the form's answer differ
  from the list's (the hide, the overlap, another currency, a row outside the series, a later local day)? Second: does
  anything on the form other than the field wait for the ledger read or detection? Third: does a hide or a mark write now run
  detection or a new ledger read (spec 9.5)? No migration.
- [ ] **step 4/6 Drift and Scribe (kiko:retrospect, kiko:scribe).** kiko-domain (the form's detected period, the one shared
  function, the hidden-key case) and the HANDOFF item 13 line. Report the sha or "no drift found"; `make doc-suites` after.
- [ ] **step 5/6 Device measure (coordinator, before READY).** Release build of task 2/3's tip (the base) and of this tip,
  each in turn on the user's Duo, on the user's real ledger only (coordinator 2026-11-05: the Duo holds real data, so no
  restore and no second install there). Record the real ledger's row count; the READY report states it.
  - **10,000 rows, an indicator only:** a simulator Release build of both tips, at AC, in the simulator slot the coordinator
    assigns. It sets no verdict on its own; the stall trigger below reads the Duo's numbers.

  On the Duo, open an offered debit in a detected series and an offered debit in no series, three times each, from Home.
  Take the median of three. Record from a screen recording (frame-counted):
  - **M1**, tap to first frame of the form;
  - **M2**, tap to the field showing its value, enabled;
  - **M3**, for three digits typed into Amount right after the form shows, each tap to its digit drawn;
  - **M4**, a Save tap during the field's wait to the form leaving.
  The numbers, both builds, go in the coordinator's report (spec 10.3).
  - **Stall trigger** (the round's line, a planner's choice, not a measured iPhone fact): any one of these on either ledger
    is a stall: M1 on this build over the base's M1 by more than 100 ms (median of three); any M3 or M4 over 250 ms; or
    the user reads it as a stall. M2 has no pass line; it is reported.
  - **Fallback (option C, coordinator 2026-11-05), on a stall:** no READY. The planner then adds steps to this set
    (renumbered N/M): the series screen passes the detected period through the form's route, and the field reads no ledger
    and runs no detection. Opened from Home or an account's ledger, a row with no mark reads "Not marked". Then
    re-measure, and the coordinator brings C to the user, never as a narrower rule or a raised line.
  - **Option B rejected:** reusing the funding caption's rows removes only the read (on the Mac about 6 to 8% of read plus
    reference detection at 100,000 rows, 133.0-148.0 against 1823.5-2113.3 ms), not the detection's CPU.
- [ ] **step 6/6 Device and Ready.** Both languages: "Detected: monthly" from Home, an account's ledger and the series screen
  on the same row; a hidden detected series' row reads "Not marked"; a period pick moves the series to marked on the list; a
  row under a marked name reads its marked period; "Not marked" in the placeholder tone beside "Detected" in the value tone.
  READY FOR VERIFY, label `1.4-recurring-visual-1-task-3`, with the real ledger's row count, the M1 to M4 table, the stall verdict and this set's files.

---

## 1.4-recurring visual round 2

**Spec:** section 18 (18.1 the reversals with their "was:", 18.2 totals, 18.3 the table, 18.4 hidden rows, 18.5 the footer,
18.7 texts, 18.8 answers with Q5). **Branch:** `1.4-recurring-visual-2`, base 85215396e (visual-1 task 3/3's tip, not
yet in `next`). **Answers (USER 2026-11-06):** Q1 A, Q2 (a stopped series counts, a hidden one does not, plus a way to remove a
stopped series: Q5), Q4 B, and the FINAL Q5 RULING (USER 2026-11-06, spec 18.8): one action "Not a recurring charge", by long
press on any series row and the series footer, removes the series entirely; no "Hidden" section, no "Show again"; only a
mark brings it back. Q3 and the earlier Q5 A are SUPERSEDED (spec 18.8 keeps them as the record). **Texts:** rows of tasks
1/5 and 3/5 APPROVED 2026-11-06; task 2/5's rows PENDING USER REVIEW (texts-visual-2.md, "Final Q5 ruling texts
(pending)"). **Order and gates:** 1/5, then 3/5 (the table does not depend on the ruling, so it starts while the texts wait),
then 2/5 (gated on the pending texts), then 5/5. Task 4/5 is VOID, merged into 2/5. Four change sets, stacked: each on the
previous one's tip in that order. Task 5/5 is the track's design consistency review (user rule 2026-11-06). Every count is a
floor; the developer measures. Every code fact names a symbol: re-grep each on the actual base. Scope is the three items, the
final Q5 ruling and the review only.

**M is 6 since 2026-11-06** (was 5): task 6/6 is the user bug of DEPLOY 4 (spec 8.3). Tasks 1/5, 2/5, 3/5 and 5/5 merged
under those names and keep them; read them as N/6.

**Run-log gaps:** these sets close none and leave all open; none names the recurring screens. Nearest, left open:
`20261103T2049-kiko-1-4-light-scheme-2/1` and `20261104T1734-kiko-1-4-light-scheme/1` (dark look owed on a device; this
round's device call can cover the recurring screens in dark).

**Existing suites.** No owed state, column, migration or seed: no 1.2-upgrade world is touched. Not "unchanged": the named
edits of each step are the only edited expectations, each with a `was:` line in its commit body; any other is reported, not
made. Each qa pin is shown red on the base before its commit; a pin green on the base is a guard, shown failing by a temporary
mutant.

**Checks for every step:** the fast tier on write; `npx jest <named files> --maxWorkers=2` with output in a file; `make
jest-affected BASE=<set base>` where it does not exit 3 (`en.ts`/`uk.ts` make it 3: run the named set and say so). The named
set of every code step includes `src/navigation/settings-stack`. No agent runs `make verify`, `check:all` or full jest. At the
end of each set the coordinator queues `bash scripts/job-queue.sh verify <worktree> 1.4-recurring-visual-2-task-N` and reruns
until green. Mutation gates are paused by the user; if lifted, one gate per set, `KIKO_MUTATION_BASE` = that set's own base,
never one run over the round. A catalogue key removal greps the help topics, the pin suites and uk first, every dependent edit
in the same step (harness-workflow "Removing or renaming a catalogue key").

### 1.4-recurring-visual-2 task 1/5: group totals of last charges (item 1)

**Files (floor 8; mutable floor 2: `recurring-groups.ts`, `recurring-charges.screen.tsx`).**
- Modify: `src/recurring/recurring-groups/{recurring-groups.ts,recurring-groups.test.ts}`;
  `src/recurring/use-recurring-groups/use-recurring-groups.test.tsx` (the totals assertion of `group the by-ids rows by the
  categories read, convert at the rates read, total in the base`); `recurring-charges.screen.tsx` (the total row's label);
  `recurring-charges.screen.groups.test.tsx`; `src/i18n/locales/{en,uk}.ts`.
- By measure: `src/test-support/mock-recurring-groups.ts`, `src/screens/settings/recurring-charges/*.test.tsx` that read a
  total.

- [ ] **step 1/4 (kiko:qa): pins, red on the base.** `recurring-groups.test.ts`: a series of three charges (newest 300, then
  200, 100, all in `rows`) adds 300 to its group, not 600 (red); the counted amount is `lastChargeAmountMinorUnits` even when
  the newest row is missing from `rows` (red: today it sums the rows); a USD series converts its last charge once at
  `buildRateTable(rates)` and the group total is the `Money` sum of its series in the base; a currency `canConvert` rejects is
  left out and its series still listed (guard); a stopped series' last charge counts (Q2, USER 2026-11-06; a guard: red on a
  mutant that filters `isStopped`); the total of all equals the sum of the group totals (guard). Named edits, each with `was:`: `the
  totals` describe's sums of every row (was: the sum of all charges, spec 17.4), and `makes the total of all the sum of the
  group totals`, whose per-row rounding world has no meaning with one amount per series (was: a rounding world where per-row
  conversion differs by one minor unit). `recurring-charges.screen.groups.test.tsx`: the total row reads "Sum of last
  charges" / «Сума останніх списань» (red; was: "All paid so far"). `use-recurring-groups.test.tsx`: its totals now of last
  charges (a named edit, `was:`). Commit `test(recurring): group totals of last charges`.
- [ ] **step 2/4 (kiko:developer): code.** Spec 18.2: the group total adds `Money.of(series.currency,
  series.lastChargeAmountMinorUnits)` per counted series, one `convert` each, `canConvert` as the guard; `paidSoFarOf` and its
  helper stay for the series screen (knip: no export left unused). `recurringCharges.lastChargesTotal` into `en.ts` and `uk.ts`
  together, as approved; the list's total row reads it; `paidSoFar` stays (the series screen). Run `npx jest src/recurring
  src/screens/settings/recurring-charges src/screens/settings/recurring-series src/navigation/settings-stack src/i18n/locales
  --maxWorkers=2`. Commit `feat(recurring): group totals of last charges`.
- [ ] **step 3/4 Review, Drift and Scribe (kiko:reviewer, kiko:retrospect, kiko:scribe).** Top question: can a total add two
  currencies' minor units, count a series twice, or count a charge other than the last? Drift: kiko-domain's recurring section
  (the totals rule), kiko-pricing's past-row conversion line if it names the recurring sum. Report the sha or "no drift
  found"; `make doc-suites` after the last doc commit.
- [ ] **step 4/4 Device and Ready.** Both languages: group totals and the total of all against a hand sum of the rows'
  amounts, a UAH and a USD series, a stopped series. READY FOR VERIFY, label `1.4-recurring-visual-2-task-1`.

### 1.4-recurring-visual-2 task 2/5: "Not a recurring charge" removes a series entirely (item 3, final Q5 ruling)

**Was:** "hidden series in their group, "Show again" on the series screen" (round 2 Q3 A, VOID) and task 4/5 "remove a stopped
series from the list" (Q5 A, VOID, merged here). **Spec:** 18.4, 18.5, 18.7, 18.8 "Final Q5 ruling". **Gate:** the texts
PENDING USER REVIEW (texts-visual-2.md, "Final Q5 ruling texts (pending)"); no step starts before the coordinator relays the
user's approval; an edited row is copied as approved. **Base:** task 3/5's tip (runs after 3/5). No migration, no column, no
store shape change. **Files (floor 21; mutable floor 4: `recurring-charges.screen.tsx`, `recurring-series.screen.tsx`,
`settings.repo.ts`, `card-context-menu.component.tsx`).**
- Modify, code:
  - `src/screens/settings/recurring-charges/recurring-charges.screen.tsx`: remove `HIDDEN_HEADING_ITEM`, `hiddenEntriesOf`,
    `hiddenItemsOf`, the `'hidden'` list-item kind and the `'hidden'` heading section, their `keyOf` and render arms (testIDs
    `recurring-charges-heading-hidden`, `recurring-charges-hidden-<key>`, `recurring-charges-show-again-<key>`), `showAgain`,
    `itemsOf`'s `choices` parameter, every import left unused (`compareText` and others: tsc and knip decide), and the
    comments that name the hidden section. The `series` arm wraps `RecurringSeriesRow` in `CardContextMenu` for every series
    (detected, stopped, quiet, marked): `name={series.name}`, `deletable`, `liftOnHold`, `deleteLabel={t('recurringCharges.notRecurring')}`,
    `deleteTitle={t('recurringCharges.notRecurringConfirmTitle')}`, `deleteMessage` resolving
    `t('recurringCharges.notRecurringConfirmMessage', { name })`, `onDelete` calling
    `settingsRepo.hideRecurringMerchant(series.merchantKey, series.name, series.marks ?? [])` with the list's `alertOnCatch`
    save-error keys. `markedEmpty` rows stay as they are (no hold).
  - `src/design-system/components/card-context-menu/card-context-menu.component.tsx`: optional `deleteLabel?: string`, the
    text of the delete item and of the confirm button; omitted, `t('common.delete')` (every current caller unchanged).
  - `src/settings/settings.repo.ts`: `hideRecurringMerchant(key, name, chain: readonly RecurringMark[] = [])` sets `hidden:
    true` and drops the stored marks of `chain` (`isSameChain`) in the same `changeRecurringMerchantChoices` write; remove
    `showRecurringMerchantAgain` (no caller left). `recurringChoiceOf` and `withChoice` stay only if `removeRecurringMarks`
    still calls them (knip decides).
  - `src/screens/settings/recurring-series/recurring-series.screen.tsx`: the footer's "Not a recurring charge" opens the shared
    `ConfirmSheet` (same title, message with the name, `confirmLabel` `notRecurring`, `destructive`); its confirm runs the
    existing `hide` through `useSubmitOnce`; Cancel writes nothing; the go-back rules unchanged (Q4 B). The marked footer
    "Remove mark" unchanged.
  - `src/i18n/locales/{en,uk,title-keys}.ts`: add `recurringCharges.notRecurringConfirmTitle` (also in `TITLE_KEYS`) and
    `recurringCharges.notRecurringConfirmMessage`; change `help.topics.viewRecurringCharges.steps.4`; remove
    `recurringCharges.hiddenHeading` (en, uk, `title-keys.ts`) and `recurringCharges.showAgain` (en, uk).
- Modify, pins (grep on the base `recurring-charges-hidden-`, `recurring-charges-show-again-`, `heading-hidden`,
  `hiddenHeading`, `showAgain`, `showRecurringMerchantAgain`, `HIDDEN_LINE`, `hideRecurringMerchant`; at 4e61124c7):
  `recurring-charges.screen.test.tsx` (describe `RecurringChargesScreen — hidden merchants`; the `hiddenHeading`/`showAgain`
  text pins), `recurring-charges.screen.marked.test.tsx` (`HIDDEN_APPLE`, the `ghost` key, the headings list reading
  `hiddenHeading`; the qa agent's in-flight edits land first), `recurring-charges.screen.marked-flows.test.tsx` (`HIDDEN_LINE`,
  the show-again flow), `recurring-charges.screen.groups.test.tsx` (the item-order world with `heading-hidden`, `shows no total
  in "Marked, No Charges" or "Hidden"`), `recurring-series.screen.test.tsx` (the hide pins), `recurring-series.screen.footer.test.tsx`,
  `src/settings/settings.repo.test.ts` (the `showAgain` helper, its three cases, describe `showRecurringMerchantAgain`, `touches
  no transactions row on a hide or a show again`), `card-context-menu.component.test.tsx`,
  `src/navigation/settings-stack/recurring-series.navigator.test.tsx` (`a hide write that lands after the user moved on`: through
  the confirm). By measure: `src/i18n/locales/title-keys.call-sites.test.ts` (the footer's `ConfirmSheet title` is a literal
  `t('key')`, so `TITLE_KEYS` covers it; `deleteTitle` is already a forwarded site: verify), the suite that pins the help
  steps (grep `viewRecurringCharges.steps` under `src`), `recurring-series.marks.navigator.test.tsx` (no hidden case at
  4e61124c7). `help-topics.ts` and its test do not change (no step 6).

- [ ] **step 1/5 (kiko:qa): pins, red on the base.** Every named edit carries a `was:` line (spec 18.4's matrix). List suites:
  - a hidden key with no mark: none of its series render, no `recurring-charges-heading-hidden`, no `recurring-charges-hidden-*`,
    no `recurring-charges-show-again-*`, no "Hidden" / «Приховані» text (red; was: the "Hidden" section with "Show again");
    its amounts are in no group total and not in the total of all (guard; red on a mutant that passes `every` as `shown`);
  - a new charge of a hidden key (its newest charge today, after the hide) stays out (guard; red on a mutant that lists a
    hidden detected series that is active);
  - a mark on one of its charges brings it back: hidden key plus a mark in that currency lists the marked series and counts
    it (guard; red on a mutant that filters `markedSeries` by the hide); written through `markRecurringCharge` in the
    marked-flows suite, the series appears after the write (guard);
  - only a hidden key: the empty state and nothing after it (red; was: `shows the empty state and the section together`);
  - the long press, on each of an active, a stopped, a quiet and a marked row (`HOLD_GESTURE_TEST_ID` within the row): the
    confirm opens titled with the pending title, the message with the row's name, the confirm button
    (`DELETE_CONFIRM_TEST_ID`) "Not a recurring charge" / «Це не регулярний платіж», `destructive`, and no "Delete" /
    «Видалити» text (red); a "Marked, No Charges" row has no hold (guard);
  - one write path: confirm on a detected row calls `settingsRepo.hideRecurringMerchant(key, name, [])` once; on a marked row
    `(key, name, series.marks)` once; the same spy as the footer pin, and no other `settingsRepo` write runs (red); Cancel
    calls nothing (red);
  - after the confirm (the live-query mock of `recurring-mark-live-queries.ts`, by measure): the row and every detected
    series of that key in another currency leave the list, their amounts leave the group totals and the total of all (red);
    on a marked row the marked series leaves and the key's detected series does not appear (red);
  - a rejected write alerts with the save-error keys and the row stays (red); a tap on a row still opens the series (guard).
  Footer (`recurring-series.screen.footer.test.tsx`, `recurring-series.screen.test.tsx`): a tap on `recurring-series-hide`
  opens the confirm and writes nothing (red; was: the tap writes); the confirm writes `hideRecurringMerchant(key, name)` once
  (a double tap once), goes back only after the write and only while focused (Q4 B stands; named edits of `hides the merchant
  key with its name on a tap, and goes back only after the write` and `does not go back when another screen was opened over it
  before the write landed`); Cancel stays and writes nothing (red); the marked series still shows "Remove mark" (guard).
  Navigator: the late-write pin through the confirm (named edit). Repo (`settings.repo.test.ts`): a hide with a chain sets
  `hidden: true`, drops only that chain's marks and keeps the key's other marks, in one write (red); without a chain as today
  (guard); the `showRecurringMerchantAgain` cases go with the function (was: show again clears the hide). `CardContextMenu`:
  `deleteLabel` labels the action-list delete item and the confirm button (red); omitted, both read "Delete" (guard). Help:
  step 4 in both languages, the approved row byte for byte (red). Commit `test(settings): not a recurring charge removes a
  series entirely`.
- [ ] **step 2/5 (kiko:developer): code.** Spec 18.4, 18.5. The Files above; the shared `CardContextMenu` and `ConfirmSheet`,
  no local sheet, theme tokens only. Before removing `hiddenHeading` and `showAgain`, grep both keys and the literals
  `Приховані`, "Show again", «Показати знову», `from "Hidden"` in `src`, `__tests__`, the help topics, `docs/superpowers`,
  `.claude/skills` and `harness/kiko/skills` on the base, and edit every hit in this commit (harness-workflow "Removing or
  renaming a catalogue key"; at 4e61124c7 kiko-domain names the 'Hidden' section and "Show again"). Run `npx jest
  src/recurring src/settings src/screens/settings/recurring-charges src/screens/settings/recurring-series
  src/navigation/settings-stack src/design-system/components/card-context-menu src/help src/screens/settings/help-topic
  src/i18n/locales --maxWorkers=2`; `npm run check:knip` (no unused export). Commit `feat(settings): not a recurring charge
  removes a series entirely`.
- [ ] **step 3/5 Review (kiko:reviewer).** Diff from the set's base. Top question: can a series of a hidden key with no mark
  reach the list or a total, and does a mark still bring it back? Second: do the hold and the footer share the one write, and
  does a marked row's write clear only that chain's marks? Third: does `deleteLabel` change any existing `CardContextMenu`
  caller, and does the hold on every row keep the list's scroll and tap? Fourth: is any removed pin deleted rather than
  re-pointed, and is every removed key gone from both catalogues, `title-keys.ts`, the help text and the skills? Fifth: does a
  hide still add no by-ids key and run no detection (9.5)? No migration.
- [ ] **step 4/5 Drift and Scribe (kiko:retrospect, kiko:scribe).** kiko-domain's recurring section (no "Hidden" section, the
  per-key hide with no date, the marked-row write, the only way back), kiko-design-system (`CardContextMenu` `deleteLabel`, a
  recurring caller; the series footer's confirm), spec 8.1 and 9.2's text if retrospect asks. Report the sha or "no drift
  found"; `make doc-suites` after.
- [ ] **step 5/5 Device and Ready.** Both languages: hold an active row, the confirm, the row and its other-currency series
  gone, totals down; hold a marked row, gone, its detected twin absent; open a detected series, the footer, the confirm, Back;
  mark one of a removed series' transactions in the form, the series back; Cancel leaves everything; the list scrolls from a
  held row. READY FOR VERIFY, label `1.4-recurring-visual-2-task-2`.

### 1.4-recurring-visual-2 task 3/5: the series screen's table (item 2)

**Base:** task 1/5's tip (was: task 2/5's tip). The next code task after 1/5: the table does not depend on the final Q5
ruling and its texts are approved, so it starts while task 2/5's texts wait. **Files (floor 9; mutable floor 1:
`recurring-series.screen.tsx`).**
- Create: `src/screens/settings/recurring-series/recurring-series.screen.summary.test.tsx`.
- Modify: `recurring-series.screen.tsx` (the header becomes one `SummaryTable`); `recurring-series.styles.ts` (`paidRow`,
  `paidLabel`, `paidAmount` go if unused); `src/i18n/locales/{en,uk}.ts`.
- Modify, the header pins: `recurring-series.screen.test.tsx` (the `chargeCount` cases and the stopped line on `HEADER`),
  `recurring-series.screen.marked.test.tsx` (`lastChargeText` read with `exact: false` on `HEADER`),
  `recurring-series.screen.footer.test.tsx` (the "All paid so far" pins inside the header),
  `src/navigation/settings-stack/recurring-series.marks.navigator.test.tsx` (the `chargeCount` read inside the header).

- [ ] **step 1/4 (kiko:qa): pins, red on the base.** `recurring-series.screen.summary.test.tsx`: inside
  `recurring-series-header` one `SummaryTable` (its rows in spec 18.3's order); each label in both languages and each value
  under its testID: the recurrence line, the date, the count as a number, the paid sum; a stopped series shows "Status" with
  "No recent charge", a quiet one with the `holdingQuietSince` text, an active one no status row; a marked series' "Repeats"
  reads its "Marked:" line; the paid row is absent until the rows read lands (all red today). Named edits with `was:` (the old
  text lines): the four suites above re-read their values from the table's testIDs. Commit `test(settings): the series
  screen's table`.
- [ ] **step 2/4 (kiko:developer): code.** Spec 18.3. `SummaryTable` with caller-rendered `Text` and `MoneyText` values,
  `wraps` on the two free-text rows. Catalogue in the same commit: add `recurringCharges.summary.*`; remove
  `recurringCharges.chargeCount_{one,few,many,other}` from both catalogues after grepping `chargeCount` in `src`, `__tests__`,
  the help topics and the skills on the base. Run `npx jest src/screens/settings/recurring-series src/navigation/settings-stack
  src/design-system/components/summary-table src/i18n/locales --maxWorkers=2`. Commit `feat(settings): the series screen's
  table`.
- [ ] **step 3/4 Review, Drift and Scribe (kiko:reviewer, kiko:retrospect, kiko:scribe).** Top question: does any header fact
  of 9.3 drop (the stopped and quiet lines, the count, the paid sum and its wait)? Drift: kiko-design-system's `SummaryTable`
  callers list (a fourth caller), spec 9.3's header line.
- [ ] **step 4/4 Device and Ready.** Both languages, iPhone, iPad two panes and the Duo fold: an active, a stopped and a quiet
  series, a marked one; the largest non-accessibility size and AX1 (a wrapped value keeps its label). READY FOR VERIFY, label
  `1.4-recurring-visual-2-task-3`.

### 1.4-recurring-visual-2 task 4/5: VOID (merged into task 2/5)

VOID by the user's final Q5 ruling, 2026-11-06 (spec 18.8). Was: "remove a stopped series from the list" (Q5 A): a "Remove
from list" footer button and a no-confirm long-press item on a stopped detected row only, `closeAction` with a `destructive`
flag, help step 6. Now: task 2/5 (one action "Not a recurring charge" on every series row and the footer, behind a confirm;
`CardContextMenu` `deleteLabel`, no `closeAction` change; no step 6). No code was written for it; no label
`1.4-recurring-visual-2-task-4` is queued.

### 1.4-recurring-visual-2 task 5/5: Design consistency review (user rule 2026-11-06)

**Base:** task 2/5's tip (was: task 4/5's tip). Runs after task 2/5's review
and before the track's final READY FOR VERIFY. **Scope, the track's touched screens and components (a floor; measure with
`git diff --name-only next..<tip> -- src/screens src/design-system` plus the files of
`.superpowers/sdd/1.4-recurring/READY-visual-1-task-{1,2,3}.md`):** `src/screens/settings/recurring-charges/`
(`recurring-charges.screen.tsx`, `recurring-group-heading`, `recurring-series-row`),
`src/screens/settings/recurring-series/recurring-series.screen.tsx`, `src/screens/forms/transaction-form/transaction-form.screen.tsx`
and its `recurring-mark-field`, `src/screens/forms/exchange-fields/exchange-fields.component.tsx`,
`src/screens/forms/paired-fields-row/paired-fields-row.component.tsx`, `src/screens/settings/help-topic` (the recurring
topic), `SummaryTable` as used by the series screen, and `CardContextMenu` (its `deleteLabel`) with the series footer's `ConfirmSheet`.

- [ ] **step 1/3 Review (kiko:designer, READ-ONLY).** Over every file of the scope, five points: shared design-system
  components only, no local copies; theme tokens only; the same patterns as the sibling screens (dividers, headers, buttons,
  tones, empty states); en and uk; the dark scheme, and light once it ships. Findings, each with file, symbol and the sibling it
  diverges from, into `.superpowers/sdd/1.4-recurring/design-review-1.4-recurring.md`; "no finding" is a valid result.
- [ ] **step 2/3 Fix set (kiko:qa, kiko:developer as needed; kiko:reviewer).** The findings become one small change set, pins
  first (red on the base), then code, then its own review; a finding that needs new text goes to the user before any copy. No
  finding, no set.
- [ ] **step 3/3 Ready.** The track's final READY FOR VERIFY, label `1.4-recurring-visual-2-task-5`, names
  `.superpowers/sdd/1.4-recurring/design-review-1.4-recurring.md` and the fix set's sha (or "no finding").

### 1.4-recurring-visual-2 task 6/6: one charge per period in a marked chain (user bug, DEPLOY 4)

**Spec:** 8.3 (the rule, the anchor, the dropped charge, the form, the `was` table). **Base:** 5ef73606a, or the branch tip
when the set starts (re-grep every symbol below on it; no line numbers here). **Run-log gaps:** closes none, leaves all open;
none names the marked chain. **Files (floor 12; mutable floor 4: `detection.ts`, `marked-series.ts`, `use-row-mark.ts`,
`recurring-mark-field.component.tsx`):** those four, `marked-series.test.ts`, `src/test-support/marked-series-chain-worlds.ts`,
`src/test-support/marked-series-worlds.ts`, `use-row-mark.test.tsx`, `recurring-mark-field.component.test.tsx`,
`row-recurrence.test.ts`, the suite that pins the Marked flows' "99 x10, one 119 ... yearly pick on the 119 row" (grep
`recurring-series.screen.marked.test.tsx` first), and kiko-domain's mark rules (drift step). No migration, no column, no text
key, no seed: no 1.2-upgrade world is touched. **Not "existing suites green unchanged":** each edit below is named with its
`was`; any other edited expectation is reported, not made. `detection.test.ts` and its matrix stay unedited (detection's
output does not change).

**Interfaces.**

```ts
// @kiko/recurring/detection: one definition of the slot rule (spec 8.3)
export const onePerSlotOf: (
  charges: readonly Charge[], // folded, oldest first
  period: RecurringPeriod,
  storedAmounts: readonly number[],
) => { kept: Charge[]; dropped: Charge[] }; // kept oldest first

// @kiko/recurring/marked-series: was (charges: { amountMinorUnits }[], marks, amountMinorUnits, currency)
export const markedChainOfAmount: (
  charges: readonly Charge[], // one group's charges, unfolded; the function folds
  marks: readonly RecurringMark[],
  row: { id: string; amountMinorUnits: number }, // absolute
  currency: Currency,
) => { period: RecurringPeriod; marks: readonly RecurringMark[]; holdsRow: boolean } | null;
```

`onePerSlotOf` lives in `detection.ts` beside `slotPairOf`, with a step table `Record<RecurringPeriod, { slotDays;
stepForward }>` whose weekly, monthly and yearly entries are `WEEKLY`'s, `MONTHLY`'s and `YEARLY`'s own fields, and every 3 / 6
months `addMonths(time, 3 * n)` / `6 * n` with 3 / 6 times `AVERAGE_MONTH_DAYS`. A signed nearest-step helper (the
`slotPairOf` candidates n - 1, n, n + 1 around the rounded signed day count, least `dayGapOf`, tie to the lower n) serves both
the anchor's cost and each charge's slot; `slotPairOf` itself is not edited. Anchor, slot and tie exactly as spec 8.3's table
(the newest 12 nearest-amount charges at most, so the anchor costs at most 144 steps). **Superseded 2026-11-07 by step 5/9:**
no anchor; the floor, the near amount and the five keys of spec 8.3's redesigned table; the signature stays. In `marked-series.ts` one inner function
builds a currency's chains: fold, `piecesOf`, the piece's charges, then `onePerSlotOf(pieceCharges, piece.period,
piece.marks' amounts)`, returning the kept charges and the dropped ids. `chainsOfEntry` maps it (kept charges become the
chain's `charges`, before `seriesOfChain`, so the count, list, totals, stopped read, date line and last charge all follow);
`markedChainOfAmount` finds the chain whose span holds `row.amountMinorUnits` and sets `holdsRow` to "the row's id is not in
the dropped ids" (a folded twin and a row outside the read stay held, as now). It now needs the charges' times and ids:
`useRowMark` passes the group's `Charge[]` from `detection.chargeGroups` as they are (no `amountMinorUnits` map) and `{ id:
row.id, amountMinorUnits: Math.abs(row.amountMinorUnits) }`; `row.id` joins that memo's deps. `RecurringMarkField`: when
`chain?.holdsRow === false`, `selected` is `'none'` and the field is disabled; `writeMark` is unchanged. Update the doc comments
of `markedSeriesOf` ("no day test") and `markedChainOfAmount` ("the fold is not needed") to the new rule.

**Named edits, each with its `was` line in the qa commit body** (the qa re-walks every cell by spec 8.3 and reports any
disagreement, never edits to green):

| Pin | was | now |
|---|---|---|
| Marked matrix rows of spec 8.3's table (two detected series one chain; the same at one price; purchases in reach; period conflict; a month apart marked yearly; daily shop) in `marked-series-chain-worlds.ts` / `marked-series-worlds.ts` | spec 8.3 `was` column | spec 8.3 `now` column, walked exactly |
| Property "never lets two consecutive amounts of a marked series differ by more than 1.25" | over the series' charges and marks | over the piece's charges and marks (kept and dropped): a dropped bridge may leave two kept amounts over 1.25 apart, the piece still holds them |
| Property "equals the piece of amountPiecesOf for one mark on a charge" | the series' amount set equals the piece | the series' amounts are a subset of the piece, and a piece charge is out only when another charge of its slot is in |
| Property "never leaves fewer charges on a day and amount than the largest count of one source" | kept >= the largest same-source count | no two kept charges of a marked series share a slot (the fold's own guard stays in `detection.test.ts`'s `foldTwins` pins; the qa names them, or reports none) |
| "gives a deep-equal result for any row order and any mark order", "shares no charge between two shown series", "shows a detected series only when it shares no row with a marked one", spec 8.2's bridging rows | unchanged | unchanged: guards, each shown failing once by a scratch mutant of the tie's last key (drop the id) or of `detectedBesideMarked` |
| `markedChainOfAmount` describe, its six cases | amount-only charges, an amount argument | `Charge` fixtures and a `row`; each result also states `holdsRow` |
| Marked flow "99 x10, one 119, a detected 399 x10, marked at 99, a yearly pick on the 119 row" | the marked x11, yearly | as walked: if the 119 shares a slot with a 99, the field on it is disabled and no pick is possible (the flow pins that); else the pick and one per yearly slot |

**M is 9 since 2026-11-07** (was 6): the reviewer measured three faults of the anchor rule (spec 8.3 `was: anchor`), so steps
4/9 to 6/9 redo the rule without an anchor; the old steps 4/6 to 6/6 are now 7/9 to 9/9. The brief called the new pins "6b".

- [x] **step 1/9 (kiko:qa): red pins.** Done: 0cc0c7adf. New rows, in the existing world tables and describes (no new file, no new helper
  copy): worlds A, B, C, D from the debugger's scratch (`marked-same-month.scratch.test.ts`, path in the coordinator's brief)
  as matrix rows with `markedSeriesOf`, `paidSoFarOf` (the "All paid so far" figure) and `rowRecurrenceOf` on the extra row;
  the month-end drift world as a guard (green on the base; shown failing by a calendar-month mutant of `onePerSlotOf` once it
  exists, or recorded in the step-3 review); one `markedChainOfAmount` case per world A and D with `holdsRow: false` on the
  extra; one `recurring-mark-field` case: a dropped row reads "Not marked", is disabled, and a press writes nothing; one
  property: no marked series holds two charges of one slot (random ledgers). Then the named edits above. Each red shown failing
  on the base for the stated reason (counts in the report); `was` values copied from a base run, never typed. Commit
  `test(recurring): one charge per period in a marked chain`. **Check:** `npx jest src/recurring/marked-series
  src/recurring/row-recurrence src/recurring/use-row-mark src/screens/forms/transaction-form/recurring-mark-field
  --maxWorkers=2`, output in a file; reds only where named.
- [x] **step 2/9 (kiko:developer): the rule.** Done: a430a2b41, 4bd873420 (the anchor rule, superseded by step 5/9). The interfaces above, in `detection.ts`, `marked-series.ts`, `use-row-mark.ts`,
  `recurring-mark-field.component.tsx`. No pin edited. Commit `fix(recurring): one charge per period in a marked chain`.
  **Checks:** fast tier on write; `npx jest src/recurring src/screens/forms/transaction-form/recurring-mark-field
  src/screens/settings/recurring-charges src/screens/settings/recurring-series src/navigation/settings-stack --maxWorkers=2`
  (includes `detection.performance.test.ts`), output in a file; `make jest-affected BASE=<set base>` (exit 3: say so, the
  named set stands). **`check:dup`:** keep test growth small (rows in existing tables, one property); read the
  `dup-ceilings.tsv` rows of the touched tests; a ceiling never rises; the Stop hook's medium tier runs it.
- [x] **step 3/9 Review (kiko:reviewer).** Done: three HIGH and MEDIUM faults (spec 8.3 `was: anchor`), a missing direct
  test of `onePerSlotOf` and a missing jittered-rhythm property; the form question (#4) is ruled in spec 8.3 "The tapped row".
  Its brief was: diff from the set base. Top questions: is there one slot definition, used by both
  `chainsOfEntry` and `markedChainOfAmount` (fix-divergent-twins)? Can the anchor sit on an extra (world C) or flip on row
  order? Does any reader of the marked series still see a dropped charge (totals, stopped, last charge, date line, route)? Are
  the test edits only the named ones, each with its `was`?
- [x] **step 4/9 (kiko:qa): pins for the redesigned rule (the brief's "6b").** Done: 5b71f3943, re-pins bcffe67b7 (10 anchor-era pins in row-recurrence, recurring-series.screen.marked and the marks navigator). Base: the branch tip holding the spec commit
  `docs(recurring): one charge per period without an anchor`. Spec 8.3's redesigned table and its `now` column are the
  contract; re-grep every symbol. (a) A direct table test of `onePerSlotOf`: new file
  `src/recurring/detection/detection.one-per-slot.test.ts` (the `detection.performance.test.ts` naming; `detection.test.ts`
  stays unedited), one `it.each` table over plain `Charge` fixtures with `kept` ids and `dropped` ids per row: worlds A (at 100,
  98, 102), B, C, D, month-end drift, reviewer 1 and its reverse, reviewer 2 bills (three taps) and FX, the 31st run, weekend
  shifts, the paused month, weekly, yearly and every 6 months over m(12, 3, 199), 20 Dec and 15 Jan yearly, 7 Aug/7 Sep/7 Oct
  every 3 months, Apple with purchases, and a near-amount boundary pair (`abs * 20 == stored` near, one minor unit more not).
  (b) Reviewer worlds 1 to 3 also as `marked-series` matrix rows (count, last charge, `onDay`) in the existing world tables, and
  world A at 102 with `markedChainOfAmount`'s `holdsRow: false` on the tapped 12 Oct row. (c) Properties in
  `marked-series.test.ts` with `sweep` and `seededRandom` (no new helper): a jittered rhythm keeps every charge (monthly on a
  day 1 to 28, each charge moved -6 to +6 days, 24 months, random skipped months, one amount; weekly with -1 to +1 days); the
  result is deep-equal for any input order; no two kept charges sit half a step or less apart (this replaces step 1/9's "no
  two kept charges share a slot"). Was values from a base run, never typed. Reds on the anchor rule shown failing for the
  stated reason; guards green (the drift, bills at 1150). Commit `test(recurring): one charge per period without an anchor`.
  **Check:** `npx jest src/recurring/detection/detection.one-per-slot src/recurring/marked-series src/recurring/use-row-mark
  --maxWorkers=2`, output in a file; reds only where named. **`check:dup`:** a new test file over 1000 lines is a dup risk
  (memory: new-test-file-over-1000-lines-dup-regression): keep it one table.
- [x] **step 5/9 (kiko:developer): the rule without an anchor.** Done: ee963791b. `onePerSlotOf` in `detection.ts` per spec 8.3's table: sort by
  time then id; the floor `daysBetween > slotDays / 2`; the near test in minor units; the five keys as one tuple compared key
  by key; the DP scanning the past-floor predecessors within half a step of the latest one (`predecessorIndexesOf`;
  spec 8.3 "The computation"); gap cost by `stepForward` and `dayGapOf` with k >= 1. Remove `anchorOf`, `signedSlotPairOf`,
  `ANCHOR_CANDIDATES` if nothing else reads them (knip). Update the doc comments of `onePerSlotOf` and `markedSeriesOf` (no
  "slot around one anchor"). Signature, `marked-series.ts`, `use-row-mark.ts` and the form unchanged. No pin edited. Commit
  `fix(recurring): one charge per period without an anchor`. **Checks:** fast tier on write; `npx jest src/recurring
  src/screens/forms/transaction-form/recurring-mark-field src/screens/settings/recurring-charges
  src/screens/settings/recurring-series src/navigation/settings-stack --maxWorkers=2` (includes
  `detection.performance.test.ts`), output in a file; add one case to the performance suite only if it has none with a dense
  marked key (the daily shop's 500 rows marked monthly), its bound measured, not typed; `make jest-affected BASE=<step 4/9
  commit>` (exit 3: say so).
- [x] **step 6/9 Re-review (kiko:reviewer).** Done: APPROVE at bcffe67b7. Diff from step 3/9's tip. Top questions: does every world of spec 8.3's table
  hold (the reviewer reruns its probe `p1.test.ts` against the new rule); is the DP's predecessor window exact (the
  "within half a step of the latest past-floor one" argument; a 15,000-case brute force found 0 mismatches), or can it
  miss a tie; does any reader still see a dropped charge; is the
  tapped row dropped only where spec 8.3 "The tapped row" says?
- [x] **step 7/9 Drift and Scribe (kiko:retrospect, kiko:scribe).** Done: the `docs(recurring): the no-anchor rule in the skill, spec and plan` commit. kiko-domain's mark rules ("A mark's chain ... The chain's
  charges are the series"): the bullet a6a7a55aa added says "at most one charge per period slot"; reword it to the
  redesigned rule (kept charges more than half a step apart, near amounts first, no anchor). Report the sha or "no drift
  found".
- [ ] **step 8/9 Verify.** The coordinator queues `bash scripts/job-queue.sh verify <worktree> 1.4-recurring-visual-2-task-6`
  once at the end, rerun until green. No agent runs `make verify`, `check:all` or full jest. Mutation gates are paused by the
  user; if lifted, one gate for this set, `KIKO_MUTATION_BASE` = this set's own base.
- [ ] **step 9/9 Ready, device items held.** READY FOR VERIFY, label `1.4-recurring-visual-2-task-6`. Device (next build):
  the user's own marked series shows one charge a month; its count, "All paid so far", last charge and date line agree; the
  extra rows read "Not marked" (disabled) in the form; a second same-vendor subscription, if the ledger holds one, shows as
  its own row.

---

### 1.4-recurring-visual-2 task 7/7: plain period lines without "Marked:"

A marked series, or one with no day, shows the plain period line ("Weekly", "Monthly", "Yearly",
"Every 3 months", "Every 6 months"); `recurringCharges.marked.*` is removed and
`recurringCharges.markedEmptyHeading` stays. Texts: `.superpowers/sdd/1.4-recurring/texts-no-marked-prefix.md`.

- Done: pins 9a5c67d38.
- Done: code 3dcc36ccf.
- Done: review APPROVE.
- Done: minors 7125ce3b4.
- Done: docs (the `docs(recurring): plain period lines without "Marked:" in the spec` commit).

---

### 1.4-recurring-visual-2 task 8/8: one row for a card switch between currencies

**M is 8 since 2026-11-07** (was 7). **Spec:** section 19 (USER 2026-11-07, option B; 19.1 the `was` table, 19.2 the date
test, 19.3 the joined row, 19.4 route, Back and hide, 19.5 totals, 19.6 the page, 19.7 the matrix, 19.8 the overnight
defaults), and the pointers in 4, 5.4, 8.1, 9.3, 18.2, 18.3. **Base:** the branch tip holding the commit `docs(recurring): one
row for a card switch between currencies`; re-grep every symbol below on it (no line numbers here). **Run-log gaps:** closes
none, leaves all open; none names the recurring list. **Texts:** none. The "All paid so far" lines are stacked `MoneyText`s
under the existing `recurringCharges.paidSoFar`, with no separator and no new key (spec 19.6); the developer adds no text.
**Files (floor 12; mutable floor 4: `card-switch.ts`, `use-recurring-series.ts`, `recurring-groups.ts`,
`recurring-series.screen.tsx`):** new `src/recurring/card-switch/{card-switch.ts,index.ts,card-switch.test.ts}`,
`src/recurring/detection/detection.types.d.ts`, `use-recurring-series.ts` and `use-recurring-series.test.tsx`,
`recurring-groups.ts` and `recurring-groups.test.ts`, `recurring-series.screen.tsx`, `recurring-series.styles.ts`,
`recurring-series.screen.summary.test.tsx`, `recurring-series.screen.test.tsx`, `recurring-charges.screen.groups.test.tsx`, and
kiko-domain's recurring rules (drift step). No migration, column, seed or text key: no 1.2-upgrade world is touched.
**Not "existing suites green unchanged":** no expectation is known to change at 688d0349d (the two-currency worlds found, the
marks navigator's "Apple" UAH and USD in `recurring-charges.screen.marked-flows.test.tsx` and the series screen's
`netflix-9` USD fixture, run at the same time or through a mocked hook); the qa greps every `USD`/`EUR` world of the hook,
list and series screen suites and of `src/test-support/marked-series*`, and any that now joins is a named edit with its `was`
line; any other edited expectation is reported, not made. `detection.test.ts`, `detection.one-per-slot.test.ts` and
`marked-series.test.ts` stay unedited (detection and marks do not change).

**Interfaces.**

```ts
// @kiko/recurring/detection (detection.types.d.ts)
export type SeriesPart = { id: string; currency: Currency; chargeIds: readonly string[] };
// RecurringSeries gains, optional:
//   parts?: readonly SeriesPart[]; // set only on a joined row, newest part first

// @kiko/recurring/card-switch: spec 19.2 and 19.3
export const cardSwitchesJoinedOf: (
  detected: readonly RecurringSeries[], // the shown detected series; none is marked
  chargeGroups: ChargeGroups, // reads each series' first charge time (the charge with id series.id)
) => RecurringSeries[]; // sorted byNewestCharge

// @kiko/recurring/recurring-groups: spec 19.6; paidSoFarOf is unchanged
export const paidSoFarByCurrencyOf: (
  series: RecurringSeries,
  rows: readonly ChargeRow[],
) => Money[]; // one per part, newest first; one for a series with no parts
```

`cardSwitchesJoinedOf` groups by `[merchantKey, period]`, and joins a group only when it has two or more series, no two share a
currency, and, sorted by first charge time then id, each `startOfLocalDay(lastChargeTime)` is below the next one's
`startOfLocalDay(first charge time)`; else the group's series pass through as they are. The joined row's fields exactly as spec
19.3's table. `paidFromRowsById` takes `{ currency, chargeIds }` so `paidSoFarOf` and `paidSoFarByCurrencyOf` share it (one sum
rule). In `useRecurringSeries` the detection memo also computes `cardSwitchesJoinedOf(detected, groups)`, and with nothing marked
`series` is that array itself (a hide still hands the screens the array it handed them before); with marks, `series` is
`cardSwitchesJoinedOf(detectedBesideMarked(detected, marked.series), groups)`. Update the hook's doc comment. In
`seriesOfRoute`, `isOfRoute` also matches when any of `candidate.parts` holds the route's currency (spec 19.4); update its
comment. The "All paid so far" value renders one `MoneyText` per `paidSoFarByCurrencyOf` entry in a right-aligned column (a new
`recurring-series.styles.ts` key). `recurringGroupsOf`, `openSeries`, the list row and the hide writes are not edited.

**Named edits:** none known at 688d0349d; the qa's grep above decides, each with `was` / `now` in its commit body.

| Pin (new unless named) | was | now |
|---|---|---|
| `card-switch.test.ts`, one `it.each` table over spec 19.2's worlds (a card switch; a one-day gap; the same local day; an overlap; three currencies; an overlap in a chain of three; two series in one currency; two periods), each row's shown ids and parts | n/a (no join) | spec 19.2's result column |
| Property in `card-switch.test.ts`: deep-equal output for any input order (`sweep`, `seededRandom`; no new helper) | n/a | holds |
| Property: no charge id is in two shown series, and the shown ids are exactly the input's (nothing dropped) | n/a | holds |
| Hook: a card-switch ledger gives one `series`; a marked UAH chain beside a later USD series gives the marked one and the USD one apart | two `series` | one; two |
| Hook: a hide hands the same `series` array (the existing referential pin, if any, re-read on a joined world) | same array | same array |
| `recurring-groups.test.ts`: a joined row counts once in its group and "Sum of last charges" (spec 19.5's 415 UAH, not 815) | 815 UAH over two rows | 415 UAH, one row |
| `recurring-groups.test.ts`: `paidSoFarByCurrencyOf` gives `[50.00 USD, 2 000.00 UAH]` for the example, one `Money` for a plain series | n/a | as stated |
| `recurring-charges.screen.groups.test.tsx`: the card-switch ledger shows one row (10.00 USD, the newest part's category group) and the total once | two rows, total of both | one row, total once |
| `recurring-series.screen.summary.test.tsx`: the joined page lists both currencies' charges newest first, count = all, `recurring-series-summary-paid` holds "50.00 USD" and "2 000.00 UAH", in that order | n/a | as stated |
| `recurring-series.screen.test.tsx`: the joined route opens by its id; a route on the old part's currency finds the joined row; after an overlap splits it, the route's fallback finds the one USD series; two candidates still give the neutral text | n/a | spec 19.4 |
| A hide on a joined row (footer, with confirm) leaves no row of the key | two rows leave | one row leaves |

Merge of next 851db0d18 at 2545ea4eb carried `scheme: 'dark'` into marked-series.test.ts:227.

- [x] **step 1/6 (kiko:qa): red pins.** Done: 09a5e5332. The new rows above, in existing suites and world builders
  (`src/test-support/recurring-ledger.ts`'s `monthly`), one new file only (`card-switch.test.ts`); it imports
  `@kiko/recurring/card-switch`, so the qa commits a stub module exporting `cardSwitchesJoinedOf` as the identity
  (memory: qa-no-red-commit-importing-missing-modules) and `paidSoFarByCurrencyOf` as `[paidSoFarOf(...)]`, both marked for
  the developer. Each red shown failing on the base for the stated reason (counts in the report); guards (the overlap, the same
  local day, the marked world, two in one currency) green on the base and each shown failing once by a scratch mutant (join
  without the day test; join marked series). `was` values from a base run, never typed. Commit `test(recurring): one row for a
  card switch between currencies`. **Check:** `npx jest src/recurring/card-switch src/recurring/use-recurring-series
  src/recurring/recurring-groups src/screens/settings/recurring-charges src/screens/settings/recurring-series --maxWorkers=2`,
  output in a file; reds only where named. **`check:dup`:** rows in existing tables; read the touched tests' rows in
  `scripts/checks/dup-ceilings.tsv`; a ceiling never rises.
- [x] **step 2/6 (kiko:developer): the join.** Done: 076a5132a, registry 5043ae350. The interfaces above, in `detection.types.d.ts`, `card-switch.ts`,
  `use-recurring-series.ts`, `recurring-groups.ts`, `recurring-series.screen.tsx`, `recurring-series.styles.ts`. No pin
  edited; no text added. Commit `feat(recurring): one row for a card switch between currencies`. **Checks:** fast tier on write;
  `npx jest src/recurring src/screens/settings/recurring-charges src/screens/settings/recurring-series
  src/screens/forms/transaction-form/recurring-mark-field src/navigation/settings-stack --maxWorkers=2` (includes
  `detection.performance.test.ts`), output in a file; `make jest-affected BASE=<step 1/6 commit>` (exit 3: say so, the named
  set stands); `npm run check:knip` reads the stub gone and `paidSoFarOf` still used.
- [x] **step 3/6 Review (kiko:reviewer).** Done: APPROVE at 5043ae350; pin gaps 152e55b3c, nits ac8c3f4ec. Diff from the set base. Top questions: does any reader still count or sum an older
  part (totals, group, category, stopped line, row amount)? Is the join order independent and all or nothing exactly as
  spec 19.2 (the local-day test, distinct currencies, the first charge read from `ChargeGroups`)? Can a marked series or a
  series a marked chain took ever join? Does the hook still hand the same `series` array after a hide? Is `seriesOfRoute`'s
  parts match unable to pick another merchant's series? Are the test edits only the named ones?
- [x] **step 4/6 Drift and Scribe (kiko:retrospect, kiko:scribe).** Done: the `docs(recurring): the card switch join in the skill and plan` commit. kiko-domain's recurring rules: a series is one key and
  currency in detection; the screens join a card switch (spec 19). Report the sha or "no drift found".
- [ ] **step 5/6 Verify.** The coordinator queues `bash scripts/job-queue.sh verify <worktree>
  1.4-recurring-visual-2-task-8` once at the end, rerun until green. No agent runs `make verify`, `check:all` or full jest.
  Mutation gates are paused by the user; if lifted, one gate for this set, `KIKO_MUTATION_BASE` = this set's own base.
- [ ] **step 6/6 Ready, device items held.** READY FOR VERIFY, label `1.4-recurring-visual-2-task-8`. Device (next build): a
  name paid from a UAH card then a USD card shows one row with the USD amount; its page lists both, "All paid so far" shows one
  line per currency; a name paid in two currencies at the same time stays two rows. The overnight defaults of spec 19.8 go to
  the user with the device call.

### 1.4-recurring-visual-2 task 9/9: keep the tapped row

**Spec:** 8.2 "Store" (the optional `transactionId`), 8.3 key 0, "The tapped row", the key 0 table, section 11's two new rows.
**User ruling 2026-11-07:** "Keep tapped row" (was: the overnight default "a marked series can drop the tapped row"); the
16-day monthly floor, the disabled "Not marked" on a dropped row and the four currency-merge defaults KEEP. **Base:** the
branch tip holding `docs(recurring): keep the tapped row in a marked chain` (re-grep every symbol below on it; no line numbers
here). **Run-log gaps:** closes none, leaves all open; none names the marked chain. **Files (floor 13; mutable floor 4:
`detection.ts`, `marked-series.ts`, `recurring-merchant-choices.ts`, `recurring-mark-field.ts`):** those four,
`detection.types.d.ts`, `detection.one-per-slot.test.ts`, `marked-series.test.ts` (or its world tables in
`src/test-support/marked-series-chain-worlds.ts` / `marked-series-worlds.ts`), `settings.repo.test.ts`,
`restore-recurring-merchant-choices.test.ts`, `recurring-mark-field.component.test.tsx`,
`transaction-form.recurring-mark.test.tsx`, `use-row-mark.test.tsx`, kiko-domain's mark rules (drift step), and any other
suite whose `markRecurringCharge` call expectation names the mark (grep `markRecurringCharge).toHaveBeenCalledWith` first; the
count is a floor). `settings.repo.ts`, `use-row-mark.ts` and `recurring-mark-field.component.tsx` need no code edit
(`setRecurringChainPeriod` spreads the stored mark, so it keeps the id; `markRecurringCharge` stores the mark it is given;
`removeRecurringMarks` matches by `isSameChain`; the component passes `existing`, which holds `id`): the developer confirms
each by reading, and a doc comment may change. No migration, no column, no text key, no seed, no `EXPORT_VERSION` change: no
1.2-upgrade world is touched (the column is JSON, and a mark without the id reads as today). **Not "existing suites green
unchanged":** each edit below is named with its `was`; any other edited expectation is reported, not made.

**Interfaces.**

```ts
// @kiko/recurring/detection, detection.types.d.ts
export type RecurringMark = {
  currency: Currency;
  amountMinorUnits: number;
  period: RecurringPeriod;
  // The row the mark was tapped on (spec 8.3 key 0); absent on every mark written before. Never part of the
  // mark's identity: `isSameChain`, the dedupe, `compareMarks` and the removal ignore it.
  transactionId?: string;
};

// @kiko/recurring/detection: was (charges, period, storedAmounts)
export const onePerSlotOf: (
  charges: readonly Charge[],
  period: RecurringPeriod,
  storedAmounts: readonly number[],
  tappedIds?: ReadonlySet<string>, // default: an empty set, so every id-less caller and pin reads as today
) => { kept: Charge[]; dropped: Charge[] };

// recurring-mark-field.ts: was row: { amountMinorUnits: number; description: string }
type MarkWrite = { row: { id: string; amountMinorUnits: number; description: string }; /* rest unchanged */ };
```

- `onePerSlotOf`: `RunScore` gains a first key, the negated count of kept charges whose id is in `tappedIds` (5 keys, was 4);
  the seed run and the predecessor step add `-Number(tappedIds.has(id))` the same way `near` is added. `compareScores`,
  `predecessorIndexesOf` and the `<=` ties are unchanged (spec 8.3 "The computation": the window stays exact under key 0).
  Update its doc comment ("Of all such runs the kept one holds the most tapped rows, then ...").
- `marked-series.ts` `chainsOfCharges`: pass `new Set(piece.marks.flatMap(({ transactionId }) => transactionId === undefined ?
  [] : [transactionId]))` as the fourth argument. One builder still serves `chainsOfEntry` and `markedChainOfAmount`
  (fix-divergent-twins), so the series and the form's `holdsRow` agree.
- `recurring-merchant-choices.ts` `markOf`: keep `transactionId` when it is a non-empty string, else build the mark without it
  (the mark is never dropped for it). `marksOf` dedupes by `currency:amount` as now and keeps the kept mark's id; `isSameChain`
  is unchanged (its doc comment says the id is ignored). `recurringChoiceOf` unchanged.
- `writeMark`: the new mark adds `transactionId: row.id`; the period rewrite and the removal paths unchanged.

**Named edits, each with its `was` line in the qa commit body** (the qa walks every cell by spec 8.3's key 0 table and
reports any disagreement, never edits to green):

| Pin | was | now |
|---|---|---|
| `markRecurringCharge` call expectations in `recurring-mark-field.component.test.tsx` and `transaction-form.recurring-mark.test.tsx` (floor 6 sites) | `{ currency, amountMinorUnits, period }` | the same plus `transactionId: <the tapped row's id>` |
| `detection.one-per-slot.test.ts` table rows, `marked-series` matrix rows and `markedChainOfAmount` cases | marks without an id | unchanged: they are the id-less case of spec 8.3 (world A at 102 keeps `holdsRow: false` on 12 Oct) |
| New `onePerSlotOf` rows (a `tappedIds` column, empty on the old rows) | none | spec 8.3's key 0 table, each row with its kept and dropped ids |
| New `marked-series` rows with a `transactionId` on the mark | none | world A at 102 tapped 12 Oct: x6, last charge 12 Oct at 102, `markedChainOfAmount` `holdsRow: true` on 12 Oct and `false` on 5 Oct; the FX world tapped 21 Jun; the key-2 world |
| `settings.repo.test.ts` parser and writes | no id field | a mark with an id round-trips; a bad id (number, `''`, object) reads the mark without it; two stored marks of one chain with two ids read as one mark (the earlier period's, with its id); `setRecurringChainPeriod` keeps the id; `removeRecurringMarks` with an id-less chain removes an id-holding mark; `markRecurringCharge` on a stored chain with another id leaves one mark |
| `restore-recurring-merchant-choices.test.ts` | marks without an id | a mark with an id restores with it; a file mark with a bad id restores without it |

- [ ] **step 1/6 (kiko:qa): red pins.** The named edits and new rows above, in the existing tables and describes (no new
  file, no new helper copy). Properties in `marked-series.test.ts` with `sweep` and `seededRandom` (no new helper): on random
  ledgers, one mark tapped on a random charge of its piece keeps that charge; deep-equal for any input order with ids; a mark
  without an id gives the same result as the same mark with an id that matches no charge. Each red shown failing on the base
  for the stated reason (counts in the report); `was` values copied from a base run, never typed. Commit
  `test(recurring): keep the tapped row in a marked chain`. **Check:** `bash scripts/wait-load.sh 15`, then `npx jest
  src/recurring/detection/detection.one-per-slot src/recurring/marked-series src/recurring/use-row-mark src/settings
  src/data-transfer/snapshot/restore-recurring-merchant-choices src/screens/forms/transaction-form/recurring-mark-field
  src/screens/forms/transaction-form/transaction-form.recurring-mark --maxWorkers=2`, output in a file; reds only where
  named. **`check:dup` (at AC):** rows in existing tables; read the touched tests' rows in `scripts/checks/dup-ceilings.tsv`;
  a ceiling never rises.
- [ ] **step 2/6 (kiko:developer): key 0 and the id.** The interfaces above, in `detection.types.d.ts`, `detection.ts`,
  `marked-series.ts`, `recurring-merchant-choices.ts`, `recurring-mark-field.ts`. No pin edited; no text added. Commit
  `feat(recurring): keep the tapped row in a marked chain`. **Checks:** fast tier on write; `bash scripts/wait-load.sh 15`,
  then `npx jest src/recurring src/settings src/data-transfer/snapshot/restore-recurring-merchant-choices
  src/screens/forms/transaction-form/recurring-mark-field src/screens/forms/transaction-form/transaction-form.recurring-mark
  src/screens/settings/recurring-charges src/screens/settings/recurring-series --maxWorkers=2` (includes
  `detection.performance.test.ts`; its bound is not raised), output in a file; `make jest-affected BASE=<step 1/6 commit>`
  (at AC; exit 3: say so, the named set stands); `npm run check:knip` (at AC).
- [ ] **step 3/6 Review (kiko:reviewer).** Diff from the set base. Top questions: does key 0 reach both `chainsOfEntry` and
  `markedChainOfAmount` through the one builder? Is the predecessor window still exact with key 0 (spec 8.3 "The
  computation"; a brute force over small random worlds with tapped ids, as the step 6/9 review of task 6/6 did)? Can an id
  ever split or duplicate a mark (parser dedupe, `isSameChain`, the three writes)? Does a bad or stale id ever drop a mark or
  throw? Are the test edits only the named ones?
- [ ] **step 4/6 Drift and Scribe (kiko:retrospect, kiko:scribe).** kiko-domain's mark rules: "A mark stores the absolute
  stored amount and the currency ..." gains the optional tapped-row id (never part of the mark's identity); "A marked chain
  keeps charges more than half a step apart ..." gains "the mark's tapped row first". `make doc-suites` (at AC). Report the
  sha or "no drift found".
- [ ] **step 5/6 Verify (coordinator, at AC).** The coordinator queues `bash scripts/job-queue.sh verify <worktree>
  1.4-recurring-visual-2-task-9` once at the end, on the charger, rerun until green. No agent runs `make verify`, `check:all`
  or full jest. Mutation gates are paused by the user; if lifted, one gate for this set, `KIKO_MUTATION_BASE` = this set's own
  base.
- [ ] **step 6/6 Ready, device items held.** READY FOR VERIFY, label `1.4-recurring-visual-2-task-9`. Device (next build):
  mark a row that has a near-amount charge less than half a month from it: that row stays in the series and the other reads
  "Not marked", disabled. The user's existing marks hold no id and read as before; to apply key 0 to one, "Remove mark" and
  mark the row again (say so in the device call).

## Mutable file counts (floors; `make mutable` measures; the cap is 30)

| Task | Floor |
|---|---|
| 1/4 | 13 (the demo test and seed are not app code; `make mutable` decides) |
| 2/4 | 6 |
| 3/4 | 6 |
| 4/4 | 12 (was 11): `marked-series.ts`, `use-row-mark.ts`, `recurring-mark-field.component.tsx`, `detection.ts`, `eligibility.ts`, `recurrence-text.ts`, `use-recurring-series.ts`, `settings.repo.ts`, both Settings screens, `transaction-form.screen.tsx`, `help-topics.ts` |
| visual-1 task 1/3 | 6 (listed in its Files) |
| visual-1 task 2/3 | 5 (was 4; `exchange-fields.component.tsx` joins, P3 B; listed in its Files) |
| visual-1 task 3/3 | 4 (listed in its Files) |
| visual-2 task 1/5 | 2 (listed in its Files) |
| visual-2 task 2/5 | 4 (was 6; listed in its Files) |
| visual-2 task 3/5 | 1 (listed in its Files) |
| visual-2 task 4/5 | VOID (merged into 2/5) |
| visual-2 task 5/5 | the fix set's own files, measured |
| visual-2 task 6/6 | 4 (listed in its Files) |
| visual-2 task 8/8 | 4 (listed in its Files; `recurring-series.styles.ts` may make it 5: `make mutable` decides) |
| visual-2 task 9/9 | 4 (listed in its Files) |

Mutation gates are paused by the user; this table is for a lift.

## Not in the tasks

A forecast, a reminder, a total, a detected period beyond the three, an edit of Statistics, an edit of `merchantNameOf`, a change to `category`, a column on `transactions`. What's New goes in App Store Connect at release (spec 14), and Notes for Review through the release skill.

## If a dependency changes

- **If `1.4-category-automation` loses B3:** spec 3: its steps for `merchant-name.ts` move into task 1/4 as first caller. Never a copy.
