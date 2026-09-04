# Multi-currency Cash Holdings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single **cash** holding store several fiat currency balances at once (UAH/USD/EUR bills in one envelope), each editable directly, contributing per-currency to value and net worth.
**Architecture:** A new child table `holding_balances` (one row per currency per cash holding) is written in the same `db.transaction()` as its holding, backfilled from existing single-currency cash rows. The value/net-worth layer stops assuming one amount per holding: a new `holdingEntries` expansion yields one `{currency, minorUnits}` entry for a non-cash holding (via the unchanged `holdingValue`) and N entries for a cash holding (one per balance row); `netWorth`/`guardedNetWorth`/`sumByCurrency` sum entries with the existing per-entry `canConvert` guard. The cash form edits a balances list; the cash card shows the base-currency total and the cash detail shows the per-currency `CurrencyBreakdown`.
**Tech Stack:** React Native 0.87, TypeScript, drizzle-orm + op-sqlite, Jest + RNTL, react-native-unistyles.
**Spec:** docs/superpowers/specs/2026-09-04-multi-currency-cash-holdings-design.md

## Global Constraints
- fiat-only currencies UAH/USD/EUR (BTC excluded)
- every DB write goes through db.transaction()
- tests are colocated *.test.ts(x)
- the PFF harness checks (check:all) must stay green and must not be weakened
- follow pff-code-style / pff-architecture / pff-domain skills
- holdings.balanceMinorUnits stays 0 and unused for cash rows
- non-cash holdings and holdingValue/holdingValueBreakdown are unchanged

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `drizzle/migrations/0007_<generated>.sql` | drizzle-kit-generated `CREATE TABLE holding_balances` + its unique index (Task 1). |
| `drizzle/migrations/meta/0007_snapshot.json` | drizzle-kit-generated schema snapshot for 0007 (Task 1). |
| `drizzle/migrations/0008_backfill_holding_balances.sql` | Hand-authored data migration: one balance row per existing cash holding (Task 2). |
| `src/db/holding-balances-migration.test.ts` | Asserts the bundled backfill migration copies `(currency, balance)` for `type='cash'` rows only (Task 2). |
| `src/repositories/holding-balances.repo.ts` | Balances repo: `balancesForHoldingQuery`, `balancesForHoldingsQuery`, `replaceBalances`, and the shared `insertBalancesOnTx` / `replaceBalancesOnTx` transaction helpers (Task 3). |
| `src/repositories/holding-balances.repo.test.ts` | Tests for the balances repo query builders and replace/insert helpers (Task 3). |
| `src/holdings/holding-entries.test.ts` | Tests for `holdingEntries` / `attachBalances` / `cashBalancesToMoney` (Task 5). |
| `src/screens/forms/cash-balances-editor.ts` | Pure state helpers for the cash balances editor (available currencies, add/remove, dedupe, seed, to-inputs) (Task 6). |
| `src/screens/forms/cash-balances-editor.test.ts` | Tests for the cash balances editor rules (Task 6). |

**Modified:**

| Path | Change |
|---|---|
| `src/db/schema.ts` | Add the `holdingBalances` table + `HoldingBalanceRow` type (Task 1). |
| `src/currency/currency.ts` | Add `fiatCurrencyOptions` + `FiatCurrency` (Task 1). |
| `drizzle/migrations/migrations.js` | Import + register the new migration bundles (Task 1 for 0007, Task 2 for 0008). |
| `drizzle/migrations/meta/_journal.json` | Journal the new migrations (Task 1 for 0007, Task 2 for 0008). |
| `src/repositories/holdings.repo.ts` | Add `createCash` / `updateCash`; cascade-delete balances in `remove` (Task 4). |
| `src/repositories/holdings.repo.test.ts` | Tests for `createCash` / `updateCash` / `remove` balances cascade (Task 4). |
| `src/repositories/accounts.repo.ts` | `createCashAccount` writes a balance row; `remove` cascade deletes balances (Task 4). |
| `src/repositories/accounts.repo.test.ts` | Update `createCashAccount` expectations; balances cascade in `remove` (Task 4). |
| `src/holdings/holding-value.ts` | Add `CurrencyAmount` / `CashBalance` / `ValuableHoldingWithBalances`, `holdingEntries`, `attachBalances`, `cashBalancesToMoney` (Task 5). |
| `src/rates/conversion.ts` | `netWorth` operates on entries via a shared `sumEntries` (Task 5). |
| `src/rates/conversion.test.ts` | Add a cash-holding netWorth case (Task 5). |
| `src/rates/net-worth-view.ts` | `guardedNetWorth` filters per entry; `ConvertibleHolding` gains `balances` (Task 5). |
| `src/rates/net-worth-view.test.ts` | Add cash multi-currency + unconvertible-cash-currency cases (Task 5). |
| `src/rates/currency-totals.ts` | `sumByCurrency` buckets per entry (Task 5). |
| `src/rates/currency-totals.test.ts` | Add a cash multi-currency case (Task 5). |
| `src/screens/forms/holding-form.screen.tsx` | Cash path renders the balances editor; save writes balances (Task 6). |
| `src/screens/forms/holding-form.screen.test.tsx` | Cash editor render + save-writes-balances tests (Task 6). |
| `src/screens/account-detail/holding-card.component.tsx` | Cash card shows the base-currency total (Task 7). |
| `src/screens/account-detail/holding-card.component.test.tsx` | Cash card total test (Task 7). |
| `src/screens/account-detail/account-detail.screen.tsx` | Load balances, attach to holdings, pass base/rates to the card (Task 7). |
| `src/screens/holding-detail/holding-detail.screen.tsx` | Cash detail shows per-currency `CurrencyBreakdown` under the Value header (Task 7). |
| `src/screens/holding-detail/holding-detail.screen.test.tsx` | Cash detail breakdown test (Task 7). |
| `src/screens/home/home.screen.tsx` | Load balances and attach so cash contributes to net worth (Task 7). |
| `src/screens/statistics/statistics.screen.tsx` | Load balances and attach into the visible holdings (Task 7). |

---

## Tasks

### Task 1: Schema — `holding_balances` table + generated migration

**Files:**
- Modify: `src/currency/currency.ts` (add `fiatCurrencyOptions` + `FiatCurrency` after line 10)
- Modify: `src/db/schema.ts` (add `holdingBalances` table + type after the `HoldingRow` export, line 37)
- Create (generated): `drizzle/migrations/0007_<name>.sql`, `drizzle/migrations/meta/0007_snapshot.json`
- Modify (generated): `drizzle/migrations/migrations.js`, `drizzle/migrations/meta/_journal.json`

**Interfaces:**
- Produces: `fiatCurrencyOptions: readonly ['UAH','USD','EUR']`; `type FiatCurrency = 'UAH'|'USD'|'EUR'`
- Produces: `holdingBalances` (drizzle table `holding_balances`); `type HoldingBalanceRow = typeof holdingBalances.$inferSelect` → `{ holdingId: string; currency: 'UAH'|'USD'|'EUR'; balanceMinorUnits: number }`
- Consumes: existing `holdings` table (FK `holding_id` → `holdings.id`)

Steps:

- [ ] Add the fiat currency list to `src/currency/currency.ts` immediately after the `Currency` type (line 10). The canonical order already begins with the fiat codes, so slice-free literal keeps it explicit:
  ```ts
  /**
   * The fiat currency codes, in canonical display order. Cash holdings hold only
   * fiat (physical bills are never BTC), so the cash balances editor and the
   * `holding_balances` table enum both draw from this narrower set.
   */
  export const fiatCurrencyOptions = ['UAH', 'USD', 'EUR'] as const;

  export type FiatCurrency = (typeof fiatCurrencyOptions)[number];
  ```
- [ ] Add the table to `src/db/schema.ts` after the `HoldingRow` export (line 37):
  ```ts
  export const holdingBalances = sqliteTable(
    'holding_balances',
    {
      holdingId: text('holding_id')
        .notNull()
        .references(() => holdings.id),
      currency: text('currency', { enum: ['UAH', 'USD', 'EUR'] }).notNull(),
      balanceMinorUnits: integer('balance_minor_units').notNull().default(0),
    },
    (table) => ({
      holdingCurrencyUnique: uniqueIndex('holding_balances_holding_currency').on(
        table.holdingId,
        table.currency,
      ),
    }),
  );

  export type HoldingBalanceRow = typeof holdingBalances.$inferSelect;
  ```
  (`sqliteTable`, `integer`, `text`, `uniqueIndex` are already imported at the top of the file.)
- [ ] Run the generator and see the migration appear:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx drizzle-kit generate
  ```
  Expected: a new `drizzle/migrations/0007_<name>.sql` containing `CREATE TABLE \`holding_balances\`` with the three columns and `CREATE UNIQUE INDEX \`holding_balances_holding_currency\` ON \`holding_balances\` (\`holding_id\`,\`currency\`)`, a new `meta/0007_snapshot.json`, a new `entries[]` element in `meta/_journal.json` (`idx: 7`, `tag: "0007_<name>"`), and an added `import m0007 ...` + `m0007` entry in `migrations.js`.
- [ ] Verify the generated SQL is a pure additive `CREATE TABLE` (no `DROP`/`ALTER` of existing tables):
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && cat drizzle/migrations/0007_*.sql
  ```
  Expected output contains exactly the `holding_balances` create + unique index and nothing touching `accounts`/`holdings`/`transactions`.
- [ ] Confirm lint/format is clean on the schema and currency changes:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npm run check:lint
  ```
  Expected: silent (exit 0).
- [ ] Commit:
  ```bash
  git add src/db/schema.ts src/currency/currency.ts drizzle/migrations/0007_*.sql drizzle/migrations/meta/0007_snapshot.json drizzle/migrations/meta/_journal.json drizzle/migrations/migrations.js && git commit -m "feat(db): add holding_balances table + fiat currency list"
  ```

### Task 2: Migration backfill — existing cash holdings → one balance row each

**Files:**
- Create: `drizzle/migrations/0008_backfill_holding_balances.sql`
- Create: `src/db/holding-balances-migration.test.ts`
- Modify: `drizzle/migrations/migrations.js` (import + register `m0008`)
- Modify: `drizzle/migrations/meta/_journal.json` (journal entry `idx: 8`)

**Interfaces:**
- Consumes: the migration bundle `drizzle/migrations/migrations.js` (`{ journal, migrations }`)
- Produces: bundled migration `m0008` (raw SQL string) that inserts into `holding_balances` from `holdings WHERE type='cash'`

Steps:

