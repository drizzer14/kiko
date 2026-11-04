// The entity/chart palettes. Each named swatch/series color uses Apple's
// dark-mode system-color value. Only ever GROW a set (never remove/rename a
// key) so an existing default mapping never dangles.
//
// Dark set: Apple dark-mode system-color values. The `blue`/`green` hexes are
// inlined literals, decoupled from the theme `accent`/`positive` tokens.
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

export type SwatchName = keyof typeof entityColorsDark;

// Which of the two registered themes a surface reads; carried on each theme.
export type ColorScheme = 'dark' | 'light';

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

// Light twins of the dark set, from docs/design/light-palette/palette.json (pinned by
// __tests__/light-palette-source.test.ts). Stored colors stay the dark hex; these are only the
// display value. Keyed by the dark set, so a key can never exist on one side only. They sit below
// the dark sets because the dark-value checker reads the dark blocks by position.
//
// Tile fill for an account or holding: kept at least 3.8:1 against white, so even the lightened
// top gradient stop holds a white glyph at 3:1.
export const entityColorsLight: Record<SwatchName, string> = {
  white: '#3A3A3C',
  khaki: '#8A8434',
  brown: '#8C6A43',
  yellow: '#A67C00',
  blue: '#0066E6',
  green: '#1F8A3B',
  mint: '#008A83',
  violet: '#9B3FD1',
  red: '#E0352B',
  orange: '#C46A00',
  teal: '#0A869E',
  pink: '#D6204A',
  indigo: '#3A38B8',
  gray: '#6E6E73',
};

// A separate set because a category hue is also a chart line and pie slice on a white card, and
// the lightest passing hue keeps eight slices apart; the entity set keeps a safety margin instead.
export const categoryColorsLight: Record<SwatchName, string> = {
  white: '#48484A',
  khaki: '#8B8535',
  brown: '#A07A4B',
  yellow: '#A67C00',
  blue: '#0066E6',
  green: '#1E8E3E',
  mint: '#00958D',
  violet: '#A546DB',
  red: '#E5392F',
  orange: '#C86C00',
  teal: '#0C8CA6',
  pink: '#E0305A',
  indigo: '#4240C4',
  gray: '#7C7C80',
};

// The same eight hues in the same order, read from the category set so the subset invariant above
// holds by construction for light.
export const chartSeriesLight: readonly string[] = (
  ['blue', 'green', 'orange', 'violet', 'teal', 'pink', 'yellow', 'indigo'] as const
).map((name) => categoryColorsLight[name]);
