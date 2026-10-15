# Crypto exchanges 1.3: shared exchange layer and multi-coin Binance (1.3-a)

Date: 2026-10-15. Status: draft for user approval. Rulings: `.superpowers/sdd/binance-multicoin/rulings.md`
(cited below as R-Scope, R-Q3 ... R-Q16, R-Tech). Base: branch `binance-backfill-fix`, HEAD 4ece02bf
(main ecda6f75 merged). Track: `crypto-exchanges-1.3-a`.

Every code fact below names a symbol or an anchor text, never a line. The base moves: the developer
re-greps every fact on the actual base before relying on it.

Inputs: `rulings.md`, `brainstorm.md`, `brainstorm-ops.md`, `research-binance-api.md`,
`research-binance-ops.md`, `research-exchanges.md`, `research-bybit.md` (same folder); the specs
`2026-10-09-binance-pay-history-design.md` (cited as "the history spec") and
`2026-09-04-crypto-btc-sync-design.md`; the inventory probe output
`memory/refs/binance-inventory-probe-output-2026-10-15.txt` (main checkout).

## Problem

Kiko reads one coin from Binance. `BINANCE_ASSET = 'BTC'` filters the balance reads
(`binance.provider.ts`: `spotSatoshis`, `fundingSatoshis`, `positionSatoshis`) and every history
walk (capital `coin=BTC`, Pay `isBtcFunds`, Transfer `record.asset !== BINANCE_ASSET`, Earn
`asset=BTC`). The user's own account holds USDT too: 41 of 46 Pay orders, one of three
withdrawals and the one Convert (UAH to USDT) are USDT (inventory probe, 2026-10-15). None of them
reaches Kiko. Trades, Convert, P2P, fiat orders, card buys, dust and distributions are not
imported for any coin. USDT is stored at scale 2 (`currencyScale.USDT`), while Binance reports 8
decimals, so sub-cent USDT amounts round away. The provider list is closed
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

`node harness/kiko/scripts/run-log.mjs stats --gaps --repo kiko` (read 2026-10-15). This spec
closes none of them.

| Gap | Relation to 1.3-a |
|---|---|
| `20261015T0112-kiko-harness-h7/1` (Stryker Timeout on widely imported files counts as detected) | OPEN, and it bites here: sets 2, 3, 5 and 7-11 change the shared walk and paging files (`binance.history-paging.ts` has 83 importing test files). Their mutation scores over-read on those files until the user picks a fix. Each BATCH READY of such a set names the Timeout count of the shared files |
| `20261015T1035-kiko-release-1-2/1` (1.2 export drops `untracked_counterpart`) | OPEN. Same class as the new `operation` column (set 6): a `.kiko` from a build without the column restores it as null. Set 6 adds the back-compat case; the 1.2 note itself stays with scribe |
| `20261013T2223-kiko-harness-h5/4`, `/5`, `/6`; `20261014T0952-kiko-harness-h7/1`; `20261015T0021-kiko-harness-h7/1`; `20261015T0639-kiko-harness-h7/1` | OPEN, unrelated (harness width rules, deferred minors, harness repo sync, app guard rules) |

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
| R-Out | Out: futures, margin, options (one-leg transfers as today), Binance Card and Gift Card (no API), Crypto Loans, ETH/SOL staking, Mining, NFT, copy trading, Dual Investment, sub-accounts. Auto-Invest is the first follow-up. Each exchange holding shows a short not-listed note | 1, 6 |
| R-Map | trade/Convert/dust = Exchange pair; P2P and card buy = one crypto row with a `p2p:<FIAT>` / `card:<FIAT>` untracked counterpart and the fiat total in the note; dividends = income rows (allowlisted types); one nullable `operation` label column (ADD COLUMN migration, reviewer) | 5, 6 |
| R-Q11 A | One Exchange pair per ORDER (fills summed) | 5, 6 |
| R-Q13 | "Subtract trading fee from the amount received": no fee row, no "Fees" spending; the received leg is net. Fee in a THIRD coin (BNB): a small negative row on that coin's holding, linked to the same exchange pair id, kept OUT of spending | 5, 6 |
| R-Q12 A | Withdrawals keep counting as spending unless linked by hand (no change) | 6 |
| R-Q14 A | The bank debit of a P2P buy / card buy / fiat deposit is matched at statistics read time and kept out of spending; nothing rewritten; an unmatched debit still counts | 6 |
| R-Q16 A | "Earlier history: <amount>" line at the bottom of each exchange holding's list (live balance minus imported rows) + the not-listed note; no fake row; statistics unchanged | 6 |
| R-Q10 | "How banks are connected today": an "Exchange or wallet" picker field in the account form (catalog bottom sheet + not-affiliated caption), the exchange's key form inline below; the same sheet from the account detail; an exchange catalog stored in `bankId` (no migration); an exchange provider registry replaces the closed lists; one Keychain entry per exchange per account | 8 |
| R-Tech | Shared layer now with Binance first; history read account-wide; today's BTC keys byte-identical; new coins' Pay keys add the currency; migration 0044 frozen, `.kiko` restore keeps the frozen 1.0 list; LD* skipped in Spot; 2 SPKI pins per new host; walk state in a `sync_state` JSON column; one budget lane and cursor per new history read; every history read after the balance read, never failing it; exclusion only by stored markers; en + uk with translator review; privacy policy and App Privacy label per exchange. 14 change sets; sets 7-11 wait for probe 2 | all |

### Rulings this spec reverses from the history spec

Each reversal has a "was:" column in its scenario matrix (section 7).

| Earlier rule | Source | Now |
|---|---|---|
| BTC only; other coins never read | crypto BTC sync spec; history spec "Goal" | every curated coin and fiat (R-Q3, R-Q15) |
| Convert deferred: no wallet field (D7) | history spec D7 | Convert imported (R-Q9); the wallet rule is probe P4 and NEEDS RULING NR3 |
| Trades out of scope | history spec "Scope" | spot trades imported (R-Q9, R-Q11, R-Q13) |
| A non-BTC Pay order paid with BTC stops (`pay-btc-funded-other-coin`, user ruling A2 2026-10-10) | history spec P9, Q8 | one row per debited coin (R-Q7) |
| `currencyScale.USDT` = 2 | `currency.ts` | 8 (R-Q5) |
| Default names "Binance Spot/Funding/Earn" | `WALLET_HOLDING_NAMES` | "Binance <Wallet> · <COIN>" (R-Q6) |
| The caption shows for null/behind cursors and a Transfer owed range only (OVERNIGHT 20 = B) | history spec section 8 | also while a backfill range is owed (R-Q8) |

### Scope

In (1.3-a): the shared layer (section 2); the curated coin registry and stablecoin precision
(section 3); per-coin and fiat holdings (section 4); the history streams of section 5 on every
curated coin and fiat; row mapping, `operation` column, matcher, "Earlier history" and the
not-listed note (section 6); migration of BTC state and the backfill (section 7); the connect flow
(section 8); compliance (section 9); copy (section 10).

Out: R-Out, plus Bybit itself (1.3-b, its own spec; section 2 fixes the contract it must fit).
Not possible (API limits, not choices): Pay older than 18 months, transfers older than 179 days,
P2P older than 6 months, dust beyond the last 100 records, Binance Card spending (no API). The
"Earlier history" line shows the gap; the not-listed note names it.

### Release rule (App Store 2.3.1(a), the repo's "5.6 no hidden features")

