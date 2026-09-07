# Bug Hunt Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 41 in-scope defects the six read-only bug hunters found at `main @ e36213c`, each behind a failing test written first.

**Architecture:** Every task is a self-contained TDD cycle against an existing module: write the failing test the hunter's report specifies, run it to see it fail, make the minimal fix, run it green. Three tasks add a hand-written Drizzle data/schema migration (`drizzle/migrations/`); one task zeroes the `tsc --noEmit` baseline and wires a new `check:typecheck` harness wrapper so every task after it is typechecked by the harness. Two widget tasks run last because a sibling worktree is editing the same files.

**Tech Stack:** React Native 0.87 (new architecture), TypeScript, op-sqlite + drizzle-orm, react-native-unistyles v3, react-native-svg, i18next/react-i18next, fnts, ts-pattern, Jest + React Native Testing Library, Biome, Semgrep, gitleaks, Stryker.

**Spec:** `docs/superpowers/specs/2026-09-06-bug-hunt-tasks.md` (43 tasks T-1..T-43 from hunters D/S/F/H/U/W). Read a task's spec entry only if this plan's task text is ambiguous — each task below is written to be executable without it.

**Second source:** Task 37 implements **T-44**, which is not in that spec. It is a user-reported bug (the tab-re-tap scroll parking in a black void) isolated by the debugger; its root-cause analysis, with the `node_modules` line references that back it, is quoted in full inside Task 37, so that task is also executable on its own.

**Worktree:** `/Users/drizzer14/orca/workspaces/pff-ios/bug-hunt-fixes`, branch `drizzer14/bug-hunt-fixes`. Do not touch `/Users/drizzer14/Developer/Projects/pff-ios` or the sibling worktree `security-pass-fixes`.

---

## Global Constraints

- **Nothing is committed.** No agent runs `git commit`, `git add`, or `git push` at any point in this plan. The user reviews the whole diff at the end. The "Commit" step the writing-plans skill normally ends a task with is deliberately absent everywhere below.
- **TDD is mandatory** (`superpowers:test-driven-development`): write the failing test, run it and see it fail for the stated reason, then write the minimal fix, then see it pass. A task whose test passes before the fix means the bug did not reproduce — stop and report.
- **Confidence labels.** Each task is marked CONFIRMED or PLAUSIBLE. For a PLAUSIBLE task, run the named confirm step **before** writing any code. If the bug does not reproduce, stop and report; do not "fix" it anyway.
- **Never weaken a check.** No `|| true`, no bare `biome-ignore` (an override needs `OVERRIDE(<reason>) <specific reason>`), no new ignore-list entry without a concrete justification recorded in the root `CLAUDE.md` "Documented exceptions" section. See the root `CLAUDE.md`.
- **Every DB write goes through `db.transaction()`** — that is what `write(...)` in `src/db/client.ts` does. A write outside it is invisible to every `useLiveQuery` watching that table. No exception for a single statement (`kiko-architecture`).
- **Money is integer minor units.** `BTC` scale 8, `USD`/`EUR`/`UAH` scale 2. Never a float column, never a float amount (`kiko-domain`).
- **A manual balance adjustment always writes a `manual` Transaction** so a holding's balance stays derivable from its transactions (`kiko-domain` invariant — this is what Task 18 restores).
- **Code style** (`kiko-code-style`): single quotes, 2-space indent, 100-char width, trailing commas, `(x) => x` arrow parens always. A blank line before every `return`, `if`, `for`, `while`, `switch` (unless it is the first line of its block). A blank line between adjacent JSX sibling nodes. `import type` for type-only imports, inline `type` for mixed. Full unabbreviated names; `JSON`/`IBAN`/`MCC`/`ID`/`PAN`/`BTC` keep their uppercase inside compound names. `ts-pattern`'s `match(...).exhaustive()` for any closed literal union. `fnts` (`either`/`eitherSync`/`guard`/`maybe`) for data-layer error handling — NOT for a screen's UI-feedback handler, which stays plain `try`/`catch`. No `any`. No `void` operator. Components are default exports in `<name>.component.tsx`; everything else is a named export. A type-only file is `.d.ts`.
- **Design tokens only** (`kiko-design-system`): no raw color/spacing/radius literal at a call site. An entity color resolves through `resolveEntityColor` (`src/design-system/entity-tint.ts`); a category color through `resolveCategoryColor` (`src/statistics/category-breakdown.ts`). Never a bare `stored ?? typeDefault`.
- **Chart primitives carry a `testID`** following `<chart-name>-<primitive>[-<key>]` (`kiko-charts`) — that is the only way a test can read computed geometry back through `__mocks__/react-native-svg.tsx`.
- **Widget: TS and Swift stay in lockstep.** `src/widget/net-worth-snapshot.ts`'s `NetWorthSnapshot` and `ios/KikoWidget/NetWorthSnapshot.swift`'s `Codable` struct mirror each other field-for-field; change both together (`kiko-widget`). Never log the snapshot JSON.
- **Harness commands.** `npm run check:all` = lint, dup, knip, deps, security, secrets, overrides. `npm run check:deep` = mutation (score floor 60) then osv-scanner. `npx jest` for the full suite. After Task 5, `npx tsc --noEmit` must report **zero** errors and `npm run check:typecheck` exists.
- **`.env` is public-only.** Secrets live in the iOS Keychain, never in `.env`, the DB, or a log.

### Out of scope — owned by the `security-pass-fixes` worktree

Do **not** touch these; a sibling branch is changing them and a duplicate edit will conflict:

- T-27 (removing `trend` from the widget snapshot + hook + Swift struct + their tests).
- T-28 (the empty `NSLocationWhenInUseUsageDescription` in `ios/Kiko/Info.plist`).
- The stale `DB_ENCRYPTION_ENABLED` / `APP_LOCK_ENABLED` doc comments in `src/db/db-config.ts`.
- The two skill-drift notes (`kiko-domain`'s `Money` method list, `kiko-design-system`'s `blendOverWhite`) — the scribe owns those.

That branch will also add `scripts/checks/plist.sh` and wire it into `medium.sh` + `check:all`, and will edit `ios/Kiko/Info.plist`, `ios/Kiko/WidgetBridge.swift`, `ios/KikoWidget/NetWorthWidgetView.swift`, `docs/security/README.md`, `rules/semgrep-mobile.yml`, and `scripts/checks/medium.sh`.

**Conflict-avoidance rules that follow from that:**

1. **Leave every `trend`-related line untouched.** Do not read, rename, reorder, or reformat `trend` in `src/widget/net-worth-snapshot.ts`, `src/widget/use-net-worth-widget.ts`, `ios/KikoWidget/NetWorthSnapshot.swift`, or their tests.
2. **Tasks 38 (T-24) and 39 (T-43) run LAST**, after everything else is green, so the widget files are dirtied as late as possible.
3. **T-11's plist assertion is a Jest test**, not a `scripts/checks/` wrapper — the sibling branch owns the plist checker.
4. **Task 5's `medium.sh` edit is exactly one added line.** Nothing else in that file changes.
5. Expected conflicts and their resolutions are listed inline in Tasks 38 and 39.

---

## File Structure

New files:

| Path | Responsibility |
|---|---|
| `scripts/checks/typecheck.sh` | Harness wrapper: `tsc --noEmit`, zero errors, structured failure block (Task 5) |
| `src/test-support/navigation-props.ts` | Typed React Navigation `navigation`/`route` doubles for screen tests, replacing the `as never` casts that produce ~94 `tsc` errors (Task 5) |
| `__tests__/info-plist.test.ts` | Asserts `ios/Kiko/Info.plist` pins `UIUserInterfaceStyle = Dark` (Task 4) |
| `src/dates/local-day.ts` | The one `startOfLocalDay` / `endOfLocalDay` pair, replacing three near-identical screen-local copies (Task 27) |
| `src/design-system/components/screen/bottom-clearance.ts` | The one tab-bar bottom-clearance computation, shared by `Screen` and Home's `bleedBottom` list (Task 34) |
| `src/monobank/throttle.ts` | The token-scoped 60 s request gate shared across one whole `runSync` (Task 7) |
| `src/statistics/exchange-exclusion.ts` | The exchange-leg spending-exclusion rule, keyed on the new structural marker (Task 8) |
| `src/transactions/exchange-description.ts` | Render-time exchange-leg label resolver (`t` + counterpart name + amount sign) (Task 8) |
| `drizzle/migrations/0014_lowercase_categories.sql` | Data migration: lowercase every stored `transactions.category` and `category_overrides.category` (Task 6) |
| `drizzle/migrations/0015_<generated>.sql` + `meta/0015_snapshot.json` | Schema migration (drizzle-kit generated): `transactions.exchange_counterpart_holding_id` (Task 8) |
| `drizzle/migrations/0016_seed_category_colors.sql` | Data migration: ten distinct colors for the ten seeded categories (Task 20) |

Modified (grouped by the task that owns them — a file listed once is edited by exactly one task unless noted):

- `src/db/migrations.gate.tsx` — Tasks 1 (`settingsRepo.ensure`), 23 (language resolution), 36 (styling). Three separate regions of the same file.
- `src/holdings/interest.ts` — Task 2.
- `src/repositories/accounts.repo.ts`, `src/holdings/deletable.ts`, `src/repositories/holdings.repo.ts` — Task 3.
- `src/navigation/root.navigator.tsx`, `__mocks__/@bottom-tabs/react-navigation.tsx`, `ios/Kiko/Info.plist` — Task 4.
- `src/i18n/locales/en.ts`, `tsconfig.json`, `package.json`, `scripts/checks/medium.sh`, 9 `TFunction` importers, 5 `useAnimatedRef` sites, ~30 test files — Task 5.
- `src/repositories/categories.repo.ts`, `src/monobank/mcc-category.ts`, `src/statistics/category-breakdown.ts`, `src/screens/home/home.screen.tsx` — Task 6.
- `src/monobank/sync.ts` — Tasks 7, 13, 16, 25. Distinct regions; run them in plan order.
- `src/repositories/transactions.repo.ts` — Tasks 8, 9, 16, 18.
- `src/screens/forms/transaction-form.screen.tsx` — Tasks 8, 9, 10, 11, 28.
- `src/screens/forms/amount-format.ts` — Task 10.
- `src/screens/forms/holding-form.screen.tsx` — Tasks 10, 11, 18.
- `src/screens/forms/contribution-form.screen.tsx`, `src/screens/forms/account-form.screen.tsx` — Task 11.
- `src/rates/rates-refresh.ts`, `src/rates/coingecko.ts` — Task 14.
- `src/auth/biometrics.ts`, `src/auth/lock-gate/lock-gate.component.tsx`, `src/screens/settings/app-lock-setting/app-lock-setting.component.tsx` — Task 15.
- `src/screens/account-detail/format-last-sync.ts` + its two consumers — Task 17.
- `src/screens/statistics/statistics.screen.tsx` — Tasks 19, 27.
- `src/design-system/components/bar-chart/bar-chart.component.tsx` — Task 21.
- `src/statistics/account-contribution.ts` — Task 22.
- `src/crypto-sync/binance/binance.provider.ts` — Task 26.
- `src/rates/net-worth-view.ts` — Task 29.
- `src/screens/home/date-range-field/date-range-field.component.tsx` — Task 30.
- `src/screens/settings/categories.screen.tsx` — Task 31.
- `src/design-system/components/pie-chart/pie-chart.component.tsx` — Task 32.
- `src/design-system/components/net-worth-line/net-worth-line.component.tsx` — Task 33.
- `src/design-system/components/button/button.styles.ts`, `src/i18n/locales/en.ts` (labels only) — Task 35.
- `src/navigation/use-scroll-to-top-on-tab-press.ts`, `src/design-system/components/screen/screen.component.tsx` (comment), `src/screens/statistics/statistics.screen.tsx`, `src/screens/accounts/accounts.screen.tsx`, `src/screens/settings/settings.screen.tsx` — Task 37 (T-44). Note Task 5 already retyped the same `useAnimatedRef` lines; run Task 37 after it, as ordered.
- `src/widget/net-worth-snapshot.ts`, `ios/KikoWidget/NetWorthWidgetView.swift`, `ios/KikoWidget/NetWorthSnapshot.swift`, `ios/KikoWidget/NetWorthWidget.swift` (comment) — Tasks 29 (breakdown guard), 38 (labels).
- `src/widget/use-net-worth-widget.ts` — Task 39.
- `src/i18n/locales/en.ts` / `src/i18n/locales/uk.ts` — new keys added by Tasks 8, 17, 35, 38. **Both catalogues always change together**; `uk.ts` mirrors `en.ts`'s exact key set.

---

## Checkpoints

Run `npm run check:all` (and, after Task 5, `npx tsc --noEmit`) at each of these points, not after every single task:

| After task | Gate |
|---|---|
| 3 | `npm run check:all` + `npx jest` — critical fixes landed |
| 5 | `npm run check:all` + `npx tsc --noEmit` reports **0** errors + `npm run check:typecheck` exits 0 + `npx jest` |
| 11 | `npm run check:all` + `npm run check:typecheck` + `npx jest` — high tier done |
| 23 | `npm run check:all` + `npm run check:typecheck` + `npx jest` — medium tier done |
| 36 | `npm run check:all` + `npm run check:typecheck` + `npx jest` — low tier done |
| 37 | `npm run check:all` + `npm run check:typecheck` + `npx jest` — T-44 (the user-reported scroll-to-top jump) done |
| 39 | `npm run check:all` + `npm run check:typecheck` + `npx jest` — widget tier done |
| 40 | Full verification-before-completion, incl. `npm run check:deep` |

**Task order at a glance (40 tasks):** 1–3 critical (T-1, T-2, T-3) · 4 T-10+T-11 (moved ahead of the typecheck task, see its own note) · 5 T-26 typecheck · 6–11 high (T-4+T-19, T-5, T-6, T-7, T-8, T-9) · 12–23 medium (T-12, T-13, T-14, T-15, T-16, T-17, T-18, T-20, T-21, T-22, T-23, T-25) · 24–36 low (T-29 blocked, T-30, T-31, T-32, T-33, T-34, T-35, T-36, T-37, T-38+T-39, T-40, T-41, T-42) · 37 T-44 (user report) · 38–39 widget (T-24, T-43) · 40 verification.

The `PostToolUse` fast-tier hook (lint + security + secrets on the touched file) fires on every `Edit`/`Write` regardless; fix what it reports before moving on. Note that the hook lints a worktree file against the MAIN repo's `biome.json` — if a hook error looks wrong, re-verify with this worktree's own `npm run check:lint` before acting on it.

---

## Task 1: T-1 — Create the settings row inside the migrations gate, awaited

**Confidence: PARTIALLY CONFIRMED — read this first.**

The spec entry claims `src/monobank/sync.ts:93` is "the only `settingsRepo.ensure()` caller" and that every setting silently reverts on an install that never synced. **That claim is wrong.** `App.tsx:33` also calls `settingsRepo.ensure()` in `AppRoot`'s mount effect:

```
$ grep -rn "settingsRepo.ensure\|ensureSettings" src App.tsx | grep -v "\.test\."
src/monobank/sync.ts:75:  ensureSettings: () => Promise<unknown>;
src/monobank/sync.ts:93:  ensureSettings: () => settingsRepo.ensure(),
src/monobank/sync.ts:301:  await deps.ensureSettings();
App.tsx:33:    settingsRepo.ensure();
```

So the spec's reproduction ("fresh install, no Monobank, Settings → base currency USD → snaps back") will **not** reproduce. Do not chase it.

The real, narrower defects that remain, and that this task fixes:

1. `App.tsx:32-34` fires `settingsRepo.ensure()` **unawaited** from an effect. Any setter that runs before that insert commits updates zero rows. It is a race, not a certainty.
2. The unawaited promise has no rejection handler — a failed insert is an unhandled rejection.
3. `MigrationsGate` and `LockGate` both read settings **before** `AppRoot` mounts (`LockGate` reads `settings.lockEnabled`; Task 22 needs `settings.language`). The row must exist before the first gate paints, which `AppRoot`'s effect structurally cannot guarantee.

**Files:**
- Modify: `src/db/migrations.gate.tsx:19-43` (the init chain)
- Modify: `App.tsx:31-39` (remove the now-redundant effect)
- Test: `src/db/migrations.gate.test.tsx`, `src/repositories/settings.repo.test.ts`

**Interfaces:**
- Consumes: `settingsRepo.ensure(): Promise<unknown>` from `src/repositories/settings.repo.ts:15-16` (already exists, already an `INSERT ... ON CONFLICT DO NOTHING` keyed on `id = 1`).
- Produces: after `MigrationsGate` reports `status: 'success'`, the `settings` row with `id = 1` is guaranteed to exist. Task 22 relies on this.

- [ ] **Step 1: Run the spec's confirm step and record that it does not reproduce**

```bash
grep -rn "settingsRepo.ensure\|ensureSettings" src App.tsx | grep -v "\.test\."
grep -rn "insert(settings)\|INSERT INTO .settings" src drizzle
```

Expected: two production `ensure()` call sites (`sync.ts:93`, `App.tsx:33`), one insert. Write this finding into the task's report to the coordinator. Then proceed with the fix below, which is still correct and is a prerequisite for Task 22.

- [ ] **Step 2: Write the failing test in `src/db/migrations.gate.test.tsx`**

Read the file's existing mock setup first (it already mocks `./client`, `./run-migrations`, and `../monobank/token`). Add a mock for the settings repo alongside them and a new test:

```tsx
jest.mock('../repositories/settings.repo', () => ({
  settingsRepo: { ensure: jest.fn(() => Promise.resolve()) },
}));

it('ensures the settings row before reporting success', async () => {
  const order: string[] = [];
  mockRunMigrations.mockImplementation(async () => {
    order.push('migrations');
  });
  (settingsRepo.ensure as jest.Mock).mockImplementation(async () => {
    order.push('ensure');
  });

  const { getByText } = await render(
    <MigrationsGate>
      <Text>ready</Text>
    </MigrationsGate>,
  );

  expect(getByText('ready')).toBeTruthy();
  expect(order).toEqual(['migrations', 'ensure']);
});

it('reports an error when the settings insert fails', async () => {
  (settingsRepo.ensure as jest.Mock).mockRejectedValueOnce(new Error('insert failed'));

  const { getByText } = await render(
    <MigrationsGate>
      <Text>ready</Text>
    </MigrationsGate>,
  );

  expect(getByText(/insert failed/)).toBeTruthy();
});
```

- [ ] **Step 3: Write the failing test in `src/repositories/settings.repo.test.ts`**

```ts
it('ensure inserts the single settings row and is idempotent', async () => {
  await settingsRepo.ensure();
  await settingsRepo.ensure();

  const rows = await settingsRepo.getQuery();

  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(1);
});

it('setBaseCurrency persists after ensure has run', async () => {
  await settingsRepo.ensure();
  await settingsRepo.setBaseCurrency('USD');

  expect((await settingsRepo.getQuery())[0].baseCurrency).toBe('USD');
});
```

Follow the file's existing in-memory DB harness — read the top of `settings.repo.test.ts` for how it fakes `write`/`database` before adding these.

- [ ] **Step 4: Run both tests and confirm they fail**

```bash
npx jest src/db/migrations.gate.test.tsx src/repositories/settings.repo.test.ts
```

Expected: the ordering test fails with `order` equal to `['migrations']` (ensure never called from the gate); the error-branch test fails because nothing rejects.

- [ ] **Step 5: Add `settingsRepo.ensure` to the gate's init chain**

In `src/db/migrations.gate.tsx`, import the repo and insert `ensure` into the chain **after** `runMigrations` (the table must exist) and **before** `migrateLegacyToken`:

```tsx
initDatabase()
  .then(runMigrations)
  // The single settings row (id = 1) must exist before ANY gate reads
  // settings: LockGate reads `lockEnabled` and the language resolution below
  // reads `language`, both before AppRoot mounts. Awaited here — not
  // fire-and-forget from AppRoot — so no setter can ever run against a
  // missing row, and a failed insert surfaces as the gate's error state
  // instead of an unhandled rejection.
  .then(() => settingsRepo.ensure())
  .then(migrateLegacyToken)
```

Update the existing doc comment above the chain (lines 22-25) to mention the settings-row step.

- [ ] **Step 6: Remove the redundant effect from `App.tsx`**

Delete the `useEffect` at `App.tsx:32-34` and the now-unused `settingsRepo` import at `App.tsx:19`. Update `AppRoot`'s doc comment (lines 23-30): drop "Ensures the single settings row exists" and say the row is guaranteed by `MigrationsGate`. Biome's `noUnusedImports` will fail the lint hook if the import is left behind.

- [ ] **Step 7: Run the tests green, then the affected suites**

```bash
npx jest src/db/migrations.gate.test.tsx src/repositories/settings.repo.test.ts __tests__/App.test.tsx
```

Expected: PASS. `__tests__/App.test.tsx` may assert on `settingsRepo.ensure` being called from `AppRoot` — if it does, move that assertion to the gate test rather than restoring the effect.

---

## Task 2: T-2 — Clamp `addMonths` to the target month's length and de-duplicate bond coupon dates

**Confidence: CONFIRMED.**

`addMonths` (`src/holdings/interest.ts:38-42`) uses `setMonth(getMonth() + n)`, which overflows into the next month whenever the target month is shorter than the source day-of-month. Everything anchored on it inherits the drift: `periodBoundary` (`:63-64`), `depositMaturity` (`:74-75`), `depositLedger`'s maturity (`:241`), and `bondCouponDates` (`:371-387`) — which additionally never de-duplicates, so an overflow can emit the same coupon instant twice while skipping a month entirely. `midCredit` (`:88-93`) already applies the correct clamp (`Math.min(openingDay, length)`), so bi-weekly capitalization is unaffected; every other frequency is wrong.

Concrete confirmed wrongness: a government bond, nominal 100,000.00 UAH, 16% semiannual, bought 1 May 2025, maturity **30** Oct 2026 → 3 coupons, profit 2,400,000 minor. The same bond with maturity **31** Oct 2026 → 4 coupons, profit 3,200,000 minor — a fabricated 8,000.00 UAH coupon from a one-day maturity change.

**Files:**
- Modify: `src/holdings/interest.ts:38-42` (`addMonths`), `:371-387` (`bondCouponDates`)
- Test: `src/holdings/interest.test.ts`

**Interfaces:**
- Consumes: `daysInMonth(year, monthIndex)` at `src/holdings/interest.ts:78-79` (already exists, module-private, defined **below** `addMonths` — hoisting is not needed, `const` arrow declarations in the same module are fine as long as `addMonths` is only *called* after module evaluation, which it is; if Biome or `tsc` objects, move `daysInMonth` and `atDay` above `addMonths`).
- Produces: `addMonths(start, months)` clamps the day; every downstream boundary function is fixed by that alone. `bondCouponDates` additionally returns a de-duplicated ascending list.

- [ ] **Step 1: Write the failing tests in `src/holdings/interest.test.ts`**

The file already has a `local(year, monthIndex, day)` helper — read it and reuse it. Add:

```ts
describe('addMonths month-end clamping', () => {
  it('clamps 31 Jan + 1 month to 28 Feb, not 3 Mar', () => {
    expect(addMonths(local(2026, 0, 31), 1)).toBe(local(2026, 1, 28));
  });

  it('clamps 31 Aug + 6 months to 28 Feb, not 3 Mar', () => {
    expect(addMonths(local(2025, 7, 31), 6)).toBe(local(2026, 1, 28));
  });

  it('clamps a backwards step the same way', () => {
    expect(addMonths(local(2026, 2, 31), -1)).toBe(local(2026, 1, 28));
  });

  it('leaves a day that fits the target month untouched', () => {
    expect(addMonths(local(2026, 0, 15), 1)).toBe(local(2026, 1, 15));
  });
});

describe('depositMaturity month-end', () => {
  it('matures a 31 Aug 2025 six-month deposit on 28 Feb 2026', () => {
    expect(depositMaturity([{ date: local(2025, 7, 31) }], 6)).toBe(local(2026, 1, 28));
  });
});

describe('periodBoundary month-end', () => {
  it('walks month-ends without skipping February', () => {
    const start = local(2026, 0, 31);

    expect(periodBoundary(start, 'monthly', 1)).toBe(local(2026, 1, 28));
    expect(periodBoundary(start, 'monthly', 2)).toBe(local(2026, 2, 31));
    expect(periodBoundary(start, 'monthly', 3)).toBe(local(2026, 3, 30));
  });
});

describe('bondCouponDates month-end maturity', () => {
  it('pays three semiannual coupons for a 31 Oct 2026 maturity bought 1 May 2025', () => {
    expect(bondCouponDates(local(2025, 4, 1), local(2026, 9, 31), 'semiannually')).toEqual([
      local(2025, 9, 15),
      local(2026, 3, 15),
      local(2026, 9, 31),
    ]);
  });

  it('emits no duplicate instants for a monthly month-end maturity', () => {
    const dates = bondCouponDates(local(2025, 11, 1), local(2026, 2, 31), 'monthly');

    expect(new Set(dates).size).toBe(dates.length);
  });
});
```

- [ ] **Step 2: Run them and confirm the failures**

```bash
npx jest src/holdings/interest.test.ts
```

Expected: `addMonths(local(2026,0,31), 1)` returns 3 Mar 2026; `depositMaturity` returns 3 Mar 2026; the semiannual list has **four** entries (`15.5.2025, 15.10.2025, 15.5.2026, 31.10.2026`); the monthly list has a duplicate December.

- [ ] **Step 3: Clamp `addMonths`**

Replace the body at `src/holdings/interest.ts:38-42`:

```ts
// Add (or subtract) whole calendar months, CLAMPING the day to the target
// month's length. A naive `setMonth(getMonth() + n)` overflows whenever the
// target month is shorter than the source day-of-month (31 Jan + 1 month ->
// 3 Mar, not 28 Feb), which silently fabricates or drops days of interest in
// every boundary built on it: `periodBoundary`, `depositMaturity`,
// `depositLedger`'s maturity, and `bondCouponDates`. This is the same clamp
// `midCredit` already applies to the bi-weekly path.
export const addMonths = (start: number, months: number): number => {
  const date = new Date(start);
  const targetMonthStart = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const year = targetMonthStart.getFullYear();
  const monthIndex = targetMonthStart.getMonth();
  const day = Math.min(date.getDate(), daysInMonth(year, monthIndex));

  return new Date(year, monthIndex, day).getTime();
};
```

Note: `new Date(y, m, 1)` normalizes an out-of-range month index (e.g. month 12 → January of the next year, month -1 → December of the previous), so `months` may be any integer, positive or negative. If `tsc` or Biome flags `daysInMonth` as used-before-declared, move `daysInMonth` (currently `:78-79`) and `atDay` (`:81-82`) above `addMonths`.

- [ ] **Step 4: De-duplicate `bondCouponDates`**

At `src/holdings/interest.ts:386`, change the final `return` to de-duplicate the way `biweeklyCreditDates` already does at `:129`:

```ts
  // A month-end maturity can step onto the same 15th twice once `addMonths`
  // clamps, so de-dup before sorting — the same `new Set` pass
  // `biweeklyCreditDates` uses for its own clamp collision.
  return [...new Set(dates)].sort((a, b) => a - b);
```

- [ ] **Step 5: Run the tests green, then every interest consumer**

```bash
npx jest src/holdings src/screens/holding-detail src/statistics
```

Expected: PASS. If a pre-existing test in `interest.test.ts:318-350` or in `derived-entries.test.ts` now fails, read it: those cases use maturity days 14, 20 and 10, none of which trigger the overflow, so a failure there means the clamp changed a case it should not have — investigate rather than editing the expectation.

---

## Task 3: T-3 — Keep the sync key on disconnect and gate `isSyncedHolding` on the account's institution

**Confidence: CONFIRMED.**

`accountsRepo.disconnect` (`src/repositories/accounts.repo.ts:117-136`) strips `monobankId` / `walletAddress` / `binanceAsset` from every synced holding's metadata but leaves the row with its full balance. Reconnecting runs `upsertByMetadataKey` (`src/repositories/holdings.repo.ts:53-77`), whose match `json_extract(metadata, '$.monobankId') = <id>` now finds nothing, so a **second** holding is inserted with the same balance. Net worth double-counts every card, jar, wallet and Binance balance. Transactions stay on the orphaned holding; the fresh one gets none, because the `(source, external_id)` unique index makes `addManyDedup` drop the re-imported items.

**Chosen fix: option one — keep the sync key in metadata, and decide "is this holding synced?" from the account's `institution` instead.** Why, and what it breaks:

`isSyncedHolding` (`src/holdings/deletable.ts:15-25`) today answers "does this holding's metadata carry a sync key?". Keeping the key on disconnect would make that return `true` forever, which breaks three readers: `holdingsRepo.remove` would refuse to delete a disconnected holding (`holdings.repo.ts:206`), `holding-form.screen.tsx:181` would keep hiding the balance field, and `account-detail.screen.tsx:341` would keep the card non-deletable. So option one is only correct if `isSyncedHolding` also takes the account. It does not break anything else: the metadata-key match in `upsertByMetadataKey` is already scoped to one `accountId`, so a stale key under a disconnected account can never be adopted by a different account's sync.

The alternative (re-adopt orphans by iban/maskedPan on reconnect) was rejected: it needs a per-source secondary key, has no key at all for a Monobank **jar** or a Binance asset, and leaves the primary key silently stale.

**Files:**
- Modify: `src/holdings/deletable.ts:15-25` (`isSyncedHolding` signature + body)
- Modify: `src/repositories/accounts.repo.ts:42-51` (`strippedOnDisconnect`), `:112-136` (`disconnect` doc comment + body)
- Modify: `src/repositories/holdings.repo.ts:199-211` (`remove` — read the account row inside the transaction)
- Modify: `src/screens/forms/holding-form.screen.tsx:181`, `src/screens/account-detail/account-detail.screen.tsx:341` (pass the account)
- Test: `src/repositories/holdings.repo.test.ts`, `src/holdings/deletable.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/holdings/deletable.ts
  export const isSyncedHolding = (
    holding: Pick<HoldingRow, 'metadata'>,
    account: Pick<AccountRow, 'institution'> | undefined,
  ): boolean
  ```
  Returns `true` only when the account is a synced institution AND the holding carries a sync key. A missing account (`undefined`) reads as not synced.

- [ ] **Step 1: Write the failing test in `src/repositories/holdings.repo.test.ts`**

```ts
it('re-adopts the same holding after disconnect + reconnect', async () => {
  const accountId = await accountsRepo.create({ name: 'Monobank', kind: 'bank' });
  await accountsRepo.update(accountId, { institution: 'monobank' });

  const upsert = () =>
    holdingsRepo.upsertMonobank({
      accountId,
      name: '1234',
      type: 'card',
      currency: 'UAH',
      balanceMinorUnits: 500_00,
      monobankId: 'mono-1',
    });

  await upsert();
  await accountsRepo.disconnect(accountId);
  await accountsRepo.update(accountId, { institution: 'monobank' });
  await upsert();

  const rows = await holdingsRepo.listByAccountQuery(accountId);

  expect(rows).toHaveLength(1);
  expect(rows[0].balanceMinorUnits).toBe(500_00);
});
```

- [ ] **Step 2: Write the failing test in `src/holdings/deletable.test.ts`**

```ts
describe('isSyncedHolding', () => {
  const holding = { metadata: { monobankId: 'mono-1' } };

  it('is synced while its account is connected', () => {
    expect(isSyncedHolding(holding, { institution: 'monobank' })).toBe(true);
  });

  it('is NOT synced once its account is disconnected, even with the key kept', () => {
    expect(isSyncedHolding(holding, { institution: null })).toBe(false);
  });

  it('is not synced when the account is missing', () => {
    expect(isSyncedHolding(holding, undefined)).toBe(false);
  });

  it('is not synced for a manual holding under a connected account', () => {
    expect(isSyncedHolding({ metadata: null }, { institution: 'monobank' })).toBe(false);
  });
});
```

- [ ] **Step 3: Run them and confirm the failures**

```bash
npx jest src/repositories/holdings.repo.test.ts src/holdings/deletable.test.ts
```

Expected: the repo test finds **2** rows; the `deletable` tests fail to compile (`isSyncedHolding` takes one argument).

- [ ] **Step 4: Widen `isSyncedHolding`**

```ts
/**
 * Whether a holding's balance is owned by a sync right now. BOTH conditions
 * must hold: its ACCOUNT is currently connected to a synced institution, and
 * the holding itself carries that source's key in metadata.
 *
 * The account gate is load-bearing. `accountsRepo.disconnect` deliberately
 * KEEPS the sync key (`monobankId` / `walletAddress` / `binanceAsset`) on the
 * holding so a later reconnect re-adopts the same row instead of inserting a
 * duplicate that double-counts the balance. The key alone therefore no longer
 * means "synced" — only the key plus a live `institution` does.
 */
export const isSyncedHolding = (
  holding: Pick<HoldingRow, 'metadata'>,
  account: Pick<AccountRow, 'institution'> | undefined,
): boolean => {
  if (account === undefined || !isSyncedAccount(account)) {
    return false;
  }

  const meta = holding.metadata;

  if (typeof meta !== 'object' || meta === null) {
    return false;
  }

  const record = meta as Record<string, unknown>;

  return syncedMetadataFields.some((field) => typeof record[field] === 'string');
};
```

`isSyncedAccount` is declared below it in the same module today — move `isSyncedAccount` above `isSyncedHolding` so the read order matches the call order.

- [ ] **Step 5: Stop stripping the sync keys on disconnect**

In `src/repositories/accounts.repo.ts`, narrow the stripped set to the sync bookkeeping stamp only:

```ts
// A disconnect strips ONLY the balance-sync `syncedAt` stamp (stale
// bookkeeping). The sync KEYS (`monobankId` / `walletAddress` /
// `binanceAsset`) are deliberately KEPT: `upsertByMetadataKey` matches on
// them, so dropping them made a reconnect insert a SECOND holding carrying
// the same balance, double-counting net worth while the original kept every
// transaction. "Manual" is now decided by the account's cleared
// `institution` alone — see `isSyncedHolding`.
const strippedOnDisconnect: readonly string[] = [SYNCED_AT_FIELD];
```

`syncedMetadataFields` becomes unused in this file — remove it from the import at `:8` or Biome's `noUnusedImports` fails.

Then in `disconnect`'s body: the `if (!isSyncedHolding(holding)) { continue; }` guard at `:130-132` cannot call the new two-argument form usefully (the account's `institution` is cleared two statements earlier in the same transaction). Replace the guard with a plain metadata test — the loop's only job now is to drop `syncedAt`:

```ts
      for (const holding of accountHoldings) {
        const metadata = holding.metadata as Record<string, unknown> | null;

        if (metadata === null || !(SYNCED_AT_FIELD in metadata)) {
          continue;
        }

        await tx
          .update(holdings)
          .set({ metadata: withoutSyncMetadata(metadata) })
          .where(eq(holdings.id, holding.id));
      }
```

Rewrite `disconnect`'s doc comment (`:112-127`) to state the new contract: institution cleared, sync keys kept, `syncedAt` dropped, balances/holdings/transactions untouched.

- [ ] **Step 6: Update the three `isSyncedHolding` call sites**

`src/repositories/holdings.repo.ts` `remove` — read the account inside the same transaction:

```ts
      const accountRows = await tx
        .select({ institution: accounts.institution })
        .from(accounts)
        .where(eq(accounts.id, row.accountId));

      if (isSyncedHolding(row, accountRows.at(0))) {
        throw new Error('remove: cannot delete a synced holding');
      }
```

Add `accounts` to the schema import at the top of that file.

`src/screens/forms/holding-form.screen.tsx:181` — the screen already knows `accountId`; add an `accountsRepo.byIdQuery` live query next to the existing holding query and pass the row:

```tsx
  const { data: formAccounts } = useLiveQuery(accountsRepo.byIdQuery(accountId), ['accounts']);
  const isSyncedEdit =
    editingHolding !== undefined && isSyncedHolding(editingHolding, formAccounts.at(0));
```

`src/screens/account-detail/account-detail.screen.tsx:341` — this screen already loads its account; pass that row:

```tsx
                    deletable={!isSyncedHolding(item, account)}
```

Read the surrounding code for the exact local name of the loaded account row before writing this.

- [ ] **Step 7: Run the tests green, then every consumer**

```bash
npx jest src/repositories src/holdings src/screens/forms/holding-form.screen.test.tsx src/screens/account-detail src/monobank src/crypto-sync
```

Expected: PASS. `src/monobank/sync.test.ts` and `src/crypto-sync/*.test.ts` exercise the reconnect path — a failure there is real, not a stale expectation.

---

### CHECKPOINT after Task 3

```bash
npm run check:all
npx jest
```

Both must be green before Task 4.

---

## Task 4: T-10 + T-11 — Pin the tab bar's background through `tabBarStyle`, and pin the native interface style to Dark

**Confidence: T-10 CONFIRMED. T-11 PLAUSIBLE (the plist facts are confirmed; one device check is outstanding).**

These are paired because T-11 is T-10's root cause and T-10's fix removes a `tsc` error that Task 5 must not inherit.

