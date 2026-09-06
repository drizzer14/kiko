# Exchange Transaction Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Exchange transaction type that moves value from a liquid source holding (cash/card) to an eligible destination holding, writing both legs as two independent ledger rows in one `db.transaction()`.

**Architecture:** A new `transactionsRepo.recordExchange` writes both legs in a single `db.transaction()`, reusing the existing `recordManual` insert+balance pattern for the source (and plain destinations) and `appendDepositContribution` for a term-deposit destination. A pure `ts-pattern` dispatch maps the destination holding type to its receive path. The transaction form gains an Exchange create-only mode with a destination select.

**Tech Stack:** TypeScript, React Native, react-native-unistyles, op-sqlite + drizzle-orm, ts-pattern, Jest + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-05-exchange-transaction-design.md`

## Global Constraints

- JavaScript-only. No schema change, no migration, no native/build work.
- Every write goes through `db.transaction()` (the `write(...)` helper); both legs run in ONE transaction so a partial failure rolls back both (`kiko-architecture`).
- The destination receive mapping is exhaustive over the `holdings.type` enum at `src/db/schema.ts:25` (`card`, `term_deposit`, `bond`, `cash`, `crypto_asset`, `jar`). Re-read that enum at implementation time to confirm the six members are unchanged. Use `ts-pattern`'s `match(...).exhaustive()` for every mapping over it (`kiko-code-style`).
- Destination mapping by type: `cash`/`card`/`crypto_asset` -> plain transaction (+Value In); `term_deposit` -> `appendDepositContribution`; `bond`/`jar` -> EXCLUDED.
- Source eligibility: Exchange offered only when the source holding type is liquid (`cash` or `card`).
- Exchange is create-only; an existing transaction is never converted into an Exchange.
- Convert entered major amounts to minor units with `Money.fromMajor` at the form boundary, using each holding's own currency (source currency for Value Out, destination currency for Value In).
- Ledger copy: source leg description `Exchange to <destination name>`, destination leg description `Exchange from <source name>`. Two independent rows, no transfer-group id.
- Do NOT duplicate the `recordManual` / `appendDepositContribution` write logic — extract and reuse it.
- Code style: single quotes, 2-space indent, trailing commas, `arrowParentheses: always`, blank line before every `return`/`if`/`for`/`throw`/`try`, `import type` for type-only imports, full unabbreviated names, one component per file in its own folder, components default-export with `.component.tsx` suffix, everything else named export (`kiko-code-style`).
- Harness: run `npm run check:all` at each task checkpoint; run `npm run check:deep` before declaring the feature done.

---

## File Structure

- `src/holdings/exchange-destination.ts` (new) — pure `ts-pattern` dispatch: destination type -> receive path; source-eligibility predicate. One source of truth for both the repo dispatch and the form's destination filter/mode gate.
- `src/holdings/exchange-destination.test.ts` (new) — unit tests for the pure helpers.
- `src/repositories/holdings.repo.ts` (modify) — extract `appendDepositContributionTx(tx, ...)` inner helper so `recordExchange` can call it inside its own transaction; `appendDepositContribution` delegates to it.
- `src/repositories/transactions.repo.ts` (modify) — extract `recordManualTx(tx, ...)` inner helper; add `recordExchange`.
- `src/repositories/transactions.repo.test.ts` (modify) — tests for `recordExchange`.
- `src/repositories/holdings.repo.test.ts` (modify, if needed) — confirm the extraction leaves `appendDepositContribution` behavior green.
- `src/screens/forms/holding-select-field/` (new folder) — `holding-select-field.component.tsx`, `holding-select-field.props.d.ts`, `holding-select-field.styles.ts`, `index.ts`, `holding-select-field.component.test.tsx` — the destination select (field + bottom sheet), modeled on `category-field`.
- `src/screens/forms/transaction-form.screen.tsx` (modify) — add the Exchange mode, Value Out / To / Value In / Date fields, hide the category picker in Exchange mode.
- `src/screens/forms/transaction-form.screen.test.tsx` (modify) — Exchange-mode form tests.

---

## Task 1: Pure destination-receive dispatch + eligibility helpers

**Files:**
- Create: `src/holdings/exchange-destination.ts`
- Test: `src/holdings/exchange-destination.test.ts`

**Interfaces:**
- Consumes: `HoldingType` from `src/holdings/holding-type.ts`.
- Produces:
  - `type ExchangeReceivePath = 'plain' | 'contribution' | 'excluded'`
  - `exchangeReceivePath(type: HoldingType): ExchangeReceivePath`
  - `isExchangeDestinationType(type: HoldingType): boolean`
  - `isExchangeSourceType(type: HoldingType): boolean`

- [ ] **Step 1 (qa): Write the failing test**

```ts
// src/holdings/exchange-destination.test.ts
import {
  exchangeReceivePath,
  isExchangeDestinationType,
  isExchangeSourceType,
} from './exchange-destination';

