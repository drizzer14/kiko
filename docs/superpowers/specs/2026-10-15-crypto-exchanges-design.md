# Crypto exchanges 1.3: shared exchange layer and multi-coin Binance (1.3-a)

Date: 2026-10-15. Status: user-approved (73336657). On 2026-10-16 these were folded in:
- the probe 2-5 facts;
- the "Probe 4 rulings": C-P5, C-P2P-SELL-MAKER, C-P2P-fiat-asset, C-Convert-wallet, C-Weights;
- the coordinator rulings C-NR-A ... C-NR-F and C-P2P-stop;
- the user rulings R-Walk A and C-P2P-SELL-MAKER B (FINAL, user, 2026-10-16).

The dividend walk was removed by its own rule (section 5). The user approved this text for sets
8-12 on 2026-10-16.

Rulings: `.superpowers/sdd/binance-multicoin/rulings.md`. User rulings are cited as R-Scope,
R-Q3 ... R-Q16, R-Tech and R-Walk. The coordinator rulings at the end of that file are cited as
C-NR1 ... C-NR9, C-NR-A ... C-NR-F, C-P5 and the other C- ids. C-NR2 and C-P2P-SELL-MAKER B are
confirmed by the user. Base: branch `binance-backfill-fix`. Track: `crypto-exchanges-1.3-a`.

Every code fact below names a symbol or an anchor text, never a line. The base moves: the developer
re-greps every fact on the actual base before relying on it. Migration numbers 0059-0061 and 0063
follow the base's last migration (0058), set 7's being 0063 because main's 0062 is account currency;
they are re-checked against main's
`drizzle/migrations/meta/_journal.json` at each merge and renumbered (files, journal, tests) if main
has moved.

Inputs: `rulings.md`, `brainstorm.md`, `brainstorm-ops.md`, `research-binance-api.md`,
`research-binance-ops.md`, `research-exchanges.md`, `research-bybit.md` (same folder); the specs
`2026-10-09-binance-pay-history-design.md` (cited as "the history spec") and
`2026-09-04-crypto-btc-sync-design.md`; the inventory probe output
`memory/refs/binance-inventory-probe-output-2026-10-15.txt` (main checkout).

The operations probes, all in the main checkout:
- probe 2: `memory/refs/binance-operations-probe-output-2026-10-15.txt`;
- probe 3: `memory/refs/binance-operations-probe-3-output-2026-10-15.txt`;
- probe 4: `memory/refs/binance-operations-probe-4-output-2026-10-16.txt`;
- probe 5: `memory/refs/binance-operations-probe-5-output-2026-10-16.txt` (one floor window per
  endpoint).

They hold counts, words, months and weights only.

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

`node harness/kiko/scripts/run-log.mjs stats --gaps --repo kiko`, re-read 2026-10-16. This spec
closes none of the gaps and leaves every one open. Sets 8-12 add no migration, so they do not touch
gap `binance-backfill-fix/2`.

| Gap | Relation to 1.3-a |
|---|---|
| `20261015T1657-kiko-binance-backfill-fix/1` (drizzle/ shell writes unguarded) | OPEN. Sets 4 and 7 edit migrations: the brief says Edit/Write only |
| `20261015T1657-kiko-binance-backfill-fix/2` (no mechanized index check for migrations) | OPEN. No set adds an index; a set that does gets an EXPLAIN QUERY PLAN test (section 11) |
| `20261015T1035-kiko-release-1-2/3` (export `emptyMatcherDraft`/`fromMatcherDrafts` through the category-rule-form barrel for the demo rule test) | OPEN, unrelated (main follow-up, `src/`). It touches `build-demo-snapshot` tests, which sets 7, 13 and 14 also change: merge order only |
| `20261014T0952-kiko-harness-h7/1`; `20261015T0021-kiko-harness-h7/1`; `20261015T0639-kiko-harness-h7/1`; `20261015T1119-kiko-harness-h7/1`, `/2`; `20261015T1318-kiko-harness-h7/2` | OPEN, unrelated (harness rules, kill-guard, mutation timeouts, doc tests) |

## 1. Goal, rulings, scope, release rule

### User rulings (binding; `rulings.md`)

