# Exchange Prefill + Split-Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the Convert flow's counterpart amount from the latest cached rate when recording a card→cash withdrawal (Feature 1), and let a manual expense distribute its change across other holdings as atomic, linked return rows that the spending pie nets (Feature 2).

**Architecture:** Feature 1 reuses the existing Convert path (`recordExchangeCounterpart`) untouched and adds ONE pure prefill helper plus a form effect that seeds `counterpartAmount` — the synced bank row is never mutated. Feature 2 adds a nullable `changeGroupId` column, a new atomic repo method `recordManualWithReturns` (payment + N returns in one `write(...)`, same shape as `recordExchange`), a netting tweak in BOTH `buildCategoryBreakdown` (the pie) and the trend's shared `accumulateSpend` (the line + Top-N ranking) so a payment's linked returns reduce its category magnitude at every spending call site, and a dynamic-rows form path. A single money-path guard test (modeled on `crypto-coverage.test.ts`) drives the real logic through fast seams to prove net worth and the pie stay correct.

**Tech Stack:** TypeScript, React Native, op-sqlite + Drizzle ORM (`driver: 'expo'`), Jest + React Native Testing Library, ts-pattern, the `Money` value object, Biome.

**Spec:** docs/superpowers/specs/2026-09-14-exchange-prefill-split-change-design.md

## Global Constraints

