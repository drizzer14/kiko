# Shares, Property, Metals, and Debts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Property/Майно, Precious metals, Debt/Борг, and Broker/Брокер account kinds, valued through one price-series model, and ship them together in one release (D16).

**Architecture:** A new `price_points` table stores (instrument, day, price) points. Carry-forward lookup uses the `rateTableAt` rule. A priced holding (property item, metal, share) is valued at read time as `quantityAt(day) × priceAt(day)`. Its `lots[]` sit in holding metadata, so no ledger rows are written, the same way bonds work today. A loan is valued as −outstanding. The outstanding amount comes from an annuity/differentiated schedule or from a manual series. Price sources plug into the same table: manual, NBU (metals), EODHD (BYOK), Trading 212 and IBKR (sync). Everything lands on one integration branch.

**Tech Stack:** React Native 0.87 + TypeScript, op-sqlite + Drizzle (`src/db/schema.ts`, `drizzle-kit generate`, custom runner `src/db/run-migrations.ts`), `react-native-keychain`, `fnts`, `ts-pattern`, i18next (`src/i18n/locales/{en,uk}.ts`), `read-excel-file` (already a dependency), Jest + RNTL, Maestro (`.maestro/`). **No new npm dependency** (see open question N3).

**Spec:** `docs/research/shares-and-assets-feasibility.md` (decision log D1–D17 and rejected options are binding). Read the `kiko-domain`, `kiko-architecture`, `kiko-code-style`, `kiko-design-system`, `kiko-translator`, `kiko-compliance`, `kiko-linter`, and `kiko-charts` skills before each task they touch.

**Task count:** 47 tasks (T1–T47). Four of them are gated: T40 (Freedom24 spike), T41 (Freedom24, GO only), T42 (Revolut gate), and T43 (Revolut, GO only). T36 also has a conditional NO-GO: if the IBKR host cannot be confirmed, IBKR sync is dropped and IBKR file import still ships.

---

## New network hosts

| Host | Used by | Credential | Pinned (≥2 CA SPKI) | Task |
|---|---|---|---|---|
| `eodhd.com` | `src/quotes/eodhd/` | `api_token` query param (BYOK) | **yes** | T27 |
| `live.trading212.com` | `src/broker-sync/trading212/` | `Authorization: Basic` (key:secret, read-only scope) | **yes** | T32 |
| IBKR Flex host (`ndcdyn.interactivebrokers.com` **[unverified]**) | `src/broker-sync/ibkr/` | token as query param `t` | **yes** | T36 |
| Tradernet host **[unverified]** | Freedom24 (GO only) | key + signature | **yes** | T41 |
| `bank.gov.ua` (existing host, new paths `statdirectory/exchange?valcode=XAU…`, `depo_securities?json`) | `src/prices/nbu-metals/`, `src/bonds/nbu-register/` | none | no (unchanged, keyless) | T10, T15 |

## Open questions carried from spec §11 (not answered here)

1. **Monobank metals.** Default: `monobank` is NOT on the metal allow-list. The user checks on the device (T47). If Monobank does sell metals, set `sellsMetals: true` on its catalog row as a one-line follow-up.
2. **PUMB importer without a real file.** Default: GO with a synthetic fixture, labelled "not verified on a real file" (T44, per D17/P10).
3. **ProCredit personal `.xls`.** Default: left out. No task, no new dependency.
4. **Manual vs automatic loan-payment linking.** Default: manual linking only (T20–T22). No automatic matching.

The plan also assumes defaults for these spec §12 items: the IBKR Flex host (verified in T36, with a NO-GO path), the Trading 212 and IBKR field names (verified live in T33 and T37), EODHD symbol search on the free tier (T29 and T31 fall back to manual symbol entry), and the BYOK licence reading (see N8).

## New open questions / spec issues found while planning

- **N1. The IBKR Flex token is also a query param (`t`).** Spec §3.3 only calls out EODHD `api_token`. T24 widens `plist.sh` so that both clients are detected.
- **N2. The IBKR `GetStatement` URL is returned by `SendRequest`.** It may point at a different host than the pinned one. T37 fails closed unless the returned host equals the pinned host.
- **N3. IBKR Flex is XML, and no XML dependency exists.** Default: a hand-rolled scanner for self-closing elements and attributes (T37). The alternative is a new dependency, which needs user approval.
- **N4. Spec contradiction, §3.4 vs §7.2.** §3.4 allows `share` under `bank` ("Revolut is a bank"), but §7.2 puts Revolut in the broker catalog, and no bank in the catalog sells shares. Default: `share` only under `broker`.
- **N5. Spec build-order contradiction, P2 vs P3.** The P2 metal allow-list names PUMB, Oschadbank, and Ukrgasbank, but those banks are only added to the catalog in P3. Default: T8 allow-lists `privatbank` only, and T13 sets `sellsMetals` on the new banks.
- **N6. Catalog banks with no statement format.** `BankCatalogEntry.statementFormatId` is required today, and the "Statement import only" caption would be false for Oschadbank, Raiffeisen, and Ukrgasbank. Default: make the field optional and add a "Manual holdings only" caption (T13).
- **N7. Export and import (`src/data-transfer/`).** `DataSnapshot` must list every table, and the credential export lists every Keychain secret. The spec does not mention either. Default: add `pricePoints` and `bondRegister` to the snapshot. Add the EODHD, Trading 212, and IBKR secrets behind the existing "include saved credentials" toggle. Old `.kiko` files without the new keys still restore.
- **N8. EODHD daily limit for paid keys.** Default: read `dailyRateLimit` from EODHD `/api/user` **[VERIFY LIVE]** when the key is saved, and fall back to 20. The legal reading of personal-use terms (spec §12) stays open for the user.
- **N9. Metal history backfill cost.** The verified NBU per-day endpoint costs one call per day. Whether the NBU range endpoint supports `valcode=xau` is unverified. T10 starts with a live probe, and the fallback is capped sampling.
- **N10. Two loan-schedule rules the spec leaves open.** (a) Correction point: outstanding = the correction value minus the scheduled principal due after the correction day. (b) A linked payment maps to the installment whose due date is nearest to the payment's local day, and the interest counted is `min(installment interest, |payment|)`. Both are pinned in T17 and T21 tests.
- **N11. Synced broker positions have no quantity history.** Trading 212 and IBKR sync write one lot dated at the first sync day. Net-worth history before that day does not include the position. IBKR file import of Trades (T39) gives full lots.
- **N12. The kind picker grows to 7 kinds.** A `ChipRow` will overflow. Spec §8 already asks for picker subtitles. T6 converts it to a select sheet.
- **N13. `accounts.bankId` is reused as the broker identity for `kind = 'broker'`.** This avoids a migration. The column comment and the kiko-domain skill are updated in T25.

## Global Constraints

- **One integration branch, one release (D16).** The coordinator creates `feat/assets-debts` from `next` in one Orca worktree. Tasks run in the order below. Independent tracks (T13–T16, T24, T44) may run in their own worktrees and roll into the integration branch.
- **Guideline 5.6.** No `@env` or build flag controls what a user sees. No "coming soon" entry. No demo, seed, or fake data in `src/`. A NO-GO gate leaves the broker as a plain, complete, non-connectable catalog entry (manual holdings only). A catalog field such as `connectable` or `sellsMetals` is always-rendered data, never a visibility gate.
- **Money.** Amounts are stored as integer minor units. Prices, quantities, and purity are stored as scaled decimal **strings** (`"193295.79"`, `"12.5"`, `"0.9999"`). Multiply them only through the T1 BigInt helper, never through `Number` arithmetic on stored values. API JSON numbers are converted once, at the boundary, through `decimalFromJsonNumber`.
- **Writes.** Every write goes through `write()` / `db.transaction()` (`src/db/client.ts`). A sync writes positions, cash, prices, and dividends in one transaction, or writes nothing.
- **Credentials.** Keychain only, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no `accessControl` (the pattern in `src/monobank/token/token.ts` and `src/crypto-sync/binance/binance.credentials.ts`). Never in `.env`, SQLite, metadata, or logs.
- **Pinning.** Every credential host goes in `NSPinnedDomains` in `ios/Kiko/Info.plist` with ≥2 CA SPKI pins, plus a row in the `docs/security/README.md` host table. The base URL comes from `@env` (`.env.example`, the tracked `.env.test`, `src/env.d.ts`).
- **i18n.** Every string is added to `en.ts` and `uk.ts` together (`en.uk.parity.test.ts`). The uk apostrophe is ’ (U+2019). The uk name is "Кіко". **The user reviews every new or changed en/uk key before any deploy that ships it** (T47, step 1).
- **Trademarks.** Broker and provider names are plain text. No logos. No wording that suggests a partnership.
- **Migrations.** They are additive only. Generate with `npx drizzle-kit generate --name <slug>`, then re-check `drizzle/migrations/migrations.js` and run `npx biome check --write` over the generated artifacts. Data-only migrations are hand-authored, have no snapshot, and get a journal entry. Numbers below assume `0034` is next. Use the next free number at implementation time.
- **Skills and docs change in the same task as the code they describe.** A `(scribe)` step inside a task is done by the scribe role, before the task is closed.
- **Checks.** Per task: the scoped `npx jest <paths>` red/green cycle, then `make typecheck` and `make lint`. Per phase: `make gate`. End of the line: `make verify` until green (T47). Then, separately, `KIKO_MUTATION_BASE=next make deep` (T47).
- **Commits.** Commit each task on the integration branch after its checks pass (Conventional Commits).

