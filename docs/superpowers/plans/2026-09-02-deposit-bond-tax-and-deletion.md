# Deposit/Bond Tax, Top-ups, and Entity Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add net-of-tax interest to term deposits (with multiple contributions) and bonds (government vs corporate), and add swipe-to-delete for manual accounts, holdings, and transactions while guarding synced entities.

**Architecture:** The value math stays pure (functions take `now`). A new `tax.ts` module holds the single rate. Deposit metadata becomes a list of contributions. A `holdingValueBreakdown` exposes gross, interest, tax, and net. Deletion adds guarded `remove` functions in the repositories and a custom `SwipeableRow` UI primitive built on React Native's own `Animated` + `PanResponder`.

**Tech Stack:** TypeScript, React Native, op-sqlite + Drizzle, react-native-unistyles, ts-pattern, Jest + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-02-deposit-bond-tax-and-deletion-design.md`

## Global Constraints

- **Hold all commits.** No task runs `git commit`. Each task ends after tests and checks pass. The coordinator presents the diff to the user; commits happen only on explicit user request. (This overrides the "Commit" step in the writing-plans template.)
- **Never weaken a check.** `npm run check:all` stays green. No `|| true`, no bare `biome-ignore` (use `OVERRIDE(...)` only with a concrete reason), no global suppress.
- **Every write goes through `db.transaction()`** — including single-statement writes — or live queries go stale (`kiko-architecture`).
- **Amounts are integer minor units.** Convert to/from `Money` at the repository boundary. Never a float column. `BTC` scale 8; `USD`/`EUR`/`UAH` scale 2 (`kiko-domain`).
- **Currency mapping uses `ts-pattern` exhaustive `match`** over the currency literal type.
- **Read functions return a Drizzle query builder** (for `useLiveQuery`); **write functions perform the transactional write**.
- Run a single test file with `npx jest <path>`. Run everything with `npx jest`. Run the harness with `npm run check:all`.

## Test date constants (use in domain tests)

```ts
const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1); // 2024-01-01, leap year
const AFTER_1Y = START + 365 * DAY; // 2024-12-31, before the 2025-01-01 maturity
```

## Batching for parallel execution (disjoint file sets)

- **Batch 1 (parallel):** Task 1, Task 2, Task 3, Task 5, Task 8. No shared files.
- **Batch 2 (parallel, after Batch 1):** Task 4, Task 6, Task 7. No shared files.
- **Batch 3 (parallel, after Batch 2):** Task 9, Task 10, Task 11, Task 12, Task 13. Disjoint screen files.

Every subagent works only on its own task's files and does NOT run worktree-global git commands.

---

### Task 1: Tax module

**Files:**
- Create: `src/holdings/tax.ts`
- Test: `src/holdings/tax.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `INTEREST_TAX_RATE_PCT: number` (= 23)
  - `taxOnInterestMinor(interestMinor: number): number`
  - `netInterestMinor(interestMinor: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/holdings/tax.test.ts
import { INTEREST_TAX_RATE_PCT, netInterestMinor, taxOnInterestMinor } from './tax';

describe('tax', () => {
  it('uses the 23% combined rate', () => {
    expect(INTEREST_TAX_RATE_PCT).toBe(23);
  });

  it('taxes positive interest, floored', () => {
    expect(taxOnInterestMinor(10000)).toBe(2300);
    expect(taxOnInterestMinor(999)).toBe(229); // floor(229.77)
  });

  it('never taxes zero or negative interest', () => {
    expect(taxOnInterestMinor(0)).toBe(0);
    expect(taxOnInterestMinor(-500)).toBe(0);
  });

  it('nets interest after tax', () => {
    expect(netInterestMinor(10000)).toBe(7700);
    expect(netInterestMinor(-500)).toBe(-500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/holdings/tax.test.ts`
Expected: FAIL — cannot find module `./tax`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/holdings/tax.ts
// 23% = 18% personal income tax + 5% military levy on deposit/corporate-bond interest.
export const INTEREST_TAX_RATE_PCT = 23;

export const taxOnInterestMinor = (interestMinor: number): number =>
  interestMinor <= 0 ? 0 : Math.floor((interestMinor * INTEREST_TAX_RATE_PCT) / 100);

