# Light color scheme — design spec

Date: 2026-09-06
Status: approved design, not implemented. Author: brainstorming session 2026-09-06.
Scope owner: Kiko coordinator

Revision: the original "Shared-palette decision" (approved earlier
2026-09-06 — `entityColors` and `chartSeries` as one palette across
both themes) is SUPERSEDED, same date, by a per-theme decision: both
palettes now get a light set and a dark set. See Section 1's decision
subsection for the reversal and its reasons.

## Overview

Kiko is OLED-dark-only today. Add a light color scheme. Deliver three
things:

1. A light token palette in the iOS-native light style.
2. A Settings control to choose System / Light / Dark, persisted
   across launches.
3. System detection as the default, so a fresh install follows the
   iOS appearance.

## Current state (facts)

- One theme only: `darkTheme` in `src/design-system/theme.ts`,
  exported `as const`. Tokens:
  - `colors`: `background`, `surface`, `surfaceHigh`, `textPrimary`,
    `textSecondary`, `accent`, `positive`, `negative`, `border`,
    `scrim`, plus nested `entityColors` (14 swatches) and
    `chartSeries` (8 hues). Read `theme.ts` for the exact current
    values; this spec's Section 1 table records only what changes.
  - `spacing`: a `(multiplier) => multiplier * 4` function.
  - `radii`: `{ sm: 6, md: 10, lg: 16 }`.
  - `typography`: `display` / `title` / `heading` / `body` /
    `caption`.
- `src/design-system/unistyles.ts` registers one theme key
  (`{ dark: darkTheme }`), sets `settings: { initialTheme: 'dark' }`,
  and does not set `adaptiveThemes`. No call to
  `UnistylesRuntime.setTheme` / `setAdaptiveThemes` and no
  `useColorScheme` exists anywhere in `src/`.
- No appearance/theme setting exists under `src/screens/settings/`.

## Section 1 — Light palette

Only chrome colors change. Add `lightTheme` with the identical token
shape as `darkTheme`. `entityColors` and `chartSeries` are now
per-theme (see decision below) and are not part of this table.

| Token | Dark | Light | iOS light source |
|---|---|---|---|
| `background` | `#000000` | `#F2F2F7` | `systemGroupedBackground` |
| `surface` | `#1C1C1E` | `#FFFFFF` | `secondarySystemGrouped` |
| `surfaceHigh` | `#2C2C2E` | `#E5E5EA` | `systemGray5` |
| `textPrimary` | `#FFFFFF` | `#000000` | `label` |
| `textSecondary` | `rgba(235,235,245,0.60)` | `rgba(60,60,67,0.60)` | `secondaryLabel` |
| `accent` | `#0A84FF` | `#007AFF` | `systemBlue` |
| `positive` | `#30D158` | `#34C759` | `systemGreen` |
| `negative` | `#FF453A` | `#FF3B30` | `systemRed` |
| `border` | `#38383A` | `#C6C6C8` | `separator` |
| `scrim` | `rgba(0,0,0,0.55)` | `rgba(0,0,0,0.40)` | modal dim |

Note: the three background-family values (`background`, `surface`,
`surfaceHigh`) are review-sensitive. They set the card-on-card
hierarchy: a white card on a light-gray ground, with a raised element
stepping to a slightly darker gray.

### Per-theme palette decision (approved 2026-09-06, supersedes the earlier shared-palette decision)

`entityColors` and `chartSeries` become PER-THEME: a light set and a
dark set, using Apple's light/dark pairs where a system color exists.
This reverses the shared-palette decision this spec originally
recorded (see below). Reasons:

- Each swatch gets a value that is legible on its own background,
  which directly resolves Section 6's items 2 and 3 (the `white`
  swatch invisible on a white card; `yellow`/`mint` low contrast on
  white) — those are no longer open follow-ups.
- `accent`, `positive`, and `negative` already get per-theme values in
  the Section 1 table; `entityColors` and `chartSeries` now follow the
  same pattern, so the whole palette is consistently per-theme rather
  than split.

