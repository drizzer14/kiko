# Crypto Expansion (USDT + ETH) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exactly two new priced crypto HOLDING currencies — USDT and ETH — that are selectable in the manual holding form and priced via CoinGecko, without ever silently dropping a crypto holding from net worth (the build-6 regression class).

**Architecture:** ETH and USDT join the single currency source of truth (`currencyOptions` + `cryptoCurrencies`), so every classifier, schema enum, form picker, and scale/symbol map picks them up. The CoinGecko live-price and history fetchers generalize from a hardcoded `bitcoin` to a currency-code → CoinGecko-id map, returning one rate entry per coin. The rate-composition crux (`rates-refresh.ts`) loops over ALL crypto currencies via `isCrypto`, so each crypto anchors through USD→UAH and composes a full cross-rate set to every base currency. They remain MANUAL holdings only — BTC wallet sync and Binance sync are untouched.

**Tech Stack:** TypeScript, React Native, Drizzle (op-sqlite), `ts-pattern`, `fnts`, Jest/RNTL, CoinGecko free API, Monobank `/bank/currency`, i18next.

**Spec:** This plan is self-contained (a locked feature request, not a separate spec doc). Domain contract: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md` ("Domain model", "Price data"). Read the `kiko-architecture` (rates/sync pipeline), `kiko-domain` (Money/currency single-source rule), `kiko-code-style`, and `kiko-translator` skills before starting.

## Global Constraints

- **Worktree:** Work ONLY in `/Users/drizzer14/orca/workspaces/pff-ios/next-crypto` (branch `next-crypto`, based on `next` @ acef140). Never `cd` elsewhere; never `git checkout`/`restore`/`stash` in this shared worktree.
- **Scope is LOCKED:** add EXACTLY two crypto currencies, `ETH` and `USDT`. No other coins. They are selectable, priced, MANUAL holding currencies priced through CoinGecko. They are NOT new wallet-sync providers. BTC wallet sync and Binance sync are UNCHANGED — do not touch `src/crypto-sync/**`.
- **Single source of truth for currencies:** `currencyOptions` + the `cryptoCurrencies` set in `src/currency/currency/currency.ts`. Change the set there; every other currency-bearing structure DERIVES from it (`schema.ts` enums, `rates-refresh` composition, `monobank-rates` fiat set, `history-backfill`). Never re-hardcode a second currency list. Because a Drizzle `text({ enum: [...] })` is a TS-only compile hint, adding a currency needs NO migration.
- **Marks (text glyphs):** `ETH` → `Ξ` (U+039E, Greek capital Xi), `USDT` → `₮` (U+20AE). These are display marks only.
- **Coordination — currency-mark reconciliation:** A concurrent track `next-symbols-placeholders` is restructuring the currency-mark system into a single TEXT mark map (symbol-where-exists-else-ISO-code, rendered as text, no SF Symbols). Keep `src/currency/currency/currency.ts` and `src/currency/currency-symbols/currency-symbols.ts` additions MINIMAL and localized (append entries only; do not restructure the maps). The coordinator integrates the symbols track FIRST, so expect to reconcile ETH/USDT onto the new mark map at integration. Flag any surprise (e.g. the mark map already lists ETH/USDT, or `currency-symbols.ts` was deleted) to the coordinator rather than resolving it unilaterally.
- **USDT pricing:** priced uniformly via CoinGecko `tether` (id `tether`). NO special hardcoded 1:1 peg. Its live price (~1 USD with tiny drift) is acceptable.
- **Imports are LENGTH-SORTED within groups** (Biome `organizeImports` is OFF; see `kiko-code-style` and the memory rule `import-ordering-length-sort`): within each import group, sort by whole-statement length ascending, values before types. Every code block below already presents imports length-sorted — preserve that order.
- **Harness checkpoints:** run `npm run check:all` at the end of every task and fix any failure at its root (never weaken a check, never `|| true`, never a bare `biome-ignore`). Run `npm run check:deep` ONCE after the final task, before declaring done.
- **TDD:** for every task, write the failing test first, run it to confirm it fails for the right reason, implement the minimal change, run it green, then commit. Commit freely when a task is green.

---

## File Structure

**Task 1 — register the currencies (compile-required surface + names):**
- Modify `src/currency/currency/currency.ts` — add ETH/USDT to `currencyOptions`, `currencyScale`, `currencySymbol`, and the `cryptoCurrencies` set.
- Modify `src/currency/currency-symbols/currency-symbols.ts` — add ETH/USDT to `currencySignSymbol` (exhaustive `Record<Currency, string>`).
- Modify `src/monobank/currency-code/currency-code.ts` — add ETH/USDT arms to `codeFromCurrency`'s exhaustive match (crypto → `undefined`).
- Modify `src/i18n/locales/en.ts` and `src/i18n/locales/uk.ts` — add ETH/USDT `currencyNames` entries.
- Modify tests: `currency.test.ts`, `currency-symbols.test.ts`, `currency-names.i18n.test.ts`, `currency-code.test.ts`.
- NO edit to `src/db/schema.ts` (its currency columns already derive from `currencyOptions`); verified by `check:typecheck` and a grep check.

**Task 2 — THE CRUX: live crypto pricing + rate composition, build-6 guarded:**
- Create `src/rates/coingecko-ids/coingecko-ids.ts` (+ `index.ts`, + `coingecko-ids.test.ts`) — the `Currency` → CoinGecko-id map, single source for the coin id list.
- Modify `src/rates/coingecko/coingecko.ts` — rename `fetchBTCPrice` → `fetchCryptoPrices`; generalize the response type/guard to be keyed by coin id; build the request URL from the id map.
- Modify `src/env.d.ts` — update the `PRICE_ENDPOINT` doc comment (now a base URL, query built in code).
- Modify `.env.example`, `.env.screenshots`, `.env.screenshots.stable`, `.env.screenshots.empty.stable`, `.env.screenshots.locked.stable`, and the worktree's own untracked `.env` — `PRICE_ENDPOINT` becomes the base simple-price URL (no query string).
- Modify `src/rates/rates-refresh/rates-refresh.ts` — generalize `buildUahPrice` and `pairSource` to loop ALL crypto currencies via `isCrypto`; rename the `fetchBTCPrice` dep to `fetchCryptoPrices`.
- Modify tests: `coingecko.test.ts`, `rates-refresh.test.ts`.
- Create `src/rates/rates-refresh/crypto-coverage.test.ts` — the build-6 guard for BTC/ETH/USDT.

**Task 3 — historical crypto pricing (net-worth chart):**
- Modify `src/rates/coingecko-history/coingecko-history.ts` — rename `fetchBTCHistory` → `fetchCryptoHistory`; fetch each crypto id's `market_chart` from the id map; one entry set per coin.
- Modify `src/rates/history-backfill/history-backfill.ts` — derive `allCurrencies` from `currencyOptions` crypto + `[USD,EUR,UAH]`; loop cryptos in `uahPriceAt`; `pairSource` via `isCrypto`; rename the `fetchBTCHistory` dep to `fetchCryptoHistory`.
- Modify tests: `coingecko-history.test.ts`, `history-backfill.test.ts`.

---

## Task 1: Register ETH and USDT as currencies

**Files:**
- Modify: `src/currency/currency/currency.ts` (`currencyOptions` ~14-123, `currencyScale` ~127-236, `currencySymbol` ~241-350, `cryptoCurrencies` :356, header comment :1-13)
- Modify: `src/currency/currency-symbols/currency-symbols.ts` (`currencySignSymbol` :24-133)
- Modify: `src/monobank/currency-code/currency-code.ts` (`codeFromCurrency` match, :225-226)
- Modify: `src/i18n/locales/en.ts` (`currencyNames`, :541 area)
- Modify: `src/i18n/locales/uk.ts` (`currencyNames`, :494 area)
- Test: `src/currency/currency/currency.test.ts`
- Test: `src/currency/currency-symbols/currency-symbols.test.ts`
- Test: `src/currency/currency/currency-names.i18n.test.ts`
- Test: `src/monobank/currency-code/currency-code.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `'ETH'` and `'USDT'` as members of the `Currency` union and of `currencyOptions`; `isCrypto('ETH') === true`, `isCrypto('USDT') === true`; `currencyScale.ETH === 8`, `currencyScale.USDT === 2`; `currencySymbol.ETH === 'Ξ'`, `currencySymbol.USDT === '₮'`. Later tasks rely on `isCrypto` classifying both, and on `currencyScale` being defined for both (used by `conversion.ts`'s `convert`).

**Design decisions (justify in the diff comments):**
- **Scale — ETH = 8, USDT = 2.** `Money.minorUnits` is an integer at `10 ** currencyScale`. ETH's native precision is 18 decimals (wei), but `1 ETH` at scale 18 = `10^18` minor units, which exceeds `Number.MAX_SAFE_INTEGER` (~`9.007e15`) — a single ETH balance would already be unrepresentable. Scale 8 matches BTC (satoshi precision), keeps every realistic balance inside the safe-integer range (`~9e7` ETH representable), and inherits BTC's already-shipped 8-dp display/format path (`formatMoney` in `src/currency/format/format.ts` renders `scale` fraction digits — ETH will show 8 dp exactly as BTC does today; this is a deliberate, BTC-consistent outcome, not a bug). USDT is a USD-pegged stablecoin (~1 USD), so 2 decimals (cents) is the natural display and precision, matching every fiat.
- **Marks.** `ETH → 'Ξ'` (U+039E), `USDT → '₮'` (U+20AE). Note `MNT` already uses `₮` and `BTC` uses `₿`; a shared display glyph across two distinct currency codes is fine (the code disambiguates). Keep the addition to `currencySymbol` a two-line append (coordination note above).
- **SF Symbol (`currencySignSymbol`).** No verified on-device SF Symbol currency glyph exists for ETH/USDT, and `sf-symbols-ios27-availability` warns an unverified/too-new symbol renders blank. Use the safe generic `'banknote'` for both (the same fallback every additional fiat uses). This map is likely superseded by the `next-symbols-placeholders` text-mark map at integration; keep it a two-line append.
- **Ukrainian names — transliteration precedent.** NBU does not quote crypto, so crypto names are hand-authored, following the existing `BTC → 'Біткоїн'` transliteration precedent: `ETH → 'Ефіріум'`, `USDT → 'Тезер'`. Route through `kiko-translator` conventions; if the translator agent prefers a different established Ukrainian spelling (e.g. `'Тизер'`), use theirs — the coverage test only requires a non-empty name.
- **Order.** Append `'ETH'`, then `'USDT'` immediately AFTER `'BTC'` in `currencyOptions` (the crypto block stays last). Mirror that order in every map and both i18n catalogues.

- [ ] **Step 1: Update the failing tests first**

In `src/currency/currency/currency.test.ts`, the existing `treats only BTC as crypto` test and the `ends with BTC` assertion must change. Replace the `currencyOptions` describe block's last-element assertion and the classification describe block with:

```ts
describe('currencyOptions', () => {
  it('opens with the originally shipped fiat set in canonical order', () => {
    expect(currencyOptions.slice(0, 5)).toEqual(['UAH', 'USD', 'EUR', 'GBP', 'CHF']);
  });

  it('ends with the crypto block: BTC, ETH, USDT', () => {
    expect(currencyOptions.slice(-3)).toEqual(['BTC', 'ETH', 'USDT']);
  });

  it('includes the additional Monobank-priced fiats', () => {
    for (const code of ['JPY', 'PLN', 'CAD', 'AUD', 'TRY', 'INR', 'GEL'] as const) {
      expect(currencyOptions).toContain(code);
    }
  });

  it('has no duplicate codes', () => {
    expect(new Set(currencyOptions).size).toBe(currencyOptions.length);
  });
});
```

And replace the `fiat / crypto classification` describe block with:

```ts
describe('fiat / crypto classification', () => {
  it('treats BTC, ETH, and USDT as crypto and everything else as fiat', () => {
    for (const code of ['BTC', 'ETH', 'USDT'] as const) {
      expect(isCrypto(code)).toBe(true);
      expect(isFiat(code)).toBe(false);
    }
    for (const code of fiatCurrencyOptions) {
      expect(isCrypto(code)).toBe(false);
      expect(isFiat(code)).toBe(true);
    }
  });

  it('exposes the fiat subset (every option except the crypto block), order-preserving', () => {
    const cryptoBlock = new Set(['BTC', 'ETH', 'USDT']);
    expect([...fiatCurrencyOptions]).toEqual(currencyOptions.filter((code) => !cryptoBlock.has(code)));
    for (const code of ['BTC', 'ETH', 'USDT'] as const) {
      expect(fiatCurrencyOptions).not.toContain(code);
    }
  });

  it('assigns a defined scale and mark to each new crypto', () => {
    expect(currencyScale.ETH).toBe(8);
    expect(currencyScale.USDT).toBe(2);
    expect(currencySymbol.ETH).toBe('Ξ');
    expect(currencySymbol.USDT).toBe('₮');
  });
});
```

Update this file's import line (length-sorted) to include the new names it now references:

```ts
import { currencyOptions, currencyScale, currencySymbol, fiatCurrencyOptions, isCrypto, isCurrency, isFiat } from './currency';
```

In `src/currency/currency-symbols/currency-symbols.test.ts`, extend the fallback test to cover ETH/USDT (they use the generic glyph):

```ts
  it('falls back to the generic banknote glyph for an additional Monobank fiat and for ETH/USDT', () => {
    for (const code of ['JPY', 'PLN', 'CAD', 'TRY', 'INR', 'ETH', 'USDT'] as const) {
      expect(currencySignSymbol[code]).toBe('banknote');
    }
  });
```

In `src/currency/currency/currency-names.i18n.test.ts`, add a crypto-name assertion (the coverage `for` loops already cover ETH/USDT once they are in `currencyOptions`):

```ts
  it('hand-authors the new crypto names in both languages', () => {
    expect(en.currencyNames.ETH).toBe('Ethereum');
    expect(en.currencyNames.USDT).toBe('Tether');
    expect(uk.currencyNames.ETH.length).toBeGreaterThan(0);
    expect(uk.currencyNames.USDT.length).toBeGreaterThan(0);
  });
```

In `src/monobank/currency-code/currency-code.test.ts`, extend the crypto-has-no-code test:

```ts
  it('gives crypto currencies no ISO numeric code (BTC/ETH/USDT are not Monobank fiats)', () => {
    expect(codeFromCurrency('BTC')).toBeUndefined();
    expect(codeFromCurrency('ETH')).toBeUndefined();
    expect(codeFromCurrency('USDT')).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx jest src/currency/currency/currency.test.ts src/currency/currency-symbols/currency-symbols.test.ts src/currency/currency/currency-names.i18n.test.ts src/monobank/currency-code/currency-code.test.ts`
Expected: FAIL — TypeScript rejects `'ETH'`/`'USDT'` as `Currency` (not yet in the union), `currencyScale.ETH`/`currencySymbol.ETH` do not exist, `en.currencyNames.ETH` is missing, `slice(-3)` is not `['BTC','ETH','USDT']`.

- [ ] **Step 3: Add ETH/USDT to `currencyOptions` and the crypto set**

In `src/currency/currency/currency.ts`, update the header comment's final clause (append entries only — coordination note) so it reads "… then the crypto block last (BTC, ETH, USDT)". Change the tail of the `currencyOptions` array from:

```ts
  'ZAR',
  'BTC',
] as const;
```
to:
```ts
  'ZAR',
  'BTC',
  'ETH',
  'USDT',
] as const;
```

Add scale entries at the end of `currencyScale` (after `BTC: 8,`):

```ts
  BTC: 8,
  ETH: 8,
  USDT: 2,
};
```

Add mark entries at the end of `currencySymbol` (after `BTC: '₿',`):

```ts
  BTC: '₿',
  ETH: 'Ξ',
  USDT: '₮',
};
```

Add ETH/USDT to the crypto set:

```ts
const cryptoCurrencies: ReadonlySet<Currency> = new Set<Currency>(['BTC', 'ETH', 'USDT']);
```

- [ ] **Step 4: Add ETH/USDT to `currencySignSymbol`**

In `src/currency/currency-symbols/currency-symbols.ts`, append after `BTC: 'bitcoinsign',`:

```ts
  BTC: 'bitcoinsign',
  // ETH/USDT have no verified on-device SF Symbol currency glyph; use the safe
  // generic `banknote` (see sf-symbols-ios27-availability). Reconciled onto the
  // next-symbols-placeholders text-mark map at integration.
  ETH: 'banknote',
  USDT: 'banknote',
};
```

- [ ] **Step 5: Add ETH/USDT arms to `codeFromCurrency`**

In `src/monobank/currency-code/currency-code.ts`, before `.exhaustive()` (currently `.with('BTC', () => undefined)` at :225), add:

```ts
    .with('BTC', () => undefined)
    .with('ETH', () => undefined)
    .with('USDT', () => undefined)
    .exhaustive();
```

- [ ] **Step 6: Add the i18n currency names**

In `src/i18n/locales/en.ts`, append after `BTC: 'Bitcoin',` (:541):

```ts
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    USDT: 'Tether',
  },
```

In `src/i18n/locales/uk.ts`, append after `BTC: 'Біткоїн',` (:494). Route the exact Ukrainian spellings through `kiko-translator` (crypto names are hand-authored, transliterated like `Біткоїн`); the proposed values are:

```ts
    BTC: 'Біткоїн',
    ETH: 'Ефіріум',
    USDT: 'Тезер',
  },
```

- [ ] **Step 7: Run the tests to confirm they pass**

Run: `npx jest src/currency/currency/currency.test.ts src/currency/currency-symbols/currency-symbols.test.ts src/currency/currency/currency-names.i18n.test.ts src/monobank/currency-code/currency-code.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify schema derives (no migration, no schema edit) and forms pick up crypto**

Run: `grep -n "enum: currencyOptions" src/db/schema.ts`
Expected: the `accounts.currency`? no — expect `holdings.currency`, `currency_rates.base/quote`, `currency_rate_history.base/quote`, and `settings.base_currency` all use `{ enum: currencyOptions }`, so ETH/USDT are now valid values with NO schema.ts change and NO migration. Confirm `src/design-system/components/currency-field/currency-field.component.tsx` defaults `options = currencyOptions` (holding form offers the full set incl. crypto) and that the cash-account currency field in `src/screens/forms/account-form.screen.tsx` still passes `options={fiatCurrencyOptions}` (fiat-only) — no edit needed; ETH/USDT become selectable in the holding form automatically. Note: this task adds NO new sync provider — `src/crypto-sync/**` and the BTC/Binance `BINANCE_ASSET = 'BTC'` constants stay untouched.

- [ ] **Step 9: Run the fast/medium harness**

Run: `npm run check:all`
Expected: PASS (lint, typecheck, dup, knip, deps, security, rules, plist, secrets, overrides). Fix any failure at its root.

- [ ] **Step 10: Commit**

```bash
git add src/currency src/monobank/currency-code src/i18n/locales
git commit -m "feat(currency): register ETH and USDT as priced crypto currencies"
```

---

## Task 2: THE CRUX — live crypto pricing and full cross-rate composition (build-6 guarded)

This is where the build-6 trap is defeated: every crypto MUST anchor through USD→UAH and compose a live cross-rate to EVERY base currency, so no crypto holding silently drops from net worth / account totals / per-currency breakdown / statistics. Write the coverage guard first.

**Files:**
- Create: `src/rates/coingecko-ids/coingecko-ids.ts`
- Create: `src/rates/coingecko-ids/index.ts`
- Create: `src/rates/coingecko-ids/coingecko-ids.test.ts`
- Modify: `src/rates/coingecko/coingecko.ts` (whole file — rename + generalize)
- Modify: `src/rates/coingecko/coingecko.test.ts`
- Modify: `src/env.d.ts` (:7 comment)
- Modify: `.env.example` (:14), `.env.screenshots` (:15), `.env.screenshots.stable` (:19), `.env.screenshots.empty.stable` (:18), `.env.screenshots.locked.stable` (:18), and the worktree's own untracked `.env`
- Modify: `src/rates/rates-refresh/rates-refresh.ts` (`buildUahPrice` :41-57, `pairSource` :59-60, `RefreshDeps` :29-35, `refreshRates` :99-100)
- Modify: `src/rates/rates-refresh/rates-refresh.test.ts`
- Create: `src/rates/rates-refresh/crypto-coverage.test.ts`

**Interfaces:**
- Consumes: `isCrypto`, `currencyOptions`, `Currency` from Task 1; `RateEntry` from `src/rates/conversion`; `buildRateTable`, `canConvert`, `guardedNetWorth` from `src/rates/net-worth-view`; `codeFromCurrency` and `fetchFiatRates` (for the coverage test's fiat anchors).
- Produces:
  - `cryptoCoinGeckoId: Record<'BTC' | 'ETH' | 'USDT', string>` and `cryptoPriceCurrencies: readonly Currency[]` (in `coingecko-ids.ts`).
  - `fetchCryptoPrices(fetchImpl?: typeof fetch): Promise<RateEntry[]>` — replaces `fetchBTCPrice`; returns one `{ base, quote: 'USD', rate, source: 'coingecko' }` per crypto.
  - `RefreshDeps.fetchCryptoPrices?: () => Promise<RateEntry[]>` — renamed from `fetchBTCPrice`.

- [ ] **Step 1: Write the build-6 crypto-coverage guard test (failing)**

Create `src/rates/rates-refresh/crypto-coverage.test.ts`, modeled on `src/rates/monobank-rates/monobank-fiat-coverage.test.ts`. It drives the REAL `refreshRates` composition with a full Monobank-shaped fiat feed (for the USD→UAH anchors every crypto needs) plus injected crypto USD prices, builds the real rate table, and proves BTC/ETH/USDT each convert to EVERY base and each contribute to a positive net-worth total.

```ts
import { codeFromCurrency } from '../../monobank/currency-code';
import { fetchFiatRates } from '../monobank-rates';
import { type RefreshDeps, refreshRates } from '../rates-refresh';
import { type RateEntry } from '../conversion';
import { buildRateTable, canConvert, guardedNetWorth } from '../net-worth-view';
import { type Currency, currencyOptions, isCrypto, isCurrency, isFiat } from '../../currency/currency';

// Every crypto MUST reach every base leg by a live cross-rate, or a holding in it
// silently drops from the net-worth total everywhere except the chart — the
// build-6 regression class. USDT is priced uniformly via CoinGecko (no 1:1 peg).
const CRYPTO: Currency[] = ['BTC', 'ETH', 'USDT'];
const CRYPTO_USD: Record<string, number> = { BTC: 65_000, ETH: 3_200, USDT: 1.0007 };
const NOW = Date.UTC(2026, 0, 1);

type MonoRate = {
  currencyCodeA: number;
  currencyCodeB: number;
  date: number;
  rateBuy?: number;
  rateSell?: number;
};

// A distinct UAH price per fiat so no cross-rate collapses to 1 (which would
// hide a broken pivot). currencyCodeA is the foreign leg, currencyCodeB is UAH
// (980) — the exact shape Monobank's real feed uses — so `buildUahPrice` anchors
// each fiat and `buildPairs` composes every cross pair from it.
const buildMonobankFeed = (): MonoRate[] => {
  const feed: MonoRate[] = [];
  let index = 1;
  for (const currency of currencyOptions) {
    if (!isFiat(currency) || currency === 'UAH') {
      continue;
    }
    const code = codeFromCurrency(currency);
    if (code === undefined) {
      throw new Error(`fiat ${currency} has no ISO numeric code`);
    }
    const price = 1 + index * 0.5;
    feed.push({ currencyCodeA: code, currencyCodeB: 980, date: 1, rateBuy: price, rateSell: price + 0.1 });
    index += 1;
  }
  return feed;
};

const makeFetch = (body: unknown): typeof fetch =>
  (async () => ({ ok: true, json: async () => body, status: 200 })) as unknown as typeof fetch;

const cryptoRates = (): RateEntry[] =>
  CRYPTO.map((base) => ({ base, quote: 'USD' as Currency, rate: CRYPTO_USD[base], source: 'coingecko' as const }));

const composeTable = async () => {
  const feed = buildMonobankFeed();
  const captured: { base: string; quote: string; rate: string }[][] = [];
  const deps: RefreshDeps = {
    fetchFiatRates: () => fetchFiatRates(makeFetch(feed)),
    fetchCryptoPrices: async () => cryptoRates(),
    upsertMany: async (rates) => {
      captured.push(rates);
    },
    now: () => 1000,
  };

  await refreshRates(deps);
  expect(captured).toHaveLength(1);

  return buildRateTable(
    captured[0].map((row) => {
      if (!isCurrency(row.base) || !isCurrency(row.quote)) {
        throw new Error(`unexpected pair ${row.base}:${row.quote}`);
      }
      return { base: row.base, quote: row.quote, rate: row.rate };
    }),
  );
};

describe('Crypto coverage — every added crypto reaches every base (no silent net-worth drop)', () => {
  it('composes a convertible path from every crypto to every base currency', async () => {
    const table = await composeTable();
    for (const crypto of CRYPTO) {
      for (const base of currencyOptions) {
        if (base === crypto) {
          continue;
        }
        expect(canConvert(crypto, base, table)).toBe(true);
      }
    }
  });

  it('includes a holding of every crypto in the net-worth total for every base leg', async () => {
    const table = await composeTable();
    for (const crypto of CRYPTO) {
      for (const base of ['UAH', 'USD', 'EUR'] as Currency[]) {
        const total = guardedNetWorth(
          [{ currency: crypto, balanceMinorUnits: 100_000_000, type: 'crypto_asset', metadata: null }],
          base,
          table,
          NOW,
        );
        expect(total.currency).toBe(base);
        expect(total.minorUnits).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run the coverage test to confirm it fails**

Run: `npx jest src/rates/rates-refresh/crypto-coverage.test.ts`
Expected: FAIL — `RefreshDeps` has no `fetchCryptoPrices` field yet (still `fetchBTCPrice`), and `buildUahPrice` only prices `BTC`, so `canConvert('ETH', …)` / `canConvert('USDT', …)` are false and the ETH/USDT totals are 0.

- [ ] **Step 3: Create the CoinGecko id map**

Create `src/rates/coingecko-ids/coingecko-ids.ts`:

```ts
import type { Currency } from '../../currency/currency';

/**
 * The single source of truth mapping each crypto `Currency` to its CoinGecko
 * coin id. Both the live price fetch (`coingecko.ts`) and the history fetch
 * (`coingecko-history.ts`) build their request ids from this map, so the coin
 * set can never drift between the two. Keyed exhaustively over the crypto codes;
 * `coingecko-ids.test.ts` asserts the keys equal `currencyOptions.filter(isCrypto)`,
 * so adding a crypto without a CoinGecko id is a test failure, not a silent gap.
 */
