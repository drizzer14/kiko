# Transaction Category Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit any transaction's category (manual OR synced) and have that choice persist as a name→category override rule that immediately rewrites every existing same-name transaction and is re-applied to every future synced transaction with the same name.

**Architecture:** A new `category_overrides` table stores one rule per normalized transaction name. Editing a category always upserts the rule and, in the same `db.transaction`, rewrites every existing transaction whose normalized name matches. The Monobank sync insert path (`transactionsRepo.addManyDedup`) applies matching rules to incoming rows at insert time. Name matching is done ONLY in JavaScript through a single normalize helper (never in SQL — SQLite's built-in `lower()` is ASCII-only and would silently fail to match Cyrillic Monobank merchant names).

**Tech Stack:** React Native 0.87, TypeScript, `@op-engineering/op-sqlite` + `drizzle-orm`, `drizzle-kit` (`driver: 'expo'`), Jest + React Native Testing Library.

**Spec:** This document's "Design & Data Model" section below doubles as the short spec. Read it together with the `kiko-architecture` and `kiko-domain` skills before implementing.

## Global Constraints

- Worktree `/Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round`, branch `drizzer14/pff-ux-round`.
- **Every write goes through `write()` / one `db.transaction`** — including a single-statement one (`kiko-architecture`). Reactive live queries only fire for writes made inside a transaction.
- Migrations are **generated** with `npx drizzle-kit generate`, never hand-edited. After generating, hand-add the new file's import to `drizzle/migrations/migrations.js` (that index is hand-maintained; drizzle-kit does not touch it). Never hand-edit `meta/_journal.json` or the `*_snapshot.json`.
- Repositories are functional modules of exported functions, constrained with `satisfies Repository` (never a `: Repository` annotation). Read functions return a Drizzle query builder (not executed); write functions perform a transactional write.
- Store amounts as integer minor units only. Category values on `transactions` and on the rule are the category's **stable slug `key`** (lowercase), never its title — see the data model.
- `npm run check:all` stays green at every checkpoint; `npm run check:deep` before done. Never weaken a check. Blank line before every `return`/`if`/`for`/`while`/`switch`. Single quotes, 2-space indent, trailing commas, `import type` for type-only imports.
- Commit per task with trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do NOT commit unless the coordinator asks — hold diffs for user review.

---

## Design & Data Model (short spec — review this first)

### The three confirmed decisions (do not re-open)

1. **Storage = rule + rewrite.** Editing a transaction's category (a) upserts a name→category rule and (b) in ONE `db.transaction` immediately UPDATEs every existing transaction whose normalized name matches. Every future synced insert whose normalized name matches a rule gets its category from the rule at insert time.
2. **Name match = normalized:** one `normalizeTransactionName` helper (NFC → collapse internal whitespace → trim → lowercase). The rule stores the normalized key for lookup.
3. **Propagation = always.** Editing any transaction's category always propagates to all same-name transactions and sets the future override. There is no single-transaction-only edit.

### What "name" and "category" mean here

- The **name** of a transaction is its `transactions.description` (`src/db/schema.ts:48`). For synced rows this is Monobank's merchant description (`sync.ts:98`, `mapStatementItem` sets `description: item.description ?? ''`); for manual rows it is the user's typed description.
- The stored **category** is a category's stable slug `key` (`categories.key`, `src/db/schema.ts:121`). The display layer (`src/categories/category-display.ts`) resolves `key → { title, icon }` and lowercases the stored value before lookup (`resolveCategoryDisplay`, line 27). The seed keys are lowercase slugs (`groceries`, `dining`, …, `other` — `drizzle/migrations/0002_seed_categories.sql`). The override and the picker therefore store the category **key**, which is what user-created categories (random-id keys) require to resolve correctly.

### New table: `category_overrides`

Added to `src/db/schema.ts` (a new `sqliteTable`):

| column | type | notes |
|---|---|---|
| `normalizedName` | `text('normalized_name')` PRIMARY KEY | the JS-normalized name key; one rule per name |
| `category` | `text('category').notNull()` | the category **key** (slug) to apply |
| `displayName` | `text('display_name').notNull()` | the last-seen human name (trimmed), for showing the user which name the rule covers |
| `createdAt` | `integer('created_at').notNull().default(sql\`(unixepoch() * 1000)\`)` | ms epoch |
| `updatedAt` | `integer('updated_at').notNull().default(sql\`(unixepoch() * 1000)\`)` | ms epoch, bumped on every upsert |

**Relationship to `transactions`:** a soft match, NOT a foreign key — `normalizedName` matches `normalizeTransactionName(transactions.description)`, computed in JS. **Relationship to `categories`:** `category` references `categories.key` by convention but is NOT an enforced FK; a dangling key resolves to the neutral/`other` fallback via `resolveCategoryDisplay`, so the app degrades gracefully.

### Why matching is JS-only (not SQL)

SQLite's built-in `lower()` lowercases ASCII only; it leaves Cyrillic (`АТБ`) unchanged. A Ukrainian/Monobank ledger is full of Cyrillic merchant names, so a `WHERE lower(trim(description)) = ?` filter would silently miss case-variant Cyrillic matches. Therefore:
- The rewrite (Task 3) `SELECT`s the candidate transactions and filters in JS with `normalizeTransactionName`, then `UPDATE ... WHERE id IN (...)`.
- The sync hook (Task 4) normalizes incoming descriptions in JS and looks up rules by exact equality on the already-normalized `normalized_name` (an exact string compare SQL does correctly).
This app's ledger is a single user's — a full-table JS scan inside one transaction is comfortably within budget.

### The one mechanism that also fixes the current row

`upsertCategoryOverride(name, key)` rewrites EVERY transaction matching `name`, including the one the user just saved. So the form does not need to pass a category into `recordManual`/`update` — after the primary write, calling the override sets the current row's category too. This keeps `recordManual`/`update` signatures untouched.

### Files created / modified

- Create `src/transactions/normalize-name.ts` (+ test) — the single normalize helper.
- Modify `src/db/schema.ts` — add `categoryOverrides` table + `CategoryOverrideRow` type.
- Generate `drizzle/migrations/0007_*.sql` (+ snapshot, journal); modify `drizzle/migrations/migrations.js`.
- Create `src/repositories/category-overrides.repo.ts` (+ test) — `upsertCategoryOverride`, `getByNameQuery`.
- Modify `src/repositories/transactions.repo.ts` (+ test) — apply overrides inside `addManyDedup`.
- Create `src/screens/forms/category-field/` (component, props, styles, test) — the always-editable picker.
- Modify `src/screens/forms/transaction-form.screen.tsx` (+ test) — wire the picker, the confirm, and the override call; allow a category-only save on synced rows.
- Modify `src/screens/home/home.screen.tsx` (+ test) — group/match the category filter by resolved title so an overridden slug key and an un-overridden capitalized synced value collapse into one chip.

### Edge cases (encoded across the tasks)

- **Empty/whitespace-only name** → normalized key is `''`; `upsertCategoryOverride` and the sync hook both no-op (never create a catch-all rule, never rewrite empty-description rows). (Task 1, 3, 4.)
- **Multiple sequential edits** → `onConflictDoUpdate` on `normalized_name`: last write wins for `category`, and the rewrite moves every matching row to the newest category. (Task 3.)
- **A synced name matching a rule created earlier** → applied at insert time in `addManyDedup`. (Task 4.)
- **Renaming a category** → categories are keyed by stable slug; rename only changes `title`. Rules store the `key`, so a rename flows through the display with zero writes to rules or transactions. (No code — verified by the existing `categories` key design; noted in Task 3 test comment.)
- **Deleting a category a rule references / a rule whose category no longer exists** → categories are not deletable in the current app (`categoriesRepo` exposes only `create`/`updateTitle`/`updateIcon`), so a dangling reference can only arise from a future delete. `resolveCategoryDisplay` already falls back to `other`/`NEUTRAL_CATEGORY` for a missing key, and the rule stays inert but harmless. No cascade. (Documented; asserted in Task 5/7 display tests.)
- **Filter chip split** → before this feature all category storage is mixed-case (synced rows store the capitalized MCC name, e.g. `Groceries`, from `categoryForMcc`); overrides store the lowercase slug key (`groceries`). Task 7 makes the Home filter group and match on the **resolved title**, so both collapse into one nicely-labeled chip.

---

### Task 1: The `normalizeTransactionName` helper

**Files:**
- Create: `src/transactions/normalize-name.ts`
- Test: `src/transactions/normalize-name.test.ts`

**Interfaces:**
- Produces: `normalizeTransactionName(name: string): string` — used by Tasks 3, 4, 6.

- [ ] **Step 1: Write the failing test** — `src/transactions/normalize-name.test.ts`

```ts
import { normalizeTransactionName } from './normalize-name';

describe('normalizeTransactionName', () => {
  it('lowercases and trims edge whitespace', () => {
    expect(normalizeTransactionName('  ATB Market  ')).toBe('atb market');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeTransactionName('ATB   Market\tShop')).toBe('atb market shop');
  });

  it('lowercases non-ASCII (Cyrillic) that SQLite lower() would not', () => {
    expect(normalizeTransactionName('АТБ')).toBe(normalizeTransactionName('атб'));
  });

  it('applies NFC unicode normalization so composed/decomposed forms match', () => {
    // 'café' composed vs 'cafe' + combining acute accent
    expect(normalizeTransactionName('café')).toBe(normalizeTransactionName('café'));
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeTransactionName('   \t  ')).toBe('');
  });

  it('returns an empty string for an empty input', () => {
    expect(normalizeTransactionName('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/transactions/normalize-name.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `src/transactions/normalize-name.ts`

```ts
/**
 * The ONE normalization used to match transactions by name. Applied in JS
 * everywhere a name is compared — never in SQL: SQLite's built-in lower() is
 * ASCII-only and would silently fail to match case-variant Cyrillic Monobank
 * merchant names. Order: NFC (unify composed/decomposed unicode) → collapse
 * internal whitespace runs → trim edges → lowercase (full-Unicode via JS).
 */
export const normalizeTransactionName = (name: string): string =>
  name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/transactions/normalize-name.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — `npm run check:all` green. Commit `feat(transactions): normalizeTransactionName helper`.

---

### Task 2: `category_overrides` schema + generated migration

**Files:**
- Modify: `src/db/schema.ts` (add table after `categories`, line 121-127)
- Generate: `drizzle/migrations/0007_*.sql`, `drizzle/migrations/meta/0007_snapshot.json`, updated `meta/_journal.json`
- Modify: `drizzle/migrations/migrations.js`
- Test: `src/db/schema.category-overrides.test.ts` (new) — asserts the generated CREATE TABLE migration exists

**Interfaces:**
- Produces: `categoryOverrides` sqliteTable + `CategoryOverrideRow` type — used by Tasks 3, 4.

- [ ] **Step 1: Write the failing test** — `src/db/schema.category-overrides.test.ts`

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('category_overrides migration', () => {
  const migrationsDir = join(__dirname, '../../drizzle/migrations');
  const sqlFiles = (): string[] =>
    readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(join(migrationsDir, name), 'utf8'));

  it('creates the category_overrides table', () => {
    const combined = sqlFiles().join('\n');
    expect(combined).toContain('CREATE TABLE `category_overrides`');
    expect(combined).toContain('`normalized_name`');
    expect(combined).toContain('`category`');
    expect(combined).toContain('`display_name`');
  });

  it('registers the new migration in the migrations index', () => {
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');
    expect(index).toContain('0007');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/db/schema.category-overrides.test.ts`
Expected: FAIL — no such migration yet.

- [ ] **Step 3: Add the table to the schema** — in `src/db/schema.ts`, after the `categories` table:

```ts
/**
 * A name→category override rule. Editing any transaction's category upserts a
 * rule keyed by the JS-normalized name (see normalizeTransactionName), which
 * (1) rewrites every existing same-name transaction and (2) is re-applied to
 * every future synced insert with that name. `category` is a categories.key
 * (slug); `displayName` is the last-seen human name, shown to the user.
 */
export const categoryOverrides = sqliteTable('category_overrides', {
  normalizedName: text('normalized_name').primaryKey(),
  category: text('category').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
});

export type CategoryOverrideRow = typeof categoryOverrides.$inferSelect;
```

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new `0007_*.sql` with `CREATE TABLE \`category_overrides\``, a new `meta/0007_snapshot.json`, and a new `_journal.json` entry (idx 7). Do NOT hand-edit journal/snapshot.

- [ ] **Step 5: Register the migration in the hand-maintained index** — `drizzle/migrations/migrations.js`: add the import line and map entry, matching the existing pattern (`m0000`…`m0006`):

```js
import m0007 from './0007_<generated_name>.sql';
// ...
migrations: {
  m0000, m0001, m0002, m0003, m0004, m0005, m0006, m0007,
},
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest src/db/schema.category-overrides.test.ts`
Expected: PASS.

- [ ] **Step 7: Checkpoint** — `npm run check:all` green (dup check may flag the snapshot — it is already ignored per `.jscpd.json`). Commit `feat(db): category_overrides table + migration`.

---

### Task 3: `categoryOverridesRepo.upsertCategoryOverride` (rule upsert + rewrite)

**Files:**
- Create: `src/repositories/category-overrides.repo.ts`
- Test: `src/repositories/category-overrides.repo.test.ts`

**Interfaces:**
- Consumes: `normalizeTransactionName` (Task 1), `categoryOverrides`/`transactions` schema (Task 2, `src/db/schema.ts`), `write`/`database` (`src/db/client.ts`), `Repository` (`src/repositories/repository.ts`).
- Produces:
  - `upsertCategoryOverride(name: string, category: string): Promise<void>` — one `write()`: upsert the rule AND rewrite all matching existing transactions. No-op when the normalized name is empty. Used by Task 6.
  - `getByNameQuery(normalizedName: string)` — reactive Drizzle select of the single rule row. (Provided for completeness/future reactive consumers; the sync hook in Task 4 queries the table directly inside its own transaction.)

- [ ] **Step 1: Write the failing test** — `src/repositories/category-overrides.repo.test.ts`

Follow the existing repo-test mock pattern (`src/repositories/categories.repo.test.ts`, `transactions.repo.test.ts`): mock `@op-engineering/op-sqlite`, override `write` to run the callback against a fake `tx`, and import the schema table objects to key captured writes.

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

import { categoryOverrides, transactions } from '../db/schema';
import { categoryOverridesRepo } from './category-overrides.repo';

// Fake tx: the rule upsert (insert->values->onConflictDoUpdate), the
// full-scan select of transactions, and the id-filtered category update.
const makeTx = (allTransactions: { id: string; description: string }[]) => {
  const captured: {
    ruleValues?: Record<string, unknown>;
    ruleConflict?: Record<string, unknown>;
    txUpdateSet?: Record<string, unknown>;
    txUpdateWhereCalled: boolean;
  } = { txUpdateWhereCalled: false };
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (config: Record<string, unknown>) => {
          if (table === categoryOverrides) {
            captured.ruleValues = values;
            captured.ruleConflict = config;
          }
          return Promise.resolve();
        },
      }),
    }),
    select: () => ({ from: () => Promise.resolve(allTransactions) }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (table === transactions) {
          captured.txUpdateSet = values;
        }
        return {
          where: () => {
            captured.txUpdateWhereCalled = true;
            return Promise.resolve();
          },
        };
      },
    }),
  };
  return { tx, captured };
};