- 1.3-a ships only with all 14 change sets merged and verified on the user's device with the user's
  own read-only Binance key (R-Scope). There is no flag, no `SHOW_*`/`HIDE_*`/`ENABLE_*` control,
  no catalog entry for an exchange that is not complete (kiko-architecture "Guideline 5.6 - no
  hidden features"; Semgrep `kiko-no-hidden-feature-flag-or-demo-import`).
- Bybit gets a catalog entry only in the change set that completes it (1.3-b). If 1.3-b misses the
  1.3 cut, 1.3 ships 1.3-a alone and Bybit moves to 1.3.x.
- Every feature is reachable by the reviewer: the demo `.kiko` shows the curated coins as manual
  holdings, and the Notes for Review say how a credential-bound feature is reached (section 9).
- Apple names hidden, dormant or undocumented features in Guideline 2.3.1(a); the repo calls the
  rule "5.6" after the build 7 rejection text. Scribe aligns the skill wording in set 14 (research
  note in `research-binance-api.md`, "App Store").

## 2. The shared exchange layer

### Units (new folder `src/crypto-sync/exchange/`, one subfolder per unit, each with a barrel)

| Unit | Contents | Moves from |
|---|---|---|
| `exchange/registry/` | `ExchangeId` (`'binance'` in 1.3-a), `ExchangeProvider` type, `exchangeProviderRegistry: Partial<Record<ExchangeId, ExchangeProvider>>`, `isExchangeId` | replaces `balanceProviderIds`'s Binance arm, `providerDisplayName`'s Binance arm, `disconnectMessage`, the `isBalanceProviderId` branch of `syncJobsFor` (`src/sync/sync-jobs/sync-jobs.ts`) |
| `exchange/credentials/` | `ExchangeCredentials = { apiKey: string; secret: string; passphrase?: string; region?: string }`; `credentialServiceFor(exchangeId, accountId)` = `kiko.<exchangeId>.credentials.<accountId>`; save/load/clear over `react-native-keychain` with the shared `hardenedFor` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no access control) | `binance.credentials.ts` (`serviceFor`, `BINANCE_CREDENTIALS_SERVICE`): the Binance service string stays byte-identical |
| `exchange/signing/` | `SignRequest = (request: UnsignedRequest, credentials, nowMs) => SignedRequest` (query, headers, body). Binance: HMAC-SHA256 hex over the query, `X-MBX-APIKEY` header | `binance.hmac.ts`, the signing part of `signedRequestPage` |
| `exchange/hosts/` | `ExchangeHost = { exchangeId; region: string; baseUrl: string }`; `hostsOf(exchangeId)` in try order; Binance: one host `api.binance.com` | `@env` host of `binance.client.ts` (re-grep the host constant) |
| `exchange/budget/` | `RunBudget<Lane>`: per-lane call caps, narrowing calls, keeps, `canAfford(lane, cost, keep, narrowing)`, `record(lane, page, narrowing)`; `WeightModel` per exchange (which headers, which ceilings, per-call cost kinds); one `RequestGate` per run; `createExchangeRun(clock, model)` | `binance.history-budget.ts` (shape); Binance numbers stay in `binance.history-budget.ts` |
| `exchange/paging/` | `Pager` interface (below); `offsetPager` (today's `fetchAllByTotal` + `readSeriesSpan` + span halving); `idCursorPager` (set 9) | `binance.history-paging.ts` |
| `exchange/walk/` | the walk engine: `planWalkPasses`, `runWalkPlan`, `walkSpans`, `buildWalkWindows`, owed ranges and points, range cursor, span hints, `settleRecords`, `commitSettledSpan`, `placeWalletRows`, depth guards; `WalkStop` codes generic, exchange codes added per exchange | `binance.history-walk.ts`, `binance.history-records.ts`, `binance.history-depth.ts` (constants become a per-exchange `DepthConfig`), `binance.walk-write-deps.ts` |
| `exchange/walk-state/` | `ExchangeState` type, its strict parse, readers and the gated writer over `sync_state.exchange_state` (set 3) | the walk-owned metadata keys of `holding-metadata.ts` (`binanceWalkCursorFields`, `binanceWalkPendingFields`, `binanceWalkPointCursorFields`, `binanceWalkRangeCursorFields`, `binanceWalkSpanHintFields`) and `holdingsRepo.setBinanceWalkCursor`, `setBinanceWalkPending`, `setBinanceWalkSpanHints`, `resetBinanceWalkCursors` |
| `exchange/history-status/` | `isExchangeHistoryBehind(state, latestSyncedAt)`, `untrackedCoinsOf(state)` | `screens/account-detail/crypto-sync-section/binance-history-status.ts` (`walkCursorsOf`, `transferOwesRange`, `isBinanceHistoryBehind`) |
| `exchange/amounts/` | `exchangeMinorUnits(currency, text): Either<AmountError, number>`: exact decimal string to minor units through `src/currency/decimal/decimal.ts`, refusing more decimals than the scale (`amount-precision`) and a result above `Number.MAX_SAFE_INTEGER` (`amount-too-large`) | replaces `btcSatoshis` (`binance.history-walk.ts`) and `sumSatoshis`/`Money.fromMajor(BINANCE_ASSET, Number(...))` in `binance.provider.ts` |

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
  credentialExpiry?: (accountId: string) => Promise<number | null>; // Bybit: 90-day keys
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
- `idCursorPager` (set 9): a series has an id cursor, not a time window. `readFrom(series,
  fromId, budget)` reads pages of `limit` ascending by id until a short page or the lane cap; it
  returns the records and the next `fromId`. No halving. Binance `myTrades` uses it; Bybit's
  `nextPageCursor` reads get an opaque-cursor pager on the same interface in 1.3-b.

### Walk state in `sync_state` (set 3)

One nullable JSON column `sync_state.exchange_state` per account (R-Tech). Shape (strict parse;
an unparsable value reads as empty state and logs `exchange-state-malformed`, like
`pending-malformed` today):

```ts
type ExchangeState = {
  version: 1;
  walks: Partial<Record<WalkId, WalkMarks>>;   // WalkId = 'capital' | 'pay' | 'transfer' | 'earn'
                                              //  | 'convert' | 'dust' | 'dividend' | 'p2p'
                                              //  | 'fiatOrders' | 'fiatPayments'
  trades?: { symbols: Record<string, { fromId: number | null }>;
             rotation: number; balanceSnapshot: Record<string, string> };
  untrackedCoins?: string[];                  // tickers, last good balance read
  oversizedCoins?: string[];                  // tickers refused as amount-too-large
};
type WalkMarks = {
  cursor: number | null; rescan?: number; pending?: OwedRange[]; pointCursor?: number;
  rangeCursor?: number; spanHints?: SpanHint[]; multiCoinSince?: number;
};
```

`OwedRange` and `SpanHint` are today's shapes plus an optional `scope: 'backfill'` on a range
(section 7). The writer `syncStateRepo.patchExchangeState(accountId, exchangeId, patch)` runs in one
`db.transaction()`, re-reads the row, and writes only while `accounts.institution` is still
`exchangeId` (today's `institution = 'binance'` gate of `setBinanceWalkCursor`).

### History-behind caption

`isExchangeHistoryBehind` is true, after the account's first balance sync, when any walk's cursor
is null or more than a day behind `latestSyncedAt`, when the Transfer walk owes a range, when any
walk owes a `scope: 'backfill'` range, or when a trade symbol in the candidate set has a null
`fromId`. An owed point never shows it. The caption names the exchange
(`accountDetail.exchangeHistoryPending`, section 10).

### Stays Binance-specific (`src/crypto-sync/binance/`)

Client and endpoint parsers (`binance.client.ts`, `binance.history-client.ts`), HMAC key header,
cooldown (`binance.cooldown.ts`), credentials field UI (`BinanceCredentialsField`), holding keys and
wallet maps (`binance.holding-keys.ts`, `walletOf`, `walletType` maps), each walk file (capital,
Pay, Transfer, Earn, and the new Convert, dust, dividend, trades, P2P, fiat walks), the lane numbers
and `COSTS`, the depth constants and error codes (-5026, 403004), the Pay direction and placement
rules, the Earn reward key.

### The contract Bybit (1.3-b) must fit

The Bybit facts (`research-bybit.md`) shape these parts of the layer; Bybit's own spec designs the
rest.

| Bybit fact | Layer part that carries it |
|---|---|
| A key with no IP binding expires after 90 days (`/v5/user/query-api` `expiredAt`) | `ExchangeProvider.credentialExpiry`; the account detail shows the days left and, after expiry, the existing invalid-credentials "reconnect" state |
| `api.bybit.eu` refuses personal keys (error 81007); regional hosts .com/.bytick/.tr/.kz/.ge/.ae/.id/.nl, Japan, HK | `ExchangeCredentials.region`, `hostsOf` in try order, a typed region refusal with its own copy; every host pinned (2 SPKI pins each) |
| HMAC-SHA256 hex in `X-BAPI-*` headers; clock skew 10002 | `SignRequest` returns headers; a typed clock-skew error per exchange |
| Ledger `/v5/account/transaction-log`: 7-day windows, 2 years back, UNIFIED only, `nextPageCursor` | per-series window length and floor (already per walk); the opaque-cursor pager on `Pager` |
| Earn yield only 3 months back | per-series floor |
| 600 requests per 5 s per IP, per-UID per route, `X-Bapi-Limit*` headers | `WeightModel` (request counts per window instead of weights) |
| Wallets UNIFIED and FUND, Earn positions | holding key `<COIN>[:wallet]` under its own metadata field (`bybitAsset`) |

## 3. Currency model

### Curated coin registry (`src/currency/coins/coins.ts`, new)

`Currency` stays a closed union: `currencyOptions` lists every curated code literally in its crypto
block, after the fiat block (R-Q3). The registry is
`curatedCoins: Readonly<Record<CryptoCurrency, CoinEntry>>`:

| Field | Meaning |
|---|---|
| `code` | the exchange ticker, equal to the `Currency` code (BTC, USDT ...) |
| `scale` | decimals stored; at most 8 |
| `symbol` | display symbol (`₿`, `Ξ`, `₮`) or the code itself |
| `coinGeckoId` | the curated CoinGecko id, verified on `/coins/{id}` at curation |
| `binanceSymbol` | the Binance spot symbol against USDT for the price fallback (`BTCUSDT`); absent for USDT |
| `dustBelow` | a decimal string; a balance under it creates no new holding (section 4) |
| `maxUnits` | the largest plausible balance; the registry test asserts `maxUnits x 10^scale <= Number.MAX_SAFE_INTEGER` |

`cryptoCurrencies`, `CryptoCurrency`, `currencyScale`'s crypto entries, `currencySymbol`'s crypto
entries and `cryptoCoinGeckoId` (`src/rates/coingecko-ids/coingecko-ids.ts`) derive from the
registry; no second hand-written crypto list remains. `currencyNames.<CODE>` gains an en and a uk
name per coin (`currency-names.i18n.test.ts`).

Initial list rule (R-Q4), fixed in set 1's commit with its curation date and source:
1. the user's own coins from the inventory probe (BTC, USDT);
2. the top 30 by market cap from CoinGecko `/coins/markets` on the curation day, minus:
   stablecoins other than the four below; wrapped, bridged and liquid-staking tokens (WBTC, WETH,
   stETH, wstETH, weETH, WBETH, BNSOL, cbBTC and the like; R-Out staking); coins with no Binance
   spot market against USDT; codes that collide with a fiat code in `currencyOptions`;
3. USDT, USDC, FDUSD, DAI;
4. BNB is on the list (dust and BNB fees depend on it); if it ever falls out of the top 30, it is
   kept by this rule.

Adding a coin later: one change with the code in `currencyOptions`, the registry entry (scale from
Binance `exchangeInfo` `baseAssetPrecision` capped at 8, the verified CoinGecko id, `binanceSymbol`,
`dustBelow` near 1 USD at the curation price, `maxUnits`), en + uk names (translator review), and an
app release. A registry test pins: keys equal to the crypto block, unique CoinGecko ids, scale at
most 8, the safe-integer inequality, and a `binanceSymbol` ending in `USDT` on every coin but USDT.

### Stablecoin precision and the USDT rescale (set 1, migration 0059)

USDT, USDC, FDUSD and DAI use scale 8 (R-Q5). USDC, FDUSD and DAI are new codes with no stored
data. USDT's existing data rescales by exactly `10^6`:

| Stored value | Rescale |
|---|---|
| `holdings.balance_minor_units`, `holdings.synced_balance_minor_units` where `currency = 'USDT'` | `x 1000000` |
| `transactions.amount_minor_units` of every row on a USDT holding | `x 1000000` |
| minor-unit fields in `holdings.metadata` of a USDT holding (every `*MinorUnits` field of `holding-metadata.ts` and `lots.ts`: contributions, principal, purchase price, face value, lot costs) | `x 1000000`, via `json_set` |
| `category_rules.matchers` amount matchers with `currency = 'USDT'` (`category-rules.d.ts`) | `minorUnits x 1000000`, via `json_each`/`json_set` |
| `transaction_templates.draft` amounts on a USDT holding or in currency USDT (`template-draft.ts`: `amountMinorUnits`, `returns[].amountMinorUnits`, `valueInMinorUnits`) | `x 1000000` |
| `price_points` with `currency = 'USDT'` | none: `price` is a major-unit decimal string, valued through `multiplyToMinorUnits` at the currency's scale, so its minor-unit value rescales by itself. The parity test pins it |
| `currency_rates`, `currency_rate_history` rows `USDT:UAH` | none: a rate is per unit, scale-free |

The developer re-greps every `MinorUnits` field in `src/db/schema.ts`, `holding-metadata.ts`,
`template-draft.ts`, `category-rules.d.ts`, `lots.ts` and any JSON shape added since, and the
migration test lists each one. Crash-safe: the runner applies the whole file and its bookkeeping
row in one transaction, so a crash leaves 0058 to retry whole.

`.kiko` import: `EXPORT_VERSION` (`src/data-transfer/crypto/envelope.ts`) becomes 4 and
`READABLE_EXPORT_VERSIONS` `[1, 2, 3, 4]`. A restore of a version 1-3 file applies the identical
rescale before insert (`withUsdtRescaled` in `restore-snapshot.ts`, the same table of fields); a
version 4 file restores as is. A two-path test proves migration and restore agree.

Bound: at scale 8 a value fits a JS number exactly up to 90,071,992.54740991 units. The rescale is
exact for every stored USDT value within that bound; the test pins a value at the bound.

### Safe-integer bound and the visible error

Every exchange amount goes through `exchangeMinorUnits` (section 2). A balance or row above the
bound is never truncated: the balance write for that holding is skipped (the last good balance
stays), the row is a per-record stop owed at its point, the ticker joins
`exchange_state.oversizedCoins`, and the account detail shows `accountDetail.oversizedAmount`
(section 10). A balance with more decimals than the coin's scale (probe P10) rounds half away from
zero and logs the fixed tag `balance-precision-rounded`; a ROW with more decimals is a per-record
stop (`amount-precision`), never rounded.

### Prices

- CoinGecko by curated id (R-Q4, R-Tech): `fetchCryptoPrices` (`src/rates/coingecko/coingecko.ts`)
  asks for the held coins' ids in one call and returns a per-coin result. A coin missing from the
  answer is unpriced; every other coin keeps its price (closes the "Crypto price all-or-nothing"
  debt). `buildUahRows` writes one `X:UAH` row per priced coin.
- Fallback for a coin CoinGecko did not price (set 4): Binance public market data on the pinned
  host, no key sent. Current: `GET /api/v3/ticker/price?symbol=<binanceSymbol>` (weight 2). Dated
  history: `GET /api/v3/klines?symbol=<binanceSymbol>&interval=1d` (weight 2, up to 1000 days per
  call). The USDT-quoted price converts through USDT's own price; when USDT itself is unpriced,
  USDT's price comes from `EURUSDT` (probe P14) and the EUR fiat anchor. Never 1:1 for any
  stablecoin. Calls count against the `/api/*` IP budget (section 5).
- History backfill per new coin: one call per coin, capped per run as today
  (`src/rates/history-backfill/history-backfill.ts`).
- A coin with no price from either source stays visible at its coin amount and is left out of net
  worth with the existing "no rate" treatment (`net-worth-view.ts`).

### Not-tracked coins, LD* tokens, picker, 0044

- A non-zero balance of a coin outside the registry gets no holding, no row and no price. Its
  ticker is stored in `exchange_state.untrackedCoins` at each good balance read and listed on the
  account detail (`accountDetail.untrackedCoins`). A history record of such a coin imports no row;
  a pair with one untracked side keeps the tracked leg (section 6).
- LD* (R-Tech, probe P9): an asset whose code is `LD` + X, where X is a curated code or an asset in
  this run's Simple Earn positions, is an Earn receipt token. It is skipped in Spot (Earn is read
  from the Earn endpoints) and never priced. `LDO` and other real coins starting with LD pass,
  because the rest of their code is neither.
- Picker (R-Picker): `CurrencyField` and `holdingCurrencyOptions` list every curated coin for a
  `crypto_asset`; the base-currency setting keeps offering fiat only.
- Migration 0044 stays frozen. `withCryptoCashHoldingsMoved` (`restore-snapshot.ts`) switches from
  `!isFiat` to a constant `FROZEN_1_0_CRYPTO_CODES = ['BTC', 'ETH', 'USDT']`; the test that failed on
  purpose (`0044-move-crypto-cash-holdings.test.ts`) asserts the constant equals the SQL's `IN` list.

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
| Dust | `GET /sapi/v1/asset/dribblet` | last 100 records, after 2020-12-01 | none | IP 1 | 1 | `walks.dust` (cursor = newest `operateTime` imported) | P7 |
| Dividends | `GET /sapi/v1/asset/assetDividend` | 180 d / probe (3 years read) | `limit` 500, none: a full page halves | IP 10 | 10 | `walks.dividend` | P8 |
| P2P | `GET /sapi/v1/c2c/orderMatch/listUserOrderHistory`, `tradeType` BUY and SELL (2 series) | 30 d / 6 months | `page`/`rows` 100 | IP 1 | 10 | `walks.p2p` | P5 |
| Fiat orders | `GET /sapi/v1/fiat/orders`, `transactionType` 0 deposit, 1 withdraw (2 series) | probe / probe | `page`/`rows` 500 | UID 45000 | 3 | `walks.fiatOrders` | P6 |
| Fiat payments | `GET /sapi/v1/fiat/payments`, `transactionType` 0 buy, 1 sell (2 series) | probe / probe | `page`/`rows` 100 | IP 1 | 10 | `walks.fiatPayments` | P6 |
| Spot trades | `GET /api/v3/myTrades?symbol=&fromId=` per symbol | none (id cursor) / probe | `fromId`, 1000 | IP 20 (`/api/*`) | 100 calls | `trades.symbols[s].fromId` | P1, P2, P3 |
| Symbol list | `GET /api/v3/exchangeInfo` (public) | - | - | IP 20 (`/api/*`) | 1 per run | - | P2 |

The lane caps are starting values. Set 10 measures a caught-up run and a backfill run on the
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
- A funds entry in an untracked coin imports no row; its ticker joins the not-tracked line.
- A receive imports one row in the order's coin (funds describe the payer side).
- Keys: a BTC-funded row of a BTC order keeps
  `${accountId}:pay:${orderType}:${transactionId}:${walletType}` byte-identical; every other row
  is `...:${walletType}:${currency}`.
- Stops `pay-btc-funded-other-coin` and `pay-funds-not-btc` are removed.

### Transfer, Simple Earn

Transfer: the filter `record.asset !== BINANCE_ASSET` goes; keys already carry the wallet key with
the asset. Earn: `asset=` dropped; subscription/redemption keys carry the wallet key; the reward
key of a non-BTC reward appends `:${asset}` (BTC reward keys byte-identical). Probe P11 confirms
whether `productId` is per asset; the rule holds either way.

### Convert

Settled: `orderStatus === 'SUCCESS'`; `PROCESS`/`ACCEPT_SUCCESS` owe their point; `FAIL` ignored.
One Exchange pair per `orderId`: `fromAsset -fromAmount`, `toAsset +toAmount`, both on the
Convert wallet (probe P4; NR3). Pair id `${accountId}:convert:${orderId}`; leg keys
`${pairId}:<walletKey>`. No fee field (the fee is in the rate). A fiat side (UAH, EUR) is a fiat
holding leg.

### Dust

One read, no params, every run (cap 1). Per `userAssetDribbletDetails` entry with `operateTime`
after the cursor: an Exchange pair `fromAsset -amount` (Spot) / BNB `+received` (Spot), where
`received` = the BNB that entry added to the wallet (`transferedAmount`, net of
`serviceChargeAmount` per probe P7). Pair id `${accountId}:dust:${transId}:${fromAsset}`. An
untracked `fromAsset`: the BNB leg alone with `untrackedCounterpart = asset:<fromAsset>`. Records
beyond the last 100 are lost; the not-listed note names them.

### Dividends

Rows import only for an allowlisted `enInfo` value (probe P8 builds the allowlist; values that
overlap the Earn walk's rewards are never on it). `amount` on the credited wallet (probe P8;
default Spot), `operation = 'reward'`, key `${accountId}:dividend:${id}`. A row off the allowlist
is skipped and counted under the fixed tag `dividend-type-skipped`, never owed. `enInfo` is never
stored or parsed for money.

### P2P

Only `orderStatus === 'COMPLETED'` imports; `CANCELLED` and similar are ignored; an open status
owes its point until final or the 6-month floor drops it. BUY: `+amount asset` on the Funding
holding (probe P5); SELL: `-amount`. Amount = the wallet's change (probe P5 confirms whether
`amount` is net of `commission`; until confirmed, an order with a non-zero `commission` is a stop
owed at its point). `untrackedCounterpart = p2p:<fiat>`; `comment` = `<totalPrice> <fiat>`;
`operation = 'p2p'`. No counterparty field is read into a type (privacy, section 9). Key
`${accountId}:p2p:${orderNumber}:<walletKey>`.