**Ordering note (deviation from the coordinator's stated order, deliberate):** the coordinator put T-26 fourth. But `npx tsc --noEmit` reports `src/navigation/root.navigator.tsx(43,7): error TS2769` and `__mocks__/@bottom-tabs/react-navigation.tsx(52,30): error TS2322`, and T-10's fix is exactly what clears both — the spec even names `npx tsc --noEmit | grep root.navigator` as T-10's confirm step. Task 5 cannot reach zero errors without this task, so it runs first. The coordinator's intent (typecheck green early, every later task typechecked) is preserved.

**T-10, what happens:** `barTintColor` is not a `NativeBottomTabNavigatorProps` member. It falls through `...rest` into `TabView`, which at `node_modules/react-native-bottom-tabs/src/TabView.tsx:477` re-declares `barTintColor={tabBarStyle?.backgroundColor}` **after** the spread. `tabBarStyle` is never passed, so the native view receives `undefined` and `configureWithDefaultBackground()` runs — the bar keeps flipping light/dark (bug B1). `__mocks__/@bottom-tabs/react-navigation.tsx:44,:52` accepts `barTintColor` and paints it on a `View`, so `src/navigation/root.navigator.test.tsx:39-47` passes for the wrong reason.

**T-11, what happens:** `ios/Kiko/Info.plist:83` sets `UIViewControllerBasedStatusBarAppearance = false` and there is no `UIUserInterfaceStyle` and no `UIStatusBarStyle`. The app is dark-only in JS (`src/design-system/unistyles.ts:14-17`, the `NavigationContainer` theme) but the process trait collection follows the device. On a Light device the status bar renders dark content over `#000000`, and every `Alert.alert` (`swipeable-row.component.tsx:216`, `transaction-form.screen.tsx:887`, `contribution-form.screen.tsx:66`, `account-detail.screen.tsx:180,185`), the datetimepicker, the keyboard and the `UITabBar` glass all render light.

**Files:**
- Modify: `src/navigation/root.navigator.tsx:26-46`
- Modify: `__mocks__/@bottom-tabs/react-navigation.tsx:40-56`
- Modify: `ios/Kiko/Info.plist` (add two keys)
- Test: `src/navigation/root.navigator.test.tsx:39-47`, new `__tests__/info-plist.test.ts`

- [ ] **Step 1: Run T-11's confirm step (PLAUSIBLE)**

```bash
grep -n "UIUserInterfaceStyle\|UIStatusBarStyle" ios/Kiko/Info.plist
grep -rn "StatusBar" src App.tsx
npx tsc --noEmit 2>&1 | grep -E "root\.navigator|bottom-tabs"
sed -n '456p;477p' node_modules/react-native-bottom-tabs/src/TabView.tsx
```

Expected: the first two commands print nothing (neither plist key exists; no `<StatusBar>` anywhere), the third prints the two type errors quoted above, and `TabView.tsx:477` shows `barTintColor={tabBarStyle?.backgroundColor}` after the spread. If any of those does not hold, stop and report.

- [ ] **Step 2: Fix the mock first, so the test cannot pass for the wrong reason**

In `__mocks__/@bottom-tabs/react-navigation.tsx`, stop accepting `barTintColor` and forward `tabBarStyle` instead — the props the real library actually consumes:

```tsx
// Forward ONLY the props the real @bottom-tabs/react-navigation adapter
// consumes. `barTintColor` is NOT one of them: it is not a
// NativeBottomTabNavigatorProps member, so the real adapter drops it into
// `...rest` and react-native-bottom-tabs' TabView then OVERWRITES it with
// `tabBarStyle?.backgroundColor` (TabView.tsx:477). A mock that accepted and
// painted `barTintColor` made root.navigator.test.tsx green while the device
// tab bar still flipped light/dark (bug B1). Keep this mock's prop surface
// narrower than the app's, never wider.
```

Read the file and remove `barTintColor` from the destructure at `:44` and from the `View` at `:52`, adding `tabBarStyle` in its place (spread onto the `View`'s `style`, or exposed via a prop the test can read back — whichever the file's existing shape makes natural).

- [ ] **Step 3: Update `src/navigation/root.navigator.test.tsx` to assert the real prop**

```tsx
it('pins the native tab bar background to the dark background token', async () => {
  const { getByTestId } = await render(<RootNavigator />);

  expect(getByTestId('tab-bar').props.tabBarStyle.backgroundColor).toBe(
    darkTheme.colors.background,
  );
});
```

Read `:39-47` for the existing testID and delete the `barTintColor` assertion it replaces.

- [ ] **Step 4: Write the failing plist test at `__tests__/info-plist.test.ts`**

Follow the file-reading pattern of `src/db/schema.category-overrides.test.ts:1-9` (`node:fs` + `node:path` + `__dirname`). No plist parser dependency — a substring assertion on the raw XML is enough and adds no dependency:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ios/Kiko/Info.plist', () => {
  const plist = (): string =>
    readFileSync(join(__dirname, '../ios/Kiko/Info.plist'), 'utf8');

  it('pins the native interface style to Dark', () => {
    // The app is dark-only in JS (unistyles + the NavigationContainer theme),
    // but Alert, the datetimepicker, the keyboard, the status bar and the
    // UITabBar glass all follow the PROCESS trait collection, which tracks the
    // device unless this key pins it.
    expect(plist()).toMatch(
      /<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/,
    );
  });

  it('pins the status bar to light content', () => {
    expect(plist()).toMatch(
      /<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleLightContent<\/string>/,
    );
  });
});
```

This test uses `__dirname`, which the current `tsconfig.json` (`"types": ["jest"]`, no `node`) rejects. That adds 1 error to the `tsc` baseline; Task 5 fixes it repo-wide. Do not work around it here.

- [ ] **Step 5: Run both test files and confirm they fail**

```bash
npx jest src/navigation/root.navigator.test.tsx __tests__/info-plist.test.ts
```

Expected: the navigator test fails because `tabBarStyle` is `undefined`; both plist assertions fail because neither key exists.

- [ ] **Step 6: Pass `tabBarStyle` on the navigator**

In `src/navigation/root.navigator.tsx`, replace `barTintColor={darkTheme.colors.background}` at `:43`:

```tsx
    <Tabs.Navigator
      // `tabBarStyle.backgroundColor` — NOT `barTintColor` — is the real
      // NativeBottomTabNavigationConfig member. `barTintColor` is not a
      // NativeBottomTabNavigatorProps member at all: the adapter passes it
      // through `...rest` and react-native-bottom-tabs' TabView then
      // re-declares `barTintColor={tabBarStyle?.backgroundColor}` AFTER that
      // spread (TabView.tsx:477), so the native view received `undefined` and
      // `configureWithDefaultBackground()` re-resolved the bar's glass against
      // the ambient userInterfaceStyle on every tab's `onAppear` — the bar
      // flipped light/dark between pages (bug B1). The Info.plist
      // `UIUserInterfaceStyle = Dark` key removes the ambient variance too;
      // both fixes are wanted, this one pins the concrete color.
      tabBarStyle={{ backgroundColor: darkTheme.colors.background }}
      tabBarActiveTintColor={darkTheme.colors.accent}
      tabBarInactiveTintColor={darkTheme.colors.textSecondary}
    >
```

Rewrite the `:27-36` doc comment to describe `tabBarStyle` rather than `barTintColor`.

- [ ] **Step 7: Add the two Info.plist keys**

In `ios/Kiko/Info.plist`, insert both keys in the existing alphabetical run (after `RCTNewArchEnabled`, before `UILaunchStoryboardName`). Keep the file's tab indentation:

```xml
	<key>UIStatusBarStyle</key>
	<string>UIStatusBarStyleLightContent</string>
	<key>UIUserInterfaceStyle</key>
	<string>Dark</string>
```

Do not touch `NSLocationWhenInUseUsageDescription` (lines 62-63) or the ATS/pinning dictionary above it — the `security-pass-fixes` branch owns both.

- [ ] **Step 8: Run the tests green**

```bash
npx jest src/navigation __tests__/info-plist.test.ts
npx tsc --noEmit 2>&1 | grep -E "root\.navigator|bottom-tabs" || echo "navigator type errors cleared"
```

Expected: tests PASS; the two navigator/mock type errors are gone.

- [ ] **Step 9: Queue the device verification (do not block on it)**

Record these for the plan's final section — they cannot be asserted in Jest:

- **MANUAL-1 (ops, simulator):** build and launch; set the simulator to Light appearance (Settings → Developer → Dark Appearance off); confirm the status bar clock/battery are visible, the tab bar stays dark while switching tabs, and a delete `Alert` renders dark.
- **MANUAL-2 (user, device):** Display & Brightness → Light; launch Kiko; switch tabs; open any delete alert and the transaction date picker.

---

## Task 5: T-26 — Zero the `tsc --noEmit` baseline and wire `check:typecheck` into the harness

**Confidence: CONFIRMED.**

`npx tsc --noEmit` currently reports **483** errors on this worktree (verified). The spec's "287 non-test errors" figure counts only non-`*.test.*` files; `tsconfig.json`'s `include` is `["**/*.ts", "**/*.tsx"]`, so a project-wide check must clear all 483. There is no `check:typecheck` step in the harness today, so none of this fails a hook or `check:all`.

Verified breakdown (`cut -d'(' -f1 | sort | uniq -c`):

| Count | Where | Family |
|---|---|---|
| 261 | `src/i18n/locales/uk.ts` | `as const` on `en.ts` makes `typeof en` carry string-literal value types, so `uk.ts`'s `typeof en` annotation demands the exact English literals — one error per translated string |
| 10 | 9 source files + 1 test | `TFunction` imported from `react-i18next`, which no longer exports it |
| 4 | `transaction-form.screen.tsx:645,955,977`, `app-lock-setting.component.tsx:57` | a helper param typed `(key: string) => string` cannot accept a real `TFunction` |
| ~15 | 5 `useAnimatedRef<ScrollView>()` sites, `use-scroll-to-top-on-tab-press.ts`, `screen.component.tsx:70`, `category-field.component.tsx:82,120`, `home.screen.tsx:150,446` | RN 0.87 codegen split the component type from the instance type; the ref types now need `ScrollViewInstance` / `SectionListInstance` |
| 5 | `accounts.screen.tsx:156`, `account-detail.screen.tsx:358`, `categories.screen.tsx:365` + 2 tests | `key` is destructured from `onDragEnd`'s payload and passed into `GridDragEnd`, which has no `key` member |
| 1 | `holding-select-field.component.tsx:64` | `marginLeft: 'auto'` widens to `string` |
| 11 | 5 test files | `process` / `__dirname` / `global` / `node:fs` / `node:path` unresolved: the base config sets `"types": ["jest"]` |
| ~94 | 12 screen test files | `navigation` doubles cast `as never` (`TS2339 ... on type 'never'`) or screens rendered with no props at all (`TS2739 missing navigation, route`) |
| ~80 | ~20 test files | assorted RNTL/`TestInstance` looseness, spread-argument arity, `possibly undefined` |

Runtime is unaffected by every one of these. Work in the five phases below, running `npx tsc --noEmit 2>&1 | grep -c "error TS"` after each so progress is visible.

**Files:** listed per phase.

**Interfaces:**
- Produces: `npm run check:typecheck` (exit 0 = zero errors), `scripts/checks/typecheck.sh`, `src/test-support/navigation-props.ts` (see Phase 4 for its exact exports). Every later task's verification includes `npm run check:typecheck`.

- [ ] **Step 1: Record the baseline**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" > /tmp/tsc-baseline.txt
wc -l < /tmp/tsc-baseline.txt
cut -d'(' -f1 /tmp/tsc-baseline.txt | sort | uniq -c | sort -rn | head -40
```

Expected: 483 (484 after Task 4 added the `__dirname` use in `__tests__/info-plist.test.ts`). Keep this file; every phase below diffs against it.

- [ ] **Step 2: Phase 1 — drop `as const` from `en.ts` (kills 261)**

`src/i18n/i18next.d.ts` needs only the catalogue's **key structure**, not its literal value types — the `as const` buys nothing and buries a genuinely missing `uk.ts` key inside 261 lines of literal-mismatch noise, which is exactly the guard `uk.ts:3-4`'s comment claims to provide.

At `src/i18n/locales/en.ts:363`, change `} as const;` to `};`. Update the file's header comment (`:1-4`) to say why:

```ts
// The canonical English catalog. This object is BOTH the runtime English
// resource AND the source of the catalog's TypeScript type (see i18next.d.ts).
// Every user-facing string lives here, namespaced by app area. uk.ts mirrors
// this exact key set.
//
// Deliberately NOT `as const`: `i18next.d.ts` needs only this object's KEY
// STRUCTURE, and a literal-typed `typeof en` made uk.ts's `typeof en`
// annotation demand the exact ENGLISH strings — 261 tsc errors, one per
// translated value, which buried the real "uk.ts is missing a key" error the
// annotation exists to surface.
```

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx tsc --noEmit 2>&1 | grep -c "^src/i18n/locales/uk.ts"
npx jest src/i18n
```

Expected: total drops by 261; the `uk.ts` count is 0; the i18n suites stay green. Then verify the guard still works: temporarily delete one key from `uk.ts`, confirm `tsc` reports exactly that key, restore it.

- [ ] **Step 3: Phase 2 — move the `TFunction` imports to `i18next` (kills 14)**

`react-i18next` no longer re-exports `TFunction`; `i18next` does (`node_modules/i18next/index.d.ts:603`, inside its `export type { ... }` block). In each of these files change `import type { TFunction } from 'react-i18next';` to `import type { TFunction } from 'i18next';`:

- `src/crypto-sync/provider.ts:1`
- `src/holdings/derived-entries.ts:1`
- `src/transactions/default-description.ts:1`
- `src/screens/account-detail/account-detail.screen.tsx:4`
- `src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.tsx:2`
- `src/screens/forms/transaction-form.screen.tsx:2`
- `src/screens/holding-detail/holding-detail.screen.tsx:3`
- `src/screens/home/date-range-field/date-range-field.component.tsx:2`
- `src/screens/home/home.screen.tsx:6`

Plus the one test file `tsc` names (find it with `npx tsc --noEmit 2>&1 | grep TFunction`).

Then replace the four `(key: string) => string` parameter types with the real `TFunction`, adding the `i18next` type import where missing:

- `src/screens/settings/app-lock-setting/app-lock-setting.component.tsx:17`
- `src/screens/forms/transaction-form.screen.tsx:259` (parameter), `:343` and `:456` (object-type members)

Biome's `organizeImports` assist will reorder the changed import blocks — run `npx biome check --write` on the touched files rather than hand-sorting.

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx tsc --noEmit 2>&1 | grep -c TFunction
```

Expected: `TFunction` count 0.

- [ ] **Step 4: Phase 3 — use RN 0.87's instance types for every scroll ref (kills ~15)**

RN 0.87 exports `ScrollViewInstance`, `SectionListInstance` and `FlatListInstance` as public types (`node_modules/react-native/types_generated/index.d.ts:22,47,49`); `ScrollView` / `SectionList` are now the *component* types, which is why an `AnimatedRef<ScrollView>` no longer satisfies `Ref<ScrollViewInstance>`. Reanimated's `useAnimatedRef<TRef extends InstanceOrElement = HostInstance>()` accepts the instance type directly.

This combination was verified to compile clean against this worktree's `node_modules`:

```ts
import type { RefObject } from 'react';
import type { FlatListInstance, ScrollViewInstance, SectionListInstance } from 'react-native';
import { useAnimatedRef } from 'react-native-reanimated';

export type TabRootScrollable =
  | ScrollViewInstance
  | FlatListInstance<unknown>
  | SectionListInstance<unknown>;

const scrollRef = useAnimatedRef<ScrollViewInstance>();
const asRefObject: RefObject<TabRootScrollable | null> = scrollRef; // assignable
```

Apply it:

1. `src/navigation/use-scroll-to-top-on-tab-press.ts:10,18` — import the three `*Instance` types instead of `FlatList`/`ScrollView`/`SectionList` and redefine `TabRootScrollable` as above. Update the type's doc comment (`:12-17`) to note that RN 0.87's codegen split component from instance, so this union names the INSTANCE types the refs actually hold.
2. Change `useAnimatedRef<ScrollView>()` to `useAnimatedRef<ScrollViewInstance>()` in `src/screens/statistics/statistics.screen.tsx:150`, `src/screens/settings/settings.screen.tsx:29`, `src/screens/settings/categories.screen.tsx:321`, `src/screens/account-detail/account-detail.screen.tsx:134`, `src/screens/accounts/accounts.screen.tsx:55`. Drop the now-unused `ScrollView` type imports.
3. `src/design-system/components/screen/screen.props.d.ts:9` — retype `scrollableRef` against `ScrollViewInstance`; `screen.component.tsx:70`'s `ref={scrollableRef}` then typechecks.
4. `src/screens/forms/category-field/category-field.component.tsx:82,120` — `useRef<ScrollViewInstance>(null)`; `scrollTo` exists on the instance type.
5. `src/screens/home/home.screen.tsx:150` — `useRef<SectionListInstance<TransactionRow>>(null)` (read the file for the section/item types actually rendered; `SectionListInstance<unknown>` is acceptable if the concrete generics fight back). This also clears `:446`'s `TS2769` on `ref={listRef}`.

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx tsc --noEmit 2>&1 | grep -E "AnimatedRef|ScrollViewInstance|scrollTo" || echo "ref family cleared"
npx jest src/navigation src/design-system/components/screen src/screens/forms/category-field
```

- [ ] **Step 5: Phase 4 — the small one-offs plus node globals (kills ~17)**

**`GridDragEnd` `key` (5 errors).** `src/screens/grid-interaction.ts:10-14` defines `GridDragEnd` as `{ fromIndex, toIndex, indexToKey }` — no `key`. Three call sites destructure `key` from `onDragEnd`'s payload and pass it straight through. `onGridDragEnd` (`:32-39`) reads only `fromIndex`/`toIndex`/`indexToKey`, so `key` is dead weight. Drop it at each site:

```tsx
              onDragEnd={({ fromIndex, toIndex, indexToKey }) =>
                onGridDragEnd({ fromIndex, toIndex, indexToKey }, accountsRepo.reorder)
              }
```

Apply in `src/screens/accounts/accounts.screen.tsx:155-157`, `src/screens/account-detail/account-detail.screen.tsx:358`, `src/screens/settings/categories.screen.tsx:365-367`, plus the two test files `tsc` names.

**`marginLeft: 'auto'` (1 error).** In `src/screens/forms/holding-select-field/holding-select-field.styles.ts:20` and `:42`, write `marginLeft: 'auto' as const` so the property keeps its literal type instead of widening to `string`.

**Node globals in tests (11 errors).** The base `@react-native/typescript-config` sets `"types": ["jest"]`, which drops the Node ambient globals five test files legitimately use (`node:fs`, `node:path`, `__dirname`, `process`, `global`). Add `@types/node` explicitly and widen `types`:

```jsonc
// tsconfig.json
{
  "extends": "@react-native/typescript-config",
  "compilerOptions": {
    // The base config pins `types: ["jest"]`, which drops the Node ambient
    // globals the file-reading tests legitimately use (schema migration
    // assertions read drizzle/migrations with node:fs; the plist assertion
    // reads ios/Kiko/Info.plist; interest.test.ts sets process.env.TZ). Jest
    // runs on Node, so these are real, available globals — not a shim.
    "types": ["jest", "node"]
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["**/node_modules", "**/Pods"]
}
```

`@types/node` is already present in `node_modules` transitively, but relying on a transitive type package is fragile — add it as an explicit devDependency:

```bash
npm install --save-dev @types/node
```

`.npmrc`'s `min-release-age=7` will select a version at least 7 days old; that is fine. Then add `"@types/node"` to `.depcheckrc.json`'s `ignores` (type-only, never imported — exactly the existing `@types/jest` case) and record the exception in the root `CLAUDE.md` "Documented exceptions" list under `.depcheckrc.json`, wording it like the `@types/jest` entry. Run `npm run check:deps` and `npm run check:knip`; add a `knip.json` `ignoreDependencies` entry only if Knip actually reports it.

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx tsc --noEmit 2>&1 | grep -v "\.test\.tsx\?(" | grep "error TS" || echo "ALL non-test errors cleared"
```

Expected at this point: **zero** non-test errors, roughly 174 test-file errors left.

- [ ] **Step 6: Phase 5a — a typed navigation double for screen tests (kills ~94)**

The two dominant test families share one root cause: screen tests build a navigation double and cast it `as never` (e.g. `src/screens/account-detail/account-detail.screen.test.tsx:209`: `const navigation = { navigate: jest.fn(), setOptions: jest.fn() } as never;`), so every later `navigation.setOptions` read is a property access on `never` (`TS2339`); other tests render a screen with no props at all (`TS2739: missing navigation, route`). Twelve files repeat the same stub, so fixing them in place would also risk jscpd's 5% duplication threshold. Create one shared helper instead.

Create `src/test-support/navigation-props.ts` (`src/test-support/` already exists — `mock-text-tone.tsx` lives there):

```ts
import type { RouteProp } from '@react-navigation/native';

/**
 * The navigation methods the screen tests actually assert on, each a Jest
 * mock so a test can read `navigation.navigate.mock.calls` back.
 *
 * WHY THIS EXISTS: a screen's `navigation` prop type has ~30 members, so
 * every test used to build a 2-key object and cast it `as never` — which
 * made each later `navigation.setOptions` read a property access on `never`
 * (TS2339, ~49 errors) while giving the test no type safety at all. This
 * module is the ONE place that cast lives, narrowed to `as unknown as` at a
 * single boundary and documented, instead of scattered across twelve files.
 */
export type NavigationSpy = {
  navigate: jest.Mock;
  setOptions: jest.Mock;
  goBack: jest.Mock;
  push: jest.Mock;
  addListener: jest.Mock;
  isFocused: jest.Mock;
  getParent: jest.Mock;
  getState: jest.Mock;
};

export const navigationSpy = (): NavigationSpy => ({
  navigate: jest.fn(),
  setOptions: jest.fn(),
  goBack: jest.fn(),
  push: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  isFocused: jest.fn(() => true),
  getParent: jest.fn(() => undefined),
  getState: jest.fn(() => ({ type: 'stack', routes: [], index: 0 })),
});

/**
 * Present a `NavigationSpy` as a screen's real `navigation` prop. The cast is
 * unavoidable — a full React Navigation prop object cannot be constructed in a
 * unit test — but it is confined to this one function, and the SPY keeps its
 * own precise type at every call site so `.mock.calls` assertions stay typed.
 */
export const asNavigationProp = <TProp>(spy: NavigationSpy): TProp =>
  spy as unknown as TProp;

/** The matching `route` prop: a name plus params, cast at the same single boundary. */
export const asRouteProp = <TProp>(name: string, params?: object): TProp =>
  ({ key: `${name}-test`, name, params } as unknown as TProp);
```

Then rewrite each affected test's setup. `account-detail.screen.test.tsx:204-213` becomes:

```tsx
const renderScreen = async () => {
  const navigation = navigationSpy();
  const view = await render(
    <AccountDetailScreen
      route={route}
      navigation={asNavigationProp<AccountDetailScreenProps['navigation']>(navigation)}
    />,
    { /* keep the existing options */ },
  );

  return { ...view, navigation };
};
```

And `categories.screen.test.tsx`'s 30 bare `render(<CategoriesScreen />)` calls become a single local helper at the top of the describe block:

```tsx
const renderScreen = () =>
  render(
    <CategoriesScreen
      navigation={asNavigationProp<CategoriesScreenProps['navigation']>(navigationSpy())}
      route={asRouteProp<CategoriesScreenProps['route']>('Categories')}
    />,
  );
```

Files to convert (error counts from the baseline): `categories.screen.test.tsx` (30), `settings.screen.test.tsx` (13+), `transaction-form.screen.test.tsx` (11), `holding-detail.screen.test.tsx` (9), `account-detail.screen.test.tsx` (8), `account-form.screen.test.tsx` (7), `contribution-form.screen.test.tsx` (5), `holding-form.screen.test.tsx` (3), `accounts.screen.test.tsx` (3), `settings.screen.app-lock.test.tsx` (2), `statistics.screen.test.tsx` (1), `home.screen.test.tsx` (1).

If Knip reports `src/test-support/navigation-props.ts`'s exports as unused, add the test-file glob to `knip.json`'s `entry` array rather than deleting an export — and record why in the root `CLAUDE.md`.

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx jest src/screens
```

- [ ] **Step 7: Phase 5b — clear the remaining test-file errors (~80)**

These are individually small; work file by file, running `npx tsc --noEmit 2>&1 | grep "<file>"` after each. The families and their fixes:

- **`TS2345: 'TestInstance' is not assignable to '{ props: { style: unknown } }'`** (`button.component.test.tsx`, `bottom-sheet.component.test.tsx`, `screen.component.test.tsx`, others) — a local helper declares a narrower parameter than RNTL's `ReactTestInstance`. Widen the helper's parameter to RNTL's own element type. Note `TS2305: Module '@testing-library/react-native' has no exported member 'ReactTestInstance'` — import it from `react-test-renderer` (`import type { ReactTestInstance } from 'react-test-renderer'`) or type the parameter as `{ props: Record<string, unknown> }` and read the style through a narrowing helper. Do not reach for `any`.
- **`TS2345: '{ readonly currency: "UAH"; readonly minorUnits: 123456 }' is not assignable to 'Money'`** (`currency/format.test.ts:49`) — build the value with `Money.of('UAH', 123456)` instead of an object literal.
- **`TS2353: 'category' does not exist in type '{ id: string } & ExclusionTransaction'`** (5, `transfer-exclusion.test.ts`) — the fixtures carry extra fields the parameter type does not declare. Either extend the test's local fixture type or drop the surplus keys; Task 8 changes this file's types anyway, so prefer the minimal edit here.
- **`TS2352: '{ current: { scrollTo: jest.Mock } }' to 'RefObject<TabRootScrollable | null>'`** (6, `use-scroll-to-top-on-tab-press.test.tsx`) — the message names the fix: cast through `unknown` first, with a one-line comment saying the double implements only the one method the hook calls.
- **`TS7006` implicit `any` parameters** (6) — annotate them.
- **`TS2554` arity, `TS2556` spread, `TS2493` empty-tuple index, `TS18048/18049` possibly-undefined, `TS2591` remaining globals, `TS2365` Animated operand, `TS2769`** (~20 total) — read each site and fix it locally.

Where a test asserts on a value the production types say cannot exist, fix the **test**, not the production type — none of these 483 errors indicates a runtime defect (the whole suite is green today).

```bash
npx tsc --noEmit
```

Expected: **no output** (zero errors).

- [ ] **Step 8: Create `scripts/checks/typecheck.sh`**

Model it exactly on `scripts/checks/lint.sh` (same `_lib.sh` sourcing, same missing-binary block, same `exit 2` on failure so a hook surfaces it):

```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/tsc"

if [ ! -x "$BIN" ]; then
  print_block \
    "TypeScript (tsc --noEmit)" \
    "The typescript compiler is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:typecheck" \
    "Do not run tsc through npx without --no-install (that can auto-fetch an unpinned version from the network). Install the pinned version with npm install."
  exit 2
fi

out="$(cd "$ROOT" && "$BIN" --noEmit 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  print_block \
    "TypeScript (tsc --noEmit)" \
    "tsc reported type errors." \
    "$out" \
    "A type error is a real defect the runtime cannot catch: a prop the native view discards, a ref the library never populates, a catalogue key that does not exist. The baseline was zeroed deliberately; any new error is a regression, not accumulated noise." \
    "Fix the type at its source. Re-run: npm run check:typecheck" \
    "Do not add @ts-expect-error, do not widen a type to any, and do not exclude a file from tsconfig.json to get green."
  exit 2
fi
exit 0
```

Make it executable (`chmod +x scripts/checks/typecheck.sh`) if the other wrappers are.

- [ ] **Step 9: Wire it into `package.json` and `medium.sh`**

In `package.json`'s `scripts`, add `"check:typecheck": "bash scripts/checks/typecheck.sh"` next to the other `check:*` entries, and append it to `check:all`:

```json
"check:all": "npm run check:lint && npm run check:dup && npm run check:knip && npm run check:deps && npm run check:security && npm run check:secrets && npm run check:overrides && npm run check:typecheck",
```

In `scripts/checks/medium.sh`, add **exactly one line** after the `deps.sh` line — nothing else in that file changes (the `security-pass-fixes` branch is adding its own line here, and a one-line-each diff merges trivially):

```bash
"$DIR/typecheck.sh" || exit 2
```

- [ ] **Step 10: Document the new check**

In the root `CLAUDE.md`, add a `check:typecheck` row to the Checks table (`| \`npm run check:typecheck\` | tsc (--noEmit) | any type error fails | medium |`), add it to the `check:all` composite list, and add it to the `medium.sh` description in the "Automatic wiring" paragraph.

- [ ] **Step 11: Verify the whole harness**

```bash
npm run check:typecheck && echo "typecheck OK"
npm run check:all
npx jest
```

All three green. Then prove the check bites: add `const broken: number = 'x';` to any source file, confirm `npm run check:typecheck` exits 2 and prints the structured block, then remove it.

---

### CHECKPOINT after Task 5

```bash
npm run check:all
npm run check:typecheck
npx tsc --noEmit && echo "0 errors"
npx jest
```

From here on, **every** task's verification includes `npm run check:typecheck`.

---

## Task 6: T-4 + T-19 — Normalize category slugs at the sync boundary, migrate existing rows, and fold unknown slugs the same way everywhere

**Confidence: both CONFIRMED.**

Paired because T-19's divergence is what makes T-4's orphans visible, and both are fixed by making one slug convention hold everywhere.

