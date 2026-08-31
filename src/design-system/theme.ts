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
  },
  spacing: (multiplier: number) => multiplier * 4,
  radii: { sm: 6, md: 10, lg: 16 },
  typography: {
    title: { fontSize: 28, fontWeight: '700' as const },
    heading: { fontSize: 20, fontWeight: '600' as const },
    body: { fontSize: 16, fontWeight: '400' as const },
    caption: { fontSize: 13, fontWeight: '400' as const },
  },
} as const;
