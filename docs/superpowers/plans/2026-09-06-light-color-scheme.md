# Light Color Scheme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a light color scheme to Kiko (OLED-dark-only today) with a System/Light/Dark Settings control persisted across launches, defaulting to system detection.

**Architecture:** Restructure `theme.ts` into a shared base (spacing/typography/radii) plus two colour themes (`darkTheme`, `lightTheme`), with `entityColors`/`chartSeries` extracted into a palette module that now holds TWO sets each — a light set and a dark set (Apple light/dark pairs where a system color exists) — chosen by the active color scheme. `darkTheme` references the dark sets, `lightTheme` the light sets. Every consumer of the entity/chart palettes (the pure `categoryColor`/`resolveCategoryColor`/`resolveEntityColor`/`defaultHoldingColor`/`defaultAccountColor` functions and the `buildCategoryBreakdown`/`buildAccountContribution` builders) takes the active scheme as an argument and picks the matching set. Register both themes in Unistyles with `adaptiveThemes: true`, make the theme-reactive chrome sites read the active theme instead of hardcoded dark, and add the entity-card lighten direction. Persist the choice in a new `settings.appearance` column read via `useLiveQuery`, and drive `UnistylesRuntime` from it at app start.

**Tech Stack:** React Native, TypeScript, `react-native-unistyles` v3 (theme + `UnistylesRuntime`/`useUnistyles`), `@react-navigation/native`, `@bottom-tabs/react-navigation` (native tab bar), Drizzle ORM + op-sqlite (migrations, `settingsRepo`, custom `useLiveQuery`), Jest + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-06-light-color-scheme-design.md` — read it in full before starting; every task argues from it.

## Global Constraints

- **TDD is mandatory.** Every task writes the failing test first, watches it fail, then implements. Follow `superpowers:test-driven-development`.
- **Harness gate at every checkpoint:** run `npm run check:all` (lint, dup, knip, deps, security, secrets, overrides) at the end of each task; it must be green. Run `npm run check:deep` (mutation + osv) once before declaring the feature done (final task). Never weaken a check to get green (project CLAUDE.md standing rule).
- **No hardcoded token literals at call sites.** Components read theme tokens through Unistyles, never inline hex/spacing (`kiko-design-system`). New chrome code reads the *active* theme, never `darkTheme` directly.
- **Every DB write goes through `db.transaction()`** via the repo's `write` helper (`kiko-architecture`); read functions return a Drizzle query builder for `useLiveQuery`, never awaited data.
- **Per-theme palette decision (spec Section 1 "Per-theme palette decision" + its Revision note, approved 2026-09-06 — REVERSES the earlier shared-palette decision):** `entityColors` and `chartSeries` NOW get per-theme values — a light set and a dark set — using Apple's light/dark pairs where a system color exists. `accent`/`positive`/`negative` were already per-theme; the two palettes now follow the same pattern. Every consumer of these palettes threads the active color scheme (`resolveColorScheme(rt.themeName)`, Task 4) and picks the matching set. This resolves spec Section 6 items 2 and 3 (the `white` swatch invisible on a white card; `yellow`/`mint` low-contrast on white) directly in the light set, so they are no longer follow-ups.
- **Migration numbering:** the next migration is `0014` (current highest is `0013_add_category_sort_order`). It must be registered in BOTH `drizzle/migrations/migrations.js` and `drizzle/migrations/meta/_journal.json`.
- **Themes object order:** register `{ dark, light }` with **`dark` first**. The Unistyles Jest mock resolves `useUnistyles().theme` to `Object.values(themes).at(0)`, so keeping `dark` first preserves every existing component test that asserts a `darkTheme` token. Adaptive theme selection keys off the theme *name* (`'light'`/`'dark'`), not object position, so order does not affect runtime adaptivity.

**Exact light chrome values (spec Section 1 table) — copy verbatim:**

| Token | Light value |
|---|---|
| `background` | `#F2F2F7` |
| `surface` | `#FFFFFF` |
| `surfaceHigh` | `#E5E5EA` |
| `textPrimary` | `#000000` |
| `textSecondary` | `rgba(60,60,67,0.60)` |
| `accent` | `#007AFF` |
| `positive` | `#34C759` |
| `negative` | `#FF3B30` |
| `border` | `#C6C6C8` |
| `scrim` | `rgba(0,0,0,0.40)` |

---

## File Structure

**New files:**
- `src/design-system/palette.ts` — the per-theme entity/chart palettes. Exports `entityColorsDark`/`entityColorsLight` (14 swatches each) and `chartSeriesDark`/`chartSeriesLight` (8 hues each), plus the scheme-keyed lookups `entityColorsByScheme = { dark, light }` and `chartSeriesByScheme = { dark, light }` that consumers index with the active scheme. One source of truth for both sets.
- `src/design-system/color-scheme.ts` — pure `resolveColorScheme(themeName)` mapping a Unistyles theme name (`'light' | 'dark' | undefined`) to a concrete `'light' | 'dark'` colour scheme (default `'dark'`). Unit-testable; consumed by every chrome site that needs `light`/`dark` from `rt.themeName`.
- `src/navigation/light-theme.ts` — `navigationLightTheme`, mirroring `navigationDarkTheme`'s shape against `lightTheme`.
- `src/navigation/select-navigation-theme.ts` — pure `selectNavigationTheme(themeName)` returning the light or dark navigation theme.
- `src/appearance/appearance.ts` — the `appearances` const tuple (`['system','light','dark']`) and `Appearance` type, mirroring `appLanguages`/`AppLanguage` in `src/i18n/device-language.ts`.
- `src/appearance/use-sync-appearance-with-settings.ts` — the app-start controller that reads `settings.appearance` and drives `UnistylesRuntime` (`setAdaptiveThemes` / `setTheme`), mirroring `useSyncLanguageWithSettings`.
- `src/design-system/components/appearance-switch/` — `appearance-switch.component.tsx`, `appearance-switch.props.d.ts`, `index.ts`: a segmented System/Light/Dark toggle delegating to shared `OptionPills`, mirroring `LanguageSwitch`.
- `drizzle/migrations/0014_add_appearance.sql` — `ALTER TABLE settings ADD appearance ...`.

**Modified files:**
- `src/design-system/theme.ts` — split shared base from two colour themes; import the per-theme palette sets (dark theme references the dark sets, light theme the light sets).
- `src/design-system/theme.test.ts` — shape-invariant both-themes test; fix `blue === accent`.
- `src/design-system/unistyles.ts` — register both themes, `adaptiveThemes: true`.
- `src/design-system/entity-tint.ts` — add `lightenHex`; make `entityCardBackground` direction-aware; make `resolveEntityColor` scheme-aware and resolve `FALLBACK_ENTITY_COLOR` (gray) from the per-theme palette by the active scheme.
- `src/design-system/entity-tint.test.ts` — light-direction cases.
- `src/design-system/components/glass-surface/glass-surface.component.tsx` — theme-reactive `colorScheme`.
- `src/design-system/components/bottom-sheet/bottom-sheet.component.tsx` — theme-reactive `colorScheme`.
- `src/navigation/root.navigator.tsx` — tab-bar colours from `useUnistyles()`.
- `App.tsx` — select navigation theme by active theme; mount the appearance controller.
- `src/statistics/category-breakdown.ts` — `categoryColor`/`resolveCategoryColor` become scheme-aware (pick `chartSeriesByScheme[scheme]`); `buildCategoryBreakdown` takes a `colorScheme` input.
- `src/statistics/account-contribution.ts` — `buildAccountContribution` takes a `colorScheme` input (its internal `defaultAccountColor` read becomes scheme-aware).
- `src/holdings/entity-colors.ts` — `defaultHoldingColor`/`defaultAccountColor` become functions of the active scheme (pick `entityColorsByScheme[scheme]`).
- Palette call sites threaded with the active scheme (Task 8): `src/screens/statistics/statistics.screen.tsx`, `src/screens/home/home.screen.tsx`, `src/screens/settings/categories.screen.tsx`, `src/screens/forms/transaction-form.screen.tsx`, `src/screens/forms/holding-form.screen.tsx`, `src/screens/forms/account-form.screen.tsx`, `src/screens/holding-detail/holding-detail.screen.tsx`, `src/screens/account-detail/account-detail.screen.tsx`, `src/screens/account-detail/holding-card/holding-card.component.tsx`, `src/screens/accounts/accounts.screen.tsx`, `src/design-system/components/bar-chart/bar-chart.component.tsx`, and their co-located tests.
- `src/db/schema.ts` — `appearance` column on `settings`.
- `src/repositories/settings.repo.ts` — `setAppearance` field.
- `src/repositories/settings.repo.test.ts` — `setAppearance` test.
- `src/screens/settings/settings.screen.tsx` — Appearance `GlassSurface` card.
- `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts` — Appearance copy.

---

### Task 1: Per-theme palette module + two-theme restructure

**Files:**
- Create: `src/design-system/palette.ts`
- Modify: `src/design-system/theme.ts`
- Test: `src/design-system/theme.test.ts` (rewrite/extend)

**Interfaces:**
- Produces: `palette.ts` exports FOUR palette sets — `entityColorsDark` and `entityColorsLight` (each an object with keys `white, khaki, brown, yellow, blue, green, mint, violet, red, orange, teal, pink, indigo, gray`, all `#RRGGBB`) and `chartSeriesDark` and `chartSeriesLight` (each a `readonly string[]` of 8 hues) — plus two scheme-keyed lookups `entityColorsByScheme = { dark: entityColorsDark, light: entityColorsLight }` and `chartSeriesByScheme = { dark: chartSeriesDark, light: chartSeriesLight }`. `theme.ts` exports `darkTheme` and `lightTheme`, each `{ colors, spacing, radii, typography }` with the identical key set; `darkTheme.colors.entityColors === entityColorsDark`, `darkTheme.colors.chartSeries === chartSeriesDark`, `lightTheme.colors.entityColors === entityColorsLight`, `lightTheme.colors.chartSeries === chartSeriesLight`.
- Consumes: nothing from later tasks.

- [ ] **Step 1: Write the failing tests** in `src/design-system/theme.test.ts`. Replace the file with (a) the existing dark literal-value assertions kept, (b) new light literal-value assertions, (c) the shape-invariant test, and (d) the corrected `blue`/`green` assertion.