- [ ] Write the failing test at `src/db/holding-balances-migration.test.ts`. It loads the REAL migration bundle and asserts the backfill statement's shape (the repo tests migrations structurally — op-sqlite is native-only and mocked under Jest, so end-to-end row effects are verified on device via `MigrationsGate`; this test locks the statement that produces those rows):
  ```ts
  import migrations from '../../drizzle/migrations/migrations';

  type Bundle = { migrations: Record<string, string> };

  const backfillSql = (): string => {
    const { migrations: byKey } = migrations as unknown as Bundle;
    const entry = Object.entries(byKey).find(([, sql]) =>
      sql.includes('holding_balances'),
    );
    if (entry === undefined) {
      throw new Error('no holding_balances migration bundled');
    }
    return entry[1];
  };

  describe('holding_balances backfill migration', () => {
    it('inserts into holding_balances', () => {
      expect(backfillSql()).toMatch(/insert\s+into\s+`?holding_balances`?/i);
    });

    it('copies the holding id, currency and balance from the holdings row', () => {
      const sql = backfillSql().toLowerCase();
      expect(sql).toContain('holding_id');
      expect(sql).toContain('currency');
      expect(sql).toContain('balance_minor_units');
      expect(sql).toMatch(/from\s+`?holdings`?/i);
    });

    it('only backfills cash holdings', () => {
      expect(backfillSql().toLowerCase()).toMatch(/where\s+`?type`?\s*=\s*'cash'/);
    });
  });
  ```
- [ ] Run it and see it fail (the backfill migration does not exist yet):
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/db/holding-balances-migration.test.ts
  ```
  Expected failure: `Error: no holding_balances migration bundled` (only the 0007 CREATE TABLE mentions `holding_balances`, and it matches the first assertion but not the `INSERT`/`FROM holdings`/`WHERE type='cash'` assertions) — the run ends red.
- [ ] Create `drizzle/migrations/0008_backfill_holding_balances.sql`:
  ```sql
  /*
   Backfill `holding_balances` for the multi-currency cash feature.

   Every existing cash holding stored its single balance on
   `holdings.(currency, balance_minor_units)`. Seed one balance row per cash
   holding from those columns, so a pre-feature cash holding becomes a set of
   one. Non-cash rows are untouched, and the source columns on `holdings` are
   left in place (non-destructive), so this migration is safe to re-run against
   a partially-migrated database via INSERT OR IGNORE (the unique index on
   (holding_id, currency) makes a repeat insert a no-op).
  */
  INSERT OR IGNORE INTO `holding_balances` (`holding_id`, `currency`, `balance_minor_units`)
    SELECT `id`, `currency`, `balance_minor_units` FROM `holdings` WHERE `type` = 'cash';
  ```
- [ ] Register the bundle in `drizzle/migrations/migrations.js`: add `import m0008 from './0008_backfill_holding_balances.sql';` after the `m0007` import, and add `m0008,` to the `migrations` object.
- [ ] Add the journal entry to `drizzle/migrations/meta/_journal.json` as the last element of `entries` (use a `when` strictly greater than 0007's; the illustrative value below is 0007's + one day — read the real 0007 `when` and add `86400000`):
  ```json
  {
    "idx": 8,
    "version": "6",
    "when": 1788690000000,
    "tag": "0008_backfill_holding_balances",
    "breakpoints": true
  }
  ```
  (No `meta/0008_snapshot.json` — hand-authored data migrations carry no snapshot, matching `0006_backfill_sort_order`.)
- [ ] Run the test and see it pass:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/db/holding-balances-migration.test.ts
  ```
  Expected: all three tests pass.
- [ ] Verify the migration runner still bundles and gates correctly (no regression in the existing runner tests):
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/db/run-migrations.test.ts
  ```
  Expected: green.
- [ ] Commit:
  ```bash
  git add drizzle/migrations/0008_backfill_holding_balances.sql drizzle/migrations/migrations.js drizzle/migrations/meta/_journal.json src/db/holding-balances-migration.test.ts && git commit -m "feat(db): backfill holding_balances from existing cash holdings"
  ```

### Task 3: `holding-balances.repo.ts` — read, batched read, replace

**Files:**
- Create: `src/repositories/holding-balances.repo.ts`
- Create: `src/repositories/holding-balances.repo.test.ts`

**Interfaces:**
- Consumes: `database`, `write` (`../db/client`); `holdingBalances` (`../db/schema`); `FiatCurrency` (`../currency/currency`); `and`, `eq`, `inArray`, `notInArray` (`drizzle-orm`)
- Produces:
  - `type BalanceInput = { currency: FiatCurrency; balanceMinorUnits: number }`
  - `holdingBalancesRepo.balancesForHoldingQuery(holdingId: string)` → drizzle select builder
  - `holdingBalancesRepo.balancesForHoldingsQuery(holdingIds: string[])` → drizzle select builder
  - `holdingBalancesRepo.replaceBalances(holdingId: string, balances: BalanceInput[]): Promise<void>`
  - `insertBalancesOnTx(tx: typeof database, holdingId: string, balances: BalanceInput[]): Promise<void>` (plain inserts, create path)
  - `replaceBalancesOnTx(tx: typeof database, holdingId: string, balances: BalanceInput[]): Promise<void>` (upsert + delete-removed, edit path)

Steps:

- [ ] Write the failing test at `src/repositories/holding-balances.repo.test.ts`:
  ```ts
  jest.mock('@op-engineering/op-sqlite', () => ({
    open: () => ({ execute: () => ({ rows: [] }) }),
  }));

  let mockTx: unknown;
  jest.mock('../db/client', () => {
    const actual = jest.requireActual('../db/client');
    return {
      ...actual,
      write: (work: (db: unknown) => unknown) => work(mockTx),
    };
  });

  import { holdingBalances } from '../db/schema';
  import {
    holdingBalancesRepo,
    insertBalancesOnTx,
    replaceBalancesOnTx,
  } from './holding-balances.repo';

  // A fake write-transaction handle that records every delete/insert issued in
  // order. `insert().values().onConflictDoUpdate()` is a 3-step chain, so the
  // fake returns a thenable-free object exposing each step; `delete().where()`
  // records that a where clause was applied. The where/target clauses are not
  // interpreted (matching the other repo tests), only the payloads captured.
  const makeBalancesTx = () => {
    const captured = {
      deletes: 0,
      inserts: [] as Record<string, unknown>[],
      upserts: [] as Record<string, unknown>[],
    };
    const tx = {
      delete: () => ({
        where: () => {
          captured.deletes += 1;
          return Promise.resolve();
        },
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          captured.inserts.push(values);
          return {
            onConflictDoUpdate: (config: Record<string, unknown>) => {
              captured.upserts.push(config);
              return Promise.resolve();
            },
            then: (resolve: (value: unknown) => unknown) => resolve(undefined),
          };
        },
      }),
    };
    return { tx, captured };
  };

  describe('holdingBalancesRepo queries', () => {
    it('builds a balances query filtered by a single holding id', () => {
      const { sql, params } = holdingBalancesRepo.balancesForHoldingQuery('h1').toSQL();
      expect(sql).toContain('holding_balances');
      expect(params).toContain('h1');
    });

    it('builds a batched balances query filtered by many holding ids', () => {
      const { sql, params } = holdingBalancesRepo
        .balancesForHoldingsQuery(['h1', 'h2'])
        .toSQL();
      expect(sql).toContain('holding_balances');
      expect(params).toContain('h1');
      expect(params).toContain('h2');
    });
  });

  describe('insertBalancesOnTx', () => {
    it('inserts one row per balance, without a delete or upsert (create path)', async () => {
      const { tx, captured } = makeBalancesTx();

      await insertBalancesOnTx(tx as never, 'h1', [
        { currency: 'UAH', balanceMinorUnits: 100_000 },
        { currency: 'USD', balanceMinorUnits: 5_000 },
      ]);

      expect(captured.deletes).toBe(0);
      expect(captured.upserts).toHaveLength(0);
      expect(captured.inserts).toEqual([
        { holdingId: 'h1', currency: 'UAH', balanceMinorUnits: 100_000 },
        { holdingId: 'h1', currency: 'USD', balanceMinorUnits: 5_000 },
      ]);
    });
  });

  describe('replaceBalancesOnTx', () => {
    it('deletes removed currencies then upserts each provided currency', async () => {
      const { tx, captured } = makeBalancesTx();

      await replaceBalancesOnTx(tx as never, 'h1', [
        { currency: 'UAH', balanceMinorUnits: 100_000 },
        { currency: 'EUR', balanceMinorUnits: 3_000 },
      ]);

      expect(captured.deletes).toBe(1);
      expect(captured.inserts).toEqual([
        { holdingId: 'h1', currency: 'UAH', balanceMinorUnits: 100_000 },
        { holdingId: 'h1', currency: 'EUR', balanceMinorUnits: 3_000 },
      ]);
      expect(captured.upserts).toEqual([
        {
          target: [holdingBalances.holdingId, holdingBalances.currency],
          set: { balanceMinorUnits: 100_000 },
        },
        {
          target: [holdingBalances.holdingId, holdingBalances.currency],
          set: { balanceMinorUnits: 3_000 },
        },
      ]);
    });

    it('still issues the delete when the balance list is empty (clears the holding)', async () => {
      const { tx, captured } = makeBalancesTx();

      await replaceBalancesOnTx(tx as never, 'h1', []);

      expect(captured.deletes).toBe(1);
      expect(captured.inserts).toEqual([]);
    });
  });

  describe('holdingBalancesRepo.replaceBalances', () => {
    it('runs the replace inside the write transaction', async () => {
      const { tx, captured } = makeBalancesTx();
      mockTx = tx;

      await holdingBalancesRepo.replaceBalances('h1', [
        { currency: 'UAH', balanceMinorUnits: 42 },
      ]);

      expect(captured.deletes).toBe(1);
      expect(captured.inserts).toEqual([
        { holdingId: 'h1', currency: 'UAH', balanceMinorUnits: 42 },
      ]);
    });
  });
  ```
- [ ] Run it and see it fail (module missing):
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/repositories/holding-balances.repo.test.ts
  ```
  Expected failure: `Cannot find module './holding-balances.repo'`.
