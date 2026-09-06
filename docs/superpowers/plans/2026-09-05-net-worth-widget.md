# iOS Net Worth Widget (Medium 4x2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Recommendation (not a hard ordering):** Ship the Exchange transaction feature (`docs/superpowers/plans/2026-09-05-exchange-transaction.md`) FIRST. Exchange is JavaScript-only and lands quickly; this widget carries the heavier native/signing setup (a new WidgetKit extension target, an App Group entitlement on both targets, a native bridge module, and provisioning). Sequencing Exchange first keeps the JS-only win unblocked while the native work proceeds. This is a recommendation, not a dependency — the two features do not touch the same files.

**Goal:** Add an iOS home-screen Medium (`systemMedium`, 4x2) widget that shows net worth (label, base-currency total, per-currency breakdown, mini trend line) from a snapshot the app writes to a shared App Group container.

**Architecture:** A widget runs in a separate extension process and cannot run app JavaScript or open the op-sqlite database. The app computes a snapshot in TypeScript (reusing the existing net-worth math), writes it to the App Group via a native `WidgetBridge`, and asks WidgetKit to reload. The `KikoWidget` SwiftUI extension reads that snapshot and renders the Medium layout.

**Tech Stack:** TypeScript, React Native (New Architecture), react-native-unistyles, op-sqlite + drizzle-orm; Swift + SwiftUI + WidgetKit for the extension; a Swift RN native module for the bridge. Jest for TS unit tests; on-device build (ops) for the widget itself.

**Spec:** `docs/superpowers/specs/2026-09-05-net-worth-widget-design.md`

## Global Constraints

- Scope is the Medium (`systemMedium`, 4x2) family ONLY. Small, Large, lock-screen accessory families, interactive controls, and an `AppIntent` configuration UI are all out of scope.
- The widget cannot query the DB live. Data reaches it ONLY through the App Group snapshot the app writes. The widget shows a snapshot, not live data.
- ONE snapshot builder in TypeScript is the single source of truth shared by the home screen and the widget writer — never recompute net worth in the widget path. Reuse `guardedNetWorth` + `buildRateTable` (`src/rates/net-worth-view.ts`), `sumByCurrency` (`src/rates/currency-totals.ts`), `buildNetWorthSeries` (`src/statistics/net-worth-series.ts`), and `formatMoney` (`src/currency/format.ts`). Do NOT re-implement any of these.
- The active-holding filter (open holding AND non-archived parent account) MUST be applied identically to the home screen's. It is extracted once (Task 1) so the home screen and the snapshot builder share it and cannot drift — the home screen's current inline expression lives at `src/screens/home/home.screen.tsx:194-199`; re-read it at implementation time.
- The App Group identifier is chosen by OPS at implementation time to match the app's bundle id (form `group.<bundle-id>`). It is referenced symbolically everywhere in this plan as `<APP_GROUP_ID>`; ops fixes the concrete value and wires it into both targets' entitlements and the native bridge.
- Snapshot payload shape (JSON): `baseCurrency`, `total` (`{ formatted, minorUnits }`), `breakdown` (`{ currency, minorUnits }[]`), `trend` (`{ time, value }[]`), `updatedAt` (epoch ms).
- Error handling: no snapshot -> widget placeholder ("Open Kiko"); missing rate pair -> already excluded by `guardedNetWorth`; fewer than two trend points -> widget omits the line, shows the total only; malformed/unreadable snapshot -> placeholder.
- Do NOT screenshot the simulator for design review; rebuild and let the user review live (project rule). Jest alone cannot verify the widget.
- Code style: single quotes, 2-space indent, trailing commas, `arrowParentheses: always`, blank line before every `return`/`if`/`for`/`throw`/`try`, `import type` for type-only imports, full unabbreviated names, named exports for utilities/hooks/types (`kiko-code-style`).
- Harness: run `npm run check:all` at each JS/TS task checkpoint; run `npm run check:deep` before declaring the feature done. Native/Xcode tasks are verified by an ops build, not by the JS harness.

---

## File Structure