## Review Focus

1. **Local day vs UTC day key.** A net-worth bucket at Kyiv local midnight must read that local date's price, not the previous UTC day's. `priceAt` maps an instant to `Date.UTC(localY, localM, localD)` before lookup. Test in T3.
2. **A priced holding with no price point yet** (no EODHD key, offline first add). Its value falls back to the cost basis of its lots, never to 0, and the UI shows "No price yet". Tests in T5 and T26.
3. **Quote currency ≠ holding currency** (LSE `GBX`, a broker price in another currency). GBX is divided by 100 and stored as GBP at ingest. Any other mismatch is rejected, never mixed. Tests in T30 and T34.
4. **A loan holding is deleted while payments are linked to it.** Its links are cleared in the same transaction. A dangling `loanHoldingId` counts as normal spending. Tests in T20 and T21.
5. **Selling more than is held.** The lot form rejects a sell delta larger than `quantityAt(sellDay)`, and `quantityAt` never returns a negative value. Tests in T4 and T9.

---

## P1 — Price-series foundation + Property / Майно

### Task T1: Decimal helper (developer)

**Files:** Create `src/currency/decimal/{decimal.ts,decimal.test.ts,index.ts}`.
**Produces:** `normalizeDecimal(input: string): string | null` (trim, comma → dot, strip spaces/NBSP, no exponent, no sign); `addDecimal(a: string, b: string): string` and `subDecimal(a: string, b: string): string` (signed results allowed); `compareDecimal(a: string, b: string): -1 | 0 | 1`; `shiftDecimal(value: string, places: number): string`; `decimalFromJsonNumber(value: number): string | null` (expands the exponent form, rejects non-finite values); `multiplyToMinorUnits(factors: readonly string[], currency: Currency, divideBy?: string): number` (BigInt, round half away from zero, uses `currencyScale`).

- [ ] Write failing tests: `"1 234,56"` → `"1234.56"`; `"abc"` and `"1e5"` → null; `multiplyToMinorUnits(['31.1','0.9999','193295.79'], 'UAH', '31.1034768')` equals the hand-computed minor units; half-up at .005; BTC scale 8; `decimalFromJsonNumber(1e-7)` → `"0.0000001"`; `shiftDecimal('12345', -2)` → `"123.45"`.
- [ ] Run `npx jest src/currency/decimal`. Expect FAIL.
- [ ] Implement it.
- [ ] Run `npx jest src/currency/decimal`. Expect PASS. Then run `make typecheck && make lint`.

### Task T2: `price_points` table, migration, repo, export (developer)

**Files:** Modify `src/db/schema.ts` (new `pricePoints` table: `instrument` text, `day` int (UTC-midnight ms), `price` text, `currency` text enum `currencyOptions`, `source` text enum `['manual','nbu','eodhd','trading212','ibkr']`, unique `(instrument, day)`). Generate `drizzle/migrations/0034_add_price_points.sql`, plus the snapshot, journal, and `migrations.js`. Create `src/db/schema.price-points.test.ts` and `src/prices/price-points-repo/{price-points.repo.ts,.test.ts,index.ts}`. Modify `src/data-transfer/snapshot/{data-snapshot.d.ts,read-snapshot.ts,restore-snapshot.ts}` and their tests.
**Produces:** `PricePointRow`; `pricePointsRepo = { allQuery(), upsertMany(rows), removeInstrument(instrument) }` (chunked upsert like `rate-history.repo.ts`).

- [ ] Failing tests. The migration SQL creates `price_points` and the unique index, and it is registered in the journal and `migrations.js` (pattern: `src/db/schema.change-group.test.ts`). `upsertMany` overwrites price and source on `(instrument, day)`. A snapshot round-trip keeps price points. A snapshot **without** `pricePoints` restores with an empty table (old `.kiko` files).
- [ ] Implement. Run `npx jest src/db src/prices src/data-transfer`, then `make typecheck && make lint`.

### Task T3: PriceBook lookup + hook (developer)

**Files:** Create `src/prices/instrument/instrument.ts`, `src/prices/price-book/price-book.ts`, and `src/prices/use-price-book/use-price-book.ts` (each with a test and `index.ts`).
**Produces:** `shareInstrument(symbol)`, `metalInstrument(metal)`, and `holdingInstrument(holdingId)` (`share:…` / `metal:…` / `holding:…`); `type PriceBook = ReadonlyMap<string, readonly PricePointRow[]>` (sorted by day ascending); `EMPTY_PRICE_BOOK`; `buildPriceBook(rows)`; `dayKeyOf(instant): number` (local calendar date → UTC midnight); `priceAt(book, instrument, instant): PricePointRow | undefined` (binary search: nearest point at or before the day, else the earliest point, as in `earliestRateTable`); `latestPoint(book, instrument)`; `usePriceBook(): PriceBook` (`useLiveQuery(pricePointsRepo.allQuery(), ['price_points'])` + `useMemo`).

- [ ] Failing tests: carry-forward across a gap; the earliest point is used before the first row; an unknown instrument returns `undefined`; **Review Focus 1**: an instant at Kyiv local midnight on 2026-03-30 (DST) resolves to the 2026-03-30 point, not 03-29 (use the `local(...)` helper style from `src/holdings/interest/interest.test.ts`).
- [ ] Implement. Run `npx jest src/prices`, then `make typecheck && make lint`.

### Task T4: Property kind, `property_item` type, lots, ledgerless predicate (developer)

**Files:** Modify `src/db/schema.ts` (`accounts.kind` += `'property'`; `holdings.type` += `'property_item'`; TS-only, no migration), `src/holdings/holding-type/holding-type.ts` (+test), `src/holdings/entity-symbols/entity-symbols.ts`, `src/holdings/entity-colors/entity-colors.ts`, `src/holdings/exchange-destination/exchange-destination.ts` (exhaustive `match` arms: `property_item` is excluded everywhere), `src/screens/statistics/bar-chart/bar-chart.component.tsx` (type label), `src/screens/forms/transaction-form/transaction-form.screen.tsx` (`isTransactionEligibleType` → use the new predicate), and `src/screens/holding-detail/holding-detail.screen.tsx` (`footerActionFor`). Create `src/holdings/lots/{lots.ts,lots.test.ts,index.ts}`. Modify `src/holdings/holding-metadata/holding-metadata.ts` (+test).
**Produces:** `type Lot = { day: number; quantityDelta: string; costMinorUnits: number }`; `quantityAt(lots, instant): string` (never below `"0"`); `costBasisMinorAt(lots, instant): number`; `asLots(value): Lot[] | null`; `type PropertyCategory = 'real_estate'|'vehicle'|'valuable'|'loan_given'|'business_share'|'other'`; `PropertyMeta = { category; lots: Lot[] }`; `asPropertyMeta`; `isLedgerlessHoldingType(type)` (true for `term_deposit`, `bond`, `property_item`; T8, T17, and T25 extend it). `holdingTypesForAccountKind.property = ['property_item']`.