- Money is minor-units integer math only — never a float; convert to/from `Money` (`src/currency/money/money.ts`) at the repository boundary (kiko-domain).
- Every insert/update/delete runs inside `db.transaction()` via the `write(...)` helper — no exception for single statements (kiko-architecture).
- Feature 2 is MANUAL EXPENSE ONLY for v1: no exchange+split combo, offered only on a fresh manual expense create (`!isReadOnly`, `!isEditing`, expense sign).
- Feature 2 returns use the SAME currency as the payment for v1.
- Feature 2 validation: each return `> 0` AND `Σ returns < |payment|`; return targets are any OPEN holding except the payer, each DISTINCT.
- Feature 2 returns are SEPARATE LINKED rows (a payment row + N return rows sharing one `changeGroupId`), never line-items — a transaction moves exactly one holding's balance.
- Feature 1 seeds from the LATEST CACHED rate (`ratesRepo.allQuery`); same-currency = 1:1; a missing rate leaves the field BLANK (never a crash); the synced withdrawal row is NEVER marked as an exchange leg.
- Feature 1 linking is Approach A (Convert-from-detail + prefill) ONLY — auto-suggest (Approach C) is OUT of v1 scope; do NOT plan it.
- A `changeGroupId` schema change requires a Drizzle migration generated per kiko-architecture: `npx drizzle-kit generate --name add_change_group_id` (writes `.sql` + `meta/NNNN_snapshot.json` + journal entry AND rewrites `drizzle/migrations/migrations.js` wholesale), then `npx biome check --write` over the generated artifacts.
- Import ordering is hand-enforced length-sort within 3 groups (external / `../**` parent / `./**` sibling), sorted by the ending physical line length ascending; `import type` for type-only imports; blank line before every `return`/`if`/`for`/`while`/`switch` (kiko-code-style).
- Netting applies to BOTH statistics call sites in v1 per the locked user decision: the spending PIE (`buildCategoryBreakdown`, Task 3) AND the category TREND line + Top-N ranking (`src/statistics/category-trend/category-trend.ts`'s shared `accumulateSpend`, Task 3b). A payment's linked positive returns reduce its category magnitude identically in both, so neither overstates the category by the change. The trend is NOT a follow-up.
- The transaction form (`src/screens/forms/transaction-form.screen.tsx`) is a HOLD zone — a UI-tweaks track overlaps it. Tasks 7 and 8 (form edits) are PLAN-ONLY: implement them only after the overlapping track lands and the coordinator clears the file.
- Gate on the harness: run `npm run check:all` after each task's commit; run `npm run check:deep` (mutation + osv-scanner) once before declaring the feature done. Never weaken a check to get green.

---

## File Structure

**Created:**
- `src/db/schema.change-group.test.ts` — proves migration 0030 adds `change_group_id` to `transactions` and is registered in the journal + index (Task 1).
- `drizzle/migrations/0030_add_change_group_id.sql` — the generated additive column migration (Task 1).
- `drizzle/migrations/meta/0030_snapshot.json` — generated snapshot (Task 1).
- `src/holdings/exchange-prefill/exchange-prefill.ts` — the pure `seedCounterpartMinorUnits` helper (Feature 1) (Task 5).
- `src/holdings/exchange-prefill/exchange-prefill.test.ts` — unit test for the seed helper (Task 5).
- `src/holdings/exchange-prefill/index.ts` — barrel re-export (Task 5).
- `src/transactions/repo/money-path.test.ts` — the money-path build-6 guard test (Task 6).

**Modified:**
- `src/db/schema.ts` — add `changeGroupId: text('change_group_id')` to the `transactions` table (Task 1).
- `drizzle/migrations/migrations.js` + `drizzle/migrations/meta/_journal.json` — regenerated to include 0030 (Task 1).
- `src/transactions/repo/transactions.repo.ts` — add `changeGroupId` to `ManualTransaction` + `recordManualTx`; add `ChangeReturn`/`ManualWithReturnsInput` types + `recordManualWithReturns` (Task 2).
- `src/transactions/repo/transactions.repo.test.ts` — tests for `recordManualWithReturns` (Task 2).
- `src/statistics/category-breakdown/category-breakdown.ts` — add `changeGroupId` to `BreakdownTransaction`; net linked returns into the payment's category magnitude (Task 3).
- `src/statistics/category-breakdown/category-breakdown.test.ts` — add `changeGroupId: null` default to the `tx` fixture; add the netting test (Task 3).
- `src/statistics/category-trend/category-trend.ts` — add per-group return sums in the shared `accumulateSpend`; net a payment's linked returns out of its trend/ranking spend magnitude (Task 3b). No new type — `TrendTransaction` inherits `changeGroupId` from `BreakdownTransaction` (Task 3).
- `src/statistics/category-trend/category-trend.test.ts` — add `changeGroupId: null` default to the `tx` fixture; add the trend netting test (Task 3b).
- `src/transactions/repo/transactions.repo.ts` (`listAllWithContextQuery`) + `src/screens/statistics/statistics.screen.tsx` (BOTH pie projections — `breakdownTransactions` and `rangeFilteredBreakdownTransactions`) — thread `changeGroupId` through to the pie (Task 4).
- `src/screens/statistics/statistics.screen.tsx` (`trendTransactions` projection) — thread `changeGroupId` through to the trend line + ranking (Task 3b).
- `src/screens/forms/transaction-form.screen.tsx` — split-change UI + `saveSplit` (Task 7, HOLD); Feature 1 rate live query + prefill effect (Task 8, HOLD).

---

### Task 1: `changeGroupId` schema column + Drizzle migration 0030

**Files:**
- Modify: `src/db/schema.ts` (transactions table, after line 108 `exchangeCounterpartHoldingId`)
- Create: `drizzle/migrations/0030_add_change_group_id.sql` (generated), `drizzle/migrations/meta/0030_snapshot.json` (generated)
- Modify: `drizzle/migrations/migrations.js`, `drizzle/migrations/meta/_journal.json` (regenerated by drizzle-kit)
- Test: `src/db/schema.change-group.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `transactions.changeGroupId` Drizzle column (`text('change_group_id')`, nullable), so `TransactionRow['changeGroupId']` is `string | null`.

- [ ] **Step 1: Write the failing test**

Create `src/db/schema.change-group.test.ts` (modeled on `src/db/schema.category-overrides.test.ts`):

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(__dirname, '../../drizzle/migrations');

const combinedSql = (): string =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
    .join('\n');

describe('change_group_id migration', () => {
  it('adds the change_group_id column to transactions', () => {
    expect(combinedSql()).toContain('ALTER TABLE `transactions` ADD `change_group_id` text;');
  });

  it('registers the new migration in the migrations index', () => {
    expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain('0030');
  });

  it('registers the migration under a journal idx the runner resolves it by', () => {
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const entry = journal.entries.find(
      (candidate) => candidate.tag === '0030_add_change_group_id',
    );

    expect(entry).toBeDefined();
    expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain(
      `m${String(entry?.idx).padStart(4, '0')}`,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/db/schema.change-group.test.ts`
Expected: FAIL — the SQL string, the `0030` index entry, and the journal tag do not exist yet.

- [ ] **Step 3: Add the schema column, then generate the migration**

In `src/db/schema.ts`, immediately after the `exchangeCounterpartHoldingId: text('exchange_counterpart_holding_id'),` line (108) inside the `transactions` table, add:

```ts
    // Split-change grouping: a shared id across ONE manual payment row and the
    // N return rows that distribute its change into OTHER holdings, all written
    // atomically in one `write(...)` by `recordManualWithReturns`
    // (transactions/repo/transactions.repo.ts). Nullable — a plain
    // manual/exchange/synced row carries null and is unaffected. The spending
    // pie NETS a payment's linked returns into its category so the category is
    // not overstated by the change (statistics/category-breakdown). A column,
    // not a reserved `category` value, for the same reason the exchange marker
    // is: the category picker rewrites `category` and would destroy it.
    changeGroupId: text('change_group_id'),
```

Then generate the migration and format the artifacts:

```bash
npx drizzle-kit generate --name add_change_group_id
npx biome check --write drizzle/migrations
```

Verify the generated `drizzle/migrations/0030_add_change_group_id.sql` contains exactly:

```sql
ALTER TABLE `transactions` ADD `change_group_id` text;
```

Re-check that `drizzle/migrations/migrations.js` still imports every prior `mNNNN` AND the new `m0030` (drizzle-kit rewrites this file wholesale — confirm nothing was dropped).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/db/schema.change-group.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/schema.change-group.test.ts drizzle/migrations
git commit -m "feat(db): add nullable change_group_id column + migration 0030"
```

Then run `npm run check:all`.

---

### Task 2: `recordManualWithReturns` atomic repo method

**Files:**
- Modify: `src/transactions/repo/transactions.repo.ts` (`ManualTransaction` type ~line 30; `recordManualTx` ~lines 74-107; add `ChangeReturn`/`ManualWithReturnsInput` + `recordManualWithReturns` inside `transactionsRepo`)
- Test: `src/transactions/repo/transactions.repo.test.ts`

**Interfaces:**
- Consumes: `TransactionRow` (`src/db/schema.ts`, now carrying `changeGroupId`); the module-local `recordManualTx(tx, ManualTransaction)`; the `write(...)` helper; `id()`.
- Produces:
  - `type ChangeReturn = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits'>` (each `amountMinorUnits > 0`).
  - `type ManualWithReturnsInput = { payment: ManualTransaction; returns: ChangeReturn[] }`.
  - `transactionsRepo.recordManualWithReturns(input: ManualWithReturnsInput): Promise<void>` — writes the payment row + one row per return, all sharing a single generated `changeGroupId`, in ONE `write(...)`.
  - `ManualTransaction` now also accepts an optional `changeGroupId`.

- [ ] **Step 1: Write the failing test**

Append to `src/transactions/repo/transactions.repo.test.ts` (reusing the existing module-level `makeExchangeTx` helper and the `holdings` schema import already at the top of the file):

```ts
describe('transactionsRepo.recordManualWithReturns', () => {
  it('writes the payment + N return rows sharing ONE changeGroupId in one transaction', async () => {
    const { tx, inserts, updates } = makeExchangeTx([
      [{ balanceMinorUnits: 50_000 }], // payer balance read
      [{ balanceMinorUnits: 1_000 }], // return holding B balance read
      [{ balanceMinorUnits: 2_000 }], // return holding C balance read
    ]);
    mockTx = tx;

    await transactionsRepo.recordManualWithReturns({
      payment: {
        holdingId: 'payer-1',
        amountMinorUnits: -21_200,
        time: 123,
        category: 'groceries',
      },
      returns: [
        { holdingId: 'hold-b', amountMinorUnits: 20 },
        { holdingId: 'hold-c', amountMinorUnits: 8 },
      ],
    });

    // One shared group id across all three rows.
    const groupIds = inserts.map((row) => row.changeGroupId);
    expect(new Set(groupIds).size).toBe(1);
    expect(groupIds[0]).toEqual(expect.any(String));

    expect(inserts).toEqual([
      expect.objectContaining({
        holdingId: 'payer-1',
        amountMinorUnits: -21_200,
        time: 123,
        category: 'groceries',
        source: 'manual',
      }),
      expect.objectContaining({
        holdingId: 'hold-b',
        amountMinorUnits: 20,
        time: 123,
        source: 'manual',
      }),
      expect.objectContaining({
        holdingId: 'hold-c',
        amountMinorUnits: 8,
        time: 123,
        source: 'manual',
      }),
    ]);

    // base 50_000 - 21_200 = 28_800 (payer); 1_000 + 20 = 1_020; 2_000 + 8 = 2_008
    expect(updates).toEqual([
      { table: holdings, values: { balanceMinorUnits: 28_800 } },
      { table: holdings, values: { balanceMinorUnits: 1_020 } },
      { table: holdings, values: { balanceMinorUnits: 2_008 } },
    ]);
  });

  it('writes only the payment row when there are no returns', async () => {
    const { tx, inserts, updates } = makeExchangeTx([[{ balanceMinorUnits: 50_000 }]]);
    mockTx = tx;

    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'payer-1', amountMinorUnits: -5_000, time: 7, category: 'transport' },
      returns: [],
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual(expect.objectContaining({ holdingId: 'payer-1', amountMinorUnits: -5_000 }));
    expect(updates).toEqual([{ table: holdings, values: { balanceMinorUnits: 45_000 } }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/transactions/repo/transactions.repo.test.ts -t recordManualWithReturns`
Expected: FAIL — `transactionsRepo.recordManualWithReturns is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/transactions/repo/transactions.repo.ts`, extend the `ManualTransaction` type (currently ends `'description' | 'category' | 'exchangeCounterpartHoldingId'`) to also allow `changeGroupId`:

```ts
type ManualTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time'> &
  Partial<
    Pick<TransactionRow, 'description' | 'category' | 'exchangeCounterpartHoldingId' | 'changeGroupId'>
  >;
```

In `recordManualTx`, destructure `changeGroupId` and persist it in the insert `values`:

```ts
const recordManualTx = async (
  tx: typeof database,
  {
    holdingId,
    amountMinorUnits,
    time,
    description,
    category,
    exchangeCounterpartHoldingId,
    changeGroupId,
  }: ManualTransaction,
): Promise<void> => {
  await tx.insert(transactions).values({
    id: id(),
    holdingId,
    amountMinorUnits,
    time,
    description: description ?? '',
    category: category ?? null,
    exchangeCounterpartHoldingId: exchangeCounterpartHoldingId ?? null,
    changeGroupId: changeGroupId ?? null,
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

Add the new types just after the existing `ExchangeCounterpartInput` type block (before `recordManualTx`):

```ts
// One change-return of a split payment: a POSITIVE amount on a holding OTHER
// than the payer. `recordManualWithReturns` writes each as its own manual row,
// tied to the payment by a shared `changeGroupId`.
type ChangeReturn = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits'>;

type ManualWithReturnsInput = {
  // The full payment (amount < 0), carrying its category, on the paying holding.
  payment: ManualTransaction;
  // Each return (amount > 0) on a DIFFERENT holding, in the payment's currency.
  returns: ChangeReturn[];
};
```

Add the method inside the `transactionsRepo` object (after `recordExchangeCounterpart`, same `write(...)`-per-movement shape as `recordExchange`):

```ts
  /**
   * Record a manual payment and N linked change-returns as N+1 INDEPENDENT
   * ledger rows in ONE op-sqlite transaction, tied by a shared generated
   * `changeGroupId`. The payment (amount < 0) lands on its own holding carrying
   * its category; each return (amount > 0) lands on a DIFFERENT holding. Net
   * worth nets automatically because every balance moves inside the one
   * transaction; the spending pie nets the linked returns into the payment's
   * category (statistics/category-breakdown). Any failure rolls back every row,
   * so the ledger and every balance can never desync. Balances are read INSIDE
   * the transaction, never from a render snapshot, exactly as `recordManual`
   * does.
   */
  recordManualWithReturns: (input: ManualWithReturnsInput) =>
    write(async (tx) => {
      const changeGroupId = id();

      await recordManualTx(tx, { ...input.payment, changeGroupId });

      for (const change of input.returns) {
        await recordManualTx(tx, {
          holdingId: change.holdingId,
          amountMinorUnits: change.amountMinorUnits,
          time: input.payment.time,
          changeGroupId,
        });
      }
    }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/transactions/repo/transactions.repo.test.ts -t recordManualWithReturns`
Expected: PASS. Then run the whole file: `npx jest src/transactions/repo/transactions.repo.test.ts` (the added `changeGroupId` insert key must not break existing `recordManual`/`recordExchange` assertions — they use `toMatchObject`/`objectContaining`, so an extra key is tolerated).

- [ ] **Step 5: Commit**

```bash
git add src/transactions/repo/transactions.repo.ts src/transactions/repo/transactions.repo.test.ts
git commit -m "feat(transactions): recordManualWithReturns writes payment + linked returns atomically"
```

Then run `npm run check:all`.

---

### Task 3: `buildCategoryBreakdown` nets linked change-returns

**Files:**
- Modify: `src/statistics/category-breakdown/category-breakdown.ts` (`BreakdownTransaction` type ~lines 19-30; the accumulation loop ~lines 142-167)
- Test: `src/statistics/category-breakdown/category-breakdown.test.ts` (`tx` fixture ~lines 22-31; add one test)

**Interfaces:**
- Consumes: `TransactionRow['changeGroupId']` (`string | null`, from Task 1).
- Produces: `BreakdownTransaction` now includes `changeGroupId: TransactionRow['changeGroupId']`; `buildCategoryBreakdown` subtracts a payment's linked positive returns from its category spend magnitude.

- [ ] **Step 1: Write the failing test**

First add `changeGroupId: null` to the `tx` fixture's defaults in `category-breakdown.test.ts` so existing rows are unaffected:

```ts
const tx = (over: Partial<BreakdownTransaction>): BreakdownTransaction => ({
  id: 'tx',
  category: 'groceries',
  amountMinorUnits: -10_00,
  mcc: null,
  counterIban: null,
  description: '',
  exchangeCounterpartHoldingId: null,
  changeGroupId: null,
  currency: 'UAH',
  ...over,
});
```

Then add the netting test inside `describe('buildCategoryBreakdown', ...)`:

```ts
  it('nets a split payment\'s linked change-returns into its category (not overstated by the change)', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ id: 'pay', category: 'groceries', amountMinorUnits: -212_00, changeGroupId: 'grp-1' }),
        tx({ id: 'r1', category: null, amountMinorUnits: 20, changeGroupId: 'grp-1' }),
        tx({ id: 'r2', category: null, amountMinorUnits: 8, changeGroupId: 'grp-1' }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
    });

    // −212_00 payment, +20 and +8 returns → the category shows the NET 211_72,
    // not the bare 212_00. The positive returns are skipped as income (never a
    // separate slice) and only reduce the payment's magnitude.
    expect(slices.map((slice) => slice.key)).toEqual(['groceries']);
    expect(slices[0].amount).toBe(211_72);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/statistics/category-breakdown/category-breakdown.test.ts -t "nets a split"`
Expected: FAIL — the category reads `212_00` (returns not netted), and the `tx` fixture / `BreakdownTransaction` do not yet carry `changeGroupId`.

- [ ] **Step 3: Write minimal implementation**

In `src/statistics/category-breakdown/category-breakdown.ts`, add `changeGroupId` to the `BreakdownTransaction` Pick union (after `'exchangeCounterpartHoldingId'`):

```ts
export type BreakdownTransaction = Pick<
  TransactionRow,
  | 'id'
  | 'category'
  | 'amountMinorUnits'
  | 'mcc'
  | 'counterIban'
  | 'description'
  | 'exchangeCounterpartHoldingId'
  | 'changeGroupId'