```ts
import {
  entityColorsDark,
  entityColorsLight,
  chartSeriesDark,
  chartSeriesLight,
} from './palette';
import { darkTheme, lightTheme } from './theme';

describe('darkTheme iOS dark palette', () => {
  it('uses Apple dark system color values', () => {
    expect(darkTheme.colors.background).toBe('#000000');
    expect(darkTheme.colors.surface).toBe('#1C1C1E');
    expect(darkTheme.colors.surfaceHigh).toBe('#2C2C2E');
    expect(darkTheme.colors.textPrimary).toBe('#FFFFFF');
    expect(darkTheme.colors.textSecondary).toBe('rgba(235,235,245,0.60)');
    expect(darkTheme.colors.accent).toBe('#0A84FF');
    expect(darkTheme.colors.positive).toBe('#30D158');
    expect(darkTheme.colors.negative).toBe('#FF453A');
    expect(darkTheme.colors.border).toBe('#38383A');
    expect(darkTheme.colors.scrim).toBe('rgba(0,0,0,0.55)');
  });
});

describe('lightTheme iOS light palette', () => {
  it('uses Apple light system color values (spec Section 1 table)', () => {
    expect(lightTheme.colors.background).toBe('#F2F2F7');
    expect(lightTheme.colors.surface).toBe('#FFFFFF');
    expect(lightTheme.colors.surfaceHigh).toBe('#E5E5EA');
    expect(lightTheme.colors.textPrimary).toBe('#000000');
    expect(lightTheme.colors.textSecondary).toBe('rgba(60,60,67,0.60)');
    expect(lightTheme.colors.accent).toBe('#007AFF');
    expect(lightTheme.colors.positive).toBe('#34C759');
    expect(lightTheme.colors.negative).toBe('#FF3B30');
    expect(lightTheme.colors.border).toBe('#C6C6C8');
    expect(lightTheme.colors.scrim).toBe('rgba(0,0,0,0.40)');
  });
});

describe('theme shape invariance', () => {
  it('exposes the identical colors key set on both themes', () => {
    expect(Object.keys(lightTheme.colors).sort()).toEqual(Object.keys(darkTheme.colors).sort());
  });

  it('exposes the identical entityColors key set on both themes', () => {
    expect(Object.keys(lightTheme.colors.entityColors).sort()).toEqual(
      Object.keys(darkTheme.colors.entityColors).sort(),
    );
  });

  it('exposes an equal-length chartSeries on both themes', () => {
    expect(lightTheme.colors.chartSeries.length).toBe(darkTheme.colors.chartSeries.length);
  });

  // REVERSAL (spec Section 1 per-theme decision): each theme references its OWN
  // per-theme set, NOT one shared palette. Dark theme -> dark sets, light theme
  // -> light sets, and the two sets are distinct objects.
  it('references its own per-theme entityColors/chartSeries set (not a shared palette)', () => {
    expect(darkTheme.colors.entityColors).toBe(entityColorsDark);
    expect(darkTheme.colors.entityColors).not.toBe(entityColorsLight);
    expect(lightTheme.colors.entityColors).toBe(entityColorsLight);
    expect(lightTheme.colors.entityColors).not.toBe(entityColorsDark);
    expect(darkTheme.colors.chartSeries).toBe(chartSeriesDark);
    expect(darkTheme.colors.chartSeries).not.toBe(chartSeriesLight);
    expect(lightTheme.colors.chartSeries).toBe(chartSeriesLight);
    expect(lightTheme.colors.chartSeries).not.toBe(chartSeriesDark);
  });

  it('shares spacing, radii, and typography across both themes', () => {
    expect(lightTheme.spacing).toBe(darkTheme.spacing);
    expect(lightTheme.radii).toBe(darkTheme.radii);
    expect(lightTheme.typography).toBe(darkTheme.typography);
  });
});

describe('per-theme entity/chart palettes', () => {
  it('exposes the fourteen named entity-color tokens as valid hex in both sets', () => {
    for (const set of [entityColorsDark, entityColorsLight]) {
      for (const hue of Object.values(set)) {
        expect(hue).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
    // Dark set: Apple dark system values.
    expect(entityColorsDark.blue).toBe('#0A84FF');
    expect(entityColorsDark.green).toBe('#30D158');
    // Light set: Apple light system values.
    expect(entityColorsLight.blue).toBe('#007AFF');
    expect(entityColorsLight.green).toBe('#34C759');
  });

  it('keeps every entity-color swatch visually distinct within each set', () => {
    for (const set of [entityColorsDark, entityColorsLight]) {
      const hues = Object.values(set);
      expect(new Set(hues).size).toBe(hues.length);
    }
  });

  // Spec Section 7: entity `blue` now differs per theme; assert each theme's
  // entity `blue` against that SAME theme's own per-theme set, never a shared
  // value and never the other theme's accent. In dark, entity blue equals the
  // dark accent; in light, entity blue equals the light accent (both are the
  // system blue of their mode).
  it('pins each theme entity blue to its OWN per-theme set', () => {
    expect(darkTheme.colors.entityColors.blue).toBe(entityColorsDark.blue);
    expect(lightTheme.colors.entityColors.blue).toBe(entityColorsLight.blue);
    expect(darkTheme.colors.entityColors.blue).toBe(darkTheme.colors.accent);
    expect(lightTheme.colors.entityColors.blue).toBe(lightTheme.colors.accent);
  });

  it('exposes a categorical chart palette of >= 6 distinct hex hues in both sets', () => {
    for (const series of [chartSeriesDark, chartSeriesLight]) {
      expect(series.length).toBeGreaterThanOrEqual(6);
      for (const hue of series) {
        expect(hue).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
      expect(new Set(series).size).toBe(series.length);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/design-system/theme.test.ts`
Expected: FAIL — `./palette` and `lightTheme` do not exist yet.

- [ ] **Step 3: Create the per-theme palette** `src/design-system/palette.ts`. Move the current `entityColors`/`chartSeries` values out of `theme.ts` as the DARK sets (inline the two aliased hexes `blue`/`green` as literals so they are decoupled from the now-per-theme `accent`/`positive`), then add the LIGHT sets and the scheme-keyed lookups. Keep the doc comments explaining a set is only ever grown (never a key removed/renamed) so an existing default mapping never dangles.

**Chosen light-set swatch values — copy verbatim.** Where an Apple light/dark system-color pair exists, the light value IS that Apple light system color. Where none exists, or where Apple's own pair still reads too faint on white, the light value is DERIVED from the dark counterpart: same hue (and, where relevant, saturation), only the HSL lightness lowered until the swatch clears a **3:1 contrast ratio against `#FFFFFF`** — the WCAG 1.4.11 non-text/graphical-object contrast floor. Contrast is computed with the standard sRGB relative-luminance formula on linearized channels (`L = 0.2126·R + 0.7152·G + 0.0722·B`; `contrast = 1.05 / (L + 0.05)` against white's `L = 1.0`), not eyeballed. All five previously-flagged rows (`white`, `khaki`, `yellow`, `mint`, and the matching chart-series entry) are now resolved this way below and no longer carry a flag.

| Entity key | Dark (unchanged) | Light | Light source / note |
|---|---|---|---|
| `white` | `#FFFFFF` | `#000000` | no Apple pair, and no light neutral can both read as "white/silver" and clear 3:1 without colliding with `gray` (`#8E8E93`, 3.26:1) — so instead of tuning a near-white fill, flip to the opposite pole of the same achromatic (neutral, 0-saturation) family: plain black. **21:1** against white (`L=0`, the maximum possible ratio) — verified, flag removed. Plainly distinct from `gray`, and `entityCardBackground`'s 90%-lighten still produces a pale-gray card with legible black `textPrimary` on top, same as every other swatch |
| `khaki` | `#BDB76B` | `#8D873F` | no Apple pair, so derived: same hue (~56°) and saturation (~38%) as the dark khaki, HSL lightness lowered 58%→40%. **3.70:1** against white (relative luminance `L=0.2335`) — verified, flag removed (previous guess `#9E9A5F` measured only 2.90:1, just under the floor) |
| `brown` | `#AC8E68` | `#A2845E` | `systemBrown` light |
| `yellow` | `#FFD60A` | `#B8860B` | deepened amber (spec Section 6 item 3): `systemYellow` light `#FFCC00` measures only **1.51:1** on white, so Apple's own pair is not usable here. `#B8860B` is the standard "DarkGoldenrod" hue (~43°, same gold-amber family as the dark yellow's ~50°), fully saturated, HSL lightness ~36%. **3.25:1** against white (`L=0.2727`) — verified, flag removed (previous guess `#CC9A00` measured only 2.56:1) |
| `blue` | `#0A84FF` | `#007AFF` | `systemBlue` light |
| `green` | `#30D158` | `#34C759` | `systemGreen` light |
| `mint` | `#66D4CF` | `#009992` | `systemMint` light `#00C7BE` measures only **2.12:1** on white — Apple's own pair fails the 3:1 floor here, so deviate from it. Same hue (~177°) and full saturation as `#00C7BE`, HSL lightness lowered 39%→30%. **3.52:1** against white (`L=0.2486`) — verified, flag removed |
| `violet` | `#BF5AF2` | `#AF52DE` | `systemPurple` light |
| `red` | `#FF453A` | `#FF3B30` | `systemRed` light |
| `orange` | `#FF9F0A` | `#FF9500` | `systemOrange` light |
| `teal` | `#40C8E0` | `#30B0C7` | `systemTeal` light |
| `pink` | `#FF375F` | `#FF2D55` | `systemPink` light |
| `indigo` | `#5E5CE6` | `#5856D6` | `systemIndigo` light |
| `gray` | `#98989D` | `#8E8E93` | `systemGray` light |

`chartSeries` light set (same order as dark; index i is the same hue family in each): `['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#30B0C7', '#FF2D55', '#B8860B', '#5856D6']`. The 7th entry is the same deepened `DarkGoldenrod` `#B8860B` as entity `yellow` above — **3.25:1** against white, verified, flag removed.

```ts
// Per-theme entity/chart palettes (spec Section 1 per-theme decision, which
// REVERSES the earlier shared-palette decision). Each named swatch/series color
// has a dark value and a light value, using Apple's light/dark system-color
// pairs where one exists so a swatch is legible on its own background. A hue
// stays in the same family across sets (only its value is tuned for contrast),
// so a user-picked color still reads as "the same color" after a mode switch.
// Only ever GROW a set (never remove/rename a key) so an existing default
// mapping never dangles. Consumers pick a set with `entityColorsByScheme[scheme]`
// / `chartSeriesByScheme[scheme]`, where `scheme` is the active color scheme
// (resolveColorScheme(rt.themeName), see color-scheme.ts).
export const entityColorsDark = {
  white: '#FFFFFF',
  khaki: '#BDB76B',
  brown: '#AC8E68',
  yellow: '#FFD60A',
  blue: '#0A84FF',
  green: '#30D158',
  mint: '#66D4CF',
  violet: '#BF5AF2',
  red: '#FF453A',
  orange: '#FF9F0A',
  teal: '#40C8E0',
  pink: '#FF375F',
  indigo: '#5E5CE6',
  gray: '#98989D',
} as const;

// Light set: Apple light system-color values where a pair exists. Four swatches
// have no usable Apple pair on white (khaki: no pair at all; yellow/mint:
// Apple's own light pair measures under 3:1 on white) and are instead derived
// from the dark counterpart's hue (see the table above for the computed
// contrast ratio behind each). `white` is the one swatch where no light
// neutral can both read as "white/silver" and clear 3:1 without colliding with
// `gray`, so it flips to the opposite pole of the same achromatic family:
// plain black, 21:1 against white, the maximum possible ratio.
export const entityColorsLight = {
  white: '#000000',
  khaki: '#8D873F',
  brown: '#A2845E',
  yellow: '#B8860B',
  blue: '#007AFF',
  green: '#34C759',
  mint: '#009992',
  violet: '#AF52DE',
  red: '#FF3B30',
  orange: '#FF9500',
  teal: '#30B0C7',
  pink: '#FF2D55',
  indigo: '#5856D6',
  gray: '#8E8E93',
} as const;

// Categorical palette for charts (line series / pie slices). Eight hues, each
// distinct from its neighbours. Consumers cycle with
// `series[i % series.length]`. The dark set is the pre-existing palette; the
// light set is its light-mode counterpart, same order (index i is the same hue
// family in both). The 7th entry is the deepened `DarkGoldenrod` `#B8860B`
// (3.25:1 against white), matching the entity `yellow` note above.
export const chartSeriesDark = [
  '#0A84FF',
  '#30D158',
  '#FF9F0A',
  '#BF5AF2',
  '#40C8E0',
  '#FF375F',
  '#FFD60A',
  '#5E5CE6',
] as const satisfies readonly string[];