| Id | Ruling | Where |
|---|---|---|
| R-Scope | 1.3 = shared layer + multi-coin Binance (1.3-a) + Bybit (1.3-b, own spec). OKX and others 1.4+. Ship only exchanges verified on device with a real key. Each exchange complete or not at all, no flag; Bybit late moves to 1.3.x. Plain-text names, generic icon, no logo, "not affiliated" caption, API terms checked before each exchange ships | 1, 2, 9 |
| U1 (user, 2026-10-21) | No deploy to the phone until all Binance sets are done | all |
| U2 (user, 2026-10-21) | uk `transactions.p2pPurchase` = «Купівля через P2P ({{currency}})»; other labels and all en unchanged | 10 |
| U3 (user, 2026-10-21) | Replaces S7-Q1 A: the demo dust source is XRP; no Dogecoin holding and no 0 cell; end balances and the 30+ day dating kept | 9 |
| U4 (user, 2026-10-21) | The nullable-map style rule is unchanged | all |
| S8-Q1 A (user, 2026-10-21; probe 6) | A Convert record's pair id and entry key use its `quoteId` (a non-empty string), never `orderId` (a JSON integer past 2^53 on the measured record). A record with no `quoteId` is unreadable and owes its point. The key is fixed once shipped: a change would import every re-read twice | 5 |
| S8-Q2 A (user, 2026-10-21) | A sync row that adopts a plain statement-import twin keeps the pair id, the counterpart holding, the untracked counterpart and the operation as one unit, only when the twin has none of the three markers; a twin with any marker (a user's own pair) keeps its own | 6 |
| F5 A (user) | A settled SUCCESS Convert record on an allowed wallet with a blank (`''` or absent) asset is a `convert-unrecognized` entry and owes nothing; a zero or negative amount, or a missing amount of a tracked side, stays owed. Convert only: Transfer and Earn still owe a blank asset | 5 |
| S8-C1 A (user) | Convert does NOT narrow a refused start: a -5026 on Convert fails the run, is logged, the marks stay and the history caption shows once the Convert cursor lags more than a day (`isBinanceHistoryBehind`), as Pay does. This withdraws "never ends the walk" for Convert (C-NR-C). Cost: if Binance ever adds a Convert depth, the sync fails visibly every run until an app update; never a silent loss | 5, 7 |
| R-Q3 A | Curated coin list in the app (code, decimals, symbol, CoinGecko id). Coins outside it show as "not tracked" with their ticker on the account screen | 3 |
| R-Q4 A | List = the user's coins (inventory probe) + top ~30 by market cap + USDT, USDC, FDUSD, DAI; stablecoins priced from the market, never 1:1 | 3 |
| R-Q5 A | USDT, USDC, FDUSD, DAI at 8 decimals; exact rescale migration of USDT holdings, rows, price points and `.kiko` imports; reviewer step; exact-parity test | 3, 7 |
| R-Picker | The manual holding form lists every curated coin; a crypto base currency stays not selectable | 3 |
| R-Q6 A | One holding per coin per wallet ("Binance Spot · USDT"); appears on first non-zero balance or first row; stays at 0 when emptied; a dust row for a tracked source coin with no Spot holding creates it at zero (S9-Q4 A, user, 2026-10-21; was: dust creates none); default-named BTC holdings renamed, user renames kept | 4 |
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
| R-Walk A (user, 2026-10-16) | The Convert, P2P and fiat walks read forward from `HISTORY_FLOOR_MS` with the existing walk engine (`buildWalkWindows`); recent records arrive last, and the history caption shows meanwhile. Set 11 measured the trades lane (section 5 "Spot trades") and left the P2P lane cap alone; the P2P cap moves to set 12, which may raise it only with a measured reason | 5, 12 |
| C-P2P-SELL-MAKER B (FINAL, user, 2026-10-16) | SELL and MAKER P2P orders are listed on the not-imported line, not imported (the coordinator ruling of the same id below, confirmed by the user) | 5, 6, 7, 10 |

### Coordinator rulings (binding; `rulings.md`, "Spec NEEDS RULING")

These are the coordinator's rulings, not the user's, except C-NR2, which the user confirmed
(2026-10-15), and C-P2P-SELL-MAKER B, which the user confirmed as FINAL (2026-10-16).

| Id | Ruling | Where |
|---|---|---|
| C-NR1 A | The fiat total of a P2P buy, card buy or fiat deposit is stored in the marker code as a major-unit decimal at the fiat's scale: `p2p:UAH:4000.00`, `card:UAH:2600.00`, `bank:EUR:100.00`. Parsed by the exact decimal parser (`src/currency/decimal/decimal.ts`), never `Number()`. The note (`comment`) only displays the total | 5, 6 |
| C-NR2 B | A fee charged in the SPENT coin is added to the spent leg (spent leg = gross + fee); no extra row; out of spending. CONFIRMED BY THE USER (2026-10-15) | 5, 7 |
| C-NR3 A (amended 2026-10-16) | An operation whose record names no wallet goes on a default wallet. P2P goes on Funding: the P2P rows have no wallet field (probe 2-4 row key lists). Fiat orders and payments go on Spot: probe 3 read no fiat row to observe. Convert is no longer under this rule, because its rows carry `walletType` (C-Convert-wallet). The not-listed note names the P2P and fiat defaults | 5, 10 |
| C-NR4 A | If Binance refuses `fromId` together with `orderId` (probe P15b), an order with more than 1000 fills is re-read through the normal trade id cursor, keeping only that order's fills. Not needed while P15b holds (C-NR7); P15b is a hard gate before set 11 | 5, 12 |
| C-NR5 A | A third-coin fee row of a trade whose RECEIVED coin is not tracked carries `untrackedCounterpart = asset:<received coin>` and stays out of spending | 5, 6, 7 |
| C-NR6 B | The C-NR4 fallback starts from the order's stored row time (the first fill time). Not needed while P15b holds (C-NR7); P15b is a hard gate before set 11 | 5, 12 |
| C-NR7 A | The C-NR4 / C-NR6 re-read fallback is cut from 1.3-a. P15b (`myTrades` with `symbol` + `orderId` + `fromId` pages an order's fills by id) runs in probe 3 as a hard gate before set 11: refuted or untestable (for example, no spot order on the account) -> stop and ask the coordinator | 5, 11, 12 |
| C-CGPT A | CGPT (ChainGPT) is added to the curated list: probe 2 found it in the user's Funding wallet, and R-Q4 lists the user's own coins | 3 |
| C-P2P-depth (stop rule replaced by C-P2P-stop) | The P2P walk has no month cap. Its stop rule is C-P2P-stop. Probe 3 found rows in 29 of 36 windows (oldest month served 2023-11, the limit of that walk). Probe 4 found rows in 31 of 38 windows, back to about 2023-09, and the oldest window it walked had rows ("the oldest walked window had rows on 1 side(s)"), so the real floor is older and unknown. The longest run of empty windows seen was 3 (probe 3, windows 11-13) | 5, 12 |
| C-NR8 A | `exchange_state` holds two lists per kind (not tracked, oversized): a balance list, and a history list, which only grows and is cleared on disconnect. The account detail shows the sorted union of the two lists of a kind, without duplicates. The not-tracked balance list is replaced only by a read where EVERY wallet read. The oversized balance list is kept per wallet (`oversizedCoins.balanceByWallet`): a wallet that read replaces its own array, a failed wallet keeps it, a complete read replaces all, and `balance` is derived from them (`exchange-state-patch.ts`) | 2, 3, 5, 7 |
| C-Prep A (Q2-Q12) | `restoreDataSnapshot` takes a required version; an `amountTooLargeError` import key; set 3 moves code only, and sets 5-6 switch to `exchangeMinorUnits`; the parser lives in set 2; `exchangeHistoryPaused` is set 4's; per-migration `VERSION_DECISIONS`; credential wrappers stay in `binance/`, and `exchange/` is a declared container; history only for held coins; the privacy-site copies; set 4's test-helper first commit; `bond_register` excluded from 0059 | 2, 3, 7, 9, 10, 11 |
| C-NR9 A (2026-10-15) | (a) From set 2 on, a restore refuses a file with a currency code that is not in `currencyScale`: no row is written, and one new import error key is added (en + uk, translator review), since no "made by a newer Kiko" key exists. (b) Set 2 adds a small concurrency cap to `fetchCryptoHistory` (`CRYPTO_HISTORY_CONCURRENCY`; the developer measures it, starting at 2). There are never more requests in flight than the cap, and every coin is still fetched | 3, 11 (set 2) |
| C-P5 A (2026-10-16) | The crypto row of a P2P BUY is `takerAmount`, net of the fee per R-Q13. When `takerAmount` is absent, the row is `amount - takerCommission`, computed exactly with the decimal parser. When both exist and disagree, the order is refused into the not-imported list (visible) and never guessed. The `p2p:<FIAT>:<TOTAL>` marker holds `totalPrice` as Binance gives it (C-NR1 normalization only) and is never derived from `amount x unitPrice`. Probe 4: `takerAmount = amount - takerCommission` in 69 of 69 fee-bearing orders; `amount x unitPrice = totalPrice` in only 2 of 69 | 5, 7 |
| C-P2P-SELL-MAKER B (FINAL, user, 2026-10-16) | P2P orders with `tradeType` SELL or `advertisementRole` MAKER are NOT imported in 1.3-a. They are recorded in the not-imported list and never dropped silently: the account detail counts them and the not-listed note names them. "The caption counts them" in the ruling means the not-imported line (C-NR-A), not the history-behind caption, so K8 still holds: an entry never shows the caption. The planned follow-up is the analogy rule: debit = `amount + takerCommission`, with the fee in the spent coin. It is enabled after a probe on an account that has such orders. Probe 4: SELL 0, MAKER 0 in 38 windows | 5, 6, 7, 10 |
| C-P2P-fiat-asset A (2026-10-16) | A P2P BUY whose `asset` is a fiat code goes on that wallet's fiat holding (R-Q15) with the marker `p2p:<FIAT>:<totalPrice>`, and the R-Q14 bank-debit match applies. Probe 4 B: one order, asset UAH, fiat UAH, BUY, COMPLETED, 2026-01 | 4, 5, 6, 7 |
| C-Convert-wallet (2026-10-16) | A settled Convert row's wallet comes from its `walletType`: `FUNDING` -> Funding, `SPOT` -> Spot. Any other word, or a missing or null value, is refused into the not-imported list (visible; allowlist rule). This replaces C-NR3 for Convert | 5, 7 |
| C-Weights (2026-10-16) | The measured weights are in section 5, "Measured weights". P2P is UID 900 a call and Convert UID 3000 a call | 5 |
| C-Div | The dividend walk is removed from 1.3-a by the rule section 5 set before the probes: probes 2 and 3 read 0 dividends in 3 years (7 windows of 180 days each), so no `enInfo` value could be put on the allowlist | 5, 6, 9 |
| C-NR-A A (2026-10-16) | The not-imported list. "Owed and visible" means one thing for a record that a rule refuses for good (P2P SELL or MAKER, conflicting P2P amounts, a Convert or P2P word not on the allowlist, a fiat status not on the allowlist): the record goes into `exchange_state.notImported`, the walk's cursor moves past it, and the record is not re-read each run. A record that waits on Binance (an open status) stays an owed point, as today | 2, 5, 7 |
| C-NR-B A (2026-10-16) | A P2P order whose `takerAmount` is absent and whose fallback cannot be computed (`takerCommission` absent, or `amount` absent) is refused into the not-imported list (`p2p-amount`) and never guessed. The `amount`-absent case follows from C-P5 | 5, 7 |
| C-NR-C A (2026-10-16) | The Convert walk covers `HISTORY_FLOOR_MS` to now, read forward (R-Walk A); empty windows never stop it; a -5026 start fails the run (S8-C1; was: narrowed by `DepthGuard`, never ends the walk). A test pins that a 2026-01 conversion behind 6 or more empty windows is found (C8). Probe 5 found no refusal to the floor on Convert, P2P, fiat orders or fiat payments (probe 5 asked one series per endpoint, P2P BUY and fiat transactionType 0, with one 30-day floor window, not the walk's 2-year fiat window), so every window is read (section 5, "Refused window and walk direction") | 5, 7 |
| C-NR-D A (2026-10-16) | The fiat orders and fiat payments walks read 2-year windows and each covers `HISTORY_FLOOR_MS` to now, read forward (R-Walk A); empty windows never stop it; a -5026 start is narrowed by `DepthGuard` (safety net) and never ends the walk. Probe 5 found no refusal to the floor (see C-NR-C for the scope of probe 5), so every window is read (section 5, "Refused window and walk direction") | 5, 7 |
| C-NR-E A (2026-10-16) | The fiat walks ship on the documented shapes with a strict status allowlist. An unknown word is owed and visible (the not-imported list, `fiat-unrecognized`). The spec marks each fiat stream "no real row observed" | 5, 7, 12 |
| C-NR-F A (2026-10-16) | Set 7 drops `transactions.p2pSale`: no negative `p2p:` row can be written in 1.3-a. The follow-up adds it back | 6, 10, 11 |
| C-P2P-stop A (2026-10-16) | The P2P walk covers `HISTORY_FLOOR_MS` to now, read forward (R-Walk A); empty windows never stop it; a -5026 start is narrowed by `DepthGuard` (safety net) and never ends the walk. It replaces the stop of "6 empty or refused windows in a row" in C-P2P-depth. A test pins that an order behind 7 or more empty windows is found (P6). Probe 5 found no refusal to the floor (see C-NR-C for its scope) | 5, 7, 12 |
| S7-Q1 A (2026-10-21) | REPLACED by user answer U3 (2026-10-21): the demo dust source is the existing XRP holding (dust pair XRP -> BNB); there is no Dogecoin holding. Seed pins stay at eight coins, 110 currency pairs | 9 |
| S7-Q2 A (2026-10-21) | Every existing demo holding keeps its end balance (a deposit amount adjusted; a `bank:EUR:50.00` fiat withdrawal keeps EUR at 50); every set 7 demo row is dated more than 30 days before the anchor, so amounts and dates keep the default window unchanged; Home's net-worth card is unchanged | 9 |
| S7-Q3 A (2026-10-21) | Code parse rules: the fiat is the segment as written, non-empty and free of `:`; a total exists only for a known non-crypto currency when the rest parses exactly at its scale to a value above zero; else no total and the label renders. `asset:` needs a non-empty code free of `:` (a code with `:` is unknown: default label) | 6 |
| S7-Q4 A (2026-10-21) | `operation` is not a rewrite guard field (`REWRITE_GUARD_FIELDS`); it labels only, and every operation row carries another marker | 6 |
| S7-Q5 A (2026-10-21) | The P2P cover rule keys on the `p2p:` code through `parseUntrackedCounterpart` plus the row's amount and holding currency, never on `operation`; set 7 adds nothing for it | 6 |
| S7-Q6 A (2026-10-21) | Parsers only in set 7; the demo seed writes literal codes; each walk set adds its own builder (with the section 5 marker-total normalization) | 6 |
| S7-Q7 A (2026-10-21) | No export version bump: `EXPORT_VERSION` stays 5; `VERSION_DECISIONS` `{ version: 5, migrationCount: 64 }` | 7 |
| S7-Q8 A (2026-10-21) | The `transactions.matched*` keys wait for set 13 (their consumer); set 7 adds the six row labels only | 10 |

Source of S7-Q1 ... S7-Q8: `memory/refs/binance-multicoin-sdd-2026-10-21/rulings.md`, section
"Set 7 plan questions", the "S7-Q<n>" line, coordinator 2026-10-21.

| Ruling | Answer | Sets |
|---|---|---|
| S8-Q3 A (COORDINATOR) | The `notImported` union is its own write after the span's rows and before its marks | 8 |
| S8-Q4 A (COORDINATOR) | All six `notImportedKind` keys and `accountDetail.notImported` land in set 8 | 8 |
| S8-Q5 A (COORDINATOR) | `convert` joins `CAPTION_WALKS`: an existing user sees the history-behind caption for about 6 syncs | 8 |
| S8-Q6 A (COORDINATOR) | A SUCCESS record with one asset on both sides is `convert-unrecognized` | 8 |
| S8-Q7 A (COORDINATOR) | An unreadable `notImported` name is kept, with no log line (run-log gap) | 8 |
| S8-Q8 A (COORDINATOR) | Row C3 reads "never adds a second entry" | 8 |

Source of S8-Q1 ... S8-C1 (S8-Q1, S8-Q2, F5 and S8-C1 sit in "User rulings"):
`memory/refs/binance-multicoin-sdd-2026-10-21/rulings.md`, section
"Set 8 plan questions".

| Ruling | Answer | Sets |
|---|---|---|
| S9-Q1 A (COORDINATOR) | An unimportable dust record is logged once per code per run and left out; no new `notImported` kind | 9 |
| S9-Q2 A (COORDINATOR) | An entry with a leg that rounds to 0 units gives no row for either leg (no half pair), and no log | 9 |
| S9-Q3 A (USER, probe 7) | The empty answer is `{"userAssetDribblets":[]}` with `total` absent. `[]` is no dust; a missing or non-array list fails closed; `total` is never read | 9, 12 |
| S9-Q4 A (USER) | AMENDS R-Q6 "dust creates none": a tracked source coin with no Spot holding gets it created at zero by `placeWalletRows` (the R-Q6 row and section 4 "Appear" say so) | 4, 9 |
| S9-Q5 A (COORDINATOR) | The dust read keeps its own short rate-limit try/catch; the set 8 duplicate stays deferred | 9 |
| S9-Q6 A (COORDINATOR) | The convert-history survivor triage is a separate test-only change set after set 9 | 9 |
| S9-Q7 A (COORDINATOR) | An entry is accepted only when `targetAsset` is BNB; absent, blank or another coin is refused as `dust-row-unreadable`. A non-BNB target is a later-set question | 9 |
| S9-Q8 A (COORDINATOR) | A record with an empty details list is unreadable and logged | 9 |
| S9-Q9 A (COORDINATOR) | The repeated `row-precision-rounded` console warning (about 200 lines per sync with dust) is accepted; run-log gap `20261021T1839-kiko-binance-set9/2` | 9 |
| S9-Q10 A (COORDINATOR) | DECISION: an untracked coin's dust entry joins the not-tracked line only when its BNB leg imports; a 0-amount or malformed entry lists nothing | 9 |

Source of S9-Q1 ... S9-Q10: `rulings.md`, section "Set 9 plan questions".

| Ruling | Answer | Sets |
|---|---|---|
| S10-Q1 B (COORDINATOR) | `trades.rotation` is text: the last round-robin symbol read; the next run reads the next symbol in sorted order and wraps; `''` = start. No stored value existed, so no migration; `ceil(S / L)` holds when a coin is added or removed | 10 |
| S10-Q2 A (COORDINATOR) | A listed symbol with a stored `fromId` stays a candidate in any status (HALT, END_OF_DAY, CANCEL_ONLY): a halted pair can hold trades from before the halt | 10 |
| S10-Q3 A (COORDINATOR) | One `exchangeInfo` read per run, no cache; when it fails no symbol is read that run | 10 |
| S10-Q4 A (USER, probe 8) | BTCUSDT `myTrades` gave 20 records; `id`, `orderId` and `orderListId` are JSON integers, all safe (20 of 20); ids ascending; weight 20. A trade keys on `id` as a safe integer; the unsafe-id refusal stays | 10, 11, 12 |
| S10-Q5 A (COORDINATOR) | One public no-key `exchangeInfo` call measures the body before step 3. Measured: unfiltered 17.8 MB decoded (325 KB gzip), 3736 symbols, weight 20 | 10 |
| S10-Q5b (COORDINATOR) | A `symbols=[...]` list with one unlisted name answers HTTP 400 -1121 for the whole request, so the symbol filter fails. After G1-A the final request is `showPermissionSets=false` with no `permissions` filter: 6.77 MB decoded (147.5 KB gzip), 3736 symbols. `permissions=SPOT` left out 40 BREAK leveraged tokens | 10 |
| S10-Q6 A (COORDINATOR) | No shared `Pager` type; `idCursorPager` stands alone | 10 |
| G1-A A3 (COORDINATOR) | `exchangeInfo` is requested with `showPermissionSets=false` only, no `permissions` filter (101.09% of the SPOT body, so within the 5% bound) | 10 |
| G1-B B1 (COORDINATOR) | The id-cursor pager refuses a `stopAt` outside `[page fromId, last id + 1]` and an unsafe input `fromId` (`IdCursorPageError`) | 10 |
| G1-C C1 (COORDINATOR) | An `exchangeInfo` body with 0 readable and more than 0 unreadable symbol items throws `BinanceHistoryParseError` (a visible failure) | 10 |
| G2-A B (COORDINATOR) | A rate limit or an account-wide request or network failure stops the run; a per-symbol error (`IdCursorPageError`, `BinanceHistoryParseError`, `BinanceInvalidSymbolError`) ends only that symbol as `failed` | 10, 11 |
| G2-B B (COORDINATOR) | A candidate needs at least one touched coin, the other touched or a main quote; a pair of two main quotes alone is not one, and the not-listed note names the gap | 10, 15 |
| G2-C A (COORDINATOR) | The round-robin spends the calls left each run; revisit only on a measured run cost (set 11) | 10, 11 |

Source of S10-Q1 ... G2-C: `rulings.md`, section "Set 10 plan questions" (S10-Q4 from probe 8).

| Ruling | Answer | Sets |
|---|---|---|
| S11-Q1 A (COORDINATOR) | The balance sync's Spot read returns the balance texts for the rotation (`spotBalanceTexts` through `ProviderRead` and `BalanceSyncResult`); no extra `/api/v3/account` call | 11 |
| S11-Q2 A (USER, probe 9) | `myTrades` on BTCUSDT: 40 trades; `id` and `orderId` safe integers, ascending; `time` an integer; `isBuyer`, `isMaker`, `isBestMatch` booleans; `price`, `qty`, `quoteQty`, `commission` plain decimal text with at most 8 decimals; `orderId` and `orderId` + `fromId` pages answered 200. Candidates 7; the report is in section 5 "Spot trades". The trades lane cap stays 100. A FLOOR: only the coins held now were walked | 11 |
| S11-Q3 A (COORDINATOR) | An order cut by a page boundary is written from the fills seen; its next fill finds it by key prefix and triggers one weight-5 re-read; no fill sits unwritten behind a stored cursor | 11 |
| S11-Q4 A (COORDINATOR) | Both legs untracked and the fee in a tracked third coin: a fee row in the C-NR5 form, both tickers listed | 11 |
| S11-Q5 A (COORDINATOR) | A leg that rounds to 0 units writes neither leg; a non-zero fee row still imports; the symbol continues (as S9-Q2) | 11 |
| S11-Q6 A (COORDINATOR) | A row the rules refuse is a per-symbol failure (`BinanceWalkStop` joins `isSymbolFailure`): the symbol ends `failed`, is logged, and a too-large coin is listed (G2-A) | 11 |
| S11-Q7 A, S11-Q8 A (COORDINATOR) | The set 10 survivors are the first step of set 11; `.otherwise(() => 'rest')` -> `undefined` is equivalent | 11 |
| S11-Q9 B (COORDINATOR) | The two `bySymbol` comparator survivors are not equivalent (a comparator that never returns a positive value works only because V8's sort ignores that sign; the app runs Hermes): `bySymbol` is exported and a direct test pins all three signs | 11 |
| S11-Q10 A (OVERNIGHT DEFAULT, pending user) | The user rules in the morning. A tracked fiat trade leg or fiat fee with digits past the fiat scale is rounded half away from zero once per order, after the text sum, with the `row-precision-rounded` log, not a symbol stop (measured on public trades: BTCEUR 498 of 500 had 3-7 decimals in `quoteQty`) | 11 |
| S11-Q11 A (COORDINATOR) | A zero-row order that is the last order of a page holds the cursor at its first fill | 11 |
| S11-Q12 A (COORDINATOR) | `callsBySymbol` and `countedRunOf` are deleted (no production reader); the trade walk returns `{ imported }` and tests count calls in their fakes | 11 |
| S11-Q13 A (COORDINATOR; data correctness, so the fix, not a cap) | The exchange state keeps a per-symbol set of rowless order ids (`rowlessOrderIds`); a later fill of such an order counts as imported earlier and triggers the weight-5 re-read; the id leaves when its order writes a row; a disconnect clears it | 11 |

Source of S11-Q1 ... S11-Q13: `rulings.md`, section "Set 11 plan questions" (S11-Q2 from probe 9). The
set 10 whole-branch items there (FR-Q1, FR-Q2) belong to set 10.

### Rulings this spec reverses

Each reversal has a "was:" column in its scenario matrix (section 7).

| Earlier rule | Source | Now |
|---|---|---|
| BTC only; other coins never read | crypto BTC sync spec; history spec "Goal" | every curated coin and fiat (R-Q3, R-Q15) |
| Convert deferred: no wallet field (D7) | history spec D7 | Convert imported (R-Q9). Its `walletType` picks the wallet: the field exists (probes 2-4 key list; C-Convert-wallet) |
| Trades out of scope | history spec "Scope" | spot trades imported (R-Q9, R-Q11, R-Q13, C-NR2) |
| A non-BTC Pay order paid with BTC stops (`pay-btc-funded-other-coin`, user ruling A2 2026-10-10) | history spec P9, Q8 | one row per debited coin (R-Q7) |
| `currencyScale.USDT` = 2 | `currency.ts` | 8 (R-Q5) |
| A crypto amount shows every decimal of its scale (`₿0.05000000`) | `formatMoney` (`format.ts`) | trailing zeros trimmed, at least 2 decimals (`₿0.05`; R-Display; DP1-DP5) |
| Default names "Binance Spot/Funding/Earn" | `WALLET_HOLDING_NAMES` (deleted in set 6 step 3; the walk config `BINANCE_WALK_CONFIG` in `binance.walk-config.ts` now has `walletHoldingOf(key) => { currency, name }`, built from `partsOfHoldingKey` and `coinHoldingName`, and `undefined` for a key that is no holding key) | "Binance <Wallet> · <COIN>" (R-Q6) |
| The caption shows for null/behind cursors and a Transfer owed range only (OVERNIGHT 20 = B) | history spec section 8 | also while a backfill range is owed (R-Q8) |
| The fiat total of a P2P / card / fiat row lives in the note | R-Map | in the marker code; the note displays it (C-NR1) |
| The 2-minute same-amount matcher (`internalTransferTransactionIds`) sees every row of the ledger | `statistics.screen.tsx` | it sees only rows with no `exchangePairId`, no `exchangeCounterpartHoldingId` and no `untrackedCounterpart` (section 6, S1) |
| Every bank debit counts as spending unless another rule excludes it | statistics today | a debit matched to a P2P / card buy or a fiat deposit is excluded (R-Q14; M matrix) |
| P2P SELL imported as `-amount`; an order with a non-zero commission owed until probe P5 | this spec, approved 73336657, section 5 "P2P" | only BUY orders as TAKER import, at `takerAmount` (C-P5). SELL and MAKER orders are listed as not imported (C-P2P-SELL-MAKER B). Matrix rows P1-P2d carry "was:" |
| The P2P walk ends after 6 empty or refused windows in a row | this spec, C-P2P-depth | it reads forward from `HISTORY_FLOOR_MS` to now with no stop (C-P2P-stop, R-Walk A). Matrix row P6 carries "was:" |
| Dividends and airdrops are imported as `reward` rows (R-Q9) | R-Q9, R-Map | not in 1.3-a (C-Div). The not-listed note keeps "distributions other than Simple Earn rewards" |

### Scope

In (1.3-a): the shared layer (section 2); the curated coin registry and stablecoin precision
(section 3); per-coin and fiat holdings (section 4); the history streams of section 5 on every
curated coin and fiat; row mapping, `operation` column, matchers, "Earlier history" and the
not-listed note (section 6); migration of BTC state and the backfill (section 7); the connect flow
(section 8); compliance (section 9); copy (section 10).

Out: R-Out, plus Bybit itself (1.3-b, its own spec; section 2 lists what 1.3-b adds).

Not possible (API limits, not choices):
- Pay older than 18 months: probe 3 was served up to 533 days back, and a window that started 534
  days back or older was refused with 403004.
- Transfers older than 179 days.
- P2P, Convert and fiat older than Binance serves: P2P rows were found back to about 2023-09; each
  walk covers `HISTORY_FLOOR_MS` to now; probe 5 found no refusal back to that floor (an empty
  answer does not prove Binance keeps data that far back).
- Dust beyond the last 100 records.
- Binance Card spending (no API).

The "Earlier history" line shows the gap, and the not-listed note names it.

Not in 1.3-a by rule:
- dividends and airdrops (C-Div);
- P2P sales and P2P orders as advertiser (C-P2P-SELL-MAKER B; listed as not imported).

### Release rule (App Store Guideline 2.5.19)

- 1.3-a ships only with all 15 change sets merged and verified on the user's device with the user's
  own read-only Binance key (R-Scope). There is no flag, no `SHOW_*`/`HIDE_*`/`ENABLE_*` control,
  no catalog entry for an exchange that is not complete, and no dormant reader (kiko-architecture
  "Guideline 2.5.19 — no hidden features"; Semgrep
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
| `exchange/paging/` | set 3: `fetchAllByTotal`, `readSeriesSpan` (with span halving) and `TotalPage<Row, Weights>` in `paging.ts`; no `Pager` or `offsetPager` exists (S10-Q6); `readIdCursor` and `IdCursorPageError` in `id-cursor-pager.ts` (set 10) | `binance.history-paging.ts` |
| `exchange/walk/` | the walk engine: `planWalkPasses`, `runWalkPlan`, `walkSpans`, `buildWalkWindows`, owed ranges and points, range cursor, span hints, `settleRecords`, `commitSettledSpan`, `placeWalletRows`, depth guards; `WalkStop` codes generic, exchange codes added per exchange | `binance.history-walk.ts`, `binance.history-records.ts`, `binance.history-depth.ts` (constants become a per-exchange `DepthConfig`), `binance.walk-write-deps.ts` |
| `exchange/walk-state/` | `ExchangeState` type, its per-walk strict parse, readers and the gated writer over `sync_state.exchange_state` (set 4) | the walk-owned metadata keys of `holding-metadata.ts` (`binanceWalkCursorFields`, `binanceWalkPendingFields`, `binanceWalkPointCursorFields`, `binanceWalkRangeCursorFields`, `binanceWalkSpanHintFields`) and `holdingsRepo.setBinanceWalkCursor`, `setBinanceWalkPending`, `setBinanceWalkSpanHints`, `resetBinanceWalkCursors` |
| `exchange/history-status/` | `isExchangeHistoryBehind(state, latestSyncedAt)`, `untrackedCoinsOf(state, isTracked)` and `oversizedCoinsOf(state)` (each the sorted union of its kind's balance and history lists, C-NR8; `untrackedCoinsOf` leaves out a ticker that the exchange's tracked rule accepts now, `isTrackedBinanceAsset` for Binance: a curated crypto or a `BINANCE_FIAT_CODES` fiat; INR, PEN and KES stay on the list); `notImportedCountsOf(state)`, the count of `notImported` entries per kind in the fixed order of `NOT_IMPORTED_KINDS` (C-NR-A, set 8; section 6, "Not-imported line") | `screens/account-detail/crypto-sync-section/binance-history-status.ts` (`walkCursorsOf`, `transferOwesRange`, `isBinanceHistoryBehind`) |
| `exchange/amounts/` | `exchangeMinorUnits(currency, text, use: 'balance' \| 'row'): Either<AmountError, number>`: a wrapper over set 2's exact decimal-to-minor-units parser in `src/currency/decimal/decimal.ts`; both modes refuse an exponent form (`amount-malformed`) and a result above `Number.MAX_SAFE_INTEGER` (`amount-too-large`). `'balance'`: more decimals than the scale round half away from zero and log `balance-precision-rounded`. `'row'`: more decimals than the scale are refused (`amount-precision`), except on a reduced-scale coin (section 3), where they round the same way and log `row-precision-rounded` | new in set 3 with no caller; set 5 switched the balance sum in `binance.provider.ts` (`sumAmounts`, over `exchangeMinorUnits`) to it (done), set 6 switches `btcSatoshis` (`binance.amounts.ts`, deleted by set 6) |

The Binance host constant stays in `binance.client.ts` (re-grep the `@env` host); there is no
hosts unit in 1.3-a.

Set 3 moves code only. `btcSatoshis` and the old `sumSatoshis` (replaced by `sumAmounts` in set 5) keep their behaviour there (`btcSatoshis` now lives in `binance.amounts.ts`): a JS number or
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

No shared `Pager` type exists and set 10 adds none (S10-Q6): the id-cursor pager stands alone in
`exchange/paging/id-cursor-pager.ts` and the offset paging (`fetchAllByTotal`, `readSeriesSpan`)
is not refactored. The type below is a target for Bybit (1.3-b), kept as a sketch.

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

- offset paging (today's `fetchAllByTotal` and `readSeriesSpan`, moved as is in set 3) (time window, `current`/offset pages, `total`
  drift checks, halving, 50-page cap at 1 ms).
- the id-cursor pager (set 10, `readIdCursor`): a series has an id cursor, not a time window. It
  reads pages of `limit` ascending by id from `fromId` until a short page, the lane cap or a
  caller stop, and returns the next `fromId`, the calls and the end. No halving. Binance
  `myTrades` uses it. Its refusals throw `IdCursorPageError`, each with a code: an id that is not
  a safe integer (an id whose `id + 1` is not safe too), an id not ascending (one below the
  cursor included), more rows than `limit`, a `stopAt` outside `[page fromId, last id + 1]`, and
  an unsafe input `fromId` (refused before the lane is asked). A refused page never reaches
  `onPage`; pages committed earlier stay. A request that rejects is recorded against the lane
  with the caller's `failedCallWeights`, then its own error is rethrown.

### Walk state in `sync_state` (set 4)

One nullable JSON column `sync_state.exchange_state` per account (R-Tech). Shape:

```ts
type ExchangeState = {
  version: 1;
  walks: Partial<Record<WalkId, WalkMarks>>;   // WalkId = 'capital' | 'pay' | 'transfer' | 'earn'
                                              //  | 'convert' | 'p2p'
                                              //  | 'fiatOrders' | 'fiatPayments'
  trades?: { symbols: Record<string, { fromId: number | null; heldOrderId?: number }>;
             rotation: string; balanceSnapshot: Record<string, string> };
  untrackedCoins?: CoinLists;                 // tickers not on the coin list (C-NR8)
  oversizedCoins?: CoinLists & { balanceByWallet?: Record<string, string[]> };
                                              // tickers refused: too large or malformed (C-NR8)
  notImported?: string[];                     // records a rule refuses for good (C-NR-A):
                                              //  '<kind>:<record id>:<time ms>', no duplicates
};
type CoinLists = {
  balance?: string[];                         // replaced by each good balance read
  history?: string[];                         // grows with each history read; cleared on disconnect
};
type WalkMarks = {
  cursor?: number | null; rescan?: number; pending?: BinancePendingRange[];
  pointCursor?: number; rangeCursor?: number; spanHints?: BinanceSpanHints; multiCoinSince?: number;
  multiCoinSeen?: true;                       // the walk's first multi-coin run happened (section 7)
};
// The closed kind list: a const tuple, the union derived from it (kiko-code-style), and one copy
// key per kind as a typed record, so a kind without copy fails the type check.
const NOT_IMPORTED_KINDS = [
  'p2p-sale', 'p2p-advertiser', 'p2p-amount', 'p2p-unrecognized',
  'convert-unrecognized', 'fiat-unrecognized',
] as const;
type NotImportedKind = (typeof NOT_IMPORTED_KINDS)[number];
const notImportedKindCopyKeys: Record<NotImportedKind, ParseKeys> = { /* section 10 */ };
```

Dust has no walk entry: one call per run, and keys dedupe (section 5). There is no `'dividend'`
walk (C-Div). No walk keeps a count of empty windows, because no walk stops on empty windows
(C-NR-C, C-NR-D, C-P2P-stop).

`notImported` holds each entry once. Each walk adds to it (a union, like a history coin list), and
only a disconnect clears it. The record id and time let a later version owe the exact points again
when it learns to import that kind (for example the C-P2P-SELL-MAKER follow-up). An entry never
shows the caption (K8). The developer re-greps `ParseKeys` on the base.

`BinancePendingRange` (`holding-metadata.ts`; `OwedGround` in `exchange/walk/walk.ts` is an
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
- `trades.rotation` is text, the last round-robin symbol read (`''` = start; S10-Q1).
- `trades` parses per PART (`symbols`, `rotation`, `balanceSnapshot`): a bad part never empties
  another (`tradesOf`, `walk-state.ts`). Each of the four coin lists (`untrackedCoins.balance`, `untrackedCoins.history`,
  `oversizedCoins.balance`, `oversizedCoins.history`) and `notImported` parse on their own, and
  `oversizedCoins.balanceByWallet` is parsed per wallet (`oversizedByWalletOf`). A
  malformed coin list reads as its empty value; its name goes into `unreadable` with no log line.
  `notImportedOf` (`walk-state.ts`) drops every `notImported` entry that is not text of a known
  kind in `NOT_IMPORTED_KINDS` (a newer build's kind included) and keeps only its NAME
  (`notImported.<index>`) in `ParsedExchangeState.unreadable`. Nothing logs it (S8-Q7: names only,
  no log line; a run-log gap). `EXCHANGE_STATE_MALFORMED` is thrown only for a malformed top level.
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
gate of `setBinanceWalkCursor`). A patch names fields, not whole entries. It can name:
- a (walk id, field) pair;
- a trade symbol's entry;
- `trades.rotation` or `trades.balanceSnapshot`;
- one coin list (its kind and its source);
- `notImported` additions. These are a union with no duplicates, written as its own write after
  the span's rows and before the span's marks (S8-Q3), so a failed write leaves the cursor behind
  and the records are read again.

A balance-list patch replaces that list; a history-list patch adds tickers to it
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
disconnect and reconnect repairs it. The `convert` walk is in `CAPTION_WALKS`, so an existing user
sees the caption for about 6 syncs while the first Convert walk runs (S8-Q5). A `notImported` entry
never shows the caption. It has its own
line (section 6, "Not-imported line"), because nothing about it is pending.

### Stays Binance-specific (`src/crypto-sync/binance/`)

Client and endpoint parsers (`binance.client.ts`, `binance.history-client.ts`), the host, HMAC key
header, weight headers, cooldown (`binance.cooldown.ts`), credentials field UI
(`BinanceCredentialsField`), holding keys and wallet maps (`binance.holding-keys.ts`, `walletOf`,
`walletType` maps), each walk file (capital, Pay, Transfer, Earn, and the new Convert, dust,
trades, P2P, fiat walks), the lane numbers and `COSTS`, the depth constants and error
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
bound, or a malformed one (`refused`, `binance.provider.ts`), is never truncated: that coin alone
is skipped, its holding keeps its last balance (a failed wallet is a different case), the row is a per-record stop owed at its point, the ticker joins
`exchange_state.oversizedCoins` (its balance list, kept per wallet in `balanceByWallet`, for a
balance; its history list for a row; C-NR8), and the account detail shows `accountDetail.oversizedAmount` (section 10) for the sorted
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
  Current: `GET /api/v3/klines?symbol=<binanceSymbol>&interval=1d&limit=1` (weight 2), accepted
  only if the candle's UTC open day is today. Dated history: the same path with `startTime`,
  `endTime` and `limit` (weight 2, up to 1000 days per call); a series that ends before yesterday
  UTC (a halted pair) is no price. Rows carry `source = 'binance'`. Settled marks come only from
  CoinGecko's own answer, an unexpired empty mark also holds while every stored row of the coin
  is Binance's, and a coin leaves the rate-limit rotation only when its Binance series reaches the
  range start. `data-api.binance.vision` is a later option (Binance's docs recommend it for
  public market data); set 5 keeps `api.binance.com` by ruling D1. The
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
  a Funding or Earn wallet failed (that wallet keeps its last good balance) leaves only the
  not-tracked list as stored; the oversized list is patched per wallet (`balanceByWallet`). Every history read (capital, Pay, Transfer, Earn
  and the later streams) imports no row for a record of such a coin (a pair with one untracked
  side keeps the tracked leg, section 6) and adds its ticker to the history list, which only grows
  and is cleared on disconnect (C-NR8). "Joins the not-tracked line" in sections 5 and 6 means
  this history-list add. The account detail lists the sorted union of the two lists, without
  duplicates and without a ticker the exchange's tracked rule accepts now (`isTrackedBinanceAsset`;
  the coin list grew since it was stored) (`accountDetail.untrackedCoins`, reason "not on Kiko's coin list").
- LD* (R-Tech, probe P9): an asset whose code is `LD` + X, where X is a tracked asset
  (`isTrackedBinanceAsset`; LDEUR is hidden) or an asset in this run's Simple Earn positions, is an
  Earn receipt token (`isReceiptToken`). It is skipped in Spot (Earn is read from the Earn
  endpoints) and never priced. `LDO` and other real coins starting with LD pass, because the rest
  of their code is neither.
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
  `isCurrencyAllowedForHoldingType`); only the fiat codes in `BINANCE_FIAT_CODES`
  (`binance.tracked-coin.ts`: UAH USD EUR GBP AED ARS AUD BRL COP CZK IDR JPY KZT MXN NGN PLN RON
  THB TRY ZAR) qualify; another fiat is a not-tracked ticker. The list is the Kiko fiat codes that
  are quote assets of `GET api/v3/exchangeInfo`, a snapshot: a new Binance fiat needs a list
  update. SCR and MNT are not tracked (the same code is another asset on Binance). The
  authoritative list would be `isLegalMoney` in `/sapi/v1/capital/config/getall` (signed).
- `ProviderBalance` gains `currency: Currency`; `runBalanceSyncInner` writes it instead of `'BTC'`.
  `fetchBalances` reads all assets from the four existing calls (no new call; `asset=` dropped from
  the funding and Earn reads).
- Appear: a holding is created on the coin's first balance at or above `dustBelow` (fiat: any
  non-zero balance) or on its first imported row (`placeWalletRows` creates the target at zero).
  A dust row is a first imported row: a tracked source coin with no Spot holding gets it created
  at zero by the dust read (S9-Q4 A, user; it amends R-Q6 "dust creates none").
- Stay: an existing holding is written every good read, a zero included; it is never archived by
  the sync. A balance below `dustBelow` with no holding and no row creates none (a dust
  conversion row is a row: see "Appear").
- Spot anchor: a Spot read failure fails the balance sync as today; no zero Spot holding is created
  for a coin never held. The zero Spot BTC anchor (written whenever NO Spot BTC holding existed,
  also when the amount was refused) was removed in set 6 step 5 (`b24eaab8`) together with the four
  walk guards; an existing Spot BTC holding with a refused amount keeps its last balance.
  COORDINATOR RULING 2026-10-19 (Spot BTC dust): with the anchor gone, a Spot BTC below its dust
  threshold (0.00001 BTC, `dustBelow` in `coins.ts`) with no stored holding creates no holding,
  like every other coin (the "Appear" rule); an existing Spot BTC holding stays (the "Stay" rule).
  Pinned by `binance.provider.coin-lists.test.ts` "writes no Spot BTC holding for a dust amount
  while none is stored" and `binance.provider.test.ts` "writes an existing Spot BTC holding below
  its dust threshold".
  Set 6 Q1 = B (coordinator ruling on the user's standing approval for Binance edge cases,
  2026-10-19): the balance-sync time is stamped in `exchange_state` (JSON, no migration) and "Last
  sync" reads it, so an account with no tracked holding never shows "Never" after the anchor goes.
  Steps 4 and 5 are never merged apart.
  ACCEPTED DISPLAY GAP (display only, no data effect), coordinator
  2026-10-19: an account whose `exchange_state` top level is malformed cannot get the balance-sync
  stamp, so an account with no holding shows "Last sync: Never"; that account already shows the
  paused-history caption.
- Set 6 Q3 = A (coordinator ruling, standing approval, 2026-10-19): the oversized-history list
  patch is written on every span read that meets the stop, committed or not.
- Set 6 Q5 = A (coordinator ruling, standing approval, 2026-10-19): `amount-malformed`,
  `amount-precision` and `amount-too-large` join `TRANSFER_FORWARD_OWES` and `EARN_FORWARD_OWES`.
- Set 6 Q4 = B (coordinator ruling, standing approval, 2026-10-19; PINNED in step 5): a capital row
  already stored, re-read while no Spot holding exists, is left out of the write; new rows still
  import.
- Wallet failures keep today's rule per wallet (`walletRead` returns `null` and leaves every
  holding of that wallet at its last good balance).
- Names: `Binance <Wallet> · <CODE>` ("Binance Spot · USDT", "Binance Funding · EUR",
  "Binance Earn · BTC"); proper nouns, the same in en and uk, written on insert only.
- BTC rename: `ProviderBalance.renameFromDefault` becomes `renameFromDefaults: readonly string[]`.
  Spot BTC renames from `'Binance BTC'` or `'Binance Spot'` to `'Binance Spot · BTC'`; Funding BTC
  from `'Binance Funding'`; Earn BTC from `'Binance Earn'`. The rename runs once per holding, at
  the FIRST upsert that carries `renameFromDefaults`; that upsert then sets the mark
  `defaultNameRenameSettled` (metadata, carried through upserts and kept through a `.kiko`
  round trip) whether or not it renamed. A user name equal to an old default before the first
  marked sync is renamed once; after it, never. A user-edited name never matches
  (`holding-keys.ts`, `holdings.repo.ts`, `holding-metadata.ts`).

## 5. Binance history streams

Every stream reads account-wide (no coin filter) and runs after the balance read. Each runs in its
own `logOnFailure`, on its own lane, with its own `WalkMarks` (R-Tech). The order in
`runBinanceSyncAndImport` is: balance, capital, Pay, Transfer, Earn, Convert, dust, P2P, fiat
orders, fiat payments, trades.

Weight headers are read per endpoint (`X-SAPI-USED-IP-WEIGHT-1M`, `X-SAPI-USED-UID-WEIGHT-1M`).
Probes 3 and 4 show a separate UID count for each endpoint: Convert reached 72000 in the same
minute that P2P reached 51300. The run budget keeps the last header it read (`usedUidWeight` in
`createBinanceRunBudget`, `binance.history-budget.ts`; `createBinanceHistoryRun` only wraps it)
and checks it against `UID_WEIGHT_BUDGET_1M = 180_000`. The `/api/*` endpoints share one IP limit
of 6000 a minute (`X-MBX-USED-WEIGHT-1M`), budgeted at `API_IP_BUDGET_1M = 3000`. Weights were
measured by probes 2-5 ("Measured weights" below). Section 12 lists the facts that are still open
and their safe defaults.

| Stream | Endpoint | Window / lookback | Paging | Weight (measured) | Lane cap | Cursor | Probe |
|---|---|---|---|---|---|---|---|
| Capital deposit | `GET /sapi/v1/capital/deposit/hisrec` | 89 d / 2017 floor | offset, 1000 | IP 1 (probe 2) | unbounded (IP reading) | `walks.capital` | P16 open (no deposit on the account) |
| Capital withdraw | `GET /sapi/v1/capital/withdraw/history` | 89 d / 2017 floor | offset, 1000 | UID 18000 (not re-measured) | 9 | `walks.capital` | - |
| Pay | `GET /sapi/v1/pay/transactions` | 89 d / 18 mo + 10 d (`payFloorMs`); probe 3 was served up to 533 days back, and older windows were refused 403004 | none (halving), 100 | UID 3000 (probe 3: 24000 over 8 calls) | 20 | `walks.pay` | P12 settled |
| Transfer | `GET /sapi/v1/asset/transfer` x 20 types | 30 d / 179 d | `current`, 100 | IP 1 | 80 + 397 narrowing | `walks.transfer` | - |
| Simple Earn | 6 history endpoints | 30 d / 2022-01-01 | `current`, 100 | IP 150 budgeted (probe 2 measured 50 on `rewardsRecord` and on each position read; the budget stays at 150) | 30 | `walks.earn` | P11 open (no reward row) |
| Convert | `GET /sapi/v1/convert/tradeFlow` | 30 d / `HISTORY_FLOOR_MS`; empty windows never stop the walk; probe 5: no refusal back to the floor (C-NR-C; R-Walk A) | `limit` 1000 + `moreData`: a window with `moreData` halves | UID 3000 (probes 3-5) | 20 | `walks.convert` | P4 settled |
| Dust | `GET /sapi/v1/asset/dribblet` | last 100 records, after 2020-12-01 | none | IP 1 (probe 2) | 1 | none (every run; keys dedupe) | P7 partly settled (empty shape measured; no dust record on the account) |
| P2P | `GET /sapi/v1/c2c/orderMatch/listUserOrderHistory`, `tradeType` BUY and SELL (2 series) | 30 d / `HISTORY_FLOOR_MS`; empty windows never stop the walk; probe 5: no refusal back to the floor (C-P2P-stop; R-Walk A) | `page`/`rows` 100 | UID 900 (probes 3-5) | 10 | `walks.p2p` | P5 settled |
| Fiat orders (no real row observed) | `GET /sapi/v1/fiat/orders`, `transactionType` 0 deposit, 1 withdraw (2 series) | 2 years (probe 3: a 2-year span was accepted) / `HISTORY_FLOOR_MS`; probe 5: no refusal back to the floor (C-NR-D; R-Walk A) | `page`/`rows` 500 | UID 45000 (probes 2, 3, 5) | 3 | `walks.fiatOrders` | P6 partly open (C-NR-E) |
| Fiat payments (no real row observed) | `GET /sapi/v1/fiat/payments`, `transactionType` 0 buy, 1 sell (2 series) | 2 years (probe 3: accepted) / `HISTORY_FLOOR_MS`; probe 5: no refusal back to the floor (C-NR-D; R-Walk A) | `page`/`rows` 100 | IP 1 (probe 3: 18 at most over 22 calls; probe 5) | 10 | `walks.fiatPayments` | P6 partly open (C-NR-E) |
| Spot trades | `GET /api/v3/myTrades?symbol=&fromId=` per symbol | none (id cursor) / from id 0 (probe 3: the oldest trade, 2025-01, was served) | `fromId`, 1000 | IP 20 (`/api/*`; probe 3: 20 in 8 of 8 calls) | 100 calls | `trades.symbols[s].fromId` | P1, P2, P3 settled |
| Order fills | `GET /api/v3/myTrades?symbol=&orderId=&fromId=` (an order re-read, below) | - | `fromId`, 1000, until a short page; `floor(f / 1000) + 1` calls, where `f` is the order's own fills | IP 5 per page (`/api/*`; probe 3: 5 with `orderId`, 5 with `orderId` + `fromId`) | shares the trades lane | `trades.symbols[s].heldOrderId` | P15, P15b settled (PASS) |
| Symbol list | `GET /api/v3/exchangeInfo?showPermissionSets=false` (public, no key) | - | - | IP 20 (`COSTS.exchangeInfo`, `/api/*`; probe 3: 681 over 34 calls) | 1 per run (`LANE_CALL_CAPS.tradeSymbols`) | - | P2 settled |

### Refused window and walk direction (Convert, P2P, fiat)

Refusal codes (settled by probe 5):
- A window is refused when the walk's depth classification (`DepthGuard.isRefusal`,
  `binance.history-depth.ts`) reads the response as Binance refusing a start older than it keeps.
  Today that is -5026 only: `requestFailedOf` maps `HISTORY_TOO_OLD_CODE = -5026` to
  `BinanceHistoryTooOldError` (`binance.client.ts`). No `src/` code handles 403004; Pay relies on
  `payFloorMs`. The -5026 handling stays as it is.
- Probe 5: no refusal observed back to `HISTORY_FLOOR_MS` on Convert, P2P, fiat orders or fiat
  payments; set 8 adds no refusal code to `requestFailedOf`. Probe 5 asked one series per endpoint
  (P2P BUY; fiat `transactionType` 0) with one 30-day floor window, not the walk's 2-year fiat
  window. Each of the four endpoints answered that window (it starts at `HISTORY_FLOOR_MS`
  1499990400000) with HTTP 200 and 0 rows ("SERVED-EMPTY"): 5 calls, 0 retries.
- So the walks read every window from `HISTORY_FLOOR_MS`, and empty windows never stop them. An
  empty answer does not prove Binance keeps data that far back, but no refusal exists to map.
- The `DepthGuard` narrowing stays wired as a safety net only, with no expected trigger, for P2P
  and the fiat walks. Convert does not use it (S8-C1, below).

Walk direction (R-Walk A, user, 2026-10-16):
- Each walk reads FORWARD from `HISTORY_FLOOR_MS` toward now, as `buildWalkWindows` does, with its
  cursor moving forward.
- Safety net (P2P and fiat; NOT Convert): a start answered -5026 would be narrowed by `DepthGuard`
  to the served depth; the ground below that depth is not owed, and the walk goes on forward. It
  never ends the walk. Probe 5 expects no such answer.
- Convert (S8-C1): Convert does not use `DepthGuard.isRefusal`; `BinanceHistoryTooOldError`
  propagates. A -5026 on Convert fails the run, is logged, the marks stay and the history caption
  shows once the Convert cursor lags more than a day (`isBinanceHistoryBehind`), as Pay does.
  Cost: if Binance ever adds a Convert depth, the sync fails visibly every run until an app
  update; never a silent loss.
- Empty windows never stop a walk.
- Recent records arrive last: a first walk reaches the newest windows only after it has read every
  older window. The runs until recent records appear are in "The lane caps are starting values"
  below.

Failures: any other 4xx is a failure, not a stop. The window and the cursor stay, and the next run
reads the window again. That covers a -1021 still failing after its retry, -1127, and any code
other than -5026. Probe 5 saw none (0 retries, no refusal pair). 418 and 429 keep the cooldown
rule.

### Measured weights (probes 2-5)

Each value is the change of the endpoint's weight header between calls. Every value is a count,
not an amount.

| Endpoint | Header | Per call | Evidence |
|---|---|---|---|
| `myTrades` (symbol, no `orderId`) | `X-MBX-USED-WEIGHT-1M` | 20 | probe 3 P15: "20=8" |
| `myTrades` with `orderId`; with `orderId` + `fromId` | `X-MBX-USED-WEIGHT-1M` | 5; 5 | probe 3 P15: "240 245 250 255 260" |
| `exchangeInfo` (one symbol) | `X-MBX-USED-WEIGHT-1M` | 20 | probe 3: 681 after 34 calls |
| `account` | `X-MBX-USED-WEIGHT-1M` | 20 | probes 2 and 3 |
| P2P `listUserOrderHistory` | `X-SAPI-USED-UID-WEIGHT-1M` | 900 | probe 3: "UID weight of one call: 900"; probe 4: 51300; probe 5: 900 after 1 call |
| Convert `tradeFlow` | `X-SAPI-USED-UID-WEIGHT-1M` | 3000 | probe 3: 75000 after 25 calls; probe 4: 72000 after 24; probe 5: 3000 after 1 call |
| Pay `transactions` | `X-SAPI-USED-UID-WEIGHT-1M` | 3000 | probe 3: 24000 after 8 calls |
| fiat `orders` | `X-SAPI-USED-UID-WEIGHT-1M` | 45000 | probe 3: 45000, 45000, 90000, 135000 after calls 1-4 (the first two calls fell in separate minutes); probe 5: 45000 after 1 call |
| fiat `payments` | `X-SAPI-USED-IP-WEIGHT-1M` | 1 | probe 3: 18 at most after 22 calls; probe 5: IP 1, no UID header |
| `dribblet`, `deposit/hisrec`, `get-funding-asset` | `X-SAPI-USED-IP-WEIGHT-1M` | 1 | probe 2 |
| Simple Earn `rewardsRecord`, `flexible/position`, `locked/position` | `X-SAPI-USED-IP-WEIGHT-1M` | 50 | probe 2 (one call each; the walk budgets 150) |

Per run, at the lane caps:
- P2P: 10 x 900 = 9000 UID.
- Convert: 20 x 3000 = 60000 UID.
- Fiat orders: 3 x 45000 = 135000 UID.

Each is at or under `UID_WEIGHT_BUDGET_1M = 180_000`. The budget check is `canAfford`: used + cost x
(keep + 1) <= 180000. Concrete fiat-orders cases, pinned in set 12:
- After 3 fiat-orders calls in a run, the lane cap (3) refuses a 4th, even though the budget alone
  would allow it (135000 + 45000 = 180000 <= 180000).
- At the first fiat-orders call, a last header reading 135001 or more (another reader's weight in
  the same minute) refuses the call. A last header reading 135000 allows the call.

The lane caps are starting values. Set 11 measured the trades lane (probe 9, S11-Q2, on the user's
account, at the 350 ms gate): a backfill run took 7 calls, 40 records, 6.9 s and a `/api/*` weight
peak of 151; a caught-up run took 7 calls, 0 records, 7.9 s and a peak of 200; there were 0
throttle waits. One run at the cap of `LANE_CALL_CAPS.trades` (100) covers it, so the cap stays.
The limit: only the coins held now were walked, so the numbers are a floor. Set 12 does the same
for P2P, Convert and fiat.

First walks at the starting caps, over the span from `HISTORY_FLOOR_MS` (2017-07-14) to 2026-10:
about 3380 days, so about 113 windows of 30 days per series. Probe 5 found no refusal, so every
window is read. The walk reads forward from the floor (R-Walk A), so recent records arrive last.
Each P2P and fiat window reads both series (`readSeriesSpan`), so it costs 2 calls.

| Walk | Windows x series | Calls | Lane cap | Runs | Runs until the user's records appear |
|---|---|---|---|---|---|
| P2P (30-day windows) | 113 x 2 | 226 (x UID 900 = 203400 UID) | 10 (5 windows a run) | 23 | first order (about 2023-09, window about 75): by run 15 at the latest (older orders may exist); newest (2026-10, window 113): run 23 |
| Convert (30-day windows) | 113 x 1 | 113 (x UID 3000) | 20 | 6 | the 2026-01 conversion (window about 104): run 6 |
| Fiat orders (2-year windows) | 5 x 2, then 3 owed days x 2 and 2 re-scans x 2 | 12 to reach now, 20 until complete (x UID 45000) | 3 | 6 to reach now, 10 until complete (S12-Q18, S12-Q21, S12-Q22, S12-Q23) | no fiat order on the account |
| Fiat payments (2-year windows) | 5 x 2 | 10 (IP 1 each) | 10 | 1 | no fiat payment on the account |

The caption shows until each walk is current. The UID budget alone would allow about 200 P2P calls
a minute (180000 / 900), so for P2P the lane cap, not the budget, sets the number of runs.

What a run is (re-grepped 2026-10-16). A Binance history run happens only on these triggers:
- each cold launch, unless the first bank account synced within 5 minutes (the whole on-open sync
  is skipped then): `useAutoSync()` in `App.tsx`. Its 5-minute throttle (`AUTO_SYNC_INTERVAL_MS`,
  `src/sync/use-auto-sync/use-auto-sync.ts`) reads only the `lastSyncAt` of the first bank
  account (`bankAccountIdFor`), never the crypto account's own;
- each Home pull-to-refresh: `useSyncAll(accounts)` in `home.screen.tsx` through
  `useRefreshControlSignal`, with no throttle;
- each manual re-sync in the account detail: `sync(resyncRequest(...))` in
  `crypto-sync-section.component.tsx` (also `connectThenReplan`);
- each connect: `connectBinance` / `connectWallet` in `account-form.screen.tsx` (`syncCrypto`).

There is no background, resume or timer trigger. So the newest P2P orders appear after about 23
launches or pulls. Balances are right from the first run, because the balance read runs before every
history walk and never waits on one (R-Tech).

A cap changes only with a measured reason (memory "bounds are measured"). The P2P lane is the first
candidate, because its runs count is set by the cap; the P2P cap moves to set 12, which may raise
it only with a measured reason (R-Walk A). Set 11 left it alone.

### Capital (deposits, withdrawals)

`coin=` is dropped. Placement by `walletType` (0 Spot, 1 Funding, else stop
`capital-wallet-unknown`), settled statuses (deposit 1, withdraw 6; one rule,
`isCapitalSettled(kind, status)`), keys `${accountId}:deposit:<id>` / `${accountId}:withdraw:<id>`
unchanged. Description = the coin code (as BTC today). Withdrawals stay spending (R-Q12).
Rulings (coordinator, standing approval, 2026-10-19): a record that is NOT settled is counted
whatever its coin and never listed; a SETTLED record with a blank or non-string coin is
unreadable and owed. m3 = A: a BTC key is byte-identical; a non-BTC record whose key falls back to
the `txId` (Binance omitted `id`) appends `:<COIN>`, an `id` is never changed (condition checked:
every main version that reads capital sends `coin=BTC`, and no set 6 commit reached a device, so
no stored non-BTC capital row has the bare form).

### Pay (R-Q7)

- An order in any tracked coin (`isTrackedBinanceAsset`) imports. Direction and placement rules stay (history spec section
  4: uid direction, R22 receive placement by date, `walletTypes`/`walletAssetCost` split).
- Funds: one row per `fundsDetail` entry with a tracked `currency`, per wallet in its
  `walletAssetCost`, amount = that wallet's cost in that coin, on that coin's wallet holding. The
  costs of each coin must sum to that entry's `amount`, else `pay-split-mismatch` as today.
- Cross-coin: an order in X paid with Y gets Y rows (no X row, no implied conversion). `comment` =
  `<amount> <X>` (Binance's own decimal string and code; no words), written on insert only.
- A funds entry in an untracked coin imports no row; its ticker joins the history list of
  `untrackedCoins` (C-NR8), so the not-tracked line keeps it after the next balance read.
- An order in an untracked coin paid with a tracked coin (set 6 Q2 = A, USER ANSWER 2026-10-19):
  the tracked funds rows import (the Y3/Y4 cross-coin rule) and the order's ticker joins the
  not-tracked line.
- A receive imports one row in the order's coin (funds describe the payer side).
- Keys: a BTC-funded row of a BTC order keeps
  `${accountId}:pay:${orderType}:${transactionId}:${walletType}` byte-identical; every other row
  is `...:${walletType}:${currency}`.
- Stops `pay-btc-funded-other-coin` and `pay-funds-not-btc` are removed.
- Rulings (coordinator, standing approval, 2026-10-19):
  - Listing by direction: on a RECEIVE the not-tracked line lists only the order's own coin; the
    coins of `fundsDetail` are listed only for a SEND (the uid's direction for a tracked order,
    the sign of the amount for an untracked one; a zero or unreadable amount has none and lists
    its own coin only).
  - Split: costs add up exactly and round once, wallets in ascending order, each share the step of
    the rounded running sum; a share of 0 units has no row.
  - m2 = B: an order whose own amount rounds to 0 units at its coin scale imports no own-coin row,
    is not listed and does not stop the walk; an unparseable amount still stops. The funds rows of
    ANOTHER tracked coin beside it import per Q2 A (a mixed-coin dust send imports each coin's
    rows); funds of its own coin that are not dust stop `pay-split-mismatch` only when ALL funds
    are in the own coin, whatever their cost shape.
  - m3 = C: for an untracked order only a funds entry with a blank or non-text currency (or that
    is no object) is unreadable and owes its point; an absent or non-array `fundsDetail` is
    counted.
  - A negative cost (also one that rounds to 0 at a reduced scale) or a negative funds entry stops
    `pay-amount-invalid`: a sign error, not dust, as BTC stops every negative text. A zero entry
    keeps no row. The text of every entry is parsed on the costed path too, so an unparseable or
    over-precise entry stops there (`addNonNegative`).

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

Rulings (coordinator, standing approval, 2026-10-19): the pair id of a Transfer or Earn move is
`exchangePairIdOf(id, coin)`: BTC byte-identical, any other coin appends `:<COIN>` (capital and
Pay build no shared pair id). An untracked record lists its ticker only when it is settled:
Transfer `CONFIRMED`, Earn subscription `SUCCESS`, redemption `PAID` (a locked one listed with
`isComplete` false, as it is never parsed), a reward always (it has no status); an unsettled one
is counted by its point and not listed. A settled record with a blank asset (rewards included) is
unreadable and owes its point, never untracked; an unreadable reward at time T holds every reward
group of its kind at T whatever its coin. The settled constants live in
`binance.history-client.ts`.

### Convert

Each record is decided in this order. Status comes first; only a settled record goes on to the
wallet check.
1. `orderStatus`:
   - `SUCCESS` (probe 4: SUCCESS=1) goes on to step 2.
   - `PROCESS` and `ACCEPT_SUCCESS` owe their point; no other field is checked until the record is
     settled.
   - `FAIL`: no row and no entry, whatever its `walletType` (C10).
   - Any other word is refused into `notImported` (`convert-unrecognized`).
2. `walletType` (C-Convert-wallet):
   - `FUNDING` -> Funding (wallet key `<CODE>:funding`).
   - `SPOT` -> Spot (`<CODE>`).
   - A missing or null value, or any other word, is refused into `notImported`
     (`convert-unrecognized`) and writes no leg. `SPOT_FUNDING`, for example, does not say which
     wallet each part came from.
   - A SUCCESS record on an allowed wallet with a blank (`''` or absent) asset is a
     `convert-unrecognized` entry and owes nothing (F5). A zero or negative amount, or a missing
     amount of a tracked side, stays owed. This is Convert only: Transfer and Earn still owe a
     blank asset.
   - A SUCCESS record with one asset on both sides is a `convert-unrecognized` entry, no row
     (S8-Q6).
   - Probe 4: `walletType` FUNDING=1. The user's one conversion (UAH -> USDT, 2026-01) lands on
     "Binance Funding · UAH" and "Binance Funding · USDT".
3. Rows:
   - One Exchange pair per `quoteId`: `fromAsset -fromAmount`, `toAsset +toAmount`, both on that
     wallet.
   - Pair id `${accountId}:convert:${quoteId}`; leg keys `${pairId}:<walletKey>`. The id is the
     `quoteId` (a non-empty string), never `orderId`, a JSON integer past 2^53 on the measured
     record (S8-Q1, probe 6). A record with no `quoteId` is unreadable and owes its point. The key
     is fixed once shipped, since a change would import every re-read twice.
   - No fee field (the fee is in the rate).
   - A fiat side (UAH, EUR) is a fiat holding leg.
   - A side whose coin is not tracked: the tracked leg alone, with `untrackedCounterpart =
     asset:<CODE>` and no `exchangePairId`; its ticker joins the not-tracked line (section 3).

Window and depth:
- The window is 30 days. That is the documented limit; probe 3 found a 31-day span accepted, which
  is not relied on.
- The walk covers `HISTORY_FLOOR_MS` (2017-07-14; C-NR-C) to now, and empty windows never end it.
  In the user's account, 23 of the 24 windows read were empty, and a stop after 6 empty windows
  would end before the 2026-01 conversion (C8).
- Probe 5: no refusal back to the floor, so every window is read.
- A -5026 start is not narrowed: it fails the run (S8-C1, "Refused window and walk direction").
- S8-C2 (default A while the user decides): a -5026 on an OWED Convert point (read after the
  forward walk) fails every run with only a log line and no caption, and later owed points wait.
  Accepted as dormant (probe 5: no Convert depth); the same as Pay.
- R-Walk A: the walk reads forward from the floor ("Refused window and walk direction" above).
  Recent conversions arrive last: the 2026-01 conversion appears at about run 6 of 6.

### Dust

One read, no params, every run (`LANE_CALL_CAPS`, `COSTS` in `binance.history-budget.ts`; no
cursor, no walk entry). It is no walk: it runs after Convert in `runBinanceHistoryWalks`
(`run-crypto-sync.ts`; read the order there), under its own failure tag
`[binance sync] dust history failed`. Every `userAssetDribbletDetails` entry of a record maps to
rows; `addManyDedup` keys drop the ones already imported.
- Record: `transId` is the RECORD's (a non-empty text or a safe integer; else the record is
  unreadable) and `operateTime` a finite number. The entry list must be a non-empty array of
  objects: an absent, empty or malformed one makes the record unreadable (S9-Q8), logged, never
  half-read. An unreadable record is logged as `dust-row-unreadable` and re-read while it is among
  the newest 100.
- Rows: per entry, an Exchange pair `fromAsset -amount` (Spot) / BNB `+received` (Spot), both legs
  on Spot, where `received` is `transferedAmount`, the net BNB the wallet got (`serviceChargeAmount`
  is never read). Pair id `${accountId}:dust:${transId}:${fromAsset}`; leg key
  `${pairId}:<Spot holding key>`; `operation = 'dust'`. An untracked `fromAsset`: the BNB leg alone
  with `untrackedCounterpart = asset:<fromAsset>`, no pair id, and its amount never read.
- `targetAsset` (S9-Q7): an entry is accepted only when it is BNB (the match ignores case and
  padding). Absent, blank or another coin is refused as `dust-row-unreadable`; a non-BNB target is
  a later-set question.
- Refused entry: a blank `fromAsset`, BNB as `fromAsset`, or a `fromAsset` that repeats in the
  record refuses ALL its entries (two entries of a coin would share a pair id). The record's other
  entries still import. Stop codes are the constants in `binance.dust-history.ts`
  (`dust-row-unreadable`, `dust-amount-invalid`, `dust-holding-missing`), each logged once per code
  per run.
- Zero rule (S9-Q2): an entry with a leg that rounds to 0 units gives no row for either
  leg (no half pair) and no log. A negative amount is
  `dust-amount-invalid`; an amount past the safe integer joins the oversized list.
- Empty shape (S9-Q3, probe 7): `{"userAssetDribblets":[]}`, `total` absent, is no dust: nothing is
  written or logged. A missing or non-array list fails closed (a parse error, logged under the
  failure tag). `total` is never read.
- Rate limit: it sets the account's cooldown and ends the read with no log, as Convert and Pay do.
- Holdings: a tracked source coin with no Spot holding gets it created at zero (S9-Q4 A);
  `dust-holding-missing` is only the placement's defensive code.
- Not-tracked line (S9-Q10, decision): an untracked coin's dust entry joins the line only when its
  BNB leg imports; a 0-amount or malformed entry lists nothing.
- Console (S9-Q9): `row-precision-rounded` is logged per rounded amount on every run, so a sync
  with dust prints many lines (console only); accepted, with a run-log gap.

Records beyond the last 100 are lost; the not-listed note names them.

### Dividends (removed from 1.3-a)

Probes 2 and 3 read `GET /sapi/v1/asset/assetDividend` in 7 windows of 180 days back 3 years and
found 0 dividends (probe 3 "DIVIDENDS": "dividends: 0"). No `enInfo` value can be put on an
allowlist, so by this section's own rule the dividend walk is not in 1.3-a. Nothing of it ships:
- no reader;
- no `'dividend'` walk id;
- no lane;
- no `reward` operation code;
- no V1 or V2 cases;
- no demo reward row and no "Reward" words.

No dormant reader stays (section 1, release rule). The not-listed note keeps "distributions other
than Simple Earn rewards". A later version adds the walk with an allowlist taken from an account
that has dividends.

### P2P

Depth (C-P2P-depth, C-P2P-stop):
- The walk covers `HISTORY_FLOOR_MS` to now in 30-day windows. Empty windows never stop it, and an
  order behind 7 or more empty windows is found (P6).
- Probe 5: no refusal back to the floor (the 2017-07 window was served empty), so every window is
  read.
- R-Walk A: the walk reads forward from the floor ("Refused window and walk direction" above).
  Recent orders arrive last: 226 calls over 23 runs; the user's first order appears by run 15 at
  the latest (older orders may exist) and the newest at run 23.
- Probe 4 found rows in 31 of 38 windows back to about 2023-09, and the oldest window had rows.
- The walk stays inside its lane (10 calls a run, UID 900 each) and the UID budget. A run that ends
  mid-walk stores its cursor, and the next run goes on from there.
- The walk reads both series (BUY, SELL). The SELL series is read so that SELL orders can be
  counted (C-P2P-SELL-MAKER).

Each order is decided in this order. Status comes first; only a `COMPLETED` order goes on to the
side and role checks, and each order gives at most one row or one entry.
1. `orderStatus`. Probe 3 saw COMPLETED, CANCELLED and CANCELLED_BY_SYSTEM.
   - `COMPLETED` goes on to step 2.
   - `CANCELLED` and `CANCELLED_BY_SYSTEM` are not money movements: no row and no entry. A
     cancelled order can still carry `takerCommission > 0` (probe 4: 3 cancelled orders in the
     fee-bearing count); it is ignored all the same.
   - `PENDING`, `TRADING`, `BUYER_PAYED`, `DISTRIBUTING` and `IN_APPEAL` are open. Each owes its
     point until it is final, whatever its side or role: an open SELL gets no entry until it is
     settled (P3d). The developer checks these five words against Binance's documented
     `orderStatus` list on the base.
   - Any other word -> `notImported` (`p2p-unrecognized`).
2. `tradeType`:
   - SELL -> `notImported` (`p2p-sale`). SELL wins over every role, so a SELL + MAKER order gives
     exactly one `p2p-sale` entry (P2d).
   - BUY goes on to step 3.
   - Any other word -> `p2p-unrecognized`.
3. `advertisementRole`:
   - MAKER -> `notImported` (`p2p-advertiser`).
   - TAKER goes on to step 4.
   - Missing, or any other word -> `p2p-unrecognized`.
4. Amount (C-P5, C-NR-B):
   - `takerAmount` present: the row is `+takerAmount`. When `amount` and `takerCommission` are also
     present and `amount - takerCommission` differs from it in minor units, the order goes to
     `p2p-amount` instead. When either of those two is absent, `takerAmount` stands (P1g).
   - `takerAmount` absent: the row is `amount - takerCommission`. Each value is parsed exactly at
     the asset's scale by the decimal parser (`src/currency/decimal/decimal.ts`) and subtracted as
     integers in minor units.
   - `takerAmount` absent and `takerCommission` or `amount` also absent -> `p2p-amount`
     (C-NR-B; P1e, P1h).
   - A value with more decimals than the asset's scale is the per-record stop `amount-precision`,
     owed at its point (section 3). A value that is not a plain decimal is `amount-malformed`.
   - Probe 4: `takerAmount = amount - takerCommission` in 69 of 69 fee-bearing orders. All of
     `amount`, `unitPrice`, `totalPrice`, `takerCommission` and `takerAmount` were present on all
     86 orders; the field `commission` was absent on all 86.
   - `unitPrice` and `takerCommissionRate` never decide the row or the marker. `amount x
     unitPrice` matched `totalPrice` in only 2 of 69 orders.
   - The checks of a completed taker buy run in this order: the amount fields are present
     (`p2p-amount` if neither pair is), the coin (an `asset` that is missing or blank is
     `p2p-unrecognized`; one Kiko does not track is counted and goes no further), the `fiat` and
     `totalPrice` (either missing, or a `fiat` that is empty or holds `:`, is `p2p-unrecognized`:
     no marker code can carry it, and a re-read cannot change it; S12-Q34), and last the amount
     values (`p2p-amount`, or the stops above).

Row placement:
- The row goes on the P2P wallet's holding (C-NR3: Funding; the rows name no wallet).
- A fiat asset (C-P2P-fiat-asset A): a BUY whose `asset` is a fiat code in `currencyOptions` goes on
  the P2P wallet's fiat holding ("Binance Funding · UAH", created at zero by its first row, R-Q6),
  with the same row, marker and label rules. The R-Q14 matcher pairs its bank debit like any P2P
  buy (M14).
- An `asset` the tracked rule (`isTrackedBinanceAsset`) does not accept: the record is COUNTED, no
  row is imported, and its ticker is added to `untrackedCoins.history` (a not-tracked line entry).
  Such a record is counted and imports no row. A tracked history record is never skipped: an
  oversized or malformed amount stops the walk at that record and owes its point.

Not-imported entries (C-P2P-SELL-MAKER B, C-NR-A):
- Each entry is `<kind>:<orderNumber>:<createTime>`. The cursor moves past the order. The account
  detail counts the entries (section 6, "Not-imported line"), and the not-listed note (section 10)
  names "P2P sales and P2P orders you placed as an advertiser".
- Planned follow-up, not in 1.3-a: the analogy rule. A SELL debit = `amount + takerCommission`, with
  the fee in the spent coin (C-NR2). It is enabled after a probe on an account with such orders, and
  the follow-up owes the stored points again.

Marker and note:
- `untrackedCounterpart = p2p:<fiat>:<totalPrice>`. `totalPrice` is taken as Binance gives it and
  normalized only by the C-NR1 marker rule (section 5, "Fiat orders ...", "Marker total": trailing
  zeros past the fiat's scale drop, missing ones pad, and a non-zero digit past the scale is
  `amount-precision`). It is never computed from `amount x unitPrice` (C-P5).
- `comment` = `<totalPrice> <fiat>`, for display only.
- `operation = 'p2p'`.

Privacy and key:
- No counterparty field is read into a type (privacy, section 9). This covers
  `counterPartNickName`, `advNo`, `payMethodName` and `additionalKycVerify`.
- Key `${accountId}:p2p:${orderNumber}:<walletKey>`.

### Fiat orders (deposit, withdraw) and fiat payments (card buy, sell)

No real row observed (C-NR-E). Probe 3 read 0 fiat orders and 0 fiat payments over 2 years, both
types. Both walks ship on Binance's documented shapes with a strict status allowlist, and fixtures
test them. Status comes first; only a settled record makes a row.

Ignored statuses: a word is ignored (no row, no entry) only when this spec quotes Binance's own doc
text for it, showing that no money moved. Set 12's plan, as its first step, quotes that text (URL,
date) for `Failed` (orders and payments) and `Refunded` (orders and payments). Until a quote is
pasted, those words are `fiat-unrecognized` too. Every word with no quote is refused into
`notImported` (`fiat-unrecognized`): owed and visible. That includes `Finished`, `Refunding`,
`Refund Failed`, `Order Partial credit Stopped` and any word not documented.

