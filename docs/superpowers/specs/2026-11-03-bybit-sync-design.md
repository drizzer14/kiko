# Bybit sync design (track 1.4-bybit)

Status: SPEC READY for the user's approval. Q1 to Q4 are answered (section 13). The terms verdict is in section 9: PASS
WITH CONDITIONS for global accounts. The user accepted the 5.2.2 and 6.5 doubts (O42). No app code and no R1 before the
approval (O41). Base 57130e23c.
Plan: `docs/superpowers/plans/2026-11-03-bybit-sync.md`.

Inputs: `.superpowers/sdd/1.4-bybit/rulings.md` (O1-O50, binding), `terms-verdict.md`, `research-bybit-docs.md`,
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

A number here is a floor or a computed value, never a duration. The developer re-greps every code
fact; symbols are named, not lines.

Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-11-03): this track closes none.
Left open and touched: `20261017T1639-kiko-binance-backfill-fix/1` (the walk-state gate checks the
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
2. Stage B adds rows of tested data kinds, complete on its own.
3. Every limit shows in the UI: global accounts only, the EU limit, the 90-day key, the kinds not
   read (USER ruling).

Non-goals: OKX (USER); the Unified log, converts, Earn orders and yield (deferred, O37, Backlog); a
region field or host list (O1); any P2P call (O5); Earn products other
than FlexibleSaving and OnChain; derivatives P&L; loans; sub-account reads; renames of `Binance*`
name-only lines (O7); Bybit EU accounts (EU 7.4, section 9); a device-region check (Binance precedent C2; terms verdict
line 9).

Anti-goals, each with its guard:

| Anti-goal | Guard |
|---|---|
| A wrong balance | Strict UNIFIED read; a failed wallet keeps its last balance; a coin with a borrow is refused alone; Earn is added only after the double-count probe P3; a paged Earn answer fails the wallet read; an Earn row with a `status` adds only if the allowlist holds that status, and FlexibleSaving does not ship if a redeemed row has no `status` and a non-zero `amount` (O18, O31); connect refuses a key that cannot read a shipped kind (O13) |
| A key leak | Keychain through `hardenedFor`, pins and `no-store` from the first client commit, the `check:plist` regex fix before that commit, no key in a log, state or `.kiko` without the toggle |
| A hidden feature | No flag; the catalog entry and registry wiring land last, after the device check (O9); every kind not read is stated |

What changed from the old spec (`2026-10-15-crypto-exchanges-design.md`, "What 1.3-b adds"), the
was column of each ruling that narrows it:

| Topic | was: old spec | now |
|---|---|---|
| Hosts | a region field and a host list per region, 2 pins each | one host `api.bybit.com`, no retry (O1) |
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
| 3 | Spot strict, others tolerant per wallet | CHANGES | `query-api` first: an expiry class refusal fails the sync at once, any other failure of it is tolerated (keeps the stored expiry). UNIFIED strict (proof of life). FUND tolerant. Earn tolerant, both categories in one guard | CODE for the shape; P1, P2 for the bodies |
| 4 | A malformed top level writes nothing | HOLDS | A body with `retCode` 0 and no `result.list` array is a failure, never a zero | CODE; QUOTE for the envelope |
| 5 | A coin the good read does not list is a zero | HOLDS for UNIFIED | QUOTE "If not passed, it returns non-zero asset info". FUND: whether it lists zeros is unstated; the same zero rule holds either way | QUOTE; UNPROBED(P2) for FUND |
| 6 | A refused coin skips only itself | HOLDS | Malformed or oversized coin omitted alone, logged by wallet only; CHANGES by one reason: a non-zero `spotBorrow` or `borrowAmount` refuses the coin too (PLANNER CALL 3) | QUOTE ("Old walletBalance = New walletBalance - spotBorrow") |
| 7 | Dust and appear rule | HOLDS | `curatedCoins.dustBelow` is neutral: below it no new holding; an existing holding is written, zero included | CODE |
| 8 | Tracked coin list | CHANGES | `isTrackedBybitAsset` = `isCurrency` and (`isCrypto` or `BYBIT_FIAT_CODES`). `BINANCE_FIAT_CODES` is NOT reused | MEASURED, next row |
| 9 | The fiat ticker trap | CHANGES | `BYBIT_FIAT_CODES` = USD, EUR, AED, BRL, PLN: the app's fiat codes among the quote coins of the 520 public spot rows. Two Bybit base coins equal an app fiat code: MNT and SCR, both coins, so neither is fiat. UAH is no Bybit spot quote, so a UAH balance lists as not tracked. The list stays these 5 codes (O19). Whether a wallet can hold another fiat is UNVERIFIED: such a coin lists as "not tracked", visible, with no wrong amount. A complement list could price a new coin as fiat, which is a wrong balance; a short total with a visible line is not | MEASURED 2026-11-03, `/v5/market/instruments-info?category=spot`; re-read at set 3; UNVERIFIED for another fiat in a wallet |
| 10 | Curated coins on the exchange | CHANGES | Of 23 curated coins (floor), ZEC, DAI, FDUSD have no Bybit spot row. They stay tracked: the rule is the app's, not the market's | MEASURED 2026-11-03 |
| 11 | `exchangeMinorUnits`, balances round | HOLDS | Balance use rounds, logged by gap `/2` | CODE |
| 12 | Rows are exact at `baseAssetPrecision` scale | HOLDS, with its effect | A row with more decimals than the scale on a non-`reducedScale` coin stops `amount-precision`: that record stays owed at its point, its other rows import, the balance stays right, and the caption shows once the point is a day old. Public `basePrecision` is at or under the stored scale for every curated coin on spot, but it bounds orders, not deposits, so it proves nothing for a row | CODE; MEASURED 2026-11-03; UNPROBED(P4, P6, P7) for row decimals |
| 13 | Settled deposit | CHANGES | Settled: 3, 70012. Failed, nothing owed: 4. Owed point: 0, 1, 2, 7, 70013, 10011, 10012, any unknown; a row of these with no time owes its span as a range instead (rule 47, O32). 10012 stays owed until P4 shows what it means | SUMMARY (D5/enum); UNPROBED(P4) |
| 14 | Removal of a settled row | CHANGES | 70011 on a read record removes its row through `SettledSpan.removed` (`removeSyncedRows`, by key, no balance move), the fiat precedent. A rollback seen only inside the re-scan or a point: one older than the 29-day re-scan leaves a stale ledger row, while the balance read stays right. An accepted limit: Q3 (section 13) | SUMMARY; CODE |
| 15 | Settled withdrawal | CHANGES | Settled: `success`. Final, nothing owed: `CancelByUser`, `Reject`, `Fail`. Owed point: `SecurityCheck`, `Pending`, `MoreInformationRequired`, `Unknown`, any other, and `BlockchainConfirmed`. The doc does not say how `BlockchainConfirmed` relates to `success`: P6 reads one real withdrawal over time, and only then may it change | SUMMARY; UNPROBED(P6) |
| 16 | Settled internal deposit | CHANGES | 2 settled, 3 final failure, 1 owed | SUMMARY; UNPROBED(P5) |
| 17 | Settled transfer | CHANGES | `SUCCESS` settled, `FAILED` final, `PENDING` and other owed | SUMMARY; UNPROBED(P7) |
| 18 | Second-level reads, `reach` | CHANGES | R36 was Earn only. QUOTE: deposit "the query logic is actually effective based on **second** level"; transfer second-level (SUMMARY). All four Bybit series pass a `reach` with the start floored to the second, harmless if a route reads at the millisecond; a stuck record there owes its own point | QUOTE; UNPROBED(P13) |
| 19 | Oldest to newest within a window | CHANGES | Page order is undocumented for these routes (execution list: descending, equal times unstable, SUMMARY). A span commits as one unit after all its pages, sorted by time then key before `settleRecords`, so page order has no effect on what commits. The sort leaves a row with no time out; that row still reaches `settleRecords`, where it owes the span (rule 47, O32) | CODE; UNPROBED(P13), UNPROBED(P4) for a row with no time |
| 20 | Per-record commits, rows before marks | HOLDS | `commitSettledSpan`, unchanged | CODE |
| 21 | Cursor marks, `patchExchangeState` | HOLDS | Already takes `exchangeId` (`exchangeStateDepsOf('bybit')`). Bybit's opaque `nextPageCursor` is never stored: it lives inside one span read | CODE; PLANNER CALL 6 |
| 22 | Offset paging, drift, `fetchAllByTotal` | N/A | No `total`. The drift rule becomes: a repeated `nextPageCursor`, or a row outside `reach`, is `bybit-page-drift`, owed in that series. A pending row with no time is never `bybit-page-drift`: rule 47 (O32) | QUOTE for the cursor; UNPROBED(P13) |
| 23 | Pending, re-scan and points passes | HOLDS | `planWalkPasses`, `runWalkPlan`, as is | CODE |
| 24 | `MAX_PENDING_RANGES` 12, merged ranges | HOLDS, costlier | A merged gap costs gap/window windows; 7-day windows pay 4 times what 29-day windows pay. Inherited gaps stay open | CODE; COMPUTED |
| 25 | Floors | CHANGES | One rolling floor: `now - 729 days` for every stage B series, the Transfer precedent (`transferFloorMs`, never ask at the documented edge). No stage B series has a stated retention. P12 can move a floor only by a refusal (O20): an empty answer with `retCode` 0 proves nothing and keeps the 729-day floor. A floor that P12 refuses is cut to the oldest window it accepts, never narrowed at run time: `walk/depth.ts` stays out (offset tied) | CODE for the precedent; UNVERIFIED for retention; UNPROBED(P12) |
| 26 | What a rolling floor drops | HOLDS, stated | `cutToBounds` drops owed ground the floor passes, unread, points too. An app left closed past the floor loses the rows of that gap, not any balance. The holding footer says "records older than Bybit keeps" | CODE |
| 27 | `HISTORY_FLOOR_MS` as `restartMs` | CHANGES | `BYBIT_RESTART_FLOOR_MS` = 2018-01-01, earlier than any rolling floor. `planWalkPasses` ignores a mark at or below the floor | CODE; PLANNER CALL 7 |
| 28 | `multiCoinSince`, `multiCoinSeen`, backfill | N/A | No BTC-only history exists, so no walk writes them, and `backfillGroundOf` is not called; a test pins the marks absent | O4; CODE |
| 29 | Disconnect reset | HOLDS | `disconnectExchange(accountId, 'bybit', BYBIT_RESTART_FLOOR_MS)`, then the Bybit clear. `exchangeStateReset` keeps walks only, so the stored key expiry goes with it. Holding keys stay, so a same-account reconnect re-adopts | CODE |
| 30 | Institution gate | HOLDS | Takes the id already; gap `20261017T1639/1` applies within one provider | CODE |
| 31 | Rate limit, cooldown | CHANGES | `retCode` first (O3). 10006, 10018: cooldown to `X-Bapi-Limit-Reset-Timestamp` when usable, else 60 s default. HTTP 403: 10 minutes (docs). Own module Map; a balance read inside it makes no call and returns no balances | QUOTE, SUMMARY; UNPROBED(P16) for the header |
| 32 | Budget | CHANGES | `createBybitRunBudget` behind `RunBudget`: calls per lane only, no weights; `recordFailedCall` analogue counts a refused call. Section 5 | CODE; COMPUTED |
| 33 | One pacing gate per run | HOLDS | `createExchangeRun`, interval from the slowest route read (section 5) | CODE; QUOTE (limits) |
| 34 | `isUnreadableWindowError` | HOLDS | `BybitHistoryParseError` alone; rate limit, refused key, clock skew and network stop the run | CODE |
| 35 | A walk failure never fails the balance sync | HOLDS | `logOnFailure` per walk | CODE |
| 36 | Caption: behind | CHANGES | `CAPTION_WALKS` per provider, with a required parameter and no default to Binance (O30). Reusing the 8 would keep "behind" up forever (`null` cursor). Stage A: none. Stage B: `capital`, `transfer` | CODE; seam 4 |
| 37 | Caption: paused, coin lines, not imported | CHANGES | The `connectedProvider === 'binance'` gates become "an exchange with a walk state". Tracked predicate per provider | CODE; seam 3 |
| 38 | Caption: P2P read failed | N/A | No P2P walk (O5); the gate stays Binance only | O5 |
| 39 | Trades, dust, fiat, Pay walks | N/A | No such routes. 1.4 does not read trades, and the UI states it (O37) | Rulings |
| 40 | Namespaced `externalId` | HOLDS | `<accountId>:` prefix, then the kind, the record id and `:<COIN>` (O4, memory exchange-ids) | CODE |
| 41 | Network fee out of the ledger line | HOLDS until P6 | `amount` only; per wallet, P6 and P4 compare `amount`, and `amount` + fee, against the change between two balance readings around the user's step (O47) | UNPROBED(P4, P6) |
| 42 | `untrackedCounterpart`, wallet codes | HOLDS, unused | Bybit transfers move between UNIFIED and FUND only (accountType enum, SUMMARY). Any other wallet word is `bybit-transfer-wallet-unknown`, owed; `UNTRACKED_WALLETS` gets no member | SUMMARY; UNPROBED(P7) |
| 43 | Funding matcher | HOLDS | Bybit writes no `p2p`, `card` or `bank` code, so `fundingOf` skips its rows. `EXCHANGE_NAME` stays | CODE |
| 44 | Thrown errors are named classes | HOLDS | `BybitHistoryParseError`, `BybitRateLimitError`, `BybitRefusalError` with a fixed message and a `code` | CODE (`kiko-no-literal-sync-error`) |
| 45 | A series knows its wallet (`walletHoldingOf`) | CHANGES | Bybit deposit and withdrawal rows name no wallet (O14). No research line ties `depositType` to a wallet. Outcome (a): P4 and P6 show a field that tells the wallet of every row: the row goes on that holding, and a value the probe did not show owes `bybit-wallet-unknown`. Outcome (b): the API cannot tell: every such row goes on the FUND holding, and the UI states that limit (clause W1, section 8). The balance does not change in any outcome: it comes from the wallet read, and the row is one ledger line | SUMMARY for the field list; UNPROBED(P4) for `depositType`; UNPROBED(P6) for the source wallet |
| 46 | Earn positions add to the Earn wallet | CHANGES | One rule, no guess left (O18, O31). A row with a `status`: the allowlist applies, default `Active`, confirmed by P3; any other status leaves the position out, counted, and the account shows `bybitEarnLeftOut`. A row with no `status`: its `amount` adds. R4 redeems Flexible Savings and runs P3 (section 10). If that run shows a redeemed row with no `status` and a non-zero `amount`, FlexibleSaving does not ship, and clause E4 says so (section 8). A redeemed FlexibleSaving row never adds. The research names `Processing` and `Active` for OnChain only, and a digest says redeemed FlexibleSaving rows still appear | SUMMARY; UNPROBED(P3) |
| 47 | A record has a settle time | CHANGES | The walker stays as it is (section 6.5, reused): `pointOf` gives a record with no time no point, so `owedBy` owes the whole span as a range (O32). So a pending row with no time owes its span, not one point. The history caption shows while the deposit is pending, and this is true: `historyOwesRange` counts a range. The re-read of that span costs pages inside the lane cap on each run while it stays pending. The parser treats an empty, 0 or absent time the same. A pending row never gives `bybit-page-drift`, and the sort of rule 19 leaves it out. P4 also runs while K1 is pending, to show the form. If the user misses that window, the fixture covers all three forms, and this row stays UNPROBED(P4) | CODE for `pointOf`, `owedBy`, `historyOwesRange`; SUMMARY for the field; UNPROBED(P4) for the form |
| 48 | Connect checks no permission (Binance, section 6.8) | CHANGES | Connect refuses a key that cannot read a shipped kind: `readOnly` not 1, `isMaster` not true, or a missing permission box, before any Keychain write, with a text per reason (O13). A later 10005 on one wallet shows `bybitWalletRefused` with the wallet name, and the last balance stays | SUMMARY for the fields; UNPROBED(P1, P11) |

## 3. Data per stage

Every row is UNPROBED unless it says otherwise; the paths, params and limits are from the docs. A
later step replaces "field" guesses with what the probe printed.

### Stage A: balances (5 calls per sync)

| Read | Endpoint and params | Window | Page | Row fields used | Key | Wallet | Evidence | Probe |
|---|---|---|---|---|---|---|---|---|
| Key info | GET `/v5/user/query-api`, none | none | none | `expiredAt`, `deadlineDay` on a sync; also `readOnly`, `isMaster`, `permissions` at connect only, never stored (O13); every other field is dropped at the parse, `userID`, `kycRegion`, `note` never reach state | none | none | QUOTE "Any permission can access"; fields SUMMARY | UNPROBED(P1) |
| UNIFIED | GET `/v5/account/wallet-balance`, `accountType=UNIFIED` | none | none listed | `coin`, `walletBalance`, `spotBorrow`, `borrowAmount`; `equity` and `usdValue` never | `<COIN>:unified` | UNIFIED | QUOTE for the param; fields SUMMARY. `locked` inside `walletBalance`, `bonus`: UNVERIFIED | UNPROBED(P2) |
| FUND | GET `/v5/asset/transfer/query-account-coins-balance`, `accountType=FUND`, no `coin`, `withBonus` left out | none | none | `coin`, `walletBalance`; `transferBalance` never | `<COIN>:fund` | FUND | SUMMARY | UNPROBED(P2) |
| Earn, flexible | GET `/v5/earn/position`, `category=FlexibleSaving` | none | none listed; a non-empty `nextPageCursor` fails the wallet read | `coin`, `amount`, `status`; a row with a `status` adds only if the allowlist holds it, and a row with none adds its `amount` (rule 46, O18, O31) | `<COIN>:earn`, the two reads summed | Earn | QUOTE permission "Earn"; fields SUMMARY; double count UNVERIFIED | UNPROBED(P3) |
| Earn, on-chain | GET `/v5/earn/position`, `category=OnChain` | none | same | same | same | Earn | same | UNPROBED(P3) |

Earn ships as designed only if P3 shows staked coins leave UNIFIED and FUND. If they stay, no Earn
holding is written and the copy says so (clause E3, section 8); the money is then already counted. With no
on-chain position to test, on-chain Earn is not read, and the copy says so (clause E2). If the R4 redeem shows a
redeemed row with no `status` and a non-zero `amount`, FlexibleSaving is not read, and the copy says so (clause E4,
O31). UNPROBED(P3).

### Stage B: moves

Walk ids: `capital` (three series) and `transfer` (one). No new `WALK_IDS` member, so no state
fan-out (PLANNER CALL 8). Windows are half open in the plan; real range ends wait for P13 and the
design holds under both ends through `reach` and the re-scan.

| Series | Endpoint and params | Window | Page | Row fields used | Key per row | Wallet | Evidence | Probe |
|---|---|---|---|---|---|---|---|---|
| Deposit | GET `/v5/asset/deposit/query-record`, `startTime`, `endTime`, `limit=50`, `cursor` | 29 days (QUOTE "less than 30 days") | 50, cursor | `id`, `coin`, `amount`, `status`, `successAt`, `depositType` | `<acc>:deposit:<id>:<COIN>` | Rule 45, by outcome | QUOTE window; SUMMARY rest. `successAt` unit UNVERIFIED | UNPROBED(P4), also with K1 pending (rule 47) |
| Internal deposit | GET `/v5/asset/deposit/query-internal-record`, same | 29 days (QUOTE "maximum difference ... 30 days") | 50, cursor | `id`, `coin`, `amount`, `status`, `createdTime`. `address`, `fromMemberId`: never read (O6) | `<acc>:internal:<id>:<COIN>` | Rule 45, by outcome | QUOTE window; `createdTime` unit UNVERIFIED | UNPROBED(P5). Needs a sender: without one this series is not read |
| Withdrawal | GET `/v5/asset/withdraw/query-record`, `withdrawType=2`, `startTime`, `endTime`, `limit=50`, `cursor` | 29 days | 50, cursor | `withdrawId`, `coin`, `amount`, `status`, `updateTime`, `withdrawType`. `toAddress`, `tag`: never read | `<acc>:withdraw:<withdrawId>:<COIN>` | Rule 45, by outcome | QUOTE window; SUMMARY "master key only": connect refuses a key with `isMaster` not true (O13). A later refusal stops the walk, and the walk logs it. The source wallet is UNVERIFIED | UNPROBED(P6) |
| Transfer | GET `/v5/asset/transfer/query-inter-transfer-list`, `startTime`, `endTime`, `limit=50`, `cursor`. The page's example names another path: P7 settles it | 7 days (QUOTE) | 50, default 20, cursor | `transferId`, `coin`, `amount`, `fromAccountType`, `toAccountType`, `timestamp`, `status` | pair `<acc>:xfer:<transferId>:<COIN>`; each leg the pair id plus `:` plus its holding key | Both named | QUOTE window; SUMMARY rest | UNPROBED(P7) |

Without `withdrawType=2` an off-chain withdrawal is missed: the doc's default is on-chain only
(SUMMARY).

Never read, and stated in the UI: P2P (O5), SmartLeverage, BYUSDT token, derivatives P&L, loans. Not read in
1.4, and stated in the UI: the Unified log with its trades and interest, converts, Earn orders and yield (O37;
the outlines are under Backlog).

## 4. Client facts

- Signing (QUOTE and SUMMARY, D5/guide): GET signed text = timestamp + key + recv window + query;
  `signQuery` as is, it is neutral. Headers `X-BAPI-API-KEY`, `X-BAPI-TIMESTAMP`,
  `X-BAPI-RECV-WINDOW`, `X-BAPI-SIGN`, and `Cache-Control: no-store`. No `Referer`: broker only.
- Recv window 5000 (QUOTE default); P15 reads the maximum. Clock rule QUOTE: "server_time -
  recv_window <= timestamp < server_time + 1000", so a phone 1 s ahead is refused with 10002. It
  gets a fixed text; an offset read is backlog.
- Order of checks (O3): parse JSON, read `retCode`, then the HTTP status for a body with none.
  HTTP 200 for an error is MEASURED for 10001 only (2026-11-03); every other status is UNPROBED(P16).
- Refusal classes, one table in `bybit.client.ts`:

| Code | Class | Result |
|---|---|---|
| 0 | ok | |
| 33004, -2015 | expired | `BybitRefusalError('expired')`; QUOTE labels; which a V5 call sends is UNVERIFIED (P17) |
| 10003, HTTP 401 | rejected | Connect: O2 text. Connected: if now is past the stored `expiredAt`, class expired, else rejected |
| 81007 | rejected | Same text; it fits |
| 10002 | clock | Fixed text |
| 10004 | sign | A code fault: generic failure text, logged by code |
| 10005 | permission | On a wallet read: the wallet is skipped by the tolerant rules (UNIFIED stays strict), its last balance stays, and `bybitWalletRefused` names the wallet, not a log only (O13). On a walk: the walk stops, logged by code. SUMMARY; UNPROBED(P11) |
| 10006, 10018 | rate | Cooldown (rule 31) |
| HTTP 403 | forbidden | 10 minutes cooldown; text fits both a ban and a US or China IP (O3) |
| 10010 | ip | Refusal text; a bound IP does not fit a phone |
| 10028 | not unified | UNIFIED fails strict; text from the generic failure |
| any other | unknown | Past stored `expiredAt`: class expired. Otherwise generic failure |

## 5. Call counts

All COMPUTED from the windows, limits and code named; none is an API fact. Each states what makes
it MEASURED. Floor `now - 729 days`, windows from `buildWalkWindows`. One page per window per series
unless a seed says otherwise.

### First run and steady state per series

Stage A has no walk: 5 calls every sync, outside the gate, as Binance's balance reads are.

| Stage | Series | Route limit (research J) | Window | Windows to floor | First read, calls | Steady, calls per run | MEASURED after |
|---|---|---|---|---|---|---|---|
| A | query-api | 10/s | | | 1 | 1 | P1 |
| A | wallet-balance | 50/s | | | 1 | 1 | P2 |
| A | coins-balance | 5/s | | | 1 | 1 | P2 |
| A | earn position x2 | UNVERIFIED | | | 2 | 2 | P3 |
| B | deposit | 100/min | 29 d | ceil(729/29) = 26 | 26 | 2 | P4, P12 |
| B | internal | 300/s | 29 d | 26 | 26 | 2 | P5, P12 |
| B | withdraw | 300/min | 29 d | 26 | 26 | 2 | P6, P12 |
| B | transfer | 60/min | 7 d | ceil(729/7) = 105 | 105 | 2 | P7, P12 |

Steady state: forward 1 window plus re-scan `[now - window, cursor)` 1 window (`withoutRead` takes
the overlap day out). Totals: A 5. B first 183, steady 8. A+B: first 183 gated plus 5, steady 8 gated
plus 5.

The Binance reference at the same date: capital 78, Earn 354, Transfer 120 (seam map section 7).
Bybit's first read is smaller in total, but its 60/min transfer route sets a much slower gate.

### Gate and caps

- Interval `BYBIT_REQUEST_INTERVAL_MS` = 1100: 54.5 requests a minute at most for the whole run, so
  every documented route holds, the slowest being transfer at 60/min, with the IP limit of 600 per
  5 s never near. PLANNER CALL 9: one gate for the run, the `createExchangeRun` shape, not a gate
  per route. Earn's limit is UNVERIFIED; P16 prints `X-Bapi-Limit` for each route, which may lower
  the interval, never raise a route past its limit.
- No weight reading. Headers are read only for the cooldown (rule 31).
- Caps, chosen from the table below: lane `capital` 30 calls per run (10 windows of 3 series, so
  `MAX_WINDOWS` 10), lane `transfer` 20 calls per run (`MAX_WINDOWS` 20). A run spends at most 50
  gated calls plus 5, holding one of the `SYNC_CONCURRENCY_LIMIT` slots for that many intervals.
- Order: capital walk, then transfer, each in its own `logOnFailure`, forward first
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
transfer). Run 7 onward is the steady 8 calls. Chosen because a cap of 50 keeps a run bounded on the
shared pool, the money figure is already right from stage A, and the caption says history is coming.
If P12 refuses a window (O20; an empty answer does not count), the floor falls and these runs fall with it.

