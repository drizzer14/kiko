# Holding asset types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a term deposit and a bond a computed value (interest and accrued coupon), and include that value in net worth.

**Architecture:** Add a pure resolver `holdingValue(holding, now)` between the holding row and every place that reads its value. The resolver computes a deposit or a bond from typed `metadata`; for the other four types it returns the stored balance unchanged. Net worth, the holding form, and the holding detail screen all use it.

**Tech Stack:** TypeScript, React Native, Drizzle (op-sqlite), Jest, React Native Testing Library, the in-repo `Money` value object.

**Spec:** `docs/superpowers/specs/2026-09-01-holding-asset-types-design.md`

## Global Constraints

- Amounts are integer minor units. Never a float in a column or a `Money`. Convert with `Money.fromMajor` / `Money.of` at the boundary (`src/currency/currency.ts` holds `currencyScale`).
- Day count is actual/365. `dayMs = 86_400_000`. `DAYS_PER_YEAR = 365`.
- No schema change. The `holdings.type` enum and the `metadata` JSON column already exist (`src/db/schema.ts:16-31`).
- Compute on read: pass `now` (a unix-ms number) as a parameter. Never call `Date.now()` inside a pure helper.
- Follow the repo conventions: colocated `*.test.ts(x)` files, functional-first code, `Money` as the one OOP exception.
- The harness runs on save. Keep `npm run check:all` green. Never weaken a check.
- Percents are stored as major numbers (`15`, `9.5`). Dates in `metadata` are unix ms.

---

### Task 1: Typed holding metadata and safe parsers

**Files:**
- Create: `src/holdings/holding-metadata.ts`
- Test: `src/holdings/holding-metadata.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CompoundingFrequency = 'daily' | 'monthly' | 'quarterly' | 'annually'`
  - `type TermDepositMeta = { principalMinorUnits: number; annualRatePct: number; startDate: number; termMonths: number; recapitalization: boolean; compounding: CompoundingFrequency }`
  - `type BondMeta = { quantity: number; faceValueMinorUnits: number; couponPct: number; purchaseDate: number; maturityDate: number }`
  - `asTermDepositMeta(value: unknown): TermDepositMeta | null`
  - `asBondMeta(value: unknown): BondMeta | null`

- [ ] **Step 1: Write the failing test**

```ts
import { asBondMeta, asTermDepositMeta } from './holding-metadata';

describe('asTermDepositMeta', () => {
  const valid = {
    principalMinorUnits: 100_000,
    annualRatePct: 15,
    startDate: 1_700_000_000_000,
    termMonths: 12,
    recapitalization: true,
    compounding: 'monthly',
  };

  it('returns the typed object for a valid shape', () => {
    expect(asTermDepositMeta(valid)).toEqual(valid);
  });

  it('returns null when a field is missing', () => {
    const { annualRatePct, ...rest } = valid;
    expect(asTermDepositMeta(rest)).toBeNull();
  });

  it('returns null for an unknown compounding value', () => {
    expect(asTermDepositMeta({ ...valid, compounding: 'weekly' })).toBeNull();
  });

  it('returns null for null', () => {
    expect(asTermDepositMeta(null)).toBeNull();
  });
});

describe('asBondMeta', () => {
  const valid = {
    quantity: 10,
    faceValueMinorUnits: 100_000,
    couponPct: 9,
    purchaseDate: 1_700_000_000_000,
    maturityDate: 1_800_000_000_000,
  };

  it('returns the typed object for a valid shape', () => {
    expect(asBondMeta(valid)).toEqual(valid);
  });

  it('returns null when a field is the wrong type', () => {
    expect(asBondMeta({ ...valid, quantity: '10' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/holdings/holding-metadata.test.ts`
Expected: FAIL — `Cannot find module './holding-metadata'`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type CompoundingFrequency = 'daily' | 'monthly' | 'quarterly' | 'annually';

export type TermDepositMeta = {
  principalMinorUnits: number;
  annualRatePct: number;
  startDate: number;
  termMonths: number;
  recapitalization: boolean;
  compounding: CompoundingFrequency;
};