describe('exchangeReceivePath', () => {
  it('maps cash, card, and crypto_asset destinations to a plain transaction', () => {
    expect(exchangeReceivePath('cash')).toBe('plain');
    expect(exchangeReceivePath('card')).toBe('plain');
    expect(exchangeReceivePath('crypto_asset')).toBe('plain');
  });

  it('maps a term_deposit destination to a contribution', () => {
    expect(exchangeReceivePath('term_deposit')).toBe('contribution');
  });

  it('excludes bond and jar destinations', () => {
    expect(exchangeReceivePath('bond')).toBe('excluded');
    expect(exchangeReceivePath('jar')).toBe('excluded');
  });
});

describe('isExchangeDestinationType', () => {
  it('accepts every non-excluded type and rejects bond/jar', () => {
    expect(isExchangeDestinationType('cash')).toBe(true);
    expect(isExchangeDestinationType('term_deposit')).toBe(true);
    expect(isExchangeDestinationType('bond')).toBe(false);
    expect(isExchangeDestinationType('jar')).toBe(false);
  });
});

describe('isExchangeSourceType', () => {
  it('accepts only cash and card as liquid sources', () => {
    expect(isExchangeSourceType('cash')).toBe(true);
    expect(isExchangeSourceType('card')).toBe(true);
    expect(isExchangeSourceType('term_deposit')).toBe(false);
    expect(isExchangeSourceType('bond')).toBe(false);
    expect(isExchangeSourceType('crypto_asset')).toBe(false);
    expect(isExchangeSourceType('jar')).toBe(false);
  });
});
```

- [ ] **Step 2 (qa): Run test to verify it fails**

Run: `npx jest src/holdings/exchange-destination.test.ts`
Expected: FAIL — cannot find module `./exchange-destination`.

- [ ] **Step 3 (developer): Write minimal implementation**

```ts
// src/holdings/exchange-destination.ts
import { match } from 'ts-pattern';
import type { HoldingType } from './holding-type';

// The receive path an Exchange destination takes, keyed by its holding type.
// Exhaustive over the `holdings.type` enum (schema.ts:25) so adding a holding
// type is a compile error here until this mapping is updated. This is the ONE
// source of truth for both `recordExchange`'s dispatch and the form's
// destination filter, so the two can never disagree on what is eligible.
export type ExchangeReceivePath = 'plain' | 'contribution' | 'excluded';

export const exchangeReceivePath = (type: HoldingType): ExchangeReceivePath =>
  match(type)
    .with('cash', 'card', 'crypto_asset', () => 'plain' as const)
    .with('term_deposit', () => 'contribution' as const)
    .with('bond', 'jar', () => 'excluded' as const)
    .exhaustive();

// A type is an eligible Exchange destination when it has any receive path other
// than 'excluded' (bond/jar have no clear "receive an arbitrary amount" path).
export const isExchangeDestinationType = (type: HoldingType): boolean =>
  exchangeReceivePath(type) !== 'excluded';

// Exchange is offered only from a liquid source — cash or card. Exhaustive so a
// new holding type must be classified here explicitly rather than defaulting in.
export const isExchangeSourceType = (type: HoldingType): boolean =>
  match(type)
    .with('cash', 'card', () => true)
    .with('term_deposit', 'bond', 'crypto_asset', 'jar', () => false)
    .exhaustive();
```

- [ ] **Step 4 (qa): Run test to verify it passes**

Run: `npx jest src/holdings/exchange-destination.test.ts`
Expected: PASS.

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** none. This task is the foundation for Tasks 3 and 5.

---

## Task 2: Extract transactional inner helpers (behavior-preserving refactor)

Both legs of `recordExchange` must run inside ONE `db.transaction()`, but `recordManual` and `appendDepositContribution` each open their own `write(...)` transaction and op-sqlite transactions do not nest. Extract each write's body into a `tx`-taking inner helper that the existing public method delegates to, so `recordExchange` (Task 3) can call the same logic inside its own transaction. No behavior change — the existing repo tests are the safety net.

**Files:**
- Modify: `src/repositories/transactions.repo.ts`
- Modify: `src/repositories/holdings.repo.ts`
- Test: `src/repositories/transactions.repo.test.ts` (existing), `src/repositories/holdings.repo.test.ts` (existing)

**Interfaces:**
- Produces:
  - `appendDepositContributionTx(tx: typeof database, holdingId: string, contribution: DepositContribution): Promise<void>` — exported from `holdings.repo.ts`.
  - `recordManualTx(tx: typeof database, input: ManualTransaction): Promise<void>` — module-private in `transactions.repo.ts`.
- Consumes: existing `write`, `database` from `src/db/client`.

- [ ] **Step 1 (qa): Confirm the existing safety-net tests pass before refactor**

Run: `npx jest src/repositories/transactions.repo.test.ts src/repositories/holdings.repo.test.ts`
Expected: PASS (baseline green before touching the code).

- [ ] **Step 2 (developer): Extract `appendDepositContributionTx` in `holdings.repo.ts`**

Move the entire current body of `appendDepositContribution` (the `async (tx) => { ... }` passed to `write`) into a new exported module-level function, and make the public method delegate:

```ts
// Append one contribution to a term deposit and rewrite its metadata, operating
// on an EXISTING transaction handle so a caller (e.g. `recordExchange`) can run
// it inside a larger single transaction. `appendDepositContribution` wraps this
// in its own `write(...)`. Throws on a non-deposit or invalid/absent metadata.
export const appendDepositContributionTx = async (
  tx: typeof database,
  holdingId: string,
  contribution: DepositContribution,
): Promise<void> => {
  const rows = await tx.select().from(holdings).where(eq(holdings.id, holdingId));
  const row = rows.at(0);

  if (row?.type !== 'term_deposit') {
    throw new Error('appendDepositContribution: not a term deposit');
  }

  const meta = asTermDepositMeta(row.metadata);

  if (meta === null) {
    throw new Error('appendDepositContribution: invalid deposit metadata');
  }

  const { amountMinorUnits, date } = contribution;

  if (!Number.isFinite(amountMinorUnits) || !Number.isFinite(date)) {
    throw new Error('appendDepositContribution: invalid contribution');
  }

  const contributions = [...meta.contributions, { amountMinorUnits, date }].sort(
    (a, b) => a.date - b.date,
  );

  await tx
    .update(holdings)
    .set({
      metadata: {
        contributions,
        annualRatePct: meta.annualRatePct,
        termMonths: meta.termMonths,
        recapitalization: meta.recapitalization,
        compounding: meta.compounding,
      },
    })
    .where(eq(holdings.id, holdingId));
};
```

Then the public method becomes:

```ts
  appendDepositContribution: (holdingId: string, contribution: DepositContribution) =>
    write((tx) => appendDepositContributionTx(tx, holdingId, contribution)),