- [ ] Create `src/repositories/holding-balances.repo.ts`:
  ```ts
  import { and, eq, inArray, notInArray } from 'drizzle-orm';
  import type { FiatCurrency } from '../currency/currency';
  import { database, write } from '../db/client';
  import { holdingBalances } from '../db/schema';
  import type { Repository } from './repository';

  /** One currency amount to persist for a cash holding (minor units). */
  export type BalanceInput = { currency: FiatCurrency; balanceMinorUnits: number };

  /**
   * Insert one balance row per currency for a FRESH holding, on the given
   * transaction handle. No delete/upsert: a just-created holding has no existing
   * rows, so plain inserts suffice. Shared by `holdingsRepo.createCash` and
   * `accountsRepo.createCashAccount`, which run it inside their own single write
   * transaction so the holding and its balances commit atomically.
   */
  export const insertBalancesOnTx = async (
    tx: typeof database,
    holdingId: string,
    balances: BalanceInput[],
  ): Promise<void> => {
    for (const balance of balances) {
      await tx.insert(holdingBalances).values({
        holdingId,
        currency: balance.currency,
        balanceMinorUnits: balance.balanceMinorUnits,
      });
    }
  };

  /**
   * Replace a cash holding's whole balance set on the given transaction handle:
   * delete every currency NOT in the new list, then upsert each provided
   * currency (insert-or-update its amount via the (holding_id, currency) unique
   * index). One statement per currency plus the one delete, all on the caller's
   * transaction so the edit is atomic.
   */
  export const replaceBalancesOnTx = async (
    tx: typeof database,
    holdingId: string,
    balances: BalanceInput[],
  ): Promise<void> => {
    const currencies = balances.map((balance) => balance.currency);
    await tx
      .delete(holdingBalances)
      .where(
        currencies.length > 0
          ? and(
              eq(holdingBalances.holdingId, holdingId),
              notInArray(holdingBalances.currency, currencies),
            )
          : eq(holdingBalances.holdingId, holdingId),
      );
    for (const balance of balances) {
      await tx
        .insert(holdingBalances)
        .values({
          holdingId,
          currency: balance.currency,
          balanceMinorUnits: balance.balanceMinorUnits,
        })
        .onConflictDoUpdate({
          target: [holdingBalances.holdingId, holdingBalances.currency],
          set: { balanceMinorUnits: balance.balanceMinorUnits },
        });
    }
  };

  export const holdingBalancesRepo = {
    // Reactive read for one holding's balances (fire on the 'holding_balances'
    // table). Row order is applied at display time against the canonical
    // currency order (see `cashBalancesToMoney`), so no ORDER BY is needed.
    balancesForHoldingQuery: (holdingId: string) =>
      database.select().from(holdingBalances).where(eq(holdingBalances.holdingId, holdingId)),
    // Batched reactive read for a list/grid of holdings, so a screen loads every
    // visible cash holding's balances in one subscription.
    balancesForHoldingsQuery: (holdingIds: string[]) =>
      database.select().from(holdingBalances).where(inArray(holdingBalances.holdingId, holdingIds)),
    replaceBalances: (holdingId: string, balances: BalanceInput[]) =>
      write((tx) => replaceBalancesOnTx(tx, holdingId, balances)),
  } satisfies Repository;
  ```
- [ ] Run it and see it pass:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/repositories/holding-balances.repo.test.ts
  ```
  Expected: all tests pass.
- [ ] Lint:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npm run check:lint
  ```
  Expected: silent.
- [ ] Commit:
  ```bash
  git add src/repositories/holding-balances.repo.ts src/repositories/holding-balances.repo.test.ts && git commit -m "feat(repo): holding-balances repo with reactive reads and transactional replace"
  ```

### Task 4: `holdings.repo` / `accounts.repo` — cash create/edit + cascade delete

**Files:**
- Modify: `src/repositories/holdings.repo.ts` (imports; add `createCash` + `updateCash`; extend `remove`, lines 136–148)
- Modify: `src/repositories/holdings.repo.test.ts`
- Modify: `src/repositories/accounts.repo.ts` (`createCashAccount`, lines 73–93; `remove`, lines 165–184)
- Modify: `src/repositories/accounts.repo.test.ts`

**Interfaces:**
- Consumes: `insertBalancesOnTx`, `replaceBalancesOnTx`, `BalanceInput` (`./holding-balances.repo`); `holdingBalances` (`../db/schema`); `FiatCurrency` (`../currency/currency`)
- Produces:
  - `holdingsRepo.createCash(input: { accountId: string; name: string; currency: FiatCurrency; balances: BalanceInput[]; color?: string | null; sortOrder?: number }): Promise<string>`
  - `holdingsRepo.updateCash(holdingId: string, patch: { name: string; color: string | null }, balances: BalanceInput[]): Promise<void>`
  - `holdingsRepo.remove` — now also deletes `holding_balances` rows for the holding
  - `accountsRepo.createCashAccount` — now also inserts one balance row for the initial balance
  - `accountsRepo.remove` — now also deletes each holding's `holding_balances` rows

Steps:

- [ ] Write the failing tests. Append to `src/repositories/holdings.repo.test.ts` (the `holdings` import at line 24 already exists; extend it to `import { holdingBalances, holdings } from '../db/schema';` and add a `createCash`/`updateCash` block plus a balances-cascade case). The create path reuses the existing `makeCreateTx` (select-max + insert), which already returns a Promise from `insert().values()`, so `insertBalancesOnTx`'s plain inserts capture cleanly:
  ```ts
  describe('holdingsRepo.createCash', () => {
    it('inserts a cash holding with balance 0 then a row per balance, resolving to the id', async () => {
      const { tx, inserts } = makeCreateTx(-1);
      mockTx = tx;

      const result = await holdingsRepo.createCash({
        accountId: 'acc-1',
        name: 'Wallet',
        currency: 'UAH',
        color: '#FFD60A',
        balances: [
          { currency: 'UAH', balanceMinorUnits: 100_000 },
          { currency: 'USD', balanceMinorUnits: 5_000 },
        ],
      });

      expect(typeof result).toBe('string');
      // 1 holding insert + 2 balance inserts, in the one transaction.
      expect(inserts).toHaveLength(3);
      expect(inserts[0]).toMatchObject({
        type: 'cash',
        currency: 'UAH',
        color: '#FFD60A',
        balanceMinorUnits: 0,
        sortOrder: 0,
      });
      expect(inserts[0].id).toBe(result);
      expect(inserts[1]).toEqual({ holdingId: result, currency: 'UAH', balanceMinorUnits: 100_000 });
      expect(inserts[2]).toEqual({ holdingId: result, currency: 'USD', balanceMinorUnits: 5_000 });
    });
  });

  describe('holdingsRepo.updateCash', () => {
    it('updates the holding fields then replaces its balances in one transaction', async () => {
      const captured = {
        set: undefined as Record<string, unknown> | undefined,
        deletes: 0,
        balanceInserts: [] as Record<string, unknown>[],
      };
      mockTx = {
        update: () => ({
          set: (set: Record<string, unknown>) => ({
            where: () => {
              captured.set = set;
              return Promise.resolve();
            },
          }),
        }),
        delete: () => ({
          where: () => {
            captured.deletes += 1;
            return Promise.resolve();
          },
        }),
        insert: () => ({
          values: (values: Record<string, unknown>) => ({
            onConflictDoUpdate: () => {
              captured.balanceInserts.push(values);
              return Promise.resolve();
            },
          }),
        }),
      };

      await holdingsRepo.updateCash(
        'h1',
        { name: 'Envelope', color: null },
        [{ currency: 'EUR', balanceMinorUnits: 2_500 }],
      );

      expect(captured.set).toEqual({ name: 'Envelope', color: null });
      expect(captured.deletes).toBe(1);
      expect(captured.balanceInserts).toEqual([
        { holdingId: 'h1', currency: 'EUR', balanceMinorUnits: 2_500 },
      ]);
    });
  });
  ```
  Then extend the existing `holdings remove` describe with a balances-cascade case (the `makeTx` store gains a `holding_balances` key — update the `Store` type and `keyOf` in the test helper to route the `holdingBalances` table):
  ```ts
  it('also deletes the cash holding balances in the same transaction', async () => {
    const store: Store = {
      holdings: [{ id: 'h1', type: 'cash', metadata: null }],
      transactions: [],
      holding_balances: [
        { holdingId: 'h1', currency: 'UAH', balanceMinorUnits: 100_000 },
        { holdingId: 'h1', currency: 'USD', balanceMinorUnits: 5_000 },
      ],
    };
    mockTx = makeTx(store);

    await holdingsRepo.remove('h1');

    expect(store.holding_balances).toEqual([]);
    expect(store.holdings).toEqual([]);
  });
  ```
  Update the shared `makeTx`/`Store` in that test file so the fake routes the third table:
  ```ts
  type Store = {
    holdings: Record<string, unknown>[];
    transactions: Record<string, unknown>[];
    holding_balances: Record<string, unknown>[];
  };

  const makeTx = (store: Store) => {
    const keyOf = (table: unknown): keyof Store =>
      table === holdings ? 'holdings' : table === holdingBalances ? 'holding_balances' : 'transactions';
    return {
      select: () => ({ from: (table: unknown) => ({ where: async () => store[keyOf(table)] }) }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            store[keyOf(table)] = store[keyOf(table)].map((row) => ({ ...row, ...values }));
          },
        }),
      }),
      delete: (table: unknown) => ({
        where: async () => {
          store[keyOf(table)] = [];
        },
      }),
    };
  };
  ```
  (Add `holding_balances: []` to the existing `appendDepositContribution` / `remove` store literals in that file so they satisfy the widened `Store` type.)
- [ ] Run and see the new tests fail:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/repositories/holdings.repo.test.ts
  ```
  Expected failure: `holdingsRepo.createCash is not a function` / `holdingsRepo.updateCash is not a function`, and the cascade test leaves `store.holding_balances` non-empty.
- [ ] Implement in `src/repositories/holdings.repo.ts`. Update the imports at the top:
  ```ts
  import { type HoldingRow, holdingBalances, holdings, transactions } from '../db/schema';
  import type { FiatCurrency } from '../currency/currency';
  import {
    type BalanceInput,
    insertBalancesOnTx,
    replaceBalancesOnTx,
  } from './holding-balances.repo';
  ```
  Add the two methods to the `holdingsRepo` object (next to `create`):
  ```ts
    /**
     * Create a CASH holding and its per-currency balance rows in ONE
     * transaction. The holding's own `balanceMinorUnits` stays 0 (unused for
     * cash); its value comes entirely from `holding_balances`. `currency` marks
     * the display/primary currency (the caller passes the first balance row's
     * currency). Resolves to the generated holding id.
     */
    createCash: (input: {
      accountId: string;
      name: string;
      currency: FiatCurrency;
      balances: BalanceInput[];
      color?: string | null;
      sortOrder?: number;
    }): Promise<string> =>
      write(async (tx) => {
        const holdingId = id();
        const sortOrder = input.sortOrder ?? (await nextSortOrder(tx, input.accountId));
        await tx.insert(holdings).values({
          id: holdingId,
          accountId: input.accountId,
          name: input.name,
          type: 'cash',
          currency: input.currency,
          color: input.color ?? null,
          balanceMinorUnits: 0,
          sortOrder,
        });
        await insertBalancesOnTx(tx, holdingId, input.balances);
        return holdingId;
      }),
    /**
     * Edit a CASH holding: update its identity fields (name/color) and replace
     * its whole balance set (upsert kept currencies, delete removed ones) in ONE
     * transaction. Type and primary currency are read-only in edit mode, so they
     * are not touched here.
     */
    updateCash: (
      holdingId: string,
      patch: { name: string; color: string | null },
      balances: BalanceInput[],
    ) =>
      write(async (tx) => {
        await tx.update(holdings).set(patch).where(eq(holdings.id, holdingId));
        await replaceBalancesOnTx(tx, holdingId, balances);
      }),
  ```
  Extend `remove` (lines 136–148) to delete balances before the holding (FK enforcement is ON):
  ```ts
    remove: (holdingId: string) =>
      write(async (tx) => {
        const rows = await tx.select().from(holdings).where(eq(holdings.id, holdingId));
        const row = rows.at(0);
        if (!row) {
          return;
        }
        if (isSyncedHolding(row)) {
          throw new Error('remove: cannot delete a synced holding');
        }
        await tx.delete(holdingBalances).where(eq(holdingBalances.holdingId, holdingId));
        await tx.delete(transactions).where(eq(transactions.holdingId, holdingId));
        await tx.delete(holdings).where(eq(holdings.id, holdingId));
      }),
  ```
- [ ] Run and see the holdings.repo tests pass:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/repositories/holdings.repo.test.ts
  ```
  Expected: green.