**T-4, what happens:** `categoriesRepo.delete` (`src/repositories/categories.repo.ts:70-87`) reassigns with `eq(transactions.category, key)` at `:81` — a lowercase slug. But `categoryForMcc` (`src/monobank/mcc-category.ts:57`) writes **capitalized** values (`'Groceries'`, `'Dining'`, `'Other'`), consumed by `mapStatementItem` at `src/monobank/sync.ts:108`, and `transactions.category` is a plain `text` column with no `COLLATE NOCASE`. Deleting `groceries` reassigns zero synced rows; they keep a dangling `'Groceries'`. `resolveCategoryDisplay` masks it by lowercasing and folding unresolved keys into the default, so most views look fine — but the documented "never orphan a transaction on a missing category slug" contract (that repo's own doc comment, `:60-69`) is broken. Executed evidence: donut slices come back as `[{key:"groceries", title:"Other", color:"#BF5AF2", share:0.83}, {key:"other", title:"Other", color:"#0A84FF", share:0.17}]` — two "Other" wedges in two colors. Same predicate bug on `categoryOverrides.category` at `:85`.

**T-19, what happens:** `groupKey` (`src/statistics/category-breakdown.ts:80-82`) keeps an unresolvable slug as its own bucket (`category?.toLowerCase() || defaultKey`), while `resolveCategoryKey` (`src/categories/category-display.ts:86-93`) folds a slug that is absent from the display map onto `defaultKey`. Home's filter chip uses the folded key (`home.screen.tsx:283-284`, `:292`, `:301`) but the row's icon color uses the raw lowercased slug (`home.screen.tsx:355-358`), so one category renders two different hues.

**Files:**
- Create: `drizzle/migrations/0014_lowercase_categories.sql`
- Modify: `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js`
- Modify: `src/monobank/mcc-category.ts:39-57`
- Modify: `src/repositories/categories.repo.ts:78-85`
- Modify: `src/statistics/category-breakdown.ts:76-82`, `:137`
- Modify: `src/screens/home/home.screen.tsx:355-358`
- Test: `src/monobank/mcc-category.test.ts`, `src/repositories/categories.repo.test.ts`, `src/statistics/category-breakdown.test.ts`, `src/screens/home/home.screen.test.tsx`

**Interfaces:**
- Produces: `categoryForMcc(mcc)` returns a lowercase slug (`'groceries'`, `'other'`) matching `drizzle/migrations/0002_seed_categories.sql`'s `key` column exactly. `buildCategoryBreakdown` groups through the same fold as `resolveCategoryKey`, so a slug absent from `categoryDisplay` merges into `defaultCategoryKey`.

- [ ] **Step 1: Write the failing test in `src/monobank/mcc-category.test.ts`**

```ts
it('returns the lowercase categories.key slug, matching the seed migration', () => {
  expect(categoryForMcc(5411)).toBe('groceries');
  expect(categoryForMcc(5812)).toBe('dining');
  expect(categoryForMcc(6011)).toBe('cash');
  expect(categoryForMcc(4829)).toBe('transfers');
  expect(categoryForMcc(9999)).toBe('other');
});

it('never returns a value that differs from its own lowercase form', () => {
  const mccs = [5411, 5422, 5812, 4111, 5651, 4814, 7832, 8011, 6011, 6012, 4829, 9999];

  for (const mcc of mccs) {
    const category = categoryForMcc(mcc);

    expect(category).toBe(category.toLowerCase());
  }
});
```

- [ ] **Step 2: Write the failing test in `src/repositories/categories.repo.test.ts`**

```ts
it('reassigns a capitalized legacy category on delete', async () => {
  // A synced row written before slug normalization carries 'Groceries'.
  await seedTransaction({ id: 'tx-legacy', category: 'Groceries' });
  await seedTransaction({ id: 'tx-slug', category: 'groceries' });

  await categoriesRepo.delete('groceries');

  const rows = await listTransactions();

  expect(rows.find((row) => row.id === 'tx-legacy')?.category).toBe('other');
  expect(rows.find((row) => row.id === 'tx-slug')?.category).toBe('other');
});

it('reassigns a capitalized legacy override on delete', async () => {
  await seedOverride({ normalizedName: 'atb', category: 'Groceries' });

  await categoriesRepo.delete('groceries');

  expect((await listOverrides())[0].category).toBe('other');
});
```

Read the file's existing in-memory harness for the real names of its seed/list helpers before writing these; reuse them rather than adding new ones.

- [ ] **Step 3: Write the failing test in `src/statistics/category-breakdown.test.ts`**

```ts
it('folds a category absent from the display map into the default slice', () => {
  const slices = buildCategoryBreakdown({
    transactions: [
      makeTx({ id: 'a', category: 'Groceries', amountMinorUnits: -500_00, currency: 'UAH' }),
      makeTx({ id: 'b', category: 'other', amountMinorUnits: -100_00, currency: 'UAH' }),
    ],
    // 'Groceries' lowercases to 'groceries', which is NOT in this map.
    categoryDisplay: new Map([['other', { title: 'Other', icon: 'square.grid.2x2', color: null }]]),
    rateTable: {},
    baseCurrency: 'UAH',
    defaultCategoryKey: 'other',
  });

  expect(slices).toHaveLength(1);
  expect(slices[0].key).toBe('other');
  expect(slices[0].amount).toBe(600_00);
  expect(slices[0].share).toBe(1);
});
```

Reuse the file's existing transaction-fixture helper (`makeTx` above is a placeholder for whatever it is called — read the file).

- [ ] **Step 4: Write the failing test in `src/screens/home/home.screen.test.tsx`**

```tsx
it('gives a row icon and its filter chip the same resolved color', async () => {
  // A synced row whose stored slug is absent from the categories table: the
  // chip folds it onto the default key, so the icon must fold it too.
  mockTransactions = [makeRow({ id: 'tx-1', category: 'Groceries', amountMinorUnits: -500_00 })];
  mockCategories = [{ key: 'other', title: 'Other', icon: 'square.grid.2x2', color: null }];

  const { getByLabelText } = await renderScreen();

  expect(getByLabelText('Other').props.color).toBe(resolveCategoryColor(null, 'other'));
});
```

Read the file's mock-data setup and the `SymbolIcon` mock's prop surface for the exact query; the assertion that matters is that the icon's `color` equals `resolveCategoryColor(display.color, resolvedKey)`, not `resolveCategoryColor(display.color, rawSlug)`.

- [ ] **Step 5: Run all four and confirm the failures**

```bash
npx jest src/monobank/mcc-category.test.ts src/repositories/categories.repo.test.ts src/statistics/category-breakdown.test.ts src/screens/home/home.screen.test.tsx
```

Expected: `categoryForMcc(5411)` returns `'Groceries'`; the legacy delete leaves `'Groceries'` untouched; the breakdown returns **two** slices both titled "Other"; the Home icon color is `resolveCategoryColor(null, 'groceries')` = `#BF5AF2` while the chip is `#0A84FF`.

- [ ] **Step 6: Normalize `categoryForMcc` output to the slug**

In `src/monobank/mcc-category.ts`, rewrite `MCC_CATEGORIES`' keys to the lowercase slugs so the map itself is the single source of truth (do NOT lowercase at the return site — a reader must see the persisted value in the literal):

```ts
// Keys are `categories.key` SLUGS, lowercase, matching
// drizzle/migrations/0002_seed_categories.sql exactly. This is the value
// persisted into `transactions.category`, so it MUST be the slug and not a
// display title: `transactions.category` is a plain text column with no
// COLLATE NOCASE, so a capitalized 'Groceries' never matched
// `categoriesRepo.delete`'s `eq(transactions.category, 'groceries')`
// predicate and stayed orphaned on a deleted category. The user-facing TITLE
// comes from the categories table via resolveCategoryDisplay, never from here.
const MCC_CATEGORIES: Record<string, readonly number[]> = {
  groceries: [5411, 5422, 5451, 5462, 5499],
  dining: [5812, 5813, 5814],
  transport: [4111, 4121, 4131, 4784, 5541, 5542, 7523],
  shopping: [5651, 5691, 5732, 5912, 5941, 5944, 5945, 5977],
  utilities: [4814, 4899, 4900],
  entertainment: [7832, 7922, 7996, 7997],
  health: [8011, 8021, 8042, 8062],
  cash: [CASH_OUT_MCC],
  transfers: [OWN_ACCOUNT_TRANSFER_MCC, ...CARD_TOPUP_MCCS],
};
```

And at `:57`: `export const categoryForMcc = (mcc: number): string => MCC_TO_CATEGORY.get(mcc) ?? 'other';`

Update the module's header comment (`:1-10`) — it says "human-readable transaction category" and "falls back to 'Other'"; both are now wrong.

- [ ] **Step 7: Make the delete predicates case-insensitive**

In `src/repositories/categories.repo.ts`, replace the two `eq(...)` predicates at `:81` and `:85` with a `lower()` comparison. `sql` is already imported at `:1`:

```ts
      // Match case-insensitively: rows synced before `categoryForMcc` returned
      // slugs carry a capitalized value ('Groceries'), and neither
      // `transactions.category` nor `category_overrides.category` is
      // COLLATE NOCASE — a plain `eq(category, 'groceries')` reassigned zero
      // of them and left them orphaned on a category row that no longer
      // exists, breaking this function's own never-orphan contract.
      // Migration 0014 lowercases every existing value, so this predicate is
      // belt-and-braces for any row written by an older build that has not
      // yet re-synced.
      await tx
        .update(transactions)
        .set({ category: defaultKey })
        .where(sql`lower(${transactions.category}) = ${key.toLowerCase()}`);
      await tx
        .update(categoryOverrides)
        .set({ category: defaultKey })
        .where(sql`lower(${categoryOverrides.category}) = ${key.toLowerCase()}`);
```

- [ ] **Step 8: Write the data migration**

Create `drizzle/migrations/0014_lowercase_categories.sql`:

```sql
/*
 Lowercase every stored category value to the `categories.key` slug convention.

 `src/monobank/mcc-category.ts` used to persist a capitalized display name
 ('Groceries', 'Dining', 'Other') into `transactions.category`, while every
 other writer — the seed in 0002, `categoryOverridesRepo`, and the transaction
 form — persists the lowercase slug. Neither column is COLLATE NOCASE, so a
 capitalized value never matched `categoriesRepo.delete`'s reassignment
 predicate and stayed orphaned on a deleted category slug.

 `categoryForMcc` now emits the slug, so this one-time pass folds every legacy
 row onto the same convention. `lower()` is a no-op on a value that is already
 lowercase, so this is idempotent and safe to re-run. `categories.key` itself
 is untouched — it has always been the lowercase slug.
*/
UPDATE `transactions` SET `category` = lower(`category`) WHERE `category` IS NOT NULL AND `category` <> lower(`category`);--> statement-breakpoint
UPDATE `category_overrides` SET `category` = lower(`category`) WHERE `category` <> lower(`category`);
```

Register it, following the `0006_backfill_sort_order` precedent for a data-only migration (hand-written `.sql`, journal entry, `migrations.js` import, **no** `meta/00NN_snapshot.json` — 0006 has none, because the schema did not change):

1. Append to `drizzle/migrations/meta/_journal.json`'s `entries` array:
   ```json
   { "idx": 14, "version": "6", "when": 1788800000000, "tag": "0014_lowercase_categories", "breakpoints": true }
   ```
   Use a `when` value strictly greater than 0013's `1788701155878` — the runner's `folderMillis` gate orders on it. `Date.now()` at authoring time is fine.
2. In `drizzle/migrations/migrations.js`, add `import m0014 from './0014_lowercase_categories.sql';` after the `m0013` import and `m0014,` to the `migrations` object.

- [ ] **Step 9: Add a migration-registration test**

Extend the existing pattern in `src/db/schema.category-overrides.test.ts` (or add a sibling test file next to it):

```ts
it('lowercases legacy category values in a registered migration', () => {
  const combined = sqlFiles().join('\n');

  expect(combined).toContain('UPDATE `transactions` SET `category` = lower(`category`)');
  expect(combined).toContain('UPDATE `category_overrides` SET `category` = lower(`category`)');
  expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain('0014');
});
```

- [ ] **Step 10: Fold unknown slugs the same way in the breakdown (T-19)**

In `src/statistics/category-breakdown.ts`, replace `groupKey` (`:76-82`) so it applies the same fold `resolveCategoryKey` uses, and pass the display map in at the `:137` call site:

```ts
// The normalized grouping key for a transaction's category: lowercased, with a
// null/empty category AND a slug the display map cannot resolve both folding
// into the DEFAULT category key. This is the same fold `resolveCategoryKey`
// (categories/category-display.ts) applies for Home's filter chips — keeping
// an unresolvable slug as its own bucket produced several wedges all labelled
// with the default's title, in different palette hues, because
// `resolveCategoryDisplay` had already folded the TITLE while this kept the
// KEY. One fold, one place.
const groupKey = (
  category: string | null,
  byKey: ReadonlyMap<string, { title: string; icon: string; color: string | null }>,
  defaultKey: string,
): string => resolveCategoryKey(category, byKey, defaultKey);
```

At `:137`: `const key = groupKey(transaction.category, categoryDisplay, defaultCategoryKey);`

Import `resolveCategoryKey` alongside the existing `resolveCategoryDisplay` at `:1`. Also update the `:148` `representative` capture — with the fold applied, `resolveCategoryDisplay(representative, ...)` at `:155` already resolves correctly, but the representative is now redundant for an unresolvable slug; leave it as-is (it still gives the resolved display for a *resolvable* slug) and do not refactor further.

Note the resulting `groupKey` is a one-line delegation. That is intentional: it keeps the doc comment explaining *why* the fold is shared at the site a reader looks for it. If Biome or the reviewer objects, inline `resolveCategoryKey` at `:137` and move the comment there.

- [ ] **Step 11: Derive Home's row icon color from the resolved key (T-19)**

In `src/screens/home/home.screen.tsx`, `renderTransaction` at `:355-358` passes `item.category?.toLowerCase() || defaultCategoryKey` as `resolveCategoryColor`'s key. Change it to the same `categoryKeyForRow` fold the chips use:

```tsx
                color={resolveCategoryColor(category.color, categoryKeyForRow(item.category))}
```

`categoryKeyForRow` is already defined at `:283-284` in the same component body. Add a short comment: the icon and the filter chip must hash on the SAME resolved key, or one category renders two hues.

- [ ] **Step 12: Run every test green**

```bash
npx jest src/monobank src/repositories/categories.repo.test.ts src/statistics src/screens/home src/db src/categories
npm run check:typecheck
```

Expected: PASS. `src/monobank/sync.test.ts` asserts imported categories — a failure there is the slug change landing correctly; update those expectations to the lowercase slug.

---

## Task 7: T-5 — Hoist the Monobank 60 s throttle to one gate per `runSync`

**Confidence: CONFIRMED.**

The throttle lives **inside one `fetchAllStatements` call**: `isFirstRequest` is a local at `src/monobank/sync.ts:234`, and the guard at `:238-241` sleeps only when it is false. `runSync` (`:291-325`) loops accounts calling `importAccount` → `fetchAllStatements` per card, so the second card's very first statement request fires with **zero** delay → Monobank 429s → the error propagates out of `runSync`, `setLastSyncAt` never runs, and the second and later cards never import at all. `fetchClientInfo` (`:303`) is also unthrottled, and `useAutoSync` at mount plus a pull-to-refresh adds a third unthrottled request.

**Files:**
- Create: `src/monobank/throttle.ts`
- Modify: `src/monobank/sync.ts:226-254` (`fetchAllStatements`), `:291-325` (`runSync`), `:44-77` (`SyncDeps`)
- Test: `src/monobank/throttle.test.ts`, `src/monobank/sync.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/monobank/throttle.ts
  export type RequestGate = { wait: () => Promise<void> };

  export const createRequestGate = (input: {
    intervalMs: number;
    now: () => number;
    sleep: (milliseconds: number) => Promise<void>;
  }): RequestGate;
  ```
  `wait()` resolves immediately on its first call and thereafter sleeps exactly long enough that consecutive resolutions are at least `intervalMs` apart. `runSync` creates ONE gate and threads it through every request in that invocation.

- [ ] **Step 1: Write the failing test in `src/monobank/throttle.test.ts`**

```ts
describe('createRequestGate', () => {
  const makeClock = (start: number) => {
    let current = start;

    return {
      now: () => current,
      sleep: jest.fn(async (ms: number) => {
        current += ms;
      }),
      advance: (ms: number) => {
        current += ms;
      },
    };
  };

  it('does not sleep before the first request', async () => {
    const clock = makeClock(0);
    const gate = createRequestGate({ intervalMs: 60_000, now: clock.now, sleep: clock.sleep });

    await gate.wait();

    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it('sleeps the full interval between two back-to-back requests', async () => {
    const clock = makeClock(0);
    const gate = createRequestGate({ intervalMs: 60_000, now: clock.now, sleep: clock.sleep });

    await gate.wait();
    await gate.wait();

    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenCalledWith(60_000);
  });

  it('sleeps only the remainder when time has already passed', async () => {
    const clock = makeClock(0);
    const gate = createRequestGate({ intervalMs: 60_000, now: clock.now, sleep: clock.sleep });

    await gate.wait();
    clock.advance(45_000);
    await gate.wait();

    expect(clock.sleep).toHaveBeenCalledWith(15_000);
  });

  it('does not sleep when the interval has fully elapsed', async () => {
    const clock = makeClock(0);
    const gate = createRequestGate({ intervalMs: 60_000, now: clock.now, sleep: clock.sleep });

    await gate.wait();
    clock.advance(60_001);
    await gate.wait();

    expect(clock.sleep).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing test in `src/monobank/sync.test.ts`**

`makeInMemoryDeps` already exposes the `sleep` spy — read it, then add:

```ts
it('throttles across accounts: one 60 s sleep between two cards', async () => {
  const deps = makeInMemoryDeps({
    // Two cards, each returning a single (sub-cap) statement page, so each
    // card makes exactly one statement request.
    clientInfo: { accounts: [card('acc-a'), card('acc-b')] },
    statementFor: () => [statementItem()],
  });

  await runSync(deps);

  // 3 requests total: client-info, card A's statement, card B's statement.
  // Two gaps between them, both throttled.
  expect(deps.sleep.mock.calls.map(([ms]) => ms)).toEqual([60_000, 60_000]);
});

it('routes fetchClientInfo through the same gate', async () => {
  const deps = makeInMemoryDeps({
    clientInfo: { accounts: [card('acc-a')] },
    statementFor: () => [statementItem()],
  });

  await runSync(deps);

  expect(deps.sleep).toHaveBeenCalledTimes(1);
});
```

Read `sync.test.ts`'s existing fixture helpers for their real names (`card`, `statementItem` above are placeholders) and reuse them.

- [ ] **Step 3: Run both and confirm the failures**

```bash
npx jest src/monobank/throttle.test.ts src/monobank/sync.test.ts
```

Expected: `throttle.test.ts` fails to resolve the module; the two-card sync test finds `sleep.mock.calls.length === 0`.

- [ ] **Step 4: Write `src/monobank/throttle.ts`**

```ts
/**
 * A single-slot request gate: `wait()` resolves immediately the first time and
 * thereafter only once `intervalMs` has elapsed since the previous resolution.
 *
 * WHY THIS EXISTS: Monobank's personal API allows at most one request per 60
 * seconds PER TOKEN, not per call site. The throttle used to be a local
 * `isFirstRequest` flag inside one `fetchAllStatements` invocation, so a
 * second card's first statement request fired with zero delay — a 429 that
 * propagated out of `runSync`, left `setLastSyncAt` unwritten, and stopped
 * every card after the first from importing at all. One gate, created once per
 * `runSync` and threaded through EVERY request in that invocation (including
 * `fetchClientInfo`), is the only shape that respects a per-token limit.
 *
 * `now` and `sleep` are injected so tests run instantly against a fake clock.
 */
export type RequestGate = { wait: () => Promise<void> };

export const createRequestGate = (input: {
  intervalMs: number;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}): RequestGate => {
  let lastRequestAt: number | null = null;

  return {
    wait: async (): Promise<void> => {
      if (lastRequestAt !== null) {
        const remaining = input.intervalMs - (input.now() - lastRequestAt);

        if (remaining > 0) {
          await input.sleep(remaining);
        }
      }

      lastRequestAt = input.now();
    },
  };
};
```

- [ ] **Step 5: Thread the gate through `sync.ts`**

1. Import `createRequestGate` and `type RequestGate`.
2. In `runSync` (`src/monobank/sync.ts:291`), create the gate right after `deps` is composed and before the first network call:
   ```ts
   // ONE gate for this whole invocation: Monobank's 1-req/60s limit is per
   // TOKEN, so client-info and every card's statement pages share it.
   const gate = createRequestGate({
     intervalMs: RATE_LIMIT_MS,
     now: deps.now,
     sleep: deps.sleep,
   });
   ```
3. Wrap `fetchClientInfo` at `:303`:
   ```ts
   await gate.wait();
   const { accounts, jars } = await deps.fetchClientInfo(token, deps.fetchImpl);
   ```
4. Pass `gate` down through `importAccount` into `fetchAllStatements`, adding it as a parameter to both. In `fetchAllStatements` (`:226-254`), delete the `isFirstRequest` local (`:234`) and the `if (!isFirstRequest) { await deps.sleep(RATE_LIMIT_MS); } isFirstRequest = false;` block (`:238-241`), replacing them with a single `await gate.wait();` immediately before `deps.fetchStatement`.
5. Update `fetchAllStatements`' doc comment (`:218-225`) — it currently says the function honours the rate limit itself; it now honours a caller-supplied gate.

Do **not** add the gate to `SyncDeps`. It is constructed from `deps.now`/`deps.sleep`, which are already injectable, so tests need no new seam; adding a `gate` dep would let a test accidentally share one gate across two `runSync` calls.

- [ ] **Step 6: Run green, then the whole sync surface**

```bash
npx jest src/monobank src/screens/use-sync.test.ts src/screens/use-auto-sync.test.ts
npm run check:typecheck
```

Expected: PASS. A pre-existing test asserting `sleep` was called zero times for a single-page single-card sync now sees one call (the client-info gap) — that is the fix, update the expectation.

---

## Task 8: T-6 — Give exchange legs a structural marker, exclude them from spending, and resolve their label at render time

**Confidence: CONFIRMED.**

`recordExchange` (`src/repositories/transactions.repo.ts:136-170`) writes the source leg as a plain manual negative transaction with `category` null, `mcc` null, and description `` `Exchange to ${input.destinationName}` `` (`:146`) — hard-coded English, **persisted**, so a later language switch does not fix it. `recordExchangeCounterpart` (`:171-232`) does the same at `:204` and `:214`. No exclusion rule matches: `isMccExcludedTransfer` bails on a null `mcc` (`transfer-exclusion.ts:36-38`), the description patterns are Ukrainian only (`:64-68`), and `internalTransfers`' `isMatchingCredit` requires the same currency, which a cross-currency exchange never satisfies. Converting 10,000 UAH → USD shows a 10,000 UAH expense bucketed under "Other". Executed evidence: `excludedIds` is `[]` and the donut is `[{key:"other", amount:1000000, share:1}]`. A same-currency exchange into a `term_deposit` leaks identically (the destination writes a metadata contribution, no credit row, so only the debit leg exists and nothing cancels it).

**Chosen marker: one new nullable column, `transactions.exchange_counterpart_holding_id`.** Why this and not the alternatives:

- A **metadata key is not available** — `transactions` has no metadata/JSON column (`src/db/schema.ts:39-67`). So the "no migration" option the coordinator floated does not exist for this table; a column is the minimum.
- A **reserved category key** (e.g. `category = '__exchange'`) needs no migration but is not durable: the transaction form's category picker and override sheet both write `transactions.category`, and Task 6's normalization pass rewrites it, so the marker could be silently destroyed by ordinary user action. A marker that a user can overwrite is not structural.
- A **shared correlation id in `externalId`** is impossible: `uniqueIndex('transactions_source_external')` is on `(source, external_id)`, and both legs are `source: 'manual'`, so two legs sharing one id would violate the index.
- The counterpart **holding id** (rather than a bare boolean or the counterpart's name) is what makes one column serve **both** readers: exclusion needs only "is it non-null?", and display resolution needs the counterpart's name plus a direction — the id resolves the *current* name from the holdings live query every screen already runs (so a rename follows automatically), and the direction comes from the amount's sign, exactly as `defaultTransactionDescription` (`src/transactions/default-description.ts:12-23`) already derives income/expense from the sign.

**Files:**
- Modify: `src/db/schema.ts:39-67` (new column)
- Create: `drizzle/migrations/0015_<generated>.sql` + `meta/0015_snapshot.json` (via `drizzle-kit generate`)
- Modify: `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js`
- Modify: `src/repositories/transactions.repo.ts:56-86` (`recordManualTx`), `:136-170` (`recordExchange`), `:171-232` (`recordExchangeCounterpart`), `:96-115` (`listAllWithContextQuery`)
- Create: `src/statistics/exchange-exclusion.ts`, `src/transactions/exchange-description.ts`
- Modify: `src/screens/statistics/statistics.screen.tsx` (union the new exclusion set), `src/screens/home/home.screen.tsx:336-337` (resolve the label), `src/screens/holding-detail/holding-detail.screen.tsx:340` (same)
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts`
- Test: `src/statistics/exchange-exclusion.test.ts`, `src/transactions/exchange-description.test.ts`, `src/repositories/transactions.repo.test.ts`, `src/screens/statistics/statistics.screen.test.tsx`, `src/screens/home/home.screen.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // src/db/schema.ts — transactions
  exchangeCounterpartHoldingId: text('exchange_counterpart_holding_id')

  // src/statistics/exchange-exclusion.ts
  export const exchangeExcludedTxIds = (
    transactions: readonly { id: string; exchangeCounterpartHoldingId: string | null }[],
  ): Set<string>;

  // src/transactions/exchange-description.ts
  export const exchangeLegDescription = (input: {
    counterpartName: string;
    amountMinorUnits: number;
    t: TFunction;
  }): string;
  ```
  New catalogue keys: `transactions.exchangeTo` (`'Exchange to {{name}}'`) and `transactions.exchangeFrom` (`'Exchange from {{name}}'`), plus their `uk` counterparts.

- [ ] **Step 1: Write the failing test in `src/statistics/exchange-exclusion.test.ts`**

```ts
describe('exchangeExcludedTxIds', () => {
  it('excludes both legs of a cross-currency exchange', () => {
    const ids = exchangeExcludedTxIds([
      { id: 'out', exchangeCounterpartHoldingId: 'h-usd' },
      { id: 'in', exchangeCounterpartHoldingId: 'h-uah' },
      { id: 'groceries', exchangeCounterpartHoldingId: null },
    ]);

    expect(ids).toEqual(new Set(['out', 'in']));
  });

  it('excludes a single-legged exchange into a term deposit', () => {
    // A term_deposit destination writes a metadata contribution, not a credit
    // row, so only the debit leg exists — nothing cancels it.
    expect(exchangeExcludedTxIds([{ id: 'out', exchangeCounterpartHoldingId: 'h-dep' }])).toEqual(
      new Set(['out']),
    );
  });

  it('returns an empty set for an ordinary ledger', () => {
    expect(exchangeExcludedTxIds([{ id: 'a', exchangeCounterpartHoldingId: null }]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Write the failing test in `src/transactions/exchange-description.test.ts`**

```ts
describe('exchangeLegDescription', () => {
  it('reads "to" for a negative (outgoing) leg', () => {
    expect(
      exchangeLegDescription({ counterpartName: 'Savings', amountMinorUnits: -1_000_000, t }),
    ).toBe('Exchange to Savings');
  });

  it('reads "from" for a positive (incoming) leg', () => {
    expect(
      exchangeLegDescription({ counterpartName: 'Black card', amountMinorUnits: 24_000, t }),
    ).toBe('Exchange from Black card');
  });

  it('resolves against the active language, not a persisted string', async () => {
    await i18n.changeLanguage('uk');

    expect(
      exchangeLegDescription({ counterpartName: 'Ощадний', amountMinorUnits: -1_000_000, t: i18n.t }),
    ).toBe(i18n.t('transactions.exchangeTo', { name: 'Ощадний' }));

    await i18n.changeLanguage('en');
  });
});
```

- [ ] **Step 3: Write the failing tests in `src/repositories/transactions.repo.test.ts`**

```ts
it('marks both exchange legs with each other holding and persists no English text', async () => {
  await transactionsRepo.recordExchange({
    sourceHoldingId: 'h-uah',
    sourceName: 'Black card',
    valueOutMinorUnits: 1_000_000,
    destinationHoldingId: 'h-usd',
    destinationName: 'Savings',
    destinationType: 'cash',
    valueInMinorUnits: 24_000,
    time: 1_700_000_000_000,
  });

  const rows = await listTransactions();
  const out = rows.find((row) => row.holdingId === 'h-uah');
  const income = rows.find((row) => row.holdingId === 'h-usd');

  expect(out?.exchangeCounterpartHoldingId).toBe('h-usd');
  expect(income?.exchangeCounterpartHoldingId).toBe('h-uah');
  expect(out?.description).toBe('');
  expect(income?.description).toBe('');
});

it('marks the single leg of a term-deposit exchange', async () => {
  await transactionsRepo.recordExchange({
    /* ...same shape, destinationType: 'term_deposit', destinationHoldingId: 'h-dep' */
  });

  const rows = await listTransactions();

  expect(rows).toHaveLength(1);
  expect(rows[0].exchangeCounterpartHoldingId).toBe('h-dep');
});

it('marks a convert counterpart leg', async () => {
  await transactionsRepo.recordExchangeCounterpart({
    direction: 'record-destination',
    counterpartHoldingId: 'h-usd',
    counterpartType: 'cash',
    amountMinorUnits: 24_000,
    existingHoldingName: 'Black card',
    existingHoldingId: 'h-uah',
    time: 1_700_000_000_000,
  });

  expect((await listTransactions())[0].exchangeCounterpartHoldingId).toBe('h-uah');
});
```

Note the third test passes a **new** `existingHoldingId` field on `ExchangeCounterpartInput` — see Step 7.

- [ ] **Step 4: Write the failing screen tests**

`src/screens/statistics/statistics.screen.test.tsx`:

```tsx
it('renders no category wedge for a cross-currency exchange pair', async () => {
  mockTransactions = [
    makeRow({ id: 'out', holdingId: 'h-uah', amountMinorUnits: -1_000_000, exchangeCounterpartHoldingId: 'h-usd' }),
    makeRow({ id: 'in', holdingId: 'h-usd', amountMinorUnits: 24_000, exchangeCounterpartHoldingId: 'h-uah' }),
  ];

  const { queryByTestId } = await renderScreen();

  expect(queryByTestId('category-donut-slice-other')).toBeNull();
});
```

`src/screens/home/home.screen.test.tsx`:

```tsx
it('renders an exchange leg in the active language', async () => {
  await i18n.changeLanguage('uk');
  mockTransactions = [
    makeRow({ id: 'out', amountMinorUnits: -1_000_000, description: '', exchangeCounterpartHoldingId: 'h-usd' }),
  ];
  mockHoldings = [{ id: 'h-usd', name: 'Ощадний', currency: 'USD' }];

  const { getByText } = await renderScreen();

  expect(getByText(i18n.t('transactions.exchangeTo', { name: 'Ощадний' }))).toBeTruthy();
  await i18n.changeLanguage('en');
});
```

Read each file's real fixture-builder and donut-slice testID before writing these.

- [ ] **Step 5: Run all five and confirm the failures**

```bash
npx jest src/statistics/exchange-exclusion.test.ts src/transactions/exchange-description.test.ts src/repositories/transactions.repo.test.ts src/screens/statistics/statistics.screen.test.tsx src/screens/home/home.screen.test.tsx
```

Expected: the two new modules do not resolve; the repo tests fail because the column does not exist; the statistics test finds an "Other" wedge; the Home test finds the English `"Exchange to Ощадний"` string rendered verbatim.

- [ ] **Step 6: Add the column and generate the migration**

In `src/db/schema.ts`'s `transactions` table, add the column after `counterIban` (`:56`):

```ts
    // Set on BOTH legs of an Exchange/Convert to the OTHER leg's holding id
    // (and on the single debit leg of an exchange into a term deposit, which
    // writes a metadata contribution rather than a credit row). This is the
    // DURABLE structural marker that an exchange leg is an internal money
    // movement, not spending — see statistics/exchange-exclusion.ts. It is a
    // column and not a reserved `category` value because the category picker
    // and the override sheet both rewrite `category`, so a marker there could
    // be destroyed by ordinary user action; and not a shared id in
    // `externalId` because `(source, external_id)` is unique and both legs are
    // `source: 'manual'`. Storing the counterpart's ID (not its name) also
    // lets the display layer resolve the CURRENT name at render time through
    // `t`, so no English sentence is ever persisted and a rename follows.
    exchangeCounterpartHoldingId: text('exchange_counterpart_holding_id'),
```

Then generate:

```bash
npx drizzle-kit generate
```

This writes `drizzle/migrations/0015_<name>.sql`, `meta/0015_snapshot.json` and the journal entry. Read the generated SQL and confirm it is a plain `ALTER TABLE \`transactions\` ADD \`exchange_counterpart_holding_id\` text;`. Then hand-add the import + object entry to `drizzle/migrations/migrations.js` (drizzle-kit does not maintain that file):

```js
import m0015 from './0015_<name>.sql';
```

`driver: 'expo'` in `drizzle.config.ts` is correct for op-sqlite despite the name (`kiko-architecture`). Migration 0014 is data-only and has no snapshot, so drizzle-kit diffs 0015 against `0013_snapshot.json` — that is correct, since 0014 changed no schema.

- [ ] **Step 7: Write the marker on both legs**

In `src/repositories/transactions.repo.ts`:

1. Widen `ManualTransaction` (`:31-32`) to carry the marker:
   ```ts
   type ManualTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time'> &
     Partial<Pick<TransactionRow, 'description' | 'exchangeCounterpartHoldingId'>>;
   ```
2. In `recordManualTx` (`:62-86`), destructure and insert it:
   ```ts
   const recordManualTx = async (
     tx: typeof database,
     {
       holdingId,
       amountMinorUnits,
       time,
       description,
       exchangeCounterpartHoldingId,
     }: ManualTransaction,
   ): Promise<void> => {
     await tx.insert(transactions).values({
       id: id(),
       holdingId,
       amountMinorUnits,
       time,
       description: description ?? '',
       exchangeCounterpartHoldingId: exchangeCounterpartHoldingId ?? null,
       source: 'manual',
     });
   ```
3. In `recordExchange` (`:141-169`), replace both English descriptions with the marker:
   ```ts
         await recordManualTx(tx, {
           holdingId: input.sourceHoldingId,
           amountMinorUnits: -input.valueOutMinorUnits,
           time: input.time,
           // No description is persisted: the label is resolved at render time
           // from this marker + the counterpart's CURRENT name via `t` (see
           // transactions/exchange-description.ts). A persisted
           // `Exchange to <name>` string was English forever and went stale on
           // a rename.
           exchangeCounterpartHoldingId: input.destinationHoldingId,
         });
   ```
   and for the `'plain'` destination branch, `exchangeCounterpartHoldingId: input.sourceHoldingId`. The `'contribution'` branch writes no transaction row — leave it, the source leg's marker is enough. Update `recordExchange`'s doc comment (`:126-135`): the legs are tied by the marker column now, not "only by their descriptions".
4. In `recordExchangeCounterpart` (`:171-232`), add `existingHoldingId: string` to `ExchangeCounterpartInput` (`:48-55`) and set `exchangeCounterpartHoldingId: input.existingHoldingId` on both `recordManualTx` calls (`:200-207`, `:210-217`), dropping the two English descriptions. Keep `existingHoldingName` in the input type only if another reader still needs it; if `tsc` reports it unused after this change, remove it from the type and from the two call sites in `transaction-form.screen.tsx`.
5. In `listAllWithContextQuery` (`:96-115`), add `exchangeCounterpartHoldingId: transactions.exchangeCounterpartHoldingId,` to the projection so Home and the exclusion rule can read it.

- [ ] **Step 8: Write `src/statistics/exchange-exclusion.ts`**

```ts
/**
 * The ids of every transaction that is one leg of an Exchange/Convert — an
 * internal money movement between two of the user's own holdings, never
 * spending. Unioned by the caller with the mcc/IBAN ids, the description ids
 * and the matched-pair ids.
 *
 * Keyed on the structural `exchangeCounterpartHoldingId` marker
 * (`transactions.exchange_counterpart_holding_id`), so it catches what no
 * other rule can: the debit leg carries a null `mcc` (the mcc rule bails), an
 * empty description (the description patterns are Ukrainian merchant
 * wordings), and a DIFFERENT currency from its credit leg (the matched-pair
 * matcher requires the same currency). It also catches the single-legged case
 * — an exchange into a term deposit writes a metadata contribution instead of
 * a credit row, so there is no counterpart row to pair against at all.
 */
export const exchangeExcludedTxIds = (
  transactions: readonly { id: string; exchangeCounterpartHoldingId: string | null }[],
): Set<string> => {
  const ids = new Set<string>();

  for (const transaction of transactions) {
    if (transaction.exchangeCounterpartHoldingId !== null) {
      ids.add(transaction.id);
    }
  }

  return ids;
};
```

- [ ] **Step 9: Write `src/transactions/exchange-description.ts`**

```ts
import type { TFunction } from 'i18next';

/**
 * The label for an Exchange/Convert leg, resolved at RENDER time. Direction
 * comes from the amount's sign — a negative leg paid money OUT to the
 * counterpart ("Exchange to X"), a positive one received it ("Exchange from
 * X") — the same sign-as-source-of-truth rule
 * `defaultTransactionDescription` uses. The name comes from the counterpart
 * holding's CURRENT row, looked up by the stored
 * `exchangeCounterpartHoldingId`, so a rename flows through with no write.
 *
 * Nothing is persisted: the repo used to store a literal
 * `Exchange to <name>`, which stayed English after a language switch and went
 * stale after a rename.
 */
export const exchangeLegDescription = (input: {
  counterpartName: string;
  amountMinorUnits: number;
  t: TFunction;
}): string => {
  const key =
    input.amountMinorUnits < 0 ? 'transactions.exchangeTo' : 'transactions.exchangeFrom';

  return input.t(key, { name: input.counterpartName });
};
```

- [ ] **Step 10: Add the catalogue keys to BOTH locales**

`src/i18n/locales/en.ts`, in the existing `transactions` block (`:338-341`):

```ts
  transactions: {
    defaultDescriptionExpense: '{{name}} expense',
    defaultDescriptionIncome: '{{name}} income',
    exchangeFrom: 'Exchange from {{name}}',
    exchangeTo: 'Exchange to {{name}}',
  },
```

`src/i18n/locales/uk.ts`, same block, same key order:

```ts
    exchangeFrom: 'Обмін з {{name}}',
    exchangeTo: 'Обмін на {{name}}',
```

Both catalogues must carry the identical key set and identical `{{name}}` placeholder, or `tsc` (via `i18next.d.ts`) fails.

- [ ] **Step 11: Union the new rule into the Statistics exclusion set**

In `src/screens/statistics/statistics.screen.tsx`:

1. `BreakdownTransaction` (`src/statistics/category-breakdown.ts:17-22`) must carry the marker — add `'exchangeCounterpartHoldingId'` to its `Pick<TransactionRow, ...>` list.
2. Add it to the `breakdownTransactions` projection memo (around `:369-382`).
3. Add a memo next to `descriptionExcludedIds`:
   ```tsx
   // Exchange/Convert legs: an internal movement between the user's own
   // holdings, structurally marked by `exchangeCounterpartHoldingId`. No other
   // rule can see them — null mcc, empty description, and a cross-currency
   // pair the matched-pair matcher rejects.
   const exchangeExcludedIds = useMemo(
     () => exchangeExcludedTxIds(breakdownTransactions),
     [breakdownTransactions],
   );
   ```
4. Add it to the `excludedTransactionIds` union (`:404-407`) and its dependency array.

- [ ] **Step 12: Resolve the label at render time in the two list screens**

`src/screens/home/home.screen.tsx` — the screen already has a `holdings` live query (`:153`). Build a name map next to the other derived maps and use it in `renderTransaction` (`:336-337`):

```tsx
  // Counterpart holding names, so an Exchange/Convert leg's label resolves to
  // the counterpart's CURRENT name in the ACTIVE language (nothing is
  // persisted — see transactions/exchange-description.ts).
  const holdingNameById = new Map(holdings.map((holding) => [holding.id, holding.name]));
```

```tsx
    const description =
      item.description ||
      (item.exchangeCounterpartHoldingId !== null
        ? exchangeLegDescription({
            counterpartName: holdingNameById.get(item.exchangeCounterpartHoldingId) ?? '',
            amountMinorUnits: item.amountMinorUnits,
            t,
          })
        : defaultTransactionDescription(item.holdingName, item.amountMinorUnits, t));
```

If that ternary pushes `renderTransaction` past Biome's `noExcessiveCognitiveComplexity` cap of 15, extract a module-level helper `resolveRowDescription({ row, holdingNameById, t })` — do not suppress the rule.

Apply the same resolution at `src/screens/holding-detail/holding-detail.screen.tsx:340`, where `defaultTransactionDescription` is already called.

- [ ] **Step 13: Fix the two form call sites**

`src/screens/forms/transaction-form.screen.tsx`: `saveExchange` (`:791-800`) already passes `sourceHoldingId`/`destinationHoldingId`, so nothing changes there beyond removing `sourceName`/`destinationName` if `tsc` says `ExchangeInput` no longer needs them. `saveConvert` (`:824-831`) must now pass `existingHoldingId: holding?.id ?? ''` — read the surrounding code for the correct local. Follow `tsc` here; do not guess.

- [ ] **Step 14: Backfill the existing English-described legs (data migration)**

The English descriptions the old code persisted are the exact strings this codebase wrote, so a targeted backfill is safe and removes the reported symptom from real data. Append these statements to the generated `0015_<name>.sql` (they belong in the same migration as the column they populate):

```sql
--> statement-breakpoint
/*
 Backfill the new marker for legs written by the pre-marker build, which
 persisted a literal English description. Match the counterpart holding by the
 name embedded in that description. `LIMIT 1` resolves an ambiguous duplicate
 holding name arbitrarily — accepted deliberately: the worst case is a wrong
 DISPLAY name on a historical row, while the money-correctness effect (the leg
 being excluded from the spending donut) is right either way, because the
 marker is non-null in both cases. A row whose name matches nothing keeps its
 legacy description and stays visible as before.
*/
UPDATE `transactions`
SET `exchange_counterpart_holding_id` = (
  SELECT `h`.`id` FROM `holdings` AS `h`
  WHERE `h`.`name` = substr(`transactions`.`description`, length('Exchange to ') + 1)
  LIMIT 1
),
`description` = ''
WHERE `source` = 'manual'
  AND `exchange_counterpart_holding_id` IS NULL
  AND `description` LIKE 'Exchange to %'
  AND EXISTS (
    SELECT 1 FROM `holdings` AS `h`
    WHERE `h`.`name` = substr(`transactions`.`description`, length('Exchange to ') + 1)
  );--> statement-breakpoint
UPDATE `transactions`
SET `exchange_counterpart_holding_id` = (
  SELECT `h`.`id` FROM `holdings` AS `h`
  WHERE `h`.`name` = substr(`transactions`.`description`, length('Exchange from ') + 1)
  LIMIT 1
),
`description` = ''
WHERE `source` = 'manual'
  AND `exchange_counterpart_holding_id` IS NULL
  AND `description` LIKE 'Exchange from %'
  AND EXISTS (
    SELECT 1 FROM `holdings` AS `h`
    WHERE `h`.`name` = substr(`transactions`.`description`, length('Exchange from ') + 1)
  );
```

Add a registration assertion alongside Task 6's:

```ts
it('adds and backfills the exchange marker in a registered migration', () => {
  const combined = sqlFiles().join('\n');

  expect(combined).toContain('`exchange_counterpart_holding_id`');
  expect(combined).toContain("LIKE 'Exchange to %'");
  expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain('0015');
});
```

- [ ] **Step 15: Run everything green**

```bash
npx jest src/statistics src/transactions src/repositories src/screens/statistics src/screens/home src/screens/holding-detail src/screens/forms src/db src/i18n
npm run check:typecheck
```

Expected: PASS. `transfer-exclusion.test.ts` and `internal-transfers.test.ts` should be untouched — the new rule is additive, and neither of those was ever catching these rows.

---

## Task 9: T-7 — Persist the picked category on the transaction row itself

**Confidence: CONFIRMED.**

`recordManualTx` (`src/repositories/transactions.repo.ts:62-86`) inserts only `{id, holdingId, amountMinorUnits, time, description, source}` — `ManualTransaction` (`:31-32`) has no category field. The only path that ever sets `transactions.category` is `upsertCategoryOverride` (`src/repositories/category-overrides.repo.ts:21-50`), which **returns early** at `:25-27` when `normalizeTransactionName(name) === ''`. Meanwhile `isSaveDisabled` (`transaction-form.screen.tsx:156-168`) forces the user to pick a category on create. So the pick is silently dropped whenever either (a) the description is blank — the override key is `''`, nothing is persisted, and the confirm sheet even reads `Apply "Groceries" to all transactions named ""?`, or (b) the user taps Cancel on the override sheet, since `cancelOverride` (`:750-753`) just calls `goBack()` with the row already written uncategorised.

**Files:**
- Modify: `src/repositories/transactions.repo.ts:31-32` (`ManualTransaction`), `:62-86` (`recordManualTx`)
- Modify: `src/screens/forms/transaction-form.screen.tsx:717-734` (`writeManual`), `:850-879` (`save`)
- Test: `src/repositories/transactions.repo.test.ts`, `src/screens/forms/transaction-form.screen.test.tsx`

**Interfaces:**
- Consumes: `ManualTransaction` as widened by Task 8 (it now carries `exchangeCounterpartHoldingId`). This task adds `category` to the same `Partial<Pick<...>>`.
- Produces: `transactionsRepo.recordManual({ ..., category })` writes `transactions.category` directly. The override sheet governs only *propagation to same-name rows*, never whether this row is categorised.

- [ ] **Step 1: Write the failing test in `src/screens/forms/transaction-form.screen.test.tsx`**

```tsx
it('writes the picked category onto the row even with a blank description', async () => {
  const { getByLabelText, getByText } = await renderAddMode();

  await fireEvent.changeText(getByLabelText('Amount'), '12.34');
  await fireEvent.press(getByText('Groceries'));
  await fireEvent.press(getByText('Save'));

  expect(mockRecordManual).toHaveBeenCalledWith(
    expect.objectContaining({ category: 'groceries', description: '' }),
  );
});

it('skips the override sheet entirely when the description is blank', async () => {
  const { getByLabelText, getByText, queryByText } = await renderAddMode();

  await fireEvent.changeText(getByLabelText('Amount'), '12.34');
  await fireEvent.press(getByText('Groceries'));
  await fireEvent.press(getByText('Save'));

  expect(queryByText(/Apply/)).toBeNull();
  expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
  expect(mockGoBack).toHaveBeenCalled();
});

it('keeps the row categorised when the user cancels the override sheet', async () => {
  const { getByLabelText, getByText } = await renderAddMode();

  await fireEvent.changeText(getByLabelText('Amount'), '12.34');
  await fireEvent.changeText(getByLabelText('Description'), 'ATB');
  await fireEvent.press(getByText('Groceries'));
  await fireEvent.press(getByText('Save'));
  await fireEvent.press(getByText('Cancel'));

  expect(mockRecordManual).toHaveBeenCalledWith(
    expect.objectContaining({ category: 'groceries' }),
  );
  expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
});
```

Read the file's existing render helper and mock names (`:188` already picks a category but asserts only `holdingId`/`amountMinorUnits`/`description`) and reuse them.

- [ ] **Step 2: Write the failing test in `src/repositories/transactions.repo.test.ts`**

```ts
it('persists the category on a manual row', async () => {
  await transactionsRepo.recordManual({
    holdingId: 'h-1',
    amountMinorUnits: -1234,
    time: 1_700_000_000_000,
    description: '',
    category: 'groceries',
  });

  expect((await listTransactions())[0].category).toBe('groceries');
});

it('writes a null category when none is given', async () => {
  await transactionsRepo.recordManual({
    holdingId: 'h-1',
    amountMinorUnits: -1234,
    time: 1_700_000_000_000,
  });

  expect((await listTransactions())[0].category).toBeNull();
});
```

- [ ] **Step 3: Run both and confirm the failures**

```bash
npx jest src/screens/forms/transaction-form.screen.test.tsx src/repositories/transactions.repo.test.ts
```

Expected: `mockRecordManual` is called without a `category` key; the repo test fails to compile (`category` is not in `ManualTransaction`).

- [ ] **Step 4: Carry the category through the repo**

`src/repositories/transactions.repo.ts:31-32`:

```ts
type ManualTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time'> &
  Partial<Pick<TransactionRow, 'description' | 'category' | 'exchangeCounterpartHoldingId'>>;
```

In `recordManualTx`, destructure `category` and insert `category: category ?? null`. Add to the function's doc comment: the row carries its own category so a picked category is never lost; the override rule governs only propagation to same-name rows.

- [ ] **Step 5: Pass the picked category from the form**

In `src/screens/forms/transaction-form.screen.tsx`, `writeManual` (`:717-734`) — add the category to the create branch:

```tsx
    if (holdingId) {
      await transactionsRepo.recordManual({
        holdingId,
        amountMinorUnits,
        time,
        description,
        // The row carries its OWN category. The override sheet below governs
        // only whether the pick ALSO propagates to every same-name row; it is
        // not what categorises this row. Previously the pick was persisted
        // only through the override rule, which returns early on a blank
        // normalized name — so a blank-description row (and any row whose
        // override the user cancelled) was written uncategorised despite
        // `isSaveDisabled` forcing a pick.
        category: selectedCategory,
      });
    }
```

Leave the `editingId` branch alone: `transactionsRepo.update` deliberately handles only amount/time/description with its own balance-delta logic, and an *edit's* category change still routes through the always-propagating override path. If a reviewer wants edit-mode parity, that is a separate change.

- [ ] **Step 6: Skip the override sheet when the normalized description is empty**

In `save` (`:850-879`), the category-confirm branch currently reads:

```tsx
    if (categoryChanged && selectedCategory !== null) {
      const name = isReadOnly ? (existing?.description ?? '') : description;
      setPendingOverride({ name, category: selectedCategory });

      return;
    }
```

Gate it on a non-empty normalized name:

```tsx
    if (categoryChanged && selectedCategory !== null) {
      // The rule keys on the synced row's own description (read-only) or the
      // just-saved manual description.
      const name = isReadOnly ? (existing?.description ?? '') : description;

      // A blank/whitespace-only name normalizes to '', which
      // `upsertCategoryOverride` refuses (it must not create a catch-all
      // rule). Showing the sheet for it asked the user to confirm
      // `Apply "Groceries" to all transactions named ""?` and then wrote
      // nothing — the row's own category above is already persisted, so just
      // return to the list.
      if (normalizeTransactionName(name) !== '') {
        setPendingOverride({ name, category: selectedCategory });

        return;
      }
    }
```

Import `normalizeTransactionName` from `../../transactions/normalize-name`.

- [ ] **Step 7: Run green**

```bash
npx jest src/screens/forms src/repositories/transactions.repo.test.ts src/screens/home src/screens/holding-detail
npm run check:typecheck
```

---

## Task 10: T-8 — Render a hydrated amount at the currency's scale instead of `String(number)`

**Confidence: CONFIRMED.**

Edit-form hydration converts minor units to a major string with `.toString()` and then groups it. Below 100 satoshis `String()` emits exponential notation and `groupAmount` (`src/screens/forms/amount-format.ts:33-34`) strips every non-digit from the no-separator branch: 50 sat → `5e-7` → `"57"`; 10 sat → `"17"`; 99 sat → `"9.97"`. Opening a 50-satoshi BTC transaction shows `57`; Save then stores `Money.fromMajor('BTC', 57)` = 5,700,000,000 sat and adjusts the holding balance by that delta.

Verified: `node -e "const g=(s)=>s.replace(/\s/g,'').replace(/\D/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,' ');console.log(String(50/1e8),'->',g(String(50/1e8)))"` prints `5e-7 -> 57`.

Affected hydration sites: `transaction-form.screen.tsx:221-231` (`toAmountFields`, the `.toString()` at `:228`), `:283-285` (`resolveConvertView`'s `fixedValue`, which calls `toAmountFields`), `:679-681` (the hydration effect); `holding-form.screen.tsx:288` (`openingBalance`), `:51-56` (`seedContributions`), `:61-70` (`seedBondFields`).

**Files:**
- Modify: `src/screens/forms/amount-format.ts`
- Modify: `src/screens/forms/transaction-form.screen.tsx:221-231`
- Modify: `src/screens/forms/holding-form.screen.tsx:51-70`, `:288`
- Test: `src/screens/forms/amount-format.test.ts`, `src/screens/forms/transaction-form.screen.test.tsx`, `src/screens/forms/holding-form.screen.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // src/screens/forms/amount-format.ts
  /** Render a stored minor-units amount as the plain major-unit string a text field shows. */
  export const majorAmountText = (currency: Currency, minorUnits: number): string;
  ```
  Fixed-decimal at `currencyScale[currency]`, trailing zeros trimmed, no exponent, no grouping (the caller pipes it through `groupAmount`). `groupAmount` additionally fails safe: an input it cannot parse as a decimal number returns `''` rather than a fabricated digit string.

- [ ] **Step 1: Write the failing tests in `src/screens/forms/amount-format.test.ts`**

```ts
describe('majorAmountText', () => {
  it('renders sub-1e-6 BTC amounts at full scale, never in exponent form', () => {
    expect(majorAmountText('BTC', 50)).toBe('0.0000005');
    expect(majorAmountText('BTC', 10)).toBe('0.0000001');
    expect(majorAmountText('BTC', 99)).toBe('0.00000099');
    expect(majorAmountText('BTC', 1)).toBe('0.00000001');
  });

  it('trims trailing zeros but keeps a meaningful fraction', () => {
    expect(majorAmountText('BTC', 100_000_000)).toBe('1');
    expect(majorAmountText('BTC', 150_000_000)).toBe('1.5');
    expect(majorAmountText('UAH', 123_456)).toBe('1234.56');
    expect(majorAmountText('UAH', 100)).toBe('1');
    expect(majorAmountText('UAH', 0)).toBe('0');
  });

  it('renders the unsigned magnitude (the sign chip carries polarity)', () => {
    expect(majorAmountText('UAH', -123_456)).toBe('1234.56');
  });
});

describe('groupAmount fail-safe', () => {
  it('never turns an exponent string into a fabricated digit run', () => {
    expect(groupAmount('5e-7')).not.toBe('57');
    expect(groupAmount('5e-7')).toBe('');
  });

  it('still round-trips ordinary typed input', () => {
    expect(groupAmount('1000000')).toBe('1 000 000');
    expect(groupAmount('12,')).toBe('12,');
    expect(groupAmount('007')).toBe('007');
    expect(groupAmount(',')).toBe(',');
    expect(groupAmount('-1234.5')).toBe('-1 234.5');
    expect(groupAmount('0.0000005')).toBe('0.0000005');
  });
});
```

- [ ] **Step 2: Write the failing test in `src/screens/forms/transaction-form.screen.test.tsx`**

```tsx
it('hydrates a 50-satoshi BTC transaction to 0.0000005, not 57', async () => {
  mockExisting = { id: 'tx-1', holdingId: 'h-btc', amountMinorUnits: -50, time: 0, description: '', source: 'manual' };
  mockHoldings = [{ id: 'h-btc', name: 'Wallet', currency: 'BTC', type: 'crypto_asset' }];

  const { getByLabelText } = await renderEditMode();

  expect(getByLabelText('Amount').props.value).toBe('0.0000005');
});
```

And in `src/screens/forms/holding-form.screen.test.tsx`:

```tsx
it('hydrates a dust BTC opening balance at full scale', async () => {
  mockEditingHolding = { id: 'h-btc', name: 'Wallet', type: 'crypto_asset', currency: 'BTC', balanceMinorUnits: 50, metadata: null };

  const { getByLabelText } = await renderEditMode();

  expect(getByLabelText('Opening balance').props.value).toBe('0.0000005');
});
```

Read each file for the real render helpers and field labels.

- [ ] **Step 3: Run them and confirm the failures**

```bash
npx jest src/screens/forms/amount-format.test.ts src/screens/forms/transaction-form.screen.test.tsx src/screens/forms/holding-form.screen.test.tsx
```

Expected: `majorAmountText` does not resolve; `groupAmount('5e-7')` returns `'57'`; both hydration tests read `'57'`.

- [ ] **Step 4: Add `majorAmountText` and make `groupAmount` fail safe**

In `src/screens/forms/amount-format.ts`:

```ts
import { currencyScale } from '../../currency/currency';
import type { Currency } from '../../currency/currency';

/**
 * Render a STORED minor-units amount as the plain major-unit string a text
 * field shows: fixed-decimal at the currency's own scale, trailing zeros
 * trimmed, unsigned (the form's sign chip carries polarity), never grouped
 * (the caller pipes this through `groupAmount`).
 *
 * WHY NOT `String(minor / factor)`: below 1e-6 JavaScript switches to
 * exponential notation, and `groupAmount`'s no-separator branch strips every
 * non-digit — so 50 satoshis hydrated as `5e-7` and rendered as `57`, which
 * Save then stored as 57 BTC (5,700,000,000 sat) and applied as a balance
 * delta. `toFixed(scale)` never emits an exponent.
 */
export const majorAmountText = (currency: Currency, minorUnits: number): string => {
  const scale = currencyScale[currency];
  const fixed = (Math.abs(minorUnits) / 10 ** scale).toFixed(scale);

  if (!fixed.includes('.')) {
    return fixed;
  }

  return fixed.replace(/0+$/, '').replace(/\.$/, '');
};
```

Read `src/currency/currency.ts` for the real export name of the scale map before writing the import — it is referenced as `currencyScale[currency]` at `transaction-form.screen.tsx:225`.

Then make `groupAmount`'s no-separator branch (`:33-35`) refuse input it cannot understand, instead of silently harvesting digits:

```ts
  // A value that is not a plain decimal number — an exponent (`5e-7`), a
  // stray letter, anything from a paste — is REFUSED rather than reduced to
  // its digits. The old `replace(/\D/g, '')` turned `5e-7` into `57`, a
  // fabricated amount seven orders of magnitude off, which Save then
  // persisted. An empty string leaves the field blank, which the save guards
  // already reject.
  if (/[^\d\s,.\-]/.test(compact)) {
    return '';
  }
```

Place this immediately after `const compact = ...` at `:19`. Keep the existing partial-input tolerance intact: `'12,'`, `'007'`, `','`, `'-1234.5'` must all still round-trip (the test in Step 1 pins them).

- [ ] **Step 5: Use it at every hydration site**

`src/screens/forms/transaction-form.screen.tsx:221-231`:

```tsx
const toAmountFields = (
  currency: Currency,
  amountMinorUnits: number,
): { amount: string; sign: Sign } => {
  return {
    amount: majorAmountText(currency, amountMinorUnits),
    sign: amountMinorUnits < 0 ? 'expense' : 'income',
  };
};
```

The `factor` local and the `currencyScale` import become unused — remove them if `tsc`/Biome says so. `resolveConvertView`'s `fixedValue` (`:283-285`) and the hydration effect (`:679-681`) both call `toAmountFields`, so they inherit the fix.

`src/screens/forms/holding-form.screen.tsx:288`:

```tsx
    setOpeningBalance(groupAmount(majorAmountText(holding.currency, holding.balanceMinorUnits)));
```

The `toMajor(...)` call there becomes unused at this site — check whether `toMajor` has other callers before removing its import. Apply the same substitution in `seedContributions` (`:51-56`) and `seedBondFields` (`:61-70`) wherever a stored minor-unit amount becomes a field string; read both helpers and replace each `String(toMajor(...))` with `majorAmountText(currency, minor)`.

- [ ] **Step 6: Run green**

```bash
npx jest src/screens/forms src/currency
npm run check:typecheck
```

---

## Task 11: T-9 — Guard every form's Save against a double tap

**Confidence: CONFIRMED.**

Each `save` is async and calls `navigation.goBack()` only **after** awaiting the write, so a second tap during that window re-reads the same component state and writes again. Double-tapping the contribution form appends the same `{amountMinorUnits, date}` twice via `appendDepositContribution`, doubling principal and every derived interest/tax line; the transaction form inserts two rows and adjusts the balance twice; the holding and account forms create two rows. `Button` (`src/design-system/components/button/button.component.tsx:35-51`) is a bare `Pressable` with no debounce. `grep -n "inFlight\|isSaving\|useRef" src/screens/forms/*.screen.tsx` finds no guard in any of the four forms. The canonical fix already exists in the codebase: the account-detail sync button's `inFlight` ref (`src/screens/account-detail/account-detail.screen.tsx:148-169`).

**Chosen approach: a shared submit hook, not four copies of the ref, and not a change to `Button`.** `Button` stays dumb — it is used for non-write actions (Cancel, Clear, Apply) where a debounce would be wrong, and a `Pressable`-level debounce would silently change every call site's behaviour. Four hand-rolled copies of the same ref+try/finally would risk jscpd's 5% threshold and drift. One hook, four call sites.

**Files:**
- Create: `src/screens/forms/use-submit-once.ts`
- Modify: `src/screens/forms/contribution-form.screen.tsx:50-73`
- Modify: `src/screens/forms/transaction-form.screen.tsx:850-879`, `:910`
- Modify: `src/screens/forms/holding-form.screen.tsx:417-478`
- Modify: `src/screens/forms/account-form.screen.tsx:103-156`
- Test: `src/screens/forms/use-submit-once.test.ts` plus one double-tap test per form

**Interfaces:**
- Produces:
  ```ts
  // src/screens/forms/use-submit-once.ts
  export const useSubmitOnce = (
    submit: () => Promise<void>,
  ): { onPress: () => void; isSubmitting: boolean };
  ```
  `onPress` is a no-op while a submit is in flight. `isSubmitting` is state (so the Button can render disabled); the in-flight decision itself is a **ref**, because two taps in the same tick both read the same pre-render state value and a state-only guard would let the second through.

- [ ] **Step 1: Write the failing test in `src/screens/forms/use-submit-once.test.ts`**

```ts
describe('useSubmitOnce', () => {
  it('runs the submit once for two synchronous presses', async () => {
    let resolveSubmit: () => void = () => {};
    const submit = jest.fn(() => new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    }));

    const { result } = renderHook(() => useSubmitOnce(submit));

    result.current.onPress();
    result.current.onPress();

    expect(submit).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSubmit();
    });
  });

  it('re-arms after the submit settles', async () => {
    const submit = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useSubmitOnce(submit));

    await act(async () => {
      result.current.onPress();
    });
    await act(async () => {
      result.current.onPress();
    });

    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('re-arms after the submit rejects', async () => {
    const submit = jest.fn(() => Promise.reject(new Error('nope')));
    const { result } = renderHook(() => useSubmitOnce(submit));

    await act(async () => {
      result.current.onPress();
    });

    expect(result.current.isSubmitting).toBe(false);
  });
});
```

Use whichever hook-testing entry point the project already uses (`renderHook` from `@testing-library/react-native`); read another hook test (`src/screens/use-sync.test.ts`, `src/auth/use-app-lock.test.ts`) for the established shape.

- [ ] **Step 2: Write the failing double-tap test in `src/screens/forms/contribution-form.screen.test.tsx`**

```tsx
it('appends one contribution for a double-tapped Save', async () => {
  const { getByLabelText, getByText } = await renderScreen();

  await fireEvent.changeText(getByLabelText('Amount'), '1000');

  const save = getByText('Save contribution');

  // Two presses with no await between them: the second must land while the
  // first write is still in flight, which is exactly the real double-tap.
  fireEvent.press(save);
  fireEvent.press(save);

  await waitFor(() => {
    expect(mockAppendDepositContribution).toHaveBeenCalledTimes(1);
  });
});
```

Add the equivalent to `transaction-form.screen.test.tsx` (`mockRecordManual` once), `holding-form.screen.test.tsx` (`mockCreate` once), and `account-form.screen.test.tsx` (`mockCreateCashAccount` once). Read each file for its real render helper, save-button label and mock names.

- [ ] **Step 3: Run all five and confirm the failures**

```bash
npx jest src/screens/forms
```

Expected: the hook module does not resolve; each double-tap test reports 2 calls.

- [ ] **Step 4: Write `src/screens/forms/use-submit-once.ts`**

```ts
import { useCallback, useRef, useState } from 'react';

/**
 * Runs an async submit at most once per in-flight period, and reports whether
 * one is running so the Save button can render disabled.
 *
 * WHY A REF AND NOT ONLY STATE: every form's `save` awaits its write before
 * calling `navigation.goBack()`, so a second tap inside that window re-reads
 * the same component state and writes again — a doubled deposit contribution
 * (principal AND every derived interest/tax line), a duplicate transaction
 * with the balance adjusted twice, a duplicate holding/account row. Two taps
 * in the same tick both observe the same pre-render `isSubmitting` value, so a
 * state-only guard lets the second through; the ref is read and written
 * synchronously and is what actually closes the window. `isSubmitting` state
 * exists only to drive the disabled prop.
 *
 * This is the account-detail sync button's `inFlight` ref pattern
 * (`src/screens/account-detail/account-detail.screen.tsx`), extracted so the
 * four forms share one implementation instead of four copies.
 */
export const useSubmitOnce = (
  submit: () => Promise<void>,
): { onPress: () => void; isSubmitting: boolean } => {
  const inFlight = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onPress = useCallback((): void => {
    if (inFlight.current) {
      return;
    }

    inFlight.current = true;
    setIsSubmitting(true);

    // The submit's own error handling stays where it is (each form shows its
    // own Alert or keeps its screen open), so this only has to re-arm.
    submit().finally(() => {
      inFlight.current = false;
      setIsSubmitting(false);
    });
  }, [submit]);

  return { onPress, isSubmitting };
};
```

Note: `submit().finally(...)` is a plain expression statement, not `void submit()` — `complexity.noVoid` is an error in this project. If Biome's `noFloatingPromises`-family rule objects, keep the statement and add the `OVERRIDE(...)` justification only as a last resort; prefer restructuring so `finally` returns the promise into a variable that is genuinely unused-by-design.

- [ ] **Step 5: Wire it into all four forms**

`src/screens/forms/contribution-form.screen.tsx` — keep `save` exactly as it is (its `try`/`catch` + `Alert` is the right shape for a UI handler per `kiko-code-style`) and wrap only the button:

```tsx
  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);
```

```tsx
    <Screen
      scroll
      footer={
        <Button onPress={onSave} disabled={isSubmitting}>
          {t('forms.contribution.save')}
        </Button>
      }
    >
```

Apply the same two edits to:
- `transaction-form.screen.tsx` — wrap `save`; the footer Button at `:910` already has `disabled={disableSave}`, so combine: `disabled={disableSave || isSubmitting}`.
- `holding-form.screen.tsx` — wrap `save`; the Button at `:478` has `disabled={!isValid}` → `disabled={!isValid || isSubmitting}`.
- `account-form.screen.tsx` — wrap `save`; the Button at `:156` has `disabled={!canSave}` → `disabled={!canSave || isSubmitting}`.

Do not change any `save` body. The guard is purely additive at the button boundary, which keeps each form's existing failure handling (and each form's existing tests) intact.

- [ ] **Step 6: Run green**

```bash
npx jest src/screens/forms
npm run check:typecheck
npm run check:dup
```

`check:dup` matters here specifically: confirm the four two-line wirings do not trip jscpd.

---

### CHECKPOINT after Task 11 — high tier complete

```bash
npm run check:all
npm run check:typecheck
npx jest
```

---

## Task 12: T-12 — Persist the queried window ceiling as `lastSyncAt`, not the clock at loop end

**Confidence: CONFIRMED.**

`runSync` captures the window ceiling `toSeconds` at `src/monobank/sync.ts:306` **before** the account loop, then persists `deps.now()` at `:324` — the clock at loop *end*. Every transaction that landed between those two instants is never queried again. One 500-item page (one 60 s sleep) leaves a ~60 s hole; after Task 7 that becomes N×60 s for N cards. The balance stays right (it is overwritten from `/client-info`), so the loss is silent: the ledger, the category donut and the reconstructed net-worth line are all quietly short.

**Files:**
- Modify: `src/monobank/sync.ts:324`
- Test: `src/monobank/sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('persists the queried ceiling, not the clock at loop end', async () => {
  let current = 1_700_000_000_000;
  const deps = makeInMemoryDeps({
    // Every `now()` read advances 2 minutes, modelling the throttle sleeps.
    now: () => {
      const value = current;
      current += 120_000;

      return value;
    },
    clientInfo: { accounts: [card('acc-a')] },
    statementFor: () => [statementItem()],
  });

  await runSync(deps);

  const [persisted] = deps.setLastSyncAt.mock.calls.at(-1) ?? [];
  const [, , , statementTo] = deps.fetchStatement.mock.calls.at(-1) ?? [];

  // The cursor must be the same instant the statement window closed at.
  expect(persisted).toBe(statementTo * 1000);
});
```

Read `sync.test.ts` for `makeInMemoryDeps`' real option names and whether `fetchStatement` is already a spy; the assertion that matters is `setLastSyncAt` receiving `toSeconds * 1000`.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx jest src/monobank/sync.test.ts
```

Expected: the persisted value is larger than `statementTo * 1000` by the accumulated clock advance.

- [ ] **Step 3: Persist the ceiling**

At `src/monobank/sync.ts:324`:

```ts
  // The cursor is the ceiling this run actually QUERIED, not the clock at loop
  // end. `deps.now()` here left every transaction between `toSeconds` and the
  // end of the loop permanently unqueried — one throttle sleep per page, per
  // card, each a silent hole in imported history (the balance still came out
  // right, because it is overwritten from /client-info).
  await deps.setLastSyncAt(toSeconds * 1000);
```

- [ ] **Step 4: Run green**

```bash
npx jest src/monobank src/screens/use-sync.test.ts
npm run check:typecheck
```

---

## Task 13: T-13 — Mark the account `monobank` only after `fetchClientInfo` succeeds

**Confidence: CONFIRMED.**

`ensureMonobankAccount` (`src/monobank/sync.ts:189`) calls `deps.updateAccount(targetAccountId, { institution: 'monobank' })` and is invoked at `:302`, **before** `fetchClientInfo` at `:303`. A wrong token, an offline device or a 429 fails the connect but leaves the account permanently marked connected: its detail screen shows Disconnect instead of the token field, every other account's Connect is hidden (`connectedQuery` returns this row), and the account cannot be deleted until disconnected. `src/crypto-sync/sync.ts:103-107` already does it the right way round — mark only after a successful fetch.

**Files:**
- Modify: `src/monobank/sync.ts:175-197` (`ensureMonobankAccount` → split), `:291-325` (`runSync` ordering)
- Test: `src/monobank/sync.test.ts`

**Interfaces:**
- Produces: `resolveMonobankAccountId(deps): Promise<string>` (read-only: validates the one-connection-per-institution invariant and returns the target id, writing nothing) and `markMonobankAccount(deps, accountId): Promise<void>` (the single `updateAccount` write). `runSync` calls resolve → fetch → mark.

- [ ] **Step 1: Write the failing test**

```ts
it('leaves the target account unmarked when client-info fails', async () => {
  const deps = makeInMemoryDeps({
    targetAccountId: 'acc-1',
    accounts: [{ id: 'acc-1', name: 'Mono', kind: 'bank', institution: null }],
    fetchClientInfo: jest.fn(() => Promise.reject(new Error('401'))),
  });

  await expect(runSync(deps)).rejects.toThrow('401');

  expect(deps.accountsStore[0].institution).toBeNull();
});

it('marks the target account once client-info resolves', async () => {
  const deps = makeInMemoryDeps({
    targetAccountId: 'acc-1',
    accounts: [{ id: 'acc-1', name: 'Mono', kind: 'bank', institution: null }],
    clientInfo: { accounts: [card('acc-a')] },
    statementFor: () => [],
  });

  await runSync(deps);

  expect(deps.accountsStore[0].institution).toBe('monobank');
});
```

- [ ] **Step 2: Run it and confirm the failure**

```bash
npx jest src/monobank/sync.test.ts
```

Expected: the first test finds `institution === 'monobank'`.

- [ ] **Step 3: Split resolve from mark**

Rewrite `src/monobank/sync.ts:175-197`. Keep the existing "another account already connected" and "no Monobank connection" guards in the read-only half:

```ts
/**
 * Resolve which account this sync targets, WITHOUT writing anything. When
 * `targetAccountId` is set (a Connect), the one-connection-per-institution
 * invariant is validated here; when it is absent (a re-sync), the
 * already-connected account is returned.
 */
const resolveMonobankAccountId = async (deps: SyncDeps): Promise<string> => {
  const accounts = await deps.listAccounts();

  if (deps.targetAccountId !== undefined) {
    const otherConnected = accounts.some(
      (account) => account.institution === 'monobank' && account.id !== deps.targetAccountId,
    );

    if (otherConnected) {
      throw new Error(i18n.t('accountDetail.monobankAlreadyConnected'));
    }

    return deps.targetAccountId;
  }

  const existing = accounts.find((account) => account.institution === 'monobank');

  if (!existing) {
    throw new Error(i18n.t('accountDetail.noMonobankConnection'));
  }

  return existing.id;
};

/**
 * Mark the account as Monobank-connected. Called ONLY after `fetchClientInfo`
 * resolves: marking it first left a failed connect (wrong token, offline, 429)
 * permanently half-connected — the detail screen showed Disconnect instead of
 * the token field, every other account's Connect was hidden, and the account
 * could not be deleted. `crypto-sync/sync.ts` already orders it this way.
 */
const markMonobankAccount = async (deps: SyncDeps, accountId: string): Promise<void> => {
  if (deps.targetAccountId !== undefined) {
    await deps.updateAccount(accountId, { institution: 'monobank' });
  }
};
```

Read the existing `:175-197` body for its exact guard wording before rewriting; preserve both `i18n.t` keys verbatim.

- [ ] **Step 4: Reorder `runSync`**

```ts
  await deps.ensureSettings();
  const accountId = await resolveMonobankAccountId(deps);
  await gate.wait();
  const { accounts, jars } = await deps.fetchClientInfo(token, deps.fetchImpl);
  await markMonobankAccount(deps, accountId);
  await upsertHoldings(deps, accountId, accounts, jars);
```

(The `gate.wait()` line comes from Task 7 — it is already there.)

- [ ] **Step 5: Run green**

```bash
npx jest src/monobank src/screens/account-detail src/screens/use-sync.test.ts
npm run check:typecheck
```

---

## Task 14: T-14 — Settle the two rate providers independently and validate the CoinGecko body

**Confidence: CONFIRMED.**

`refreshRates` (`src/rates/rates-refresh.ts:99`) does `const [fiat, btc] = await Promise.all([loadFiat(), loadBTC()]);`. When CoinGecko 429s — or returns a body with no `bitcoin`, which makes `data.bitcoin.usd` at `src/rates/coingecko.ts:33` throw a bare `TypeError` — the whole promise rejects: the successfully fetched Monobank UAH/USD/EUR rates are discarded, nothing is upserted, fiat conversion keeps using the stale table, and the rejection propagates through `useSyncAction` (`src/screens/use-sync.ts:36-51`) so a *successful* Monobank import is reported to the user as a failed sync. `runBackfill` (`src/rates/history-backfill.ts:186-191`) already has the right shape — `Promise.allSettled` with an empty-list fallback per provider.

**Files:**
- Modify: `src/rates/rates-refresh.ts:99-103`
- Modify: `src/rates/coingecko.ts:6-33`
- Test: `src/rates/rates-refresh.test.ts`, `src/rates/coingecko.test.ts`

- [ ] **Step 1: Write the failing test in `src/rates/rates-refresh.test.ts`**

```ts
it('still stores fiat pairs when the BTC provider rejects', async () => {
  const upsertMany = jest.fn();

  await refreshRates({
    fetchFiatRates: () => Promise.resolve(FIAT_FIXTURE),
    fetchBTCPrice: () => Promise.reject(new Error('429')),
    upsertMany,
    now: () => 1_700_000_000_000,
  });

  expect(upsertMany).toHaveBeenCalled();
  const pairs = upsertMany.mock.calls[0][0];

  expect(pairs.some((pair) => pair.base === 'USD' && pair.quote === 'UAH')).toBe(true);
  expect(pairs.some((pair) => pair.base === 'BTC')).toBe(false);
});

it('does not reject when both providers fail', async () => {
  const upsertMany = jest.fn();

  await expect(
    refreshRates({
      fetchFiatRates: () => Promise.reject(new Error('offline')),
      fetchBTCPrice: () => Promise.reject(new Error('429')),
      upsertMany,
      now: () => 1_700_000_000_000,
    }),
  ).resolves.toBeUndefined();

  expect(upsertMany).not.toHaveBeenCalled();
});

it('still stores BTC pairs when the fiat provider rejects', async () => {
  const upsertMany = jest.fn();

  await refreshRates({
    fetchFiatRates: () => Promise.reject(new Error('offline')),
    fetchBTCPrice: () => Promise.resolve([{ base: 'BTC', quote: 'USD', rate: 60_000, source: 'coingecko' }]),
    upsertMany,
    now: () => 1_700_000_000_000,
  });

  expect(upsertMany.mock.calls[0][0].some((pair) => pair.base === 'BTC')).toBe(true);
});
```

Read `rates-refresh.test.ts` for the existing fiat fixture's real name and `buildPairs`' behaviour with a partial anchor set — if `buildUahPrice` cannot compose any BTC pair from fiat-only anchors, the second assertion in test one is automatically satisfied.

- [ ] **Step 2: Write the failing test in `src/rates/coingecko.test.ts`**

```ts
it('rejects with a typed error on a body without bitcoin.usd', async () => {
  const fetchImpl = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response),
  );

  await expect(fetchBTCPrice(fetchImpl)).rejects.toThrow(/CoinGecko/);
});

