# binance-p2p-fix task 1/1 — P2P newest-first, P2P budget share, visible P2P read failure

Base: main 293878c3, branch `binance-p2p-fix`, worktree `~/orca/workspaces/pff-ios/binance-set7`.
Rulings: STRICT SCOPE, mutation gates PAUSED (gate text kept), fresh developer per fix round.
User ruling Q1 (2026-10-28, option B): the P2P ground behind the head window is read NEWEST-first,
through a P2P-only option on the shared walk planner; a window that fails every run must not block
the windows behind it forever (pinned). Orchestrator rulings R1 (P2P runs first, step 1/4, done in
73e4d59c) and R2 (one generic caption line, en + uk) stand.
Track steps: 1/4 proof (done), 2/4 this plan + fix, 3/4 acceptance pins, 4/4 review + retro/scribe.
This plan covers track steps 2/4 and 3/4 as change set "binance-p2p-fix task 1/1", plan steps
"step 1/4" .. "step 4/4" below.

Every code fact here is a symbol or anchor text: the developer re-greps each on the actual base
before editing. Every count is a FLOOR measured on 293878c3 (step 2/4 onward: on 73e4d59c); the
developer measures the real one.

Guard facts (qa, step 1/4 red): a test comment may not hold "was:" or a pin id such as "P1"; the
was values of every re-pin go in the commit body, never in a comment or a test title.

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
| Empty P2P state, no headers (probe A/E) | first window 2017-07-14..08-13; `now - 30 d` read on run 12 | run 1 forward = `[now - 30 d, now)`; `[floor, now - 30 d)` owed and read NEWEST-first by the pending pass (8 windows a run behind the head, see "Measured budget") |
| Empty P2P state, headers, gap 300 s (probe C) | P2P 0 calls runs 1-5 (293878c3); 20 calls a run, all forward from 2017-07-14, `now - 30 d` on run 12 (73e4d59c) | run 1: head window, the re-scan day, then the 8 newest owed windows: back to `now - 271 d` (clock 2026-10-28: 2026-01-30), so the previous calendar month is read whole on run 1; run 2 back to `now - 511 d` (2025-06-04); the floor by run 15 (113 owed windows / 8) |
| One owed window fails every run (`BinanceHistoryParseError`), the others read | (oldest-first round-robin: moves past it, the rest read in their turn) | newest-first rotation: run 1 reads it first and moves past it; the run after reads the windows behind it first, it comes back after them; every other window read within `ceil(G / R)` runs (G owed windows, R windows the pending pass enters a run); the run still rejects, so the step 3/4 caption shows |
| More failing windows than a run reads (9 newest owed windows fail every run, R = 8) | (round-robin moves past each) | the rotation moves past each, so the windows behind them are read from run 2; a plain newest-first order would read the 8 failing ones every run, forever |
| A run-ending failure (network, 401, 429) in an owed window | ends the run, the window first again next run | unchanged (no read started, the range cursor does not move; a whole-account failure, as for the forward pass) |
| Headers, gap 0 (probe B) | P2P 0 calls every second run | P2P runs first, so it reads whenever the minute is not already full at run start; a full minute starves every walk alike (Binance's own limit, not order) |
| Upgrade world: stored P2P cursor X < `now - 30 d` (1.2/1.3) | forward from X, newest last | same jump as an empty state: owed `[X, now - 30 d)` + cursor `now - 30 d` + range cursor reset, ONE write; owed read newest-first |
| Upgrade world with a stored range cursor (old oldest-first round-robin) | round-robin from it | the jump write resets it, so the first owed read is the newest window, not the ground below the old cursor |
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
  order is absent) and pins the fix values, the old values in the commit body (guard facts).
Green (developer): the order move. Check: the three files above pass; `make jest-affected`.

## step 2/4 — P2P newest-first: head window, then the ground behind it newest-first