export const cryptoCoinGeckoId: Record<'BTC' | 'ETH' | 'USDT', string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
};

/** The crypto currencies to price, in `currencyOptions` order (BTC, ETH, USDT). */
export const cryptoPriceCurrencies = Object.keys(cryptoCoinGeckoId) as Currency[];

/** The comma-joined CoinGecko id list for a `simple/price`/`market_chart` request. */
export const coinGeckoIds = (): string => Object.values(cryptoCoinGeckoId).join(',');
```

Create `src/rates/coingecko-ids/index.ts`:

```ts
export * from './coingecko-ids';
```

Create `src/rates/coingecko-ids/coingecko-ids.test.ts`:

```ts
import { currencyOptions, isCrypto } from '../../currency/currency';

import { coinGeckoIds, cryptoCoinGeckoId } from './coingecko-ids';

describe('cryptoCoinGeckoId', () => {
  it('maps exactly the crypto currencies (no crypto left without an id)', () => {
    const cryptoCodes = currencyOptions.filter(isCrypto).sort();
    expect(Object.keys(cryptoCoinGeckoId).sort()).toEqual(cryptoCodes);
  });

  it('joins the ids for a CoinGecko request in currency order', () => {
    expect(coinGeckoIds()).toBe('bitcoin,ethereum,tether');
  });
});
```

- [ ] **Step 4: Point `PRICE_ENDPOINT` at the base URL (code owns the id query)**

The id list must be owned by code, not by a committed env string — otherwise a stale untracked `.env` on an existing checkout would still request only `bitcoin`, silently dropping ETH/USDT prices (a config-level re-run of the build-6 trap). Change every `PRICE_ENDPOINT` value from the full query URL to the base:

In `.env.example`, `.env.screenshots`, `.env.screenshots.stable`, `.env.screenshots.empty.stable`, `.env.screenshots.locked.stable`, and the worktree's own untracked `.env`:

```
PRICE_ENDPOINT=https://api.coingecko.com/api/v3/simple/price
```

In `src/env.d.ts`, update the `PRICE_ENDPOINT` comment/line to note it is now the base simple-price URL and the `ids`/`vs_currencies` query is built in code from `cryptoCoinGeckoId`:

```ts
  // Base CoinGecko simple-price URL; the `ids`/`vs_currencies` query is built in
  // code from `src/rates/coingecko-ids` so the coin set cannot drift from a
  // stale committed `.env`.
  export const PRICE_ENDPOINT: string;