### Seeds, chosen caps

Lower bounds; a page exactly full may cost one more call, UNPROBED(P13). The real walker measures
them in set 6 (`bybit.convergence.test.ts`), which replaces these with MEASURED values.

| Seed | Rows | Capital pages per window | Capital: runs, calls | Transfer: runs, calls |
|---|---|---|---|---|
| Small account | under 50 per window | 1 per series | 3, 81 | 6, 106 |
| Busy | 1,000 per capital series, 1,000 transfers, even | 1 per series | 3, 81 | 6, 106 |
| Heavy | 5,000 per capital series, 5,000 transfers, even | 4 per series | at least 13, at least 315 | 6, at least 106 |
| Burst | 5,000 transfers in one 7-day window | | 3, 81 | at least 5 + 3 halvings beyond the even case, per the pager rule below |

### The pager rule and its convergence

`readCursorSpan` (`src/crypto-sync/bybit/`, PLANNER CALL 6) reads one span of one series by following
`nextPageCursor` to its end, and checks `canAfford` before every page. Pages already read are held
in memory and commit together. Budget short before the end:

- span wider than a day: it returns `split`, `walkSpans` stores the narrower span as a hint, and the
  next run starts from there. A span with at most cap x 50 rows then commits.
- span of a day or less: it returns `undefined`, and the hint stays.