Part A, the jump (one new shared helper, mirrors `backfillGroundOf`): add `headFirstGroundOf` in
`src/crypto-sync/exchange/walk/walk.ts` (export through the walk barrel). Input: `cursor`,
`pending`, `floorMs`, `endTime`, `windowMs`, `write`. With `forwardStart = max(floor, cursor ?? floor)`
and `headStart = endTime - windowMs`: when `forwardStart < headStart`, write in ONE patch list
`[{field: 'pending', value: [...pending, {start: forwardStart, end: headStart}]}, {field: 'cursor',
value: headStart}, <range cursor reset>]` and return the new `{cursor, pending, rangeCursor}`; else
return the input unchanged and write nothing. Range cursor reset: the value the newest-first order
reads as "start at the newest window" (`null` if the walk-mark patch type allows it; it is
`rangeCursor?: number` in `walk-state.ts` on 73e4d59c, so else `BEFORE_EVERY_GROUND`, which the
rule below reads the same way; the developer picks by the type and names the choice in the commit).
Call it in `runSync` (`binance.p2p-history.ts`) after `readPendingMark` and `readWalkRoundRobins`
and before `planWalkPasses`; feed its cursor, pending and range cursor to `planWalkPasses` and to
`context.marks`. The range has no `series` (owed on both sides) and no `scope` (a `'backfill'`
scope would skip BTC rows in `rowsOfScope`, wrong here: P2P never read that ground).

