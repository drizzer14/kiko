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
- `src/screens/statistics/use-focus-refreshed-now.ts` — the `useFocusRefreshedNow` hook (Task 9 F2).
- `src/screens/statistics/use-focus-refreshed-now.test.tsx` — unit test for the focus-refresh hook (Task 9 F2).
- `src/statistics/chart-balance-consistency.test.ts` — the balance-consistency invariant guard the by-type bar + account-contribution pie rely on (Task 9 F3).

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
- `src/rates/history-backfill/history-backfill.ts` — add the pure `planBackfillRun` re-run planner (Task 9 F1). Auto-re-exported by the `export *` barrel `src/rates/history-backfill/index.ts`.
- `src/rates/history-backfill/history-backfill.test.ts` — add the `planBackfillRun` unit tests (Task 9 F1).
- `src/screens/statistics/statistics.screen.tsx` — re-run the backfill when the span extends earlier (Task 9 F1); refresh `now` on focus via `useFocusRefreshedNow` (Task 9 F2). This is IN ADDITION to the `changeGroupId` threading Tasks 3b/4 already do to this file.

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

### Task 9: Chart-reactivity fixes (net-worth backfill re-run, focus-refreshed now, balance-consistency guard)

**Part of the pure-logic / no-form batch (NOT a HOLD form task); commit SEPARATELY from the feature commits for a clean review.** It edits `statistics.screen.tsx`, so it MUST run AFTER the stats trio (Tasks 3/3b/4) to build on their threaded `changeGroupId` field, never before. It does NOT touch the HELD `transaction-form.screen.tsx`, so it has no dependency on the UI-tweaks track that gates Tasks 7/8 — it can land any time after Task 4.

This task closes a chart live-sync audit that found two real gaps (F1, F2), one latent risk to guard (F3), and one item confirmed already-correct (F4):

- **F4 (confirmed, NO code):** `recordManualWithReturns` (Task 2) performs exactly ONE `write(...)` wrapping the payment insert + all return inserts + every balance update, so op-sqlite fires its reactive live-query callback ONCE and all charts (net worth, by-type bar, both pies, the trend line) refresh together in a single re-render. Verified against the real `transactions.repo.ts` (`recordManualWithReturns` is a single `write(async (tx) => { ... })` doing `recordManualTx` for the payment and each return inside the one transaction). No step needed — this audit item is closed.

Each of F1/F2/F3 gets its OWN commit (three commits, all separate from the feature commits), each followed by `npm run check:all`.

**Line-number note (verified against the real file):** `backfillStartedRef` is at `statistics.screen.tsx:274` and its effect at `:280-308` (accurate); `now` is defined at `:188`, used for the default `rangeTo` at `:263` and the backfill's `today` at `:293` (accurate). The three "value now" chart points the audit cited as `:322/:340/:352` are actually at `:321` (`buildTypeBreakdown` `now`), `:339` (`buildNetWorthSeries` `today: now`), and `:351` (`buildAccountContribution` `now`) — a 1-line drift; corrected here.

---

#### F1 [Medium — real fix]: re-run the net-worth backfill when the span extends earlier

**Problem (grounded in the real code):** the historical-rate backfill runs at most once per mount. The boolean `backfillStartedRef` (`statistics.screen.tsx:274`) is set `true` on first run and the effect (`:280-308`) never resets it, so adding an older-dated transaction while the screen is alive extends the line's span earlier (via `spanStart = earliestTime ?? now`, `:247`) but the early segment stays valued on missing rate history. Worse, a naive ref-reset alone would NOT fix it: `runBackfill`/`missingDays` (`src/rates/history-backfill/history-backfill.ts`) resume FORWARD from the single newest stored day (`deriveLastBackfilledDay`), so with a non-null `lastBackfilledDay` they compute days only ABOVE it and structurally cannot see a gap that opens up BELOW it. The re-run must therefore also recompute the whole span from the new, earlier `spanStart` (i.e. resume from `null`, whose idempotent upserts skip the already-stored newer days).

**Chosen approach:** extract a small pure planner helper, `planBackfillRun`, into `history-backfill.ts` (unit-testable, next to `missingDays`), and drive the effect off it — a hybrid of "re-key on the span" + "reset the guard", but computed in one pure decision. Replace the boolean `backfillStartedRef` with a ref holding the `spanStart` the last run covered; the planner decides whether to run and from where.