- Fiat orders (no real row observed):
  - Status: `Successful` is settled; `Processing` owes its point; ignored words and every other word
    as above.
  - Deposit: `+amount` on the fiat holding of the credited wallet (C-NR3: Spot).
  - Withdraw: `-(amount + fee)`, as the wallet moved (P6 is unverified on the user's account).
  - `untrackedCounterpart = bank:<fiat>:<indicatedAmount>` (C-NR1; the gross the bank side paid).
  - `operation = 'fiat'`; `comment` = `<indicatedAmount> <fiat>`.
  - Key `${accountId}:fiat:${orderNo}:<walletKey>`.
- Fiat payments (no real row observed):
  - Status: `Completed` is settled; `Processing` owes its point; ignored words and every other word
    as above.
  - Buy: `+obtainAmount cryptoCurrency` with `untrackedCounterpart =
    card:<fiatCurrency>:<sourceAmount>` (C-NR1), `comment` = `<sourceAmount> <fiatCurrency>`.
  - Sell: `-sourceAmount cryptoCurrency` with `untrackedCounterpart =
    card:<fiatCurrency>:<obtainAmount>`, `comment` = `<obtainAmount> <fiatCurrency>`.
  - `operation = 'card'`. Wallet per C-NR3 (Spot).
  - Key `${accountId}:fiatpay:${orderNo}:<walletKey>`.
- Windows (C-NR-D): both fiat walks read 2-year windows. Probe 3: one 2-year span returned HTTP 200
  on orders and payments, both types. They cover `HISTORY_FLOOR_MS` to now, and empty windows never
  end them. Probe 5: no refusal to the floor on either endpoint (one series per endpoint,
  `transactionType` 0, with one 30-day floor window, not the walk's 2-year window). R-Walk A: the
  walks read forward from the floor, and recent records arrive last ("Refused window and walk
  direction" above). The first fiat-orders walk is 5 windows x 2 types = 10 calls at UID 45000
  each. A lane of 3 reads one window (2 calls) a run and cannot read a forward window and the
  re-scan in one run, so the orders walk alternates (S12-Q18): a run reads behind (the owed days
  first, then the last two years, the window re-scan every walk runs) when the stored list holds a
  range and the forward ground is under one window, and forward otherwise. The run after a behind
  run always reads forward (S12-Q21), so a range that no read clears cannot keep the newest orders
  out, and the behind runs take turns on the owed days and the re-scan (S12-Q22), so such a range
  cannot keep the re-scan out either; the walk stores `behindRun` and `rescanTurn` in its
  `exchange_state` entry, and a disconnect drops them. A forward turn with no forward ground to
  read, because the clock stands at the cursor or was set back to before it, reads behind instead
  (S12-Q23): a forward read of no ground stores no overlap day, so nothing else would make the next
  run read behind and the walk would never re-scan. Such a run is complete when it leaves no range
  owed and the re-scan finished its pass. The first walk reaches now on its 6th run (4 forward
  windows, 1 owed day, then the last window), and reports complete on its 10th: the other two owed
  days and two re-scans of the last two years, each on a behind run. A re-scan read that fails (a
  page that drifts, or one that cannot be parsed) does not owe the whole window or fail the run
  (S12-Q24): the stretch it failed on is isolated and the rest of the window is read. The first
  range of the owed list the failed span holds is marked stuck (`rescanStuck` in the same
  `exchange_state` entry; a disconnect drops it) and the re-scan reads before it and after it, a
  span that holds no owed range is halved, and a span of one millisecond that fails is owed and
  marked itself; the owed runs read each stuck range on its own, and a range the list no longer
  holds, or holds only as a sliver that shares a boundary millisecond with it, leaves the mark. An
  owed range or point whose page cannot be read does not end the run in any Binance walk (S12-Q27,
  S12-Q29): the run reads the owed ground behind it, the re-scan and the points, then rejects with
  that error; a rate limit, an auth failure, a clock skew or a network failure still ends the run
  at once. A record Binance writes late is imported by the next re-scan pass, up to
  two years back, and every record Binance serves is imported within 4 x (2z + 1) runs of the run
  that first serves it, z the days in the window that fail (4 runs with none, 12 with one;
  `binance.fiat-history.properties.test.ts`). Fiat payments is 10 calls at IP 1 each, so 1 run at a
  lane of 10, with the forward read and the re-scan in the same run, and the re-scan is read on
  every run: a record is imported within 1 x (2z + 1) runs (S12-Q32), one run between two reads of
  the re-scan times the 2z + 1 reads of a first pass. A re-scan window that stops on the budget
  hands the next run the span it wanted to read next only when that span ends before the window's
  end, which moves with the clock; one that reaches the end is read afresh (S12-Q30). The piece
  of a pass after a range it failed on runs to the window's end, not to the end of the doubled span
  it was read in, so the rest of the window is not read in pieces that double from the range on
  (S12-Q32). A page that comes back full halves the read, which a world of full pages may meet
  more than once; the bound above holds for pages that are not full, and the worlds with full
  pages are held red (S12-Q33).
- Marker total (C-NR1): Binance's decimal string is normalized to exactly the fiat's scale by the
  exact decimal parser: trailing zeros past the scale drop, missing ones pad
  (`"4150"` -> `4150.00`); a non-zero digit past the scale is a per-record stop `amount-precision`
  owed at its point. Never `Number()`.

### Spot trades (R-Q11, R-Q13, C-NR2)

- Symbol discovery (set 10): once per run, one public `exchangeInfo` read on the `tradeSymbols`
  lane (weight `COSTS.exchangeInfo`, cap `LANE_CALL_CAPS.tradeSymbols`), no key, no cache; when
  it fails or the lane refuses it, no symbol is read that run, and there is no fallback to stored
  symbols (S10-Q3). The request is `showPermissionSets=false` with no `permissions` filter: the
  unfiltered body is 17.8 MB decoded, a `symbols=[...]` list holding one unlisted name is refused
  whole (HTTP 400, -1121), and `permissions=SPOT` leaves out the BREAK leveraged tokens a user
  can still hold old fills on (S10-Q5b, G1-A). The set 11 walk (`binance.trade-history.ts`) keeps
  only the rows of `tradeCandidatesOf`.
  - Candidate rule (G2-B): a symbol that is readable, with at least one touched coin and the
    other coin touched or one of `TRADE_MAIN_QUOTES`. Readable = a status in
    `TRADING_SYMBOL_STATUSES`, or a stored numeric `fromId` in any listed status (S10-Q2). The
    status words are Binance's: TRADING, END_OF_DAY, HALT, BREAK, CANCEL_ONLY. A pair of two main
    quotes with neither touched is no candidate.
  - Touched = a coin of a holding, of the four coin lists (`untrackedCoins`, `oversizedCoins`,
    each balance and history), or of a listed symbol with a stored `fromId`. A stored symbol the
    listing no longer has names no coin and stays untouched in the state.
  - Discovery gap: a pair of two main quotes that was traded, with neither coin held nor
    imported, is not found. The not-listed note names it (set 15).
  - Probe 3 (counts only): 4 candidate coins (BTC, CGPT, UAH, USDT); 9 `TRADING` and 3 `BREAK`
    symbols among the 34 looked up; trades on 1 symbol, the oldest from 2025-01. The lane cap of
    100 calls is far above that.
  - Measured weight: `exchangeInfo` 20 (S10-Q5).
- Rotation: a symbol is read this run when its base or quote balance changed since
  `trades.balanceSnapshot` (a coin with no `balanceSnapshot` entry counts as changed), when it was never read (no entry or a null `fromId`), when it holds a
  `heldOrderId`, or when its turn comes in the round-robin from `trades.rotation`. Fixed read order:
  held symbols first, in ascending symbol order; then never-read symbols; then changed symbols; then
  the round-robin. At least 1 call of the lane per run is reserved for the round-robin, so the held,
  changed and null-cursor symbols never take every call of the lane. Each of `S` candidate symbols
  is read within `ceil(S / L)` runs, `L >= 1` the calls reserved or left for rotation (memory
  "round-robin rotates units read"; property test).
- Rotation cursor (S10-Q1): `trades.rotation` is text. The round-robin runs over every candidate
  ascending by name, from the first symbol after the cursor, wrapped (`''` starts at the first);
  a symbol already read this run is skipped. Cursor-move rule: after a round-robin read returns
  (a short page, the lane end, a stop, or `failed`), the cursor is that symbol; a priority read
  never moves it; a read that stops the run leaves it before that symbol, so the next run asks
  that symbol again first. A symbol that fails every run cannot hold the cursor back.
- Reserved call: a priority read (held, never read, changed) runs only while the lane affords its
  page and one more call (`keep` 1); the round-robin reads with `keep` 0.
- Snapshot rule: a coin's `balanceSnapshot` entry takes its current text only when every candidate
  symbol with that coin ended at a short page in this run; every other entry keeps its stored
  text, so a change stays "changed" while a symbol of its coin is unread. A coin the balance read
  did not list reads as `0/0`. No snapshot patch is written when no entry would differ.
- Error policy (G2-A): an error of one symbol (`IdCursorPageError`, `BinanceHistoryParseError`,
  `BinanceInvalidSymbolError` for -1121) ends only that symbol with end `failed`; its coins stay
  unfinished, it is retried next cycle, and the trade walk logs it (fixed tag). Every other
  error (a rate limit, a refused key, an account-wide request or network failure) stops the run
  and comes back with the progress made so far, so the caller writes it first.
- Symbol failures (set 11, S11-Q6): a row the rules refuse (`BinanceWalkStop`, for example an
  amount past the safe-integer bound) joins `isSymbolFailure`: that symbol ends `failed` and is
  logged, a too-large coin is listed as oversized before any row, and the other symbols are read.
- F2 (set 11, S11-Q1): the balance texts handed to the rotation (`spotBalanceTexts`) come from
  the balance sync's own Spot read, taken BEFORE the trade reads and passed through `ProviderRead`
  and `BalanceSyncResult` (no extra `/api/v3/account` call), so a balance that moves during the
  reads is seen as changed next run. Without the texts the trade read does not run.
- Rate limit (set 11): the trade read runs last, after the other walks, in the `trades` lane
  (`LANE_CALL_CAPS.trades`; narrowing calls `LANE_NARROWING_CALLS.trades` is 0). A `myTrades` call
  costs `COSTS.myTrades` (20), a whole-order read `COSTS.orderFills` (5), both on the `/api/*`
  reading judged against `API_IP_BUDGET_1M`; `COSTS.exchangeInfo` (20) is the discovery call.
  Read the constants in `binance.history-budget.ts` for the values.
- Amount texts (set 11 G1 fix): `qty`, `quoteQty` and `commission` are read as exact unsigned
  plain decimal text (`decimalText` in `binance.history-client.ts`); any other text, such as an
  empty string, `1.2.3` or `1e-8`, fails the whole page (`BinanceHistoryParseError`), never a
  skipped fill.
- Paging (the id-cursor pager): `fromId` = the stored cursor, else 0; no time parameters (probe P1).
  Binance's `fromId` is INCLUSIVE (doc: "TradeId to fetch from", the rows are those with id >=
  `fromId`), so the pager asks last id + 1.
  After a completed read the symbol stores `fromId` = last trade id read + 1, or 0 when the read
  returned no trade, or the first fill of the read's last order when that order came to no row
  and no other order's fill is inside it (S11-Q11, `trailingOf` in `binance.trade-history.ts`), so a read symbol never stores null: null (or no entry) means only "never read",
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
  the leg and fee amounts, a bank-owned column, under the same keys). An order cut by a page
  boundary (S11-Q3) is NOT paged on: it is written from the fills seen, and its next fill (the
  next page of the same run or a later run) finds it by the key prefix and triggers one weight-5
  re-read, so no fill sits unwritten behind a stored cursor. P15b passed in probe 3: `orderId` +
  `fromId` was accepted and returned the order's fills in ascending id order, and `fromId` one past
  the last fill returned 0 rows. So the re-read pages by `fromId` (C-NR7), and C-NR4 and C-NR6 stay
  unused.
- An order is re-read at most once per run. After its re-read, a fill of the order in a later
  id-cursor page of the same run whose id is at or below the re-read's last fill id is skipped (it
  is in the re-read's set; not added, and not a trigger for a second re-read). A fill of the order
  with a HIGHER id (the open order filled again after its re-read) ends this symbol's read for this
  run at that fill: the fills before it are written, `fromId` is stored as that fill's id, unless the order the page
  ended on before that fill came to no row (and no other order's fill is inside it): then that
  order's first fill (S11-Q11), and the
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
  as the stop fill's id (unless the order the page ended on before that fill came to no row and
  no other order's fill is inside it: then that order's first fill, S11-Q11), and the symbol stores `heldOrderId` = that order's id. The next run reads
  that symbol first (held symbols in ascending symbol order): the held order's re-read (`orderId` +
  `fromId`, complete by itself), then the id cursor from the stop fill, where the held order's fills
  follow the once-per-run rule (skipped up to the re-read's last fill id; a higher id ends the
  read). A held symbol gets at most the lane cap - 1 calls (one call stays for the round-robin,
  "Rotation" above). `heldOrderId` is cleared in the cursor patch written after the order's rows (clearing `heldOrderId` deletes the key). No
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
- Both legs untracked (S11-Q4): no leg row; both tickers join the not-tracked line; a fee in a
  tracked third coin still gives its row in the C-NR5 form. A leg that rounds to 0 units (S11-Q5):
  neither leg is written (no half pair); a non-zero fee row still imports; the symbol goes on, no
  stop.