export const chartSeriesLight = [
  '#007AFF',
  '#34C759',
  '#FF9500',
  '#AF52DE',
  '#30B0C7',
  '#FF2D55',
  '#B8860B',
  '#5856D6',
] as const satisfies readonly string[];

// Scheme-keyed lookups: every palette consumer indexes these with the active
// color scheme rather than importing a single set directly, so a light/dark
// switch swaps the whole palette in one place.
export const entityColorsByScheme = {
  dark: entityColorsDark,
  light: entityColorsLight,
} as const;

export const chartSeriesByScheme = {
  dark: chartSeriesDark,
  light: chartSeriesLight,
} as const;
```

- [ ] **Step 4: Restructure `theme.ts`** into a shared base plus two colour themes, importing the palette. Keep the OLED-method doc comments for dark; add a short comment for light citing the spec.

```ts
import {
  chartSeriesDark,
  chartSeriesLight,
  entityColorsDark,
  entityColorsLight,
} from './palette';

// Shared across both themes — spec Section 2: they differ only in `colors`.
const spacing = (multiplier: number) => multiplier * 4;
const radii = { sm: 6, md: 10, lg: 16 } as const;
const typography = {
  display: { fontSize: 44, fontWeight: '700' as const },
  title: { fontSize: 28, fontWeight: '700' as const },
  heading: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
} as const;

export const darkTheme = {
  colors: {
    background: '#000000',
    surface: '#1C1C1E',
    surfaceHigh: '#2C2C2E',
    textPrimary: '#FFFFFF',
    textSecondary: 'rgba(235,235,245,0.60)',
    accent: '#0A84FF', // systemBlue (dark)
    positive: '#30D158', // systemGreen (dark)
    negative: '#FF453A', // systemRed (dark)
    border: '#38383A',
    scrim: 'rgba(0,0,0,0.55)',
    entityColors: entityColorsDark,
    chartSeries: chartSeriesDark,
  },
  spacing,
  radii,
  typography,
} as const;

export const lightTheme = {
  colors: {
    background: '#F2F2F7', // systemGroupedBackground (light)
    surface: '#FFFFFF', // secondarySystemGrouped
    surfaceHigh: '#E5E5EA', // systemGray5
    textPrimary: '#000000', // label
    textSecondary: 'rgba(60,60,67,0.60)', // secondaryLabel
    accent: '#007AFF', // systemBlue (light)
    positive: '#34C759', // systemGreen (light)
    negative: '#FF3B30', // systemRed (light)
    border: '#C6C6C8', // separator (light)
    scrim: 'rgba(0,0,0,0.40)',
    entityColors: entityColorsLight,
    chartSeries: chartSeriesLight,
  },
  spacing,
  radii,
  typography,
} as const;
```

Note: preserve the review-sensitive comment from the spec that the three background-family light values set the white-card-on-light-gray-ground hierarchy.

- [ ] **Step 5: Run the theme test to verify it passes**

Run: `npx jest src/design-system/theme.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite** to confirm no existing consumer of `darkTheme.colors.entityColors`/`chartSeries` broke. They still resolve unchanged: `darkTheme.colors.entityColors` is now `entityColorsDark` (the same values the old shared `entityColors` held) and `darkTheme.colors.chartSeries` is `chartSeriesDark`, so any consumer still reading `darkTheme.colors.*` at this stage (before Task 8 threads the scheme) sees identical hexes.

Run: `npx jest`
Expected: PASS.

- [ ] **Step 7: Run the harness gate**

Run: `npm run check:all`
Expected: green. (Knip must not flag `lightTheme`, the light palette sets, or the `*ByScheme` lookups as unused — they are consumed starting Task 2/Task 3/Task 7/Task 8. If Knip flags any before its consumer lands, complete this task together with the first consumer before the medium-tier gate on Stop; do not add a Knip ignore.)

- [ ] **Step 8: Commit**

```bash
git add src/design-system/palette.ts src/design-system/theme.ts src/design-system/theme.test.ts
git commit -m "refactor(theme): extract per-theme palette sets, add lightTheme"
```

---

### Task 2: Register both themes with adaptive themes

**Files:**
- Modify: `src/design-system/unistyles.ts`
- Test: `src/design-system/unistyles.test.ts` (create)

**Interfaces:**
- Consumes: `darkTheme`, `lightTheme` from Task 1.
- Produces: Unistyles configured with `themes = { dark, light }` and `settings: { adaptiveThemes: true }`. Both theme names `'light'`/`'dark'` are valid `AppThemeName`s for `UnistylesRuntime.setTheme` (Task 10).

- [ ] **Step 1: Write the failing test** `src/design-system/unistyles.test.ts`. The module runs `StyleSheet.configure` as an import side effect; under the Jest mock, `configure` records `themes` into a registry the mock reads. Assert both themes register and dark is first.

```ts
import { StyleSheet } from 'react-native-unistyles';
import { darkTheme, lightTheme } from './theme';

describe('unistyles configuration', () => {
  it('registers both themes with dark first and adaptiveThemes enabled', () => {
    const configure = jest.spyOn(StyleSheet, 'configure');
    jest.isolateModules(() => {
      require('./unistyles');
    });

    expect(configure).toHaveBeenCalledTimes(1);
    const config = configure.mock.calls[0][0];
    expect(Object.keys(config.themes)).toEqual(['dark', 'light']);
    expect(config.themes.dark).toBe(darkTheme);
    expect(config.themes.light).toBe(lightTheme);
    expect(config.settings).toEqual({ adaptiveThemes: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/design-system/unistyles.test.ts`
Expected: FAIL — only `{ dark }` registered, `initialTheme` still set.

- [ ] **Step 3: Update `unistyles.ts`.** Register both themes (dark first, per Global Constraints), drop `initialTheme`, set `adaptiveThemes: true`. Do not set both `initialTheme` and `adaptiveThemes` — Unistyles v3 uses adaptive selection by theme name when `adaptiveThemes` is on.

```ts
import { StyleSheet } from 'react-native-unistyles';

import { darkTheme, lightTheme } from './theme';

// dark first so the Jest mock's `useUnistyles().theme` default stays dark
// (Object.values(themes).at(0)); adaptive selection keys off the theme NAME,
// not object order. adaptiveThemes lets a fresh install follow the OS
// appearance (the System default). The persisted choice overrides this at app
// start (see use-sync-appearance-with-settings).
const themes = { dark: darkTheme, light: lightTheme };

type AppThemes = typeof themes;

declare module 'react-native-unistyles' {
  export interface UnistylesThemes extends AppThemes {}
}

StyleSheet.configure({
  themes,
  settings: { adaptiveThemes: true },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/design-system/unistyles.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite** — confirm existing component tests that read `useUnistyles().theme` still see dark (dark stays first).

Run: `npx jest`
Expected: PASS.

- [ ] **Step 6: Harness gate + commit**

```bash
npm run check:all
git add src/design-system/unistyles.ts src/design-system/unistyles.test.ts
git commit -m "feat(theme): register light+dark themes with adaptiveThemes"
```

---

### Task 3: Entity-card lighten direction + scheme-aware fallback

**Files:**
- Modify: `src/design-system/entity-tint.ts`
- Test: `src/design-system/entity-tint.test.ts`

**Interfaces:**
- Consumes: `entityColorsByScheme` from `palette.ts` (Task 1) for the scheme-aware `FALLBACK_ENTITY_COLOR`.
- Produces:
  - `lightenHex(hex: string, percent: number): string` — each channel moves `percent`% toward 255.
  - `entityCardBackground(colorHex: string, colorScheme?: 'light' | 'dark'): string` — `colorScheme` defaults to `'dark'` (backward-compatible with existing single-arg callers); `'dark'` darkens, `'light'` lightens. Callers in Task 5/Task 8 pass the active scheme.
  - `resolveEntityColor(storedColor, typeDefault, colorScheme?: 'light' | 'dark'): string` — gains a third `colorScheme` argument defaulting to `'dark'` (backward-compatible), used ONLY to resolve the `FALLBACK_ENTITY_COLOR` gray from the matching per-theme set. Task 8 threads the real active scheme through every call site.

- [ ] **Step 1: Write the failing tests.** Append to `src/design-system/entity-tint.test.ts`. Replace any existing `import { darkTheme }` reference that reaches `entityColors` with a direct per-theme palette import (`entityColorsDark`/`entityColorsLight` from `./palette`). Add a `lightenHex` block, a light-direction `entityCardBackground` block, and a scheme-aware `resolveEntityColor` fallback block.

```ts
import { entityColorsDark as palette, entityColorsLight } from './palette';
// ...existing imports, plus:
import { lightenHex } from './entity-tint';

describe('lightenHex', () => {
  it('moves every channel toward white by the given percent', () => {
    // 50% of the way from 0 to 255 is ~128 (0x80); from 255 stays 255.
    expect(lightenHex('#000000', 50)).toBe('#808080');
    expect(lightenHex('#FFFFFF', 50)).toBe('#ffffff');
  });

  it('accepts a lowercase hex the same way as uppercase', () => {
    expect(lightenHex('#ff453a', 10)).toBe(lightenHex('#FF453A', 10));
  });

  it('is a no-op at 0%', () => {
    expect(lightenHex('#FF453A', 0)).toBe('#ff453a');
  });

  it('throws on a non-hex input, same as darkenHex', () => {
    expect(() => lightenHex('not-a-hex', 50)).toThrow(
      'entityTintBackground: expected a #RRGGBB hex, received "not-a-hex"',
    );
  });
});