- [ ] Update `src/repositories/accounts.repo.test.ts`. The existing `createCashAccount` test that asserts `holdingInsert` has `balanceMinorUnits: 25050` must change (cash holdings now hold 0 on the row) and gain a balance-row assertion; the `makeCreateTx` fake's `insert().values()` already returns a Promise, so `insertBalancesOnTx` inserts capture into the same `inserts` array. Replace the `createCashAccount inserts the account and its cash holding in one transaction` test body with:
  ```ts
  it('inserts the account, its cash holding (balance 0), and one balance row in one transaction', async () => {
    const { tx, inserts } = makeCreateTx();
    mockTx = tx;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'EUR',
      initialBalanceMinorUnits: 25050,
    });

    expect(inserts).toHaveLength(3);
    const [accountInsert, holdingInsert, balanceInsert] = inserts as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(accountInsert).toMatchObject({ name: 'Wallet', kind: 'cash' });
    expect(holdingInsert).toMatchObject({
      accountId: accountInsert.id,
      name: 'Wallet',
      type: 'cash',
      currency: 'EUR',
      balanceMinorUnits: 0,
    });
    expect(balanceInsert).toEqual({
      holdingId: holdingInsert.id,
      currency: 'EUR',
      balanceMinorUnits: 25050,
    });
  });
  ```
  Add a balances-cascade assertion to the `accountsRepo.remove` cascade. The existing `makeRemoveTx` records `delete(table)` targets in order; extend the expected order so each holding's balances are deleted alongside its transactions. Update the first cascade test:
  ```ts
  it('cascades to holdings, their transactions and balances in one transaction', async () => {
    const { tx, captured } = makeRemoveTx({
      account: { id: 'acc-1', institution: null },
      holdings: [{ id: 'hold-1' }],
    });
    mockTx = tx;

    await accountsRepo.remove('acc-1');

    // Per holding: delete its balances and its transactions; then holdings; then account.
    expect(captured.deletedFrom).toEqual([holdingBalances, transactions, holdings, accounts]);
  });
  ```
  Extend the import to `import { accounts, holdingBalances, holdings, transactions } from '../db/schema';` and update the other `remove`/`disconnectMonobank` cascade expectations that assert `deletedFrom` to include `holdingBalances` before each `transactions` (two holdings → `[holdingBalances, transactions, holdingBalances, transactions, holdings, accounts]`).
- [ ] Run and see those accounts.repo tests fail:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/repositories/accounts.repo.test.ts
  ```
  Expected failure: `createCashAccount` produces 2 inserts (not 3) and the holding insert has `balanceMinorUnits: 25050`; the cascade order lacks `holdingBalances`.
- [ ] Implement in `src/repositories/accounts.repo.ts`. Update imports:
  ```ts
  import { type AccountRow, accounts, holdingBalances, holdings, transactions } from '../db/schema';
  import { insertBalancesOnTx } from './holding-balances.repo';
  ```
  Rewrite `createCashAccount` (lines 73–93) so the cash holding row holds 0 and its amount lands on a balance row:
  ```ts
    createCashAccount: ({ name, currency, initialBalanceMinorUnits, icon, color }: NewCashAccount) =>
      write(async (tx) => {
        const accountId = id();
        const sortOrder = await nextSortOrder(tx);
        await tx.insert(accounts).values({
          id: accountId,
          name,
          kind: 'cash',
          icon: icon ?? null,
          color: color ?? null,
          sortOrder,
        });
        const holdingId = id();
        await tx.insert(holdings).values({
          id: holdingId,
          accountId,
          name,
          type: 'cash',
          currency,
          balanceMinorUnits: 0,
        });
        await insertBalancesOnTx(tx, holdingId, [
          { currency: currency as FiatCurrency, balanceMinorUnits: initialBalanceMinorUnits },
        ]);
      }),
  ```
  (Add `import type { FiatCurrency } from '../currency/currency';`. `NewCashAccount.currency` is typed `Currency`; a cash account is created only for fiat, and the balances table enum is fiat — the cast documents that. Optionally narrow `NewCashAccount.currency` to `FiatCurrency` if no caller passes BTC; verify the cash account form first.)
  Extend `remove` (lines 165–184) to delete each holding's balances before its transactions:
  ```ts
        for (const holding of accountHoldings) {
          await tx.delete(holdingBalances).where(eq(holdingBalances.holdingId, holding.id));
          await tx.delete(transactions).where(eq(transactions.holdingId, holding.id));
        }
        await tx.delete(holdings).where(eq(holdings.accountId, accountId));
        await tx.delete(accounts).where(eq(accounts.id, accountId));
  ```
- [ ] Run and see the accounts.repo tests pass:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/repositories/accounts.repo.test.ts src/repositories/holdings.repo.test.ts
  ```
  Expected: green.
- [ ] Lint:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npm run check:lint
  ```
  Expected: silent.
- [ ] Commit:
  ```bash
  git add src/repositories/holdings.repo.ts src/repositories/holdings.repo.test.ts src/repositories/accounts.repo.ts src/repositories/accounts.repo.test.ts && git commit -m "feat(repo): cash holdings write balances transactionally + cascade delete"
  ```

### Task 5: Net-worth entry expansion — holding → `{currency, minorUnits}[]`

**Files:**
- Modify: `src/holdings/holding-value.ts` (add types + helpers after the `ValuableHolding` type, line 10, and at the end after `holdingValue`, line 173)
- Create: `src/holdings/holding-entries.test.ts`
- Modify: `src/rates/conversion.ts` (imports; add `sumEntries`; rewrite `netWorth`, lines 30–39)
- Modify: `src/rates/conversion.test.ts`
- Modify: `src/rates/net-worth-view.ts` (imports; `ConvertibleHolding`, line 6; rewrite `guardedNetWorth`, lines 33–41)
- Modify: `src/rates/net-worth-view.test.ts`
- Modify: `src/rates/currency-totals.ts` (imports; rewrite `sumByCurrency`, lines 15–26)
- Modify: `src/rates/currency-totals.test.ts`

**Interfaces:**
- Produces (holding-value.ts):
  - `type CurrencyAmount = { currency: Currency; minorUnits: number }`
  - `type CashBalance = { currency: Currency; balanceMinorUnits: number }`
  - `type ValuableHoldingWithBalances = ValuableHolding & { balances?: CashBalance[] }`
  - `holdingEntries(holding: ValuableHoldingWithBalances, now: number): CurrencyAmount[]`
  - `attachBalances<H extends { id: string }>(holdings: H[], balances: { holdingId: string; currency: Currency; balanceMinorUnits: number }[]): (H & { balances: CashBalance[] })[]`
  - `cashBalancesToMoney(balances: CashBalance[]): Money[]`
- Produces (conversion.ts): `sumEntries(entries: CurrencyAmount[], base: Currency, rates: RateTable): Money`; `netWorth(holdings: ValuableHoldingWithBalances[], base, rates, now): Money`
- Produces (net-worth-view.ts): `guardedNetWorth(holdings: ConvertibleHolding[], base, rates, now): Money` (per-entry guard)
- Produces (currency-totals.ts): `sumByCurrency(holdings: ValuableHoldingWithBalances[], now?): Money[]`

Steps:

- [ ] Write the failing test at `src/holdings/holding-entries.test.ts`:
  ```ts
  import { Money } from '../currency/money';
  import type { ValuableHoldingWithBalances } from './holding-value';
  import { attachBalances, cashBalancesToMoney, holdingEntries } from './holding-value';

  const NOW = Date.UTC(2026, 0, 1);

  describe('holdingEntries', () => {
    it('expands a non-cash holding into exactly one entry from holdingValue', () => {
      const card: ValuableHoldingWithBalances = {
        type: 'card',
        currency: 'USD',
        balanceMinorUnits: 10_000,
        metadata: null,
      };

      expect(holdingEntries(card, NOW)).toEqual([{ currency: 'USD', minorUnits: 10_000 }]);
    });

    it('expands a cash holding into one entry per balance row', () => {
      const cash: ValuableHoldingWithBalances = {
        type: 'cash',
        currency: 'UAH',
        balanceMinorUnits: 0,
        metadata: null,
        balances: [
          { currency: 'UAH', balanceMinorUnits: 100_000 },
          { currency: 'USD', balanceMinorUnits: 5_000 },
        ],
      };

      expect(holdingEntries(cash, NOW)).toEqual([
        { currency: 'UAH', minorUnits: 100_000 },
        { currency: 'USD', minorUnits: 5_000 },
      ]);
    });

    it('expands a cash holding with no balance rows into no entries', () => {
      const cash: ValuableHoldingWithBalances = {
        type: 'cash',
        currency: 'UAH',
        balanceMinorUnits: 0,
        metadata: null,
      };

      expect(holdingEntries(cash, NOW)).toEqual([]);
    });
  });

  describe('attachBalances', () => {
    it('attaches each holding its own balance rows, empty when it has none', () => {
      const holdings = [
        { id: 'h1', type: 'cash' as const },
        { id: 'h2', type: 'card' as const },
      ];
      const balances = [
        { holdingId: 'h1', currency: 'UAH' as const, balanceMinorUnits: 100_000 },
        { holdingId: 'h1', currency: 'USD' as const, balanceMinorUnits: 5_000 },
      ];

      const result = attachBalances(holdings, balances);

      expect(result[0].balances).toEqual([
        { currency: 'UAH', balanceMinorUnits: 100_000 },
        { currency: 'USD', balanceMinorUnits: 5_000 },
      ]);
      expect(result[1].balances).toEqual([]);
    });
  });

  describe('cashBalancesToMoney', () => {
    it('orders balances by the canonical currency order (UAH, USD, EUR)', () => {
      const result = cashBalancesToMoney([
        { currency: 'EUR', balanceMinorUnits: 3_000 },
        { currency: 'UAH', balanceMinorUnits: 100_000 },
        { currency: 'USD', balanceMinorUnits: 5_000 },
      ]);

      expect(result).toEqual([
        Money.of('UAH', 100_000),
        Money.of('USD', 5_000),
        Money.of('EUR', 3_000),
      ]);
    });
  });
  ```
- [ ] Run and see it fail:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/holdings/holding-entries.test.ts
  ```
  Expected failure: `holdingEntries is not a function` (the exports do not exist yet).