A day holding more rows than `cap x 50` (1,000 transfers or 1,500 of one capital series) never
commits, the cursor holds, and the caption stays up. The ledger waits; the balance is right. An
accepted limit: Q3 (section 13).

### Early-return audit

Every return that says "nothing to do" or "complete", and the check that must run first.

| Return | Where | Check that runs before it |
|---|---|---|
| No credentials | balance read, walk | None needed: nothing can be read; a walk logs by code |
| Cooldown | balance read, `canAfford` | Time only; no mark moves |
| Malformed state | run arm | Stops every walk, shows the paused caption |
| Empty plan | walk `runSync` | Binance's Transfer tests `forward` and `rescan` only. Bybit's guard tests `forward`, `rescan`, `pending` and `points`, so a clock step back never skips owed ground: red pin required |
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
positively names Ukraine as served, so global stays an INFERENCE. P1 proves it for the user's account. Cost if wrong: such
an account cannot connect, the UI says so, and a host is one list.

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
UNVERIFIED.

Read: `query-api` on each balance sync, first call, 1 call.

Stored: `sync_state.exchange_state.keyExpiry` = `{ expiredAtMs, deadlineDay, readAtMs }`, through new
patch kind `keyExpiry`, reader `keyExpiryOf`. Raw patch rules hold. A failed read keeps the stored
value. `exchangeStateReset` drops it. It rides in `.kiko` with the state, and holds no secret.

State, from `expiredAtMs` against the clock; `deadlineDay` is only the fallback when `expiredAt` does
not parse. The doc sample shows `deadlineDay` -2 with `expiredAt` at the epoch, unexplained, so an
epoch or non-positive value reads as unknown. Near = 14 days or fewer (PLANNER CALL 10).

| State | Account detail line, under Last sync | Sync failure text | Connect, help, holding footer |
|---|---|---|---|
| far | `bybitKeyValidUntil`, caption tone | none | Static 90-day note on connect and help; footer silent on expiry |
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

A dated check: the first real key's `expiredAt` goes into the track HANDOFF as a date when P1 prints
it. On that date, before renewing, the user runs part P17 of the probe. It prints the `retCode` of
`query-api`, UNIFIED and FUND with the expired key, then, after renewal, that the same key answers 0
and `expiredAt` moved. If the code differs from the table in section 4, the table and tests change. The
text does not need to change for a code, since it fits every refusal, and it does not need to change for
the renewal result, since it fits both outcomes (O26). After R7, the route that R7 disproves may leave the
copy, in its own change.

### 6.4 Which kinds ship, and how the UI says so

