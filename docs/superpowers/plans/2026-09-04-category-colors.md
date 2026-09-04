# Category Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a transaction category its own stored color (nullable), pickable through the existing shared `ColorPicker`, and use it wherever a category is shown — most importantly the "Spending by Category" pie wedge, its legend swatch, and its filter chip — falling back to today's stable hashed palette when a category has no color yet.

**Architecture:** Mirror the account/holding entity-color pattern exactly. Add a nullable `color` column to the `categories` table (drizzle-kit-generated migration). Add one resolution helper, `resolveCategoryColor(stored, key)`, that mirrors `resolveEntityColor(stored, typeDefault)` — stored hex wins, else the existing per-key palette hash. Thread each category's stored color through the display map the Statistics screen already builds, so the chart builder resolves every slice's color; the filter chip, pie wedge, and legend swatch all read that one resolved `slice.color` and need no change. Add the shared `ColorPicker` to the category create/edit flow and tint each category row's icon with its resolved color.

**Tech Stack:** React Native 0.87, TypeScript, drizzle-orm / op-sqlite, react-native-unistyles, Jest + React Native Testing Library.

**Spec:** This plan's top section (Design / Data Model) doubles as the short spec.

## Global Constraints
- Worktree `/Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round`, branch `drizzer14/pff-ux-round`. Use absolute paths.
- `npm run check:all` stays green at every checkpoint; `npm run check:deep` before done. Never weaken a check to get green (no `|| true`, no bare `biome-ignore` — use `OVERRIDE(...)` only with a concrete reason).
- Migration is drizzle-kit-GENERATED via `npx drizzle-kit generate` — never hand-edit the `.sql`, `meta/_journal.json`, or `meta/*_snapshot.json`. The one manual follow-up allowed is adding the `m0007` import + map entry to `drizzle/migrations/migrations.js` if generation does not (this repo's earlier seed/backfill migrations were chained by hand — verify and match).
- Colors are `#RRGGBB` hex tokens from `theme.colors.entityColors` (what `ColorPicker` offers). The palette fallback stays the `theme.colors.chartSeries` hash — do not change either palette.
- Color uniqueness is NOT required: two categories may share a color. Do not add a unique index or a dedupe check.
- Existing categories keep `color = null` and must render exactly as they do today (the hashed palette). Back-compat is a hard requirement.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass. Commit per task with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do NOT commit unless the coordinator asks — hold diffs for user review.

---

## Design / Data Model (the short spec)

**Today**, a `categories` row is `{ key, title, icon }` (see `src/db/schema.ts`). A transaction stores a stable category `key`; the display layer resolves `key → { title, icon }` through `buildCategoryDisplayMap` (`src/categories/category-display.ts`). The Statistics "Spending by Category" chart colors each slice with `categoryColor(key)` in `src/statistics/category-breakdown.ts` — a deterministic hash into `theme.colors.chartSeries`. Accounts and holdings, by contrast, each already store a nullable `color` and resolve it through `resolveEntityColor(stored, typeDefault)` (`src/design-system/entity-tint.ts`), pickable via the shared `ColorPicker` (`src/screens/forms/color-picker/`).

**Change:** bring the same pattern to categories.

1. **Column.** Add `color: text('color')` (nullable) to the `categories` table. Existing rows and the seed migration stay `null`.

2. **Resolution helper (single source).** Add to `src/statistics/category-breakdown.ts`, next to the existing `categoryColor` palette hash:
   ```ts
   // The category analog of resolveEntityColor: a category's EFFECTIVE chart
   // color. A stored #RRGGBB hex wins; otherwise fall back to the stable per-key
   // palette hash (categoryColor), so an uncolored category renders exactly as it
   // did before this feature. Robust to a stored empty string (which ?? would let
   // through) the same way resolveEntityColor is.
   export const resolveCategoryColor = (
     storedColor: string | null | undefined,
     key: string,
   ): string =>
     typeof storedColor === 'string' && /^#[0-9a-f]{6}$/i.test(storedColor)
       ? storedColor
       : categoryColor(key);
   ```
   `categoryColor(key)` is kept unchanged as the fallback. This one helper is the only place color resolves; the pie wedge, legend swatch, and filter chip all consume the resolved `slice.color` the chart builder produces, so they need no independent color logic.

3. **Threading stored color.** The Statistics screen already builds a `key → display` map from the live `categories` query and passes it to `buildCategoryBreakdown`. Extend that map's value from `{ title, icon }` to `{ title, icon, color: string | null }`, so the stored color rides the same channel a rename already rides. The builder resolves each slice: `color: resolveCategoryColor(display.color, key)`. Because color is read off the SAME resolved display entry as title/icon, an unmapped category that resolves to the seeded `other` row adopts `other`'s color — and when `other` is uncolored (`null`), it falls back to `categoryColor(key)`, i.e. today's exact behavior. `null`/empty category → `NEUTRAL_CATEGORY` (`color: null`) → `categoryColor('uncategorized')`, unchanged.

4. **UI.** Add the shared `ColorPicker` to (a) the inline "Add category" form (`add-category-row.component.tsx`) and (b) each editable category row (`categories.screen.tsx`). Persist through two new/updated repo methods. Tint each row's leading icon with its resolved color (pass `iconColor` to `HoldingIdentityField`, exactly as `account-form.screen.tsx` does), so the chosen color shows on the row. The `ColorPicker`'s `value` is `color ?? ''` — an unset category shows no ringed swatch (honest "not picked yet") until the user taps one; the fallback chart hue is a `chartSeries` hue that intentionally is not among the `entityColors` swatches, so there is nothing to ring.

**Data flow (unchanged surface):** `categories` live query → `buildCategoryDisplayMap` (now carries color) → `buildCategoryBreakdown` (resolves `slice.color`) → `CategoryFilter` chips + `PieChart` wedges/legend. No change is required in `statistics.screen.tsx`, `category-filter.component.tsx`, or `pie-chart.component.tsx` — they already thread `categories` and read `slice.color`/`category.color`.

**Edge cases:**
- **No color set:** `color = null` → `resolveCategoryColor(null, key)` → `categoryColor(key)`. Identical to today.
- **Shared colors:** allowed; no uniqueness enforced anywhere.
- **Rename:** unaffected — rename writes `title` only; `color` and the stable `key` are untouched, so the slice's color stays put across a rename.
- **Delete:** categories have no delete path today; this plan adds none. If a transaction references a removed category key, display already falls back to `other`/neutral and color falls back with it (per point 3).
- **Migration back-compat:** pure additive `ALTER TABLE ... ADD color text` (nullable, no default) — every existing row reads `null` and renders as before.

**File map:**
- `src/db/schema.ts` — add `color` column to `categories` (+ doc note). `CategoryRow` gains `color` via `$inferSelect`.
- `drizzle/migrations/0007_*.sql`, `meta/0007_snapshot.json`, `meta/_journal.json`, `migrations.js` — drizzle-kit-generated (+ manual bundle entry if needed).
- `src/repositories/categories.repo.ts` — `create` accepts optional `color`; add `updateColor`.
- `src/statistics/category-breakdown.ts` — add `resolveCategoryColor`; builder resolves `slice.color` off the display entry; widen the `categoryDisplay` param value type.
- `src/categories/category-display.ts` — `CategoryDisplay` gains `color`; `buildCategoryDisplayMap` maps it; `NEUTRAL_CATEGORY` gains `color: null`; `resolveCategoryDisplay` returns it.
- `src/screens/settings/add-category-row/add-category-row.component.tsx` — color state + `ColorPicker` + pass color to `create`.
- `src/screens/settings/categories.screen.tsx` — per-row `ColorPicker` + `updateColor` + `iconColor` tint.
- Test files alongside each of the above.

---

### Task 1: Add the nullable `color` column + generated migration

**Files:**
- Modify: `src/db/schema.ts:121-127` (the `categories` table + its doc comment)
- Generate: `drizzle/migrations/0007_<name>.sql`, `drizzle/migrations/meta/0007_snapshot.json`, `drizzle/migrations/meta/_journal.json`
- Modify (if generation does not): `drizzle/migrations/migrations.js`
- Test: `src/repositories/categories.repo.test.ts` (extend the existing `categories seed migration` describe)

**Interfaces:**
- Produces: `categories` table gains `color: text('color')` (nullable). `CategoryRow` now includes `color: string | null`. Migration file `0007_*` contains ``ALTER TABLE `categories` ADD `color` text``.

- [ ] **Step 1: Write the failing test** — append to the `categories seed migration` describe block in `src/repositories/categories.repo.test.ts` (it already reads the `.sql` files via `migrationFiles()`):

```ts
it('adds a nullable color column to the categories table in a later migration', () => {
  const files = migrationFiles();
  const create = createMigration();
  const alter = files.find(({ sql }) => /ALTER TABLE `categories` ADD `color` text/i.test(sql));

  expect(alter).toBeDefined();
  // The ALTER must be its own, later migration than the create — a DB that already
  // recorded the create timestamp only picks up the column via a distinct later entry.
  expect((alter as { name: string }).name > create.name).toBe(true);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/repositories/categories.repo.test.ts -t "color column"`
Expected: FAIL — no migration adds the `color` column yet.

- [ ] **Step 3: Edit the schema** — in `src/db/schema.ts`, add the column and note it in the table's doc comment:

```ts
export const categories = sqliteTable('categories', {
  key: text('key').primaryKey(),
  title: text('title').notNull(),
  icon: text('icon').notNull(),
  // Nullable per-category color (#RRGGBB, an `entityColors` token). Null means
  // "no color picked" — the display/chart layer falls back to the stable per-key
  // palette hash (see resolveCategoryColor in statistics/category-breakdown.ts),
  // mirroring accounts/holdings' nullable `color`.
  color: text('color'),
});
```

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/migrations/0007_<name>.sql` containing ``ALTER TABLE `categories` ADD `color` text;``, a new `meta/0007_snapshot.json`, and a new `_journal.json` entry (idx 7). Then open `drizzle/migrations/migrations.js` and confirm it imports `m0007` and lists it under `migrations`; if not, add the import line and the `m0007` map entry by hand to continue the chain (match the existing `m0000`–`m0006` pattern). Do NOT hand-edit the `.sql`/snapshot/journal.

- [ ] **Step 5: Run the migration + repo tests, verify green**

Run: `npx jest src/repositories/categories.repo.test.ts src/db/run-migrations.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint** — `npm run check:all`. Commit `feat(db): nullable color column on categories + migration`.

---

### Task 2: Repo — persist a category color

**Files:**
- Modify: `src/repositories/categories.repo.ts`
- Test: `src/repositories/categories.repo.test.ts`

**Interfaces:**
- Consumes: `categories` table with `color` (Task 1).
- Produces:
  - `categoriesRepo.create(category: { title: string; icon: string; color?: string | null })` — inserts with `color: category.color ?? null`.
  - `categoriesRepo.updateColor(key: string, color: string | null): Promise<...>` — `UPDATE categories SET color = ? WHERE key = ?`.

- [ ] **Step 1: Write the failing tests** — add to `describe('categoriesRepo', ...)` in `src/repositories/categories.repo.test.ts` (mirror the existing `updateIcon`/`create` capture harness):

```ts
it('updateColor writes the new color for the given key', async () => {
  const captured: { set?: Record<string, unknown>; whereCalled: boolean } = { whereCalled: false };
  mockTx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        captured.set = values;
        return {
          where: () => {
            captured.whereCalled = true;
            return Promise.resolve();
          },
        };
      },
    }),
  };

  await categoriesRepo.updateColor('groceries', '#FFCC00');

  expect(captured.set).toEqual({ color: '#FFCC00' });
  expect(captured.whereCalled).toBe(true);
});

it('create persists the picked color when supplied, and null when omitted', async () => {
  const captured: { values?: Record<string, unknown> } = {};
  mockTx = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        captured.values = values;
        return Promise.resolve();
      },
    }),
  };

  await categoriesRepo.create({ title: 'Travel', icon: 'airplane', color: '#33AAFF' });
  expect(captured.values).toMatchObject({ title: 'Travel', icon: 'airplane', color: '#33AAFF' });

  await categoriesRepo.create({ title: 'Travel', icon: 'airplane' });
  expect(captured.values).toMatchObject({ color: null });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx jest src/repositories/categories.repo.test.ts -t "color"`
Expected: FAIL — `updateColor` is not a function; `create` drops `color`.

- [ ] **Step 3: Implement** — in `src/repositories/categories.repo.ts`:

```ts
create: (category: { title: string; icon: string; color?: string | null }) =>
  write((tx) =>
    tx.insert(categories).values({
      key: id(),
      title: category.title,
      icon: category.icon,
      color: category.color ?? null,
    }),
  ),
updateTitle: (key: string, title: string) =>
  write((tx) => tx.update(categories).set({ title }).where(eq(categories.key, key))),
updateIcon: (key: string, icon: string) =>
  write((tx) => tx.update(categories).set({ icon }).where(eq(categories.key, key))),
updateColor: (key: string, color: string | null) =>
  write((tx) => tx.update(categories).set({ color }).where(eq(categories.key, key))),
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx jest src/repositories/categories.repo.test.ts`
Expected: PASS (existing `create inserts ...` test still green — `toMatchObject` ignores the added `color`).

- [ ] **Step 5: Checkpoint** — `npm run check:all`. Commit `feat(repo): categories updateColor + create color`.

---

### Task 3: `resolveCategoryColor` — the single resolution helper

**Files:**
- Modify: `src/statistics/category-breakdown.ts` (add the helper next to `categoryColor`)
- Test: `src/statistics/category-breakdown.test.ts` (new `describe('resolveCategoryColor', ...)`)

**Interfaces:**
- Consumes: `categoryColor(key: string): string` (existing palette hash, unchanged).
- Produces: `resolveCategoryColor(storedColor: string | null | undefined, key: string): string`.

- [ ] **Step 1: Write the failing tests** — add to `src/statistics/category-breakdown.test.ts`, and import `resolveCategoryColor` from `./category-breakdown`:

```ts
describe('resolveCategoryColor', () => {
  it('returns the stored #RRGGBB hex when one is set', () => {
    expect(resolveCategoryColor('#FFCC00', 'groceries')).toBe('#FFCC00');
  });

  it('falls back to the per-key palette hash when the stored color is null', () => {
    expect(resolveCategoryColor(null, 'groceries')).toBe(categoryColor('groceries'));
  });

  it('falls back to the palette hash for an empty or malformed stored color', () => {
    expect(resolveCategoryColor('', 'groceries')).toBe(categoryColor('groceries'));
    expect(resolveCategoryColor('red', 'groceries')).toBe(categoryColor('groceries'));
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx jest src/statistics/category-breakdown.test.ts -t "resolveCategoryColor"`
Expected: FAIL — `resolveCategoryColor` is not exported.

- [ ] **Step 3: Implement** — add to `src/statistics/category-breakdown.ts` immediately below `categoryColor`:

```ts
/**
 * A category's EFFECTIVE chart color — the category analog of resolveEntityColor
 * (design-system/entity-tint.ts). A stored `#RRGGBB` hex wins; otherwise fall
 * back to the stable per-key palette hash, so an uncolored category renders
 * exactly as it did before category colors existed. Guards a stored empty string
 * (which `??` would let through and a bad hex would leak downstream) the same way
 * resolveEntityColor does.
 */
export const resolveCategoryColor = (
  storedColor: string | null | undefined,
  key: string,
): string =>
  typeof storedColor === 'string' && /^#[0-9a-f]{6}$/i.test(storedColor)
    ? storedColor
    : categoryColor(key);
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx jest src/statistics/category-breakdown.test.ts -t "resolveCategoryColor"`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — `npm run check:all`. Commit `feat(statistics): resolveCategoryColor helper`.

---

### Task 4: Thread stored color through the display map + chart builder

**Files:**
- Modify: `src/categories/category-display.ts`
- Modify: `src/statistics/category-breakdown.ts` (builder + `categoryDisplay` param type + `CategorySlice` doc)
- Test: `src/categories/category-display.test.ts`, `src/statistics/category-breakdown.test.ts`

**Interfaces:**
- Consumes: `resolveCategoryColor` (Task 3); `CategoryRow.color` (Task 1).
- Produces:
  - `CategoryDisplay = { title: string; icon: string; color: string | null }`.
  - `buildCategoryDisplayMap(categories: readonly { key: string; title: string; icon: string; color?: string | null }[]): ReadonlyMap<string, CategoryDisplay>`.
  - `NEUTRAL_CATEGORY = { title: 'Uncategorized', icon: 'creditcard', color: null }`.
  - `resolveCategoryDisplay(...)` returns the `{ title, icon, color }` triple.
  - `buildCategoryBreakdown` sets each slice's `color` via `resolveCategoryColor(display.color, key)`; its `categoryDisplay` param value type widens to `{ title: string; icon: string; color: string | null }`.

- [ ] **Step 1: Update the display-map tests (they will fail)** — in `src/categories/category-display.test.ts`, extend the fixtures and assertions to carry color. The map now returns a `color` field (`null` when the source row has none, the stored hex when it does):

```ts
it('keys each category display by its stable key, carrying its stored color', () => {
  const map = buildCategoryDisplayMap([
    { key: 'groceries', title: 'Groceries', icon: 'cart', color: '#FFCC00' },
    { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
  ]);

  expect(map.get('groceries')).toEqual({ title: 'Groceries', icon: 'cart', color: '#FFCC00' });
  expect(map.get('other')).toEqual({ title: 'Other', icon: 'square.grid.2x2', color: null });
});
```

Update the existing `resolveCategoryDisplay` assertions the same way — each expected object gains `color`:
- `resolveCategoryDisplay('Groceries', byKey)` → `{ title: 'Groceries', icon: 'cart', color: null }` (the `byKey` fixture rows have no color).
- The `other`-fallback case → `{ title: 'Other', icon: 'square.grid.2x2', color: null }`.
- The `null`/empty/neither cases already assert `toEqual(NEUTRAL_CATEGORY)`; leave them (they pass once `NEUTRAL_CATEGORY` gains `color: null`).

- [ ] **Step 2: Add the builder test (it will fail)** — in `src/statistics/category-breakdown.test.ts`, add a case proving a stored color wins on the slice, and that an uncolored category still hashes. Build a colored display map inline:

```ts
it('colors a slice from the category stored color when set, else the palette hash', () => {
  const colored = buildCategoryDisplayMap([
    { key: 'groceries', title: 'Groceries', icon: 'cart', color: '#123456' },
    { key: 'transport', title: 'Transport', icon: 'car' },
  ]);

  const slices = buildCategoryBreakdown({
    transactions: [
      tx({ category: 'groceries', amountMinorUnits: -10_00 }),
      tx({ category: 'transport', amountMinorUnits: -10_00 }),
    ],
    categoryDisplay: colored,
    rateTable: {},
    baseCurrency: 'UAH',
  });

  const byKey = new Map(slices.map((slice) => [slice.key, slice.color]));
  expect(byKey.get('groceries')).toBe('#123456');
  expect(byKey.get('transport')).toBe(categoryColor('transport'));
});
```

The existing `colors each slice from the shared chart palette, stably per category key` test stays valid: its `DISPLAY` fixture rows carry no color, so `resolveCategoryColor(null, key) === categoryColor(key)`.

- [ ] **Step 3: Run, verify the new/updated tests fail**

Run: `npx jest src/categories/category-display.test.ts src/statistics/category-breakdown.test.ts`
Expected: FAIL — map values lack `color`; slices ignore stored color.

- [ ] **Step 4: Implement `category-display.ts`**:

```ts
type CategoryDisplay = { title: string; icon: string; color: string | null };

export const NEUTRAL_CATEGORY: CategoryDisplay = {
  title: 'Uncategorized',
  icon: 'creditcard',
  color: null,
};

export const buildCategoryDisplayMap = (
  categories: readonly { key: string; title: string; icon: string; color?: string | null }[],
): ReadonlyMap<string, CategoryDisplay> =>
  new Map(
    categories.map((category) => [
      category.key,
      { title: category.title, icon: category.icon, color: category.color ?? null },
    ]),
  );
```

`resolveCategoryDisplay` needs no body change — it already returns the map entry (now a `{ title, icon, color }` triple) or `NEUTRAL_CATEGORY`.

- [ ] **Step 5: Implement the builder** — in `src/statistics/category-breakdown.ts`:
  - Widen the `categoryDisplay` param type from `ReadonlyMap<string, { title: string; icon: string }>` to `ReadonlyMap<string, { title: string; icon: string; color: string | null }>`.
  - In the `.map(...)` that builds each slice, resolve color off the same display entry:

```ts
.map(([key, { amount, representative }]) => {
  const display = resolveCategoryDisplay(representative, categoryDisplay);

  return {
    key,
    title: display.title,
    icon: display.icon,
    amount,
    color: resolveCategoryColor(display.color, key),
  };
})
```
  - Update the `CategorySlice` doc line: `color` is the category's stored color when set, else its stable palette hue.

- [ ] **Step 6: Run, verify green**

Run: `npx jest src/categories/category-display.test.ts src/statistics/category-breakdown.test.ts`
Expected: PASS.

- [ ] **Step 7: Regression sweep** — the Statistics screen already feeds the live `categories` (now with `color`) into `buildCategoryDisplayMap`, so the filter chip + pie wedge + legend swatch pick up stored colors with NO screen edit. Confirm nothing else consumes the map shape:

Run: `npx jest src/screens/statistics src/screens/home src/screens/holding-detail`
Expected: PASS (home/holding-detail only read `.title`/`.icon`).

- [ ] **Step 8: Checkpoint** — `npm run check:all`. Commit `feat(statistics): categories keep their stored color across chart, legend, filter`.

---

### Task 5: `ColorPicker` in the category create + edit flow

**Files:**
- Modify: `src/screens/settings/add-category-row/add-category-row.component.tsx`
- Modify: `src/screens/settings/categories.screen.tsx`
- Test: `src/screens/settings/categories.screen.test.tsx`

**Interfaces:**
- Consumes: `ColorPicker` from `src/screens/forms/color-picker`; `resolveCategoryColor` from `src/statistics/category-breakdown`; `categoriesRepo.create({ ..., color })` + `categoriesRepo.updateColor(key, color)` (Task 2); `CategoryRow.color` (Task 1).
- Produces: the create form passes `color` (a `#RRGGBB` hex or `null`) to `create`; each row calls `updateColor(key, hex)` on a swatch tap and tints its icon with the resolved color.

- [ ] **Step 1: Update the screen test harness + write failing tests** — in `src/screens/settings/categories.screen.test.tsx`:
  - Add `const mockUpdateColor = jest.fn();` and register `updateColor: (...args: unknown[]) => mockUpdateColor(...args)` on the mocked `categoriesRepo`.
  - The existing `creates a category ... and clears the form` test asserts `mockCreate` was called with `{ title: 'Travel', icon: 'square.grid.2x2' }` — change it to `{ title: 'Travel', icon: 'square.grid.2x2', color: null }` (no swatch tapped).
  - Add two tests (the `ColorPicker` renders swatches labeled `Color <name>`, e.g. `Color yellow` — see `color-picker.component.tsx`):

```ts
it('creates a category with the picked color when a swatch is tapped', async () => {
  const { getByLabelText, getByText } = await render(<CategoriesScreen />);

  await fireEvent.press(getByLabelText('Add category'));
  await fireEvent.changeText(getByLabelText('Name'), 'Travel');
  await fireEvent.press(getByLabelText('Color yellow'));
  await fireEvent.press(getByText('Save'));

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Travel', color: expect.stringMatching(/^#/) }),
  );
});

it('recolors a category via updateColor when a row swatch is tapped', async () => {
  const { getAllByLabelText } = await render(<CategoriesScreen />);

  // Every row renders a ColorPicker; tap the first row's yellow swatch.
  await fireEvent.press(getAllByLabelText('Color yellow')[0]);

  expect(mockUpdateColor).toHaveBeenCalledWith('groceries', expect.stringMatching(/^#/));
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx jest src/screens/settings/categories.screen.test.tsx`
Expected: FAIL — no `ColorPicker` rendered; `updateColor` never called; `create` payload lacks `color`.

- [ ] **Step 3: Implement the add-category form** — in `add-category-row.component.tsx`:
  - `import ColorPicker from '../../forms/color-picker';`
  - Add `const [color, setColor] = useState<string | null>(null);`
  - In `collapse()`, also `setColor(null);`
  - In `save()`, call `await categoriesRepo.create({ title: trimmedName, icon, color });`
  - Render the picker inside the expanded form (below the `HoldingIdentityField`, above the Cancel/Save row): `<ColorPicker label="Color" value={color ?? ''} onSelect={setColor} />`. (`value=''` means no swatch is ringed until the user picks — matches the icon's "unset" affordance.)

- [ ] **Step 4: Implement the per-row editor** — in `categories.screen.tsx`, in `CategoryListRow`:
  - `import ColorPicker from '../forms/color-picker';` and `import { resolveCategoryColor } from '../../statistics/category-breakdown';`
  - Add `const selectColor = (hex: string): void => { if (hex !== category.color) categoriesRepo.updateColor(category.key, hex); };`
  - Tint the row icon by passing `iconColor={resolveCategoryColor(category.color, category.key)}` to `HoldingIdentityField` (same prop `account-form.screen.tsx` uses).
  - Render `<ColorPicker value={category.color ?? ''} onSelect={selectColor} />` inside the row's `Box` (below the identity field). Wrap the field + picker in a `Box gap={2}` if needed so they stack cleanly; keep the row's existing `styles.row`/`styles.rowLast` spacing.

- [ ] **Step 5: Run, verify green**

Run: `npx jest src/screens/settings/categories.screen.test.tsx`
Expected: PASS (all pre-existing category-screen tests still pass — the icon-picker, rename, and add-flow behaviors are untouched).

- [ ] **Step 6: Checkpoint** — `npm run check:all`. Commit `feat(settings): pick a color per category in the create + edit flow`.

---

### Task 6: Full-suite gate + deep check

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npx jest`
Expected: PASS. Pay attention to `src/screens/statistics`, `src/categories`, `src/statistics`, `src/repositories`, `src/screens/settings`.

- [ ] **Step 2: Fast + medium harness**

Run: `npm run check:all`
Expected: green — lint, dup, knip (no new unused export — `resolveCategoryColor` is consumed by the builder and the category row; `updateColor` by the row), deps, security, secrets, overrides.

- [ ] **Step 3: Deep harness (before declaring done)**

Run: `npm run check:deep`
Expected: mutation score stays ≥ 60; osv-scanner flags only the two accepted `image-size` CVEs documented in `CLAUDE.md` (do not silence). If mutation dips, add the missing assertion in the relevant test (most likely a `resolveCategoryColor` branch or the `updateColor` payload).

- [ ] **Step 4:** Report results to the coordinator. Do NOT commit a merge or push unless asked.

---

## Self-review notes
- **Spec coverage:** column (Task 1), resolution helper mirroring `resolveEntityColor` (Task 3), display-map threading + chart/legend/filter integration (Task 4, no screen edit needed since colors ride the existing `categories → display map → builder → slice.color` channel), `ColorPicker` in create + edit + row tint (Task 5), edge cases (null fallback, shared colors allowed, rename-safe, delete falls back, additive migration) — all covered.
- **Type consistency:** `CategoryDisplay` gains `color: string | null` in Task 4 and is used identically by `buildCategoryDisplayMap`, `resolveCategoryDisplay`, `NEUTRAL_CATEGORY`, and the builder's `categoryDisplay` param. `resolveCategoryColor(storedColor, key)` signature is identical in Tasks 3, 4, and 5. `categoriesRepo.create({ ..., color? })` and `updateColor(key, color)` signatures match between Task 2's definition and Task 5's calls.
- **No new palette:** the fallback stays `categoryColor` (chartSeries hash); picks come from `entityColors` via the unchanged shared `ColorPicker`.
- **Back-compat:** an uncolored (`color: null`) category resolves through `resolveCategoryColor(null, key) === categoryColor(key)`, byte-for-byte today's behavior — asserted directly in Task 3 and Task 4 tests.
