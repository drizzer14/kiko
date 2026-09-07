# Security-pass fixes (S1–S10 + harness rules H1–H7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every actionable finding of the 2026-09-06 whole-app security audit of `e36213c`, and mechanize each mechanizable one as a harness rule so it cannot regress.

**Architecture:** Three groups of change, in the audit's own priority order. (1) The widget path — the app's confidentiality boundary currently stops at `LockGate` while the WidgetKit extension renders the same numbers unauthenticated from a plaintext, backed-up App Group file; the fix redacts the SwiftUI views, shrinks the snapshot to total+breakdown, clears it whenever the app lock is on, and hardens the file's at-rest attributes. (2) The `Info.plist` / pinning surface — a second secret-bearing host (`api.binance.com`) gets pinned, `NSAllowsLocalNetworking` stops shipping in Release, and the empty location purpose string goes. (3) Documentation and mechanization — the accepted-risk register is brought back in line with what actually ships, and seven harness rules (Semgrep Swift/TS, shell plist assertions, Jest) make each finding a failing check rather than a review comment.

**Tech Stack:** TypeScript / React Native 0.87.1, Swift + SwiftUI (WidgetKit extension), Jest + `@testing-library/react-native`, Semgrep 1.175 (`rules/semgrep-mobile.yml`), Biome, Knip, jscpd, `plutil` / `PlistBuddy`, Xcode 16 (`ios/Kiko.xcworkspace`, schemes `Kiko` and `KikoWidget`).

**Spec:** `docs/security/2026-09-06-security-pass-findings.md` (findings S1–S11, harness rule ideas H1–H7, register updates in §5, priority order in §6). Supporting: `docs/security/README.md`, `docs/superpowers/specs/2026-09-05-net-worth-widget-design.md`, `docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md`.

## Global Constraints

- **Never weaken a check to get green** (root `CLAUDE.md`). No `|| true` in a check script, no global auto-suppress. Every new ignore-list entry needs a concrete, verifiable justification recorded in `CLAUDE.md`'s "Documented exceptions".
- **No commits.** No agent commits anything in this plan. The user reviews the diff. Ignore any "Commit" step the writing-plans skill's template implies.
- **TDD.** Where a test is possible, write the failing test first, run it, watch it fail for the right reason, then implement. Native Swift has no test target in this repo — those tasks name an exact manual verification instead.
- **Code style** (`kiko-code-style`): single quotes, 2-space indent, 100-col, trailing commas, `(x) => x` always-parens; a blank line before every `return`/`if`/`for`/`while`/`switch` that is not the first line of its block; `import type` for type-only imports; named exports everywhere except React components (default); components use an explicit `return`.
- **Widget contract** (`kiko-widget`): `ios/KikoWidget/NetWorthSnapshot.swift` mirrors the TS `NetWorthSnapshot` field-for-field. Changing one side means changing the other in the same change. Never log the snapshot JSON. `buildNetWorthSnapshot` stays the single source of the widget's numbers — never a second net-worth computation.
- **Architecture** (`kiko-architecture`): every DB write goes through `db.transaction()` (no DB writes in this plan). Repositories return query builders for reads.
- **Domain** (`kiko-domain`): money is integer minor units; `settings` is a single row keyed at `id = 1`.
- **`.env` is public-only.** Secrets live in the iOS Keychain. Nothing in this plan adds a value to `.env`.
- **Semgrep rule fixtures** must not contaminate the repo-wide scan: every positive fixture lives under `rules/fixtures/`, which `scripts/checks/security.sh` excludes and `scripts/checks/semgrep-rules.sh` scans on purpose. A rule's `paths.include` entry must be a **basename** pattern (`"*.swift"`), never a path-prefixed one (`"ios/KikoWidget/*.swift"`) — Semgrep matches a pattern containing `/` against the path relative to the scan root, so a path-prefixed include silently matches nothing when the runner scans the fixtures directory. Verified both ways on Semgrep 1.175.
- **iOS deployment target is 15.1** (`IPHONEOS_DEPLOYMENT_TARGET`), Pods platform 16.0. `.privacySensitive()` is iOS 15.0+, so it needs no `#available` guard.
- Checkpoint after every task: `npm run check:all`. Before declaring done: `npm run check:deep`.

---

## Task 1: Privacy-redact the widget's money views (S2 part 1)

The `KikoWidget` extension renders `snapshot.total.formatted` at 48pt plus the whole per-currency breakdown with no privacy marking, so WidgetKit never redacts it on a locked device (Lock Screen Today View and StandBy both surface widgets while locked). Marking the money-bearing subviews `.privacySensitive()` makes WidgetKit replace them with redaction placeholders while the device is locked. The "Net worth" label stays legible so the widget is still identifiable.

**Files:**
- Modify: `ios/KikoWidget/NetWorthWidgetView.swift:46-101`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the exact SwiftUI shape Task 6's Semgrep rule `kiko-widget-money-view-needs-privacysensitive` is written against — every `Text(snapshot.…)` / `Text(item.…)` is inside a chain that ends in `.privacySensitive()`.

- [ ] **Step 1: Mark the total privacy-sensitive**

In `content(for:)`, append `.privacySensitive()` to the total's modifier chain (currently ending at `.minimumScaleFactor(0.5)`, line 59):

```swift
            Text(snapshot.total.formatted)
                .font(.system(size: 48, weight: .bold))
                .foregroundStyle(snapshot.total.minorUnits < 0 ? Self.negativeRed : .white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .privacySensitive()
```

Leave `Text("Net worth")` (lines 51-53) untouched — it carries no data.

- [ ] **Step 2: Mark each breakdown row privacy-sensitive**

In `breakdownColumn(_:)`, append `.privacySensitive()` to the row `HStack`, so both the currency code and the amount redact together:

```swift
    private func breakdownColumn(_ items: [NetWorthSnapshot.BreakdownItem]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(items) { item in
                HStack(spacing: 4) {
                    Text(item.currency)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(Self.textSecondary)
                    Spacer()
                    Text(item.formatted)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(item.minorUnits < 0 ? Self.negativeRed : .white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .privacySensitive()
            }
        }
        .frame(maxWidth: .infinity)
    }
```

Do NOT put `.privacySensitive()` on the outer `VStack` in `content(for:)` — that would redact the "Net worth" label too.

- [ ] **Step 3: Add the "why" comment**

Above `content(for:)`'s `VStack`, add:

```swift
        // Every money-bearing subview is `.privacySensitive()`: the widget process
        // renders from a file, with no access to `LockGate`, so WidgetKit's own
        // redaction is what keeps balances off a locked device's Lock Screen /
        // StandBy. The "Net worth" label stays visible so the widget is still
        // identifiable while redacted. See docs/security/README.md (S2).
```

- [ ] **Step 4 (ops): Verify it compiles**

Run:

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/security-pass-fixes/ios && \
xcodebuild -workspace Kiko.xcworkspace -scheme Kiko -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -quiet build
```

Expected: `BUILD SUCCEEDED`. `.privacySensitive()` needs no availability guard at deployment target 15.1.

- [ ] **Step 5 (ops): Named manual verification — lock-screen redaction (device)**

This has no unit test in this repo. Named verification, on the physical device:

1. Build and install to the device (`FORCE_BUNDLING=1` Release build, then `devicectl device install app` to the device id, confirm a NEW container UUID, then `devicectl device process launch`). See the `release-build-stale-jsbundle` memory note.
2. Open Kiko once so a snapshot exists (with the app lock OFF, so a snapshot is actually written — see Task 3).
3. Add the medium `Net Worth` widget to the Home Screen and to the Today View.
4. Lock the device. From the Lock Screen, swipe to Today View.
5. **Expected:** the "Net worth" label is legible; the total and every breakdown row render as WidgetKit redaction placeholders (grey rounded bars), not numbers.
6. Unlock the device. **Expected:** the numbers return.

Record the result (pass/fail plus what was seen) in the task notes.

- [ ] **Step 6: Checkpoint**

Run: `npm run check:all`
Expected: silent, exit 0.

---

## Task 2: Remove the dead trend from the widget snapshot (S2 part 3)

The widget has not rendered a trend line since the view was simplified, but the app still computes a 30-day net-worth series on every snapshot write, serialises it into the App Group file, and the extension still decodes it. That is a wealth *history* written in cleartext to a backed-up container for no reader — it widens S2 and S3 for zero benefit. Delete it end to end. The per-currency breakdown stays (the widget renders it).

**Files:**
- Modify: `src/widget/net-worth-snapshot.ts:1-46`
- Modify: `src/widget/net-worth-snapshot.test.ts:29-138`
- Modify: `src/widget/use-net-worth-widget.ts:1-143`
- Modify: `src/widget/use-net-worth-widget.test.ts:14-153`
- Modify: `ios/KikoWidget/NetWorthSnapshot.swift:30-41`
- Modify: `ios/KikoWidget/NetWorthWidget.swift:26-51`
- Modify: `docs/superpowers/specs/2026-09-05-net-worth-widget-design.md:7-14`

**Interfaces:**
- Produces: `NetWorthSnapshot` = `{ baseCurrency, total: { formatted, minorUnits }, breakdown: { currency, minorUnits, formatted }[], updatedAt }` — no `trend`. `buildNetWorthSnapshot(input: { holdings, accounts, rateTable, baseCurrency, now })` — no `trendPoints`. Task 3 builds on this exact signature.

- [ ] **Step 1: Write the failing tests first**

In `src/widget/net-worth-snapshot.test.ts`:
- Delete the whole `it('maps trend points from { t, amount } to { time, value }', ...)` case (lines 105-122).
- Delete `trendPoints: []` from the four remaining `buildNetWorthSnapshot({ ... })` calls.
- In the last case, drop the `expect(snapshot.trend).toEqual([]);` line and rename it:

```ts
  it('handles the empty / first-run case (no holdings)', () => {
    const snapshot = buildNetWorthSnapshot({
      holdings: [],
      accounts: [],
      rateTable: {},
      baseCurrency: 'UAH',
      now,
    });

    expect(snapshot.total.minorUnits).toBe(0);
    expect(snapshot.breakdown).toEqual([]);
    expect(snapshot.updatedAt).toBe(now);
  });