export const netInterestMinor = (interestMinor: number): number =>
  interestMinor - taxOnInterestMinor(interestMinor);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/holdings/tax.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`
Expected: PASS. Leave changes in the working tree for review. Do NOT commit.

---

### Task 2: Deposit contributions + bond kind in metadata

**Files:**
- Modify: `src/holdings/holding-metadata.ts`
- Test: `src/holdings/holding-metadata.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DepositContribution = { amountMinorUnits: number; date: number }`
  - `type BondKind = 'government' | 'corporate'`
  - `TermDepositMeta` = `{ contributions: DepositContribution[]; annualRatePct: number; termMonths: number; recapitalization: boolean; compounding: CompoundingFrequency }`
  - `BondMeta` = `{ quantity: number; faceValueMinorUnits: number; couponPct: number; purchaseDate: number; maturityDate: number; bondKind: BondKind }`
  - `asTermDepositMeta(value: unknown): TermDepositMeta | null`
  - `asBondMeta(value: unknown): BondMeta | null`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/holdings/holding-metadata.test.ts
import { asBondMeta, asTermDepositMeta } from './holding-metadata';

describe('asTermDepositMeta contributions', () => {
  const base = { annualRatePct: 10, termMonths: 12, recapitalization: true, compounding: 'monthly' };

  it('reads a contributions list, sorted by date ascending', () => {
    const meta = asTermDepositMeta({
      ...base,
      contributions: [
        { amountMinorUnits: 500, date: 2000 },
        { amountMinorUnits: 100000, date: 1000 },
      ],
    });
    expect(meta?.contributions).toEqual([
      { amountMinorUnits: 100000, date: 1000 },
      { amountMinorUnits: 500, date: 2000 },
    ]);
  });

  it('normalizes the old principal + startDate shape to one contribution', () => {
    const meta = asTermDepositMeta({ ...base, principalMinorUnits: 100000, startDate: 1000 });
    expect(meta?.contributions).toEqual([{ amountMinorUnits: 100000, date: 1000 }]);
  });

  it('returns null when neither contributions nor the old shape is valid', () => {
    expect(asTermDepositMeta({ ...base })).toBeNull();
    expect(asTermDepositMeta({ ...base, contributions: [] })).toBeNull();
  });
});

describe('asBondMeta bondKind', () => {
  const base = { quantity: 10, faceValueMinorUnits: 10000, couponPct: 10, purchaseDate: 1000, maturityDate: 2000 };

  it('reads an explicit corporate kind', () => {
    expect(asBondMeta({ ...base, bondKind: 'corporate' })?.bondKind).toBe('corporate');
  });

  it('defaults a missing or invalid kind to government', () => {
    expect(asBondMeta({ ...base })?.bondKind).toBe('government');
    expect(asBondMeta({ ...base, bondKind: 'nonsense' })?.bondKind).toBe('government');
  });
});
```

Also update any existing test in this file that builds `TermDepositMeta` with `principalMinorUnits`/`startDate` so it still expresses valid input (the old shape still parses via normalization, so most existing tests keep passing; adjust expectations that read `meta.principalMinorUnits` — that field no longer exists on the parsed type; read `meta.contributions[0].amountMinorUnits` instead).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/holdings/holding-metadata.test.ts`
Expected: FAIL — contributions/bondKind not handled.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/holdings/holding-metadata.ts
export type CompoundingFrequency = 'daily' | 'monthly' | 'quarterly' | 'annually';

export type DepositContribution = { amountMinorUnits: number; date: number };

export type TermDepositMeta = {
  contributions: DepositContribution[];
  annualRatePct: number;
  termMonths: number;
  recapitalization: boolean;
  compounding: CompoundingFrequency;
};

export type BondKind = 'government' | 'corporate';

export type BondMeta = {
  quantity: number;
  faceValueMinorUnits: number;
  couponPct: number;
  purchaseDate: number;
  maturityDate: number;
  bondKind: BondKind;
};

const frequencies = new Set<string>(['daily', 'monthly', 'quarterly', 'annually']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const asContribution = (value: unknown): DepositContribution | null => {
  if (!isRecord(value)) return null;
  const { amountMinorUnits, date } = value;
  if (!isNumber(amountMinorUnits) || !isNumber(date)) return null;
  return { amountMinorUnits, date };
};

const readContributions = (value: Record<string, unknown>): DepositContribution[] | null => {
  const { contributions, principalMinorUnits, startDate } = value;
  if (Array.isArray(contributions)) {
    const parsed = contributions.map(asContribution);
    if (parsed.length > 0 && parsed.every((c): c is DepositContribution => c !== null)) {
      return [...parsed].sort((a, b) => a.date - b.date);
    }
    return null;
  }
  if (isNumber(principalMinorUnits) && isNumber(startDate)) {
    return [{ amountMinorUnits: principalMinorUnits, date: startDate }];
  }
  return null;
};

export const asTermDepositMeta = (value: unknown): TermDepositMeta | null => {
  if (!isRecord(value)) return null;
  const { annualRatePct, termMonths, recapitalization, compounding } = value;
  const contributions = readContributions(value);
  if (
    contributions === null ||
    !isNumber(annualRatePct) ||
    !isNumber(termMonths) ||
    typeof recapitalization !== 'boolean' ||
    typeof compounding !== 'string' ||
    !frequencies.has(compounding)
  ) {
    return null;
  }
  return {
    contributions,
    annualRatePct,
    termMonths,
    recapitalization,
    compounding: compounding as CompoundingFrequency,
  };
};

export const asBondMeta = (value: unknown): BondMeta | null => {
  if (!isRecord(value)) return null;
  const { quantity, faceValueMinorUnits, couponPct, purchaseDate, maturityDate, bondKind } = value;
  if (
    !isNumber(quantity) ||
    !isNumber(faceValueMinorUnits) ||
    !isNumber(couponPct) ||
    !isNumber(purchaseDate) ||
    !isNumber(maturityDate)
  ) {
    return null;
  }
  return {
    quantity,
    faceValueMinorUnits,
    couponPct,
    purchaseDate,
    maturityDate,
    bondKind: bondKind === 'corporate' ? 'corporate' : 'government',
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/holdings/holding-metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npx jest src/holdings` then `npm run check:all`.
Expected: PASS. Leave changes for review. Do NOT commit.

---

### Task 3: Per-contribution interest helpers

**Files:**
- Modify: `src/holdings/interest.ts`
- Test: `src/holdings/interest.test.ts` (extend)