- `src/rates/active-holdings.ts` (new) — the shared active-holding filter (open holding AND non-archived parent account), extracted from the home screen so the widget builder and the home screen call the same one.
- `src/rates/active-holdings.test.ts` (new) — unit tests for the filter.
- `src/screens/home/home.screen.tsx` (modify) — call the extracted filter instead of the inline expression (behavior-preserving).
- `src/widget/net-worth-snapshot.ts` (new) — the pure snapshot builder.
- `src/widget/net-worth-snapshot.test.ts` (new) — unit tests for the builder.
- `src/widget/widget-bridge.ts` (new) — the typed TypeScript wrapper over the native `WidgetBridge` module (`writeSnapshot`, `reloadWidget`), degrading gracefully when the native module is absent (Jest).
- `src/widget/widget-bridge.test.ts` (new) — unit tests for the wrapper's guard behavior.
- `src/widget/use-net-worth-widget.ts` (new) — the app-side hook: runs the live queries, builds the snapshot, writes + reloads (debounced; also on app background).
- `src/widget/use-net-worth-widget.test.ts` (new) — unit tests for the hook's write/debounce/background behavior.
- `App.tsx` (modify) — mount `useNetWorthWidget()` in `AppRoot`.
- `ios/` (native, ops): `WidgetBridge` Swift module (`ios/Kiko/WidgetBridge.swift` + `WidgetBridge.m` bridging macro), the `KikoWidget` extension target under `ios/KikoWidget/` (WidgetKit + SwiftUI), App Group entitlements on both targets, and signing/provisioning.
- `.claude/skills/kiko-widget/SKILL.md` (new, scribe) — the durable widget-architecture skill (Task 8), authored after the implementation lands.

---

## Task 1: Extract the shared active-holding filter

The snapshot builder must apply the exact same active-holding filter as the home screen. Extract it once so the two share it and cannot drift.

**Files:**
- Create: `src/rates/active-holdings.ts`
- Test: `src/rates/active-holdings.test.ts`
- Modify: `src/screens/home/home.screen.tsx`

**Interfaces:**
- Consumes: `AccountRow`, `HoldingRow` from `src/db/schema`.
- Produces:

```ts
// Narrow structural inputs so both the home screen's live-query rows and the
// widget hook's rows satisfy them without coupling to the full row types.
type ArchivableAccount = Pick<AccountRow, 'id' | 'archivedAt'>;
type ClosableHolding = Pick<HoldingRow, 'accountId' | 'closedAt'>;

export const activeHoldings = <Holding extends ClosableHolding>(
  holdings: readonly Holding[],
  accounts: readonly ArchivableAccount[],
): Holding[];
```

- [ ] **Step 1 (qa): Write the failing test**

```ts
// src/rates/active-holdings.test.ts
import { activeHoldings } from './active-holdings';

const accounts = [
  { id: 'a1', archivedAt: null },
  { id: 'a2', archivedAt: 1_700_000_000_000 }, // archived
];

describe('activeHoldings', () => {
  it('keeps only open holdings under non-archived accounts', () => {
    const holdings = [
      { accountId: 'a1', closedAt: null, name: 'keep' },
      { accountId: 'a1', closedAt: 123, name: 'closed' },
      { accountId: 'a2', closedAt: null, name: 'archived-parent' },
    ];

    expect(activeHoldings(holdings, accounts).map((holding) => holding.name)).toEqual(['keep']);
  });

  it('returns an empty list when every account is archived', () => {
    const holdings = [{ accountId: 'a2', closedAt: null, name: 'x' }];

    expect(activeHoldings(holdings, accounts)).toEqual([]);
  });
});
```

- [ ] **Step 2 (qa): Run test to verify it fails**

Run: `npx jest src/rates/active-holdings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3 (developer): Implement the filter**

```ts
// src/rates/active-holdings.ts
import type { AccountRow, HoldingRow } from '../db/schema';

type ArchivableAccount = Pick<AccountRow, 'id' | 'archivedAt'>;
type ClosableHolding = Pick<HoldingRow, 'accountId' | 'closedAt'>;

// A holding counts toward net worth only when it is open (no `closedAt`) AND its
// parent account is not archived (no `archivedAt`). This is the ONE place that
// rule lives — the home screen and the widget snapshot builder both call it, so
// the widget's total can never drift from the screen's by disagreeing on which
// holdings are active.
export const activeHoldings = <Holding extends ClosableHolding>(
  holdings: readonly Holding[],
  accounts: readonly ArchivableAccount[],
): Holding[] => {
  const archivedAccountIds = new Set(
    accounts.filter((account) => account.archivedAt != null).map((account) => account.id),
  );

  return holdings.filter(
    (holding) => holding.closedAt == null && !archivedAccountIds.has(holding.accountId),
  );
};
```

- [ ] **Step 4 (developer): Refactor the home screen to call it**

In `src/screens/home/home.screen.tsx`, replace the inline `archivedAccountIds`/`activeHoldings` block (around lines 194-202) with a call to the extracted helper:

```ts
const active = activeHoldings(holdings, accounts);
const now = Date.now();
const total = guardedNetWorth(active, baseCurrency, rateTable, now);
const breakdown = sumByCurrency(active);
```

Add the import (two-group, shortest-first ordering): `import { activeHoldings } from '../../rates/active-holdings';`. Rename the local `activeHoldings` const to `active` to avoid shadowing the imported function. Update the two downstream references (`total`, `breakdown`). Do not change any other home-screen behavior — the existing home-screen tests are the safety net.

- [ ] **Step 5 (qa): Run tests to verify they pass**

Run: `npx jest src/rates/active-holdings.test.ts src/screens/home/home.screen.test.tsx`
Expected: PASS — the new filter tests and the unchanged home-screen tests.

- [ ] **Step 6 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** none. Foundation for Task 2.

---

## Task 2: Pure net-worth snapshot builder

**Files:**
- Create: `src/widget/net-worth-snapshot.ts`
- Test: `src/widget/net-worth-snapshot.test.ts`

**Interfaces:**
- Consumes: `activeHoldings` (Task 1), `guardedNetWorth` (`src/rates/net-worth-view.ts`), `sumByCurrency` (`src/rates/currency-totals.ts`), `formatMoney` (`src/currency/format.ts`), `NetWorthPoint` (`src/statistics/net-worth-series.ts`), `Currency` (`src/currency/currency.ts`), `RateTable` (`src/rates/conversion.ts`), `AccountRow`/`HoldingRow` (`src/db/schema`).
- Produces:

```ts
export type NetWorthSnapshot = {
  baseCurrency: Currency;
  total: { formatted: string; minorUnits: number };
  breakdown: { currency: Currency; minorUnits: number }[];
  trend: { time: number; value: number }[];
  updatedAt: number;
};