- Fiat trade legs (S11-Q10, OVERNIGHT DEFAULT, pending user): a tracked fiat leg or fiat fee with
  digits past the fiat scale is rounded half away from zero ONCE per order, after the text sum
  of its fills, never per fill (`AmountUse` `'trade-row'` in `exchange/amounts/amounts.ts`), with
  the `row-precision-rounded` log; it is not a symbol stop. Which currencies may round is
  `mayRound` in the same file; an amount it refuses fails as `amount-precision` (S11-Q6).
- Rowless orders (S11-Q11, S11-Q13): an order whose seen fills round to no row writes nothing.
  An order of that kind that is the last order of a page holds the cursor at its first fill, so
  its next fill arrives as a fresh read of it (S11-Q11). An order of that kind that the cursor
  has passed is kept in the symbol's `rowlessOrderIds` (`walk-state.ts`, `trades.symbols[symbol]`,
  ascending, written with the cursor, absent when empty, cleared on disconnect): a later fill of
  it counts as "imported earlier" and triggers the weight-5 re-read, so its earlier fills are not
  lost. The set holds only the ids of orders that came to no row and that the cursor has passed,
  each leaving when its order writes a row (or on disconnect), so it grows only with orders that
  never reach one unit and every order of a pair of two untracked coins whose fee is in no
  tracked coin (those never write a row by construction; `binance.trade-history.rows.test.ts`,
  "writes nothing for two untracked coins and a commission in one of them"), one number per
  order per symbol.