**Interfaces:**
- Consumes: existing `addMonths`, `daysBetween`, `compoundedMajor`, `accruedMajor`, `periodDays` (keep all).
- Produces:
  - `type ContributionMajor = { amountMajor: number; date: number }`
  - `depositMaturity(contributions: { date: number }[], termMonths: number): number`
  - `depositCompoundedMajor(contributions: ContributionMajor[], annualRatePct: number, frequency: CompoundingFrequency, termMonths: number, now: number): number`
  - `depositAccruedMajor(contributions: ContributionMajor[], annualRatePct: number, frequency: CompoundingFrequency, termMonths: number, now: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/holdings/interest.test.ts
import { depositAccruedMajor, depositCompoundedMajor, depositMaturity } from './interest';

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const AFTER_1Y = START + 365 * DAY;

describe('deposit contributions', () => {
  it('anchors maturity to the earliest contribution date', () => {
    const later = Date.UTC(2024, 5, 1);
    expect(depositMaturity([{ date: later }, { date: START }], 12)).toBe(
      new Date(START).setMonth(new Date(START).getMonth() + 12),
    );
  });

  it('sums compounded value over contributions (0% rate = sum of amounts)', () => {
    const value = depositCompoundedMajor(
      [{ amountMajor: 1000, date: START }, { amountMajor: 500, date: START }],
      0,
      'monthly',
      12,
      AFTER_1Y,
    );
    expect(value).toBeCloseTo(1500, 6);
  });

  it('compounds each contribution from its own date (annually, one year)', () => {
    const value = depositCompoundedMajor([{ amountMajor: 1000, date: START }], 10, 'annually', 12, AFTER_1Y);
    expect(value).toBeCloseTo(1100, 6);
  });

  it('doubles when two equal contributions share a date', () => {
    const one = depositCompoundedMajor([{ amountMajor: 1000, date: START }], 10, 'annually', 12, AFTER_1Y);
    const two = depositCompoundedMajor(
      [{ amountMajor: 1000, date: START }, { amountMajor: 1000, date: START }],
      10,
      'annually',
      12,
      AFTER_1Y,
    );
    expect(two).toBeCloseTo(one * 2, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/holdings/interest.test.ts`
Expected: FAIL — new helpers not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to src/holdings/interest.ts
import type { CompoundingFrequency } from './holding-metadata';

export type ContributionMajor = { amountMajor: number; date: number };

export const depositMaturity = (contributions: { date: number }[], termMonths: number): number =>
  addMonths(Math.min(...contributions.map((c) => c.date)), termMonths);

export const depositCompoundedMajor = (
  contributions: ContributionMajor[],
  annualRatePct: number,
  frequency: CompoundingFrequency,
  termMonths: number,
  now: number,
): number => {
  const maturity = depositMaturity(contributions, termMonths);
  const end = Math.min(now, maturity);
  return contributions.reduce(
    (sum, c) =>
      sum + compoundedMajor(c.amountMajor, annualRatePct, frequency, daysBetween(c.date, end)),
    0,
  );
};