it('rejects on a non-numeric price', async () => {
  const fetchImpl = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ bitcoin: { usd: 'lots' } }),
    } as unknown as Response),
  );

  await expect(fetchBTCPrice(fetchImpl)).rejects.toThrow(/CoinGecko/);
});
```

- [ ] **Step 3: Run both and confirm the failures**

```bash
npx jest src/rates/rates-refresh.test.ts src/rates/coingecko.test.ts
```

Expected: `refreshRates` rejects instead of upserting; `fetchBTCPrice({})` rejects with a bare `TypeError: Cannot read properties of undefined`, not a CoinGecko-named error.

- [ ] **Step 4: Settle the providers independently**

At `src/rates/rates-refresh.ts:99-103`:

```ts
  // Settle the two providers independently, exactly as `runBackfill` does
  // (rates/history-backfill.ts). `Promise.all` discarded a successful Monobank
  // fiat fetch whenever CoinGecko 429'd or returned a malformed body, left the
  // stale rate table in place, and propagated the rejection through
  // `useSyncAction` — so a Monobank import that fully succeeded was reported
  // to the user as a failed sync. Whichever provider survives still
  // contributes its anchors.
  const [fiatResult, btcResult] = await Promise.allSettled([loadFiat(), loadBTC()]);
  const fiat = fiatResult.status === 'fulfilled' ? fiatResult.value : [];
  const btc = btcResult.status === 'fulfilled' ? btcResult.value : [];
  const pairs = buildPairs(buildUahPrice(fiat, btc), at);

  if (pairs.length > 0) {
    await upsertMany(pairs);
  }
```

Read `buildUahPrice`'s signature and confirm it tolerates an empty list on either side (`runBackfill` passes `[]` the same way through `composeHistoryRows`). If it does not, guard each side there rather than reintroducing all-or-nothing here.

- [ ] **Step 5: Validate the CoinGecko body**

In `src/rates/coingecko.ts`, add a narrowing check between the ok-check and the field read. Keep the existing `guard` for the HTTP status (`kiko-code-style`: `guard` is for a function whose contract is to throw):

```ts
/** The `/simple/price` payload shape for a single id/vs-currency pair. */
type CoinGeckoPrice = { bitcoin: { usd: number } };

// A 200 with an unexpected body is as real a failure as a 429 — CoinGecko's
// free tier returns `{}` (and sometimes an error object) under load. Reading
// `data.bitcoin.usd` off it threw a bare `TypeError` that told the caller
// nothing, and `refreshRates` turned that into "the whole sync failed".
const isCoinGeckoPrice = (value: unknown): value is CoinGeckoPrice => {
  if (typeof value !== 'object' || value === null || !('bitcoin' in value)) {
    return false;
  }

  const { bitcoin } = value as { bitcoin: unknown };

  return (
    typeof bitcoin === 'object' &&
    bitcoin !== null &&
    'usd' in bitcoin &&
    typeof (bitcoin as { usd: unknown }).usd === 'number' &&
    Number.isFinite((bitcoin as { usd: number }).usd)
  );
};
```

and in `fetchBTCPrice`:

```ts
export const fetchBTCPrice = async (fetchImpl: typeof fetch = fetch): Promise<RateEntry[]> => {
  const response = await fetchImpl(PRICE_ENDPOINT);
  const data: unknown = await readPrice(response);

  if (!isCoinGeckoPrice(data)) {
    throw new Error('CoinGecko price response did not contain a finite bitcoin.usd value');
  }

  return [{ base: 'BTC', quote: 'USD', rate: data.bitcoin.usd, source: 'coingecko' }];
};
```

`readPrice`'s executor return type must widen from `Promise<CoinGeckoPrice>` to `Promise<unknown>` for this to typecheck — change it there.

- [ ] **Step 6: Run green**

```bash
npx jest src/rates src/screens/use-sync.test.ts
npm run check:typecheck
```

---

## Task 15: T-15 — Fold every biometrics throw into the `AuthResult` / `SensorStatus` union

**Confidence: CONFIRMED.**

`LockGate`'s `attemptUnlock` (`src/auth/lock-gate/lock-gate.component.tsx:55-57`) is `unlock().then(setLastResult)` — no rejection handler. `@sbaiahmed1/react-native-biometrics` rethrows native rejections, and `loadNativeBiometrics`' `require` (`src/auth/biometrics.ts:11-12`) throws outright when the pod is missing. With `APP_LOCK_ENABLED = true` a throw becomes an unhandled rejection: `setLocked(false)` never runs, `lastResult` stays `undefined`, and the user sits on the lock screen with the neutral default hint; tapping Unlock repeats the throw. `isSensorAvailable().then(...)` in `app-lock-setting.component.tsx:44-55` has the same gap — the switch stays disabled with no hint.

**Files:**
- Modify: `src/auth/biometrics.ts:50-98`
- Modify: `src/auth/lock-gate/lock-gate.component.tsx:55-57` (only if `tsc` requires it — the fix is meant to make the caller unchanged)
- Test: `src/auth/biometrics.test.ts`, `src/auth/lock-gate/lock-gate.component.test.tsx`, `src/screens/settings/app-lock-setting/app-lock-setting.component.test.tsx`

**Interfaces:**
- Produces: `authenticate(prompt)` and `isSensorAvailable()` become **total** — they always resolve to a member of their existing union and never reject. `authenticate` maps a throw to `{ kind: 'failed', code }`; `isSensorAvailable` maps a throw to `{ kind: 'unavailable' }`. No union member is added, so every existing `match(...).exhaustive()` in `lock-gate.component.tsx:21-28` and `app-lock-setting.component.tsx` keeps compiling unchanged.

- [ ] **Step 1: Write the failing test in `src/auth/biometrics.test.ts`**

```ts
it('resolves to failed when the native module rejects', async () => {
  mockAuthenticateWithOptions.mockRejectedValueOnce(
    Object.assign(new Error('boom'), { code: 'SYSTEM_ERROR' }),
  );

  await expect(authenticate('Unlock Kiko')).resolves.toEqual({
    kind: 'failed',
    code: 'SYSTEM_ERROR',
  });
});

it('resolves to failed when the native module is missing entirely', async () => {
  mockLoadThrows(new Error("Cannot find module '@sbaiahmed1/react-native-biometrics'"));

  await expect(authenticate('Unlock Kiko')).resolves.toEqual({
    kind: 'failed',
    code: undefined,
  });
});

it('resolves to unavailable when isSensorAvailable rejects', async () => {
  mockIsSensorAvailable.mockRejectedValueOnce(new Error('boom'));

  await expect(isSensorAvailable()).resolves.toEqual({ kind: 'unavailable' });
});
```

Read `biometrics.test.ts`'s existing module mock for how it stubs the native module; `mockLoadThrows` above is a placeholder for whatever mechanism makes the `require` throw.

- [ ] **Step 2: Write the failing test in `src/auth/lock-gate/lock-gate.component.test.tsx`**

```tsx
it('renders the retry hint when authenticate rejects', async () => {
  mockAuthenticate.mockRejectedValueOnce(new Error('boom'));

  const { getByText } = await render(
    <LockGate>
      <Text>unlocked</Text>
    </LockGate>,
  );

  await waitFor(() => {
    expect(getByText(en.auth.hint.failed)).toBeTruthy();
  });
});
```

`auth.hint.failed` already exists in both catalogues (`en.ts:15`), so no catalogue change is needed. Add the analogous "switch shows a hint instead of staying silently disabled" test to `app-lock-setting.component.test.tsx`.

- [ ] **Step 3: Run them and confirm the failures**

```bash
npx jest src/auth src/screens/settings/app-lock-setting
```

Expected: `authenticate` rejects instead of resolving; the LockGate test logs an unhandled rejection and renders the default hint, not the failed hint.

- [ ] **Step 4: Wrap both native calls with `fnts`' `either`**

`src/auth/biometrics.ts` — this is data-layer/native-boundary code, so `either` is the right tool (`kiko-code-style`: `either`/`guard` for the data layer, plain `try`/`catch` only for a screen's UI-feedback handler):

```ts
import { either, isLeft } from 'fnts';
```

```ts
/**
 * Whether the device can authenticate, as a TOTAL function — it never
 * rejects.
 *
 * The native module rethrows its own rejections, and `loadNativeBiometrics`'
 * `require` throws outright on a build whose pod is not installed. An
 * unhandled rejection here left the Settings switch permanently disabled with
 * no hint. A throw is indistinguishable from "no usable sensor" from the UI's
 * point of view, so it folds into the existing `unavailable` member rather
 * than adding a new one — every `match(...).exhaustive()` caller stays
 * unchanged.
 */
