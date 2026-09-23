# Shares and generic assets — feasibility study

- **Status:** research only. No app code changed. No implementation plan yet.
- **Date checked:** 2026-09-23 (all web sources below were read on this date unless a row says otherwise).
- **Branch:** `shares-assets-research` (based on `next`, App Store build 25).
- **Users:** Ukrainians, inside Ukraine and displaced worldwide (EU, UK, North America). A feature must serve both groups.

Legend: **[verified]** = read on a primary source or tested live. **[secondary]** = from a news/review site, not the primary source. **[unverified]** = not confirmed; treat as a lead.

---

## 1. Summary and recommendation

1. **Shares are feasible as a MANUAL holding now. Live quotes are NOT feasible now.** No stock-quote API is keyless, free, allowed for a distributed app, and safe to call from an iOS binary. Every usable source needs an API key, and a key in the app bundle is extractable. The personal/non-commercial free tiers (Finnhub, Twelve Data) also forbid an app that ships to the public.
2. **Ukrainian government bonds (OVDP) get a cheap, real upgrade.** The NBU publishes the full OVDP register (ISIN, nominal, currency, maturity, full coupon schedule) as keyless JSON on `bank.gov.ua` — a host Kiko already contacts. Kiko can prefill its existing `bond` holding from an ISIN with no new network domain.
3. **Precious metals get live valuation for free.** The NBU rate feed that Kiko already calls also returns XAU, XAG, XPT, and XPD (UAH per troy ounce). Kiko can treat these as currencies in the existing rate pipeline.
4. **Generic assets fit the current model with small changes.** Add one account kind and one holding type, and record each revaluation as a ledger row. The history of value then comes from the existing `holdingValueAt` path.
5. **Name recommendation:** English **"Property"**, Ukrainian **"Майно"**. Reason: "Актив" is ALREADY the Ukrainian word for a Holding in Kiko, so "Asset / Актив" collides. "Майно" is the Civil Code term that covers things AND property rights (a loan given, a business share). See section B.4.
6. **Liabilities (mortgage, debt) are a separate, later phase.** Net worth is assets-only by a documented domain rule (`.claude/skills/kiko-domain/SKILL.md:370`). Negative values need a rule change, not only a new type.

**Recommended MVP:** (a) a manual `share` holding (ticker/ISIN, quantity, manual price, cost basis); (b) OVDP prefill by ISIN from the NBU; (c) the "Property / Майно" account kind with manual revaluation; (d) precious metals valued by NBU rates. No new network host in the MVP.

---

## 2. Codebase fit (current state)

Mapped by `kiko:explorer`, key facts spot-checked in this session.

| Area | Current state | Source |
|---|---|---|
| Account kinds | `bank`, `cash`, `crypto` | `src/db/schema.ts:16` |
| Holding types | `card`, `term_deposit`, `bond`, `cash`, `crypto_asset`, `jar` — no share/ETF type | `src/db/schema.ts:44` |
| Money | integer minor units + currency code; scale per currency (BTC 8, fiat 2) | `src/currency/currency/currency.ts` |
| Holding value | `holdingValueBreakdown()` switches on type; default = flat `balanceMinorUnits` | `src/holdings/holding-value/holding-value.ts` |
| Bond model | `BondMeta`: quantity, faceValueMinorUnits, couponPct, purchaseDate, purchasePriceMinorUnits, maturityDate, bondKind, couponFrequency. Valued at cost paid; coupons are discrete ledger events; no accrued interest | `src/holdings/holding-metadata/holding-metadata.ts:17-25`, `holding-value.ts:102-148` |
| Crypto value | balance IS the quantity, in the coin's own currency; converted by the rate table. No quantity x price code | `holding-value.ts` (`flat`) |
| Rates | Monobank `/bank/currency`, fallback NBU; CoinGecko for crypto; stored in `currencyRates` (latest) + `currencyRateHistory` (daily) keyed on the closed `currencyOptions` list | `src/rates/rates-refresh/rates-refresh.ts`, `src/db/schema.ts:168-207` |
| Missing rate | the holding is silently dropped from net worth and breakdown | `src/rates/net-worth-view/net-worth-view.ts` |
| Net worth | sum of holding values converted to base; assets-only | `src/rates/conversion/conversion.ts:54-63`, kiko-domain skill line 370 |
| Manual balance edits | `updateWithBalanceDelta` writes each delta as a `manual` transaction → value history is derivable | `src/holdings/`, `src/statistics/holding-value-at.ts` |
| Statement import | format registry with CSV/XLSX parsers (Monobank, Sense, PrivatBank XLSX, business CSVs) | `src/statement-import/formats/` |
| Network hosts | pinned: `api.monobank.ua`, `api.binance.com`; unpinned keyless: `api.coingecko.com`, `blockstream.info`, `bank.gov.ua` | `ios/Kiko/Info.plist` (ATS block), `docs/security/README.md` |
| i18n | en `holding: 'Holding'` ↔ uk `holding: 'Актив'`; uk `addTitle: 'Додати актив'`; `holdingsHeading: 'Активи'` | `src/i18n/locales/en.ts`, `uk.ts` |

