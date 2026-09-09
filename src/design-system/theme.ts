// iOS system palette — the single dark theme (spec Section 2: spacing, radii,
// and typography are shared with the token shape).
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
// The named entity-color and chart-series palettes live in ./palette
// (entityColorsDark, chartSeriesDark); the theme references those sets.

import { chartSeriesDark, entityColorsDark } from './palette';

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
    // The `surface` hue (#1C1C1E) at 60% alpha — the see-through frosted-panel
    // fill for a `transparent` GlassSurface (see its `transparent` prop). It is
    // used in two matching places so the glass and the non-glass fallback paths
    // read alike: as the translucent backdrop the see-through glass material
    // samples (a partial pin that softens the live-sample lightness drift), and
    // as the flat fill on the non-glass fallback. Over the true-black
    // `background` it composites to ~rgb(17,17,18), so white `textPrimary` body
    // text stays legible on it. This is a distinct token from `scrim` (the
    // modal dim) — same alpha convention, different role.
    surfaceTranslucent: 'rgba(28,28,30,0.60)',
    surfaceHigh: '#2C2C2E', // tertiarySystemBackground
    textPrimary: '#FFFFFF', // label
    textSecondary: 'rgba(235,235,245,0.60)', // secondaryLabel
    accent: '#0A84FF', // systemBlue (dark)
    // Foreground for anything sitting ON a filled accent/destructive surface —
    // a primary Button's label+icon, a Switch thumb on the accent track. Always
    // white and kept as its own token (never `textPrimary`) so text on a
    // blue/red fill stays legible.
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