- [ ] Failing tests: `quantityAt` sums the deltas up to the local day; **Review Focus 5**: a sell delta larger than the held quantity clamps to `"0"`, and `asLots` rejects a non-decimal `quantityDelta`; `asPropertyMeta` rejects an unknown category; `creatableHoldingTypesForAccount('property', false)` → `['property_item']`; `isTransactionEligibleType('property_item')` is false; the exchange predicates stay exhaustive.
- [ ] Implement. Run `npx jest src/holdings src/screens/forms/transaction-form src/screens/holding-detail`, then `make typecheck && make lint`.

### Task T5: Priced valuation + thread the PriceBook through every reader (developer, scribe)

**Files:** Create `src/holdings/priced-value/{priced-value.ts,.test.ts,index.ts}`. Modify `src/holdings/holding-value/holding-value.ts` (add a third parameter, `book: PriceBook = EMPTY_PRICE_BOOK`; `ValuableHolding` gains `'id'`), `src/statistics/holding-value-at.ts`, `src/statistics/net-worth-series/net-worth-series.ts`, `src/rates/conversion/conversion.ts`, `src/rates/net-worth-view/net-worth-view.ts`, `src/rates/currency-totals/currency-totals.ts`, `src/statistics/type-breakdown/type-breakdown.ts`, `src/statistics/account-contribution/account-contribution.ts`, `src/holdings/derived-entries/derived-entries.ts`, and the screens `src/screens/home/home.screen.tsx`, `src/screens/accounts/accounts.screen.tsx`, `src/screens/account-detail/account-detail.screen.tsx`, `src/screens/account-detail/holding-card/holding-card.component.tsx`, `src/screens/holding-detail/holding-detail.screen.tsx`, and `src/screens/statistics/statistics.screen.tsx` (each calls `usePriceBook()`), plus their existing tests.
**Consumes:** T1, T3, T4. **Produces:** `pricedHoldingTypes`, `isPricedHoldingType(type)`, `pricedValueMinor(holding, book, instant): number | null` (`null` = no price). `holdingValueBreakdown` for a priced type: `gross = net = value`, `principalOrCost = costBasis`. When the value is `null`, the result uses the cost basis. `holdingValueAt` uses the breakdown for ledgerless types.

- [ ] Failing tests: a property with a 2024 point of 20,000 and a 2026 point of 16,000 is valued at 20,000 between them and at 16,000 after the second point; **Review Focus 2**: no point → value = cost basis (not 0); the net-worth series for a property is flat and has no ledger rows; the existing bond, deposit, and card tests stay green unchanged (the default `EMPTY_PRICE_BOOK`).
- [ ] Implement. Run `npx jest src/holdings src/statistics src/rates src/screens`, then `make typecheck && make lint`.
- [ ] (scribe) `.claude/skills/kiko-domain/SKILL.md`: add a "Price series and priced holdings" section (the `price_points` shape, the local-day key, lots, the "value derived at read, no ledger row" rule). `.claude/skills/kiko-architecture/SKILL.md` "Price data": add `price_points` as the non-currency price store.

### Task T6: Account-kind select sheet with subtitles (designer)

**Files:** Create `src/screens/forms/account-kind-field/` (`.component.tsx`, `.props.d.ts`, `.styles.ts`, `.component.test.tsx`, `index.ts`), built from `BottomSheet` + `SelectableRow` (the `bank-type-field` shape). Modify `src/screens/forms/account-form/account-form.screen.tsx` (replace the kind `ChipRow`), `en.ts`/`uk.ts` (`forms.account.kindSubtitle.{bank,cash,crypto,property}`; property subtitle: en "Real estate, car, valuables, money you lent", uk "Нерухомість, авто, цінності, позики іншим"), and `.claude/skills/kiko-design-system/SKILL.md` (a component-set entry).

- [ ] Failing RNTL test: the sheet lists every `accounts.kind` with its label and subtitle; selecting one reports it; the field is disabled in edit mode and once `accountRowStarted` is true.
- [ ] Implement. Run `npx jest src/screens/forms`, then `make typecheck && make lint`.

### Task T7: Property form section, "Update value", "value as of" (developer)

**Files:** Create `src/screens/forms/holding-form/property-section/` (category chips, acquired date, cost) and `src/screens/forms/price-point-form/price-point-form.screen.tsx` (+test; date, default today, and value; writes a `manual` point on `holdingInstrument(id)`). Modify `holding-form.screen.tsx` (render the section; hide the balance field for `isLedgerlessHoldingType`; a create writes `balanceMinorUnits: 0`, one lot `{day, "1", cost}`, and the first manual point = cost), `src/holdings/repo/holdings.repo.ts` (`remove` also calls `removeInstrument(holdingInstrument(id))` in the same transaction), `holding-detail.screen.tsx` (footer action `'updateValue'`, and a "Value as of <date>" caption from `latestPoint`), `holding-card.component.tsx` (the caption), `src/navigation/types.d.ts` + `src/navigation/accounts.stack.tsx` (`PricePointForm: { holdingId: string }`), and `en.ts`/`uk.ts` (`forms.account.property` "Property"/"Майно", `forms.holding.propertyItem`, the category labels, `forms.pricePoint.*`, `holdingDetail.updateValue`, `holdingDetail.valueAsOf`).

- [ ] Failing tests: creating a property writes one lot + one manual point and no transaction row; "Update value" adds a point for the chosen date and the card re-renders; deleting the holding removes its series; the parity test passes.
- [ ] Implement. Run `npx jest src/screens src/holdings`, then `make typecheck && make lint`.
- [ ] Phase check: `make gate`.

## P2 — Precious metals

### Task T8: Metals kind, `metal` type, bank allow-list (developer, scribe)

**Files:** Modify `src/db/schema.ts` (kind += `'metals'`, type += `'metal'`), `holding-type.ts` (`metals: ['metal']`, `bank` += `'metal'`; `creatableHoldingTypesForAccount(kind, isSynced, bankId?)` drops `metal` under `bank` unless `bankSellsMetals(bankId)`), `holding-metadata.ts` (`MetalMeta = { metal: 'XAU'|'XAG'|'XPT'|'XPD'; form: 'bar'|'coin'|'bank_account'; unit: 'g'|'oz'; purity: string; lots: Lot[] }`, `asMetalMeta`), `priced-value.ts` (metal value = `multiplyToMinorUnits([qty, purity, price], 'UAH', unit === 'g' ? '31.1034768' : undefined)`, instrument `metalInstrument(metal)`), `src/bank-sync/bank-catalog/bank-catalog.ts` (+test: `sellsMetals: boolean`, with `privatbank: true` and the rest false; `bankSellsMetals(bankId)`), the entity symbol and color maps, the exchange-destination arms, and every caller of `creatableHoldingTypesForAccount` (pass `account.bankId`).

- [ ] Failing tests: 31.1034768 g at purity 1 = 1 oz × price; a bank account with `bankId: 'monobank'` cannot create `metal` but `privatbank` can; `metals` offers only `metal`; the metal currency is fixed to UAH (the NBU quote currency).
- [ ] Implement. Run `npx jest src/holdings src/bank-sync`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain: metals kind, the allow-list as data (not a visibility gate), and the troy-ounce rule.

### Task T9: Lot form (buy/sell) (developer)

**Files:** Create `src/screens/forms/lot-form/lot-form.screen.tsx` (+test; date, a buy/sell `OptionPills`, quantity, total cost; writes metadata lots through `holdingsRepo.update`, which is a metadata-only writer). Modify the navigation types and stack (`LotForm: { holdingId: string }`), holding-detail (footer action `'addLot'` for `metal`/`share`, and a lot list), and `en.ts`/`uk.ts` (`forms.lot.*`).

- [ ] Failing tests: a buy appends a positive delta; **Review Focus 5**: a sell larger than `quantityAt(day)` shows `forms.lot.sellExceedsError` and writes nothing; no transaction row is written.
- [ ] Implement. Run `npx jest src/screens/forms/lot-form src/screens/holding-detail`, then `make typecheck && make lint`.

### Task T10: NBU metal prices, current + history (developer)

**Files:** Create `src/prices/nbu-metals/{nbu-metals.ts,.test.ts,index.ts}` and `src/prices/metal-refresh/{metal-refresh.ts,.test.ts,index.ts}`. Modify `src/sync/use-auto-sync/use-auto-sync.ts` and `src/sync/use-sync-all/use-sync-all.ts` (call `refreshMetalPrices` next to `refreshRates`; failures are swallowed in the same way), and `docs/security/README.md` (the `bank.gov.ua` row: add `src/prices/nbu-metals`).
**Produces:** `fetchNbuMetalsCurrent(fetchImpl)` (reuses `statdirectory/exchange?json`, keeps `XAU|XAG|XPT|XPD`, `rate` → `decimalFromJsonNumber`); `fetchNbuMetalHistory(metal, start, end, fetchImpl)`; `refreshMetalPrices({ now, fetchImpl })` (only metals held in open holdings; at most once per local day per metal; backfill from the earliest lot day on first sight).

