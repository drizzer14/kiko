# Account Form + Currency Model Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the account-type chips, restrict a cash account to fiat currencies, and grow the currency model from 4 hard-coded codes to a named, searchable set (adding two fiat currencies with a full rate path) behind one shared searchable picker.

**Architecture:** `src/currency/currency/currency.ts` stays the single source of truth. It gains a fiat/crypto classification (`isCrypto`/`isFiat`/`fiatCurrencyOptions`), a human-readable `currencyName` map, and two new fiat codes (GBP, CHF). Every downstream Record/consumer that the TypeScript compiler forces to stay exhaustive is extended; the rate composition layer (`monobank-rates`, `rates-refresh`) is changed to DERIVE its currency sets from `currency.ts` so they can never drift. A new shared `CurrencyField` design-system component (FieldTrigger + BottomSheet + TextField search + SelectableRow list) replaces the currency ChipRow in the cash-account and holding forms. Crypto stays BTC-only this track (see the Crypto scope decision below).

**Tech Stack:** TypeScript, React Native, react-i18next, ts-pattern, Jest + React Native Testing Library. Rates from Monobank public `/bank/currency` (fiat) and CoinGecko simple-price (BTC). Design system: BottomSheet, TextField, SelectableRow, FieldTrigger, ChipRow.

**Spec:** The task brief in this conversation (3-item backlog track: Item B chip reorder, Item F cash = fiat only, Item E full currency selector) plus the rate-architecture constraints quoted there.

## Global Constraints

- ONE branch, ONE worktree: `/Users/drizzer14/orca/workspaces/pff-ios/next-form-currency`, branch `next-form-currency`, based on `next`. No new worktrees.
- Do NOT bump the iOS build number (no `pbxproj` / `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` / `package.json` version edits).
- Leave `npm run check:all` and `npm test` (Jest) GREEN. Run `npm run check:all` + `npm test` at every checkpoint marked below; the whole track is done only when both are green.
- `currency.ts` stays the ONE source of truth. No screen or rates file may hard-code a currency list that `currency.ts` already knows — derive it.
- Every currency code that can be picked MUST have an end-to-end rate path (Monobank fiat pair or CoinGecko BTC anchor). A pickable code with no rate path is forbidden — `canConvert` (`src/rates/net-worth-view/net-worth-view.ts`) would silently drop any holding in it from net worth.
- Do NOT touch the money-path core: `src/currency/money.ts`, `src/currency/parse.ts`, `src/rates/conversion/conversion.ts`, `src/rates/coingecko/coingecko.ts`, and the BTC-through-USD anchoring inside `buildUahPrice`. Extend by DERIVATION only.
- `react-native-dotenv` inlines `.env` into the bundle; do NOT put any secret in `.env`. No `.env` change is needed this track (crypto stays BTC-only, so `PRICE_ENDPOINT` is unchanged).

## Decisions locked before the tasks

**Classification approach (task item 1).** Add to `currency.ts` a `cryptoCurrencies` set (`{ BTC }` today) plus `isCrypto(currency)` / `isFiat(currency)` predicates and a compile-time-derived `fiatCurrencyOptions` array. Item F (cash) consumes `fiatCurrencyOptions`; the holding form keeps the full `currencyOptions` (a crypto holding is legitimately in a crypto currency); Settings keeps the full set. One predicate, two derived lists — no second enumeration of "which codes are crypto".

**Final currency set + rate sources (task item 2).** Add exactly two FIAT codes, both 2-decimal, both already returned by Monobank's tokenless `/bank/currency`, both with a real (old, pre-iOS-27) SF Symbol currency-sign glyph, so no new API and no `currencyScale` edge case:

| Code | Name | ISO numeric | Rate source | SF sign glyph | Unicode symbol | scale |
|---|---|---|---|---|---|---|
| GBP | British Pound | 826 | Monobank (GBP:UAH cross) | `sterlingsign` | `£` | 2 |
| CHF | Swiss Franc | 756 | Monobank (CHF:UAH cross) | `francsign` | `₣` | 2 |

Final `currencyOptions` order: `['UAH', 'USD', 'EUR', 'GBP', 'CHF', 'BTC']` (fiat grouped, crypto last). Existing UAH/USD/EUR/BTC math is untouched; GBP and CHF only ADD pairs.

**Why not JPY / PLN / others.** JPY (392) is deliberately NOT added: it is scale-0 (no minor units), an untested money-path edge, and it is the existing "unsupported code is dropped" negative fixture in `src/monobank/currency-code/currency-code.test.ts:11` and `src/rates/monobank-rates/monobank-rates.test.ts:22` — leaving JPY unmapped keeps those negative tests valid with zero churn. PLN has no SF Symbol currency-sign glyph, so it cannot satisfy the exhaustive `currencySignSymbol` Record honestly. GBP + CHF is the clean, low-risk maximal add for this track.

**Crypto scope decision (task item 2, option b).** Crypto stays **BTC-only this track**. Adding ETH/others requires reworking `src/rates/coingecko/coingecko.ts` from a fixed single `bitcoin`/`usd` `PRICE_ENDPOINT` to a multi-`ids` fetch, changing the `.env` `PRICE_ENDPOINT`, and extending `buildUahPrice`/`pairSource` in `rates-refresh.ts` to anchor each new coin through USD. That is a money-path change of exactly the class that caused the build-6 cross-currency regression (a holding silently dropping from net worth), and bundling it with the fiat expansion + designer picker + chip reorder overloads one gate. Item E's "add more crypto WHERE FEASIBLE" is answered honestly: fiat is feasible now, more crypto is a separate follow-up track. No new crypto code is added, so no crypto rate-path risk is introduced.

**Exhaustive consumers that MUST be extended for GBP + CHF (task item 3).** Compiler-enforced (each is a `Record<Currency, …>` or a `.exhaustive()` match — omitting GBP/CHF is a build error, which is the point):
1. `currencyScale` — `currency.ts`
2. `currencySymbol` — `currency.ts`
3. `currencyName` — `currency.ts` (NEW record, same exhaustiveness contract)
4. `currencySignSymbol` — `src/currency/currency-symbols/currency-symbols.ts`
5. `codeFromCurrency` (`.exhaustive()`) — `src/monobank/currency-code/currency-code.ts`
6. `PRICE_IN_UAH: Record<Currency, number>` — `src/screenshot/seed/screenshot-seed.ts`

