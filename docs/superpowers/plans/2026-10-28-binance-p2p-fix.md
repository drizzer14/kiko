# binance-p2p-fix task 1/1 — P2P newest-first, P2P budget share, visible P2P read failure

Base: main 293878c3, branch `binance-p2p-fix`, worktree `~/orca/workspaces/pff-ios/binance-set7`.
Rulings: STRICT SCOPE, mutation gates PAUSED (gate text kept), fresh developer per fix round.
Track steps: 1/4 proof (done), 2/4 this plan + fix, 3/4 acceptance pins, 4/4 review + retro/scribe.
This plan covers track steps 2/4 and 3/4 as change set "binance-p2p-fix task 1/1", plan steps
"step 1/4" .. "step 4/4" below.

Every code fact here is a symbol or anchor text: the developer re-greps each on the actual base
before editing. Every count is a FLOOR measured on 293878c3; the developer measures the real one.

## Proven cause (step 1 probe, `.superpowers/sdd/binance-p2p-fix/probe/p2p-budget.probe.test.ts`)

- Starvation PROVEN: with weight headers and a 300 s gap (world C), P2P gets 0 calls on runs 1-5;
  with no gap (world B) on every second run. Its walk then starts at 2017-07-14.
- Order PROVEN: without starvation P2P reaches `now - 30 d` only on run 12.
- Read failure: UNCHECKED (user ruling 2026-10-28: no device log comes). Settled on device by the
  step 3/4 caption after the deploy. No read-fix step in this plan.

## Commit granularity

Per plan step: one kiko:qa RED commit (`test(...): red ... (binance-p2p-fix task 1/1 step N/4 red)`,
showing the failing output on the parent), then one kiko:developer GREEN commit (`fix(...)`/`feat(...)`
`... (binance-p2p-fix task 1/1 step N/4)`). A re-pin of an existing expectation names the ruling
"user 2026-10-28, P2P newest-first / P2P budget share" in the commit message and is listed in a
"re-pinned" block of the commit body (old title -> new title). Acceptance pins each have their OWN
per-pin seed lines; no edit of `src/test-support/walk-marks.ts` or `binance-backfill-world.ts`.

Tests: named-file jest only (`npx jest <files> --maxWorkers=2`) and `make jest-affected`; never full
jest, `make verify` or `check:all` by an agent.

## Scenario matrix (the ruling reverses R-Walk A for P2P and the walk order)