export type BondMeta = {
  quantity: number;
  faceValueMinorUnits: number;
  couponPct: number;
  purchaseDate: number;
  maturityDate: number;
};

const frequencies = new Set<string>(['daily', 'monthly', 'quarterly', 'annually']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const asTermDepositMeta = (value: unknown): TermDepositMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { principalMinorUnits, annualRatePct, startDate, termMonths, recapitalization, compounding } =
    value;
  if (
    !isNumber(principalMinorUnits) ||
    !isNumber(annualRatePct) ||
    !isNumber(startDate) ||
    !isNumber(termMonths) ||
    typeof recapitalization !== 'boolean' ||
    typeof compounding !== 'string' ||
    !frequencies.has(compounding)
  ) {
    return null;
  }
  return {
    principalMinorUnits,
    annualRatePct,
    startDate,
    termMonths,
    recapitalization,
    compounding: compounding as CompoundingFrequency,
  };
};

export const asBondMeta = (value: unknown): BondMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { quantity, faceValueMinorUnits, couponPct, purchaseDate, maturityDate } = value;
  if (
    !isNumber(quantity) ||
    !isNumber(faceValueMinorUnits) ||
    !isNumber(couponPct) ||
    !isNumber(purchaseDate) ||
    !isNumber(maturityDate)
  ) {
    return null;
  }
  return { quantity, faceValueMinorUnits, couponPct, purchaseDate, maturityDate };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/holdings/holding-metadata.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/holdings/holding-metadata.ts src/holdings/holding-metadata.test.ts
git commit -m "feat(holdings): typed metadata shapes and safe parsers"
```

---

### Task 2: Pure interest and coupon math

**Files:**
- Create: `src/holdings/interest.ts`
- Test: `src/holdings/interest.test.ts`

**Interfaces:**
- Consumes: `CompoundingFrequency` from `./holding-metadata`.
- Produces:
  - `periodsPerYear(frequency: CompoundingFrequency): number`
  - `addMonths(start: number, months: number): number`
  - `daysBetween(start: number, end: number): number`
  - `compoundedMajor(principalMajor: number, annualRatePct: number, frequency: CompoundingFrequency, daysElapsed: number): number`
  - `accruedMajor(baseMajor: number, annualRatePct: number, daysElapsed: number): number`

- [ ] **Step 1: Write the failing test**

```ts
import { accruedMajor, addMonths, compoundedMajor, daysBetween, periodsPerYear } from './interest';

describe('periodsPerYear', () => {
  it('maps each frequency', () => {
    expect(periodsPerYear('daily')).toBe(365);
    expect(periodsPerYear('monthly')).toBe(12);
    expect(periodsPerYear('quarterly')).toBe(4);
    expect(periodsPerYear('annually')).toBe(1);
  });
});

describe('daysBetween', () => {
  const day = 86_400_000;
  it('floors to whole days', () => {
    expect(daysBetween(0, 10 * day + 500)).toBe(10);
  });
  it('never returns a negative count', () => {
    expect(daysBetween(10 * day, 0)).toBe(0);
  });
});

describe('addMonths', () => {
  it('advances the calendar month', () => {
    const start = Date.UTC(2026, 0, 15); // 2026-01-15
    expect(addMonths(start, 12)).toBe(Date.UTC(2027, 0, 15));
  });
});

describe('compoundedMajor', () => {
  it('compounds one full year monthly at 12%', () => {
    // 12% annual, monthly => 1% per month, 12 complete periods.
    const value = compoundedMajor(1000, 12, 'monthly', 365);
    expect(value).toBeCloseTo(1000 * 1.01 ** 12, 6);
  });
  it('returns the principal before the first period completes', () => {
    expect(compoundedMajor(1000, 12, 'monthly', 20)).toBeCloseTo(1000, 6);
  });
});

