---
name: kiko-widget
description: Invoke when touching the widget, src/widget/net-worth-snapshot.ts, the App Group, or the WidgetBridge native module.
---

# Kiko widget

Source of truth for the plan/spec: `docs/superpowers/plans/2026-09-05-net-worth-widget.md`
("Task 6", "Task 7"). This skill states the settled, as-built contract
and the non-obvious "why" behind it — it does not restate the plan.

## The hard constraint: separate process, no live DB, no JS

The `KikoWidget` WidgetKit extension (`ios/KikoWidget/`) runs in a
**separate extension process** from the app. It cannot open the
app's op-sqlite database and it cannot run any app JavaScript
(`useLiveQuery`, repositories, the RN bridge — none of it exists in
that process). Never design a widget feature that assumes it can
read live app state; it can't.

## Data path: app writes a snapshot, extension reads it

The only channel between the two processes is a JSON file in a
shared App Group container:

1. **Build**: `buildNetWorthSnapshot` in `src/widget/net-worth-snapshot.ts`
   is the SINGLE source of truth for the widget's numbers. It shares
   the app's own net-worth math — `guardedNetWorth` and
   `sumByCurrency` (from `src/rates/net-worth-view.ts` and
   `src/rates/currency-totals.ts`) over the same active-holding filter
   the rest of the app uses (`src/rates/active-holdings.ts`). Never
   recompute net worth independently in the widget path — always
   route through this builder, on both the assembly side
   (`src/widget/use-net-worth-widget.ts`'s `assembleSnapshot`) and any
   future consumer. See `net-worth-snapshot.ts` for the exact shape of
   `NetWorthSnapshot` — do not copy the field list here; read it
   there.
2. **Trigger + write**: `src/widget/use-net-worth-widget.ts`
   (`useNetWorthWidget`) runs the same live queries the Statistics
   screen uses, assembles a snapshot, and writes it — debounced (see
   the debounce constant in that file) and also immediately whenever
   the app backgrounds. It writes through
   `src/widget/widget-bridge.ts` (`widgetBridge.writeSnapshot`, then
   `widgetBridge.reloadWidget`), which is a thin, no-op-when-unavailable
   wrapper over the native `WidgetBridge` module.
3. **Native write + reload**: `ios/Kiko/WidgetBridge.swift` (+ the
   `RCT_EXTERN_MODULE`/`RCT_EXTERN_METHOD` bridging macros in
   `WidgetBridge.m`) writes the raw snapshot JSON into the App Group
   container, then calls `WidgetCenter.shared.reloadAllTimelines()`.
   Never log the snapshot JSON — it encodes the user's net worth.
4. **Extension read**: `ios/KikoWidget/NetWorthSnapshot.swift`
   (`SnapshotLoader.load()`) reads that same file from the App Group
   container and decodes it. `ios/KikoWidget/NetWorthWidget.swift`
   holds the `TimelineProvider`/`TimelineEntry` and the periodic
   refresh policy; `NetWorthWidgetView` renders it.

**Consequence**: the widget always shows a snapshot, never live
data. Its freshness is bounded both by when the app last wrote (app
must be foregrounded or just backgrounded) and by iOS's own
widget-refresh budget for the periodic `TimelineProvider` refresh —
`reloadAllTimelines()` after a write is the fast path, the periodic
timeline is only a safety net for time passing.

## The Swift/TS contract must stay in lockstep

`ios/KikoWidget/NetWorthSnapshot.swift` defines a Swift `Codable`
struct that mirrors the TS `NetWorthSnapshot` type in
`src/widget/net-worth-snapshot.ts` field-for-field. If you change one
side, change the other in the same commit and re-verify by reading
both files side by side — there is no shared schema generation
between TS and Swift here, so nothing else will catch a drift.
Non-obvious mismatch to preserve: the TS `trend[].value` (and the
Swift `TrendPoint.value`) is a **major-unit float** (e.g. `12345.67`,
not minor units) — do not "fix" it to an `Int`/minor-units without
updating the builder too.

## App Group: two targets, one identifier

The App Group entitlement must exist on **both** the `Kiko` app
target and the `KikoWidget` extension target, with the identical
identifier on each, in the form `group.<bundle-id>`. Do not read the
concrete value from this skill — read it from
`ios/Kiko/Kiko.entitlements` and `ios/KikoWidget/KikoWidget.entitlements`
(both must match each other and the constant `WidgetBridge.swift`
and `NetWorthSnapshot.swift` use). If the two entitlement files ever
disagree, or either app's bundle id changes, the container lookup on
one side silently returns `nil` and the widget falls back to its
placeholder — there is no crash to signal the break, so check the
entitlement files directly when the widget stops updating.

## Widget family: systemMedium only

`ios/KikoWidget/NetWorthWidget.swift`'s `.supportedFamilies([...])`
call is the source of truth for which WidgetKit family(ies) this
widget supports — currently a single family. Read it there rather
than assuming; do not add another family without updating both the
supported-families list and `NetWorthWidgetView`'s layout, which is
sized for that one family only.

## Signing

Both the `Kiko` app target and the `KikoWidget` extension target use
automatic code signing (`CODE_SIGN_STYLE = Automatic` in
`ios/Kiko.xcodeproj/project.pbxproj`, one setting per
build-configuration block per target). Provisioning the App Group
capability and the extension's own bundle id was done non-interactively
via `xcodebuild ... -allowProvisioningUpdates` (team-based, no manual
portal step) rather than by hand-managing profiles. If a fresh
machine/team needs to re-provision, prefer the same flag over manually
creating profiles in the developer portal.