**Consequence:** `currencyRates` cannot hold stock prices. It is keyed on a closed currency enum, not on open-ended tickers. A share price must live in holding metadata (MVP) or in a new price table (later).

---

## 3. Section A — Shares and stocks

### A.1 How Ukrainians buy securities today

| Route | Who uses it | What it sells | API | Statement export | Source |
|---|---|---|---|---|---|
| **Diia "Military bonds"** | residents in UA | OVDP (military bonds) via partner banks/brokers; Diia itself does not sell | none for users | none from Diia; the partner holds the securities account | [diia.gov.ua news](https://diia.gov.ua/news/vijskovi-obligaciyi-v-diyi-yak-pracyuye-nova-posluga-v-zastosunku), [militarybonds.diia.gov.ua](https://militarybonds.diia.gov.ua/) [secondary for flow details] |
| **Monobank** | residents | OVDP in UAH, USD, EUR ("Накопичення → Облігації") | the Monobank personal API has no securities endpoint [unverified — not seen in docs] | [unverified] | [finance.ua](https://news.finance.ua/ua/monobank-dozvolyv-kliyentam-kupuvaty-valyutni-ovdp), [kosht.media](https://kosht.media/oblihatsii-v-monobank-iak-kupyty-v-zastosunku-i-iaka-alternatyva/) [secondary] |
| **mono invest** (Monobank + EXANTE) | — | foreign shares; **closed**: trading stopped Feb 2022; EXANTE sanctioned by NSDC July 2023; clients told to close positions | — | — | [finclub.net](https://finclub.net/news/klientiv-mono-invest-zmushuyut-prodati-aktsiji-oskilki-broker-exante-opinivsya-pid-sanktsiyami.html), [kosht.media](https://kosht.media/servis-mono-invest-pryzupyniaie-robotu-yak-vyvesty-svoi-hroshi/) [secondary] |
| **PrivatBank (Privat24)** | residents | OVDP in UAH/USD/EUR from UAH 1,000; mobile app since 2025-11-20 | none | [unverified] | [privatbank.ua 2025-11-20](https://privatbank.ua/news/2025/11/20/privatbank-zapustiv-kupivlyu-ta-prodazh-ovdp-u-mobilnomu-zastosunku-privat24) [verified via search snippet] |
| **ICU Trade** (Investment Capital Ukraine) | residents | OVDP, deposits, funds; Raiffeisen Bank Aval shares (BAVL) since July 2026 | none public | [unverified] | [App Store](https://apps.apple.com/ua/app/icu-trade/id1494280961?l=uk) [secondary for BAVL] |
| **UNIVER** (Univer Capital) | residents | OVDP (UAH 1 fee per trade), shares, funds, corporate bonds, land funds | none public | [unverified] | [investor24 review](https://investor24.com.ua/brokers/univer/) [secondary] |
| **Dragon Capital** | residents | brokerage/asset management; co-owner of UX with Univer since 2016 | none public | [unverified] | [Wikipedia](https://en.wikipedia.org/wiki/Dragon_Capital_(firm)) [secondary] |
| **Freedom Finance Ukraine** (ffin.ua) | — | **closed to new clients**; sanctioned early in the war; ~12,700 clients' assets frozen | — | — | [investor24](https://investor24.com.ua/brokers/freedom-finance/) [secondary] |
| **Freedom24** (Freedom Finance Europe, CySEC) | UA residents and abroad | 15 exchanges incl. Nasdaq, LSE; Ukrainian UI | **yes**: Tradernet API, user-generated public+private key pair | broker reports (format [unverified]) | [freedom24.com/tradernet-api](https://freedom24.com/tradernet-api) [verified exists], [investor24](https://investor24.com.ua/kupiti-aktsii-v-ukraini/) |
| **Interactive Brokers** | UA residents and abroad | 150+ exchanges | **Flex Web Service**: token (6 h – 1 y) + pre-built Flex Query; data updated once per day | Flex Query CSV/XML; activity statements | [IBKR Flex docs](https://www.interactivebrokers.com/docs/web-api/flex-web-service/introduction), [token](https://www.interactivebrokers.com/docs/web-api/flex-web-service/client-portal-configuration/enable-and-create-access-token) [verified] |
| **Trading 212** | mostly UA people abroad (EU/UK) | shares, ETFs, fractional | **Public API (beta)**: key + secret, HTTP Basic; can be scoped **read-only**; optional IP allow-list; Invest and ISA accounts only | CSV export via app and API history endpoints | [T212 API key help](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key), [docs.trading212.com](https://docs.trading212.com/api/section/general-information) [verified] |
| **Revolut** | UA people abroad | shares, ETFs | no retail trading API | account statement and P&L statement; sources disagree on CSV vs PDF only [unverified] | [Revolut help](https://help.revolut.com/help/wealth/stocks/getting-started-with-trading/managing-your-trading-account/trading-statements/accessing-my-trading-statements-and-reports/) |

**Ukrainian exchanges:**
- **UX (Ukrainian Exchange):** licence revoked June 2024 by the NSSMC because a significant owner had a sanctioned person among its owners. [Wikipedia](https://en.wikipedia.org/wiki/Ukrainian_Exchange) [secondary]
- **PFTS:** the OVDP secondary market price forms on PFTS. The public OVDP page has no CSV or API. [pfts.ua](https://pfts.ua/trade-info/torgi-ovdp) [verified]
- Ukrainian share trading was stopped by the NSSMC on 2022-02-24. As of 2026 about 11 Ukrainian company shares plus 1 ETF are reachable, 10 of them on foreign exchanges and BAVL on PFTS. [investor24](https://investor24.com.ua/aktsii-ukrainskyh-kompaniy/) [secondary]
- A review states that Ukrainian banks give individuals no direct access to foreign exchanges; residents use Freedom24 or IBKR, funded through payment services (TransferGo, Zen, and others) because direct SWIFT transfers are restricted. [investor24](https://investor24.com.ua/kupiti-aktsii-v-ukraini/) [secondary]

### A.2 NBU currency control (residents inside Ukraine)

- From **2026-08-11** the monthly limit for households to buy non-cash foreign currency rose from UAH 50,000 to **UAH 200,000 per calendar month**. The same limit now also covers **non-cash bank metals and securities of foreign issuers**. [finance.ua 2026-08-12](https://news.finance.ua/ua/novi-limity-na-kupivlyu-valyuty-shho-dozvolyv-nbu) [secondary]; NBU press release [bank.gov.ua](https://bank.gov.ua/en/news/all/nbu-vprovadjuye-paket-pomyakshennya-valyutnih-obmejen-z-osnovnim-fokusom-na-pidtrimtsi-naselennya) (HTTP 403 to automated fetch — content [unverified] by me).
- The "e-limit" for individuals to transfer foreign currency abroad is up to **EUR 200,000 equivalent per calendar year**. [MTB Bank e-limits page](https://mtb.ua/en/E-limits) (via search snippet) [secondary]
- **Relevance to Kiko:** these limits constrain how residents BUY; they do not change how Kiko VALUES a holding. Kiko should not attempt to track or enforce limits. Displaced users abroad are not subject to these limits for money held abroad [unverified — legal question, out of scope].

### A.3 Data import options

| Option | Effort | Coverage | Risk |
|---|---|---|---|
| **Manual entry** (ticker, quantity, price, cost) | low | 100 % of routes | user must update the price |
| **OVDP prefill by ISIN** from NBU `depo_securities` | low | all OVDP (Diia, Mono, Privat, ICU, Univer) | none new: `bank.gov.ua` is already contacted, keyless |
| **CSV import** via the existing `src/statement-import/` registry: IBKR Flex CSV, Trading 212 CSV | medium | IBKR, T212 | per-broker format drift; positions vs trades mapping |
| **Broker API sync**: T212 read-only key, IBKR Flex token, Freedom24 key pair | high | 3 brokers | each is a new credential-bearing host → must be SPKI-pinned (`npm run check:plist`); third-party trademark wording; keys in Keychain |
| **PDF parsing** (Revolut) | high | Revolut | fragile; not recommended |

**NBU OVDP register — tested live on 2026-09-23 [verified]:** `GET https://bank.gov.ua/depo_securities?json` returned 196 records. Fields: `cpcode` (ISIN), `nominal`, `auk_proc` (coupon %), `pgs_date` (maturity), `razm_date` (issue date), `val_code` (currency), `pay_period` (days between coupons), `emit_name`, and `payments[]` with `pay_date`, `pay_type`, `pay_val` per bond. This maps directly onto `BondMeta` (faceValue, couponPct, maturityDate, couponFrequency). The feed has no market price.

### A.4 Valuation method

- **Share/ETF value** = `quantity × price`, in the price currency. Then convert to the base currency through the existing rate table.
  - Quantity must allow fractions (T212 and Revolut sell fractional shares). Store it as a decimal string or scaled integer in metadata, never a float (kiko-domain Money rule).
  - Quote currency must be in `currencyOptions`. LSE quotes many shares in **GBX (pence)**, not GBP. The model needs a `priceScale` or a GBX→GBP ÷100 rule [design note].
- **Cost basis vs market value:** store `costBasisMinorUnits` (total paid, fees included) next to the price. Unrealized gain = market value − cost basis. Show both; net worth uses market value. This matches how the `bond` type already keeps `purchasePriceMinorUnits`.
- **Bonds (OVDP):** keep the current rule (valued at cost paid, coupons as ledger events). Options for later:
  - accrued coupon (clean vs dirty price): accrued = coupon × days since last coupon / days in period. The NBU `payments[]` schedule gives the exact dates.
  - market value: no free PFTS price feed exists (see A.1), so market value stays manual.
- **Dividends:** record as an income transaction on a cash holding, like bond coupons today. No automatic dividend data without a paid source.
- **Precious metals:** value = troy ounces × NBU rate. **[verified live]** `GET https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json` returned `XAU` 193295.79, `XAG` 2919.24, `XPT` 79652.08, `XPD` 57079.09 UAH per troy ounce (exchangedate 24.09.2026). XAU/XAG are ISO 4217 codes, so they fit `currencyOptions` and the UAH-pivot rate pipeline without a new table. Grams need a conversion (1 troy oz = 31.1034768 g).

### A.5 Price sources

| Source | Auth | Free limits | Markets | Allowed in a public app? | iOS-safe? | Source |
|---|---|---|---|---|---|---|
| **Manual price** | none | — | all | yes | yes | — |
| **NBU register** (`bank.gov.ua`) | none | undocumented | OVDP terms only (no price) | yes (public state data) | yes, host already used | tested live |
| **NBU metals** (`bank.gov.ua`) | none | undocumented | XAU XAG XPT XPD | yes | yes, host already used | tested live |
| **Yahoo Finance** (unofficial `query1.finance.yahoo.com`) | none (cookie/crumb) | undocumented, blocks often | global | **no** — official API shut 2017; unofficial use may break the Terms of Service | no (ToS + breakage) | [Tiingo blog](https://www.tiingo.com/blog/yahoo-finance-api/), [yfinance docs](https://ranaroussi.github.io/yfinance/) [secondary] |
| **Stooq** CSV | API key since ~2026-04 (captcha or e-mail request) | daily hit limit | global, incl. WSE, XETRA | [unverified] | no (key) | [pandas-datareader #1012](https://github.com/pydata/pandas-datareader/issues/1012) [secondary] |
| **Finnhub** | API key | 60 calls/min | US real-time; international [unverified] | free tier = personal, non-commercial [secondary] | only with the user's own key | [finnhub.io/pricing](https://finnhub.io/pricing) (page did not render), [apicostcalc](https://apicostcalc.com/finnhub.html) [secondary] |
| **Twelve Data** Basic | API key | 8/min, 800/day | US equities/ETFs, FX, crypto only | "personal, internal, and non-commercial purposes" | only with the user's own key | [twelvedata.com/pricing](https://twelvedata.com/pricing) [verified] |
| **Alpha Vantage** | API key | 25/day, 5/min | global [unverified] | [unverified] | only with the user's own key | [macroption](https://www.macroption.com/alpha-vantage-api-limits/) [secondary] |
| **Broker APIs** (T212, IBKR Flex, Freedom24) | user's own key/token | per broker | the user's own positions incl. prices | yes (user's own data) | yes if pinned + Keychain, like Monobank | A.1 |

**Conclusion on live quotes:** a shipped app key is extractable and breaks the free-tier terms. The two honest paths are (1) the user brings their own key (BYOK, stored in Keychain, host pinned), or (2) a Kiko backend proxy with a paid licence. Kiko has no backend today. So live quotes stay out of the MVP.

### A.6 Risks (App Store and product)

- **Guideline 5.6 (no hidden features):** ship shares only when the full flow is visible and complete. No flag-gated "coming soon" type. See `.claude/skills/kiko-compliance/SKILL.md` and the kiko-architecture rule.
- **ATS / new domains:** the MVP adds none. A broker sync or BYOK quote source adds a host that sends a credential → it must be in `NSPinnedDomains` with 2+ SPKI pins, or `npm run check:plist` fails (`.claude/skills/kiko-compliance/SKILL.md:111-121`).
- **Third-party trademarks:** broker names or logos (Trading 212, IBKR, Freedom24, Diia) must not read as a partnership. Use plain text names in an import picker; no logos without permission (compliance skill "Third-party trademarks").
- **Sanctions exposure:** do not list or deep-link sanctioned brokers (EXANTE, Freedom Finance Ukraine). A curated broker list needs a periodic check.
- **Financial-advice perception:** show values only; no buy/sell suggestions, no "yield" rankings.
- **Stale prices:** a manual price has an age. Show "price as of <date>" on the holding so the net-worth total is honest.
- **Privacy policy:** a new host (BYOK or broker sync) sends data to a third party → update the bilingual privacy policy on `gh-pages`.

---

## 4. Section B — Generic assets

### B.1 Asset categories

| Category | Example | Value method | Live source? |
|---|---|---|---|
| Real estate | flat in Kyiv, house abroad | manual + revaluation | no (Zillow-type feeds are US-only) |
| Vehicle | car | manual + revaluation | no |
| Precious metals | gold bars, coins | quantity × NBU XAU/XAG | **yes**, NBU, keyless |
| Collectibles / valuables | watch, art, jewellery | manual | no |
| Loan given | money lent to a friend | principal (manual), optional repayment ledger | no |
| Private business share | share in an LLC | manual | no |
| Other | anything else | manual | no |

### B.2 How other apps name it

| App | Term for generic non-bank item | Liabilities term | Source |
|---|---|---|---|
| YNAB | tracking account type **"Asset"** (investments, jewellery, car, real estate) | **"Liability"** | [support.ynab.com](https://support.ynab.com/en_us/account-types-an-overview-BkmGM0qCq) |
| Monarch | **Manual account**, entry "Real estate, crypto, and more"; types Vehicles, **Valuables**, Cash, **Other assets** | loans | [help.monarch.com](https://help.monarch.com/hc/en-us/articles/4404739126548-Tracking-your-property-vehicles-and-valuables) |
| Copilot | **Manual accounts**: Real Estate, Cash, Investments, Loans…; tells users to track a car/gold as a manual **Cash** account | Loans | [help.copilot.money](https://help.copilot.money/en/articles/10760871-tracking-your-car-and-other-physical-assets) |
| Kubera | **Assets** sheet (any row, manual) | **Debts** sheet | [help.kubera.com](https://help.kubera.com/article/5-add-assets-kubera) |
| Wealthica | **Other Assets** section, manual book/market value | [unverified] | [secondary, search snippet] |
| Finary | **Other assets** ("Autres actifs") | loans | [help.finary.com](https://help.finary.com/en/articles/10477301-add-a-watch-to-my-portfolio-on-finary) |
| Sharesight | **Custom investments** — manual price entries; buy price = cost base | — | [help.sharesight.com](https://help.sharesight.com/manage-custom-investments/) |
| Snowball | **Custom assets** — manual price history, latest entry = current price | — | [help.snowball-analytics.com](https://help.snowball-analytics.com/custom-assets/) |

Pattern: net-worth apps say **"Asset(s)" / "Other assets"**; investment trackers say **"Custom"**. Two apps (Sharesight, Snowball) keep a **price history** with the latest entry as the current value — the same shape proposed below.

### B.3 Data model sketch (proposal, not a plan)

1. **Account kind** `property` added to `accounts.kind` (TS-only enum, no migration needed per `src/db/schema.ts:7-9`). One "Property" account can group items, or the user makes one account per item.
2. **Holding type** `property` added to `holdings.type`, with `PropertyMeta` in `holding-metadata.ts`:
   - `category`: `real_estate | vehicle | metal | valuable | loan_given | business_share | other`
   - `acquiredDate?`, `costBasisMinorUnits?` (for gain display)
   - for `metal`: holding `currency` = `XAU`/`XAG`, balance = troy ounces (scale 4–6), valued by the rate table.
3. **Value** = `balanceMinorUnits` in the holding currency (the `flat()` path in `holding-value.ts`). No new valuation code for manual items.
4. **Revaluation history:** each revaluation calls `updateWithBalanceDelta`, which writes a `manual` transaction row. `holdingValueAt` then gives value on any past day, and the net-worth history chart works unchanged.
   - **Risk:** revaluation rows must NOT count as income/expense in statistics. They need a marker: a new `transactions.source` value `revaluation` (TS-only enum) or a reserved category, and every statistics query must exclude it. This is the main design decision for B.
5. **Share holding (section A)** — holding type `share` with `ShareMeta`: `ticker`, `isin?`, `exchange?`, `quantity` (decimal string), `priceMinorUnits`, `priceAsOf`, `costBasisMinorUnits`. Value = quantity × price, computed in a new `shareBreakdown` branch of `holdingValueBreakdown`.
6. **Liabilities (later):** a `debt` account kind whose holdings count negative in net worth. This changes the kiko-domain rule "net worth is assets-only" and the breakdown/pie charts (a negative slice). Keep it out of the MVP.

### B.4 Naming recommendation

**Recommendation: English "Property", Ukrainian "Майно".** Subtitle in the add-account picker: en "Real estate, car, gold, valuables, money you lent", uk "Нерухомість, авто, золото, цінності, позики іншим".

| Candidate | en fit | uk fit | Problem |
|---|---|---|---|
| Asset / **Актив** | clear, industry term (YNAB, Kubera) | clear | **collides:** Kiko uk already uses "Актив" for every Holding (`holding: 'Актив'`, `holdingsHeading: 'Активи'`). "Add account → Актив" next to "Додати актив" is confusing |
| Other asset / Інший актив | common (Monarch, Finary, Wealthica) | same collision | a "catch-all" name; weak as an account kind label |
| Manual asset | technical | — | describes the entry method, not the thing; Kiko cash accounts are manual too |
| Valuable / Цінність | good for watches, art | good | excludes a loan given and a business share |
| Possession | rare in finance UI | — | unusual |
| **Property / Майно** | good; covers real estate, cars, goods | **exact legal term:** Civil Code of Ukraine art. 190 — "майном вважаються окрема річ, сукупність речей, а також майнові права та обов'язки" (things AND property rights) | en "property" leans to real estate for some readers → the subtitle fixes it |
| Власність | — | means "ownership", abstract | reads as a legal status, not a list item |

Reasons for "Property / Майно":
1. It does not collide with the existing "Актив = Holding" term in the uk catalogue.
2. The uk legal definition covers every category in B.1, incl. rights (loan given, business share). Source: [Цивільний кодекс, ст. 190](https://protocol.ua/ua/tsivilniy_kodeks_ukraini_stattya_190/) [secondary legal portal].
3. It pairs with a later liabilities kind: en "Debt" / uk "Борг".
4. Ukrainian is the primary language of the users, so the uk fit decides a tie.

Alternative if the user prefers the industry term: rename the uk Holding word first (for example "Позиція"), then use "Asset / Актив" for the new kind. This is a larger change and touches every holding screen.

Translations need the user review before any deploy (standing rule: review new en/uk keys first).

---

## 5. Phased scope proposal

| Phase | Scope | New host? | Size |
|---|---|---|---|
| **MVP-1** | "Property / Майно" account kind + `property` holding; manual value; revaluation as a marked ledger row excluded from statistics; value history chart | no | M |
| **MVP-2** | precious metals: XAU/XAG (and XPT/XPD) added to `currencyOptions`, rates from NBU; grams input | no | S |
| **MVP-3** | OVDP prefill: pick an ISIN from the NBU register → fill `BondMeta` (nominal, coupon, maturity, frequency, currency) | no | S |
| **MVP-4** | manual `share` holding: ticker/ISIN, fractional quantity, manual price with "as of" date, cost basis, unrealized gain | no | M |
| Later-1 | CSV import of positions: IBKR Flex CSV, Trading 212 CSV, through `src/statement-import/` | no | M |
| Later-2 | OVDP accrued coupon (dirty value) from the NBU payment schedule | no | S |
| Later-3 | broker sync (T212 read-only key first; IBKR Flex token) | **yes, pinned** | L |
| Later-4 | live quotes with a user-supplied key (BYOK) | **yes, pinned** | M |
| Later-5 | liabilities ("Debt / Борг"), negative net worth contributions | no | L (domain rule change) |

Each phase ships complete and visible (Guideline 5.6). No phase ships behind a flag.

---

## 6. Open questions for the user

1. **Name:** accept "Property / Майно"? Or rename the uk Holding term and use "Asset / Актив"?
2. **Revaluation marker:** a new `transactions.source = 'revaluation'`, or a reserved category? (Both exclude the rows from statistics.)
3. **Shares without live prices:** is a manual price with an "as of" date acceptable for the first release?
4. **Precious metals:** add XAU/XAG to the global currency list (they then also appear in the base-currency picker), or keep them only in the Property form?
5. **Liabilities:** in scope for this feature line, or a separate project later?
6. **Broker priority** for a later import/sync: IBKR, Trading 212, or Freedom24 first? (IBKR and Freedom24 serve residents; Trading 212 and Revolut mostly serve users abroad.)
7. **BYOK:** is it acceptable UX to ask a user to paste their own quote-API key, like the Monobank token?

---

## 7. Unverified items (follow up before a plan)

- NBU press release text for the 2026-08-11 limits (NBU site returned HTTP 403 to automated fetch; the figure comes from finance.ua and a search snippet of the NBU title).
- Monobank personal API: no securities endpoint (not confirmed in the current docs).
- Revolut trading statement format: CSV vs PDF only (sources disagree).
- Freedom24 report export formats.
- Finnhub free tier terms and international coverage (primary page did not render).
- Stooq key requirement date (from a GitHub issue).
- Whether displaced users abroad are subject to NBU limits for foreign-held money (legal question).
