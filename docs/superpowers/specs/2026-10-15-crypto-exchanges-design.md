# Crypto exchanges 1.3: shared exchange layer and multi-coin Binance (1.3-a)

Date: 2026-10-15. Status: draft for user approval, after review round 2 and the NR4 ... NR7
rulings. Rulings: `.superpowers/sdd/binance-multicoin/rulings.md` (user rulings cited as R-Scope,
R-Q3 ... R-Q16, R-Tech; the coordinator rulings at its end cited as C-NR1 ... C-NR7; C-NR2 is
confirmed by the user). Base: branch `binance-backfill-fix`. Track: `crypto-exchanges-1.3-a`.

Every code fact below names a symbol or an anchor text, never a line. The base moves: the developer
re-greps every fact on the actual base before relying on it. Migration numbers 0059-0061 follow
the base's last migration (0058); they are re-checked against main's
`drizzle/migrations/meta/_journal.json` at each merge and renumbered (files, journal, tests) if main
has moved.

Inputs: `rulings.md`, `brainstorm.md`, `brainstorm-ops.md`, `research-binance-api.md`,
`research-binance-ops.md`, `research-exchanges.md`, `research-bybit.md` (same folder); the specs
`2026-10-09-binance-pay-history-design.md` (cited as "the history spec") and
`2026-09-04-crypto-btc-sync-design.md`; the inventory probe output
`memory/refs/binance-inventory-probe-output-2026-10-15.txt` (main checkout).

## Problem

Kiko reads one coin from Binance. `BINANCE_ASSET = 'BTC'` filters the balance reads
(`binance.provider.ts`: `spotSatoshis`, `fundingSatoshis`, `positionSatoshis`) and every history
walk (capital `coin=BTC`, Pay `isBtcFunds`, Transfer `record.asset !== BINANCE_ASSET`, Earn
`asset=BTC`). The user's own account holds USDT too: 41 of 46 Pay orders, one of three withdrawals
and the one Convert (UAH to USDT) are USDT (inventory probe, 2026-10-15); probe 2 also found CGPT in
the Funding wallet. None of them reaches Kiko. Trades, Convert, P2P, fiat orders, card buys, dust
and distributions are not imported for any coin. USDT is stored at scale 2 (`currencyScale.USDT`),
while Binance reports 8 decimals, so sub-cent USDT amounts round away. The provider list is closed
(`balanceProviderIds`), so a second exchange needs edits in every caller.

## Goal

1. A shared exchange layer that Binance uses first and Bybit (1.3-b) plugs into (R-Scope, R-Tech).
2. Every curated coin and every Binance fiat currency the user holds on Binance becomes a holding
   per coin per wallet, valued from the market (R-Q3, R-Q4, R-Q6, R-Q15).
3. Every common Binance operation the API exposes becomes rows on those holdings (R-Q9), with the
   exclusion from spending decided only by stored markers (R-Tech).
4. What Kiko cannot list stays visible: the not-tracked coins line, the "Earlier history" line and
   the not-listed note (R-Q3, R-Q16).
5. No data loss: today's BTC rows, keys and cursors carry over byte-identical (R-Tech).

## Run-log gaps

`node harness/kiko/scripts/run-log.mjs stats --gaps --repo kiko` (re-read 2026-10-15 for this
round). This spec closes none of them and leaves every one open.

| Gap | Relation to 1.3-a |
|---|---|
| `20261015T1035-kiko-release-1-2/1` (1.2 export drops `untracked_counterpart`) | OPEN. Same class as the new `operation` column (set 7) and the C-NR1 marker form: a `.kiko` from a build without the column restores it as null. Set 7 adds the back-compat case; the 1.2 note itself stays with scribe |
| `20261013T2223-kiko-harness-h5/5`, `/6`; `20261014T0952-kiko-harness-h7/1`; `20261015T0021-kiko-harness-h7/1`; `20261015T0639-kiko-harness-h7/1`; `20261015T1119-kiko-harness-h7/1` | OPEN, unrelated (harness deferred minors, harness repo sync, app guard rules, kill-guard script scan) |

## 1. Goal, rulings, scope, release rule

### User rulings (binding; `rulings.md`)

| Id | Ruling | Where |
|---|---|---|
| R-Scope | 1.3 = shared layer + multi-coin Binance (1.3-a) + Bybit (1.3-b, own spec). OKX and others 1.4+. Ship only exchanges verified on device with a real key. Each exchange complete or not at all, no flag; Bybit late moves to 1.3.x. Plain-text names, generic icon, no logo, "not affiliated" caption, API terms checked before each exchange ships | 1, 2, 9 |
| R-Q3 A | Curated coin list in the app (code, decimals, symbol, CoinGecko id). Coins outside it show as "not tracked" with their ticker on the account screen | 3 |
| R-Q4 A | List = the user's coins (inventory probe) + top ~30 by market cap + USDT, USDC, FDUSD, DAI; stablecoins priced from the market, never 1:1 | 3 |
| R-Q5 A | USDT, USDC, FDUSD, DAI at 8 decimals; exact rescale migration of USDT holdings, rows, price points and `.kiko` imports; reviewer step; exact-parity test | 3, 7 |
| R-Picker | The manual holding form lists every curated coin; a crypto base currency stays not selectable | 3 |
| R-Q6 A | One holding per coin per wallet ("Binance Spot · USDT"); appears on first non-zero balance or first row; stays at 0 when emptied; dust creates none; default-named BTC holdings renamed, user renames kept | 4 |
| R-Q15 A | Binance fiat balances as holdings per fiat currency per wallet, with fiat deposit/withdraw rows | 4, 5 |
| R-Q7 A | Pay order paid with another coin: one row per coin actually debited, on that coin's wallet holding, the order amount in the row note | 5, 6 |
| R-Q8 A | Backfill old ground for the new coins only, over the next syncs, to Binance's floors; BTC not read twice; caption meanwhile | 7 |
| R-Q9 | "We need all common operations displayed": spot trades, Convert, P2P, fiat buy/sell (fiat/payments), fiat deposit/withdraw, dust, dividends/airdrops, plus deposits, withdrawals, transfers, Pay, Simple Earn | 5 |
| R-Out | Out: futures, margin, options (one-leg transfers as today), Binance Card and Gift Card (no API), Crypto Loans, ETH/SOL staking, Mining, NFT, copy trading, Dual Investment, sub-accounts. Auto-Invest is the first follow-up. Each exchange holding shows a short not-listed note | 1, 6, 10 |
| R-Map | trade/Convert/dust = Exchange pair; P2P and card buy = one crypto row with a `p2p:<FIAT>` / `card:<FIAT>` untracked counterpart and the fiat total in the note; dividends = income rows (allowlisted types); one nullable `operation` label column (ADD COLUMN migration, reviewer). C-NR1 moves the fiat total into the code (`p2p:UAH:4000.00`); the note only displays it | 5, 6 |
| R-Q11 A | One Exchange pair per ORDER (fills summed) | 5, 6 |
| R-Q13 | "Subtract trading fee from the amount received": no fee row, no "Fees" spending; the received leg is net. Fee in a THIRD coin (BNB): a small negative row on that coin's holding, linked to the same exchange pair id, kept OUT of spending. A fee in the SPENT coin: C-NR2 | 5, 6 |
| R-Q12 A | Withdrawals keep counting as spending unless linked by hand (no change) | 6 |
| R-Q14 A | The bank debit of a P2P buy / card buy / fiat deposit is matched at statistics read time and kept out of spending; nothing rewritten; an unmatched debit still counts | 6 |
| R-Q16 A | "Earlier history: <amount>" line at the bottom of each exchange holding's list (live balance minus imported rows) + the not-listed note; no fake row; statistics unchanged | 6 |
| R-Q10 | "How banks are connected today": an "Exchange or wallet" picker field in the account form (catalog bottom sheet + not-affiliated caption), the exchange's key form inline below; the same sheet from the account detail; an exchange catalog stored in `bankId` (no migration); an exchange provider registry replaces the closed lists; one Keychain entry per exchange per account | 8 |
| R-Tech | Shared layer now with Binance first; history read account-wide; today's BTC keys byte-identical; new coins' Pay keys add the currency; migration 0044 frozen, `.kiko` restore keeps the frozen 1.0 list; LD* skipped in Spot; 2 SPKI pins per new host; walk state in a `sync_state` JSON column; one budget lane and cursor per new history read; every history read after the balance read, never failing it; exclusion only by stored markers; en + uk with translator review; privacy policy and App Privacy label per exchange. "14 change sets; sets 7-11 wait for probe 2": the coordinator split set 1 into two, so 1.3-a has 15 sets and probe 2 gates sets 8-12 | all |
| R-Display (Q1 A) | A crypto amount displays its exact value with trailing zeros trimmed, never fewer than 2 decimals (BTC too); stored amounts stay exact; fiat display unchanged | 3, 11 (set 1) |

### Coordinator rulings (binding; `rulings.md`, "Spec NEEDS RULING")

These are the coordinator's rulings, not the user's, except C-NR2, which the user confirmed
(2026-10-15).