describe('categoryOverridesRepo.upsertCategoryOverride', () => {
  it('upserts the rule keyed by the normalized name and rewrites matching transactions', async () => {
    const { tx, captured } = makeTx([
      { id: 't1', description: 'ATB Market' },
      { id: 't2', description: '  atb   market ' }, // same normalized name
      { id: 't3', description: 'Coffee' }, // different
    ]);
    mockTx = tx;

    await categoryOverridesRepo.upsertCategoryOverride('ATB Market', 'groceries');

    expect(captured.ruleValues).toMatchObject({
      normalizedName: 'atb market',
      category: 'groceries',
      displayName: 'ATB Market',
    });
    // last-write-wins update on conflict
    expect(captured.ruleConflict).toMatchObject({ target: categoryOverrides.normalizedName });
    // the current row + the whitespace/case variant are rewritten; Coffee is not
    expect(captured.txUpdateSet).toEqual({ category: 'groceries' });
    expect(captured.txUpdateWhereCalled).toBe(true);
  });

  it('no-ops on a whitespace-only name — no rule, no rewrite', async () => {
    const { tx, captured } = makeTx([{ id: 't1', description: '   ' }]);
    mockTx = tx;

    await categoryOverridesRepo.upsertCategoryOverride('   ', 'groceries');

    expect(captured.ruleValues).toBeUndefined();
    expect(captured.txUpdateSet).toBeUndefined();
    expect(captured.txUpdateWhereCalled).toBe(false);
  });

  it('does not issue an update when no existing transaction matches', async () => {
    const { tx, captured } = makeTx([{ id: 't3', description: 'Coffee' }]);
    mockTx = tx;

    await categoryOverridesRepo.upsertCategoryOverride('ATB Market', 'groceries');

    expect(captured.ruleValues).toBeDefined();
    expect(captured.txUpdateSet).toBeUndefined();
    expect(captured.txUpdateWhereCalled).toBe(false);
  });

  it('exposes a reactive by-name query', () => {
    const { sql, params } = categoryOverridesRepo.getByNameQuery('atb market').toSQL();
    expect(sql).toContain('category_overrides');
    expect(params).toContain('atb market');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/repositories/category-overrides.repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation** — `src/repositories/category-overrides.repo.ts`

```ts
import { eq, inArray, sql } from 'drizzle-orm';
import { database, write } from '../db/client';
import { categoryOverrides, transactions } from '../db/schema';
import { normalizeTransactionName } from '../transactions/normalize-name';
import type { Repository } from './repository';

export const categoryOverridesRepo = {
  getByNameQuery: (normalizedName: string) =>
    database
      .select()
      .from(categoryOverrides)
      .where(eq(categoryOverrides.normalizedName, normalizedName))
      .limit(1),
  /**
   * Upsert a name→category rule AND rewrite every existing same-name transaction
   * to the new category, all in ONE op-sqlite transaction so a partial failure
   * can never leave the rule and the ledger disagreeing. Matching is done in JS
   * (never SQL) so Cyrillic/whitespace variants match — see normalizeTransactionName.
   * A whitespace-only name is a no-op: it must not create a catch-all rule.
   */
  upsertCategoryOverride: (name: string, category: string) =>
    write(async (tx) => {
      const key = normalizeTransactionName(name);
      if (key === '') {
        return;
      }

      const displayName = name.trim();
      await tx
        .insert(categoryOverrides)
        .values({ normalizedName: key, category, displayName })
        .onConflictDoUpdate({
          target: categoryOverrides.normalizedName,
          set: { category, displayName, updatedAt: sql`(unixepoch() * 1000)` },
        });

      const rows = await tx
        .select({ id: transactions.id, description: transactions.description })
        .from(transactions);
      const matchingIds = rows
        .filter((row) => normalizeTransactionName(row.description) === key)
        .map((row) => row.id);
      if (matchingIds.length === 0) {
        return;
      }

      await tx
        .update(transactions)
        .set({ category })
        .where(inArray(transactions.id, matchingIds));
    }),
} satisfies Repository;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/repositories/category-overrides.repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — `npm run check:all` green. Commit `feat(repositories): category override upsert + rewrite`.

---

### Task 4: Apply overrides at synced-insert time (`addManyDedup`)

**Files:**
- Modify: `src/repositories/transactions.repo.ts` (`addManyDedup`, lines 147-159)
- Test: `src/repositories/transactions.repo.test.ts` (add a describe block for override-on-insert)

**Interfaces:**
- Consumes: `normalizeTransactionName` (Task 1), `categoryOverrides` schema (Task 2).
- Produces: `addManyDedup(inputs)` now sets each incoming row's `category` from a matching rule before inserting; unchanged signature.

- [ ] **Step 1: Write the failing test** — append to `src/repositories/transactions.repo.test.ts`

```ts
import { categoryOverrides } from '../db/schema';

// Fake tx for addManyDedup: a rule lookup (select->from->where resolving the
// rules) then an insert (values captured, onConflictDoNothing).
const makeAddManyTx = (rules: { normalizedName: string; category: string }[]) => {
  const captured: { inserted?: Record<string, unknown>[] } = {};
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rules) }) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>[]) => {
        if (table !== categoryOverrides) {
          captured.inserted = values;
        }
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
  };
  return { tx, captured };
};