describe('accruedMajor', () => {
  it('accrues simple interest over the elapsed days', () => {
    // 10% of 1000 over half a year (182.5 days) ~ 50.
    expect(accruedMajor(1000, 10, 182.5)).toBeCloseTo(50, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/holdings/interest.test.ts`
Expected: FAIL — `Cannot find module './interest'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { CompoundingFrequency } from './holding-metadata';

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365;

export const periodsPerYear = (frequency: CompoundingFrequency): number => {
  switch (frequency) {
    case 'daily':
      return 365;
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
    case 'annually':
      return 1;
  }
};

export const addMonths = (start: number, months: number): number => {
  const date = new Date(start);
  date.setMonth(date.getMonth() + months);
  return date.getTime();
};

export const daysBetween = (start: number, end: number): number =>
  Math.max(0, Math.floor((end - start) / DAY_MS));

export const compoundedMajor = (
  principalMajor: number,
  annualRatePct: number,
  frequency: CompoundingFrequency,
  daysElapsed: number,
): number => {
  const ppy = periodsPerYear(frequency);
  const periodDays = DAYS_PER_YEAR / ppy;
  const completed = Math.floor(daysElapsed / periodDays);
  return principalMajor * (1 + annualRatePct / 100 / ppy) ** completed;
};

export const accruedMajor = (
  baseMajor: number,
  annualRatePct: number,
  daysElapsed: number,
): number => (baseMajor * (annualRatePct / 100) * daysElapsed) / DAYS_PER_YEAR;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/holdings/interest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/holdings/interest.ts src/holdings/interest.test.ts
git commit -m "feat(holdings): pure interest and coupon math helpers"
```

---

### Task 3: The `holdingValue` and `accruedInterest` resolver

**Files:**
- Create: `src/holdings/holding-value.ts`
- Test: `src/holdings/holding-value.test.ts`

**Interfaces:**
- Consumes: `asTermDepositMeta`, `asBondMeta` from `./holding-metadata`; `addMonths`, `daysBetween`, `compoundedMajor`, `accruedMajor`, `periodsPerYear` from `./interest`; `Money` from `../currency/money`; `currencyScale` from `../currency/currency`; `HoldingRow` from `../db/schema`.
- Produces:
  - `type ValuableHolding = Pick<HoldingRow, 'type' | 'currency' | 'balanceMinorUnits' | 'metadata'>`
  - `holdingValue(holding: ValuableHolding, now: number): Money`
  - `accruedInterest(holding: ValuableHolding, now: number): Money | null`

- [ ] **Step 1: Write the failing test**

```ts
import { Money } from '../currency/money';
import { accruedInterest, holdingValue, type ValuableHolding } from './holding-value';

const base = { currency: 'UAH' as const, balanceMinorUnits: 0, metadata: null };
const START = Date.UTC(2026, 0, 1);
const day = 86_400_000;

describe('holdingValue', () => {
  it('returns the stored balance for a cash holding', () => {
    const holding: ValuableHolding = { ...base, type: 'cash', balanceMinorUnits: 5_000 };
    expect(holdingValue(holding, START).equals(Money.of('UAH', 5_000))).toBe(true);
  });

  it('returns the stored balance for a crypto asset', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 200_000_000,
    };
    expect(holdingValue(holding, START).equals(Money.of('BTC', 200_000_000)).valueOf()).toBe(true);
  });

  it('compounds a recapitalization-ON term deposit', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 100_000,
      metadata: {
        principalMinorUnits: 100_000, // 1000.00 UAH
        annualRatePct: 12,
        startDate: START,
        termMonths: 24,
        recapitalization: true,
        compounding: 'monthly',
      },
    };
    // One year elapsed, 12 complete monthly periods at 1%.
    const value = holdingValue(holding, START + 365 * day);
    const expected = Money.fromMajor('UAH', 1000 * 1.01 ** 12);
    expect(value.equals(expected)).toBe(true);
  });

  it('caps a term deposit at maturity', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 100_000,
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: START,
        termMonths: 12,
        recapitalization: true,
        compounding: 'monthly',
      },
    };
    const atMaturity = holdingValue(holding, addMonthsMs(START, 12));
    const wayPast = holdingValue(holding, addMonthsMs(START, 60));
    expect(wayPast.equals(atMaturity)).toBe(true);
  });

  it('keeps a recapitalization-OFF deposit at its principal', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 0,
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: START,
        termMonths: 24,
        recapitalization: false,
        compounding: 'monthly',
      },
    };
    const value = holdingValue(holding, START + 200 * day);
    expect(value.equals(Money.of('UAH', 100_000))).toBe(true);
  });

  it('values a bond as nominal plus accrued coupon', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'bond',
      balanceMinorUnits: 0,
      metadata: {
        quantity: 10,
        faceValueMinorUnits: 100_000, // 1000.00 each => nominal 10000.00
        couponPct: 10,
        purchaseDate: START,
        maturityDate: START + 730 * day,
      },
    };
    // 365 days => a full year of 10% coupon on 10000 => +1000.00.
    const value = holdingValue(holding, START + 365 * day);
    expect(value.equals(Money.of('UAH', 1_100_000))).toBe(true);
  });

  it('falls back to the cached balance when metadata is malformed', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 42_000,
      metadata: { junk: true },
    };
    expect(holdingValue(holding, START).equals(Money.of('UAH', 42_000))).toBe(true);
  });
});