- [ ] Implement in `src/holdings/holding-value.ts`. Add `import { type Currency, currencyOptions } from '../currency/currency';` at the top (the file already imports `Money, toMajor`). After the `ValuableHolding` type (line 10) add:
  ```ts
  /** A single currency amount, in that currency's minor units. */
  export type CurrencyAmount = { currency: Currency; minorUnits: number };

  /** One stored cash balance row (from `holding_balances`). */
  export type CashBalance = { currency: Currency; balanceMinorUnits: number };

  /**
   * A valuable holding plus, for a CASH holding, its loaded `holding_balances`
   * rows. Absent/empty for every other type — those value through `holdingValue`
   * unchanged.
   */
  export type ValuableHoldingWithBalances = ValuableHolding & { balances?: CashBalance[] };
  ```
  At the end of the file (after `holdingValue`, line 173) add:
  ```ts
  /**
   * Expand a holding into its currency-amount entries — the unit the net-worth
   * layer sums. A CASH holding yields one entry per balance row (its own
   * `balanceMinorUnits` is unused and stays 0); every other type yields exactly
   * one entry from the unchanged `holdingValue`. This is the single place cash's
   * "many amounts per holding" fans out.
   */
  export const holdingEntries = (
    holding: ValuableHoldingWithBalances,
    now: number,
  ): CurrencyAmount[] => {
    if (holding.type === 'cash') {
      return (holding.balances ?? []).map((balance) => ({
        currency: balance.currency,
        minorUnits: balance.balanceMinorUnits,
      }));
    }
    const value = holdingValue(holding, now);
    return [{ currency: value.currency, minorUnits: value.minorUnits }];
  };

  /**
   * Attach each holding its own `holding_balances` rows (loaded via a batched
   * query), keyed by id — the join a screen does before feeding holdings to the
   * net-worth/value layer. A holding with no rows gets an empty `balances` list.
   */
  export const attachBalances = <H extends { id: string }>(
    holdings: H[],
    balances: { holdingId: string; currency: Currency; balanceMinorUnits: number }[],
  ): (H & { balances: CashBalance[] })[] => {
    const byHolding = new Map<string, CashBalance[]>();
    for (const balance of balances) {
      const list = byHolding.get(balance.holdingId) ?? [];
      list.push({ currency: balance.currency, balanceMinorUnits: balance.balanceMinorUnits });
      byHolding.set(balance.holdingId, list);
    }
    return holdings.map((holding) => ({ ...holding, balances: byHolding.get(holding.id) ?? [] }));
  };

  /**
   * Order a cash holding's balances by the canonical currency order (UAH, USD,
   * EUR) and lift each to a `Money`, ready for the `CurrencyBreakdown` display
   * (which expects an already-ordered `Money[]`).
   */
  export const cashBalancesToMoney = (balances: CashBalance[]): Money[] =>
    [...balances]
      .sort(
        (first, second) =>
          currencyOptions.indexOf(first.currency) - currencyOptions.indexOf(second.currency),
      )
      .map((balance) => Money.of(balance.currency, balance.balanceMinorUnits));
  ```
- [ ] Run and see it pass:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/holdings/holding-entries.test.ts
  ```
  Expected: green.
- [ ] Write the failing net-worth cases. Append to `src/rates/net-worth-view.test.ts` inside the `guardedNetWorth` describe:
  ```ts
  it('sums a multi-currency cash holding, converting each balance to the base', () => {
    const holdings = [
      {
        type: 'cash' as const,
        currency: 'UAH' as const,
        balanceMinorUnits: 0,
        metadata: null,
        balances: [
          { currency: 'UAH' as const, balanceMinorUnits: 100_000 }, // 1000.00 UAH
          { currency: 'USD' as const, balanceMinorUnits: 10_000 }, // 100.00 USD -> 4000.00 UAH
        ],
      },
    ];
    const total = guardedNetWorth(holdings, 'UAH', rates, 0);
    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBe(500_000); // 1000 + 4000 UAH
  });

  it('excludes only the unconvertible cash balance, keeping the rest', () => {
    const holdings = [
      {
        type: 'cash' as const,
        currency: 'UAH' as const,
        balanceMinorUnits: 0,
        metadata: null,
        balances: [
          { currency: 'UAH' as const, balanceMinorUnits: 100_000 },
          { currency: 'EUR' as const, balanceMinorUnits: 5_000 }, // no EUR:UAH rate, dropped
        ],
      },
    ];
    const total = guardedNetWorth(holdings, 'UAH', rates, 0);
    expect(total.minorUnits).toBe(100_000); // only the UAH balance survives
  });
  ```
  Append to `src/rates/conversion.test.ts` inside the `netWorth` describe:
  ```ts
  it('sums a cash holding as one entry per balance', () => {
    const holdings = [
      {
        type: 'cash' as const,
        currency: 'UAH' as const,
        balanceMinorUnits: 0,
        metadata: null,
        balances: [
          { currency: 'UAH' as const, balanceMinorUnits: 100_000 },
          { currency: 'USD' as const, balanceMinorUnits: 10_000 },
        ],
      },
    ];
    const total = netWorth(holdings, 'UAH', rates, 0);
    expect(total.minorUnits).toBe(500_000); // 1000 + 4000 UAH
  });
  ```
  Append to `src/rates/currency-totals.test.ts` inside the `sumByCurrency` describe:
  ```ts
  it('buckets a cash holding by each of its per-currency balances', () => {
    const cash: ValuableHolding = {
      type: 'cash',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: null,
      // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture) balances is optional on ValuableHoldingWithBalances; the cast keeps the card() helper's ValuableHolding shape for the rest of the suite
    } as any;
    (cash as { balances: unknown }).balances = [
      { currency: 'UAH', balanceMinorUnits: 100_000 },
      { currency: 'USD', balanceMinorUnits: 5_000 },
    ];

    const result = sumByCurrency([cash, card('UAH', 2_500)]);

    expect(result).toEqual([Money.of('UAH', 102_500), Money.of('USD', 5_000)]);
  });
  ```
  (Simpler alternative that avoids the override: import `ValuableHoldingWithBalances` in this test and type the cash fixture directly as that — prefer this if the `card()` helper's return type does not force `ValuableHolding`.)
- [ ] Run and see the three suites fail:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/rates/net-worth-view.test.ts src/rates/conversion.test.ts src/rates/currency-totals.test.ts
  ```
  Expected failure: the cash sums come back 0 (the current functions read `holding.balanceMinorUnits`/`holdingValue`, which is 0 for cash) — the new assertions (`500_000`, `100_000`, `102_500`) do not match.
- [ ] Implement in `src/rates/conversion.ts`. Replace the imports (lines 1–3) and `netWorth` (lines 30–39):
  ```ts
  import { type Currency, currencyScale } from '../currency/currency';
  import { Money } from '../currency/money';
  import {
    type CurrencyAmount,
    holdingEntries,
    type ValuableHoldingWithBalances,
  } from '../holdings/holding-value';
  ```
  (`convert` and `rateKey` above stay unchanged.) Then:
  ```ts
  /** Convert each entry to the base currency and sum. Shared by the net-worth paths. */
  export const sumEntries = (
    entries: CurrencyAmount[],
    base: Currency,
    rates: RateTable,
  ): Money =>
    entries.reduce(
      (sum, entry) => sum.add(convert(Money.of(entry.currency, entry.minorUnits), base, rates)),
      Money.of(base, 0),
    );

  export const netWorth = (
    holdings: ValuableHoldingWithBalances[],
    base: Currency,
    rates: RateTable,
    now: number,
  ): Money => sumEntries(holdings.flatMap((holding) => holdingEntries(holding, now)), base, rates);
  ```
- [ ] Implement in `src/rates/net-worth-view.ts`. Update imports and `ConvertibleHolding` (line 6), then rewrite `guardedNetWorth` (lines 33–41):
  ```ts
  import type { Currency } from '../currency/currency';
  import type { Money } from '../currency/money';
  import type { CurrencyRateRow, HoldingRow } from '../db/schema';
  import { type CashBalance, holdingEntries } from '../holdings/holding-value';
  import { type RateTable, sumEntries } from './conversion';

  type ConvertibleHolding = Pick<
    HoldingRow,
    'currency' | 'balanceMinorUnits' | 'type' | 'metadata'
  > & { balances?: CashBalance[] };
  ```
  (`buildRateTable` and `canConvert` are unchanged.) Then:
  ```ts
  /** Sum the given holdings in the base currency, excluding any ENTRY that cannot convert. */
  export const guardedNetWorth = (
    holdings: ConvertibleHolding[],
    base: Currency,
    rates: RateTable,
    now: number,
  ): Money => {
    const entries = holdings
      .flatMap((holding) => holdingEntries(holding, now))
      .filter((entry) => canConvert(entry.currency, base, rates));
    return sumEntries(entries, base, rates);
  };
  ```
  (The old `netWorth` import is removed; `sumEntries` replaces it.)
- [ ] Implement in `src/rates/currency-totals.ts`. Replace the file body:
  ```ts
  import type { Currency } from '../currency/currency';
  import { Money } from '../currency/money';
  import { holdingEntries, type ValuableHoldingWithBalances } from '../holdings/holding-value';

  /**
   * Sums a list of holdings into one {@link Money} per distinct currency, using
   * {@link holdingEntries} so a cash holding contributes each of its per-currency
   * balances and every other type contributes its single valued amount (net of
   * tax, grown to `now`). Ordered by descending absolute minor-unit value. Empty
   * input yields `[]`.
   */
  export const sumByCurrency = (
    holdings: ValuableHoldingWithBalances[],
    now: number = Date.now(),
  ): Money[] => {
    const totals = new Map<Currency, number>();

    for (const holding of holdings) {
      for (const entry of holdingEntries(holding, now)) {
        totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.minorUnits);
      }
    }

    return Array.from(totals, ([currency, minorUnits]) => Money.of(currency, minorUnits)).sort(
      (a, b) => Math.abs(b.minorUnits) - Math.abs(a.minorUnits),
    );
  };
  ```
- [ ] Run and see everything pass (including the previously-green non-cash cases, which are unchanged):
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/rates/net-worth-view.test.ts src/rates/conversion.test.ts src/rates/currency-totals.test.ts src/holdings/holding-entries.test.ts
  ```
  Expected: green.
- [ ] Lint:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npm run check:lint
  ```
  Expected: silent.