Stages A and B ship (Q1, the user's answer). Only a kind that passed on the small account on device
ships. A kind the user cannot produce stays unread (internal deposit needs another Bybit user; on-chain
Earn needs a position above its minimum).

| Surface | Text | Depends on |
|---|---|---|
| Connect screen | `bybitConnectLimits`, `bybitKinds` | `bybitKinds` per kind set (section 8) |
| Help topic `connectCrypto` | a new Bybit step, which ends with the `bybitKinds` text | per kind set |
| Holding footer `notListedKey` | `holdingDetail.exchangeNotListed.bybit` | per kind set |
| Account detail | `bybitKinds` in the connected section, expiry line, coin lines, `bybitWalletRefused`, `bybitEarnLeftOut` | per kind set |
| Catalog row | existing `exchangeConnectable`, `exchangeDisclaimer` | none |

A kind set is the outcome of P3 and of the sender (O15). These surfaces and the policy name the exact
shipped kinds. Internal deposits not read is a stated limit. `bybit.shipped-copy.test.ts` pins this.

### 6.5 Shared and new, with the nine silent seams

Reused as is (CODE): `signQuery`, `exchange/credentials` (`hardenedFor`, service per exchange),
`planWalkPasses`, `runWalkPlan`, `walkSpans`, `commitSettledSpan`, `settleRecords`,
`resolveWalletHoldings`, `RunBudget`, `createExchangeRun`, `exchangeMinorUnits`, `rowMinorUnits`,
`upsertByMetadataKey`, `patchExchangeState`, `disconnectExchange`, `runBalanceSync`, `syncJobsFor`.

New, in `src/crypto-sync/bybit/` (no walker copy): client, endpoints, credentials, cooldown,
holding keys, tracked coin, provider, key expiry, budget, walk config, cursor span reader, capital
walk, transfer walk, barrel. Narrowest shared extractions:

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
| 3 | Section gates `=== 'binance'` | `hasExchangeHistory(provider)`, a table typed `Record<BalanceProviderId, boolean>`, so a new id does not compile with no decision; tracked predicate per provider. Plan set 3 step 6/6, the step that adds the id (O30) | with the real `bybit` id: an exchange that has history renders paused, coin lines and behind captions, and the coin lines use the Bybit predicate. Every `balanceProviderIds` member has a gate decision (A42) |
| 4 | `CAPTION_WALKS` | `captionWalksOf(provider)` with a required parameter on `walkCursorsOf` and `historyOwesRange`, no default to Binance; Binance's 8 stay the same. Plan set 3 step 6/6 (O30) | with the real `bybit` id: a provider with an empty caption list never shows behind |
| 5 | `read-secrets.ts` institution filter | Bybit entry in all five files | an export holds the Bybit pair; a restore writes it |
| 6 | `clearKeychainItems` | a third clear | deleting a Bybit account clears its item |
| 7 | `plist.sh` credential regex | adds `X-BAPI-API-KEY` | `plist-credential-detect.test.ts`: a client with that header and no pin fails |
| 8 | Funding matcher `EXCHANGE_NAME` | none | CONFLICT 1: a Bybit row carries no funding code, so `fundingOf` skips it; shown load-bearing with a scratch mutant, not a parent red |
| 9 | `untrackedCoins` text says Binance | `{{exchange}}`, en and uk; output for Binance byte-identical. Plan set 3 step 6/6 (O30) | with the real `bybit` id: the line names Bybit; a Binance pin stays |

Also from O7: the log tags in `walk.ts` become `[exchange sync]` (5 sites). Re-pins name O7 in the
commit: 27 literal lines in 10 test files, one a fixture (O28; MEASURED 2026-11-03 at ef21601bd, `git grep -c`
on the 5 tags, a floor): PLANNER CALL 12.

Also from O30: seam 4 changes every use of `CAPTION_WALKS`: 1 declaration and 3 use lines in
`binance-history-status.ts`, 2 call lines in `crypto-sync-section.component.tsx`, and 25 call lines in 2 test files,
which gain the argument with the same expected results (MEASURED 2026-11-03 at cba12d6f4, `git grep`, a floor; the plan
lists them in set 3 step 6/6).

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
only the help text asks for a read-only key (`git grep apiRestrictions`: 0 hits). Bybit gives the facts
for free in `/v5/user/query-api`, so connect refuses a key that cannot read a shipped kind, before any
Keychain write, with a text that names the reason (PLANNER CALL 2 with O13):

| Fact, checked in this order | Refusal | Level |
|---|---|---|
| `readOnly` not 1 | `bybitKeyNotReadOnly` | SUMMARY; UNPROBED(P1) |
| `isMaster` not true, absent included | `bybitKeyNotMain` | SUMMARY; UNPROBED(P1) |
| A box a shipped kind needs is missing, or `permissions` does not parse | `bybitKeyMissingPermission`, naming the boxes | QUOTE "Earn" for Earn; the other boxes per route UNVERIFIED, UNPROBED(P1, P11) |

The needed boxes per kind come from P11 and P1, and set 7 writes them. If P1 shows that a read-only key
cannot tick a needed box, the kind drops and the copy says so (O13). A later change on Bybit's page is not
re-checked at a sync (backlog): the app sends GETs only, and a later 10005 on one wallet shows
`bybitWalletRefused`, with the last balance kept. Cost if wrong: a user with a partial key edits the key once.

## 7. How the user learns of the expiry (Q2, answered)

The user's answer (section 13): "detail line + failure text only". The account detail line and the sync failure
text of section 6.3 state the expiry. The app schedules no local notification. The consequence: a user who stops
opening the account learns of the expiry from a failed sync and "Last sync"; the balance stays at the last read,
dated. The measured cost of a notification is under Backlog.

## 8. Copy, en and uk

kiko-translator reviews this table before any commit that adds it. Plain-text name, no logo, generic
icon, existing `forms.account.exchangeDisclaimer`. New keys under `accountDetail` unless named. UI text
uses Кіко in uk, ʼ for the apostrophe. The wording shows clauses E1 and M1; set 7 picks by the probe outcome,
from the clause table below. A row changed or added by a ruling states its level in the key
cell. A row that carries a level other than QUOTE or MEASURED is copy that set 1 step 7/7 re-checks against the
probe output.

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
| `bybitConnectLimits` (O2, O13, O25, O39 C1. Level: O1 for "only global"; QUOTE EU 7.4 for Bybit EU; UNVERIFIED for another regional site, so "may not"; UNPROBED(P1) for read-only with no IP restriction and for the main account; QUOTE for 90 days and renewal before the date) | Kiko works only with global Bybit accounts (bybit.com). It does not support Bybit EU accounts, and an account of another regional Bybit site (Turkey, Kazakhstan and others) may not work here. On your main account, create a read-only key with no IP restriction. Bybit ends such a key after 90 days; you renew it on Bybit, and the key and secret stay the same. | Кіко працює лише з глобальними акаунтами Bybit (bybit.com). Він не підтримує акаунти Bybit EU, а акаунт іншого регіонального сайту Bybit (Туреччина, Казахстан тощо) тут може не спрацювати. В основному акаунті створіть ключ лише для читання без обмеження за IP. Bybit припиняє дію такого ключа через 90 днів; ви подовжуєте її на Bybit, а ключ і секрет лишаються ті самі. |
| `bybitKinds` (E1 and M1. Level: UNPROBED(P3, P5)) | Kiko reads your balances (Unified, Funding, Flexible Savings, On-Chain Earn), deposits, withdrawals and transfers between Funding and Unified. It does not read deposits sent by another Bybit user, trades, converts, P2P orders, other Earn products, derivatives or loans. | Кіко читає ваші баланси (Unified, Funding, Flexible Savings, On-Chain Earn), поповнення, виведення та перекази між Funding і Unified. Він не читає поповнення від іншого користувача Bybit, угоди, конвертації, замовлення P2P, інші продукти Earn, деривативи й позики. |
| `bybitKeyRejected` (O25, O39 C1: fits a wrong key and a key of Bybit EU or another regional site. Level: QUOTE EU 7.4 for Bybit EU; UNVERIFIED for another regional site, so "may not") | Bybit did not accept this key. Check the key and the secret. Kiko works only with global Bybit accounts: it does not support Bybit EU accounts, and a key from another regional site may not be accepted here. | Bybit не прийняв цей ключ. Перевірте ключ і секрет. Кіко працює лише з глобальними акаунтами Bybit: він не підтримує акаунти Bybit EU, а ключ з іншого регіонального сайту тут може не підійти. |
| `bybitKeyNotReadOnly` | This key can do more than read. Create a read-only key on Bybit and connect with that one. | Цей ключ дозволяє більше, ніж читання. Створіть на Bybit ключ лише для читання й підключіться з ним. |
| `bybitKeyNotMain` (new, O13. Level: UNPROBED(P1)) | Bybit does not show this key as a main account key. Create a read-only key on your main Bybit account and connect with that one. | Bybit не показує цей ключ як ключ основного акаунта. Створіть ключ лише для читання в основному акаунті Bybit і підключіться з ним. |
| `bybitKeyMissingPermission` (new, O13. Level: UNPROBED(P1, P11)) | This key cannot read everything Kiko needs. Turn on {{permissions}} for this key on Bybit, or create a new read-only key with them, then connect again. | Цей ключ не може прочитати все, що потрібно Кіко. Увімкніть для нього {{permissions}} на Bybit або створіть новий ключ лише для читання з цими дозволами, потім підключіться знову. |
| `bybitWalletRefused` (new, O13. Level: SUMMARY for 10005; UNPROBED(P11)) | Bybit refused this key for {{wallet}}, so Kiko did not update that balance. Check the key's permissions on Bybit. | Bybit не дозволив цьому ключу читати {{wallet}}, тож Кіко не оновив цей баланс. Перевірте дозволи ключа на Bybit. |
| `bybitEarnLeftOut` (new, plural, O18. Level: UNPROBED(P3)) | one: Kiko left {{count}} Bybit Earn position out of this balance, because its status is not one Kiko counts. It may be a position you already redeemed. other: Kiko left {{count}} Bybit Earn positions out of this balance, because their status is not one Kiko counts. They may include positions you already redeemed. | one: Кіко не врахував у цьому балансі {{count}} позицію Bybit Earn, бо її статус не входить до тих, які він рахує. Це може бути вже погашена позиція. few: Кіко не врахував у цьому балансі {{count}} позиції Bybit Earn, бо їхній статус не входить до тих, які він рахує. Серед них можуть бути вже погашені. many: Кіко не врахував у цьому балансі {{count}} позицій Bybit Earn, бо їхній статус не входить до тих, які він рахує. Серед них можуть бути вже погашені. other: Кіко не врахував у цьому балансі {{count}} позиції Bybit Earn, бо їхній статус не входить до тих, які він рахує. Серед них можуть бути вже погашені. |
| `bybitKeyValidUntil` | Bybit key works until {{date}}. | Ключ Bybit діє до {{date}}. |
| `bybitKeyEndsSoon` (plural) | one: Bybit key ends in {{count}} day. Renew it on Bybit; the key stays the same. other: Bybit key ends in {{count}} days. Renew it on Bybit; the key stays the same. | one: Ключ Bybit діє ще {{count}} день. Подовжте його на Bybit; ключ лишається той самий. few: Ключ Bybit діє ще {{count}} дні. Подовжте його на Bybit; ключ лишається той самий. many: Ключ Bybit діє ще {{count}} днів. Подовжте його на Bybit; ключ лишається той самий. other: Ключ Bybit діє ще {{count}} дня. Подовжте його на Bybit; ключ лишається той самий. |
| `bybitKeyEnded` (O26. Level: UNPROBED(P17) for renewal after the date, so both routes) | Bybit key ended on {{date}}. Balances are as of the last sync. Try to renew it on Bybit: the key then stays the same, so there is nothing to enter here. If Bybit offers no renewal, create a new key, then disconnect and connect again. | Дія ключа Bybit завершилася {{date}}. Баланси показано станом на останню синхронізацію. Спробуйте подовжити ключ на Bybit: тоді він лишиться той самий, і тут нічого вводити не треба. Якщо Bybit не пропонує подовження, створіть новий ключ, потім відʼєднайте й підключіть Bybit знову. |
| `bybitKeyExpiryUnknown` | Kiko could not read when this Bybit key ends. A key with no IP restriction lasts 90 days. | Кіко не зміг прочитати, коли завершується дія цього ключа Bybit. Ключ без обмеження за IP діє 90 днів. |
| `bybitKeyRefusedExpired` (O26. Level: UNPROBED(P17)) | Bybit no longer accepts this key. Its 90 days may have ended. Try to renew it on Bybit: the key and secret then stay the same, so you do not enter them again. If Bybit offers no renewal, create a new key, then disconnect and connect again. | Bybit більше не приймає цей ключ. Можливо, його 90 днів минули. Спробуйте подовжити його на Bybit: тоді ключ і секрет лишаться ті самі, і вводити їх знову не треба. Якщо Bybit не пропонує подовження, створіть новий ключ, потім відʼєднайте й підключіть Bybit знову. |
| `bybitKeyRefused` | Bybit refused this key. If you deleted it or changed your password, create a new key, then disconnect and connect again. | Bybit відхилив цей ключ. Якщо ви видалили його або змінили пароль, створіть новий ключ, потім відʼєднайте й підключіть Bybit знову. |
| `bybitForbidden` | Bybit refused the connection: too many requests, or Bybit does not serve your current network location (for example the US or mainland China). Kiko waits 10 minutes before trying again. | Bybit відхилив зʼєднання: забагато запитів, або Bybit не обслуговує ваше поточне мережеве розташування (наприклад, США чи материковий Китай). Кіко зачекає 10 хвилин, перш ніж спробувати знову. |
| `bybitClockOff` | Bybit refused the request because this device's clock is off. Turn on Set Automatically in Date & Time settings. | Bybit відхилив запит, бо годинник цього пристрою неточний. Увімкніть «Автоматично» в налаштуваннях дати й часу. |
| `bybitRequestFailed` | Bybit request failed: {{code}} | Запит до Bybit не вдався: {{code}} |
| `bybitMissingBalances` | Bybit account response did not contain a balances list | Відповідь рахунку Bybit не містила списку балансів |
| `exchangeSwitchRefused` | {{exchange}} cannot connect here because this account still holds holdings of another exchange or wallet. Add a new crypto account, or delete those holdings first. | {{exchange}} не можна підключити тут, бо цей рахунок ще містить активи іншої біржі чи гаманця. Додайте новий крипторахунок або спершу видаліть ці активи. |
| `bybitCoinBorrowed` (O27: fits a first connect, with no last balance. Level: SUMMARY for the borrow fields; UNPROBED(P2)) | {{coin}}: Bybit shows a loan against this coin, so Kiko does not read its balance. A balance shown here is from an earlier sync. | {{coin}}: Bybit показує позику під цю монету, тож Кіко не читає її баланс. Баланс, показаний тут, узято з попередньої синхронізації. |
| `disconnectProviderMessage.bybit` | This clears the connection and the stored API key. Your holdings and transactions stay as a manual snapshot. | Акаунт буде відʼєднано, а збережений API-ключ очищено. Ваші активи й транзакції збережуться, і ви можете й надалі керувати ними вручну. |
| `untrackedCoins` (changed) | Not tracked: {{tickers}}. Kiko does not import a currency its {{exchange}} sync does not support. | The existing uk line with Binance replaced by `{{exchange}}`; the output for Binance stays byte-identical |
| `holdingDetail.exchangeNotListed.bybit` (E1 and M1; O15, O25, O39 C1. Level: UNPROBED(P3, P5); QUOTE the P2P guide for the P2P clause, with no probe (O5, O49); QUOTE EU 7.4 for Bybit EU; UNVERIFIED for another regional site, so "may not") | Not listed: deposits sent by another Bybit user; trades, converts, interest and other Unified log entries; Earn orders and yield; P2P orders, which Bybit's API opens only to advertisers; Earn products other than Flexible Savings and On-Chain; derivatives profit and loss; loans; sub-accounts; and records older than Bybit keeps. Kiko does not support Bybit EU accounts, and a key from another regional site may not be accepted. | Не показано: поповнення від іншого користувача Bybit; угоди, конвертації, відсотки й інші записи журналу Unified; замовлення й дохід Earn; замовлення P2P, бо API Bybit відкритий для них лише рекламодавцям; продукти Earn, крім Flexible Savings і On-Chain; прибуток і збитки деривативів; позики; субакаунти; записи, старіші за ті, що зберігає Bybit. Кіко не підтримує акаунти Bybit EU, а ключ з іншого регіонального сайту може не підійти. |
| `help.topics.connectCrypto.title`, `rowLabel` | Connect Binance, Bybit or a Bitcoin Wallet; Connect Binance, Bybit or a Bitcoin wallet | Підключення Binance, Bybit або гаманця Bitcoin (обидва) |
| `help.topics.connectCrypto.steps.2` | Under "Exchange or wallet", choose "Binance", "Bybit" or "Bitcoin wallet address". | У полі «Біржа або гаманець» оберіть «Binance», «Bybit» або «Адреса гаманця Bitcoin». |
| `help.topics.connectCrypto.steps.4` (new; the old 4 and 5 become 5 and 6; O15, O25, O39 C1. Level: UNPROBED(P1) for read-only with no IP restriction and for the main account; QUOTE EU 7.4 for Bybit EU; UNVERIFIED for another regional site, so "may not"; QUOTE for 90 days and renewal before the date) | For Bybit: Kiko works only with global accounts (bybit.com). It does not support Bybit EU accounts, and a key from another regional site may not be accepted. Tap "Open Bybit API management" and, on your main account, create a read-only key with no IP restriction. Paste the "API key" and "API secret", then tap "Connect Bybit". Bybit ends the key after 90 days; renew it there before that date, and the key stays the same. The shipped `bybitKinds` text follows here, word for word. | Для Bybit: Кіко працює лише з глобальними акаунтами (bybit.com). Він не підтримує акаунти Bybit EU, а ключ з іншого регіонального сайту може не підійти. Натисніть «Відкрити керування API Bybit» і в основному акаунті створіть ключ лише для читання без обмеження за IP. Вставте «API ключ» і «API секрет», потім натисніть «Підключити Bybit». Bybit припиняє дію ключа через 90 днів; подовжте її там до цієї дати, і ключ лишиться той самий. Далі йде текст `bybitKinds` слово в слово. |

Clauses per predicted outcome (O15). Only one kind set ships, so `bybitKinds`, the footer, the help step and
the policy (section 9) each hold one combination; the other clauses never reach the catalogue. A mixed P3 result
(one Earn category separate, one not) uses E2's shape with the matching words, and set 1 step 7/7 writes it here.
E3 wins over E2 and E4: when no Earn money is separate, that money is already in the balance.

| Clause | Outcome | Replaces | en | uk |
|---|---|---|---|---|
| E1 | P3: Earn money is separate; both categories tested. UNPROBED(P3) | none, the default | Balances: Unified, Funding, Flexible Savings, On-Chain Earn | Баланси: Unified, Funding, Flexible Savings, On-Chain Earn |
| E2 | No on-chain position to test. UNPROBED(P3) | In `bybitKinds`, the list loses On-Chain Earn, and this follows. In the footer, "Earn products other than Flexible Savings", and this follows | On-Chain Earn is not read, so money there is not in your balance. | Він не читає On-Chain Earn, тож кошти там не входять до вашого балансу. |
| E3 | P3: no separate Earn money. UNPROBED(P3) | In `bybitKinds`, the list becomes Unified, Funding, and this follows. In the footer, the Earn products clause goes, and this follows | Money in Earn already counts inside those balances, so Earn has no holding of its own. | Кошти в Earn уже входять до цих балансів, тож окремого активу Earn немає. |
| E4 | R4: a redeemed row has no `status` and a non-zero `amount`, so FlexibleSaving does not ship (O31). UNPROBED(P3) | In `bybitKinds`, the list loses Flexible Savings, and this follows. In the footer, "Earn products other than On-Chain", and this follows | Flexible Savings is not read, so money there is not in your balance. | Він не читає Flexible Savings, тож кошти там не входять до вашого балансу. |
| E2 and E4 | Both outcomes hold, so no Earn category is read. UNPROBED(P3) | In `bybitKinds`, the list becomes Unified, Funding, and this follows. In the footer, the Earn products clause goes, and this follows | Earn is not read, so money there is not in your balance. | Він не читає Earn, тож кошти там не входять до вашого балансу. |
| M1 | No internal sender: the kind is not read. UNPROBED(P5) | none, the default | deposits sent by another Bybit user (named as not read) | поповнення від іншого користувача Bybit (названо як те, що не читається) |
| M2 | P5 passed with a real sender | In `bybitKinds`, "deposits" gains this, and the not-read item goes. In the footer, the first item goes | deposits, including those sent by another Bybit user | поповнення, зокрема від іншого користувача Bybit |
| W1 | Rule 45 outcome (b): the API cannot tell the wallet. UNPROBED(P4, P6) | Added to the footer and to the end of `bybitKinds` | Bybit's deposit and withdrawal records do not say which wallet they used, so Kiko lists them all on Funding. Your balances are not affected. | Записи Bybit про поповнення й виведення не вказують, який гаманець використано, тож Кіко показує їх усі на Funding. Це не впливає на ваші баланси. |

The wallet names Unified, Funding, Earn in holding names are proper nouns kept in code, `'Bybit <Wallet>
· <CODE>'`. The permission boxes named in the help step wait for P1 and P11. That a read-only key works with no
IP restriction is UNPROBED(P1), not a known fact (O25; research line "Read-only": not in the v5 docs). If P1
shows otherwise, the instruction in `bybitConnectLimits` and the help step changes before set 7 ships it.

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

**Personal data (O5, O6).** Never parsed into a row, state, log or description: `internal-deposit.address`,
`fromMemberId`, `toAddress`, `fromAddress`, `tag`, `txID`, query-api's `userID`, `inviterID`, `kycRegion`,
`note`. Parsers read named fields only. A sentinel test covers each. `readOnly`, `isMaster` and `permissions`
hold no personal data; they are read at connect and never stored (O13).

**Privacy policy.** Section 3 of `docs/privacy-policy.en.md` and `docs/privacy-policy.md` gets the two blocks
below (E1 and M1 wording; O24, O13, O15, O34).

> en: **Bybit** (`api.bybit.com`): using your read-only API key: details of the key itself (whether it is
> read-only, whether it belongs to your main account, what it may read, and when it ends); your balances of
> every coin and fiat currency (Unified, Funding, Flexible Savings, On-Chain Earn); your deposit and withdrawal
> history; and your transfers between your Bybit wallets. Bybit's answers can include the sender's or
> recipient's address. It reaches only your device, and Kiko does not keep it. Kiko keeps on your device the tickers of coins it does not track or could not read, the wallets and
> the number of Earn positions it left out, and the date your key ends; this also travels in a `.kiko` export.

> uk: **Bybit** (`api.bybit.com`): за допомогою вашого API-ключа лише для читання: дані самого ключа (чи він
> лише для читання, чи належить вашому основному акаунту, що може читати й коли завершується його дія); ваші
> баланси всіх монет і фіатних валют (Unified, Funding, Flexible Savings, On-Chain Earn); історія ваших поповнень
> і виведень; перекази між гаманцями Bybit. Відповіді Bybit можуть містити адресу відправника або отримувача.
> Вона надходить лише на ваш пристрій, і Кіко її не зберігає. Кіко зберігає на
> вашому пристрої тікери монет, які не відстежує або не зміг прочитати, гаманці й кількість позицій Earn, які він
> не врахував, і дату завершення дії ключа; це також переноситься в експорт `.kiko`.

The counterparty text says "does not keep", because the response reaches the device and the parser drops it
(O24). The level of the sentence "can include": SUMMARY for the field lists of the deposit and withdrawal rows (M1,
address only, O34); O6 for the email and phone number of an internal deposit (M2).

Policy variants per kind set (O15; level UNPROBED(P3, P5), and a variant is true only when its outcome is
measured):

| Outcome | en | uk |
|---|---|---|
| E2 | the balance list reads "(Unified, Funding, Flexible Savings)" | список балансів: «(Unified, Funding, Flexible Savings)» |
| E3 (O34) | the balance list reads "(Unified, Funding)", and the kept-data sentence reads "the wallets it left out", with no count of Earn positions | список балансів: «(Unified, Funding)»; у реченні про збережені дані: «гаманці, які він не врахував», без кількості позицій Earn |
| E4 (O31) | the balance list reads "(Unified, Funding, On-Chain Earn)" | список балансів: «(Unified, Funding, On-Chain Earn)» |
| E2 and E4 | the same as E3 | так само, як E3 |
| M2 (O34) | "your deposit history, including deposits sent by another Bybit user, your withdrawal history"; and the counterparty text reads "Bybit's answers can include the sender's or recipient's address, email or phone number. They reach only your device, and Kiko does not keep those details." | «історія ваших поповнень, зокрема від іншого користувача Bybit, історія виведень»; і речення про іншу сторону: «Відповіді Bybit можуть містити адресу, email чи номер телефону відправника або отримувача. Вони надходять лише на ваш пристрій, і Кіко цих даних не зберігає.» |

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
| C1 copy | For Bybit EU, the copy says plainly that Kiko does not support these accounts; `may not` stays for other regional sites. No workaround text. The key never goes to `api.bybit.eu` | Plan set 3 step 2/6 (host); set 7 steps 1/6, 2/6, 3/6 (copy) | Pinned: A13, A51, A52 |
| C2 limit | A closed list of GET endpoints, no order, no write path. Any trading feature re-opens API 6.5 | Plan set 3 step 2/6; each later step that adds a route | Mechanizable: A53 |
| C3 free | No price, ad, IAP, tip, sponsor, or affiliate code on `BYBIT_API_MANAGEMENT_URL`. Any of these re-opens API 6.9 and Global 40.4(e) | URL: plan set 7 step 1/6. Business state: the standing item of set 8 step 2/2 | Pinned for the URL: A54. The business state has no test: a reviewer's judgment |
| C4 name | Text only, no logo, no Bybit look, the not-affiliated caption stays. No Bybit in the store title, subtitle or keywords. No line that offers Kiko in place of the Bybit app (API 6.5, Global 40.4(c)) | Plan set 7 step 2/6 (caption), step 5/6 (store metadata), set 7's reviewer (wording) | Pinned for the caption: A55. The wording has no test: a reviewer's judgment |
| C5 key | The key stays on the device through `hardenedFor`; no server copy, no shared key in the build. A key that leaves the device re-opens API 2.5, Global 6.2 and "Authorized Individual" | Plan set 3 step 3/6 | Pinned: A56 |
| C7 re-read | Re-read API Terms sections 1 and 2.1, the API Documentation (API 7.1) and the EU 4.3.7 list at each release that changes Bybit, because the API Terms have no date. A dated Bybit block in kiko-compliance, like the Binance one | Plan set 8 step 2/2 | Not mechanizable: a legal reading |
| Guideline 5.2.2 and the API 6.5 doubt | Both doubts stay OPEN and are ACCEPTED BY THE USER, 2026-11-03 (O42): keep Bybit, global accounts only, no letter to Bybit. The user's words, relayed by the coordinator: "The user in EU can't obtain API key, hence adding bybit to kiko is pointless. Continue."; then, asked which reading, the user picked "Keep Bybit, global only". The guideline text was not re-read: the reviewer cited it from memory as asking for specific permission under the service's terms, with authorization on request. kiko-compliance has no 5.2.2 item. The closest permission here is API 2.4, 3.1 and 5.1, which is general and does not name Kiko. A written yes from Bybit would close this gap and the API 6.5 doubt; the user chose not to ask for one | The kiko-compliance item: plan set 8 step 2/2 | Not mechanizable: a judgment |

**The browser step (PLANNER CALL 18).** `https://www.bybit.com/en/terms-service` and
`https://www.bybit.eu/en-EU/terms-service/` are client-rendered shells to curl. The step has two parts:

- Part 1: DONE 2026-11-03. The coordinator read both pages in the Orca browser, at the user's word ("You can read both pages in
  the Orca browser"). No login was needed, no account exists, and no paste came. The verdict above rests on that text (O39).
- Part 2, at R1, signed in: confirm the API management URL for `BYBIT_API_MANAGEMENT_URL`, which no research
  line gives.

## 10. The user's probe plan

The order of the user's steps (O23, O31, O36, O38, O39, O41; was: the browser step inside R1, the verdict after R1 and R2,
the redeem at R6, the script and the approval before the browser step):