**Files:**
- Modify: `src/rates/history-backfill/history-backfill.ts` (add `planBackfillRun` near `missingDays`, ~line 70)
- Modify: `src/rates/history-backfill/history-backfill.test.ts` (append a `describe('planBackfillRun', ...)`; add `planBackfillRun` to the import block)
- Modify: `src/screens/statistics/statistics.screen.tsx` (the ref at `:274`, the effect at `:280-308`, and the `history-backfill` import at `:27-32`)

**Interfaces:**
- Consumes: `missingDays`, `runBackfill`, `deriveLastBackfilledDay` (existing, `history-backfill.ts`); the screen's `spanStart` (`:247`), `lastBackfilledDay` (`:267`), `now`, `transactions.length`.
- Produces: `planBackfillRun(spanStart: number, ranForSpanStart: number | null, lastBackfilledDay: number | null): { run: boolean; resumeFrom: number | null }` — `run: true` on the first run (`ranForSpanStart === null`) or when `spanStart` moved strictly earlier than a prior run covered; `resumeFrom` is the incremental `lastBackfilledDay` on a first forward run and `null` on an earlier-extension re-run.

- [ ] **Step 1: Write the failing test**

Add `planBackfillRun` to the import block at the top of `src/rates/history-backfill/history-backfill.test.ts` (alongside `missingDays`), then append:

```ts
describe('planBackfillRun', () => {
  it('runs from the incremental resume cursor on the first run', () => {
    expect(planBackfillRun(day(0), null, day(2))).toEqual({ run: true, resumeFrom: day(2) });
  });

  it('re-runs from null (the whole span) when the span extends EARLIER mid-session', () => {
    // A prior run already covered from day(5); an older transaction drops
    // spanStart to day(0). Resuming forward from the newest stored day cannot
    // see the gap below it, so the re-run must recompute the full span.
    expect(planBackfillRun(day(0), day(5), day(9))).toEqual({ run: true, resumeFrom: null });
  });

  it('does not re-run when the span is unchanged or moves later', () => {
    expect(planBackfillRun(day(5), day(5), day(9))).toEqual({ run: false, resumeFrom: null });
    expect(planBackfillRun(day(7), day(5), day(9))).toEqual({ run: false, resumeFrom: null });
  });

  it('the earlier-extension re-run actually reaches the freshly-opened earlier days', () => {
    // Proving the fix end-to-end: with resumeFrom null, missingDays spans the
    // FULL range from the new earlier spanStart — the earlier gap the forward
    // cursor skipped is now covered.
    const { resumeFrom } = planBackfillRun(day(0), day(5), day(9));

    expect(missingDays(day(0), resumeFrom, day(2))).toEqual([day(0), day(1), day(2)]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/rates/history-backfill/history-backfill.test.ts -t planBackfillRun`
Expected: FAIL — `planBackfillRun` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/rates/history-backfill/history-backfill.ts`, add after `missingDays` (~line 70):

```ts
/**
 * Decide whether the incremental backfill must (re)run for `spanStart`, and from
 * where. It runs when it has never run (`ranForSpanStart === null`) or when
 * `spanStart` has moved strictly EARLIER than a prior run covered — an older
 * transaction appeared mid-session, opening a gap BELOW the newest stored day.
 * On that earlier-extension case it resumes from `null` so `missingDays`
 * recomputes the WHOLE span from `spanStart` (the idempotent upsert skips the
 * already-stored newer days); `missingDays`' forward cursor resumes ABOVE the
 * newest stored day and structurally cannot see the freshly-opened earlier gap
 * otherwise. A first, forward run keeps the incremental `lastBackfilledDay`
 * resume so it fetches only the new days.
 */
export const planBackfillRun = (
  spanStart: number,
  ranForSpanStart: number | null,
  lastBackfilledDay: number | null,
): { run: boolean; resumeFrom: number | null } => {
  if (ranForSpanStart === null) {
    return { run: true, resumeFrom: lastBackfilledDay };
  }

  if (spanStart < ranForSpanStart) {
    return { run: true, resumeFrom: null };
  }

  return { run: false, resumeFrom: null };
};
```

Then, in `src/screens/statistics/statistics.screen.tsx`, add `planBackfillRun,` to the `../../rates/history-backfill` import block (`:27-32`, after `missingDays,`), replace the ref at `:274`:

```ts
  const backfillRanForSpanRef = useRef<number | null>(null);