```

Preserve the existing doc comment on the public method. Apply blank-line-before-`if`/`return` style throughout.

- [ ] **Step 3 (developer): Extract `recordManualTx` in `transactions.repo.ts`**

Move the body of `recordManual` into a module-private helper and delegate:

```ts
// Insert a manual transaction and adjust its holding's balance on an EXISTING
// transaction handle. The balance base is read from the DB *inside* the same
// transaction, never from a render snapshot, so concurrent writes cannot clobber
// each other with a stale read-modify-write. `recordManual` wraps this in its
// own `write(...)`; `recordExchange` calls it directly for the source leg and
// for a plain destination leg, keeping both legs in one transaction.
const recordManualTx = async (
  tx: typeof database,
  { holdingId, amountMinorUnits, time, description }: ManualTransaction,
): Promise<void> => {
  await tx.insert(transactions).values({
    id: id(),
    holdingId,
    amountMinorUnits,
    time,
    description: description ?? '',
    source: 'manual',
  });

  const current = await tx
    .select({ balanceMinorUnits: holdings.balanceMinorUnits })
    .from(holdings)
    .where(eq(holdings.id, holdingId))
    .limit(1);
  const base = current.at(0)?.balanceMinorUnits ?? 0;

  await tx
    .update(holdings)
    .set({ balanceMinorUnits: base + amountMinorUnits })
    .where(eq(holdings.id, holdingId));
};
```

Then:

```ts
  recordManual: (input: ManualTransaction) => write((tx) => recordManualTx(tx, input)),