export const isSensorAvailable = async (): Promise<SensorStatus> => {
  const result = await either(() => loadNativeBiometrics().isSensorAvailable());

  if (isLeft(result)) {
    return { kind: 'unavailable' };
  }

  const info = result;

  if (info.available) {
    return { kind: 'available', biometryType: info.biometryType };
  }

  if (info.isDeviceSecure === false || info.errorCode === PASSCODE_NOT_SET_CODE) {
    return { kind: 'passcodeNotSet' };
  }

  if (hasCode(NOT_ENROLLED_CODES, info.errorCode)) {
    return { kind: 'passcodeOnly' };
  }

  return { kind: 'unavailable' };
};
```

Read `fnts`' `either`/`isLeft`/`isRight`/`bifold` shapes in `node_modules/fnts` before writing this — the narrowing above is written from the API's intent, and the exact right-channel accessor may differ. `kiko-code-style` warns that the curried `first(toError)(result)` form silently collapses the right side to `unknown`; use the two-argument `first(result, toError)` if you need error normalization, and annotate a `bifold` result's type explicitly.

Same treatment for `authenticate` (`:73-98`): wrap `loadNativeBiometrics().authenticateWithOptions({...})`, and on a `Left` return `{ kind: 'failed', code: <the error's own code, if it carries one, else undefined> }`. Read what shape the library attaches its code in (`result.errorCode` on the success path; a thrown error may carry `code` or `errorCode`) and narrow with a small module-level helper rather than a cast.

Add to the module's header doc: both exported functions are total and never reject; callers may `.then(...)` without a rejection handler.

- [ ] **Step 5: Leave the callers alone**

`lock-gate.component.tsx:55-57` and `app-lock-setting.component.tsx:44-55` should now be correct **unchanged** — that is the point of folding the throw into the union. Do not add a `.catch()` on top; if you find yourself wanting one, the wrap above is incomplete. Verify by re-reading `useAppLock`'s `unlock` (`src/auth/use-app-lock.ts`) and confirming it does not add its own throw on top of `authenticate`.

- [ ] **Step 6: Run green**

```bash
npx jest src/auth src/screens/settings
npm run check:typecheck
```

Expected: PASS with **no** unhandled-rejection warning in Jest's output. Grep the output for `UnhandledPromiseRejection` to be sure.

---

## Task 16: T-16 — Persist `hold` and refresh a re-synced Monobank row's amount without clobbering the user's category

**Confidence: PLAUSIBLE — run the confirm step first.**

`MonobankStatementItem.hold` (`src/monobank/monobank.types.d.ts:48`) is modelled but never read; `mapStatementItem` (`src/monobank/sync.ts:98-112`) imports a pending authorization as if it were settled (the test fixture's item 3 has `hold: true` and the existing tests assert it is imported anyway). `addManyDedup` (`src/repositories/transactions.repo.ts:306-337`) ends in `onConflictDoNothing()` on `(source, external_id)`, so when the row later re-fetches with its **final** settled amount the update is dropped and the provisional amount is kept forever. If Monobank re-issues the settled item under a new id instead, both rows persist and totals double-count.

**Chosen fix (coordinator's decision): the `onConflictDoUpdate` variant.** Held items are still imported (so the ledger shows a pending charge immediately, which is the useful behaviour), `hold` is persisted so a reader can tell pending from settled, and a re-sync refreshes `amountMinorUnits` / `description` / `hold` for `source = 'monobank'` rows while **preserving** `category` (the user's override, or Task 6's slug) and `comment`.

**Files:**
- Modify: `src/db/schema.ts` (new `hold` column), `drizzle/migrations/` (generated `0017`)
- Modify: `src/monobank/sync.ts:98-112` (`mapStatementItem`), `:255-268` (`freshTransactions` — see Step 5)
- Modify: `src/repositories/transactions.repo.ts:306-337` (`addManyDedup`)
- Test: `src/monobank/sync.test.ts`, `src/repositories/transactions.repo.test.ts`

- [ ] **Step 1: Run the confirm step (PLAUSIBLE)**

```bash
grep -n "hold" src/monobank/monobank.types.d.ts src/monobank/sync.ts
grep -n "onConflictDoNothing" src/repositories/transactions.repo.ts
```

Expected: `hold` appears only in the type declaration, never read in `sync.ts`; `onConflictDoNothing` is at the end of `addManyDedup`. Then write the reproduction test in Step 2 and confirm it fails. If the amount **does** update on re-sync, stop and report.

- [ ] **Step 2: Write the failing test in `src/monobank/sync.test.ts`**

```ts
it('refreshes a re-synced item to its settled amount, keeping one row', async () => {
  const deps = makeInMemoryDeps({
    clientInfo: { accounts: [card('acc-a')] },
    statementFor: () => [statementItem({ id: 'stmt-1', amount: -10_000, hold: true })],
  });

  await runSync(deps);

  deps.setStatement(() => [statementItem({ id: 'stmt-1', amount: -12_500, hold: false })]);
  await runSync(deps);

  const rows = deps.transactionsStore.filter((row) => row.externalId === 'stmt-1');

  expect(rows).toHaveLength(1);
  expect(rows[0].amountMinorUnits).toBe(-12_500);
  expect(rows[0].hold).toBe(false);
});

it('does not clobber a user category override on re-sync', async () => {
  const deps = makeInMemoryDeps({
    clientInfo: { accounts: [card('acc-a')] },
    statementFor: () => [statementItem({ id: 'stmt-1', amount: -10_000, mcc: 5411 })],
  });

  await runSync(deps);
  // The user re-categorises the row by hand.
  deps.transactionsStore[0].category = 'dining';

  deps.setStatement(() => [statementItem({ id: 'stmt-1', amount: -12_500, mcc: 5411 })]);
  await runSync(deps);

  expect(deps.transactionsStore[0].category).toBe('dining');
  expect(deps.transactionsStore[0].amountMinorUnits).toBe(-12_500);
});
```

`makeInMemoryDeps` may not expose a re-settable statement function today — read it, and add a minimal seam if needed (that is test infrastructure, not production code).

- [ ] **Step 3: Run it and confirm the failure**

```bash
npx jest src/monobank/sync.test.ts
```

Expected: the stored amount stays `-10_000`.

- [ ] **Step 4: Add the `hold` column**

In `src/db/schema.ts`'s `transactions` table, after `mcc`:

```ts
    // Monobank's `hold` flag: the item is a PENDING authorization whose final
    // settled amount can still change (a restaurant tip, a fuel pre-auth). The
    // row is imported anyway so a pending charge shows in the ledger
    // immediately; `addManyDedup` then refreshes the amount when the settled
    // version re-syncs. Null on manual rows and on rows synced before this
    // column existed.
    hold: integer('hold', { mode: 'boolean' }),
```

Confirm the `{ mode: 'boolean' }` form against the Drizzle version in use by reading another boolean column in the same file (`settings.lockEnabled` is one) and matching it exactly.

```bash
npx drizzle-kit generate
```

Then hand-add the `m0017` import + object entry to `drizzle/migrations/migrations.js` (see Task 8 Step 6 for the procedure), and extend the migration-registration test with `expect(combined).toContain('`hold`')` plus a `0017` check on `migrations.js`.

- [ ] **Step 5: Map `hold` at the sync boundary**

In `mapStatementItem` (`src/monobank/sync.ts:98-112`), add `hold: item.hold ?? false,` to the returned object, and add `'hold'` to the local `NewTransaction` type's `Partial<Pick<TransactionRow, ...>>` list (`:21-27`). Add the same to `NewTransaction` in `src/repositories/transactions.repo.ts:23-29`.

Then read `freshTransactions` (`:255-268`): it filters out every item whose `externalId` is already known, so a re-fetched settled item never reaches `addManyDedup` at all. Remove that filter — the `onConflictDoUpdate` in Step 6 is now what handles the duplicate, and doing it in SQL is what makes the refresh atomic:

```ts
// Every fetched item is handed to `addManyDedup`, which upserts on
// `(source, external_id)`. The old JS-side `knownExternalIds` filter dropped a
// re-fetched item BEFORE the DB saw it, so a held item's provisional amount
// could never be refreshed to its settled value.
const mapFetched = (items: MonobankStatementItem[], holdingId: string): NewTransaction[] =>
  items.map((item) => mapStatementItem(item, holdingId));
```

Update `importAccount` (`:270-290`) to use it, and drop the now-unused `listTransactionsByHolding` read **only if** nothing else needs it — check first; if `SyncDeps.listTransactionsByHolding` becomes unused, remove it from the interface, the default deps and the test doubles, or Knip will flag it. `importAccount`'s return value (`fresh.length`, reported to the user as "imported N transactions") now counts *fetched* rather than *new* items — either keep it as fetched-count and rename the local, or have `addManyDedup` return the inserted count. Prefer the latter if it is a small change; otherwise rename and adjust the one caller's copy.

- [ ] **Step 6: Switch `addManyDedup` to `onConflictDoUpdate`**

At `src/repositories/transactions.repo.ts:330-337`:

```ts
      // Upsert on the `(source, external_id)` unique index. A re-fetched
      // Monobank item is REFRESHED, not dropped: a `hold: true` authorization
      // imports at its provisional amount and later re-syncs at its settled
      // one, which `onConflictDoNothing` silently discarded, freezing the
      // wrong amount forever.
      //
      // `category` and `comment` are deliberately NOT in the update set: the
      // category may be the user's own override (or a name-rule rewrite), and
      // the comment is the user's note. `excluded` is SQLite's alias for the
      // row that would have been inserted.
      await tx
        .insert(transactions)
        .values(withOverrides.map((input) => ({ id: id(), ...input })))
        .onConflictDoUpdate({
          target: [transactions.source, transactions.externalId],
          set: {
            amountMinorUnits: sql`excluded.amount_minor_units`,
            description: sql`excluded.description`,
            hold: sql`excluded.hold`,
            mcc: sql`excluded.mcc`,
            counterIban: sql`excluded.counter_iban`,
            time: sql`excluded.time`,
          },
        });
```

Import `sql` from `drizzle-orm` in this file (it currently imports `desc`, `eq`, `inArray`).

**Manual rows must be unaffected.** A manual row has `externalId` null, and SQLite's unique index treats each NULL as distinct, so two manual rows never conflict — the existing comment at `:327-329` already says this. Add a repo test that pins it:

```ts
it('never conflates two manual rows with a null externalId', async () => {
  await transactionsRepo.addManyDedup([
    { holdingId: 'h-1', amountMinorUnits: -100, time: 1, source: 'manual' },
    { holdingId: 'h-1', amountMinorUnits: -200, time: 2, source: 'manual' },
  ]);

  expect(await listTransactions()).toHaveLength(2);
});
```

- [ ] **Step 7: Run green**

```bash
npx jest src/monobank src/repositories src/db src/screens/holding-detail src/screens/home
npm run check:typecheck
```

Expected: PASS. Existing `sync.test.ts` cases that assert the held fixture item is imported stay green (it still is); a case asserting a re-import is *skipped* is now wrong — it should assert the row was refreshed.

---

## Task 17: T-17 — Translate the "Never" last-sync label

**Confidence: CONFIRMED.**

`formatLastSyncAt` (`src/screens/account-detail/format-last-sync.ts:5-6`) returns the literal `'Never'`, which is then interpolated into the translated `accountDetail.lastSync` key. Under `uk` a never-synced account renders "Остання синхронізація: Never". `grep -n "never\|Never" src/i18n/locales/en.ts src/i18n/locales/uk.ts` matches nothing — no key exists in either catalogue.

**Files:**
- Modify: `src/screens/account-detail/format-last-sync.ts:5-6`
- Modify: `src/screens/account-detail/account-detail.screen.tsx:257-261`, `src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.tsx:110-112`
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts`
- Test: `src/screens/account-detail/format-last-sync.test.ts`, `crypto-sync-section.component.test.tsx`

**Interfaces:**
- Produces: `formatLastSyncAt(lastSyncAt: number | null, t: TFunction): string`. New keys `accountDetail.never` in both catalogues.

- [ ] **Step 1: Write the failing tests**

`src/screens/account-detail/format-last-sync.test.ts` — replace the literal assertion at `:6-8`:

```ts
it('resolves the never label from the catalogue', () => {
  expect(formatLastSyncAt(null, i18n.t)).toBe(i18n.t('accountDetail.never'));
});

it('resolves the never label in Ukrainian', async () => {
  await i18n.changeLanguage('uk');

  expect(formatLastSyncAt(null, i18n.t)).toBe('Ніколи');

  await i18n.changeLanguage('en');
});

it('still formats a real timestamp', () => {
  expect(formatLastSyncAt(1_700_000_000_000, i18n.t)).toBe(formatDateTime(1_700_000_000_000));
});
```

And in `crypto-sync-section.component.test.tsx`:

```tsx
it('renders the never label in Ukrainian for an unsynced provider', async () => {
  await i18n.changeLanguage('uk');

  const { getByText } = await render(<CryptoSyncSection {...propsWithNoSync} />);

  expect(getByText(/Ніколи/)).toBeTruthy();

  await i18n.changeLanguage('en');
});
```

- [ ] **Step 2: Run them and confirm the failures**

```bash
npx jest src/screens/account-detail
```

Expected: the function takes one argument; `accountDetail.never` does not resolve.

- [ ] **Step 3: Thread `t` through**

`src/screens/account-detail/format-last-sync.ts`:

```ts
import type { TFunction } from 'i18next';

/**
 * The account's last-sync label. `t` is threaded in (rather than read off the
 * i18next singleton) so this stays a pure render-time helper that re-resolves
 * against the active language on every call — the same shape
 * `defaultTransactionDescription` and `derivedEntries` use. It returned a bare
 * English `'Never'` that was then interpolated into the TRANSLATED
 * `accountDetail.lastSync` key, so a Ukrainian user read
 * "Остання синхронізація: Never".
 */
export const formatLastSyncAt = (lastSyncAt: number | null, t: TFunction): string =>
  lastSyncAt === null ? t('accountDetail.never') : formatDateTime(lastSyncAt);
```

Update both call sites to pass their existing `t` (`account-detail.screen.tsx:257-261` and `crypto-sync-section.component.tsx:110-112` both already have one from `useTranslation`).

- [ ] **Step 4: Add the key to BOTH catalogues**

`en.ts`, in the `accountDetail` block, alphabetically placed: `never: 'Never',`
`uk.ts`, same block, same position: `never: 'Ніколи',`

- [ ] **Step 5: Run green**

```bash
npx jest src/screens/account-detail src/i18n
npm run check:typecheck
```

---

## Task 18: T-18 — Route a balance edit and a cash account's initial balance through a repository function that writes the delta as a manual transaction

**Confidence: CONFIRMED.**

`buildHoldingPatch` (`src/screens/forms/holding-form.screen.tsx:97-101`) writes `balanceMinorUnits` straight onto the row, and `holdingsRepo.update` (`src/repositories/holdings.repo.ts:168-169`) is a bare `set(patch)`. This breaks the `kiko-domain` invariant "a manual balance adjustment always writes a `manual` Transaction, so a holding's balance history stays derivable from its transactions" (`.claude/skills/kiko-domain/SKILL.md:40-41`). The consequence is in `holdingValueAt` (`src/statistics/holding-value-at.ts:33-40`), which back-derives the opening balance as `currentBalance − sum(allTransactions)`: changing 100 → 500 UAH **today** shifts the whole historical net-worth series by +400 with no ledger row, and the holding-detail transaction list no longer reconciles with its displayed Value. `accountsRepo.createCashAccount` (`src/repositories/accounts.repo.ts:83-107`) has the same gap — it inserts a holding with a non-zero `balanceMinorUnits` and no opening transaction.

**Files:**
- Modify: `src/repositories/holdings.repo.ts` (new `updateWithBalanceDelta`)
- Modify: `src/repositories/accounts.repo.ts:83-107` (`createCashAccount`)
- Modify: `src/screens/forms/holding-form.screen.tsx:97-101`, `:417-472`
- Test: `src/repositories/holdings.repo.test.ts`, `src/repositories/accounts.repo.test.ts`, `src/screens/forms/holding-form.screen.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // src/repositories/holdings.repo.ts
  /**
   * Update a holding's editable fields and, when `balanceMinorUnits` changes,
   * write the difference as a `manual` transaction — both in ONE
   * db.transaction().
   */
  updateWithBalanceDelta: (
    holdingId: string,
    patch: Partial<HoldingRow>,
    time: number,
  ) => Promise<void>
  ```
  The delta is computed from the row read **inside** the transaction, mirroring `transactionsRepo.update`'s delta handling (`transactions.repo.ts:244-276`), so a concurrent write cannot be clobbered by a stale render snapshot.

- [ ] **Step 1: Write the failing test in `src/repositories/holdings.repo.test.ts`**

```ts
it('writes the balance difference as a manual transaction', async () => {
  await seedHolding({ id: 'h-1', currency: 'UAH', balanceMinorUnits: 100_00 });

  await holdingsRepo.updateWithBalanceDelta(
    'h-1',
    { balanceMinorUnits: 500_00 },
    1_700_000_000_000,
  );

  const rows = await listTransactions();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    holdingId: 'h-1',
    amountMinorUnits: 400_00,
    source: 'manual',
    time: 1_700_000_000_000,
  });
  expect((await getHolding('h-1')).balanceMinorUnits).toBe(500_00);
});

it('writes a negative delta for a decrease', async () => {
  await seedHolding({ id: 'h-1', currency: 'UAH', balanceMinorUnits: 500_00 });

  await holdingsRepo.updateWithBalanceDelta('h-1', { balanceMinorUnits: 100_00 }, 1);

  expect((await listTransactions())[0].amountMinorUnits).toBe(-400_00);
});

it('writes no transaction for a name-only edit', async () => {
  await seedHolding({ id: 'h-1', currency: 'UAH', balanceMinorUnits: 100_00 });

  await holdingsRepo.updateWithBalanceDelta('h-1', { name: 'Renamed' }, 1);

  expect(await listTransactions()).toHaveLength(0);
  expect((await getHolding('h-1')).name).toBe('Renamed');
});

it('writes no transaction for a zero delta', async () => {
  await seedHolding({ id: 'h-1', currency: 'UAH', balanceMinorUnits: 100_00 });

  await holdingsRepo.updateWithBalanceDelta('h-1', { balanceMinorUnits: 100_00 }, 1);

  expect(await listTransactions()).toHaveLength(0);
});
```

- [ ] **Step 2: Write the failing test in `src/repositories/accounts.repo.test.ts`**

```ts
it('seeds an opening transaction for a cash account initial balance', async () => {
  await accountsRepo.createCashAccount({
    name: 'Wallet',
    currency: 'UAH',
    initialBalanceMinorUnits: 250_00,
  });

  const rows = await listTransactions();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ amountMinorUnits: 250_00, source: 'manual' });
});

it('seeds no transaction for a zero initial balance', async () => {
  await accountsRepo.createCashAccount({
    name: 'Wallet',
    currency: 'UAH',
    initialBalanceMinorUnits: 0,
  });

  expect(await listTransactions()).toHaveLength(0);
});
```

- [ ] **Step 3: Write the failing test in `src/screens/forms/holding-form.screen.test.tsx`**

```tsx
it('records a manual transaction for a balance edit', async () => {
  mockEditingHolding = { id: 'h-1', name: 'Cash', type: 'cash', currency: 'UAH', balanceMinorUnits: 100_00, metadata: null };

  const { getByLabelText, getByText } = await renderEditMode();

  await fireEvent.changeText(getByLabelText('Opening balance'), '500');
  await fireEvent.press(getByText('Save'));

  expect(mockUpdateWithBalanceDelta).toHaveBeenCalledWith(
    'h-1',
    expect.objectContaining({ balanceMinorUnits: 500_00 }),
    expect.any(Number),
  );
});
```

- [ ] **Step 4: Run all three and confirm the failures**

```bash
npx jest src/repositories/holdings.repo.test.ts src/repositories/accounts.repo.test.ts src/screens/forms/holding-form.screen.test.tsx
```

Expected: `updateWithBalanceDelta` does not exist; `createCashAccount` writes no transaction.

- [ ] **Step 5: Add `updateWithBalanceDelta`**

In `src/repositories/holdings.repo.ts`, next to `update`:

```ts
  /**
   * Update a holding's editable fields and, when `balanceMinorUnits` is part
   * of the patch and differs from what is stored, write the DIFFERENCE as a
   * `manual` transaction — both in ONE op-sqlite transaction.
   *
   * WHY: `kiko-domain`'s invariant is that a manual balance adjustment always
   * writes a manual transaction, so a holding's balance history stays
   * derivable from its transactions. `holdingValueAt`
   * (statistics/holding-value-at.ts) back-derives each holding's opening
   * balance as `currentBalance - sum(allTransactions)`, so a bare
   * `set({ balanceMinorUnits })` retroactively shifted the ENTIRE historical
   * net-worth series by the delta, with no ledger row to explain it, and left
   * the holding-detail transaction list unable to reconcile with its own
   * displayed Value.
   *
   * The stored balance is re-read INSIDE the transaction so the delta is
   * computed against what is actually persisted, never a render snapshot —
   * the same rule `transactionsRepo.update` follows.
   */
  updateWithBalanceDelta: (holdingId: string, patch: Partial<HoldingRow>, time: number) =>
    write(async (tx) => {
      const rows = await tx
        .select({ balanceMinorUnits: holdings.balanceMinorUnits })
        .from(holdings)
        .where(eq(holdings.id, holdingId))
        .limit(1);
      const stored = rows.at(0)?.balanceMinorUnits;

      await tx.update(holdings).set(patch).where(eq(holdings.id, holdingId));

      if (patch.balanceMinorUnits === undefined || stored === undefined) {
        return;
      }

      const delta = patch.balanceMinorUnits - stored;

      if (delta === 0) {
        return;
      }

      await tx.insert(transactions).values({
        id: id(),
        holdingId,
        amountMinorUnits: delta,
        time,
        description: '',
        source: 'manual',
      });
    }),
```

Note this inserts the transaction **directly** rather than calling `recordManualTx` — `recordManualTx` also *adjusts the balance*, which the `set(patch)` above has already done to the absolute value. Say so in the code comment so a future reader does not "DRY" the two together and double-apply the delta.

`transactions` is already imported in this file (`:4`); `id` is at `:3`.

- [ ] **Step 6: Seed the opening transaction in `createCashAccount`**

In `src/repositories/accounts.repo.ts:83-107`, inside the same `write` transaction, after the holding insert:

```ts
      const holdingId = id();
      await tx.insert(holdings).values({
        id: holdingId,
        accountId,
        name,
        type: 'cash',
        currency,
        balanceMinorUnits: initialBalanceMinorUnits,
      });

      // The initial balance is a manual adjustment like any other, so it gets
      // its own ledger row (kiko-domain: a holding's balance history must stay
      // derivable from its transactions). Without it `holdingValueAt`
      // back-derived the opening balance from `balance - sum(transactions)`,
      // so the whole historical net-worth series carried an unexplained step.
      if (initialBalanceMinorUnits !== 0) {
        await tx.insert(transactions).values({
          id: id(),
          holdingId,
          amountMinorUnits: initialBalanceMinorUnits,
          time: Date.now(),
          description: '',
          source: 'manual',
        });
      }
```

`transactions` is already imported at `:6`. Using `Date.now()` inside a repository is acceptable here (the row's `createdAt` default already does the same); if the reviewer prefers injection, add an optional `time` to `NewCashAccount` and pass it from the form.

- [ ] **Step 7: Route the form through it**

In `src/screens/forms/holding-form.screen.tsx`, the edit branch at `:430-441` currently calls `holdingsRepo.update(holdingId, buildHoldingPatch({...}))`. Change to `holdingsRepo.updateWithBalanceDelta(holdingId, buildHoldingPatch({...}), Date.now())`.

Leave `buildHoldingPatch` (`:97-101`) itself alone — it already emits `balanceMinorUnits` only for the non-synced, non-deposit/bond branch, which is exactly the set of types whose balance a user edits.

Leave `holdingsRepo.update`'s bare `set(patch)` in place: `setIcon`, the sync's own writes and the reorder path all use `update` for non-balance fields and must not start writing ledger rows. Add a one-line doc note on `update` pointing at `updateWithBalanceDelta` for any patch that touches `balanceMinorUnits`.

- [ ] **Step 8: Run green**

```bash
npx jest src/repositories src/screens/forms/holding-form.screen.test.tsx src/screens/forms/account-form.screen.test.tsx src/statistics src/screens/holding-detail
npm run check:typecheck
```

Expected: PASS. `holding-value-at.test.ts` and `net-worth-series.test.ts` may have fixtures that relied on the un-ledgered balance — read any failure carefully; the invariant is now that balance and transactions agree.

---

## Task 19: T-20 — Scope the Expenses-by-Category donut to the active date range

**Confidence: PLAUSIBLE — run the confirm step first.**

`rangeFrom`/`rangeTo` (`src/screens/statistics/statistics.screen.tsx:228-229`) are consumed only by `buildNetWorthSeries` (`:292-308`). `transactionsWithCurrency` (`:337-350`) is built from the **unfiltered** ledger, so the donut and its center total sum every expense ever recorded while the range field above reads e.g. 07.08.2026 – 06.09.2026.

**A note on the justification.** The spec says "the screen's own doc comment says the range scopes the first three sections". Read `:129-146`: it actually says "A shared account multi-select and a date range scope the first three; the date range additionally bounds the line's window" — and the donut is the **fourth** block, so the comment does not claim the donut is scoped. It is also loose about the other three: the bar chart and the account pie are explicitly "now" snapshots and never read the range either. So the comment is not the authority here; the UX is (a visible range field above an all-time total is misleading). The coordinator has decided to scope the donut. This task therefore **also corrects that doc comment** to state the real contract.

**Files:**
- Modify: `src/screens/statistics/statistics.screen.tsx:129-146` (doc comment), `:337-350` (`transactionsWithCurrency`)
- Test: `src/screens/statistics/statistics.screen.test.tsx`

- [ ] **Step 1: Run the confirm step (PLAUSIBLE)**

Seed one expense inside the default 30-day window and one 60 days ago, render the screen, and read the donut's center total. Both must be included for the bug to be real. Write it as the Step 2 test and confirm it fails.

- [ ] **Step 2: Write the failing test**

```tsx
it('excludes an expense outside the active range from the donut', async () => {
  const now = Date.now();
  mockTransactions = [
    makeRow({ id: 'inside', holdingId: 'h-1', amountMinorUnits: -100_00, time: now - 5 * DAY_MS }),
    makeRow({ id: 'outside', holdingId: 'h-1', amountMinorUnits: -900_00, time: now - 60 * DAY_MS }),
  ];

  const { getByTestId } = await renderScreen();

  // The donut's center total is the sum of its visible slices.
  expect(getByTestId('category-donut-center').props.children).toContain('100');
  expect(getByTestId('category-donut-center').props.children).not.toContain('1 000');
});
```

Read the file for the donut's real center testID (`PieChart`'s `centerTotal`) and for the fixture helper.

- [ ] **Step 3: Run it and confirm it fails**

```bash
npx jest src/screens/statistics/statistics.screen.test.tsx
```

Expected: the center total is 1,000.00 — both expenses.

- [ ] **Step 4: Filter by the range before the exclusion/breakdown memos**

In `transactionsWithCurrency` (`:337-350`), add the range test inside the existing `flatMap`, and add `rangeFrom`/`rangeTo` to the memo's dependency array:

```tsx
  // Scoped to the ACTIVE date range, so the donut and its center total agree
  // with the range field rendered above them. Filtering HERE (not inside the
  // breakdown) means every downstream memo — the internal-transfer matcher,
  // the mcc/description/exchange exclusion sets, the breakdown itself — sees
  // the same in-range window, so an internal transfer whose two legs straddle
  // the boundary cannot be half-excluded.
  const transactionsWithCurrency = useMemo(() => {
    const currencyByHolding = new Map(
      filtered.visibleHoldings.map((holding) => [holding.id, holding.currency]),
    );

    return transactions.flatMap((transaction) => {
      if (transaction.time < rangeFrom || transaction.time > rangeTo) {
        return [];
      }

      const currency = currencyByHolding.get(transaction.holdingId);

      if (currency === undefined) {
        return [];
      }

      return [{ ...transaction, currency }];
    });
  }, [transactions, filtered, rangeFrom, rangeTo]);
```

Note the comment's claim about straddling legs is the reason to filter here rather than in `buildCategoryBreakdown` — keep it.

- [ ] **Step 5: Correct the screen's doc comment**

Rewrite the range sentence at `:133-137` to the real contract:

```
 * A shared account multi-select scopes all four blocks. The date range bounds
 * the net-worth line's window AND the category donut's transaction set; the
 * by-type bar and the account pie are "now" snapshots of current value and
 * read no range at all. The category donut additionally has its own,
 * separate category filter.
```

- [ ] **Step 6: Run green**

```bash
npx jest src/screens/statistics src/statistics
npm run check:typecheck
```

---

## Task 20: T-21 — Seed ten distinct colors for the ten seeded categories

**Confidence: CONFIRMED.**

`categoryColor` (`src/statistics/category-breakdown.ts:51-58`) hashes a key over the 8-entry `chartSeries` palette (`src/design-system/theme.ts:66-75`). Run over the ten keys seeded by `drizzle/migrations/0002_seed_categories.sql`, that yields only **5** distinct colors (verified against the real palette):

```
groceries #BF5AF2   dining #30D158   transport #30D158   shopping #0A84FF
utilities #FF9F0A   entertainment #0A84FF   health #40C8E0   cash #BF5AF2
transfers #0A84FF   other #0A84FF
```

Collision groups: `#0A84FF` = shopping/entertainment/transfers/other (four identical blue wedges), `#30D158` = dining/transport, `#BF5AF2` = groceries/cash.

`resolveCategoryColor` already prefers a **stored** `categories.color` over the hash (`:68-74`), so seeding explicit colors is the fix with no code change at all — and the coordinator has approved a new seed migration. `theme.colors.entityColors` has 14 distinct swatches, more than enough for ten.

**Files:**
- Create: `drizzle/migrations/0016_seed_category_colors.sql`
- Modify: `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js`
- Test: `src/statistics/category-breakdown.test.ts`, the migration-registration test

- [ ] **Step 1: Write the failing test in `src/statistics/category-breakdown.test.ts`**

```ts
it('resolves the ten seeded categories to ten distinct colors', () => {
  // The seeded colors, as written by migration 0016 — this test is the
  // contract between the migration and the chart layer.
  const seeded: Record<string, string> = {
    groceries: '#30D158',
    dining: '#FF9F0A',
    transport: '#0A84FF',
    shopping: '#BF5AF2',
    utilities: '#FFD60A',
    entertainment: '#FF375F',
    health: '#FF453A',
    cash: '#66D4CF',
    transfers: '#5E5CE6',
    other: '#98989D',
  };

  const resolved = Object.entries(seeded).map(([key, color]) => resolveCategoryColor(color, key));

  expect(new Set(resolved).size).toBe(10);
  expect(resolved).toEqual(Object.values(seeded));
});

it('still collapses the ten keys onto 5 hues WITHOUT stored colors, which is why the seed exists', () => {
  const keys = Object.keys(SEEDED_CATEGORY_KEYS);

  expect(new Set(keys.map((key) => categoryColor(key))).size).toBeLessThan(10);
});
```

The second test documents *why* the migration is needed and must keep passing — the hash fallback is unchanged and still collides; the seed is what makes the ten distinct.

- [ ] **Step 2: Run it and confirm the failure**

```bash
npx jest src/statistics/category-breakdown.test.ts
```

Expected: the first test fails only if a color is duplicated in the literal above — so first verify the ten values are distinct and are real `theme.colors.entityColors` members (read `src/design-system/theme.ts:47-62`). The genuinely failing assertion arrives in Step 4's migration test.

- [ ] **Step 3: Write the migration**

Create `drizzle/migrations/0016_seed_category_colors.sql`:

```sql
/*
 Give each of the ten seeded categories an explicit, distinct color.

 With `categories.color` null, the chart layer falls back to `categoryColor`
 (statistics/category-breakdown.ts) — a hash of the key over the 8-entry
 `chartSeries` palette. Over these exact ten keys that hash collapses to FIVE
 distinct hues: shopping/entertainment/transfers/other all render #0A84FF (four
 identical blue donut wedges), dining/transport both #30D158, groceries/cash
 both #BF5AF2. `resolveCategoryColor` prefers a STORED color over the hash, so
 seeding one per category fixes the donut, the Home filter chips and the
 category-row icons at once, with no code change.

 Every value is a `theme.colors.entityColors` member (src/design-system/theme.ts),
 so a category swatch reads as the same family as every account/holding swatch.
 Only a category whose color is still NULL is touched, so a user who has
 already picked a color keeps it, and re-running is a no-op.
*/
UPDATE `categories` SET `color` = '#30D158' WHERE `key` = 'groceries' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#FF9F0A' WHERE `key` = 'dining' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#0A84FF' WHERE `key` = 'transport' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#BF5AF2' WHERE `key` = 'shopping' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#FFD60A' WHERE `key` = 'utilities' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#FF375F' WHERE `key` = 'entertainment' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#FF453A' WHERE `key` = 'health' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#66D4CF' WHERE `key` = 'cash' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#5E5CE6' WHERE `key` = 'transfers' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#98989D' WHERE `key` = 'other' AND `color` IS NULL;
```

