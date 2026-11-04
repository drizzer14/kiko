# Bybit sync design (track 1.4-bybit)

Status: the user's approval of the earlier text is given, DONE 2026-11-04 (O41, O59). O62 changed the scope after
it: nothing in this track needs the user's money. O64 added stage E after it: spot trades and converts, in the same
release (Q5 "E + A"). O65 added stage F: the Funding wallet ledger, in the same release (Q6 "B: Add to 1.4"). Stages A, B, E
and F stay. Rows the live API docs cover ship "docs only".
R1 and the second key ran, and their results are in this text (O60). The empty mainnet read and the testnet run are
next (section 10). App code starts at set 2, on the commit of this text (O62, O63 (e); was: after R2 to R4, O36). Q1 to Q6
are answered (section 13). The terms verdict is in section 9: PASS WITH CONDITIONS for global
accounts. The user accepted the 5.2.2 and 6.5 doubts (O42). Base 57130e23c.
Plan: `docs/superpowers/plans/2026-11-03-bybit-sync.md`.

Inputs: `.superpowers/sdd/1.4-bybit/rulings.md` (O1-O66, binding; O61 (a) and (b) are replaced by O62),
`report-r1.md`, `report-no-money.md`, `report-q5.md`, `report-o65.md`, `review-7a2391ca8.md`, `review-32337df0d.md`, `terms-verdict.md`,
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
measures what a row feeds. Earn and `locked` can make a current balance wrong, so they stay UNPROBED until the testnet
run (section 10).