```

Preserve the existing doc comment on `recordManual`. Import `database` type from `../db/client` if `typeof database` is not already in scope (it is imported as a value; `typeof database` works).

- [ ] **Step 4 (qa): Run the safety-net tests to verify no behavior change**

Run: `npx jest src/repositories/transactions.repo.test.ts src/repositories/holdings.repo.test.ts`
Expected: PASS — identical to the Step 1 baseline. No test edits needed.

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green (watch `check:knip` for a newly-exported `appendDepositContributionTx` reported unused — it becomes used in Task 3; sequence Task 3 immediately after, or accept the transient knip flag only within this task's own worktree and confirm it clears after Task 3).

**Dependencies:** none for the extraction itself. `appendDepositContributionTx` becomes consumed in Task 3.

---

## Task 3: `transactionsRepo.recordExchange`

**Files:**
- Modify: `src/repositories/transactions.repo.ts`
- Test: `src/repositories/transactions.repo.test.ts`

**Interfaces:**
- Consumes: `recordManualTx` (Task 2), `appendDepositContributionTx` (Task 2, from `./holdings.repo`), `exchangeReceivePath` (Task 1, from `../holdings/exchange-destination`), `match` from `ts-pattern`, `HoldingRow` from `../db/schema`.
- Produces:

```ts
type ExchangeInput = {
  sourceHoldingId: string;
  sourceName: string;
  valueOutMinorUnits: number;
  destinationHoldingId: string;
  destinationName: string;
  destinationType: HoldingRow['type'];
  valueInMinorUnits: number;
  time: number;
};
// transactionsRepo.recordExchange: (input: ExchangeInput) => Promise<void>
```

- [ ] **Step 1 (qa): Write the failing tests**

Follow the existing `mockTx` pattern at the top of `transactions.repo.test.ts` (override `write` to run the callback against a fake `tx`). Add a describe block:

```ts
describe('transactionsRepo.recordExchange', () => {
  // A fake tx that records every insert value and every (table -> set) update,
  // and answers balance reads from a per-holding map so the two legs' balances
  // can be asserted independently.
  const makeExchangeTx = (balances: Record<string, number>) => {
    const inserts: Record<string, unknown>[] = [];
    const updates: { table: unknown; values: Record<string, unknown> }[] = [];
    let pendingWhereHoldingId: string | null = null;
    const tx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserts.push(values);
          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: (predicate: unknown) => {
            // The balance read filters by holding id; the fake resolves the
            // matching balance. `predicate` carries the id via drizzle's `eq`,
            // but for the fake we track the last-requested id through a closure
            // set from the leg under test instead (see note in the assertions).
            return {
              limit: () =>
                Promise.resolve([
                  { balanceMinorUnits: balances[pendingWhereHoldingId ?? ''] ?? 0 },
                ]),
            };
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          updates.push({ table, values });
          return { where: () => Promise.resolve() };
        },
      }),
    };
    const setPendingHolding = (holdingId: string) => {
      pendingWhereHoldingId = holdingId;
    };
    return { tx, inserts, updates, setPendingHolding };
  };

  it('writes both legs and adjusts both balances for a plain (cash) destination', async () => {
    const fake = makeExchangeTx({ 'src-1': 10_000, 'dst-1': 2_000 });
    // The source read happens first, then the destination read; the recordManualTx
    // helper reads balance by holding id inside the tx. For this fake, assert on
    // the captured inserts/updates rather than threading the id into the read.
    mockTx = fake.tx;

    await transactionsRepo.recordExchange({
      sourceHoldingId: 'src-1',
      sourceName: 'Cash UAH',
      valueOutMinorUnits: 3_000,
      destinationHoldingId: 'dst-1',
      destinationName: 'Card USD',
      destinationType: 'card',
      valueInMinorUnits: 7_000,
      time: 123,
    });

    // Two ledger rows inserted, tied only by their descriptions.
    expect(fake.inserts).toEqual([
      expect.objectContaining({
        holdingId: 'src-1',
        amountMinorUnits: -3_000,
        time: 123,
        description: 'Exchange to Card USD',
        source: 'manual',
      }),
      expect.objectContaining({
        holdingId: 'dst-1',
        amountMinorUnits: 7_000,
        time: 123,
        description: 'Exchange from Cash UAH',
        source: 'manual',
      }),
    ]);
    // Both holdings' balances were updated (one row each on the holdings table).
    const holdingUpdates = fake.updates.filter((u) => u.table === holdings);
    expect(holdingUpdates).toHaveLength(2);
  });

  it('uses a contribution (metadata update, no new ledger row) for a term_deposit destination', async () => {
    // A term_deposit destination: the destination leg goes through
    // appendDepositContributionTx, which rewrites metadata and inserts NO
    // transaction row for the destination. So exactly ONE insert (the source
    // leg) is expected, plus a metadata update on the destination holding.
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          insertValues.push(values);
          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ balanceMinorUnits: 10_000 }]),
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          updateCalls.push({ table, values });
          return { where: () => Promise.resolve() };
        },
      }),
    };
    // NOTE: the term_deposit fake must return a valid deposit row + metadata for
    // the destination read that appendDepositContributionTx performs. Build the
    // select fake to return the deposit row (type: 'term_deposit', valid meta)
    // on the destination read and the balance shape on the source read; see the
    // makeUpdateTx queue pattern already in this file for a call-ordered fake.
    const insertValues: Record<string, unknown>[] = [];
    const updateCalls: { table: unknown; values: Record<string, unknown> }[] = [];

    await transactionsRepo.recordExchange({
      sourceHoldingId: 'src-1',
      sourceName: 'Cash UAH',
      valueOutMinorUnits: 3_000,
      destinationHoldingId: 'dep-1',
      destinationName: 'USD Deposit',
      destinationType: 'term_deposit',
      valueInMinorUnits: 5_000,
      time: 456,
    });

    // Only the source leg is a ledger insert; the deposit receive is a metadata
    // rewrite, not a transaction row.
    expect(insertValues).toEqual([
      expect.objectContaining({ holdingId: 'src-1', amountMinorUnits: -3_000 }),
    ]);
    expect(insertValues).toHaveLength(1);
  });

  it('rejects a destination equal to the source', async () => {
    mockTx = {
      insert: () => ({ values: () => Promise.resolve() }),
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 0 }]) }) }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    await expect(
      transactionsRepo.recordExchange({
        sourceHoldingId: 'same',
        sourceName: 'Cash',
        valueOutMinorUnits: 100,
        destinationHoldingId: 'same',
        destinationName: 'Cash',
        destinationType: 'cash',
        valueInMinorUnits: 100,
        time: 1,
      }),
    ).rejects.toThrow();
  });

  it('rolls back (propagates) when a destination leg forces a failure', async () => {
    // A destination read that throws simulates a mid-transaction failure; the
    // rejection propagates out of `write`, so op-sqlite rolls the whole
    // transaction back (both legs). Assert the promise rejects.
    mockTx = {
      insert: () => ({ values: () => Promise.resolve() }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              throw new Error('forced destination failure');
            },
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    await expect(
      transactionsRepo.recordExchange({
        sourceHoldingId: 'src-1',
        sourceName: 'Cash',
        valueOutMinorUnits: 100,
        destinationHoldingId: 'dst-1',
        destinationName: 'Card',
        destinationType: 'card',
        valueInMinorUnits: 100,
        time: 1,
      }),
    ).rejects.toThrow('forced destination failure');
  });
});
```

Note for the implementer: the term_deposit test needs a call-ordered `select` fake (like the existing `makeUpdateTx` `selectQueue`) that returns the source balance row on the first read and a valid `{ type: 'term_deposit', metadata: <valid deposit meta> }` row on the destination read. Reuse `asTermDepositMeta`-compatible metadata from an existing holdings.repo test fixture. Keep the assertion focused on "one ledger insert, destination is a metadata rewrite."

- [ ] **Step 2 (qa): Run tests to verify they fail**

Run: `npx jest src/repositories/transactions.repo.test.ts -t recordExchange`
Expected: FAIL — `recordExchange` is not a function.

- [ ] **Step 3 (developer): Implement `recordExchange`**

Add imports at the top of `transactions.repo.ts` (respect the two-group, shortest-first ordering):

```ts
import { match } from 'ts-pattern';
import type { DepositContribution } from '../holdings/holding-metadata';
import { exchangeReceivePath } from '../holdings/exchange-destination';
import { appendDepositContributionTx } from './holdings.repo';
```

Add the input type colocated near the other repo input types, and the method inside the `transactionsRepo` object:

```ts
type ExchangeInput = {
  sourceHoldingId: string;
  sourceName: string;
  valueOutMinorUnits: number;
  destinationHoldingId: string;
  destinationName: string;
  destinationType: HoldingRow['type'];
  valueInMinorUnits: number;
  time: number;
};
```

```ts
  /**
   * Record an Exchange as two INDEPENDENT ledger rows in ONE transaction, tied
   * only by their descriptions. The source leg subtracts Value Out (in the
   * source's currency); the destination leg dispatches by type — a plain
   * transaction (+Value In) for cash/card/crypto_asset, or a deposit
   * contribution for a term_deposit. bond/jar are not valid destinations and
   * throw. Any failure rolls back BOTH legs, so the ledger and both balances
   * can never desync. Balances are read INSIDE the transaction, never from a
   * render snapshot, exactly as `recordManual` does.
   */
  recordExchange: (input: ExchangeInput) =>
    write(async (tx) => {
      if (input.destinationHoldingId === input.sourceHoldingId) {
        throw new Error('recordExchange: destination equals source');
      }

      await recordManualTx(tx, {
        holdingId: input.sourceHoldingId,
        amountMinorUnits: -input.valueOutMinorUnits,
        time: input.time,
        description: `Exchange to ${input.destinationName}`,
      });

      await match(exchangeReceivePath(input.destinationType))
        .with('plain', () =>
          recordManualTx(tx, {
            holdingId: input.destinationHoldingId,
            amountMinorUnits: input.valueInMinorUnits,
            time: input.time,
            description: `Exchange from ${input.sourceName}`,
          }),
        )
        .with('contribution', () =>
          appendDepositContributionTx(tx, input.destinationHoldingId, {
            amountMinorUnits: input.valueInMinorUnits,
            date: input.time,
          }),
        )
        .with('excluded', () => {
          throw new Error(
            `recordExchange: ${input.destinationType} is not a valid destination`,
          );
        })
        .exhaustive(),
    }),