```

- [ ] **Step 5: Generalize `coingecko.ts` to fetch all crypto ids**

Replace the whole body of `src/rates/coingecko/coingecko.ts` with a per-coin-id keyed shape:

```ts
import { PRICE_ENDPOINT } from '@env';
import { guard } from 'fnts';

import type { RateEntry } from '../conversion';
import { coinGeckoIds, cryptoCoinGeckoId } from '../coingecko-ids';
import type { Currency } from '../../currency/currency';

/** The `/simple/price` body: one `{ usd }` object per requested coin id. */
type CoinGeckoPrices = Record<string, { usd: number }>;

/**
 * Read a CoinGecko simple-price body, or throw on a non-ok response. The
 * ok-check is a `guard` validator/executor pair rather than an imperative
 * `if (!ok) throw`, matching the Monobank client for consistency.
 */
const readPrice = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`CoinGecko request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<unknown> => response.json(),
);

// A 200 with an unexpected body is as real a failure as a 429 — CoinGecko's free
// tier returns `{}` (and sometimes an error object) under load. Every requested
// coin id must carry a finite `usd`, else the body is rejected with a typed error
// rather than throwing a bare TypeError downstream.
const isCoinGeckoPrices = (value: unknown): value is CoinGeckoPrices => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const id of Object.values(cryptoCoinGeckoId)) {
    const entry = record[id];
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('usd' in entry) ||
      typeof (entry as { usd: unknown }).usd !== 'number' ||
      !Number.isFinite((entry as { usd: number }).usd)
    ) {
      return false;
    }
  }
  return true;
};

const priceUrl = (): string => `${PRICE_ENDPOINT}?ids=${coinGeckoIds()}&vs_currencies=usd`;

/**
 * Fetch the current USD price of every supported crypto from CoinGecko's public
 * simple-price endpoint. Returns one `<crypto>->USD` entry per coin; other crypto
 * pairs are composed downstream from the fiat cross rates (`rates-refresh.ts`).
 */
export const fetchCryptoPrices = async (fetchImpl: typeof fetch = fetch): Promise<RateEntry[]> => {
  const response = await fetchImpl(priceUrl());
  const data: unknown = await readPrice(response);

  if (!isCoinGeckoPrices(data)) {
    throw new Error('CoinGecko price response did not contain a finite usd value for every coin');
  }

  return (Object.entries(cryptoCoinGeckoId) as [Currency, string][]).map(([base, id]) => ({
    base,
    quote: 'USD',
    rate: (data as CoinGeckoPrices)[id].usd,
    source: 'coingecko',
  }));
};
```

