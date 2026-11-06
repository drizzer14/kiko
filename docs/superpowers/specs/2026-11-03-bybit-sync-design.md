# Bybit sync design (track 1.4-bybit)

Status: the user's approval of the earlier text is given, DONE 2026-11-04 (O41, O59). O62 changed the scope after
it: nothing in this track needs the user's money. O64 added stage E after it: spot trades and converts, in the same
release (Q5 "E + A"). O65 added stage F: the Funding wallet ledger, in the same release (Q6 "B: Add to 1.4"). Stages A, B, E
and F stay. Rows the live API docs cover ship "docs only".
R1 and the second key ran, and their results are in this text (O60). The empty mainnet read ran (MEASURED 2026-11-05, section 10). No testnet run took place (O75). App code starts at set 2, on the commit of this text (O62, O63 (e); was: after R2 to R4, O36). Q1 to Q7
are answered, and Q-b is answered too (O69, section 13). The terms verdict is in section 9: PASS WITH CONDITIONS for global
accounts. The user accepted the 5.2.2 and 6.5 doubts (O42). Base 57130e23c.
O75 and O76 (2026-11-05) changed this text. No testnet reading exists, and none will: key creation on testnet answered 10024 at step B1, and the user ruled "Accept no testnet". Earn is not read (clause "E2 and E4"). A tracked Unified coin with an open spot order is set aside (rule 6b). A text below that names a testnet proof is a record, and nothing rests on it.
Plan: `docs/superpowers/plans/2026-11-03-bybit-sync.md`.

Inputs: `.superpowers/sdd/1.4-bybit/rulings.md` (O1-O76, binding; O61 (a) and (b) are replaced by O62),
`report-r1.md`, `report-no-money.md`, `report-q5.md`, `report-o65.md`, `review-7a2391ca8.md`, `review-32337df0d.md`, `review-d80d46d02.md`, `terms-verdict.md`,
`research-bybit-docs.md`,
`research-bybit-legal.md`, `seam-map.md` (same folder), the brief `memory/refs/brief-1.4-bybit.md`,
`memory/refs/bybit-okx-second-check-2026-11-03.md` and `memory/refs/bybit-terms-2026-11-03/` (main checkout), the skills
kiko-exchange-sync, kiko-compliance, kiko-architecture, kiko-domain, kiko-translator, kiko-testing.

Evidence levels, per line:

| Level | Meaning |
|---|---|
| QUOTE | Exact doc text in the research files |
| SUMMARY | A digest of a doc page; never quoted as Bybit's words |
| UNVERIFIED | Not found; never stated as a fact here |
| CODE | Read in this repository at the base; re-grep on any other base |
| MEASURED | A real call or a real run, with its date |
| COMPUTED | Derived from constants named beside it; each names what makes it MEASURED |
| UNPROBED(Pn) | A row resting on a response shape no call has shown; code that needs it waits for Pn |
| docs only | A row that rests on the live doc pages of section 3 and no live reading (O62). It needs no probe before code. Its open items have the safe reading of section 3, "Safe readings" |

"docs only" against UNPROBED: an UNPROBED row waits for its probe, and a kind that fails stays unread. A "docs only" row
does not wait, because no free probe exists and O62 accepts the docs as the source for what they cover. The rule "only
tested data kinds ship" no longer holds for these rows. A "docs only" row never decides a current balance: section 3
measures what a row feeds. Earn and `locked` can make a current balance wrong, and no reading settles them (O75). So neither is guessed: Earn is not read, and a coin with `locked` is set aside (rule 6b, O76).

A number here is a floor or a computed value, never a duration. The developer re-greps every code
fact; symbols are named, not lines.

Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-11-05): this track closes none.
`20261103T2057-kiko-1-4-bybit/1` (key expiry and renewal) stays open until R7. Left open and touched:
`20261017T1639-kiko-binance-backfill-fix/1` (the walk-state gate checks the
institution, not the connection; holds for Bybit the same way, same provider only),
`20261021T1839-kiko-binance-set9/1` and `/2` (the second is the `exchangeMinorUnits` log per rounded
amount; Bybit inherits it), `20261023T0356-kiko-binance-set12/1`, `/2`, `/3` (the cost of merged
owed ranges; narrower windows pay more, see section 5). Every other open gap is unrelated.

## 1. Intent

Kiko answers "how much money do I have now". This track adds Bybit, so a user who keeps money on
Bybit sees it in that answer, with a read-only key that stays on the device.

Goals:
1. Stage A alone answers the question: one holding per coin and wallet (UNIFIED, FUND, Earn) from a
   read-only key.
2. Stage B adds rows from the live API docs ("docs only", O62), complete on its own. A shape the docs do not
   give is refused and owed, never guessed into a shown amount.
3. Stage E adds spot trades and converts, also docs only (O64), so the past of the net-worth line holds for a user who
   trades (section 3, "The worked example"). Stage F adds what only the Funding wallet's own record shows, also docs only (O65): a
   row lists only when no other series explains it. A row that may be explained is held and counted, so the ledger adds a lost row and
   not a double count, except in the cases named in section 3, "What stays wrong".
4. Every limit shows in the UI: global accounts only, the EU limit, the key of about 90 days, the kinds not
   read (USER ruling), and, where the past is drawn, what the past cannot hold (section 8, `statistics.bybitPastLimits`).
5. Nothing needs the user's money (O62).

Non-goals: OKX (USER); interest, bonus, airdrop and the other Unified log entries that are not spot trades, Earn orders and
yield (deferred, O37, O64, Backlog); a region field or host list (O1); any P2P call (O5); Earn products other
than FlexibleSaving and OnChain; derivatives P&L; loans; sub-account reads; renames of `Binance*`
name-only lines (O7); Bybit EU accounts (EU 7.4, section 9); a device-region check (Binance precedent C2; terms verdict
line 9).

Anti-goals, each with its guard:

| Anti-goal | Guard |
|---|---|
| A wrong balance | Strict UNIFIED read; a failed wallet keeps its last balance; a coin with a borrow is refused alone; Earn is not read (O75; was: added only after the double-count probe P3 on testnet); a tracked Unified coin with `locked` above zero or not decimal text is set aside (O76); connect refuses a key that cannot read a shipped kind, by one real read of each route (O13, section 6.8) |
| A key leak | Keychain through `hardenedFor`, pins and `no-store` from the first client commit, the `check:plist` regex fix before that commit, no key in a log, state or `.kiko` without the toggle |
| A hidden feature | No flag; the catalog entry and registry wiring land last, after the device check (O9); every kind not read is stated |

What changed from the old spec (`2026-10-15-crypto-exchanges-design.md`, "What 1.3-b adds"), the
was column of each ruling that narrows it:

| Topic | was: old spec | now |
|---|---|---|
| Hosts | a region field and a host list per region, 2 pins each | one host `api.bybit.com`, no retry (O1; MEASURED 2026-11-04, R1: retCode 0 for this account) |
| Key of a BTC row | Binance rule: BTC keeps the bare id | every key carries `:<COIN>`, BTC too (O4) |
| Layer | `Pager` and `SignRequest` interfaces assumed | neither exists (`git grep`: 0 hits); new reader at the `walkSpans` `read` seam (O8) |
| Budget | request-count budget of 600 per 5 s per IP beside weights | per-route request limits set one gate interval and lane caps; 600 per 5 s is never near (section 5) |
| `.kiko` | a secrets entry with a version guard | a secrets entry, no bump (O10, section 6.6) |

## 2. Rule by rule against kiko-exchange-sync

A shared rule is never assumed. Verdict: HOLDS, CHANGES, N/A.

| # | Binance rule | Verdict | Bybit rule | Evidence |
|---|---|---|---|---|
| 1 | One holding per coin and wallet | HOLDS | Keys `<COIN>:unified` and `<COIN>:fund` (no `earn` wallet in the code: O75, fix round A) under `metadata.bybitAsset`, matched by the neutral `upsertByMetadataKey` | CODE; O4 |
| 2 | BTC legacy keys, `renameFromDefaults` | N/A | No legacy row exists; no rename, no mark | O4 |
| 3 | Spot strict, others tolerant per wallet | CHANGES | `query-api` first: an expiry class refusal fails the sync at once, any other failure of it is tolerated (keeps the stored expiry). UNIFIED strict (proof of life). FUND tolerant. Earn is not read (O75; was: tolerant, both categories in one guard) | CODE for the shape; MEASURED 2026-11-04 for `query-api` (R1); MEASURED 2026-11-05 for the empty bodies (P2); docs only for a coin row |
| 4 | A malformed top level writes nothing | HOLDS | A body with `retCode` 0 and no list of its route is a failure, never a zero: `result.list` for UNIFIED, Earn and transfer, `result.balance` for FUND, `result.rows` for deposit, internal deposit and withdrawal. Was: `result.list` for all, which the pages do not say | CODE; QUOTE for the envelope and the row lists (live pages, section 3); `result.balance` MEASURED 2026-11-05 on the empty account (`balance:[]`) |
| 5 | A coin the good read does not list is a zero | HOLDS for UNIFIED | QUOTE "If not passed, it returns non-zero asset info". FUND: whether it lists zeros is unstated; the same zero rule holds either way | QUOTE; docs only for FUND (no coin row was read, O75) |
| 6 | A refused coin skips only itself | HOLDS | Malformed or oversized coin omitted alone, logged by wallet only; CHANGES by one reason: a non-zero `spotBorrow` or `borrowAmount` refuses the coin too (PLANNER CALL 3) | QUOTE ("Old walletBalance = New walletBalance - spotBorrow") |
| 6a | A loan field that is no decimal text (O73 (b), O76) | CHANGES | A loan field (`spotBorrow`, `borrowAmount`) that is not decimal text refuses the coin, and `bybitCoinRefused` names it. The docs show one sample, `"borrowAmount": "0.0"` and `"spotBorrow": "0"`, and no rule (docs check of 2026-11-05). If Bybit sends "" for no loan, every UNIFIED coin is refused on the first real account: the user knows this, and ruled "Keep refusal" (O76). Was: UNVERIFIED until set 1 step 10/11 reads real coin rows, and a block on the set 7 device build; no reading exists, and the block is gone. The account must not look empty: section 3, "An account with every coin set aside" | CODE; QUOTE for the sample; accepted residual (O76) |
| 6b | `locked` on a tracked Unified coin (new, O76) | CHANGES | `locked` above zero, or `locked` that is not decimal text, sets the coin aside. No amount is guessed. A held coin keeps its earlier balance and `bybitCoinOpenOrder` says so. On a first sync the coin is absent, with the same text. FUND has no such field. Section 3, "The `locked` set-aside" | QUOTE for the field: "Locked balance due to the Spot open order". The docs do not state whether `walletBalance` includes `locked` (docs check of 2026-11-05) |
| 7 | Dust and appear rule | HOLDS | `curatedCoins.dustBelow` is neutral: below it no new holding; an existing holding is written, zero included | CODE |
| 8 | Tracked coin list | CHANGES | `isTrackedBybitAsset` = `isCurrency` and (`isCrypto` or `BYBIT_FIAT_CODES`). `BINANCE_FIAT_CODES` is NOT reused | MEASURED, next row |
| 9 | The fiat ticker trap | CHANGES | `BYBIT_FIAT_CODES` = USD, EUR, AED, BRL, PLN: the app's fiat codes among the quote coins of the 520 public spot rows. Two Bybit base coins equal an app fiat code: MNT and SCR, both coins, so neither is fiat. UAH is no Bybit spot quote, so a UAH balance lists as not tracked. The list stays these 5 codes (O19). Whether a wallet can hold another fiat is UNVERIFIED: such a coin lists as "not tracked", visible, with no wrong amount. A complement list could price a new coin as fiat, which is a wrong balance; a short total with a visible line is not | MEASURED 2026-11-03, `/v5/market/instruments-info?category=spot`; re-read at set 3; UNVERIFIED for another fiat in a wallet |
| 10 | Curated coins on the exchange | CHANGES | Of 23 curated coins (floor), ZEC, DAI, FDUSD have no Bybit spot row. They stay tracked: the rule is the app's, not the market's | MEASURED 2026-11-03 |
| 11 | `exchangeMinorUnits`, balances round | HOLDS | Balance use rounds, logged by gap `/2` | CODE |
| 12 | Rows are exact at `baseAssetPrecision` scale | HOLDS for stage B, CHANGES for stage E | A stage B row with more decimals than the scale on a non-`reducedScale` coin stops `amount-precision`: that record stays owed at its point, its other rows import, the balance stays right, and the caption shows once the point is a day old. Public `basePrecision` is at or under the stored scale for every curated coin on spot, but it bounds orders, not deposits, so it proves nothing for a row. A log `change` and a convert amount round half away from zero at the scale, through a new `AmountUse` `rounded-row` (PLANNER CALL 42): the page's own convert sample has 15 decimals, and a fee of a fill runs past the scale, so a refusal would owe nearly every such row. Error: at most half a minor unit per row. `row` and `trade-row` stay as they are, so Binance's rows do not move | CODE; MEASURED 2026-11-03; QUOTE for the sample; docs only for row decimals |
| 13 | Settled deposit | CHANGES | Settled: 3, 70012, each only with `depositType` 0 (PLANNER CALL 30). Failed, nothing owed: 4, whatever its `depositType`, an absent one too. Final, nothing owed: `depositType` 50, whatever its status and time, once 4 and 70011 are read (PLANNER CALL 118; was: owed, CALL 30). Owed point: 0, 1, 2, 7, 70013, 10011, 10012, any unknown status, and a settled status with any other `depositType` (10, 20, absent, unknown). A row of these with no time makes no row and owes its span in the `deposit` series (rule 47, PLANNER CALL 37). 10012 stays owed: the page says "Credited to funding pool successfully", and no page says that this is final. Status 3 on the enum page: "this is final status ... If a blockchain rollback occurs, the deposit will be assigned a 7XXXX status" | QUOTE (live enum page); docs only |
| 14 | Removal of a settled row | CHANGES | 70011 on a read record removes its row through `SettledSpan.removed` (`removeSyncedRows`, by key, no balance move), the fiat precedent. Removal goes by key, so a 70011 row with no time still removes (A35; was: the sort of rule 19 dropped it first). Status 7 or 70013 on a record whose row exists owes its point, and the row stays until a final status. A rollback seen only inside the re-scan or a point: one older than the 29-day re-scan leaves a stale ledger row, while the balance read stays right. An accepted residual: Q3 (section 13), with its effect on the past of the net-worth line stated by Q5 and accepted by O64 | QUOTE (live enum page); CODE; docs only |
| 15 | Settled withdrawal | CHANGES | Settled: `success`. Final, nothing owed: `CancelByUser`, `Reject`, `Fail`. Owed point: `SecurityCheck`, `Pending`, `MoreInformationRequired`, `Unknown`, any other, and `BlockchainConfirmed`. The page lists these words and does not say how `BlockchainConfirmed` relates to `success`. Cost if `BlockchainConfirmed` is an end state: such a row never imports, its point is read on each run (1 call of the lane cap), and the caption stays until the floor passes it. That is a missing row: the past of the net-worth line reads high by its amount before it, spending is short by it for good, and the caption shows (O63 (d)) | QUOTE for the words (live enum page); docs only |
| 16 | Settled internal deposit | CHANGES | 2 settled, 3 final failure, 1 owed. Any other value is unreadable and owed | QUOTE (live page); docs only |
| 17 | Settled transfer | CHANGES | `SUCCESS` settled, `FAILED` final, `PENDING` and other owed | QUOTE (live enum page); docs only |
| 18 | Second-level reads, `reach` | CHANGES | R36 was Earn only. QUOTE: deposit and transfer "the query logic is actually effective based on second level". All four Bybit series pass a `reach` with the start floored to the second, harmless if a route reads at the millisecond; a stuck record there owes its own point. Deposit `reach` has no end, and withdrawal `reach` starts at the floor (PLANNER CALL 29) | QUOTE; CODE (`pointOf`); docs only |
| 19 | Oldest to newest within a window | CHANGES | Page order is undocumented for these routes (execution list: descending, equal times unstable, SUMMARY). A span commits as one unit after all its pages, sorted by time then key before `settleRecords`, so page order has no effect on what commits. The sort leaves a row with no time out; that row makes no row, owes by rule 47, and a 70011 among them still removes by key (rule 14) | CODE; docs only |
| 20 | Per-record commits, rows before marks | HOLDS | `commitSettledSpan`, unchanged | CODE |
| 21 | Cursor marks, `patchExchangeState` | HOLDS | Already takes `exchangeId` (`exchangeStateDepsOf('bybit')`). Bybit's opaque `nextPageCursor` is never stored: it lives inside one span read | CODE; PLANNER CALL 6 |
| 22 | Offset paging, drift, `fetchAllByTotal` | N/A | No `total`. The drift rule becomes: a repeated `nextPageCursor`, or a row outside the span by both readings of its window field, is `bybit-page-drift`, owed in that series (a withdrawal: neither `createTime` nor `updateTime` in the span; a deposit: `successAt` before the span's floored start; PLANNER CALL 29). In the capital walk the span is owed as a range tagged with the drifted series, in every pass: the forward pass goes past it (`isOwedPast`), the other series of the span commit, and the cursor moves on (PLANNER CALL 117; was: the forward pass held the cursor for all three series). An empty or absent cursor ends the span, and a page with no row ends it too, whatever its cursor says. A pending row with no time is never `bybit-page-drift`: rule 47 | QUOTE for the cursor; docs only |
| 23 | Pending, re-scan and points passes | HOLDS | `planWalkPasses`, `runWalkPlan`, as is | CODE |
| 24 | `MAX_PENDING_RANGES` 12, merged ranges | HOLDS, costlier | A merged gap costs gap/window windows; 7-day windows pay 4 times what 29-day windows pay. Inherited gaps stay open | CODE; COMPUTED |
| 25 | Floors | CHANGES | One rolling floor: `now - 729 days` for every stage B series, the Transfer precedent (`transferFloorMs`, never ask at the documented edge). No stage B series has a stated retention. P12 can move a floor only by a refusal (O20): an empty answer with `retCode` 0 proves nothing and keeps the 729-day floor. R1: all 4 series served all 4 windows, up to 729 days, 0 rows, no refusal, so the floor stays 729 days. `walk/depth.ts` stays out (offset tied). Stage E: the log takes the same floor (QUOTE "up to 2 years"). The convert history has no time parameter and no stated retention; a convert older than the floor makes no row, so one old row never moves the default range (`spanStart`) and every kind stops at the same date (PLANNER CALL 49) | CODE for the precedent; UNVERIFIED for retention; MEASURED 2026-11-04 (R1, P12) |
| 26 | What a rolling floor drops | HOLDS, stated | `cutToBounds` drops owed ground the floor passes, unread, points too. An app left closed past the floor loses the rows of that gap, not any balance. The floor is Kiko's, so the holding footer says "records older than two years" (was: "older than Bybit keeps", which rule 25 contradicts) | CODE |
| 27 | `HISTORY_FLOOR_MS` as `restartMs` | CHANGES | `BYBIT_RESTART_FLOOR_MS` (`bybit.restart-floor.ts`) = 2017-01-01, earlier than any rolling floor, and at or below Binance's `HISTORY_FLOOR_MS`: a later switch to Binance on the same account would otherwise lose BTC history below the mark. `planWalkPasses` ignores a mark at or below the floor | CODE; PLANNER CALL 7 |
| 28 | `multiCoinSince`, `multiCoinSeen`, backfill | N/A | No BTC-only history exists, so no walk writes them, and `backfillGroundOf` is not called; a test pins the marks absent | O4; CODE |
| 29 | Disconnect reset | HOLDS | `disconnectExchange(accountId, 'bybit', BYBIT_RESTART_FLOOR_MS)`, then the Bybit clear. `exchangeStateReset` keeps walks only, so the stored key expiry goes with it. Holding keys stay, so a same-account reconnect re-adopts | CODE |
| 30 | Institution gate | HOLDS | Takes the id already; gap `20261017T1639/1` applies within one provider | CODE |
| 31 | Rate limit, cooldown | CHANGES | `retCode` first (O3). 10006, 10018: cooldown to `X-Bapi-Limit-Reset-Timestamp` when usable (a time after now and within 10 minutes), else 60 s default. HTTP 429 uses the same cooldown. HTTP 403: 10 minutes (docs). Own module Map; a balance read inside it makes no request, and the provider answers by the cooling rule: an account with a stamped Bybit holding (a Bybit key and a sync stamp) skips silently, with no balances, so "Last sync" and the balances stay as they were (O81); any other account fails with the refusal text `bybitForbidden`, so a retried first connect never reports success on an empty account, and a reconnect after a disconnect never counts a kept holding with no stamp (O83) | QUOTE, SUMMARY; MEASURED 2026-11-04 for the header on an ok answer (R1, P16: 13 digits); on a 10006 it is docs only |
| 32 | Budget | CHANGES | `createBybitRunBudget` behind `RunBudget`: calls per lane only, no weights; `recordFailedCall` analogue counts a refused call. Section 5 | CODE; COMPUTED |
| 33 | One pacing gate per run | HOLDS | `createExchangeRun`, interval from the slowest route read (section 5) | CODE; QUOTE (limits) |
| 34 | `isUnreadableWindowError` | HOLDS | `BybitHistoryParseError` alone; rate limit, refused key, clock skew and network stop the run | CODE |
| 35 | A walk failure never fails the balance sync | HOLDS | `logOnFailure` per walk | CODE |
| 36 | Caption: behind | CHANGES | `CAPTION_WALKS` per provider, with a required parameter and no default to Binance (O30). Reusing the 8 would keep "behind" up forever (`null` cursor). Stage A: none. Stage B: `capital`, `transfer`. Stage E: also `log`, `convert`. Stage F: also `fundingLedger` | CODE; seam 4 |
| 37 | Caption: paused, coin lines, not imported | CHANGES | The `connectedProvider === 'binance'` gates become "an exchange with a walk state". Tracked predicate per provider | CODE; seam 3 |
| 38 | Caption: P2P read failed | N/A | No P2P walk (O5); the gate is `coinLinesShown` (`crypto-sync-section.component.tsx`), true for any exchange. Bybit state has no P2P mark, so `p2pReadFailed` is false and the caption never shows | O5; CODE |
| 39 | Trades | CHANGES | No Binance-style read per symbol (`readIdCursor`, `tradeCandidatesOf`, the `trades` state). Bybit's spot trades come from the Unified log, one row per log row: rule 49 (O64; was: not read, O37) | QUOTE (live page); docs only |
| 39a | Dust, fiat, Pay walks | N/A | No such routes | Rulings |
| 40 | Namespaced `externalId` | HOLDS | `<accountId>:` prefix, then the kind, the record id and `:<COIN>` (O4, memory exchange-ids). A log row and a convert leg: section 3, stage E | CODE |
| 41 | Network fee out of the ledger line | HOLDS | `amount` as Bybit reports it, with no sum, no subtraction and no fee line. No page says whether it holds the fee. The row feeds no current balance, and it feeds the past of the net-worth line and spending (section 3, "What a row feeds"): off by at most the fee of that row, the same error Binance's rows carry. The later real-money run (Backlog) compares it (O47, O58) | QUOTE for the fields; CODE (`plannedWithdrawalOf`) for the precedent; docs only |
| 42 | `untrackedCounterpart`, wallet codes | HOLDS for transfers | The enum page's `accountType` holds UNIFIED and FUND. The transfer page's own sample shows SPOT to UNIFIED, so an older word can reach a real account. Any wallet word but UNIFIED and FUND is `bybit-transfer-wallet-unknown`, owed; `UNTRACKED_WALLETS` gets no member. Cost for a user with such rows: one owed point each, read on each run within the lane cap, with the caption, for up to 729 days, and that transfer is a missing row: the wallet Kiko tracks reads high by it before the move, and so does the sum | QUOTE (live enum and page); docs only |
| 43 | Funding matcher | HOLDS | Bybit writes no `p2p`, `card` or `bank` code, so `fundingOf` skips its rows. `EXCHANGE_NAME` stays | CODE |
| 44 | Thrown errors are named classes | HOLDS | `BybitHistoryParseError`, `BybitRateLimitError`, `BybitRefusalError` with a fixed message and a `code` | CODE (`kiko-no-literal-sync-error`) |
| 45 | A series knows its wallet (`walletHoldingOf`) | CHANGES | Bybit deposit and withdrawal rows name no wallet (O14), and the live pages name none: `depositType` holds 0, 10, 20, 50, which are no wallets. So outcome (b) holds (O62): every deposit, internal deposit and withdrawal row goes on the FUND holding, and clause W1 says so (section 8). No row moves a balance (CODE: `addManyDedup` "never touches `holdings`"; the balance comes from the wallet read). A row on FUND creates a FUND holding at zero if none exists, so such a holding can show 0. The sum over one coin's wallets in the net-worth line does not change, and each wallet's past does: FUND can read below zero there. `earlierHistory` is off for Bybit (PLANNER CALL 27). Was: outcomes by P4 and P6 | QUOTE (live pages); CODE; docs only |
| 46 | Earn positions add to the Earn wallet | NOT BUILT (O75: Earn is not read; the text is a record of the rule that would have held) | One rule, no guess left (O18, O31). A row with a `status`: the allowlist applies, default `Active`, confirmed by P3; any other status leaves the position out, counted, and the account shows `bybitEarnLeftOut`. A row with no `status`: its `amount` adds. The testnet run redeems Flexible Savings and runs P3 (section 10, "What proves Earn"). If that run shows a redeemed row with no `status` and a non-zero `amount`, FlexibleSaving does not ship, and clause E4 says so (section 8). A redeemed FlexibleSaving row never adds. The research names `Processing` and `Active` for OnChain only, and a digest says redeemed FlexibleSaving rows still appear | SUMMARY; no reading (O75) |
| 47 | A record has a settle time | CHANGES | A deposit with an empty, 0 or absent `successAt` and a status that is not final (anything but 4 and 70011) makes no row and owes its span as a range in the `deposit` series (PLANNER CALL 37, O63 (b); was: owes nothing, CALL 28; before that: the span in every series, O32). This covers a pending row, status 3 with type 0 and no time, and a held deposit (type 10 or 20). Type 50 is final and owes nothing, with or without a time (PLANNER CALL 118; was: a held deposit that owes). The range holds back neither the other series nor the forward pass (`isOwedPast`), costs 1 call per run within the lane cap, shows the caption at once, and clears when a read returns the row with a time or no longer returns it. So a row survives past the 29-day re-scan under a window on its creation time. Under a window on `successAt`, a row with no time is in no window, and the forward pass returns it when it settles. A no-time row never gives `bybit-page-drift`, and the sort of rule 19 leaves it out. Cost: a deposit Bybit blocks for good keeps the caption and 1 call per run until the floor passes it; while it waits it is a missing row (section 3) | CODE for `owedBy`, `isOwedPast`, `commitSettledSpan`, `planWalkPasses`; QUOTE for the field; docs only for the form |
| 48 | Connect checks no permission (Binance, section 6.8) | CHANGES | Connect refuses `readOnly` not 1, `isMaster` not true, and a 10005 on one real read of any shipped route, before any Keychain write, with a text per reason (O13, PLANNER CALL 25). A later 10005 on one wallet shows `bybitWalletRefused` with the wallet name, and the last balance stays | MEASURED 2026-11-04 (R1, second key); QUOTE for master only |
| 49 | Spot trades (new, O64) | CHANGES | A `TRADE` log row with `category` spot imports one row on `<COIN>:unified`, amount `change`, marked as an exchange leg; any other `type` imports nothing and is named in `bybitLogLeftOut`. Section 3, stage E | QUOTE (live pages); docs only |
| 50 | Converts (new, O64) | CHANGES | The convert history is the one source of a convert. `success` imports two legs; `CURRENCY_BUY`, `CURRENCY_SELL` and `CONVERT` log rows never import, so under the pages a double count cannot happen. A convert that Bybit also shows as a spot `TRADE` would double; no page says so, and "What stays wrong" names it (O66 (b)). Section 3, stage E | QUOTE (live pages); docs only |
| 51 | The Funding ledger (new, O65) | CHANGES | One pure rule, `matchFundingLedger`, runs over every stored ledger row and source record of the account on each run, so the result does not depend on arrival order. A ledger row is `explained`, `listed`, `held`, `waiting` or `earnMove`. Only `listed` writes a row: one row on `<COIN>:fund`, amount `txnAmt`, marker `ledger:funding`, out of spending. Section 3, stage F | QUOTE (live pages); docs only |

## 3. Data per stage

Each row states its level; the paths and params are from the docs, and the limits are MEASURED (section 5). The docs of
record are the live pages, read 2026-11-04, not the raw repo files, which are older and differ:
`https://bybit-exchange.github.io/docs/v5/asset/deposit/deposit-record`, `.../asset/deposit/internal-deposit-record`,
`.../asset/withdraw/withdraw-record`, `.../asset/transfer/inter-transfer-list`, `.../enum`, `.../account/wallet-balance`,
and for stage E `.../account/transaction-log`, `.../asset/convert/get-convert-history`, `.../asset/convert/guideline`,
`.../rate-limit`, and for stage F `.../asset/fund-history` and `https://bybit-exchange.github.io/docs/changelog/v5`, read 2026-11-04 with `curl -q -sS -m 30`.
Each field named below was checked on them.

### Stage A: balances (3 calls per sync; was: 5, with two Earn reads, O75)

| Read | Endpoint and params | Window | Page | Row fields used | Key | Wallet | Evidence | Probe |
|---|---|---|---|---|---|---|---|---|
| Key info | GET `/v5/user/query-api`, none | none | none | `expiredAtMs` (a number; an epoch or an unparsable date reads as unknown; `bybit.client.ts`), `deadlineDay` on a sync; also `readOnly`, `isMaster` at connect only, never stored (O13); every other field is dropped at the parse, `permissions`, `userID`, `kycRegion`, `note` never reach state | none | none | MEASURED 2026-11-04 (R1): `readOnly` number, `isMaster` boolean, `expiredAt` string of shape 9999-99-99T99:99:99Z, `deadlineDay` number | MEASURED (P1) |
| UNIFIED | GET `/v5/account/wallet-balance`, `accountType=UNIFIED` | none | none listed | `coin`, `walletBalance`, `spotBorrow`, `borrowAmount`, `locked`; `equity` and `usdValue` never | `<COIN>:unified` | UNIFIED | QUOTE for the param and the fields. `locked`: QUOTE "Locked balance due to the Spot open order". The docs do not state whether `walletBalance` includes `locked` (docs check of 2026-11-05), so the app sets the coin aside (rule 6b, O76). Was: the sum "walletBalance - totalPositionIM - totalOrderIM - locked - bonus" read as `locked` inside `walletBalance`. That sum is no evidence for UNIFIED: it sits under "Derivatives available balance", it starts "isolated margin:", and it is in the row of a field deprecated for UNIFIED. HTTP 200 and 10005 on a key with no box for it: MEASURED 2026-11-04 | Route MEASURED (P11). Empty shape MEASURED 2026-11-05 (P2): `list:[{coin:[]}]`. A coin row: docs only (O75) |
| FUND | GET `/v5/asset/transfer/query-account-coins-balance`, `accountType=FUND`, no `coin`, `withBonus` left out | none | none | `coin`, `walletBalance`; `transferBalance` never; the page lists no `locked` field | `<COIN>:fund` | FUND | SUMMARY | Route MEASURED (P11). Empty shape MEASURED 2026-11-05 (P2): `balance:[]`. A coin row: docs only (O75) |
| Earn, flexible, NOT READ (O75; a record) | GET `/v5/earn/position`, `category=FlexibleSaving` | none | none listed; a non-empty `nextPageCursor` fails the wallet read | `coin`, `amount`, `status`; a row with a `status` adds only if the allowlist holds it, and a row with none adds its `amount` (rule 46, O18, O31) | `<COIN>:earn`, the two reads summed | Earn | QUOTE permission "Earn"; fields SUMMARY; double count UNVERIFIED | Empty shape MEASURED 2026-11-05 (P3): `list:[]`, no `nextPageCursor` |
| Earn, on-chain, NOT READ (O75; a record) | GET `/v5/earn/position`, `category=OnChain` | none | same | same | same | Earn | same | Empty shape MEASURED 2026-11-05 (P3): `list:[]`, no `nextPageCursor` |

Earn is not read, and clause "E2 and E4" ships (O75: no testnet reading exists, so Q7's C holds). The sentences to the end of this paragraph are a record. Earn would have shipped as designed only if P3 on testnet showed staked coins leave UNIFIED and FUND (section 10, "What proves
Earn"). If they stay, no Earn holding is written and the copy says so (clause E3, section 8); the money is then already
counted. With no on-chain position to test, on-chain Earn is not read, and the copy says so (clause E2). If the redeem
shows a redeemed row with no `status` and a non-zero `amount`, FlexibleSaving is not read, and the copy says so (clause
E4, O31). With no testnet reading at all, clause "E2 and E4" holds, and that is the case now.

### The `locked` set-aside (O76)

A rule that O76 reverses, so "was" stands beside "now". The rows apply to a tracked UNIFIED coin, read by `outcomeOf`, one outcome per coin and one line per coin.

| # | `spotBorrow`, `borrowAmount` | `walletBalance` | `locked` | Was | Now | Line |
|---|---|---|---|---|---|---|
| 1 | Both decimal, zero (the docs' sample: "0", "0.0") | Readable | Decimal, zero | Balance | Balance | None |
| 2 | Same | Readable | Above zero | Balance, read as if `locked` were inside | Open order | `bybitCoinOpenOrder` |
| 3 | Same | Readable | "", absent, a word, a number, null, negative, an exponent form | Balance | Open order | `bybitCoinOpenOrder` |
| 4 | One above zero | Any | Any | Borrowed | Borrowed: the loan wins, because it can outlast the order, and its text is definite (PLANNER CALL 78) | `bybitCoinBorrowed` only |
| 5 | None above zero, one not decimal text | Any | Any | Refused | Refused: O73 stands, and the open-order text would promise a clear that may not come (PLANNER CALL 78) | `bybitCoinRefused` (was: `oversizedAmount`) |
| 6 | Both decimal, zero | Unreadable, negative, or past the safe integer | Any | Refused | Refused: a fault in the balance stands after the order ends (PLANNER CALL 78) | `bybitCoinRefused` (was: `oversizedAmount`) |
| 7 | Any | Two rows of one coin | Any | Refused | Refused | `bybitCoinRefused` (was: `oversizedAmount`) |

Other rows:

| Row | Was | Now |
|---|---|---|
| FUND coin. QUOTE: the page's field list and sample hold `walletBalance`, `transferBalance` and `bonus`, and no `locked` (docs check pages, 2026-11-05) | `walletBalance` read | The same: the client drops any `locked`, so the rule is for UNIFIED only (PLANNER CALL 77) |
| Coin the app does not track, any `locked` | Listed when `walletBalance` is above zero | The same. It has no scale, and its loan fields and `locked` are not read. With `walletBalance` zero and `locked` above zero, it is not listed. No money value rests on that line (PLANNER CALL 77) |

What the holding does (the "new holding" and "zero" rules of `appendWallet` stay as they are):

| Holding before | The read | Was | Now |
|---|---|---|---|
| Held, balance B | Set aside | B replaced by `walletBalance` | B stays; the line shows |
| None | Set aside | Created from the dust threshold up | None, a zero included; the line shows |
| Held or none | First good read after the order closes | | Written by the usual rules (below dust with no holding: none); the line clears, because a wallet that read replaces its notes whole (`withBalanceNotes`). A pin holds this (A114) |
| Held | The coin is no longer listed | Zero | Zero: the good read does not list it, and the line clears |
| Any | UNIFIED read fails | Nothing written | The same: the sync fails, and the stored line stands until a good read |
| Created at 0 by a walk's row (`walk.ts`, `balanceMinorUnits: 0`, from set 6 on Unified) | Set aside | B replaced | Stays 0, and the line shows. "With no earlier sync, this coin is not in your balance" stays true, on the net-worth line too: its rows do not count until a first good read (set 11; was: opening below zero). A120 pins it |

Which readers a stale balance feeds (read on the code, 2026-11-05):

| Reader | Effect during an open order |
|---|---|
| Holding balance, Home total, net worth now (`holdingsRepo.balanceOf`) | The earlier balance, or none. The line on the account detail says so. Home has no sign |
| Past of the net-worth line (`createHoldingValuer`) | Was, until set 11: opening = balance - sum of all rows, so a row imported during the order moves the past against the old balance. Now: for a Bybit holding, only rows that the stored balance already holds count, so the past up to the read stays right, the line then holds the last read balance, and the last point stays the number Home shows. Numbers, causes and options: "The past line while a balance is old", below. The fix is set 11, before set 5 (O78). This row is not an accepted residual |
| Set 5 capital walk | None for an open order or a loan: those are on UNIFIED, and every row of this walk is on FUND (rule 45). Yes for a FUND coin that is refused, and for a FUND wallet that is refused or not read: its balance stays old and the walk goes on. So set 11 runs before set 5 (was: "None", which held only for the order) |
| Set 9 convert, set 10 ledger and reconcile | No balance is read: they read rows and the stored set |
| Binance's `spotBalanceTexts` | Bybit's read returns none |
| `conflictingExchangeHoldings`, `OversizedSaleNotice` | Keys only; `metal` only |

Accepted residuals, told to the user with O76, and no "What stays wrong" row: if `locked` is inside `walletBalance`, the set-aside is more than needed; a long-open order keeps the coin old for that time, and a standing order keeps it old or absent for as long as it stands; if Bybit sends "" for `locked` or a loan field, the coin is set aside or refused. The past line in the table above is not an accepted residual: the user ruled "Design a fix" (O78), and the design follows.

### The past line while a balance is old (O78, O83, O85, O87, O88, O89, PLANNER CALLS 86 to 105)

Read on the code, 2026-11-05. `createHoldingValuer` takes opening = balance - sum of all rows, and the value at a day = opening + the rows up to that day. COMPUTED by hand from those two lines; no run. X is any coin.

| World | Stored balance | Rows stored | Was, before the row's day | Was, from the row's day | Truth |
|---|---|---|---|---|---|
| Hold 1 X, an order fills 0.2 X, the coin is set aside | 1 | -0.2 | 1.2 | 1 | 1, then 0.8 |
| The same, with the earlier buy of 1 X also read | 1 | +1, -0.2 | 0.2 before the buy, 1.2 after it | 1 | 0, 1, then 0.8 |
| First sync, the coin set aside, one earlier buy of 1 X, the walk makes the holding at 0 | 0 | +1 | -1 | 0 | 0, then 1 |
| First sync, the same coin, and only a later sale of 0.2 X has arrived | 0 | -0.2 | 0.2 | 0 | Not known: the balance and the older rows are both missing |
| 5 USDT on FUND, the wallet not read, a deposit of 3 arrives | 5 | +3 | 2 | 5 | 5, then 8 |

The causes. A cause fits when a stored balance stays old while a walk can still import rows.

| Cause | Fits | Why, on the code | First set that can do it |
|---|---|---|---|
| A coin set aside for `locked` | Yes | `appendWallet` leaves it out of the batch, so `upsertByMetadataKey` does not run | 6: Unified transfer leg; 9: the log, which is the worst |
| A coin set aside for a loan | Yes | The same filter | 6, 9 |
| A refused coin, UNIFIED | Yes | The same filter | 6, 9 |
| A refused coin, FUND | Yes | The same filter, and rule 45 puts capital rows on FUND | 5 |
| FUND wallet `notRead` or `refused` | Yes | `fetchBalances` skips `appendWallet` for it, and a refused balance route does not stop a walk | 5 |
| A cooling account's silent skip | Yes, at an edge | No balance is written. On Binance's pattern each walk tests the cooldown first, so a row arrives only if the cooldown ends between the two legs. The date below covers it with no code of its own | 5 |
| A holding that a walk's row creates at 0 (`resolveWalletHoldings`, PLANNER CALL 79) | Yes | It has a balance of 0 and no read behind it | 5 on FUND, 6 on Unified |
| UNIFIED read fails | No | `runBalanceSync` throws, so the arm stops before its walks (`runBinanceSyncAndImport` is the pattern set 5 follows) | None |

The options. "Right" means equal to the truth in the worlds above.

| Option | Example 1 (hold 1 X, fill 0.2): before the next read | First sync | Past up to the read | After the read | Worst wrong value | Shared code touched | Binance, Monobank | Size (floors) |
|---|---|---|---|---|---|---|---|---|
| Was | 1.2, 1 | -1, 0 | Wrong by the rows that arrived | Equal to Home | The whole past moves by the rows after the read, below zero too, and has no bound in units | None | Unchanged | None |
| A: date the balance by `syncedAt`; rows after the read still move the line | 1, 0.8: right | No date: forward from 0 gives 0, 1 here, and 0, -0.2 if the sale comes first: a guess (O62), or a special case | Right | Right only when every row since the read has arrived. The last point differs from Home, against the invariant in kiko-domain and `net-worth-series.test.ts` | Below zero when one series is behind another. A disconnect strips the stamp, so the past goes back to "Was", with no later read to heal it | Valuer, and the invariant | Gated: unchanged | 30 code lines, plus the first-sync case and a surviving date; 300 test lines |
| B: hold the walk back for that coin | 1, 1 | 0, 0 | Right | Equal to Home | The account's other coins wait as well: a window and its marks cover every coin in the span, so a standing order stops the walk for as long as it stands. A store of held rows needs a second migration, which the plan forbids | Walk, marks, sets 5, 6, 9 | Walk touched | Over 300 code lines |
| C: while set aside, the coin is flat over its whole past, or the line stops at the last good point, and a text says so | 1, 1, or no point after the read | 0, 0, or no point | Wrong, in the flat form: the real past is gone until a good read. The stop form hides every other holding's recent days too | Flat at Home, or absent | A standing order keeps the past wrong, or the line short, for as long as it stands | Statistics must read `sync_state` per account, new text | Gated: unchanged | 80 code lines; 300 test lines |
| D, chosen by the planner: a date of its own, `balanceReadAt`, written with the balance and kept by a disconnect. A Bybit row counts only if its time is at or before that date | 1, 1 | 0, 0 | Right | The last read balance, which equals Home and the line on the account detail | The stretch after the read is off by what moved since the read. That is the error of the balance itself, which the user ruled in O76. Never below zero by this cause | One filter in the valuer, one line in `runBalanceSyncInner` that derives the write from the list `datedBalances` by `provider.metadataField` (O87; was: one optional field on the provider) | Unchanged: the filter does not run, pinned by A121 | 45 code lines; 350 test lines |

Said plainly: no option makes the line right while the balance is unknown. Option A comes closest in example 1, because the rows there are complete, but no code can tell that they are complete, and on a first sync it has no anchor at all. Option D shows no number that the app does not hold as a fact: a past rebuilt from a read balance and the rows that balance holds, then that read balance. It needs no new text to be true on the account detail. The user ruled this line, Q-i's option A, "A: Hold last read", and added a sentence to the Statistics screen, "Add sentence" (O85; section 13; clause L1S, section 8). Was: it said nothing on that screen, and the user had not ruled.

Option D by order of arrival. T is the read, F a fill of 0.2 X after T, R the next good read with balance 0.8, and "was" is the line before this fix.

| # | World and order | Was | Now | Truth |
|---|---|---|---|---|
| 1 | T, then F's row, no R yet | 1.2, 1 | 1, 1 | 1, 0.8 |
| 2 | T, F's row, then R | 1, 0.8 | 1, 0.8 | 1, 0.8 |
| 3 | T, R, then F's row: F is older than R, and it arrives late | 0.8, 0.8; at arrival 1, 0.8 | The same | 1, 0.8 |
| 4 | T, then an older row of +1, from before T, arrives while set aside | 0, 1 | 0, 1 | 0, 1 |
| 5 | No T, a walk makes the holding at 0, the buy of +1 arrives | -1, 0 | 0, 0 | 0, 1 |
| 6 | No T, the sale of -0.2 arrives first | 0.2, 0 | 0, 0 | Not known |
| 7 | Rows 5 and 6 have both arrived, then a first good read with balance 0.8 | 0, 1, 0.8 | 0, 1, 0.8 | 0, 1, 0.8 |
| 8 | Row 1, then a disconnect, so no read can come | 1.2, 1, for good | 1, 1, for good: the holding is a kept snapshot, and Home shows 1 | 1, 0.8 |
| 9 | Row 8, then the user adds a manual row of +0.5, which moves the balance to 1.5 | 1.2, 1, then 1.5 | 1, 1, then 1.5: a manual row always counts | 1, 0.8, then 1.3 |
| 10 | Row 8, then a reconnect, a coin still set aside | 1.2, 1 | 1, 1: the date stays | 1, 0.8 |
| 11 | Row 10, then a good read | 1, 0.8 | 1, 0.8 | 1, 0.8 |
| 12 | FUND not read, stored 5, a deposit of 3 arrives after T, then a good read of 8 | 2, 5, then 5, 8 | 5, 5, then 5, 8 | 5, 8 |
| 13 | A good read at T, and a fill between T and the walk of the same run | Past off by the fill until the next read | Past right; the fill counts from the next read | Fill counted |
| 14 | A row close to T (F1 of the review of set 11; was: "within 5 seconds of T when the device clock is off"). The window is the device clock's skew plus the time from the answer that holds the coin's balance to T. Example: UNIFIED answers 1 at 12:00:00, FUND is slow, T = 12:00:20, a fill of 0.2 at 12:00:10 | Past off by that row until the next read. The example: 1.2, 1 | The same row can land on the wrong side of T, until the next read. The example: 1.2, 1, and Home stays right at 1. No code bounds the fetch part. See "Row 14 on the code", below. Was: "The window is `RECV_WINDOW_MS`: a signed read fails with 10002 past it" | Row on its side. The example: 1, 0.8 |
| 15 | Q-j, answered: "C: By mark" (O88; F2 of that review; was: OPEN). Row 9's shape, then a reconnect, then a good read. Read 0.1, disconnect, a manual row of +0.5 moves the balance to 0.6, reconnect, read 0.1 | -0.4, then 0.1 | 0.1, 0.1: the read's write puts the manual row on the mark, and the line skips it. Was, before O88: -0.4, then 0.1. The other sign, read 1, a row of -0.5, read 1: was 1.5, 1; now 1, 1 | Not known: 0.1, 0.1 if the 0.5 never reached Bybit, and then the line is right; 0.1, 0.6, 0.1 if it came and left before the read, and then the line misses the rise |
| 16 | Q-k, answered: "A: No balance move" (O89; PLANNER CALLS 94, 95; was: OPEN). Row 15, then the user deletes the +0.5 row. The row goes, and `transactionsRepo.remove` moves no balance, because a balance that the read overwrote does not hold it. The confirm names no change for this holding | Home -0.4; line -0.4, -0.4 | Home 0.1; line 0.1, 0.1. Was, before O89: Home -0.4; line -0.4, -0.4: below zero, until a good read. With a second disconnect or the coin set aside, no read came | Home 0.1; line 0.1, 0.1 |
| 17 | Q-k, answered (O89; was: OPEN). Row 15, then the user edits the +0.5 row to +0.7, or to -0.5. `transactionsRepo.update` writes the row and moves no balance. The row keeps its id, so it stays on the mark. The list shows the new amount, and spending follows it | +0.7: Home 0.3; line -0.4, 0.3. -0.5: Home -0.9; line -0.4, -0.9 | Both: Home 0.1; line 0.1, 0.1. Was, before O89: +0.7: Home 0.3; line 0.3, 0.3. -0.5: Home -0.9; line -0.9, -0.9, until a good read | Home 0.1; line 0.1, 0.1 |
| 18 | Row 15, disconnect, a second manual row of +0.3 moves the balance to 0.4, reconnect, read 0.1. Before that read the second row is not on the mark. The read replaces the list with every row that is not a Bybit row, so both are on it | Before the read: -0.4, 0.1, 0.4. After it: -0.7, -0.2, 0.1 | Before the read: 0.1, 0.1, 0.4. After it: 0.1, 0.1, 0.1 | 0.1 flat if neither row reached Bybit. Row 15's "came and left" applies to each |
| 19 | Row 18 up to the reconnect, and the coin is set aside, cooling or not read, so no upsert runs. Row 9 holds: the balance holds the second row. `balanceReadAt` and the list stay as they were | -0.4, 0.1, 0.4 | 0.1, 0.1, 0.4. Home 0.4 | 0.1, 0.1, 0.4 as typed; the next good read decides |
| 20 | Q-l, answered: "A: C stands" (O89; PLANNER CALL 93; was: OPEN). Read 1, disconnect, a manual row of +0.5 for a move that really arrived, reconnect, read 1.5, and no walk lists the move (a P2P credit on Unified, a derivatives profit) | 1, 1.5: right | 1.5, 1.5, as the user ruled: wrong before the row's day, and never below zero by this cause. The other sign, read 1, a row of -0.5 that really left, read 0.5: was 1, 0.5; now 0.5, 0.5 | 1, 1.5 |
| 21 | Q-l, answered (O89). Row 20, and a walk also writes the move as a Bybit row dated at or before the read | 0.5, 1.5: counted twice. With read 0, +1, read 1: -1, 1 | 1, 1.5: right. This is the world that holds the ruling | 1, 1.5 |
| 22 | Read 1 X, disconnect, an Exchange of 0.5 X to 100 USD on a cash holding, reconnect, read 1. The leg on X goes on the mark. The leg on cash is on another holding, which no read overwrites. The list shows both, and spending still leaves both out by their marker. Deleting either leg removes both: row 25. The form cannot write this leg, and a file can: row 25 has the app's own shape (PLANNER CALL 99) | X 1.5, 1; cash 0, 100 | X 1, 1; cash 0, 100 | X 1, 1 if the 0.5 never left Bybit; cash as typed |
| 23 | Read 1, disconnect, the user sets the balance to 1.5, which writes a manual row of +0.5 with `setsBalance`, reconnect, read 1. The read overwrites it as it does any balance: `upsertByMetadataKey` does not read `balanceSetAt`, and `balanceSetRowId` stays. Its delete and edit: row 28 | 0.5, 1 | 1, 1 | 1, 1 if the typed balance was wrong; row 20 if it was right |
| 24 | A restored file whose mark names a row that does not exist, or that is a Bybit row, or whose value is not a list of strings | No such key | The same line as without it: the valuer only tests a row's id against the list; it builds the set of ids once per dated holding and tests it only for a row that is not a Bybit row. A value it cannot read is an empty list. The next good read replaces it. The balance check tests one row's id in the same way, so such a mark moves no value (O89) | The same |
| 25 | O89. Read 1 X, cash at 200, disconnect, a manual expense of -100 on cash, its Convert to +0.5 X, reconnect, read 1. The new leg on X goes on the mark, and the cash row stays off it, as no read overwrites cash. So X shows 1, and cash shows 100. Then the user deletes either leg, and both go. The confirm names cash alone. A second holding that is also on a mark moves by its own mark, one row at a time | X: Home 0.5; line 0.5, 0.5. Cash: Home 200; line 200, 200 | X: Home 1; line 1, 1. Cash: Home 200; line 200, 200. Was, before O89: as the column before | X 1, cash 200 |
| 26 | O89. Row 25 before the delete, then the user edits one leg. `transactionsRepo.update` writes one row and never its partner, as today: no Exchange or Convert edit changes both | Leg on X to +0.7: X Home 1.2; line 1.2, 1.2. Leg on cash to -120: cash Home 80; line 200, 80 | Leg on X to +0.7: X Home 1; line 1, 1; cash Home 100; line 200, 100. Leg on cash to -120: cash Home 80; line 200, 80; X Home 1; line 1, 1. Was, before O89: as the column before. The list shows the new amount | X 1; cash as typed |
| 27 | O89. A split: a USDT cash holding at 200 pays -100, with a return of +30 to a disconnected Bybit USDT holding read at 10, then reconnect, read 10. A split's payer is cash only, so on a Bybit holding only the return can sit. The return goes on the mark. Then the user deletes either row, and both go; or edits one row | Delete: Bybit Home -20; cash Home 200. Return to +50: Bybit Home 30. Payment to -120: cash Home 80 | Delete: Bybit Home 10; line 10, 10; cash Home 200; line 200, 200. Return to +50: Bybit Home 10; line 10, 10; the pie nets -50. Payment to -120: cash Home 80; line 200, 80; Bybit Home 10; the pie nets -90. Was, before O89: as the column before | Bybit 10; cash as typed |
| 28 | O89. Row 23, then the user deletes the `setsBalance` row, or edits it to +0.7. It takes the same path as any row: no other balance path exists. `balanceSetAt` keeps the set's time, and `balanceSetRowId` names the row, or a row that is gone, as before: no code reads that column, and `balanceSetAt` feeds only `importRows`, which a Bybit holding cannot reach. The row stays out of spending | Delete: Home 0.5; line 0.5, 0.5. Edit: Home 1.2; line 1.2, 1.2 | Both: Home 1; line 1, 1. Was, before O89: as the column before | 1, 1 if the typed balance was wrong |
| 29 | O89, PLANNER CALL 98. Row 16, and the id stays on the mark until the next good read, which writes the list again with no such row. An empty list writes no key. With no read, the id stays for good and matches nothing: row 24. A deleted row's id is never reused | Not a case: no mark | Home 0.1; line 0.1, 0.1, before and after that read | Home 0.1; line 0.1, 0.1 |
| 30 | O89. Row 16, disconnect, and the user types +0.5 again, as the app has no undo for a delete. The new row has a new id and is not on the mark, so it moves the balance. The next good read marks it | Home 0.1; line -0.4, 0.1 | Home 0.6; line 0.1, 0.6. Then row 15 | 0.1, 0.6 as typed; the next good read decides |
| 31 | O89. Row 20, then the user deletes the +0.5 row. The read holds the move, so Home stays right | Home 1; line 1, 1: wrong | Home 1.5; line 1.5, 1.5, as Q-l ruled. Was, before O89: as the column before | Home 1.5; line 1, 1.5 |
| 32 | O89. Row 19, then the user deletes a row. The first row is on the mark, and the second is not: the balance holds only the second | First: Home -0.1; line -0.4, -0.1. Second: Home 0.1; line 0.1, 0.1, 0.1 | First: Home 0.4; line 0.1, 0.4. Second: Home 0.1; line 0.1, 0.1, 0.1. Was, before O89: as the column before | As the rows left say |
| 33 | O89, PLANNER CALL 96. A Binance, Monobank, wallet, manual or bank holding, a mark in its metadata or not. `datedBalanceSourceOf` is undefined, so the check returns before it reads the list. Rows 15 to 17 stay as they are on the three holdings that a read overwrites: Q-m. The one exception to O91's "Bybit-only": O92 changes the menu and the save gate on those three (row 34), and no value of a row that exists | Read 0.1, disconnect, +0.5, reconnect, read 0.1, delete: Home -0.4. Others: as today | The same: no value moves | Home 0.1 for a read world: Q-m |
| 34 | Q-n, RULED: O92, "A: Remove Duplicate", scope "Every synced holding", in set 11, before READY (was: OPEN; F1 of the review at 3ac53db74; PLANNER CALLS 100 to 102, 106 to 110). The world as it stood: row 15, the account stays connected, and the user duplicates the +0.5 row. `CardContextMenu` offers Duplicate on any manual row, on Home (`TransactionRow`) and on the holding detail. `resolveHydration` seats the source row's holding, and `recordManualTransaction` has no synced gate. The new row is off the mark, so it moves the balance. The next good read overwrites the balance and marks the row. Before that read, a delete or an edit of the copy moves the balance; after it, none (row 16). The copy stays in the list and, for an expense, in spending, after the read too. The other sign is the same world with a row of -0.5 | Before the read: Home 0.6; line -0.4, 0.1, 0.6. After it: Home 0.1; line -0.9, -0.4, 0.1. This is today's world on Binance, Monobank and a wallet holding, which have no mark. Binance's `earlierHistory` shows -0.4, then -0.9 | O92: no copy can exist, by the menu on both entries and by the gate at save. Home 0.1; line 0.1, 0.1 at each moment, with a coin set aside, and for either sign. The list and spending hold no copy. The same on a Binance, Monobank or wallet holding: their numbers leave this row. A row typed before the reconnect stays, with edit and delete, and keeps rows 15 to 17 (on those three kinds, Q-m, O91). After a disconnect, Duplicate is back, and the copy moves the balance, as any row does on a holding no sync owns (row 9). Was, before O92: Before the read: Home 0.6; line 0.1, 0.6. After it: Home 0.1; line 0.1, 0.1. Coin set aside, cooling or not read, or every coin set aside: no upsert runs, so Home 0.6 and line 0.1, 0.6 for as long as that lasts, and the sentence of L1S "at its last read balance" is false for this coin. The other sign: Home -0.4; line 0.1, -0.4, below zero, with the same endings | Home 0.1; line 0.1, 0.1: the read is the fact, and a typed copy never reached Bybit |
| 35 | Q-o, RULED: O93, "A: Refuse the key", in set 7, and the user accepts a value made from the UID in `exchange_state` and `.kiko` (was: OPEN; F2 of the review at 3ac53db74; PLANNER CALLS 103 to 105, 111). The world as it stood: the old UID reads 1 X and 2 Y, with rows +1 X and +2 Y. A disconnect keeps the holdings and the rows. A main key of another UID connects on the same Kiko account: it reads 5 X and no Y, with a row +5 X. `upsertByMetadataKey` matches `<COIN>:<wallet>`, which names no UID. `heldCoinsOf` zeroes a kept coin that the read does not list. Every `bybit` row dated up to T counts, so the mark does not reach them. `exchangeStateReset` puts every cursor at `BYBIT_RESTART_FLOOR_MS`, so the new UID's past is read and no cursor skips it. The screens show no sign; the list and spending hold both UIDs' rows | X: Home 5; line -1, 0, 5. Y: Home 0; line -2, 0 | O93, from set 7: the key is refused at connect, with no Keychain write, no read and no row. The old account stays: X: Home 1; line 0, 1. Y: Home 2; line 0, 2. The user adds a new crypto account for the key: X: Home 5; line 0, 0, 5. Together: X: Home 6; line 0, 1, 6. Y: Home 2; line 0, 2. If the old UID holds none now, the old account is a kept snapshot, as any disconnected account is (row 8): Home stays 6 X and 2 Y until the user deletes those holdings. Then X: Home 5; line 0, 0, 5; Y: Home 0; line flat at 0; the rows of the old UID are gone from the list and spending. The other remedy, the same delete and then a connect on this account, gives the same numbers. Was, before O93, and until set 7 on this tip: X: Home 5; line -1, 0, 5. Y: Home 0; line -2, 0. Binance keeps those numbers until the separate track adds the check (`binanceAsset`, `HISTORY_FLOOR_MS`) | If the old UID still holds its coins: X: Home 6; line 0, 1, 6. Y: Home 2; line 0, 2. If it holds none: X: Home 5; line 0, 0, 5. Y: Home 0; line 0, 2, 0, on the day it left |
| 36 | O96, "A: One synced rule" (F1 of the review at 445688396; PLANNER CALLS 113 to 116). A crypto account syncs Binance, so holding X has `binanceAsset`. The user disconnects and connects a BTC wallet on the same account (Binance to wallet is open, section 6.7). No sync writes X now (PLANNER CALL 115). The reverse: wallet holding W, then Binance | From O92 to this step: X reads as synced. No Duplicate on Home or in the ledger, no add, X is out of the pickers, and a save gets `syncedHoldingSaveError`, which says "synced now" and is false here. No delete, no Close and no balance field either. Before O92: Duplicate was there, and the rest was the same. In the reverse, W also shows Binance's "Not listed" note and the earlier history line, which are false there | X is manual: Duplicate, the add, the pickers, the save, delete, Close and the balance field come back, as on a disconnected holding (row 9). The wallet's own holdings stay synced. W shows no note. Each row moves X's balance, and no read overwrites it. If the account goes back to Binance, X is synced again, and a row typed meanwhile keeps the numbers of rows 15 to 17 (Q-m) | X holds what the user types: no sync reads it |

The hold menu of a row after O92 (PLANNER CALL 107). A closed list, by reading `isSyncedHolding`, `isSyncedTransaction`, `isDeletableTransaction` and both entries. "View" is View account and, except on the row's own holding's page, View holding. Each provider has one key (`syncedMetadataFieldOf`, O96, PLANNER CALL 113), and a holding is synced only with the key of its account's current provider. Each disconnect clears `institution` and keeps the key. Was: "Each kind has one key in `syncedMetadataFields`": any key counted while the account was connected, so a holding with an earlier provider's key read as synced (row 36).

| Holding | Row's `source` | Connected, now | Connected, was: | After a disconnect |
|---|---|---|---|---|
| Bybit (`bybitAsset`) | `manual` | View, Delete | View, Duplicate, Delete | View, Duplicate, Delete |
| Bybit | `bybit` | View | The same | View |
| Binance (`binanceAsset`) | `manual` | View, Delete | View, Duplicate, Delete | View, Duplicate, Delete |
| Binance | `binance` | View | The same | View |
| Monobank (`monobankId`) | `manual` | View, Delete | View, Duplicate, Delete | View, Duplicate, Delete |
| Monobank | `monobank` | View | The same | View |
| Monobank | `import` | View, Delete | The same | View, Delete |
| Wallet (`walletAddress`) | `manual` | View, Delete | View, Duplicate, Delete | View, Duplicate, Delete |
| Wallet | `btc_wallet` | View | The same | View |
| An earlier provider's key (`binanceAsset` on a wallet account, `walletAddress` on a Binance account; O96, row 36) | `manual` | View, Duplicate, Delete | View, Delete from O92 to O96; before O92, View, Duplicate, Delete | View, Duplicate, Delete |
| An earlier provider's key | its old source (`binance`, `btc_wallet`) | View | The same | View |
| No synced key, on a connected or a plain account | `manual` | View, Duplicate, Delete | The same | View, Duplicate, Delete |
| No synced key | `import` | View, Delete | The same | View, Delete |

A loan's page lists a linked payment that is stored on its payer. The entry tests the row's own holding (`transaction.holdingId`), not the page's: PLANNER CALL 110.

Row 14 on the code. `runBalanceSyncInner` takes T with `deps.now()` after `provider.fetchBalances` and `deps.updateAccount`. In `bybit.provider.ts` `fetchBalances` awaits `fetchUnifiedBalance`, then `fetchFundBalance`, so a Unified coin's balance is older than T by the whole FUND read. The client's signed read passes no signal and no timeout to `fetch`, so the Bybit client bounds neither read. T and the signed timestamp come from the device clock, and a row's time comes from Bybit. `RECV_WINDOW_MS` (5000) bounds only the signed timestamp against Bybit's server time (code 10002). It says nothing about the way back of an answer or about the next read. The user ruled on O85 with "5 s" as this window, which is too small: the coordinator tells the user. Where T is taken stays as it is, and PLANNER CALL 90 states what a change would cost.

Row 15 on the code. COMPUTED by hand on `upsertByMetadataKey` and `rowsHeldByBalance`; no run. The upsert sets `balanceMinorUnits` to the read, and nothing removes the manual row. `rowsHeldByBalance` keeps every row that is not `source: 'bybit'`, so runningTotal is 0.5 and the opening is 0.1 - 0.5 = -0.4. The fault is not only below zero: read 1, a manual row of -0.5, reconnect, read 1 shows 1.5, then 1. A Binance or Monobank holding has no filter and takes the same upsert, so it shows the same numbers. A Bybit holding gets no row of `source: 'import'` in the app: `canImportStatement` needs `kind === 'bank'`, and a Bybit account is `crypto`, so only a file can hold one, and it goes the same way (was: "A row of `source: 'import'` on a disconnected account goes the same way"). This was a wrong value that a user can see. The user ruled it: Q-j, "C: By mark" (O88; was: OPEN for the user).

The mark on the code (O88, O89, PLANNER CALLS 92 to 99; read at c30040cef, and the balance rows at d8b90aadf, COMPUTED by hand; the rows of A128 to A136 run it).

| Question | Answer |
|---|---|
| The field, and who writes it | `OVERWRITTEN_ROW_IDS_FIELD`, the key `overwrittenRowIds`, in the holding's metadata. One writer: the update branch of `upsertByMetadataKey`, when `datedBalanceSourceOf(merged)` names a source. The same write as the balance, so the two cannot part |
| Which rows | Every row of that holding with `source` other than the listed one, read in that same transaction, ordered by id. An empty list writes no key |
| Replaced or joined | Replaced by a fresh read. The rows that are still there stay on it, a row typed since the last read joins it, and an id whose row is gone leaves it. Row 18 |
| Who reads it | `overwrittenRowIdsOf`, called by `rowsHeldByBalance`, and from fix round step 3/3 by `isOverwrittenRow`. Was: one reader |
| The balance (O89, PLANNER CALL 95) | One private move, `moveBalanceOfRowDatabaseTransaction`, replaces `moveBalanceDatabaseTransaction`. It is the only way a row's edit or delete moves a balance: `update` and `removeRowsDatabaseTransaction` call it, and `remove`, `removeHolding`, `accountsRepo.remove` and the cascade reach it through the second. A new row (`recordManualTransaction`, `updateWithBalanceDelta`) is not on any mark, and stays off the check |
| The confirm (O89, PLANNER CALL 95) | `balanceChangesOf`, behind `removePlan` and `removeHoldingsPlan`, leaves out a row on the mark, so the confirm names only a real move. A row alone on the mark gets the bare confirm. No new text, no key |
| A Bybit row | The filter tests the source first. A Bybit row follows `balanceReadAt`, and the mark does not reach it, so an adopted row is safe. No row of the app's own is adopted here, as a Bybit holding has no import row |
| A write path that changes an id | None. Every `.update(transactions)` site keeps the id, and `update` writes only amount, time and description. No path deletes a row and writes it again. Only a new row has a new id: a Duplicate, a hand edit of the balance, a new leg. Each moved the balance, and the next good read marks it |
| A holding not on `datedBalances` | `datedBalanceSourceOf` is undefined, so no read of `transactions` is added and no key is written. `rowsHeldByBalance` returns before it reads a row. A monobank upsert takes the same path and the same exit. `isOverwrittenRow` tests the same function first, so a delete or an edit moves such a holding as today, and no statement is added. The one read that changes: `readNamedHoldingsDatabaseTransaction` selects `metadata` too, for every holding, with the same statement count |
| No upsert | A coin set aside, cooling or not read reaches no `upsertByMetadataKey`, so the list and `balanceReadAt` stay. Row 19 |
| Which sources | `manual` is the only one the app writes on a Bybit holding, in four forms: a typed row, a `setsBalance` row (row 23), a Convert leg (rows 22, 25; was: "an Exchange or Convert leg": a new Exchange is cash to cash, PLANNER CALL 99), a split's return. Each of these four is written only while the account is disconnected: `syncedHoldingIds` keeps a connected holding out of the primary, return and Convert pickers and out of a template (`resolveDraftReferences`), `footerAction` offers no add on one, `isSyncedEdit` hides its balance field, and `recordExchangeCounterpart` refuses one (PLANNER CALL 100). A fifth form is written while the account is connected: a Duplicate of a manual row (row 34, Q-n; was: "Each exists only while the account is disconnected", which is false for a Duplicate). A row that already exists can also be edited or deleted while connected, and a Convert of it writes its new leg on another holding only. The list, spending and the matchers read the rows, not the mark, so they do not change |
| Disconnect and restore | `strippedOnDisconnect` holds `SYNCED_AT_FIELD` alone, so the mark stays. `readDataSnapshot` selects every column, and `restoreDataSnapshot` inserts ids as the file holds them. No mirror writes `id`, and `withUsdtRescaled` rescales only named metadata fields. The one mirror that drops a row, `withStrayDepositBondBalanceCleaned`, takes only a deposit or a bond. This is a reading, and O88 asks for a proof: A128 |
| Cost and bound | One `SELECT` per Bybit coin and wallet of a good read, through the index `transactions_holding_id`, then a test of `source` on each of that holding's rows. The list holds typed rows only, so it stays small. A hand-made file can make it long, and it costs only that file's owner. Fix round step 2/3 (was: step 2/2) measures one read of a holding with 100,000 rows on real SQLite. The balance check adds no statement: `readHoldingDatabaseTransaction` selects every column already, once per row moved |

What the Binance and Monobank track can reuse (O85, "Same fix after Bybit"; O87; O88; a separate track, after this set's re-review; this track holds no part of it). It adds one entry to `datedBalances`, and `sync.ts` then writes the date with no provider switch, and `upsertByMetadataKey` writes the mark with no other edit. The symbols: `datedBalances`, `datesBalanceOf`, `datedBalanceSourceOf`, `BALANCE_READ_AT_FIELD`, `balanceReadAtOf`, `OVERWRITTEN_ROW_IDS_FIELD`, `overwrittenRowIdsOf`, `rowsHeldByBalance`, `SeriesTransaction`'s `source` and `id`, `groupByHolding`, `overwrittenRowsPatch`, the private helper in `holdings.repo.ts` that reads the rows for the mark, and, from fix round step 3/3, `isOverwrittenRow`, `moveBalanceOfRowDatabaseTransaction` and `balanceChangesOf`. The Binance side owes what Bybit's premise does not give it: shipped Binance holdings have rows and no `balanceReadAt`, so the null rule of PLANNER CALL 87 would drop every `binance` row. `ExchangeHistoryFooter` and A121 change under that track's own ruling. Monobank has no `balanceReadAt`: `sync.ts` is a balance provider's path, and `upsertMonobankMany` writes no date, so an entry for `monobankId` would drop every `monobank` row by that same null rule. It needs a date of its own, or a split of the entry into "dates" and "marks". Rows 15 to 17 hold on both today, and on a wallet, whose `walletAddress` takes the same upsert and which that track does not name yet. Fix round step 3/3 changes no value on any of them. `isOverwrittenRow` tests `datedBalanceSourceOf` first, so an entry on the list brings the rule of O89 with no other edit: the move and the confirm. The row of that kind in A135 changes under that track's own ruling, and a split into "dates" and "marks" moves that gate with it. O89 ruled Bybit alone, so the scope is Q-m. Was: "a ruling there reaches them with their entry".
Why `balanceReadAt` and not `syncedAt` (PLANNER CALL 86). `syncedAt` means "a good read last wrote this holding": `runBalanceSyncInner` stamps only the written holdings, so a set-aside coin keeps it, and that part fits. But `disconnectDatabaseTransaction` strips it, so a disconnected holding could not tell "read, and the rows hold" from "never read". `balanceSyncedAt` in the state is the account's, it moves while a coin is set aside, and a failed state write leaves it behind. A mark in the holding's metadata goes in the same write as the balance, so the two cannot part. A good read's upsert replaces it, and `strippedOnDisconnect` does not list it. No migration: metadata is JSON. No Bybit holding has shipped, so no old holding lacks the mark.

A Bybit row is one with `source: 'bybit'`. A manual row moved the balance when it was written, so it always counts (PLANNER CALL 87). A disconnected holding can have one: `updateWithBalanceDelta` and `recordManual` move its balance. Row 15 is the world where a later read overwrites that move, so that read puts the row on the mark, and from then on it does not count (Q-j, O88; was: it always counts).

Re-review finding 2 (O83), decided here (PLANNER CALL 88). The block "Some balances not read" is about balances. A coin on the history list has no balance claim behind it, and no balance read clears that list (`withCoinList` only grows it), so an emptied account would keep the block for good. The block reads the balance list only. The caption under Synchronization still reads the union, so nothing goes unsaid. Set 5, not set 6, is the first writer: `historyListWriterOf` is shared, and the capital walk counts untracked coins.

| Account with no holding | Was (O80 F4) | Now |
|---|---|---|
| A coin on the balance list | "Some balances not read" | The same |
| A coin on the history list only | "Some balances not read" | "No holdings yet", and the caption names the coin |
| A coin on the history list only, and FUND not read | "Some balances not read" | The same: the wallet's note holds it |
| A coin on the history list that Bybit tracks now | "No holdings yet" | The same |

### An account with every coin set aside (O76's condition, PLANNER CALLS 81, 82)

FOUND by reading the code, 2026-11-05, before the fix of plan set 4 steps 8/9 and 9/9:

| Case | What the user saw | Where |
|---|---|---|
| First connect, every coin refused | "Last sync" with the time, a caption per coin "BTC: Kiko could not import an amount exactly, so it was skipped.", then the block "No holdings yet. Add a holding to start tracking the balance of this account." So the account looks empty, under small captions. Home and the accounts list have no sign | `bybit.provider.ts` `statePatchesOf` (kind `oversizedBalance`), `crypto-sync-section.component.tsx` `CoinLines`, `account-detail.screen.tsx` (`!hasActiveHoldings`, `EmptyState`), `accountDetail.oversizedAmount` |
| Later sync, every coin refused | Each holding at its old balance, "Last sync" with a new time (`latestBalanceSyncAt` takes the state's stamp), the same captions, and no word that the balance is old | Same |
| The text | "could not import an amount exactly" fits an amount past the safe integer. It does not fit an empty loan field or two rows of one coin, and it does not say that a shown balance is old | `en.ts` `oversizedAmount` |

The fix: a Bybit balance read writes refused coins under `balanceNotes` as `refusedCoins`, and no longer writes `oversizedBalance` (was: O73 (c)). `bybitCoinRefused` fits each reason. `oversizedAmount` stays for Binance and for a Bybit history row, where its words are true. With no holding and any balance note, the account detail shows `bybitBalancesNotRead` in place of "No holdings yet", and a FUND refusal counts too. While the Bybit state row loads, nothing renders (O79); the gate also counts `untrackedCoinsOf` (O80 F4). "Add a holding" stays: this block is its only way in when no holding exists (`showsAddHolding: hasActiveHoldings`). Home and the accounts list stay as they are: a question for the user (section 13).

### Stage B: moves

Every row of this table is docs only (O62). Walk ids: `capital` (three series) and `transfer` (one). No new `WALK_IDS`
member, so no state fan-out (PLANNER CALL 8). Windows are half open in the plan. No row has shown a range end, and the
design holds under both ends through `reach` and the re-scan (section 3, "Safe readings"). R1 measured the window edges
(P13): deposit, internal and withdrawal accept 29 and 30 days, and transfer accepts 7 days and refuses 7 days + 1 s with
HTTP 200, retCode 131203. The windows stay 29 and 7 days: the deposit page says "less than 30 days".

| Series | Endpoint and params | Window | Page | Row fields used | Key per row | Wallet | Evidence | Probe |
|---|---|---|---|---|---|---|---|---|
| Deposit | GET `/v5/asset/deposit/query-record`, `startTime`, `endTime`, `limit=50`, `cursor`; list `result.rows` | 29 days (QUOTE "less than 30 days") | 50, cursor | `id`, `coin`, `amount`, `status`, `successAt`, `depositType`. `txID`, `toAddress`, `fromAddress`, `tag`: never read | `<acc>:deposit:<id>:<COIN>` | FUND (rule 45) | QUOTE, live page. `successAt` unit not stated, the sample has 13 digits | docs only; pending form: rule 47 |
| Internal deposit | GET `/v5/asset/deposit/query-internal-record`, same; list `result.rows` | 29 days (QUOTE "maximum difference ... 30 days") | 50, cursor | `id`, `coin`, `amount`, `status`, `createdTime`. `address`, `fromMemberId`, `txID`: never read (O6) | `<acc>:internal:<id>:<COIN>` | FUND (rule 45) | QUOTE, live page. `createdTime` unit not stated, the sample has 10 digits | docs only (PLANNER CALL 31; was: needs a sender, O15) |
| Withdrawal | GET `/v5/asset/withdraw/query-record`, `withdrawType=2`, `startTime`, `endTime`, `limit=50`, `cursor`; list `result.rows` | 29 days | 50, cursor | `withdrawId`, `coin`, `amount`, `status`, `createTime`, `updateTime`. The row's shown `time` is `createTime`: it never changes, it is the time of the row's point, and the amount leaves when the request is made (an inference, docs only). So the row's day on the line does not move when it settles. `updateTime` serves only the drift test of rule 22. `toAddress`, `tag`, `txID`: never read. Was: no `createTime`; `withdrawType` needs no read, because the request asks for both kinds | `<acc>:withdraw:<withdrawId>:<COIN>` | FUND (rule 45) | QUOTE, live page: "Can query by the master UID's api key only", so connect refuses a key with `isMaster` not true (O13). A later refusal stops the walk, and the walk logs it. No page names the window field | docs only |
| Transfer | GET `/v5/asset/transfer/query-inter-transfer-list`, `startTime`, `endTime`, `limit=50`, `cursor`; list `result.list`. The page's example names `inter-transfer-list-query`, which answers HTTP 404 (MEASURED 2026-11-04) | 7 days (QUOTE "endTime - startTime ≤ 7 days"; MEASURED) | 50, default 20, cursor | `transferId`, `coin`, `amount`, `fromAccountType`, `toAccountType`, `timestamp`, `status` | pair `<acc>:xfer:<transferId>:<COIN>`; each leg the pair id plus `:` plus its holding key | Both named | QUOTE, live page | Path MEASURED (P11, P16). Rows docs only (O75) |

Without `withdrawType=2` an off-chain withdrawal is missed: the page's default is on-chain only
(QUOTE "0(default): on chain").

### What a row feeds (MEASURED on the code, 2026-11-04, by reading)

A Bybit row takes the shape of Binance's. The balance of a holding comes from the wallet read, and a row never moves it.
Rows do feed other money values, so "the row is one ledger line" was too short.

| Surface | Fed by a row? | Code | Effect of a row with a wrong amount, a missing row, or a stale row |
|---|---|---|---|
| Holding balance, Home total, net worth now | No | `addManyDedup` ("never touches `holdings`"); `removeSyncedRows` | None |
| Net-worth line, past points | Yes | `createHoldingValuer`: opening = balance - sum of rows; for a Bybit holding, of the Bybit rows at or before `balanceReadAt` and the other rows not on the mark (set 11, O88) | A wrong number in the past only; the point for now stays right |
| Holding detail, `earlierHistory` line | Yes | `ExchangeHistoryFooter`: balance - sum of rows | A wrong number: off for Bybit (PLANNER CALL 27) |
| Holding detail and Home lists | Yes | the row itself | A wrong or missing line |
| Date field, default range of Statistics | Yes | `spanStart` in `statistics.screen.tsx`: the earliest row sets it | The oldest row moves the start of the line and of the date picker |
| Bond start day on the line | Yes, a debit in the bond's currency | `reconcileBondFunding` matches a debit on any holding by amount and a 7-day window, with no marker test | A leg in USD or EUR near a bond's typed price can shift when that bond starts on the line, by up to 7 days, as for Binance |
| Spending donut and trend | Yes, a withdrawal or other debit | `spendingRowsIn`; Binance's pin "imports a USDT withdrawal as spending in the default category" | Off by at most the fee. A missing withdrawal is spending not shown |
| Transfer and exchange legs in spending | No | `exchangeExcludedTransactionIds` (the counterpart marker) | None |
| 2-minute transfer matcher | Yes, unmarked rows only | `rowsForTransferMatch` drops a row with a pair id or a marker | Equal amounts inside 2 minutes pair, as for Binance. A trade or convert leg is never a partner |
| Funding matcher | No | `fundingOf` needs a `p2p`, `card` or `bank` code; Bybit writes none | None |
| Loan payment matcher | Yes, an unmarked debit | `isEligibleTransaction` refuses a counterpart holding and an untracked counterpart | An auto link a user can undo, as for Binance. A trade or convert leg is never a candidate |
| A listed Funding ledger row (stage F) | Past line, lists, date field and bond start day: yes. Spending, 2-minute matcher, funding matcher, loan matcher: no | `createHoldingValuer` sums every row up to the read (set 11); `exchangeExcludedTransactionIds` and `rowsForTransferMatch` drop a row with an `untrackedCounterpart`; `fundingOf` needs a `p2p`, `card` or `bank` code; `isEligibleTransaction` refuses the marker; `reconcileBondFunding` has no marker test | Section 3, "Stage F". A debit in a bond's currency can shift that bond's start on the line by up to 7 days, as for Binance |

Statistics draws only the sum (`buildNetWorthSeries`), filtered by account (`buildFilterScope`); `buildHoldingValues` has no other
consumer, and no per-holding past is drawn once `earlierHistory` is off (PLANNER CALL 27). So a holding's own past below zero is not
drawn, and the SUM can go below zero and is drawn. Units in the past are `balance - rows`, and each past point values those units at
that day's rate (`coingecko-history`, 365 days, the earliest rate carried back). So a missing move is an error of units times a price
that changes: it has no fixed bound. A row that is wrong by its fee is bounded by the fee.

### The worked example, and what stays wrong (Q5, O64)

Deposit 100 USDT to Funding, move it to Unified, buy 1 X at 100, with no fee. X is worth 200 today, and p is X's price on the day shown.
A is stage B alone, C is no rows, and E is this design. Stage E reads the trade, so the past equals the truth in every stretch. With a fee
of 0.1 % taken in X, the X row is +0.999, today's balance is 0.999, and the line after the trade is 0.999 p, again the truth.

| Past line for this account | Before the deposit | Deposit to trade | After the trade |
|---|---|---|---|
| Truth | 0 | 100 | p |
| was: A, deposits and withdrawals, no trades | p - 100 | p | p |
| was: C, no rows | p | p | p |
| now: E, trades and converts read too | 0 | 100 | p |

With p = 60 before the deposit: truth 0, A -40, C 60, E 0. COMPUTED by hand here; A77 runs it through `buildNetWorthSeries` on real SQLite.

With the ledger on (O65), the same example has two ledger rows: In 100 and Out 100. The deposit and the transfer explain them, so no row lists and the line stays 0, 100, p. If neither pairs, because `txnAmt` has some other form, both are `held`, and the line again stays 0, 100, p. COMPUTED by hand here; A91 runs both through `buildNetWorthSeries`.

What stays wrong. Each row uses the same rule: a move Kiko cannot read stays in the past as units nobody moved. Levels: COMPUTED from `balance - rows`. Each row was ruled again for O65, and a "was:" shows the line before stage F. No row calls a gap closed on a shape the page does not show: the page's one sample is an Earn row, so the rows below mean "if Bybit lists that move in this ledger", and A92 tests the row shape, not that Bybit lists such a move.

| Case | Example | Truth | The line now | Error | The user read it (O64) |
|---|---|---|---|---|---|
| P2P credit | P2P credit of 100 USDT to Funding, then buy 1 X at 100 | 0 before the credit | 0 before the credit if the ledger lists it, the same as the truth. Was: 100 before the credit. If it lands on Unified, Bybit does not list it, or the ledger holds it: still 100 | +100 USDT before the credit in those cases, none after | Yes, with the was |
| Web convert before 2025-09-10 | Deposit 100 USDT, convert it to 1 X on the web in 2024 | 0, then 100, then p | On Funding, if the ledger still lists 2024: the truth. Otherwise as was: p - 100, then p, then p. No page states how far back the ledger goes, and its first changelog entry is 2026-03-06 | The offset of A, for that convert only | Yes, with the was |
| Earn yield | 100 USDT staked and read, 5 of yield | 0, then 100 rising to 105 | Paid to Funding and listed: the truth. Was: +5 before the deposit, 105 after it. Added to the position, or paid to Unified: still as was | The yield earned after the day shown, at that day's rate | Yes, with the was |
| Derivatives P&L | Deposit 100, perps profit 50, balance 150 | 0, then 100, then 150 | 50, then 150, then 150 | The P&L after the day shown | Yes |
| Over 2 years | Any move older than the floor | Unknown | Flat in units before the floor; `balance - rows` holds at the floor | Before the floor only | Yes |
| Money moved into an Earn product Kiko does not read | Deposit 100, stake all in SmartLeverage, or in Earn when clause "E2 and E4" holds | 0, then 100, then 0 (money not counted) | From Funding, under "E2 and E4": the truth. Was: -100, then 0, then 0. From Unified, or under any other clause: still as was | -100 before the stake | No: new here, PLANNER CALL 47 |
| Interest, bonus, airdrop | Deposit 100, airdrop of 10, balance 110 | 0, then 100, then 110 | 10, then 110, then 110 | +10 before the airdrop | No: new here, PLANNER CALL 47 |
| A row that waits | Any owed row (rules 13 to 17) | | As if the move had not happened | Its amount, until it imports. A caption shows once a series is over a day behind or a point is over a day old; a new ledger row within H waits with no caption (F11, "Arrival order") | Part of O63 (d) |
| A false match (new, O65) | 100 USDT deposit that lands on Unified, and a P2P credit of 100 USDT on Funding within 7 days | 0, then 100, then 200 | The deposit row explains the credit, so 100, then 200, then 200 | +100 before the credit: the same as with no ledger. A lost row, and no count shows | No: new, O65 |
| A held row (new, O65) | The same, with a credit of 99 | 0, then 100, then 199 | The credit is held: 99, then 199, then 199 | +99 before the credit: the same as with no ledger; `bybitFundingHeld` counts it | No: new, O65 |
| A ledger row over 7 days from its source (new, O65) | A deposit of 100, and its ledger row 8 days after it | 0, then 100, then 100 | -100, then 0, then 100 | A double count: -100 until the second row. No page states a delay; a withdrawal's whole `createTime` to `updateTime` counts as distance 0 | No: new, O65 |
| An Earn move under a word Kiko has not seen, with Earn read (new, O65) | Deposit 100, stake it from Funding in a read product, with a ledger word on no list | 0, then 100, then 100 | 100, then 200, then 100 | A double count: +100 until the stake. With clause "E2 and E4" the case cannot happen | Yes: the residual of Q7's B (O67; was: "It goes to the user") |
| A stake under an unseen word when P3 shows E3 (new, F5, M35) | Deposit 100, stake it from Funding, P3 shows no separate Earn money, and no reading shows the word. It cannot ship: E3 needs a reading, and none exists (O75) | 0, then 100, then 100 | 100, then 200, then 100 | A double count: +100 until the stake. E3 stays, because "E2 and E4" would say that the money is not in the balance, which P3 shows is false (section 10, "What proves Earn") | No: new here. Told to the user with Q7's text |
| A credit that takes a source's place (new, F1, M32) | Deposit 100 on Funding at d0, its own ledger row at d5, and a P2P credit of 100 at d1 | 0, then 100, then 200 from d1 | 0, then 100, then 200 from d5: the credit pairs, and the deposit's own row lists | -100 from d1 to d5, only a row's time: the sum and the opening are true. In a chain of equal rows this can be longer: 27 days in one world of 7 moves, COMPUTED | No: new here. Told to the user |
| A Funding move to a read wallet that is on no list (new, O65) | Deposit 100, then a Funding to Unified move that the transfer list does not hold | 0, then 100, then 100 | 100, then 200, then 100 | A double count: +100 until the move. The page says the list holds "the internal transfer records between different account types under the same UID", so this is outside the pages | No: new, O65 |
| A purchase from Funding (new, O65) | A Bybit Card payment of 100 listed by the ledger | Spending 100 | The past line is true. Spending shows 0 (PLANNER CALL 56) | Spending short by 100 | No: new, O65 |
| A stock or RWA trade (new, N8) | Deposit 100 USDT, buy a stock with it | Counted money: 0, then 100, then 0 | -100, then 0, then 0 | -100 before the trade. `bybitLogLeftOut` names stocks | No: new, O66 |
| A loan entry (new, N8) | A loan of 100 USDT to Unified, then buy 1 X at 100 | 0, then 100, then p (a debt is not counted) | 100, then 100, then p | +100 before the loan. A coin with a live spot borrow is refused alone (rule 6) | No: new, O66 |
| A sub-account move (new, N8) | Deposit 100, then move it from Unified to a sub-account | 0, then 100, then 0 | -100, then 0, then 0. From Funding, if the ledger lists it: the truth. The log's `TRANSFER_OUT` is silent | -100 before the move | No: new, O66 |
| A card purchase or reward on Unified (new, N8) | Deposit 100 to Unified, a card purchase of 20, a card reward of 5 | 0, then 100, then 80, then 85 | -15, then 85, then 85, then 85. On Funding, if the ledger lists them: the truth | -20 before the purchase and +5 before the reward, and spending short by 20 | No: new, O66 |
| A summary row with a `tradeId` (new, O66 (b)) | Three fills of .001 X and one summary row of .003 X that also holds a `tradeId`, bought for 3 USDT, no fee. X is worth p | 3 before the trade | 6 - .003 p before the trade, then .003 p after it | 3 - .003 p before the trade: the gain or loss since that day, with no sign. No page states such a row. The guard of section 3 stops only a summary row with an empty `tradeId` | Yes: Q-b "A: Accept" (O69) |
| A convert also shown as a spot `TRADE` (new, O66 (b)) | Deposit 100 USDT to Unified, convert it to 1 X, and the log also holds that convert as a spot `TRADE` | 0, then 100, then p | 100 - p, then 200 - p, then p. With p = 60: 40, 140, 60 | 100 - p before the convert, with no sign. No page says so, the keys differ, and no guard reaches it, and no free read can show it now (O75) | Yes: Q-b "A: Accept" (O69) |
| A burst over the log's lane (new, N1; O68 (a)) | Over 1,000 log rows, of any type, inside one span of a second or less. MEASURED: 1,001 rows in 50 ms stop, and 1,001 rows in 300 ms to 1 s commit, because a span edge splits them. The ledger: over 2,000 rows in one or two whole seconds | The truth of the moves | The forward cursor stays at the burst, so later spot trades do not import: as A's offset for each of them, for as long as that burst is past the floor. The line `bybitHistoryDense` shows in place of "will keep importing" (F4; was: that false caption, over 1,000 rows in a span of a minute or less) | The sum of the trades behind it. MEASURED: section 5 | Told to the user, with no question (O68 (a)): Q-a, section 13 |

The call on scope (PLANNER CALL 47): interest, bonus and airdrop break the past by the same rule, bounded by their own units, and in most accounts they
are small next to a trade. They stay under Backlog, as the brief says, and `bybitLogLeftOut`, the footer and `statistics.bybitPastLimits` name them.
A stake into an unread Earn product can be large, and the log alone cannot fix it, because a stake from Funding is on no log. The line names it too, and the report names it to the user. Was: "cannot be closed" from Funding; stage F closes the Funding half under clause "E2 and E4" (O65).

### Safe readings (O62)

Each open item: the reading, what the user sees if the docs are wrong, and its kind. "docs only" rows are tested with
fixtures from the page samples, never with real values.

A "missing row" below is never only a line: it means a wrong past on the net-worth line, by the row's amount, and, for a debit, short spending
(O63 (d); was: kind "A caption", which read as harmless). A caption is what marks it, not its size.

| Open item | Reading | If the docs are wrong | Kind |
|---|---|---|---|
| `amount` against the fee | Rule 41: `amount` as reported, no sum, no subtraction, no fee line. The footer says so (clause F1) | Past line and spending off by at most that row's fee. The fee of each row adds up on the line: a past point can carry several | A wrong number in the past or in spending, bounded by the sum of those fees; never a current balance |
| Which wallet | Rule 45: FUND, clause W1 | Each wallet's past differs; the sum does not | A wrong number per wallet, which is not drawn: `earlierHistory` is off |
| Window field, range end, page order | Rules 18, 19, 22, and keys by id. A withdrawal's point stands on `createTime`, which never changes (PLANNER CALL 29). The walker read: under a window on `createTime`, the point read returns the row and clears it. Under a window on `updateTime`, the forward pass returns the row when it settles, and the next re-scan window that holds both times clears the point. A57 proves both | A row pending over 29 days under a window on `updateTime`: its point stays, and the caption shows. A row exactly on a window edge second, with both ends exclusive, older than the re-scan: a missing row with no caption | A missing row |
| No time on a deposit | Rule 47: no row, the span owed in the `deposit` series only | A missing row while it lasts, with the caption | A missing row |
| Time unit | 13 digits are ms, 10 digits are seconds, and any other value is unreadable. A 10-digit time sits in the whole second: its extent is `t` to `t + 999` ms, and its row's shown `time` is `t` (A60). Then rule 22 checks the range. An unreadable time owes its span as a range in that row's series, so the forward pass and the other series go on (`isOwedPast`; was: the span in every series, which stopped all three capital series until the floor passed it). A wrong digit rule on one series: every span of it stays owed, more than `MAX_PENDING_RANGES` merge, the lane cap bounds the calls, no row of that series imports, and the caption shows | That series has no rows | Missing rows, one series |
| Settled status | Rules 13 to 17. Any other value is owed | A row waits. If `BlockchainConfirmed` is an end state, those withdrawals never count as spending (rule 15) | A missing row |
| `depositType` 10, 20, 50 | Status alone is not enough (PLANNER CALL 30): the page gives type 20 "hit AML deposit" and type 50 "has been blocked". Only 0 imports. Type 50 is final and owes nothing, whatever its status: QUOTE (changelog 2026-07-10) "If a deposit is classified as "depositType" = 50, the funds will not be credited to your account" (PLANNER CALL 118; was: owed, as the page gives no status). Types 10 and 20 owe their point, or their span with no time (rule 47): QUOTE (changelog 2023-08-31) "You can process deposit assets when the deposit has daily deposit limit or abnormal deposit issue", so they can still settle. On a settled status, an absent or unknown type is unreadable and owed. Status 4 owes nothing and 70011 removes by key whatever the type, an absent one too (rules 13, 14) | Types 10 and 20: the row waits; if every row lacks the field, no deposit row shows, and the caption shows. Type 50, if Bybit later credits it and sets type 0: inside the 29-day re-scan or the forward pass it imports; older, a missing row with no caption. The balance read stays right | Missing rows, one series |
| Deposit rollback after status 3 | Rule 14. Inside the 29-day re-scan or a point: 7 and 70013 owe, 70011 removes the row, 70012 keeps it. Outside: the line stays. The enum page calls status 3 final unless a rollback occurs, so this is rare. A longer re-scan costs 3 more calls per extra window on every run (Q3) | A stale deposit line. Before the deposit, the past line reads low by that amount | A wrong number in the past; named in Q3 and Q5 |
| A new field or word | The parser reads named fields only. An unknown status or wallet word is owed | A row waits | A missing row |
| Spot row amount (stage E) | `change`, checked: `change + fee = qty` in exact decimals, with an empty `fee` as 0 (PLANNER CALL 40). QUOTE "Change = cashFlow + funding - fee", and both TRADE and SETTLEMENT samples on the page add up. All of them are linear rows, so no page shows a spot row, and `cashFlow`'s words name no spot case. QUOTE for `qty`: "Spot: the negative means the qty of this currency is decreased, the positive means the qty of this currency is increased". So `qty` carries the leg, and `cashFlow` and `funding` are not read. A row that fails the check owes its span as one range tagged `log`, rule 47's shape, and never a point per row (PLANNER CALL 65; was: its point). The other rows of the span import, and a read that passes the check clears the range | Every spot row fails the check: no trade imports, and the caption shows. The past is then A's, never worse. Size on the busy seed of 5,000 rows: at most 12 ranges (`MAX_PENDING_RANGES`), about 1 KB of JSON per list write, about 150 `sameGround` calls per `distinctGround`, and at most the lane's 20 calls per run, COMPUTED (was: about 2,500 points, about 210 KB, about 9M calls, review N3) | Missing rows, one series |
| Base and quote legs (stage E) | Each log row is one coin (`currency`), so a leg is a row. The other coin comes from `symbol` minus `currency`, as a prefix or a suffix. Neither or both (a fee in a third coin, or an odd symbol): the row owes its span as one range tagged `log` (PLANNER CALL 65; was: its point, which a user who pays each fee in a third coin would grow with no bound). The fee sits inside `change`, so no fee row exists | A leg with a third coin waits: a missing row of its fee size | A missing row |
| One row per fill or per order (stage E) | No page says which. A row imports alone, under its own key, so the sum per coin is the sum of `change` under both forms: three fills of .001 with fee .000001 give .002997, and one row of .003 with fee .000003 gives .002997 (A65). The list then shows one row per log row, not one per order: a span cannot sum an order that crosses into the next window with no key that moves (PLANNER CALL 50). If Bybit lists both a summary row and its fills, the sum doubles; no page says so, and P8 prints rows per order. A guard (PLANNER CALL 64): `tradeId` is read for presence only, never stored, and a spot row with an empty one owes its span as one range tagged `log`. Every sample on the live page has a `tradeId`, and no page states that a summary row has none, so the guard stops only that form of a summary row: see the table below this one | Under the pages, none. See the table below this one | A wrong number in the past, the trade's gain or loss since that day; never a current balance |
| Row key (stage E) | `<acc>:log:<id>:<type>:<transactionTime>:<COIN>` (PLANNER CALL 38). The page says "Unique id", yet its own sample gives one `id` to a SETTLEMENT row and a TRADE row, so `id` alone is not a key. A second row with the same key and another `change` in one span: both owe their point | A row waits | A missing row |
| A coin with no holding (stage E) | `placeWalletRows` makes `<COIN>:unified` at zero through `ensureExchangeHoldings`, for a row's coin and its counterpart, so a coin sold out still has its past. The wallet read writes it at zero after that. Such a holding can show 0, as rule 45 states for FUND | None for money | A holding at 0 |
| An untracked coin on a trade (stage E) | `isTrackedBybitAsset` false: its row is counted, its point returned, its ticker in `untrackedCoins`, no row. The tracked leg still imports, with `untrackedCounterpart` `asset:<COIN>` as its marker. Both untracked: no row. A code `untrackedAssetCode` refuses: owed | The money leaves the line at the trade, which is right for a coin Kiko does not count | None for counted money |
| The FUND gap (stage E, then stage F) | The log covers UNIFIED only (QUOTE "Query for transaction logs in your Unified account"). Was: a Funding move that is no deposit, withdrawal, transfer or convert has no row in 1.4, and PLANNER CALL 46 keeps `/v5/asset/fundinghistory` out. Now: stage F reads that route (O65), and a row lists by rule 51. Spot trades happen on Unified | A wrong match: section 3, "Stage F" | A lost row, or in the named cases a double count |
| Convert in both lists (stage E) | Rule 50: the log never imports `CURRENCY_BUY`, `CURRENCY_SELL` or `CONVERT`, and the convert history is the one source (PLANNER CALL 39). A web convert out of UNIFIED that the history lists with a `funding` word lands on FUND: the per-wallet past differs and the sum holds, as in rule 45. A UTA convert the history does not list is a missing row, with those log rows named in `bybitLogLeftOut`. A convert shown as a spot `TRADE` would double: no page says so, no guard reaches it, and no free read can show it (O75; "What stays wrong") | See the reading | A missing row at worst, under the pages. Outside the pages, the named double count |
| Convert wallet word (stage E) | Closed list from the page: `eb_convert_uta` is UNIFIED; `eb_convert_funding`, `funding`, `funding_fiat`, `funding_fbtc_convert`, `funding_block_trade` are FUND, read from "Wallet type". Any other word, the same coin on both sides, or an unreadable time: refused into `notImported` as `convert-unrecognized`, with its existing line | A refused convert is a missing row | A missing row, with its line |
| Convert status (stage E) | `success` imports; `failure` is final and nothing is owed; `init`, `processing` and any other word owe their point, read again by the next pass. Over 12 points in one pass become one range tagged `convert` (PLANNER CALL 66) | A convert that waits | A missing row |
| A convert page past the end (stage E) | No page says what `index` past the end returns. An empty page, a page whose keys all equal the page before, and a refusal of class "any other" (section 4) at `index` over 1 each end the pass. `CONVERT_PASS_PAGES` = 1,000 pages ends any other pass, so a list that wraps to page 1 ends too (PLANNER CALL 67). The next pass reads all rows, so a repeat loses nothing; P9 prints the form | A server that repeats a page in mid-list, or a list over 100,000 converts: the rows behind it are missing rows, with no sign. Outside the pages | A missing row |
| Stock and RWA rows (stage E) | `STOCK_TRADE_BUY`, `STOCK_TRADE_SELL`, `STOCK_TRADE_REFUND`, `STOCK_CORPORATE_ACTION_DIVIDEND`, `STOCK_ADR_FEE`, and the four split types never import, though the page names trade words. They are not spot `TRADE` rows, and no page gives their `qty`. They are named in `bybitLogLeftOut`. A `TRADE` row with `category` linear, option, inverse or event never imports: its `change` is a fee (the page's samples) | A stock bought with USDT reads as a missing move | A missing row, named |
| Web converts before 2025-09-10 (stage E) | QUOTE "Starting from September 10, 2025, converts executed on the webpage can also be queried via this API". An older one is on no list. On Unified it can appear as log rows; they do not import (rule 50). On Funding, the ledger lists its two legs as two rows, if the ledger reaches that date | The offset of A for that convert | The second row of "What stays wrong" |
| Which rows the ledger holds (stage F) | No closed list of `showBusiType`, on the page or the enum page. A row is judged by coin, direction, amount and time (O65). Its word decides only the Earn rule | PLANNER CALL 57 | A named double count, or none |
| `txnAmt` against a fee (stage F) | "Transaction amount": the page does not say net or gross. A listed row shows it as reported. Each form of section 3, "Stage F" counts as a match, and a near row is held | A listed row off by at most an unread fee | A wrong number in the past, bounded by that fee |
| How far back the ledger goes (stage F) | No stated retention; first changelog entry 2026-03-06. Floor 729 days, by rule 25. An empty answer proves nothing | Older moves stay as with no ledger | A missing row; clause L1 |

The `tradeId` guard against its failure (PLANNER CALL 64), COMPUTED on three fills of .001 X with fee .000001 and one summary row of .003 X, read from the live page 2026-11-04:

| World, none of them stated by a page | No guard | With the guard | What is owed, and for how long |
|---|---|---|---|
| Fills with a `tradeId`, no summary row (the page's samples, on linear rows) | The truth | The truth | Nothing |
| One row per order, with a `tradeId` | The truth | The truth | Nothing |
| Fills, and a summary row with an empty `tradeId` | Double: .005994 X against a balance of .002997, -.002997 X x p before the trade, with no sign | The truth. The summary row writes nothing | One range per stretch of such rows, at most 12, read within the lane on each run, up to 729 days: the caption stays up for that long |
| Fills, and a summary row with a `tradeId` | Double | Double: the guard does not reach it. "What stays wrong" names it | Nothing, and no sign |
| A real spot fill with an empty `tradeId`, one row | The truth | A missing row of that fill, with the caption | Its span, until a read shows its `tradeId` or the floor passes it: up to 729 days, at least 1 call per run |
| Every spot row with an empty `tradeId` | The truth | No spot trade imports: the past is A's, with the caption | As the row above, at most 12 ranges and the lane's 20 calls per run, up to 729 days |

So the guard trades a double count with no sign for a missing row with a caption, which O62 asks for ("never guessed into a shown money value"). Its worst world loses all of stage E. No free read can test either world now (O75; was: P8 on testnet prints the count of spot rows with an empty `tradeId`, and a count over 0 on a fill drops the guard). So the guard stays.

Never read, and stated in the UI: P2P orders (O5), SmartLeverage, BYUSDT token, derivatives P&L, loans. A ledger row can hold the
money of one of these, as a Funding move with a fixed label: it reads nothing of the order. Not read in
1.4, and stated in the UI: the Unified log's entries other than spot trades, Earn orders and yield (O37, O64;
the outlines are under Backlog).

### Stage E: spot trades and converts (O64)

Every row of this table is docs only. A `type` is never "seen on the small account" (was: that allowlist, rulings "The log allowlist"; no account has such rows): the list is closed, from the page.

| Series | Endpoint and params | Window | Page | Row fields used | Key per row | Wallet | Evidence | Probe |
|---|---|---|---|---|---|---|---|---|
| Log | GET `/v5/account/transaction-log`, `accountType=UNIFIED`, `startTime`, `endTime`, `limit=50`, `cursor`; list `result.list`. No `category` and no `type` in the request, so every entry can be named in the line | 7 days (QUOTE "endTime - startTime <= 7 days"), floor 729 days (QUOTE "up to 2 years") | 50, default 20, cursor | Always `type`, then `category` for a `TRADE`. For a spot `TRADE` also `id`, `symbol`, `currency`, `qty`, `fee`, `change`, `transactionTime`, `orderId`. `userId` is not on this route. `tradeId` only as present or empty, never stored (PLANNER CALL 64; was: never read). Never read: `side`, `cashFlow`, `funding`, `size`, `tradePrice`, `feeRate`, `bonusChange`, `cashBalance`, `orderLinkId`, `extraFees`, `displayType`, `transSubType` | `<acc>:log:<id>:<type>:<transactionTime>:<COIN>`. Pair `<acc>:trade:<orderId>:<symbol>`; the symbol names both coins | UNIFIED | QUOTE, live page. `transactionTime` QUOTE "(ms)". Permission not stated | Docs only. Empty shape MEASURED 2026-11-05 (P8): no `nextPageCursor` |
| Convert | GET `/v5/asset/exchange/query-convert-history`, `index`, `limit=100`; list `result.list`. No `accountType`, so all wallet types come back (QUOTE "Return all wallet types data if not passed") | None: the route has no time parameter | 100, `index` from 1, no cursor | `accountType`, `exchangeTxId`, `fromCoin`, `toCoin`, `fromAmount`, `toAmount`, `exchangeStatus`, `createdAt`. Never read: `userId`, `extInfo`, `convertRate`, `fromCoinType`, `toCoinType` | Pair `<acc>:convert:<exchangeTxId>:<FROM>:<TO>`; each leg the pair id plus `:` plus its holding key | By the word (safe readings) | QUOTE, live page. QUOTE "API key permission: \"Exchange\"". `createdAt` has no stated unit; the sample has 13 digits, and the digit rule holds | Docs only. Empty shape MEASURED 2026-11-05 (P9): the read at `index` 9999 is empty |

Rate limits: `transaction-log` 25/s, `query-convert-history` 50/s on the rate limit page, 100 req/s on the convert guideline page (QUOTE both; was: SUMMARY in research J). The gate of 1100 ms holds under all of them.

The closed list, 68 words on the enum page's "type(uta-translog)", read 2026-11-04, a floor (the developer re-reads the page). `bybit.log-types.ts` holds each word once. Each maps to one kind:

| Kind | Words | What happens |
|---|---|---|
| spot trade | `TRADE`, only with `category` spot | Imports (rule 49) |
| derivatives | `TRADE` with another `category`; `SETTLEMENT`, `DELIVERY`, `LIQUIDATION`, `ADL` | Named in the line |
| covered elsewhere | `TRANSFER_IN`, `TRANSFER_OUT`: the transfer series reads them, and a sub-account move stays under its stated limit | Silent, no row, so a transfer cannot double |
| convert entries | `CURRENCY_BUY`, `CURRENCY_SELL`, `CONVERT` | Named in the line, no row (rule 50). The text says these entries are not imported, which stays true when the convert history holds the same convert |
| interest and loans | `INTEREST`, `BORROW`, `REPAY`, `SPOT_REPAYMENT_SELL`, `SPOT_REPAYMENT_BUY`, `EARNING_REDEMPTION_SELL`, `EARNING_REDEMPTION_BUY`, `FLOATING_TO_FIXED_BORROW`, `FLOATING_TO_FIXED_REPAY`, `LOANS_BORROW_FUNDS`, `LOANS_PLEDGE_ASSET`, `PRINCIPAL_REPAYMENT_INS_LOAN`, `INSTITUTION_LOAN_TRANSFER_OUT`, `INSTITUTION_LOAN_WITHOUT_WITHDRAW` | Named in the line |
| bonuses and airdrops | `AIRDROP`, `BONUS`, `BONUS_RECOLLECT`, `BONUS_TRANSFER_IN`, `BONUS_TRANSFER_OUT`, `FEE_REFUND` | Named in the line |
| Earn | `FIXED_SAVING_PRINCIPAL_REDEMPTION`, `FLEXIBLE_STAKING_SUBSCRIPTION`, `FLEXIBLE_STAKING_REDEMPTION`, `FIXED_STAKING_SUBSCRIPTION`, `FLEXIBLE_STAKING_REFUND`, `FIXED_STAKING_REFUND`, `PEF_TRANSFER_IN`, `PEF_TRANSFER_OUT`, `PEF_PROFIT_SHARE`, `ONCHAINEARN_SUBSCRIPTION`, `ONCHAINEARN_REDEMPTION`, `ONCHAINEARN_REFUND`, `STRUCTURE_PRODUCT_SUBSCRIPTION`, `STRUCTURE_PRODUCT_REFUND`, `CLASSIC_WEALTH_MANAGEMENT_SUBSCRIPTION`, `PREMIMUM_WEALTH_MANAGEMENT_SUBSCRIPTION`, `PREMIMUM_WEALTH_MANAGEMENT_REFUND`, `LIQUIDITY_MINING_SUBSCRIPTION`, `LIQUIDITY_MINING_REFUND`, `PWM_SUBSCRIPTION`, `PWM_REFUND`, `BYUSDT_MINT`, `BYUSDT_REDEMPTION`, `BYUSDT_INTEREST` | Named in the line |
| stocks | `STOCK_TRADE_BUY`, `STOCK_TRADE_REFUND`, `STOCK_TRADE_SELL`, `STOCK_CORPORATE_ACTION_DIVIDEND`, `STOCK_ADR_FEE`, `FORWARD_SPLIT_SETTLE`, `FORWARD_SPLIT_OPEN`, `REVERSE_SPLIT_SETTLE`, `REVERSE_SPLIT_OPEN` | Named in the line |
| custody | `CUSTODY_NETWORK_FEE`, `CUSTODY_SETTLE_FEE`, `CUSTODY_LOCK`, `CUSTODY_UNLOCK`, `CUSTODY_UNLOCK_REFUND` | Named in the line |
| other | A word that is not on the page, or no `type` | Named in the line, never parsed |

"Counted" is by kind, not by row (PLANNER CALL 41). `notImported` keeps one entry per record, and one perps account writes thousands of `SETTLEMENT` rows, all of them inside one JSON text column. So the state holds the set of kinds a read met, in one new patch kind `logKinds`, on the `untrackedCoins` precedent (a list that only grows, of names and not rows). It is bounded by the 8 named kinds. `exchangeStateReset` drops it. The line is `bybitLogLeftOut`.

Spending and the matchers, each rule checked against the code (Binance's Exchange and Convert are the reference, not a template):

| Rule | A trade or convert leg | Code |
|---|---|---|
| Spending | Out: a tracked counterpart writes `exchangeCounterpartHoldingId` through `placeWalletRows`; an untracked one writes `untrackedCounterpart` | `exchangeExcludedTransactionIds` |
| Same-currency pair rule | Not reached: the legs of one pair differ in currency | `sameCurrencyMoveTransactionIds` |
| 2-minute matcher | Dropped first: a row with a pair id or a marker | `rowsForTransferMatch` |
| Funding matcher | Skipped: an `asset:` code is no `p2p`, `card` or `bank` code | `fundingOf` |
| Loan matcher | Refused: it tests both markers | `isEligibleTransaction` |
| Bond start day | NOT excluded: a debit in the bond's currency can match, as for Binance | `reconcileBondFunding` |
| Label | Rendered from the marker and the holding names: `description` stays `''`, and `operation` is `trade` or `convert`. No `trade-fee` row exists, because the fee is inside `change`. A delete follows `exchangePairId` to the other legs of the order, so one delete can take many fills, as Binance's order does | `exchangeLegDescription`, `transactionRowDescription` |

The walks:

- Walk ids: a new `WALK_IDS` member `log`, and the existing `convert` for the convert read (PLANNER CALL 48). `CAPTION_WALKS` for Binance stays its 8; `captionWalksOf('bybit')` gains `log`, `convert`. Nothing writes `log` on a Binance account, so its stored text stays byte-identical (A79). The fan-out is measured in set 9 step 1/5: `walk-state.test.ts`, `walk-state.multi-coin.test.ts`, `src/test-support/walk-marks.ts`, `src/test-support/walk-disturbances.ts`, and each literal that lists every walk (a floor: `git grep -c fiatPayments` lists 17 files, and most of those are not this fan-out).
- Log: `planWalkPasses`, `runWalkPlan` as is, and `readCursorSpan` with a split to 1 second (section 5, "The pager rule"; was: 1 minute, O68 (a)), one series named `log`, so an unreadable time, a failed spot check, a third coin and an empty `tradeId` each owe a tagged range (rule 47's shape). Only a same-key conflict keeps points, and it is rare. `reach` per rule 18. A row outside the span is `bybit-page-drift`. QUOTE "During periods of extreme market volatility, this interface may experience increased latency or temporary delays": a late row falls behind the cursor, and the re-scan of 7 days reads it.
- Convert: no window, so it does not use `planWalkPasses`. `bybit.convert-history.ts` reads `index` 1 upward, `canAfford` per page, and each page settles and commits by `settleRecords` and `commitSettledSpan`, rows before marks. The stored marks are two new optional fields on `WalkMarks`: `pageIndex`, the next page to read, and `passOwed`, the points this pass has owed so far (PLANNER CALL 66; was: `pageIndex` alone, and no store told this pass's points from old ones). So a list over the lane cap resumes on the next run, and a cut loses neither. Each page's commit writes its rows, then in one mark write `pageIndex` + 1, this page's points added to `passOwed`, and the same points added to `pending`, so a new point shows at once and an old one is not yet dropped. The pass ends at a page with no row, whatever the page before held (no page says a short page is the last), at any other end of "A convert page past the end" (section 3, "Safe readings"), and never at a cut. Its end is one mark write: `pending` becomes `passOwed`, each point keeping its earliest `since` (`firstSinceOf`), `passOwed` and `pageIndex` clear, and `cursor` moves to the run's start. Over 12 points in `passOwed` become one range tagged `convert` over their times, with the earliest `since`: no window reads it, and only the caption and rule 51 step 4 read it, so `pending` stays bounded. A disconnect drops both marks (`marksAfterDisconnect`). The sample is newest first, and no page states an order. Under newest first, a new row pushes older rows down, so a pass can repeat a row and never skip one. Under oldest first, nothing moves. The key makes a repeat harmless. Every run reads the whole list, because with no stated order no early stop is safe. A row older than the floor makes no row (rule 25).
- The review's scenario, by hand: 1,000 converts, `init` on page 3, lane 10.

| Run | Read | `passOwed` after | `pending` after | Caption |
|---|---|---|---|---|
| 1 | Pages 1 to 10; P on page 3 | P | P | Up: `cursor` null |
| 2 | Page 11, empty: the pass ends | none | P, its `since` kept (was: nothing, the point and its `since` gone) | P decides it, as any point |
| A cut in run 2 before the mark write | Run 3 reads page 11 again | none | P | The same |
| 3 | Pages 1 to 10; P is now `success`, its row imports | none | P, not yet dropped, so no flicker | The same |
| 4 | Page 11, empty: the pass ends | none | none | Down |

- A leg's amount: `rowMinorUnits(coin, text, 'rounded-row')` (rule 12). A log leg that rounds to 0 units is not written, and nothing else moves: it is its own record and can sit in another window, and CALL 50 rejects a hold per order. A convert leg that rounds to 0 units is not written, nor is its pair, as for Binance's trades (was: "nor is its pair" for any leg). A convert amount of 0 or less: owed.

### Stage F: the Funding ledger (O65)

Every row here is docs only. The page shows one sample row. Nothing below rests on a real row (O75). Empty shape MEASURED 2026-11-05 (P19): `nextPageCursor` empty, on both windows.

Facts, from the live pages, 2026-11-04. Each is docs only:

| Fact | QUOTE | What follows |
|---|---|---|
| Scope | "Return transaction log in Funding Account" | A Funding move of any kind can be a row. No list of kinds |
| Window | `createTimeFrom`: "Start timestamp (seconds)... The interval between createTimeFrom and createTimeTo cannot exceed 7 days" | 7-day windows, in seconds |
| Page | `limit`: "[1, 100]. Default: 10"; `cursor`; `nextPageCursor`: "Cursor for next page". The sample has a cursor on a page with its one row | Sends `limit=100` |
| Limit | Rate limit page: `/v5/asset/fundinghistory`, "30 req/s" | The gate of 1100 ms holds |
| Fields | `currency` "Coin symbol"; `ioDirection` "Direction. I: In, O: Out"; `txnAmt` "Transaction amount"; `createTime` "Create time (Unix seconds)"; `showBusiType` "Business type (localized key)"; `description` "Description (localized key)"; `currcCursor` "Unique id, can be used to duplicate check" | Read. `memberId`, `afterAmt`, `showBusiTypeEn`, `descriptionEn` are never read (PLANNER CALLS 56, 58) |
| Sample | `showBusiType` `fundingAccountRecordEarn`, `showBusiTypeEn` "Earn", `description` `fundingAccountRecordFlexSavingInterestDistribution`, `descriptionEn` "Easy Earn \| Flexible Interest Distribution" | The only words the docs show. The enum page has none of these words |
| Amount of a source | Deposit: `amount`, `depositFee` "Deposit fee", sample `""`. Withdrawal: `amount`, `withdrawFee` "Withdraw fee", `tax` "Tax amount"; a sample has `41.43008` with fee `5`. No page says net or gross | Forms, below |
| Time of a source | Deposit `successAt` "Deposit's success time". Internal `createdTime` "Deposit created timestamp". Withdrawal `createTime`, `updateTime`, "(ms)". Transfer `timestamp` "Transfer created timestamp (ms)". Convert `createdAt` "Quote created time". No page states a delay to the ledger | The window, below |
| History | Changelog: 2026-03-06 "Funding Account Transaction History [NEW]"; 2026-08-27 "Add a new response field currcCursor". The words "filtering by transaction type" name no parameter on the page | An older row may have no `currcCursor` (below). No retention stated |
| Permission | The page names none | Connect's real read decides (section 6.8). Whether the `Wallet` and `Earn` boxes reach it is not known: the second key is deleted, and R1 did not ask this route |

| Series | Endpoint and params | Window | Page | Row fields used | Key per row | Wallet | Evidence | Probe |
|---|---|---|---|---|---|---|---|---|
| Funding ledger | GET `/v5/asset/fundinghistory`, `createTimeFrom`, `createTimeTo`, `limit=100`, `cursor`; list `result.list` | 7 days, floor `now - 729 days` | 100, default 10, cursor | `currency`, `ioDirection`, `txnAmt`, `createTime`, `showBusiType`, `description`, `currcCursor` | `<acc>:funding:<currcCursor>:<COIN>` (memory exchange-ids-are-per-coin-key-every-derived-id; nothing on the page argues against it) | FUND, `<COIN>:fund` | QUOTE, live page | Docs only; P19, section 10 |

#### The rule: one pure function

`matchFundingLedger` in `src/crypto-sync/bybit/bybit.funding-match.ts`. Input: every stored ledger row and source record of the account, the walk marks, and the shipped Earn clause. Output: one verdict per ledger row. It reads no clock, no database and no float. Amounts are text, compared by `compareDecimal` and `addDecimal`.

1. **Sources.** A record is a source only if it can touch Funding and is settled, by rules 13 to 17 and 50:

| Series | Direction | Forms of the amount, in this order | Time extent | Can it have no ledger row? |
|---|---|---|---|---|
| Deposit | I | `txnAmt` = `amount`; `txnAmt` + `depositFee` = `amount`; `txnAmt` = `amount` + `depositFee` | `successAt` | Yes: no page names the wallet (rule 45), and it can land on Unified |
| Internal deposit | I | `txnAmt` = `amount` | `createdTime`, its whole second | Yes, the same |
| Withdrawal | O | `txnAmt` = `amount`; = `amount` + `withdrawFee`; = `amount` + `withdrawFee` + `tax` | `createTime` to `updateTime` | Yes, the same |
| Transfer | I when `toAccountType` is FUND, O when `fromAccountType` is FUND; no other transfer is a source | `txnAmt` = `amount` | `timestamp` | No: it names Funding |
| Convert | O for `fromCoin`, I for `toCoin`, only on the FUND words of section 3 | `txnAmt` = `fromAmount`, `toAmount` | `createdAt` | No: it names Funding |

An empty or unreadable fee or tax makes no form, and the other forms stay. Log rows are no source: the log is Unified only (PLANNER CALL 39 stands). A universal transfer to a sub-account is read by no series, so it lists, which is true for the main account.

2. **Pair.** A candidate is a ledger row and a source with the same coin, the same direction, an equal amount under a form, and a distance of at most W = 7 days. The distance is 0 inside the extent, and otherwise the gap to it. Equal means the same `normalizeDecimal` text, so a lookup by value finds candidates, and no compare runs per pair (F8). Pairing has two parts (PLANNER CALL 70; was: part a alone):
   - a. **Nearest first.** Candidates sort by form order, then distance, then ledger key, then source key, and each takes its pair if both are still free.
   - b. **Repair.** Each ledger row left that has a candidate, in order of time then key, looks for a free source through the pairs: it takes a candidate's source if that is free, or it moves the row that holds that source to another candidate of that row, as far as the chain needs. The search uses an explicit stack, and never drops a pair: it only moves it.

   So pairing is one to one, and no other one-to-one pairing explains more rows. Two equal rows at one time do not share one source. A pair gives `explained`.
3. **Earn.** Any row left whose stored `earn_principal` is true, when the shipped clause reads Earn or holds E3, gives `earnMove`: no row and no count (PLANNER CALL 57; C1, PLANNER CALL 75: the walk sets it from `EARN_PRINCIPAL_WORDS` at the parse).
4. **Wait.** Any row left, when its source series may not have shown its source yet, gives `waiting`. That is: the row's time plus H = 1 day is past the cursor of a series of its direction, or owed ground of such a series, a point or a range, lies within W of it, or no convert pass has ended past that time. The convert's part of this, its pass and its owed ground, holds only a row under W old at the run's `now`, an input (PLANNER CALL 68; was: the pass with no age limit, so a convert `cursor` that stayed null held every row for good; F10, was: owed ground with no age limit, so a range tagged `convert` over 2 years held every row in it for good). A deposit, internal deposit or withdrawal holds only rows of its own direction. A transfer and a convert hold both.
5. **Hold.** Any row left with a free source of its coin and direction within W gives `held`. The source shows that some move near it has no ledger row, and this row may be that move in a form no page states (PLANNER CALL 54).
6. **List.** Any other row gives `listed`.

Which failure is worse decides each choice: a missed match is a double count, which is new harm from this feature. A false match or a held row is a lost row, and the line then equals the line with no ledger, which the user read in O64.

The window: no page states a delay. W is one constant, and the test passes it in.

| W | Result | Number |
|---|---|---|
| Too narrow: 0 | A ledger row 1 s after its deposit is listed: a double count | -100 before the second row, for each such 100 |
| Chosen: 7 days | A source with a real partner pairs nearest first, and repair keeps every pair it can, so a wider window costs it nothing. A deposit with no ledger row can take an equal row within 7 days | +100 before a credit of exactly 100 within 7 days of a Unified deposit of 100 |
| Too wide: 729 days | That lost row can happen with a credit of the same amount at any time, and a round amount recurs | +100, for each such row, over 2 years |

The pairing tested, equal amounts, COMPUTED by a scratch model of steps 2 and 5 (not in the repository; A84 and Q12 replace it). "Was" is part a alone:

| World | Was | Now | Line against the truth |
|---|---|---|---|
| Review's world (M29): S_a d0, S_b d4, L_a d4, L_b d8, all 100 | L_a takes S_b, and S_a is 8 days from L_b, so L_b lists: -100, 0, 100, 200 against 0, 100, 200, 200 | Both explained | The truth |
| A chain (M30): S d0, d4, d8; L d4, d8, d12 | The last row lists | All explained | The truth |
| A late source, the same world: S_a lands at a later re-scan | L_b lists for good | Run 1: L_b lists. The run that reads S_a: both explained, and L_b's row goes by key | A double only until that reconcile |
| A fee (M31): S_a withdrawal 100, fee 5, d0; S_b withdrawal 105, d3; L Out 105 at d3 and d8 | The second row lists | Both explained, the first by the fee form | Off by the fee 5, rule 41 |
| A fee and a late source: the same, with S_a read later | The second row lists for good | Run 1: it lists. The run that reads S_a: both explained | As a late source, then rule 41 |
| An earlier credit: L_f d-3, S d0, its own L_t d0 | L_t explained, L_f listed | The same: nearest first holds | The truth. Pairing in time order alone would give S to L_f, and list L_t: -100 for 3 days (PLANNER CALL 70) |
| A credit between (M32): S d0, L_f d1, its own L_t d5 | L_f explained, L_t listed | The same: no rule can tell them apart | -100 from d1 to d5; the opening is true |
| A delay past W (M16): S d0, L d8 | Listed | Listed | The named double |

Random worlds through the same model: 300,000 worlds of up to 16 moves, with equal amounts, fees, sources with no ledger row and rows with no source, each own row within W. Rows listed never passed the rows with no source (part a alone: 15,058 worlds did). The written sum never passed the truth by more than the fees. With no fee, the sum never passed the truth at all, and the gap was the lost rows. Every one of the 28,689 clean worlds, as Q10 writes them, gave the truth.

Why it stays deterministic and stable. The sort is a total order on stored fields, and repair walks in a fixed order, so one stored set gives one result, whatever the order of arrival (0 of 300,000 shuffled inputs moved a verdict). No pair is stored, and only a verdict writes (CALL 52), so a pair that moves from one source to another changes no row and no line. A verdict moves only for a cause near it, and this table states what it can do. Its counts come from dense worlds, up to 16 moves over at most 47 days, so they are the shape and not a rate:

| What a later run adds | What can move | Tested |
|---|---|---|
| A source or row over W from every other record | Nothing | 0 of 300,000, and by construction |
| A source | Near rows only: `listed` to `explained`, or to `held` for a row within W of it. In a rare swap, an `explained` row lists and another row takes its place | Swaps in 114 of 300,000; at most 6 verdicts moved |
| A ledger row | Near rows only: it takes a source that explained an old row of its amount, because it is nearer, and that old row lists; or it takes a free source that held rows of other amounts, and they list. A row that arrives after its source is farther, so an older pair normally stays | At most 2 `explained` rows lost; at most 8 verdicts moved, nearly all `held` |
| A source that leaves, by a rollback | Its row lists, or repair finds it another | Rule 14 |
| Time, with no new record | `waiting` to its next verdict, by step 4 | A87 |

PLANNER CALL 70 rejects a rule with no such swap: rows in time order give a stronger proof, but they make the earlier credit above wrong, and same-second pairs are the common case.

#### The matrix

`bybit.funding-match.test.ts`, one `it` per row (A84). S is a source, L a ledger row, and amounts are in USDT unless named.

| # | World | Verdict | Effect on the past line |
|---|---|---|---|
| M1 | S deposit 100; L In 100, same second | L explained | None: the truth |
| M2 | S withdrawal 41.43008, fee 5; L Out 46.43008 | L explained, by the fee form | Off by the fee 5, rule 41 |
| M3 | S withdrawal 41.43008, fee 5; L Out 41.43008 and L Out 5 | First explained, second listed | None: the truth, and better than rule 41 |
| M4 | S transfer FUND to UNIFIED 5000; L Out 5000 | Explained | None |
| M5 | S transfer UNIFIED to FUND 5000; L In 5000 | Explained | None |
| M6 | S transfer FUND to UNIFIED 5000 with its own L Out 5000; a second L In 5000 | Out explained. The source is used, and the row is In, so it lists | None: a real credit |
| M7 | S convert on `eb_convert_funding`, 0.1 ETH to 0.00534882723991 BTC; L Out and L In of those | Both explained | None |
| M8 | The same S; L Out 0.1 ETH and L In 0.00534882 BTC | Out explained. The BTC row has no pair: held | None: the source row holds the move; `bybitFundingHeld` shows 1 |
| M9 | S deposit 100; two L In 100 at one time | One explained, one listed | None: the truth. The key fixes which row pairs |
| M10 | Two S deposit 100; one L In 100 | One explained; the free source has no row left to hold | None if the other landed on Unified |
| M11 | No S; L In 100, an unknown word | Listed | None: closes the +100 |
| M12 | S deposit 100 that landed on Unified; L In 100 on Funding, 3 days later | Explained: a false match | A lost row: +100 before it |
| M13 | The same, 8 days later | Listed | None |
| M14 | S deposit 100; L In 99, from a fee in no field | Held | Off by 1 at most, rule 41; `bybitFundingHeld` shows 1 |
| M15 | S deposit 100 that landed on Unified; L In 99 | Held | A lost row: +99 before it, counted |
| M16 | S deposit 100; L In 100, 8 days later, and truly its own | Listed: a double count | -100 before the second row. A delay past W is the one missed match left once the sources are read; a source not yet read misses only until the run that reads it (was: "the one missed match left under the pages", and M29 showed that this was false) |
| M17 | W = 0, S deposit 100, L In 100, 1 s later | Listed | -100: the window is load-bearing |
| M18 | W = 729 days, as M12 with the credit a year later | Explained | +100: the upper bound is load-bearing |
| M19 | L Out 100, word on `EARN_PRINCIPAL_WORDS`, Earn read | `earnMove` | None: Earn's own balance holds it |
| M20 | The same, clause "E2 and E4" | Listed | None: the money left what Kiko counts |
| M21 | L In 100, the same word, a redemption, Earn read | `earnMove` | None |
| M22 | L In 0.00003561 BTC, the page's sample words, either clause | Listed: the interest key is not on the principal list | None |
| M23 | L Out 100, a word on no list, Earn read, and it is a stake | Listed: a double count | +100 before the stake. PLANNER CALL 57 |
| M24 | S withdrawal `CancelByUser`, so no source; L Out 100, L In 100 | Both listed | None: the money did leave and return |
| M25 | L In 100, L Out 100 of a rolled back deposit, S removed by 70011 | Both listed | None: net 0 |
| M26 | `100` against `100.00` | Equal | Exact, never a float |
| M27 | Convert `cursor` null for good, every other series past it; L In 100, no source, 3 days old | `waiting` | As with no ledger, with the caption |
| M28 | The same, 8 days old | Listed | None: a move no stored source explains. A convert that lands later pairs, and the next reconcile removes the row |
| M29 | S_a deposit 100 at d0, S_b deposit 100 at d4; L_a In 100 at d4, L_b In 100 at d8 (F1) | Both explained: L_a by S_a, L_b by S_b, through repair | None: the truth. Was: L_b listed, -100, 0, 100, 200 |
| M30 | S deposit 100 at d0, d4, d8; L In 100 at d4, d8, d12 | All explained, through a chain of two moves | None. Was: the last row listed |
| M31 | S_a withdrawal 100, fee 5, at d0; S_b withdrawal 105 at d3; L Out 105 at d3 and at d8 | Both explained: the first moves to the fee form | Off by the fee 5, rule 41. Was: the second row listed |
| M32 | S deposit 100 at d0; a credit L_f In 100 at d1; S's own L_t In 100 at d5 | L_f explained, L_t listed | -100 from d1 to d5, and the opening is true: "What stays wrong" |
| M33 | L In 100 listed at d0, with a user's note; a deposit waits with a time at d3 (F2) | `waiting`, and the row stays, with its note and category | None: when the deposit settles it pairs, and only then the row goes. Was: the row removed, the line before d0 from 0 to +100, and the row back under a new id |
| M34 | 13 converts under a new status word, one range tagged `convert` over 2 years; L In 100, no source, 3 days old, and another 8 days old (F10) | First `waiting`, second listed | The older row is true while no such convert is stored, as M28. Was: every row in the range waited for good |
| M35 | P3 shows E3; L Out 100, a word on no list, and it is a stake (F5) | Listed: a double count | +100 before the stake, line 100, 200, 100 against 0, 100, 100. Named in "What stays wrong". Was: no clause fitted |

The failure the user named (O65) has its own kind of proof: A89 runs M16 and M23 through `buildNetWorthSeries` and asserts the double count by number, so a change to the window or the words moves a test. A105 runs M29, M31 and M32 the same way. A90 does the same for the lost rows M12 and M15. Q10 pins a clean world to the truth. Q11 pins that, with a true source within W and none of the named exclusions, no world writes a move twice in its sum.

#### Arrival order

The walk code answers this. `commitSettledSpan` writes rows, then marks. `planWalkPasses` moves a series' `cursor` only by a commit, and a run can stop at any commit. A pending deposit makes no row at all (rule 47). So when a ledger row is read, its source may be unread, may be waiting, or may be in no store. A decision taken once, when the ledger row arrives, cannot be right in all of these. A hold alone is not enough either, because a source can land behind its cursor through the re-scan.

So no decision is stored (PLANNER CALL 52). Rule 51 runs on the whole set at the end of each run, and the write brings the rows to its result:

- Each source walk writes its record to the stored set in the same `add` as its row, before its marks. A `remove` deletes the record with the row.
- The ledger walk writes each read row to the stored set, and writes no transaction row. So no walk ever waits for another.
- `reconcileFundingLedger`, in its own `logOnFailure` after the last walk, makes no call. It reads the stored set and the keys of the account's rows with the marker `ledger:funding`, and writes only the difference (F8, PLANNER CALL 71; was: an upsert of every listed row on each run): it adds a row for `listed` that has none, removes a row whose verdict is `explained`, `held` or `earnMove`, and patches the counts only when they change. So a second reconcile with no new record writes nothing (A107).
- `waiting` never removes and never adds (F2; was: any verdict that left `listed` removed the row). `removeSyncedRows` deletes a user's note and category with the row and leaves no `deleted_import_keys` entry, so a row that returns has a new id and no note. A listed row keeps both until the rule decides it. The removal stays true for the other three verdicts, and a `held` row can lose its note the same way.
- It then deletes stored rows whose `time_end` is under the floor minus 2 W, in the same write (F8, PLANNER CALL 71; was: no prune, so the table grew past 100,000 rows). The walks read nothing older than the floor, and a partner of a row at the floor is within W, so these rows can move no verdict. The table stays at 2 years and 14 days of rows.
- A key with no stored ledger row is never removed. So a reconnect, a partly read set or a prune takes away nothing: a pruned row's listed row stays, frozen.

| Case | What happens | Line |
|---|---|---|
| The ledger row is read before the source window | `waiting`, by step 4, until that series passes it by H | As with no ledger. In steady state each cursor is under a day behind, and the caption allows that lag (`isBinanceHistoryBehind`, `DAY_MS`), so a new row waits up to H with no caption: a missing row of its amount, for under a day (F11; was: "The caption is up"). A series over a day behind shows the caption |
| A deposit waits with a time (10011, 10012, 0) | Its point is owed: In rows within W are `waiting`. A row already listed stays listed (M33) | A new row: as with no ledger, with the caption once the point is over a day old (`isOldPoint`). A listed row: no change |
| A deposit with no time (rule 47) | The tagged range is owed: In rows within W of the span wait, and Out rows do not. A row already listed stays listed | The same, as long as the range stays |
| A withdrawal under review, ledger row at request | Its point is owed: Out rows within W wait, and a row already listed stays listed; when it settles it pairs | The same |
| A source lands after its row is listed, by a re-scan | The next reconcile pairs them and removes the listed row by key (`removeSyncedRows`). A user's category on that row goes with it | A double count only until that reconcile, and the run that read the source runs it |
| A re-scan reads the same rows | The stored set keeps one row per key, and nothing changes (Q6) | None |
| A rollback, 70011, in the re-scan | The record goes with its row, and the In and the Out both list | Net 0: the truth |
| A rollback seen only past the re-scan | Q3 (a) stands: the deposit row stays, and it pairs with the In. The Out of the rollback lists alone, so the rows net to 0 | The truth, if Bybit lists that Out. Q3 (a) gets smaller (A92) |
| A run stops at a budget hold or a crash, at any commit | Reconcile reads what is stored. A series that did not move its cursor keeps its rows waiting | Q10 cuts at every commit |
| A convert pass spans runs | `cursor` moves only at the end of a whole pass, so step 4 holds rows under W old until then. A page past the end ends the pass (N5), so a repeated or empty page cannot hold `cursor` null | As with no ledger, with the caption |
| The convert `cursor` stays null all the same: the route is refused or fails on every run (new, N5) | Step 4 holds only a row under W old (M27). An older row goes on to hold or list (M28). No decision is stored, so this is safe: a source that lands later pairs at that run's reconcile, and the listed row goes. A row that a convert on Funding explains lists, which is true while Kiko has no record of that convert | The truth for the listed row. Rows under W old stay lost rows, with the caption, which is true: that walk is behind (A87, A101) |
| A capital or transfer day that never commits (Q3 (b)) | Its cursor holds, so all later rows of that direction wait | A lost row, with the caption. Q3 (b) grows by this |
| A reconnect | `disconnectExchange` clears the stored set. Kept rows stay as a manual snapshot, and a read of the same key re-adopts them | None |
| A `.kiko` restore | The stored set rides in the file (PLANNER CALL 51) | None |

#### What a listed row is

| Topic | Rule | Code |
|---|---|---|
| Row | `source: 'bybit'`, amount `txnAmt` signed by `ioDirection`, by `rowMinorUnits(coin, text, 'rounded-row')`; time `createTime`; `description` `''`; no category; `operation` null; no pair id | `placeWalletRows` |
| Spending | Out: marker `ledger:funding`, in either direction (PLANNER CALL 56) | `exchangeExcludedTransactionIds` |
| Label | The fixed label `transactionRow.fundingLedgerMove`. Server text is never stored or shown: `descriptionEn` is English only, which kiko-translator refuses on a Ukrainian screen, and kiko-compliance's parse rule keeps out a free text that could name a person | `row-description.ts`; `untracked-counterpart.ts` gains the kind `ledger` |
| A row that rounds to 0 units | No row, and the stored row stays for pairing | As stage E |
| A coin not tracked | `isTrackedBybitAsset` false: its ticker in `untrackedCoins`, no stored row | Rule 8 |
| No `currcCursor` | A row with no key cannot be stored: it makes no row and owes nothing, because no read could clear it, and a patch kind `fundingLeftOut` marks that one exists. It shows `bybitFundingNoId` (PLANNER CALL 60) | `logKinds` precedent |
| An unreadable row: `ioDirection` outside I and O, a malformed, negative or zero `txnAmt`, a time of another digit count | The span owes one range tagged `fundingLedger`, not a point per row, so `pending` stays bounded (N3, PLANNER CALL 60). No page gives the sign of `txnAmt` on an Out row: "-100" signed by direction would write +100, an error of 200, which O62 forbids (F9). If Bybit signs every Out row, each Out row waits, with the caption, and no read shows that before a real row (O75) | `isOwedPast`, `MAX_PENDING_RANGES` |
| One key with two values | Both owe their point, as PLANNER CALL 38. A same-key conflict is rare, so a point holds | Rule 47's shape |

`EARN_PRINCIPAL_WORDS` is a closed list of `showBusiType` and `description` words: at this text `fundingAccountRecordEarn`, unless `description` is `fundingAccountRecordFlexSavingInterestDistribution`, the page's only words. No reading adds to it (O75; was: set 1 step 10/11 adds what P19 prints around K4, K5 and K11). The parse turns the words into the stored boolean `earn_principal`, and the words are never stored (C1, PLANNER CALL 75). A later, longer list changes a row only when a read returns it, so an older row keeps its verdict.

Earn and the line (COMPUTED). Deposit 100 to Funding, stake it all in a read product. Earn's balance is 100 and has no rows.

| Past line | Before the deposit | Deposit to stake | After the stake |
|---|---|---|---|
| Truth | 0 | 100 | 100 |
| Stake row not listed (`earnMove`) | 0 | 100 | 100 |
| Stake row listed | 100 | 200 | 100 |

So a stake is a double count when Earn is read, and is right when it is not (M19, M20). The same holds for a redemption. Interest paid to Funding is a true credit on either clause.

The walk:

- Walk id: a new `WALK_IDS` member `fundingLedger`, the fan-out of `log` (stage E). Nothing writes it on a Binance account, so its stored text stays byte-identical (A79 grows).
- `planWalkPasses`, `runWalkPlan` as is, `readCursorSpan` as for `log`, one series, `reach` per rule 18. A row outside the span is `bybit-page-drift`.
- A day over `cap x 100` rows does not stall: `readCursorSpan` splits below a day, to 1 second, the same split as `log` (O66 (a), O68 (a), PLANNER CALL 63; MEASURED, section 5). This route's bounds are whole seconds, so a span reads from its start rounded down to its end rounded up, and a row read twice is harmless by its key. Over 2,000 rows in the one or two whole seconds that such a span reads hold this lane only, with `bybitHistoryDense` (PLANNER CALL 73).
- A repeated `nextPageCursor` ends the span when the page holds no new key, and is `bybit-page-drift` only with a new key: a page past the end must not hold the caption for good (N5). The re-scan reads the same ground again, and the key makes a repeat harmless. P19 prints which form the route has.
- This walk reads by time, so it has no pass-end replacement of owed ground and needs no new store (N4). It depends on N4 only through the convert `cursor` above.
- The stored set is `funding_match_rows`, one row per ledger row and per source (PLANNER CALL 51), read by account on its primary key. Set 2 creates it empty (F3, PLANNER CALL 72); this set writes it. Its final columns (C1, PLANNER CALL 75):

| Column | Type | Holds | Rule 51 needs it for |
|---|---|---|---|
| `account_id` | text, not null, reference to `accounts` | The account | The key; child-first delete |
| `side` | text, not null | `ledger` or `source` | The key |
| `record_key` | text, not null | The ledger key, or the source's row key | The key; a stored key inside it holds Bybit's ID |
| `series` | text, null on a ledger row | `deposit`, `internal`, `withdraw`, `transfer`, `convert` | The forms of step 1; who holds whom in step 4 |
| `coin` | text, not null | The coin | Step 2 |
| `direction` | text, not null | `I` or `O` | Step 2 |
| `amount` | text, not null | `txnAmt` or the source's amount, as `normalizeDecimal` gives it | Step 2 |
| `fee` | text, null | `depositFee` or `withdrawFee` | The forms |
| `tax` | text, null | A withdrawal's `tax` | The forms |
| `time_start` | integer, not null, ms | The time, or the extent's start | The distance |
| `time_end` | integer, not null, ms | The extent's end | The distance; the prune |
| `earn_principal` | integer, not null, default 0 | A boolean set at the parse from `EARN_PRINCIPAL_WORDS`; 0 on a source | Step 3 |

Primary key `(account_id, side, record_key)`. No other index: every read and the prune filter by `account_id`.

## 4. Client facts

- Signing (QUOTE and SUMMARY, D5/guide): GET signed text = timestamp + key + recv window + query;
  `signQuery` as is, it is neutral. Headers `X-BAPI-API-KEY`, `X-BAPI-TIMESTAMP`,
  `X-BAPI-RECV-WINDOW`, `X-BAPI-SIGN`, and `Cache-Control: no-store`. No `Referer`: broker only.
- Recv window 5000 (QUOTE default). P15 MEASURED 2026-11-04: 5000, 20000 and 60000 are accepted; 60000 is the
  largest value tried, not a proved maximum. Clock rule QUOTE: "server_time -
  recv_window <= timestamp < server_time + 1000", so a phone 1 s ahead is refused with 10002. It
  gets a fixed text; an offset read is backlog.
- Order of checks (O3): parse JSON, read `retCode`, then the HTTP status for a body with none.
  HTTP 200 for an error is MEASURED for 10001 (2026-11-03), 131203 and 10005 (2026-11-04, R1 and the second key). An
  unknown path gives HTTP 404 with no `retCode` (MEASURED 2026-11-04). The other codes are docs only.
- Refusal classes, one table in `bybit.client.ts`:

| Code | Class | Result |
|---|---|---|
| 0 | ok | |
| 33004, -2015 | expired | `BybitRefusalError('expired')`; QUOTE labels; which a V5 call sends is UNVERIFIED (P17) |
| 10003, HTTP 401 | rejected | Connect: O2 text. Connected: if now is past the stored `expiredAt`, class expired, else rejected |
| 81007 | rejected | Same text; it fits |
| 10002 | clock | Fixed text |
| 10004 | sign | A code fault: generic failure text, logged by code |
| 10005 | permission | At connect: refused, with one remedy (section 6.8). On a wallet read: the wallet is skipped by the tolerant rules (UNIFIED stays strict), its last balance stays, and `bybitWalletRefused` names the wallet, not a log only (O13). On a walk: the walk stops, logged by code. MEASURED 2026-11-04 on UNIFIED, HTTP 200, with a key of the `Wallet` and `Earn` boxes only |
| 131203 | window | A code fault: the walk asks for at most 7 days on transfer. Generic failure text, logged by code; a walk stops. MEASURED 2026-11-04: 7 days + 1 s on transfer, HTTP 200 |
| 10006, 10018 | rate | Cooldown (rule 31) |
| HTTP 429 | rate | Rate class, same cooldown, no key-ended text. That Bybit documents 429 is UNVERIFIED |
| malformed | malformed | retCode 0 or HTTP 2xx without a code, or without the list of its route, or a coin row that is not an object, or a `coin` that is not non-empty text: throws; the last balance stays; never read as expired |
| HTTP 403 | forbidden | 10 minutes cooldown; text fits both a ban and a US or China IP (O3) |
| 10010 | ip | Refusal text; a bound IP does not fit a phone |
| 10028 | not unified | UNIFIED fails strict; text from the generic failure |
| 10024 (new, O75) | compliance | Fixed text `bybitComplianceRefused`, with no workaround. UNIFIED fails strict; a FUND failure of any class, this one too, is logged and marks the wallet with a line (O80 F1: `bybitWalletRefused` for a permission refusal, `bybitWalletNotRead` for any other), and a good read clears it; a walk stops, logged by code. It names its cause, so past the stored date it stays this class. QUOTE "Compliance rules triggered" (`/docs/v5/error`, read 2026-11-05). Seen once, by the user's report, on key creation on testnet, never on an API read. Whether it can reach a mainnet account: NOT VERIFIED. The mainnet key answered 11 reads with `retCode` 0 on 2026-11-05. Was: class `unknown`, so "Bybit request failed: 10024", or the expired text past the stored date (CODE: `failureOfCode`, `errorOf`) |
| any other | unknown | Past stored `expiredAt`: class expired. Otherwise generic failure |

## 5. Call counts

Call counts are COMPUTED from the windows, limits and code named. The limit numbers are MEASURED 2026-11-04 (R1, P16,
`X-Bapi-Limit`). The header gives a number, not its time unit: the units below are from research J, and call 45 of R1 does
not fit a rolling minute for transfer (a fixed minute with a boundary can fit; not resolved). The 1100 ms gate holds under
both readings. Floor `now - 729 days`, windows from `buildWalkWindows`. One page per window per series unless a seed says
otherwise. Connect has its own count (section 6.8).

### First run and steady state per series

Stage A has no walk: 3 calls every sync (was: 5), outside the gate, as Binance's balance reads are.

| Stage | Series | Route limit (research J) | Window | Windows to floor | First read, calls | Steady, calls per run | MEASURED after |
|---|---|---|---|---|---|---|---|
| A | query-api | 10/s | | | 1 | 1 | R1 for the limit |
| A | wallet-balance | 50/s | | | 1 | 1 | R1 for the limit |
| A | coins-balance | 5/s | | | 1 | 1 | R1 for the limit |
| A | earn position x2, NOT READ (O75; a record) | 10, unit not known | | | 0 (was: 2) | 0 (was: 2) | R1 for the limit |
| B | deposit | 100/min | 29 d | ceil(729/29) = 26 | 26 | 2 | R1 for the limit and floor; the real walker (set 6) for the runs |
| B | internal | 300/s | 29 d | 26 | 26 | 2 | same |
| B | withdraw | 300/min | 29 d | 26 | 26 | 2 | same |
| B | transfer | 60/min | 7 d | ceil(729/7) = 105 | 105 | 2 | same |
| E | log | 25/s | 7 d | 105 | 105 | 2 | the real walker (set 9); docs only for the row shape (O75) |
| E | convert | 50/s or 100/s (section 3) | none | | 1 + ceil(rows/100) | 1 + ceil(rows/100) | set 9 |
| F | funding ledger | 30/s (QUOTE, live page) | 7 d | 105 | 105 | 2 | the real walker (set 10); docs only for the row shape (O75) |

Steady state: forward 1 window plus re-scan `[now - window, cursor)` 1 window (`withoutRead` takes
the overlap day out). Totals: A 5. B first 183, steady 8. E first at least 106, steady at least 3. A+B+E: first at least 289 gated plus 5, steady
at least 11 gated plus 5 (was: A+B, first 183, steady 8). A+B+E+F: first at least 394 gated plus 5, steady at least 13 gated plus 5.

The Binance reference at the same date: capital 78, Earn 354, Transfer 120 (seam map section 7).
Bybit's first read is smaller in total, but its 60/min transfer route sets a much slower gate.

### Gate and caps

- Interval `BYBIT_REQUEST_INTERVAL_MS` = 1100: 54.5 requests a minute at most for the whole run, so
  every documented route holds, the slowest being transfer at 60/min, with the IP limit of 600 per
  5 s never near. PLANNER CALL 9: one gate for the run, the `createExchangeRun` shape, not a gate
  per route. P16 MEASURED each route's `X-Bapi-Limit` (table above), Earn's at 10, and no route moves the interval.
- No weight reading. Headers are read only for the cooldown (rule 31).
- Caps, chosen from the table below: lane `capital` 30 calls per run (10 windows of 3 series, so
  `MAX_WINDOWS` 10), lane `transfer` 20 calls per run (`MAX_WINDOWS` 20), lane `log` 20 (`MAX_WINDOWS` 20), lane `convert` 10 pages, lane `fundingLedger` 20 (`MAX_WINDOWS` 20). A run
  spends at most 100 gated calls plus 5 (was: 80 plus 5, before that 50 plus 5), holding one of the `SYNC_CONCURRENCY_LIMIT` slots for that many intervals. Reference:
  Binance's transfer lane alone is 80 (`LANE_CALL_CAPS`, CODE).
- Order: capital walk, then transfer, then log, then convert, then the ledger, then reconcile with no call, each in its own `logOnFailure`, forward first
  (`owedFirst` false). The forward pass keeps none, so during catch-up the re-scan and owed ground
  wait; catch-up ends in a bounded number of runs, so they are read then.

### Runs and calls to converge, stage B, one page per window

| Lane cap | Windows per run | Capital: runs, calls | Transfer: runs, calls |
|---|---|---|---|
| capital 15, transfer 10 | 5, 10 | 6, 81 | 11, 106 |
| capital 30, transfer 20 (CHOSEN) | 10, 20 | 3, 81 | 6, 106 |
| capital 60, transfer 40 | 20, 40 | 2, 81 | 3, 106 |
| capital 78+, transfer 105+ | 26, 105 | 1, 81 | 1, 106 |

Calls = the windows plus one 1-day re-scan read on the last forward run (3 for capital, 1 for
transfer). Run 7 onward is the steady calls. Chosen because these caps keep a run bounded on the
shared pool, the money figure is already right from stage A, and the caption says history is coming.
P12 refused no window (R1), so the floor and these runs stay.

Stage E, one page per window:

| Lane cap | Log windows per run | Log: runs, calls | Convert, per run | Convert: runs to a whole pass |
|---|---|---|---|---|
| log 10, convert 5 | 10 | 11, 106 | 5 pages | ceil((pages + 1) / 5) |
| log 20, convert 10 (CHOSEN) | 20 | 6, 106 | 10 pages | ceil((pages + 1) / 10) |
| log 40, convert 20 | 40 | 3, 106 | 20 pages | ceil((pages + 1) / 20) |

The log runs alongside transfer, on the same windows and the same cap, so a user sees both ends on the same run. During catch-up the re-scan and owed ground of the log wait, as for transfer. A pass over 1,000 converts spans runs, and `pageIndex` resumes it.

### Seeds, chosen caps

Lower bounds; a page exactly full may cost one more call, docs only: the page samples give a cursor on a page with one row. The real walker measures
them in set 6 (`bybit.convergence.test.ts`), which replaces these with MEASURED values.

| Seed | Rows | Capital pages per window | Capital: runs, calls | Transfer: runs, calls |
|---|---|---|---|---|
| Small account | under 50 per window | 1 per series | 3, 81 | 6, 106 |
| Busy | 1,000 per capital series, 1,000 transfers, even | 1 per series | 3, 81 | 6, 106 |
| Heavy | 5,000 per capital series, 5,000 transfers, even | 4 per series | at least 13, at least 315 | 6, at least 106 |
| Burst | 5,000 transfers in one 7-day window | | 3, 81 | at least 5 + 3 halvings beyond the even case, per the pager rule below |

The same for stage E, COMPUTED; `bybit.convergence.test.ts` in set 9 replaces these with MEASURED values:

| Seed | Log rows | Log pages per window | Log: runs, calls | Converts | Convert: calls per run, steady |
|---|---|---|---|---|---|
| Small account | under 50 per window | 1 | 6, 106 | 0 | 1 |
| Spot user | 1,000 over 2 years, even | 1 | 6, 106 | 100 | 2 |
| Busy | 5,000 over 2 years, even | 1 (48 rows, close to full) | 6, at least 106 | 1,000 | 10, the lane cap; a whole pass takes 2 runs |
| Perps bot | 50,000 over 2 years, even | 10 | at least 53, at least 1,050 | 0 | 1 |
| A day of 1,001 rows, even (N1) | Over 1,000 in a day, 10 days old | 21 in the first read | 9, 182. Was: 11, 222 with no plain hint | | |
| 1,001 rows in 1 hour | The same | 21 | 14, 282. Was: never commits, with a split that stops at a day (Q3 (b)); 23, 462 with no plain hint | | |
| 1,001 rows in 2 minutes | The same | 21 | 25, 502. Was: never commits; 65, 1,302 with no plain hint | | |
| 1,001 rows in 30 s | The same | 21 | 30, 602 | | |
| 1,001 rows in 5 s, 2 s, 1.2 s or 1 s | The same | 21 | 35, 702. Was, split to 1 minute: 1 s never committed (O68 (a)) | | |
| 1,001 rows in 300 ms or 400 ms | The same | 21 | 40, 802. A span edge splits the burst, so this depends on where it falls | | |
| 1,001 rows in 50 ms, or in one ms | The same | 21 | Never commits: 20 calls on every run. This lane only, and the forward cursor holds. `bybitHistoryDense` shows. "What stays wrong", the burst row | | |
| 2,001 rows in 5 s, then in 2 s | The same | | 37, 742, then 39, 782 | | |
| 2,001 rows in 1 s | The same | | Never commits, after 160 rows, the same way | | |
| 5,000 rows in a day, even | The same | | 23, 462 | | |
| A day of 100,000 rows, even | 10 days old | | 167, 3,322. Was: never commits; 1,636, 32,722 with no plain hint | | |
| The same, 400 days old | | | 162, 3,225 | | |
| The same, 3 days old | Inside the re-scan | | Forward 166; the first whole re-scan ends at run 336, 6,709 calls. While that day is under 7 days old, each re-scan pass costs about 170 runs, and owed points keep their 1 call | | |

The table's N1 rows and the two seeds that also ran, perps bot 53, 1,050 and busy 6, 106, are MEASURED 2026-11-04 on this repository's `planWalkPasses`, `runWalkPlan`, `walkSpans` and `halfOf`, with a model of `readCursorSpan` over a row list, lane 20, page 50, 15 minutes between runs, split to 1 second (O68 (a); every row above 1 s reads as it did with the split to 1 minute). Each row meets the lane: no run spent over 20 calls. The split to 1 second costs 5 to 10 more runs on a burst, and no run on an even day. A page exactly full may cost one more. `bybit.convergence.test.ts` replaces them with the real reader in set 9.

The same for stage F, COMPUTED; `bybit.funding-ledger.convergence.test.ts` in set 10 replaces these with MEASURED values. The lane runs on the windows of transfer and log, so all three end on the same run on a small account.

| Seed | Ledger rows | Pages per window | Ledger: runs, calls | Listed rows |
|---|---|---|---|---|
| Small account | under 100 per window | 1 | 6, 106 | Few |
| Hourly yield on 1 coin, if Bybit pays hourly (no page states it) | 168 per window | 2 | 11, 210 | 17,520 over 2 years (PLANNER CALL 62) |
| Hourly yield on 5 coins, the same | 840 per window | 9 | 48, 945 | 87,600 over 2 years |
| A day of 150 rows | Over 100 in a day | 2 in that window | 6, at least 107 | |
| A day of 1,001 rows | Over 1,000 in a day | 11 in that window | 6, 116, MEASURED: 1,001 rows fit 2,000 | |
| A day of 2,001 rows, even | Over `cap x 100` | | 9, 182, MEASURED | |
| 2,001 rows in 2 minutes | The same | | 25, 502, MEASURED | |
| 2,001 rows in 5 s, 2 s or 1 s | The same | | 35, 702, MEASURED, with a row time in ms. A real row's time is a whole second, so the next row can stop | |
| 5,000 rows in a day, even | The same | | 15, 282, MEASURED | |
| A day of 100,000 rows, even | The same | | 93, 1,849, MEASURED (400 days old: 88, 1,742) | |
| 2,001 rows in one ms; computed the same for over 2,000 rows in the one or two whole seconds a span reads | | | Never commits: this lane only, with `bybitHistoryDense`, MEASURED | |

Reconcile reads every stored row of the account on each run, and writes only the difference (F8, PLANNER CALL 71). It looks candidates up by `normalizeDecimal` text, so the 26M compares of a search by pair (87,600 x 100 x 3, review F8) do not occur. On a 5-coin seed the table holds about 89,000 ledger rows, by the prune, plus its sources. A second reconcile writes no row and no mark (A107).

Pass numbers for set 10 step 5/6, for `matchFundingLedger` alone on Node. Model is the scratch model, 2026-11-04, on this machine, with no `normalizeDecimal`, so the pass numbers leave room for it:

| Seed | Candidates | Model | Pass | On a phone, at the factor |
|---|---|---|---|---|
| 100,000 ledger rows of unequal amounts, 2,000 sources | 0 | 44 ms | Under 150 ms | Under 3 s |
| 1,000 equal rows with 1,000 equal sources, every 6 hours | 56,184 | 11 ms | Under 50 ms | Under 1 s |
| 17,520 equal rows with 17,520 equal sources, hourly, a chain of 17,520 | 5,875,844 | 1,136 ms | Under 3 s | Under 60 s: a bot that moves one exact amount each hour for 2 years, and no page or seed shows one |

The device-speed factor is 20: Hermes on a phone against V8 on this machine. It is this planner's assumption, and no measure of it exists in the repository, so the commit body names it again. A recursive repair overflowed Node's stack at a chain of 20,000 equal rows, MEASURED, so the search uses an explicit stack. The full reconcile with 100,000 rows on real SQLite goes in the commit body with this number. A result over a pass number is a report to the orchestrator, never a loosened rule. The first option in that report: run the rule per coin, with a yield to the event loop between coins, because no coin's verdicts depend on another's.

### The pager rule and its convergence

MEASURED 2026-11-05 on empty mainnet pages: the log and Earn omit `nextPageCursor`, and the Funding ledger sends it empty. A walk treats both forms as the end (rule 22). No page with rows was read, so the cursor of a real page stays docs only (O75).

`readCursorSpan` (`src/crypto-sync/bybit/`, PLANNER CALL 6) reads one span of one series by following
`nextPageCursor` to its end, and checks `canAfford` before every page. Pages already read are held
in memory and commit together. Its parameter `minSplitMs` is a day for capital and transfer, and 1 second for `log` and `fundingLedger` (PLANNER CALL 63, O66 (a), O68 (a); was: 1 minute). Budget short before the end:

- before the first page of a span: it returns `undefined`, and the hint stays, so a run with no calls left never narrows a hint (was: not stated, and a split with no read would run down to the minimum for free).
- after a page, span wider than `minSplitMs`: it returns `split`, `walkSpans` stores the narrower span as a hint, and the
  next run starts from there. A span with at most cap x 50 rows then commits.
- after a page, span of `minSplitMs` or less: it returns `undefined`, and the hint stays. For `log` and `fundingLedger`, when that span was the first this run read in its pass, a full lane did not hold it, so the walk also writes the mark below (F4, PLANNER CALL 73).

The mark: a new patch kind `denseSpans` on the `logKinds` precedent, one entry per series, `log` or `fundingLedger`, holding that span's start. So it is bounded by 2 entries, it is written only when it changes, and a Binance state keeps its text. A budget stop after an earlier read writes none. The commit that moves that series past the span drops its entry, a floor that passes the span does this through that commit, and `exchangeStateReset` and a disconnect drop both. While an entry stands, `bybitHistoryDense` shows in place of `exchangeHistoryPending`, whose words "will keep importing" do not hold there.

The plain hint (PLANNER CALL 63): `runWalkPlan` drops a resume on a forward or re-scan pass, because the cursor keeps what those passes read. So after a commit, the next run starts again from the whole 7-day window, and halves again, one halving per run. `log` and `fundingLedger` wrap `walkSpans` in one Bybit helper, `plainHintOf`, that turns a resume on those two passes into a plain hint `{ start: resume.from, end: hint.end }`. `holdsStart` keeps it, and a hint only narrows a read, so it skips no ground. No shared code moves, and a Binance walk is byte-identical. On the seed of 100,000 rows, that is the difference between 167 and 1,636 runs (section 5). Capital and transfer stay as they are.

A day holding more rows than `cap x 50` (1,000 transfers or about 1,400 of one capital series: 28 pages of 50, as the shared cap of 30 keeps 2) never
commits, the cursor holds, and the caption stays up. The ledger waits and the balance is right. Those are missing rows, so the past
and spending stay wrong until the day commits, and on such a day that is never. Accepted for transfers and capital series by Q3 (b). The log no longer extends it (O66 (a); was: PLANNER CALL 48, a bot's busy day held that account's trades for good, and 1,000 log rows of any type in a day stalled the lane). The log's limit is now a burst over 1,000 rows inside one span of a second or less (O68 (a); was: a minute or less). A 7-day window halves to 1.15 s and then to 0.58 s, the last span that can split being over 1 second. An accepted residual with its own line; the user is told, with no question (Q-a, section 13; section 3, "What stays wrong").

### Early-return audit

Every return that says "nothing to do" or "complete", and the check that must run first.

| Return | Where | Check that runs before it |
|---|---|---|
| No credentials | balance read, walk | None needed: nothing can be read; a walk logs by code |
| Cooldown | balance read, `canAfford` | Time only; no mark moves |
| Malformed state | run arm | Stops every walk, shows the paused caption |
| Empty plan | walk `runSync` | Binance's Transfer tests `forward` and `rescan` only. Bybit's guard tests `forward`, `rescan`, `pending` and `points`, for capital, transfer, log and the ledger, so a clock step back never skips owed ground: red pin required |
| Empty stored set | reconcile | None needed: no row can list. A failed walk does not skip reconcile, because it reads only what is stored |
| End of a convert pass: an empty page, a repeated page, a refusal of class "any other" at `index` over 1, or `CONVERT_PASS_PAGES` | convert read | The whole pass held its rows; `cursor` moves only here, and `pending` becomes `passOwed` in the same write. A first read at `pageIndex` over 1 still ends here, and the next pass starts at 1 |
| `canAfford` false | `readPass` | `complete: false`; marks unmoved |
| Span read `undefined` | `walkSpans` | Hint stored; `complete: false` |
| Earn answer paged | balance read | Wallet fails whole, last balance stays |
| Caption false | status helpers | Read from persisted state only |

Restart property: a run may die after any commit. Only `exchange_state`, holdings and rows survive;
the cooldown Map, write tokens, the budget, the gate and held pages reset. The walk reaches the same
final rows and marks as an uninterrupted run, at any cut point.

## 6. Answers to the open points

### 6.1 Host for a Ukrainian account

`api.bybit.com` (O1). The docs list hosts for Turkey, Kazakhstan, Georgia, UAE, EEA, Indonesia,
Japan, Hong Kong, and name Brazil and Argentina on the global host; Ukraine is on no line. The terms verdict agrees
(line 9): Global 3.4 excludes only the Crimea region and the non-government controlled areas of Donetsk, Luhansk, Kherson
and Zaporizhzhia, and EU 4.3.5 bars a resident of Ukraine, because it asks for habitual residency in the EEA. No sentence
positively names Ukraine as served, so global stays an INFERENCE for other users. For the user's account it is MEASURED
2026-11-04 (R1): `api.bybit.com` answers retCode 0. Cost if wrong for another account: it cannot connect, the UI says so,
and a host is one list.

### 6.2 EU and regional accounts

Kiko does not support Bybit EU accounts. EU 7.4 forbids this use: QUOTE "You shall not access the Platform through any
non-official or unauthorised third-parties, applications, websites or interfaces." EU 7.1, 9.1.2 and 9.2.2 each reach it
too, and the EU terms have no API sentence, so they hold no API carve-out (verdict line 6). The user must ask Bybit EU only
if EU accounts come into scope; this track does not need that.

Before entry the connect screen states that only global accounts work and names the EU (USER, O2). For Bybit EU the copy
says plainly that Kiko does not support these accounts; `may not` stays for other regional sites, whose terms are unread
(C1, O39). No text gives a workaround. Connect validates with `/v5/user/query-api`. A `10003` shows one text that fits every
reason it can have: a wrong key, a Bybit EU key, or a key of another regional site. `10003` for an EU key is UNVERIFIED: no
EU key exists to test, so the text states the reasons and does not say which one applies. Docs (SUMMARY): the EU API serves
only "Connect to Third-Party Applications" for broker users; `81007` is "Bybit Europe is not supported create API Key".
Reachability says nothing of region: `api.bybit.eu` answers public calls (MEASURED 2026-11-03). A key is never sent to a
second domain, so it never goes to `api.bybit.eu` (C1, A52).

Displaced users (verdict line 9). Whether a Ukrainian living in the EU is served by Bybit EU stays UNVERIFIED, but it
narrows: EU 4.2 and 4.3.5 admit an EEA resident on a passport or permit, unless the 4.3.7 list (a "HERE" link, unread) names
Ukraine. The Global Terms name no EEA rule, but 3.4 "not authorized" could reach EEA residents, and they name France and the
UK. Displaced users are affected. Kiko cannot judge this, so there is no region check, and no text tells a user which entity
serves them. The copy does not depend on it.

### 6.3 The 90-day expiry

Facts: QUOTE "An API key created without binding IP address(es) will expire after 90 days". QUOTE
"Your API key's expiration has been extended to 90 days from now whilst keeping the same API key and
secret". Renewal is a user step on Bybit's API page, email and 2FA. A password change ending a key
after 7 days is QUOTE on the sub-key page only: for a main key UNVERIFIED. The error after expiry is
UNVERIFIED. MEASURED 2026-11-04 (R1, O60): `expiredAt` UTC date 2027-02-04, `deadlineDay` 91, days left 91, at about 16:54
UTC, so about 92 calendar days from the run date. `createdAt` is not printed, so the exact lifetime is not known. State
and dates read `expiredAt` only; static copy says "about 90 days" (section 8), which stays true for this reading.

Read: `query-api` on each balance sync, first call, 1 call.

Stored: `sync_state.exchange_state.keyExpiry` = `{ expiredAtMs, deadlineDay, readAtMs }`, through new
patch kind `keyExpiry`, reader `keyExpiryOf`. Raw patch rules hold. A failed read keeps the stored
value. `exchangeStateReset` drops it. It rides in `.kiko` with the state, and holds no secret.

State, from `expiredAtMs` against the clock; `deadlineDay` is only the fallback when `expiredAt` does
not parse. The doc sample shows `deadlineDay` -2 with `expiredAt` at the epoch, unexplained, so an
epoch or non-positive value reads as unknown. Near = 14 days or fewer (PLANNER CALL 10).

| State | Account detail line, under Last sync | Sync failure text | Connect, help, holding footer |
|---|---|---|---|
| far | `bybitKeyValidUntil`, caption tone | none | Static note of about 90 days on connect and help; footer silent on expiry |
| near | `bybitKeyEndsSoon`, plural count | none | same |
| expired (clock past `expiredAtMs`, or a class expired refusal) | `bybitKeyEnded`, balances as of the last sync | `bybitKeyRefusedExpired`: fits 33004, -2015 and an unknown refusal after the stored `expiredAt` | same |
| unknown (never read, unparseable, epoch, bound IP) | `bybitKeyExpiryUnknown` | only if a read fails: `bybitKeyRefused` or the generic text | same |

Renewal: after the user renews on Bybit, the next sync's `query-api` answers 0 with a new
`expiredAt`; the line returns to far. No re-entry and no reconnect. The app holds the same key and
secret, so a test pins that no Keychain write happens on that path. The QUOTE above does not say that
a key already past its date can renew: UNPROBED(P17), and only R7 proves it. So `bybitKeyEnded` and
`bybitKeyRefusedExpired` fit both outcomes (O26): renew if Bybit offers it; if Bybit offers no renewal,
create a new key, then disconnect and connect. 1.4 ships before R7 with this text (Q4, the user's answer), and
R7 stays an open check after the ship.

A dated check: the first key's `expiredAt` is 2027-02-04 (the second key is deleted, O61 (c), and its date does not count).
On 2027-02-05 or later, before renewing, the user runs part P17 of the probe (O55). It prints the `retCode` of
`query-api`, UNIFIED and FUND with the expired key, then, after renewal, whether the same key answers 0
and the new `expiredAt` date, which the reader compares with the date P1 printed. If the code differs from the table in section 4, the table and tests change. The
text does not need to change for a code, since it fits every refusal, and it does not need to change for
the renewal result, since it fits both outcomes (O26). After R7, the route that R7 disproves may leave the
copy, in its own change.

P17 asks for a renewal only when the key may really have expired (O57). An ok answer from any of its first three calls
(`query-api`, UNIFIED, FUND) prints "not expired yet" and ends the part with no prompt. The answer of `query-api` stops the part
with no prompt on HTTP other than 200 or 401, on HTTP 200 with no `retCode`, and on 10002, 10004 and 10016. A `retCode` rule wins
over HTTP 401, so 401 with 10002 stops. HTTP 401 otherwise goes on to the prompt: the docs name it for a bad key, and an expired
key may get it, UNPROBED(P17).

### 6.4 Which kinds ship, and how the UI says so

Stages A, B, E and F ship (Q1, O62, O64, O65). UNIFIED and FUND ship on the docs and the empty mainnet read (O75). Deposits, internal deposits,
withdrawals, transfers, spot trades, converts and the Funding ledger ship docs only. Earn is not read, and clause "E2 and
E4" states it (O75). Was: only a kind that passed on the small account on device ships, and a kind the user
cannot produce stays unread.

| Surface | Text | Depends on |
|---|---|---|
| Connect screen | `bybitConnectLimits`, `bybitKinds` | `bybitKinds` per kind set (section 8) |
| Help topic `connectCrypto` | a new Bybit step, which ends with the `bybitKinds` text | per kind set |
| Holding footer `notListedKey` | `holdingDetail.exchangeNotListed.bybit` | per kind set |
| Account detail | `bybitKinds` in the connected section, expiry line, coin lines, `bybitCoinBorrowed`, `bybitCoinOpenOrder`, `bybitCoinRefused`, `bybitWalletRefused`, `bybitBalancesNotRead` with no holding, `bybitLogLeftOut`, `bybitFundingHeld`, `bybitFundingNoId`, `bybitHistoryDense` | per kind set |
| Statistics, net worth card | `statistics.bybitPastLimits`, under the line, only with a Bybit account in the filter scope (PLANNER CALL 45) | none |
| Catalog row | existing `exchangeConnectable`, `exchangeDisclaimer` | none |

The shipped kind set is clause "E2 and E4" (O75; was: the outcome of P3 on testnet, O15, O62). These surfaces and the policy name the exact shipped kinds.
`bybit.shipped-copy.test.ts` pins this. The holding footer gains clauses F1 and F2, and `earlierHistory` is off for Bybit (PLANNER
CALL 27).

### 6.5 Shared and new, with the nine silent seams

Reused as is (CODE): `signQuery`, `exchange/credentials` (`hardenedFor`, service per exchange),
`planWalkPasses`, `runWalkPlan`, `walkSpans`, `commitSettledSpan`, `settleRecords`,
`resolveWalletHoldings`, `RunBudget`, `createExchangeRun`, `exchangeMinorUnits`, `rowMinorUnits`,
`upsertByMetadataKey`, `patchExchangeState`, `disconnectExchange`, `runBalanceSync`, `syncJobsFor`.

New, in `src/crypto-sync/bybit/` (no walker copy): client, endpoints, credentials, cooldown,
holding keys, tracked coin, provider, key expiry, budget, walk config, cursor span reader, capital
walk, transfer walk, log types, log walk, convert read, funding ledger read, match rule, match store, reconcile, barrel. Narrowest shared extractions:

- `runExchangeWalkPlan`, `commitExchangeSpan` move from `binance.walk-wiring.ts` into
  `exchange/walk/` taking config, cooldown test and unreadable test; Binance's wiring stays as a thin
  caller, because a copy of 212 lines fails `check:dup`. No Binance assertion changes; 42d49431c re-points one mock
  (`binance.walks.unreadable-window`).
- `createWriteSerial`, new in `exchange/credentials/write-serial.ts` (not moved): per-account write queue and tokens for Bybit.
  Binance's file stays as it is, repair path included (PLANNER CALL 5; backlog to adopt it).
- `ExchangeKeyForm` from `BinanceCredentialsField`: shared two inputs, disclosure, Connect row and
  status; each provider field passes its verify, save and copy. Binance's suite stays green unchanged
  (PLANNER CALL 11).

O7's silent seams, each with a test that fails first:

| # | Seam | Change | Red pin, on the parent |
|---|---|---|---|
| 1 | `ensureExchangeHoldings` gate `!== 'binance'` | `isWalletHoldingInstitution`: `binance`, `bybit` | a Bybit row needing a new holding creates it, real SQLite |
| 2 | `records.ts` `source: 'binance'` | `source` on `ExchangeWalkConfig`, typed by a third type parameter `Source extends BalanceProviderId` (was: a plain `BalanceProviderId`, which widens `BinanceTransactionRow.source: 'binance'`) | placed rows carry the config's source; Binance unchanged |
| 3 | Section gates `=== 'binance'` | `hasExchangeHistory(provider)`, a table typed `Record<BalanceProviderId, boolean>`, so a new id does not compile with no decision; tracked predicate per provider, read through `isTrackedAssetOf(provider)`. Plan set 3 step 6/7, the step that adds the id (O30) | with the real `bybit` id: an exchange that has history renders paused, coin lines and behind captions, and the coin lines use the Bybit predicate. Every `balanceProviderIds` member has a gate decision (A42) |
| 4 | `CAPTION_WALKS` | `captionWalksOf(provider)` with a required parameter on `walkCursorsOf` and `historyOwesRange`, no default to Binance; Binance's 8 stay the same. Plan set 3 step 6/7 (O30) | with the real `bybit` id: a provider with an empty caption list never shows behind |
| 5 | `read-secrets.ts` institution filter | Bybit entry in all five files | an export holds the Bybit pair; a restore writes it |
| 6 | `clearKeychainItems` | a third clear | deleting a Bybit account clears its item |
| 7 | `plist.sh` credential regex | adds `X-BAPI-API-KEY` | `plist-credential-detect.test.ts`: a client with that header and no pin fails |
| 8 | Funding matcher `EXCHANGE_NAME` | none | CONFLICT 1: a Bybit row carries no funding code, so `fundingOf` skips it; shown load-bearing with a scratch mutant, not a parent red |
| 9 | `untrackedCoins` text says Binance | `{{exchange}}`, en and uk; output for Binance byte-identical. Plan set 3 step 6/7 (O30) | with the real `bybit` id: the line names Bybit; a Binance pin stays |

Also from O7: the log tags in `walk.ts` become `[exchange sync]` (5 sites). Re-pins name O7 in the
commit: 27 literal lines in 10 test files, one a fixture (O28; MEASURED 2026-11-03 at ef21601bd, `git grep -c`
on the 5 tags, a floor): PLANNER CALL 12.

Also from O30: seam 4 changes every use of `CAPTION_WALKS`: 1 declaration and 3 use lines in
`binance-history-status.ts`, 2 call lines in `crypto-sync-section.component.tsx`, and 25 call lines in 2 test files,
which gain the argument with the same expected results (MEASURED 2026-11-03 at cba12d6f4, `git grep`, a floor; the plan
lists them in set 3 step 6/7).

### 6.6 `.kiko` (O10)

Decision: one `bybitCredentials` entry, NO version bump. Read: `isExportSecrets` checks only its known
fields through `FIELD_CHECKS`, `restoreExportSecrets` reads two named lists, so an older build ignores
the new list and writes no such key. An unknown `institution` reads as unsynced there, so the holdings
are a manual snapshot at the last balance, which is correct money. A bump would make every older build
refuse every new file, Binance users included (the envelope test's own note). The seam map read this
but did not run it; set 2 step 1/5 RUNS it, before step 5/5 adds the table: at the pre-id tip, a fixture file with a Bybit account,
holdings, `source: 'bybit'` rows, walk state and `bybitCredentials` restores on that build (the shape
of a 1.3 build). The output goes in that commit body. If it throws, the decision flips to a bump and the
orchestrator reports it. The permanent test on the new build is a round trip of the entry, plus the
existing tolerance pins.

RUN (2026-11-04, task 2/10 step 1/5, at 18250b0d6, the pre-id tip; PASS, so the decision stands: no bump). The
scratch test `.superpowers/sdd/1.4-bybit/older-build-restore.test.ts` (gitignored, not in `src/`) builds a file with
the real writer path (`readDataSnapshot`, `encryptEnvelope`, the current `EXPORT_VERSION`): a `bybit` account, a
holding with `bybitAsset` metadata, a `source: 'bybit'` row, a walk state text, `secrets.bybitCredentials`, and
`tables.fundingMatchRows`. It restores the file through the real `importData`, `restoreDataSnapshot` and
`restoreExportSecrets` on a migrated `node:sqlite`, with only the Keychain module doubled.
`npx jest .superpowers/sdd/1.4-bybit/older-build-restore.test.ts --maxWorkers=2`: 1 suite passed, 3 tests passed,
exit 0. Shown: the restore passes with and without the `fundingMatchRows` key; the account, holding, row and walk
state text are stored as in the file; `isBalanceProviderId('bybit')`, `isSyncedAccount` and `isSyncedHolding` are
false and `syncJobsFor` gives no job, so the account reads unsynced; `setGenericPassword`,
`resetGenericPassword` and `getGenericPassword` are never called, so there is no Keychain write; no funding
table exists after the restore and a re-export carries no `fundingMatchRows` key. Step 5/5 adds that key to the
new build only; the older build ignores it today, as shown.

### 6.7 Same-account provider switch (O11)

Traced: `isPickLocked` (`isEdit || accountRowStarted || accounts.length > 0 || isRowUnknown`) gates
only the create and edit form, and `ExchangeTypeField` is disabled there once a row exists, so the form
has no switch path. The path is `ConnectExchange` on account detail: after a disconnect, with a `bankId`
that names no wired provider, its sheet offers every visible entry. Old holdings keep their metadata
(`disconnectExchange` keeps keys). `isSyncedHolding` tests only the key of the account's current
provider (O96, PLANNER CALL 113), so they read as manual. Was: it tested any synced field, so they
read as synced with no sync updating them (row 36).

Decision (O11 default, kept): `ConnectExchange` shows `exchangeSwitchRefused` instead of the form when
the shown entry conflicts with a holding on the account. Picking Bybit conflicts with `binanceAsset` or
`walletAddress`; picking Binance or a wallet conflicts with `bybitAsset`. Binance to wallet stays as today
(PLANNER CALL 13). After a disconnect those holdings are unsynced, so the user may delete them, or use a
new account. Pure helper `conflictingExchangeHoldings`, with a table test. After O96 the refusal
stays and its code does not change: O11 ruled it, O96 does not remove it, and its text stays true.
Only its stated reason changes (PLANNER CALL 116).

### 6.8 Key check on connect

Binance's precedent: `BinanceCredentialsField` verifies by `fetchAccount` and checks no permission;
only the help text asks for a read-only key (`git grep apiRestrictions`: 0 hits). Connect refuses a key that cannot read a
shipped kind, before any Keychain write, with a text that names the reason (PLANNER CALL 2 with O13, PLANNER CALL 25):

| Check, in this order | Refusal | Level |
|---|---|---|
| `readOnly` not 1, in `query-api` | `bybitKeyNotReadOnly` | MEASURED 2026-11-04: number, 1 on a read-only key |
| `isMaster` not true, absent included | `bybitKeyNotMain` | MEASURED: boolean, true on a main key. QUOTE, withdrawal page: "Can query by the master UID's api key only" |
| O93, PLANNER CALLS 104, 111: the account keeps a holding with `bybitAsset`, it has a stored owner value, and the value made from this key's `userID` differs | `bybitKeyOtherAccount`. With `userID` absent: `bybitRequestFailedNoCode` (was, PLANNER CALL 104: `bybitKeyRejected`). The connect stops here, after 1 call | docs only for `userID` (the query-api page lists it; no run kept its value, by O5). The parse follows `readOwnUid`: an integer or a digit string, and anything else reads as absent |
| One real read of each shipped route answers 10005: UNIFIED, FUND, deposit, internal deposit, withdrawal, transfer, log, convert, the Funding ledger, (was: and Earn if it ships) | `bybitKeyMissingPermission`, one remedy with no kind named (was: `{{kind}}`, cut: every kind has the same remedy) | MEASURED: UNIFIED gives HTTP 200, 10005 on a key with `Wallet` and `Earn` only. The convert route needs the `Exchange` box (QUOTE, guideline), which "every read box" holds. docs only for the log, convert and the ledger until the empty read (section 10). The ledger page names no permission, so what a narrow key gets is not known; a 10005 there refuses it, by the same text |
| Any other refusal of those reads | Its text from the table of section 4 | docs only, except 10001 and 131203 |
| 10024 on any of those reads | `bybitComplianceRefused`, by the row of section 4 (O75) | QUOTE for the code; never seen on a read |

Connect call count: `query-api` and 9 routes make 10 calls, with no Earn category (O75; was: 10, 11 with one category, 12 with both; before that 9, 10 or 11, before the ledger; before that 7 or 9, which left out one category, and no log or convert). A32 locks the count per kind set. History reads use `limit=1` and a window of one day,
the shape of P11; the convert read uses `limit=1`, `index=1`. Each route's limit holds for one call (section 5). This is more than a sync's 5, once per connect.

No box list (was: `bybitKeyMissingPermission` named boxes read from `permissions`, per P1 and P11). No page names UNIFIED's
box. R1 showed that a key with every read box reaches all 9 routes; the second key (`Wallet` and `Earn` only) reached 8 and
got 10005 on UNIFIED; ContractTrade, Spot, Options, Derivatives, Exchange, FiatP2P, FiatConvertBroker, FiatBitPay, BitCard
and ByXPost are the candidates. So help and connect say "every read box offered", which R1 proved, and `permissions` is not
read at all. The read-only key with no IP restriction works (MEASURED; `ips` is array[1], its value is not printed, and the
expiry date is the indirect evidence of "no IP").

The `isMaster` refusal stays. The withdrawal route is read and is master only by the page's words. The non-goal "sub-account
reads" holds as well. No key that is not a main key has been measured.

A later change on Bybit's page is not re-checked at a sync (backlog): the app sends GETs only, and a later 10005 on one wallet
shows `bybitWalletRefused`, with the last balance kept. Cost if wrong: a user with a partial key edits the key once.

## 7. How the user learns of the expiry (Q2, answered)

The user's answer (section 13): "detail line + failure text only". The account detail line and the sync failure
text of section 6.3 state the expiry. The app schedules no local notification. The consequence: a user who stops
opening the account learns of the expiry from a failed sync and "Last sync"; the balance stays at the last read,
dated. The measured cost of a notification is under Backlog.

## 8. Copy, en and uk

kiko-translator reviews this table before any commit that adds it. Plain-text name, no logo, generic
icon, existing `forms.account.exchangeDisclaimer`. New keys under `accountDetail` unless named. UI text
uses Кіко in uk, ʼ for the apostrophe. The wording shows clauses E1, M2, W1, F1, F2, F3 and L1. Set 7 writes clause "E2 and E4" from the clause table below (O75; was: picked by the
testnet outcome). A row changed or added
by a ruling states its level in the key cell. A row that carries a level other than QUOTE or MEASURED is copy that set 1
step 10/11 re-checks against the output. kiko:translator's review of this table stays owed at set 7. This table holds the final text, trades and converts
included, except for Earn: set 4 wrote `bybitKinds` as it stands here, set 7 changes it by clause "E2 and E4", and no tip before set 7 has a way in, so no user reads it before set 9 is in the same batch.

No UI line names "docs only" (PLANNER CALL 36). Each shipped sentence stays true if a docs-only row is wrong: it says what
Kiko reads, not that it is right. A user cannot act on such a line, and a stuck row has its caption. `statistics.bybitPastLimits` states what
the past cannot hold, which is a different thing (goal 4, PLANNER CALL 45).

| Key | en | uk |
|---|---|---|
| `bybit` | Bybit | Bybit |
| `bybitApiKeyPlaceholder` | Bybit API key | API ключ Bybit |
| `bybitApiSecretPlaceholder` | Bybit API secret | API секрет Bybit |
| `bybitConnected` | Bybit connected | Bybit підключено |
| `connectBybit` | Connect Bybit | Підключити Bybit |
| `couldNotConnectBybit` | Could not connect Bybit | Не вдалося підключити Bybit |
| `openBybitLink` | Open Bybit API management | Відкрити керування API Bybit |
| `noBybitCredentials` | No Bybit credentials stored; connect Bybit before syncing. | Облікові дані Bybit не збережено; підключіть Bybit перед синхронізацією. |
| `bybitKeychainDisclosure` | Your Bybit API key is stored only in your device's Keychain, used only to fetch your own data directly from Bybit, and is never sent to Kiko or any server. | Ваш API-ключ Bybit зберігається лише в Keychain вашого пристрою, використовується лише для отримання ваших власних даних безпосередньо з Bybit і ніколи не надсилається до Кіко чи на будь-який сервер. |
| `bybitConnectLimits` (O2, O13, O25, O39 C1, O60. Level: O1 for "only global"; QUOTE EU 7.4 for Bybit EU; UNVERIFIED for another regional site, so "may not"; MEASURED for read-only with no IP restriction, every read box and the main account; QUOTE for 90 days and renewal before the date, and "about" for the reading of O60) | Kiko works only with global Bybit accounts (bybit.com). It does not support Bybit EU accounts, and an account of another regional Bybit site (Turkey, Kazakhstan and others) may not work here. On your main account, create a read-only key with every read box ticked and no IP restriction. Bybit ends such a key after about 90 days; you renew it on Bybit, and the key and secret stay the same. | Кіко працює лише з глобальними акаунтами Bybit (bybit.com). Він не підтримує акаунти Bybit EU, а акаунт іншого регіонального сайту Bybit (Туреччина, Казахстан тощо) тут може не спрацювати. В основному акаунті створіть ключ лише для читання, позначте всі дозволи на читання й не вмикайте обмеження за IP. Bybit припиняє дію такого ключа приблизно через 90 днів; ви подовжуєте її на Bybit, а ключ і секрет лишаються ті самі. |
| `bybitKinds` (E1 at this row; set 7 ships clause "E2 and E4" in its place, O75; M2, W1, L1; O64, O65. Level: no reading for Earn; docs only for the rest. Was: "It does not read trades, converts, ..."; no Funding record) | Kiko reads your balances (Unified, Funding, Flexible Savings, On-Chain Earn), deposits, including those sent by another Bybit user, withdrawals, transfers between Funding and Unified, spot trades, converts and your Funding wallet's record. It does not read P2P orders, other Earn products, derivatives or loans. Bybit's deposit and withdrawal records do not say which wallet they used, so Kiko lists them all on Funding. Your current balances are not affected. The text of clause L1 follows here, word for word. | Кіко читає ваші баланси (Unified, Funding, Flexible Savings, On-Chain Earn), поповнення, зокрема від іншого користувача Bybit, виведення, перекази між Funding і Unified, спотові угоди, конвертації й журнал вашого гаманця Funding. Він не читає замовлення P2P, інші продукти Earn, деривативи й позики. Записи Bybit про поповнення й виведення не вказують, який гаманець використано, тож Кіко показує їх усі на Funding. Це не впливає на ваші поточні баланси. Далі йде текст пункту L1 слово в слово. |
| `bybitKeyRejected` (O25, O39 C1: fits a wrong key and a key of Bybit EU or another regional site. Level: QUOTE EU 7.4 for Bybit EU; UNVERIFIED for another regional site, so "may not") | Bybit did not accept this key. Check the key and the secret. Kiko works only with global Bybit accounts: it does not support Bybit EU accounts, and a key from another regional site may not be accepted here. | Bybit не прийняв цей ключ. Перевірте ключ і секрет. Кіко працює лише з глобальними акаунтами Bybit: він не підтримує акаунти Bybit EU, а ключ з іншого регіонального сайту тут може не підійти. |
| `bybitKeyNotReadOnly` | This key can do more than read. Create a read-only key on Bybit and connect with that one. | Цей ключ дозволяє більше, ніж читання. Створіть на Bybit ключ лише для читання й підключіться з ним. |
| `bybitKeyNotMain` (new, O13. Level: MEASURED for the field; a key that is not a main key is docs only) | Bybit does not show this key as a main account key. Create a read-only key on your main Bybit account and connect with that one. | Bybit не показує цей ключ як ключ основного акаунта. Створіть ключ лише для читання в основному акаунті Bybit і підключіться з ним. |
| `bybitKeyMissingPermission` (new, O13, changed by O61 (d). Level: MEASURED 10005 on UNIFIED. Was: named `{{kind}}` through seven `bybitKindName` values, cut because all seven share one remedy) | This key cannot read everything Kiko needs. Tick every read box Bybit offers for this key, or create a new read-only key with all of them, then connect again. | Цей ключ не може прочитати все, що потрібно Кіко. Позначте для нього всі дозволи на читання, які пропонує Bybit, або створіть новий ключ лише для читання з усіма ними, потім підключіться знову. |
| `bybitLogLeftOut` (new, O64, PLANNER CALL 41. Level: QUOTE for the words) | Unified log entries not imported: {{kinds}}. | Записи журналу Unified, які не імпортовано: {{kinds}}. |
| `bybitLogKind.*`, the values of `{{kinds}}` (new; a list, joined by the app's list format) | `derivatives` derivatives; `convertEntries` convert and liquidation entries; `interestAndLoans` interest and loans; `bonuses` bonuses and airdrops; `earn` Earn moves; `stocks` stocks; `custody` custody entries; `other` other entries | `derivatives` деривативи; `convertEntries` записи конвертацій і ліквідацій; `interestAndLoans` відсотки й позики; `bonuses` бонуси й аірдропи; `earn` рухи коштів Earn; `stocks` акції; `custody` записи кастоді; `other` інші записи |
| `statistics.bybitPastLimits` (new, F14, PLANNER CALL 45; under `statistics`, not `accountDetail`) | Clause L1S, whole (PLANNER CALL 69; was: "Bybit: the past of this line can be off.", then L1 word for word, then "Your current balances are not affected.") | Пункт L1S, повністю |
| `bybitFundingHeld` (new, plural, O65, PLANNER CALL 54. Level: docs only) | one: Kiko did not list {{count}} Funding move, because it looks like a move Kiko already has but does not match it exactly. other: Kiko did not list {{count}} Funding moves, because they look like moves Kiko already has but do not match them exactly. | one: Кіко не показав {{count}} рух коштів у Funding, бо він схожий на вже наявний запис, але не збігається з ним точно. few: Кіко не показав {{count}} рухи коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно. many: Кіко не показав {{count}} рухів коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно. other: Кіко не показав {{count}} руху коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно. |
| `bybitFundingNoId` (new, O65, PLANNER CALL 60. Level: QUOTE for the field; docs only for a row with none) | Bybit gave some Funding moves no ID, so Kiko did not list them. | Bybit не надав ID деяким рухам коштів у Funding, тож Кіко їх не показав. |
| `bybitHistoryDense` (new, F4, O68 (a), PLANNER CALL 73, with `{{date}}` from the mark. Level: MEASURED for the split, on a model; docs only for such a burst. In place of `exchangeHistoryPending` while the mark stands) | Bybit lists too many records within one second on {{date}}. Kiko cannot read past them, so later trades or Funding moves stay out, and the past of your net worth can be off by those amounts. | Bybit показує забагато записів за одну секунду {{date}}. Кіко не може прочитати далі, тож пізніші угоди чи рухи коштів у Funding не показано, а минуле вашого капіталу може відрізнятися на ці суми. |
| `bybitKeyOtherAccount` (new, O93, PLANNER CALL 111. DRAFT for the user's review, `.superpowers/sdd/1.4-bybit/texts-for-review-o93.md`. Level: CODE, a value made from `userID`; it does not say which account) | This key is from a different Bybit account. Holdings from the Bybit account connected here before are still on this account. Add a new crypto account for this key, or delete those holdings first. | Цей ключ від іншого акаунта Bybit. На цьому рахунку ще є активи акаунта Bybit, підключеного раніше. Додайте для цього ключа новий крипторахунок або спершу видаліть ці активи. |
| `forms.transaction.syncedHoldingSaveError` (new, set 11, O92, PLANNER CALL 106. Approved: O94 "Accept both rows", O95 "Keep the words"; was a DRAFT for the user's review, the same file. With the title `forms.fields.saveErrorTitle`) | A holding on this form is synced now, so Kiko cannot add a transaction to it. | Актив у цій формі тепер синхронізується, тож Кіко не може додати до нього транзакцію. |
| `forms.transaction.syncedCounterpartSaveError` (new, set 11, O94, PLANNER CALL 112. Approved: O95 "Text lgtm", the word "exchange" stays; was a DRAFT for the coordinator's review, the same file, section 4. With the title `forms.fields.saveErrorTitle`; on a Convert form only) | The holding you selected is synced now, so Kiko cannot add this exchange to it. Select another holding. | Вибраний актив тепер синхронізується, тож Кіко не може додати до нього цей обмін. Оберіть інший актив. |
| `help.topics.editTransaction.steps.3`, last sentence (changed, set 11, O92, PLANNER CALL 106. Approved: O94 "Accept both rows"; was a DRAFT for the user's review, the same file) | On one you added yourself, "Duplicate" makes a copy dated now, unless its holding is synced. | Для доданої вами транзакції «Дублювати» створює копію з поточною датою, якщо її актив не синхронізується. |
| `transactionRow.fundingLedgerMove` (new, O65, PLANNER CALL 56; the developer greps the namespace `row-description.ts` reads) | Funding wallet move | Рух коштів у гаманці Funding |
| `bybitWalletRefused` (new, O13. Level: MEASURED 10005 on UNIFIED) | Bybit refused this key for {{wallet}}, so Kiko did not update that balance. Check the key's permissions on Bybit. | Bybit не дозволив цьому ключу читати {{wallet}}, тож Кіко не оновив цей баланс. Перевірте дозволи ключа на Bybit. |
| `bybitEarnLeftOut` | REMOVED (O75; plan set 4 step 5/9). Was: a plural line that counted Earn positions the allowlist left out. Earn is not read | REMOVED |
| `bybitComplianceRefused` (new, O75. Approved, O78: the uk is the user's own words, not the draft's "правилами комплаєнсу". Level: QUOTE for the code. No workaround, by the user's order) | Bybit refused this request under its compliance rules (code 10024), so Kiko cannot read this account. | Bybit відхилив цей запит через вимоги регулятора (код 10024), тож Кіко не може прочитати цей рахунок. |
| `bybitCoinOpenOrder` (new, O76. Approved, O78. It fits `locked` above zero and `locked` not decimal text, a first sync and a later one) | {{coin}}: Bybit may hold part of this coin for an open order, so Kiko does not read its balance now. A balance shown here is from an earlier sync. With no earlier sync, this coin is not in your balance. | {{coin}}: Bybit може тримати частину цієї монети для відкритого замовлення, тож Кіко зараз не читає її баланс. Баланс, показаний тут, узято з попередньої синхронізації. Якщо попередньої синхронізації не було, цієї монети немає у вашому балансі. |
| `bybitCoinRefused` (new, O76, PLANNER CALL 81. Approved, O78. In place of `oversizedAmount` for a Bybit balance read. It fits an empty loan field, an unreadable or oversized amount and two rows of one coin) | {{coin}}: Kiko could not read this coin's amounts from Bybit, so it left the coin out. A balance shown here is from an earlier sync. With no earlier sync, this coin is not in your balance. | {{coin}}: Кіко не зміг прочитати суми цієї монети з Bybit, тож не врахував її. Баланс, показаний тут, узято з попередньої синхронізації. Якщо попередньої синхронізації не було, цієї монети немає у вашому балансі. |
| `bybitBalancesNotRead.title`, `.message` (new, O76, PLANNER CALL 82. Approved, O78. In place of `emptyHoldings` on a Bybit account with no holding and a balance note, an untracked coin or a wallet that did not read) | Some balances not read. Kiko could not read some balances on this Bybit account. The lines under Synchronization say which and why. | Деякі баланси не прочитано. Кіко не зміг прочитати деякі баланси цього рахунку Bybit. Рядки в розділі «Синхронізація» вказують, які саме й чому. |
| `bybitKeyValidUntil` (changed, O80 F8, approved O82: it says when the key ends, never that it works. A refusal shows in the failure text only; no mark is stored) | Bybit key ends on {{date}}. | Дія ключа Bybit завершується {{date}}. |
| `bybitWalletNotRead` (new, O80 F1, approved O82. Shown when the Funding read fails for any reason but a permission refusal; a good read clears it. `bybitWalletRefused` stays for a permission refusal) | Kiko could not read {{wallet}} in the last sync, so it did not update that balance. A balance shown here is from an earlier sync. With no earlier sync, money there is not in your balance. | Кіко не зміг прочитати {{wallet}} під час останньої синхронізації, тож не оновив цей баланс. Баланс, показаний тут, узято з попередньої синхронізації. Якщо попередньої синхронізації не було, кошти там не входять до вашого балансу. |
| `settings.dataExport.includeSecretsHint` (changed, O80 F5, approved O82: it names Bybit) | Adds your saved Monobank token and Binance and Bybit API keys to the file, so a restore can keep syncing without reconnecting. Turn this off to export only your data. | Увімкніть, аби додати до файлу ваш збережений токен Monobank і ключі API Binance і Bybit, щоб після відновлення синхронізація продовжилася без повторного підключення. Вимкніть, щоб експортувати лише дані. |
| The value of `{{coin}}` in `bybitCoinBorrowed`, `bybitCoinOpenOrder`, `bybitCoinRefused` (O80 F7, approved O82) | The value names the wallet, for example "BTC (Unified)", so a Unified note never reads as the Funding holding. The templates stay byte for byte | The same, for example "BTC (Unified)" |
| `bybitKeyEndsSoon` (plural) | one: Bybit key ends in {{count}} day. Renew it on Bybit; the key stays the same. other: Bybit key ends in {{count}} days. Renew it on Bybit; the key stays the same. | one: Ключ Bybit діє ще {{count}} день. Подовжте його на Bybit; ключ лишається той самий. few: Ключ Bybit діє ще {{count}} дні. Подовжте його на Bybit; ключ лишається той самий. many: Ключ Bybit діє ще {{count}} днів. Подовжте його на Bybit; ключ лишається той самий. other: Ключ Bybit діє ще {{count}} дня. Подовжте його на Bybit; ключ лишається той самий. |
| `bybitKeyEnded` (O26. Level: UNPROBED(P17) for renewal after the date, so both routes) | Bybit key ended on {{date}}. Balances are as of the last sync. Try to renew it on Bybit: the key then stays the same, so there is nothing to enter here. If Bybit offers no renewal, create a new key, then disconnect and connect again. | Дія ключа Bybit завершилася {{date}}. Баланси показано станом на останню синхронізацію. Спробуйте подовжити ключ на Bybit: тоді він лишиться той самий, і тут нічого вводити не треба. Якщо Bybit не пропонує подовження, створіть новий ключ, потім відключіть і підключіть Bybit знову. |
| `bybitKeyExpiryUnknown` (O60) | Kiko could not read when this Bybit key ends. A key with no IP restriction lasts about 90 days. | Кіко не зміг прочитати, коли завершується дія цього ключа Bybit. Ключ без обмеження за IP діє приблизно 90 днів. |
| `bybitKeyRefusedExpired` (O26, O60. Level: UNPROBED(P17)) | Bybit no longer accepts this key. Its term of about 90 days may have ended. Try to renew it on Bybit: the key and secret then stay the same, so you do not enter them again. If Bybit offers no renewal, create a new key, then disconnect and connect again. | Bybit більше не приймає цей ключ. Можливо, його строк дії (приблизно 90 днів) минув. Спробуйте подовжити його на Bybit: тоді ключ і секрет лишаться ті самі, і вводити їх знову не треба. Якщо Bybit не пропонує подовження, створіть новий ключ, потім відключіть і підключіть Bybit знову. |
| `bybitKeyRefused` | Bybit refused this key. If you deleted it, create a new key, then disconnect and connect again. | Bybit відхилив цей ключ. Якщо ви його видалили, створіть новий ключ, потім відключіть і підключіть Bybit знову. |
| `bybitForbidden` | Bybit refused the connection: too many requests, or Bybit does not serve your current network location (for example the US or mainland China). Kiko waits before trying again, up to 10 minutes. | Bybit відхилив зʼєднання: забагато запитів, або Bybit не обслуговує ваше поточне мережеве розташування (наприклад, США чи материковий Китай). Кіко зачекає, перш ніж спробувати знову, до 10 хвилин. |
| `bybitClockOff` | Bybit refused the request because this device's clock is off. Turn on Set Automatically in Date & Time settings. | Bybit відхилив запит, бо годинник цього пристрою неточний. Увімкніть «Задавати автоматично» в налаштуваннях дати й часу. |
| `bybitRequestFailed` | Bybit request failed: {{code}} | Запит до Bybit не вдався: {{code}} |
| `bybitRequestFailedNoCode` (new, DRAFT, not yet reviewed. Shown for a refusal class with no code, where `bybitRequestFailed` would end in a dangling colon) | Bybit request failed. | Запит до Bybit не вдався. |
| `bybitMissingBalances` | Bybit account response did not contain a balances list | Відповідь рахунку Bybit не містила списку балансів |
| `exchangeSwitchRefused` | {{exchange}} cannot connect here because this account still has holdings from another exchange or wallet. Add a new crypto account, or delete those holdings first. | {{exchange}} не можна підключити тут, бо цей рахунок ще містить активи іншої біржі чи гаманця. Додайте новий крипторахунок або спершу видаліть ці активи. |
| `bybitCoinBorrowed` (O27: fits a first connect, with no last balance. Changed, O76, approved O78: the last sentence is new, because the old text did not say that the coin is absent. Level: SUMMARY for the borrow fields; docs only for a coin row) | {{coin}}: Bybit shows a loan against this coin, so Kiko does not read its balance. A balance shown here is from an earlier sync. With no earlier sync, this coin is not in your balance. | {{coin}}: Bybit показує позику під цю монету, тож Кіко не читає її баланс. Баланс, показаний тут, узято з попередньої синхронізації. Якщо попередньої синхронізації не було, цієї монети немає у вашому балансі. |
| `disconnectProviderMessage.bybit` | This clears the connection and the stored API key. Your holdings and transactions stay as a manual snapshot. | Акаунт буде відʼєднано, а збережений API-ключ очищено. Ваші активи й транзакції збережуться, і ви можете й надалі керувати ними вручну. |
| `untrackedCoins` (changed) | Not tracked: {{tickers}}. Kiko does not import a currency its {{exchange}} sync does not support. | The existing uk line with Binance replaced by `{{exchange}}`; the output for Binance stays byte-identical |
| `holdingDetail.exchangeNotListed.bybit` (E1, M2, W1, F1, F2, F3; O15, O25, O39 C1, O62, O64, O65. Set 7 ships clause "E2 and E4" in place of E1, O75. Level: no reading for Earn; docs only for the rows; QUOTE the P2P guide for the P2P clause, with no probe (O5, O49); QUOTE for the convert date; QUOTE EU 7.4 for Bybit EU; UNVERIFIED for another regional site, so "may not". Was: "trades, converts" not listed; "records older than Bybit keeps") | Not listed: interest, bonuses, airdrops and other Unified log entries that are not spot trades; converts made on the website or in the app before 10 September 2025; Earn orders and yield; P2P orders, which Bybit's API opens only to advertisers; Earn products other than Flexible Savings and On-Chain; derivatives profit and loss; loans; sub-accounts; and records older than two years. Bybit's deposit and withdrawal records do not say which wallet they used, so Kiko lists them all on Funding. Your current balances are not affected. Deposit and withdrawal amounts are as Bybit reports them, with no separate fee line. A spot trade's amount already holds its fee. A Funding wallet move is one no other Bybit record explains; it does not count as spending, and one that looks like a record Kiko already has stays out. Kiko does not support Bybit EU accounts, and a key from another regional site may not be accepted. | Не показано: відсотки, бонуси, аірдропи й інші записи журналу Unified, крім спотових угод; конвертації на сайті чи в застосунку до 10 вересня 2025 року; замовлення й дохід Earn; замовлення P2P, бо API Bybit відкритий для них лише рекламодавцям; продукти Earn, крім Flexible Savings і On-Chain; прибуток і збитки деривативів; позики; субакаунти; записи, старіші за два роки. Записи Bybit про поповнення й виведення не вказують, який гаманець використано, тож Кіко показує їх усі на Funding. Це не впливає на ваші поточні баланси. Суми поповнень і виведень показано так, як їх повідомляє Bybit, без окремого рядка комісії. Сума спотової угоди вже містить її комісію. Рух коштів у гаманці Funding — це запис, якого не пояснює жоден інший запис Bybit; він не рахується як витрата, а рух, схожий на вже наявний запис, Кіко не показує. Кіко не підтримує акаунти Bybit EU, а ключ з іншого регіонального сайту може не підійти. |
| `help.topics.connectCrypto.title`, `rowLabel` | Connect Binance, Bybit or a Bitcoin Wallet; Connect Binance, Bybit or a Bitcoin wallet | Підключення Binance, Bybit або гаманця Bitcoin (обидва) |
| `help.topics.connectCrypto.steps.2` | Under "Exchange or wallet", choose "Binance", "Bybit" or "Bitcoin wallet address". | У полі «Біржа або гаманець» оберіть «Binance», «Bybit» або «Адреса гаманця Bitcoin». |
| `help.topics.connectCrypto.steps.4` (new; the old 4 and 5 become 5 and 6; O15, O25, O39 C1, O60. Level: MEASURED for read-only with no IP restriction, every read box and the main account; QUOTE EU 7.4 for Bybit EU; UNVERIFIED for another regional site, so "may not"; QUOTE for 90 days and renewal before the date, and "about" for the reading of O60) | For Bybit: Kiko works only with global accounts (bybit.com). It does not support Bybit EU accounts, and a key from another regional site may not be accepted. Tap "Open Bybit API management" and, on your main account, create a read-only key with every read box offered ticked and no IP restriction. Paste the "API key" and "API secret", then tap "Connect Bybit". Bybit ends the key after about 90 days; renew it there before that date, and the key stays the same. The shipped `bybitKinds` text follows here, word for word. | Для Bybit: Кіко працює лише з глобальними акаунтами (bybit.com). Він не підтримує акаунти Bybit EU, а ключ з іншого регіонального сайту може не підійти. Натисніть «Відкрити керування API Bybit» і в основному акаунті створіть ключ лише для читання, позначте всі запропоновані дозволи на читання й не вмикайте обмеження за IP. Вставте «API ключ» і «API секрет», потім натисніть «Підключити Bybit». Bybit припиняє дію ключа приблизно через 90 днів; подовжте її там до цієї дати, і ключ лишиться той самий. Далі йде текст `bybitKinds` слово в слово. |

Clauses per predicted outcome (O15). Only one kind set ships, so `bybitKinds`, the footer, the help step and
the policy (section 9) each hold one combination; the other clauses never reach the catalogue. A mixed P3 result
(one Earn category separate, one not) uses E2's shape with the matching words, and set 1 step 10/11 writes it here.
E3 wins over E2 and E4: when no Earn money is separate, that money is already in the balance. M1 leaves the shipped text
(internal deposits ship docs only, PLANNER CALL 31), and M2, W1, F2 and L1 now hold. Their outcome cells keep the old wording as a
record.

| Clause | Outcome | Replaces | en | uk |
|---|---|---|---|---|
| E1 | Does not ship (O75). Was: P3: Earn money is separate; both categories tested | none, the default | Balances: Unified, Funding, Flexible Savings, On-Chain Earn | Баланси: Unified, Funding, Flexible Savings, On-Chain Earn |
| E2 | Does not ship (O75). Was: no on-chain position to test | In `bybitKinds`, the list loses On-Chain Earn, and this follows. In the footer, "Earn products other than Flexible Savings", and this follows | On-Chain Earn is not read, so money there is not in your balance. | Він не читає On-Chain Earn, тож кошти там не входять до вашого балансу. |
| E3 | Does not ship (O75). Was: P3: no separate Earn money | In `bybitKinds`, the list becomes Unified, Funding, and this follows. In the footer, the Earn products clause goes, and this follows | Money in Earn already counts inside those balances, so Earn has no holding of its own. | Кошти в Earn уже входять до цих балансів, тож окремого активу Earn немає. |
| E4 | The redeem on testnet: a redeemed row has no `status` and a non-zero `amount`, so FlexibleSaving does not ship (O31). Does not ship alone (O75) | In `bybitKinds`, the list loses Flexible Savings, and this follows. In the footer, "Earn products other than On-Chain", and this follows | Flexible Savings is not read, so money there is not in your balance. | Він не читає Flexible Savings, тож кошти там не входять до вашого балансу. |
| E2 and E4 | SHIPS (O75): no reading exists, so no Earn category is read. The user ruled this text with the note that it is unproved: if Earn money stays in the wallets, the text is false and the total stays right. In `bybitKinds`, "other Earn products" also goes from the not-read list, and this sentence follows that list (PLANNER CALL 85; `texts-for-review-o76.md`) | In `bybitKinds`, the list becomes Unified, Funding, and this follows. In the footer, the Earn products clause goes, and this follows | Earn is not read, so money there is not in your balance. | Він не читає Earn, тож кошти там не входять до вашого балансу. |
| M1 | Was the default when a sender was needed (O15). A record since PLANNER CALL 31; no probe in 1.4 | none, the default | deposits sent by another Bybit user (named as not read) | поповнення від іншого користувача Bybit (названо як те, що не читається) |
| M2 | P5 passed with a real sender | In `bybitKinds`, "deposits" gains this, and the not-read item goes. In the footer, the first item goes | deposits, including those sent by another Bybit user | поповнення, зокрема від іншого користувача Bybit |
| W1 | Rule 45 outcome (b): no page names the wallet. Docs only (O62) | Added to the footer and to the end of `bybitKinds` | Bybit's deposit and withdrawal records do not say which wallet they used, so Kiko lists them all on Funding. Your current balances are not affected. (was: "Your balances", changed because a row feeds the past of the net-worth line) | Записи Bybit про поповнення й виведення не вказують, який гаманець використано, тож Кіко показує їх усі на Funding. Це не впливає на ваші поточні баланси. |
| F1 | Rule 41: no page says whether `amount` holds the fee. Docs only (O62) | Added to the footer | Deposit and withdrawal amounts are as Bybit reports them, with no separate fee line. | Суми поповнень і виведень показано так, як їх повідомляє Bybit, без окремого рядка комісії. |
| F2 | Rule 49: a spot row's `change` is net of its fee. QUOTE for the sum; docs only for a spot row (O64) | Added to the footer | A spot trade's amount already holds its fee. | Сума спотової угоди вже містить її комісію. |
| F3 | Rule 51 and PLANNER CALL 56. Docs only (O65) | Added to the footer | A Funding wallet move is one no other Bybit record explains; it does not count as spending, and one that looks like a record Kiko already has stays out. | Рух коштів у гаманці Funding — це запис, якого не пояснює жоден інший запис Bybit; він не рахується як витрата, а рух, схожий на вже наявний запис, Кіко не показує. |
| L1 | What stays wrong (section 3; O64, O65, PLANNER CALL 47). COMPUTED, and QUOTE for the convert date. Was: "Kiko cannot read coins credited by P2P, ... Earn yield, money moved into an Earn product it does not read, interest, bonuses and airdrops", with no wallet named. "Cannot read" left where the ledger may read it, and no gap is called closed: no page shows a P2P row. N8 adds loans, stocks, card purchases and rewards, and moves to a sub-account (was: not named) | Added to the end of `bybitKinds`; the help step takes it through `bybitKinds`. Was: also inside `statistics.bybitPastLimits`, now clause L1S | On Unified, Kiko cannot read coins credited by P2P, converts made on the website or in the app before 10 September 2025, Earn yield, money moved into an Earn product it does not read, interest, bonuses, airdrops, loans, stocks, card purchases and rewards, or moves to a sub-account. It cannot read derivatives profit and loss, or anything older than two years. On Funding, it reads such moves only as far as Bybit's Funding record lists them, and a move that looks like one it already has stays out. Kiko can also rarely count a move twice. The past of your net worth can be off by those amounts. | В Unified Кіко не може прочитати монети, зараховані через P2P, конвертації на сайті чи в застосунку до 10 вересня 2025 року, дохід Earn, кошти, переведені в продукт Earn, який він не читає, відсотки, бонуси, аірдропи, позики, акції, покупки й винагороди за карткою та перекази на субакаунт. Він не може прочитати прибуток і збитки деривативів, а також усе, що старше за два роки. У Funding він читає такі рухи лише настільки, наскільки їх показує журнал Funding у Bybit, а рух, схожий на вже наявний запис, не показує. Кіко також може зрідка врахувати рух двічі. Минуле вашого капіталу може відрізнятися на ці суми. |
| L1S | The short form of L1 for the phone (PLANNER CALL 69). COMPUTED: under the line at about 48 characters per row. L1 with its two sentences around it would be 677 characters, about 15 rows, on the card that holds the chart. This text is 444 characters, about 10 rows, en, and 499 characters, about 11 rows, uk (O85: the last sentence, approved by the user, "Add sentence"; was: 334, about 7 rows, and 357, about 8 rows, with no such sentence; F6, F7; before that 297, about 7 rows, and 312, about 7 rows, with no Earn stake and no double count, and "because Kiko cannot read", which is the wrong reason for a double). L1 is now 596 characters en and 615 uk, about 13 rows (was: 555). The device pass reads it (set 7). The detail moves to `bybitKinds`, on the account's detail, which this text names | The whole of `statistics.bybitPastLimits` | Bybit: the past of this line can be off. Kiko cannot read every move: P2P credits, Earn yield and stakes, interest, bonuses, loans, stocks, card spending, sub-account moves and derivatives, or anything older than two years. It can also rarely count a move twice. Your current balances are not affected. The account's details say more. A coin Kiko could not read stays on this line at its last read balance, or stays off it with no earlier sync. | Bybit: минуле на цій лінії може бути неточним. Кіко читає не всі рухи коштів: зарахування через P2P, дохід і вклади Earn, відсотки, бонуси, позики, акції, витрати карткою, перекази на субакаунт і деривативи, а також усе, що старше за два роки. Він також може зрідка врахувати рух двічі. Це не впливає на ваші поточні баланси. Докладніше — у деталях акаунта. Монета, яку Кіко не зміг прочитати, лишається на цій лінії з останнім прочитаним балансом, а без попередньої синхронізації її на лінії немає. |

The wallet names Unified, Funding, Earn in holding names are proper nouns kept in code, `'Bybit <Wallet>
· <CODE>'`. The help step names no box list: it says every read box offered (section 6.8). That a read-only key works with
no IP restriction is MEASURED 2026-11-04 for the user's key (O25, section 6.8).

## 9. Compliance (kiko-compliance)

**ATS and pins.** New credentialed domain `api.bybit.com`, `NSIncludesSubdomains` false, two
`NSPinnedCAIdentities`. CA identities: primary root `Amazon Root CA 1`,
`++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=`, expires 2037-12-31; backup intermediate `Amazon RSA 2048
M01`, `DxH4tt40L+eduF6szpY6TONlxhZhBd+pJ9wbHlQ2fuw=`, expires 2030-08-23. research-bybit-legal section 5
gives the leaf and the intermediate; the root SPKI was MEASURED by the planner with the runbook's `openssl`
line on 2026-11-03, and both equal `api.monobank.ua`'s pins. Leaf `swOm16kG...` never pinned, it renews
2027-02-24. Rotation note: Amazon rotates intermediates, so a new one is covered by the root pin and the
backup refreshes at the next release; a move to another CA replaces both. `api.bybit.com` joins the runbook's
host loop and the table in `docs/security/README.md`. `api.bytick.com` is not used and not pinned. The host
sits behind CloudFront (MEASURED, response headers), so a CA move is possible without notice: pins fail
closed, the text is the network failure.

**`check:plist`.** `credential_files` regex in `scripts/checks/plist.sh` gains `X-BAPI-API-KEY`, with a row
in `__tests__/plist-credential-detect.test.ts`, BEFORE the client exists, so the client is checked for pins,
`@env` host and `no-store` from its first commit. `Cache-Control: no-store` on every request.

**Keychain.** Service `kiko.bybit.credentials.<accountId>`, username `bybit`, JSON `{apiKey, secret}`,
written by `saveExchangeCredentials`, so `hardenedFor`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. No global item, no
migration, no repair. Standing item (b) re-checked. The pasted pair goes nowhere else; `.kiko` only with
the credentials toggle.

**The one change to this rule (O93, PLANNER CALL 103).** The raw `userID` still reaches no row, state, log or description, and A31 stays as written. The provider and the connect read it to make one value, `signQuery(accountId, userID)`, and `exchange_state` and `.kiko` keep that value. The value is not anonymous: a UID has few digits, and the same state holds the account id, so a person who has the data and a script can find the UID. It hides the UID only from a casual reader. The policy says so (below). A `.kiko` file is encrypted (AES-256-GCM), so for a file that person also needs the file's key. Was: `userID` is never parsed, and Kiko keeps nothing made from it.

**Personal data (O5, O6, O64; O93 above).** Never parsed into a row, state, log or description: `internal-deposit.address`,
`fromMemberId`, `toAddress`, `fromAddress`, `tag`, `txID`, query-api's `userID` (only for the value above), `inviterID`, `kycRegion`,
`note`; on the convert route `userId`, `extInfo` with `paramValue`; on the log route the value of `tradeId` (the parse keeps only whether it is empty, PLANNER CALL 64), `orderLinkId` (a text the user or a bot typed); on the ledger route `memberId`, `afterAmt`, `showBusiTypeEn`, `descriptionEn`. `showBusiType` and `description` are read as words against a closed list at the parse, which stores one boolean, and the words are never stored (C1; was: rule 51 step 3 read them at each reconcile, against this text). Parsers read named fields only. A sentinel test covers each. `readOnly` and `isMaster`
hold no personal data; they are read at connect and never stored (O13). `permissions` is not read (section 6.8).

Which ids are stored, and why (stage E): the log `id` only inside its row key, because the key needs it; the page's sample `592324_XRPUSDT_161440249321` reads as holding an account number (an inference), so the policy names it. `orderId` only inside the pair id, because a delete follows the pair. `exchangeTxId` inside the convert's pair id and, for a refused convert, inside its `notImported` entry (`notImportedEntry`), so the policy names refused records too (was: "only inside the convert's pair id"). `tradeId` is not stored: the key does not need it, and the guard needs only whether it is empty. `currcCursor` only inside the row key and the stored set (O65): the page's sample decodes from base64 to a plain number (an inference), so the policy names it as an ID of that record. The stored set holds the columns of stage F for each ledger row and source: coin, direction, amount, fee, tax, the start and end of its time, its series, a yes or no for an Earn word, and that key, also for a ledger row with no row of its own, so the policy names them (C1; was: coin, direction, amount, time and key).

**Privacy policy.** Section 3 of `docs/privacy-policy.en.md` and `docs/privacy-policy.md` gets the two blocks
below (E1 and M2 wording; O24, O13, O15, O34, O62, O64).

> en: **Bybit** (`api.bybit.com`): using your read-only API key: details of the key itself (whether it is
> read-only, whether it belongs to your main account, and when it ends); your balances of
> every coin and fiat currency (Unified, Funding, Flexible Savings, On-Chain Earn); your deposit history, including
> deposits sent by another Bybit user, your withdrawal history; your transfers between your Bybit wallets; your Unified
> account's transaction log, from which Kiko imports spot trades; your convert history; and your Funding wallet's transaction record.
> Bybit's answers can include your Bybit user ID and the sender's or recipient's address, email, phone number or Bybit user ID. They reach only your device,
> and Kiko does not keep those details, with one exception named at the end of this entry. Kiko keeps on your device the tickers of coins it does not track or could not read, the wallets and
> the number of Earn positions it left out, the kinds of log entries it did not import, the date your key ends, and, inside each
> imported trade or convert and each convert it could not import, Bybit's IDs of that record and its order, which can hold your account number; for each move of your Funding
> wallet's record and each move matched to one, its coin, direction, amount, fee, tax, time, kind of move and Bybit's ID, also for one that Kiko does not list; this also travels in a `.kiko` export.
> The exception (O93, a DRAFT for the user's review): from your own Bybit user ID, Kiko makes a value and keeps it on your device and in a `.kiko` export, so that it can refuse a key of another Bybit account while an account in Kiko still has holdings from the first. The value is not the ID itself, but the ID is a short number: anyone who can read the value, for example from a `.kiko` export and its key, can find your ID with a script. A later read of a key replaces the value, and deleting that account in Kiko deletes it.

> uk: **Bybit** (`api.bybit.com`): за допомогою вашого API-ключа лише для читання: дані самого ключа (чи він
> лише для читання, чи належить вашому основному акаунту й коли завершується його дія); ваші
> баланси всіх монет і фіатних валют (Unified, Funding, Flexible Savings, On-Chain Earn); історія ваших поповнень,
> зокрема від іншого користувача Bybit, історія виведень; перекази між гаманцями Bybit; журнал операцій вашого акаунта
> Unified, з якого Кіко імпортує спотові угоди; історія ваших конвертацій; журнал операцій вашого гаманця Funding. Відповіді Bybit можуть
> містити ваш ID користувача Bybit, а також адресу, email, номер телефону чи ID користувача Bybit відправника або отримувача. Вони надходять лише на ваш пристрій, і Кіко цих
> даних не зберігає, за одним винятком, названим наприкінці цього пункту. Кіко зберігає на
> вашому пристрої тікери монет, які не відстежує або не зміг прочитати, гаманці й кількість позицій Earn, які він
> не врахував, види записів журналу, які він не імпортував, дату завершення дії ключа, а також, у кожній імпортованій угоді чи
> конвертації та в кожній конвертації, яку він не зміг імпортувати, ID цього запису й замовлення в Bybit, де може бути номер вашого акаунта; для кожного руху коштів із журналу гаманця Funding і кожного
> зіставленого з ним запису — монету, напрям, суму, комісію, податок, час, вид руху та ID у Bybit, також для руху, який Кіко не показує; це також переноситься в експорт `.kiko`.
> Виняток (O93, ЧЕРНЕТКА для перегляду користувачем): із вашого власного ID користувача Bybit Кіко створює значення й зберігає його на вашому пристрої та в експорті `.kiko`, щоб відхилити ключ іншого акаунта Bybit, поки рахунок у Кіко ще містить активи першого. Це значення не є самим ID, але ID — коротке число: будь-хто, хто може прочитати це значення, наприклад з експорту `.kiko` і його ключа, може знайти ваш ID за допомогою скрипта. Пізніше читання ключа замінює це значення, а видалення цього рахунку в Кіко видаляє його.

The counterparty text says "does not keep", because the response reaches the device and the parser drops it
(O24). The level of the sentence "can include": QUOTE, live pages: `toAddress`, `fromAddress`, "Email address or phone
number" for the internal `address` (O6, O34), `fromMemberId`, a withdrawal `toAddress` that can be a Bybit UID (F12, read on the page by the review), and `userId` on the convert route. The kept data holds no row value: rows live in the ledger, as Binance's do.

Policy variants per kind set (O15). M2 is now the block above, so its row is a record. "E2 and E4" ships (O75):

| Outcome | en | uk |
|---|---|---|
| E2 | the balance list reads "(Unified, Funding, Flexible Savings)" | список балансів: «(Unified, Funding, Flexible Savings)» |
| E3 (O34) | the balance list reads "(Unified, Funding)", and the kept-data sentence reads "the wallets it left out", with no count of Earn positions | список балансів: «(Unified, Funding)»; у реченні про збережені дані: «гаманці, які він не врахував», без кількості позицій Earn |
| E4 (O31) | the balance list reads "(Unified, Funding, On-Chain Earn)" | список балансів: «(Unified, Funding, On-Chain Earn)» |
| E2 and E4 | the same as E3 | так само, як E3 |
| M2 (O34; the block above holds the words, now with the Bybit user ID of F12) | "your deposit history, including deposits sent by another Bybit user, your withdrawal history"; and the counterparty text of the block above | «історія ваших поповнень, зокрема від іншого користувача Bybit, історія виведень»; і речення про іншу сторону з блоку вище |

Section 3's intro names Bybit too (O24). In en, "Binance account data, Blockstream" becomes "Binance account
data, Bybit account data, Blockstream". In uk, "дані облікового запису Binance, Blockstream" becomes "дані
облікового запису Binance, дані облікового запису Bybit, Blockstream".

Section 5's Keychain sentence is "such as", so it holds. Site pages rebuild (`docs/privacy-site/`). New
`BYBIT_SIGNED_PATHS` in `bybit.endpoints.ts` from set 3, and `bybit.privacy-policy.test.ts` in the policy step, one
phrase per path in the four files, as `binance.privacy-policy.test.ts` does.

The policy step is plan set 7 step 4/6, in the batch that ships Bybit (O29): the text in the md and the site pages,
with the variant that fits the shipped kinds. `npm run privacy:site -- check` compares the LIVE page, and no check, hook
or suite runs it (CODE: `scripts/privacy-site.js` `check`; `git grep`: only `package.json`), so no held tip runs it.
Set 7 compares `npm run privacy:site -- hosts` with the md. The live check runs at publish only. `www.bybit.com` joins
`NON_REQUEST_HOSTS` in the step that adds `BYBIT_API_MANAGEMENT_URL` (plan set 7 step 1/6). Effective date, per
`harness/kiko/skills/release/SKILL.md` "Privacy policy check": QUOTE "Never edit the markdown without bumping its
effective date, and re-date it to the PUBLISH day when gh-pages goes out later than the edit". So the policy step bumps
the date, the publish re-dates it if it goes out later, and `check` exits 0 before the upload. The same section asks
that the user approve the regenerated pages and that the user gets the gh-pages publish commands.

**App Privacy.** Answers stay "Data Not Collected": calls go from the device straight to Bybit under the
user's own key; no data reaches Kiko or a partner. Privacy manifest: no change, no new required-reason API.

**Encryption export.** HMAC-SHA256 is the existing signing. No change.

**Guideline 2.5.19.** No flag. Earlier sets have no way in from the UI; nothing ships until the catalog
set, and the catalog set merges only after the device check (O9, O21).

**App Review notes and kit section D (O22).** Plan set 7 step 5/6, owner `kiko:release`, because the kit
(`memory/refs/resubmission-kit.md`) is outside the repository. Per kiko-compliance ("When a feature needs a user
credential the demo cannot carry, the reviewer notes must supply it or say how to get it"), Notes for Review name
Bybit, what it reads, that it needs the user's own key, and how to get one: a global account at bybit.com and a
read-only key. They also state that a request from a US IP gets HTTP 403 (research QUOTE "IP addresses located in
the US or Mainland China are restricted and will return a 403 Forbidden error", itself a digest, so SUMMARY), and
that the app then shows `bybitForbidden`. Per kiko-compliance ("is still a judgment question: does the dataset
show it?"), the step states whether the demo `.kiko` shows Bybit, with its reason. Kit section D gains the Bybit
line of App Privacy.

**Trademark.** Plain text `Bybit`, no logo, generic icon, the existing not-affiliated caption. Global 40.4(e) is a brand
clause: QUOTE "make any commercial use of the Site or Platform or Bybit's logo, trademark or brand name in any way". It limits
commercial use only. On the verdict's reading, plain text in a free app is not commercial use; the store listing is the closest
point to it (C4). The EU terms have no rule on brand use. Add `Bybit` to the `en.casing-by-role.test.ts` allowlist.

**Terms verdict, 2026-11-03 (O39).** A `kiko:reviewer` read the terms: PASS WITH CONDITIONS for global bybit.com accounts. The
reviewer's words: "This is a reading of terms, not legal advice." No clause of the API Terms or the Global Terms forbids a
third-party read-only app, a key held by that app on the user's device, or the name in plain text. For a Bybit EU account the
use is FORBIDDEN by EU 7.4. The stop rule (O23) does not fire, because the track does not need EU accounts. Full text and
quotes: `.superpowers/sdd/1.4-bybit/terms-verdict.md`.

Sources:

| Document | Date | Text |
|---|---|---|
| API Terms & Conditions, PDF | undated | `research-bybit-legal.md` section 1. It has no read-only clause, no personal-use clause and no name clause. Sections 1 and 2.1 are not in the file (C7) |
| Global: "BVAPO Platform Terms and Conditions", `https://www.bybit.com/en/legal/terms-of-service/terms-of-service` | page last updated 2026-10-16 | `memory/refs/bybit-terms-2026-11-03/global-terms-full.txt`, main checkout |
| EU: `https://www.bybit.eu/en-EU/legal/terms-and-conditions/terms-of-service` | page last updated 2026-07-20; the PDF is dated 12 June 2026 | `memory/refs/bybit-terms-2026-11-03/eu-terms-full.txt`, main checkout |
| How the pages were read | 2026-11-03 | `memory/refs/bybit-terms-2026-11-03/SOURCE.md`, main checkout |

Which document governs: the API Terms are the specific document for API use, and their 7.1 adds the API Documentation. The
Global Terms bind in parallel and never name the API Terms. No clause sets a precedence between them (8.3 prevails only over
the Documentation), so the stricter applies. The entity of the API Terms is unread; their URL path says BYBIT, and the Global
Terms name BVAPO.

| Clause | Text, in short | The verdict's reading (free app, key only on the device) |
|---|---|---|
| API 2.4 | An API Client that uses the user's key can give user instructions; keep it secure | Not forbidden. API 2.4, 3.1 and 9.1(d) contemplate client applications. Kiko sends reads only; Keychain, App Lock and pins are the security asked for |
| API 2.5 | Giving a key to a third-party provider is like giving login credentials; use caution | A warning, not a ban. The key never leaves the device, and the disclosure line says so (C5) |
| API 6.5 | No replicating products or services, including functions or clients on platforms, or attempting to compete with or replace their user experience | NOT FORBIDDEN, BUT REAL DOUBT. "Replicate ... functions" literally reaches a balance and history view, because Global 7.6 lists that view as a Bybit function. The reading: an anti-clone clause, and Kiko replaces no Bybit product. But API 7.6 ("we deem, in our sole discretion") and 10.1 let Bybit decide otherwise. The doubt stays open, and the user accepted it (O42, below). Any trading feature re-opens it (C2) |
| API 6.7 | No repackaging or reselling services, API or Service Data | Not forbidden, for "repackage" and for "resell". Each user reads only their own data with their own key, so nothing is offered to others |
| API 6.9 | No commercially exploiting the APIs | Not forbidden while Kiko earns nothing from the API. "Commercially exploit" has no definition. A price, an ad, an IAP, a tip, a sponsor or an affiliate code re-opens it (C3) |
| Global 6.2 | No providing access to a third party; no service bureau | Not forbidden. The maker gets no access and has no server |
| Global "Authorized Individual" | A person a User authorizes to access on the User's behalf | Not reached. The maker never accesses |
| Global 6.3(k) | No robot or device that reproduces or circumvents the Platform's structure or presentation | Not forbidden. The object is the structure or presentation, and the API is the sanctioned route |
| Global 40.4(a) | No reproducing data or content provided through the Platform | Not applied to the user's own data: a literal reading would forbid every API read. The doubt stays stated |
| Global 40.4(d) | No editing or filtering information on Bybit's Sites | Covers "Bybit's Sites", not API output |
| Global 40.4(e) | No commercial use of the Site, the Platform, or Bybit's logo, trademark or brand name | Not forbidden; see "Trademark" above and C4 |
| EU 7.4, 7.1, 9.1.2, 9.2.2 | No access through non-official or unauthorised applications; no third-party access; no automated access | FORBIDDEN for a Bybit EU account (section 6.2, C1) |

Also noted: API 7.7 (Kiko does not mask its identity), API 6.6 (no monitoring use: section 10), API 7.6 (audit on request),
API 10.1 (Bybit can end any key for any reason, whatever this reading says; a refused key is a case the text fits).

Who is bound: each Kiko user is "you" in the API Terms and a "User" in the Global Terms. A breach falls on that user's key
(API 10.1), and API 4.2, 7.3 and 9 put liability on that user. A maker with no account is not a party to the API Terms and not a
defined "User". The Global preamble still claims to bind anyone "VISITING" the site, and the reviewer cannot say if that holds.
Trademark law applies with or without a contract. For the user who opens the R1 account: section 10.

Stated doubts: "replicate" and "commercially exploit" have no definition. No one compared the extracted text with the pages by
eye. Clause numbers in Global 3, 6, 11 and EU 9 are the reviewer's reconstruction, because the PDF extraction detaches them. EU
1.3 says German prevails, and the reviewer read English.

Conditions of the verdict. C6 is a human action, so it is a user line in section 10, not a row here.

| Id | Condition | Set and step | Test or check |
|---|---|---|---|
| C1 copy | For Bybit EU, the copy says plainly that Kiko does not support these accounts; `may not` stays for other regional sites. No workaround text. The key never goes to `api.bybit.eu` | Plan set 3 step 2/7 (host); set 7 steps 1/6, 2/6, 3/6 (copy) | Pinned: A13, A51, A52 |
| C2 limit | A closed list of GET endpoints, no order, no write path. Any trading feature re-opens API 6.5 | Plan set 3 step 2/7; each later step that adds a route | Mechanizable: A53 |
| C3 free | No price, ad, IAP, tip, sponsor, or affiliate code on `BYBIT_API_MANAGEMENT_URL`. Any of these re-opens API 6.9 and Global 40.4(e) | URL: plan set 7 step 1/6. Business state: the standing item of set 8 step 2/2 | Pinned for the URL: A54. The business state has no test: a reviewer's judgment |
| C4 name | Text only, no logo, no Bybit look, the not-affiliated caption stays. No Bybit in the store title, subtitle or keywords. No line that offers Kiko in place of the Bybit app (API 6.5, Global 40.4(c)) | Plan set 7 step 2/6 (caption), step 5/6 (store metadata), set 7's reviewer (wording) | Pinned for the caption: A55. The wording has no test: a reviewer's judgment |
| C5 key | The key stays on the device through `hardenedFor`; no server copy, no shared key in the build. A key that leaves the device re-opens API 2.5, Global 6.2 and "Authorized Individual" | Plan set 3 step 3/7 | Pinned: A56 |
| C7 re-read | Re-read API Terms sections 1 and 2.1, the API Documentation (API 7.1) and the EU 4.3.7 list at each release that changes Bybit, because the API Terms have no date. A dated Bybit block in kiko-compliance, like the Binance one | Plan set 8 step 2/2 | Not mechanizable: a legal reading |
| Guideline 5.2.2 and the API 6.5 doubt | Both doubts stay OPEN and are ACCEPTED BY THE USER, 2026-11-03 (O42): keep Bybit, global accounts only, no letter to Bybit. The user's words, relayed by the coordinator: "The user in EU can't obtain API key, hence adding bybit to kiko is pointless. Continue."; then, asked which reading, the user picked "Keep Bybit, global only". The guideline text was not re-read: the reviewer cited it from memory as asking for specific permission under the service's terms, with authorization on request. kiko-compliance has no 5.2.2 item. The closest permission here is API 2.4, 3.1 and 5.1, which is general and does not name Kiko. A written yes from Bybit would close this gap and the API 6.5 doubt; the user chose not to ask for one | The kiko-compliance item: plan set 8 step 2/2 | Not mechanizable: a judgment |

**The browser step (PLANNER CALL 18).** `https://www.bybit.com/en/terms-service` and
`https://www.bybit.eu/en-EU/terms-service/` are client-rendered shells to curl. The step has two parts:

- Part 1: DONE 2026-11-03. The coordinator read both pages in the Orca browser, at the user's word ("You can read both pages in
  the Orca browser"). No login was needed, no account exists, and no paste came. The verdict above rests on that text (O39).
- Part 2: DONE 2026-11-04 at R1 (O60). `BYBIT_API_MANAGEMENT_URL` = https://www.bybit.com/en/app/user/api-management, from
  the user, signed in. No query string, so C3 holds for this URL. No agent opened it.

## 10. The user's probe plan

Status (O75, 2026-11-05): "Accept no testnet" is final. The run ended at Part A, the empty mainnet read. Part B stopped at B1: key creation on testnet answered 10024. Nothing in this section waits now, except R7. The testnet text below is a record of what was planned, and it proves nothing.

The order of the user's steps (O23, O31, O36, O38, O39, O41, O62; was: the browser step inside R1, the verdict after R1 and
R2, the redeem at R6, the script and the approval before the browser step, and R2 to R4 with real money as steps 6 and 7):

1. DONE 2026-11-03: part 1 of the browser step (section 9).
2. DONE 2026-11-03: a `kiko:reviewer` gave the terms verdict, PASS WITH CONDITIONS for global accounts (section 9). The stop
   rule did not fire.
3. Meanwhile set 1's script is written and reviewed, so a pass loses no time (O38). The reviewer gave no pass: three reviews each
   gave FIX FIRST, and O56 stopped the chain after fix round 4 and replaces that pass. The user gets the script only after step 4.
4. DONE 2026-11-04: the user approved this spec, with the verdict in it (PLANNER CALL 23, O41,
   O59). The coordinator relayed the answer "Approve (Recommended)", at tip fc83566e2.
5. DONE 2026-11-04: R1 and the second key, no money (O60). The user deleted the second key (O61 (c)). The first key stays for R7.
6. DONE by the commit of this text: the planner wrote those results. The commit of the O66 fix round is the set 1 tip, and set 2 bases on it (was: the fix round of O64)
   (O62, O63 (e); was: 7a2391ca8; before that, the commit after the last results of R3 and R4, O36).
7. DONE 2026-11-05: the empty mainnet read, the first key, no money (below).
8. CLOSED (O75): the testnet run did not take place. Set 3 step 7/7 writes no code, `locked` is ruled (O76), and set 7 takes clause "E2 and E4".
9. Set 7's device check is on device (below). R7 on 2027-02-05 or later (O55): an open check after the ship (Q4).

No step needs the user's money (O62). R2, R3 and R4 with real money, K1, and K4 to K8 with real money are under Backlog: later,
no date, the user's choice. No code waits for them. No code that needs Bybit comes before the terms verdict.

### The empty mainnet read

DONE 2026-11-05. Output: `memory/refs/bybit-probe-output-2026-11-05.txt`, main checkout. 11 reads, each HTTP 200 and `retCode` 0. "No reading": no coin row and no history row exists, so the P2 and P3 rows stay docs only, with these shapes MEASURED:

| Read | Empty shape, MEASURED |
|---|---|
| UNIFIED (P2) | `list:[{coin:[]}]`, one account of type UNIFIED, `coin` an empty array |
| FUND (P2) | `balance:[]`, with `memberId` and `accountType` beside it |
| Earn, both categories (P3) | `list:[]`, `nextPageCursor` absent |
| Log (P8) | 0 rows, `nextPageCursor` absent |
| Convert (P9) | 0 rows; the read at `index` 9999 is empty |
| Funding ledger (P19) | 0 rows, `nextPageCursor` empty, on the last 7 days and on the window 729 days back |

The plan was: R1 printed retCodes only, so no balance body of the empty account is known. The first key, on mainnet, no money:

- `R2 P2`: 2 calls, no prompt (P2 prompts only in R3). It prints the UNIFIED account fields, the FUND result fields, and 0 coin
  rows or the rows that an empty account lists. This fixes the empty-list shape of rule 5, and set 3 fixtures use it.
- `R4 P3`, typing `skip` at the prompt: 4 calls, reading 1 only. The prompt's redeem text does not fit an empty account, and
  `skip` ends it with no reading 2. It prints the Earn position fields on an empty account, for Earn if it ships. A plain `R4`
  would also reach P6's withdrawal prompt, so it is not used.
- `R2 P8 P9`, after set 1 step 11/11: 3 calls, no prompt (was: 2; P9 adds its read past the end). They prove that the first key reaches the log and the convert route, which R1's P11 did not ask, and they give the empty shape and what `index` past the end returns.
- `R2 P19`, after set 1 step 11/11: at most 3 calls, no prompt. It proves that the first key reaches the ledger route, gives the empty shape, and asks a window 729 days back (only a refusal moves a floor, O20).

Neither disturbs R7: they are reads, and none renews anything. No script change is needed for `R2 P2` and `R4 P3`.

### The testnet run (CLOSED, O75: a record; no step ran)

Key creation answered 10024 at step 1. K2 "always in step 3" (a note of 2026-11-04, because P19 needs a transfer) falls with the run. This text proposes no way around that block.

Facts with their levels are in `report-no-money.md`. The testnet help page was read as a search snippet only (SUMMARY). KYC, access
from Ukraine and any testnet terms for automated reads are not checked. A testnet reading proves shape, not mainnet (no page
states parity). It is the free proof for the items that can make a current balance wrong, and for coin-row shape (O62).

The script (`memory/refs/bybit-probe.sh`, changed by a developer from this text):

- A closed host choice: a first argument `--testnet` selects `https://api-testnet.bybit.com`; no such argument keeps
  `https://api.bybit.com`, unchanged. No environment variable. `--testnet` in any other place stays refused by the existing
  "not a part of" check, so it can never run on mainnet by mistake. `--testnet R7` is refused before the key prompt: P17 asks for
  a renewal.
- The header line and the prompt before the key name the host. P1's fixed host line takes the host of the run. The usage
  text states the testnet run and marks R2 to R4 with real money as later, no date.
- `memory/refs/bybit-probe.test.sh` pins, per run, that every call goes to the chosen host and none to the other, and that a
  default run is byte-identical in its calls to today's. The closed list of paths, GET only and `CALL_CAP` stay.
- Output goes to its own file: `memory/refs/bybit-probe-testnet-output-<date>.txt`.

The run names fit, so none is new: `R3` gives P2 with the K3 prompt (`[ "$RUN" = R3 ]`), then P3 with the K4 and K5 prompt. `R4 P3`
gives P3 with the prompt (`PARTS_NAMED`). `R2 P2`, `R2 P7` and `R2 P18` have no prompt.

The user's steps, each with the proof it gives:

| # | The user does | Command, with `--testnet` first | Proof | If it fails or is refused |
|---|---|---|---|---|
| 1 | A separate account on testnet.bybit.com; a read-only key, every read box offered, no IP restriction | `R1 P1 P11` | The key shape on testnet; which routes answer there | The question returns to the user (below) |
| 2 | Test coins from the Assets page | `R2 P2` | A plain first read: coin-row fields on both routes, and which wallet holds the coins | Same |
| 3 | K2, only if UNIFIED or FUND shows no coin row: a transfer between them | `R2 P2`, then `R2 P7` | Coin rows on both wallets. One transfer row: fields, status word, time class. It adds shape only, and the row stays docs only for mainnet | K2 refused: the wallet with no row rests on the docs and the mainnet read |
| 4 | K3: a far-off unfilled spot limit order | `R3`: P2 reads, cancel K3 at its prompt, P2 reads again. Then P3 reading 1; at its prompt K4: subscribe Flexible Savings, and K5: on-chain Earn with another amount; Enter after they land; reading 2 | `locked` inside `walletBalance`; the double count | K3 refused or `locked` not shown: the question returns to the user, and it is not decided here. K4 refused: clause "E2 and E4". K5 refused: clause E2 |
| 5 | K11 at the prompt: redeem ALL Flexible Savings, wait until it lands | `R4 P3` | The redeemed row and the redeem check | Refused or not landed: FlexibleSaving does not ship, clause E4 |
| 6 | Nothing | `R2 P18` | Decimal counts per coin on the balance routes (8 calls; the history routes print none) | Decimals rest on the docs and the curated scale |
| 7 (new, O64; P19 by O65; waits for set 1 step 11/11) | K9: one spot buy that fills, a small market order or a limit order that crosses. K10, if testnet offers it: one convert in Funding and one in Unified | `R2 P7 P8 P9 P19`. P19 reads the ledger after K2, K4, K5, K11, K10 and the test coins of step 2, so one run shows them all | P19 is the free proof of a ledger row, shape only: which words each move takes, and whether a transfer and a Funding convert match their ledger rows by the forms and the window of section 3, "Stage F". The one free proof of a log row, shape only, no mainnet parity: how many rows per fill and per order, which coin each holds, `change + fee = qty` yes or no, whether `id` repeats, and the words of `type` and `category`. For a convert: the wallet word, and whether a convert in Unified also shows in the log, and under which word | No fill (a market order can fail with no liquidity, FAQ, SUMMARY), or refused: trades and converts stay docs only, and nothing blocks. A row shape that differs edits section 3 before set 9 writes it, or as a fix to set 9 |

The decision on P8 and P9 (PLANNER CALL 44): add them. O37 left them out because stages C and D were deferred, and O64 brings the trade half back. A fill costs no real money, the shape is the largest open item in stage E, and a wrong shape costs all trades. Size: a floor of 150 script lines and 250 test lines, on top of step 8/11, with 2 new paths on the closed list, closed lists for `type` (the 68 words), `category`, `accountType` and `exchangeStatus`, `<other>` for any other word (O46), the coin shape test (O51), and yes or no comparisons, never an amount. Maximum calls: P8 3, P9 3. New sentinels for the fake-curl test: `userId`, `orderLinkId`, `tradeId`, `paramValue`. Nothing waits for it but its own two reads.

P19 (PLANNER CALL 61): inside set 1 step 11/11, the same step. A floor of 70 script lines and 140 test lines on top of that step (was: 60 and 120; the sign class, F9), 1 new path, new sentinels `memberId`, `afterAmt`, `descriptionEn` and `showBusiTypeEn`. It needs no user step of its own and no money. Earn's words need K4, K5 and K11 to have run, which only an Earn clause that ships needs.

If the account step fails (no access, KYC) or the run cannot start: this track does not decide. The question returns to the user
through the coordinator, with coin rows then resting on the docs and the empty mainnet read, clause "E2 and E4", and `locked` open. That is what happened, and the user ruled `locked` (O76).
Sets 2 to 6 go on meanwhile, except set 3 step 7/7.

### What proves Earn (rule 46, O54, P3's own words; a record: no reading exists, so the row "No reading" holds, O75)

Testnet shows shape, so these readings decide the clause. Each is a printed line of P3.

| Category | Ships only if all of these print | Otherwise |
|---|---|---|
| FlexibleSaving | Stake (K4): `wallet (unified + fund) changed (down); position (flexible + onchain) changed (up)`, and `stake check: wallet fall equals position rise yes`, or, when K5 did not leave the wallet, `wallet fall equals flexible rise yes`. Redeem (K11): `flexible changed (down)`, and the redeem check `wallet rise equals the position fall yes` or `equals the fall + claimableYield yes`. Row after K11: gone, or its `amount` zero, or a `status` outside the allowlist. A row with a `status` is decided by rule 46 | Position rose and wallet `equal`: clause E3. Redeemed row with no `status` and a non-zero `amount`: clause E4. Any other line, a `no`, or no reading: clause E4 |
| OnChain | Stake (K5): `wallet fall equals position rise yes`, a row whose `status` prints `Active` or `Processing`, and an allowlist from what printed (default `Active`) | No position: clause E2. Any other line: clause E2 |

Both fail: clause "E2 and E4". Earn money is then not in the total, and the UI states it. E3 needs its own reading, because it claims the
money is already counted. A testnet pass is shape evidence, and this residual is below.

Q7, answered (O67): Kiko reads Earn only if the testnet run shows the words, by P19 around K4, K5 and K11. A stake that makes no Funding row prints no word, and that counts as not shown. The branches (PLANNER CALL 74):

| P3 reads | P19 shows the words | Clause | Earn read | A stake under a word on no list |
|---|---|---|---|---|
| E1, E2 or E4 | Yes | That clause; the list gains the words | The categories of that clause | M23: a double count, the residual the user read as B's (O67) |
| E1, E2 or E4 | No, or the step fails | "E2 and E4" (Q7's C); the money is not in the balance, and the UI states it | None | M20: none, because the listing is right |
| E3 | Yes | E3; the list gains the words | None: the money is in the balance | M35: a double count |
| E3 | No, or that step fails | E3 stays. "E2 and E4" would say "not in your balance", which P3 shows is false (F5). The list keeps the page's word only | None | M35: a double count, wallet unchanged, +100 before the stake, named in "What stays wrong". Clause L1's "rarely count a move twice" covers it |
| No reading | | "E2 and E4", as above | None | M20 |

`locked`: RULED by the user (O76, "A: Set coin aside"). The docs do not state whether `walletBalance` includes `locked` (docs check of 2026-11-05), no reading exists, and none is planned: no support request and no mainnet measure. Section 3, "The `locked` set-aside". Was: a read around the cancel of K3 would decide it, and the page's sum read the same way; that sum is for isolated margin only.

### Accepted residuals (user, O64: Q5 "E + A", after reading the worked example and what stays wrong)

Was: this heading cited O62's sentence as the acceptance, and that sentence accepts no wrong value (F13). O64 is the acceptance: the user read the five leftovers and that no device build shows a deposit or withdrawal row. Two more cases are new since that reading (section 3, "What stays wrong"); the report names them to the user. O65, O66 and O68 add more rows there, each marked as read, told or open. Section 13 holds what goes to the user (O68).

"docs only" rows have no live proof at all, and that now holds for every coin row, spot row, convert row and ledger row (O75). The first real row on mainnet is read on a real user's
device, and the app has no remote log, so no fault reaches the developer. What each failure looks like:

| Failure | What the user sees |
|---|---|
| A coin-row shape fault | A refusal text per coin (`bybitCoinRefused`), and with no holding `bybitBalancesNotRead`, so the account does not read as empty (section 3) |
| A row shape fault | The row is owed, with a caption. A waiting row is a missing row: a wrong past on the net-worth line by its amount, and short spending for a debit (O63 (d)) |
| Was: a fault of meaning in `locked`, or in Earn after a testnet pass | No longer a way to a wrong current balance: a coin with `locked` is set aside (O76), and Earn is not read (O75). Its own sentence "Earn is not read, so money there is not in your balance" is unproved, and the user ruled it with that said |
| A fault of meaning in a row (fee, rollback, window, a log row that doubles) | A wrong or missing line, or a wrong past point on the net-worth line or in spending (section 3); never a current balance |
| A status the page does not explain | The row waits, with a caption: a missing row, as above. If that status is an end state, it waits until the floor passes it |
| A fault in the ledger's forms, window or words | A row held and counted, or lost with no sign. A double count only in the cases of section 3, "What stays wrong", and those have no sign |

One real deposit, withdrawal, trade and convert can remove the rows' part of this at a later time (Backlog).

### The device check (O44, plan set 7 step 6/6, "fundamentals done")

On mainnet the account is empty, so a device build shows no coin row and no history row. One build only (O75; was: two builds, PLANNER CALL 34). O73 no longer blocks this build (O76). The user knows that the check sees no coin row.

| Build | Proves | Cannot prove |
|---|---|---|
| Real: the set 7 tip, with `next` merged into it just before the build, so its journal holds every migration of `next` and none that `next` lacks (F3, PLANNER CALL 72), `api.bybit.com`, on the user's phone | Pins; connect with the real key, its refusals and 10 calls (section 6.8); the expiry line with 2027-02-04; an empty account with "Last sync" and no holding; every stated limit, `statistics.bybitPastLimits` too; disconnect; Binance still syncs | Any coin row or history row |

No history row and no coin row shows on any device in this track (the user read this for deposits and withdrawals, O64; O75 and O76 extend it). The proof of each is the fake-route tests of sets 3, 5, 6, 9 and 10, from the page samples.

Was: a scratch build on testnet. It falls with the run. The rule of O63 (c) stays for any later build with another host: it NEVER goes on the user's phone, because it has the one bundle id (`deploy-device.sh` `BUNDLE_ID`).

A52 stays: it fails if a tracked env file, plist or `src/` file names `api-testnet`. The real build runs with `EXPECT=api.bybit.com` on `make deploy`, and the report says that no coin row was seen.

The script's parts for 1.4 (O37, O64): P1, P2, P3, P4, P5, P6, P7, P11, P12, P13, P14, P15, P16, P17, P18, and from set 1 step 11/11 P8, P9 and P19. P10 is
used only by stage D, so it is not in the script. Its id stays reserved under Backlog. P14 is in the script, prints
NOT RUN and makes no call (O49).

Script (plan set 1): `memory/refs/bybit-probe.sh`, main checkout, on the eodhd-verify and
binance-operations-probe pattern: hidden prompts, key and URL to `curl -q --noproxy '*' -K -` on stdin, secret to perl HMAC
on stdin, masked URLs, `<run> [part ...]` (a part name after the run runs only that part), GET only, on a closed list of paths.
It prints only field names, types, status words, row counts, decimal counts per coin, time-unit class, the box names of a key's
`permissions`, the UTC date of `expiredAt` and its days left, the value of `deadlineDay` (a day count), `type` (1 or 2), "parentUid is zero",
the mask of a cursor (its first 40 characters: a digit prints 9, a letter prints a, and a character outside `%=_.-` prints ?),
`retCode`, HTTP status, `X-Bapi-Limit*`, and fixed words that compare two readings (equal, changed, yes, no, and unknown only when `bc` gave no answer),
never an amount.

- It prints no server text. A `retCode` prints with a word from a closed table in the script, and a code outside the table prints
  alone (O45).
- A value prints only from a closed list per field. An unknown value prints `<other>`, and that is a result to read (O46).
- Residual accepted (O51): three printed values pass a shape test and not a closed list: a coin name, a group or box name of
  `permissions`, and a wallet-hint value of one or two digits (`iscoin`, `P1_JQ`, `walletword`). A closed list would hide what
  these parts exist to find: which coins and boxes the account really has. The coin test refuses an all-digit name, and the coin and
  box tests refuse a run of 4 or more digits. Cost if wrong: an upper-case word of up to 12 characters in a coin field prints. No
  documented route puts personal data there.
- Residual accepted (O46): a field NAME of plain letters can hold a person's name only if a server uses a value as a key, and no
  documented route does.
- Residual accepted (O56, O58): two withdrawals whose amounts differ by exactly the fee can give
  yes on both wallets for one row, and the other row resolves it. The report for the spec approval
  (O41) named four residuals (O51, O46, O56, O58 (a)), and the user approved with that report in
  hand (O59).
- Cost of a defect at R1 (O56): R1 holds no money, so a defect found there costs only a rerun.

No email, phone, address, name, id or txID is ever printed. A fake-curl test runs before handover, and the orchestrator reads the
whole file. Output is added to `memory/refs/bybit-probe-output-<date>.txt` with `>>`, and each run starts with a line of `########`.
The script prints no elapsed time and repeats no call to measure uptime or latency (API 6.6).

The user line before R1 (C6; a human action, not mechanizable):

- Use a network that shows your true location (no VPN, no proxy), for KYC and for every probe. The script's curl uses
  `--noproxy '*'`, so a proxy variable cannot defeat the "no proxy" step in the script's calls. The script does not detect a VPN.
- Keep the key and the secret in your password manager until R7, and paste them nowhere else. Without them, "renewal keeps the same
  key" (R7) cannot be measured.
- The facts: Global 3.4 lists the Chinese Mainland as an Excluded Jurisdiction, and Global 3.5 allows termination of an account
  for false representations of location or residence. A mainland China IP reading was seen: the bybit.com home page showed a
  banner that the IP address locates the browser in mainland China (`SOURCE.md`, section 9). That banner says nothing about your
  account country. Bybit also returns 403 for those IPs (research, SUMMARY; section 9).
- Keep the probes one bounded run: only the parts of the table below, at the runs it names, a maximum number of calls per part
  and a hard cap (O53), with no uptime or latency measure (API 6.6).
- Who is bound: the user who opens the account is "you" in the API Terms. API 9.1(d) (indemnity for a claim from a third party's
  use of "your API Client(s)") and API 7.6 (audit) then bind that user directly, and so does Global 40.4(e).

The runs in 1.4. None holds money (O62). R2, R3 and R4 with real money are under Backlog.

| Run | When | The user does first | Parts | Proves |
|---|---|---|---|---|
| R1 | DONE 2026-11-04, 46 calls, then the second key, `R1 P1 P11`, 10 calls (O60). Output: `memory/refs/bybit-probe-output-2026-11-04.txt`, lines 1 to 158 and 159 to 215 | Read the C6 line above. A network with no VPN and no proxy (the script's curl uses `--noproxy '*'`, so a proxy variable cannot defeat this step). Global account at bybit.com, KYC as Bybit asks; one key: System-generated, read-only, every read box offered, no IP restriction. Keep the key and the secret in a password manager until R7: without them, "renewal keeps the same key" cannot be measured. Part 2 of the browser step (section 9) | P1, P11, P12, P13 (empty), P14 (no call, O49), P15, P16 | MEASURED: host (O1), key shape, boxes, `isMaster`, expiry date, 9 routes, limits, recv window, transfer path, window edges. The second key: 10005 on UNIFIED. An empty 0 proves no retention (O20) |
| Empty read | DONE 2026-11-05, 11 calls | Nothing | `R2 P2`; `R4 P3` with `skip`; `R2 P8 P9 P19` | MEASURED: the empty body shapes; reach of the log, convert and ledger routes |
| Testnet | CLOSED (O75), did not run | | | Nothing |
| R7 | 2027-02-05 or later, the day after the date `expiredAt` printed (O55, O60); an open check after the ship (Q4). The first key costs nothing, so it stays | Have the key and the secret from the password manager; do not renew first | P17 (up to 6 calls). An ok answer from any of the first three calls (`query-api`, UNIFIED, FUND) prints "not expired yet" and ends the part with no prompt, because a renewal before the expiry loses the expiry error until the next expiry: run it again the next day (O57). A `query-api` answer that cannot be about expiry (HTTP other than 200 or 401, HTTP 200 with no `retCode`, or 10002, 10004 or 10016) makes no prompt and no renewal, and a `retCode` rule wins over HTTP 401, so 401 with 10002 stops. A rate limit also makes no prompt and no renewal. HTTP 401 otherwise goes on, because the docs name it for a bad key and an expired key may get it (UNPROBED(P17)). Any other refusal goes on to UNIFIED, FUND and the renewal prompt | The error after expiry, then renewal keeps the key. "`expiredAt` moved" is measured against the date P1 printed: the call before the renewal is refused and gives no date. Until it runs, the renewal row stays UNPROBED(P17), with the copy of O26 |

Everything in research "STILL NEEDS THE KEY". Items 7 and 8 are docs only (O75; was: P8 and P9 on testnet); the order and yield parts of item 12 are under Backlog,
because only the deferred stages need them:

| # | Item | Part |
|---|---|---|
| 1 | Permission and read-only per endpoint | P11, MEASURED 2026-11-04: reach, and 10005 on UNIFIED for the narrow key |
| 2 | Real balance bodies; `equity` vs `walletBalance`; `locked` | Empty bodies MEASURED (P2). A coin row: docs only (O75). `locked`: ruled (O76) |
| 3 | Earn in UNIFIED or FUND; a redeemed FlexibleSaving row (O31) | Not read (O75) |
| 4 | Wallet receiving a deposit | Docs only: no page names it (rule 45) |
| 5 | Retention, by a refusal only (O20); `createdTime`, `successAt` units | P12 MEASURED: no refusal. Units docs only (section 3) |
| 6 | The real transfer path | MEASURED 2026-11-04: `query-inter-transfer-list` 0, `inter-transfer-list-query` HTTP 404 |
| 9 | `deadlineDay`, `expiredAt`, permissions object | P1, MEASURED 2026-11-04; an IP-bound key stays UNVERIFIED |
| 10 | Error after expiry; wrong-host key | P17; wrong-host stays UNVERIFIED, no EU key exists, and no key goes to a second domain |
| 11 | P2P `simplifyList` for a non-advertiser | Closed, no call: the route is a POST, and the probe is GET only (section 10) and C2 (O49). P14 stays NOT RUN |
| 12 | Earn position shape and limits, limit headers | Not read (O75); P16 MEASURED |
| 13 | Maximum recv window | P15 MEASURED: 60000 accepted, the largest tried |
| 14 | HTTP status for every call | P16 MEASURED for the routes; refusal codes docs only (section 4) |
| 15 | API terms and brand | Done 2026-11-03: the API Terms PDF by curl, the Global and EU Terms in the browser, the brand clause is Global 40.4(e) (section 9). C7's re-read stays |

Parts, what each must print and which code it unlocks. "Unlocks" below is the old gate: only P1, P2 and P3 still hold one (O62), and
P4 to P7, P13 with rows and P18 with rows run only at the later real-money run:

| Part | Prints | Unlocks |
|---|---|---|
| P1 | query-api names, types, `readOnly`, `expiredAt` shape, UTC date and days left, the value of `deadlineDay` (a day count, not a shape), `uta`, `isMaster` as booleans, `type` (1 or 2; any other value prints only its JSON type), "parentUid is zero" (true or false, never the id), the group and box names inside `permissions` (by a shape test, not a closed list; see the list above) | Set 3 client, set 4 expiry, set 7 connect refusals (O13) |
| P2 | Wallet bodies per coin: names, types, zero listed or not, `walletBalance` zero or non-zero per wallet (O52), `walletBalance` vs `equity` equal or not, `locked`, `spotBorrow`, `borrowAmount`, `bonus` non-zero or not. In R3 only: `walletBalance` and `locked` per coin before and after the cancel of K3, as equal or changed (O50). Result 2026-11-05: 0 coin rows, so these rows stay docs only | Set 3 balances |
| P3 | Two readings around the user's Earn step; never an amount. Per coin: `unified`, `fund`, `flexible` and `onchain` as equal or changed (up or down); wallet (unified + fund) and position (flexible + onchain), each as equal, changed (up) or changed (down), with one fixed sentence for each of the nine pairs of those words, and a tenth sentence, "no comparison", when a reading cannot be compared. Four of the nine sentences (position fell and wallet equal, both fell, wallet fell and position equal, wallet rose and position equal) also say that the comparison cannot be repeated by a new run. Direction says where the coins went, not how many, so on a position rise the stake check prints: wallet fall equals position rise, and wallet fall equals flexible rise, each yes or no, never an amount (O54). When `flexible` falls, the redeem check: wallet rise equals the position fall, and wallet rise equals the fall + `claimableYield`, each yes or no. Per row, after K11 too (rule 46, O31): `status`, and `amount`, `claimableYield` and `totalPnl` as zero or non-zero; `nextPageCursor`. A `status` prints as absent, empty, `Processing` or `Active`, and any other word prints `<other>` (O46): the research lists `Processing` and `Active` for OnChain only, so a FlexibleSaving row can print `<other>`, and that is a result to read. A plain `R4` prints one reading only (O50). Result 2026-11-05: 0 rows, one reading | Nothing: Earn is not read (O75) |
| P4, P5, P6, P7 | Row names and types, `nextPageCursor` as absent, empty or present with its mask, status words from a closed list per series (`<other>` outside it), unit class of times, id present, amount and fee as zero or non-zero, fee smaller than amount. P4 and P6 also use two balance readings around the user's step (O47): per coin, FUND and UNIFIED as equal or changed; per row and per wallet, change equals amount, and change equals amount + fee, each yes or no, with the sign ignored. A deposit (P4) also prints change equals amount - fee, because a deposit can be credited net of its fee; the withdrawal series (P6) does not print it. P4 reads the rows before the prompt (the pending row, rule 47) and again after it, and the second read is the one compared; P6 reads them after the prompt. P4 and P6 row lines print that row's wallet-hint words, so that a value in the tally can be matched with one row. The K6 prompt asks for two different amounts when both wallets are used. A skip at the prompt prints no comparison. P5 and P7 print no balance drop: P5 is optional, and P7 rows name both wallets. P7 tries both transfer paths. P4 and P6 also print `depositType` values and any field that could tell the wallet, against the wallet that moved (rule 45). P4 with K1 pending prints whether the time is empty, 0, absent or present (rule 47) | Sets 5, 6 |
| P8 (new, O64) | One read of the log for the last 7 days on the chosen host, at most 3 pages. Per row: names and types; `type`, `category`, `side` from closed lists, `<other>` outside them; `currency` by the coin shape test; `qty` sign; `change + fee = qty` yes or no, `change = cashFlow + funding - fee` yes or no; time unit class; `id` present and whether it repeats among rows; rows that share an `orderId`, as a count; whether the two coins of one order share a `tradeId`; spot rows with an empty `tradeId`, as a count (PLANNER CALL 64). No id, no amount | Nothing waits. A shape that differs edits section 3 and set 9 |
| P9 (new, O64) | Convert history, at most 3 calls: page 1, page 2 and one read at `index` 9999, which prints "empty", "same as the page before", "other rows" or the `retCode` (PLANNER CALL 67; was: at most 2 pages). Per row: `accountType` and `exchangeStatus` from closed lists, `<other>` outside them; `fromCoin`, `toCoin` by the coin shape test; largest decimal count of each amount; time unit class; order of `createdAt` on the page as newest first or not. Then, against the same run's P8 rows: whether a log row of the same time window has a word of `CURRENCY_BUY`, `CURRENCY_SELL`, `CONVERT` or `TRADE`, yes or no per word. No `userId`, no `extInfo`. As built (developer's report, 2026-11-04): "the same time window" means P8's 7 days, with no time or coin match, and "same as the page before" compares keys | Nothing waits. A shape that differs edits section 3 and set 9 |
| P19 (new, O65) | At most 3 calls: the last 7 days, the next page, and a window 729 days back. Per row: names and types; `ioDirection` from a closed list; `currency` by the coin shape test; `showBusiType` and `description` by a shape test only, `fundingAccountRecord` and letters, otherwise `<other>` (O46; an accepted residual of the O51 kind, because a closed list would hide what this part exists to find; no free server text prints); `descriptionEn`, `showBusiTypeEn`, `memberId`, `afterAmt` never; `currcCursor` present, and whether it repeats; time unit class; largest decimal count of `txnAmt`; `nextPageCursor` mask, and whether a page past the end is empty or repeated; the sign class of `txnAmt` per `ioDirection`, as positive, negative or zero (F9). Then against the same run's P7 and P9 rows, per source row: a ledger row of its coin and direction with an equal amount, its sign dropped, yes or no, and its delay as under a minute, under an hour, under a day, or more. No id, no amount. As built (developer's report, 2026-11-04): it compares FUND converts and window 1 only, and a page past the end is seen only when page 1 gives a cursor | Nothing waits, except `EARN_PRINCIPAL_WORDS` for an Earn clause that ships. A shape that differs edits section 3 and set 10 |
| P11 | One call per endpoint: `retCode` | Sets 3, 5 |
| P12 | Rows and `retCode` for a window starting 2 years back, and 18, 12, 6 months, per series. Only a refusal moves a floor; an empty 0 keeps 729 days (O20) | Set 5 floors |
| P13 | Per series: window edges (transfer 7 d, 7 d + 1 s; the others 29 d, 30 d), an end-exclusive and a start-exclusive test on the newest row, each with a control call one second past that time (`endTime` + 1 s, `startTime` - 1 s), `limit=1` page order, cursor shape (the mask of page 1), a full last page, a repeated cursor. On the withdrawal series only, the filter field: the time field, `createTime` or `updateTime`, that `startTime` and `endTime` filter on, by a window that ends and a window that starts between the two times of one row (O48). No coin filter: no Stage B row sends `coin`. A series with no row prints only its edges, so `R2 P13` runs once more after K6 settles | Sets 5, 6 |
| P14 | NOT RUN, no call. Closed by the GET-only rule of this section and by C2, not a pending probe (O49): the only P2P order-list route is a POST. P1's box names, `FiatP2P` among them, are the only P2P fact the script reads | Nothing. The O5 text rests on the docs line: QUOTE "The P2P API is only accessible by General Advertisers or above" (research, section H) |
| P15 | `retCode` for recv window 5000, 20000, 60000 | Set 3 |
| P16 | HTTP status, `X-Bapi-Limit`, `-Status`, `-Reset-Timestamp` per route | Sets 3, 5 interval |
| P17 | Section 6.3 | Refusal table |
| P18 | Largest decimal count per coin per row kind | Rule 12 |

A public-only part ran on 2026-11-03 with no key: `market/time`, `query-api` with no key (10001, HTTP 200),
`instruments-info`, and the TLS chain.

If a probe fails its row: a shape that differs edits this spec and the plan first. A kind that cannot pass
stays unread, and the UI text says so. A row keeps its UNPROBED mark until its own probe runs (O35): P17 rows until R7. P2 and P3 rows left that mark with O75: docs only, or not read. A row that rests on the pages is "docs only" and has no such wait (O62).

## 11. Tests

Per kiko-testing: RED first on the parent, real SQLite for a write path, a sweep seed list for a property,
no history note in a test title. Fixtures hold probe shapes or, for a docs-only row, the page's sample shape, never real values. Files are new unless marked;
bare names live in `src/crypto-sync/bybit/`. A row here is the acceptance floor; the developer adds.

### Acceptance rows

| # | Input | Test |
|---|---|---|
| A1 | UNIFIED read fails | `bybit.provider.test.ts`: "a failed UNIFIED read fails the sync and writes no holding" |
| A2 | FUND read fails | same, "a failed FUND read leaves each FUND holding at its last balance" |
| A3 | NOT BUILT (O75; was: one Earn category fails) | same, "one failed Earn category skips the whole Earn wallet" |
| A4 | NOT BUILT (O75; was: Earn body with a `nextPageCursor`) | same, "a paged Earn answer fails the wallet read instead of counting part of it" |
| A5 | Coin with `spotBorrow` non-zero | same, "a coin with a borrow keeps its last balance and lists itself" |
| A6 | Empty UNIFIED, held coin absent | same, "a good read that omits a held coin writes that holding at zero" |
| A7 | Dust, no holding | same, "a coin below its dust threshold creates no holding" |
| A8 | SCR, MNT, UAH tickers | `bybit.tracked-coin.test.ts`: "SCR, MNT and UAH are not tracked as fiat" |
| A9 | `retCode` 10006 with HTTP 200 | `bybit.client.test.ts`: "a rate refusal in the body sets the cooldown from the reset header" |
| A10 | HTTP 403 | same, "a 403 sets a ten minute cooldown and shows the text that fits both reasons"; the text lands with the texts of plan set 4 step 2/4 |
| A11 | Cooldown active | `bybit.provider.test.ts`: "a cooling account makes no call and returns no balances" (the stamped case); an account with no stamped Bybit holding throws the refusal text (O81, O83) |
| A12 | `readOnly` 0 at connect | `src/design-system/components/bybit-credentials-field/bybit-credentials-field.component.test.tsx`: "a read-write key is refused before any Keychain write" |
| A13 | `10003` at connect (O39 C1) | same, "a rejected key shows the text that names a wrong key, Bybit EU as not supported, and another regional key as may not" |
| A14 | `far`, `near`, `expired`, `unknown` | `bybit.key-expiry.test.ts`: "reads each expiry state from the stored date" |
| A15 | 33004, -2015, unknown after `expiredAt` | `bybit.client.test.ts`: "every refusal past the stored date is the expired class" |
| A16 | Renewal: new `expiredAt`, same pair | `bybit.provider.test.ts`: "a renewed key moves the stored date and writes no Keychain item" |
| A17 | Deposit statuses and `depositType` (PLANNER CALL 118; was: type 50 owed) | `bybit.capital-history.test.ts`: "imports only statuses 3 and 70012 with type 0, owes pending, unknown and types 10, 20, 7 and absent, ignores 4"; "ignores a type 50 deposit whatever its status, with a time or none, and owes nothing for it" |
| A18 | 70011 on an imported deposit, with and with no time | same, "a rolled back deposit removes its row and moves no balance, with or with no time" |
| A19 | `BlockchainConfirmed` | same, "a confirmed withdrawal stays owed until success" |
| A20 | Pages in any order | same, "a span commits the same rows whatever the page order" |
| A21 | Row with too many decimals | same, "an over-precise amount owes its point and its neighbours import" |
| A22 | Record in the start second | same, "a record in the second the span starts in owes only its point" |
| A23 | Transfer both legs | `bybit.transfer-history.test.ts`: "a transfer writes two legs that share one pair id" |
| A24 | Unknown wallet word | same, "an unknown wallet owes its point and holds no cursor" |
| A25 | Point past the floor | same, "the rolling floor drops owed ground it passes" |
| A26 | Disconnect, reconnect | `bybit.run-arm.real-sqlite.test.ts`: "a disconnect resets the walks and the stored key date and keeps holding keys" |
| A27 | Empty-plan guard, clock back | `bybit.capital-history.test.ts`: "owed ground is read when forward and re-scan are empty" |
| A28 | Same-account switch | `src/screens/account-detail/crypto-sync-section/conflicting-exchange-holdings.test.ts`: "refuses a pick that conflicts with a stored holding" |
| A29 | Older build file | `src/data-transfer/secrets/restore-secrets.test.ts` (edit): "restores a Bybit pair to its own account" |
| A30 | Sentinel email in `address` | `bybit.capital-history.test.ts`: "a counterparty field reaches no row, mark or log" |
| A31 | query-api sentinel `userID` | `bybit.provider.test.ts`: "no identity field of the key reaches the state" |
| A32 | 10005 on each shipped route at connect, and the count per kind set (O13, PLANNER CALL 25, F8) | `bybit-credentials-field.component.test.tsx`: "a key refused on any shipped route is refused before any Keychain write, and connect makes 10 calls" (O75; was: 10, 11 or 12 by the kind set) |
| A33 | `isMaster` false or absent (O13) | same, "a key not shown as a main key is refused before any Keychain write" |
| A34 | 10005 on FUND on a later sync (O13) | `bybit.provider.test.ts`: "a refused wallet keeps its last balance and records its name for the visible line"; `crypto-sync-section` test: "the refused wallet line names the wallet" |
| A35 | Deposit with no time, empty, 0 or absent, a fixture per form; status 0, status 3 with type 0, type 20 (type 50 owes nothing: A17, PLANNER CALL 118); read again over 29 days later under a window on creation time; status 70011 with no time on a read record whose row exists (rule 14, N9) (PLANNER CALL 37, O63 (b); was: owes nothing, CALL 28) | `bybit.capital-history.walk.test.ts`: "a deposit with no time makes no row, owes its span in the deposit series only, moves the other series and gives no page drift, and imports once a later read shows its time, and a 70011 with no time still removes its row" |
| A36 | NOT BUILT (O75; was: Earn row with a status outside the allowlist, O18) | `bybit.provider.test.ts`: "an Earn position outside the status allowlist adds nothing and counts in the left-out line" |
| A37 | NOT BUILT (O75; was: redeemed FlexibleSaving row, O18) | same, "a redeemed FlexibleSaving row never adds" |
| A38 | An app fiat code outside the five, with a balance (O19) | `bybit.tracked-coin.test.ts`: "a fiat code outside the list lists as not tracked with no amount" |
| A39 | Rule 45 (O14, O62) | `bybit.capital-history.test.ts`, real SQLite: "every deposit and withdrawal row goes on the FUND holding and moves no balance" |
| A40 | Each shipped kind set (O15) | `bybit.shipped-copy.test.ts`: "each surface names each shipped kind and each unread kind, in en and uk". Its table has one row per kind set of section 8, picked by a literal in the test, not by an app flag |
| A41 | P12 refusal and empty 0 (O20) | `bybit.capital-history.walk.test.ts`: "the floor is 729 days back, and the forward windows start there with no cursor" |
| A42 | Every `balanceProviderIds` member (O17, O30) | `exchange-history-gate.test.ts`, beside `binance-history-status.ts`: "every balance provider has a gate decision" |
| A43 | Every `balanceProviderIds` member, set 7 (O21) | `exchange-catalog.test.ts` (edit): "every balance provider has a catalog entry and a registry entry" |
| A44 | Policy intro, counterparty text with the Bybit user ID, the kept ids, a refused convert's too, and the stored set's fee and tax (O24, F12, O64, N7, C1) | `bybit.privacy-policy.test.ts`: "the section 3 intro names Bybit, the counterparty text names the Bybit user ID and says does not keep, and the kept ids name a refused convert and the kept Funding fields name fee and tax, in the four files" |
| A45 | Expiry text (O26) | `bybit.shipped-copy.test.ts`: "the ended and refused texts give both the renewal and the new-key route, in en and uk" |
| A46 | Coin with a borrow on a first connect (O27) | `bybit.provider.test.ts`: "a borrowed coin on a first connect creates no holding and lists itself"; `bybit.shipped-copy.test.ts`: "the borrowed line does not say a last balance exists" |
| A47 | NOT BUILT (O75; was: Earn row with no `status`, `amount` non-zero, O31) | `bybit.provider.test.ts`: "an Earn row with no status adds its amount" |
| A48 | FUND fails while UNIFIED reads, each with stored notes (O33) | `bybit.provider.test.ts`: "a wallet that read replaces its notes and a wallet that failed keeps them" |
| A49 | Each provider's calls to the caption helpers (O30) | `binance-history-status.test.ts` (edit): "Binance compares its 8 walks and Bybit compares only its own" |
| A50 | The hosts of the code and the md, set 7 (O29) | Plan set 7 step 4/6, by hand: each line of `npm run privacy:site -- hosts` is named in both md files |
| A51 | The EU copy, four surfaces (C1) | `bybit.shipped-copy.test.ts`: "connect, rejected key, footer and help each say Kiko does not support Bybit EU accounts and keep may not for other regional sites, in en and uk" |
| A52 | The host of a key (C1, PLANNER CALL 34) | `bybit.endpoints.test.ts`: "the one signed host is api.bybit.com, and no tracked env file, plist entry or source module names api.bybit.eu or api-testnet" |
| A53 | The closed list of routes (C2) | `bybit.endpoints.test.ts`: "the signed paths equal the literal list of reads, and the client sends only GET"; a step that adds a route adds its literal |
| A54 | The API management URL (C3) | `bybit-credentials-field.component.test.tsx`: "the API management link is the exact URL of part 2, with no query string" |
| A55 | The not-affiliated caption (C4) | `exchange-type-field.component.test.tsx` (edit): "the not-affiliated caption shows with Bybit in the sheet, and its en and uk text says so" |
| A56 | The Bybit key writer (C5) | `bybit.credentials.test.ts`: "the pair is written through hardenedFor at WHEN_UNLOCKED_THIS_DEVICE_ONLY" |
| A57 | A withdrawal pending at the first read, `createTime` and `updateTime` in different windows, under a fake route for each window field (PLANNER CALL 29) | `bybit.convergence.test.ts`, real `planWalkPasses`, `runWalkPlan`: "a withdrawal that settles later imports once and leaves no point, whichever time the window filters on" |
| A58 | An empty account, no coin row (PLANNER CALL 34) | `bybit.provider.test.ts`: "an empty read writes no holding and stamps the sync time, so Last sync shows" |
| A59 | Bybit holding footer (PLANNER CALL 27) | `exchange-history-footer.component.test.tsx` (edit): "a Bybit holding shows no earlier history line; a Binance holding keeps it" |
| A60 | Row times of 13, 10 and other digit counts (O62, F6, F10) | `bybit.capital-history.test.ts`: "13 digits read as ms, 10 as the whole second, and any other time owes its span in its own series while the others go on" |
| A61 | A deposit whose `successAt` is past the span end, under a window on its creation time (PLANNER CALL 29) | `bybit.capital-history.test.ts`: "a settled row past the span end imports and is no page drift" |
| A62 | 131203 (R1) | `bybit.client.test.ts`: "a window refusal at HTTP 200 stops the walk as a code fault"; the walk stop lands with plan set 5 step 4/4, the first step that adds a Bybit walk (the capital walk) |
| A63 | The closed list (O64, PLANNER CALL 41) | `bybit.log-types.test.ts`: "each of the 68 words maps to one kind, and any other word goes to other and is never parsed" |
| A64 | A spot buy and sell: base and quote rows, fee in each, from a fixture built on the page's fields (rule 49) | `bybit.log-history.test.ts`: "a spot row writes one leg of change with the fee inside, marked out of spending, and pairs by order" |
| A65 | The same trade as three fills and as one row per order | same, "the sum per coin is the same under one row per fill and one row per order" |
| A66 | `change + fee` is not `qty`, including a linear-shaped row with `category` spot (PLANNER CALL 40) | same, "a row whose change and fee do not add to its qty imports nothing and owes its point" |
| A67 | The page's repeated `id`, a same key with another `change` (PLANNER CALL 38) | same, "the page's repeated id keeps two rows apart, and one key with two values owes both" |
| A68 | A sold-out coin, real SQLite | `bybit.log-history.real-sqlite.test.ts`: "a coin with no holding gets one at zero, and its past is on the line" |
| A69 | A leg against an untracked coin; both untracked; a third coin in `currency` | `bybit.log-history.test.ts`: "a leg against an untracked coin carries the asset marker and lists the coin, and a row with a third coin owes its point" |
| A70 | `TRADE` on linear, option, inverse, event; `STOCK_TRADE_BUY`; a word off the page | same, "a trade outside spot writes no row and names its kind in the state" |
| A71 | `TRANSFER_IN`, `CURRENCY_BUY`, `CURRENCY_SELL`, `CONVERT` | same, "an entry of the transfer or convert list never imports from the log" |
| A72 | Convert legs on each wallet word | `bybit.convert-history.test.ts`: "a convert writes two legs under one pair that names both coins, on the wallet of its word" |
| A73 | The page's sample amount `1.773938248611074` (PLANNER CALL 42) | same, "the page's 15-decimal amount rounds and imports" |
| A74 | `success`, `failure`, `init`, `processing`, another word | same, "imports success, ignores failure, and owes init, processing and any other word" |
| A75 | Pages to an empty page, a cap hit, a repeated page, a page past the end in each form, a list that wraps (PLANNER CALLS 48, 67; was: a repeated page moved no mark) | same, "reads by index to an empty page, resumes at the stored index, and an empty page, a repeated page, an unknown refusal past page 1 and the page limit each end the pass and move the cursor" |
| A76 | One convert in Unified, in both the log and the history, real SQLite (rule 50) | `bybit.log-history.real-sqlite.test.ts`: "a convert listed in both the log and the history writes one pair" |
| A77 | The worked example, with and with no fee, through `buildNetWorthSeries` | `bybit.past-line.real-sqlite.test.ts`: "the past of the worked example equals the truth in each stretch" |
| A78 | Statistics, Bybit in and out of the filter scope, Binance only (PLANNER CALL 45) | `src/screens/statistics/statistics.screen.cards.test.tsx` (edit): "the net worth card shows the Bybit limits line only with a Bybit account in scope" |
| A79 | A Binance state after the new walk id (O7, O64) | `src/crypto-sync/exchange/walk-state/walk-state.test.ts` (edit): "a state with no log entry keeps its stored text" |
| A80 | Sentinels `userId`, `orderLinkId`, `tradeId`, `paramValue` | `bybit.log-history.test.ts`, `bybit.convert-history.test.ts`: "a sentinel field reaches no row, mark or log" |
| A81 | Rounding use (PLANNER CALL 42) | `src/crypto-sync/exchange/amounts/amounts.test.ts` (edit): "rounded-row rounds any coin, and row and trade-row stay as they were" |
| A82 | A withdrawal's day on the line (F10) | `bybit.capital-history.test.ts`: "a withdrawal row's time is its createTime, before and after it settles" |
| A83 | The leftovers on each surface, each gap of N8, the Earn stake, the double count, the burst line and the coin not read (O64, O66, O85, clauses L1 and L1S, F4, F6, F7) | `bybit.shipped-copy.test.ts`: "kinds and help name trades and converts as read, and kinds and the Statistics line state what the past cannot hold with Earn stakes, loans, stocks, card spending and sub-account moves and that a move can rarely count twice, the Statistics line says that a coin not read holds its last read balance, the footer names what is not listed, and the dense line makes no promise, in en and uk". Was: no coin not read |
| A84 | Every row of the matrix, M1 to M35 (O65, O66, O68, rule 51) | `bybit.funding-match.test.ts`: "gives each ledger row of the matrix its verdict" |
| A85 | The ledger's fields against the page's sample, and `memberId` as a sentinel, with `afterAmt`, `descriptionEn`, `showBusiTypeEn` | `bybit.funding-ledger.test.ts`: "reads the named fields of the page's row and a sentinel reaches no row, mark or log" |
| A86 | Rows with no `currcCursor`, a bad `ioDirection`, a bad, negative or zero `txnAmt`, a bad time; a repeated cursor with and with no new key (PLANNER CALL 60, F9) | same, "a row with no id owes nothing and marks the line, bad rows and a signed or zero amount owe one tagged range, and a repeated cursor ends the span unless the page holds a new key" |
| A87 | Each case of "Arrival order", real SQLite (O65, F2, F11) | `bybit.funding-ledger.real-sqlite.test.ts`: "each arrival case gives its verdict, a source that lands late removes the listed row, a waiting verdict keeps a listed row with its note and category, and a new row within a day waits with no caption" |
| A88 | A disconnect, a reconnect, a key with no stored row, and a `.kiko` round trip | same, "a reconnect and a restore remove no listed row, and a disconnect clears the stored set" |
| A89 | The two doubles the rule names, M16 and M23, by number (O65) | `bybit.past-line.funding.real-sqlite.test.ts`: "a ledger row past the window and a stake under an unseen word each double by the amount shown" |
| A90 | The lost rows M12 and M15, by number | same, "a false match and a held row each read as with no ledger" |
| A91 | The worked example with the ledger on: paired, and with no pair (O65) | same, "the past of the worked example equals the truth with the ledger on, paired or held" |
| A92 | A ledger row of an unknown word, as a P2P credit, on the row shape only; a rollback's Out past the re-scan | same, "a credit of an unknown word lists and closes its offset, and a late rollback's Out cancels the stale row" |
| A93 | Out and In rows and each exclusion (PLANNER CALL 56) | `bybit.funding-ledger.real-sqlite.test.ts`: "a listed row stays out of spending and of the transfer, funding and loan matchers" |
| A94 | The label in en and uk, and no server text (PLANNER CALL 56) | `src/transactions/row-description/row-description.test.ts` (edit): "a ledger marker renders its fixed label and no server text" |
| A95 | The lines of the counts | The section test beside `crypto-sync-section.component.tsx` (edit): "the held count and the no-id line read persisted state" |
| A96 | The new table, in set 2 (PLANNER CALLS 51, 72, 75) | `src/db/schema.funding-match.test.ts`: "the table has its final columns, starts empty, and the read and the prune of one account's rows use the primary key by EXPLAIN QUERY PLAN" |
| A97 | Stage F in copy (O65, F3, L1; was: also the Statistics line, which L1S leaves short) | `bybit.shipped-copy.test.ts`: "kinds, footer and help state the Funding record, what it leaves out and that it is no spending, in en and uk" |
| A98 | The split, per series, and the plain hint (O66 (a), O68 (a), PLANNER CALL 63) | `src/crypto-sync/bybit/bybit.cursor-span.test.ts`: "log splits to a second and capital to a day, no run narrows a hint before its first page, and a forward or re-scan resume becomes a plain hint that skips no ground" |
| A99 | The `tradeId` guard in each world of section 3 (O66 (b), PLANNER CALL 64) | `bybit.log-history.test.ts`: "a spot row with an empty tradeId writes nothing and owes one range, a summary row with an empty one does not double, and a summary row with one is the named double" |
| A100 | A failed spot shape on the busy seed (N3, PLANNER CALL 65) | same, "every spot row of 5,000 failing leaves at most 12 ranges and no point, and a same-key conflict keeps its points" |
| A101 | The convert `cursor` null for good (N5, PLANNER CALL 68) | `bybit.funding-ledger.real-sqlite.test.ts`: "a row under seven days waits, an older row lists, and a convert that lands later removes it at that reconcile" |
| A102 | The review's scenario, and each cut (N4, PLANNER CALL 66) | `bybit.convert-history.test.ts`: "an init on page 3 stays owed with its first time through an empty last page, in a pass over two runs, at any cut, and leaves only at the end of a pass that reads it settled" |
| A103 | Over 12 owed points in one pass (N3, N4, PLANNER CALL 66) | same, "over twelve points in a pass become one range with the earliest time" |
| A104 | A log leg that rounds to 0 (N6) | `bybit.log-history.test.ts`: "a log leg that rounds to zero writes no row and leaves the other leg, and a convert leg that rounds to zero writes neither" |
| A105 | The pairing by number, M29, M31 and M32 (F1, PLANNER CALL 70) | `bybit.past-line.funding.real-sqlite.test.ts`: "two equal sources days apart read the truth, a fee form moves by repair, and a credit that takes a source shows its row late with a true opening" |
| A106 | The mark and its line (F4, PLANNER CALL 73) | The walk's part in `bybit.log-history.test.ts`: "a span at the floor that a full lane cannot finish writes one mark, a budget stop after an earlier read writes none, and the commit past it drops the mark"; the line in the section test beside `crypto-sync-section.component.tsx` (edit): "the dense line replaces the pending caption while the mark stands" |
| A107 | A second reconcile and the prune (F8, PLANNER CALL 71) | `bybit.funding-ledger.real-sqlite.test.ts`: "a second reconcile with no new record writes no row and no mark, and the prune removes only rows past the floor by two windows and leaves their listed rows" |
| A108 | `locked` above zero (O76) | `bybit.balance-read.test.ts`: "a tracked Unified coin with locked above zero is set aside as an open order" |
| A109 | `locked` not decimal text (O76) | same, "a tracked Unified coin is set aside for a locked of %s", the seven forms of matrix row 3 |
| A110 | The outcome order (PLANNER CALL 78) | same, "one coin has one outcome by its loan, balance and locked", every row of the matrix in section 3 |
| A111 | The docs' sample row, byte for byte in `borrowAmount`, `spotBorrow`, `walletBalance`, `locked` (O73, PLANNER CALL 84) | `bybit.client.reads.test.ts`: "the page's sample row reads as a held coin with no loan and no open order" |
| A112 | FUND and `locked` (PLANNER CALL 77) | same, "a FUND row drops any locked field, so it is never set aside" |
| A113 | An untracked coin and `locked` (PLANNER CALL 77) | `bybit.balance-read.test.ts`: "does not read the locked field of a coin the app does not track" |
| A114 | The holding and the clear (O76) | `bybit.provider.test.ts`: "a coin with an open order keeps its last balance and lists itself", "a coin with an open order on a first sync creates no holding and lists itself"; `bybit.provider.state.test.ts`: "the first good read after the order closes writes the balance and clears the mark", "a coin no longer listed after the order closes is written at zero and clears the mark" |
| A115 | The line (O76) | `crypto-sync-section.component.bybit.test.tsx`: "lists each coin with an open order once", en and uk; "shows the borrowed line alone for a coin with a loan and locked" through A110 |
| A116 | An older build (PLANNER CALL 80) | `walk-state.balance-notes.test.ts`: "reads a wallet entry with a key this build never names as one without it, with nothing unreadable"; `exchange-state-patch.balance-notes.test.ts`, "a build that does not name a key": "keeps a note key this build never names through another patch" |
| A117 | The refusal text (PLANNER CALL 81) | `bybit.provider.state.test.ts`: "a refused coin goes to the notes and writes no oversized list"; `crypto-sync-section.component.bybit.test.tsx`: "a coin refused for an empty loan field shows the read text, never the oversized text"; a Binance pin of `oversizedAmount` stays green unchanged |
| A118 | No empty look (PLANNER CALL 82) | `account-detail.screen` suite: "a Bybit account with no holding and a refused coin shows the not-read block, never No holdings yet", one row per note kind, a FUND refusal too; "an empty Bybit account with no note keeps No holdings yet"; "a Binance account with no holding keeps No holdings yet" |
| A119 | Code 10024 (PLANNER CALL 83) | `bybit.client.test.ts`: the code rows; "keeps code 10024 as the compliance class after the stored date"; `bybit.failure-text.test.ts`: its row; `bybit.shipped-copy.test.ts`: "the 10024 text states the code, in en and uk, and offers no other step" |
| A120 | A walk's row on a set-aside coin (PLANNER CALL 79) | `bybit.transfer-history` suite, real SQLite: "a Unified leg of a set-aside coin creates its holding at zero, the next read leaves it at zero with the line, and the first good read writes it" |
| A121 | Binance and the other sources do not move (O78). Green on today's code, before the fix | `holding-value-at.test.ts`: "a Binance holding counts every row against its balance, with a row after its stamp", "a Binance holding at zero with no stamp opens below zero by its earlier buy", "a holding of any other source counts every row, whatever its metadata" |
| A122 | The mark (PLANNER CALL 86) | `sync.test.ts`: "a provider whose key is on the dated list writes the read time beside the stamp", "a provider that does not writes the stamp alone", "a coin the read leaves out of a dated provider keeps its read time while the coin it writes takes the new one"; `bybit.provider.test.ts`: "has its key on the dated list, and the wallet and Binance keys are not on it"; `holding-metadata.test.ts`: "is true for a key on the dated list", and "is false for %s, which is not on the list" for `datesBalanceOf` (O87; was: the optional field `datesBalance` decided) |
| A123 | The valuer, the rows of "Option D by order of arrival" that it can hold alone (PLANNER CALLS 86, 87) | `holding-value-at.bybit.test.ts`: one row per number, 1, 4, 5, 6, 7, 9 and 12; "a row exactly at the read counts, and a row one millisecond after it does not"; "a row dated later on the read's local day does not count"; the read-count guard of `holding-value-at.test.ts` stays green unchanged, so a holding that is not Bybit's gets no extra pass |
| A124 | The wiring and the last point (PLANNER CALL 87) | `statistics.screen.test.tsx`: "hands each row's source to the net-worth line"; `net-worth-series.test.ts`: "ends on the net worth Home shows for a Bybit coin with a row after its read" |
| A125 | The whole path on real SQLite (O78) | `bybit.past-line.set-aside.real-sqlite.test.ts`: rows 2, 3, 8, 10, 11 and 13 through `runBalanceSync` and `addManyDedup`; `disconnect.real-sqlite.test.ts`: "a disconnect keeps the read time of a Bybit holding and drops its stamp" |
| A126 | The block reads the balance list (PLANNER CALL 88) | `account-detail.screen.test.tsx`: the table's four rows; `history-status.test.ts`: "the balance coins leave out the history list" |
| A127 | The create form shows the provider's refusal text on a failed first Connect (set 7 step 2). Binance's form has the same gap, and another track owns it | `account-form.screen.test.tsx` over the real Bybit provider: "a refusal of the first Connect shows the text of that refusal in the form, and not the generic text" |
| A128 | A restore keeps row ids and the mark (O88). Real `readDataSnapshot` and `restoreDataSnapshot`, on real SQLite, through JSON. Green on today's code | `restore-past-line-mark.test.ts`: "a restore keeps every row id and the holding's mark", "a file of an old version keeps them through every mirror" |
| A129 | The mark's write (O88, PLANNER CALL 92) | `holdings.repo.past-line-mark.test.ts`: "a read marks every row that is not a Bybit row, and no Bybit row", "a second read adds a row typed since the first and drops a row that is gone", "a read with no such row writes no key", "a new holding gets no key"; "%s makes no read of the rows and gets no new key", for Binance, wallet and Monobank; `holding-metadata.test.ts`: "does not carry the mark, so a read writes its own", "`overwrittenRowIdsOf` keeps only strings and reads anything else as empty" |
| A130 | The valuer (O88) | `holding-value-at.bybit.test.ts`: "row 15, a row on the mark does not count", "row 15, the other sign: a row of -0.5 on the mark does not count", "a row typed after the read counts, beside a row on the mark", "a row typed after the read counts even when it is dated before the read" (the world of Q-j's option A), the block "row 24, a mark that names no row of the line changes nothing" (its "with a mark that names %s" and "with a mark that names the typed row beside it, only that row goes"), "a row with no id counts, whatever the mark holds"; the read-count guard "reads each row twice and counts every row, with %s": `id` is counted with `source`, and it stays at 0 |
| A131 | The whole path on real SQLite, and the last point (O88) | `bybit.past-line.set-aside.real-sqlite.test.ts`: rows 15, 18, 19, 20, 21, 22 and 23 through `runBalanceSync`, `recordManual`, `recordExchange`, `updateWithBalanceDelta` and `disconnectCryptoAccount`; `src/data-transfer/snapshot/restore-past-line-mark.test.ts`, through `buildNetWorthSeries` from `@kiko/statistics/net-worth-series`: "a restored holding draws the same line"; `disconnect.real-sqlite.test.ts`: "a disconnect keeps the mark of a Bybit holding"; `net-worth-series.test.ts`: "ends on the net worth Home shows for a Bybit coin with a row on the mark"; `statistics.screen.test.tsx`: "hands each row's id and source to the net-worth line" |
| A132 | Rows 16, 17, 29 to 32 through the real read path (O89, PLANNER CALL 97). Was: rows 16 and 17 as they stood, each pinning the fault on purpose | `bybit.past-line.set-aside.real-sqlite.test.ts`: "row 16, deleting a row on the mark moves no balance" (was: "row 16, deleting a row on the mark takes its amount from the balance"), "row 17, editing a row on the mark moves no balance and keeps its id" (was: "row 17, editing a row on the mark moves the balance by the difference and keeps its id"), "a delete of a row not on the mark is right", "row 29, the id leaves the mark at the next read", "row 30, a row typed again moves the balance", "row 31, a deleted row that a read held leaves the read", "row 32, each row of a second disconnect follows its own mark" |
| A133 | Every path and shape on a row on the mark (O89): rows 25 to 28 | New `transactions.repo.past-line-mark.test.ts`, real SQLite: "a Convert's delete from %s moves the other holding and not the leg on the mark", "an edit of %s moves its own holding only", "a split's delete from the %s moves each holding by its own mark", "an edit of the %s moves its own holding only", "two legs on two marks move neither", "a leg on the mark that paid a deposit still takes the contribution out", "a holding delete takes a partner on the mark with no move", "a hand-set balance row moves no balance, and keeps balanceSetAt and balanceSetRowId", "an import row goes with no move and leaves its key", "an edit still runs its alongside write"; the account delete is in `accounts.repo.remove-cascade.test.ts`: "takes the partner with no move of the coin that the read overwrote" |
| A134 | The confirm says what the delete does (O89, PLANNER CALL 95) | `transactions.repo.past-line-mark.test.ts`: "`removePlan` names no change for a row on the mark", "`removePlan` names the other holding only", "`removeHoldingsPlan` names no change for a partner on the mark" (the `remove-notice.test.ts` title was cut at cb262751a: it repeated its neighbour) |
| A135 | No other holding changes (O89, PLANNER CALL 96; the coordinator's scope question), for Binance, Monobank, wallet, manual and bank with an import row | `transactions.repo.past-line-mark.test.ts`: "$label moves by a delete as today, with a mark in its metadata", "$label moves by an edit as today, with a mark in its metadata" (not the bank row: `update` refuses it), "$label makes the same statements on a delete", "$label makes the same statements on the confirm of a delete", "$label makes the same statements on an edit", each count measured on the parent; `holding-metadata.test.ts`, in the `isOverwrittenRow` block: "is true for a listed id on a dated holding", "is false for %s, which is not on the list", "is false for %s" (an id off the list, no list, a list it cannot read, a list of numbers, null metadata); A129's "%s makes no read of the rows and gets no new key"; `datesBalanceOf`'s existing "is false for %s, which is not on the list" |
| A136 | The whole money line stays on the invariant (O89) | Cut at cb262751a (a test of an identity, green with the Q-k gate removed). Replaced by the pins of rows 16, 17 and 25 to 32 in `bybit.past-line.set-aside.real-sqlite.test.ts`, and `net-worth-series.test.ts`: "ends on the net worth Home shows for a Bybit coin with a row on the mark" |
| A137 | Home's menu (O92, PLANNER CALL 107) | `transaction-row.component.test.tsx`: "offers no Duplicate on a manual row of a synced holding, and keeps the View actions and Delete"; `home.screen.test.tsx`: "%s: a manual row on a connected holding offers no Duplicate", "%s: the same row offers Duplicate after a disconnect", each of `bybitAsset`, `binanceAsset`, `monobankId`, `walletAddress`; "a manual row of a holding with no synced key, on a connected account, offers Duplicate" |
| A138 | The holding detail's menu (O92, PLANNER CALLS 107, 110) | `holding-detail.screen.test.tsx`: the same three titles; "a loan's linked payment reads its payer: no Duplicate on a connected payer", "Duplicate on a disconnected payer" |
| A139 | The gate (O92, PLANNER CALL 101), on real SQLite | New `transactions.repo.synced-holding-gate.test.ts`: "%s refuses a manual row while connected, and writes nothing" (`SYNCED_HOLDING_REFUSAL`, balance and row count unchanged), for each key; "%s takes the row after its real disconnect, and the balance moves", through `disconnectCryptoAccount` or `accountsRepo.disconnect` as the kind uses; "a holding with no synced key on a connected account takes the row, with no read of the account" (a statement count, by the spy of `holdings.repo.past-line-mark.test.ts`); "an Exchange leg and a split's return on a connected holding roll the whole write back" |
| A140 | What the user sees at a refused save (O92, PLANNER CALL 106) | `transaction-form.screen.test.tsx`: "a save the gate refuses names the synced holding and leaves the form open"; "any other failed save still says to try again"; `en.casing-by-role.test.ts` and the uk catalogue suite stay green |
| A141 | Help says what the menu does (O92, PLANNER CALL 106) | `help-topics.test.ts`: "the Duplicate sentence names the synced exception, in en and uk" |
| A142 | Row 34 on the real path (O92) | `bybit.past-line.set-aside.real-sqlite.test.ts`: "row 34, a manual row on the connected coin is refused, and Home and the line stay at the read", the other sign, and "with the coin set aside" |
| A143 | The owner value's write (O93, PLANNER CALL 103). A31 stays green as written | `bybit.provider.state.test.ts`: "a good key read writes the value made from the user id, and never the id", "a key read with no user id writes none and keeps the stored one", "a failed key read keeps the stored one"; `bybit.client.reads.test.ts`: re-pin, naming O93, for `userId` on `fetchKeyInfo` |
| A144 | The value outlives a disconnect (O93, PLANNER CALLS 103, 104) | the suite that pins `exchangeStateReset` (the developer greps it): "a reset keeps the owner value and the walks, and nothing else" (a re-pin of each "walks only" row, naming O93); `disconnect.real-sqlite.test.ts`: "a Bybit disconnect keeps the owner value"; `restore-past-line-mark.test.ts`: "a restore keeps the owner value in the state" |
| A145 | The refusal at connect (O93, PLANNER CALLS 104, 111) | `bybit-credentials-field.component.test.tsx`: "a key of another owner is refused before any Keychain write, after one call, with the text of that refusal"; "a key of the same owner passes, and connect makes 10 calls"; "no stored value passes"; "with no Bybit holding left, any key passes"; "a stored value and no user id in the answer is refused with the failed-request text"; "a key that is not a main key gets `bybitKeyNotMain` first" |
| A146 | Row 35 on the real path (O93) | New `bybit.other-account-key.real-sqlite.test.ts`: "the old account keeps X 1 and Y 2, and a new crypto account reads X 5 with line 0, 0, 5"; "a delete of the holdings, then a connect on this account, reads X 5 and writes the new owner value at the next good read" |
| A147 | The policy clause (O93), in the four files | `bybit.privacy-policy.test.ts`: "the policy names the value made from the user id, and says that a script can find the id, in en and uk" |
| A148 | What the user sees at a refused Convert (O94, PLANNER CALL 112) | `transaction-form.screen.test.tsx`: "a Convert refused for its picked holding says to select another, and leaves the form open"; "any other failed Convert still says to try again"; "a picked holding that connects drops from the picker, and Save still sends it". `transactions.repo.test.ts`: "throws when the counterpart holding is synced, writing nothing" (`SYNCED_HOLDING_REFUSAL`). `transactions.repo.synced-holding-gate.test.ts`: "%s: a Convert leg onto a connected holding gets the same refusal, and writes nothing"; "a Convert from a row on a connected holding still saves: one new row on the other holding, and the connected holding's balance stays" |
| A149 | The rule (O96, PLANNER CALL 113) | `deletable.test.ts`: "%s is not synced on an account connected to %s" (the 12 pairs of a key and another provider's id); "leaves out no holding with an earlier provider's key"; "a holding with two keys is synced when one is the current provider's"; "an institution that names no provider makes no holding synced" |
| A150 | The gate reads the rule (O96, PLANNER CALLS 113, 114), on real SQLite | `transactions.repo.synced-holding-gate.test.ts`: "%s takes a manual row while the account is connected to %s, and the balance moves"; "a Convert leg onto a holding with an earlier provider's key saves". A139's "a holding with no synced key on a connected account takes the row, with no read of the account" stays green unchanged |
| A151 | Home's menu, row 36 (O96) | `home.screen.test.tsx`: "a manual row on a holding with an earlier provider's key offers Duplicate" |
| A152 | The holding detail, row 36 (O96) | `holding-detail.screen.test.tsx`: "a manual row on a holding with an earlier provider's key offers Duplicate"; "keeps the footer add action for a holding with an earlier provider's key" |
| A153 | The pickers, row 36 (O96) | `transaction-form.screen.test.tsx`: "the primary picker offers a holding with an earlier provider's key" |
| A154 | No false note (O96, PLANNER CALL 116) | `exchange-history-footer.component.test.tsx`: "renders nothing for %s", with the new row "a wallet holding on a Binance account" |
| A155 | One key per provider (O96, PLANNER CALL 113) | `provider.test.ts` in `src/crypto-sync/provider/`: "names the key of each synced institution: %s" (an `it.each` of `balanceProviderIds`: each `BalanceProvider`'s `metadataField`), and "names the key that a Monobank sync writes" (`monobankId`) |
| A156 | A capital page that drifted in the forward pass (rule 22, PLANNER CALL 117; was: the cursor held) | `bybit.capital-history.walk.test.ts`: "owes only the series whose page drifted in the forward pass, and moves the cursor and the other series on" |

### Property suites

Through `sweep`, added to the `__tests__/property-sweep-sites.test.ts` list.

| # | Property | Test |
|---|---|---|
| Q1 | One currency per transfer pair id over random coins and shared ids; a trade or convert pair names exactly its two coins (was: every pair id one coin, which a trade cannot hold) | `bybit.keys.property.test.ts`: "no transfer pair id ever holds two coins, and a trade or convert pair names its two" |
| Q2 | Every external id and holding key carries the coin, BTC too (was: "ends in", which a holding key with its wallet last does not) | same, "every key carries its coin" |
| Q3 | Restart at any commit, only persisted state survives | `bybit.convergence.test.ts`: "a killed run converges to the rows of an uninterrupted one" |
| Q4 | Convergence under caps, seeds of section 5 | same, "reaches the floor within the table's runs" |
| Q5 | Halving: bursts | same, "a burst commits at least one span per run after its halvings" |
| Q6 | Idempotent re-read | same, "reading every window twice adds no row" |
| Q7 | No marks: `multiCoinSince`, `multiCoinSeen` | same, "a Bybit walk writes no multi-coin mark" |
| Q8 | Random fills of one trade under fill and order forms, any page order, read twice; a summary row with an empty `tradeId` added at random | `bybit.log-history.property.test.ts`: "the sum per coin holds under any form and any read order, and an empty tradeId row never adds" |
| Q9 | Convergence of log and convert under caps, seeds of section 5 with the N1 rows, a burst seed that stops with its mark, and a seed of failed spot shapes with its bound on `pending`, cut at every commit | `bybit.convergence.test.ts`: "log and convert reach the end within the table's runs, a burst stops only with its mark, keep pending inside its bound and survive a restart" |
| Q10 | Clean worlds: seeded true moves, each a source with no fee and its own ledger row at a delay of at most W, equal amounts allowed, or a ledger row with no source and no equal amount within W of any source; every arrival order, cut at every commit, read twice, and judged after the last run (O65; was: no delay bound, so M16 and M29 failed it) | `bybit.funding-ledger.property.test.ts`: "over any arrival order, the past line of a clean world equals the truth after the last run, with no double count and no lost row" |
| Q11 | Any world with sources with no ledger row, rows with no source, equal amounts and fees, with each own row at a delay of at most W and under a form. Excluded by name: a delay past W (M16), a word on no list (M23, M35), a Funding move to a read wallet that the transfer list lacks (section 3), a form no page states, and a late source before the run that reads it (was: only the first two, and an error with no fee or time; M2's error is its fee 5) | same, "no world lists more rows than it has rows with no source, no sum passes the truth by more than its fees, and with no fee the opening's error is the sum of its rows with no source that did not list, less any own row that listed in their place" |
| Q12 | `matchFundingLedger` on any permutation of its input, against a brute-force count on small worlds, and with a record added over W from every other (F1) | `bybit.funding-match.property.test.ts`: "the verdicts do not depend on input order, pairs are one to one, no one-to-one pairing explains more rows, and a far record moves no verdict" |
| Q13 | Convergence of the ledger under the cap, seeds of section 5, cut at every commit | `bybit.funding-ledger.convergence.test.ts`: "the ledger reaches the end within the table's runs and survives a restart" |

### Red-first seam tests

The nine rows of section 6.5, each in the plan step where the seam changes, shown red on the parent; seam 8 by mutant
(CONFLICT 1). Seams 3, 4 and 9 change in set 3 step 6/7, the step that adds the `bybit` id, red first with the real id;
set 2 does not touch them (O30). Set 2 keeps Binance's suites green, unchanged except the log tag re-pins (O28). Set 3
step 6/7 also changes Binance's status suites: their calls gain the required provider argument, with the same expected
results (A49). Neither adds owed state to any Binance account, so no 1.2-upgrade seed moves. A Bybit account has no
1.2-upgrade world at all.

One migration, in set 2 step 5/5 (O68 (b), PLANNER CALL 72; was: set 10 step 1/6; before that, no migration in any set). `source`, `institution`, metadata and `exchange_state` still have no SQL constraint (seam
map section 2), so nothing else needs one. It has an EXPLAIN test (A96) and a `kiko:reviewer` step. It adds an empty table, so no 1.2-upgrade seed gains owed state; the developer checks that against `walk.owed-since.test.ts`.

Pins that move, in the step that moves them (floor, developer greps): `provider.test.ts`,
`exchange-catalog.test.ts`, `registry.test.ts`, `help-topics.test.ts` (step count 5 to 6; the Binance step
stays 3, so "Enable Reading" holds; uk title), `en.uk.parity.test.ts`, `en.casing-by-role.test.ts`,
`uk.catalog-rules.test.ts`, `plist-credential-detect.test.ts`, the secrets shape suites of seam map section 10,
`binance-history-status.test.ts`, `binance-history-status.quiet-syncs.test.ts`.

## 12. Planner calls and conflicts

| Id | Call | Reason |
|---|---|---|
| PLANNER CALL 1 (closed by the user's Q2) | No notification | The user's answer. Measured, now under Backlog: four rules oppose it |
| PLANNER CALL 2 (changed by O13, then by PLANNER CALL 25) | Refuse at connect a read-write key, a key with `isMaster` not true, and a key refused on a real read of a shipped route, stricter than Binance (was: a missing box; no box list stands, section 6.8) | Binding "read-only"; a wrong balance is the anti-goal; the first two facts cost no call, and the reads cost section 6.8's count |
| PLANNER CALL 3 (text changed by O27) | A borrowed coin is refused, not netted; its line fits a first connect | No small account can test netting, so it may not ship; a stale balance is dated, an unproven sum is not |
| PLANNER CALL 4 | Floor `now - 729 days`, one day inside the documented edge | Transfer precedent; the same 105 windows |
| PLANNER CALL 5 | `createWriteSerial` for Bybit, Binance credentials untouched | A Keychain refactor of live users' pairs is out of scope |
| PLANNER CALL 6 | The cursor reader lives in `bybit/`; the cursor is never stored | O8's narrowest place; one consumer; a stored cursor has no known lifetime |
| PLANNER CALL 7 | `BYBIT_RESTART_FLOOR_MS` 2017-01-01 (`bybit.restart-floor.ts`; was 2018-01-01) | Any value below the rolling floor reads the same; 2017-01-01 is at or below Binance's `HISTORY_FLOOR_MS`, so a later switch to Binance on the same account loses no BTC history |
| PLANNER CALL 8 | Stage B reuses walk ids `capital` and `transfer` | State is per account, and it avoids the `WALK_IDS` fan-out |
| PLANNER CALL 9 | One gate at 1100 ms | Slowest route sets it; simplest shape that holds every route |
| PLANNER CALL 10 | Near = 14 days | Two weekly cycles of use; a text threshold, cheap to change |
| PLANNER CALL 11 | `ExchangeKeyForm` extraction | A second 240-line field fails `check:dup` |
| PLANNER CALL 12 (count changed by O28) | `walk.ts` log tags become `[exchange sync]`, tests re-pinned: 27 literal lines in 10 test files, one a fixture, not "floor 6" in 2 suites | O7 names the seam; threading a tag through 5 helpers adds surface |
| PLANNER CALL 13 | Wallet holdings conflict with Bybit, not with Binance | O11 covers exchanges; nothing shipped has this pair; today's pair stays |
| PLANNER CALL 14 (changed by O15, reversed by PLANNER CALL 31) | Was: internal deposits ship only with a real sender; with none, the copy states that limit. Now: PLANNER CALL 31 | Was: "only tested data kinds"; the user may have no second Bybit user |
| PLANNER CALL 15 (changed by O21, O64) | The device check builds the set 7 branch before any merge of sets 3 to 7 and 9 | O9 asks for catalog last and after the check; a device needs a way in |
| PLANNER CALL 16 | Keep the 7-day and 29-day windows, no adaptive width | The cursor reader follows pages; no measured need for narrower |
| PLANNER CALL 17 (changed by O33) | One new patch kind `balanceNotes` holds the refused wallets and borrowed coins per wallet (the Earn count left, O75): a wallet that this run read replaces its notes, and a wallet that failed keeps them, plus a mark of its cause: `refused` for a permission refusal, `notRead` for any other failure (O80 F1) | O13, O18 and rule 6 each need a visible line that reads persisted state; the section reads only that (section 5, "Caption false"). Precedent: `oversizedBalance` and `complete` in `exchange-state-patch.ts` (CODE). It holds no secret, and `exchangeStateReset` drops it |
| PLANNER CALL 18 (part 1 done 2026-11-03, O39) | The browser step splits: the terms come first, before the key moment; the URL check stays at R1 | O23 moves the verdict before code; a forbidding clause found first costs the user no account or money, and the URL check may need a login |
| PLANNER CALL 19 (withdrawn by O30) | None; the id stays retired | See the O30 row of the next table |
| PLANNER CALL 20 (new) | `hasExchangeHistory`, `captionWalksOf`, `isTrackedAssetOf` and the tracked predicate table live in the existing `src/screens/account-detail/crypto-sync-section/binance-history-status.ts` | O30 asks for a named source module. An existing module lets a red call a missing export with no import of a missing module, and the helpers it serves are there; O7 keeps the file name |
| PLANNER CALL 21 (new) | The Bybit tracked predicate is a named part of plan set 3 step 6/7, not a step of its own; `isTrackedBybitAsset` itself is written at step 4/6 | O30 asks for a named step and for seam 3 in the step that adds the id. A table typed by `BalanceProviderId` does not compile with the id and no entry, and each step has a green commit that passes the typecheck |
| PLANNER CALL 22 (changed by O37) | K11 moves from R6 to R4. Before set 7's device check, the user subscribes Flexible Savings again if it ships | O31 puts the redeem at R4, and a position redeemed in full leaves nothing to check on device |
| PLANNER CALL 23 (accepted by O41) | The user's approval of the spec moves after the terms verdict, before R1. Set 1's script does not wait for it | O38 puts the paste and the verdict first and names no place for the approval. The approval then covers the verdict, and the script is reviewed meanwhile |
| PLANNER CALL 24 (reversed by O40) | R4 comes after the R3 run of P3 shows the position, with no fixed day | P10's position older than a day was the only reason for a wait, and P10 left. Cost if wrong: R4 is repeated, at no money |
| PLANNER CALL 25 (accepted by O63 (a); count changed by F8 and O64) | Connect reads every shipped route once, not only each wallet: 9 calls, 10 or 11 with Earn (was: 7 or 9). No box list, `permissions` unread, `isMaster` kept | O13 binds "a shipped kind". With the walks kept, a key that reads the wallets and not a history route would pass and then stop a walk with only a log line. The shape is P11's. The withdrawal page says master only |
| PLANNER CALL 26 (new; corrects rule 45's words) | A row feeds the past of the net-worth line, `earlierHistory` and spending, and no current balance | Traced in the code, section 3. So the fee reading holds only as a residual bounded by the fee, not as "no number" |
| PLANNER CALL 27 (reason changed by O64) | `earlierHistory` is off for Bybit, through an optional field on the registry entry; Binance's line stays byte-identical | With every deposit on FUND and the leftovers of section 3, balance minus rows is no earlier history per holding: it would show a wrong amount, often below zero. Trades read do not change this, because the wallet of a deposit is still unknown. `ExchangeHistoryFooter` is the one place |
| PLANNER CALL 28 (not accepted, O63 (b); replaced by PLANNER CALL 37) | Was: a pending deposit with no time makes no row and owes nothing | Its reason stands, and CALL 37 keeps it: `owedBy` gives a no-time record the whole span with no series, and `commitSettledSpan` stops the forward pass on it. So one stuck AML deposit would hold the cursor of all three capital series for good. A wider extent does not work: its point changes with each span and leaves the list only by an exact read (`dropReadPoints`). What it missed: a settled row with no time, and a held row over 29 days, were lost with no trace |
| PLANNER CALL 29 (new; changes the proposal for the window field) | A withdrawal's `extentOf` is `createTime` alone, and its `reach` starts at the floor; a deposit's `reach` has no end; drift tests both readings. The walker stays as it is | An extent of `createTime` to `updateTime` moves when `updateTime` moves, and `dropReadPoints` clears only an exact point, so the old point would stay for good. A pending row outside `reach` would have no point, and that stops the forward pass. A settled deposit read under a window on its creation time can lie past the span end |
| PLANNER CALL 30 (new; type 50 changed by PLANNER CALL 118) | Only `depositType` 0 imports; 10, 20, 50, absent and unknown owe | The page says 20 and 50 are held or blocked, and it states no status for them. Cost if wrong: a missing row with a caption: a wrong past by its amount (O63 (d)) |
| PLANNER CALL 31 (accepted by O63 (a); changes O15's sender rule) | Internal deposits ship docs only, on FUND, with clause M2 and the policy's M2 text | The page covers them (O62), `address` and `fromMemberId` stay unread (O6), and the same safe readings hold. Its 10-digit sample is handled by A60 |
| PLANNER CALL 32 (corrected, O76) | Set 3 reads `walletBalance`, and a coin with `locked` is set aside (rule 6b). Was: only the `locked` row and its question wait for testnet | The docs do not state whether `walletBalance` includes `locked` (docs check of 2026-11-05). Was: "the page's sum reads as `locked` inside". That sum is no evidence for UNIFIED: it sits under "Derivatives available balance", it starts "isolated margin:", and it is in the row of a field deprecated for UNIFIED |
| PLANNER CALL 33 (new; changes O36; O75: step 7/7 writes no code) | The set 1 tip is the commit of this text. Earn moves to a new set 3 step 7/7, the one code step that waits for testnet | O62: no code waits that need not. Results of the empty read and testnet land in set 1 step 10/11, and each base picks them up |
| PLANNER CALL 34 (changed by O63 (c); CLOSED by O75: one real build) | The device check holds two builds: a scratch clone on testnet by its own untracked `.env`, on the simulator or a named device with no real data, then the real build | The user asked for correct data end to end (O44), and an empty account shows none. The host comes from `@env`, so `src/` has no switch and 2.5.19 holds. Section 10 has the guard |
| PLANNER CALL 35 (new) | The empty Earn read is `R4 P3` with `skip`; no new run name and no script logic for it | P3's one-reading path needs a plain `R4`, which also reaches P6's withdrawal prompt. `skip` already ends P3 cleanly |
| PLANNER CALL 36 (changed by F14, PLANNER CALL 45) | No UI line says "docs only"; clause F1 and the words "current balances" were the only additions, and L1 and F2 join them. L1 states what the past cannot hold, not how a row was proved | A user cannot act on "docs only", and each text stays true |
| PLANNER CALL 37 (new, O63 (b); replaces CALL 28; was: owes nothing) | A deposit with no time and no final status, and any row with an unreadable time, owes its span as a range tagged with its series. This rules both cases of O63 (b): status 3 with no time, and a held deposit over 29 days. No stored id list and no re-read by the page's `id` param | The walker already has this shape: `isOwedPast` lets the forward pass go past a range owed in one series, with no shared code change: Bybit tags the range after `settleRecords`. The tagged range is both the visible trace (the caption) and the re-read (each run), and it clears itself. A list of ids would add state and a line for the same result. It also fixes F6. Cost: 1 call per run per stuck span, and past `MAX_PENDING_RANGES` they merge (rule 24) |
| PLANNER CALL 38 (new; the brief's proposal is wrong) | A log row's key is `id`, `type`, `transactionTime` and the coin, not `id` alone, and one key with two `change` values owes both | The page says "Unique id", and its sample gives `592324_XRPUSDT_161440249321` to both a SETTLEMENT row and a TRADE row. A key on `id` alone would drop a row with no trace: a wrong past. `transactionTime` is QUOTE a transaction timestamp, so a re-read gives the same key; two fills of the sample share a time and differ in `id`, so time alone is no key. `tradeId` would also tell them apart, but it adds a stored id that this key does not need |
| PLANNER CALL 39 (new) | The convert history is the one source of a convert: no log `CURRENCY_BUY`, `CURRENCY_SELL` or `CONVERT` row imports, whatever its wallet | Under the pages, a double count then cannot happen by construction (a convert also shown as a spot `TRADE` is outside them, and "What stays wrong" names it), and no match by coin, amount and time is needed; such a match would need a hold on the walks and a read of stored rows. Cost: a Unified convert that the history does not list stays a missing row, with those log rows named in the line. Before 2025-09-10 the user read that case; after it, no page says it exists. `CURRENCY_BUY` also covers a liquidation of a loan, which is a loan fact and stays unread |
| PLANNER CALL 40 (new; settles the brief's SUMMARY item) | A spot row's amount is `change`, accepted only when `change + fee = qty` | "Change = cashFlow + funding - fee" is QUOTE on the live page, not a SUMMARY, and the samples add up. They are linear rows, where `qty` has no direction and `change` is only a fee. For a spot row only `qty`'s words are stated, so `qty` is the check and `cashFlow` is not read. If a spot row has another shape, the check refuses it and the past stays A's, never a wrong trade |
| PLANNER CALL 41 (new; the brief's "counted" is by kind) | The not-imported line names kinds, with no count of rows | An idempotent count needs one stored id per row (`notImported`), and a perps account writes thousands of rows into one JSON column. A count kept without ids would double on each re-scan. A kind is also what the user can act on. Precedent: `untrackedCoins`, a list of names |
| PLANNER CALL 42 (new) | New `AmountUse` `rounded-row` for a log `change` and a convert amount | Rule 12 refuses more decimals than the scale, and the page's convert sample has 15. Refusal would owe nearly every convert for up to 729 days, each a missing row: a larger error than half a minor unit |
| PLANNER CALL 43 (total changed to 10 by CALL 59) | The new set is numbered 9/9 and runs before set 7: order 2, 3, 4, 5, 6, 9, 7, 8 | "Set 7" and "set 8" are named in rulings O44 and O64, in the review, the reports and this text, so renumbering would make those records false. The harness rule asks for a number plus the total, and M moves to 9. Order is stated once, in the plan's "Merge order" |
| PLANNER CALL 44 (new) | Add P8 and P9 by a new set 1 step 11/11, on top of step 8/11; the user steps grow to 7 | Section 10. A free fill is the only live look at a row in this track |
| PLANNER CALL 45 (new, F14) | A line on the net worth card, not a user waiver | Goal 4 stands and the user gave no waiver. Statistics is where the past is drawn, and no other surface is read while looking at it. It shows only with a Bybit account in the filter scope, so a Binance user sees no change. A registry field names the line, beside the one of PLANNER CALL 27 |
| PLANNER CALL 46 (replaced by O65 and CALLs 51 to 62: "stays out" and "under Backlog" no longer hold; its facts and its risk stay as the trace) | Was: `/v5/asset/fundinghistory` stays out of 1.4, under Backlog, and Q6 asks | QUOTE "Return transaction log in Funding Account", 7-day windows, 100 per page, `ioDirection`, `txnAmt`, `afterAmt`, `currcCursor` as the unique id. It could read P2P credits, Earn yield and old web converts, so "P2P credits are never readable" in report-q5.md is too strong: the P2P route is closed (O5), and this route is not. It is out because `showBusiTypeEn` has no closed list on the page (its sample shows only "Earn"), so a row cannot be told from a deposit, transfer or convert already read: each wrong pairing is a double count, and O64 forbids a guess in a shown value. `memberId` stays unread if it is ever used |
| PLANNER CALL 47 (new; tests the brief's scope) | Interest, bonus and airdrop stay under Backlog. L1 also names them and money moved into an unread Earn product, which the user did not read in O64 | Section 3, worked numbers: an airdrop of 10 reads +10 before it; a stake of 100 into an unread product reads -100 before it. The first kind is small and needs only rules on rows the walk already holds, so it is the cheap next step. The second cannot be closed from the log, because a stake from Funding is on no log. Goal 4 needs them stated |
| PLANNER CALL 48 (new) | A new walk id `log`; the existing `convert` id with a new `pageIndex` mark; no `category` in the log request | Each exchange's state is per account, so `convert` fans out to nothing (CALL 8's shape). `log` has no fitting id. With `category=spot` the line could not see what else the log holds, and no page says which `category` an interest row has. Cost: perps rows use up the lane, and a burst over 1,000 rows in a span of a minute or less holds (section 5, PLANNER CALL 63; was: a day over 1,000 rows) |
| PLANNER CALL 49 (new) | A convert older than the 729-day floor makes no row | The route has no time filter, so nothing else stops it. One old row would move `spanStart` and start the line years before any other row, with an empty past |
| PLANNER CALL 50 (new) | One Kiko row per log row, no sum per order | Binance sums per order through a read per order. Here a span can cut an order in two, and a summed row's key and amount would change when the second part arrives. The cost is a longer list for an order with many fills, which a visual round can fold |
| PLANNER CALL 51 (new, O65; was: no migration in any set) | A new table `funding_match_rows`, one migration, in the `.kiko` snapshot as an optional key with no version bump (the `deletedImportKeys` precedent) | A paired ledger row has no transaction row, so it needs a store. `exchange_state` fails: CALL 41 rejects one JSON column for thousands of rows, and 87,600 rows at about 60 bytes is about 5 MB rewritten per patch (COMPUTED, 5-coin seed). A transaction row with a hidden flag fails: a reader that misses the flag doubles. A column on the source row fails: a removed source would lose its ledger row. `snapshot-covers-every-table.test.ts` requires the file key, and the design needs it: without it a restore keeps cursors past rows no store holds |
| PLANNER CALL 52 (new; the brief asks whether the ledger walk waits) | No walk waits. One rule runs over the whole stored set at the end of each run, with no stored decision | A hold alone misses a source behind its cursor, and a decision at arrival depends on order. Order-free by construction is simpler to prove than a list of orders. `waiting` is a verdict inside the rule, not a walk's state |
| PLANNER CALL 53 (new; the brief asks for each series' unit and time) | One W, 7 days, measured to a time extent; no table of windows per series | No page states a delay, so a table would be a table of guesses. A withdrawal's review time is in its extent, which the stored record holds and a transaction row cannot. The window's cost falls only on a source with no ledger row, because pairing is nearest first |
| PLANNER CALL 54 (new; extends the brief's rule) | A free source near a row holds it, whatever its amount, and `bybitFundingHeld` counts it. No percent tolerance, and no compare at a shorter scale | This turns "a form no page states" from a double count into a lost row. A tolerance would be a guess at a fee. Cost: a real credit near a Unified deposit of that coin stays out, and the count can include rows the source already holds (M8, M14), so the text says "looks like". P19 prints a decimal count and a match, so a scale rule can come as a fix if a real row shows it (O75; was: if testnet shows it) |
| PLANNER CALL 55 (new; the brief's property is wrong as written) | Two properties, not one: equality on clean worlds (Q10), and on any world no double count, with the error equal to its lost rows (Q11) | "Equals the truth, with no lost row" over any seeded world cannot hold: M12 has one source, one ledger row, equal amounts and no way to tell them apart. A pass would only mean that the seeds avoid it. M16 and M23 stay outside Q11 by name, and A89 pins them by number |
| PLANNER CALL 56 (new) | A listed row is never spending, in either direction, by the marker `ledger:funding`. A fixed label, with no server text stored or shown | An Out row can be a stake, a P2P sale, a move to a sub-account or a card payment, and no list tells them apart: O62 forbids guessing that into a shown value. Spending stays as with no ledger, so a card payment stays short by its amount, and F3 says so. `descriptionEn` is English on a Ukrainian screen |
| PLANNER CALL 57 (new; tests the brief's Earn question) | Words on `EARN_PRINCIPAL_WORDS` list only under clause "E2 and E4". A word on no list always lists. So under any clause that reads Earn, a stake under an unseen word doubles (M23), by its amount, with no sign. No page gives a list, and any safe reading for it costs every unknown row, so the whole feature | Worked numbers in section 3. Under "E2 and E4", the default with no testnet reading, Earn has no holding, so a listing is right and the case cannot happen. No other Earn clause ships (O75; was: only after K4 and K11 on testnet). The user read this residual as Q7's B (O67; was: "gets it through the report"). E3 is the case with no such gate (M35, PLANNER CALL 74) |
| PLANNER CALL 58 (new) | `afterAmt` is not read | It looks like a proof and is none: each ledger row is listed or paired, so a sum over the ledger closes on `afterAmt` under a wrong match too. The sample also has 16 decimals against 8, so a sum would need a tolerance. No surface needs the figure |
| PLANNER CALL 59 (new) | A new set, 10/10, order 2, 3, 4, 5, 6, 9, 10, 7, 8. Not part of set 9. M becomes 10 (was: 9; CALL 43's text stays as the record) | Set 9 is at 12 to 15 files, and together they could pass the cap of 30 mutable files. A migration has its own review. Set 7 bases on set 10's tip, stays last and holds the way in, so Guideline 2.5.19 holds at each tip |
| PLANNER CALL 60 (new; applies N1, N3 and N5 of the review of 32337df0d to this walk) | Bad rows owe a tagged range, not a point each. A row with no `currcCursor` owes nothing and marks a flag. A repeated cursor with no new key ends the span. A day splits to 1 minute, now 1 second (O68 (a)) | A point per bad row grows `pending` with no bound (N3). A row with no id can never clear a point, and rows before 2026-08-27 may have none; a flag is bounded, on the CALL 41 precedent. A cursor past the end must not hold the caption (N5). A day over the cap must not hold the lane (N1) |
| PLANNER CALL 61 (new; O75: the empty read only) | P19 in set 1 step 11/11, on the testnet step 7 run and the empty read. No new step number in set 1 | The words are the largest open item, testnet costs no money, and K2, K4, K5, K10 and K11 are already there. Printing `showBusiType` is an O51-kind residual: a shape test, not a closed list. O56's stopping rule stays |
| PLANNER CALL 62 (new) | One Kiko row per listed ledger row, no sum per day | A summed row's key and amount would change, as CALL 50 says for an order. If Bybit pays hourly (no page states it), a Flexible Savings user gets 8,760 rows a year per coin in the list. A visual round can fold them, and a sum per day needs no change to the match rule |
| PLANNER CALL 63 (new; N1, O66 (a); corrects the review's "already support it") | `readCursorSpan` takes `minSplitMs`: a day for capital and transfer, 1 minute for `log` and `fundingLedger`, now 1 second (O68 (a), PLANNER CALL 73). It never splits before a span's first page. A Bybit helper `plainHintOf` turns a forward or re-scan resume into a plain hint for those two lanes | `halfOf`, `walkSpans` and the hints take the split with no higher cap, and it converges. But `runWalkPlan` drops a resume on those passes, so with the split alone each slice of a busy day halves again from 7 days: 1,636 runs on 100,000 rows against 167 with the helper, MEASURED. Capital and transfer keep the day: Q3 (b) accepts them, and "change nothing else" holds |
| PLANNER CALL 64 (new; N2, O66 (b)) | Keep the review's proposal: `tradeId` for presence only, and an empty one owes a range. P8 counts empty ones | Section 3 tests it in six worlds. A fill with an empty `tradeId` owes up to 729 days with a caption; a summary row with no guard doubles with no sign, which O62 refuses. It does not stop a summary row that holds a `tradeId`, which stays a named double count. Every sample on the live page has a `tradeId`, and no page shows a spot row |
| PLANNER CALL 65 (new; N3, O66 (c)) | A failed spot check, a third coin and an empty `tradeId` each owe the span as one range tagged `log`. A same-key conflict keeps points | Points never merge (`normalizePending`), and CALL 41 rejects the same hazard. The third-coin case is not in N3's text; it has the same growth, so it moves too |
| PLANNER CALL 66 (new; N4, O66 (c)) | A second optional mark `passOwed`. A page adds its points to `passOwed` and to `pending`; a pass's end sets `pending` to `passOwed`. Over 12 points become one range tagged `convert` | The hand table of section 3 shows run 2 keeps the point and its `since`, and a settled point leaves only at the end of the pass that read it. Adding to `pending` at once keeps the caption true during a long pass. The cap applies N3 to converts: an unknown status word on every row would owe 1 point per convert. Both marks stay in `exchange_state`, so no migration, and a Binance state keeps its text |
| PLANNER CALL 67 (new; N5, O66 (c)) | An empty page, a repeated page, a refusal of class "any other" at `index` over 1, and `CONVERT_PASS_PAGES` = 1,000 each end the pass. P9 reads `index` 9999 | No page says what `index` past the end returns. The review named a repeat. A refusal and a wrap to page 1 hold `cursor` null in the same way, and a repeat test sees neither, so this also closes those. A rate or key refusal still stops the run. Ending a pass early loses nothing that a later pass can read. Accepted residual, outside the pages: a server that repeats in mid-list hides the rows behind it, with no sign; accepted under O56 and told to the user, with no question (O68 (c), Q-c, section 13) |
| PLANNER CALL 68 (new; N5, report-o65.md) | Rule 51 step 4 holds a row on the convert gate only under W old, with `now` as an input (M27, M28, A101) | With the gate alone, a route refused for good holds every ledger row for good. Listing an older row is safe, because no decision is stored (CALL 52): while Kiko holds no such convert, the row is the only record of that move, so it is true; when the convert lands, that run's reconcile pairs it. The function still reads no clock |
| PLANNER CALL 69 (new; N8) | Two clauses: L1 in full on the account's `bybitKinds`, and a short L1S as all of `statistics.bybitPastLimits` (was: L1 word for word in both) | N8's four gaps take L1 to 555 characters, and the whole Statistics text to 636, about 14 rows under the chart. L1S is 297, about 7 rows, names the gaps by kind and points to the detail. It leaves out old converts and the Funding sentence, which `bybitKinds` holds. Goal 4 stands: the line still says what the past cannot hold. CALL 45 stands. F6 and F7 take L1 to 596 and L1S to 334, and O85 takes L1S to 444 en and 499 uk, section 8 |
| PLANNER CALL 70 (new; F1; tests the review's proposal) | Keep nearest first, and add repair by augmenting paths through the pairs. Not the review's "time order": time order alone fails two worlds | A pairing in time order within each form misses the fee world M31: its pairs cross forms, so that row lists, a double. It also gives an earlier equal credit the source of a same-second pair, -100 for days, where nearest first gives the truth, and a same-second pair is the common case. Time order's gain is a stronger stability proof, with no swap when a source arrives. Repair keeps every pair nearest first makes, reaches a maximum pairing, adds about 30 lines, and its swaps stay near the new record (section 3, "The pairing tested") |
| PLANNER CALL 71 (new; F2, F8) | Reconcile writes only the difference against the stored keys. `waiting` removes nothing. A prune at the floor minus 2 W | `removeSyncedRows` deletes a note and category, so a verdict in doubt must not call it. A write per listed row per run would touch 87,600 rows on that seed. With no prune, the rule's cost grows every year past the floor, and rows older than the walks can read can move no verdict |
| PLANNER CALL 72 (new; F3, O68 (b)) | The empty table moves to set 2, step 5/5, with the migration, the final columns, the `.kiko` key, child-first deletes and the migration's `kiko:reviewer` pass. Set 2 merges `next` first and is in `next` before any device build. Set 3 bases on set 2's merged tip. Set 7 merges `next` before the real build | The runner counts (`journal.slice(COUNT)`), so a phone with real data must never run an unmerged migration. No later set adds one, so every build's journal is a prefix of `next`'s. 2.5.19 holds: no flag, no writer, no reader but the backup path, nothing to see in either state, and the rule is about what a user or reviewer can reach. If the track stops after set 2: the empty table, `fundingMatchRows: []` in each `.kiko`, and the child-first deletes stay until a later release drops them by a new migration; no user data and no text change. The other option, which the coordinator can take: keep the table in set 10, and run the real check only on a device with no kept data until the batch merges, which costs the proof on the user's real database and needs a second device |
| PLANNER CALL 73 (new; F4, O68 (a)) | `minSplitMs` 1 second for `log` and `fundingLedger`, a patch kind `denseSpans` of at most 2 entries, and `bybitHistoryDense` in place of the pending caption | MEASURED: a burst costs 5 to 10 more runs, and an even day none. The mark is set only when the span was this pass's first read, so a budget stop shows no false line. Its entry goes at the commit past the span, so it needs no data of its own to expire. The ledger's bounds are whole seconds, so the rule rounds a span out, and its stop covers one or two whole seconds. The review's note that `pass !== 'point'` is always true in the model stands: `plainHintOf` tests for a forward or re-scan pass by name |
| PLANNER CALL 74 (new; F5, O67; O75: the row "No reading" holds) | E3 stays when testnet does not show the words. Any other result with no words is Q7's C, clause "E2 and E4" | "E2 and E4" says money is not in the balance, and P3 has shown it is. A false sentence about a current balance is worse than a named double in the past. Section 10 holds the five branches |
| PLANNER CALL 75 (new; C1) | Twelve columns (stage F), one boolean for the Earn words, and fee and tax in the policy | Rule 51 needs fee, tax, the time end and the Earn result. Reading words at each reconcile would store them, against section 9. A boolean also stops a longer list in a later release from changing an old row's verdict with no new read. Series and the boolean reach the policy as "kind of move" |
| PLANNER CALL 76 (new; O75) | Set 1 step 10/11 records "no reading". P2 and P3 rows stay docs only, with the empty shapes MEASURED, and they lose their UNPROBED mark | Their probe will not run, so O35's wait has no end. `git grep -c UNPROBED` now falls to P17, deferred rows under Backlog and the record rows of section 12 |
| PLANNER CALL 77 (new; O76) | The rule is for UNIFIED only. FUND has no `locked`, and an untracked coin's `locked` is not read | QUOTE: the two FUND pages list `walletBalance`, `transferBalance`, `bonus`, with no `locked`. An untracked coin has no scale and no money value, the same as its loan fields. Cost: an untracked coin wholly on order can miss the "Not tracked" line, if its `walletBalance` reads zero |
| PLANNER CALL 78 (new; O76) | One outcome per coin, tested in this order: two rows, refused; a loan above zero, borrowed; a loan field not decimal, refused; a balance unreadable, refused; `locked` above zero or not decimal, open order; else balance | The open-order text can promise too much only if a fault outlasts the order, so each fault that outlasts it wins. A loan above zero keeps today's rule that it beats an unreadable field (`bybit.balance-read.test.ts`). The brief's reading "follows the borrowed path" holds for the path, and needs this order for the text |
| PLANNER CALL 79 (new; O76) | Its own list `openOrder` under the wallet's `balanceNotes` entry, on the `borrowed` path, and no second patch kind. A walk's zero holding stays at zero while the coin is set aside, and the text covers it. Was the brief's "absent": true until a row of that coin arrives, from set 6 on. A walk's row from set 6 creates a Unified holding at 0 and it stays 0 with the line (O77, O78); the past-line effect is fixed by set 11 (PLANNER CALL 86), and is not an accepted residual | Reusing `borrowed` would show a loan text for an order. Each place the path needs is in plan set 4 step 7/9. `withBalanceNotes` replaces a wallet's entry whole, so the first good read clears the mark with no new code. The past line moves during the order, and heals: section 3 |
| PLANNER CALL 80 (new; O76) | The older-build proof is a pin on this build's parser and writer (A116), with one code fact: `git show main:src/crypto-sync/exchange/walk-state/walk-state.ts` holds no `balanceNotes`, read 2026-11-05. No test can run an older build's code | A wallet entry holds named fields only (`walletNotesOf`), and a writer spreads the raw state. The real restore in an older build was not run (O10 stands by inference; the scratch test retired at set 3) |
| PLANNER CALL 81 (new; reverses O73 (c)) | A Bybit balance read stops writing `oversizedBalance`. Refused coins go to `balanceNotes` as `refusedCoins`, with `bybitCoinRefused` | Section 3, "An account with every coin set aside". `oversizedCoinsOf` merges the balance and history lists, so a text per provider on `CoinLines` could not tell them apart, and a Bybit history row's oversized text is true. The notes already replace a wallet's entries wallet by wallet, as `complete` did for this list |
| PLANNER CALL 82 (new; O76's condition) | With no holding and any balance note, on an account with `hasKeyLines`, the account detail shows `bybitBalancesNotRead`. It keeps "Add a holding" | The block "No holdings yet" says the opposite of the lines above it. Its text fits a coin refused, a loan, an open order and a refused wallet. While the Bybit state row loads, nothing renders (O79: either block would be a guess, and the old block would flash "No holdings yet" on an all-refused account); every other account keeps today's block at once. The gate counts `untrackedCoinsOf` and the notes (O80 F4), so an account that holds only an untracked coin does not read as empty. A small component holds the state read, so the screen's own complexity stays. Home and the accounts list are a user question (section 13) |
| PLANNER CALL 83 (new; O75) | Code 10024 is a class of its own, `compliance`, with a fixed text and no cooldown. A FUND-only 10024 is logged like any FUND failure, and (O80 F1, replacing "tolerated and logged") it marks the wallet with `bybitWalletNotRead`; a good read clears it. `checkKey` throws on a rate refusal or a 403 (F3), and a UNIFIED or FUND `{list:[]}` is malformed (F2; the measured empty shape is `list:[{coin:[]}]`) | CODE: it falls to `unknown` today (`failureOfCode`, otherwise), so it shows "Bybit request failed: 10024", or the expired text past the stored date, which is false. The text states the fact and offers no step, by the user's order. A FUND-only 10024 is a world no read has shown, and `bybitWalletRefused` tells the user to check permissions, which does not fit |
| PLANNER CALL 84 (new; O73, O76) | A test of the docs' sample row is added, in the client suite, whole | For the loan fields alone it adds nothing: `bybit.balance-read.test.ts`, "reads a loan of %s as no loan", covers "0" and "0.0" per field, and each field is read alone. It earns its place because the same row must now also pass with `locked`, from the page's bytes through the client's parse |
| PLANNER CALL 85 (new; O75) | Set 3 step 7/7 writes no code. The Earn count leaves in set 4, with its key, parse, patch and line. Set 7 writes the clause. In `bybitKinds`, "other Earn products" goes too, and the Earn sentence follows the not-read list, not the balance list | "It does not read ... other Earn products" is false beside "Earn is not read", and "It does not read" after the Earn sentence would read as about Earn. O73 (c), "step 7/7 must add Earn to `complete`", falls. Set 7's connect is 10 calls. `BYBIT_SIGNED_PATHS` stays without `/v5/earn/position` |
| PLANNER CALL 86 (new; O78) | A date of its own, `balanceReadAt`, in the holding's metadata, written with the balance through `runBalanceSyncInner`, kept by a disconnect. `sync.ts` derives the write from the list `datedBalances` by `provider.metadataField` (Bybit only), through one exported reader of that private list (O87; was: a provider asks for it by the optional field `datesBalance`). Was the brief's option A: `syncedAt` | `disconnectDatabaseTransaction` strips `syncedAt`, so with it a disconnected holding either loses its past or goes back to the fault for good. The state's stamp moves while a coin is set aside. Section 3, "The past line while a balance is old". O87: with two switches, a holding listed without the switch gets no date, every row of its source drops, and the line goes flat |
| PLANNER CALL 87 (new; O78) | One filter before the valuer's existing body, only for a holding with a `bybitAsset` key: a row with `source: 'bybit'` counts only at or before `balanceReadAt`, and with no date it does not count. Every other row counts, except a row on the mark (O88, PLANNER CALL 91; was: "Every other row counts"). So a holding with no read is at 0 with no special case. No other holding runs the filter | The rows a stored balance holds are exactly those, and the rest of the body stays as it is, so the local-day bucket rule and the last point do not move. The filter compares instants, because the read is an instant and a bucket is a day. O62: no opening is guessed |
| PLANNER CALL 88 (new; O83) | The not-read block counts the untracked balance list, not the union, and set 11 carries it because set 5 is its first writer. Was: O83 "from set 6", and the set 6 planner | A row walk only proves a coin existed; it says nothing about a balance. No read clears the history list. Section 3 has the matrix |
| PLANNER CALL 89 (new; O78) | Set 11 runs after set 4 and before set 5, and keeps the other sets' numbers (the pattern of PLANNER CALLS 43 and 59). Was: "before set 6" | A FUND coin refused, or a FUND wallet not read, takes capital rows from set 5 on |
| PLANNER CALL 90 (new; F1 of the review of set 11). NOT CHOSEN: for the orchestrator or the user | Where T is taken. Today, one T per run, after both reads: a fill after the balance's answer and before T counts though the balance does not hold it. Hold 1 X, a fill of -0.2: 1.2, 1; hold 0 X, a fill of +1: -1, 0; both until the next read. X: one T per wallet, when that wallet's answer returns: the same error, but the wait for FUND leaves a Unified coin's window. Y: one T per wallet, before that wallet's request: the error changes side. A fill before Bybit's reading and after T is in the balance, but its row drops: hold 1 X, a fill of -0.2: 0.8, 0.8, truth 1, 0.8; hold 0 X, a fill of +1: 1, 1, truth 0, 1. Never below zero by this cause, and a slow answer no longer widens the window | Neither removes the skew. X and Y each cost one optional field on `ProviderBalance`, `sync.ts` writes it in place of `syncedAt`, and A122 changes: about 10 code lines, 40 test lines, floors. A timeout in the client is a different trade: it turns a slow read into a failed sync, and it needs a number no reading supports. This text changes no code |
| PLANNER CALL 91 (F2 of the review of set 11; answered by O88) | The user ruled Q-j "C: By mark", in the set 11 fix round. Rows A128 to A132 hold it. Was: row 15 stays OPEN for the user, the planner recommends option C, and no acceptance row exists until the user rules | Option C holds the rule of PLANNER CALL 87, the rows a stored balance holds, and it invents no row (O62). Option A is the smallest, but it breaks a world that is right today. Was, in this cell: option C breaks no such world; row 20 shows that it does (PLANNER CALL 93). Row 15 is not a regression and no later set reads it, so it holds no set; the fix lands before the merge batch |
| PLANNER CALL 92 (new; O88) | The mark is NOT in `carriedMetadataKeys`. Each good read writes its own list after `withCarriedMetadataKeys`, and an empty list writes no key. Was: Q-j's option C named "a key in `carriedMetadataKeys`" | `withCarriedMetadataKeys` overwrites the target with the stored value, so a carried key puts the stored list over the new one, or keeps a stale list on a read with no such row. The update branch rewrites the whole metadata, so nothing else needs the carry. It is the reason `BALANCE_READ_AT_FIELD` is not carried either. The empty case keeps the exact-metadata pins of rows 8, 10 and 11 green unchanged |
| PLANNER CALL 93 (new; O88; answered by O89) | Option C is built as the user ruled it, and the claim "it breaks no world that is right today" is withdrawn. Row 20 is such a world: today 1, 1.5, with option C 1.5, 1.5. The user heard it through Q-l and ruled "A: C stands" (O89). Was: "The user did not hear it, so it goes to the user: Q-l" | No test at the read tells rows 20 and 21 apart, because a walk's row comes after the read. Option C is right in row 21, and today's value is right in row 20. The walks list deposits, withdrawals, transfers, trades and converts, and a disconnect sends every walk back to its floor, so a reconnect reads such a move again: row 21 is the likely world. Row 20 is the error of "What stays wrong": a move no walk lists stays in the past as units nobody moved. The last point stays Home's number, and nothing goes below zero by this cause |
| PLANNER CALL 94 (new; O88; answered by O89) | Fix round step 2/3 does not change `transactionsRepo.update` or `transactionsRepo.remove`. Step 3/3 does, as the user ruled Q-k "A: No balance move" (O89). Was: "Step 2/2", "A132 pins rows 16 and 17 as they are, until the user rules Q-k", and option C's text did not name them | Option C moves no balance, and the wrong value is on Home, not only on the line, so it is more than the option the user ruled. The same numbers hold today, so the mark makes nothing worse. The ruling is its own step on these files, before the merge batch |
| PLANNER CALL 95 (new; O89) | Q-k's option text is wrong in two places. The check sits in one private move, `moveBalanceOfRowDatabaseTransaction`, which replaces `moveBalanceDatabaseTransaction`, and not in `update` and `removeRowsDatabaseTransaction` apart. And `balanceChangesOf` changes too, which the text did not name. Was: "15 code lines in `transactionsRepo.update` and `removeRowsDatabaseTransaction`" | One move means no bare move stays for a later path to call. `removeRowsDatabaseTransaction`'s own holding read, `readNamedHoldingsDatabaseTransaction`, holds no `metadata`, so the claim that it "already reads the holding" is true only of the read inside the move (`readHoldingDatabaseTransaction`). Without the second change the confirm says "This changes the balance of X by -0.5" and Home does not move: a wrong value. "No text" holds: no key is added, and a sentence falls away |
| PLANNER CALL 96 (new; O89) | `isOverwrittenRow` tests `datedBalanceSourceOf` first, then the list. A mark in a file on a holding off `datedBalances` changes nothing | It is the gate of `rowsHeldByBalance`, so Home and the line read one rule, and no such holding can lose a move. Testing the list alone would let a hand-made file freeze a Binance balance while its line still counts the row |
| PLANNER CALL 97 (new; O89) | A132's fault pins are not written. Step 2/3 holds no row 16 or 17 test, and step 3/3 writes them red first, on step 2/3's tip. Was: step 2/2 writes them, and a ruling re-pins them | The ruling came before the mark's commit, so no title exists to re-pin (grep at d8b90aadf: none). A pin of a fault that the next commit removes proves nothing that the red does not |
| PLANNER CALL 98 (new; O89) | A delete does not drop the id from the mark. It stays until the next good read replaces the list | Row 24 holds: a stale id matches nothing, and an id is never reused (the comment on `balanceSetRowId` states the same rule). Dropping it adds a metadata write for no value. An account that stays disconnected keeps one opaque id, which reveals nothing |
| PLANNER CALL 99 (new; O89) | Row 22's own shape, a negative leg on a coin, is repo-only. The form writes a leg on a coin only as a receipt: `crypto_asset` has `source: false` and `createSource: false`, so a coin row cannot be converted, and a new Exchange is cash to cash. A cash or card expense row's Convert writes +amount on the coin. So row 25 has the app's shape, and row 22 and its A131 pin stay, for a file and for `recordExchange` | Each shape takes the same two functions, so the rule does not change. The numbers the user would see are the receipt's |
| PLANNER CALL 100 (new; F1 of the review at 3ac53db74) | Duplicate has two entries, not one: `TransactionRow` on Home and the ledger row on the holding detail. The sweep for a `manual` row on a connected holding found Duplicate as the only entry that writes a new one. CLOSED by reading: the primary picker, the return picker, the Convert picker and `recordExchangeCounterpart`; a template (`resolveDraftReferences`); `footerAction` (the add); `isSyncedEdit` with `saveEdit` (the balance); Exchange and split, which need a `cash` source (`resolveModeOptions`), and every exchange holding is `crypto_asset`; `importRows`, which needs a bank. `transactionsRepo.add` has no production caller. Openings write only on a new holding. A row that reaches a connected holding with the app's own shape: typed before a reconnect, or in a `.kiko` file. NOT a new row: `update`, the edit of such a row, moves the balance while the row is off the mark. OPEN by reading, not run: the form tests no gate at save, so a form left open in a pane while another pane connects the account can still write. `next` at 14f997ad7, `1.4-recurring` at 2a8a747ad and `1.4-category-automation` at e6ccebbd8 add no writer: `recurring/` reads rows and marks a series, its screen opens the same edit form by `transactionId`, and `category-rules.repo.ts` sets only the category | `git grep` of `recordManual`, `recordExchange`, `recordManualWithReturns`, `insert(transactions)`, `onDuplicate=` and the routes to `TransactionForm`, on each ref. The count is a floor; the developer measures |
| PLANNER CALL 101 (new; Q-n) | Removing Duplicate tests `isSyncedHolding`, with no Bybit branch. It goes with a gate in `recordManualTransaction`, which reads the account only for a holding with a synced key, so a form left open is refused too. Scope stays the user's, in the question: O91's "Bybit-only" ruled the mark and its balance rule, and this gate reads no mark and changes no value, but it does change a menu on shipped Binance, Monobank and wallet holdings. A Bybit-only gate adds a branch and leaves two behaviors for one action | The add button and the pickers already use this test, and their comment says a synced holding "can never be the target of a manual write". The 12 test files that call `recordManual` are a floor for seeds that the gate can break; the developer measures. No flag and no build switch, so Guideline 2.5.19 does not apply: the action follows the row's data, as it does for a Bybit row |
| PLANNER CALL 102 (new; Q-n) | Two proposals change. "Route Duplicate to the form so that the holding is not seated" does not work as worded: `resolveHoldingField` hides the picker unless the form is an empty create, and with no holding `currency` falls to UAH, so 0.5 of a coin would seed as 0.50 UAH. The option becomes: open with the picker, keep the amount only if the picked holding has the source's currency, and write no row on the connected holding. "Put the new row at once on the mark" works, but it is a second writer of the mark ("One writer" above), it reverses "A new row is not on any mark", and it fits only a holding on `datedBalances`. So it is Bybit-only until the separate track of O91 adds the others, and they keep today's numbers until then | `resolveHydration`, `seedFieldsFrom`, `resolveHoldingField`, `overwrittenRowsPatch`. A mark at write time gives Home 0.1 and line 0.1, 0.1 at each moment, and row 16 then holds for the copy from its first moment |
| PLANNER CALL 103 (new; Q-o) | Refusal keeps a one-way fingerprint, not the UID: `signQuery(accountId, userID)`, as a new `exchange_state` key written by a patch of a good key read. `exchangeStateReset` keeps it, as it now keeps only walks. So no migration, and it rides in `.kiko` with the state, with no `EXPORT_VERSION` change. The raw value stays out, so A31 stays true as written, but the rule "never parsed" (section 9, "Personal data") and the policy change: the user approves that with the option. REJECTED: the Keychain (a disconnect clears the item, and `.kiko` carries it only with the toggle), a column on `accounts` (a migration for one rare world), and the plain UID in state (O5, O6, A31) | `fetchKeyInfo` drops `userID` today, and nothing in the app keeps it. A UID has few digits, so the fingerprint hides it only from a casual reader of the file: the policy names it, as it names the log id that can hold an account number. Binance reads `uid` in `readOwnUid` and keeps it nowhere |
| PLANNER CALL 104 (new; Q-o) | The check runs in `bybit-credentials-field` (plan set 7 step 1/6) after `isMaster` and before any Keychain write. It adds no call: `query-api` is the connect's first call. It refuses only while the account keeps a holding with `bybitAsset`, as `conflictingExchangeHoldings` does, so a user who deletes those holdings can connect any UID, and the next good key read writes the new fingerprint. No stored fingerprint: it passes. `userID` absent on a reconnect that has a stored fingerprint: it refuses with `bybitKeyRejected`, because the check cannot show the same owner. A sub-account key never reaches it: `bybitKeyNotMain` comes first. A sync does not compare, so a renewal at 90 days writes nothing and shows nothing new (section 6.3), and a new key of the same UID passes and re-walks with no double count | Restore: the state rides with the file, so a file's account keeps its check. With no credentials in the file the account stays connected with no pair, and the only way on is a disconnect, which resets the cursors. Nothing can connect a Bybit key before set 7, so this holds no earlier set, and no shipped account lacks a fingerprint |
| PLANNER CALL 105 (new; Q-o) | Three proposals fall or change. "Keep the rows and state the double count" can only be a static text at connect: a note shown on detection costs the fingerprint and the policy clause of a refusal, and leaves every wrong value. Rows kept in the lists but off the line, by a boundary on `createdAt`, is REJECTED: old UID, new UID, then the old UID again keeps the old rows under the boundary through the dedupe, so its own rows leave its line. "Ask the user and start fresh" stays, but it deletes every `bybit` row of the account, and Home stays short if the old UID still holds money. A cursor does not skip the new UID's past on a reconnect (`marksAfterDisconnect`; `disconnect.real-sqlite.test.ts`, "for Bybit, resets the walks to its restart floor"). Two reachable faults remain, both by reading, and set 5 and set 10 are not built: run-log gap 20261017T1639-kiko-binance-backfill-fix/1, where a late patch of the old walk passes the `institution` gate after a quick reconnect and moves the new connection's cursor; and `matchFundingLedger`, which reads every stored source record of the account, so a new UID's ledger row can match an old UID's deposit and stay unlisted. A row key is `<accountId>:<kind>:<id>:<COIN>`; a collision needs one record id in both UIDs, and no page states that ids are unique across UIDs | The skill records the reconnect of a different account as wanted (kiko-exchange-sync, the floor cursor), for the cursor only. A refusal keeps a new UID off this account, so it closes both faults for this world. The gap stays open for the same UID. The renewal gap 20261103T2057-kiko-1-4-bybit/1 is not touched |
| PLANNER CALL 106 (new; O92) | The removal is not free of text, and the user was told "no text": 1 new text and 1 changed text. A form left open while the account connects reaches the gate at save. The throw reaches the catch of `performSave`, then `showSaveErrorAlert`: an alert "Could not save" with "Please try again.", and the form stays open. A retry fails the same way until a disconnect, so that message is false in every world. No key fits: `forms.fields.saveErrorMessage` is that false advice; `forms.transaction.syncedNotice` says a stored row "was synced" and that its category can change, and here no row exists; `forms.transaction.selectHoldingError` says that no holding is selected, and one is; `accountDetail.exchangeSwitchRefused` is about a connect. New: `forms.transaction.syncedHoldingSaveError`, shown with the existing title, in all four kinds and in Add, Duplicate, Exchange and split, because it names no kind and says "a holding on this form". Also, `help.topics.editTransaction.steps.3` says that "Duplicate" makes a copy of a row "you added yourself", which is false on a synced holding: its last sentence changes, en and uk | `performSave`, `showSaveErrorAlert`, `alertOnCatch`, `en.ts`. Only `performSave`'s catch changes: the other catches of the form write no new row. Was (questions file, spec Q-n): "no new text" |
| PLANNER CALL 107 (new; O92) | The menu of each source on each kind is the table in section 3, "The hold menu of a row after O92". Duplicate comes back after a disconnect on all four kinds, because `isSyncedHolding` reads `institution`, and `disconnectDatabaseTransaction` clears it and keeps the key, for each kind. A holding whose key is an earlier provider's offers Duplicate on a connected account too (O96, PLANNER CALL 113; was: this call named only a key with its own provider, and "each kind has one key" let such a holding read as synced). A row with a non-manual source never had Duplicate, and it does not get it back. A holding with no synced key keeps Duplicate on any account. A hold always opens the list: every row has at least View account, so no manual row falls to a direct delete confirm | `isSyncedHolding`, `isSyncedTransaction`, `isDeletableTransaction`, `useViewActions`, `CardContextMenu` (`card-context-menu.component.tsx`). Home's `accountsRepo.listQuery` includes an archived account, so a row of one reads right. The list's value is cached and `paused` while Home is hidden; the gate holds in that gap |
| PLANNER CALL 108 (new; O92) | Who says that Duplicate exists on a synced holding. Text a user reads: only help step 3 (PLANNER CALL 106). Test: no pin has a manual row on a holding that is both keyed and connected and asserts Duplicate: `bankCardHolding` has no key and `bankAccount` has no `institution` in `holding-detail.screen.test.tsx`, and Home's `h-uah` has no metadata. Flows: none; the Maestro flows are in `.maestro/`, not `e2e/`, and neither folder names Duplicate. Skills, for the scribe: kiko-design-system `component-set-forms.md` ("passes `onDuplicate` (manual rows)", "only a manual row is duplicable"), kiko-domain ("A manual write refuses a ledgerless holding" gains the gate). Comments in the same commit: `transaction-row.component.tsx`, `transaction-row.props.d.ts`, `holding-detail.screen.tsx`, `deletable.ts` (`isSyncedTransaction`'s comment). `docs/superpowers/plans/2026-10-14-help-flows.md` is a record, and it stays | `git grep -i duplicate -- .maestro e2e src/i18n src/help .claude/skills harness/kiko docs`. The count is a floor; the developer measures. The gate's seeds, by `git grep` at cb262751a: 18 test files call `recordManual`, `recordExchange`, `recordExchangeCounterpart` or `recordManualWithReturns` on the real repository or a fake database (was: a floor of 12, for `recordManual`). By reading, two seeds break, both in `transactions.repo.remove-cascade.test.ts`, and the plan names them |
| PLANNER CALL 109 (new; O92) | A `.kiko` restore can make `isSyncedHolding` true on an open form: yes, by reading, not run. `restoreDataSnapshot` replaces the tables and keeps `institution` and the keys, and neither it nor `import-data.screen.tsx` resets the navigation, so a form in a pane or under another tab stays mounted and its `useLiveQuery` reads the restored rows. A form on a holding that was disconnected in the old data and connected in the file then hits the gate, and PLANNER CALL 106's text is true there: the account reads as connected, even with no credentials in the file. No other change. A restore that takes the holding away keeps today's generic alert | `restoreDataSnapshot`, `runImport`, `restoreExportSecrets`. Same result for a fold that remounts the form from its draft |
| PLANNER CALL 110 (new; O92) | Three facts that the earlier calls did not state. (1) The ledger's menu tests the row's own holding, because a loan's page lists a payment stored on its payer. `isSyncedHolding(holding, account)` of the page would test the loan, and the payer's row would keep Duplicate. (2) A create Exchange's destination picker has no synced filter (`destinationOptions`, `exchangeIds` of a template). It is safe only because `createDestination` is true for `cash` alone, and no sync writes a `cash` holding: the gate now backs that. So "every holding picker leaves a synced coin out" (questions file) holds by type there, not by the filter. No change. (3) `recordExchangeCounterpart` keeps its own refusal of a synced counterpart, and a Convert form left open still shows "Please try again". That is shipped behavior with no row written, so it stays, and it is named here for the user (was; O94 fixes it in this step, PLANNER CALL 112). The gate does not cover `update`: an edit of a kept row stays, as the option says | `LedgerRowContext`, `ledgerHoldingName`, `isExchangeCreateDestinationType`, `cashDescriptor`, `recordExchangeCounterpart` |
| PLANNER CALL 111 (new; O93) | Three corrections to the Q-o proposal. (1) The refusal's draft says "this Kiko account" and "the first one". The policy says "There is no Kiko account to create", and the app says "this account" with "Bybit account" beside it, uk «рахунок» and «акаунт» (`exchangeSwitchRefused`, `bybitKeyNotMain`); and "first" is wrong after a second connect, because the value is the last connected owner's. The new draft is in section 8, with "Add a new crypto account" and «крипторахунок» as `addCryptoAccount` has them. (2) PLANNER CALL 104's `bybitKeyRejected` for an absent `userID` is false: its first words are "Bybit did not accept this key", and Bybit accepted it. `bybitRequestFailedNoCode` (O90) stays true, and it adds no text. The new text is also false there, since no other owner is shown. (3) The questions file says that a person with "a `.kiko` file and a script" can find the UID. A `.kiko` file is encrypted, so that person also needs the file's key, and the clause says so. It does not call the value safe, and it names the key because the file's readers are the ones who have it. The clause also changes the sentence "Kiko does not keep those details", which O93 makes false as it stands. A wrong number stays in one world: if the old UID holds nothing now, the old account's kept 1 X and 2 Y stay on Home until the user deletes them (row 35), as for any disconnected account | `privacy-policy.en.md` sections 1, 2; `exchangeSwitchRefused`; `addCryptoAccount`; `importData`'s `decryptEnvelope`; `signQuery`. Option A's "no wrong number" (questions file) needs that limit. kiko-translator: Кіко in Cyrillic, a final "." on a full sentence, no apostrophe here |
| PLANNER CALL 112 (new; O94) | Corrects fact (3) of PLANNER CALL 110, which said that a Convert's "Please try again" stays. Facts, by following the code. (1) `saveConvert` calls `recordExchangeCounterpart`. Its own check runs first and throws its own message, so the gate in `recordManualTransaction` never fires on a Convert: the same test, on the same holding, in the same transaction, passed one step earlier. The check stays and throws `SYNCED_HOLDING_REFUSAL`, because the `contribution` path does not call `recordManualTransaction`. (2) That check tests only the other leg. A Convert form whose own holding connects still saves: one new row on the other holding, and the existing row gets only the pair id (plus the marker when it is manual or imported). No refusal, so no hint. Only a card can be that holding (`isExchangeSourceType`), so of the four kinds only Monobank can. (3) When the other leg's holding connects, `resolveConvertView` drops it from the options, and `counterpartHoldingId` stays. So the picker reads "Select holding" with no error, Save sends the old id, and the writer refuses. The fixed leg shows an amount and no holding name. (4) `forms.transaction.syncedHoldingSaveError` is true of the write, as a Convert leg is a new row. It is not fit for this form: at that moment the form names no holding, so "a holding on this form" points at nothing, and on a synced card's row the user can read it as that card, and so as "a Convert never works here". It also hides the way out: "a retry fails until a disconnect" is false here, as selecting another holding saves. The namespace rule does not forbid it (`check:component-i18n-namespace` covers only `src/design-system/components/`), so a new key is for the words alone. New: `forms.transaction.syncedCounterpartSaveError`, section 8. "Exchange" and «обмін» are the form's words, for any two currencies: the button is `convertToExchange`, and the form shows no other word for this. After a save, a pair in one currency reads "transfer" in its row and in `deleteLinked.transfer`, a word the form never shows. "Select" and «Оберіть» are the placeholder's and `selectCounterpartError`'s. The accepted texts do not change. (5) After this step, no writer of this form shows the false hint: `recordManual`, `recordManualWithReturns` and `recordExchange` reach the gate and the accepted text; `recordExchangeCounterpart` the new text; `update`, `setCategory`, `setLoanPayment` and `undoAutoLoanLink` have no synced refusal. These four writers have no caller outside this form. Two other paths keep "Please try again." on a synced refusal, not in O94's scope, and named for the coordinator: `importRows`' `statement-import/synced-account`, in `statement-import.screen.tsx` and `column-mapping.screen.tsx`; and `accountsRepo.remove`, through `writeThenReplan` on the Accounts screen. `removeHolding`'s refusal shows no alert at all: `CardContextMenu` calls `onDelete()` with no catch, and its `deletable` reads the live list. (6) Other Convert worlds, no change: a counterpart that a restore takes away makes `saveConvert` return with no alert, as today. A split's return picker and the global Add's holding picker drop a connected holding as Convert's does, so the accepted text is true there and names no visible holding either: the user accepted it for those forms, and it is named here | `saveConvert`, `recordExchangeCounterpart`, `markExistingLegTransaction`, `resolveConvertView`, `HoldingSelectField` (`selected`), `ConvertExchangeFields`, `performSave`, `buildReturnOptions`, `buildPrimaryOptions`. By `git grep` at 770f99a65: the four writers' callers; each `new Error` that names a synced refusal in `src/`; each `saveErrorMessage` catch. Read, not run. The counts are floors. kiko-translator: `*Error` ends in ".", sentence case, Кіко in Cyrillic, no apostrophe here |
| PLANNER CALL 113 (new; O96) | The rule and the one place of each provider's key. `isSyncedHolding(holding, account)` holds only when `isSyncedAccount(account)` and the holding carries, as a string, the key of `account.institution` in a new map in `deletable.ts`: `syncedMetadataFieldOf`, `monobank` to `monobankId`, `btc_wallet` to `walletAddress`, `binance` to `binanceAsset`, `bybit` to `bybitAsset`, typed `satisfies Record<SyncedInstitution, SyncedMetadataField>`. It is keyed by the registry's id type, so it copies no id list, and a new id fails to compile until its key is written. A test pins each `BalanceProvider`'s `metadataField` to it (A155). `hasSyncedKey` stays "any key", as only the gate's test before its account read. REJECTED: a key field on `bankProviderRegistry` and `exchangeProviderRegistry`, because both are `Partial`, and `bybit` has no entry at 21b8a25a9, so a Bybit holding would read as manual; reading the provider objects from `holdings/`, because they bring the clients and the Keychain into every screen that imports `deletable` | Today no one source gives the key of a provider for all of them: each `BalanceProvider` has `metadataField` (`binanceProvider`, `bybitProvider`, `bitcoinWalletProvider`), `binance.walk-config.ts` repeats `'binanceAsset'`, Monobank's key is a literal in `upsertMonobank`, neither registry holds a key, and `syncedMetadataFields` is a list with no provider. `git grep metadataField` at 21b8a25a9; a floor |
| PLANNER CALL 114 (new; O96) | The consumers, by `git grep` of `isSyncedHolding`, `syncedHoldingIds`, `isSyncedAccount` and `hasSyncedKey` in `src/` leaving out the tests, at 21b8a25a9 (a floor). For a holding with the current provider's key, and for one with no key, nothing changes anywhere. For a holding with an earlier provider's key on a connected account (row 36), each of these changes from "synced" to "manual", with no change to its own code: the primary, return and Convert pickers and a template (`holding-options.ts`, `convert-view.ts`); the footer add (`footerAction`); Duplicate on Home and on the ledger row (the row's own holding, PLANNER CALL 110); the gate and the Convert check in `recordExchangeCounterpart`; the delete of a holding (`removeHoldingDatabaseTransaction`, `deletable` on the Accounts and account detail screens); Close (`closeActionFor`); the balance field (`isSyncedEdit`, so `updateWithBalanceDelta` takes the balance); and `notListedKeyOf`. Each of these does not change: every `isSyncedAccount` caller (the account remove, reminders' eligibility, `create-holding-target.ts`, `use-target-holding-options.ts`, the account detail, `importRows`), because the account is connected; `hasSyncedKey`; `conflictingExchangeHoldings`; the disconnect; the restore; every sync write | O96 named Duplicate, the save, the pickers and the add. Delete, Close, the balance field and the note follow from the same predicate: one rule, and two would let a holding be addable but not deletable. The coordinator tells the user. Each consumer's code read at 21b8a25a9 |
| PLANNER CALL 115 (new; O96) | No sync writes the balance of a holding with an earlier provider's key, so the rule gives no false "manual" world. `runBalanceSync` upserts by `provider.metadataField` and the account; Binance's and Bybit's `heldCoinsOf` zero only keys from `existingBinanceKeys` and `existingBybitKeys`; the wallet reads only `walletAddress`; `ensureExchangeHoldings` skips a `btc_wallet` account; a sync of the old provider needs `institution` equal to its id (`resolveTargetAccount`) and its credentials, which the disconnect cleared, and the disconnect reset its cursors. One write still reaches such a holding: a Binance walk in flight at the disconnect can end after the wallet connects, and `addManyDedup` has no `institution` gate, so its `binance` rows land on the old holding. They move no balance (`addManyDedup` never touches `holdings`), they are read-only, and the same rows land after a plain disconnect today: run-log gap 20261017T1639-kiko-binance-backfill-fix/1, left open. Edge worlds: two keys on one holding are synced when one is the current provider's; the current key on a coin no read writes (a Bybit coin set aside, a key `partsOfHoldingKey` cannot read, a closed wallet holding) stays synced, as row 34 has it; an `institution` that names no provider makes no holding synced; a `.kiko` file brings its own `institution` and keys and the same rule; a loan's payment reads its payer's account; a Monobank card and jar both carry `monobankId`, and only a file can put a crypto key on a bank account; `btc_wallet` is the one wallet chain. A later chain that reuses `walletAddress` would read the other chain's holdings as synced, so it needs its own key or a row in `CONFLICTING_FIELDS` | `sync.ts`, `binance.provider.ts`, `bybit.provider.ts`, `bybit.holding-keys.ts`, `btc-wallet.provider.ts`, `holdings.repo.ts` (`upsertByMetadataKey`, `ensureExchangeHoldings`), `disconnect.ts`, `addManyDedup`. Read, not run |
| PLANNER CALL 116 (new; O96) | No new text and no changed text. `forms.transaction.syncedHoldingSaveError` and `forms.transaction.syncedCounterpartSaveError` say "synced now", and after O96 they show only for the current provider's key, so they are true in row 36, where they were false. Help step 3, "unless its holding is synced", stays true. `accountDetail.exchangeSwitchRefused` stays true: it names holdings "from another exchange or wallet", not a synced state. Binance's `holdingDetail.exchangeNotListed.binance` no longer shows on a wallet holding, where it was false. Prose that O96 makes false, fixed in plan step 2/2: section 6.7's sentence, the comment in `conflicting-exchange-holdings.ts`, the comments on `syncedMetadataFields`, `isSyncedHolding` and `syncedHoldingIds` | `en.ts`, `uk.ts`; `.superpowers/sdd/1.4-bybit/texts-for-review-o93.md` gets no section 5 |
| PLANNER CALL 117 (new; review m2 of set 5) | `bybit-page-drift` joins the capital walk's forward owes list. The forward pass then commits the span of a drift in one series: the other series import, the drifted series owes the span as a range tagged with it, and the cursor moves on. Rule 22 says so (was: the forward pass held the cursor for all three series). The other Bybit walks (transfer, log, `fundingLedger`) are ruled by their own sets, on the same test | CODE: `driftOf` already tags each range with its series, so `isOwedPast` is true for it, and `stopsRun` in `commitSettledSpan` failed only because the code was not in `forwardOwes`. No shared code changes. What the user sees, a deposit route that repeats a cursor on every run: was, every later deposit, internal deposit and withdrawal is a missing row (a wrong past by their amounts, short spending), and the caption is up until the route heals; now, only the deposits of that span are missing, with the caption, and the rest import. A drift that heals clears on the next run under both (the owed pass reads the range in that series alone, as the re-scan test shows). Cost: each run reads the range in one series, inside the lane's 30 calls and after the forward pass; past `MAX_PENDING_RANGES` they merge (rule 24), as for an unreadable time (section 3, "Time unit"). A drift that never heals owes until the floor passes it (729 days) |
| PLANNER CALL 118 (new; review m5 of set 5; changes CALL 30 for type 50) | `depositType` 50 is final and owes nothing, whatever its status and time, read after 4 (nothing) and 70011 (removal by key). Types 10 and 20, and an absent or unknown type on a settled status, stay owed | QUOTE (changelog 2026-07-10, "Get Deposit Records (on-chain)"): "If a deposit is classified as "depositType" = 50, the funds will not be credited to your account. Instead, you'll need to log in to the Bybit website and withdraw the funds from there." So no row is right for it, and the wallet balance never holds it. QUOTE (changelog 2023-08-31): "You can process deposit assets when the deposit has daily deposit limit or abnormal deposit issue", so 10 and 20 can still settle. Was: a type 50 row kept the caption up for 729 days and cost 1 call per run, and the caption said a row was missing when none was owed. Now: no row, no caption, no call. If wrong (Bybit credits it later as type 0): inside the re-scan it imports; older, a missing row with no caption, the balance right. Open, Q-p: the web withdrawal of those funds, if the withdrawal route lists it, is a debit with no credit (no page says either way); this ruling does not change it |
| PLANNER CALL 119 (new; review of set 5, developer call (a)) | Status 4 owes nothing, and 70011 removes by key, whatever the `depositType`, an absent one too. Section 3, "Safe readings", and rule 13 say so; "an absent or unknown type is unreadable and owed" holds on a settled status only | The enum page names 4 as failed with no type rule; the code reads the status first, and the reviewer found it correct. Text only: no code or test changes |

Changed by the rulings of the builder check, the re-check and the user's answers (was: and now, per ruling that
reverses a row):

| Ruling | Topic | was: | now |
|---|---|---|---|
| O13 | Key at connect | only `readOnly` not 1 refused | also `isMaster` not true and a missing box |
| O13 | 10005 on a wallet | logged by code | a visible line names the wallet |
| O14 | Row wallet | FUND assumed; `depositType` stops the row | rule 45, one rule per probe outcome |
| O15 | Copy | E1 wording only | a clause per predicted outcome, one copy test |
| O18 | Earn sum | every row in the two categories | an allowlist of `status`, with O31 |
| O20 | P12 | an answer could set a floor | only a refusal moves a floor |
| O21 | Merge | set by set, each "shippable alone" | set 2 alone, sets 3 to 7 as one batch after the device pass |
| O23 | Terms verdict | set 7 reviewer checks | set 1; the browser step comes first; its timing, the O36 row |
| O24 | Counterparty text | "does not read" | "does not keep" |
| O25 | Read-only with no IP restriction | a known fact | UNPROBED(P1) |
| O25 | `bybitKeyRejected` and regional lines | "is not accepted", "cannot connect", "do not work" | "may not" |
| O26 | Text after the date | renew, the key stays | renew, or a new key if Bybit offers no renewal |
| O27 | `bybitCoinBorrowed` | "keeps its last balance" | a text with no last balance claim |
| O28 | Log tag re-pins | floor 6 in 2 suites | 27 lines in 10 test files |
| O29 (reverses the policy sentence of O21) | Policy step | set 3 step 1/6, because `privacy:site check` was read as a check at each tip | set 7 step 4/6, in the batch; set 7 compares `privacy:site hosts` with the md; the live check runs at publish only |
| O30 (replaces O17's double and PLANNER CALL 19) | Seams 3, 4, 9 and their reds | set 2, with a test double provider id | set 3 step 6/7, the step that adds the id, red first with the real id |
| O30 | Caption walks | `captionWalksOf` with no stated rule for a missing argument | a required parameter, no default to Binance |
| O30 | Binance's suites | "unchanged except the log tag" | so at set 2; at set 3 the status suites' calls gain the argument, same results |
| O31 | Earn row with no `status` | this rule edited after P3 | its `amount` adds; a redeemed row with no `status` and a non-zero `amount` stops FlexibleSaving, clause E4 |
| O31 | Redeem | R6, only if D ships | R4, with a P3 run |
| O32 (corrects O16's words) | Pending row with no time | "one owed point", A35 the same | the span owed as a range, the caption shows and is true; A35 a range; empty, 0, absent the same; out of the sort |
| O33 | `balanceNotes` | replaced by each balance read | per wallet: a read wallet replaces, a failed wallet keeps |
| O34 | Policy counterparty text | address, email, phone in every variant | M1 address only; M2 adds email and phone |
| O34 | Policy under E3 | the count of Earn positions kept | no count |
| O35 | Check on `UNPROBED` after the probes | falls to the stage C and D rows | also P5 and P17 rows; a row keeps its mark until its own probe runs |
| O36 | Terms verdict timing | when R1 and R2 are written | at once on the pasted sentences, before R1 |
| O36 | Set 2 base | "set 1 tip", not defined | the commit after the last step that writes results |
| O37 (Q1) | Stages in 1.4 | a default of A+B; A+B+C built set 8, all built sets 8 and 9 | A+B is the answer; stages C and D are deferred under Backlog, and no set builds them |
| O37 | Set list | 10 sets; the docs set was set 10 | 8 sets; the docs set is set 8/8 |
| O37 | Merge order | one row per Q1 value | one order: set 2, the batch of sets 3 to 7, then set 8 |
| O37 | User runs | R1 to R7 | R1 to R4 and R7; R5 and R6 are deferred under Backlog |
| O37 | Probe parts | P1 to P18 | P1 to P7, P11 to P18; P8, P9, P10 are deferred under Backlog |
| O37 | R4 | P10 ran, and K11 came after it | no P10; K11 is last, with its P3 run (O31) |
| O37 | Copy and policy | a variant per stage, with "A only" rows and a "Q1 = A" row | the A+B text is the text; the variants per probe outcome stay |
| O37 | Rule 25, retention | the log's QUOTE, "the other three" | no stage B series has a stated retention; the QUOTE moves to Backlog |
| O37 | Check on `UNPROBED` after the probes | the stage C and D rows, and P5 and P17 rows | P5 and P17 rows, rule 47 if the window is missed, and the deferred rows under Backlog |
| Q2 | Expiry notification | a measured default, open to the user | no notification (section 7); the measured cost is under Backlog |
| Q3 | Two ledger gaps | put to the user, default accept | accepted limits (section 13) |
| Q4 | Ship before R7 | ship or hold, the user's | 1.4 ships before R7; R7 and P17 stay an open check after the ship, marked UNPROBED(P17), with the copy of O26 |
| O38 | Order of the first steps | the approval and the reviewed script came before the browser step | the browser step and the verdict come first; the script is written and reviewed meanwhile |
| O38 | A terms page that needs a login | it waits for R1, and the reviewer reads it before R2 | no account; the verdict is blocked on that page, and the coordinator takes it to the user |
| O38 | Plan set 1 step numbers | script 1/7, test 2/7, read 3/7, browser 4/7, verdict 5/7 | browser 1/7, verdict 2/7, script 3/7, test 4/7, read and hand-over 5/7 |
| O39 | Terms verdict | the planner's reading; the verdict to come on the user's pasted sentences | PASS WITH CONDITIONS for global accounts, FORBIDDEN for Bybit EU (EU 7.4); conditions C1 to C5 and C7 in section 9, C6 in section 10 |
| O39 | Browser step, part 1 | the user pastes sentences; a page that needs a login blocks the verdict (O38) | done 2026-11-03: the coordinator read the pages in the Orca browser at the user's word, no login was needed; the login case goes |
| O39 | Bybit EU in the copy (reverses O25 for Bybit EU) | `bybitConnectLimits`, `bybitKeyRejected`, the footer and the help step: "may not" for Bybit EU too | Kiko does not support Bybit EU accounts; "may not" only for other regional sites; A51 |
| O39 | Help step opening | "use a global account" | "Kiko works only with global accounts": no workaround text |
| O39 | A13 | "a regional key may not be accepted" | a wrong key, Bybit EU as not supported, another regional key as may not |
| O39 | Clause 6.5 | broadest clause, answered with "no trading" | not forbidden, but real doubt; Global 7.6, API 7.6 and 10.1 stated |
| O39 | Clause 6.7 | "nothing is resold" | "repackage" answered too: each user reads only their own data with their own key |
| O39 | Clause 6.9 | a paid tier re-opens it | not forbidden while Kiko earns nothing from the API; a price, ad, IAP, tip, sponsor or affiliate code re-opens it (C3) |
| O39 | Brand | "No Bybit brand rule was found"; "no name clause" stated with no limit; "no brand page found" | Global 40.4(e) is a brand clause; "no name clause" holds for the API Terms PDF only (C4) |
| O39 | Ukraine and displaced users | the restricted list of a help article; a Ukrainian in the EU UNVERIFIED, with no narrowing | Global 3.4 and EU 4.3.5 read; INFERENCE and UNVERIFIED stay; the EU row narrows by EU 4.2, 4.3.5, 4.3.7; no region check |
| O39 | Acceptance rows | A1 to A50 | also A51 to A56 (C1 to C5) |
| O39 | Plan set 8 | "kiko-compliance (the terms verdict, pins)" | a dated Bybit block like the Binance one, with C7's re-read and a 5.2.2 item |
| O40 (reverses PLANNER CALL 24) | R4's condition | at least a day after K4 | after the R3 run of P3 shows the position; no fixed day |
| O41 (accepts PLANNER CALL 23) | R1 and the spec approval | a planner call, not yet ruled | the user's approval comes after the verdict, before R1; R1 waits for it |
| O42 (replaces the "Open" sentence of O39) | Guideline 5.2.2 and the API 6.5 doubt | an open question, with the coordinator for the user; a letter to Bybit as an option | no question: both doubts stay open and are accepted by the user; keep Bybit, global accounts only, no letter to Bybit |
| O45 | A `retCode` in the output | no rule on the server's text | a word from a closed table, or the code alone; no server text |
| O46 | A value in the output | "an allowlist decides", and a pattern passed | a closed list per field; an unknown value prints `<other>`; the residual on a field name is accepted |
| O47 | "Which wallet" and rule 41 | one row against one balance; "the output names each source wallet"; amount vs fee | two balance readings around the user's step, in P4 and P6; the output names the wallet that moved by its words; change equals amount, change equals amount + fee, per wallet |
| O48 | P13 "filter field" | no stated meaning | the time field that `startTime` and `endTime` filter on, tested on the withdrawal series; no coin filter; `R2 P13` once more after K6 |
| O49 | P14 | one call; R1 proves no-P2P; it unlocks the O5 text | NOT RUN, closed by GET only and C2; the O5 text rests on the docs line |
| O50 | K3 cancel, K4, K5, K11 | done before the run | at the prompts of P2 and P3; a plain `R4` has no redeem prompt, and K11 goes through `R4 P3` |
| O50 | `locked` inside `walletBalance` | proved at R2 | proved at R3, around the cancel of K3 |
| O76 | `locked` inside `walletBalance` | "proved at R3" (O50), or "the page's sum reads so" (PLANNER CALL 32) | never proved, and no reading comes: the docs do not state it, and the coin is set aside |
| O51 | Coin, `permissions` and wallet-hint values | a closed list for every value; the shape test reported as a disagreement | those three keep a shape test, an accepted residual stated in section 10 |
| O52 | A missed K1 window | no reading for the deposit half of rule 45 | `R2 P2` BEFORE K2; if that is also missed, the deposit half of rule 45 stays UNPROBED(P4) |
| O53 | Calls per part | a fixed number | a maximum number of calls per part, and the hard cap; still one bounded run |
| O54 | P3's double-count answer | direction alone | on a position rise, the stake check on amounts, yes or no; K4 and K5 stay on one prompt |
| O55 | R7 | on the date `expiredAt` prints; 6 calls; `expiredAt` moved by two readings | the day after that date; up to 6 calls; ok prints "not expired yet" and ends; an answer that cannot be about expiry makes no prompt and no renewal; `expiredAt` moved against the date P1 printed |
| O56 | The review of the probe script | a reviewer pass before the handover | no pass: three reviews each gave FIX FIRST (17, 9 and 6 findings), the chain stops after fix round 4, and the orchestrator reads the round 4 diff and the whole final script (O58) and runs the test; the accepted residuals are in section 10 |
| O57 | P17: which answers stop it, and which ok ends it | HTTP not 200 stops, HTTP 401 too; no `retCode` stops at any HTTP; 10002 and 10004 stop; an ok first call prints "not expired yet" (O55) | HTTP other than 200 or 401 stops; no `retCode` stops only with HTTP 200; 10002, 10004 and 10016 stop, and a `retCode` rule wins over HTTP 401; HTTP 401 otherwise goes on to the prompt; an ok from any of the first three calls prints "not expired yet" and ends with no prompt |
| O58 | O57's stops, the whole-file read, the limit per part, the O56 items, rule 41 | no rule on which answer the stops of O57 read; the whole-file read of section 10 not done; "a maximum number of calls per part" with no source for it; the O56 items with no owner; rule 41: P4 and P6 compare `amount`, and `amount` + fee | (a) the stops of O57 apply to the `query-api` answer only: a later HTTP 500 or 10002 on UNIFIED or FUND still reaches the prompt, and only that route's reading before the renewal is lost; accepted under the stopping rule of O56, no script change. (b) the orchestrator read the whole final script (1,379 lines) on 2026-11-04 with no blocking defect: a read, not a review, and it does not replace the reviewer pass that O56 stopped. (c) the script has no limit variable per part: the maximum per part follows from the code, with no paging loop, and `CALL_CAP=150` per run is the only enforced limit. (d) the O56 items are accepted residuals in section 10, and the report puts them to the user with the spec approval (O41). (e) rule 41: P4 also compares `amount` - fee, and P6 does not |
| O60 | Static copy of the key's term | "90 days" | "about 90 days": the first reading is about 92 calendar days; state and dates read `expiredAt` only |
| O60 | Needed boxes | from P1 and P11 | not knowable from them for UNIFIED (second key: 10005); section 6.8 |
| O61, O62 | Q1 | A+B, then N1 (balances only), by O61 | A+B without the user's money; O62 replaces O61 (a) and (b) |
| O62 | "Tested" | a kind ships only after a pass on the small account on device | docs only rows ship from the live pages; UNIFIED and FUND rest on the docs and the empty read, and Earn is not read (O75; was: the empty read and testnet) |
| O62 | Real-money runs | R2, R3, R4 gate sets 3 to 7 | later, no date, the user's choice, under Backlog; no code waits |
| O62 | Set 1 tip | the commit after the results of R3 and R4 (O36) | the commit of this text (PLANNER CALL 33) |
| O62 | Rule 45 | outcome by P4 and P6 | outcome (b), FUND, clause W1 |
| O63 (b) (reverses CALL 28, and O32 in part) | Rule 47 | O32: a pending row with no time owes its span as a range in every series, and the caption shows. CALL 28: no row, nothing owed, no caption | no row; the span owed as a range in the `deposit` series; the caption shows; the other series go on (PLANNER CALL 37) |
| O63 (a) | Internal deposits (not words of O62) | read only with a real sender (O15), clause M1 | docs only, clause M2 (PLANNER CALL 31) |
| O63 (a) | Connect (not words of O62) | `permissions` checked by box (O13) | one real read per shipped route (PLANNER CALL 25) |
| O62, PLANNER CALL 27 | Holding footer | `earlierHistory` shows for each exchange | off for Bybit (PLANNER CALL 27); clause F1 added |
| O63 (c) | Scratch build | on the user's phone, then deleted | the simulator, or a named device with no real data, by UDID; never the user's phone |
| O63 (d) | A waiting row | "a caption", "not a number" | a missing row: a wrong past by its amount, and short spending |
| O63 (e) | Set 1 tip | 7a2391ca8 | the commit of this fix round (F7) |
| O64 | Q5 | open, with "this text assumes A" | answered "E + A": stage E in one release, set 9 |
| O64 | The log allowlist | a `type` seen on the small account imports | a closed list of 68 words from the page; only spot `TRADE` imports; other words are named by kind, never parsed |
| O64 | Goal 3, now goal 4 | no line where the past is drawn | `statistics.bybitPastLimits` (PLANNER CALL 45) |
| O64 | Probe parts | P8 and P9 reserved under Backlog | in the script from set 1 step 11/11; run on the empty account only (O75) |
| O64 | Sets | 8 sets, order 2 to 8 | 9 sets, order 2, 3, 4, 5, 6, 9, 7, 8 (PLANNER CALL 43) |
| O64 | Lane caps per run | 50 gated plus 5 | 80 gated plus 5 |
| O64 | Connect calls | 7 or 9 | 9, 10 or 11 |
| O65 | Q6 | open, with "this text assumes A" | answered "B: Add to 1.4": stage F, set 10 |
| O65 | CALL 46 | `/v5/asset/fundinghistory` stays out, under Backlog | read, and a row lists by rule 51 |
| O65 | Migrations | none in any set | one, set 10 step 1/6 (PLANNER CALL 51) |
| O65 | Sets | 9 sets, order 2, 3, 4, 5, 6, 9, 7, 8 | 10 sets, order 2, 3, 4, 5, 6, 9, 10, 7, 8 (PLANNER CALL 59) |
| O65 | Lane caps per run | 80 gated plus 5 | 100 gated plus 5 |
| O65 | Connect calls | 9, 10 or 11 | 10, 11 or 12 |
| O66 | The log's split (N1) | a day; a day over 1,000 log rows held the lane for good | 1 minute with a plain hint; 1,001 rows take 9 to 30 runs and 100,000 rows take 167; a burst inside a minute holds it (PLANNER CALL 63) |
| O66 | A double count (N2) | "cannot happen" for a convert; a summary row only noted | "under the pages"; a `tradeId` guard; two named rows (PLANNER CALL 64) |
| O66 | A failed spot shape (N3) | a point per row, about 210 KB on the busy seed | one tagged range, at most 12, about 1 KB (PLANNER CALL 65) |
| O66 | Convert owed points (N4) | replaced at the end of a pass, with no store | the mark `passOwed`, bounded (PLANNER CALL 66) |
| O66 | A convert page past the end (N5) | a repeat is `bybit-page-drift`, no mark moved, the caption up for good | each form ends the pass; the ledger's convert gate holds a row only under W old (PLANNER CALLS 67, 68) |
| O66 | A leg that rounds to 0 (N6) | not written, nor its pair | "nor its pair" for a convert leg only |
| O66 | Kept ids (N7) | `exchangeTxId` only in the pair id; the policy names imported records | also in a refused convert's entry; the policy names it, en and uk |
| O66 | Clause L1 (N8) | no loans, stocks, card moves or sub-account moves; word for word on Statistics | named in L1 and L1S; L1S alone on Statistics (PLANNER CALL 69) |
| O66 | A35 (N9) | no 70011 fixture | a 70011 with no time removes its row |
| O67 | Q7 | not written | answered: Earn only if testnet shows the words, otherwise clause "E2 and E4", except E3 (PLANNER CALL 74) |
| O69 | Q-b | open, with a default | answered: "A: Accept" |
| O75 | The testnet run | set 1 step 9/11, the proof of `locked`, Earn and coin rows | closed at Part A; clause "E2 and E4"; `bybitEarnLeftOut` removed; one device build; a row for 10024 |
| O76 | O73 (b), an empty loan field | UNVERIFIED, and it blocks the set 7 device build | "Keep refusal", and the block goes |
| O76 | O73 (c), refused amounts | reuse `oversizedBalance` | `refusedCoins` and `bybitCoinRefused` (PLANNER CALL 81 reverses O73 (c)) |
| O78 | The past line | moves against an old balance; a fix owed before set 6 | set 11, before set 5: `balanceReadAt` (PLANNER CALLS 86, 87, 89; Q-i is the user's, answered by O85) |
| O83 | O80 F4, the not-read block | counts the history list | counts the balance list (PLANNER CALL 88) |
| O85 | Q-i, the line for a coin not read | OPEN; set 11 step 3/5 waits | "A: Hold last read" |
| O85 | Q-i, the Statistics sentence, L1S | none, a DRAFT; 334 en, 357 uk | "Add sentence", approved; 444 en, 499 uk |
| O87 | Who decides the date's write | the optional field `datesBalance` on the provider, beside the list | the list `datedBalances` alone, by `provider.metadataField` |
| O68 | The pairing (F1) | nearest first alone; a double with no delay past W | nearest first, then repair (PLANNER CALL 70) |
| O68 | Reconcile (F2, F8) | every verdict that left `listed` removed the row; every listed row upserted per run; no prune | `waiting` removes nothing; only the difference is written; a prune at the floor minus 2 W (PLANNER CALL 71) |
| O68 | The migration (F3) | set 10 step 1/6, 0064 at that writing; "no removal row is needed" with a phone already on an unmerged migration | set 2 step 5/5, in `next` before any device build (PLANNER CALL 72) |
| O68 | The split (F4) | 1 minute; 1,001 rows in 1 s never commit; a false caption on a burst | 1 second; 35 runs; `bybitHistoryDense` on a real stop (PLANNER CALL 73) |
| O68 | L1, L1S (F6, F7) | 555, 297 characters; no double count and no Earn stake in L1S; "list them all" | 596, 334; both named; "say more" |
| O68 | A negative or zero `txnAmt` (F9) | signed by direction | owes the tagged range; P19 prints the sign class |
| O68 | The convert's owed ground (F10) | no age limit | holds only a row under W old |
| O68 | The caption on a new ledger row (F11) | "is up" | none within H; up when a series is over a day behind |
| O68 | The stored set (C1) | columns not listed; words read at each reconcile; policy without fee and tax | twelve columns; one boolean; fee and tax in the policy (PLANNER CALL 75) |
| O65 | Clause L1 | "Kiko cannot read" each kind, on any wallet | Unified and Funding apart; no gap called closed |
| O65 | "What stays wrong" | a stake from Funding "cannot be closed"; P2P always +100 | closed under "E2 and E4", and if the ledger lists it; six new rows |
| O65 | Q3 (a) and (b) | a late rollback leaves a stale row; a stalled day holds its own walk | a late rollback's Out cancels it, if listed; a stalled source day also holds the ledger's later rows of its direction |
| O64 | Copy | "does not read trades, converts" | spot trades and converts read; clauses F2 and L1 |
| O64 | Rule 12 | every row exact at the scale | a log `change` and a convert amount round (PLANNER CALL 42) |
| O92 | Duplicate, and a manual write on a synced holding | offered on any manual row, and the repository has no gate; O91: set 11 is Bybit-only | no Duplicate and a gate at save on every synced holding, and a disconnect brings Duplicate back; the one exception to O91 |
| O93 | A key of another Bybit account; `userID` | the key connects; `userID` is never parsed | the key is refused while the account keeps its Bybit holdings; a value made from `userID` stays in `exchange_state` and `.kiko`, and the policy says so; A31 holds |
| O96 | A holding with an earlier provider's key (row 36) | synced while its account is connected to any provider: no Duplicate, no add, out of the pickers, refused at save, no delete, no Close, no balance field | manual: a holding is synced only with the key of its account's current provider (PLANNER CALLS 113 to 116); the four pairs of O92 stay synced |
| PLANNER CALL 117 | Rule 22, a capital page that drifted in the forward pass | the cursor holds for all three series; every later capital row waits | the drifted series owes the span as a tagged range; the other series commit and the cursor moves on |
| PLANNER CALL 118 | Rule 13, `depositType` 50 | owed: its point, or its span with no time; the caption up and 1 call per run until the floor | final: no row, nothing owed, no caption |
| O59 | The user's spec approval (O41) | not given, so R1 waited for it | given on 2026-11-04: the coordinator relayed the answer "Approve (Recommended)" to the question in the approval report, at tip fc83566e2; the report named four residuals (O51, O46, O56, O58 (a)); R1 has not run; the coordinator gives the user the R1 list and the four residuals, and no other step starts until the coordinator says that the R1 output file is ready |

| Id | Conflict | Kept |
|---|---|---|
| CONFLICT 1 | O7 asks a failing-first test for each of nine seams; seam 8 has no behaviour to change, so a parent red cannot exist | The ruling's row stands; its test is proven by a scratch mutant, per kiko-testing "load-bearing" |

## 13. User questions (Q1 to Q7, Q-b, Q-h, Q-i, Q-j, Q-k, Q-l, Q-m, Q-n and Q-o answered)

| Question | The user's words, 2026-11-03 | What holds now |
|---|---|---|
| Q1: which stages ship in 1.4 | Was: "Q1 A+B." Then "1 N1, 2 later" (O61). Then, 2026-11-04: "Let's rephrase this: I can't spend money testing what's already covered by api documentation, so implement what you can without relying on my money" (O62; the coordinator's reading was told to the user, who can overrule it). Then Q5 "E + A" (O64) | Balances, deposits, withdrawals, transfers, spot trades and converts. Rows ship docs only, and balances rest on the docs and the empty read (O75). Earn is not read. The rest of the log and stage D are deferred under Backlog (O37, O64) |
| Q2: how the user learns of the 90-day expiry | "Q2 detail line + failure text only." | Section 7. No notification |
| Q3: two ledger gaps with no effect on any balance | "Q3 accept the two gaps." | Accepted limits for 1.4, reopened only on a measured case. (a) A deposit rolled back after the 29-day re-scan keeps its row; a longer re-scan would cost 3 more calls per extra window on every run. (b) A day with more rows than a run's calls (1,000 transfers or about 1,400 of one capital series) holds its walk, with the caption up; a higher cap would load a pool shared with other accounts |
| Q4 (F2): may 1.4 ship before R7 proves renewal after an expiry (about day 90 of the first key) | "Q4 ship before a real expiry proves renewal, with text that fits both outcomes." | 1.4 ships with the copy of O26. R7 and P17 stay an open check after the ship. Renewal after the date stays UNPROBED(P17) until R7 runs |
| Guideline 5.2.2 and the API 6.5 doubt (section 9) | "The user in EU can't obtain API key, hence adding bybit to kiko is pointless. Continue."; then, asked which reading, the user picked "Keep Bybit, global only" | Keep Bybit, global accounts only, no letter to Bybit. Both doubts stay open and accepted (O42). No question is left open |

Q5, ANSWERED 2026-11-04 (O64): "E + A". Q3 accepted "two ledger gaps with no effect on any balance", and the code shows that a row
feeds the past of the net-worth line and spending (section 3), which Q3 did not say. So Q5 asked with the worked example, and the record of what the options were (report-q5.md):

| Option | Past line of the worked example, before the deposit, then deposit to trade, then after | What stays wrong | Taken |
|---|---|---|---|
| A: deposits and withdrawals, no trades | p - 100, p, p | The trade offset: a past below zero is drawn, with no fixed bound, ending after the last trade; a late rollback; rows that wait; P2P; Q3 gap (b) | With E |
| B: withdrawals and transfers, no deposits | Worse than A, with a false step on each deposit | As A, and every deposit | No |
| C: balances only | p, p, p | Units at today's amounts, value at each day's price: a false step on a move between exchanges; no Bybit lists; spending short by every withdrawal | No |
| E: trades and converts too | 0, 100, p | Section 3, "What stays wrong" | Yes, in one release |

The rows above show each option under the same example. Option D (rows in the lists, out of the line) was rejected by review, with C's past (report-q5.md). Q3's two gaps stay accepted, now with their effect stated. Gap (b) does not grow by the log (O66 (a); was: it grew by the log; section 5). The log's own limit is the burst row of "What stays wrong".

Q6, ANSWERED 2026-11-04 (O65): "B: Add to 1.4". `/v5/asset/fundinghistory` (PLANNER CALL 46) reads Funding's whole ledger. The options were: (A, was recommended) keep it under Backlog and ship 1.4 with L1 as it stood; (B) add it to 1.4 as a read that lists only what no other series explains, by a match on coin, direction, amount and time, where a wrong match is a double count in the past. Section 3, "Stage F" holds the rule. The words of that option "it closes most of P2P credits and yield" are not carried over: no page shows a P2P row.

Q7, ANSWERED 2026-11-04 (O67), and now C (O75: the testnet step failed): "B: Only if testnet shows (Rec.)". Kiko reads Earn only if the testnet run shows the words. If the testnet step fails, this becomes C: Earn is not read, the balance omits Earn money, and a UI line states it. A word that testnet did not show still doubles on mainnet, which the user read as the residual of B. One branch is new since that answer: when P3 shows E3 and testnet does not show the words, E3 stays, and that row is named (section 10, "What proves Earn"; "What stays wrong"). The report tells the user.

Q-b, ANSWERED 2026-11-04 (O69): "A: Accept (Recommended)". Two double counts have no sign and no guard: a summary row that holds a `tradeId`, and a convert also shown as a spot `TRADE` (section 3, "What stays wrong"). No page states either.

| Option | What it means | Past line | Taken |
|---|---|---|---|
| A (default, recommended): accept | Spot trades stay. Clauses L1 and L1S say "can rarely count a move twice" (F7) | True, except in those two worlds: 3 - .003 p before the trade, or 100 - p before the convert | Yes (O69) |
| B: cut spot trades | The log imports no trade. Converts stay | Reads as option A of Q5: p - 100, p, p, for every trade | |

No free read tests it now (O75; was: P8 and P9 on testnet). A real row that shows either world brings the question back.

Q-h, ANSWERED (O78, 2026-11-05, relayed by the coordinator; was: OPEN). The user's words: "A: Unchanged". On an account where every coin is set aside, the account detail now says so (section 3). Home and the accounts list show no sign, as for any coin set aside. They stay as they are (was: "Default: they stay as they are"). A mark on the card is new UI, and it would be the first of its kind.

Q-i, ANSWERED (O85, 2026-11-05, relayed by the coordinator; was: OPEN, O78). The user's words: "A: Hold last read". The question: what the net-worth line shows for a coin whose balance Kiko could not read. Example: hold 1 X, an order fills 0.2 X, and the truth is 1, then 0.8. No option is right in every case while the balance is unknown (section 3, "The past line while a balance is old"). The user saw the residual of row 14 as "5 s", which is too small (section 3, "Row 14 on the code"). Was: set 11 step 3/5 waits for this answer. Binance, a separate track, the user's words: "Same fix after Bybit".

| Option | The line | Consequence | Recommended |
|---|---|---|---|
| A: hold at the last read. CHOSEN (O85) | 1, then 1. On a first sync the coin is not on the line | The past up to the read is right. The last point always equals Home. A sold part stays on the line until the first good read, as it does on Home. Never below zero by this cause | Yes |
| B: rows keep moving the line after the read | 1, then 0.8. On a first sync the coin is still not on the line | Right here, but only when every row since the read has arrived. It can go below zero when one list is behind another. The last point differs from Home while the coin is set aside, and the invariant "the line ends on Home's number" gets an exception. Costs about 15 more code lines and 60 more test lines | |
| C: the coin is flat while set aside, with a text | 1, then 1, and flat for the whole past | Nothing below zero, but a standing order wipes the coin's real past from the line for as long as it stands. Costs about 35 more code lines | |

A second part of Q-i: a line on the Statistics screen. ANSWERED (O85). The user's words: "Add sentence", the en and uk approved as shown. Was: a DRAFT for the user's review, with the default of no line, as Q-h keeps such signs to the account detail. The Statistics screen is where the flat stretch shows, and `statistics.bybitPastLimits` is already there. Approved text, now the end of clause L1S (section 8), which holds the counts:

| en | uk |
|---|---|
| A coin Kiko could not read stays on this line at its last read balance, or stays off it with no earlier sync. | Монета, яку Кіко не зміг прочитати, лишається на цій лінії з останнім прочитаним балансом, а без попередньої синхронізації її на лінії немає. |

Q-j, ANSWERED (O88, 2026-11-05, relayed by the coordinator; was: OPEN, for the user through the coordinator). The user's words: "C: By mark". It goes into the set 11 fix round. A restore must be proved to keep row ids (A128). F2 of the review of set 11; section 3, row 15: what the line shows after a manual row on a disconnected Bybit holding, once a reconnect and a good read overwrite its balance. Example: read 0.1, disconnect, manual +0.5 gives 0.6, reconnect, read 0.1. Before O88 the line showed -0.4, then 0.1. Kiko cannot know if the 0.5 ever reached Bybit. If it did not, the truth is 0.1, 0.1. If it came and left before the read, the truth is 0.1, 0.6, 0.1. This holds no set. Sizes are floors.

| Option | The line | Against the truth | Size | Binance, Monobank | Recommended |
|---|---|---|---|---|---|
| A: by date. On a Bybit holding, a row that is not `source: 'bybit'` counts only when it is dated after the last read | 0.1, 0.1 | Right if the 0.5 never reached Bybit. It misses the rise if it came and left. It breaks a world that is right today: read 1, disconnect, a row of +0.5 typed after the read and dated before it. The line shows 1.5, 1.5; today, and the truth, 1, 1.5 | 3 code lines, 40 test lines, in `rowsHeldByBalance` | No change. Binance takes it with its list entry. Monobank stays at -0.4 | |
| B: a balancing row. The read's write adds one `setsBalance` row, `source: 'manual'`, dated at the read, of minus the sum of the rows that are not `source: 'bybit'` | 0.1, 0.6, 0.1 | Right if it came and left. If it never reached Bybit, the rise stays, as the user typed it. The user sees a row in the holding's list that the user did not type, and its delete moves the balance. Spending and the loan matcher skip it (`balanceSetIdsOf`, `setsBalance`) | 40 code lines, 150 test lines, in `upsertByMetadataKey`, behind the list | No change. Binance takes it with its list entry. Monobank stays at -0.4 | |
| C: by mark. CHOSEN (O88). The read's write stores in the holding's metadata the ids of the rows that are not `source: 'bybit'`, and the valuer drops those rows from the line. A row typed after the read counts, whatever its date | 0.1, 0.1 | Right if the 0.5 never reached Bybit. It misses the rise if it came and left. The world of option A stays right: 1, 1.5. The row stays in the list, and only the line skips it | 30 code lines, 150 test lines (was; the plan's sizes now hold it): `upsertByMetadataKey` behind the list, `id` on `SeriesTransaction` (was: and a key in `carriedMetadataKeys`, PLANNER CALL 92). No migration. The developer proves that a restore keeps row ids | No change. Binance takes it with its list entry. Monobank stays at -0.4 | Yes |

Why C: it is the rule of PLANNER CALL 87. A read replaced the balance, so the balance does not hold those rows. It shows no number that the app does not hold as a fact (O62), and it adds no row the user did not type. Was: "and it breaks no world that is right today", which is false: row 20, PLANNER CALL 93, Q-l. Each option also fixes the other sign: read 1, manual -0.5, reconnect, read 1 shows 1.5, then 1 before O88; A and C show 1, 1, and B shows 1, 0.5, 1. A second part of Q-j, ANSWERED (O88): Monobank, "Design a fix in 1.4". This track holds no part of it: the coordinator gives the Monobank design and the Binance same fix to a separate small track, which starts after this set's re-review. Section 3 names the code it can reuse. Monobank has no `balanceReadAt` and keeps today's numbers under each option, so a Monobank fix needs a date of its own. Was: "a question for the user, with its own ruling".

Q-k, ANSWERED (O89, 2026-11-05, relayed by the coordinator; was: OPEN, for the user through the coordinator). The user's words: "A: No balance move". It goes into set 11, as fix round step 3/3. The scope beyond Bybit was not ruled: Q-m. Section 3, rows 16, 17, 25 to 33; PLANNER CALLS 94 to 99. The question: what Home and the line show after the user deletes or edits a row that a read already overwrote. Example: read 0.1, disconnect, manual +0.5, reconnect, read 0.1, then delete the +0.5. The truth is 0.1. Before O89, Home showed -0.4 until a good read, and for good if the account is disconnected or the coin stays set aside. An edit to +0.7 showed 0.3, and an edit to -0.5 showed -0.9. These numbers hold today on every exchange holding, so the mark did not make them worse. Sizes are floors.

| Option | Delete, then edit to +0.7: Home and line | Against the truth | Size | Recommended |
|---|---|---|---|---|
| A: a row on the mark moves no balance when it is deleted or edited. CHOSEN (O89) | 0.1, flat; 0.1, flat | Right. The list shows the row as +0.7, and Home does not follow it, because the read holds the balance. A leg's other holding still moves on a delete. An edit never moves a partner, as today. Spending follows the row, as for any row | 25 code lines in `holding-metadata.ts` and `transactions.repo.ts`, and 350 test lines, the plan's step 3/3 (PLANNER CALL 95). Was: 15 code lines in `transactionsRepo.update` and `removeRowsDatabaseTransaction`, which already read the holding, and 120 test lines. A holding with no mark takes today's path. No migration. No text | Yes |
| B: no change | -0.4, flat; 0.3, flat | Wrong, and below zero on Home, until a good read | None | |
| C: refuse the delete and the edit of such a row | 0.1, flat; 0.1, flat | Right, but a mistyped row stays in the list and in spending for good, with no way to remove it | 40 code lines, a new text in en and uk, a translator review | |

Q-l, ANSWERED (O89, 2026-11-05, relayed by the coordinator; was: OPEN, for the user through the coordinator). The user's words: "A: C stands". Section 3, rows 20 and 21; PLANNER CALL 93. No code changes for it. The user ruled Q-j on the text "it breaks no world that is right today", which is false. Example: read 1, disconnect, a typed +0.5 for a move that really arrived, reconnect, read 1.5. Today the line is 1, 1.5, and that is right. Option C shows 1.5, 1.5. If a walk also writes the move, today's line is 0.5, 1.5, and option C shows 1, 1.5, which is right. Sizes are floors.

| Option | Row 20: no walk lists the move | Row 21: a walk writes it too | Size | Recommended |
|---|---|---|---|---|
| A: option C as ruled. CHOSEN (O89) | 1.5, 1.5: wrong before the row's day, never below zero by this cause | 1, 1.5: right | None | Yes: the walks list most moves, and a disconnect sends them back to read again |
| B: a read equal to the stored balance leaves the typed rows off the mark for good | 1, 1.5: right | 0.5, 1.5: counted twice. With read 0, +1, read 1: -1, 1, below zero | 15 code lines and 80 test lines. The upsert compares the balances and joins the list, it finds "typed since the last read" by `createdAt` against `balanceReadAt`, and that adds a second reader of `balanceReadAt` | |

Q-m, ANSWERED (O91, 2026-11-05, relayed by the coordinator; was: OPEN). The user's words: "A: All three". The coordinator's separate track takes Binance, Monobank and the wallet, and set 11 stays Bybit-only, with one exception, and the rest of O91 stands: O92's Duplicate gate is on every synced holding, in set 11, because it reads no mark and changes no balance rule (Q-n). Section 3, row 33; O89. Q-k ruled the rule on a Bybit holding, and the user did not rule the scope beyond it. Fix round step 3/3 changes no value on any other holding. The wallet is new here: the user heard "every exchange holding", and a wallet is not one. Example, on a Binance, Monobank or wallet holding: read 0.1, disconnect, manual +0.5, reconnect, read 0.1, then delete the +0.5. The truth is 0.1. Home shows -0.4 until a good read, and for good while the account stays disconnected. The separate track of O88 can hold the fix; this track does not. Sizes belong to that track's plan.

| Option | Binance | Monobank | Wallet | Recommended |
|---|---|---|---|---|
| A: the same rule on all three, in the separate track. Each kind gets the mark first. CHOSEN (O91) | 0.1 | 0.1 | 0.1 | Yes: one rule for one fault |
| B: Binance and Monobank only | 0.1 | 0.1 | -0.4 until a good read | |
| C: Bybit only | -0.4 until a good read | -0.4 until a good read | -0.4 until a good read | |

Q-n, ANSWERED (O92, 2026-11-05, relayed by the coordinator; was: OPEN). The user's words: "A: Remove Duplicate", scope "Every synced holding". It goes in set 11, before READY, not in the separate track. This is the one exception to O91's "Set 11 stays Bybit-only": the gate reads no mark and changes no balance rule, and the rest of O91 stands. Binance, Monobank and wallet menus change too. Section 3, row 34, and "The hold menu of a row after O92"; PLANNER CALLS 100 to 102 and 106 to 110; the questions file holds the plain text. One thing changed from what the user read: option A needs 1 new text and 1 changed help sentence (PLANNER CALL 106). The question, as it stood: a wrong value that a user can see. Example: a connected coin, read 0.1, and a manual row of +0.5 that an earlier read overwrote. The user duplicates the row. Home shows 0.6 and the line 0.1, 0.6, until a good read, then 0.1 flat. With the coin set aside, it stays 0.6. A row of -0.5 gives -0.4 on Home. Spending keeps the copy after the read. Sizes are floors.

| Option | Home and line | Size: production; tests and acceptance rows | Migration, `EXPORT_VERSION` | Strings | API calls | Set; holds set 5 | Binance, Monobank, wallet | Recommended |
|---|---|---|---|---|---|---|---|---|
| A: no Duplicate on a connected holding, and a repository gate. CHOSEN (O92) | No copy can exist. Home 0.1; line 0.1, 0.1. A row typed before the reconnect keeps edit and delete. To add a row, the user disconnects, as for any row | The plan's step 1/1 holds the floors. Was: 25 lines in 5 files: `deletable.ts`, `holding-detail.screen.tsx`, `home.screen.tsx`, `transaction-row.component.tsx`, `transactions.repo.ts`; 120 test lines, 3 rows | No, no | 1 new, 1 changed (PLANNER CALL 106; was: None) | 0 | A fix round step of set 11; no | The same gate reaches them with no other edit, and their numbers leave row 34 as well. For Bybit only: one more branch, and two behaviors for one action | Yes |
| B: keep it, and write the copy at once on the mark, with no balance move | Home 0.1; line 0.1, 0.1 at each moment, set aside too. The list and spending show a row that moves nothing, with no text, as O89 ruled for an edit | 20 lines in `transactions.repo.ts` and `holding-metadata.ts`; 150 test lines, 3 rows; "One writer" and "A new row is not on any mark" change | No, no | None | 0 | A fix round step of set 11; no | Bybit only until the separate track adds each kind. Until then they keep today's numbers, so two behaviors for one action | |
| C: keep it, and open the form with a holding picker that leaves out a connected holding | Nothing changes on the coin, and the copy is a real row on the holding the user picks | 40 lines in `hydration.ts`, `route-entry.ts`, `holding-options.ts`, `transaction-form.screen.tsx`; 150 test lines, 3 rows, and the gate of A to close the form left open | No, no | None | 0 | A fix round step of set 11; no | One rule for all, as in A. A coin copy can have no eligible holding of its currency, so the amount drops | |
| D: no change, stated as a wrong value | Before a read: Home 0.6; line 0.1, 0.6. After: 0.1 flat. Set aside: stays. -0.5: Home -0.4; line 0.1, -0.4. On Binance, Monobank, a wallet: line -0.9, -0.4, 0.1 after the read | None | No, no | None | 0 | None; no | Unchanged | |

Q-o, ANSWERED (O93, 2026-11-05, relayed by the coordinator; was: OPEN). The user's words: "A: Refuse the key". The user accepts that Kiko keeps a value made from the UID in `exchange_state` and `.kiko`, and was told that a script can find the UID from a file. It goes in set 7, steps 1/6 and 4/6. 1 text and 1 policy clause, en and uk, go to the user for review through the coordinator (`.superpowers/sdd/1.4-bybit/texts-for-review-o93.md`). Section 3, row 35; section 9, "The one change to this rule"; PLANNER CALLS 103 to 105 and 111; the questions file holds the plain text. The question, as it stood: a wrong value that a user can see. Example: an old Bybit account with 1 X and 2 Y, then a key of another Bybit account with 5 X, on the same Kiko account. X: Home 5; line -1, 0, 5. Y: Home 0; line -2, 0. The list and spending hold both. Sizes are floors.

| Option | Home and line | Size: production; tests and acceptance rows | Migration, `EXPORT_VERSION` | Strings | API calls | Set; holds set 5 | Binance, Monobank, wallet | Recommended |
|---|---|---|---|---|---|---|---|---|
| A: refuse a key of another owner while the account keeps its Bybit holdings. The remedy: a new crypto account, or delete those holdings first. CHOSEN (O93) | The world cannot happen. New account: X 5; line 0, 0, 5. Old account: X 1, Y 2, kept. Home 6 X, 2 Y | 50 lines in 6 files: `bybit.client.ts`, `bybit.provider.ts`, `exchange-state-patch.ts`, `walk-state.ts`, the set 7 `bybit-credentials-field`, the locales; 200 test lines, 6 rows; one clause in the policy, en and uk, and section 9's rule changes | No, no | 1: `bybitKeyOtherAccount`, section 8 holds the new draft (PLANNER CALL 111), and the draft below is the record | 0: `query-api` already runs at connect | Set 7 steps 1/6 and 4/6; no | Binance keeps the fault until the separate track adds the same check; that is two behaviors for one action, and `uid` is already read there. Monobank and a wallet key a holding by card or address, so one holding has no two owners, by reading | Yes |
| B: ask, then delete every Bybit row of the account and start from the new key | X: Home 5; line 0, 0, 5. Y: Home 0; line 0, 0. Right for the new account alone. If the old account still holds money, Home stays short by it. The list and spending lose the old rows, and only a `.kiko` file brings them back | 110 lines in 8 files, the fingerprint of A included; 350 test lines, 9 rows; the same policy clause | No, no | 3: title, message, action | 0 | Set 7 step 1/6; no | As A | |
| C: keep the rows, and say so at connect, for every key | Unchanged: X: Home 5; line -1, 0, 5. Y: Home 0; line -2, 0. Stated, and still wrong | 5 lines in 2 files; 20 test lines, 1 row | No, no | 1: `bybitOneAccountNote`, draft below | 0 | Set 7 step 1/6; no | Binance keeps today's text | |

| Key, a DRAFT for the translator and the user (a record; O93 took option A, with the words of section 8) | en | uk |
|---|---|---|
| `bybitKeyOtherAccount` (A), was | This key belongs to another Bybit account, and this Kiko account still has holdings from the first one. Add a new crypto account for it, or delete those holdings first. | Цей ключ належить іншому акаунту Bybit, а цей рахунок ще містить активи першого. Додайте для нього новий крипторахунок або спершу видаліть ці активи. |
| `bybitOneAccountNote` (C) | Connect one Bybit account per Kiko account. A key of another Bybit account adds its rows here, and the net-worth line then counts both. | Підключайте один акаунт Bybit до одного рахунку в Кіко. Ключ іншого акаунта додасть сюди свої записи, і лінія чистих активів рахуватиме обидва. |

Accepted residuals told to the user, with no question (O68):

- Q-a (O68 (a); was: a question, with a split to 1 minute): a burst of over 1,000 log rows, or over 2,000 ledger rows, inside a span of a second or less holds that lane. Later spot trades or Funding moves stay out until that burst passes the floor, and `bybitHistoryDense` says so in en and uk. The 1-second split costs about 5 to 10 more runs on a burst, and no run on an even day.
- Q-c (O68 (c), under O56): the server repeats a page in the middle of the convert list. The rows behind it are missing, with no sign. It heals if the repeat is transient, and it is outside the pages.
- M32 and M35 (O68, F1, F5): section 3, "What stays wrong".
- O76: section 3, "The `locked` set-aside", accepted residuals. The past-line effect during an open order is not one of them: it is set 11 and Q-i (O78, answered by O85).

The user's words on the order, the same date: "Spend no money and ask for no account step before the terms verdict."
(O38, section 10.)

Merge order (O21, PLANNER CALLS 43, 59, 72), a recommendation to the coordinator, who owns the merge: set 2 alone, with the empty table, before any device build; sets 3, 4, 5, 6, 9, 10 and 7 stay out of `next`
until set 7 passes on device, then merge as one batch; then set 8. Detail: the plan, "Merge order".

## Backlog

- The synced-holding refusal reaches `importRows` and `accountsRepo.remove` as "Please try again.", and `removeHolding` shows no alert (O95: backlog, not in set 11).
- Clock offset read from `/v5/market/time` on 10002.
- Re-check `readOnly`, `isMaster` and `permissions` on later syncs, with a caption.
- Widen `BYBIT_FIAT_CODES` on a measured case of a wallet that holds another fiat (O19).
- Adopt `createWriteSerial` in `binance.credentials.ts`.
- `EXCHANGE_NAME` list if a later stage writes a funding code.
- Netting `spotBorrow` from a coin, with a borrower's probe.
- A cooldown shared by two Bybit accounts on one IP: today it is per account, as for Binance.
- A local notification before key expiry: not built (Q2). Its cost, read in `src/reminders/` and kiko-architecture's
  reminders.md at the base 57130e23c, is below.

| Existing rule | Effect on an expiry notification |
|---|---|
| A reminder is a user-made row per `(account_id, kind)` | An expiry notice is no user row. A row needs a `kind` (`reminderKinds`), which the list screens render through `reminderKinds.filter` and `flatMap`: it would show up as a choice |
| `eligibleReminderKinds`: "a synced account sends no reminder"; `isSchedulable` enforces it; a connect re-plans so reminders stop | Directly opposed: the only account that needs this one is synced |
| `ReminderSchedule` repeats (daily, weekly, monthly, interval), with back-off at `IGNORED_LIMIT` 3 and a paused notice | A one-shot date fits none of them, and back-off has no meaning here |
| `syncReminders` returns early on `hasAnyQuery` empty, calling `replaceRequests([], [])` | A user with no reminders has every request wiped; the early return must move |
| iOS is asked only on a form save or from a reminders list banner | A connect-time ask is a new moment, so a key user may have a permission never asked; the pre-alert flow exists but needs that new caller |
| `recordEngagements`, `route-response` key on a reminder id | A response with no row needs its own path |
| Policy: "The reminders you set up" | Text edit in en, uk and the site pages |

The native layer takes it (`replaceRequests` accepts any request, floating date), but the rules do not fit. The counted
cost: a separate planned-request source merged in `syncReminders`, floor 8 code files (`sync-reminders.ts`,
`reminder-content.ts`, a new planner file, `route-response.ts`, the permission caller, the section, two locale files) and
5 test suites, about 300 to 500 code lines, plus policy text. It also needs a re-plan on each balance sync that changes
`expiredAt`.

### Later, no date, the user's choice: one real deposit and withdrawal (O61 (b), O62)

No code waits for these. When the user chooses, or anyone with a funded account: the runs below turn stage B's docs-only rows into MEASURED,
and a shape that differs edits rules 13 to 19, 41, 45 and 47. R5 below does the same for stage E. Which parts: P4 (fee, pending form, wallet), P5 if a sender exists, P6 (fee,
`BlockchainConfirmed`, wallet), P7, P13 with rows (range end, window field, order, cursor), P18 with rows. The money figure is a GUESS: 30 to 50
USD stays in the account plus a few USD in fees, and it can be withdrawn after. The rows below are as they stood. Their Earn and `locked` parts are a record: `locked` is ruled (O76), and Earn is not read (O75).

| Run | When | The user does first | Parts | Proves |
|---|---|---|---|---|
| R2 | `R2 P4` while K1 is pending; the whole R2 after money lands | K1: on-chain USDT deposit. After `R2 P4`: K2: FUND to UNIFIED and back, part of it left in UNIFIED. K3: a far-off unfilled spot limit order, left open for R3 | `R2 P4` while K1 is pending (O16, O32): it reads the balances and the pending row, waits at a prompt until K1 lands, then reads the balances and the rows again, and the second read of the rows is the one compared (O47). If K1 landed before `R2 P4` could run: `R2 P2` BEFORE K2 (O52). Then the whole R2, with skip typed at the P4 prompt: P2, P4, P7, P13 (rows), P18 (up to about 60 calls). After K6 settles (R4): `R2 P13` once more, because no withdrawal row exists before K6 (O48) | The form of a row with no time, the wallet that moved for K1, balance shapes, deposit wallet and status, transfer path and rows, page behaviour, decimals. After K6: the time field that a withdrawal window filters on. The proof of `locked` inside `walletBalance` is in R3 (O50) |
| R3 | Same day | Nothing before the run: K3 stays open, and K4 and K5 wait for their prompt (O50) | P2: it reads UNIFIED and FUND, the user cancels K3 at its prompt, then it reads UNIFIED again. P3: reading 1 BEFORE K4, then at its one prompt K4: subscribe Flexible Savings, and K5: on-chain Earn if its minimum is affordable, with two different amounts for K4 and K5, because the stake check cannot tell the products apart with equal amounts; press Enter only after Bybit shows that the step has landed; then reading 2 (about 12 calls). K4 and K5 stay on one prompt, because the two checks of P3 separate them (O54). A comparison lost at the prompt cannot be repeated by a new run, because a new run starts a new reading 1: a repeat needs the step again with a small amount, at the prompt of a new `R3 P3` or `R4 P3` run | `locked` inside `walletBalance`: both, per coin, around the cancel of K3 (O50). The double count, by the stake check on amounts, not by direction alone (O54). The Earn status rule still waits for R4 (rule 46) |
| R4 | After the R3 run of P3 shows the position; no fixed day (O31, O40) | K7, optional: an internal deposit from another Bybit user. K8, optional: off-chain withdrawal. K6 waits for its prompt, and K11 is last | `R4`: P3 as one reading, with no redeem prompt (O50); P5; P6 reads FUND and UNIFIED, then at its prompt K6: on-chain withdrawal to the user's own Binance from FUND, and one from UNIFIED if Bybit allows it (O14), with two different amounts when both wallets are used, so that each row matches one wallet, then it reads them again (about 10 calls). `R4 P6` as K6 settles, three times in all, with skip typed at the prompt. `R2 P13` once more (O48). Last, K11, through `R4 P3`: reading 1, then at its prompt the user redeems all of Flexible Savings and waits until it lands, then reading 2 | `success` vs `BlockchainConfirmed`; per wallet, change equals amount, change equals amount + fee; internal rows; whether a row tells its wallet (rule 45); the wallet that moved around K6, which the output names by its words: FUND and UNIFIED as equal or changed per coin (O47); the redeemed row (rule 46) and the redeem check |

### Deferred: the rest of stage C, and stage D (O37, O64)

Not built in 1.4, and not counted in the plan's sets. A later track takes each up with its own sets, its own user steps
and its own review of these rows. Every row here keeps its mark. Stage E took the walk, spot trades and converts out of stage C (was: stage C held the log and the convert history, with "a type seen on the small account imports", UNPROBED(P8) and (P9)).

The rest of stage C, on the walk of set 9, with no new call: rules to import `AIRDROP`, `BONUS`, `FEE_REFUND` and `INTEREST` rows, whose `change` is QUOTE, marked by kind. Each leaves `bybitLogLeftOut` in its own commit. The spot row's real shape on mainnet: R5.

Stage D:

| Series | Endpoint | Window | Page | Rule | Evidence | Probe |
|---|---|---|---|---|---|---|
| Earn orders | GET `/v5/earn/order`, `category=FlexibleSaving` | 7 days | 100, cursor | QUOTE "For category = OnChain, either orderId or orderLinkId is required", so on-chain orders are not walkable; the log's rows or nothing | QUOTE; retention UNVERIFIED | UNPROBED(P10) |
| Yield | GET `/v5/earn/yield`, per category | 7 days, floor `now - 90 days` from QUOTE "the past 3 months" | 100, cursor | The rolling floor drops yield the app did not read in time, the sharpest case of rule 26 | QUOTE | UNPROBED(P10). Needs a position older than a day |

Call counts, COMPUTED as in section 5:

| Stage | Series | Route limit (research J) | Window | Windows to floor | First read, calls | Steady, calls per run | MEASURED after |
|---|---|---|---|---|---|---|---|
| D | earn orders | UNVERIFIED | 7 d | 105 | 105 | 2 | P10 |
| D | yield x2 categories | UNVERIFIED | 7 d, 90 d floor | 13 x 2 | 26 | 4 | P10 |

Totals: D first 131, steady 6. With stages A, B, E and F: first at least 525 gated, steady at least 19 gated
plus 5.

User runs and probe parts, for the later track's script:

| Run | When | The user does first | Parts | Proves |
|---|---|---|---|---|
| R5 | Later, no date, the user's choice | K9 on mainnet, real money: one spot buy. K10 on mainnet: one convert in FUND and one in UNIFIED, from web or app | P8, P9, P18 | Log rows per fill, the row shape on mainnet, whether a convert shows in both lists. Turns stage E's rows to MEASURED |
| R6 | When stage D is taken up | Nothing new while the K11 order of R4 is in reach; if P10 does not show it, K4 and K11 again. Yield needs a position older than a day | P10 | Order rows and yield rows |

| Part | Prints | Unlocks |
|---|---|---|
| P10 | The same as P4 to P7, for stage D | The later track's sets |

Research "STILL NEEDS THE KEY", the items only these stages need:

| # | Item | Part |
|---|---|---|
| 7, on mainnet | A log row per fill; `type`, `displayType`; a FUND-only coin | P8 at R5 |
| 8, on mainnet | API and web converts; double read in the log | P9 at R5 |
| 12, part | Earn order shape, hourly yield retention | P10 |

Copy edits: each stage edits `bybitKinds`, the footer `holdingDetail.exchangeNotListed.bybit`, the help step, the policy
blocks of section 9 and `bybit.shipped-copy.test.ts` in the same commit as its kind (memory
intermediate-task-tip-must-be-safe): a kind that now reads leaves the not-read list. Stage D also states in copy what the
3-month floor drops.