describe('accruedInterest', () => {
  it('returns the current-period accrual for a recapitalization-OFF deposit', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: START,
        termMonths: 24,
        recapitalization: false,
        compounding: 'monthly',
      },
    };
    // 10 days into the first monthly period.
    const accrued = accruedInterest(holding, START + 10 * day);
    expect(accrued).not.toBeNull();
    expect(accrued?.minorUnits).toBeGreaterThan(0);
  });

  it('returns null for a recapitalization-ON deposit', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: START,
        termMonths: 24,
        recapitalization: true,
        compounding: 'monthly',
      },
    };
    expect(accruedInterest(holding, START + 10 * day)).toBeNull();
  });

  it('returns null for a cash holding', () => {
    expect(accruedInterest({ ...base, type: 'cash' }, START)).toBeNull();
  });
});

// Local helper mirrors interest.addMonths so the test states its own expectation.
function addMonthsMs(start: number, months: number): number {
  const date = new Date(start);
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/holdings/holding-value.test.ts`
Expected: FAIL — `Cannot find module './holding-value'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { currencyScale } from '../currency/currency';
import { Money } from '../currency/money';
import type { HoldingRow } from '../db/schema';
import { asBondMeta, asTermDepositMeta } from './holding-metadata';
import { accruedMajor, addMonths, compoundedMajor, daysBetween, periodsPerYear } from './interest';

export type ValuableHolding = Pick<
  HoldingRow,
  'type' | 'currency' | 'balanceMinorUnits' | 'metadata'
>;

const DAYS_PER_YEAR = 365;

const cachedBalance = (holding: ValuableHolding): Money =>
  Money.of(holding.currency, holding.balanceMinorUnits);

const toMajor = (minorUnits: number, currency: ValuableHolding['currency']): number =>
  minorUnits / 10 ** currencyScale[currency];

const termDepositValue = (holding: ValuableHolding, now: number): Money => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) {
    return cachedBalance(holding);
  }
  if (!meta.recapitalization) {
    return Money.of(holding.currency, meta.principalMinorUnits);
  }
  const maturity = addMonths(meta.startDate, meta.termMonths);
  const days = daysBetween(meta.startDate, Math.min(now, maturity));
  const principalMajor = toMajor(meta.principalMinorUnits, holding.currency);
  const valueMajor = compoundedMajor(principalMajor, meta.annualRatePct, meta.compounding, days);
  return Money.fromMajor(holding.currency, valueMajor);
};

const bondValue = (holding: ValuableHolding, now: number): Money => {
  const meta = asBondMeta(holding.metadata);
  if (meta === null) {
    return cachedBalance(holding);
  }
  const nominalMinor = meta.quantity * meta.faceValueMinorUnits;
  const days = daysBetween(meta.purchaseDate, Math.min(now, meta.maturityDate));
  const nominalMajor = toMajor(nominalMinor, holding.currency);
  const accrued = accruedMajor(nominalMajor, meta.couponPct, days);
  return Money.fromMajor(holding.currency, nominalMajor + accrued);
};

export const holdingValue = (holding: ValuableHolding, now: number): Money => {
  switch (holding.type) {
    case 'term_deposit':
      return termDepositValue(holding, now);
    case 'bond':
      return bondValue(holding, now);
    default:
      return cachedBalance(holding);
  }
};

