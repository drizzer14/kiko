// iOS dark system palette.
//
// Re-derived from Apple's dark-mode system colors (see
// docs/superpowers/specs/2026-08-30-pff-foundation-design.md and
// .claude/skills/pff-design-system/SKILL.md):
// - true-black background (systemBackground, dark)
// - secondary/tertiary system background levels for elevated surfaces
// - label / secondaryLabel for primary and secondary text
// - systemBlue for the accent, systemGreen/systemRed for money tones
// - separator for hairline borders
//
// `accent` and `positive` are the single source of truth for systemBlue and
// systemGreen respectively; the entity-color palette below aliases them (as
// `blue` / `green`) rather than restating the hex, so a future tweak to either
// tone stays in one place.
const accent = '#0A84FF'; // systemBlue (dark)
const positive = '#30D158'; // systemGreen (dark)

export const darkTheme = {
  colors: {
    background: '#000000', // systemBackground (dark)
    surface: '#1C1C1E', // secondarySystemBackground
    surfaceHigh: '#2C2C2E', // tertiarySystemBackground
    textPrimary: '#FFFFFF', // label
    textSecondary: 'rgba(235,235,245,0.60)', // secondaryLabel
    accent, // systemBlue (dark)
    positive, // systemGreen (dark)
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
    // Named palette a user picks from to color an account or holding.
    // Fourteen distinct swatches drawn from Apple's dark-mode system color
    // family, each legible on the true-black background and visually
    // distinct from its neighbours. `blue` and `green` alias the `accent` /
    // `positive` tones above to keep one source of truth; the default
    // kind/type -> color mappings live in src/holdings/entity-colors.ts and
    // reference these tokens. Only ever grow this set (never remove/rename a
    // key) so an existing default mapping never dangles.
    entityColors: {
      white: '#FFFFFF',
      khaki: '#BDB76B',
      brown: '#AC8E68', // systemBrown (dark)
      yellow: '#FFD60A', // systemYellow (dark)
      blue: accent,
      green: positive,
      mint: '#66D4CF', // systemMint (dark)
      violet: '#BF5AF2', // systemPurple (dark)
      red: '#FF453A', // systemRed (dark)
      orange: '#FF9F0A', // systemOrange (dark)
      teal: '#40C8E0', // systemTeal (dark)
      pink: '#FF375F', // systemPink (dark)
      indigo: '#5E5CE6', // systemIndigo (dark)
      gray: '#98989D', // systemGray (dark)
    },
    // Categorical palette for charts (line series / pie slices). Eight Apple
    // dark system hues, each legible on the true-black background and distinct
    // from its neighbours. Consumers cycle with `chartSeries[i % chartSeries.length]`.
    chartSeries: [
      '#0A84FF', // systemBlue
      '#30D158', // systemGreen
      '#FF9F0A', // systemOrange
      '#BF5AF2', // systemPurple
      '#40C8E0', // systemTeal
      '#FF375F', // systemPink
      '#FFD60A', // systemYellow
      '#5E5CE6', // systemIndigo
    ] as readonly string[],
  },
  spacing: (multiplier: number) => multiplier * 4,
  radii: { sm: 6, md: 10, lg: 16 },
  typography: {
    // One step above `title` — a hero numeral (e.g. Home's net-worth
    // balance), styled at the same weight but larger, for the one or two
    // spots that need to read as the single most prominent figure on screen.
    display: { fontSize: 44, fontWeight: '700' as const },
    title: { fontSize: 28, fontWeight: '700' as const },
    heading: { fontSize: 20, fontWeight: '600' as const },
    body: { fontSize: 16, fontWeight: '400' as const },
    caption: { fontSize: 13, fontWeight: '400' as const },
  },
} as const;