1. DONE 2026-11-03: part 1 of the browser step (section 9).
2. DONE 2026-11-03: a `kiko:reviewer` gave the terms verdict, PASS WITH CONDITIONS for global accounts (section 9). The stop
   rule did not fire.
3. Meanwhile set 1's script is written and reviewed, so a pass loses no time (O38). The user gets it only after a pass.
4. The user approves this spec, with the verdict in it (PLANNER CALL 23, O41). The coordinator's message gave answers and asked
   for the script review; it did not state approval of the spec. So R1 waits for this approval.
5. THE KEY MOMENT, R1: the first step that needs an account or a key. It holds no money. The user gets the C6 line below first.
6. R2: the first of the user's money. R3, then R4, with the Flexible Savings redeem and its P3 run.
7. The planner writes the results. The commit after the last step that writes results is the set 1 tip, and set 2 bases
   on it (O36).
8. Set 7's device check is on device. On the date `expiredAt` prints, R7: an open check after the ship (Q4).

Nothing before step 5 needs a key or asks for an account; no code that needs a shape comes before its probe; and no code
that needs Bybit comes before the terms verdict.

The script's parts for 1.4 (O37): P1, P2, P3, P4, P5, P6, P7, P11, P12, P13, P14, P15, P16, P17, P18. P8, P9 and P10 are
used only by stages C and D, so they are not in the script. Their ids stay reserved under Backlog. P14 is in the script, prints
NOT RUN and makes no call (O49).