| World | was (293878c3) | now |
|---|---|---|
| Empty P2P state, no headers (probe A/E) | first window 2017-07-14..08-13; `now - 30 d` read on run 12 | run 1 forward = `[now - 30 d, now)`; `[floor, now - 30 d)` owed, backfilled oldest-first by the pending pass |
| Empty P2P state, headers, gap 300 s (probe C) | P2P 0 calls runs 1-5; first window 2017 on run 6 | P2P reads its head window on run 1 (runs before capital) |
| Headers, gap 0 (probe B) | P2P 0 calls every second run | P2P runs first, so it reads whenever the minute is not already full at run start; a full minute starves every walk alike (Binance's own limit, not order) |
| Upgrade world: stored P2P cursor X < `now - 30 d` (1.2/1.3) | forward from X, newest last | same jump as an empty state: owed `[X, now - 30 d)` + cursor `now - 30 d`, ONE write |
| Stored cursor X >= `now - 30 d` (caught up) | forward from X | unchanged: forward from X, no jump |
| Capital/pay/convert/fiat orders, world C | capital 9, pay 6, convert 0 on run 1 | measured in step 1/4 red (pay and convert may lose a run to P2P's 18000 UID); pinned with a was column |
| P2P page read rejects (not a 429) | `console.warn` only, cursor held, no caption | same hold + `readFailedAt` stored + account caption |
| Next P2P run that reads and resolves | — | `readFailedAt` cleared, caption gone |
| Cooldown set by an earlier run's 429 | P2P skips (`isBinanceCoolingDown`) | unchanged (see step 1/4) |

## step 1/4 — P2P runs first: its budget share

Mechanism chosen: ORDER CHANGE, no `canAfford` reserve. In `runBinanceHistoryWalks`
(`src/crypto-sync/run-crypto-sync/run-crypto-sync.ts`) move the `'[binance sync] p2p history failed'`
`logOnFailure` call to be the FIRST walk (before `'[binance sync] capital history failed'`).
Reason: P2P's whole share is bounded by its own lane cap (`LANE_CALL_CAPS.p2p` 20 x `COSTS.p2p` 900 =
18000 UID, 10% of `UID_WEIGHT_BUDGET_1M`), so running it first reserves exactly that share with no
change to the shared `createBinanceRunBudget` semantics every lane and test relies on; a `canAfford`
reserve would hold 18000 UID from fiat orders too after P2P finished unless a new release call is
added (more surface for the same outcome). The demoted walks keep at least 162000 UID a fresh minute.
Rewrite the order comments in that function (the "After the dust read and before the trade read"
comment moves with the call; the capital comment's "the order fixes which walk a shared rate limit
skips" stays true).

Cooldown: a cooldown raised by an EARLIER run's 429 still skips P2P (`runSync` in
`binance.p2p-history.ts`, `isBinanceCoolingDown` at its top). Kept: the 429/418 is UID-wide, the
shared cooldown is the rule that also stops the balance sync, and a call inside it risks the 418 IP
ban. Within one run nothing runs before P2P any more, so no other walk's 429 can skip it in-run;
P2P's own 429 now skips the later walks, the same shared rule as today.

Files: `src/crypto-sync/run-crypto-sync/run-crypto-sync.ts`;
`src/crypto-sync/run-crypto-sync/run-crypto-sync.test.ts`; new
`src/crypto-sync/run-crypto-sync/run-crypto-sync.p2p-budget.real-sqlite.test.ts` (world from the
probe: the fake fetch is set inside the FIRST `jest.mock` factory, as the probe does, never after
import — the probe reached the real network otherwise).

Red (qa):
- Re-pin `run-crypto-sync.test.ts` "runs the walks in order, capital, Pay, Transfer, Earn, Convert,
  the dust read, P2P, fiat orders, fiat payments, then the trade read, all on one run object" ->
  P2P first; also the comment-ordered assertion near "trade read ran, in the order capital, Pay, ..."
  (grep the file for every order list; floor 2 sites).
- Pin P1 (world C, per-pin seed: headers on, gap 300 s, capital catching up, empty state): run 1
  makes >= 2 P2P calls (head window, both sides).
- Pin P2 demoted-walk world (priority-ruling rule): world C, 12 runs; capital withdraw, pay,
  convert and fiat orders each make >= 1 call within the first N runs and each reaches
  `complete: true` by run M. qa measures N and M on the parent and on the fix (red shows the new
  order is absent) and pins the fix values with a "was:" comment row in the test table.
Green (developer): the order move. Check: the three files above pass; `make jest-affected`.

## step 2/4 — P2P newest-first: head window, then backfill behind it

Design (one new shared helper, mirrors `backfillGroundOf`): add `headFirstGroundOf` in
`src/crypto-sync/exchange/walk/walk.ts` (export through the walk barrel). Input: `cursor`,
`pending`, `floorMs`, `endTime`, `windowMs`, `write`. With `forwardStart = max(floor, cursor ?? floor)`
and `headStart = endTime - windowMs`: when `forwardStart < headStart`, write in ONE patch list
`[{field: 'pending', value: [...pending, {start: forwardStart, end: headStart}]}, {field: 'cursor',
value: headStart}]` and return the new `{cursor, pending}`; else return the input unchanged and write
nothing. Call it in `runSync` (`binance.p2p-history.ts`) after `readPendingMark` and before
`planWalkPasses`, and feed its cursor and pending to `planWalkPasses` and to `context.marks`.
The range has no `series` (owed on both sides) and no `scope` (a `'backfill'` scope would skip BTC
rows in `rowsOfScope`, wrong here: P2P never read that ground).

Invariants kept (each pinned below):
1. No ground lost: after the write, `[forwardStart, headStart)` is owed and `[headStart, now)` is the
   forward pass; the overlap day behind the new cursor is added by `planWalkPasses` as today.
2. Crash-safe: range and cursor are one `patchExchangeState` write (as `backfillGroundOf`); a crash
   before it leaves the old cursor, after it the owed range.
3. No duplicate: rows dedupe on `${accountId}:p2p:${orderNumber}:${wallet}` (`addManyDedup`);
   not-imported entries dedupe as today ("keeps one entry when the re-scan reads a listed sale again").
4. Owed points (open orders) stay untouched; a point never merges with a range (`normalizePending`).
5. `MAX_PENDING_RANGES`: the new range is one range; past the limit the nearest merge, losing nothing.
6. Disconnect: `marksAfterDisconnect` resets the cursor to the floor, so a reconnect jumps again.
7. Re-scan: a stored `rescan` from an old forward walk is behind the new `rescanBase` and starts a
   new pass (`planWalkPasses` `resumed` rule); the re-scanned day is cut from owed windows
   (`withoutRead`).
8. Depth safety net (-5026) unchanged: owed windows go through the same `readSpan` depth guard.
9. Upgrade world (1.2/1.3 stored forward cursor X): identical to the empty state with X as start.
10. Caption: while the backfill range is owed, `historyOwesRange` keeps the existing
    "not imported yet" caption up (honest), and it clears when the range is read.
Backfill order: the pending pass reads the owed range's windows OLDEST-first (existing round-robin,
`windowsFrom`, at most `P2P_MAX_WINDOWS` windows built per range), so the month just behind the head
arrives last (see Q1).

