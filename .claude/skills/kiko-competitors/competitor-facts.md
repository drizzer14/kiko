# Competitor facts

Data file of the kiko-competitors skill. Sections A to D and F1 hold the research of 2026-11-02;
section E holds the exchange research of 2026-10-15. F2 was read from code and F3 was not
researched. Every table row is one fact set.

## Evidence levels (sections A to D)

- READ: read on the fetched page.
- SEARCH: a search-result summary only, not a quote.
- UNVERIFIED: from memory, no source.

The level belongs to each app inside a row where the input gives per-app levels. The promotion
rule is in the skill's "Update rules".

## A. Feature facts (check date 2026-11-02 for every row)

Note on the column "Works with no server?": the researcher states it is their own judgement
from how the feature works, not from the source. Added by the author of this file: "Unknown"
means the researcher could not judge it.

| # | Feature | Apps and evidence level | Works with no server? | Source URL(s) | Checked |
|---|---|---|---|---|---|
| 1 | Savings jars with a goal, plus a live statistics dashboard | Monobank (READ) | No, bank-side | https://www.monobank.ua/ | 2026-11-02 |
| 2 | Personal API for statements and a webhook (the jar mention is not on the visible page) | Monobank (READ, page truncated) | Yes: user token, direct call | https://api.monobank.ua/docs/ | 2026-11-02 |
| 3 | Group expense splitting with unpaid-debt reminders | Monobank (READ); Spendee has shared wallets (READ) | No | https://www.monobank.ua/ ; https://www.spendee.com/ | 2026-11-02 |
| 4 | Scheduled recurring payments and IBAN payment history | Monobank (READ) | No | https://www.monobank.ua/ | 2026-11-02 |
| 5 | Mono and Privat statement import, a Monobank link, 60+ currencies, auto currency conversion | Finmap (SEARCH; business-oriented) | Unknown | https://support.finmap.online/en/changelog-eng ; https://finmap.online/for-eu | 2026-11-02 |
| 6 | Bank sync (15,000+ banks, Premium) and 150+ currencies, set per account (the 150+ figure is from a third-party review) | Wallet by BudgetBakers (SEARCH) | No (aggregator) | https://budgetbakers.com/en/products/wallet/ | 2026-11-02 |
| 7 | CSV/XLS/OFX file import as the fallback when no bank is connected | Wallet (SEARCH) | Yes | https://budgetbakers.com/en/products/wallet/ | 2026-11-02 |
| 8 | Wallet or e-wallet connections; multiple currencies; shared wallets; bank sync | Spendee (READ) | Bank sync: no | https://www.spendee.com/ | 2026-11-02 |
| 9 | Envelope budgeting (only allocate cash you have) | Actual Budget (READ); YNAB (UNVERIFIED, from memory) | Yes, local | https://actualbudget.org/ | 2026-11-02 |
| 10 | Works offline with background sync through a self-hostable server and optional end-to-end encryption | Actual Budget (READ) | Yes offline; sync needs a server | https://actualbudget.org/ | 2026-11-02 |
| 11 | Bank sync through GoCardless (EU/UK) and SimpleFIN (US/Canada) | Actual Budget (READ) | No (third party) | https://actualbudget.org/ | 2026-11-02 |
| 12 | Net worth and cash flow reports plus a custom report engine | Actual (READ); YNAB net worth report (READ); Copilot net worth (READ) | Yes | https://actualbudget.org/ ; https://www.ynab.com/features | 2026-11-02 |
| 13 | Budgets over custom periods, per-category limits, budget history, goals | Cashew (READ, README) | Yes | https://github.com/jameskokoska/Cashew | 2026-11-02 |
| 14 | Transaction types: upcoming, subscription, repeating, borrowed (debt), lent (credit) | Cashew (READ) | Yes | https://github.com/jameskokoska/Cashew | 2026-11-02 |
| 15 | Multiple accounts and currencies, converted at current rates | Cashew (READ), Lunch Money (SEARCH, 160+), Kubera (READ) | Rates need network | https://github.com/jameskokoska/Cashew ; https://www.kubera.com/ | 2026-11-02 |
| 16 | Custom title that auto-assigns a category | Cashew (READ) | Yes | https://github.com/jameskokoska/Cashew | 2026-11-02 |
| 17 | Backup and sync through Google Drive or Firebase (search says Firebase is optional) | Cashew (READ for sync and Drive backup; Firebase SEARCH) | Core use yes; sync no | https://github.com/jameskokoska/Cashew | 2026-11-02 |
| 18 | CSV import, Google Sheets import, app links that pre-fill a transaction, biometric lock | Cashew (READ) | Yes | https://github.com/jameskokoska/Cashew | 2026-11-02 |
| 19 | Loan payoff calculator showing interest and time saved | YNAB (READ) | Yes | https://www.ynab.com/features | 2026-11-02 |
| 20 | Goal tracking, category templates, customizable views, mobile widgets, offline use with cross-device sync | YNAB (READ) | Sync: no | https://www.ynab.com/features | 2026-11-02 |
| 21 | Share one subscription with up to six people | YNAB (READ); Copilot households is "coming soon" (READ) | No | https://www.ynab.com/features ; https://www.copilot.money/ | 2026-11-02 |
| 22 | AI assistant that cleans up transactions, with 6 personalities | Copilot (READ) | No | https://www.copilot.money/ | 2026-11-02 |
| 23 | Subscription and recurring-charge view; alerts for low balance and large expenses | Copilot (READ) | Partly: alerts need a feed | https://www.copilot.money/ | 2026-11-02 |
| 24 | Investments tracked against the S&P 500 (stocks, crypto, retirement) | Copilot (READ) | No | https://www.copilot.money/ | 2026-11-02 |
| 25 | Home-screen widgets: daily spending, category, budgets, net worth, credit card, account, recent and to-review transactions. Interactive widgets since iOS 17. | Copilot (READ for the help page; the changelog title was seen in SEARCH only) | Unknown | https://help.copilot.money/en/articles/9834331-adding-widgets ; https://changelog.copilot.money/log/interactive-widgets-for-ios-17 | 2026-11-02 |
| 26 | Widgets are hidden on iOS 18 if "Require Face ID" is on for the app | Copilot (READ) | n/a | https://help.copilot.money/en/articles/9834331-adding-widgets | 2026-11-02 |
| 27 | Import Apple Card, Cash and Savings transactions through FinanceKit (US iOS 17.4+; UK iOS 18.4+; background delivery iOS 26) | YNAB (READ); Monarch (SEARCH); Copilot (SEARCH) | Yes: on-device API | https://developer.apple.com/financekit ; https://www.macstories.net/linked/financekit-opens-real-time-apple-card-apple-cash-and-apple-savings-transaction-data-to-third-party-apps/ | 2026-11-02 |
| 28 | Rearrangeable dashboard widgets (net worth, recent transactions, investment performance) | Monarch (SEARCH, vendor page snippet) | Unknown | https://monarch.com | 2026-11-02 |
| 29 | Net worth with history chart; multiple savings goals | Monarch (SEARCH) | No | https://www.monarch.com/landing/net-worth-variant | 2026-11-02 |
| 30 | Tracks gold, real estate, vehicles and watches with live price feeds and an AI appraiser | Kubera (READ) | No | https://www.kubera.com/ | 2026-11-02 |
| 31 | Crypto: blockchains, exchanges, wallets, DeFi, NFTs; stablecoins as cash; net worth in BTC | Kubera (READ) | No | https://www.kubera.com/ | 2026-11-02 |
| 32 | Manual live positions by ticker, plus a daily net worth snapshot | Kubera (READ) | Prices need network | https://www.kubera.com/ | 2026-11-02 |
| 33 | Dead Man's Switch: portfolio goes to beneficiaries after long inactivity; portfolio sharing with advisors | Kubera (READ) | No | https://www.kubera.com/ | 2026-11-02 |
| 34 | Proof of Wealth and Fast Forward what-if scenarios | Kubera (READ) | No | https://www.kubera.com/ | 2026-11-02 |
| 35 | Multi-currency throughout; view wealth in a chosen currency | Kubera (READ) | Rates need network | https://www.kubera.com/ | 2026-11-02 |
| 36 | Return on investment including dividends, risk analysis, transaction import and export, accounts, PWA, self-hostable | Ghostfolio (READ, README) | Self-host: own server | https://github.com/ghostfolio/ghostfolio | 2026-11-02 |
| 37 | Auto-import of trades from 200+ brokers; dividends, DRPs and splits update automatically; tax reports; diversity report; cash and property | getquin (READ) | No | https://www.getquin.com/en | 2026-11-02 |
| 38 | Portfolio widgets, alerts, and an Apple Watch app; crypto, stocks, forex | Delta by eToro (SEARCH, App Store snippet) | Unknown | https://apps.apple.com/app/delta-crypto-ico-portfolio/id1288676542 | 2026-11-02 |

