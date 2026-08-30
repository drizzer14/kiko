// OLED dark theme tokens.
//
// Follows the Habr OLED method (see docs/superpowers/specs/2026-08-30-pff-foundation-design.md
// and .claude/skills/pff-design-system/SKILL.md):
// - true-black background so OLED pixels can switch fully off
// - translucent white overlays (not solid grays) for elevation, opacity rising with level
// - off-white (not pure white) primary text to avoid halation, with a dimmer secondary tone
// - a desaturated accent rather than a fully saturated one on black
// - unambiguous, distinct positive/negative money colors
export const darkTheme = {
  colors: {
    background: '#000000', // true black for OLED
    surface: 'rgba(255,255,255,0.06)', // elevation level 1 overlay
    surfaceHigh: 'rgba(255,255,255,0.10)', // elevation level 2 overlay
    textPrimary: '#EDEDED', // off-white, reduces halation vs pure white
    textSecondary: '#9A9A9A', // dimmer secondary tone
    accent: '#7AA2C4', // desaturated blue, avoids eye strain on black
    positive: '#4FB477',
    negative: '#D06B6B',
    border: 'rgba(255,255,255,0.12)',
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
