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
- [ ] **step 3/3: carried keys.** Confirm `BALANCE_READ_AT_FIELD` and the mark are in neither
  `carriedMetadataKeys` nor `strippedOnDisconnect`, and that `closeManyBySync` and the reopen keep
  them: one new title in `monobank.past-line.real-sqlite.test.ts`, "a sync-closed card keeps its
  read time and mark through the reopen", and one through `disconnectMonobank`. Check: named jest.

## After the last task

- [ ] `kiko:retrospect`, then `kiko:scribe`: skill lines that name Bybit alone for the dated read
  (kiko-exchange-sync "Past-line mark: a Bybit balance is dated…"; kiko-domain "An exchange
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