Added note (by the author of this file): the "Yes" in row 2 applies to the direct API call with
a user token; a webhook needs a server to receive it (section F1, Poor fit).

## B. Gaps and negative findings (2026-11-02)

"Not found" means the research did not find it. It does not mean the app does not have it.

Added definitions (by the author of this file): "not read" = the page was not read; "mixed" and
"no level given" are this file's own labels. "mixed" = the cell gives a level per claim; "no
level given" = the source gives no level for that claim.

| Topic | Finding | Level | Source URL |
|---|---|---|---|
| Live Activities | Not found for any app researched, including Delta (the search hit was the airline app) | no level given (search hit named for Delta only) | none given |
| Shortcuts, App Intents, Siri | Not found for any budgeting app | not read | none given |
| Apple Watch | Found only for Delta (SEARCH). YNAB lists watchOS in its page metadata only (READ). Copilot's own page does not mention a Watch app or widgets (READ) | mixed, as stated | none given |
| Sharesight | Features page 404, so nothing is verified. Multi-currency and tax reports came from a search, not the page | SEARCH | none given |
| Monarch multi-currency | Only third-party sources, which say USD/CAD with a locked base currency. Monarch advises against mixing currencies because totals add raw numbers. Not checked against Monarch's own docs | SEARCH, unverified against Monarch docs | https://sacra.com/chat/h/c1c03e02-e948-4b2d-8be0-4438aa173d71/ |
| Wallet and Monobank | No evidence found that Wallet supports Monobank | SEARCH | none given |