```

If a circular-import warning appears (`transactions.repo` importing from `holdings.repo`), confirm it is one-directional (`holdings.repo` does not import `transactions.repo`) — it is safe. `DepositContribution` may already be importable from `../holdings/holding-metadata`; use that type for the contribution argument shape.

- [ ] **Step 4 (qa): Run tests to verify they pass**

Run: `npx jest src/repositories/transactions.repo.test.ts`
Expected: PASS (new recordExchange tests plus all existing tests).

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green (the Task 2 knip flag on `appendDepositContributionTx` now clears — it is consumed here).

**Dependencies:** Tasks 1 and 2.

---

## Task 4: Destination select field component

A field-plus-bottom-sheet single-select for the Exchange "To" field, modeled on `src/screens/forms/category-field/`. It renders resolved holding options and reports the picked holding id. It is a pure presentational field — the form (Task 5) builds and filters the option list.

**Files:**
- Create: `src/screens/forms/holding-select-field/holding-select-field.component.tsx`
- Create: `src/screens/forms/holding-select-field/holding-select-field.props.d.ts`
- Create: `src/screens/forms/holding-select-field/holding-select-field.styles.ts`
- Create: `src/screens/forms/holding-select-field/index.ts`
- Test: `src/screens/forms/holding-select-field/holding-select-field.component.test.tsx`

**Interfaces:**
- Produces:

```ts
// holding-select-field.props.d.ts
import type { Currency } from '../../../currency/currency';

export type HoldingSelectOption = {
  id: string;
  name: string;
  icon: string;
  color: string;
  currency: Currency;
};

export type HoldingSelectFieldProps = {
  label: string;
  placeholder: string;
  options: readonly HoldingSelectOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};
