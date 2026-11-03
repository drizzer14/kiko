# Recurring Charges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings entry lists the charges that repeated in the user's own rows, with the recurrence date and links to every past charge, and a transaction can mark a charge the rule missed. No forecast of any kind.

**Architecture:** One pure function (`detectRecurringSeries`, injected `now`) over a narrow read of the whole ledger, behind one hook shared by two screens in the Settings stack. It writes nothing. The only stored item is a nullable settings column, one map of merchant keys to a hide or a mark. Names group by `merchantNameOf`, imported, never copied.

**Tech Stack:** React Native, Hermes, op-sqlite (SQLCipher), Drizzle, react-native-unistyles, i18next, ts-pattern, jest with `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-11-03-recurring-design.md`. Refer to it by section; this plan does not copy it, except the world matrix, whose rows are the contract ("The matrix" below). Every count here is a floor: the developer measures. Every code fact names a symbol, not a line: re-grep each fact on the actual base before building on it.

## User ruling and the fundamentals point

Relayed by the coordinator on 2026-11-03, for all 1.4 tracks: "For each feature, build the fundamentals first, then we can iterate fast on visuals and whatnot". The coordinator defines fundamentals as: the feature works end to end with correct data. Visual finish comes after, in fast rounds with the user on a device. Checks, verify, review and data correctness do not change. A feature still ships complete in the release, with nothing hidden.

**Fundamentals done: the tip of task 4/4 (step 14/14), the required device call for this feature.** Detection, the reversible hide and the mark are all in the user's Q2 answer, and a false match has no removal before task 3/4 (spec 15). No set is visual-only: apart from review, drift and Ready steps, every step of tasks 1/4 to 4/4 holds behavior, correct data or text the feature needs, so no step moved. Each set's device items wait for that call; its review and Ready do not. Visual finish follows in fast rounds, each with the same checks.

**An optional look before the point, not the point:** at task 2/4's tip, a release build on the user's real ledger shows detection on their history and gives spec 10.3's numbers early (a stall's fix, spec 10.4, changes that read). The coordinator decides whether to offer it, and task 3/4 does not wait for it.

## User answers

Relayed by the coordinator on 2026-11-03; the spec's head quotes them. Q1: "Charged monthly, on day 15" + "Last charge 15.10.2026". Q2: "1 + mark as recurring on transaction itself" (task 4/4). Q3: "Settings row, in the same group as categories" (task 1/4 steps 9 and 10). Q4: the demo seed changes so that five bills show (S14).

**Still assumed, NOT approved:** Q5 = A, a mark covers every charge with that merchant name (spec 16). See "If the user answers differently" at the end. Q5 must be answered before task 3/4 starts: C settles that set's column shape, and A or B leave tasks 1/4 to 3/4 as written.

**Measurement:** spec section 10.2 holds it. It comes from node with JIT and sqlite3 with no encryption, so no device figure exists: the look at task 2/4's tip records one, or else the call at the fundamentals point. The K of the counted pin is set from its own first run. Marks do not change detection's input or rule, so the reference is not re-run. Base of this plan's facts: 5256bf465 for Settings, the demo seed and task 4/4; c9896e1f9 for the rest.

**One release:** the four sets merge into `next` one at a time and `next` tolerates each middle state, but a release holds all four or none: hide is the remedy for the accepted yearly false match, and the user asked for the mark with the rest (spec 15).

## Global Constraints

- No next charge date, no reminder, no amount prediction, no projected total, no sum of any kind, in any output or text. No output date has a local day later than today. Stopped steps back from `now`, never forward from a charge (spec 6, 7).
- `merchantNameOf`, `merchantSpellingOf`, `smallestSpelling` come from `@kiko/transactions/merchant-name` (category plan read at branch tip 71de98891, where that folder does not exist yet; re-grep). No copy, no wrapper with other rules, no local normalizing (spec 3).
- Eligibility calls the existing functions (`rowsForTransferMatch`, `internalTransferTransactionIds`, `mccExcludedTransferTransactionIds`, `descriptionExcludedTransferTransactionIds`, `exchangeFundingMatches`, `ibanOf`). No MCC, wording or marker list of its own beyond the structural fields of spec 4.
- Never sum or compare across currencies; the group key holds the currency.
- Detection writes nothing. A mark writes one settings entry, never a transaction column; a mark overrides no exclusion of spec 4.
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
5. A file with a malformed `recurringMerchantChoices` (array, number, wrong value type, an entry with an unknown kind or period). Expected: reads as no choice, or drops that entry alone, no crash, the next write stores only good entries. Pinned in tasks 3/4 and 4/4.
6. The form opened by a series link: a mark set or removed there, then Back to a series whose result changed. Expected: spec 9.3's lookup order; never a detected series under a marked key, never a guess. A route opened on a marked series skips the `seriesId` step, since that id is the earliest charge of the whole key. Pinned in task 4/4.
7. A mark on a row the form cannot see is excluded (a matched own transfer). Expected: the row stays out of the series, and an entry with no charges shows under "Marked, No Charges", removable. Pinned in task 4/4.

## Details settled by this plan