- [ ] **Step 6: Update `coingecko.test.ts`**

Replace `src/rates/coingecko/coingecko.test.ts` to exercise `fetchCryptoPrices` with a multi-coin body and the code-built URL:

```ts
import { fetchCryptoPrices } from './coingecko';

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 429 })) as unknown as typeof fetch;

const body = { bitcoin: { usd: 65_000 }, ethereum: { usd: 3_200 }, tether: { usd: 1.0007 } };

describe('fetchCryptoPrices', () => {
  it('requests the simple-price endpoint for every crypto id', async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => body, status: 200 };
    }) as unknown as typeof fetch;

    await fetchCryptoPrices(spyFetch);

    expect(sentUrl).toBe(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd',
    );
  });

  it('returns one <crypto>->USD entry per coin', async () => {
    const result = await fetchCryptoPrices(makeFetch(body));

    expect(result).toEqual([
      { base: 'BTC', quote: 'USD', rate: 65_000, source: 'coingecko' },
      { base: 'ETH', quote: 'USD', rate: 3_200, source: 'coingecko' },
      { base: 'USDT', quote: 'USD', rate: 1.0007, source: 'coingecko' },
    ]);
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchCryptoPrices(makeFetch({}, false))).rejects.toThrow('429');
  });

  it('rejects when any requested coin is missing a finite usd price', async () => {
    await expect(fetchCryptoPrices(makeFetch({ bitcoin: { usd: 65_000 } }))).rejects.toThrow(/CoinGecko/);
    await expect(
      fetchCryptoPrices(makeFetch({ bitcoin: { usd: 65_000 }, ethereum: { usd: 3_200 }, tether: { usd: 'lots' } })),
    ).rejects.toThrow(/CoinGecko/);
  });
});
```