Script (plan set 1): `memory/refs/bybit-probe.sh`, main checkout, on the eodhd-verify and
binance-operations-probe pattern: hidden prompts, key and URL to `curl -q -K -` on stdin, secret to perl HMAC
on stdin, masked URLs, `<run> [part ...]` (a part name after the run runs only that part), GET only, on a closed list of paths.
It prints only field names, types, status words, row counts, decimal counts per coin, time-unit class, the box names of a key's
`permissions`, the UTC date of `expiredAt` and its days left, `retCode`, HTTP status, `X-Bapi-Limit*`, and fixed words that compare
two readings (equal, changed, yes, no), never an amount.

- It prints no server text. A `retCode` prints with a word from a closed table in the script, and a code outside the table prints
  alone (O45).
- A value prints only from a closed list per field. An unknown value prints `<other>`, and that is a result to read (O46).
- Three printed values still pass a shape test and not a closed list: a coin name, a group or box name of `permissions`, and a
  wallet-hint value of one or two digits (`iscoin`, `P1_JQ`, `walletword`). This disagrees with the letter of O46, and it is reported
  to the orchestrator.
- Residual accepted (O46): a field NAME of plain letters can hold a person's name only if a server uses a value as a key, and no
  documented route does.

No email, phone, address, name, id or txID is ever printed. A fake-curl test runs before handover, and the orchestrator reads the
whole file. Output is added to `memory/refs/bybit-probe-output-<date>.txt` with `>>`, and each run starts with a line of `########`.
The script prints no elapsed time and repeats no call to measure uptime or latency (API 6.6).

The user line before R1 (C6; a human action, not mechanizable):

- Use a network that shows your true location, for KYC and for every probe.
- The facts: Global 3.4 lists the Chinese Mainland as an Excluded Jurisdiction, and Global 3.5 allows termination of an account
  for false representations of location or residence. A mainland China IP reading was seen: the bybit.com home page showed a
  banner that the IP address locates the browser in mainland China (`SOURCE.md`, section 9). That banner says nothing about your
  account country. Bybit also returns 403 for those IPs (research, SUMMARY; section 9).
- Keep the probes one bounded run: only the parts of the table below, at the runs it names, with no uptime or latency measure
  (API 6.6).
- Who is bound: the user who opens the account is "you" in the API Terms. API 9.1(d) (indemnity for a claim from a third party's
  use of "your API Client(s)") and API 7.6 (audit) then bind that user directly, and so does Global 40.4(e).

What the account holds, in order. Money figure is a GUESS: 30 to 50 USD of the user's own money stays in the
account plus a few USD in fees; it can be withdrawn after.

| Run | When | The user does first | Parts | Proves |
|---|---|---|---|---|
| R1 | After the user's spec approval (O41), no money | Read the C6 line above. Global account at bybit.com, KYC as Bybit asks; one key: System-generated, read-only, every read box offered, no IP restriction. Part 2 of the browser step (section 9). Which boxes a read-only key can tick and whether it works with no IP restriction are UNPROBED(P1) | P1, P11, P12, P13 (empty), P14 (no call, O49), P15, P16 (about 50 calls) | Host for Ukraine (O1), key shape, boxes, `isMaster`, expiry date, per-route permissions. On this empty account P12 shows only a refusal (O20); an empty 0 proves no retention |
| R2 | `R2 P4` while K1 is pending; the whole R2 after money lands | K1: on-chain USDT deposit. After `R2 P4`: K2: FUND to UNIFIED and back, part of it left in UNIFIED. K3: a far-off unfilled spot limit order, left open for R3 | `R2 P4` while K1 is pending (O16, O32): it reads the balances and the pending row, waits at a prompt until K1 lands, then reads the balances again (O47). Then the whole R2, with skip typed at the P4 prompt: P2, P4, P7, P13 (rows), P18 (up to about 60 calls). After K6 settles (R4): `R2 P13` once more, because no withdrawal row exists before K6 (O48) | The form of a row with no time, the wallet that moved for K1, balance shapes, deposit wallet and status, transfer path and rows, page behaviour, decimals. After K6: the time field that a withdrawal window filters on. The proof of `locked` inside `walletBalance` is in R3 (O50). If the user misses the pending window, rule 47 stays UNPROBED(P4) (O32), and P4 prints no balance comparison for K1 |
| R3 | Same day | Nothing before the run: K3 stays open, and K4 and K5 wait for their prompt (O50) | P2: it reads UNIFIED and FUND, the user cancels K3 at its prompt, then it reads UNIFIED again. P3: reading 1 BEFORE K4, then at its prompt K4: subscribe Flexible Savings, and K5: on-chain Earn if its minimum is affordable; then reading 2 (about 12 calls) | `locked` inside `walletBalance`: both, per coin, around the cancel of K3 (O50). The double count. The Earn status rule still waits for R4 (rule 46) |
| R4 | After the R3 run of P3 shows the position; no fixed day (O31, O40) | K7, optional: an internal deposit from another Bybit user. K8, optional: off-chain withdrawal. K6 waits for its prompt, and K11 is last | `R4`: P3 as one reading, with no redeem prompt (O50); P5; P6 reads FUND and UNIFIED, then at its prompt K6: on-chain withdrawal to the user's own Binance from FUND, and one from UNIFIED if Bybit allows it (O14), then it reads them again (about 10 calls). `R4 P6` as K6 settles, three times in all, with skip typed at the prompt. `R2 P13` once more (O48). Last, K11, through `R4 P3`: reading 1, then at its prompt the user redeems all of Flexible Savings and waits until it lands, then reading 2 | `success` vs `BlockchainConfirmed`; per wallet, change equals amount, change equals amount + fee; internal rows; whether a row tells its wallet (rule 45); the wallet that moved around K6, which the output names by its words: FUND and UNIFIED as equal or changed per coin (O47); the redeemed row (rule 46) and the redeem check. When its results are written, the set 1 tip exists and code may start (O36) |
| R7 | On the date `expiredAt` prints; an open check after the ship (Q4) | Nothing; do not renew first | P17 (6 calls) | The error after expiry, then renewal keeps the key. Until it runs, the renewal row stays UNPROBED(P17), with the copy of O26 |

Everything in research "STILL NEEDS THE KEY". Items 7 and 8, and the order and yield parts of item 12, are under Backlog,
because only the deferred stages need them:

