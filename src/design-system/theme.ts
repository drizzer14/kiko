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
export const darkTheme = {
  colors: {
    background: '#000000', // systemBackground (dark)
    surface: '#1C1C1E', // secondarySystemBackground
    surfaceHigh: '#2C2C2E', // tertiarySystemBackground
    textPrimary: '#FFFFFF', // label
    textSecondary: 'rgba(235,235,245,0.60)', // secondaryLabel
    accent: '#0A84FF', // systemBlue (dark)
    positive: '#30D158', // systemGreen (dark)
    negative: '#FF453A', // systemRed (dark)
    border: '#38383A', // separator (dark)
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