Trade-off recorded: a user-picked entity color may shift slightly
across a mode switch (light and dark values for the same named
swatch are not identical). Mitigated by keeping each swatch in the
same hue family across both sets and only adjusting the value for
contrast, so the identity color still reads as "the same color" to
the user, just tuned per background.

Superseded rationale, for history: this spec originally approved
keeping one shared value per swatch/series color specifically to
avoid this trade-off and to avoid re-plumbing every consumer with a
theme argument — that reasoning is overridden by the legibility fixes
above.

## Section 2 — Theme module and Unistyles registration

- Restructure `theme.ts` so both themes share `spacing`, `typography`,
  and `radii`, and differ only in `colors`.
- Move `entityColors` and `chartSeries` into a per-theme palette
  module (a light set and a dark set), so the code makes explicit
  that they now vary by theme (Section 1's per-theme palette
  decision).
- Register both themes, `{ light, dark }`, in `unistyles.ts`.
- Set `adaptiveThemes: true` so a fresh install follows the OS (the
  System default described in the Overview).

## Section 3 — Persistence and Settings control

Three states: System, Light, Dark. Persist the choice the same way
`baseCurrency` and `language` are persisted today:

- A new Drizzle migration adds an `appearance` column to the settings
  table, default `'system'`.
- A new `settingsRepo` field reads and writes it.
- At app start, read the value and drive Unistyles:
  - `'system'` -> `setAdaptiveThemes(true)`.
  - `'light'` or `'dark'` -> `setAdaptiveThemes(false)`, then
    `setTheme('light' | 'dark')`.
- Add a new "Appearance" `GlassSurface` card to the settings screen,
  using the shared `OptionPills` component. It reads its current
  value via `useLiveQuery`, the same pattern `CurrencySwitch` and
  `LanguageSwitch` already use.

## Section 4 — Theme-reactive chrome fixes

These places read `darkTheme` (or hardcode `"dark"`) directly instead
of the active theme. Each must switch to reading the current theme.