Files: `src/crypto-sync/exchange/walk/walk.ts`, `src/crypto-sync/exchange/walk/index.ts` (if the
barrel lists names), `src/crypto-sync/binance/binance.p2p-history.ts` (wiring + the
`syncBinanceP2pHistory` doc comment "reads 30-day windows forward from the history floor"),
new `src/crypto-sync/exchange/walk/walk.head-first.test.ts`, `binance.p2p-history.test.ts`,
`binance.p2p-history.properties.test.ts`, `binance.p2p-history.real-sqlite.test.ts`,
`binance.walks.failed-calls.test.ts`, `binance.walks.unreadable-window.test.ts`,
`binance-history-status.quiet-syncs.test.ts`, `__tests__/property-sweep-sites.test.ts` (each only if
it goes red; floor 8 files reference P2P).

Red (qa):
- `walk.head-first.test.ts`: invariants 1, 2 (one write call with both fields), 5, 9, and the
  no-jump case (cursor >= headStart writes nothing).
- Pin P3 (acceptance, in the step 1/4 real-sqlite file, own seed): world C, empty state, the newest
  P2P order (createTime `now - 2 d`, UAH 1000.00 taker buy) lands on run 1.
- Pin P4 (acceptance, end-to-end, own seed): a Monobank UAH debit of exactly the order's total in
  the 1 h before / 2 h after window; after run 1, `exchangeFundingMatches` (`src/statistics/
  exchange-funding-match/exchange-funding-match.ts`) returns the debit id in `excludedIds` (was: not
  excluded on run 1 in world C).
- Pin P5 upgrade world (own seed): stored P2P cursor 2024-01-01 and one owed point; run 1 reads the
  head window, the point stays owed, `[2024-01-01, now - 30 d)` is in `pending`; runs until empty
  measured, every seeded order imported exactly once.
- Re-pins in `binance.p2p-history.test.ts` (floor 7, titles): "reads 30-day windows forward from the
  history floor, oldest first, both sides of each"; "reads every empty window and imports an order
  behind eight of them"; describe "a first walk of the shape of an account with 113 windows":
  "reaches the first UA-1 order by run 8 and the newest by run 12 at the lane cap" (-> newest on
  run 1, first order by run K measured), "spends the whole lane on each of the first 11 runs and
  reports none of them finished", "reads each of the 113 windows on both sides, 226 calls, before it
  is current"; "narrows a start Binance refuses as too old and walks on forward"; "reports complete
  once every window up to now is read and nothing is owed". Each re-pin keeps its subject and states
  the new numbers measured; an expectation outside P2P walk order is NOT edited (report a conflict).
- 1.2-upgrade worlds: before "other suites green unchanged", qa greps every P2P seed with a stored
  cursor older than `now - 30 d` (`walks: { p2p:` / walk-marks helper calls with `'p2p'`) and lists
  them; each is an upgrade world that now jumps.
Green (developer): helper + wiring; every file above green. Check: named-file jest on the list,
`make jest-affected`.

## step 3/4 — visible P2P read failure (REQUIRED; the device check for a read failure)