Register it as a data-only migration (journal entry with `idx: 16` and a `when` greater than 0015's, plus the `m0016` import and object entry in `migrations.js`; **no** snapshot). Follow Task 6 Step 8's procedure exactly.

Also update `drizzle/migrations/0002_seed_categories.sql`? **No** — never edit a shipped migration; 0016 is the correction.

- [ ] **Step 4: Add the migration-registration assertion**

```ts
it('seeds a distinct color for each of the ten seeded categories', () => {
  const combined = sqlFiles().join('\n');
  const colors = [...combined.matchAll(/UPDATE `categories` SET `color` = '(#[0-9A-F]{6})'/g)].map(
    (match) => match[1],
  );

  expect(colors).toHaveLength(10);
  expect(new Set(colors).size).toBe(10);
  expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain('0016');
});
```

- [ ] **Step 5: Run green**

```bash
npx jest src/statistics src/db src/screens/settings/categories.screen.test.tsx src/screens/home src/screens/statistics
npm run check:typecheck
```

- [ ] **Step 6: Queue the visual verification**

Record for the final section — **MANUAL-3 (ops, simulator):** open Statistics and confirm the Expenses-by-Category donut renders no two adjacent wedges in the same hue, and that the Home category filter chips match their row icons.

---

## Task 21: T-22 — Scale bar widths against the largest MAGNITUDE and clamp to a non-negative width

**Confidence: CONFIRMED for the math and code path; the negative-slice reachability is PLAUSIBLE.**

`BarRow` computes `const width = (slice.amount / max) * VIEW_WIDTH;` (`src/design-system/components/bar-chart/bar-chart.component.tsx:58`) and passes it straight into `<Rect width>` (`:78-86`). `max` is `data[0].amount` (`:106`) — the largest *signed* entry, since `buildTypeBreakdown` (`src/statistics/type-breakdown.ts:52`) filters only `amount !== 0` and sorts descending, keeping negatives. The line-57 comment claims `max` is guarded non-zero, but nothing guards its **sign**.

Two failure shapes:
- **Mixed data**: an overdrawn Monobank credit card (`sync.ts:129` writes `account.balance` verbatim, which Monobank reports negative) gives width −160 → `CGPathAddRoundedRect` draws nothing while the money label still reads −$5,000.00.
- **All-negative data**: `max` is the *largest negative*, so widths become 320 and 16000 — every bar renders full-width.

Verified: `node -e "const d=[{a:1000000},{a:-500000}];console.log(d.map(x=>(x.a/d[0].a)*320))"` → `[320, -160]`.

The passthrough mock (`__mocks__/react-native-svg.tsx:20`) accepts `width={-160}` without complaint, which is why no existing test catches it — exactly the `kiko-charts` reason every primitive carries a `testID`.

**Chosen fix: scale against `Math.max(...data.map(abs))` and clamp the rendered width to `[0, VIEW_WIDTH]`.** Keep negative slices in the chart (the money label is the honest figure and an overdrawn card is real information); only the geometry is corrected. Do **not** `abs()` the amounts in `buildTypeBreakdown` — that would misreport the label.

**Files:**
- Modify: `src/design-system/components/bar-chart/bar-chart.component.tsx:49-90`, `:100-112`
- Test: `src/design-system/components/bar-chart/bar-chart.component.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('never renders a negative bar width', async () => {
  const { getByTestId } = await render(
    <BarChart
      data={[
        { type: 'cash', amount: 1_000_000 },
        { type: 'card', amount: -500_000 },
      ]}
      baseCurrency="USD"
    />,
  );

  const width = Number(getByTestId('bar-chart-bar-card').props.width);

  expect(width).toBeGreaterThanOrEqual(0);
  expect(width).toBeLessThanOrEqual(320);
});

it('scales against the largest magnitude, so a negative slice is half of a double-sized positive', async () => {
  const { getByTestId } = await render(
    <BarChart
      data={[
        { type: 'cash', amount: 1_000_000 },
        { type: 'card', amount: -500_000 },
      ]}
      baseCurrency="USD"
    />,
  );

  expect(Number(getByTestId('bar-chart-bar-cash').props.width)).toBe(320);
  expect(Number(getByTestId('bar-chart-bar-card').props.width)).toBe(160);
});

it('does not render every bar full-width for all-negative data', async () => {
  const { getByTestId } = await render(
    <BarChart
      data={[
        { type: 'cash', amount: -100_000 },
        { type: 'card', amount: -500_000 },
      ]}
      baseCurrency="USD"
    />,
  );

  expect(Number(getByTestId('bar-chart-bar-card').props.width)).toBe(320);
  expect(Number(getByTestId('bar-chart-bar-cash').props.width)).toBe(64);
});

it('still renders the honest signed money label for a negative slice', async () => {
  const { getByText } = await render(
    <BarChart data={[{ type: 'card', amount: -500_000 }]} baseCurrency="USD" />,
  );

  expect(getByText(/-/)).toBeTruthy();
});
```

Read `VIEW_WIDTH`'s actual value in the component before hardcoding 320 in the expectations — use the imported constant if it is exported, otherwise assert relative ratios.

- [ ] **Step 2: Run them and confirm the failures**

```bash
npx jest src/design-system/components/bar-chart
```

Expected: the negative bar's width is −160; the all-negative case gives 320 and 16000.

- [ ] **Step 3: Scale on magnitude and clamp**

In `BarChart` (`:100-112`), replace `const max = data[0].amount;`:

```tsx
  // Scale against the largest MAGNITUDE, not the largest signed value. `data`
  // is sorted descending and `buildTypeBreakdown` keeps negatives (an
  // overdrawn Monobank credit card writes `account.balance` verbatim), so
  // `data[0].amount` could be a negative maximum — which made every bar's
  // `amount / max` ratio >= 1 and rendered them all full-width, and made a
  // single negative slice among positives a NEGATIVE width that
  // CGPathAddRoundedRect silently drew as nothing while the money label still
  // read the real figure. Guarded non-zero: `buildTypeBreakdown` filters
  // `amount !== 0`, but an empty-after-filter list is handled above and a
  // defensive `|| 1` keeps the division total.
  const scale = Math.max(...data.map((slice) => Math.abs(slice.amount))) || 1;
```

and pass `max={scale}` (rename the prop to `scale` on `BarRow` for honesty). In `BarRow` (`:58`):

```tsx
  // Clamped into the plot: the magnitude scale above already keeps the ratio
  // in [0, 1], and the clamp makes a future mis-scaled value structurally
  // incapable of producing an invisible (negative-width) or overflowing bar.
  const width = Math.min(Math.max((Math.abs(slice.amount) / scale) * VIEW_WIDTH, 0), VIEW_WIDTH);
```

Delete the now-false comment at `:56-57` and replace it with the two above.

- [ ] **Step 4: Run green**

```bash
npx jest src/design-system/components/bar-chart src/statistics/type-breakdown.test.ts src/screens/statistics
npm run check:typecheck
```

---

## Task 22: T-23 — Resolve the account-contribution slice color through `resolveEntityColor`

**Confidence: CONFIRMED.**

`buildAccountContribution` (`src/statistics/account-contribution.ts:57`) does `const color = account.color ?? defaultAccountColor[account.kind];` — the bare-`??` pattern the `kiko-design-system` skill explicitly forbids, because it misses a stored empty string and an unmapped kind. This is the **only** remaining call site of the pattern; the other eight already use `resolveEntityColor` (e.g. `accounts.screen.tsx:112`). The schema's `kind` enum is TS-only with no `CHECK` constraint, so a row written under a since-removed enum member (`broker` was once valid and was dropped) with `color` null resolves to `undefined` → `<Path fill={undefined}>` renders black on the black card and the legend swatch is transparent (`pie-chart.component.tsx:113`, `:173`), while the slice still consumes ring share.

Verified: `buildAccountContribution({ accounts: [{ id: 'a', name: 'X', kind: 'broker', color: null }] })` → `slices[0].color` is `undefined`.

**Files:**
- Modify: `src/statistics/account-contribution.ts:1-10` (import), `:57`
- Test: `src/statistics/account-contribution.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
const HEX = /^#[0-9a-f]{6}$/i;

it('resolves a stored empty-string color to a real hex', () => {
  const slices = buildAccountContribution({
    accounts: [{ id: 'a', name: 'X', kind: 'cash', color: '' }],
    holdings: [{ id: 'h', accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_00, type: 'cash' }],
    rateTable: {},
    baseCurrency: 'UAH',
    now: 0,
  });

  expect(slices[0].color).toMatch(HEX);
});

it('resolves an unmapped kind to a real hex, never undefined', () => {
  const slices = buildAccountContribution({
    // `broker` was a valid Account.kind once and was dropped; the schema enum
    // is TS-only with no CHECK constraint, so such a row can still exist.
    accounts: [{ id: 'a', name: 'X', kind: 'broker' as AccountRow['kind'], color: null }],
    holdings: [{ id: 'h', accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_00, type: 'cash' }],
    rateTable: {},
    baseCurrency: 'UAH',
    now: 0,
  });

  expect(slices[0].color).toMatch(HEX);
});

it('still prefers a valid stored color', () => {
  const slices = buildAccountContribution({
    accounts: [{ id: 'a', name: 'X', kind: 'cash', color: '#123456' }],
    holdings: [{ id: 'h', accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_00, type: 'cash' }],
    rateTable: {},
    baseCurrency: 'UAH',
    now: 0,
  });

  expect(slices[0].color).toBe('#123456');
});
```

Read the file's real input types for the exact holding/account fixture shape.

- [ ] **Step 2: Run it and confirm the failure**

```bash
npx jest src/statistics/account-contribution.test.ts
```

Expected: the empty-string case returns `''`; the unmapped-kind case returns `undefined`.

- [ ] **Step 3: Route through `resolveEntityColor`**

At `src/statistics/account-contribution.ts:57`:

```ts
      // `resolveEntityColor` (design-system/entity-tint.ts) is the ONE function
      // that picks an entity's effective color: a valid stored hex, else the
      // kind default, else a safe gray. A bare `stored ?? default` let an
      // empty-string color and an unmapped kind (a row written under a
      // since-removed enum member — the schema enum is TS-only, no CHECK
      // constraint) reach the chart as `''`/`undefined`, so `<Path fill>` drew
      // black on the black card and the legend swatch was transparent while
      // the slice still consumed ring share. Every other call site in the app
      // already uses this; this was the last hold-out.
      const color = resolveEntityColor(account.color, defaultAccountColor[account.kind]);
```

Read `resolveEntityColor`'s real signature in `src/design-system/entity-tint.ts` first and match it — the second argument may be the kind rather than the resolved default.

- [ ] **Step 4: Run green**

```bash
npx jest src/statistics src/design-system/components/pie-chart src/screens/statistics
npm run check:typecheck
```

---

## Task 23: T-25 — Apply the persisted language before the first gate paints

**Confidence: CONFIRMED.**

`src/i18n/index.ts:19` initializes i18next with `lng: deviceLanguage()`, and `useSyncLanguageWithSettings` (`src/i18n/use-sync-language-with-settings.ts:15-23`) is the only `changeLanguage` caller — mounted from `AppRoot` (`App.tsx:36`), which renders only **after** `MigrationsGate` succeeds **and** `LockGate` unlocks. So with device `en`, `settings.language = 'uk'` and app lock on, a cold launch shows "Preparing database…" then "Locked" / "Unlock with Face ID…" / "Unlock" in **English**; Ukrainian appears only after Face ID succeeds. The mirror case shows a Ukrainian lock screen to an `en` device user.

Task 1 already guaranteed the settings row exists inside the gate's init chain, which is what makes this fix possible.

**Files:**
- Modify: `src/db/migrations.gate.tsx:19-43`
- Test: `src/db/migrations.gate.test.tsx`, `src/auth/lock-gate/lock-gate.component.test.tsx`

**Interfaces:**
- Consumes: the settings row guaranteed by Task 1's `settingsRepo.ensure()` step.
- Produces: by the time `MigrationsGate` reports `success`, `i18n.language` equals the persisted `settings.language` (when one is stored). `useSyncLanguageWithSettings` stays mounted in `AppRoot` and remains responsible for a **live** switch from the Settings screen; this task only fixes the cold-launch window.

- [ ] **Step 1: Write the failing test in `src/auth/lock-gate/lock-gate.component.test.tsx`**

```tsx
it('renders the lock screen in the persisted language, not the device language', async () => {
  // Device is `en` (the i18n module's init default under test), settings say `uk`.
  mockSettingsRows = [{ language: 'uk', lockEnabled: true }];

  const { getByText } = await render(
    <MigrationsGate>
      <LockGate>
        <Text>unlocked</Text>
      </LockGate>
    </MigrationsGate>,
  );

  await waitFor(() => {
    expect(getByText('Заблоковано')).toBeTruthy();
  });
});
```

This renders `MigrationsGate` around `LockGate` deliberately — that composition is what the fix relies on, and it matches `App.tsx:56-63`.

- [ ] **Step 2: Write the failing test in `src/db/migrations.gate.test.tsx`**

```tsx
it('applies the persisted language before reporting success', async () => {
  mockSettingsRows = [{ language: 'uk' }];

  await render(
    <MigrationsGate>
      <Text>ready</Text>
    </MigrationsGate>,
  );

  expect(mockChangeLanguage).toHaveBeenCalledWith('uk');
});

it('leaves the device language alone when none is persisted', async () => {
  mockSettingsRows = [{ language: null }];

  await render(
    <MigrationsGate>
      <Text>ready</Text>
    </MigrationsGate>,
  );

  expect(mockChangeLanguage).not.toHaveBeenCalled();
});

it('does not fail the gate when the language read throws', async () => {
  mockGetSettings.mockRejectedValueOnce(new Error('db gone'));

  const { getByText } = await render(
    <MigrationsGate>
      <Text>ready</Text>
    </MigrationsGate>,
  );

  // A language preference is cosmetic: it must never block the app from
  // starting.
  expect(getByText('ready')).toBeTruthy();
});
```

- [ ] **Step 3: Run both and confirm the failures**

```bash
npx jest src/db/migrations.gate.test.tsx src/auth/lock-gate
```

Expected: `changeLanguage` is never called from the gate; the lock screen renders "Locked".

- [ ] **Step 4: Resolve the language in the gate's init chain**

In `src/db/migrations.gate.tsx`, add a module-level helper above the component and a step to the chain **after** `settingsRepo.ensure()`:

```tsx
/**
 * Apply the persisted language before the first gate paints.
 *
 * i18next initializes with the DEVICE language (src/i18n/index.ts), and the
 * only `changeLanguage` caller (`useSyncLanguageWithSettings`) is mounted from
 * `AppRoot` — which renders only after this gate succeeds AND `LockGate`
 * unlocks. So a user with device `en` and `settings.language = 'uk'` read
 * "Preparing database…", "Locked", "Unlock with Face ID…" and "Unlock" in
 * English on every cold launch, with Ukrainian appearing only after Face ID
 * succeeded (and the mirror case showed a Ukrainian lock screen to an `en`
 * user).
 *
 * A failure here is swallowed: the language is cosmetic and must never block
 * the app from starting. `useSyncLanguageWithSettings` still handles a LIVE
 * switch from the Settings screen.
 */
const applyPersistedLanguage = async (): Promise<void> => {
  const settled = await either(async () => {
    const rows = await settingsRepo.getQuery();
    const language = rows.at(0)?.language;

    if (language != null && language !== i18n.language) {
      await i18n.changeLanguage(language);
    }
  });

  // Nothing to do on a Left: the device language stays active.
  if (isLeft(settled)) {
    return;
  }
};
```

If routing this through `fnts`' `either` reads worse than a plain `try`/`catch` here, use `try`/`catch` — `kiko-code-style` carves out exactly this case ("a React early-return guard was correctly left as plain JSX rather than routed through `maybe`/`fold`"), and a gate's bootstrap step is closer to that than to a data-layer call. Pick one and keep it readable; do not leave a no-op `if`.

Then in the chain:

```tsx
    initDatabase()
      .then(runMigrations)
      .then(() => settingsRepo.ensure())
      .then(applyPersistedLanguage)
      .then(migrateLegacyToken)
```

`settingsRepo.getQuery()` returns a Drizzle query builder, awaited here rather than passed to `useLiveQuery` — that is correct for a one-shot bootstrap read (the repo's read functions return builders precisely so a caller can choose), and `settings.repo.ts:14` is already awaited this way by `sync.ts:94`.

- [ ] **Step 5: Run green**

```bash
npx jest src/db src/auth src/i18n __tests__/App.test.tsx
npm run check:typecheck
```

- [ ] **Step 6: Queue the manual verification**

**MANUAL-4 (user, device):** set the device language to English, set Kiko's language to Ukrainian in Settings, enable the app lock, force-quit and cold-launch. Every pre-unlock screen ("Готуємо базу даних…", "Заблоковано", "Розблокувати") must be Ukrainian.

---

### CHECKPOINT after Task 23 — medium tier complete

```bash
npm run check:all
npm run check:typecheck
npx jest
```

---

## Task 24: T-29 — BLOCKED: recap-OFF vs recap-ON first accrual day

**Confidence: PLAUSIBLE. Status: BLOCKED — do not implement. This task writes no code.**

`depositLedger` (recap-ON, statement-validated) earns from the **day after** a tranche lands (`src/holdings/interest.ts:137-140` `dayAfter`, `:244-247` tranches), while `depositAccruedMajor` (recap-OFF, `:326-342`) counts from the contribution date itself via `daysBetween(c.date, end)`. So 10,000 at 10% over a year yields **365** days of interest in the recap-OFF engine and **364** in the recap-ON one. `interest.test.ts:259-263` pins the current recap-OFF behaviour as-is.

**Why this is blocked.** The project rule for money math is to match a real bank statement line by line, not just the total ("Money precision, chase exact parity"). The recap-ON engine's `dayAfter` convention was validated against a real statement; **no recap-OFF statement is available**, so there is no evidence for which convention the bank actually applies when capitalization is off. Changing `depositAccruedMajor` to `dayAfter` on symmetry grounds alone would be a guess that silently moves every recap-OFF deposit's displayed value by one day of interest — and if the guess is wrong, it replaces a possibly-correct engine with a definitely-unverified one.

- [ ] **Step 1: Record the blocker, write no code**

Add nothing to `src/holdings/interest.ts`. Instead add a `TODO`-free doc note directly above `depositAccruedMajor` (`:326`) recording the discrepancy and its blocker, so the next reader does not "fix" it blind:

```ts
// KNOWN DISCREPANCY, deliberately unresolved: this engine (recap OFF) accrues
// from the contribution DATE, while `depositLedger` (recap ON) accrues from
// the day AFTER a tranche lands (`dayAfter`). Over a year on a single
// contribution that is 365 days here versus 364 there.
//
// `depositLedger`'s convention was validated line-by-line against a real bank
// statement. No recap-OFF statement exists to validate this one against, and
// the project rule for money math is to match a real statement rather than
// reason by symmetry — so this is NOT changed on the assumption that the two
// engines "should" agree. Resolve it only against a real recap-OFF statement.
```

- [ ] **Step 2: Report the blocker to the coordinator with the test that resolves it**

The developer reports: **T-29 is blocked pending a real recap-OFF bank statement from the user.** When one arrives, the test to write first is:

```ts
it('agrees with the recap-ON engine on the first accrual day', () => {
  const start = local(2025, 0, 15);
  const end = start + 365 * DAY_MS;

  const recapOff = depositAccruedMajor([{ amountMajor: 10_000, date: start }], 10, 120, end);
  const recapOn = depositLedger(
    [{ amountMinor: 10_000_00, date: start }],
    10,
    'annually',
    12,
    end,
  );

  // Both engines must count the SAME number of accrual days for the same
  // single contribution over the same span. Which count is right — 364 or
  // 365 — is decided by the statement, not by this assertion; fill in the
  // statement's own figure here.
  expect(recapOff).toBeCloseTo(recapOn.accruals[0].grossMajor, 2);
});
```

The statement determines which side moves. Do not write this test now — a test asserting an unverified convention is worse than the known discrepancy.

---

## Task 25: T-30 — Page the statement window to the earliest item's exact second, not one second before it

**Confidence: CONFIRMED.**

On a capped (500-item) page, `fetchAllStatements` sets the next ceiling to `Math.min(...items.map((item) => item.time)) - 1` (`src/monobank/sync.ts:250-251`). Any item sharing that exact second that did not fit in the page is excluded from every later window and never imported. The `(source, external_id)` unique index makes a one-second overlap idempotent, so there is no reason to subtract.

**Files:**
- Modify: `src/monobank/sync.ts:250-251`
- Test: `src/monobank/sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('pages to the earliest item second itself, importing a same-second straggler', async () => {
  const boundary = 1_700_000_000;
  // A full page whose earliest 2 items share `boundary`, but only ONE of them
  // fits — the other must still be reachable in the next window.
  const page = Array.from({ length: 500 }, (_, index) =>
    statementItem({ id: `p1-${index}`, time: index === 499 ? boundary : boundary + 1000 + index }),
  );
  const straggler = statementItem({ id: 'straggler', time: boundary });

  const deps = makeInMemoryDeps({
    clientInfo: { accounts: [card('acc-a')] },
    statementFor: (_accountId, _from, to) => (to > boundary - 1 && to >= boundary ? page : [straggler]),
  });

  await runSync(deps);

  const windows = deps.fetchStatement.mock.calls.map(([, , , to]) => to);

  expect(windows).toContain(boundary);
  expect(deps.transactionsStore.some((row) => row.externalId === 'straggler')).toBe(true);
});
```

Read `sync.test.ts`'s `statementFor` signature and `MAX_ITEMS_PER_RESPONSE` before finalising the fixture; the assertion that must hold is that a subsequent `fetchStatement` is issued with `to === boundary` (not `boundary - 1`) and that the straggler lands.

- [ ] **Step 2: Run it and confirm the failure**

```bash
npx jest src/monobank/sync.test.ts
```

Expected: `windows` contains `boundary - 1` and the straggler is never imported.

- [ ] **Step 3: Drop the `- 1`**

At `src/monobank/sync.ts:250-251`:

```ts
    const hitCap = items.length >= MAX_ITEMS_PER_RESPONSE;
    // On a capped page the next ceiling is the earliest item's own second, NOT
    // one second before it: items sharing that exact second that did not fit
    // in the page were otherwise excluded from every later window and never
    // imported. The resulting one-second overlap is free — the
    // `(source, external_id)` unique index makes a re-fetched item idempotent
    // (an upsert since T-16, a skip before it).
    windowTo = hitCap ? Math.min(...items.map((item) => item.time)) : windowFrom - 1;
```

Note the non-capped branch keeps its `- 1`: that steps to the previous 31-day window, where `windowFrom` was already the inclusive floor of the window just queried, so subtracting avoids re-querying that exact second unnecessarily. Leave it.

Also update `fetchAllStatements`' doc comment (`:218-225`), which says "we narrow the ceiling to just before the earliest item".

- [ ] **Step 4: Confirm the loop still terminates**

The `while (windowTo > fromSeconds)` guard now sees an unchanged `windowTo` if a capped page's items all share one second. Add a termination guard test:

```ts
it('terminates when a full page shares a single second', async () => {
  const boundary = 1_700_000_000;
  const page = Array.from({ length: 500 }, (_, index) =>
    statementItem({ id: `p-${index}`, time: boundary }),
  );

  const deps = makeInMemoryDeps({
    clientInfo: { accounts: [card('acc-a')] },
    statementFor: () => page,
  });

  await expect(runSync(deps)).resolves.toBeDefined();
});
```

If this hangs, the loop needs an explicit break: when the computed `windowTo` equals the previous `windowTo`, step to `windowTo - 1` for that one iteration and add a comment explaining that 500 items in one second is pathological but must not spin. Write that guard only if the test proves it necessary.

- [ ] **Step 5: Run green**

```bash
npx jest src/monobank
npm run check:typecheck
```

---

## Task 26: T-31 — Validate the Binance payload instead of writing a fabricated balance

**Confidence: PLAUSIBLE — run the confirm step first.**

`fetchBalances` (`src/crypto-sync/binance/binance.provider.ts:40-42`, `:61-63`) returns `fetchAccount`'s parsed body unchecked. `(account.balances ?? [])` turns a malformed payload into a **0-satoshi** balance written over the stored BTC holding, and `toSatoshis` runs `Number(balance.free)` with no finite check, so a non-numeric string writes `NaN` into a `notNull` integer column.

**Files:**
- Modify: `src/crypto-sync/binance/binance.provider.ts:36-70`
- Test: `src/crypto-sync/binance/binance.provider.test.ts`

- [ ] **Step 1: Run the confirm step (PLAUSIBLE)**

```ts
it('confirms the current behaviour before fixing it', async () => {
  const zero = await binanceProvider.fetchBalances({ ...deps, fetchAccount: async () => ({}) });
  const nan = await binanceProvider.fetchBalances({
    ...deps,
    fetchAccount: async () => ({ balances: [{ asset: 'BTC', free: 'x', locked: '0' }] }),
  });

  expect(zero[0].balanceMinorUnits).toBe(0);
  expect(Number.isNaN(nan[0].balanceMinorUnits)).toBe(true);
});
```

Run it. If either assertion fails, the bug does not reproduce — stop and report. Then delete this scaffolding test and replace it with Step 2's.

- [ ] **Step 2: Write the failing test**

```ts
it('rejects a body with no balances array', async () => {
  await expect(
    binanceProvider.fetchBalances({ ...deps, fetchAccount: async () => ({}) }),
  ).rejects.toThrow(/Binance/);
});

it('rejects a body whose balances is not an array', async () => {
  await expect(
    binanceProvider.fetchBalances({ ...deps, fetchAccount: async () => ({ balances: 'nope' }) }),
  ).rejects.toThrow(/Binance/);
});

it('rejects a non-finite free/locked amount rather than writing NaN', async () => {
  await expect(
    binanceProvider.fetchBalances({
      ...deps,
      fetchAccount: async () => ({ balances: [{ asset: 'BTC', free: 'x', locked: '0' }] }),
    }),
  ).rejects.toThrow(/Binance/);
});

it('reports a genuine zero balance as zero', async () => {
  const balances = await binanceProvider.fetchBalances({
    ...deps,
    fetchAccount: async () => ({ balances: [{ asset: 'BTC', free: '0', locked: '0' }] }),
  });

  expect(balances[0].balanceMinorUnits).toBe(0);
});

it('sums free and locked', async () => {
  const balances = await binanceProvider.fetchBalances({
    ...deps,
    fetchAccount: async () => ({ balances: [{ asset: 'BTC', free: '0.5', locked: '0.25' }] }),
  });

  expect(balances[0].balanceMinorUnits).toBe(75_000_000);
});
```

The fourth test matters: a real zero balance must still be accepted — only a *missing/malformed* payload rejects.

- [ ] **Step 3: Run them and confirm the failures**

```bash
npx jest src/crypto-sync/binance
```

- [ ] **Step 4: Validate the payload**

In `src/crypto-sync/binance/binance.provider.ts`, add module-level narrowing above `binanceProvider`:

```ts
/**
 * Whether the parsed `/api/v3/account` body carries a usable balances array.
 *
 * `fetchAccount` returns the parsed 200 body with no runtime shape check, and
 * `(account.balances ?? [])` turned a malformed payload into a 0-satoshi
 * balance that was WRITTEN OVER the stored BTC holding — a fabricated number
 * indistinguishable from a real zero. Binance answers a throttled or
 * misconfigured request with a 200-plus-error-object often enough that this is
 * a real path, not a hypothetical one.
 */
const hasBalances = (body: unknown): body is { balances: unknown[] } =>
  typeof body === 'object' &&
  body !== null &&
  'balances' in body &&
  Array.isArray((body as { balances: unknown }).balances);

/**
 * Whether one balances entry is a usable BTC row. `free`/`locked` arrive as
 * decimal STRINGS; `Number('x')` is `NaN`, which `toSatoshis` propagated
 * straight into a `notNull` integer column.
 */
const isFiniteAmount = (value: unknown): boolean =>
  typeof value === 'string' && Number.isFinite(Number(value));
```

and in `fetchBalances`, between the `fetchAccount` call and the reduce:

```ts
    const account: unknown = await deps.fetchAccount(credentials.apiKey, credentials.secret, {
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });

    if (!hasBalances(account)) {
      throw new Error('Binance account response did not contain a balances array');
    }

    const btcBalances = account.balances.filter(
      (balance): balance is BinanceBalance =>
        typeof balance === 'object' &&
        balance !== null &&
        (balance as BinanceBalance).asset === BINANCE_ASSET,
    );

    for (const balance of btcBalances) {
      if (!isFiniteAmount(balance.free) || !isFiniteAmount(balance.locked)) {
        throw new Error('Binance balance contained a non-numeric free/locked amount');
      }
    }

    const balanceMinorUnits = btcBalances.reduce((sum, balance) => sum + toSatoshis(balance), 0);
```

Both throws surface through `useSyncAction`, which already renders a sync failure — that is the right outcome: the user sees the sync failed rather than a silently wrong balance. Read `src/screens/use-sync.ts` to confirm the message reaches the UI; if it needs to be a translated string, use an `i18n.t` key and add it to both catalogues (the Monobank sync already does this, e.g. `accountDetail.noMonobankToken`).

Delete the now-false comment at `:57-58` ("default to empty (0 sat)").

- [ ] **Step 5: Run green**

```bash
npx jest src/crypto-sync src/screens/use-sync.test.ts src/screens/account-detail
npm run check:typecheck
```

---

## Task 27: T-32 — Compute a local-day range end from the next calendar day, not a fixed 86,400,000 ms

**Confidence: CONFIRMED.**

`src/screens/statistics/statistics.screen.tsx:229` and `src/screens/home/home.screen.tsx:68` both compute the range end as `startOfLocalDay(dateTo) + DAY_MS - 1`. On the fall-back Sunday (a 25-hour local day in Europe/Kyiv) transactions from 23:00–24:00 local fall outside the range and vanish from the charts and the Home filter; on spring-forward the range spills an hour into the next day.

There are also **three** near-identical `startOfLocalDay` copies today (`src/dates/default-range.ts:9`, `statistics.screen.tsx:63`, `home.screen.tsx:82`), which is both the reason the bug is duplicated and a jscpd risk. Fix it once, in one module.

**Files:**
- Create: `src/dates/local-day.ts`
- Modify: `src/dates/default-range.ts:5-13,20-25`
- Modify: `src/screens/statistics/statistics.screen.tsx:63-70`, `:229`
- Modify: `src/screens/home/home.screen.tsx:60-90`
- Test: `src/dates/local-day.test.ts`, `src/dates/default-range.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/dates/local-day.ts
  /** Local midnight of the calendar day `time` falls on. */
  export const startOfLocalDay = (time: number): number;
  /** The last millisecond of the calendar day `time` falls on (DST-correct). */
  export const endOfLocalDay = (time: number): number;
  ```

- [ ] **Step 1: Write the failing test in `src/dates/local-day.test.ts`**

```ts
describe('endOfLocalDay across DST', () => {
  const withTimeZone = (zone: string, run: () => void): void => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    run();
    process.env.TZ = previous;
  };

  it('spans 25 hours on the fall-back day', () => {
    // Europe/Kyiv falls back on 2026-10-25.
    withTimeZone('Europe/Kyiv', () => {
      const midnight = new Date(2026, 9, 25).getTime();

      expect(endOfLocalDay(midnight) - midnight).toBe(25 * 60 * 60 * 1000 - 1);
    });
  });

  it('spans 23 hours on the spring-forward day', () => {
    // Europe/Kyiv springs forward on 2026-03-29.
    withTimeZone('Europe/Kyiv', () => {
      const midnight = new Date(2026, 2, 29).getTime();

      expect(endOfLocalDay(midnight) - midnight).toBe(23 * 60 * 60 * 1000 - 1);
    });
  });

  it('ends one millisecond before the next local midnight', () => {
    const midnight = new Date(2026, 5, 15).getTime();

    expect(endOfLocalDay(midnight)).toBe(new Date(2026, 5, 16).getTime() - 1);
  });

  it('keeps a 23:30 instant inside its own day on the fall-back day', () => {
    withTimeZone('Europe/Kyiv', () => {
      const at2330 = new Date(2026, 9, 25, 23, 30).getTime();

      expect(at2330).toBeLessThanOrEqual(endOfLocalDay(new Date(2026, 9, 25).getTime()));
    });
  });
});
```

`src/holdings/interest.test.ts:53-60` already sets `process.env.TZ` — read how it does it and reuse the same mechanism (a `TZ` change may need to happen before the first `Date` use in the module, in which case set it in the test file's top-level scope rather than per-test).

- [ ] **Step 2: Run it and confirm the failure**

```bash
npx jest src/dates/local-day.test.ts
```

Expected: the module does not resolve.

- [ ] **Step 3: Write `src/dates/local-day.ts`**

```ts
/**
 * Local midnight of the calendar day `time` falls on.
 *
 * Three near-identical copies of this used to live in `dates/default-range.ts`,
 * `statistics.screen.tsx` and `home.screen.tsx` — which is how the DST bug in
 * `endOfLocalDay` below came to be duplicated across two screens.
 */
export const startOfLocalDay = (time: number): number => {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/**
 * The last millisecond of the calendar day `time` falls on.
 *
 * Computed as the start of the NEXT local calendar day minus 1 ms, never as
 * `startOfLocalDay(time) + 86_400_000 - 1`. A local day is not always 24
 * hours: on Europe/Kyiv's fall-back Sunday it is 25, so the fixed offset cut
 * the last hour off the range and silently dropped every 23:00–24:00
 * transaction from the charts and the Home filter; on spring-forward (a
 * 23-hour day) it spilled an hour into the next day. `new Date(y, m, d + 1)`
 * normalizes a day past the month's end, so no month/year wrap is needed.
 */
export const endOfLocalDay = (time: number): number => {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - 1;
};
```

- [ ] **Step 4: Use it everywhere**

- `src/dates/default-range.ts` — delete the local `startOfLocalDay` (`:5-13`), import the shared one, and keep `defaultDateRange`'s `Date` return shape by wrapping: `const from = new Date(startOfLocalDay(now - 30 * DAY_MS));`. Update the deleted helper's comment: it said "Kept local to this module (mirrors the near-identical helper each screen already defines)" — that is no longer true.
- `src/screens/statistics/statistics.screen.tsx` — delete the local `startOfLocalDay` (`:63-70`), import both helpers, and at `:229`:
  ```tsx
  const rangeTo = dateTo !== null ? endOfLocalDay(dateTo.getTime()) : now;
  ```
- `src/screens/home/home.screen.tsx` — delete the local `startOfLocalDay` (`:82-90`), import both, and in `withinDateRange` (`:63-79`):
  ```tsx
  if (to !== null && time > endOfLocalDay(to.getTime())) {
    return false;
  }
  ```
  Also delete the now-unused `DAY_IN_MS` constant (`:58`) if nothing else uses it, and update `withinDateRange`'s doc comment (`:60-62`), which says the `to` bound "is pushed to the end of its calendar day" — still true, but say *how* (next local midnight minus 1 ms, DST-correct).

The other `startOfLocalDay` uses in `home.screen.tsx` (`:93`, `:119`, `:122`) now call the shared function unchanged.

- [ ] **Step 5: Run green**

```bash
npx jest src/dates src/screens/home src/screens/statistics
npm run check:typecheck
npm run check:dup
```

---

## Task 28: T-33 — Reject a non-positive manual amount

**Confidence: CONFIRMED.**

`tryWriteManual` (`src/screens/forms/transaction-form.screen.tsx:836-848`) guards only empty and NaN: `if (amount.trim() === '' || Number.isNaN(parseAmount(amount)))`. `"0"` passes both, so a 0.00 transaction row is created — despite the guard's own comment saying "no zero-amount row". `saveExchange` (`:780-786`) and `saveConvert` already reject `<= 0` correctly.

**Files:**
- Modify: `src/screens/forms/transaction-form.screen.tsx:836-848`
- Test: `src/screens/forms/transaction-form.screen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('does not write a zero-amount row', async () => {
  const { getByLabelText, getByText } = await renderAddMode();

  await fireEvent.changeText(getByLabelText('Amount'), '0');
  await fireEvent.press(getByText('Groceries'));
  await fireEvent.press(getByText('Save'));

  expect(mockRecordManual).not.toHaveBeenCalled();
});

it('does not write a 0.00 row', async () => {
  const { getByLabelText, getByText } = await renderAddMode();

  await fireEvent.changeText(getByLabelText('Amount'), '0.00');
  await fireEvent.press(getByText('Groceries'));
  await fireEvent.press(getByText('Save'));

  expect(mockRecordManual).not.toHaveBeenCalled();
});

it('still writes the smallest representable amount', async () => {
  const { getByLabelText, getByText } = await renderAddMode();

  await fireEvent.changeText(getByLabelText('Amount'), '0.01');
  await fireEvent.press(getByText('Groceries'));
  await fireEvent.press(getByText('Save'));

  expect(mockRecordManual).toHaveBeenCalledWith(
    expect.objectContaining({ amountMinorUnits: -1 }),
  );
});
```

The third test is the guard rail: the fix must reject zero without rejecting a legitimate one-kopeck amount.

- [ ] **Step 2: Run it and confirm the failure**

```bash
npx jest src/screens/forms/transaction-form.screen.test.tsx
```

Expected: `mockRecordManual` is called with `amountMinorUnits: 0`.

- [ ] **Step 3: Reject a non-positive magnitude**

At `src/screens/forms/transaction-form.screen.tsx:836-848`:

```tsx
  // Guard: reject an empty, non-numeric, or NON-POSITIVE amount, then write
  // the manual edit. Returns whether the write happened, so `save` can abort
  // the whole flow (including the category confirm below) on a bad amount
  // without its own nested branch.
  //
  // The magnitude test is the same `<= 0` rejection `saveExchange` and
  // `saveConvert` already apply. Testing only empty/NaN let `"0"` through and
  // created a 0.00 row, contradicting this guard's own "no zero-amount row"
  // claim. The user's income/expense chip carries the sign, so the typed
  // magnitude is always non-negative here — `<= 0` means "zero".
  const tryWriteManual = async (): Promise<boolean> => {
    const magnitude = parseAmount(amount);

    if (amount.trim() === '' || Number.isNaN(magnitude) || magnitude <= 0) {
      return false;
    }

    await writeManual();

    return true;
  };
```

Consider also disabling Save for a zero amount in `isSaveDisabled` (`:156-168`) so the button reflects the guard rather than silently doing nothing on tap. That is a small, honest improvement — do it, and add a test asserting the Save button is disabled when Amount is `'0'`.

- [ ] **Step 4: Run green**

```bash
npx jest src/screens/forms
npm run check:typecheck
```

---

## Task 29: T-34 — Make the per-currency breakdown agree with the headline total

**Confidence: CONFIRMED.**

`home.screen.tsx:231-233` computes `total = guardedNetWorth(active, ...)`, which **drops** any holding whose currency cannot convert (`src/rates/net-worth-view.ts:34-42`), and `breakdown = sumByCurrency(active)`, which **keeps** every currency (`src/rates/currency-totals.ts:15-26`). With a BTC holding and no cached BTC:UAH rate, the headline excludes BTC while the breakdown beneath still lists it, so the rows visibly do not add up to the total. `buildNetWorthSnapshot` (`src/widget/net-worth-snapshot.ts:31-36`) has the identical divergence, so the widget shows it too.

**Chosen fix: omit, in one shared place.** A shared `guardedBreakdown` in `src/rates/net-worth-view.ts` (next to `guardedNetWorth`, sharing its `canConvert` filter) fixes Home and the widget at once. Omitting is what makes the two views *agree*, which is the stated goal; a "marked" row would need a new `CurrencyBreakdown` prop and a new copy string for a transient first-run condition that resolves as soon as rates land.

**Files:**
- Modify: `src/rates/net-worth-view.ts`
- Modify: `src/screens/home/home.screen.tsx:233`
- Modify: `src/widget/net-worth-snapshot.ts:32-36`
- Test: `src/rates/net-worth-view.test.ts`, `src/screens/home/home.screen.test.tsx`, `src/widget/net-worth-snapshot.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/rates/net-worth-view.ts
  /** `sumByCurrency` restricted to the currencies `guardedNetWorth` could convert. */
  export const guardedBreakdown = (
    holdings: ConvertibleHolding[],
    base: Currency,
    rates: RateTable,
    now: number,
  ): Money[];
  ```

**Conflict note:** this touches `src/widget/net-worth-snapshot.ts:32-36`, a file the `security-pass-fixes` branch also edits (it removes `trend` at `:18`, `:27`, `:37`, `:43`). Lines 32-36 do not overlap those, so no conflict is expected — but do not reformat anything else in the file.

- [ ] **Step 1: Write the failing test in `src/rates/net-worth-view.test.ts`**

```ts
it('omits a currency the total could not convert', () => {
  const holdings = [
    { id: 'a', currency: 'UAH', balanceMinorUnits: 100_00, type: 'cash' },
    { id: 'b', currency: 'BTC', balanceMinorUnits: 50_000_000, type: 'crypto_asset' },
  ];
  const rates = {};

  const total = guardedNetWorth(holdings, 'UAH', rates, 0);
  const breakdown = guardedBreakdown(holdings, 'UAH', rates, 0);

  expect(breakdown.map((money) => money.currency)).toEqual(['UAH']);
  expect(breakdown.reduce((sum, money) => sum + money.minorUnits, 0)).toBe(total.minorUnits);
});

it('keeps every currency once the rates are cached', () => {
  const holdings = [
    { id: 'a', currency: 'UAH', balanceMinorUnits: 100_00, type: 'cash' },
    { id: 'b', currency: 'BTC', balanceMinorUnits: 50_000_000, type: 'crypto_asset' },
  ];
  const rates = { 'BTC:UAH': 2_500_000 };

  expect(guardedBreakdown(holdings, 'UAH', rates, 0)).toHaveLength(2);
});
```

Read the file's real `ConvertibleHolding` shape and rate-table key format (`` `${currency}:${base}` `` per `canConvert` at `:30-31`) before finalising the fixtures.

- [ ] **Step 2: Write the failing tests in the two consumers**

```tsx
// home.screen.test.tsx
it('lists only the currencies the headline total includes', async () => {
  mockRates = [];
  mockHoldings = [
    { id: 'a', accountId: 'acc', currency: 'UAH', balanceMinorUnits: 100_00, type: 'cash' },
    { id: 'b', accountId: 'acc', currency: 'BTC', balanceMinorUnits: 50_000_000, type: 'crypto_asset' },
  ];

  const { queryByText } = await renderScreen();

  expect(queryByText('BTC')).toBeNull();
});
```

```ts
// net-worth-snapshot.test.ts
it('omits an unconvertible currency from the snapshot breakdown', () => {
  const snapshot = buildNetWorthSnapshot({
    holdings: [
      { id: 'a', accountId: 'acc', currency: 'UAH', balanceMinorUnits: 100_00, type: 'cash' },
      { id: 'b', accountId: 'acc', currency: 'BTC', balanceMinorUnits: 50_000_000, type: 'crypto_asset' },
    ],
    accounts: [{ id: 'acc', archivedAt: null }],
    rateTable: {},
    baseCurrency: 'UAH',
    trendPoints: [],
    now: 0,
  });

  expect(snapshot.breakdown.map((item) => item.currency)).toEqual(['UAH']);
});
```

Keep `trendPoints: []` in the snapshot call — do not remove the field, the sibling branch owns that.

- [ ] **Step 3: Run all three and confirm the failures**

```bash
npx jest src/rates/net-worth-view.test.ts src/screens/home/home.screen.test.tsx src/widget/net-worth-snapshot.test.ts
```

- [ ] **Step 4: Add `guardedBreakdown`**

In `src/rates/net-worth-view.ts`, immediately after `guardedNetWorth`:

```ts
/**
 * The per-currency breakdown restricted to exactly the holdings
 * `guardedNetWorth` could convert, so the rows ALWAYS sum to the headline
 * total.
 *
 * `sumByCurrency` alone keeps every currency, including one with no cached
 * rate — which `guardedNetWorth` had already dropped from the total. With a
 * BTC holding and no BTC:UAH rate yet (a first run, or a CoinGecko outage),
 * the Home card's headline excluded BTC while the breakdown beneath it still
 * listed BTC, so the rows visibly did not add up. The widget's snapshot had
 * the identical divergence, which is why this lives here rather than in either
 * caller.
 */
export const guardedBreakdown = (
  holdings: ConvertibleHolding[],
  base: Currency,
  rates: RateTable,
  now: number,
): Money[] =>
  sumByCurrency(
    holdings.filter((holding) => canConvert(holding.currency, base, rates)),
    now,
  );
```

Import `sumByCurrency` from `./currency-totals`. Confirm no import cycle: `currency-totals.ts` imports only `currency`, `money` and `holdings/holding-value` — it does not import `net-worth-view`, so this is safe. `ConvertibleHolding` and `ValuableHolding` may differ; if `tsc` objects, widen the parameter to whatever both `canConvert`'s filter and `sumByCurrency` accept.

- [ ] **Step 5: Use it in both consumers**

`src/screens/home/home.screen.tsx:233`:

```tsx
  const breakdown = guardedBreakdown(active, baseCurrency, rateTable, now);
```

`src/widget/net-worth-snapshot.ts:32-36`:

```ts
  const breakdown = guardedBreakdown(active, input.baseCurrency, input.rateTable, input.now).map(
    (money) => ({
      currency: money.currency,
      minorUnits: money.minorUnits,
      formatted: formatMoney(money, activeLocale()),
    }),
  );
```

Drop the now-unused `sumByCurrency` import from each file if `tsc`/Biome says so.

- [ ] **Step 6: Run green**

```bash
npx jest src/rates src/screens/home src/widget
npm run check:typecheck
```

---

## Task 30: T-35 — Open the date-range calendar on the active range's month

**Confidence: CONFIRMED.**

`DateRangeField` renders `KikoCalendar` (`src/screens/home/date-range-field/date-range-field.component.tsx:229-236`) passing `markingType`, `markedDates`, `minDate`, `maxDate` and `onDayPress` — but never `initialDate`, which `KikoCalendarProps` does expose (`src/screens/calendar/kiko-calendar/kiko-calendar.props.d.ts`, picked from `react-native-calendars`' own `CalendarProps`). So after applying a range in March, reopening the picker shows September (the current month) with no marks visible.

**Files:**
- Modify: `src/screens/home/date-range-field/date-range-field.component.tsx:229-236`
- Test: `src/screens/home/date-range-field/date-range-field.component.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('opens the calendar on the active range start', async () => {
  const { getByText, getByTestId } = await render(
    <DateRangeField
      dateFrom={new Date(2026, 2, 10)}
      dateTo={new Date(2026, 2, 20)}
      minDate={new Date(2025, 0, 1)}
      onApply={jest.fn()}
      onClear={jest.fn()}
    />,
  );

  await fireEvent.press(getByText(/10\.03\.2026/));

  expect(getByTestId('date-range-calendar').props.initialDate).toBe('2026-03-10');
});

it('falls back to the selectable ceiling when no range is set', async () => {
  const { getByTestId, getByText } = await render(
    <DateRangeField
      dateFrom={null}
      dateTo={null}
      minDate={new Date(2025, 0, 1)}
      onApply={jest.fn()}
      onClear={jest.fn()}
    />,
  );

  await fireEvent.press(getByText(/–/));

  expect(getByTestId('date-range-calendar').props.initialDate).toBeDefined();
});
```

Read the component's real props and its opening affordance (the field's own label text) before finalising; the assertion that matters is `initialDate` matching `toCalendarKey(draftStart ?? dateFrom)`.

- [ ] **Step 2: Run it and confirm the failure**

```bash
npx jest src/screens/home/date-range-field
```

Expected: `initialDate` is `undefined`.

- [ ] **Step 3: Pass `initialDate`**

At `:229-236`:

```tsx
          <KikoCalendar
            testID="date-range-calendar"
            markingType="period"
            markedDates={marks}
            // Open on the ACTIVE range's start (or its draft, mid-edit) rather
            // than letting react-native-calendars default to the current
            // month: reopening the picker after applying a March range showed
            // September with none of its own marks on screen.
            initialDate={toCalendarKey(draftStart ?? selectableFloor)}
            minDate={toCalendarKey(selectableFloor)}
            maxDate={toCalendarKey(selectableCeiling)}
            onDayPress={handleDayPress}
          />
```

Read the component for the real name of its draft-start state and of the resolved `dateFrom` fallback; use whichever expresses "the day the user is currently anchored on". `toCalendarKey` is already imported and used on the next two lines.

- [ ] **Step 4: Run green**

```bash
npx jest src/screens/home src/screens/calendar
npm run check:typecheck
```

---

## Task 31: T-36 — Stop the sortables hold from claiming a press inside the category rename field

**Confidence: PLAUSIBLE — run the confirm step first, and this one needs a device check to close.**

`categories.screen.tsx:346-367` wraps each card — including the rename `TextInput` at `:173-200` — in a `Sortable.Grid` with the library defaults `dragActivationDelay: 200` and `customHandle: false` (`node_modules/react-native-sortables/src/constants/props.ts:28,31`). A hold on the rename field to place the cursor or open the Paste menu very likely starts a card drag instead, because the iOS text-selection threshold is longer than 200 ms. No handle or delay override exists anywhere in `src/`.

**Chosen fix: raise this grid's `dragActivationDelay` above the iOS text-selection threshold**, rather than adding a `customHandle`. Reason: the accounts and holdings grids deliberately have **no** handle (`kiko-gestures`: both grids share one tuning, and a synced card stays reorderable precisely because no gesture is claimed), and adding a visible grab handle to only the categories cards would diverge the three grids' interaction model for one screen. A longer delay is the smaller, reversible change, and the cards already carry move-to-top/move-to-bottom buttons as a gesture-free path.

**Files:**
- Modify: `src/screens/settings/categories.screen.tsx:346-367`
- Test: `src/screens/settings/categories.screen.test.tsx`

- [ ] **Step 1: Run the confirm step (PLAUSIBLE)**

```bash
grep -n "dragActivationDelay\|customHandle" -r src node_modules/react-native-sortables/src/constants/props.ts
```

Expected: no hit anywhere in `src`; the library defaults are 200 ms and `false`. That confirms the *configuration* gap. The interaction itself needs the device check below — proceed with the fix, and note in the report that MANUAL-5 closes it.

- [ ] **Step 2: Write the failing test**

```tsx
it('gives the categories grid a drag delay above the iOS text-selection threshold', async () => {
  const { getByTestId } = await renderScreen();

  const grid = getByTestId('categories-grid');

  expect(grid.props.dragActivationDelay).toBeGreaterThanOrEqual(500);
});
```

`Sortable.Grid` needs a `testID` for this to be queryable — add `testID="categories-grid"` in Step 4. Read `__mocks__` / `jest/setup.js` for how `react-native-sortables` is mocked and confirm the mock forwards arbitrary props; if it does not, extend the mock in the same passthrough style `__mocks__/react-native-svg.tsx` uses (`kiko-code-style`, "Testing a native/ESM dependency").

- [ ] **Step 3: Run it and confirm the failure**

```bash
npx jest src/screens/settings/categories.screen.test.tsx
```

Expected: `dragActivationDelay` is `undefined`.

- [ ] **Step 4: Raise the activation delay**

At `src/screens/settings/categories.screen.tsx:348-367`, add to the `Sortable.Grid` props:

```tsx
        <Sortable.Grid
          testID="categories-grid"
          data={categories}
          sortEnabled={categories.length > 1}
          activeItemScale={1.03}
          columns={1}
          overDrag="vertical"
          // Unlike the accounts and holdings grids, EVERY card here contains a
          // live TextInput (the rename field). react-native-sortables' default
          // 200 ms activation is shorter than iOS's own text-selection hold,
          // so a hold meant to place the cursor or open Paste started a card
          // drag instead. A longer delay is preferred over `customHandle`
          // because the other two grids deliberately expose no handle
          // (kiko-gestures) and diverging one screen's interaction model for
          // this would be worse; the cards also already offer gesture-free
          // move-to-top / move-to-bottom buttons.
          dragActivationDelay={CATEGORY_DRAG_ACTIVATION_MS}
          rowGap={theme.spacing(4)}
```

with a module-level constant above the component:

```tsx
// Above iOS's text-selection hold threshold, so a long-press inside a card's
// rename TextInput belongs to the text field, not to the grid's drag. Retune
// on-device (see kiko-gestures: gesture thresholds are tuned on hardware, not
// guessed).
const CATEGORY_DRAG_ACTIVATION_MS = 600;
```

- [ ] **Step 5: Run green**

```bash
npx jest src/screens/settings
npm run check:typecheck
```

- [ ] **Step 6: Queue the device verification**

**MANUAL-5 (user, device):** Settings → Categories. Long-press inside a category's name field: the cursor/Paste menu must appear and no card must lift. Then long-press on a card's icon or its empty area and drag: the reorder must still work. If 600 ms feels sluggish for the reorder, retune the constant on-device.

---

## Task 32: T-37 — Allocate legend percents by largest remainder so they sum to 100

**Confidence: CONFIRMED.**

`toPercent` (`src/design-system/components/pie-chart/pie-chart.component.tsx:96`) is `Math.round(share * 100)` applied **per slice**, at `:131-135`. Three equal shares render 33/33/33 (99); `[0.5, 0.25, 0.125, 0.125]` renders 50/25/13/13 (101). Both pie charts on the Statistics screen show this under the ring.

Verified: `Math.round(x * 100)` over `[0.5, 0.25, 0.125, 0.125]` sums to 101.

**Files:**
- Modify: `src/design-system/components/pie-chart/pie-chart.component.tsx:96`, `:113-137`
- Test: `src/design-system/components/pie-chart/pie-chart.component.test.tsx`

**Interfaces:**
- Produces: `allocatePercents(shares: readonly number[]): number[]` — a module-level pure helper in the same file, returning integers that sum to exactly 100 whenever the input shares sum to 1.

- [ ] **Step 1: Write the failing tests**

```tsx
it('legend percents sum to 100 for four uneven slices', async () => {
  const { getByTestId } = await render(
    <PieChart
      testID="pie"
      slices={[
        { accountId: 'a', name: 'A', amount: 50, share: 0.5, color: '#0A84FF' },
        { accountId: 'b', name: 'B', amount: 25, share: 0.25, color: '#30D158' },
        { accountId: 'c', name: 'C', amount: 12.5, share: 0.125, color: '#FF9F0A' },
        { accountId: 'd', name: 'D', amount: 12.5, share: 0.125, color: '#BF5AF2' },
      ]}
      baseCurrency="UAH"
    />,
  );

  const percents = ['a', 'b', 'c', 'd'].map((key) =>
    Number(String(getByTestId(`pie-legend-percent-${key}`).props.children).replace('%', '')),
  );

  expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);
});

it('legend percents sum to 100 for three equal slices', async () => {
  // 33/33/33 = 99 under per-slice rounding; the largest-remainder pass gives
  // one of them 34.
  const third = 1 / 3;
  const { getByTestId } = await render(
    <PieChart
      testID="pie"
      slices={['a', 'b', 'c'].map((key, index) => ({
        accountId: key,
        name: key,
        amount: 1,
        share: third,
        color: ['#0A84FF', '#30D158', '#FF9F0A'][index],
      }))}
      baseCurrency="UAH"
    />,
  );

  const percents = ['a', 'b', 'c'].map((key) =>
    Number(String(getByTestId(`pie-legend-percent-${key}`).props.children).replace('%', '')),
  );

  expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);
  expect(percents.filter((value) => value === 34)).toHaveLength(1);
});
```

Read the component's real prop and slice types, and its legend-percent testID format (`${testID}-legend-percent-${slice.accountId}` at `:132`), before finalising.

- [ ] **Step 2: Run them and confirm the failures**

```bash
npx jest src/design-system/components/pie-chart
```

Expected: 101 and 99.

- [ ] **Step 3: Add the largest-remainder allocation**

In `src/design-system/components/pie-chart/pie-chart.component.tsx`, replace `toPercent` (`:96`) with a set-wide allocator:

```tsx
/**
 * Whole-percent labels for a set of shares, allocated by largest remainder
 * (the Hare quota): floor each share, then hand the leftover points to the
 * slices with the biggest discarded fractions.
 *
 * Rounding each slice INDEPENDENTLY with `Math.round(share * 100)` made the
 * column under the ring sum to 99 or 101 — three equal thirds read 33/33/33,
 * and `[0.5, 0.25, 0.125, 0.125]` read 50/25/13/13. The allocation has to see
 * the whole set at once, so it happens here, once, rather than per legend row.
 *
 * Ties on the remainder are broken by index, so the labels are stable across
 * renders for an unchanged slice order.
 */
const allocatePercents = (shares: readonly number[]): number[] => {
  const exact = shares.map((share) => share * 100);
  const floors = exact.map((value) => Math.floor(value));
  const allocated = floors.reduce((sum, value) => sum + value, 0);
  const remainder = Math.round(exact.reduce((sum, value) => sum + value, 0)) - allocated;

  const order = exact
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floors];

  for (let step = 0; step < remainder; step += 1) {
    const target = order[step % order.length];
    result[target.index] += 1;
  }

  return result;
};
```

Then compute it once in `PieChart`'s body, before rendering the legend, and pass each slice's integer into `PieLegendEntry` as a new `percent: number` prop, replacing its internal `toPercent(slice.share)` call at `:132-134`:

```tsx
        <Text variant="caption" tone="textSecondary">
          {`${percent}%`}
        </Text>
```

Add `percent` to `PieLegendEntry`'s prop type. Note `remainder` can be 0 (already exact) — the loop then does nothing, which is correct. Guard the empty-slices case: `allocatePercents([])` returns `[]` and the loop's `order.length` is never reached because `remainder` is 0.

- [ ] **Step 4: Run green**

```bash
npx jest src/design-system/components/pie-chart src/screens/statistics
npm run check:typecheck
```

---

## Task 33: T-38 + T-39 — Collapse the Y axis on a flat series, and give the Y gridlines a `testID`

**Confidence: both CONFIRMED.**

Paired because T-39's missing `testID` is exactly why T-38 is invisible to the existing suite.

**T-39:** the Y gridlines (`src/design-system/components/net-worth-line/net-worth-line.component.tsx:242-250`) are the only chart primitives in the app without a `testID`. `kiko-charts` states every primitive carries one, because the manual `react-native-svg` mock is the only way a test can read computed geometry back.

**T-38:** `buildTicks` (`:90-100`) spreads `TICK_COUNT` ticks across `[minValue, maxValue]`. When every amount equals `startReference`, `maxValue === minValue`, so all four ticks carry the same value at the same `y` — four overdrawn labels and four coincident `<Line>`s. `buildXTicks` has the analogous single-instant guard (`:116-119`); the Y axis has none. `compact.ts:62`'s fallthrough can collapse the labels to one string too.

**Files:**
- Modify: `src/design-system/components/net-worth-line/net-worth-line.component.tsx:90-100`, `:241-251`
- Test: `src/design-system/components/net-worth-line/net-worth-line.component.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders a single Y tick for a flat series', async () => {
  const { queryByTestId, getByTestId } = await render(
    <NetWorthLine
      points={[
        { t: 1, amount: 5000 },
        { t: 2, amount: 5000 },
      ]}
      startReference={5000}
      baseCurrency="UAH"
    />,
  );

  expect(getByTestId('net-worth-line-tick-0')).toBeTruthy();
  expect(queryByTestId('net-worth-line-tick-1')).toBeNull();
});

it('renders one Y gridline per tick, each with a testID', async () => {
  const { getAllByTestId } = await render(
    <NetWorthLine
      points={[
        { t: 1, amount: 1000 },
        { t: 2, amount: 5000 },
      ]}
      startReference={1000}
      baseCurrency="UAH"
    />,
  );

  const gridlines = getAllByTestId(/^net-worth-line-y-grid-/);

  expect(gridlines).toHaveLength(4);

  const ys = gridlines.map((line) => Number(line.props.y1));

  // Top tick (max) draws at the smallest y; the set is strictly monotonic.
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  expect(new Set(ys).size).toBe(4);
});

it('renders a single Y gridline for a flat series', async () => {
  const { getAllByTestId } = await render(
    <NetWorthLine
      points={[{ t: 1, amount: 5000 }]}
      startReference={5000}
      baseCurrency="UAH"
    />,
  );

  expect(getAllByTestId(/^net-worth-line-y-grid-/)).toHaveLength(1);
});
```

Read `TICK_COUNT`'s value in the component and use it rather than hardcoding 4 if it is exported.

- [ ] **Step 2: Run them and confirm the failures**

```bash
npx jest src/design-system/components/net-worth-line
```

Expected: `net-worth-line-tick-1` exists (four ticks on a flat series, all at the same top position); the gridline query finds nothing at all.

- [ ] **Step 3: Add the flat-range collapse to `buildTicks`**

At `src/design-system/components/net-worth-line/net-worth-line.component.tsx:90-100`:

```tsx
// The evenly-spaced Y-axis ticks, top (max) to bottom (min), taken from the
// true data-and-reference range so the labels read clean extremes.
//
// A FLAT range (every amount equal to `startReference` — a single point, or a
// holding whose balance never moved in the window) collapses to ONE tick, the
// same way `buildXTicks` collapses a single-instant time range below. Spreading
// TICK_COUNT ticks across a zero-width range put all of them at the same value
// AND the same y: four labels drawn on top of each other and four coincident
// gridlines.
const buildTicks = (points: NetWorthPoint[], startReference: number): Tick[] => {
  const values = [...points.map((point) => point.amount), startReference];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  if (maxValue === minValue) {
    return [{ key: '0.0000', value: maxValue }];
  }

  return Array.from({ length: TICK_COUNT }, (_, index) => {
    const fraction = index / (TICK_COUNT - 1);

    return { key: fraction.toFixed(4), value: maxValue - fraction * (maxValue - minValue) };
  });
};
```

Also read `formatCompactMoney`/`compact.ts:62` and check whether a non-flat range can still collapse every *label* to one string (e.g. four ticks all rendering "5K"). If it can, note it in the comment; do not add a second collapse rule for it in this task — the geometry fix is the reported bug, and a label-only collapse is a separate design decision.

- [ ] **Step 4: Add the gridline `testID`**

At `:241-251`:

```tsx
              {ticks.map((tick) => (
                <Line
                  key={tick.key}
                  testID={`net-worth-line-y-grid-${tick.key}`}
                  x1={PADDING_X}
                  y1={scales.y(tick.value)}
                  x2={VIEW_WIDTH - PADDING_X}
                  y2={scales.y(tick.value)}
                  stroke={theme.colors.border}
                  strokeWidth={GRID_STROKE_WIDTH}
                />
              ))}
```

This matches the existing X-axis convention (`net-worth-line-x-grid-0.25`), which keys on the tick's fraction — `tick.key` is exactly that fraction string.

Confirm `Line` is already exported by `__mocks__/react-native-svg.tsx` (it must be, the gridlines render today) — no mock change needed.

- [ ] **Step 5: Run green**

```bash
npx jest src/design-system/components/net-worth-line src/screens/statistics
npm run check:typecheck
```

---

## Task 34: T-40 — Stop Home double-counting the bottom safe-area inset in its list clearance

**Confidence: CONFIRMED.**

Home opts out of `Screen`'s own bottom handling via `bleedBottom` and passes `listBottomClearance = tabBarHeight` (`src/screens/home/home.screen.tsx:144-145`, applied at `:454`). `Screen` normally passes `Math.max(tabBarHeight - insets.bottom, 0)` (`screen.component.tsx:57`) precisely because its `SafeAreaView` already reserves `insets.bottom`. Result, with an 80 pt bar and a 34 pt inset: Home has 80 + 16 + 34 = **130** pt of dead space under the last transaction, versus 16 + 46 + 34 = **96** pt on every other screen (`screen.component.test.tsx:88`'s `BOTTOM_CLEARANCE = Math.max(80 - 34, 0)`).

The two files also contradict each other: `home.styles.ts:107-109` says `bottomClearance` is "the bar's measured height **plus** the bottom safe-area inset", while `home.screen.tsx:138-145` says the inset is deliberately omitted. Both comments need fixing.

**Files:**
- Create: `src/design-system/components/screen/bottom-clearance.ts`
- Modify: `src/design-system/components/screen/screen.component.tsx:55-57`
- Modify: `src/screens/home/home.screen.tsx:136-145`
- Modify: `src/screens/home/home.styles.ts:104-114`
- Test: `src/design-system/components/screen/bottom-clearance.test.ts`, `src/screens/home/home.screen.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // src/design-system/components/screen/bottom-clearance.ts
  /** The clearance a bottom-edge-owning view must add ABOVE the safe-area inset. */
  export const resolveBottomClearance = (tabBarHeight: number, insetBottom: number): number;
  ```

- [ ] **Step 1: Write the failing test in `bottom-clearance.test.ts`**

```ts
describe('resolveBottomClearance', () => {
  it('subtracts the inset the SafeAreaView already reserves', () => {
    expect(resolveBottomClearance(80, 34)).toBe(46);
  });

  it('clamps to zero when the inset alone exceeds the bar', () => {
    expect(resolveBottomClearance(20, 34)).toBe(0);
  });

  it('is the full bar height with no inset', () => {
    expect(resolveBottomClearance(80, 0)).toBe(80);
  });
});
```

- [ ] **Step 2: Write the failing test in `home.screen.test.tsx`**

```tsx
it('clears the tab bar without double-counting the safe-area inset', async () => {
  // MOCK_TAB_BAR_HEIGHT = 80, MOCK_BOTTOM_INSET = 34 (mirror
  // screen.component.test.tsx's constants).
  const { getByTestId } = await renderScreen();

  const listPadding = getByTestId('home-transactions').props.contentContainerStyle.paddingBottom;

  expect(listPadding).toBe(resolveBottomClearance(80, 34));

  // Total dead space under the last row must match every other screen's 96:
  // the SafeAreaView's 34 inset + Screen's own 16 base padding + this 46.
  expect(34 + 16 + listPadding).toBe(96);
});
```

Read `home.screen.test.tsx` for how it mocks `useBottomTabBarHeight` and `useSafeAreaInsets`; mirror `screen.component.test.tsx:78-92`'s constant names so the two tests are comparable.

- [ ] **Step 3: Run both and confirm the failures**

```bash
npx jest src/design-system/components/screen src/screens/home/home.screen.test.tsx
```

Expected: the module does not resolve; Home's list padding is 80 and the total is 130.

- [ ] **Step 4: Extract the computation**

Create `src/design-system/components/screen/bottom-clearance.ts`:

```ts
/**
 * The clearance a view that owns the screen's true bottom edge must add ABOVE
 * the safe-area inset, so its last row clears the floating native glass tab
 * bar exactly once.
 *
 * The enclosing `SafeAreaView` already reserves `insetBottom` as its own
 * padding, so a consumer that adds the full `tabBarHeight` on top of it
 * double-counts the inset. Home did exactly that — 80 + 16 + 34 = 130 pt of
 * dead space under the last transaction, against 96 pt on every other screen —
 * because it opts out of `Screen`'s own bottom handling with `bleedBottom` and
 * computed its own clearance. This function is the ONE place that arithmetic
 * lives, shared by `Screen` and by every `bleedBottom` child.
 *
 * Clamped at 0: on a device whose bottom inset alone exceeds the bar height,
 * the SafeAreaView's reservation is already the full, correct clearance and
 * nothing more is needed.
 */
export const resolveBottomClearance = (tabBarHeight: number, insetBottom: number): number =>
  Math.max(tabBarHeight - insetBottom, 0);
```

In `screen.component.tsx:57`, replace the inline expression with `const bottomClearance = resolveBottomClearance(tabBarHeight, insets.bottom);` and shorten the comment at `:53-57` to point at the module.

- [ ] **Step 5: Use it in Home and fix both comments**

`src/screens/home/home.screen.tsx:136-145`:

```tsx
  // The floating native glass tab bar sits over this screen's bottom edge, so
  // this SectionList — which owns the true bottom edge, since Home passes
  // `bleedBottom` — reserves the clearance itself. It is the tab-bar height
  // MINUS the bottom safe-area inset, because Screen's plain-branch
  // `SafeAreaView` already reserves that inset natively around this content:
  // adding the full bar height on top of it double-counted the inset and left
  // 130pt of dead space under the last row, against 96pt everywhere else. One
  // shared computation, in `resolveBottomClearance`.
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const listBottomClearance = resolveBottomClearance(tabBarHeight, insets.bottom);
```

Add the `useSafeAreaInsets` import from `react-native-safe-area-context` if it is not already there.

`src/screens/home/home.styles.ts:104-114` — correct the `listContent` comment, which currently claims the clearance includes the inset:

```ts
  // Bottom padding is lifted clear of the floating native glass tab bar by
  // `bottomClearance` — the bar's measured height MINUS the bottom safe-area
  // inset, computed at the call site through `resolveBottomClearance`
  // (design-system/components/screen/bottom-clearance.ts). The inset is
  // subtracted, not added: Screen's `SafeAreaView` already reserves it around
  // this content, so including it here would count it twice.
```

- [ ] **Step 6: Run green**

```bash
npx jest src/design-system/components/screen src/screens/home
npm run check:typecheck
```

- [ ] **Step 7: Queue the visual verification**

**MANUAL-6 (ops, simulator):** scroll the Home transaction list to the bottom; the gap between the last row and the tab bar must match the gap on Accounts/Settings.

---

## Task 35: T-41 — Drop the blanket `textTransform: 'capitalize'` and case the English labels correctly

**Confidence: CONFIRMED.**

`button.styles.ts:63` forces `textTransform: 'capitalize'` on every Button label, applied at `button.component.tsx:44`. Under `uk` that renders "Додати рахунок" as "Додати Рахунок" — Ukrainian UI labels use sentence case, not title case.

**Coordinator's decision, followed here: drop the transform and make the English catalogue labels correct on their own. No per-language gate.** A language gate would put a copy decision in the style layer and would still be wrong for a third language.

Note this cuts across `kiko-design-system`'s "Use title case for every heading and sub-heading shown in the UI" rule — that rule is about screen titles and section headers, and Buttons are actions, not headings. The transform's own comment at `:60-62` admits it exists only so call sites need not be edited; editing them is the correct fix.

**Files:**
- Modify: `src/design-system/components/button/button.styles.ts:56-64`
- Modify: `src/i18n/locales/en.ts` (Button label strings only)
- Test: `src/design-system/components/button/button.component.test.tsx`, `src/i18n` catalogue test

- [ ] **Step 1: Write the failing tests**

```tsx
it('does not force a text transform on the label', async () => {
  const { getByText } = await render(<Button onPress={jest.fn()}>Add account</Button>);

  const style = StyleSheet.flatten(getByText('Add account').props.style);

  expect(style.textTransform).toBeUndefined();
});

it('renders a Ukrainian label in sentence case, unchanged', async () => {
  await i18n.changeLanguage('uk');

  const { getByText } = await render(<Button onPress={jest.fn()}>Додати рахунок</Button>);

  expect(getByText('Додати рахунок')).toBeTruthy();

  await i18n.changeLanguage('en');
});
```

The existing `button.component.test.tsx` asserts on flattened label styles already (`:49`, `:54`, `:63`) — reuse its helper.

And a catalogue test pinning the English casing, so a future edit cannot silently regress the labels the transform used to paper over:

```ts
it('renders every button label in sentence case', () => {
  // The Button no longer force-capitalizes, so each catalogue supplies its own
  // casing. English button copy is sentence case: first word capitalized,
  // later words lowercase unless they are proper nouns.
  expect(en.accounts.addAccount).toBe('Add account');
  expect(en.forms.contribution.save).toBe('Save contribution');
  expect(en.common.save).toBe('Save');
  expect(en.common.cancel).toBe('Cancel');
  expect(en.common.delete).toBe('Delete');
});
```

- [ ] **Step 2: Run them and confirm the failures**

```bash
npx jest src/design-system/components/button src/i18n
```

Expected: `textTransform` is `'capitalize'`.

- [ ] **Step 3: Drop the transform**

At `src/design-system/components/button/button.styles.ts:56-64`, delete the `textTransform` line and its three-line comment, keeping the rest of the `label` block and the `Text`-vs-`RNText` explanation above it. Add:

```ts
  // NOTE: no `textTransform`. It used to force `capitalize` so call sites
  // "need not be edited", which rendered every Ukrainian label in Title Case
  // ("Додати Рахунок") — Ukrainian UI labels are sentence case. Each catalogue
  // now supplies its own casing; there is no per-language gate, because a copy
  // decision does not belong in the style layer.
```

- [ ] **Step 4: Audit and correct every Button label in `en.ts`**

Find every string that reaches a `Button`'s children and check its casing without the transform. Start from the call sites the spec names — `accounts.screen.tsx:73`, `account-detail.screen.tsx:224`, `holding-detail.screen.tsx:222`, `contribution-form.screen.tsx:73` — then sweep the rest:

```bash
grep -rn "<Button" src --include=*.tsx | grep -v "\.test\."
```

For each, read the `t()` key it renders and confirm the English value is sentence case (`'Add account'`, not `'add account'` or `'Add Account'`). The transform was masking any label that began lowercase — those are the ones to fix. Do **not** touch `uk.ts`: its labels are already sentence case, which is the whole point.

- [ ] **Step 5: Run green**

```bash
npx jest src/design-system src/screens src/i18n
npm run check:typecheck
```

- [ ] **Step 6: Queue the visual verification**

**MANUAL-7 (ops, simulator):** switch the app to Ukrainian and check the Accounts, Account detail, Holding detail and Contribution form buttons read in sentence case; then switch back to English and confirm each still reads correctly.

---

## Task 36: T-42 — Style the MigrationsGate pending and error branches

**Confidence: CONFIRMED.**

`src/db/migrations.gate.tsx:45-59` renders a bare `<View><Text>…</Text></View>` for both the pending and error states — no background, no flex, no safe area. On a Light device that is a white flash before the navigator mounts, with the text sitting under the status bar. `LockGate` styles its own pre-navigator UI properly through `lock-gate.styles.ts` — follow that.

This is the third task to touch `migrations.gate.tsx` (after Tasks 1 and 23); it changes only the render branches, not the init chain.

**Files:**
- Create: `src/db/migrations.gate.styles.ts`
- Modify: `src/db/migrations.gate.tsx:45-59`
- Test: `src/db/migrations.gate.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('renders the pending state full-bleed on the dark surface', async () => {
  mockRunMigrations.mockImplementation(() => new Promise(() => {}));

  const { getByTestId } = await render(
    <MigrationsGate>
      <Text>ready</Text>
    </MigrationsGate>,
  );

  const style = StyleSheet.flatten(getByTestId('migrations-gate-pending').props.style);

  expect(style.flex).toBe(1);
  expect(style.backgroundColor).toBe(darkTheme.colors.background);
});

it('renders the error state the same way', async () => {
  mockRunMigrations.mockRejectedValueOnce(new Error('boom'));

  const { getByTestId } = await render(
    <MigrationsGate>
      <Text>ready</Text>
    </MigrationsGate>,
  );

  const style = StyleSheet.flatten(getByTestId('migrations-gate-error').props.style);

  expect(style.flex).toBe(1);
  expect(style.backgroundColor).toBe(darkTheme.colors.background);
});
```

- [ ] **Step 2: Run it and confirm the failure**

```bash
npx jest src/db/migrations.gate.test.tsx
```

Expected: neither testID exists.

- [ ] **Step 3: Add the styles module**

Create `src/db/migrations.gate.styles.ts`, mirroring `src/auth/lock-gate/lock-gate.styles.ts` (read it first and match its `StyleSheet.create` / unistyles shape exactly):

```ts
import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Full-bleed on the true-black background: this is the very FIRST paint,
  // before the navigator (and before Unistyles' own screen background) exists,
  // so an unstyled View flashed white on a Light-appearance device and left the
  // text under the status bar. Same shape as `lock-gate.styles`' `fill`.
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing(6),
  },
}));
```

- [ ] **Step 4: Use the design-system primitives in both branches**

At `src/db/migrations.gate.tsx:45-59`, replace the raw `View`/`Text` from `react-native` with `Box` and the design-system `Text`:

```tsx
  if (state.status === 'error') {
    return (
      <Box testID="migrations-gate-error" style={styles.fill}>
        <Text variant="body" tone="textSecondary">
          {t('migrations.error', { message: state.error.message })}
        </Text>
      </Box>
    );
  }

  if (state.status === 'pending') {
    return (
      <Box testID="migrations-gate-pending" style={styles.fill}>
        <Text variant="body" tone="textSecondary">
          {t('migrations.preparing')}
        </Text>
      </Box>
    );
  }
```

Replace the `react-native` `Text, View` import at `:3` with `Box` from `../design-system/components/box` and `Text` from `../design-system/components/text`. Note that `Box` has a `style` prop and layout props — prefer its own props over inline styles where one exists (`kiko-design-system`), which is why the layout lives in the styles module rather than inline.

`SafeAreaView` is deliberately **not** used here: `App.tsx:55-63` already wraps `MigrationsGate` in `SafeAreaProvider`, but centering the text vertically means the status bar is not an issue, and Task 4's `UIUserInterfaceStyle = Dark` removes the light-status-bar problem. If the text still collides with the status bar on-device, wrap in `SafeAreaView` the way `LockGate` does.

- [ ] **Step 5: Run green**

```bash
npx jest src/db __tests__/App.test.tsx
npm run check:typecheck
```

---

### CHECKPOINT after Task 36 — low tier complete

```bash
npm run check:all
npm run check:typecheck
npx jest
```

---

## Task 37: T-44 (user report, CONFIRMED by the debugger) — Target the device-reported expanded header height instead of adding a hardcoded 52 pt band

**Confidence: CONFIRMED by the debugger. Source: user report, isolated in `debug-scroll-to-top-jump.md`.**

**What happens.** `src/navigation/use-scroll-to-top-on-tab-press.ts:212` computes:

```ts
const target = -(headerHeight === 0 ? 0 : headerHeight + LARGE_TITLE_BAND);
```

with `headerHeight = useContext(HeaderHeightContext) ?? 0` at `:167` and `LARGE_TITLE_BAND = 52` at `:31`.

The hook's central premise — stated in its comments at `:20-31` and `:141-157` — is that `HeaderHeightContext` reports the **collapsed** header height, so 52 pt must be added to reach the expanded top. **That premise is false.** The context value is the **live, currently-animating** header height: `@react-navigation/native-stack` feeds it from the native `onHeaderHeightChange` event (`node_modules/@react-navigation/native-stack/src/views/NativeStackView.native.tsx:326-335`, provided at `:437-440`) and even debounces it *because* it changes frequently on a large-title screen. The native value is `navigationBar.frame.size.height + navigationBar.frame.origin.y` (`node_modules/react-native-screens/ios/RNSScreen.mm:1623-1642`), re-emitted on every nav-controller layout pass — so ≈ statusBar + 96 while the large title is expanded, ≈ statusBar + 44 once collapsed.

So when the user is **already at the top**, `headerHeight` already includes the band, the hook adds it a second time, and it scrolls to 52 pt past the real top. Nothing clamps it: `Screen` sets `scrollToOverflowEnabled` (`src/design-system/components/screen/screen.component.tsx:83`) with `contentInsetAdjustmentBehavior="automatic"` (`:72`), which is precisely the branch RN skips its bounds clamp on, and UIKit does not rubber-band an animated programmatic `setContentOffset`. The content parks 52 pt below the top and stays there — a black void.

The overshoot equals however much the large title is currently expanded:

| State | `headerHeight` | Target | Void |
|---|---|---|---|
| Fully collapsed (how the feature was tuned) | statusBar + 44 | −(statusBar + 96) — the exact expanded top | none |
| Fully expanded (already at the top) | statusBar + 96 | −(statusBar + 148) | **52 pt** |
| Partially expanded | in between | in between | 0–52 pt |

Secondary wrinkle: `setHeaderHeightDebounced` is 100 ms debounced, so a re-tap within ~100 ms of the scroll settling reads a stale height — which is why the symptom looks intermittent on fast taps.

**Affected:** every large-title tab root routing through `Screen scroll` — `src/screens/statistics/statistics.screen.tsx:151`, `src/screens/accounts/accounts.screen.tsx:60`, `src/screens/settings/settings.screen.tsx:30` (all three stacks set `headerLargeTitle: true`). **Home is not affected**: its header is hidden so `headerHeight` is 0 and the target is `-0`, and its `SectionList` renders under `<Screen bleedBottom>` — the non-scroll branch, without `scrollToOverflowEnabled` — so RN still clamps.

**Chosen fix (coordinator's decision: the debugger's option 1, plus the guard).** Stop deriving the target from a live value plus a constant. Track the **maximum** `HeaderHeightContext` value seen while the screen is mounted in a ref — the screen mounts at the top, so the expanded height is observed on the first frame — and target `-expandedHeaderHeight` with **no** `LARGE_TITLE_BAND`. At the top the target then equals the current offset (a no-op, no void); when collapsed it is still the exact expanded top. Reset the tracked max on a frame-size change (rotation) so a landscape switch cannot keep a stale larger value. Then add the defense-in-depth guard: skip the scroll entirely when the live `contentOffset.y` is already at or above the target, so any future mis-tuned constant is structurally incapable of producing a void at the top.

**Files:**
- Modify: `src/navigation/use-scroll-to-top-on-tab-press.ts:20-31` (delete `LARGE_TITLE_BAND` + its comment), `:129-157` (doc comment), `:159-226` (the hook body and signature)
- Modify: `src/screens/statistics/statistics.screen.tsx:150-151`, `src/screens/accounts/accounts.screen.tsx:55,60`, `src/screens/settings/settings.screen.tsx:29-30`
- Modify: `src/design-system/components/screen/screen.component.tsx:73-84` (the now-wrong comment)
- Test: `src/navigation/use-scroll-to-top-on-tab-press.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export const useScrollToTopOnTabPress = (
    ref: RefObject<TabRootScrollable | null>,
    // Optional live scroll offset (reanimated's `useScrollOffset` on the same
    // animated ref). When supplied, the hook skips the scroll if the content
    // is already at or above the target.
    scrollOffset?: { value: number },
  ): void;
  ```
  `LARGE_TITLE_BAND` is **deleted**. The scroll target is `-expandedHeaderHeight`, where `expandedHeaderHeight` is the maximum `HeaderHeightContext` value observed since mount (or since the last frame-size change).

- [ ] **Step 1: Write the failing idempotence test**

In `src/navigation/use-scroll-to-top-on-tab-press.test.tsx`. The existing suite passes only because it renders `HeaderHeightContext` at the collapsed `MOCK_HEADER_HEIGHT = 96` (`:32`) and asserts `-148` (`:37`) — it never models the live value changing. Add cases that do. `setup`'s `headerHeight` option (`:56-58`) already parameterises the provider; you will need a way to **re-render** at a new height — extend the helper to return `renderHook`'s `rerender` if it does not already.

```tsx
// The expanded large-title header height the native event reports once the
// title is open: the collapsed 96 plus iOS's ~52pt large-title band. The hook
// must derive the target from THIS value, not from the collapsed one plus a
// hardcoded band.
const MOCK_EXPANDED_HEADER_HEIGHT = 148;

it('resolves two consecutive re-taps to the same absolute offset', () => {
  // First tap: the user is scrolled down, so the header is collapsed.
  const { scrollTo, rerender, firePress } = setup({ headerHeight: MOCK_HEADER_HEIGHT });

  firePress();
  flushFrames();

  expect(scrollTo).toHaveBeenLastCalledWith({ y: -MOCK_EXPANDED_HEADER_HEIGHT, animated: true });

  // The scroll lands at the top, so the large title expands and the native
  // event re-emits the EXPANDED height. A second tap must resolve to the same
  // absolute offset, not add the band again.
  rerender({ headerHeight: MOCK_EXPANDED_HEADER_HEIGHT });
  firePress();
  flushFrames();

  expect(scrollTo).toHaveBeenLastCalledWith({ y: -MOCK_EXPANDED_HEADER_HEIGHT, animated: true });
});

it('targets the expanded top when the header is already expanded on the first tap', () => {
  // The "user was already at the top when they tapped" state: the only height
  // the hook ever sees is the expanded one.
  const { scrollTo, firePress } = setup({ headerHeight: MOCK_EXPANDED_HEADER_HEIGHT });

  firePress();
  flushFrames();

  expect(scrollTo).toHaveBeenLastCalledWith({ y: -MOCK_EXPANDED_HEADER_HEIGHT, animated: true });
});

it('keeps targeting 0 for a header-hidden screen (Home)', () => {
  const { scrollTo, firePress } = setup({});

  firePress();
  flushFrames();

  expect(scrollTo).toHaveBeenLastCalledWith({ y: -0, animated: true });
});

it('skips the scroll when the live offset is already at the target', () => {
  const { scrollTo, firePress } = setup({
    headerHeight: MOCK_EXPANDED_HEADER_HEIGHT,
    scrollOffset: { value: -MOCK_EXPANDED_HEADER_HEIGHT },
  });

  firePress();
  flushFrames();

  expect(scrollTo).not.toHaveBeenCalled();
});

it('skips the scroll when the live offset is above the target', () => {
  const { scrollTo, firePress } = setup({
    headerHeight: MOCK_EXPANDED_HEADER_HEIGHT,
    scrollOffset: { value: -200 },
  });

  firePress();
  flushFrames();

  expect(scrollTo).not.toHaveBeenCalled();
});

it('still scrolls when the live offset is below the target', () => {
  const { scrollTo, firePress } = setup({
    headerHeight: MOCK_HEADER_HEIGHT,
    scrollOffset: { value: 500 },
  });

  firePress();
  flushFrames();

  expect(scrollTo).toHaveBeenLastCalledWith({ y: -MOCK_EXPANDED_HEADER_HEIGHT, animated: true });
});
```

Read `setup` (`:52` onward) and add the `scrollOffset` option and a `firePress`/`rerender` surface if they are not already there. `scrollOffset` is passed to the hook as a plain `{ value: number }` object — that is exactly the read surface a reanimated `SharedValue` exposes on the JS thread, so no reanimated mock is needed for these tests.

Also **correct the existing comments** in this file at `:27-38`: `MOCK_HEADER_HEIGHT`'s comment says "`HeaderHeightContext` reports the COLLAPSED header height, so the hook adds the large-title band (`52`)", which is the false premise; and `LARGE_TITLE_BAND` / `EXPANDED_TOP` (`:34-37`) go away.

- [ ] **Step 2: Run the tests and confirm they fail for the stated reason**

```bash
npx jest src/navigation/use-scroll-to-top-on-tab-press.test.tsx
```

Expected: the idempotence test's **second** assertion fails with `-200` instead of `-148` (96 + 52 on the first tap = 148, then 148 + 52 = 200 on the second) — that `-200` is the 52 pt void, pinned. The expanded-only test fails the same way. The offset-guard tests fail because the hook takes one argument.

- [ ] **Step 3: Delete `LARGE_TITLE_BAND` and track the expanded height**

In `src/navigation/use-scroll-to-top-on-tab-press.ts`, delete `LARGE_TITLE_BAND` and its comment (`:20-31`) entirely. Add, inside the hook after the existing context reads (`:160-167`):

```ts
  // The window frame, so the tracked expanded height below is discarded on a
  // rotation: a landscape header is shorter than a portrait one, and keeping
  // the larger portrait maximum would overshoot the top in landscape.
  const { width, height } = useWindowDimensions();

  // The EXPANDED large-title header height, as the DEVICE reports it — the
  // maximum `HeaderHeightContext` value seen since mount (or since the last
  // frame-size change).
  //
  // WHY A TRACKED MAXIMUM AND NOT `headerHeight + 52`: `HeaderHeightContext`
  // reports the LIVE, currently-animating header height, not a collapsed
  // baseline — @react-navigation/native-stack feeds it from the native
  // `onHeaderHeightChange` event (and debounces it precisely because it
  // changes constantly on a large-title screen), and react-native-screens
  // computes it as `navigationBar.frame.size.height + origin.y`, re-emitted on
  // every layout pass. Adding a hardcoded 52pt band to it double-counted the
  // band whenever the large title was ALREADY expanded — i.e. whenever the
  // user was already at the top — and scrolled 52pt PAST the real top. Nothing
  // clamped that: `Screen` sets `scrollToOverflowEnabled` (which is exactly
  // the branch RN skips its bounds clamp on) and UIKit does not rubber-band an
  // animated programmatic `setContentOffset`, so the content parked in a black
  // void and stayed there.
  //
  // A tab root mounts at the top, so the expanded height is observed on the
  // first frame; the maximum is therefore correct from the first tap, and it
  // is exact rather than a guessed constant.
  const expandedHeaderHeight = useRef(0);

  useEffect(() => {
    expandedHeaderHeight.current = 0;
  }, [width, height]);

  if (headerHeight > expandedHeaderHeight.current) {
    expandedHeaderHeight.current = headerHeight;
  }
```

The bare `if` during render is a deliberate write to a ref, not state — it cannot trigger a re-render and it must run before the effect below reads it. If Biome objects to a render-phase ref write, move it into a `useEffect` keyed on `headerHeight` and accept one extra frame of staleness on the very first tap; the render-phase form is preferred because it is correct on the first tap.

`useWindowDimensions` comes from `react-native`; `useRef` is already imported at `:9`.

- [ ] **Step 4: Target the expanded height, and add the offset guard**

Widen the signature (`:159`):

```ts
export const useScrollToTopOnTabPress = (
  ref: RefObject<TabRootScrollable | null>,
  scrollOffset?: { value: number },
): void => {
```

Then replace the target computation and the scroll call inside the `requestAnimationFrame` callback (`:201-215`):

```ts
          requestAnimationFrame(() => {
            const scrollable = getScrollableNode(ref);

            if (!isFocused || !isFirst || !scrollable || e.defaultPrevented) {
              return;
            }

            // The expanded large-title top, as the device reported it. No
            // hardcoded band — see `expandedHeaderHeight` above. A
            // header-hidden screen (Home) reports 0, so the target stays 0 and
            // RN's own clamp handles it.
            const target = -expandedHeaderHeight.current;

            // Defense in depth: if the content is ALREADY at or above the
            // target, there is nothing to scroll to and a scroll could only
            // move it away from the top. This makes any future mis-tuned
            // target structurally incapable of producing the void at the top
            // that the hardcoded 52pt band used to produce. `scrollOffset` is
            // reanimated's live `contentOffset.y` on the same animated ref the
            // caller already holds; it is optional because a caller without an
            // animated ref (Home's SectionList) does not need it — its target
            // is 0 and RN clamps it anyway.
            if (scrollOffset !== undefined && scrollOffset.value <= target) {
              return;
            }

            scrollToTrueTop(scrollable, target);
          });
```

Note this also inverts the original `if (isFocused && isFirst && scrollable && !e.defaultPrevented)` into an early return, which keeps the added guards flat rather than nesting four levels deep — `kiko-code-style`'s cognitive-complexity cap of 15 applies to this callback too.

- [ ] **Step 5: Rewrite the hook's doc comment**

Replace the "The reason:" paragraph at `:141-157` — it explains the false premise at length. New text:

```
 * This mirrors React Navigation's own `useScrollToTop` — it walks the parent
 * chain to the tab navigator, subscribes to `tabPress`, gates the scroll on the
 * screen being focused AND on being the first route of its stack (so a re-tap on
 * a pushed detail does not scroll), respects `preventDefault`, and defers the
 * scroll one frame so all other `tabPress` listeners have run — with one
 * deliberate difference: it scrolls to `-expandedHeaderHeight` rather than a
 * literal `y: 0`.
 *
 * The reason: the native-stack large-title tab roots (Statistics / Accounts /
 * Settings) render inside the `Screen` primitive's `ScrollView`, which sets
 * `contentInsetAdjustmentBehavior="automatic"`. At the fully expanded top the
 * content offset is negative (the large-title band), so `useScrollToTop`'s
 * `y: 0` lands one inset-height below the true top and leaves the large title
 * hidden. That `ScrollView` also sets `scrollToOverflowEnabled`, which disables
 * RN's own clamp, and iOS does not clamp an animated programmatic scroll — so a
 * negative target reaches UIKit verbatim and an over-large one parks the content
 * in a void of empty space with nothing to bring it back.
 *
 * The target is therefore the EXPANDED header height the device itself reports
 * (see `expandedHeaderHeight` in the body), not a live height plus a guessed
 * constant. Home hides its header (`headerHeight` is 0, target 0) and its
 * `SectionList` is not the overflow-enabled ScrollView, so RN still clamps its
 * 0 target — Home is unaffected either way.
```

- [ ] **Step 6: Pass the live offset from the three affected screens**

In each of `src/screens/statistics/statistics.screen.tsx`, `src/screens/accounts/accounts.screen.tsx` and `src/screens/settings/settings.screen.tsx`, add the reanimated offset next to the existing animated ref and pass it through:

```tsx
  const scrollRef = useAnimatedRef<ScrollViewInstance>();
  // The live `contentOffset.y`, so the scroll-to-top hook can skip a scroll
  // when the content is already at the top (see its own doc comment).
  const scrollOffset = useScrollOffset(scrollRef);
  useScrollToTopOnTabPress(scrollRef, scrollOffset);
```

Import `useScrollOffset` from `react-native-reanimated` alongside the existing `useAnimatedRef`. Use `useScrollOffset`, **not** `useScrollViewOffset` — the latter is a deprecated alias in this version (`node_modules/react-native-reanimated/src/index.ts:147-149`).

Leave `src/screens/home/home.screen.tsx:151` alone: its ref is a plain `useRef<SectionListInstance>` (not animated, so `useScrollOffset` does not apply), its target is 0, and it is not affected by this bug.

`react-native-reanimated` is already in `jest.config.js`'s `transformIgnorePatterns` allow-list, so no Jest config change is needed. If a screen test fails on `useScrollOffset`, check `jest/reanimated-mock.js` and add a passthrough returning `{ value: 0 }` in the same style as the rest of that mock.

- [ ] **Step 7: Correct the now-wrong comment in `screen.component.tsx`**

At `src/design-system/components/screen/screen.component.tsx:73-84`, the `scrollToOverflowEnabled` comment says the hook "keeps the target bounded to the header inset (`-headerHeight`), which lands exactly at the expanded large-title top and can never overshoot". The second half was the false premise. Replace with:

```tsx
          // RN's `scrollTo` clamps a programmatic negative y back to `0`, so the
          // scroll-to-top hook's negative target — more negative than that `0`
          // top edge — would be clamped away and the collapsed large title would
          // never re-expand. This prop disables RN's clamp, letting the negative
          // target reach iOS `setContentOffset`.
          //
          // The trade-off: with the clamp off, iOS does NOT clamp an animated
          // programmatic scroll either, so an over-large target parks the content
          // in a void of empty space with nothing to bring it back. The hook
          // therefore targets the EXPANDED header height the device itself
          // reports and skips the scroll when the content is already at or above
          // it — it does not add a guessed constant to a live value, which is
          // exactly the bug that produced a 52pt void when the large title was
          // already open. See `use-scroll-to-top-on-tab-press.ts`.
          //
          // Programmatic-scroll only; user scrolling is unaffected.
          scrollToOverflowEnabled={true}
```

- [ ] **Step 8: Run green**

```bash
npx jest src/navigation src/screens/statistics src/screens/accounts src/screens/settings src/screens/home src/design-system/components/screen
npm run check:typecheck
```

Expected: PASS, including the pre-existing 7 cases in `use-scroll-to-top-on-tab-press.test.tsx` once their `-148` expectations are re-derived from `MOCK_EXPANDED_HEADER_HEIGHT` rather than from `MOCK_HEADER_HEIGHT + LARGE_TITLE_BAND`. Grep the file for any surviving `LARGE_TITLE_BAND` reference.

- [ ] **Step 9: Queue the manual verification**

**MANUAL-8 (ops, simulator; then user, device):** open Statistics and stay at the top. Tap the Statistics tab twice. The content must not move and no black void must appear above the large title. Then scroll down and tap the tab once: the list must return to the fully expanded large-title top, with the title visible and no gap above it. Repeat on Accounts and Settings.

---

## Task 38: T-24 — Localize the widget's snapshot-driven strings

**Confidence: CONFIRMED.**

`ios/KikoWidget/NetWorthWidgetView.swift:37`, `:39` and `:51` are literal English (`"Open Kiko"`, `"Track your net worth here"`, `"Net worth"`), and `NetWorthWidget.swift:61-62` hard-codes `configurationDisplayName("Net Worth")` / `description(...)`. There is no `.lproj` / `Localizable.strings` anywhere in `ios/KikoWidget`. A `uk` user sees "Капітал" in the app and "Net worth" on the widget.

**Chosen fix:** carry the labels **in the snapshot** (`labels: { title, placeholderTitle, placeholderHint }`, filled with `i18n.t` in `buildNetWorthSnapshot`) and render them in `NetWorthWidgetView`. This is what a `Localizable.strings` bundle could *not* do: `.lproj` follows the **device** language, while Kiko's language is a persisted in-app setting, so a bundle would disagree with the app whenever the two differ. Keep both sides in lockstep, per `kiko-widget`.

**Deliberately out of scope: `NetWorthWidget.swift:61-62`.** `configurationDisplayName` and `description` are WidgetKit **gallery** metadata, evaluated by the system when the user browses the widget picker — with no snapshot available and no app process running. They cannot read the snapshot. Localizing them would require a `.lproj` bundle keyed to the device language, which would then disagree with the in-app language for exactly the users this task is for. Leave them English and record why in a code comment; raise it as a separate decision if the user wants it.

> **CONFLICT WARNING — this task runs second-to-last for a reason.** The `security-pass-fixes` branch removes `trend` from `src/widget/net-worth-snapshot.ts` (`:18`, `:27`, `:37`, `:43`), `ios/KikoWidget/NetWorthSnapshot.swift` (the `TrendPoint` struct at `:30-35` and the `trend` field at `:40`), and their tests. It also edits `ios/KikoWidget/NetWorthWidgetView.swift`.
>
> **Rules:** add `labels` **after** `updatedAt` in both the TS type and the Swift struct, never adjacent to `trend`, so the hunks do not overlap. Do not read, rename, reorder or reformat any `trend` line. `NetWorthWidgetView.swift` contains no `trend` reference today, so the three string edits there should not conflict.
>
> **If a conflict does arise:** take **both** sides — the security branch's `trend` deletion and this branch's `labels` addition are independent additive/subtractive edits to the same type. Never resolve by dropping `labels` or by restoring `trend`.
>
> **Also inbound from Task 5 (T-26, the typecheck task) on this same branch:** `src/widget/net-worth-snapshot.test.ts`'s shared `holding()` fixture factory is now annotated `(over: Partial<HoldingRow>): HoldingRow` (it previously inferred `type`/`currency` as `string`, which `tsc --noEmit` rejects). That edit is in the file **header**, nowhere near a `trend` line, so it should not conflict. If it does: keep the annotation — it is required for `check:typecheck` to stay at zero — and take the security branch's deletion of the `trend` assertions around it.

**Files:**
- Modify: `src/widget/net-worth-snapshot.ts:14-46`
- Modify: `ios/KikoWidget/NetWorthSnapshot.swift:15-42`
- Modify: `ios/KikoWidget/NetWorthWidgetView.swift:32-53`
- Modify: `ios/KikoWidget/NetWorthWidget.swift:58-64` (comment only)
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts`
- Test: `src/widget/net-worth-snapshot.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/widget/net-worth-snapshot.ts — appended to NetWorthSnapshot
  labels: { title: string; placeholderTitle: string; placeholderHint: string };
  ```
  New catalogue keys `widget.placeholderTitle` and `widget.placeholderHint`; `labels.title` reuses the existing `home.netWorth` so the widget's headline can never drift from the app card's.

- [ ] **Step 1: Write the failing test**

```ts
it('carries the localized labels', () => {
  const snapshot = buildNetWorthSnapshot({ ...baseInput });

  expect(snapshot.labels).toEqual({
    title: i18n.t('home.netWorth'),
    placeholderTitle: i18n.t('widget.placeholderTitle'),
    placeholderHint: i18n.t('widget.placeholderHint'),
  });
});

it('rebuilds the labels in the active language', async () => {
  await i18n.changeLanguage('uk');

  const snapshot = buildNetWorthSnapshot({ ...baseInput });

  expect(snapshot.labels.title).toBe(i18n.t('home.netWorth'));
  expect(snapshot.labels.title).not.toBe('Net worth');

  await i18n.changeLanguage('en');
});
```

Read the file's existing `baseInput`-equivalent fixture; keep `trendPoints` in it exactly as it is.

- [ ] **Step 2: Run it and confirm the failure**

```bash
npx jest src/widget/net-worth-snapshot.test.ts
```

Expected: `snapshot.labels` is `undefined`.

- [ ] **Step 3: Add `widget` keys to BOTH catalogues**

`src/i18n/locales/en.ts` — a new top-level block, placed to keep the file's existing ordering:

```ts
  // The home-screen WidgetKit extension (ios/KikoWidget). These strings are
  // carried IN the snapshot (src/widget/net-worth-snapshot.ts) rather than in
  // a Localizable.strings bundle, because a .lproj bundle follows the DEVICE
  // language while Kiko's language is a persisted in-app setting — the two
  // would disagree for exactly the users this exists for. The widget's headline
  // reuses `home.netWorth` so it can never drift from the app card's.
  widget: {
    placeholderHint: 'Track your net worth here',
    placeholderTitle: 'Open Kiko',
  },
```

`src/i18n/locales/uk.ts` — same block, same key order:

```ts
  widget: {
    placeholderHint: 'Відстежуйте свій капітал тут',
    placeholderTitle: 'Відкрити Kiko',
  },
```

- [ ] **Step 4: Add `labels` to the TS snapshot**

In `src/widget/net-worth-snapshot.ts`, append the field **after** `updatedAt` (not near `trend`):

```ts
export type NetWorthSnapshot = {
  baseCurrency: Currency;
  total: { formatted: string; minorUnits: number };
  breakdown: { currency: Currency; minorUnits: number; formatted: string }[];
  trend: { time: number; value: number }[];
  updatedAt: number;
  // Every user-facing string the widget renders, resolved through `i18n.t` at
  // build time so the widget follows the app's persisted language. The widget
  // extension runs in a separate process with no JS and no access to the
  // catalogues, and a Localizable.strings bundle would follow the DEVICE
  // language instead — which is precisely the mismatch this avoids. Keep in
  // lockstep with `NetWorthSnapshot.Labels` in
  // ios/KikoWidget/NetWorthSnapshot.swift.
  labels: { title: string; placeholderTitle: string; placeholderHint: string };
};
```

and in `buildNetWorthSnapshot`'s return object, also after `updatedAt`:

```ts
    updatedAt: input.now,
    labels: {
      title: i18n.t('home.netWorth'),
      placeholderTitle: i18n.t('widget.placeholderTitle'),
      placeholderHint: i18n.t('widget.placeholderHint'),
    },
```

Import `i18n` from `../i18n`. The file already imports `activeLocale` from `../i18n/active-locale`, so the i18n singleton is an established dependency here — this is a plain (non-component) module, which reads the singleton directly rather than via `useTranslation` (`kiko-code-style`, same pattern as `category-display.ts`).

- [ ] **Step 5: Mirror it in the Swift struct**

In `ios/KikoWidget/NetWorthSnapshot.swift`, add a nested struct and the field **after** `updatedAt`:

```swift
    /// Every user-facing string the widget renders, resolved by the app through
    /// `i18n.t` at snapshot-build time. NOT a Localizable.strings bundle: a
    /// .lproj bundle follows the DEVICE language, while Kiko's language is a
    /// persisted in-app setting, so the two would disagree. Mirrors
    /// `NetWorthSnapshot['labels']` in src/widget/net-worth-snapshot.ts.
    struct Labels: Codable {
        let title: String
        let placeholderTitle: String
        let placeholderHint: String
    }

    let baseCurrency: String
    let total: Total
    let breakdown: [BreakdownItem]
    let trend: [TrendPoint]
    let updatedAt: Int
    let labels: Labels
```

Place the `Labels` struct declaration after `TrendPoint` (`:30-35`) without touching it. **A non-optional `let labels`** means an older snapshot file on disk (written before this ships, with no `labels` key) fails to decode and `SnapshotLoader.load()` returns `nil` → the widget shows its placeholder until the app writes once. That is the correct, self-healing outcome (the app writes on every backgrounding), and it matches how the existing struct treats every other field. Say so in a comment so a reader does not "fix" it to an optional.

- [ ] **Step 6: Render the labels in the widget view**

In `ios/KikoWidget/NetWorthWidgetView.swift`, the placeholder (`:32-44`) has no snapshot, so it must read the labels from `entry.snapshot` — which is `nil` in exactly that branch. Restructure so the placeholder takes its strings from the snapshot when one exists and falls back to English only when the snapshot could not be decoded at all:

```swift
    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                content(for: snapshot)
            } else {
                placeholder
            }
        }
        .widgetBackground()
    }

    /// Shown only when NO snapshot could be decoded — a first install before
    /// the app has ever run, or a container/JSON failure. There is no snapshot
    /// to read localized labels from in that state and the extension cannot
    /// reach the app's catalogues, so these two strings stay English. Every
    /// label on the populated path below comes from `snapshot.labels`.
    private var placeholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "wallet.pass")
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
            Text("Open Kiko")
                .font(.headline)
            Text("Track your net worth here")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