- [ ] Commit:
  ```bash
  git add src/holdings/holding-value.ts src/holdings/holding-entries.test.ts src/rates/conversion.ts src/rates/conversion.test.ts src/rates/net-worth-view.ts src/rates/net-worth-view.test.ts src/rates/currency-totals.ts src/rates/currency-totals.test.ts && git commit -m "feat(rates): expand holdings to per-currency entries for cash net worth"
  ```

### Task 6: Cash holding form — the balances editor

**Files:**
- Create: `src/screens/forms/cash-balances-editor.ts`
- Create: `src/screens/forms/cash-balances-editor.test.ts`
- Modify: `src/screens/forms/holding-form.screen.tsx`
- Modify: `src/screens/forms/holding-form.screen.test.tsx`

**Interfaces:**
- Consumes: `fiatCurrencyOptions`, `FiatCurrency` (`../../currency/currency`); `Money`, `toMajor` (`../../currency/money`); `parseAmount` (`../../currency/parse`); `groupAmount` (`./amount-format`); `BalanceInput` (`../../repositories/holding-balances.repo`)
- Produces (cash-balances-editor.ts):
  - `type BalanceRow = { id: number; currency: FiatCurrency; amount: string }`
  - `availableCurrencies(rows: BalanceRow[], exceptId?: number): FiatCurrency[]`
  - `canAddRow(rows: BalanceRow[]): boolean`
  - `addRow(rows: BalanceRow[], nextId: number): BalanceRow[]`
  - `removeRow(rows: BalanceRow[], id: number): BalanceRow[]`
  - `setRowCurrency(rows: BalanceRow[], id: number, currency: FiatCurrency): BalanceRow[]`
  - `setRowAmount(rows: BalanceRow[], id: number, amount: string): BalanceRow[]`
  - `seedBalanceRows(balances: BalanceInput[]): BalanceRow[]`
  - `toBalanceInputs(rows: BalanceRow[]): BalanceInput[]`
- Produces (holding-form.screen.tsx): the cash create path calls `holdingsRepo.createCash`; the cash edit path calls `holdingsRepo.updateCash`

Steps:

- [ ] Write the failing test at `src/screens/forms/cash-balances-editor.test.ts`:
  ```ts
  import { Money } from '../../currency/money';
  import {
    addRow,
    availableCurrencies,
    type BalanceRow,
    canAddRow,
    removeRow,
    seedBalanceRows,
    setRowAmount,
    setRowCurrency,
    toBalanceInputs,
  } from './cash-balances-editor';

  const rows = (...currencies: BalanceRow['currency'][]): BalanceRow[] =>
    currencies.map((currency, id) => ({ id, currency, amount: '' }));

  describe('availableCurrencies', () => {
    it('offers only fiat, never BTC', () => {
      expect(availableCurrencies([])).toEqual(['UAH', 'USD', 'EUR']);
      expect(availableCurrencies([])).not.toContain('BTC');
    });

    it('excludes currencies already used by other rows (blocks a duplicate)', () => {
      expect(availableCurrencies(rows('UAH', 'USD'))).toEqual(['EUR']);
    });

    it('keeps the row own currency available when computing its own options', () => {
      expect(availableCurrencies(rows('UAH', 'USD'), 0)).toEqual(['UAH', 'EUR']);
    });
  });

  describe('addRow / canAddRow', () => {
    it('appends a row on the first unused currency', () => {
      expect(addRow(rows('UAH'), 9)).toEqual([
        { id: 0, currency: 'UAH', amount: '' },
        { id: 9, currency: 'USD', amount: '' },
      ]);
    });

    it('cannot add once all three fiat currencies are used', () => {
      expect(canAddRow(rows('UAH', 'USD', 'EUR'))).toBe(false);
      expect(addRow(rows('UAH', 'USD', 'EUR'), 9)).toEqual(rows('UAH', 'USD', 'EUR'));
    });
  });

  describe('removeRow', () => {
    it('removes the row with the given id', () => {
      expect(removeRow(rows('UAH', 'USD'), 0)).toEqual([{ id: 1, currency: 'USD', amount: '' }]);
    });

    it('never removes the last remaining row (at least one required)', () => {
      expect(removeRow(rows('UAH'), 0)).toEqual(rows('UAH'));
    });
  });

  describe('setRowCurrency / setRowAmount', () => {
    it('updates only the targeted row', () => {
      expect(setRowCurrency(rows('UAH', 'USD'), 1, 'EUR')).toEqual([
        { id: 0, currency: 'UAH', amount: '' },
        { id: 1, currency: 'EUR', amount: '' },
      ]);
      expect(setRowAmount(rows('UAH'), 0, '12.50')).toEqual([
        { id: 0, currency: 'UAH', amount: '12.50' },
      ]);
    });
  });

  describe('toBalanceInputs', () => {
    it('parses each row amount into minor units (blank -> 0)', () => {
      const result = toBalanceInputs([
        { id: 0, currency: 'UAH', amount: '1,000.00' },
        { id: 1, currency: 'USD', amount: '' },
      ]);
      expect(result).toEqual([
        { currency: 'UAH', balanceMinorUnits: 100_000 },
        { currency: 'USD', balanceMinorUnits: 0 },
      ]);
    });
  });

  describe('seedBalanceRows', () => {
    it('defaults to one empty UAH row when there are no balances', () => {
      expect(seedBalanceRows([])).toEqual([{ id: 0, currency: 'UAH', amount: '' }]);
    });

    it('renders each stored balance back as a grouped major-unit string', () => {
      const seeded = seedBalanceRows([{ currency: 'USD', balanceMinorUnits: 5_000 }]);
      expect(seeded[0]).toMatchObject({ currency: 'USD' });
      expect(Money.fromMajor('USD', Number(seeded[0].amount.replace(/[^0-9.]/g, ''))).minorUnits).toBe(
        5_000,
      );
    });
  });
  ```
- [ ] Run and see it fail:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/screens/forms/cash-balances-editor.test.ts
  ```
  Expected failure: `Cannot find module './cash-balances-editor'`.
- [ ] Create `src/screens/forms/cash-balances-editor.ts`:
  ```ts
  import { type FiatCurrency, fiatCurrencyOptions } from '../../currency/currency';
  import { Money, toMajor } from '../../currency/money';
  import { parseAmount } from '../../currency/parse';
  import type { BalanceInput } from '../../repositories/holding-balances.repo';
  import { groupAmount } from './amount-format';

  /** One editor row: a fiat currency and its amount as an in-progress string. */
  export type BalanceRow = { id: number; currency: FiatCurrency; amount: string };

  // The fiat currencies still free to pick for a row: the full fiat set minus the
  // currencies OTHER rows already use, so a duplicate can never be chosen. Passing
  // `exceptId` keeps that row's own currency in its own picker.
  export const availableCurrencies = (rows: BalanceRow[], exceptId?: number): FiatCurrency[] => {
    const used = new Set(rows.filter((row) => row.id !== exceptId).map((row) => row.currency));
    return fiatCurrencyOptions.filter((currency) => !used.has(currency));
  };

  export const canAddRow = (rows: BalanceRow[]): boolean => availableCurrencies(rows).length > 0;

  // Append a row on the first still-unused fiat currency; a no-op once all three
  // are taken (there is nothing left to add).
  export const addRow = (rows: BalanceRow[], nextId: number): BalanceRow[] => {
    const next = availableCurrencies(rows)[0];
    return next === undefined ? rows : [...rows, { id: nextId, currency: next, amount: '' }];
  };

  // Remove the row, unless it is the last one — a cash holding must keep at least
  // one currency row.
  export const removeRow = (rows: BalanceRow[], id: number): BalanceRow[] =>
    rows.length > 1 ? rows.filter((row) => row.id !== id) : rows;

  export const setRowCurrency = (
    rows: BalanceRow[],
    id: number,
    currency: FiatCurrency,
  ): BalanceRow[] => rows.map((row) => (row.id === id ? { ...row, currency } : row));

  export const setRowAmount = (rows: BalanceRow[], id: number, amount: string): BalanceRow[] =>
    rows.map((row) => (row.id === id ? { ...row, amount } : row));

  // Seed the editor from stored balances (edit mode); an empty set yields one
  // blank UAH row so a fresh cash holding starts as a set of one.
  export const seedBalanceRows = (balances: BalanceInput[]): BalanceRow[] =>
    balances.length === 0
      ? [{ id: 0, currency: 'UAH', amount: '' }]
      : balances.map((balance, index) => ({
          id: index,
          currency: balance.currency,
          amount: groupAmount(String(toMajor(balance.balanceMinorUnits, balance.currency))),
        }));

  // Convert the editor rows to the persistable balance list: each amount parsed to
  // minor units (blank/junk -> 0, an allowed empty slot).
  export const toBalanceInputs = (rows: BalanceRow[]): BalanceInput[] =>
    rows.map((row) => ({
      currency: row.currency,
      balanceMinorUnits: Money.fromMajor(row.currency, parseAmount(row.amount) || 0).minorUnits,
    }));
  ```
- [ ] Run and see it pass:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/screens/forms/cash-balances-editor.test.ts
  ```
  Expected: green.
- [ ] Write the failing form-render test. Extend `src/screens/forms/holding-form.screen.test.tsx`: add `createCash` and `updateCash` to the `holdingsRepo` mock, and add a cash describe. First widen the mock (top of file):
  ```ts
  jest.mock('../../repositories/holdings.repo', () => ({
    holdingsRepo: {
      create: jest.fn().mockResolvedValue('new-holding-id'),
      createCash: jest.fn().mockResolvedValue('new-cash-id'),
      updateCash: jest.fn(),
      setIcon: jest.fn(),
      update: jest.fn(),
      byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    },
  }));
  ```
  Add near the other mock accessors:
  ```ts
  const createCashMock = holdingsRepo.createCash as jest.Mock;
  ```
  Then the describe (a cash account kind offers `cash` as the sole creatable type, so the form defaults to it):
  ```ts
  describe('cash balances editor', () => {
    beforeEach(() => {
      mockAccountKind = 'cash';
      createCashMock.mockClear();
    });

    it('offers a balances editor (currency chips + amount) instead of a single balance field', async () => {
      const screen = renderScreen();
      // The default single "Balance" field is gone for cash; the first balance
      // row's amount field is present instead.
      expect(screen.queryByLabelText('Balance')).toBeNull();
      expect(screen.getByLabelText('UAH amount')).toBeTruthy();
    });

    it('adds a second currency row, and never offers BTC', async () => {
      const screen = renderScreen();
      await fireEvent.press(screen.getByText('Add currency'));
      // A second row appears on the next unused fiat currency (USD); BTC is never a chip.
      expect(screen.getByLabelText('USD amount')).toBeTruthy();
      expect(screen.queryByText('BTC')).toBeNull();
    });

    it('writes the balance list through createCash on save', async () => {
      const screen = renderScreen();
      await fill(screen, 'Name', 'Envelope');
      await fill(screen, 'UAH amount', '1,000.00');
      await fireEvent.press(screen.getByText('Save'));

      expect(createCashMock).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc-1',
          name: 'Envelope',
          currency: 'UAH',
          balances: [{ currency: 'UAH', balanceMinorUnits: 100_000 }],
        }),
      );
    });
  });
  ```
