// The entity/chart palettes. Each named swatch/series color uses Apple's
// dark-mode system-color value. Only ever GROW a set (never remove/rename a
// key) so an existing default mapping never dangles.
//
// Dark set: Apple dark-mode system-color values. The `blue`/`green` hexes are
// inlined literals (previously aliased to the theme `accent`/`positive`), now
// decoupled because `accent`/`positive` are theme tokens.
export const entityColorsDark = {
  white: '#FFFFFF',
  khaki: '#BDB76B',
  brown: '#AC8E68', // systemBrown (dark)
  yellow: '#FFD60A', // systemYellow (dark)
  blue: '#0A84FF', // systemBlue (dark) — matches darkTheme.colors.accent
  green: '#30D158', // systemGreen (dark) — matches darkTheme.colors.positive
  mint: '#66D4CF', // systemMint (dark)
  violet: '#BF5AF2', // systemPurple (dark)
  red: '#FF453A', // systemRed (dark)
  orange: '#FF9F0A', // systemOrange (dark)
  teal: '#40C8E0', // systemTeal (dark)
  pink: '#FF375F', // systemPink (dark)
  indigo: '#5E5CE6', // systemIndigo (dark)
  gray: '#98989D', // systemGray (dark)
} as const;

// Categorical palette for charts (line series / pie slices). Eight hues, each
// distinct from its neighbours. Consumers cycle with
// `series[i % series.length]`.
//
// INVARIANT: every chartSeries hue MUST remain a subset of the
// entityColors hexes. The add-category color picker rings the swatch whose hex
// equals the resolved category color (resolveCategoryColor), and an uncolored
// category resolves to its chartSeries fallback — so a fallback hue with no
// matching entityColors swatch would ring nothing. Enforced by palette.test.ts.
export const chartSeriesDark = [
  '#0A84FF', // systemBlue
  '#30D158', // systemGreen
  '#FF9F0A', // systemOrange
  '#BF5AF2', // systemPurple
  '#40C8E0', // systemTeal
  '#FF375F', // systemPink
  '#FFD60A', // systemYellow
  '#5E5CE6', // systemIndigo
] as const satisfies readonly string[];