> & {
  currency: HoldingRow['currency'];
};
```

Inside `buildCategoryBreakdown`, after `const excludedIds = ...` and before the `totals` map, build the per-group return sums:

```ts
  // Sum the POSITIVE change-returns per group so a split payment's category is
  // netted by its change (design F2-6). Returns are same-currency as their
  // payment for v1, so this sums raw minor units in the payment's own currency.
  const returnsByGroup = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.changeGroupId !== null && transaction.amountMinorUnits > 0) {
      const running = returnsByGroup.get(transaction.changeGroupId) ?? 0;
      returnsByGroup.set(transaction.changeGroupId, running + transaction.amountMinorUnits);
    }
  }
```

Then, inside the main `for` loop, replace the `spend` computation. The current code is:

```ts
    const spend = convert(
      Money.of(transaction.currency, -transaction.amountMinorUnits),
      baseCurrency,
      rateTable,
    ).minorUnits;
```

Replace it with a netted magnitude (compute the magnitude before `convert`, and skip a payment whose returns cancel it out):

```ts
    const returned =
      transaction.changeGroupId !== null
        ? (returnsByGroup.get(transaction.changeGroupId) ?? 0)
        : 0;
    const netMagnitude = -transaction.amountMinorUnits - returned;

    if (netMagnitude <= 0) {
      continue;
    }

    const spend = convert(
      Money.of(transaction.currency, netMagnitude),
      baseCurrency,
      rateTable,
    ).minorUnits;
```

(The positive return rows are already skipped by the existing `if (transaction.amountMinorUnits >= 0) continue;` guard, so they never form their own slice — they only reduce the payment's magnitude here.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/statistics/category-breakdown/category-breakdown.test.ts`
Expected: PASS (the new netting test and every existing test, since a non-split row has `changeGroupId: null` and `returned` is `0`).