describe('entityCardBackground direction', () => {
  it('darkens on the dark theme (default and explicit)', () => {
    expect(entityCardBackground('#FF453A')).toBe(darkenHex('#FF453A', 90));
    expect(entityCardBackground('#FF453A', 'dark')).toBe(darkenHex('#FF453A', 90));
  });

  it('lightens on the light theme, toward a near-white card tone', () => {
    expect(entityCardBackground('#FF453A', 'light')).toBe(lightenHex('#FF453A', 90));
  });

  it('reads plainly lighter than the raw hue on every channel for every swatch on light', () => {
    const channels = (hex: string): [number, number, number] => [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ];
    for (const hex of Object.values(palette)) {
      const [cr, cg, cb] = channels(entityCardBackground(hex, 'light'));
      const [rr, rg, rb] = channels(hex);
      expect(cr).toBeGreaterThanOrEqual(rr);
      expect(cg).toBeGreaterThanOrEqual(rg);
      expect(cb).toBeGreaterThanOrEqual(rb);
    }
  });

  it('produces a distinct light-mode card color for every swatch', () => {
    const cards = Object.values(palette).map((hex) => entityCardBackground(hex, 'light'));
    expect(new Set(cards).size).toBe(cards.length);
  });
});

describe('resolveEntityColor scheme-aware fallback', () => {
  it('falls back to the DARK gray by default and for the dark scheme', () => {
    expect(resolveEntityColor(null, undefined)).toBe(palette.gray);
    expect(resolveEntityColor(null, undefined, 'dark')).toBe(palette.gray);
  });

  it('falls back to the LIGHT gray for the light scheme', () => {
    expect(resolveEntityColor(null, undefined, 'light')).toBe(entityColorsLight.gray);
  });

  it('still returns a valid stored/typeDefault hex regardless of scheme', () => {
    expect(resolveEntityColor('#123456', undefined, 'light')).toBe('#123456');
    expect(resolveEntityColor(null, '#abcdef', 'light')).toBe('#abcdef');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/design-system/entity-tint.test.ts`
Expected: FAIL — `lightenHex` not exported; `entityCardBackground` takes one arg; `resolveEntityColor` takes two args.

- [ ] **Step 3: Implement in `entity-tint.ts`.** Make `FALLBACK_ENTITY_COLOR` scheme-aware (resolve gray from the matching set), add `lightenHex`, add `CARD_LIGHTEN_PERCENT`, make `entityCardBackground` direction-aware, and add the optional `colorScheme` argument to `resolveEntityColor`.

```ts
import { entityColorsByScheme } from './palette';
// remove: import { darkTheme } from './theme';

// The guaranteed-safe swatch resolveEntityColor falls back to, now resolved from
// the per-theme palette by the active scheme (spec Section 1/5) — still gray,
// but picked from the correct light/dark set. Defaults to 'dark' so existing
// two-arg callers are unchanged until Task 8 threads the real scheme.
const FALLBACK_ENTITY_COLOR = (colorScheme: 'light' | 'dark'): string =>
  entityColorsByScheme[colorScheme].gray;

// resolveEntityColor gains an optional colorScheme (default 'dark'); it only
// affects the final gray fallback. A valid stored color or typeDefault still
// wins unchanged.
export const resolveEntityColor = (
  storedColor: string | null | undefined,
  typeDefault: string | undefined,
  colorScheme: 'light' | 'dark' = 'dark',
): string => {
  if (isValidHex(storedColor)) {
    return storedColor;
  }

  if (isValidHex(typeDefault)) {
    return typeDefault;
  }

  return FALLBACK_ENTITY_COLOR(colorScheme);
};

// Lightens a `#RRGGBB` hex toward white by `percent` (0-100): each channel moves
// `percent`% of the way to 255. The light-theme mirror of `darkenHex`, so a
// bright swatch resolves into a near-WHITE card tone that carries a hint of the
// entity hue, with BLACK body text (light `textPrimary`) legible on top.
export const lightenHex = (hex: string, percent: number): string => {
  const [red, green, blue] = parseHex(hex);
  const lighten = (channel: number): string =>
    Math.round(channel + (255 - channel) * (percent / 100))
      .toString(16)
      .padStart(2, '0');

  return `#${lighten(red)}${lighten(green)}${lighten(blue)}`;
};

// Mirror of CARD_DARKEN_PERCENT for the light theme. 90% pulls a swatch nearly
// to white while keeping a hint of hue. DEVICE-REVIEWABLE, like the darken
// percent's own history (55 -> 70 -> 90): confirm on the light theme on-device
// and adjust if a card reads too washed-out or too saturated.
const CARD_LIGHTEN_PERCENT = 90;

// A card's flat, OPAQUE background, direction-chosen by the active theme: the
// resolved entity hue darkened (dark theme) or lightened (light theme) so body
// text — which flips white/black with `textPrimary` — stays legible. Defaults
// to the dark direction so existing single-arg callers are unchanged.
export const entityCardBackground = (
  colorHex: string,
  colorScheme: 'light' | 'dark' = 'dark',
): string =>
  colorScheme === 'light'
    ? lightenHex(colorHex, CARD_LIGHTEN_PERCENT)
    : darkenHex(colorHex, CARD_DARKEN_PERCENT);
```

Record in a comment (spec Section 5): `entityTintBackground`'s `0.1` opacity was calibrated by eye on the dark surface and needs a light-mode design-review calibration — do NOT change it here; it is flagged as a follow-up (see plan Non-Goals).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/design-system/entity-tint.test.ts`
Expected: PASS. Existing single-arg `entityCardBackground` assertions still pass (default `'dark'`).

- [ ] **Step 5: Harness gate + commit**

```bash
npm run check:all
git add src/design-system/entity-tint.ts src/design-system/entity-tint.test.ts
git commit -m "feat(theme): add lightenHex, theme-directional entityCardBackground, scheme-aware entity fallback"
```

---

### Task 4: Theme-name → color-scheme helper

**Files:**
- Create: `src/design-system/color-scheme.ts`
- Test: `src/design-system/color-scheme.test.ts`

**Interfaces:**
- Produces: `resolveColorScheme(themeName: string | undefined): 'light' | 'dark'` — returns `'light'` only for `'light'`, else `'dark'` (so an `undefined` runtime — the Jest mock's default — resolves deterministically to dark). Consumed by glass-surface, bottom-sheet, holding-card/accounts card tint (Task 5), and can back the nav-theme selection (Task 7).

- [ ] **Step 1: Write the failing test** `src/design-system/color-scheme.test.ts`.

```ts
import { resolveColorScheme } from './color-scheme';

describe('resolveColorScheme', () => {
  it("returns 'light' for the light theme name", () => {
    expect(resolveColorScheme('light')).toBe('light');
  });

  it("returns 'dark' for the dark theme name", () => {
    expect(resolveColorScheme('dark')).toBe('dark');
  });

  it("defaults to 'dark' when the theme name is undefined", () => {
    expect(resolveColorScheme(undefined)).toBe('dark');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/design-system/color-scheme.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `color-scheme.ts`.**

```ts
// Maps Unistyles' active theme name (`rt.themeName`, possibly undefined) to a
// concrete `'light' | 'dark'` colour scheme for any native surface that needs
// one (LiquidGlassView.colorScheme, a native tab bar). Defaults to 'dark' so an
// unresolved runtime never flashes the wrong scheme.
export const resolveColorScheme = (themeName: string | undefined): 'light' | 'dark' =>
  themeName === 'light' ? 'light' : 'dark';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/design-system/color-scheme.test.ts`
Expected: PASS.

- [ ] **Step 5: Harness gate + commit**

```bash
npm run check:all
git add src/design-system/color-scheme.ts src/design-system/color-scheme.test.ts
git commit -m "feat(theme): add resolveColorScheme(themeName) helper"
```

---

### Task 5: Theme-reactive glass surfaces + card tint direction

**Files:**
- Modify: `src/design-system/components/glass-surface/glass-surface.component.tsx:105`
- Modify: `src/design-system/components/bottom-sheet/bottom-sheet.component.tsx:153`
- Modify: `src/screens/account-detail/holding-card/holding-card.component.tsx:73`
- Modify: `src/screens/accounts/accounts.screen.tsx:124`
- Test: `src/design-system/components/glass-surface/glass-surface.component.test.tsx` (extend), `src/screens/account-detail/holding-card/holding-card.component.test.tsx` (extend)

**Interfaces:**
- Consumes: `resolveColorScheme` (Task 4); `useUnistyles().rt.themeName`; `entityCardBackground(color, scheme)` (Task 3).
- Produces: no new exports; glass surfaces and cards render against the active scheme.

- [ ] **Step 1: Write the failing test** in `glass-surface.component.test.tsx`. In the liquid-glass-capable `describe` block, assert the base's `colorScheme` reflects the resolved scheme. The global mock returns `rt.themeName === undefined` → `resolveColorScheme` → `'dark'`, so the default assertion is `'dark'`. Add a scoped test that overrides `useUnistyles` to return `themeName: 'light'` and asserts `'light'`.

```ts
// inside `describe('on liquid-glass-capable iOS', ...)`
it("passes the active theme's colorScheme to the native glass (dark by default under mock)", async () => {
  const { getByTestId } = await render(
    <GlassSurface testID="glass-surface" tint="rgba(255,69,58,0.1)">
      <Text>content</Text>
    </GlassSurface>,
  );
  expect(getByTestId('glass-surface-base').props.colorScheme).toBe('dark');
});
```

Add a separate file-scoped test that mocks the runtime theme name to light:

```ts
describe('GlassSurface on the light theme', () => {
  beforeAll(() => {
    jest.doMock('react-native-unistyles', () => {
      const actual = jest.requireActual('react-native-unistyles/mocks');
      // fall through to the official mock but pin themeName to 'light'
      return actual;
    });
  });
  // NOTE FOR IMPLEMENTER: the official mock exposes a single frozen runtime
  // object. If pinning `rt.themeName` through jest.doMock proves brittle,
  // instead spy on the `color-scheme` module:
  //   jest.spyOn(colorScheme, 'resolveColorScheme').mockReturnValue('light');
  // and assert the base receives colorScheme='light'. Prefer the spy approach.
});
```

Implementer guidance: prefer spying on `resolveColorScheme` for the light-branch assertion — it is the seam this task introduces and keeps the test independent of the Unistyles mock internals.

- [ ] **Step 2: Run the glass-surface test to verify the new default assertion fails**

Run: `npx jest src/design-system/components/glass-surface`
Expected: FAIL — base still hardcodes `colorScheme="dark"` (assertion for the seam not yet wired; the default value happens to be 'dark' but the light-branch spy test fails).

- [ ] **Step 3: Wire glass-surface.** Read the runtime theme name, resolve the scheme, pass it to the base.

```tsx
import { useUnistyles } from 'react-native-unistyles';
import { resolveColorScheme } from '../../color-scheme';
// ...
const { theme, rt } = useUnistyles();
const colorScheme = resolveColorScheme(rt.themeName);
// ...
<LiquidGlassView
  effect="regular"
  colorScheme={colorScheme}
  tintColor={tint}
  animated={false}
  ...
/>
```

Also: the `backdrop`/`base` fallback fill reads `styles.opaqueBase` (the themed `surface`) — confirm the fallback style resolves from the active theme, not a hardcoded value (it already reads a theme token via Unistyles styles; no change needed, but verify).

- [ ] **Step 4: Wire bottom-sheet** the same way (`bottom-sheet.component.tsx:153`): read `rt.themeName`, pass `colorScheme={resolveColorScheme(rt.themeName)}` to the backdrop's `LiquidGlassView`. `useUnistyles()` is already imported there (destructure `rt`).

- [ ] **Step 5: Wire card tint direction.** In `holding-card.component.tsx` and `accounts.screen.tsx`, read the active scheme and pass it to `entityCardBackground`:

```tsx
const { rt } = useUnistyles();
const scheme = resolveColorScheme(rt.themeName);
// ...
tint={entityCardBackground(color, scheme)}
```

(`accounts.screen.tsx` maps a list — read `rt` once at the top of the component, reuse for every card.)

Note: these two files ALSO compute the entity color with `resolveEntityColor(entity.color, defaultHoldingColor[type])` / `defaultAccountColor[kind]`. Those become scheme-aware in Task 8, at which point the SAME `scheme` value read here must be threaded into `resolveEntityColor(..., scheme)` and the default-color lookup (`defaultHoldingColor(scheme)[type]` / `defaultAccountColor(scheme)[kind]`). This task wires only the `entityCardBackground` direction; the card-tint files are not fully converted until Task 8 finishes threading the scheme through their color resolution as well. Do the `resolveEntityColor`/default-color threading in Task 8 (not here) so each task's harness gate stays green — `defaultHoldingColor`/`defaultAccountColor` are still plain record objects until Task 8 converts them.

- [ ] **Step 6: Extend `holding-card.component.test.tsx`** to assert the tint uses the resolved scheme. The default mock scheme is `'dark'`, so the existing assertion `entityCardBackground(violet)` still holds (default arg). Add a spy-based light-branch case:

```ts
it('lightens the card tint on the light theme', async () => {
  jest.spyOn(colorSchemeModule, 'resolveColorScheme').mockReturnValue('light');
  // render holding-card, then:
  expect(flat.backgroundColor).toBe(entityCardBackground(darkTheme.colors.entityColors.violet, 'light'));
});
```

- [ ] **Step 7: Run the affected suites to verify they pass**

Run: `npx jest src/design-system/components/glass-surface src/design-system/components/bottom-sheet src/screens/account-detail/holding-card src/screens/accounts`
Expected: PASS.

- [ ] **Step 8: Harness gate + commit**

```bash
npm run check:all
git add src/design-system/components/glass-surface src/design-system/components/bottom-sheet src/screens/account-detail/holding-card src/screens/accounts
git commit -m "feat(theme): make glass surfaces and card tints theme-reactive"
```

---

### Task 6: Theme-reactive native tab bar (device-verified)

**Files:**
- Modify: `src/navigation/root.navigator.tsx:43-45`
- Test: `src/navigation/root.navigator.test.tsx` (extend if present; else assert via a focused render test)

**Interfaces:**
- Consumes: `useUnistyles().theme.colors` (already theme-reactive — the active theme's colours).
- Produces: `barTintColor` / `tabBarActiveTintColor` / `tabBarInactiveTintColor` read from the active theme instead of `darkTheme`.

- [ ] **Step 1: Write/adjust the failing test.** Locate any existing `root.navigator` test. Add an assertion that the navigator's tab-bar colour props come from the active theme's tokens (dark under the mock). If no test file exists, create `src/navigation/root.navigator.test.tsx` rendering `<RootNavigator/>` inside the necessary providers and asserting the `Tabs.Navigator` receives `barTintColor === <activeTheme>.colors.background`. If the native tab navigator cannot be asserted directly under Jest, assert instead that the component reads `useUnistyles().theme` (refactor makes the import present) and covers the colour wiring by reading the rendered props via the navigator mock.

Implementer note: `@bottom-tabs/react-navigation` is a native component; if a direct prop assertion is infeasible under Jest, keep this task's automated coverage to a smoke render (`renders without crashing`) and rely on the Step 5 device verification for the colour-reactivity guarantee. Do not fabricate an assertion the mock cannot back.

- [ ] **Step 2: Run to verify current state**

Run: `npx jest src/navigation/root.navigator`
Expected: FAIL for the new active-theme assertion (still `darkTheme`), or PASS smoke-only if that path was chosen.

- [ ] **Step 3: Wire the tab bar to the active theme.**

```tsx
import { useUnistyles } from 'react-native-unistyles';
// remove: import { darkTheme } from '../design-system/theme';
// ...
const { theme } = useUnistyles();
// ...
<Tabs.Navigator
  barTintColor={theme.colors.background}
  tabBarActiveTintColor={theme.colors.accent}
  tabBarInactiveTintColor={theme.colors.textSecondary}
>
```

Update the existing doc comment: `barTintColor` now pins the bar to the ACTIVE theme's background (not a fixed dark constant) — it still exists to keep the native rebuild from re-resolving against the ambient `userInterfaceStyle`, but now tracks the chosen theme.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/navigation/root.navigator`
Expected: PASS.

- [ ] **Step 5: DEVICE VERIFICATION (explicit, required — spec Section 4 RISK).** Build to device (see `scripts/deploy-device.sh` and the memory notes on Release bundling). Then verify the native bottom-tab bar's remount behaviour:
  - Switch the in-app Appearance setting System → Light → Dark (Task 12 must be landed to exercise this end-to-end; if verifying before Task 12, temporarily drive `UnistylesRuntime.setTheme`/`setAdaptiveThemes` from a scratch call). Confirm the tab bar's background and active/inactive tints update **without needing a screen remount**.
  - With Appearance on System, change the OS appearance (Control Center / Settings) and confirm the bar follows live.
  - Confirm the bar does not flip schemes between tabs on navigation (the original B1 pin's job).
  If the bar fails to update live, record the finding: it likely needs a forced remount key on the navigator keyed to `rt.themeName`, or a native `overrideUserInterfaceStyle` — flag for a follow-up decision, do NOT silently add a native override (out of scope, spec Section 6).

- [ ] **Step 6: Harness gate + commit**

```bash
npm run check:all
git add src/navigation/root.navigator.tsx src/navigation/root.navigator.test.tsx
git commit -m "feat(theme): make native tab bar colors theme-reactive"
```

---

### Task 7: Light navigation theme + selection at the container

**Files:**
- Create: `src/navigation/light-theme.ts`
- Create: `src/navigation/select-navigation-theme.ts`
- Modify: `App.tsx:42` (`NavigationContainer theme=...`)
- Test: `src/navigation/select-navigation-theme.test.ts`

**Interfaces:**
- Consumes: `lightTheme`/`darkTheme`; `navigationDarkTheme`; `resolveColorScheme` (Task 4) or `rt.themeName` directly.
- Produces:
  - `navigationLightTheme` — `{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: lightTheme.colors.background, card: lightTheme.colors.background, text: lightTheme.colors.textPrimary, border: lightTheme.colors.border, primary: lightTheme.colors.accent } }`.
  - `selectNavigationTheme(themeName: string | undefined)` → `navigationLightTheme` for `'light'`, else `navigationDarkTheme`.

- [ ] **Step 1: Write the failing test** `src/navigation/select-navigation-theme.test.ts`.

```ts
import { lightTheme, darkTheme } from '../design-system/theme';
import { navigationDarkTheme } from './dark-theme';
import { navigationLightTheme } from './light-theme';
import { selectNavigationTheme } from './select-navigation-theme';

describe('navigationLightTheme', () => {
  it('maps React Navigation colors onto the light design tokens', () => {
    expect(navigationLightTheme.colors.background).toBe(lightTheme.colors.background);
    expect(navigationLightTheme.colors.card).toBe(lightTheme.colors.background);
    expect(navigationLightTheme.colors.text).toBe(lightTheme.colors.textPrimary);
    expect(navigationLightTheme.colors.border).toBe(lightTheme.colors.border);
    expect(navigationLightTheme.colors.primary).toBe(lightTheme.colors.accent);
  });

  it('is the light-mode counterpart of navigationDarkTheme (dark stays on dark tokens)', () => {
    expect(navigationDarkTheme.colors.background).toBe(darkTheme.colors.background);
  });
});

describe('selectNavigationTheme', () => {
  it("returns the light nav theme for 'light'", () => {
    expect(selectNavigationTheme('light')).toBe(navigationLightTheme);
  });

  it("returns the dark nav theme for 'dark' and for undefined", () => {
    expect(selectNavigationTheme('dark')).toBe(navigationDarkTheme);
    expect(selectNavigationTheme(undefined)).toBe(navigationDarkTheme);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/navigation/select-navigation-theme.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Create `light-theme.ts`.**

```ts
import { DefaultTheme } from '@react-navigation/native';

import { lightTheme } from '../design-system/theme';

// React Navigation theme mapped onto the light design tokens — the light-mode
// mirror of navigationDarkTheme. Drives the status-bar contrast (light theme =>
// dark status-bar text) and the screen chrome behind every navigator.
export const navigationLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: lightTheme.colors.background,
    card: lightTheme.colors.background,
    text: lightTheme.colors.textPrimary,
    border: lightTheme.colors.border,
    primary: lightTheme.colors.accent,
  },
};
```

- [ ] **Step 4: Create `select-navigation-theme.ts`.**

```ts
import { navigationDarkTheme } from './dark-theme';
import { navigationLightTheme } from './light-theme';

export const selectNavigationTheme = (themeName: string | undefined) =>
  themeName === 'light' ? navigationLightTheme : navigationDarkTheme;
```

- [ ] **Step 5: Wire `App.tsx`.** In `AppRoot`, read the active theme name and pass the selected navigation theme. This makes `NavigationContainer` re-render with the light theme when the theme switches (Unistyles re-renders consumers of `useUnistyles`).

```tsx
import { useUnistyles } from 'react-native-unistyles';
import { selectNavigationTheme } from './src/navigation/select-navigation-theme';
// remove: import { navigationDarkTheme } from './src/navigation/dark-theme';
// ...inside AppRoot:
const { rt } = useUnistyles();
// ...
<NavigationContainer theme={selectNavigationTheme(rt.themeName)}>
  <RootNavigator />
</NavigationContainer>
```

- [ ] **Step 6: Run the test + full suite to verify pass**

Run: `npx jest src/navigation/select-navigation-theme.test.ts && npx jest`
Expected: PASS. (Confirm any existing `App.tsx`/root render test still passes — it now reads `useUnistyles`, available under the global mock.)

- [ ] **Step 7: Harness gate + commit**

```bash
npm run check:all
git add src/navigation/light-theme.ts src/navigation/select-navigation-theme.ts src/navigation/select-navigation-theme.test.ts App.tsx
git commit -m "feat(theme): add light navigation theme and select it by active theme"
```

Note (spec Section 6, item 1): the light navigation theme drives the status bar to dark text on the light theme via React Navigation's theme. During the Task 6 device build, verify the status-bar icons/text read dark on the light theme; if not, add an explicit `StatusBar barStyle` driven off `rt.themeName` and record it — do not add a native `UIUserInterfaceStyle` override (out of scope).

---

### Task 8: Thread the active color scheme through every palette consumer

This is the largest task and NOT a pure import swap. The two source-of-truth
modules (`category-breakdown.ts`, `entity-colors.ts`) stop importing a single
palette from `darkTheme` and instead pick a per-theme set by an active
`colorScheme` argument; then every call site that reaches those functions —
across many screens, forms, and a chart component — must be given the active
scheme (`resolveColorScheme(useUnistyles().rt.themeName)`, Task 4). It touches
multiple screens, so do it in clearly separated TDD steps: convert the two
core modules first (with backward-compatible or fully-threaded signatures),
then convert each call site with its co-located test, running the affected
suite green before moving on.

**Files:**
- Modify (core): `src/statistics/category-breakdown.ts`, `src/statistics/account-contribution.ts`, `src/holdings/entity-colors.ts`, `src/design-system/entity-tint.ts` (already scheme-aware from Task 3 — call sites only).
- Modify (call sites): `src/screens/statistics/statistics.screen.tsx`, `src/screens/home/home.screen.tsx`, `src/screens/settings/categories.screen.tsx`, `src/screens/forms/transaction-form.screen.tsx`, `src/screens/forms/holding-form.screen.tsx`, `src/screens/forms/account-form.screen.tsx`, `src/screens/holding-detail/holding-detail.screen.tsx`, `src/screens/account-detail/account-detail.screen.tsx`, `src/screens/account-detail/holding-card/holding-card.component.tsx`, `src/screens/accounts/accounts.screen.tsx`, `src/design-system/components/bar-chart/bar-chart.component.tsx`.
- Test: `src/statistics/category-breakdown.test.ts`, `src/statistics/account-contribution.test.ts`, `src/holdings/entity-colors.test.ts` (add scheme cases), plus the co-located test of each modified screen/form/component.

**Interfaces (new signatures):**
- `categoryColor(key: string, colorScheme: 'light' | 'dark'): string` — picks `chartSeriesByScheme[colorScheme]`.
- `resolveCategoryColor(storedColor, key, colorScheme: 'light' | 'dark'): string` — threads the scheme to its `categoryColor` fallback.
- `buildCategoryBreakdown(input)` — add `colorScheme: 'light' | 'dark'` to the input object; it passes the scheme into `resolveCategoryColor`.
- `buildAccountContribution(input)` — add `colorScheme: 'light' | 'dark'` to the input object; it passes the scheme into the default-account-color lookup.
- `defaultHoldingColor(colorScheme: 'light' | 'dark'): Record<HoldingType, string>` and `defaultAccountColor(colorScheme: 'light' | 'dark'): Record<AccountKind, string>` — become FUNCTIONS returning the per-scheme record (built from `entityColorsByScheme[colorScheme]`), so a call site changes from `defaultHoldingColor[type]` to `defaultHoldingColor(scheme)[type]`.
- `resolveEntityColor(storedColor, typeDefault, colorScheme)` — already accepts the optional scheme from Task 3; call sites now pass the real scheme.

Decision recorded: make `categoryColor`/`resolveCategoryColor` and the two builders take a REQUIRED `colorScheme` (no default) — a category slice's fallback hue must always come from the active set, and a missing argument should be a compile error, not silently dark. `resolveEntityColor` keeps its Task-3 optional default (`'dark'`) because it is a widely-called guard; call sites still pass the real scheme, but the default keeps unrelated callers/tests compiling. Choose the shape that yields the smallest, clearest diff per file and keep it consistent across the two builders.

- [ ] **Step 1: Convert `category-breakdown.ts` (TDD).** In `category-breakdown.test.ts`, change existing `categoryColor(key)` / `resolveCategoryColor(stored, key)` calls to pass a scheme, and add a case that the SAME key maps to different hues under `'dark'` vs `'light'` (because `chartSeriesDark`/`chartSeriesLight` differ), plus a `buildCategoryBreakdown` case asserting an uncolored slice's `color` comes from the light set when `colorScheme: 'light'`. Watch fail. Then replace `import { darkTheme } from '../design-system/theme';` + `const { chartSeries } = darkTheme.colors;` with `import { chartSeriesByScheme } from '../design-system/palette';`, add the `colorScheme` parameter to `categoryColor`/`resolveCategoryColor` (index `chartSeriesByScheme[colorScheme]`), and add `colorScheme` to the `buildCategoryBreakdown` input, threading it into the `resolveCategoryColor(display.color, key, colorScheme)` call. Run the suite green.

- [ ] **Step 2: Convert `entity-colors.ts` (TDD).** In `entity-colors.test.ts` (create if absent), assert `defaultHoldingColor('dark').card === entityColorsDark.white` and `defaultHoldingColor('light').card === entityColorsLight.white` (and one account-kind case), watch fail, then replace `import { darkTheme } from '../design-system/theme';` + `const { entityColors } = darkTheme.colors;` with `import { entityColorsByScheme } from '../design-system/palette';` and make `defaultHoldingColor`/`defaultAccountColor` functions of `colorScheme` that build their `Record` from `entityColorsByScheme[colorScheme]`. Keep the exhaustiveness typing (`Record<HoldingType, string>` / `Record<AccountKind, string>`) so a new kind/type is still a compile error. Run the suite green.

- [ ] **Step 3: Convert `account-contribution.ts` (TDD).** In `account-contribution.test.ts`, add `colorScheme` to the `buildAccountContribution` input and assert a no-override account's slice `color` comes from the light set when `colorScheme: 'light'`. Watch fail. Then add `colorScheme` to the input and change `defaultAccountColor[account.kind]` to `defaultAccountColor(colorScheme)[account.kind]`. Run the suite green.

- [ ] **Step 4: Thread the scheme through the statistics screen (TDD).** `statistics.screen.tsx` does NOT currently use Unistyles — add `import { useUnistyles } from 'react-native-unistyles';` + `import { resolveColorScheme } from '../../design-system/color-scheme';`, read `const { rt } = useUnistyles();` and `const colorScheme = resolveColorScheme(rt.themeName);` once at the top of the component. The three `buildCategoryBreakdown(...)` / `buildAccountContribution(...)` calls run inside `useMemo`s (verify: the account-contribution `useMemo` and the two category-breakdown `useMemo`s) — add `colorScheme` to each input object and add `colorScheme` to each `useMemo` dependency array. Update the `resolveEntityColor(account.color, defaultAccountColor[account.kind])` call (the account entity color) to `resolveEntityColor(account.color, defaultAccountColor(colorScheme)[account.kind], colorScheme)`. Extend the screen's test with a light-scheme spy case (spy `resolveColorScheme` → `'light'`) asserting a slice/entity color comes from the light set. Run green. (Verify current line references before editing: `resolveEntityColor` + `defaultAccountColor` call, and the `buildAccountContribution`/`buildCategoryBreakdown` calls inside their `useMemo`s.)

- [ ] **Step 5: Thread the scheme through the home screen (TDD).** `home.screen.tsx` does NOT currently use Unistyles — add the `useUnistyles` + `resolveColorScheme` imports and read `colorScheme` once. Thread it into: the account entity color (`resolveEntityColor(account.color, defaultAccountColor(colorScheme)[account.kind], colorScheme)`), and both `resolveCategoryColor(display.color, key, colorScheme)` / `resolveCategoryColor(..., colorScheme)` transaction-row calls. Verify these are inside a `useMemo`/render where `colorScheme` is in scope (add to any relevant dependency array). Extend the home test with a light-scheme spy case. Run green.

- [ ] **Step 6: Thread the scheme through the remaining screens/forms/chart (TDD, one file at a time).** For each, read `colorScheme` via `resolveColorScheme(useUnistyles().rt.themeName)` (some already destructure `useUnistyles`; the forms/holding-card/bar-chart do not and must add the import) and thread it into every palette call, updating the co-located test with a light-branch spy case before moving on:
  - `categories.screen.tsx` — `resolveCategoryColor(category.color, category.key, colorScheme)` (already has `useUnistyles`).
  - `transaction-form.screen.tsx` — `resolveEntityColor(candidate.color, defaultHoldingColor(colorScheme)[candidate.type], colorScheme)` and `resolveCategoryColor(category.color, category.key, colorScheme)` (already has `useUnistyles`).
  - `holding-detail.screen.tsx` — `resolveEntityColor(holding.color, defaultHoldingColor(colorScheme)[holding.type], colorScheme)` and the `resolveCategoryColor(...)` call (already has `useUnistyles`).
  - `account-detail.screen.tsx` — `resolveEntityColor(account.color, defaultAccountColor(colorScheme)[account.kind], colorScheme)` (already has `useUnistyles`).
  - `holding-card.component.tsx` — `resolveEntityColor(holding.color, defaultHoldingColor(colorScheme)[holding.type], colorScheme)`; it already reads `scheme` for `entityCardBackground` after Task 5, so REUSE that same `scheme` value here (no second `useUnistyles` read).
  - `accounts.screen.tsx` — `resolveEntityColor(item.color, defaultAccountColor(colorScheme)[item.kind], colorScheme)`; reuse the `scheme` already read in Task 5 for the card list.
  - `holding-form.screen.tsx` — `defaultHoldingColor(colorScheme)[type]` (add `useUnistyles`; used for the ColorPicker default highlight).
  - `account-form.screen.tsx` — `defaultAccountColor(colorScheme)[kind]` (add `useUnistyles`).
  - `bar-chart.component.tsx` — `defaultHoldingColor(colorScheme)[slice.type]` (add `useUnistyles`).

- [ ] **Step 7: Full suite to confirm no missed call site.** A missed `defaultHoldingColor[...]` / `defaultAccountColor[...]` (now a function, no longer indexable) or a `categoryColor`/`resolveCategoryColor` missing its required scheme is a TYPE error — `npx tsc`/the build and the tests must be green.

Run: `npx jest`
Expected: PASS.

- [ ] **Step 8: Harness gate + commit**

```bash
npm run check:all
git add src/statistics/category-breakdown.ts src/statistics/account-contribution.ts src/holdings/entity-colors.ts src/screens/statistics/statistics.screen.tsx src/screens/home/home.screen.tsx src/screens/settings/categories.screen.tsx src/screens/forms/transaction-form.screen.tsx src/screens/forms/holding-form.screen.tsx src/screens/forms/account-form.screen.tsx src/screens/holding-detail/holding-detail.screen.tsx src/screens/account-detail/account-detail.screen.tsx src/screens/account-detail/holding-card/holding-card.component.tsx src/screens/accounts/accounts.screen.tsx src/design-system/components/bar-chart/bar-chart.component.tsx
git add src/statistics/category-breakdown.test.ts src/statistics/account-contribution.test.ts src/holdings/entity-colors.test.ts
git commit -m "feat(theme): thread the active color scheme through every palette consumer"
```

---

### Task 9: `appearance` column + schema + repo setter

**Files:**
- Create: `drizzle/migrations/0014_add_appearance.sql`
- Modify: `drizzle/migrations/migrations.js`, `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/meta/0014_snapshot.json` (generated)
- Create: `src/appearance/appearance.ts`
- Modify: `src/db/schema.ts:112-135` (add column)
- Modify: `src/repositories/settings.repo.ts`
- Test: `src/repositories/settings.repo.test.ts` (extend), `src/appearance/appearance.test.ts` (create)

**Interfaces:**
- Produces:
  - `appearances = ['system', 'light', 'dark'] as const`; `type Appearance = (typeof appearances)[number]`.
  - `settings.appearance` column: `text('appearance', { enum: ['system','light','dark'] }).notNull().default('system')`.
  - `settingsRepo.setAppearance(appearance: Appearance)` — writes the single settings row via `write`.
  - `SettingsRow.appearance: Appearance` (through `$inferSelect`).

- [ ] **Step 1: Write the failing tests.**

`src/appearance/appearance.test.ts`:

```ts
import { appearances } from './appearance';

describe('appearances', () => {
  it('lists system, light, dark in that order', () => {
    expect(appearances).toEqual(['system', 'light', 'dark']);
  });
});
```

Extend `src/repositories/settings.repo.test.ts`:

```ts
it('setAppearance updates the single settings row with the chosen appearance', async () => {
  const { captured, tx } = captureSetTx();
  mockTx = tx;

  await settingsRepo.setAppearance('light');

  expect(captured.set).toEqual({ appearance: 'light' });
  expect(captured.whereCalled).toBe(true);
});
```

Optionally extend `src/db/schema.test.ts` (if it asserts settings columns) to include `appearance` defaulting to `'system'`.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/appearance/appearance.test.ts src/repositories/settings.repo.test.ts`
Expected: FAIL — `appearance.ts` missing, `setAppearance` missing.

- [ ] **Step 3: Create `src/appearance/appearance.ts`.**

```ts
// The three appearance modes, mirroring src/i18n/device-language.ts's
// appLanguages shape. 'system' follows the OS (adaptiveThemes); 'light'/'dark'
// pin the theme. Persisted in settings.appearance, default 'system'.
export const appearances = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof appearances)[number];
```

- [ ] **Step 4: Add the schema column** to `src/db/schema.ts`'s `settings` table, after `language`:

```ts
// The chosen appearance: 'system' follows the OS (adaptiveThemes), 'light'/
// 'dark' pin the theme. Defaults to 'system' so a fresh install follows iOS.
// Read by useSyncAppearanceWithSettings; written by settingsRepo.setAppearance.
appearance: text('appearance', { enum: ['system', 'light', 'dark'] })
  .notNull()
  .default('system'),
```

- [ ] **Step 5: Generate the migration.** Run `npx drizzle-kit generate` (config already points `out: ./drizzle/migrations`, `driver: 'expo'`). Confirm it emits `0014_*.sql` containing `ALTER TABLE 'settings' ADD 'appearance' text DEFAULT 'system' NOT NULL;`, plus `meta/0014_snapshot.json` and a new `_journal.json` entry. If drizzle-kit names it randomly, rename the `.sql` to `0014_add_appearance.sql` and update the `_journal.json` `tag` to match (mirroring how `0012_add_language`/`0011_add_lock_settings` are named). Verify the SQL by hand:

```sql
ALTER TABLE `settings` ADD `appearance` text DEFAULT 'system' NOT NULL;
```

- [ ] **Step 6: Register in `migrations.js`.** Add `import m0014 from './0014_add_appearance.sql';` and `m0014` to the `migrations` object. (drizzle-kit does NOT touch this Expo-bundle file — it must be edited by hand.)

- [ ] **Step 7: Add the repo setter** in `settings.repo.ts`:

```ts
import type { Appearance } from '../appearance/appearance';
// ...
setAppearance: (appearance: Appearance) =>
  write((tx) =>
    tx.update(settings).set({ appearance }).where(eq(settings.id, SETTINGS_ID)),
  ),
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx jest src/appearance src/repositories/settings.repo.test.ts src/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 9: Harness gate + commit.** (`.jscpd.json` already ignores `*_snapshot.json`; the new snapshot near-duplicating `0013` is a documented false positive — do not touch jscpd config.)

```bash
npm run check:all
git add drizzle/migrations src/appearance/appearance.ts src/appearance/appearance.test.ts src/db/schema.ts src/repositories/settings.repo.ts src/repositories/settings.repo.test.ts src/db/schema.test.ts
git commit -m "feat(settings): add appearance column, migration, and repo setter"
```

---

### Task 10: App-start appearance controller

**Files:**
- Create: `src/appearance/use-sync-appearance-with-settings.ts`
- Modify: `App.tsx` (mount the hook in `AppRoot`)
- Test: `src/appearance/use-sync-appearance-with-settings.test.ts`

**Interfaces:**
- Consumes: `settingsRepo.getQuery()` + `useLiveQuery` (reads `settings.appearance`); `UnistylesRuntime` (`setAdaptiveThemes`, `setTheme`).
- Produces: `useSyncAppearanceWithSettings(): void`. Behaviour:
  - `'system'` → `UnistylesRuntime.setAdaptiveThemes(true)`.
  - `'light'` / `'dark'` → `UnistylesRuntime.setAdaptiveThemes(false)` then `UnistylesRuntime.setTheme(appearance)`.

- [ ] **Step 1: Write the failing test** `src/appearance/use-sync-appearance-with-settings.test.ts`. Mirror `use-sync-language-with-settings.test.ts`. Mock `useLiveQuery` to return a settings row with a given `appearance`; spy on `UnistylesRuntime` methods (exported by the official mock as no-ops).

```ts
import { renderHook } from '@testing-library/react-native';
import { UnistylesRuntime } from 'react-native-unistyles';

import { useSyncAppearanceWithSettings } from './use-sync-appearance-with-settings';

jest.mock('../db/use-live-query', () => ({
  useLiveQuery: jest.fn(),
}));
import { useLiveQuery } from '../db/use-live-query';
const mockUseLiveQuery = useLiveQuery as jest.Mock;

describe('useSyncAppearanceWithSettings', () => {
  let setAdaptive: jest.SpyInstance;
  let setTheme: jest.SpyInstance;

  beforeEach(() => {
    setAdaptive = jest.spyOn(UnistylesRuntime, 'setAdaptiveThemes').mockImplementation(() => {});
    setTheme = jest.spyOn(UnistylesRuntime, 'setTheme').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("enables adaptiveThemes for 'system'", () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'system' }] });
    renderHook(() => useSyncAppearanceWithSettings());
    expect(setAdaptive).toHaveBeenCalledWith(true);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("pins the light theme for 'light'", () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'light' }] });
    renderHook(() => useSyncAppearanceWithSettings());
    expect(setAdaptive).toHaveBeenCalledWith(false);
    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it("pins the dark theme for 'dark'", () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'dark' }] });
    renderHook(() => useSyncAppearanceWithSettings());
    expect(setAdaptive).toHaveBeenCalledWith(false);
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('does nothing until the settings row loads (empty data)', () => {
    mockUseLiveQuery.mockReturnValue({ data: [] });
    renderHook(() => useSyncAppearanceWithSettings());
    expect(setAdaptive).not.toHaveBeenCalled();
    expect(setTheme).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/appearance/use-sync-appearance-with-settings.test.ts`
Expected: FAIL — hook does not exist.

- [ ] **Step 3: Implement the hook.** Mirror `useSyncLanguageWithSettings`: read the row, drive Unistyles in an effect keyed on `appearance`.

```ts
import { useEffect } from 'react';
import { UnistylesRuntime } from 'react-native-unistyles';

import { useLiveQuery } from '../db/use-live-query';
import { settingsRepo } from '../repositories/settings.repo';

/**
 * Drives Unistyles from the persisted appearance choice. Reads the settings row
 * the same way settings.screen.tsx does. Mounted once from AppRoot, after
 * MigrationsGate (the settings table exists). 'system' hands control back to
 * the OS via adaptiveThemes; 'light'/'dark' pin the theme.
 */
export const useSyncAppearanceWithSettings = (): void => {
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const appearance = data.at(0)?.appearance;

  useEffect(() => {
    if (appearance == null) {
      return;
    }

    if (appearance === 'system') {
      UnistylesRuntime.setAdaptiveThemes(true);
      return;
    }

    UnistylesRuntime.setAdaptiveThemes(false);
    UnistylesRuntime.setTheme(appearance);
  }, [appearance]);
};
```

- [ ] **Step 4: Mount in `App.tsx`.** Add `useSyncAppearanceWithSettings();` in `AppRoot` alongside `useSyncLanguageWithSettings();` (after `settingsRepo.ensure()` effect is declared; hook order stable).

- [ ] **Step 5: Run the test + full suite**

Run: `npx jest src/appearance && npx jest`
Expected: PASS.

- [ ] **Step 6: Harness gate + commit**

```bash
npm run check:all
git add src/appearance/use-sync-appearance-with-settings.ts src/appearance/use-sync-appearance-with-settings.test.ts App.tsx
git commit -m "feat(settings): drive Unistyles from persisted appearance at app start"
```

---

### Task 11: AppearanceSwitch component

**Files:**
- Create: `src/design-system/components/appearance-switch/appearance-switch.component.tsx`
- Create: `src/design-system/components/appearance-switch/appearance-switch.props.d.ts`
- Create: `src/design-system/components/appearance-switch/index.ts`
- Test: `src/design-system/components/appearance-switch/appearance-switch.component.test.tsx`

**Interfaces:**
- Consumes: shared `OptionPills`; `appearances`/`Appearance` (Task 9); i18n `t('appearance.system'|'light'|'dark')` (copy added in Task 12).
- Produces: `AppearanceSwitch: FC<{ selected: Appearance | undefined; onSelect: (a: Appearance) => void }>`. Text-only pills (no SF Symbol icon), mirroring `LanguageSwitch`.

- [ ] **Step 1: Write the failing test.** Mirror the pattern used by `language-switch`/`option-pills` tests: render `AppearanceSwitch`, assert the three labels appear and `onSelect` fires with the tapped value.

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import AppearanceSwitch from '.';

// i18n is initialized globally via jest/setup + src/i18n; t('appearance.*')
// must resolve. If the copy is added in Task 12 after this test is written,
// land Task 11 and Task 12 together so labels resolve.

describe('AppearanceSwitch', () => {
  it('renders the three appearance options and reports a selection', () => {
    const onSelect = jest.fn();
    const { getByText } = render(<AppearanceSwitch selected="system" onSelect={onSelect} />);

    getByText(/System/i);
    getByText(/Light/i);
    fireEvent.press(getByText(/Dark/i));
    expect(onSelect).toHaveBeenCalledWith('dark');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/design-system/components/appearance-switch`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement props, component, index.**

`appearance-switch.props.d.ts`:

```ts
import type { Appearance } from '../../../appearance/appearance';

export type AppearanceSwitchProps = {
  selected: Appearance | undefined;
  onSelect: (appearance: Appearance) => void;
};
```

`appearance-switch.component.tsx`:

```tsx
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { appearances } from '../../../appearance/appearance';
import OptionPills from '../option-pills';

import type { AppearanceSwitchProps } from './appearance-switch.props';

// A segmented System/Light/Dark toggle, delegating pill markup to the shared
// OptionPills (like LanguageSwitch). Text-only pills — no SF Symbol icon.
const AppearanceSwitch: FC<AppearanceSwitchProps> = ({ selected, onSelect }) => {
  const { t } = useTranslation();

  return (
    <OptionPills
      options={appearances}
      selected={selected}
      onSelect={onSelect}
      label={(appearance) => t(`appearance.${appearance}`)}
    />
  );
};

export default AppearanceSwitch;
```

`index.ts`:

```ts
export { default } from './appearance-switch.component';
```

- [ ] **Step 4: Run the test (after Task 12 copy exists) to verify pass.** If landing this task before Task 12, temporarily stub the labels; prefer landing Task 11 + Task 12 together.

Run: `npx jest src/design-system/components/appearance-switch`
Expected: PASS.

- [ ] **Step 5: Harness gate + commit**

```bash
npm run check:all
git add src/design-system/components/appearance-switch
git commit -m "feat(settings): add AppearanceSwitch pill control"
```

---

### Task 12: Settings "Appearance" card + i18n copy

**Files:**
- Modify: `src/i18n/locales/en.ts` (add `settings.appearance` label + `appearance` block)
- Modify: `src/i18n/locales/uk.ts` (parity)
- Modify: `src/screens/settings/settings.screen.tsx`
- Test: `src/screens/settings/settings.screen.test.tsx` (extend), `src/i18n/locales/en.uk.parity.test.ts` stays green

**Interfaces:**
- Consumes: `AppearanceSwitch` (Task 11); `settingsRepo.setAppearance` (Task 9); `useLiveQuery` settings row.
- Produces: an Appearance `GlassSurface` card between Language and Categories.

- [ ] **Step 1: Write the failing test.** Extend `settings.screen.test.tsx` to assert the Appearance card renders and selecting a pill calls `settingsRepo.setAppearance`. Follow the existing base-currency/language test shape in that file (mock `settingsRepo`, render, fire press on the Light pill, assert `setAppearance('light')`).

```tsx
it('renders the Appearance card and persists a chosen appearance', () => {
  // ...existing render harness with a settings row { appearance: 'system' }...
  fireEvent.press(getByText(/Light/i));
  expect(settingsRepo.setAppearance).toHaveBeenCalledWith('light');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/screens/settings/settings.screen.test.tsx`
Expected: FAIL — no Appearance card.

- [ ] **Step 3: Add i18n copy.** In `en.ts` under `settings`, add `appearance: 'Appearance',` (title case, per `kiko-design-system`). Add a top-level `appearance` block mirroring the `language` block:

```ts
appearance: {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
},
```

Add the Ukrainian parity in `uk.ts`:

```ts
// settings.appearance:
appearance: 'Вигляд',
// top-level:
appearance: {
  system: 'Системна',
  light: 'Світла',
  dark: 'Темна',
},
```

(The exact UK wording is subject to the standing `uk.ts` wording review in memory; keep it natural and consistent with existing tone. The `en.uk.parity.test.ts` enforces identical key sets — add the keys to both.)

- [ ] **Step 4: Add the card** to `settings.screen.tsx`, between the Language card and the Categories card, mirroring the Language card exactly:

```tsx
import AppearanceSwitch from '../../design-system/components/appearance-switch';
// ...
const handleSelectAppearance = (appearance: Appearance): void => {
  settingsRepo.setAppearance(appearance);
};
// ...
<GlassSurface testID="settings-card-appearance" padding={3}>
  <SettingsRow testID="settings-row-appearance" icon="circle.lefthalf.filled" label={t('settings.appearance')}>
    <AppearanceSwitch selected={settings?.appearance} onSelect={handleSelectAppearance} />
  </SettingsRow>
</GlassSurface>
```

(`circle.lefthalf.filled` is the iOS appearance glyph; verify its min-iOS availability per the SF Symbols memory note before the device build — fall back to `moon.circle` / `sun.max` split or `paintbrush` if unavailable on the device's iOS.)

- [ ] **Step 5: Run the tests to verify pass**

Run: `npx jest src/screens/settings/settings.screen.test.tsx src/i18n/locales`
Expected: PASS (including the en/uk parity test).

- [ ] **Step 6: Harness gate + commit**

```bash
npm run check:all
git add src/i18n/locales/en.ts src/i18n/locales/uk.ts src/screens/settings/settings.screen.tsx src/screens/settings/settings.screen.test.tsx
git commit -m "feat(settings): add Appearance card with System/Light/Dark control"
```

---

### Task 13: Full-suite verification + device build + deep gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full Jest suite.**

Run: `npx jest`
Expected: PASS, no snapshots left stale.

- [ ] **Step 2: Run the fast+medium harness gate.**

Run: `npm run check:all`
Expected: green (lint, dup, knip, deps, security, secrets, overrides). Resolve any knip/deps finding by fixing the code, never by weakening a check.

- [ ] **Step 3: Device build.** Build and deploy to the iPhone (`scripts/deploy-device.sh`; honour the memory notes: `FORCE_BUNDLING=1`, re-`pod install` if `ios/build` was cleaned, verify a NEW container UUID via `devicectl`, verify the Hermes bundle contains a known-new string). Then verify live:
  - Fresh-install default (or reset the `appearance` row to `'system'`): the app follows the OS appearance.
  - Settings → Appearance: switch System → Light → Dark. Each switch updates **live** (no relaunch) across: screen backgrounds, cards (GlassSurface), the native bottom-tab bar (Task 6 device check), navigation chrome, the entity-card tints (light-mode cards read near-white with black text), charts, and the status bar (dark text on light — Task 7 note).
  - With Appearance = System, toggle the OS appearance and confirm the whole app follows live.
  - Relaunch the app: the persisted choice is restored (Light stays Light, Dark stays Dark, System follows OS).

- [ ] **Step 4: Run the deep gate.**

Run: `npm run check:deep`
Expected: mutation score at/above threshold and osv-scanner clean of NEW findings (the known accepted `image-size`/`decode-uri-component` debt in CLAUDE.md is pre-existing, not introduced here — do not silence it).

- [ ] **Step 5: Final commit (if any verification fix was needed).**

```bash
git add -A
git commit -m "test(theme): verify light color scheme end-to-end"
```

---

## Non-Goals / Follow-up Notes (spec Section 6 — NOT tasks)

These are recorded limitations from the approved spec. They are explicitly **out of scope** for this plan; flag them to the **designer** for a light-theme design-review follow-up, and do not silently implement them in passing:

1. **Native `UIUserInterfaceStyle` / `overrideUserInterfaceStyle` override.** `Info.plist` has no `UIUserInterfaceStyle` key, so a manual in-app "Light" choice while the OS is in Dark Mode does NOT restyle native system dialogs (date picker, alerts, share sheet) — those follow the OS. A full native override is out of scope (spec Section 6, item 1 and Out-of-scope). If the Task 6 device check reveals the native tab bar cannot follow a manual choice live without it, record the finding for a separate decision — do not add the native override here.
2. **`entityTintBackground` opacity calibration.** `ENTITY_TINT_OPACITY = 0.1` was calibrated by eye against the dark surface (spec Section 5). It is math-correct on any background but may need a light-mode calibration review; not changed by this plan.

RESOLVED IN-PLAN (no longer follow-ups — spec Section 6 items 2 and 3, per the Section 1 per-theme palette decision): the `white` entity swatch invisible on a white card, and the low-contrast `yellow`/`mint` hues on white, are now fixed directly in the light palette set defined in Task 1 (see its chosen-light-value table). `white`, `khaki`, `yellow`, and `mint` are each defended with a computed contrast ratio against `#FFFFFF` (`white` flips to plain black, 21:1) and none carry a flag. They are implemented, not deferred.

## Self-Review (completed against the spec)

- **Section 1 (light palette + per-theme palette decision):** Task 1 (light chrome values verbatim; PER-THEME entity/chart palette module with a light set and a dark set + the chosen-light-value table; the Section 1 per-theme decision, which reverses the earlier shared-palette decision). ✔
- **Section 2 (theme module + per-theme palette + Unistyles registration):** Task 1 (shared base + two themes, each referencing its own per-theme set) + Task 2 (both themes, `adaptiveThemes: true`). ✔
- **Section 3 (persistence + Settings control):** Task 9 (column/migration/repo), Task 10 (app-start controller), Task 11 (AppearanceSwitch), Task 12 (Settings card via OptionPills, read via useLiveQuery). ✔
- **Section 4 (chrome fixes + scheme threading):** glass-surface + bottom-sheet (Task 5), root.navigator tab bar with device verification (Task 6), navigation light theme + selection (Task 7). The `category-breakdown`/`entity-colors`/`account-contribution` repoint is now the full per-theme scheme-threading of Task 8 (both core modules AND every enumerated call site: statistics, home, categories, transaction/holding/account forms, holding-detail, account-detail, holding-card, accounts, bar-chart). ✔ (Helper `resolveColorScheme` in Task 4 backs every scheme-aware read; the larger blast radius from spec Section 4's note is enumerated in Task 8.)
- **Section 5 (entity card direction + scheme-aware fallback):** Task 3 (`lightenHex`, direction-aware `entityCardBackground`, light-direction tests; scheme-aware `FALLBACK_ENTITY_COLOR`/`resolveEntityColor` resolving gray from the matching per-theme set; `entityTintBackground` calibration recorded as follow-up). ✔
- **Section 6 (limitations):** item 1 (native `UIUserInterfaceStyle`) and the `entityTintBackground` opacity calibration recorded as Non-Goals; items 2 (`white` swatch) and 3 (`yellow`/`mint`) RESOLVED in-plan by Task 1's light set, each defended with a computed contrast ratio against `#FFFFFF` (`white` 21:1 as plain black, `khaki` 3.70:1, `yellow` 3.25:1, `mint` 3.52:1) and none carrying a flag; status-bar verification folded into Task 7 + Task 13. ✔
- **Section 7 (tests):** shape-invariant both-themes key-set test; per-theme swatch/series VALUE assertions in both light and dark; each theme's entity `blue` compared against its OWN per-theme set (Task 1); light-direction `entity-tint` cases + scheme-aware fallback cases (Task 3); per-consumer light-branch spy cases (Task 8). ✔