- [ ] Step 1, live probe (developer, record the result in the test file header): `GET https://bank.gov.ua/NBU_Exchange/exchange_site?start=20250101&end=20250110&valcode=xau&json`. If it returns XAU rows, history uses one range call per metal. Otherwise, history samples the verified per-day endpoint (`exchange?valcode=XAU&date=YYYYMMDD&json`) weekly, capped at 60 calls per metal per backfill, with carry-forward between samples.
- [ ] Failing tests with recorded JSON fixtures: current rows map to `metal:XAU` points in UAH; a non-ok response throws and writes nothing; a second refresh on the same local day makes no fetch; the backfill starts at the first lot day.
- [ ] Implement. Run `npx jest src/prices src/sync`, then `make typecheck && make lint`.

### Task T11: Metal form section (developer)

**Files:** Create `src/screens/forms/holding-form/metal-section/` (metal chips, form chips, unit chips, purity default `"0.9999"`, first lot). Modify `holding-form.screen.tsx`, `holding-detail.screen.tsx` ("Price as of <date>" via `latestPoint(metalInstrument)`), and `en.ts`/`uk.ts` (`forms.account.metals` "Precious metals"/"Дорогоцінні метали", `forms.account.kindSubtitle.metals`, `forms.holding.metal*`, the metal names).

- [ ] Failing tests: a create under the metals kind writes a `MetalMeta` with one lot and no transaction; under an allow-listed bank the type chip shows `metal`; the value renders once a `metal:XAU` point exists.
- [ ] Implement. Run `npx jest src/screens/forms/holding-form`, then `make typecheck && make lint`.

### Task T12: Metals reach net worth end-to-end (developer)

**Files:** Modify `src/statistics/net-worth-series/net-worth-series.test.ts` and `src/rates/net-worth-view/net-worth-view.test.ts` (tests only, unless one fails).

- [ ] Failing or pinning tests: a gold bar's series follows the NBU points across days; a metal holding whose history lacks points before its first lot contributes 0 before the lot day.
- [ ] Run `npx jest src/statistics src/rates`. Phase check: `make gate`.

## P3 — Bank catalog additions + Bond ISIN mode

### Task T13: PUMB, Oschadbank, Raiffeisen, Ukrgasbank (developer, scribe)

**Files:** Modify `bank-catalog.ts` (+test: `bankIds` += `pumb`, `oschadbank`, `raiffeisen`, `ukrgasbank`; `statementFormatId?` becomes optional; `sellsMetals` true for pumb, oschadbank, and ukrgasbank, false for raiffeisen; `connectable: false`), `src/screens/forms/bank-type-field/bank-type-field.component.tsx` (a third caption, `forms.account.bankManualOnly`, when there is no format), the `account-detail.screen.tsx` import affordance (only when `statementFormatIdForBank(bankId)` is defined), and `en.ts`/`uk.ts`.

- [ ] Failing tests: the 4 new banks render in the picker; Oschadbank shows the "Manual holdings only" caption and no import action; `isConnectableBank('oschadbank')` is false; PUMB, Oschadbank, and Ukrgasbank can create `metal`.
- [ ] Implement. Run `npx jest src/bank-sync src/screens`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain `bankId` paragraph: the bank set is no longer "6 banks, 5 import-only". Point readers at the catalog file.

### Task T14: ISIN validation (developer)

**Files:** Create `src/bonds/isin/{isin.ts,isin.test.ts,index.ts}`.
**Produces:** `normalizeIsin(raw): string` (trim, strip spaces, uppercase); `validateIsin(raw): { ok: true; isin: string } | { ok: false; reason: 'format' | 'checkDigit' }` (`^[A-Z]{2}[A-Z0-9]{9}[0-9]$`, ISO 6166: letters → numbers, Luhn mod 10).

- [ ] Failing tests: `' ua4000227045 '` → valid (use 3 real ISINs from the NBU register, both `UA…` and `XS…`); one changed digit → `checkDigit`; 11 chars → `format`.
- [ ] Implement. Run `npx jest src/bonds/isin`, then `make typecheck && make lint`.

### Task T15: NBU register client + `bond_register` cache (developer)

**Files:** Modify `src/db/schema.ts` (`bondRegister`: `isin` text PK, `terms` json, `fetchedAt` int). Generate `drizzle/migrations/0035_add_bond_register.sql` and create `src/db/schema.bond-register.test.ts`. Create `src/bonds/nbu-register/{nbu-register.ts,.test.ts,index.ts,__fixtures__/depo-securities-sample.json}` (3 records trimmed from the live payload) and `src/bonds/bond-register-repo/{bond-register.repo.ts,.test.ts,index.ts}`. Modify the data-transfer snapshot files (+tests).
**Produces:** `type BondTerms = { isin; currency: Currency; faceValueMinorUnits: number; couponPct: number; maturityDate: number; couponFrequency: BondCouponFrequency | null; name: string }`; `couponFrequencyFromPayPeriod(days): BondCouponFrequency | null` (±5 days around 30, 91, 182, and 364); `fetchNbuRegister(fetchImpl): Promise<BondTerms[]>`; `bondRegisterRepo = { findByIsinQuery(isin), fetchedAtQuery(), replaceAll(terms, fetchedAt) }`; `refreshBondRegisterIfStale({ now, fetchImpl })` (at most once per local day).

- [ ] Failing tests: `pay_period` 182 → semiannually, 200 → null; the `OZDP` nominal of 1 → 100 minor units; `replaceAll` is one transaction; a stale check skips the fetch on the same day; a snapshot without `bondRegister` restores.
- [ ] Implement. Run `npx jest src/bonds src/db src/data-transfer`, then `make typecheck && make lint`.

### Task T16: Bond form ISIN / Manual mode + Diia hint (developer)

**Files:** Modify `holding-metadata.ts` (`BondMeta.isin?: string`; round-trip test). Create `src/screens/forms/holding-form/bond-isin-section/` (ISIN field, quantity, purchase date (default today), purchase price (default nominal), read-only terms summary, not-found state with a "Switch to Manual" button). Modify `holding-form.screen.tsx` (an "ISIN / Manual" `ChipRow` in the bond section; create defaults to ISIN mode; edit opens in Manual with the ISIN shown and editable; the form opening calls `refreshBondRegisterIfStale`), and `en.ts`/`uk.ts` (`forms.holding.isin*`, `isinCheckDigitError` "ISIN check digit is wrong", `isinNotInRegister` "Not in the NBU register", `switchToManual`, `diiaHint` "Bought in Diia? Add the bond under the bank or broker you chose there.").

- [ ] Failing tests: a found ISIN fills face value, coupon, maturity, frequency, `bondKind: 'government'`, currency, and name, and a save stores the full `BondMeta` with the `isin`; not found → the message and the button, and "Switch to Manual" keeps the ISIN; offline with no cache → the same path; the check-digit error blocks save; the Diia hint renders in both modes.
- [ ] Implement. Run `npx jest src/screens/forms/holding-form`, then `make typecheck && make lint`. Phase check: `make gate`.

## P4 — Debts / Борг, net-worth rule, interest-only spending

### Task T17: Debt kind, `loan` type, schedule math (developer)

**Files:** Modify `src/db/schema.ts` (kind += `'debt'`, type += `'loan'`), `holding-type.ts` (`debt: ['loan']`; `isLedgerlessHoldingType` += `loan`), the symbol, color, and exchange maps, and `holding-metadata.ts` (`LoanMeta = { kind: 'mortgage'|'car_loan'|'consumer_loan'|'personal'; principalMinorUnits: number; startDate: number; annualRatePct?: number; termMonths?: number; schedule: 'annuity'|'differentiated'|'none' }`, `asLoanMeta`). Create `src/holdings/loan-schedule/{loan-schedule.ts,.test.ts,index.ts}`.
**Produces:** `type LoanInstallment = { dueDate: number; paymentMinor: number; interestMinor: number; principalMinor: number; outstandingAfterMinor: number }`; `loanInstallments(meta): LoanInstallment[]` (monthly, using `addMonths` and local-midnight days, the last installment absorbs rounding); `loanOutstandingMinorAt(meta, holdingId, book, instant): number` (N10a rule; `none` → `priceAt(holdingInstrument(id))`; clamped at ≥ 0); `loanInterestForPaymentMinor(meta, paymentTime, paymentAbsMinor): number` (N10b rule; `none` → 0).