Note: `.env.example`/`.env` mock the `@env` import through jest's transform of `PRICE_ENDPOINT`; jest resolves `@env` from the worktree `.env` set in Step 4, so the URL prefix in the assertion matches the base URL.

- [ ] **Step 7: Generalize `rates-refresh.ts` composition**

In `src/rates/rates-refresh/rates-refresh.ts`:

Update the imports (length-sorted) to swap `fetchBTCPrice` for `fetchCryptoPrices` and add `isCrypto`:

```ts
import { ratesRepo } from '@kiko/rates/repo';

import type { RateEntry } from '../conversion';
import { fetchCryptoPrices } from '../coingecko';
import { fetchFiatRates } from '../monobank-rates';
import type { Currency } from '../../currency/currency';
import { currencyOptions, isCrypto } from '../../currency/currency';
```

Generalize `buildUahPrice` (rename its second param `btc` → `crypto`) so it prices EVERY crypto through the USD anchor, not just BTC:

```ts
/**
 * Express each currency in UAH. Fiat entries anchor USD/EUR to UAH directly;
 * every crypto is anchored through its USD price so crypto pairs stay consistent
 * with fiat. A crypto with no USD anchor (no fiat USD price this run) is simply
 * left unpriced, so `buildPairs` skips it rather than composing a false rate.
 */
const buildUahPrice = (fiat: RateEntry[], crypto: RateEntry[]): UahPrice => {
  const price: UahPrice = { UAH: 1 };
  for (const entry of fiat) {
    if (entry.quote === 'UAH') {
      price[entry.base] = entry.rate;
    } else if (entry.base === 'UAH') {
      price[entry.quote] = 1 / entry.rate;
    }
  }
  const usdPrice = price.USD;
  if (usdPrice !== undefined) {
    for (const entry of crypto) {
      if (entry.quote === 'USD' && isCrypto(entry.base)) {
        price[entry.base] = entry.rate * usdPrice;
      }
    }
  }
  return price;
};
```