| # | Decision | Reason |
|---|---|---|
| S1 | New feature folder `src/recurring/`, one folder per unit with its barrel: `eligibility`, `detection`, `recurrence-text`, `use-recurring-series`. | The hook is shared by two screens, which may not import each other; `src/statistics` must not gain a non-statistic; `src/transactions` importing `src/statistics` is avoided. |
| S2 | `seriesId` = id of the earliest charge by (time, id); list key the same. Route params hold `{ seriesId, merchantKey, currency, period, name }`. A miss on `seriesId` takes the series with the same `merchantKey`, `currency` and `period` only when there is exactly one. Task 4/4 adds an optional `isMarked?: boolean` to the params, absent reading as false, and a route with it true skips the `seriesId` step (spec 9.3). | Params are JSON; a whole id list stays out of params. Two monthly Apple series must not be guessed between. Spec 9.3. |
| S3 | Shown name: `smallestSpelling` over the series' `merchantSpellingOf` values. `merchantSpellingOf`'s comment, which says `nameStartsWith` text only, is widened in task 1/4 step 4. | One spelling, order-free, the category plan's S1 pick. A cut prefix: a series crosses store numbers. |
| S4 | The narrow query selects: `id, holdingId, amountMinorUnits, time, description, mcc, counterIban, categorySetByHand, setsBalance, changeGroupId, exchangePairId, exchangeCounterpartHoldingId, untrackedCounterpart, loanHoldingId, source`. No `where`, no `orderBy`. | The matchers need both signs and blank rows (spec 10.1); the function sorts by itself, so an order would only cost. |
| S5 | `newestRowTimeByHolding` is computed in the one pass over the read, before any filter but the local-day one: a row later than today is no activity. `stoppedCutoff(period, now)` is one function; `isStopped` compares the last charge to it, and `quiet` compares that holding's newest row to it. | Spec 7: a row of either sign counts, one cutoff for both. |
| S6 | Group key `JSON.stringify([key, currency])`. | As `groupKeyOf` in `sync-adoption.ts`. |
| S7 | Constants, all in `detection.ts`, named and exported only if a test reads them: `MONTHLY`, `YEARLY`, `WEEKLY` period records (spec 5.1); `AMOUNT_STEP = 1.25`, `WEEKLY_AMOUNT_STEP = 1.1`, `MIN_FIT_SHARE = 0.75`, `MIN_OCCUPANCY = 0.75`, `MIN_COVERAGE = 0.5`, `ONE_A_SLOT_MIN_CHARGES = 6`, `DAY_SPLIT_GAP = 3`, `TWIN_DAY_REACH = 1`, `STOPPED_GRACE_DAYS`, `LEAVES_AFTER_MONTHS = 24`, `AROUND_DAY_SPREAD = 6`. | No magic number; the matrix pins them. |
| S8 | The list and series screens are `FlatList` with `LargeTitleHeading` and `useLargeTitleScroll`, `HoldingDetail` the model. | kiko-design-system's custom list screen. |
| S9 | Sections as a flat array of `{ kind: 'heading' } / { kind: 'series' } / { kind: 'hidden' }`, not `SectionList`. | `HoldingDetail`'s flattened list; the first scroll view drives the large title. |
| S10 | The hide button is `Button` secondary in the list footer of the series screen; "Show again" a small secondary `Button` on the hidden row. No new shared component, so no `kiko:designer` step. | Reversible, so no `ConfirmSheet`. |
| S11 | A set's tasks stack in this worktree; each base is the previous tip. Task 1/4 starts from a merge of `next` holding `1.4-category-automation task 2/6`. | One editor; spec 3. |
| S12 | The choice column is generated at the journal tail + 1 of the task's base. A later-merging branch renumbers by deleting its four artifacts, merging `next` and re-running `npx drizzle-kit generate` (never a hand-edited `prevId`). No number in a test title, comment or skill. Allowed only before a build ships. | Same rule as the category plan's S6. |
| S13 | The hook returns the unfiltered `series`, `choices` from task 3/4, `markedSeries` from task 4/4, and the list filters. Its memo keys on `startOfLocalDay(now)`, and that value is the `now` detection receives. | The series screen then keeps its series between the hide write and `goBack`, with no flash of the neutral text. Back runs no detection. Spec 9.3, 9.5. |
| S14 | Demo seed: in `buildMonthlyExpenses`, a row's new field marks it as a steady bill: `Netflix`, `text.kyivstar`, `text.kyivteploenergo`, `YASNO`, `text.kyivvodokanal`. In `buildMainCardTransactions`, every other row that `buildMonthlyExpenses` gives, in odd `month` values only, sits a named constant of 10 days nearer the middle of its 30-day month (a `dayOfMonth` under 15 adds it, else subtracts it). Amount unchanged, one row a month as before, `month` 0 never moves. The same edit read in memory on the reference gives exactly those five on all 731 daily anchors; the pin decides, not this sample. | The merged seed reads 24 series and moving only `text.groceryStore` leaves 23, so a reviewer would still read ATB and Fora as subscriptions (spec 12). The row stays in its 30-day month, so `MONTHLY_INCOME_MINOR_UNITS`'s deliberate down months keep their totals. `month` 0 stays, so the default 30-day window, the README's window counts and the "12 newest rows" and "3 newest" pins of `screenshot-seed.test.ts` read the same rows. Re-read at 5256bf465: the seed folder and `build-demo-snapshot.ts` are unchanged since c9896e1f9, and the probe re-run gives 24 as merged, 23 for groceries alone, and exactly the five on all 731 anchors at each shift of 6, 8, 9, 10, 11 and 12 days. |
| S15 | The mark is a `SelectField<'none' \| RecurringPeriod>` in its own child, `RecurringMarkField`, one element between `ModeAndActions` and `CommentRow`. The child holds its own `['settings']` read, enabled only for a row it offers on. | No growth in the screen's cognitive budget; no read on a credit or a new form; no new shared component, so no `kiko:designer` step (spec 9.6). |
| S16 | `RecurringPeriod` becomes five members in task 4/4, and `DetectedPeriod` is the three detection returns. `Choice` in task 3/4 is `{ kind: 'hidden'; name }`, and task 4/4 adds `{ kind: 'marked'; name; period }` with its parser arm. | The column is a map of objects, so a kind costs no migration; no unused union member before its reader. |
| S17 | `detectRecurringSeries` splits in task 4/4 into `chargeGroupsOf(input, now)` and `seriesOfGroups(groups, now)`; the composed function keeps its signature, and every matrix pin stays unedited. `markedSeriesOf(groups, markedEntries, now)` walks the marked keys only. | A mark fires `settings` alone and must run no detection (spec 9.5). |

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
// Task 4/4, S16, S17: `period` widens; `Recurrence` gains { kind: 'marked' }; `RecurringSeries` gains `isMarked?: true`, set only by `markedSeriesOf`, absent on every detected series.
export const chargeGroupsOf: (input: RecurringInput, now: number) => ChargeGroups;
export const seriesOfGroups: (groups: ChargeGroups, now: number) => RecurringSeries[];
// RecurringInput: { rows: readonly RecurringLedgerRow[]; holdings: readonly Pick<HoldingRow, 'id' | 'accountId' | 'name' | 'currency' | 'metadata'>[]; accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[] }