```

- Consumes: `BottomSheet`, `Box`, `SymbolIcon`, `Text` design-system components; `useUnistyles`.

- [ ] **Step 1 (qa): Write the failing test**

```tsx
// holding-select-field.component.test.tsx
import { fireEvent, render } from '@testing-library/react-native';
import HoldingSelectField from './holding-select-field.component';
import type { HoldingSelectOption } from './holding-select-field.props';

const options: HoldingSelectOption[] = [
  { id: 'h1', name: 'Card USD', icon: 'creditcard', color: '#3366FF', currency: 'USD' },
  { id: 'h2', name: 'USD Deposit', icon: 'banknote', color: '#22AA55', currency: 'USD' },
];

describe('HoldingSelectField', () => {
  it('shows the placeholder when nothing is selected', () => {
    const { getByText } = render(
      <HoldingSelectField
        label="To"
        placeholder="Select holding"
        options={options}
        selectedId={null}
        onSelect={jest.fn()}
      />,
    );

    expect(getByText('Select holding')).toBeTruthy();
  });

  it('shows the selected holding name', () => {
    const { getByText } = render(
      <HoldingSelectField
        label="To"
        placeholder="Select holding"
        options={options}
        selectedId="h2"
        onSelect={jest.fn()}
      />,
    );

    expect(getByText('USD Deposit')).toBeTruthy();
  });

  it('opens the sheet and reports the picked id', () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText } = render(
      <HoldingSelectField
        label="To"
        placeholder="Select holding"
        options={options}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.press(getByLabelText('To'));
    fireEvent.press(getByText('Card USD'));

    expect(onSelect).toHaveBeenCalledWith('h1');
  });
});
```

- [ ] **Step 2 (qa): Run test to verify it fails**

Run: `npx jest src/screens/forms/holding-select-field`
Expected: FAIL — module not found.

- [ ] **Step 3 (developer): Implement the component, props, styles, and index**

Model `holding-select-field.component.tsx` on `category-field.component.tsx`: a `Pressable` field showing the selected option's `SymbolIcon` (tinted with its `color`) + name (or the placeholder tinted `textSecondary`), opening a `BottomSheet` with a vertical list of option rows; a row press calls `onSelect(id)` and closes the sheet; the selected row gets the accent fill + a trailing checkmark. Use `accessibilityLabel={label}` on the field `Pressable` and `accessibilityLabel={option.name}` on each row (the test presses by label/text). Read the theme via `useUnistyles()`. Default export, named function `HoldingSelectField`. Reuse `category-field.styles.ts` structure for `styles`. Add `index.ts`:

```ts
export { default } from './holding-select-field.component';
```

Keep the currency out of the primary row label unless it reads cleanly as a trailing caption (`{option.currency}`), matching the design-system JSX conventions (blank line between sibling nodes, title-case label). Do not hardcode colors/spacing — use tokens.

- [ ] **Step 4 (qa): Run test to verify it passes**

Run: `npx jest src/screens/forms/holding-select-field`
Expected: PASS.

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** none (parallelizable with Tasks 1-3). Consumed by Task 5.

---

## Task 5: Transaction form Exchange mode

Add a create-only Exchange mode to `transaction-form.screen.tsx`: a three-option mode row (Income / Expense / Exchange) shown only when the source holding is cash/card and the form is in create mode; Exchange-mode fields (Value Out, To, Value In, Date); category picker hidden in Exchange mode; save routes to `recordExchange`.

**Files:**
- Modify: `src/screens/forms/transaction-form.screen.tsx`
- Test: `src/screens/forms/transaction-form.screen.test.tsx`

**Interfaces:**
- Consumes: `transactionsRepo.recordExchange` (Task 3), `isExchangeSourceType`/`isExchangeDestinationType` (Task 1), `HoldingSelectField` + `HoldingSelectOption` (Task 4), `Money.fromMajor`, `parseAmount`, `holdingTypeSymbol`, `defaultHoldingColor`, `resolveEntityColor`.

- [ ] **Step 1 (qa): Write the failing tests**

Extend `transaction-form.screen.test.tsx`. The file already mocks `transactionsRepo`, `holdingsRepo`, `useLiveQuery`. Add a `recordExchange` jest.fn to the `transactionsRepo` mock and holdings fixtures with distinct types. Add a describe block:

```tsx
describe('TransactionFormScreen — Exchange mode', () => {
  it('offers Exchange only when the source holding is cash or card', async () => {
    // Render add mode from a CASH source: the Exchange chip appears.
    const cash = await renderAddFromHolding('cash-1'); // holding type 'cash'
    expect(cash.queryByText('Exchange')).toBeTruthy();

    // Render add mode from a BOND source: no Exchange chip.
    const bond = await renderAddFromHolding('bond-1'); // holding type 'bond'
    expect(bond.queryByText('Exchange')).toBeNull();
  });

  it('never offers Exchange in edit mode', async () => {
    const { queryByText } = renderEdit('txn-1');
    expect(queryByText('Exchange')).toBeNull();
  });

  it('lists open, non-source, non-bond/jar holdings in the destination select', async () => {
    const { getByText, getByLabelText, queryByText } = await renderAddFromHolding('cash-1');

    fireEvent.press(getByText('Exchange'));
    fireEvent.press(getByLabelText('To'));

    // A cash card destination is listed; the source itself, a closed holding,
    // and a bond/jar holding are not.
    expect(getByText('Card USD')).toBeTruthy();
    expect(queryByText('Cash UAH')).toBeNull(); // the source itself excluded
    expect(queryByText('Old Card')).toBeNull(); // closedAt != null excluded
    expect(queryByText('War Bond')).toBeNull(); // bond excluded
    expect(queryByText('Monobank Jar')).toBeNull(); // jar excluded
  });

  it('hides the category picker in Exchange mode', async () => {
    const { getByText, queryByLabelText } = await renderAddFromHolding('cash-1');
    // Category field visible in income/expense mode.
    expect(queryByLabelText('Category')).toBeTruthy();

    fireEvent.press(getByText('Exchange'));
    expect(queryByLabelText('Category')).toBeNull();
  });

  it('rejects empty, zero, or negative Value Out / Value In', async () => {
    const { getByText, getByLabelText } = await renderAddFromHolding('cash-1');
    fireEvent.press(getByText('Exchange'));
    fireEvent.press(getByLabelText('To'));
    fireEvent.press(getByText('Card USD'));

    // Leave Value Out empty; press Save.
    fireEvent.press(getByText('Save'));
    expect(mockRecordExchange).not.toHaveBeenCalled();
  });

  it('saves an exchange with correct minor units and holding ids', async () => {
    const { getByText, getByLabelText } = await renderAddFromHolding('cash-1');
    fireEvent.press(getByText('Exchange'));

    fireEvent.changeText(getByLabelText('Value Out'), '100');
    fireEvent.press(getByLabelText('To'));
    fireEvent.press(getByText('Card USD'));
    fireEvent.changeText(getByLabelText('Value In'), '2.50');

    fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockRecordExchange).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceHoldingId: 'cash-1',
          sourceName: 'Cash UAH',
          valueOutMinorUnits: 10_000, // 100 UAH -> minor (scale 2)
          destinationHoldingId: 'card-usd-1',
          destinationName: 'Card USD',
          destinationType: 'card',
          valueInMinorUnits: 250, // 2.50 USD -> minor (scale 2)
        }),
      ),
    );
  });
});
```

Note for the implementer: add `renderAddFromHolding(holdingId)` helpers and holdings fixtures (`cash-1` type cash currency UAH name 'Cash UAH'; `card-usd-1` type card currency USD name 'Card USD'; a `bond-1`, a closed 'Old Card', a 'War Bond', a 'Monobank Jar'). Access the field inputs by `accessibilityLabel` — `TextField`'s label is queryable via `getByLabelText` (confirm against the existing tests' query style; the existing tests use `getByLabelText`/`getByText`). Value Out / Value In `TextField`s must carry labels 'Value Out' and 'Value In'.

- [ ] **Step 2 (qa): Run tests to verify they fail**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx -t Exchange`
Expected: FAIL — the Exchange chip/fields do not exist.

