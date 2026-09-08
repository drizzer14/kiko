// iOS system palette — two themes sharing one shape (spec Section 2: they
// differ only in `colors`; spacing, radii, and typography are shared).
//
// Dark re-derived from Apple's dark-mode system colors (see
// docs/superpowers/specs/2026-08-30-kiko-foundation-design.md and
// .claude/skills/kiko-design-system/SKILL.md):
// - true-black background (systemBackground, dark)
// - secondary/tertiary system background levels for elevated surfaces
// - label / secondaryLabel for primary and secondary text
// - systemBlue for the accent, systemGreen/systemRed for money tones
// - separator for hairline borders
//
// Light uses Apple's light-mode system colors (spec Section 1 table).
//
// The named entity-color and chart-series palettes now live in ./palette as
// per-theme sets (entityColorsDark/Light, chartSeriesDark/Light); each theme
// references its own set so a light/dark switch swaps the whole palette.

import { chartSeriesDark, chartSeriesLight, entityColorsDark, entityColorsLight } from './palette';

// Shared across both themes — spec Section 2: they differ only in `colors`.
const spacing = (multiplier: number) => multiplier * 4;
const radii = { sm: 6, md: 10, lg: 16 } as const;
const typography = {
  // One step above `title` — a hero numeral (e.g. Home's net-worth
  // balance), styled at the same weight but larger, for the one or two
  // spots that need to read as the single most prominent figure on screen.
  display: { fontSize: 44, fontWeight: '700' as const },
  title: { fontSize: 28, fontWeight: '700' as const },
  heading: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
} as const;

export const darkTheme = {
  colors: {
    background: '#000000', // systemBackground (dark)
    surface: '#1C1C1E', // secondarySystemBackground
    surfaceHigh: '#2C2C2E', // tertiarySystemBackground
    textPrimary: '#FFFFFF', // label
    textSecondary: 'rgba(235,235,245,0.60)', // secondaryLabel
    accent: '#0A84FF', // systemBlue (dark)
    // Foreground for anything sitting ON a filled accent/destructive surface —
    // a primary Button's label+icon, a Switch thumb on the accent track. White
    // in BOTH themes: `textPrimary` flips to black on light and would vanish on
    // a blue/red fill. This is the one always-white foreground token.
    onAccent: '#FFFFFF',
    positive: '#30D158', // systemGreen (dark)
    negative: '#FF453A', // systemRed (dark)
    border: '#38383A', // separator (dark)
    // The translucent-black dismiss scrim behind a modal/bottom-sheet
    // overlay (BottomSheet). NOT the opaque `background` token: a modal
    // scrim reads as a frosted dim over whatever screen is behind it — real
    // blur via LiquidGlassView where iOS 26+ supports it, this flat
    // translucent black as the scrim's own tint (layered under the glass
    // material) and as the non-liquid-glass fallback's dim. 0.55 keeps
    // enough contrast for the sheet on top without ever reading as solid
    // black.
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
    // The three background-family light values set the white-card-on-
    // light-gray-ground hierarchy: `background` is the grouped-ground gray,
    // `surface` is the white card floating on it, `surfaceHigh` the next
    // step up for a raised control on that card.
    background: '#F2F2F7', // systemGroupedBackground (light)
    surface: '#FFFFFF', // secondarySystemGrouped
    surfaceHigh: '#E5E5EA', // systemGray5
    textPrimary: '#000000', // label
    textSecondary: 'rgba(60,60,67,0.60)', // secondaryLabel
    accent: '#007AFF', // systemBlue (light)
    // Foreground for anything sitting ON a filled accent/destructive surface —
    // a primary Button's label+icon, a Switch thumb on the accent track. White
    // in BOTH themes: `textPrimary` flips to black on light and would vanish on
    // a blue/red fill. This is the one always-white foreground token.
    onAccent: '#FFFFFF',
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