export const buildNetWorthSnapshot = (input: {
  holdings: readonly HoldingRow[];
  accounts: readonly Pick<AccountRow, 'id' | 'archivedAt'>[];
  rateTable: RateTable;
  baseCurrency: Currency;
  trendPoints: readonly NetWorthPoint[];
  now: number;
}): NetWorthSnapshot;
```

The builder does NOT build the trend series itself (that needs history rows and is the hook's job, Task 5) — it receives the already-built `NetWorthPoint[]` and maps `{ t, amount }` -> `{ time, value }`. It computes the total via `guardedNetWorth` over `activeHoldings(...)`, the breakdown via `sumByCurrency` over the same active list, and the formatted total via `formatMoney`.

- [ ] **Step 1 (qa): Write the failing tests**

```ts
// src/widget/net-worth-snapshot.test.ts
import { Money } from '../currency/money';
import { guardedNetWorth } from '../rates/net-worth-view';
import { buildNetWorthSnapshot } from './net-worth-snapshot';

const accounts = [
  { id: 'a1', archivedAt: null },
  { id: 'a2', archivedAt: 1_700_000_000_000 },
];

const holding = (over: Partial<Record<string, unknown>>) => ({
  id: 'h', accountId: 'a1', name: 'H', type: 'cash', currency: 'USD',
  icon: null, color: null, balanceMinorUnits: 0, metadata: null,
  sortOrder: 0, closedAt: null, createdAt: 0, ...over,
});

const rateTable = { 'USD:UAH': 40, 'EUR:UAH': 44 };
const now = 1_700_000_100_000;

describe('buildNetWorthSnapshot', () => {
  it("matches guardedNetWorth for the total over the active holdings", () => {
    const holdings = [
      holding({ id: 'h1', currency: 'USD', balanceMinorUnits: 10_000 }), // active
      holding({ id: 'h2', currency: 'USD', balanceMinorUnits: 5_000, closedAt: 1 }), // closed
      holding({ id: 'h3', accountId: 'a2', currency: 'USD', balanceMinorUnits: 9_000 }), // archived parent
    ];
    const snapshot = buildNetWorthSnapshot({
      holdings, accounts, rateTable, baseCurrency: 'UAH', trendPoints: [], now,
    });
    const expected = guardedNetWorth(
      [holding({ id: 'h1', currency: 'USD', balanceMinorUnits: 10_000 })],
      'UAH', rateTable, now,
    );

    expect(snapshot.total.minorUnits).toBe(expected.minorUnits);
    expect(snapshot.baseCurrency).toBe('UAH');
  });

  it('produces a per-currency breakdown over the active holdings', () => {
    const holdings = [
      holding({ id: 'h1', currency: 'USD', balanceMinorUnits: 10_000 }),
      holding({ id: 'h2', currency: 'EUR', balanceMinorUnits: 20_000 }),
    ];
    const snapshot = buildNetWorthSnapshot({
      holdings, accounts, rateTable, baseCurrency: 'UAH', trendPoints: [], now,
    });

    expect(snapshot.breakdown).toEqual(
      expect.arrayContaining([
        { currency: 'USD', minorUnits: 10_000 },
        { currency: 'EUR', minorUnits: 20_000 },
      ]),
    );
  });

  it('formats the total with formatMoney', () => {
    const holdings = [holding({ id: 'h1', currency: 'UAH', balanceMinorUnits: 123_456 })];
    const snapshot = buildNetWorthSnapshot({
      holdings, accounts, rateTable, baseCurrency: 'UAH', trendPoints: [], now,
    });

    expect(snapshot.total.formatted).toContain('1,234.56');
  });

  it('maps trend points from { t, amount } to { time, value }', () => {
    const snapshot = buildNetWorthSnapshot({
      holdings: [], accounts, rateTable, baseCurrency: 'UAH',
      trendPoints: [{ t: 111, amount: 1.5 }, { t: 222, amount: 2.5 }], now,
    });

    expect(snapshot.trend).toEqual([
      { time: 111, value: 1.5 },
      { time: 222, value: 2.5 },
    ]);
  });

  it('handles the empty / first-run case (no holdings, no trend)', () => {
    const snapshot = buildNetWorthSnapshot({
      holdings: [], accounts: [], rateTable: {}, baseCurrency: 'UAH', trendPoints: [], now,
    });

    expect(snapshot.total.minorUnits).toBe(0);
    expect(snapshot.breakdown).toEqual([]);
    expect(snapshot.trend).toEqual([]);
    expect(snapshot.updatedAt).toBe(now);
  });
});
```

- [ ] **Step 2 (qa): Run tests to verify they fail**

Run: `npx jest src/widget/net-worth-snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3 (developer): Implement the builder**