// @kiko/recurring/eligibility
export const recurringExcludedIds: (rows, holdings, accounts) => ReadonlySet<string>;
export const isRecurringCandidate: (row, holding, account) => boolean; // the structural part of spec 4
export const isOfferedForMark: (row, holding, account, ownIbans, now: number) => boolean; // task 4/4: the candidate test plus the two per-row matchers, the calls `recurringExcludedIds` makes

// @kiko/recurring/marked-series (task 4/4)
export const markedSeriesOf: (groups: ChargeGroups, marked: readonly MarkedEntry[], now: number) => { series: RecurringSeries[]; withoutCharges: MarkedEntry[] };

// @kiko/recurring/recurrence-text
export const recurrenceLine: (period: RecurringPeriod, recurrence: Recurrence, t: TFunction) => string;
export const lastChargeLine: (series: RecurringSeries, t: TFunction) => string; // last charge, no charge since, or quiet

// @kiko/recurring/use-recurring-series
export const useRecurringSeries: () => { series: RecurringSeries[]; isLoading: boolean }; // unfiltered; task 3/4 adds choices, task 4/4 markedSeries and withoutCharges (S13)

// transactionsRepo
recurringLedgerQuery: () => /* S4 */;
listWithContextByIdsQuery: (ids: readonly string[]) => /* contextRowsQuery where id in, time desc */; // task 2/4