export const depositAccruedMajor = (
  contributions: ContributionMajor[],
  annualRatePct: number,
  frequency: CompoundingFrequency,
  termMonths: number,
  now: number,
): number => {
  const maturity = depositMaturity(contributions, termMonths);
  const end = Math.min(now, maturity);
  const period = periodDays(frequency);
  return contributions.reduce((sum, c) => {
    const days = daysBetween(c.date, end);
    const daysIntoPeriod = days - Math.floor(days / period) * period;
    return sum + accruedMajor(c.amountMajor, annualRatePct, daysIntoPeriod);
  }, 0);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/holdings/interest.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`. Expected: PASS. Do NOT commit.

---

### Task 4: Value breakdown with tax (depends on Tasks 1, 2, 3)

**Files:**
- Modify: `src/holdings/holding-value.ts`
- Test: `src/holdings/holding-value.test.ts` (extend)

**Interfaces:**
- Consumes: `tax.ts` (Task 1), `holding-metadata.ts` (Task 2), `interest.ts` deposit helpers (Task 3), existing `Money`, `currencyScale`.
- Produces:
  - `type HoldingValueBreakdown = { gross: Money; principalOrCost: Money; interest: Money; tax: Money; net: Money }`
  - `holdingValueBreakdown(holding: ValuableHolding, now: number): HoldingValueBreakdown`
  - `holdingValue(holding, now)` now returns `breakdown.net`.
  - `accruedInterest(holding, now)` updated to sum over contributions (recap-off only), net-of-tax.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/holdings/holding-value.test.ts
import { holdingValue, holdingValueBreakdown } from './holding-value';

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const AFTER_1Y = START + 365 * DAY;

const deposit = (over: Record<string, unknown>) => ({
  type: 'term_deposit' as const,
  currency: 'UAH' as const,
  balanceMinorUnits: 0,
  metadata: {
    contributions: [{ amountMinorUnits: 100000, date: START }],
    annualRatePct: 10,
    termMonths: 12,
    recapitalization: true,
    compounding: 'annually',
    ...over,
  },
});

const bond = (bondKind: string) => ({
  type: 'bond' as const,
  currency: 'UAH' as const,
  balanceMinorUnits: 0,
  metadata: {
    quantity: 10,
    faceValueMinorUnits: 10000,
    couponPct: 10,
    purchaseDate: START,
    maturityDate: AFTER_1Y + DAY,
    bondKind,
  },
});

describe('holdingValueBreakdown', () => {
  it('taxes a recapitalizing deposit at 23% of interest', () => {
    const b = holdingValueBreakdown(deposit({}), AFTER_1Y);
    expect(b.gross.minorUnits).toBe(110000);
    expect(b.principalOrCost.minorUnits).toBe(100000);
    expect(b.interest.minorUnits).toBe(10000);
    expect(b.tax.minorUnits).toBe(2300);
    expect(b.net.minorUnits).toBe(107700);
  });

  it('keeps a non-recapitalizing deposit value at the contributions sum', () => {
    const b = holdingValueBreakdown(deposit({ recapitalization: false }), AFTER_1Y);
    expect(b.gross.minorUnits).toBe(100000);
    expect(b.net.minorUnits).toBe(100000);
  });

  it('does not tax a government bond', () => {
    const b = holdingValueBreakdown(bond('government'), AFTER_1Y);
    expect(b.gross.minorUnits).toBe(110000);
    expect(b.tax.minorUnits).toBe(0);
    expect(b.net.minorUnits).toBe(110000);
  });

  it('taxes a corporate bond coupon at 23%', () => {
    const b = holdingValueBreakdown(bond('corporate'), AFTER_1Y);
    expect(b.gross.minorUnits).toBe(110000);
    expect(b.tax.minorUnits).toBe(2300);
    expect(b.net.minorUnits).toBe(107700);
  });

  it('holdingValue returns the net value', () => {
    expect(holdingValue(deposit({}), AFTER_1Y).minorUnits).toBe(107700);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/holdings/holding-value.test.ts`
Expected: FAIL — `holdingValueBreakdown` not defined; old tests referencing `principalMinorUnits` may also need updating to the contributions shape.

- [ ] **Step 3: Write minimal implementation**

Rewrite `holding-value.ts` to build a breakdown, then derive `holdingValue` from it. Use `tax.ts` for tax, `interest.ts` deposit helpers for gross/accrued, and `Money` for all fields. Key shape:

```ts
import { currencyScale } from '../currency/currency';
import { Money } from '../currency/money';
import type { HoldingRow } from '../db/schema';
import { asBondMeta, asTermDepositMeta } from './holding-metadata';
import {
  accruedMajor,
  daysBetween,
  depositAccruedMajor,
  depositCompoundedMajor,
  depositMaturity,
} from './interest';
import { taxOnInterestMinor } from './tax';

export type ValuableHolding = Pick<HoldingRow, 'type' | 'currency' | 'balanceMinorUnits' | 'metadata'>;

export type HoldingValueBreakdown = {
  gross: Money;
  principalOrCost: Money;
  interest: Money;
  tax: Money;
  net: Money;
};

const toMajor = (minorUnits: number, currency: ValuableHolding['currency']): number =>
  minorUnits / 10 ** currencyScale[currency];

const flat = (currency: ValuableHolding['currency'], minorUnits: number): HoldingValueBreakdown => {
  const money = Money.of(currency, minorUnits);
  const zero = Money.of(currency, 0);
  return { gross: money, principalOrCost: money, interest: zero, tax: zero, net: money };
};

const depositBreakdown = (holding: ValuableHolding, now: number): HoldingValueBreakdown => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) return flat(holding.currency, holding.balanceMinorUnits);
  const { currency } = holding;
  const contributionsMajor = meta.contributions.map((c) => ({
    amountMajor: toMajor(c.amountMinorUnits, currency),
    date: c.date,
  }));
  const principalMinor = meta.contributions.reduce((s, c) => s + c.amountMinorUnits, 0);

  if (!meta.recapitalization) {
    // Value is held at the contributions sum; interest is paid out.
    // Tax/interest describe the current-period accrual for display only.
    const accruedMajorValue = depositAccruedMajor(
      contributionsMajor,
      meta.annualRatePct,
      meta.compounding,
      meta.termMonths,
      now,
    );
    const interestMinor = Money.fromMajor(currency, accruedMajorValue).minorUnits;
    const taxMinor = taxOnInterestMinor(interestMinor);
    return {
      gross: Money.of(currency, principalMinor),
      principalOrCost: Money.of(currency, principalMinor),
      interest: Money.of(currency, interestMinor),
      tax: Money.of(currency, taxMinor),
      net: Money.of(currency, principalMinor),
    };
  }

  const grossMajor = depositCompoundedMajor(
    contributionsMajor,
    meta.annualRatePct,
    meta.compounding,
    meta.termMonths,
    now,
  );
  const grossMinor = Money.fromMajor(currency, grossMajor).minorUnits;
  const interestMinor = Math.max(0, grossMinor - principalMinor);
  const taxMinor = taxOnInterestMinor(interestMinor);
  return {
    gross: Money.of(currency, grossMinor),
    principalOrCost: Money.of(currency, principalMinor),
    interest: Money.of(currency, interestMinor),
    tax: Money.of(currency, taxMinor),
    net: Money.of(currency, grossMinor - taxMinor),
  };
};

const bondBreakdown = (holding: ValuableHolding, now: number): HoldingValueBreakdown => {
  const meta = asBondMeta(holding.metadata);
  if (meta === null) return flat(holding.currency, holding.balanceMinorUnits);
  const { currency } = holding;
  const nominalMinor = meta.quantity * meta.faceValueMinorUnits;
  const days = daysBetween(meta.purchaseDate, Math.min(now, meta.maturityDate));
  const accrued = accruedMajor(toMajor(nominalMinor, currency), meta.couponPct, days);
  const accruedMinor = Money.fromMajor(currency, accrued).minorUnits;
  const grossMinor = nominalMinor + accruedMinor;
  const taxMinor = meta.bondKind === 'corporate' ? taxOnInterestMinor(accruedMinor) : 0;
  return {
    gross: Money.of(currency, grossMinor),
    principalOrCost: Money.of(currency, nominalMinor),
    interest: Money.of(currency, accruedMinor),
    tax: Money.of(currency, taxMinor),
    net: Money.of(currency, grossMinor - taxMinor),
  };
};

export const holdingValueBreakdown = (
  holding: ValuableHolding,
  now: number,
): HoldingValueBreakdown => {
  switch (holding.type) {
    case 'term_deposit':
      return depositBreakdown(holding, now);
    case 'bond':
      return bondBreakdown(holding, now);
    default:
      return flat(holding.currency, holding.balanceMinorUnits);
  }
};

export const holdingValue = (holding: ValuableHolding, now: number): Money =>
  holdingValueBreakdown(holding, now).net;

export const accruedInterest = (holding: ValuableHolding, now: number): Money | null => {
  if (holding.type !== 'term_deposit') return null;
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null || meta.recapitalization) return null;
  return holdingValueBreakdown(holding, now).interest;
};
```

Confirm `Money.of` and `Money.fromMajor` exist with these signatures; the file already imports `Money`. Adjust `accruedInterest` consumers if they relied on the old current-period-only semantics (holding-detail test may need its expected value updated).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/holdings/holding-value.test.ts`
Expected: PASS. Then `npx jest src/holdings` for the whole domain folder.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`. Expected: PASS. Do NOT commit.

---

### Task 5: Synced-entity predicates

**Files:**
- Create: `src/holdings/deletable.ts`
- Test: `src/holdings/deletable.test.ts`

**Interfaces:**
- Consumes: `HoldingRow`, `AccountRow`, `TransactionRow` types from `src/db/schema`.
- Produces:
  - `isSyncedTransaction(row: Pick<TransactionRow, 'source'>): boolean`
  - `isSyncedHolding(row: Pick<HoldingRow, 'metadata'>): boolean`
  - `isSyncedAccount(row: Pick<AccountRow, 'institution'>): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/holdings/deletable.test.ts
import { isSyncedAccount, isSyncedHolding, isSyncedTransaction } from './deletable';

describe('synced predicates', () => {
  it('flags a monobank transaction', () => {
    expect(isSyncedTransaction({ source: 'monobank' })).toBe(true);
    expect(isSyncedTransaction({ source: 'manual' })).toBe(false);
  });

  it('flags a holding carrying a monobankId', () => {
    expect(isSyncedHolding({ metadata: { monobankId: 'abc' } })).toBe(true);
    expect(isSyncedHolding({ metadata: { iban: 'UA...' } })).toBe(false);
    expect(isSyncedHolding({ metadata: null })).toBe(false);
  });

  it('flags a monobank account', () => {
    expect(isSyncedAccount({ institution: 'monobank' })).toBe(true);
    expect(isSyncedAccount({ institution: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/holdings/deletable.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/holdings/deletable.ts
import type { AccountRow, HoldingRow, TransactionRow } from '../db/schema';

export const isSyncedTransaction = (row: Pick<TransactionRow, 'source'>): boolean =>
  row.source === 'monobank';

export const isSyncedHolding = (row: Pick<HoldingRow, 'metadata'>): boolean => {
  const meta = row.metadata;
  return typeof meta === 'object' && meta !== null && 'monobankId' in meta &&
    typeof (meta as { monobankId?: unknown }).monobankId === 'string';
};

export const isSyncedAccount = (row: Pick<AccountRow, 'institution'>): boolean =>
  row.institution === 'monobank';
```

Confirm the exported row type names in `src/db/schema.ts` (they may be `AccountRow`/`HoldingRow`/`TransactionRow`). If a name differs, use the real one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/holdings/deletable.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`. Expected: PASS. Do NOT commit.

---

### Task 6: Holdings repo — append contribution + remove (depends on Tasks 2, 5)

**Files:**
- Modify: `src/repositories/holdings.repo.ts`
- Test: `src/repositories/holdings.repo.test.ts` (extend)

**Interfaces:**
- Consumes: `asTermDepositMeta` (Task 2), `isSyncedHolding` (Task 5), existing `db`, `db.transaction`, schema tables.
- Produces:
  - `appendDepositContribution(id: string, contribution: { amountMinorUnits: number; date: number }): Promise<void>`
  - `remove(id: string): Promise<void>` — deletes the holding and all its transactions; refuses a synced holding.

- [ ] **Step 1: Write the failing test**

Follow the existing test setup in this file (in-memory / test db client, seeding helpers). Add:

```ts
// add to src/repositories/holdings.repo.test.ts
describe('appendDepositContribution', () => {
  it('appends a contribution and keeps them sorted by date', async () => {
    // seed a term_deposit holding with contributions [{100000, 1000}]
    // call appendDepositContribution(id, { amountMinorUnits: 500, date: 500 })
    // read the holding; expect metadata.contributions = [{500,500},{100000,1000}]
  });

  it('refuses a non-deposit holding', async () => {
    // seed a 'card' holding; expect appendDepositContribution to reject/throw
  });
});

describe('holdings remove', () => {
  it('deletes a manual holding and its transactions in one transaction', async () => {
    // seed a manual holding + 2 transactions; call remove(id)
    // expect the holding gone and both transactions gone
  });

  it('refuses a synced holding (monobankId in metadata)', async () => {
    // seed a holding with metadata.monobankId; expect remove to reject/throw and the row to remain
  });
});
```

Fill in the seed/read calls using this file's existing helpers and Drizzle queries. Assert real values.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/repositories/holdings.repo.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Write minimal implementation**

Add to `holdings.repo.ts`, each write wrapped in `db.transaction()`:

```ts
appendDepositContribution: async (id, contribution) => {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(holdings).where(eq(holdings.id, id));
    const row = rows[0];
    if (!row || row.type !== 'term_deposit') {
      throw new Error('appendDepositContribution: not a term deposit');
    }
    const meta = asTermDepositMeta(row.metadata);
    if (meta === null) throw new Error('appendDepositContribution: invalid deposit metadata');
    const contributions = [...meta.contributions, contribution].sort((a, b) => a.date - b.date);
    await tx
      .update(holdings)
      .set({ metadata: { ...(row.metadata as object), contributions, principalMinorUnits: undefined, startDate: undefined } })
      .where(eq(holdings.id, id));
  });
},