export const accruedInterest = (holding: ValuableHolding, now: number): Money | null => {
  if (holding.type !== 'term_deposit') {
    return null;
  }
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null || meta.recapitalization) {
    return null;
  }
  const maturity = addMonths(meta.startDate, meta.termMonths);
  const days = daysBetween(meta.startDate, Math.min(now, maturity));
  const periodDays = DAYS_PER_YEAR / periodsPerYear(meta.compounding);
  const daysIntoPeriod = days - Math.floor(days / periodDays) * periodDays;
  const principalMajor = toMajor(meta.principalMinorUnits, holding.currency);
  const accrued = accruedMajor(principalMajor, meta.annualRatePct, daysIntoPeriod);
  return Money.fromMajor(holding.currency, accrued);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/holdings/holding-value.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/holdings/holding-value.ts src/holdings/holding-value.test.ts
git commit -m "feat(holdings): holdingValue and accruedInterest resolver"
```

---

### Task 4: Sum computed value in net worth

**Files:**
- Modify: `src/rates/conversion.ts:29-38`
- Modify: `src/screens/home/home.screen.tsx:26,49-57,70-74`
- Test: `src/rates/conversion.test.ts` (add cases)
- Test: `src/screens/home/home.screen.test.tsx` (adjust the holdings fixture)

**Interfaces:**
- Consumes: `holdingValue`, `ValuableHolding` from `../holdings/holding-value`.
- Produces: `netWorth(holdings: ValuableHolding[], base: Currency, rates: RateTable, now: number): Money`.

- [ ] **Step 1: Write the failing test**

Add to `src/rates/conversion.test.ts`:

```ts
import { netWorth } from './conversion';