```ts
// src/widget/net-worth-snapshot.ts
import type { Currency } from '../currency/currency';
import { formatMoney } from '../currency/format';
import type { AccountRow, HoldingRow } from '../db/schema';
import type { RateTable } from '../rates/conversion';
import { activeHoldings } from '../rates/active-holdings';
import { sumByCurrency } from '../rates/currency-totals';
import { guardedNetWorth } from '../rates/net-worth-view';
import type { NetWorthPoint } from '../statistics/net-worth-series';

// The snapshot the app writes to the App Group container for the widget to read.
// Its numbers come from the SAME net-worth math the home screen uses (never a
// second computation) so the widget can never disagree with the app.
export type NetWorthSnapshot = {
  baseCurrency: Currency;
  total: { formatted: string; minorUnits: number };
  breakdown: { currency: Currency; minorUnits: number }[];
  trend: { time: number; value: number }[];
  updatedAt: number;
};

export const buildNetWorthSnapshot = (input: {
  holdings: readonly HoldingRow[];
  accounts: readonly Pick<AccountRow, 'id' | 'archivedAt'>[];
  rateTable: RateTable;
  baseCurrency: Currency;
  trendPoints: readonly NetWorthPoint[];
  now: number;
}): NetWorthSnapshot => {
  const active = activeHoldings(input.holdings, input.accounts);
  const total = guardedNetWorth(active, input.baseCurrency, input.rateTable, input.now);
  const breakdown = sumByCurrency(active, input.now).map((money) => ({
    currency: money.currency,
    minorUnits: money.minorUnits,
  }));
  const trend = input.trendPoints.map((point) => ({ time: point.t, value: point.amount }));

  return {
    baseCurrency: input.baseCurrency,
    total: { formatted: formatMoney(total), minorUnits: total.minorUnits },
    breakdown,
    trend,
    updatedAt: input.now,
  };
};
```

- [ ] **Step 4 (qa): Run tests to verify they pass**

Run: `npx jest src/widget/net-worth-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green (watch `check:knip` for `buildNetWorthSnapshot`/`NetWorthSnapshot` reported unused — consumed in Task 5; sequence accordingly).

**Dependencies:** Task 1.

---

## Task 3: Typed WidgetBridge TypeScript wrapper

The typed JS boundary to the native module. It must not throw when the native module is unavailable (Jest, or an app build before the native module lands), so the app never crashes on a missing bridge.

**Files:**
- Create: `src/widget/widget-bridge.ts`
- Test: `src/widget/widget-bridge.test.ts`

**Interfaces:**
- Produces:

```ts
export const widgetBridge: {
  writeSnapshot: (snapshot: NetWorthSnapshot) => Promise<void>;
  reloadWidget: () => void;
};
```

- Consumes: `NetWorthSnapshot` (Task 2); `NativeModules` from `react-native`. Native contract (Task 6): `WidgetBridge.writeSnapshot(json: string): Promise<void>` and `WidgetBridge.reloadWidget(): void`.

- [ ] **Step 1 (qa): Write the failing tests**

```ts
// src/widget/widget-bridge.test.ts
const mockWriteSnapshot = jest.fn(() => Promise.resolve());
const mockReloadWidget = jest.fn();