### Fiat orders (deposit, withdraw) and fiat payments (card buy, sell)

- Fiat orders: settled status per probe P6 (default `Successful`); deposit `+amount` on the
  fiat holding of the credited wallet (probe P6; default Spot), withdraw `-(amount + fee)` as the
  wallet moved (probe P6). `untrackedCounterpart = bank:<fiat>`, `operation = 'fiat'`, `comment` =
  `<indicatedAmount> <fiat>` (the gross the bank side paid). Key
  `${accountId}:fiat:${orderNo}:<walletKey>`.
- Fiat payments: settled `Completed`. Buy: `+obtainAmount cryptoCurrency` with
  `untrackedCounterpart = card:<fiatCurrency>`, `comment` = `<sourceAmount> <fiatCurrency>`.
  Sell: `-sourceAmount cryptoCurrency`, same code, `comment` = `<obtainAmount> <fiatCurrency>`.
  `operation = 'card'`. Wallet per probe P6 (default Spot). Key
  `${accountId}:fiatpay:${orderNo}:<walletKey>`.

### Spot trades (R-Q11, R-Q13)

- Symbol discovery (set 9): once per run, public `exchangeInfo`; candidates = every `TRADING` or
  `BREAK` symbol whose base and quote are both in (coins the user touched) union (main quotes:
  USDT, USDC, FDUSD, BTC, ETH, BNB, EUR, TRY). Touched = any asset with a non-zero balance (tracked
  or not) or seen in any imported history record, or a symbol with a stored `fromId`. A coin fully
  sold before 1.3 and seen nowhere else is not found: the not-listed note names it.