describe('transactionsRepo.addManyDedup category overrides', () => {
  it('applies a matching rule to an incoming synced row at insert time', async () => {
    const { tx, captured } = makeAddManyTx([{ normalizedName: 'atb market', category: 'groceries' }]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([
      { holdingId: 'h1', amountMinorUnits: -500, time: 1, source: 'monobank', description: 'ATB Market', category: 'Other', externalId: 'e1' },
      { holdingId: 'h1', amountMinorUnits: -700, time: 2, source: 'monobank', description: 'Coffee', category: 'Dining', externalId: 'e2' },
    ]);

    const inserted = captured.inserted ?? [];
    expect(inserted[0]).toMatchObject({ description: 'ATB Market', category: 'groceries' });
    // no rule for Coffee — its mapped category is left untouched
    expect(inserted[1]).toMatchObject({ description: 'Coffee', category: 'Dining' });
  });

  it('skips empty-description rows and inserts nothing when the input is empty', async () => {
    const { tx, captured } = makeAddManyTx([]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([]);
    expect(captured.inserted).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/repositories/transactions.repo.test.ts -t 'category overrides'`
Expected: FAIL — overrides not applied yet.

- [ ] **Step 3: Update `addManyDedup`** — `src/repositories/transactions.repo.ts`. Add imports (`inArray` from `drizzle-orm`, `categoryOverrides` from `../db/schema`, `normalizeTransactionName` from `../transactions/normalize-name`) and rewrite the body:

```ts
  addManyDedup: (inputs: NewTransaction[]) =>
    write(async (tx) => {
      if (inputs.length === 0) {
        return;
      }
      // Apply name→category override rules at insert time. Normalize each
      // incoming description in JS (never SQL) and look the rules up by exact
      // equality on the already-normalized key.
      const keys = Array.from(
        new Set(inputs.map((input) => normalizeTransactionName(input.description ?? ''))),
      ).filter((key) => key !== '');
      const rules =
        keys.length > 0
          ? await tx
              .select()
              .from(categoryOverrides)
              .where(inArray(categoryOverrides.normalizedName, keys))
          : [];
      const categoryByName = new Map(rules.map((rule) => [rule.normalizedName, rule.category]));
      const withOverrides = inputs.map((input) => {
        const override = categoryByName.get(normalizeTransactionName(input.description ?? ''));

        return override ? { ...input, category: override } : input;
      });
      // Dedup re-imported statement items against the (source, external_id)
      // unique index — a repeated Monobank statement id is skipped, not
      // duplicated. Manual rows with a null externalId are never conflated.
      await tx
        .insert(transactions)
        .values(withOverrides.map((input) => ({ id: id(), ...input })))
        .onConflictDoNothing();
    }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/repositories/transactions.repo.test.ts`
Expected: PASS (existing `addManyDedup`/`recordManual`/`update`/`remove` tests still green).

- [ ] **Step 5: Checkpoint** — `npm run check:all` green. Commit `feat(repositories): apply category overrides on synced insert`.

---

### Task 5: The `CategoryField` picker component

**Files:**
- Create: `src/screens/forms/category-field/category-field.component.tsx`
- Create: `src/screens/forms/category-field/category-field.props.d.ts`
- Create: `src/screens/forms/category-field/category-field.styles.ts`
- Create: `src/screens/forms/category-field/index.ts`
- Test: `src/screens/forms/category-field/category-field.component.test.tsx`

**Interfaces:**
- Produces (default export) `CategoryField`:

```ts
type CategoryOption = { key: string; title: string; icon: string };
type CategoryFieldProps = {
  label: string;
  options: readonly CategoryOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
};
```

Renders a caption `label` above a single-select horizontal chip row (each chip = a `SymbolIcon` + the category `title`), always enabled (a synced transaction's category IS editable — decision 3). Modeled on `ChipRow` (`src/screens/forms/chip-row/chip-row.component.tsx`) but sourced from category options and showing icons. Uses `Box`, `Text`, `SymbolIcon`, and theme tokens (`accent`/`surface` for selected/unselected, as `ChipRow` does). A horizontal `ScrollView` wraps the chips since there can be 10+ categories.

- [ ] **Step 1: Write the failing test** — `category-field.component.test.tsx`

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import CategoryField from './category-field.component';

const OPTIONS = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'dining', title: 'Dining', icon: 'fork.knife' },
];

describe('CategoryField', () => {
  it('renders the label and a chip per option', () => {
    const { getByText } = render(
      <CategoryField label="Category" options={OPTIONS} selectedKey={null} onSelect={jest.fn()} />,
    );

    expect(getByText('Category')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();
    expect(getByText('Dining')).toBeTruthy();
  });

  it('reports the picked category key', () => {
    const onSelect = jest.fn();
    const { getByText } = render(
      <CategoryField label="Category" options={OPTIONS} selectedKey="groceries" onSelect={onSelect} />,
    );

    fireEvent.press(getByText('Dining'));
    expect(onSelect).toHaveBeenCalledWith('dining');
  });

  it('marks the selected chip as selected for accessibility', () => {
    const { getByRole } = render(
      <CategoryField label="Category" options={OPTIONS} selectedKey="groceries" onSelect={jest.fn()} />,
    );

    const groceries = getByRole('button', { name: /Groceries/ });
    expect(groceries.props.accessibilityState.selected).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/category-field`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component, props, styles, and barrel.**

`category-field.props.d.ts`:

```ts
export type CategoryOption = { key: string; title: string; icon: string };

export type CategoryFieldProps = {
  label: string;
  options: readonly CategoryOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
};
```

`category-field.component.tsx` — a labeled caption + a horizontal `ScrollView` of single-select chips (icon + title), keyed on `option.key`, styled with the theme (`accent` selected / `surface` unselected), each with `accessibilityRole="button"`, `accessibilityState={{ selected: selectedKey === option.key }}`, and an `accessibilityLabel` of the title. Default export, `.component.tsx` suffix, explicit `return`. Read the theme via `useUnistyles()`. `category-field.styles.ts` via `StyleSheet.create((theme) => ...)`. `index.ts` re-exports the default.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/category-field`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — `npm run check:all` green (knip: the barrel + component must be imported by Task 6 — if committing this task alone trips knip's unused-file check, combine the commit with Task 6, or land Task 6 in the same checkpoint). Commit `feat(forms): CategoryField picker component`.

---

### Task 6: Wire category editing into the transaction form

**Files:**
- Modify: `src/screens/forms/transaction-form.screen.tsx`
- Test: `src/screens/forms/transaction-form.screen.test.tsx`

**Interfaces:**
- Consumes: `CategoryField` (Task 5), `categoriesRepo.allQuery` (`src/repositories/categories.repo.ts`), `categoryOverridesRepo.upsertCategoryOverride` (Task 3), `resolveCategoryDisplay`/`buildCategoryDisplayMap` (`src/categories/category-display.ts`), `normalizeTransactionName` (Task 1, for the confirm displayName trim only — reuse `.trim()`).

**Behavior:**
- Live-query the categories: `useLiveQuery(categoriesRepo.allQuery(), ['categories'])`. Map to `CategoryOption[]` (`{ key, title, icon }`).
- Track `selectedCategory: string | null`. Hydrate it in the existing hydration effect (lines 111-120) from `existing.category ? existing.category.toLowerCase() : null` (lowercasing matches how the display resolves a stored value to a key; a null category stays unselected). Keep the hydration inside the `!hydrated` latch. Add a stable `originalCategoryKey` derived the same way so "changed" can be computed.
- Render `<CategoryField label="Category" options={categoryOptions} selectedKey={selectedCategory} onSelect={setSelectedCategory} />` in the form body — **always editable, even when `isReadOnly`** (decision 3). Place it after the sign `ChipRow`.
- **Footer / Save visibility:** show the Save button when `!isReadOnly` OR the category changed. Compute `const categoryChanged = selectedCategory !== null && selectedCategory !== originalCategoryKey;`. Footer: `footer={(!isReadOnly || categoryChanged) ? <Button onPress={save}>Save</Button> : undefined}`. (A synced row with no category change stays a plain read-only view, as today.)
- **`save()`** (replace the current body):
  1. If `!isReadOnly`: run the existing amount validation and the existing `transactionsRepo.update(...)` (edit) or `transactionsRepo.recordManual(...)` (add). Unchanged.
  2. If `categoryChanged`: the name the rule keys on is the synced row's own description when read-only, else the (possibly edited) `description` just saved. Show a confirm `Alert` (see copy below); on **Apply**, `await categoryOverridesRepo.upsertCategoryOverride(name, selectedCategory)` then `navigation.goBack()`; on **Cancel**, `navigation.goBack()` without applying (the manual edit from step 1 still stands).
  3. If not `categoryChanged`: `navigation.goBack()` after step 1.

  Keep the async UI handler as plain `async`/`Alert` (the `kiko-code-style` carve-out: `either`/`guard` are for the data layer, not a screen handler that shows an `Alert`).

  Confirm copy (title case, per design system):
  - Title: `Apply Category to All`
  - Message: `Apply “${title}” to all transactions named “${displayName}”? This also applies to future imports.` where `title = resolveCategoryDisplay(selectedCategory, categoryByKey).title` and `displayName = (isReadOnly ? existing.description : description).trim()`.
  - Buttons: `{ text: 'Cancel', style: 'cancel', onPress: goBack }`, `{ text: 'Apply', onPress: applyThenGoBack }`.

- [ ] **Step 1: Write the failing tests** — extend `transaction-form.screen.test.tsx`. Mock `categoryOverridesRepo.upsertCategoryOverride`, mock `Alert.alert` to auto-press "Apply", and provide categories via the mocked `useLiveQuery`. Cover:
  - Editing a MANUAL row's category calls `upsertCategoryOverride(description, pickedKey)` (and still calls `transactionsRepo.update`).
  - A SYNCED (monobank) row now shows a Save once the category is changed, and saving calls `upsertCategoryOverride(existing.description, pickedKey)` and does NOT call `transactionsRepo.update`.
  - No category change → `upsertCategoryOverride` is never called.
  - Cancelling the confirm does not call `upsertCategoryOverride`.

Reference the existing test's mocking of `transactionsRepo` and `useLiveQuery` for the exact harness shape.

```ts
// sketch of the key assertions
expect(upsertCategoryOverride).toHaveBeenCalledWith('ATB Market', 'groceries');
// synced-row case:
expect(update).not.toHaveBeenCalled();
expect(upsertCategoryOverride).toHaveBeenCalledWith('Monobank Merchant', 'dining');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx`
Expected: FAIL — picker/override not wired.

- [ ] **Step 3: Implement the wiring** in `transaction-form.screen.tsx` as specified above. Add imports (`CategoryField`, `categoriesRepo`, `categoryOverridesRepo`, `buildCategoryDisplayMap`/`resolveCategoryDisplay`), the categories live query, the `selectedCategory`/`originalCategoryKey`/`categoryChanged` state, the hydration line, the `CategoryField` JSX (blank line between siblings), the footer condition, and the new `save()` with the confirm `Alert`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — `npm run check:all` green (this also resolves any Task 5 knip pending-import). Commit `feat(forms): edit + propagate transaction category override`.

---

### Task 7: Collapse the Home category filter to the resolved title

**Files:**
- Modify: `src/screens/home/home.screen.tsx` (lines 225-235 — `distinctCategories`, `filteredTransactions` category match)
- Test: `src/screens/home/home.screen.test.tsx`

**Why:** After an override, some rows store the lowercase slug key (`groceries`) while un-overridden synced rows still store the capitalized MCC name (`Groceries`). The current filter groups by the raw stored value, so the same logical category would split into two chips with ugly casing. Grouping and matching by the **resolved display title** collapses them into one nicely-labeled chip. (`holding-detail.screen.tsx` already resolves per-row for display — this brings the Home filter in line.)

- [ ] **Step 1: Write the failing test** — in `home.screen.test.tsx`, seed transactions where one row has `category: 'Groceries'` and another `category: 'groceries'` (plus the categories live-query rows). Assert the category filter menu shows a single `Groceries` entry (not both `Groceries` and `groceries`), and that selecting it filters both rows in.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/home/home.screen.test.tsx`
Expected: FAIL — two chips / split match.

- [ ] **Step 3: Implement** — replace the raw-value grouping (line 225-227) and the match (line 230-231) with resolution through the already-built `categoryByKey` map (`buildCategoryDisplayMap(categories)` at line 139). Add a small helper `const categoryLabel = (raw: string | null): string => (raw ? resolveCategoryDisplay(raw, categoryByKey).title : 'Uncategorized');` at module or body scope, then:

```ts
  const distinctCategories = Array.from(new Set(transactions.map((row) => categoryLabel(row.category))));
  const filteredTransactions = transactions.filter((row) => {
    const matchesAccount = selectedAccounts.size === 0 || selectedAccounts.has(row.accountName);
    const matchesCategory =
      selectedCategories.size === 0 || selectedCategories.has(categoryLabel(row.category));
    const matchesDate = withinDateRange(row.time, dateFrom, dateTo);

    return matchesAccount && matchesCategory && matchesDate;
  });
```

(`resolveCategoryDisplay`/`buildCategoryDisplayMap` are already imported at line 8; a helper closing over `categoryByKey` stays in the body per `kiko-code-style` "Helper placement".)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/home/home.screen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — `npm run check:all` green. Commit `fix(home): group category filter by resolved title`.

---

### Task 8: Full-suite gate

- [ ] **Step 1:** Run `npx jest` — the whole suite green.
- [ ] **Step 2:** Run `npm run check:all` — lint, dup, knip, deps, security, secrets, overrides all green. Confirm knip reports no unused file/export (the new repo, component, and helper are all consumed).
- [ ] **Step 3:** Run `npm run check:deep` — mutation + osv. Address any surviving mutants in the new modules (normalize helper, override repo, `addManyDedup` hook). The two accepted `image-size` CVEs remain expected (do not silence).
- [ ] **Step 4:** Manual device check (ops/user): edit a manual transaction's category and confirm every same-name row updates and the Home list/filter reflect it; edit a synced (Monobank) transaction's category and confirm the same; run a Monobank sync and confirm a freshly-imported same-name transaction lands in the overridden category.

## Self-Review

- **Spec coverage:** data model (Task 2) · normalize helper + tests (Task 1) · `upsertCategoryOverride` upsert-plus-rewrite in one transaction (Task 3) · sync-insert lookup (Task 4) · always-propagate UI + user-surfacing confirm (Task 6) · filter consistency (Task 7). Edge cases: empty/whitespace name (Tasks 1/3/4), sequential edits (Task 3), synced-matches-earlier-rule (Task 4), category rename (stable-key design, noted Task 3), deleted/dangling category (fallback via `resolveCategoryDisplay`, noted in the data model + Tasks 5/7). All map to a task.
- **Type consistency:** `normalizeTransactionName(string): string`, `upsertCategoryOverride(name, category): Promise<void>`, `getByNameQuery(normalizedName)`, `categoryOverrides`/`CategoryOverrideRow`, `CategoryField`/`CategoryOption` are used with identical names/shapes across Tasks 1-7.
- **Transaction rule:** every write (`upsertCategoryOverride`, `addManyDedup`) is a single `write()`/`db.transaction`; the rewrite and rule upsert share one transaction (Task 3).
- **No SQL normalization anywhere** — all name matching is JS, guarding Cyrillic/whitespace correctness.