| # | Item | Part |
|---|---|---|
| 1 | Permission and read-only per endpoint | P11 |
| 2 | Real balance bodies; `equity` vs `walletBalance`; `locked` | P2 |
| 3 | Earn in UNIFIED or FUND; a redeemed FlexibleSaving row (O31) | P3 |
| 4 | Wallet receiving a deposit | P4 |
| 5 | Retention, by a refusal only (O20); `createdTime`, `successAt` units | P12, P4, P5 |
| 6 | The real transfer path | P7 |
| 9 | `deadlineDay`, `expiredAt`, permissions object | P1; an IP-bound key stays UNVERIFIED unless the user adds one |
| 10 | Error after expiry; wrong-host key | P17; wrong-host stays UNVERIFIED, no EU key exists, and no key goes to a second domain |
| 11 | P2P `simplifyList` for a non-advertiser | Closed, no call: the route is a POST, and the probe is GET only (section 10) and C2 (O49). P14 stays NOT RUN |
| 12 | Earn position shape and limits, limit headers | P3, P16 |
| 13 | Maximum recv window | P15 |
| 14 | HTTP status for every call | P16, printed on each |
| 15 | API terms and brand | Done 2026-11-03: the API Terms PDF by curl, the Global and EU Terms in the browser, the brand clause is Global 40.4(e) (section 9). C7's re-read stays |

Parts, what each must print and which code it unlocks:

| Part | Prints | Unlocks |
|---|---|---|
| P1 | query-api names, types, `readOnly`, `expiredAt` and `deadlineDay` shape, days left, `uta`, `isMaster` as booleans, the group and box names inside `permissions` (by a shape test, not a closed list; see the list above) | Set 3 client, set 4 expiry, set 7 connect refusals (O13) |
| P2 | Wallet bodies per coin: names, types, zero listed or not, `walletBalance` vs `equity` equal or not, `locked`, `spotBorrow`, `borrowAmount`, `bonus` non-zero or not. In R3 only: `walletBalance` and `locked` per coin before and after the cancel of K3, as equal or changed (O50) | Set 3 balances |
| P3 | Two readings around the user's Earn step; never an amount. Per coin: `unified`, `fund`, `flexible` and `onchain` as equal or changed (up or down); wallet (unified + fund) and position (flexible + onchain) moving in opposite ways or not. When `flexible` falls, the redeem check: wallet rise equals the position amount, and wallet rise equals amount + `claimableYield`, each yes or no. Per row, after K11 too (rule 46, O31): `status`, and `amount`, `claimableYield` and `totalPnl` as zero or non-zero; `nextPageCursor`. A `status` prints as absent, empty, `Processing` or `Active`, and any other word prints `<other>` (O46): the research lists `Processing` and `Active` for OnChain only, so a FlexibleSaving row can print `<other>`, and that is a result to read. A plain `R4` prints one reading only (O50) | Set 3 Earn |
| P4, P5, P6, P7 | Row names and types, status words from a closed list per series (`<other>` outside it), unit class of times, id present, amount and fee as zero or non-zero, fee smaller than amount. P4 and P6 also use two balance readings around the user's step (O47): per coin, FUND and UNIFIED as equal or changed; per row and per wallet, change equals amount, and change equals amount + fee, each yes or no, with the sign ignored. A skip at the prompt prints no comparison. P5 and P7 print no balance drop: P5 is optional, and P7 rows name both wallets. P7 tries both transfer paths. P4 and P6 also print `depositType` values and any field that could tell the wallet, against the wallet that moved (rule 45). P4 with K1 pending prints whether the time is empty, 0, absent or present (rule 47) | Sets 5, 6 |
| P11 | One call per endpoint: `retCode` | Sets 3, 5 |
| P12 | Rows and `retCode` for a window starting 2 years back, and 18, 12, 6 months, per series. Only a refusal moves a floor; an empty 0 keeps 729 days (O20) | Set 5 floors |
| P13 | Per series: window edges (transfer 7 d, 7 d + 1 s; the others 29 d, 30 d), an end-exclusive and a start-exclusive test on the newest row, `limit=1` page order, cursor shape, a full last page, a repeated cursor. On the withdrawal series only, the filter field: the time field, `createTime` or `updateTime`, that `startTime` and `endTime` filter on, by a window that ends and a window that starts between the two times of one row (O48). No coin filter: no Stage B row sends `coin`. A series with no row prints only its edges, so `R2 P13` runs once more after K6 settles | Sets 5, 6 |
| P14 | NOT RUN, no call. Closed by the GET-only rule of this section and by C2, not a pending probe (O49): the only P2P order-list route is a POST. P1's box names, `FiatP2P` among them, are the only P2P fact the script reads | Nothing. The O5 text rests on the docs line: QUOTE "The P2P API is only accessible by General Advertisers or above" (research, section H) |
| P15 | `retCode` for recv window 5000, 20000, 60000 | Set 3 |
| P16 | HTTP status, `X-Bapi-Limit`, `-Status`, `-Reset-Timestamp` per route | Sets 3, 5 interval |
| P17 | Section 6.3 | Refusal table |
| P18 | Largest decimal count per coin per row kind | Rule 12 |

A public-only part ran on 2026-11-03 with no key: `market/time`, `query-api` with no key (10001, HTTP 200),
`instruments-info`, and the TLS chain.

If a probe fails its row: a shape that differs edits this spec and the plan first. A kind that cannot pass
stays unread, and the UI text says so. A row keeps its UNPROBED mark until its own probe runs (O35), so P5 rows with no
sender and P17 rows before R7 stay marked at the set 1 tip.

## 11. Tests

Per kiko-testing: RED first on the parent, real SQLite for a write path, a sweep seed list for a property,
no history note in a test title. Fixtures hold probe shapes, never real values. Files are new unless marked;
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
| A17 | Deposit statuses | `bybit.capital-history.test.ts`: "imports only statuses 3 and 70012, owes pending and unknown, ignores 4" |
| A18 | 70011 on an imported deposit | same, "a rolled back deposit removes its row and moves no balance" |
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
| A32 | `permissions` lacks a needed box, or does not parse (O13) | `bybit-credentials-field.component.test.tsx`: "a key with a missing box is refused before any Keychain write and the text names the box" |
| A33 | `isMaster` false or absent (O13) | same, "a key not shown as a main key is refused before any Keychain write" |
| A34 | 10005 on FUND on a later sync (O13) | `bybit.provider.test.ts`: "a refused wallet keeps its last balance and records its name for the visible line"; `crypto-sync-section` test: "the refused wallet line names the wallet" |
| A35 | Pending deposit row, time empty, 0 or absent (O32); fixture from P4, or the three forms if the window is missed | `bybit.capital-history.test.ts`: "a pending row with no time owes its span as a range and gives no page drift"; `binance-history-status.test.ts` (edit): "the Bybit caption shows while that range is owed" |
| A36 | Earn row with a status outside the allowlist (O18) | `bybit.provider.test.ts`: "an Earn position outside the status allowlist adds nothing and counts in the left-out line" |
| A37 | Redeemed FlexibleSaving row (O18); fixture from P3 | same, "a redeemed FlexibleSaving row never adds" |
| A38 | An app fiat code outside the five, with a balance (O19) | `bybit.tracked-coin.test.ts`: "a fiat code outside the list lists as not tracked with no amount" |
| A39 | Rule 45, both outcomes (O14) | `bybit.capital-history.test.ts`: "a row goes on the wallet the outcome names and moves no balance". The outcome the probes do not show leaves the test with its code |
| A40 | Each shipped kind set (O15) | `bybit.shipped-copy.test.ts`: "each surface names each shipped kind and each unread kind, in en and uk". Its table has one row per kind set of section 8, picked by a literal in the test, not by an app flag |
| A41 | P12 refusal and empty 0 (O20) | `bybit.capital-history.test.ts`: "the floor is 729 days back unless the config sets a refused depth" |
| A42 | Every `balanceProviderIds` member (O17, O30) | `exchange-history-gate.test.ts`, beside `binance-history-status.ts`: "every balance provider has a gate decision" |
| A43 | Every `balanceProviderIds` member, set 7 (O21) | `exchange-catalog.test.ts` (edit): "every balance provider has a catalog entry and a registry entry" |
| A44 | Policy intro and counterparty text (O24) | `bybit.privacy-policy.test.ts`: "the section 3 intro names Bybit and the counterparty text says does not keep, in the four files" |
| A45 | Expiry text (O26) | `bybit.shipped-copy.test.ts`: "the ended and refused texts give both the renewal and the new-key route, in en and uk" |
| A46 | Coin with a borrow on a first connect (O27) | `bybit.provider.test.ts`: "a borrowed coin on a first connect creates no holding and lists itself"; `bybit.shipped-copy.test.ts`: "the borrowed line does not say a last balance exists" |
| A47 | Earn row with no `status`, `amount` non-zero (O31); fixture from P3 | `bybit.provider.test.ts`: "an Earn row with no status adds its amount" |
| A48 | FUND fails while UNIFIED reads, each with stored notes (O33) | `bybit.provider.test.ts`: "a wallet that read replaces its notes and a wallet that failed keeps them" |
| A49 | Each provider's calls to the caption helpers (O30) | `binance-history-status.test.ts` (edit): "Binance compares its 8 walks and Bybit compares only its own" |
| A50 | The hosts of the code and the md, set 7 (O29) | Plan set 7 step 4/6, by hand: each line of `npm run privacy:site -- hosts` is named in both md files |
| A51 | The EU copy, four surfaces (C1) | `bybit.shipped-copy.test.ts`: "connect, rejected key, footer and help each say Kiko does not support Bybit EU accounts and keep may not for other regional sites, in en and uk" |
| A52 | The host of a key (C1) | `bybit.endpoints.test.ts`: "the one signed host is api.bybit.com, and no env file, plist entry or client module names api.bybit.eu" |
| A53 | The closed list of routes (C2) | `bybit.endpoints.test.ts`: "the signed paths equal the literal list of reads, and the client sends only GET"; a step that adds a route adds its literal |
| A54 | The API management URL (C3) | `bybit-credentials-field.component.test.tsx`: "the API management link is the exact URL of part 2, with no query string" |
| A55 | The not-affiliated caption (C4) | `exchange-type-field.component.test.tsx` (edit): "the not-affiliated caption shows with Bybit in the sheet, and its en and uk text says so" |
| A56 | The Bybit key writer (C5) | `bybit.credentials.test.ts`: "the pair is written through hardenedFor at WHEN_UNLOCKED_THIS_DEVICE_ONLY" |

### Property suites

Through `sweep`, added to the `__tests__/property-sweep-sites.test.ts` list.

| # | Property | Test |
|---|---|---|
| Q1 | One currency per pair id over random coins and shared ids | `bybit.keys.property.test.ts`: "no pair id ever holds two coins" |
| Q2 | Every external id and holding key ends in the coin, BTC too | same, "every key carries its coin" |
| Q3 | Restart at any commit, only persisted state survives | `bybit.convergence.test.ts`: "a killed run converges to the rows of an uninterrupted one" |
| Q4 | Convergence under caps, seeds of section 5 | same, "reaches the floor within the table's runs" |
| Q5 | Halving: bursts | same, "a burst commits at least one span per run after its halvings" |
| Q6 | Idempotent re-read | same, "reading every window twice adds no row" |
| Q7 | No marks: `multiCoinSince`, `multiCoinSeen` | same, "a Bybit walk writes no multi-coin mark" |

