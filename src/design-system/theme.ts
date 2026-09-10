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
    // The base fill for a presented bottom sheet — the iOS
    // `systemGroupedBackground` (dark, elevated) equivalent. A sheet is a
    // grouped surface: its base sits one level BELOW the cards/controls on it,
    // so a control on the sheet (an OptionPills selected pill, at `surfaceHigh`)
    // reads as raised instead of blending into the sheet. Before this, the sheet
    // used `surfaceHigh` itself, the SAME tone as a selected pill, so the two
    // blended (on-device review). This is `#1C1C1E` — the same value as
    // `surface` today, but kept a DISTINCT semantic token (like `onAccent` vs
    // `textPrimary`) because its role is the sheet's grouped base, not a card
    // surface, and the two may diverge. It is deliberately NOT the true-black
    // `background`: a pure-black sheet would vanish against the black screen
    // behind it instead of reading as an elevated card.
    sheetBackground: '#1C1C1E',
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
    // The systemRed hue (#FF453A) at 0.18 alpha — the translucent fill for the
    // `destructiveTonal` Button variant (the iOS "tinted destructive" pattern:
    // a low-opacity red BACKGROUND under red `negative` TEXT, not a solid bright
    // fill). Over the true-black `background` it composites to a dark red
    // (~rgb(46,12,10)), so the bright `negative` label stays high-contrast and
    // legible on it. This is a distinct token from the solid `negative` fill:
    // `negative` is the bright surface a solid `destructive` Button paints,
    // `negativeSubtle` is the muted tint the tonal variant paints. Because the
    // text ON this tint is the SAME red hue (the tinted-button convention), the
    // tonal variant is the deliberate exception to the `onAccent` rule — that
    // rule governs text on a SOLID accent/destructive fill, not on a same-hue
    // tint.
    negativeSubtle: 'rgba(255,69,58,0.18)',
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