```

and in `content(for:)` (`:46-65`), replace the literal at `:51`:

```swift
            Text(snapshot.labels.title)
```

**Note the honest limitation:** the placeholder branch genuinely cannot be localized from the snapshot, because its precondition is "there is no snapshot". `labels.placeholderTitle` / `labels.placeholderHint` therefore exist for a *decoded* snapshot that has no data to show — check whether `content(for:)` has such an empty-breakdown path, and if it does, render the localized placeholder strings there. If it does not, either add that path or drop the two placeholder keys from the snapshot rather than shipping unused fields (Knip will not see Swift, but an unused field violates the lockstep contract). Decide this by reading `NetWorthWidget.swift`'s `TimelineProvider` — if it emits a `placeholder(in:)` entry with a decoded-but-empty snapshot, the localized strings are reachable and should be used there.

- [ ] **Step 7: Comment the gallery-metadata carve-out**

In `ios/KikoWidget/NetWorthWidget.swift`, above `configurationDisplayName` (`:61`):

```swift
        // DELIBERATELY English. `configurationDisplayName` and `description` are
        // WidgetKit GALLERY metadata: the system renders them in the widget
        // picker with no snapshot available and no app process running, so they
        // cannot read `snapshot.labels`. Localizing them would need a .lproj
        // bundle keyed to the DEVICE language, which would then disagree with
        // the in-app language for exactly the users the snapshot labels serve.
        // Tracked as a separate decision, not an oversight.