## C. Weak demand notes ("Most requested by users")

Weak evidence: no vote counts, no forum threads. The researcher found no Reddit threads.

1. Real multi-currency: YNAB allows one currency per plan and Monarch is single-currency
   (third-party reviews, SEARCH):
   https://freenance.io/comparisons/ynab-vs-monarch-money-2026-eu-investors-comparison-fees-features-multi-currency-bank-coverage/
2. Better bank coverage outside the US, with CSV import as the workaround (same source; Lunch
   Flow board, no votes shown): https://lunchflow.featurebase.app/p/multi-currency-support
3. Manual accounts with history backfill (Monarch, per the same comparison sites):
   https://freenance.io/products/monarch-money-review-2026-mint-replacement-budget-app/
4. Widgets and iOS-native surfaces: Copilot, YNAB and Delta ship widgets (rows 20, 25, 38). No
   demand data was found for them.

## D. Pages that failed, and what was not read

Failed pages (check date 2026-11-02):

- monarch.com/features: 404
- budgetbakers.com/features: 404
- sharesight.com/features: 404
- firefly-iii.org: 403
- lunchmoney.app/features: 403
- Cashew web page: certificate error

Not read: PocketGuard, Privat24, Spendee detail, and Siri or Shortcuts or Watch for any
budgeting app.

Not fetched: Privat24, PocketGuard, MoneyCoach, Money Manager Ex, Lunch Money and Firefly III
pages. Any claim on their features comes from search summaries or is UNVERIFIED.

## E. Exchanges (checked 2026-10-15, not 2026-11-02)