// settingsRepo (task 3/4)
hideRecurringMerchant: (key: string, name: string) => Promise<void>;
clearRecurringMerchantChoice: (key: string, kind: Choice['kind']) => Promise<void>; // removes the entry only when it holds that kind, else writes nothing. "Show again" passes 'hidden'; from task 4/4 "Remove mark" and "Not marked" pass 'marked'
recurringMerchantChoicesQuery: () => /* the one column */;
recurringMerchantChoicesOf: (stored: unknown) => ReadonlyMap<string, Choice>; // keys are user text (spec 8.1): every reader goes through this Map; a non-object reads as none; a bad entry is dropped alone
// settingsRepo (task 4/4)
markRecurringMerchant: (key: string, name: string, period: RecurringPeriod) => Promise<void>;
```

## Conflict surface

| Task | Shared files | Other tracks |
|---|---|---|
| 1/4 | `e2e/screenshot/seed/screenshot-seed.ts`, `e2e/screenshot/fixtures/README.md`, the demo `.kiko` files, `merchant-name.ts` (its comment), `settings.screen.tsx`, `settings.stack.tsx`, `src/navigation/types/types.d.ts`, `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts`, `help-topic.screen.tsx`, `entry-symbols.ts`, `transactions.repo.ts` | `1.4-small` is merged: the row goes in its group card, and its exact five-card pins stay five (spec 9.1). `1.4-category-automation` adds one route and edits the seed in its task 2/6, so regenerate the `.kiko` files on the merge. Its `buildStoreNumberTransactions` (draft name `Fora`) and later `buildSuggestionTransactions` (draft name `Aroma Kava`) add rows under merchants S14 moves: step 11's pin runs on the base that holds them |
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

## The marked matrix (the contract of task 4/4 step 1)

The same conventions; each row adds a stored entry for the world's name. The `was` of spec 8.2 is the result with no entry; these worlds also run with no entry, and that result must hold. Spec 8.2's two hidden rows and two link rows are flows with no row here: their `was` is the hide alone, or a path that needs a mark. Its `constructor` and `__proto__` rows have no row here either; their `was` is the result with no entry, and task 4/4 steps 1/14 and 9/14 pin them. Line is the recurrence line.

| World | Rows | Mark | Expected |
|---|---|---|---|
| Quarterly | 12 Jan, Apr, Jul, 10 Oct 2026 at 300 | every 3 months | one x4, line "Marked: every 3 months", not stopped |
| Half-yearly | 5 Oct 2025, 5 Apr, 5 Oct 2026 at 900 | every 6 months | one x3, line "Marked: every 6 months", not stopped |
| One charge | 15 Oct at 250 | monthly | one x1, line "Marked: monthly", last charge 15 Oct |
| Two charges | 15 Sep, 15 Oct at 250 | monthly | one x2, line "Marked: monthly" |
| Three on one day | m(3, 15, 250) | monthly | one x3, `onDay` 15, `isMarked` |
| Three on spread days | 2 Aug, 19 Sep, 28 Oct at 250 | monthly | one x3, line "Marked: monthly" |
| Yearly, one | 12 Mar 2026 at 400 | yearly | one x1, line "Marked: yearly" |
| Yearly, two | 12 Mar 2025 and 2026 at 400 | yearly | one x2, `onDate` |
| Weekly, three | 3 Mondays back from 26 Oct at 100 | weekly | one x3, line "Marked: weekly" |
| Weekly, four | 4 Mondays back from 26 Oct at 100 | weekly | one x4, line "Marked: weekly" (weekly minimum 5) |
| Weekly, five | 5 Mondays back from 26 Oct at 100 | weekly | one x5, `onWeekday` Monday, `isMarked` |
| Quarterly charges, marked monthly | 12 Jan, Apr, Jul 2026 at 300 | monthly | one x3, line "Marked: monthly" (occupancy 3/7), stopped, quiet since 12 Jul |
| A month apart, marked yearly | 20 Dec 2025, 15 Jan 2026 at 400 | yearly | one x2, line "Marked: yearly" (0 slots) |
| Monthly, one skipped | 15 Jul, 15 Sep, 15 Oct 2026 at 250 | monthly | one x3, `onDay` 15, `isMarked` |
| Monthly, moving amounts | 15 Aug at 100, 15 Sep at 300, 15 Oct at 900 | monthly | one x3, `onDay` 15, `isMarked` (no amount test) |
| Monthly fit, no honest day | 1 Aug, 5 Sep, 9 Oct at 250 | monthly | one x3, line "Marked: monthly" (days 1, 5, 9 fit, but spread 8, past section 6's 6, so no slot); with the entry removed, monthly x3, "Charged monthly" |
| Daily shop | The daily world | monthly | one of all rows, line "Marked: monthly" |
| Two detected, merged | m(10, 5, 99), m(10, 20, 399) | monthly | one x20, line "Marked: monthly"; with the entry removed, monthly x10 twice |
| Period conflict | m(12, 3, 199) | yearly | one yearly x12, line "Marked: yearly", not stopped; the yearly cutoff decides stopped |
| Stopped, by the mark's period | 3 Jan, 3 Apr, 3 Jul 2026 at 199 | every 3 months | one x3, stopped by 3 months plus 14 days, quiet since 3 Jul |
| Not stopped, one day inside | 3 Jan, 3 Apr, 21 Jul 2026 at 199 | every 3 months | one x3, not stopped |
| Quiet | The sync-dead Netflix world | monthly | stopped, quiet since 20 Aug |
| Two currencies | m(1, 3, 10) on a USD holding, m(1, 3, 400) | monthly | two x1, never summed |
| Name holding a month | "Оренда за жовтень", one row | monthly | one x1; "Оренда за вересень" stays out (Q5) |
| Twin | m(2, 2, 250), and again as `import` | monthly | one x2 |
| Future-dated manual | 15 Oct, 15 Nov 2026 as `manual` | monthly | one x1; no output day after today |
| Past the leave bound | 3 May 2024 at 300 | monthly | one x1, stopped, quiet since 3 May 2024 (the holding's only row, S5), still listed |
| Some rows excluded | m(6, 3, 700), 3 Sep and 3 Jun with `loanHoldingId` | monthly | one x4, line "Marked: monthly" (`4 / 6` is under 0.75); with no entry, none |
| Only row a matched pair | One debit with its credit | monthly | no series; in `withoutCharges` |
| Each rule, all rows excluded | One merchant per kind: exchange pair, balance set, change group, linked loan, crypto holding, cash-out MCC, own IBAN, deposit wording, funded debit, archived account, missing holding | monthly | no series; in `withoutCharges` |
| Only a future row | 15 Nov 2026 as `manual` | monthly | no series; in `withoutCharges` |
| Credits only | m(3, 3, 500) as credits | monthly | no series; in `withoutCharges` |
| No rows | None | monthly | no series; in `withoutCharges` |
| Hidden key | m(6, 3, 700) | hidden | not in `series` or `withoutCharges` |
| Any world above, rows shuffled, or under `withDeviceZoneOffset` | | | The same result |

---

## 1.4-recurring task 1/4: detection and the list

**Goal:** the Settings row, the list with its sections, the recurrence text, the empty state, and a demo file a reviewer can read. Rows do not open yet. **Needs:** `1.4-category-automation task 2/6` on `next`. **Base:** a merge of that `next` into this branch.

**Files (floor 46, tests included: 18 + 5 + 21 + 2 regenerated, counted from the lists below; mutable 13; the developer measures).**
- Create: `src/recurring/eligibility/{eligibility.ts,index.ts,eligibility.test.ts}`; `src/recurring/detection/{detection.ts,detection.d.ts,index.ts,detection.test.ts,detection.performance.test.ts}`; `src/recurring/recurrence-text/{recurrence-text.ts,index.ts,recurrence-text.test.ts}`; `src/recurring/use-recurring-series/{use-recurring-series.ts,index.ts,use-recurring-series.test.tsx}`; `src/screens/settings/recurring-charges/{recurring-charges.screen.tsx,recurring-charges.styles.ts,index.ts,recurring-charges.screen.test.tsx}`; `src/screens/settings/recurring-charges/recurring-series-row/{recurring-series-row.component.tsx,recurring-series-row.props.d.ts,recurring-series-row.styles.ts,index.ts,recurring-series-row.component.test.tsx}`
- Modify: `src/transactions/repo/transactions.repo.ts` plus a real SQLite pin, `src/navigation/settings-stack/settings.stack.tsx` and its test, `src/navigation/types/types.d.ts`, `src/navigation/entry-symbols/entry-symbols.ts` and its test (its exact `toEqual`), `src/screens/settings/settings/settings.screen.tsx` and its test, `src/i18n/locales/{en,uk,title-keys}.ts`, `src/help/help-topics.ts` and its test (`TOPIC_TITLES`), `src/screens/settings/help-topic/help-topic.screen.tsx` and its test (its per-action table), `src/transactions/merchant-name/merchant-name.ts` (one comment), `__tests__/property-sweep-sites.test.ts` (its exact list, for step 3's property test)
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
- Create: `src/screens/settings/recurring-series/{recurring-series.screen.tsx,recurring-series.styles.ts,index.ts,recurring-series.screen.test.tsx,recurring-series.navigator.test.tsx}`
- Modify: `recurring-series-row/` (component, props, test) and `recurring-charges.screen.tsx` and its test (pressable), `transactions.repo.ts` plus a real SQLite pin, `settings.stack.tsx`, `types.d.ts`, `en.ts`, `uk.ts`, `help-topics.ts` and its test (`chargeCount` lands here, its first user)

**Acceptance:** every charge in `chargeIds` is one row, newest first, and opens `TransactionForm { transactionId }`; synced rows open read-only, manual rows editable (the form's own rule); back walks form, series, list; on two panes all three stay in the detail pane; a miss on `seriesId` follows S2.

- [ ] **step 1/8 (kiko:qa): query pin.** `listWithContextByIdsQuery`, real SQLite: returns exactly the ids, newest first, through `contextRowsQuery`'s shape; more ids than `IN_CLAUSE_CHUNK_SIZE` read in chunks (the existing chunk helper); a deleted holding's rows absent. Red. Commit `test(transactions): context rows by id`.
- [ ] **step 2/8 (kiko:developer): query.** Green, named file. Commit `feat(transactions): context rows by id`.
- [ ] **step 3/8 (kiko:qa): screen pins.** `recurring-series.screen.test.tsx`: header with recurrence line, last-charge line and `chargeCount` at 1, 2, 5, 21 in both languages; rows newest first with the date in the trailing slot; a tap calls the pane opener with `TransactionForm` and that `transactionId`; a miss on `seriesId` with exactly one series of the same `merchantKey`, `currency` and `period` shows that series; with none, and with two (two monthly Apple series), `EmptyState` with the `listChanged*` text, no other series, and no word about the merchant; the earliest charge deleted while the series still lists keeps the series on screen; a charge deleted in a live fire drops from the list; loading gated on `isLoading`. List test gains: a tap opens `RecurringSeries` with all of S2's params. Commit `test(settings): recurring series screen`.
- [ ] **step 4/8 (kiko:developer): screen.** S8. Shared `TransactionCard`, `transactionRowDescription`, `resolveCategoryDisplay`, `resolveCategoryColor`, `accountDisplayName` for the footer (an implicit account never by its raw name). Route `RecurringSeries: { seriesId: string; merchantKey: string; currency: Currency; period: RecurringPeriod; name: string }` (S2), title from `route.params.name`, set to the merchant's text, not translated. Help step 3, `chargeCount_*` and the `listChanged*` keys in both catalogues. Run named files. Commit `feat(settings): recurring series and its links`.
- [ ] **step 5/8 (kiko:qa): navigator pins.** `recurring-series.navigator.test.tsx` with `navigator-stack-probe`: single mode: list to series to form, back twice; split mode: all three in the detail pane, Settings stays in the list pane, the menu row stays marked; a fold keeps the route and its params; the form opened this way for a manual row saves and returns (the path the Settings stack did not have). Green at once is acceptable when the pane rule already holds: show the run, and prove one pin by a temporary wrong route name. Commit `test(navigation): series links in the Settings stack`.
- [ ] **step 6/8 Review (kiko:reviewer).** Top question: can a link open the wrong transaction after a live refresh?
- [ ] **step 7/8 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-architecture "Pane navigation" only if a rule changed; route lists. Report the sha or "no drift found".
- [ ] **step 8/8 Ready, device items held.** No required device call here: the look at this tip is optional, the coordinator decides whether to offer it, and task 3/4 does not wait for it. Held for task 4/4 step 14/14, the required call, the real-ledger items for that look if it is taken: a tap on a charge opens the right transaction, synced read-only, manual editable; back order on phone, iPad, unfolded and folded Duo; the two-pane look; on a release build on the real ledger, the report records its row count and the time from opening a series (a second whole-ledger read plus detection, spec 10.3) to the series showing, and the user names any stall there or on Back (fix path spec 10.4). Label `1.4-recurring-task-2`.

---

## 1.4-recurring task 3/4: hide a false match

**Goal:** "Not a recurring charge", the "Hidden" section with "Show again", the stored choice map and its restore paths. **Needs:** task 2/4 and the user's answer to Q5. **Base:** task 2/4 tip. The one migration of this track; task 4/4 reuses the column.

**Files (floor 34 plus the generated `.sql` and snapshot, counted from the lists below and the upgrade worlds; mutable 6, `schema.ts` among them).**
- Create: the migration `.sql` and its snapshot (generated by `npx drizzle-kit generate`), its test `drizzle/migrations/<tag>.test.ts` by hand, `src/data-transfer/snapshot/restore-recurring-merchant-choices.test.ts`
- Modify: `src/db/schema.ts`, `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js`, `src/settings/settings.repo.ts` and its test, `use-recurring-series.ts` and its test, both screens and their tests, `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts` and its test, `src/db/settings-columns.test.ts` (`TAKEN_FROM_FILE_ON_RESTORE`), `src/data-transfer/crypto/envelope.test.ts` (`VERSION_DECISIONS` note, `migrationCount` plus one, **no bump**), `src/data-transfer/import-data.back-compat.test.ts` (`EARLIER_BUILD_SETTINGS_COLUMNS`), `src/test-support/real-sqlite.ts`, `e2e/screenshot/fixtures/build-demo-snapshot.ts`, the suites below

**Upgrade worlds.** No owed state: NULL means nothing hidden, no one-time step, so no app-open or restore mirror. Asked per harness-workflow, "An acceptance pin's seed or world", which seeds are older-build worlds:

| Seed | World | Effect | Re-seed, by its own line |
|---|---|---|---|
| Suites using `applyMigrationsThrough`, 11 on the floor as grepped at 35861c22b: nine `restore-*.two-path.test.ts`, `transactions.repo.remove-cascade.test.ts`, `real-sqlite.test.ts` (`restore-import-time-rezone.two-path.test.ts` does not use it; re-grep) | Database below the new migration, read through today's schema | `no such column` if it reads `settings` | `addRecurringMerchantChoicesColumn(source)` beside the existing `add...Column` line, per failing file, never inside a shared helper |
| `import-data.back-compat.test.ts` | Older-build file through `importData` | The list of columns an earlier build lacked | The key in `EARLIER_BUILD_SETTINGS_COLUMNS` |
| `e2e/screenshot/fixtures/build-demo-snapshot.ts` | Current demo | The typed settings row spells its columns (`reminderOfferDismissals: null`), so it needs the key | `recurringMerchantChoices: null` on its own line; regenerate the demo `.kiko` files if the developer measures that they change |

After those, other suites stay green unchanged. A failure elsewhere is reported, never fixed by editing an expectation.

**Acceptance:** hide and show round-trip; a hidden merchant's series leave the list and the merchant shows under "Hidden", also with no rows; nothing on a transaction changes; the paths of spec 11 are pins.

- [ ] **step 1/10 (kiko:qa): repo pins.** `settings.repo.test.ts`, real SQLite: `hideRecurringMerchant` stores `{ kind: 'hidden', name }`; a second keeps the first; hide twice is one entry, last name; `clearRecurringMerchantChoice(key, 'hidden')` removes one, and an absent key is a no-op with no write; the writes touch no `transactions` row (count and checksum); a malformed stored value reads as empty and the next hide replaces it; a bad entry beside a good one is dropped alone. Keys that are user text, through a reload: with nothing stored, `recurringMerchantChoicesOf(...).has('constructor')` is false; a hide on `constructor` and on `__proto__`, each beside a plain key, reads back as that entry, and the next write keeps all three. Commit `test(settings): the recurring merchant choices`.
- [ ] **step 2/10 (kiko:developer): column and repo.** S12, S16. `recurringMerchantChoices: text('recurring_merchant_choices', { mode: 'json' }).$type<Record<string, Choice>>()`; a schema comment says what it holds and why NULL. Migration by `npx drizzle-kit generate`, its test. Read-modify-write in one `write()`, as `recordReminderOfferDismissal`; a parser (`recurringMerchantChoicesOf`) for a non-object and a bad entry, returning a `Map` from `Object.entries`; a write stores `Object.fromEntries(map)`, never a bare index or assignment on the stored object (spec 8.1). `addRecurringMerchantChoicesColumn` in `real-sqlite.ts`. Run the upgrade-world files measured above. Commit `feat(settings): store hidden recurring merchants`.
- [ ] **step 3/10 (kiko:qa): restore pins.** `restore-recurring-merchant-choices.test.ts`, as `restore-dismissed-tips.test.ts`: a round trip keeps the list; a file with no key restores with none; a file's list replaces the live one (taken from the file, not `KEPT_FROM_LIVE_ON_RESTORE`); a malformed value in a file restores and reads as nothing hidden; a `__proto__` key survives the round trip. `settings-columns.test.ts` and the `VERSION_DECISIONS` note in this step. Green at once is acceptable where the restore already does it by column: show the run, and prove one pin by a temporary wrong column. Commit `test(restore): the recurring merchant choices`.
- [ ] **step 4/10 (kiko:qa): UI pins.** Series screen: the button shows, a tap calls `hideRecurringMerchant` with `merchantKey` and `name`, a rejected write shows the save alert and stays, a second tap during the write is blocked (`useSubmitOnce`); between the hide write's live fire and `goBack` the screen still shows its series, never the `listChanged*` text. List: hidden series leave, the "Hidden" section lists each name in key order, including a hidden name with no rows; "Show again" calls `clearRecurringMerchantChoice` with the key and `'hidden'`; a merchant named `constructor` with no choice stays listed; two series under one key both go; with only hidden merchants the empty state and the section both show. Hook: a `settings` write runs no detection and no new ledger read. Commit `test(settings): hide and show a recurring merchant`.
- [ ] **step 5/10 (kiko:developer): UI.** S9, S10. The hook gains `choices`; the list screen filters by `merchantKey` after detection (S13), so a hide runs no detection and the series screen keeps its series. After a hide the series screen closes back to the list through `navigation.goBack()`. Remaining keys of spec 13; `hiddenHeading` in `title-keys.ts`; help step 4. Failure log fixed text. Run named files, `src/i18n/locales`, `src/help`. Commit `feat(settings): hide a false match`.
- [ ] **step 6/10 (kiko:qa): the sample-key pin.** The sample table of task 1/4 step 3 gains a comment: these keys are stored in `settings.recurringMerchantChoices`; a change of `merchantNameOf` shows here, with spec 8's consequence. Confirm it fails when a sample's key is altered. No commit without the proof shown. Commit `test(recurring): stored keys follow the name function`.
- [ ] **step 7/10 Migration review (kiko:reviewer).** Required before BATCH READY, on the migration, schema, restore pins and `VERSION_DECISIONS` note. Top question: can any older-build path lose or change a row? Also read `git show release-1.3:src/data-transfer/import-data.ts` and the restore on that ref to confirm the key is dropped. No index, so no index EXPLAIN test.
- [ ] **step 8/10 Review (kiko:reviewer).** The whole diff. Top question: does anything other than the settings row change on hide?
- [ ] **step 9/10 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-architecture's data-transfer section, kiko-domain. Add to `docs/harness` only if a check moved. Report the sha or "no drift found".
- [ ] **step 10/10 Ready, device items held.** No device call here. Held for task 4/4 step 14/14: hide, the row goes, "Hidden" names it, show brings it back; export then restore keeps the list; both languages. Note the renumber need in the report if another migration reached `next` first (S12). Label `1.4-recurring-task-3`.

---

## 1.4-recurring task 4/4: mark as recurring

**Goal:** a "Mark as recurring" field on a stored charge's transaction form; a marked series on the list and series screens; "Remove mark"; "Marked, No Charges". **Needs:** task 3/4 (the store, the series screen's button). **Base:** task 3/4 tip. No migration. Rests on assumed Q5 = A.

**Files (floor 38, tests included, counted from the lists below; mutable 11; the developer measures).**
- Create: `src/recurring/marked-series/{marked-series.ts,index.ts,marked-series.test.ts}`; `src/screens/forms/transaction-form/recurring-mark-field/{recurring-mark-field.component.tsx,recurring-mark-field.props.d.ts,index.ts,recurring-mark-field.component.test.tsx}`; `src/screens/forms/transaction-form/transaction-form.recurring-mark.test.tsx`
- Modify: `src/recurring/detection/{detection.ts,detection.d.ts,detection.test.ts}`, `src/recurring/eligibility/{eligibility.ts,eligibility.test.ts}`, `src/recurring/recurrence-text/{recurrence-text.ts,recurrence-text.test.ts}`, `use-recurring-series.ts` and its test, `src/settings/settings.repo.ts` and its test, `restore-recurring-merchant-choices.test.ts`, both Settings screens and their tests, `recurring-series-row.component.test.tsx`, `recurring-series.navigator.test.tsx`, `transaction-form.screen.tsx`, `src/i18n/locales/{en,uk,title-keys}.ts`, `help-topics.ts` and its test, `src/navigation/types/types.d.ts` (the route's `isMarked`), `__tests__/property-sweep-sites.test.ts` (step 1's site)
- Modify, by measure: `transaction-form.screen.test.tsx`, `transaction-form.exchange-funding.test.tsx`, `transaction-form.set-category.test.tsx`, `src/test-support/transaction-form-data-layer.ts`: a suite that opens a stored debit gets the settings repo mock on its own line. A navigator suite that does so too is added to this list.

**Existing suites.** No owed state and no seed of an older build changes, since task 3/4 settled the column. `detection.test.ts`'s matrix, the demo pin and the five-card pins stay unedited. A form suite gains only its repo mock. `isMarked` is optional on the series and on the route and absent on a detected series, so typed series fixtures, task 2/4's route fixtures and its list test, "a tap opens `RecurringSeries` with all of S2's params", stay unedited (detection's output does not change, spec 9.5). One named edit: the hook test of task 1/4 step 6/15 moves its spy from `detectRecurringSeries` to `seriesOfGroups`, with its counts unchanged ("one detection per fire", none on a same-day return, "next day runs one"), since the hook calls the two parts and no longer the composed function (step 8/14); both are exports the hook imports from the detection module, so the module mock sees them. Any other edited expectation is reported, not made.

**Acceptance:** every row of "The marked matrix" is a pin; the field shows on a stored charge, in the same state on every path to the form (Home, Holding Detail, a series link; the Statistics stack reaches it only through Home) and on a synced row, and on no create, duplicate, template, credit or excluded row; a mark runs no detection and no ledger read; hide and mark are one entry per key; no output date has a local day later than today, in a marked world too.

- [ ] **step 1/14 (kiko:qa): marked pins.** `marked-series.test.ts`: `it.each` over "The marked matrix". Property, through `sweep`, with the site in `property-sweep-sites.test.ts`: random ledgers and marks with rows on every side of today: no output local day after today; shuffling is deep-equal; a marked key's detected series never appears beside its marked one; a fold never drops a real charge. Keys that are user text: one charge under `__proto__`, marked monthly through `recurringMerchantChoicesOf`, gives one marked series x1, and with no entry none; a `constructor` group with no entry gives no marked series beside a positive twin, so a plain-object index in `markedSeriesOf` fails. `eligibility.test.ts`: `isOfferedForMark` for each per-row rule of spec 4 with a positive twin, and it answers the same as `recurringExcludedIds` plus `isRecurringCandidate` for every row but a matched pair and a funded debit, which it cannot see (a sweep; the form holds the funded case by its caption). `detection.test.ts`: `detectRecurringSeries` equals `seriesOfGroups(chargeGroupsOf(...))` on the whole first matrix. Red, named files. Commit `test(recurring): marked series`.
- [ ] **step 2/14 (kiko:developer): marked series.** S16, S17, spec 6, 7, 8.2. No test decides which charges join a marked group. The line follows spec 6: section 5.2's test on all its charges, with the marked period's record and the amount test dropped, then the section 6 table; otherwise, and always for every 3 and every 6 months, `{ kind: 'marked' }`. Stopped through `stoppedCutoff` with the two new rows of spec 7; no 24-month leave. Reuse `addMonths` for every step. Green, named files. Commit `feat(recurring): marked series`.
- [ ] **step 3/14 (kiko:qa): text pins.** `recurrence-text.test.ts`, per language: each `marked.*`; a marked `onDay` reads as any series; `markedEmptyMessage` names no merchant. Commit `test(recurring): the marked text`.
- [ ] **step 4/14 (kiko:developer): text and catalogue.** Spec 13's new keys through kiko-translator (any changed wording goes to spec 13 and the pins here); `markedEmptyHeading` in `title-keys.ts`; `emptyMessage`'s added sentence. Run `npx jest src/recurring/recurrence-text src/i18n/locales --maxWorkers=2`. Commit `feat(i18n): mark as recurring copy`.
- [ ] **step 5/14 (kiko:qa): repo pins.** `settings.repo.test.ts`, real SQLite: `markRecurringMerchant` stores `{ kind: 'marked', name, period }`; marking a hidden key replaces the hide, hiding a marked key replaces the mark, and one entry stays; a second period replaces the first; `clearRecurringMerchantChoice` clears only the kind it is given: `'marked'` on a hidden key leaves the hide and writes nothing, `'hidden'` on a marked key leaves the mark; hidden, then marked, then cleared with `'marked'` leaves no entry; a mark on `__proto__` reads back after a reload; no `transactions` row changes (count and checksum); an unknown period in a stored entry is dropped alone. Restore test: a file's marks come back with their periods; an unknown period in a file restores and drops that entry. Commit `test(settings): recurring marks`.
- [ ] **step 6/14 (kiko:developer): repo.** S16. Same `write()` shape. Green, named files. Commit `feat(settings): store a recurring mark`.
- [ ] **step 7/14 (kiko:qa): list and series pins.** List: a marked series sits in active or stopped by its dates; a key's detected series is gone while marked and returns when the entry clears; hidden, then marked, then cleared shows the detected series and no "Hidden" line; "Marked, No Charges" lists each entry with `markedEmptyMessage` and "Remove mark", in key order; with only those the empty state and the section both show. Series screen: a detected series offers only "Not a recurring charge", a marked one only "Remove mark", which calls `clearRecurringMerchantChoice` with the key and `'marked'`, stays on a rejected write with the save alert, blocks a second tap, and between the write's live fire and `goBack` keeps its series, never the neutral text. Lookup, spec 9.3's order: a marked key finds its marked series on an old `seriesId` and never its detected one. On an `isMarked` route the `seriesId` step is skipped, with the route's `seriesId` set to the id a detected series holds: merged Apple 99 and 399 removed gives the neutral text and neither series; marked yearly over a detected monthly, removed, gives the neutral text; marked monthly over one detected monthly, removed, gives that series. On a route with `isMarked` false or absent, `seriesId` still resolves. The list's tap passes `isMarked: true` on a marked series and no such key on a detected one (`recurring-series-row`'s test holds its side). A marked series' row shows its line. Hook: the edit named under "Existing suites" lands here; a mark write runs no detection and no ledger read (spies on `chargeGroupsOf` and on `seriesOfGroups`, each at no new call, so the rule moved into the marked memo fails; and the `['transactions']` read's call count). Commit `test(settings): marked series on both screens`.
- [ ] **step 8/14 (kiko:developer): hook and screens.** S2 (`isMarked` on the route, set by the list's tap), S13, S17: the hook calls `chargeGroupsOf` and `seriesOfGroups`, never `detectRecurringSeries`; the first memo holds groups and `seriesOfGroups`, and a second holds `markedSeriesOf` on groups, marked entries and the local day. Failure log fixed text. Run named files. Commit `feat(settings): marked series on both screens`.
- [ ] **step 9/14 (kiko:qa): field pins.** `recurring-mark-field.component.test.tsx`: labels, the five periods plus "Not marked" in order, the current period as value, a pick calls `markRecurringMerchant` with the row's key, its spelling and the period, "Not marked" calls `clearRecurringMerchantChoice` with the key and `'marked'`, a hidden key's field reads "Not marked" and keeps its hide when that row is tapped (the repo pin of step 5), a row whose key is `constructor` with no choice reads "Not marked", a rejected write shows the save alert. `transaction-form.recurring-mark.test.tsx` through `transaction-form-data-layer`, with the same world over both paths (a `transactionId` route as Home opens it, and as a series link opens it): shown on a manual debit; shown and enabled on a synced debit whose amount stays locked and whose header has no Save; a pick there writes `settings` and no `transactions` row, and leaves Save and the draft as they were; on a manual row with an unsaved description the key comes from the stored one. Not shown, each with a positive twin: `holdingId`, `duplicateOfTransactionId`, `templateId`, `editTemplateId`, `newTemplate` and global add entries; a credit; a blank name; a row with a funding caption; while converting; each structural rule. The accepted gap (spec 8.2): a funded debit shows the field until the ledger read lands, then not. The form's mount reads no new `['transactions']` query (a count over the mock's calls). Commit `test(forms): mark as recurring on a transaction`.
- [ ] **step 10/14 (kiko:developer): field.** S15, spec 9.6. `SelectField`, `alertOnCatch`, `useSubmitOnce` where the pick writes; `merchantNameOf` and `merchantSpellingOf` on `existing.description`; `isOfferedForMark`; `exchangeFundingCaptionKey === undefined` from the screen, with no loading gate: that hook has no settled state, and the gap is accepted (spec 8.2). One import and one element in `transaction-form.screen.tsx`, gated on `existing` and `!converting`. The repo mock line in each suite measured, never in a shared block that hides it. Help step 5 in both catalogues. Run `npx jest src/screens/forms/transaction-form src/help src/i18n/locales --maxWorkers=2`, output in a file. Commit `feat(forms): mark as recurring on a transaction`.
- [ ] **step 11/14 (kiko:qa): navigator pins.** `recurring-series.navigator.test.tsx`: list to detected series to form, set a mark, Back shows that key's marked series; list to marked series to form, "Not marked", Back shows spec 9.3's result, for one detected series and for merged Apple 99 and 399; single and split mode; a fold keeps the route. Home to form: the field reads the same state. Prove one by a temporary wrong key, if green at once. Commit `test(navigation): a mark set through a link`.
- [ ] **step 12/14 Review (kiko:reviewer).** Top question: can a mark make any row count, or any date show, that section 4 and the ruling leave out? Second: do the two form paths differ anywhere? No migration in this set.
- [ ] **step 13/14 Drift and Scribe (kiko:retrospect, kiko:scribe).** Check kiko-domain's recurring section (a mark, its periods, one choice map), kiko-architecture's data-transfer section. Report the sha or "no drift found".
- [ ] **step 14/14 Device and Ready: fundamentals done.** The required device call for this feature. Device confirm by the user, both languages: the items held from tasks 1/4 to 3/4 (real-ledger items already read at an optional look at task 2/4's tip are not repeated, unless a spec 10.4 fix landed), and the field's look and place on a synced and a manual row; mark a missed charge, the list shows it with the expected line; change the period; remove it from the form and from the series; hide then mark and the "Hidden" line leaves; export then restore keeps a mark; the same field through a series link; iPad two panes and Duo fold. Label `1.4-recurring-task-4`.

---

## Mutable file counts (floors; `make mutable` measures; the cap is 30)

| Task | Floor |
|---|---|
| 1/4 | 13 (the demo test and seed are not app code; `make mutable` decides) |
| 2/4 | 6 |
| 3/4 | 6 |
| 4/4 | 11: `marked-series.ts`, `recurring-mark-field.component.tsx`, `detection.ts`, `eligibility.ts`, `recurrence-text.ts`, `use-recurring-series.ts`, `settings.repo.ts`, both Settings screens, `transaction-form.screen.tsx`, `help-topics.ts` |

Mutation gates are paused by the user; this table is for a lift.

## Not in the tasks

A forecast, a reminder, a total, a detected period beyond the three, an edit of Statistics, an edit of `merchantNameOf`, a change to `category`, a column on `transactions`. What's New goes in App Store Connect at release (spec 14), and Notes for Review through the release skill.

## If the user answers differently

- **Q5 = B (name at about that amount):** `Choice` gains `amountMinorUnits`, stored from the row. `markedSeriesOf` cuts the group as spec 5.3 step 3 does and takes the piece holding that amount, so 100, 120, 144 stays together (spec 16). Worlds change: "Two detected, merged" keeps the other series detected; a new world pins a rise over 25 percent reading stopped. Tasks 1/4 to 3/4 stay.
- **Q5 = C (rows one by one):** the spec's 8.2 is rewritten first. `Choice` gives way to a list of series, each `{ name, period, rowIds }`, with its parser and a row-id restore world; the field gains a pick of the target series; `markedSeriesOf` takes rows by id and not groups, with its eligibility; the marked matrix is rewritten. Hide's kind stays in the column. Task 4/4 grows; tasks 1/4 to 3/4 stay, but the column's shape in 3/4 is settled first.
- **If `1.4-category-automation` loses B3:** spec 3: its steps for `merchant-name.ts` move into task 1/4 as first caller. Never a copy.