| File | Problem | Fix |
|---|---|---|
| `src/design-system/components/glass-surface/glass-surface.component.tsx:105` | `colorScheme="dark"` hardcoded | Read current theme name, pass `light`/`dark`. |
| `src/design-system/components/bottom-sheet/bottom-sheet.component.tsx:153` | Same hardcoded `colorScheme="dark"` | Same fix. |
| `src/navigation/root.navigator.tsx:43-45` | Native tab bar's `barTintColor` / `tabBarActiveTintColor` / `tabBarInactiveTintColor` import `darkTheme` colors directly | Read from `useUnistyles()` instead. |
| `src/navigation/dark-theme.ts` (exports `navigationDarkTheme`) + `App.tsx` `NavigationContainer theme={navigationDarkTheme}` | Only one static navigation theme exists | Add a light navigation theme (mirroring `navigationDarkTheme`'s shape against `lightTheme`); select the one to pass to `NavigationContainer` by the current theme. |
| `src/statistics/category-breakdown.ts:9` | Imports `darkTheme` for `chartSeries` | Point at the new per-theme palette module, and thread the active color scheme through so `resolveCategoryColor`/`categoryColor` pick the matching set. |
| `src/holdings/entity-colors.ts:14` | Imports `darkTheme` for `entityColors` | Point at the new per-theme palette module, and thread the active color scheme through so `resolveEntityColor`/`defaultHoldingColor`/`defaultAccountColor` pick the matching set. |

Blast radius is larger than these two files: every consumer of
`resolveCategoryColor`/`categoryColor` and
`resolveEntityColor`/`defaultHoldingColor`/`defaultAccountColor` now
needs the active scheme threaded in, not just the two files above.
That includes the statistics pie chart, the home breakdown, the
categories settings screen, the transaction form, the holding detail
screen, the holding-card component, and the accounts screen.

RISK to record: `root.navigator.tsx`'s own doc comment already notes
that the native bottom-tab bar (`react-native-bottom-tabs`) rebuilds
its `UITabBar` appearance on every tab's native `onAppear`
(`configureStandardAppearance`), and that this rebuild re-resolves
against the ambient `userInterfaceStyle` when no explicit
`barTintColor` pins it — today's `barTintColor` pin exists specifically
to keep the bar from flipping schemes because the app has no
`UIUserInterfaceStyle` in `Info.plist` (see Section 6, item 1). Once
`barTintColor` becomes theme-reactive instead of a fixed dark
constant, this must be verified on-device: confirm a live theme
switch (System/Light/Dark, and a live OS appearance change while on
System) updates the bar's colors without needing a screen remount.

## Section 5 — Entity card background direction (hardest item)

`entityCardBackground` (`src/design-system/entity-tint.ts`) darkens
an entity color 90% toward black (`CARD_DARKEN_PERCENT = 90`) so
white body text stays legible on the resulting near-black card. It
only darkens today.

Plan:

- Add a `lightenHex` function beside the existing `darkenHex`.
- Make `entityCardBackground` take the current theme's direction and
  pick `darkenHex` (dark theme) or `lightenHex` (light theme).
- Card text needs no change: it reads `textPrimary`, which already
  flips to black on the light theme automatically (Section 1 table).

Also record:

- `entityTintBackground` (a flat alpha blend at
  `ENTITY_TINT_OPACITY = 0.1` over `surface`) is math-correct on any
  background color, but its opacity was calibrated by eye against the
  dark surface. It needs a light-mode calibration review; do not
  assume 0.1 is correct on `#FFFFFF` without a design pass.
- `FALLBACK_ENTITY_COLOR` (`entityColors.gray`) now resolves from the
  per-theme palette by the active color scheme (Section 1) — still
  gray, but picked from the correct light/dark set instead of a
  single shared value.

## Section 6 — Known limitations and open design items

1. `Info.plist` has no `UIUserInterfaceStyle` key. A manual "Light"
   choice made while the OS is in Dark Mode does not change native
   system dialogs and controls (date picker, alerts, share sheet) —
   those follow the OS style, not the in-app choice. A full native
   override (`UIUserInterfaceStyle` / `overrideUserInterfaceStyle`) is
   out of scope for this spec; this is a documented limitation, not a
   bug to silently fix in passing.
   Also record: the status bar's text/icon color must read dark on
   the light theme. Verify this via the navigation theme and/or the
   `StatusBar` component's `barStyle`, once the theme is wired.
2. RESOLVED by the Section 1 per-theme palette decision: the `white`
   entity swatch (`entityColors.white`, `#FFFFFF`) was invisible on a
   white card background under the old shared palette. The light-mode
   set now carries a distinct, legible value for this swatch, so this
   is no longer an open follow-up.
3. RESOLVED by the same decision: low-contrast hues on a white
   background — `yellow` and `mint` in `entityColors`/`chartSeries` —
   read poorly as chart fills or swatches on white under the old
   shared palette. The light-mode set now carries contrast-adjusted
   values for these hues, so this is no longer an open follow-up.

## Section 7 — Tests

- `theme.test.ts` currently asserts single-theme literal values
  (`darkTheme.colors.accent`, etc.). Add a shape-invariant test: both
  `lightTheme` and `darkTheme` expose the identical key set (same
  `colors` keys, same `entityColors` keys, same `chartSeries` length).
- The existing assertion `entityColors.blue === accent`
  (`darkTheme.colors.entityColors.blue === darkTheme.colors.accent`)
  must change: both `accent` and entity `blue` now differ per theme
  (Section 1's per-theme palette decision). The assertion needs to
  compare each theme's entity `blue` against that SAME theme's own
  per-theme palette set — `lightTheme`'s `blue` against the light
  set's `blue`, `darkTheme`'s `blue` against the dark set's `blue` —
  never against a shared value or against the other theme's `accent`.
- Add assertions for the per-theme swatch VALUES themselves, for both
  `entityColors` and `chartSeries`, in both light and dark — not only
  the shape-invariant key-set check above.
- Add a light-direction case to `entity-tint.test.ts` covering the new
  `lightenHex` function and the theme-direction branch of
  `entityCardBackground`.

## Out of scope

- Native `UIUserInterfaceStyle` / `overrideUserInterfaceStyle`
  override, so a manual in-app choice would also force native system
  dialogs to match (Section 6, item 1).
- Implementation of any kind. This is a design spec only; no code
  changes.