Generalize `pairSource` to route any crypto leg to CoinGecko:

```ts
const pairSource = (base: Currency, quote: Currency): 'monobank' | 'coingecko' =>
  isCrypto(base) || isCrypto(quote) ? 'coingecko' : 'monobank';
```

Rename the dep field and its use in `RefreshDeps` and `refreshRates`:

```ts
export type RefreshDeps = {
  fetchFiatRates?: () => Promise<RateEntry[]>;
  fetchCryptoPrices?: () => Promise<RateEntry[]>;
  upsertMany?: (rates: StoredRate[]) => Promise<void>;
  now?: () => number;
  lastRefreshAt?: number | null;
};
```

```ts
  const loadFiat = deps.fetchFiatRates ?? (() => fetchFiatRates());
  const loadCrypto = deps.fetchCryptoPrices ?? (() => fetchCryptoPrices());
  const upsertMany = deps.upsertMany ?? ratesRepo.upsertMany;

  // Settle the two providers independently … (comment unchanged)
  const [fiatResult, cryptoResult] = await Promise.allSettled([loadFiat(), loadCrypto()]);
  const fiat = fiatResult.status === 'fulfilled' ? fiatResult.value : [];
  const crypto = cryptoResult.status === 'fulfilled' ? cryptoResult.value : [];
  const pairs = buildPairs(buildUahPrice(fiat, crypto), at);
```

Leave the `allCurrencies = currencyOptions` line, `buildPairs`, the cache-window skip, and the `Promise.allSettled` fallback comment unchanged — they already iterate the full currency set and already tolerate a missing provider.

- [ ] **Step 8: Update `rates-refresh.test.ts` for the renamed dep**

In `src/rates/rates-refresh/rates-refresh.test.ts`, rename `fetchBTCPrice` → `fetchCryptoPrices` in `makeDeps` and in the two override tests, and rename the local `btc` fixture references accordingly (the fixture is still a single BTC entry — the existing 12-pair, string-rate, cache-window, and provider-failure assertions are all unchanged in intent):

```ts
  const deps: RefreshDeps = {
    fetchFiatRates: async () => fiat,
    fetchCryptoPrices: async () => btc,
    upsertMany: async (rates: StoredRate[]) => {
      captured.push(rates);
    },
    now: () => 1000,
    ...overrides,
  };
```

The `still stores fiat pairs when the BTC provider rejects` and `composes no pairs when only the BTC provider survives` tests must use the new key:

```ts
      fetchCryptoPrices: () => Promise.reject(new Error('429')),
```

- [ ] **Step 9: Run the crux tests to confirm they pass**

Run: `npx jest src/rates/coingecko-ids src/rates/coingecko/coingecko.test.ts src/rates/rates-refresh/rates-refresh.test.ts src/rates/rates-refresh/crypto-coverage.test.ts`
Expected: PASS — every crypto now composes a convertible path to every base, and ETH/USDT holdings produce a positive net-worth total in each base leg.

- [ ] **Step 10: Run the full unit suite and the harness**

Run: `npx jest src/rates` then `npm run check:all`
Expected: PASS. Fix any Knip finding on the new `coingecko-ids` module by confirming it is imported (it is, from `coingecko.ts`); fix any lint/typecheck at its root.

- [ ] **Step 11: Commit**

```bash
git add src/rates/coingecko-ids src/rates/coingecko src/rates/rates-refresh src/env.d.ts .env.example .env.screenshots .env.screenshots.stable .env.screenshots.empty.stable .env.screenshots.locked.stable
git commit -m "feat(rates): price ETH and USDT via CoinGecko with full cross-rate composition"
```