- [ ] **Step 3 (developer): Implement the Exchange mode**

Concrete edits to `transaction-form.screen.tsx`:

1. Add imports (two-group, shortest-first):

```ts
import { isExchangeDestinationType, isExchangeSourceType } from '../../holdings/exchange-destination';
import { holdingTypeSymbol } from '../../holdings/entity-symbols';
import { defaultHoldingColor } from '../../holdings/entity-colors';
import { resolveEntityColor } from '../../design-system/entity-tint';
import HoldingSelectField from './holding-select-field';
import type { HoldingSelectOption } from './holding-select-field/holding-select-field.props';
```

2. Replace the `Sign` mode model with a three-value form mode. Keep the `Sign` type for `signedMinorUnits`, and introduce:

```ts
type FormMode = 'income' | 'expense' | 'exchange';

const MODE_LABELS: Record<FormMode, string> = {
  income: 'Income',
  expense: 'Expense',
  exchange: 'Exchange',
};
```

3. State: replace `const [sign, setSign] = useState<Sign>('income')` with `const [mode, setMode] = useState<FormMode>('income')`; add:

```ts
const [valueIn, setValueIn] = useState('');
const [destinationHoldingId, setDestinationHoldingId] = useState<string | null>(null);
```

Update the hydration effect (edit mode) to `setMode(fields.sign)` (edit is never exchange). Anywhere `sign` fed `signedMinorUnits`, derive it: for the income/expense write, pass `mode as Sign` (guaranteed non-exchange on that path).

4. Eligibility + options (compute in the component body):

```ts
const canExchange = !isEditing && holding !== undefined && isExchangeSourceType(holding.type);
const modeOptions: readonly FormMode[] = canExchange
  ? ['income', 'expense', 'exchange']
  : ['income', 'expense'];
const isExchange = mode === 'exchange';

const destinationOptions: HoldingSelectOption[] = holdings
  .filter(
    (candidate) =>
      candidate.id !== holdingId &&
      candidate.closedAt == null &&
      isExchangeDestinationType(candidate.type),
  )
  .map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    icon: candidate.icon ?? holdingTypeSymbol[candidate.type],
    color: resolveEntityColor(candidate.color, defaultHoldingColor[candidate.type]),
    currency: candidate.currency,
  }));
```