```

and replace the whole effect (`:280-308`) with one driven off `planBackfillRun`:

```ts
  useEffect(() => {
    if (transactions.length === 0) {
      return;
    }

    const { run, resumeFrom } = planBackfillRun(
      spanStart,
      backfillRanForSpanRef.current,
      lastBackfilledDay,
    );

    if (!run) {
      return;
    }

    // Mark this span covered BEFORE the async run so the write's own re-render
    // (which advances lastBackfilledDay) does not re-enter for the same span.
    backfillRanForSpanRef.current = spanStart;

    if (missingDays(spanStart, resumeFrom, now).length === 0) {
      setBackfillStatus({ state: 'complete', lastDay: lastBackfilledDay });

      return;
    }

    setBackfillStatus({ state: 'loading', lastDay: lastBackfilledDay });
    let cancelled = false;
    runBackfill({ earliestDay: spanStart, lastBackfilledDay: resumeFrom, today: now })
      .then((status) => {
        if (!cancelled) {
          setBackfillStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackfillStatus({ state: 'complete', lastDay: lastBackfilledDay });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [transactions.length, spanStart, lastBackfilledDay, now]);
```

Update the effect's leading comment (`:269-273`) so it no longer says "at most once per mount" — it now also re-runs when the span extends earlier.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/rates/history-backfill/history-backfill.test.ts`
Expected: PASS (the new `planBackfillRun` cases and every existing `missingDays`/`runBackfill` case). Then `npm run check:typecheck` to confirm the screen's ref/effect still type-checks.

- [ ] **Step 5: Commit**

```bash
git add src/rates/history-backfill/history-backfill.ts src/rates/history-backfill/history-backfill.test.ts src/screens/statistics/statistics.screen.tsx
git commit -m "fix(statistics): re-run net-worth backfill when the span extends earlier"
```

Then run `npm run check:all`.

---

#### F2 [Low — real fix]: refresh `now` on screen focus

**Problem (grounded in the real code):** `now` is frozen at mount — `const now = useMemo(() => Date.now(), [])` (`statistics.screen.tsx:188`) — and drives the default `rangeTo` (`:263`), the three "value now" chart points (`:321` by-type bar, `:339` net-worth rightmost, `:351` account pie), and the backfill's `today` (`:293`). In a long-lived session a just-added today/now row can fall outside the window or be valued stale until the screen remounts.

**Chosen mechanism:** `useFocusEffect` from `@react-navigation/native` (already a dependency — `@react-navigation/native@^7.3.17`, imported across `src/navigation/*`). There is no existing screen that refreshes state on focus to copy verbatim (grep found only `navigation.addListener('transitionEnd', ...)` in `holding-card.component.tsx:77` and the `blur`/`resetTabStackOnBlur` listener wiring), so this uses the canonical React Navigation API for exactly this purpose rather than a hand-rolled `addListener('focus', ...)`. Wrapped in a small colocated hook so it is unit-testable off the real `NavigationContext`, the same way `use-scroll-to-top-on-tab-press.test.tsx` drives its navigator through the real contexts.

**Files:**
- Create: `src/screens/statistics/use-focus-refreshed-now.ts`
- Create: `src/screens/statistics/use-focus-refreshed-now.test.tsx`
- Modify: `src/screens/statistics/statistics.screen.tsx` (replace the `now` `useMemo` at `:188` and its comment at `:185-188`; add the import)

**Interfaces:**
- Consumes: `useFocusEffect` (`@react-navigation/native`); `useCallback`, `useState` (`react`).
- Produces: `useFocusRefreshedNow(): number` — a `now` timestamp stable across renders (so the downstream memos keyed on it are not defeated) that re-reads `Date.now()` on every screen focus.

- [ ] **Step 1: Write the failing test**

Create `src/screens/statistics/use-focus-refreshed-now.test.tsx` (modeled on `src/navigation/use-scroll-to-top-on-tab-press.test.tsx`'s real-`NavigationContext` render):

```tsx
import { NavigationContext, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useFocusRefreshedNow } from './use-focus-refreshed-now';

// A minimal fake navigation that reports itself focused and lets a test fire the
// `focus` event `useFocusEffect` subscribes to — the same real-context approach
// use-scroll-to-top-on-tab-press.test.tsx drives its tabPress through.
const makeNavigation = (): {
  navigation: NavigationProp<ParamListBase>;
  fireFocus: () => void;
} => {
  const focusListeners = new Set<() => void>();

  const navigation = {
    isFocused: () => true,
    addListener: (event: string, cb: () => void) => {
      if (event === 'focus') {
        focusListeners.add(cb);
      }

      return () => focusListeners.delete(cb);
    },
  } as unknown as NavigationProp<ParamListBase>;

  return { navigation, fireFocus: () => focusListeners.forEach((cb) => cb()) };
};

describe('useFocusRefreshedNow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('seeds now at mount and re-reads the clock on every focus', () => {
    let clock = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);

    const { navigation, fireFocus } = makeNavigation();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>
    );
    const { result } = renderHook(() => useFocusRefreshedNow(), { wrapper });

    expect(result.current).toBe(1_000);

    clock = 5_000;
    act(() => {
      fireFocus();
    });

    expect(result.current).toBe(5_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/statistics/use-focus-refreshed-now.test.tsx`
Expected: FAIL — module `./use-focus-refreshed-now` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/screens/statistics/use-focus-refreshed-now.ts`:

```ts
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';

/**
 * A `now` timestamp that is stable across renders but REFRESHES every time the
 * screen regains focus. The Statistics screen keys its default range end, its
 * three "value now" chart points, and the backfill's "today" on this value; a
 * plain `useMemo(() => Date.now(), [])` froze it at mount, so in a long-lived
 * session a just-added today/now row could fall outside the window or be valued
 * stale. Refreshing on focus (never per-render — that would defeat the
 * downstream memos keyed on it) keeps those current.
 */
export const useFocusRefreshedNow = (): number => {
  const [now, setNow] = useState(() => Date.now());

  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
    }, []),
  );

  return now;
};
```

Then in `src/screens/statistics/statistics.screen.tsx`, replace the `now` `useMemo` (`:188`) with the hook, and update the comment (`:185-188`) so it says `now` is refreshed on focus (not frozen at mount) but still stable across renders:

```ts
  // `now` is seeded at mount and REFRESHED on every screen focus (see
  // useFocusRefreshedNow): the default date-range seed, the default line window,
  // the backfill's "today", and every memo below key on it, and it stays stable
  // across renders so a fresh `Date.now()` each render never defeats that
  // memoization — only a re-focus advances it.
  const now = useFocusRefreshedNow();
```

Add the import (external group, alongside the other `@kiko`/library imports; and the parent-relative hook import in the sibling `./` group):

```ts
import { useFocusRefreshedNow } from './use-focus-refreshed-now';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/statistics/use-focus-refreshed-now.test.tsx`
Expected: PASS. Then `npm run check:typecheck` to confirm the screen still type-checks with `now` sourced from the hook (it stays a `number`, so every downstream memo is unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/screens/statistics/use-focus-refreshed-now.ts src/screens/statistics/use-focus-refreshed-now.test.tsx src/screens/statistics/statistics.screen.tsx
git commit -m "fix(statistics): refresh now on screen focus so live chart windows stay current"
```

Then run `npm run check:all`.

---

#### F3 [Low/latent — GUARD ONLY, do NOT refactor]: balance-consistency invariant guard

**Problem (grounded in the real code):** the by-type bar (`src/statistics/type-breakdown/type-breakdown.ts` — `buildTypeBreakdown` reads `holding.balanceMinorUnits` via `holdingValue`) and the account-contribution pie (`src/statistics/account-contribution/account-contribution.ts:58` — `guardedNetWorth` over holding balances) are reactive to transactions only TRANSITIVELY, through the holding balance, never the `transactions` table. This is currently SAFE: every real money-moving write updates the balance in the same `write(...)` (`recordManualTx` does the insert AND the balance read-modify-write; `recordManual`, `recordExchange`, `recordExchangeCounterpart`, and `recordManualWithReturns` all route through it). The one balance-less inserter — `transactionsRepo.add` (`transactions.repo.ts:269-270`, a bare `insert` with NO balance update) — was verified to have NO non-test caller (grep found only unrelated `Set.add` matches). **Do NOT change these charts to derive-from-ledger.** Instead, lock the invariant with a lightweight guard so a future balance-less writer can never silently drift the type/contribution charts.

**Files:**
- Create: `src/statistics/chart-balance-consistency.test.ts`

**Interfaces:**
- Consumes: `transactionsRepo.recordManual` (existing), `transactionsRepo.recordManualWithReturns` (Task 2); the `holdings` schema object; the `write(...)` seam (mocked). No new production symbols.

This test drives the REAL money-moving writers through the same fast `write(...)`-mock + fake-tx-handle seam as `transactions.repo.test.ts`'s `makeExchangeTx` and `money-path.test.ts` (Task 6), and asserts every `transactions` insert is accompanied by a matching `holdings` balance update in the one captured call sequence — no simulator.

- [ ] **Step 1: Write the failing test**

Create `src/statistics/chart-balance-consistency.test.ts`:

```ts
// Chart-reactivity invariant guard (audit F3): the by-type bar
// (statistics/type-breakdown) and the account-contribution pie
// (statistics/account-contribution) read each holding's stored BALANCE, never
// the transactions table — so they refresh after a transaction ONLY because the
// same write updates the balance. This guard proves every money-moving writer
// pairs each transaction insert with a matching holding balance update inside
// the one write(...), so a future balance-less writer can never silently desync
// those charts. Modeled on transactions.repo.test.ts's makeExchangeTx seam.
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { holdings } from '../db/schema';
import { transactionsRepo } from '../transactions/repo/transactions.repo';

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

describe('chart balance-consistency invariant', () => {
  it('recordManual pairs its single transaction insert with a holding balance update', async () => {
    const { tx, inserts, updates } = makeTx([[{ balanceMinorUnits: 5_000 }]]);
    mockTx = tx;

    await transactionsRepo.recordManual({
      holdingId: 'h-1',
      amountMinorUnits: -1_200,
      time: 1,
      category: 'groceries',
    });

    const balanceUpdates = updates.filter((update) => update.table === holdings);

    expect(inserts).toHaveLength(1);
    expect(balanceUpdates).toHaveLength(1);
    // base 5_000 - 1_200 = 3_800: the insert never lands without its balance move.
    expect(balanceUpdates[0].values).toEqual({ balanceMinorUnits: 3_800 });
  });

  it('recordManualWithReturns pairs EVERY inserted row with its own holding balance update', async () => {
    const { tx, inserts, updates } = makeTx([
      [{ balanceMinorUnits: 50_000 }], // payer read
      [{ balanceMinorUnits: 1_000 }], // return B read
      [{ balanceMinorUnits: 2_000 }], // return C read
    ]);
    mockTx = tx;

    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'payer-1', amountMinorUnits: -21_200, time: 1, category: 'groceries' },
      returns: [
        { holdingId: 'hold-b', amountMinorUnits: 20 },
        { holdingId: 'hold-c', amountMinorUnits: 8 },
      ],
    });

    const balanceUpdates = updates.filter((update) => update.table === holdings);

    // One transaction insert AND one holding balance update per money movement —
    // the payment plus each return. Never an insert without its balance move, so
    // the type/contribution charts (which read balance, not ledger) stay in sync.
    expect(inserts).toHaveLength(3);
    expect(balanceUpdates).toHaveLength(3);
    expect(balanceUpdates.map((update) => update.values)).toEqual([
      { balanceMinorUnits: 28_800 }, // 50_000 - 21_200
      { balanceMinorUnits: 1_020 }, // 1_000 + 20
      { balanceMinorUnits: 2_008 }, // 2_000 + 8
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails/passes**

Run: `npx jest src/statistics/chart-balance-consistency.test.ts`
Expected: PASS on first run IF Task 2 is complete (this guard exercises already-shipped logic — `recordManual` existed pre-plan, `recordManualWithReturns` from Task 2). If `recordManualWithReturns` is missing, it FAILS with a missing-symbol error — that is the guard confirming its dependency, and confirms Task 9 is correctly ordered after Task 2. There is no red-then-green cycle here; this is a pure invariant guard over existing code (same class as Task 6).

- [ ] **Step 3: Write minimal implementation**

None — pure guard test. If an assertion ever fails, fix the PRODUCTION writer to pair its insert with a balance update (never weaken the assertion).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/statistics/chart-balance-consistency.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/statistics/chart-balance-consistency.test.ts
git commit -m "test(statistics): guard the balance-consistency invariant the type/contribution charts rely on"
```

Then run `npm run check:all`.

---

## Self-Review

**1. Spec coverage.**
- §2 Feature 1 (Approach A convert + prefill): Task 5 (helper), Task 8 (form wiring), guard case 3 (Task 6). F1-2 latest cached rate → `ratesRepo.allQuery`/`buildRateTable` (Task 8). F1-3 same-currency 1:1 → Task 5 test. F1-4 missing rate blank → Task 5 `null` + Task 8 early return. F1-5 direct prefill, no rate field → Task 8 seeds `counterpartAmount` only. F1-6 bank row unmarked → guard case 3 asserts `transactions` never written; Approach C explicitly excluded per Global Constraints.
- §3 Feature 2: Task 1 (`changeGroupId` + migration), Task 2 (`recordManualWithReturns`), Task 3 (pie netting), Task 3b (trend netting), Task 4 (query/pie-screen wiring), Task 7 (form). F2-1 linked+netting = Tasks 1-4 + 3b. F2-2 validation (`>0` and `Σ<|payment|`) → `canSaveSplit` (Task 7). F2-3 distinct open holding except payer → `canSaveSplit` + picker filter (Task 7). F2-4 dynamic rows → Task 7. F2-5 separate linked rows → Task 2. F2-6/F2-7 netting now covers BOTH statistics call sites — the pie (`buildCategoryBreakdown`, Task 3) AND the category trend line + Top-N ranking (`accumulateSpend`, Task 3b), each netting a payment's linked returns out of its category spend magnitude. F2-8 same currency v1 → picker filter (Task 7); exchange+split deferred per Global Constraints. F2-9 gate on manual expense create → `resolveModeOptions` + `!isReadOnly`/`!isEditing` (Task 7).
- §6 harness checkpoints: `check:all` per task, `check:deep` after Task 6 and Task 8; migration via drizzle-kit + biome (Task 1).
- Mandatory money-path guard: Task 6 (four seams — net worth, pie netting, trend netting, convert prefill).
- Chart-reactivity audit (Task 9): F1 net-worth backfill re-runs when the span extends earlier (`planBackfillRun`); F2 `now` refreshes on focus (`useFocusRefreshedNow`); F3 balance-consistency invariant guarded (every money-moving writer pairs each insert with a balance update); F4 confirmed already-correct (`recordManualWithReturns` is one `write(...)`, one reactive callback, all charts refresh together — no code). Task 9 is SEPARATE-COMMIT (three commits: F1, F2, F3), NO-FORM (it never touches the HELD `transaction-form.screen.tsx`), and MUST run AFTER the stats trio (Tasks 3/3b/4) because F1/F2 edit `statistics.screen.tsx` and build on their threaded `changeGroupId`; it has no dependency on the UI-tweaks track gating Tasks 7/8.

**2. Placeholder scan.** No "TBD"/"add validation"/"similar to Task N"/"handle edge cases". Every code step carries real code; the one cross-reference ("modeled on makeExchangeTx") reproduces the fake-tx builder in full in Tasks 6 and 9 F3 rather than pointing at it.

**3. Type consistency.** `changeGroupId` (camelCase field, `change_group_id` column) is used identically in Tasks 1-4 and 3b. `recordManualWithReturns`/`ManualWithReturnsInput`/`ChangeReturn` match between Task 2 (definition) and Tasks 6/7 (callers). `seedCounterpartMinorUnits`'s signature (returns `number | null`) matches between Task 5 and its callers in Tasks 6/8. `BreakdownTransaction.changeGroupId` (Task 3) is consumed by Tasks 3b/4/6. Task 3 makes `changeGroupId` a REQUIRED field of `BreakdownTransaction`, so EVERY screen projection that builds a `BreakdownTransaction`/`TrendTransaction` must carry it or typecheck fails on the missing property: both pie memos `breakdownTransactions` and `rangeFilteredBreakdownTransactions` (Task 4) and the trend memo `trendTransactions` (Task 3b). `category-trend.ts` needs NO new type — `TrendTransaction = BreakdownTransaction & { time }` (`category-trend.ts:38`) inherits `changeGroupId` from Task 3; Task 3b is a netting-only edit to the shared `accumulateSpend`, so both `buildCategoryTrend` and `buildCategoryMeasures` net without a second change.