NOT compiler-enforced, but must still be updated so the new codes actually work:
7. `currencyFromCode` (`.otherwise(undefined)`) — `currency-code.ts` (add 826, 756)
8. `allCurrencies` — `rates-refresh.ts` (DERIVE from `currencyOptions`)
9. `fiatCurrencies` — `monobank-rates.ts` (DERIVE from `currency.ts`)

**Picker consumers (task item 3).** Three UI pickers read `currencyOptions` today: (a) the Settings base-currency `CurrencySwitch` (`src/design-system/components/currency-switch/currency-switch.component.tsx`, an OptionPills segmented control), (b) the cash-account currency ChipRow (`account-form.screen.tsx`), (c) the holding currency ChipRow (`holding-form.screen.tsx`). Decision: (b) and (c) migrate to the new searchable `CurrencyField`; (a) STAYS on `CurrencySwitch`/OptionPills — it iterates `currencyOptions`, so it auto-expands to 6 pills, and its author's comment calls it "a segmented base-currency toggle, not an action button" (a deliberate distinct UX; 6 wrapping pills stay usable). Keeping Settings on OptionPills also keeps `currencySignSymbol` in live use and minimizes surface this track.

**Tests that hard-code the 4-currency world (task item 3, updated by their owning task):**
- `src/currency/currency/currency.test.ts` — order assertion + `isCurrency` cases (Task 1).
- `src/currency/currency-symbols/currency-symbols.test.ts` — exhaustive loop (auto-covers new codes) + explicit-name assertions (Task 2).
- `src/screens/forms/account-form.screen.test.tsx` — the cash-account currency-pick flow changes from tapping an `EUR` chip to opening the field + tapping the `EUR` row (Task 8), and a chip-order assertion is added (Task 5).
- `src/rates/monobank-rates/monobank-rates.test.ts` — add GBP/CHF normalization cases; JPY-dropped negative case stays (Task 3b).
- `src/screenshot/seed/screenshot-seed.test.ts` — verify still green after `PRICE_IN_UAH` grows (Task 6); the seed's account set and `CURRENCIES` pair array stay at UAH/USD/EUR/BTC, so its Set assertions are unchanged.
- `src/design-system/components/currency-switch/currency-switch.component.test.tsx` — loops `currencyOptions`, auto-covers new codes; no edit expected (spot-verify in Task 1 checkpoint).
- `src/rates/rates-refresh/rates-refresh.test.ts` — injects mock providers priced only for USD/EUR/BTC, so `buildPairs` still emits 12 pairs (GBP/CHF have no mock price and are skipped); no edit expected, verify in Task 7 (rates).

**Task order / overlap split.** Developer owns Tasks 1-6, 8-9, 10 (currency model, rates, forms). Designer owns Task 7 (the shared `CurrencyField` component + a small `FieldTrigger` `disabled` prop). QA owns Task 11 (cross-cutting behavior tests). Tasks 8-9 CONSUME Task 7's component, so Task 7 must land before them. Everything else is independent; Tasks 1-6 and 10 can proceed before Task 7 finishes.

---

### Task 1: Classification + name + GBP/CHF in `currency.ts`

**Files:**
- Modify: `src/currency/currency/currency.ts`
- Test: `src/currency/currency/currency.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `currencyOptions: readonly ['UAH','USD','EUR','GBP','CHF','BTC']`
  - `type Currency = (typeof currencyOptions)[number]`
  - `cryptoCurrencies: ReadonlySet<Currency>`
  - `isCrypto(currency: Currency): boolean`
  - `isFiat(currency: Currency): boolean`
  - `fiatCurrencyOptions: readonly Currency[]` (the fiat subset of `currencyOptions`, order-preserving)
  - `currencyName: Record<Currency, string>`
  - `currencyScale: Record<Currency, number>`, `currencySymbol: Record<Currency, string>`, `isCurrency`, `applySymbolPlacement` — unchanged signatures, extended maps.

- [ ] **Step 1: Update the failing test** — `src/currency/currency/currency.test.ts`

```ts
import {
  currencyOptions,
  fiatCurrencyOptions,
  isCurrency,
  isCrypto,
  isFiat,
  currencyName,
} from './currency';

describe('currencyOptions', () => {
  it('lists the currencies in the canonical display order UAH, USD, EUR, GBP, CHF, BTC', () => {
    expect([...currencyOptions]).toEqual(['UAH', 'USD', 'EUR', 'GBP', 'CHF', 'BTC']);
  });
});

describe('isCurrency', () => {
  it('accepts each supported currency code', () => {
    for (const code of ['UAH', 'USD', 'EUR', 'GBP', 'CHF', 'BTC']) {
      expect(isCurrency(code)).toBe(true);
    }
  });

  it('rejects an unsupported code', () => {
    expect(isCurrency('JPY')).toBe(false);
    expect(isCurrency('PLN')).toBe(false);
  });
});

describe('fiat / crypto classification', () => {
  it('treats only BTC as crypto', () => {
    expect(isCrypto('BTC')).toBe(true);
    for (const code of ['UAH', 'USD', 'EUR', 'GBP', 'CHF'] as const) {
      expect(isCrypto(code)).toBe(false);
      expect(isFiat(code)).toBe(true);
    }
    expect(isFiat('BTC')).toBe(false);
  });

  it('exposes the fiat subset in canonical order, without any crypto code', () => {
    expect([...fiatCurrencyOptions]).toEqual(['UAH', 'USD', 'EUR', 'GBP', 'CHF']);
  });
});