- [ ] Run and see it fail:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/screens/forms/holding-form.screen.test.tsx -t "cash balances editor"
  ```
  Expected failure: `getByLabelText('UAH amount')` finds nothing (the cash path still renders the single "Balance" field), and `createCash` is never called.
- [ ] Implement the cash path in `src/screens/forms/holding-form.screen.tsx`. Add imports:
  ```ts
  import { type FiatCurrency, currencyOptions } from '../../currency/currency';
  import {
    type BalanceRow,
    addRow,
    availableCurrencies,
    canAddRow,
    removeRow,
    seedBalanceRows,
    setRowAmount,
    setRowCurrency,
    toBalanceInputs,
  } from './cash-balances-editor';
  ```
  Add editor state next to the other type-specific state (after the bond state block, ~line 232):
  ```ts
  // cash state — the per-currency balances editor (one row per currency)
  const nextBalanceRowId = useRef(1);
  const [balanceRows, setBalanceRows] = useState<BalanceRow[]>([
    { id: 0, currency: 'UAH', amount: '' },
  ]);
  ```
  In the edit-mode hydration effect (the `if (holding.type === 'bond') { ... }` chain, ~line 266), add a cash branch before the final `setOpeningBalance(...)` fallback — but note the balances come from a SEPARATE live query, so seed from a `cashBalances` prop loaded below. Add a balances live query near the `editHoldings` query (~line 168):
  ```ts
  const { data: editBalances } = useLiveQuery(
    holdingBalancesRepo.balancesForHoldingQuery(holdingId ?? ''),
    ['holding_balances'],
  );
  ```
  (Import `holdingBalancesRepo` from `../../repositories/holding-balances.repo`.) Seed the editor once, in its own effect keyed on edit + the loaded balances (kept separate from the one-shot `hydrated` seed so it re-runs when the async balances arrive):
  ```ts
  const balancesHydrated = useRef(false);
  useEffect(() => {
    if (!isEdit || balancesHydrated.current || editingHolding?.type !== 'cash') {
      return;
    }
    if (editBalances.length === 0) {
      return; // wait for the batched read to resolve
    }
    balancesHydrated.current = true;
    const seeded = seedBalanceRows(
      editBalances.map((balance) => ({
        currency: balance.currency,
        balanceMinorUnits: balance.balanceMinorUnits,
      })),
    );
    setBalanceRows(seeded);
    nextBalanceRowId.current = seeded.length;
  }, [isEdit, editingHolding, editBalances]);
  ```
  Add the row handlers (near `addContribution`, ~line 293):
  ```ts
  const addBalanceRow = (): void => {
    const nextId = nextBalanceRowId.current++;
    setBalanceRows((rows) => addRow(rows, nextId));
  };
  const removeBalanceRow = (id: number): void => setBalanceRows((rows) => removeRow(rows, id));
  const changeBalanceCurrency = (id: number, currency: FiatCurrency): void =>
    setBalanceRows((rows) => setRowCurrency(rows, id, currency));
  const changeBalanceAmount = (id: number, amount: string): void =>
    setBalanceRows((rows) => setRowAmount(rows, id, amount));
  ```
  In `save` (line 405), add the cash branches. For create (before the generic `holdingsRepo.create` call, line 440):
  ```ts
  if (!isEdit && type === 'cash') {
    await holdingsRepo.createCash({
      accountId,
      name,
      currency: balanceRows[0].currency,
      balances: toBalanceInputs(balanceRows),
      color,
    });
    if (icon !== null) {
      // createCash resolves to the new id; keep the icon split identical to
      // the generic create path.
    }
    navigation.goBack();
    return;
  }
  ```
  (If a picked icon must persist for cash, capture the resolved id: `const newId = await holdingsRepo.createCash(...); if (icon !== null) await holdingsRepo.setIcon(newId, icon);` — mirror the generic path exactly.) For edit (inside `if (isEdit && holdingId !== undefined)`, before the generic `holdingsRepo.update`, line 418):
  ```ts
  if (type === 'cash') {
    await holdingsRepo.updateCash(holdingId, { name, color }, toBalanceInputs(balanceRows));
    await holdingsRepo.setIcon(holdingId, icon);
    navigation.goBack();
    return;
  }
  ```
  Render the editor. Replace the single cash/other balance field condition (lines 510–518) so cash renders the editor and every OTHER non-deposit/bond type keeps the single field:
  ```tsx
  {type !== 'term_deposit' && type !== 'bond' && type !== 'cash' && !isSyncedEdit && (
    <TextField
      label="Balance"
      value={openingBalance}
      onChangeText={(text) => setOpeningBalance(groupAmount(text))}
      keyboardType="decimal-pad"
      placeholder="0.00"
    />
  )}

  {type === 'cash' && (
    <Box gap={4}>
      {balanceRows.map((row) => (
        <Box key={row.id} gap={2}>
          <ChipRow
            label={`Currency ${row.id + 1}`}
            options={availableCurrencies(balanceRows, row.id)}
            selected={row.currency}
            onSelect={(currency) => changeBalanceCurrency(row.id, currency)}
          />
          <TextField
            label={`${row.currency} amount`}
            value={row.amount}
            onChangeText={(text) => changeBalanceAmount(row.id, groupAmount(text))}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          {balanceRows.length > 1 && (
            <Button
              variant="secondary"
              size="compact"
              fullWidth={false}
              accessibilityLabel={`Remove currency ${row.id + 1}`}
              onPress={() => removeBalanceRow(row.id)}
            >
              Remove
            </Button>
          )}
        </Box>
      ))}
      {canAddRow(balanceRows) && (
        <Button variant="secondary" size="compact" fullWidth={false} onPress={addBalanceRow}>
          Add currency
        </Button>
      )}
    </Box>
  )}
  ```
  Hide the single `Currency` ChipRow for cash (its currency is per-row now) — change the currency ChipRow (lines 502–508) to `{type !== 'cash' && ( <ChipRow label="Currency" ... /> )}`. Cash is always valid on the amount side (a zero amount is an allowed empty slot), so the existing `.with('card', 'cash', 'crypto_asset', 'jar', () => true)` in `isValid` (line 402) needs no change beyond a name — leave it.
- [ ] Run and see the form tests pass:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/screens/forms/holding-form.screen.test.tsx
  ```
  Expected: green (existing non-cash form tests still pass — they run under `mockAccountKind = 'bank'`, whose creatable types exclude cash).