| Id | Ruling | Where |
|---|---|---|
| C-NR1 A | The fiat total of a P2P buy, card buy or fiat deposit is stored in the marker code as a major-unit decimal at the fiat's scale: `p2p:UAH:4000.00`, `card:UAH:2600.00`, `bank:EUR:100.00`. Parsed by the exact decimal parser (`src/currency/decimal/decimal.ts`), never `Number()`. The note (`comment`) only displays the total | 5, 6 |
| C-NR2 B | A fee charged in the SPENT coin is added to the spent leg (spent leg = gross + fee); no extra row; out of spending. CONFIRMED BY THE USER (2026-10-15) | 5, 7 |
| C-NR3 A | An operation whose wallet the API does not name goes on the wallet probe 2 observes on the user's account; when probe 2 sees no records of it, the default is Convert -> Spot, P2P -> Funding, fiat orders and payments -> Spot. The not-listed note names the assumption. Final after probe 2 | 5, 10 |
| C-NR4 A | If Binance refuses `fromId` together with `orderId` (probe P15b), an order with more than 1000 fills is re-read through the normal trade id cursor, keeping only that order's fills. Not needed while P15b holds (C-NR7); P15b is a hard gate before set 11 | 5, 12 |
| C-NR5 A | A third-coin fee row of a trade whose RECEIVED coin is not tracked carries `untrackedCounterpart = asset:<received coin>` and stays out of spending | 5, 6, 7 |
| C-NR6 B | The C-NR4 fallback starts from the order's stored row time (the first fill time). Not needed while P15b holds (C-NR7); P15b is a hard gate before set 11 | 5, 12 |
| C-NR7 A | The C-NR4 / C-NR6 re-read fallback is cut from 1.3-a. P15b (`myTrades` with `symbol` + `orderId` + `fromId` pages an order's fills by id) runs in probe 3 as a hard gate before set 11: refuted or untestable (for example, no spot order on the account) -> stop and ask the coordinator | 5, 11, 12 |
| C-CGPT A | CGPT (ChainGPT) is added to the curated list: probe 2 found it in the user's Funding wallet, and R-Q4 lists the user's own coins | 3 |
| C-P2P-depth | Probe 2 found P2P rows 8-9 months back: the P2P walk has no fixed month cap; it walks back until Binance stops serving, and probe 3 measures the real depth | 5, 12 |
| C-NR8 A | `exchange_state` holds two lists per kind (not tracked, oversized): a balance list, replaced by each good balance read, and a history list, which only grows and is cleared on disconnect. The account detail shows the sorted union of the two lists of a kind, without duplicates | 2, 3, 5, 7 |
| C-Prep A (Q2-Q12) | `restoreDataSnapshot` takes a required version; an `amountTooLargeError` import key; set 3 moves code only, and sets 5-6 switch to `exchangeMinorUnits`; the parser lives in set 2; `exchangeHistoryPaused` is set 4's; per-migration `VERSION_DECISIONS`; credential wrappers stay in `binance/`, and `exchange/` is a declared container; history only for held coins; the privacy-site copies; set 4's test-helper first commit; `bond_register` excluded from 0059 | 2, 3, 7, 9, 10, 11 |

### Rulings this spec reverses

Each reversal has a "was:" column in its scenario matrix (section 7).

| Earlier rule | Source | Now |
|---|---|---|
| BTC only; other coins never read | crypto BTC sync spec; history spec "Goal" | every curated coin and fiat (R-Q3, R-Q15) |
| Convert deferred: no wallet field (D7) | history spec D7 | Convert imported (R-Q9) on the C-NR3 wallet |
| Trades out of scope | history spec "Scope" | spot trades imported (R-Q9, R-Q11, R-Q13, C-NR2) |
| A non-BTC Pay order paid with BTC stops (`pay-btc-funded-other-coin`, user ruling A2 2026-10-10) | history spec P9, Q8 | one row per debited coin (R-Q7) |
| `currencyScale.USDT` = 2 | `currency.ts` | 8 (R-Q5) |
| A crypto amount shows every decimal of its scale (`₿0.05000000`) | `formatMoney` (`format.ts`) | trailing zeros trimmed, at least 2 decimals (`₿0.05`; R-Display; DP1-DP5) |
| Default names "Binance Spot/Funding/Earn" | `WALLET_HOLDING_NAMES` | "Binance <Wallet> · <COIN>" (R-Q6) |
| The caption shows for null/behind cursors and a Transfer owed range only (OVERNIGHT 20 = B) | history spec section 8 | also while a backfill range is owed (R-Q8) |
| The fiat total of a P2P / card / fiat row lives in the note | R-Map | in the marker code; the note displays it (C-NR1) |
| The 2-minute same-amount matcher (`internalTransferTransactionIds`) sees every row of the ledger | `statistics.screen.tsx` | it sees only rows with no `exchangePairId`, no `exchangeCounterpartHoldingId` and no `untrackedCounterpart` (section 6, S1) |
| Every bank debit counts as spending unless another rule excludes it | statistics today | a debit matched to a P2P / card buy or a fiat deposit is excluded (R-Q14; M matrix) |

### Scope

In (1.3-a): the shared layer (section 2); the curated coin registry and stablecoin precision
(section 3); per-coin and fiat holdings (section 4); the history streams of section 5 on every
curated coin and fiat; row mapping, `operation` column, matchers, "Earlier history" and the
not-listed note (section 6); migration of BTC state and the backfill (section 7); the connect flow
(section 8); compliance (section 9); copy (section 10).

Out: R-Out, plus Bybit itself (1.3-b, its own spec; section 2 lists what 1.3-b adds).
Not possible (API limits, not choices): Pay older than 18 months, transfers older than 179 days, P2P
older than Binance serves (probe 3 measures the depth; probe 2 served rows 8-9 months back), dust
beyond the last 100 records, Binance Card spending (no API). The "Earlier history" line shows the
gap; the not-listed note names it.

### Release rule (App Store Guideline 2.3.1(a))

- 1.3-a ships only with all 15 change sets merged and verified on the user's device with the user's
  own read-only Binance key (R-Scope). There is no flag, no `SHOW_*`/`HIDE_*`/`ENABLE_*` control,
  no catalog entry for an exchange that is not complete, and no dormant reader (kiko-architecture
  "Guideline 2.3.1(a) — no hidden features (Apple's rejection cited 5.6)"; Semgrep
  `kiko-no-hidden-feature-flag-or-demo-import`).
- Bybit gets a catalog entry only in the change set that completes it (1.3-b). If 1.3-b misses the
  1.3 cut, 1.3 ships 1.3-a alone and Bybit moves to 1.3.x.
- Every feature is reachable by the reviewer: the demo `.kiko` shows the curated coins as manual
  holdings with stored operation rows, and the Notes for Review list every new visible feature and
  say how a credential-bound one is reached (section 9).

## 2. The shared exchange layer

### Units (new folder `src/crypto-sync/exchange/`, one subfolder per unit, each with a barrel)

| Unit | Contents | Moves from |
|---|---|---|
| `exchange/registry/` (created in set 14, not set 3) | `ExchangeId` (`'binance'` in 1.3-a), `ExchangeProvider` type, `exchangeProviderRegistry: Partial<Record<ExchangeId, ExchangeProvider>>`, `isExchangeId` | replaces `balanceProviderIds`'s Binance arm, `providerDisplayName`'s Binance arm, `disconnectMessage`, the `isBalanceProviderId` branch of `syncJobsFor` (`src/sync/sync-jobs/sync-jobs.ts`) |
| `exchange/credentials/` | `ExchangeCredentials = { apiKey: string; secret: string }`; `credentialServiceFor(exchangeId, accountId)` = `kiko.<exchangeId>.credentials.<accountId>`; save/load/clear over `react-native-keychain` with the shared `hardenedFor` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no access control) | `binance.credentials.ts` (`serviceFor`, `BINANCE_CREDENTIALS_SERVICE`): the Binance service string stays byte-identical |
| `exchange/signing/` | `SignRequest = (request: UnsignedRequest, credentials, nowMs) => SignedRequest` (query, headers, body). Binance: HMAC-SHA256 hex over the query, `X-MBX-APIKEY` header | `binance.hmac.ts`, the signing part of `signedRequestPage` |
| `exchange/budget/` | `RunBudget<Lane>`: per-lane call caps, narrowing calls, keeps, `canAfford(lane, cost, keep, narrowing)`, `record(lane, page, narrowing)`; one `RequestGate` per run; `createExchangeRun(clock)` | `binance.history-budget.ts` (shape); Binance numbers and weight headers stay in `binance.history-budget.ts` |
| `exchange/paging/` | `Pager` interface (below); `offsetPager` (today's `fetchAllByTotal` + `readSeriesSpan` + span halving); `idCursorPager` (set 10) | `binance.history-paging.ts` |
| `exchange/walk/` | the walk engine: `planWalkPasses`, `runWalkPlan`, `walkSpans`, `buildWalkWindows`, owed ranges and points, range cursor, span hints, `settleRecords`, `commitSettledSpan`, `placeWalletRows`, depth guards; `WalkStop` codes generic, exchange codes added per exchange | `binance.history-walk.ts`, `binance.history-records.ts`, `binance.history-depth.ts` (constants become a per-exchange `DepthConfig`), `binance.walk-write-deps.ts` |
| `exchange/walk-state/` | `ExchangeState` type, its per-walk strict parse, readers and the gated writer over `sync_state.exchange_state` (set 4) | the walk-owned metadata keys of `holding-metadata.ts` (`binanceWalkCursorFields`, `binanceWalkPendingFields`, `binanceWalkPointCursorFields`, `binanceWalkRangeCursorFields`, `binanceWalkSpanHintFields`) and `holdingsRepo.setBinanceWalkCursor`, `setBinanceWalkPending`, `setBinanceWalkSpanHints`, `resetBinanceWalkCursors` |
| `exchange/history-status/` | `isExchangeHistoryBehind(state, latestSyncedAt)`, `untrackedCoinsOf(state)` and `oversizedCoinsOf(state)` (each the sorted union of its kind's balance and history lists, C-NR8; `untrackedCoinsOf` leaves out a ticker that is a curated code now) | `screens/account-detail/crypto-sync-section/binance-history-status.ts` (`walkCursorsOf`, `transferOwesRange`, `isBinanceHistoryBehind`) |
| `exchange/amounts/` | `exchangeMinorUnits(currency, text, use: 'balance' \| 'row'): Either<AmountError, number>`: a wrapper over set 2's exact decimal-to-minor-units parser in `src/currency/decimal/decimal.ts`; both modes refuse an exponent form (`amount-malformed`) and a result above `Number.MAX_SAFE_INTEGER` (`amount-too-large`). `'balance'`: more decimals than the scale round half away from zero and log `balance-precision-rounded`. `'row'`: more decimals than the scale are refused (`amount-precision`), except on a reduced-scale coin (section 3), where they round the same way and log `row-precision-rounded` | new in set 3 with no caller; set 5 switches `sumSatoshis`/`Money.fromMajor(BINANCE_ASSET, Number(...))` in `binance.provider.ts` to it, set 6 switches `btcSatoshis` (`binance.history-walk.ts`) |

The Binance host constant stays in `binance.client.ts` (re-grep the `@env` host); there is no
hosts unit in 1.3-a.

Set 3 moves code only. `btcSatoshis` and `sumSatoshis` keep their behaviour there: a JS number or
any `Number()`-parsable string (an exponent form too), rounded through `Money.fromMajor`. The
switch to `exchangeMinorUnits` in sets 5 and 6 is a behaviour change on off-contract input, so its
cases carry "was:" rows (A1-A4, section 7).

The Binance-specific credential functions (`saveCredentials`, `readCredentials`,
`clearCredentials`, `migrateBinanceCredentialToPerAccount`) stay exported from `binance/` as thin
wrappers over `exchange/credentials` with the exchange id `'binance'`. Callers outside the folder
keep their imports, and no barrel re-exports another feature's module. Set 3 declares the
`exchange/` container in `scripts/checks/feature-imports.js`, so each unit is a feature imported
through its barrel and the units import one another as `../<sibling>`.

`ExchangeProvider` (no UI import; the connect field map lives in the screens layer, like
`connectFieldByProviderId` in `bank-sync-section.component.tsx`):

```ts
type ExchangeProvider = {
  id: ExchangeId;
  displayName: string;            // proper noun, code-side, e.g. 'Binance'
  metadataField: ExchangeMetadataField; // 'binanceAsset'
  runSync: (accountId: string) => Promise<void>; // balance, then history (never fails balance)
  hasCredentials: (accountId: string) => Promise<boolean>;
  disconnect: (accountId: string) => Promise<void>;
};
```

### Pager interface

```ts
type SpanRead<Record> =
  | { kind: 'read'; records: Record[]; unreadable: UnreadableRow[]; calls: number }
  | { kind: 'halve' }                      // offset pager only: a full page in a span that halves
  | { kind: 'stop'; code: WalkStopCode };   // drift, budget, rate limit
type Pager<Series, Record> = {
  readSpan: (series: Series, span: WalkWindow, budget: RunBudget<Lane>) => Promise<SpanRead<Record>>;
  callsOf: (series: readonly Series[]) => number;
};
```

- `offsetPager`: today's behaviour moved as is (time window, `current`/offset pages, `total`
  drift checks, halving, 50-page cap at 1 ms).
- `idCursorPager` (set 10): a series has an id cursor, not a time window. `readFrom(series,
  fromId, budget)` reads pages of `limit` ascending by id until a short page or the lane cap; it
  returns the records and the next `fromId`. No halving. Binance `myTrades` uses it.

### Walk state in `sync_state` (set 4)

One nullable JSON column `sync_state.exchange_state` per account (R-Tech). Shape:

```ts
type ExchangeState = {
  version: 1;
  walks: Partial<Record<WalkId, WalkMarks>>;   // WalkId = 'capital' | 'pay' | 'transfer' | 'earn'
                                              //  | 'convert' | 'dividend' | 'p2p'
                                              //  | 'fiatOrders' | 'fiatPayments'
  trades?: { symbols: Record<string, { fromId: number | null; heldOrderId?: number }>;
             rotation: number; balanceSnapshot: Record<string, string> };
  untrackedCoins?: CoinLists;                 // tickers not on the coin list (C-NR8)
  oversizedCoins?: CoinLists;                 // tickers refused as amount-too-large (C-NR8)
};
type CoinLists = {
  balance?: string[];                         // replaced by each good balance read
  history?: string[];                         // grows with each history read; cleared on disconnect
};
type WalkMarks = {
  cursor: number | null; rescan?: number; pending?: BinancePendingRange[];
  pointCursor?: number; rangeCursor?: number; spanHints?: BinanceSpanHints; multiCoinSince?: number;
  multiCoinSeen?: true;                       // the walk's first multi-coin run happened (section 7)
  emptyWindows?: number;                      // P2P only: empty windows in a row (section 5)
};
```

Dust has no walk entry (one call per run, keys dedupe; section 5). `'dividend'` exists only if the
dividend walk ships (section 5, "Dividends").

`BinancePendingRange` (`holding-metadata.ts`; `OwedGround` in `binance.history-walk.ts` is an
alias of it) is today's shape plus an optional `scope: 'backfill'` on a range (section 7).
`spanHints` is today's `BinanceSpanHints` record (`holding-metadata.ts`: one hint list per pass,
`forward`, `pending`, `rescan`, `point`), an object, not a list; its shape stays.

Parse, per walk (set 4):

- The column parses in two levels. Top level: an object with `version: 1` and an object `walks`.
  A top-level value that fails this (not JSON, wrong version) is malformed: the account's history
  walks do not run (the balance read still does), the tag `exchange-state-malformed` logs once per
  run, the caption shows its paused copy (`accountDetail.exchangeHistoryPaused`, section 10; set 4
  adds the key in en and uk, with translator review), and nothing writes the column until
  disconnect resets it. The malformed text is never overwritten by a walk patch.
- `trades` and each of the four coin lists (`untrackedCoins.balance`, `untrackedCoins.history`,
  `oversizedCoins.balance`, `oversizedCoins.history`) parse on their own; a malformed one reads as
  its empty value and logs the same tag with the entry name.
- A walk entry parses FIELD BY FIELD, each field with today's per-field rule, so a malformed field
  never empties its siblings: `cursor` and `rescan` as `binanceWalkCursorOf` reads them (a
  non-number reads as null); `pending` by `readPendingMark` (all ground before the cursor owed,
  written once); `pointCursor` and `rangeCursor` by `readRoundRobinCursor` (repaired to
  `BEFORE_EVERY_GROUND`, written once); `spanHints` by `readSpanHints` (`span-hints-malformed`,
  reads as `NO_HINTS`); `multiCoinSince` as a number or absent, and a present but malformed one (not a
  finite number) reads as the entry's parsed `cursor` (absent when that cursor is null): fail-safe, it
  owes a range rather than none; `multiCoinSeen` as `true` or absent (any other value reads as
  absent). A walk entry that is not an object
  reads as every field's empty value and logs the tag with the walk id. The developer re-greps each
  reader and its repair write on the base. Each repair writes only its own field.

Writer: `syncStateRepo.patchExchangeState(accountId, exchangeId, patch)` runs inside `write(...)`
(`src/db/client.ts`, the serialized write the repos use; not `db.transaction()`), re-reads the row,
and writes only while `accounts.institution` is still `exchangeId` (today's `institution = 'binance'`
gate of `setBinanceWalkCursor`). A patch names fields, not whole entries: a (walk id, field) pair,
a trade symbol's entry, `trades.rotation`, `trades.balanceSnapshot`, or one coin list (its kind
and its source). A balance-list patch replaces that list; a history-list patch adds tickers to it
(a union, no duplicates), so a balance read never drops a ticker a history read found. The writer
replaces only those and writes every other field and entry back as its stored JSON text,
byte-identical, a malformed one included. When no `sync_state` row exists, the writer inserts one.

### History-behind caption

`isExchangeHistoryBehind` is true, after the account's first balance sync, when any walk's cursor
is null or more than a day behind `latestSyncedAt`, when the Transfer walk owes a range, when any
walk owes a `scope: 'backfill'` range, when the top-level state is malformed, or when a trade
symbol in the candidate set was never read (no entry, or a null `fromId`; a completed read always
stores a number, section 5). An owed point never shows it. The caption names the exchange
(`accountDetail.exchangeHistoryPending`, section 10); while the top-level state is malformed it
shows `accountDetail.exchangeHistoryPaused` instead, which says history import is paused and that a
disconnect and reconnect repairs it.

### Stays Binance-specific (`src/crypto-sync/binance/`)

Client and endpoint parsers (`binance.client.ts`, `binance.history-client.ts`), the host, HMAC key
header, weight headers, cooldown (`binance.cooldown.ts`), credentials field UI
(`BinanceCredentialsField`), holding keys and wallet maps (`binance.holding-keys.ts`, `walletOf`,
`walletType` maps), each walk file (capital, Pay, Transfer, Earn, and the new Convert, dust,
dividend, trades, P2P, fiat walks), the lane numbers and `COSTS`, the depth constants and error
codes (-5026, 403004), the Pay direction and placement rules, the Earn reward key.

### What 1.3-b adds (Bybit; its own spec)

1.3-a builds none of these; the layer above leaves room for them:

- a key-expiry read (`/v5/user/query-api` `expiredAt`, 90-day keys) and its account-detail line;
- a region field on the credentials and a host list per region (`api.bybit.eu` refuses personal
  keys, error 81007), each host with 2 SPKI pins;
- `X-BAPI-*` header signing and a typed clock-skew error (10002) behind `SignRequest`;
- an opaque-cursor pager (`nextPageCursor`) on the `Pager` interface; per-series window and floor
  (7-day ledger windows, 2 years; Earn yield 3 months);
- a request-count budget (600 per 5 s per IP) beside Binance's weight budget;
- holding keys `<COIN>[:wallet]` under its own metadata field (`bybitAsset`), wallets UNIFIED and
  FUND;
- its own `.kiko` secrets entry with a version guard.

## 3. Currency model

### Curated coin registry (`src/currency/coins/coins.ts`, new, set 2)

`Currency` stays a closed union: `currencyOptions` lists every curated code literally in its crypto
block, after the fiat block (R-Q3). The registry is
`curatedCoins: Readonly<Record<CryptoCurrency, CoinEntry>>`:

| Field | Meaning |
|---|---|
| `code` | the exchange ticker, equal to the `Currency` code (BTC, USDT ...) |
| `scale` | decimals stored: `min(8, baseAssetPrecision, floor(log10(Number.MAX_SAFE_INTEGER / maxUnits)))` |
| `baseAssetPrecision` | Binance `exchangeInfo` `baseAssetPrecision` on the curation day |
| `reducedScale` | true when `scale < baseAssetPrecision` (derived, not hand-written) |
| `symbol` | display symbol (`₿`, `Ξ`, `₮`) or the code itself |
| `coinGeckoId` | the curated CoinGecko id, verified on `/coins/{id}` at curation |
| `binanceSymbol` | the Binance spot symbol against USDT for the price fallback (`BTCUSDT`); absent for USDT |
| `dustBelow` | a decimal string; a balance under it creates no new holding (section 4) |
| `maxUnits` | the largest plausible balance, in whole coins |

Scale rule. A coin whose formula gives a scale below `MIN_COIN_SCALE = 2` does not enter the
registry: it is not tracked (it shows in the not-tracked line). A reduced-scale coin's balances and
rows round half away from zero to its scale and log a fixed tag (`balance-precision-rounded`,
`row-precision-rounded`); a coin that is not reduced-scale keeps the stop for a row with more
decimals than its scale (`amount-precision`). USDT, USDC, FDUSD and DAI have `maxUnits` 90,000,000,
so their scale is 8 (R-Q5). BTC and ETH already store data at scale 8: their `maxUnits` (21,000,000
and 90,000,000) keep them at 8, and the registry test pins both. Changing the scale of a coin with
stored data needs its own rescale migration, as 0059 does for USDT.

`cryptoCurrencies`, `CryptoCurrency`, `currencyScale`'s crypto entries, `currencySymbol`'s crypto
entries and `cryptoCoinGeckoId` (`src/rates/coingecko-ids/coingecko-ids.ts`) derive from the
registry; no second hand-written crypto list remains. `currencyNames.<CODE>` gains an en and a uk
name per coin (`currency-names.i18n.test.ts`).

Initial list rule (R-Q4), fixed in set 2's commit with its curation date and source:
1. the user's own coins from the inventory probe and probe 2 (BTC, USDT, CGPT; C-CGPT);
2. the top 30 by market cap from CoinGecko `/coins/markets` on the curation day, minus:
   stablecoins other than the four below; wrapped, bridged and liquid-staking tokens (WBTC, WETH,
   stETH, wstETH, weETH, WBETH, BNSOL, cbBTC and the like; R-Out staking); coins with no Binance
   spot market against USDT; codes that collide with a fiat code in `currencyOptions`;
3. USDT, USDC, FDUSD, DAI;
4. BNB is on the list (dust and BNB fees depend on it); if it ever falls out of the top 30, it is
   kept by this rule.