describe('netWorth with computed holdings', () => {
  const day = 86_400_000;
  const START = Date.UTC(2026, 0, 1);

  it('sums a plain balance and a compounded deposit in the base currency', () => {
    const holdings = [
      { type: 'cash' as const, currency: 'UAH' as const, balanceMinorUnits: 100_000, metadata: null },
      {
        type: 'term_deposit' as const,
        currency: 'UAH' as const,
        balanceMinorUnits: 0,
        metadata: {
          principalMinorUnits: 100_000,
          annualRatePct: 12,
          startDate: START,
          termMonths: 24,
          recapitalization: true,
          compounding: 'monthly',
        },
      },
    ];
    const total = netWorth(holdings, 'UAH', {}, START + 365 * day);
    // 1000.00 cash + 1000×1.01^12 deposit.
    const depositMajor = 1000 * 1.01 ** 12;
    expect(total.minorUnits).toBe(100_000 + Math.round(depositMajor * 100));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/rates/conversion.test.ts`
Expected: FAIL — `netWorth` expects 3 arguments / ignores `metadata` and returns the raw balance sum.

- [ ] **Step 3: Write minimal implementation**

Rewrite `netWorth` in `src/rates/conversion.ts`:

```ts
import { holdingValue, type ValuableHolding } from '../holdings/holding-value';

// ...convert stays unchanged...

export const netWorth = (
  holdings: ValuableHolding[],
  base: Currency,
  rates: RateTable,
  now: number,
): Money =>
  holdings.reduce(
    (sum, holding) => sum.add(convert(holdingValue(holding, now), base, rates)),
    Money.of(base, 0),
  );
```

Update `src/screens/home/home.screen.tsx`:

```ts
// widen the holding shape the screen passes to net worth
type ConvertibleHolding = Pick<
  HoldingRow,
  'accountId' | 'currency' | 'balanceMinorUnits' | 'type' | 'metadata'
>;

// guardedNetWorth gains `now` and forwards it
const guardedNetWorth = (
  holdings: ConvertibleHolding[],
  base: Currency,
  rates: RateTable,
  now: number,
): Money => {
  const convertible = holdings.filter(holding => canConvert(holding.currency, base, rates));
  return netWorth(convertible, base, rates, now);
};

// in the component body, pass Date.now()
const total = guardedNetWorth(activeHoldings, baseCurrency, rateTable, Date.now());
```

The `canConvert` filter and `hasUnconvertible` check stay unchanged — both use `currency` only.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/rates/conversion.test.ts src/screens/home/home.screen.test.tsx`
Expected: PASS. If the home fixture typed holdings without `type`/`metadata`, add `type: 'cash'` and `metadata: null` to each fixture row.

- [ ] **Step 5: Commit**

```bash
git add src/rates/conversion.ts src/rates/conversion.test.ts src/screens/home/home.screen.tsx src/screens/home/home.screen.test.tsx
git commit -m "feat(rates): net worth sums computed holding value"
```

---

### Task 5: Type-specific fields in the holding form

**Files:**
- Modify: `src/screens/forms/holding-form.screen.tsx`
- Test: `src/screens/forms/holding-form.screen.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `holdingsRepo.create` (accepts `metadata`), `ChipSelector`, `FormTextInput`, `Money.fromMajor`.
- Produces: no exported symbol; the screen writes a `term_deposit` or `bond` `metadata` object on save.

- [ ] **Step 1: Write the failing test**

```ts
import { fireEvent, render, screen } from '@testing-library/react-native';
import HoldingFormScreen from './holding-form.screen';
import { holdingsRepo } from '../../repositories/holdings.repo';

jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: { create: jest.fn().mockResolvedValue(undefined) },
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() } as never;
const route = { params: { accountId: 'acc-1' } } as never;

describe('HoldingFormScreen term deposit', () => {
  it('saves a term_deposit with a metadata block', async () => {
    render(<HoldingFormScreen navigation={navigation} route={route} />);

    fireEvent.press(screen.getByText('term_deposit'));
    fireEvent.changeText(screen.getByLabelText('Name'), 'My deposit');
    fireEvent.changeText(screen.getByLabelText('Principal'), '1000');
    fireEvent.changeText(screen.getByLabelText('Annual rate %'), '12');
    fireEvent.changeText(screen.getByLabelText('Start date'), '2026-01-01');
    fireEvent.changeText(screen.getByLabelText('Term (months)'), '12');

    fireEvent.press(screen.getByText('Save'));

    await Promise.resolve();

    expect(holdingsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'term_deposit',
        metadata: expect.objectContaining({
          principalMinorUnits: 100_000,
          annualRatePct: 12,
          termMonths: 12,
          recapitalization: expect.any(Boolean),
          compounding: expect.any(String),
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/holding-form.screen.test.tsx`
Expected: FAIL — the form has no `Principal` field and passes no `metadata`.

- [ ] **Step 3: Write minimal implementation**

In `holding-form.screen.tsx`, add per-type state and render blocks. Keep the existing name/type/currency/openingBalance for the plain types. Add:

```ts
// term deposit state
const [principal, setPrincipal] = useState('');
const [annualRate, setAnnualRate] = useState('');
const [startDate, setStartDate] = useState('');
const [termMonths, setTermMonths] = useState('');
const [recapitalization, setRecap] = useState<'on' | 'off'>('on');
const [compounding, setCompounding] = useState<CompoundingFrequency>('monthly');

// bond state
const [quantity, setQuantity] = useState('');
const [faceValue, setFaceValue] = useState('');
const [couponPct, setCouponPct] = useState('');
const [purchaseDate, setPurchaseDate] = useState('');
const [maturityDate, setMaturityDate] = useState('');
```

Build the metadata on save with a `ts-pattern`-free switch (match the repo's existing switch style):

```ts
const buildMetadata = (): Record<string, unknown> | undefined => {
  if (type === 'term_deposit') {
    return {
      principalMinorUnits: Money.fromMajor(currency, Number(principal) || 0).minorUnits,
      annualRatePct: Number(annualRate) || 0,
      startDate: Date.parse(startDate) || Date.now(),
      termMonths: Number(termMonths) || 0,
      recapitalization: recapitalization === 'on',
      compounding,
    };
  }
  if (type === 'bond') {
    return {
      quantity: Number(quantity) || 0,
      faceValueMinorUnits: Money.fromMajor(currency, Number(faceValue) || 0).minorUnits,
      couponPct: Number(couponPct) || 0,
      purchaseDate: Date.parse(purchaseDate) || Date.now(),
      maturityDate: Date.parse(maturityDate) || Date.now(),
    };
  }
  return undefined;
};
```

Pass `metadata: buildMetadata()` to `holdingsRepo.create`. Render the term-deposit fields only when `type === 'term_deposit'` and the bond fields only when `type === 'bond'`; hide the opening-balance field for those two types. Reuse `FormTextInput` for every text field and `ChipSelector` for recapitalization (`['on', 'off']`) and compounding (`['daily', 'monthly', 'quarterly', 'annually']`). Import `CompoundingFrequency` from `../../holdings/holding-metadata`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/holding-form.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/holding-form.screen.tsx src/screens/forms/holding-form.screen.test.tsx
git commit -m "feat(forms): term deposit and bond fields in the holding form"
```

---

### Task 6: Show the computed value on the holding detail screen

**Files:**
- Modify: `src/screens/holding-detail/holding-detail.screen.tsx`
- Test: `src/screens/holding-detail/holding-detail.screen.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `holdingValue`, `accruedInterest` from `../../holdings/holding-value`; `MoneyText`.
- Produces: no exported symbol.

- [ ] **Step 1: Write the failing test**

```ts
import { render, screen } from '@testing-library/react-native';
import HoldingDetailScreen from './holding-detail.screen';

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: jest.fn(),
}));
import { useLiveQuery } from '../../db/use-live-query';

const navigation = { navigate: jest.fn() } as never;
const route = { params: { holdingId: 'h-1' } } as never;

describe('HoldingDetailScreen', () => {
  it('shows the computed value for a term deposit', () => {
    const holding = {
      id: 'h-1',
      name: 'My deposit',
      type: 'term_deposit',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: Date.UTC(2026, 0, 1),
        termMonths: 24,
        recapitalization: false,
        compounding: 'monthly',
      },
    };
    (useLiveQuery as jest.Mock)
      .mockReturnValueOnce({ data: [holding] }) // holdings
      .mockReturnValueOnce({ data: [] }); // transactions

    render(<HoldingDetailScreen navigation={navigation} route={route} />);

    expect(screen.getByText('Value')).toBeTruthy();
    expect(screen.getByText('Accrued interest')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/holding-detail/holding-detail.screen.test.tsx`
Expected: FAIL — the screen renders no `Value` or `Accrued interest` line.

- [ ] **Step 3: Write minimal implementation**

In `holding-detail.screen.tsx`, after the title, add a value block:

```tsx
{holding && (
  <Box gap={1}>
    <Text variant="caption" tone="textSecondary">
      Value
    </Text>
    <MoneyText money={holdingValue(holding, Date.now())} />
    {accruedInterest(holding, Date.now()) && (
      <Box gap={1}>
        <Text variant="caption" tone="textSecondary">
          Accrued interest
        </Text>
        <MoneyText money={accruedInterest(holding, Date.now()) as Money} />
      </Box>
    )}
  </Box>
)}
```

Import `holdingValue` and `accruedInterest`. Compute `Date.now()` once into a `const now` at the top of the component and reuse it for both calls, rather than calling it three times.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/holding-detail/holding-detail.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite and the harness**

Run: `npx jest && npm run check:all`
Expected: all tests pass; all seven checks green.

- [ ] **Step 6: Commit**

```bash
git add src/screens/holding-detail/holding-detail.screen.tsx src/screens/holding-detail/holding-detail.screen.test.tsx
git commit -m "feat(holdings): show computed value and accrued interest on detail"
```

---

## Self-review notes

- **Spec coverage:** metadata shapes (Task 1), the value rules (Tasks 2–3),
  net worth (Task 4), the form (Task 5), the detail screen (Task 6). Every
  spec section maps to a task.
- **Compute on read:** every resolver takes `now`; the screens pass `Date.now()`.
- **No schema change:** confirmed — only `metadata` shapes are added.
- **Type consistency:** `ValuableHolding`, `holdingValue`, `accruedInterest`,
  `asTermDepositMeta`, `asBondMeta`, `CompoundingFrequency` are used with the
  same names across Tasks 1, 3, 4, 5, 6.