(The worktree's untracked `.env` is not committed; it was edited so the local dev build fetches all three coins.)

---

## Task 3: Historical crypto pricing for the net-worth chart

The chart is the one place the build-6 trap did NOT drop the holding, but an ETH/USDT holding still needs historical rates or its past chart points carry no crypto value. Generalize the history fetch and the history composer the same way as the live path, so a manual ETH/USDT holding plots correctly.

**Files:**
- Modify: `src/rates/coingecko-history/coingecko-history.ts` (whole file — rename + per-coin fetch)
- Modify: `src/rates/coingecko-history/coingecko-history.test.ts`
- Modify: `src/rates/history-backfill/history-backfill.ts` (`allCurrencies` :11, `pairSource` :71-72, `uahPriceAt` :117-132, `BackfillDeps.fetchBTCHistory` :36, `runBackfill` :178)
- Modify: `src/rates/history-backfill/history-backfill.test.ts`

**Interfaces:**
- Consumes: `cryptoCoinGeckoId`, `cryptoPriceCurrencies` from Task 2; `isCrypto`, `currencyOptions` from Task 1; `HistoryRateEntry`, `toUtcMidnight` from `src/rates/history-entry`.
- Produces: `fetchCryptoHistory(days: number, fetchImpl?: typeof fetch): Promise<HistoryRateEntry[]>` — replaces `fetchBTCHistory`; returns the union of every crypto's daily USD series. `BackfillDeps.fetchCryptoHistory?: (days: number) => Promise<HistoryRateEntry[]>`.

- [ ] **Step 1: Write the failing history tests**

Replace `src/rates/coingecko-history/coingecko-history.test.ts` to exercise `fetchCryptoHistory` fetching each coin's `market_chart` and unioning the results. A per-coin `fetch` spy keyed by URL returns each coin's series:

```ts
import { fetchCryptoHistory } from './coingecko-history';

const DAY_MS = 24 * 60 * 60 * 1000;
const d1 = Date.UTC(2026, 8, 1);
const d2 = Date.UTC(2026, 8, 2);

// Route each coin id to its own price series; a coin's non-ok response is modeled
// per url so the "one coin fails, others survive" case can be exercised.
const makeRoutedFetch = (byCoin: Record<string, { ok?: boolean; prices: [number, number][] }>): typeof fetch =>
  (async (url: string) => {
    const id = /coins\/([a-z]+)\/market_chart/.exec(url)?.[1] ?? '';
    const entry = byCoin[id] ?? { prices: [] };
    const ok = entry.ok ?? true;
    return { ok, status: ok ? 200 : 429, json: async () => ({ prices: entry.prices }) };
  }) as unknown as typeof fetch;

describe('fetchCryptoHistory', () => {
  it('requests each crypto coin’s market_chart for the day span and unions the series', async () => {
    const result = await fetchCryptoHistory(
      2,
      makeRoutedFetch({
        bitcoin: { prices: [[d1, 78_552], [d2, 77_416]] },
        ethereum: { prices: [[d1, 3_100], [d2, 3_200]] },
        tether: { prices: [[d1, 1.0], [d2, 1.0007]] },
      }),
    );

    expect(result).toContainEqual({ base: 'BTC', quote: 'USD', day: d2, rate: 77_416, source: 'coingecko' });
    expect(result).toContainEqual({ base: 'ETH', quote: 'USD', day: d1, rate: 3_100, source: 'coingecko' });
    expect(result).toContainEqual({ base: 'USDT', quote: 'USD', day: d2, rate: 1.0007, source: 'coingecko' });
  });

  it('keeps the surviving coins when one coin request is non-ok', async () => {
    const result = await fetchCryptoHistory(
      1,
      makeRoutedFetch({
        bitcoin: { prices: [[d1, 78_552]] },
        ethereum: { ok: false, prices: [] },
        tether: { prices: [[d1, 1.0]] },
      }),
    );

    expect(result.some((e) => e.base === 'BTC')).toBe(true);
    expect(result.some((e) => e.base === 'USDT')).toBe(true);
    expect(result.some((e) => e.base === 'ETH')).toBe(false);
  });

  it('throws only when every coin request fails', async () => {
    await expect(
      fetchCryptoHistory(
        1,
        makeRoutedFetch({
          bitcoin: { ok: false, prices: [] },
          ethereum: { ok: false, prices: [] },
          tether: { ok: false, prices: [] },
        }),
      ),
    ).rejects.toThrow(/CoinGecko/);
  });

  it('references DAY_MS-aligned days in its fixtures', () => {
    expect(d2 - d1).toBe(DAY_MS);
  });
});
```

In `src/rates/history-backfill/history-backfill.test.ts`, rename the injected `fetchBTCHistory` dep to `fetchCryptoHistory` everywhere it appears, and add an assertion that an ETH history entry composes a convertible ETH:UAH history row. (Read the existing file first for the exact fixture shape; keep its NBU fixtures and every existing assertion unchanged, only renaming the crypto dep and adding one ETH-composition assertion.)

- [ ] **Step 2: Run the history tests to confirm they fail**

Run: `npx jest src/rates/coingecko-history/coingecko-history.test.ts src/rates/history-backfill/history-backfill.test.ts`
Expected: FAIL — `fetchCryptoHistory` does not exist; `BackfillDeps` has no `fetchCryptoHistory`; `allCurrencies` and `uahPriceAt` do not price ETH.

- [ ] **Step 3: Generalize `coingecko-history.ts`**

Replace the whole body of `src/rates/coingecko-history/coingecko-history.ts` with a per-coin fetch that unions the fulfilled series and throws only when every coin fails:

```ts
import { guard } from 'fnts';

import { cryptoCoinGeckoId } from '../coingecko-ids';
import { type HistoryRateEntry, toUtcMidnight } from '../history-entry';
import type { Currency } from '../../currency/currency';

/**
 * CoinGecko's `market_chart` returns a full daily price series in ONE call per
 * coin, so a whole crypto backfill span costs one request per coin. Quoted in
 * USD; other crypto pairs are composed downstream from fiat.
 */
const MARKET_CHART_BASE = 'https://api.coingecko.com/api/v3/coins';

// CoinGecko's free/demo tier caps `market_chart` at ~365 days and 401s on a
// longer span, so the request is clamped to this ceiling. A multi-year account
// has no crypto history before the window; the composed series carries the
// earliest available rate backward for those older days.
const MAX_MARKET_CHART_DAYS = 365;

/** The `market_chart` body: `prices` is a `[epochMs, price]` pair per day. */
type MarketChart = { prices: [number, number][] };

const readChart = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`CoinGecko request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<MarketChart> => response.json(),
);

// No `interval` parameter: `interval=daily` is a paid-tier feature that 401s on
// the free key. Omitted, CoinGecko auto-selects the granularity (daily past ~90
// days); any finer intraday points collapse to one entry per day downstream.
const chartUrl = (id: string, days: number): string =>
  `${MARKET_CHART_BASE}/${id}/market_chart?vs_currency=usd&days=${Math.min(days, MAX_MARKET_CHART_DAYS)}`;

/** Fetch and day-normalize one coin's USD series. Throws on a non-ok response. */
const fetchOneCoinHistory = async (
  currency: Currency,
  id: string,
  days: number,
  fetchImpl: typeof fetch,
): Promise<HistoryRateEntry[]> => {
  const response = await fetchImpl(chartUrl(id, days));
  const { prices } = await readChart(response);

  const byDay = new Map<number, number>();
  for (const [ts, price] of prices) {
    if (Number.isFinite(price)) {
      byDay.set(toUtcMidnight(ts), price);
    }
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, rate]) => ({ base: currency, quote: 'USD', day, rate, source: 'coingecko' }));
};

/**
 * Fetch the daily USD price series for the last `days` days for EVERY supported
 * crypto, one `market_chart` request per coin (clamped to the free tier's
 * 365-day ceiling). Coins are settled independently: a single coin's 401 drops
 * only that coin's history, and the function throws only when EVERY coin request
 * fails (so `runBackfill`'s outer `allSettled` keeps the NBU fiat anchors when at
 * least one coin survives). Each `[ts, price]` point is normalized to its UTC day
 * (latest price wins), non-finite prices dropped, entries ascending per coin.
 */
export const fetchCryptoHistory = async (
  days: number,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoryRateEntry[]> => {
  const results = await Promise.allSettled(
    (Object.entries(cryptoCoinGeckoId) as [Currency, string][]).map(([currency, id]) =>
      fetchOneCoinHistory(currency, id, days, fetchImpl),
    ),
  );

  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<HistoryRateEntry[]> => r.status === 'fulfilled',
  );
  if (fulfilled.length === 0 && results.length > 0) {
    throw new Error('CoinGecko history request failed for every coin');
  }

  return fulfilled.flatMap((r) => r.value);
};
```

- [ ] **Step 4: Generalize `history-backfill.ts`**

In `src/rates/history-backfill/history-backfill.ts`:

Update imports (length-sorted) to swap `fetchBTCHistory` for `fetchCryptoHistory` and add the currency source:

```ts
import { rateHistoryRepo } from '@kiko/rates/rate-history-repo';