This report has its own words: "VERIFIED unless marked" and UNVERIFIED. Do not map VERIFIED to
READ. The report recorded no source URL per API fact. Terms-of-use and logo or brand pages were
not retrieved for any exchange (UNVERIFIED for all).

### Popularity among Ukrainian crypto users

Trustee Plus survey via dev.ua (date about early 2025): Binance 92.4%, Bybit 71.2%, OKX 36.6%,
MEXC 31%, KuCoin 22%.
https://dev.ua/en/news/328-birzhi-na-odnoho-korystuvacha-yakymy-kryptobirzhamy-naibilshe-korystuiutsia-ukraintsi-1739520880

Single source: Binance closed UAH fiat and USDT/UAH on 2026-09-28; Bybit UAH P2P and WhiteBIT
card rails carry funding. Kuna: status UNVERIFIED (probably wound down); drop. WhiteBIT:
Ukrainian-founded, no share data.

### Suggested ranking (the researcher's suggestion, not a ruling)

1 Binance, 2 Bybit, 3 OKX, 4 WhiteBIT, 5 KuCoin, 6 MEXC, 7 Kraken, 8 Coinbase, 9 Bitget/Gate.
The researcher's 1.3 suggestion: Binance (multi-coin), Bybit, OKX; later WhiteBIT, Kraken/Coinbase
for the diaspora. The user rulings differ: see the kiko-competitors skill.

### Key API facts (VERIFIED unless marked)

- Binance: HMAC-SHA256/RSA/Ed25519; per-IP weight; 429 then 418 ban. Unrestricted-IP read-only
  key: UNVERIFIED (probe).
- Bybit v5: HMAC-SHA256 hex, no passphrase; 600 req/5 s per IP + per-UID per route; deposits
  30-day window, cursor, 50/page, depth not stated; inter-transfer 7-day windows; US IPs get
  403; EU accounts may need api.bybit.eu (probe). Read-only key can read history: UNVERIFIED.
  Earn path UNVERIFIED.
- OKX v5: Read permission, PASSPHRASE mandatory; HMAC-SHA256 base64, ISO timestamp, 30 s skew;
  regional hosts openapi.okx.com / eea.okx.com / us.okx.com (user must pick region); bills 7 d
  / 3 mo / async file since 2021; funding history paths UNVERIFIED.
- WhiteBIT v4: POST + base64 payload, HMAC-SHA512; keys by endpoint selection; keys
  auto-deactivate after 14 days idle; history depth UNVERIFIED.
- Kraken: single Ledgers stream (deposit, withdrawal, transfer, staking), cursor, 50/page,
  HMAC-SHA512, per-key decaying counter.
- KuCoin: General (read-only) permission, passphrase (UNVERIFIED), page-based.
- Coinbase: CDP keys, ES256 JWT per request; OAuth2 alternative.

### Shape for the shared layer

Per-exchange knobs: signing strategy; passphrase; regional base URL; rate-limit accounting (IP /
key / UID); wallet mapping (spot/funding/earn); window length + page mechanism (offset / page /
cursor / id-cursor); max lookback per type; typed clock-skew errors. Binance-like: Bybit,
KuCoin, MEXC. Different: Kraken (one ledger stream), OKX (id cursors + file export), WhiteBIT
(POST payload), Coinbase (JWT/OAuth).

### Domains

Binance api.binance.com, api1-4, api-gcp; Bybit api.bybit.com, api.bytick.com, api.bybit.eu and
other regional; OKX openapi.okx.com, eea.okx.com, us.okx.com; WhiteBIT whitebit.com; Kraken
api.kraken.com; KuCoin api.kucoin.com; Coinbase api.coinbase.com.

### Gaps

Terms and brand pages for all; OKX funding section (docs offset 200000 not read); Bybit Earn +
read-only scope; WhiteBIT history; KuCoin, Coinbase, Bitget, Gate and MEXC need a doc pass.

## F. Last gap review (2026-11-02)