Persisted in the P2P walk entry of `sync_state.exchange_state`: new `WalkMarks` field
`readFailedAt?: number | null` (`src/crypto-sync/exchange/walk-state/walk-state.ts`, parsed into
`ParsedWalkMarks`; a value that is not a non-negative integer reads as absent, no repair write).
Written by `syncBinanceP2pHistory`: a rejection of `runSync` (any error; a 429 already resolves)
writes `readFailedAt: deps.now()` through `walkMarkWriterOf(deps, accountId, 'p2p')`, then rethrows
the ORIGINAL error (a failed mark write must not replace it), so `logOnFailure` still logs.
Cleared (`null`): when `runSync` resolves after it planned and started reading (not the cooldown
skip, not the no-credentials return, not the empty-plan return) and a mark is stored. A disconnect
drops it (`marksAfterDisconnect` keeps only cursor/rescan/pending/multiCoinSeen; pin it).
Caption: `binance-history-status.ts` gets `p2pReadFailed(state: ParsedExchangeState): boolean`;
`crypto-sync-section.component.tsx` renders `accountDetail.exchangeP2pReadFailed` (caption,
`textSecondary`, `{{exchange}}` param) when `connectedProvider === 'binance'`, the state loaded, not
`historyPaused`, and the mark is set; kept during a sync (a standing fact, like the coin lines).
Copy (en, kiko-translator does uk, U+02BC apostrophe): "{{exchange}} P2P orders could not be read
on the last sync. Kiko will try again on the next sync." Update the comment above `CAPTION_WALKS`
("A P2P page that cannot be read holds its cursor on every run, so the caption is how that stays
visible").

Files: `walk-state.ts`, `exchange-state-patch.ts` (only if the patch type needs it),
`binance.p2p-history.ts`, `binance-history-status.ts`, `crypto-sync-section.component.tsx`,
`src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts`; tests `walk-state.read-failed.test.ts` (new),
`binance.p2p-history.test.ts` (describe "a failure of the P2P walk"), `binance-history-status.test.ts`,
new `crypto-sync-section.component.p2p-failed.test.tsx`, `exchange-state-patch` disconnect test.
Check the help topics for a caption list (grep `exchangeHistoryPending` in help content) and add
the new caption where the others are listed.

Red (qa), each with its own seed:
- Pin P6 (acceptance): a P2P page answering a non-`000000` envelope (`BinanceHistoryParseError`)
  -> `readFailedAt` stored, the walk still rejects with that error, the component shows the caption.
- Pin P7: the next run with a good page clears the mark; the caption is gone.
- A 429 run, a cooldown-skip run and a no-credentials run leave a stored mark as it was.
- Disconnect drops the mark; a malformed `readFailedAt` reads absent.
Green (developer). Check: named-file jest on the listed tests; uk reviewed by kiko-translator.

## step 4/4 — spec and doc text (no app code)

`docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`:
- "### P2P": the bullet anchored "R-Walk A: the walk reads forward from the floor" and its
  continuation "Recent orders arrive last: 226 calls over 12 runs" -> the user ruling 2026-10-28
  (newest window first, backfill behind it, P2P runs first in the run), with "was:" kept.
- "### Refused window and walk direction": "Walk direction (R-Walk A" and "Recent records arrive
  last" bullets: P2P is the exception.
- "The lane caps are starting values" table row anchored "P2P (30-day windows) | 113 x 2" and the
  sentence "The walk reads forward from the floor (R-Walk A), so recent records arrive last.":
  new runs, was column.
- Rows anchored "| P7b |" (both tables): new result + "was: newest at run 12".
- The run-order text wherever the spec lists capital first (grep "capital, Pay, Transfer").
The kiko-exchange-sync walk-order sentence and the set-13 matcher dependency are the track's
step 4/4 (retrospect + scribe), not this plan. Check: `make doc-suites`.

## Close-out

- kiko:reviewer on the whole change set (no migration in this plan, so no migration review step).
- Mutation: per change set with `KIKO_MUTATION_BASE` = that step's own base commit (`make mutable`
  for the file count) — PAUSED by the user since 2026-10-25; verify + review only.
- READY FOR VERIFY to the coordinator, who queues `bash scripts/job-queue.sh verify
  ~/orca/workspaces/pff-ios/binance-set7 binance-p2p-fix` once at the end; rerun until green.
- Device deploy for the user's check (caption visible or P2P rows arrive).

## Run-log gaps

No open gap in `run-log.mjs stats --gaps --repo kiko` names P2P. Left open (out of strict scope):
binance-set12/1, /2, /3 (owed-range halving cost, merged cluster worlds), binance-set9/2
(row-precision log volume).

## Backlog (strict scope: not in this plan)

- Newest-first backfill order behind the head (Q1 option B).
- A budget reserve in `canAfford` for other starved lanes (pay/convert behind capital, pre-existing).
- The same head-first order for Convert and the fiat walks (still R-Walk A).
- A device log of the P2P failure code (settled by the caption instead).