describe('widgetBridge', () => {
  afterEach(() => jest.resetModules());

  it('serializes the snapshot to JSON and calls the native writeSnapshot', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        WidgetBridge: { writeSnapshot: mockWriteSnapshot, reloadWidget: mockReloadWidget },
      },
    }));
    const { widgetBridge } = require('./widget-bridge');
    const snapshot = {
      baseCurrency: 'UAH', total: { formatted: '₴0.00', minorUnits: 0 },
      breakdown: [], trend: [], updatedAt: 1,
    };

    await widgetBridge.writeSnapshot(snapshot);

    expect(mockWriteSnapshot).toHaveBeenCalledWith(JSON.stringify(snapshot));
  });

  it('does not throw when the native module is absent', async () => {
    jest.doMock('react-native', () => ({ NativeModules: {} }));
    const { widgetBridge } = require('./widget-bridge');

    await expect(
      widgetBridge.writeSnapshot({
        baseCurrency: 'UAH', total: { formatted: '', minorUnits: 0 },
        breakdown: [], trend: [], updatedAt: 1,
      }),
    ).resolves.toBeUndefined();
    expect(() => widgetBridge.reloadWidget()).not.toThrow();
  });
});
```

- [ ] **Step 2 (qa): Run tests to verify they fail**

Run: `npx jest src/widget/widget-bridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3 (developer): Implement the wrapper**

```ts
// src/widget/widget-bridge.ts
import { NativeModules } from 'react-native';
import type { NetWorthSnapshot } from './net-worth-snapshot';

// The native module's contract. Optional on `NativeModules` so a build without
// the extension (or a Jest run) resolves to `undefined` and the wrapper no-ops
// rather than crashing the app.
type NativeWidgetBridge = {
  writeSnapshot: (json: string) => Promise<void>;
  reloadWidget: () => void;
};

const native = (NativeModules as { WidgetBridge?: NativeWidgetBridge }).WidgetBridge;

// The typed JS boundary to the widget. `writeSnapshot` serializes the snapshot
// (the native side stores the raw JSON in the App Group container); `reloadWidget`
// asks WidgetKit to reload all timelines. Both degrade to a no-op when the native
// module is unavailable.
export const widgetBridge = {
  writeSnapshot: async (snapshot: NetWorthSnapshot): Promise<void> => {
    if (native === undefined) {
      return;
    }

    await native.writeSnapshot(JSON.stringify(snapshot));
  },
  reloadWidget: (): void => {
    if (native === undefined) {
      return;
    }

    native.reloadWidget();
  },
};
```

- [ ] **Step 4 (qa): Run tests to verify they pass**

Run: `npx jest src/widget/widget-bridge.test.ts`
Expected: PASS.

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** Task 2.

---

## Task 4: App-side snapshot writer hook

A hook that runs the same live queries the home/statistics screens use, builds the snapshot (including the trend series), and writes + reloads — debounced, and also on app background.

**Files:**
- Create: `src/widget/use-net-worth-widget.ts`
- Test: `src/widget/use-net-worth-widget.test.ts`
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `useLiveQuery`; `accountsRepo`, `holdingsRepo`, `ratesRepo`, `settingsRepo`, `transactionsRepo`, `rateHistoryRepo`; `buildRateTable` (`src/rates/net-worth-view.ts`); `buildNetWorthSeries` (`src/statistics/net-worth-series.ts`); `buildNetWorthSnapshot` (Task 2); `widgetBridge` (Task 3); `AppState` from `react-native`.
- Produces: `export const useNetWorthWidget = (): void`.

Design notes for the implementer:
- Read the same rows the statistics screen reads for the trend: `transactionsRepo.listAllQuery()` (carries `holdingId`) grouped by holding into `SeriesTransaction[]` (mirror `groupByHolding` in `statistics.screen.tsx:95`), plus `rateHistoryRepo.historyRowsQuery()`.
- Build the trend with `buildNetWorthSeries({ holdings: active, txByHolding, historyRows, baseCurrency, range, liveRateTable: rateTable, today: now })` over a FIXED recent range for the mini line — use the last 30 days (`range: { from: now - 30 * DAY_IN_MS, to: now }`, `bucketDays: 1`). With no history rows yet it returns `{ points: [] }`, which the builder maps to an empty trend and the widget renders as "total only" — the required first-run behavior.
- Pass `series.points` as `trendPoints` to `buildNetWorthSnapshot`.
- Debounce the write: coalesce rapid live-query refreshes (e.g. a 500ms trailing debounce) before calling `widgetBridge.writeSnapshot` then `widgetBridge.reloadWidget`. Clear the timer on unmount.
- Also write immediately when `AppState` transitions to `background` (subscribe in an effect; remove the listener on cleanup).
- Keep the hook side-effect-only (`: void`); it renders nothing.

- [ ] **Step 1 (qa): Write the failing tests**

Use `@testing-library/react-native`'s `renderHook`, fake timers, and jest mocks for `useLiveQuery`, `../widget/widget-bridge`, and `react-native`'s `AppState`. Test:

```ts
// src/widget/use-net-worth-widget.test.ts
// Mock useLiveQuery to return fixed rows; mock widgetBridge to capture calls;
// mock AppState to capture the change listener.
const mockWriteSnapshot = jest.fn(() => Promise.resolve());
const mockReloadWidget = jest.fn();
jest.mock('./widget-bridge', () => ({
  widgetBridge: { writeSnapshot: mockWriteSnapshot, reloadWidget: mockReloadWidget },
}));
// ...mock useLiveQuery + repos so the hook has holdings/accounts/rates/settings/
// transactions/historyRows to build from...

describe('useNetWorthWidget', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('writes a snapshot and reloads the widget after the debounce window', () => {
    // renderHook(() => useNetWorthWidget());
    // jest.advanceTimersByTime(500);
    // expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
    // expect(mockReloadWidget).toHaveBeenCalledTimes(1);
  });

  it('writes the snapshot immediately when the app goes to background', () => {
    // capture the AppState listener; invoke it with 'background';
    // expect(mockWriteSnapshot).toHaveBeenCalled();
  });

  it('writes an empty-trend snapshot when there are no history rows (first run)', () => {
    // historyRows = []; advance timers; the written snapshot's trend is [].
    // Inspect JSON.parse(mockWriteSnapshot.mock.calls[0][0])... OR assert against
    // the snapshot object passed to widgetBridge.writeSnapshot (it receives the
    // NetWorthSnapshot object; serialization happens inside the bridge).
  });
});
```

Fill in the mock scaffolding following the existing `statistics.screen.test.tsx` / `transaction-form.screen.test.tsx` mock patterns (they mock `useLiveQuery` and repos the same way). Assert on the `NetWorthSnapshot` object handed to `widgetBridge.writeSnapshot`.

- [ ] **Step 2 (qa): Run tests to verify they fail**