5. The `save` dispatcher gains an Exchange branch. To respect the cognitive-complexity cap (15), extract the Exchange save into its own function:

```ts
const saveExchange = async (): Promise<void> => {
  const destination = holdings.find((candidate) => candidate.id === destinationHoldingId);

  if (holding === undefined || destination === undefined) {
    return;
  }

  const valueOutMajor = parseAmount(amount);
  const valueInMajor = parseAmount(valueIn);

  if (Number.isNaN(valueOutMajor) || valueOutMajor <= 0) {
    return;
  }

  if (Number.isNaN(valueInMajor) || valueInMajor <= 0) {
    return;
  }

  const valueOut = Money.fromMajor(holding.currency, valueOutMajor);
  const valueInMoney = Money.fromMajor(destination.currency, valueInMajor);

  await transactionsRepo.recordExchange({
    sourceHoldingId: holding.id,
    sourceName: holding.name,
    valueOutMinorUnits: valueOut.minorUnits,
    destinationHoldingId: destination.id,
    destinationName: destination.name,
    destinationType: destination.type,
    valueInMinorUnits: valueInMoney.minorUnits,
    time,
  });

  navigation.goBack();
};
```

Then at the top of `save`:

```ts
if (isExchange) {
  await saveExchange();

  return;
}
```

6. JSX. Replace the sign `ChipRow` with the mode `ChipRow` (`options={modeOptions}`, `selected={mode}`, `onSelect={setMode}`, `labels={MODE_LABELS}`, `disabled={isReadOnly}`). In Exchange mode:
   - Relabel the existing Amount field to `Value Out` (or render a dedicated `Value Out` `TextField` bound to `amount`), keyboardType `decimal-pad`.
   - Render `HoldingSelectField` (`label="To"`, `placeholder="Select holding"`, `options={destinationOptions}`, `selectedId={destinationHoldingId}`, `onSelect={setDestinationHoldingId}`).
   - Render a `Value In` `TextField` bound to `valueIn`, keyboardType `decimal-pad`.
   - Keep the `DateField`.
   - Do NOT render `CategoryField` (`{!isExchange && <CategoryField ... />}`).
   - Hide the income/expense-only "Description" field in Exchange mode if it does not apply (the leg descriptions are auto-generated), OR keep it hidden — an exchange leg's description is fixed copy, so omit the free-text Description field when `isExchange`.

   In income/expense mode, keep the current fields exactly as today (Amount, Description, Date, mode ChipRow, Category, Delete). Separate sibling JSX nodes with blank lines; title-case field labels.

Keep the footer Save button logic working for the create-exchange case (it renders for non-read-only). Ensure `groupAmount` still formats the Value Out / Value In inputs the same way the Amount input does today.

- [ ] **Step 4 (qa): Run tests to verify they pass**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx`
Expected: PASS (Exchange tests plus all existing income/expense/edit/synced tests).

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green. Watch `check:lint`'s `noExcessiveCognitiveComplexity` on the screen — if `save`/component body trips the cap, decompose further (the `saveExchange` and `destinationOptions` extractions above are the primary relief valves).

**Dependencies:** Tasks 1, 3, and 4.

---

## Final verification

- [ ] **(ops): Full check**

Run: `npm run check:all`
Expected: green across lint, dup, knip, deps, security, secrets, overrides.

- [ ] **(ops): Deep check before declaring done**

Run: `npm run check:deep`
Expected: mutation score at or above threshold; osv-scanner reports only the known-accepted CVEs documented in the root `CLAUDE.md`. No new findings introduced by this feature.

- [ ] **(qa): Full Jest run**

Run: `npx jest`
Expected: all suites pass.

---

## Self-Review

- **Spec coverage:** recordExchange one-transaction two-leg write (Task 3) ✓; pure ts-pattern destination dispatch exhaustive over the enum (Task 1) ✓; Money.fromMajor at the form boundary per each holding's currency (Task 5) ✓; source eligibility cash/card (Tasks 1, 5) ✓; destination eligibility + receive mapping incl. bond/jar excluded (Tasks 1, 3, 5) ✓; two independent rows tied by description copy (Task 3) ✓; form Exchange mode with Value Out / To / Value In / Date and hidden category (Task 5) ✓; destination select excludes source, closed, bond/jar (Task 5) ✓; error handling: reject non-positive amounts, reject destination == source, term_deposit reuses appendDepositContribution validation, one-transaction rollback (Tasks 3, 5) ✓; no schema change/migration ✓; reuse of recordManual/appendDepositContribution via extraction (Task 2) ✓.
- **Out of scope honored:** no edit-into-exchange, no bond-buy/jar receive, no transfer-group id, no automatic rate conversion.
- **Type consistency:** `ExchangeInput` field names identical across Tasks 3 and 5; `HoldingSelectOption` identical across Tasks 4 and 5; `recordManualTx`/`appendDepositContributionTx` signatures consistent Tasks 2-3.