import type { CurrencyRateHistoryRow } from '../../db/schema';
import { fetchCryptoHistory } from '../coingecko-history';
import { fetchNbuHistory } from '../nbu-history';
import { type HistoryRateEntry, toUtcMidnight } from '../history-entry';
import { type Currency, currencyOptions, isCrypto } from '../../currency/currency';
```

Derive `allCurrencies` from the currency set (the fiat anchors NBU provides plus every crypto), replacing the hardcoded `['BTC', 'USD', 'EUR', 'UAH']`:

```ts
// The fiat anchors NBU quotes (USD/EUR against UAH) plus every crypto, derived
// from currency.ts so a newly added crypto composes chart history automatically.
const allCurrencies: Currency[] = ['USD', 'EUR', 'UAH', ...currencyOptions.filter(isCrypto)];
```

Generalize `pairSource`:

```ts
const pairSource = (base: Currency, quote: Currency): NewHistoryRow['source'] =>
  isCrypto(base) || isCrypto(quote) ? 'coingecko' : 'nbu';
```

Generalize `uahPriceAt` to price every crypto through its USD anchor for the day:

```ts
const uahPriceAt = (timelines: Map<string, HistoryRateEntry[]>, day: number): UahPrice => {
  const price: UahPrice = { UAH: 1 };
  const usd = nearestAtOrBefore(timelines.get('USD:UAH') ?? [], day);
  const eur = nearestAtOrBefore(timelines.get('EUR:UAH') ?? [], day);
  if (usd !== undefined) {
    price.USD = usd;
  }
  if (eur !== undefined) {
    price.EUR = eur;
  }
  if (usd !== undefined) {
    for (const crypto of currencyOptions.filter(isCrypto)) {
      const cryptoUsd = nearestAtOrBefore(timelines.get(`${crypto}:USD`) ?? [], day);
      if (cryptoUsd !== undefined) {
        price[crypto] = cryptoUsd * usd;
      }
    }
  }
  return price;
};
```

Rename the dep field and its default in `BackfillDeps` and `runBackfill`:

```ts
  fetchCryptoHistory?: (days: number) => Promise<HistoryRateEntry[]>;
```

```ts
  const loadCrypto = deps.fetchCryptoHistory ?? ((count) => fetchCryptoHistory(count));
```

and update the `Promise.allSettled` destructuring/comment to use `loadCrypto`:

```ts
  const [nbuResult, cryptoResult] = await Promise.allSettled([
    loadNbu(spanStart, today),
    loadCrypto(cryptoDays),
  ]);
  const nbu = nbuResult.status === 'fulfilled' ? nbuResult.value : [];
  const crypto = cryptoResult.status === 'fulfilled' ? cryptoResult.value : [];

  const rows = composeHistoryRows([...nbu, ...crypto], days);
```

Rename the local `btcDays` variable to `cryptoDays` (its computation is unchanged).

- [ ] **Step 5: Run the history tests to confirm they pass**

Run: `npx jest src/rates/coingecko-history/coingecko-history.test.ts src/rates/history-backfill/history-backfill.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the rates suite and the harness**

Run: `npx jest src/rates` then `npm run check:all`
Expected: PASS. Fix any Knip/dup/typecheck finding at its root.

- [ ] **Step 7: Commit**

```bash
git add src/rates/coingecko-history src/rates/history-backfill
git commit -m "feat(rates): backfill ETH and USDT price history for the net-worth chart"
```

---

## Final verification

- [ ] **Run the whole unit suite**

Run: `npx jest`
Expected: PASS (all suites). Investigate any currency-count or snapshot assertion elsewhere that a two-currency addition disturbs; fix at its root.

- [ ] **Run the deep tier ONCE (before declaring done)**

Run: `npm run check:deep`
Expected: mutation score >= 60 and osv-scanner clean of any NEW CVE (the only pre-existing exit-2 findings are the documented `image-size`/`decode-uri-component` dev-only CVEs — not a regression from this work). Follow `check-deep-no-incremental-output` and `mutation-run-overload-guard`: run it once, detached, await the exit code; never read Stryker progress into context (a background `tail -F` of the progress log for the human is fine).

- [ ] **Hand off to ops for a device build (do NOT run the simulator/Maestro here)**

The screenshot checks are deep/manual/ops-only and NOT part of this plan's gate. For live review, ops rebuilds and deploys to the device per `screenshot-build-recipe` / `device-installs-go-to-ops`; a manual ETH and USDT holding should be created and confirmed to appear in net worth, the per-currency breakdown, statistics, and the historical chart. The coordinator integrates the `next-symbols-placeholders` mark-map track FIRST, then reconciles the ETH/USDT entries in `currency.ts`/`currency-symbols.ts` onto the new text-mark map before this branch integrates.

---

## Self-Review

**Spec coverage (the seven locked work items):**
1. `currency.ts` — ETH/USDT in `currencyOptions`, `cryptoCurrencies`, `currencyScale` (ETH 8, USDT 2, justified), `currencySymbol` (Ξ, ₮): Task 1, Steps 3-4. ✔
2. i18n en/uk names (Tether/Ethereum, hand-authored uk via kiko-translator): Task 1, Step 6. ✔
3. `coingecko.ts` — id map, widened fetch (`ids=bitcoin,ethereum,tether`), keyed guard, one entry per coin: Task 2, Steps 3-6. ✔
4. `coingecko-history.ts` — generalized per-coin, chart wired through `history-backfill`: Task 3. ✔
5. `rates-refresh.ts` — `buildUahPrice`/`pairSource` loop all crypto via `isCrypto` (the crux): Task 2, Step 7, guarded by `crypto-coverage.test.ts`. ✔
6. `schema.ts` enums — TS-only, NO migration (already derive from `currencyOptions`): Task 1, Step 8 (verification, no edit). ✔
7. USDT priced uniformly via `tether` (no 1:1 peg): Task 2, Steps 3, 5; asserted in `coingecko.test.ts` and `crypto-coverage.test.ts` with a ~1.0007 price. ✔

**Build-6 guard:** `crypto-coverage.test.ts` (Task 2, Step 1) proves BTC, ETH, USDT each convert to EVERY base and each yield a positive net-worth total — modeled on `monobank-fiat-coverage.test.ts`. ✔

**Compile-required surface not to miss:** `codeFromCurrency`'s exhaustive `ts-pattern` match (Task 1, Step 5) and the three `Record<Currency, …>` maps (`currencyScale`, `currencySymbol`, `currencySignSymbol`) — all covered. The only exhaustive Currency match in the tree is `codeFromCurrency`; `currencyFromCode` uses `.otherwise()` and needs no arm. ✔

**Type consistency:** `fetchBTCPrice`→`fetchCryptoPrices` and `fetchBTCHistory`→`fetchCryptoHistory` are renamed at every call site (rates-refresh dep + coingecko re-export; history-backfill dep) and in both tests; the `RefreshDeps.fetchCryptoPrices` and `BackfillDeps.fetchCryptoHistory` field names match their producers. `cryptoCoinGeckoId`/`coinGeckoIds`/`cryptoPriceCurrencies` are defined once in `coingecko-ids.ts` and consumed by both CoinGecko modules. ✔

**Scope:** exactly ETH + USDT; no new sync provider; `src/crypto-sync/**` untouched. ✔