remove: async (id) => {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(holdings).where(eq(holdings.id, id));
    const row = rows[0];
    if (!row) return;
    if (isSyncedHolding(row)) throw new Error('remove: cannot delete a synced holding');
    await tx.delete(transactions).where(eq(transactions.holdingId, id));
    await tx.delete(holdings).where(eq(holdings.id, id));
  });
},
```

Match the module's existing export style (object of functions vs named exports). Import `transactions` table and `eq` if not already imported. When writing metadata back, prefer writing a clean object `{ contributions, annualRatePct, termMonths, recapitalization, compounding }` rebuilt from `meta` rather than spreading stale old-shape keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/repositories/holdings.repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`. Expected: PASS. Do NOT commit.

---

### Task 7: Accounts + transactions repo remove (depends on Task 5)

**Files:**
- Modify: `src/repositories/accounts.repo.ts`, `src/repositories/transactions.repo.ts`
- Test: `src/repositories/accounts.repo.test.ts`, `src/repositories/transactions.repo.test.ts` (extend)

**Interfaces:**
- Consumes: `isSyncedAccount`, `isSyncedTransaction` (Task 5), existing `db`, schema tables.
- Produces:
  - `accountsRepo.remove(id: string): Promise<void>` — deletes account, its holdings, and their transactions; refuses a synced account.
  - `transactionsRepo.remove(id: string): Promise<void>` — deletes the transaction and reverses its effect on the holding balance; refuses a synced transaction.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/repositories/transactions.repo.test.ts