```

- [ ] **Step 8: Verify the TS/Swift lockstep by reading both files side by side**

Per `kiko-widget`, there is no shared schema generation — nothing else will catch a drift. Read `src/widget/net-worth-snapshot.ts`'s `NetWorthSnapshot` and `ios/KikoWidget/NetWorthSnapshot.swift`'s struct together and confirm every field matches by name and type, including that `labels` is the last field on both sides.

- [ ] **Step 9: Run green**

```bash
npx jest src/widget src/i18n
npm run check:typecheck
npm run check:all
```

- [ ] **Step 10: Queue the manual verification**

**MANUAL-9 (ops, simulator):** rebuild and reinstall, switch Kiko to Ukrainian, background the app (so the snapshot writes), then check the home-screen widget reads "Капітал" rather than "Net worth". A `swift build` is not enough — the widget must be re-added or its timeline reloaded.

---

## Task 39: T-43 — Re-write the widget snapshot when only the language changes

**Confidence: CONFIRMED.**

`writeNow`'s dependency list (`src/widget/use-net-worth-widget.ts:118`) is `[accounts, holdings, rates, transactions, historyRows, baseCurrency]`. Switching language writes only `settings.language`, which changes none of them (`baseCurrency` is unchanged), so `writeNow`'s identity is stable, the debounce effect never re-fires, and the snapshot keeps the previous locale's number grouping (₴1,234.56 vs 1 234,56 ₴) until some other table changes. The `AppState` background handler (`:131-142`) usually hides this — and it will matter much more once Task 38's localized labels land.

> **CONFLICT WARNING.** The `security-pass-fixes` branch removes the `transactions` and `historyRows` live queries from this hook and shortens that exact dependency array (they exist only to feed the `trend` it deletes). **A one-line conflict on line 118 is expected.**
>
> **Resolution:** take the security branch's shortened array and add `language` to it — e.g. `[accounts, holdings, rates, baseCurrency, language]`. Never resolve by restoring `transactions`/`historyRows` and never by dropping `language`.
>
> Do not touch any other `trend`-related line in this file (`:63-72`, `:98`, `:105-118`).
>
> **Second, smaller conflict — `src/widget/use-net-worth-widget.test.ts`, inbound from Task 5 (T-26, the typecheck task) on this same branch.** Task 5 typed the widget-bridge mock (`jest.fn((_snapshot: NetWorthSnapshot) => ...)`) and replaced each raw `mockWriteSnapshot.mock.calls[0]?.[0]` read with a `writtenSnapshot()` helper that throws on a missing call — forced by `TS18048: 'snapshot' is possibly 'undefined'`, so it cannot be reverted without reopening the typecheck baseline. **One of those replacements sits inside the `'writes an empty trend when there are no history rows yet (first run)'` test, which the security branch deletes outright.**
>
> **Resolution:** take the security branch's **deletion** of that whole test, and keep Task 5's typed mock plus the `writtenSnapshot()` helper for the tests that survive (it is still used by the `'writes the snapshot after the debounce'` case). Never resolve by restoring the trend test to preserve the helper call, and never by reverting to `mock.calls[0]?.[0]` — that reintroduces a `check:typecheck` failure.

**Files:**
- Modify: `src/widget/use-net-worth-widget.ts:102-118`
- Test: `src/widget/use-net-worth-widget.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('re-writes the snapshot when only the language changes', async () => {
  mockSettingsRows = [{ baseCurrency: 'UAH', language: 'en' }];

  const { rerender } = renderHook(() => useNetWorthWidget());

  await act(async () => {
    jest.advanceTimersByTime(DEBOUNCE_MS + 1);
  });

  expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);

  // Only `settings.language` changes — no other table, and baseCurrency is
  // untouched.
  mockSettingsRows = [{ baseCurrency: 'UAH', language: 'uk' }];
  rerender();

  await act(async () => {
    jest.advanceTimersByTime(DEBOUNCE_MS + 1);
  });

  expect(mockWriteSnapshot).toHaveBeenCalledTimes(2);
});

it('does not re-write when nothing changes', async () => {
  mockSettingsRows = [{ baseCurrency: 'UAH', language: 'en' }];

  const { rerender } = renderHook(() => useNetWorthWidget());

  await act(async () => {
    jest.advanceTimersByTime(DEBOUNCE_MS + 1);
  });
  rerender();
  await act(async () => {
    jest.advanceTimersByTime(DEBOUNCE_MS + 1);
  });

  expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
});
```

Read the file for its real mock names, its fake-timer setup, and the exported `DEBOUNCE_MS` (or its literal value). The second test is the guard rail: adding a dependency must not make the hook re-write on every render.

- [ ] **Step 2: Run it and confirm the failure**

```bash
npx jest src/widget/use-net-worth-widget.test.ts
```

Expected: `mockWriteSnapshot` is still at 1 call after the language change.

- [ ] **Step 3: Add the persisted language to `writeNow`'s dependencies**

In `src/widget/use-net-worth-widget.ts`, next to the existing `baseCurrency` derivation (`:102`) — a **new line**, so it does not conflict:

```ts
  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  // The persisted language, in `writeNow`'s dependency list below: every
  // formatted string in the snapshot is locale-dependent (₴1,234.56 vs
  // 1 234,56 ₴, and since the widget's labels are carried in the snapshot, the
  // labels themselves), but a language switch writes only `settings.language` —
  // no other watched table, and `baseCurrency` is unchanged — so `writeNow`'s
  // identity was stable, the debounce never re-fired, and the widget kept the
  // previous locale until something unrelated changed.
  const language = settingsRows.at(0)?.language ?? null;
```

and add `language` to the `useCallback` dependency array at `:118`. **That one line is the expected merge conflict — see the warning above.**

Reading the language off the settings row (rather than `i18n.language`) is deliberate: `settingsRows` is already a live query in this hook, so the change is observed reactively with no new subscription, and it is the same value `useSyncLanguageWithSettings` feeds into `changeLanguage`. If the merge with the security branch makes the dependency-array edit painful, the conflict-free alternative is a third `useEffect` subscribing to i18next's `languageChanged` event — but prefer the dependency, since it matches the spec's own fix and needs no new listener lifecycle.

- [ ] **Step 4: Run green**

```bash
npx jest src/widget
npm run check:typecheck
```

---

### CHECKPOINT after Task 39 — widget tier complete

```bash
npm run check:all
npm run check:typecheck
npx jest
```

---

## Task 40: Verification before completion

**REQUIRED SUB-SKILL: `superpowers:verification-before-completion`.** Nothing is "done" until every gate below is green and the manual list has been dispatched.

- [ ] **Step 1: Full harness, fast + medium tier**

```bash
npm run check:all
```

Runs lint, dup, knip, deps, security, secrets, overrides, typecheck (added in Task 5). Must exit 0 with no output. If `check:deps` surfaces a changed dependency block, that is the `@types/node` addition from Task 5 — confirm it and check that the root `CLAUDE.md` "Documented exceptions" entry for it is present.

- [ ] **Step 2: Full test suite**

```bash
npx jest 2>&1 | tail -30
```

Must be green. Record the suite/test counts and compare against the `e36213c` baseline of **165 suites / 1545 tests** — the count must be *higher* (this plan adds tests to ~35 files and creates 9 new test files). A *lower* count means a test file was accidentally emptied or excluded.

Also grep the output for `UnhandledPromiseRejection` — Task 15 exists to remove those.

- [ ] **Step 3: Zero type errors**

```bash
npx tsc --noEmit && echo "0 errors"
npm run check:typecheck && echo "check:typecheck OK"
```

Both must be silent/exit 0. The Task 5 baseline was 483 errors; anything above zero is a regression introduced by a later task.

- [ ] **Step 4: Deep tier — mutation score and CVEs**

```bash
npm run check:deep
```

This runs Stryker (break threshold 60) then osv-scanner. **Report the mutation score explicitly** in the completion message — it must be **at or above 60**. The last recorded score was 73% (memory: the crypto-btc-sync run), so a large drop means this plan's new code is under-tested; find the surviving mutants Stryker names and add the missing assertions rather than lowering the threshold.

osv-scanner will still flag the accepted, documented debt — do **not** treat these as new failures and do **not** suppress them:
- `image-size` 1.2.1: GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr (no patched release upstream).
- `decode-uri-component` 0.2.2: GHSA-vcc3-ghjq-m6fr (the fix is ESM-only and breaks `query-string@7.1.3` + Jest).

Any **other** CVE is new — most likely from Task 5's `@types/node` addition. Investigate it, do not accept it.

- [ ] **Step 5: Migrations apply cleanly in order**

Three new migrations landed (0014 lowercase categories, 0015 exchange marker + backfill, 0016 seed category colors), plus 0017 if Task 16's `hold` column was generated. Verify:

```bash
ls drizzle/migrations/*.sql
python3 -c "
import json
j = json.load(open('drizzle/migrations/meta/_journal.json'))
entries = j['entries']
idxs = [e['idx'] for e in entries]
whens = [e['when'] for e in entries]
assert idxs == sorted(idxs) == list(range(len(idxs))), ('idx gap or disorder', idxs)
assert whens == sorted(whens), ('when out of order', whens)
print('journal OK:', len(entries), 'entries, last =', entries[-1]['tag'])
"
grep -c "^import m" drizzle/migrations/migrations.js
```

Every `.sql` file must have a journal entry with a strictly increasing `idx` and a non-decreasing `when`, and `migrations.js` must import every one — a missing import means the migration silently never runs on device. Cross-check the import count against the `.sql` count.

- [ ] **Step 6: Ops simulator build**

Dispatch the **ops** agent to build and launch on the simulator from this worktree:

```bash
npx react-native run-ios
```

If `ios/build` was cleaned at any point, `pod install` must run first — deleting `ios/build` wipes ReactCodegen's generated sources and the build then fails with "Build input file cannot be found .../ReactCodegen/.../States.cpp". Do not gate a device build on `xctrace` reporting "offline".

- [ ] **Step 7: Confirm nothing was committed**

```bash
git -C /Users/drizzer14/orca/workspaces/pff-ios/bug-hunt-fixes log --oneline -1
git -C /Users/drizzer14/orca/workspaces/pff-ios/bug-hunt-fixes status --short | wc -l
```

`HEAD` must still be `e36213c`. The status must list every changed file as unstaged/untracked. **If `HEAD` has moved, a commit was made in violation of this plan's global constraint — report it immediately.**

- [ ] **Step 8: Report**

Report to the coordinator:
1. `npm run check:all` result.
2. Jest suite/test counts, compared to 165/1545.
3. `npx tsc --noEmit` error count (must be 0), and that `check:typecheck` is wired into `check:all` + `medium.sh`.
4. **The mutation score**, and whether it is at or above 60.
5. Any osv-scanner finding beyond the two documented ones.
6. The simulator build result.
7. **T-29 is blocked** — it needs a real recap-OFF bank statement from the user (see Task 24).
8. **T-1's spec entry was wrong** — `App.tsx:33` was a second `settingsRepo.ensure()` caller, so the reported "every setting silently reverts" symptom does not reproduce; the fix landed anyway for the race and the ordering Task 23 depends on (see Task 1 Step 1).
9. The manual verification list below, with anything ops already covered marked done.

---

## Manual verifications

Jest cannot assert any of these. Items marked **(ops)** are for the ops agent on the simulator during Task 40 Step 6; items marked **(user)** need real hardware and go to the user.

| ID | Task | Who | What to check |
|---|---|---|---|
| MANUAL-1 | 4 (T-11) | ops | Simulator set to **Light** appearance (Settings → Developer → Dark Appearance off). Launch Kiko: the status bar clock/battery must be visible against the black background; the tab bar must stay dark while switching tabs; a delete `Alert` must render dark. |
| MANUAL-2 | 4 (T-10/T-11) | user | Device Display & Brightness → **Light**. Launch, switch tabs (the bar must not flip), open a delete alert, and open the transaction date picker — all dark. |
| MANUAL-3 | 20 (T-21) | ops | Statistics → Expenses-by-Category donut: no two wedges share a hue. Home filter chips match their row icons. |
| MANUAL-4 | 23 (T-25) | user | Device language **English**, Kiko language **Ukrainian**, app lock **on**. Force-quit and cold-launch: "Готуємо базу даних…", "Заблоковано" and "Розблокувати" must all be Ukrainian *before* Face ID. |
| MANUAL-5 | 31 (T-36) | user | Settings → Categories. Long-press **inside** a name field: cursor/Paste appears, no card lifts. Long-press on a card's icon/empty area and drag: reorder still works. Retune `CATEGORY_DRAG_ACTIVATION_MS` on-device if 600 ms feels sluggish. |
| MANUAL-6 | 34 (T-40) | ops | Home list scrolled to the bottom: the gap between the last row and the tab bar matches Accounts/Settings (no extra ~34 pt). |
| MANUAL-7 | 35 (T-41) | ops | Switch to Ukrainian: Accounts / Account detail / Holding detail / Contribution form buttons read in sentence case ("Додати рахунок", not "Додати Рахунок"). Switch back to English and re-check each. |
| MANUAL-8 | 37 (T-44) | ops, then user | Statistics at the top: tap the Statistics tab **twice** — content must not move and no black void must appear above the large title. Then scroll down and tap once: must return to the fully expanded large-title top with no gap. Repeat on Accounts and Settings. |
| MANUAL-9 | 38 (T-24) | ops | Rebuild + reinstall, switch Kiko to Ukrainian, background the app (forces a snapshot write), then check the home-screen widget reads "Капітал", not "Net worth". Re-add the widget or reload its timeline — a rebuild alone is not enough. |

Device-only checks for the user, collected: **MANUAL-2**, **MANUAL-4**, **MANUAL-5**, and the device half of **MANUAL-8**.
