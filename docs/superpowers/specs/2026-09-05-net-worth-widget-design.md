# iOS net worth widget (Medium 4x2) — design spec

Date: 2026-09-05
Status: approved, pending implementation plan
Scope owner: Kiko coordinator

## Overview

Add an iOS home-screen widget that shows the user's net worth. Scope
for this spec is the Medium (`systemMedium`, 4x2) family only. It
mirrors the net worth block on the home screen: the "Net worth"
label, the total in the base currency, the per-currency breakdown,
and a mini trend line.

## Approved decisions

- Only the Medium (4x2) family is in scope now. Small, Large, and
  lock-screen accessory families are out of scope for this spec.
- A widget runs in a separate extension process. It cannot run the
  app JavaScript and cannot open the op-sqlite database. The app must
  write a snapshot to a shared App Group store; the widget reads that
  snapshot.
- One snapshot builder is extracted in TypeScript from the existing
  net worth computation, so the home screen and the widget writer use
  the same numbers and never drift.

## Architecture

- Add one iOS app extension target, `KikoWidget` (WidgetKit +
  SwiftUI), to `ios/Kiko.xcodeproj`.
- Add an App Group entitlement to BOTH the main app target and the
  `KikoWidget` extension. This shared container is where the snapshot
  lives.
- Snapshot store: a JSON payload in the App Group container (a file
  in the shared container, or a shared `UserDefaults` suite). The
  snapshot holds: `baseCurrency`, net worth total (both formatted
  string and minor units), the per-currency breakdown (array of
  `{currency, minorUnits}`), the trend points (array of numbers or
  `{time, value}` for the mini line), and `updatedAt` (epoch ms).
- Add a native bridge module (Swift + TypeScript types) with two
  methods: `writeSnapshot(json)` writes the snapshot to the App Group
  container; `reloadWidget()` calls
  `WidgetCenter.shared.reloadAllTimelines()`.
- Reference existing computation to reuse, do not duplicate its math:
  - `src/rates/net-worth-view.ts` (`guardedNetWorth`, `buildRateTable`)
  - `src/rates/currency-totals.ts` (`sumByCurrency`) for the
    breakdown
  - `src/statistics/net-worth-series.ts` for the trend points
  - `src/screens/home/home.screen.tsx` around line 189-202 shows how
    the screen composes `baseCurrency`, `rateTable`,
    `activeHoldings`, `total`, and `breakdown` today. The
    active-holding filter (open holding AND non-archived parent
    account) must be applied identically in the snapshot builder.
    Read the file at that location for the current exact filter
    expression rather than relying on this description, since the
    filter is app logic that can change independently of this spec.

## Components

- `net-worth-snapshot.ts` (new, TypeScript): a PURE builder that
  takes holdings, rates, settings (and the net worth series input)
  and returns the snapshot shape. It reuses `guardedNetWorth` and
  `sumByCurrency`; it must not re-implement net worth.
- `WidgetBridge` (new native module: Swift + a TypeScript typed
  wrapper): `writeSnapshot(json)` and `reloadWidget()`.
- `KikoWidget` extension (new Swift target): a `TimelineProvider`, a
  `TimelineEntry` carrying the decoded snapshot, and the Medium
  SwiftUI view (label, total, breakdown, mini trend line drawn with
  Swift Charts or a `Path`).
- An app-side effect/hook that recomputes the snapshot when the
  underlying live data (holdings, `currency_rates`, settings,
  transactions) changes and calls `writeSnapshot` then
  `reloadWidget`. Debounce if needed. Also write on app background.

## Data flow

1. App live queries produce holdings, rates, settings, and the
   transaction history feeding the trend series.
2. `net-worth-snapshot.ts` builds the snapshot.
3. `WidgetBridge.writeSnapshot` writes the JSON to the App Group
   container.
4. `WidgetBridge.reloadWidget` triggers a timeline reload.
5. The widget's `TimelineProvider` reads the JSON and renders the
   Medium layout.

## Error handling

- No snapshot yet (fresh install, before the first write): the
  widget shows a placeholder, for example "Open Kiko".
- A missing rate pair: the snapshot uses `guardedNetWorth`, which
  already excludes a holding whose rate pair is missing, so there is
  never a crash and never a partial-rate total.
- Fewer than two trend points: the widget omits the line and shows
  the total only.
- A malformed or unreadable snapshot file: the widget falls back to
  the placeholder.

## Testing

- TypeScript unit tests for `net-worth-snapshot.ts`: it matches
  `guardedNetWorth` for the total, produces the correct per-currency
  breakdown, applies the same active-holding filter as the home
  screen, and handles the empty/first-run case.
- On-device verification after an ops build (add the widget to the
  home screen and confirm it renders). Jest alone cannot verify the
  widget. Do NOT screenshot the simulator for design review; rebuild
  and let the user review live (project rule).

## Scope/risks

- This adds an Xcode extension target, an App Group entitlement, and
  a native module. It touches `ios/` and provisioning/signing. It is
  real native work, not JavaScript-only. The build and target setup
  are an ops task.
- The widget shows a snapshot, not live data. Freshness depends on
  the app writing the snapshot and iOS honoring the reload request;
  iOS budgets widget refreshes.

## Out of scope

- Small, Large, and lock-screen accessory widget families.
- Any interactive widget controls.
- A configuration (`AppIntent`) UI for the widget.