describe('transactions remove', () => {
  it('deletes a manual transaction and reverses its balance effect', async () => {
    // seed holding balance 100000; add a manual transaction amount +2500 -> balance 102500
    // call remove(txId); expect the transaction gone and holding balance back to 100000
  });

  it('refuses a synced transaction', async () => {
    // seed a monobank transaction; expect remove to reject/throw and the row to remain
  });
});

// add to src/repositories/accounts.repo.test.ts
describe('accounts remove', () => {
  it('cascades to holdings and their transactions in one transaction', async () => {
    // seed a manual account with 1 holding and 2 transactions; call remove(accountId)
    // expect account, holding, and both transactions gone
  });

  it('refuses a synced account (institution = monobank)', async () => {
    // seed a monobank account; expect remove to reject/throw and the row to remain
  });
});
```

Fill in with each file's existing seed/read helpers; assert real values.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/repositories/accounts.repo.test.ts src/repositories/transactions.repo.test.ts`
Expected: FAIL — `remove` not defined.

- [ ] **Step 3: Write minimal implementation**

`transactions.repo.ts`:

```ts
remove: async (id) => {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(transactions).where(eq(transactions.id, id));
    const row = rows[0];
    if (!row) return;
    if (isSyncedTransaction(row)) throw new Error('remove: cannot delete a synced transaction');
    await tx.delete(transactions).where(eq(transactions.id, id));
    const holdingRows = await tx.select().from(holdings).where(eq(holdings.id, row.holdingId));
    const holding = holdingRows[0];
    if (holding) {
      await tx
        .update(holdings)
        .set({ balanceMinorUnits: holding.balanceMinorUnits - row.amountMinorUnits })
        .where(eq(holdings.id, row.holdingId));
    }
  });
},
```

`accounts.repo.ts`:

```ts
remove: async (id) => {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(accounts).where(eq(accounts.id, id));
    const row = rows[0];
    if (!row) return;
    if (isSyncedAccount(row)) throw new Error('remove: cannot delete a synced account');
    const accountHoldings = await tx.select().from(holdings).where(eq(holdings.accountId, id));
    for (const holding of accountHoldings) {
      await tx.delete(transactions).where(eq(transactions.holdingId, holding.id));
    }
    await tx.delete(holdings).where(eq(holdings.accountId, id));
    await tx.delete(accounts).where(eq(accounts.id, id));
  });
},
```

Match each module's export style and existing imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/repositories/accounts.repo.test.ts src/repositories/transactions.repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`. Expected: PASS. Do NOT commit.

---

### Task 8: SwipeableRow primitive

**Files:**
- Create: `src/design-system/components/swipeable-row/index.tsx` (follow the folder pattern of existing primitives, e.g. `list-row`)
- Test: `src/design-system/components/swipeable-row/swipeable-row.test.tsx`

**Interfaces:**
- Consumes: React Native `Animated`, `PanResponder`, `Alert`; theme via `useUnistyles`.
- Produces:
  - `SwipeableRow` default export.
  - Props: `{ children: ReactNode; onDelete: () => void; disabled?: boolean; confirmTitle?: string; confirmMessage?: string; testID?: string }`.
  - When `disabled`, no delete action is rendered and swiping is inert.
  - The delete action has `accessibilityRole="button"` and `accessibilityLabel="Delete"`. Pressing it calls `Alert.alert` with a destructive "Delete" button that invokes `onDelete`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/design-system/components/swipeable-row/swipeable-row.test.tsx
import { Alert } from 'react-native';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import SwipeableRow from './index';