- Rotation: a symbol is read this run when its base or quote balance changed since
  `trades.balanceSnapshot`, when its `fromId` is null, or when its turn comes in the round-robin
  from `trades.rotation`; each of `S` candidate symbols is read within `ceil(S / L)` runs, `L` the
  lane's calls left for rotation (memory "round-robin rotates units read"; property test).
- Paging (`idCursorPager`): `fromId` = the stored cursor, else 0; no time parameters (probe P1).
- Orders: fills group by `orderId`. The cursor stores the first trade id of the newest order in
  the batch, so that order's fills are read whole again next time (a partial fill later refreshes
  the amounts through `addManyDedup`). An order whose fills fill a whole page pages on; past the
  lane cap it is a stop owed at its point.
- Rows per order, Spot wallet: spent leg = sum of `quoteQty` (buy) or `qty` (sell), negative;
  received leg = sum of `qty` (buy) or `quoteQty` (sell) minus every commission in the received
  coin. Commission in a third coin (BNB): one row `-sum(commission)` on that coin's Spot holding,
  `exchangePairId` = the order's pair id, `exchangeCounterpartHoldingId` = the received leg's
  holding, `operation = 'trade-fee'` (R-Q13 default). A third coin that is untracked: no fee row,
  its ticker joins the not-tracked line. Commission in the spent coin: NR2 (until ruled, the order
  is a stop owed at its point).
