# Shares, property, metals, and debts — design spec

- **Status:** DESIGN SPEC, round 2. User decisions from round 1 are recorded below. No app code changed. No implementation plan yet — the user reviews this spec first.
- **Date checked:** 2026-09-23 (all web sources and live API tests are from this date unless a row says otherwise).
- **Branch:** `shares-assets-research` (based on `next`, App Store build 25).
- **Users:** Ukrainians, inside Ukraine and displaced worldwide (EU, UK, North America). Every feature must serve both groups.

Legend: **[verified]** = read on a primary source or tested live. **[secondary]** = news/review site, not the primary source. **[unverified]** = a lead only; confirm before the plan relies on it. **[inferred]** = my conclusion from data, not a stated fact.

---

## 0. Decision log

| # | Question | Decision | Decided by |
|---|---|---|---|
| D1 | Name of the generic asset kind | **"Property" / "Майно"** | user, round 2 |
| D2 | How a value changes over time | **Price series** (the user's idea, like currency rates), not ledger rows — see §2 | spec recommendation, user idea |
| D3 | Share prices | **Auto-priced.** Manual-only price rejected. Quotes come from a user-supplied key (BYOK) or from broker sync | user, round 2 |
| D4 | Precious metals | **Own asset type and own picker.** Not in the currency list. Not only inside Property | user, round 2 |
| D5 | Debts, mortgage | **In scope.** The net-worth rule changes from "assets only" to "assets minus debts" | user, round 2 |
| D6 | Broker import/sync | **All brokers covered** where a route exists: IBKR, Trading 212, Freedom24, plus Revolut and Ukrainian brokers | user, round 2 |
| D7 | BYOK (user pastes a quote-API key) | **Accepted**, same pattern as the Monobank token | user, round 2 |
| D8 | Bond by ISIN | **"ISIN / Manual" mode chips** in the Bond form, validated against the NBU register — see §6 | user request, feasible |
| D9 | Non-bank institutions (Diia, brokers) | **New account kind "Broker / Брокер"**. Diia is NOT an institution — see §7 | spec recommendation |

**Rejected options** (kept here so they are not proposed again):
- Manual-only share price (D3).
- Metals as currencies in `currencyOptions` (D4) — they would appear in the base-currency picker.
- Revaluation as `manual` ledger rows (D2) — see §2.3.
- Yahoo Finance unofficial endpoints — Terms of Service risk and frequent breakage.
- A key for a quote service shipped inside the app — the key can be extracted, and the free tiers forbid public-app use.
- "Asset / Актив" as the name — "Актив" already means Holding in the Kiko uk catalogue.
- A generic "Institution" account kind — it loses the kind → holding-type gating that the forms rely on.
- Diia as an institution — Diia does not hold the bonds.

---

## 1. Codebase facts this spec builds on

Mapped by `kiko:explorer` in two passes. I spot-checked the key facts in this session.

| Area | Fact | Source |
|---|---|---|
| Account kinds | `bank`, `cash`, `crypto` (TS-only enum, no DB CHECK → widening needs no migration) | `src/db/schema.ts:7-16` |
| Holding types | `card`, `term_deposit`, `bond`, `cash`, `crypto_asset`, `jar` | `src/db/schema.ts:44` |
| Kind → types | `bank: ['card','term_deposit','bond','jar']`, `cash: ['cash']`, `crypto: ['crypto_asset']` | `src/holdings/holding-type/holding-type.ts:29-31` |
| Derived value | `bond`/`term_deposit` save metadata only; value is computed at read by `holdingValueBreakdown` | `src/screens/forms/holding-form/holding-form.screen.tsx:118-142`, `src/holdings/holding-value/holding-value.ts` |
| Past value | `holdingValueAt`: bond/deposit → analytic; others → opening balance + ledger up to the local day | `src/statistics/holding-value-at.ts:31-47` |
| Rate lookup by date | `rateTableAt(rows, day)`: nearest row AT OR BEFORE the day (carry-forward); `earliestRateTable` for days before the first row | `src/rates/rate-history-repo/rate-history.repo.ts:47,82` |
| Rate storage | `currencyRates` (latest) + `currencyRateHistory` (one row per pair per day), keyed on the closed `currencyOptions` enum | `src/db/schema.ts:168-207` |
| Statistics exclusion | exchange legs, internal transfers, description/MCC transfer patterns; category breakdown counts only negative amounts | `src/statistics/exchange-exclusion/`, `internal-transfers/`, `transfer-exclusion/`, `category-breakdown/category-breakdown.ts:169,178` |
| Bond coupons | computed on the fly (`derivedEntries()`), never written as transactions → statistics never see them | `src/holdings/derived-entries/derived-entries.ts` |
| Money sign | `Money` allows negative values (`negate()` exists); no clamp in net-worth code | `src/currency/money/money.ts`, `src/rates/net-worth-view/net-worth-view.ts` |
| Net-worth chart | Y axis floors to the series' own minimum → a negative net worth draws correctly | `src/screens/statistics/net-worth-line/net-worth-line.component.tsx:133-145` |
| Pie chart | computes percent shares of the total → negative slices are not supported | `src/screens/statistics/pie-chart/pie-chart.component.tsx:121-126` |
| Bond form | one shared holding form; bond fields: quantity, faceValue, couponPct, purchasePrice (optional, default = nominal), purchaseDate, maturityDate, bondKind chips, couponFrequency chips | `holding-form.screen.tsx:625-644, 695-727, 1110-1215` |
| Chips | `ChipRow` `{options, selected, onSelect, labels}`; the holding `type` ChipRow already switches form sections | `holding-form.screen.tsx:921` |
| Institutions | `accounts.institution` = live-sync provider key (only `monobank`); `accounts.bankId` = identity from `bankCatalog` (`monobank, privatbank, sensebank, procredit, ukrsib, alfa`) | `src/bank-sync/bank-catalog/bank-catalog.ts`, `account-form.screen.tsx:103,208,366,488` |
| Credentials | Keychain per account, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (Monobank token, Binance key+secret JSON) | `src/monobank/token/token.ts`, `src/crypto-sync/binance/binance.credentials.ts` |
| Pinning gate | `plist.sh` greps `src/**/*.ts` for `'X-Token'`, `'X-MBX-APIKEY'`, `'Authorization'`, `'api-key'`-like literals; the file must import its host from `@env`; the host must be in `NSPinnedDomains` with ≥2 CA SPKI pins | `scripts/checks/plist.sh:74` |
| Refresh cadence | rates: 5-min throttle; triggered on app open (auto-sync mount) and pull-to-refresh; no background fetch | `src/rates/rates-refresh/rates-refresh.ts:12,158-164`, `src/sync/use-auto-sync/use-auto-sync.ts:20,34` |

**Existing inconsistency found:** a credit `card` with a negative balance already lowers net worth today, although the kiko-domain skill says "net worth is assets-only" (`.claude/skills/kiko-domain/SKILL.md:370`). D5 makes the rule match the code.

---

## 2. Valuation model — price series (D2)

### 2.1 What a revaluation is (plain words)

A flat, a car, or a watch has no bank balance. Its value is an estimate that changes over time. Example: the user bought a car for USD 20,000 in 2024. In 2026 a similar car sells for USD 16,000. The user tells Kiko "the car is now worth 16,000". That new estimate is a **revaluation**. No money moved. Only the estimate of the value changed.

### 2.2 The user's idea

"Use the same mechanism as currency rates." A holding value = **quantity × price at date**. The prices are a series of (day, price) points, stored and looked up like `currencyRateHistory` and `rateTableAt`.

- A car: quantity 1, price series = the user's estimates (2024-03-01: 20,000; 2026-09-01: 16,000).
- Gold: quantity 31.1 g, price series = NBU XAU per day.
- A share: quantity 12.5, price series = daily close from the quote provider or the broker.

### 2.3 Comparison

| Criterion | A. Ledger rows (round-1 idea) | B. Price series (user idea) |
|---|---|---|
| History chart / net worth at date | works through `holdingValueAt` ledger walk | works through a new branch: `quantityAt(day) × priceAt(day)`, carry-forward lookup copied from `rateTableAt` |
| Statistics exclusion | **every** revaluation row must be excluded by a new marker in every statistics query — a new place for bugs | **automatic**: no transaction is written, like bond coupons today |
| Reuse | reuses `updateWithBalanceDelta` | reuses the lookup rule and the "value derived at read" pattern of `bond`/`term_deposit`; needs one new table |
| One model for Property, metals, shares | no — shares and metals need a price anyway | **yes** — the same code values all three; only the price SOURCE differs (manual, NBU, quote API, broker) |
| Sparse data (2 estimates in 3 years) | fine | fine: carry-forward holds the last estimate until the next one |
| Honest "as of" date | hard to show | the latest point's date is the "as of" date |

**Decision: B (price series).** It removes the statistics-exclusion risk and gives one valuation path for Property, metals, and shares.

`currencyRates`/`currencyRateHistory` are NOT reused directly. They are keyed on the closed `currencyOptions` enum, and a share ticker or a car is not a currency. A new table copies their shape and lookup rule.

### 2.4 Data model sketch

New table `price_points` (name open to review):

| Column | Type | Note |
|---|---|---|
| `instrument` | text | `share:AAPL.US`, `metal:XAU`, or `holding:<holdingId>` (a private series for one Property item) |
| `day` | int | UTC midnight ms, same as `currencyRateHistory.day` |
| `price` | text | scaled decimal string, never float (same rule as `currencyRates.rate`) |
| `currency` | text | quote currency, in `currencyOptions` (GBX needs a rule: store GBP and divide by 100 at ingest) |
| `source` | text enum | `manual`, `nbu`, `eodhd`, `alphavantage`, `trading212`, `ibkr`, `freedom24` |

Unique on `(instrument, day)`. Lookup = nearest row at or before `day`; before the first row, use the first row (same as `earliestRateTable`).

**Quantity over time.** A share position changes when the user buys or sells. Holding metadata keeps `lots: [{ day, quantityDelta, costMinorUnits }]`. `quantityAt(day)` = sum of deltas up to the day. Cost basis = sum of costs. Property items have one lot (quantity 1). This keeps quantity history without transaction rows.

**Holding value** = `quantityAt(day) × priceAt(instrument, day)`, in the price currency, then converted to base through the existing rate table.

**Cash leg.** Buying shares with money from a bank account is a separate question (open question Q4). The price series does not move cash.

---

## 3. Shares — auto-priced (D3, D6, D7)

### 3.1 How Ukrainians buy securities (research from round 1)

| Route | Users | Sells | API | Export | Source |
|---|---|---|---|---|---|
| Diia "Military bonds" | residents | OVDP via partners; Diia does not sell | none | none from Diia | [militarybonds.diia.gov.ua](https://militarybonds.diia.gov.ua/) [verified] |
| Monobank | residents | OVDP UAH/USD/EUR | no securities endpoint [unverified] | [unverified] | [finance.ua](https://news.finance.ua/ua/monobank-dozvolyv-kliyentam-kupuvaty-valyutni-ovdp) [secondary] |
| mono invest (EXANTE) | — | **closed**: stopped 2022-02; EXANTE sanctioned 2023-07 | — | — | [finclub.net](https://finclub.net/news/klientiv-mono-invest-zmushuyut-prodati-aktsiji-oskilki-broker-exante-opinivsya-pid-sanktsiyami.html) [secondary] |
| PrivatBank | residents | OVDP from UAH 1,000 | none | [unverified] | [privatbank.ua](https://privatbank.ua/news/2025/11/20/privatbank-zapustiv-kupivlyu-ta-prodazh-ovdp-u-mobilnomu-zastosunku-privat24) |
| ICU Trade | residents | OVDP, funds, BAVL shares | none public; depository statements | [unverified] | [App Store](https://apps.apple.com/ua/app/icu-trade/id1494280961?l=uk), [online.icu](https://www.online.icu/en) |
| UNIVER | residents | OVDP, shares, funds | none public | [unverified] | [investor24](https://investor24.com.ua/brokers/univer/) [secondary] |
| Freedom Finance Ukraine | — | **closed to new clients**, sanctioned | — | — | [investor24](https://investor24.com.ua/brokers/freedom-finance/) [secondary] |
| Freedom24 (CySEC) | residents + abroad | 15 exchanges | Tradernet API, public + private key | reports [unverified] | [freedom24.com/tradernet-api](https://freedom24.com/tradernet-api) |
| Interactive Brokers | residents + abroad | 150+ exchanges | Flex Web Service: read-only token (6 h – 1 y, optional IP lock) + a Flex Query | Flex CSV/XML | [ibkrguides](https://www.ibkrguides.com/clientportal/performanceandstatements/flex-web-service.htm) [verified] |
| Trading 212 | mostly abroad | shares, ETFs, fractional | Public API (beta): key + secret, HTTP Basic, **read-only scope available**, optional IP lock; Invest + ISA only; rate limits in `x-ratelimit-*` headers | CSV | [help centre](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key), [rate limiting](https://docs.trading212.com/api/section/rate-limiting/how-it-works) [verified] |
| Revolut | abroad | shares, ETFs | none | account + P&L statements; CSV vs PDF-only unclear [unverified] | [Revolut help](https://help.revolut.com/help/wealth/stocks/getting-started-with-trading/managing-your-trading-account/trading-statements/accessing-my-trading-statements-and-reports/) |

Regulation (residents): from 2026-08-11 the NBU monthly limit for non-cash FX purchase is UAH 200,000 and also covers foreign securities and bank metals ([finance.ua](https://news.finance.ua/ua/novi-limity-na-kupivlyu-valyuty-shho-dozvolyv-nbu) [secondary]). Kiko values holdings; it does not track or enforce limits.

Exchanges: UX licence revoked 2024-06 ([Wikipedia](https://en.wikipedia.org/wiki/Ukrainian_Exchange) [secondary]). OVDP secondary prices form on PFTS; PFTS publishes no API or CSV ([pfts.ua](https://pfts.ua/trade-info/torgi-ovdp) [verified]). Ukrainian company shares that residents can reach sit mostly on foreign exchanges ([investor24](https://investor24.com.ua/aktsii-ukrainskyh-kompaniy/) [secondary]).

### 3.2 BYOK quote providers

With BYOK, the user signs up with the provider, accepts its personal-use terms, and pastes the key. Kiko stores it in Keychain per provider. Kiko does not ship a key.

| Provider | Free tier | Paid entry | Coverage relevant to users | Symbol search | Auth | Host to pin | Source |
|---|---|---|---|---|---|---|---|
| **EODHD** | 20 calls/day; EOD data, past year only | USD 19.99/month EOD, 100,000 calls/day | 150,000+ tickers worldwide; US, LSE, XETRA [verified]; Warsaw (WSE) [unverified] | yes [unverified on free] | `api_token` query param | `eodhd.com` | [pricing](https://eodhd.com/pricing), [EOD API](https://eodhd.com/financial-apis/api-for-historical-data-and-volumes) |
| **Alpha Vantage** | 25 calls/day, 5/min; quote updated at end of each trading day | premium for realtime | US, LSE (`.LON`), XETRA (`.DEX`), Toronto (`.TRT`), India, China; WSE [unverified] | `SYMBOL_SEARCH` free | `apikey` query param | `www.alphavantage.co` | [docs](https://www.alphavantage.co/documentation/) [verified] |
| Finnhub | 60 calls/min | paid for international | US real-time; international coverage on free [unverified] | yes | token | `finnhub.io` | [pricing](https://finnhub.io/pricing) (did not render) |
| Twelve Data | 8/min, 800/day | paid | US equities/ETFs, FX, crypto only on free | yes | key | `api.twelvedata.com` | [pricing](https://twelvedata.com/pricing) [verified] |

**What Ukrainians hold, and who prices it:**

| Holding | Priced by |
|---|---|
| US shares/ETFs (Nasdaq, NYSE) | EODHD, Alpha Vantage, broker sync |
| LSE (incl. UCITS ETFs; GBX pence) | EODHD, Alpha Vantage, broker sync |
| XETRA / EU | EODHD, Alpha Vantage, broker sync |
| WSE (some Ukrainian companies) | EODHD [unverified], broker sync |
| OVDP (UA government bonds) | **no quote source**; valued by the existing bond model (cost + coupons). PFTS has no feed |
| BAVL on PFTS | no source; manual price point (the Property-style manual series) |

**Decision proposal:** ship **EODHD first** (widest exchange list, a cheap unlimited paid tier for heavy users), and **Alpha Vantage second** in the same phase if the effort is small. Both behind a small `QuoteProvider` registry, like the `BankProvider` registry. Open question Q3 confirms the order.

**Refresh cadence:**
- Prices are **end-of-day**. Real-time adds no value for net worth and costs quota.
- On app open (the existing auto-sync hook) and on pull-to-refresh: fetch a new close only for instruments whose latest `price_points.day` is older than the last trading day. At most **one call per instrument per day**.
- First add: one historical call per instrument fills the series from the first lot date (EODHD free: past year only; older days use the earliest point, as `earliestRateTable` does).
- Quota guard: count calls per provider per day in settings. When the free quota is near its end, stop, keep carry-forward prices, and show "prices as of <date>". 20 instruments/day fit the EODHD free tier.
- Broker-synced positions carry the broker's own price (T212 positions and IBKR Flex open positions include a price [unverified field names]). Those instruments need no BYOK call.

### 3.3 Broker sync, per broker

| Broker | Route | Credential | Host(s) to pin | Data | Status |
|---|---|---|---|---|---|
| **Trading 212** | Public API (beta) | key + secret, read-only scope; Keychain | `live.trading212.com` | positions, cash, history, dividends | feasible; beta = API can change |
| **Interactive Brokers** | Flex Web Service (SendRequest → GetStatement, XML) + file import of a Flex CSV | token + query id; the user must create a Flex Query in Client Portal once (Kiko shows the steps) | IBKR Flex host (`ndcdyn.interactivebrokers.com` [unverified]; docs page returned 403) | positions, trades, dividends, cash; updated once per day | feasible; setup friction |
| **Freedom24** | Tradernet API | public + private key; signing method [unverified] | Tradernet host [unverified] | portfolio, positions, P&L | **needs a spike** before the plan: auth details did not load |
| **Revolut** | statement import only (no API) | none | none | trading account statement | depends on CSV availability [unverified]; PDF parsing rejected |
| **ICU, UNIVER, Dragon** | no API | none | none | — | manual: bonds by ISIN mode (§6), shares with a manual price series |
| **Monobank, PrivatBank, Diia bonds** | no securities API | none | none | — | ISIN mode (§6) under the bank that holds the bonds |

Every new host sends a credential → it must be in `NSPinnedDomains` with ≥2 CA SPKI pins, or `npm run check:plist` fails. The `plist.sh` grep looks for credential **header** literals. EODHD (`api_token`) and Alpha Vantage (`apikey`) send the key as a **query parameter**. The Alpha Vantage literal `'apikey'` matches the `'[Aa]pi[-_]?[Kk]ey'` pattern, but `'api_token'` does not. **Action for the plan:** widen the grep (or add a Semgrep rule with a fixture) so the EODHD client is detected as credential-bearing. Do not rely on the current pattern.

### 3.4 Share holding

- Account kind `broker` (see §7) — also allowed under `bank` for a bank that sells shares [inferred need: Revolut is a bank].
- Holding type `share`, metadata `ShareMeta`: `symbol` (provider form, for example `AAPL.US`), `isin?`, `exchange`, `name`, `lots[]`, `quoteSource` (`eodhd | alphavantage | broker | manual`).
- Value = §2.4. Show market value, cost basis, unrealized gain, and "price as of".
- Dividends: from broker sync as income transactions on the broker cash holding. Manual users add them as income.

---

## 4. Precious metals (D4)

- **Account kind** `metals` — en "Precious metals", uk "Дорогоцінні метали". Own entry in the add-account picker.
- **Holding type** `metal`, metadata `MetalMeta`: `metal` (`XAU` gold, `XAG` silver, `XPT` platinum, `XPD` palladium), `form` (`bar`, `coin`, `bank_account`), `unit` (`g`, `oz`), `purity` (for example 0.9999), `lots[]`.
- Also creatable under `bank` for a bank metal account [inferred need; open question Q2].
- **Price:** NBU official price in UAH per troy ounce, keyless, host `bank.gov.ua` (already contacted, unpinned, no credential).
  - Current: `GET https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json` → `XAU` 193295.79, `XAG` 2919.24, `XPT` 79652.08, `XPD` 57079.09 (exchangedate 24.09.2026) **[verified]**.
  - History by date: `GET .../exchange?valcode=XAU&date=20250102&json` → `XAU` 109583.9 on 02.01.2025 **[verified]**. This backfills the series with no new host.
- **Value** = weight in troy ounces × purity × NBU price (1 troy oz = 31.1034768 g). Coin collector premium is not modelled.
- Metals are NOT added to `currencyOptions` (rejected option).

---

## 5. Debts and the net-worth rule change (D5)

### 5.1 Model

- **Account kind** `debt` — en "Debt", uk "Борг" (label open: Q6).
- **Holding type** `loan`, metadata `LoanMeta`:
  - `kind`: `mortgage`, `car_loan`, `consumer_loan`, `personal` (money the user owes a person).
  - `principalMinorUnits`, `startDate`, `annualRatePct?`, `termMonths?`, `schedule`: `annuity`, `differentiated`, or `none`.
- **Outstanding balance:**
  - `annuity`/`differentiated`: computed at read from the schedule (like deposit interest in `src/holdings/interest/`). The user can add a correction point (a manual price point on `holding:<id>`) when the bank statement differs.
  - `none` (informal debt): a manual series of outstanding amounts (the same price-series mechanism as Property).
- **Value** = −outstanding, as negative `Money` (`Money` already allows negative values).
- A loan the user GAVE to someone stays an **asset**: Property category `loan_given`.

### 5.2 Rule change

- Old rule (`kiko-domain` skill line 370): "Net worth is assets-only — liabilities and debt are out of scope".
- **New rule:** net worth = Σ asset values − Σ debt outstanding, in the base currency. Credit-card negative balances (already negative today) count as debt too.
- The kiko-domain skill must be updated in the same task (standing rule "update skills in the same task").

### 5.3 UI effects

| Surface | Change |
|---|---|
| Headline net worth | can be negative; format with a minus sign |
| `NetWorthLine` | no change: the Y axis already floors to the series minimum |
| Pie chart / `CurrencyBreakdown` | percent shares need positive parts → the pie shows **assets only**; a separate "Debts" total line shows below it |
| Accounts list | a "Debts" section with totals shown as negative |
| Statistics | loan repayments from a bank account stay spending by default; split into interest and principal is open question Q5 |

---

## 6. Bond form — ISIN mode (D8)

### 6.1 NBU register facts (tested live 2026-09-23)

`GET https://bank.gov.ua/depo_securities?json` (keyless, host already contacted):
- **196 records**: 177 UAH, 16 USD, 3 EUR. Issuer of all: Міністерство фінансів України.
- `cptype`: 187 `DCP` (domestic OVDP, nominal 1000, ISIN `UA4000…`) and 9 `OZDP` (Eurobonds, ISIN `XS…`, nominal 1, fractional `pay_val`).
- Maturity range 2026-06-24 … 2052-05-02. Only 2 records are already matured → the register keeps matured bonds for only a short time [inferred].
- **All 196 ISINs pass the ISO 6166 check digit** (letters → numbers, Luhn mod 10) — tested with a local script.
- Each record has `payments[]` with `pay_date`, `pay_type` (`1` = coupon, 3445 rows; `2` = redemption, 195 rows), `pay_val`.

### 6.2 Field mapping

| Register field | Kiko field |
|---|---|
| `cpcode` | new `BondMeta.isin` |
| `nominal` | `faceValueMinorUnits` (via `Money.fromMajor`) |
| `auk_proc` | `couponPct` |
| `pgs_date` | `maturityDate` |
| `val_code` | holding `currency` |
| `pay_period` (182, …) | `couponFrequency`: ~30 → monthly, ~91 → quarterly, ~182 → semiannually, ~364 → annually; any other value → Manual mode with the known fields filled |
| `emit_name` = Minfin | `bondKind = 'government'` |
| `cpdescr` + `cpcode` | default `name` (editable) |
| `payments[]` | later phase: exact coupon dates and amounts instead of the frequency approximation |

### 6.3 Feasibility against the current form

**Feasible.** The form already switches sections with `ChipRow` (`holding-form.screen.tsx:921`). A second `ChipRow` "ISIN / Manual" inside the bond section follows the same pattern.

**Limit: ISIN alone is not enough.** The register gives the bond's terms, not the user's position. ISIN mode must still show:
- `quantity` (required),
- `purchaseDate` (default today),
- `purchasePrice` (optional, default = nominal, as today).

It hides face value, coupon, maturity, kind, and frequency — those come from the register.

### 6.4 Validation and edge cases

1. **Format:** `^[A-Z]{2}[A-Z0-9]{9}[0-9]$`, auto-uppercase. Accept any country prefix (`UA`, `XS`).
2. **Check digit:** ISO 6166 Luhn. Error: "ISIN check digit is wrong".
3. **Existence:** look up the ISIN in the cached register.
   - Found → fill the terms; show a read-only summary (coupon, maturity, currency).
   - Not found (a matured bond, a corporate bond, a typo with a valid check digit) → message "Not in the NBU register" with a button that switches to Manual and keeps the ISIN.
4. **Offline:**
   - Cache the register in SQLite with `fetchedAt`. Refresh it at most once per day when the form opens.
   - Offline with a cache → validate against the cache.
   - Offline with no cache → format + check digit pass, but the terms are unknown → the same "switch to Manual" path.
5. **After save** the holding keeps the full terms in `BondMeta`. It never depends on the register again.
6. **Edit** opens in Manual mode with all fields filled (the ISIN is shown and stays editable).

---

## 7. Institutions — Diia and brokers (D9)

### 7.1 Where Diia bonds are held

Diia is a **storefront**. "Дія не продає облігації самотужки. Партнери купують їх у держави та продають через застосунок." The bonds go to a securities account at the partner the user picks ([militarybonds.diia.gov.ua](https://militarybonds.diia.gov.ua/) [verified]).

- Partners shown on the page on 2026-09-23: PrivatBank, PUMB, Oschadbank, Alfa-Bank, UkrSibBank, Raiffeisen Bank Aval [verified].
- Older sources name Ukrgasbank and BTS Broker ([ukrgasbank.com](https://www.ukrgasbank.com/private/securities/ovdp/ovdp_diya), [btc-broker.com](https://btc-broker.com/diia-military-bonds)) [secondary; the list changes over time].
- Securities appear on the investor's account at the broker/bank within three business days ([paperless.diia.gov.ua](https://paperless.diia.gov.ua/instruction/yak-pridbati-viiskovi-obligaciyi-u-zastosunku-diya) [secondary]).

**Decision:** Kiko has no "Diia" institution. The user adds the bond under the partner bank or broker that holds it. The Bond form shows a hint: "Bought in Diia? Add the bond under the bank or broker you chose there."

Catalog gap: `bankCatalog` has no PUMB, Oschadbank, Raiffeisen, or Ukrgasbank. Add them as identity-only entries (`connectable: false`, no statement format).

### 7.2 Broker kind

- **Account kind** `broker` — en "Broker", uk "Брокер".
- Allowed holding types: `share`, `bond`, `cash` (broker cash, one holding per currency).
- **Broker catalog** (same shape as `bankCatalog`): `trading212`, `ibkr`, `freedom24` (connectable once each sync ships), `revolut`, `icu`, `univer`, `dragon`, and "Other broker" (free-text name). Plain text names only; no logos (compliance: third-party trademarks). No sanctioned brokers (EXANTE, Freedom Finance Ukraine).
- `accounts.institution` marks a live-connected broker, as it marks Monobank today.

**Rejected:** a generic "Institution" kind (loses type gating); putting brokers under `bank` (a broker is not a bank, and bank-only types such as `card`/`jar` would be offered).

---

## 8. Property (D1, D2)

- **Account kind** `property` — en "Property", uk "Майно". Picker subtitle: en "Real estate, car, valuables, money you lent", uk "Нерухомість, авто, цінності, позики іншим".
- **Holding type** `property_item`, metadata: `category` (`real_estate`, `vehicle`, `valuable`, `loan_given`, `business_share`, `other`), `lots[]` (one lot: acquired date + cost).
- Value = the private price series `holding:<id>` (§2). "Update value" adds a manual point for today (or a chosen date).
- Metals are NOT a Property category (they have their own kind, D4).
- Name reasons (round 1): no collision with "Актив" = Holding; Civil Code art. 190 defines "майно" as things AND property rights, which covers a loan given and a business share ([protocol.ua](https://protocol.ua/ua/tsivilniy_kodeks_ukraini_stattya_190/) [secondary]).

---

## 9. Compliance

- **Guideline 5.6:** every phase ships complete and visible. No flag, no "coming soon" entry. A broker appears in the catalog as connectable only in the release that ships its sync.
- **ATS pinning:** new credential hosts — `eodhd.com`, `www.alphavantage.co`, `live.trading212.com`, the IBKR Flex host, the Tradernet host — each need ≥2 CA SPKI pins. `bank.gov.ua` stays keyless and unpinned. Widen the `plist.sh` credential detection for query-param keys (§3.3).
- **Privacy policy:** each new third party (EODHD, Alpha Vantage, Trading 212, IBKR, Freedom24) is named in the bilingual policy on `gh-pages` before the release that contacts it.
- **Trademarks:** plain text broker/provider names; no logos; no wording that suggests a partnership.
- **No financial advice:** values, gains, and dates only.
- **Translations:** every new en/uk key is reviewed by the user before a deploy.

---

## 10. Phases

| Phase | Scope | New host | Size |
|---|---|---|---|
| **P1** | Price-series foundation (`price_points`, carry-forward lookup, `lots`, value branch in `holdingValueBreakdown` + `holdingValueAt`) + **Property / Майно** with manual value updates | none | M |
| **P2** | **Precious metals** kind + `metal` type + NBU current and historical prices | none | S |
| **P3** | **Bond ISIN mode** + register cache + Diia hint + missing banks in the catalog | none | S |
| **P4** | **Debts / Борг** + loan schedules + net-worth rule change + pie/accounts UI + kiko-domain skill update | none | L |
| **P5** | **Broker** kind + catalog + `share` type + **BYOK quotes (EODHD, then Alpha Vantage)** + quota guard + `plist.sh` detection fix | `eodhd.com`, `www.alphavantage.co` | L |
| **P6** | **Trading 212** sync | `live.trading212.com` | M |
| **P7** | **IBKR** Flex sync + Flex CSV file import | IBKR Flex host | M |
| **P8** | **Freedom24** sync — after a spike on Tradernet auth | Tradernet host | M |
| **P9** | **Revolut** statement import — only if a CSV export is confirmed | none | S |
| Later | exact OVDP coupon schedule from `payments[]`; accrued coupon (dirty value) | none | S |

P1 comes first because P2, P4 (informal debts), and P5 reuse its price series.

---

## 11. Open questions for the user

1. **ISIN mode fields:** ISIN alone cannot give the user's quantity. Is "ISIN + quantity (+ purchase date and price with defaults)" acceptable?
2. **Metals under banks:** allow a `metal` holding under a `bank` account (bank metal accounts), or only under the own Metals kind?
3. **First quote provider:** EODHD first, Alpha Vantage second — agree? Or ship both in P5?
4. **Cash leg of a trade:** when the user buys shares, should Kiko also move money out of a bank holding (a transfer), or keep the share holding independent (as bonds are today)?
5. **Loan payments in statistics:** count the full monthly payment as spending, or only the interest part?
6. **Debt label:** "Debt / Борг" or "Liability / Зобов'язання"?
7. **Phase order:** P4 (debts) before P5 (shares) as proposed, or shares first?
8. **Catalog:** add PUMB, Oschadbank, Raiffeisen, Ukrgasbank as identity-only banks — agree?

---

## 12. Unverified items (confirm before the plan)

- IBKR Flex host name (docs page returned HTTP 403 to automated fetch).
- Freedom24 Tradernet auth method and host.
- Trading 212 and IBKR position price field names.
- EODHD coverage of WSE; symbol search on the free tier.
- Finnhub free-tier international coverage.
- Revolut trading statement CSV availability.
- Monobank personal API: no securities endpoint.
- NBU press release text for the 2026-08-11 limits (HTTP 403 to automated fetch).
- Whether BYOK personal-use licences allow display inside a third-party app the user runs for themselves (legal reading of each provider's terms).