- Pair id `${accountId}:trade:${symbol}:${orderId}`; legs `${pairId}:<walletKey>`; fee
  `${pairId}:fee:<walletKey>`. Time = the order's first fill time. `operation = 'trade'` on every
  leg. The pair id is unique because Binance names one order by (`symbol`, `orderId`): its Query
  order endpoint needs `symbol` with `orderId`, and the id holds the account, the symbol and the
  order. It carries no `:<COIN>` suffix (the symbol names both coins); each row key ends with the
  wallet key, which holds the coin, so every row key is per coin.

## 6. Row mapping and statistics

### The `operation` column (set 7, migration 0063)

`ALTER TABLE transactions ADD operation text` (nullable, no index, no backfill; R-Map). Codes:
`trade`, `trade-fee`, `convert`, `dust`, `p2p`, `card`, `fiat`. There is no `reward` code, because
the dividend walk is not in 1.3-a (C-Div). Insert-only (not in
`BANK_OWNED_TRANSACTION_COLUMNS`), exported by the snapshot (every column), restored as null from
an older file. It labels; it never decides statistics, and it is not a rewrite guard field
(`REWRITE_GUARD_FIELDS`; S7-Q4), because every operation row already carries another marker.

### Untracked-counterpart codes (no migration)

`src/transactions/untracked-counterpart/untracked-counterpart.ts` gains the forms `asset:<CODE>`,
`p2p:<FIAT>:<TOTAL>`, `card:<FIAT>:<TOTAL>`, `bank:<FIAT>:<TOTAL>` beside `wallet:<TYPE>` (C-NR1;
`<TOTAL>` a major-unit decimal at the fiat's scale), each with a parser that returns the fiat code
and the total in minor units through the exact decimal parser. A code with a malformed total parses
to the fiat code with no total (the label still renders; the matcher skips it). Parse rules
(S7-Q3): the fiat is the segment as written, non-empty and free of `:`; a total exists only when
the fiat is a known non-crypto currency and the rest parses exactly at its scale to a value above
zero; `asset:` needs a non-empty code free of `:`, so an `asset:` code containing `:` is unknown
(default label). An empty fiat or code is an unknown code. Set 7 ships the parsers only; the demo
seed writes literal codes and each walk set adds its own builder with the section 5 marker-total
normalization (S7-Q6). An unknown code
still renders the default label. `exchangeExcludedTransactionIds` already excludes any row with a
code.

### Labels (render time, `transactionRowDescription`)

The order is:
1. a stored description;
2. `operation = 'trade-fee'` -> "Trading fee";
3. a counterpart marker -> "Exchange/Transfer to/from <holding>" (as today);
4. a code:
   - `wallet:` -> "Transfer to/from <wallet>" (as today);
   - `asset:` -> "Exchange to/from <CODE>";
   - `p2p:` -> "P2P purchase (<FIAT>)";
   - `card:` -> "Card purchase / Sale to card (<FIAT>)";
   - `bank:` -> "Bank deposit / withdrawal (<FIAT>)";
   - the direction comes from the sign;
5. `defaultTransactionDescription`.

A negative `p2p:` row cannot be written in 1.3-a (C-P2P-SELL-MAKER B); it would render "P2P
purchase (<FIAT>)" as well. The P2P cover rule keys on the `p2p:` code through
`parseUntrackedCounterpart` (kind, fiat, total) plus the row's amount and holding currency, never
on `operation` (S7-Q5). Set 7 drops `transactions.p2pSale` (C-NR-F), and the follow-up adds the
sale label back.

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
| Convert | pair per order, on the `walletType` wallet | counterpart + pair id; `convert` | excluded |
| Convert, settled but `walletType` off the allowlist, or a status off the allowlist | none; `notImported` | - | none |
| Spot trade | pair per order, received net of fee, spent plus a spent-coin fee | counterpart + pair id; `trade` | excluded |
| Trade fee in third coin | `-` on fee coin | counterpart (received leg's holding) + pair id; `trade-fee` | excluded |
| Trade, one side untracked | tracked leg | `asset:`; `trade` | excluded |
| Dust | pair per source coin | counterpart + pair id; `dust` | excluded |
| Dust, source untracked | BNB leg | `asset:`; `dust` | excluded (positive anyway) |
| P2P buy (TAKER, COMPLETED) | `+takerAmount` crypto, Funding | `p2p:<FIAT>:<TOTAL>`; `p2p`; `comment` displays the total | none; the bank debit per the matcher |
| P2P buy of a fiat asset | `+takerAmount` on the Funding fiat holding | `p2p:<FIAT>:<TOTAL>`; `p2p` | none; the bank debit per the matcher (M14) |
| P2P sell, P2P as advertiser, P2P amounts unclear (all COMPLETED) | none; `notImported` (counted on the account detail; named in the not-listed note) | - | none |
| Fiat order or payment with a status off the allowlist | none; `notImported` | - | none |
| Card buy | `+` crypto | `card:<FIAT>:<TOTAL>`; `card` | none; the card charge per the matcher |
| Card sell | `-` crypto | `card:<FIAT>:<TOTAL>`; `card` | excluded |
| Fiat deposit | `+` fiat holding | `bank:<FIAT>:<TOTAL>`; `fiat` | none; the bank debit per the matcher |
| Fiat withdraw | `-` fiat holding | `bank:<FIAT>:<TOTAL>`; `fiat` | excluded |

### Adoption keeps the exchange markers as one unit (S8-Q2, set 8)

A sync row that adopts a plain statement-import twin (a row with none of the three markers)
takes the pair id, the counterpart holding, the untracked counterpart and the `operation` together,
as one unit. A twin that already carries any of the three (a user's own pair) keeps its own, and
the sync row takes none of them. The adoption rule itself lives in `kiko-statement-import`, "The
sync adopts its import twin"; step 13/14 of the set 8 plan updates that skill with this rule.

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

### Not-imported line (sets 8 and 12)

`notImportedCountsOf(state)` (`exchange/history-status/`) counts the entries of
`exchange_state.notImported` per kind, in the order of `NOT_IMPORTED_KINDS`. The account detail
shows the line under the not-tracked and oversized lines (section 8):
- `accountDetail.notImported` lists each kind with a non-zero count, as
  `accountDetail.notImportedKind.<kind>` (through `notImportedKindCopyKeys`) with `{{count}}`.
- Each count is a bare number in parentheses, which agrees with no noun, so there are no plural
  keys.
- The line is hidden when the list is empty, and it never shows the history caption (K8).

Set 8 adds the line, the parse, all six kinds in the tuple and all six copy keys (S8-Q4); set 12
only starts writing the `p2p-*` and `fiat-unrecognized` entries.

### "Earlier history" line and not-listed note (R-Q16, set 15)

Holding detail of an exchange-synced holding: under the list, `holdingDetail.earlierHistory` with
`balance - sum(rows of the holding)` in the holding's currency, shown when that is not zero; then
the exchange's not-listed note (`holdingDetail.exchangeNotListed.binance`). No row, no statistics
effect.

## 7. Migration of BTC state, backfill, scenario matrices

### BTC rows, keys, cursors (no data loss)

- Rows: untouched. Every BTC key keeps its exact form (sections 5 and 6 list the rule per stream).
- Holdings: matched by the same `binanceAsset` keys; names change only from a default (section 4).
- Walk state (set 4, migration 0061): `ALTER TABLE sync_state ADD exchange_state text`, then one
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
  test pins equality with 0061. No index, so no EXPLAIN QUERY
  PLAN test.
- Export version (set 4): 0061 adds a no-bump `VERSION_DECISIONS` entry (`envelope.test.ts`;
  version 4, migration count 62). The column rides inside the `sync_state` row, and
  `withWalkStateMoved` derives it for a file without it. An older build drops the key, and its walks
  read from their floors, where keys dedupe. 0063 (set 7) records its own decision: no bump
  (version 5, after account currency's 0062 bump), because a nullable column on the transaction row
  restores as null, as 0058 does (count 64): `{ version: 5, migrationCount: 64 }`, `EXPORT_VERSION`
  stays 5 (S7-Q7). A pre-set-7 version 5 build restoring a new file drops `operation` and also
  shows every `asset:`/`p2p:`/`card:`/`bank:` row with its default label; statistics are
  unaffected (its exclusion already excludes any code).
  Set 4 regenerates both demo `.kiko` files in the same commit.
- Disconnect: `disconnectCryptoAccount` resets `exchange_state` (cursors to the floor, lists empty,
  point/range cursors, hints, trade cursors and coin lists removed, a malformed value replaced),
  then clears the Keychain item. Removing the coin lists clears both history lists (C-NR8).
  The `notImported` list is removed too (N6). Holdings and rows stay as a manual snapshot.

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
  Step 10 rulings (coordinator, standing approval, 2026-10-19; `a1c51603`): a stored
  `multiCoinSince` with a lost or malformed `multiCoinSeen` keeps the EARLIER of the stored start
  and the plan cursor and writes seen again (`multiCoinPatchesOf`); a plan cursor at or below the
  floor is recorded as `multiCoinSince`, an empty range the set 15 backfill reads as nothing
  owed; the marks ride only the first FORWARD cursor write of a run.
  Review requirement (slice B m5, no fix in set 6): a malformed `multiCoinSince` beside
  `multiCoinSeen: true` is never rewritten, so it reads as the current cursor and moves later
  every run; the set 15 backfill must repair the value once (or bound the range), and must treat
  an empty or negative range as nothing owed.
- Set 15: each of capital, Pay, Transfer, Earn with a `multiCoinSince` owes one range
  `[floor, multiCoinSince)` with `scope: 'backfill'`, read in the existing round-robin of owed
  ranges. A read in a backfill range imports every coin except BTC; BTC records there are skipped
  (not re-read into rows). A record the live pass and the backfill pass both read (the overlap
  re-read, Pay's R22 margin) gives one row (same key, `addManyDedup`). Floors as section 5. The
  caption shows while any backfill range is owed.
- New streams (Convert, dust, P2P, fiat, trades) start from their own floors with null cursors
  (dust: no cursor); they need no backfill range. R-Walk A: Convert, P2P and fiat read forward from
  `HISTORY_FLOOR_MS`, so their recent records arrive last (section 5, "Refused window and walk
  direction").

### Scenario matrices (each row becomes a Jest case)

The user's account, fixture "UA-1" (from the inventory probe and probes 2-4, 2026-10-15/16; counts,
coins, wallets and months only):
- Spot BTC is the only non-zero Spot balance. Funding holds BTC and CGPT.
- 46 Pay orders, all walletType 1 (Funding): 41 USDT (2025-04..2026-10) and 5 BTC (2026-10); 42
  out, 4 in. Probe 3's 89-day walk read 45 (40 USDT), because its window starting 534 days back was
  refused whole (403004). The walk's `payFloorMs` window reaches the floor.
- Capital: no deposits. Withdrawals: BTC x2 (2025-04, Spot) and USDT x1 (2026-01, Spot).
- One Transfer MAIN_FUNDING BTC (2026-10). Earn BTC subscription and redemption (2026-10).
- One Convert UAH -> USDT (2026-01, SUCCESS, walletType FUNDING).
- P2P (all BUY, fiat UAH):
  - Probe 3 read 80 orders over 36 windows (to the 2023-11 limit of that walk). Statuses:
    COMPLETED 77, CANCELLED 2, CANCELLED_BY_SYSTEM 1. Assets: USDT 77, BTC 2, UAH 1 (BUY,
    COMPLETED, 2026-01).
  - Probe 4 read 86 orders over 38 windows, back to about 2023-09: all TAKER. 69 carry
    `takerCommission > 0`, all with `takerAmount = amount - takerCommission`. Probe 4 did not
    print the statuses of all 86.
- Spot trades on BTCUSDT only (2025-01).
- No dust, no dividends, no fiat orders or payments.

Rows H13, B4, N1, P9 and P11 use it.

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
| A3 | BTC `"1e-8"` (exponent form) | refused as malformed (row: stop; balance: that coin alone is skipped, keeps its last balance and lands in `oversizedCoins`, per wallet) | 1 |
| A4 | BTC JSON number `0.5` (not a string) | read through `decimalFromJsonNumber`: 50000000 | refused (only a string was read; a JSON number made the whole wallet read fail) |

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
| H12 | amount above the safe bound | - | no write for that coin; oversized line | an oversized or malformed tracked Spot coin failed the WHOLE sync; now only that coin is skipped |
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

Trade requests and the walk as built (set 11; no trade read ran before, so "was:" is "no trade
read"). Each row names the test file that holds it, in `src/crypto-sync/binance/` unless a path is
given; weights and caps are the constants `COSTS`, `LANE_CALL_CAPS` and `API_IP_BUDGET_1M`.

| # | Input | Result now | Test |
|---|---|---|---|
| TC1 | `fetchMyTrades('BTCUSDT', 0)` | signed `myTrades` with `symbol`, `fromId` and the page limit; the `/api/*` weight header read | `binance.history-client.my-trades.test.ts`: "asks a signed myTrades for the symbol from the id, at the page limit", "reads the eight fields of each trade and the weights Binance reports" |
| TC2 | `fetchOrderFills` with `fromId` 0, then a later `fromId` | at 0: `symbol` + `orderId`, no `fromId`; above 0 the `fromId` is sent | same, "asks the first page by symbol and orderId, at the page limit, with no fromId", "adds the fromId from the second page on" |
| TC3 | body not an array; a row with a field other than `id` of the wrong type (the `id` is kept as sent and judged by the id-cursor pager), or `qty`, `quoteQty`, `commission` not exact plain decimal text (empty, `1.2.3`, `1e-8`, `-1`, ` 1`) | `BinanceHistoryParseError` for the whole page, never a skipped fill | same (`binance.history-client.my-trades.test.ts`), "fails the whole page for %s", "fails the page for an unreadable row among readable ones, never skipping a fill", "leaves the id to the pager, as sent" |
| TC4 | HTTP 429 / 418; code -1121; HTTP 500 | `BinanceRateLimitError`; `BinanceInvalidSymbolError`; a request failure | same, "throws the rate limit error for HTTP %s with its Retry-After", "throws the invalid symbol error for code -1121", "rejects as a request failure for HTTP 500" |
| TW1 | the arm run | the walks run in order with the trade read after the dust read, all on one run object; the trade read gets the Spot balance texts of the same run's balance read, and none when that read returned none; a failing trade read is logged by name and the balance result still resolves; it runs even when the dust read failed | `src/crypto-sync/run-crypto-sync/run-crypto-sync.test.ts`: "runs the walks in order, capital, Pay, Transfer, Earn, Convert, the dust read, P2P, fiat orders, fiat payments, then the trade read, all on one run object"; "the trade read": "gets the Spot balance texts of the balance read of the same run, and the caller does not", "gets no texts when the balance read returned none", "still resolves with the balance result when it fails, logging only its name", "runs even when the dust read failed: each logs its own failure" |
| TW2 | cooling down; no credentials; no Spot texts; the lane refuses the symbol list; unreadable stored state | no request (the state error rejects); `{ imported: 0 }` otherwise | `binance.trade-history.test.ts`, "a run that does not start" |
| TW3 | 429 on a page, on a re-read, on the symbol list (the plan's TW4 is the symbol-list case) | page: what was read before is written, the cooldown is set, the run resolves; re-read: the cursor stays before the page and the cooldown is set; symbol list: the cooldown is set and no trade request goes out; a symbol list that cannot be read rejects with no cooldown | same, "a rate limit": "writes what the run read before the limit, sets the cooldown and resolves", "keeps the cursor before the page and sets the cooldown when a re-read is limited", "sets the cooldown and sends no trade request when the symbol list is limited", "rejects, with no cooldown, when the symbol list cannot be read" |
| TW5 | one symbol throws -1121, one a parse error, one an amount past the safe integer | each ends `failed`, one log line, the others read; the too-large coin is listed before any row of the run; an order the rules refuse writes nothing of its page; fills that disagree on the side fail the symbol | same, "a symbol that fails": "ends only that symbol, logs each failure once, and reads the symbols after it", "lists a coin that is too large before any row of the run is written", "logs a symbol that throws on every run once per run and still reads the others", "writes nothing of a page that holds an order the rules refuse", "fails the symbol for an order whose fills disagree on the side" |
| TW6 | `addTransactions` rejects on a page | no cursor for that page, earlier progress kept, the error rethrown | same, "a write that fails": "stores no cursor for the page, keeps the progress before it and rethrows" |
| TW7 | an order cut by a page boundary | written from the fills seen, then re-read once and rewritten from all; rows of a page are awaited before the next page's orders are looked up; a second fill in the run does not look the order up again | same, "an order cut by a page boundary": "writes the fills seen, then re-reads the order and writes it from all of them", "waits for the rows of a page before it looks up the orders of the next one", "re-reads an order once in a run and does not look it up again after"; on real SQLite (`binance.trade-history.real-sqlite.test.ts`): "keeps one pair for an order that fills again after a page boundary cut it, and loses no fill" |
| TW8 | commission in a third coin, in the received coin, in the spent coin | rows per "Rows per order" | `binance.trade-history.rows.test.ts`: "writes a commission in a tracked third coin as one fee row in the same pair", "takes a commission in the received coin off the received leg and sums the third coin", "adds a commission in the spent coin to the spent leg and writes no fee row" |
| TW9 | both legs untracked, a tracked third-coin fee | no leg, both tickers listed, the fee row | same, "a coin Kiko does not track": "writes no leg when both coins are untracked, lists both, and keeps the fee row" |
| TW10 | a leg that rounds to 0 units; with a fee | neither leg; the fee row imports; no stop | same, "a leg that comes to no units at its coin scale": "writes neither leg when the received leg rounds to nothing, and still writes a fee row", "writes neither leg when the spent leg rounds to nothing" |
| TW11 | an order re-read of more than one full page | one `orderFills` call per full page plus one for the short page | `binance.trade-history.test.ts`, "a re-read of an order": "takes one call per full page and one for the short page, each at the order weight" |
| TW12 | a held symbol whose re-read does not fit | re-read before any `myTrades` page, the lane keeps one call for the rotation, the symbol stays held, nothing written | same, "reads the held order of a symbol first and leaves the lane one call for the rotation" |
| TW13 | a symbol with no trade | entry `{ fromId: 0 }` | same, "importing the fills of a symbol": "stores the cursor of a symbol that has no fill as 0, so it reads as read" |
| TW14 | the Spot body | one text per asset of the Spot body, tracked or not, nothing from another wallet; the ticker trimmed and upper-cased, free and locked as sent (`' usdt '` -> `USDT: '1.0/0'`); an entry with a non-text field has no text; an empty record for a body with no balance; no texts while cooling down | `binance.provider.test.ts`: "holds one text per asset of the Spot body, tracked or not, and nothing from another wallet", "keeps free and locked as Binance sent them, under the trimmed upper-case ticker", "leaves out an entry with a field that is no text, so its coin has no text", "returns an empty record for a Spot body with no balance", "returns no texts when the account is cooling down" |
| TW15 | the prefix lookup | `EXPLAIN QUERY PLAN` uses `transactions_source_external`; `...:12:` does not match `...:123:` | `src/transactions/repo/transactions.repo.order-prefixes.real-sqlite.test.ts`: "searches the source and external id unique index with a range, never scanning the ledger", "does not match an order whose id only starts with the digits of the prefix" |
| TW16 | property at clock gaps 0 / 1 h / 1 day: five fixed symbols, random orders, fills added between runs and during a re-read, random room left in the trades lane (cap fixed) and page limit, a symbol that throws once per run and one that always fails, a random 429, EUR (7 dp) and BNB (8 dp) amounts, at least 10 rowless first parts with another order between | each order of each readable symbol stored once per key with the exact once-rounded aggregate; imported = rows stored; each entry a numeric `fromId` with no `heldOrderId`; `rowlessOrderIds` name only rowless orders, and hold every rowless order but the owner of the symbol's last fill; one holding per key coin; one order per pair id; per run: no order read whole twice, calls within the lane room, a cooldown run sends nothing | `binance.trade-history.properties.test.ts`: "stores each order of a readable symbol once per key with every fill summed, one order per pair id, and reads an order once per run: seed %i" |
| TW17 | the caps | `LANE_CALL_CAPS.trades` x `COSTS.myTrades.api` + `LANE_CALL_CAPS.tradeSymbols` x `COSTS.exchangeInfo.api` fits `API_IP_BUDGET_1M`; the lane allows 100 calls and refuses the 101st | `binance.history-budget.test.ts`: "keeps the trade lane and the symbol list under the /api/* budget when both spend their caps", "allows 100 trade calls and refuses the 101st" |
| TW18 | a BTCEUR-shaped fill set (3-7 decimals), a sum that crosses a rounding boundary only after the sum, a fiat fee (S11-Q10) | rounded half away from zero once per order, `row-precision-rounded`, no stop | `binance.trade-history.rows.test.ts`, "a fiat leg past its scale": "rounds the received quote amount of a BTCEUR sell, net of a commission in EUR", "rounds an amount that crosses the boundary only in the sum, once, not once per fill", "rounds a fee in a third fiat coin half away from zero after the sum of the fills", "keeps a crypto coin as it was: a full-scale coin past its scale still stops the order" |
| TW19 | a rowless order last on a page (S11-Q11) | the cursor holds at its first fill; next page, next run and a caught-up call each pinned | `binance.trade-history.test.ts`, "an order that comes to no row at the end of a page": "keeps the cursor at the first fill of the order until the next page settles it", "reads the order from its first fill in the next run, so nothing is lost", "makes the one caught-up call per run when the last order still comes to no row", "lets the cursor pass the order when a fill of another order follows it", "also holds an order of two untracked coins whose BNB fee rounds to nothing"; `binance.trade-history.rowless.test.ts`: "is held with a held re-read, and both are settled by the runs that follow", "is not held at its first fill once a re-read gave it, which would move the cursor back" (the contained-order pins of 16284132) |
| TW20 | a rowless order the cursor passed, with its later fill on a later page or run (S11-Q13) | in `rowlessOrderIds`, stored with the cursor; the later fill re-reads and writes every fill; dropped when it writes a row; a held re-read keeps it | `binance.trade-history.rowless.test.ts`, "an order that came to no row and that the cursor passed": "is stored with the cursor in the same entry, so a restart reads it back", "is written with every fill when a later fill of it arrives in a later run", "is written with every fill when a later fill comes on a later page of the same run", "is dropped from the set when its order writes a row", "is kept through a held order and the release of it"; `src/crypto-sync/disconnect/disconnect.real-sqlite.test.ts`: "for Binance, clears the trade cursors with the rowless order ids and the held order"; `src/crypto-sync/exchange/walk-state/walk-state.rowless-orders.test.ts`: "read as absent from a state a build without them stored, and nothing is named" (old state parses; a malformed value drops one symbol); the shape is generated in `binance.trade-history.properties.test.ts` ("include a first part that rounds to no row, with another order between and its next fill in a later run") |
| TW21 | a delete of a trade row (T12b) | a synced row is refused; a pair-reach delete removes that order's legs and fee row only | `binance.trade-history.real-sqlite.test.ts`, "deleting a trade": "refuses a row the sync owns and deletes nothing", "takes the legs and the fee row of that order and no row of another order or wallet", "takes the same rows from the fee row as from a leg" |

Trade symbols, rotation and the id-cursor pager (set 10; no trades code existed before, so no
"was:"). Statuses are Binance's words; read the constants `TRADE_MAIN_QUOTES`,
`TRADING_SYMBOL_STATUSES` and `LANE_CALL_CAPS` for their members.

| # | Input | Result now |
|---|---|---|
| TS1 | UA-1 touched (BTC, CGPT, UAH, USDT); listing BTCUSDT TRADING, BNBBTC TRADING, BTCUAH BREAK, ETHBTC TRADING, XYZBTC TRADING, CGPTUSDT HALT | candidates BNBBTC, BTCUAH, BTCUSDT, ETHBTC (XYZ untouched, HALT left out) |
| TS2 | each touched source alone: a holding at 0, each of the four coin lists, a stored `fromId` symbol's base | that coin's symbols are candidates |
| TS3 | a symbol with a stored numeric `fromId`, now HALT or END_OF_DAY (or any status outside `TRADING_SYMBOL_STATUSES`) and still listed | still a candidate (S10-Q2) |
| TS4 | a symbol with a stored `fromId` that the listing no longer has | no candidate; its stored entry untouched |
| TS5 | body not an object; `symbols` absent or not an array | `BinanceHistoryParseError`; no candidate |
| TS6 | an item with `symbol`, `status`, `baseAsset` or `quoteAsset` absent or not text | left out, counted in `unreadable`; the others read |
| TS7 | HTTP 429 / 418; HTTP 500 or a 4xx | `BinanceRateLimitError` with `retryAfterMs`; a request failure, rejects |
| TS8 | a second read in one run; an `/api/*` reading of 2981 | no request (lane cap 1; 2981 + 20 > 3000); 2980 allows it |
| TS9 | the request | `GET /api/v3/exchangeInfo?showPermissionSets=false`, no key header, no signature, no `permissions`, `Cache-Control: no-store`; the lane records `X-MBX-USED-WEIGHT-1M` |
| TS10 | `baseAsset` `' btc '`; a symbol listed twice | ticker `BTC` (`binanceTickerOf`); the symbol once |
| TS11 | 0 items read and more than 0 unreadable (G1-C) | `BinanceHistoryParseError` |
| TS12 | two main quotes (USDT/BTC listed), neither touched; one touched coin against a main quote (G2-B) | the first is no candidate; the second is |
| TR1 | held B, never-read N, changed C, rest R | read order: held, never read, changed (each ascending), then the round-robin |
| TR2 | snapshot BTC `'1/0'`, Spot `'1/0'`; USDT absent from the snapshot | BTC symbols unchanged; USDT symbols changed |
| TR3 | rotation `'BTCUSDT'`, round-robin pool AAA, BTCUSDT, ETHBTC | ETHBTC first, then AAA; rotation `''` starts at AAA |
| TR4 | the lane affords 5 calls; 9 changed symbols | 4 priority calls, then at least 1 round-robin read |
| TR5 | a round-robin read returns; a later one throws a rate limit | `rotation` = the read that returned; the run stops and the error comes back as `failure` (G2-A) |
| TR6 | coin USDT in 3 candidates, 2 ended at a short page | USDT snapshot entry keeps its stored text; a coin with all ended takes the new text |
| TR7 | property: `S` 1..150, lane 1..100, a random share of coins changed, held and never-read symbols drawn afresh each run, a few symbols that throw in a run, candidate churn between runs | each symbol that does not fail every run starts a read within `ceil(S / L)` runs, `L >= 1` |
| TR8 | a held symbol whose order re-read would take the whole lane | its reads get `keep: 1`, so at most the lane cap - 1 calls |
| TR9 | a read throws `IdCursorPageError`, `BinanceHistoryParseError` or `BinanceInvalidSymbolError` | that symbol ends `failed`, the run goes on, the cursor passes it, its coins stay unfinished |
| TP1 | never read; 2500 ids over pages of 1000 | 3 calls; every row once, ascending; `nextFromId` = last id + 1 |
| TP2 | first page empty | 1 call; `nextFromId` = the `fromId` asked (0 when never read) |
| TP3 | exactly 1000 rows, then an empty page | 2 calls; `nextFromId` = last id + 1 |
| TP4 | the lane refuses page 2 | no request; end `budget`; `nextFromId` after page 1 |
| TP5 | `onPage` answers a stop at id X | no further request; end `stopped`; `nextFromId` = X |
| TP6 | an id not a safe integer (or whose `id + 1` is not), not ascending (repeated or below `fromId` included), more rows than the limit, a `stopAt` outside the page, an unsafe input `fromId` | `IdCursorPageError` (`not-ascending` for an id below `fromId`); that page never reaches `onPage`; earlier pages stay committed |
| TP7 | the fetch rejects on page 2 | the error propagates; page 1 was committed through `onPage`; a rejected page counts against the lane |
| TP8 | every page | `gate.wait()` before it; `canAfford(lane, cost, keep)` before it; `record(lane, page)` after it, or `record(lane, failedCallWeights)` when it rejects (a rejected page counts against the lane) |
| TP9 | property: random ascending id sets cut into random pages | every row reaches `onPage` once, ascending; the last `nextFromId` = max id + 1 |

Convert, dust, P2P, fiat (sets 8, 9, 12). "spec was:" is the approved text of 73336657 where this
round changes it.

| # | Record | Rows | Statistics | was: |
|---|---|---|---|---|
| C1 | Convert UAH -> USDT, SUCCESS, `walletType` FUNDING (UA-1) | Funding UAH -, Funding USDT + (pair), keys `${pairId}:UAH:funding`, `${pairId}:USDT:funding` | excluded | not imported (D7); spec was: on the C-NR3 wallet (default Spot) |
| C1b | SUCCESS, `walletType` SPOT | Spot UAH -, Spot USDT + | excluded | not imported; spec was: Spot (C-NR3) |
| C2 | PROCESS (any `walletType`, a bad one included) | owed point; no entry | none | not imported |
| C3 | SUCCESS with `walletType` missing, null, `SPOT_FUNDING` or another word | no leg; one `convert-unrecognized` entry; line "Not imported: Convert orders Kiko does not recognize (1)"; the cursor moves on; the next run never adds a second entry (S8-Q8) | none | not imported; spec was: on the C-NR3 wallet |
| C4 | `orderStatus` not one of SUCCESS, PROCESS, ACCEPT_SUCCESS, FAIL | one `convert-unrecognized` entry; `walletType` is not checked | none | not imported; spec was: unspecified |
| C5 | FAIL with `walletType` FUNDING | no row, no entry | none | same |
| C6 | SUCCESS, USDT -> PEPE (PEPE not curated), FUNDING | Funding USDT - alone, `asset:PEPE`, key `${pairId}:USDT:funding`; PEPE not tracked | excluded | not imported |
| C8 | C-NR-C: a 2026-01 conversion with 6 or more empty 30-day windows next to it (2026-02 to 2026-10 all empty) | every empty window is read and none stops the walk; the 2026-01 conversion is imported (as C1) | excluded | not imported; a stop after 6 empty windows from now would never reach it |
| C9 | a start answered -5026 (S8-C1; probe 5 saw no refusal) | the run fails, logged; marks stay; the history caption shows once the Convert cursor lags more than a day; no narrowing | - | not imported; spec was: narrowed by `DepthGuard`, the walk went on |
| C12 | SUCCESS record with no `quoteId` (S8-Q1), or no `createTime` | unreadable: owes its point, or the span when it has no time; no row, no entry | - | not imported |
| C6c | SUCCESS, USDT -> USDT (S8-Q6) | one `convert-unrecognized` entry, no row | none | not imported |
| C6e | SUCCESS on FUNDING with a blank (`''` or absent) `fromAsset` or `toAsset` (F5) | one `convert-unrecognized` entry, no row, owes nothing, even with a zero amount (the asset check runs before amounts); a record with both assets and a zero or negative tracked amount stays owed (C6d) | none | not imported |
| C9b | a window answered with another 4xx (for example -1127, or any code other than -5026); probe 5 saw none | a failure: the window and cursor stay, and the next run reads it again; the walk does not end | - | not imported |
| C9c | R-Walk A: a first Convert walk on UA-1 (113 windows, lane cap 20) | recent records arrive last; the 2026-01 conversion (window about 104) appears at run 6 of 6 | - | not imported |
| C10 | FAIL with `walletType` missing or another word | no row, no entry (status first) | none | n/a |
| D1 | dust TRX + DOGE -> BNB | two pairs on Spot | excluded | not imported |
| D1b | D1 with no Spot TRX holding stored (S9-Q4 A) | "Binance Spot · TRX" created at zero, then the pair lands | excluded | not imported; spec was: dust creates none |
| D2 | dust of an untracked coin | BNB +, `asset:`; the coin joins the not-tracked line (S9-Q10) | excluded | not imported |
| D3 | the same 100 dust records on the next run | no new row (keys) | - | not imported |
| D4 | `transferedAmount` "0.000441", `serviceChargeAmount` "0.000009" | BNB leg +0.000441 (net) | - | not imported |
| D5 | a tracked side's amount absent, malformed or negative | that entry no row, logged once per code; the others import | - | not imported |
| D5b | an amount that rounds to 0 units (S9-Q2) | that entry no row for either leg, no log | - | not imported |
| D5c | an over-precise amount on a coin stored at full scale | `amount-precision` logged; that entry no row | - | not imported |
| D5d | an amount past the safe integer | its coin joins the oversized list; that entry no row | - | not imported |
| D6 | record `transId` missing, blank or past 2^53, or no finite `operateTime` | no row of it; `dust-row-unreadable` | - | not imported |
| D7 | entry `fromAsset` blank, BNB or repeated in its record; `targetAsset` absent, blank or not BNB (S9-Q7) | those entries no row; `dust-row-unreadable` | - | not imported |
| D8 | a record with an empty details list (S9-Q8) | unreadable, logged | - | not imported |
| D9 | `{"userAssetDribblets":[]}` (S9-Q3) | nothing written or logged | - | not imported |
| D9b | a body with no list or a non-array list | the read fails, logged under `dust history failed`; nothing written | - | not imported |
| D10 | cooling down, no credentials, or the lane spent | no request | - | not imported |
| D11 | the read answers a rate limit | cooldown set; clean stop, no log | - | not imported |
| D12 | newest-100 slides by one record | exactly the new record's rows import | - | not imported |
| D13 | a Spot holding the placement cannot find even after creating a missing one (defensive only; D1b) | `dust-holding-missing` logged; no row of the read; the next run reads again | - | not imported |
| P1 | BUY TAKER COMPLETED, USDT, `amount` "100", `takerCommission` "0.1", `takerAmount` "99.9", `totalPrice` "4150", fiat UAH | Funding USDT +99.9; `p2p:UAH:4150.00`; comment "4150 UAH"; `operation = 'p2p'` | none | not imported; spec was: owed point (commission before P5) |
| P1b | same, `takerCommission` "0", `takerAmount` "100" | Funding USDT +100 | none | not imported; spec was: +100 |
| P1c | `takerAmount` absent, `amount` "100", `takerCommission` "0.1" | Funding USDT +99.9 (exact, in minor units) | none | not imported; spec was: owed point |
| P1d | `takerAmount` "99.8" while `amount - takerCommission` = 99.9 | no row; `p2p-amount` entry; line "P2P orders with unclear amounts (1)" | none | not imported; spec was: owed point |
| P1e | `takerAmount` and `takerCommission` both absent | no row; `p2p-amount` entry (C-NR-B) | none | not imported; spec was: +amount |
| P1f | `amount` "100", `unitPrice` "41.5", `totalPrice` "4145.85" (`amount x unitPrice` = 4150) | marker `p2p:UAH:4145.85`, never `4150.00` | none | not imported |
| P1g | `takerAmount` "99.9" present, `takerCommission` absent | Funding USDT +99.9 (`takerAmount` stands) | none | not imported; spec was: +amount |
| P1h | `takerAmount` and `amount` both absent (`takerCommission` present) | no row; `p2p-amount` entry (C-NR-B) | none | not imported |
| P2 | SELL TAKER COMPLETED, 100 USDT for 4100.5 UAH | no row; one `p2p-sale:<orderNumber>:<createTime>` entry; line "P2P sales (1)" | none | not imported; spec was: Funding USDT -100, `p2p:UAH:4100.50`, excluded |
| P2b | BUY MAKER COMPLETED | no row; `p2p-advertiser` entry | none | not imported; spec was: Funding +amount |
| P2c | BUY COMPLETED, `advertisementRole` missing or another word; or `tradeType` neither BUY nor SELL | no row; `p2p-unrecognized` entry | none | not imported; spec was: +amount (no role check) |
| P2d | SELL MAKER COMPLETED | exactly one entry, `p2p-sale` (SELL wins); no `p2p-advertiser` entry | none | not imported; spec was: Funding -amount |
| P3 | CANCELLED with `takerCommission` > 0; CANCELLED_BY_SYSTEM | no row, no entry | none | same |
| P3b | BUY TAKER in each of PENDING, TRADING, BUYER_PAYED, DISTRIBUTING, IN_APPEAL | owed point; imported once a later read sees COMPLETED | none | not imported |
| P3c | an `orderStatus` word not in P1, P3 or P3b | `p2p-unrecognized` entry | none | not imported; spec was: ignored ("and similar") |
| P3d | SELL in TRADING, then COMPLETED on a later read | no entry while open (owed point); one `p2p-sale` entry once COMPLETED | none | not imported; spec was: owed, then Funding -amount |
| P4 | BUY TAKER COMPLETED, asset UAH, fiat UAH, `takerAmount` "4000", `totalPrice` "4000" (UA-1 shape) | "Binance Funding · UAH" created at zero, then +4000.00; `p2p:UAH:4000.00`; label "P2P purchase (UAH)" | none; the bank debit per the matcher (M14) | not imported |
| P4b | asset `XYZ` (not curated, not a fiat code) | no row; XYZ in the not-tracked line | none | not imported |
| P5 | BUY, `totalPrice` "4150.001" | stop `amount-precision`, owed point | none | not imported |
| P6 | C-P2P-stop: one order in window 9, windows 1-8 empty in both series (7 or more empty windows in a row) | every empty window is read and none stops the walk; the order is imported | none | not imported; spec was: the walk ended after window 6 and never read the order |
| P7 | safety net (probe 5 saw no refusal): a start answered -5026 | `DepthGuard` narrows to the served depth; the ground below it is not owed; the walk goes on forward (R-Walk A) | - | not imported; spec was: counted toward the 6 |
| P7b | R-Walk A: a first P2P walk on UA-1 (113 windows x 2 series = 226 calls, lane cap 10) | recent records arrive last; the first order (about 2023-09, window about 75) appears by run 15 at the latest (older orders may exist), the newest (2026-10) at run 23 | none | not imported; spec was: newest windows read first |
| P8 | a window with BUY rows and an empty SELL series | the BUY orders import; the window has no special meaning (no empty count) | none | not imported |
| P8b | a window answered with another 4xx (any code other than -5026); probe 5 saw none | a failure: the window and cursor stay, and the next run reads it again; the walk does not end | - | not imported; spec was: unspecified |
| P9 | UA-1, probe 3's 80 orders: 77 COMPLETED BUY TAKER, CANCELLED 2, CANCELLED_BY_SYSTEM 1 | 77 rows at `takerAmount`; no row for the 3 cancelled; `notImported` empty; line hidden | none | not imported |
| P10 | the P2 SELL order is read again by the re-scan | one entry; the count stays 1 | none | not imported |
| P11 | UA-1, 2026-01: P4 then C1 on Funding | "Binance Funding · UAH" +x by P2P, then -x by Convert; it stays at 0 (R-Q6); USDT + on Funding | P2P none; Convert excluded | not imported |
| F1 | fiat deposit EUR 100, Successful | Spot EUR +100, `bank:EUR:100.00` | none | not imported |
| F2 | fiat withdraw EUR 50, Successful | EUR -, `bank:EUR:50.00` | excluded | not imported |
| F3 | card buy 0.001 BTC for 2600 UAH, Completed | Spot BTC +0.001, `card:UAH:2600.00` | none | not imported |
| F4 | fiat order with `Finished`, `Refunding`, `Refund Failed`, `Order Partial credit Stopped` or an undocumented word; fiat payment with an undocumented word | no row; one `fiat-unrecognized` entry each | none | not imported |
| F5 | fiat walk: 2-year windows with no row from the floor (probe 5: the floor window is served empty) | every window is read, and empty windows never end the walk; orders take 6 runs to reach now (12 calls, lane 3; a run reads forward or behind, and a forward run follows a behind run, S12-Q18, S12-Q21), payments 1 run (10 calls, lane 10) (C-NR-D; R-Walk A) | - | not imported |
| F6 | each allowlisted fiat word, from a fixture on the documented shape (C-NR-E: no real row observed): `Successful` / `Completed` -> row; `Processing` -> owed point; `Failed` and `Refunded` -> no row, no entry once their doc text is quoted (`fiat-unrecognized` before that) | as stated | - | not imported |

V1 and V2 are gone with the dividend walk (C-Div). The old P4 row ("P2P with commission, before P5
confirmed: owed point") is replaced by P1-P1h. There is no C7.

Not-tracked and not-listed (sets 5, 15):

| # | Account | Shown | was: |
|---|---|---|---|
| N1 | UA-1 | not-tracked line hidden (no untracked coin); not-listed note under each Binance holding; "Earlier history" on "Binance Funding · USDT" while the Pay backfill (B4) is owed | BTC only, no note |
| N2 | run N: Spot PEPE 1000 (balance list [PEPE]), XYZ in a Pay funds entry (history list [XYZ]); run N+1: the balance read writes [PEPE] again, no Pay record of XYZ | after each run: "Not tracked: PEPE, XYZ" (C-NR8) | not shown |
| N3 | marker `p2p:UAH:abc` (malformed total) | label "P2P purchase (UAH)"; matcher skips it | n/a |
| N4 (set 8) | `notImported` empty | not-imported line hidden | n/a |
| N5 (set 8) | 1 `convert-unrecognized` entry | "Not imported: Convert orders Kiko does not recognize (1). Kiko does not import these Binance records yet." | n/a |
| N5b (set 12) | 2 `p2p-sale` entries and 1 `convert-unrecognized` | "Not imported: P2P sales (2), Convert orders Kiko does not recognize (1). Kiko does not import these Binance records yet." (kind order of `NOT_IMPORTED_KINDS`) | n/a |
| N6 (set 8) | disconnect, then reconnect | list cleared, line hidden; the walks re-find the records from their floors and add each once | n/a |
| N7 (set 8) | `notImported` is not a list; or an entry has a kind not in `NOT_IMPORTED_KINDS` | reads as empty / that entry dropped; tag logged; siblings intact | n/a |

Backfill (set 15):

| # | State at the first multi-coin run | Result | was: |
|---|---|---|---|
| B1 | Pay cursor null (fresh connect) | no `multiCoinSince`, no backfill range; the walk reads every coin from its floor | n/a |
| B2 | backfill range holds a BTC record | skipped, no row | n/a |
| B3 | a USDT record read by the live pass and the backfill pass | one row | n/a |
| B4 | UA-1: Pay `multiCoinSince` = cursor on the first 1.3 sync | The backfill imports the 41 USDT Pay orders (Funding) over the next syncs; the 5 BTC orders are skipped (already imported). The 2026-01 USDT withdrawal imports on Spot through the capital backfill. The Convert imports through its own walk on Funding (C1), and the P2P orders through theirs (P9, P11). The Transfer and Earn backfills find no non-BTC record. The caption shows until every range is read | USDT never imported |
| B5 | every backfill range read | caption hidden (K1) | n/a |

Walk-state copy (set 4, migration 0061 and its restore mirror):

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
| M14 | P2P buy of the fiat asset UAH on "Binance Funding · UAH", `p2p:UAH:4000.00` at t | -4000.00 UAH at t - 20 min on a bank card | debit excluded; caption "Matched to P2P purchase" | counts |

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
| K8 | every cursor current; only `notImported` entries | caption hidden; the not-imported line shows | n/a |

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
- Connected: unchanged UI; the display name and the disconnect copy come from the registry. Under
  the status line sit the not-tracked line, the oversized line, the not-imported line
  (`notImportedCountsOf`, C-NR-A; set 8) and the caption.
- Keychain: one item per exchange per account, `kiko.<exchange>.credentials.<accountId>`; Binance's
  string unchanged. `.kiko` secrets keep `binanceCredentials`.
- `syncJobsFor`, auto-sync and refresh drive exchanges through the registry; an id with no entry is
  skipped (bank rule).

## 9. Compliance

| Item | 1.3-a |
|---|---|
| Logos (Third-party trademarks) | none; plain-text names and the generic icon; `exchangeDisclaimer` under the picker |
| Network | no new host: Binance public market data uses the pinned `api.binance.com` without a key; CoinGecko unchanged. `check:plist` unchanged |
| Privacy policy, price fallback (set 5; `docs/privacy-policy.en.md` and `docs/privacy-policy.md`, section 3, and the published copies `docs/privacy-site/en.html` and `docs/privacy-site/index.html`, which carry the same wording in the same commit) | The fallback calls `api.binance.com` for any user holding a coin CoinGecko did not price, with or without a Binance account. Section 3's opening sentence "Some connections run only after you connect ... (Monobank statements, Binance, Blockstream)" names "Binance account data" instead of "Binance" (uk: «дані облікового запису Binance» instead of «Binance»), because a Binance price call now runs without a connection. Section 3's automatic list gains "cryptocurrency prices (CoinGecko, and Binance public prices when CoinGecko has none)", and the Binance bullet gains: "Also, for any user, public market prices of a coin CoinGecko did not price: Kiko sends only the market symbol (for example `BTCUSDT`) and the dates of the prices it needs; no key, address, or amount is sent." The uk text mirrors it («символ торгової пари», «дати потрібних цін»; translator review). The effective date is re-dated to the publish day when gh-pages goes out later (user answer 2026-10-18) |
| Privacy policy, Binance data (set 15) | The Binance bullet adds: balances of every coin and fiat, trades, Convert, P2P orders (amounts and fiat totals of purchases; order numbers and times of records Kiko does not import yet; no counterparty data), fiat deposits and withdrawals, card purchases, dust conversions, and the ids and times of Convert and fiat records Kiko does not import yet. The ids and times of records not imported are kept on the device in the import progress (`exchange_state`) and travel in a `.kiko` export |
| App Privacy label | stays "Data Not Collected" (everything stays on device); the review is recorded in `memory/refs/resubmission-kit.md` section D |
| Stored counterparty data | Pay nickname only (D4). The P2P fields `counterPartNickName`, `advNo`, `payMethodName` and `additionalKycVerify` (probes 2-4 key list) and fiat payment method details are never read into a type. A not-imported entry stores the record id and time only |
| API terms gate | Before set 15 merges, read and record (URL, date, clauses) Binance's Terms of Use, its API terms (the clauses on read-only third-party apps) and its market-data display terms (the clauses on showing Binance price data in a third-party app, attribution included); scribe records them in kiko-compliance. A clause that forbids the price display removes the fallback before ship. Bybit's terms (PDF in `research-bybit.md`) gate 1.3-b. **C2 note (set 5, 2026-10-18).** Terms read: Binance Terms of Use, ADGM Binance entities (NEL/NCCL/NTL), effective 21 July 2026 (the version served to this region; other regions can get other terms); PDF `https://bin.bnbstatic.com/static/cms/cg08ou2ak0tn7mcplvfg/file/bf4879710c904b991848972ec4818ba2cf9e4ce314c09adae84fa2750d3477f7.pdf`, checked 2026-10-18 (the `/en/terms` page is a pdf.js iframe). Cl. 27: IP licence non-exclusive, only as necessary to receive Binance Services, non-commercial personal or internal business use; trade marks EXCLUDED. Cl. 14.1.2(b): account access via APIs is "subject to separate API terms and our approval". Cl. 31.1(d): no IP infringement. Cl. 31.1(e) and 25.5: no use from the List of Prohibited Countries, no VPN circumvention. Cl. 33.6: third-party apps are the user's own risk, no endorsement. Cl. 33.11: market data is "for information purposes", no accuracy or availability warranty. NOT found: a clause on keyless public market data, attribution text, or an explicit redistribution or display ban. Prohibited Countries (updated 5 Jan 2026): United States (also citizens), Canada, Netherlands, Cuba, North Korea, Iran, Crimea, so-called DPR and LPR. NOT read: the separate API terms, the Prohibited Use Policy. Docs read: market-data-endpoints (no licence text); general-api-information ("please use the base endpoint https://data-api.binance.vision" for public market data; 429/418 bans of 2 minutes to 3 days with Retry-After; 403 WAF; per IP). Ruling D1: keep `api.binance.com`; `data-api.binance.vision` is a later option. **User ruling C2 (2026-10-18):** the release hold is LIFTED on two conditions: (1) no Binance logo anywhere in the app or the metadata; (2) the fallback stays fail-soft (451, 403, 418, 429 or any error is no price this sync, never a crash or a wrong value, never a retry loop). There is NO device-region check: the fallback runs for every user, also in a Prohibited Country. |
| Demo `.kiko` (`e2e/screenshot/fixtures/kiko-demo-en.kiko`, `kiko-demo-uk.kiko`, built by `build-demo-snapshot.ts`) | a crypto account (`institution` null) with manual holdings in at least five curated coins incl. USDT, USDC, ETH, BNB and a non-top coin (one with a dated price history), plus UAH and EUR holdings; on that account (set 7) an Exchange pair USDT -> BTC with `operation = 'trade'` and its third-coin fee row (BNB, `operation = 'trade-fee'`, same pair id, labelled "Trading fee"), a Convert pair UAH -> USDT (`operation = 'convert'`), a dust pair XRP -> BNB on the existing XRP holding (`operation = 'dust'`; no Dogecoin holding, user answer U3), a P2P buy row with `p2p:UAH:4150.00` and `operation = 'p2p'`, a card buy row with `card:UAH:2600.00` (`operation = 'card'`), a card SALE row (Ethereum, `card:UAH:1300.00`) and a trade with an untracked side (Solana, `asset:PEPE`, `operation = 'trade'`) so every label set 7 adds is reachable (orchestrator ruling R6, Guideline 2.5.19), a fiat deposit row on the EUR holding with `bank:EUR:100.00` (`operation = 'fiat'`), a fiat withdrawal `bank:EUR:50.00` (EUR stays at 50), every set 7 row older than the 30-day window, every existing holding keeping its end balance (S7-Q2), and a matching bank debit on a bank account so the statistics matcher shows (set 13). Two connectable demo accounts, both with `institution` null so `useAutoSync` never runs: a crypto account with `bankId = 'binance'` so the reviewer reaches the Binance connect field (set 14), and one with `bankId = 'btc_wallet'` (set 14); `build-demo-snapshot.ts` maps `bankId` to null for every non-bank account today (`account.kind === 'bank' ? ... : null`), so set 14 changes that mapping. Regenerated (`KIKO_REGEN_DEMO=1`) with each snapshot-shape change: set 1 (`EXPORT_VERSION` 4; `generate-demo-kiko.test.ts` pins `envelope.version` to it), set 4 (`exchange_state` column), set 7 (rows, `operation`), set 13, set 14 |
| 3.1.5 | read-only viewer; the notes state no trading, withdrawal or transfer is possible |

Set 15 list for the signed history reads (coordinator, 2026-10-23):

- (a) `docs/privacy-policy.md` and `docs/privacy-policy.en.md`, section 3: Spot trade history
  (`myTrades`), Convert history (set 8) and dust history (set 9), en and uk, with the
  translator's review.
- (b) `resubmission-kit.md`, Notes for Review: the Spot trade import, Convert and dust.
- (c) A doc test that every signed Binance history endpoint the app calls has a section 3
  phrase; it lands in set 15 with the policy text, so it is never red on main.

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
> - P2P and card purchases, labelled "P2P purchase (UAH)" and "Card purchase (UAH)", and a "Bank
>   deposit (EUR)" row: same account.
> - A bank card payment that funded a P2P purchase is not counted as spending and shows "Matched to
>   P2P purchase": the demo bank account's transaction and the Statistics tab.
> - The "Exchange or wallet" picker with Binance and Bitcoin wallet address: the demo accounts
>   marked Binance and Bitcoin wallet.
> - With a connected Binance account only: one holding per coin and wallet filled from Binance,
>   fiat balances, "Bank withdrawal (EUR)" rows, a "Not tracked" line for coins outside Kiko's coin
>   list, a "Not imported" line that counts Binance records Kiko does not import yet (such as P2P
>   sales), an "Earlier history" line and a short "Not listed" note at the bottom of each Binance
>   holding, and a "history not imported yet" line while older history loads.

Accepted: there is no reward row in the demo and no "Reward" wording, because the dividend walk is
not in 1.3-a (C-Div).

## 10. Copy (en; uk proposed, translator review before deploy)

| Key | en | uk |
|---|---|---|
| `forms.account.exchangeType` | Exchange or wallet | Біржа або гаманець |
| `forms.account.exchangeTypePlaceholder` | Select an exchange or wallet | Оберіть біржу або гаманець |
| `forms.account.exchangeTypeSheetTitle` | Exchange or Wallet | Біржа або гаманець |
| `forms.account.exchangeDisclaimer` | Kiko is an independent app. It is not affiliated with or endorsed by any exchange or wallet provider. | Кіко — незалежний застосунок. Він не пов’язаний із жодною біржею чи гаманцем і не є їхнім партнером. |
| `forms.account.exchangeConnectable` | Connect with a read-only API key. | Підключення з ключем API лише для читання. |
| `forms.account.walletConnectable` | Connect with a public address. | Підключення за публічною адресою. |
| `forms.account.bitcoinWallet` | Bitcoin wallet address | Адреса гаманця Bitcoin |
| `forms.account.exchangeOther` | Other exchange or wallet | Інша біржа або гаманець |
| `forms.account.exchangeOtherCaption` | Add holdings by hand. | Додавайте активи вручну. |
| `accountDetail.connectExchangeAction` | Connect an exchange or wallet | Підключити біржу або гаманець |
| `accountDetail.connectExchangeSheetTitle` | Connect an Exchange or Wallet | Підключити біржу або гаманець |
| `accountDetail.changeExchangeAction` | Change exchange | Змінити біржу |
| `accountDetail.exchangeHistoryPending` (replaces `binanceHistoryPending`) | Some {{exchange}} transaction history is not imported yet. Kiko will keep importing on each sync. | Частину історії транзакцій {{exchange}} ще не імпортовано. Кіко продовжить імпорт під час наступних синхронізацій. |
| `accountDetail.exchangeHistoryPaused` (set 4; shown instead of the pending caption while the top-level state is malformed, X1 and K7) | {{exchange}} history import is paused because Kiko could not read its saved import progress. Disconnect and reconnect {{exchange}} to fix this. Your holdings and transactions are kept. | Імпорт історії {{exchange}} призупинено: Кіко не зміг прочитати збережений стан імпорту. Щоб це виправити, відключіть і знову підключіть {{exchange}}. Ваші активи й транзакції збережуться. |
| `accountDetail.untrackedCoins` | Not tracked: {{tickers}}. Kiko does not import a currency its Binance sync does not support. | Не відстежуються: {{tickers}}. Кіко не імпортує валюту, яку не підтримує синхронізація Binance. |
| `accountDetail.oversizedAmount` | {{coin}}: Kiko could not import an amount exactly, so it was skipped. | {{coin}}: Кіко не зміг точно імпортувати суму, тому її пропущено. |
| `settings.dataImport.amountTooLargeError` (set 1; a version 1-3 backup refused by the USDT safe-integer bound, U8b) | The "export file" text (`en.ts` and `uk.ts` are the source: read it there) | The "export file" text (read it in `uk.ts`) |
| `accountDetail.disconnectProviderMessage.binance` (changed) | This clears the connection and the stored API key. Your holdings and transactions stay as a manual snapshot. | (unchanged) Акаунт буде відʼєднано, але ви можете й надалі керувати ним вручну. |
| `holdingDetail.earlierHistory` | Earlier history: {{amount}} | Попередня історія: {{amount}} |
| `holdingDetail.exchangeNotListed.binance` | Not listed: futures, margin and options trades; Binance Card and gift card spending; Auto-Invest; loans; ETH and SOL staking; mining; NFTs; copy trading; Dual Investment; sub-accounts; distributions other than Simple Earn rewards; P2P sales and P2P orders you placed as an advertiser; trades of coins sold before this version that Kiko saw nowhere else; and records older than Binance keeps. Binance does not say which wallet P2P and fiat operations use: Kiko shows P2P orders on Funding and fiat operations on Spot. | Не показано: угоди з ф’ючерсами, маржею та опціонами; витрати з Binance Card і подарункових карток; Auto-Invest; позики; стейкінг ETH і SOL; майнінг; NFT; копітрейдинг; Dual Investment; субакаунти; розподіли, крім винагород Simple Earn; продажі P2P і замовлення P2P, які ви розмістили у ролі оголошувача; угоди з монетами, проданими до цієї версії, яких Кіко ніде більше не бачив; записи, старіші за ті, що зберігає Binance. Binance не вказує гаманець для операцій P2P і фіатних операцій: Кіко показує замовлення P2P на Funding, а фіатні операції — на Spot. |
| `transactions.tradingFee` | Trading fee | Торгова комісія |
| `transactions.p2pPurchase` (no `p2pSale` in 1.3-a, C-NR-F) | P2P purchase ({{currency}}) | Купівля через P2P ({{currency}}) |
| `transactions.cardPurchase` / `cardSale` | Card purchase ({{currency}}) / Sale to card ({{currency}}) | Купівля карткою ({{currency}}) / Продаж на картку ({{currency}}) |
| `transactions.bankDeposit` / `bankWithdrawal` | Bank deposit ({{currency}}) / Bank withdrawal ({{currency}}) | Поповнення з банку ({{currency}}) / Виведення в банк ({{currency}}) |
| `transactions.matchedP2pPurchase` (set 13, not set 7, S7-Q8) | Matched to P2P purchase | Зіставлено з купівлею P2P |
| `transactions.matchedCardPurchase` | Matched to card purchase | Зіставлено з купівлею карткою |
| `transactions.matchedExchangeDeposit` | Matched to exchange deposit | Зіставлено з поповненням біржі |
| `accountDetail.notImported` (set 8) | Not imported: {{items}}. Kiko does not import these {{exchange}} records yet. | Не імпортовано: {{items}}. Кіко поки не імпортує ці записи {{exchange}}. |
| `accountDetail.notImportedKind.convertUnrecognized` (set 8) | Convert orders Kiko does not recognize ({{count}}) | операції Convert, яких Кіко не розпізнає ({{count}}) |
| `accountDetail.notImportedKind.p2pSale` (set 8) | P2P sales ({{count}}) | продажі P2P ({{count}}) |
| `accountDetail.notImportedKind.p2pAdvertiser` (set 8) | P2P orders as advertiser ({{count}}) | замовлення P2P у ролі оголошувача ({{count}}) |
| `accountDetail.notImportedKind.p2pAmount` (set 8) | P2P orders with unclear amounts ({{count}}) | замовлення P2P з неоднозначною сумою ({{count}}) |
| `accountDetail.notImportedKind.p2pUnrecognized` (set 8) | P2P orders Kiko does not recognize ({{count}}) | замовлення P2P, яких Кіко не розпізнає ({{count}}) |
| `accountDetail.notImportedKind.fiatUnrecognized` (set 8) | fiat operations Kiko does not recognize ({{count}}) | фіатні операції, яких Кіко не розпізнає ({{count}}) |
| `help.topics.connectCrypto.steps.2` (changed) | Under "Exchange or wallet", choose "Binance" or "Bitcoin wallet address". | У полі «Біржа або гаманець» оберіть «Binance» або «Адреса гаманця Bitcoin». |
| `accountDetail.sourceLabel` and the `sourceLabels` segment labels of `CryptoSyncForm` | removed with the segmented control (set 14); the developer re-greps their uses | removed |
| `currencyNames.<CODE>` per new coin | the coin's name (USD Coin, First Digital USD, Dai, BNB, ...) | an authored name per coin (proper nouns kept; e.g. «Ефіріум» style) |

The not-imported items are joined with ", ". In uk they are lowercase inside the sentence. In en,
"P2P" and "Convert" stay as written and "fiat" stays lowercase (kiko-translator casing). The keys
map to the kinds through `notImportedKindCopyKeys` (section 2). The user approved the 7 new uk
strings (2026-10-16).

The not-listed note's wallet sentence names the wallets the code uses for operations whose records
name no wallet (C-NR3: P2P on Funding, fiat on Spot). Convert is not in the sentence, because its
rows name their wallet (C-Convert-wallet). Set 15 writes the note's final text. If a later probe
observes another wallet, the sentence and the code change together (translator review).

Casing follows kiko-translator: sheet titles Title Case in en, sentence case in uk; "Binance",
"P2P", "API", "NFT", "Simple Earn", "Dual Investment", "Spot", "Funding", "Convert" and coin codes
are kept as written; uk writes coin names in Latin, identical to en ("Bitcoin", "USDT"; no
`PROPER_NOUNS` entry is needed, and USDT's display name is "USDT"). `exchangeTo`/`exchangeFrom` take a ticker as `{{name}}` for `asset:` rows; no new key.
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
| 2/15 | curated registry with the scale formula, USDC/FDUSD/DAI and the other curated codes, the exact decimal-to-minor-units parser (owned here; set 3's amounts unit wraps it), per-coin CoinGecko isolation, history fetched only for coins a holding uses, 0060 `settings.history_backfill_state` (device-local rotation cursor and settled marks, kept live on restore, no bump, count 61), frozen 0044 list, coin names, picker | `src/currency/currency/currency.ts`, `src/currency/coins/` (new), `src/currency/decimal/decimal.ts`, `src/rates/coingecko-ids/`, `src/rates/coingecko/`, `src/rates/coingecko-history/`, `src/rates/history-backfill/`, `src/rates/rates-refresh/`, `restore-snapshot.ts` (`FROZEN_1_0_CRYPTO_CODES`), `src/i18n/locales/{en,uk}.ts`, holding form picker, demo seed (~12) | none | R1-R5; registry invariants; parser exact-parity property; 0044 frozen pin; CoinGecko one-id-missing case; no history request for a curated coin no holding uses | no |
| 3/15 | layer extraction, Binance BTC-only, code moves only (`btcSatoshis` and `sumSatoshis` keep their behaviour; `exchangeMinorUnits` is added with no caller); `Pager`, `RunBudget`, `SignRequest`, credentials unit with Binance-specific wrappers kept in `binance/`; `offsetPager` | `src/crypto-sync/exchange/{credentials,signing,budget,paging,walk,amounts}/` (moves with `git mv` + barrels; no `registry/`, set 14 creates it), the `exchange/` container declared in `scripts/checks/feature-imports.js`, `binance.*` importers (~20-25 mutable; moves and importers in one commit). Before any other work, the developer commits the moves and importers and runs `KIKO_MUTATION_BASE=<set 3 base sha> make mutable`; over 30, set 3 is split in advance, before review (for example credentials + signing + amounts, then budget + paging + walk), each part with its own base | none | today's suites green unchanged; a byte-identical key and request snapshot test | no |
| 4/15 | 4 (first commit: test helper): a test-only commit routes every read and seed of the old walk metadata fields in the tests (about 350 references in 18 test files) through one helper, `walkMarksOf` / `withWalkMarks` in `src/test-support/walk-marks.ts` (imported as `@kiko/test-support/walk-marks`, like `real-sqlite`), with no app change and every suite green. Then: walk state to `sync_state`, per-walk parse, `write(...)` writer, the helper switched to `exchange_state`, `exchangeHistoryPaused` copy (en + uk, translator review), the 0061 `VERSION_DECISIONS` entry (no bump, count 62) | `src/db/schema.ts`, `src/sync-state/sync-state.repo.ts`, `exchange/walk-state/`, `holding-metadata.ts`, `holdings.repo.ts`, `disconnect.ts`, `restore-snapshot.ts` (`withWalkStateMoved`), walk readers/writers, `binance-history-status.ts`, `crypto-sync-section.component.tsx`, `src/i18n/locales/{en,uk}.ts`, `envelope.test.ts`, both demo `.kiko` files regenerated for the new column (~18) | 0061 ADD COLUMN + copy; `kiko:reviewer` before BATCH READY | Z1-Z6; X1-X4 (X1 with the paused copy); two-path restore; disconnect reset; walk properties at 0 / 1 h / 1 day | no |
| 5/15 | multi-coin balances, per-coin and fiat holdings, names and BTC rename, LD* skip, not-tracked and oversized lines, Binance price fallback, privacy policy price wording | `binance.provider.ts`, `binance.client.ts`, `binance.holding-keys.ts`, `provider.ts`, `sync.ts`, `holdings.repo.ts` (`renameFromDefaults`), `exchange/history-status/`, `crypto-sync-section.component.tsx`, `src/rates/` fallback, balance amounts switched to `exchangeMinorUnits`, `docs/privacy-policy*.md` and `docs/privacy-site/{en,index}.html` (~14) | none | H1-H13; N2; A1-A4 for balances; exact sums per coin; one coin missing a price | no (P9, P10, P13, P14 have safe defaults) |
| 6/15 | account-wide capital, Pay, Transfer, Earn; key rules; cross-coin Pay; Earn reward grouping per asset; `multiCoinSince`; 2-minute matcher input filter; row amounts switched from `btcSatoshis` to `exchangeMinorUnits` | `binance.transactions.ts`, `binance.pay-history.ts`, `binance.history-client.ts`, `binance.transfer-history.ts`, `binance.earn-history.ts`, `exchange/walk/`, `exchange/paging/`, `binance.provider.ts` (zero Spot BTC anchor removed with the four walk guards), `binance.holding-keys.ts`, `binance.walk-config.ts`, `src/statistics/internal-transfers/`, `statistics.screen.tsx` (~20-22; two deep-gate halves) | none | Y1-Y8; E1-E2; S1-S3; W1-W2; A1-A4 for rows; key byte-identity for BTC; key uniqueness property; walk properties at 0 / 1 h / 1 day | no (P11, P12, P16 safe defaults) |
| 7/15 | `operation` column (codes without `reward`, C-Div), C-NR1 code forms and parsers, render labels (no "Reward" step; `p2p:` renders "P2P purchase" only; `transactions.p2pSale` dropped, C-NR-F), copy, demo rows (no reward row) | `src/db/schema.ts`, `untracked-counterpart.ts`, `row-description.ts`, `exchange-description.ts`, `transactions.repo.ts`, `src/i18n/locales/{en,uk}.ts` (no `transactions.reward`), migration files, demo seed + regen (47 changed files; 7 mutable source files, `make mutable`) | 0063 ADD COLUMN; `kiko:reviewer` before BATCH READY | label order cases; code parse cases incl. N3; back-compat import of an export without the column; exclusion unchanged | no |
| 8/15 | Convert walk: status first, then `walletType` placement (C-Convert-wallet), floor `HISTORY_FLOOR_MS` read forward with every window read (probe 5: no refusal to the floor; C-NR-C; R-Walk A); no new refusal code in `requestFailedOf` (probe 5); the `notImported` list (`NOT_IMPORTED_KINDS` tuple, type, parse, union patch, disconnect removal), `notImportedCountsOf`, the not-imported line and the `accountDetail.notImported*` copy (en + uk, translator review) | `binance.convert-history.ts` (new), `binance.history-client.ts`, `binance.history-budget.ts`, `run-crypto-sync.ts`, `exchange/walk-state/`, `exchange/history-status/`, `disconnect.ts`, `crypto-sync-section.component.tsx`, `src/i18n/locales/{en,uk}.ts` (measured: 45 files changed under `src`, `git diff --stat df5475f6..HEAD -- src`; Convert -5026 fails the run, S8-C1) | none | C1-C6, C8-C10 (C8: the 2026-01 conversion behind 6+ empty windows); N4, N5, N6, N7 (`convert-unrecognized` only); K8; window halving on `moreData`; walk properties at 0 / 1 h / 1 day | settled (P4) |
| 9/15 | dust read (no dividend walk, C-Div) | `binance.dust-history.ts` (new), client, budget, run wiring (4 mutable files, measured: `KIKO_MUTATION_BASE=a730a322 make mutable`) | none | D1-D12 (D1b, D5b, D9b included) | P7 partly settled (empty shape); record shape, `transId` type and non-BNB targets open |
| 10/15 | trades 1/2: symbol discovery, rotation with the reserved call, `idCursorPager` | `exchange/paging/id-cursor-pager.ts`, `binance.trade-symbols.ts` (new), public `exchangeInfo` read, `walk-state` trades part (mutable files: 7 (cap 30), 619 changed lines, measured: `KIKO_MUTATION_BASE=33a2de39 make mutable` at set 10 step 10) | none | rotation bound `ceil(S / L)` property with `L >= 1` when changed symbols fill the lane; discovery cases; pager pages | settled (P1, P2) |
| 11/15 | trades 2/2: order aggregation, `orderId` + `fromId` re-read (P15b PASS), rows, fee rules (C-NR2, C-NR5), `/api/*` IP budget at the measured weights (20 / 5 / 5), trades lane cap measured by probe 9 (S11-Q2; the P2P lane cap moves to set 12, R-Walk A); the rulings S11-Q1 ... S11-Q13 (rowless-order set, fiat rounding) | `binance.trade-history.ts` (new), `binance.history-client.ts`, `binance.history-budget.ts`, `run-crypto-sync.ts`, `exchange/amounts/amounts.ts`, `exchange/walk-state/walk-state.ts` (mutable files: 12 (cap 30), 1179 changed lines, timeout share 0.7%, measured: `KIKO_MUTATION_BASE=3d0df6d4 make mutable` at a2147c92) | none | T1-T12b and T14 exact parity; TC1-TC4 and TW1-TW21 (section 7); properties at 0 / 1 h / 1 day; measured run report (section 5) | settled (P1, P3, P15, P15b) |
| 12/15 | P2P walk: status first, then side, role and amount (C-P5, C-NR-B), BUY TAKER only, SELL and MAKER into `notImported`, fiat-asset rows on the fiat holding, floor `HISTORY_FLOOR_MS` read forward with every window read (probe 5: no refusal to the floor; C-P2P-stop; R-Walk A), UID 900. Fiat orders and payments walks (no real row observed): 2-year windows from `HISTORY_FLOOR_MS` read forward with every window read (probe 5; C-NR-D; R-Walk A), the strict status allowlist with the doc-quote rule (C-NR-E), UID 45000 lane. First step: quote Binance's doc text for the ignored fiat words | `binance.p2p-history.ts`, `binance.fiat-history.ts` (new), client, budget, run wiring (~7) | none | P1-P11 (P1b-P1h, P2b-P2d, P3b-P3d, P7b, P8b included), F1-F6; N5b; the fiat-orders budget cases (section 5); properties at 0 / 1 h / 1 day; measured P2P first-walk report (calls, runs) | P5 settled; P6 open (no real row observed), allowlist defaults |
| 13/15 | read-time bank-debit matcher and its caption | `src/statistics/exchange-funding-match/` (new), `statistics.screen.tsx`, the transaction form caption slot, i18n, demo bank debit (~6) | none | M1-M14 (M14: fiat-asset P2P); one-to-one tie-breaks with a distinct value per sort key | no |
| 14/15 | exchange catalog, picker field, registry wiring, shared provider sheet, `syncJobsFor` | `exchange-catalog/`, `exchange/registry/`, `exchange-type-field/` (new), `crypto-sync-form`, `account-form.screen.tsx`, `crypto-sync-section`, `add-bank-sheet` -> `provider-sheet`, `bank-sync-section`, `sync-jobs.ts`, `provider.ts`, `deletable.ts`, i18n, `build-demo-snapshot.ts` (crypto `bankId` kept) + `binance` and `btc_wallet` demo accounts (`institution` null) + demo regen (~16) | none | picker and caption render; registry skip of an unwired id; connect-first rollback; demo invariant per connectable catalog entry | no |
| 15/15 | backfill ranges, caption, "Earlier history", the not-listed note's final text (section 10: Convert out of the wallet sentence, P2P sales and advertiser orders named), privacy policy Binance paragraph per section 9, terms check, Notes for Review per section 9 (the "Not imported" line included; no reward wording), demo regen, kiko-architecture/kiko-domain/kiko-compliance updates via scribe | `exchange/walk/` (backfill scope), the four walk files, `exchange/history-status/`, `holding-detail.screen.tsx`, i18n, `docs/privacy-policy*.md`, `e2e/screenshot/` seed (~12) | none | K1-K7 (K6b included; K7 uses the paused copy that set 4 adds); B1-B5; N1; earlier-history sum exact | no (terms gate) |

Probes 2-5 ran (2026-10-15 and 2026-10-16), so sets 8-12 have no probe gate left. The facts that
are still open (P6, P7, P11, P16) have safe defaults (section 12). Sets 1, 4 and 7 each carry a
`kiko:reviewer` step on their migration before BATCH READY. Device verification with the user's
key runs on the final tip before 1.3-a ships.

Release-step note (not a code change): set 1 makes the demo files version 4, which a 1.2.x build
cannot read. If a 1.2.x build is still in App Store review when set 1 merges, the release step
freezes a version 3 copy of the demo file for that build's reviewer (as `kiko-demo-en-1.1.kiko` was
kept for 1.1).

## 12. Open questions

### Probe-dependent facts

Probe 2 (`memory/refs/binance-operations-probe.sh`), probe 3 (`...-probe-3.sh`), probe 4
(`...-probe-4.sh`) and probe 5 (`...-probe-5.sh`) ran on the user's account (main checkout
`memory/refs/`; the outputs are named in "Inputs"). Status: SETTLED means the rule above is final.
OPEN means the account had no data to observe, and the default holds. Probe 5 asked one series
per endpoint (P2P BUY; fiat `transactionType` 0) with one 30-day floor window, not the walk's
2-year fiat window.

| # | Fact | Status and value | Rule in force | Sets |
|---|---|---|---|---|
| P1 | `myTrades` `fromId=0`, no times, returns trades older than 24 h | SETTLED, probe 3: yes (oldest trade older than 24 h on 1 of 1 symbols); a 48 h range is refused with -1127 | id-cursor paging from 0 | 10, 11 |
| P2 | candidate symbol count | SETTLED, probe 3: 9 TRADING, 3 BREAK of 34 looked up; the `exchangeInfo` body measured (S10-Q5b: 6.77 MB decoded, 3736 symbols, weight 20) | lane cap 100; candidate rule of section 5 (G2-B) | 10 |
| P2b | `myTrades` id types | SETTLED, probe 8 (S10-Q4): `id`, `orderId`, `orderListId` JSON integers, all safe (20 of 20), ids ascending, weight 20 | trade id a safe integer; an unsafe id refused | 10, 11 |
| P3 | `myTrades` lookback | SETTLED, probe 3: from id 0 serves the account's oldest trade (2025-01) | from id 0 | 11 |
| P4 | Convert span, lookback, wallet | SETTLED, probes 3-5: 30 d (a 31 d span was also accepted), 24 months read with 0 failures, the `walletType` field present (FUNDING=1); no refusal to the floor (probe 5; the 2017-07 floor window is served empty) | 30 d windows; floor `HISTORY_FLOOR_MS` read forward, every window read (C-NR-C, R-Walk A); wallet from `walletType` (C-Convert-wallet) | 8 |
| P5 | P2P paging, statuses, wallet, net or gross, `totalPrice` | SETTLED, probes 3-5: `page`/`rows` with a response total; statuses COMPLETED / CANCELLED / CANCELLED_BY_SYSTEM; no wallet field; `takerAmount = amount - takerCommission` 69/69; `totalPrice` independent of `amount x unitPrice` (2/69); BUY and TAKER only; rows back to about 2023-09; no refusal to the floor (probe 5; the 2017-07 floor window is served empty) | C-P5; C-NR-B; C-P2P-SELL-MAKER B; C-NR3 Funding; floor `HISTORY_FLOOR_MS` read forward, every window read (C-P2P-stop, R-Walk A) | 12 |
| P6 | fiat orders and payments: span, lookback, statuses, credited wallet, withdraw fee | PARTLY SETTLED: no refusal to the floor (probe 5; the 2017-07 floor window is served empty); probe 3: a 2-year span accepted; UID 45000 (orders), IP 1 (payments). OPEN: no real row observed (0 rows in 2 years), so statuses, wallet and fee are unobserved | 2-year windows from `HISTORY_FLOOR_MS` (C-NR-D); the strict status allowlist with the doc-quote rule (C-NR-E); Spot (C-NR3) | 12 |
| P7 | dribblet beyond the last 100; `transferedAmount` net | PARTLY SETTLED. Probe 2: 0 dust records (180-day windows back to 2020-12-01 accepted). Probe 7 (S9-Q3): the empty answer is `{"userAssetDribblets":[]}`, `total` absent. The connector doc quote (binance-connector-js wallet `dustlog`) gives the documented record shape and `targetAsset` BNB. OPEN: the record shape and the `transId` type (no real record seen), non-BNB targets | newest 100; net; empty list = no dust, a missing list fails closed; `targetAsset` must be BNB (S9-Q7) | 9 |
| P8 | `assetDividend` `enInfo` values | SETTLED, probes 2-3: 0 dividends in 3 years | walk removed (C-Div) | 9 |
| P9 | LD* tokens in `/api/v3/account` | SETTLED, probe 2: 0 assets start with LD | skip rule (section 3) | 5 |
| P10 | max decimals per coin | SETTLED for the account's coins, probes 2-3: Spot BTC 8; Funding BTC 7, CGPT 2; Pay BTC 8, USDT 8 | registry scales | 5, 6 |
| P11 | Earn reward `productId` per asset | OPEN, probe 2: 0 reward rows | group key adds the asset (safe both ways) | 6 |
| P12 | Pay multi-coin `fundsDetail`; `walletAssetCost` keys | SETTLED, probe 3: 45 orders, each with 1 currency in `fundsDetail`; `walletAssetCost` keys seen: wallet keys 1 and 2 under BTC funds, wallet key 1 under USDT funds (key names, not order counts) | rows per coin and wallet | 6 |
| P13 | `get-funding-asset` without `asset` omits zero rows | SETTLED, probes 2-3: 2 rows, 0 zero rows | missing coin reads as zero | 5 |
| P14 | `EURUSDT` live | SETTLED, probe 2: TRADING | USDT fallback via EURUSDT | 5 |
| P15 | weights | SETTLED, probes 2-5: section 5 "Measured weights" | caps and budgets of section 5 | 8-12 |
| P15b | `symbol` + `orderId` + `fromId` page an order's fills | SETTLED, probe 3: PASS | re-read by `fromId` (C-NR7) | 11 |
| P16 | `walletType` of non-BTC deposits | OPEN, probe 2: 0 deposits | 0 Spot, 1 Funding, else stop | 6 |

Still open (no data on the user's account; safe defaults in force):
- P6: fiat statuses, wallet and fee (no real row observed);
- P7: dust (the empty shape is settled by probe 7; record shape, `transId` type, non-BNB targets);
- P11: the Earn product id;
- P16: the deposit wallet;
- the doc quotes for the ignored fiat words (set 12, first step);
- the C-P2P-SELL-MAKER follow-up probe, which needs an account with SELL or MAKER orders.

### NEEDS RULING

The following are ruled (section 1): C-NR1 ... C-NR9, C-NR-A ... C-NR-F, C-P5, C-P2P-SELL-MAKER,
C-P2P-fiat-asset, C-Convert-wallet, C-Weights and C-P2P-stop; the user rulings R-Walk A and
C-P2P-SELL-MAKER B (FINAL) are in the user rulings table. C-NR2 is confirmed by the user. None is
open.
