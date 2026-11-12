# 1.4-binance-dated: implementation plan, tasks 1 to 3 of 3

> For agentic workers: use superpowers:subagent-driven-development. Steps use `- [ ]` tracking.
> One fresh `kiko:developer` per task and per fix round.

**Goal:** Binance and the Bitcoin wallet (tasks 1 and 2) and, after the user's pick, Monobank (task 3)
take Bybit's dated balance read: the line holds the last read, a read marks the rows it overwrote,
and a delete or edit of a marked row moves no balance (O85, Q-j, Q-k, Q-l, Q-m).

**Spec:** `docs/superpowers/specs/2026-11-09-binance-dated-design.md` (below: "the spec"). Section
and pin ids (R, W, D) are the spec's. Plan text never overrides it.

**Base:** `next` at 1dd814751. Every code fact below names a symbol; re-grep each on the actual base.
Every count is a floor; the developer measures.

**Order:** task 1, task 2, then task 3 only after the user's Q1 answer (questions-1.md). Tasks 1 and 2
do not wait for Q1. Task 1 waits only for Q2 if the coordinator wants to rule it; the plan is
written for Q2 = A (PLANNER CALL D1). If Q2 comes back B, task 1 grows a migration step and a
`kiko:reviewer` step before BATCH READY (no index, so no EXPLAIN QUERY PLAN test), and this plan is
re-cut by a planner.

## Global constraints

- STRICT SCOPE. No new text, no new screen, no migration (rule A).
- Red first, shown failing on the parent for the stated reason (kiko-testing, "Acceptance pins").
- Each acceptance pin has its own per-pin seed. Never edit a shared seed helper
  (`src/test-support/binance-backfill-world.ts`, `binance-real-sqlite.ts`, `walk-marks.ts`).
- A changed existing pin is only one named in the spec's "Existing pins that change on purpose";
  the commit message names its ruling. Any other red suite: stop and report both expectations.
- Checks per step: the PostToolUse fast tier, `make jest-affected` (exit 3 means report for the
  queued verify), named jest (`npx jest <files> --maxWorkers=2`), `npm run check:typecheck`,
  `npm run check:import-order`. Never `make verify`.
- Per task: the orchestrator reports READY FOR VERIFY (worktree, label, base sha, tip sha); the
  coordinator queues `bash scripts/job-queue.sh verify <worktree> <label>`, rerun until green.
  Mutation gate per task, `KIKO_MUTATION_BASE` = that task's own base commit (never the branch);
  gates are PAUSED by the user since 2026-10-25, so verify and review only, the gate text stays.
- Review per task (`kiko:reviewer`), then `kiko:retrospect` and `kiko:scribe` (skill drift rule).
  No UI change in tasks 1 and 3; task 2 changes a value on screen, no layout: the track-end
  `kiko:designer` read-only review covers it.

## 1.4-binance-dated task 1/3: Binance and the wallet on the dated list

Files: `src/holdings/holding-metadata/holding-metadata.ts`,
`src/statistics/holding-value-at/holding-value-at.ts`, tests named below.

- [ ] **step 1/3: red pins.** Write D1 in `holding-metadata.test.ts`, D2 in new
  `src/statistics/holding-value-at/holding-value-at.dated.test.ts` (rows R1, R3, R4, R6, W1, W2, W4,
  one title per row, per-pin seed), D3 in new `src/crypto-sync/binance/binance.past-line.real-sqlite.test.ts`
  (W1 to W6, W10, R2, R4 through `runBalanceSync`, `transactionsRepo` and `disconnectCryptoAccount`),
  D4 in new `src/crypto-sync/btc-wallet/btc-wallet.past-line.real-sqlite.test.ts` (W8, W9), D5 new
  titles in `src/data-transfer/snapshot/restore-past-line-mark.test.ts` (R7). Model the real-SQLite
  files on `bybit.past-line.set-aside.real-sqlite.test.ts`.
  Check: each new title fails on the base for its stated reason, output quoted; R1, R3, R6 and R7
  titles that are green on the base are pins of "no change" and are marked so in the report.