A number here is a floor or a computed value, never a duration. The developer re-greps every code
fact; symbols are named, not lines.

Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-11-04): this track closes none.
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
| A wrong balance | Strict UNIFIED read; a failed wallet keeps its last balance; a coin with a borrow is refused alone; Earn is added only after the double-count probe P3 on testnet (section 10); a paged Earn answer fails the wallet read; an Earn row with a `status` adds only if the allowlist holds that status, and FlexibleSaving does not ship if a redeemed row has no `status` and a non-zero `amount` (O18, O31); connect refuses a key that cannot read a shipped kind, by one real read of each route (O13, section 6.8) |
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
| 1 | One holding per coin and wallet | HOLDS | Keys `<COIN>:unified`, `<COIN>:fund`, `<COIN>:earn` under `metadata.bybitAsset`, matched by the neutral `upsertByMetadataKey` | CODE; O4 |
| 2 | BTC legacy keys, `renameFromDefaults` | N/A | No legacy row exists; no rename, no mark | O4 |
| 3 | Spot strict, others tolerant per wallet | CHANGES | `query-api` first: an expiry class refusal fails the sync at once, any other failure of it is tolerated (keeps the stored expiry). UNIFIED strict (proof of life). FUND tolerant. Earn tolerant, both categories in one guard | CODE for the shape; MEASURED 2026-11-04 for `query-api` (R1); P2 on testnet for the balance bodies |
| 4 | A malformed top level writes nothing | HOLDS | A body with `retCode` 0 and no list of its route is a failure, never a zero: `result.list` for UNIFIED, Earn and transfer, `result.balance` for FUND, `result.rows` for deposit, internal deposit and withdrawal. Was: `result.list` for all, which the pages do not say | CODE; QUOTE for the envelope and the row lists (live pages, section 3); `result.balance` is from the probe script's read of the docs, UNPROBED(P2) |
| 5 | A coin the good read does not list is a zero | HOLDS for UNIFIED | QUOTE "If not passed, it returns non-zero asset info". FUND: whether it lists zeros is unstated; the same zero rule holds either way | QUOTE; UNPROBED(P2) for FUND |
| 6 | A refused coin skips only itself | HOLDS | Malformed or oversized coin omitted alone, logged by wallet only; CHANGES by one reason: a non-zero `spotBorrow` or `borrowAmount` refuses the coin too (PLANNER CALL 3) | QUOTE ("Old walletBalance = New walletBalance - spotBorrow") |
| 7 | Dust and appear rule | HOLDS | `curatedCoins.dustBelow` is neutral: below it no new holding; an existing holding is written, zero included | CODE |
| 8 | Tracked coin list | CHANGES | `isTrackedBybitAsset` = `isCurrency` and (`isCrypto` or `BYBIT_FIAT_CODES`). `BINANCE_FIAT_CODES` is NOT reused | MEASURED, next row |
| 9 | The fiat ticker trap | CHANGES | `BYBIT_FIAT_CODES` = USD, EUR, AED, BRL, PLN: the app's fiat codes among the quote coins of the 520 public spot rows. Two Bybit base coins equal an app fiat code: MNT and SCR, both coins, so neither is fiat. UAH is no Bybit spot quote, so a UAH balance lists as not tracked. The list stays these 5 codes (O19). Whether a wallet can hold another fiat is UNVERIFIED: such a coin lists as "not tracked", visible, with no wrong amount. A complement list could price a new coin as fiat, which is a wrong balance; a short total with a visible line is not | MEASURED 2026-11-03, `/v5/market/instruments-info?category=spot`; re-read at set 3; UNVERIFIED for another fiat in a wallet |
| 10 | Curated coins on the exchange | CHANGES | Of 23 curated coins (floor), ZEC, DAI, FDUSD have no Bybit spot row. They stay tracked: the rule is the app's, not the market's | MEASURED 2026-11-03 |
| 11 | `exchangeMinorUnits`, balances round | HOLDS | Balance use rounds, logged by gap `/2` | CODE |
| 12 | Rows are exact at `baseAssetPrecision` scale | HOLDS for stage B, CHANGES for stage E | A stage B row with more decimals than the scale on a non-`reducedScale` coin stops `amount-precision`: that record stays owed at its point, its other rows import, the balance stays right, and the caption shows once the point is a day old. Public `basePrecision` is at or under the stored scale for every curated coin on spot, but it bounds orders, not deposits, so it proves nothing for a row. A log `change` and a convert amount round half away from zero at the scale, through a new `AmountUse` `rounded-row` (PLANNER CALL 42): the page's own convert sample has 15 decimals, and a fee of a fill runs past the scale, so a refusal would owe nearly every such row. Error: at most half a minor unit per row. `row` and `trade-row` stay as they are, so Binance's rows do not move | CODE; MEASURED 2026-11-03; QUOTE for the sample; docs only for row decimals |
| 13 | Settled deposit | CHANGES | Settled: 3, 70012, each only with `depositType` 0 (PLANNER CALL 30). Failed, nothing owed: 4. Owed point: 0, 1, 2, 7, 70013, 10011, 10012, any unknown status, and a settled status with any other `depositType`. A row of these with no time makes no row and owes its span in the `deposit` series (rule 47, PLANNER CALL 37). 10012 stays owed: the page says "Credited to funding pool successfully", and no page says that this is final. Status 3 on the enum page: "this is final status ... If a blockchain rollback occurs, the deposit will be assigned a 7XXXX status" | QUOTE (live enum page); docs only |
| 14 | Removal of a settled row | CHANGES | 70011 on a read record removes its row through `SettledSpan.removed` (`removeSyncedRows`, by key, no balance move), the fiat precedent. Removal goes by key, so a 70011 row with no time still removes (A35; was: the sort of rule 19 dropped it first). Status 7 or 70013 on a record whose row exists owes its point, and the row stays until a final status. A rollback seen only inside the re-scan or a point: one older than the 29-day re-scan leaves a stale ledger row, while the balance read stays right. An accepted residual: Q3 (section 13), with its effect on the past of the net-worth line stated by Q5 and accepted by O64 | QUOTE (live enum page); CODE; docs only |
| 15 | Settled withdrawal | CHANGES | Settled: `success`. Final, nothing owed: `CancelByUser`, `Reject`, `Fail`. Owed point: `SecurityCheck`, `Pending`, `MoreInformationRequired`, `Unknown`, any other, and `BlockchainConfirmed`. The page lists these words and does not say how `BlockchainConfirmed` relates to `success`. Cost if `BlockchainConfirmed` is an end state: such a row never imports, its point is read on each run (1 call of the lane cap), and the caption stays until the floor passes it. That is a missing row: the past of the net-worth line reads high by its amount before it, spending is short by it for good, and the caption shows (O63 (d)) | QUOTE for the words (live enum page); docs only |
| 16 | Settled internal deposit | CHANGES | 2 settled, 3 final failure, 1 owed. Any other value is unreadable and owed | QUOTE (live page); docs only |
| 17 | Settled transfer | CHANGES | `SUCCESS` settled, `FAILED` final, `PENDING` and other owed | QUOTE (live enum page); docs only |
| 18 | Second-level reads, `reach` | CHANGES | R36 was Earn only. QUOTE: deposit and transfer "the query logic is actually effective based on second level". All four Bybit series pass a `reach` with the start floored to the second, harmless if a route reads at the millisecond; a stuck record there owes its own point. Deposit `reach` has no end, and withdrawal `reach` starts at the floor (PLANNER CALL 29) | QUOTE; CODE (`pointOf`); docs only |
| 19 | Oldest to newest within a window | CHANGES | Page order is undocumented for these routes (execution list: descending, equal times unstable, SUMMARY). A span commits as one unit after all its pages, sorted by time then key before `settleRecords`, so page order has no effect on what commits. The sort leaves a row with no time out; that row makes no row, owes by rule 47, and a 70011 among them still removes by key (rule 14) | CODE; docs only |
| 20 | Per-record commits, rows before marks | HOLDS | `commitSettledSpan`, unchanged | CODE |
| 21 | Cursor marks, `patchExchangeState` | HOLDS | Already takes `exchangeId` (`exchangeStateDepsOf('bybit')`). Bybit's opaque `nextPageCursor` is never stored: it lives inside one span read | CODE; PLANNER CALL 6 |
| 22 | Offset paging, drift, `fetchAllByTotal` | N/A | No `total`. The drift rule becomes: a repeated `nextPageCursor`, or a row outside the span by both readings of its window field, is `bybit-page-drift`, owed in that series (a withdrawal: neither `createTime` nor `updateTime` in the span; a deposit: `successAt` before the span's floored start; PLANNER CALL 29). An empty or absent cursor ends the span, and a page with no row ends it too, whatever its cursor says. A pending row with no time is never `bybit-page-drift`: rule 47 | QUOTE for the cursor; docs only |
| 23 | Pending, re-scan and points passes | HOLDS | `planWalkPasses`, `runWalkPlan`, as is | CODE |
| 24 | `MAX_PENDING_RANGES` 12, merged ranges | HOLDS, costlier | A merged gap costs gap/window windows; 7-day windows pay 4 times what 29-day windows pay. Inherited gaps stay open | CODE; COMPUTED |
| 25 | Floors | CHANGES | One rolling floor: `now - 729 days` for every stage B series, the Transfer precedent (`transferFloorMs`, never ask at the documented edge). No stage B series has a stated retention. P12 can move a floor only by a refusal (O20): an empty answer with `retCode` 0 proves nothing and keeps the 729-day floor. R1: all 4 series served all 4 windows, up to 729 days, 0 rows, no refusal, so the floor stays 729 days. `walk/depth.ts` stays out (offset tied). Stage E: the log takes the same floor (QUOTE "up to 2 years"). The convert history has no time parameter and no stated retention; a convert older than the floor makes no row, so one old row never moves the default range (`spanStart`) and every kind stops at the same date (PLANNER CALL 49) | CODE for the precedent; UNVERIFIED for retention; MEASURED 2026-11-04 (R1, P12) |
| 26 | What a rolling floor drops | HOLDS, stated | `cutToBounds` drops owed ground the floor passes, unread, points too. An app left closed past the floor loses the rows of that gap, not any balance. The floor is Kiko's, so the holding footer says "records older than two years" (was: "older than Bybit keeps", which rule 25 contradicts) | CODE |
| 27 | `HISTORY_FLOOR_MS` as `restartMs` | CHANGES | `BYBIT_RESTART_FLOOR_MS` = 2018-01-01, earlier than any rolling floor. `planWalkPasses` ignores a mark at or below the floor | CODE; PLANNER CALL 7 |
| 28 | `multiCoinSince`, `multiCoinSeen`, backfill | N/A | No BTC-only history exists, so no walk writes them, and `backfillGroundOf` is not called; a test pins the marks absent | O4; CODE |
| 29 | Disconnect reset | HOLDS | `disconnectExchange(accountId, 'bybit', BYBIT_RESTART_FLOOR_MS)`, then the Bybit clear. `exchangeStateReset` keeps walks only, so the stored key expiry goes with it. Holding keys stay, so a same-account reconnect re-adopts | CODE |
| 30 | Institution gate | HOLDS | Takes the id already; gap `20261017T1639/1` applies within one provider | CODE |
| 31 | Rate limit, cooldown | CHANGES | `retCode` first (O3). 10006, 10018: cooldown to `X-Bapi-Limit-Reset-Timestamp` when usable, else 60 s default. HTTP 403: 10 minutes (docs). Own module Map; a balance read inside it makes no call and returns no balances | QUOTE, SUMMARY; MEASURED 2026-11-04 for the header on an ok answer (R1, P16: 13 digits); on a 10006 it is docs only |
| 32 | Budget | CHANGES | `createBybitRunBudget` behind `RunBudget`: calls per lane only, no weights; `recordFailedCall` analogue counts a refused call. Section 5 | CODE; COMPUTED |
| 33 | One pacing gate per run | HOLDS | `createExchangeRun`, interval from the slowest route read (section 5) | CODE; QUOTE (limits) |
| 34 | `isUnreadableWindowError` | HOLDS | `BybitHistoryParseError` alone; rate limit, refused key, clock skew and network stop the run | CODE |
| 35 | A walk failure never fails the balance sync | HOLDS | `logOnFailure` per walk | CODE |
| 36 | Caption: behind | CHANGES | `CAPTION_WALKS` per provider, with a required parameter and no default to Binance (O30). Reusing the 8 would keep "behind" up forever (`null` cursor). Stage A: none. Stage B: `capital`, `transfer`. Stage E: also `log`, `convert`. Stage F: also `fundingLedger` | CODE; seam 4 |
| 37 | Caption: paused, coin lines, not imported | CHANGES | The `connectedProvider === 'binance'` gates become "an exchange with a walk state". Tracked predicate per provider | CODE; seam 3 |
| 38 | Caption: P2P read failed | N/A | No P2P walk (O5); the gate stays Binance only | O5 |
| 39 | Trades | CHANGES | No Binance-style read per symbol (`readIdCursor`, `tradeCandidatesOf`, the `trades` state). Bybit's spot trades come from the Unified log, one row per log row: rule 49 (O64; was: not read, O37) | QUOTE (live page); docs only |
| 39a | Dust, fiat, Pay walks | N/A | No such routes | Rulings |
| 40 | Namespaced `externalId` | HOLDS | `<accountId>:` prefix, then the kind, the record id and `:<COIN>` (O4, memory exchange-ids). A log row and a convert leg: section 3, stage E | CODE |
| 41 | Network fee out of the ledger line | HOLDS | `amount` as Bybit reports it, with no sum, no subtraction and no fee line. No page says whether it holds the fee. The row feeds no current balance, and it feeds the past of the net-worth line and spending (section 3, "What a row feeds"): off by at most the fee of that row, the same error Binance's rows carry. The later real-money run (Backlog) compares it (O47, O58) | QUOTE for the fields; CODE (`plannedWithdrawalOf`) for the precedent; docs only |
| 42 | `untrackedCounterpart`, wallet codes | HOLDS for transfers | The enum page's `accountType` holds UNIFIED and FUND. The transfer page's own sample shows SPOT to UNIFIED, so an older word can reach a real account. Any wallet word but UNIFIED and FUND is `bybit-transfer-wallet-unknown`, owed; `UNTRACKED_WALLETS` gets no member. Cost for a user with such rows: one owed point each, read on each run within the lane cap, with the caption, for up to 729 days, and that transfer is a missing row: the wallet Kiko tracks reads high by it before the move, and so does the sum | QUOTE (live enum and page); docs only |
| 43 | Funding matcher | HOLDS | Bybit writes no `p2p`, `card` or `bank` code, so `fundingOf` skips its rows. `EXCHANGE_NAME` stays | CODE |
| 44 | Thrown errors are named classes | HOLDS | `BybitHistoryParseError`, `BybitRateLimitError`, `BybitRefusalError` with a fixed message and a `code` | CODE (`kiko-no-literal-sync-error`) |
| 45 | A series knows its wallet (`walletHoldingOf`) | CHANGES | Bybit deposit and withdrawal rows name no wallet (O14), and the live pages name none: `depositType` holds 0, 10, 20, 50, which are no wallets. So outcome (b) holds (O62): every deposit, internal deposit and withdrawal row goes on the FUND holding, and clause W1 says so (section 8). No row moves a balance (CODE: `addManyDedup` "never touches `holdings`"; the balance comes from the wallet read). A row on FUND creates a FUND holding at zero if none exists, so such a holding can show 0. The sum over one coin's wallets in the net-worth line does not change, and each wallet's past does: FUND can read below zero there. `earlierHistory` is off for Bybit (PLANNER CALL 27). Was: outcomes by P4 and P6 | QUOTE (live pages); CODE; docs only |
| 46 | Earn positions add to the Earn wallet | CHANGES | One rule, no guess left (O18, O31). A row with a `status`: the allowlist applies, default `Active`, confirmed by P3; any other status leaves the position out, counted, and the account shows `bybitEarnLeftOut`. A row with no `status`: its `amount` adds. The testnet run redeems Flexible Savings and runs P3 (section 10, "What proves Earn"). If that run shows a redeemed row with no `status` and a non-zero `amount`, FlexibleSaving does not ship, and clause E4 says so (section 8). A redeemed FlexibleSaving row never adds. The research names `Processing` and `Active` for OnChain only, and a digest says redeemed FlexibleSaving rows still appear | SUMMARY; UNPROBED(P3) |
| 47 | A record has a settle time | CHANGES | A deposit with an empty, 0 or absent `successAt` and a status that is not final (anything but 4 and 70011) makes no row and owes its span as a range in the `deposit` series (PLANNER CALL 37, O63 (b); was: owes nothing, CALL 28; before that: the span in every series, O32). This covers a pending row, status 3 with type 0 and no time, and a held deposit (type 20 or 50). The range holds back neither the other series nor the forward pass (`isOwedPast`), costs 1 call per run within the lane cap, shows the caption at once, and clears when a read returns the row with a time or no longer returns it. So a row survives past the 29-day re-scan under a window on its creation time. Under a window on `successAt`, a row with no time is in no window, and the forward pass returns it when it settles. A no-time row never gives `bybit-page-drift`, and the sort of rule 19 leaves it out. Cost: a deposit Bybit blocks for good keeps the caption and 1 call per run until the floor passes it; while it waits it is a missing row (section 3) | CODE for `owedBy`, `isOwedPast`, `commitSettledSpan`, `planWalkPasses`; QUOTE for the field; docs only for the form |
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

### Stage A: balances (5 calls per sync)

| Read | Endpoint and params | Window | Page | Row fields used | Key | Wallet | Evidence | Probe |
|---|---|---|---|---|---|---|---|---|
| Key info | GET `/v5/user/query-api`, none | none | none | `expiredAt`, `deadlineDay` on a sync; also `readOnly`, `isMaster` at connect only, never stored (O13); every other field is dropped at the parse, `permissions`, `userID`, `kycRegion`, `note` never reach state | none | none | MEASURED 2026-11-04 (R1): `readOnly` number, `isMaster` boolean, `expiredAt` string of shape 9999-99-99T99:99:99Z, `deadlineDay` number | MEASURED (P1) |
| UNIFIED | GET `/v5/account/wallet-balance`, `accountType=UNIFIED` | none | none listed | `coin`, `walletBalance`, `spotBorrow`, `borrowAmount`; `equity` and `usdValue` never | `<COIN>:unified` | UNIFIED | QUOTE for the param and the fields. `locked`: QUOTE "Locked balance due to the Spot open order", and the page's sum "walletBalance - totalPositionIM - totalOrderIM - locked - bonus" reads as `locked` inside `walletBalance`, an inference. HTTP 200 and 10005 on a key with no box for it: MEASURED 2026-11-04 | Route MEASURED (P11). Coin rows UNPROBED(P2): `R2 P2` on mainnet, then testnet |
| FUND | GET `/v5/asset/transfer/query-account-coins-balance`, `accountType=FUND`, no `coin`, `withBonus` left out | none | none | `coin`, `walletBalance`; `transferBalance` never | `<COIN>:fund` | FUND | SUMMARY | Route MEASURED (P11). Coin rows UNPROBED(P2): `R2 P2` on mainnet, then testnet |
| Earn, flexible | GET `/v5/earn/position`, `category=FlexibleSaving` | none | none listed; a non-empty `nextPageCursor` fails the wallet read | `coin`, `amount`, `status`; a row with a `status` adds only if the allowlist holds it, and a row with none adds its `amount` (rule 46, O18, O31) | `<COIN>:earn`, the two reads summed | Earn | QUOTE permission "Earn"; fields SUMMARY; double count UNVERIFIED | UNPROBED(P3) |
| Earn, on-chain | GET `/v5/earn/position`, `category=OnChain` | none | same | same | same | Earn | same | UNPROBED(P3) |

Earn ships as designed only if P3 on testnet shows staked coins leave UNIFIED and FUND (section 10, "What proves
Earn"). If they stay, no Earn holding is written and the copy says so (clause E3, section 8); the money is then already
counted. With no on-chain position to test, on-chain Earn is not read, and the copy says so (clause E2). If the redeem
shows a redeemed row with no `status` and a non-zero `amount`, FlexibleSaving is not read, and the copy says so (clause
E4, O31). With no testnet reading at all, clause "E2 and E4" holds. UNPROBED(P3).

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
| Transfer | GET `/v5/asset/transfer/query-inter-transfer-list`, `startTime`, `endTime`, `limit=50`, `cursor`; list `result.list`. The page's example names `inter-transfer-list-query`, which answers HTTP 404 (MEASURED 2026-11-04) | 7 days (QUOTE "endTime - startTime ≤ 7 days"; MEASURED) | 50, default 20, cursor | `transferId`, `coin`, `amount`, `fromAccountType`, `toAccountType`, `timestamp`, `status` | pair `<acc>:xfer:<transferId>:<COIN>`; each leg the pair id plus `:` plus its holding key | Both named | QUOTE, live page | Path MEASURED (P11, P16). Rows docs only; a K2 on testnet can show one (section 10) |

Without `withdrawType=2` an off-chain withdrawal is missed: the page's default is on-chain only
(QUOTE "0(default): on chain").

### What a row feeds (MEASURED on the code, 2026-11-04, by reading)

A Bybit row takes the shape of Binance's. The balance of a holding comes from the wallet read, and a row never moves it.
Rows do feed other money values, so "the row is one ledger line" was too short.

| Surface | Fed by a row? | Code | Effect of a row with a wrong amount, a missing row, or a stale row |
|---|---|---|---|
| Holding balance, Home total, net worth now | No | `addManyDedup` ("never touches `holdings`"); `removeSyncedRows` | None |
| Net-worth line, past points | Yes | `createHoldingValuer`: opening = balance - sum of rows | A wrong number in the past only; the point for now stays right |
| Holding detail, `earlierHistory` line | Yes | `ExchangeHistoryFooter`: balance - sum of rows | A wrong number: off for Bybit (PLANNER CALL 27) |
| Holding detail and Home lists | Yes | the row itself | A wrong or missing line |
| Date field, default range of Statistics | Yes | `spanStart` in `statistics.screen.tsx`: the earliest row sets it | The oldest row moves the start of the line and of the date picker |
| Bond start day on the line | Yes, a debit in the bond's currency | `reconcileBondFunding` matches a debit on any holding by amount and a 7-day window, with no marker test | A leg in USD or EUR near a bond's typed price can shift when that bond starts on the line, by up to 7 days, as for Binance |
| Spending donut and trend | Yes, a withdrawal or other debit | `spendingRowsIn`; Binance's pin "imports a USDT withdrawal as spending in the default category" | Off by at most the fee. A missing withdrawal is spending not shown |
| Transfer and exchange legs in spending | No | `exchangeExcludedTransactionIds` (the counterpart marker) | None |
| 2-minute transfer matcher | Yes, unmarked rows only | `rowsForTransferMatch` drops a row with a pair id or a marker | Equal amounts inside 2 minutes pair, as for Binance. A trade or convert leg is never a partner |
| Funding matcher | No | `fundingOf` needs a `p2p`, `card` or `bank` code; Bybit writes none | None |
| Loan payment matcher | Yes, an unmarked debit | `isEligibleTransaction` refuses a counterpart holding and an untracked counterpart | An auto link a user can undo, as for Binance. A trade or convert leg is never a candidate |
| A listed Funding ledger row (stage F) | Past line, lists, date field and bond start day: yes. Spending, 2-minute matcher, funding matcher, loan matcher: no | `createHoldingValuer` sums every row; `exchangeExcludedTransactionIds` and `rowsForTransferMatch` drop a row with an `untrackedCounterpart`; `fundingOf` needs a `p2p`, `card` or `bank` code; `isEligibleTransaction` refuses the marker; `reconcileBondFunding` has no marker test | Section 3, "Stage F". A debit in a bond's currency can shift that bond's start on the line by up to 7 days, as for Binance |

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
| A row that waits | Any owed row (rules 13 to 17) | | As if the move had not happened | Its amount, until it imports; a caption shows | Part of O63 (d) |
| A false match (new, O65) | 100 USDT deposit that lands on Unified, and a P2P credit of 100 USDT on Funding within 7 days | 0, then 100, then 200 | The deposit row explains the credit, so 100, then 200, then 200 | +100 before the credit: the same as with no ledger. A lost row, and no count shows | No: new, O65 |
| A held row (new, O65) | The same, with a credit of 99 | 0, then 100, then 199 | The credit is held: 99, then 199, then 199 | +99 before the credit: the same as with no ledger; `bybitFundingHeld` counts it | No: new, O65 |
| A ledger row over 7 days from its source (new, O65) | A deposit of 100, and its ledger row 8 days after it | 0, then 100, then 100 | -100, then 0, then 100 | A double count: -100 until the second row. No page states a delay; a withdrawal's whole `createTime` to `updateTime` counts as distance 0 | No: new, O65 |
| An Earn move under a word Kiko has not seen, with Earn read (new, O65) | Deposit 100, stake it from Funding in a read product, with a ledger word on no list | 0, then 100, then 100 | 100, then 200, then 100 | A double count: +100 until the stake. With clause "E2 and E4" the case cannot happen | No: new, O65. It goes to the user: PLANNER CALL 57 |
| A Funding move to a read wallet that is on no list (new, O65) | Deposit 100, then a Funding to Unified move that the transfer list does not hold | 0, then 100, then 100 | 100, then 200, then 100 | A double count: +100 until the move. The page says the list holds "the internal transfer records between different account types under the same UID", so this is outside the pages | No: new, O65 |
| A purchase from Funding (new, O65) | A Bybit Card payment of 100 listed by the ledger | Spending 100 | The past line is true. Spending shows 0 (PLANNER CALL 56) | Spending short by 100 | No: new, O65 |
| A stock or RWA trade (new, N8) | Deposit 100 USDT, buy a stock with it | Counted money: 0, then 100, then 0 | -100, then 0, then 0 | -100 before the trade. `bybitLogLeftOut` names stocks | No: new, O66 |
| A loan entry (new, N8) | A loan of 100 USDT to Unified, then buy 1 X at 100 | 0, then 100, then p (a debt is not counted) | 100, then 100, then p | +100 before the loan. A coin with a live spot borrow is refused alone (rule 6) | No: new, O66 |
| A sub-account move (new, N8) | Deposit 100, then move it from Unified to a sub-account | 0, then 100, then 0 | -100, then 0, then 0. From Funding, if the ledger lists it: the truth. The log's `TRANSFER_OUT` is silent | -100 before the move | No: new, O66 |
| A card purchase or reward on Unified (new, N8) | Deposit 100 to Unified, a card purchase of 20, a card reward of 5 | 0, then 100, then 80, then 85 | -15, then 85, then 85, then 85. On Funding, if the ledger lists them: the truth | -20 before the purchase and +5 before the reward, and spending short by 20 | No: new, O66 |
| A summary row with a `tradeId` (new, O66 (b)) | Three fills of .001 X and one summary row of .003 X that also holds a `tradeId`, bought for 3 USDT, no fee. X is worth p | 3 before the trade | 6 - .003 p before the trade, then .003 p after it | 3 - .003 p before the trade: the gain or loss since that day, with no sign. No page states such a row. The guard of section 3 stops only a summary row with an empty `tradeId` | No: new, O66. It goes to the user |
| A convert also shown as a spot `TRADE` (new, O66 (b)) | Deposit 100 USDT to Unified, convert it to 1 X, and the log also holds that convert as a spot `TRADE` | 0, then 100, then p | 100 - p, then 200 - p, then p. With p = 60: 40, 140, 60 | 100 - p before the convert, with no sign. No page says so, the keys differ, and no guard reaches it. P8 and P9 on testnet can show it, shape only | No: new, O66. It goes to the user |
| A burst over the log's lane (new, N1) | Over 1,000 log rows, of any type, inside one span of a minute or less (17 rows per second) | The truth of the moves | The forward cursor stays at the burst, so later spot trades do not import: as A's offset for each of them, for as long as that burst is past the floor. The caption stays up, and its words "will keep importing" do not hold for this burst | The sum of the trades behind it. MEASURED: section 5 | No: new, O66. It goes to the user |

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
| `depositType` 10, 20, 50 | Status alone is not enough (PLANNER CALL 30): the page gives type 20 "hit AML deposit" and type 50 "has been blocked", with no word on their status. Only 0 imports; the others owe their point, or their span with no time (rule 47). An absent or unknown type is unreadable and owed | The row waits; if every row lacks the field, no deposit row shows, and the caption shows | Missing rows, one series |
| Deposit rollback after status 3 | Rule 14. Inside the 29-day re-scan or a point: 7 and 70013 owe, 70011 removes the row, 70012 keeps it. Outside: the line stays. The enum page calls status 3 final unless a rollback occurs, so this is rare. A longer re-scan costs 3 more calls per extra window on every run (Q3) | A stale deposit line. Before the deposit, the past line reads low by that amount | A wrong number in the past; named in Q3 and Q5 |
| A new field or word | The parser reads named fields only. An unknown status or wallet word is owed | A row waits | A missing row |
| Spot row amount (stage E) | `change`, checked: `change + fee = qty` in exact decimals, with an empty `fee` as 0 (PLANNER CALL 40). QUOTE "Change = cashFlow + funding - fee", and both TRADE and SETTLEMENT samples on the page add up. All of them are linear rows, so no page shows a spot row, and `cashFlow`'s words name no spot case. QUOTE for `qty`: "Spot: the negative means the qty of this currency is decreased, the positive means the qty of this currency is increased". So `qty` carries the leg, and `cashFlow` and `funding` are not read. A row that fails the check owes its span as one range tagged `log`, rule 47's shape, and never a point per row (PLANNER CALL 65; was: its point). The other rows of the span import, and a read that passes the check clears the range | Every spot row fails the check: no trade imports, and the caption shows. The past is then A's, never worse. Size on the busy seed of 5,000 rows: at most 12 ranges (`MAX_PENDING_RANGES`), about 1 KB of JSON per list write, about 150 `sameGround` calls per `distinctGround`, and at most the lane's 20 calls per run, COMPUTED (was: about 2,500 points, about 210 KB, about 9M calls, review N3) | Missing rows, one series |
| Base and quote legs (stage E) | Each log row is one coin (`currency`), so a leg is a row. The other coin comes from `symbol` minus `currency`, as a prefix or a suffix. Neither or both (a fee in a third coin, or an odd symbol): the row owes its span as one range tagged `log` (PLANNER CALL 65; was: its point, which a user who pays each fee in a third coin would grow with no bound). The fee sits inside `change`, so no fee row exists | A leg with a third coin waits: a missing row of its fee size | A missing row |
| One row per fill or per order (stage E) | No page says which. A row imports alone, under its own key, so the sum per coin is the sum of `change` under both forms: three fills of .001 with fee .000001 give .002997, and one row of .003 with fee .000003 gives .002997 (A65). The list then shows one row per log row, not one per order: a span cannot sum an order that crosses into the next window with no key that moves (PLANNER CALL 50). If Bybit lists both a summary row and its fills, the sum doubles; no page says so, and P8 prints rows per order. A guard (PLANNER CALL 64): `tradeId` is read for presence only, never stored, and a spot row with an empty one owes its span as one range tagged `log`. Every sample on the live page has a `tradeId`, and no page states that a summary row has none, so the guard stops only that form of a summary row: see the table below this one | Under the pages, none. See the table below this one | A wrong number in the past, the trade's gain or loss since that day; never a current balance |
| Row key (stage E) | `<acc>:log:<id>:<type>:<transactionTime>:<COIN>` (PLANNER CALL 38). The page says "Unique id", yet its own sample gives one `id` to a SETTLEMENT row and a TRADE row, so `id` alone is not a key. A second row with the same key and another `change` in one span: both owe their point | A row waits | A missing row |
| A coin with no holding (stage E) | `placeWalletRows` makes `<COIN>:unified` at zero through `ensureExchangeHoldings`, for a row's coin and its counterpart, so a coin sold out still has its past. The wallet read writes it at zero after that. Such a holding can show 0, as rule 45 states for FUND | None for money | A holding at 0 |
| An untracked coin on a trade (stage E) | `isTrackedBybitAsset` false: its row is counted, its point returned, its ticker in `untrackedCoins`, no row. The tracked leg still imports, with `untrackedCounterpart` `asset:<COIN>` as its marker. Both untracked: no row. A code `untrackedAssetCode` refuses: owed | The money leaves the line at the trade, which is right for a coin Kiko does not count | None for counted money |
| The FUND gap (stage E, then stage F) | The log covers UNIFIED only (QUOTE "Query for transaction logs in your Unified account"). Was: a Funding move that is no deposit, withdrawal, transfer or convert has no row in 1.4, and PLANNER CALL 46 keeps `/v5/asset/fundinghistory` out. Now: stage F reads that route (O65), and a row lists by rule 51. Spot trades happen on Unified | A wrong match: section 3, "Stage F" | A lost row, or in the named cases a double count |
| Convert in both lists (stage E) | Rule 50: the log never imports `CURRENCY_BUY`, `CURRENCY_SELL` or `CONVERT`, and the convert history is the one source (PLANNER CALL 39). A web convert out of UNIFIED that the history lists with a `funding` word lands on FUND: the per-wallet past differs and the sum holds, as in rule 45. A UTA convert the history does not list is a missing row, with those log rows named in `bybitLogLeftOut`. A convert shown as a spot `TRADE` would double: no page says so, no guard reaches it, and P8 and P9 can show it on testnet ("What stays wrong") | See the reading | A missing row at worst, under the pages. Outside the pages, the named double count |
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

So the guard trades a double count with no sign for a missing row with a caption, which O62 asks for ("never guessed into a shown money value"). Its worst world loses all of stage E. That world is the one a free read can test: P8 on testnet prints the count of spot rows with an empty `tradeId`, and a count over 0 on a fill drops the guard (a report to the orchestrator). The world it guards against has no free read.

Never read, and stated in the UI: P2P orders (O5), SmartLeverage, BYUSDT token, derivatives P&L, loans. A ledger row can hold the
money of one of these, as a Funding move with a fixed label: it reads nothing of the order. Not read in
1.4, and stated in the UI: the Unified log's entries other than spot trades, Earn orders and yield (O37, O64;
the outlines are under Backlog).

### Stage E: spot trades and converts (O64)

Every row of this table is docs only. A `type` is never "seen on the small account" (was: that allowlist, rulings "The log allowlist"; no account has such rows): the list is closed, from the page.

| Series | Endpoint and params | Window | Page | Row fields used | Key per row | Wallet | Evidence | Probe |
|---|---|---|---|---|---|---|---|---|
| Log | GET `/v5/account/transaction-log`, `accountType=UNIFIED`, `startTime`, `endTime`, `limit=50`, `cursor`; list `result.list`. No `category` and no `type` in the request, so every entry can be named in the line | 7 days (QUOTE "endTime - startTime <= 7 days"), floor 729 days (QUOTE "up to 2 years") | 50, default 20, cursor | Always `type`, then `category` for a `TRADE`. For a spot `TRADE` also `id`, `symbol`, `currency`, `qty`, `fee`, `change`, `transactionTime`, `orderId`. `userId` is not on this route. `tradeId` only as present or empty, never stored (PLANNER CALL 64; was: never read). Never read: `side`, `cashFlow`, `funding`, `size`, `tradePrice`, `feeRate`, `bonusChange`, `cashBalance`, `orderLinkId`, `extraFees`, `displayType`, `transSubType` | `<acc>:log:<id>:<type>:<transactionTime>:<COIN>`. Pair `<acc>:trade:<orderId>:<symbol>`; the symbol names both coins | UNIFIED | QUOTE, live page. `transactionTime` QUOTE "(ms)". Permission not stated | Docs only; P8 on testnet, step 7 |
| Convert | GET `/v5/asset/exchange/query-convert-history`, `index`, `limit=100`; list `result.list`. No `accountType`, so all wallet types come back (QUOTE "Return all wallet types data if not passed") | None: the route has no time parameter | 100, `index` from 1, no cursor | `accountType`, `exchangeTxId`, `fromCoin`, `toCoin`, `fromAmount`, `toAmount`, `exchangeStatus`, `createdAt`. Never read: `userId`, `extInfo`, `convertRate`, `fromCoinType`, `toCoinType` | Pair `<acc>:convert:<exchangeTxId>:<FROM>:<TO>`; each leg the pair id plus `:` plus its holding key | By the word (safe readings) | QUOTE, live page. QUOTE "API key permission: \"Exchange\"". `createdAt` has no stated unit; the sample has 13 digits, and the digit rule holds | Docs only; P9 on testnet, step 7 |

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
- Log: `planWalkPasses`, `runWalkPlan` as is, and `readCursorSpan` with a split to 1 minute (section 5, "The pager rule"), one series named `log`, so an unreadable time, a failed spot check, a third coin and an empty `tradeId` each owe a tagged range (rule 47's shape). Only a same-key conflict keeps points, and it is rare. `reach` per rule 18. A row outside the span is `bybit-page-drift`. QUOTE "During periods of extreme market volatility, this interface may experience increased latency or temporary delays": a late row falls behind the cursor, and the re-scan of 7 days reads it.
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

Every row here is docs only. The page shows one sample row. Nothing below rests on a real row until step 7 of the testnet run, and then for shape only.

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

2. **Pair.** A candidate is a ledger row and a source with the same coin, the same direction, an equal amount under a form, and a distance of at most W = 7 days. The distance is 0 inside the extent, and otherwise the gap to it. Candidates sort by form order, then distance, then ledger key, then source key, and each takes its pair if both are still free. So pairing is one to one and does not depend on order. Two equal rows at one time do not share one source. A pair gives `explained`.
3. **Earn.** Any row left whose words are on `EARN_PRINCIPAL_WORDS`, when the shipped clause reads Earn or holds E3, gives `earnMove`: no row and no count (PLANNER CALL 57).
4. **Wait.** Any row left, when its source series may not have shown its source yet, gives `waiting`. That is: the row's time plus H = 1 day is past the cursor of a series of its direction, or owed ground of such a series, a point or a range, lies within W of it, or no convert pass has ended past that time and the row is under W old at the run's `now`, an input (PLANNER CALL 68; was: with no age limit, so a convert `cursor` that stayed null held every row for good). A deposit, internal deposit or withdrawal holds only rows of its own direction. A transfer and a convert hold both.
5. **Hold.** Any row left with a free source of its coin and direction within W gives `held`. The source shows that some move near it has no ledger row, and this row may be that move in a form no page states (PLANNER CALL 54).
6. **List.** Any other row gives `listed`.

Which failure is worse decides each choice: a missed match is a double count, which is new harm from this feature. A false match or a held row is a lost row, and the line then equals the line with no ledger, which the user read in O64.

The window: no page states a delay. W is one constant, and the test passes it in.

| W | Result | Number |
|---|---|---|
| Too narrow: 0 | A ledger row 1 s after its deposit is listed: a double count | -100 before the second row, for each such 100 |
| Chosen: 7 days | A source with a real partner pairs with the nearest row, so a wider window costs it nothing. A deposit with no ledger row can take an equal row within 7 days | +100 before a credit of exactly 100 within 7 days of a Unified deposit of 100 |
| Too wide: 729 days | That lost row can happen with a credit of the same amount at any time, and a round amount recurs | +100, for each such row, over 2 years |

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
| M16 | S deposit 100; L In 100, 8 days later, and truly its own | Listed: a double count | -100 before the second row. The one missed match left under the pages |
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
| M28 | The same, 8 days old | Listed | None: a move no stored source explains. A convert that lands later pairs, and the next reconcile removes the row (M16 stays the only missed match) |

The failure the user named (O65) has its own kind of proof: A89 runs M16 and M23 through `buildNetWorthSeries` and asserts the double count by number, so a change to the window or the words moves a test. A90 does the same for the lost rows M12 and M15. Q10 and Q11 pin that no other world can double.

#### Arrival order

The walk code answers this. `commitSettledSpan` writes rows, then marks. `planWalkPasses` moves a series' `cursor` only by a commit, and a run can stop at any commit. A pending deposit makes no row at all (rule 47). So when a ledger row is read, its source may be unread, may be waiting, or may be in no store. A decision taken once, when the ledger row arrives, cannot be right in all of these. A hold alone is not enough either, because a source can land behind its cursor through the re-scan.

So no decision is stored (PLANNER CALL 52). Rule 51 runs on the whole set at the end of each run, and the write brings the rows to its result:

- Each source walk writes its record to the stored set in the same `add` as its row, before its marks. A `remove` deletes the record with the row.
- The ledger walk writes each read row to the stored set, and writes no transaction row. So no walk ever waits for another.
- `reconcileFundingLedger`, in its own `logOnFailure` after the last walk, makes no call: it adds a row for `listed`, removes a row for a verdict that left `listed`, and patches the counts.
- A key with no stored ledger row is never removed. So a reconnect or a partly read set takes away nothing.

| Case | What happens | Line |
|---|---|---|
| The ledger row is read before the source window | `waiting`, by step 4, until that series passes it by H | As with no ledger. The caption is up, because that series is behind |
| A deposit waits with a time (10011, 10012, 0) | Its point is owed: In rows within W are `waiting` | As with no ledger, with the caption |
| A deposit with no time (rule 47) | The tagged range is owed: In rows within W of the span wait, and Out rows do not | The same, as long as the range stays |
| A withdrawal under review, ledger row at request | Its point is owed: Out rows within W wait; when it settles it pairs | The same |
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
| An unreadable row: `ioDirection` outside I and O, a malformed `txnAmt`, a time of another digit count | The span owes one range tagged `fundingLedger`, not a point per row, so `pending` stays bounded (N3, PLANNER CALL 60) | `isOwedPast`, `MAX_PENDING_RANGES` |
| One key with two values | Both owe their point, as PLANNER CALL 38. A same-key conflict is rare, so a point holds | Rule 47's shape |

`EARN_PRINCIPAL_WORDS` is a closed list of `showBusiType` and `description` words: at this text `fundingAccountRecordEarn`, unless `description` is `fundingAccountRecordFlexSavingInterestDistribution`, the page's only words. Set 1 step 10/11 adds what P19 prints around K4, K5 and K11, "on testnet".

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
- A day over `cap x 100` rows does not stall: `readCursorSpan` splits below a day, to 1 minute, the same split as `log` (O66 (a), PLANNER CALL 63; MEASURED, section 5). A span of a minute or less with over 2,000 rows holds this lane only.
- A repeated `nextPageCursor` ends the span when the page holds no new key, and is `bybit-page-drift` only with a new key: a page past the end must not hold the caption for good (N5). The re-scan reads the same ground again, and the key makes a repeat harmless. P19 prints which form the route has.
- This walk reads by time, so it has no pass-end replacement of owed ground and needs no new store (N4). It depends on N4 only through the convert `cursor` above.
- The stored set is `funding_match_rows`, one row per ledger row and per source (PLANNER CALL 51), read by account on its primary key.

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
| HTTP 403 | forbidden | 10 minutes cooldown; text fits both a ban and a US or China IP (O3) |
| 10010 | ip | Refusal text; a bound IP does not fit a phone |
| 10028 | not unified | UNIFIED fails strict; text from the generic failure |
| any other | unknown | Past stored `expiredAt`: class expired. Otherwise generic failure |

## 5. Call counts

Call counts are COMPUTED from the windows, limits and code named. The limit numbers are MEASURED 2026-11-04 (R1, P16,
`X-Bapi-Limit`). The header gives a number, not its time unit: the units below are from research J, and call 45 of R1 does
not fit a rolling minute for transfer (a fixed minute with a boundary can fit; not resolved). The 1100 ms gate holds under
both readings. Floor `now - 729 days`, windows from `buildWalkWindows`. One page per window per series unless a seed says
otherwise. Connect has its own count (section 6.8).

### First run and steady state per series

Stage A has no walk: 5 calls every sync, outside the gate, as Binance's balance reads are.

| Stage | Series | Route limit (research J) | Window | Windows to floor | First read, calls | Steady, calls per run | MEASURED after |
|---|---|---|---|---|---|---|---|
| A | query-api | 10/s | | | 1 | 1 | R1 for the limit |
| A | wallet-balance | 50/s | | | 1 | 1 | R1 for the limit |
| A | coins-balance | 5/s | | | 1 | 1 | R1 for the limit |
| A | earn position x2 | 10, unit not known | | | 2 | 2 | R1 for the limit; P3 for the reads, if Earn ships |
| B | deposit | 100/min | 29 d | ceil(729/29) = 26 | 26 | 2 | R1 for the limit and floor; the real walker (set 6) for the runs |
| B | internal | 300/s | 29 d | 26 | 26 | 2 | same |
| B | withdraw | 300/min | 29 d | 26 | 26 | 2 | same |
| B | transfer | 60/min | 7 d | ceil(729/7) = 105 | 105 | 2 | same |
| E | log | 25/s | 7 d | 105 | 105 | 2 | the real walker (set 9); P8 on testnet for the row shape only |
| E | convert | 50/s or 100/s (section 3) | none | | 1 + ceil(rows/100) | 1 + ceil(rows/100) | set 9 |
| F | funding ledger | 30/s (QUOTE, live page) | 7 d | 105 | 105 | 2 | the real walker (set 10); P19 on testnet for the row shape only |

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
| 1,001 rows in 30 s | The same | 21 | 30, 602. Depends on where a span edge falls: the next row is the case that stops | | |
| 1,001 rows in 1 s | The same | 21 | Never commits: 20 calls on every run. This lane only, and the forward cursor holds. "What stays wrong", the burst row | | |
| 5,000 rows in a day, even | The same | | 23, 462 | | |
| A day of 100,000 rows, even | 10 days old | | 167, 3,322. Was: never commits; 1,636, 32,722 with no plain hint | | |
| The same, 400 days old | | | 162, 3,225 | | |
| The same, 3 days old | Inside the re-scan | | Forward 166; the first whole re-scan ends at run 336, 6,709 calls. While that day is under 7 days old, each re-scan pass costs about 170 runs, and owed points keep their 1 call | | |

The table's N1 rows and the two seeds that also ran, perps bot 53, 1,050 and busy 6, 106, are MEASURED 2026-11-04 on this repository's `planWalkPasses`, `runWalkPlan`, `walkSpans` and `halfOf`, with a model of `readCursorSpan` over a row list, lane 20, page 50, 15 minutes between runs. Each row meets the lane: no run spent over 20 calls. A page exactly full may cost one more. `bybit.convergence.test.ts` replaces them with the real reader in set 9.

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
| 5,000 rows in a day, even | The same | | 15, 282, MEASURED | |
| A day of 100,000 rows, even | The same | | 93, 1,849, MEASURED (400 days old: 88, 1,742) | |
| Over 2,000 rows inside a span of a minute or less | | | Never commits: this lane only (computed from the log's case) | |

Reconcile reads every stored row of the account on each run. Its cost at the 5-coin seed is not known: set 10 step 5/6 measures it with 100,000 rows on real SQLite, and a result that blocks the JS thread is a report to the orchestrator, never a loosened rule.

### The pager rule and its convergence

`readCursorSpan` (`src/crypto-sync/bybit/`, PLANNER CALL 6) reads one span of one series by following
`nextPageCursor` to its end, and checks `canAfford` before every page. Pages already read are held
in memory and commit together. Its parameter `minSplitMs` is a day for capital and transfer, and 1 minute for `log` and `fundingLedger` (PLANNER CALL 63, O66 (a)). Budget short before the end:

- before the first page of a span: it returns `undefined`, and the hint stays, so a run with no calls left never narrows a hint (was: not stated, and a split with no read would run down to the minimum for free).
- after a page, span wider than `minSplitMs`: it returns `split`, `walkSpans` stores the narrower span as a hint, and the
  next run starts from there. A span with at most cap x 50 rows then commits.
- after a page, span of `minSplitMs` or less: it returns `undefined`, and the hint stays.

The plain hint (PLANNER CALL 63): `runWalkPlan` drops a resume on a forward or re-scan pass, because the cursor keeps what those passes read. So after a commit, the next run starts again from the whole 7-day window, and halves again, one halving per run. `log` and `fundingLedger` wrap `walkSpans` in one Bybit helper, `plainHintOf`, that turns a resume on those two passes into a plain hint `{ start: resume.from, end: hint.end }`. `holdsStart` keeps it, and a hint only narrows a read, so it skips no ground. No shared code moves, and a Binance walk is byte-identical. On the seed of 100,000 rows, that is the difference between 167 and 1,636 runs (section 5). Capital and transfer stay as they are.

A day holding more rows than `cap x 50` (1,000 transfers or 1,500 of one capital series) never
commits, the cursor holds, and the caption stays up. The ledger waits and the balance is right. Those are missing rows, so the past
and spending stay wrong until the day commits, and on such a day that is never. Accepted for transfers and capital series by Q3 (b). The log no longer extends it (O66 (a); was: PLANNER CALL 48, a bot's busy day held that account's trades for good, and 1,000 log rows of any type in a day stalled the lane). The log's limit is now a burst over 1,000 rows inside one span of a minute or less. A 7-day window halves to 73.8 s and then to 36.9 s, the last span that can split being over 1 minute. An accepted residual; the coordinator's report puts it to the user (section 3, "What stays wrong").

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

Stages A, B, E and F ship (Q1, O62, O64, O65). UNIFIED and FUND ship on the mainnet read and the testnet run. Deposits, internal deposits,
withdrawals, transfers, spot trades, converts and the Funding ledger ship docs only. Earn ships only by "What proves Earn" (section 10), and otherwise clause "E2 and
E4" states that it is not read. Was: only a kind that passed on the small account on device ships, and a kind the user
cannot produce stays unread.

| Surface | Text | Depends on |
|---|---|---|
| Connect screen | `bybitConnectLimits`, `bybitKinds` | `bybitKinds` per kind set (section 8) |
| Help topic `connectCrypto` | a new Bybit step, which ends with the `bybitKinds` text | per kind set |
| Holding footer `notListedKey` | `holdingDetail.exchangeNotListed.bybit` | per kind set |
| Account detail | `bybitKinds` in the connected section, expiry line, coin lines, `bybitWalletRefused`, `bybitEarnLeftOut`, `bybitLogLeftOut`, `bybitFundingHeld`, `bybitFundingNoId` | per kind set |
| Statistics, net worth card | `statistics.bybitPastLimits`, under the line, only with a Bybit account in the filter scope (PLANNER CALL 45) | none |
| Catalog row | existing `exchangeConnectable`, `exchangeDisclaimer` | none |

A kind set is the outcome of P3 on testnet (O15, O62). These surfaces and the policy name the exact shipped kinds.
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
  caller, because a copy of 212 lines fails `check:dup`. No Binance test changes.
- `createWriteSerial` in `exchange/credentials`: per-account write queue and tokens for Bybit.
  Binance's file stays as it is, repair path included (PLANNER CALL 5; backlog to adopt it).
- `ExchangeKeyForm` from `BinanceCredentialsField`: shared two inputs, disclosure, Connect row and
  status; each provider field passes its verify, save and copy. Binance's suite stays green unchanged
  (PLANNER CALL 11).

O7's silent seams, each with a test that fails first:

| # | Seam | Change | Red pin, on the parent |
|---|---|---|---|
| 1 | `ensureExchangeHoldings` gate `!== 'binance'` | `isWalletHoldingInstitution`: `binance`, `bybit` | a Bybit row needing a new holding creates it, real SQLite |
| 2 | `records.ts` `source: 'binance'` | `source` on `ExchangeWalkConfig`, typed `BalanceProviderId` | placed rows carry the config's source; Binance unchanged |
| 3 | Section gates `=== 'binance'` | `hasExchangeHistory(provider)`, a table typed `Record<BalanceProviderId, boolean>`, so a new id does not compile with no decision; tracked predicate per provider. Plan set 3 step 6/7, the step that adds the id (O30) | with the real `bybit` id: an exchange that has history renders paused, coin lines and behind captions, and the coin lines use the Bybit predicate. Every `balanceProviderIds` member has a gate decision (A42) |
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
but did not run it; set 2 step 1/4 RUNS it: at the pre-id tip, a fixture file with a Bybit account,
holdings, `source: 'bybit'` rows, walk state and `bybitCredentials` restores on that build (the shape
of a 1.3 build). The output goes in that commit body. If it throws, the decision flips to a bump and the
orchestrator reports it. The permanent test on the new build is a round trip of the entry, plus the
existing tolerance pins.

### 6.7 Same-account provider switch (O11)

Traced: `isPickLocked` (`isEdit || accountRowStarted || accounts.length > 0 || isRowUnknown`) gates
only the create and edit form, and `ExchangeTypeField` is disabled there once a row exists, so the form
has no switch path. The path is `ConnectExchange` on account detail: after a disconnect, with a `bankId`
that names no wired provider, its sheet offers every visible entry. Old holdings keep their metadata
(`disconnectExchange` keeps keys), and `isSyncedHolding` tests any synced field, so they would read as
synced with no sync updating them.

Decision (O11 default, kept): `ConnectExchange` shows `exchangeSwitchRefused` instead of the form when
the shown entry conflicts with a holding on the account. Picking Bybit conflicts with `binanceAsset` or
`walletAddress`; picking Binance or a wallet conflicts with `bybitAsset`. Binance to wallet stays as today
(PLANNER CALL 13). After a disconnect those holdings are unsynced, so the user may delete them, or use a
new account. Pure helper `conflictingExchangeHoldings`, with a table test.

### 6.8 Key check on connect

Binance's precedent: `BinanceCredentialsField` verifies by `fetchAccount` and checks no permission;
only the help text asks for a read-only key (`git grep apiRestrictions`: 0 hits). Connect refuses a key that cannot read a
shipped kind, before any Keychain write, with a text that names the reason (PLANNER CALL 2 with O13, PLANNER CALL 25):

| Check, in this order | Refusal | Level |
|---|---|---|
| `readOnly` not 1, in `query-api` | `bybitKeyNotReadOnly` | MEASURED 2026-11-04: number, 1 on a read-only key |
| `isMaster` not true, absent included | `bybitKeyNotMain` | MEASURED: boolean, true on a main key. QUOTE, withdrawal page: "Can query by the master UID's api key only" |
| One real read of each shipped route answers 10005: UNIFIED, FUND, deposit, internal deposit, withdrawal, transfer, log, convert, the Funding ledger, and Earn if it ships | `bybitKeyMissingPermission`, one remedy with no kind named (was: `{{kind}}`, cut: every kind has the same remedy) | MEASURED: UNIFIED gives HTTP 200, 10005 on a key with `Wallet` and `Earn` only. The convert route needs the `Exchange` box (QUOTE, guideline), which "every read box" holds. docs only for the log, convert and the ledger until the empty read (section 10). The ledger page names no permission, so what a narrow key gets is not known; a 10005 there refuses it, by the same text |
| Any other refusal of those reads | Its text from the table of section 4 | docs only, except 10001 and 131203 |

Connect call count: `query-api` and 9 routes make 10 calls with no Earn category, 11 with one, 12 with both (was: 9, 10 or 11, before the ledger; before that 7 or 9, which left out one category, and no log or convert). A32 locks the count per kind set. History reads use `limit=1` and a window of one day,
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
uses Кіко in uk, ʼ for the apostrophe. The wording shows clauses E1, M2, W1, F1, F2, F3 and L1. Set 7 picks the Earn clause by the
testnet outcome, from the clause table below, and clause "E2 and E4" holds with no passing reading. A row changed or added
by a ruling states its level in the key cell. A row that carries a level other than QUOTE or MEASURED is copy that set 1
step 10/11 re-checks against the output. kiko:translator's review of this table stays owed at set 7. This table holds the final text, trades and converts
included: set 4 writes `bybitKinds` as it stands here, and no tip before set 7 has a way in, so no user reads it before set 9 is in the same batch.

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
| `bybitKinds` (E1, M2, W1, L1; O64, O65. Level: UNPROBED(P3) for Earn; docs only for the rest. Was: "It does not read trades, converts, ..."; no Funding record) | Kiko reads your balances (Unified, Funding, Flexible Savings, On-Chain Earn), deposits, including those sent by another Bybit user, withdrawals, transfers between Funding and Unified, spot trades, converts and your Funding wallet's record. It does not read P2P orders, other Earn products, derivatives or loans. Bybit's deposit and withdrawal records do not say which wallet they used, so Kiko lists them all on Funding. Your current balances are not affected. The text of clause L1 follows here, word for word. | Кіко читає ваші баланси (Unified, Funding, Flexible Savings, On-Chain Earn), поповнення, зокрема від іншого користувача Bybit, виведення, перекази між Funding і Unified, спотові угоди, конвертації й журнал вашого гаманця Funding. Він не читає замовлення P2P, інші продукти Earn, деривативи й позики. Записи Bybit про поповнення й виведення не вказують, який гаманець використано, тож Кіко показує їх усі на Funding. Це не впливає на ваші поточні баланси. Далі йде текст пункту L1 слово в слово. |
| `bybitKeyRejected` (O25, O39 C1: fits a wrong key and a key of Bybit EU or another regional site. Level: QUOTE EU 7.4 for Bybit EU; UNVERIFIED for another regional site, so "may not") | Bybit did not accept this key. Check the key and the secret. Kiko works only with global Bybit accounts: it does not support Bybit EU accounts, and a key from another regional site may not be accepted here. | Bybit не прийняв цей ключ. Перевірте ключ і секрет. Кіко працює лише з глобальними акаунтами Bybit: він не підтримує акаунти Bybit EU, а ключ з іншого регіонального сайту тут може не підійти. |
| `bybitKeyNotReadOnly` | This key can do more than read. Create a read-only key on Bybit and connect with that one. | Цей ключ дозволяє більше, ніж читання. Створіть на Bybit ключ лише для читання й підключіться з ним. |
| `bybitKeyNotMain` (new, O13. Level: MEASURED for the field; a key that is not a main key is docs only) | Bybit does not show this key as a main account key. Create a read-only key on your main Bybit account and connect with that one. | Bybit не показує цей ключ як ключ основного акаунта. Створіть ключ лише для читання в основному акаунті Bybit і підключіться з ним. |
| `bybitKeyMissingPermission` (new, O13, changed by O61 (d). Level: MEASURED 10005 on UNIFIED. Was: named `{{kind}}` through seven `bybitKindName` values, cut because all seven share one remedy) | This key cannot read everything Kiko needs. Tick every read box Bybit offers for this key, or create a new read-only key with all of them, then connect again. | Цей ключ не може прочитати все, що потрібно Кіко. Позначте для нього всі дозволи на читання, які пропонує Bybit, або створіть новий ключ лише для читання з усіма ними, потім підключіться знову. |
| `bybitLogLeftOut` (new, O64, PLANNER CALL 41. Level: QUOTE for the words) | Unified log entries not imported: {{kinds}}. | Записи журналу Unified, які не імпортовано: {{kinds}}. |
| `bybitLogKind.*`, the values of `{{kinds}}` (new; a list, joined by the app's list format) | `derivatives` derivatives; `convertEntries` convert and liquidation entries; `interestAndLoans` interest and loans; `bonuses` bonuses and airdrops; `earn` Earn moves; `stocks` stocks; `custody` custody entries; `other` other entries | `derivatives` деривативи; `convertEntries` записи конвертацій і ліквідацій; `interestAndLoans` відсотки й позики; `bonuses` бонуси й аірдропи; `earn` рухи коштів Earn; `stocks` акції; `custody` записи кастоді; `other` інші записи |
| `statistics.bybitPastLimits` (new, F14, PLANNER CALL 45; under `statistics`, not `accountDetail`) | Clause L1S, whole (PLANNER CALL 69; was: "Bybit: the past of this line can be off.", then L1 word for word, then "Your current balances are not affected.") | Пункт L1S, повністю |
| `bybitFundingHeld` (new, plural, O65, PLANNER CALL 54. Level: docs only) | one: Kiko did not list {{count}} Funding move, because it looks like a move Kiko already has but does not match it exactly. other: Kiko did not list {{count}} Funding moves, because they look like moves Kiko already has but do not match them exactly. | one: Кіко не показав {{count}} рух коштів у Funding, бо він схожий на вже наявний запис, але не збігається з ним точно. few: Кіко не показав {{count}} рухи коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно. many: Кіко не показав {{count}} рухів коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно. other: Кіко не показав {{count}} руху коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно. |
| `bybitFundingNoId` (new, O65, PLANNER CALL 60. Level: QUOTE for the field; docs only for a row with none) | Bybit gave some Funding moves no ID, so Kiko did not list them. | Bybit не надав ID деяким рухам коштів у Funding, тож Кіко їх не показав. |
| `transactionRow.fundingLedgerMove` (new, O65, PLANNER CALL 56; the developer greps the namespace `row-description.ts` reads) | Funding wallet move | Рух коштів у гаманці Funding |
| `bybitWalletRefused` (new, O13. Level: MEASURED 10005 on UNIFIED) | Bybit refused this key for {{wallet}}, so Kiko did not update that balance. Check the key's permissions on Bybit. | Bybit не дозволив цьому ключу читати {{wallet}}, тож Кіко не оновив цей баланс. Перевірте дозволи ключа на Bybit. |
| `bybitEarnLeftOut` (new, plural, O18. Level: UNPROBED(P3)) | one: Kiko left {{count}} Bybit Earn position out of this balance, because its status is not one Kiko counts. It may be a position you already redeemed. other: Kiko left {{count}} Bybit Earn positions out of this balance, because their status is not one Kiko counts. They may include positions you already redeemed. | one: Кіко не врахував у цьому балансі {{count}} позицію Bybit Earn, бо її статус не входить до тих, які він рахує. Це може бути вже погашена позиція. few: Кіко не врахував у цьому балансі {{count}} позиції Bybit Earn, бо їхній статус не входить до тих, які він рахує. Серед них можуть бути вже погашені. many: Кіко не врахував у цьому балансі {{count}} позицій Bybit Earn, бо їхній статус не входить до тих, які він рахує. Серед них можуть бути вже погашені. other: Кіко не врахував у цьому балансі {{count}} позиції Bybit Earn, бо їхній статус не входить до тих, які він рахує. Серед них можуть бути вже погашені. |
| `bybitKeyValidUntil` | Bybit key works until {{date}}. | Ключ Bybit діє до {{date}}. |
| `bybitKeyEndsSoon` (plural) | one: Bybit key ends in {{count}} day. Renew it on Bybit; the key stays the same. other: Bybit key ends in {{count}} days. Renew it on Bybit; the key stays the same. | one: Ключ Bybit діє ще {{count}} день. Подовжте його на Bybit; ключ лишається той самий. few: Ключ Bybit діє ще {{count}} дні. Подовжте його на Bybit; ключ лишається той самий. many: Ключ Bybit діє ще {{count}} днів. Подовжте його на Bybit; ключ лишається той самий. other: Ключ Bybit діє ще {{count}} дня. Подовжте його на Bybit; ключ лишається той самий. |
| `bybitKeyEnded` (O26. Level: UNPROBED(P17) for renewal after the date, so both routes) | Bybit key ended on {{date}}. Balances are as of the last sync. Try to renew it on Bybit: the key then stays the same, so there is nothing to enter here. If Bybit offers no renewal, create a new key, then disconnect and connect again. | Дія ключа Bybit завершилася {{date}}. Баланси показано станом на останню синхронізацію. Спробуйте подовжити ключ на Bybit: тоді він лишиться той самий, і тут нічого вводити не треба. Якщо Bybit не пропонує подовження, створіть новий ключ, потім відʼєднайте й підключіть Bybit знову. |
| `bybitKeyExpiryUnknown` (O60) | Kiko could not read when this Bybit key ends. A key with no IP restriction lasts about 90 days. | Кіко не зміг прочитати, коли завершується дія цього ключа Bybit. Ключ без обмеження за IP діє приблизно 90 днів. |
| `bybitKeyRefusedExpired` (O26, O60. Level: UNPROBED(P17)) | Bybit no longer accepts this key. Its term of about 90 days may have ended. Try to renew it on Bybit: the key and secret then stay the same, so you do not enter them again. If Bybit offers no renewal, create a new key, then disconnect and connect again. | Bybit більше не приймає цей ключ. Можливо, його строк дії (приблизно 90 днів) минув. Спробуйте подовжити його на Bybit: тоді ключ і секрет лишаться ті самі, і вводити їх знову не треба. Якщо Bybit не пропонує подовження, створіть новий ключ, потім відʼєднайте й підключіть Bybit знову. |
| `bybitKeyRefused` | Bybit refused this key. If you deleted it or changed your password, create a new key, then disconnect and connect again. | Bybit відхилив цей ключ. Якщо ви видалили його або змінили пароль, створіть новий ключ, потім відʼєднайте й підключіть Bybit знову. |
| `bybitForbidden` | Bybit refused the connection: too many requests, or Bybit does not serve your current network location (for example the US or mainland China). Kiko waits 10 minutes before trying again. | Bybit відхилив зʼєднання: забагато запитів, або Bybit не обслуговує ваше поточне мережеве розташування (наприклад, США чи материковий Китай). Кіко зачекає 10 хвилин, перш ніж спробувати знову. |
| `bybitClockOff` | Bybit refused the request because this device's clock is off. Turn on Set Automatically in Date & Time settings. | Bybit відхилив запит, бо годинник цього пристрою неточний. Увімкніть «Автоматично» в налаштуваннях дати й часу. |
| `bybitRequestFailed` | Bybit request failed: {{code}} | Запит до Bybit не вдався: {{code}} |
| `bybitMissingBalances` | Bybit account response did not contain a balances list | Відповідь рахунку Bybit не містила списку балансів |
| `exchangeSwitchRefused` | {{exchange}} cannot connect here because this account still holds holdings of another exchange or wallet. Add a new crypto account, or delete those holdings first. | {{exchange}} не можна підключити тут, бо цей рахунок ще містить активи іншої біржі чи гаманця. Додайте новий крипторахунок або спершу видаліть ці активи. |
| `bybitCoinBorrowed` (O27: fits a first connect, with no last balance. Level: SUMMARY for the borrow fields; UNPROBED(P2)) | {{coin}}: Bybit shows a loan against this coin, so Kiko does not read its balance. A balance shown here is from an earlier sync. | {{coin}}: Bybit показує позику під цю монету, тож Кіко не читає її баланс. Баланс, показаний тут, узято з попередньої синхронізації. |
| `disconnectProviderMessage.bybit` | This clears the connection and the stored API key. Your holdings and transactions stay as a manual snapshot. | Акаунт буде відʼєднано, а збережений API-ключ очищено. Ваші активи й транзакції збережуться, і ви можете й надалі керувати ними вручну. |
| `untrackedCoins` (changed) | Not tracked: {{tickers}}. Kiko does not import a currency its {{exchange}} sync does not support. | The existing uk line with Binance replaced by `{{exchange}}`; the output for Binance stays byte-identical |
| `holdingDetail.exchangeNotListed.bybit` (E1, M2, W1, F1, F2, F3; O15, O25, O39 C1, O62, O64, O65. Level: UNPROBED(P3) for Earn; docs only for the rows; QUOTE the P2P guide for the P2P clause, with no probe (O5, O49); QUOTE for the convert date; QUOTE EU 7.4 for Bybit EU; UNVERIFIED for another regional site, so "may not". Was: "trades, converts" not listed; "records older than Bybit keeps") | Not listed: interest, bonuses, airdrops and other Unified log entries that are not spot trades; converts made on the website or in the app before 10 September 2025; Earn orders and yield; P2P orders, which Bybit's API opens only to advertisers; Earn products other than Flexible Savings and On-Chain; derivatives profit and loss; loans; sub-accounts; and records older than two years. Bybit's deposit and withdrawal records do not say which wallet they used, so Kiko lists them all on Funding. Your current balances are not affected. Deposit and withdrawal amounts are as Bybit reports them, with no separate fee line. A spot trade's amount already holds its fee. A Funding wallet move is one no other Bybit record explains; it does not count as spending, and one that looks like a record Kiko already has stays out. Kiko does not support Bybit EU accounts, and a key from another regional site may not be accepted. | Не показано: відсотки, бонуси, аірдропи й інші записи журналу Unified, крім спотових угод; конвертації на сайті чи в застосунку до 10 вересня 2025 року; замовлення й дохід Earn; замовлення P2P, бо API Bybit відкритий для них лише рекламодавцям; продукти Earn, крім Flexible Savings і On-Chain; прибуток і збитки деривативів; позики; субакаунти; записи, старіші за два роки. Записи Bybit про поповнення й виведення не вказують, який гаманець використано, тож Кіко показує їх усі на Funding. Це не впливає на ваші поточні баланси. Суми поповнень і виведень показано так, як їх повідомляє Bybit, без окремого рядка комісії. Сума спотової угоди вже містить її комісію. Рух коштів у гаманці Funding — це запис, якого не пояснює жоден інший запис Bybit; він не рахується як витрата, а рух, схожий на вже наявний запис, Кіко не показує. Кіко не підтримує акаунти Bybit EU, а ключ з іншого регіонального сайту може не підійти. |
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
| E1 | P3: Earn money is separate; both categories tested. UNPROBED(P3) | none, the default | Balances: Unified, Funding, Flexible Savings, On-Chain Earn | Баланси: Unified, Funding, Flexible Savings, On-Chain Earn |
| E2 | No on-chain position to test. UNPROBED(P3) | In `bybitKinds`, the list loses On-Chain Earn, and this follows. In the footer, "Earn products other than Flexible Savings", and this follows | On-Chain Earn is not read, so money there is not in your balance. | Він не читає On-Chain Earn, тож кошти там не входять до вашого балансу. |
| E3 | P3: no separate Earn money. UNPROBED(P3) | In `bybitKinds`, the list becomes Unified, Funding, and this follows. In the footer, the Earn products clause goes, and this follows | Money in Earn already counts inside those balances, so Earn has no holding of its own. | Кошти в Earn уже входять до цих балансів, тож окремого активу Earn немає. |
| E4 | The redeem on testnet: a redeemed row has no `status` and a non-zero `amount`, so FlexibleSaving does not ship (O31). UNPROBED(P3) | In `bybitKinds`, the list loses Flexible Savings, and this follows. In the footer, "Earn products other than On-Chain", and this follows | Flexible Savings is not read, so money there is not in your balance. | Він не читає Flexible Savings, тож кошти там не входять до вашого балансу. |
| E2 and E4 | Both outcomes hold, so no Earn category is read. UNPROBED(P3) | In `bybitKinds`, the list becomes Unified, Funding, and this follows. In the footer, the Earn products clause goes, and this follows | Earn is not read, so money there is not in your balance. | Він не читає Earn, тож кошти там не входять до вашого балансу. |
| M1 | Was the default when a sender was needed (O15). A record since PLANNER CALL 31; no probe in 1.4 | none, the default | deposits sent by another Bybit user (named as not read) | поповнення від іншого користувача Bybit (названо як те, що не читається) |
| M2 | P5 passed with a real sender | In `bybitKinds`, "deposits" gains this, and the not-read item goes. In the footer, the first item goes | deposits, including those sent by another Bybit user | поповнення, зокрема від іншого користувача Bybit |
| W1 | Rule 45 outcome (b): no page names the wallet. Docs only (O62) | Added to the footer and to the end of `bybitKinds` | Bybit's deposit and withdrawal records do not say which wallet they used, so Kiko lists them all on Funding. Your current balances are not affected. (was: "Your balances", changed because a row feeds the past of the net-worth line) | Записи Bybit про поповнення й виведення не вказують, який гаманець використано, тож Кіко показує їх усі на Funding. Це не впливає на ваші поточні баланси. |
| F1 | Rule 41: no page says whether `amount` holds the fee. Docs only (O62) | Added to the footer | Deposit and withdrawal amounts are as Bybit reports them, with no separate fee line. | Суми поповнень і виведень показано так, як їх повідомляє Bybit, без окремого рядка комісії. |
| F2 | Rule 49: a spot row's `change` is net of its fee. QUOTE for the sum; docs only for a spot row (O64) | Added to the footer | A spot trade's amount already holds its fee. | Сума спотової угоди вже містить її комісію. |
| F3 | Rule 51 and PLANNER CALL 56. Docs only (O65) | Added to the footer | A Funding wallet move is one no other Bybit record explains; it does not count as spending, and one that looks like a record Kiko already has stays out. | Рух коштів у гаманці Funding — це запис, якого не пояснює жоден інший запис Bybit; він не рахується як витрата, а рух, схожий на вже наявний запис, Кіко не показує. |
| L1 | What stays wrong (section 3; O64, O65, PLANNER CALL 47). COMPUTED, and QUOTE for the convert date. Was: "Kiko cannot read coins credited by P2P, ... Earn yield, money moved into an Earn product it does not read, interest, bonuses and airdrops", with no wallet named. "Cannot read" left where the ledger may read it, and no gap is called closed: no page shows a P2P row. N8 adds loans, stocks, card purchases and rewards, and moves to a sub-account (was: not named) | Added to the end of `bybitKinds`; the help step takes it through `bybitKinds`. Was: also inside `statistics.bybitPastLimits`, now clause L1S | On Unified, Kiko cannot read coins credited by P2P, converts made on the website or in the app before 10 September 2025, Earn yield, money moved into an Earn product it does not read, interest, bonuses, airdrops, loans, stocks, card purchases and rewards, or moves to a sub-account. It cannot read derivatives profit and loss, or anything older than two years. On Funding, it reads such moves only as far as Bybit's Funding record lists them, and a move that looks like one it already has stays out. The past of your net worth can be off by those amounts. | В Unified Кіко не може прочитати монети, зараховані через P2P, конвертації на сайті чи в застосунку до 10 вересня 2025 року, дохід Earn, кошти, переведені в продукт Earn, який він не читає, відсотки, бонуси, аірдропи, позики, акції, покупки й винагороди за карткою та перекази на субакаунт. Він не може прочитати прибуток і збитки деривативів, а також усе, що старше за два роки. У Funding він читає такі рухи лише настільки, наскільки їх показує журнал Funding у Bybit, а рух, схожий на вже наявний запис, не показує. Минуле вашого капіталу може відрізнятися на ці суми. |
| L1S | The short form of L1 for the phone (PLANNER CALL 69). COMPUTED: under the line at about 48 characters per row. L1 with its two sentences around it would be 636 characters, about 14 rows, on the card that holds the chart. This text is 297 characters, about 7 rows, en, and 312 characters, about 7 rows, uk. The device pass reads it (set 7). The detail moves to `bybitKinds`, on the account's detail, which this text names | The whole of `statistics.bybitPastLimits` | Bybit: the past of this line can be off, because Kiko cannot read every move: P2P credits, Earn yield, interest, bonuses, loans, stocks, card spending, sub-account moves and derivatives, or anything older than two years. Your current balances are not affected. The account's details list them all. | Bybit: минуле на цій лінії може бути неточним, бо Кіко читає не всі рухи коштів: зарахування через P2P, дохід Earn, відсотки, бонуси, позики, акції, витрати карткою, перекази на субакаунт і деривативи, а також усе, що старше за два роки. Це не впливає на ваші поточні баланси. Повний перелік є в деталях акаунта. |

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

**Personal data (O5, O6, O64).** Never parsed into a row, state, log or description: `internal-deposit.address`,
`fromMemberId`, `toAddress`, `fromAddress`, `tag`, `txID`, query-api's `userID`, `inviterID`, `kycRegion`,
`note`; on the convert route `userId`, `extInfo` with `paramValue`; on the log route the value of `tradeId` (the parse keeps only whether it is empty, PLANNER CALL 64), `orderLinkId` (a text the user or a bot typed); on the ledger route `memberId`, `afterAmt`, `showBusiTypeEn`, `descriptionEn`. `showBusiType` and `description` are read as words against a closed list at the parse, and never stored. Parsers read named fields only. A sentinel test covers each. `readOnly` and `isMaster`
hold no personal data; they are read at connect and never stored (O13). `permissions` is not read (section 6.8).

Which ids are stored, and why (stage E): the log `id` only inside its row key, because the key needs it; the page's sample `592324_XRPUSDT_161440249321` reads as holding an account number (an inference), so the policy names it. `orderId` only inside the pair id, because a delete follows the pair. `exchangeTxId` inside the convert's pair id and, for a refused convert, inside its `notImported` entry (`notImportedEntry`), so the policy names refused records too (was: "only inside the convert's pair id"). `tradeId` is not stored: the key does not need it, and the guard needs only whether it is empty. `currcCursor` only inside the row key and the stored set (O65): the page's sample decodes from base64 to a plain number (an inference), so the policy names it as an ID of that record. The stored set holds coin, direction, amount, time and that key for each ledger row and source, also for a ledger row with no row of its own, so the policy names it.

**Privacy policy.** Section 3 of `docs/privacy-policy.en.md` and `docs/privacy-policy.md` gets the two blocks
below (E1 and M2 wording; O24, O13, O15, O34, O62, O64).

> en: **Bybit** (`api.bybit.com`): using your read-only API key: details of the key itself (whether it is
> read-only, whether it belongs to your main account, and when it ends); your balances of
> every coin and fiat currency (Unified, Funding, Flexible Savings, On-Chain Earn); your deposit history, including
> deposits sent by another Bybit user, your withdrawal history; your transfers between your Bybit wallets; your Unified
> account's transaction log, from which Kiko imports spot trades; your convert history; and your Funding wallet's transaction record.
> Bybit's answers can include your Bybit user ID and the sender's or recipient's address, email, phone number or Bybit user ID. They reach only your device,
> and Kiko does not keep those details. Kiko keeps on your device the tickers of coins it does not track or could not read, the wallets and
> the number of Earn positions it left out, the kinds of log entries it did not import, the date your key ends, and, inside each
> imported trade or convert and each convert it could not import, Bybit's IDs of that record and its order, which can hold your account number; for each move of your Funding
> wallet's record and each move matched to one, its coin, direction, amount, time and Bybit's ID, also for one that Kiko does not list; this also travels in a `.kiko` export.

> uk: **Bybit** (`api.bybit.com`): за допомогою вашого API-ключа лише для читання: дані самого ключа (чи він
> лише для читання, чи належить вашому основному акаунту й коли завершується його дія); ваші
> баланси всіх монет і фіатних валют (Unified, Funding, Flexible Savings, On-Chain Earn); історія ваших поповнень,
> зокрема від іншого користувача Bybit, історія виведень; перекази між гаманцями Bybit; журнал операцій вашого акаунта
> Unified, з якого Кіко імпортує спотові угоди; історія ваших конвертацій; журнал операцій вашого гаманця Funding. Відповіді Bybit можуть
> містити ваш ID користувача Bybit, а також адресу, email, номер телефону чи ID користувача Bybit відправника або отримувача. Вони надходять лише на ваш пристрій, і Кіко цих
> даних не зберігає. Кіко зберігає на
> вашому пристрої тікери монет, які не відстежує або не зміг прочитати, гаманці й кількість позицій Earn, які він
> не врахував, види записів журналу, які він не імпортував, дату завершення дії ключа, а також, у кожній імпортованій угоді чи
> конвертації та в кожній конвертації, яку він не зміг імпортувати, ID цього запису й замовлення в Bybit, де може бути номер вашого акаунта; для кожного руху коштів із журналу гаманця Funding і кожного
> зіставленого з ним запису — монету, напрям, суму, час та ID у Bybit, також для руху, який Кіко не показує; це також переноситься в експорт `.kiko`.

The counterparty text says "does not keep", because the response reaches the device and the parser drops it
(O24). The level of the sentence "can include": QUOTE, live pages: `toAddress`, `fromAddress`, "Email address or phone
number" for the internal `address` (O6, O34), `fromMemberId`, a withdrawal `toAddress` that can be a Bybit UID (F12, read on the page by the review), and `userId` on the convert route. The kept data holds no row value: rows live in the ledger, as Binance's do.

Policy variants per kind set (O15; level UNPROBED(P3), and a variant is true only when its outcome is
measured). M2 is now the block above, so its row is a record. With no passing testnet reading, "E2 and E4" holds:

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
7. The empty mainnet read, the first key, no money (below). It needs no prompt step that matters. Its `R2 P8 P9` waits for set 1 step 11/11.
8. The testnet run, no real money (below). Code that does not need it does not wait for it: only set 3 step 7/7 (Earn), the
   `locked` row, and set 7's choice of the Earn clause wait. Step 7 of the run, the spot fill, also waits for set 1 step 11/11, and no code waits for it.
9. Set 7's device check is on device (below). R7 on 2027-02-05 or later (O55): an open check after the ship (Q4).

No step needs the user's money (O62). R2, R3 and R4 with real money, K1, and K4 to K8 with real money are under Backlog: later,
no date, the user's choice. No code waits for them. No code that needs Bybit comes before the terms verdict.

### The empty mainnet read

R1 printed retCodes only, so no balance body of the empty account is known. The first key, on mainnet, no money:

- `R2 P2`: 2 calls, no prompt (P2 prompts only in R3). It prints the UNIFIED account fields, the FUND result fields, and 0 coin
  rows or the rows that an empty account lists. This fixes the empty-list shape of rule 5, and set 3 fixtures use it.
- `R4 P3`, typing `skip` at the prompt: 4 calls, reading 1 only. The prompt's redeem text does not fit an empty account, and
  `skip` ends it with no reading 2. It prints the Earn position fields on an empty account, for Earn if it ships. A plain `R4`
  would also reach P6's withdrawal prompt, so it is not used.
- `R2 P8 P9`, after set 1 step 11/11: 3 calls, no prompt (was: 2; P9 adds its read past the end). They prove that the first key reaches the log and the convert route, which R1's P11 did not ask, and they give the empty shape and what `index` past the end returns.
- `R2 P19`, after set 1 step 11/11: at most 3 calls, no prompt. It proves that the first key reaches the ledger route, gives the empty shape, and asks a window 729 days back (only a refusal moves a floor, O20).

Neither disturbs R7: they are reads, and none renews anything. No script change is needed for `R2 P2` and `R4 P3`.

### The testnet run

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

The decision on P8 and P9 (PLANNER CALL 44): add them. O37 left them out because stages C and D were deferred, and O64 brings the trade half back. A fill costs no real money, the shape is the largest open item in stage E, and a wrong shape costs all trades. Size: a floor of 150 script lines and 250 test lines, on top of step 8/11, with 2 new paths on the closed list, closed lists for `type` (the 68 words), `category`, `accountType` and `exchangeStatus`, `<other>` for any other word (O46), the coin shape test (O51), and yes or no comparisons, never an amount. Maximum calls: P8 3, P9 2. New sentinels for the fake-curl test: `userId`, `orderLinkId`, `tradeId`, `paramValue`. Nothing waits for it but its own two reads.

P19 (PLANNER CALL 61): inside set 1 step 11/11, the same step. A floor of 60 script lines and 120 test lines on top of that step, 1 new path, new sentinels `memberId`, `afterAmt`, `descriptionEn` and `showBusiTypeEn`. It needs no user step of its own and no money. Earn's words need K4, K5 and K11 to have run, which only an Earn clause that ships needs.

If the account step fails (no access, KYC) or the run cannot start: this track does not decide. The question returns to the user
through the coordinator, with coin rows then resting on the docs and the empty mainnet read, clause "E2 and E4", and `locked` open.
Sets 2 to 6 go on meanwhile, except set 3 step 7/7.

### What proves Earn (rule 46, O54, P3's own words)

Testnet shows shape, so these readings decide the clause. Each is a printed line of P3.

| Category | Ships only if all of these print | Otherwise |
|---|---|---|
| FlexibleSaving | Stake (K4): `wallet (unified + fund) changed (down); position (flexible + onchain) changed (up)`, and `stake check: wallet fall equals position rise yes`, or, when K5 did not leave the wallet, `wallet fall equals flexible rise yes`. Redeem (K11): `flexible changed (down)`, and the redeem check `wallet rise equals the position fall yes` or `equals the fall + claimableYield yes`. Row after K11: gone, or its `amount` zero, or a `status` outside the allowlist. A row with a `status` is decided by rule 46 | Position rose and wallet `equal`: clause E3. Redeemed row with no `status` and a non-zero `amount`: clause E4. Any other line, a `no`, or no reading: clause E4 |
| OnChain | Stake (K5): `wallet fall equals position rise yes`, a row whose `status` prints `Active` or `Processing`, and an allowlist from what printed (default `Active`) | No position: clause E2. Any other line: clause E2 |

Both fail: clause "E2 and E4". Earn money is then not in the total, and the UI states it. E3 needs its own reading, because it claims the
money is already counted. A testnet pass is shape evidence, and this residual is below.

`locked`: `walletBalance` `equal` and `locked` `changed (down)` around the cancel of K3 proves it inside `walletBalance`. The
page's sum reads the same way (section 3), so set 3 reads `walletBalance` from the start. `walletBalance` `changed (up)` means it sits
outside, and a total is too low during an open order. If testnet cannot answer, the question returns to the user: **this is
marked open, and this text does not decide it.** Set 3 step 7/7 and the `locked` row wait for it; nothing else does.

### Accepted residuals (user, O64: Q5 "E + A", after reading the worked example and what stays wrong)

Was: this heading cited O62's sentence as the acceptance, and that sentence accepts no wrong value (F13). O64 is the acceptance: the user read the five leftovers and that no device build shows a deposit or withdrawal row. Two more cases are new since that reading (section 3, "What stays wrong"); the report names them to the user. O65 and O66 add more rows there, each marked "No: new", and the coordinator's report puts the O66 ones to the user.

A testnet row proves shape, not mainnet. "docs only" rows have no live proof at all. The first real row on mainnet is read on a real user's
device, and the app has no remote log, so no fault reaches the developer. What each failure looks like:

| Failure | What the user sees |
|---|---|
| A coin-row shape fault | A refusal text on a balance read |
| A row shape fault | The row is owed, with a caption. A waiting row is a missing row: a wrong past on the net-worth line by its amount, and short spending for a debit (O63 (d)) |
| A fault of meaning in `locked`, or in Earn after a testnet pass | A wrong current balance, with no sign. This is the only way a current balance can be wrong. Only testnet stands against it |
| A fault of meaning in a row (fee, rollback, window, a log row that doubles) | A wrong or missing line, or a wrong past point on the net-worth line or in spending (section 3); never a current balance |
| A status the page does not explain | The row waits, with a caption: a missing row, as above. If that status is an end state, it waits until the floor passes it |
| A fault in the ledger's forms, window or words | A row held and counted, or lost with no sign. A double count only in the cases of section 3, "What stays wrong", and those have no sign |

One real deposit, withdrawal, trade and convert can remove the rows' part of this at a later time (Backlog).

### The device check (O44, plan set 7 step 6/6, "fundamentals done")

On mainnet the account is empty, so a device build shows no coin row and no history row. A release build cannot reach testnet (Guideline
2.5.19: no flag, no host switch in `src/`). PLANNER CALL 34: two builds, one point.

| Build | Proves | Cannot prove |
|---|---|---|
| Real: the set 7 tip, `api.bybit.com`, on the user's phone | Pins; connect with the real key, its refusals and 10, 11 or 12 calls (section 6.8); the expiry line with 2027-02-04; an empty account with "Last sync" and no holding; every stated limit, `statistics.bybitPastLimits` too; disconnect; Binance still syncs | Any coin row or history row |
| Scratch: a scratch clone of the set 7 tip, with `BYBIT_API_ENDPOINT` in its own untracked `.env` set to testnet, on the simulator or on a named device with no real data, by UDID (O63 (c)) | The user sees coin rows on Unified and Funding from a live answer, a balance moving, a zero, Earn if it ships, and, if K2 ran, one transfer through the real walk to two legs and a caption-free list. If K9 filled: a spot trade as two legs through the real log walk, out of spending, with its past on the line. If K10 ran: a convert as two legs. No `src/` edit: the host comes from `@env` | Mainnet parity, pins (the testnet host is unpinned), deposit and withdrawal rows (none exist on testnet) |

Deposit and withdrawal rows show on no device in this track (the user read this, O64). Their proof is the fake-route tests of set 5 and 6, from the page samples. So no device shows a deposit or withdrawal matched against a ledger row either: the fake-route tests of set 10 are its proof (O65). A testnet transfer or Funding convert, if run, shows that match live on the scratch build, as no listed row.

The scratch build NEVER goes on the user's phone (O63 (c); was: "the scratch app is deleted from the device"). It has the one bundle id (`deploy-device.sh` `BUNDLE_ID`), so it installs in place on the real database, and deleting it wipes the real container while `kiko.db.key` stays in the Keychain. Leaving it puts testnet holdings in the real database. A named device means `make deploy DEVICE=<UDID>` on a device that holds no real Kiko data; the coordinator names it. A simulator is shut down after use.

The guard against the scratch host reaching a commit: `.env` is in `.gitignore`, so the edit cannot be staged, and it stays in the scratch
clone, so the worktree's `.env` never changes. A52 fails if a tracked env file, plist or `src/` file names `api-testnet`. A device scratch build runs with `EXPECT=api-testnet.bybit.com` on `make deploy`, because the deploy script warns of stale bundles (F11); a simulator build states the same check by `scripts/bundle-contains.js` on its bundle. The real build
comes from the tip after the scratch check, with `EXPECT=api.bybit.com` on `make deploy`. If the testnet account step failed, only the real build runs, and the report says that no coin row was seen.

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
| Empty read | Next, sections above | Nothing | `R2 P2`; `R4 P3` with `skip`; `R2 P8 P9 P19` | The empty body shapes; reach of the log, convert and ledger routes |
| Testnet | Sections above | Steps 1 to 7 | `--testnet` runs | Shape of coin rows, `locked`, Earn, a spot log row, a convert row, ledger rows and their words |
| R7 | 2027-02-05 or later, the day after the date `expiredAt` printed (O55, O60); an open check after the ship (Q4). The first key costs nothing, so it stays | Have the key and the secret from the password manager; do not renew first | P17 (up to 6 calls). An ok answer from any of the first three calls (`query-api`, UNIFIED, FUND) prints "not expired yet" and ends the part with no prompt, because a renewal before the expiry loses the expiry error until the next expiry: run it again the next day (O57). A `query-api` answer that cannot be about expiry (HTTP other than 200 or 401, HTTP 200 with no `retCode`, or 10002, 10004 or 10016) makes no prompt and no renewal, and a `retCode` rule wins over HTTP 401, so 401 with 10002 stops. A rate limit also makes no prompt and no renewal. HTTP 401 otherwise goes on, because the docs name it for a bad key and an expired key may get it (UNPROBED(P17)). Any other refusal goes on to UNIFIED, FUND and the renewal prompt | The error after expiry, then renewal keeps the key. "`expiredAt` moved" is measured against the date P1 printed: the call before the renewal is refused and gives no date. Until it runs, the renewal row stays UNPROBED(P17), with the copy of O26 |

Everything in research "STILL NEEDS THE KEY". Item 7 is P8 on testnet and item 8 is P9 on testnet (section 10, step 7), both shape only; the order and yield parts of item 12 are under Backlog,
because only the deferred stages need them:

| # | Item | Part |
|---|---|---|
| 1 | Permission and read-only per endpoint | P11, MEASURED 2026-11-04: reach, and 10005 on UNIFIED for the narrow key |
| 2 | Real balance bodies; `equity` vs `walletBalance`; `locked` | P2, the empty read and testnet |
| 3 | Earn in UNIFIED or FUND; a redeemed FlexibleSaving row (O31) | P3, testnet |
| 4 | Wallet receiving a deposit | Docs only: no page names it (rule 45) |
| 5 | Retention, by a refusal only (O20); `createdTime`, `successAt` units | P12 MEASURED: no refusal. Units docs only (section 3) |
| 6 | The real transfer path | MEASURED 2026-11-04: `query-inter-transfer-list` 0, `inter-transfer-list-query` HTTP 404 |
| 9 | `deadlineDay`, `expiredAt`, permissions object | P1, MEASURED 2026-11-04; an IP-bound key stays UNVERIFIED |
| 10 | Error after expiry; wrong-host key | P17; wrong-host stays UNVERIFIED, no EU key exists, and no key goes to a second domain |
| 11 | P2P `simplifyList` for a non-advertiser | Closed, no call: the route is a POST, and the probe is GET only (section 10) and C2 (O49). P14 stays NOT RUN |
| 12 | Earn position shape and limits, limit headers | P3 on testnet; P16 MEASURED |
| 13 | Maximum recv window | P15 MEASURED: 60000 accepted, the largest tried |
| 14 | HTTP status for every call | P16 MEASURED for the routes; refusal codes docs only (section 4) |
| 15 | API terms and brand | Done 2026-11-03: the API Terms PDF by curl, the Global and EU Terms in the browser, the brand clause is Global 40.4(e) (section 9). C7's re-read stays |

Parts, what each must print and which code it unlocks. "Unlocks" below is the old gate: only P1, P2 and P3 still hold one (O62), and
P4 to P7, P13 with rows and P18 with rows run only at the later real-money run:

| Part | Prints | Unlocks |
|---|---|---|
| P1 | query-api names, types, `readOnly`, `expiredAt` shape, UTC date and days left, the value of `deadlineDay` (a day count, not a shape), `uta`, `isMaster` as booleans, `type` (1 or 2; any other value prints only its JSON type), "parentUid is zero" (true or false, never the id), the group and box names inside `permissions` (by a shape test, not a closed list; see the list above) | Set 3 client, set 4 expiry, set 7 connect refusals (O13) |
| P2 | Wallet bodies per coin: names, types, zero listed or not, `walletBalance` zero or non-zero per wallet (O52), `walletBalance` vs `equity` equal or not, `locked`, `spotBorrow`, `borrowAmount`, `bonus` non-zero or not. In R3 only: `walletBalance` and `locked` per coin before and after the cancel of K3, as equal or changed (O50) | Set 3 balances |
| P3 | Two readings around the user's Earn step; never an amount. Per coin: `unified`, `fund`, `flexible` and `onchain` as equal or changed (up or down); wallet (unified + fund) and position (flexible + onchain), each as equal, changed (up) or changed (down), with one fixed sentence for each of the nine pairs of those words, and a tenth sentence, "no comparison", when a reading cannot be compared. Four of the nine sentences (position fell and wallet equal, both fell, wallet fell and position equal, wallet rose and position equal) also say that the comparison cannot be repeated by a new run. Direction says where the coins went, not how many, so on a position rise the stake check prints: wallet fall equals position rise, and wallet fall equals flexible rise, each yes or no, never an amount (O54). When `flexible` falls, the redeem check: wallet rise equals the position fall, and wallet rise equals the fall + `claimableYield`, each yes or no. Per row, after K11 too (rule 46, O31): `status`, and `amount`, `claimableYield` and `totalPnl` as zero or non-zero; `nextPageCursor`. A `status` prints as absent, empty, `Processing` or `Active`, and any other word prints `<other>` (O46): the research lists `Processing` and `Active` for OnChain only, so a FlexibleSaving row can print `<other>`, and that is a result to read. A plain `R4` prints one reading only (O50) | Set 3 Earn |
| P4, P5, P6, P7 | Row names and types, `nextPageCursor` as absent, empty or present with its mask, status words from a closed list per series (`<other>` outside it), unit class of times, id present, amount and fee as zero or non-zero, fee smaller than amount. P4 and P6 also use two balance readings around the user's step (O47): per coin, FUND and UNIFIED as equal or changed; per row and per wallet, change equals amount, and change equals amount + fee, each yes or no, with the sign ignored. A deposit (P4) also prints change equals amount - fee, because a deposit can be credited net of its fee; the withdrawal series (P6) does not print it. P4 reads the rows before the prompt (the pending row, rule 47) and again after it, and the second read is the one compared; P6 reads them after the prompt. P4 and P6 row lines print that row's wallet-hint words, so that a value in the tally can be matched with one row. The K6 prompt asks for two different amounts when both wallets are used. A skip at the prompt prints no comparison. P5 and P7 print no balance drop: P5 is optional, and P7 rows name both wallets. P7 tries both transfer paths. P4 and P6 also print `depositType` values and any field that could tell the wallet, against the wallet that moved (rule 45). P4 with K1 pending prints whether the time is empty, 0, absent or present (rule 47) | Sets 5, 6 |
| P8 (new, O64) | One read of the log for the last 7 days on the chosen host, at most 3 pages. Per row: names and types; `type`, `category`, `side` from closed lists, `<other>` outside them; `currency` by the coin shape test; `qty` sign; `change + fee = qty` yes or no, `change = cashFlow + funding - fee` yes or no; time unit class; `id` present and whether it repeats among rows; rows that share an `orderId`, as a count; whether the two coins of one order share a `tradeId`; spot rows with an empty `tradeId`, as a count (PLANNER CALL 64). No id, no amount | Nothing waits. A shape that differs edits section 3 and set 9 |
| P9 (new, O64) | Convert history, at most 3 calls: page 1, page 2 and one read at `index` 9999, which prints "empty", "same as the page before", "other rows" or the `retCode` (PLANNER CALL 67; was: at most 2 pages). Per row: `accountType` and `exchangeStatus` from closed lists, `<other>` outside them; `fromCoin`, `toCoin` by the coin shape test; largest decimal count of each amount; time unit class; order of `createdAt` on the page as newest first or not. Then, against the same run's P8 rows: whether a log row of the same time window has a word of `CURRENCY_BUY`, `CURRENCY_SELL`, `CONVERT` or `TRADE`, yes or no per word. No `userId`, no `extInfo` | Nothing waits. A shape that differs edits section 3 and set 9 |
| P19 (new, O65) | At most 3 calls: the last 7 days, the next page, and a window 729 days back. Per row: names and types; `ioDirection` from a closed list; `currency` by the coin shape test; `showBusiType` and `description` by a shape test only, `fundingAccountRecord` and letters, otherwise `<other>` (O46; an accepted residual of the O51 kind, because a closed list would hide what this part exists to find; no free server text prints); `descriptionEn`, `showBusiTypeEn`, `memberId`, `afterAmt` never; `currcCursor` present, and whether it repeats; time unit class; largest decimal count of `txnAmt`; `nextPageCursor` mask, and whether a page past the end is empty or repeated. Then against the same run's P7 and P9 rows, per source row: a ledger row of its coin and direction with an equal amount, yes or no, and its delay as under a minute, under an hour, under a day, or more. No id, no amount | Nothing waits, except `EARN_PRINCIPAL_WORDS` for an Earn clause that ships. A shape that differs edits section 3 and set 10 |
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
stays unread, and the UI text says so. A row keeps its UNPROBED mark until its own probe runs (O35): P2 and P3 rows until
the empty read and the testnet run, and P17 rows until R7. A row that rests on the pages is "docs only" and has no such wait (O62).

## 11. Tests

Per kiko-testing: RED first on the parent, real SQLite for a write path, a sweep seed list for a property,
no history note in a test title. Fixtures hold probe shapes or, for a docs-only row, the page's sample shape, never real values. Files are new unless marked;
bare names live in `src/crypto-sync/bybit/`. A row here is the acceptance floor; the developer adds.

### Acceptance rows

| # | Input | Test |
|---|---|---|
| A1 | UNIFIED read fails | `bybit.provider.test.ts`: "a failed UNIFIED read fails the sync and writes no holding" |
| A2 | FUND read fails | same, "a failed FUND read leaves each FUND holding at its last balance" |
| A3 | One Earn category fails | same, "one failed Earn category skips the whole Earn wallet" |
| A4 | Earn body with a `nextPageCursor` | same, "a paged Earn answer fails the wallet read instead of counting part of it" |
| A5 | Coin with `spotBorrow` non-zero | same, "a coin with a borrow keeps its last balance and lists itself" |
| A6 | Empty UNIFIED, held coin absent | same, "a good read that omits a held coin writes that holding at zero" |
| A7 | Dust, no holding | same, "a coin below its dust threshold creates no holding" |
| A8 | SCR, MNT, UAH tickers | `bybit.tracked-coin.test.ts`: "SCR, MNT and UAH are not tracked as fiat" |
| A9 | `retCode` 10006 with HTTP 200 | `bybit.client.test.ts`: "a rate refusal in the body sets the cooldown from the reset header" |
| A10 | HTTP 403 | same, "a 403 sets a ten minute cooldown and shows the text that fits both reasons" |
| A11 | Cooldown active | `bybit.provider.test.ts`: "a cooling account makes no call and returns no balances" |
| A12 | `readOnly` 0 at connect | `src/design-system/components/bybit-credentials-field/bybit-credentials-field.component.test.tsx`: "a read-write key is refused before any Keychain write" |
| A13 | `10003` at connect (O39 C1) | same, "a rejected key shows the text that names a wrong key, Bybit EU as not supported, and another regional key as may not" |
| A14 | `far`, `near`, `expired`, `unknown` | `bybit.key-expiry.test.ts`: "reads each expiry state from the stored date" |
| A15 | 33004, -2015, unknown after `expiredAt` | `bybit.client.test.ts`: "every refusal past the stored date is the expired class" |
| A16 | Renewal: new `expiredAt`, same pair | `bybit.provider.test.ts`: "a renewed key moves the stored date and writes no Keychain item" |
| A17 | Deposit statuses and `depositType` | `bybit.capital-history.test.ts`: "imports only statuses 3 and 70012 with type 0, owes pending, unknown and any other type, ignores 4" |
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
| A32 | 10005 on each shipped route at connect, and the count per kind set (O13, PLANNER CALL 25, F8) | `bybit-credentials-field.component.test.tsx`: "a key refused on any shipped route is refused before any Keychain write, and connect makes 10, 11 or 12 calls by the kind set" |
| A33 | `isMaster` false or absent (O13) | same, "a key not shown as a main key is refused before any Keychain write" |
| A34 | 10005 on FUND on a later sync (O13) | `bybit.provider.test.ts`: "a refused wallet keeps its last balance and records its name for the visible line"; `crypto-sync-section` test: "the refused wallet line names the wallet" |
| A35 | Deposit with no time, empty, 0 or absent, a fixture per form; status 0, status 3 with type 0, type 20, type 50; read again over 29 days later under a window on creation time; status 70011 with no time on a read record whose row exists (rule 14, N9) (PLANNER CALL 37, O63 (b); was: owes nothing, CALL 28) | `bybit.capital-history.test.ts`: "a deposit with no time makes no row, owes its span in the deposit series only, moves the other series and gives no page drift, and imports once a later read shows its time, and a 70011 with no time still removes its row" |
| A36 | Earn row with a status outside the allowlist (O18) | `bybit.provider.test.ts`: "an Earn position outside the status allowlist adds nothing and counts in the left-out line" |
| A37 | Redeemed FlexibleSaving row (O18); fixture from P3 | same, "a redeemed FlexibleSaving row never adds" |
| A38 | An app fiat code outside the five, with a balance (O19) | `bybit.tracked-coin.test.ts`: "a fiat code outside the list lists as not tracked with no amount" |
| A39 | Rule 45 (O14, O62) | `bybit.capital-history.test.ts`, real SQLite: "every deposit and withdrawal row goes on the FUND holding and moves no balance" |
| A40 | Each shipped kind set (O15) | `bybit.shipped-copy.test.ts`: "each surface names each shipped kind and each unread kind, in en and uk". Its table has one row per kind set of section 8, picked by a literal in the test, not by an app flag |
| A41 | P12 refusal and empty 0 (O20) | `bybit.capital-history.test.ts`: "the floor is 729 days back unless the config sets a refused depth" |
| A42 | Every `balanceProviderIds` member (O17, O30) | `exchange-history-gate.test.ts`, beside `binance-history-status.ts`: "every balance provider has a gate decision" |
| A43 | Every `balanceProviderIds` member, set 7 (O21) | `exchange-catalog.test.ts` (edit): "every balance provider has a catalog entry and a registry entry" |
| A44 | Policy intro, counterparty text with the Bybit user ID, and the kept ids, a refused convert's too (O24, F12, O64, N7) | `bybit.privacy-policy.test.ts`: "the section 3 intro names Bybit, the counterparty text names the Bybit user ID and says does not keep, and the kept ids name a refused convert, in the four files" |
| A45 | Expiry text (O26) | `bybit.shipped-copy.test.ts`: "the ended and refused texts give both the renewal and the new-key route, in en and uk" |
| A46 | Coin with a borrow on a first connect (O27) | `bybit.provider.test.ts`: "a borrowed coin on a first connect creates no holding and lists itself"; `bybit.shipped-copy.test.ts`: "the borrowed line does not say a last balance exists" |
| A47 | Earn row with no `status`, `amount` non-zero (O31); fixture from P3 | `bybit.provider.test.ts`: "an Earn row with no status adds its amount" |
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
| A62 | 131203 (R1) | `bybit.client.test.ts`: "a window refusal at HTTP 200 stops the walk as a code fault" |
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
| A83 | The leftovers on each surface, and each gap of N8 (O64, O66, clauses L1 and L1S) | `bybit.shipped-copy.test.ts`: "kinds and help name trades and converts as read, and kinds and the Statistics line state what the past cannot hold with loans, stocks, card spending and sub-account moves, the footer names what is not listed, in en and uk" |
| A84 | Every row of the matrix, M1 to M28 (O65, O66, rule 51) | `bybit.funding-match.test.ts`: "gives each ledger row of the matrix its verdict" |
| A85 | The ledger's fields against the page's sample, and `memberId` as a sentinel, with `afterAmt`, `descriptionEn`, `showBusiTypeEn` | `bybit.funding-ledger.test.ts`: "reads the named fields of the page's row and a sentinel reaches no row, mark or log" |
| A86 | Rows with no `currcCursor`, a bad `ioDirection`, a bad `txnAmt`, a bad time; a repeated cursor with and with no new key (PLANNER CALL 60) | same, "a row with no id owes nothing and marks the line, bad rows owe one tagged range, and a repeated cursor ends the span unless the page holds a new key" |
| A87 | Each case of "Arrival order", real SQLite (O65) | `bybit.funding-ledger.real-sqlite.test.ts`: "each arrival case gives its verdict, and a source that lands late removes the listed row" |
| A88 | A disconnect, a reconnect, a key with no stored row, and a `.kiko` round trip | same, "a reconnect and a restore remove no listed row, and a disconnect clears the stored set" |
| A89 | The two doubles the rule names, M16 and M23, by number (O65) | `bybit.past-line.funding.real-sqlite.test.ts`: "a ledger row past the window and a stake under an unseen word each double by the amount shown" |
| A90 | The lost rows M12 and M15, by number | same, "a false match and a held row each read as with no ledger" |
| A91 | The worked example with the ledger on: paired, and with no pair (O65) | same, "the past of the worked example equals the truth with the ledger on, paired or held" |
| A92 | A ledger row of an unknown word, as a P2P credit, on the row shape only; a rollback's Out past the re-scan | same, "a credit of an unknown word lists and closes its offset, and a late rollback's Out cancels the stale row" |
| A93 | Out and In rows and each exclusion (PLANNER CALL 56) | `bybit.funding-ledger.real-sqlite.test.ts`: "a listed row stays out of spending and of the transfer, funding and loan matchers" |
| A94 | The label in en and uk, and no server text (PLANNER CALL 56) | `src/transactions/row-description/row-description.test.ts` (edit): "a ledger marker renders its fixed label and no server text" |
| A95 | The lines of the counts | The section test beside `crypto-sync-section.component.tsx` (edit): "the held count and the no-id line read persisted state" |
| A96 | The new table (PLANNER CALL 51) | `src/db/schema.funding-match.test.ts`: "the read of one account's rows uses the primary key by EXPLAIN QUERY PLAN" |
| A97 | Stage F in copy (O65, F3, L1; was: also the Statistics line, which L1S leaves short) | `bybit.shipped-copy.test.ts`: "kinds, footer and help state the Funding record, what it leaves out and that it is no spending, in en and uk" |
| A98 | The split, per series, and the plain hint (O66 (a), PLANNER CALL 63) | `src/crypto-sync/bybit/bybit.cursor-span.test.ts`: "log splits to a minute and capital to a day, no run narrows a hint before its first page, and a forward or re-scan resume becomes a plain hint that skips no ground" |
| A99 | The `tradeId` guard in each world of section 3 (O66 (b), PLANNER CALL 64) | `bybit.log-history.test.ts`: "a spot row with an empty tradeId writes nothing and owes one range, a summary row with an empty one does not double, and a summary row with one is the named double" |
| A100 | A failed spot shape on the busy seed (N3, PLANNER CALL 65) | same, "every spot row of 5,000 failing leaves at most 12 ranges and no point, and a same-key conflict keeps its points" |
| A101 | The convert `cursor` null for good (N5, PLANNER CALL 68) | `bybit.funding-ledger.real-sqlite.test.ts`: "a row under seven days waits, an older row lists, and a convert that lands later removes it at that reconcile" |
| A102 | The review's scenario, and each cut (N4, PLANNER CALL 66) | `bybit.convert-history.test.ts`: "an init on page 3 stays owed with its first time through an empty last page, in a pass over two runs, at any cut, and leaves only at the end of a pass that reads it settled" |
| A103 | Over 12 owed points in one pass (N3, N4, PLANNER CALL 66) | same, "over twelve points in a pass become one range with the earliest time" |
| A104 | A log leg that rounds to 0 (N6) | `bybit.log-history.test.ts`: "a log leg that rounds to zero writes no row and leaves the other leg, and a convert leg that rounds to zero writes neither" |

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
| Q9 | Convergence of log and convert under caps, seeds of section 5 with the N1 rows and a seed of failed spot shapes with its bound on `pending`, cut at every commit | `bybit.convergence.test.ts`: "log and convert reach the end within the table's runs, keep pending inside its bound and survive a restart" |
| Q10 | Clean worlds: seeded true moves, each a source with its ledger row, or a ledger row with no source and no equal amount within W; every arrival order, cut at every commit, read twice (O65) | `bybit.funding-ledger.property.test.ts`: "over any arrival order, the past line of a clean world equals the truth, with no double count and no lost row" |
| Q11 | Any world, ambiguous ones included, with no delay past W and no unseen Earn word | same, "no world doubles a source, and the error equals the sum of its false matches and held rows" |
| Q12 | `matchFundingLedger` on any permutation of its input | `bybit.funding-match.property.test.ts`: "the verdicts do not depend on input order, and pairs are one to one" |
| Q13 | Convergence of the ledger under the cap, seeds of section 5, cut at every commit | `bybit.funding-ledger.convergence.test.ts`: "the ledger reaches the end within the table's runs and survives a restart" |

### Red-first seam tests

The nine rows of section 6.5, each in the plan step where the seam changes, shown red on the parent; seam 8 by mutant
(CONFLICT 1). Seams 3, 4 and 9 change in set 3 step 6/7, the step that adds the `bybit` id, red first with the real id;
set 2 does not touch them (O30). Set 2 keeps Binance's suites green, unchanged except the log tag re-pins (O28). Set 3
step 6/7 also changes Binance's status suites: their calls gain the required provider argument, with the same expected
results (A49). Neither adds owed state to any Binance account, so no 1.2-upgrade seed moves. A Bybit account has no
1.2-upgrade world at all.

One migration, in set 10 step 1/6 (O65, PLANNER CALL 51; was: no migration in any set). `source`, `institution`, metadata and `exchange_state` still have no SQL constraint (seam
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
| PLANNER CALL 7 | `BYBIT_RESTART_FLOOR_MS` 2018-01-01 | Any value below the rolling floor reads the same |
| PLANNER CALL 8 | Stage B reuses walk ids `capital` and `transfer` | State is per account, and it avoids the `WALK_IDS` fan-out |
| PLANNER CALL 9 | One gate at 1100 ms | Slowest route sets it; simplest shape that holds every route |
| PLANNER CALL 10 | Near = 14 days | Two weekly cycles of use; a text threshold, cheap to change |
| PLANNER CALL 11 | `ExchangeKeyForm` extraction | A second 240-line field fails `check:dup` |
| PLANNER CALL 12 (count changed by O28) | `walk.ts` log tags become `[exchange sync]`, tests re-pinned: 27 literal lines in 10 test files, one a fixture, not "floor 6" in 2 suites | O7 names the seam; threading a tag through 5 helpers adds surface |
| PLANNER CALL 13 | Wallet holdings conflict with Bybit, not with Binance | O11 covers exchanges; nothing shipped has this pair; today's pair stays |
| PLANNER CALL 14 (changed by O15, reversed by PLANNER CALL 31) | Was: internal deposits ship only with a real sender; with none, the copy states that limit. Now: PLANNER CALL 31 | Was: "only tested data kinds"; the user may have no second Bybit user |
| PLANNER CALL 15 (changed by O21, O64) | The device check builds the set 7 branch before any merge of sets 3 to 7 and 9 | O9 asks for catalog last and after the check; a device needs a way in |
| PLANNER CALL 16 | Keep the 7-day and 29-day windows, no adaptive width | The cursor reader follows pages; no measured need for narrower |
| PLANNER CALL 17 (changed by O33) | One new patch kind `balanceNotes` holds the refused wallets, borrowed coins and Earn left-out count, per wallet: a wallet that this run read replaces its notes, and a wallet that failed keeps them, plus its refused mark when the failure is a 10005 | O13, O18 and rule 6 each need a visible line that reads persisted state; the section reads only that (section 5, "Caption false"). Precedent: `oversizedBalance` and `complete` in `exchange-state-patch.ts` (CODE). It holds no secret, and `exchangeStateReset` drops it |
| PLANNER CALL 18 (part 1 done 2026-11-03, O39) | The browser step splits: the terms come first, before the key moment; the URL check stays at R1 | O23 moves the verdict before code; a forbidding clause found first costs the user no account or money, and the URL check may need a login |
| PLANNER CALL 19 (withdrawn by O30) | None; the id stays retired | See the O30 row of the next table |
| PLANNER CALL 20 (new) | `hasExchangeHistory`, `captionWalksOf` and the tracked predicate table live in the existing `src/screens/account-detail/crypto-sync-section/binance-history-status.ts` | O30 asks for a named source module. An existing module lets a red call a missing export with no import of a missing module, and the helpers it serves are there; O7 keeps the file name |
| PLANNER CALL 21 (new) | The Bybit tracked predicate is a named part of plan set 3 step 6/7, not a step of its own; `isTrackedBybitAsset` itself is written at step 4/6 | O30 asks for a named step and for seam 3 in the step that adds the id. A table typed by `BalanceProviderId` does not compile with the id and no entry, and each step has a green commit that passes the typecheck |
| PLANNER CALL 22 (changed by O37) | K11 moves from R6 to R4. Before set 7's device check, the user subscribes Flexible Savings again if it ships | O31 puts the redeem at R4, and a position redeemed in full leaves nothing to check on device |
| PLANNER CALL 23 (accepted by O41) | The user's approval of the spec moves after the terms verdict, before R1. Set 1's script does not wait for it | O38 puts the paste and the verdict first and names no place for the approval. The approval then covers the verdict, and the script is reviewed meanwhile |
| PLANNER CALL 24 (reversed by O40) | R4 comes after the R3 run of P3 shows the position, with no fixed day | P10's position older than a day was the only reason for a wait, and P10 left. Cost if wrong: R4 is repeated, at no money |
| PLANNER CALL 25 (accepted by O63 (a); count changed by F8 and O64) | Connect reads every shipped route once, not only each wallet: 9 calls, 10 or 11 with Earn (was: 7 or 9). No box list, `permissions` unread, `isMaster` kept | O13 binds "a shipped kind". With the walks kept, a key that reads the wallets and not a history route would pass and then stop a walk with only a log line. The shape is P11's. The withdrawal page says master only |
| PLANNER CALL 26 (new; corrects rule 45's words) | A row feeds the past of the net-worth line, `earlierHistory` and spending, and no current balance | Traced in the code, section 3. So the fee reading holds only as a residual bounded by the fee, not as "no number" |
| PLANNER CALL 27 (reason changed by O64) | `earlierHistory` is off for Bybit, through an optional field on the registry entry; Binance's line stays byte-identical | With every deposit on FUND and the leftovers of section 3, balance minus rows is no earlier history per holding: it would show a wrong amount, often below zero. Trades read do not change this, because the wallet of a deposit is still unknown. `ExchangeHistoryFooter` is the one place |
| PLANNER CALL 28 (not accepted, O63 (b); replaced by PLANNER CALL 37) | Was: a pending deposit with no time makes no row and owes nothing | Its reason stands, and CALL 37 keeps it: `owedBy` gives a no-time record the whole span with no series, and `commitSettledSpan` stops the forward pass on it. So one stuck AML deposit would hold the cursor of all three capital series for good. A wider extent does not work: its point changes with each span and leaves the list only by an exact read (`dropReadPoints`). What it missed: a settled row with no time, and a held row over 29 days, were lost with no trace |
| PLANNER CALL 29 (new; changes the proposal for the window field) | A withdrawal's `extentOf` is `createTime` alone, and its `reach` starts at the floor; a deposit's `reach` has no end; drift tests both readings. The walker stays as it is | An extent of `createTime` to `updateTime` moves when `updateTime` moves, and `dropReadPoints` clears only an exact point, so the old point would stay for good. A pending row outside `reach` would have no point, and that stops the forward pass. A settled deposit read under a window on its creation time can lie past the span end |
| PLANNER CALL 30 (new) | Only `depositType` 0 imports; 10, 20, 50, absent and unknown owe | The page says 20 and 50 are held or blocked, and it states no status for them. Cost if wrong: a missing row with a caption: a wrong past by its amount (O63 (d)) |
| PLANNER CALL 31 (accepted by O63 (a); changes O15's sender rule) | Internal deposits ship docs only, on FUND, with clause M2 and the policy's M2 text | The page covers them (O62), `address` and `fromMemberId` stay unread (O6), and the same safe readings hold. Its 10-digit sample is handled by A60 |
| PLANNER CALL 32 (new) | Set 3 reads `walletBalance` from the start; only the `locked` row and its question wait for testnet | The page's sum reads as `locked` inside. If testnet shows it outside, the fix is one addend, and the question returns to the user |
| PLANNER CALL 33 (new; changes O36) | The set 1 tip is the commit of this text. Earn moves to a new set 3 step 7/7, the one code step that waits for testnet | O62: no code waits that need not. Results of the empty read and testnet land in set 1 step 10/11, and each base picks them up |
| PLANNER CALL 34 (changed by O63 (c)) | The device check holds two builds: a scratch clone on testnet by its own untracked `.env`, on the simulator or a named device with no real data, then the real build | The user asked for correct data end to end (O44), and an empty account shows none. The host comes from `@env`, so `src/` has no switch and 2.5.19 holds. Section 10 has the guard |
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
| PLANNER CALL 54 (new; extends the brief's rule) | A free source near a row holds it, whatever its amount, and `bybitFundingHeld` counts it. No percent tolerance, and no compare at a shorter scale | This turns "a form no page states" from a double count into a lost row. A tolerance would be a guess at a fee. Cost: a real credit near a Unified deposit of that coin stays out, and the count can include rows the source already holds (M8, M14), so the text says "looks like". P19 prints a decimal count and a match, so a scale rule can come as a fix if testnet shows it |
| PLANNER CALL 55 (new; the brief's property is wrong as written) | Two properties, not one: equality on clean worlds (Q10), and on any world no double count, with the error equal to its lost rows (Q11) | "Equals the truth, with no lost row" over any seeded world cannot hold: M12 has one source, one ledger row, equal amounts and no way to tell them apart. A pass would only mean that the seeds avoid it. M16 and M23 stay outside Q11 by name, and A89 pins them by number |
| PLANNER CALL 56 (new) | A listed row is never spending, in either direction, by the marker `ledger:funding`. A fixed label, with no server text stored or shown | An Out row can be a stake, a P2P sale, a move to a sub-account or a card payment, and no list tells them apart: O62 forbids guessing that into a shown value. Spending stays as with no ledger, so a card payment stays short by its amount, and F3 says so. `descriptionEn` is English on a Ukrainian screen |
| PLANNER CALL 57 (new; tests the brief's Earn question) | Words on `EARN_PRINCIPAL_WORDS` list only under clause "E2 and E4". A word on no list always lists. So under any clause that reads Earn, a stake under an unseen word doubles (M23), by its amount, with no sign. No page gives a list, and any safe reading for it costs every unknown row, so the whole feature | Worked numbers in section 3. Under "E2 and E4", the default with no testnet reading, Earn has no holding, so a listing is right and the case cannot happen. An Earn clause ships only after K4 and K11 on testnet, which are also what P19 reads, so the list exists when it matters. The user gets this residual through the report |
| PLANNER CALL 58 (new) | `afterAmt` is not read | It looks like a proof and is none: each ledger row is listed or paired, so a sum over the ledger closes on `afterAmt` under a wrong match too. The sample also has 16 decimals against 8, so a sum would need a tolerance. No surface needs the figure |
| PLANNER CALL 59 (new) | A new set, 10/10, order 2, 3, 4, 5, 6, 9, 10, 7, 8. Not part of set 9. M becomes 10 (was: 9; CALL 43's text stays as the record) | Set 9 is at 12 to 15 files, and together they could pass the cap of 30 mutable files. A migration has its own review. Set 7 bases on set 10's tip, stays last and holds the way in, so Guideline 2.5.19 holds at each tip |
| PLANNER CALL 60 (new; applies N1, N3 and N5 of the review of 32337df0d to this walk) | Bad rows owe a tagged range, not a point each. A row with no `currcCursor` owes nothing and marks a flag. A repeated cursor with no new key ends the span. A day splits to 1 minute | A point per bad row grows `pending` with no bound (N3). A row with no id can never clear a point, and rows before 2026-08-27 may have none; a flag is bounded, on the CALL 41 precedent. A cursor past the end must not hold the caption (N5). A day over the cap must not hold the lane (N1) |
| PLANNER CALL 61 (new) | P19 in set 1 step 11/11, on the testnet step 7 run and the empty read. No new step number in set 1 | The words are the largest open item, testnet costs no money, and K2, K4, K5, K10 and K11 are already there. Printing `showBusiType` is an O51-kind residual: a shape test, not a closed list. O56's stopping rule stays |
| PLANNER CALL 62 (new) | One Kiko row per listed ledger row, no sum per day | A summed row's key and amount would change, as CALL 50 says for an order. If Bybit pays hourly (no page states it), a Flexible Savings user gets 8,760 rows a year per coin in the list. A visual round can fold them, and a sum per day needs no change to the match rule |
| PLANNER CALL 63 (new; N1, O66 (a); corrects the review's "already support it") | `readCursorSpan` takes `minSplitMs`: a day for capital and transfer, 1 minute for `log` and `fundingLedger`. It never splits before a span's first page. A Bybit helper `plainHintOf` turns a forward or re-scan resume into a plain hint for those two lanes | `halfOf`, `walkSpans` and the hints take the split with no higher cap, and it converges. But `runWalkPlan` drops a resume on those passes, so with the split alone each slice of a busy day halves again from 7 days: 1,636 runs on 100,000 rows against 167 with the helper, MEASURED. Capital and transfer keep the day: Q3 (b) accepts them, and "change nothing else" holds |
| PLANNER CALL 64 (new; N2, O66 (b)) | Keep the review's proposal: `tradeId` for presence only, and an empty one owes a range. P8 counts empty ones | Section 3 tests it in six worlds. A fill with an empty `tradeId` owes up to 729 days with a caption; a summary row with no guard doubles with no sign, which O62 refuses. It does not stop a summary row that holds a `tradeId`, which stays a named double count. Every sample on the live page has a `tradeId`, and no page shows a spot row |
| PLANNER CALL 65 (new; N3, O66 (c)) | A failed spot check, a third coin and an empty `tradeId` each owe the span as one range tagged `log`. A same-key conflict keeps points | Points never merge (`normalizePending`), and CALL 41 rejects the same hazard. The third-coin case is not in N3's text; it has the same growth, so it moves too |
| PLANNER CALL 66 (new; N4, O66 (c)) | A second optional mark `passOwed`. A page adds its points to `passOwed` and to `pending`; a pass's end sets `pending` to `passOwed`. Over 12 points become one range tagged `convert` | The hand table of section 3 shows run 2 keeps the point and its `since`, and a settled point leaves only at the end of the pass that read it. Adding to `pending` at once keeps the caption true during a long pass. The cap applies N3 to converts: an unknown status word on every row would owe 1 point per convert. Both marks stay in `exchange_state`, so no migration, and a Binance state keeps its text |
| PLANNER CALL 67 (new; N5, O66 (c)) | An empty page, a repeated page, a refusal of class "any other" at `index` over 1, and `CONVERT_PASS_PAGES` = 1,000 each end the pass. P9 reads `index` 9999 | No page says what `index` past the end returns. The review named a repeat. A refusal and a wrap to page 1 hold `cursor` null in the same way, and a repeat test sees neither, so this also closes those. A rate or key refusal still stops the run. Ending a pass early loses nothing that a later pass can read. Accepted residual, outside the pages: a server that repeats in mid-list hides the rows behind it, with no sign; the coordinator's report names it to the user |
| PLANNER CALL 68 (new; N5, report-o65.md) | Rule 51 step 4 holds a row on the convert gate only under W old, with `now` as an input (M27, M28, A101) | With the gate alone, a route refused for good holds every ledger row for good. Listing an older row is safe, because no decision is stored (CALL 52): while Kiko holds no such convert, the row is the only record of that move, so it is true; when the convert lands, that run's reconcile pairs it. The function still reads no clock |
| PLANNER CALL 69 (new; N8) | Two clauses: L1 in full on the account's `bybitKinds`, and a short L1S as all of `statistics.bybitPastLimits` (was: L1 word for word in both) | N8's four gaps take L1 to 555 characters, and the whole Statistics text to 636, about 14 rows under the chart. L1S is 297, about 7 rows, names the gaps by kind and points to the detail. It leaves out old converts and the Funding sentence, which `bybitKinds` holds. Goal 4 stands: the line still says what the past cannot hold. CALL 45 stands |

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
| O62 | "Tested" | a kind ships only after a pass on the small account on device | docs only rows ship from the live pages; UNIFIED, FUND and Earn rest on the empty read and testnet |
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
| O64 | Probe parts | P8 and P9 reserved under Backlog | in the script from set 1 step 11/11; testnet step 7 |
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
| O65 | Clause L1 | "Kiko cannot read" each kind, on any wallet | Unified and Funding apart; no gap called closed |
| O65 | "What stays wrong" | a stake from Funding "cannot be closed"; P2P always +100 | closed under "E2 and E4", and if the ledger lists it; six new rows |
| O65 | Q3 (a) and (b) | a late rollback leaves a stale row; a stalled day holds its own walk | a late rollback's Out cancels it, if listed; a stalled source day also holds the ledger's later rows of its direction |
| O64 | Copy | "does not read trades, converts" | spot trades and converts read; clauses F2 and L1 |
| O64 | Rule 12 | every row exact at the scale | a log `change` and a convert amount round (PLANNER CALL 42) |
| O59 | The user's spec approval (O41) | not given, so R1 waited for it | given on 2026-11-04: the coordinator relayed the answer "Approve (Recommended)" to the question in the approval report, at tip fc83566e2; the report named four residuals (O51, O46, O56, O58 (a)); R1 has not run; the coordinator gives the user the R1 list and the four residuals, and no other step starts until the coordinator says that the R1 output file is ready |

| Id | Conflict | Kept |
|---|---|---|
| CONFLICT 1 | O7 asks a failing-first test for each of nine seams; seam 8 has no behaviour to change, so a parent red cannot exist | The ruling's row stands; its test is proven by a scratch mutant, per kiko-testing "load-bearing" |

## 13. User questions (Q1 to Q6 answered)

| Question | The user's words, 2026-11-03 | What holds now |
|---|---|---|
| Q1: which stages ship in 1.4 | Was: "Q1 A+B." Then "1 N1, 2 later" (O61). Then, 2026-11-04: "Let's rephrase this: I can't spend money testing what's already covered by api documentation, so implement what you can without relying on my money" (O62; the coordinator's reading was told to the user, who can overrule it). Then Q5 "E + A" (O64) | Balances, deposits, withdrawals, transfers, spot trades and converts. Rows ship docs only, and balances rest on the empty read and testnet. Earn ships only by "What proves Earn". The rest of the log and stage D are deferred under Backlog (O37, O64) |
| Q2: how the user learns of the 90-day expiry | "Q2 detail line + failure text only." | Section 7. No notification |
| Q3: two ledger gaps with no effect on any balance | "Q3 accept the two gaps." | Accepted limits for 1.4, reopened only on a measured case. (a) A deposit rolled back after the 29-day re-scan keeps its row; a longer re-scan would cost 3 more calls per extra window on every run. (b) A day with more rows than a run's calls (1,000 transfers or 1,500 of one capital series) holds its walk, with the caption up; a higher cap would load a pool shared with other accounts |
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

The user's words on the order, the same date: "Spend no money and ask for no account step before the terms verdict."
(O38, section 10.)

Merge order (O21, PLANNER CALLS 43, 59), a recommendation to the coordinator, who owns the merge: set 2 alone; sets 3, 4, 5, 6, 9, 10 and 7 stay out of `next`
until set 7 passes on device, then merge as one batch; then set 8. Detail: the plan, "Merge order".

## Backlog

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
USD stays in the account plus a few USD in fees, and it can be withdrawn after. The rows below are as they stood; `R3` and `R4 P3` on testnet
replace their Earn and `locked` parts in 1.4.

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