- [ ] **Step 5: Commit**

```bash
git add src/statistics/category-breakdown/category-breakdown.ts src/statistics/category-breakdown/category-breakdown.test.ts
git commit -m "feat(statistics): net split-change returns into the payment category in the pie"
```

Then run `npm run check:all`.

---

### Task 3b: `buildCategoryTrend` nets linked change-returns

**Files:**
- Modify: `src/statistics/category-trend/category-trend.ts` (`accumulateSpend` — add the per-group return sums before the loop ~line 111; net the `spend` computation ~lines 136-140)
- Modify: `src/screens/statistics/statistics.screen.tsx` (`trendTransactions` projection memo ~lines 448-462) — thread `changeGroupId` into the trend's OWN screen projection
- Test: `src/statistics/category-trend/category-trend.test.ts` (`tx` fixture ~lines 23-34; add one netting test)

**Interfaces:**
- Consumes: `BreakdownTransaction['changeGroupId']` (`string | null`, added by Task 3). `category-trend.ts` needs NO new type — its input `TrendTransaction = BreakdownTransaction & { time: number }` (`category-trend.ts:38`) already inherits `changeGroupId` from Task 3's `BreakdownTransaction`. So this task NETS only; it does NOT define a new type.
- Produces: the shared `accumulateSpend` (used by BOTH `buildCategoryTrend` — the line — AND `buildCategoryMeasures` — the Top-N ranking) subtracts a payment's linked positive returns from its per-day and total spend magnitude, so a category's trend value for the affected period is `|payment| − Σreturns`, never the bare `|payment|`. `trendTransactions` (`statistics.screen.tsx`) now carries `changeGroupId` into both trend builders.
- Cross-task note: category-trend consumes a SEPARATE screen projection (`trendTransactions`, `statistics.screen.tsx:448-462`) from the pie's (`breakdownTransactions`/`rangeFilteredBreakdownTransactions`, `:405-442`). Task 4 threads the query column + the pie projections; THIS task threads the trend projection. Because Task 3 makes `changeGroupId` a REQUIRED field of `BreakdownTransaction`, all three projection memos must carry it or typecheck fails — Task 4 owns the two pie memos, this task owns `trendTransactions`.

- [ ] **Step 1: Write the failing test**

First add `changeGroupId: null` to the `tx` fixture defaults in `category-trend.test.ts` (after `exchangeCounterpartHoldingId: null,`) so existing rows are unaffected:

```ts
const tx = (over: Partial<TrendTransaction>): TrendTransaction => ({
  id: 'tx',
  category: 'groceries',
  amountMinorUnits: -10_00,
  mcc: null,
  counterIban: null,
  description: '',
  exchangeCounterpartHoldingId: null,
  changeGroupId: null,
  currency: 'UAH' as BreakdownTransaction['currency'],
  time: NOW,
  ...over,
});
```

Then add the netting test inside `describe('buildCategoryTrend', ...)`:

```ts
  it("nets a split payment's linked change-returns into its trend line (not overstated by the change)", () => {
    const series = buildTrend([
      tx({ id: 'pay', category: 'groceries', amountMinorUnits: -212_00, time: NOW, changeGroupId: 'grp-1' }),
      tx({ id: 'r1', category: null, amountMinorUnits: 20, time: NOW, changeGroupId: 'grp-1' }),
      tx({ id: 'r2', category: null, amountMinorUnits: 8, time: NOW, changeGroupId: 'grp-1' }),
    ]);
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    // −212_00 payment, +20 and +8 returns → the day bucket shows the NET 211_72
    // (211.72 in base MAJOR units), not the bare 212_00. The positive returns are
    // already skipped as income and only reduce the payment's magnitude.
    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
    expect(nonZero).toEqual([{ t: dayBucketOf(NOW), amount: 211.72 }]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/statistics/category-trend/category-trend.test.ts -t "nets a split"`
Expected: FAIL — the trend day bucket reads `212` (returns not netted); the added `changeGroupId: 'grp-1'` payment magnitude is not reduced.

- [ ] **Step 3: Write minimal implementation**