- [ ] **step 2/3: the entries and the no-date rule.** In `datedBalances` add `binanceAsset` →
  `binance` and `walletAddress` → `btc_wallet`, and give each entry its no-date rule (spec section 3,
  "Shape"): Bybit counts no source row before its first read; Binance and the wallet count every one.
  Export one reader of the entry; `rowsHeldByBalance` reads it. No other file changes:
  `sync.ts` writes the date by `datesBalanceOf`, `overwrittenRowsPatch` writes the mark,
  `isOverwrittenRow` gates the move and the confirm.
  Re-pin, in the same commit, each pin in the spec's table "Existing pins that change on purpose"
  (A122, A129, A135 rows for Binance and the wallet; `datedBalanceSourceOf` "names no source for
  %s"; `sync.test.ts` "a provider that does not writes the stamp alone", reseeded per pin). Update
  the doc comments of `datedBalances`, `rowsHeldByBalance`, `createHoldingValuer` and the
  `upsertByMetadataKey` header ("The update branch of a holding on the dated list (Bybit)").
  Check: steps 1/3 pins green; `make jest-affected`; list every other red suite (floor of
  candidates in the spec, section 6) with the ruling that changes it, or stop and report.
- [ ] **step 3/3: statement counts and the 100,000-row read.** Run the A135 statement-count titles
  ("$label makes the same statements on a delete / on the confirm / on an edit") and the
  `holdings.repo.past-line-mark.test.ts` count titles for Binance and the wallet; record the
  measured counts against the parent. A count that grows is reported, not re-pinned silently.
  Check: named jest on those two files; `npm run check:typecheck`.

## 1.4-binance-dated task 1/3 fix round 3: the kept list (Q3, old typed rows count for good)

Base: tip 7ed3f7067 (task base 480d4ab7c). Spec: section 3 "The kept list", rows R8 to R10, pins D8
and D9, and the D8 rows of "Existing pins that change on purpose". One fresh `kiko:developer`.
Re-grep every symbol below on the actual base; counts are floors.

Files: `src/holdings/holding-metadata/holding-metadata.ts` (the key constant beside
`OVERWRITTEN_ROW_IDS_FIELD`, a reader beside `overwrittenRowIdsOf`, the `DatedBalance` and
`OVERWRITTEN_ROW_IDS_FIELD` comments), `src/holdings/repo/holdings.repo.ts`
(`overwrittenRowsPatch`, its comment, the `upsertByMetadataKey` header paragraph on the dated
list), and the tests named below. No other `src/` file: the valuer, `isOverwrittenRow`,
`strippedOnDisconnect`, `carriedMetadataKeys` and the restore stay as they are.

- [ ] **step 1/3: red pins (D9), each with its own seed.** Seed old rows by raw INSERT as the
  existing "shipped with a row the user typed" describes do; type later rows with `recordManual`.
  - `binance.past-line.real-sqlite.test.ts` and `btc-wallet.past-line.real-sqlite.test.ts`, the
    "shipped with a row the user typed" describe: "the old typed row stays off the mark at the
    second and the third dated read, with a disconnect between them, and keeps counting" (line
    and metadata after each read); "a delete of the old typed row after the third dated read moves
    the balance as today"; "a deleted old row leaves the kept list at the next read". Tighten the
    Q-j title's assertion to exactly `[laterRowId]` (spec table, D8 row).
  - `holdings.repo.past-line-mark.test.ts`, `it.each(DATED)`: "a later read of a %s holding marks
    only the rows off its kept list and prunes a gone id"; one Bybit title: "Bybit's first read
    marks every row that is not a bybit row and writes no kept list" (green on the base: a
    no-change pin, say so in the report).
  - `restore-past-line-mark.test.ts`, the Binance describe: "a restore keeps the kept list, and the
    next read marks no old row" (per-pin seed through the describe's own `seedBinanceLedger`
    shape; never a shared helper).
  - `holding-metadata.test.ts`: the reader ("reads the kept ids; a value that is not a list reads
    as none", modelled on `overwrittenRowIdsOf`'s titles) and in `withCarriedMetadataKeys` "does
    not carry the kept list, so a read writes its own".
  Check: each new title fails on 7ed3f7067 for its stated reason (the old row on the mark, or the
  missing key or reader), output quoted; a green one is reported as a no-change pin.
- [ ] **step 2/3: the kept list in `overwrittenRowsPatch`.** One select of the non-source row ids,
  as now, on every read of a dated holding (the first read included). First dated read of an entry
  with `countsSourceRowsBeforeFirstRead` (stored `balanceReadAtOf` null): return the kept key with
  those ids, or `{}` when none, and no mark. Any later read of such an entry: mark = ids off the
  stored kept list; kept = ids on it that still exist; each key only when non-empty. An entry with
  `false` (Bybit): exactly as today, the kept list never read. Re-pin in this commit the three D8
  rows of the spec's "Existing pins that change on purpose" (ruling Q3, kept list, in the message).
  Update the comments named under Files (drop the second-read limit from `DatedBalance`; state that
  the key is in neither carried nor stripped list, as the mark).
  Check: step 1/3 pins green; named jest on the five test files; `make jest-affected`
  (`BASE=7ed3f7067`; exit 3: report for the queued verify); `npm run check:typecheck`;
  `npm run check:import-order`; `npm run check:full-word-identifiers`. Any other red suite: list
  it with both expectations and stop, unless it is a whole-metadata pin of an undated Binance or
  wallet holding WITH a non-source row read through the update branch (spec section 6 floor of
  candidates), which gains the kept key: list each with the ruling. The 1.2-upgrade worlds
  (`src/test-support/binance-backfill-world.ts` and other undated seeds) must stay green unchanged.
- [ ] **step 3/3: statement counts.** Run the D8 count title (now one select on the first read)
  and "a read of an existing %s holding sends one statement on the ledger table", the A135
  "$label makes the same statements…" titles, and the `holding-value-at.bybit.test.ts` dated
  describe; record measured counts against 7ed3f7067. A count that grows other than the D8 first
  read is reported, not re-pinned. Check: named jest on those files.

Then: READY FOR VERIFY (worktree, label, base 480d4ab7c for the task, this round's base 7ed3f7067,
tip); the coordinator's queued `bash scripts/job-queue.sh verify <worktree> <label>`, rerun until
green; `kiko:reviewer` on 7ed3f7067..tip (top question: can an old row reach the mark by any path:
a disconnect, a restore, a delete, a Bybit holding); mutation gate text stays with
`KIKO_MUTATION_BASE=7ed3f7067` (gates paused since 2026-10-25). No migration, so no migration
review step. Task 3/3 reuses the kept list (Monobank's entry: `countsSourceRowsBeforeFirstRead:
true`; its marked sources filter the same select); its step 3/3 adds "keeps the kept list" to the
reopen and `disconnectMonobank` titles.

## 1.4-binance-dated task 2/3: the "Earlier history" line reads the held rows (PLANNER CALL D2)

Files: `src/statistics/holding-value-at/holding-value-at.ts` (export the held-rows function or an
opening-balance function built on it, through the folder's barrel),
`src/screens/holding-detail/exchange-history-footer/exchange-history-footer.component.tsx`, its test.

- [ ] **step 1/2: red.** D6 in `exchange-history-footer.component.test.tsx`: W11's world (a dated
  Binance holding, rows +1 before the read and -0.2 after it, stored 1) shows no line; a row on the
  mark is left out of the amount. Check: red on the base, output quoted.
- [ ] **step 2/2: the footer uses the valuer's rule.** One rule, imported from
  `@kiko/statistics/holding-value-at`; no copy. Keep the props' row type able to carry `id`,
  `source` and `time` (re-grep `exchange-history-footer.props.d.ts` and the screen that passes
  `transactions`). Fix the footer's comment. Check: D6 green; the existing footer titles green or
  each red one listed with D2; `npm run check:feature-imports`, `npm run check:screen-imports`,
  `npm run check:knip`.

## 1.4-binance-dated task 3/3: Monobank (GATED: no code before the user picks Q1)

Written for option A of the spec's section 5. If the user picks B, step 2/3 writes no date and the
list splits into dates and marks; if C, this task is dropped and A135's Monobank rows stay. Either
way a planner re-cuts this task after the answer.

Files: `src/holdings/holding-metadata/holding-metadata.ts` (the entry `monobankId` → `monobank`, its
no-date rule "every row counts", and a per-entry set of marked sources: `manual` only for Monobank,
every other source for the rest), `src/holdings/repo/holdings.repo.ts` (`overwrittenRowsPatch`
reads the entry's marked sources), `src/monobank/sync/sync.ts` (`upsertAllHoldings` puts
`BALANCE_READ_AT_FIELD` in each card's and jar's metadata, from `deps.now()` taken after the
client-info answer), tests.

- [ ] **step 1/3: red.** D7: `src/monobank/sync/sync.test.ts` "the fast phase writes the read time
  beside each card"; new `src/monobank/sync/monobank.past-line.real-sqlite.test.ts`: the section 5
  world (100, 100), the payment between the two reads (1000, 1000, then 1000, 900), "an import row
  stays off the mark and keeps counting", "a manual row on the mark moves no balance on delete or
  edit", "an undated card counts every row". Check: red on the parent, output quoted.
- [ ] **step 2/3: the entry, the marked sources and the date write.** Re-pin the Monobank rows of
  A121, A122, A129, A135 per the spec's table, with the ruling (Q1, Q-m) in the commit message.
  Bybit A133 ("an import row goes with no move and leaves its key") stays green unchanged.
  Check: D7 green; `make jest-affected`; every Monobank suite that asserts a card's whole metadata
  (`sync.test.ts`, `sync.reopen.test.ts`, `sync.reconnect-import.test.ts`,
  `holdings.repo.sync-close.test.ts`, floor) listed with the ruling, never loosened.
- [ ] **step 3/3: carried keys.** Confirm `BALANCE_READ_AT_FIELD`, the mark and the kept list
  (task 1/3 fix round 3) are in neither
  `carriedMetadataKeys` nor `strippedOnDisconnect`, and that `closeManyBySync` and the reopen keep
  them: one new title in `monobank.past-line.real-sqlite.test.ts`, "a sync-closed card keeps its
  read time and mark through the reopen", and one through `disconnectMonobank`. Check: named jest.

## After the last task

- [ ] `kiko:retrospect`, then `kiko:scribe`: skill lines that name Bybit alone for the dated read
  (kiko-exchange-sync "Past-line mark: a Bybit balance is dated…" and "A balance sync never
  touches the walk state" (the kept list beside the mark); kiko-domain "An exchange
  holding's 'Earlier history' line … `balance - sum(rows)`"; the Bybit spec's A121 and A135 rows
  point at this spec).
- [ ] Track-end `kiko:designer` read-only review (task 2 changes a shown value).
- [ ] READY FOR VERIFY on the final tip; the coordinator's queued verify, rerun until green.

## Run-log gaps

No open gap (`run-log.mjs stats --gaps --repo kiko`, read 2026-11-09) is in this track's scope; all
stay open. The nearest, left open: 20261021T1839-kiko-binance-set9/2 (the rounded-amount warning
per run), 20261023T0356-kiko-binance-set12/1 to /3 (walk cost).

## Sizes (floors, lines)

Task 1: 15 code, 600 test. Task 2: 15 code, 80 test. Task 3 (option A): 30 code, 300 test.

## Backlog (out of scope, report only)

- A queued Binance job marks a disconnected account connected (`runBalanceSyncInner` calls
  `updateAccount` with `institution: provider.id`).
- "invalid key" on a rate-limited raw check.
- Binance's twin of Bybit O93 (a key of another UID); a Statistics sentence for Binance (D3).