### Red-first seam tests

The nine rows of section 6.5, each in the plan step where the seam changes, shown red on the parent; seam 8 by mutant
(CONFLICT 1). Seams 3, 4 and 9 change in set 3 step 6/6, the step that adds the `bybit` id, red first with the real id;
set 2 does not touch them (O30). Set 2 keeps Binance's suites green, unchanged except the log tag re-pins (O28). Set 3
step 6/6 also changes Binance's status suites: their calls gain the required provider argument, with the same expected
results (A49). Neither adds owed state to any Binance account, so no 1.2-upgrade seed moves. A Bybit account has no
1.2-upgrade world at all.

No migration in any set: `source`, `institution`, metadata and `exchange_state` have no SQL constraint (seam
map section 2). So no EXPLAIN test and no migration review step.

Pins that move, in the step that moves them (floor, developer greps): `provider.test.ts`,
`exchange-catalog.test.ts`, `registry.test.ts`, `help-topics.test.ts` (step count 5 to 6; the Binance step
stays 3, so "Enable Reading" holds; uk title), `en.uk.parity.test.ts`, `en.casing-by-role.test.ts`,
`uk.catalog-rules.test.ts`, `plist-credential-detect.test.ts`, the secrets shape suites of seam map section 10,
`binance-history-status.test.ts`, `binance-history-status.quiet-syncs.test.ts`.

## 12. Planner calls and conflicts

| Id | Call | Reason |
|---|---|---|
| PLANNER CALL 1 (closed by the user's Q2) | No notification | The user's answer. Measured, now under Backlog: four rules oppose it |
| PLANNER CALL 2 (changed by O13) | Refuse at connect a read-write key, a key with `isMaster` not true, and a key with a missing box, stricter than Binance | Binding "read-only"; a wrong balance is the anti-goal; the facts cost no call |
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
| PLANNER CALL 14 (changed by O15) | Internal deposits ship only with a real sender; with none, the copy states that limit | "Only tested data kinds"; the user may have no second Bybit user |
| PLANNER CALL 15 (changed by O21) | The device check builds the set 7 branch before any merge of sets 3 to 7 | O9 asks for catalog last and after the check; a device needs a way in |
| PLANNER CALL 16 | Keep the 7-day and 29-day windows, no adaptive width | The cursor reader follows pages; no measured need for narrower |
| PLANNER CALL 17 (changed by O33) | One new patch kind `balanceNotes` holds the refused wallets, borrowed coins and Earn left-out count, per wallet: a wallet that this run read replaces its notes, and a wallet that failed keeps them, plus its refused mark when the failure is a 10005 | O13, O18 and rule 6 each need a visible line that reads persisted state; the section reads only that (section 5, "Caption false"). Precedent: `oversizedBalance` and `complete` in `exchange-state-patch.ts` (CODE). It holds no secret, and `exchangeStateReset` drops it |
| PLANNER CALL 18 (part 1 done 2026-11-03, O39) | The browser step splits: the terms come first, before the key moment; the URL check stays at R1 | O23 moves the verdict before code; a forbidding clause found first costs the user no account or money, and the URL check may need a login |
| PLANNER CALL 19 (withdrawn by O30) | None; the id stays retired | See the O30 row of the next table |
| PLANNER CALL 20 (new) | `hasExchangeHistory`, `captionWalksOf` and the tracked predicate table live in the existing `src/screens/account-detail/crypto-sync-section/binance-history-status.ts` | O30 asks for a named source module. An existing module lets a red call a missing export with no import of a missing module, and the helpers it serves are there; O7 keeps the file name |
| PLANNER CALL 21 (new) | The Bybit tracked predicate is a named part of plan set 3 step 6/6, not a step of its own; `isTrackedBybitAsset` itself is written at step 4/6 | O30 asks for a named step and for seam 3 in the step that adds the id. A table typed by `BalanceProviderId` does not compile with the id and no entry, and each step has a green commit that passes the typecheck |
| PLANNER CALL 22 (changed by O37) | K11 moves from R6 to R4. Before set 7's device check, the user subscribes Flexible Savings again if it ships | O31 puts the redeem at R4, and a position redeemed in full leaves nothing to check on device |
| PLANNER CALL 23 (accepted by O41) | The user's approval of the spec moves after the terms verdict, before R1. Set 1's script does not wait for it | O38 puts the paste and the verdict first and names no place for the approval. The approval then covers the verdict, and the script is reviewed meanwhile |
| PLANNER CALL 24 (reversed by O40) | R4 comes after the R3 run of P3 shows the position, with no fixed day | P10's position older than a day was the only reason for a wait, and P10 left. Cost if wrong: R4 is repeated, at no money |

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
| O30 (replaces O17's double and PLANNER CALL 19) | Seams 3, 4, 9 and their reds | set 2, with a test double provider id | set 3 step 6/6, the step that adds the id, red first with the real id |
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

| Id | Conflict | Kept |
|---|---|---|
| CONFLICT 1 | O7 asks a failing-first test for each of nine seams; seam 8 has no behaviour to change, so a parent red cannot exist | The ruling's row stands; its test is proven by a scratch mutant, per kiko-testing "load-bearing" |

## 13. User questions (answered)

| Question | The user's words, 2026-11-03 | What holds now |
|---|---|---|
| Q1: which stages ship in 1.4 | "Q1 A+B." | Balances plus deposits, withdrawals and transfers, the moves that explain a balance. Stages C and D are deferred under Backlog (O37) |
| Q2: how the user learns of the 90-day expiry | "Q2 detail line + failure text only." | Section 7. No notification |
| Q3: two ledger gaps with no effect on any balance | "Q3 accept the two gaps." | Accepted limits for 1.4, reopened only on a measured case. (a) A deposit rolled back after the 29-day re-scan keeps its row; a longer re-scan would cost 3 more calls per extra window on every run. (b) A day with more rows than a run's calls (1,000 transfers or 1,500 of one capital series) holds its walk, with the caption up; a higher cap would load a pool shared with other accounts |
| Q4 (F2): may 1.4 ship before R7 proves renewal after an expiry (about day 90 of the first key) | "Q4 ship before a real expiry proves renewal, with text that fits both outcomes." | 1.4 ships with the copy of O26. R7 and P17 stay an open check after the ship. Renewal after the date stays UNPROBED(P17) until R7 runs |
| Guideline 5.2.2 and the API 6.5 doubt (section 9) | "The user in EU can't obtain API key, hence adding bybit to kiko is pointless. Continue."; then, asked which reading, the user picked "Keep Bybit, global only" | Keep Bybit, global accounts only, no letter to Bybit. Both doubts stay open and accepted (O42). No question is left open |

The user's words on the order, the same date: "Spend no money and ask for no account step before the terms verdict."
(O38, section 10.)

Merge order (O21), a recommendation to the coordinator, who owns the merge: set 2 alone; sets 3 to 7 stay out of `next`
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

### Deferred: stages C and D (O37)

Not built in 1.4, and not counted in the plan's sets. A later track takes each up with its own sets, its own user steps
and its own review of these rows. Every row here keeps its mark.

Stage C:

| Series | Endpoint | Window | Page | Rule | Evidence | Probe |
|---|---|---|---|---|---|---|
| UNIFIED log | GET `/v5/account/transaction-log`, `accountType=UNIFIED` | 7 days, QUOTE "up to 2 years" | 50, cursor | A `type` seen on the small account imports; any other is counted, never parsed, and reaches the not-imported line (rulings, "history tracked rule"). New `WALK_IDS` member `log`, new not-imported kind | QUOTE; one row per fill UNVERIFIED | UNPROBED(P8) |
| Convert | GET `/v5/asset/exchange/query-convert-history` | none; `index` from 1 | 100, index | Pair `<acc>:convert:<exchangeTxId>`; the same convert in the log as `CURRENCY_BUY`, `CURRENCY_SELL` or `CONVERT` must not import twice. Web converts from 2025-09-10 only (QUOTE) | SUMMARY; retention UNVERIFIED | UNPROBED(P9) |

Stage D:

| Series | Endpoint | Window | Page | Rule | Evidence | Probe |
|---|---|---|---|---|---|---|
| Earn orders | GET `/v5/earn/order`, `category=FlexibleSaving` | 7 days | 100, cursor | QUOTE "For category = OnChain, either orderId or orderLinkId is required", so on-chain orders are not walkable; the log's rows or nothing | QUOTE; retention UNVERIFIED | UNPROBED(P10) |
| Yield | GET `/v5/earn/yield`, per category | 7 days, floor `now - 90 days` from QUOTE "the past 3 months" | 100, cursor | The rolling floor drops yield the app did not read in time, the sharpest case of rule 26 | QUOTE | UNPROBED(P10). Needs a position older than a day |

Call counts, COMPUTED as in section 5:

| Stage | Series | Route limit (research J) | Window | Windows to floor | First read, calls | Steady, calls per run | MEASURED after |
|---|---|---|---|---|---|---|---|
| C | log | 25/s | 7 d | 105 | 105 | 2 | P8 |
| C | convert | 50/s | none | | 1 + rows/100 | 1 | P9 |
| D | earn orders | UNVERIFIED | 7 d | 105 | 105 | 2 | P10 |
| D | yield x2 categories | UNVERIFIED | 7 d, 90 d floor | 13 x 2 | 26 | 4 | P10 |

Totals: C first at least 106, steady 3. D first 131, steady 6. All four stages: first at least 420 gated, steady 17 gated
plus 5.

User runs and probe parts, for the later track's script:

| Run | When | The user does first | Parts | Proves |
|---|---|---|---|---|
| R5 | When stage C is taken up | K9: one spot buy. K10: one convert in FUND and one in UNIFIED, from web or app | P8, P9, P18 | Log rows per fill, the `type` allowlist, convert double read |
| R6 | When stage D is taken up | Nothing new while the K11 order of R4 is in reach; if P10 does not show it, K4 and K11 again. Yield needs a position older than a day | P10 | Order rows and yield rows |

| Part | Prints | Unlocks |
|---|---|---|
| P8, P9, P10 | The same as P4 to P7, for each stage | The later track's sets |

Research "STILL NEEDS THE KEY", the items only these stages need:

| # | Item | Part |
|---|---|---|
| 7 | A log row per fill; `type`, `displayType`; a FUND-only coin | P8 |
| 8 | API and web converts; double read in the log | P9 |
| 12, part | Earn order shape, hourly yield retention | P10 |

Copy edits: each stage edits `bybitKinds`, the footer `holdingDetail.exchangeNotListed.bybit`, the help step, the policy
blocks of section 9 and `bybit.shipped-copy.test.ts` in the same commit as its kind (memory
intermediate-task-tip-must-be-safe): a kind that now reads leaves the not-read list. Stage D also states in copy what the
3-month floor drops.