In `src/statistics/category-trend/category-trend.ts`, inside `accumulateSpend`, immediately after `const totals = new Map<string, TrendAccumulator>();` (line 111) and before the main `for` loop, build the per-group return sums (mirrors Task 3's `buildCategoryBreakdown`):

```ts
  // Sum the POSITIVE change-returns per group so a split payment's trend value is
  // netted by its change (design F2-7), exactly as buildCategoryBreakdown nets
  // the pie. Returns share the payment's currency AND time for v1, so a payment
  // and its returns always land in the same day bucket — summing raw minor units
  // in the payment's own currency here is safe.
  const returnsByGroup = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.changeGroupId !== null && transaction.amountMinorUnits > 0) {
      const running = returnsByGroup.get(transaction.changeGroupId) ?? 0;
      returnsByGroup.set(transaction.changeGroupId, running + transaction.amountMinorUnits);
    }
  }
```

Then, inside the main `for` loop, replace the `spend` computation. The current code (lines 136-140) is:

```ts
    const spend = convert(
      Money.of(transaction.currency, -transaction.amountMinorUnits),
      baseCurrency,
      rateTable,
    ).minorUnits;
```

Replace it with a netted magnitude (compute the magnitude first, and skip a payment whose returns fully cancel it):

```ts
    const returned =
      transaction.changeGroupId !== null
        ? (returnsByGroup.get(transaction.changeGroupId) ?? 0)
        : 0;
    const netMagnitude = -transaction.amountMinorUnits - returned;

    if (netMagnitude <= 0) {
      continue;
    }

    const spend = convert(
      Money.of(transaction.currency, netMagnitude),
      baseCurrency,
      rateTable,
    ).minorUnits;
```

(The positive return rows are already skipped by the existing `if (transaction.amountMinorUnits >= 0) continue;` guard at line 114, so they never form their own line — they only reduce the payment's magnitude here. Because the fix lives in the shared `accumulateSpend`, both `buildCategoryTrend` and `buildCategoryMeasures` net automatically — no second edit.)

Then thread the value through the screen: in `src/screens/statistics/statistics.screen.tsx`, in the `trendTransactions` memo (~lines 448-462), add `changeGroupId: transaction.changeGroupId,` to the mapped object, alongside `exchangeCounterpartHoldingId`, so the real group id reaches `buildCategoryTrend`/`buildCategoryMeasures`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/statistics/category-trend/category-trend.test.ts`
Expected: PASS (the new netting test and every existing test, since a non-split row has `changeGroupId: null` and `returned` is `0`). Then run `npm run check:typecheck` to confirm the `trendTransactions` projection now satisfies `TrendTransaction` (whose `changeGroupId` is required after Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/statistics/category-trend/category-trend.ts src/statistics/category-trend/category-trend.test.ts src/screens/statistics/statistics.screen.tsx
git commit -m "feat(statistics): net split-change returns into the category trend line"
```

Then run `npm run check:all`.

---

### Task 4: Thread `changeGroupId` from the DB query to the pie

**Files:**
- Modify: `src/transactions/repo/transactions.repo.ts` (`listAllWithContextQuery` select ~lines 245-268)
- Modify: `src/screens/statistics/statistics.screen.tsx` (`breakdownTransactions` projection — the memo that maps context rows into `BreakdownTransaction[]`)
- Test: `src/transactions/repo/transactions.repo.test.ts` (the existing `listAllWithContextQuery` SQL test ~line 81)

**Interfaces:**
- Consumes: `transactions.changeGroupId` column (Task 1); `BreakdownTransaction.changeGroupId` (Task 3).
- Produces: `listAllWithContextQuery()` result rows now include `changeGroupId: string | null`; `statistics.screen.tsx`'s `breakdownTransactions` carries it into `buildCategoryBreakdown`.

- [ ] **Step 1: Write the failing test**

The existing test at line 81 asserts the joined query exposes account/holding labels. Extend its assertion (or add a sibling `it`) in `transactions.repo.test.ts`:

```ts
  it('includes the change group id in the joined all-transactions projection', () => {
    const sql = transactionsRepo.listAllWithContextQuery().toSQL().sql;

    expect(sql).toContain('change_group_id');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/transactions/repo/transactions.repo.test.ts -t "change group id in the joined"`
Expected: FAIL — the projection does not select `change_group_id`.

- [ ] **Step 3: Write minimal implementation**

In `src/transactions/repo/transactions.repo.ts`, inside the `listAllWithContextQuery` select object, add `changeGroupId` next to `exchangeCounterpartHoldingId`:

```ts
        // The exchange marker travels with the display projection: Home reads
        // it to resolve an exchange leg's label, and Statistics reads it to
        // drop both legs from the spending pie.
        exchangeCounterpartHoldingId: transactions.exchangeCounterpartHoldingId,
        // The split-change group id travels too: the spending pie nets a
        // payment's linked returns into its category (statistics/category-breakdown).
        changeGroupId: transactions.changeGroupId,
        category: transactions.category,
```

In `src/screens/statistics/statistics.screen.tsx`, find the `breakdownTransactions` memo (the one that maps `transactions` — the `listAllWithContextQuery` live-query data — into `BreakdownTransaction[]`, near the `exchangeExcludedTxIds(breakdownTransactions)` usage at line 500). Add `changeGroupId: transaction.changeGroupId` to the mapped object so it reaches `buildCategoryBreakdown`. (The exact object literal lives in that memo; add the one field alongside `exchangeCounterpartHoldingId`.) Because Task 3 makes `changeGroupId` a REQUIRED field of `BreakdownTransaction`, add the same field to BOTH pie projection memos that build `BreakdownTransaction[]` — `breakdownTransactions` (~line 405) AND `rangeFilteredBreakdownTransactions` (~line 427) — or typecheck fails on the missing property. (The trend's own `trendTransactions` memo, ~line 448, is threaded in Task 3b.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/transactions/repo/transactions.repo.test.ts -t "change group id in the joined"`
Expected: PASS. Then `npm run check:typecheck` to confirm the screen projection now satisfies `BreakdownTransaction` (which requires `changeGroupId` after Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/transactions/repo/transactions.repo.ts src/transactions/repo/transactions.repo.test.ts src/screens/statistics/statistics.screen.tsx
git commit -m "feat(statistics): carry change_group_id from the ledger query into the pie"
```

Then run `npm run check:all`.

---

### Task 5: `seedCounterpartMinorUnits` prefill helper (Feature 1)

**Files:**
- Create: `src/holdings/exchange-prefill/exchange-prefill.ts`
- Create: `src/holdings/exchange-prefill/exchange-prefill.test.ts`
- Create: `src/holdings/exchange-prefill/index.ts`

**Interfaces:**
- Consumes: `Money` (`src/currency/money`); `convert`/`RateTable` (`src/rates/conversion`); `Currency` (`src/currency/currency`).
- Produces:
  ```ts
  seedCounterpartMinorUnits(input: {
    sourceAmountMinorUnits: number;
    sourceCurrency: Currency;
    counterpartCurrency: Currency;
    rateTable: RateTable;
  }): number | null
  ```
  Returns the counterpart leg's amount in its own minor units (a positive magnitude), or `null` when no cached rate exists for the cross-currency pair. Same-currency returns `Math.abs(sourceAmountMinorUnits)` (1:1).

- [ ] **Step 1: Write the failing test**

Create `src/holdings/exchange-prefill/exchange-prefill.test.ts`:

```ts
import { seedCounterpartMinorUnits } from './exchange-prefill';

describe('seedCounterpartMinorUnits', () => {
  it('seeds 1:1 (magnitude) when the source and counterpart currencies match', () => {
    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -500_00,
      sourceCurrency: 'UAH',
      counterpartCurrency: 'UAH',
      rateTable: {},
    });

    expect(seeded).toBe(500_00);
  });

  it('converts the withdrawal magnitude via the cached cross-rate', () => {
    // 20.00 USD withdrawn, USD:UAH = 41.5 → 830.00 UAH counterpart.
    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -20_00,
      sourceCurrency: 'USD',
      counterpartCurrency: 'UAH',
      rateTable: { 'USD:UAH': 41.5 },
    });

    expect(seeded).toBe(830_00);
  });

  it('returns null when no cached rate exists for the cross pair (leave the field blank)', () => {
    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -20_00,
      sourceCurrency: 'USD',
      counterpartCurrency: 'EUR',
      rateTable: { 'USD:UAH': 41.5 },
    });

    expect(seeded).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/holdings/exchange-prefill/exchange-prefill.test.ts`
Expected: FAIL — module `./exchange-prefill` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/holdings/exchange-prefill/exchange-prefill.ts`:

```ts
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import { convert, type RateTable } from '../../rates/conversion';

// Seed the Convert flow's counterpart amount (Feature 1): the cash leg's amount
// in ITS OWN minor units, from the withdrawal magnitude and the latest cached
// rate. Same currency → 1:1. A missing cross-rate → null, so the form leaves the
// field BLANK and editable rather than crashing (convert throws on a missing
// pair). The bank withdrawal row is never touched by this — it is pure math.
export const seedCounterpartMinorUnits = (input: {
  sourceAmountMinorUnits: number;
  sourceCurrency: Currency;
  counterpartCurrency: Currency;
  rateTable: RateTable;
}): number | null => {
  const { sourceAmountMinorUnits, sourceCurrency, counterpartCurrency, rateTable } = input;
  const magnitude = Math.abs(sourceAmountMinorUnits);

  if (sourceCurrency === counterpartCurrency) {
    return magnitude;
  }

  if (rateTable[`${sourceCurrency}:${counterpartCurrency}`] === undefined) {
    return null;
  }

  return convert(Money.of(sourceCurrency, magnitude), counterpartCurrency, rateTable).minorUnits;
};
```

Create `src/holdings/exchange-prefill/index.ts`:

```ts
export { seedCounterpartMinorUnits } from './exchange-prefill';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/holdings/exchange-prefill/exchange-prefill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/holdings/exchange-prefill
git commit -m "feat(holdings): seedCounterpartMinorUnits prefill helper for card->cash convert"
```

Then run `npm run check:all`.

---

### Task 6: Money-path build-6 guard test (MANDATORY)

**Files:**
- Create: `src/transactions/repo/money-path.test.ts`

**Interfaces:**
- Consumes: `transactionsRepo.recordManualWithReturns` (Task 2), `transactionsRepo.recordExchangeCounterpart` (existing); `buildCategoryBreakdown` (Task 3); `buildCategoryTrend` (Task 3b); `seedCounterpartMinorUnits` (Task 5); `guardedNetWorth`/`buildRateTable` (`src/rates/net-worth-view`); the `holdings`/`transactions` schema objects.
- Produces: a regression guard (no new production symbols).

This test models `src/rates/rates-refresh/crypto-coverage.test.ts` — it drives the REAL logic through fast seams (the `write(...)` mock + fake tx handle for the repo methods, and the pure `buildCategoryBreakdown`/`buildCategoryTrend`/`seedCounterpartMinorUnits` functions), no simulator.

- [ ] **Step 1: Write the failing test**

Create `src/transactions/repo/money-path.test.ts`:

```ts
// Money-path guard (build-6 regression class): a split-change transaction must
// not distort net worth or the spending pie, and Feature 1's convert prefill
// must seed the right counterpart amount without ever mutating the bank row.
// Modeled on rates-refresh/crypto-coverage.test.ts: drive the real logic
// through fast seams, no simulator.
let mockTx: unknown;
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { buildCategoryTrend } from '../../statistics/category-trend';
import { buildCategoryBreakdown } from '../../statistics/category-breakdown';
import { seedCounterpartMinorUnits } from '../../holdings/exchange-prefill';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import { holdings, transactions } from '../../db/schema';

import { transactionsRepo } from './transactions.repo';

// A fake tx handle capturing inserts + balance updates in call order, answering
// both the chained `.where(...).limit(1)` and the bare `await where(...)`
// conventions — same shape as transactions.repo.test.ts's makeExchangeTx.
const makeTx = (
  selectQueue: unknown[][],
): {
  tx: unknown;
  inserts: Record<string, unknown>[];
  updates: { table: unknown; values: Record<string, unknown> }[];
} => {
  const inserts: Record<string, unknown>[] = [];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const queue = [...selectQueue];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = queue.shift() ?? [];
          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { where: () => Promise.resolve() };
      },
    }),
  };

  return { tx, inserts, updates };
};

describe('Money-path guard: split-change + convert prefill', () => {
  it('keeps net worth correct after a split-change (payment + N linked returns)', async () => {
    // Opening balances: payer 500_00, holding B 10_00, holding C 20_00 UAH.
    const opening = { 'payer-1': 500_00, 'hold-b': 10_00, 'hold-c': 20_00 };
    const { tx, updates } = makeTx([
      [{ balanceMinorUnits: opening['payer-1'] }],
      [{ balanceMinorUnits: opening['hold-b'] }],
      [{ balanceMinorUnits: opening['hold-c'] }],
    ]);
    mockTx = tx;

    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'payer-1', amountMinorUnits: -212_00, time: 1, category: 'groceries' },
      returns: [
        { holdingId: 'hold-b', amountMinorUnits: 20 },
        { holdingId: 'hold-c', amountMinorUnits: 8 },
      ],
    });

    // Apply the captured balance writes back onto the holdings and sum net worth
    // in UAH (base == each holding's currency, so no rate needed).
    const finalBalances = [
      { currency: 'UAH' as const, balanceMinorUnits: updates[0].values.balanceMinorUnits as number, type: 'cash' as const, metadata: null },
      { currency: 'UAH' as const, balanceMinorUnits: updates[1].values.balanceMinorUnits as number, type: 'cash' as const, metadata: null },
      { currency: 'UAH' as const, balanceMinorUnits: updates[2].values.balanceMinorUnits as number, type: 'cash' as const, metadata: null },
    ];
    const openingNet = 500_00 + 10_00 + 20_00;
    const net = guardedNetWorth(finalBalances, 'UAH', {}, 1);

    // Net worth moved by exactly the NET change: −(212_00 − 20 − 8) = −211_72.
    expect(net.minorUnits).toBe(openingNet - 211_72);
  });

  it('nets the linked returns in the spending pie (category not overstated by the change)', () => {
    const base = {
      mcc: null,
      counterIban: null,
      description: '',
      exchangeCounterpartHoldingId: null,
      currency: 'UAH' as const,
    };
    const slices = buildCategoryBreakdown({
      transactions: [
        { ...base, id: 'pay', category: 'groceries', amountMinorUnits: -212_00, changeGroupId: 'grp-1' },
        { ...base, id: 'r1', category: null, amountMinorUnits: 20, changeGroupId: 'grp-1' },
        { ...base, id: 'r2', category: null, amountMinorUnits: 8, changeGroupId: 'grp-1' },
      ],
      categoryDisplay: new Map(),
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'groceries',
    });

    expect(slices).toHaveLength(1);
    expect(slices[0].amount).toBe(211_72);
  });

  it('seeds the convert counterpart from a cached rate and leaves the bank row unmutated', async () => {
    // Prefill: a 20.00 USD synced card withdrawal → UAH cash at USD:UAH 41.5.
    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -20_00,
      sourceCurrency: 'USD',
      counterpartCurrency: 'UAH',
      rateTable: buildRateTable([{ base: 'USD', quote: 'UAH', rate: '41.5' }]),
    });

    expect(seeded).toBe(830_00);

    // Convert of a SYNCED (bank-owned) withdrawal: only the new cash leg is
    // written; the existing monobank row is never updated.
    const { tx, inserts, updates } = makeTx([
      [{ balanceMinorUnits: 0 }], // the new cash leg's balance read
      [{ source: 'monobank' }], // the existing bank row, read inside the tx
    ]);
    mockTx = tx;

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'cash-1',
      counterpartType: 'cash',
      amountMinorUnits: seeded as number,
      existingTransactionId: 'bank-withdrawal-1',
      existingHoldingId: 'card-1',
      time: 1,
    });

    // One new leg inserted on the cash holding; the transactions table was never
    // written (the bank row stays untouched).
    expect(inserts).toEqual([
      expect.objectContaining({
        holdingId: 'cash-1',
        amountMinorUnits: 830_00,
        exchangeCounterpartHoldingId: 'card-1',
        source: 'manual',
      }),
    ]);
    expect(updates.every((update) => update.table !== transactions)).toBe(true);
    expect(updates.some((update) => update.table === holdings)).toBe(true);
  });

  it('nets the linked returns in the category trend line (period not overstated by the change)', () => {
    // A fixed "today" so the 30-day window is deterministic; the split payment
    // and its two returns all fall on this same UTC day.
    const now = Date.UTC(2025, 2, 31, 12, 0, 0);
    const base = {
      mcc: null,
      counterIban: null,
      description: '',
      exchangeCounterpartHoldingId: null,
      currency: 'UAH' as const,
    };
    const series = buildCategoryTrend({
      transactions: [
        { ...base, id: 'pay', category: 'groceries', amountMinorUnits: -212_00, changeGroupId: 'grp-1', time: now },
        { ...base, id: 'r1', category: null, amountMinorUnits: 20, changeGroupId: 'grp-1', time: now },
        { ...base, id: 'r2', category: null, amountMinorUnits: 8, changeGroupId: 'grp-1', time: now },
      ],
      categoryDisplay: new Map(),
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'groceries',
      now,
    });

    // The affected day's trend value is the NET |payment| − Σreturns = 211_72
    // (211.72 in base MAJOR units), not the bare 212_00 — the trend nets exactly
    // like the pie (same shared accumulateSpend).
    expect(series).toHaveLength(1);
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    expect(nonZero).toEqual([{ t: Date.UTC(2025, 2, 31), amount: 211.72 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/transactions/repo/money-path.test.ts`
Expected: PASS if Tasks 2/3/3b/5 are complete — but run it now to confirm it exercises the real code. If any dependency task is incomplete it FAILS with a missing symbol; that is the guard doing its job. (This task is authored AFTER Tasks 2, 3, 3b, and 5, so it should pass on first green run.)

- [ ] **Step 3: Write minimal implementation**

None — this is a pure guard test over already-implemented logic. If any assertion fails, fix the PRODUCTION code in the owning task (2/3/3b/5), never the assertion.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/transactions/repo/money-path.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add src/transactions/repo/money-path.test.ts
git commit -m "test(transactions): money-path guard for split-change net worth, pie netting, convert prefill"
```

Then run `npm run check:all`, and — since Feature 2's data layer + Feature 1's helper are now complete — run `npm run check:deep` once to gate mutation + osv-scanner on the money path.

---

### Task 7: Split-change form UI + `saveSplit` (HOLD — plan-only until the form is cleared)

**Files:**
- Modify: `src/screens/forms/transaction-form.screen.tsx`
- Test: `src/screens/forms/transaction-form.screen.test.tsx` (the existing form test file)

**HOLD:** The transaction form overlaps an in-flight UI-tweaks track. Do NOT edit this file until the coordinator confirms the overlapping track has landed. Implement Tasks 7 and 8 together in one form pass to avoid two rounds of edits on a shared file.

**Interfaces:**
- Consumes: `transactionsRepo.recordManualWithReturns` (Task 2); the existing `HoldingSelectField` (`src/screens/forms/holding-select-field`), `TextField`, `resolveModeOptions` (line 236), `buildExchangeOptions` (line 281), `isExchangeSourceType`/`isExchangeDestinationType` (`src/holdings/exchange-destination`), `parseAmount` (`src/currency/parse`), `Money`, `signedMinorUnits` (line 128).
- Produces: a `'split'` create-mode path; a dynamic list of `{ holdingId, amount }` return rows in component state; a `saveSplit` handler.

- [ ] **Step 1: Write the failing test**

Add to `src/screens/forms/transaction-form.screen.test.tsx` an RNTL test that: renders the add-transaction form on a manual (non-synced) cash holding, selects Expense, enters the mode's Split option, adds two return rows targeting two distinct OTHER open holdings with amounts `0.20` and `0.08`, enters a payment amount of `212.00`, taps Save, and asserts `transactionsRepo.recordManualWithReturns` was called once with `payment.amountMinorUnits === -212_00`, `payment.category` set, and `returns` `[{ holdingId, amountMinorUnits: 20 }, { holdingId, amountMinorUnits: 8 }]`. Mock `transactionsRepo.recordManualWithReturns` with `jest.spyOn(transactionsRepo, 'recordManualWithReturns').mockResolvedValue(undefined)`. Model the render/mock setup on the existing form tests in this file (they already mock the repo and `useLiveQuery`).

Add a second test asserting Save is DISABLED when `Σ returns >= |payment|` (enter payment `0.20`, one return `0.20`) and when two return rows target the SAME holding.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx -t split`
Expected: FAIL — there is no Split mode, no return-row UI, and no `saveSplit` path.

- [ ] **Step 3: Write minimal implementation**

In `resolveModeOptions` (line 236), when `canExchange`-style eligibility holds for a manual expense create, add `'split'` to the returned options. Split, like Exchange, is CREATE-ONLY and only on a manual (non-`isReadOnly`) holding. Keep Exchange's cash-only rule independent; Split is offered on any create where the payer is an eligible expense source (reuse `isExchangeSourceType` for the payer being a liquid cash/card holding, or offer it on every manual create expense — follow the spec: "any open holding except the payer" for TARGETS; the payer is the current `holding`). Add `'split'` to the `FormMode` union.

Add component state for the return rows:

```ts
const [changeReturns, setChangeReturns] = useState<{ holdingId: string | null; amount: string }[]>([
  { holdingId: null, amount: '' },
]);
const isSplit = mode === 'split';
```

Render (only when `isSplit`): the payment `TextField` (reusing the existing Amount field for the full payment magnitude), then a dynamic list — one row per `changeReturns` entry, each a `HoldingSelectField` (options = `buildExchangeOptions(holdings, accountNameById, accountOrderById, holdingId, isExchangeDestinationType)` further filtered to holdings NOT already picked in another return row AND matching the payer's currency) + a `TextField` (decimal-pad, currency suffix = payer's currency symbol) + a `destructiveTonal` `size="small"` trash Remove button (kiko-design-system "Button"). An "Add return" button appends `{ holdingId: null, amount: '' }`.

Add a pure validation helper at module scope:

```ts
// Whether a split payment + its returns are writable: a positive payment, at
// least one return, each return a positive amount on a DISTINCT holding other
// than the payer, and Σ returns strictly less than |payment| (the net stays an
// expense). Same-currency returns only for v1 (enforced by the picker's filter).
const canSaveSplit = (
  paymentAmount: string,
  returns: readonly { holdingId: string | null; amount: string }[],
  payerHoldingId: string | undefined,
): boolean => {
  const payment = parseAmount(paymentAmount);

  if (Number.isNaN(payment) || payment <= 0 || returns.length === 0) {
    return false;
  }

  const ids = new Set<string>();
  let sum = 0;

  for (const change of returns) {
    const value = parseAmount(change.amount);

    if (change.holdingId === null || change.holdingId === payerHoldingId) {
      return false;
    }

    if (ids.has(change.holdingId)) {
      return false;
    }

    if (Number.isNaN(value) || value <= 0) {
      return false;
    }

    ids.add(change.holdingId);
    sum += value;
  }

  return sum < payment;
};
```

Wire `canSaveSplit` into the footer disabled logic (the `SaveDisabledParams`/`isSaveDisabled` helper, line 172) for the split branch.

Add `saveSplit` (modeled on `saveExchange`, line 950), converting each major amount to minor units in the payer's currency via `Money.fromMajor(holding.currency, parseAmount(...))`:

```ts
const saveSplit = async (): Promise<void> => {
  if (holding === undefined || !canSaveSplit(amount, changeReturns, holding.id)) {
    return;
  }

  const paymentMinor = Money.fromMajor(holding.currency, parseAmount(amount)).minorUnits;

  await transactionsRepo.recordManualWithReturns({
    payment: {
      holdingId: holding.id,
      amountMinorUnits: -paymentMinor,
      time,
      description,
      category: selectedCategory,
    },
    returns: changeReturns.map((change) => ({
      // canSaveSplit has proven holdingId is non-null and the amount positive.
      holdingId: change.holdingId as string,
      amountMinorUnits: Money.fromMajor(holding.currency, parseAmount(change.amount)).minorUnits,
    })),
  });

  navigation.goBack();
};
```

Dispatch it from `save` (line 1045) before the `isExchange` branch:

```ts
if (isSplit) {
  await saveSplit();

  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx -t split`
Expected: PASS. Then run the whole form test file to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/transaction-form.screen.tsx src/screens/forms/transaction-form.screen.test.tsx
git commit -m "feat(forms): split-change mode records a payment with linked returns"
```

Then run `npm run check:all`.

---

### Task 8: Feature 1 convert prefill wiring in the form (HOLD — plan-only until the form is cleared)

**Files:**
- Modify: `src/screens/forms/transaction-form.screen.tsx`
- Test: `src/screens/forms/transaction-form.screen.test.tsx`

**HOLD:** Same shared-file hold as Task 7 — implement in the same form pass.

**Interfaces:**
- Consumes: `seedCounterpartMinorUnits` (Task 5); `ratesRepo.allQuery` (`@kiko/rates/repo`); `buildRateTable` (`src/rates/net-worth-view`); `useLiveQuery`; the existing `groupAmount`/`majorAmountText` (`./amount-format`), `convertView`, `counterpartHoldingId`/`setCounterpartAmount`, `existing`, `currency`, `holdings`.
- Produces: on picking a counterpart holding during an eligible `record-destination` convert, `counterpartAmount` is seeded from the latest cached rate; a missing rate leaves it blank.

- [ ] **Step 1: Write the failing test**

Add to `src/screens/forms/transaction-form.screen.test.tsx` an RNTL test: render the form in EDIT mode on a SYNCED monobank card withdrawal (`source: 'monobank'`, `amountMinorUnits: -20_00`, currency `USD`), enter Convert, pick a UAH cash destination holding, with a `currency_rates` live-query row `{ base: 'USD', quote: 'UAH', rate: '41.5' }`. Assert the counterpart amount field displays `830` (grouped `830`). Add a second case: with NO `USD:UAH` rate row, the field stays blank after picking the destination. Mock `useLiveQuery` for `ratesRepo.allQuery()` the same way the file mocks the other live queries.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx -t prefill`
Expected: FAIL — the counterpart field stays empty; no rate query is wired.

- [ ] **Step 3: Write minimal implementation**

Add the rates live query near the other `useLiveQuery` calls (line 686):

```ts
const { data: rateRows } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
const rateTable = buildRateTable(rateRows);
```

Add a prefill effect after the hydration effect (after line ~810). Re-seed whenever the picked counterpart changes during an eligible expense-sourced convert:

```ts
// Feature 1: seed the counterpart (cash) amount from the latest cached rate the
// moment a destination is picked on an expense-sourced convert (a card→cash
// withdrawal). Same currency → 1:1; a missing rate leaves the field blank and
// editable (seedCounterpartMinorUnits returns null). The synced bank row is
// never touched — this only fills a form field.
useEffect(() => {
  if (!convertView.eligible || convertView.direction !== 'record-destination' || !existing) {
    return;
  }

  const counterpart = holdings.find((candidate) => candidate.id === counterpartHoldingId);

  if (counterpart === undefined) {
    return;
  }

  const seeded = seedCounterpartMinorUnits({
    sourceAmountMinorUnits: existing.amountMinorUnits,
    sourceCurrency: currency,
    counterpartCurrency: counterpart.currency,
    rateTable,
  });

  if (seeded === null) {
    return;
  }

  setCounterpartAmount(groupAmount(majorAmountText(counterpart.currency, seeded)));
  // Re-seed only on a destination change; a later user edit is preserved until
  // they pick a different destination.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: keyed on the picked counterpart only
}, [counterpartHoldingId]);
```

(If the project's lint forbids the disable comment, key the effect on `[counterpartHoldingId]` and read the other values through refs, or accept the exhaustive-deps set if it does not cause a clobber loop — verify against `npm run check:lint`, which is Biome, not ESLint; Biome has no `react-hooks/exhaustive-deps` rule, so the comment is likely unnecessary — remove it if `check:lint` passes without it.)

Add the imports (length-sorted within their groups):
- `import { ratesRepo } from '@kiko/rates/repo';` (external-alias group, alongside the other `@kiko/*` imports)
- `import { buildRateTable } from '../../rates/net-worth-view';` (parent group)
- `import { seedCounterpartMinorUnits } from '../../holdings/exchange-prefill';` (parent group)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx -t prefill`
Expected: PASS (both the seeded and the blank-on-missing-rate cases). Then run the whole form test file.

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/transaction-form.screen.tsx src/screens/forms/transaction-form.screen.test.tsx
git commit -m "feat(forms): prefill convert counterpart amount from the latest cached rate"
```

Then run `npm run check:all`, and `npm run check:deep` once more before declaring both features done.

---

## Self-Review

**1. Spec coverage.**
- §2 Feature 1 (Approach A convert + prefill): Task 5 (helper), Task 8 (form wiring), guard case 3 (Task 6). F1-2 latest cached rate → `ratesRepo.allQuery`/`buildRateTable` (Task 8). F1-3 same-currency 1:1 → Task 5 test. F1-4 missing rate blank → Task 5 `null` + Task 8 early return. F1-5 direct prefill, no rate field → Task 8 seeds `counterpartAmount` only. F1-6 bank row unmarked → guard case 3 asserts `transactions` never written; Approach C explicitly excluded per Global Constraints.
- §3 Feature 2: Task 1 (`changeGroupId` + migration), Task 2 (`recordManualWithReturns`), Task 3 (pie netting), Task 3b (trend netting), Task 4 (query/pie-screen wiring), Task 7 (form). F2-1 linked+netting = Tasks 1-4 + 3b. F2-2 validation (`>0` and `Σ<|payment|`) → `canSaveSplit` (Task 7). F2-3 distinct open holding except payer → `canSaveSplit` + picker filter (Task 7). F2-4 dynamic rows → Task 7. F2-5 separate linked rows → Task 2. F2-6/F2-7 netting now covers BOTH statistics call sites — the pie (`buildCategoryBreakdown`, Task 3) AND the category trend line + Top-N ranking (`accumulateSpend`, Task 3b), each netting a payment's linked returns out of its category spend magnitude. F2-8 same currency v1 → picker filter (Task 7); exchange+split deferred per Global Constraints. F2-9 gate on manual expense create → `resolveModeOptions` + `!isReadOnly`/`!isEditing` (Task 7).
- §6 harness checkpoints: `check:all` per task, `check:deep` after Task 6 and Task 8; migration via drizzle-kit + biome (Task 1).
- Mandatory money-path guard: Task 6 (four seams — net worth, pie netting, trend netting, convert prefill).

**2. Placeholder scan.** No "TBD"/"add validation"/"similar to Task N"/"handle edge cases". Every code step carries real code; the one cross-reference ("modeled on makeExchangeTx") reproduces the fake-tx builder in full in Task 6 rather than pointing at it.

**3. Type consistency.** `changeGroupId` (camelCase field, `change_group_id` column) is used identically in Tasks 1-4 and 3b. `recordManualWithReturns`/`ManualWithReturnsInput`/`ChangeReturn` match between Task 2 (definition) and Tasks 6/7 (callers). `seedCounterpartMinorUnits`'s signature (returns `number | null`) matches between Task 5 and its callers in Tasks 6/8. `BreakdownTransaction.changeGroupId` (Task 3) is consumed by Tasks 3b/4/6. Task 3 makes `changeGroupId` a REQUIRED field of `BreakdownTransaction`, so EVERY screen projection that builds a `BreakdownTransaction`/`TrendTransaction` must carry it or typecheck fails on the missing property: both pie memos `breakdownTransactions` and `rangeFilteredBreakdownTransactions` (Task 4) and the trend memo `trendTransactions` (Task 3b). `category-trend.ts` needs NO new type — `TrendTransaction = BreakdownTransaction & { time }` (`category-trend.ts:38`) inherits `changeGroupId` from Task 3; Task 3b is a netting-only edit to the shared `accumulateSpend`, so both `buildCategoryTrend` and `buildCategoryMeasures` net without a second change.