- [ ] Lint:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npm run check:lint
  ```
  Expected: silent.
- [ ] Commit:
  ```bash
  git add src/screens/forms/cash-balances-editor.ts src/screens/forms/cash-balances-editor.test.ts src/screens/forms/holding-form.screen.tsx src/screens/forms/holding-form.screen.test.tsx && git commit -m "feat(screens): cash holding form balances editor"
  ```

### Task 7: Display — cash card total + cash detail breakdown + net-worth wiring

**Files:**
- Modify: `src/screens/account-detail/holding-card.component.tsx`
- Modify: `src/screens/account-detail/holding-card.component.test.tsx`
- Modify: `src/screens/account-detail/account-detail.screen.tsx`
- Modify: `src/screens/holding-detail/holding-detail.screen.tsx`
- Modify: `src/screens/holding-detail/holding-detail.screen.test.tsx`
- Modify: `src/screens/home/home.screen.tsx`
- Modify: `src/screens/statistics/statistics.screen.tsx`

**Interfaces:**
- Consumes: `holdingBalancesRepo.balancesForHoldingsQuery` / `balancesForHoldingQuery` (`../../repositories/holding-balances.repo`); `attachBalances`, `cashBalancesToMoney`, `ValuableHoldingWithBalances`, `CashBalance` (`../../holdings/holding-value`); `guardedNetWorth`, `buildRateTable` (`../../rates/net-worth-view`); `CurrencyBreakdown`
- Produces:
  - `HoldingCard` prop additions `baseCurrency: Currency`, `rateTable: RateTable`; a cash holding renders its base-currency total, every other type is unchanged
  - The holding-detail screen renders `CurrencyBreakdown` for a cash holding under the `EntityAmountHeader` "Value"
  - account-detail / home / statistics attach balances so cash contributes per-currency to net worth

Steps:

- [ ] Write the failing card test. Add to `src/screens/account-detail/holding-card.component.test.tsx`. The card gains `baseCurrency`/`rateTable` props; a cash holding sums its balances in the base currency. Add a helper and a case:
  ```ts
  const cashHolding = (balances: { currency: string; balanceMinorUnits: number }[]): HoldingRow =>
    ({
      id: 'h-cash',
      name: 'Envelope',
      type: 'cash',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: null,
      balances,
    }) as unknown as HoldingRow;

  it('shows a cash holding total as the sum of its balances in the base currency', async () => {
    const { getByText } = await render(
      <HoldingCard
        holding={cashHolding([
          { currency: 'UAH', balanceMinorUnits: 100000 }, // 1,000.00 UAH
          { currency: 'USD', balanceMinorUnits: 10000 }, // 100.00 USD -> 4,000.00 UAH
        ])}
        now={NOW}
        baseCurrency="UAH"
        rateTable={{ 'USD:UAH': 40 }}
        onOpen={jest.fn()}
      />,
    );

    expect(getByText(/5,000\.00 ₴/)).toBeTruthy();
  });
  ```
  The existing non-cash card tests must pass the two new props too (a non-cash card ignores them): add `baseCurrency="UAH" rateTable={{}}` to each existing `<HoldingCard ... />` render in that file.
- [ ] Run and see it fail:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/screens/account-detail/holding-card.component.test.tsx
  ```
  Expected failure: the cash card renders `0.00 ₴` (current `holdingValue` reads the cash row's `balanceMinorUnits`, which is 0), so `/5,000\.00 ₴/` is not found; TypeScript/props for `baseCurrency`/`rateTable` are also unknown.
- [ ] Implement in `src/screens/account-detail/holding-card.component.tsx`:
  ```tsx
  import type { Currency } from '../../currency/currency';
  import type { CashBalance } from '../../holdings/holding-value';
  import { guardedNetWorth, type RateTable } from '../../rates/net-worth-view';
  // ...existing imports (holdingValue stays for non-cash)...

  const HoldingCard: FC<{
    holding: HoldingRow & { balances?: CashBalance[] };
    now: number;
    baseCurrency: Currency;
    rateTable: RateTable;
    onOpen: () => void;
  }> = ({ holding, now, baseCurrency, rateTable, onOpen }) => {
    const color = resolveEntityColor(holding.color, defaultHoldingColor[holding.type]);
    // A cash holding's headline is the base-currency SUM of its per-currency
    // balances (each converted, unconvertible ones dropped by the guard); every
    // other type keeps its single computed value.
    const money =
      holding.type === 'cash'
        ? guardedNetWorth([holding], baseCurrency, rateTable, now)
        : holdingValue(holding, now);
    // ...render `money` via MoneyText where `holdingValue(holding, now)` was used...
  };
  ```
  Replace the `<MoneyText money={holdingValue(holding, now)} ... />` (line 51) with `<MoneyText money={money} style={styles.value} />`. (`RateTable` is re-exported from net-worth-view via its `./conversion` import; if not exported there, import `type { RateTable } from '../../rates/conversion'`.)
- [ ] Run and see the card tests pass:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/screens/account-detail/holding-card.component.test.tsx
  ```
  Expected: green.
- [ ] Wire balances into `src/screens/account-detail/account-detail.screen.tsx`. Add the batched balances live query after the holdings query (line 79):
  ```ts
  const holdingIds = holdings.map((holding) => holding.id);
  const { data: holdingBalances } = useLiveQuery(
    holdingBalancesRepo.balancesForHoldingsQuery(holdingIds),
    ['holding_balances'],
  );
  ```
  (Import `holdingBalancesRepo` from `../../repositories/holding-balances.repo` and `attachBalances` from `../../holdings/holding-value`.) Attach before valuing (replace `activeHoldings` derivation, line 114, and the net-worth/breakdown lines 123–124):
  ```ts
  const activeHoldings = attachBalances(
    holdings.filter((holding) => holding.closedAt == null),
    holdingBalances,
  );
  // ...baseCurrency / rateTable / now unchanged...
  const overallBalance = guardedNetWorth(activeHoldings, baseCurrency, rateTable, now);
  const breakdown = sumByCurrency(activeHoldings, now);
  ```
  Pass the new props to the card (line 324):
  ```tsx
  <HoldingCard
    holding={item}
    now={now}
    baseCurrency={baseCurrency}
    rateTable={rateTable}
    onOpen={() => navigation.navigate('HoldingDetail', { holdingId: item.id })}
  />
  ```
  (`item` now carries `balances` from `attachBalances`; `Sortable.Grid`'s `data` is `activeHoldings`, so this flows through.)
- [ ] Write the failing holding-detail test. The file already mocks `MoneyText` (rendering `formatMoney(money)`) and drives data through `mockUseLiveQuery` keyed on `keys[0]`. The existing `seed` helper's fallthrough returns the transactions array for EVERY non-holdings/categories tag, which would mis-answer the new `holding_balances`/`currency_rates`/`settings` reads — so add a dedicated `seedCash` helper and a cash case. Add the repo mocks the screen now imports (extend the existing `jest.mock` block near line 89):
  ```ts
  jest.mock('../../repositories/rates.repo', () => ({
    ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
  }));
  jest.mock('../../repositories/settings.repo', () => ({
    settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
  }));
  jest.mock('../../repositories/holding-balances.repo', () => ({
    holdingBalancesRepo: {
      balancesForHoldingQuery: (holdingId: string) => ({ toSQL: () => ({ sql: '', params: [holdingId] }) }),
    },
  }));
  ```
  Add the helper (next to `seed`, line 150) and the test:
  ```ts
  const seedCash = (
    holding: unknown,
    balances: unknown[],
    rates: unknown[],
    baseCurrency: string,
  ): void => {
    mockUseLiveQuery.mockImplementation((_query: unknown, keys: string[]) => {
      switch (keys[0]) {
        case 'holdings':
          return { data: [holding] };
        case 'holding_balances':
          return { data: balances };
        case 'currency_rates':
          return { data: rates };
        case 'settings':
          return { data: [{ baseCurrency }] };
        default:
          return { data: [] };
      }
    });
  };

  it('renders a cash holding as a per-currency breakdown under the Value header, with no ledger', async () => {
    seedCash(
      cashHolding,
      [
        { holdingId: 'h-1', currency: 'UAH', balanceMinorUnits: 100_000 }, // 1,000.00 UAH
        { holdingId: 'h-1', currency: 'USD', balanceMinorUnits: 10_000 }, // 100.00 USD -> 4,000.00 UAH
      ],
      [{ base: 'USD', quote: 'UAH', rate: '40' }],
      'UAH',
    );

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Value')).toBeTruthy();
    expect(getByText('USD')).toBeTruthy();
    expect(getByText(/5,000\.00 ₴/)).toBeTruthy(); // base-currency total
    expect(queryByText('Transactions')).toBeNull(); // cash carries no ledger
  });
  ```
  (`cashHolding` already exists in the file — id `h-1`, type `cash`, currency `UAH`, balance 0.)
- [ ] Run and see it fail:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/screens/holding-detail/holding-detail.screen.test.tsx -t "cash holding"
  ```
  Expected failure: the screen renders the deposit/bond-style value (0 for cash) and the Transactions section, with no `CurrencyBreakdown`.
- [ ] Implement in `src/screens/holding-detail/holding-detail.screen.tsx`. Add live queries for rates, settings, and this holding's balances (near the existing queries, line 105):
  ```ts
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const { data: cashBalances } = useLiveQuery(
    holdingBalancesRepo.balancesForHoldingQuery(holdingId),
    ['holding_balances'],
  );
  ```
  (Import `ratesRepo`, `settingsRepo`, `holdingBalancesRepo`, `buildRateTable`/`guardedNetWorth` from net-worth-view, `CurrencyBreakdown`, and `cashBalancesToMoney`/`attachBalances` from holding-value.) Compute the cash view (after `breakdown`, line 118):
  ```ts
  const isCash = holding?.type === 'cash';
  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);
  // Ordered per-currency Money[] for the breakdown; the base-currency total for
  // the Value header (unconvertible balances dropped by the guard).
  const cashItems = isCash ? cashBalancesToMoney(cashBalances) : [];
  const cashTotal =
    isCash && holding
      ? guardedNetWorth(attachBalances([holding], cashBalances), baseCurrency, rateTable, now)
      : null;
  ```
  (`cashBalances` rows are `HoldingBalanceRow` — `{ holdingId, currency, balanceMinorUnits }` — which satisfy both `cashBalancesToMoney`'s `CashBalance[]` and `attachBalances`'s balance-row parameter.)
  In the render, branch the value block (lines 207–226) so cash shows the header + breakdown and no ledger:
  ```tsx
  {isCash && cashTotal && (
    <Box gap={1}>
      <EntityAmountHeader label="Value" money={cashTotal} context="balance" />
      <Box style={styles.breakdown}>
        <CurrencyBreakdown items={cashItems} />
      </Box>
    </Box>
  )}

  {!isCash && holding && breakdown && (
    // ...existing EntityAmountHeader + breakdownRows block, unchanged...
  )}
  ```
  Wrap the `Transactions` section and the footer action so they do not render for cash (cash has no ledger — the spec says "No transaction ledger"): guard the `<Box gap={2}><Text variant="heading">Transactions</Text>...` block with `{!isCash && (...)}`, and render the footer `<Button>` only when `!isCash` (a cash holding is edited through the header Edit action).
- [ ] Run and see it pass:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest src/screens/holding-detail/holding-detail.screen.test.tsx
  ```
  Expected: green (the existing deposit/bond/card detail tests still pass — they take the `!isCash` branch unchanged).
- [ ] Wire balances into `src/screens/home/home.screen.tsx` so cash contributes to the net-worth headline. Add the batched balances query after the holdings query (line 128):
  ```ts
  const { data: holdingBalances } = useLiveQuery(
    holdingBalancesRepo.balancesForHoldingsQuery(holdings.map((holding) => holding.id)),
    ['holding_balances'],
  );
  ```
  (Import `holdingBalancesRepo` and `attachBalances`.) Attach before valuing (replace `activeHoldings`, lines 193–195, and `total`/`breakdown`, lines 197–198):
  ```ts
  const activeHoldings = attachBalances(
    holdings.filter(
      (holding) => holding.closedAt == null && !archivedAccountIds.has(holding.accountId),
    ),
    holdingBalances,
  );
  const now = Date.now();
  const total = guardedNetWorth(activeHoldings, baseCurrency, rateTable, now);
  const breakdown = sumByCurrency(activeHoldings, now);
  ```
- [ ] Wire balances into `src/screens/statistics/statistics.screen.tsx` so the by-type bar and account-contribution pie count cash per-currency. Add the batched balances query after the holdings query (line 99):
  ```ts
  const { data: holdingBalances } = useLiveQuery(
    holdingBalancesRepo.balancesForHoldingsQuery(holdings.map((holding) => holding.id)),
    ['holding_balances'],
  );
  ```
  (Import `holdingBalancesRepo` and `attachBalances`.) In the `filtered` memo (line 137), attach balances to `visibleHoldings` and add `holdingBalances` to the dependency array:
  ```ts
  const visibleHoldings = attachBalances(
    holdings.filter(
      (holding) => holding.closedAt == null && filteredAccountIds.has(holding.accountId),
    ),
    holdingBalances,
  );
  // ...return { visibleAccounts, filteredAccounts, visibleHoldings };
  // deps: [accounts, holdings, holdingBalances, selectedAccounts]
  ```
  (`buildTypeBreakdown` / `buildAccountContribution` consume `filtered.visibleHoldings` via `guardedNetWorth`, which now expands cash. `buildNetWorthSeries` is a transaction-reconstructed historical series and is out of scope — a cash holding has no transactions, so it contributes only its "now" snapshot through the bar/pie, matching the spec's scope.)
- [ ] Run the full unit suite and the harness to confirm nothing regressed:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round && npx jest && npm run check:all
  ```
  Expected: all Jest suites green; `check:all` (lint, dup, knip, deps, security, secrets, overrides) silent/exit 0.
- [ ] Commit:
  ```bash
  git add src/screens/account-detail/holding-card.component.tsx src/screens/account-detail/holding-card.component.test.tsx src/screens/account-detail/account-detail.screen.tsx src/screens/holding-detail/holding-detail.screen.tsx src/screens/holding-detail/holding-detail.screen.test.tsx src/screens/home/home.screen.tsx src/screens/statistics/statistics.screen.tsx && git commit -m "feat(screens): show cash holdings per-currency across card, detail, and net worth"
  ```

---

## Final verification

- [ ] Run the deep checkpoint before declaring done (per CLAUDE.md): `npm run check:deep` (mutation + osv-scanner). Address any NEW mutation survivors in the cash code; the pre-existing `image-size` CVEs are accepted debt (do not silence).
- [ ] Rebuild on device and let the user verify the migration applies (an existing single-currency cash holding shows one balance row equal to its old amount) and a new multi-currency cash holding sums correctly — do NOT screenshot for design review; rebuild and hand off live.
