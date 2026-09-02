# PFF Redesign Phase 2 — Home Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Home as a native-iOS finance summary: a large centered net-worth balance with proper currency symbols, above one merged, filterable transactions list; move the base-currency selector to Settings.

**Architecture:** Add a currency-symbol formatter. Add a joined transactions read (transaction → holding → account) exposed as a live query. Rebuild `HomeScreen` around a large balance header and a `FlatList` of labeled transaction rows with a single-select filter bar. Relocate the currency selector to the existing Settings screen. Fix net worth to exclude holdings under archived accounts.

**Tech Stack:** React Native 0.87, react-native-unistyles v3, drizzle-orm + op-sqlite live queries, @react-navigation (native tabs from Phase 1), Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-08-31-pff-redesign-design.md`

**Base branch:** `drizzer14/pff-redesign-phase-1` (Phase 2 stacks on Phase 1; same worktree). Phase 1 head is `129b689`.

## Global Constraints

- Native Apple iOS look, dark-only. Balance and rows use the iOS dark tokens from Phase 1.
- Currency symbols: `UAH → ₴`, `USD → $`, `EUR → €`, `BTC → ₿`. Placement: symbol BEFORE the number for `$`/`€`/`₿`; symbol AFTER the number for `₴` (Ukrainian convention). Keep the per-currency decimal scale unchanged.
- Category label when `transactions.category` is null: `Uncategorized`. (Real categories arrive in Phase 5 via MCC and the manual-form field.)
- Transactions list: every transaction, newest first (`time` desc), rendered in a `FlatList` (virtualized, no hard cap).
- Filters: account and category, SINGLE-select each, default `All`.
- Net worth excludes closed holdings AND holdings under archived accounts.
- Commit on the worktree branch only (SDD needs BASE..HEAD). Never push/merge/touch main.
- Harness standing rule: fix the real issue, never weaken a check; no bare `biome-ignore` (use `OVERRIDE(...)`).
- Delegation: each task names its owner role agent.
- Naming: full names; uppercase abbreviations keep case (JSON, MCC, ID); `import type` for type-only.

---

### Task 1: Currency symbols

**Owner:** `pff:designer` (map) + `pff:developer` (formatter)

**Files:**
- Modify: `src/currency/currency.ts` (add `currencySymbol` map)
- Modify: `src/currency/format.ts`
- Test: `src/currency/format.test.ts` (create or extend)

**Interfaces:**
- Produces: `formatMoney(money)` returns a symbol-formatted string; `currencySymbol: Record<Currency, string>`.

- [ ] **Step 1: Write the failing test.**

```ts
import { Money } from './money';
import { formatMoney } from './format';