- [ ] Failing tests: an annuity of 1,200,000.00 UAH at 12% for 240 months matches a known amortization table (first and last rows); a differentiated loan has a constant principal; the outstanding amount after the final installment is 0; a correction point of 900,000 on day X gives 900,000 minus the principal due after X; an informal loan reads the manual series; an overpaid correction clamps to 0; interest for a payment 3 days after due date k equals installment k's interest, and is capped by `|payment|`.
- [ ] Implement. Run `npx jest src/holdings`, then `make typecheck && make lint`.

### Task T18: Loan valuation + net-worth rule change (developer, designer, scribe)

**Files:** Modify `holding-value.ts` (`loan` branch: `gross = net = −outstanding`, `principalOrCost = −principal`), `holding-value-at.ts`, `type-breakdown.ts` (exclude `loan`), `account-contribution.ts` (debt accounts already drop at ≤ 0; add `buildDebtTotal({ holdings, rateTable, baseCurrency, now, book }): Money`), `statistics.screen.tsx` (a "Debts" total line under the account pie), `home.screen.tsx` (the headline may be negative; the breakdown is unchanged), and `src/screens/accounts/accounts.screen.tsx` (designer: a "Debts" section grouping `kind === 'debt'` accounts, its total shown negative; drag reorder stays within a section). Update `en.ts`/`uk.ts` (`forms.account.debt` "Debt"/"Борг", its subtitle, `statistics.debtsTotal`, `accounts.debtsSection`).

- [ ] Failing tests: net worth = assets − outstanding (Home headline and series); a negative total renders with a minus sign through `MoneyText`; the pie never receives a negative slice; the type bar has no `loan` bar; the accounts screen renders the Debts section with a negative total.
- [ ] Implement. Run `npx jest src/holdings src/statistics src/rates src/screens`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain "Net worth": replace "assets-only" with "Σ assets − Σ debt outstanding in base currency; credit-card negative balances count as debt; the pie shows assets only, with debts as a separate total". kiko-charts: the account pie excludes debts, and the net-worth line may cross 0.

### Task T19: Loan form section + outstanding corrections (developer)