```

- Add one case that pins the removal, so a future re-add fails:

```ts
  it('does not carry a trend series — the widget renders only the total and the breakdown', () => {
    const snapshot = buildNetWorthSnapshot({
      holdings: [holding({ id: 'h1', currency: 'USD', balanceMinorUnits: 10_000 })],
      accounts,
      rateTable,
      baseCurrency: 'UAH',
      now,
    });

    expect(Object.keys(snapshot).sort()).toEqual([
      'baseCurrency',
      'breakdown',
      'total',
      'updatedAt',
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/widget/net-worth-snapshot.test.ts`
Expected: FAIL — TypeScript/runtime errors on the missing `trendPoints` property, and the key-set assertion fails because `trend` is still present.

- [ ] **Step 3: Strip the trend from the TS builder**

`src/widget/net-worth-snapshot.ts` becomes:

```ts
import type { Currency } from '../currency/currency';
import { formatMoney } from '../currency/format';
import type { AccountRow, HoldingRow } from '../db/schema';
import { activeLocale } from '../i18n/active-locale';
import { activeHoldings } from '../rates/active-holdings';
import type { RateTable } from '../rates/conversion';
import { sumByCurrency } from '../rates/currency-totals';
import { guardedNetWorth } from '../rates/net-worth-view';

// The snapshot the app writes to the App Group container for the widget to read.
// Its numbers come from the SAME net-worth math the home screen uses (never a
// second computation) so the widget can never disagree with the app.
//
// SECURITY: this file is cleartext JSON in a shared container. It carries the
// MINIMUM the widget actually renders — the formatted total and the per-currency
// breakdown — and nothing else. A 30-day trend series used to be written here
// for a chart the widget no longer draws; it was removed because a wealth
// history on disk widened the exposure for no reader. Do not add a field the
// SwiftUI view does not render. See docs/security/README.md.
export type NetWorthSnapshot = {
  baseCurrency: Currency;
  total: { formatted: string; minorUnits: number };
  breakdown: { currency: Currency; minorUnits: number; formatted: string }[];
  updatedAt: number;
};

export const buildNetWorthSnapshot = (input: {
  holdings: readonly HoldingRow[];
  accounts: readonly Pick<AccountRow, 'id' | 'archivedAt'>[];
  rateTable: RateTable;
  baseCurrency: Currency;
  now: number;
}): NetWorthSnapshot => {
  const active = activeHoldings(input.holdings, input.accounts);
  const total = guardedNetWorth(active, input.baseCurrency, input.rateTable, input.now);
  const breakdown = sumByCurrency(active, input.now).map((money) => ({
    currency: money.currency,
    minorUnits: money.minorUnits,
    formatted: formatMoney(money, activeLocale()),
  }));

  return {
    baseCurrency: input.baseCurrency,
    total: { formatted: formatMoney(total, activeLocale()), minorUnits: total.minorUnits },
    breakdown,
    updatedAt: input.now,
  };
};
```

- [ ] **Step 4: Run the builder tests to verify they pass**

Run: `npx jest src/widget/net-worth-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the writer hook's tests first**

In `src/widget/use-net-worth-widget.test.ts`:
- Delete the `jest.mock('../repositories/transactions.repo', ...)` and `jest.mock('../repositories/rate-history.repo', ...)` blocks (lines 31-36).
- Delete `transactions` and `history` from the `LiveData` type and from `setLiveData`'s `byTable` map.
- Delete the whole `it('writes an empty trend when there are no history rows yet (first run)', ...)` case (lines 116-126).

- [ ] **Step 6: Run to verify failure**

Run: `npx jest src/widget/use-net-worth-widget.test.ts`
Expected: FAIL — the hook still calls `transactionsRepo.listAllQuery()` / `rateHistoryRepo.historyRowsQuery()`, which are no longer mocked, so the real repository modules load and blow up on the DB client.

- [ ] **Step 7: Strip the trend from the writer hook**

`src/widget/use-net-worth-widget.ts` becomes (the `assembleSnapshot` indirection is inlined — with the series gone it was a one-call wrapper):

```ts
import { useCallback, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { Currency } from '../currency/currency';
import { useLiveQuery } from '../db/use-live-query';
import { buildRateTable } from '../rates/net-worth-view';
import { accountsRepo } from '../repositories/accounts.repo';
import { holdingsRepo } from '../repositories/holdings.repo';
import { ratesRepo } from '../repositories/rates.repo';
import { settingsRepo } from '../repositories/settings.repo';

import { buildNetWorthSnapshot } from './net-worth-snapshot';
import { widgetBridge } from './widget-bridge';

// Coalesces rapid live-query refreshes (e.g. several rows touched by one sync)
// into a single write instead of one per row change.
const DEBOUNCE_MS = 500;

/**
 * Keeps the home-screen widget's snapshot fresh. Runs the same live queries the
 * home screen reads (holdings, accounts, rates, settings), builds a
 * `NetWorthSnapshot` through the app's own net-worth math, and writes it through
 * `widgetBridge` — debounced, so a burst of underlying writes settles into one
 * snapshot write, and also immediately whenever the app backgrounds, so the
 * widget is current the moment the user leaves. Side-effect only; renders
 * nothing.
 */
export const useNetWorthWidget = (): void => {
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';

  const writeNow = useCallback(async (): Promise<void> => {
    const snapshot = buildNetWorthSnapshot({
      holdings,
      accounts,
      rateTable: buildRateTable(rates),
      baseCurrency,
      now: Date.now(),
    });

    await widgetBridge.writeSnapshot(snapshot);
    widgetBridge.reloadWidget();
  }, [accounts, holdings, rates, baseCurrency]);

  useEffect(() => {
    const timer = setTimeout(() => {
      writeNow().catch(() => {});
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [writeNow]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'background') {
        return;
      }

      writeNow().catch(() => {});
    });

    return () => {
      subscription.remove();
    };
  }, [writeNow]);
};
```

Deleted with it: the `DAY_MS` / `AccountRow` / `HoldingRow` / `CurrencyRateHistoryRow` / `activeHoldings` / `rateHistoryRepo` / `transactionsRepo` / `SeriesTransaction` / `buildNetWorthSeries` imports, `TREND_WINDOW_DAYS`, the `LedgerTransaction` type, `groupByHolding`, and `assembleSnapshot`.

- [ ] **Step 8: Run the hook tests to verify they pass**

Run: `npx jest src/widget/`
Expected: PASS.

- [ ] **Step 9: Strip the trend from the Swift mirror**

`ios/KikoWidget/NetWorthSnapshot.swift`: delete `struct TrendPoint` (lines 30-35) and the `let trend: [TrendPoint]` property (line 40). The struct becomes:

```swift
struct NetWorthSnapshot: Codable {
    struct Total: Codable {
        let formatted: String
        let minorUnits: Int
    }

    struct BreakdownItem: Codable, Identifiable {
        let currency: String
        let minorUnits: Int
        let formatted: String

        // Not part of the wire format; lets SwiftUI iterate without index math.
        var id: String { currency }
    }

    let baseCurrency: String
    let total: Total
    let breakdown: [BreakdownItem]
    let updatedAt: Int
}
```

`ios/KikoWidget/NetWorthWidget.swift`: delete the `trend:` argument from `previewSnapshot` (lines 45-49), and drop the stale "(e.g. the trend line's relative recency)" clause from the `getTimeline` doc comment (line 28) — it now reads `…a safety net for time passing rather than the primary update path.`

- [ ] **Step 10: Note the removal in the widget spec**

Insert directly under the `## Overview` paragraph of `docs/superpowers/specs/2026-09-05-net-worth-widget-design.md` (after line 13):

```markdown
> **Superseded (2026-09-06):** the mini trend line was dropped from the
> shipped widget. The SwiftUI view renders the label, the total, and the
> per-currency breakdown only, and the App Group snapshot carries no trend
> series — a wealth history in cleartext in a backed-up shared container
> was exposure with no reader (security finding S2). Every "trend" mention
> below is historical; see `docs/security/README.md`.
```

Do not rewrite the rest of the spec.

- [ ] **Step 11 (ops): Verify the extension still compiles**

Run:

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/security-pass-fixes/ios && \
xcodebuild -workspace Kiko.xcworkspace -scheme Kiko -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -quiet build
```

Expected: `BUILD SUCCEEDED` (this scheme builds the embedded `KikoWidget` extension too).

- [ ] **Step 12: Checkpoint — Knip must stay green**

Run: `npm run check:all` then `npx jest`
Expected: both silent/green. In particular `check:knip` must pass: `buildNetWorthSeries`, `NetWorthPoint`, `SeriesTransaction`, `DAY_MS`, `rateHistoryRepo.historyRowsQuery`, and `transactionsRepo.listAllQuery` all keep their other consumer (`src/screens/statistics/statistics.screen.tsx`, `src/design-system/components/net-worth-line/`, `src/statistics/buckets.ts`), so nothing loses its last consumer. If Knip does flag an export, delete it — do not add it to an ignore list.

---

## Task 3: Lock-aware snapshot lifecycle (S2 part 2)

Redaction is one control; it must not be the only one. When `settings.lockEnabled` is on, the app must not leave a real snapshot on disk at all. `useNetWorthWidget` is mounted inside `AppRoot`, which is inside `LockGate`, so it only runs post-unlock — which is exactly where the decision belongs: on every write opportunity (debounce tick and background transition) it either writes the snapshot (lock off) or clears it (lock on). Turning the lock off rewrites it on the next tick.

**Files:**
- Modify: `ios/Kiko/WidgetBridge.swift:26-60`
- Modify: `ios/Kiko/WidgetBridge.m:6-14`
- Modify: `src/widget/widget-bridge.ts:8-34`
- Modify: `src/widget/widget-bridge.test.ts`
- Modify: `src/widget/use-net-worth-widget.ts`
- Modify: `src/widget/use-net-worth-widget.test.ts`
- Modify: `ios/KikoWidget/NetWorthWidgetView.swift:32-44`

**Interfaces:**
- Consumes: `buildNetWorthSnapshot({ holdings, accounts, rateTable, baseCurrency, now })` from Task 2.
- Produces: `widgetBridge.clearSnapshot(): Promise<void>` and the native `WidgetBridge.clearSnapshot(resolver:rejecter:)`. Task 4 hardens the file attributes on both the write and the clear path.

- [ ] **Step 1: Write the failing JS-bridge test first**

Append to `src/widget/widget-bridge.test.ts`, inside the `describe`:

```ts
  it('calls the native clearSnapshot', async () => {
    const mockClearSnapshot = jest.fn(() => Promise.resolve());
    jest.doMock('react-native', () => ({
      NativeModules: {
        WidgetBridge: {
          writeSnapshot: mockWriteSnapshot,
          clearSnapshot: mockClearSnapshot,
          reloadWidget: mockReloadWidget,
        },
      },
    }));
    const { widgetBridge } = require('./widget-bridge');

    await widgetBridge.clearSnapshot();

    expect(mockClearSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not throw on clearSnapshot when the native module is absent', async () => {
    jest.doMock('react-native', () => ({ NativeModules: {} }));
    const { widgetBridge } = require('./widget-bridge');

    await expect(widgetBridge.clearSnapshot()).resolves.toBeUndefined();
  });
```

- [ ] **Step 2: Write the failing hook tests**

In `src/widget/use-net-worth-widget.test.ts`, add a clear mock to the bridge mock:

```ts
const mockWriteSnapshot = jest.fn(() => Promise.resolve());
const mockClearSnapshot = jest.fn(() => Promise.resolve());
const mockReloadWidget = jest.fn();

jest.mock('./widget-bridge', () => ({
  widgetBridge: {
    writeSnapshot: (...args: unknown[]) => mockWriteSnapshot(...args),
    clearSnapshot: (...args: unknown[]) => mockClearSnapshot(...args),
    reloadWidget: (...args: unknown[]) => mockReloadWidget(...args),
  },
}));
```

and add three cases:

```ts
  it('clears the snapshot instead of writing it while the app lock is enabled', async () => {
    setLiveData({
      accounts: [ACCOUNT],
      holdings: [HOLDING],
      rates: [RATE],
      settings: [{ baseCurrency: 'UAH', lockEnabled: true }],
    });
    await renderHook(() => useNetWorthWidget());

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    expect(mockClearSnapshot).toHaveBeenCalledTimes(1);
    expect(mockWriteSnapshot).not.toHaveBeenCalled();
    expect(mockReloadWidget).toHaveBeenCalledTimes(1);
  });

  it('clears the snapshot immediately on background while the app lock is enabled', async () => {
    setLiveData({
      accounts: [ACCOUNT],
      holdings: [HOLDING],
      rates: [RATE],
      settings: [{ baseCurrency: 'UAH', lockEnabled: true }],
    });
    await renderHook(() => useNetWorthWidget());

    await act(async () => {
      for (const listener of appStateListeners) {
        listener('background');
      }
      await Promise.resolve();
    });

    expect(mockClearSnapshot).toHaveBeenCalledTimes(1);
    expect(mockWriteSnapshot).not.toHaveBeenCalled();
  });

  it('writes the snapshot again once the app lock is disabled', async () => {
    setLiveData({
      accounts: [ACCOUNT],
      holdings: [HOLDING],
      rates: [RATE],
      settings: [{ baseCurrency: 'UAH', lockEnabled: false }],
    });
    await renderHook(() => useNetWorthWidget());

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
    expect(mockClearSnapshot).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run to verify both suites fail**

Run: `npx jest src/widget/`
Expected: FAIL — `widgetBridge.clearSnapshot is not a function`, and the lock-enabled cases still call `writeSnapshot`.

- [ ] **Step 4: Add `clearSnapshot` to the TS bridge**

`src/widget/widget-bridge.ts`:

```ts
type NativeWidgetBridge = {
  writeSnapshot: (json: string) => Promise<void>;
  clearSnapshot: () => Promise<void>;
  reloadWidget: () => void;
};
```

and, between `writeSnapshot` and `reloadWidget` on the exported object:

```ts
  // Removes the App Group snapshot entirely. Called when the app lock is on, so
  // a locked device has no real balance data in the shared container at all —
  // WidgetKit's `.privacySensitive()` redaction is then defence in depth rather
  // than the only control. The widget falls back to its placeholder.
  clearSnapshot: async (): Promise<void> => {
    if (native === undefined) {
      return;
    }

    await native.clearSnapshot();
  },
```

- [ ] **Step 5: Add `clearSnapshot` to the native module**

`ios/Kiko/WidgetBridge.swift` — add after `writeSnapshot`:

```swift
  /// Deletes the snapshot from the shared App Group container. Called by the JS
  /// writer whenever `settings.lockEnabled` is on, so an unlocked-app-only
  /// confidentiality boundary is not silently bypassed by a file the widget
  /// process can read without authentication. Resolves with `nil` when the file
  /// is gone — including when it was never there.
  @objc func clearSnapshot(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard
      let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: Self.appGroupID
      )
    else {
      reject("clear_error", "App Group container is unavailable", nil)
      return
    }

    let fileURL = containerURL.appendingPathComponent(Self.snapshotFileName)

    guard FileManager.default.fileExists(atPath: fileURL.path) else {
      resolve(nil)
      return
    }

    do {
      try FileManager.default.removeItem(at: fileURL)
      resolve(nil)
    } catch {
      reject("clear_error", "Failed to clear the widget snapshot", error)
    }
  }
```

`ios/Kiko/WidgetBridge.m` — add the bridging macro between the two existing ones:

```objc
RCT_EXTERN_METHOD(clearSnapshot:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
```

- [ ] **Step 6: Make the writer hook lock-aware**

In `src/widget/use-net-worth-widget.ts`, add the import:

```ts
import { APP_LOCK_ENABLED } from '../db/db-config';
```

derive the flag next to `baseCurrency` (folding in the compile-time master switch exactly as `src/auth/use-app-lock.ts:39` does, so the two never disagree):

```ts
  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  // Mirrors `useAppLock`'s own derivation (src/auth/use-app-lock.ts): the lock is
  // only real when the compile-time master switch is on AND the user enabled it.
  const lockEnabled = APP_LOCK_ENABLED && (settingsRows.at(0)?.lockEnabled ?? false);
```

and branch in `writeNow`:

```ts
  const writeNow = useCallback(async (): Promise<void> => {
    // The widget process has no lock gate. While the app lock is on, leave no
    // real snapshot on disk at all — the widget renders its placeholder instead.
    // Turning the lock off rewrites the snapshot on the next tick.
    if (lockEnabled) {
      await widgetBridge.clearSnapshot();
      widgetBridge.reloadWidget();

      return;
    }

    const snapshot = buildNetWorthSnapshot({
      holdings,
      accounts,
      rateTable: buildRateTable(rates),
      baseCurrency,
      now: Date.now(),
    });

    await widgetBridge.writeSnapshot(snapshot);
    widgetBridge.reloadWidget();
  }, [accounts, holdings, rates, baseCurrency, lockEnabled]);
```

- [ ] **Step 7: Give the placeholder its locked hint**

`ios/KikoWidget/NetWorthWidgetView.swift`, in `placeholder` — replace the caption (line 39) so it reads correctly for both "no snapshot yet" and "cleared because the app lock is on":

```swift
    private var placeholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "wallet.pass")
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
            Text("Open Kiko")
                .font(.headline)
            // Covers both placeholder cases: no snapshot has been written yet, and
            // the app deliberately cleared it because the app lock is enabled (the
            // widget process cannot tell the two apart, and must not).
            Text("Unlock Kiko to see your net worth")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx jest src/widget/`
Expected: PASS, all cases including the pre-existing ones.

- [ ] **Step 9 (ops): Named manual verification — placeholder on a locked-enabled build**

1. Build to the simulator: `xcodebuild -workspace ios/Kiko.xcworkspace -scheme Kiko -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 16' -quiet build` then run it.
2. In Settings, turn the app lock ON. Background the app.
3. **Expected:** the widget switches to the placeholder ("Open Kiko" / "Unlock Kiko to see your net worth").
4. Foreground, unlock, turn the app lock OFF, background again.
5. **Expected:** the widget shows the total and breakdown again within a refresh.
6. Optional but preferred: confirm the file is actually gone in step 3, e.g. `find ~/Library/Developer/CoreSimulator/Devices -name net-worth-snapshot.json` returns nothing while the lock is on.

Record the result in the task notes.

- [ ] **Step 10: Checkpoint**

Run: `npm run check:all` then `npx jest`
Expected: green.

---

## Task 4: Backup-exclude and file-protect the App Group snapshot (S3)

`WidgetBridge.swift` writes the cleartext JSON with no `isExcludedFromBackup` and no explicit protection class, so the derived balance data lands in iCloud/iTunes backups — the exact leak `AppDelegate.excludeDatabaseFilesFromBackup` was written to prevent for the database. An atomic write replaces the inode, so both attributes must be re-applied after *every* write. `NSFileProtectionComplete` is not usable (the widget must read the file while the device is locked), so `completeUntilFirstUserAuthentication` is set deliberately rather than inherited.

**Files:**
- Modify: `ios/Kiko/WidgetBridge.swift:26-52` (and the `clearSnapshot` added in Task 3)

**Interfaces:**
- Consumes: `clearSnapshot` from Task 3.
- Produces: the exact Swift shape Task 6's `kiko-appgroup-write-needs-protection` rule is written against — the file that touches `containerURL(forSecurityApplicationGroupIdentifier:)` and calls `.write(to:)` also contains `isExcludedFromBackup` and `protectionKey`.

- [ ] **Step 1: Add the protected-write helper**

In `ios/Kiko/WidgetBridge.swift`, add above `writeSnapshot`:

```swift
  /// Writes `json` to `fileURL` and re-applies the two at-rest protections the
  /// snapshot needs. Both MUST be re-applied after every write: `atomically: true`
  /// writes to a temporary file and renames it, so the new inode inherits
  /// neither the extended attribute nor the protection class from the old one
  /// (the same reason `AppDelegate.excludeDatabaseFilesFromBackup` re-runs on
  /// every background).
  ///
  /// - `isExcludedFromBackup`: this file is a cleartext derivative of the
  ///   SQLCipher-encrypted balances. Without this it enters iCloud/iTunes
  ///   backups in plain JSON, re-opening the leak F2 closed for the database.
  /// - `.completeUntilFirstUserAuthentication`: chosen deliberately, not
  ///   inherited. `.complete` would be stronger but makes the file unreadable
  ///   while the device is locked, which is precisely when WidgetKit renders
  ///   the widget.
  private static func writeProtected(_ json: String, to fileURL: URL) throws {
    try json.write(to: fileURL, atomically: true, encoding: .utf8)

    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: fileURL.path
    )

    var mutableURL = fileURL
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try mutableURL.setResourceValues(values)
  }
```

- [ ] **Step 2: Route `writeSnapshot` through it**

Replace the `do` block body in `writeSnapshot` (line 47):

```swift
    do {
      try Self.writeProtected(json, to: fileURL)
      resolve(nil)
    } catch {
      reject("write_error", "Failed to write the widget snapshot", error)
    }
```

Nothing else in `writeSnapshot` changes; it still never logs `json`.

- [ ] **Step 3 (ops): Verify it compiles**

Run:

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/security-pass-fixes/ios && \
xcodebuild -workspace Kiko.xcworkspace -scheme Kiko -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -quiet build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 4 (ops): Named manual verification — attributes actually applied (simulator)**

1. Run the app on the simulator with the app lock OFF so a snapshot is written.
2. Locate the file: `find ~/Library/Developer/CoreSimulator/Devices -name net-worth-snapshot.json`
3. Confirm the backup-exclusion extended attribute is present: `xattr -l "<path>"` → expect `com.apple.metadata:com_apple_backup_excludeItem`.
4. **Note:** the simulator does not enforce data protection classes, so step 3 is the only attribute observable there; `.protectionKey` is verified by the code path and by the Task 6 rule, not by a simulator read.

Record the result in the task notes.

- [ ] **Step 5: Checkpoint**

Run: `npm run check:all`
Expected: green.

---

## Task 5: Semgrep rule H1 — a money view in the widget must be privacy-sensitive

Mechanizes S2 so a future widget family cannot ship an unredacted balance. Verified against Semgrep 1.175: `pattern-not-inside: $E.privacySensitive()` correctly excludes both a per-`Text` modifier chain and a row-level `HStack { … }.privacySensitive()`.

This task also builds the **fixture harness** every later Semgrep rule reuses, because H1 is the first rule that needs it.

**Files:**
- Create: `rules/fixtures/kiko-widget-money-view-needs-privacysensitive.bad.swift`
- Create: `rules/fixtures/kiko-widget-money-view-needs-privacysensitive.good.swift`
- Create: `scripts/checks/semgrep-rules.sh`
- Modify: `rules/semgrep-mobile.yml` (new rule, in the Class A section)
- Modify: `scripts/checks/security.sh:20-23,59-62,74-77` (exclude the fixtures from the repo-wide scan)
- Modify: `scripts/checks/medium.sh:28-30`
- Modify: `package.json` (`check:rules` script; add it to `check:all`)
- Modify: `biome.json` (`files.includes`)
- Modify: `knip.json` (`ignore`)
- Modify: `.jscpd.json` (`ignore`)
- Modify: `CLAUDE.md` (checks table, `check:all` list, documented exceptions)
- Modify: `docs/harness/review-to-biome-inventory.md`

**Interfaces:**
- Produces: the fixture naming contract `rules/fixtures/<rule-id>.bad.<ext>` / `<rule-id>.good.<ext>`, and `npm run check:rules`. Tasks 6 and 13 add fixture pairs under the same contract with no further config change.

- [ ] **Step 1: Write the failing fixtures first**

`rules/fixtures/kiko-widget-money-view-needs-privacysensitive.bad.swift`:

```swift
// Semgrep fixture (POSITIVE): every money-bearing Text here is missing
// `.privacySensitive()`, so `kiko-widget-money-view-needs-privacysensitive`
// MUST report a finding on each. Never "fix" this file.
import SwiftUI

struct FixtureBadWidgetView: View {
    let snapshot: NetWorthSnapshot

    var body: some View {
        VStack(spacing: 4) {
            Text("Net worth")
                .font(.system(size: 13))

            Text(snapshot.total.formatted)
                .font(.system(size: 48, weight: .bold))

            ForEach(snapshot.breakdown) { item in
                HStack(spacing: 4) {
                    Text(item.currency)
                    Spacer()
                    Text(item.formatted)
                }
            }
        }
    }
}
```

`rules/fixtures/kiko-widget-money-view-needs-privacysensitive.good.swift`:

```swift
// Semgrep fixture (NEGATIVE): the same views, correctly redacted — the total
// carries its own `.privacySensitive()`, the breakdown row carries one for the
// whole row. `kiko-widget-money-view-needs-privacysensitive` MUST report
// nothing here. The bare "Net worth" label stays visible on purpose.
import SwiftUI

struct FixtureGoodWidgetView: View {
    let snapshot: NetWorthSnapshot

    var body: some View {
        VStack(spacing: 4) {
            Text("Net worth")
                .font(.system(size: 13))

            Text(snapshot.total.formatted)
                .font(.system(size: 48, weight: .bold))
                .privacySensitive()

            ForEach(snapshot.breakdown) { item in
                HStack(spacing: 4) {
                    Text(item.currency)
                    Spacer()
                    Text(item.formatted)
                }
                .privacySensitive()
            }
        }
    }
}
```

Neither fixture may contain `forSecurityApplicationGroupIdentifier` or `.write(to:` — Task 6's rule also scans `*.swift` under `rules/fixtures/`, and the two rules must not cross-fire.

- [ ] **Step 2: Write the fixture runner**

`scripts/checks/semgrep-rules.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
FIXTURES="$ROOT/rules/fixtures"

# Proves the project's own Semgrep rules still fire (and still stay quiet) on a
# fixture pair per rule. A rule that silently stops matching is worse than no
# rule: it reads as a passing check. Naming contract, enforced below:
#   rules/fixtures/<rule-id>.bad.<ext>   -> that rule MUST report >= 1 finding
#   rules/fixtures/<rule-id>.good.<ext>  -> NO rule may report anything
# `security.sh` excludes this directory from the repo-wide scan, so the positive
# fixtures never fail the real security check.

if ! command -v semgrep >/dev/null 2>&1; then
  print_block \
    "Semgrep rule fixtures" \
    "The semgrep tool is not installed." \
    "'semgrep' was not found on PATH." \
    "Without semgrep the project's own rules cannot be proven to still work, and a missing tool must not look like a pass." \
    "Run: brew install semgrep   then re-run: npm run check:rules" \
    "Do not treat a missing scanner as a pass. Install semgrep, then re-run."
  exit 2
fi

out="$(semgrep --quiet --json --config "$ROOT/rules/semgrep-mobile.yml" "$FIXTURES" 2>&1)"

report="$(printf '%s' "$out" | FIXTURES="$FIXTURES" node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const fs=require("fs"), path=require("path");
  const dir=process.env.FIXTURES;
  let j; try { j=JSON.parse(s); } catch { process.stdout.write("Semgrep did not return JSON:\n"+s); return; }
  const results=j.results||[];
  const files=fs.readdirSync(dir);
  const problems=[];
  for (const f of files) {
    const m=/^(.+)\.(bad|good)\.[^.]+$/.exec(f);
    if(!m) { problems.push(`fixture "${f}" does not follow <rule-id>.(bad|good).<ext>`); continue; }
    const [,ruleId,kind]=m;
    const hits=results.filter(r=>path.basename(r.path)===f);
    if(kind==="bad" && !hits.some(r=>r.check_id.endsWith(ruleId)))
      problems.push(`rule "${ruleId}" reported NOTHING on its positive fixture ${f}`);
    if(kind==="good" && hits.length)
      problems.push(`negative fixture ${f} matched: ${hits.map(r=>r.check_id).join(", ")}`);
  }
  const ids=new Set(files.map(f=>(/^(.+)\.(bad|good)\./.exec(f)||[])[1]).filter(Boolean));
  for (const id of ids) {
    if(!files.some(f=>f.startsWith(id+".bad."))) problems.push(`rule "${id}" has no positive fixture`);
    if(!files.some(f=>f.startsWith(id+".good."))) problems.push(`rule "${id}" has no negative fixture`);
  }
  process.stdout.write(problems.join("\n"));
})')"

if [ -n "$report" ]; then
  print_block \
    "Semgrep rule fixtures" \
    "A project Semgrep rule no longer behaves as specified against its fixtures." \
    "$report" \
    "A rule that stopped matching still reports success, so the finding it was written for silently comes back. The fixture pair is the rule's own test." \
    "Fix the rule in rules/semgrep-mobile.yml until its positive fixture matches and its negative fixture does not. Re-run: npm run check:rules" \
    "Do not delete or edit a fixture to make the check pass, and do not add nosemgrep. Fix the rule."
  exit 2
fi

exit 0
```

- [ ] **Step 3: Run the runner to verify it fails**

Run: `bash scripts/checks/semgrep-rules.sh`
Expected: exit 2, structured block reporting `rule "kiko-widget-money-view-needs-privacysensitive" reported NOTHING on its positive fixture` — the rule does not exist yet.

- [ ] **Step 4: Add the rule**

Append to the Class A section of `rules/semgrep-mobile.yml` (after `kiko-secret-in-db-or-log`, before the `---- Class A: code-style conventions ----` comment):

```yaml
  # `paths.include` is a bare `*.swift` on purpose, NOT `ios/KikoWidget/*.swift`.
  # Semgrep matches an include pattern containing a `/` against the path relative
  # to the SCAN ROOT, so a path-prefixed include silently matches nothing the
  # moment the fixture runner scans `rules/fixtures/` directly — a rule that
  # matches nothing still reports success, which is the exact failure mode this
  # whole fixture harness exists to prevent. A basename pattern matches under
  # every scan root (verified both ways on Semgrep 1.175). The scope loss is
  # nil: the pattern requires `Text(snapshot.…)` / `Text(item.…)`, and SwiftUI
  # `Text` exists only in the widget extension — the main app is React Native.
  - id: kiko-widget-money-view-needs-privacysensitive
    languages: [swift]
    severity: ERROR
    message: >
      A widget view bound to snapshot money must be marked `.privacySensitive()`
      so WidgetKit redacts it on a locked device. The widget extension has no
      LockGate; without this the app lock is silently bypassed on the Lock
      Screen / StandBy. Put the modifier on the Text, or on the row that
      contains it.
    paths:
      include:
        - "*.swift"
    patterns:
      - pattern: Text($X)
      - metavariable-regex:
          metavariable: $X
          regex: ^(snapshot|item)\.
      - pattern-not-inside: $E.privacySensitive()
```

- [ ] **Step 5: Run the runner to verify it passes**

Run: `bash scripts/checks/semgrep-rules.sh`
Expected: silent, exit 0.

Also confirm the rule sees the real code as clean (Task 1 already fixed it):

```bash
semgrep --quiet --config rules/semgrep-mobile.yml ios/KikoWidget
```
Expected: no findings.

- [ ] **Step 6: Exclude the fixtures from the repo-wide security scan**

In `scripts/checks/security.sh`, add `--exclude 'fixtures'` to **all three** semgrep invocations (the JSON scan at line 20, and both `readable` re-scans at lines 59 and 74). Example for the first:

```bash
out="$(semgrep --quiet --error --json \
  --config p/typescript --config p/react --config p/secrets \
  --config "$ROOT/rules/semgrep-mobile.yml" \
  --exclude 'fixtures' \
  "$TARGET" 2>/tmp/kiko-security-stderr.$$)"
```

Add the reason as a comment above the first invocation:

```bash
# `rules/fixtures/` holds the positive/negative fixture pair for each project
# rule. A positive fixture is deliberately vulnerable code, so it must not fail
# the real scan; `scripts/checks/semgrep-rules.sh` is what scans it on purpose.
```

- [ ] **Step 7: Wire the check in**

`package.json` scripts — add `"check:rules": "bash scripts/checks/semgrep-rules.sh"` and insert it into `check:all` right after `check:security`:

```json
"check:all": "npm run check:lint && npm run check:dup && npm run check:knip && npm run check:deps && npm run check:security && npm run check:rules && npm run check:secrets && npm run check:overrides",
```

`scripts/checks/medium.sh` — add after the `deps.sh` line, in the project-wide group:

```bash
"$DIR/semgrep-rules.sh" || exit 2
```

- [ ] **Step 8: Keep the other tools off the fixtures**

Each of these is a documented exception, not a blanket suppression — the directory contains no shipped code, only rule inputs.

`biome.json` → `files.includes`: `["**", "!ios", "!vendor", "!coverage", "!rules/fixtures", "!**/*.jsbundle"]`

`knip.json` → add `"ignore": ["rules/fixtures/**"]`

`.jscpd.json` → add `"rules/fixtures/**"` to `ignore`

`CLAUDE.md` → add to "Documented exceptions":

```markdown
- **`rules/fixtures/**` (Biome `files.includes`, `knip.json` `ignore`,
  `.jscpd.json` `ignore`, and `--exclude 'fixtures'` in
  `scripts/checks/security.sh`)**: the positive/negative fixture pair that
  proves each project Semgrep rule still fires. A positive fixture is
  deliberately non-conforming code (an unredacted widget money view, an
  unprotected App Group write, a Keychain secret pushed into React state) —
  that is the point of it, so it must not fail Biome, the real Semgrep scan,
  or the duplication check, and it is never imported so Knip reads it as an
  unused file. The pair is near-identical by construction (the negative
  fixture is the positive one plus the fix), so jscpd flags it as a clone
  every time. `npm run check:rules`
  (`scripts/checks/semgrep-rules.sh`) is the check that DOES scan the
  directory, and it fails if any rule stops matching its positive fixture or
  starts matching its negative one — so the exclusions above cost no
  coverage.
```

Also add `check:rules` to `CLAUDE.md`'s checks table (`scripts/checks/semgrep-rules.sh`, "a project Semgrep rule stops matching its fixture pair fails", medium tier) and to the `check:all` composite list.

- [ ] **Step 9: Record the rule in the inventory**

In `docs/harness/review-to-biome-inventory.md`, add a new section before "## Go-forward process":

```markdown
### Enforced — 2026-09-06 security pass (`docs/security/2026-09-06-security-pass-findings.md`)

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| `kiko-widget-money-view-needs-privacysensitive` | S2 | Semgrep (Swift, ERROR), `ios/KikoWidget/*.swift` | `Text(snapshot.…)` / `Text(item.…)` not inside a `.privacySensitive()` chain. Verified against Semgrep 1.175: a row-level `HStack { … }.privacySensitive()` satisfies it. |
```

(Tasks 6, 8, 10, 12, 13, 15 and 16 append their own rows to this table.)

- [ ] **Step 10: Checkpoint**

Run: `npm run check:all`
Expected: green, including the new `check:rules` step.

---

## Task 6: Semgrep rule H2 — an App Group write must set backup exclusion and a protection class

Mechanizes S3 for every future shared-container write. Verified against Semgrep 1.175: the function-scoped form is **not** expressible — `pattern-inside: func $F(...) { ... }` matches nothing in Swift in this version, so the rule is file-scoped instead: any Swift file that both reaches the App Group container and writes to a file must also set `isExcludedFromBackup` and a `protectionKey`. That is slightly coarser than "the same function", and it is honest: it produces zero false positives on the real tree (it correctly ignores `ios/KikoWidget/NetWorthSnapshot.swift`, which only reads).

**Files:**
- Create: `rules/fixtures/kiko-appgroup-write-needs-protection.bad.swift`
- Create: `rules/fixtures/kiko-appgroup-write-needs-protection.good.swift`
- Modify: `rules/semgrep-mobile.yml`
- Modify: `docs/harness/review-to-biome-inventory.md`

**Interfaces:**
- Consumes: the fixture harness and `npm run check:rules` from Task 5; the hardened `WidgetBridge.swift` from Task 4.

- [ ] **Step 1: Write the failing fixtures first**

`rules/fixtures/kiko-appgroup-write-needs-protection.bad.swift`:

```swift
// Semgrep fixture (POSITIVE): writes into the App Group container without
// excluding the file from backup and without an explicit protection class, so
// `kiko-appgroup-write-needs-protection` MUST report a finding. Never "fix"
// this file.
import Foundation

enum FixtureBadContainerWriter {
    static func persist(_ payload: String) throws {
        guard
            let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.example.fixture"
            )
        else {
            return
        }

        let fileURL = containerURL.appendingPathComponent("fixture.json")
        try payload.write(to: fileURL, atomically: true, encoding: .utf8)
    }
}
```

`rules/fixtures/kiko-appgroup-write-needs-protection.good.swift`:

```swift
// Semgrep fixture (NEGATIVE): the same write, correctly hardened — the file is
// excluded from backup and given an explicit protection class after every
// write. `kiko-appgroup-write-needs-protection` MUST report nothing here.
import Foundation

enum FixtureGoodContainerWriter {
    static func persist(_ payload: String) throws {
        guard
            let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.example.fixture"
            )
        else {
            return
        }

        var fileURL = containerURL.appendingPathComponent("fixture.json")
        try payload.write(to: fileURL, atomically: true, encoding: .utf8)

        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: fileURL.path
        )

        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try fileURL.setResourceValues(values)
    }
}
```

Neither fixture may contain `Text(snapshot.` or `Text(item.` — Task 5's rule also scans `rules/fixtures/*.swift`.

- [ ] **Step 2: Run the runner to verify it fails**

Run: `bash scripts/checks/semgrep-rules.sh`
Expected: exit 2, `rule "kiko-appgroup-write-needs-protection" reported NOTHING on its positive fixture`.

- [ ] **Step 3: Add the rule**

Append to the Class A section of `rules/semgrep-mobile.yml`, directly after the H1 rule:

```yaml
  # File-scoped on purpose. The function-scoped form ("the same function must
  # also set both attributes") is not expressible: Semgrep 1.175 does not match
  # `func $F(...) { ... }` as a Swift enclosing range, so `pattern-inside` /
  # `pattern-not-inside` on a function body silently matches nothing. A file
  # that reaches the App Group container AND writes a file must therefore carry
  # both hardening calls somewhere in it. Verified to produce no false positive
  # on the real tree: `ios/KikoWidget/NetWorthSnapshot.swift` reaches the
  # container but never writes, so it is not flagged.
  - id: kiko-appgroup-write-needs-protection
    languages: [generic]
    severity: ERROR
    message: >
      This file writes into the App Group container without setting
      `isExcludedFromBackup` and an explicit file-protection class. The shared
      container IS included in iCloud/iTunes backups and defaults to an
      inherited protection class, so a cleartext derivative of encrypted data
      leaks through a backup. Set both, after every write — an atomic write
      replaces the inode and drops them.
    paths:
      include:
        - "*.swift"
    pattern-regex: (?s)\A(?=.*\.write\(to:)(?!.*isExcludedFromBackup)(?!.*protectionKey).*forSecurityApplicationGroupIdentifier
```

- [ ] **Step 4: Run the runner to verify it passes**

Run: `bash scripts/checks/semgrep-rules.sh`
Expected: silent, exit 0.

Confirm the real tree is clean:

```bash
semgrep --quiet --config rules/semgrep-mobile.yml --exclude 'fixtures' ios/Kiko ios/KikoWidget
```
Expected: no findings (Task 4 hardened `WidgetBridge.swift`).

- [ ] **Step 5: Record the rule in the inventory**

Append to the 2026-09-06 table in `docs/harness/review-to-biome-inventory.md`:

```markdown
| `kiko-appgroup-write-needs-protection` | S3 | Semgrep (generic regex over `*.swift`, ERROR) | File-scoped, not function-scoped: Semgrep 1.175 cannot match a Swift `func` body as an enclosing range, so `pattern-inside`/`pattern-not-inside` on a function silently matches nothing. Zero false positives on the real tree. |
```

- [ ] **Step 6: Checkpoint**

Run: `npm run check:all`
Expected: green.

---

## Task 7: Pin `api.binance.com` and correct the pinning record (S1)

`ios/Kiko/Info.plist` pins exactly one domain, from when Monobank was the only secret-bearing host. `src/crypto-sync/binance/binance.client.ts:67` now sends `X-MBX-APIKEY` to `api.binance.com` unpinned: a malicious root CA (MDM profile, coerced configuration profile, injected trust anchor) reads the API key and the full `/api/v3/account` balance response, and can replay the captured signed request inside the 5 s `recvWindow`. Pin the root CA (primary) and the current intermediate (backup), and replace the README's now-false "the only host carrying the personal token" wording with a five-host table.

**Files:**
- Modify: `ios/Kiko/Info.plist:35-58`
- Modify: `docs/security/README.md:7-56`

**Interfaces:**
- Produces: `NSPinnedDomains` containing both `api.monobank.ua` and `api.binance.com`. Task 8's `plist.sh` asserts exactly this.

- [ ] **Step 1 (ops): Recompute the live chain and record the SPKI values**

Run the README's runbook verbatim against both hosts:

```bash
cd "$(mktemp -d)"
for host in api.monobank.ua api.binance.com; do
  echo "== $host"
  openssl s_client -connect "$host:443" -servername "$host" -showcerts </dev/null 2>/dev/null > chain.pem
  awk 'BEGIN{n=0} /BEGIN CERT/{n++} {print > ("cert" n ".pem")}' chain.pem
  for i in 1 2 3; do
    [ -f "cert$i.pem" ] || continue
    echo "cert$i: $(openssl x509 -in cert$i.pem -noout -subject -enddate | tr '\n' ' ') SPKI=$(openssl x509 -in cert$i.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)"
  done
  rm -f cert*.pem chain.pem
done
```

Record the full output in the task notes. As computed on 2026-09-06 while writing this plan, `api.binance.com` served:

| Role | Subject | Expires | SPKI-SHA256 (base64) |
|---|---|---|---|
| leaf | `C=KY, L=GEORGE TOWN, O=Binance Holdings Limited, CN=*.binance.com` | 2027-01-09 | `/Y6BOeqMgXS6wjqk6emFs+Y+HWkIXO2R8Dox5VO1YT0=` |
| intermediate | `C=US, O=DigiCert Inc, OU=www.digicert.com, CN=GeoTrust TLS RSA CA G1` | 2027-11-02 | `SDG5orEv8iX6MNenIAxa8nQFNpROB/6+llsZdXHZNqs=` |
| root | `C=US, O=DigiCert Inc, OU=www.digicert.com, CN=DigiCert Global Root G2` | 2038-01-15 | `i7WTqTvh0OioIruIfFR4kMPnBqrS2rdiVPl/s2uC/CY=` |

**If today's output differs from this table, today's output wins** — use the values you just computed, and correct the table in the README accordingly. Do not pin the leaf; it renews.

- [ ] **Step 2: Edit the plist**

In `ios/Kiko/Info.plist`, replace the comment above `NSPinnedDomains` (lines 35-39) and add the second domain. The `NSAppTransportSecurity` block becomes (with `NSAllowsLocalNetworking` still present — Task 14 removes it):

```xml
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsArbitraryLoads</key>
		<false/>
		<key>NSAllowsLocalNetworking</key>
		<true/>
		<!-- Certificate pinning for every secret-bearing host. CA (not leaf)
		     pins: primary = root CA, backup = current intermediate. The three
		     remaining contacted hosts (api.coingecko.com, blockstream.info,
		     bank.gov.ua) are deliberately unpinned: none carries a credential.
		     Host table + rotation runbook: docs/security/README.md. -->
		<key>NSPinnedDomains</key>
		<dict>
			<key>api.monobank.ua</key>
			<dict>
				<key>NSIncludesSubdomains</key>
				<false/>
				<key>NSPinnedCAIdentities</key>
				<array>
					<dict>
						<key>SPKI-SHA256-BASE64</key>
						<string>++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=</string>
					</dict>
					<dict>
						<key>SPKI-SHA256-BASE64</key>
						<string>DxH4tt40L+eduF6szpY6TONlxhZhBd+pJ9wbHlQ2fuw=</string>
					</dict>
				</array>
			</dict>
			<key>api.binance.com</key>
			<dict>
				<key>NSIncludesSubdomains</key>
				<false/>
				<key>NSPinnedCAIdentities</key>
				<array>
					<dict>
						<key>SPKI-SHA256-BASE64</key>
						<string>i7WTqTvh0OioIruIfFR4kMPnBqrS2rdiVPl/s2uC/CY=</string>
					</dict>
					<dict>
						<key>SPKI-SHA256-BASE64</key>
						<string>SDG5orEv8iX6MNenIAxa8nQFNpROB/6+llsZdXHZNqs=</string>
					</dict>
				</array>
			</dict>
		</dict>
	</dict>
```

Substitute the Step 1 values if they differ. Keep the file tab-indented, matching the rest of the plist.

- [ ] **Step 3: Validate the plist**

Run:

```bash
plutil -lint ios/Kiko/Info.plist
plutil -extract NSAppTransportSecurity.NSPinnedDomains raw -o - ios/Kiko/Info.plist
```
Expected: `OK`, then two lines — `api.monobank.ua` and `api.binance.com`.

- [ ] **Step 4: Rewrite the README's pinning section**

Replace `docs/security/README.md` lines 7-56 (from `## Certificate pinning — api.monobank.ua` down to the end of the rotation runbook) with:

```markdown
## Certificate pinning — contacted hosts

`ios/Kiko/Info.plist` → `NSAppTransportSecurity` → `NSPinnedDomains` pins every
host the app sends a credential to, with two CA SPKI-SHA256 pins each under
`NSPinnedCAIdentities` (primary = root CA, backup = current intermediate).
Pinning is scoped to secret-bearing hosts: a MITM on a public, unauthenticated
endpoint can misreport a number, but has no credential to steal, and pinning a
third-party public API the user cannot re-provision trades a real
availability risk for little.

| Host | Used by | Carries a secret | Pinned | Rationale |
|---|---|---|---|---|
| `api.monobank.ua` | `src/monobank/monobank.client.ts` (`X-Token` header) | yes — the personal bank token | **yes** | The token grants read access to every account and full statement history. |
| `api.binance.com` | `src/crypto-sync/binance/binance.client.ts` (`X-MBX-APIKEY` header) | yes — the read-only API key | **yes** | A MITM reads the API key and the full `/api/v3/account` balance response, and can replay the captured signed request inside the 5 s `recvWindow`. The HMAC secret itself never crosses the wire (`binance.hmac.ts` signs locally). |
| `api.coingecko.com` | `src/rates/coingecko.ts`, `src/rates/coingecko-history.ts` | no | no | Public BTC price quote, no auth header. Worst case an active MITM misreports the BTC price. |
| `blockstream.info` | `src/crypto-sync/btc-wallet/btc-wallet.client.ts` | no | no | Public Esplora explorer, no auth header. Worst case an active MITM forges `chain_stats` and misreports the BTC balance. See the accepted risk on address disclosure below. |
| `bank.gov.ua` | `src/rates/nbu-history.ts` | no | no | Public NBU historical fiat rates, no auth header. |

### Current chains (verified 2026-09-06)

`api.monobank.ua` — re-verified 2026-09-06 against the live host, **unchanged**:

| Role | Subject | Expires | SPKI-SHA256 (base64) | Pinned |
|---|---|---|---|---|
| leaf | `CN=monobank.ua` | 2027-03-10 | `9C7Ylw+j3lXV/wphskz8+ZqUy1hG4/3dsBe3alQjmCA=` | no (renews) |
| intermediate | `C=US, O=Amazon, CN=Amazon RSA 2048 M01` | 2030-08-23 | `DxH4tt40L+eduF6szpY6TONlxhZhBd+pJ9wbHlQ2fuw=` | yes — backup |
| root | `C=US, O=Amazon, CN=Amazon Root CA 1` | 2037-12-31 | `++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=` | yes — primary |

`api.binance.com` — first pinned 2026-09-06:

| Role | Subject | Expires | SPKI-SHA256 (base64) | Pinned |
|---|---|---|---|---|
| leaf | `C=KY, O=Binance Holdings Limited, CN=*.binance.com` | 2027-01-09 | `/Y6BOeqMgXS6wjqk6emFs+Y+HWkIXO2R8Dox5VO1YT0=` | no (renews) |
| intermediate | `C=US, O=DigiCert Inc, CN=GeoTrust TLS RSA CA G1` | 2027-11-02 | `SDG5orEv8iX6MNenIAxa8nQFNpROB/6+llsZdXHZNqs=` | yes — backup |
| root | `C=US, O=DigiCert Inc, CN=DigiCert Global Root G2` | 2038-01-15 | `i7WTqTvh0OioIruIfFR4kMPnBqrS2rdiVPl/s2uC/CY=` | yes — primary |

### What breaks if the pins go stale

Monobank: every Monobank request fails closed with a TLS error
(`useSync`/`useAutoSync` surface it as a failed sync; no data leaves the
device). Binance: the crypto sync's Binance provider fails the same way; the
BTC-wallet provider, CoinGecko price sync, and NBU history keep working. Fail
closed is the intended mode in both cases.

### Rotation runbook

Owner: the repository owner (single-user app). Cadence: on every release build,
and immediately if a sync starts failing with a TLS error.

1. Recompute BOTH chains:

   ```bash
   cd "$(mktemp -d)"
   for host in api.monobank.ua api.binance.com; do
     echo "== $host"
     openssl s_client -connect "$host:443" -servername "$host" -showcerts </dev/null 2>/dev/null > chain.pem
     awk 'BEGIN{n=0} /BEGIN CERT/{n++} {print > ("cert" n ".pem")}' chain.pem
     for i in 1 2 3; do
       [ -f "cert$i.pem" ] || continue
       echo "cert$i: $(openssl x509 -in cert$i.pem -noout -subject -enddate | tr '\n' ' ') SPKI=$(openssl x509 -in cert$i.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)"
     done
     rm -f cert*.pem chain.pem
   done
   ```

2. If a host's root SPKI still equals its primary pin, nothing to do for that
   host (an intermediate change alone is covered by the root pin; refresh the
   backup pin at the next convenient release).
3. If a host moved to a different CA: replace BOTH of that host's pins with the
   new root (primary) and new intermediate (backup), update the table above,
   run `plutil -lint ios/Kiko/Info.plist` and `npm run check:plist`, rebuild,
   run the positive and negative device checks, ship.
4. Positive check: on device, Monobank sync succeeds AND a Binance sync
   succeeds.
5. Negative check: temporarily corrupt one character in BOTH of a host's pins,
   rebuild, confirm that host's sync fails with a TLS error while the other
   host's still succeeds, then revert.
6. Adding a new host that sends a credential header means adding it here AND to
   `NSPinnedDomains`. `npm run check:plist` fails the build if you forget.
```

- [ ] **Step 5 (ops): Named manual verification — pinned Binance sync (device)**

1. Build and install to the device.
2. Connect (or re-sync) the Binance provider from the crypto account detail screen.
3. **Expected (positive):** the sync succeeds and balances update.
4. **Negative check:** corrupt one character in BOTH Binance pins, rebuild, re-sync. **Expected:** the Binance sync fails with a TLS error while Monobank sync still succeeds. Revert the corruption and rebuild.

Record both results in the task notes.

- [ ] **Step 6: Checkpoint**

Run: `npm run check:all`
Expected: green. `check:secrets` must stay silent — the SPKI values are public certificate hashes in the same shape gitleaks already accepts in this plist and README. If gitleaks does flag one, do NOT broaden the allowlist path; add a narrow `regexes` entry for that exact value with the reason, per `CLAUDE.md`.

---

## Task 8: Shell check H3 — every credential-bearing host must be pinned

This is the highest-leverage rule of the seven: it is what would have failed the day the Binance client landed. The Semgrep half of the original H3 idea (a TS rule flagging a `fetch` with a credential header) is **deliberately not implemented** — Semgrep cannot see the plist, so such a rule can only flag both known-good clients forever. Recorded as such in the inventory. The shell assertion does the whole job: it resolves each credential-bearing client's `@env` endpoint to a host and fails unless that host is under `NSPinnedDomains`.

**Files:**
- Create: `scripts/checks/plist.sh`
- Modify: `package.json` (`check:plist`; add to `check:all`)
- Modify: `scripts/checks/medium.sh`
- Modify: `CLAUDE.md` (checks table, `check:all` list)
- Modify: `docs/harness/review-to-biome-inventory.md`

**Interfaces:**
- Produces: `npm run check:plist` and `scripts/checks/plist.sh`. Task 16 extends the same script with the Release-hardening assertions (H6).

- [ ] **Step 1: Write the check, and prove it fails on the pre-fix state**

Create `scripts/checks/plist.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
PLIST="$ROOT/ios/Kiko/Info.plist"
WIDGET_PLIST="$ROOT/ios/KikoWidget/Info.plist"

problems=""
add_problem() { problems="${problems}
  - $1"; }

# --- 0. Both plists must parse at all -----------------------------------------
for p in "$PLIST" "$WIDGET_PLIST"; do
  if ! plutil -lint "$p" >/dev/null 2>&1; then
    add_problem "$p is not a valid property list ($(plutil -lint "$p" 2>&1))"
  fi
done

# --- 1. Every credential-bearing host must be pinned (H3) ---------------------
# A client that sends a credential header (X-Token, X-MBX-APIKEY, Authorization,
# or an api-key-ish header) takes its base URL from `@env` — that is the
# project's convention (kiko-code-style, "Externalize hardcoded config"). Resolve
# each such client's `@env` identifiers to hosts via `.env`, then require every
# resolved host under NSPinnedDomains. This is what would have caught the
# unpinned Binance host on the day it landed.
pinned="$(plutil -extract NSAppTransportSecurity.NSPinnedDomains raw -o - "$PLIST" 2>/dev/null)"

while IFS= read -r file; do
  [ -n "$file" ] || continue
  env_names="$(sed -n "s/^import[[:space:]]*{\(.*\)}[[:space:]]*from[[:space:]]*'@env';.*/\1/p" "$file" | tr ',' '\n' | tr -d ' ')"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    value="$(grep -E "^${name}=" "$ROOT/.env" | head -1 | cut -d= -f2-)"
    case "$value" in http://*|https://*) ;; *) continue ;; esac
    host="$(printf '%s' "$value" | sed -E 's#^[a-z]+://##; s#[/?].*$##')"
    if ! printf '%s\n' "$pinned" | grep -Fxq "$host"; then
      add_problem "$host (from $name, used by ${file#"$ROOT"/}) sends a credential header but is not under NSPinnedDomains in ios/Kiko/Info.plist"
    fi
  done <<EOF
$env_names
EOF
done <<EOF
$(grep -rlE "'(X-Token|X-MBX-APIKEY|Authorization)'|'[Aa]pi[-_]?[Kk]ey'" "$ROOT/src" --include='*.ts' | grep -v '\.test\.')
EOF

if [ -n "$problems" ]; then
  print_block \
    "iOS Info.plist assertions" \
    "The shipped Info.plist does not satisfy the project's security invariants." \
    "$problems" \
    "The plist is the app's ATS and pinning policy. A host that carries a credential but is not pinned can be MITM'd by any device-trusted CA (an MDM or coerced configuration profile), which reads the credential and the response. See docs/security/README.md." \
    "Fix ios/Kiko/Info.plist (and docs/security/README.md's host table). Re-run: npm run check:plist" \
    "Do not delete the assertion or add the host to an ignore list. Pin the host, or stop sending it a credential."
  exit 2
fi

exit 0
```

- [ ] **Step 2: Prove it actually catches the bug it exists for**

Temporarily revert the `api.binance.com` block out of `ios/Kiko/Info.plist` (keep a copy), then run:

```bash
bash scripts/checks/plist.sh
```
Expected: exit 2, with `api.binance.com (from BINANCE_API_ENDPOINT, used by src/crypto-sync/binance/binance.client.ts) sends a credential header but is not under NSPinnedDomains`.

Restore the block, re-run:

```bash
bash scripts/checks/plist.sh
```
Expected: silent, exit 0.

- [ ] **Step 3: Wire the check in**

`package.json` — add `"check:plist": "bash scripts/checks/plist.sh"` and insert it into `check:all` after `check:rules`:

```json
"check:all": "npm run check:lint && npm run check:dup && npm run check:knip && npm run check:deps && npm run check:security && npm run check:rules && npm run check:plist && npm run check:secrets && npm run check:overrides",
```

`scripts/checks/medium.sh` — add after the `semgrep-rules.sh` line:

```bash
"$DIR/plist.sh" || exit 2
```

`CLAUDE.md` — add a row to the checks table:

```markdown
| `npm run check:plist` | plist.sh (`plutil`) | any Info.plist security invariant violation fails | medium |
```

and add `check:plist` to the `check:all` composite list.

- [ ] **Step 4: Record the rule — and the rule that was NOT written**

Append to the 2026-09-06 table in `docs/harness/review-to-biome-inventory.md`:

```markdown
| `plist.sh` — credential-bearing host must be pinned | S1, H3 | Shell assertion (`scripts/checks/plist.sh`, medium tier + `check:all`) | Resolves each credential-header client's `@env` endpoint to a host via `.env` and requires it under `NSPinnedDomains`. |
```

and add, under the table:

```markdown
**Not mechanized, with reason.** H3's Semgrep half — "flag a `fetch` whose
headers carry a credential key" — was dropped. Semgrep cannot read
`Info.plist`, so the rule can only report every credential-bearing client
unconditionally, which means it would fire forever on the two known-good,
correctly-pinned clients. That is a noisy rule, not a check. The shell
assertion above carries the whole intent, and it is strictly more precise
because it can compare against the actual pinned set.
```

- [ ] **Step 5: Checkpoint**

Run: `npm run check:all`
Expected: green.

---

## Task 9: Accept "cold-launch-only lock" and make the docs say so (S4)

The approved design spec called for an `AppState` grace period; the shipped `useAppLock` locks exactly once, at cold launch, and never re-locks. That is the deliberate, user-approved outcome (the grace-period design was built, then replaced). The problem is that nothing written down says so, so the security posture overstates what ships — and `settings.lock_grace_seconds` survives with no setter and no reader. Decision: keep the column (no drop migration), record the limitation, and make every document agree.

**Files:**
- Modify: `docs/security/README.md` (accepted-risk register)
- Modify: `docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md:190-203`
- Modify: `.claude/skills/kiko-domain/SKILL.md` ("App lock / security settings" section)
- Modify: `src/db/schema.ts:126-129` (comment only)

- [ ] **Step 1: Record it as an accepted risk**

Add to the "## Accepted risks (not mitigated by design)" list in `docs/security/README.md`:

```markdown
- **The app lock is cold-launch only; it never re-locks.**
  `src/auth/use-app-lock.ts` decides `isLocked` exactly once, when the settings
  row first loads, and there is no `AppState` subscription anywhere in
  `src/auth/`. **Concrete limitation:** if the phone is taken while Kiko is
  backgrounded but its process is still resident — the common case, since iOS
  keeps a foreground-recent app alive for a long time — unlocking the device and
  tapping Kiko resumes straight into the navigator with full balances and
  transaction history, with no Face ID prompt. The lock only helps once iOS has
  killed the process. The device passcode is the only barrier in that window.
  This is deliberate: the approved spec's `AppState` grace period
  (`docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md:198-203`)
  was built and then replaced, because a re-lock on every foreground made the
  app unusable for the quick balance checks it exists for. The app-switcher
  redaction overlay (`ios/Kiko/AppDelegate.swift:55-86`) still protects the
  thumbnail — it protects the snapshot, not the resumed app. Revisit only with
  a deliberate decision to resurrect the grace period.
- **`settings.lock_grace_seconds` is a legacy column with zero readers.** It
  survives from the abandoned grace-period design (migration
  `drizzle/migrations/0011_add_lock_settings.sql`), has no setter in
  `src/repositories/settings.repo.ts` and no reader anywhere in `src/`. It is
  intentionally NOT dropped: a destructive migration on a live single-user
  database buys nothing here, and the column is harmless (`NOT NULL DEFAULT 30`).
  It is pinned as the sole documented exception in the
  `settings`-columns-have-a-reader test (`src/db/settings-columns.test.ts`), so
  neither a new dead column nor a silent re-wiring of this one can slip through.
```

- [ ] **Step 2: Mark the spec's grace-period paragraph superseded**

In `docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md`, insert immediately after the `use-app-lock.ts` bullet that ends `Cold launch starts locked whenever lockEnabled is true.` (around line 203):

```markdown
  > **Superseded (2026-09-06):** the `AppState` grace period described in this
  > bullet was built and then replaced. What ships locks only at cold launch and
  > never re-locks; `settings.lockGraceSeconds` has no reader. Accepted, with
  > its limitation stated, in `docs/security/README.md`. The
  > `setLockGraceSeconds` setter and the grace-period picker described further
  > down were not shipped either.
```

Do not rewrite the surrounding paragraphs.

- [ ] **Step 3: Align the skill**

The "App lock / security settings" section of `.claude/skills/kiko-domain/SKILL.md` already describes `lockGraceSeconds` as LEGACY/DEAD. Extend it so it also states the shipped lock's limitation and points at the register — append to that paragraph:

```markdown
The shipped lock is **cold-launch only**: `useAppLock` decides once and never
re-locks, so a resident backgrounded process resumes without a prompt. That is
an accepted, recorded risk — see `docs/security/README.md`. `lockGraceSeconds`
is pinned as the one allowed reader-less `settings` column by
`src/db/settings-columns.test.ts`; wiring it up means removing it from that
test's documented-exception list, which is the deliberate decision gate.
```

- [ ] **Step 4: Align the schema comment**

`src/db/schema.ts:126-129` — replace the `lockGraceSeconds` comment:

```ts
  // LEGACY, zero readers. The abandoned background-grace design (migration 0011
  // created it); the shipped lock is cold-launch-only and never re-locks.
  // Deliberately not dropped — a destructive migration on a live single-user DB
  // buys nothing and the column is harmless. Pinned as the sole documented
  // exception in `src/db/settings-columns.test.ts`; re-wiring it means removing
  // it there first. Accepted risk: docs/security/README.md.
  lockGraceSeconds: integer('lock_grace_seconds').notNull().default(30),
```

- [ ] **Step 5: Checkpoint**

Run: `npm run check:all`
Expected: green. No code behaviour changed, so no test changes.

---

## Task 10: Jest test H5 — every `settings` column must have a reader

Directly implements the existing "grep migration columns when removing a feature" lesson and would have caught `lockGraceSeconds`. The test asserts the set of reader-less columns is **exactly** the documented list — so adding a new dead column fails, and re-wiring `lockGraceSeconds` also fails until it is removed from the list. That is a decision gate, not a suppression.

**Files:**
- Create: `src/db/settings-columns.test.ts`
- Modify: `docs/harness/review-to-biome-inventory.md`

- [ ] **Step 1: Write the failing test first**

`src/db/settings-columns.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A removed feature can leave a live-but-unread schema column behind
 * (`settings.lockGraceSeconds` did — security finding S4). This test walks the
 * `settings` table's TypeScript column properties and asserts every one of them
 * is mentioned somewhere in `src/` outside `schema.ts` itself.
 *
 * The exception list is EXACT, not a floor: a new reader-less column fails, and
 * so does re-wiring a listed one without removing it here. That makes the list
 * a deliberate decision gate rather than a place to hide dead schema.
 */
const DOCUMENTED_READERLESS_COLUMNS = [
  // Legacy: the abandoned background-grace design. The shipped lock is
  // cold-launch-only. Deliberately not dropped — see docs/security/README.md
  // and the comment on the column in schema.ts.
  'lockGraceSeconds',
];

const SCHEMA_PATH = join(__dirname, 'schema.ts');
const SRC_ROOT = join(__dirname, '..');

const settingsColumns = (): string[] => {
  const source = readFileSync(SCHEMA_PATH, 'utf8');
  const block = source.split("export const settings = sqliteTable('settings', {")[1]?.split('});')[0];

  return [...(block ?? '').matchAll(/^ {2}(\w+):/gm)].map((match) => match[1] as string);
};

const sourceFiles = (directory: string): string[] => {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }

    if (!/\.tsx?$/.test(entry) || full === SCHEMA_PATH) {
      return [];
    }

    return [full];
  });
};

describe('settings schema columns', () => {
  it('has every column referenced outside schema.ts, except the documented legacy ones', () => {
    const columns = settingsColumns();
    expect(columns.length).toBeGreaterThan(0);

    const sources = sourceFiles(SRC_ROOT).map((file) => readFileSync(file, 'utf8'));
    const readerless = columns.filter(
      (column) => !sources.some((source) => new RegExp(`\\b${column}\\b`).test(source)),
    );

    expect(readerless.sort()).toEqual([...DOCUMENTED_READERLESS_COLUMNS].sort());
  });
});
```

- [ ] **Step 2: Run it and confirm it passes for the right reason**

Run: `npx jest src/db/settings-columns.test.ts`
Expected: PASS.

Now prove it actually bites — temporarily add a throwaway column to `src/db/schema.ts`'s `settings` table:

```ts
  scratchDeadColumn: integer('scratch_dead_column'),
```

Run: `npx jest src/db/settings-columns.test.ts`
Expected: FAIL — `Expected: ["lockGraceSeconds"] Received: ["lockGraceSeconds", "scratchDeadColumn"]`.

Remove the throwaway column and re-run.
Expected: PASS.

- [ ] **Step 3: Record the rule**

Append to the 2026-09-06 table in `docs/harness/review-to-biome-inventory.md`:

```markdown
| `settings` columns must have a reader | S4, H5 | Jest (`src/db/settings-columns.test.ts`) | Exception list is exact, not a floor, so both a new dead column and a silent re-wiring fail. Not a Semgrep rule: the assertion is cross-file (schema vs. the whole of `src/`). |
```

- [ ] **Step 4: Checkpoint**

Run: `npm run check:all` then `npx jest`
Expected: green.

---

## Task 11: Fix the `db-config.ts` comments and assert the flags stay on (S10 + H7)

Both doc comments say "Default OFF … Do not turn it on for ordinary development builds" while the shipped values are `true`. That is the most dangerous kind of stale comment in this repo: an agent that treats it as authoritative and "restores" the documented default ships an **unencrypted database** and **no app lock**. The comments get rewritten to describe what actually ships, and a one-line test turns a silent catastrophic regression into a failing test.

**Files:**
- Modify: `src/db/db-config.ts:1-37`
- Create: `src/db/db-config.test.ts`
- Modify: `docs/harness/review-to-biome-inventory.md`

- [ ] **Step 1: Write the failing test first**

`src/db/db-config.test.ts`:

```ts
import { APP_LOCK_ENABLED, DB_ENCRYPTION_ENABLED } from './db-config';

/**
 * These two flags are the app's two most important security controls. Flipping
 * either one off ships a build with a plaintext SQLite database
 * (`src/db/client.ts`'s `kiko.db` path) or with no biometric gate at all, and
 * neither failure is visible in the UI. Both migrations they gated are long
 * complete, so there is no supported reason to turn either off in a shipping
 * build. This test exists so that doing it fails here instead of on a device.
 */
describe('database and app-lock master switches', () => {
  it('keeps database encryption on', () => {
    expect(DB_ENCRYPTION_ENABLED).toBe(true);
  });

  it('keeps the app lock on', () => {
    expect(APP_LOCK_ENABLED).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — it should already pass**

Run: `npx jest src/db/db-config.test.ts`
Expected: PASS (both flags are already `true`).

Prove it bites: temporarily set `DB_ENCRYPTION_ENABLED = false`, re-run.
Expected: FAIL — `Expected: true, Received: false`. Restore `true`.

- [ ] **Step 3: Rewrite both comments**

`src/db/db-config.ts` becomes:

```ts
/**
 * Master switch for the SQLCipher database encryption.
 *
 * **ON in every shipping build, and it must stay on.** The one-time supervised
 * plaintext -> SQLCipher migration this flag gated is complete: every device
 * running the app has already exported into `kiko-encrypted.db` and had its
 * plaintext files scrubbed (`src/db/encrypted-database.ts`).
 *
 * The flag still exists because the OFF path is a real, working code path, not
 * dead code — it is the escape hatch for a build made without the SQLCipher pod.
 * Do NOT flip it to `false` to make something build. Turning it off makes
 * `initDatabase()` open the LIVE PLAINTEXT `kiko.db` instead: `assertSQLCipherBuild()`
 * never runs, no db key is read, and every balance, transaction, IBAN and
 * masked PAN sits unencrypted on disk. It also strands the user's real data,
 * which lives in the encrypted file this path does not open. Enforced by
 * `src/db/db-config.test.ts`.
 */
export const DB_ENCRYPTION_ENABLED = true;

/**
 * Master switch for the biometric app lock.
 *
 * **ON in every shipping build, and it must stay on.** The supervised on-device
 * step this flag gated is complete: the biometrics pod is installed and
 * `NSFaceIDUsageDescription` is in `ios/Kiko/Info.plist`.
 *
 * The flag still exists because the OFF path guarantees no runtime code path
 * `require`s `src/auth/biometrics.ts` — `@sbaiahmed1/react-native-biometrics`
 * calls `TurboModuleRegistry.getEnforcing('ReactNativeBiometrics')` at module
 * load, which crashes the app when the native module is unlinked. That makes
 * the OFF path the escape hatch for a build without the pod, nothing more.
 * Do NOT flip it to `false` to make something build. Turning it off makes
 * `useAppLock()` report `{ isReady: true, isLocked: false }` unconditionally, so
 * `LockGate` never prompts and the user's enabled app lock silently stops
 * existing — the widget writer folds the same flag in
 * (`src/widget/use-net-worth-widget.ts`), so the App Group snapshot would start
 * being written again too. Enforced by `src/db/db-config.test.ts`.
 */
export const APP_LOCK_ENABLED = true;
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/db/`
Expected: PASS.

- [ ] **Step 5: Record the rule**

Append to the 2026-09-06 table in `docs/harness/review-to-biome-inventory.md`:

```markdown
| Security master switches stay `true` | S10, H7 | Jest (`src/db/db-config.test.ts`) | One assertion per flag. Converts an accidental "restore the documented default" from a silent shipped regression into a failing test. |
```

- [ ] **Step 6: Checkpoint**

Run: `npm run check:all` then `npx jest`
Expected: green.

---

## Task 12: Stop prefilling the Monobank token into React state (S5)

`MonobankTokenField`'s effect calls `readToken()` and pushes the plaintext bank token into `useState` on **every** mount — including when `isConnected` is true and the field is never rendered, because hooks run before the early return. The value is never displayed (`secureTextEntry`), so the prefill buys nothing and only lengthens the token's lifetime in the JS heap. Replace it: never read the secret into state, expose only a boolean "saved" indicator, and require re-entry to change it.

**Files:**
- Modify: `src/monobank/token.ts:31-34` (add `hasToken`)
- Create/Modify: `src/monobank/token.test.ts` (add `hasToken` cases; create the file if it does not exist)
- Modify: `src/screens/account-detail/monobank-token-field/monobank-token-field.component.tsx:31-102`
- Modify: `src/screens/account-detail/monobank-token-field/monobank-token-field.component.test.tsx:45-66`
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts`

**Interfaces:**
- Produces: `hasToken(): Promise<boolean>` in `src/monobank/token.ts` — a Keychain existence probe that never returns the secret. Task 13's Semgrep rule is written against the resulting component shape (no reader result reaching a `setX`).

- [ ] **Step 1: Write the failing `hasToken` test first**

In `src/monobank/token.test.ts` (create it with the same `jest.mock('react-native-keychain', ...)` shape the existing Keychain tests use if it does not exist):

```ts
  describe('hasToken', () => {
    it('reports true when an item exists, without returning the secret', async () => {
      mockGetGenericPassword.mockResolvedValue({ username: 'monobank', password: 'secret-token' });

      const result = await hasToken();

      expect(result).toBe(true);
    });

    it('reports false when nothing is stored', async () => {
      mockGetGenericPassword.mockResolvedValue(false);

      await expect(hasToken()).resolves.toBe(false);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/monobank/token.test.ts`
Expected: FAIL — `hasToken is not a function`.

- [ ] **Step 3: Add `hasToken`**

In `src/monobank/token.ts`, after `readToken`:

```ts
/**
 * Whether a token is stored, WITHOUT handing the value back. The account-detail
 * field uses this to show a "token saved" state: a stored secret must never be
 * prefilled into an editable input or parked in React state, where a jailbroken
 * device or an attached debugger can read the JS heap. Changing the token means
 * re-entering it.
 */
export const hasToken = async (): Promise<boolean> => {
  return (await Keychain.getGenericPassword({ service })) !== false;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/monobank/token.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the component's tests first**

In `src/screens/account-detail/monobank-token-field/monobank-token-field.component.test.tsx`:

- Change the module mock to expose `hasToken` instead of `readToken`:

```ts
const mockHasToken = jest.fn<Promise<boolean>, []>();

jest.mock('../../../monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
  hasToken: () => mockHasToken(),
}));
```

and in `beforeEach`, replace `mockReadToken.mockResolvedValue(undefined)` with `mockHasToken.mockResolvedValue(false)`.

- Delete both prefill cases (`'prefills the token input from readToken'`, lines 45-49, and `'does not overwrite the token the user is typing once readToken resolves late'`, lines 51-66) and the now-unused `deferred` helper if nothing else uses it.
- Add:

```ts
  it('never prefills the input from the Keychain', async () => {
    mockHasToken.mockResolvedValue(true);
    const { getByPlaceholderText } = await render(<MonobankTokenField isConnected={false} />);

    expect(getByPlaceholderText('Monobank token').props.value).toBe('');
  });

  it('shows a "token saved" indicator when a token is already stored', async () => {
    mockHasToken.mockResolvedValue(true);
    const { findByText } = await render(<MonobankTokenField isConnected={false} />);

    expect(await findByText('Token saved')).toBeTruthy();
  });

  it('does not touch the Keychain at all when the account is connected', async () => {
    await render(<MonobankTokenField isConnected />);

    expect(mockHasToken).not.toHaveBeenCalled();
  });

  it('clears the entered token from state after a successful save', async () => {
    mockFetchClientInfo.mockResolvedValue({ name: 'Test User' });
    const { getByPlaceholderText, getByText, findByText } = await render(
      <MonobankTokenField isConnected={false} />,
    );

    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'a-real-token');
    await fireEvent.press(getByText('Save'));

    expect(await findByText('Connected as Test User')).toBeTruthy();
    expect(getByPlaceholderText('Monobank token').props.value).toBe('');
  });
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx jest src/screens/account-detail/monobank-token-field/`
Expected: FAIL — the component still imports `readToken` (now unmocked) and still prefills.

- [ ] **Step 7: Add the copy**

`src/i18n/locales/en.ts`, in the `accountDetail` block, alphabetically after `tokenLabel`:

```ts
    tokenSaved: 'Token saved',
```

`src/i18n/locales/uk.ts`, same position:

```ts
    tokenSaved: 'Токен збережено',
```

`src/i18n/locales/en.uk.parity.test.ts` needs no change — it derives its key set.

- [ ] **Step 8: Rewrite the component**

In `src/screens/account-detail/monobank-token-field/monobank-token-field.component.tsx`:

- Change the import to `import { hasToken, saveToken } from '../../../monobank/token';`
- Replace the state block and the prefill effect (lines 33-48) with:

```ts
  const [token, setToken] = useState('');
  const [isTokenSaved, setIsTokenSaved] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<SyncStatus>({ kind: 'idle' });

  // SECURITY: a stored token is never read back into state — only its existence
  // is. Prefilling a `secureTextEntry` field with the real secret displays
  // nothing to the user and parks the bank token in the React tree for anything
  // that can read the JS heap. Changing the token means re-entering it.
  // Skipped entirely once connected: this branch renders no input at all.
  useEffect(() => {
    if (isConnected) {
      return;
    }

    let alive = true;
    hasToken().then((exists) => {
      if (alive) {
        setIsTokenSaved(exists);
      }
    });

    return () => {
      alive = false;
    };
  }, [isConnected]);

  // Belt and braces: drop the entered value when the field goes away, so it does
  // not linger in a retained fiber.
  useEffect(() => {
    return () => {
      setToken('');
    };
  }, []);
```

- Delete the `hasUserEditedToken` ref (line 35) and its two assignments (lines 51, 62) — nothing races a prefill any more. `useRef` becomes an unused import; remove it.
- In `handleSaveToken`'s success branch, clear the field and flip the indicator:

```ts
      try {
        await saveToken(token);
        setToken('');
        setIsTokenSaved(true);
        setTokenStatus({
          kind: 'success',
          message: t('accountDetail.connectedAs', { name: clientName }),
        });
      } catch {
```

- Render the indicator in the connected early return and above the input in the entry branch. Connected branch:

```tsx
  if (isConnected) {
    return (
      <Box gap={3}>
        <Text variant="heading">{t('accountDetail.synchronization')}</Text>
      </Box>
    );
  }
```

(unchanged — a connected account never reads the Keychain, and its status line lives on the parent screen)

Entry branch — insert directly after the `openMonobankLink` `Pressable`, separated by a blank line per the JSX sibling rule:

```tsx
      {isTokenSaved ? <Text variant="caption">{t('accountDetail.tokenSaved')}</Text> : null}
```

Use whatever `variant` the design system actually exposes for secondary text — check `src/design-system/components/text/` and match the surrounding usage rather than inventing a variant name.

- [ ] **Step 9: Run to verify they pass**

Run: `npx jest src/screens/account-detail/ src/monobank/`
Expected: PASS.

- [ ] **Step 10: Checkpoint**

Run: `npm run check:all` then `npx jest`
Expected: green. `check:knip` must stay green — `readToken` still has consumers (`src/screens/use-auto-sync.ts:58`, `src/screens/account-detail/account-detail.screen.tsx:161`, `src/monobank/sync.ts:296`).

---

## Task 13: Semgrep rule H4 — a Keychain secret must not flow into React state

Mechanizes S5. Verified against Semgrep 1.175: **taint mode catches the `await` form** (`const stored = await readCredentials(); setCreds(stored);`) but does **not** propagate through a `.then(callback)` parameter — neither `pattern-propagators` nor a `focus-metavariable` source works there, and the deep-expression form `(($V) => { <... $SET($V) ...> })` matches nothing. Since the `.then` shape is exactly the one S5 found, the rule ships as two patterns: the working taint rule, plus a syntactic pattern for a Keychain reader chained with `.then`. Class B (WARNING, override-eligible), per the H4 idea.

**Files:**
- Create: `rules/fixtures/kiko-no-keychain-secret-into-usestate.bad.ts`
- Create: `rules/fixtures/kiko-no-keychain-secret-into-usestate.good.ts`
- Modify: `rules/semgrep-mobile.yml` (Class B section)
- Modify: `docs/harness/review-to-biome-inventory.md`

**Interfaces:**
- Consumes: the fixture harness from Task 5; the rewritten component from Task 12.

- [ ] **Step 1: Write the failing fixtures first**

`rules/fixtures/kiko-no-keychain-secret-into-usestate.bad.ts`:

```ts
// Semgrep fixture (POSITIVE): both shapes push a Keychain secret into React
// state, so `kiko-no-keychain-secret-into-usestate` MUST report a finding on
// each. Never "fix" this file.
import { useState } from 'react';

import { readCredentials } from '../../src/crypto-sync/binance/binance.credentials';
import { readToken } from '../../src/monobank/token';

export const FixtureBadAwaitForm = () => {
  const [credentials, setCredentials] = useState<unknown>(undefined);

  const load = async (): Promise<void> => {
    const stored = await readCredentials();
    setCredentials(stored);
  };

  return { credentials, load };
};

export const FixtureBadThenForm = () => {
  const [token, setToken] = useState('');

  readToken().then((existing) => {
    if (existing !== undefined) {
      setToken(existing);
    }
  });

  return token;
};
```

`rules/fixtures/kiko-no-keychain-secret-into-usestate.good.ts`:

```ts
// Semgrep fixture (NEGATIVE): the secret never reaches state — only a boolean
// existence probe and two literals do, and the reader's value is used and
// discarded inside an async handler. `kiko-no-keychain-secret-into-usestate`
// MUST report nothing here.
//
// Note for whoever edits this file: Semgrep's taint engine DOES propagate
// through an intervening call's return value, so
// `const info = await fetchClientInfo(token); setName(info.name);` WOULD be
// flagged (verified — the first draft of this fixture was). That is arguably
// correct: a value derived from a secret can leak the secret, and the rule is
// Class B / override-eligible precisely for those judgment calls. Keep the
// state updates here on literals.
import { useState } from 'react';

import { fetchClientInfo } from '../../src/monobank/monobank.client';
import { hasToken, readToken } from '../../src/monobank/token';

export const FixtureGoodExistenceProbe = () => {
  const [isTokenSaved, setIsTokenSaved] = useState(false);

  hasToken().then((exists) => {
    setIsTokenSaved(exists);
  });

  return isTokenSaved;
};

export const FixtureGoodTransientUse = () => {
  const [isConnected, setIsConnected] = useState(false);

  const refresh = async (): Promise<void> => {
    const token = await readToken();

    if (token === undefined) {
      setIsConnected(false);

      return;
    }

    await fetchClientInfo(token);
    setIsConnected(true);
  };

  return { isConnected, refresh };
};
```

- [ ] **Step 2: Run the runner to verify it fails**

Run: `bash scripts/checks/semgrep-rules.sh`
Expected: exit 2, `rule "kiko-no-keychain-secret-into-usestate" reported NOTHING on its positive fixture`.

- [ ] **Step 3: Add the rule**

Semgrep does not allow one rule id to mix `mode: taint` and ordinary patterns, so this ships as one taint rule plus one syntactic rule sharing a message. Append both to the Class B section of `rules/semgrep-mobile.yml`:

```yaml
  # Taint propagates through an intervening call's return value, so
  # `const info = await fetchClientInfo(token); setName(info.name)` is flagged
  # too (verified). That is intended, not a false positive — a value derived
  # from a secret can leak it — and it is why this is Class B / override-eligible
  # rather than a hard fail. Verified to report NOTHING on the real tree today.
  - id: kiko-no-keychain-secret-into-usestate
    languages: [typescript]
    severity: WARNING
    mode: taint
    message: >
      A Keychain secret is flowing into React state. A stored token or key must
      never be parked in the React tree — a jailbroken device or an attached
      debugger can read the JS heap, and a `secureTextEntry` field displays
      nothing anyway. Expose a boolean "saved" indicator instead and require
      re-entry, or use the value transiently inside the handler. If a case is
      genuinely safe, add an OVERRIDE(...) saying why.
    pattern-sources:
      - patterns:
          - pattern: $READ(...)
          - metavariable-regex:
              metavariable: $READ
              regex: ^(readToken|readCredentials|readDbKey)$
    pattern-sinks:
      - patterns:
          - pattern: $SET($X)
          - metavariable-regex:
              metavariable: $SET
              regex: ^set[A-Z]
  # Companion to the taint rule above. Semgrep 1.175's taint engine does not
  # propagate through a `.then(callback)` parameter — `pattern-propagators`
  # (from: $P, to: $V) and a `focus-metavariable: $V` source were both tried and
  # match nothing — and the deep-expression form `(($V) => { <... $SET($V) ...> })`
  # does not match either. The `.then` shape is exactly the one finding S5 found,
  # so it is flagged syntactically instead: routing a Keychain reader's result
  # through a promise callback in a component is the prefill anti-pattern, and
  # the project has no legitimate instance of it.
  - id: kiko-no-keychain-secret-through-then
    languages: [typescript]
    severity: WARNING
    message: >
      A Keychain reader's result is being routed through a `.then` callback.
      That is the prefill anti-pattern from security finding S5: the secret ends
      up in React state. Await it inside an async handler and use it transiently,
      or probe existence with a boolean helper (`hasToken`). If a case is
      genuinely safe, add an OVERRIDE(...) saying why.
    patterns:
      - pattern: $READ(...).then($F)
      - metavariable-regex:
          metavariable: $READ
          regex: ^(readToken|readCredentials|readDbKey)$
```

The negative fixture uses `hasToken().then(...)`, which neither rule matches (`hasToken` is not in the reader list, and it returns a boolean, not a secret).

Both patterns were validated empirically against these exact fixtures on Semgrep 1.175: 2 findings on the positive fixture (one per rule), 0 on the negative. They were also validated against the real tree, where the taint rule reports **nothing** and the `.then` rule reports exactly the one S5 call site (`monobank-token-field.component.tsx:39`) that Task 12 removes.

- [ ] **Step 4: Run the runner to verify it passes**

Run: `bash scripts/checks/semgrep-rules.sh`
Expected: silent, exit 0.

Both fixture files are named for the first rule id. The runner derives the rule ids it requires fixtures for **from the filenames present**, not from the rule file, so the companion rule needs no fixture of its own; it fires on the same positive fixture, and the runner's negative-fixture assertion ("no rule may match a `.good.` file") covers it there.

- [ ] **Step 5: Confirm the real tree is clean**

Run:

```bash
npm run check:security
```
Expected: silent, exit 0 — no Class B block either. Task 12 removed the only `readToken().then(...)` call site (`monobank-token-field.component.tsx:39`). If a Class B block does print, fix the call site; do not add `nosemgrep`.

- [ ] **Step 6: Record the rules**

Append to the 2026-09-06 table in `docs/harness/review-to-biome-inventory.md`:

```markdown
| `kiko-no-keychain-secret-into-usestate` | S5, H4 | Semgrep (TS, taint mode, WARNING/Class B) | Catches `const x = await readToken(); setX(x)`. |
| `kiko-no-keychain-secret-through-then` | S5, H4 | Semgrep (TS, WARNING/Class B) | Companion for `readToken().then(...)`, which Semgrep 1.175's taint engine cannot follow (propagators and `focus-metavariable` sources both verified not to work through a `.then` callback parameter). |
```

- [ ] **Step 7: Checkpoint**

Run: `npm run check:all`
Expected: green.

---

## Task 14: Keep `NSAllowsLocalNetworking` out of the Release plist (S7)

ATS is otherwise correct (`NSAllowsArbitraryLoads` is `false`), but `NSAllowsLocalNetworking: true` — a Metro dev-server convenience inherited from the React Native template — exempts `.local`, loopback, and link-local addresses from ATS in the shipped binary, where `AppDelegate.swift:125` loads the packaged `main.jsbundle` and no local host is ever contacted.

**Mechanism chosen: remove the key from the source plist, and re-inject it in Debug builds only, from a Run Script build phase.** This is the smallest mechanism that leaves a *checkable* source of truth: the source plist has no key at all, so Release cannot possibly carry it and `plist.sh` can assert absence flatly. The two rejected alternatives, for the record: a per-configuration `$(VAR)` substitution cannot express an ATS boolean (plist variable expansion is string-only, and `INFOPLIST_KEY_*` build settings do not reach nested dictionary keys); `INFOPLIST_PREPROCESS` with `#ifdef DEBUG` would make the source file invalid XML, breaking `plutil -lint` and every tool that parses it.

**Files:**
- Modify: `ios/Kiko/Info.plist:33-34`
- Modify: `ios/Kiko.xcodeproj/project.pbxproj` (new `PBXShellScriptBuildPhase` + its entry in the `Kiko` target's `buildPhases`)

- [ ] **Step 1: Delete the key from the source plist**

Remove lines 33-34 of `ios/Kiko/Info.plist`:

```xml
		<key>NSAllowsLocalNetworking</key>
		<true/>
```

Add a comment in its place, above `NSAllowsArbitraryLoads`, so the next reader does not "restore" it:

```xml
		<!-- NSAllowsLocalNetworking is deliberately ABSENT here. It exempts
		     .local / loopback / link-local from ATS and is only a Metro
		     dev-server convenience, so it must never ship in Release. The
		     "Inject Debug-only ATS local networking" build phase adds it back
		     into the built Info.plist for Debug configurations only. Asserted
		     by scripts/checks/plist.sh. -->
		<key>NSAllowsArbitraryLoads</key>
		<false/>
```

- [ ] **Step 2: Verify the plist still parses**

Run: `plutil -lint ios/Kiko/Info.plist`
Expected: `OK`.

- [ ] **Step 3: Add the Debug-only injection build phase**

In `ios/Kiko.xcodeproj/project.pbxproj`, add a new object inside the `/* Begin PBXShellScriptBuildPhase section */` … `/* End … */` block (insert it after the `Bundle React Native code and images` object at line 283-300). Pick any 24-character uppercase-hex id not already present in the file; this plan uses `A7C1D2E3F4A5B6C7D8E9F0A1` — grep first to confirm it is unused:

```
		A7C1D2E3F4A5B6C7D8E9F0A1 /* Inject Debug-only ATS local networking */ = {
			isa = PBXShellScriptBuildPhase;
			alwaysOutOfDate = 1;
			buildActionMask = 2147483647;
			files = (
			);
			inputPaths = (
			);
			name = "Inject Debug-only ATS local networking";
			outputPaths = (
			);
			runOnlyForDeploymentPostprocessing = 0;
			shellPath = /bin/sh;
			shellScript = "# NSAllowsLocalNetworking is absent from the source Info.plist on purpose\n# (it must never ship in Release). Metro needs it in Debug, so add it back\n# into the BUILT plist for Debug configurations only. Runs last, after\n# Info.plist processing and before code signing.\nset -e\nif [ \"${CONFIGURATION}\" != \"Debug\" ]; then\n  exit 0\nfi\nPLIST=\"${TARGET_BUILD_DIR}/${INFOPLIST_PATH}\"\n/usr/libexec/PlistBuddy -c \"Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true\" \"${PLIST}\" 2>/dev/null \\\n  || /usr/libexec/PlistBuddy -c \"Set :NSAppTransportSecurity:NSAllowsLocalNetworking true\" \"${PLIST}\"\n";
		};
```

Then add its id as the **last** entry of the `Kiko` target's `buildPhases` array (line 194-202), after `E8169A1CACF38CC8D9E5E450 /* Embed Foundation Extensions */`:

```
				A7C1D2E3F4A5B6C7D8E9F0A1 /* Inject Debug-only ATS local networking */,
```

Do not add it to the `KikoWidget` target — the extension has no ATS block and never talks to Metro.

- [ ] **Step 4 (ops): Verify the project still opens and both configurations behave**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/security-pass-fixes/ios

# The project must still parse
xcodebuild -workspace Kiko.xcworkspace -list

# Debug: the key must be present in the BUILT plist
xcodebuild -workspace Kiko.xcworkspace -scheme Kiko -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16' -derivedDataPath /tmp/kiko-dd-debug -quiet build
plutil -p /tmp/kiko-dd-debug/Build/Products/Debug-iphonesimulator/Kiko.app/Info.plist \
  | grep -A2 NSAppTransportSecurity

# Release: the key must be ABSENT from the built plist
xcodebuild -workspace Kiko.xcworkspace -scheme Kiko -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/kiko-dd-release -quiet build
plutil -p /tmp/kiko-dd-release/Build/Products/Release-iphonesimulator/Kiko.app/Info.plist \
  | grep NSAllowsLocalNetworking; echo "grep exit: $?  (1 = correctly absent)"
```

Expected: Debug shows `"NSAllowsLocalNetworking" => 1`; Release's grep exits 1 (no match).

- [ ] **Step 5 (ops): Named manual verification — Metro still connects in Debug**

Run the Debug build on the simulator with Metro running (`npm start`). **Expected:** the app loads the bundle from Metro and Fast Refresh works. If it does not, the injection phase did not run early enough relative to Info.plist processing — move it one position earlier in `buildPhases` and re-verify; do not solve it by putting the key back in the source plist.

Record the result in the task notes.

- [ ] **Step 6: Checkpoint**

Run: `npm run check:all`
Expected: green (`check:plist` currently only asserts pinning; Task 16 adds the assertion that locks this in).

---

## Task 15: Delete the empty `NSLocationWhenInUseUsageDescription` (S8)

The app requests no location anywhere, and an **empty** purpose string is a well-known App Store review rejection trigger — directly relevant with publishing next on the backlog.

**Files:**
- Modify: `ios/Kiko/Info.plist:62-63`

- [ ] **Step 1: Verify no pod actually needs it**

Run:

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/security-pass-fixes
grep -rl "CLLocationManager\|CoreLocation" ios/Pods --include='*.h' --include='*.m' --include='*.mm' --include='*.swift' | head
grep -rn "NSLocationWhenInUseUsageDescription" ios/Pods ios/Podfile ios/Podfile.lock | head
grep -rni "location" src App.tsx --include='*.ts' --include='*.tsx' | grep -vi "allocation\|relocation\|location.pathname" | head
```

Expected: no pod source references `CLLocationManager`/`CoreLocation`, no pod declares the key, and no app source uses location. **If a pod does appear**, do not delete the key — supply a real, honest purpose string naming that pod and record why in `docs/security/README.md`, then skip Step 2. Record the grep output in the task notes either way.

- [ ] **Step 2: Delete the key**

Remove lines 62-63 of `ios/Kiko/Info.plist`:

```xml
	<key>NSLocationWhenInUseUsageDescription</key>
	<string></string>
```

`NSFaceIDUsageDescription` (lines 60-61) stays — it is real and non-empty, and `BIOMETRY`-backed Keychain reads SIGABRT-crash without it.

- [ ] **Step 3: Verify**

Run:

```bash
plutil -lint ios/Kiko/Info.plist
plutil -extract NSLocationWhenInUseUsageDescription raw -o - ios/Kiko/Info.plist; echo "exit: $? (1 = correctly absent)"
plutil -extract NSFaceIDUsageDescription raw -o - ios/Kiko/Info.plist
```

Expected: `OK`; the location extract exits non-zero; the Face ID string prints.

- [ ] **Step 4 (ops): Verify the app still builds and Face ID still works**

Build to the simulator and confirm the app launches. Then, on the device build, confirm the app-lock unlock prompt still appears (the Face ID key is untouched, but this is the crash the `biometric-keychain-needs-nsfaceidusagedescription` memory note records, so it is worth one look).

- [ ] **Step 5: Checkpoint**

Run: `npm run check:all`
Expected: green.

---

## Task 16: Extend `plist.sh` with the Release hardening assertions (H6)

Locks in Tasks 14 and 15 and reinforces Task 7. Four assertions on `ios/Kiko/Info.plist`: `NSAllowsArbitraryLoads` is false; `NSAllowsLocalNetworking` is absent; no `NS*UsageDescription` key holds an empty string; and the Debug-only injection build phase still exists, so "Metro broke" cannot be fixed by quietly putting the key back in the source plist.

**Files:**
- Modify: `scripts/checks/plist.sh`
- Modify: `docs/harness/review-to-biome-inventory.md`

**Interfaces:**
- Consumes: `scripts/checks/plist.sh` from Task 8; the plist state from Tasks 7, 14, 15; the build phase name from Task 14.

- [ ] **Step 1: Add the assertions**

Insert into `scripts/checks/plist.sh`, between the H3 block and the `if [ -n "$problems" ]` block:

```bash
# --- 2. Release ATS hardening (H6) -------------------------------------------
arbitrary="$(plutil -extract NSAppTransportSecurity.NSAllowsArbitraryLoads raw -o - "$PLIST" 2>/dev/null)"
if [ "$arbitrary" != "false" ]; then
  add_problem "NSAppTransportSecurity.NSAllowsArbitraryLoads must be <false/> (found: '${arbitrary:-missing}')"
fi

# Absent from the SOURCE plist on purpose: it is a Metro convenience that must
# never ship in Release. The "Inject Debug-only ATS local networking" build
# phase adds it back for Debug builds only.
if plutil -extract NSAppTransportSecurity.NSAllowsLocalNetworking raw -o - "$PLIST" >/dev/null 2>&1; then
  add_problem "NSAppTransportSecurity.NSAllowsLocalNetworking is present in ios/Kiko/Info.plist; it must exist only in Debug builds, injected by the build phase"
fi

if ! grep -q 'Inject Debug-only ATS local networking' "$ROOT/ios/Kiko.xcodeproj/project.pbxproj"; then
  add_problem "the 'Inject Debug-only ATS local networking' build phase is missing from ios/Kiko.xcodeproj/project.pbxproj; Debug builds cannot reach Metro without it, and removing it invites putting NSAllowsLocalNetworking back into the shipped plist"
fi

# --- 3. No empty purpose string (H6) -----------------------------------------
# An empty NS*UsageDescription advertises a capability with no stated reason and
# is a known App Store review rejection trigger.
empty_purposes="$(plutil -convert json -o - "$PLIST" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{
    const j=JSON.parse(s);
    const bad=Object.keys(j).filter(k=>/^NS.*UsageDescription$/.test(k) && String(j[k]).trim()==="");
    process.stdout.write(bad.join(", "));
  }catch{process.stdout.write("")}
})')"
if [ -n "$empty_purposes" ]; then
  add_problem "empty NS*UsageDescription key(s) in ios/Kiko/Info.plist: $empty_purposes — delete the key, or give it a real purpose string and record why in docs/security/README.md"
fi
```

Broaden the failure block's WHY text to cover both concerns:

```bash
    "The plist is the app's ATS, pinning, and privacy-declaration policy. An unpinned credential-bearing host can be MITM'd by any device-trusted CA; NSAllowsLocalNetworking in a Release build exempts .local/loopback from ATS in the shipped binary; an empty NS*UsageDescription is an App Store review rejection trigger. See docs/security/README.md." \
```

- [ ] **Step 2: Prove each assertion bites**

One at a time, make the breaking edit, run `bash scripts/checks/plist.sh`, confirm exit 2 with the right message, then revert:

1. Set `NSAllowsArbitraryLoads` to `<true/>` → expect the arbitrary-loads message.
2. Re-add `<key>NSAllowsLocalNetworking</key><true/>` to the source plist → expect the local-networking message.
3. Rename the build phase in `project.pbxproj` → expect the build-phase message.
4. Re-add `<key>NSLocationWhenInUseUsageDescription</key><string></string>` → expect the empty-purpose message.

After reverting all four:

Run: `bash scripts/checks/plist.sh`
Expected: silent, exit 0.

- [ ] **Step 3: Record the rule**

Append to the 2026-09-06 table in `docs/harness/review-to-biome-inventory.md`:

```markdown
| `plist.sh` — Release ATS hardening | S7, S8, H6 | Shell assertion (`scripts/checks/plist.sh`) | `NSAllowsArbitraryLoads` false; `NSAllowsLocalNetworking` absent from the source plist; the Debug-injection build phase present; no empty `NS*UsageDescription`. |
```

- [ ] **Step 4: Checkpoint**

Run: `npm run check:all`
Expected: green.

---

## Task 17: Make `readCredentials` a pure read (S6)

`readCredentials` calls `saveCredentials(value)` unconditionally on every read, so every pull-to-refresh and every crypto sync performs a full Keychain write of the API key and secret. The doc comment describes it as a one-time migration off the old `BIOMETRY_CURRENT_SET` policy, but there is no gate. It also makes the read path non-idempotent, unlike `readToken` and `readDbKey`. Gate the re-save on a module-level once-per-process marker — no new schema column, no migration.

**Files:**
- Modify: `src/crypto-sync/binance/binance.credentials.ts:34-59`
- Modify: `src/crypto-sync/binance/binance.credentials.test.ts`

- [ ] **Step 1: Write the failing test first**

In `src/crypto-sync/binance/binance.credentials.test.ts`, add (adapting the mock names to the file's existing Keychain mock):

```ts
  it('re-saves the pair at most once per process, so a read is otherwise pure', async () => {
    mockGetGenericPassword.mockResolvedValue({
      username: 'binance',
      password: JSON.stringify({ apiKey: 'k', secret: 's' }),
    });

    await readCredentials();
    await readCredentials();
    await readCredentials();

    expect(mockSetGenericPassword).toHaveBeenCalledTimes(1);
  });
```

Because the marker is module-level process state, this test must run in a module registry that has not already tripped it. Put it in its own `describe` and start it with `jest.resetModules()` plus a re-`require` of the module, or use `jest.isolateModules`, matching whatever the file already does. If the file has no such pattern, use:

```ts
  it('re-saves the pair at most once per process, so a read is otherwise pure', async () => {
    jest.resetModules();
    const { readCredentials: freshRead } = require('./binance.credentials');
    mockGetGenericPassword.mockResolvedValue({
      username: 'binance',
      password: JSON.stringify({ apiKey: 'k', secret: 's' }),
    });

    await freshRead();
    await freshRead();
    await freshRead();

    expect(mockSetGenericPassword).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/crypto-sync/binance/binance.credentials.test.ts`
Expected: FAIL — `Expected number of calls: 1, Received number of calls: 3`.

- [ ] **Step 3: Gate the re-save**

In `src/crypto-sync/binance/binance.credentials.ts`, add above `readCredentials`:

```ts
/**
 * Once-per-process latch for the legacy-policy re-save below. A module-level
 * marker rather than a persisted flag: the re-save is idempotent and cheap, so
 * paying for it once per app launch is fine, and a new `settings` column plus a
 * migration would be a lot of machinery for a one-off. Reset only by a fresh
 * process (or `jest.resetModules()` in a test).
 */
let hasRepairedAccessPolicy = false;
```

and change the tail of `readCredentials` (line 56):

```ts
  // Repair an item written before the hardening shipped (it still carries the
  // old per-read `BIOMETRY_CURRENT_SET` control). Gated so a READ stays a read:
  // this used to run on every single call, turning every pull-to-refresh and
  // every crypto sync into a full Keychain write of the API key and secret — a
  // routine read path that could disturb stored credentials if a write failed
  // partway. `readToken` and `readDbKey` are pure; this now matches them after
  // the first call.
  if (!hasRepairedAccessPolicy) {
    hasRepairedAccessPolicy = true;
    await saveCredentials(value);
  }

  return value;
```

Also update the function's doc comment (lines 34-41) so "it is re-saved under the hardened, prompt-free policy" reads "it is re-saved once per process under the hardened, prompt-free policy".

Set the latch in `saveCredentials` too, so an explicit save also satisfies it:

```ts
/** Store the pair as ONE JSON Keychain item under the hardened policy above. */
export const saveCredentials = async (credentials: BinanceCredentials): Promise<void> => {
  await Keychain.setGenericPassword('binance', JSON.stringify(credentials), HARDENED);
  hasRepairedAccessPolicy = true;
};
```

(declare `hasRepairedAccessPolicy` above `saveCredentials` so both see it).

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/crypto-sync/`
Expected: PASS — including every pre-existing case in that file.

- [ ] **Step 5: Checkpoint**

Run: `npm run check:all` then `npx jest`
Expected: green.

---

## Task 18: Record the BTC explorer privacy trade-off (S9)

Every BTC sync sends the user's Bitcoin address to Blockstream, which learns `(address, source IP, timestamp)` and can build a timeline correlating a specific wallet with a specific network location. That is inherent to using a public explorer and is a reasonable engineering choice — but it appears nowhere in the accepted-risk register. Documentation only; no code change.

**Files:**
- Modify: `docs/security/README.md` (accepted-risk register)

- [ ] **Step 1: Add the accepted risk**

Append to the "## Accepted risks (not mitigated by design)" list:

```markdown
- **Every BTC sync discloses the wallet address to `blockstream.info`.**
  `src/crypto-sync/btc-wallet/btc-wallet.client.ts:33` requests
  `${BTC_EXPLORER_ENDPOINT}/address/<address>` on every sync, so Blockstream
  learns `(address, source IP, timestamp)` and can correlate a specific wallet
  with a specific network location over time. Accepted: a public Esplora
  explorer is the only practical way to read an on-chain balance without running
  a node, and the address itself is public data by design (it is deliberately
  kept out of the Keychain — `btc-wallet.provider.ts:11-16`). The host is
  unpinned because the call carries no secret; an active MITM can forge
  `chain_stats` and misreport the balance, which is a correctness, not a
  confidentiality, risk. If the privacy cost is ever judged too high the
  alternatives are a user-configurable explorer endpoint or a self-hosted
  Esplora instance — both larger changes than this warrants today. The address
  is format-validated before use (`bitcoin-address.ts:7-11`) and URL-encoded at
  the call site, so it cannot be used to inject a path.
```

- [ ] **Step 2: Checkpoint**

Run: `npm run check:all`
Expected: green.

---

## Task 19: Bring the accepted-risk register in line with the code (§5 closing task)

The audit's §5 lists two stale entries and four missing ones. Tasks 7, 9 and 18 already handled the pinning wording, the app-lock limitation, the legacy column, and the explorer disclosure. This closing task adds the two remaining register entries (the widget snapshot, and `NSAllowsLocalNetworking` — now recorded as *fixed*, not accepted), plus the S11 next-steps pointer, and verifies the whole register against the code one last time.

**Files:**
- Modify: `docs/security/README.md`

- [ ] **Step 1: Add the widget-snapshot entry**

Append to the accepted-risks list (this is a *residual* risk after Tasks 1-4, stated honestly):

```markdown
- **The widget's App Group snapshot is a cleartext derivative of encrypted
  data.** `ios/Kiko/WidgetBridge.swift` writes `net-worth-snapshot.json` into
  the `group.com.dmytro.pff` container so the `KikoWidget` extension — a
  separate process that can neither open the SQLCipher database nor run app
  JavaScript — has something to render. Four controls bound it, and the residual
  risk is stated after them:
  - **Minimised payload.** The snapshot carries only what the widget actually
    draws: `baseCurrency`, the formatted total, and the per-currency breakdown.
    The 30-day trend series it used to carry was removed on 2026-09-06 — the
    widget stopped rendering a trend line, so it was a wealth history on disk
    with no reader. Do not add a field the SwiftUI view does not render.
  - **Redaction.** Every money-bearing subview in
    `ios/KikoWidget/NetWorthWidgetView.swift` is `.privacySensitive()`, so
    WidgetKit redacts the total and the breakdown on a locked device (Lock
    Screen Today View, StandBy). The "Net worth" label stays visible.
  - **Lock-aware lifecycle.** When `settings.lockEnabled` is on,
    `src/widget/use-net-worth-widget.ts` calls `widgetBridge.clearSnapshot()`
    instead of writing, on every debounce tick and on every background
    transition, so there is no real snapshot on disk at all while the lock is
    enabled; the widget renders its placeholder. Turning the lock off rewrites
    it on the next tick.
  - **At-rest attributes.** Every write re-applies `isExcludedFromBackup` (so
    the file never enters an iCloud/iTunes backup — the leak F2 closed for the
    database) and an explicit
    `FileProtectionType.completeUntilFirstUserAuthentication`. Both must be
    re-applied after every write: `atomically: true` replaces the inode and
    drops them. `.complete` is not usable — it would make the file unreadable
    exactly when WidgetKit renders.

  **Residual risk, accepted.** With the app lock OFF (the default), the file
  exists in plain JSON and is readable after first unlock without any Keychain
  access, so a jailbroken or forensically-imaged device yields the net worth and
  currency composition, whereas the database would require the
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` key. That is the unavoidable cost of having a
  widget at all: the extension has no way to hold a key. A user who wants that
  closed enables the app lock. Enforced by
  `kiko-widget-money-view-needs-privacysensitive` and
  `kiko-appgroup-write-needs-protection` in `rules/semgrep-mobile.yml`.
```

- [ ] **Step 2: Record `NSAllowsLocalNetworking` as fixed, not accepted**

Add a short "## Fixed since the last audit" section immediately before "## Accepted risks":

```markdown
## Fixed since the 2026-09-06 audit

- **`NSAllowsLocalNetworking` no longer ships.** It is absent from
  `ios/Kiko/Info.plist` and re-injected into the built plist for Debug
  configurations only, by the "Inject Debug-only ATS local networking" build
  phase, so Metro still works in development while the Release binary carries no
  local-network ATS exemption. Asserted by `npm run check:plist`.
- **The empty `NSLocationWhenInUseUsageDescription` was deleted.** The app uses
  no location API and no pod requires one; an empty purpose string is an App
  Store review rejection trigger. Asserted by `npm run check:plist`.
```

- [ ] **Step 3: Add the "next steps" pointer for S11**

Add a short section at the end of `docs/security/README.md`:

```markdown
## Next steps

- **Distribution signing across both targets (audit finding S11, INFO).** The
  `Kiko` target's Release block sets `CODE_SIGN_IDENTITY = "Apple Development"`,
  and the `KikoWidget` extension target's Release block sets no explicit
  identity at all and inherits. Both must become a distribution identity, with
  the App Group capability provisioned on both targets, before the first App
  Store upload. Out of scope for the security pass — it is tracked and belongs
  to `docs/superpowers/plans/2026-09-04-app-store-publishing.md`; do that plan's
  signing steps across **both** targets, not just the app.
```

- [ ] **Step 4: Re-verify the whole register against the code**

Read `docs/security/README.md` end to end and confirm each claim against the file it cites. Specifically re-check the four entries the audit verified as still accurate (jailbreak detection; legacy-service token migration at `src/monobank/token.ts:62`; migration ordering at `src/db/encrypted-database.ts:95-113`; `randomblob()` at `src/db/keys/db-key.ts:35-46`; raw IBAN at `src/monobank/sync.ts:130`) and that the pinning host table matches `NSPinnedDomains` exactly:

```bash
plutil -extract NSAppTransportSecurity.NSPinnedDomains raw -o - ios/Kiko/Info.plist
grep -n "api.monobank.ua\|api.binance.com\|api.coingecko.com\|blockstream.info\|bank.gov.ua" docs/security/README.md
```

Fix any drift you find. Record what you checked in the task notes.

- [ ] **Step 5: Checkpoint**

Run: `npm run check:all`
Expected: green.

---

## Task 21: Show "---" for every money value while the device is locked (user decision, 2026-09-07)

Coordinator-authored from the user's instruction: "On lock screen replace all values with ---". Supersedes the visual outcome of Task 1 (WidgetKit's default redaction bars) while keeping its security property (no balance is drawn while the device is locked).

**Files:**
- Modify: `ios/KikoWidget/NetWorthWidgetView.swift` (the total in `content(for:)` and each amount in `breakdownColumn(_:)`)
- Modify: `docs/security/README.md` (the S2/widget accepted-risk or control entry: state that a locked device shows `---` in place of every amount)
- Modify: `docs/superpowers/plans/2026-09-06-security-pass-fixes.md` (append this task's text verbatim as "## Task 21" after Task 19 and before "## Task 20: Verification before completion" is executed; keep Task 20 last)
- Possibly modify: `rules/fixtures/kiko-widget-money-view-needs-privacysensitive.good.swift` — add the new shape as an accepted case so the H1 rule is proven to tolerate it

**Behavior:**
- Read `@Environment(\.redactionReasons) private var redactionReasons` in `NetWorthWidgetView`.
- When `redactionReasons.contains(.privacy)` (WidgetKit sets this on a locked device), render the literal string `---` in place of the total's formatted amount and in place of each breakdown row's formatted amount. Mark that `---` text `.unredacted()` so WidgetKit does not turn it into a bar. Keep the "Net worth" label and the currency codes visible and unchanged.
- Otherwise render the real value exactly as today, with `.privacySensitive()` kept on the money view (defense in depth: if the environment check is ever bypassed, WidgetKit still redacts).
- Put the branch in one small private helper (for example `moneyText(_ formatted: String, isNegative: Bool, size: CGFloat, ...)`) used by both call sites, so the total and the rows cannot diverge. The negative-red foreground applies only to real values; `---` uses the normal white.
- Never log the snapshot.

**Verification:**
- `cd ios && xcodebuild -workspace Kiko.xcworkspace -scheme Kiko -configuration Debug -destination 'generic/platform=iOS Simulator' -quiet build` succeeds.
- `npm run check:rules` and `npm run check:security` stay silent (the H1 rule must still see `Text(<money member>)` inside a `.privacySensitive()` chain on the real view and produce 0 findings).
- `npm run check:all` silent.
- Device check (deferred to Task 20): lock the device, open Today View — the widget shows "Net worth", the currency codes, and `---` for every amount; unlock — the numbers return.

**Checkpoint:** `npm run check:all`.

---

## Task 20: Verification before completion

REQUIRED SUB-SKILL: `superpowers:verification-before-completion`. Nothing is committed. The user reviews the diff.

- [ ] **Step 1: Full harness, fast + medium tiers**

Run: `npm run check:all`
Expected: silent, exit 0 — lint, dup, knip, deps, security, **rules**, **plist**, secrets, overrides.

If `check:knip` fails, delete the export that lost its last consumer. If `check:deps` fails, fix the dependency. If `check:security` prints a Class B block, fix the call site. Never weaken a check.

- [ ] **Step 2: Full test suite**

Run: `npx jest`
Expected: all suites pass. New or changed suites in this plan:
`src/widget/net-worth-snapshot.test.ts`, `src/widget/use-net-worth-widget.test.ts`,
`src/widget/widget-bridge.test.ts`, `src/db/settings-columns.test.ts`,
`src/db/db-config.test.ts`, `src/monobank/token.test.ts`,
`src/screens/account-detail/monobank-token-field/monobank-token-field.component.test.tsx`,
`src/crypto-sync/binance/binance.credentials.test.ts`,
`src/i18n/locales/en.uk.parity.test.ts`.

- [ ] **Step 3: Rule fixtures explicitly**

Run: `npm run check:rules` and `npm run check:plist`
Expected: both silent. This is the check that the four new Semgrep rules and the plist assertions actually still fire — a rule that quietly stopped matching reads as a pass everywhere else.

- [ ] **Step 4: Deep tier**

Run: `npm run check:deep`
Expected: mutation score at or above 60 (the `break` threshold), then osv-scanner.

`osv-scanner` will still report exactly three known advisories and no more — `GHSA-5p2g-fcmc-qvqq` and `GHSA-w3rx-r6r6-pgpr` (`image-size` 1.2.1) and `GHSA-vcc3-ghjq-m6fr` (`decode-uri-component` 0.2.2). Those are the accepted debt recorded in `CLAUDE.md`. **A fourth advisory is a real regression** — investigate it, do not suppress it.

If mutation score dropped below 60, add the missing test rather than lowering the threshold. The new tests in this plan (`settings-columns`, `db-config`, the widget lock branch) should raise it, not lower it.

- [ ] **Step 5: Native build, both configurations**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/security-pass-fixes/ios
xcodebuild -workspace Kiko.xcworkspace -scheme Kiko -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16' -quiet build
xcodebuild -workspace Kiko.xcworkspace -scheme Kiko -configuration Release \
  -destination 'generic/platform=iOS' -quiet build
```

Expected: `BUILD SUCCEEDED` twice, with the `KikoWidget` extension embedded in both. If a clean of `ios/build` happened at any point, re-run `pod install` first — deleting it wipes the ReactCodegen generated sources and the build fails on a missing `States.cpp`.

- [ ] **Step 6: Collect the named manual verifications**

Confirm each ops verification in this plan was actually run and its result recorded, since none of them has a unit test:
- Task 1 Step 5 — lock-screen redaction on device.
- Task 3 Step 9 — placeholder appears when the app lock is on; snapshot file gone.
- Task 4 Step 4 — `xattr` shows the backup-exclusion attribute.
- Task 7 Step 5 — Binance sync succeeds pinned, fails with corrupted pins.
- Task 14 Steps 4-5 — key present in the Debug built plist, absent in Release; Metro connects.
- Task 15 Step 4 — app launches; Face ID unlock still works.

Any that was skipped must be run now.

- [ ] **Step 7: Report, do not commit**

Leave the tree uncommitted. Report to the coordinator: every task's status, each ops verification's result, the `check:deep` mutation score, and the exact `osv-scanner` advisory list. Note anything that could not be verified and why.

---

## Self-review notes (for the executor)

- **Rules that were deliberately NOT written**, with the reason, so nobody "completes" them later by adding a noisy rule: H3's Semgrep half (Semgrep cannot read the plist, so the rule can only fire forever on known-good clients — the `plist.sh` assertion in Task 8 carries the whole intent, more precisely). Recorded in `docs/harness/review-to-biome-inventory.md` by Task 8 Step 4.
- **Rules whose shape was constrained by the tool**, verified empirically against Semgrep 1.175, not assumed: H2 is file-scoped because `pattern-inside: func $F(...) { ... }` matches nothing in Swift; H4 needs a companion syntactic rule because taint mode does not propagate through a `.then` callback parameter. Both constraints are written into the rule comments and the inventory so a future agent does not "simplify" them back into something that silently matches nothing.
- **S11 is out of scope** for this plan by decision. Task 19 Step 3 records the pointer only.
- **Type consistency check:** `NetWorthSnapshot` loses `trend` in Task 2 and is consumed with that exact shape in Tasks 3 and 19; `widgetBridge.clearSnapshot()` is introduced in Task 3 and referenced in Tasks 4 and 19; `hasToken()` is introduced in Task 12 and referenced in Task 13's negative fixture; `scripts/checks/plist.sh` is created in Task 8 and extended in Task 16; `rules/fixtures/` and `npm run check:rules` are created in Task 5 and reused in Tasks 6 and 13.