Run: `npx jest src/widget/use-net-worth-widget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3 (developer): Implement the hook**

Implement `useNetWorthWidget` per the design notes above: live queries -> `activeHoldings` -> `buildRateTable` -> `buildNetWorthSeries` (30-day range) -> `buildNetWorthSnapshot` -> debounced `widgetBridge.writeSnapshot` + `reloadWidget`, plus an `AppState` `background` immediate write. Keep the debounce timer and the AppState subscription in effects with proper cleanup. Reuse the `groupByHolding` shape from the statistics screen (extract a tiny local helper; do not import the screen). Respect the cognitive-complexity cap — factor the snapshot assembly into a small pure local function if the effect grows.

- [ ] **Step 4 (developer): Mount the hook in `AppRoot`**

In `App.tsx`, call `useNetWorthWidget()` inside `AppRoot` (alongside `useAutoSync()`), and add the import. `AppRoot` renders only after migrations succeed, so the DB is ready when the hook's live queries run.

- [ ] **Step 5 (qa): Run tests to verify they pass**

Run: `npx jest src/widget/use-net-worth-widget.test.ts`
Expected: PASS.

- [ ] **Step 6 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green (knip flags from Tasks 2-3 now clear — the builder, snapshot type, and bridge are all consumed here).

**Dependencies:** Tasks 2 and 3.

---

## Task 5: JS harness gate for the completed TypeScript surface

A consolidation checkpoint: with the TS side (Tasks 1-4) complete, prove the whole JS surface is clean before the native work begins. No new code — a gate task.

- [ ] **Step 1 (ops): Full JS check**

Run: `npm run check:all`
Expected: green — no unused exports (knip), no unused/missing deps, lint/format clean.

- [ ] **Step 2 (qa): Full Jest run for the widget + touched modules**

Run: `npx jest src/widget src/rates/active-holdings.test.ts src/screens/home`
Expected: all pass.

**Dependencies:** Tasks 1-4. This is the clean handoff point to native (Tasks 6-7).

---

## Task 6: Native WidgetBridge module (ops)

Create the Swift native module that the TS wrapper (Task 3) calls. It writes the snapshot JSON into the App Group container and triggers a WidgetKit reload.

**Files (native):**
- Create: `ios/Kiko/WidgetBridge.swift`
- Create: `ios/Kiko/WidgetBridge.m` (or a `.mm`) — the `RCT_EXTERN_MODULE` / `RCT_EXTERN_METHOD` bridging macros exposing the Swift class to React Native.

**Native contract (must match Task 3 exactly):**
- Module name `WidgetBridge`.
- `writeSnapshot(json: String)` — a promise-returning method that writes `json` into the shared App Group container under a fixed key/filename (e.g. a `net-worth-snapshot.json` file in the `<APP_GROUP_ID>` container, or a `UserDefaults(suiteName: <APP_GROUP_ID>)` key). Resolve on success; reject on a write error.
- `reloadWidget()` — calls `WidgetCenter.shared.reloadAllTimelines()`.

- [ ] **Step 1 (ops): Choose and record the App Group id**

Pick `<APP_GROUP_ID>` as `group.<app-bundle-id>` (read the bundle id from the Xcode project). Record the chosen concrete value in this task's notes/PR description so every later step and the skill (Task 8) reference the same string.

- [ ] **Step 2 (ops): Add the App Group entitlement to the main app target**

In `ios/Kiko.xcodeproj`, enable the App Groups capability on the `Kiko` target and add `<APP_GROUP_ID>`. This creates/updates the target's `.entitlements`. Ensure signing/provisioning includes the App Group (a provisioning profile that carries the App Groups capability).

- [ ] **Step 3 (ops): Implement `WidgetBridge.swift` + the bridging macros**

Write the Swift class (an `NSObject` exported via `@objc(WidgetBridge)`), with `writeSnapshot` (promise) and `reloadWidget`, storing/reading via the `<APP_GROUP_ID>` container. Add the `.m`/`.mm` with `RCT_EXTERN_MODULE(WidgetBridge, NSObject)` and `RCT_EXTERN_METHOD` declarations matching the contract. Confirm it resolves under the app's New Architecture setup (RCT interop is fine for a simple bridge). Do not log the snapshot contents.

- [ ] **Step 4 (ops): Build the app to the device and verify the bridge resolves**

Build and install to the physical device (per the memory notes: `FORCE_BUNDLING=1`, then `devicectl install` to the device id, verify a NEW container UUID, then `devicectl launch`). Confirm the app launches and `NativeModules.WidgetBridge` is defined (a temporary log or a debugger check). No crash on writeSnapshot/reloadWidget.

**Dependencies:** Task 5 (clean JS surface). Task 3's wrapper already tolerates the module's earlier absence, so this can proceed independently once the App Group id is chosen.

---

## Task 7: KikoWidget extension target (ops)

Create the WidgetKit + SwiftUI extension that reads the snapshot and renders the Medium layout.

**Files (native):**
- Create: `ios/KikoWidget/` — the extension target: `KikoWidgetBundle.swift`, the `TimelineProvider`, the `TimelineEntry` carrying the decoded snapshot, the Medium SwiftUI view, `Info.plist`, and `KikoWidget.entitlements`.

- [ ] **Step 1 (ops): Add the `KikoWidget` app-extension target**

Add a Widget Extension target `KikoWidget` to `ios/Kiko.xcodeproj` (WidgetKit + SwiftUI, iOS deployment target matching the app). Declare support for the `systemMedium` family ONLY (no small/large/accessory).

- [ ] **Step 2 (ops): Add the App Group entitlement to the extension**

Enable App Groups on the `KikoWidget` target with the SAME `<APP_GROUP_ID>` as the app, and wire signing/provisioning for the extension (its own bundle id + a profile carrying the App Group).

- [ ] **Step 3 (ops): Implement snapshot decoding + the Medium view**

Define a `Codable` Swift struct mirroring the `NetWorthSnapshot` JSON shape (`baseCurrency`, `total { formatted, minorUnits }`, `breakdown [{ currency, minorUnits }]`, `trend [{ time, value }]`, `updatedAt`). The `TimelineProvider` reads the JSON from the `<APP_GROUP_ID>` container and decodes it. The Medium SwiftUI view renders: the "Net worth" label, `total.formatted`, the per-currency breakdown, and a mini trend line (Swift Charts or a `Path`). Error/edge handling per the spec:
  - No snapshot / unreadable / malformed JSON -> placeholder view ("Open Kiko").
  - Fewer than two trend points -> omit the line, show the total only.

- [ ] **Step 4 (ops): Build to device and verify live**

Build the app + extension, install to the device, add the Medium widget to the home screen, and confirm it renders the current net worth, breakdown, and trend. Trigger an app data change (add a transaction) and confirm the widget refreshes after the app writes + reloads (allowing for iOS's widget-refresh budget). Do NOT rely on the simulator for review — verify on device and let the user review live.

**Dependencies:** Task 6 (the bridge writes the snapshot the extension reads).

---

## Task 8: Author the kiko-widget architecture skill (scribe)

After the widget implementation has landed (Tasks 1-7), capture the durable, non-obvious widget architecture as a project skill so future work does not re-derive it or drift from it.

**Files:**
- Create: `.claude/skills/kiko-widget/SKILL.md`

**Sub-skill:** Use `superpowers:writing-skills`.

- [ ] **Step 1 (scribe): Write the skill following the prevent-skill-drift convention**

Author `.claude/skills/kiko-widget/SKILL.md`. Frontmatter `description` (the invoke-when): invoke when touching the widget, `src/widget/net-worth-snapshot.ts`, the App Group, or the `WidgetBridge` native module.

The skill body must cover these durable, non-obvious facts:
- The widget runs in a SEPARATE extension process and CANNOT query the op-sqlite DB live or run app JavaScript.
- Data reaches the widget ONLY through the App Group snapshot the app writes via `WidgetBridge`; the widget shows a snapshot, not live data, and freshness is bounded by iOS's widget-refresh budget.
- `src/widget/net-worth-snapshot.ts` (`buildNetWorthSnapshot`) is the SINGLE source of truth for the widget's numbers, shared with the home screen through the same underlying math — never recompute net worth in the widget path. The active-holding filter is shared via `src/rates/active-holdings.ts`.
- The write/reload trigger: the app-side hook `src/widget/use-net-worth-widget.ts` writes the snapshot (debounced + on background) through `src/widget/widget-bridge.ts`, which calls the native `writeSnapshot` then `reloadWidget` (`WidgetCenter.shared.reloadAllTimelines()`).
- The `KikoWidget` WidgetKit extension + the App Group entitlement required on BOTH the app and the extension targets; the App Group id form (`group.<bundle-id>`); Medium (`systemMedium`) family only.

Follow the prevent-skill-drift convention (from MEMORY): reference the source-of-truth FILES by path (schema, `net-worth-snapshot.ts`, `net-worth-view.ts`, `currency-totals.ts`, `active-holdings.ts`, `widget-bridge.ts`, `use-net-worth-widget.ts`, the Swift bridge/extension files, and the entitlements). Do NOT copy enumerable/driftable data (the snapshot field list, the currency enum, the App Group's concrete value, exact line numbers) into the skill prose — point to where each lives and instruct the reader to read it there. State the settled contract and the non-obvious "why", not a duplicated data dump.

- [ ] **Step 2 (scribe): Verify the skill against the shipped code**

Confirm every file path referenced in the skill exists and every stated fact matches the implementation as built (e.g. the bridge method names match `widget-bridge.ts` and the Swift contract; the shared-builder claim matches `net-worth-snapshot.ts`). Fix any reference that drifted from what actually shipped.

**Dependencies:** Tasks 1-7 (the skill documents what was actually built).

---

## Final verification

- [ ] **(ops): Full JS check**

Run: `npm run check:all`
Expected: green.

- [ ] **(ops): Deep check before declaring done**

Run: `npm run check:deep`
Expected: mutation score at/above threshold; osv-scanner reports only the known-accepted CVEs in the root `CLAUDE.md`.

- [ ] **(qa): Full Jest run**

Run: `npx jest`
Expected: all suites pass.

- [ ] **(ops): On-device widget verification**

Add the Medium widget to the device home screen; confirm it renders net worth, breakdown, and the trend line, and refreshes after an app data change. User reviews live (no simulator screenshots).

---

## Self-Review

- **Spec coverage:** Medium-only widget target (Task 7) ✓; separate-process, snapshot-via-App-Group architecture (Tasks 6-7) ✓; one TS snapshot builder reusing existing math, no drift (Tasks 1-2) ✓; App Group entitlement on both targets (Tasks 6-7) ✓; WidgetBridge `writeSnapshot`/`reloadWidget` native + typed wrapper (Tasks 3, 6) ✓; TimelineProvider/TimelineEntry/Medium SwiftUI view (Task 7) ✓; app-side recompute-on-change hook, debounced, write-on-background (Task 4) ✓; snapshot payload shape (Task 2) ✓; error handling — placeholder, guarded missing rate, <2 trend points, malformed snapshot (Tasks 2, 7) ✓; TS unit tests for the builder incl. matches guardedNetWorth, breakdown, active filter, first-run (Task 2) ✓; on-device verification, no simulator screenshots (Task 7) ✓; App Group id chosen by ops at implementation time (Global Constraints, Task 6) ✓; ops sequencing called out as its own steps (Tasks 6-7) ✓; recommendation to ship Exchange first (header) ✓; scribe widget-architecture skill after implementation (Task 8) ✓.
- **Out of scope honored:** no Small/Large/accessory families, no interactive controls, no AppIntent config UI.
- **Type consistency:** `NetWorthSnapshot` shape identical across Tasks 2, 3, 4, and the Swift `Codable` mirror (Task 7); `activeHoldings` signature consistent Tasks 1-2; the native contract (`writeSnapshot(json: string)`, `reloadWidget()`) identical across Tasks 3 and 6.
- **Native dependency sequencing:** JS tasks (1-5) precede native tasks (6-7); Task 3's wrapper tolerates the native module's earlier absence so the JS surface stays testable and shippable before the extension exists.