CGPT entry (C-CGPT; probe 2 found it in the user's Funding wallet): `code` `CGPT` (ChainGPT);
`scale` by the formula above (probe 2: the Funding CGPT balance has at most 2 significant decimals
as sent, so it fits any scale `>= MIN_COIN_SCALE`); `symbol` `CGPT` (the code itself);
`coinGeckoId` `chaingpt`, which set 2 verifies against CoinGecko `/coins/list`; `binanceSymbol`,
`baseAssetPrecision`, `maxUnits` and `dustBelow` by the "Adding a coin" rule below, read in set 2.

Adding a coin later: one change with the code in `currencyOptions`, the registry entry
(`baseAssetPrecision` from Binance `exchangeInfo`, `maxUnits`, the verified CoinGecko id,
`binanceSymbol`, `dustBelow` near 1 USD at the curation price), en + uk names (translator review),
and an app release. A registry test pins, per entry: keys equal to the crypto block; unique
CoinGecko ids; `scale` equal to the formula; `scale >= MIN_COIN_SCALE`;
`maxUnits x 10^scale <= Number.MAX_SAFE_INTEGER`; `reducedScale` equal to
`scale < baseAssetPrecision`; a `binanceSymbol` ending in `USDT` on every coin but USDT.

### Stablecoin precision and the USDT rescale (set 1, migration 0059)

USDT, USDC, FDUSD and DAI use scale 8 (R-Q5). USDC, FDUSD and DAI are new codes with no stored
data (set 2 adds them). USDT's existing data rescales by exactly `10^6`. Each field rescales on its
OWN stored currency, never on the holding it sits on:

| Stored value | Its currency | Rescale |
|---|---|---|
| `holdings.balance_minor_units`, `holdings.synced_balance_minor_units` | `holdings.currency` = USDT | `x 1000000` |
| `transactions.amount_minor_units` | the row's holding's currency = USDT (a row has no currency of its own) | `x 1000000` |
| minor-unit fields in `holdings.metadata` (every `*MinorUnits` field of `holding-metadata.ts` and `lots.ts`: contributions, principal, purchase price, face value, lot costs) | the holding's currency = USDT | `x 1000000`, via `json_set` |
| `category_rules.matchers` amount matchers | the matcher's own `currency` = USDT (`category-rules.d.ts`) | `minorUnits x 1000000`, via `json_each`/`json_set` |
| `transaction_templates.draft.amountMinorUnits` and every `draft.returns[].amountMinorUnits` | `draft.currency` = USDT | `x 1000000` |
| `transaction_templates.draft.exchange.valueInMinorUnits` | `draft.exchange.destinationCurrency` = USDT | `x 1000000` |
| statement-import keys: `transactions.external_id` of `source = 'import'` rows and `deleted_import_keys.external_id`, in the `computeDedupKeyBase` shape (holding id, time seconds, amount minor units, normalized description, space-joined, then an optional `␟<n>` suffix) | the currency of the holding named by the key's FIRST space-separated token, never the row's current `holding_id` (a row moved to another holding keeps the key it was imported under); USDT | the third space-separated token `x 1000000`; every other byte kept |
| `price_points` with `currency = 'USDT'` | - | none: `price` is a major-unit decimal string, valued through `multiplyToMinorUnits` at the currency's scale, so its minor-unit value rescales by itself. The parity test pins it |
| `currency_rates`, `currency_rate_history` rows `USDT:UAH` | - | none: a rate is per unit, scale-free |
| `bond_register.terms.faceValueMinorUnits` | `terms.currency` (`nbu-register.ts`) | none: the NBU register lists bonds in UAH, USD and EUR only, so no term is ever in USDT. The migration test asserts the table is untouched |

A template draft with `currency` null carries no amount (`draft-from-form.ts`,
`minorUnitsOrNull`), so keying on the draft's own currency misses nothing; the developer re-greps
that rule.

Statement-import keys: rewritten inside 0059 itself, not in a launch step. Unlike 0041's upgrade
(which needs the JS-only `normalizeTransactionName`), the amount is a fixed-position token between
two tokens with no space (a holding id, a time in seconds), so SQL rewrites it exactly in the same
transaction as the amounts it must stay equal to. The key's first token is matched against
`holdings.id` with `holdings.currency = 'USDT'`; a key whose first token names no USDT holding (a
bank-issued id, a non-USDT holding, a deleted holding) is left alone, whatever holding the row sits
on now. A test pins one transaction key, one `␟`-suffixed key and one `deleted_import_keys` row,
a USDT-keyed row that now sits on a UAH holding (rewritten) and a UAH-keyed row that now sits on a
USDT holding (left alone), and that a re-import of the same statement after 0059 adds no row.

The developer re-greps every `MinorUnits` field in `src/db/schema.ts`, `holding-metadata.ts`,
`template-draft.ts`, `category-rules.d.ts`, `lots.ts` and any JSON shape added since, and every key
that embeds an amount, and the migration test lists each one. Crash-safe: the runner applies the
whole file and its bookkeeping row in one transaction, so a crash leaves 0059 to retry whole.

JSON fields (`holdings.metadata`, `category_rules.matchers`, `transaction_templates.draft`): 0059
rescales a value only where `CASE WHEN json_valid(<column>) THEN json_type(<column>, <path>) END =
'integer'`; a column that is not valid JSON, or a field that is a real, a string, null or absent,
stays exactly as stored. The guard is a CASE, never `json_valid(...)` joined to `json_type(...)` by
a logical and: SQLite does not guarantee that a logical and short-circuits, and `json_type` raises
an error on malformed JSON, which would abort 0059 (U13 pins the malformed case). Every
`json_each` over a column sits behind the same CASE guard. The bound count below uses the same
guard, so it never reads malformed JSON (and never aborts on it). `withUsdtRescaled` applies the
same rule: a field is
rescaled only when its column parsed as JSON and the value is a JSON integer as SQLite's
`json_type` reads app-written JSON: `Number.isInteger(value) && Math.abs(value) < 1e21` (the range in
which `JSON.stringify` writes a number with no fraction and no exponent); anything else is restored
as stored. Then the bound, SQL's two-sided comparison: `value < -USDT_RESCALE_BOUND_MINOR_UNITS ||
value > USDT_RESCALE_BOUND_MINOR_UNITS` (9,007,199,254, "Bound" below) throws
`data-transfer/amount-too-large`. Accepted limit: a number text the
app never writes (`12.0`, `1e5`) is a real to SQLite and an integer here; the app's writers
(`JSON.stringify`) never store one, so the two paths agree on every value the app writes.

Bound: at scale 8 a value fits a JS number exactly up to 90,071,992.54740991 units, so a scale-2
value above 9,007,199,254 minor units cannot rescale. 0059 first counts such values over every
field of the table above; a non-zero count aborts the migration with a clear error before any
write. The mechanism: `CREATE TEMP TABLE usdt_rescale_bound (over_bound integer CONSTRAINT
usdt_rescale_guard CHECK (over_bound = 0))` and one `INSERT ... SELECT count(*)` over the fields,
so SQLite fails with "CHECK constraint failed: usdt_rescale_guard" (the named constraint gives that
text; an unnamed one would report the expression); the temp table is dropped at the end. The test
pins the error text and that nothing was written. What the user sees when it fires: the launch
stops at `MigrationsGate`'s error state (`src/migration/migrations-gate/migrations.gate.tsx`,
testID `migrations-gate-error`), whose text is `migrations.error` ("Migration error: {{message}}")
with the CHECK message; the data stays at scale 2 and 0059 retries on the next launch. A restore of
a version 1-3 file with such a value is refused as a whole, with no row written:
`withUsdtRescaled` throws an error whose message starts with `data-transfer/amount-too-large`.
`IMPORT_ERROR_KEYS` (`import-data.screen.tsx`) maps that prefix to the new key
`settings.dataImport.amountTooLargeError` (section 10), shown under
`settings.dataImport.errorTitle`.

`.kiko` import (set 1): `EXPORT_VERSION` (`src/data-transfer/crypto/envelope.ts`) becomes 4 and
`READABLE_EXPORT_VERSIONS` `[1, 2, 3, 4]`. 0059's `VERSION_DECISIONS` entry
(`envelope.test.ts`) records the bump: version 4, migration count 60. An older build must refuse a
rescaled file, because it would read every USDT value 10^6 too large.
`restoreDataSnapshot(snapshot, version)` takes `version` as a REQUIRED parameter, with no default,
so no caller can skip the rescale by leaving it out. `import-data.ts` passes `envelope.version`
(today used only by `payloadToRestore`). Every test call site (78 today, about 22 test files) and
`e2e/screenshot/fixtures/build-demo-snapshot.ts` pass a version explicitly. A restore of a
version 1-3 file applies the identical rescale before insert (`withUsdtRescaled` in
`restore-snapshot.ts`, the same table of fields, keys included); a version 4 file restores byte-
unchanged (U10). `withUsdtRescaled` runs LAST among the restore mirrors of `restoreDataSnapshot`:
after `withLegacyDedupKeysUpgraded` and `withImportTimesRezoned` (both rewrite import keys from the
row's amount, so the rescale must see their output, as 0059 on a live device sees keys a launch
step already upgraded), and before the chunked inserts. A two-path test proves migration and
restore agree, including a version 3 file with legacy dedup keys.

Display (user ruling Q1, set 1): `formatMoney` (`src/currency/format/format.ts`) shows a crypto
amount (`isCrypto`) at its exact value, with trailing zeros trimmed but never fewer than 2
decimals. It splits the integer, never divides it as a float: the whole part is `(|minorUnits| -
remainder) / 10^scale` with `remainder = |minorUnits| % 10^scale` (both exact for safe integers),
grouped by the locale; the fraction is the remainder's digits padded to the scale, trailing zeros
trimmed down to 2, after the locale's decimal separator. So no digit is ever rounded away. Stored
amounts stay exact; only the text changes. Fiat
display is unchanged (fixed at the currency's scale). This belongs to set 1, so the USDT tip is
safe alone: without it, every USDT amount would show 8 fixed decimals. Display cases (set 1):

| # | Amount | Shown | was: |
|---|---|---|---|
| DP1 | 123.45 USDT (12345000000) | `₮123.45` | `₮123.45` at scale 2 |
| DP2 | 0.00012345 USDT | `₮0.00012345` | `₮0.00` at scale 2 |
| DP3 | 1 USDT | `₮1.00` | `₮1.00` |
| DP4 | 0.05 BTC | `₿0.05` | `₿0.05000000` |
| DP5 | 1234.50 UAH | unchanged (fiat keeps its fixed scale) | same |

Pins that change with DP4 (each gets its "was:" value in the test): `format.test.ts`
(`toContain('1.00000000')` -> `1.00`; `'₿0.50000000'` -> `'₿0.50'`) and
`category-form.screen.test.tsx` "shows an amount in the currency of its own scale"
(`'₿0.00100000'` -> `'₿0.001'`). `currency.test.ts`'s `applySymbolPlacement('BTC', '',
'0.05000000')` and `rule-summary.test.ts`'s mocked `'0.00100000 BTC'` do not go through
`formatMoney` and stay as they are. The developer re-greps for other fixed-8 strings. The form
field text (`majorAmountText`, `amount-format.ts`) already trims and does not change. The user
confirms the look live on the device before set 1 is done.

### Safe-integer bound and the visible error

Every exchange amount goes through `exchangeMinorUnits` (section 2). A balance or row above the
bound is never truncated: the balance write for that holding is skipped (the last good balance
stays), the row is a per-record stop owed at its point, the ticker joins
`exchange_state.oversizedCoins` (its balance list for a balance, its history list for a row;
C-NR8), and the account detail shows `accountDetail.oversizedAmount` (section 10) for the sorted
union of the two lists. A balance with more decimals than the coin's scale (probe P10) rounds half away from
zero and logs `balance-precision-rounded`. A ROW with more decimals is a per-record stop
(`amount-precision`), except on a reduced-scale coin, where it rounds the same way and logs
`row-precision-rounded`.

### Prices

- CoinGecko by curated id (R-Q4, R-Tech): `fetchCryptoPrices` (`src/rates/coingecko/coingecko.ts`)
  asks for the held coins' ids in one call and returns a per-coin result. A coin missing from the
  answer is unpriced; every other coin keeps its price (closes the "Crypto price all-or-nothing"
  debt). `buildUahRows` writes one `X:UAH` row per priced coin.
- Fallback for a coin CoinGecko did not price (set 5): Binance public market data on the pinned
  host, no key sent. It runs for every user holding that coin, with or without a Binance account.
  Current: `GET /api/v3/ticker/price?symbol=<binanceSymbol>` (weight 2). Dated history:
  `GET /api/v3/klines?symbol=<binanceSymbol>&interval=1d` (weight 2, up to 1000 days per call). The
  USDT-quoted price converts through USDT's own price; when USDT itself is unpriced, USDT's price
  comes from `EURUSDT` (probe P14) and the EUR fiat anchor. Never 1:1 for any stablecoin. Calls
  count against the `/api/*` IP budget (section 5). The privacy policy says so (section 9).
- History backfill per new coin (set 2): one call per coin, only for the coins that a holding uses
  (`src/rates/history-backfill/history-backfill.ts`, `fetchCryptoHistory` in
  `src/rates/coingecko-history/coingecko-history.ts`). Never every curated coin: the callers
  already pass the held coins on the base (`historyCurrencies` in `open-currencies-gate.ts`,
  `rates-refresh.ts`), so the `currencies = cryptoCurrencyOptions` defaults of
  `fetchCryptoPrices` and `fetchCryptoHistory` stay, and a test pins that a curated coin no
  holding uses is never requested. `fetchCryptoHistory` keeps at most
  `CRYPTO_HISTORY_CONCURRENCY` coin requests in flight (C-NR9 b; start at 2, the value measured in
  set 2), and still fetches every coin.
- A coin with no price from either source stays visible at its coin amount and is left out of net
  worth with the existing "no rate" treatment (`net-worth-view.ts`).

### Not-tracked coins, LD* tokens, picker, 0044

- A non-zero balance of a coin outside the registry gets no holding, no row and no price. Its
  ticker is stored in the balance list of `exchange_state.untrackedCoins`, which each good balance
  read replaces. A good balance read is one in which every wallet read succeeded; a read in which
  a Funding or Earn wallet failed (that wallet keeps its last good balance) leaves both balance
  lists, not tracked and oversized, as stored. Every history read (capital, Pay, Transfer, Earn
  and the later streams) imports no row for a record of such a coin (a pair with one untracked
  side keeps the tracked leg, section 6) and adds its ticker to the history list, which only grows
  and is cleared on disconnect (C-NR8). "Joins the not-tracked line" in sections 5 and 6 means
  this history-list add. The account detail lists the sorted union of the two lists, without
  duplicates and without a ticker that is a curated code now (the coin list grew since it was
  stored) (`accountDetail.untrackedCoins`, reason "not on Kiko's coin list").
- LD* (R-Tech, probe P9): an asset whose code is `LD` + X, where X is a curated code or an asset in
  this run's Simple Earn positions, is an Earn receipt token. It is skipped in Spot (Earn is read
  from the Earn endpoints) and never priced. `LDO` and other real coins starting with LD pass,
  because the rest of their code is neither.
- Picker (R-Picker, set 2): `CurrencyField` and `holdingCurrencyOptions` list every curated coin for
  a `crypto_asset`; the base-currency setting keeps offering fiat only.
- Migration 0044 stays frozen (set 2). `withCryptoCashHoldingsMoved` (`restore-snapshot.ts`) switches
  from `!isFiat` to a constant `FROZEN_1_0_CRYPTO_CODES = ['BTC', 'ETH', 'USDT']`; the test that
  failed on purpose (`0044-move-crypto-cash-holdings.test.ts`) asserts the constant equals the
  SQL's `IN` list.

## 4. Holdings

- One holding per (coin, wallet) and per (fiat, wallet) (R-Q6, R-Q15). Match key under
  `metadata.binanceAsset`: `<CODE>` for Spot, `<CODE>:funding`, `<CODE>:earn`. BTC keys stay
  `BTC`, `BTC:funding`, `BTC:earn` (`SPOT_KEY`, `FUNDING_KEY`, `EARN_KEY`). A fiat holding is a
  `crypto_asset` holding in a fiat currency (a write accepts fiat for that type,
  `isCurrencyAllowedForHoldingType`); only fiat codes in `currencyOptions` qualify, another fiat is
  a not-tracked ticker.
- `ProviderBalance` gains `currency: Currency`; `runBalanceSyncInner` writes it instead of `'BTC'`.
  `fetchBalances` reads all assets from the four existing calls (no new call; `asset=` dropped from
  the funding and Earn reads).
- Appear: a holding is created on the coin's first balance at or above `dustBelow` (fiat: any
  non-zero balance) or on its first imported row (`placeWalletRows` creates the target at zero).
- Stay: an existing holding is written every good read, a zero included; it is never archived by
  the sync. A dust balance below `dustBelow` with no holding and no row creates none.
- Spot anchor: a Spot read failure fails the balance sync as today; no zero Spot holding is created
  for a coin never held (the forced zero Spot BTC write applies only when the Spot BTC holding
  exists).
- Wallet failures keep today's rule per wallet (`walletSatoshis` -> `null` leaves every holding of
  that wallet at its last good balance).
- Names: `Binance <Wallet> · <CODE>` ("Binance Spot · USDT", "Binance Funding · EUR",
  "Binance Earn · BTC"); proper nouns, the same in en and uk, written on insert only.
- BTC rename: `ProviderBalance.renameFromDefault` becomes `renameFromDefaults: readonly string[]`.
  Spot BTC renames from `'Binance BTC'` or `'Binance Spot'` to `'Binance Spot · BTC'`; Funding BTC
  from `'Binance Funding'`; Earn BTC from `'Binance Earn'`. A user-edited name never matches.

## 5. Binance history streams

Every stream reads account-wide (no coin filter), runs after the balance read, in its own
`logOnFailure`, on its own lane and its own `WalkMarks` (R-Tech). Order in
`runBinanceSyncAndImport`: balance, capital, Pay, Transfer, Earn, Convert, dust, dividends, P2P,
fiat orders, fiat payments, trades. Weight headers: SAPI per endpoint (`X-SAPI-USED-IP-WEIGHT-1M`,
`X-SAPI-USED-UID-WEIGHT-1M`); `/api/*` shares one IP limit of 6000 a minute
(`X-MBX-USED-WEIGHT-1M`), budgeted at `API_IP_BUDGET_1M = 3000`. "Probe" marks a fact probe 2 must
confirm; section 12 gives each fallback.

| Stream | Endpoint | Window / lookback | Paging | Weight | Lane cap | Cursor | Probe |
|---|---|---|---|---|---|---|---|
| Capital deposit | `GET /sapi/v1/capital/deposit/hisrec` | 89 d / 2017 floor | offset, 1000 | IP 1 | unbounded (IP reading) | `walks.capital` | P16 walletType of non-BTC |
| Capital withdraw | `GET /sapi/v1/capital/withdraw/history` | 89 d / 2017 floor | offset, 1000 | UID 18000 | 9 | `walks.capital` | - |
| Pay | `GET /sapi/v1/pay/transactions` | 89 d / 18 mo + 10 d | none (halving), 100 | UID 3000 | 20 | `walks.pay` | P12 |
| Transfer | `GET /sapi/v1/asset/transfer` x 20 types | 30 d / 179 d | `current`, 100 | IP 1 | 80 + 397 narrowing | `walks.transfer` | - |
| Simple Earn | 6 history endpoints | 30 d / 2022-01-01 | `current`, 100 | IP 150 | 30 | `walks.earn` | P11 |
| Convert | `GET /sapi/v1/convert/tradeFlow` | 30 d / probe (2 years read on 2026-10-15) | `limit` 1000 + `moreData`: a window with `moreData` halves | UID 3000 | 20 | `walks.convert` | P4 |
| Dust | `GET /sapi/v1/asset/dribblet` | last 100 records, after 2020-12-01 | none | IP 1 | 1 | none (every run; keys dedupe) | P7 |
| Dividends | `GET /sapi/v1/asset/assetDividend` | 180 d / probe (3 years read) | `limit` 500, none: a full page halves | IP 10 | 10 | `walks.dividend` | P8 |
| P2P | `GET /sapi/v1/c2c/orderMatch/listUserOrderHistory`, `tradeType` BUY and SELL (2 series) | 30 d / back until Binance stops serving: 6 empty or refused windows in a row, a window empty when neither series returns a row (probe 3 measures the depth; probe 2 served rows 8-9 months back) | `page`/`rows` 100 | IP 1 | 10 | `walks.p2p` | P5 |
| Fiat orders | `GET /sapi/v1/fiat/orders`, `transactionType` 0 deposit, 1 withdraw (2 series) | probe / probe | `page`/`rows` 500 | UID 45000 | 3 | `walks.fiatOrders` | P6 |
| Fiat payments | `GET /sapi/v1/fiat/payments`, `transactionType` 0 buy, 1 sell (2 series) | probe / probe | `page`/`rows` 100 | IP 1 | 10 | `walks.fiatPayments` | P6 |
| Spot trades | `GET /api/v3/myTrades?symbol=&fromId=` per symbol | none (id cursor) / probe | `fromId`, 1000 | IP 20 (`/api/*`) | 100 calls | `trades.symbols[s].fromId` | P1, P2, P3 |
| Order fills | `GET /api/v3/myTrades?symbol=&orderId=&fromId=` (an order re-read, below) | - | `fromId`, 1000, until a short page; `floor(f / 1000) + 1` calls, `f` the order's own fills | IP 5 per page (`/api/*`; P15 confirms) | shares the trades lane | `trades.symbols[s].heldOrderId` | P15; P15b (probe 3, hard gate) |
| Symbol list | `GET /api/v3/exchangeInfo` (public) | - | - | IP 20 (`/api/*`) | 1 per run | - | P2 |

The lane caps are starting values. Set 11 measures a caught-up run and a backfill run on the
user's account (calls, wall time at the 350 ms gate, weight peaks) and records them; a cap changes
only with a measured reason (memory "bounds are measured").

### Capital (deposits, withdrawals)

`coin=` is dropped. Placement by `walletType` (0 Spot, 1 Funding, else stop
`capital-wallet-unknown`), settled statuses (deposit 1, withdraw 6), keys
`${accountId}:deposit:<id>` / `${accountId}:withdraw:<id>` unchanged. Description = the coin code
(as BTC today). Withdrawals stay spending (R-Q12).

### Pay (R-Q7)

- An order in any curated coin imports. Direction and placement rules stay (history spec section
  4: uid direction, R22 receive placement by date, `walletTypes`/`walletAssetCost` split).
- Funds: one row per `fundsDetail` entry with a curated `currency`, per wallet in its
  `walletAssetCost`, amount = that wallet's cost in that coin, on that coin's wallet holding. The
  costs of each coin must sum to that entry's `amount`, else `pay-split-mismatch` as today.
- Cross-coin: an order in X paid with Y gets Y rows (no X row, no implied conversion). `comment` =
  `<amount> <X>` (Binance's own decimal string and code; no words), written on insert only.
- A funds entry in an untracked coin imports no row; its ticker joins the history list of
  `untrackedCoins` (C-NR8), so the not-tracked line keeps it after the next balance read.
- A receive imports one row in the order's coin (funds describe the payer side).
- Keys: a BTC-funded row of a BTC order keeps
  `${accountId}:pay:${orderType}:${transactionId}:${walletType}` byte-identical; every other row
  is `...:${walletType}:${currency}`.
- Stops `pay-btc-funded-other-coin` and `pay-funds-not-btc` are removed.

### Transfer, Simple Earn

Transfer: the filter `record.asset !== BINANCE_ASSET` goes; keys already carry the wallet key with
the asset. Earn: `asset=` dropped; subscription/redemption keys carry the wallet key.

Earn rewards (`binance.earn-history.ts`, the reward grouping and `rewardGroupRowsOf`): a reward
group's key becomes (product, `ownerId`, `type`, `time`, `asset`), so records of two coins at the
same time never share a group. Within a group, amounts convert per coin through
`exchangeMinorUnits(asset, ...)` (not `positiveSatoshis`) and are numbered from 0 by amount,
ascending, as today. Key: a BTC group keeps
`${accountId}:earn:reward:${product}:${ownerId}:${type}:${time}:${position}` byte-identical; any
other coin appends `:${asset}`. A pinned case mixes BTC and USDT rewards at one (`ownerId`, `type`,
`time`) and asserts the BTC keys equal the keys today's BTC-only read gives. Probe P11 confirms
whether `productId` is per asset; the rule holds either way.

### Convert

Settled: `orderStatus === 'SUCCESS'`; `PROCESS`/`ACCEPT_SUCCESS` owe their point; `FAIL` ignored.
One Exchange pair per `orderId`: `fromAsset -fromAmount`, `toAsset +toAmount`, both on the
Convert wallet (C-NR3: the wallet probe 2 observes; default Spot). Pair id
`${accountId}:convert:${orderId}`; leg keys `${pairId}:<walletKey>`. No fee field (the fee is in
the rate). A fiat side (UAH, EUR) is a fiat holding leg.

### Dust

One read, no params, every run (cap 1, no cursor). Every `userAssetDribbletDetails` entry maps to
rows; `addManyDedup` keys drop the ones already imported. Per entry: an Exchange pair
`fromAsset -amount` (Spot) / BNB `+received` (Spot), where `received` = the BNB that entry added
to the wallet (`transferedAmount`, net of `serviceChargeAmount` per probe P7). Pair id
`${accountId}:dust:${transId}:${fromAsset}`. An untracked `fromAsset`: the BNB leg alone with
`untrackedCounterpart = asset:<fromAsset>`. Records beyond the last 100 are lost; the not-listed
note names them.

### Dividends

Ships only if probe 2 yields at least one allowlist value. If probe P8 finds no `enInfo` value to
allow, the dividend walk is removed from 1.3-a: no reader, no `'dividend'` walk id, no V1/V2 cases,
no lane (no dormant reader, section 1 release rule); the not-listed note names distributions.

When it ships: rows import only for an allowlisted `enInfo` value (values that overlap the Earn
walk's rewards are never on it). `amount` on the credited wallet (probe P8; C-NR3 default Spot),
`operation = 'reward'`, key `${accountId}:dividend:${id}`. A row off the allowlist is skipped and
counted under the fixed tag `dividend-type-skipped`, never owed. `enInfo` is never stored or parsed
for money.

### P2P

Depth (C-P2P-depth): the walk walks back in 30-day windows until Binance stops serving; the depth
is measured by probe 3 (probe 2 served rows 8-9 months back). Stop rule, the one probe 3 uses: a
window is empty when neither series (BUY, SELL) returns a row or Binance refuses it as out of
range; 6 empty windows in a row end the walk, and the oldest window that served a row is its
floor. A refused window counts toward the 6, never as a failure. The walk stays inside its lane
(10 calls a run) and the SAPI IP budget: a run that ends mid-walk stores its cursor and the count
of empty windows in a row (`walks.p2p.emptyWindows`), and the next run goes on from there.

Only `orderStatus === 'COMPLETED'` imports; `CANCELLED` and similar are ignored; an open status
owes its point until final or the walk's floor drops it. BUY: `+amount asset` on the P2P wallet's
holding (C-NR3: observed wallet; default Funding); SELL: `-amount`. Amount = the wallet's change
(probe P5 confirms whether `amount` is net of `commission`; until confirmed, an order with a
non-zero `commission` is a stop owed at its point). `untrackedCounterpart =
p2p:<fiat>:<totalPrice>` (C-NR1: `totalPrice` as an exact decimal at the fiat's scale, for example
`p2p:UAH:4150.00`); `comment` = `<totalPrice> <fiat>`, display only; `operation = 'p2p'`. No
counterparty field is read into a type (privacy, section 9). Key
`${accountId}:p2p:${orderNumber}:<walletKey>`.

### Fiat orders (deposit, withdraw) and fiat payments (card buy, sell)

- Fiat orders: settled status per probe P6 (default `Successful`); deposit `+amount` on the
  fiat holding of the credited wallet (C-NR3: observed; default Spot), withdraw `-(amount + fee)` as
  the wallet moved (probe P6). `untrackedCounterpart = bank:<fiat>:<indicatedAmount>` (C-NR1; the
  gross the bank side paid), `operation = 'fiat'`, `comment` = `<indicatedAmount> <fiat>`. Key
  `${accountId}:fiat:${orderNo}:<walletKey>`.
- Fiat payments: settled `Completed`. Buy: `+obtainAmount cryptoCurrency` with
  `untrackedCounterpart = card:<fiatCurrency>:<sourceAmount>` (C-NR1), `comment` =
  `<sourceAmount> <fiatCurrency>`. Sell: `-sourceAmount cryptoCurrency`,
  `untrackedCounterpart = card:<fiatCurrency>:<obtainAmount>`, `comment` =
  `<obtainAmount> <fiatCurrency>`. `operation = 'card'`. Wallet per C-NR3 (default Spot). Key
  `${accountId}:fiatpay:${orderNo}:<walletKey>`.
- Marker total (C-NR1): Binance's decimal string is normalized to exactly the fiat's scale by the
  exact decimal parser: trailing zeros past the scale drop, missing ones pad
  (`"4150"` -> `4150.00`); a non-zero digit past the scale is a per-record stop `amount-precision`
  owed at its point. Never `Number()`.

### Spot trades (R-Q11, R-Q13, C-NR2)

- Symbol discovery (set 10): once per run, public `exchangeInfo`; candidates = every `TRADING` or
  `BREAK` symbol whose base and quote are both in (coins the user touched) union (main quotes:
  USDT, USDC, FDUSD, BTC, ETH, BNB, EUR, TRY). Touched = any asset with a non-zero balance (tracked
  or not) or seen in any imported history record, or a symbol with a stored `fromId`. A coin fully
  sold before 1.3 and seen nowhere else is not found: the not-listed note names it.
- Rotation: a symbol is read this run when its base or quote balance changed since
  `trades.balanceSnapshot`, when it was never read (no entry or a null `fromId`), when it holds a
  `heldOrderId`, or when its turn comes in the round-robin from `trades.rotation`. Fixed read order:
  held symbols first, in ascending symbol order; then never-read symbols; then changed symbols; then
  the round-robin. At least 1 call of the lane per run is reserved for the round-robin, so the held,
  changed and null-cursor symbols never take every call of the lane. Each of `S` candidate symbols
  is read within `ceil(S / L)` runs, `L >= 1` the calls reserved or left for rotation (memory
  "round-robin rotates units read"; property test).
- Paging (`idCursorPager`): `fromId` = the stored cursor, else 0; no time parameters (probe P1).
  After a completed read the symbol stores `fromId` = last trade id read + 1, or 0 when the read
  returned no trade, so a read symbol never stores null: null (or no entry) means only "never read",
  and the caption rule (section 2) follows from that.
- Orders and later fills (never drop a fill of an open order): fills group by `orderId`. Every fill
  is read once by the id cursor. An order was "imported earlier" when ANY stored row of `source =
  'binance'` has an `external_id` that starts with `${pairId}:` (a leg key or a fee key), whether or
  not the row has an `exchangePairId`: a one-sided trade (the other coin untracked, the `asset:`
  arm) and a third-coin fee row count the same as a pair leg. The lookup is a prefix range on the
  `transactions_source_external` unique index (`source = 'binance' AND external_id >= '${pairId}:'
  AND external_id < '${pairId};'`, `;` being the byte after `:`), never `exchange_pair_id`. When a
  batch holds a fill of such an order, the walk reads that order's fills whole with
  `myTrades?symbol=&orderId=&fromId=`, paging by `fromId` (last id + 1) until a short page, before
  it writes the order, and writes every row of the order from the whole set (`addManyDedup` updates
  the leg and fee amounts, a bank-owned column, under the same keys). An order whose fills span a
  page boundary inside one run pages on before it is written. P15b (probe 3) is a hard gate before
  set 11 that `orderId` + `fromId` page an order's fills by id (C-NR7).
- An order is re-read at most once per run. After its re-read, a fill of the order in a later
  id-cursor page of the same run whose id is at or below the re-read's last fill id is skipped (it
  is in the re-read's set; not added, and not a trigger for a second re-read). A fill of the order
  with a HIGHER id (the open order filled again after its re-read) ends this symbol's read for this
  run at that fill: the fills before it are written, `fromId` is stored as that fill's id, and the
  next read of the symbol starts with it, so the order is re-read then. No `heldOrderId` is set
  for it: the order's rows are written, so the normal "imported earlier" trigger fires on that fill
  whenever the symbol is next read (within the rotation bound); `heldOrderId` exists only for an
  order whose rows are not written.
- Re-read bound: `floor(f / 1000) + 1` calls, `f` = the order's own fills (a `fromId` page returns
  up to 1000 of the account's own fills and the paging ends at the first short page), every call in
  the trades lane. Fit is decided by reading (the lane ends before the short page), never computed
  ahead from ids.
- A re-read that does not fit the lane stops the symbol at that order's first fill in the batch (the
  stop fill): the fills before it are written, nothing at or after it is written, `fromId` is stored
  as the stop fill's id, and the symbol stores `heldOrderId` = that order's id. The next run reads
  that symbol first (held symbols in ascending symbol order): the held order's re-read (`orderId` +
  `fromId`, complete by itself), then the id cursor from the stop fill, where the held order's fills
  follow the once-per-run rule (skipped up to the re-read's last fill id; a higher id ends the
  read). A held symbol gets at most the lane cap - 1 calls (one call stays for the round-robin,
  "Rotation" above). `heldOrderId` is cleared in the cursor patch written after the order's rows. No
  owed point is stored (the trades walk keys progress by id, not time).
- Rows per order, Spot wallet: spent leg = sum of `quoteQty` (buy) or `qty` (sell), negative;
  received leg = sum of `qty` (buy) or `quoteQty` (sell) minus every commission in the received
  coin. Commission in the SPENT coin (C-NR2, confirmed by the user): added to the spent leg, so the spent leg =
  `-(gross + commission)`; no extra row. Commission in a third coin (BNB): one row
  `-sum(commission)` on that coin's Spot holding, `exchangePairId` = the order's pair id,
  `exchangeCounterpartHoldingId` = the received leg's holding, `operation = 'trade-fee'` (R-Q13).
  A third coin that is untracked: no fee row, its ticker joins the not-tracked line. A tracked
  third coin whose order's RECEIVED coin is untracked (buy PEPE with USDT, fee in BNB; C-NR5):
  the fee row has no received-leg holding, so it carries `untrackedCounterpart = asset:<received
  coin>` instead of `exchangeCounterpartHoldingId`, and stays out of spending.
- One side untracked (USDT -> PEPE): the tracked leg alone, `untrackedCounterpart = asset:<CODE>`,
  no `exchangePairId`; its key is still `${pairId}:<walletKey>`, so a later fill finds it by the key
  prefix and re-reads the order. Its third-coin fee row (C-NR5) still carries
  `exchangePairId = pairId`, so the order has a pair id on the fee row alone. The fee row stays on
  any leg or holding delete: a synced row is never deleted (`isDeletableTransaction` in
  `src/holdings/deletable/deletable.ts` allows `manual` and `import` only; `transactionsRepo.remove`
  refuses a synced row, and a cascade keeps every bank-owned row), so a pair id on the leg would
  remove nothing more.
- Pair id `${accountId}:trade:${symbol}:${orderId}`; legs `${pairId}:<walletKey>`; fee
  `${pairId}:fee:<walletKey>`. Time = the order's first fill time. `operation = 'trade'` on every
  leg.

## 6. Row mapping and statistics

### The `operation` column (set 7, migration 0061)

`ALTER TABLE transactions ADD operation text` (nullable, no index, no backfill; R-Map). Codes:
`trade`, `trade-fee`, `convert`, `dust`, `p2p`, `card`, `fiat`, `reward`. Insert-only (not in
`BANK_OWNED_TRANSACTION_COLUMNS`), exported by the snapshot (every column), restored as null from
an older file. It labels; it never decides statistics.

### Untracked-counterpart codes (no migration)

`src/transactions/untracked-counterpart/untracked-counterpart.ts` gains the forms `asset:<CODE>`,
`p2p:<FIAT>:<TOTAL>`, `card:<FIAT>:<TOTAL>`, `bank:<FIAT>:<TOTAL>` beside `wallet:<TYPE>` (C-NR1;
`<TOTAL>` a major-unit decimal at the fiat's scale), each with a parser that returns the fiat code
and the total in minor units through the exact decimal parser. A code with a malformed total parses
to the fiat code with no total (the label still renders; the matcher skips it). An unknown code
still renders the default label. `exchangeExcludedTransactionIds` already excludes any row with a
code.

### Labels (render time, `transactionRowDescription`)

Order: (1) a stored description; (2) `operation = 'trade-fee'` -> "Trading fee"; (3) a counterpart
marker -> "Exchange/Transfer to/from <holding>" (today); (4) a code: `wallet:` -> "Transfer
to/from <wallet>" (today); `asset:` -> "Exchange to/from <CODE>"; `p2p:` -> "P2P purchase/sale
(<FIAT>)"; `card:` -> "Card purchase / Sale to card (<FIAT>)"; `bank:` -> "Bank deposit /
withdrawal (<FIAT>)"; direction from the sign; (5) `operation = 'reward'` -> "Reward"; (6)
`defaultTransactionDescription`.

### Mapping and statistics per operation

| Operation | Rows | Markers | Statistics |
|---|---|---|---|
| Deposit | `+` on walletType wallet | none | none (income ignored) |
| Withdrawal | `-` on walletType wallet | none | spending, default category (R-Q12) |
| Pay send / merchant | `-` per debited coin and wallet | none; description = nickname; cross-coin `comment` | spending in that coin |
| Pay receive | `+` | none | none |
| Transfer own wallets | pair | counterpart + pair id | excluded |
| Transfer untracked wallet | one leg | `wallet:` | excluded |
| Earn subscribe/redeem | pair | counterpart + pair id | excluded |
| Earn reward | `+` | description 'Binance Earn' | none |
| Convert | pair per order | counterpart + pair id; `convert` | excluded |
| Spot trade | pair per order, received net of fee, spent plus a spent-coin fee | counterpart + pair id; `trade` | excluded |
| Trade fee in third coin | `-` on fee coin | counterpart (received leg's holding) + pair id; `trade-fee` | excluded |
| Trade, one side untracked | tracked leg | `asset:`; `trade` | excluded |
| Dust | pair per source coin | counterpart + pair id; `dust` | excluded |
| Dust, source untracked | BNB leg | `asset:`; `dust` | excluded (positive anyway) |
| Dividend / airdrop (if shipped) | `+` | `reward` | none |
| P2P buy | `+` crypto | `p2p:<FIAT>:<TOTAL>`; `p2p`; `comment` displays the total | none; the bank debit per the matcher |
| P2P sell | `-` crypto | `p2p:<FIAT>:<TOTAL>`; `p2p` | excluded |
| Card buy | `+` crypto | `card:<FIAT>:<TOTAL>`; `card` | none; the card charge per the matcher |
| Card sell | `-` crypto | `card:<FIAT>:<TOTAL>`; `card` | excluded |
| Fiat deposit | `+` fiat holding | `bank:<FIAT>:<TOTAL>`; `fiat` | none; the bank debit per the matcher |
| Fiat withdraw | `-` fiat holding | `bank:<FIAT>:<TOTAL>`; `fiat` | excluded |

### The 2-minute same-amount matcher (set 6)

`internalTransferTransactionIds` (`src/statistics/internal-transfers/internal-transfers.ts`,
`TRANSFER_MATCH_WINDOW_MS`), called in `statistics.screen.tsx` over `ledgerWithCurrency`, is fed
only rows with `exchangePairId`, `exchangeCounterpartHoldingId` and `untrackedCounterpart` all
null. `exchangeExcludedTransactionIds` (`src/statistics/exchange-exclusion/`) excludes a row with
an `exchangeCounterpartHoldingId` or an `untrackedCounterpart`; it does not look at
`exchangePairId`. Every pair leg and fee row this spec writes carries one of those two markers
beside its `exchangePairId` (a third-coin fee row of an order with an untracked received coin
carries `untrackedCounterpart`, C-NR5), so it is excluded there;
either way, a row with any of the three markers must never consume an
unmarked row as its partner. Set 6 ships it, because set 6 is the first set that imports
non-BTC pairs and Pay sends of the same coin; the case S1 pins it. A BTC case (a Transfer pair leg
and a BTC Pay send of equal amount within 2 minutes) is pinned too: it is a fix of today's
behaviour, recorded as a reversal (section 1).

### Read-time bank-debit matcher (R-Q14, set 13)

A pure function `exchangeFundingMatches(ledger)` in `src/statistics/exchange-funding-match/`
returns the matched pairs (bank row id -> exchange row id and kind). `statistics.screen.tsx` unions
the bank row ids with the other exclusion sets; nothing is written.

- Input: the unfiltered ledger (`ledgerWithCurrency`, not the account-filtered rows), so an account
  filter that hides the crypto account does not bring the debit back.
- Exchange side: rows with a `p2p:`, `card:` or `bank:` code with a parsed total and a positive
  amount (C-NR1: the total and its fiat come from the code only).
- Bank side: ALL negative rows on holdings of non-crypto accounts, in that fiat currency,
  including rows another rule already excludes (MCC 6012, a description rule, a matched pair) and
  rows the user categorized by hand (`categorySetByHand` true). They all take part in the
  one-to-one match, so an exchange row consumes the debit that funded it even when that debit is
  already excluded or hand-set, and never moves on to a second, unrelated debit (M12, M13).
- Match: the bank amount equals minus the total, exactly in minor units, and the bank row's time is
  inside the window: P2P `[t - 1 h, t + 2 h]`, card `[t - 1 day, t + 3 days]`, fiat deposit
  `[t - 5 days, t + 1 h]`, `t` = the exchange row's time (named constants).
- One-to-one: candidate pairs sort by (1) transfer-like bank row first (MCC 4829 or 6012, or a
  description containing `BINANCE`, compared case-insensitively), (2) absolute time gap, (3) bank
  row id, (4) exchange row id; each row matches once. An unmatched debit counts as spending.
- Exclusion set: only the matched bank row ids whose `categorySetByHand` is false. A matched
  hand-categorized row stays exactly as the user set it (its category decides, as today) and shows
  no caption (M9, M13); a matched row another rule already excludes stays excluded.
- Shown on the bank row: the transaction form of a matched bank row in the exclusion set (not
  hand-categorized) shows a caption under its
  category, `transactions.matchedP2pPurchase` / `matchedCardPurchase` / `matchedExchangeDeposit`
  ("Matched to P2P purchase", section 10), from a hook in the same folder that runs the pure
  function over the same ledger query. The developer re-greps the transaction form's caption slot.

### "Earlier history" line and not-listed note (R-Q16, set 15)

Holding detail of an exchange-synced holding: under the list, `holdingDetail.earlierHistory` with
`balance - sum(rows of the holding)` in the holding's currency, shown when that is not zero; then
the exchange's not-listed note (`holdingDetail.exchangeNotListed.binance`). No row, no statistics
effect.

## 7. Migration of BTC state, backfill, scenario matrices

### BTC rows, keys, cursors (no data loss)

- Rows: untouched. Every BTC key keeps its exact form (sections 5 and 6 list the rule per stream).
- Holdings: matched by the same `binanceAsset` keys; names change only from a default (section 4).
- Walk state (set 4, migration 0060): `ALTER TABLE sync_state ADD exchange_state text`, then one
  `INSERT INTO sync_state (account_id, exchange_state) ... ON CONFLICT(account_id) DO UPDATE SET
  exchange_state = excluded.exchange_state` per account whose FIRST Spot BTC holding carries a
  walk key: the holdings with `CASE WHEN json_valid(metadata) THEN json_extract(metadata,
  '$.binanceAsset') END = 'BTC'` are ranked per account by `(sort_order, created_at)`, the order
  the walk reads them in, and only the first is read, even when it has no walk key and a later
  one has (the walk reads the first one too; ties stay in the order the engine returns them, as
  the walk's own query does, with no id added on either side). Every `json_extract` over
  `metadata` sits behind the same CASE guard,
  because SQLite does not guarantee that a logical and short-circuits, and `json_extract` raises an
  error on malformed JSON (Z4 pins the malformed case). The insert creates the `sync_state` row
  when none exists (its other columns null, so nothing
  reads the account as synced). Each walk entry is a `json_group_object` over the `binance*` walk
  keys PRESENT on that holding (cursor, rescan, pending, point cursor, range cursor, span hints per
  walk; field map pinned by the migration test), so an absent key adds no field; each value is
  copied as stored through `json(metadata -> path)`, so a string stays a string, `true` stays
  `true`, and a `pending` list or the `spanHints` object stays JSON, a malformed one included, so
  the field-by-field parse (section 2) decides about it, never the migration. The entries are
  joined with `json_group_object(walk, json(entry))` (without `json(...)` an entry is stored as
  quoted text); a walk with no present key has no entry. Never `json_extract` into `json_object`
  (an absent key writes `null`, a string loses its quotes, `true` becomes `1`). Disconnected
  accounts copy too (their floor values stay). The old metadata keys are no longer read;
  `carriedMetadataKeys` stops carrying them, so the next balance sync drops them.
- Restore mirror (set 4): `withWalkStateMoved` in `restore-snapshot.ts` applies the same copy to a
  `.kiko` whose `syncState` rows have no `exchangeState` (the same first Spot BTC holding, the same
  present fields), and adds a `syncState` row when the file has none for that account; a two-path
  test pins equality with 0060. No index, so no EXPLAIN QUERY
  PLAN test.
- Export version (set 4): 0060 adds a no-bump `VERSION_DECISIONS` entry (`envelope.test.ts`;
  version 4, migration count 61). The column rides inside the `sync_state` row, and
  `withWalkStateMoved` derives it for a file without it. An older build drops the key, and its walks
  read from their floors, where keys dedupe. 0061 (set 7) records its own decision: no bump,
  because a nullable column on the transaction row restores as null, as 0058 does (count 62).
  Set 4 regenerates both demo `.kiko` files in the same commit.
- Disconnect: `disconnectCryptoAccount` resets `exchange_state` (cursors to the floor, lists empty,
  point/range cursors, hints, trade cursors and coin lists removed, a malformed value replaced),
  then clears the Keychain item. Removing the coin lists clears both history lists (C-NR8). Holdings and rows stay as a manual snapshot.

### Backfill of new coins (R-Q8, sets 6 and 15)

- Set 6: on a walk's first multi-coin run, the walk writes `walks.<walk>.multiCoinSeen = true`,
  whatever its cursor, and `walks.<walk>.multiCoinSince` = its plan cursor at that run (the cursor
  the run plans from: capital's is the stored cursor, else the latest stored capital row time), in
  the same `patchExchangeState` patch as the cursor write of the run's first committed window,
  never before a window commits. A run that commits no window writes neither, so the next run is
  again the first multi-coin run. So `multiCoinSeen` is never stored without a stored cursor, which
  a disconnect resets to the floor: a capital walk with only a legacy latest row time that is
  disconnected before its first window commit still records `multiCoinSince` on its next run. A
  walk whose plan cursor is null at that run (never synced, or a fresh connect) sets no
  `multiCoinSince`: it reads every coin from its floor anyway. A walk with `multiCoinSeen` never
  writes either field again, so a later run after a null-cursor first run records none.
  Disconnect removes `multiCoinSince` and keeps `multiCoinSeen`: the reset cursor is the floor,
  so every coin is read from it and nothing is owed.
- Set 15: each of capital, Pay, Transfer, Earn with a `multiCoinSince` owes one range
  `[floor, multiCoinSince)` with `scope: 'backfill'`, read in the existing round-robin of owed
  ranges. A read in a backfill range imports every coin except BTC; BTC records there are skipped
  (not re-read into rows). A record the live pass and the backfill pass both read (the overlap
  re-read, Pay's R22 margin) gives one row (same key, `addManyDedup`). Floors as section 5. The
  caption shows while any backfill range is owed.
- New streams (Convert, dust, dividends if shipped, P2P, fiat, trades) start from their own floors
  with null cursors (dust: no cursor); they need no backfill range.

### Scenario matrices (each row becomes a Jest case)

The user's account (fixture "UA-1", from the inventory probe of 2026-10-15; counts, coins, wallets
and months only): Spot BTC is the only non-zero Spot balance; 46 Pay orders, all walletType 1
(Funding), 41 USDT (2025-04..2026-10) and 5 BTC (2026-10), 42 out, 4 in; capital: no deposits,
withdrawals BTC x2 (2025-04, Spot) and USDT x1 (2026-01, Spot); one Transfer MAIN_FUNDING BTC
(2026-10); Earn BTC subscription and redemption (2026-10); one Convert UAH -> USDT (2026-01,
SUCCESS). Rows H13, B4 and N1 use it.

USDT rescale (set 1; exact parity):

| # | Input (scale 2) | Expected (scale 8) | Valued in UAH | was: |
|---|---|---|---|---|
| U1 | USDT holding 12345 (123.45) | 12345000000 | equal before and after | 12345 |
| U2 | USDT row -1 (0.01) | -1000000 | equal | -1 |
| U3 | USDT price point "41.25" | text unchanged | equal | n/a |
| U4 | rule `amount < 1000 USDT` (100000) | 100000000000 | rule matches the same rows | 100000 |
| U5 | template, `currency` USDT, amount 5000, `returns` [700] | 5000000000, [700000000] | n/a | 5000, [700] |
| U5b | exchange template USDT -> UAH: `currency` USDT amount 5000, `destinationCurrency` UAH value 20500 | amount 5000000000; value 20500 | n/a | 5000; 20500 |
| U5c | exchange template UAH -> USDT: `currency` UAH amount 20500, `destinationCurrency` USDT value 5000 | amount 20500; value 5000000000 | n/a | 20500; 5000 |
| U5d | template, `currency` UAH, holding id of a USDT holding | unchanged | n/a | unchanged |
| U6 | BTC/EUR holding | unchanged | equal | unchanged |
| U7 | `.kiko` v3 with U1-U5c, legacy dedup keys | as U1-U5c, keys as U11 | equal to the migrated database | v3 restored at scale 2 |
| U8 | value at the bound, 9007199254 | 9007199254000000 | exact | - |
| U8b | value 9007199255 (over the bound) | 0059 aborts, "CHECK constraint failed: usdt_rescale_guard", nothing written; `MigrationsGate` shows its error state (`migrations-gate-error`, `migrations.error` with that message); a v3 restore refused whole, showing `settings.dataImport.amountTooLargeError`, with no row written | - | - |
| U9 | Binance balance "0.00012345" USDT | 12345 | - | 0 (rounded away) |
| U10 | `.kiko` v4 with a USDT holding 12345000000 | restored byte-unchanged | equal | n/a (no v4) |
| U11 | import row on a USDT holding, key `<id> 1700000000 -1250 coffee`, and a `deleted_import_keys` row `<id> 1700000000 -500 tea␟1` | `<id> 1700000000 -1250000000 coffee`; `<id> 1700000000 -500000000 tea␟1`; a re-import adds no row | - | keys unchanged |
| U12 | import row on a USDT holding with a bank-issued key (first token names no holding) | key unchanged | - | unchanged |
| U12b | import row keyed `<usdtId> ...` that now sits on a UAH holding; import row keyed `<uahId> ...` that now sits on the USDT holding; the same two keys in `deleted_import_keys` | the first rewritten, the second unchanged (key's first token decides) | - | keys unchanged |
| U13 | USDT holding whose `metadata` is not valid JSON; a USDT `category_rules.matchers` text that is not valid JSON | 0059 succeeds and the app launches (`MigrationsGate` reaches its children); both texts byte-unchanged; the bound count skips them; a v3 restore of the same rows restores them unchanged | - | - |
| U14 | USDT holding `metadata` with `principalMinorUnits` as `"5000"` (string) and `faceValueMinorUnits` as `12.5` (real), beside an integer `purchasePriceMinorUnits`; a USDT template with `amountMinorUnits` null | 0059 succeeds, the app launches; those values unchanged, integer siblings in the same JSON rescaled; a v3 restore gives the same | - | - |

Coin registry (set 2):

| # | Entry | Expected |
|---|---|---|
| R1 | USDT, `baseAssetPrecision` 8, `maxUnits` 90,000,000 | scale 8, not reduced |
| R2 | a coin with `baseAssetPrecision` 8, `maxUnits` 10^12 | scale 3, reduced; a row "1.23456789" rounds to 1.235 with `row-precision-rounded` |
| R3 | a coin with `maxUnits` 10^15 | formula scale 0 < 2: not on the registry; shows as not tracked |
| R4 | a coin with `baseAssetPrecision` 6, `maxUnits` 10^6 | scale 6, not reduced; a row with 7 decimals stops `amount-precision` |
| R5 | BTC (`maxUnits` 21,000,000), ETH (`maxUnits` 90,000,000) | scale 8, unchanged from today |

Exact amounts, set 5 (balances) and set 6 (rows), when callers switch to `exchangeMinorUnits`:

| # | Amount text | Result | was: |
|---|---|---|---|
| A1 | BTC `"0.00012345"` | 12345 | 12345 |
| A2 | BTC row `"0.000000001"` (9 decimals) | stop `amount-precision`, owed point | 0 (rounded by `Money.fromMajor`) |
| A3 | BTC `"1e-8"` (exponent form) | refused as malformed (row: stop; balance: wallet keeps its last good balance) | 1 |
| A4 | BTC JSON number `0.5` (not a string) | read through `decimalFromJsonNumber`: 50000000 | 50000000 |

Holdings (set 5):

| # | Balance read | Existing holding | Result | was: |
|---|---|---|---|---|
| H1 | Spot USDT 10 | none | "Binance Spot · USDT" = 10 | not read |
| H2 | Spot USDT 0 | exists at 10 | written 0, stays | not read |
| H3 | Spot DOGE below `dustBelow`, no rows | none | no holding | not read |
| H4 | Spot DOGE below `dustBelow` | exists | written | not read |
| H5 | Funding EUR 5.00 | none | "Binance Funding · EUR" = 5.00 | not read |
| H6 | Spot PEPE (not curated) | - | no holding; PEPE in the not-tracked line ("not on Kiko's coin list") | not read |
| H7 | Spot LDBTC 0.1, Earn BTC 0.1 | - | Spot skips LDBTC; Earn BTC 0.1 | n/a |
| H8 | Spot LDO 3 (curated or not) | - | read as LDO | n/a |
| H9 | Spot BTC named "Binance Spot" | exists | renamed "Binance Spot · BTC" | "Binance Spot" |
| H10 | Spot BTC named "My BTC" | exists | name kept | kept |
| H11 | Funding read fails | USDT:funding exists | last good balance kept | BTC only |
| H12 | amount above the safe bound | - | no write; oversized line | n/a |
| H13 | UA-1 balance read (Spot BTC only non-zero) | Spot BTC | Spot BTC written; no USDT or UAH holding from the balance read; not-tracked line empty | BTC only |

Pay (set 6):

| # | Order | Funds | Rows | Statistics | was: |
|---|---|---|---|---|---|
| Y1 | BTC send | BTC wallet 1 | BTC Funding -, old key | spending BTC | same |
| Y2 | USDT send | USDT wallet 1 | USDT Funding -, key with currency | spending USDT | not imported |
| Y3 | USDC order, paid USDT | USDT wallet 2 | USDT Spot -, `comment` "12.5 USDC" | spending USDT | not imported |
| Y4 | USDT order, paid BTC | BTC wallet 1 | BTC Funding -, key with currency | spending BTC | stop `pay-btc-funded-other-coin` |
| Y5 | order paid USDT + BTC | two entries | one row per coin | spending each | stop |
| Y6 | USDT receive | payer's | USDT +, R22 placement | none | not imported |
| Y7 | funds in an untracked coin | XYZ | no row; XYZ not tracked | none | not imported |
| Y8 | costs of one coin do not sum | - | stop `pay-split-mismatch` | none | same |

Earn rewards (set 6):

| # | Records at one (`ownerId`, `type`, `time`) | Keys | was: |
|---|---|---|---|
| E1 | BTC 0.0001, BTC 0.0002 | `...:0`, `...:1` (today's keys) | same |
| E2 | BTC 0.0001, USDT 0.5, BTC 0.0002, USDT 0.1 | BTC `...:0`, `...:1` byte-equal to E1; USDT `...:0:USDT` (0.1), `...:1:USDT` (0.5) | USDT not read |

2-minute matcher (set 6):

| # | Rows within 2 minutes | Result | was: |
|---|---|---|---|
| S1 | Convert credit USDT +100 (pair markers), a Transfer pair USDT -100 / +100 (markers), a Pay send USDT -100 (no markers) | Pay send counts as spending; Convert and Transfer legs excluded by markers | Pay send excluded (matched to the Convert credit) |
| S2 | Transfer pair BTC -0.01 / +0.01 (markers), BTC Pay send -0.01 | Pay send counts | Pay send could be excluded |
| S3 | two unmarked rows -50 UAH / +50 UAH on two cards, 1 minute apart | both excluded (unchanged) | same |

Trades (set 11; property tests at clock gaps 0, 1 h, 1 day):

| # | Order (fills) | Commission | Rows | Statistics | was: |
|---|---|---|---|---|---|
| T1 | buy 0.01 BTC for 600 USDT (1 fill) | 0.00001 BTC | USDT Spot -600; BTC Spot +0.00999 | excluded | not imported |
| T2 | same, 3 fills | BTC per fill | one pair, sums | excluded | not imported |
| T3 | same | 0.0005 BNB | pair (BTC +0.01) + BNB -0.0005, same pair id | all excluded | not imported |
| T4 | same | fee coin untracked | pair; ticker not tracked | excluded | not imported |
| T5 | sell 0.01 BTC for 600 USDT | 0.6 USDT | BTC -0.01; USDT +599.4 | excluded | not imported |
| T6 | USDT -> PEPE | PEPE | USDT -x, `asset:PEPE`, key `${pairId}:<walletKey>`, no `exchangePairId` | excluded | not imported |
| T7 | order partly filled, later filled | - | amounts refreshed, one pair | excluded | not imported |
| T8 | buy 0.01 BTC for 600 USDT | 0.6 USDT (spent coin) | USDT Spot -600.6; BTC Spot +0.01; no fee row | excluded | not imported |
| T9 | BTC/EUR | EUR | EUR fiat leg | excluded | not imported |
| T10 | run 1 reads fills A1 (order A), B1 (order B), cursor past B1; run 2 reads A2 (a later fill of A) | - | run 2 re-reads A by `orderId` (A1 + A2), rewrites A's pair from both fills; B unchanged; no fill of A dropped | excluded | not imported |
| T11 | T10, but the `orderId` re-read does not fit the lane | - | cursor holds: `fromId` = A2's id, `heldOrderId` = A; nothing at or after A2 written; no owed point; the next run reads the symbol first, re-reads A by `orderId` + `fromId` (A1 + A2, complete by itself), then reads the id cursor from A2 where A2 is skipped (its id is at or below the re-read's last fill id, A2; no second re-read), writes A from A1 + A2, and clears `heldOrderId` in the cursor patch written after A's rows | none | not imported |
| T11b | rows hold A1..A4 (order A open); a run's page 1 holds A5; A6 fills after A's re-read and page 2 holds it | - | page 1: A is re-read (A1..A5) and written from A1..A5; page 2: A6's id is above the re-read's last fill id (A5), so the read ends at A6: the fills before it are written, `fromId` = A6's id, no `heldOrderId`; the next read of the symbol starts at A6, finds A by the `${pairId}:` key prefix, re-reads A (A1..A6) and rewrites it; A6 never dropped | excluded | not imported |
| T12 | sell PEPE (untracked) for USDT; run 1 reads fill A1, run 2 reads A2 | - | run 2 finds A by the `${pairId}:` key prefix (no `exchangePairId` stored), re-reads A by `orderId`; one USDT +(A1 + A2) row under the same key, `asset:PEPE` | excluded | not imported |
| T12b | T12 with a BNB commission on each fill | BNB | as T12, plus one BNB fee row `${pairId}:fee:<walletKey>` refreshed to the summed commission of A1 + A2, `exchangePairId = pairId` (the USDT leg keeps none); no second fee row; the fee row stays on any leg or holding delete (a synced row is never deleted) | excluded | not imported |
| T14 | buy PEPE (untracked) with USDT (C-NR5) | BNB | USDT Spot -x, `asset:PEPE`; BNB Spot fee row `${pairId}:fee:<walletKey>`, `untrackedCounterpart = asset:PEPE`, no `exchangeCounterpartHoldingId`, `operation = 'trade-fee'`, `exchangePairId = pairId` (the USDT leg keeps none); the fee row stays on any leg or holding delete (a synced row is never deleted) | both excluded | not imported |

Convert, dust, dividends, P2P, fiat (sets 8, 9, 12):

| # | Record | Rows | Statistics | was: |
|---|---|---|---|---|
| C1 | Convert UAH -> USDT, SUCCESS | UAH fiat -, USDT + (pair), on the C-NR3 wallet (default Spot) | excluded | not imported (D7) |
| C2 | Convert PROCESS | owed point | none | not imported |
| D1 | dust TRX + DOGE -> BNB | two pairs | excluded | not imported |
| D2 | dust of an untracked coin | BNB +, `asset:` | none | not imported |
| D3 | the same 100 dust records on the next run | no new row (keys) | - | not imported |
| V1 | dividend, allowlisted (only if shipped) | `+`, `reward` | none | not imported |
| V2 | dividend, not allowlisted (only if shipped) | none, tag counted | none | not imported |
| P1 | P2P BUY COMPLETED, 100 USDT for 4150 UAH (`totalPrice` "4150") | Funding USDT +100, `p2p:UAH:4150.00`, comment "4150 UAH" | none | not imported |
| P2 | P2P SELL COMPLETED, 100 USDT for 4100.5 UAH | Funding USDT -100, `p2p:UAH:4100.50` | excluded | not imported |
| P3 | P2P CANCELLED | none | none | not imported |
| P4 | P2P with commission, before P5 confirmed | owed point | none | not imported |
| P5 | P2P BUY, `totalPrice` "4150.001" | stop `amount-precision`, owed point | none | not imported |
| F1 | fiat deposit EUR 100, Successful | Spot EUR +100, `bank:EUR:100.00` | none | not imported |
| F2 | fiat withdraw EUR 50 | EUR -, `bank:EUR:50.00` | excluded | not imported |
| F3 | card buy 0.001 BTC for 2600 UAH | Spot BTC +0.001, `card:UAH:2600.00` | none | not imported |

Not-tracked and not-listed (sets 5, 15):

| # | Account | Shown | was: |
|---|---|---|---|
| N1 | UA-1 | not-tracked line hidden (no untracked coin); not-listed note under each Binance holding; "Earlier history" on "Binance Funding · USDT" while the Pay backfill (B4) is owed | BTC only, no note |
| N2 | run N: Spot PEPE 1000 (balance list [PEPE]), XYZ in a Pay funds entry (history list [XYZ]); run N+1: the balance read writes [PEPE] again, no Pay record of XYZ | after each run: "Not tracked: PEPE, XYZ" (C-NR8) | not shown |
| N3 | marker `p2p:UAH:abc` (malformed total) | label "P2P purchase (UAH)"; matcher skips it | n/a |

Backfill (set 15):

| # | State at the first multi-coin run | Result | was: |
|---|---|---|---|
| B1 | Pay cursor null (fresh connect) | no `multiCoinSince`, no backfill range; the walk reads every coin from its floor | n/a |
| B2 | backfill range holds a BTC record | skipped, no row | n/a |
| B3 | a USDT record read by the live pass and the backfill pass | one row | n/a |
| B4 | UA-1: Pay `multiCoinSince` = cursor on the first 1.3 sync | backfill imports the 41 USDT orders (Funding) over the next syncs; the 5 BTC orders are skipped (already imported); the 2026-01 USDT withdrawal imports on Spot via the capital backfill; the Convert imports through its own walk (C1); Transfer and Earn backfill find no non-BTC record; the caption shows until every range is read | USDT never imported |
| B5 | every backfill range read | caption hidden (K1) | n/a |

Walk-state copy (set 4, migration 0060 and its restore mirror):

| # | Before | After |
|---|---|---|
| Z1 | account with Spot BTC walk keys, no `sync_state` row | row created, `exchange_state` built, other columns null |
| Z2 | disconnected account, floor values in metadata | copied as stored |
| Z3 | every walk key of capital, Pay, Transfer, Earn set (cursor, rescan, pending, point cursor, range cursor, span hints) | each in its walk entry, field by field (map pinned); read back through the section 2 parse, every BTC walk's cursor, rescan, pending, point and range cursors and span hints (all four passes) equal what today's readers return from the old metadata |
| Z4 | metadata not valid JSON | no `exchange_state` for that account; migration succeeds; walks read from their floors (keys dedupe) |
| Z5 | Pay `pending` value not a list | copied as stored; only the Pay `pending` field parses as malformed and repairs per `readPendingMark` (that field alone written); the Pay cursor, rescan, point and range cursors and span hints keep their values, as do the other walks |
| Z6 | `.kiko` without `exchangeState` and without a `syncState` row | restore equals Z1 |

Walk-state parse and writer (set 4):

| # | Stored | Action | Result |
|---|---|---|---|
| X1 | top level not JSON | a sync | balance written; no history walk runs; nothing written to the column; tag logged; caption shown |
| X2 | `walks.earn` malformed, others good | patch `walks.pay` | Pay replaced; Earn text byte-identical |
| X3 | account `institution` changed to null | patch | nothing written |
| X4 | no `sync_state` row | patch | row inserted |

Matcher (set 13):

| # | Exchange row | Bank debit | Result | was: |
|---|---|---|---|---|
| M1 | P2P buy, `p2p:UAH:4150.00` at t | -4150.00 UAH at t - 20 min | debit excluded; caption "Matched to P2P purchase" | counts |
| M2 | same | -4150.00 UAH at t - 2 h | counts (outside window) | counts |
| M3 | same | -4150.01 UAH | counts | counts |
| M4 | two P2P buys of 4150.00 | one debit | one match (nearest gap) | counts |
| M5 | card buy `card:UAH:2600.00` | -2600 UAH at t + 2 days (posting lag) | excluded | counts |
| M6 | fiat deposit `bank:EUR:100.00` | -100 EUR at t - 3 days | excluded | counts |
| M7 | none | -4150.00 UAH | counts | counts |
| M8 | P2P buy | debit in USD for the UAH total | counts | counts |
| M9 | P2P buy 4150.00 | -4150.00 UAH at t - 20 min, `categorySetByHand` true | counts; no caption | counts |
| M10 | P2P buy 4150.00 | two debits of -4150.00 UAH: a grocery row at t - 5 min, an MCC 4829 row at t - 30 min | the 4829 row is excluded; the grocery row counts | counts |
| M11 | P2P buy on a crypto account hidden by the account filter | -4150.00 UAH at t - 20 min | excluded | counts |
| M12 | P2P buy 4150.00 | two debits of -4150.00 UAH: an MCC 6012 row at t - 30 min (already excluded), a grocery row at t - 5 min | the 6012 row is consumed by the match (stays excluded; caption shown); the grocery row counts | 6012 excluded; grocery counts |
| M13 | P2P buy 4150.00 | two debits of -4150.00 UAH: a hand-categorized funding debit at t - 30 min, a grocery row at t - 5 min | the hand row is consumed and stays as the user set it (its category decides; no caption); the grocery row counts | hand row as set; grocery counts |

Withdrawals (R-Q12): W1 a USDT withdrawal counts as spending in the default category (was: not
imported; BTC: same as before). W2 a hand link keeps today's exclusion.

Caption (set 15):

| # | State | Caption | was: |
|---|---|---|---|
| K1 | every cursor current, nothing owed | hidden | hidden |
| K2 | a walk cursor null or more than a day behind | shown | shown |
| K3 | Transfer owes a range | shown | shown |
| K4 | a backfill range owed | shown | hidden |
| K5 | only owed points | hidden | hidden |
| K6 | a candidate trade symbol never read (no entry or null `fromId`) | shown | n/a |
| K6b | every candidate symbol read, one read empty (`fromId` 0) | hidden | n/a |
| K7 | top-level `exchange_state` malformed | shown, with the paused copy (`exchangeHistoryPaused`) | n/a |

## 8. Connect flow (R-Q10)

- Exchange catalog `src/crypto-sync/exchange-catalog/exchange-catalog.ts` (TS only, stored in
  `accounts.bankId` for a crypto account, no migration): `binance` (displayName "Binance",
  `connectable: true`), `btc_wallet` (label "Bitcoin wallet address", `connectable: true`),
  `other` (manual holdings, last). A crypto account with a null `bankId` and an `institution`
  reads its catalog id from the institution. Bybit joins in 1.3-b.
- Account form, kind `crypto` (`account-form.screen.tsx`): the `SegmentedControl` of
  `CryptoSyncForm` goes. A new `ExchangeTypeField`
  (`src/screens/forms/exchange-type-field/`, modelled on `BankTypeField`): `FieldTrigger` +
  `BottomSheet` + one `SelectableRow` per catalog entry, a capability caption and icon from the
  entry's data (kiko-design-system "Capability icons"), the generic icon, no logo, and
  `forms.account.exchangeDisclaimer` under the trigger. Below it, inline: `BinanceCredentialsField`
  for `binance`, `WalletAddressField` for `btc_wallet`, nothing for `other`. Connect-first and the
  rollback stay as `connectBinance` / `connectWallet` do today.
- Account detail, not connected (`CryptoSyncSection`): the field directly when `bankId` names a
  wired provider; else `accountDetail.connectExchangeAction` opens the shared provider sheet. That
  sheet is `AddBankProviderSheet` generalized into `ProviderSheet`
  (`src/screens/account-detail/provider-sheet/`), listing registry-wired catalog entries
  (`visibleCatalogEntries` over a registry), used by both the bank and the crypto sections, plus
  "Change exchange".
- Connected: unchanged UI; display name and disconnect copy come from the registry; the
  not-tracked line, the oversized line and the caption sit under the status line.
- Keychain: one item per exchange per account, `kiko.<exchange>.credentials.<accountId>`; Binance's
  string unchanged. `.kiko` secrets keep `binanceCredentials`.
- `syncJobsFor`, auto-sync and refresh drive exchanges through the registry; an id with no entry is
  skipped (bank rule).

## 9. Compliance

| Item | 1.3-a |
|---|---|
| Logos (Third-party trademarks) | none; plain-text names and the generic icon; `exchangeDisclaimer` under the picker |
| Network | no new host: Binance public market data uses the pinned `api.binance.com` without a key; CoinGecko unchanged. `check:plist` unchanged |
| Privacy policy, price fallback (set 5; `docs/privacy-policy.en.md` and `docs/privacy-policy.md`, section 3, and the published copies `docs/privacy-site/en.html` and `docs/privacy-site/index.html`, which carry the same wording in the same commit) | The fallback calls `api.binance.com` for any user holding a coin CoinGecko did not price, with or without a Binance account. Section 3's opening sentence "Some connections run only after you connect ... (Monobank statements, Binance, Blockstream)" names "Binance account data" instead of "Binance" (uk: «дані акаунта Binance» instead of «Binance»), because a Binance price call now runs without a connection. Section 3's automatic list gains "cryptocurrency prices (CoinGecko, and Binance public prices when CoinGecko has none)", and the Binance bullet gains: "Also, for any user, public market prices of a coin CoinGecko did not price: Kiko sends only the market symbol (for example `BTCUSDT`); no key, address or amount is sent." The uk text mirrors it (translator review) |
| Privacy policy, Binance data (set 15) | the Binance bullet adds: balances of every coin and fiat, trades, Convert, P2P orders (amounts, fiat totals; no counterparty data), fiat deposits/withdrawals and card purchases, dust conversions, distributions (if shipped) |
| App Privacy label | stays "Data Not Collected" (everything stays on device); the review is recorded in `memory/refs/resubmission-kit.md` section D |
| Stored counterparty data | Pay nickname only (D4); P2P `counterPartNickName` and fiat payment method details are never read into a type |
| API terms gate | Before set 15 merges, read and record (URL, date, clauses) Binance's Terms of Use, its API terms (the clauses on read-only third-party apps) and its market-data display terms (the clauses on showing Binance price data in a third-party app, attribution included); scribe records them in kiko-compliance. A clause that forbids the price display removes the fallback before ship. Bybit's terms (PDF in `research-bybit.md`) gate 1.3-b |
| Demo `.kiko` (`e2e/screenshot/fixtures/kiko-demo-en.kiko`, `kiko-demo-uk.kiko`, built by `build-demo-snapshot.ts`) | a crypto account (`institution` null) with manual holdings in at least five curated coins incl. USDT, USDC, ETH, BNB and a non-top coin (one with a dated price history), plus UAH and EUR holdings; on that account (set 7) an Exchange pair USDT -> BTC with `operation = 'trade'` and its third-coin fee row (BNB, `operation = 'trade-fee'`, same pair id, labelled "Trading fee"), a Convert pair UAH -> USDT (`operation = 'convert'`), a dust pair DOGE -> BNB (`operation = 'dust'`), a P2P buy row with `p2p:UAH:4150.00` and `operation = 'p2p'`, a card buy row with `card:UAH:2600.00` (`operation = 'card'`), a fiat deposit row on the EUR holding with `bank:EUR:100.00` (`operation = 'fiat'`), a reward row (`operation = 'reward'`; dropped with the dividend walk if P8 removes it), and a matching bank debit on a bank account so the statistics matcher shows (set 13). Two connectable demo accounts, both with `institution` null so `useAutoSync` never runs: a crypto account with `bankId = 'binance'` so the reviewer reaches the Binance connect field (set 14), and one with `bankId = 'btc_wallet'` (set 14); `build-demo-snapshot.ts` maps `bankId` to null for every non-bank account today (`account.kind === 'bank' ? ... : null`), so set 14 changes that mapping. Regenerated (`KIKO_REGEN_DEMO=1`) with each snapshot-shape change: set 1 (`EXPORT_VERSION` 4; `generate-demo-kiko.test.ts` pins `envelope.version` to it), set 4 (`exchange_state` column), set 7 (rows, `operation`), set 13, set 14 |
| 3.1.5 | read-only viewer; the notes state no trading, withdrawal or transfer is possible |

Notes for Review (en, appended to the reviewer kit in set 15):

> Kiko can show a Binance account read-only. The user creates an API key in Binance (API
> Management, "Enable Reading" only) and pastes it in Accounts > Add account > Crypto > Exchange or
> wallet > Binance. The key stays in the iOS Keychain and is sent only to api.binance.com from the
> device; Kiko cannot trade, withdraw or move funds. Without a Binance account, the connect form
> and its "not affiliated" caption are visible on that path.
>
> New in this version, with where to see each in the demo file (Settings > Import):
> - Holdings in many coins (USDT, USDC, ETH, BNB and others) and UAH and EUR holdings, valued
>   from market prices: the demo crypto account.
> - Spot trades, Convert and dust conversions to BNB shown as an exchange between two holdings; a
>   trading fee paid in a third coin (BNB) shows as a "Trading fee" row (a fee in the bought or
>   sold coin is part of the exchange amount, with no row of its own): the demo crypto account's
>   transactions.
> - P2P and card purchases, labelled "P2P purchase (UAH)" and "Card purchase (UAH)", a "Bank
>   deposit (EUR)" row and a "Reward" row: same account.
> - A bank card payment that funded a P2P purchase is not counted as spending and shows "Matched to
>   P2P purchase": the demo bank account's transaction and the Statistics tab.
> - The "Exchange or wallet" picker with Binance and Bitcoin wallet address: the demo accounts
>   marked Binance and Bitcoin wallet.
> - With a connected Binance account only: one holding per coin and wallet filled from Binance,
>   fiat balances, "Bank withdrawal (EUR)" rows, a "Not tracked" line for coins outside Kiko's coin
>   list, an "Earlier history" line and a short "Not listed" note at the bottom of each Binance
>   holding, and a "history not imported yet" line while older history loads.

Accepted: the demo's reward row and the "Reward" words above exist only if probe 2 finds dividend
types; if probe P8 removes the dividend walk, both go (set 15 writes the notes from what ships).

## 10. Copy (en; uk proposed, translator review before deploy)

| Key | en | uk |
|---|---|---|
| `forms.account.exchangeType` | Exchange or wallet | Біржа або гаманець |
| `forms.account.exchangeTypePlaceholder` | Select an exchange or wallet | Оберіть біржу або гаманець |
| `forms.account.exchangeTypeSheetTitle` | Exchange or Wallet | Біржа або гаманець |
| `forms.account.exchangeDisclaimer` | Kiko is an independent app. It is not affiliated with or endorsed by any exchange or wallet provider. | Кіко — незалежний застосунок. Він не пов’язаний із жодною біржею чи гаманцем і не є їхнім партнером. |
| `forms.account.exchangeConnectable` | Connect with a read-only API key. | Підключення з ключем API лише для читання. |
| `forms.account.walletConnectable` | Connect with a public address. | Підключення за публічною адресою. |
| `forms.account.bitcoinWallet` | Bitcoin wallet address | Адреса гаманця Біткоїн |
| `forms.account.exchangeOther` | Other exchange or wallet | Інша біржа або гаманець |
| `forms.account.exchangeOtherCaption` | Add holdings by hand. | Додавайте активи вручну. |
| `accountDetail.connectExchangeAction` | Connect an exchange or wallet | Підключити біржу або гаманець |
| `accountDetail.connectExchangeSheetTitle` | Connect an Exchange or Wallet | Підключити біржу або гаманець |
| `accountDetail.changeExchangeAction` | Change exchange | Змінити біржу |
| `accountDetail.exchangeHistoryPending` (replaces `binanceHistoryPending`) | Some {{exchange}} transaction history is not imported yet. Kiko will keep importing on each sync. | Частину історії транзакцій {{exchange}} ще не імпортовано. Кіко продовжить імпорт під час наступних синхронізацій. |
| `accountDetail.exchangeHistoryPaused` (set 4; shown instead of the pending caption while the top-level state is malformed, X1 and K7) | {{exchange}} history import is paused because Kiko could not read its saved import progress. Disconnect and reconnect {{exchange}} to repair it; your holdings and transactions stay. | Імпорт історії {{exchange}} призупинено, бо Кіко не зміг прочитати збережений прогрес імпорту. Відʼєднайте й знову підключіть {{exchange}}, щоб це виправити; ваші активи й транзакції залишаться. |
| `accountDetail.untrackedCoins` | Not tracked: {{tickers}}. These coins are not on Kiko's coin list, so Kiko does not import them. | Не відстежуються: {{tickers}}. Цих монет немає в списку Кіко, тому Кіко їх не імпортує. |
| `accountDetail.oversizedAmount` | {{coin}}: the amount is too large for Kiko to store exactly, so it was not imported. | {{coin}}: сума завелика, щоб Кіко зберіг її точно, тому її не імпортовано. |
| `settings.dataImport.amountTooLargeError` (set 1; a version 1-3 backup refused by the USDT safe-integer bound, U8b) | This backup has a USDT amount too large for Kiko to store exactly, so nothing was imported. Your current data is unchanged. | У цій резервній копії є сума в USDT, завелика, щоб Кіко зберіг її точно, тому нічого не імпортовано. Ваші поточні дані не змінено. |
| `accountDetail.disconnectProviderMessage.binance` (changed) | This clears the connection and the stored API key. Your holdings and transactions stay as a manual snapshot. | (unchanged) Акаунт буде відʼєднано, але ви можете й надалі керувати ним вручну. |
| `holdingDetail.earlierHistory` | Earlier history: {{amount}} | Попередня історія: {{amount}} |
| `holdingDetail.exchangeNotListed.binance` | Not listed: futures, margin and options trades; Binance Card and gift card spending; Auto-Invest; loans; ETH and SOL staking; mining; NFTs; copy trading; Dual Investment; sub-accounts; distributions other than Simple Earn rewards; trades of coins sold before this version that Kiko saw nowhere else; and records older than Binance keeps. Binance does not say which wallet Convert, P2P and fiat operations use: Kiko shows Convert and fiat operations on Spot and P2P orders on Funding. | Не показано: угоди з ф’ючерсами, маржею та опціонами; витрати з Binance Card і подарункових карток; Auto-Invest; позики; стейкінг ETH і SOL; майнінг; NFT; копітрейдинг; Dual Investment; субакаунти; розподіли, крім винагород Simple Earn; угоди з монетами, проданими до цієї версії, яких Кіко ніде більше не бачив; записи, старіші за ті, що зберігає Binance. Binance не вказує гаманець для операцій Convert, P2P і фіатних операцій: Кіко показує операції Convert і фіатні операції на Spot, а замовлення P2P — на Funding. |
| `transactions.tradingFee` | Trading fee | Торгова комісія |
| `transactions.reward` | Reward | Винагорода |
| `transactions.p2pPurchase` / `p2pSale` | P2P purchase ({{currency}}) / P2P sale ({{currency}}) | Купівля P2P ({{currency}}) / Продаж P2P ({{currency}}) |
| `transactions.cardPurchase` / `cardSale` | Card purchase ({{currency}}) / Sale to card ({{currency}}) | Купівля карткою ({{currency}}) / Продаж на картку ({{currency}}) |
| `transactions.bankDeposit` / `bankWithdrawal` | Bank deposit ({{currency}}) / Bank withdrawal ({{currency}}) | Поповнення з банку ({{currency}}) / Виведення в банк ({{currency}}) |
| `transactions.matchedP2pPurchase` | Matched to P2P purchase | Зіставлено з купівлею P2P |
| `transactions.matchedCardPurchase` | Matched to card purchase | Зіставлено з купівлею карткою |
| `transactions.matchedExchangeDeposit` | Matched to exchange deposit | Зіставлено з поповненням біржі |
| `help.topics.connectCrypto.steps.2` (changed) | Under "Exchange or wallet", choose "Binance" or "Bitcoin wallet address". | У полі «Біржа або гаманець» оберіть «Binance» або «Адреса гаманця Біткоїн». |
| `accountDetail.sourceLabel` and the `sourceLabels` segment labels of `CryptoSyncForm` | removed with the segmented control (set 14); the developer re-greps their uses | removed |
| `currencyNames.<CODE>` per new coin | the coin's name (USD Coin, First Digital USD, Dai, BNB, ...) | an authored name per coin (proper nouns kept; e.g. «Ефіріум» style) |

The not-listed note's wallet sentence names the wallets the code uses (C-NR3). If probe 2 observes
another wallet, set 8 or set 12 changes the sentence and the code together (translator review). If
the dividend walk ships, "distributions other than Simple Earn rewards" becomes "distributions
Kiko does not recognize" (uk «розподіли, яких Кіко не розпізнає»).

Casing follows kiko-translator: sheet titles Title Case in en, sentence case in uk; "Binance",
"P2P", "API", "NFT", "Simple Earn", "Dual Investment", "Spot", "Funding", "Convert" and coin codes
are kept as written (`PROPER_NOUNS` gains any new uk case form, for example «Біткоїн» forms already
listed). `exchangeTo`/`exchangeFrom` take a ticker as `{{name}}` for `asset:` rows; no new key.
Holding names and wallet names stay code-side proper nouns.

## 11. Change sets (track `crypto-exchanges-1.3-a`, 15 tasks)

Rules for every set: each tip ships safe on its own (memory "task tip must be safe"); before its
`make deep`, `KIKO_MUTATION_BASE=<that set's base sha> make mutable` gives the file count, which
must be at most 30 (`MUTATION_FILE_CAP`); the coordinator runs
`KIKO_MUTATION_BASE=<base> make deep` per set, detached; `make verify` runs once at the end of the
track, until green. Walk-touching sets carry property tests at clock gaps 0, 1 h and 1 day; money
sets carry exact-parity tests. A set whose measured count goes over 30 stops and reports; it is
never cut silently. No set adds an index, so no set needs an EXPLAIN QUERY PLAN test; a set that
ends up adding one gets it with its reviewer step. Each migration set re-checks its number against
main's journal before its merge.

Order: the sets run strictly in order 1 -> 2 -> 3 -> 4 -> 5 -> 6, each on the previous set's tip.
- Set 2's registry derives `currencyScale`, so it needs set 1's rescale.
- Set 3's amounts unit wraps set 2's parser.
- Set 4's walk state lives in set 3's layer.
- Set 5 needs the registry, the amounts unit and `exchange_state`.
- Set 6 needs `multiCoinSince` and the per-coin holding keys.
Sets 1, 2 and 4 never run in parallel worktrees, because each changes `restore-snapshot.ts` (and
sets 1 and 4 also change `envelope.test.ts`'s `VERSION_DECISIONS`).

| Task | Content | Files / areas | Migration | Tests | Probe |
|---|---|---|---|---|---|
| 1/15 | USDT scale 8, migration 0059 (amounts, JSON fields, templates by own currency, rules, import keys, bound guard; `bond_register` excluded), `restoreDataSnapshot(snapshot, version)` with a REQUIRED version, `withUsdtRescaled`, `.kiko` v4 (`VERSION_DECISIONS` version 4, count 60), crypto display trim in `formatMoney` (user ruling Q1), `settings.dataImport.amountTooLargeError` (en + uk, translator review) | `src/currency/currency/currency.ts` (`currencyScale.USDT`), `src/currency/format/format.ts`, `drizzle/migrations/0059_*.sql` + `migrations.js` + meta, `src/data-transfer/crypto/envelope.ts` (+ `envelope.test.ts`), `src/data-transfer/import-data.ts`, `src/data-transfer/snapshot/restore-snapshot.ts` + `with-usdt-rescaled.ts` (new), `import-data.screen.tsx` (`IMPORT_ERROR_KEYS`), `src/i18n/locales/{en,uk}.ts`, the 78 test call sites of `restoreDataSnapshot` and `build-demo-snapshot.ts`, both demo files `e2e/screenshot/fixtures/kiko-demo-en.kiko` and `kiko-demo-uk.kiko` regenerated (`KIKO_REGEN_DEMO=1`; `generate-demo-kiko.test.ts` pins `EXPORT_VERSION`) (~8 mutable) | 0059 USDT rescale; `kiko:reviewer` before BATCH READY | U1-U14 (U12b included); two-path migration/restore; bound abort and its `MigrationsGate` error state pinned; the refused restore shows `amountTooLargeError`; malformed JSON and non-integer fields launch and stay unchanged; display DP1-DP5 with the changed fixed-8 BTC pins (section 3); the user confirms the display on device | no |
| 2/15 | curated registry with the scale formula, USDC/FDUSD/DAI and the other curated codes, the exact decimal-to-minor-units parser (owned here; set 3's amounts unit wraps it), per-coin CoinGecko isolation, history fetched only for coins a holding uses, frozen 0044 list, coin names, picker | `src/currency/currency/currency.ts`, `src/currency/coins/` (new), `src/currency/decimal/decimal.ts`, `src/rates/coingecko-ids/`, `src/rates/coingecko/`, `src/rates/coingecko-history/`, `src/rates/history-backfill/`, `src/rates/rates-refresh/`, `restore-snapshot.ts` (`FROZEN_1_0_CRYPTO_CODES`), `src/i18n/locales/{en,uk}.ts`, holding form picker, demo seed (~12) | none | R1-R5; registry invariants; parser exact-parity property; 0044 frozen pin; CoinGecko one-id-missing case; no history request for a curated coin no holding uses | no |
| 3/15 | layer extraction, Binance BTC-only, code moves only (`btcSatoshis` and `sumSatoshis` keep their behaviour; `exchangeMinorUnits` is added with no caller); `Pager`, `RunBudget`, `SignRequest`, credentials unit with Binance-specific wrappers kept in `binance/`; `offsetPager` | `src/crypto-sync/exchange/{credentials,signing,budget,paging,walk,amounts}/` (moves with `git mv` + barrels; no `registry/`, set 14 creates it), the `exchange/` container declared in `scripts/checks/feature-imports.js`, `binance.*` importers (~20-25 mutable; moves and importers in one commit). Before any other work, the developer commits the moves and importers and runs `KIKO_MUTATION_BASE=<set 3 base sha> make mutable`; over 30, set 3 is split in advance, before review (for example credentials + signing + amounts, then budget + paging + walk), each part with its own base | none | today's suites green unchanged; a byte-identical key and request snapshot test | no |
| 4/15 | 4 (first commit: test helper): a test-only commit routes every read and seed of the old walk metadata fields in the tests (about 350 references in 18 test files) through one helper, `walkMarksOf` / `withWalkMarks` in `src/test-support/walk-marks.ts` (imported as `@kiko/test-support/walk-marks`, like `real-sqlite`), with no app change and every suite green. Then: walk state to `sync_state`, per-walk parse, `write(...)` writer, the helper switched to `exchange_state`, `exchangeHistoryPaused` copy (en + uk, translator review), the 0060 `VERSION_DECISIONS` entry (no bump, count 61) | `src/db/schema.ts`, `src/sync-state/sync-state.repo.ts`, `exchange/walk-state/`, `holding-metadata.ts`, `holdings.repo.ts`, `disconnect.ts`, `restore-snapshot.ts` (`withWalkStateMoved`), walk readers/writers, `binance-history-status.ts`, `crypto-sync-section.component.tsx`, `src/i18n/locales/{en,uk}.ts`, `envelope.test.ts`, both demo `.kiko` files regenerated for the new column (~18) | 0060 ADD COLUMN + copy; `kiko:reviewer` before BATCH READY | Z1-Z6; X1-X4 (X1 with the paused copy); two-path restore; disconnect reset; walk properties at 0 / 1 h / 1 day | no |
| 5/15 | multi-coin balances, per-coin and fiat holdings, names and BTC rename, LD* skip, not-tracked and oversized lines, Binance price fallback, privacy policy price wording | `binance.provider.ts`, `binance.client.ts`, `binance.holding-keys.ts`, `provider.ts`, `sync.ts`, `holdings.repo.ts` (`renameFromDefaults`), `exchange/history-status/`, `crypto-sync-section.component.tsx`, `src/rates/` fallback, balance amounts switched to `exchangeMinorUnits`, `docs/privacy-policy*.md` and `docs/privacy-site/{en,index}.html` (~14) | none | H1-H13; N2; A1-A4 for balances; exact sums per coin; one coin missing a price | no (P9, P10, P13, P14 have safe defaults) |
| 6/15 | account-wide capital, Pay, Transfer, Earn; key rules; cross-coin Pay; Earn reward grouping per asset; `multiCoinSince`; 2-minute matcher input filter; row amounts switched from `btcSatoshis` to `exchangeMinorUnits` | `binance.transactions.ts`, `binance.pay-history.ts`, `binance.history-client.ts`, `binance.transfer-history.ts`, `binance.earn-history.ts`, `exchange/walk/`, `src/statistics/internal-transfers/`, `statistics.screen.tsx` (~12) | none | Y1-Y8; E1-E2; S1-S3; W1-W2; A1-A4 for rows; key byte-identity for BTC; key uniqueness property; walk properties at 0 / 1 h / 1 day | no (P11, P12, P16 safe defaults) |
| 7/15 | `operation` column, C-NR1 code forms and parsers, render labels, copy, demo rows | `src/db/schema.ts`, `untracked-counterpart.ts`, `row-description.ts`, `exchange-description.ts`, `transactions.repo.ts`, `src/i18n/locales/{en,uk}.ts`, migration files, demo seed + regen (~10) | 0061 ADD COLUMN; `kiko:reviewer` before BATCH READY | label order cases; code parse cases incl. N3; back-compat import of an export without the column; exclusion unchanged | no |
| 8/15 | Convert walk | `binance.convert-history.ts` (new), `binance.history-client.ts`, `binance.history-budget.ts`, `run-crypto-sync.ts` (~6) | none | C1-C2; window halving on `moreData`; walk properties | yes (P4; C-NR3 wallet) |
| 9/15 | dust read; dividend walk only if P8 yields an allowlist value | `binance.dust-history.ts`, `binance.dividend-history.ts` (new, conditional), client, budget, run wiring (~7) | none | D1-D3; V1-V2 and the allowlist pin if shipped | yes (P7, P8) |
| 10/15 | trades 1/2: symbol discovery, rotation with the reserved call, `idCursorPager` | `exchange/paging/id-cursor-pager.ts`, `binance.trade-symbols.ts` (new), public `exchangeInfo` read, `walk-state` trades part (~7) | none | rotation bound `ceil(S / L)` property with `L >= 1` when changed symbols fill the lane; discovery cases; pager pages | yes (P1, P2) |
| 11/15 | trades 2/2: order aggregation, `orderId` re-read, rows, fee rules (C-NR2, C-NR5), `/api/*` IP budget, lane caps measured | `binance.trade-history.ts` (new), `binance.history-client.ts`, `binance.history-budget.ts`, `run-crypto-sync.ts` (~6) | none | T1-T12b and T14 exact parity; properties at 0 / 1 h / 1 day; measured run report | yes (P1, P3, P15, P15b) |
| 12/15 | P2P, fiat orders, fiat payments walks | `binance.p2p-history.ts`, `binance.fiat-history.ts` (new), client, budget, run wiring (~7) | none | P1-P5, F1-F3; UID 45000 lane cap; properties | yes (P5, P6; C-NR3 wallets) |
| 13/15 | read-time bank-debit matcher and its caption | `src/statistics/exchange-funding-match/` (new), `statistics.screen.tsx`, the transaction form caption slot, i18n, demo bank debit (~6) | none | M1-M13; one-to-one tie-breaks with a distinct value per sort key | no |
| 14/15 | exchange catalog, picker field, registry wiring, shared provider sheet, `syncJobsFor` | `exchange-catalog/`, `exchange/registry/`, `exchange-type-field/` (new), `crypto-sync-form`, `account-form.screen.tsx`, `crypto-sync-section`, `add-bank-sheet` -> `provider-sheet`, `bank-sync-section`, `sync-jobs.ts`, `provider.ts`, `deletable.ts`, i18n, `build-demo-snapshot.ts` (crypto `bankId` kept) + `binance` and `btc_wallet` demo accounts (`institution` null) + demo regen (~16) | none | picker and caption render; registry skip of an unwired id; connect-first rollback; demo invariant per connectable catalog entry | no |
| 15/15 | backfill ranges, caption, "Earlier history", not-listed note, privacy policy Binance paragraph, terms check, Notes for Review, demo regen, kiko-architecture/kiko-domain/kiko-compliance updates via scribe | `exchange/walk/` (backfill scope), the four walk files, `exchange/history-status/`, `holding-detail.screen.tsx`, i18n, `docs/privacy-policy*.md`, `e2e/screenshot/` seed (~12) | none | K1-K7 (K6b included; K7 uses the paused copy that set 4 adds); B1-B5; N1; earlier-history sum exact | no (terms gate) |

Sets 8-12 wait for probe 2 (R-Tech). Sets 1, 4 and 7 each carry a `kiko:reviewer` step on their
migration before BATCH READY. Device verification with the user's key runs on the final tip
before 1.3-a ships.

Release-step note (not a code change): set 1 makes the demo files version 4, which a 1.2.x build
cannot read. If a 1.2.x build is still in App Store review when set 1 merges, the release step
freezes a version 3 copy of the demo file for that build's reviewer (as `kiko-demo-en-1.1.kiko` was
kept for 1.1).

## 12. Open questions

### Probe-dependent facts

Probe 2 is `memory/refs/binance-operations-probe.sh` (trades, convert, p2p, fiat, dust,
dividends), plus a `balances` part to add to it for P9-P14 (counts and tickers only, as the script's
privacy header requires). Probe 3 is the P15b check, run before set 11.

| # | Fact | Default until confirmed | Fallback if refuted | Sets |
|---|---|---|---|---|
| P1 | `myTrades` with `symbol` + `fromId=0` and no times returns trades older than 24 h | id-cursor paging from 0 | trades read 24 h windows per symbol forward from the cutover only; older trades are not imported, the not-listed note names "trades before <date>", the "Earlier history" line shows the gap | 10, 11 |
| P2 | candidate symbol count for the user's coins (exchangeInfo) | lane cap 100 | lower per-run coverage; the rotation bound grows with `S` (measured) | 10 |
| P3 | `myTrades` lookback | from id 0 | the floor where Binance stops returning rows | 11 |
| P4 | Convert: 30-day span cap, lookback, wallet of a Convert from Funding | 30 d, 2 years, Spot | span: the window narrows to the cap; depth: floor at the deepest served; wallet: C-NR3 | 8 |
| P5 | P2P: paging fields (`total`?), statuses, wallet, `amount` net or gross of `commission`, `totalPrice` decimals | as section 5; Funding | page until a short page; wallet: C-NR3; amount: orders with commission stay owed; decimals past the fiat scale: per-record stop | 12 |
| P6 | fiat orders and payments: span and lookback, statuses, UID header, credited wallet, withdraw fee in `amount` | 30 d windows, `Successful`/`Completed`, Spot | windows narrow to what is served; wallet: C-NR3 | 12 |
| P7 | dribblet: do times reach past the last 100; is `transferedAmount` net of `serviceChargeAmount` | newest 100 only; net | older dust not listed (note); gross: BNB leg = transfered minus charge | 9 |
| P8 | assetDividend: `enInfo` values, credited wallet, overlap with Earn rewards, lookback | no allowlist value: the walk is removed from 1.3-a | - | 9 |
| P9 | LD* tokens in `/api/v3/account` | skip rule of section 3 | none needed (the rule is safe both ways) | 5 |
| P10 | max decimals per coin in balances and rows | scale from the registry | balance rounds with a tag; a row stops (`amount-precision`) unless reduced-scale | 5, 6 |
| P11 | Earn reward `productId` per asset | the reward group key adds the asset | none needed | 6 |
| P12 | Pay `fundsDetail` with several coins; `walletAssetCost` keys per coin | rows per coin and wallet | `pay-split-mismatch` stop | 6 |
| P13 | `get-funding-asset` without `asset` omits zero rows | a missing coin reads as zero for existing holdings | none needed | 5 |
| P14 | `EURUSDT` is a live spot symbol | USDT fallback via EURUSDT | no USDT fallback; USDT unpriced when CoinGecko fails (existing "no rate" treatment) | 5 |
| P15 | weight headers of each new endpoint, the weight of `myTrades` with `orderId` | caps of section 5 | caps alone bound the run | 8-12 |
| P15b | probe 3, a hard gate before set 11 (C-NR7): `symbol` + `orderId` + `fromId` page an order's fills by id (pages of 1000 until a short page) | the re-read pages by `fromId` | stop and ask the coordinator before set 11 (also when untestable, for example no spot order on the account) | 11 |
| P16 | `walletType` of non-BTC deposits | 0 Spot, 1 Funding, else stop | stop owes the record | 6 |

### NEEDS RULING

C-NR1 ... C-NR7 are ruled (section 1); C-NR2 is confirmed by the user; C-NR3 is final after
probe 2; C-NR4 and C-NR6 are not needed while P15b holds (C-NR7). None is open; set 11 waits only
on its probes (P1, P3, P15, and P15b in probe 3).