- One side untracked (USDT -> PEPE): the tracked leg alone, `untrackedCounterpart = asset:<CODE>`.
- Pair id `${accountId}:trade:${symbol}:${orderId}`; legs `${pairId}:<walletKey>`; fee
  `${pairId}:fee:<walletKey>`. Time = the order's first fill time. `operation = 'trade'` on every
  leg.

## 6. Row mapping and statistics

### The `operation` column (set 6, migration 0061)

`ALTER TABLE transactions ADD operation text` (nullable, no index, no backfill; R-Map). Codes:
`trade`, `trade-fee`, `convert`, `dust`, `p2p`, `card`, `fiat`, `reward`. Insert-only (not in
`BANK_OWNED_TRANSACTION_COLUMNS`), exported by the snapshot (every column), restored as null from
an older file. It labels; it never decides statistics.

### Untracked-counterpart codes (no migration)

`src/transactions/untracked-counterpart/untracked-counterpart.ts` gains the prefixes `asset:<CODE>`,
`p2p:<FIAT>`, `card:<FIAT>`, `bank:<FIAT>` beside `wallet:<TYPE>`, each with a parser; an unknown
code still renders the default label. `exchangeExcludedTransactionIds` already excludes any row
with a code. (NR1 may extend the `p2p:`/`card:`/`bank:` code with the fiat total.)

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
| Spot trade | pair per order, received net of fee | counterpart + pair id; `trade` | excluded |
| Trade fee in third coin | `-` on fee coin | counterpart (received leg's holding) + pair id; `trade-fee` | excluded |
| Trade, one side untracked | tracked leg | `asset:`; `trade` | excluded |
| Dust | pair per source coin | counterpart + pair id; `dust` | excluded |
| Dust, source untracked | BNB leg | `asset:`; `dust` | excluded (positive anyway) |
| Dividend / airdrop | `+` | `reward` | none |
| P2P buy | `+` crypto | `p2p:`; `p2p`; `comment` fiat total | none; the bank debit per the matcher |
| P2P sell | `-` crypto | `p2p:`; `p2p` | excluded |
| Card buy | `+` crypto | `card:`; `card` | none; the card charge per the matcher |
| Card sell | `-` crypto | `card:`; `card` | excluded |
| Fiat deposit | `+` fiat holding | `bank:`; `fiat` | none; the bank debit per the matcher |
| Fiat withdraw | `-` fiat holding | `bank:`; `fiat` | excluded |

### Read-time bank-debit matcher (R-Q14, set 12)

A pure function `exchangeFundingMatchedIds(ledger)` in `src/statistics/exchange-funding-match/`,
unioned in `statistics.screen.tsx` with the other exclusion sets; nothing is written.

- Exchange side: rows with a `p2p:` or `card:` code and a positive amount, and rows with a `bank:`
  code and a positive amount; each needs its fiat currency (from the code) and its fiat total
  (source: NR1).
- Bank side: negative rows on holdings of non-crypto accounts, in that fiat currency, not already
  excluded by any other rule.
- Match: the bank amount equals minus the fiat total, exactly in minor units, and the bank row's
  time is inside the window: P2P `[t - 1 h, t + 2 h]`, card `[t - 1 day, t + 3 days]`, fiat deposit
  `[t - 5 days, t + 1 h]`, `t` = the exchange row's time (named constants).
- One-to-one: candidate pairs sort by absolute time gap, then bank row id, then exchange row id;
  each row matches once. An unmatched debit counts as spending.

### "Earlier history" line and not-listed note (R-Q16, set 14)

Holding detail of an exchange-synced holding: under the list, `holdingDetail.earlierHistory` with
`balance - sum(rows of the holding)` in the holding's currency, shown when that is not zero; then
the exchange's not-listed note (`holdingDetail.exchangeNotListed.binance`). No row, no statistics
effect.

## 7. Migration of BTC state, backfill, scenario matrices

### BTC rows, keys, cursors (no data loss)

- Rows: untouched. Every BTC key keeps its exact form (sections 5 and 6 list the rule per stream).
- Holdings: matched by the same `binanceAsset` keys; names change only from a default (section 4).
- Walk state (set 3, migration 0060): `ALTER TABLE sync_state ADD exchange_state text`, then one
  `INSERT ... ON CONFLICT(account_id) DO UPDATE` per account that has a holding with
  `json_extract(metadata, '$.binanceAsset') = 'BTC'` carrying a walk key, building the JSON with
  `json_object` from each `binance*` walk key (cursor, rescan, pending, point cursor, range
  cursor, span hints per walk; field map pinned by the migration test). Disconnected accounts copy
  too (their floor values stay). The old metadata keys are no longer read; `carriedMetadataKeys`
  stops carrying them, so the next balance sync drops them. Restore mirror: `withWalkStateMoved`
  in `restore-snapshot.ts` applies the same copy to a `.kiko` whose `syncState` rows have no
  `exchangeState`; a two-path test pins equality. No index, so no EXPLAIN QUERY PLAN test.
- Disconnect: `disconnectCryptoAccount` resets `exchange_state` (cursors to the floor, lists empty,
  point/range cursors, hints, trade cursors and coin lists removed), then clears the Keychain item.
  Holdings and rows stay as a manual snapshot.

### Backfill of new coins (R-Q8, sets 5 and 14)

- Set 5: on a walk's first multi-coin run, `walks.<walk>.multiCoinSince` = its cursor at that run.
- Set 14: each of capital, Pay, Transfer, Earn owes one range `[floor, multiCoinSince)` with
  `scope: 'backfill'`, read in the existing round-robin of owed ranges. A read in a backfill range
  imports every coin except BTC; BTC records there are skipped (not re-read into rows). Floors as
  section 5. The caption shows while any backfill range is owed.
- New streams (Convert, dust, dividends, P2P, fiat, trades) start from their own floors with null
  cursors; they need no backfill range.

### Scenario matrices (each row becomes a Jest case)

USDT rescale (set 1; exact parity):

| # | Input (scale 2) | Expected (scale 8) | Valued in UAH | was: |
|---|---|---|---|---|
| U1 | USDT holding 12345 (123.45) | 12345000000 | equal before and after | 12345 |
| U2 | USDT row -1 (0.01) | -1000000 | equal | -1 |
| U3 | USDT price point "41.25" | text unchanged | equal | n/a |
| U4 | rule `amount < 1000 USDT` (100000) | 100000000000 | rule matches the same rows | 100000 |
| U5 | template amount 5000 on a USDT holding | 5000000000 | n/a | 5000 |
| U6 | BTC/EUR holding | unchanged | equal | unchanged |
| U7 | `.kiko` v3 with U1-U5 | as U1-U5 | equal to the migrated database | v3 restored at scale 2 |
| U8 | value at the bound, 9007199254 | 9007199254000000 | exact | - |
| U9 | Binance balance "0.00012345" USDT | 12345 | - | 0 (rounded away) |

Holdings (set 4):

| # | Balance read | Existing holding | Result | was: |
|---|---|---|---|---|
| H1 | Spot USDT 10 | none | "Binance Spot · USDT" = 10 | not read |
| H2 | Spot USDT 0 | exists at 10 | written 0, stays | not read |
| H3 | Spot DOGE below `dustBelow`, no rows | none | no holding | not read |
| H4 | Spot DOGE below `dustBelow` | exists | written | not read |
| H5 | Funding EUR 5.00 | none | "Binance Funding · EUR" = 5.00 | not read |
| H6 | Spot PEPE (not curated) | - | no holding; PEPE in the not-tracked line | not read |
| H7 | Spot LDBTC 0.1, Earn BTC 0.1 | - | Spot skips LDBTC; Earn BTC 0.1 | n/a |
| H8 | Spot LDO 3 (curated or not) | - | read as LDO | n/a |
| H9 | Spot BTC named "Binance Spot" | exists | renamed "Binance Spot · BTC" | "Binance Spot" |
| H10 | Spot BTC named "My BTC" | exists | name kept | kept |
| H11 | Funding read fails | USDT:funding exists | last good balance kept | BTC only |
| H12 | amount above the safe bound | - | no write; oversized line | n/a |

Pay (set 5):

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

Trades (set 10; property tests at clock gaps 0, 1 h, 1 day):

| # | Order (fills) | Commission | Rows | Statistics | was: |
|---|---|---|---|---|---|
| T1 | buy 0.01 BTC for 600 USDT (1 fill) | 0.00001 BTC | USDT Spot -600; BTC Spot +0.00999 | excluded | not imported |
| T2 | same, 3 fills | BTC per fill | one pair, sums | excluded | not imported |
| T3 | same | 0.0005 BNB | pair (BTC +0.01) + BNB -0.0005, same pair id | all excluded | not imported |
| T4 | same | fee coin untracked | pair; ticker not tracked | excluded | not imported |
| T5 | sell 0.01 BTC for 600 USDT | 0.6 USDT | BTC -0.01; USDT +599.4 | excluded | not imported |
| T6 | USDT -> PEPE | PEPE | USDT -x, `asset:PEPE` | excluded | not imported |
| T7 | order partly filled, later filled | - | amounts refreshed, one pair | excluded | not imported |
| T8 | commission in the spent coin | USDT on a buy | stop owed (NR2) | none | not imported |
| T9 | BTC/EUR | EUR | EUR fiat leg | excluded | not imported |

Convert, dust, dividends, P2P, fiat (sets 7, 8, 11):

| # | Record | Rows | Statistics | was: |
|---|---|---|---|---|
| C1 | Convert UAH -> USDT, SUCCESS | UAH fiat -, USDT + (pair) | excluded | not imported (D7) |
| C2 | Convert PROCESS | owed point | none | not imported |
| D1 | dust TRX + DOGE -> BNB | two pairs | excluded | not imported |
| D2 | dust of an untracked coin | BNB +, `asset:` | none | not imported |
| V1 | dividend, allowlisted | `+`, `reward` | none | not imported |
| V2 | dividend, not allowlisted | none, tag counted | none | not imported |
| P1 | P2P BUY COMPLETED, 100 USDT for 4150 UAH | Funding USDT +100, `p2p:UAH`, comment "4150.00 UAH" | none | not imported |
| P2 | P2P SELL COMPLETED | Funding USDT -, `p2p:UAH` | excluded | not imported |
| P3 | P2P CANCELLED | none | none | not imported |
| P4 | P2P with commission, before P5 confirmed | owed point | none | not imported |
| F1 | fiat deposit EUR 100, Successful | EUR +, `bank:EUR` | none | not imported |
| F2 | fiat withdraw EUR 50 | EUR -, `bank:EUR` | excluded | not imported |
| F3 | card buy 0.001 BTC for 2600 UAH | BTC +, `card:UAH` | none | not imported |

Matcher (set 12):

| # | Exchange row | Bank debit | Result |
|---|---|---|---|
| M1 | P2P buy, total 4150.00 UAH at t | -4150.00 UAH at t - 20 min | debit excluded |
| M2 | same | -4150.00 UAH at t - 2 h | counts (outside window) |
| M3 | same | -4150.01 UAH | counts |
| M4 | two P2P buys of 4150.00 | one debit | one match (nearest gap) |
| M5 | card buy 2600 UAH | -2600 UAH at t + 2 days (posting lag) | excluded |
| M6 | fiat deposit 100 EUR | -100 EUR at t - 3 days | excluded |
| M7 | none | -4150.00 UAH | counts |
| M8 | P2P buy | debit in USD for the UAH total | counts |

Withdrawals (R-Q12): W1 a USDT withdrawal counts as spending in the default category (was: not
imported; BTC: same as before). W2 a hand link keeps today's exclusion.

Caption (set 14):

| # | State | Caption | was: |
|---|---|---|---|
| K1 | every cursor current, nothing owed | hidden | hidden |
| K2 | a walk cursor null or more than a day behind | shown | shown |
| K3 | Transfer owes a range | shown | shown |
| K4 | a backfill range owed | shown | hidden |
| K5 | only owed points | hidden | hidden |
| K6 | a candidate trade symbol never read | shown | n/a |

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
  string unchanged. `.kiko` secrets keep `binanceCredentials`; Bybit adds its own entry with a
  version guard in 1.3-b.
- `syncJobsFor`, auto-sync and refresh drive exchanges through the registry; an id with no entry is
  skipped (bank rule).

## 9. Compliance

| Item | 1.3-a |
|---|---|
| Logos (Third-party trademarks) | none; plain-text names and the generic icon; `exchangeDisclaimer` under the picker |
| Network | no new host: Binance public market data uses the pinned `api.binance.com` without a key; CoinGecko unchanged. `check:plist` unchanged. Each new 1.3-b host gets 2 SPKI pins |
| Privacy policy (`docs/privacy-policy.md`, `docs/privacy-policy.en.md` section 3) | Binance paragraph adds: balances of every coin and fiat, trades, Convert, P2P orders (amounts, fiat totals; no counterparty data), fiat deposits/withdrawals and card purchases, dust conversions, distributions; Binance public price data requested without the key |
| App Privacy label | stays "Data Not Collected" (everything stays on device); the review is recorded in `memory/refs/resubmission-kit.md` section D |
| Stored counterparty data | Pay nickname only (D4); P2P `counterPartNickName` and fiat payment method details are never read into a type |
| API terms gate | Binance's Terms of Use and API terms read (URL, date, the clauses on read-only third-party apps) before set 14 merges; recorded by scribe in kiko-compliance. Bybit's terms (PDF in `research-bybit.md`) gate 1.3-b |
| Demo `.kiko` | a crypto account (`institution` null) with manual holdings in at least five curated coins incl. USDT, USDC and a non-top coin (one with a dated price history), and a crypto account with `bankId = 'binance'` so the reviewer reaches the connect field; regenerated (`KIKO_REGEN_DEMO=1`) with each snapshot-shape change |
| 3.1.5 | read-only viewer; the notes state no trading, withdrawal or transfer is possible |

Notes for Review (en, appended to the reviewer kit in set 14):

> Kiko can show a Binance account read-only. The user creates an API key in Binance (API
> Management, "Enable Reading" only) and pastes it in Accounts > Add account > Crypto > Exchange or
> wallet > Binance. The key stays in the iOS Keychain and is sent only to api.binance.com from the
> device; Kiko cannot trade, withdraw or move funds. Without a Binance account, the connect form
> and its "not affiliated" caption are visible on that path, and the demo file (Settings > Import)
> shows crypto holdings in several coins valued from market prices, with their statistics.

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
| `accountDetail.untrackedCoins` | Not tracked: {{tickers}}. Kiko has no price for these coins, so it does not import them. | Не відстежуються: {{tickers}}. Кіко не має ціни для цих монет, тому не імпортує їх. |
| `accountDetail.oversizedAmount` | {{coin}}: the amount is too large for Kiko to store exactly, so it was not imported. | {{coin}}: сума завелика, щоб Кіко зберіг її точно, тому її не імпортовано. |
| `accountDetail.disconnectProviderMessage.binance` (changed) | This clears the connection and the stored API key. Your holdings and transactions stay as a manual snapshot. | (unchanged) Акаунт буде відʼєднано, але ви можете й надалі керувати ним вручну. |
| `holdingDetail.earlierHistory` | Earlier history: {{amount}} | Попередня історія: {{amount}} |
| `holdingDetail.exchangeNotListed.binance` | Not listed: futures, margin and options trades, Binance Card and gift card spending, Auto-Invest, loans, ETH and SOL staking, mining, and records older than Binance keeps. | Не показано: угоди з ф’ючерсами, маржею та опціонами, витрати з Binance Card і подарункових карток, Auto-Invest, позики, стейкінг ETH і SOL, майнінг і записи, старіші за ті, що зберігає Binance. |
| `transactions.tradingFee` | Trading fee | Торгова комісія |
| `transactions.reward` | Reward | Винагорода |
| `transactions.p2pPurchase` / `p2pSale` | P2P purchase ({{currency}}) / P2P sale ({{currency}}) | Купівля P2P ({{currency}}) / Продаж P2P ({{currency}}) |
| `transactions.cardPurchase` / `cardSale` | Card purchase ({{currency}}) / Sale to card ({{currency}}) | Купівля карткою ({{currency}}) / Продаж на картку ({{currency}}) |
| `transactions.bankDeposit` / `bankWithdrawal` | Bank deposit ({{currency}}) / Bank withdrawal ({{currency}}) | Поповнення з банку ({{currency}}) / Виведення в банк ({{currency}}) |
| `help.topics.connectCrypto.steps.2` (changed) | Under "Exchange or wallet", choose "Binance" or "Bitcoin wallet address". | У полі «Біржа або гаманець» оберіть «Binance» або «Адреса гаманця Біткоїн». |
| `accountDetail.sourceLabel` and the `sourceLabels` segment labels of `CryptoSyncForm` | removed with the segmented control (set 13); the developer re-greps their uses | removed |
| `currencyNames.<CODE>` per new coin | the coin's name (USD Coin, First Digital USD, Dai, BNB, ...) | an authored name per coin (proper nouns kept; e.g. «Ефіріум» style) |

Casing follows kiko-translator: sheet titles Title Case in en, sentence case in uk; "Binance",
"P2P", "API" and coin codes are kept as written (`PROPER_NOUNS` gains any new uk case form,
for example «Біткоїн» forms already listed). `exchangeTo`/`exchangeFrom` take a ticker as
`{{name}}` for `asset:` rows; no new key. Holding names and wallet names stay code-side proper
nouns.

## 11. Change sets (track `crypto-exchanges-1.3-a`, 14 tasks)

Rules for every set: each tip ships safe on its own (memory "task tip must be safe"); before its
`make deep`, `KIKO_MUTATION_BASE=<that set's base sha> make mutable` gives the file count, which
must be at most 30 (`MUTATION_FILE_CAP`); the coordinator runs
`KIKO_MUTATION_BASE=<base> make deep` per set, detached; `make verify` runs once at the end of the
track, until green. Walk-touching sets carry property tests at clock gaps 0, 1 h and 1 day; money
sets carry exact-parity tests. A set whose measured count goes over 30 stops and reports; it is
never cut silently. No set adds an index, so no set needs an EXPLAIN QUERY PLAN test; a set that
ends up adding one gets it with its reviewer step.

| Task | Content | Files / areas | Migration | Tests | Probe |
|---|---|---|---|---|---|
| 1/14 | curated registry, stablecoin scale 8, USDT rescale, exact amount parser, per-coin CoinGecko isolation, frozen 0044 list, export v4, coin names, picker | `src/currency/currency/currency.ts`, `src/currency/coins/` (new), `src/currency/decimal/decimal.ts`, `src/rates/coingecko-ids/`, `src/rates/coingecko/`, `src/rates/rates-refresh/`, `src/data-transfer/crypto/envelope.ts`, `src/data-transfer/snapshot/restore-snapshot.ts`, `src/i18n/locales/{en,uk}.ts`, `drizzle/migrations/0059_*.sql` + `migrations.js` + meta, demo seed (~14 mutable) | 0059 USDT rescale; `kiko:reviewer` before BATCH READY | U1-U9; registry invariants; two-path migration/restore; 0044 frozen pin; CoinGecko one-id-missing case | no |
| 2/14 | layer extraction, Binance BTC-only, no behaviour change; `Pager`, `RunBudget`, `WeightModel`, `SignRequest`, credentials and hosts units; `offsetPager` | `src/crypto-sync/exchange/{registry,credentials,signing,hosts,budget,paging,walk,amounts}/` (moves with `git mv` + barrels), `binance.*` importers (~25 mutable; moves and importers in one commit) | none | today's suites green unchanged; a byte-identical key and request snapshot test | no |
| 3/14 | walk state to `sync_state` | `src/db/schema.ts`, `src/sync-state/sync-state.repo.ts`, `exchange/walk-state/`, `holding-metadata.ts`, `holdings.repo.ts`, `disconnect.ts`, `restore-snapshot.ts`, walk readers/writers, `binance-history-status.ts` (~16) | 0060 ADD COLUMN + copy; `kiko:reviewer` | copy field map; two-path restore; institution gate; disconnect reset; walk properties at 0 / 1 h / 1 day | no |
| 4/14 | multi-coin balances, per-coin and fiat holdings, names and BTC rename, LD* skip, not-tracked and oversized lines, Binance price fallback | `binance.provider.ts`, `binance.client.ts`, `binance.holding-keys.ts`, `provider.ts`, `sync.ts`, `holdings.repo.ts` (`renameFromDefaults`), `exchange/history-status/`, `crypto-sync-section.component.tsx`, `src/rates/` fallback (~14) | none | H1-H12; exact sums per coin; one coin missing a price | no (P9, P10, P13, P14 have safe defaults) |
| 5/14 | account-wide capital, Pay, Transfer, Earn; key rules; cross-coin Pay; `multiCoinSince` | `binance.transactions.ts`, `binance.pay-history.ts`, `binance.history-client.ts`, `binance.transfer-history.ts`, `binance.earn-history.ts`, `exchange/walk/` (~10) | none | Y1-Y8; key byte-identity for BTC; key uniqueness property; walk properties at 0 / 1 h / 1 day | no (P11, P12, P16 safe defaults) |
| 6/14 | `operation` column, new code prefixes, render labels, copy | `src/db/schema.ts`, `untracked-counterpart.ts`, `row-description.ts`, `exchange-description.ts`, `transactions.repo.ts`, `src/i18n/locales/{en,uk}.ts`, migration files, demo regen (~9) | 0061 ADD COLUMN; `kiko:reviewer` | label order cases; back-compat import of an export without the column; exclusion unchanged | no (NR1 fixes the code format before this set) |
| 7/14 | Convert walk | `binance.convert-history.ts` (new), `binance.history-client.ts`, `binance.history-budget.ts`, `run-crypto-sync.ts` (~6) | none | C1-C2; window halving on `moreData`; walk properties | yes (P4; NR3) |
| 8/14 | dust and dividend walks | `binance.dust-history.ts`, `binance.dividend-history.ts` (new), client, budget, run wiring (~7) | none | D1-D2, V1-V2; dust cursor; allowlist pin | yes (P7, P8) |
| 9/14 | trades 1/2: symbol discovery, rotation, `idCursorPager` | `exchange/paging/id-cursor-pager.ts`, `binance.trade-symbols.ts` (new), public `exchangeInfo` read, `walk-state` trades part (~7) | none | rotation bound `ceil(S / L)` property; discovery cases; pager pages | yes (P1, P2) |
| 10/14 | trades 2/2: order aggregation, rows, fee rules, `/api/*` IP budget, lane caps measured | `binance.trade-history.ts` (new), `binance.history-client.ts`, `binance.history-budget.ts`, `run-crypto-sync.ts` (~6) | none | T1-T9 exact parity; refresh of a partial order; properties at 0 / 1 h / 1 day; measured run report | yes (P1, P3; NR2) |
| 11/14 | P2P, fiat orders, fiat payments walks | `binance.p2p-history.ts`, `binance.fiat-history.ts` (new), client, budget, run wiring (~7) | none | P1-P4, F1-F3; UID 45000 lane cap; properties | yes (P5, P6; NR1, NR3) |
| 12/14 | read-time bank-debit matcher | `src/statistics/exchange-funding-match/` (new), `statistics.screen.tsx` (~3) | none | M1-M8; one-to-one tie-breaks with a distinct value per sort key | no (NR1) |
| 13/14 | exchange catalog, picker field, registry wiring, shared provider sheet, `syncJobsFor` | `exchange-catalog/`, `exchange/registry/`, `exchange-type-field/` (new), `crypto-sync-form`, `account-form.screen.tsx`, `crypto-sync-section`, `add-bank-sheet` -> `provider-sheet`, `bank-sync-section`, `sync-jobs.ts`, `provider.ts`, `deletable.ts`, i18n, demo account (~16) | none | picker and caption render; registry skip of an unwired id; connect-first rollback; demo invariant per connectable catalog entry | no |
| 14/14 | backfill ranges, caption, "Earlier history", not-listed note, privacy policy, terms check, Notes for Review, demo regen, kiko-architecture/kiko-domain/kiko-compliance updates via scribe | `exchange/walk/` (backfill scope), the four walk files, `exchange/history-status/`, `holding-detail.screen.tsx`, i18n, `docs/privacy-policy*.md`, `e2e/screenshot/` seed (~12) | none | K1-K6; backfill skips BTC; earlier-history sum exact | no (terms gate) |

Sets 7-11 wait for probe 2 (R-Tech). Set 6 waits for NR1 (the code format). Set 12 waits for NR1.
Set 10 waits for NR2 only for the T8 rule (until ruled, T8 is a stop). Device verification with the
user's key runs on the final tip before 1.3-a ships.

## 12. Open questions

### Probe-dependent facts

Probe 2 is `memory/refs/binance-operations-probe.sh` (trades, convert, p2p, fiat, dust,
dividends), plus a `balances` part to add to it for P9-P14 (counts and tickers only, as the script's
privacy header requires).

| # | Fact | Default until confirmed | Fallback if refuted | Sets |
|---|---|---|---|---|
| P1 | `myTrades` with `symbol` + `fromId=0` and no times returns trades older than 24 h | id-cursor paging from 0 | trades read 24 h windows per symbol forward from the cutover only; older trades are not imported, the not-listed note names "trades before <date>", the "Earlier history" line shows the gap | 9, 10 |
| P2 | candidate symbol count for the user's coins (exchangeInfo) | lane cap 100 | lower per-run coverage; the rotation bound grows with `S` (measured) | 9 |
| P3 | `myTrades` lookback | from id 0 | the floor where Binance stops returning rows | 10 |
| P4 | Convert: 30-day span cap, lookback, wallet of a Convert from Funding | 30 d, 2 years, Spot | span: the window narrows to the cap; depth: floor at the deepest served; wallet: NR3 | 7 |
| P5 | P2P: 6-month floor, paging fields (`total`?), statuses, wallet (Funding), `amount` net or gross of `commission` | as section 5 | page until a short page; wallet: NR3; amount: orders with commission stay owed | 11 |
| P6 | fiat orders and payments: span and lookback, statuses, UID header, credited wallet, withdraw fee in `amount` | 30 d windows, `Successful`/`Completed`, Spot | windows narrow to what is served; wallet: NR3 | 11 |
| P7 | dribblet: do times reach past the last 100; is `transferedAmount` net of `serviceChargeAmount` | newest 100 only; net | older dust not listed (note); gross: BNB leg = transfered minus charge | 8 |
| P8 | assetDividend: `enInfo` values, credited wallet, overlap with Earn rewards, lookback | empty allowlist (no rows) | stays empty: distributions named in the not-listed note | 8 |
| P9 | LD* tokens in `/api/v3/account` | skip rule of section 3 | none needed (the rule is safe both ways) | 4 |
| P10 | max decimals per coin in balances and rows | scale from the registry | balance rounds with a tag; a row stops (`amount-precision`) | 4, 5 |
| P11 | Earn reward `productId` per asset | non-BTC reward key adds the asset | none needed | 5 |
| P12 | Pay `fundsDetail` with several coins; `walletAssetCost` keys per coin | rows per coin and wallet | `pay-split-mismatch` stop | 5 |
| P13 | `get-funding-asset` without `asset` omits zero rows | a missing coin reads as zero for existing holdings | none needed | 4 |
| P14 | `EURUSDT` is a live spot symbol | USDT fallback via EURUSDT | no USDT fallback; USDT unpriced when CoinGecko fails (existing "no rate" treatment) | 4 |
| P15 | weight headers of each new endpoint | caps of section 5 | caps alone bound the run | 7-11 |
| P16 | `walletType` of non-BTC deposits | 0 Spot, 1 Funding, else stop | stop owes the record | 5 |

### NEEDS RULING

- **NR1 - where the matcher reads a P2P / card / fiat-deposit fiat total (blocks sets 6, 11, 12).**
  R-Map puts the total "in the note" (`comment`), but the note is user-editable and not a stored
  marker (R-Tech: exclusion only by stored markers).
  (a) Extend the code: `p2p:UAH:415000`, `card:UAH:260000`, `bank:EUR:10000` (fiat minor units);
  insert-only, not user-editable, no migration; the note still shows the total. Widens the
  accepted code form `p2p:<FIAT>`.
  (b) Parse the total from `comment`; a user edit of the note silently stops the match and the
  debit counts again.
  (c) A second nullable column (`counterpart_amount_minor_units`) with its own migration and
  reviewer step.
  Recommendation: (a).
- **NR2 - trading fee charged in the spent coin (T8).** R-Q13 covers the received coin (subtract)
  and a third coin (separate excluded row); a fee in the coin paid is not covered.
  (a) A separate excluded fee row on the spent coin's holding, same pair id, `trade-fee` (the third-
  coin rule applied to any coin other than the received one).
  (b) Fold it into the spent leg (spent leg = gross + fee).
  (c) Keep it a stop owed at its point.
  Recommendation: (a). Interim in set 10: (c).
- **NR3 - an operation whose wallet probe 2 cannot determine (conditional on P4, P5, P6, P8).**
  (a) Place it on the wallet the probe observes for the user's account (Convert: Spot), and name
  the assumption in the not-listed note; a wrong guess shows as a gap in two holdings' "Earlier
  history" lines while balances stay right.
  (b) Leave that operation out of 1.3-a, as D7 once did for Convert.
  Recommendation: (a).