describe('SwipeableRow', () => {
  it('renders a delete action for an enabled row and confirms before deleting', () => {
    const onDelete = jest.fn();
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const del = (buttons ?? []).find((b) => b.style === 'destructive');
      del?.onPress?.();
    });
    const { getByLabelText } = render(
      <SwipeableRow onDelete={onDelete}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    fireEvent.press(getByLabelText('Delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('renders no delete action when disabled', () => {
    const { queryByLabelText } = render(
      <SwipeableRow onDelete={jest.fn()} disabled>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    expect(queryByLabelText('Delete')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/design-system/components/swipeable-row`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Build the row with `Animated.View` translated by a `PanResponder`. Keep the gesture minimal: horizontal drag reveals a fixed-width red delete action; release snaps open (past a threshold) or closed. The delete action is a `Pressable` with `accessibilityLabel="Delete"` that calls `Alert.alert(confirmTitle ?? 'Delete', confirmMessage ?? 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: onDelete }])`. When `disabled`, render `children` alone with no action and no pan handlers. Use theme tokens for the delete background (`theme.colors.danger` or the nearest existing red token — confirm in the theme; if none, add one via the designer). The test only exercises the action button and the disabled branch, so the gesture math need not be unit-tested.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/design-system/components/swipeable-row`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`. Expected: PASS. Do NOT commit.

---

### Task 9: Holding-form contributions + bond kind (depends on Task 2)

**Files:**
- Modify: `src/screens/forms/holding-form.screen.tsx`
- Test: `src/screens/forms/holding-form.screen.test.tsx` (extend)

**Interfaces:**
- Consumes: `holdingsRepo.create`, `Money`, `asTermDepositMeta`/`BondKind` (Task 2).
- Produces: a deposit section with a repeatable contributions list; a bond `bondKind` chip row.

- [ ] **Step 1: Write the failing test**

```tsx
// add to src/screens/forms/holding-form.screen.test.tsx
it('creates a deposit with two contributions', async () => {
  // render with a route param accountId; select type 'term_deposit'
  // fill contribution 1 (amount + date), press 'Add contribution', fill contribution 2
  // fill rate/term; press Save
  // expect holdingsRepo.create called with metadata.contributions of length 2 (minor units)
});

it('creates a corporate bond when the corporate chip is selected', async () => {
  // select type 'bond'; fill fields; select 'corporate' chip; Save
  // expect holdingsRepo.create called with metadata.bondKind === 'corporate'
});
```

Mock `holdingsRepo.create` (jest.spyOn). Use `accessibilityLabel`s for inputs and `accessibilityState.selected` for chips, matching the existing test patterns in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/holding-form.screen.test.tsx`
Expected: FAIL — no contributions UI / no bondKind chip.

- [ ] **Step 3: Write minimal implementation**

Replace the deposit `principal`/`startDate` state with a `contributions` array state `Array<{ amount: string; date: string }>` (start with one row). Render each row with an amount input and a date input, plus an "Add contribution" control and a per-row remove control. In `buildMetadata` for `term_deposit`, map rows to `contributions: [{ amountMinorUnits: Money.fromMajor(currency, Number(amount) || 0).minorUnits, date: Date.parse(date) || Date.now() }, ...]` and drop `principalMinorUnits`/`startDate`. For `bond`, add `bondKind` state (default `'government'`) rendered as a chip row using the existing `renderChips`, and include `bondKind` in the bond metadata.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/holding-form.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`. Expected: PASS. Do NOT commit.

---

### Task 10: Holding-detail — breakdown display, top-up, swipe-delete transactions (depends on Tasks 4, 6, 8)

**Files:**
- Modify: `src/screens/holding-detail/holding-detail.screen.tsx`
- Test: `src/screens/holding-detail/holding-detail.screen.test.tsx` (extend)

**Interfaces:**
- Consumes: `holdingValueBreakdown` (Task 4), `holdingsRepo.appendDepositContribution` (Task 6), `transactionsRepo.remove` (Task 7), `SwipeableRow` (Task 8), `isSyncedTransaction` (Task 5).
- Produces: net headline + gross/interest/tax detail rows; an "Add contribution" action for a deposit; swipe-to-delete on transaction rows (disabled for synced rows).

- [ ] **Step 1: Write the failing test**

```tsx
// add to src/screens/holding-detail/holding-detail.screen.test.tsx
it('shows gross, interest, and tax detail for a taxable deposit', () => {
  // render a term_deposit holding whose breakdown has non-zero tax
  // expect gross value, interest, and tax labels/values present
});

it('deletes a manual transaction via the swipe action', () => {
  // spy transactionsRepo.remove; mock Alert to confirm; press Delete on a manual tx row
  // expect transactionsRepo.remove called with the tx id
});

it('does not offer delete on a synced transaction row', () => {
  // render with a monobank transaction; expect no Delete action for that row
});

it('appends a contribution through the add-contribution action', () => {
  // spy holdingsRepo.appendDepositContribution; open the action; enter amount+date; confirm
  // expect appendDepositContribution called with the parsed values
});
```

Use the file's existing render helper and repo mocks; read the current `now = Date.now()` usage at line 36.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/holding-detail/holding-detail.screen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Switch the value display to `holdingValueBreakdown(holding, now)`: net as headline (`MoneyText`), and detail rows for gross, interest earned, and tax (use existing `MoneyText`/`Text` and theme spacing). Wrap each transaction row in `SwipeableRow`, passing `disabled={isSyncedTransaction(tx)}` and `onDelete={() => transactionsRepo.remove(tx.id)}`. For a term deposit, add an "Add contribution" control that collects amount + date and calls `holdingsRepo.appendDepositContribution(holding.id, { amountMinorUnits, date })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/holding-detail/holding-detail.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`. Expected: PASS. Do NOT commit.

---

### Task 11: Account-detail — swipe-delete holdings + net-worth `now` fix (depends on Tasks 7, 8)

**Files:**
- Modify: `src/screens/account-detail/account-detail.screen.tsx`
- Test: `src/screens/account-detail/account-detail.screen.test.tsx` (extend)

**Interfaces:**
- Consumes: `holdingsRepo.remove` (Task 6), `SwipeableRow` (Task 8), `isSyncedHolding` (Task 5), `guardedNetWorth`.
- Produces: swipe-to-delete on holding rows (disabled for synced card/jar); `guardedNetWorth` called with `now`.

- [ ] **Step 1: Write the failing test**

```tsx
// add to src/screens/account-detail/account-detail.screen.test.tsx
it('deletes a manual holding via the swipe action', () => {
  // spy holdingsRepo.remove; mock Alert to confirm; press Delete on a manual holding row
  // expect holdingsRepo.remove called with the holding id
});

it('does not offer delete on a synced holding row (monobankId)', () => {
  // render a holding with metadata.monobankId; expect no Delete action for that row
});

it('reflects term-deposit growth in net worth (now is passed)', () => {
  // render an account with a recapitalizing term_deposit; assert the net-worth output
  // differs from the cached balance — this fails if guardedNetWorth is called without now
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/account-detail/account-detail.screen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

At `account-detail.screen.tsx:143`, change `guardedNetWorth(activeHoldings, baseCurrency, rateTable)` to pass `now` (add `const now = Date.now();` if not present). Wrap each `HoldingListRow` in `SwipeableRow` with `disabled={isSyncedHolding(holding)}` and `onDelete={() => holdingsRepo.remove(holding.id)}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/account-detail/account-detail.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`. Expected: PASS. Do NOT commit.

---

### Task 12: Accounts list — swipe-delete accounts + net-worth `now` fix (depends on Tasks 7, 8)

**Files:**
- Modify: `src/screens/accounts/accounts.screen.tsx`
- Test: `src/screens/accounts/accounts.screen.test.tsx` (extend)

**Interfaces:**
- Consumes: `accountsRepo.remove` (Task 7), `SwipeableRow` (Task 8), `isSyncedAccount` (Task 5), `guardedNetWorth`.
- Produces: swipe-to-delete on account rows (disabled for a Monobank account); `guardedNetWorth` called with `now`.

- [ ] **Step 1: Write the failing test**

```tsx
// add to src/screens/accounts/accounts.screen.test.tsx
it('deletes a manual account via the swipe action', () => {
  // spy accountsRepo.remove; mock Alert to confirm; press Delete on a manual account row
  // expect accountsRepo.remove called with the account id
});

it('does not offer delete on a monobank account row', () => {
  // render an account with institution 'monobank'; expect no Delete action for that row
});

it('reflects term-deposit growth in total net worth (now is passed)', () => {
  // similar to Task 11's net-worth assertion, at the accounts-screen level
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/accounts/accounts.screen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

At `accounts.screen.tsx:77`, pass `now` to `guardedNetWorth` (add `const now = Date.now();`). Wrap each account row (the `GlassSurface`/`Pressable` at lines 80–96) in `SwipeableRow` with `disabled={isSyncedAccount(account)}` and `onDelete={() => accountsRepo.remove(account.id)}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/accounts/accounts.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npm run check:all`. Expected: PASS. Do NOT commit.

---

### Task 13: Transaction-edit delete button (depends on Task 7)

**Files:**
- Modify: `src/screens/forms/transaction-form.screen.tsx`
- Test: `src/screens/forms/transaction-form.screen.test.tsx` (extend)

**Interfaces:**
- Consumes: `transactionsRepo.remove` (Task 7); the existing `isReadOnly`/manual-vs-synced gate (line ~32–38).
- Produces: a delete button visible only for a manual transaction, with a confirm dialog.

- [ ] **Step 1: Write the failing test**

```tsx
// add to src/screens/forms/transaction-form.screen.test.tsx
it('deletes a manual transaction and navigates back', () => {
  // render editing a manual transaction; spy transactionsRepo.remove and navigation.goBack
  // mock Alert to confirm; press the Delete button
  // expect transactionsRepo.remove called with the tx id and goBack called
});

it('shows no delete button for a synced transaction', () => {
  // render editing a monobank transaction; expect no Delete button
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

When the edited transaction is manual (reuse the existing gate), render a destructive "Delete" button. On press, `Alert.alert` to confirm, then `await transactionsRepo.remove(id)` and `navigation.goBack()`. Hide it entirely when the transaction is synced.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify (no commit)**

Run: `npx jest` (full suite) then `npm run check:all`. Expected: PASS. Do NOT commit.

---

## Final verification (coordinator, after all tasks)

- [ ] Run `npx jest` — full suite green.
- [ ] Run `npm run check:all` — all 7 checks green.
- [ ] Run `npm run check:deep` — mutation + osv (accepts the known `image-size` CVEs documented in `CLAUDE.md`).
- [ ] Present the full working-tree diff to the user for review. Do NOT commit until the user asks.

## Self-review notes (author)

- **Spec coverage:** A1→T1, A2→T2, A3→T3, A4→T4, A5→T11+T12, A6→T10; B1→T9, B2→T10, B3→T6; C1→T5, C2→T6+T7, C3→T8+T10+T11+T12, C4→T13. All spec sections are covered.
- **Placeholder scan:** repository and screen tests carry described seed steps rather than full literal bodies, because they must match each file's existing test harness (seed helpers, mock style). The concrete assertions and expected values are stated. Domain tasks (T1–T5) carry full literal test code.
- **Type consistency:** `DepositContribution`, `BondKind`, `HoldingValueBreakdown`, `holdingValueBreakdown`, `appendDepositContribution`, `remove`, `isSyncedTransaction/Holding/Account`, and the deposit interest helpers use the same names across producer and consumer tasks.