JUDGMENT by the coordinator, with NO user ruling. Fit, size, risk and recommendation are
opinions, not plan estimates. The user comes back to each later. Base main d7cd40fa1. The Kiko
inventory is from code and help text; the app was not run. Web check date of F1: 2026-11-02.
Evidence levels are in section A where a row exists; a claim with no row has no level. No row
backs Actual or YNAB for per-category budgets, custom periods and history, or YNAB for income
against expense.

### F1. Feature gaps

Question (user): which features do other apps have and Kiko does not, that fit Kiko's scope?

Good fit:

| # | Feature | Who has it | Fit | Size |
|---|---|---|---|---|
| 1 | Budgets per category, custom periods, history | Cashew, Actual, YNAB | No budgets today; data exists | M |
| 2 | Subscriptions and recurring view, upcoming charges | Copilot, Cashew | Detect from synced and imported rows; local notifications exist | M |
| 3 | Savings goals | Cashew, YNAB, Monarch, Monobank jars | Goal links to a holding. Check the literal `jar: 'Jar'` in the en locale (src/i18n/locales/en.ts) first | S-M |
| 4 | Automatic encrypted backup to iCloud Drive | Cashew (Google Drive) | `.kiko` exists, manual today; helps a user who loses a phone. Policy text changes | M |
| 5 | Home-screen widgets (net worth, daily spending) | Copilot, YNAB | Shows money outside the app lock; Copilot hides widgets on iOS 18 under Face ID. Privacy decision first | M-L |
| 6 | Loan payoff calculator (interest and time saved) | YNAB | Loan schedule math exists | S |
| 7 | Alerts for a large expense or low balance | Copilot | Local notifications, only when a sync runs; background sync frequency not checked | S-M |
| 8 | Quick add by Shortcuts or a pre-filling app link | Cashew (app links) | No budgeting app found with Shortcuts or Siri (thin research) | S-M |

User ruling 2026-11-03 (after the judgment above): rows 1 and 3 (budgets, savings goals) fail the
fit filter in `.claude/skills/kiko-competitors/SKILL.md`, because Kiko answers how much money do
I have now and future planning is out of scope.

Possible, lower value: net worth in BTC, stablecoins as cash, what-if scenarios (Kubera); OFX
import (Wallet); income against expense report (Actual, YNAB; `BarChart` use in
src/screens/statistics/statistics.screen.tsx not checked); CSV export of own data (help
mentions CSV for import only; screens not checked); FinanceKit (US and UK only); tags and
receipts (absent in the en locale; no source for others).

Poor fit:

- Bank aggregators (GoCardless, SimpleFIN): a third party sees the data; would cover displaced
  users' European banks, so a user decision if the rule changes.
- Needs a server: group expense splitting, shared wallets, Dead Man's Switch, AI assistant,
  Monobank webhook.
- Stocks, ETFs, dividends: the user cut shares on 2026-10-02; broker accounts and bonds stay; a
  return needs a new design.

Coordinator recommendation: items 1, 2, 3 first (Kiko shows where money went but cannot help
plan; all use existing data), then item 4.

Limits: read failures and unread apps are in section D. User demand is weak evidence (section
C): comparison sites name real multi-currency and bank coverage outside the US. Kiko already
has multi-currency.

### F2. Category automation

Question (user): what else can we realistically do in terms of categories automation? Size and
risk are the coordinator's judgment. Read from code, app not run.

Today:

- MCC map: src/monobank/mcc-category/mcc-category.ts has 38 codes; every other code goes to
  `other`.
- Rules (src/categories/category-rules/): the matcher kinds are the `CategoryRuleMatcher` union
  in `category-rules.d.ts`; all conditions must match.
- "Apply" on a category change adds a rule for the name. Hand-set rows carry
  `categorySetByHand`.
- normalizeTransactionName fixes only unicode form, spaces and case: "ATB 0212" and "ATB 0340"
  stay different names.

Ideas:

| # | Change | Gives | Size | Risk |
|---|---|---|---|---|
| 1 | More MCC codes (for example hotels, airlines, department stores) | Fewer `other` rows, no user action | S | Old rows keep their category unless also rewritten |
| 2 | Review list: names in `other`, sorted by count or total; one tap assigns a category and adds the rule; built on the 1.4 branch, not shipped (`planReviewGroups`, `src/screens/settings/category-review/`) | Fastest way to clear old rows | M | Low |
| 3 | New rule conditions: all new conditions are built on the 1.4 branch, not shipped; see the `CategoryRuleMatcher` union (`src/categories/category-rules/category-rules.d.ts`) | "Rent" follows an IBAN; per-account rules | S-M | Backups, see the constraints in this part |
| 4 | Better "Apply": offer "starts with ATB" when the name ends in a store number; built on the 1.4 branch, not shipped, as the review list's offer (`src/screens/settings/category-review/review-line/review-line.component.tsx`) | Fewer rules, more matches | S | Wrong guess possible; user confirms |
| 5 | Built-in merchant list, common Ukrainian and European names | Helps CSV and XLSX rows with no MCC | M | Upkeep; partial cover of displaced users' countries |
| 6 | Suggestions from the user's own history | Names with no rule yet | M | Suggests only; user confirms |
| 7 | Day-of-month condition (rent on the 1st) | Small help for regular payments | S | Low |

On-device AI (Apple Foundation Models, Core ML classifier): no server needed, not recommended
now. Ukrainian support and device limits not checked; results can differ between runs and
categories feed statistics. Items 2 and 6 give most of the value with predictable results.

Constraints for all:

- A row set by hand never changes.
- An automatic guess never overwrites a category without confirmation, unless the row has no
  real category yet.
- A build that gates on the file's export version refuses a file it cannot read before any rule
  is read; a build that reads the rule rows treats a rule with an unknown matcher as unreadable,
  and it never matches. Check the version gate at the tag. The spec must cover it.

Coordinator recommendation: items 1, 2, 4 first, in that order (small, no rule format change,
most manual work saved), then item 3.

Open fact: unknown how many of the user's rows are in `other`, and how many have no MCC (data
is on the iPhone). A device count decides between items 1 and 5. Monobank rows have an MCC;
most CSV rows from other banks may not (not checked per bank).

### F3. Table views

Question (user): are there common or expected ways to view own finance data as a table that
Kiko could implement? Source: the coordinator's general knowledge, NOT researched for this
question. App examples (Kubera, Ghostfolio) are from memory: read them as UNVERIFIED. Read
from code, app not run.

Common forms:

| # | Table | Rows and columns | Data in Kiko |
|---|---|---|---|
| 1 | Category by month | Categories in rows, months in columns, total and average columns | Yes: src/statistics/category-breakdown, src/statistics/buckets |
| 2 | Cash flow | Income, expenses, net, savings rate, one column per month | Mostly; no income report today, new calculation |
| 3 | Net worth by month | Accounts in rows (assets, debts), months in columns, change | Yes: src/statistics/net-worth-series, src/statistics/holding-value-at |
| 4 | Holdings | Item, quantity, cost, value, gain, share of total (Kubera, Ghostfolio: UNVERIFIED, from memory) | Mostly; cost and gain per holding type not checked |
| 5 | Transaction register | Date, name, category, account, amount, running balance; sort, filter | Yes; suits a wide screen best |

Smaller forms: merchants (total, count, average per merchant; can also feed the review list in
F2, idea 2); CSV export (help mentions CSV for import only; screens not checked).

Kiko constraints:

- SummaryTable shows only label and value per row. These tables need a new component: fixed
  first column, horizontal scroll.
- Phone portrait shows about 2-3 month columns: default to the last 3 months, scroll for older
  ones. Landscape and the unfolded Duo show more.
- Each table uses the same transfer, exchange and loan exclusions as Statistics, so totals match
  the charts.
- Amounts in the base currency, as in Statistics. Which rate applies to each past month: not
  checked.
- A tap on a cell opens the transactions behind the number.
- Test long uk labels and large Dynamic Type sizes: wide numbers can overflow a column.

Coordinator recommendation: tables 1 and 2 first, as a "Table" view in Statistics next to the
charts, reusing its filters. Then table 3. CSV export is a small separate item. No register on a
phone: the current transaction list does that work better on a narrow screen.