Part B, the order (user Q1 = B): a P2P-only option `newestFirst?: boolean` on `planWalkPasses`
(the planner of every walk; call sites on 73e4d59c: convert, transactions, p2p, pay, transfer,
earn, fiat, floor 7). Only `binance.p2p-history.ts` passes `newestFirst: true`. With the option
absent or `false`, `planWalkPasses` returns today's plan byte for byte (same `buildWalkWindows`,
same `windowsFrom`, same per-range `maxWindows` cap). With it `true`, for the windows owed for
every coin (P2P owes no `'backfill'` scope; the backfill group keeps today's code path):
1. Build: each owed range (after `withoutRead` of the re-scan, as today) is split into windows
   from its END back (`end - windowMs` .. `end`, then the one before, the oldest one cut at the
   range start), with NO per-range `maxWindows` cap, then the whole list is ordered by start,
   newest first, and cut to the first `maxWindows` AFTER the rotation below. Reason for the cap
   move: built per range from the end, a range whose `maxWindows` newest windows all fail every
   run would hide the ground behind them forever; P2P's owed ground is at most
   `(now - floor) / 30 d` (113 windows on 73e4d59c), so the uncut list stays small.
2. Rotation (the failing-window rule): with a range cursor `c` (the end of the owed window whose
   read started last, stored by today's `storeRangeCursor`, unchanged), the order is the windows
   that END BEFORE `c` (strictly), newest first, then the rest, newest first; `c` null (or
   `BEFORE_EVERY_GROUND`) is all of them newest first. This mirrors `windowsFrom` (today: start at
   or after `c` first, oldest first). Name it `newestWindowsFrom` beside `windowsFrom`.
`runWalkPlan`, `markPendingRead`, `storeRangeCursor` and the points round-robin are NOT changed.

The failing-window rule, stated:
- A window whose read started (it failed with an unreadable-window error, or split and ran out of
  calls, or finished) moves the range cursor to its end. The next run reads every window older than
  it first, newest first, and the windows at or above it (the window itself if still owed, and any
  newer ground owed since) after those, in the same run if the budget allows, else when the
  rotation comes round.
- Within a run an unreadable owed window does not end the pending pass (`STOP_ENDS_PASS.pending`
  false; the `isUnreadableWindowError` catch in `readPass`), so the windows behind it are read in
  the same run; the run rejects at its end with the first such error (today's rule).
- A run-ending failure (rate limit, auth, network, clock skew) starts no read, so the cursor stays
  and the same window comes first next run; that is account-wide, as for the forward pass, and
  the step 3/4 caption shows it. Out of the rule's scope.
- Bound: every owed window is entered within `ceil(G / R)` runs (G owed windows, R >= 1 the windows
  the pending pass enters a run), whatever windows fail, as the `windowsFrom` doc comment states for
  the oldest-first rotation. With R = 1 a failing window still moves the cursor past itself, so it
  never takes every run.
- Invariants: no order lost (the rotation orders reads only; `pending` changes only by a committed
  span, `advanceWalkMarks`); none duplicated (`addManyDedup` key
  `${accountId}:p2p:${orderNumber}:${wallet}`, the not-imported dedupe); the owed marks stay sound
  (`pending` untouched by the order; the range cursor is an ordering hint whose every value,
  malformed included, gives a full order).
- Known cost (mirrors today): the rest of a window cut by a run's budget ends at `c`, so it goes
  behind the older windows until the rotation comes round. Newer owed ground that appears behind
  `c` (an overlap day the re-scan does not cut, a drift range of one side) waits the same way; the
  jump resets the cursor, so the month ground never does.

Measured budget (73e4d59c, step 1 probe world C, `-t 'C headers'`): P2P makes 20 calls on each of
runs 1-12 = 10 windows of 2 sides a run (`LANE_CALL_CAPS.p2p` 20). After the fix the 20 split as:
head window 2, owed windows 16 (8 windows, `RESCAN_KEEP` keeps 2 for the re-scan), the re-scan 2
(run 1: the overlap day behind `headStart`; later runs: `[now - 30 d, cursor)`). So R = 8, and the
derived reach in world C, clock 2026-10-28: run 1 back to `now - 271 d` (2026-01-30; the previous
calendar month, September, is read whole: head from 09-28, re-scan 09-27, first owed window
08-28..09-27), run 2 back to `now - 511 d` (2025-06-04), the floor by run 15 (113 owed windows,
8 a run). qa measures each on the green; a count is a floor.

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
11. Other walks: no other `planWalkPasses` caller passes `newestFirst`; their plans are unchanged
    (pins below).
Order behind the head: NEWEST-first with the failing-window rotation (Part B), so the month just
behind the head arrives on run 1.

Files: `src/crypto-sync/exchange/walk/walk.ts` (`headFirstGroundOf`, `newestWindowsFrom`, the
`newestFirst` option, and the `planWalkPasses` / `windowsFrom` doc comments that say "oldest
first"), `src/crypto-sync/exchange/walk/index.ts` (if the barrel lists names),
`src/crypto-sync/binance/binance.p2p-history.ts` (wiring + the `syncBinanceP2pHistory` doc comment
"reads 30-day windows forward from the history floor"),
new `src/crypto-sync/exchange/walk/walk.head-first.test.ts`, new
`src/crypto-sync/exchange/walk/walk.newest-first.test.ts`, `binance.history-walk.properties.test.ts`,
`binance.p2p-history.test.ts`,
`binance.p2p-history.properties.test.ts`, `binance.p2p-history.real-sqlite.test.ts`,
`binance.walks.failed-calls.test.ts`, `binance.walks.unreadable-window.test.ts`,
`binance-history-status.quiet-syncs.test.ts`, `__tests__/property-sweep-sites.test.ts` (each only if
it goes red; floor 8 files reference P2P).

Red (qa):
- `walk.head-first.test.ts`: invariants 1, 2 (one write call with pending, cursor and the range
  cursor reset), 5, 9, and the no-jump case (cursor >= headStart writes nothing).
- `walk.newest-first.test.ts` (`planWalkPasses` with `newestFirst: true`): one range of 20 windows
  plans its windows from the range end, newest first, cut to `maxWindows`; a range cursor at the end
  of window k plans the windows older than k first, then k and the newer ones; null and
  `BEFORE_EVERY_GROUND` plan newest first; a range of 12 windows whose 10 newest stay owed with the
  cursor at the end of the 10th from the top plans the 11th and 12th first (the per-range cap no
  longer hides them); two ranges interleave by start, newest first; the forward windows, the
  re-scan and the points are the same as with the option off (deep-equal).
- Byte-for-byte pin for every other walk: `binance.history-walk.test.ts` describe "the round-robin
  over the owed ranges" and `walk.backfill.test.ts` "keeps the round-robin order inside the ground
  for every coin and inside the backfill" stay green UNCHANGED; plus one property in
  `binance.history-walk.properties.test.ts`: for generated inputs, `planWalkPasses(input)`
  deep-equals `planWalkPasses({ ...input, newestFirst: false })`, and with `newestFirst: true` the
  owed windows cover the same ground as with it off when no cap cuts (no ground lost).
- Pin P8 (acceptance, real-sqlite step 1/4 file, own seed: world C, empty state, one P2P order at
  the 15th of the calendar month before the run clock): after run 1 the order is imported, and the
  P2P calls of run 1 asked spans covering `[start of previous calendar month, now)`; run 1 makes 20
  P2P calls (measured on 73e4d59c; re-measure on green), run 2 reaches `now - 511 d` (floor;
  measured on green). Red on 73e4d59c: run 1 reads 2017-07-14..2018-05-10.
- Pin P9 (failing window, `binance.p2p-history.test.ts`, own seed): stored cursor
  `now - 30 d - 20 x 30 d` (20 owed windows after the jump); the fetch fake answers a non-`000000`
  envelope for every span inside the newest owed window, every run; one order seeded in each of the
  other 19 windows. Expect per run the owed read order (window starts), measured on green; derived:
  run 1 newest window (fails) then the next 7; run 2 the next 8; run 3 the last 4 and the failing
  one again. Every one of the 19 orders imported exactly once within N runs, N measured on green
  (derived 3; a floor); every run rejects with the parse error; the failing window stays in
  `pending`. Red on 73e4d59c (no jump: forward from the stored cursor, oldest first).
- Pin P10 (more failing windows than a run reads, own seed): as P9 with the 9 newest owed windows
  failing every run: the 11 windows behind them are all read, each order once, within N runs
  (derived 3, measured on green); a plain newest-first order would never reach them.
- Property (`binance.p2p-history.properties.test.ts`): for a generated set of failing owed windows
  (any subset, R from 1 to 8 by the lane cap), every order outside them is imported exactly once
  within `ceil(G / R) + 1` runs and `pending` keeps exactly the failing ground.
- Pin P3 (acceptance, in the step 1/4 real-sqlite file, own seed): world C, empty state, the newest
  P2P order (createTime `now - 2 d`, UAH 1000.00 taker buy) lands on run 1.
- Pin P4 (acceptance, end-to-end, own seed): a Monobank UAH debit of exactly the order's total in
  the 1 h before / 2 h after window; after run 1, `exchangeFundingMatches` (`src/statistics/
  exchange-funding-match/exchange-funding-match.ts`) returns the debit id in `excludedIds` (old value
  for the commit body: not excluded on run 1 in world C).
- Pin P5 upgrade world (own seed): stored P2P cursor 2024-01-01 and one owed point; run 1 reads the
  head window, the point stays owed, `[2024-01-01, now - 30 d)` is in `pending`; runs until empty
  measured, every seeded order imported exactly once.
- Re-pins in `binance.p2p-history.test.ts` (floor 7, titles): "reads 30-day windows forward from the
  history floor, oldest first, both sides of each"; "reads every empty window and imports an order
  behind eight of them"; describe "a first walk of the shape of an account with 113 windows":
  "reaches the first UA-1 order by run 8 and the newest by run 12 at the lane cap" (-> newest on
  run 1, the first order (about 2023-09, about the 38th owed window from the top) by run K
  measured, derived 5 at 8 windows a run), "spends the whole lane on each of the first 11 runs and
  reports none of them finished", "reads each of the 113 windows on both sides, 226 calls, before it
  is current" (226 calls still, read newest-first behind the head); "narrows a start Binance refuses as too old and walks on forward"; "reports complete
  once every window up to now is read and nothing is owed". Each re-pin keeps its subject and states
  the new numbers measured, old values in the commit body (guard facts); an expectation outside
  P2P walk order is NOT edited (report a conflict).
- 1.2-upgrade worlds: before "other suites green unchanged", qa greps every P2P seed with a stored
  cursor older than `now - 30 d` (`walks: { p2p:` / walk-marks helper calls with `'p2p'`) and lists
  them; each is an upgrade world that now jumps.
- Step 1/4 pins stay green unchanged: P1, and the P2 rows (P2P still spends 20 calls a run, so
  the demoted walks keep their measured runs; a moved row is a conflict to report, not a re-pin).
Green (developer): `headFirstGroundOf`, the `newestFirst` option with `newestWindowsFrom`, the P2P
wiring; every file above green. Check: named-file jest on the list (`npx jest <files>
--maxWorkers=2`), `make jest-affected`; `grep -rn "newestFirst" src` names only `walk.ts`,
`binance.p2p-history.ts` and tests (no other walk passes it).

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

`docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md` — every sentence the rulings
(user Q1 newest-first, R1 P2P first) reverse, as file:line on 73e4d59c plus its anchor (lines move:
re-grep the anchor). Each gets the new rule with the old one kept as "was:" (spec text, not a test
comment, so the guard fact does not apply):
- :7 "the user rulings R-Walk A and C-P2P-SELL-MAKER B": add the user ruling 2026-10-28 (P2P
  newest-first behind the head, P2P first in the run).
- :109 row "R-Walk A (user, 2026-10-16)", "The Convert, P2P and fiat walks read forward ... recent
  records arrive last": P2P is the exception (head window, then newest-first behind it).
- :143 row "C-P2P-stop A", "The P2P walk covers `HISTORY_FLOOR_MS` to now, read forward (R-Walk A)":
  head first, then newest-first back to the floor.
- :330 row "The P2P walk ends after 6 empty or refused windows in a row", "it reads forward from
  `HISTORY_FLOOR_MS` to now": same change.
- :896 "The order in `runBinanceSyncAndImport` is: balance, capital, Pay, Transfer, Earn, Convert,
  dust, P2P, fiat": P2P right after balance (R1, stale since 73e4d59c).
- :917 table row "| P2P | `GET /sapi/v1/c2c/orderMatch/listUserOrderHistory`", "(C-P2P-stop;
  R-Walk A)": name the newest-first order.
- :942-955 "Walk direction (R-Walk A, user, 2026-10-16):", bullets "Each walk reads FORWARD from
  `HISTORY_FLOOR_MS`" and "Recent records arrive last": P2P is the exception; add the
  failing-window rule (step 2/4 Part B, stated) and its bound.
- :1023 "The walk reads forward from the floor (R-Walk A), so recent records arrive last.": P2P
  excepted.
- :1028 row "| P2P (30-day windows) | 113 x 2 |", "newest (2026-10, window 113): run 12": newest on
  run 1, previous month whole on run 1, first order by the measured run, floor by run 15 (as
  measured in step 2/4).
- :1246-1248 "R-Walk A: the walk reads forward from the floor" / "Recent orders arrive last: 226
  calls over 12 runs ... the newest at run 12 (probe 10, S12-Q8)": the new order and runs.
- :1870-1871 "R-Walk A: Convert, P2P and fiat read forward from `HISTORY_FLOOR_MS`, so their recent
  records arrive last": P2P excepted.
- :2133 row "| P7b |" (matrix) "recent records arrive last; ... the newest (2026-10) at run 12":
  new result + "was: newest at run 12".
- :2177 row "| P7b |" (test-title table): the re-pinned titles from step 2/4.
- :2259 row "| RW1 |" prose "the walks in spec order, P2P and fiat after dust and before trades":
  "P2P first, fiat after dust and before trades" (its test title was fixed in 73e4d59c; the
  prose is stale since then).
- :2570 row "| P5 |" "floor `HISTORY_FLOOR_MS` read forward, every window read (C-P2P-stop, R-Walk
  A)": the new order.
- Left as is (delivery history of what set 12 shipped): :2537 row "| 12/15 |".
- Any other hit of `grep -n "R-Walk A\|read forward\|arrive last\|capital, Pay, Transfer"` that
  names P2P: the same edit; one that names only Convert or fiat: untouched.
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

- A budget reserve in `canAfford` for other starved lanes (pay/convert behind capital, pre-existing).
- The same head-first order for Convert and the fiat walks (still R-Walk A).
- A device log of the P2P failure code (settled by the caption instead).
- The rest of a window cut by a run's budget waits for the rotation (step 2/4 "Known cost", the
  same as the oldest-first rotation today); a resume-first rule is open question Q4 below.

## Open question Q4 (to the coordinator; the plan proceeds on the recommendation)

A P2P owed window that a run's budget cuts part way (dense, splits) ends at the range cursor, so
under the rotation its rest is read after every older owed window (up to 14 runs in world C).
- A (recommended): keep the strict mirror of `windowsFrom` as planned. Sound for every failing
  set, R = 1 included; the cut rest is rare (a 30-day P2P window holds at most 100 x 50 pages per
  side before a split) and the same cost every walk has today.
- B: read a window whose read committed a span but did not finish first next run, then rotate.
  Needs a new mark (the committed-span start), more surface; a window that splits and fails at
  the same span every run would then take one window of every run.
- C: "end at or before the cursor" instead of "before": the cut rest comes first, but with R = 1
  a window that fails every run is read first every run, so the ground behind it never is
  (fails the user's rule).