**Files:** Create `src/screens/forms/holding-form/loan-section/` (kind chips, principal, start date, optional rate, optional term, schedule chips; rate and term are required unless the schedule is `none`). Modify `holding-form.screen.tsx` (a `none` create also writes the first manual point = principal at the start date), holding-detail (`'updateValue'` for loans, labelled "Update outstanding"; an annuity/differentiated loan shows the next installment's interest/principal split), and `en.ts`/`uk.ts` (`forms.holding.loan*`).

- [ ] Failing tests: validation per schedule; a `none` loan creates its first point; the correction point form writes to `holdingInstrument(id)`; the detail screen shows the outstanding amount as negative.
- [ ] Implement. Run `npx jest src/screens`, then `make typecheck && make lint`.

### Task T20: Loan-payment link column + repo (developer)

**Files:** Modify `src/db/schema.ts` (`transactions.loanHoldingId` text, nullable, with a comment in the `exchangeCounterpartHoldingId` style). Generate `drizzle/migrations/0036_add_loan_holding_id.sql` and create `src/db/schema.loan-link.test.ts`. Modify `src/transactions/repo/transactions.repo.ts` (+test: `setLoanPayment({ transactionId, loanHoldingId: string | null })`, allowed on synced rows because it is a user-owned column like `category`), and `holdings.repo.ts` `remove` (clear links that point at the deleted loan, in the same transaction).

- [ ] Failing tests: the column migration is registered; `setLoanPayment` on a `monobank` row persists; **`addManyDedup` re-sync of the same `externalId` keeps `loanHoldingId`**; **Review Focus 4**: deleting the loan clears its links.
- [ ] Implement. Run `npx jest src/db src/transactions src/holdings`, then `make typecheck && make lint`.

### Task T21: Interest-only spending (developer, scribe)

**Files:** Create `src/statistics/loan-payments/{loan-payments.ts,.test.ts,index.ts}`. Create the hand-authored data-only migration `drizzle/migrations/0037_seed_loan_interest_category.sql` (`INSERT OR IGNORE` of the `loan_interest` key, title "Loan interest", an icon, and an `entityColors` color) with a journal entry. Modify `src/db/__fixtures__/seeded-categories.ts`, `en.ts`/`uk.ts` (`categories.loan_interest` "Loan interest"/"Відсотки за кредитом"), and `statistics.screen.tsx` (union the exclusion set into `excludedTransactionIds`; append the interest entries to the transaction list fed to **both** `buildCategoryBreakdown` and the category trend).
**Produces:** `loanPaymentExcludedTxIds(transactions): Set<string>` (only links whose loan holding exists); `loanInterestEntries({ transactions, loanHoldings }): BreakdownTransaction[]` (id `loan-interest:<txId>`, category `loan_interest`, amount `−interest`, loan currency, payment time).

- [ ] Failing tests: a linked −12,000 payment whose installment interest is 9,000 → the spending pie shows 9,000 under "Loan interest" and nothing from the raw row; an informal loan payment counts 0; an unlinked payment counts in full; **Review Focus 4**: a link to a missing loan counts as normal spending; the trend chart includes the interest.
- [ ] Implement. Run `npx jest src/statistics src/db src/screens/statistics`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain "Spending-exclusion pipeline": add the loan-payment marker and the derived interest entries.

### Task T22: Loan-payment field on the transaction form (developer)

**Files:** Create `src/screens/forms/loan-payment-field/` (a `HoldingSelectField` limited to open `loan` holdings, plus a "None" option; saves immediately through `setLoanPayment`). Modify `transaction-form.screen.tsx` (render it for an existing debit row, manual or synced, next to the category field) and `en.ts`/`uk.ts` (`forms.transaction.loanPayment`, `forms.transaction.loanPaymentNone`, and `syncedNotice` → "This was synced, so only the category and loan link can be changed.").

- [ ] Failing tests: the field shows only on debits; picking a loan persists; "None" clears; the field is hidden when no loan holding exists (data-driven, not a flag).
- [ ] Implement. Run `npx jest src/screens/forms`, then `make typecheck && make lint`. Phase check: `make gate`.

### Task T23: Maestro flows for P1–P4 (qa)

**Files:** Create `.maestro/property-metals-debts.yaml`.

- [ ] A functional flow: add a Property account and item, then update its value; add a Metals account with a gold bar; add a Debt account with an annuity loan; assert that the Home headline changes and that the Accounts screen shows the Debts section. No network assertions.
- [ ] Run `maestro test .maestro/property-metals-debts.yaml` on a Debug simulator build (the coordinator's persistent Metro).

## P5 — Broker / Брокер, shares, EODHD BYOK

### Task T24: Widen `plist.sh` credential detection (developer, scribe)

**Files:** Modify `scripts/checks/plist.sh`. The client-file grep adds `\bapi_token\b` and the marker `CREDENTIAL_QUERY_PARAM`: a query-param credential client must declare `const CREDENTIAL_QUERY_PARAM = '<name>';`. Create `__tests__/plist-credential-detect.test.ts`: it copies `plist.sh` + `_lib.sh` into a temp root with a stub `ios/Kiko/Info.plist`, `ios/Kiko.xcodeproj/project.pbxproj` (containing the Debug-ATS phase name), `.env`, and `src/` clients, and runs the script (the harness style of `__tests__/mutation-lock.test.ts`). Modify `docs/harness/review-to-biome-inventory.md` (a new row), `.claude/skills/kiko-linter/SKILL.md` "Plist assertions", and `.claude/skills/kiko-compliance/SKILL.md` "ATS" (query-param credentials).

- [ ] Failing tests: a temp `src/x.client.ts` with `api_token` and an unpinned `@env` host → exit 2 with the host named; the same file with the host pinned twice → exit 0; a client with `CREDENTIAL_QUERY_PARAM = 't'` → detected; a file with no credential marker → ignored; the real repo still passes (`make plist`).
- [ ] Implement. Run `npx jest __tests__/plist-credential-detect.test.ts && make plist`, then `make lint`.

### Task T25: Broker kind, broker catalog, `share` type (developer, scribe)

**Files:** Modify `src/db/schema.ts` (kind += `'broker'`, type += `'share'`; update the `bankId` column comment per N13), `holding-type.ts` (`broker: ['share','bond','cash']`; `isLedgerlessHoldingType` += `share`), the symbol, color, and exchange maps, and `holding-metadata.ts` (`ShareMeta = { symbol: string; isin?: string; exchange: string; name: string; lots: Lot[]; quoteSource: 'eodhd'|'broker'|'manual' }`, `asShareMeta`). Create `src/broker-sync/broker-catalog/{broker-catalog.ts,.test.ts,index.ts}` (`brokerIds = ['trading212','ibkr','freedom24','revolut','icu','univer','dragon','other']`, `brokerCatalog: { id; displayName; connectable: boolean }[]` with every entry `connectable: false` for now) and `src/screens/forms/broker-type-field/` (the `bank-type-field` shape; "Other broker" relies on the account name). Modify `account-form.screen.tsx` (a broker kind branch stores `bankId = brokerId`), `priced-value.ts` (share value = qty × `priceAt(shareInstrument(symbol))`, in the holding currency), and `en.ts`/`uk.ts` (`forms.account.broker` "Broker"/"Брокер", its subtitle, `forms.account.brokerType`, `forms.holding.share`). EXANTE and Freedom Finance Ukraine are never listed.

- [ ] Failing tests: the broker kind offers share, bond, and cash; the catalog renders all 8 plain-text names; the broker account saves its `bankId`; a share with lots and a price is valued; `isBankId('trading212')` stays false (a bank account never looks like a broker).
- [ ] Implement. Run `npx jest src/broker-sync src/holdings src/screens/forms`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain: the broker kind (re-added; the old "`broker` was dropped" note becomes history), `bankId` as the catalog identity per kind, and share lots.

### Task T26: Share form section, manual price mode, gain display (developer)

**Files:** Create `src/screens/forms/holding-form/share-section/` (symbol, exchange, name, optional ISIN (T14 validation), quote-source chips `EODHD / Manual`, first lot). Modify holding-detail (market value, cost basis, unrealized gain = value − cost, "Price as of"; footer `'addLot'`, plus `'updateValue'` when `quoteSource === 'manual'`, writing to `shareInstrument(symbol)`) and `en.ts`/`uk.ts` (`forms.holding.share*`, `holdingDetail.costBasis`, `unrealizedGain`, `priceAsOf`, `noPriceYet`).

- [ ] Failing tests: a manual-quote share gets its value from a manual point; **Review Focus 2**: an EODHD share with no point shows "No price yet" and the value = cost basis; the gain sign colors through `MoneyText`; there is no financial-advice wording (values, gains, and dates only).
- [ ] Implement. Run `npx jest src/screens`, then `make typecheck && make lint`.

### Task T27: EODHD pins, env, security doc (ops, developer)

**Files:** Modify `ios/Kiko/Info.plist` (`NSPinnedDomains` → `eodhd.com` with root + intermediate `NSPinnedCAIdentities`), `.env.example` and `.env.test` (`EODHD_API_ENDPOINT=https://eodhd.com/api`), `src/env.d.ts`, and `docs/security/README.md` (a host-table row plus a "Current chains" block with the capture date, and the rotation loop host list).

- [ ] (ops) Capture the chain with the `openssl s_client … -showcerts` recipe in `docs/security/README.md`. Report the SPKI-SHA256 of the root and the intermediate.
- [ ] (developer) Add the pins, the env key, and the doc row. Run `make plist` and `npx jest __tests__`.

### Task T28: EODHD key in Keychain + settings screen (developer)

**Files:** Create `src/quotes/eodhd-token/{eodhd-token.ts,.test.ts,index.ts}` (service `kiko.eodhd.token`, the `hardenedFor` shape) and `src/screens/settings/share-prices/share-prices.screen.tsx` (+test; paste the key, then "Check key", which calls `fetchUserLimits`; show the daily limit; remove the key; a plain link to the EODHD sign-up page as a plain-text URL from `@env` `EODHD_SIGNUP_URL`, with no logo). Modify `src/screens/settings/settings/settings.screen.tsx` (a "Share prices" row), the navigation (settings stack), `src/data-transfer/secrets/{read-secrets.ts,restore-secrets.ts}` + `payload.d.ts` (`eodhdToken?: string`), and `en.ts`/`uk.ts` (`settings.sharePrices.*`: explain BYOK in plain words; the user accepts the provider's own terms).

- [ ] Failing tests: save/read/clear round-trip with the hardening options asserted; a bad key (401) shows an error and stores nothing; the export includes the key only with the credentials toggle on; restore writes it back.
- [ ] Implement. Run `npx jest src/quotes src/screens/settings src/data-transfer`, then `make typecheck && make lint`.

### Task T29: EODHD client (developer)

**Files:** Create `src/quotes/eodhd/{eodhd.client.ts,.test.ts,index.ts,__fixtures__/*.json}`. It imports `EODHD_API_ENDPOINT` from `@env` and declares `const CREDENTIAL_QUERY_PARAM = 'api_token';`.
**Produces:** `fetchEod(symbol, fromDay, toDay, token, fetchImpl): Promise<{ day: number; close: string }[]>`; `searchSymbols(query, token, fetchImpl): Promise<{ code; exchange; name; currency; isin? }[]>`; `fetchUserLimits(token, fetchImpl): Promise<{ dailyRateLimit: number }>`; errors `EodhdAuthError` (401/403), `EodhdQuotaError` (402/429), and `EodhdUnavailableError` (for example, search is not on the plan).

- [ ] Step 1 **[VERIFY LIVE]** (developer, with the user's key or the public `demo` token): confirm the paths `/eod/{SYMBOL}?fmt=json&from&to`, `/search/{q}?fmt=json`, `/user?fmt=json` and their field names. Save anonymized fixtures.
- [ ] Failing tests: closes map through `decimalFromJsonNumber`; each error class maps from its status; the token never appears in a thrown message (assert on `error.message`).
- [ ] Implement. Run `npx jest src/quotes/eodhd && make plist` (the widened detection must see this file as credential-bearing and pinned).

### Task T30: Quota guard + share price refresh (developer)

**Files:** Modify `src/db/schema.ts` (`settings.quoteQuota` json `QuoteQuota = { day: number; calls: number; dailyLimit: number; attempted: string[] }`, nullable). Generate `drizzle/migrations/0038_add_quote_quota.sql`. Modify `src/db/settings-columns.test.ts` if needed and `src/settings/settings.repo.ts` (+test: `getQuoteQuota`, `setQuoteQuota`). Create `src/quotes/quota/{quota.ts,.test.ts,index.ts}` (pure: `canSpend(state, now)`, `spend(state, instrument, now)`, a reset on a new UTC day, a default limit of 20) and `src/quotes/share-refresh/{share-refresh.ts,.test.ts,index.ts}`. Modify `use-auto-sync.ts` and `use-sync-all.ts` (call `refreshSharePrices`).
**Produces:** `refreshSharePrices({ now, fetchImpl }): Promise<{ status: 'ok' | 'noKey' | 'quotaExhausted' | 'failed'; asOf?: number }>`. Rules: only open `share` holdings with `quoteSource: 'eodhd'`; skip when the latest point day ≥ the last weekday; one call per instrument per UTC day (`attempted`); on first sight, backfill from the first lot day (clamped to 1 year on the default limit); **Review Focus 3**: a `.LSE` symbol whose currency is GBX → `shiftDecimal(close, -2)` stored as GBP; any other currency ≠ holding currency → skip and log nothing sensitive; a 401 stops the run without spending the quota.

- [ ] Failing tests: covering each rule above; a run at the limit makes no fetch and returns `quotaExhausted`; two app opens on the same day → one call; the upsert is one transaction per run.
- [ ] Implement. Run `npx jest src/quotes src/settings src/sync src/db`, then `make typecheck && make lint`.

### Task T31: Symbol search in the share form + quota notice (developer)

**Files:** Modify `share-section` (a search sheet when a key exists and search is available; otherwise manual symbol + exchange + currency entry), `holding-detail.screen.tsx`, and `src/screens/home/home.screen.tsx` (a "Prices as of <date>" caption when the last refresh returned `quotaExhausted` or `failed`), plus `en.ts`/`uk.ts`.

- [ ] Failing tests: picking a search result fills symbol, exchange, name, currency, and ISIN; `EodhdUnavailableError` falls back to manual entry; the quota caption renders from the refresh status.
- [ ] Implement. Run `npx jest src/screens`, then `make typecheck && make lint`. Phase check: `make gate`.

## P6 — Trading 212 sync

### Task T32: Trading 212 pins, env, doc (ops, developer)

**Files:** `ios/Kiko/Info.plist` (`live.trading212.com`, ≥2 pins), `.env.example`, `.env.test`, `src/env.d.ts` (`TRADING212_API_ENDPOINT=https://live.trading212.com/api/v0`), `docs/security/README.md`.

- [ ] (ops) Capture the pins. (developer) Add them. Run `make plist`.

### Task T33: Trading 212 credentials + client (developer)

**Files:** Create `src/broker-sync/trading212/{trading212.credentials.ts,trading212.client.ts}` + tests + `__fixtures__/` (the `binance.credentials.ts` shape: `{ apiKey, secret }` JSON under `kiko.trading212.credentials.<accountId>`). Basic auth is built with `src/data-transfer/base64/base64.ts` (Hermes has no `btoa` guarantee).
**Produces:** `fetchPortfolio`, `fetchCash`, `fetchAccountInfo`, `fetchInstruments`, `fetchDividends(cursor?)`; `Trading212RateLimitError` (reads the `x-ratelimit-*` headers).

- [ ] Step 1 **[VERIFY LIVE]** against `docs.trading212.com`: the paths and the field names for position quantity, average price, current price, ticker, instrument currency, and the dividend fields. Record the doc date in the fixture header. The user has no T212 account, so the fixtures come from the documented examples.
- [ ] Failing tests: the `Authorization: Basic <base64(key:secret)>` header; the numbers go through `decimalFromJsonNumber`; 401 → `Trading212AuthError`; 429 → the rate-limit error with a reset time.
- [ ] Implement. Run `npx jest src/broker-sync/trading212 && make plist`.

### Task T34: Broker statement writer + Trading 212 sync (developer)

**Files:** Create `src/broker-sync/statement/{statement.ts,apply-statement.ts}` + tests. Create `src/broker-sync/provider/provider.ts` (+test: `brokerProviderIds = ['trading212','ibkr'] as const`, `isBrokerProviderId`, `runBrokerSync(providerId, accountId)`). Create `src/broker-sync/trading212/trading212.sync.ts` (+test). Modify `src/db/schema.ts` (`transactions.source` += `'trading212','ibkr'`; `pricePoints.source` already includes both), `holding-metadata.ts` (`syncedMetadataFields` += `'brokerKey'`), `src/sync/sync-jobs/sync-jobs.ts` (+test, a broker branch), and `use-auto-sync.ts` (the credential probe for broker institutions).
**Produces:** `type BrokerPosition = { key: string; symbol: string; isin?: string; name: string; currency: Currency; quantity: string; costMinorUnits: number; price?: string; priceDay: number }`; `ParsedBrokerStatement = { positions; cash: { currency; balanceMinorUnits }[]; dividends: { externalId; currency; amountMinorUnits; time; description }[] }`; `applyBrokerStatement(accountId, source, statement)` (one `write()`: upsert share holdings by `brokerKey` with `quoteSource: 'broker'` and one lot dated at the first sync (N11); upsert cash holdings per currency with sync-owned balances; upsert price points; `addManyDedup` dividends with the externalId namespaced `${accountId}:${id}`).

- [ ] Failing tests: the first sync creates holdings and points; a re-sync updates the quantity/lot and adds today's point with no duplicate holdings; a closed position (absent from the portfolio) gets quantity 0 and is not deleted; a failed fetch writes nothing and marks nothing connected (fail closed, the Binance Spot rule); `institution` is set only after the first successful sync; **Review Focus 3**: a position whose currency differs from its existing holding's currency is rejected for that position (no mixed-currency point), and the rest of the statement still applies.
- [ ] Implement. Run `npx jest src/broker-sync src/sync src/holdings`, then `make typecheck && make lint`.

### Task T35: Trading 212 connect UI (developer)

**Files:** Create `src/screens/account-detail/broker-sync-section/` (the `crypto-sync-section` shape) and `trading212-credentials-field/` (key + secret, steps "create a key with read-only scope in Trading 212 → Settings → API"). Modify `account-detail.screen.tsx` (render for `kind === 'broker' && bankId === 'trading212'`), `broker-catalog.ts` (`trading212.connectable = true`), read/restore secrets, and `en.ts`/`uk.ts`.

- [ ] Failing tests: connect → first sync → `institution = 'trading212'`; disconnect clears the Keychain and `institution`; manual holdings still work on an unconnected T212 account.
- [ ] Implement. Run `npx jest src/screens/account-detail src/data-transfer`, then `make typecheck && make lint`. Phase check: `make gate`.

## P7 — IBKR Flex sync + file import

### Task T36: IBKR host verification + pins (ops, developer)

**Files:** `ios/Kiko/Info.plist`, `.env.example`, `.env.test`, `src/env.d.ts` (`IBKR_FLEX_ENDPOINT`), `docs/security/README.md`.

- [ ] (developer) Confirm the Flex Web Service host and paths from IBKR's official guide (the spec fetch got 403; read it in a browser or have the user confirm). **If the host cannot be confirmed, IBKR sync is NO-GO: skip the client half of T37 and all of T38, keep `ibkr.connectable = false`, and still ship T39 (file import).** Record the outcome in the spec decision log (scribe, D18).
- [ ] (ops) Capture the pins. (developer) Add them. Run `make plist`.

### Task T37: Flex XML scanner + IBKR client (developer)

**Files:** Create `src/broker-sync/ibkr/flex-xml.ts` (+test; a scanner for self-closing elements and their attributes plus `<Tag>text</Tag>` extraction; entity decoding for `&amp; &lt; &gt; &quot; &apos;`; no DTD or external entities), `src/broker-sync/ibkr/flex-statement.ts` (+test; `OpenPosition`, `CashReportCurrency`, `CashTransaction type="Dividends"` → `ParsedBrokerStatement`), `src/broker-sync/ibkr/{ibkr.credentials.ts,ibkr.client.ts}` + tests (`CREDENTIAL_QUERY_PARAM = 't'`), and `__fixtures__/uabean-ib-flex.xml`. Modify `src/statement-import/NOTICE.md` (the uabean credit for this fixture, MIT) and `docs/harness/documented-exceptions.md` (only if gitleaks or jscpd flags the fixture, with the concrete reason).

- [ ] Step 1: fetch uabean `tests/importers/ib/beancount.xml`, confirm the MIT licence, and anonymize account ids. **[VERIFY LIVE]** the attribute names used.
- [ ] Failing tests: the fixture parses to the expected positions, cash, and dividends; malformed XML throws `FlexParseError`; `SendRequest` → `GetStatement`, where code 1019 ("generation in progress") retries with backoff, max 5; **N2**: a returned `Url` whose host ≠ `IBKR_FLEX_ENDPOINT`'s host → `IbkrHostMismatchError` and no second request; the token never appears in error messages.
- [ ] Implement. Run `npx jest src/broker-sync/ibkr && make plist`.

### Task T38: IBKR sync + connect UI with Flex setup steps (developer)

**Files:** Create `src/broker-sync/ibkr/ibkr.sync.ts` (+test; calls `applyBrokerStatement(accountId, 'ibkr', …)`) and `src/screens/account-detail/ibkr-credentials-field/` (token + query id; numbered steps to create a Flex Query with Open Positions, Cash Report, and Cash Transactions in XML). Modify `broker-sync-section`, `broker-catalog.ts` (`ibkr.connectable = true`), `provider.ts`, the secrets export/restore, and `en.ts`/`uk.ts`.

- [ ] Failing tests: connect → sync → holdings; token expiry (the IBKR error code for an invalid token) shows a reconnect message; fail closed.
- [ ] Implement. Run `npx jest src/broker-sync src/screens/account-detail src/data-transfer`, then `make typecheck && make lint`.

### Task T39: Broker file import (IBKR Flex XML) (developer)

**Files:** Create `src/broker-import/{registry/registry.ts,formats/ibkr-flex-xml/ibkr-flex-xml.format.ts}` + tests (`BrokerStatementFormat = { id; displayName; detect(input: StatementFormatInput): boolean; parse(input): ParsedBrokerStatement }`; reuses `flex-statement.ts`; a Trades section, when present, builds full lots per N11) and `src/screens/broker-import/broker-import.screen.tsx` (+test; a preview of positions → import through `applyBrokerStatement(accountId, 'ibkr', …)` without setting `institution`). Modify `account-detail.screen.tsx` (a broker account's "Import statement" routes here), the navigation, and `en.ts`/`uk.ts`.

- [ ] Failing tests: `detect` accepts the fixture and rejects a Monobank CSV; the import creates positions on an unconnected broker account; a re-import is idempotent.
- [ ] Implement. Run `npx jest src/broker-import src/screens`, then `make typecheck && make lint`. Phase check: `make gate`.

## P8 — GATED: Freedom24

### Task T40: Freedom24 spike, GO / NO-GO (developer; the coordinator records the decision)

- [ ] Read the Tradernet API docs (`freedom24.com/tradernet-api`) and answer three questions: (1) Is key auth documented, including the signing method? (2) Does a read-only or portfolio-only key scope exist? (3) Is there one stable HTTPS host whose chain can carry ≥2 CA SPKI pins?
- [ ] **GO** only if all three are yes, with doc links. **NO-GO** otherwise. Then nothing changes: Freedom24 stays `connectable: false` in the broker catalog, a complete manual entry. No hidden UI, no dead code.
- [ ] (scribe) Record D18 (GO/NO-GO, reasons, links) in `docs/research/shares-and-assets-feasibility.md`.

### Task T41: [GO only] Freedom24 sync (developer, ops)

- [ ] On GO, the planner writes a short addendum to this plan (pins → credentials → client → `applyBrokerStatement(…, 'freedom24', …)` → connect UI). It follows T32–T35 exactly, adds `'freedom24'` to the `pricePoints.source`, `transactions.source`, and `brokerProviderIds` enums, and adds a privacy-policy entry. The auth details are unknown until T40, so they are not guessed here.

## P9 — GATED: Revolut statement import

### Task T42: Revolut gate (coordinator, user)

- [ ] **GO** only if the user supplies a real Revolut trading-statement CSV (anonymized), or an official column spec. PDF parsing is rejected. **NO-GO** → Revolut stays a manual broker catalog entry, and nothing else changes.

### Task T43: [GO only] Revolut CSV format (developer)

**Files:** Create `src/broker-import/formats/revolut-csv/{revolut-csv.format.ts,.test.ts,index.ts,__fixtures__/}` (the anonymized real sample). Modify the broker-import registry.

- [ ] Failing tests: strict header `detect`; trades → lots (buy and sell), dividends, currency; an unknown row type is rejected with the unrecognized-format message.
- [ ] Implement. Run `npx jest src/broker-import`, then `make typecheck && make lint`.

## P10 — Bank statement import: PUMB XLSX

### Task T44: PUMB XLSX importer, synthetic fixture (developer)

**Files:** Create `src/statement-import/formats/pumb-xlsx/{pumb-xlsx.format.ts,.test.ts,index.ts,__fixtures__/synthetic-pumb-sample.xlsx}`. Modify `src/statement-import/parser/parser.ts` (`statementFormatIds` += `'pumb-xlsx'`), `src/statement-import/registry/registry.ts`, `bank-catalog.ts` (`pumb.statementFormatId = 'pumb-xlsx'`), and `src/statement-import/NOTICE.md` (format facts from uabean `pumb_xls.py`, MIT; **"not verified on a real file"**).

- [ ] Build the fixture by hand with any spreadsheet tool (no generator script committed). It needs the title at (7,1), the "Період" and "Баланс на кінець періоду" rows, the exact header `Дата операції, Тип операції, Сума у валюті операції, Опис, Дата списання, Сума операції, Комісія`, text amounts such as `"-1 234,56 UAH"`, day-first dates, and a file name that carries the currency.
- [ ] Failing tests: `detect` needs an exact header-row match (a one-cell change → rejected); the amounts parse to minor units with the sign; the currency comes from the file name, and when it is missing the existing "confirm currency" path applies; a code comment and NOTICE say "not verified on a real file".
- [ ] Implement. Run `npx jest src/statement-import src/bank-sync`, then `make typecheck && make lint`. Phase check: `make gate`.

**Deferred, no tasks (NO-GO until an anonymized sample exists):** Oschadbank, Raiffeisen, Ukrgasbank, UKRSIBBANK personal, ProCredit personal (`.xls`, open question 3). The coordinator adds a sample request to the release notes.

---

## Wrap-up

### Task T45: Privacy policy, compliance docs, broker Maestro flow (scribe, qa)

**Files:** `docs/privacy-policy.md` (uk) and `docs/privacy-policy.en.md`, §3 "Connections to third-party financial services": add EODHD (`eodhd.com`: ticker symbols and the user's own key; only when the user adds a key), Trading 212 (`live.trading212.com`), Interactive Brokers (the confirmed Flex host), and Freedom24 only if T40 was GO. State that NBU register and metal prices come from `bank.gov.ua` and carry no personal data. Also update the gh-pages copy in the `gh-pages` worktree (`/Users/drizzer14/orca/workspaces/pff-ios/gh-pages/index.html` (uk) and `en.html`), `.claude/skills/kiko-compliance/SKILL.md`, and `docs/security/README.md` (a final host-table review). Create `.maestro/broker-share-manual.yaml` (qa).

- [ ] (scribe) Edit both languages in the same pass. Use "Кіко" in uk. Publish gh-pages **before** App Store submission (the coordinator pushes). Flag the coordinator-owned `memory/refs/resubmission-kit.md` App Privacy section D as needing review.
- [ ] (qa) The flow adds a broker (Other broker) and a manual-quote share, updates its price, and asserts the value.
- [ ] Run `make lint`.

### Task T46: Whole-branch review (reviewer)

- [ ] `kiko:reviewer` reviews the full `next...feat/assets-debts` diff: correctness, conventions, **compliance** (5.6: no flags, gated brokers left as complete manual entries; ATS pins; privacy; trademarks; no financial advice), then `/ponytail-review`. The developer fixes each finding, and qa adds a test for each fixed bug.

### Task T47: Final gates + device verification (developer, coordinator, ops, user)

- [ ] **User reviews every new or changed en/uk key** (a diff of `src/i18n/locales/{en,uk}.ts` against `next`) before any deploy.
- [ ] `make verify` (lint → full jest → `check:all`). Re-run until green. Fix root causes, never weaken a check.
- [ ] The coordinator runs `KIKO_MUTATION_BASE=next make deep` detached and waits for the exit code. It is effectively green when the mutation score is ≥ the threshold and osv reports only the known accepted CVEs.
- [ ] (ops) `make deploy` Release-AdHoc to the connected iPhone (USB preferred).
- [ ] Device checklist (the user has **only a Monobank account**):

| Flow | Device-verifiable? |
|---|---|
| Property: create, update value, net worth and history line | **yes** |
| Metals under the Metals kind: NBU price loads, "price as of", history backfill | **yes** (public NBU) |
| Metal under a bank: PrivatBank allowed, Monobank not offered | **yes** (UI only); also check whether Monobank sells metals (open question 1) |
| New catalog banks render with the right captions | **yes** |
| Bond ISIN mode: found, not found → Manual, offline with and without cache (Airplane mode) | **yes** (public NBU) |
| Debt: annuity / informal loan, negative headline, Debts section, pie shows assets only | **yes** |
| Loan-payment link on a **synced Monobank** debit → interest-only spending | **yes** |
| Broker manual share with manual price | **yes** |
| EODHD BYOK: key check, refresh on open once per day, backfill, quota caption | **only if the user registers a free EODHD key**; otherwise no |
| BigInt decimal math in a Release (Hermes) build | **yes** (any priced holding value) |
| Trading 212 sync | **no** (no account); fixtures only |
| IBKR Flex sync | **no** (no account); fixtures only |
| IBKR file import | **partly**: import the anonymized uabean fixture through the picker |
| Freedom24 / Revolut (if GO) | **no** |
| PUMB XLSX import | **partly**: the synthetic fixture only; **not verified on a real file** |
| Pinned hosts (eodhd, T212, IBKR) TLS negative check (corrupt pins → failure) | eodhd only with a key; others **no** |