describe('formatMoney symbols', () => {
  it('puts $ / € / ₿ before the number', () => {
    expect(formatMoney(Money.fromMajor('USD', 1234.5))).toBe('$1,234.50');
    expect(formatMoney(Money.fromMajor('EUR', 10))).toBe('€10.00');
    expect(formatMoney(Money.fromMajor('BTC', 0.5))).toBe('₿0.50000000');
  });
  it('puts ₴ after the number (Ukrainian convention)', () => {
    expect(formatMoney(Money.fromMajor('UAH', 2500))).toBe('2,500.00 ₴');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `npx jest src/currency/format.test.ts`. Expected: FAIL (current output ends with a code, e.g. `1,234.50 USD`).

- [ ] **Step 3: Add the symbol map** in `src/currency/currency.ts`:

```ts
export const currencySymbol: Record<Currency, string> = {
  UAH: '₴',
  USD: '$',
  EUR: '€',
  BTC: '₿',
};
```

- [ ] **Step 4: Rewrite `formatMoney`** in `src/currency/format.ts` to place the symbol:

```ts
import { currencyScale, currencySymbol } from './currency';
import type { Money } from './money';

export const formatMoney = (money: Money, locale = 'en-US'): string => {
  const scale = currencyScale[money.currency];
  const major = money.minorUnits / 10 ** scale;
  const formatted = major.toLocaleString(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  const symbol = currencySymbol[money.currency];
  return money.currency === 'UAH' ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
};
```

- [ ] **Step 5: Run the tests.** `npx jest src/currency`. Expected: PASS.

- [ ] **Step 6: Fix fallout.** Run `npx jest`. Update any test asserting the old `"<n> CODE"` format (e.g. money-text tests) to the new symbol form. Do NOT weaken assertions. Then `npm run check:lint`. Commit on the branch.

---

### Task 2: Merged transactions live query

**Owner:** `pff:developer`

**Files:**
- Modify: `src/repositories/transactions.repo.ts` (add `listAllWithContextQuery`)
- Test: `src/repositories/transactions.repo.test.ts` (extend)

**Interfaces:**
- Consumes: `transactions`, `holdings`, `accounts` tables.
- Produces: `transactionsRepo.listAllWithContextQuery()` — a drizzle select joining transaction → holding → account, ordered by `transactions.time` desc, selecting: `id`, `amountMinorUnits`, `currency` (holding currency), `time`, `description`, `category`, `accountId`, `accountName`, `holdingName`. Shape consumed by Home (Task 3/4).

- [ ] **Step 1: Confirm the join columns.** Read `src/db/schema.ts` for the exact column names on `transactions`, `holdings`, `accounts`. `transactions.holdingId → holdings.id`, `holdings.accountId → accounts.id`, holding has `currency`, account has `name`, `archivedAt`.

- [ ] **Step 2: Write the failing test.** Extend `transactions.repo.test.ts` (the repo tests stub op-sqlite; assert the query builder produces the expected SQL shape or, if the suite uses an in-memory exec, that rows carry account + holding labels). Follow the existing test style in that file — match how sibling repo tests assert (do not invent a new harness).

```ts
it('exposes a joined all-transactions query with account and holding labels', () => {
  const query = transactionsRepo.listAllWithContextQuery();
  const sql = query.toSQL().sql.toLowerCase();
  expect(sql).toContain('from "transactions"');
  expect(sql).toContain('join "holdings"');
  expect(sql).toContain('join "accounts"');
  expect(sql).toContain('order by');
});
```

- [ ] **Step 3: Run it and confirm it fails.** `npx jest src/repositories/transactions.repo.test.ts`. Expected: FAIL (method undefined).

- [ ] **Step 4: Implement the query.**

```ts
import { desc, eq } from 'drizzle-orm';
import { accounts } from '../db/schema';
// ...existing imports (holdings, transactions, database)...

listAllWithContextQuery: () =>
  database
    .select({
      id: transactions.id,
      amountMinorUnits: transactions.amountMinorUnits,
      currency: holdings.currency,
      time: transactions.time,
      description: transactions.description,
      category: transactions.category,
      accountId: accounts.id,
      accountName: accounts.name,
      holdingName: holdings.name,
    })
    .from(transactions)
    .innerJoin(holdings, eq(transactions.holdingId, holdings.id))
    .innerJoin(accounts, eq(holdings.accountId, accounts.id))
    .orderBy(desc(transactions.time)),
```

Add it inside the `transactionsRepo` object (keep `satisfies Repository`). Import `desc`/`accounts` as needed.

- [ ] **Step 5: Run the test.** `npx jest src/repositories/transactions.repo.test.ts`. Expected: PASS.

- [ ] **Step 6: Lint and commit.** `npm run check:lint`; commit on the branch.

---

### Task 3: Home screen — balance + transactions list

**Owner:** `pff:developer` (screen) + `pff:designer` (styles)

**Files:**
- Modify: `src/screens/home/home.screen.tsx`
- Modify: `src/screens/home/home.screen.test.tsx`
- Create (if a shared style is needed): `src/screens/home/home.styles.ts`

**Interfaces:**
- Consumes: `transactionsRepo.listAllWithContextQuery()` (Task 2), `formatMoney`/`MoneyText` symbols (Task 1), the existing net-worth helpers in this file.
- Produces: a Home screen with a centered balance header and a `FlatList` of transaction rows.

- [ ] **Step 1: Write the failing test.** In `home.screen.test.tsx`, seed the live-query mocks so one account ("Cash"), one holding, and one transaction exist, and assert: (a) the net-worth balance renders (a `MoneyText` with the base-currency symbol), (b) a transaction row renders its description and its account-name label. Match the existing mock style already in `home.screen.test.tsx` (it already mocks `useLiveQuery`/op-sqlite — extend those mocks, do not replace the harness).

- [ ] **Step 2: Run it and confirm it fails.** `npx jest src/screens/home/home.screen.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Rebuild `HomeScreen`.** Replace the body:
  - Keep `buildRateTable`, `canConvert`, `guardedNetWorth`, and the net-worth computation.
  - Compute `activeHoldings` as holdings with `closedAt == null` AND whose `accountId` is NOT an archived account (Task: build `archivedAccountIds` from the accounts live query; see Task's net-worth note below). Use it for `total`.
  - **Balance header**: a centered `Box` with a small `Net worth` caption above a large `MoneyText money={total}`. Use a large type style (designer supplies `balance` typography — see Step 4).
  - **Transactions list**: consume `transactionsRepo.listAllWithContextQuery()` via `useLiveQuery(..., ['transactions','holdings','accounts'])`. Render a `FlatList` whose row shows: `description` (or `'—'` if empty), a `MoneyText` for the signed amount (build a `Money` from `amountMinorUnits`+`currency`), and a secondary label line `accountName · (category ?? 'Uncategorized')`.
  - **Remove** from Home: the base-currency `CurrencySwitch` block (moves to Settings, Task 5), the Accounts list + "Add account" button (belong to the Accounts screen, Phase 3), and the "Sync" button (auto-sync is Phase 5). Drop the now-unused imports (`CurrencySwitch`, `accountsRepo` list usage stays only if needed for archived ids, `useSync`, `PressableButton`, `ListRow` as appropriate). Keep `accounts` live query only if used for archived-id filtering.
  - Keep the `hasUnconvertible` "Rates unavailable" caption under the balance.

- [ ] **Step 4: Designer — balance + row styles.** Add to `theme.ts` typography (or a `home.styles.ts`) a `balance` style (large, e.g. `fontSize: 40, fontWeight: '700'`) and a transaction-row layout (row: space-between; label line: `textSecondary`, caption size). Follow the existing unistyles `StyleSheet.create((theme) => …)` pattern. If adding a typography token, extend the `typography` group (do not rename existing tokens).

- [ ] **Step 5: Run the test.** `npx jest src/screens/home`. Expected: PASS.

- [ ] **Step 6: Lint + suite.** `npx jest`; fix fallout without weakening. `npm run check:lint`. Commit on the branch.

---

### Task 4: Home filters

**Owner:** `pff:developer`

**Files:**
- Modify: `src/screens/home/home.screen.tsx`
- Modify: `src/screens/home/home.screen.test.tsx`
- Create (optional): `src/screens/home/transaction-filter-bar.component.tsx` (+ styles) if the bar is more than ~30 lines.

**Interfaces:**
- Consumes: the merged transaction rows from Task 3.
- Produces: a single-select filter bar filtering the list by account and by category.

- [ ] **Step 1: Write the failing test.** Seed two transactions under different accounts; assert that after selecting one account filter, only that account's rows remain (query by testID or row text). Use the existing test harness.

- [ ] **Step 2: Run it and confirm it fails.** `npx jest src/screens/home/home.screen.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.** Derive the distinct account names and distinct categories (`category ?? 'Uncategorized'`) from the loaded rows. Render two single-select control rows above the list, each with an `All` default plus one option per distinct value (a horizontal scroll of selectable chips, iOS-styled). Keep the selected account and category in `useState`. Filter the rows client-side before passing them to the `FlatList`. Keep it simple — no multi-select, no persistence.

- [ ] **Step 4: Run the test.** `npx jest src/screens/home`. Expected: PASS.

- [ ] **Step 5: Lint + commit.** `npm run check:lint`; commit on the branch.

---

### Task 5: Relocate the base-currency selector to Settings

**Owner:** `pff:developer`

**Files:**
- Modify: `src/screens/settings/settings.screen.tsx`
- Modify: `src/screens/settings/settings.screen.test.tsx` (if present; else create)

**Interfaces:**
- Consumes: `settingsRepo.getQuery()`/`setBaseCurrency`, `CurrencySwitch`.
- Produces: a base-currency selector on the Settings screen.

- [ ] **Step 1: Read the current Settings screen** to match its structure and existing sections. Confirm whether it already reads the settings row.

- [ ] **Step 2: Write the failing test.** Assert the Settings screen renders a base-currency control and that selecting a currency calls `settingsRepo.setBaseCurrency`. Mock the repo the way sibling screen tests do.

- [ ] **Step 3: Run it and confirm it fails.** `npx jest src/screens/settings`. Expected: FAIL.

- [ ] **Step 4: Implement.** Add a "Base currency" section to Settings using `CurrencySwitch selected={baseCurrency} onSelect={c => settingsRepo.setBaseCurrency(c)}`, reading `baseCurrency` from `settingsRepo.getQuery()` (default `'UAH'`). Match the screen's existing layout.

- [ ] **Step 5: Run the test.** `npx jest src/screens/settings`. Expected: PASS.

- [ ] **Step 6: Lint + commit.** `npm run check:lint`; commit on the branch.

---

### Task 6: Suite + full harness green

**Owner:** `pff:qa`

**Files:**
- Modify: any test file needing updates from Tasks 1–5.

- [ ] **Step 1: Run the full suite.** `npx jest`. Fix any test broken by the Home rebuild or the symbol change, updating expectations to the correct new behavior. Do NOT weaken assertions.

- [ ] **Step 2: Confirm the merged list + filters have real coverage.** Ensure a test asserts (a) a symbol-formatted balance, (b) a labeled transaction row, (c) the account filter narrows the list. If any is missing, add it.

- [ ] **Step 3: Run the harness.** `npm run check:all`. Resolve any knip/dup/deps finding the right way (real fix or a concrete, documented exception). `.superpowers/.*` is already path-allowlisted for gitleaks (Phase 1); do not re-add it.

- [ ] **Step 4: Metro sanity.** Start Metro with reset cache in the background; confirm `curl -sS "localhost:8081/index.bundle?platform=ios" -o /dev/null -w "%{http_code}\n"` returns 200. Commit on the branch.

---

## Self-Review

**Spec coverage (Phase 2 scope):**
- Large centered balance → Task 3. Merged transactions list with account+category labels → Tasks 2, 3. Filters → Task 4. Currency symbols → Task 1. Currency selector moved off Home → Tasks 3, 5. Net-worth archived-account fix → Task 3. Full green → Task 6. Covered.
- Out of Phase 2 scope (correctly deferred): Accounts screen + account CRUD (Phase 3), Settings redesign (Phase 4), token flow + auto-sync + MCC categories (Phase 5), glass surfaces + SF-Symbol content components (Phase 3+ where consumed).

**Placeholder scan:** No TBD/TODO. The "match the existing test harness" notes point at concrete sibling files, not missing content.

**Type consistency:** `listAllWithContextQuery` row shape (Task 2) is consumed by Tasks 3–4; `currencySymbol`/`formatMoney` (Task 1) consumed by Task 3. Names consistent.

## Verification (end of phase)
- `npx jest` green; `npm run check:all` green; Metro bundle 200.
- Hold the branch for user review. Do not push or merge.