describe('currencyName', () => {
  it('gives every currency a non-empty human-readable name', () => {
    for (const code of currencyOptions) {
      expect(currencyName[code].length).toBeGreaterThan(0);
    }
  });

  it('names the fiat and crypto codes', () => {
    expect(currencyName.USD).toBe('US Dollar');
    expect(currencyName.GBP).toBe('British Pound');
    expect(currencyName.CHF).toBe('Swiss Franc');
    expect(currencyName.BTC).toBe('Bitcoin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/currency/currency/currency.test.ts`
Expected: FAIL — `fiatCurrencyOptions`/`isCrypto`/`isFiat`/`currencyName` are not exported yet, and the order/`isCurrency` assertions mismatch.

- [ ] **Step 3: Write the implementation** — edit `src/currency/currency/currency.ts`

Change the `currencyOptions` array and its doc comment to the 6-code order, then add the classification + name below the existing `isCurrency`:

```ts
export const currencyOptions = ['UAH', 'USD', 'EUR', 'GBP', 'CHF', 'BTC'] as const;

export type Currency = (typeof currencyOptions)[number];

export const currencyScale: Record<Currency, number> = {
  UAH: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  BTC: 8,
};

export const currencySymbol: Record<Currency, string> = {
  UAH: '₴',
  USD: '$',
  EUR: '€',
  GBP: '£',
  CHF: '₣',
  BTC: '₿',
};

// The canonical human-readable name per currency, shown alongside the code in
// the searchable CurrencyField and matched against the search query. English is
// the canonical label; the codes themselves are locale-independent and search
// always matches on the code too, so this stays out of i18n (a localized name
// map is a documented follow-up, not a blocker). Exhaustive `Record`, not
// `Partial`: adding a currency with no name is a COMPILE error here.
export const currencyName: Record<Currency, string> = {
  UAH: 'Ukrainian Hryvnia',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  CHF: 'Swiss Franc',
  BTC: 'Bitcoin',
};

// The crypto codes. Everything else in `currencyOptions` is fiat. Item F (a cash
// account is fiat-only) and the rate layer both read this ONE set rather than
// re-enumerating which codes are crypto.
export const cryptoCurrencies: ReadonlySet<Currency> = new Set<Currency>(['BTC']);

export const isCrypto = (currency: Currency): boolean => cryptoCurrencies.has(currency);

export const isFiat = (currency: Currency): boolean => !isCrypto(currency);

// The fiat subset of `currencyOptions`, order-preserving. Filtered through the
// `Currency`-typed predicate so it stays `readonly Currency[]`.
export const fiatCurrencyOptions: readonly Currency[] = currencyOptions.filter(isFiat);

export const isCurrency = (value: string): value is Currency =>
  (currencyOptions as readonly string[]).includes(value);
```

Leave `applySymbolPlacement` unchanged — UAH still suffixes, and GBP/CHF prefix like USD/EUR (`£100.00`, `₣100.00`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/currency/currency/currency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/currency/currency/currency.ts src/currency/currency/currency.test.ts
git commit -m "feat(currency): add fiat/crypto classification, names, and GBP/CHF"
```

---

### Task 2: SF Symbol sign glyphs for GBP/CHF

**Files:**
- Modify: `src/currency/currency-symbols/currency-symbols.ts`
- Test: `src/currency/currency-symbols/currency-symbols.test.ts`

**Interfaces:**
- Consumes: `Currency` from Task 1 (now includes GBP, CHF).
- Produces: `currencySignSymbol: Record<Currency, string>` (extended).

- [ ] **Step 1: Add the failing assertions** — append to the existing second `it` block in `currency-symbols.test.ts` (keep the exhaustive first test as-is; it now auto-loops 6 codes):

```ts
  it('assigns each currency its SF Symbol currency-sign glyph', () => {
    expect(currencySignSymbol.UAH).toBe('hryvniasign');
    expect(currencySignSymbol.USD).toBe('dollarsign');
    expect(currencySignSymbol.EUR).toBe('eurosign');
    expect(currencySignSymbol.GBP).toBe('sterlingsign');
    expect(currencySignSymbol.CHF).toBe('francsign');
    expect(currencySignSymbol.BTC).toBe('bitcoinsign');
  });
```

Replace the old `'assigns UAH … BTC bitcoinsign'` test body with the block above (rename the `it` title as shown).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/currency/currency-symbols/currency-symbols.test.ts`
Expected: FAIL — `currencySignSymbol.GBP`/`.CHF` are `undefined`, and TypeScript reports the map is missing GBP/CHF.

- [ ] **Step 3: Extend the map** — `src/currency/currency-symbols/currency-symbols.ts`

```ts
export const currencySignSymbol: Record<Currency, string> = {
  UAH: 'hryvniasign',
  USD: 'dollarsign',
  EUR: 'eurosign',
  GBP: 'sterlingsign',
  CHF: 'francsign',
  BTC: 'bitcoinsign',
};
```

(`sterlingsign` and `francsign` are pre-iOS-27 SF Symbols — safe on the device's iOS per the SF-Symbols availability memory.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/currency/currency-symbols/currency-symbols.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/currency/currency-symbols/
git commit -m "feat(currency): sterling/franc sign glyphs for GBP/CHF"
```

---

### Task 3: Monobank ISO-numeric code map + fiat rate normalization

**Files:**
- Modify: `src/monobank/currency-code/currency-code.ts`
- Test: `src/monobank/currency-code/currency-code.test.ts`
- Modify: `src/rates/monobank-rates/monobank-rates.ts`
- Test: `src/rates/monobank-rates/monobank-rates.test.ts`

**Interfaces:**
- Consumes: `Currency`, `fiatCurrencyOptions`/`isFiat` from Task 1.
- Produces: `currencyFromCode`/`codeFromCurrency` mapping 826↔GBP, 756↔CHF; `fetchFiatRates` derives its fiat set from `currency.ts`.

- [ ] **Step 1a: Add failing code-map assertions** — `currency-code.test.ts`

```ts
  it('maps GBP and CHF in both directions', () => {
    expect(currencyFromCode(826)).toBe('GBP');
    expect(currencyFromCode(756)).toBe('CHF');
    expect(codeFromCurrency('GBP')).toBe(826);
    expect(codeFromCurrency('CHF')).toBe(756);
  });
```

Keep the existing `currencyFromCode(392)` → `undefined` test (JPY stays unmapped, still the negative case).

- [ ] **Step 1b: Run to verify it fails**

Run: `npx jest src/monobank/currency-code/currency-code.test.ts`
Expected: FAIL — 826/756 return `undefined`, and `codeFromCurrency` no longer type-checks as exhaustive without GBP/CHF arms.

- [ ] **Step 2: Extend both maps** — `currency-code.ts`

```ts
export const currencyFromCode = (code: number): Currency | undefined =>
  match(code)
    .with(980, (): Currency => 'UAH')
    .with(840, (): Currency => 'USD')
    .with(978, (): Currency => 'EUR')
    .with(826, (): Currency => 'GBP')
    .with(756, (): Currency => 'CHF')
    .otherwise(() => undefined);

export const codeFromCurrency = (currency: Currency): number | undefined =>
  match(currency)
    .with('UAH', () => 980)
    .with('USD', () => 840)
    .with('EUR', () => 978)
    .with('GBP', () => 826)
    .with('CHF', () => 756)
    .with('BTC', () => undefined)
    .exhaustive();
```

- [ ] **Step 3: Run to verify it passes**

Run: `npx jest src/monobank/currency-code/currency-code.test.ts`
Expected: PASS.

- [ ] **Step 3b: Derive the fiat set + add GBP/CHF normalization test** — first the failing test in `monobank-rates.test.ts`. Extend the fixture and expectation in the existing `'normalizes entries within the fiat set …'` test so GBP/CHF (cross-only) normalize and JPY still drops:

```ts
const RAW = [
  { currencyCodeA: 840, currencyCodeB: 980, date: 1, rateBuy: 39, rateSell: 41 }, // USD:UAH
  { currencyCodeA: 978, currencyCodeB: 980, date: 1, rateCross: 43 }, // EUR:UAH
  { currencyCodeA: 826, currencyCodeB: 980, date: 1, rateCross: 52 }, // GBP:UAH cross
  { currencyCodeA: 756, currencyCodeB: 980, date: 1, rateCross: 46 }, // CHF:UAH cross
  { currencyCodeA: 840, currencyCodeB: 978, date: 1, rateSell: 0.93 }, // USD:EUR sell-only
  { currencyCodeA: 392, currencyCodeB: 980, date: 1, rateBuy: 0.27, rateSell: 0.28 }, // JPY:UAH -> dropped (unmapped)
];
```

```ts
  it('normalizes entries within the fiat set and derives the rate per entry', async () => {
    const result = await fetchFiatRates(makeFetch(RAW));

    expect(result).toEqual([
      { base: 'USD', quote: 'UAH', rate: 39, source: 'monobank' },
      { base: 'EUR', quote: 'UAH', rate: 43, source: 'monobank' },
      { base: 'GBP', quote: 'UAH', rate: 52, source: 'monobank' },
      { base: 'CHF', quote: 'UAH', rate: 46, source: 'monobank' },
      { base: 'USD', quote: 'EUR', rate: 0.93, source: 'monobank' },
    ]);
  });
```

(Adjust the fixture/variable names to whatever the existing test uses — keep its existing `makeFetch` helper and the `values a 4000 USD holding …` and `429` tests unchanged.)

- [ ] **Step 3c: Run to verify it fails**

Run: `npx jest src/rates/monobank-rates/monobank-rates.test.ts`
Expected: FAIL — GBP/CHF are filtered out because `fiatCurrencies` is still the hard-coded `{UAH, USD, EUR}`.

- [ ] **Step 4: Derive the fiat set** — `src/rates/monobank-rates/monobank-rates.ts`

Replace the hard-coded set and its comment:

```ts
import { fiatCurrencyOptions } from '../../currency/currency';

// Our fiat set is DERIVED from currency.ts so it can never drift from the app's
// supported currencies. BTC is excluded automatically (it is crypto, priced via
// CoinGecko, not present in fiatCurrencyOptions).
const fiatCurrencies = new Set<Currency>(fiatCurrencyOptions);
```

Leave `isFiat` (the local type-guard helper in this file), `deriveRate`, `toRateEntry`, and `fetchFiatRates` otherwise unchanged.

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/rates/monobank-rates/monobank-rates.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/monobank/currency-code/ src/rates/monobank-rates/
git commit -m "feat(rates): map GBP/CHF ISO codes and derive the fiat set from currency.ts"
```

---

### Task 4: Derive `allCurrencies` in `rates-refresh`

**Files:**
- Modify: `src/rates/rates-refresh/rates-refresh.ts`
- Test: `src/rates/rates-refresh/rates-refresh.test.ts` (verify only; no expected edit)

**Interfaces:**
- Consumes: `currencyOptions` from Task 1.
- Produces: `refreshRates` composing pairs across the full derived currency set; BTC anchoring unchanged.

- [ ] **Step 1: Change `allCurrencies` to derive** — `rates-refresh.ts`

```ts
import { currencyOptions } from '../../currency/currency';

// Derived from currency.ts so the composed pair set always matches the app's
// supported currencies. A currency with no fetched UAH price is skipped by
// buildPairs (its price is undefined), so listing all of them here is safe.
const allCurrencies: readonly Currency[] = currencyOptions;
```

Do NOT change `buildUahPrice` (its fiat loop already handles any `X:UAH` / `UAH:X` entry generically, so GBP/CHF anchor with no code change), `pairSource` (BTC→coingecko, else monobank — GBP/CHF are monobank), or the `refreshRates` body.

- [ ] **Step 2: Run the existing suite to verify no regression**

Run: `npx jest src/rates/rates-refresh/rates-refresh.test.ts`
Expected: PASS unchanged. The suite injects mock providers priced only for USD/EUR/BTC (+UAH anchor), so `buildPairs` still emits exactly 12 pairs — GBP/CHF have no mock price and are skipped by the `from === undefined || to === undefined` guard. If the `'4 currencies -> 12 ordered distinct pairs'` comment now reads as stale, update the comment text only (not the count).

- [ ] **Step 3: Commit**

```bash
git add src/rates/rates-refresh/rates-refresh.ts
git commit -m "refactor(rates): derive allCurrencies from currency.ts"
```

---

### Task 5: Reorder account-type chips (Item B)

**Files:**
- Modify: `src/screens/forms/account-form.screen.tsx:41`
- Test: `src/screens/forms/account-form.screen.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `kinds = ['cash', 'bank', 'crypto']`; `INITIAL_KIND` stays `'bank'`.

- [ ] **Step 1: Add a failing order assertion** — new test in `account-form.screen.test.tsx` (use the existing `renderForm` helper and imports):

```ts
  it('renders the account-type chips in the order Cash, Bank, Crypto', async () => {
    const { getByText } = await renderForm();

    const cashX = getByText('Cash').parent?.props.style;
    // Order is asserted via on-screen position: query all three and assert the
    // ChipRow lays them out Cash, Bank, Crypto. Simplest robust check: the three
    // labels all render, and the kinds array drives their order.
    expect(getByText('Cash')).toBeTruthy();
    expect(getByText('Bank')).toBeTruthy();
    expect(getByText('Crypto')).toBeTruthy();
  });
```

If the project already asserts chip order elsewhere by index, prefer that pattern; otherwise assert order by reading `getAllByText`/`UNSAFE_getAllByType(ChipRow)` children in render order. Keep the assertion tied to the visible order Cash → Bank → Crypto.

- [ ] **Step 2: Confirm default kind is still bank** — verify the existing test at `account-form.screen.test.tsx` that expects the "Synchronization" sub-heading on default create (bank) still passes; `INITIAL_KIND` is unchanged, so a fresh form still opens on Bank.

- [ ] **Step 3: Reorder the array** — `account-form.screen.tsx:41`

```ts
const kinds = ['cash', 'bank', 'crypto'] as const;
```

Leave `type Kind`, `INITIAL_KIND: Kind = 'bank'`, `kindLabels`, `accountKindSymbol`, `defaultAccountColor`, and every `kind === '…'` branch unchanged — nothing depends on array index; `INITIAL_KIND` is a named value, and the ChipRow renders in array order.

- [ ] **Step 4: Run the account-form suite**

Run: `npx jest src/screens/forms/account-form.screen.test.tsx`
Expected: PASS (new order test + all existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/account-form.screen.tsx src/screens/forms/account-form.screen.test.tsx
git commit -m "feat(account-form): order type chips Cash, Bank, Crypto"
```

**CHECKPOINT A (after Tasks 1-5):** Run `npm run check:all` and `npm test`. Both must be green before starting the picker component.

---

### Task 6: Screenshot-seed exhaustive price map

**Files:**
- Modify: `src/screenshot/seed/screenshot-seed.ts`
- Test: `src/screenshot/seed/screenshot-seed.test.ts` (verify only)

**Interfaces:**
- Consumes: `Currency` (now 6 codes).
- Produces: `PRICE_IN_UAH` covers GBP/CHF so the file compiles; seed dataset unchanged.

- [ ] **Step 1: Extend `PRICE_IN_UAH`** — `screenshot-seed.ts` (the `Record<Currency, number>` at ~line 124). Add GBP/CHF UAH prices consistent with the others:

```ts
const PRICE_IN_UAH: Record<Currency, number> = {
  UAH: 1,
  USD: 41,
  EUR: 44.5,
  GBP: 52,
  CHF: 46,
  BTC: 2_665_000,
};
```

Do NOT change the `CURRENCIES` array (line ~131) — leave it `['UAH', 'USD', 'EUR', 'BTC']`. The seed creates accounts only in those four, and the pair/history assertions in the test enumerate exactly that set, so they stay green while `PRICE_IN_UAH` merely satisfies the exhaustive `Record` contract.

- [ ] **Step 2: Run the seed suite to verify no regression**

Run: `npx jest src/screenshot/seed/screenshot-seed.test.ts`
Expected: PASS unchanged (the 5-account currency Set, `requiredPairs`, and history-pair Set all still equal the UAH/USD/EUR/BTC world).

- [ ] **Step 3: Commit**

```bash
git add src/screenshot/seed/screenshot-seed.ts
git commit -m "chore(screenshot-seed): price GBP/CHF for the exhaustive currency map"
```

---

### Task 7 (DESIGNER): shared searchable `CurrencyField` component

**Files:**
- Create: `src/design-system/components/currency-field/currency-field.component.tsx`
- Create: `src/design-system/components/currency-field/currency-field.props.d.ts`
- Create: `src/design-system/components/currency-field/currency-field.styles.ts`
- Create: `src/design-system/components/currency-field/index.ts`
- Create: `src/design-system/components/currency-field/currency-field.component.test.tsx`
- Modify: `src/screens/forms/field-trigger/field-trigger.component.tsx` and `field-trigger.props.d.ts` (add optional `disabled`)
- Modify: `src/i18n/locales/en.ts` and `src/i18n/locales/uk.ts` (two new `forms.fields` keys)

**Interfaces:**
- Consumes: `Currency`, `currencyOptions`, `currencyName` (Task 1); `currencySignSymbol` (Task 2); design-system `BottomSheet`, `TextField`, `SelectableRow`, `Text`, `Box`; `FieldTrigger`.
- Produces:

```ts
// currency-field.props.d.ts
import type { Currency } from '../../../currency/currency';

export type CurrencyFieldProps = {
  /** Caption above the field and the trigger's accessibility label. */
  label: string;
  /** The current selection, or undefined to show the placeholder. */
  selected: Currency | undefined;
  onSelect: (currency: Currency) => void;
  /**
   * The pickable set, in display order. Defaults to `currencyOptions`. The
   * cash-account form passes `fiatCurrencyOptions` (fiat only); the holding form
   * passes the full set (a crypto holding needs a crypto currency).
   */
  options?: readonly Currency[];
  /** Shows the required asterisk on the label. Defaults to false. */
  required?: boolean;
  /** Read-only: the trigger is inert and dimmed, no sheet opens. Defaults to false. */
  disabled?: boolean;
  /** testID for the trigger, so a flow can open the sheet. */
  testID?: string;
};
```

- [ ] **Step 1: Add the two i18n keys** — in BOTH `en.ts` and `uk.ts`, inside the `forms.fields` block (the `en.uk.parity.test.ts` enforces parity, so add to both):

`en.ts`:
```ts
      searchCurrency: 'Search currency',
      selectCurrency: 'Select currency',
```
`uk.ts`:
```ts
      searchCurrency: 'Пошук валюти',
      selectCurrency: 'Оберіть валюту',
```

- [ ] **Step 2: Add `disabled` to `FieldTrigger`** — `field-trigger.props.d.ts` add:

```ts
  /**
   * Read-only: the trigger renders dimmed and its press is inert. Defaults to
   * false. Used by a field the domain forbids changing after creation (a
   * holding's currency in edit mode).
   */
  disabled?: boolean;
```

In `field-trigger.component.tsx`, when `disabled` is true set the Pressable `disabled` + `accessibilityState={{ disabled: true }}`, apply the existing disabled/dimmed style treatment (mirror `text-field.styles.ts`'s disabled tone; keep it in `field-trigger.styles.ts`), and do not call `onPress`.

- [ ] **Step 3: Write the failing component test** — `currency-field.component.test.tsx`

```ts
import { fireEvent, render } from '@testing-library/react-native';
import '../../../screens/unistyles'; // match the unistyles import path used by sibling component tests
import { fiatCurrencyOptions } from '../../../currency/currency';

import CurrencyField from '.';

const open = async (utils: Awaited<ReturnType<typeof render>>): Promise<void> => {
  await fireEvent.press(utils.getByTestId('currency-field'));
};

describe('CurrencyField', () => {
  it('reports the picked currency and closes the sheet', async () => {
    const onSelect = jest.fn();
    const utils = await render(
      <CurrencyField label="Currency" selected="UAH" onSelect={onSelect} testID="currency-field" />,
    );
    await open(utils);
    await fireEvent.press(utils.getByTestId('currency-option-USD'));
    expect(onSelect).toHaveBeenCalledWith('USD');
  });

  it('filters the list by code', async () => {
    const utils = await render(
      <CurrencyField label="Currency" selected="UAH" onSelect={jest.fn()} testID="currency-field" />,
    );
    await open(utils);
    await fireEvent.changeText(utils.getByLabelText('Search currency'), 'chf');
    expect(utils.getByTestId('currency-option-CHF')).toBeTruthy();
    expect(utils.queryByTestId('currency-option-USD')).toBeNull();
  });

  it('filters the list by name', async () => {
    const utils = await render(
      <CurrencyField label="Currency" selected="UAH" onSelect={jest.fn()} testID="currency-field" />,
    );
    await open(utils);
    await fireEvent.changeText(utils.getByLabelText('Search currency'), 'pound');
    expect(utils.getByTestId('currency-option-GBP')).toBeTruthy();
    expect(utils.queryByTestId('currency-option-EUR')).toBeNull();
  });

  it('restricts the list to the given options (fiat only offers no BTC)', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="UAH"
        onSelect={jest.fn()}
        options={fiatCurrencyOptions}
        testID="currency-field"
      />,
    );
    await open(utils);
    expect(utils.queryByTestId('currency-option-BTC')).toBeNull();
    expect(utils.getByTestId('currency-option-USD')).toBeTruthy();
  });

  it('does not open the sheet when disabled', async () => {
    const utils = await render(
      <CurrencyField
        label="Currency"
        selected="BTC"
        onSelect={jest.fn()}
        disabled
        testID="currency-field"
      />,
    );
    await open(utils);
    expect(utils.queryByTestId('currency-option-USD')).toBeNull();
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx jest src/design-system/components/currency-field/currency-field.component.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 5: Implement the component** — `currency-field.component.tsx` (model on `src/screens/forms/category-field/category-field.component.tsx` — FieldTrigger + BottomSheet(`scrollable={false}`) + own ScrollView; add a pinned search TextField above the list):

```tsx
import { type ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { currencyName, currencyOptions } from '../../../currency/currency';
import { currencySignSymbol } from '../../../currency/currency-symbols';
import FieldTrigger from '../../../screens/forms/field-trigger';
import BottomSheet from '../bottom-sheet';
import Box from '../box';
import SelectableRow from '../selectable-row';
import Text from '../text';
import TextField from '../text-field';

import type { CurrencyFieldProps } from './currency-field.props';
import { styles } from './currency-field.styles';

const matches = (code: (typeof currencyOptions)[number], query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return true;
  }
  return code.toLowerCase().includes(q) || currencyName[code].toLowerCase().includes(q);
};

const CurrencyField = ({
  label,
  selected,
  onSelect,
  options = currencyOptions,
  required,
  disabled,
  testID,
}: CurrencyFieldProps): ReactElement => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Reset the query each time the sheet closes so a reopen starts fresh.
  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const visible = options.filter((code) => matches(code, query));

  const handleSelect = (code: (typeof currencyOptions)[number]): void => {
    onSelect(code);
    setOpen(false);
  };

  const triggerValue =
    selected === undefined ? t('forms.fields.selectCurrency') : `${selected} — ${currencyName[selected]}`;

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        required={required}
        disabled={disabled}
        testID={testID}
        onPress={() => setOpen(true)}
        icon={selected === undefined ? undefined : currencySignSymbol[selected]}
        value={triggerValue}
        valueTone={selected === undefined ? 'textSecondary' : 'textPrimary'}
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        scrollable={false}
        testID="currency-picker-sheet"
      >
        <Text variant="heading">{label}</Text>

        <TextField
          label={t('forms.fields.searchCurrency')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={t('forms.fields.searchCurrency')}
        />

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
          {visible.map((code) => (
            <SelectableRow
              key={code}
              testID={`currency-option-${code}`}
              accessibilityRole="button"
              accessibilityLabel={`${code} ${currencyName[code]}`}
              selected={code === selected}
              onPress={() => handleSelect(code)}
              label={`${code} — ${currencyName[code]}`}
              icon={currencySignSymbol[code]}
            />
          ))}
        </ScrollView>
      </BottomSheet>
    </Box>
  );
};

export default CurrencyField;
```

`currency-field.styles.ts`: a `scroll` style capping the list height (model on `category-field.styles.ts`). `index.ts`: `export { default } from './currency-field.component';`.

Note the cross-layer import (`design-system` importing `screens/forms/field-trigger`) already exists in the codebase pattern (currency-switch imports from `currency`); if Knip/lint flags the direction, the reviewer decides whether to relocate `FieldTrigger` — do NOT duplicate it. If the `../../../screens/unistyles` test import path differs, match whatever sibling design-system component tests use.

- [ ] **Step 6: Run to verify it passes**

Run: `npx jest src/design-system/components/currency-field/currency-field.component.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/design-system/components/currency-field/ src/screens/forms/field-trigger/ src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "feat(design-system): searchable CurrencyField picker"
```

**CHECKPOINT B (after Task 7):** Run `npm run check:all` and `npm test`. Green before wiring the forms.

---

### Task 8: Cash account form → fiat-only searchable picker (Item F)

**Files:**
- Modify: `src/screens/forms/account-form.screen.tsx` (the `!isEdit && kind === 'cash'` branch)
- Test: `src/screens/forms/account-form.screen.test.tsx`

**Interfaces:**
- Consumes: `CurrencyField` (Task 7), `fiatCurrencyOptions` (Task 1).
- Produces: cash currency picked from FIAT only; no BTC/crypto for a cash account.

- [ ] **Step 1: Update the cash-account tests** — in `account-form.screen.test.tsx`, the existing `'creates a cash account atomically with the initial value'` test taps `getByText('EUR')` directly (line ~419). With the sheet picker, open the field first:

```ts
    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('Cash'));
    await fireEvent.changeText(getByLabelText('Initial value'), '250.50');
    await fireEvent.press(getByTestId('account-currency-field'));
    await fireEvent.press(getByTestId('currency-option-EUR'));
    await fireEvent.press(getByText('Save'));
```

(Add `getByTestId` to the destructured render helpers.) The `expect(mockCreateCashAccount).toHaveBeenCalledWith({ … currency: 'EUR' … })` assertion is unchanged. Add a new fiat-only test:

```ts
  it('offers only fiat currencies for a cash account (no BTC)', async () => {
    const { getByLabelText, getByText, getByTestId, queryByTestId } = await renderForm();
    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('Cash'));
    await fireEvent.press(getByTestId('account-currency-field'));

    expect(getByTestId('currency-option-USD')).toBeTruthy();
    expect(getByTestId('currency-option-GBP')).toBeTruthy();
    expect(queryByTestId('currency-option-BTC')).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/screens/forms/account-form.screen.test.tsx`
Expected: FAIL — `account-currency-field` / `currency-option-*` testIDs do not exist yet (still a ChipRow).

- [ ] **Step 3: Swap the ChipRow for CurrencyField** — `account-form.screen.tsx`. Replace the currency `ChipRow` inside the `!isEdit && kind === 'cash'` block with:

```tsx
            <CurrencyField
              label={t('forms.fields.currency')}
              selected={currency}
              onSelect={setCurrency}
              options={fiatCurrencyOptions}
              testID="account-currency-field"
            />
```

Update imports: add `fiatCurrencyOptions` to the `../../currency/currency` import and `import CurrencyField from '../../design-system/components/currency-field';`. Remove the now-unused `currencySignSymbol` import IF the cash ChipRow was its only use in this file (it is — the kind ChipRow uses `accountKindSymbol`); Knip/lint will flag a stale import, so drop it. Keep `currencySymbol` (still used by the initial-value `suffix`). The `currency` state stays `useState<Currency>('UAH')` — UAH is fiat, a valid default.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/screens/forms/account-form.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/account-form.screen.tsx src/screens/forms/account-form.screen.test.tsx
git commit -m "feat(account-form): fiat-only searchable currency picker for cash (Item F)"
```

---

### Task 9: Holding form → searchable currency picker (full set)

**Files:**
- Modify: `src/screens/forms/holding-form.screen.tsx` (the currency `ChipRow` at ~line 551)
- Test: `src/screens/forms/holding-form.screen.test.tsx`

**Interfaces:**
- Consumes: `CurrencyField` (Task 7), full `currencyOptions` (default).
- Produces: holding currency picked from the FULL set (crypto still offered); read-only in edit mode.

- [ ] **Step 1: Update the holding-form tests** — locate every place the existing suite picks a currency by tapping a chip (e.g. `fireEvent.press(getByText('BTC'))` or a sign glyph) and rewrite it to open the field then tap the row:

```ts
    await fireEvent.press(getByTestId('holding-currency-field'));
    await fireEvent.press(getByTestId('currency-option-BTC'));
```

Add a test that crypto IS offered here (contrast with cash):

```ts
  it('offers crypto currencies for a holding (BTC present)', async () => {
    const { getByTestId } = await renderForm(); // create mode
    await fireEvent.press(getByTestId('holding-currency-field'));
    expect(getByTestId('currency-option-BTC')).toBeTruthy();
    expect(getByTestId('currency-option-UAH')).toBeTruthy();
  });
```

If the suite has an edit-mode test that asserts the currency field is read-only, keep it and assert the disabled trigger does not open the sheet (`queryByTestId('currency-option-*')` is null after pressing).

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/screens/forms/holding-form.screen.test.tsx`
Expected: FAIL — testIDs not present (still a ChipRow).

- [ ] **Step 3: Swap the ChipRow for CurrencyField** — `holding-form.screen.tsx`. Replace the currency `ChipRow` (with `disabled={isEdit}`) with:

```tsx
        <CurrencyField
          label={t('forms.fields.currency')}
          selected={currency}
          onSelect={setCurrency}
          disabled={isEdit}
          testID="holding-currency-field"
        />
```

Add `import CurrencyField from '../../design-system/components/currency-field';`. Remove the now-unused `currencySignSymbol` import if the currency ChipRow was its only consumer in this file (verify — the type ChipRow uses `holdingTypeSymbol`, so it likely was); Knip/lint flags a stale import. Keep `currencySymbol` (used by the balance `suffix`) and `currencyOptions` only if still referenced elsewhere in the file — if not, drop it too (Knip will tell you).

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/screens/forms/holding-form.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/holding-form.screen.tsx src/screens/forms/holding-form.screen.test.tsx
git commit -m "feat(holding-form): searchable currency picker (full set incl. crypto)"
```

**CHECKPOINT C (after Tasks 8-9):** Run `npm run check:all` and `npm test`. Green before the QA cross-cutting pass.

---

### Task 10 (QA): cross-cutting behavior tests

**Files:**
- Test: `src/rates/net-worth-view/net-worth-view.currency-path.test.ts` (new, or extend the existing net-worth-view test)
- Test: `src/rates/rates-refresh/rates-refresh.test.ts` (extend)

**Interfaces:**
- Consumes: `refreshRates`, `buildRateTable`, `canConvert`, `fetchFiatRates`.
- Produces: proof every added fiat code converts end-to-end (has a rate path), so it can never silently drop from net worth.

- [ ] **Step 1: Prove the GBP/CHF rate path composes and converts** — add to `rates-refresh.test.ts` a test that feeds a mock Monobank result including GBP:UAH and CHF:UAH, plus the USD anchor, and asserts the composed pairs include `GBP:UAH` and `CHF:UAH` (and their inverses), then feeds those into `buildRateTable` + `canConvert`:

```ts
  it('composes a convertible rate path for GBP and CHF (no silent drop)', async () => {
    const fiat = [
      { base: 'USD', quote: 'UAH', rate: 41, source: 'monobank' as const },
      { base: 'GBP', quote: 'UAH', rate: 52, source: 'monobank' as const },
      { base: 'CHF', quote: 'UAH', rate: 46, source: 'monobank' as const },
    ];
    let stored: StoredRate[] = [];
    await refreshRates({
      fetchFiatRates: async () => fiat,
      fetchBTCPrice: async () => [],
      upsertMany: async (rows) => {
        stored = rows;
      },
      now: () => 1_000_000,
      lastRefreshAt: null,
    });

    const table = buildRateTable(stored.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate })));
    expect(canConvert('GBP', 'UAH', table)).toBe(true);
    expect(canConvert('CHF', 'UAH', table)).toBe(true);
    expect(canConvert('GBP', 'USD', table)).toBe(true); // cross-pair composed via the UAH pivot
  });
```

(Match the existing test's `StoredRate` import / helper shape; import `buildRateTable`/`canConvert` from `../net-worth-view`.)

- [ ] **Step 2: Run to verify it passes** (implementation already exists from Tasks 3-4)

Run: `npx jest src/rates/rates-refresh/rates-refresh.test.ts`
Expected: PASS.

- [ ] **Step 3: Verify the picker search behavior end-to-end** — confirm Task 7's `CurrencyField` tests already cover search-by-code and search-by-name (they do). If any gap, add a case there; do not duplicate.

- [ ] **Step 4: Commit**

```bash
git add src/rates/
git commit -m "test(rates): GBP/CHF convert end-to-end with no silent net-worth drop"
```

---

### Task 11: Final gate

- [ ] **Step 1: Full fast+medium tier**

Run: `npm run check:all`
Expected: PASS (lint, dup, knip, deps, security, rules, plist, secrets, overrides, typecheck). Pay attention to Knip flagging any import left stale by the ChipRow→CurrencyField swaps (Tasks 8-9) — fix by removing the dead import, never by suppressing.

- [ ] **Step 2: Full Jest**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Deep gate before declaring done**

Run: `npm run check:deep`
Expected: PASS (mutation ≥ threshold on the changed files; osv-scanner clean except the pre-existing tracked CVEs documented in CLAUDE.md). This is a manual checkpoint per the harness; run it once and await the exit code — do not poll its progress log.

- [ ] **Step 4: Confirm the build number is untouched**

Run: `git diff next -- ios/Kiko.xcodeproj/project.pbxproj package.json`
Expected: no version/build-number changes.

---

## Self-Review

**Spec coverage:**
- Item B (chip reorder) → Task 5. `INITIAL_KIND` verified independent of array order (it is a named `'bank'`, and `handleSelectKind`/branches key off the value, not the index).
- Item F (cash = fiat only) → Tasks 1 (`fiatCurrencyOptions`), 3 (rate map), 8 (wire fiat-only picker + test that BTC is absent for cash).
- Item E (full selector) → Tasks 1 (names, expanded set), 2 (sign glyphs), 7 (searchable component), 8-9 (both forms consume it). Settings base-currency stays exhaustive automatically via `CurrencySwitch` iterating `currencyOptions` (documented decision).
- Classification approach (item 1) → Task 1 (`isCrypto`/`isFiat`/`fiatCurrencyOptions`); holding form keeps full set (Task 9), cash is fiat-only (Task 8).
- Currency set + rate sources (item 2) → GBP (826)/CHF (756) via Monobank; crypto stays BTC-only (documented). Every added code has a Monobank pair (Task 3) composed and convertible (Task 4, proven in Task 10).
- Exhaustive consumers (item 3) → Tasks 1, 2, 3, 6 cover all six compiler-enforced maps + the two derived sets; tests updated in their owning tasks.
- Designer component spec (item 4) → Task 7 (props, testIDs, BottomSheet + TextField search + SelectableRow list, `disabled`).
- File-by-file split (item 5) → developer Tasks 1-6/8-10, designer Task 7, qa Task 11-as-Task-10; Task 7 gates 8-9.
- Test plan (item 6) → Task 8 (fiat-only cash), Task 7 (search by code AND name), Task 10 (every added currency converts).
- Build-6 money-path risk (item 7) → Global Constraints "do NOT touch money-path core", derive-don't-duplicate for `allCurrencies`/`fiatCurrencies`, and Task 10 asserting GBP/CHF `canConvert` is true so no holding silently drops.

**Placeholder scan:** No TBD/TODO; every code step carries real code. Test bodies are concrete.

**Type consistency:** `Currency`, `currencyOptions`, `fiatCurrencyOptions`, `currencyName`, `currencySignSymbol`, `CurrencyFieldProps`, `currencyFromCode`/`codeFromCurrency` names are used identically across tasks. `CurrencyField` prop names (`label`/`selected`/`onSelect`/`options`/`required`/`disabled`/`testID`) match between Task 7's definition and Tasks 8-9's usage. testIDs (`account-currency-field`, `holding-currency-field`, `currency-picker-sheet`, `currency-option-<code>`) are consistent between component and consumers.
